import { ItemView, WorkspaceLeaf, TFile, TAbstractFile, Notice, Menu, App, Platform, MarkdownView, ViewStateResult } from 'obsidian';
import type StorygridPlugin from './main';
import { setPhosphorIcon, WRITERS_PANEL_ICON, DASHBOARD_ICON, CODEX_ICON } from './utils/icons';
import { TaskListController } from './ui/task-list';
import { GridData, SceneCard, createCard, createRow, createColumn, sortByOrder, generateId } from './grid-data';
import { ensureDashboard } from './dashboard-view';
import { writeProjectMirror } from './utils/project-data-store';
import { isSafetyNetPath } from './utils/safety-paths';
import { debounce } from './utils/debounce';
import { dayKey, startOfWeek, startOfMonth, startOfYear, sumSince } from './utils/stats';
import {
	ManuscriptOptions,
	ManuscriptItem,
	CompileOutputFormat,
	OUTPUT_FORMAT_EXT,
	OUTPUT_FORMAT_LABELS,
	countWords,
	applyCompileSteps,
	assembleManuscript,
	COMPILE_STEP_SPECS,
	getStepSpec,
	defaultStepConfig,
	CompileStepStage,
	WORKFLOW_PRESETS,
	workflowOptions,
} from './utils/compile';
import { CompileWorkflowSettings } from './grid-data';
import {
	WordCountCache,
	docWordCount,
	gatherManuscript,
	snapshotCompiledScenes,
	writeManuscript,
	buildEpubBytes,
	manuscriptPathFor,
	defaultManuscriptName,
} from './utils/compile-runner';
import { assembleFountain, FountainOptions } from './utils/fountain';
import { buildDocx, DocxOptions } from './utils/docx';
import { saveExport } from './utils/save-file';
import { projectRootFromGridPath, createEntityFile } from './entities/entity-manager';
import { openSprintSetup } from './modals/sprint-modal';
import { getCodexGroups, EntityKind, CodexGroupSpec, getKindSpec } from './entities/entity-kinds';
import { EntityModal } from './modals/entity-modal';
import { ConfirmModal, TextPromptModal } from './modals/prompt-modal';
import { CompilePreviewModal } from './modals/compile-preview-modal';
import { ImagePickerModal } from './modals/image-picker-modal';
import { openOrReveal } from './utils/workspace';
import { renderEntityPreview } from './ui/entity-preview';
import { resolveEngineFlags } from './prose/counts';
import { tokenizeWords } from './prose/tokenize';
import { maskNonProse } from './prose/mask';
import { quoteFor } from './prose/sentences';
import { COACH_WHY_KEY, tryOfferAt, matchCase, findingLabel, suggestionLine, NO_NEVER_KINDS } from './prose/coach-card';
import { scanCoach } from './prose/coach-scan';
import { anyProFlag, resolveProFlags } from './prose/pro';
import { percent } from './prose/pro/pace';
import { CoachMode, ProseCoachSettings, resolveCoachMode, removeNeverWord } from './prose/coach-settings';
import { canUse } from './entitlements/entitlements';
import { PUBLIC_BUILD } from './build-flags';
import { ProseFinding } from './prose/types';
import {
	SceneTree,
	SceneTreeNode,
	ProjectionRow,
	resolveSceneTree,
	createDocNode,
	createDividerNode,
	indentNode,
	outdentNode,
	renameDividerLabel,
	removeNodePromotingChildren,
	getDescendantIds,
	getProjection,
	moveNodeBefore,
	moveSibling,
	canMoveSibling,
} from './utils/scene-tree';
import { t as i18n } from './i18n';
import { writersPanelTabsFor } from './modules';

export const VIEW_TYPE_OUTLINE = 'storygrid-outline-view';

/** A crutch word's quote shows at most this many uses; the rest are "and N more". */
const COACH_QUOTE_MAX = 4;
/** Below this many words a dialogue share says nothing useful, so the figure is left out. */
const PACE_MIN_WORDS = 150;

type OutlineTab = 'writing' | 'world' | 'coach' | 'compile' | 'dashboard';

/** Entity kinds shown in the World tab — everything but scenes.
 *  Computed at runtime (not cached at module load) so custom kinds are included. */
// Same 9 main-category grouping the full Codex sidebar uses (getCodexGroups),
// with 'scene' kept out — it belongs to the Writing tab, not World. Without
// this filter 'scene' would otherwise fall into getCodexGroups()'s dynamic
// "Your Own" bucket, since no static group claims it.
const worldGroups = (): CodexGroupSpec[] =>
	getCodexGroups()
		.map((g) => ({ ...g, kinds: g.kinds.filter((k) => k !== 'scene') }))
		.filter((g) => g.kinds.length > 0);

/**
 * Writers Panel — a Longform-style right-sidebar panel. The Writing tab lists
 * the active grid's scenes in story order for quick navigation; the World tab
 * surfaces the project's Codex entities (characters, locations, …); the
 * Compile tab picks scenes and assembles the manuscript.
 */
