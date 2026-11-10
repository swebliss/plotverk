import { plotverkEvents } from './utils/plotverk-events';
import { ItemView, WorkspaceLeaf, Platform, ViewStateResult, TAbstractFile, TFile } from 'obsidian';
import type StorygridPlugin from './main';
import { onSettingsChanged, runCommandById } from './utils/obsidian-internals';
import { setPhosphorIcon } from './utils/icons';
import { t } from './i18n';
import { TaskListController } from './ui/task-list';
import type { ModuleId } from './modules';
import { runSafely } from './utils/report-error';
import { showCoachMark } from './ui/coach-mark';
import { isFamilyLabel } from './utils/relation-mirror';
import {
	GridData,
	SceneCard,
	StorygridSettings,
	DashboardSettings,
	ProjectGoals,
	DashboardWidgetConfig,
	DashboardWidgetSlot,
} from './grid-data';
import { findFocusScopes, StoryProject, type EntityInfo } from './entities/entity-manager';
import { parseRelationLines } from './utils/relations';
import { scheduleProjectMirror } from './utils/project-data-store';
import { isSafetyNetPath } from './utils/safety-paths';
import { getCodexKindOrder } from './entities/entity-kinds';
import { resolveWidgetLayout, getWidgetDef, defaultHiddenWidgetIds, computePresenceNotes, type ResolvedWidgetLayout } from './dashboard-widgets';
import { resolveSceneTree, type SceneTreeNode } from './utils/scene-tree';
import { canUse } from './entitlements/entitlements';
import { loadSampleStory } from './sample/load-sample';

/** Dashboard sections that only exist with Pro (the whole-book coach + "Who's gone quiet"). */
const PRO_WIDGETS: ReadonlySet<string> = new Set(['habits', 'pace', 'quiet']);
import { buildNamePatterns, countNameMentions } from './prose/name-presence';
import { crutchHabits, paceCurve } from './prose/pro/book';
import { percent } from './prose/pro/pace';
import { dismissedFor } from './prose/coach-settings';
import {
	dayKey,
	startOfWeek,
	startOfMonth,
	startOfYear,
	sumSince,
	summarizeStatuses,
	CharacterBalance,
	STATUS_ORDER,
} from './utils/stats';

export const VIEW_TYPE_DASHBOARD = 'storygrid-dashboard-view';

/** Lazily create the dashboard bucket so DEFAULT_SETTINGS is never mutated. */
export function ensureDashboard(settings: StorygridSettings): DashboardSettings {
	if (!settings.dashboard) settings.dashboard = { goals: {}, todos: {}, typedWords: {}, streaks: {} };
	const d = settings.dashboard;
	if (!d.goals) d.goals = {};
	if (!d.todos) d.todos = {};
	if (!d.typedWords) d.typedWords = {};
	if (!d.streaks) d.streaks = {};
	return d;
}

const GOAL_WINDOWS: Array<{ key: keyof ProjectGoals; labelKey: string }> = [
	{ key: 'daily', labelKey: 'dashboard.goalWindow.daily' },
	{ key: 'weekly', labelKey: 'dashboard.goalWindow.weekly' },
	{ key: 'monthly', labelKey: 'dashboard.goalWindow.monthly' },
	{ key: 'yearly', labelKey: 'dashboard.goalWindow.yearly' },
	{ key: 'total', labelKey: 'dashboard.goalWindow.total' },
];

const STATUS_LABEL_KEYS: Record<string, string> = {
	idea: 'dashboard.status.idea', outline: 'dashboard.status.outline', draft: 'dashboard.status.draft',
	written: 'dashboard.status.written', revised: 'dashboard.status.revised', final: 'dashboard.status.final',
};

