import { App, Modal, Notice, TFile } from 'obsidian';
import { findMentionsGrouped, GroupedMention } from '../refs/matcher';
import { applySpans } from '../refs/apply';
import type { MentionCandidate } from '../refs/references';
import { getKindSpec } from '../entities/entity-kinds';
import type { EntityKind } from '../entities/entity-kinds';
import type StorygridPlugin from '../main';
import { t } from '../i18n';

// ── Context snippet ───────────────────────────────────────────────────────────

function contextSnippet(
    text: string,
    start: number,
    end: number,
    pad = 28,
): { prefix: string; matched: string; suffix: string; leadEllipsis: boolean; trailEllipsis: boolean } {
    const snippetStart = Math.max(0, start - pad);
    const snippetEnd = Math.min(text.length, end + pad);
    return {
        leadEllipsis: snippetStart > 0,
        prefix: text.slice(snippetStart, start),
        matched: text.slice(start, end),
        suffix: text.slice(end, snippetEnd),
        trailEllipsis: snippetEnd < text.length,
    };
}

function entityLabel(candidate: MentionCandidate, kindMap: Map<string, EntityKind>): string {
    const name = candidate.notePath.split('/').pop()?.replace(/\.md$/, '') ?? candidate.notePath;
    const kind = kindMap.get(candidate.entityId);
    const kindLabel = kind ? getKindSpec(kind).singular : '';
    return kindLabel ? `${name} (${kindLabel})` : name;
}

// ── Confirm modal ─────────────────────────────────────────────────────────────

export class ScanMentionsModal extends Modal {
    /** spanKey → chosen candidate, or null if unchecked */
    private chosen: Map<string, MentionCandidate | null>;
    private applyBtn: HTMLButtonElement | null = null;

    constructor(
        app: App,
        private readonly file: TFile,
        private readonly originalText: string,
        private readonly groups: GroupedMention[],
        private readonly kindMap: Map<string, EntityKind>,
    ) {
        super(app);
        this.chosen = new Map(
            groups.map((g) => {
                const key = `${g.start}:${g.end}`;
                const val = g.isCommonWord ? null : g.candidates[0];
                return [key, val];
            }),
        );
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('sg-scan-modal');
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private countChecked(): number {
        return [...this.chosen.values()].filter((v) => v !== null).length;
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        // ── Header ──────────────────────────────────────────────────────────
        const header = contentEl.createDiv({ cls: 'sg-scan-header' });
        header.createEl('h2', { cls: 'sg-scan-title', text: 'Link Codex names' });
        header.createEl('p', {
            cls: 'sg-scan-subtitle',
            text: `${this.groups.length} name${this.groups.length !== 1 ? 's' : ''} found in "${this.file.basename}"`,
        });

        // ── Toolbar ──────────────────────────────────────────────────────────
        const toolbar = contentEl.createDiv({ cls: 'sg-scan-toolbar' });
        const selectAllBtn = toolbar.createEl('button', { cls: 'sg-scan-toolbar-btn', text: 'Select all' });
        selectAllBtn.addEventListener('click', () => {
            for (const [key, _] of this.chosen) {
                const g = this.groups.find((g) => `${g.start}:${g.end}` === key);
                if (g) this.chosen.set(key, g.candidates[0]);
            }
            this.render();
        });
        const deselectAllBtn = toolbar.createEl('button', { cls: 'sg-scan-toolbar-btn', text: 'Deselect all' });
        deselectAllBtn.addEventListener('click', () => {
            for (const key of this.chosen.keys()) this.chosen.set(key, null);
            this.render();
        });

        // ── Candidate list ───────────────────────────────────────────────────
        const list = contentEl.createDiv({ cls: 'sg-scan-list' });

        for (const group of this.groups) {
            const key = `${group.start}:${group.end}`;
            const chosenCandidate = this.chosen.get(key) ?? null;
            const isChecked = chosenCandidate !== null;
            const isAmbiguous = group.candidates.length > 1;

            const row = list.createDiv({ cls: 'sg-scan-row' });
            if (!isChecked) row.addClass('sg-scan-row--unchecked');

            // Checkbox
            const checkbox = row.createEl('input', { type: 'checkbox' } as DomElementInfo) as HTMLInputElement;
            checkbox.checked = isChecked;
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    const sel = select;
                    const pick = isAmbiguous
                        ? (sel ? group.candidates.find((c) => c.entityId === sel.value) ?? group.candidates[0] : group.candidates[0])
                        : group.candidates[0];
                    this.chosen.set(key, pick);
                } else {
                    this.chosen.set(key, null);
                }
                row.toggleClass('sg-scan-row--unchecked', !checkbox.checked);
                if (select) select.disabled = !checkbox.checked;
                this.updateApplyBtn();
            });

            // Kind avatar (for unambiguous: use the single candidate's kind)
            const displayCandidate = chosenCandidate ?? group.candidates[0];
            const kind = this.kindMap.get(displayCandidate.entityId);
            const spec = kind ? getKindSpec(kind) : null;
            const avatar = row.createDiv({ cls: `sg-scan-avatar${kind ? ` sg-cs-kind--${kind}` : ''}` });
            avatar.textContent = spec ? spec.singular[0].toUpperCase() : '?';

