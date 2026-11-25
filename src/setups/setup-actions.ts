import { Editor, MarkdownFileInfo, MarkdownView, Menu, Notice, TFile } from 'obsidian';
import type StorygridPlugin from '../main';
import { createEntityFile, EntityInfo } from '../entities/entity-manager';
import { getKindSpec, instantiateFields } from '../entities/entity-kinds';
import { findMentions } from '../refs/matcher';
import { scopeToBook } from '../refs/project-scope';
import { t } from '../i18n';
import { editorView } from '../utils/obsidian-internals';
import { reportError, runSafely } from '../utils/report-error';
import { applyAnchorPlan, newAnchorId, planAnchor } from './anchors';
import { DraftStore, PickableSetup, nameFromSelection, pickRows, relocate, wikilinkTargets } from './picker';
import { MarkTarget, SetupMark, SetupStage, SetupState, cleanQuote, isPlanned } from './setup-marks';
import { SETUP_KIND, SetupInfo, addSetupMark, ensureEntityId, initSetup, readSetup, removeSetupPlan, setupDescription } from './setup-store';
import { CardSetupLine, PlaceLookups, setupsOnCard, summarizeSetup } from './book-order';
import { openFor, planLine, stageLine } from './stage';
import { LinkChoice, PickWindow, PlantDraft, PlantWindow, WindowPlace } from './setup-windows';

/** A setup the picker can show, with its sheet. */
interface SetupChoice extends PickableSetup {
	file: TFile;
}

/** Selected words in an open note. */
interface TextSpot {
	file: TFile;
	editor: Editor;
	/** The selected words, as written. */
	words: string;
	/** Offset of the first selected character that is not a space. */
	from: number;
	to: number;
	/** Is the pane still showing this note (the writer may have opened another one in it)? */
	showsNote: () => boolean;
}

/** What gets marked: selected words, a grid card, or a Codex sheet (a timeline event). */
type MarkSource =
	| { kind: 'text'; spot: TextSpot }
	| { kind: 'fixed'; target: () => Promise<MarkTarget>; quote: string };

interface OpenWindow {
	close(keep: boolean): void;
	isOpen: boolean;
}

/**
 * Plant / Remind / Pay off: the right-click lines, the commands and what
 * happens on Enter. The sheet is made first and the tag written into the text
 * second, so a failed save never leaves a stray tag in a scene.
 */
export class SetupActions {
	private plantDrafts = new DraftStore<PlantDraft>();
	private pickDrafts = new DraftStore<string>();
	private current: OpenWindow | null = null;
	/** Counts window requests, so a Remind / Pay off window still loading never replaces a newer one. */
	private openings = 0;
	/** A sheet made by a plant whose last write failed (its tag is in the text), by draft key — reused on the next try. */
	private unfinished = new Map<string, TFile>();
	/** Is the open window's pane still showing what it was opened on? */
	private stillThere: (() => boolean) | null = null;
	/** Setups moved to a new column this session: where they came from, and whether the board showed it yet. */
	private moves = new Map<string, { from: SetupStage; to: SetupStage; shown: boolean }>();

	constructor(private plugin: StorygridPlugin) {}

	private get app() {
		return this.plugin.app;
	}

	// ─── Registration ───────────────────────────────────────────────────────

