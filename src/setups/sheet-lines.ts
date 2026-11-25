import { App, TFile } from 'obsidian';
import type { EntityInfo } from '../entities/entity-manager';
import { createEntityFile } from '../entities/entity-manager';
import { getKindSpec, instantiateFields } from '../entities/entity-kinds';
import { t } from '../i18n';
import { TextPromptModal } from '../modals/prompt-modal';
import { setPhosphorIcon } from '../utils/icons';
import { runSafely } from '../utils/report-error';
import { PlaceLookups } from './book-order';
import { STAGE_ICON, stageWord } from './stage';
import { SETUP_KIND, initSetup, listSetups } from './setup-store';

export interface SheetLinesHost {
	app: App;
	/** The sheet being shown. */
	file: TFile;
	name: string;
	entityId: string;
	/** The book the sheet belongs to (where a new setup is made). */
	root: string;
	/** Codex entries of the sheet's own book or series. */
	bookEntities: EntityInfo[];
	lookups: PlaceLookups;
	/** Notes linking to this entry. */
	scenes: readonly string[];
	openSetup: (file: TFile) => void;
	openNote: (path: string) => void;
}

const FOLD_AFTER = 3;

/**
 * Two quiet lists on every Codex sheet (Emma approved 2026-11-20): the setups
 * this entry is linked to, and the scenes it is mentioned in. No box, no
 * badge: a small grey title with a count, one slim line each, three lines
 * first and the rest behind "Show all". Side by side on a computer, stacked
 * on a phone (CSS).
 */
export function renderSheetLines(parent: HTMLElement, host: SheetLinesHost): void {
	const wrap = parent.createDiv({ cls: 'sg-sheet-lines' });

	// ── Setups ──────────────────────────────────────────────────────────────
	const setups = listSetups(host.app, host.bookEntities)
		.filter((s) => s.linkedIds.includes(host.entityId))
		.sort((a, b) => Number(a.state === 'paid-off' || a.state === 'let-go') - Number(b.state === 'paid-off' || b.state === 'let-go') || a.name.localeCompare(b.name));
	const setupPart = part(wrap, t('setups.lines.title'), setups.length);
	foldedList(setupPart, setups, (row, s) => {
		if (s.state === 'paid-off' || s.state === 'let-go') row.addClass('is-done');
		setPhosphorIcon(row.createSpan({ cls: 'sg-sheet-line-icon' }), STAGE_ICON[s.state], '•');
		row.createSpan({ cls: 'sg-sheet-line-name', text: s.name });
		row.createSpan({ cls: 'sg-sheet-line-meta', text: stageWord(s.state) });
		return () => host.openSetup(s.file);
	});
	const add = setupPart.createEl('button', { cls: 'sg-sheet-line-add' });
	setPhosphorIcon(add.createSpan({ cls: 'sg-sheet-line-icon' }), 'plus', '+');
	add.createSpan({ text: t('setups.lines.add') });
	add.addEventListener('click', () => {
		new TextPromptModal(host.app, t('setups.lines.addTitle', { name: host.name }), '', (value) => {
			const name = value.trim();
			if (!name) return;
			runSafely((async () => {
				const fields = instantiateFields(getKindSpec(SETUP_KIND).defaultFields, name);
				const sheet = await createEntityFile(host.app, host.root, SETUP_KIND, name, fields);
				await initSetup(host.app, sheet, { mark: null, linkedIds: [host.entityId], later: false });
			})());
		}).open();
	});

	// ── Mentioned in these scenes ───────────────────────────────────────────
	const scenes = host.scenes
		.map((path) => {
			const file = host.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile) || file.path === host.file.path) return null;
			// Only scenes and other notes, never another Codex sheet linking here.
			if (host.bookEntities.some((e) => e.file.path === path)) return null;
			const links = host.app.metadataCache.getFileCache(file)?.links ?? [];
			const count = links.filter((l) => host.app.metadataCache.getFirstLinkpathDest(l.link.split('#')[0], file.path)?.path === host.file.path).length;
			return { file, chapter: host.lookups.chapterOf(path), count: Math.max(1, count) };
		})
		.filter((x): x is { file: TFile; chapter: number | null; count: number } => x !== null)
		.sort((a, b) => {
			if (a.chapter !== null && b.chapter !== null) return a.chapter - b.chapter;
			if ((a.chapter === null) !== (b.chapter === null)) return a.chapter === null ? 1 : -1;
			return a.file.basename.localeCompare(b.file.basename);
		});
	if (scenes.length > 0) {
		const scenePart = part(wrap, t('setups.scenes.title'), scenes.length);
		foldedList(scenePart, scenes, (row, sc) => {
			row.createSpan({
				cls: 'sg-sheet-line-name',
				text: sc.chapter !== null ? t('setups.place.chapterScene', { n: sc.chapter, name: sc.file.basename }) : sc.file.basename,
			});
			row.createSpan({ cls: 'sg-sheet-line-meta', text: sc.count === 1 ? t('setups.scenes.mentionsOne') : t('setups.scenes.mentionsOther', { n: sc.count }) });
			return () => host.openNote(sc.file.path);
		});
	}
}

function part(parent: HTMLElement, title: string, count: number): HTMLElement {
	const el = parent.createDiv({ cls: 'sg-sheet-lines-part' });
	const h = el.createDiv({ cls: 'sg-sheet-lines-h' });
	h.createSpan({ text: title });
	if (count) h.createSpan({ cls: 'sg-sheet-lines-count', text: String(count) });
	return el;
}

/** Three lines, then "Show all N" / "Show fewer". */
function foldedList<T>(parent: HTMLElement, items: T[], draw: (row: HTMLElement, item: T) => () => void): void {
	const list = parent.createDiv({ cls: 'sg-sheet-lines-list' });
	let open = false;
	const render = () => {
		list.empty();
		const shown = open ? items : items.slice(0, FOLD_AFTER);
		for (const item of shown) {
			const row = list.createDiv({ cls: 'sg-sheet-line', attr: { role: 'button', tabindex: '0' } });
			const go = draw(row, item);
			row.addEventListener('click', go);
			row.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					go();
				}
			});
		}
		if (items.length > FOLD_AFTER) {
			const more = list.createEl('button', { cls: 'sg-sheet-line-more', attr: { 'aria-expanded': String(open) } });
			more.setText(open ? t('setups.lines.showFewer') : t('setups.lines.showAll', { n: items.length }));
			more.addEventListener('click', () => {
				open = !open;
				render();
			});
		}
	};
	render();
}
