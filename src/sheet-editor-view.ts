import { App, ItemView, Notice, Platform, TFile, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import type StorygridPlugin from './main';
import type { CharacterField } from './grid-data';
import { EntityKind, getKindSpec } from './entities/entity-kinds';
import { prepareSheetEdit, SheetEditWatch } from './entities/sheet-edit';
import { t } from './i18n';
import { EntitySheetForm, SheetFormOptions, SheetSaveHandler } from './modals/entity-sheet-form';
import { EntityModal, SheetFormModal } from './modals/entity-modal';
import { reportError, runSafely } from './utils/report-error';
import { movedPath, movedRoot, onPathMove, PathMove } from './utils/project-move';

export const VIEW_TYPE_SHEET_EDITOR = 'storygrid-sheet-editor';

/** What the tab remembers across a restart. Only an existing sheet can come back: its path is enough. */
interface SheetTabState {
	/** Hands the tab its in-memory request (`pending`); used once, never restored. */
	token?: string;
	sheetPath?: string;
	kind?: EntityKind;
	projectRoot?: string;
}

/** One request to show the sheet editor — exactly what the pop-up takes. */
interface SheetRequest {
	kind: EntityKind;
	entityName: string;
	fields: CharacterField[];
	onSave: SheetSaveHandler;
	options?: SheetFormOptions;
	/** The tab the writer was in, to go back to after Save or Cancel. */
	returnTo: WorkspaceLeaf | null;
}

/**
 * Requests on their way into a new tab. The tab's state carries only a token:
 * the save handler and the caller's callbacks (the Timeline's clicked date, a
 * Plot Grid card) live here in memory, which is also why a NEW sheet's tab is
 * not brought back after a restart.
 */
const pending = new Map<string, SheetRequest>();
let nextToken = 0;

/** Plotverk is being switched off: closing tabs must not open rescue pop-ups. */
let unloading = false;
export function setSheetEditorUnloading(value: boolean): void {
	unloading = value;
}

/**
 * Open the sheet editor. On desktop it is its own tab (movable, splittable,
 * never dimming the rest of Obsidian); on phones and tablets it stays the
 * pop-up. Takes exactly what `new EntityModal(…)` takes. Editing a sheet that
 * already has a tab open brings that tab forward instead of a second editor.
 */
export function openSheetEditor(
	app: App,
	kind: EntityKind,
	entityName: string,
	fields: CharacterField[],
	onSave: SheetSaveHandler,
	options?: SheetFormOptions
): void {
	if (Platform.isMobile) {
		new EntityModal(app, kind, entityName, fields, onSave, options).open();
		return;
	}
	const sheetPath = options?.sheetPath;
	const open = sheetPath ? findSheetEditorLeaf(app, sheetPath) : null;
	if (open) {
		runSafely(app.workspace.revealLeaf(open));
		return;
	}
	runSafely(openSheetTab(app, { kind, entityName, fields, onSave, options, returnTo: app.workspace.getMostRecentLeaf() }));
}

async function openSheetTab(app: App, request: SheetRequest): Promise<void> {
	const token = `sheet-${Date.now()}-${nextToken++}`;
	pending.set(token, request);
	const state: SheetTabState = {
		token,
		sheetPath: request.options?.sheetPath,
		kind: request.kind,
		projectRoot: request.options?.projectRoot,
	};
	const leaf = app.workspace.getLeaf('tab');
	try {
		await leaf.setViewState({ type: VIEW_TYPE_SHEET_EDITOR, active: true, state: { ...state } });
		await app.workspace.revealLeaf(leaf);
	} catch (err) {
		// The tab could not be made: the writer still gets the editor, as the pop-up.
		reportError(err);
		if (pending.has(token)) {
			leaf.detach();
			const { kind, entityName, fields, onSave, options } = request;
			new EntityModal(app, kind, entityName, fields, onSave, options).open();
		}
	} finally {
		pending.delete(token);
	}
}

/** The tab already editing this sheet, if there is one (also one Obsidian hasn't loaded since startup). */
export function findSheetEditorLeaf(app: App, sheetPath: string): WorkspaceLeaf | null {
	for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_SHEET_EDITOR)) {
		const view = leaf.view;
		const path = view instanceof SheetEditorView
			? view.sheetPath
			: (leaf.getViewState().state as SheetTabState | undefined)?.sheetPath;
		if (path === sheetPath) return leaf;
	}
	return null;
}