export class StorygridOutlineView extends ItemView {
	private plugin: StorygridPlugin;
	private gridPath: string | null = null;
	private activeTab: OutlineTab = 'writing';
	/** Whether the collapsible "Formatting options" group is open in the Compile tab. */
	private _compileOptsOpen = false;
	private _taskList = new TaskListController();
	private refreshTimer: number | null = null;
	private _wordCache: WordCountCache = new Map();
	/** 1-second tick driving the live sprint countdown on the Progress tab. */
	private _sprintTick: number | null = null;
	/** 1-second tick for the fill-drain banner above the tabs. */
	private _bannerTick: number | null = null;
	/** Listens for sprint start/end events to refresh the banner. */
	private _sprintChangedHandler: (() => void) | null = null;
	private _tasksChangedHandler: ((e: Event) => void) | null = null;
	private _projectChangedHandler: (() => void) | null = null;
	private _wordsChangedHandler: (() => void) | null = null;
	private _coachChangedHandler: (() => void) | null = null;
	/** Pending outline drag-drop target, computed live during dragover. */
	private _treeDrop: { parentId: string | null; beforeId: string | null } | null = null;
	/** Cursor X and the dragged row's own depth at dragstart — nesting depth is
	 *  computed relative to this, not from an absolute pixel column, so you
	 *  nudge left/right to change nesting instead of hunting for a column. */
	private _treeDragStart: { x: number; depth: number } | null = null;
	/** Visible rows + cached rects for the in-progress drag, built once per
	 *  drag session (not per dragover) so cursor moves don't force reflow. */
	private _treeDragCache: { rowEls: HTMLElement[]; rows: ProjectionRow[]; rects: DOMRect[] } | null = null;
	/** In-panel Codex preview nav stack (entity file paths), newest last.
	 *  Scoped to a project root so a project switch never shows a foreign card. */
	private _worldPreviewStack: string[] = [];
	private _worldPreviewRoot: string | null = null;
	/** Coach tab: which groups / folds are open (finding kinds + 'checks'). Folded by default. */
	private _coachOpen: Set<string> = new Set();
	/** The note the Coach tab last read — so switching scenes re-reads, clicking in the panel does not. */
	private _coachLastPath: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_OUTLINE;
	}

	getDisplayText(): string {
		return i18n('outline.viewTitle');
	}

	getIcon(): string {
		return 'sg-pen-nib';
	}

	// ─── Lifecycle / state ─────────────────────────────────────────────────────

	async onOpen(): Promise<void> {
		this.contentEl.addClass('sg-outline-root');

		const scheduleRefresh = (file?: TAbstractFile) => {
			if (file && isSafetyNetPath(file.path)) return;
			if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
			this.refreshTimer = window.setTimeout(() => this.renderAll(), 400);
		};
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (isSafetyNetPath(file.path)) return;
			if (file instanceof TFile && (file.extension === 'md' || file.extension === 'storygrid')) scheduleRefresh();
		}));
		this.registerEvent(this.app.vault.on('create', scheduleRefresh));
		this.registerEvent(this.app.vault.on('delete', scheduleRefresh));
		this.registerEvent(this.app.vault.on('rename', scheduleRefresh));
		// Highlight follows the document the writer is working in. `file-open`
		// covers opening a new doc (and project switches → full refresh);
		// `active-leaf-change` covers clicking between already-open tabs. The
		// highlight itself updates instantly (no debounce) so the marked row is
		// always exactly the doc in the focused editor.
		this.registerEvent(this.app.workspace.on('file-open', () => scheduleRefresh()));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshActiveHighlight()));
		this.registerEvent((this.app.workspace as any).on('storygrid:settings-changed', () => scheduleRefresh()));

		this._sprintChangedHandler = () => void this.renderAll();
		document.addEventListener('storygrid:sprint-changed', this._sprintChangedHandler);

		this._tasksChangedHandler = (e: Event) => {
			if ((e as CustomEvent).detail === 'outline') return;
			void this.renderAll();
		};
		document.addEventListener('storygrid:tasks-changed', this._tasksChangedHandler);

		this._projectChangedHandler = () => void this.renderAll();
		document.addEventListener('storygrid:project-changed', this._projectChangedHandler);

		this._wordsChangedHandler = () => {
			// Cancel any pending full re-render so typing never triggers a flash
			if (this.refreshTimer) { window.clearTimeout(this.refreshTimer); this.refreshTimer = null; }
			this.refreshGoalNumbers();
		};
		document.addEventListener('storygrid:words-changed', this._wordsChangedHandler);

		// Debounced ~400ms after each edit by coachChangeNotifier (Step 8) — the
		// Coach tab's whole-document counters can't rely on the editor's own
		// updateListener, since they need to run tab-wide, not per-EditorView.
		this._coachChangedHandler = () => {
			if (this.activeTab === 'coach') void this.renderAll();
		};
		document.addEventListener('storygrid:coach-doc-changed', this._coachChangedHandler);
		// Switching to another scene: the Coach tab reads the new one.
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			if (this.activeTab !== 'coach') return;
			const path = this.coachSceneView()?.file?.path ?? null;
			if (path !== this._coachLastPath) void this.renderAll();
		}));

		await this.renderAll();
	}

	/** Refresh just the word-count numbers and progress bars in the Writing Goals section,
	 *  without re-rendering the full panel. Called on storygrid:words-changed. */
	private refreshGoalNumbers(): void {
		const goalSec = this.contentEl.querySelector<HTMLElement>('[data-sg-goals="1"]');
		if (!goalSec) return;
		const gridFile = this.currentGridFile();
		if (!gridFile) return;
		const projectRoot = this.getBookRoot(gridFile);
		const dash = ensureDashboard(this.plugin.settings);
		const history = dash.typedWords[projectRoot] ?? {};
		const wordGoals = this.plugin.settings.wordGoals ?? {};
		const goals = dash.goals[projectRoot] ?? {};
		const now = new Date();
		const windows = this.plugin.settings.sidebarGoalWindows ?? ['daily', 'weekly'];
		const windowStart: Record<string, Date> = {
			daily: now,
			weekly: startOfWeek(now),
			monthly: startOfMonth(now),
		};
		const rows = goalSec.querySelectorAll<HTMLElement>('.sg-outline-goal-row');
		const bars = goalSec.querySelectorAll<HTMLElement>('.sg-outline-bar-fill');
		windows.forEach((win, i) => {
			const done = sumSince(history, windowStart[win], now);
			const target = wordGoals[win as keyof typeof wordGoals] ?? goals[win as keyof typeof goals] ?? 0;
			const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
			const doneEl = rows[i]?.querySelector<HTMLElement>('.sg-outline-goal-done');
			if (doneEl) doneEl.textContent = done.toLocaleString();
			if (bars[i]) {
				bars[i].style.width = `${pct}%`;
				bars[i].classList.toggle('is-met', target > 0 && done >= target);
			}
		});
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
		if (this._sprintTick) window.clearInterval(this._sprintTick);
		if (this._bannerTick) { window.cancelAnimationFrame(this._bannerTick); this._bannerTick = null; }
		if (this._sprintChangedHandler) {
			document.removeEventListener('storygrid:sprint-changed', this._sprintChangedHandler);
			this._sprintChangedHandler = null;
		}
		if (this._tasksChangedHandler) {
			document.removeEventListener('storygrid:tasks-changed', this._tasksChangedHandler);
			this._tasksChangedHandler = null;
		}
		if (this._projectChangedHandler) {
			document.removeEventListener('storygrid:project-changed', this._projectChangedHandler);
			this._projectChangedHandler = null;
		}
		if (this._wordsChangedHandler) {
			document.removeEventListener('storygrid:words-changed', this._wordsChangedHandler);
			this._wordsChangedHandler = null;
		}
		if (this._coachChangedHandler) {
			document.removeEventListener('storygrid:coach-doc-changed', this._coachChangedHandler);
			this._coachChangedHandler = null;
		}
	}

	getState(): Record<string, unknown> {
		return { gridPath: this.gridPath, activeTab: this.activeTab };
	}

	async switchToTab(tab: OutlineTab): Promise<void> {
		this.activeTab = tab;
		await this.renderAll();
	}

	async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
		if (state && typeof state['gridPath'] === 'string') this.gridPath = state['gridPath'];
		if (
			state &&
			typeof state['activeTab'] === 'string' &&
			(['writing', 'world', 'coach', 'compile', 'dashboard'] as string[]).includes(state['activeTab'])
		) {
			this.activeTab = state['activeTab'] as OutlineTab;
		}
		await this.renderAll();
		await super.setState(state, result);
	}

	/** Point the panel at a specific grid (e.g. from the grid view's toolbar). */
	async showGrid(gridPath: string): Promise<void> {
		this.gridPath = gridPath;
		await this.renderAll();
	}

	/** Open the panel on the Compile tab for a specific grid. */
	async showCompileTab(gridPath: string): Promise<void> {
		this.gridPath = gridPath;
		this.activeTab = 'compile';
		await this.renderAll();
	}

	/** Deep-link: show the World tab with an entity's read-only preview card on top.
	 *  No-op guard: clicking the same node twice in a row (e.g. on the Connections
	 *  Map) would otherwise re-render the whole panel for no visible change — a
	 *  blink with nothing to show for it. */
	async showEntityPreview(projectRoot: string, entityPath: string): Promise<void> {
		const alreadyShowing =
			this.activeTab === 'world' &&
			this._worldPreviewRoot === projectRoot &&
			this._worldPreviewStack[this._worldPreviewStack.length - 1] === entityPath;
		if (alreadyShowing) return;

		// Codex tab switched off in Settings: the preview has nowhere to show, so open the sheet itself.
		if (!(writersPanelTabsFor(this.plugin.settings.intent, this.plugin.settings.writersPanelTabs) as OutlineTab[]).includes('world')) {
			const sheet = this.app.vault.getAbstractFileByPath(entityPath);
			if (sheet instanceof TFile) await openOrReveal(this.app, sheet);
			return;
		}

		this.activeTab = 'world';
		if (this._worldPreviewRoot !== projectRoot) {
			this._worldPreviewStack = [];
			this._worldPreviewRoot = projectRoot;
		}
		if (this._worldPreviewStack[this._worldPreviewStack.length - 1] !== entityPath) {
			this._worldPreviewStack.push(entityPath);
		}
		await this.renderAll();
	}

	// ─── Data ──────────────────────────────────────────────────────────────────

	private allGridFiles(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((f) => f.extension === 'storygrid')
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	/** Public accessor for the grid the panel currently reflects (active project/book). */
	getCurrentGridFile(): TFile | null {
		return this.currentGridFile();
	}

	private currentGridFile(): TFile | null {
		const grids = this.allGridFiles();
		if (grids.length === 0) return null;
		// One active project everywhere: the globally selected project wins,
		// even over series-mode book state (a standalone project can be active
		// while a series exists in the same vault).
		// (grids is mtime-sorted, so a multi-grid project yields its newest grid)
		const activeRoot = this.plugin.settings.activeProjectRoot;
		if (activeRoot) {
			// Entire-series focus: the panel still shows one book — resolve to the
			// active book's grid, never the series-level arc grid.
			const isSeriesRoot = Object.values(this.plugin.settings.seriesRegistry ?? {})
				.some((sr) => sr.rootPath === activeRoot);
			if (isSeriesRoot) {
				const book = this.plugin.settings.activeBookId
					? this.plugin.settings.bookRegistry?.[this.plugin.settings.activeBookId]
					: undefined;
				if (book?.gridPath) {
					const bookGrid = grids.find((g) => g.path === book.gridPath);
					if (bookGrid) {
						this.gridPath = bookGrid.path;
						return bookGrid;
					}
				}
			} else {
				const inActive = grids.find((g) => projectRootFromGridPath(g.path) === activeRoot);
				if (inActive) {
					this.gridPath = inActive.path;
					return inActive;
				}
			}
		}
		if (this.plugin.settings.isSeriesMode) {
			// If the currently open grid is a registered book, use the active book.
			// If it's a standalone grid (not in the book registry), treat it normally —
			// this lets standalone grids work alongside a series in the same vault.
			const allBookPaths = new Set(
				Object.values(this.plugin.settings.bookRegistry ?? {}).map((b) => b.gridPath)
			);
			const openGridIsBook = this.gridPath && allBookPaths.has(this.gridPath);
			if (openGridIsBook) {
				const book = this.plugin.settings.activeBookId
					? this.plugin.settings.bookRegistry?.[this.plugin.settings.activeBookId]
					: undefined;
				const bookGrid = book?.gridPath ? grids.find((g) => g.path === book.gridPath) : undefined;
				if (bookGrid) return bookGrid;
				// The active book's grid file no longer exists (project removed) —
				// don't show a false "no grids" empty state when other projects
				// still exist; fall through to the general fallback below.
				this.gridPath = null;
			}
		}
		const match = grids.find((f) => f.path === this.gridPath);
		if (match) return match;
		this.gridPath = grids[0].path;
		return grids[0];
	}

	/** True when this grid is a registered series book (vs a standalone project). */
	private gridIsRegisteredBook(gridFile: TFile): boolean {
		return Object.values(this.plugin.settings.bookRegistry ?? {})
			.some((b) => b.gridPath === gridFile.path);
	}

	/** In Series mode returns the series root (shared Codex); otherwise the project root. */
	private getWorldRoot(gridFile: TFile): string {
		if (this.plugin.settings.isSeriesMode && this.plugin.settings.activeSeriesId
			&& this.gridIsRegisteredBook(gridFile)) {
			const series = this.plugin.settings.seriesRegistry?.[this.plugin.settings.activeSeriesId];
			if (series?.rootPath && this.app.vault.getAbstractFileByPath(series.rootPath)) {
				return series.rootPath;
			}
		}
		return projectRootFromGridPath(gridFile.path) ?? '';
	}

	/** In Series mode returns the active book root; otherwise the project root. */
	private getBookRoot(gridFile: TFile): string {
		if (this.plugin.settings.isSeriesMode && this.plugin.settings.activeBookId
			&& this.gridIsRegisteredBook(gridFile)) {
			const book = this.plugin.settings.bookRegistry?.[this.plugin.settings.activeBookId];
			if (book?.gridPath) return projectRootFromGridPath(book.gridPath) ?? '';
		}
		return projectRootFromGridPath(gridFile.path) ?? '';
	}

	private async readGrid(file: TFile): Promise<GridData | null> {
		try {
			return JSON.parse(await this.app.vault.read(file)) as GridData;
		} catch {
			return null;
		}
	}

	/** Lazily create the persisted compile-state bucket for one grid. */
	private compileStateFor(
		gridPath: string
	): { excluded: string[]; manuscriptName?: string; coverImagePath?: string; workflowId?: string } {
		const all = (this.plugin.settings.compileState ??= {});
		return (all[gridPath] ??= { excluded: [] });
	}

	/** Persisted set of scene doc paths excluded from the next compile. */
	private excludedFor(gridPath: string): Set<string> {
		return new Set(this.compileStateFor(gridPath).excluded);
	}

	private saveExcluded(gridPath: string, excluded: Set<string>): void {
		this.compileStateFor(gridPath).excluded = [...excluded];
		void this.plugin.saveData(this.plugin.settings);
	}

	// ─── Rendering ─────────────────────────────────────────────────────────────

	/** Bumped on every render; stale async renders bail out instead of
	 *  appending a second copy of the panel after a newer render finished. */
	private _renderGen = 0;
	// Compile-tab text fields save on every keystroke; debounce so typing
	// doesn't hit disk (and Sync) on every character.
	private debouncedSaveQuiet = debounce(() => { void this.plugin.saveData(this.plugin.settings); }, 600);

	async renderAll(): Promise<void> {
		const gen = ++this._renderGen;
		const el = this.contentEl;

		const gridFile = this.currentGridFile();
		if (!gridFile) {
			el.empty();
			const empty = el.createDiv({ cls: 'sg-outline-empty' });
			const seriesMode = this.plugin.settings.isSeriesMode;
			const bookName = seriesMode && this.plugin.settings.activeBookId
				? this.plugin.settings.bookRegistry?.[this.plugin.settings.activeBookId]?.name
				: undefined;
			if (seriesMode && bookName) {
				empty.createEl('p', { text: i18n('outline.empty.bookNoGrid', { bookName }) });
			} else if (seriesMode) {
				empty.createEl('p', { text: i18n('outline.empty.selectBook') });
			} else {
				empty.createEl('p', { text: i18n('outline.empty.noGrids') });
			}
			const actions = empty.createDiv({ cls: 'sg-outline-empty-actions' });
			const newBtn = actions.createEl('button', { cls: 'sg-outline-btn', text: i18n('outline.empty.createGrid') });
			newBtn.addEventListener('click', () => this.plugin.createNewGrid());
			const openBtn = actions.createEl('button', { cls: 'sg-outline-btn', text: i18n('outline.empty.openProject') });
			openBtn.addEventListener('click', () => void this.plugin.openGridPicker());
			return;
		}

		const grid = await this.readGrid(gridFile);
		if (gen !== this._renderGen) return;
		// Clear only now that the new content is ready — keeps the old panel
		// visible during the async read so it repaints in one shot (no flash).
		el.empty();
		if (!grid) {
			el.createDiv({ cls: 'sg-outline-empty', text: i18n('outline.empty.readError') });
			return;
		}

		this.renderHeader(el, gridFile);
		this.renderSprintBanner(el);
		// Each mode shows its own tabs (Creator Grid View: Codex + Progress only). A tab the mode hides falls
		// back to the first one it shows; Compile is a drill-in page, not a tab, so it is left alone.
		const shownTabs = writersPanelTabsFor(this.plugin.settings.intent, this.plugin.settings.writersPanelTabs);
		if (this.activeTab !== 'compile' && !(shownTabs as OutlineTab[]).includes(this.activeTab)) this.activeTab = shownTabs[0];
		this.renderTabs(el, shownTabs);

		const body = el.createDiv({ cls: 'sg-outline-body' });
		if (this.activeTab === 'writing') {
			this.renderWritingTab(body, gridFile, grid);
		} else if (this.activeTab === 'world') {
			this.renderWorldTab(body, gridFile);
		} else if (this.activeTab === 'coach') {
			this.renderCoachTab(body, gridFile);
		} else if (this.activeTab === 'dashboard') {
			this.renderDashboardTab(body, gridFile);
		} else {
			await this.renderCompileTab(body, gridFile, grid);
		}
	}

	private renderHeader(el: HTMLElement, gridFile: TFile): void {
		const header = el.createDiv({ cls: 'sg-outline-header' });

		// Series context only makes sense when the grid on the desk is a registered
		// book; a standalone project focused alongside a series gets its own title.
		if (this.plugin.settings.isSeriesMode && this.gridIsRegisteredBook(gridFile)) {
			this.renderSeriesContextLabel(header);
		} else {
			this.renderStandaloneTitle(header, gridFile);
		}

		// Standard quick-launch row — identical to the one in the Codex and Dashboard
		// headers; per-link visibility + placement come from Settings → Quick-links.
		this.plugin.renderQuickLaunchRow(header, 'panel', gridFile);
	}

	/** Standalone mode: read-only title label showing the active grid. */
	private renderStandaloneTitle(header: HTMLElement, gridFile: TFile): void {
		header.createSpan({ cls: 'sg-outline-project-title', text: gridFile.basename });
	}

	/** Series mode: read-only label showing the active series and book (set from Dashboard). */
	private renderSeriesContextLabel(header: HTMLElement): void {
		const seriesRegistry = this.plugin.settings.seriesRegistry ?? {};
		const bookRegistry = this.plugin.settings.bookRegistry ?? {};
		let activeSeriesId = this.plugin.settings.activeSeriesId ?? '';

		// Ignore books whose grid file is gone (project deleted) and series left
		// with no live books — otherwise this label shows a phantom project while
		// the Dashboard, which resolves against real files, shows a different one.
		// Non-destructive on purpose: a synced vault can have files temporarily
		// missing, so hide rather than prune. See the same guard in findCodexScopes.
		const bookGridExists = (b: { gridPath?: string }): boolean =>
			!!b.gridPath && this.app.vault.getAbstractFileByPath(b.gridPath) instanceof TFile;
		const allSeriesIds = Object.keys(seriesRegistry).filter((sid) =>
			Object.values(bookRegistry).some((b) => b.seriesId === sid && bookGridExists(b))
		);
		if (!seriesRegistry[activeSeriesId] || !allSeriesIds.includes(activeSeriesId)) {
			activeSeriesId = allSeriesIds[0] ?? '';
		}

		const booksInSeries = Object.entries(bookRegistry)
			.filter(([, b]) => b.seriesId === activeSeriesId && bookGridExists(b));
		let activeBookId = this.plugin.settings.activeBookId ?? '';
		if (!bookRegistry[activeBookId] || bookRegistry[activeBookId].seriesId !== activeSeriesId
			|| !bookGridExists(bookRegistry[activeBookId])) {
			activeBookId = booksInSeries[0]?.[0] ?? '';
		}

		// Persist corrections so currentGridFile() reads consistent values
		if (this.plugin.settings.activeSeriesId !== activeSeriesId ||
			this.plugin.settings.activeBookId !== activeBookId) {
			this.plugin.settings.activeSeriesId = activeSeriesId;
			this.plugin.settings.activeBookId = activeBookId || undefined;
			void this.plugin.saveData(this.plugin.settings);
		}

		const seriesName = seriesRegistry[activeSeriesId]?.name ?? i18n('outline.series.noneSelected');
		const bookName = bookRegistry[activeBookId]?.name;

		const label = header.createDiv({ cls: 'sg-series-context-label' });
		label.createSpan({ cls: 'sg-series-context-series', text: seriesName });
		if (bookName) {
			label.createSpan({ cls: 'sg-series-context-sep', text: ' / ' });
			if (booksInSeries.length > 1) {
				// The book on the desk — click to flip within this series only.
				const chip = label.createEl('button', {
					cls: 'sg-series-context-book sg-series-book-chip',
					attr: { 'aria-label': i18n('outline.series.switchBookAria') },
				});
				chip.createSpan({ text: bookName });
				chip.createSpan({ cls: 'sg-series-book-chip-caret', text: '▾' });
				chip.addEventListener('click', (e) => {
					const menu = new Menu();
					for (const [bid, b] of booksInSeries) {
						menu.addItem((i) => i
							.setTitle(b.name)
							.setChecked(bid === activeBookId)
							.onClick(async () => {
								const s = this.plugin.settings;
								s.activeBookId = bid;
								const seriesRoot = seriesRegistry[activeSeriesId]?.rootPath;
								// When a book lives in the series folder itself, that folder means
								// the book, not "entire series" — so always move the whole app.
								const rootIsBook = booksInSeries.some(([, x]) =>
									!!x.gridPath && projectRootFromGridPath(x.gridPath) === seriesRoot);
								const bookRoot = b.gridPath ? projectRootFromGridPath(b.gridPath) ?? '' : '';
								if (b.gridPath && (s.activeProjectRoot !== seriesRoot || rootIsBook)
									&& s.activeProjectRoot !== bookRoot) {
									// Book-level focus: move the whole app to the new book
									await this.plugin.setActiveProjectRoot(bookRoot);
								} else {
									// Entire-series focus stays; only the desk changes book
									await this.plugin.saveData(s);
									document.dispatchEvent(new CustomEvent('storygrid:project-changed'));
								}
							}));
					}
					menu.showAtMouseEvent(e);
				});
			} else {
				label.createSpan({ cls: 'sg-series-context-book', text: bookName });
			}
		}
	}

	// ─── Sprint banner (above tabs) ────────────────────────────────────────────

	private renderSprintBanner(el: HTMLElement): void {
		if (this._bannerTick) { window.cancelAnimationFrame(this._bannerTick); this._bannerTick = null; }

		const isActive = this.plugin.isSprintActive();
		const completion = this.plugin.getSprintCompletion();

		if (!isActive && !completion) return;

		const banner = el.createDiv({ cls: 'sg-sprint-banner' });

		// Liquid fill: GPU-composited scaleX drain — no layout reflow
		const liquidEl = banner.createDiv({ cls: 'sg-sprint-liquid' });
		// Bubbles are siblings (not children) so they don't distort when liquid scaleX's.
		// Parent overflow:hidden clips them; they're naturally faint in the unfilled zone.
		for (let i = 1; i <= 6; i++) {
			banner.createDiv({ cls: `sg-sprint-bubble sg-sprint-bubble-${i}` });
		}

		const main = banner.createDiv({ cls: 'sg-sprint-banner-main' });

		if (isActive) {
			const duration = this.plugin.getSprintDuration() || 1;
			const wordGoal = this.plugin.getSprintWordGoal();

			const fmt = (ms: number) => {
				const t = Math.max(0, Math.ceil(ms / 1000));
				return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
			};

			// Top row: large timer + ghost Stop button
			const row = main.createDiv({ cls: 'sg-sprint-banner-row' });
			const timerEl = row.createEl('span', { cls: 'sg-sprint-banner-time' });

			const stopBtn = row.createEl('button', { cls: 'sg-sprint-banner-stop', attr: { 'aria-label': i18n('outline.sprint.stopAria') } });
			stopBtn.createSpan({ cls: 'sg-sprint-banner-stop-icon', text: '■' });
			stopBtn.createSpan({ text: i18n('outline.sprint.stopButton') });
			stopBtn.addEventListener('click', () => this.plugin.stopSprint());

			// Word count line: current (primary) + goal (muted)
			const wordsEl = main.createDiv({ cls: 'sg-sprint-banner-words' });

			let _lastTimerText = '';
			let _lastWordsWritten = -1;
			const tick = () => {
				if (!banner.isConnected || !this.plugin.isSprintActive()) {
					if (this._bannerTick) { window.cancelAnimationFrame(this._bannerTick); this._bannerTick = null; }
					if (banner.isConnected) void this.renderAll();
					return;
				}
				const rem = this.plugin.getSprintRemaining();
				// GPU-composited drain — scaleX never triggers layout reflow
				liquidEl.style.transform = `scaleX(${Math.max(0, Math.min(1, rem / duration))})`;

				// Timer text — only mutate DOM when the second actually changes
				const timeText = fmt(rem);
				if (timeText !== _lastTimerText) {
					_lastTimerText = timeText;
					timerEl.setText(timeText);
				}
				// Word count — only re-render when count changes
				const written = this.plugin.getSprintWordsWritten();
				if (written !== _lastWordsWritten) {
					_lastWordsWritten = written;
					wordsEl.empty();
					wordsEl.createSpan({ text: i18n('outline.sprint.wordsWritten', { count: written.toLocaleString() }) });
					if (wordGoal > 0) {
						wordsEl.createSpan({ cls: 'sg-sprint-banner-goal', text: i18n('outline.sprint.wordGoalSuffix', { count: wordGoal.toLocaleString() }) });
					}
				}
				this._bannerTick = window.requestAnimationFrame(tick);
			};
			this._bannerTick = window.requestAnimationFrame(tick);

		} else if (completion) {
			banner.addClass('is-success');
			banner.style.setProperty('--sprint-fill', '100%');
			const mins = Math.max(1, Math.round(completion.elapsedMs / 60_000));

			main.createDiv({ cls: 'sg-sprint-banner-success-title', text: i18n('outline.sprint.completeTitle') });
			main.createDiv({
				cls: 'sg-sprint-banner-success-stat',
				text: i18n('outline.sprint.completeStat', { words: completion.wordsWritten.toLocaleString(), mins }),
			});

			const btns = main.createDiv({ cls: 'sg-sprint-banner-success-btns' });
			const logBtn = btns.createEl('button', { cls: 'sg-sprint-banner-btn', text: i18n('outline.sprint.logClose') });
			logBtn.addEventListener('click', () => {
				this.plugin.clearSprintCompletion();
				void this.renderAll();
			});
			const againBtn = btns.createEl('button', { cls: 'sg-sprint-banner-btn sg-sprint-banner-btn--primary', text: i18n('outline.sprint.again') });
			againBtn.addEventListener('click', () => {
				this.plugin.clearSprintCompletion();
				openSprintSetup(this.app, this.plugin.getDefaultSprintMinutes(), (m, goal) => {
					this.plugin.startSprint(m, goal);
				});
			});
		}
	}

	private renderTabs(el: HTMLElement, shown: readonly OutlineTab[]): void {
		const ALL_TABS: { id: OutlineTab; label: string; icon: string; fallback: string }[] = [
			{ id: 'writing', label: i18n('outline.tabs.writing'), icon: WRITERS_PANEL_ICON, fallback: '◆' },
			{ id: 'world', label: i18n('outline.tabs.world'), icon: CODEX_ICON, fallback: '◆' },
			{ id: 'coach', label: i18n('outline.tabs.coach'), icon: 'sparkles', fallback: '✦' },
			{ id: 'dashboard', label: i18n('outline.tabs.progress'), icon: 'check-square', fallback: '◆' },
		];
		const TABS = ALL_TABS.filter((tab) => shown.includes(tab.id));
		const ctrl = el.createDiv({ cls: 'sg-flat-tabs' });
		ctrl.setAttribute('role', 'tablist');

		const opts: HTMLElement[] = [];
		const activate = (tab: (typeof TABS)[number]) => {
			if (this.activeTab === tab.id) return;
			this.activeTab = tab.id;
			void this.renderAll();
		};

		for (const tab of TABS) {
			const isActive = this.activeTab === tab.id;
			const opt = ctrl.createDiv({ cls: 'sg-flat-tab' + (isActive ? ' is-active' : '') });
			opt.setAttribute('role', 'tab');
			opt.setAttribute('aria-selected', isActive ? 'true' : 'false');
			opt.setAttribute('tabindex', isActive ? '0' : '-1');
			const ic = opt.createSpan({ cls: 'sg-flat-tab-icon' });
			setPhosphorIcon(ic, tab.icon, tab.fallback);
			opt.createSpan({ text: tab.label });
			opt.addEventListener('click', () => activate(tab));
			opts.push(opt);
		}

		ctrl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
			const current = TABS.findIndex((tab) => tab.id === this.activeTab);
			if (current === -1) return;
			const next = e.key === 'ArrowRight'
				? (current + 1) % TABS.length
				: (current - 1 + TABS.length) % TABS.length;
			e.preventDefault();
			opts[next].focus();
			activate(TABS[next]);
		});
	}

	// ─── Writing tab ───────────────────────────────────────────────────────────

	private renderWritingTab(body: HTMLElement, gridFile: TFile, grid: GridData): void {
		const projectRoot = projectRootFromGridPath(gridFile.path) ?? '';
		const list = body.createDiv({ cls: 'sg-outline-list sg-outline-list--flat sg-outline-list--tree' });

		// The manuscript is a nestable outline of scene DOCUMENTS plus optional
		// "divider" rows (Act / Beat / whatever the author calls them — no
		// fixed vocabulary). Cards are planning objects on the grid — several
		// can feed one scene — so they never appear here. Numbering is always
		// derived from tree position, never stored, so moving or nesting a row
		// renumbers everything under it automatically.
		const docs = this.sceneDocsFor(gridFile);
		const dash = ensureDashboard(this.plugin.settings);
		const tree = resolveSceneTree(dash.sceneTree?.[projectRoot], dash.sceneOrder?.[projectRoot], docs.map((d) => d.path));
		const storedTree = dash.sceneTree?.[projectRoot] ?? [];
		// Reference inequality alone is a false positive here: `?? []` mints a
		// fresh empty array on every render, so an empty tree would otherwise
		// look "changed" and force a save + project-mirror write every time.
		if (JSON.stringify(tree) !== JSON.stringify(storedTree)) {
			// New docs on disk got appended — persist quietly, no full rerender.
			(dash.sceneTree ??= {})[projectRoot] = tree;
			void this.plugin.saveData(this.plugin.settings);
			void writeProjectMirror(this.app, projectRoot, dash);
		}

		const byPath = new Map(docs.map((d) => [d.path, d]));
		// First card linking each doc supplies the status dot + word goal.
		const cardByDoc = new Map<string, SceneCard>();
		for (const c of grid.cards) {
			if (c.linkedDocPath && !cardByDoc.has(c.linkedDocPath)) cardByDoc.set(c.linkedDocPath, c);
		}
		const activePath = this.app.workspace.getActiveFile()?.path ?? null;

		const persistTree = (next: SceneTree) => void this.saveSceneTree(projectRoot, next);

		this.renderSceneTreeNodes(list, tree, tree, 0, '', null, { projectRoot, byPath, cardByDoc, activePath, persistTree });

		if (tree.length === 0) {
			list.createDiv({
				cls: 'sg-outline-scene sg-outline-scene--empty',
				text: i18n('outline.writing.noScenes'),
			});
		}

		this.setupTreeDrag(list, tree);

		// New scene — a quiet "create" affordance below the list, Longform-style.
		const newRow = body.createDiv({ cls: 'sg-outline-new-scene-row' });
		const newIc = newRow.createSpan({ cls: 'sg-outline-tab-icon' });
		setPhosphorIcon(newIc, 'plus', '+');
		const input = newRow.createEl('input', {
			cls: 'sg-outline-new-scene',
			type: 'text',
			placeholder: i18n('outline.writing.newScenePlaceholder'),
		});
		let creatingScene = false;
		input.addEventListener('keydown', (e) => {
			if (e.key !== 'Enter' || e.isComposing || e.repeat) return;
			if (creatingScene) return;
			const name = input.value.trim();
			if (!name) return;
			input.value = '';
			creatingScene = true;
			void this.createScene(gridFile, name).then((ok) => {
				// Creation failed (a Notice already said why) — hand the name back
				// so it isn't lost, unless they've started typing something new.
				if (!ok && input.value === '') input.value = name;
			}).finally(() => {
				creatingScene = false;
			});
		});

		// New divider — a quiet secondary affordance for Act/Beat-style headings.
		const dividerRow = body.createDiv({ cls: 'sg-outline-new-scene-row sg-outline-new-divider-row' });
		const dividerIc = dividerRow.createSpan({ cls: 'sg-outline-tab-icon' });
		setPhosphorIcon(dividerIc, 'text-indent', '#');
		dividerRow.createSpan({ text: i18n('outline.writing.newDivider') });
		dividerRow.setAttribute('role', 'button');
		dividerRow.setAttribute('tabindex', '0');
		const addDivider = () => {
			new TextPromptModal(this.app, i18n('outline.writing.newDividerModalTitle'), '', (label) => {
				void this.saveSceneTree(projectRoot, [...tree, createDividerNode(label)]);
			}).open();
		};
		dividerRow.addEventListener('click', addDivider);
		dividerRow.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') addDivider(); });

		// Export sits quietly at the foot of the panel — it only matters once
		// the draft is done, so it doesn't deserve a tab of its own.
		const compileLink = body.createDiv({ cls: 'sg-outline-compile-link' });
		compileLink.setAttribute('role', 'button');
		compileLink.setAttribute('tabindex', '0');
		setPhosphorIcon(compileLink.createSpan({ cls: 'sg-outline-tab-icon' }), 'book-bookmark', '📖');
		compileLink.createSpan({ text: i18n('outline.writing.exportManuscript') });
		const openCompile = () => {
			this.activeTab = 'compile';
			void this.renderAll();
		};
		compileLink.addEventListener('click', openCompile);
		compileLink.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openCompile(); });
	}

	/** Recursive, collapse-aware render of the scene tree. Numbers are computed purely from position. */
	private renderSceneTreeNodes(
		list: HTMLElement,
		fullTree: SceneTree,
		nodes: SceneTreeNode[],
		depth: number,
		numberPrefix: string,
		parentId: string | null,
		ctx: {
			projectRoot: string;
			byPath: Map<string, TFile>;
			cardByDoc: Map<string, SceneCard>;
			activePath: string | null;
			persistTree: (next: SceneTree) => void;
		}
	): void {
		nodes.forEach((node, i) => {
			const number = numberPrefix ? `${numberPrefix}.${i + 1}` : `${i + 1}`;
			this.renderSceneTreeRow(list, fullTree, node, depth, number, parentId, ctx);
			if (node.children.length) {
				const collapseKey = `tree::${ctx.projectRoot}::${node.id}`;
				const collapsed = node.kind === 'divider' && (this.plugin.settings.outlineCollapsedGroups?.[collapseKey] ?? false);
				if (!collapsed) {
					this.renderSceneTreeNodes(list, fullTree, node.children, depth + 1, number, node.id, ctx);
				}
			}
		});
	}

	private renderSceneTreeRow(
		list: HTMLElement,
		fullTree: SceneTree,
		node: SceneTreeNode,
		depth: number,
		number: string,
		parentId: string | null,
		ctx: {
			projectRoot: string;
			byPath: Map<string, TFile>;
			cardByDoc: Map<string, SceneCard>;
			activePath: string | null;
			persistTree: (next: SceneTree) => void;
		}
	): void {
		const isDivider = node.kind === 'divider';
		const doc = !isDivider && node.docPath ? ctx.byPath.get(node.docPath) : undefined;
		const collapseKey = `tree::${ctx.projectRoot}::${node.id}`;
		const isCollapsed = isDivider && (this.plugin.settings.outlineCollapsedGroups?.[collapseKey] ?? false);

		const item = list.createDiv({ cls: 'sg-outline-scene' + (isDivider ? ' sg-outline-scene--divider' : '') });
		item.dataset.nodeId = node.id;
		item.dataset.parentId = parentId ?? '';
		item.dataset.depth = String(depth);
		if (doc) item.dataset.docPath = doc.path;
		item.style.paddingLeft = `${StorygridOutlineView.TREE_BASE_PAD + depth * StorygridOutlineView.TREE_INDENT}px`;
		item.setAttribute('role', 'button');
		item.setAttribute('tabindex', '0');
		if (doc && doc.path === ctx.activePath) item.addClass('is-active');

		if (isDivider) {
			const chev = item.createSpan({ cls: 'sg-outline-scene-chevron' + (node.children.length ? '' : ' is-empty') });
			if (node.children.length) setPhosphorIcon(chev, isCollapsed ? 'caret-right' : 'caret-down', isCollapsed ? '▸' : '▾');
		}

		item.createSpan({ cls: 'sg-outline-scene-num', text: `${number}.` });

		if (!isDivider && doc) {
			const card = ctx.cardByDoc.get(doc.path);
			if (card) {
				const dot = item.createSpan({ cls: 'sg-outline-scene-dot' });
				dot.style.background = this.plugin.settings.statusColors[card.status] ?? 'var(--sg-status-dot)';
				dot.setAttribute('aria-label', card.status);
			}
			item.createSpan({ cls: 'sg-outline-scene-title', text: doc.basename });
			const meta = item.createSpan({ cls: 'sg-outline-scene-words' });
			docWordCount(this.app, doc.path, this._wordCache).then((w) => {
				if (w === null || !meta.isConnected) return;
				const goal = card?.wordGoal;
				if (goal && goal > 0) {
					const pct = Math.min(100, Math.round((w / goal) * 100));
					meta.setText(i18n('outline.writing.wordProgress', { count: w.toLocaleString(), goal: goal.toLocaleString() }));
					meta.setAttribute('title', i18n('outline.writing.goalPercentTitle', { pct }));
					if (w >= goal) meta.addClass('is-met');
				} else {
					meta.setText(i18n('outline.writing.wordCountSuffix', { count: w.toLocaleString() }));
				}
			});
		} else if (isDivider) {
			item.createSpan({ cls: 'sg-outline-scene-title sg-outline-divider-title', text: node.label || i18n('outline.writing.untitledDivider') });
		} else {
			// Doc node whose file has vanished from disk — render it inert; the
			// next tree-changing action will drop it (mirrors old sceneOrder behavior).
			item.createSpan({ cls: 'sg-outline-scene-title', text: i18n('outline.writing.missingFile') });
		}

		const toggleCollapse = () => {
			const map = (this.plugin.settings.outlineCollapsedGroups ??= {});
			map[collapseKey] = !isCollapsed;
			void this.plugin.saveData(this.plugin.settings);
			void this.renderAll();
		};
		// Mark the clicked row active immediately (don't wait on the async
		// leaf-reveal/active-leaf-change round trip) so jumping to a doc feels
		// instant — refreshActiveHighlight() re-confirms this from the real
		// active file once the event fires, so it can't drift out of sync.
		const open = doc
			? () => {
				list.querySelectorAll('.sg-outline-scene.is-active').forEach((el) => el.removeClass('is-active'));
				item.addClass('is-active');
				void openOrReveal(this.app, doc);
			}
			: undefined;
		const primaryAction = isDivider ? toggleCollapse : open;
		if (primaryAction) {
			item.addEventListener('click', primaryAction);
			item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') primaryAction(); });
		}

		// One menu, two ways in: right-click / long-press on the computer, and the
		// ⋯ button on phones (there a long-press starts the drag instead, so the
		// contextmenu event never fires).
		const buildRowMenu = (): Menu => {
			const menu = new Menu();
			if (open) menu.addItem((m) => m.setTitle(i18n('outline.menu.open')).setIcon('file-text').onClick(open));
			menu.addItem((m) =>
				m.setTitle(i18n('outline.menu.rename')).setIcon('pencil').onClick(() => {
					const currentName = isDivider ? (node.label ?? '') : (doc?.basename ?? '');
					new TextPromptModal(this.app, isDivider ? i18n('outline.writing.renameDividerTitle') : i18n('outline.writing.renameSceneTitle'), currentName, async (name) => {
						if (isDivider) {
							ctx.persistTree(renameDividerLabel(fullTree, node.id, name));
						} else if (doc && name !== doc.basename) {
							const folder = doc.parent?.path ? doc.parent.path + '/' : '';
							try {
								await this.app.fileManager.renameFile(doc, `${folder}${name}.md`);
							} catch {
								new Notice(i18n('outline.notice.renameFailed'));
							}
						}
					}).open();
				})
			);
			menu.addItem((m) =>
				m.setTitle(i18n('outline.menu.indent')).setIcon('arrow-right').onClick(() => ctx.persistTree(indentNode(fullTree, node.id)))
			);
			menu.addItem((m) =>
				m.setTitle(i18n('outline.menu.outdent')).setIcon('arrow-left').onClick(() => ctx.persistTree(outdentNode(fullTree, node.id)))
			);
			// Move up / down: reorder without dragging (a long-press menu on the phone). Same level only.
			if (canMoveSibling(fullTree, node.id, -1)) {
				menu.addItem((m) =>
					m.setTitle(i18n('outline.menu.moveUp')).setIcon('arrow-up').onClick(() => ctx.persistTree(moveSibling(fullTree, node.id, -1)))
				);
			}
			if (canMoveSibling(fullTree, node.id, 1)) {
				menu.addItem((m) =>
					m.setTitle(i18n('outline.menu.moveDown')).setIcon('arrow-down').onClick(() => ctx.persistTree(moveSibling(fullTree, node.id, 1)))
				);
			}
			menu.addSeparator();
			menu.addItem((m) =>
				m.setTitle(i18n('common.delete')).setIcon('trash').onClick(() => {
					const label = isDivider ? (node.label || i18n('outline.writing.thisDividerFallback')) : (doc?.basename ?? i18n('outline.writing.thisSceneFallback'));
					const message = isDivider
						? i18n('outline.writing.deleteDividerConfirm', { label })
						: i18n('outline.writing.deleteSceneConfirm', { label });
					new ConfirmModal(this.app, message, i18n('common.delete'), async () => {
						if (isDivider) {
							ctx.persistTree(removeNodePromotingChildren(fullTree, node.id));
						} else if (doc) {
							await this.app.fileManager.trashFile(doc);
							new Notice(i18n('outline.notice.deletedFile', { name: doc.basename }));
						}
					}).open();
				})
			);
			return menu;
		};
		item.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			buildRowMenu().showAtMouseEvent(e);
		});
		if (Platform.isMobile) {
			const moreBtn = item.createEl('button', { cls: 'sg-outline-scene-more clickable-icon' });
			moreBtn.setAttribute('aria-label', i18n('taskList.menu.moreActionsAria'));
			moreBtn.draggable = false;
			setPhosphorIcon(moreBtn, 'dots-three', '⋯');
			moreBtn.addEventListener('click', (e) => {
				e.stopPropagation(); // don't also open the scene / fold the divider
				const r = moreBtn.getBoundingClientRect();
				buildRowMenu().showAtPosition({ x: r.left, y: r.bottom });
			});
			moreBtn.addEventListener('keydown', (e) => e.stopPropagation());
		}

		// Drag to reorder AND re-nest — vertical position picks the insertion
		// point, horizontal position picks the depth. The live projection is
		// computed by the container-level dragover handler (setupTreeDrag), which
		// stashes the resolved target on `this._treeDrop`; we apply it on drop.
		item.draggable = true;
		item.addEventListener('dragstart', (e) => {
			e.dataTransfer?.setData('text/plain', node.id);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
			const ghost = document.createElement('div');
			ghost.textContent = isDivider ? (node.label || '') : (doc?.basename ?? '');
			Object.assign(ghost.style, {
				position: 'fixed', top: '-9999px', left: '-9999px',
				width: item.offsetWidth + 'px', padding: '6px 10px',
				background: 'var(--background-secondary)',
				border: '1px dashed var(--interactive-accent)',
				borderRadius: '6px', color: 'var(--text-normal)',
				fontSize: '13px', opacity: '0.9', pointerEvents: 'none', boxSizing: 'border-box',
			});
			document.body.appendChild(ghost);
			e.dataTransfer?.setDragImage(ghost, e.offsetX || 20, e.offsetY || 12);
			this._treeDrop = null;
			this._treeDragCache = null;
			this._treeDragStart = { x: e.clientX, depth };
			setTimeout(() => {
				if (document.body.contains(ghost)) document.body.removeChild(ghost);
				item.addClass('is-dragging');
			}, 0);
		});
		item.addEventListener('dragend', () => {
			item.removeClass('is-dragging');
			const drop = this._treeDrop;
			this._treeDrop = null;
			this._treeDragStart = null;
			this._treeDragCache = null;
			list.querySelector('.sg-outline-drop-line')?.removeClass('is-visible');
			list.querySelectorAll('.sg-outline-scene.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
			if (!drop) return;
			ctx.persistTree(moveNodeBefore(fullTree, node.id, drop.parentId, drop.beforeId));
		});
	}

	/** Indent step (px) between outline depth levels — matches renderSceneTreeRow's paddingLeft. */
	private static readonly TREE_INDENT = 16;
	private static readonly TREE_BASE_PAD = 16;

	/**
	 * Container-level drag machinery for the outline tree. Computes a live
	 * projection (insertion point from cursor Y, nesting depth from cursor X),
	 * draws a depth-aware drop line, and stashes the resolved {parentId,
	 * beforeId} on `this._treeDrop` for the row's dragend to apply.
	 */
	private setupTreeDrag(list: HTMLElement, tree: SceneTree): void {
		list.setCssStyles({ position: 'relative' });
		const line = list.createDiv({ cls: 'sg-outline-drop-line' });

		const clearDropTargets = () => {
			list.querySelectorAll('.sg-outline-scene.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
		};

		list.addEventListener('dragenter', (e: DragEvent) => e.preventDefault());
		list.addEventListener('dragleave', (e: DragEvent) => {
			// Only clear when the pointer actually leaves the list, not a child row.
			if (e.relatedTarget && list.contains(e.relatedTarget as Node)) return;
			this._treeDrop = null;
			line.removeClass('is-visible');
			clearDropTargets();
		});
		list.addEventListener('drop', (e: DragEvent) => e.preventDefault());
		// Rows don't move mid-drag except when the list itself scrolls —
		// invalidate the cached rects then so the next dragover rebuilds them.
		list.addEventListener('scroll', () => { this._treeDragCache = null; });

		list.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			const dragging = list.querySelector<HTMLElement>('.sg-outline-scene.is-dragging');
			if (!dragging || !this._treeDragStart) return;
			const draggedId = dragging.dataset.nodeId;
			if (!draggedId) return;

			// Visible rows + their rects are built once per drag session (not on
			// every dragover) — the list layout doesn't change mid-drag, so
			// re-querying and re-measuring on every mousemove was just jank.
			if (!this._treeDragCache) {
				// Candidate rows = every visible row except the dragged one and its
				// descendants (you can't drop a branch inside itself).
				const descendants = getDescendantIds(tree, draggedId);
				const rowEls = [...list.querySelectorAll<HTMLElement>('.sg-outline-scene')].filter((el) => {
					const id = el.dataset.nodeId;
					return id && id !== draggedId && !descendants.has(id);
				});
				const rows: ProjectionRow[] = rowEls.map((el) => ({
					id: el.dataset.nodeId!,
					parentId: el.dataset.parentId ? el.dataset.parentId : null,
					depth: Number(el.dataset.depth ?? 0),
				}));
				const rects = rowEls.map((el) => el.getBoundingClientRect());
				this._treeDragCache = { rowEls, rows, rects };
			}
			const { rowEls, rows, rects } = this._treeDragCache;

			// Insertion index from cursor Y (before the first row whose midpoint is below the cursor).
			let overIndex = rowEls.length;
			for (let i = 0; i < rects.length; i++) {
				if (e.clientY <= rects[i].top + rects[i].height / 2) { overIndex = i; break; }
			}

			// Desired depth from the horizontal distance dragged *since pickup*,
			// relative to the dragged row's own starting depth — you nudge
			// left/right to change nesting instead of hunting for an absolute
			// pixel column (this is what makes deep re-nests like 1.1.1 → 1.2
			// forgiving instead of fiddly).
			const deltaX = e.clientX - this._treeDragStart.x;
			const dragDepth = this._treeDragStart.depth + Math.round(deltaX / StorygridOutlineView.TREE_INDENT);
			const proj = getProjection(rows, overIndex, dragDepth);

			// The dragged node lands just before the first later row that shares
			// the chosen parent at the chosen depth; else it appends to the parent.
			let beforeId: string | null = null;
			for (let k = overIndex; k < rows.length; k++) {
				if (rows[k].depth < proj.depth) break;
				if (rows[k].depth === proj.depth && rows[k].parentId === proj.parentId) { beforeId = rows[k].id; break; }
			}
			this._treeDrop = { parentId: proj.parentId, beforeId };

			// Draw the drop line at the boundary, indented to the projected depth.
			const listRect = list.getBoundingClientRect();
			const boundaryRect = rects[overIndex];
			const yPx = boundaryRect
				? boundaryRect.top - listRect.top + list.scrollTop
				: (rects.length ? rects[rects.length - 1].bottom - listRect.top + list.scrollTop : 0);
			const leftPx = StorygridOutlineView.TREE_BASE_PAD + proj.depth * StorygridOutlineView.TREE_INDENT;
			line.style.top = `${yPx}px`;
			line.style.left = `${leftPx}px`;
			line.addClass('is-visible');

			// Nest-into highlight: only when the immediately preceding row is
			// about to become this node's parent (i.e. dropping in as its new
			// first child) — the one moment a line alone doesn't read clearly
			// as "inside", not just "indented under".
			clearDropTargets();
			const prevRow = rows[overIndex - 1];
			if (prevRow && proj.parentId === prevRow.id && proj.depth === prevRow.depth + 1) {
				rowEls[overIndex - 1].addClass('is-drop-target');
			}
		});
	}

	/**
	 * Mark exactly the scene row for the document in the focused editor — and
	 * only that one. Updates the DOM directly (no re-render) so switching docs
	 * is instant and never leaves a stale highlight behind.
	 */
	private refreshActiveHighlight(): void {
		const active = this.app.workspace.getActiveFile()?.path ?? null;
		const root = this.contentEl;
		root.querySelectorAll('.sg-outline-scene.is-active').forEach((el) => el.removeClass('is-active'));
		if (!active) return;
		const match = root.querySelector(`.sg-outline-scene[data-doc-path="${CSS.escape(active)}"]`);
		match?.addClass('is-active');
	}

	/** Persist the outline tree (quiet save + project mirror). */
	private async saveSceneTree(projectRoot: string, tree: SceneTree): Promise<void> {
		const dash = ensureDashboard(this.plugin.settings);
		(dash.sceneTree ??= {})[projectRoot] = tree;
		await this.plugin.saveData(this.plugin.settings);
		void writeProjectMirror(this.app, projectRoot, dash);
		await this.renderAll(); // numbering follows the new arrangement
	}

	/** Every scene document in the project's Scenes folder (book-filtered in Series Mode). */
	private sceneDocsFor(gridFile: TFile): TFile[] {
		const projectRoot = projectRootFromGridPath(gridFile.path);
		const folder = (projectRoot ? `${projectRoot}/Scenes` : 'Scenes') + '/';
		let files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder) && !isSafetyNetPath(f.path));
		if (this.plugin.settings.isSeriesMode && this.plugin.settings.activeBookId) {
			const bookId = this.plugin.settings.activeBookId;
			files = files.filter((f) => {
				const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
				// Include unstamped files (manual/legacy) and files matching this book
				if (!fm?.['storygrid-book-id']) return true;
				return fm['storygrid-book-id'] === bookId;
			});
		}
		return files;
	}

	/**
	 * A clean writing page in the project's Scenes folder. In Series Mode, the
	 * file is pre-stamped with YAML frontmatter so metadataCache can filter by
	 * series/book UUID without a read-then-write race condition.
	 */
	private async createCleanSceneDoc(gridFile: TFile, name: string): Promise<TFile> {
		const projectRoot = projectRootFromGridPath(gridFile.path);
		const folder = projectRoot ? `${projectRoot}/Scenes` : 'Scenes';
		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		const safeName = name.trim().replace(/[\\/:*?"<>|#^[\]]/g, '-') || 'New Scene';
		let path = `${folder}/${safeName}.md`;
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = `${folder}/${safeName} ${counter}.md`;
			counter++;
		}

		let initialContent = '';
		if (this.plugin.settings.isSeriesMode) {
			const seriesId = this.plugin.settings.activeSeriesId ?? '';
			const bookId = this.plugin.settings.activeBookId ?? '';
			if (seriesId && bookId) {
				initialContent = `---\nstorygrid-series-id: ${seriesId}\nstorygrid-book-id: ${bookId}\n---\n\n`;
			}
		}

		return this.app.vault.create(path, initialContent);
	}

	/**
	 * Create a scene document in the project's Scenes folder and open it for
	 * writing. No card is made — the scene appears under "Unplaced scenes"
	 * until it's dragged into the story (or linked from the card editor).
	 */
	private async createScene(gridFile: TFile, name: string): Promise<boolean> {
		let doc: TFile;
		try {
			doc = await this.createCleanSceneDoc(gridFile, name);
			// A new scene takes its place at the end of the outline (root level).
			const root = projectRootFromGridPath(gridFile.path) ?? '';
			const dash = ensureDashboard(this.plugin.settings);
			const tree = dash.sceneTree?.[root] ?? [];
			(dash.sceneTree ??= {})[root] = [...tree, createDocNode(doc.path)];
			await this.plugin.saveData(this.plugin.settings);
			void writeProjectMirror(this.app, root, dash);
			new Notice(i18n('outline.notice.sceneCreated', { name }));
		} catch (err) {
			new Notice(i18n('outline.notice.sceneCreateError', { error: err instanceof Error ? err.message : '' }));
			return false;
		}
		// The scene exists from here on; opening it is best-effort. A failed open
		// must not read as "could not create" (which would invite a duplicate).
		try {
			await openOrReveal(this.app, doc);
		} catch {
			/* leaf/open failure — the doc is in the outline and can be opened from there */
		}
		return true;
	}

	// ─── Sprint widget (Progress tab) ──────────────────────────────────────────

	/**
	 * Static sprint widget: the Start button (idle) or an "in progress" label
	 * (active), plus sprint-goal counts. The live timer/bar lives in the top
	 * banner card (renderSprintBanner) — never duplicated here.
	 */
	private renderSprintWidget(body: HTMLElement): void {
		if (this._sprintTick) { window.clearInterval(this._sprintTick); this._sprintTick = null; }

		const sec = body.createDiv({ cls: 'sg-outline-dash-section sg-outline-sprint' });
		const head = sec.createDiv({ cls: 'sg-outline-dash-head' });
		setPhosphorIcon(head.createSpan({ cls: 'sg-outline-tab-icon' }), 'timer', '◆');
		head.createSpan({ cls: 'sg-outline-dash-title', text: i18n('outline.sprint.sectionTitle') });

		// ── Sprint counts vs. goals (set in Settings → Writing) ────────────────
		const stats = this.plugin.getSprintStats();
		const goalRow = (label: string, done: number, goal: number | undefined) => {
			const row = sec.createDiv({ cls: 'sg-outline-goal-row' });
			row.createSpan({ cls: 'sg-outline-goal-label', text: label });
			const nums = row.createSpan({ cls: 'sg-outline-goal-nums' });
			nums.createSpan({ cls: 'sg-outline-goal-done', text: String(done) });
			if (goal && goal > 0) {
				nums.createSpan({ cls: 'sg-outline-goal-sep', text: '/' });
				nums.createSpan({ cls: 'sg-outline-goal-target', text: i18n('outline.sprint.targetSprints', { goal }) });
				const bar = sec.createDiv({ cls: 'sg-outline-bar' });
				const fill = bar.createDiv({ cls: 'sg-outline-bar-fill' });
				fill.style.width = `${Math.min(100, Math.round((done / goal) * 100))}%`;
				if (done >= goal) fill.addClass('is-met');
				const left = goal - done;
				sec.createDiv({
					cls: 'sg-sprint-left',
					text: left > 0
						? (left === 1
							? i18n('outline.sprint.moreToGoOne', { count: left, label: label.toLowerCase() })
							: i18n('outline.sprint.moreToGoOther', { count: left, label: label.toLowerCase() }))
						: i18n('outline.sprint.goalReached', { label }),
				});
			} else {
				nums.createSpan({ cls: 'sg-outline-goal-target', text: done === 1 ? i18n('outline.sprint.unitOne') : i18n('outline.sprint.unitOther') });
			}
		};
		goalRow(i18n('outline.period.today'), stats.today, this.plugin.settings.sprintGoalDaily);
		goalRow(i18n('outline.period.thisWeek'), stats.week, this.plugin.settings.sprintGoalWeekly);
	}

	// ─── Coach tab (prose coach — this scene only) ───────────────────────────
	//
	// Top to bottom: Marks in the text [Off | While revising | Always] → one
	// verdict sentence → folded groups (zero-count groups hidden) → the folded
	// "What the coach checks". Nothing is unfolded by default. Book-wide notes
	// live on the Dashboard ("Who's gone quiet"), never here.

	/** The note the coach reads: the most recent note in the main editor area (not this panel). */
	private coachSceneView(): MarkdownView | null {
		const view = this.coachOpenNote();
		return view?.file && this.plugin.coachIsScene(view.file) ? view : null;
	}

	/** The most recent Markdown note in the main area, scene or not. */
	private coachOpenNote(): MarkdownView | null {
		const view = this.app.workspace.getMostRecentLeaf()?.view;
		return view instanceof MarkdownView && view.file && view.file.extension === 'md' ? view : null;
	}

	private renderCoachTab(body: HTMLElement, _gridFile: TFile): void {
		const root = body.createDiv({ cls: 'sg-outline-coach' });

		if (this.plugin.isSprintActive()) {
			root.createDiv({ cls: 'sg-outline-coach-verdict is-dim', text: i18n('outline.coach.verdict.sprint') });
			const minutes = Math.max(1, Math.ceil(this.plugin.getSprintRemaining() / 60_000));
			root.createDiv({ cls: 'sg-outline-coach-sub', text: i18n('outline.coach.sprintLeft', { minutes: String(minutes) }) });
			return;
		}

		const s = (this.plugin.settings.proseCoach ??= {});
		const save = () => {
			void this.plugin.saveSettingsQuiet();
			this.plugin.refreshCoachMode(); // re-reads editors and re-renders this tab
		};

		// ── Marks in the text [Off | While revising | Always] ──────────────
		const modeRow = root.createDiv({ cls: 'sg-outline-coach-mode' });
		modeRow.createSpan({ cls: 'sg-outline-coach-mode-label', text: i18n('outline.coach.marksLabel') });
		const seg = modeRow.createDiv({ cls: 'sg-outline-coach-seg', attr: { role: 'radiogroup', 'aria-label': i18n('outline.coach.marksLabel') } });
		const mode = resolveCoachMode(s);
		const modes: Array<[CoachMode, string]> = [
			['off', i18n('outline.coach.mode.off')],
			['revising', i18n('outline.coach.mode.revising')],
			['always', i18n('outline.coach.mode.always')],
		];
		for (const [id, label] of modes) {
			const btn = seg.createEl('button', { cls: 'sg-outline-coach-seg-btn', text: label });
			btn.setAttribute('role', 'radio');
			btn.setAttribute('aria-checked', String(id === mode));
			if (id === mode) btn.addClass('is-active');
			btn.addEventListener('click', () => {
				if (s.mode === id) return;
				s.mode = id;
				save();
			});
		}

		const mdView = this.coachSceneView();
		const file = mdView?.file ?? null;
		this._coachLastPath = file?.path ?? null;
		if (!mdView || !file) {
			const other = this.coachOpenNote();
			root.createDiv({
				cls: 'sg-outline-coach-verdict is-dim',
				text: other ? i18n('outline.coach.verdict.notAScene') : i18n('outline.coach.verdict.noScene'),
			});
			this.renderCoachChecks(root, s, null, save);
			return;
		}

		const text = mdView.editor.getValue();
		if (mode === 'revising' && !this.plugin.coachMarksOn(file, () => text)) {
			root.createDiv({ cls: 'sg-outline-coach-sub', text: i18n('outline.coach.revisingHint') });
		}

		const opts = this.plugin.coachScanOptions(file.path);
		const result = scanCoach(text, opts);
		const total = result.total;
		const pro = result.pro;

		if (!opts.flags.adverbs && !opts.flags.passive && !opts.flags.repetition && !(opts.pro && anyProFlag(opts.pro.flags))) {
			root.createDiv({ cls: 'sg-outline-coach-verdict is-dim', text: i18n('outline.coach.verdict.allOff') });
			this.renderCoachChecks(root, s, file.path, save);
			return;
		}

		// ── One verdict sentence ────────────────────────────────────────────
		const verdict = root.createDiv({ cls: 'sg-outline-coach-verdict' });
		if (total === 0) {
			verdict.addClass('is-good');
			verdict.setText(i18n('outline.coach.verdict.none'));
			const words = tokenizeWords(maskNonProse(text)).length;
			root.createDiv({ cls: 'sg-outline-coach-sub', text: i18n('outline.coach.wordCount', { count: words.toLocaleString() }) });
		} else if (total === 1) verdict.setText(i18n('outline.coach.verdict.one'));
		else if (total === 2) verdict.setText(i18n('outline.coach.verdict.two'));
		else if (total === 3) verdict.setText(i18n('outline.coach.verdict.three'));
		else if (total <= 9) verdict.setText(i18n('outline.coach.verdict.few'));
		else verdict.setText(i18n('outline.coach.verdict.many', { count: String(total) }));

		// ── Folded groups ────────────────────────────────────────────────────
		const isPro = canUse('prose-coach');
		const jumpTo = (offset: number) => {
			const pos = mdView.editor.offsetToPos(offset);
			mdView.editor.setCursor(pos);
			mdView.editor.scrollIntoView({ from: pos, to: pos }, true);
		};
		const acts = (parent: HTMLElement, finding: ProseFinding) => {
			const row = parent.createDiv({ cls: 'sg-outline-coach-acts' });
			const notHere = row.createEl('button', { cls: 'sg-outline-coach-act', text: i18n('coach.notHere') });
			notHere.addEventListener('click', () => { void this.plugin.coachNotHere(file.path, finding); });
			if (NO_NEVER_KINDS.has(finding.kind)) return;
			const never = row.createEl('button', { cls: 'sg-outline-coach-act', text: i18n('coach.never') });
			never.addEventListener('click', () => { void this.plugin.coachNever(finding); });
		};
		const quote = (parent: HTMLElement, ranges: Array<{ from: number; to: number }>, jumpOffset: number) => {
			const q = parent.createEl('blockquote', { cls: 'sg-outline-coach-quote' });
			for (const piece of quoteFor(text, ranges)) {
				if (piece.mark) q.createEl('mark', { text: piece.text });
				else q.appendText(piece.text);
			}
			q.setAttribute('role', 'button');
			q.setAttribute('tabindex', '0');
			q.setAttribute('aria-label', i18n('outline.coach.jumpAria'));
			q.addEventListener('click', () => jumpTo(jumpOffset));
			q.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpTo(jumpOffset); } });
		};
		const group = (kind: string, label: string, count: number | string, renderBody: (b: HTMLElement) => void, why = i18n(COACH_WHY_KEY[kind as ProseFinding['kind']])) => {
			if (count === 0) return;
			const open = this._coachOpen.has(kind);
			const g = root.createDiv({ cls: 'sg-outline-coach-group' });
			const head = g.createEl('button', { cls: 'sg-outline-coach-ghead' });
			head.setAttribute('aria-expanded', String(open));
			head.createSpan({ cls: 'sg-outline-coach-gname', text: label });
			head.createSpan({ cls: 'sg-outline-coach-gcount', text: String(count) });
			setPhosphorIcon(head.createSpan({ cls: 'sg-outline-coach-chev' }), open ? 'caret-up' : 'caret-down', open ? '▴' : '▾');
			head.addEventListener('click', () => {
				if (this._coachOpen.has(kind)) this._coachOpen.delete(kind);
				else this._coachOpen.add(kind);
				void this.renderAll();
			});
			if (!open) return;
			const b = g.createDiv({ cls: 'sg-outline-coach-gbody' });
			b.createDiv({ cls: 'sg-outline-coach-why', text: why });
			renderBody(b);
		};

		group('repetition', i18n('outline.coach.group.repetition'), result.counts.repetition, (b) => {
			for (const g of result.repetitionGroups) {
				const item = b.createDiv({ cls: 'sg-outline-coach-find' });
				const head = item.createDiv({ cls: 'sg-outline-coach-find-head' });
				head.createSpan({ cls: 'sg-outline-coach-word', text: g.word });
				head.createSpan({ cls: 'sg-outline-coach-meta', text: i18n('coach.repeatMeta', { count: String(g.count), window: String(g.window) }) });
				quote(item, g.ranges, g.from);
				acts(item, { kind: 'repetition', from: g.from, to: g.ranges[0].to, text: g.word, word: g.word });
			}
		});

		group('adverb', i18n('outline.coach.group.adverb'), result.counts.adverbs, (b) => {
			for (const f of result.findings.filter((x) => x.kind === 'adverb')) {
				const item = b.createDiv({ cls: 'sg-outline-coach-find' });
				item.createDiv({ cls: 'sg-outline-coach-find-head' }).createSpan({ cls: 'sg-outline-coach-word', text: f.word ?? f.text });
				quote(item, [f], f.from);
				const offer = isPro ? tryOfferAt(text, f) : null;
				if (offer) {
					const tryRow = item.createDiv({ cls: 'sg-outline-coach-try' });
					tryRow.createSpan({ cls: 'sg-outline-coach-try-label', text: i18n('coach.try') });
					const replaced = text.slice(offer.from, offer.to);
					for (const word of offer.suggestions) {
						const chip = tryRow.createEl('button', { cls: 'sg-outline-coach-chip', text: word });
						chip.setAttribute('aria-label', i18n('coach.tryAria', { span: replaced, word }));
						chip.addEventListener('click', () => {
							// The writer's own tap: replace only if the text is still what was offered on.
							const ed = mdView.editor;
							if (ed.getValue().slice(offer.from, offer.to) !== replaced) return;
							ed.replaceRange(matchCase(replaced, word), ed.offsetToPos(offer.from), ed.offsetToPos(offer.to));
						});
					}
				}
				acts(item, f);
			}
		});

		group('passive', i18n('outline.coach.group.passive'), result.counts.passive, (b) => {
			for (const f of result.findings.filter((x) => x.kind === 'passive')) {
				const item = b.createDiv({ cls: 'sg-outline-coach-find' });
				item.createDiv({ cls: 'sg-outline-coach-find-head' }).createSpan({ cls: 'sg-outline-coach-word', text: f.text });
				quote(item, [f], f.from);
				acts(item, f);
			}
		});

		// ── Pro groups (src/prose/pro) — same look as the free ones ─────────
		if (pro) {
			const proFindings = (kind: ProseFinding['kind']) => result.findings.filter((x) => x.kind === kind);
			const simpleItem = (b: HTMLElement, f: ProseFinding) => {
				const item = b.createDiv({ cls: 'sg-outline-coach-find' });
				const head = item.createDiv({ cls: 'sg-outline-coach-find-head' });
				head.createSpan({ cls: 'sg-outline-coach-word', text: findingLabel(f) });
				const hint = suggestionLine(f);
				if (hint) head.createSpan({ cls: 'sg-outline-coach-meta', text: hint });
				quote(item, [f], f.from);
				acts(item, f);
			};

			// Grouped per word: "Tamsyn · 3 times · The Codex spells it: Tamsin".
			const perWord = (kind: ProseFinding['kind'], b: HTMLElement, meta: (list: ProseFinding[]) => string[]) => {
				const byWord = new Map<string, ProseFinding[]>();
				for (const f of proFindings(kind)) {
					const list = byWord.get(f.word ?? f.text) ?? [];
					list.push(f);
					byWord.set(f.word ?? f.text, list);
				}
				for (const [word, list] of byWord) {
					const item = b.createDiv({ cls: 'sg-outline-coach-find' });
					const head = item.createDiv({ cls: 'sg-outline-coach-find-head' });
					head.createSpan({ cls: 'sg-outline-coach-word', text: kind === 'name' ? list[0].text : word });
					for (const m of meta(list)) head.createSpan({ cls: 'sg-outline-coach-meta', text: m });
					const shown = list.slice(0, COACH_QUOTE_MAX);
					quote(item, shown, shown[0].from);
					if (list.length > shown.length) {
						item.createDiv({ cls: 'sg-outline-coach-meta', text: i18n('outline.coach.andMore', { count: String(list.length - shown.length) }) });
					}
					acts(item, list[0]);
				}
			};

			group('name', i18n('outline.coach.group.name'), pro.counts.names, (b) => {
				perWord('name', b, (list) => [
					...(list.length > 1 ? [i18n('coach.crutchMeta', { count: String(list.length) })] : []),
					suggestionLine(list[0]) ?? '',
				]);
			});

			group('wordy', i18n('outline.coach.group.wordy'), pro.counts.wordy, (b) => {
				for (const f of proFindings('wordy')) simpleItem(b, f);
			});

			group('crutch', i18n('outline.coach.group.crutch'), pro.counts.crutch, (b) => {
				// Crutch words grouped per word ("just · 6 times"), then clichés one by one.
				perWord('crutch', b, (list) => [i18n('coach.crutchMeta', { count: String(list.length) })]);
				for (const f of proFindings('cliche')) simpleItem(b, f);
			}, i18n('outline.coach.why.crutchGroup'));

			group('rhythm', i18n('outline.coach.group.rhythm'), pro.counts.rhythm, (b) => {
				for (const f of proFindings('rhythm')) {
					const item = b.createDiv({ cls: 'sg-outline-coach-find' });
					const head = item.createDiv({ cls: 'sg-outline-coach-find-head' });
					head.createSpan({ cls: 'sg-outline-coach-word', text: findingLabel(f) });
					const meta = suggestionLine(f);
					if (meta) head.createSpan({ cls: 'sg-outline-coach-meta', text: meta });
					// The run, sentence by sentence, each with its length — the beat made visible.
					const q = item.createEl('blockquote', { cls: 'sg-outline-coach-quote' });
					for (const part of f.parts ?? []) {
						q.appendText(text.slice(part.from, part.to).replace(/\s+/g, ' ') + ' ');
						q.createSpan({ cls: 'sg-outline-coach-len', text: String(part.words) });
						q.appendText(' ');
					}
					q.setAttribute('role', 'button');
					q.setAttribute('tabindex', '0');
					q.setAttribute('aria-label', i18n('outline.coach.jumpAria'));
					q.addEventListener('click', () => jumpTo(f.from));
					q.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpTo(f.from); } });
					acts(item, f);
				}
			});

			// Dialogue vs narration: a figure for the scene, never marks, never counted in the verdict.
			const pace = pro.pace;
			if (pace && pace.words >= PACE_MIN_WORDS) {
				const talk = percent(pace.dialogue, pace.words);
				group('dialogue', i18n('outline.coach.group.dialogue'), i18n('outline.coach.dialogueBadge', { pct: String(talk) }), (b) => {
					const bar = b.createDiv({ cls: 'sg-outline-coach-pace', attr: { role: 'img', 'aria-label': i18n('outline.coach.dialogueLine', { talk: String(talk), told: String(100 - talk), words: pace.words.toLocaleString() }) } });
					bar.createDiv({ cls: 'sg-outline-coach-pace-talk' }).style.width = `${talk}%`;
					bar.createDiv({ cls: 'sg-outline-coach-pace-told' }).style.width = `${100 - talk}%`;
					b.createDiv({ cls: 'sg-outline-coach-meta', text: i18n('outline.coach.dialogueLine', { talk: String(talk), told: String(100 - talk), words: pace.words.toLocaleString() }) });
				}, i18n('outline.coach.why.dialogue'));
			}
		}

		this.renderCoachChecks(root, s, file.path, save);
	}

	/** The folded "What the coach checks": switches, the "never" list, this scene's hidden findings. */
	private renderCoachChecks(root: HTMLElement, s: ProseCoachSettings, scenePath: string | null, save: () => void): void {
		const open = this._coachOpen.has('checks');
		const fold = root.createEl('button', { cls: 'sg-outline-coach-fold' });
		fold.setAttribute('aria-expanded', String(open));
		fold.createSpan({ text: i18n('outline.coach.checks') });
		setPhosphorIcon(fold.createSpan({ cls: 'sg-outline-coach-chev' }), open ? 'caret-up' : 'caret-down', open ? '▴' : '▾');
		fold.addEventListener('click', () => {
			if (this._coachOpen.has('checks')) this._coachOpen.delete('checks');
			else this._coachOpen.add('checks');
			void this.renderAll();
		});
		if (!open) return;

		const box = root.createDiv({ cls: 'sg-outline-coach-checks' });
		type CheckKey = 'repetition' | 'adverbs' | 'passive' | 'wordy' | 'crutch' | 'names' | 'rhythm' | 'dialogue';
		const flags: Record<CheckKey, boolean> = { ...resolveEngineFlags(s), ...resolveProFlags(s) };
		const checks: Array<[CheckKey, string, string]> = [
			['repetition', i18n('outline.coach.group.repetition'), i18n('outline.coach.check.repetition')],
			['adverbs', i18n('outline.coach.group.adverb'), i18n('outline.coach.check.adverb')],
			['passive', i18n('outline.coach.group.passive'), i18n('outline.coach.check.passive')],
		];
		if (canUse('prose-coach')) {
			checks.push(
				['names', i18n('outline.coach.group.name'), i18n('outline.coach.check.name')],
				['wordy', i18n('outline.coach.group.wordy'), i18n('outline.coach.check.wordy')],
				['crutch', i18n('outline.coach.group.crutch'), i18n('outline.coach.check.crutch')],
				['rhythm', i18n('outline.coach.group.rhythm'), i18n('outline.coach.check.rhythm')],
				['dialogue', i18n('outline.coach.group.dialogue'), i18n('outline.coach.check.dialogue')],
			);
		}
		for (const [key, name, desc] of checks) {
			const row = box.createDiv({ cls: 'sg-outline-coach-check' });
			const toggle = row.createDiv({ cls: 'checkbox-container' });
			toggle.toggleClass('is-enabled', flags[key]);
			toggle.setAttribute('role', 'switch');
			toggle.setAttribute('aria-checked', String(flags[key]));
			toggle.setAttribute('aria-label', name);
			toggle.setAttribute('tabindex', '0');
			const flip = () => {
				s[key] = !flags[key];
				save();
			};
			toggle.addEventListener('click', flip);
			toggle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
			const label = row.createDiv({ cls: 'sg-outline-coach-check-text' });
			label.createDiv({ text: name });
			label.createDiv({ cls: 'sg-outline-coach-check-desc', text: desc });
		}

		const never = s.neverWords ?? [];
		if (never.length > 0) {
			const line = box.createDiv({ cls: 'sg-outline-coach-never' });
			line.createSpan({ cls: 'sg-outline-coach-why', text: i18n('outline.coach.neverList') });
			for (const word of never) {
				const chip = line.createEl('button', { cls: 'sg-outline-coach-chip', text: `${word} ×` });
				chip.setAttribute('aria-label', i18n('outline.coach.neverRemoveAria', { word }));
				chip.addEventListener('click', () => {
					if (removeNeverWord(s, word)) save();
				});
			}
		}

		const keys = scenePath ? (s.dismissed?.[scenePath] ?? []) : [];
		const hidden = new Set(keys.map((k) => k.slice(k.indexOf(':') + 1))).size;
		if (scenePath && hidden > 0) {
			const line = box.createDiv({ cls: 'sg-outline-coach-never' });
			line.createSpan({ cls: 'sg-outline-coach-why', text: i18n('outline.coach.hiddenHere', { count: String(hidden) }) });
			const again = line.createEl('button', { cls: 'sg-outline-coach-act', text: i18n('outline.coach.showAgain') });
			again.addEventListener('click', () => {
				if (s.dismissed) delete s.dismissed[scenePath];
				save();
			});
		}

		// The public release has no Pro to point at yet, so it says nothing about it.
		if (!canUse('prose-coach') && !PUBLIC_BUILD) box.createDiv({ cls: 'sg-outline-coach-why', text: i18n('outline.coach.proLine') });
	}

	// ─── Dashboard tab (goals + todos) ───────────────────────────────────────

	private renderDashboardTab(body: HTMLElement, gridFile: TFile): void {
		// Series mode: progress is scoped to the active book, not the whole series.
		const projectRoot = this.getBookRoot(gridFile);

		// ── Action buttons (dashboard + sprint) ────────────────────────────────
		const btnGroup = body.createDiv({ cls: 'sg-outline-dash-btns' });

		const dashLink = btnGroup.createEl('button', { cls: 'sg-outline-dash-btn' });
		setPhosphorIcon(dashLink.createSpan({ cls: 'sg-outline-tab-icon' }), DASHBOARD_ICON, '◆');
		dashLink.createSpan({ text: i18n('outline.dashboard.openFull') });
		dashLink.setAttribute('aria-label', i18n('outline.dashboard.openFullAria'));
		dashLink.addEventListener('click', () => this.plugin.openDashboard(projectRoot));

		if (!this.plugin.isSprintActive()) {
			const sprintBtn = btnGroup.createEl('button', { cls: 'sg-outline-dash-btn' });
			setPhosphorIcon(sprintBtn.createSpan({ cls: 'sg-outline-tab-icon' }), 'timer', '◆');
			sprintBtn.createSpan({ text: i18n('outline.dashboard.startSprint') });
			sprintBtn.addEventListener('click', (e) => this.plugin.showSprintMenu(e));
		}

		this.renderSprintWidget(body);

		const dash = ensureDashboard(this.plugin.settings);
		const quietSave = () => {
			void this.plugin.saveData(this.plugin.settings);
			void writeProjectMirror(this.app, projectRoot, dash);
		};
		const rerender = () => this.renderAll();

		const now = new Date();
		const today = dayKey(now);
		const history = dash.typedWords[projectRoot] ?? {};

		// Seed default goals on first visit for this project
		if (!dash.goals[projectRoot]) {
			dash.goals[projectRoot] = { daily: 500, weekly: 3500 };
			quietSave();
		}
		const goals = dash.goals[projectRoot];

		// Seed starter todos on first visit for this project (unless onboarding disabled)
		if (!dash.todos[projectRoot]) {
			if (this.plugin.settings.taskOnboarding !== false) {
				const t = (text: string) => ({ id: generateId(), text, done: false, createdAt: new Date().toISOString() });
				dash.todos[projectRoot] = [
					t(i18n('outline.starterTask.openingWords')),
					t(i18n('outline.starterTask.protagonistArcColumn')),
					t(i18n('outline.starterTask.characterSheet')),
					t(i18n('outline.starterTask.storyBeats')),
					t(i18n('outline.starterTask.writingGoals')),
				];
			} else {
				dash.todos[projectRoot] = [];
			}
			quietSave();
		}
		const todos = dash.todos[projectRoot];

		// ── Goal progress bars (read-only — set goals in the Dashboard) ─────────
		const windows = this.plugin.settings.sidebarGoalWindows ?? ['daily', 'weekly'];
		const windowLabels: Record<string, string> = { daily: i18n('outline.period.today'), weekly: i18n('outline.period.thisWeek'), monthly: i18n('outline.period.thisMonth') };
		const windowStart: Record<string, Date> = {
			daily: now,
			weekly: startOfWeek(now),
			monthly: startOfMonth(now),
		};

		if (windows.length > 0) {
			const goalSec = body.createDiv({ cls: 'sg-outline-dash-section', attr: { 'data-sg-goals': '1' } });
			const goalHead = goalSec.createDiv({ cls: 'sg-outline-dash-head' });
			setPhosphorIcon(goalHead.createSpan({ cls: 'sg-outline-tab-icon' }), 'flag', '🎯');
			goalHead.createSpan({ cls: 'sg-outline-dash-title', text: i18n('outline.dashboard.writingGoalsTitle') });

			// Targets come from Settings → Goals first, then any legacy per-project goal
			const wordGoals = this.plugin.settings.wordGoals ?? {};
			for (const win of windows) {
				const done = sumSince(history, windowStart[win], now);
				const target = wordGoals[win as keyof typeof wordGoals] ?? goals[win as keyof typeof goals] ?? 0;
				const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;

				const row = goalSec.createDiv({ cls: 'sg-outline-goal-row' });
				row.createSpan({ cls: 'sg-outline-goal-label', text: windowLabels[win] });
				const nums = row.createSpan({ cls: 'sg-outline-goal-nums' });
				nums.createSpan({ cls: 'sg-outline-goal-done', text: done.toLocaleString() });
				if (target > 0) {
					nums.createSpan({ cls: 'sg-outline-goal-sep', text: '/' });
					nums.createSpan({ cls: 'sg-outline-goal-target', text: target.toLocaleString() });
				}

				const bar = goalSec.createDiv({ cls: 'sg-outline-bar' });
				const fill = bar.createDiv({ cls: 'sg-outline-bar-fill' });
				fill.style.width = `${pct}%`;
				if (target > 0 && done >= target) fill.addClass('is-met');
				if (target > 0) bar.setAttribute('aria-label', i18n('outline.dashboard.goalPercentAria', { pct }));
			}

			// Paste-skip notice
			const skipped = dash.skippedWords?.[projectRoot]?.[today] ?? 0;
			if (skipped > 0) {
				const skip = goalSec.createDiv({ cls: 'sg-outline-paste-skip' });
				skip.createSpan({ text: i18n('outline.dashboard.wordsSkipped', { count: skipped.toLocaleString() }) });
				const btn = skip.createEl('button', { cls: 'sg-outline-paste-btn', text: i18n('outline.dashboard.countThem') });
				btn.addEventListener('click', () => {
					const h = (dash.typedWords[projectRoot] ??= {});
					h[today] = (h[today] ?? 0) + skipped;
					if (dash.skippedWords?.[projectRoot]) delete dash.skippedWords[projectRoot][today];
					quietSave();
					rerender();
				});
			}
		}

		// ── To-do list ─────────────────────────────────────────────────────────
		const todoSec = body.createDiv({ cls: 'sg-outline-dash-section' });
		this._taskList.render({
			container: todoSec,
			todos,
			save: () => {
				quietSave();
				document.dispatchEvent(new CustomEvent('storygrid:tasks-changed', { detail: 'outline' }));
			},
			rerender,
			compact: true,
			app: this.app,
			maxOpen: this.plugin.settings.taskSidebarMaxOpen ?? 5,
			sortByUrgency: this.plugin.settings.taskDefaultSort !== 'manual',
			showCompleted: this.plugin.settings.taskShowCompleted !== false,
			subtaskRollup: this.plugin.settings.taskSubtaskRollup !== false,
			onSwitchToManualSort: () => {
				this.plugin.settings.taskDefaultSort = 'manual';
				void this.plugin.saveSettings();
			},
		});

	}

	// ─── World tab (Codex entities, minus scenes) ──────────────────────────────

	private renderWorldTab(body: HTMLElement, gridFile: TFile): void {
		// Series mode: world tab queries the series root (shared entities).
		// Standalone: queries the project root as before.
		const projectRoot = this.getWorldRoot(gridFile);

		if (this._worldPreviewRoot !== projectRoot) {
			this._worldPreviewStack = [];
			this._worldPreviewRoot = projectRoot;
		}
		const previewPath = this._worldPreviewStack[this._worldPreviewStack.length - 1];
		if (previewPath) {
			const previewFile = this.app.vault.getAbstractFileByPath(previewPath);
			if (previewFile instanceof TFile) {
				void this.renderWorldPreview(body, projectRoot, previewFile);
				return;
			}
			// The file vanished (deleted/renamed elsewhere) — drop it and fall through to the list.
			this._worldPreviewStack.pop();
		}

		// Codex link at the top, above the entity categories
		const codexLink = body.createDiv({ cls: 'sg-outline-codex-link sg-outline-codex-link--top' });
		codexLink.setAttribute('role', 'button');
		codexLink.setAttribute('tabindex', '0');
		const codexIcon = codexLink.createSpan({ cls: 'sg-outline-tab-icon' });
		setPhosphorIcon(codexIcon, CODEX_ICON, '◆');
		codexLink.createSpan({ text: i18n('outline.world.openCodex') });
		codexLink.setAttribute('aria-label', i18n('outline.world.openCodexAria'));
		codexLink.addEventListener('click', () => this.plugin.openCodex(projectRoot));
		codexLink.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') this.plugin.openCodex(projectRoot); });

const list = body.createDiv({ cls: 'sg-outline-list' });
		const activePath = this.app.workspace.getActiveFile()?.path ?? null;

		// Nine main categories (same grouping as the full Codex sidebar) so the
		// tab opens as a short, scannable list instead of ~30 flat headings —
		// each one folds out to its member kinds on click.
		for (const group of worldGroups()) {
			const kindsInGroup = group.kinds.map((kind) => ({
				kind,
				spec: getKindSpec(kind),
				entities: this.plugin.entityIndex.list(projectRoot, kind),
			}));
			const groupTotal = kindsInGroup.reduce((sum, k) => sum + k.entities.length, 0);

			const groupCollapseKey = `world-group::${projectRoot}::${group.id}`;
			// Empty categories start folded, same rule as the kind level below —
			// an explicit user toggle (stored true OR false) always wins.
			const storedGroup = this.plugin.settings.outlineCollapsedGroups?.[groupCollapseKey];
			const isGroupCollapsed = storedGroup !== undefined ? storedGroup : groupTotal === 0;

			const groupHead = list.createDiv({ cls: 'sg-outline-act sg-outline-world-group-head' + (isGroupCollapsed ? ' is-collapsed' : '') });
			groupHead.setAttribute('role', 'button');
			groupHead.setAttribute('tabindex', '0');
			groupHead.setAttribute('aria-expanded', String(!isGroupCollapsed));
			groupHead.setAttribute('title', group.info);

			const groupChev = groupHead.createSpan({ cls: 'sg-outline-act-chevron' });
			setPhosphorIcon(groupChev, 'caret-down', '▾');
			const groupIcon = groupHead.createSpan({ cls: 'sg-outline-tab-icon' });
			setPhosphorIcon(groupIcon, group.icon, group.fallbackIcon);
			groupHead.createSpan({ cls: 'sg-outline-act-label', text: group.label });
			groupHead.createSpan({ cls: 'sg-outline-world-count', text: String(groupTotal) });

			const toggleGroupCollapse = () => {
				const map = (this.plugin.settings.outlineCollapsedGroups ??= {});
				map[groupCollapseKey] = !isGroupCollapsed;
				void this.plugin.saveData(this.plugin.settings);
				void this.renderAll();
			};
			groupHead.addEventListener('click', () => toggleGroupCollapse());
			groupHead.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroupCollapse(); }
			});

			if (isGroupCollapsed) continue;

			const groupBody = list.createDiv({ cls: 'sg-outline-world-group-body' });

			for (const { kind, spec, entities } of kindsInGroup) {
				const collapseKey = `world::${projectRoot}::${kind}`;
				// Empty categories start folded so the panel isn't a wall of empty
				// headings — an explicit user toggle (stored true OR false) wins.
				const stored = this.plugin.settings.outlineCollapsedGroups?.[collapseKey];
				const isCollapsed = stored !== undefined ? stored : entities.length === 0;

				const head = groupBody.createDiv({ cls: 'sg-outline-act sg-outline-world-head' + (isCollapsed ? ' is-collapsed' : '') });
				head.setAttribute('role', 'button');
				head.setAttribute('tabindex', '0');
				head.setAttribute('aria-expanded', String(!isCollapsed));

				const chev = head.createSpan({ cls: 'sg-outline-act-chevron' });
				setPhosphorIcon(chev, 'caret-down', '▾');
				const ic = head.createSpan({ cls: 'sg-outline-tab-icon' });
				setPhosphorIcon(ic, spec.icon, spec.fallbackIcon);
				head.createSpan({ cls: 'sg-outline-act-label', text: spec.plural });
				head.createSpan({ cls: 'sg-outline-world-count', text: String(entities.length) });

				const addBtn = head.createEl('button', { cls: 'sg-outline-scene-linkbtn' });
				setPhosphorIcon(addBtn, 'plus', '+');
				addBtn.setAttribute('aria-label', i18n('outline.world.newEntityAria', { kind: spec.singular.toLowerCase() }));
				addBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.createEntity(projectRoot, kind);
				});

				const toggleCollapse = () => {
					const map = (this.plugin.settings.outlineCollapsedGroups ??= {});
					// Explicit boolean (never delete) — an empty category defaults to
					// collapsed, so "expanded" must be remembered as false.
					map[collapseKey] = !isCollapsed;
					void this.plugin.saveData(this.plugin.settings);
					void this.renderAll();
				};
				head.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).closest('.sg-outline-scene-linkbtn')) return;
					toggleCollapse();
				});
				head.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse(); }
				});

				if (isCollapsed) continue;

				for (const entity of entities) {
					const item = groupBody.createDiv({ cls: 'sg-outline-scene sg-outline-world-entity' });
					item.setAttribute('role', 'button');
					item.setAttribute('tabindex', '0');
					if (entity.file.path === activePath) item.addClass('is-active');
					const iconSpan = item.createSpan({ cls: 'sg-outline-world-entity-icon' });
					setPhosphorIcon(iconSpan, spec.icon, spec.fallbackIcon);
					item.createSpan({ cls: 'sg-outline-scene-title', text: entity.name });
					// Preview in-panel — never opens the main window. The "Open in Codex"
					// context-menu item below (and the ✎ button on the card itself) remain
					// the deliberate escape hatch to the full editable Codex.
					const openEntity = () => {
						this._worldPreviewStack.push(entity.file.path);
						void this.renderAll();
					};
					item.addEventListener('click', openEntity);
					item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openEntity(); });
					item.addEventListener('contextmenu', (e) => {
						e.preventDefault();
						const menu = new Menu();
						menu.addItem((i) =>
							i.setTitle(i18n('outline.world.menuOpenInCodex')).setIcon('library')
								.onClick(() => this.plugin.openCodex(projectRoot, entity.file.path))
						);
						menu.addItem((i) =>
							i.setTitle(i18n('outline.world.menuOpenAsNote')).setIcon('file-text')
								.onClick(() => openOrReveal(this.app, entity.file))
						);
						menu.addSeparator();
						menu.addItem((i) =>
							i.setTitle(i18n('common.delete')).setIcon('trash')
								.onClick(() => {
									new ConfirmModal(
										this.app,
										i18n('outline.world.deleteEntityConfirm', { name: entity.name }),
										i18n('common.delete'),
										async () => {
											await this.app.fileManager.trashFile(entity.file);
											new Notice(i18n('outline.notice.deletedFile', { name: entity.name }));
										}
									).open();
								})
						);
						menu.showAtMouseEvent(e);
					});
				}
			}
		}

	}

	/** Read-only entity card rendered in-panel — see src/ui/entity-preview.ts. */
	private async renderWorldPreview(body: HTMLElement, projectRoot: string, file: TFile): Promise<void> {
		const host = body.createDiv({ cls: 'sg-outline-preview-host' });
		await renderEntityPreview(host, {
			app: this.app,
			component: this,
			file,
			projectRoot,
			// "‹ Codex" always jumps straight to the entity list, no matter how many
			// in-card wikilinks were followed to get here — no breadcrumb trail.
			onBack: () => { this._worldPreviewStack = []; void this.renderAll(); },
			onNavigate: (path) => { this._worldPreviewStack.push(path); void this.renderAll(); },
			onEdit: () => void this.plugin.openCodex(projectRoot, file.path),
			resolveEntity: (linktext) => {
				const dest = this.app.metadataCache.getFirstLinkpathDest(linktext, file.path);
				if (!dest) return null;
				const fm = this.app.metadataCache.getFileCache(dest)?.frontmatter;
				return fm?.['storygrid-type'] ? dest.path : null;
			},
		});
	}

	private createEntity(projectRoot: string, kind: EntityKind): void {
		new EntityModal(this.app, kind, '', [], async (name, fields, aliases, start) => {
			try {
				const file = await createEntityFile(this.app, projectRoot, kind, name, fields, aliases, start?.cleanSlate);
				new Notice(i18n('outline.notice.entityCreated', { kind: getKindSpec(kind).singular, name: file.basename }));
				await this.plugin.openCodex(projectRoot, file.path);
				return file;
			} catch (err) {
				new Notice(i18n('outline.notice.entityCreateError', { kind, error: err instanceof Error ? err.message : '' }));
			}
		}, { projectRoot }).open();
	}

	// ─── Compile tab ───────────────────────────────────────────────────────────

	/** Faded preview of the scene checklist, shown when the outline has no scenes yet. */
	private renderGhostManuscriptOutline(body: HTMLElement): void {
		const wrap = body.createDiv({ cls: 'sg-outline-compile-ghost-wrap' });

		const summary = wrap.createDiv({ cls: 'sg-outline-compile-summary sg-ghost' });
		summary.createDiv({ cls: 'sg-outline-compile-total', text: i18n('outline.compile.ghostTotal') });
		const ghostRows: Array<[string, string, string]> = [
			[i18n('outline.compile.ghostGroupActOne'), i18n('outline.compile.ghostScene1'), i18n('outline.compile.ghostWords1')],
			[i18n('outline.compile.ghostGroupActOne'), i18n('outline.compile.ghostScene2'), i18n('outline.compile.ghostWords2')],
			[i18n('outline.compile.ghostGroupActTwo'), i18n('outline.compile.ghostScene3'), i18n('outline.compile.ghostWords3')],
		];
		let lastGroup: string | null = null;
		for (const [group, title, words] of ghostRows) {
			if (group !== lastGroup) {
				summary.createDiv({ cls: 'sg-outline-compile-group', text: group });
				lastGroup = group;
			}
			const row = summary.createDiv({ cls: 'sg-outline-compile-row' });
			row.createSpan({ cls: 'sg-outline-scene-title', text: title });
			row.createSpan({ cls: 'sg-outline-scene-words', text: words });
		}

		wrap.createEl('p', {
			cls: 'sg-outline-compile-ghost-note',
			text: i18n('outline.compile.ghostNote'),
		});
	}

	private async renderCompileTab(body: HTMLElement, gridFile: TFile, grid: GridData): Promise<void> {
		const gen = this._renderGen;
		const projectRoot = projectRootFromGridPath(gridFile.path) ?? '';

		// Compile is a drill-in panel (no tab) — give it a header with a way back
		const backRow = body.createDiv({ cls: 'sg-outline-compile-backrow' });
		const backBtn = backRow.createEl('button', { cls: 'sg-outline-compile-back', text: i18n('outline.compile.backButton') });
		backBtn.setAttribute('aria-label', i18n('outline.compile.backButtonAria'));
		backBtn.addEventListener('click', () => {
			this.activeTab = 'writing';
			void this.renderAll();
		});
		backRow.createSpan({ cls: 'sg-outline-compile-heading', text: i18n('outline.compile.heading') });

		// The manuscript order IS the Writing-tab outline tree — same resolution
		// path, so compile can never drift from what the writer arranged.
		const docs = this.sceneDocsFor(gridFile);
		const dash = ensureDashboard(this.plugin.settings);
		const tree = resolveSceneTree(dash.sceneTree?.[projectRoot], dash.sceneOrder?.[projectRoot], docs.map((d) => d.path));
		const excluded = this.excludedFor(gridFile.path);
		const items = await gatherManuscript(this.app, tree);
		if (gen !== this._renderGen) return;

		// Named workflows (Longform-style — writers keep several side by side).
		const workflows = (this.plugin.settings.compileWorkflows ??= []);
		if (workflows.length === 0) workflows.push(WORKFLOW_PRESETS[0].build());
		const compileState = this.compileStateFor(gridFile.path);
		let wf = workflows.find((w) => w.id === compileState.workflowId) ?? workflows[0];
		compileState.workflowId = wf.id;

		// saveSettings() broadcasts a refresh that would rebuild this tab and
		// kick the cursor out of a field mid-typing — text fields save quietly.
		const saveQuiet = () => this.debouncedSaveQuiet();
		const saveAndRerender = async () => {
			await this.plugin.saveData(this.plugin.settings);
			await this.renderAll();
		};

		// ── Workflow picker + actions menu ────────────────────────────────────
		const wfRow = body.createDiv({ cls: 'sg-outline-opt sg-outline-compile-name' });
		wfRow.createSpan({ text: i18n('outline.compile.workflowLabel') });
		const wfSel = wfRow.createEl('select', { cls: 'sg-outline-grid-select sg-outline-format-select' });
		wfSel.setAttribute('aria-label', i18n('outline.compile.workflowSelectAria'));
		for (const w of workflows) {
			const opt = wfSel.createEl('option', { text: w.name });
			opt.value = w.id;
			if (w.id === wf.id) opt.selected = true;
		}
		wfSel.addEventListener('change', async () => {
			compileState.workflowId = wfSel.value;
			await saveAndRerender();
		});
		const wfMenuBtn = wfRow.createEl('button', { cls: 'sg-outline-scene-linkbtn', attr: { 'aria-label': i18n('outline.compile.workflowActionsAria') } });
		setPhosphorIcon(wfMenuBtn, 'dots-three', '⋯');
		wfMenuBtn.addEventListener('click', (e) => {
			const menu = new Menu();
			menu.addItem((it) =>
				it.setTitle(i18n('outline.compile.newFromPreset')).setIcon('plus').onClick(() => {
					const pm = new Menu();
					for (const preset of WORKFLOW_PRESETS) {
						pm.addItem((p) =>
							p.setTitle(preset.name).onClick(async () => {
								const created = preset.build();
								workflows.push(created);
								compileState.workflowId = created.id;
								await saveAndRerender();
							})
						);
					}
					pm.showAtMouseEvent(e);
				})
			);
			menu.addItem((it) =>
				it.setTitle(i18n('outline.compile.duplicate')).setIcon('copy').onClick(async () => {
					const copy: CompileWorkflowSettings = { ...wf, id: generateId(), name: i18n('outline.compile.duplicateName', { name: wf.name }), steps: wf.steps.map((s) => ({ ...s, options: { ...s.options } })) };
					workflows.push(copy);
					compileState.workflowId = copy.id;
					await saveAndRerender();
				})
			);
			menu.addItem((it) =>
				it.setTitle(i18n('outline.menu.rename')).setIcon('pencil').onClick(() => {
					new TextPromptModal(this.app, i18n('outline.compile.renameWorkflowTitle'), wf.name, async (name) => {
						if (name.trim()) { wf.name = name.trim(); await saveAndRerender(); }
					}).open();
				})
			);
			menu.addSeparator();
			menu.addItem((it) =>
				it.setTitle(i18n('common.delete')).setIcon('trash').setDisabled(workflows.length <= 1).onClick(async () => {
					const i = workflows.indexOf(wf);
					if (i !== -1 && workflows.length > 1) {
						workflows.splice(i, 1);
						compileState.workflowId = workflows[0].id;
						await saveAndRerender();
					}
				})
			);
			menu.showAtMouseEvent(e);
		});

		// ── Output format ─────────────────────────────────────────────────────
		const fmtRow = body.createDiv({ cls: 'sg-outline-opt sg-outline-compile-name' });
		fmtRow.createSpan({ text: i18n('outline.compile.exportAsLabel') });
		const fmtSel = fmtRow.createEl('select', { cls: 'sg-outline-grid-select sg-outline-format-select' });
		fmtSel.setAttribute('aria-label', i18n('outline.compile.outputFormatAria'));
		const FORMATS: Array<[CompileOutputFormat, string]> = [
			['md', i18n('outline.compile.formatMd')],
			['docx', i18n('outline.compile.formatDocx')],
			['fountain', i18n('outline.compile.formatFountain')],
			['epub', i18n('outline.compile.formatEpub')],
		];
		for (const [id, label] of FORMATS) {
			const opt = fmtSel.createEl('option', { text: label });
			opt.value = id;
			if (wf.output === id) opt.selected = true;
		}
		fmtSel.addEventListener('change', async () => {
			wf.output = fmtSel.value as CompileOutputFormat;
			await saveAndRerender();
		});

		// ── Save-as name ──────────────────────────────────────────────────────
		const ext = OUTPUT_FORMAT_EXT[wf.output];
		const nameRow = body.createDiv({ cls: 'sg-outline-opt sg-outline-compile-name' });
		nameRow.createSpan({ text: i18n('outline.compile.saveAsLabel') });
		const nameInput = nameRow.createEl('input', { cls: 'sg-outline-name-input', type: 'text' });
		nameInput.setAttribute('aria-label', i18n('outline.compile.manuscriptNameAria'));
		nameInput.value = compileState.manuscriptName ?? defaultManuscriptName(grid.name);
		nameInput.addEventListener('input', () => {
			compileState.manuscriptName = nameInput.value;
			saveQuiet();
		});
		nameRow.createSpan({ cls: 'sg-outline-name-ext', text: ext });

		// ── Format-specific options ───────────────────────────────────────────
		if (wf.output === 'epub') {
			const coverRow = body.createDiv({ cls: 'sg-outline-opt sg-outline-compile-name' });
			coverRow.createSpan({ text: i18n('outline.compile.coverLabel') });
			const coverBtn = coverRow.createEl('button', { cls: 'sg-outline-grid-select sg-outline-cover-btn' });
			const coverName = () => {
				const p = compileState.coverImagePath;
				return p ? (p.split('/').pop() ?? p) : i18n('outline.compile.chooseImage');
			};
			coverBtn.setText(coverName());
			coverBtn.addEventListener('click', () => {
				new ImagePickerModal(this.app, (file) => {
					compileState.coverImagePath = file.path;
					saveQuiet();
					coverBtn.setText(coverName());
					coverClear.setCssStyles({ display: '' });
				}).open();
			});
			const coverClear = coverRow.createEl('button', { cls: 'sg-outline-scene-linkbtn', attr: { 'aria-label': i18n('outline.compile.removeCoverAria') } });
			setPhosphorIcon(coverClear, 'x', '×');
			coverClear.style.display = compileState.coverImagePath ? '' : 'none';
			coverClear.addEventListener('click', () => {
				delete compileState.coverImagePath;
				saveQuiet();
				coverBtn.setText(coverName());
				coverClear.setCssStyles({ display: 'none' });
			});
		}

		// ── Formatting options — collapsed by default so the tab stays calm ────
		const fmtToggle = body.createDiv({ cls: 'sg-outline-compile-group sg-outline-fmt-toggle' });
		fmtToggle.setAttribute('role', 'button');
		fmtToggle.setAttribute('tabindex', '0');
		fmtToggle.setAttribute('aria-expanded', String(this._compileOptsOpen));
		fmtToggle.setText(`${this._compileOptsOpen ? '▾' : '▸'} ${i18n('outline.compile.formattingOptions')}`);
		const toggleFmt = () => {
			this._compileOptsOpen = !this._compileOptsOpen;
			void this.renderAll();
		};
		fmtToggle.addEventListener('click', toggleFmt);
		fmtToggle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFmt(); } });

		const fmtGroup = body.createDiv({ cls: 'sg-outline-fmt-group' });
		if (!this._compileOptsOpen) fmtGroup.setCssStyles({ display: 'none' });

		// Title page details (author and contact persist with the workflow)
		if (wf.titlePage !== 'none') {
			const authorRow = fmtGroup.createDiv({ cls: 'sg-outline-opt sg-outline-compile-name' });
			authorRow.createSpan({ text: i18n('outline.compile.authorLabel') });
			const authorInput = authorRow.createEl('input', { cls: 'sg-outline-name-input', type: 'text' });
			authorInput.placeholder = i18n('outline.compile.authorPlaceholder');
			authorInput.value = wf.author;
			authorInput.addEventListener('input', () => { wf.author = authorInput.value; saveQuiet(); });

			const contactRow = fmtGroup.createDiv({ cls: 'sg-outline-opt sg-outline-compile-contact' });
			contactRow.createSpan({ text: i18n('outline.compile.contactLabel') });
			const contactInput = contactRow.createEl('textarea', { cls: 'sg-outline-contact-input' });
			contactInput.rows = 2;
			contactInput.placeholder = i18n('outline.compile.contactPlaceholder');
			contactInput.value = wf.contact;
			contactInput.addEventListener('input', () => { wf.contact = contactInput.value; saveQuiet(); });
		}

		const opts = fmtGroup.createDiv({ cls: 'sg-outline-compile-opts' });
		const mkToggle = (label: string, value: boolean, onChange: (v: boolean) => void) => {
			const row = opts.createEl('label', { cls: 'sg-outline-opt' });
			const cb = row.createEl('input', { type: 'checkbox' });
			cb.checked = value;
			row.createSpan({ text: label });
			cb.addEventListener('change', () => onChange(cb.checked));
		};
		mkToggle(i18n('outline.compile.optSectionHeadings'), wf.includeHeadings, (v) => { wf.includeHeadings = v; saveQuiet(); });
		if (wf.output === 'fountain') {
			mkToggle(i18n('outline.compile.optActMarkers'), wf.actMarkers ?? false, (v) => { wf.actMarkers = v; saveQuiet(); });
		}
		if (wf.output === 'docx') {
			mkToggle(i18n('outline.compile.optUnderlineItalics'), wf.underlineItalics ?? false, (v) => { wf.underlineItalics = v; saveQuiet(); });
		}

		if (wf.output !== 'fountain' && wf.output !== 'docx') {
			const sepRow = opts.createDiv({ cls: 'sg-outline-opt' });
			sepRow.createSpan({ text: i18n('outline.compile.sceneSeparatorLabel') });
			const sepInput = sepRow.createEl('input', { cls: 'sg-outline-sep-input', type: 'text' });
			sepInput.value = wf.sceneSeparator;
			sepInput.addEventListener('input', () => { wf.sceneSeparator = sepInput.value; saveQuiet(); });
		}

		const endRow = opts.createDiv({ cls: 'sg-outline-opt' });
		endRow.createSpan({ text: i18n('outline.compile.endingMarkLabel') });
		const endInput = endRow.createEl('input', { cls: 'sg-outline-sep-input', type: 'text' });
		endInput.placeholder = i18n('outline.compile.endingMarkPlaceholder');
		endInput.value = wf.endMark;
		endInput.addEventListener('input', () => { wf.endMark = endInput.value; saveQuiet(); });

		// ── Steps — grouped by pipeline stage ─────────────────────────────────
		this.renderStepGroup(fmtGroup, wf, 'scene', i18n('outline.compile.stepGroupPerScene'), saveQuiet, saveAndRerender);
		this.renderStepGroup(fmtGroup, wf, 'manuscript', i18n('outline.compile.stepGroupWholeManuscript'), saveQuiet, saveAndRerender);

		// No scenes yet — a ghost outline plus the one thing that populates it.
		if (!items.some((i) => i.kind === 'scene')) {
			this.renderGhostManuscriptOutline(body);
			return;
		}

		// ── Scene checklist (from the tree, grouped under divider headings) ────
		const summary = body.createDiv({ cls: 'sg-outline-compile-summary' });
		const totalEl = summary.createDiv({ cls: 'sg-outline-compile-total' });
		const sceneWords = new Map<string, number>();
		for (const it of items) {
			if (it.kind === 'scene') {
				sceneWords.set(it.docPath, countWords(applyCompileSteps(it.text, wf.steps, { stage: 'scene', title: it.title, number: it.number, depth: it.depth })));
			}
		}
		const sceneItems = items.filter((i): i is Extract<ManuscriptItem, { kind: 'scene' }> => i.kind === 'scene');
		const updateTotal = () => {
			const inc = sceneItems.filter((s) => !excluded.has(s.docPath));
			const words = inc.reduce((sum, s) => sum + (sceneWords.get(s.docPath) ?? 0), 0);
			totalEl.setText(i18n('outline.compile.totalSummary', { included: inc.length, total: sceneItems.length, words: words.toLocaleString() }));
		};
		updateTotal();

		for (const it of items) {
			if (it.kind === 'heading') {
				if (it.label.trim()) {
					const g = summary.createDiv({ cls: 'sg-outline-compile-group', text: `${it.number}. ${it.label.trim()}` });
					g.style.paddingLeft = `${it.depth * 12}px`;
				}
				continue;
			}
			const row = summary.createEl('label', { cls: 'sg-outline-compile-row' });
			row.style.paddingLeft = `${it.depth * 12}px`;
			const cb = row.createEl('input', { type: 'checkbox' });
			cb.checked = !excluded.has(it.docPath);
			cb.addEventListener('change', () => {
				if (cb.checked) excluded.delete(it.docPath);
				else excluded.add(it.docPath);
				this.saveExcluded(gridFile.path, excluded);
				updateTotal();
			});
			row.createSpan({ cls: 'sg-outline-scene-num', text: `${it.number}.` });
			row.createSpan({ cls: 'sg-outline-scene-title', text: it.title.trim() || i18n('outline.compile.untitled') });
			row.createSpan({ cls: 'sg-outline-scene-words', text: i18n('outline.writing.wordCountSuffix', { count: (sceneWords.get(it.docPath) ?? 0).toLocaleString() }) });
		}

		// ── Actions ───────────────────────────────────────────────────────────
		const actions = body.createDiv({ cls: 'sg-outline-compile-actions' });
		const author = wf.author?.trim() || this.plugin.settings.authorName || '';
		const includedItems = (): ManuscriptItem[] => items.filter((i) => i.kind === 'heading' || !excluded.has(i.docPath));
		const baseOpts = (): ManuscriptOptions => ({ ...workflowOptions(wf), author });
		const fileBaseName = () => (nameInput.value.trim() || defaultManuscriptName(grid.name)).replace(/\.(md|fountain|docx|epub)$/i, '');

		// Build the export payload for the current output format.
		const buildPayload = async (): Promise<string | Uint8Array | null> => {
			const inc = includedItems();
			if (wf.output === 'docx') {
				const docxOpts: DocxOptions = { ...baseOpts(), underlineItalics: wf.underlineItalics };
				return buildDocx(grid.name, inc, docxOpts, author);
			}
			if (wf.output === 'fountain') {
				const fOpts: FountainOptions = { ...baseOpts(), actMarkers: wf.actMarkers };
				return assembleFountain(grid.name, inc, fOpts);
			}
			if (wf.output === 'epub') {
				return buildEpubBytes(this.app, grid.name, author, inc, baseOpts(), compileState.coverImagePath);
			}
			const coverBlock = compileState.coverImagePath ? `![[${compileState.coverImagePath}]]\n\n` : '';
			return coverBlock + assembleManuscript(grid.name, inc, baseOpts());
		};

		const milestone = () => this.plugin.celebrateMilestone('first-compile', i18n('outline.compile.firstExportMilestone'));

		// Save to the computer via the native "Save As" dialog (or vault on mobile).
		const exportToComputer = async () => {
			const data = await buildPayload();
			if (data == null) { new Notice(i18n('outline.notice.nothingToExport')); return; }
			await snapshotCompiledScenes(this.app, includedItems());
			await saveExport(this.app, {
				data,
				suggestedName: `${fileBaseName()}${ext}`,
				formatLabel: OUTPUT_FORMAT_LABELS[wf.output],
				extension: wf.output,
				vaultFallbackPath: manuscriptPathFor(gridFile.path, grid.name, ext, nameInput.value),
			});
			milestone();
		};

		// Save a Markdown manuscript into the vault (opens in Obsidian afterwards).
		const exportToVault = async () => {
			await snapshotCompiledScenes(this.app, includedItems());
			await writeManuscript(this.app, gridFile.path, grid.name, includedItems(), baseOpts(), nameInput.value, compileState.coverImagePath);
			milestone();
		};

		// The primary action. Markdown offers vault-or-computer; everything else
		// is a computer file, so it goes straight to the Save dialog.
		const doExport = (e: MouseEvent) => {
			if (wf.output === 'md' && !Platform.isMobile) {
				const menu = new Menu();
				menu.addItem((i) => i.setTitle(i18n('outline.compile.saveInVault')).setIcon('vault').onClick(() => void exportToVault()));
				menu.addItem((i) => i.setTitle(i18n('outline.compile.saveToComputer')).setIcon('download').onClick(() => void exportToComputer()));
				menu.showAtMouseEvent(e);
			} else if (wf.output === 'md') {
				void exportToVault(); // mobile: no native dialog, keep it in the vault
			} else {
				void exportToComputer();
			}
		};

		const exportLabel = wf.output === 'md' ? i18n('outline.compile.exportEllipsis') : i18n('outline.compile.exportFormat', { ext });
		const exportBtn = actions.createEl('button', { cls: 'sg-outline-btn sg-outline-btn--primary', text: exportLabel });
		exportBtn.addEventListener('click', (e) => doExport(e));

		const previewBtn = actions.createEl('button', { cls: 'sg-outline-btn', text: i18n('outline.compile.previewButton') });
		previewBtn.addEventListener('click', () => {
			new CompilePreviewModal(
				this.app,
				grid.name,
				includedItems(),
				baseOpts(),
				() => (wf.output === 'md' ? void exportToVault() : void exportToComputer()),
				exportLabel.replace(/…$/, '')
			).open();
		});

		// Quick reopen of a Markdown manuscript that was saved into the vault.
		if (wf.output === 'md') {
			const manuscript = this.app.vault.getAbstractFileByPath(manuscriptPathFor(gridFile.path, grid.name, ext, nameInput.value));
			if (manuscript instanceof TFile) {
				const openBtn = actions.createEl('button', { cls: 'sg-outline-btn', text: i18n('outline.compile.openLastExport') });
				openBtn.addEventListener('click', () => openOrReveal(this.app, manuscript));
			}
		}
	}

	/** Render one pipeline-stage's step list with per-step options and an add menu. */
	private renderStepGroup(
		host: HTMLElement,
		wf: CompileWorkflowSettings,
		stage: CompileStepStage,
		label: string,
		saveQuiet: () => void,
		saveAndRerender: () => Promise<void>
	): void {
		const stageSteps = wf.steps.filter((s) => (s.stage ?? 'scene') === stage);
		host.createDiv({ cls: 'sg-outline-compile-group sg-outline-rules-head', text: label });
		const rules = host.createDiv({ cls: 'sg-outline-rules' });

		for (const step of stageSteps) {
			const spec = getStepSpec(step.id);
			const rule = rules.createDiv({ cls: 'sg-outline-rule' });
			if (spec) rule.title = spec.description;

			const top = rule.createDiv({ cls: 'sg-outline-rule-top' });
			top.createSpan({ cls: 'sg-outline-rule-name', text: spec?.name ?? step.id });
			const rm = top.createEl('button', { cls: 'sg-outline-scene-linkbtn sg-outline-rule-remove', attr: { 'aria-label': i18n('outline.compile.removeStepAria') } });
			setPhosphorIcon(rm, 'x', '×');
			rm.addEventListener('click', async () => {
				wf.steps.splice(wf.steps.indexOf(step), 1);
				await saveAndRerender();
			});

			for (const opt of spec?.options ?? []) {
				if (opt.type === 'text' || opt.type === 'multiline') {
					const lab = rule.createEl('label', { cls: 'sg-outline-rule-opt sg-outline-rule-opt--text' });
					lab.createSpan({ text: opt.label });
					const input =
						opt.type === 'multiline'
							? lab.createEl('textarea', { cls: 'sg-outline-contact-input' })
							: lab.createEl('input', { cls: 'sg-outline-sep-input', type: 'text' });
					input.value = typeof step.options[opt.key] === 'string' ? (step.options[opt.key] as string) : String(opt.default);
					input.addEventListener('input', () => { step.options[opt.key] = input.value; saveQuiet(); });
				} else {
					const lab = rule.createEl('label', { cls: 'sg-outline-rule-opt' });
					const cb = lab.createEl('input', { type: 'checkbox' });
					cb.checked = step.options[opt.key] !== false;
					lab.createSpan({ text: opt.label });
					cb.addEventListener('change', () => { step.options[opt.key] = cb.checked; saveQuiet(); });
				}
			}
		}
		if (stageSteps.length === 0) {
			rules.createDiv({ cls: 'sg-outline-scene sg-outline-scene--empty', text: i18n('outline.compile.noSteps') });
		}

		const addBtn = host.createEl('button', { cls: 'sg-outline-btn sg-outline-add-rule', text: i18n('outline.compile.addStep') });
		addBtn.addEventListener('click', (e) => {
			const remaining = COMPILE_STEP_SPECS.filter((s) => s.stages.includes(stage) && !wf.steps.some((st) => st.id === s.id && (st.stage ?? 'scene') === stage));
			const menu = new Menu();
			if (remaining.length === 0) menu.addItem((it) => it.setTitle(i18n('outline.compile.noMoreSteps')).setDisabled(true));
			for (const s of remaining) {
				menu.addItem((it) =>
					it.setTitle(s.name).onClick(async () => {
						wf.steps.push(defaultStepConfig(s.id, stage));
						await saveAndRerender();
					})
				);
			}
			menu.showAtMouseEvent(e);
		});
	}
}

