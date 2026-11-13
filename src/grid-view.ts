import { ItemView, WorkspaceLeaf, TFile, Notice, Menu, MarkdownRenderer, setTooltip, Platform, ViewStateResult } from 'obsidian';
// Imported as `i18n`, not `t`: several callbacks in this file already bind `t` as a
// tag/card parameter, and a shadowed translator fails silently rather than loudly.
import { t as i18n } from './i18n';
import { setPhosphorIcon, CODEX_ICON, DASHBOARD_ICON, CONNECTIONS_MAP_ICON } from './utils/icons';
import { ColorPickerPopover, InlineColorPicker, type InlineColorPickerOptions } from './ui/color-picker-popover';
import { showCoachMarkChain, isOnCoachMark } from './ui/coach-mark';
import { measuredScale, toLayoutPx } from './utils/zoom-scale';
import type StorygridPlugin from './main';
import { onSettingsChanged } from './utils/obsidian-internals';
import { EntityModal } from './modals/entity-modal';
import { LinkDocModal } from './modals/link-doc-modal';
import { EntityPickerModal } from './modals/entity-picker-modal';
import { SaveLayoutModal } from './modals/save-layout-modal';
import { ConfirmModal } from './modals/prompt-modal';
import { SnapshotBrowserModal } from './modals/snapshot-browser-modal';
import { writeGridBackup, restoreNewestValidBackup } from './utils/grid-backup';
import { getDocPreview } from './utils/doc-preview';
import { reportError, runSafely } from './utils/report-error';
import { applyCardTagChanges, cardTagChanges, normalizeCardTag } from './utils/card-tag-sync';
import { getContrastColor } from './utils/color-contrast';
import { axisLineColor } from './utils/axis-line';
import { markdownToHtml, htmlToMarkdown } from './utils/rich-text';
import { setRichText } from './utils/dom-html';
import { buildPanelRichToolbar } from './ui/rich-toolbar';
import { openOrReveal } from './utils/workspace';
import { toggleWriteMode } from './utils/writing-modes';
import { docWordCount } from './utils/compile-runner';
import { isSafetyNetPath } from './utils/safety-paths';
import { projectRootFromGridPath, createEntityFile, entityFolderForGrid, localizedDefaultName } from './entities/entity-manager';
import { createEntitySheet } from './entities/entity-write';
import {
	GridData,
	GridRow,
	GridColumn,
	SceneCard,
	findCard,
	createCard,
	createRow,
	createColumn,
	sortByOrder,
	moveCard,
	deleteRow,
	deleteColumn,
	cardsInRow,
	cardsInColumn,
	snapshotRow,
	snapshotColumn,
	restoreRow,
	restoreColumn,
	pendingCards,
	deleteCard,
	renameRow,
	renameColumn,
	setRowColor,
	setColumnColor,
	updateCard,
	linkNewDocIfUnlinked,
	addCharacterToCard,
	commitCardDraft,
	generateId,
} from './grid-data';

export const VIEW_TYPE_STORYGRID = 'storygrid-grid-view';

/**
 * A row/column colour as painted on the grid. --sg-axis-strength (styles.css) is the one
 * knob: at 100% this is the exact palette colour; lower it for a lighter pastel.
 */
function axisTint(color: string): string {
	return `color-mix(in srgb, ${color} var(--sg-axis-strength, 100%), white)`;
}

export class StorygridView extends ItemView {
	private plugin: StorygridPlugin;
	private filePath: string = '';
	private gridData: GridData | null = null;
	private saveTimer: number | null = null;
	private _selfWrite = false;
	private _lastBackupAt = 0;
	private static readonly BACKUP_INTERVAL_MS = 5 * 60 * 1000;

	// Drag state (HTML5 DnD — desktop)
	private dragCardId: string | null = null;
	private dragRowIndex: number | null = null;
	private dragColIndex: number | null = null;
	private dragType: 'card' | 'row' | 'col' | null = null;
	private dragGhost: HTMLElement | null = null;

	// Touch drag state (mobile)
	private touchDragCardId: string | null = null;
	private touchDragSourceEl: HTMLElement | null = null;
	private touchGhost: HTMLElement | null = null;
	private touchLongPressTimer: number | null = null;
	private touchLastTarget: HTMLElement | null = null;
	/** Phones only: the one empty cell ("rowId:colId") showing its plus right now — empty cells stay blank until tapped. */
	private armedEmptyCellKey: string | null = null;
	private _gridTapHandler: ((e: MouseEvent) => void) | null = null;

	// Side panel state
	private panelCardId: string | null = null;
	private panelEl: HTMLElement | null = null;
	private scrollContainerEl: HTMLElement | null = null;

	// Copy/paste card clipboard
	private copiedCard: SceneCard | null = null;
	/** Copied card theme (color + frame) for "Paste card style" — survives across cards. */
	private copiedStyle: { color: string; frameColor?: string } | null = null;

	// Undo state for cleared cards
	private lastClearedCard: SceneCard | null = null;
	/** True between onOpen and onClose, so an Undo toast can tell its view has been closed. */
	private _viewOpen = false;
	/** Cards a row/column Undo had to leave out because their other row/column is still deleted; offered again to the next Undo. */
	private _undoPool: SceneCard[] = [];

	// Current draft in the side panel (for auto-save on card switch)
	private _panelDraft: SceneCard | null = null;

	// Pending debounced draft-commit timer (text inputs fire per keystroke)
	private _draftTimer: number | null = null;
	/** A copy of each panel draft as it was when made / last saved, so a save writes only what the writer edited. */
	private _draftBaselines = new WeakMap<SceneCard, SceneCard>();

	// Last tag-sync signature — skips linked-doc writes when tags are unchanged

	// Word counts of linked docs, keyed by path; invalidated by mtime
	private _wordCountCache: Map<string, { mtime: number; words: number }> = new Map();

	// Global keydown handler — stored so we can properly remove it
	private _panelKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
	// The document the two panel listeners were attached to — removal must use the same one
	private _panelDoc: Document | null = null;
	// Global mousedown handler for click-outside-to-close
	private _panelClickOutsideHandler: ((e: MouseEvent) => void) | null = null;

	// Session-scoped open/closed state for collapsible side-panel sections
	private _panelSectionStates: Map<string, boolean> = new Map();

	// Keyboard-selected card (click to select, arrows to move, Enter to edit)
	private selectedCardId: string | null = null;
	private _gridKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

	// Grid zoom level (1.0 = 100%)
	private zoomLevel: number = 1.0;

