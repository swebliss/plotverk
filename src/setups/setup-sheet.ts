import { App, Component, FuzzySuggestModal, MarkdownRenderer, Menu, TFile } from 'obsidian';
import type { EntityInfo } from '../entities/entity-manager';
import { getKindSpec } from '../entities/entity-kinds';
import { CharacterField } from '../grid-data';
import { t } from '../i18n';
import { setPhosphorIcon } from '../utils/icons';
import { runSafely } from '../utils/report-error';
import { SetupIndex } from './setup-index';
import { PlaceLookups, markChapter, realizedHere, summarizeSetup } from './book-order';
import { STAGE_ICON, STAGE_ICON_WRITTEN, planLine, renderStage, stageLine, stageWord } from './stage';
import { SetupMark, encodeTarget, isPlanned } from './setup-marks';
import {
	SETUP_KIND, addLinkedId, ensureEntityId, entityById, readSetup, removeLinkedId, removeSetupMark, setLetGo,
} from './setup-store';

export interface SetupSheetHost {
	app: App;
	component: Component;
	setupIndex: SetupIndex;
	/** Every Codex entry the project can see. */
	entities: () => EntityInfo[];
	/** Open another Codex sheet in this Codex view. */
	openEntity: (file: TFile) => void;
	/** Open the sheet editor (Edit). */
	edit: () => void;
	/** Chapters of the book, when known. */
	lookups?: PlaceLookups;
	/** Open a grid and show one of its cards (a planned mark). */
	openCard?: (gridPath: string, cardId: string) => void;
}

/** Where a mark points, in words, and how to go there. */
interface ResolvedPlace {
	label: string;
	gone: boolean;
	open?: () => void;
}

function resolvePlace(host: SetupSheetHost, mark: SetupMark): ResolvedPlace {
	const target = mark.target;
	if (target.kind === 'text') {
		// A paragraph copied into another note: the copy in the book order wins.
		const lookups = host.lookups;
		const place = host.setupIndex.placeOf(target.anchor, lookups ? (p) => lookups.chapterOf(p) : undefined);
		const file = place ? host.app.vault.getAbstractFileByPath(place.path) : null;
		if (!place || !(file instanceof TFile)) return { label: t('setups.sheet.placeGone'), gone: true };
		const chapter = host.lookups ? markChapter(mark, host.lookups) : null;
		return {
			label: chapter !== null ? t('setups.place.chapter', { n: chapter }) : file.basename,
			gone: false,
			// A block link scrolls straight to the marked paragraph.
			open: () => void host.app.workspace.openLinkText(`${file.path}#^${target.anchor}`, '', false),
		};
	}
	if (target.kind === 'entity') {
		const entity = entityById(host.entities(), target.entityId);
		if (!entity) return { label: t('setups.sheet.placeGone'), gone: true };
		return { label: entity.name, gone: false, open: () => host.openEntity(entity.file) };
	}
	// A grid card: named by the words it was marked with (the card title).
	const gridPath = host.lookups?.gridPath?.(target.gridId) ?? null;
	const openCard = host.openCard;
	return {
		label: t('setups.sheet.cardPlace', { name: mark.quote || '…' }),
		gone: false,
		open: gridPath && openCard ? () => openCard(gridPath, target.cardId) : undefined,
	};
}

class LinkPickModal extends FuzzySuggestModal<EntityInfo> {
	constructor(app: App, private items: EntityInfo[], private onPick: (e: EntityInfo) => void) {
		super(app);
		this.setPlaceholder(t('setups.picker.placeholder'));
	}
	getItems(): EntityInfo[] {
		return this.items;
	}
	getItemText(e: EntityInfo): string {
		return `${e.name} (${getKindSpec(e.kind).singular})`;
	}
	onChooseItem(e: EntityInfo): void {
		this.onPick(e);
	}
}