export class StorygridDashboardView extends ItemView {
	private plugin: StorygridPlugin;
	/** Which feature the big right-hand action card currently promotes — its jump tile is hidden to avoid duplicates. */
	private promotedAction: ModuleId | null = null;
	private projectRoot: string | null = null;
	private refreshTimer: number | null = null;
	private _needsRender = false;
	private _sprintTick: number | null = null;
	private _sprintChangedHandler: (() => void) | null = null;
	private _tasksChangedHandler: ((e: Event) => void) | null = null;
	private _sprintPanelEl: HTMLElement | null = null;
	private _taskList = new TaskListController();
	/** "Crutch words across the book": which habits are unfolded to their per-chapter counts (not saved). */
	private _habitOpen = new Set<string>();
	private editMode = false;
	private _widgetDrag: { id: string; slot: DashboardWidgetSlot; el: HTMLElement } | null = null;
	private _editToggleEl: HTMLElement | null = null;
	private _quietSaveTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_DASHBOARD; }
	getDisplayText(): string { return t('dashboard.tabTitle'); }
	getIcon(): string { return 'sg-chart-bar'; }

	// ─── Lifecycle ─────────────────────────────────────────────────────────────

	async onOpen(): Promise<void> {
		this.contentEl.addClass('sg-dash-root');

		const scheduleRefresh = (file?: TAbstractFile) => {
			if (file && isSafetyNetPath(file.path)) return;
			const active = this.contentEl.doc.activeElement;
			if (active && this.contentEl.contains(active) &&
				(active.instanceOf(HTMLInputElement) || active.instanceOf(HTMLTextAreaElement))) return;
			if (this.app.workspace.getMostRecentLeaf() !== this.leaf) {
				this._needsRender = true;
				return;
			}
			if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
			this.refreshTimer = window.setTimeout(() => void this.render(), 1200);
		};
		this.registerEvent(this.app.vault.on('modify', scheduleRefresh));
		this.registerEvent(this.app.vault.on('create', scheduleRefresh));
		this.registerEvent(this.app.vault.on('delete', scheduleRefresh));
		this.registerEvent(this.app.vault.on('rename', scheduleRefresh));
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			if (leaf === this.leaf && this._needsRender) {
				this._needsRender = false;
				void this.render();
			}
		}));

		// Re-render when plugin settings change (e.g. a module toggle in Settings)
		// so jump-to tiles for a just-enabled/disabled module update immediately.
		this.registerEvent(
			onSettingsChanged(this.app.workspace, () => void this.render())
		);

		// Follow the globally active project
		const projectHandler = () => void this.render();
		plotverkEvents.addEventListener('storygrid:project-changed', projectHandler);
		this.register(() => plotverkEvents.removeEventListener('storygrid:project-changed', projectHandler));

		this._sprintChangedHandler = () => this.refreshSprintPanel();
		plotverkEvents.addEventListener('storygrid:sprint-changed', this._sprintChangedHandler);

		this._tasksChangedHandler = (e: Event) => {
			if ((e as CustomEvent).detail === 'dashboard') return;
			void this.render();
		};
		plotverkEvents.addEventListener('storygrid:tasks-changed', this._tasksChangedHandler);

		await this.render();
	}

	async onClose(): Promise<void> {
		this.flushQuietSave();
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		if (this._sprintTick !== null) { window.clearInterval(this._sprintTick); this._sprintTick = null; }
		if (this._sprintChangedHandler) {
			plotverkEvents.removeEventListener('storygrid:sprint-changed', this._sprintChangedHandler);
			this._sprintChangedHandler = null;
		}
		if (this._tasksChangedHandler) {
			plotverkEvents.removeEventListener('storygrid:tasks-changed', this._tasksChangedHandler);
			this._tasksChangedHandler = null;
		}
	}

	getState(): Record<string, unknown> {
		return { projectRoot: this.projectRoot };
	}

	async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
		if (state && typeof state.projectRoot === 'string') {
			this.projectRoot = state.projectRoot;
			await this.render();
		}
		await super.setState(state, result);
	}

	async showProject(projectRoot: string): Promise<void> {
		this.projectRoot = projectRoot;
		await this.plugin.setActiveProjectRoot(projectRoot);
		await this.render();
	}

	// ─── Data gathering ────────────────────────────────────────────────────────

	private async loadGrids(project: StoryProject): Promise<GridData[]> {
		const grids: GridData[] = [];
		for (const file of project.gridFiles) {
			try {
				grids.push(JSON.parse(await this.app.vault.cachedRead(file)) as GridData);
			} catch { /* unreadable grid — skip */ }
		}
		return grids;
	}

	private countManuscriptWords(project: StoryProject): { words: number; docs: number } {
		const prefix = project.rootPath ? `${project.rootPath}/Scenes/` : 'Scenes/';
		let words = 0;
		let docs = 0;
		for (const [path, count] of this.plugin.manuscriptWordCache) {
			if (path.startsWith(prefix)) { words += count; docs++; }
		}
		return { words, docs };
	}

	/** Debounced settings + mirror-file save — called on nearly every keystroke/toggle,
	 *  so this coalesces bursts into one write ~800ms after the last call. */
	private quietSave(): void {
		if (this._quietSaveTimer !== null) window.clearTimeout(this._quietSaveTimer);
		this._quietSaveTimer = window.setTimeout(() => {
			this._quietSaveTimer = null;
			this.runQuietSave();
		}, 800);
	}

	private runQuietSave(): void {
		void this.plugin.saveData(this.plugin.settings);
		if (this.projectRoot) {
			scheduleProjectMirror(this.app, this.projectRoot, ensureDashboard(this.plugin.settings));
		}
	}

	/** Runs a pending debounced save immediately — call before the view can lose state (e.g. onClose). */
	private flushQuietSave(): void {
		if (this._quietSaveTimer === null) return;
		window.clearTimeout(this._quietSaveTimer);
		this._quietSaveTimer = null;
		this.runQuietSave();
	}

	/** app.commands is not part of the public Obsidian API, so this cast is isolated to one spot. */
	private runCommand(id: string): void {
		runCommandById(this.app, id);
	}

	/** Count wikilink mentions of each character across all scene documents.
	 *  Uses metadataCache.resolvedLinks — no file reads. */
	private buildCharacterBalance(project: StoryProject): CharacterBalance[] {
		const scenesPrefix = project.rootPath ? `${project.rootPath}/Scenes/` : 'Scenes/';
		const charEntities = this.plugin.entityIndex.list(project.rootPath, 'character');
		if (charEntities.length === 0) return [];

		const charPathSet = new Set(charEntities.map((e) => e.file.path));
		const counts = new Map<string, number>();

		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
			if (!sourcePath.startsWith(scenesPrefix)) continue;
			for (const [targetPath, count] of Object.entries(links)) {
				if (charPathSet.has(targetPath)) {
					counts.set(targetPath, (counts.get(targetPath) ?? 0) + count);
				}
			}
		}

		return charEntities
			.filter((e) => counts.has(e.file.path))
			.map((e) => ({ name: e.name, path: e.file.path, appearances: counts.get(e.file.path)! }))
			.sort((a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name));
	}

	// ─── Rendering ─────────────────────────────────────────────────────────────

	private _renderGen = 0;

	async render(): Promise<void> {
		const gen = ++this._renderGen;
		const el = this.contentEl;
		const scrollTop = el.scrollTop;
		el.empty();

		if (this._sprintTick !== null) { window.clearInterval(this._sprintTick); this._sprintTick = null; }

		const projects = findFocusScopes(this.app, this.plugin.settings);
		if (projects.length === 0) {
			const empty = el.createDiv({ cls: 'sg-dash-empty' });
			empty.createEl('h3', { text: t('dashboard.empty.title') });
			empty.createEl('p', { text: t('dashboard.empty.desc') });
			const cta = empty.createEl('button', { cls: 'sg-dash-empty-cta mod-cta', text: t('dashboard.empty.cta') });
			cta.addEventListener('click', () => {
				this.runCommand(`${this.plugin.manifest.id}:open-grid`);
			});
			const sample = empty.createEl('button', { cls: 'sg-dash-empty-sample', text: t('dashboard.empty.sampleCta') });
			sample.addEventListener('click', () => void loadSampleStory(this.plugin));
			return;
		}
		// One active project everywhere: the global choice always wins.
		const project = projects.find((p) => p.rootPath === this.plugin.settings.activeProjectRoot)
			?? projects.find((p) => p.rootPath === this.projectRoot)
			?? projects[0];
		this.projectRoot = project.rootPath;

		const [grids] = await Promise.all([
			this.loadGrids(project),
		]);
		const manuscript = this.countManuscriptWords(project);
		const charBalance = this.buildCharacterBalance(project);
		// Beat guide cards explain the template; they are not story, so they never count.
		const cards: SceneCard[] = grids.flatMap((g) => g.cards).filter((c) => !c.guide);
		if (gen !== this._renderGen) return;
		const dash = ensureDashboard(this.plugin.settings);
		const history = dash.typedWords[project.rootPath] ?? {};
		const now = new Date();

		// ── Header ───────────────────────────────────────────────────────────────
		const header = el.createDiv({ cls: 'sg-dash-header' });
		const titleWrap = header.createDiv({ cls: 'sg-dash-title' });
		const eyebrow = titleWrap.createDiv({ cls: 'sg-dash-eyebrow' });
		setPhosphorIcon(eyebrow.createSpan({ cls: 'sg-dash-title-icon' }), 'chart-bar', '◆');
		eyebrow.createSpan({ text: t('dashboard.tabTitle') });
		titleWrap.createDiv({ cls: 'sg-dash-project-name', text: project.name });

		const controls = header.createDiv({ cls: 'sg-dash-controls' });

if (projects.length > 1) {
			const select = controls.createEl('select', { cls: 'sg-dash-project-select' });
			select.setAttr('aria-label', t('dashboard.controls.switchProjectAria'));
			for (const p of projects) {
				const opt = select.createEl('option', { text: p.name, value: p.rootPath });
				if (p.rootPath === project.rootPath) opt.selected = true;
			}
			select.addEventListener('change', () => void this.showProject(select.value));
		}

		// Standard quick-launch row — identical to the one in the Codex and Writers
		// Panel headers; per-link visibility + placement come from Settings → Quick-links.
		const recentGrid = [...project.gridFiles].sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
		const quickLaunch = controls.createDiv({ cls: 'sg-quicklaunch-row' });
		this.plugin.renderQuickLaunchRow(quickLaunch, 'panel', recentGrid);

		const editBtn = controls.createEl('button', {
			cls: 'sg-dash-edit-toggle' + (this.editMode ? ' is-active' : ''),
			attr: { title: this.editMode ? t('dashboard.controls.editDone') : t('dashboard.controls.editLayout') },
		});
		setPhosphorIcon(
			editBtn.createSpan({ cls: 'sg-dash-edit-toggle-icon' }),
			this.editMode ? 'check' : 'gear',
			this.editMode ? '✓' : '⚙',
		);
		editBtn.addEventListener('click', () => { this.editMode = !this.editMode; void this.render(); });

		this._editToggleEl = editBtn;
		if (!this.editMode && this.plugin.canShowCoachMark('dashboard-edit-toggle')) {
			window.requestAnimationFrame(() => this.runTourCoachMark(
				() => this.plugin.markCoachMarkSeen('dashboard-edit-toggle'),
				() => this.plugin.releasePendingCoachMark('dashboard-edit-toggle'),
			));
		}

		el.toggleClass('sg-dash-editing', this.editMode);

		const body = el.createDiv({ cls: 'sg-dash-body' });
		this.renderReadinessSuggestion(body, project, manuscript, cards.length);
		const layout = resolveWidgetLayout(this.ensureWidgets(dash));

		// ── Action cards (band) ─────────────────────────────────────────────────
		this.mountWidget(body, 'action-cards', 'band', layout,
			(h) => this.renderActionCards(h, project));

		// ── Top row: Today hero + Sprint panel ────────────────────────────────────
		if (this.editMode || layout.isVisible('today') || layout.isVisible('sprint')) {
			const topRow = body.createDiv({ cls: 'sg-dash-top-row' });
			this.mountWidget(topRow, 'today', 'top', layout,
				(h) => this.renderTodayHero(h, project, dash, history, manuscript.words, now));
			this.mountWidget(topRow, 'sprint', 'top', layout,
				(h) => this.renderSprintPanel(h));
		}

		// ── Jump-to tiles (band) ──────────────────────────────────────────────────
		this.mountWidget(body, 'jump-to', 'band', layout,
			(h) => this.renderJumpTo(h, project));

		// ── Two-column layout ─────────────────────────────────────────────────────
		const columns = body.createDiv({ cls: 'sg-dash-columns' });
		const colLeft = columns.createDiv({ cls: 'sg-dash-col' });
		const colRight = columns.createDiv({ cls: 'sg-dash-col' });
		if (this.editMode && !Platform.isMobile) {
			this.setupColumnDnD(colLeft);
			this.setupColumnDnD(colRight);
		}

		// Single dispatch so any column widget renders in either column — widgets
		// can be dragged left↔right without a column "forgetting" how to draw them.
		const tasksOn = this.plugin.isModuleOn('tasks');
		const renderColumnWidget = (h: HTMLElement, id: string): void => {
			switch (id) {
				case 'goals': if (tasksOn) this.renderGoals(h, project, dash, history, manuscript.words, now); break;
				case 'activity': this.renderActivity(h, dash, project, history, now); break;
				case 'balance': this.renderBalance(h, charBalance); break;
				case 'quiet': this.renderQuiet(h, project, dash); break;
				case 'habits': this.renderHabits(h, project, dash); break;
				case 'pace': this.renderPace(h, project, dash); break;
				case 'todos': if (tasksOn) this.renderTodos(h, project, dash); break;
				case 'statuses': this.renderStatuses(h, cards); break;
			}
		};

		for (const id of layout.columnOrder('left')) {
			this.mountWidget(colLeft, id, 'left', layout, (h) => renderColumnWidget(h, id));
		}
		for (const id of layout.columnOrder('right')) {
			this.mountWidget(colRight, id, 'right', layout, (h) => renderColumnWidget(h, id));
		}

		// ── Footer (band) ─────────────────────────────────────────────────────────
		this.mountWidget(body, 'footer', 'band', layout,
			(h) => this.renderFooter(h, project, manuscript));

		el.scrollTop = scrollTop;
	}

	/**
	 * Shows the "this page is yours" coach mark on the edit-layout button,
	 * regardless of whether it's already been seen — used both for the normal
	 * first-visit nudge and for the Guide's user-initiated "Show me around"
	 * (re-showing a coach mark on request is fine; it's the forced tours that
	 * research says fail, not a one-off replay the user explicitly asked for).
	 */
	runTourCoachMark(onDismiss?: () => void, onHide?: () => void): void {
		if (!this._editToggleEl?.isConnected) return;
		showCoachMark(this._editToggleEl, t('dashboard.coachMark.editLayout'), { placement: 'bottom', onDismiss, onHide });
	}

	// ── Widget mounting + edit-layout mode ─────────────────────────────────────

	/**
	 * Render a single widget into a `[data-widget-id]` wrapper. When not editing,
	 * hidden widgets are skipped entirely (today's behavior). When editing, every
	 * widget renders — hidden ones dimmed — wrapped in an edit-chrome bar with a
	 * visibility toggle and (for column widgets) reorder controls.
	 */
	private mountWidget(
		parent: HTMLElement,
		id: string,
		slot: DashboardWidgetSlot | 'band' | 'top',
		layout: ResolvedWidgetLayout,
		renderFn: (host: HTMLElement) => void,
	): void {
		// Pro sections are left out entirely without Pro — not even an empty frame,
		// a fold button or an edit-mode bar (the public release has no Pro yet).
		if (PRO_WIDGETS.has(id) && !canUse('prose-coach')) return;
		const visible = layout.isVisible(id);
		if (!this.editMode && !visible) return;

		// Only the column sections fold; bands/hero use the eye to hide instead.
		const foldable = slot === 'left' || slot === 'right';
		const collapsed = foldable && this.isCollapsed(id);

		const wrap = parent.createDiv({ cls: 'sg-dash-widget', attr: { 'data-widget-id': id } });
		if (collapsed) wrap.addClass('sg-dash-widget--collapsed');

		if (this.editMode) {
			wrap.addClass('sg-dash-widget--editing');
			if (!visible) wrap.addClass('sg-dash-widget--hidden');
			this.renderWidgetChrome(wrap, id, slot, visible, foldable, collapsed);
			if (!collapsed) renderFn(wrap.createDiv({ cls: 'sg-dash-widget-body' }));
			return;
		}

		if (collapsed) {
			this.renderCollapsedBar(wrap, id);
			return;
		}
		if (foldable) this.renderFoldChevron(wrap, id);
		renderFn(wrap.createDiv({ cls: 'sg-dash-widget-body' }));
	}

	/** Compact one-row bar shown in place of a folded section (normal mode). */
	private renderCollapsedBar(wrap: HTMLElement, id: string): void {
		const def = getWidgetDef(id);
		const bar = wrap.createEl('button', {
			cls: 'sg-dash-widget-collapsed-bar',
			attr: { 'aria-label': t('dashboard.widget.expandAria', { label: def?.label ?? id }) },
		});
		setPhosphorIcon(bar.createSpan({ cls: 'sg-dash-widget-collapsed-icon' }),
			def?.icon ?? 'square', def?.fallbackIcon ?? '•');
		bar.createSpan({ cls: 'sg-dash-widget-collapsed-label', text: def?.label ?? id });
		setPhosphorIcon(bar.createSpan({ cls: 'sg-dash-widget-collapsed-caret' }), 'caret-right', '▸');
		bar.addEventListener('click', () => this.toggleCollapsed(id));
	}

	/** Subtle hover-reveal fold control on an expanded section (normal mode). */
	private renderFoldChevron(wrap: HTMLElement, id: string): void {
		const fold = wrap.createEl('button', {
			cls: 'sg-dash-widget-fold',
			attr: { 'aria-label': t('dashboard.widget.collapseAria') },
		});
		setPhosphorIcon(fold, 'caret-down', '▾');
		fold.addEventListener('click', (e) => { e.stopPropagation(); this.toggleCollapsed(id); });
	}

	private renderWidgetChrome(
		wrap: HTMLElement,
		id: string,
		slot: DashboardWidgetSlot | 'band' | 'top',
		visible: boolean,
		foldable: boolean,
		collapsed: boolean,
	): void {
		const def = getWidgetDef(id);
		const bar = wrap.createDiv({ cls: 'sg-dash-widget-chrome' });

		const isColumn = slot === 'left' || slot === 'right';
		if (isColumn && !Platform.isMobile) {
			const handle = bar.createSpan({ cls: 'sg-dash-widget-handle' });
			setPhosphorIcon(handle, 'dots-six-vertical', '⠿');
			handle.setAttr('aria-label', t('dashboard.widget.dragReorderAria'));
		}

		const label = bar.createDiv({ cls: 'sg-dash-widget-label' });
		setPhosphorIcon(label.createSpan({ cls: 'sg-dash-widget-label-icon' }),
			def?.icon ?? 'square', def?.fallbackIcon ?? '•');
		label.createSpan({ text: def?.label ?? id });

		const tools = bar.createDiv({ cls: 'sg-dash-widget-tools' });

		if (isColumn && Platform.isMobile) {
			const up = tools.createEl('button', { cls: 'sg-dash-widget-move', attr: { 'aria-label': t('dashboard.widget.moveUpAria') } });
			setPhosphorIcon(up, 'caret-up', '▲');
			up.addEventListener('click', () => this.moveWidget(id, slot, -1));
			const down = tools.createEl('button', { cls: 'sg-dash-widget-move', attr: { 'aria-label': t('dashboard.widget.moveDownAria') } });
			setPhosphorIcon(down, 'caret-down', '▼');
			down.addEventListener('click', () => this.moveWidget(id, slot, 1));
		}

		if (foldable) {
			const fold = tools.createEl('button', {
				cls: 'sg-dash-widget-foldbtn',
				attr: { 'aria-label': collapsed ? t('dashboard.widget.expandSectionAria') : t('dashboard.widget.collapseAria') },
			});
			setPhosphorIcon(fold, collapsed ? 'caret-right' : 'caret-down', collapsed ? '▸' : '▾');
			fold.addEventListener('click', () => this.toggleCollapsed(id));
		}

		const eye = tools.createEl('button', {
			cls: 'sg-dash-widget-eye' + (visible ? '' : ' is-off'),
			attr: { 'aria-label': visible ? t('dashboard.widget.hideAria') : t('dashboard.widget.showAria') },
		});
		setPhosphorIcon(eye, visible ? 'eye' : 'eye-slash', '◆');
		eye.addEventListener('click', () => this.toggleWidgetVisible(id));

		// Desktop drag-to-reorder for column widgets. The column-level dragover
		// (see setupColumnDnD) live-inserts this element under the cursor, so by
		// dragend the DOM already reflects the new order — we just read it back.
		if (isColumn && !Platform.isMobile) {
			wrap.draggable = true;
			wrap.addEventListener('dragstart', (e) => {
				this._widgetDrag = { id, slot, el: wrap };
				e.dataTransfer?.setData('text/plain', id);
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';

				// Custom drag image, so styling the live element immediately is safe.
				const ghost = createDiv();
				ghost.textContent = def?.label ?? id;
				Object.assign(ghost.style, {
					position: 'fixed', top: '-9999px', left: '-9999px',
					padding: '6px 12px',
					background: 'var(--background-primary)',
					border: '1px dashed var(--interactive-accent)',
					borderRadius: '6px',
					color: 'var(--text-normal)',
					fontSize: '12px', fontWeight: '650',
					pointerEvents: 'none', boxSizing: 'border-box',
				});
				const ghostDoc = this.contentEl.doc;
				ghostDoc.body.appendChild(ghost);
				e.dataTransfer?.setDragImage(ghost, 20, 14);
				wrap.addClass('sg-dash-widget--dragging');
				window.setTimeout(() => { if (ghostDoc.body.contains(ghost)) ghostDoc.body.removeChild(ghost); }, 0);
			});
			wrap.addEventListener('dragend', () => {
				wrap.removeClass('sg-dash-widget--dragging');
				this._widgetDrag = null;
				this.persistColumns();
			});
		}
	}

	/** Live-insert the dragged widget among this column's siblings by cursor Y.
	 *  Any column adopts the dragged element (cross-column allowed); placement is
	 *  read back from the DOM on drop, so left↔right moves persist for both. */
	private setupColumnDnD(col: HTMLElement): void {
		const onOver = (e: DragEvent) => {
			const drag = this._widgetDrag;
			if (!drag) return;
			e.preventDefault();                                   // mark this a valid drop
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			const dragging = drag.el;
			const siblings = [...col.querySelectorAll<HTMLElement>(
				':scope > .sg-dash-widget:not(.sg-dash-widget--dragging)')];
			const next = siblings.find((sib) => {
				const r = sib.getBoundingClientRect();
				return e.clientY <= r.top + r.height / 2;
			});
			col.insertBefore(dragging, next ?? null);
		};
		col.addEventListener('dragover', onOver);
		col.addEventListener('dragenter', onOver);
		col.addEventListener('drop', (e: DragEvent) => {
			if (this._widgetDrag) e.preventDefault();
		});
	}

	/** Read both columns' current DOM order (incl. hidden widgets) and persist —
	 *  covers cross-column moves where the source and target columns both change. */
	private persistColumns(): void {
		const cols = this.contentEl.querySelectorAll<HTMLElement>('.sg-dash-columns > .sg-dash-col');
		if (cols.length < 2) return;
		const readCol = (col: HTMLElement) =>
			[...col.querySelectorAll<HTMLElement>(':scope > .sg-dash-widget[data-widget-id]')]
				.map((el) => el.getAttribute('data-widget-id') ?? '')
				.filter(Boolean);
		const dash = ensureDashboard(this.plugin.settings);
		const w = this.ensureWidgets(dash);
		w.order.left = readCol(cols[0]);
		w.order.right = readCol(cols[1]);
		this.quietSave();
		// Let the drop settle before rebuilding the DOM cleanly.
		window.setTimeout(() => void this.render(), 140);
	}

	/** Lazily materialize the widget config so DEFAULT_SETTINGS is never mutated.
	 *  On first creation, seeds `hidden` from the user's setup (see
	 *  defaultHiddenWidgetIds) — a one-time preset, not an ongoing rule; every
	 *  widget stays reversible afterward via the eye icon in edit mode. */
	private ensureWidgets(dash: DashboardSettings): DashboardWidgetConfig {
		if (!dash.widgets) {
			const intent = (this.plugin.settings.intent ?? null);
			dash.widgets = { hidden: defaultHiddenWidgetIds(intent), order: { left: [], right: [] } };
		}
		const w = dash.widgets;
		if (!w.hidden) w.hidden = [];
		if (!w.order) w.order = { left: [], right: [] };
		if (!w.order.left) w.order.left = [];
		if (!w.order.right) w.order.right = [];
		if (!w.collapsed) w.collapsed = [];
		return w;
	}

	private toggleWidgetVisible(id: string): void {
		const dash = ensureDashboard(this.plugin.settings);
		const w = this.ensureWidgets(dash);
		const i = w.hidden.indexOf(id);
		if (i >= 0) w.hidden.splice(i, 1);
		else w.hidden.push(id);
		this.quietSave();
		void this.render();
	}

	private isCollapsed(id: string): boolean {
		return this.plugin.settings.dashboard?.widgets?.collapsed?.includes(id) ?? false;
	}

	private toggleCollapsed(id: string): void {
		const dash = ensureDashboard(this.plugin.settings);
		const w = this.ensureWidgets(dash);
		const list = (w.collapsed ??= []);
		const i = list.indexOf(id);
		if (i >= 0) list.splice(i, 1);
		else list.push(id);
		this.quietSave();
		void this.render();
	}

	private moveWidget(id: string, slot: DashboardWidgetSlot, dir: -1 | 1): void {
		const dash = ensureDashboard(this.plugin.settings);
		const w = this.ensureWidgets(dash);
		const order = resolveWidgetLayout(w).columnOrder(slot);
		const idx = order.indexOf(id);
		const j = idx + dir;
		if (idx < 0 || j < 0 || j >= order.length) return;
		[order[idx], order[j]] = [order[j], order[idx]];
		w.order[slot] = order;
		this.quietSave();
		void this.render();
	}

	private section(parent: HTMLElement, icon: string, title: string, hint?: string): HTMLElement {
		const sec = parent.createDiv({ cls: 'sg-dash-section' });
		const head = sec.createDiv({ cls: 'sg-dash-section-head' });
		setPhosphorIcon(head.createSpan({ cls: 'sg-dash-section-icon' }), icon, '•');
		head.createSpan({ cls: 'sg-dash-section-title', text: title });
		if (hint) sec.createDiv({ cls: 'sg-dash-section-hint', text: hint });
		return sec;
	}

	// ── Action card: one adaptive card, one slot ───────────────────────────────
	// The single big card promotes whatever's most useful for the user's setup
	// (Plan Step 10): World Builder → keep building their last entity; a writer
	// mid-draft → resume it; a Plotter who hasn't started writing yet → their
	// grid. Whatever it promotes is EXCLUDED from the jump-to tiles below (no
	// duplicate buttons on the dashboard) via `promotedAction`.

	private renderActionCards(parent: HTMLElement, project: StoryProject): void {
		const wrap = parent.createDiv({ cls: 'sg-dash-action-cards' });

		/** Build the one card: accent icon chip + title + a quiet context line. */
		const makeCard = (
			variant: 'resume' | 'codex',
			icon: string, fallback: string,
			title: string, sub: string,
			onClick: () => void,
		): void => {
			const card = wrap.createEl('button', { cls: `sg-dash-action-card sg-dash-action-card--${variant}` });
			const iconWrap = card.createDiv({ cls: 'sg-dash-action-card-icon' });
			setPhosphorIcon(iconWrap, icon, fallback);
			const text = card.createDiv({ cls: 'sg-dash-action-card-text' });
			text.createDiv({ cls: 'sg-dash-action-card-title', text: title });
			text.createDiv({ cls: 'sg-dash-action-card-sub', text: sub });
			card.addEventListener('click', onClick);
		};

		const intent = (this.plugin.settings.intent ?? null);

		// World Builder: no manuscript to resume — the equivalent action is
		// picking up wherever they last left off in the Codex.
		if (intent === 'worldbuilder' && this.plugin.isModuleOn('codex')) {
			const nonSceneKinds = getCodexKindOrder().filter((k) => k !== 'scene');
			const allRecent: EntityInfo[] = [];
			for (const kind of nonSceneKinds) {
				allRecent.push(...this.plugin.entityIndex.list(project.rootPath, kind));
			}
			allRecent.sort((a, b) => (b.file.stat.mtime ?? 0) - (a.file.stat.mtime ?? 0));
			const latest = allRecent[0];
			if (latest) {
				makeCard('codex', 'globe', '◆', t('dashboard.action.continueBuilding'), latest.name,
					() => void this.plugin.openCodex(project.rootPath, latest.file.path));
			} else {
				makeCard('codex', 'globe', '◆', t('dashboard.action.openCodex'), t('dashboard.action.codexSubDefault'),
					() => void this.plugin.openCodex(project.rootPath));
			}
			this.promotedAction = 'codex';
			return;
		}

		const scenesFolder = project.rootPath ? `${project.rootPath}/Scenes` : 'Scenes';
		const recentScene = this.app.vault.getMarkdownFiles()
			.filter((f) => f.parent?.path === scenesFolder || f.path.startsWith(scenesFolder + '/'))
			.sort((a, b) => b.stat.mtime - a.stat.mtime)[0];

		if (recentScene) {
			makeCard('resume', 'pen-nib', '✍', t('dashboard.action.resumeDraft'), recentScene.basename, () => {
				runSafely((async () => {
					const leaf = this.app.workspace.getLeaf('tab');
					await leaf.openFile(recentScene);
					void this.app.workspace.revealLeaf(leaf);
				})());
			});
			this.promotedAction = null;
			return;
		}

		// No scenes yet: a Plotter who already built a grid goes there instead
		// of the generic "create a scene" CTA (Pantsers never see this — they
		// land straight in a blank scene at setup, per Step 9).
		const recentGrid = [...project.gridFiles].sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
		if (this.plugin.settings.writingStyle === 'plotter' && recentGrid) {
			makeCard('resume', 'squares-four', '◆', t('dashboard.action.openYourGrid'), recentGrid.basename,
				() => void this.plugin.openGridFile(recentGrid));
			this.promotedAction = 'plotGrid';
			return;
		}

		makeCard('resume', 'pen-nib', '✍', t('dashboard.action.startWriting'), t('dashboard.action.createFirstScene'), () => {
			this.runCommand(`${this.plugin.manifest.id}:open-grid`);
		});
		this.promotedAction = null;
	}

	// ── Today hero ────────────────────────────────────────────────────────────

	private renderTodayHero(
		parent: HTMLElement,
		project: StoryProject,
		dash: DashboardSettings,
		history: Record<string, number>,
		manuscriptWords: number,
		now: Date
	): void {
		const sec = parent.createDiv({ cls: 'sg-dash-today' });

		const todayWords = sumSince(history, now, now);
		const wordGoals = this.plugin.settings.wordGoals ?? {};
		const legacyGoals = dash.goals[project.rootPath] ?? {};
		const dailyTarget = wordGoals.daily ?? legacyGoals.daily ?? 0;

		sec.createDiv({ cls: 'sg-dash-today-eyebrow', text: t('dashboard.today.eyebrow') });

		const numRow = sec.createDiv({ cls: 'sg-dash-today-nums' });
		numRow.createSpan({ cls: 'sg-dash-today-value', text: todayWords.toLocaleString() });
		numRow.createSpan({
			cls: 'sg-dash-today-target',
			text: dailyTarget > 0 ? t('dashboard.today.targetSuffix', { target: dailyTarget.toLocaleString() }) : t('dashboard.today.wordsToday'),
		});

		if (dailyTarget > 0) {
			const pct = Math.min(100, Math.round((todayWords / dailyTarget) * 100));
			const bar = sec.createDiv({ cls: 'sg-dash-today-bar' });
			const fill = bar.createDiv({ cls: 'sg-dash-today-bar-fill' + (todayWords >= dailyTarget ? ' is-met' : '') });
			fill.style.width = `${pct}%`;
		}

		// Streak chip
		const streak = dash.streaks?.[project.rootPath];
		const today = dayKey(now);
		const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
		if (streak && streak.current > 0) {
			const isActive = streak.lastDate === today;
			const isAtRisk = streak.lastDate === yesterday;
			const isBroken = !isActive && !isAtRisk;
			const chip = sec.createDiv({
				cls: 'sg-dash-streak'
					+ (isAtRisk ? ' sg-dash-streak--at-risk' : '')
					+ (isBroken ? ' sg-dash-streak--broken' : ''),
			});
			chip.createSpan({ cls: 'sg-dash-streak-icon', text: isBroken ? '💪' : isAtRisk ? '⚡' : '🔥' });
			chip.createSpan({
				cls: 'sg-dash-streak-count',
				text: isBroken
					? t('dashboard.streak.longest', { days: streak.longest || streak.current })
					: isAtRisk
						? t('dashboard.streak.atRisk', { count: streak.current })
						: t('dashboard.streak.current', { count: streak.current }),
			});
			if (isActive && streak.longest > streak.current) {
				chip.createSpan({ cls: 'sg-dash-streak-best', text: t('dashboard.streak.best', { days: streak.longest }) });
			}
			if (isAtRisk || isBroken) {
				const dismiss = chip.createEl('button', {
					cls: 'sg-dash-streak-dismiss',
					text: '×',
					attr: { type: 'button', 'aria-label': 'Dismiss streak' },
				});
				dismiss.addEventListener('click', (e) => { e.stopPropagation(); chip.remove(); });
			}
		}
	}

	// ── Sprint panel ──────────────────────────────────────────────────────────

	private renderSprintPanel(parent: HTMLElement): void {
		const sec = parent.createDiv({ cls: 'sg-dash-sprint-panel' });
		this._sprintPanelEl = sec;

		const head = sec.createDiv({ cls: 'sg-dash-sprint-head' });
		const headLabel = head.createDiv({ cls: 'sg-dash-sprint-head-label' });
		setPhosphorIcon(headLabel.createSpan({ cls: 'sg-dash-sprint-icon' }), 'timer', '◆');
		headLabel.createSpan({ text: t('dashboard.sprint.title') });

		const stats = this.plugin.getSprintStats();

		if (this.plugin.isSprintActive()) {
			const style = this.plugin.settings.sprintTimerStyle ?? 'digital';
			const duration = this.plugin.getSprintDuration() || 1;
			const RING_R = 30;
			const RING_C = 2 * Math.PI * RING_R;

			const fmt = (ms: number) => {
				const t = Math.max(0, Math.ceil(ms / 1000));
				return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
			};

			// Thin remaining-time bar between the header and the countdown —
			// the 'bar' timer style already has a full-size bar, skip there.
			let thinFill: HTMLElement | null = null;
			if (style !== 'bar') {
				const thinBar = sec.createDiv({ cls: 'sg-dash-sprint-thinbar' });
				thinFill = thinBar.createDiv({ cls: 'sg-dash-sprint-thinbar-fill' });
			}

			const timerWrap = sec.createDiv({ cls: `sg-dash-sprint-timer sg-sprint-timer--${style}` });

			let timeEl: HTMLElement;
			let barFill: HTMLElement | null = null;
			let ringArc: SVGCircleElement | null = null;

			if (style === 'bar') {
				const bar = timerWrap.createDiv({ cls: 'sg-sprint-bar' });
				barFill = bar.createDiv({ cls: 'sg-sprint-bar-fill' });
				timeEl = timerWrap.createDiv({ cls: 'sg-sprint-time sg-sprint-time--small' });
			} else if (style === 'ring') {
				const ringBox = timerWrap.createDiv({ cls: 'sg-sprint-ring' });
				const svg = ringBox.createSvg('svg', { attr: { viewBox: '0 0 72 72', width: '72', height: '72' } });
				svg.createSvg('circle', { attr: { cx: 36, cy: 36, r: RING_R, class: 'sg-sprint-ring-track' } });
				ringArc = svg.createSvg('circle', {
					attr: {
						cx: 36, cy: 36, r: RING_R, class: 'sg-sprint-ring-arc',
						'stroke-dasharray': String(RING_C), transform: 'rotate(-90 36 36)',
					},
				});
				timeEl = ringBox.createDiv({ cls: 'sg-sprint-ring-time' });
			} else {
				timeEl = timerWrap.createDiv({ cls: 'sg-dash-sprint-time' });
			}

			const stopBtn = head.createEl('button', { cls: 'sg-dash-sprint-stop', text: t('dashboard.sprint.stop') });
			stopBtn.addEventListener('click', () => this.plugin.stopSprint());

			const update = () => {
				if (!this.plugin.isSprintActive() || !timeEl.isConnected) {
					if (this._sprintTick !== null) { window.clearInterval(this._sprintTick); this._sprintTick = null; }
					if (timeEl.isConnected) void this.render();
					return;
				}
				const rem = this.plugin.getSprintRemaining();
				timeEl.setText(fmt(rem));
				const frac = rem / duration;
				if (barFill) barFill.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
				if (thinFill) thinFill.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
				if (ringArc) ringArc.setAttribute('stroke-dashoffset', String(RING_C * (1 - frac)));
			};
			update();
			this._sprintTick = window.setInterval(update, 1000);
		} else {
			const startBtn = head.createEl('button', { cls: 'sg-dash-sprint-start' });
			setPhosphorIcon(startBtn.createSpan({ cls: 'sg-dash-sprint-icon' }), 'timer', '◆');
			startBtn.createSpan({ text: t('dashboard.sprint.start') });
			startBtn.addEventListener('click', (e) => this.plugin.showSprintMenu(e));
		}

		// Sprint goal progress bars
		const sprintGoalRow = (label: string, done: number, goal: number | undefined) => {
			const row = sec.createDiv({ cls: 'sg-dash-sprint-goal-row' });
			const top = row.createDiv({ cls: 'sg-dash-sprint-goal-top' });
			top.createSpan({ cls: 'sg-dash-sprint-goal-label', text: label });
			top.createSpan({
				cls: 'sg-dash-sprint-goal-nums',
				text: goal && goal > 0
					? t('dashboard.sprint.goalNumsWithGoal', { done, goal })
					: t('dashboard.sprint.goalNumsNoGoal', { done, s: done === 1 ? '' : 's' }),
			});
			if (goal && goal > 0) {
				const bar = row.createDiv({ cls: 'sg-dash-bar sg-dash-sprint-bar-goal' });
				const fill = bar.createDiv({ cls: 'sg-dash-bar-fill' });
				fill.style.width = `${Math.min(100, Math.round((done / goal) * 100))}%`;
				if (done >= goal) fill.addClass('is-met');
			}
		};
		sprintGoalRow(t('dashboard.goalWindow.daily'), stats.today, this.plugin.settings.sprintGoalDaily);
		sprintGoalRow(t('dashboard.goalWindow.weekly'), stats.week, this.plugin.settings.sprintGoalWeekly);
	}

	/**
	 * Synchronous in-place refresh of the sprint panel — no full async re-render,
	 * no gen-counter race. Called by the plugin directly on sprint start/end,
	 * and also by the storygrid:sprint-changed event handler.
	 */
	refreshSprintPanel(): void {
		if (this._sprintTick !== null) { window.clearInterval(this._sprintTick); this._sprintTick = null; }
		const el = this._sprintPanelEl;
		if (!el?.isConnected || !el.parentElement) {
			// Panel hasn't been rendered yet — fall back to a full render
			void this.render();
			return;
		}
		const parent = el.parentElement;
		el.remove();
		this._sprintPanelEl = null;
		this.renderSprintPanel(parent);
	}

	// ── Readiness suggestions ──────────────────────────────────────────────────
	// Fogg-style prompts: only surface when motivation + ability have already
	// converged (the user did the thing the module needs), not on a schedule.
	// Fire-once via settings.dismissedIntros, same mechanism as the Codex intro.
	// Only ever ONE banner at a time — first matching candidate wins — so a
	// setup that's "ready" for several modules at once doesn't get a wall of them.

	private renderReadinessSuggestion(
		parent: HTMLElement,
		project: StoryProject,
		manuscript: { words: number; docs: number },
		cardCount: number,
	): void {
		const recentGrid = [...project.gridFiles].sort((a, b) => b.stat.mtime - a.stat.mtime)[0];

		const candidates: Array<{
			key: string;
			moduleId: ModuleId;
			/** Also offer it when the module is already on (the bar is about using it, not switching it on). */
			showWhenOn?: boolean;
			check: () => Promise<boolean>;
			textKey: string;
			buttonKey: string;
			onEnable: () => void;
		}> = [
			{
				key: 'connections-map-suggestion',
				moduleId: 'socialMaps',
				check: () => this.countRelatedCharacterSheets(project).then((n) => n >= 2),
				textKey: 'dashboard.suggestion.connectionsMap.text',
				buttonKey: 'dashboard.suggestion.connectionsMap.button',
				onEnable: () => void this.plugin.openSocialMaps('map', project.rootPath),
			},
			{
				key: 'story-tree-suggestion',
				moduleId: 'socialMaps',
				check: () => this.countFamilyRelationSheets(project).then((n) => n >= 2),
				textKey: 'dashboard.suggestion.storyTree.text',
				buttonKey: 'dashboard.suggestion.storyTree.button',
				onEnable: () => void this.plugin.openSocialMaps('tree', project.rootPath),
			},
			{
				// Writing scenes but nothing planned yet: point at the Plot Grid.
				key: 'plot-grid-outline-suggestion',
				moduleId: 'plotGrid',
				showWhenOn: true,
				check: () => Promise.resolve(manuscript.docs >= 1 && cardCount === 0),
				textKey: 'dashboard.suggestion.plotGrid.text',
				buttonKey: 'dashboard.suggestion.plotGrid.button',
				onEnable: () => recentGrid ? void this.plugin.openGridFile(recentGrid) : void this.plugin.openOrCreateGrid(),
			},
		];

		const gen = this._renderGen;
		void (async () => {
			for (const c of candidates) {
				if (this.plugin.settings.dismissedIntros?.[c.key]) continue;
				if (!c.showWhenOn && this.plugin.isModuleOn(c.moduleId)) continue; // already on — nothing to suggest
				let ready = false;
				try { ready = await c.check(); } catch { ready = false; }
				// Dashboard re-rendered (or this got dismissed) while the check
				// above was in flight — drop the stale result.
				if (gen !== this._renderGen || !parent.isConnected) return;
				if (!ready || this.plugin.settings.dismissedIntros?.[c.key]) continue;

				const bar = parent.createDiv({ cls: 'sg-tab-intro sg-dash-suggestion' });
				bar.createSpan({ cls: 'sg-tab-intro-text', text: t(c.textKey) });
				const enableBtn = bar.createEl('button', { cls: 'sg-dash-link-btn', text: t(c.buttonKey) });
				enableBtn.addEventListener('click', () => {
					if (!this.plugin.isModuleOn(c.moduleId)) {
						this.plugin.settings.enabledModules = { ...this.plugin.settings.enabledModules, [c.moduleId]: true };
					}
					// Followed once is enough — a bar that can show while its module is
					// on would otherwise come back on every Dashboard render.
					if (c.showWhenOn) {
						if (!this.plugin.settings.dismissedIntros) this.plugin.settings.dismissedIntros = {};
						this.plugin.settings.dismissedIntros[c.key] = true;
					}
					void this.plugin.saveSettings();
					c.onEnable();
					bar.remove();
				});
				const closeBtn = bar.createEl('button', { cls: 'sg-tab-intro-close', text: '×' });
				closeBtn.setAttribute('aria-label', t('dashboard.suggestion.dismissAria'));
				closeBtn.addEventListener('click', () => {
					if (!this.plugin.settings.dismissedIntros) this.plugin.settings.dismissedIntros = {};
					this.plugin.settings.dismissedIntros[c.key] = true;
					void this.plugin.saveSettings();
					bar.classList.add('sg-tab-intro--fade');
					window.setTimeout(() => bar.remove(), 350);
				});
				parent.prepend(bar);
				return; // only one banner at a time
			}
		})();
	}

	/** Counts character sheets with at least one relation line, stopping early once it hits 2 (all this check needs to know). */
	private async countRelatedCharacterSheets(project: StoryProject): Promise<number> {
		const characters = this.plugin.entityIndex.list(project.rootPath, 'character');
		let count = 0;
		for (const entity of characters) {
			if (count >= 2) break;
			try {
				const text = await this.app.vault.cachedRead(entity.file);
				if (parseRelationLines(text).length > 0) count++;
			} catch {
				// Unreadable file — skip, this is a soft suggestion not a report.
			}
		}
		return count;
	}

	/** Counts character sheets with at least one FAMILY-type relation line (parent/child, grand-, aunt, ward, cousin…), stopping early once it hits 2. */
	private async countFamilyRelationSheets(project: StoryProject): Promise<number> {
		const characters = this.plugin.entityIndex.list(project.rootPath, 'character');
		let count = 0;
		for (const entity of characters) {
			if (count >= 2) break;
			try {
				const text = await this.app.vault.cachedRead(entity.file);
				const hasFamily = parseRelationLines(text).some((line) => isFamilyLabel(line.label));
				if (hasFamily) count++;
			} catch {
				// Unreadable file — skip, this is a soft suggestion not a report.
			}
		}
		return count;
	}

	// ── Jump-to destination tiles ─────────────────────────────────────────────

	private renderJumpTo(parent: HTMLElement, project: StoryProject): void {
		const wrap = parent.createDiv({ cls: 'sg-dash-jump' });

		const recentGrid = [...project.gridFiles].sort((a, b) => b.stat.mtime - a.stat.mtime)[0];

		const tiles: Array<{ icon: string; fallback: string; label: string; onClick: () => void; moduleId?: ModuleId }> = [
			{
				icon: 'squares-four', fallback: '◆',
				label: t('dashboard.jump.plotGrid'),
				onClick: () => {
					if (recentGrid) void this.plugin.openGridFile(recentGrid);
					else void this.plugin.createNewGrid();
				},
				moduleId: 'plotGrid',
			},
			{
				icon: 'globe', fallback: '◆',
				label: t('dashboard.jump.codex'),
				onClick: () => void this.plugin.openCodex(project.rootPath),
				moduleId: 'codex',
			},
			{
				icon: 'clock-counter-clockwise', fallback: '◷',
				label: t('dashboard.jump.activity'),
				onClick: () => void this.plugin.openHistory(project.rootPath),
				moduleId: 'history',
			},
			{
				icon: 'graph-new', fallback: '⬡',
				label: t('dashboard.jump.socialMaps'),
				onClick: () => void this.plugin.openSocialMaps(undefined, project.rootPath),
				moduleId: 'socialMaps',
			},
			{
				icon: 'git-commit', fallback: '◷',
				label: t('dashboard.jump.timeline'),
				onClick: () => void this.plugin.openOrCreateTimeline(project.rootPath),
				moduleId: 'timeline',
			},
		];

		for (const tile of tiles) {
			if (tile.moduleId && !this.plugin.isModuleOn(tile.moduleId)) continue;
			if (tile.moduleId && tile.moduleId === this.promotedAction) continue; // already a big action card
			const btn = wrap.createEl('button', { cls: 'sg-dash-jump-tile' });
			btn.addEventListener('click', tile.onClick);
			const iconWrap = btn.createDiv({ cls: 'sg-dash-jump-icon' });
			setPhosphorIcon(iconWrap, tile.icon, tile.fallback);
			btn.createDiv({ cls: 'sg-dash-jump-label', text: tile.label });
		}
	}

	// ── Goals (bars only — streak moved to Today hero, heatmap to Activity) ──

	private renderGoals(
		parent: HTMLElement,
		project: StoryProject,
		dash: DashboardSettings,
		history: Record<string, number>,
		manuscriptWords: number,
		now: Date
	): void {
		const wordGoals = this.plugin.settings.wordGoals ?? {};
		const legacyGoals = dash.goals[project.rootPath] ?? {};
		const targetFor = (key: keyof ProjectGoals) => wordGoals[key] ?? legacyGoals[key] ?? 0;
		const windowStart: Record<string, Date> = {
			daily: now, weekly: startOfWeek(now), monthly: startOfMonth(now), yearly: startOfYear(now),
		};

		const celebrated = (dash.celebratedGoals ??= {});
		if (!celebrated[project.rootPath]) celebrated[project.rootPath] = {};
		const celebByProject = celebrated[project.rootPath];

		const activeWindows = GOAL_WINDOWS.filter(({ key }) => targetFor(key) > 0);

		if (activeWindows.length === 0) {
			const sec = this.section(parent, 'flag', t('dashboard.goals.title'));
			const hint = sec.createDiv({ cls: 'sg-dash-empty-goals' });
			hint.createSpan({ text: t('dashboard.goals.emptyHint') });
			const link = hint.createEl('button', { cls: 'sg-dash-link-btn', text: t('dashboard.goals.openSettingsLink') });
			link.addEventListener('click', () => {
				this.runCommand('app:open-settings');
			});
			return;
		}

		const sec = this.section(parent, 'flag', t('dashboard.goals.title'),
			t('dashboard.goals.hint'));

		const today = dayKey(now);

		const renderGoalRow = (container: HTMLElement, key: keyof ProjectGoals, label: string) => {
			const done = key === 'total' ? manuscriptWords : sumSince(history, windowStart[key], now);
			const target = targetFor(key);
			const row = container.createDiv({ cls: 'sg-dash-goal' });
			const top = row.createDiv({ cls: 'sg-dash-goal-top' });
			top.createSpan({ cls: 'sg-dash-goal-label', text: label });
			const nums = top.createSpan({ cls: 'sg-dash-goal-nums' });
			nums.createSpan({ cls: 'sg-dash-goal-done', text: done.toLocaleString() });
			nums.createSpan({ text: ' / ' });
			nums.createSpan({ cls: 'sg-dash-goal-target', text: target.toLocaleString() });

			const bar = row.createDiv({ cls: 'sg-dash-bar' });
			const fill = bar.createDiv({ cls: 'sg-dash-bar-fill' });
			const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
			fill.style.width = `${pct}%`;

			if (target > 0 && done >= target) {
				fill.addClass('is-met');
				const celebDate = celebByProject[key];
				const windowDate = key === 'daily' ? today
					: key === 'weekly' ? dayKey(startOfWeek(now))
					: key === 'monthly' ? dayKey(startOfMonth(now))
					: key === 'yearly' ? dayKey(startOfYear(now))
					: 'once';
				if (celebDate !== windowDate) {
					celebByProject[key] = windowDate;
					fill.addClass('sg-dash-bar-fill--flash');
					this.quietSave();
				}
			} else {
				if (celebByProject[key]) { delete celebByProject[key]; this.quietSave(); }
			}

			if (target > 0) bar.setAttr('aria-label', `${pct}%`);
		};

		for (const { key, labelKey } of activeWindows) {
			renderGoalRow(sec, key, t(labelKey));
		}
	}

	// ── Writing activity (heatmap + paste-skip notice) ────────────────────────

	private renderActivity(
		parent: HTMLElement,
		dash: DashboardSettings,
		project: StoryProject,
		history: Record<string, number>,
		now: Date
	): void {
		const sec = this.section(parent, 'calendar', t('dashboard.activity.title'));
		const wordGoals = this.plugin.settings.wordGoals ?? {};
		const legacyGoals = dash.goals[project.rootPath] ?? {};
		const dailyGoal = wordGoals.daily ?? legacyGoals.daily ?? 0;
		this.renderHeatmap(sec, history, now, dailyGoal);

		const today = dayKey(now);
		const skippedToday = dash.skippedWords?.[project.rootPath]?.[today] ?? 0;
		if (skippedToday > 0) {
			const notice = sec.createDiv({ cls: 'sg-dash-paste-skip' });
			notice.createSpan({ cls: 'sg-dash-paste-skip-text', text: t('dashboard.activity.skippedText', { count: skippedToday.toLocaleString() }) });
			const countBtn = notice.createEl('button', { cls: 'sg-dash-paste-skip-btn', text: t('dashboard.activity.countThem') });
			countBtn.addEventListener('click', () => {
				const h = (dash.typedWords[project.rootPath] ??= {});
				h[today] = (h[today] ?? 0) + skippedToday;
				if (dash.skippedWords?.[project.rootPath]) delete dash.skippedWords[project.rootPath][today];
				this.quietSave();
				void this.render();
			});
		}
	}

	// ── 30-day heatmap ────────────────────────────────────────────────────────

	private renderHeatmap(
		parent: HTMLElement,
		history: Record<string, number>,
		now: Date,
		dailyGoal: number
	): void {
		const wrap = parent.createDiv({ cls: 'sg-dash-heatmap' });
		wrap.createDiv({ cls: 'sg-dash-heatmap-label', text: t('dashboard.heatmap.last30') });
		const grid = wrap.createDiv({ cls: 'sg-dash-heatmap-grid' });

		for (let i = 29; i >= 0; i--) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			const k = dayKey(d);
			const words = history[k] ?? 0;

			let level = 0;
			if (words > 0) {
				if (dailyGoal > 0) {
					level = words >= dailyGoal ? 3 : words >= dailyGoal * 0.5 ? 2 : 1;
				} else {
					level = 1;
				}
			}

			const cell = grid.createDiv({ cls: `sg-dash-heatmap-cell sg-dash-heatmap-cell--l${level}` });
			const label = i === 0 ? t('dashboard.heatmap.today') : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
			cell.setAttr('aria-label', words > 0 ? t('dashboard.heatmap.cellAriaWithWords', { label, words: words.toLocaleString() }) : label);
			cell.title = cell.getAttribute('aria-label') ?? '';
		}
	}

	// ── Footer ────────────────────────────────────────────────────────────────

	private renderFooter(
		parent: HTMLElement,
		project: StoryProject,
		manuscript: { words: number; docs: number }
	): void {
		const footer = parent.createDiv({ cls: 'sg-dash-footer' });

		const statsWrap = footer.createDiv({ cls: 'sg-dash-footer-stats' });
		const addStat = (value: string, label: string) => {
			const s = statsWrap.createDiv({ cls: 'sg-dash-footer-stat' });
			s.createSpan({ cls: 'sg-dash-footer-stat-value', text: value });
			s.createSpan({ cls: 'sg-dash-footer-stat-label', text: ' ' + label });
		};
		addStat(manuscript.words.toLocaleString(), t('dashboard.footer.manuscriptWords'));
		addStat(String(manuscript.docs), t('dashboard.footer.sceneDoc', { s: manuscript.docs === 1 ? '' : 's' }));
		addStat(String(project.gridFiles.length), t('dashboard.footer.grid', { s: project.gridFiles.length === 1 ? '' : 's' }));

		const recentGrid = [...project.gridFiles].sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
		if (recentGrid) {
			const compileBtn = footer.createEl('button', { cls: 'sg-dash-compile-btn' });
			setPhosphorIcon(compileBtn.createSpan({ cls: 'sg-dash-compile-icon' }), 'book-bookmark', '📖');
			compileBtn.createSpan({ text: t('dashboard.footer.compileManuscript') });
			compileBtn.addEventListener('click', () => void this.plugin.openOutlineCompile(recentGrid.path));
		}
	}

	// ── To-dos ───────────────────────────────────────────────────────────────

	private renderTodos(parent: HTMLElement, project: StoryProject, dash: DashboardSettings): void {
		const sec = parent.createDiv({ cls: 'sg-dash-section' });
		const todos = (dash.todos[project.rootPath] ??= []);
		this._taskList.render({
			container: sec,
			todos,
			save: () => {
				this.quietSave();
				plotverkEvents.dispatchEvent(new CustomEvent('storygrid:tasks-changed', { detail: 'dashboard' }));
			},
			rerender: () => void this.render(),
			compact: false,
			app: this.app,
			sortByUrgency: this.plugin.settings.taskDefaultSort !== 'manual',
			showCompleted: this.plugin.settings.taskShowCompleted !== false,
			subtaskRollup: this.plugin.settings.taskSubtaskRollup !== false,
			onSwitchToManualSort: () => {
				this.plugin.settings.taskDefaultSort = 'manual';
				void this.plugin.saveSettings();
			},
		});
	}

	// ── Who's gone quiet (book-wide; the Writers Panel coach is this scene only) ──

	/**
	 * Characters who were in the story and have been missing from the last few
	 * scenes, in the Writing tab's scene order. Only "absent" notes: a note
	 * about one scene belongs nowhere near a book-wide list.
	 */
	private renderQuiet(parent: HTMLElement, project: StoryProject, dash: DashboardSettings): void {
		if (!canUse('prose-coach')) return;
		const root = project.rootPath;
		const ordered = this.orderedScenePaths(project, dash);
		const entities = this.plugin.entityIndex.list(root, 'character');
		const characters = entities.map((e) => ({ path: e.file.path, name: e.name }));
		// The project's other Codex names (places, factions, items…), so "Crane Yard"
		// is the yard and never Halvard Crane. Not events: their titles are sentences
		// about characters ("Pike Sells the Dive Date") and would swallow them.
		const inProject = (p: string) => !root || p.startsWith(`${root}/`);
		const skip = new Set(['character', 'scene', 'event', 'research']);
		const otherNames = this.plugin.entityIndex.getAllEntities()
			.filter((e) => !skip.has(e.kind) && inProject(e.file.path))
			.flatMap((e) => this.plugin.codexNamesOf(e));
		const patterns = buildNamePatterns(
			entities.map((e) => ({ path: e.file.path, names: this.plugin.codexNamesOf(e) })),
			otherNames
		);

		const sec = this.section(parent, 'user-minus', t('dashboard.quiet.title'), t('dashboard.quiet.why'));
		void (async () => {
			// In a scene = a link to their sheet, or their name in the scene text
			// (full name, alias, or a name part only they have — see buildNamePatterns).
			// Per scene the larger of the two counts: a linked name is one mention, not two.
			const links = this.app.metadataCache.resolvedLinks;
			const readScene = async (path: string) => {
				const counts: Record<string, number> = { ...(links[path] ?? {}) };
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					try {
						const named = countNameMentions(await this.app.vault.cachedRead(file), patterns);
						for (const [p, n] of Object.entries(named)) counts[p] = Math.max(counts[p] ?? 0, n);
					} catch {
						// Unreadable scene: its links still count.
					}
				}
				return { path, links: counts };
			};
			// Small parallel batches; stop as soon as the Dashboard has re-rendered.
			const scenes: Array<{ path: string; links: Record<string, number> }> = [];
			for (let i = 0; i < ordered.length; i += 8) {
				if (!sec.isConnected) return;
				scenes.push(...await Promise.all(ordered.slice(i, i + 8).map(readScene)));
			}
			if (!sec.isConnected) return; // the Dashboard re-rendered meanwhile
			// Too few scenes, or nobody named often enough yet: say so, never "everyone's here".
			const total = (p: string) => scenes.reduce((sum, s) => sum + (s.links[p] ?? 0), 0);
			if (scenes.length < 4 || !characters.some((c) => total(c.path) >= 3)) {
				sec.createDiv({ cls: 'sg-dash-quiet-none', text: t('dashboard.quiet.tooEarly') });
				return;
			}
			// "Leave them out" redraws this list only — the scenes are already read.
			const body = sec.createDiv({ cls: 'sg-dash-quiet-body' });
			const draw = () => {
				body.empty();
				const leftOut = new Set(ensureDashboard(this.plugin.settings).quietLeftOut?.[root] ?? []);
				// Only characters still in the project count towards "N left out".
				const hidden = characters.filter((c) => leftOut.has(c.path)).length;
				const notes = computePresenceNotes(scenes, characters.filter((c) => !leftOut.has(c.path)))
					.filter((n) => n.kind === 'absent-streak');
				if (notes.length === 0) body.createDiv({ cls: 'sg-dash-quiet-none', text: t('dashboard.quiet.none') });
				for (const n of notes) {
					const row = body.createDiv({ cls: 'sg-dash-quiet-row' });
					row.createDiv({ cls: 'sg-dash-quiet-note', text: t('dashboard.quiet.note', { name: n.characterName, count: String(n.streak ?? 0) }) });
					const btn = row.createEl('button', { cls: 'sg-dash-quiet-leave' });
					setPhosphorIcon(btn.createSpan({ cls: 'sg-dash-quiet-leave-icon' }), 'eye-slash', '×');
					btn.createSpan({ text: t('dashboard.quiet.leaveOut') });
					btn.setAttribute('aria-label', t('dashboard.quiet.leaveOutAria', { name: n.characterName }));
					btn.addEventListener('click', () => {
						const list = ((ensureDashboard(this.plugin.settings).quietLeftOut ??= {})[root] ??= []);
						if (!list.includes(n.characterPath)) list.push(n.characterPath);
						this.quietSave();
						draw();
					});
				}
				if (hidden > 0) {
					const undo = body.createDiv({ cls: 'sg-dash-quiet-undo' });
					undo.createSpan({ text: t('dashboard.quiet.leftOut', { count: String(hidden) }) });
					undo.createSpan({ text: ' · ' });
					const again = undo.createEl('button', { cls: 'sg-dash-quiet-again', text: t('dashboard.quiet.showAgain') });
					again.addEventListener('click', () => {
						delete ensureDashboard(this.plugin.settings).quietLeftOut?.[root];
						this.quietSave();
						draw();
					});
				}
			};
			draw();
		})().catch(() => {
			if (sec.isConnected) sec.createDiv({ cls: 'sg-dash-quiet-none', text: t('dashboard.quiet.failed') });
		});
	}

	/** The project's scenes in the Writing tab's (manuscript) order. */
	private orderedScenePaths(project: StoryProject, dash: DashboardSettings): string[] {
		const root = project.rootPath;
		const scenesPrefix = root ? `${root}/Scenes/` : 'Scenes/';
		const docs = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(scenesPrefix)).map((f) => f.path);
		const ordered: string[] = [];
		const walk = (nodes: SceneTreeNode[]) => {
			for (const n of nodes) {
				if (n.kind === 'doc' && n.docPath) ordered.push(n.docPath);
				walk(n.children);
			}
		};
		walk(resolveSceneTree(dash.sceneTree?.[root], dash.sceneOrder?.[root], docs));
		return ordered;
	}

	/**
	 * Reads scenes in small parallel batches. Returns null as soon as `sec` has
	 * left the page (the Dashboard re-rendered meanwhile). An unreadable scene
	 * is skipped.
	 */
	private async readSceneTexts(paths: readonly string[], sec: HTMLElement): Promise<Array<{ path: string; label: string; text: string }> | null> {
		const out: Array<{ path: string; label: string; text: string }> = [];
		for (let i = 0; i < paths.length; i += 8) {
			if (!sec.isConnected) return null;
			const batch = await Promise.all(paths.slice(i, i + 8).map(async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) return null;
				try {
					return { path, label: file.basename, text: await this.app.vault.cachedRead(file) };
				} catch {
					return null;
				}
			}));
			for (const b of batch) if (b) out.push(b);
		}
		return sec.isConnected ? out : null;
	}

	// ── Crutch words across the book (Pro; English text) ───────────────────────

	/** The writer's most-used crutch words and clichés over the whole book, with counts per chapter. */
	private renderHabits(parent: HTMLElement, project: StoryProject, dash: DashboardSettings): void {
		if (!canUse('prose-coach')) return;
		const sec = this.section(parent, 'repeat', t('dashboard.habits.title'), t('dashboard.habits.why'));
		const ordered = this.orderedScenePaths(project, dash);
		void (async () => {
			const scenes = await this.readSceneTexts(ordered, sec);
			if (!scenes) return;
			if (scenes.length === 0) { sec.createDiv({ cls: 'sg-dash-quiet-none', text: t('dashboard.habits.noScenes') }); return; }
			const s = this.plugin.settings.proseCoach;
			const result = crutchHabits(
				scenes.map((x) => ({ label: x.label, text: x.text, dismissed: dismissedFor(s, x.path) })),
				{ ignore: this.plugin.coachIgnoreSet(), neverPhrases: this.plugin.coachNeverPhrases() }
			);
			if (result.englishScenes === 0) { sec.createDiv({ cls: 'sg-dash-quiet-none', text: t('dashboard.habits.englishOnly') }); return; }
			if (result.habits.length === 0) { sec.createDiv({ cls: 'sg-dash-quiet-none', text: t('dashboard.habits.none') }); return; }
			const body = sec.createDiv({ cls: 'sg-dash-habits' });
			const max = Math.max(1, ...result.habits.flatMap((h) => h.perScene));
			const draw = () => {
				body.empty();
				for (const h of result.habits) {
					const id = `${h.kind}:${h.key}`;
					const open = this._habitOpen.has(id);
					const row = body.createEl('button', { cls: 'sg-dash-habit' });
					row.setAttribute('aria-expanded', String(open));
					row.createSpan({ cls: 'sg-dash-habit-word', text: h.key });
					row.createSpan({ cls: 'sg-dash-habit-count', text: t('dashboard.habits.count', { count: String(h.total) }) });
					// One tick per chapter, height = uses there: where the habit bunches up, at a glance.
					const strip = row.createSpan({ cls: 'sg-dash-habit-strip', attr: { 'aria-hidden': 'true' } });
					for (const n of h.perScene) {
						const tick = strip.createSpan({ cls: 'sg-dash-habit-tick' });
						tick.style.height = n > 0 ? `${Math.max(15, Math.round((n / max) * 100))}%` : '0';
					}
					setPhosphorIcon(row.createSpan({ cls: 'sg-dash-habit-chev' }), open ? 'caret-up' : 'caret-down', open ? '▴' : '▾');
					row.addEventListener('click', () => {
						if (this._habitOpen.has(id)) this._habitOpen.delete(id);
						else this._habitOpen.add(id);
						draw();
					});
					if (!open) continue;
					const list = body.createDiv({ cls: 'sg-dash-habit-detail' });
					h.perScene.forEach((n, i) => {
						if (n === 0) return;
						const line = list.createDiv({ cls: 'sg-dash-habit-line' });
						line.createSpan({ cls: 'sg-dash-habit-scene', text: scenes[i].label });
						line.createSpan({ cls: 'sg-dash-habit-n', text: String(n) });
					});
				}
			};
			draw();
		})().catch(() => {
			if (sec.isConnected) sec.createDiv({ cls: 'sg-dash-quiet-none', text: t('dashboard.quiet.failed') });
		});
	}

	// ── Pace across the book (Pro) ─────────────────────────────────────────────

	/** Dialogue / action / narration share per chapter, in manuscript order. */
	private renderPace(parent: HTMLElement, project: StoryProject, dash: DashboardSettings): void {
		if (!canUse('prose-coach')) return;
		const sec = this.section(parent, 'wave-sine', t('dashboard.pace.title'), t('dashboard.pace.why'));
		const ordered = this.orderedScenePaths(project, dash);
		void (async () => {
			const scenes = await this.readSceneTexts(ordered, sec);
			if (!scenes) return;
			const curve = paceCurve(scenes.map((x) => ({ label: x.label, text: x.text })));
			if (curve.rows.length === 0) { sec.createDiv({ cls: 'sg-dash-quiet-none', text: t('dashboard.pace.tooEarly') }); return; }
			const legend = sec.createDiv({ cls: 'sg-dash-pace-legend' });
			for (const [cls, key] of [['sg-dash-pace-talk', 'dashboard.pace.dialogue'], ['sg-dash-pace-act', 'dashboard.pace.action'], ['sg-dash-pace-told', 'dashboard.pace.narration']] as const) {
				const item = legend.createSpan({ cls: 'sg-dash-pace-key' });
				item.createSpan({ cls: `sg-dash-pace-swatch ${cls}` });
				item.createSpan({ text: t(key) });
			}
			const rows = sec.createDiv({ cls: 'sg-dash-pace-rows' });
			for (const r of curve.rows) {
				const c = r.counts;
				const talk = percent(c.dialogue, c.words);
				const act = percent(c.action, c.words);
				const told = Math.max(0, 100 - talk - act);
				const row = rows.createDiv({ cls: 'sg-dash-pace-row' });
				row.createSpan({ cls: 'sg-dash-pace-label', text: r.label });
				const bar = row.createDiv({
					cls: 'sg-dash-pace-bar',
					attr: { role: 'img', 'aria-label': t('dashboard.pace.rowAria', { label: r.label, talk: String(talk), act: String(act), told: String(told) }) },
				});
				bar.createDiv({ cls: 'sg-dash-pace-talk' }).style.width = `${talk}%`;
				bar.createDiv({ cls: 'sg-dash-pace-act' }).style.width = `${act}%`;
				bar.createDiv({ cls: 'sg-dash-pace-told' }).style.width = `${told}%`;
				row.createSpan({ cls: 'sg-dash-pace-pct', text: t('dashboard.pace.talkPct', { pct: String(talk) }) });
			}
			if (curve.short > 0) sec.createDiv({ cls: 'sg-dash-pace-note', text: t('dashboard.pace.short', { count: String(curve.short) }) });
			if (curve.rows.some((r) => !r.english)) sec.createDiv({ cls: 'sg-dash-pace-note', text: t('dashboard.pace.englishOnly') });
		})().catch(() => {
			if (sec.isConnected) sec.createDiv({ cls: 'sg-dash-quiet-none', text: t('dashboard.quiet.failed') });
		});
	}

	// ── Character balance ────────────────────────────────────────────────────

	private renderBalance(parent: HTMLElement, balance: CharacterBalance[]): void {
		const sec = this.section(parent, 'user', t('dashboard.balance.title'),
			t('dashboard.balance.hint'));
		if (balance.length === 0) {
			const ghostRows: Array<[string, number]> = [['Elena', 14], ['Marcus', 9], ['Theo', 5]];
			const ghostWrap = sec.createDiv({ cls: 'sg-ghost' });
			const max = ghostRows[0][1];
			const ghostTotal = ghostRows.reduce((sum, [, count]) => sum + count, 0);
			for (const [name, count] of ghostRows) {
				const row = ghostWrap.createDiv({ cls: 'sg-dash-balance' });
				row.createSpan({ cls: 'sg-dash-balance-name', text: name });
				const bar = row.createDiv({ cls: 'sg-dash-bar sg-dash-balance-bar' });
				const fill = bar.createDiv({ cls: 'sg-dash-bar-fill' });
				fill.style.width = `${Math.round((count / max) * 100)}%`;
				row.createSpan({ cls: 'sg-dash-balance-count', text: String(count) });
				row.createSpan({ cls: 'sg-dash-balance-pct', text: `${Math.round((count / ghostTotal) * 100)}%` });
			}
			const note = sec.createDiv({ cls: 'sg-dash-muted' });
			note.createSpan({ text: t('dashboard.balance.ghostNote1') });
			note.createEl('code', { text: '[[Character Name]]' });
			note.createSpan({ text: t('dashboard.balance.ghostNote2') });
			return;
		}
		const max = balance[0].appearances;
		const total = balance.reduce((sum, entry) => sum + entry.appearances, 0);
		for (const entry of balance.slice(0, 14)) {
			const row = sec.createDiv({ cls: 'sg-dash-balance' });
			row.createSpan({ cls: 'sg-dash-balance-name', text: entry.name });
			const bar = row.createDiv({ cls: 'sg-dash-bar sg-dash-balance-bar' });
			const fill = bar.createDiv({ cls: 'sg-dash-bar-fill' });
			fill.style.width = `${Math.max(4, Math.round((entry.appearances / max) * 100))}%`;
			let hash = 0;
			for (let i = 0; i < entry.name.length; i++) hash = (hash * 31 + entry.name.charCodeAt(i)) | 0;
			fill.style.background = `hsl(${Math.abs(hash) % 360}, 55%, 52%)`;
			row.createSpan({ cls: 'sg-dash-balance-count', text: String(entry.appearances) });
			row.createSpan({ cls: 'sg-dash-balance-pct', text: `${Math.round((entry.appearances / total) * 100)}%` });
		}
	}

	// ── Status pipeline ──────────────────────────────────────────────────────

	private renderStatuses(parent: HTMLElement, cards: SceneCard[]): void {
		const sec = this.section(parent, 'film-script', t('dashboard.statuses.title'));
		if (cards.length === 0) {
			sec.createDiv({ cls: 'sg-dash-muted', text: t('dashboard.statuses.emptyHint') });
			return;
		}
		const counts = summarizeStatuses(cards);
		const colors = this.plugin.settings.statusColors;

		const track = sec.createDiv({ cls: 'sg-dash-status-track' });
		for (const status of STATUS_ORDER) {
			if (counts[status] === 0) continue;
			const seg = track.createDiv({ cls: 'sg-dash-status-seg' });
			seg.style.flexGrow = String(counts[status]);
			seg.style.background = colors[status] ?? 'var(--sg-status-dot)';
			seg.setAttr('aria-label', t('dashboard.statuses.trackAria', { label: t(STATUS_LABEL_KEYS[status]), count: counts[status] }));
		}

		const legend = sec.createDiv({ cls: 'sg-dash-status-legend' });
		for (const status of STATUS_ORDER) {
			const item = legend.createDiv({ cls: 'sg-dash-status-item' });
			const dot = item.createSpan({ cls: 'sg-dash-status-dot' });
			dot.style.background = colors[status] ?? 'var(--sg-status-dot)';
			item.createSpan({ text: t('dashboard.statuses.legendItem', { label: t(STATUS_LABEL_KEYS[status]), count: counts[status] }) });
		}
	}
}