	// Watches document.body class changes so default cards re-render on theme switch
	private _themeObserver: MutationObserver | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_STORYGRID;
	}

	/** Expose in-memory grid data to the plugin (e.g. for word-goal lookup). */
	getGridData(): GridData | null {
		return this.gridData;
	}

	getDisplayText(): string {
		return this.gridData ? this.gridData.name : 'Plotverk';
	}

	getIcon(): string {
		return 'sg-squares-four';
	}

	// ─── Lifecycle ───────────────────────────────────────────────────────────

	async onOpen(): Promise<void> {
		this._viewOpen = true;
		this.contentEl.addClass('sg-view-root');

		// PRIMARY blank-page fix: when any .storygrid file becomes the active file
		// in the workspace, load it into whichever StorygridView is in that leaf.
		// This fires when the user clicks a .storygrid file in the file explorer.
		this.registerEvent(
			this.app.workspace.on('file-open', (file: TFile | null) => {
				if (!file || file.extension !== 'storygrid') return;
				// Only respond if this view is in the active leaf
				if (this.leaf === this.app.workspace.getMostRecentLeaf()
					&& (this.filePath !== file.path || !this.gridData)) {
					runSafely(this.loadGrid(file.path));
				}
			})
		);

		// Reload grid when an external write changes our file (e.g. Writers Panel places a scene card).
		// Skip if we're the one writing (_selfWrite). If a stale pending save exists, cancel it first —
		// the on-disk version (from the external writer) is the intentional change and must win.
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (!(file instanceof TFile)) return;
			if (file.path !== this.filePath) return;
			if (this._selfWrite) return;
			if (this.saveTimer !== null) {
				window.clearTimeout(this.saveTimer);
				this.saveTimer = null;
			}
			// A pending card-editor draft is written against the pre-reload grid —
			// letting it fire would put the stale card straight back on top.
			this.cancelDraftTimer();
			this._panelDraft = null;
			runSafely(this.loadGrid(this.filePath));
		}));

		// Quitting Obsidian, or the phone sending it to the background, never waits
		// for the autosave timers: write whatever is still waiting right away.
		// Obsidian waits for the quit save only when it is handed over as a task.
		this.registerEvent(this.app.workspace.on('quit', (tasks) => {
			tasks.addPromise(this.flushWaitingNow().catch(reportError));
		}));
		this.registerDomEvent(this.containerEl.doc, 'visibilitychange', () => {
			if (this.containerEl.doc.visibilityState === 'hidden') runSafely(this.flushWaitingNow());
		});

		// Re-render default-colored cards when the Obsidian theme switches (light ↔ dark only)
		const themeBody = this.containerEl.doc.body;
		let _lastTheme = themeBody.classList.contains('theme-dark') ? 'dark' : 'light';
		this._themeObserver = new MutationObserver(() => {
			const nowTheme = themeBody.classList.contains('theme-dark') ? 'dark' : 'light';
			if (nowTheme !== _lastTheme && this.gridData) {
				_lastTheme = nowTheme;
				this.renderAll();
			}
		});
		this._themeObserver.observe(themeBody, { attributes: true, attributeFilter: ['class'] });

		// Re-render when plugin settings change (e.g. show/hide title, status frame)
		this.registerEvent(
			onSettingsChanged(this.app.workspace, () => {
				if (this.gridData) this.renderAll();
			})
		);

		// When a vault file is renamed, update any card linked to it —
		// both the stored path and the card's displayed title.
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			// The open grid file itself moved — renamed, or carried along by a renamed
			// parent folder. Follow it first: flushSave() resolves this.filePath at write
			// time, so a stale path means every later edit is silently dropped.
			if (oldPath === this.filePath) {
				this.repointFilePath(file.path);
			} else if (this.filePath.startsWith(`${oldPath}/`)) {
				this.repointFilePath(file.path + this.filePath.slice(oldPath.length));
			}
			if (!this.gridData) return;
			let changed = false;
			const newTitle = file.name.replace(/\.(md|canvas)$/, '');
			const updatedCards = this.gridData.cards.map((card) => {
				if (card.linkedDocPath === oldPath) {
					changed = true;
					return { ...card, linkedDocPath: file.path, title: newTitle };
				}
				return card;
			});
			if (changed) {
				this.gridData = { ...this.gridData, cards: updatedCards, updatedAt: new Date().toISOString() };
				this.scheduleSave();
				this.renderAll();
			}
		}));
	}

	async onClose(): Promise<void> {
		// An Undo toast outlives the view; once closed it must not write this view's old copy of the grid back to disk.
		this._viewOpen = false;
		this._undoPool = [];
		// Remove our view class so it can't linger if Obsidian recycles this
		// container for another view (e.g. a normal markdown note) — otherwise
		// our scoped CSS would bleed onto that document.
		this.contentEl.removeClass('sg-view-root');
		this.contentEl.empty();
		// Always clean up global listeners when the view closes
		if (this._themeObserver) {
			this._themeObserver.disconnect();
			this._themeObserver = null;
		}
		this.removePanelDocListeners();
	// Safety: restore the body cursor in case a resize drag was interrupted
		this.containerEl.doc.body.removeClass('sg-body-grabbing', 'sg-body-col-resize', 'sg-body-row-resize');
		// Flush any pending panel edits before the final save
		await this.flushPendingEdits();
	}

	// ─── State persistence (workspace restart survival) ───────────────────────

	async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		const fp = (state['filePath'] ?? state['file']) as string | undefined;
		if (typeof fp === 'string' && fp) {
			await this.loadGrid(fp);
		}
	}

	getState(): Record<string, unknown> {
		return { filePath: this.filePath };
	}

	getFilePath(): string | null {
		return this.filePath || null;
	}

	// Called by Obsidian when a .storygrid file is opened by clicking in the file explorer
	// (registered via this.registerExtensions in main.ts)
	async onLoadFile(file: TFile): Promise<void> {
		await this.loadGrid(file.path);
	}

	// ─── Load & Save ─────────────────────────────────────────────────────────

	/** The open grid moved on disk — follow it so saves and project resolution stay correct. */
	private repointFilePath(newPath: string): void {
		this.filePath = newPath;
		// The workspace persists filePath as view state; without this, reopening the
		// vault would restore this tab at a path that no longer exists.
		this.app.workspace.requestSaveLayout();
		void this.plugin.setActiveProjectRoot(projectRootFromGridPath(newPath));
	}

	async loadGrid(filePath: string): Promise<void> {
		// This tab is switching to another grid: save the open one first, under its
		// own name, and drop it — a save still waiting would otherwise write this
		// grid into the other grid's file once the path below has changed.
		if (this.filePath && this.filePath !== filePath && this.gridData) {
			await this.flushPendingEdits();
			this.gridData = null;
		}
		this.filePath = filePath;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			new Notice(i18n('grid.notice.fileNotFound', { path: filePath }));
			// Never leave the previous grid on screen, looking editable, under this path.
			if (!this.gridData) this.renderAll();
			return;
		}
		let data: GridData;
		try {
			const raw = await this.app.vault.read(file);
			data = JSON.parse(raw) as GridData;
		} catch {
			if (this.filePath !== filePath) return;
			if (!this.gridData) this.renderAll();
			// Only a file that cannot be read is "corrupted" — never a hiccup while drawing it.
			await this.offerBackupRestore(file);
			return;
		}
		// Another grid was opened in this tab while this one was being read: that one wins.
		if (this.filePath !== filePath) return;
		this.gridData = data;
		// Restore the grid's saved zoom level
		this.zoomLevel = Math.min(2, Math.max(0.5, data.zoom ?? 1.0));
		try {
			this.renderAll();
		} catch (err) {
			reportError(err);
		}
		// Whichever grid is actually open is the project Codex/Writers Panel/
		// History/Dashboard should resolve to — otherwise they can get stuck
		// pointing at whatever project the Dashboard switcher last touched.
		void this.plugin.setActiveProjectRoot(projectRootFromGridPath(filePath));
	}

	/** Only what is still waiting on a timer, and the card editor stays open. */
	private flushWaitingNow(): Promise<void> {
		if (this._draftTimer !== null && this._panelDraft) {
			this.cancelDraftTimer();
			this.commitDraft(this._panelDraft);
		}
		return this.saveTimer !== null ? this.flushSave(true) : Promise.resolve();
	}

	/** Write the card editor's waiting typing and the grid's waiting save to disk now. */
	private async flushPendingEdits(): Promise<void> {
		this.cancelDraftTimer();
		if (this._panelDraft) {
			this.commitDraft(this._panelDraft);
			this._panelDraft = null;
		}
		await this.flushSave();
	}

	/** Grid file failed to parse — look for a valid backup and let the user restore it. */
	private async offerBackupRestore(file: TFile): Promise<void> {
		const backup = await restoreNewestValidBackup(this.app, this.filePath);
		if (!backup) {
			new Notice(i18n('grid.notice.corruptedNoBackup'));
			return;
		}
		new ConfirmModal(
			this.app,
			i18n('grid.notice.corruptedRestorePrompt', { name: backup.backupName }),
			i18n('grid.notice.restoreBackupCta'),
			() => { runSafely((async () => {
				this._selfWrite = true;
				try {
					await this.app.vault.modify(file, backup.content);
				} catch (err) {
					console.error('Plotverk: backup restore failed', err);
					new Notice(i18n('grid.notice.restoreFailed', { msg: err instanceof Error ? err.message : String(err) }));
					return;
				} finally {
					this._selfWrite = false;
				}
				new Notice(i18n('grid.notice.restoredFromBackup'));
				await this.loadGrid(this.filePath);
			})()); }
		).open();
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => { runSafely(this.flushSave()); }, 800);
	}

	/** `urgent`: Obsidian is quitting or going to the background — save first, skip the backup. */
	private async flushSave(urgent = false): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (!this.gridData || !this.filePath) return;
		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!(file instanceof TFile)) return;

		// Snapshot the on-disk version before overwriting it, throttled so
		// continuous editing doesn't spam the backup folder.
		if (!urgent && Date.now() - this._lastBackupAt > StorygridView.BACKUP_INTERVAL_MS) {
			try {
				const onDisk = await this.app.vault.read(file);
				if (onDisk.trim().length > 0) {
					await writeGridBackup(this.app, this.filePath, onDisk);
					this._lastBackupAt = Date.now();
				}
			} catch {
				// Backup is best-effort; never block the actual save on it.
			}
		}

		this.gridData.updatedAt = new Date().toISOString();
		this._selfWrite = true;
		try {
			await this.app.vault.modify(file, JSON.stringify(this.gridData, null, 2));
		} catch (err) {
			// A failed write has to be loud — otherwise the user keeps editing a grid
			// that stopped being persisted (locked file, Sync conflict, disk full).
			console.error('Plotverk: grid save failed', err);
			new Notice(i18n('grid.notice.saveFailed', { msg: err instanceof Error ? err.message : String(err) }));
		} finally {
			// Must clear even on failure; a stuck flag blinds us to every external write.
			this._selfWrite = false;
		}
	}

	// ─── Render ──────────────────────────────────────────────────────────────

	renderAll(): void {
		// Remember panel state across re-renders
		const wasOpenCardId = this.panelCardId;

		this.contentEl.empty();
		this.panelEl = null;
		this.scrollContainerEl = null;
		if (!this.gridData) return;

		const wrapper = this.contentEl.createDiv({ cls: 'sg-wrapper' });
		if (this.plugin.settings.showGridTitle !== false) {
			wrapper.createDiv({ cls: 'sg-grid-title', text: this.gridData.name });
		}
		this.renderToolbar(wrapper);
		// A brand-new grid shows its two tips first; the Creator box joins after them (maybeStartNewGridTour).
		const tourPending = this._newGridTourRunning || (!!this.filePath && this.plugin.newGridTourPaths.has(this.filePath));
		if (!tourPending) this.renderCreatorIntro(wrapper);

		// Main body: grid + side panel sit side by side
		const body = wrapper.createDiv({ cls: 'sg-body' });
		this.scrollContainerEl = body.createDiv({ cls: 'sg-scroll-container' });
		this.renderGrid(this.scrollContainerEl);
		this.applyZoom();

		// Render side panel (hidden by default, will open if a card was open)
		this.panelEl = body.createDiv({ cls: 'sg-side-panel' });
		this.renderSidePanelShell(this.panelEl);

		this.maybeStartNewGridTour();

		// Re-open panel for the same card if a re-render happened while editing
		if (wasOpenCardId) {
			const card = this.gridData.cards.find((c) => c.id === wasOpenCardId);
			if (card) {
				// Suppress transition during restore to avoid visible flash
				this.panelEl.addClass('sg-side-panel--no-transition');
				this.openSidePanel(card);
				// Re-enable transitions after paint
				window.setTimeout(() => this.panelEl?.removeClass('sg-side-panel--no-transition'), 50);
			} else {
				this.panelCardId = null;
			}
		}
	}

	/** Creator Grid View only: a yellow box above the grid saying more tools can be switched on in settings.
	 *  The same box the Codex uses; × hides it for good ("Show all tips again" brings it back). */
	private renderCreatorIntro(parent: HTMLElement, before?: HTMLElement | null): void {
		const key = 'grid-creator';
		if (this.plugin.settings.intent !== 'creator') return;
		if (this.plugin.settings.dismissedIntros?.[key]) return;
		if (parent.querySelector('.sg-grid-creator-intro')) return;
		const bar = createDiv({ cls: 'sg-tab-intro sg-grid-creator-intro' });
		parent.insertBefore(bar, before ?? null);
		bar.createSpan({ cls: 'sg-tab-intro-text', text: i18n('grid.creatorIntro.text') });
		const closeBtn = bar.createEl('button', { cls: 'sg-tab-intro-close', text: '×' });
		closeBtn.setAttribute('aria-label', i18n('codex.intro.dismissAria'));
		closeBtn.addEventListener('click', () => {
			if (!this.plugin.settings.dismissedIntros) this.plugin.settings.dismissedIntros = {};
			this.plugin.settings.dismissedIntros[key] = true;
			void this.plugin.saveSettings();
			bar.classList.add('sg-tab-intro--fade');
			window.setTimeout(() => bar.remove(), 350);
		});
	}

	/** True while a brand-new grid's two tips are on screen (the Creator box waits for them). */
	private _newGridTourRunning = false;

	/**
	 * Every newly created grid, once: tip 1 points at a column name (right-click / press and hold → add rows and
	 * columns), tip 2 at a row name (drag to move). Then the Creator Grid View box appears, then every other
	 * waiting tip follows (plugin.endGridTour).
	 */
	private maybeStartNewGridTour(): void {
		if (!this.filePath || !this.plugin.newGridTourPaths.has(this.filePath)) return;
		this.plugin.newGridTourPaths.delete(this.filePath);
		this._newGridTourRunning = true;
		this.plugin.gridTourActive = true;
		const finish = (): void => {
			this._newGridTourRunning = false;
			const live = this.contentEl.querySelector<HTMLElement>('.sg-wrapper');
			if (live) this.renderCreatorIntro(live, live.querySelector<HTMLElement>('.sg-body'));
			this.plugin.endGridTour();
		};
		// Wait for the grid to settle (and a slide-in tab to finish) before measuring the anchors.
		window.setTimeout(() => {
			const root = this.contentEl.querySelector('.sg-wrapper');
			const colHeader = root?.querySelector('th.sg-col-header') as HTMLElement | null;
			const rowHeader = root?.querySelector('td.sg-row-header') as HTMLElement | null;
			const steps = [];
			if (colHeader) steps.push({ anchor: colHeader, text: Platform.isMobile ? i18n('grid.coach.newGrid.addMobile') : i18n('grid.coach.newGrid.addDesktop'), placement: 'bottom' as const });
			if (rowHeader) steps.push({ anchor: rowHeader, text: i18n('grid.coach.newGrid.drag'), placement: 'right' as const });
			if (!steps.length) { finish(); return; }
			showCoachMarkChain(steps, finish, finish);
		}, 500);
	}

	private renderGridOnly(): void {
		if (!this.scrollContainerEl || !this.gridData) return;
		this.scrollContainerEl.empty();
		this.renderGrid(this.scrollContainerEl);
		this.applyZoom();
		// Re-apply editing highlight after DOM re-render
		if (this.panelCardId) {
			this.contentEl.querySelector<HTMLElement>(`[data-card-id="${this.panelCardId}"]`)
				?.classList.add('sg-card--editing');
		}
	}

	private renderToolbar(parent: HTMLElement): void {
		const toolbar = parent.createDiv({ cls: 'sg-toolbar' });

		// One button factory for the whole bar. `label` shows visible text;
		// icon-only buttons get an aria-label from the tooltip. `caret` adds a
		// dropdown chevron; the click handler receives the event so menus can
		// anchor to the cursor.
		const mkBtn = (
			host: HTMLElement,
			opts: {
				icon: string; fallback: string; tooltip: string;
				label?: string; cls?: string; caret?: boolean;
				onClick: (e: MouseEvent) => void;
			}
		): HTMLButtonElement => {
			const btn = host.createEl('button', { cls: `sg-toolbar-btn ${opts.cls ?? ''}`.trim() });
			setTooltip(btn, opts.tooltip, { placement: 'bottom' });
			if (!opts.label) btn.setAttribute('aria-label', opts.tooltip);
			setPhosphorIcon(btn.createSpan({ cls: 'sg-toolbar-btn-icon' }), opts.icon, opts.fallback);
			if (opts.label) btn.createSpan({ cls: 'sg-toolbar-btn-label', text: opts.label });
			if (opts.caret) {
				btn.addClass('sg-toolbar-btn--has-caret');
				setPhosphorIcon(btn.createSpan({ cls: 'sg-toolbar-btn-caret' }), 'caret-down', '▾');
			}
			// mousedown keeps focus on the grid; the action fires on click
			// (which also covers keyboard Enter/Space activation)
			btn.addEventListener('mousedown', (e) => { e.preventDefault(); });
			btn.addEventListener('click', (e) => opts.onClick(e));
			return btn;
		};

		// ── Zone 1: edit the grid ───────────────────────────────────────────
		const editGroup = toolbar.createDiv({ cls: 'sg-toolbar-group' });
		mkBtn(editGroup, { icon: 'rows', fallback: '≡', label: i18n('grid.toolbar.row'), tooltip: i18n('grid.toolbar.addRowTooltip'), onClick: () => this.addRow() });
		mkBtn(editGroup, { icon: 'columns', fallback: '⊞', label: i18n('grid.toolbar.column'), tooltip: i18n('grid.toolbar.addColumnTooltip'), onClick: () => this.addColumn() });

		// ── Zone 2: view — zoom as one segmented control ────────────────────
		const zoom = toolbar.createDiv({ cls: 'sg-toolbar-zoom' });
		mkBtn(zoom, { icon: 'minus', fallback: '−', tooltip: i18n('grid.toolbar.zoomOut'), cls: 'sg-toolbar-zoom-btn', onClick: () => this.setZoom(this.zoomLevel - 0.1) });
		this.zoomLabelEl = zoom.createSpan({ cls: 'sg-toolbar-zoom-label', text: `${Math.round(this.zoomLevel * 100)}%` });
		mkBtn(zoom, { icon: 'plus', fallback: '+', tooltip: i18n('grid.toolbar.zoomIn'), cls: 'sg-toolbar-zoom-btn', onClick: () => this.setZoom(this.zoomLevel + 0.1) });

		// Flex spacer pushes the create/navigate group to the right edge
		toolbar.createDiv({ cls: 'sg-toolbar-spacer' });

		// ── Zone 3: create & navigate ───────────────────────────────────────
		const navGroup = toolbar.createDiv({ cls: 'sg-toolbar-group' });

		// New ▾ — a single creation menu replaces three separate buttons
		mkBtn(navGroup, {
			icon: 'plus', fallback: '+', label: i18n('grid.toolbar.new'), tooltip: i18n('grid.toolbar.newTooltip'),
			cls: 'sg-toolbar-btn--accent', caret: true,
			onClick: (e) => {
				const menu = new Menu();
				menu.addItem((i) => i.setTitle(i18n('grid.toolbar.newCharacter')).setIcon('user').onClick(() => this.createCharacterDocument()));
				menu.addItem((i) => i.setTitle(i18n('grid.toolbar.newScene')).setIcon('film').onClick(() => this.createSceneDocument()));
				menu.addItem((i) => i.setTitle(i18n('grid.toolbar.newLocation')).setIcon('map-pin').onClick(() => this.createLocationDocument()));
				menu.showAtMouseEvent(e);
			},
		});

		// Standard quick-launch destinations — same order as the Codex/Writers Panel/
		// Dashboard headers (Connections Map, Dashboard, Codex; Grid is skipped here
		// since it's the view already open), each gated by Settings → Quick-links.
		if (this.plugin.quickLinkVisible('connectionsMap', 'panel')) {
			mkBtn(navGroup, {
				icon: CONNECTIONS_MAP_ICON, fallback: '⬡', label: i18n('grid.toolbar.connections'), tooltip: i18n('grid.toolbar.connectionsTooltip'),
				onClick: () => { void this.plugin.openRelGraph(); },
			});
		}

		if (this.plugin.quickLinkVisible('dashboard', 'panel')) {
			mkBtn(navGroup, {
				icon: DASHBOARD_ICON, fallback: '◎', label: i18n('grid.toolbar.dashboard'), tooltip: i18n('grid.toolbar.dashboardTooltip'),
				onClick: () => { void this.plugin.openDashboard(projectRootFromGridPath(this.filePath)); },
			});
		}

		if (this.plugin.quickLinkVisible('codex', 'panel')) {
			mkBtn(navGroup, {
				icon: CODEX_ICON, fallback: '🌐', label: i18n('grid.toolbar.codex'), tooltip: i18n('grid.toolbar.codexTooltip'),
				onClick: () => { runSafely(this.plugin.openCodex(projectRootFromGridPath(this.filePath))); },
			});
		}

		// No Export button here: export lives on the Dashboard and in the Writers Panel,
		// so the grid's bar stays simple.

		// ⋯ — overflow for rare/advanced actions
		mkBtn(navGroup, {
			icon: 'dots-three', fallback: '⋯', tooltip: i18n('grid.toolbar.moreActions'), cls: 'sg-toolbar-btn--icon',
			onClick: (e) => {
				const menu = new Menu();
				menu.addItem((i) => i.setTitle(i18n('grid.menu.saveLayout')).setIcon('save').onClick(() => this.saveLayoutAsTemplate()));
				menu.showAtMouseEvent(e);
			},
		});
	}

	private zoomLabelEl: HTMLElement | null = null;

	private setZoom(level: number): void {
		this.zoomLevel = Math.min(2, Math.max(0.5, Math.round(level * 10) / 10));
		this.applyZoom();
		if (this.zoomLabelEl) this.zoomLabelEl.textContent = `${Math.round(this.zoomLevel * 100)}%`;
		// Persist with the grid so it survives reopening
		if (this.gridData) {
			this.gridData = { ...this.gridData, zoom: this.zoomLevel };
			this.scheduleSave();
		}
	}

	private applyZoom(): void {
		const table = this.scrollContainerEl?.querySelector('.sg-grid') as HTMLElement | null;
		if (table) {
			// CSS 'zoom' scales layout AND keeps scrolling correct (Chromium/Obsidian supports it)
			(table.style as CSSStyleDeclaration & { zoom: string }).zoom = String(this.zoomLevel);
		}
	}

	/**
	 * Screen px per layout px for slides computed from the DIFFERENCE OF TWO
	 * getBoundingClientRect() values (the card swap / drop slides): whatever the
	 * engine reports for zoomed rects, the ratio of the table's rect width to its
	 * layout width converts that difference back into the px a translate inside
	 * the table is drawn in. Exactly 1 at 100%. Measured on the whole table (many
	 * hundreds of px wide, so whole-pixel rounding of offsetWidth is negligible).
	 *
	 * Pointer travel (clientX/Y) is different: it is always screen px, so the row
	 * and column drags divide it by `zoomLevel`, as the resize handlers do.
	 */
	private measureGridScale(): number {
		const table = this.scrollContainerEl?.querySelector<HTMLElement>('.sg-grid');
		return table ? measuredScale(table.getBoundingClientRect().width, table.offsetWidth) : 1;
	}


	private renderGrid(parent: HTMLElement): void {
		if (!this.gridData) return;

		const rows = sortByOrder(this.gridData.rows);
		const cols = sortByOrder(this.gridData.columns);

		// An armed empty cell survives re-renders, unless it has gained a card or its row/column is gone.
		if (this.armedEmptyCellKey) {
			const [armedRow, armedCol] = this.armedEmptyCellKey.split(':');
			const stillEmpty = rows.some((r) => r.id === armedRow) && cols.some((c) => c.id === armedCol)
				&& !findCard(this.gridData.cards, armedRow, armedCol);
			if (!stillEmpty) this.armedEmptyCellKey = null;
		}

		const table = parent.createEl('table', { cls: 'sg-grid' });

		// ── Header row ──────────────────────────────────────────────────────
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');

		// Corner cell
		const corner = headerRow.createEl('th', { cls: 'sg-corner' });
		corner.setText('');
		const firstRowW = rows.length > 0 ? (rows[0].width ?? 160) : 160;
		this.pinWidth(corner, firstRowW);

		// Column headers — default display width for all columns
		const DEFAULT_COL_W = 200;

		cols.forEach((col, colIndex) => {
			const th = headerRow.createEl('th', { cls: 'sg-col-header' });
			th.setAttribute('data-col-id', col.id);

			const colW = col.width ?? DEFAULT_COL_W;
			this.pinWidth(th, colW);
			// Column header always uses the default header color (same as row headers);
			// the column's color shows on its cells, not the header.

			const label = th.createDiv({ cls: 'sg-header-label', text: col.label });
			label.addEventListener('click', () => {
				this.makeHeaderEditable(label, col.label, (newLabel) => {
					if (!this.gridData) return;
					this.gridData = renameColumn(this.gridData, col.id, newLabel);
					this.scheduleSave();
				});
			});

			// Edge-detection resize: no separate handle div — detect right-edge mousedown
			this.bindColEdgeResize(th, col);
			this.bindColHeaderDrag(th, col, colIndex, cols);
			this.bindColHeaderContextMenu(th, col, cols);
		});

		// ── Body rows ────────────────────────────────────────────────────────
		const tbody = table.createEl('tbody');

		rows.forEach((row, rowIndex) => {
			const tr = tbody.createEl('tr');
			tr.setAttribute('data-row-id', row.id);

			// Row header cell
			const rowHeader = tr.createEl('td', { cls: 'sg-row-header' });
			rowHeader.setAttribute('data-row-id', row.id);
			const rowW = row.width ?? 160;
			this.pinWidth(rowHeader, rowW);

			if (row.color) {
				rowHeader.addClass('sg-axis-tinted');
				rowHeader.style.setProperty('--sg-axis-line', axisLineColor([row.color]));
				// The fill reaches the header as a custom property (.sg-axis-tinted--* in styles.css).
				if (row.color.includes('gradient(')) {
					rowHeader.addClass('sg-axis-tinted--gradient');
					rowHeader.setCssProps({ '--sg-axis-fill': row.color });
				} else {
					rowHeader.style.borderLeft = `4px solid ${row.color}`;
					// Fill the whole header cell with the writer's own colour (see axisTint).
					rowHeader.addClass('sg-axis-tinted--solid');
					rowHeader.setCssProps({ '--sg-axis-fill': axisTint(row.color) });
				}
			}
			if (row.height) tr.style.height = `${row.height}px`;

			const rowLabel = rowHeader.createDiv({ cls: 'sg-header-label', text: row.label });
			rowLabel.addEventListener('click', () => {
				this.makeHeaderEditable(rowLabel, row.label, (newLabel) => {
					if (!this.gridData) return;
					this.gridData = renameRow(this.gridData, row.id, newLabel);
					this.scheduleSave();
				});
			});

			// Edge-detection resize: detect bottom-edge mousedown on row header
			this.bindRowEdgeResize(rowHeader, row, tr);
			this.bindRowHeaderDrag(rowHeader, row, rowIndex, rows);
			this.bindRowHeaderContextMenu(rowHeader, row, rows);

			// Data cells
			cols.forEach((col) => {
				const td = tr.createEl('td', { cls: 'sg-cell' });
				td.setAttribute('data-row-id', row.id);
				td.setAttribute('data-col-id', col.id);
				// Pin every cell (not just explicitly-sized columns): without a
				// max-width, text-heavy content sets a layout floor and the
				// column can be dragged wider but never back narrower.
				this.pinWidth(td, col.width ?? DEFAULT_COL_W);
				if (row.height) {
					td.style.minHeight = `${row.height}px`;
				}

				// Row/column colour: the writer's exact palette colour, flat, so the grid shows
				// the colour they picked. Strength lives in one place — --sg-axis-strength via axisTint.
				const hasRowGradient = row.color?.includes('gradient(');
				const hasColGradient = col.color?.includes('gradient(');

				if (col.color && !hasColGradient && !row.color) {
					td.style.backgroundColor = axisTint(col.color);
				} else if (row.color && !hasRowGradient && !col.color) {
					td.style.backgroundColor = axisTint(row.color);
				} else if (row.color && col.color && !hasRowGradient && !hasColGradient) {
					// Both set → an even mix of the two colours, nothing else mixed in
					td.style.backgroundColor = `color-mix(in srgb, ${axisTint(row.color)} 50%, ${axisTint(col.color)})`;
				} else if (hasRowGradient || hasColGradient) {
					// Palette gradients → the gradient at full strength
					td.addClass('sg-axis-tinted--gradient');
					td.setCssProps({ '--sg-axis-fill': (hasRowGradient ? row.color : col.color)! });
				}
				// A filled cell needs a dark divider — the default faint line vanishes on it.
				if (row.color || col.color) {
					td.addClass('sg-axis-tinted');
					// Dark line on a light fill, light line on a dark one.
					td.style.setProperty('--sg-axis-line', axisLineColor([row.color, col.color]));
				}

				const card = findCard(this.gridData!.cards, row.id, col.id);
				if (card) {
					this.renderCard(td, card);
				} else {
					this.renderEmptyCell(td, row.id, col.id);
				}

			});
		});

		// ── Keyboard navigation ──────────────────────────────────────────────
		// Remove any prior listener before attaching a fresh one (renderGrid may
		// be called again on zoom/resize without a full re-open).
		if (this._gridKeydownHandler) {
			parent.removeEventListener('keydown', this._gridKeydownHandler);
		}
		this._gridKeydownHandler = (e: KeyboardEvent) => {
			// Only intercept when focus is inside the grid (not in a panel input)
			const active = parent.doc.activeElement;
			if (!active || !parent.contains(active)) return;
			if (active.instanceOf(HTMLInputElement) || active.instanceOf(HTMLTextAreaElement) || active.instanceOf(HTMLSelectElement)) return;
			// A header label being renamed is a contenteditable div — let it receive Space/Enter
			if (active.instanceOf(HTMLElement) && active.isContentEditable) return;
			// Don't steal from modals or the side panel
			if (parent.doc.querySelector('.modal-container, .menu, .sg-color-popover')) return;
			if (active.closest('.sg-side-panel')) return;

			if (!this.selectedCardId) return;

			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				const card = this.gridData?.cards.find((c) => c.id === this.selectedCardId);
				if (card) this.openSidePanel(card);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.clearCardSelection();
			} else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
				e.preventDefault();
				// Ctrl/Cmd+arrows physically move the card; plain arrows navigate the selection
				if (e.ctrlKey || e.metaKey) {
					this.moveSelectedCard(e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
				} else {
					this.navigateSelection(e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
				}
			}
		};
		parent.addEventListener('keydown', this._gridKeydownHandler);

		// ── Phones: tap an empty cell to show its plus ───────────────────────
		// Hover can't reveal the plus on touch, and a plus in every empty cell is noise.
		// A tap arms one cell; a tap anywhere else in the grid disarms it. The plus
		// button and the card edit button stop propagation, so they never reach here.
		if (Platform.isMobile) {
			if (this._gridTapHandler) {
				parent.removeEventListener('click', this._gridTapHandler);
			}
			this._gridTapHandler = (e: MouseEvent) => {
				const wrapper = (e.target as HTMLElement | null)?.closest<HTMLElement>('.sg-cell-content--empty') ?? null;
				this.armEmptyCell(parent, wrapper);
			};
			parent.addEventListener('click', this._gridTapHandler);
		}
	}

	/** Phones only: show the plus in exactly one empty cell (null = none). */
	private armEmptyCell(parent: HTMLElement, wrapper: HTMLElement | null): void {
		parent.querySelectorAll<HTMLElement>('.sg-cell-content--armed').forEach((el) => {
			if (el !== wrapper) el.removeClass('sg-cell-content--armed');
		});
		const cell = wrapper?.closest<HTMLElement>('[data-row-id][data-col-id]');
		if (!wrapper || !cell) {
			this.armedEmptyCellKey = null;
			return;
		}
		this.armedEmptyCellKey = `${cell.getAttribute('data-row-id')}:${cell.getAttribute('data-col-id')}`;
		wrapper.addClass('sg-cell-content--armed');
	}

	// ─── Card rendering ───────────────────────────────────────────────────────

	private renderCard(parent: HTMLElement, card: SceneCard): void {
		const hasTitle = !!(card.title && card.title.trim());
		const cardEl = parent.createDiv({ cls: hasTitle ? 'sg-card' : 'sg-card sg-card--no-title' });
		cardEl.setAttribute('data-card-id', card.id);
		cardEl.setAttribute('data-status', card.status);
		cardEl.setAttribute('tabindex', '0');
		cardEl.setAttribute('role', 'button');
		cardEl.setAttribute('aria-label', card.title || i18n('grid.card.fallbackTitle'));
		cardEl.draggable = false; // pointer-based drag, not HTML5 DnD

		// Click-to-select for keyboard nav (edit button click handled separately via stopPropagation)
		cardEl.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).closest('.sg-card-edit-btn')) return;
			this.selectCard(card.id);
		});

		const displayColor = card.color;
		this.applyCardBackground(cardEl, displayColor);

		// Card is position:relative so it drives table row height.
		// Set min-height from the row's stored height so it fills the cell when collapsed.
		const rowData = this.gridData?.rows.find((r) => r.id === card.rowId);
		const rowH = rowData?.height ?? 130;
		cardEl.style.minHeight = `${rowH - 6}px`; // 3px margin top + bottom = 6px
		cardEl.style.maxHeight = `${rowH - 6}px`; // cap collapsed card at row height

		// Auto-contrast text color based on the displayed card background.
		// Default cards track the theme surface, so the theme's own text color is
		// already the right (adaptive) contrast. Gradients derive contrast from
		// their first color stop; solid colors from their luminance.
		let textColor: string;
		if (this.LIGHT_DEFAULT_COLORS.includes(displayColor.toLowerCase())) {
			textColor = 'var(--text-normal)';
		} else if (displayColor.includes('gradient(')) {
			const firstHex = displayColor.match(/#[0-9a-fA-F]{6}/)?.[0];
			textColor = firstHex ? getContrastColor(firstHex) : 'var(--text-normal)';
		} else {
			textColor = getContrastColor(displayColor);
		}
		cardEl.style.color = textColor;

		const radius = this.plugin.settings.cardBorderRadius;
		cardEl.style.borderRadius = radius === 'square' ? '0' : '6px';

		// Frame color: individual card override → status frame setting
		if (card.frameColor) {
			let frameColorSolid = card.frameColor;
			if (card.frameColor.includes('gradient')) {
				// Extract first hex/rgb color stop from the gradient string
				const match = card.frameColor.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/);
				frameColorSolid = match ? match[0] : '#888888';
			}
			// box-shadow spread renders OUTSIDE the card, above overflow:hidden, respects border-radius
			// (.sg-card--framed in styles.css reads the colour from the custom property)
			cardEl.addClass('sg-card--framed');
			cardEl.setCssProps({ '--sg-card-frame': frameColorSolid });
		} else if (this.plugin.settings.statusFrameEnabled) {
			const statusColor = this.plugin.settings.statusColors[card.status] ?? '#cccccc';
			cardEl.addClass('sg-card--status-frame');
			cardEl.setCssProps({ '--sg-card-status': statusColor });
		}

		// Restore selected state after re-render
		if (this.selectedCardId === card.id) {
			cardEl.classList.add('sg-card--selected');
		}

		// Status dot — non-color indicator (accessibility + color-blind friendly)
		const statusDot = cardEl.createDiv({ cls: 'sg-card-status-dot' });
		const statusColor = this.plugin.settings.statusColors[card.status] ?? '#cccccc';
		statusDot.style.backgroundColor = statusColor;

		// ── Header (always visible) ──────────────────────────────────────────
		const headerEl = cardEl.createDiv({ cls: 'sg-card-header' });

		// Icon badge — top-left, only when a scene icon is selected
		if (card.sceneIcon) {
			const iconBadge = headerEl.createDiv({ cls: 'sg-card-icon-badge' });
			setPhosphorIcon(iconBadge, card.sceneIcon, '◆');
		}

		// Title
		const titleEl = headerEl.createDiv({ cls: 'sg-card-title' });
		titleEl.textContent = (card.title && card.title.trim()) ? card.title : '';

		// Controls: edit button — top-right
		const controlsEl = headerEl.createDiv({ cls: 'sg-card-controls' });

		const editBtn = controlsEl.createEl('button', { cls: 'sg-card-edit-btn', attr: { type: 'button' }, title: i18n('grid.card.editTooltip') });
		setPhosphorIcon(editBtn, 'note-pencil', '✎');
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openSidePanel(card);
		});

		// ── Synopsis — always visible, clamped when compact ─────────────────
		// Compact: 2 lines via CSS -webkit-line-clamp.
		// Expanded: full text (clamp removed by .sg-card--expanded modifier).
		if (card.linkedDocPath) {
			if (card.linkDisplayMode === 'synopsis') {
				if (card.synopsis) {
					const notesEl = cardEl.createDiv({ cls: 'sg-card-synopsis' });
					this.renderCardText(notesEl, card.synopsis);
				}
			} else if (card.linkDisplayMode === 'first-lines') {
				const notesEl = cardEl.createDiv({ cls: 'sg-card-synopsis sg-card-notes--loading' });
				notesEl.setText('…');
				void getDocPreview(this.app, card.linkedDocPath, this.plugin.settings.showFirstLinesCount)
					.then((preview) => {
						notesEl.removeClass('sg-card-notes--loading');
						notesEl.empty();
						if (preview) {
							this.renderCardText(notesEl, preview);
						} else {
							notesEl.hide();
						}
					});
			}
			// title-only: no synopsis shown
		} else if (card.synopsis) {
			const notesEl = cardEl.createDiv({ cls: 'sg-card-synopsis' });
			this.renderCardText(notesEl, card.synopsis);
		}

		// ── Collapsible body — linked document details (hidden when collapsed
		// so the synopsis gets the whole card face) ──────────────────────────
		// Uses CSS grid-template-rows: 0fr → 1fr for smooth expand animation.
		const hasTags = card.tags && card.tags.length > 0;
		const hasChars = (card.characterPaths ?? []).length > 0;
		const bodyOuter = cardEl.createDiv({ cls: 'sg-card-body' });
		const bodyInner = bodyOuter.createDiv({ cls: 'sg-card-body-inner' });

		if (card.linkedDocPath) {
			const linkBadge = bodyInner.createDiv({ cls: 'sg-card-link-badge' });
			const fileName = card.linkedDocPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || '';
			const isCanvas = card.linkedDocPath.endsWith('.canvas');
			const badgeIcon = linkBadge.createSpan({ cls: 'sg-card-link-icon' });
			setPhosphorIcon(badgeIcon, isCanvas ? 'image' : 'file-text', '◈');
			const shortName = fileName.length > 18 ? fileName.slice(0, 16) + '…' : fileName;
			linkBadge.createSpan({ cls: 'sg-card-link-name', text: shortName });
			linkBadge.title = fileName;
			linkBadge.addEventListener('click', (e) => {
				e.stopPropagation();
				runSafely(this.openLinkedDoc(card.linkedDocPath!));
			});
		}

		// ── Footer — compact tag pills + stacked character avatars ──────────
		// Lives inside the collapsible body: only visible when the card is
		// unfolded, so the collapsed face is all title + synopsis.
		if (hasTags || hasChars) {
			const footer = bodyInner.createDiv({ cls: 'sg-card-footer' });

			if (hasTags) {
				const pillsEl = footer.createDiv({ cls: 'sg-card-pills' });
				card.tags!.forEach((tag) => {
					pillsEl.createSpan({ cls: 'sg-card-pill', text: tag });
				});
			}

			if (hasChars) {
				this.renderCharacterAvatars(footer, card.characterPaths ?? []);
			}
		}

		// ── Word-goal progress strip — always visible at the foot of the card
		// when the linked scene has its own goal (set in the card editor) ─────
		if (card.wordGoal && card.wordGoal > 0 && card.linkedDocPath?.endsWith('.md')) {
			const goal = card.wordGoal;
			const goalBar = cardEl.createDiv({ cls: 'sg-card-goalbar' });
			const fill = goalBar.createDiv({ cls: 'sg-card-goalbar-fill' });
			void this.getDocWordCount(card.linkedDocPath).then((w) => {
				if (w === null || !goalBar.isConnected) return;
				const pct = Math.min(100, Math.round((w / goal) * 100));
				fill.style.width = `${pct}%`;
				if (w >= goal) goalBar.addClass('is-met');
				goalBar.title = i18n('grid.card.wordGoalTooltip', { words: w.toLocaleString(), goal: goal.toLocaleString(), pct });
				goalBar.setAttribute('aria-label', goalBar.title);
			});
		}

		// ── Single-click on header → expand / collapse card body ─────────────
		cardEl.addEventListener('click', (e) => {
			// Don't toggle when clicking the edit button, status dot, or any link
			if ((e.target as HTMLElement).closest('.sg-card-controls')) return;
			if ((e.target as HTMLElement).closest('a')) return;

			if (cardEl.classList.contains('sg-card--expanded')) {
				cardEl.classList.remove('sg-card--expanded');
				cardEl.style.minHeight = `${rowH - 6}px`;
				cardEl.style.maxHeight = `${rowH - 6}px`;
			} else {
				const bodyNaturalH = bodyInner.scrollHeight;
				const headerH = headerEl.offsetHeight;
				const targetH = Math.max(rowH - 6 + 120, headerH + bodyNaturalH + 48);
				cardEl.style.minHeight = `${targetH}px`;
				cardEl.style.maxHeight = `${targetH}px`;
				cardEl.classList.add('sg-card--expanded');
			}
		});

		cardEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showCardContextMenu(e, card);
		});

		this.bindCardDrag(cardEl, card);
		this.bindTouchDrag(cardEl, card);
	}

	/**
	 * Overlapping circular character avatars (like a "facepile"). Each avatar
	 * shows the character sheet's first embedded image, falling back to the
	 * character's initials on a color derived from the name. Every avatar is
	 * clickable and opens the character document.
	 */
	private renderCharacterAvatars(parent: HTMLElement, paths: string[]): void {
		const wrap = parent.createDiv({ cls: 'sg-card-avatars' });
		paths.forEach((charPath, i) => {
			const name = charPath.split('/').pop()?.replace(/\.md$/, '') || charPath;
			const av = wrap.createDiv({ cls: 'sg-card-avatar' });
			av.title = name;
			av.setCssProps({ '--sg-avatar-z': String(paths.length - i) });

			const file = this.app.vault.getAbstractFileByPath(charPath);
			let hasImage = false;
			if (file instanceof TFile) {
				const cache = this.app.metadataCache.getFileCache(file);
				const embed = cache?.embeds?.find((e) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(e.link));
				const imgFile = embed
					? this.app.metadataCache.getFirstLinkpathDest(embed.link, file.path)
					: null;
				if (imgFile) {
					av.createEl('img', {
						attr: { src: this.app.vault.getResourcePath(imgFile), alt: name },
					});
					hasImage = true;
				}
			}
			if (!hasImage) {
				av.addClass('sg-card-avatar--initials');
				const initials = name.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
				av.setText(initials || '?');
				// Stable per-name hue so the same character is always the same color
				let hash = 0;
				for (let c = 0; c < name.length; c++) hash = (hash * 31 + name.charCodeAt(c)) | 0;
				av.style.backgroundColor = `hsl(${Math.abs(hash) % 360}, 55%, 52%)`;
			}

			av.addEventListener('click', (e) => {
				e.stopPropagation();
				if (file instanceof TFile) {
					runSafely(openOrReveal(this.app, file));
				} else {
					new Notice(i18n('grid.notice.characterDocNotFound', { path: charPath }));
				}
			});
		});
	}

	private renderEmptyCell(parent: HTMLElement, rowId: string, colId: string): void {
		// The empty wrapper fills the whole cell so the plus centers vertically too
		const wrapper = parent.createDiv({ cls: 'sg-cell-content sg-cell-content--empty' });
		if (Platform.isMobile && this.armedEmptyCellKey === `${rowId}:${colId}`) {
			wrapper.addClass('sg-cell-content--armed');
		}

		// Ghost hint on the very first story cell while the grid has no scene cards yet.
		// A template's Beat guide cards don't count, and their column is skipped.
		if (this.gridData && !this.gridData.cards.some((c) => !c.guide)) {
			const guideCols = new Set(this.gridData.cards.filter((c) => c.guide).map((c) => c.colId));
			const rows = sortByOrder(this.gridData.rows);
			const firstStoryCol = sortByOrder(this.gridData.columns).find((c) => !guideCols.has(c.id));
			if (rows[0]?.id === rowId && firstStoryCol?.id === colId) {
				// Pulses twice then stops — a nudge, not a nag. CSS gates it
				// off entirely under prefers-reduced-motion.
				const ghost = wrapper.createDiv({ cls: 'sg-ghost-hint sg-ghost-hint--pulse' });
				ghost.createDiv({ cls: 'sg-ghost-hint-icon', text: '+' });
				ghost.createDiv({
					cls: 'sg-ghost-hint-text',
					text: Platform.isMobile ? i18n('grid.cell.firstSceneMobile') : i18n('grid.cell.firstSceneDesktop'),
				});
			}
		}

		// Centered add-card button, revealed on hover
		const addCardBtn = wrapper.createEl('button', { cls: 'sg-cell-add-card', attr: { type: 'button' }, title: i18n('grid.cell.addCardTooltip') });
		setPhosphorIcon(addCardBtn, 'plus', '+');
		addCardBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.createNewCard(rowId, colId);
		});

		// Double-click on the wrapper = create a scene card (same as clicking the icon)
		wrapper.addEventListener('dblclick', (e) => {
			e.stopPropagation();
			this.createNewCard(rowId, colId);
		});

		// Right-click on an empty cell → add rows/columns relative to this cell
		wrapper.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.showCellContextMenu(e, rowId, colId);
		});
	}

	private showCellContextMenu(e: MouseEvent, rowId: string, colId: string): void {
		if (!this.gridData) return;
		const rowIndex = sortByOrder(this.gridData.rows).findIndex((r) => r.id === rowId);
		const colIndex = sortByOrder(this.gridData.columns).findIndex((c) => c.id === colId);

		const menu = new Menu();

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.addCardHere'))
			.setIcon('sticky-note')
			.onClick(() => this.createNewCard(rowId, colId)));

		menu.addSeparator();

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.addRowAbove'))
			.setIcon('arrow-up')
			.onClick(() => this.addRowAtIndex(rowIndex)));

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.addRowBelow'))
			.setIcon('arrow-down')
			.onClick(() => this.addRowAtIndex(rowIndex + 1)));

		menu.addSeparator();

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.addColumnLeft'))
			.setIcon('arrow-left')
			.onClick(() => this.addColumnAtIndex(colIndex)));

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.addColumnRight'))
			.setIcon('arrow-right')
			.onClick(() => this.addColumnAtIndex(colIndex + 1)));

		if (this.copiedCard) {
			menu.addSeparator();
			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.pasteCardHere'))
				.setIcon('clipboard')
				.onClick(() => this.pasteCard(rowId, colId)));
		}

		menu.showAtMouseEvent(e);
	}

	private renderCardText(el: HTMLElement, text: string): void {
		// Use Obsidian's MarkdownRenderer for rich rendering.
		// Fire-and-forget async — the element is in the DOM so updates will appear.
		runSafely(MarkdownRenderer.render(this.app, text, el, this.filePath, this));

		// Wire up link clicks — MarkdownRenderer renders <a> tags but doesn't
		// attach Obsidian-aware handlers in this context. We handle them here
		// so clicks don't bubble to the card expand/collapse listener.
		el.addEventListener('click', (e) => {
			const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>('a');
			if (!anchor) return;
			e.preventDefault();
			e.stopPropagation();
			const href = anchor.getAttribute('href') ?? '';
			if (href.startsWith('http://') || href.startsWith('https://')) {
				window.open(href, '_blank');
			} else if (href) {
				runSafely(this.app.workspace.openLinkText(href, this.filePath ?? ''));
			}
		});
	}

	// ─── Context Menus ────────────────────────────────────────────────────────

	/** `fromEditor`: opened by the card editor's ⋯ button — "Edit card" is left out (already editing). */
	private showCardContextMenu(e: MouseEvent, card: SceneCard, fromEditor = false): void {
		const menu = new Menu();

		if (!fromEditor) {
			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.editCard'))
				.setIcon('pencil')
				.onClick(() => this.openCardEditor(card)));
		}

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.linkToDocument'))
			.setIcon('link')
			.onClick(() => this.linkCardToDocument(card)));

		if (card.linkedDocPath) {
			const linkedFile = this.app.vault.getAbstractFileByPath(card.linkedDocPath);
			if (linkedFile instanceof TFile) {
				// Markdown only, same as the editor's button: a canvas isn't written in Write mode.
				if (linkedFile.extension === 'md') {
					menu.addItem((item) => item
						.setTitle(i18n('grid.menu.writeScene'))
						.setIcon('pencil-line')
						.onClick(() => this.openSceneForWriting(linkedFile)));
				}
				menu.addItem((item) => item
					.setTitle(i18n('grid.menu.snapshots'))
					.setIcon('history')
					.onClick(() => {
						new SnapshotBrowserModal(this.app, linkedFile.path, card.title.trim() || linkedFile.basename).open();
					}));
			}
		}

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.changeColor'))
			.setIcon('palette')
			.onClick(() => {
				const anchor = this.contentEl.querySelector(`[data-card-id="${card.id}"]`) as HTMLElement
					?? this.contentEl;
				ColorPickerPopover.show(anchor, {
					currentColor: card.color,
					palettes: this.plugin.settings.colorPalettes,
					activePaletteId: this.plugin.settings.activeColorPaletteId,
					savedColors: this.plugin.settings.savedColors ?? [],
					...this.colorPersistCallbacks(),
					onPreview: (color) => {
						const el = this.contentEl.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
						if (el) this.applyCardBackground(el, color);
					},
					onCommit: (color) => {
						if (!this.gridData) return;
						this.gridData = updateCard(this.gridData, card.id, { color });
						this.renderAll();
						this.scheduleSave();
					},
				});
			}));

		// Clear color — only offered when the card carries a non-default color
		const defaultCardColor = '#f5f7ff'; // matches the createCard default
		if (card.color && card.color.toLowerCase() !== defaultCardColor) {
			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.clearColor'))
				.setIcon('rotate-ccw')
				.onClick(() => {
					if (!this.gridData) return;
					this.gridData = updateCard(this.gridData, card.id, {
						color: defaultCardColor,
					});
					this.renderAll();
					this.scheduleSave();
				}));
		}

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.copyCardStyle'))
			.setIcon('paintbrush')
			.onClick(() => {
				this.copiedStyle = { color: card.color, frameColor: card.frameColor };
				new Notice(i18n('grid.notice.cardStyleCopied'));
			}));

		if (this.copiedStyle) {
			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.pasteCardStyle'))
				.setIcon('paint-bucket')
				.onClick(() => {
					if (!this.gridData || !this.copiedStyle) return;
					this.gridData = updateCard(this.gridData, card.id, {
						color: this.copiedStyle.color,
						frameColor: this.copiedStyle.frameColor,
					});
					this.renderAll();
					this.scheduleSave();
				}));
		}

		menu.addSeparator();

		// Only show "Create scene document" if the card isn't already linked to one
		if (!card.linkedDocPath) {
			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.createSceneDoc'))
				.setIcon('file-plus')
				.onClick(() => this.createSceneDocument(card)));
		}

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.createCharacterDoc'))
			.setIcon('user-plus')
			.onClick(() => this.createCharacterDocument(card)));

		menu.addSeparator();

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.copyCard'))
			.setIcon('copy')
			.onClick(() => this.copyCard(card)));

		// Not from the editor: "here" is the open card's own cell, so the paste would always be blocked.
		if (this.copiedCard && !fromEditor) {
			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.pasteCardHere'))
				.setIcon('clipboard')
				.onClick(() => this.pasteCard(card.rowId, card.colId)));
		}

		// Only show clear option if card has content or custom color
		const hasContent = card.title || card.synopsis || card.linkedDocPath || (card.tags && card.tags.length > 0) || card.color !== '#f5f7ff';
		if (hasContent) {
			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.clearCard'))
				.setIcon('eraser')
				.onClick(() => this.clearCard(card)));
		}

		if (this.lastClearedCard) {
			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.undoClearCard'))
				.setIcon('undo-2')
				.onClick(() => this.undoClearCard()));
		}

		menu.addItem((item) => item
			.setTitle(i18n('grid.menu.deleteCard'))
			.setIcon('trash-2')
			.onClick(() => this.deleteCardAction(card)));

		menu.showAtMouseEvent(e);
	}

	private bindRowHeaderContextMenu(el: HTMLElement, row: GridRow, rows: GridRow[]): void {
		el.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const menu = new Menu();
			const rowIndex = sortByOrder(rows).indexOf(row);

			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.renameRow'))
				.setIcon('pencil')
				.onClick(() => {
					const labelEl = el.querySelector<HTMLElement>('.sg-header-label');
					if (labelEl) this.makeHeaderEditable(labelEl, row.label, (newLabel) => {
						if (!this.gridData) return;
						this.gridData = renameRow(this.gridData, row.id, newLabel);
						this.scheduleSave();
					});
				}));

			menu.addSeparator();

			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.addRowAbove'))
				.setIcon('arrow-up')
				.onClick(() => this.addRowAtIndex(rowIndex)));

			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.addRowBelow'))
				.setIcon('arrow-down')
				.onClick(() => this.addRowAtIndex(rowIndex + 1)));

			menu.addSeparator();

			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.changeRowColor'))
				.setIcon('palette')
				.onClick(() => this.promptRowColor(row)));

			if (row.color) {
				menu.addItem((item) => item
					.setTitle(i18n('grid.menu.resetRowColor'))
					.setIcon('undo-2')
					.onClick(() => {
						if (!this.gridData) return;
						this.gridData = {
							...this.gridData,
							rows: this.gridData.rows.map((r) =>
								r.id === row.id ? { ...r, color: undefined } : r
							),
							updatedAt: new Date().toISOString(),
						};
						this.renderAll();
						this.scheduleSave();
					}));
			}

			if (row.height) {
				menu.addItem((item) => item
					.setTitle(i18n('grid.menu.resetRowHeight'))
					.setIcon('maximize-2')
					.onClick(() => {
						if (!this.gridData) return;
						this.gridData = {
							...this.gridData,
							rows: this.gridData.rows.map((r) =>
								r.id === row.id ? { ...r, height: undefined } : r
							),
							updatedAt: new Date().toISOString(),
						};
						this.renderAll();
						this.scheduleSave();
					}));
			}

			if (row.width) {
				menu.addItem((item) => item
					.setTitle(i18n('grid.menu.resetRowWidth'))
					.setIcon('maximize-2')
					.onClick(() => {
						if (!this.gridData) return;
						this.gridData = {
							...this.gridData,
							rows: this.gridData.rows.map((r) =>
								r.id === row.id ? { ...r, width: undefined } : r
							),
							updatedAt: new Date().toISOString(),
						};
						this.renderAll();
						this.scheduleSave();
					}));
			}

			menu.addSeparator();

			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.deleteRow'))
				.setIcon('trash-2')
				.onClick(() => this.deleteRowAction(row)));

			menu.showAtMouseEvent(e);
		});
	}

	private bindColHeaderContextMenu(el: HTMLElement, col: GridColumn, cols: GridColumn[]): void {
		el.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const menu = new Menu();
			const colIndex = sortByOrder(cols).indexOf(col);

			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.renameColumn'))
				.setIcon('pencil')
				.onClick(() => {
					const labelEl = el.querySelector<HTMLElement>('.sg-header-label');
					if (labelEl) this.makeHeaderEditable(labelEl, col.label, (newLabel) => {
						if (!this.gridData) return;
						this.gridData = renameColumn(this.gridData, col.id, newLabel);
						this.scheduleSave();
					});
				}));

			menu.addSeparator();

			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.addColumnLeft'))
				.setIcon('arrow-left')
				.onClick(() => this.addColumnAtIndex(colIndex)));

			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.addColumnRight'))
				.setIcon('arrow-right')
				.onClick(() => this.addColumnAtIndex(colIndex + 1)));

			menu.addSeparator();

			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.changeColumnColor'))
				.setIcon('palette')
				.onClick(() => this.promptColColor(col)));

			if (col.color) {
				menu.addItem((item) => item
					.setTitle(i18n('grid.menu.resetColumnColor'))
					.setIcon('undo-2')
					.onClick(() => {
						if (!this.gridData) return;
						this.gridData = {
							...this.gridData,
							columns: this.gridData.columns.map((c) =>
								c.id === col.id ? { ...c, color: undefined } : c
							),
							updatedAt: new Date().toISOString(),
						};
						this.renderAll();
						this.scheduleSave();
					}));
			}

			if (col.width) {
				menu.addItem((item) => item
					.setTitle(i18n('grid.menu.resetColumnWidth'))
					.setIcon('maximize-2')
					.onClick(() => {
						if (!this.gridData) return;
						this.gridData = {
							...this.gridData,
							columns: this.gridData.columns.map((c) =>
								c.id === col.id ? { ...c, width: undefined } : c
							),
							updatedAt: new Date().toISOString(),
						};
						this.renderAll();
						this.scheduleSave();
					}));
			}

			menu.addSeparator();

			menu.addItem((item) => item
				.setTitle(i18n('grid.menu.deleteColumn'))
				.setIcon('trash-2')
				.onClick(() => this.deleteColumnAction(col)));

			menu.showAtMouseEvent(e);
		});
	}

	// ─── Drag and Drop — Cards ────────────────────────────────────────────────

	/**
	 * Scroll the grid container when a drag hovers near its edges, so cards
	 * can be dropped on cells that are currently off-screen. Speed ramps up
	 * the closer the pointer is to the edge.
	 */
	private autoScrollGrid(clientX: number, clientY: number): void {
		const sc = this.scrollContainerEl;
		if (!sc) return;
		const rect = sc.getBoundingClientRect();
		const ZONE = 48, MAX = 18;
		let dx = 0, dy = 0;
		if (clientX < rect.left + ZONE) {
			dx = -Math.ceil(((rect.left + ZONE - clientX) / ZONE) * MAX);
		} else if (clientX > rect.right - ZONE) {
			dx = Math.ceil(((clientX - (rect.right - ZONE)) / ZONE) * MAX);
		}
		if (clientY < rect.top + ZONE) {
			dy = -Math.ceil(((rect.top + ZONE - clientY) / ZONE) * MAX);
		} else if (clientY > rect.bottom - ZONE) {
			dy = Math.ceil(((clientY - (rect.bottom - ZONE)) / ZONE) * MAX);
		}
		if (dx) sc.scrollLeft += dx;
		if (dy) sc.scrollTop += dy;
	}

	private bindCardDrag(el: HTMLElement, card: SceneCard): void {
		const doc = el.doc;
		let startX = 0;
		let startY = 0;
		let cursorX = 0;
		let cursorY = 0;
		let grabFracX = 0.5; // where in the card the user grabbed, as a 0..1 fraction
		let grabFracY = 0.5; // (zoom-independent, so the ghost stays pinned at any zoom)
		let isDragging = false;
		let rafId: number | null = null;
		let lastCell: HTMLElement | null = null;
		let liveSwapEl: HTMLElement | null = null; // occupant card currently preview-slid
		let dragScale = 1; // grid zoom scale, measured once when the drag starts (see measureGridScale)

		const restoreLiveSwap = (animate: boolean) => {
			if (!liveSwapEl) return;
			liveSwapEl.toggleClass('sg-slide', animate);
			liveSwapEl.toggleClass('sg-no-transition', !animate);
			liveSwapEl.setCssStyles({ transform: '' });
			liveSwapEl.removeClass('sg-card--live-swap');
			const prev = liveSwapEl;
			if (animate) window.setTimeout(() => { prev.removeClass('sg-slide'); }, 220);
			liveSwapEl = null;
		};

		const cleanup = () => {
			if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }
			this.dragGhost?.remove();
			this.dragGhost = null;
			el.classList.remove('sg-dragging');
			lastCell?.classList.remove('sg-drag-over');
			restoreLiveSwap(false);
			lastCell = null;
			this.dragCardId = null;
			this.dragType = null;
			isDragging = false;
			doc.body.removeClass('sg-body-grabbing', 'sg-body-col-resize', 'sg-body-row-resize');
		};

		const onPointerMove = (e: PointerEvent) => {
			cursorX = e.clientX;
			cursorY = e.clientY;

			// Activate drag once cursor moves more than 5px from start
			if (!isDragging) {
				if (Math.hypot(cursorX - startX, cursorY - startY) < 5) return;
				isDragging = true;
				dragScale = this.measureGridScale();
				this.dragType = 'card';
				this.dragCardId = card.id;
				doc.body.addClass('sg-body-grabbing');

				// Collapse before cloning — must also reset inline minHeight or ghost inherits expanded size
				el.classList.remove('sg-card--expanded');
				const collapseH = (this.gridData?.rows.find(r => r.id === card.rowId)?.height ?? 130) - 6;
				el.style.minHeight = `${collapseH}px`;
				// Mark source as placeholder
				el.classList.add('sg-dragging');

				// Build lifted ghost clone
				const ghost = el.cloneNode(true) as HTMLElement;
				ghost.classList.add('sg-drag-ghost');
				ghost.classList.remove('sg-dragging', 'sg-drag-swap');
				// The ghost is a clone in <body> (NOT zoomed). All of its positioning math
				// below is therefore in plain viewport px — it never reads a zoomed rect, so
				// it can't be thrown off by how the engine reports zoomed coordinates.
				//   SIZE: scale(z) matches the on-screen card; *1.06 is the subtle "lift",
				//         and the CSS transition on transform keeps the feathery feel.
				//   PIN:  the grab point (grabFrac × the ghost's own layout size) is the
				//         transform-origin — the fixed point of the scale, so the exact
				//         spot you grabbed stays under the cursor with no drift or tilt.
				// At z === 1 this is identical to the original behaviour.
				const z = this.zoomLevel;
				const glx = grabFracX * el.offsetWidth;   // grab point in the ghost's own px
				const gly = grabFracY * el.offsetHeight;
				ghost.style.width = `${el.offsetWidth}px`;
				ghost.style.transformOrigin = `${glx}px ${gly}px`;
				ghost.style.transform = `scale(${z * 1.06})`;
				ghost.style.left = `${cursorX - glx}px`;
				ghost.style.top  = `${cursorY - gly}px`;
				doc.body.appendChild(ghost);
				this.dragGhost = ghost;

				// rAF loop — updates ghost position each frame, GPU-smooth
				const tick = () => {
					if (!this.dragGhost) return;
					this.dragGhost.style.left = `${cursorX - glx}px`;
					this.dragGhost.style.top  = `${cursorY - gly}px`;
					this.autoScrollGrid(cursorX, cursorY);
					rafId = window.requestAnimationFrame(tick);
				};
				rafId = window.requestAnimationFrame(tick);
			}

			// Highlight the cell under the cursor
			// (ghost has pointer-events:none so elementFromPoint sees through it)
			const hit    = doc.elementFromPoint(cursorX, cursorY) as HTMLElement | null;
			const cell   = hit?.closest<HTMLElement>('[data-row-id][data-col-id]') ?? null;

			if (cell !== lastCell) {
				lastCell?.classList.remove('sg-drag-over');
				// Slide previous occupant back to its original position
				restoreLiveSwap(true);

				lastCell = cell;

				if (cell) {
					cell.classList.add('sg-drag-over');
					const occupant = cell.querySelector<HTMLElement>('.sg-card');
					if (occupant && occupant !== el) {
						// Slide occupant toward source cell immediately — live preview of the swap
						const sourceCell = el.closest<HTMLElement>('[data-row-id][data-col-id]');
						if (sourceCell) {
							const occRect = occupant.getBoundingClientRect();
							const srcRect = sourceCell.getBoundingClientRect();
							const dx = toLayoutPx(srcRect.left - occRect.left, dragScale);
							const dy = toLayoutPx(srcRect.top  - occRect.top,  dragScale);
							occupant.addClass('sg-card--live-swap'); // slide flat, not lifted
							occupant.removeClass('sg-no-transition');
							occupant.addClass('sg-slide');
							occupant.style.transform  = `translate(${dx}px, ${dy}px)`;
							liveSwapEl = occupant;
						}
					}
				}
			}
		};

		// Drag aborted by the browser (e.g. gesture claimed for scrolling) —
		// restore everything without committing a move.
		const onPointerCancel = () => {
			doc.removeEventListener('pointermove',   onPointerMove);
			doc.removeEventListener('pointerup',     onPointerUp);
			doc.removeEventListener('pointercancel', onPointerCancel);
			cleanup();
		};

		const onPointerUp = (e: PointerEvent) => {
			doc.removeEventListener('pointermove',   onPointerMove);
			doc.removeEventListener('pointerup',     onPointerUp);
			doc.removeEventListener('pointercancel', onPointerCancel);

			if (!isDragging) { cleanup(); return; }

			// Find drop target while ghost is still alive
			const hit  = doc.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
			const cell = hit?.closest<HTMLElement>('[data-row-id][data-col-id]') ?? null;

			// Capture the displaced card's current visual position + the source cell
			// BEFORE the re-render, so we can FLIP it smoothly into place too
			// (otherwise its in-progress slide gets wiped and it snaps).
			const swapRect = liveSwapEl ? liveSwapEl.getBoundingClientRect() : null;
			const srcCellEl = el.closest<HTMLElement>('[data-row-id][data-col-id]');
			const srcRowId = srcCellEl?.getAttribute('data-row-id') ?? null;
			const srcColId = srcCellEl?.getAttribute('data-col-id') ?? null;

			// ── Drop sequence ─────────────────────────────────────────────────
			if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }
			const ghost = this.dragGhost;
			this.dragGhost = null;
			// Reset shared state — don't restore liveSwapEl; re-render will replace it
			lastCell?.classList.remove('sg-drag-over');
			liveSwapEl = null;
			lastCell = null;
			this.dragCardId = null;
			this.dragType   = null;
			isDragging = false;
			doc.body.removeClass('sg-body-grabbing', 'sg-body-col-resize', 'sg-body-row-resize');
			if (!cell) {
				ghost?.remove();
				el.classList.remove('sg-dragging');
				return;
			}
			const ghostRect = ghost ? ghost.getBoundingClientRect() : null;
			// Remove ghost immediately — the FLIP card takes over from this position
			ghost?.remove();
			// Commit immediately — no delay
			const rowId = cell.getAttribute('data-row-id')!;
			const colId = cell.getAttribute('data-col-id')!;
			if (!this.gridData) return;
			this.gridData = moveCard(this.gridData, card.id, rowId, colId);
			this.renderGridOnly();
			this.scheduleSave();
			// FLIP dragged card from ghost position into new cell
			window.requestAnimationFrame(() => {
				const newCell = this.contentEl.querySelector<HTMLElement>(
					`td[data-row-id="${rowId}"][data-col-id="${colId}"]`
				);
				const droppedCard = newCell?.querySelector<HTMLElement>('.sg-card');
				if (droppedCard && ghostRect) {
					const nr = droppedCard.getBoundingClientRect();
					const dx = toLayoutPx(ghostRect.left - nr.left, dragScale);
					const dy = toLayoutPx(ghostRect.top  - nr.top,  dragScale);
					// Flat slide into place — same easing/duration as the displaced-card
					// slide, no scale/opacity pop, so it settles smoothly (no snap).
					droppedCard.addClass('sg-no-transition');
					droppedCard.style.transform  = `translate(${dx}px, ${dy}px)`;
					void droppedCard.offsetHeight;
					droppedCard.removeClass('sg-no-transition');
					droppedCard.addClass('sg-slide');
					droppedCard.setCssStyles({ transform: '' });
					window.setTimeout(() => {
						droppedCard.removeClass('sg-slide');
						droppedCard.setCssStyles({ transform: '' });
					}, 470);
				} else {
					droppedCard?.classList.add('sg-card--just-dropped');
				}
				// FLIP the displaced card from its mid-slide position into the source
				// cell, so it finishes smoothly instead of snapping on re-render.
				if (swapRect && srcRowId && srcColId) {
					const srcCellNew = this.contentEl.querySelector<HTMLElement>(
						`td[data-row-id="${srcRowId}"][data-col-id="${srcColId}"]`
					);
					const movedCard = srcCellNew?.querySelector<HTMLElement>('.sg-card');
					if (movedCard) {
						const mr = movedCard.getBoundingClientRect();
						const dx = toLayoutPx(swapRect.left - mr.left, dragScale);
						const dy = toLayoutPx(swapRect.top  - mr.top,  dragScale);
						movedCard.addClass('sg-no-transition');
						movedCard.style.transform  = `translate(${dx}px, ${dy}px)`;
						void movedCard.offsetHeight;
						movedCard.removeClass('sg-no-transition');
						movedCard.addClass('sg-slide');
						movedCard.setCssStyles({ transform: '' });
						window.setTimeout(() => {
							movedCard.removeClass('sg-slide');
							movedCard.setCssStyles({ transform: '' });
						}, 470);
					}
				}
			});
		};

		el.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;                                       // left-click only
			if (e.pointerType !== 'mouse') return; // touch uses the long-press system (bindTouchDrag)
			if ((e.target as HTMLElement).closest('.sg-card-edit-btn, .sg-card-header button')) return;
			e.preventDefault(); // prevent text selection on drag
			startX = e.clientX;
			startY = e.clientY;
			cursorX = e.clientX;
			cursorY = e.clientY;
			// Capture WHERE in the card the user grabbed, as a 0..1 fraction. We use
			// offsetX/offsetY (cursor relative to the clicked element) plus that element's
			// position within the card — all read from the SAME elements, so the values are
			// self-consistent regardless of whether the engine reports zoomed or un-zoomed
			// coordinates. This makes the grab point correct at any zoom level.
			const cardRect = el.getBoundingClientRect();
			const tgt = e.target as HTMLElement;
			const tr = tgt.getBoundingClientRect();
			const offInCardX = (tr.left - cardRect.left) + e.offsetX;
			const offInCardY = (tr.top  - cardRect.top ) + e.offsetY;
			grabFracX = cardRect.width  ? Math.max(0, Math.min(1, offInCardX / cardRect.width))  : 0.5;
			grabFracY = cardRect.height ? Math.max(0, Math.min(1, offInCardY / cardRect.height)) : 0.5;
			doc.addEventListener('pointermove',   onPointerMove);
			doc.addEventListener('pointerup',     onPointerUp);
			doc.addEventListener('pointercancel', onPointerCancel);
		});
	}

	private bindTouchDrag(el: HTMLElement, card: SceneCard): void {
		const doc = el.doc;
		el.addEventListener('touchstart', (e) => {
			// Long-press (350ms) activates touch drag to distinguish from scroll
			this.touchLongPressTimer = window.setTimeout(() => {
				this.touchDragCardId = card.id;
				this.touchDragSourceEl = el;
				el.classList.add('sg-dragging');

				// Create a visual ghost clone that follows the finger
				this.touchGhost = el.cloneNode(true) as HTMLElement;
				this.touchGhost.classList.add('sg-touch-ghost');
				this.touchGhost.style.width = `${el.offsetWidth}px`;
				doc.body.appendChild(this.touchGhost);

				// Position ghost under the finger immediately
				const touch = e.touches[0];
				this.moveTouchGhost(touch.clientX, touch.clientY);
			}, 350);
		}, { passive: true });

		el.addEventListener('touchmove', (e) => {
			// Cancel long-press if finger moves before 350ms
			if (!this.touchDragCardId) {
				if (this.touchLongPressTimer !== null) {
					window.clearTimeout(this.touchLongPressTimer);
					this.touchLongPressTimer = null;
				}
				return;
			}

			// Prevent page scroll while dragging a card
			e.preventDefault();
			const touch = e.touches[0];
			this.moveTouchGhost(touch.clientX, touch.clientY);
			this.autoScrollGrid(touch.clientX, touch.clientY);

			// Highlight the cell under the finger
			const target = doc.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
			const cell = target?.closest('[data-row-id][data-col-id]') as HTMLElement | null;

			if (cell !== this.touchLastTarget) {
				this.touchLastTarget?.classList.remove('sg-drag-over');
				cell?.classList.add('sg-drag-over');
				this.touchLastTarget = cell ?? null;
			}
		}, { passive: false });

		const endTouch = (e: TouchEvent) => {
			if (this.touchLongPressTimer !== null) {
				window.clearTimeout(this.touchLongPressTimer);
				this.touchLongPressTimer = null;
			}
			if (!this.touchDragCardId) return;

			const touch = e.changedTouches[0];
			const target = doc.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
			const cell = target?.closest('[data-row-id][data-col-id]') as HTMLElement | null;

			if (cell && this.gridData) {
				const rowId = cell.getAttribute('data-row-id')!;
				const colId = cell.getAttribute('data-col-id')!;
				this.gridData = moveCard(this.gridData, this.touchDragCardId, rowId, colId);
				this.renderGridOnly();
				this.scheduleSave();
			}

			this.cleanupTouchDrag();
		};

		el.addEventListener('touchend', endTouch);
		el.addEventListener('touchcancel', endTouch);
	}

	private moveTouchGhost(clientX: number, clientY: number): void {
		if (!this.touchGhost) return;
		this.touchGhost.style.left = `${clientX - this.touchGhost.offsetWidth / 2}px`;
		this.touchGhost.style.top  = `${clientY - 30}px`;
	}

	private cleanupTouchDrag(): void {
		this.touchGhost?.remove();
		this.touchGhost = null;
		this.touchDragSourceEl?.classList.remove('sg-dragging');
		this.touchDragSourceEl = null;
		this.touchDragCardId = null;
		this.touchLastTarget?.classList.remove('sg-drag-over');
		this.touchLastTarget = null;
	}

	// ─── Drag and Drop — Rows ─────────────────────────────────────────────────

	private bindRowHeaderDrag(el: HTMLElement, row: GridRow, rowIndex: number, rows: GridRow[]): void {
		const doc = el.doc;
		let startY = 0, cursorY = 0;
		let isDragging = false;
		let rafId: number | null = null;
		let hoverIndex = rowIndex;
		let lastHoverIndex = -1;
		let rowHeight = 130;
		const rowTrs = new Map<string, HTMLElement>();  // rowId → <tr>
		const rowMidYs: number[] = [];                  // snapshotted Y-centre of each row

		const applyShifts = (insertIdx: number) => {
			rows.forEach((r, i) => {
				if (i === rowIndex) return;
				let shift = 0;
				if (i > rowIndex && i <= insertIdx) shift = -rowHeight;
				else if (i < rowIndex && i >= insertIdx) shift = rowHeight;
				const tr = rowTrs.get(r.id);
				if (tr) tr.style.transform = shift !== 0 ? `translateY(${shift}px)` : '';
			});
		};

		const resetAll = () => {
			rowTrs.forEach(tr => { tr.removeClass('sg-slide'); tr.addClass('sg-no-transition'); });
			void this.contentEl.offsetHeight; // one reflow to flush transition:none
			rowTrs.forEach(tr => {
				tr.setCssStyles({ transform: '' });
				tr.removeClass('sg-will-transform', 'sg-no-transition');
			});
			el.classList.remove('sg-header--lifted');
			rowTrs.clear();
		};

		const onPointerMove = (e: PointerEvent) => {
			cursorY = e.clientY;
			if (!isDragging) {
				if (Math.abs(cursorY - startY) < 5) return;
				isDragging = true;
				this.dragType = 'row';
				this.dragRowIndex = rowIndex;
				doc.body.addClass('sg-body-grabbing');

				// Build <tr> map and snapshot mid-Y — scoped to this contentEl only
				rows.forEach((r, i) => {
					const header = this.contentEl.querySelector<HTMLElement>(
						`td.sg-row-header[data-row-id="${r.id}"]`
					);
					const tr = header?.closest<HTMLElement>('tr');
					if (!tr) return;
					rowTrs.set(r.id, tr);
					const rect = tr.getBoundingClientRect();
					rowMidYs[i] = rect.top + rect.height / 2;
				});

				const dragTr = rowTrs.get(row.id)!;
				rowHeight = dragTr.offsetHeight;
				dragTr.addClass('sg-no-transition', 'sg-will-transform');

				rows.forEach((r, i) => {
					if (i === rowIndex) return;
					const tr = rowTrs.get(r.id);
					if (tr) tr.addClass('sg-slide', 'sg-will-transform');
				});

				el.classList.add('sg-header--lifted');

				const dragTrRef = dragTr;
				const tick = () => {
					dragTrRef.style.transform = `translateY(${toLayoutPx(cursorY - startY, this.zoomLevel)}px)`;

					// Nearest row by pre-snapshotted distance — always resolves, no elementFromPoint
					let nearest = rowIndex, minDist = Infinity;
					rowMidYs.forEach((midY, i) => {
						if (i === rowIndex) return;
						const d = Math.abs(cursorY - midY);
						if (d < minDist) { minDist = d; nearest = i; }
					});
					hoverIndex = nearest;

					if (hoverIndex !== lastHoverIndex) {
						lastHoverIndex = hoverIndex;
						applyShifts(hoverIndex);
					}
					rafId = window.requestAnimationFrame(tick);
				};
				rafId = window.requestAnimationFrame(tick);
			}
		};

		const onPointerCancel = () => {
			doc.removeEventListener('pointermove',   onPointerMove);
			doc.removeEventListener('pointerup',     onPointerUp);
			doc.removeEventListener('pointercancel', onPointerCancel);
			if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }
			this.dragRowIndex = null;
			this.dragType = null;
			isDragging = false;
			hoverIndex = rowIndex;
			lastHoverIndex = -1;
			doc.body.removeClass('sg-body-grabbing', 'sg-body-col-resize', 'sg-body-row-resize');
			resetAll();
		};

		const onPointerUp = () => {
			doc.removeEventListener('pointermove',   onPointerMove);
			doc.removeEventListener('pointerup',     onPointerUp);
			doc.removeEventListener('pointercancel', onPointerCancel);
			if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }

			const toIndex = hoverIndex, didDrag = isDragging;
			this.dragRowIndex = null;
			this.dragType = null;
			isDragging = false;
			hoverIndex = rowIndex;
			lastHoverIndex = -1;
			doc.body.removeClass('sg-body-grabbing', 'sg-body-col-resize', 'sg-body-row-resize');
			resetAll();

			if (!didDrag || toIndex === rowIndex || !this.gridData) return;
			// Insert (not swap) — matches the drag preview, which slides every
			// intermediate row out of the way.
			const sorted = sortByOrder(this.gridData.rows);
			const [moved] = sorted.splice(rowIndex, 1);
			sorted.splice(toIndex, 0, moved);
			const reordered = sorted.map((r, i) => ({ ...r, order: i }));
			this.gridData = { ...this.gridData, rows: reordered, updatedAt: new Date().toISOString() };
			this.renderGridOnly();
			this.scheduleSave();
		};

		el.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			if (e.pointerType !== 'mouse') return; // header reorder is mouse-only for now
			const rect = el.getBoundingClientRect();
			if (e.clientY >= rect.bottom - this.EDGE_PX || e.clientX >= rect.right - this.EDGE_PX) return;
			e.preventDefault();
			startY = e.clientY; cursorY = e.clientY;
			hoverIndex = rowIndex; lastHoverIndex = -1;
			doc.addEventListener('pointermove',   onPointerMove);
			doc.addEventListener('pointerup',     onPointerUp);
			doc.addEventListener('pointercancel', onPointerCancel);
		});
	}

	// ─── Drag and Drop — Columns ──────────────────────────────────────────────

	private bindColHeaderDrag(el: HTMLElement, col: GridColumn, colIndex: number, cols: GridColumn[]): void {
		const doc = el.doc;
		let startX = 0, cursorX = 0;
		let isDragging = false;
		let rafId: number | null = null;
		let hoverIndex = colIndex;
		let lastHoverIndex = -1;
		let colWidth = 200;
		const colElems = new Map<string, HTMLElement[]>();
		const colMidXs: number[] = [];                  // snapshotted X-centre of each column header

		const applyShifts = (insertIdx: number) => {
			cols.forEach((c, i) => {
				if (i === colIndex) return;
				let shift = 0;
				if (i > colIndex && i <= insertIdx) shift = -colWidth;
				else if (i < colIndex && i >= insertIdx) shift = colWidth;
				(colElems.get(c.id) ?? []).forEach(e => {
					e.style.transform = shift !== 0 ? `translateX(${shift}px)` : '';
				});
			});
		};

		const resetAll = () => {
			colElems.forEach(elems => elems.forEach(e => { e.removeClass('sg-slide'); e.addClass('sg-no-transition'); }));
			void this.contentEl.offsetHeight;
			colElems.forEach(elems => elems.forEach(e => {
				e.setCssStyles({ transform: '' });
				e.removeClass('sg-will-transform', 'sg-no-transition');
			}));
			el.classList.remove('sg-header--lifted');
			el.removeClass('sg-no-pointer');
			colElems.clear();
		};

		const onPointerMove = (e: PointerEvent) => {
			cursorX = e.clientX;
			if (!isDragging) {
				if (Math.abs(cursorX - startX) < 5) return;
				isDragging = true;
				this.dragType = 'col';
				this.dragColIndex = colIndex;
				doc.body.addClass('sg-body-grabbing');

				// Snapshot column mid-X and build element map — scoped to this contentEl only
				cols.forEach((c, i) => {
					const th = this.contentEl.querySelector<HTMLElement>(
						`th.sg-col-header[data-col-id="${c.id}"]`
					);
					if (th) {
						const rect = th.getBoundingClientRect();
						colMidXs[i] = rect.left + rect.width / 2;
					}
					colElems.set(c.id, Array.from(
						this.contentEl.querySelectorAll<HTMLElement>(`[data-col-id="${c.id}"]`)
					));
				});

				colWidth = el.offsetWidth;
				const dragElems = colElems.get(col.id) ?? [];
				dragElems.forEach(e => { e.addClass('sg-no-transition', 'sg-will-transform'); });
				el.addClass('sg-no-pointer');

				cols.forEach((c, i) => {
					if (i === colIndex) return;
					(colElems.get(c.id) ?? []).forEach(e => { e.addClass('sg-slide', 'sg-will-transform'); });
				});

				el.classList.add('sg-header--lifted');

				const tick = () => {
					const dx = toLayoutPx(cursorX - startX, this.zoomLevel);
					dragElems.forEach(e => { e.style.transform = `translateX(${dx}px)`; });

					// Nearest column by pre-snapshotted distance — always resolves
					let nearest = colIndex, minDist = Infinity;
					colMidXs.forEach((midX, i) => {
						if (i === colIndex) return;
						const d = Math.abs(cursorX - midX);
						if (d < minDist) { minDist = d; nearest = i; }
					});
					hoverIndex = nearest;

					if (hoverIndex !== lastHoverIndex) {
						lastHoverIndex = hoverIndex;
						applyShifts(hoverIndex);
					}
					rafId = window.requestAnimationFrame(tick);
				};
				rafId = window.requestAnimationFrame(tick);
			}
		};

		const onPointerCancel = () => {
			doc.removeEventListener('pointermove',   onPointerMove);
			doc.removeEventListener('pointerup',     onPointerUp);
			doc.removeEventListener('pointercancel', onPointerCancel);
			if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }
			this.dragColIndex = null;
			this.dragType = null;
			isDragging = false;
			hoverIndex = colIndex;
			lastHoverIndex = -1;
			doc.body.removeClass('sg-body-grabbing', 'sg-body-col-resize', 'sg-body-row-resize');
			resetAll();
		};

		const onPointerUp = () => {
			doc.removeEventListener('pointermove',   onPointerMove);
			doc.removeEventListener('pointerup',     onPointerUp);
			doc.removeEventListener('pointercancel', onPointerCancel);
			if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }

			const toIndex = hoverIndex, didDrag = isDragging;
			this.dragColIndex = null;
			this.dragType = null;
			isDragging = false;
			hoverIndex = colIndex;
			lastHoverIndex = -1;
			doc.body.removeClass('sg-body-grabbing', 'sg-body-col-resize', 'sg-body-row-resize');
			resetAll();

			if (!didDrag || toIndex === colIndex || !this.gridData) return;
			// Insert (not swap) — matches the drag preview animation.
			const sorted = sortByOrder(this.gridData.columns);
			const [moved] = sorted.splice(colIndex, 1);
			sorted.splice(toIndex, 0, moved);
			const reordered = sorted.map((c, i) => ({ ...c, order: i }));
			this.gridData = { ...this.gridData, columns: reordered, updatedAt: new Date().toISOString() };
			this.renderGridOnly();
			this.scheduleSave();
		};

		el.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			if (e.pointerType !== 'mouse') return; // header reorder is mouse-only for now
			const rect = el.getBoundingClientRect();
			if (e.clientX >= rect.right - this.EDGE_PX) return;
			e.preventDefault();
			startX = e.clientX; cursorX = e.clientX;
			hoverIndex = colIndex; lastHoverIndex = -1;
			doc.addEventListener('pointermove',   onPointerMove);
			doc.addEventListener('pointerup',     onPointerUp);
			doc.addEventListener('pointercancel', onPointerCancel);
		});
	}

	// ─── Resize — visible handles + edge-zone fallback ───────────────────────
	//
	// Each column header carries a dedicated handle strip on its right edge
	// (row headers: bottom edge for height, right edge for width). The strips
	// have their own pointerdown listeners — no coordinate math, so they work
	// at every zoom level — and show an accent pill on header hover.
	// The old EDGE_PX rect check stays as a fallback (wider zone for touch).

	private readonly EDGE_PX = 10;

	/** Edge zone is wider for touch — a fingertip can't hit a 10px strip. */
	private edgeFor(pointerType: string): number {
		return pointerType === 'mouse' ? this.EDGE_PX : 24;
	}

	/**
	 * Pin width, min-width AND max-width together. Without the max, text-heavy
	 * cell content imposes a layout floor: the column can be dragged wider but
	 * silently refuses to shrink back.
	 */
	private pinWidth(el: HTMLElement, w: number): void {
		el.style.width = `${w}px`;
		el.style.minWidth = `${w}px`;
		el.style.maxWidth = `${w}px`;
	}

	private bindColEdgeResize(th: HTMLElement, col: GridColumn): void {
		const handle = th.createDiv({ cls: 'sg-resize-handle sg-resize-handle--col' });
		handle.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			this.startColResize(e, th, col);
		});

		th.addEventListener('mousemove', (e) => {
			const rect = th.getBoundingClientRect();
			th.toggleClass('sg-edge-col', e.clientX >= rect.right - this.EDGE_PX);
		});
		th.addEventListener('mouseleave', () => { th.removeClass('sg-edge-col'); });

		th.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			const rect = th.getBoundingClientRect();
			if (e.clientX < rect.right - this.edgeFor(e.pointerType)) return;
			this.startColResize(e, th, col);
		});
	}

	private startColResize(e: PointerEvent, th: HTMLElement, col: GridColumn): void {
		const doc = th.doc;
		e.preventDefault();
		e.stopPropagation();

		const startX = e.clientX;
		const startWidth = th.offsetWidth;
		th.classList.add('sg-col-header--resizing');
		doc.body.addClass('sg-body-col-resize');

		// Cache cells once so pointermove doesn't query DOM every frame
		const cells = Array.from(
			this.contentEl.querySelectorAll<HTMLElement>(`td[data-col-id="${col.id}"]`)
		);

		let rafId = 0;
		let done = false;
		const cleanup = () => {
			if (done) return;
			done = true;
			window.cancelAnimationFrame(rafId);
			th.classList.remove('sg-col-header--resizing');
			doc.body.removeClass('sg-body-grabbing', 'sg-body-col-resize', 'sg-body-row-resize');
			doc.removeEventListener('pointermove',   onMove);
			doc.removeEventListener('pointerup',     onUp);
			doc.removeEventListener('pointercancel', onUp);
		};

		const onMove = (moveEvt: PointerEvent) => {
			window.cancelAnimationFrame(rafId);
			rafId = window.requestAnimationFrame(() => {
				// clientX deltas are screen px; the table lives in zoomed px.
				const newWidth = Math.max(40, startWidth + (moveEvt.clientX - startX) / this.zoomLevel);
				this.pinWidth(th, newWidth);
				for (const td of cells) this.pinWidth(td, newWidth);
			});
		};

		const onUp = () => {
			window.cancelAnimationFrame(rafId);
			// Read the dragged target width from style — the last rAF may not
			// have painted yet, and offsetWidth can lag behind it.
			const finalWidth = Math.max(40, Math.round(parseFloat(th.style.width) || th.offsetWidth));
			cleanup();
			this.pinWidth(th, finalWidth);
			for (const td of cells) this.pinWidth(td, finalWidth);
			if (!this.gridData) return;
			this.gridData = {
				...this.gridData,
				columns: this.gridData.columns.map((c) =>
					c.id === col.id ? { ...c, width: finalWidth } : c
				),
				updatedAt: new Date().toISOString(),
			};
			this.scheduleSave();
		};

		doc.addEventListener('pointermove',   onMove);
		doc.addEventListener('pointerup',     onUp);
		doc.addEventListener('pointercancel', onUp);
	}

	private bindRowEdgeResize(rowHeader: HTMLElement, row: GridRow, tr: HTMLElement): void {
		const heightHandle = rowHeader.createDiv({ cls: 'sg-resize-handle sg-resize-handle--row-h' });
		heightHandle.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			this.startRowHeightResize(e, rowHeader, row, tr);
		});
		const widthHandle = rowHeader.createDiv({ cls: 'sg-resize-handle sg-resize-handle--row-w' });
		widthHandle.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			this.startRowWidthResize(e, rowHeader);
		});

		rowHeader.addEventListener('mousemove', (e) => {
			const rect = rowHeader.getBoundingClientRect();
			const nearRight = e.clientX >= rect.right - this.EDGE_PX;
			const nearBottom = !nearRight && e.clientY >= rect.bottom - this.EDGE_PX;
			rowHeader.toggleClass('sg-edge-col', nearRight);
			rowHeader.toggleClass('sg-edge-row', nearBottom);
		});
		rowHeader.addEventListener('mouseleave', () => { rowHeader.removeClass('sg-edge-col', 'sg-edge-row'); });

		rowHeader.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			const rect = rowHeader.getBoundingClientRect();
			const edge = this.edgeFor(e.pointerType);
			if (e.clientX >= rect.right - edge) {
				this.startRowWidthResize(e, rowHeader);
			} else if (e.clientY >= rect.bottom - edge) {
				this.startRowHeightResize(e, rowHeader, row, tr);
			}
		});
	}

	/** Right-edge drag on a row header — resizes ALL row headers together. */
	private startRowWidthResize(e: PointerEvent, rowHeader: HTMLElement): void {
		const doc = rowHeader.doc;
		e.preventDefault();
		e.stopPropagation();

		const startX = e.clientX;
		const startWidth = rowHeader.offsetWidth;
		rowHeader.classList.add('sg-row-header--resizing');
		doc.body.addClass('sg-body-col-resize');

		// Get all row headers and the corner cell
		const allRowHeaders = Array.from(
			this.contentEl.querySelectorAll<HTMLElement>('td.sg-row-header')
		);
		const corner = this.contentEl.querySelector<HTMLElement>('.sg-corner');

		let rafId = 0;
		let done = false;
		const cleanup = () => {
			if (done) return;
			done = true;
			window.cancelAnimationFrame(rafId);
			rowHeader.classList.remove('sg-row-header--resizing');
			doc.body.removeClass('sg-body-grabbing', 'sg-body-col-resize', 'sg-body-row-resize');
			doc.removeEventListener('pointermove',   onMove);
			doc.removeEventListener('pointerup',     onUp);
			doc.removeEventListener('pointercancel', onUp);
		};

		const onMove = (moveEvt: PointerEvent) => {
			window.cancelAnimationFrame(rafId);
			rafId = window.requestAnimationFrame(() => {
				const newWidth = Math.max(40, startWidth + (moveEvt.clientX - startX) / this.zoomLevel);
				allRowHeaders.forEach((rh) => this.pinWidth(rh, newWidth));
				if (corner) this.pinWidth(corner, newWidth);
			});
		};

		const onUp = () => {
			window.cancelAnimationFrame(rafId);
			const finalWidth = Math.max(40, Math.round(parseFloat(rowHeader.style.width) || rowHeader.offsetWidth));
			cleanup();
			allRowHeaders.forEach((rh) => this.pinWidth(rh, finalWidth));
			if (corner) this.pinWidth(corner, finalWidth);
			if (!this.gridData) return;
			// Update all rows with the new width
			this.gridData = {
				...this.gridData,
				rows: this.gridData.rows.map((r) => ({ ...r, width: finalWidth })),
				updatedAt: new Date().toISOString(),
			};
			this.scheduleSave();
		};

		doc.addEventListener('pointermove',   onMove);
		doc.addEventListener('pointerup',     onUp);
		doc.addEventListener('pointercancel', onUp);
	}

	/** Bottom-edge drag on a row header — resizes that row's height. */
	private startRowHeightResize(e: PointerEvent, rowHeader: HTMLElement, row: GridRow, tr: HTMLElement): void {
		const doc = rowHeader.doc;
		e.preventDefault();
		e.stopPropagation();

		const startY = e.clientY;
		const startHeight = tr.offsetHeight;
		rowHeader.classList.add('sg-row-header--resizing');
		doc.body.addClass('sg-body-row-resize');

		let rafId = 0;
		let done = false;
		const cleanup = () => {
			if (done) return;
			done = true;
			window.cancelAnimationFrame(rafId);
			rowHeader.classList.remove('sg-row-header--resizing');
			doc.body.removeClass('sg-body-grabbing', 'sg-body-col-resize', 'sg-body-row-resize');
			doc.removeEventListener('pointermove',   onMove);
			doc.removeEventListener('pointerup',     onUp);
			doc.removeEventListener('pointercancel', onUp);
		};

		const onMove = (moveEvt: PointerEvent) => {
			window.cancelAnimationFrame(rafId);
			rafId = window.requestAnimationFrame(() => {
				const newHeight = Math.max(40, startHeight + (moveEvt.clientY - startY) / this.zoomLevel);
				tr.style.height = `${newHeight}px`;
				// Keep cards in this row filling the cell as it resizes
				tr.querySelectorAll<HTMLElement>('.sg-card:not(.sg-card--expanded)').forEach((c) => {
					c.style.minHeight = `${newHeight - 6}px`;
					c.style.maxHeight = `${newHeight - 6}px`;
				});
			});
		};

		const onUp = () => {
			window.cancelAnimationFrame(rafId);
			const finalHeight = Math.max(40, parseInt(tr.style.height) || tr.offsetHeight);
			cleanup();
			if (!this.gridData) return;
			this.gridData = {
				...this.gridData,
				rows: this.gridData.rows.map((r) =>
					r.id === row.id ? { ...r, height: finalHeight } : r
				),
				updatedAt: new Date().toISOString(),
			};
			this.scheduleSave();
			this.renderGridOnly();
		};

		doc.addEventListener('pointermove',   onMove);
		doc.addEventListener('pointerup',     onUp);
		doc.addEventListener('pointercancel', onUp);
	}

	// ─── Grid Mutations ───────────────────────────────────────────────────────

	addRow(): void {
		if (!this.gridData) return;
		const maxOrder = Math.max(0, ...this.gridData.rows.map((r) => r.order));
		const row = createRow(i18n('grid.default.newRow'), maxOrder + 1);
		this.gridData = { ...this.gridData, rows: [...this.gridData.rows, row] };
		this.renderGridOnly();
		this.scheduleSave();
	}

	addColumn(): void {
		if (!this.gridData) return;
		const maxOrder = Math.max(0, ...this.gridData.columns.map((c) => c.order));
		const col = createColumn(i18n('grid.default.newColumn'), maxOrder + 1);
		this.gridData = { ...this.gridData, columns: [...this.gridData.columns, col] };
		this.renderGridOnly();
		this.scheduleSave();
	}

	private addRowAtIndex(insertIndex: number): void {
		if (!this.gridData) return;
		const sorted = sortByOrder(this.gridData.rows);
		// Shift orders of rows at or after the insert position
		sorted.forEach((r, i) => { if (i >= insertIndex) r.order += 1; });
		const row = createRow(i18n('grid.default.newRow'), insertIndex);
		this.gridData = { ...this.gridData, rows: [...sorted, row] };
		this.renderGridOnly();
		this.scheduleSave();
	}

	private addColumnAtIndex(insertIndex: number): void {
		if (!this.gridData) return;
		const sorted = sortByOrder(this.gridData.columns);
		sorted.forEach((c, i) => { if (i >= insertIndex) c.order += 1; });
		const col = createColumn(i18n('grid.default.newColumn'), insertIndex);
		this.gridData = { ...this.gridData, columns: [...sorted, col] };
		this.renderGridOnly();
		this.scheduleSave();
	}

	private createNewCard(rowId: string, colId: string): void {
		if (!this.gridData) return;
		// Default card color: use the row's color if set, else light default
		// (rendering layer handles dark theme conversion at display time)
		const row = this.gridData.rows.find((r) => r.id === rowId);
		const col = this.gridData.columns.find((c) => c.id === colId);
		const cardColor = row?.color ?? '#f5f7ff';
		const card = createCard(rowId, colId, {
			color: cardColor,
		});
		if (!this.gridData.cards.some((c) => !c.guide)) {
			this.plugin.celebrateMilestone('first-card', i18n('grid.milestone.firstCard'));
		}
		this.gridData = { ...this.gridData, cards: [...this.gridData.cards, card] };
		// Set default row height and column width if not already set, using actual rendered cell size
		const cellEl = this.containerEl.querySelector<HTMLElement>(
			`td[data-row-id="${rowId}"][data-col-id="${colId}"]`
		);
		if (row && !row.height) {
			const measuredHeight = cellEl ? cellEl.offsetHeight : 120;
			this.gridData = {
				...this.gridData,
				rows: this.gridData.rows.map((r) =>
					r.id === rowId ? { ...r, height: Math.max(40, measuredHeight) } : r
				),
			};
		}
		if (col && !col.width) {
			const measuredWidth = cellEl ? cellEl.offsetWidth : 150;
			this.gridData = {
				...this.gridData,
				columns: this.gridData.columns.map((c) =>
					c.id === colId ? { ...c, width: Math.max(80, measuredWidth) } : c
				),
			};
		}
		// Render grid with new card, then open its editor without the flicker
		this.renderAll();
		this.scheduleSave();
		this.openSidePanel(card);
	}

	private copyCard(card: SceneCard): void {
		const linkedCopy: Record<string, string[]> = {};
		for (const [k, v] of Object.entries(card.linkedEntityPaths ?? {})) linkedCopy[k] = [...v];
		this.copiedCard = { ...card, tags: [...(card.tags ?? [])], characterPaths: [...(card.characterPaths ?? [])], linkedEntityPaths: linkedCopy };
		new Notice(i18n('grid.notice.cardCopied'));
	}

	private pasteCard(targetRowId: string, targetColId: string): void {
		if (!this.gridData || !this.copiedCard) return;
		const existing = findCard(this.gridData.cards, targetRowId, targetColId);
		if (existing) {
			new Notice(i18n('grid.notice.pasteBlocked'));
			return;
		}
		const newCard: SceneCard = {
			...this.copiedCard,
			id: crypto.randomUUID(),
			rowId: targetRowId,
			colId: targetColId,
			guide: undefined, // a pasted copy is the writer's own card, not the template's Beat guide
		};
		this.gridData = { ...this.gridData, cards: [...this.gridData.cards, newCard] };
		this.renderAll();
		this.scheduleSave();
	}

	private clearCard(card: SceneCard): void {
		if (!this.gridData) return;
		// Save the card state for undo before clearing
		this.lastClearedCard = { ...card };
		// If this card is open in the panel, discard its draft and close cleanly
		// (discard first so closeSidePanel doesn't re-commit the old values).
		if (this.panelCardId === card.id) {
			this.cancelDraftTimer();
			this._panelDraft = null;
			this.closeSidePanel();
		}
		this.gridData = updateCard(this.gridData, card.id, {
			title: '',
			synopsis: '',
			status: 'idea',
			linkedDocPath: undefined,
			tags: [],
			color: '#f5f7ff',
		});
		// Re-render only the grid — avoids tearing down/reopening the panel (flicker)
		this.renderGridOnly();
		this.scheduleSave();
	}

	private undoClearCard(): void {
		if (!this.lastClearedCard || !this.gridData) return;
		const card = this.lastClearedCard;
		this.gridData = updateCard(this.gridData, card.id, {
			title: card.title,
			synopsis: card.synopsis,
			status: card.status,
			linkedDocPath: card.linkedDocPath,
			tags: card.tags,
			color: card.color,
			frameColor: card.frameColor,
		});
		this.lastClearedCard = null;
		// An editor open on this card holds the blanked copy; redrawing everything reopens it from the
		// restored card, so typing there can't wipe the restored tags/title.
		if (this.panelCardId === card.id) this.renderAll();
		else this.renderGridOnly();
		this.scheduleSave();
	}

	/** Delete a card — asks first unless the user ticked "Don't ask me again" (Plot Grid settings turns it back on).
	 *  Only the card goes: a linked scene page always stays in the vault (cards and scene pages are decoupled). */
	private deleteCardAction(card: SceneCard): void {
		if (!this.gridData) return;
		if (this.plugin.settings.confirmCardDelete === false) { this.performDeleteCard(card); return; }
		const name = card.title.trim() || i18n('grid.delete.untitledCard');
		const message = card.linkedDocPath
			? i18n('grid.confirm.deleteCardLinked', { name })
			: i18n('grid.confirm.deleteCard', { name });
		new ConfirmModal(this.app, message, i18n('grid.menu.deleteCard'), () => this.performDeleteCard(card), undefined, {
			label: i18n('grid.confirm.dontAskAgain'),
			onConfirmDontAsk: () => {
				this.plugin.settings.confirmCardDelete = false;
				void this.plugin.saveSettings();
			},
		}).open();
	}

	private performDeleteCard(card: SceneCard): void {
		if (!this.gridData) return;
		if (this.panelCardId === card.id) {
			this.cancelDraftTimer();
			this._panelDraft = null;
			this.closeSidePanel();
		}
		this.gridData = deleteCard(this.gridData, card.id);
		// Re-render only the grid — avoids tearing down/reopening the panel (flicker)
		this.renderGridOnly();
		this.scheduleSave();
	}

	// ─── Row / column delete: confirm, then an Undo toast ─────────────────────
	// Deleting a row or column deletes every card in it, so it always asks first
	// (the dialog says how many cards go, and Cancel has the focus) and afterwards
	// offers Undo for a few seconds. Undo puts back exactly what was removed — it
	// does not roll the whole grid back, so edits made in the meantime survive.

	private deleteRowAction(row: GridRow): void {
		if (!this.gridData) return;
		const name = row.label.trim() || i18n('grid.delete.unnamedRow');
		const count = cardsInRow(this.gridData, row.id).length;
		const message = count === 0
			? i18n('grid.confirm.deleteRowEmpty', { name })
			: count === 1
				? i18n('grid.confirm.deleteRowOne', { name })
				: i18n('grid.confirm.deleteRowMany', { name, count });
		new ConfirmModal(this.app, message, i18n('grid.menu.deleteRow'), () => this.performDeleteRow(row.id, name)).open();
	}

	private deleteColumnAction(col: GridColumn): void {
		if (!this.gridData) return;
		const name = col.label.trim() || i18n('grid.delete.unnamedColumn');
		const count = cardsInColumn(this.gridData, col.id).length;
		const message = count === 0
			? i18n('grid.confirm.deleteColumnEmpty', { name })
			: count === 1
				? i18n('grid.confirm.deleteColumnOne', { name })
				: i18n('grid.confirm.deleteColumnMany', { name, count });
		new ConfirmModal(this.app, message, i18n('grid.menu.deleteColumn'), () => this.performDeleteColumn(col.id, name)).open();
	}

	/** Close the card editor first if its card is about to be deleted (this saves its draft, so the Undo snapshot is current). */
	private closePanelIfShowingAnyOf(cards: SceneCard[]): void {
		if (this.panelCardId && cards.some((c) => c.id === this.panelCardId)) this.closeSidePanel();
	}

	private performDeleteRow(rowId: string, name: string): void {
		// Read the grid fresh: the dialog was open, and the grid may have changed under it.
		if (!this.gridData) return;
		this.closePanelIfShowingAnyOf(cardsInRow(this.gridData, rowId));
		const deleted = snapshotRow(this.gridData, rowId);
		if (!deleted) return;
		const origin = { gridId: this.gridData.id, filePath: this.filePath };
		this.gridData = deleteRow(this.gridData, rowId);
		this.renderAll();
		this.scheduleSave();
		this.showUndoToast(i18n('grid.undo.deletedRow', { name }), () => {
			if (!this.isSameGrid(origin) || !this.gridData) { new Notice(i18n('grid.undo.unavailable')); return; }
			const offered = { ...deleted, cards: [...deleted.cards, ...this._undoPool] };
			this.gridData = restoreRow(this.gridData, offered);
			this._undoPool = pendingCards(this.gridData, offered.cards);
			this.renderAll();
			this.scheduleSave();
			new Notice(i18n('grid.undo.doneRow', { name }));
		});
	}

	private performDeleteColumn(colId: string, name: string): void {
		if (!this.gridData) return;
		this.closePanelIfShowingAnyOf(cardsInColumn(this.gridData, colId));
		const deleted = snapshotColumn(this.gridData, colId);
		if (!deleted) return;
		const origin = { gridId: this.gridData.id, filePath: this.filePath };
		this.gridData = deleteColumn(this.gridData, colId);
		this.renderAll();
		this.scheduleSave();
		this.showUndoToast(i18n('grid.undo.deletedColumn', { name }), () => {
			if (!this.isSameGrid(origin) || !this.gridData) { new Notice(i18n('grid.undo.unavailable')); return; }
			const offered = { ...deleted, cards: [...deleted.cards, ...this._undoPool] };
			this.gridData = restoreColumn(this.gridData, offered);
			this._undoPool = pendingCards(this.gridData, offered.cards);
			this.renderAll();
			this.scheduleSave();
			new Notice(i18n('grid.undo.doneColumn', { name }));
		});
	}

	/** True while this view still shows the grid an Undo was made for. */
	private isSameGrid(origin: { gridId: string; filePath: string }): boolean {
		return this._viewOpen && this.gridData?.id === origin.gridId && this.filePath === origin.filePath;
	}

	/** A notice carrying the message and an Undo button. Long enough to reach on a phone; one press only. */
	private showUndoToast(message: string, onUndo: () => void): void {
		const fragment = createFragment();
		const text = createSpan();
		text.textContent = message;
		const button = createEl('button');
		button.className = 'mod-cta sg-undo-toast-btn';
		button.textContent = i18n('grid.undo.button');
		fragment.append(text, button);
		const notice = new Notice(fragment, 10000);
		let used = false;
		button.addEventListener('click', () => {
			if (used) return;
			used = true;
			notice.hide();
			onUndo();
		});
	}

	// ─── Rename prompts (inline, using a simple input overlay) ───────────────

	private makeHeaderEditable(
		labelEl: HTMLElement,
		originalValue: string,
		onSave: (newValue: string) => void
	): void {
		if (labelEl.contentEditable === 'true') return; // already editing

		// Disable drag on parent while editing
		const draggableParent = labelEl.closest<HTMLElement>('[draggable]');
		if (draggableParent) draggableParent.draggable = false;

		labelEl.contentEditable = 'true';
		labelEl.classList.add('sg-header-label--editing');
		labelEl.focus();

		// Select all text
		const range = labelEl.doc.createRange();
		range.selectNodeContents(labelEl);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);

		let committed = false;
		const commit = () => {
			if (committed) return;
			committed = true;
			const newValue = (labelEl.textContent ?? '').trim();
			labelEl.contentEditable = 'false';
			labelEl.classList.remove('sg-header-label--editing');
			if (draggableParent) draggableParent.draggable = true;
			labelEl.removeEventListener('keydown', onKeydown);
			labelEl.removeEventListener('blur', onBlur);
			if (newValue && newValue !== originalValue) {
				onSave(newValue);
			} else {
				// Restore original text without a full re-render
				labelEl.textContent = originalValue;
			}
		};

		const onKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Enter') { e.preventDefault(); commit(); }
			if (e.key === 'Escape') {
				labelEl.textContent = originalValue;
				committed = true; // prevent save
				labelEl.contentEditable = 'false';
				labelEl.classList.remove('sg-header-label--editing');
				if (draggableParent) draggableParent.draggable = true;
				labelEl.removeEventListener('keydown', onKeydown);
				labelEl.removeEventListener('blur', onBlur);
			}
		};

		const onBlur = () => commit();

		labelEl.addEventListener('keydown', onKeydown);
		labelEl.addEventListener('blur', onBlur);
	}

	private readonly LIGHT_DEFAULT_COLORS = ['#fafafa', '#f5f4f2', '#f0f4ff', '#f5f7ff', '#ffffff'];

	applyCardBackground(el: HTMLElement, color: string): void {
		// The fill reaches the card as a custom property (.sg-card--filled in styles.css);
		// no colour at all means the stylesheet's own card background.
		if (!color) {
			el.removeClass('sg-card--filled');
			el.setCssProps({ '--sg-card-fill': '' });
			return;
		}
		const fill = this.LIGHT_DEFAULT_COLORS.includes(color.toLowerCase()) ? 'var(--sg-default-card-bg)' : color;
		el.addClass('sg-card--filled');
		el.setCssProps({ '--sg-card-fill': fill });
	}

	/** Shared persist callbacks for the color picker's Saved-colors strip + Save-as-palette. */
	private colorPersistCallbacks(): {
		onSaveColor: (c: string) => void;
		onRemoveSaved: (c: string) => void;
		onCreatePalette: (colors: string[]) => { id: string; name: string; colors: string[] } | null;
	} {
		return {
			onSaveColor: (c: string) => {
				const saved = [...(this.plugin.settings.savedColors ?? [])];
				if (!saved.includes(c)) {
					this.plugin.settings.savedColors = [c, ...saved].slice(0, 32);
					void this.plugin.saveSettings();
				}
			},
			onRemoveSaved: (c: string) => {
				this.plugin.settings.savedColors = (this.plugin.settings.savedColors ?? []).filter((x) => x !== c);
				void this.plugin.saveSettings();
			},
			onCreatePalette: (colors: string[]) => {
				if (!colors.length) return null;
				const palettes = this.plugin.settings.colorPalettes;
				const pal = { id: generateId(), name: i18n('grid.default.paletteName', { n: palettes.length + 1 }), colors: [...colors] };
				palettes.push(pal);
				void this.plugin.saveSettings();
				new Notice(i18n('grid.notice.paletteSaved', { name: pal.name }));
				return pal;
			},
		};
	}

	private promptRowColor(row: GridRow): void {
		// Find the row header element to anchor the popover
		const anchor = this.contentEl.querySelector(`[data-row-id="${row.id}"].sg-row-header`) as HTMLElement
			?? this.contentEl.doc.body;

		ColorPickerPopover.show(anchor, {
			currentColor: row.color || '#cccccc',
			palettes: this.plugin.settings.colorPalettes,
			activePaletteId: this.plugin.settings.activeColorPaletteId,
			savedColors: this.plugin.settings.savedColors ?? [],
			...this.colorPersistCallbacks(),
			onCommit: (color) => {
				if (!this.gridData) return;
				this.gridData = setRowColor(this.gridData, row.id, color);
				this.renderAll();
				this.scheduleSave();
			},
		});
	}

	private promptColColor(col: GridColumn): void {
		const anchor = this.contentEl.querySelector(`[data-col-id="${col.id}"].sg-col-header`) as HTMLElement
			?? this.contentEl.doc.body;

		ColorPickerPopover.show(anchor, {
			currentColor: col.color || '#cccccc',
			palettes: this.plugin.settings.colorPalettes,
			activePaletteId: this.plugin.settings.activeColorPaletteId,
			savedColors: this.plugin.settings.savedColors ?? [],
			...this.colorPersistCallbacks(),
			onCommit: (color) => {
				if (!this.gridData) return;
				this.gridData = setColumnColor(this.gridData, col.id, color);
				this.renderAll();
				this.scheduleSave();
			},
		});
	}

	// ─── Compile manuscript (Longform-style) ──────────────────────────────────

	/** Word count of a linked markdown doc, cached until the file changes. */
	private async getDocWordCount(path: string): Promise<number | null> {
		return docWordCount(this.app, path, this._wordCountCache);
	}

	// ─── Save layout as template ──────────────────────────────────────────────

	private saveLayoutAsTemplate(): void {
		if (!this.gridData) return;
		// Beat guide cards travel back into the layout as row hints (with their current, possibly edited text),
		// and their column is left out — applyTemplate rebuilds both, so the layout never saves a hollow guide column.
		const guides = this.gridData.cards.filter((c) => c.guide);
		const guideCols = new Set(guides.map((c) => c.colId));
		const hintFor = (rowId: string): string | undefined => {
			const g = guides.find((c) => c.rowId === rowId);
			if (!g) return undefined;
			const title = g.title?.trim() ?? '';
			const synopsis = g.synopsis?.trim() ?? '';
			// applyTemplate splits on " · ": keep the separator after a title so it stays the title.
			if (title) return `${title} · ${synopsis}`;
			return synopsis || undefined;
		};
		const rows = sortByOrder(this.gridData.rows).map(({ id, label, color }) => {
			const hint = hintFor(id);
			return hint ? { label, color, hint } : { label, color };
		});
		const columns = sortByOrder(this.gridData.columns)
			.filter((c) => !guideCols.has(c.id) || this.gridData!.cards.some((k) => k.colId === c.id && !k.guide))
			.map(({ label, color }) => ({ label, color }));

		new SaveLayoutModal(this.app, rows, columns, (template) => { runSafely((async () => {
			this.plugin.settings.customTemplates.push(template);
			await this.plugin.saveSettings();
			new Notice(i18n('grid.notice.templateSaved', { name: template.name }));
		})()); }).open();
	}


	// ─── Document linking ─────────────────────────────────────────────────────

	private linkCardToDocument(card: SceneCard): void {
		new LinkDocModal(this.app, (file: TFile) => {
			if (!this.gridData) return;
			const priorLink = this.gridData.cards.find((c) => c.id === card.id)?.linkedDocPath;
			this.gridData = updateCard(this.gridData, card.id, {
				linkedDocPath: file.path,
				linkDisplayMode: 'synopsis',
			});
			this.renderAll();
			this.scheduleSave();
			this.pushCardToNewlyLinkedDoc(card.id, priorLink);
		}).open();
	}

	/**
	 * A card just linked to a note outside the editor: the note gains the card's
	 * tags, and its summary if it has none. Nothing happens when the link is unchanged.
	 */
	private pushCardToNewlyLinkedDoc(cardId: string, priorLink: string | undefined): void {
		const live = this.gridData?.cards.find((c) => c.id === cardId);
		if (!live?.linkedDocPath || live.linkedDocPath === priorLink) return;
		this.syncTagChangesToLinkedDoc(live.linkedDocPath, [...(live.tags ?? [])], []);
		this.syncSynopsisToLinkedDoc(live, false);
	}

	private async openLinkedDoc(filePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await openOrReveal(this.app, file);
		} else {
			new Notice(i18n('grid.notice.linkedFileNotFound', { path: filePath }));
		}
	}

	// ─── Document creation ────────────────────────────────────────────────────

	/** "Write this scene": open the card's scene page and enter Write mode (never toggles it off). */
	private async openSceneForWriting(file: TFile): Promise<void> {
		await openOrReveal(this.app, file);
		if (this.plugin.settings.writingMode !== 'write') {
			void toggleWriteMode(this.plugin);
		}
	}

	private async createSceneDocument(card?: SceneCard): Promise<void> {
		const scenesFolder = this.resolveScenesPath();

		new EntityModal(
			this.app,
			'scene',
			card?.title ?? '',
			[],
			async (name: string, fields, aliases, start) => {
				const safeName = name.trim().replace(/[\\/:*?"<>|]/g, '-') || localizedDefaultName('scene');
				const filePath = `${scenesFolder}/${safeName}.md`;

				let file: TFile;
				try {
					if (!this.app.vault.getAbstractFileByPath(scenesFolder)) {
						await this.app.vault.createFolder(scenesFolder);
					}
					file = await createEntitySheet(this.app, filePath, 'scene', name, fields, { aliases, cleanSlate: start?.cleanSlate });
				} catch (err) {
					// Nothing back: the sheet editor stays open with the writer's work.
					new Notice(i18n('grid.notice.createSheetFailed', { msg: err instanceof Error ? err.message : '' }));
					return;
				}
				// The sheet exists. From here a hiccup is reported, never a reason to save again.
				try {
					if (card && this.gridData) {
						// Re-checked against the live card: it may have been linked while the modal was open.
						const priorLink = this.gridData.cards.find((c) => c.id === card.id)?.linkedDocPath;
						const linked = linkNewDocIfUnlinked(this.gridData, card.id, file.path);
						if (linked !== this.gridData) {
							this.gridData = linked;
							this.renderAll();
							this.scheduleSave();
							this.pushCardToNewlyLinkedDoc(card.id, priorLink);
						}
					}

					await openOrReveal(this.app, file);
					new Notice(i18n('grid.notice.sceneCreated', { name: safeName }));
				} catch (err) {
					reportError(err);
				}
				return file;
			},
			{
				savedTemplates: this.plugin.settings.sceneFieldTemplates,
				onSaveTemplate: (tpl) => { runSafely((async () => {
					this.plugin.settings.sceneFieldTemplates.push(tpl);
					await this.plugin.saveSettings();
					new Notice(i18n('grid.notice.fieldTemplateSaved', { name: tpl.name }));
				})()); },
			}
		).open();
	}

	private async createCharacterDocument(card?: SceneCard): Promise<void> {
		const charactersPath = this.resolveCharactersPath();

		new EntityModal(
			this.app,
			'character',
			card?.title ?? '',
			[],
			async (name: string, fields, aliases, start) => {
				const safeName = name.trim().replace(/[\\/:*?"<>|]/g, '-') || localizedDefaultName('character');
				const filePath = `${charactersPath}/${safeName}.md`;

				let file: TFile;
				try {
					if (!this.app.vault.getAbstractFileByPath(charactersPath)) {
						await this.app.vault.createFolder(charactersPath);
					}
					file = await createEntitySheet(this.app, filePath, 'character', name, fields, { aliases, cleanSlate: start?.cleanSlate });
				} catch (err) {
					// Nothing back: the sheet editor stays open with the writer's work.
					new Notice(i18n('grid.notice.createSheetFailed', { msg: err instanceof Error ? err.message : '' }));
					return;
				}
				// The sheet exists. From here a hiccup is reported, never a reason to save again.
				try {
					if (card && this.gridData) {
						// A character sheet made from a card must not replace the card's scene page:
						// it only becomes the card's link when the card had none. It is always added
						// to the card's characters, so the card shows who it was made for.
						const priorLink = this.gridData.cards.find((c) => c.id === card.id)?.linkedDocPath;
						const linked = addCharacterToCard(linkNewDocIfUnlinked(this.gridData, card.id, file.path), card.id, file.path);
						if (linked !== this.gridData) {
							this.gridData = linked;
							this.renderAll();
							this.scheduleSave();
							this.pushCardToNewlyLinkedDoc(card.id, priorLink);
						}
					}

					await openOrReveal(this.app, file);
					new Notice(i18n('grid.notice.characterCreated', { name: safeName }));
				} catch (err) {
					reportError(err);
				}
				return file;
			},
			{
				savedTemplates: this.plugin.settings.characterFieldTemplates,
				onSaveTemplate: (tpl) => { runSafely((async () => {
					this.plugin.settings.characterFieldTemplates.push(tpl);
					await this.plugin.saveSettings();
					new Notice(i18n('grid.notice.fieldTemplateSaved', { name: tpl.name }));
				})()); },
				projectRoot: this.resolveProjectRoot(),
			}
		).open();
	}

	private async createLocationDocument(targetFolder?: string): Promise<void> {
		const locationsPath = targetFolder ?? this.resolveLocationsPath();

		new EntityModal(
			this.app,
			'location',
			'',
			[],
			async (name: string, fields, aliases, start) => {
				const safeName = name.trim().replace(/[\\/:*?"<>|]/g, '-') || localizedDefaultName('location');
				const filePath = `${locationsPath}/${safeName}.md`;

				let file: TFile;
				try {
					if (!this.app.vault.getAbstractFileByPath(locationsPath)) {
						await this.app.vault.createFolder(locationsPath);
					}
					file = await createEntitySheet(this.app, filePath, 'location', name, fields, { aliases, cleanSlate: start?.cleanSlate });
				} catch (err) {
					// Nothing back: the sheet editor stays open with the writer's work.
					new Notice(i18n('grid.notice.createSheetFailed', { msg: err instanceof Error ? err.message : '' }));
					return;
				}
				// The sheet exists. From here a hiccup is reported, never a reason to save again.
				try {
					await openOrReveal(this.app, file);
					new Notice(i18n('grid.notice.locationCreated', { name: safeName }));
				} catch (err) {
					reportError(err);
				}
				return file;
			},
			{
				savedTemplates: this.plugin.settings.locationFieldTemplates,
				onSaveTemplate: (tpl) => { runSafely((async () => {
					this.plugin.settings.locationFieldTemplates.push(tpl);
					await this.plugin.saveSettings();
					new Notice(i18n('grid.notice.fieldTemplateSaved', { name: tpl.name }));
				})()); },
			}
		).open();
	}

	private resolveProjectRoot(): string {
		return this.filePath ? projectRootFromGridPath(this.filePath) : '';
	}

	/**
	 * Where new sheets made from this grid go: always this grid's own project
	 * (see entityFolderForGrid) — never the project most recently created.
	 */
	private resolveCharactersPath(): string {
		return entityFolderForGrid(this.filePath, 'character');
	}

	private resolveScenesPath(): string {
		return entityFolderForGrid(this.filePath, 'scene');
	}

	private resolveLocationsPath(): string {
		return entityFolderForGrid(this.filePath, 'location');
	}

	// ─── Card editor — side panel ─────────────────────────────────────────────

	private openCardEditor(card: SceneCard): void {
		this.openSidePanel(card);
	}

	private renderSidePanelShell(panelEl: HTMLElement): void {
		// Panel is rendered empty; openSidePanel fills it
		panelEl.empty();
	}

	private openSidePanel(card: SceneCard): void {
		if (!this.panelEl) return;

		// Re-opened for the card that is already being edited (a re-render): save any typing still waiting
		// on the autosave timer first, then build the new draft from the card as the grid now has it. Left
		// pending, the old draft's timer would fire later and write its stale copy over the new state.
		if (this.panelCardId === card.id && this._panelDraft && this._draftTimer !== null) {
			this.cancelDraftTimer();
			this.commitDraft(this._panelDraft);
			card = this.gridData?.cards.find((c) => c.id === card.id) ?? card;
		}

		// If another card is already open, save it first before switching
		if (this.panelCardId && this.panelCardId !== card.id && this._panelDraft) {
			this.cancelDraftTimer();
			this.commitDraft(this._panelDraft);
			this.contentEl.querySelector<HTMLElement>(`[data-card-id="${this.panelCardId}"]`)
				?.classList.remove('sg-card--editing');
		}

		// Whatever timer is still running belongs to a draft that is about to be replaced (the grid file
		// reloading clears the draft but not a keystroke typed in the gap): never let it fire later.
		this.cancelDraftTimer();

		this.panelCardId = card.id;
		this.contentEl.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`)
			?.classList.add('sg-card--editing');
		// Keep selection (dashed ring) in sync with the editing card
		this.selectCard(card.id);

		// Draft is mutable; auto-saved on every change
		const linkedDraftCopy: Record<string, string[]> = {};
		for (const [k, v] of Object.entries(card.linkedEntityPaths ?? {})) linkedDraftCopy[k] = [...v];
		const draft: SceneCard = { ...card, tags: [...(card.tags ?? [])], characterPaths: [...(card.characterPaths ?? [])], linkedEntityPaths: linkedDraftCopy };
		this._panelDraft = draft;
		this._draftBaselines.set(draft, JSON.parse(JSON.stringify(draft)) as SceneCard);

		// Debounced commit for text inputs — committing per keystroke re-renders
		// the card (async markdown) and can write the linked doc on every key.
		const autoSave = () => {
			this.cancelDraftTimer();
			this._draftTimer = window.setTimeout(() => {
				this._draftTimer = null;
				this.commitDraft(draft);
			}, 300);
		};
		// Immediate commit for discrete controls (selects, colors, chips)
		const autoSaveNow = () => {
			this.cancelDraftTimer();
			this.commitDraft(draft);
		};

		const panel = this.panelEl;
		panel.empty();
		panel.addClass('sg-side-panel--open');
		this.scrollContainerEl?.addClass('sg-scroll-container--panel-open');

		// Close on Escape key — remove any previous listener first to prevent stacking
		this.removePanelDocListeners();
		const panelDoc = panel.doc;
		this._panelDoc = panelDoc;
		this._panelKeydownHandler = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			// Don't steal Escape from layers stacked above the panel —
			// Obsidian modals, context menus, the color picker popover, or a tip
			// bubble (Escape dismisses the tip, it should not also close the editor).
			if (panelDoc.querySelector('.modal-container, .menu, .sg-color-popover, .sg-coach-mark')) return;
			this.closeSidePanel();
		};
		panelDoc.addEventListener('keydown', this._panelKeydownHandler);

		// Close panel on click outside (not inside the panel or the grid)
		this._panelClickOutsideHandler = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!this.panelEl || !this.scrollContainerEl) return;
			if (this.panelEl.contains(target)) return;
			if (this.scrollContainerEl.contains(target)) return;
			// A tip bubble floats over the panel it points at; its Next / Got it buttons are not "outside".
			if (isOnCoachMark(target)) return;
			// Don't close if a modal, menu, or color picker is open above the panel
			if (panelDoc.querySelector('.modal-container, .menu, .sg-color-popover')) return;
			this.closeSidePanel();
		};
		panelDoc.addEventListener('mousedown', this._panelClickOutsideHandler);

		// ── Header ──────────────────────────────────────────────────────────
		const header = panel.createDiv({ cls: 'sg-panel-header' });
		const titleEl = header.createDiv({ cls: 'sg-panel-header-title', text: card.title || i18n('grid.card.fallbackTitle') });
		// ⋯ = the card's right-click menu, reachable on iPhone (no right-click there). Same look as the ×.
		const moreBtn = header.createEl('button', {
			cls: 'sg-panel-close sg-panel-more',
			attr: { type: 'button', 'aria-label': i18n('grid.panel.cardActions') },
			title: i18n('grid.panel.cardActions'),
			text: '⋯',
		});
		moreBtn.addEventListener('click', (e) => {
			autoSaveNow(); // the menu acts on the card as typed so far
			const live = this.gridData?.cards.find((c) => c.id === draft.id);
			if (live) this.showCardContextMenu(e, live, true);
		});
		const closeBtn = header.createEl('button', { cls: 'sg-panel-close', title: i18n('grid.panel.close'), text: '×' });
		closeBtn.addEventListener('click', () => this.closeSidePanel());

		const body = panel.createDiv({ cls: 'sg-panel-body' });

		// ── CORE (always visible): Title · Status · Synopsis ────────────────
		this.panelField(body, i18n('grid.panel.title'), (row) => {
			const input = row.createEl('input', { cls: 'sg-panel-input', type: 'text', placeholder: i18n('grid.panel.titlePlaceholder') });
			input.value = draft.title;
			input.addEventListener('input', () => {
				draft.title = input.value;
				titleEl.textContent = draft.title || i18n('grid.card.fallbackTitle');
				autoSave();
			});
		}, i18n('grid.panel.help.title'));

		this.panelField(body, i18n('grid.panel.status'), (row) => {
			const sel = row.createEl('select', { cls: 'sg-panel-select' });
			// Deliberately the Dashboard's status strings, not a second set: the same six
			// statuses are shown in both places and must not drift apart per locale.
			const STATUS_LABELS: Record<SceneCard['status'], string> = {
				idea: i18n('dashboard.status.idea'),
				outline: i18n('dashboard.status.outline'),
				draft: i18n('dashboard.status.draft'),
				written: i18n('dashboard.status.written'),
				revised: i18n('dashboard.status.revised'),
				final: i18n('dashboard.status.final'),
			};
			(['idea','outline','draft','written','revised','final'] as const).forEach((val) => {
				const opt = sel.createEl('option', { value: val, text: STATUS_LABELS[val] });
				if (val === draft.status) opt.selected = true;
			});
			sel.addEventListener('change', () => { draft.status = sel.value as SceneCard['status']; autoSaveNow(); });
		}, i18n('grid.panel.help.status'));

		const synLabel = body.createDiv({ cls: 'sg-panel-label' });
		synLabel.createSpan({ text: i18n('grid.panel.synopsis') });
		this.renderFieldHelp(synLabel, i18n('grid.panel.help.synopsis'));
		const synWrapper = body.createDiv({ cls: 'sg-panel-textarea-wrapper' });
		const synToolbar = synWrapper.createDiv({ cls: 'sg-md-toolbar' });
		const synEditor = synWrapper.createDiv({
			cls: 'sg-panel-richtext',
			attr: { contenteditable: 'true', 'data-placeholder': i18n('grid.panel.synopsisPlaceholder'), spellcheck: 'true' },
		});
		setRichText(synEditor, markdownToHtml(draft.synopsis));
		const updateSynPlaceholder = () => synEditor.toggleClass('sg-richtext--empty', synEditor.textContent?.trim() === '');
		const serializeSyn = () => { draft.synopsis = htmlToMarkdown(synEditor.innerHTML); updateSynPlaceholder(); autoSave(); };
		updateSynPlaceholder();
		synEditor.addEventListener('input', serializeSyn);
		// Paste as plain text so no foreign HTML ever enters the model.
		synEditor.addEventListener('paste', (e) => {
			e.preventDefault();
			const text = e.clipboardData?.getData('text/plain') ?? '';
			activeDocument.execCommand('insertText', false, text);
		});
		buildPanelRichToolbar(synToolbar, synEditor, serializeSyn);

		// Opening or adding a card puts the caret in Synopsis / Notes, at the end of any text
		// already there — a card's title is optional, its notes are what gets written.
		// Desktop only; on mobile this would pop the keyboard up every time a card is opened.
		if (!Platform.isMobile) {
			const focusNotes = () => {
				if (!synEditor.isConnected) return;
				synEditor.focus();
				// focus() alone doesn't reliably place a caret in a contenteditable.
				const sel = window.getSelection();
				if (!sel) return;
				const range = synEditor.doc.createRange();
				range.selectNodeContents(synEditor);
				range.collapse(false);
				sel.removeAllRanges();
				sel.addRange(range);
			};
			window.requestAnimationFrame(focusNotes);
			// Second pass once the 0.35s slide-in has settled, in case anything moved focus
			// meanwhile. Skipped if the writer already clicked in the panel.
			let touched = false;
			panel.addEventListener('pointerdown', () => { touched = true; }, { capture: true, once: true });
			window.setTimeout(() => {
				// Not if the panel closed meanwhile (draft cleared) or focus moved outside the panel (a modal, the grid).
				const active = activeDocument.activeElement;
				const focusIsFree = !active || active === activeDocument.body || panel.contains(active);
				if (!touched && this._panelDraft === draft && active !== synEditor && focusIsFree) focusNotes();
			}, 400);
		}

		// ── SECTION: Linked scene (compact) ─────────────────────────────────────
		const linkedSceneSummaryEl = this.panelSection(body, 'linked-doc', i18n('grid.panel.linkedScene'), !!draft.linkedDocPath, (sec) => {
			const linkWrap = sec.createDiv({ cls: 'sg-linked-scene-wrap' });

			const renderLinkedScene = () => {
				linkWrap.empty();

				if (draft.linkedDocPath) {
					// Linked: show compact chip + display-mode select
					const chipRow = linkWrap.createDiv({ cls: 'sg-linked-scene-chip-row' });
					const chip = chipRow.createDiv({ cls: 'sg-linked-scene-chip' });
					const name = draft.linkedDocPath.split('/').pop()?.replace(/\.(md|canvas)$/, '') || draft.linkedDocPath;
					chip.createSpan({ cls: 'sg-linked-scene-name', text: name });
					const x = chip.createEl('button', { cls: 'sg-chip-remove', text: '×', title: i18n('grid.panel.removeLink') });
					x.addEventListener('mousedown', (e) => {
						e.preventDefault();
						draft.linkedDocPath = undefined;
						autoSaveNow();
						renderLinkedScene();
					});

					const sel = chipRow.createEl('select', { cls: 'sg-linked-scene-mode' });
					[['first-lines',i18n('grid.panel.modeFirstLines')], ['synopsis',i18n('grid.panel.modeSynopsis')], ['title-only',i18n('grid.panel.modeTitleOnly')]].forEach(([val, lbl]) => {
						const opt = sel.createEl('option', { value: val, text: lbl });
						if (val === draft.linkDisplayMode) opt.selected = true;
					});
					sel.addEventListener('change', () => { draft.linkDisplayMode = sel.value as SceneCard['linkDisplayMode']; autoSaveNow(); });

					// "Write this scene →" — opens the linked page for writing (Markdown only; a canvas isn't written in).
					const linkedFile = this.app.vault.getAbstractFileByPath(draft.linkedDocPath);
					if (linkedFile instanceof TFile && linkedFile.extension === 'md') {
						const actionRow = linkWrap.createDiv({ cls: 'sg-linked-scene-action' });
						const writeBtn = actionRow.createEl('button', { cls: 'sg-panel-btn-small', attr: { type: 'button' }, text: i18n('grid.panel.writeScene') });
						writeBtn.addEventListener('click', () => {
							autoSaveNow(); // nothing typed in the editor is left waiting
							void this.openSceneForWriting(linkedFile);
						});
					}
				} else {
					// Unlinked: compact search input
					const searchWrap = linkWrap.createDiv({ cls: 'sg-linked-scene-search' });
					const input = searchWrap.createEl('input', {
						cls: 'sg-panel-input',
						type: 'text',
						placeholder: i18n('grid.panel.searchScene'),
					});
					const suggest = searchWrap.createDiv({ cls: 'sg-panel-suggest' });
					let suggestOpen = false;
					const setSuggestOpen = (open: boolean) => { suggestOpen = open; suggest.toggle(open); };
					setSuggestOpen(false);
					// The "Create new scene page" row (built below) sits right under the search box, where the
					// floating file list opens: hide it while the list is open so a tap can't land on a file instead.
					let actionRow: HTMLElement | null = null;
					const syncActionRow = () => {
						if (actionRow) actionRow.style.display = suggestOpen ? 'none' : '';
					};

					const showSuggestions = (query: string) => {
						suggest.empty();
						const lower = query.toLowerCase();
						const files = this.app.vault.getFiles()
							.filter((f) => (f.extension === 'md' || f.extension === 'canvas')
								&& !isSafetyNetPath(f.path)
								&& (!query || f.path.toLowerCase().includes(lower)))
							.sort((a, b) => b.stat.mtime - a.stat.mtime)
							.slice(0, 10);
						if (!files.length) { setSuggestOpen(false); syncActionRow(); return; }
						setSuggestOpen(true);
						syncActionRow();
						files.forEach((f) => {
							const item = suggest.createDiv({ cls: 'sg-panel-suggest-item', text: f.basename });
							item.createDiv({ cls: 'sg-panel-suggest-path', text: f.path });
							item.addEventListener('mousedown', (e) => {
								e.preventDefault();
								draft.linkedDocPath = f.path;
								setSuggestOpen(false);
								if (!draft.synopsis.trim()) {
									const docSynopsis: unknown = this.app.metadataCache.getFileCache(f)?.frontmatter?.['synopsis'];
									if (typeof docSynopsis === 'string' && docSynopsis.trim()) {
										draft.synopsis = docSynopsis.trim();
										setRichText(synEditor, markdownToHtml(draft.synopsis));
										updateSynPlaceholder();
									}
								}
								autoSaveNow();
								renderLinkedScene();
							});
						});
					};
					input.addEventListener('input', () => showSuggestions(input.value));
					input.addEventListener('focus', () => showSuggestions(input.value));
					input.addEventListener('blur', () => { window.setTimeout(() => { setSuggestOpen(false); syncActionRow(); }, 150); });

					// "Create new scene page" — the same form as right-click → Create scene document, with the
					// card's title filled in. Nothing is created unless the writer confirms the form.
					actionRow = linkWrap.createDiv({ cls: 'sg-linked-scene-action' });
					const createBtn = actionRow.createEl('button', { cls: 'sg-panel-btn-small', attr: { type: 'button' }, text: i18n('grid.panel.createScenePage') });
					createBtn.addEventListener('click', () => {
						autoSaveNow(); // the form should see the title as typed so far
						const live = this.gridData?.cards.find((c) => c.id === draft.id) ?? draft;
						// Once linked, the grid re-renders and reopens this editor showing the new scene page.
						void this.createSceneDocument(live);
					});
				}
			};
			renderLinkedScene();
		}, i18n('grid.panel.help.linkedScene'));

		// ── SECTION: Scene details ───────────────────────────────────────────
		// Default open when icon set or tags exist (characters moved to Linked entities)
		const hasSceneDetails = !!(draft.sceneIcon || (draft.tags ?? []).length);
		this.panelSection(body, 'scene-details', i18n('grid.panel.sceneDetails'), hasSceneDetails, (sec) => {
			const tagsLabel = sec.createDiv({ cls: 'sg-panel-label' });
			tagsLabel.createSpan({ text: i18n('grid.panel.tags') });
			this.renderFieldHelp(tagsLabel, i18n('grid.panel.help.tags'));
			const tagContainer = sec.createDiv({ cls: 'sg-chip-container' });
			const normalizeTag = normalizeCardTag;
			// Autocomplete pool: every tag already used on this grid's cards,
			// plus every tag in the vault (scene docs included).
			const knownTags = new Set<string>();
			for (const c of this.gridData?.cards ?? []) (c.tags ?? []).forEach((t) => knownTags.add(t));
			const vaultTags = (this.app.metadataCache as unknown as { getTags?: () => Record<string, number> }).getTags?.();
			if (vaultTags) Object.keys(vaultTags).forEach((t) => knownTags.add(t.toLowerCase()));
			const datalistId = 'sg-tag-suggestions';
			const datalist = sec.createEl('datalist');
			datalist.id = datalistId;
			[...knownTags].sort().forEach((t) => { datalist.createEl('option', { value: t }); });
			const renderTags = () => {
				tagContainer.empty();
				(draft.tags ?? []).forEach((tag, i) => {
					const chip = tagContainer.createDiv({ cls: 'sg-chip' });
					chip.createSpan({ text: tag });
					const x = chip.createEl('button', { cls: 'sg-chip-remove', text: '×' });
					x.addEventListener('mousedown', (e) => {
						e.preventDefault();
						draft.tags = (draft.tags ?? []).filter((_, idx) => idx !== i);
						renderTags();
						autoSaveNow();
					});
				});
				const tagInput = tagContainer.createEl('input', { cls: 'sg-chip-input', placeholder: i18n('grid.panel.tagPlaceholder') });
				tagInput.setAttribute('list', datalistId);
				// Picking a datalist entry fires 'change' without a keydown —
				// commit the tag then too, not just on Enter/comma.
				tagInput.addEventListener('change', () => {
					const normalized = normalizeTag(tagInput.value.trim().replace(/,/g, ''));
					// Only auto-commit exact suggestion picks — typing then clicking
					// away should not silently add a half-typed tag.
					if (!knownTags.has(normalized)) return;
					if (normalized.length > 1 && !(draft.tags ?? []).includes(normalized)) {
						draft.tags = [...(draft.tags ?? []), normalized];
						autoSaveNow();
						renderTags();
					}
				});
				tagInput.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ',') {
						e.preventDefault();
						const raw = tagInput.value.trim().replace(/,/g, '');
						const normalized = normalizeTag(raw);
						if (normalized.length > 1 && !(draft.tags ?? []).includes(normalized)) {
							draft.tags = [...(draft.tags ?? []), normalized];
							autoSaveNow();
						}
						renderTags();
					}
				});
			};
			renderTags();
		});

		// ── SECTION: Linked entities (events, characters, locations, etc.) ──────
		const hasLinkedEntities = !!(
			(draft.characterPaths ?? []).length ||
			Object.values(draft.linkedEntityPaths ?? {}).some((arr) => arr.length > 0)
		);
		const linkedEntitiesSummaryEl = this.panelSection(body, 'linked-entities', i18n('grid.panel.linkedEntities'), hasLinkedEntities, (sec) => {
			// ── Events (first) ────────────────────────────────────────────────
			const eventContainer = sec.createDiv({ cls: 'sg-panel-entity-kind-row' });
			eventContainer.createSpan({ cls: 'sg-panel-entity-kind-label', text: i18n('grid.panel.kind.events') });
			const eventChips = eventContainer.createDiv({ cls: 'sg-chip-container' });
			const renderEvents = () => {
				eventChips.empty();
				const paths = draft.linkedEntityPaths?.['event'] ?? [];
				paths.forEach((entityPath, i) => {
					const name = entityPath.split('/').pop()?.replace(/\.md$/, '') || entityPath;
					const chip = eventChips.createDiv({ cls: 'sg-chip sg-chip--entity' });
					chip.title = i18n('grid.panel.openDocTooltip');
					chip.addClass('sg-chip--clickable');
					chip.createSpan({ text: `⚡ ${name}` });
					chip.addEventListener('click', (e) => {
						if ((e.target as HTMLElement).classList.contains('sg-chip-remove')) return;
						const file = this.app.vault.getAbstractFileByPath(entityPath);
						if (file instanceof TFile) runSafely(openOrReveal(this.app, file));
					});
					const x = chip.createEl('button', { cls: 'sg-chip-remove', text: '×' });
					x.addEventListener('mousedown', (e) => {
						e.preventDefault();
						if (!draft.linkedEntityPaths) draft.linkedEntityPaths = {};
						draft.linkedEntityPaths['event'] = paths.filter((_, idx) => idx !== i);
						autoSaveNow();
						renderEvents();
					});
				});
				const addBtn = eventChips.createEl('button', { cls: 'sg-panel-btn-small', text: i18n('grid.panel.addEvent') });
				addBtn.addEventListener('click', () => {
					const projectRoot = this.resolveProjectRoot();
					new EntityPickerModal(
						this.app, projectRoot, 'event',
						(file: TFile) => {
							if (!draft.linkedEntityPaths) draft.linkedEntityPaths = {};
							const current = draft.linkedEntityPaths['event'] ?? [];
							if (!current.includes(file.path)) {
								draft.linkedEntityPaths['event'] = [...current, file.path];
								autoSaveNow();
							}
							renderEvents();
						},
						(k) => {
							new EntityModal(this.app, k, '', [], async (name, fields, aliases, start) => {
								let file: TFile;
								try {
									file = await createEntityFile(this.app, projectRoot, k, name, fields, aliases, start?.cleanSlate);
								} catch (err) {
									// Nothing back: the sheet editor stays open with the writer's work.
									new Notice(i18n('grid.notice.createSheetFailed', { msg: err instanceof Error ? err.message : '' }));
									return;
								}
								// The sheet exists. From here a hiccup is reported, never a reason to save again (a second copy).
								try {
									if (this._panelDraft !== draft) {
										this.addLinkToLiveCard(draft.id, 'event', file.path);
									} else if (!(draft.linkedEntityPaths?.['event'] ?? []).includes(file.path)) {
										if (!draft.linkedEntityPaths) draft.linkedEntityPaths = {};
										const current = draft.linkedEntityPaths['event'] ?? [];
										draft.linkedEntityPaths['event'] = [...current, file.path];
										autoSaveNow();
									}
									renderEvents();
									new Notice(i18n('grid.notice.eventCreated', { name }));
								} catch (err) {
									reportError(err);
								}
								return file;
							}, { projectRoot }).open();
						}
					).open();
				});
			};
			renderEvents();

			// ── Characters (second) ───────────────────────────────────────────
			const charRow = sec.createDiv({ cls: 'sg-panel-entity-kind-row' });
			charRow.createSpan({ cls: 'sg-panel-entity-kind-label', text: i18n('grid.panel.kind.characters') });
			const charContainer = charRow.createDiv({ cls: 'sg-chip-container' });
			const renderChars = () => {
				charContainer.empty();
				(draft.characterPaths ?? []).forEach((charFilePath, i) => {
					const name = charFilePath.split('/').pop()?.replace(/\.md$/, '') || charFilePath;
					const chip = charContainer.createDiv({ cls: 'sg-chip sg-chip--character' });
					chip.title = i18n('grid.panel.openCharacterTooltip');
					chip.addClass('sg-chip--clickable');
					chip.createSpan({ text: name });
					chip.addEventListener('click', (e) => {
						if ((e.target as HTMLElement).classList.contains('sg-chip-remove')) return;
						const file = this.app.vault.getAbstractFileByPath(charFilePath);
						if (file && file instanceof TFile) runSafely(openOrReveal(this.app, file));
					});
					const x = chip.createEl('button', { cls: 'sg-chip-remove', text: '×' });
					x.addEventListener('mousedown', (e) => {
						e.preventDefault();
						draft.characterPaths = (draft.characterPaths ?? []).filter((_, idx) => idx !== i);
						renderChars();
						autoSaveNow();
					});
				});
				const addBtn = charContainer.createEl('button', { cls: 'sg-panel-btn-small', text: i18n('grid.panel.addCharacter') });
				addBtn.addEventListener('click', () => {
					const projectRoot = this.resolveProjectRoot();
					new EntityPickerModal(
						this.app, projectRoot, 'character',
						(file: TFile) => {
							if (!(draft.characterPaths ?? []).includes(file.path)) {
								draft.characterPaths = [...(draft.characterPaths ?? []), file.path];
								autoSaveNow();
							}
							renderChars();
						},
						(kind) => {
							new EntityModal(this.app, kind, '', [], async (name, fields, aliases, start) => {
								let file: TFile;
								try {
									file = await createEntityFile(this.app, projectRoot, kind, name, fields, aliases, start?.cleanSlate);
								} catch (err) {
									// Nothing back: the sheet editor stays open with the writer's work.
									new Notice(i18n('grid.notice.createSheetFailed', { msg: err instanceof Error ? err.message : '' }));
									return;
								}
								// The sheet exists. From here a hiccup is reported, never a reason to save again (a second copy).
								try {
									// The editor may have been rebuilt while the sheet was being created (saving a field template
									// redraws the grid), so `draft` can be an old copy nobody sees any more. Then the sheet goes
									// onto the card itself, not onto that dead draft.
									if (this._panelDraft !== draft) {
										this.addLinkToLiveCard(draft.id, 'character', file.path);
									} else if (!(draft.characterPaths ?? []).includes(file.path)) {
										draft.characterPaths = [...(draft.characterPaths ?? []), file.path];
										autoSaveNow();
									}
									renderChars();
									new Notice(i18n('grid.notice.characterCreated', { name }));
								} catch (err) {
									reportError(err);
								}
								return file;
							}, {
								savedTemplates: this.plugin.settings.characterFieldTemplates,
								onSaveTemplate: (tpl) => { runSafely((async () => {
									this.plugin.settings.characterFieldTemplates.push(tpl);
									await this.plugin.saveSettings();
								})()); },
							}).open();
						}
					).open();
				});
			};
			renderChars();

			// Built per render, so the i18n() calls here are safe (nothing is baked in at
			// module load). `addLabel` is spelled out per kind rather than composed from
			// `kind`, so every key stays a literal the locale test can verify.
			const ENTITY_LINK_KINDS: Array<{ kind: string; label: string; addLabel: string; emoji: string }> = [
				{ kind: 'location', label: i18n('grid.panel.kind.places'), addLabel: i18n('grid.panel.addPlace'), emoji: '📍' },
				{ kind: 'faction', label: i18n('grid.panel.kind.factions'), addLabel: i18n('grid.panel.addFaction'), emoji: '🏛' },
				{ kind: 'system', label: i18n('grid.panel.kind.systems'), addLabel: i18n('grid.panel.addSystem'), emoji: '⚙' },
				{ kind: 'item', label: i18n('grid.panel.kind.items'), addLabel: i18n('grid.panel.addItem'), emoji: '🗝' },
				{ kind: 'research', label: i18n('grid.panel.kind.research'), addLabel: i18n('grid.panel.addResearch'), emoji: '🔬' },
			];
			for (const { kind, label, addLabel, emoji } of ENTITY_LINK_KINDS) {
				const kindContainer = sec.createDiv({ cls: 'sg-panel-entity-kind-row' });
				kindContainer.createSpan({ cls: 'sg-panel-entity-kind-label', text: label });
				const chipContainer = kindContainer.createDiv({ cls: 'sg-chip-container' });
				const renderKindChips = () => {
					chipContainer.empty();
					const paths = draft.linkedEntityPaths?.[kind] ?? [];
					paths.forEach((entityPath, i) => {
						const name = entityPath.split('/').pop()?.replace(/\.md$/, '') || entityPath;
						const chip = chipContainer.createDiv({ cls: 'sg-chip sg-chip--entity' });
						chip.title = i18n('grid.panel.openDocTooltip');
						chip.addClass('sg-chip--clickable');
						chip.createSpan({ text: `${emoji} ${name}` });
						chip.addEventListener('click', (e) => {
							if ((e.target as HTMLElement).classList.contains('sg-chip-remove')) return;
							const file = this.app.vault.getAbstractFileByPath(entityPath);
							if (file instanceof TFile) runSafely(openOrReveal(this.app, file));
						});
						const x = chip.createEl('button', { cls: 'sg-chip-remove', text: '×' });
						x.addEventListener('mousedown', (e) => {
							e.preventDefault();
							if (!draft.linkedEntityPaths) draft.linkedEntityPaths = {};
							draft.linkedEntityPaths[kind] = paths.filter((_, idx) => idx !== i);
							autoSaveNow();
							renderKindChips();
						});
					});
					const addBtn = chipContainer.createEl('button', { cls: 'sg-panel-btn-small', text: addLabel });
					addBtn.addEventListener('click', () => {
						const projectRoot = this.resolveProjectRoot();
						new EntityPickerModal(
							this.app,
							projectRoot,
							kind,
							(file: TFile) => {
								if (!draft.linkedEntityPaths) draft.linkedEntityPaths = {};
								const current = draft.linkedEntityPaths[kind] ?? [];
								if (!current.includes(file.path)) {
									draft.linkedEntityPaths[kind] = [...current, file.path];
									autoSaveNow();
								}
								renderKindChips();
							},
							(k) => {
								new EntityModal(
									this.app,
									k,
									'',
									[],
									async (name, fields, aliases, start) => {
										let file: TFile;
										try {
											file = await createEntityFile(this.app, projectRoot, k, name, fields, aliases, start?.cleanSlate);
										} catch (err) {
											// Nothing back: the sheet editor stays open with the writer's work.
											new Notice(i18n('grid.notice.createSheetFailed', { msg: err instanceof Error ? err.message : '' }));
											return;
										}
										// The sheet exists. From here a hiccup is reported, never a reason to save again (a second copy).
										try {
											if (this._panelDraft !== draft) {
												this.addLinkToLiveCard(draft.id, kind, file.path);
											} else if (!(draft.linkedEntityPaths?.[kind] ?? []).includes(file.path)) {
												if (!draft.linkedEntityPaths) draft.linkedEntityPaths = {};
												const current = draft.linkedEntityPaths[kind] ?? [];
												draft.linkedEntityPaths[kind] = [...current, file.path];
												autoSaveNow();
											}
											renderKindChips();
										} catch (err) {
											reportError(err);
										}
										return file;
									},
									{ projectRoot }
								).open();
							}
						).open();
					});
				};
				renderKindChips();
			}
		}, i18n('grid.panel.help.linkedEntities'));

		// ── SECTION: Appearance (default closed) ─────────────────────────────
		const appearanceSummaryEl = this.panelSection(body, 'appearance', i18n('grid.panel.appearance'), false, (sec) => {
			const pickerOpts = (
				currentColor: string,
				onChangeFn: (color: string, swatch: HTMLElement) => void,
				swatchRef: { el: HTMLElement | null }
			): InlineColorPickerOptions => ({
				currentColor,
				palettes: this.plugin.settings.colorPalettes,
				activePaletteId: this.plugin.settings.activeColorPaletteId,
				savedColors: this.plugin.settings.savedColors ?? [],
				...this.colorPersistCallbacks(),
				onChange: (color: string) => {
					if (swatchRef.el) swatchRef.el.style.background = color;
					onChangeFn(color, swatchRef.el!);
				},
			});

			// ── Card color ─────────────────────────────────────────────────
			const cardSwatchRef = { el: null as HTMLElement | null };
			let cardPicker: InlineColorPicker | null = null;
			let cardPickerWrap: HTMLElement | undefined;

			this.panelField(sec, i18n('grid.panel.cardColor'), (row) => {
				const swatch = row.createEl('button', { cls: 'sg-panel-color-swatch', attr: { type: 'button' } });
				swatch.style.background = draft.color;
				swatch.title = i18n('grid.panel.cardColorTooltip');
				cardSwatchRef.el = swatch;

				swatch.addEventListener('click', () => {
					framePicker?.close();
					if (!cardPickerWrap) return;
					if (!cardPicker) {
						cardPicker = new InlineColorPicker(cardPickerWrap, pickerOpts(
							draft.color,
							(color) => { draft.color = color; autoSaveNow(); },
							cardSwatchRef
						));
					}
					cardPicker.toggle();
					swatch.classList.toggle('sg-panel-color-swatch--active', cardPicker.isOpen());
				});
			}, i18n('grid.panel.help.cardColor'));
			cardPickerWrap = sec.createDiv({ cls: 'sg-cpick-hidden' });

			// ── Frame color ────────────────────────────────────────────────
			const frameSwatchRef = { el: null as HTMLElement | null };
			let framePicker: InlineColorPicker | null = null;
			let framePickerWrap: HTMLElement | undefined;

			this.panelField(sec, i18n('grid.panel.frameColor'), (row) => {
				const swatch = row.createEl('button', { cls: 'sg-panel-color-swatch', attr: { type: 'button' } });
				const syncFrameSwatch = () => { swatch.style.background = draft.frameColor || '#cccccc'; };
				syncFrameSwatch();
				swatch.title = i18n('grid.panel.frameColorTooltip');
				frameSwatchRef.el = swatch;

				swatch.addEventListener('click', () => {
					cardPicker?.close();
					cardSwatchRef.el?.classList.remove('sg-panel-color-swatch--active');
					if (!framePickerWrap) return;
					if (!framePicker) {
						framePicker = new InlineColorPicker(framePickerWrap, pickerOpts(
							draft.frameColor || '#cccccc',
							(color) => { draft.frameColor = color; autoSaveNow(); },
							frameSwatchRef
						));
					}
					framePicker.toggle();
					swatch.classList.toggle('sg-panel-color-swatch--active', framePicker.isOpen());
				});

				const clr = row.createEl('button', { cls: 'sg-panel-btn-small', text: i18n('grid.panel.clearFrame'), title: i18n('grid.panel.removeFrameColorTooltip') });
				clr.addEventListener('click', () => {
					draft.frameColor = undefined;
					syncFrameSwatch();
					framePicker?.close();
					swatch.classList.remove('sg-panel-color-swatch--active');
					autoSaveNow();
				});
			}, i18n('grid.panel.help.frameColor'));
			framePickerWrap = sec.createDiv({ cls: 'sg-cpick-hidden' });
		});

		// One-time, chained coach-mark tour of the three main sections below the
		// core fields — fires once ever, the first time any card editor opens.
		// Skippable at any step; ends the whole chain, not just that step.
		// Each tip sits just under the section it explains, inside the editor ('left' would float
		// them over the grid cards). Shown only once the 0.35s slide-in has finished — measured
		// mid-slide, the first tip landed on top of the editor pointing at the Synopsis box.
		if (this.plugin.canShowCoachMark('card-editor-sections')) {
			window.setTimeout(() => {
				// Editor closed or switched to another card meanwhile: don't start the tour on stale anchors.
				if (this._panelDraft !== draft) {
					this.plugin.releasePendingCoachMark('card-editor-sections');
					return;
				}
				showCoachMarkChain([
					{ anchor: linkedSceneSummaryEl, text: i18n('grid.coach.linkedScene'), placement: 'bottom' },
					{ anchor: linkedEntitiesSummaryEl, text: i18n('grid.coach.linkedEntities'), placement: 'bottom' },
					{ anchor: appearanceSummaryEl, text: i18n('grid.coach.appearance'), placement: 'bottom' },
				],
				() => this.plugin.markCoachMarkSeen('card-editor-sections'),
				() => this.plugin.releasePendingCoachMark('card-editor-sections'));
			}, 400);
		}
	}

	/**
	 * Put a sheet on a card straight in the grid and redraw (which reopens an editor open on that card
	 * from the updated card). For callbacks that outlived their editor: the create-sheet flows in the
	 * card editor, which await a modal and a file write.
	 */
	private addLinkToLiveCard(cardId: string, kind: string, path: string): void {
		if (!this.gridData) return;
		const card = this.gridData.cards.find((c) => c.id === cardId);
		if (!card) return;
		if (kind === 'character') {
			this.gridData = addCharacterToCard(this.gridData, cardId, path);
		} else {
			const current = card.linkedEntityPaths?.[kind] ?? [];
			if (current.includes(path)) return;
			this.gridData = updateCard(this.gridData, cardId, {
				linkedEntityPaths: { ...(card.linkedEntityPaths ?? {}), [kind]: [...current, path] },
			});
		}
		this.renderAll();
		this.scheduleSave();
	}

	private cancelDraftTimer(): void {
		if (this._draftTimer !== null) {
			window.clearTimeout(this._draftTimer);
			this._draftTimer = null;
		}
	}

	/** One-time congratulation toast the first time any card is colored, linked to a character, AND linked to a document — replaces the old onboarding bar's completion step. */
	private maybeCelebrateFullScene(card: SceneCard): void {
		if (!this.gridData) return;
		const hasColor = (card.color && card.color !== '#f5f7ff')
			|| !!this.gridData.rows.find((r) => r.id === card.rowId)?.color
			|| !!this.gridData.columns.find((c) => c.id === card.colId)?.color;
		const hasCharacter = (card.characterPaths ?? []).length > 0;
		const hasLink = !!card.linkedDocPath;
		if (hasColor && hasCharacter && hasLink) {
			this.plugin.celebrateMilestone(
				'first-full-scene',
				i18n('grid.milestone.firstFullScene')
			);
		}
	}

	// Auto-commit draft to gridData and re-render the card cell in place (panel stays open)
	private commitDraft(draft: SceneCard): void {
		if (!this.gridData) return;
		// Write only what the writer edited in the panel, and never the draft's position: the draft is a
		// snapshot, so a link renamed/created or a card moved while the editor was open would otherwise be undone.
		const baseline = this._draftBaselines.get(draft);
		// The card as it was before this commit: the linked note only follows real changes.
		const prior = this.gridData.cards.find((c) => c.id === draft.id);
		const priorLink = prior?.linkedDocPath;
		const priorTags = [...(prior?.tags ?? [])];
		const priorSynopsis = prior?.synopsis ?? '';
		this.gridData = commitCardDraft(this.gridData, draft, baseline);
		if (baseline) this._draftBaselines.set(draft, JSON.parse(JSON.stringify(draft)) as SceneCard);
		this.scheduleSave();
		// Everything below judges the card as it now sits in the grid, not the draft's possibly stale copy.
		const live = this.gridData.cards.find((c) => c.id === draft.id) ?? draft;
		this.maybeCelebrateFullScene(live);
		if (live.linkedDocPath) {
			const linkChanged = live.linkedDocPath !== priorLink;
			// Newly linked: the note gains the card's tags. Same note: only the tags
			// added or removed on the card change. The note's own tags always stay.
			const { added, removed } = linkChanged
				? { added: [...(live.tags ?? [])], removed: [] }
				: cardTagChanges(priorTags, live.tags ?? []);
			// A tag another card on the same note still carries stays on the note.
			const path = live.linkedDocPath;
			const others = this.gridData.cards.filter((c) => c.id !== live.id && c.linkedDocPath === path);
			const stillUsed = others.flatMap((c) => c.tags ?? []);
			const reallyRemoved = removed.filter((t) => cardTagChanges([t], stillUsed).removed.length > 0);
			this.syncTagChangesToLinkedDoc(path, added, reallyRemoved);
			// The summary follows only when the writer changed it — and a newly linked
			// note's own summary is never replaced.
			if (linkChanged) this.syncSynopsisToLinkedDoc(live, false);
			else if (live.synopsis !== priorSynopsis) this.syncSynopsisToLinkedDoc(live, true);
		}
		const cardEl = this.contentEl.querySelector<HTMLElement>(`[data-card-id="${draft.id}"]`);
		if (cardEl?.parentElement) {
			const cell = cardEl.parentElement;
			cell.empty();
			const updated = this.gridData.cards.find((c) => c.id === draft.id);
			if (updated) {
				this.renderCard(cell, updated);
				// Re-apply editing highlight — renderCard creates a fresh element
				if (this.panelCardId === draft.id) {
					cell.querySelector<HTMLElement>(`[data-card-id="${draft.id}"]`)
						?.classList.add('sg-card--editing');
				}
			}
		}
	}

	/**
	 * Carry the tags the writer added to or removed from a card onto its linked
	 * note (so Obsidian indexes them). Never replaces the note's tag list.
	 */
	private syncTagChangesToLinkedDoc(path: string, added: string[], removed: string[]): void {
		if (added.length === 0 && removed.length === 0) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		// Only adding, and the note already has them all: leave the file alone. A
		// removal always reads the file itself — the cache may not yet show a tag added a moment ago.
		if (removed.length === 0) {
			const cached: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.['tags'];
			if (applyCardTagChanges(cached, added, removed) === null) return;
		}
		this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const next = applyCardTagChanges(fm['tags'], added, removed);
			if (next === null) return;
			if (next.length > 0) fm['tags'] = next;
			else delete fm['tags'];
		}).catch((err) => this.reportNoteSyncError(file.path, err));
	}

	/** Notes whose tag/summary update already failed and was reported — once per note, not on every keystroke. */
	private readonly _noteSyncErrorsShown = new Set<string>();
	private reportNoteSyncError(path: string, err: unknown): void {
		if (this._noteSyncErrorsShown.has(path)) return;
		this._noteSyncErrorsShown.add(path);
		reportError(err);
	}

	/** `overwrite` false: only fill a note that has no summary of its own yet. */
	private syncSynopsisToLinkedDoc(card: SceneCard, overwrite: boolean): void {
		if (!card.linkedDocPath || !card.synopsis.trim()) return;
		const file = this.app.vault.getAbstractFileByPath(card.linkedDocPath);
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		const hasOwn = (own: unknown): boolean =>
			typeof own === 'string' ? own.trim() !== '' : own !== undefined && own !== null;
		if (!overwrite && hasOwn(this.app.metadataCache.getFileCache(file)?.frontmatter?.['synopsis'])) return;
		this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (!overwrite && hasOwn(fm['synopsis'])) return;
			fm['synopsis'] = card.synopsis;
		}).catch((err) => this.reportNoteSyncError(file.path, err));
	}

	// ─── Keyboard card selection ──────────────────────────────────────────────

	private selectCard(cardId: string): void {
		// Deselect previous
		if (this.selectedCardId && this.selectedCardId !== cardId) {
			this.contentEl.querySelector<HTMLElement>(`[data-card-id="${this.selectedCardId}"]`)
				?.classList.remove('sg-card--selected');
		}
		this.selectedCardId = cardId;
		const cardEl = this.contentEl.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`);
		cardEl?.classList.add('sg-card--selected');
		cardEl?.focus();
	}

	private clearCardSelection(): void {
		if (this.selectedCardId) {
			this.contentEl.querySelector<HTMLElement>(`[data-card-id="${this.selectedCardId}"]`)
				?.classList.remove('sg-card--selected');
			this.selectedCardId = null;
		}
	}

	/** Move keyboard selection focus to the nearest occupied cell in the given direction. Does NOT move the card. */
	private navigateSelection(dir: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
		if (!this.gridData) return;
		const rows = sortByOrder(this.gridData.rows);
		const cols = sortByOrder(this.gridData.columns);

		let rowIdx = 0;
		let colIdx = 0;

		if (this.selectedCardId) {
			const card = this.gridData.cards.find((c) => c.id === this.selectedCardId);
			if (!card) return;
			rowIdx = rows.findIndex((r) => r.id === card.rowId);
			colIdx = cols.findIndex((c) => c.id === card.colId);
			if (rowIdx === -1 || colIdx === -1) return;
		} else {
			// No selection — jump to the first card on the grid
			const first = this.gridData.cards[0];
			if (!first) return;
			this.selectCard(first.id);
			return;
		}

		// Scan from the adjacent cell outward until we hit an occupied cell or the edge
		let r = rowIdx;
		let c = colIdx;
		if (dir === 'ArrowUp')    r--;
		else if (dir === 'ArrowDown')  r++;
		else if (dir === 'ArrowLeft')  c--;
		else if (dir === 'ArrowRight') c++;

		while (r >= 0 && r < rows.length && c >= 0 && c < cols.length) {
			const target = findCard(this.gridData.cards, rows[r].id, cols[c].id);
			if (target) { this.selectCard(target.id); return; }
			if (dir === 'ArrowUp')    r--;
			else if (dir === 'ArrowDown')  r++;
			else if (dir === 'ArrowLeft')  c--;
			else if (dir === 'ArrowRight') c++;
		}
	}

	/** Physically relocate the selected card to the adjacent cell (Ctrl/Cmd+Arrow). */
	private moveSelectedCard(dir: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
		if (!this.gridData || !this.selectedCardId) return;
		const card = this.gridData.cards.find((c) => c.id === this.selectedCardId);
		if (!card) return;

		const rows = sortByOrder(this.gridData.rows);
		const cols = sortByOrder(this.gridData.columns);
		const rowIdx = rows.findIndex((r) => r.id === card.rowId);
		const colIdx = cols.findIndex((c) => c.id === card.colId);
		if (rowIdx === -1 || colIdx === -1) return;

		let newRowIdx = rowIdx;
		let newColIdx = colIdx;
		if (dir === 'ArrowUp')    newRowIdx = Math.max(0, rowIdx - 1);
		if (dir === 'ArrowDown')  newRowIdx = Math.min(rows.length - 1, rowIdx + 1);
		if (dir === 'ArrowLeft')  newColIdx = Math.max(0, colIdx - 1);
		if (dir === 'ArrowRight') newColIdx = Math.min(cols.length - 1, colIdx + 1);
		if (newRowIdx === rowIdx && newColIdx === colIdx) return;

		const newRowId = rows[newRowIdx].id;
		const newColId = cols[newColIdx].id;

		// Don't move if target cell is occupied
		const occupant = findCard(this.gridData.cards, newRowId, newColId);
		if (occupant) return;

		this.gridData = moveCard(this.gridData, card.id, newRowId, newColId);
		this.scheduleSave();
		this.renderGridOnly();
		// Re-select the card so the visual highlight and focus survive the DOM rebuild
		this.selectCard(card.id);
	}

	/**
	 * Appends a small "ⓘ" help affordance to a label: hover shows Obsidian's
	 * native tooltip on desktop; tap shows a Notice on mobile, since there's
	 * no hover surface there. Gated by Settings → Plot Grid → field help.
	 */
	private renderFieldHelp(labelEl: HTMLElement, help: string): void {
		if (this.plugin.settings.cardEditorHoverHelp === false) return;
		const info = labelEl.createSpan({ cls: 'sg-field-help-icon', text: 'ⓘ' });
		setTooltip(info, help, { placement: 'top', delay: 80, classes: ['sg-tooltip'] });
		info.setAttribute('aria-label', help);
		info.addEventListener('mousedown', (e) => e.stopPropagation());
		info.addEventListener('click', (e) => {
			e.stopPropagation();
			new Notice(help, 5000);
		});
	}

	private panelField(parent: HTMLElement, label: string, builder: (row: HTMLElement) => void, help?: string): void {
		const row = parent.createDiv({ cls: 'sg-panel-field' });
		const labelEl = row.createDiv({ cls: 'sg-panel-label' });
		labelEl.createSpan({ text: label });
		if (help) this.renderFieldHelp(labelEl, help);
		const control = row.createDiv({ cls: 'sg-panel-control' });
		builder(control);
	}

	/** Returns the section's summary element so callers can anchor a coach mark to it. */
	private panelSection(
		parent: HTMLElement,
		id: string,
		label: string,
		defaultOpen: boolean,
		builder: (content: HTMLElement) => void,
		help?: string
	): HTMLElement {
		const isOpen = this._panelSectionStates.has(id)
			? this._panelSectionStates.get(id)!
			: defaultOpen;

		const section = parent.createDiv({ cls: 'sg-panel-section' });
		if (isOpen) section.classList.add('sg-panel-section--open');

		const summary = section.createEl('button', { cls: 'sg-panel-section-summary', attr: { type: 'button' } });
		summary.createSpan({ cls: 'sg-panel-section-label', text: label });
		if (help) this.renderFieldHelp(summary, help);
		summary.createSpan({ cls: 'sg-panel-section-chevron' });

		summary.addEventListener('click', () => {
			const open = section.classList.toggle('sg-panel-section--open');
			this._panelSectionStates.set(id, open);
		});

		const content = section.createDiv({ cls: 'sg-panel-section-content' });
		const inner = content.createDiv({ cls: 'sg-panel-section-inner' });
		builder(inner);
		return summary;
	}

	/** Remove the panel's document-level listeners from the document they were added to. */
	private removePanelDocListeners(): void {
		const doc = this._panelDoc ?? this.containerEl.doc;
		if (this._panelKeydownHandler) {
			doc.removeEventListener('keydown', this._panelKeydownHandler);
			this._panelKeydownHandler = null;
		}
		if (this._panelClickOutsideHandler) {
			doc.removeEventListener('mousedown', this._panelClickOutsideHandler);
			this._panelClickOutsideHandler = null;
		}
		this._panelDoc = null;
	}

	private closeSidePanel(): void {
		if (!this.panelEl) return;

		// Always remove the global listeners immediately on close
		this.removePanelDocListeners();

		// Commit any unsaved draft before closing (and drop the pending timer
		// so it can't re-commit a stale draft after the panel is gone)
		this.cancelDraftTimer();
		if (this._panelDraft) {
			this.commitDraft(this._panelDraft);
			this._panelDraft = null;
		}
		if (this.panelCardId) {
			this.contentEl.querySelector<HTMLElement>(`[data-card-id="${this.panelCardId}"]`)
				?.classList.remove('sg-card--editing');
		}
		this.panelCardId = null;
		this.clearCardSelection();
		this.panelEl.removeClass('sg-side-panel--open');
		this.scrollContainerEl?.removeClass('sg-scroll-container--panel-open');
		// Small delay then re-render so the slide-out animation plays before content changes
		window.setTimeout(() => this.renderAll(), 350);
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