/** Open the "Link to Codex" picker for a setup sheet. */
export function pickLinkForSetup(host: SetupSheetHost, file: TFile): void {
	const linked = new Set(readSetup(host.app, file).linkedIds);
	const items = host.entities().filter((e) => e.kind !== SETUP_KIND && e.file.path !== file.path && !(e.entityId && linked.has(e.entityId)));
	new LinkPickModal(host.app, items, (e) => {
		runSafely((async () => {
			const id = await ensureEntityId(host.app, e.file);
			await addLinkedId(host.app, file, id);
		})());
	}).open();
}

/**
 * A setup's sheet page below the Codex band: where it stands, its name and
 * description, notes, linked entries and every place it is written about.
 * A text page with small grey headings — no boxes (design v19). Parts with
 * nothing in them stay quiet: a new setup shows its name and an empty note.
 * Every change writes the sheet's properties; the Codex redraws itself when
 * Obsidian reports the changed sheet.
 */
export async function renderSetupSheet(
	page: HTMLElement,
	host: SetupSheetHost,
	file: TFile,
	name: string,
	fields: CharacterField[],
): Promise<void> {
	const info = readSetup(host.app, file, name);
	const body = page.createDiv({ cls: 'sg-setup-sheet' });
	// Finished setups (paid off, let go) read a little paler.
	body.toggleClass('is-done', info.state === 'paid-off' || info.state === 'let-go');

	// ── Stage · name · description ──────────────────────────────────────────
	const head = body.createDiv({ cls: 'sg-setup-sheet-head' });
	const stageRow = head.createDiv({ cls: 'sg-setup-sheet-stage' });
	const stageEl = renderStage(stageRow, info.state);
	if (host.lookups) {
		const summary = summarizeSetup(info.marks, info.state, host.lookups);
		const plan = info.state === 'planted' || info.state === 'reminded' ? summary.nextPlan : null;
		const word = stageEl.querySelector('.sg-setup-stage-word');
		if (!summary.writtenYet && plan) {
			// Only planned so far: "Plant planned for Chapter 3".
			stageRow.addClass('is-planned');
			word?.setText(planLine(plan));
		} else {
			word?.setText(stageLine(info.state, summary.stageChapter));
			if (plan) stageRow.createSpan({ cls: 'sg-setup-sheet-plan', text: planLine(plan) });
		}
	}
	if (info.later) stageRow.createSpan({ cls: 'sg-setup-sheet-later', text: t('setups.sheet.laterBook') });
	head.createEl('h2', { cls: 'sg-setup-sheet-title', text: name });
	const description = fields.find((f) => f.label === 'Description')?.value.trim() ?? '';
	if (description) {
		const what = head.createDiv({ cls: 'sg-setup-sheet-what' });
		await MarkdownRenderer.render(host.app, description, what, file.path, host.component);
	} else {
		quietButton(head, 'plus', t('setups.sheet.addDescription'), host.edit);
	}

	// ── Notes ───────────────────────────────────────────────────────────────
	const notes = fields.find((f) => f.label === 'Notes')?.value.trim() ?? '';
	const notesSec = section(body, t('setups.sheet.notes'));
	if (notes) {
		await MarkdownRenderer.render(host.app, notes, notesSec.createDiv({ cls: 'sg-setup-sheet-notes' }), file.path, host.component);
	} else {
		quietButton(notesSec, 'plus', t('setups.sheet.addNote'), host.edit);
	}

	// Any other field the writer added herself keeps its own titled part, so
	// nothing she wrote ever disappears from the page.
	for (const f of fields) {
		if (['Name', 'Description', 'Notes'].includes(f.label) || !f.value.trim()) continue;
		const sec = section(body, f.label);
		if (f.type === 'textarea' || f.type === 'text') {
			await MarkdownRenderer.render(host.app, f.value, sec.createDiv({ cls: 'sg-setup-sheet-notes' }), file.path, host.component);
		} else {
			sec.createDiv({ cls: 'sg-setup-sheet-notes', text: f.value });
		}
	}

	// ── Linked to ───────────────────────────────────────────────────────────
	const all = host.entities();
	const linkedSec = foldSection(body, 'linked', t('setups.sheet.linkedTo'), info.linkedIds.length);
	const linkedList = linkedSec.createDiv({ cls: 'sg-setup-list' });
	for (const id of info.linkedIds) {
		const entity = entityById(all, id);
		const row = linkedList.createDiv({ cls: 'sg-setup-row', attr: { role: 'button', tabindex: '0' } });
		if (entity) {
			const spec = getKindSpec(entity.kind);
			setPhosphorIcon(row.createSpan({ cls: 'sg-setup-row-icon' }), spec.icon, spec.fallbackIcon);
			row.createSpan({ cls: 'sg-setup-row-name', text: entity.name });
			row.createSpan({ cls: 'sg-setup-row-meta', text: spec.singular });
			onActivate(row, () => host.openEntity(entity.file));
		} else {
			row.addClass('is-gone');
			setPhosphorIcon(row.createSpan({ cls: 'sg-setup-row-icon' }), 'warning', '?');
			row.createSpan({ cls: 'sg-setup-row-name', text: t('setups.sheet.missingEntry') });
		}
		const label = t('setups.sheet.removeLink', { name: entity?.name ?? '' });
		row.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((i) => i.setTitle(label).setIcon('x').onClick(() => runSafely((async () => {
				await removeLinkedId(host.app, file, id);
			})())));
			menu.showAtMouseEvent(e);
		});
		const x = row.createEl('button', { cls: 'sg-setup-row-x clickable-icon', attr: { 'aria-label': label, title: label } });
		setPhosphorIcon(x, 'x', '×');
		x.addEventListener('click', (e) => {
			e.stopPropagation();
			runSafely((async () => {
				await removeLinkedId(host.app, file, id);
			})());
		});
	}
	quietButton(linkedList, 'plus', t('setups.sheet.linkToCodex'), () => pickLinkForSetup(host, file));

	// ── Where it's written about ────────────────────────────────────────────
	const placesSec = foldSection(body, 'places', t('setups.sheet.writtenAbout'), info.marks.length);
	if (info.marks.length === 0) {
		placesSec.createDiv({ cls: 'sg-setup-sheet-hint', text: t('setups.sheet.noMarksYet') });
	} else {
		// Written (in the text) first, then Planned (grid cards, timeline events).
		const written = info.marks.filter((m) => !isPlanned(m));
		const planned = info.marks.filter(isPlanned);
		const group = (title: string, hint?: string) => {
			const g = placesSec.createDiv({ cls: 'sg-setup-places-group' });
			g.createDiv({ cls: 'sg-setup-places-h', text: title });
			if (hint) g.createDiv({ cls: 'sg-setup-sheet-hint', text: hint });
			return g.createDiv({ cls: 'sg-setup-places' });
		};
		const writtenList = written.length ? group(t('setups.sheet.written')) : null;
		const plannedList = planned.length ? group(t('setups.sheet.planned'), t('setups.sheet.plannedHint')) : null;
		for (const mark of info.marks) {
			const plan = isPlanned(mark);
			const list = plan ? plannedList : writtenList;
			if (!list) continue;
			const place = resolvePlace(host, mark);
			const row = list.createDiv({ cls: 'sg-setup-place' });
			if (place.gone) row.addClass('is-gone');
			if (plan) row.addClass('is-planned');
			const top = row.createDiv({ cls: 'sg-setup-place-top' });
			const iconEl = top.createSpan({ cls: 'sg-setup-stage-icon' });
			setPhosphorIcon(iconEl, STAGE_ICON[mark.stage], '•');
			const words = top.createSpan({ cls: 'sg-setup-place-words' });
			if (plan && !place.gone) {
				// "Payoff planned for Chapter 12" — or for the card / event itself when it has no chapter.
				const chapter = host.lookups ? markChapter(mark, host.lookups) : null;
				words.appendText(planLine({ stage: mark.stage, chapter, label: place.label }));
				if (host.lookups && realizedHere(mark, info.marks, host.lookups)) {
					// The plan is on the page: the filled icon, as on the grid card and in its editor.
					row.addClass('is-written');
					setPhosphorIcon(iconEl, STAGE_ICON_WRITTEN[mark.stage], '•');
					top.createSpan({ cls: 'sg-setup-place-done', text: t('setups.sheet.writtenHere') });
				}
			} else {
				words.createEl('b', { text: stageWord(mark.stage) });
				words.appendText(' ');
				words.appendText(place.gone ? `· ${place.label}` : t('setups.sheet.inPlace', { place: place.label }));
			}
			if (mark.quote) row.createDiv({ cls: 'sg-setup-place-quote', text: mark.quote });
			if (place.open) {
				row.setAttrs({ role: 'button', tabindex: '0' });
				onActivate(row, place.open);
			}
			row.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((i) => i.setTitle(t('setups.sheet.removeMark')).setIcon('x').onClick(() => runSafely((async () => {
					await removeSetupMark(host.app, file, mark);
				})())));
				menu.showAtMouseEvent(e);
			});
			row.dataset.target = encodeTarget(mark.target);
		}
	}

	// ── Let it go / Pick it up again ────────────────────────────────────────
	if (info.state !== 'paid-off') {
		const letGo = info.state === 'let-go';
		quietButton(body, letGo ? 'arrows-clockwise' : 'wind', t(letGo ? 'setups.sheet.pickUp' : 'setups.sheet.letGo'), () => runSafely((async () => {
			await setLetGo(host.app, file, !letGo);
		})()));
	}
}