	register(): void {
		const plugin = this.plugin;
		plugin.registerEvent(
			plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				if (!editor.getSelection().trim()) return;
				menu.addItem((item) => item.setTitle(t('setups.menu.plant')).setIcon('sprout').setSection('plotverk-setups')
					.onClick(() => this.plantFromEditor(editor, info)));
				menu.addItem((item) => item.setTitle(t('setups.menu.remind')).setIcon('bell').setSection('plotverk-setups')
					.onClick(() => this.pickFromEditor(editor, info, 'reminded')));
				menu.addItem((item) => item.setTitle(t('setups.menu.payOff')).setIcon('badge-check').setSection('plotverk-setups')
					.onClick(() => this.pickFromEditor(editor, info, 'paid-off')));
			})
		);
		plugin.addCommand({
			id: 'plant-setup',
			name: t('setups.menu.plant'),
			editorCallback: (editor, info) => this.plantFromEditor(editor, info),
		});
		plugin.addCommand({
			id: 'remind-setup',
			name: t('setups.menu.remind'),
			editorCallback: (editor, info) => this.pickFromEditor(editor, info, 'reminded'),
		});
		plugin.addCommand({
			id: 'pay-off-setup',
			name: t('setups.menu.payOff'),
			editorCallback: (editor, info) => this.pickFromEditor(editor, info, 'paid-off'),
		});
		// The pane now shows another note (or was closed): the window goes, its draft stays.
		const closeIfGone = () => {
			if (this.current?.isOpen && this.stillThere && !this.stillThere()) this.current.close(true);
		};
		plugin.registerEvent(plugin.app.workspace.on('file-open', closeIfGone));
		plugin.registerEvent(plugin.app.workspace.on('layout-change', closeIfGone));
		plugin.register(() => this.current?.close(true));
	}

	// ─── Entry points ───────────────────────────────────────────────────────

	plantFromEditor(editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
		const spot = this.textSpot(editor, info);
		if (!spot) return;
		const root = this.rootFor(spot.file.path);
		if (root === null) return;
		const key = DraftStore.key('plant', spot.file.path, spot.words);
		this.openPlant({
			place: this.editorPlace(spot, info),
			key,
			startName: nameFromSelection(spot.words),
			notePath: spot.file.path,
			words: spot.words,
			root,
			source: { kind: 'text', spot },
		});
	}

	pickFromEditor(editor: Editor, info: MarkdownView | MarkdownFileInfo, mode: 'reminded' | 'paid-off'): void {
		const spot = this.textSpot(editor, info);
		if (!spot) return;
		if (this.rootFor(spot.file.path) === null) return;
		void this.openPick({
			place: this.editorPlace(spot, info),
			key: DraftStore.key(mode, spot.file.path, spot.words),
			notePath: spot.file.path,
			mode,
			source: { kind: 'text', spot },
		});
	}

	/** "Plant a setup" on a Plot Grid card: the card itself is the place. */
	plantFromCard(host: HTMLElement, anchor: Element, gridFile: TFile, gridId: string, card: { id: string; title: string }): void {
		const root = this.rootFor(gridFile.path);
		if (root === null) return;
		const title = card.title.trim();
		this.openPlant({
			place: elementPlace(host, anchor),
			key: DraftStore.key('plant', gridFile.path, card.id),
			startName: title,
			notePath: gridFile.path,
			words: title,
			root,
			source: { kind: 'fixed', target: () => Promise.resolve({ kind: 'card', gridId, cardId: card.id }), quote: title },
		});
	}

	/**
	 * "Remind of a setup" / "Pay off a setup" on a Plot Grid card: a PLAN for
	 * that card's scene. The setup's stage moves only once it is written in the text.
	 */
	pickFromCard(
		host: HTMLElement, anchor: Element, gridFile: TFile, gridId: string,
		card: { id: string; title: string; linkedDocPath?: string }, mode: 'reminded' | 'paid-off',
	): void {
		if (this.rootFor(gridFile.path) === null) return;
		const title = card.title.trim();
		runSafely(this.openPick({
			place: elementPlace(host, anchor),
			key: DraftStore.key(mode, gridFile.path, card.id),
			notePath: gridFile.path,
			scenePath: card.linkedDocPath || null,
			mode,
			source: { kind: 'fixed', target: () => Promise.resolve({ kind: 'card', gridId, cardId: card.id }), quote: title },
		}));
	}

	/** "Remind of a setup" / "Pay off a setup" on a Timeline event: a plan, like a card's. */
	pickFromEntity(host: HTMLElement, anchor: Element, file: TFile, mode: 'reminded' | 'paid-off'): void {
		if (this.rootFor(file.path) === null) return;
		runSafely(this.openPick({
			place: elementPlace(host, anchor),
			key: DraftStore.key(mode, file.path, ''),
			notePath: file.path,
			scenePath: null,
			mode,
			source: {
				kind: 'fixed',
				target: async () => ({ kind: 'entity', entityId: await ensureEntityId(this.app, file) }),
				quote: file.basename,
			},
		}));
	}

	/** "Plant a setup" on a Codex sheet shown elsewhere (a Timeline event). */
	plantFromEntity(host: HTMLElement, anchor: Element, file: TFile): void {
		const root = this.rootFor(file.path);
		if (root === null) return;
		this.openPlant({
			place: elementPlace(host, anchor),
			key: DraftStore.key('plant', file.path, ''),
			startName: file.basename,
			notePath: file.path,
			words: `[[${file.basename}]]`,
			root,
			source: {
				kind: 'fixed',
				target: async () => ({ kind: 'entity', entityId: await ensureEntityId(this.app, file) }),
				quote: file.basename,
			},
		});
	}

	// ─── Plans on grid cards (card editor + card marker) ──────────────────────

	/**
	 * Every setup step planned on each card of one grid, by card id (cards with
	 * none are left out). "Written" = that stage is marked in the text of the
	 * scene the card is linked to. Reads only the metadata cache — cheap enough
	 * for every grid redraw.
	 */
	setupsOnGrid(
		gridFile: TFile, gridId: string, cards: readonly { id: string; linkedDocPath?: string }[],
	): Map<string, CardSetupLine<SetupInfo>[]> {
		const out = new Map<string, CardSetupLine<SetupInfo>[]>();
		if (!gridId || this.plugin.entityIndex.rootFor(gridFile.path) === null) return out;
		const setups = this.bookEntities(gridFile.path)
			.filter((e) => e.kind === SETUP_KIND)
			.map((e) => readSetup(this.app, e.file, e.name))
			.filter((s) => s.marks.some((m) => m.target.kind === 'card' && m.target.gridId === gridId));
		if (setups.length === 0) return out;
		const scenes = new Map(cards.map((c) => [c.id, c.linkedDocPath || null]));
		const lk: PlaceLookups = {
			anchorPath: (anchor) => this.plugin.setupIndex.placeOf(anchor)?.path ?? null,
			cardScene: (g, c) => (g === gridId ? scenes.get(c) ?? null : null),
			entityScenes: (id) => this.plugin.referenceIndex.getEntityScenes(id),
			chapterOf: () => null,
		};
		for (const card of cards) {
			const lines = setupsOnCard(setups, gridId, card.id, lk);
			if (lines.length) out.set(card.id, lines);
		}
		return out;
	}

	/** Take one plan off a card again (the × in the card editor). The text is never touched. */
	async removePlan(setupFile: TFile, mark: SetupMark): Promise<void> {
		if (!isPlanned(mark)) return;
		await removeSetupPlan(this.app, setupFile, mark);
	}

	/** Open a setup's sheet in the Codex. */
	openSheet(setupFile: TFile): void {
		const root = this.plugin.entityIndex.rootFor(setupFile.path) ?? undefined;
		this.plugin.openCodex(root, setupFile.path).catch(reportError);
	}

	// ─── Plant ──────────────────────────────────────────────────────────────

	private openPlant(o: {
		place: WindowPlace; key: string; startName: string; notePath: string; words: string; root: string; source: MarkSource;
	}): void {
		this.current?.close(true);
		this.openings++;
		const entities = this.bookEntities(o.notePath).filter((e) => e.kind !== SETUP_KIND && e.entityId);
		const choice = (e: EntityInfo): LinkChoice => ({ id: e.entityId as string, name: e.name, kindWord: getKindSpec(e.kind).singular });
		const draft: PlantDraft = this.plantDrafts.get(o.key) ?? {
			name: o.startName, description: '', descriptionOpen: false, linkOpen: false, linked: [], later: false, touched: false,
		};
		this.stillThere = o.place.alive ?? null;
		this.current = new PlantWindow({
			place: o.place,
			draft,
			suggested: this.mentioned(o.words, o.notePath, entities).map(choice),
			search: (query) => {
				const q = query.toLocaleLowerCase();
				return entities
					.filter((e) => e.name.toLocaleLowerCase().includes(q))
					.sort((a, b) =>
						Number(b.name.toLocaleLowerCase().startsWith(q)) - Number(a.name.toLocaleLowerCase().startsWith(q)) ||
						a.name.localeCompare(b.name))
					.map(choice);
			},
			onClose: (kept) => {
				if (kept) this.plantDrafts.set(o.key, kept);
				else this.plantDrafts.delete(o.key);
			},
			onPlant: (done) => {
				runSafely(this.plant(o.key, o.root, o.source, done).then((planted) => {
					// Refused (the "can't mark here" notice is showing): the draft comes back next time.
					if (!planted) this.plantDrafts.set(o.key, done);
				}, (err) => {
					// Nothing is lost: the draft comes back the next time the window opens.
					this.plantDrafts.set(o.key, done);
					throw err;
				}));
			},
		});
	}

	/**
	 * Make the sheet, then mark the place. When the place cannot be marked
	 * (refused, or the write failed) the new sheet goes to the trash again, so
	 * trying once more never leaves a stray "Name 2". When only the sheet's own
	 * write failed, the next try on the same words reuses that sheet. False
	 * when refused.
	 */
	private async plant(key: string, root: string, source: MarkSource, draft: PlantDraft): Promise<boolean> {
		const left = this.unfinished.get(key);
		this.unfinished.delete(key);
		let sheet: TFile;
		const reused = !!left && this.app.vault.getAbstractFileByPath(left.path) === left;
		if (left && reused) {
			sheet = left;
		} else {
			const fields = instantiateFields(getKindSpec(SETUP_KIND).defaultFields, draft.name);
			const description = fields.find((f) => f.label === 'Description');
			if (description) description.value = draft.description;
			sheet = await createEntityFile(this.app, root, SETUP_KIND, draft.name, fields);
		}
		// Only a sheet made in this attempt goes back to the trash; a remembered
		// one from an earlier try stays remembered for the next.
		const giveUp = async () => {
			if (reused) this.unfinished.set(key, sheet);
			else await this.discardSheet(sheet);
		};
		let target: MarkTarget | null;
		try {
			target = await this.targetFor(source);
		} catch (err) {
			await giveUp();
			throw err;
		}
		if (!target) {
			await giveUp();
			return false;
		}
		try {
			await initSetup(this.app, sheet, {
				mark: { stage: 'planted', target, quote: quoteOf(source) },
				linkedIds: draft.linked.map((l) => l.id),
				later: draft.later,
			});
		} catch (err) {
			// The tag is already in the text: keep the sheet for the next try.
			this.unfinished.set(key, sheet);
			throw err;
		}
		this.notice(t(isPlanned({ stage: 'planted', target, quote: '' }) ? 'setups.notice.plantPlanned' : 'setups.notice.planted', { name: sheet.basename }), sheet);
		return true;
	}

	/** Put a sheet made a moment ago back in the trash (a failed plant). */
	private async discardSheet(sheet: TFile): Promise<void> {
		try {
			await this.app.fileManager.trashFile(sheet);
		} catch (err) {
			console.warn('Plotverk: could not remove an unused setup sheet', err);
		}
	}

	// ─── Remind / Pay off ───────────────────────────────────────────────────

	/** `scenePath`: the scene a card is linked to — it decides "open for N chapters" and who is in the scene. */
	private async openPick(o: {
		place: WindowPlace; key: string; notePath: string; scenePath?: string | null; mode: 'reminded' | 'paid-off'; source: MarkSource;
	}): Promise<void> {
		const scene = o.scenePath || o.notePath;
		this.current?.close(true);
		const opening = ++this.openings;
		const root = this.plugin.entityIndex.rootFor(o.notePath);
		const lookups = root !== null ? await this.plugin.setupPlaces.lookups(root).catch(() => null) : null;
		// Another window was asked for while the book order was read: the newer one wins.
		if (opening !== this.openings) return;
		// The pane may have moved on while the book order was read.
		if (!o.place.host.isConnected || (o.place.alive && !o.place.alive())) return;
		// The chapter being written (the last chapter when the note is not a scene).
		const here = lookups ? (lookups.chapterOf(scene) ?? (lookups.orderedPaths.length || null)) : null;
		const setups: SetupChoice[] = this.bookEntities(o.notePath)
			.filter((e) => e.kind === SETUP_KIND)
			.map((e) => {
				const info = readSetup(this.app, e.file, e.name);
				let where = '';
				if (lookups) {
					const summary = summarizeSetup(info.marks, info.state, lookups);
					const parts = [!summary.writtenYet && summary.nextPlan ? planLine(summary.nextPlan, true) : stageLine(info.state, summary.stageChapter, true)];
					if (info.later) parts.push(t('setups.forLaterBook'));
					else if (summary.plantedChapter !== null && here !== null) parts.push(openFor(Math.max(0, here - summary.plantedChapter)));
					where = parts.join(' · ');
				}
				return {
					file: e.file, path: e.file.path, name: e.name, state: info.state, linkedIds: info.linkedIds,
					description: setupDescription(this.app, e.file), later: info.later, where,
				};
			});
		// Who and what this scene already links to: a setup tied to one of them comes first.
		const inScene = new Map<string, string>();
		const byId = new Map(this.plugin.entityIndex.getAllEntities().filter((e) => e.entityId).map((e) => [e.entityId as string, e.name]));
		for (const id of this.plugin.referenceIndex.getSceneMentions(scene)) {
			const name = byId.get(id);
			if (name) inScene.set(id, name);
		}
		const noneOpen = pickRows(setups, '', inScene).length === 0;
		this.stillThere = o.place.alive ?? null;
		this.current = new PickWindow<SetupChoice>({
			place: o.place,
			mode: o.mode,
			query: this.pickDrafts.get(o.key) ?? '',
			noneOpen,
			rows: (query) => pickRows(setups, query, inScene),
			onClose: (kept) => {
				if (kept) this.pickDrafts.set(o.key, kept);
				else this.pickDrafts.delete(o.key);
			},
			onPick: (setup) => runSafely(this.mark(setup, o.mode, o.source)),
		});
	}

	private async mark(setup: SetupChoice, stage: SetupStage, source: MarkSource): Promise<void> {
		const target = await this.targetFor(source);
		if (!target) return;
		const before = setup.state;
		const mark = { stage, target, quote: quoteOf(source) };
		await addSetupMark(this.app, setup.file, mark);
		// A plan never moves the setup on the board: only the text does.
		if (isPlanned(mark)) {
			this.notice(t(stage === 'paid-off' ? 'setups.notice.payPlanned' : 'setups.notice.remindPlanned', { name: setup.name }), setup.file);
			return;
		}
		const rank = (s: string) => ['planted', 'reminded', 'paid-off'].indexOf(s);
		if (before !== 'let-go' && rank(stage) > rank(before)) this.moves.set(setup.file.path, { from: before, to: stage, shown: false });
		this.notice(t(stage === 'paid-off' ? 'setups.notice.paidOff' : 'setups.notice.reminded', { name: setup.name }), setup.file);
	}

	/**
	 * The stage a setup moved here from during this session (for "Moved here
	 * from …" on the board). Only while it still stands where that move put it:
	 * once the mark is removed, it is let go, or it moves on, the line goes.
	 */
	movedFrom(path: string, state: SetupState): SetupStage | null {
		return this.liveMove(path, state)?.from ?? null;
	}

	/** True once per move: the first time the board shows it, the card slides in. */
	takeArrival(path: string, state: SetupState): boolean {
		const move = this.liveMove(path, state);
		if (!move || move.shown) return false;
		move.shown = true;
		return true;
	}

	private liveMove(path: string, state: SetupState): { from: SetupStage; to: SetupStage; shown: boolean } | null {
		const move = this.moves.get(path);
		if (!move) return null;
		if (move.to !== state) {
			this.moves.delete(path);
			return null;
		}
		return move;
	}

	// ─── Shared ─────────────────────────────────────────────────────────────

	/** The selected words, or a notice saying why nothing can be marked here. */
	private textSpot(editor: Editor, info: MarkdownView | MarkdownFileInfo): TextSpot | null {
		const file = info.file;
		const words = editor.getSelection();
		if (!file || !words.trim()) {
			new Notice(t('setups.notice.selectFirst'));
			return null;
		}
		const start = editor.posToOffset(editor.getCursor('from'));
		const lead = words.length - words.trimStart().length;
		const from = start + lead;
		const spot: TextSpot = { file, editor, words: words.trim(), from, to: from + words.trim().length, showsNote: () => info.file === file };
		if (planAnchor(editor.getValue(), from, () => 'pv-000000').kind === 'refuse') {
			new Notice(t('setups.notice.cantMarkHere'));
			return null;
		}
		return spot;
	}

	private rootFor(path: string): string | null {
		const root = this.plugin.entityIndex.rootFor(path);
		if (root === null) new Notice(t('setups.notice.noProject'));
		return root;
	}

	/** Codex entries of the note's own book or series (the same rule the @ picker uses). */
	private bookEntities(notePath: string): EntityInfo[] {
		return scopeToBook(this.plugin.entityIndex.getAllEntities(), notePath, (e) => ({ path: e.file.path, kind: e.kind }));
	}

	/** Entries the marked words link to or name — offered, never added by themselves. */
	private mentioned(words: string, notePath: string, entities: EntityInfo[]): EntityInfo[] {
		const found: EntityInfo[] = [];
		const add = (e: EntityInfo | undefined) => {
			if (e && !found.includes(e)) found.push(e);
		};
		for (const target of wikilinkTargets(words)) {
			const dest = this.app.metadataCache.getFirstLinkpathDest(target, notePath);
			if (dest) add(entities.find((e) => e.file.path === dest.path));
		}
		try {
			const matchable = this.plugin.referenceIndex.buildMatchableEntitiesFor(notePath);
			for (const hit of findMentions(nameFromSelection(words, 2000), matchable)) {
				if (!hit.isCommonWord) add(entities.find((e) => e.entityId === hit.entityId));
			}
		} catch (err) {
			// A suggestion is a nicety: never let it stop the window from opening.
			console.warn('Plotverk: could not read mentions for a setup', err);
		}
		return found.slice(0, 3);
	}

	private editorPlace(spot: TextSpot, info: MarkdownView | MarkdownFileInfo): WindowPlace {
		const view = editorView(spot.editor);
		const host = info instanceof MarkdownView ? info.containerEl : (view?.dom.closest<HTMLElement>('.workspace-leaf-content') ?? view?.dom.parentElement ?? activeDocument.body);
		return {
			host: positioned(host),
			rect: () => {
				if (!view || !view.dom.isConnected || !spot.showsNote()) return null;
				const max = view.state.doc.length;
				const a = view.coordsAtPos(Math.min(spot.from, max));
				const b = view.coordsAtPos(Math.min(spot.to, max));
				if (!a || !b) return null;
				return new DOMRect(a.left, a.top, 1, Math.max(b.bottom, a.bottom) - a.top);
			},
			scrollers: view ? [view.scrollDOM] : [],
			alive: () => !!view?.dom.isConnected && spot.showsNote(),
			refocus: () => {
				if (view?.dom.isConnected) spot.editor.focus();
			},
		};
	}

	/** Where the mark points; for text this writes (or reuses) the paragraph's tag. */
	private async targetFor(source: MarkSource): Promise<MarkTarget | null> {
		if (source.kind === 'fixed') return source.target();
		const anchor = await this.tagParagraph(source.spot);
		return anchor ? { kind: 'text', anchor } : null;
	}

	/**
	 * Write the paragraph's tag and return its id (or the id already there).
	 * Through the open editor when it is still there — one undo step, cursor
	 * untouched; straight to the file when the note was closed meanwhile.
	 */
	private async tagParagraph(spot: TextSpot): Promise<string | null> {
		const makeId = (doc: string) => () => newAnchorId((id) => doc.includes(id) || this.plugin.setupIndex.isTaken(id));
		const view = editorView(spot.editor);
		// The marked words were changed or deleted while the window was open:
		// never tag whatever paragraph sits at their old place now.
		if (view?.dom.isConnected && spot.showsNote()) {
			const doc = spot.editor.getValue();
			const at = relocate(doc, spot.words, spot.from);
			const plan = at === null ? null : planAnchor(doc, at, makeId(doc));
			if (!plan || plan.kind === 'refuse') {
				new Notice(t('setups.notice.cantMarkHere'));
				return null;
			}
			if (plan.kind === 'insert') view.dispatch({ changes: { from: plan.from, to: plan.to, insert: plan.insert } });
			return plan.id;
		}
		let id: string | null = null;
		await this.app.vault.process(spot.file, (doc) => {
			const at = relocate(doc, spot.words, spot.from);
			const plan = at === null ? null : planAnchor(doc, at, makeId(doc));
			if (!plan || plan.kind === 'refuse') return doc;
			id = plan.id;
			return applyAnchorPlan(doc, plan);
		});
		if (id === null) new Notice(t('setups.notice.cantMarkHere'));
		return id;
	}

	/** "Setup planted · Open sheet". */
	private notice(message: string, sheet: TFile): void {
		const fragment = createFragment();
		fragment.createSpan({ text: message });
		const open = fragment.createEl('button', { cls: 'sg-setup-notice-open', text: t('setups.notice.openSheet') });
		const notice = new Notice(fragment, 8000);
		open.addEventListener('click', () => {
			notice.hide();
			const root = this.plugin.entityIndex.rootFor(sheet.path) ?? undefined;
			this.plugin.openCodex(root, sheet.path).catch(reportError);
		});
	}
}