/** True while a sheet editor tab is open on this sheet: nothing else may write the sheet meanwhile. */
export function isSheetOpenInEditor(app: App, sheetPath: string): boolean {
	return findSheetEditorLeaf(app, sheetPath) !== null;
}

function leafIsOpen(app: App, leaf: WorkspaceLeaf): boolean {
	let found = false;
	app.workspace.iterateAllLeaves((l) => { if (l === leaf) found = true; });
	return found;
}

/**
 * The sheet editor as a tab of its own (desktop). Save or Cancel close the
 * tab and go back to where the writer was. Obsidian can't keep a tab from
 * closing, so a tab closed with unsaved work (×, Ctrl/Cmd+W, closing its
 * group) hands its form to a pop-up that asks "Keep editing / Discard" —
 * work is never lost silently.
 */
export class SheetEditorView extends ItemView {
	navigation = false;
	/** The sheet being edited; null for a new sheet. */
	sheetPath: string | null = null;
	private kind: EntityKind | null = null;
	private projectRoot: string | null = null;
	private form: EntitySheetForm | null = null;
	private returnTo: WorkspaceLeaf | null = null;
	/** Save, or Cancel / Discard in the form: the tab is closing on purpose, nothing to rescue. */
	private done = false;
	/** An existing sheet: how to notice it changing elsewhere and reload it. */
	private watch: SheetEditWatch | null = null;
	/** The sheet's text as this tab last knew it — a change event with the same text is nothing new. */
	private knownContent: string | null = null;
	/** "This sheet was changed somewhere else", while it shows. */
	private changedBar: HTMLElement | null = null;
	/** Change events are handled one at a time, in order. */
	private changeQueue: Promise<void> = Promise.resolve();