function section(parent: HTMLElement, title: string, count?: number): HTMLElement {
	const sec = parent.createDiv({ cls: 'sg-setup-sheet-section' });
	const h = sec.createDiv({ cls: 'sg-setup-sheet-h' });
	h.createSpan({ text: title });
	if (count) h.createSpan({ cls: 'sg-setup-sheet-count', text: String(count) });
	return sec;
}

/** Which folded sections the writer opened (kept while Obsidian is open, across redraws and sheets). */
const openSections = new Set<string>();
let foldSeq = 0;

/**
 * A section folded by default (Emma 2026-11-24: "clean and not overwhelming"):
 * the title with its count is a button; the contents show only once opened.
 * Returns the element the contents go into.
 */
function foldSection(parent: HTMLElement, key: string, title: string, count: number): HTMLElement {
	const sec = parent.createDiv({ cls: 'sg-setup-sheet-section sg-setup-fold' });
	const open = openSections.has(key);
	const h = sec.createEl('button', {
		cls: 'sg-setup-sheet-h sg-setup-fold-h',
		attr: { type: 'button', 'aria-expanded': String(open) },
	});
	const caret = h.createSpan({ cls: 'sg-setup-fold-caret' });
	h.createSpan({ text: title });
	if (count) h.createSpan({ cls: 'sg-setup-sheet-count', text: String(count) });
	const content = sec.createDiv({ cls: 'sg-setup-fold-body' });
	content.id = `sg-setup-fold-${++foldSeq}`;
	h.setAttribute('aria-controls', content.id);
	const set = (o: boolean) => {
		content.toggle(o);
		h.setAttribute('aria-expanded', String(o));
		caret.empty();
		setPhosphorIcon(caret, o ? 'caret-down' : 'caret-right', o ? '▾' : '▸');
		sec.toggleClass('is-open', o);
	};
	set(open);
	h.addEventListener('click', () => {
		const o = !openSections.has(key);
		if (o) openSections.add(key);
		else openSections.delete(key);
		set(o);
	});
	return content;
}

function quietButton(parent: HTMLElement, icon: string, text: string, onClick: () => void): HTMLElement {
	const btn = parent.createEl('button', { cls: 'sg-setup-quiet' });
	setPhosphorIcon(btn.createSpan({ cls: 'sg-setup-quiet-icon' }), icon, '+');
	btn.createSpan({ text });
	btn.addEventListener('click', onClick);
	return btn;
}

function onActivate(el: HTMLElement, run: () => void): void {
	el.addEventListener('click', run);
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			run();
		}
	});
}
