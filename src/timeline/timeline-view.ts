import { ItemView, WorkspaceLeaf, TFile, TFolder, TAbstractFile, Notice, ViewStateResult } from 'obsidian';
import { isSafetyNetPath } from '../utils/safety-paths';
import type StorygridPlugin from '../main';
import { TimelineData, createEmptyTimeline } from './timeline-data';
import { GREGORIAN_CALENDAR } from './calendar';
import { TimelineController } from './timeline-render';
import { setPhosphorIcon } from '../utils/icons';
import { t } from '../i18n';

export const VIEW_TYPE_TIMELINE = 'storygrid-timeline-view';

/**
 * File-backed ItemView for a project's `.timeline` JSON, registered exactly
 * like `.storygrid` (StorygridView) — same file-open blank-page fix, same
 * external-modify reload guard, same 800ms debounced save. The SVG rendering
 * itself lives in `TimelineController` (mirrors RelGraphController), mounted
 * into a content div this view owns.
 */
export class TimelineView extends ItemView {
	plugin: StorygridPlugin;

	private filePath: string | null = null;
	private timelineData: TimelineData | null = null;
	private controller: TimelineController | null = null;

	private saveTimer: number | null = null;
	private _selfWrite = false;

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_TIMELINE; }
	getDisplayText(): string { return this.timelineData?.name ?? 'Timeline'; }
	getIcon(): string { return 'sg-git-commit'; }

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	async onOpen(): Promise<void> {
		this.contentEl.addClass('sg-tl-view-root');

		// PRIMARY blank-page fix, same pattern as StorygridView.
		this.registerEvent(
			this.app.workspace.on('file-open', (file: TFile | null) => {
				if (!file || file.extension !== 'timeline') return;
				if (this.leaf === this.app.workspace.getMostRecentLeaf()
					&& (this.filePath !== file.path || !this.timelineData)) {
					void this.loadTimeline(file.path);
				}
			})
		);

		// Reload when an external write changes our file, unless we're the writer.
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (!(file instanceof TFile)) return;
			if (file.path !== this.filePath) return;
			if (this._selfWrite) return;
			if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
			void this.loadTimeline(this.filePath);
		}));

		// Live-refresh events on Codex sheet changes touching this project (~400ms, matches codex-view.ts).
		let refreshTimer: number | null = null;
		const scheduleRefresh = (file?: TAbstractFile) => {
			if (file && isSafetyNetPath(file.path)) return;
			if (refreshTimer) window.clearTimeout(refreshTimer);
			refreshTimer = window.setTimeout(() => this.controller?.refresh(), 400);
		};
		this.registerEvent(this.app.metadataCache.on('changed', scheduleRefresh));
		this.registerEvent(this.app.vault.on('create', scheduleRefresh));
		this.registerEvent(this.app.vault.on('delete', scheduleRefresh));
		this.registerEvent(this.app.vault.on('rename', scheduleRefresh));

		// Our own file deleted while open: drop the stale drawing and offer a
		// fresh start instead of saving back into a file that no longer exists.
		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (!(file instanceof TFile) || file.path !== this.filePath) return;
			if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
			this.timelineData = null;
			this.renderMissingState(file.path);
		}));
	}

	async onClose(): Promise<void> {
		this.controller?.unmount();
		this.controller = null;
		await this.flushSave();
		this.contentEl.removeClass('sg-tl-view-root');
		this.contentEl.empty();
	}

	async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		// Obsidian hands a view opened through registerExtensions its path under
		// `file`, not `filePath` — reading only our own key meant clicking any
		// .timeline in the explorer never loaded through this path at all, and
		// fell back on the file-open listener's timing-dependent
		// most-recent-leaf guard. Symptom: the tab kept showing whichever
		// timeline was open before. Same `?? state['file']` fallback as
		// StorygridView.setState.
		const fp = (state?.filePath ?? state?.file) as string | undefined;
		if (typeof fp === 'string' && fp) await this.loadTimeline(fp);
	}

	getState(): Record<string, unknown> {
		return { filePath: this.filePath };
	}

	async onLoadFile(file: TFile): Promise<void> {
		await this.loadTimeline(file.path);
	}

	// ── Load & save ───────────────────────────────────────────────────────────

	async loadTimeline(filePath: string): Promise<void> {
		this.filePath = filePath;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			// A restored tab (or a stale link) pointing at a deleted timeline:
			// no error toast, no blank tab — one calm screen with one action.
			this.timelineData = null;
			this.renderMissingState(filePath);
			return;
		}
		try {
			const raw = await this.app.vault.read(file);
			this.timelineData = JSON.parse(raw) as TimelineData;
			this.renderAll();
		} catch {
			new Notice('Plotverk: This timeline file is corrupted.');
			this.timelineData = null;
			this.renderCorruptedState(file.name);
		}
	}

	/**
	 * JSON.parse failed on this .timeline file — leave it on disk untouched
	 * (no auto-repair/overwrite) and show an in-view explanation instead of a
	 * blank tab, mirroring the ghost-content empty state's wrap/icon/title/
	 * body structure in timeline-render.ts's syncEmptyState().
	 */
	private renderCorruptedState(fileName: string): void {
		this.controller?.unmount();
		this.controller = null;
		this.contentEl.empty();
		const wrap = this.contentEl.createDiv({ cls: 'sg-tl-error' });
		setPhosphorIcon(wrap.createDiv({ cls: 'sg-tl-error-icon' }), 'warning', '⚠');
		wrap.createEl('h3', { text: t('timeline.error.title') });
		wrap.createEl('p', { cls: 'sg-tl-error-body', text: t('timeline.error.body', { file: fileName }) });
	}

	/**
	 * The .timeline file this tab points at no longer exists (deleted, moved,
	 * or never created). Same wrap/icon/title/body structure as the corrupted
	 * state, plus ONE button that starts a fresh, empty timeline at the same
	 * path and loads it. Nothing is written until that button is pressed.
	 */
	private renderMissingState(filePath: string): void {
		this.controller?.unmount();
		this.controller = null;
		this.contentEl.empty();
		const fileName = filePath.split('/').pop() ?? filePath;
		const wrap = this.contentEl.createDiv({ cls: 'sg-tl-error' });
		setPhosphorIcon(wrap.createDiv({ cls: 'sg-tl-error-icon' }), 'calendar-x', '📅');
		wrap.createEl('h3', { text: t('timeline.missing.title') });
		wrap.createEl('p', { cls: 'sg-tl-error-body', text: t('timeline.missing.body', { file: fileName }) });
		const btn = wrap.createEl('button', { cls: 'sg-tl-empty-cta', text: t('timeline.missing.cta') });
		btn.addEventListener('click', () => void this.startFreshTimeline(filePath));
	}

	private async startFreshTimeline(filePath: string): Promise<void> {
		// The whole project folder is gone (a stale tab from a deleted project):
		// never resurrect that folder — close this tab and open the current
		// project's timeline instead.
		const parent = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
		if (parent && !(this.app.vault.getAbstractFileByPath(parent) instanceof TFolder)) {
			new Notice(t('timeline.missing.folderGone', { folder: parent }));
			this.leaf.detach();
			await this.plugin.openOrCreateTimeline();
			return;
		}
		const name = (filePath.split('/').pop() ?? 'Timeline').replace(/\.timeline$/i, '') || 'Timeline';
		try {
			const data = createEmptyTimeline(name, GREGORIAN_CALENDAR, this.plugin.settings.timelineAppearance);
			await this.app.vault.create(filePath, JSON.stringify(data, null, 2));
		} catch (err) {
			new Notice(`Plotverk: Could not create the timeline. ${err instanceof Error ? err.message : ''}`);
			return;
		}
		new Notice(t('timeline.missing.created'));
		await this.loadTimeline(filePath);
	}

	private renderAll(): void {
		this.controller?.unmount();
		this.contentEl.empty();
		if (!this.timelineData || !this.filePath) return;
		const projectRoot = this.projectRoot();
		this.controller = new TimelineController(this.plugin, this.contentEl, {
			getData: () => this.timelineData!,
			mutate: (updater) => {
				if (!this.timelineData) return;
				this.timelineData = updater(this.timelineData);
				this.scheduleSave();
			},
			getProjectRoot: () => projectRoot,
		});
		this.controller.mount();
	}

	private projectRoot(): string {
		if (!this.filePath) return '';
		const idx = this.filePath.lastIndexOf('/');
		return idx === -1 ? '' : this.filePath.slice(0, idx);
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => void this.flushSave(), 800);
	}

	private async flushSave(): Promise<void> {
		if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
		if (!this.timelineData || !this.filePath) return;
		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!(file instanceof TFile)) return;
		this._selfWrite = true;
		await this.app.vault.modify(file, JSON.stringify(this.timelineData, null, 2));
		this._selfWrite = false;
	}
}