function quoteOf(source: MarkSource): string {
	return cleanQuote(source.kind === 'text' ? nameFromSelection(source.spot.words, 2000) : source.quote);
}

/** A window anchored under an element (a grid card, a timeline event). */
function elementPlace(host: HTMLElement, anchor: Element): WindowPlace {
	// Opened from a button in the grid's card editor: on a phone that editor is a
	// bottom sheet lying over the pane, so the window must lie over the sheet —
	// and the keyboard focus goes back to the button when the window closes.
	const editorButton = anchor.instanceOf(HTMLElement) && anchor.closest('.sg-side-panel') !== null ? anchor : null;
	return {
		...(editorButton ? {
			cls: 'sg-setup-win--over-sheet',
			refocus: () => { if (editorButton.isConnected) editorButton.focus({ preventScroll: true }); },
		} : {}),
		host: positioned(host),
		rect: () => (anchor.isConnected ? anchor.getBoundingClientRect() : null),
		scrollers: [],
		// A grid redraws its cards often: only a closed pane ends the window.
		alive: () => host.isConnected,
	};
}

/** The window is placed inside `host`, so it must be a positioned element. */
function positioned(host: HTMLElement): HTMLElement {
	if (host.win.getComputedStyle(host).position === 'static') host.addClass('sg-setup-win-host');
	return host;
}