	constructor(leaf: WorkspaceLeaf, private readonly plugin: StorygridPlugin) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE_SHEET_EDITOR; }

	getDisplayText(): string {
		if (this.form) return this.form.title();
		return this.kind ? getKindSpec(this.kind).singular : 'Sheet';
	}

	getIcon(): string { return 'pencil'; }

	getState(): Record<string, unknown> {
		// No token: a request is in memory only and never survives a restart.
		const state: SheetTabState = {};
		if (this.sheetPath) state.sheetPath = this.sheetPath;
		if (this.kind) state.kind = this.kind;
		if (this.projectRoot) state.projectRoot = this.projectRoot;
		return { ...state };
	}

	async onOpen(): Promise<void> {
		// The sheet renamed or moved elsewhere: this tab still knows it (so a
		// second "Edit" finds it, and a restart brings it back).
		// (Also when a folder above it moves.)
		this.register(onPathMove((move) => {
			// The project's folder too: a new sheet's pictures go to its new place.
			const root = this.projectRoot !== null ? movedRoot(this.projectRoot, move) : null;
			if (root !== null && root !== this.projectRoot) {
				this.projectRoot = root;
				this.form?.followProjectMove(root);
				this.app.workspace.requestSaveLayout();
			}
			this.followSheetMove(this.sheetPath ? movedPath(this.sheetPath, move) : null);
		}));
		// The plain file rename on its own as well, in case the announcement above never comes.
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (oldPath === this.sheetPath) this.followSheetMove(file.path);
		}));
		// The sheet changed elsewhere (a relationship mirrored in from another
		// sheet, a rename in the Codex, a hand edit, Sync).
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (!(file instanceof TFile) || file.path !== this.sheetPath) return;
			this.changeQueue = this.changeQueue.then(() => this.sheetChanged(file)).catch(reportError);
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file.path === this.sheetPath) this.sheetDeleted();
		}));
	}

	private followSheetMove(next: string | null): void {
		if (!next || next === this.sheetPath) return;
		this.sheetPath = next;
		this.form?.followRename(next);
		this.app.workspace.requestSaveLayout();
	}

	/**
	 * The sheet's file changed, not by this editor's own save: nothing typed
	 * yet → show the new version quietly; work in progress → a bar says so
	 * (Save then merges, see `sheet-merge`; nothing is dropped either way).
	 */
	private async sheetChanged(file: TFile): Promise<void> {
		if (!this.form || this.done || !this.watch || this.form.isSaving()) return;
		const text = await this.app.vault.read(file);
		if (text === this.knownContent) return;
		this.knownContent = text;
		if (!this.form || this.done || this.form.isSaving()) return;
		if (this.form.hasUnsavedChanges()) this.showChangedBar();
		else await this.reload(true);
	}

	/**
	 * Read the sheet afresh and show it, in place of the form now showing.
	 * `quiet`: only while nothing is typed — if the writer starts typing while
	 * the sheet is being read, the bar shows instead and nothing is replaced.
	 */
	private async reload(quiet = false): Promise<void> {
		const watch = this.watch;
		if (!watch) return;
		const edit = await watch.reload();
		if (!edit || !this.form || this.done || this.form.isSaving()) return;
		if (quiet && this.form.hasUnsavedChanges()) {
			this.showChangedBar();
			return;
		}
		const old = this.form;
		this.form = null;
		old.dispose();
		this.show({
			kind: edit.kind,
			entityName: edit.startName,
			fields: edit.fields,
			onSave: edit.save,
			options: edit.options,
			returnTo: this.returnTo,
		});
	}

	private showChangedBar(): void {
		if (this.changedBar?.isConnected) return;
		const root = this.contentEl;
		const bar = root.createDiv({ cls: 'sg-sheet-changed', attr: { role: 'alert' } });
		bar.createDiv({ cls: 'sg-sheet-changed-text', text: t('sheetTab.changed.text') });
		const keep = bar.createEl('button', { cls: 'mod-cta', text: t('sheetTab.changed.keep'), attr: { type: 'button' } });
		keep.addEventListener('click', () => this.hideChangedBar());
		const load = bar.createEl('button', { text: t('sheetTab.changed.load'), attr: { type: 'button' } });
		load.addEventListener('click', () => runSafely(this.reload()));
		root.insertBefore(bar, root.firstChild);
		this.changedBar = bar;
	}

	private hideChangedBar(): void {
		this.changedBar?.remove();
		this.changedBar = null;
	}

	/** The sheet was deleted elsewhere: close, or — with unsaved work — stay open so it can be copied. */
	private sheetDeleted(): void {
		if (!this.form || this.done) return;
		const name = this.form.title();
		if (this.form.hasUnsavedChanges() || this.form.isSaving()) {
			new Notice(t('sheetTab.notice.deletedKept', { name }));
			return;
		}
		new Notice(t('sheetTab.notice.deletedClosed', { name }));
		this.closeQuietly();
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		// Already showing a form: never swap it for another under the writer's hands.
		if (this.form) {
			await super.setState(state, result);
			return;
		}
		// Known before anything waits, so a second "Edit" on this sheet finds this tab.
		const s = (state ?? {}) as SheetTabState;
		this.sheetPath = typeof s.sheetPath === 'string' ? s.sheetPath : null;
		this.kind = typeof s.kind === 'string' ? s.kind : null;
		this.projectRoot = typeof s.projectRoot === 'string' ? s.projectRoot : null;
		await super.setState(state, result);
		if (this.form) return;

		const token = typeof s.token === 'string' ? s.token : null;
		const request = token ? pending.get(token) : undefined;
		if (token && request) {
			pending.delete(token);
			this.show(request);
			return;
		}
		// After a restart: an existing sheet's editor comes back from the sheet on
		// disk; a new sheet's tab has nothing to come back with, so it closes.
		await this.restore();
	}

	private async restore(): Promise<void> {
		const file = this.sheetPath ? this.app.vault.getAbstractFileByPath(this.sheetPath) : null;
		const edit = file instanceof TFile
			? await prepareSheetEdit(this.plugin, file, {
				fallbackKind: this.kind ?? 'character',
				displayName: file.basename,
				projectRoot: this.projectRoot ?? undefined,
			})
			: null;
		// Shown something meanwhile (a second setState), or closed while reading.
		if (this.form || this.done) return;
		if (!edit) {
			this.closeQuietly();
			return;
		}
		this.show({
			kind: edit.kind,
			entityName: edit.startName,
			fields: edit.fields,
			onSave: edit.save,
			options: edit.options,
			returnTo: null,
		});
	}

	private show(request: SheetRequest): void {
		this.returnTo = request.returnTo;
		this.kind = request.kind;
		this.watch = request.options?.sheetWatch ?? null;
		this.knownContent = this.watch?.openedContent ?? null;
		this.changedBar = null;
		const root = this.contentEl;
		try {
			root.empty();
			root.addClass('sg-sheet-tab');
			const sheetEl = root.createDiv();
			this.form = new EntitySheetForm(
				{ app: this.app, rootEl: root, contentEl: sheetEl, closeHost: () => this.finish() },
				request.kind, request.entityName, request.fields, request.onSave, request.options,
			);
			this.form.render();
		} catch (err) {
			// The tab could not draw the editor: the writer still gets it, as the
			// pop-up, instead of a blank tab (Obsidian keeps this error to itself).
			reportError(err);
			this.form = null;
			this.closeQuietly();
			const { kind, entityName, fields, onSave, options } = request;
			new EntityModal(this.app, kind, entityName, fields, onSave, options).open();
		}
	}

	/** The form is done (saved, or Cancel / Discard): close the tab and go back to where the writer was. */
	private finish(): void {
		this.done = true;
		const wasActive = this.app.workspace.getActiveViewOfType(SheetEditorView) === this;
		const back = this.returnTo;
		this.leaf.detach();
		// Only when the writer is still here: a save that opened the new sheet's
		// page has already moved them on, and that page keeps the focus.
		if (wasActive && back && leafIsOpen(this.app, back)) {
			this.app.workspace.setActiveLeaf(back, { focus: true });
		}
	}

	private closeQuietly(): void {
		this.done = true;
		window.setTimeout(() => this.leaf.detach(), 0);
	}

	async onClose(): Promise<void> {
		const form = this.form;
		this.form = null;
		if (!form) return;
		if (!this.done && !unloading && form.keepsWorkOnClose()) {
			// The tab is going but the work isn't saved: the same form, as the pop-up, asking first.
			const rescue = () => new SheetFormModal(this.app, (host) => { form.rehost(host); return form; }, true).open();
			if (this.containerEl.win === window) {
				rescue();
			} else {
				// The tab sat in a pop-out window, which may be closing with it:
				// give the main window the focus, then open the pop-up there.
				window.focus();
				window.setTimeout(rescue, 150);
			}
			return;
		}
		form.dispose();
	}
}