            // Info block
            const info = row.createDiv({ cls: 'sg-scan-info' });

            // Name row
            const nameRow = info.createDiv({ cls: 'sg-scan-name-row' });
            nameRow.createSpan({ cls: 'sg-scan-name', text: group.matchedText });
            if (group.isCommonWord) {
                nameRow.createSpan({ cls: 'sg-scan-common-badge', text: 'common word' });
            }

            // Ambiguity select or simple kind label
            let select: HTMLSelectElement | null = null;
            if (isAmbiguous) {
                select = info.createEl('select', { cls: 'sg-scan-ambiguity-select' });
                select.disabled = !isChecked;
                for (const candidate of group.candidates) {
                    const opt = select.createEl('option', { value: candidate.entityId, text: entityLabel(candidate, this.kindMap) });
                    if (chosenCandidate?.entityId === candidate.entityId) opt.selected = true;
                }
                select.addEventListener('change', () => {
                    const picked = group.candidates.find((c) => c.entityId === select!.value) ?? group.candidates[0];
                    this.chosen.set(key, checkbox.checked ? picked : null);
                });
            } else if (spec) {
                nameRow.createSpan({ cls: 'sg-scan-kind', text: spec.singular });
            }

            // Context snippet
            const snip = contextSnippet(this.originalText, group.start, group.end);
            const snippetEl = info.createDiv({ cls: 'sg-scan-snippet' });
            if (snip.leadEllipsis) snippetEl.createSpan({ cls: 'sg-scan-ellipsis', text: '…' });
            snippetEl.createSpan({ cls: 'sg-scan-snip-before', text: snip.prefix });
            snippetEl.createSpan({ cls: 'sg-scan-snip-match', text: snip.matched });
            snippetEl.createSpan({ cls: 'sg-scan-snip-after', text: snip.suffix });
            if (snip.trailEllipsis) snippetEl.createSpan({ cls: 'sg-scan-ellipsis', text: '…' });
        }

        // ── Footer ───────────────────────────────────────────────────────────
        const footer = contentEl.createDiv({ cls: 'sg-scan-footer' });
        const cancelBtn = footer.createEl('button', { cls: 'sg-scan-cancel-btn', text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        this.applyBtn = footer.createEl('button', { cls: 'sg-scan-apply-btn' }) as HTMLButtonElement;
        this.updateApplyBtn();
        this.applyBtn.addEventListener('click', () => void this.apply());
    }

    private updateApplyBtn(): void {
        if (!this.applyBtn) return;
        const count = this.countChecked();
        this.applyBtn.textContent = count > 0 ? `Apply ${count} link${count !== 1 ? 's' : ''}` : 'Apply links';
        this.applyBtn.disabled = count === 0;
        this.applyBtn.toggleClass('sg-scan-apply-btn--disabled', count === 0);
    }

    private async apply(): Promise<void> {
        const confirmed = [...this.chosen.values()]
            .filter((v): v is MentionCandidate => v !== null)
            .sort((a, b) => a.start - b.start);
        try {
            // Spans were computed against originalText — if the note changed since
            // the scan (another tab, sync), applying them would corrupt it. Bail.
            let stale = false;
            await this.app.vault.process(this.file, (current) => {
                if (current !== this.originalText) {
                    stale = true;
                    return current;
                }
                return applySpans(current, confirmed);
            });
            if (stale) {
                new Notice('This note changed since the scan — run the scan again.');
                this.close();
                return;
            }
            const n = confirmed.length;
            new Notice(`Linked ${n} Codex mention${n !== 1 ? 's' : ''}.`);
            this.close();
        } catch (e) {
            new Notice('Failed to save. Check the console.');
            console.error('[Plotverk] scan apply error:', e);
        }
    }
}

// ── Command registration ──────────────────────────────────────────────────────

export function registerScanCommand(plugin: StorygridPlugin): void {
    plugin.addCommand({
        id: 'scan-codex-mentions',
        name: t('command.scanMentions'),
        callback: async () => {
            const file = plugin.app.workspace.getActiveFile();
            if (!file || file.extension !== 'md') {
                new Notice('Open a markdown note first.');
                return;
            }

            const text = await plugin.app.vault.read(file);
            const matchables = plugin.referenceIndex.buildMatchableEntitiesFor(file.path);

            if (!matchables.length) {
                new Notice('No Codex entries indexed yet. Open a project first.');
                return;
            }

            const groups = findMentionsGrouped(text, matchables);
            if (!groups.length) {
                new Notice('No unlinked Codex names found in this note.');
                return;
            }

            // Build entityId → kind lookup from the live entity index
            const kindMap = new Map<string, EntityKind>();
            for (const entity of plugin.entityIndex.getAllEntities()) {
                if (entity.entityId) kindMap.set(entity.entityId, entity.kind);
            }

            new ScanMentionsModal(plugin.app, file, text, groups, kindMap).open();
        },
    });
}