/**
 * A sheet (or a folder above it) moved while its editor tab sat unopened
 * since a restart: the tab's remembered path follows, so it still finds the
 * sheet when clicked. Loaded tabs follow by themselves.
 */
export function followMoveInUnopenedSheetTabs(app: App, move: PathMove): void {
	for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_SHEET_EDITOR)) {
		if (leaf.view instanceof SheetEditorView || !leaf.isDeferred) continue;
		const viewState = leaf.getViewState();
		const state = (viewState.state ?? {}) as SheetTabState;
		const sheetPath = state.sheetPath ? movedPath(state.sheetPath, move) ?? state.sheetPath : state.sheetPath;
		const projectRoot = state.projectRoot !== undefined ? movedRoot(state.projectRoot, move) ?? state.projectRoot : undefined;
		if (sheetPath === state.sheetPath && projectRoot === state.projectRoot) continue;
		runSafely(leaf.setViewState({ ...viewState, active: false, state: { ...state, sheetPath, projectRoot } }));
	}
}

/**
 * After a restart: a NEW sheet's tab has nothing to come back with (its save
 * lived in memory), so it is closed before the writer sees it as a ghost tab.
 * An existing sheet's tab stays and reloads the sheet when shown.
 */
export function closeLeftoverSheetTabs(app: App): void {
	for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_SHEET_EDITOR)) {
		if (leaf.view instanceof SheetEditorView) continue;
		const state = leaf.getViewState().state as SheetTabState | undefined;
		if (!state?.sheetPath) leaf.detach();
	}
}
