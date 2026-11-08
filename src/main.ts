import { Plugin, WorkspaceLeaf, TFile, TFolder, TAbstractFile, Notice, setIcon, addIcon, Menu, FuzzySuggestModal, FuzzyMatch, MarkdownView, App, Platform, editorInfoField } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { openOrReveal } from './utils/workspace';
import { Extension } from '@codemirror/state';
import { typewriterScroll, focusDimming } from './utils/typewriter';
import { coachHighlights, coachChangeNotifier, coachRefreshEffect, CoachScanContext } from './prose/coach-extension';
import { resolveEngineFlags, dismissalKey, neverKeyFor } from './prose/counts';
import {
	migrateProseCoach, renameDismissedPaths, resolveCoachMode, noteIsRevising, dismissInScene, dismissedFor, addNeverWord,
	forgetDismissedPath,
} from './prose/coach-settings';
import { CoachCard } from './prose/coach-card';
import { resolveProFlags } from './prose/pro';
import { buildIgnoreSet } from './prose/tokenize';
import { ProseFinding } from './prose/types';
import { canUse } from './entitlements/entitlements';
import { StorygridView, VIEW_TYPE_STORYGRID } from './grid-view';
import { StorygridCodexView, VIEW_TYPE_CODEX } from './codex-view';
import { StorygridOutlineView, VIEW_TYPE_OUTLINE } from './outline-view';
import { WelcomeView, VIEW_TYPE_WELCOME } from './welcome-view';
import { IntentView, VIEW_TYPE_INTENT } from './intent-view';
import { StorygridDashboardView, VIEW_TYPE_DASHBOARD, ensureDashboard } from './dashboard-view';
import { liveViews, loadedView, leafStateString } from './utils/live-views';
import { writeProjectMirror, syncProjectMirrors, scheduleProjectMirror, flushProjectMirrors } from './utils/project-data-store';
import { loadSampleStory } from './sample/load-sample';
import { isSafetyNetPath, wasSafetyNetPath } from './utils/safety-paths';
import { migrateSafetyFolders } from './utils/safety-folder';
import { collectDocPaths, renameDocPath } from './utils/scene-tree';
import { ensureDailySnapshot, snapshotProjectNow } from './utils/scene-snapshots';
import { countWords, dayKey, startOfWeek } from './utils/stats';
import { findProjects, findCodexScopes, projectRootFromGridPath, entityFolderPath, StoryProject } from './entities/entity-manager';
import { StorygridRelGraphView, VIEW_TYPE_REL_GRAPH } from './rel-graph-view';
import { StorygridStoryTreeView, VIEW_TYPE_STORY_TREE } from './story-tree-view';
import { SocialMapsView, VIEW_TYPE_SOCIAL_MAPS, SocialMapsTab } from './social-maps-view';
import { StorygridHistoryView, VIEW_TYPE_HISTORY } from './history-view';
import { TimelineView, VIEW_TYPE_TIMELINE } from './timeline/timeline-view';
import { createEmptyTimeline } from './timeline/timeline-data';
import { GREGORIAN_CALENDAR } from './timeline/calendar';
import { EntityIndex } from './entities/entity-index-store';
import { configureSheetImages, followSheetRename, shouldFollowRename } from './entities/sheet-images';
import { ReferenceIndex } from './refs/reference-index';
import { scopeToBook } from './refs/project-scope';
import { getCodexKindOrder, hasKind, registeredKinds, initKindRegistry } from './entities/entity-kinds';
import { parseEntityDocument } from './entities/entity-parse';
import { t } from './i18n';
import { updateEntitySheet } from './entities/entity-write';
import { ConfirmModal } from './modals/prompt-modal';
import { StorygridSettings, QuickLinkKey, GridData, createEmptyGrid, applyTemplate, generateId, generateEntityId } from './grid-data';
import { migrateLegacyWorkflow } from './utils/compile';
import { isModuleEnabled, migrateEnabledModules, LEGACY_INTENT_MAP, type ModuleId, type IntentId } from './modules';
import { StorygridSettingsTab } from './settings/settings-tab';
import { NewGridModal } from './modals/new-grid-modal';
import { registerEntityModalPlugin } from './modals/entity-modal';
import { GridScopeModal, wizardText } from './modals/grid-scope-modal';
import { GridPickerModal } from './modals/grid-picker-modal';
import { getTemplateById } from './templates/story-templates';
import { buildProjectStructure } from './utils/folder-builder';
import { showTypewriterPopover } from './utils/tw-popover';
import { toggleWriteMode } from './utils/writing-modes';
import { showSprintSummary, openSprintSetup } from './modals/sprint-modal';
import { TextPromptModal } from './modals/prompt-modal';
import { PLANET_SVG, STORYGRID_MARK_SVG, NOTE_PENCIL_SVG, GLOBE_SVG, SQUARES_FOUR_SVG, PEN_NIB_SVG, CHART_BAR_SVG, GRAPH_SVG, setPhosphorIcon, CONNECTIONS_MAP_ICON, DASHBOARD_ICON, GRID_VIEW_ICON, CODEX_ICON, TIMELINE_ICON, TIMELINE_SVG } from './utils/icons';
import { CodexSuggest } from './editor/codex-suggest';
import { registerScanCommand } from './commands/scan-mentions';
import { showCoachMark } from './ui/coach-mark';
import { registerEntityHover } from './ui/entity-popover';
import { registerLinkSelectionCommand } from './commands/link-selection';
import { registerEntityLinkInterceptor } from './ui/entity-link-interceptor';
import { registerCodexClickInterceptor } from './ui/codex-click-interceptor';
import { setEntitlementState, FEATURE_TIERS, type FeatureId } from './entitlements/entitlements';
import { PUBLIC_BUILD } from './build-flags';
import { launchConfetti } from './ui/confetti';
import { DEFAULT_SETTINGS } from './default-settings';
import { mergeSettings } from './utils/settings-merge';
import { RelationSync } from './relation-sync';
import { resetFirstTimeTips } from './utils/first-time-tips';

export default class StorygridPlugin extends Plugin {
	settings: StorygridSettings = mergeSettings(DEFAULT_SETTINGS, null);
	/** Shared in-memory entity index (built off metadataCache, patched on events). */
	entityIndex!: EntityIndex;
	/** Reference index: entity MatchableEntity list + bidirectional wikilink map. */
	referenceIndex!: ReferenceIndex;
	/** Keeps relationship lines two-sided when sheets change outside the sheet editor. */
	relationSync!: RelationSync;
	lastProjectPaths: { charactersPath: string; scenesPath: string; locationsPath: string } | null = null;
	/** Set by the Welcome page's "Start your first project" when the author question is still unanswered:
	 *  the chooser then goes on to the novel-or-series box instead of its usual landing. Transient. */
	startProjectAfterIntent = false;
	/** Grids created this session whose "how the grid works" tips have not run yet (every new project gets them once). Transient. */
	newGridTourPaths = new Set<string>();
	/** True while a new grid's tips are on screen: every other tip waits, then follows (see endGridTour). */
	gridTourActive = false;

	/** In-memory only (not persisted): coach-mark ids currently on screen, so a re-render can't fire a duplicate before the first is dismissed. See `canShowCoachMark`. */
	private _coachMarkPending = new Set<string>();
	// Mutable container registered once with registerEditorExtension; its
	// contents are swapped on toggle and applied via workspace.updateOptions()
	private typewriterExtensions: Extension[] = [];
	// Same mutable-array-plus-updateOptions() pattern as typewriterExtensions,
	// for the Prose Style Coach's live editor highlights.
	private coachExtensions: Extension[] = [];
	/** The explain card a coach mark opens (one at a time, app-wide). */
	private coachCard: CoachCard | null = null;
	/** Codex names + aliases + "never" list. Null = rebuild on next use. */
	private _coachIgnore: Set<string> | null = null;
	/** Codex names + aliases as written, for the Pro name-spelling check (cleared with _coachIgnore). */
	private _coachNames: Array<{ path: string; kind: string; names: string[] }> | null = null;
	private _coachRefreshTimer: number | null = null;
	/** Last seen frontmatter status per note, so only a real status change re-reads editors. */
	private _coachStatusSeen = new Map<string, string>();
	/** Status-bar chip "Coach: Off / While revising / Always" (desktop only). */
	private coachStatusEl: HTMLElement | null = null;
	private typewriterStatusEl: HTMLElement | null = null;
	private typewriterRibbonEl: HTMLElement | null = null;
	private _leafHeaderBtn: HTMLElement | null = null;
	private _focusHudEl: HTMLElement | null = null;
	private _sidebarTabBtns: HTMLElement[] = [];
	private modeStatusEl: HTMLElement | null = null;
	private wordCountStatusEl: HTMLElement | null = null;
	private sprintEl: HTMLElement | null = null;
	private sprintStartAt: number | null = null;
	private sprintDurationMs: number = 0;
	private sprintStartWords: number = 0;
	private sprintLastMinutes: number = 25;
	private sprintWordGoal: number = 0;
	/** Set when a sprint completes — lets the banner show inline success state. */
	private sprintCompletionData: { wordsWritten: number; elapsedMs: number } | null = null;
	private sprintInterval: number | null = null;
	private _activeFilePath: string | null = null;
	/** Last applied extension state — skip the expensive editor reconfigure when unchanged */
	private _twLastKey: string | null = null;
	/** filePath → last seen word count, for typed-word delta tracking */
	private wordBaselines: Map<string, number> = new Map();
	private typedWordsTimer: number | null = null;
	private wordCountTimer: number | null = null;
	private pendingTypedFile: { path: string; root: string; text: string } | null = null;
	/** `${scenePath}|${localDay}` keys already checked for a daily snapshot this session. */
	private seenDailySnapshots: Set<string> = new Set();
	private pendingWordCountUpdate: { text: string; filePath: string } | null = null;
	/** filePath → cached word count for all scene files. Built at startup, kept fresh via metadataCache events. */
	manuscriptWordCache: Map<string, number> = new Map();

	/** Whether an optional module should show its menu items, commands, and startup behavior. */
	isModuleOn(id: ModuleId): boolean {
		return isModuleEnabled(this.settings.enabledModules, id, this.settings.intent ?? null, this.settings.writingStyle ?? null);
	}

	/** Quick-link on/off: an explicit settings flip wins; otherwise follow the link's module. */
	quickLinkOn(key: QuickLinkKey): boolean {
		const explicit = this.settings.writersPanelActions?.[key];
		if (explicit !== undefined) return explicit;
		const moduleFor: Partial<Record<QuickLinkKey, ModuleId>> = {
			codex: 'codex', grid: 'plotGrid', connectionsMap: 'socialMaps', timeline: 'timeline',
		};
		const mod = moduleFor[key];
		return mod ? this.isModuleOn(mod) : true; // dashboard: always on by default
	}

	/** Whether a quick-link icon shows in the given surface ('top' strip / 'panel' header). */
	quickLinkVisible(key: QuickLinkKey, where: 'top' | 'panel'): boolean {
		if (!this.quickLinkOn(key)) return false;
		// Default 'panel', NOT 'both' (Emma, 2026-09-06): the sidebar tab strip
		// holds the Writers Panel tab and nothing else unless the user puts
		// something there themselves. Defaulting to 'both' meant a fresh vault —
		// where every module is on because no intent has been chosen — opened
		// with five injected icons crowding the tab bar.
		const placement = this.settings.quickLinkPlacement?.[key] ?? 'panel';
		return placement === 'both' || placement === where;
	}

	/**
	 * Render the standard quick-launch icon row (Connections Map / Dashboard / Grid / Codex) —
	 * same icons, same order, same visibility rules — into a view header. Used identically by
	 * the Codex, Writers Panel, and Dashboard headers so no view can drift out of sync with the
	 * others or with Settings → Quick-links. Pass `gridFile` when the caller already knows which
	 * grid belongs to the current project; omitted, it falls back to resolving the active book
	 * (or the picker).
	 */
	renderQuickLaunchRow(container: HTMLElement, where: 'top' | 'panel', gridFile?: TFile): void {
		const show = (key: QuickLinkKey) => this.quickLinkVisible(key, where);
		const defs: Array<{ key: QuickLinkKey; icon: string; fallback: string; label: string; onClick: () => void }> = [
			{ key: 'connectionsMap', icon: CONNECTIONS_MAP_ICON, fallback: '⬡', label: 'Open Social Maps', onClick: () => void this.openSocialMaps() },
			{ key: 'dashboard', icon: DASHBOARD_ICON, fallback: '▦', label: 'Open Dashboard', onClick: () => void this.openDashboard() },
			{ key: 'grid', icon: GRID_VIEW_ICON, fallback: '▦', label: 'Open Plot Grid', onClick: () => gridFile ? void this.openGridFile(gridFile) : void this._openCurrentGrid() },
			{ key: 'codex', icon: CODEX_ICON, fallback: '◎', label: 'Open Codex', onClick: () => void this.openCodex() },
			{ key: 'timeline', icon: TIMELINE_ICON, fallback: '📅', label: 'Open Timeline', onClick: () => void this.openOrCreateTimeline() },
		];
		let shown = 0;
		let firstBtn: HTMLElement | null = null;
		for (const def of defs) {
			if (!show(def.key)) continue;
			const btn = container.createEl('button', { cls: 'sg-quicklaunch-btn' });
			setPhosphorIcon(btn, def.icon, def.fallback);
			btn.setAttribute('aria-label', def.label);
			btn.setAttribute('title', def.label);
			btn.addEventListener('click', def.onClick);
			if (!firstBtn) firstBtn = btn;
			shown++;
		}
		// One-time nudge, the first time this row appears anywhere.
		if (firstBtn && this.canShowCoachMark('quicklaunch-row-intro')) {
			const anchor = firstBtn;
			requestAnimationFrame(() => {
				showCoachMark(anchor, t('quickLaunch.coachMark'), {
					placement: 'bottom',
					onDismiss: () => this.markCoachMarkSeen('quicklaunch-row-intro'),
					onHide: () => this.releasePendingCoachMark('quicklaunch-row-intro'),
				});
			});
		}
	}

	/**
	 * Fire-once toast for a first-time milestone (first card, first sheet,
	 * first relation, first compile). White-hat only, by design: a single
	 * warm one-liner, no points, no streaks, no repeat nagging.
	 */
	celebrateMilestone(id: string, message: string): void {
		if (this.settings.milestonesSeen?.[id]) return;
		this.settings.milestonesSeen = { ...this.settings.milestonesSeen, [id]: true };
		void this.saveSettings();
		new Notice(message, 6000);
	}

	/** Whether a given coach-mark callout has already been shown (fire-once, separate from milestone toasts). */
	hasSeenCoachMark(id: string): boolean {
		return !!this.settings.coachMarksSeen?.[id];
	}

	/**
	 * Returns true if this coach mark is allowed to appear right now: not yet
	 * seen, and not already floating on screen from an earlier render this
	 * session. Call this instead of `hasSeenCoachMark` when deciding whether to
	 * show one — it also claims the id so a re-render can't fire a duplicate
	 * copy before the first one is dismissed.
	 */
	canShowCoachMark(id: string): boolean {
		if (this.gridTourActive) return false; // a new grid's tips go first; the rest follow after endGridTour()
		if (this.hasSeenCoachMark(id) || this._coachMarkPending.has(id)) return false;
		this._coachMarkPending.add(id);
		return true;
	}

	/**
	 * Marks a coach-mark callout as permanently shown so it never fires again.
	 * Call this from the callout's own dismiss/done callback (Got it / Skip /
	 * Escape) — never before showing it, or a user who never actually saw or
	 * closed it (e.g. the view closed, or Obsidian restarted mid-callout) would
	 * lose it for good without ever having dismissed it.
	 */
	/** A new grid's tips are done (or closed): let the waiting tips follow — the Writers Panel re-renders so its own tip can show. */
	endGridTour(): void {
		if (!this.gridTourActive) return;
		this.gridTourActive = false;
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE)) {
			const view = leaf.view;
			if (view instanceof StorygridOutlineView) void view.renderAll();
		}
	}

	markCoachMarkSeen(id: string): void {
		this._coachMarkPending.delete(id);
		if (this.settings.coachMarksSeen?.[id]) return;
		this.settings.coachMarksSeen = { ...this.settings.coachMarksSeen, [id]: true };
		void this.saveSettings();
	}

	/**
	 * Releases the pending guard on a coach mark WITHOUT marking it seen —
	 * call this when a callout auto-closes because its anchor went invisible
	 * (the user navigated away), not because they actually dismissed it. This
	 * lets it appear again next time its view is visible, instead of being
	 * silently blocked for the rest of the session by `canShowCoachMark`.
	 */
	releasePendingCoachMark(id: string): void {
		this._coachMarkPending.delete(id);
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		// Every sheet pop-up remembers "template or clean slate" through this.
		registerEntityModalPlugin(this);
		this.sprintLastMinutes = this.getDefaultSprintMinutes();
		this.applyCodexSheetClasses();
		document.body.addClass('sg-plugin-active');

		// v1: all features enabled locally; no server validation yet.
		// When payment is wired up, replace enabledFeatures with the server response.
		setEntitlementState({
			licenseKey: this.settings.licenseKey ?? null,
			isValid: false,
			// The public release has no Pro yet (its Pro engines are empty stand-ins).
			enabledFeatures: PUBLIC_BUILD ? new Set<FeatureId>() : new Set<FeatureId>(Object.keys(FEATURE_TIERS) as FeatureId[]),
		});

		// Shared entity index — built once the vault metadata is ready, then kept
		// fresh incrementally so Codex/Dashboard reads never rescan the vault.
		this.entityIndex = new EntityIndex(this.app);
		// Supply series roots so entities stored at the series level (shared Codex)
		// are indexed even when the series folder contains no .storygrid file itself.
		this.entityIndex.setExtraRoots(() =>
			Object.values(this.settings.seriesRegistry ?? {}).map((s) => s.rootPath)
		);
		// Every picture import and the sheet-follows-folder rule read these live.
		configureSheetImages({
			location: () => this.settings.codexImageLocation ?? 'per-sheet',
			folderName: () => this.settings.codexImagesFolderName ?? 'Images',
			rootFor: (path) => this.entityIndex.rootFor(path),
		});
		this.referenceIndex = new ReferenceIndex(this.app, this.entityIndex);
		this.relationSync = new RelationSync(this);
		this.app.workspace.onLayoutReady(() => {
			void this.pruneDeadSeries();
			this.entityIndex.rebuild();
			// Codex names are known now: re-read open editors so names are never marked.
			this.refreshCoachMode();
			this.relationSync.start();
			this.referenceIndex.rebuild();
			void this.buildManuscriptWordCache();
			void this.stampMissingEntityIds();
			void this.syncProjectDataMirrors();
		});
		// Safety-folder writes (backups, snapshots, the data copy) are Plotverk's own
		// bookkeeping: none of them is an entity, a scene or a grid, so skip the indexes.
		this.registerEvent(this.app.vault.on('create', (f) => {
			if (isSafetyNetPath(f.path)) return;
			this.entityIndex.handleCreate(f);
			this._coachIgnore = null;
			this._coachNames = null;
		}));
		this.registerEvent(this.app.vault.on('delete', (f) => {
			if (isSafetyNetPath(f.path)) return;
			this.entityIndex.handleDelete(f);
			this.referenceIndex.handleDelete(f);
			this._coachIgnore = null;
			this._coachNames = null;
			if (this.settings.proseCoach && forgetDismissedPath(this.settings.proseCoach, f.path)) void this.saveSettingsQuiet();
			this.manuscriptWordCache.delete(f.path);
			void this.pruneDeletedProject(f.path);
		}));
		this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
			if (isSafetyNetPath(f.path) && (isSafetyNetPath(oldPath) || wasSafetyNetPath(oldPath))) return;
			this.entityIndex.handleRename(f, oldPath);
			this._coachIgnore = null;
			this._coachNames = null;
			this.referenceIndex.handleRename(f, oldPath);
			const prev = this.manuscriptWordCache.get(oldPath);
			this.manuscriptWordCache.delete(oldPath);
			if (prev !== undefined && this.isSceneFile(f.path)) {
				this.manuscriptWordCache.set(f.path, prev);
			}
		}));
		this.registerEvent(this.app.metadataCache.on('changed', (f) => {
			if (isSafetyNetPath(f.path)) return;
			this.entityIndex.handleChange(f);
			this.coachOnMetadataChanged(f);
			this.referenceIndex.handleChange(f);
			if (this.isSceneFile(f.path)) {
				void this.app.vault.cachedRead(f).then((text) => {
					this.manuscriptWordCache.set(f.path, countWords(text));
				});
			}
		}));

		if (this.settings.openDashboardOnStartup) {
			this.app.workspace.onLayoutReady(() => void this.openDashboard());
		}

		// Register the planet icon so Menu.addItem().setIcon('sg-planet') works
		addIcon('sg-planet', PLANET_SVG);
		addIcon('sg-storygrid', STORYGRID_MARK_SVG);
		addIcon('sg-note-pencil', NOTE_PENCIL_SVG);
		addIcon('sg-globe', GLOBE_SVG);
		addIcon('sg-squares-four', SQUARES_FOUR_SVG);
		addIcon('sg-pen-nib', PEN_NIB_SVG);
		addIcon('sg-chart-bar', CHART_BAR_SVG);
		addIcon('sg-graph', GRAPH_SVG);
		addIcon('sg-git-commit', TIMELINE_SVG);

		// Register the grid view and the .storygrid file extension
		this.registerView(VIEW_TYPE_STORYGRID, (leaf) => new StorygridView(leaf, this));
		this.registerExtensions(['storygrid'], VIEW_TYPE_STORYGRID);

		// Register the Codex view (worldbuilding hub)
		this.registerView(VIEW_TYPE_CODEX, (leaf) => new StorygridCodexView(leaf, this));

		// Register the Writers Panel sidebar panel (Longform-style scene navigator)
		this.registerView(VIEW_TYPE_OUTLINE, (leaf) => new StorygridOutlineView(leaf, this));

		// Register the welcome / quick-start guide
		this.registerView(VIEW_TYPE_WELCOME, (leaf) => new WelcomeView(leaf, this));

		// Register the first-launch intent chooser ("what will you use this for?")
		this.registerView(VIEW_TYPE_INTENT, (leaf) => new IntentView(leaf, this));

		// Register the Dashboard (progress, goals, to-dos, balance)
		this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new StorygridDashboardView(leaf, this));

		// Register the Relationship Graph (force-directed, colored/weighted edges, scoped per book/series)
		this.registerView(VIEW_TYPE_REL_GRAPH, (leaf) => new StorygridRelGraphView(leaf, this));

		// Register the Story Tree (layered family tree / faction hierarchy, focus + depth filtering)
		this.registerView(VIEW_TYPE_STORY_TREE, (leaf) => new StorygridStoryTreeView(leaf, this));

		// Register the Social Maps tabbed view (Connections Map + Story Tree merged)
		this.registerView(VIEW_TYPE_SOCIAL_MAPS, (leaf) => new SocialMapsView(leaf, this));

		// Register the Activity / History view
		this.registerView(VIEW_TYPE_HISTORY, (leaf) => new StorygridHistoryView(leaf, this));

		// Register the Story Timeline (plotline lanes, calendar-aware) and the .timeline file extension
		this.registerView(VIEW_TYPE_TIMELINE, (leaf) => new TimelineView(leaf, this));
		this.registerExtensions(['timeline'], VIEW_TYPE_TIMELINE);

		// One ribbon button for the whole plugin — everything else lives in
		// this hub menu (and in commands) so Plotverk doesn't sprawl across
		// Obsidian's ribbon.
		this.addRibbonIcon('book-open-text', 'Plotverk', (evt) => this.showHubMenu(evt));

		// Tag every open markdown view that shows an entity sheet with the
		// styling classes, based on frontmatter — so even documents created
		// before the sheet redesign get the polished look without a rewrite.
		const refreshSheetClasses = () => this.applySheetViewClasses();
		this.registerEvent(this.app.workspace.on('file-open', refreshSheetClasses));
		this.registerEvent(this.app.workspace.on('layout-change', refreshSheetClasses));
		// Obsidian rebuilds the sidebar tab strip on layout-change, wiping injected
		// nodes — re-inject the quick-launch icons whenever that happens.
		this.registerEvent(this.app.workspace.on('layout-change', () => this._injectSidebarTabButtons()));
		this.registerEvent(this.app.metadataCache.on('changed', refreshSheetClasses));
		this.app.workspace.onLayoutReady(refreshSheetClasses);

		// Typed-word tracking for dashboard goals (typing only, not pasting)
		// Also updates the live word count chip on every keystroke.
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, info) => {
				const file = info?.file ?? null;
				const text = editor.getValue();
				this.trackTypedWords(file, text);
				if (file?.extension === 'md') this.updateWordCountFromText(text, file.path);
			})
		);

		// Keep card → document links alive across renames, even when the grid
		// isn't open (open grids handle their own renames in StorygridView)
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (isSafetyNetPath(file.path) && (isSafetyNetPath(oldPath) || wasSafetyNetPath(oldPath))) return;
				void this.syncRenamedDocLinks(file, oldPath);
				void this.syncRenamedCompileState(file, oldPath);
				// Prose Coach "Not here" choices follow their scene (or its folder).
				if (this.settings.proseCoach && renameDismissedPaths(this.settings.proseCoach, oldPath, file.path)) {
					void this.saveSettings();
				}
				void this.followSheetImages(file, oldPath);
			})
		);

		// Typewriter mode is toggled from the hub menu, the status bar switch,
		// or the command — no dedicated ribbon icon anymore.

		// Typewriter mode — editor extension container, status bar switch, command
		this.registerEditorExtension(this.typewriterExtensions);
		this.coachCard = new CoachCard({
			isPro: () => canUse('prose-coach'),
			notHere: (view, f) => {
				const file = view.state.field(editorInfoField, false)?.file;
				if (file) void this.coachNotHere(file.path, f);
			},
			never: (f) => { void this.coachNever(f); },
		});
		this.coachExtensions.push(
			coachHighlights({
				contextFor: (view) => {
					const file = view.state.field(editorInfoField, false)?.file ?? null;
					if (!this.coachMarksOn(file, () => view.state.doc.toString())) return null;
					return this.coachScanOptions((file as TFile).path);
				},
				showCard: (view, f, group, rect, viaTap) => this.coachCard?.show(view, f, group, rect, viaTap),
				leaveMark: () => this.coachCard?.leaveMark(),
				isMobile: () => Platform.isMobile,
			}),
			coachChangeNotifier()
		);
		this.registerEditorExtension(this.coachExtensions);
		if (!Platform.isMobile) {
			this.coachStatusEl = this.addStatusBarItem();
			this.coachStatusEl.addClass('mod-clickable', 'sg-status-coach');
			this.coachStatusEl.setAttribute('aria-label', t('coach.statusChipAria'));
			this.registerDomEvent(this.coachStatusEl, 'click', (e) => this.showCoachModeMenu(e));
			this.updateCoachChip();
		}
		// A sprint switches marks off while it runs, and back on after.
		this.registerDomEvent(document, 'storygrid:sprint-changed' as keyof DocumentEventMap, () => this.refreshCoachMode());
		this.typewriterStatusEl = this.addStatusBarItem();
		this.typewriterStatusEl.addClass('sg-status-typewriter', 'mod-clickable');
		setIcon(this.typewriterStatusEl, 'keyboard');
		this.typewriterStatusEl.addEventListener('click', () => {
			if (this.typewriterStatusEl) showTypewriterPopover(this.typewriterStatusEl, this);
		});

		// Write-mode chip — sits next to the typewriter chip in the status bar.
		// A plain on/off toggle exactly like the typewriter chip's command, not
		// a menu (Plan/Review modes were removed — Write is the only one left).
		this.modeStatusEl = this.addStatusBarItem();
		this.modeStatusEl.addClass('sg-status-mode', 'mod-clickable');
		this.modeStatusEl.addEventListener('click', () => void toggleWriteMode(this));
		// Word count status bar chip — shows live word count of the open scene
		this.wordCountStatusEl = this.addStatusBarItem();
		this.wordCountStatusEl.addClass('sg-status-wordcount');
		this.wordCountStatusEl.style.display = 'none';

		// Sprint countdown chip — visible only during an active sprint
		this.sprintEl = this.addStatusBarItem();
		this.sprintEl.addClass('sg-status-sprint', 'mod-clickable');
		this.sprintEl.style.display = 'none';
		this.sprintEl.setAttribute('aria-label', 'Writing sprint — click for options');
		this.sprintEl.addEventListener('click', (e) => {
			const menu = new Menu();
			if (this.sprintStartAt !== null) {
				const elapsed = Date.now() - this.sprintStartAt;
				const words = Math.max(0, this.getTodayTypedWords() - this.sprintStartWords);
				menu.addItem((it) =>
					it.setTitle(`Stop sprint (${words.toLocaleString()} words so far)`)
						.setIcon('square')
						.onClick(() => this.endSprint(true))
				);
				menu.addItem((it) =>
					it.setTitle('Cancel (no summary)')
						.setIcon('x')
						.onClick(() => this.endSprint(false))
				);
			} else {
				const def = this.getDefaultSprintMinutes();
				menu.addItem((it) => it.setTitle(`Start ${def}-min sprint`).onClick(() => this.startSprint(def)));
			}
			menu.showAtMouseEvent(e);
		});

		this.refreshModeChip();
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this._activeFilePath = this.app.workspace.getActiveFile()?.path ?? null;
			// Only re-evaluate when scoping can actually change the outcome —
			// refreshing on every leaf change reconfigures all editors and lags
			if (this.settings.typewriterMode && this.settings.typewriterScope === 'scenes') {
				this.refreshTypewriterMode();
			}
			void this.refreshWordCountChip();
			this._injectLeafHeaderButton();
			this._injectSidebarTabButtons();
		}));
		this.refreshTypewriterMode();
		this._injectLeafHeaderButton();
		this.registerEditorSuggest(new CodexSuggest(this));
		registerScanCommand(this);

		registerEntityHover(this);
		registerLinkSelectionCommand(this);
		registerEntityLinkInterceptor(this);
		registerCodexClickInterceptor(this);

		this.addCommand({
			id: 'show-tips-again',
			name: t('command.showTipsAgain'),
			callback: () => void this.showTipsAgain(),
		});

		this.addCommand({
			id: 'toggle-typewriter',
			name: t('command.toggleTypewriter'),
			callback: () => void this.toggleTypewriterMode(),
		});

		this.addCommand({
			id: 'toggle-write-mode',
			name: t('command.toggleWriteMode'),
			callback: () => void toggleWriteMode(this),
		});

		this.addCommand({
			id: 'sprint-25',
			name: t('command.startSprint'),
			callback: () => this.startSprint(this.getDefaultSprintMinutes()),
		});

		this.addCommand({
			id: 'sprint-stop',
			name: t('command.stopSprint'),
			checkCallback: (checking) => {
				if (this.sprintStartAt !== null) {
					if (!checking) this.endSprint(true);
					return true;
				}
				return false;
			},
		});

		// Settings tab
		this.addSettingTab(new StorygridSettingsTab(this.app, this));

		// Commands
		this.addCommand({
			id: 'new-grid',
			name: t('command.newGrid'),
			callback: () => this.createNewGrid(),
		});

		this.addCommand({
			id: 'open-grid',
			name: t('command.openGrid'),
			checkCallback: (checking) => {
				if (!this.isModuleOn('plotGrid')) return false;
				if (!checking) this.openGridPicker();
				return true;
			},
		});

		this.addCommand({
			id: 'add-row',
			name: t('command.addRow'),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(StorygridView);
				if (view) {
					if (!checking) view.addRow();
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'open-codex',
			name: t('command.openCodex'),
			checkCallback: (checking) => {
				if (!this.isModuleOn('codex')) return false;
				if (!checking) this.openCodex();
				return true;
			},
		});

		this.addCommand({
			id: 'open-outline',
			name: t('command.openWritersPanel'),
			checkCallback: (checking) => {
				if (!this.isModuleOn('writersPanel')) return false;
				if (!checking) this.openOutline();
				return true;
			},
		});

		this.addCommand({
			id: 'open-dashboard',
			name: t('command.openDashboard'),
			callback: () => void this.openDashboard(),
		});

		this.addCommand({
			id: 'export-manuscript',
			name: t('command.exportManuscript'),
			callback: () => void this.exportManuscriptCommand(),
		});

		this.addCommand({
			id: 'upgrade-sheets',
			name: t('command.upgradeCodexSheets'),
			callback: () => void this.upgradeCodexSheets(),
		});

		this.addCommand({
			id: 'relationship-graph',
			name: t('command.openSocialMaps'),
			checkCallback: (checking) => {
				if (!this.isModuleOn('socialMaps')) return false;
				if (!checking) void this.openSocialMaps();
				return true;
			},
		});

		this.addCommand({
			id: 'open-timeline',
			name: t('command.openTimeline'),
			checkCallback: (checking) => {
				if (!this.isModuleOn('timeline')) return false;
				if (!checking) void this.openOrCreateTimeline();
				return true;
			},
		});

		this.addCommand({
			id: 'open-history',
			name: t('command.openActivity'),
			checkCallback: (checking) => {
				if (!this.isModuleOn('history')) return false;
				if (!checking) void this.openHistory();
				return true;
			},
		});

		this.addCommand({
			id: 'snapshot-project-now',
			name: t('command.snapshotNow'),
			callback: () => void this.snapshotProjectNowCommand(),
		});

		this.addCommand({
			id: 'open-welcome',
			name: t('command.openGuide'),
			callback: () => this.openWelcome(),
		});

		this.addCommand({
			id: 'load-sample-story',
			name: t('command.loadSample'),
			callback: () => void loadSampleStory(this),
		});

		this.addCommand({
			id: 'add-column',
			name: t('command.addColumn'),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(StorygridView);
				if (view) {
					if (!checking) view.addColumn();
					return true;
				}
				return false;
			},
		});

		// First ever load opens the Welcome page (every module at a glance). Its "Start your first project"
		// asks "What do you create?" next, then novel or series. The chooser sets settings.hasSeenWelcome
		// once answered (or skipped), so this stops firing after that.
		this.app.workspace.onLayoutReady(() => {
			if (!this.settings.hasSeenWelcome) {
				void this.openWelcome();
			}
			// Re-apply any persisted writing mode body class (no nav side-effects on restart)
			if (this.settings.writingMode) {
				document.body.classList.add(`sg-mode-${this.settings.writingMode}`);
				this.refreshModeChip();
			}
			// The Writers Panel is ALWAYS present when the plugin is on (Emma's
			// rule, 2026-09-06): it is the plugin's home base, not an optional
			// extra, and the ONLY way to be rid of it is the settings switch.
			// It used to also require `intent !== null`, which meant a fresh
			// vault — one where the intent chooser had not been answered yet —
			// opened with no panel at all and no obvious way to find one. A new
			// user's first impression must not be an empty sidebar.
			this.dedupeWritersPanels();
			if (this.isModuleOn('writersPanel') && !this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE).length) {
				void this.openOutline().then(() => this._injectSidebarTabButtons());
			} else {
				this._injectSidebarTabButtons();
			}
		});
	}

	/** Flip typewriter mode, persist quietly, and apply to all editors. */
	async toggleTypewriterMode(): Promise<void> {
		this.settings.typewriterMode = !this.settings.typewriterMode;
		await this.saveData(this.settings);
		this.refreshTypewriterMode();
		if (this.settings.typewriterMode) {
			// Enter focus: collapse both sidebars and show the anti-trap HUD.
			// Guarded like utils/writing-modes.ts: on mobile the sidebars are drawers without collapse().
			try { this.app.workspace.leftSplit?.collapse(); } catch { /* mobile */ }
			try { this.app.workspace.rightSplit?.collapse(); } catch { /* mobile */ }
			this._injectFocusHUD();
		} else {
			this._removeFocusHUD();
		}
		this._injectLeafHeaderButton();
		new Notice(`Typewriter mode ${this.settings.typewriterMode ? 'on' : 'off'}`);
	}

	/** True when the typewriter scope allows the current active file. */
	private _isInScope(): boolean {
		if (this.settings.typewriterScope !== 'scenes') return true;
		const p = this._activeFilePath ?? this.app.workspace.getActiveFile()?.path;
		return !!p && (p.includes('/Scenes/') || p.startsWith('Scenes/'));
	}

	/** Rebuild the editor-extension set from settings and apply it live. */
	refreshTypewriterMode(): void {
		const modeOn = this.settings.typewriterMode;
		// Extensions only active when mode is on AND scope allows the current file
		const effectivelyOn = modeOn && this._isInScope();
		// The sliders are read live through closures, so the extension set only
		// changes when on/off or dimming flips — skip the (expensive) editor
		// reconfiguration otherwise
		const key = `${effectivelyOn}:${this.settings.typewriterDimming !== false}`;
		if (key !== this._twLastKey) {
			this._twLastKey = key;
			this.typewriterExtensions.length = 0;
			if (effectivelyOn) {
				this.typewriterExtensions.push(
					typewriterScroll(() => this.settings.typewriterLinePosition ?? 35)
				);
				if (this.settings.typewriterDimming !== false) {
					this.typewriterExtensions.push(
						focusDimming(() => this.settings.typewriterSolidRows ?? 1)
					);
				}
			}
			this.app.workspace.updateOptions();
		}
		document.body.classList.toggle('sg-typewriter-on', effectivelyOn);
		// Dim strength (10–90%) → remaining opacity of non-active rows
		const strength = Math.min(90, Math.max(10, this.settings.typewriterDimStrength ?? 60));
		document.body.style.setProperty('--sg-tw-dim-opacity', `${(100 - strength) / 100}`);
		// Line position drives the editor's top/bottom padding so the typed
		// row can rest at that height even at the start or end of a document
		const linePos = Math.min(90, Math.max(10, this.settings.typewriterLinePosition ?? 35));
		document.body.style.setProperty('--sg-tw-line-pos', `${linePos}`);
		// Status bar reflects the mode setting (not effective state) so the
		// writer can see their preference even when editing a non-scene file
		if (this.typewriterStatusEl) {
			this.typewriterStatusEl.classList.toggle('is-active', modeOn);
			const scopeLabel = modeOn && this.settings.typewriterScope === 'scenes'
				? 'Typewriter mode: scene files only — click for settings'
				: `Typewriter mode: ${modeOn ? 'on' : 'off'} — click for settings`;
			this.typewriterStatusEl.setAttribute('aria-label', scopeLabel);
		}
		if (this.typewriterRibbonEl) {
			this.typewriterRibbonEl.classList.toggle('is-active', modeOn);
			this.typewriterRibbonEl.setAttribute(
				'aria-label',
				`Typewriter mode: ${modeOn ? 'on' : 'off'}`
			);
		}
	}

	/**
	 * Re-read every open editor's note now — after a change to the coach's mode,
	 * its switches, the "never" list, a "Not here", a sprint, or the Codex.
	 * Also tells the Coach tab to re-read.
	 */
	refreshCoachMode(): void {
		this.updateCoachChip();
		this._coachIgnore = null;
		this._coachNames = null;
		if (this._coachRefreshTimer !== null) window.clearTimeout(this._coachRefreshTimer);
		this._coachRefreshTimer = null;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			coachEditorView(leaf.view)?.dispatch({ effects: coachRefreshEffect.of(null) });
		}
		document.dispatchEvent(new CustomEvent('storygrid:coach-doc-changed'));
	}

	/** The status-bar chip shows the mode in force. */
	private updateCoachChip(): void {
		if (!this.coachStatusEl) return;
		const labels = {
			off: t('outline.coach.mode.off'),
			revising: t('outline.coach.mode.revising'),
			always: t('outline.coach.mode.always'),
		};
		this.coachStatusEl.setText(t('coach.statusChip', { mode: labels[resolveCoachMode(this.settings.proseCoach)] }));
	}

	/** Click on the chip: pick Off / While revising / Always. */
	private showCoachModeMenu(e: MouseEvent): void {
		const current = resolveCoachMode(this.settings.proseCoach);
		const menu = new Menu();
		for (const [mode, key] of [['off', 'outline.coach.mode.off'], ['revising', 'outline.coach.mode.revising'], ['always', 'outline.coach.mode.always']] as const) {
			menu.addItem((item) => item
				.setTitle(t(key))
				.setChecked(current === mode)
				.onClick(() => {
					(this.settings.proseCoach ??= {}).mode = mode;
					void this.saveSettingsQuiet();
					this.refreshCoachMode();
				}));
		}
		menu.showAtMouseEvent(e);
	}

	/** refreshCoachMode, once a burst of vault/metadata events has settled. */
	private scheduleCoachRefresh(): void {
		this._coachIgnore = null;
		this._coachNames = null;
		if (this._coachRefreshTimer !== null) window.clearTimeout(this._coachRefreshTimer);
		this._coachRefreshTimer = window.setTimeout(() => {
			this._coachRefreshTimer = null;
			this.refreshCoachMode();
		}, 800);
	}

	/** A Codex sheet changed (name, aliases) or a note's frontmatter status changed → re-read soon. */
	private coachOnMetadataChanged(f: TFile): void {
		const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
		const kind = fm?.['storygrid-type'];
		if (typeof kind === 'string' && kind !== 'scene') {
			this.scheduleCoachRefresh();
			return;
		}
		const status = typeof fm?.status === 'string' ? fm.status : '';
		const prev = this._coachStatusSeen.get(f.path);
		this._coachStatusSeen.set(f.path, status);
		// The first change seen for a note counts too (prev undefined): the editor's own
		// re-read ran before Obsidian saved the new status, so only this catches it.
		if (prev !== status && resolveCoachMode(this.settings.proseCoach) === 'revising') this.scheduleCoachRefresh();
	}

	/** Codex names + aliases (scenes excluded) + the "never" list, as normalizeWord keys. */
	coachIgnoreSet(): Set<string> {
		if (this._coachIgnore) return this._coachIgnore;
		const names: string[] = [];
		for (const e of this.entityIndex?.getAllEntities() ?? []) {
			if (e.kind === 'scene') continue;
			names.push(...this.codexNamesOf(e));
		}
		// Multi-word entries ("in order to") are Pro phrases, not words: splitting
		// them would stop "order" from ever being marked.
		const never = (this.settings.proseCoach?.neverWords ?? []).filter((w) => !/\s/.test(w));
		this._coachIgnore = buildIgnoreSet(names, never);
		return this._coachIgnore;
	}

	/**
	 * The Codex names and aliases of the scene's own book, as written, for the
	 * name-spelling check — another book's names are not this book's slips.
	 * The book = the deepest folder above the scene that holds Codex entries
	 * (a series Codex further up counts when the book has none of its own).
	 * Not scenes, events or research notes: their titles are sentences, not names.
	 */
	coachCodexNames(scenePath: string): string[] {
		const skip = new Set(['scene', 'event', 'research']);
		if (!this._coachNames) {
			this._coachNames = (this.entityIndex?.getAllEntities() ?? [])
				.filter((e) => !skip.has(e.kind))
				.map((e) => ({ path: e.file.path, kind: e.kind, names: this.codexNamesOf(e) }));
		}
		// The same book rule the @ picker and the mention scan use (refs/project-scope.ts).
		return scopeToBook(this._coachNames, scenePath, (e) => e).flatMap((e) => e.names);
	}

	/** The multi-word entries of the "never" list — phrases the Pro checks skip. */
	coachNeverPhrases(): Set<string> {
		return new Set((this.settings.proseCoach?.neverWords ?? []).filter((w) => /\s/.test(w)));
	}

	/**
	 * Every name a Codex entry goes by: its sheet name, file name and frontmatter
	 * aliases. The one source for the coach's ignore list and the Dashboard's
	 * "Who's gone quiet" name matching.
	 */
	codexNamesOf(e: { name: string; file: TFile }): string[] {
		const names = [e.name, e.file.basename];
		const aliases: unknown = this.app.metadataCache.getFileCache(e.file)?.frontmatter?.aliases;
		if (typeof aliases === 'string') names.push(aliases);
		else if (Array.isArray(aliases)) {
			for (const al of aliases) if (typeof al === 'string') names.push(al);
		}
		return names;
	}

	/** What the coach reads a note with: the switches, the ignore set, this note's "Not here" choices. */
	coachScanOptions(filePath: string): CoachScanContext {
		const s = this.settings.proseCoach;
		return {
			flags: resolveEngineFlags(s),
			ignore: this.coachIgnoreSet(),
			dismissed: dismissedFor(s, filePath),
			// The Pro checks (src/prose/pro) — local today, on the server later.
			pro: canUse('prose-coach') ? { flags: resolveProFlags(s), neverPhrases: this.coachNeverPhrases(), names: this.coachCodexNames(filePath) } : null,
		};
	}

	/**
	 * Whether marks show in this note: never during a sprint or in a Codex sheet;
	 * otherwise by mode — Always, or While revising when the scene's status is
	 * written / revised / final (see noteIsRevising).
	 */
	coachMarksOn(file: TFile | null, text: () => string): boolean {
		if (!file || file.extension !== 'md' || this.isSprintActive()) return false;
		const mode = resolveCoachMode(this.settings.proseCoach);
		if (mode === 'off') return false;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!this.coachIsScene(file)) return false;
		return mode === 'always' || noteIsRevising(fm?.status, text());
	}

	/**
	 * The coach reads scenes only: a note marked `storygrid-type: scene`, any
	 * unmarked note in a Scenes folder, or an unmarked note with a frontmatter
	 * `status` (a chapter kept in the writer's own folder). Codex sheets and
	 * other notes are never marked; the Coach tab says why (notAScene).
	 */
	coachIsScene(file: TFile): boolean {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const kind = fm?.['storygrid-type'];
		if (kind === 'scene') return true;
		if (typeof kind === 'string') return false;
		return this.isSceneFile(file.path) || typeof fm?.status === 'string';
	}

	/** "Not here": hide this kind + word in this one scene. */
	async coachNotHere(filePath: string, f: ProseFinding): Promise<void> {
		const s = (this.settings.proseCoach ??= {});
		const word = f.word ?? f.text.toLowerCase();
		let changed = dismissInScene(s, filePath, dismissalKey(f.kind, word));
		// An adverb that is also a repeated word shares one mark: hide both, or the mark stays.
		if (f.kind === 'adverb') changed = dismissInScene(s, filePath, dismissalKey('repetition', word)) || changed;
		if (changed) await this.saveSettingsQuiet();
		this.refreshCoachMode();
	}

	/** "Never this word": add it to the global list, so it is never marked anywhere. */
	async coachNever(f: ProseFinding): Promise<void> {
		const s = (this.settings.proseCoach ??= {});
		const word = neverKeyFor(f);
		if (addNeverWord(s, word)) {
			await this.saveSettingsQuiet();
			new Notice(t('coach.neverNotice', { word }));
		}
		this.refreshCoachMode();
	}

	/** Inject (or refresh) a keyboard toggle button into the active markdown leaf's header. */
	private _injectLeafHeaderButton(): void {
		this._leafHeaderBtn?.remove();
		this._leafHeaderBtn = null;

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) return;

		const navButtons = mdView.containerEl.querySelector('.view-header-nav-buttons');
		if (!navButtons) return;

		const btn = document.createElement('div');
		btn.className = 'clickable-icon view-header-icon sg-tw-header-btn';
		if (this.settings.typewriterMode) btn.classList.add('is-active');
		btn.setAttribute('aria-label', `Typewriter mode: ${this.settings.typewriterMode ? 'on' : 'off'}`);
		setIcon(btn, 'keyboard');
		btn.addEventListener('click', () => void this.toggleTypewriterMode());
		navButtons.prepend(btn);
		this._leafHeaderBtn = btn;
	}

	/** Inject (or refresh) quick-launch icons into the sidebar tab strip, right after the Writers Panel pen tab. */
	private _injectSidebarTabButtons(): void {
		this._sidebarTabBtns.forEach((b) => b.remove());
		this._sidebarTabBtns = [];

		const outlineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE);
		if (!outlineLeaves.length) return;

		const leaf = outlineLeaves[0] as any;
		const tabHeaderEl: HTMLElement | undefined = leaf.tabHeaderEl;
		if (!tabHeaderEl || !tabHeaderEl.parentElement) return;

		const show = (key: QuickLinkKey) => this.quickLinkVisible(key, 'top');

		const defs: Array<{ key: QuickLinkKey; icon: string; fallback: string; label: string; onClick: () => void }> = [
			{ key: 'connectionsMap', icon: CONNECTIONS_MAP_ICON, fallback: '⬡', label: 'Open Social Maps', onClick: () => void this.openSocialMaps() },
			{ key: 'dashboard',      icon: DASHBOARD_ICON,       fallback: '▦', label: 'Open Dashboard',        onClick: () => void this.openDashboard() },
			{ key: 'grid',           icon: GRID_VIEW_ICON,        fallback: '▦', label: 'Open Plot Grid',        onClick: () => void this._openCurrentGrid() },
			{ key: 'codex',          icon: CODEX_ICON,            fallback: '◎', label: 'Open Codex',      onClick: () => void this.openCodex() },
			{ key: 'timeline',       icon: TIMELINE_ICON,         fallback: '📅', label: 'Open Timeline',   onClick: () => void this.openOrCreateTimeline() },
		];

		let insertAfter: HTMLElement = tabHeaderEl;
		for (const def of defs) {
			if (!show(def.key)) continue;
			const btn = document.createElement('div');
			btn.className = 'clickable-icon sg-sidebar-tab-btn';
			btn.setAttribute('aria-label', def.label);
			setPhosphorIcon(btn, def.icon, def.fallback);
			btn.addEventListener('click', def.onClick);
			insertAfter.insertAdjacentElement('afterend', btn);
			insertAfter = btn;
			this._sidebarTabBtns.push(btn);
		}
	}

	/** Open the grid for the active project (as reflected by the Writers Panel); fall back to the picker. */
	private async _openCurrentGrid(): Promise<void> {
		const outline = await loadedView(this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE)[0], StorygridOutlineView);
		const file = outline?.getCurrentGridFile();
		if (file) {
			await this.openGridFile(file);
		} else {
			await this.openGridPicker();
		}
	}

	/** Inject the anti-trap HUD overlay at the bottom-centre of the viewport. */
	private _injectFocusHUD(): void {
		this._removeFocusHUD();
		const isMac = Platform.isMacOS;
		const shortcut = isMac ? '⌘O' : 'Ctrl+O';

		const hud = document.body.createDiv({ cls: 'sg-focus-hud' });
		const exitBtn = hud.createEl('button', { cls: 'sg-focus-hud-exit', text: 'Exit Focus' });
		exitBtn.addEventListener('click', () => void this.toggleTypewriterMode());
		hud.createEl('span', { cls: 'sg-focus-hud-hint', text: `Press ${shortcut} to switch scenes` });
		this._focusHudEl = hud;
	}

	/** Remove the anti-trap HUD if present. */
	private _removeFocusHUD(): void {
		this._focusHudEl?.remove();
		this._focusHudEl = null;
	}

	/** Update the Write-mode status-bar chip label and active state. */
	refreshModeChip(): void {
		if (!this.modeStatusEl) return;
		const on = this.settings.writingMode === 'write';
		this.modeStatusEl.setText(on ? '✍ Write' : '✍ Write off');
		this.modeStatusEl.classList.toggle('is-active', on);
		this.modeStatusEl.setAttribute(
			'aria-label',
			on ? 'Write mode on — click to turn off' : 'Write mode off — click to turn on'
		);
	}

	/** Recompute word count chip from an already-in-memory editor string (no disk read). */
	private updateWordCountFromText(text: string, filePath: string): void {
		this.pendingWordCountUpdate = { text, filePath };
		if (this.wordCountTimer !== null) window.clearTimeout(this.wordCountTimer);
		this.wordCountTimer = window.setTimeout(() => {
			this.wordCountTimer = null;
			const pending = this.pendingWordCountUpdate;
			this.pendingWordCountUpdate = null;
			if (!pending) return;
			const wc = countWords(pending.text);
			const goal = this.getWordGoalFor(pending.filePath);
			this.renderWordCountChip(wc, goal);
		}, 150);
	}

	/** Read the active markdown file and update the word count chip. */
	async refreshWordCountChip(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') {
			if (this.wordCountStatusEl) this.wordCountStatusEl.style.display = 'none';
			return;
		}
		try {
			const text = await this.app.vault.read(file);
			const wc = countWords(text);
			const goal = this.getWordGoalFor(file.path);
			this.renderWordCountChip(wc, goal);
		} catch {
			if (this.wordCountStatusEl) this.wordCountStatusEl.style.display = 'none';
		}
	}

	/** Scan open grid views for a card that links to this path and has a word goal. */
	private getWordGoalFor(filePath: string): number | null {
		for (const view of liveViews(this.app.workspace, VIEW_TYPE_STORYGRID, StorygridView)) {
			const grid = view.getGridData();
			if (!grid) continue;
			const card = grid.cards.find((c) => c.linkedDocPath === filePath);
			if (card?.wordGoal) return card.wordGoal;
		}
		return null;
	}

	/** Write the computed word count (and optional goal) into the status bar chip. */
	private renderWordCountChip(words: number, goal: number | null): void {
		if (!this.wordCountStatusEl) return;
		this.wordCountStatusEl.style.display = '';
		if (goal && goal > 0) {
			const pct = Math.min(100, Math.round((words / goal) * 100));
			this.wordCountStatusEl.setText(`${words.toLocaleString()} / ${goal.toLocaleString()}w · ${pct}%`);
			this.wordCountStatusEl.classList.toggle('is-met', words >= goal);
		} else {
			this.wordCountStatusEl.setText(`${words.toLocaleString()} words`);
			this.wordCountStatusEl.classList.remove('is-met');
		}
	}

	// ─── Sprint timer ─────────────────────────────────────────────────────────

	/** The writer's preferred sprint length (set in Settings → Writing). */
	getDefaultSprintMinutes(): number {
		const m = this.settings.sprintDefaultMinutes;
		return m && m > 0 ? m : 25;
	}

	/** Sprint counts from the persisted history: today / this week / all time / total words. */
	getSprintStats(): { today: number; week: number; total: number; totalWords: number } {
		const history = this.settings.sprintHistory ?? [];
		const today = dayKey(new Date());
		const weekStart = startOfWeek(new Date()).getTime();
		let todayCount = 0;
		let weekCount = 0;
		let totalWords = 0;
		for (const s of history) {
			if (s.endedAt.startsWith(today)) todayCount++;
			if (new Date(s.endedAt).getTime() >= weekStart) weekCount++;
			totalWords += s.words;
		}
		return { today: todayCount, week: weekCount, total: history.length, totalWords };
	}

	/**
	 * The one sprint menu — durations, custom length, stop, and a done-count
	 * footer. Shared by the ribbon, the status bar chip, and the Dashboard.
	 */
	showSprintMenu(e: MouseEvent): void {
		const menu = new Menu();
		const def = this.getDefaultSprintMinutes();
		if (this.sprintStartAt !== null) {
			const words = Math.max(0, this.getTodayTypedWords() - this.sprintStartWords);
			menu.addItem((it) => it.setTitle(t('hub.sprint.stop', { words: words.toLocaleString() }))
				.setIcon('square').onClick(() => this.endSprint(true)));
			menu.addItem((it) => it.setTitle(t('hub.sprint.cancel'))
				.setIcon('x').onClick(() => this.endSprint(false)));
			menu.addSeparator();
		}
		menu.addItem((it) => it.setTitle(t('hub.sprint.startDefault', { mins: def })).setIcon('timer')
			.onClick(() => this.startSprint(def)));
		for (const mins of [15, 25, 45]) {
			if (mins === def) continue;
			menu.addItem((it) => it.setTitle(t('hub.sprint.startMinutes', { mins })).onClick(() => this.startSprint(mins)));
		}
		menu.addItem((it) => it.setTitle(t('hub.sprint.customSetGoal')).onClick(() => {
			openSprintSetup(this.app, this.sprintLastMinutes, (mins, goal) => this.startSprint(mins, goal));
		}));
		const stats = this.getSprintStats();
		if (stats.total > 0) {
			menu.addSeparator();
			menu.addItem((it) => it
				.setTitle(t('hub.sprint.statsLine', { today: stats.today, s: stats.today === 1 ? '' : 's', total: stats.total, words: stats.totalWords.toLocaleString() }))
				.setIcon('chart-line').setDisabled(true));
		}
		menu.showAtMouseEvent(e);
	}

	startSprint(minutes: number, wordGoal = 0): void {
		this.endSprint(false); // silently stop any existing sprint
		this.sprintCompletionData = null;
		this.sprintWordGoal = wordGoal;
		this.sprintLastMinutes = minutes;
		this.sprintStartAt = Date.now();
		this.sprintDurationMs = minutes * 60_000;
		this.sprintStartWords = this.getTodayTypedWords();
		this.sprintInterval = window.setInterval(() => this.tickSprint(), 1000);
		this.tickSprint();
		new Notice(`Sprint started — ${minutes} minutes. Go!`);
		document.dispatchEvent(new CustomEvent('storygrid:sprint-changed'));
		this._notifySprintViews();
	}

	private endSprint(showSummary: boolean): void {
		if (this.sprintInterval !== null) {
			window.clearInterval(this.sprintInterval);
			this.sprintInterval = null;
		}
		if (this.sprintStartAt !== null) {
			const wordsWritten = Math.max(0, this.getTodayTypedWords() - this.sprintStartWords);
			const elapsed = Date.now() - this.sprintStartAt;
			const completed = elapsed >= this.sprintDurationMs;

			// Log the sprint so the writer can see how many they've done.
			// Silent cancels under a minute don't count — they were misclicks.
			if (showSummary || elapsed >= 60_000) {
				const history = (this.settings.sprintHistory ??= []);
				// Same "currently active project" mechanism as openDashboard()/openHistory()/
				// openCodex() — the shared activeProjectRoot setting (falling back to the
				// first known project, same as those methods).
				const projectRoot = this.settings.activeProjectRoot || findProjects(this.app)[0]?.rootPath || undefined;
				history.push({
					endedAt: new Date().toISOString(),
					minutes: this.sprintLastMinutes,
					words: wordsWritten,
					completed,
					projectRoot,
				});
				if (history.length > 1000) history.splice(0, history.length - 1000);
				void this.saveData(this.settings);
			}

			if (showSummary) {
				// Fireworks first — the finish should feel like a win.
				launchConfetti();
				// Let the Writers Panel banner flip to its inline success state...
				this.sprintCompletionData = { wordsWritten, elapsedMs: elapsed };
				// ...but ALWAYS show the clear "Sprint complete!" popup so the finish
				// is unmistakable, not just a chime + subtle banner change.
				const dash = ensureDashboard(this.settings);
				const projects = findProjects(this.app);
				const root = projects[0]?.rootPath ?? '';
				const streak = dash.streaks?.[root]?.current ?? 0;
				showSprintSummary(
					this.app,
					wordsWritten,
					elapsed,
					streak,
					this.sprintLastMinutes,
					(mins) => this.startSprint(mins),
					this.getSprintStats()
				);
			}
		}
		this.sprintStartAt = null;
		this.sprintDurationMs = 0;
		this.sprintStartWords = 0;
		this.sprintWordGoal = 0;
		this.updateSprintChip();
		document.dispatchEvent(new CustomEvent('storygrid:sprint-changed'));
		this._notifySprintViews();
	}

	/** Directly refresh the sprint panel in all open dashboard views. Bypasses
	 *  the async render path so gen-counter races can't silently drop the update. */
	private _notifySprintViews(): void {
		// A Dashboard tab not shown since startup is skipped (see liveViews) — it
		// renders the sprint fresh when opened. Calling into it threw and stopped
		// every sprint from starting.
		for (const view of liveViews(this.app.workspace, VIEW_TYPE_DASHBOARD, StorygridDashboardView)) {
			view.refreshSprintPanel();
		}
	}

	private tickSprint(): void {
		if (this.sprintStartAt === null) return;
		const remaining = this.sprintDurationMs - (Date.now() - this.sprintStartAt);
		if (remaining <= 0) {
			if (this.settings.sprintSound !== false) this.playSprintChime();
			this.endSprint(true);
			return;
		}
		this.updateSprintChip(remaining);
	}

	/** A soft two-note chime via WebAudio — no sound file needed. */
	private playSprintChime(): void {
		try {
			const ctx = new AudioContext();
			const note = (freq: number, start: number) => {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = 'sine';
				osc.frequency.value = freq;
				gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
				gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + start + 0.02);
				gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.6);
				osc.connect(gain).connect(ctx.destination);
				osc.start(ctx.currentTime + start);
				osc.stop(ctx.currentTime + start + 0.65);
			};
			note(880, 0);
			note(1175, 0.18);
			window.setTimeout(() => void ctx.close(), 1200);
		} catch {
			// Audio unavailable — the summary modal still announces the finish
		}
	}

	private updateSprintChip(remainingMs?: number): void {
		if (!this.sprintEl) return;
		if (remainingMs === undefined) {
			this.sprintEl.style.display = 'none';
			return;
		}
		this.sprintEl.style.display = '';
		const totalSecs = Math.ceil(remainingMs / 1000);
		const mins = Math.floor(totalSecs / 60);
		const secs = totalSecs % 60;
		this.sprintEl.setText(`⏱ ${mins}:${secs.toString().padStart(2, '0')}`);
	}

	private getTodayTypedWords(): number {
		const dash = ensureDashboard(this.settings);
		const today = dayKey(new Date());
		return Object.values(dash.typedWords).reduce((sum, h) => sum + (h[today] ?? 0), 0);
	}

	async onunload(): Promise<void> {
		this.coachCard?.hide();
		if (this._coachRefreshTimer !== null) window.clearTimeout(this._coachRefreshTimer);
		this._coachRefreshTimer = null;
		registerEntityModalPlugin(null);
		document.body.classList.remove('sg-typewriter-on', 'sg-sheets-styled', 'sg-infobox-left', 'sg-infobox-top', 'sg-mode-write', 'sg-plugin-active');
		document.body.style.removeProperty('--sg-tw-dim-opacity');
		document.body.style.removeProperty('--sg-tw-line-pos');
		this._leafHeaderBtn?.remove();
		this._removeFocusHUD();
		if (this.typedWordsTimer !== null) window.clearTimeout(this.typedWordsTimer);
		if (this.wordCountTimer !== null) window.clearTimeout(this.wordCountTimer);
		if (this.sprintInterval !== null) window.clearInterval(this.sprintInterval);
		flushProjectMirrors();
	}

	/** Whether a writing sprint is currently running (used by the Dashboard). */
	isSprintActive(): boolean {
		return this.sprintStartAt !== null;
	}

	/** Milliseconds remaining in the current sprint (0 if none). */
	getSprintRemaining(): number {
		if (this.sprintStartAt === null) return 0;
		return Math.max(0, this.sprintDurationMs - (Date.now() - this.sprintStartAt));
	}

	/** Full length of the current sprint in ms (0 if none) — for progress bars. */
	getSprintDuration(): number {
		return this.sprintStartAt !== null ? this.sprintDurationMs : 0;
	}

	/** Word goal set at sprint start (0 = no goal). */
	getSprintWordGoal(): number { return this.sprintWordGoal; }

	/** Words written since sprint started (live, 0 if no sprint). */
	getSprintWordsWritten(): number {
		if (this.sprintStartAt === null) return 0;
		return Math.max(0, this.getTodayTypedWords() - this.sprintStartWords);
	}

	/** Completion stats set when a sprint ends — consumed by the banner's success state. */
	getSprintCompletion(): { wordsWritten: number; elapsedMs: number } | null {
		return this.sprintCompletionData;
	}

	/** Dismiss the inline success banner (called by Log & Close / Sprint Again). */
	clearSprintCompletion(): void {
		this.sprintCompletionData = null;
	}

	/** Stop the running sprint and show the summary. */
	stopSprint(): void {
		this.endSprint(true);
	}

	/** Open (or reveal) the quick-start welcome guide in a new tab. */
	async openWelcome(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_WELCOME)[0];
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_WELCOME, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Settings button + command: every first-time tip comes back, the way a new
	 * writer sees Plotverk (handy for a demo). Only "already seen" flags change;
	 * the welcome chooser opens now, the rest show as the writer goes.
	 */
	async showTipsAgain(): Promise<void> {
		resetFirstTimeTips(this.settings);
		await this.saveSettings();
		new Notice(t('settings.general.tipsAgain.notice'));
		await this.openWelcome();
	}

	/** Open (or reveal) the first-launch "what will you use this for?" chooser. */
	async openIntentChooser(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_INTENT)[0];
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_INTENT, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Route to the landing surface that matches a chosen intent, called right
	 * after the intent chooser closes. Plot/write and Everything land on the
	 * grid (the visual "aha" moment); Build-a-world and Run-a-campaign land in
	 * the Codex instead, since that's where those users' first real action is.
	 * If no project exists yet in the vault, creates one first — see
	 * landAfterProjectCreation(), which routes the newly created project the
	 * same way.
	 */
	async landForIntent(intent: IntentId): Promise<void> {
		// Journalists live in goals, tasks, and the writing surface — the Dashboard is home.
		if (intent === 'journalist') {
			await this.openDashboard();
			return;
		}
		const isPantser = intent === 'novelist' && this.settings.writingStyle === 'pantser';
		const worldFirst = intent === 'worldbuilder';
		const gridFirst = !worldFirst && !isPantser && this.isModuleOn('plotGrid');
		if (this.findAllGridFiles().length > 0) {
			if (worldFirst) await this.openCodex();
			else if (isPantser) {
				const scenesPath = this.resolveScenesPathForLanding();
				if (scenesPath) await this.landPantser(scenesPath);
				else await this.openDashboard();
			}
			else if (gridFirst) await this.openOrCreateGrid();
			else await this.openDashboard();
			return;
		}
		await this.createNewGrid();
	}

	/** After a brand-new project's grid file + folders are created, open the surface that matches the active intent. */
	private async landAfterProjectCreation(file: TFile): Promise<void> {
		const intent = this.settings.intent;
		if (intent === 'worldbuilder') {
			await this.openCodex(file.parent?.path ?? '');
		} else if (intent === 'novelist' && this.settings.writingStyle === 'pantser' && this.lastProjectPaths) {
			await this.landPantser(this.lastProjectPaths.scenesPath);
		} else {
			await this.openGridFile(file);
		}
	}

	/** Scenes folder of the first grid found in the vault, for routing an already-set-up Pantser straight past the grid. */
	private resolveScenesPathForLanding(): string | null {
		const grid = this.findAllGridFiles()[0];
		if (!grid) return null;
		return entityFolderPath(projectRootFromGridPath(grid.path), 'scene');
	}

	/**
	 * Pantser landing: skip the grid entirely — create a blank scene note,
	 * ready to type, with Write mode already on (typewriter + hidden
	 * sidebars). A one-time coach mark points at the status-bar chip that
	 * controls it, since a Pantser never gets to see the "Getting started"
	 * card-editor hints from a card they're not going to place.
	 */
	private async landPantser(scenesPath: string): Promise<void> {
		if (!this.app.vault.getAbstractFileByPath(scenesPath)) {
			await this.app.vault.createFolder(scenesPath);
		}
		let filePath = `${scenesPath}/Untitled Scene.md`;
		let n = 2;
		while (this.app.vault.getAbstractFileByPath(filePath)) {
			filePath = `${scenesPath}/Untitled Scene ${n}.md`;
			n++;
		}
		const file = await this.app.vault.create(filePath, '');
		await this.app.workspace.getLeaf('tab').openFile(file);

		if (this.settings.writingMode !== 'write') {
			await toggleWriteMode(this);
		}

		if (this.modeStatusEl && this.canShowCoachMark('pantser-write-chip')) {
			const chip = this.modeStatusEl;
			requestAnimationFrame(() => {
				showCoachMark(chip, t('intent.coachMark.writeMode'), {
					placement: 'top',
					onDismiss: () => this.markCoachMarkSeen('pantser-write-chip'),
					onHide: () => this.releasePendingCoachMark('pantser-write-chip'),
				});
			});
		}
	}

	/** Get the file path of the currently active grid view, or null if none. */
	private getActiveGridPath(): string | null {
		const view = this.app.workspace.getActiveViewOfType(StorygridView);
		const activePath = view?.getFilePath();
		if (activePath) return activePath;
		// Fall back to most recently opened grid leaf — read from its saved
		// state, so a tab Obsidian hasn't loaded yet still counts.
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_STORYGRID)[0];
		if (!leaf) return null;
		if (leaf.view instanceof StorygridView) return leaf.view.getFilePath();
		return leafStateString(leaf, 'filePath') ?? leafStateString(leaf, 'file');
	}

	/** The plugin hub menu behind the ribbon button — also used by full-tab views for navigation. */
	showHubMenu(evt: MouseEvent): void {
		const menu = new Menu();

		// ── Group 1: Destinations ──────────────────────────────────────────
		menu.addItem((i) => i.setTitle(t('hub.dashboard')).setIcon('sg-chart-bar')
			.onClick(() => void this.openDashboard()));
		if (this.isModuleOn('codex')) {
			menu.addItem((i) => i.setTitle(t('hub.codex')).setIcon('sg-globe')
				.onClick(() => this.openCodex()));
		}
		if (this.isModuleOn('plotGrid')) {
			menu.addItem((i) => i.setTitle(t('hub.plotGrid')).setIcon('sg-squares-four')
				.onClick(() => this.openOrCreateGrid()));
		}
		if (this.isModuleOn('socialMaps')) {
			menu.addItem((i) => i.setTitle(t('hub.socialMaps')).setIcon('sg-graph')
				.onClick(() => void this.openSocialMaps()));
		}
		if (this.isModuleOn('timeline')) {
			menu.addItem((i) => i.setTitle(t('hub.timeline')).setIcon('sg-git-commit')
				.onClick(() => void this.openOrCreateTimeline()));
		}
		menu.addSeparator();

		// ── Group 3: States ───────────────────────────────────────────────
		menu.addItem((i) => i.setTitle(t('hub.writeMode')).setIcon('pencil-line')
			.setChecked(this.settings.writingMode === 'write')
			.onClick(() => void toggleWriteMode(this)));
		menu.addSeparator();

		// ── Group 4: Project & help ───────────────────────────────────────
		const hasSeries = this.settings.isSeriesMode
			&& Object.keys(this.settings.seriesRegistry ?? {}).length > 0;
		if (hasSeries || findProjects(this.app).length > 1) {
			menu.addItem((i) => i.setTitle(t('hub.switchProject')).setIcon('arrow-left-right')
				.onClick(() => new ProjectSwitchModal(this.app, this).open()));
		}
		menu.addItem((i) => i.setTitle(t('hub.createNewProject')).setIcon('plus-circle')
			.onClick(() => this.createNewGrid()));
		menu.addItem((i) => i.setTitle(t('hub.switchSetup')).setIcon('sliders-horizontal')
			.onClick(() => void this.openIntentChooser()));
		menu.addItem((i) => i.setTitle(t('hub.guide')).setIcon('circle-help')
			.onClick(() => this.openWelcome()));

		menu.showAtMouseEvent(evt);
	}

	/**
	 * Keep exactly one Writers Panel: two callers opening it at the same moment
	 * (startup, intent flow, a toolbar button) could each create a tab before the
	 * other's existed, leaving two pen icons side by side. Keeps `keep` (the panel the
	 * caller just opened) — or the first one when nothing is passed — and closes the rest.
	 */
	private dedupeWritersPanels(keep?: WorkspaceLeaf): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE);
		const survivor = keep && leaves.includes(keep) ? keep : leaves[0];
		for (const extra of leaves) if (extra !== survivor) extra.detach();
	}

	/** Open (or reveal) the Story Outline panel in the right sidebar. */
	async openOutline(gridPath?: string): Promise<void> {
		// If no explicit path, detect the currently active grid view
		const resolvedPath = gridPath ?? this.getActiveGridPath();
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE)[0];
		const view = await loadedView(existing, StorygridOutlineView);
		if (existing && view) {
			await this.app.workspace.revealLeaf(existing);
			if (resolvedPath) await view.showGrid(resolvedPath);
			return;
		}
		// The Writers Panel lives on the LEFT by default — the card editing
		// sidebar slides in from the right, so they never fight for space.
		const leaf = existing ?? this.app.workspace.getLeftLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({
			type: VIEW_TYPE_OUTLINE,
			state: resolvedPath ? { gridPath: resolvedPath } : {},
			active: true,
		});
		this.dedupeWritersPanels(leaf);
		this.app.workspace.revealLeaf(leaf);
	}

	/** Reveal (or create) the Writers Panel WITHOUT switching its active grid —
	 *  for callers like the Connections Map node-click preview that only want
	 *  to point the panel at an entity, not force a grid change + extra render. */
	async revealOutline(): Promise<StorygridOutlineView | null> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE)[0];
		const view = await loadedView(existing, StorygridOutlineView);
		if (existing && view) {
			await this.app.workspace.revealLeaf(existing);
			return view;
		}
		const leaf = existing ?? this.app.workspace.getLeftLeaf(false);
		if (!leaf) return null;
		await leaf.setViewState({ type: VIEW_TYPE_OUTLINE, state: {}, active: true });
		this.dedupeWritersPanels(leaf);
		await this.app.workspace.revealLeaf(leaf);
		return leaf.view instanceof StorygridOutlineView ? leaf.view : null;
	}


	/**
	 * Command palette "Export manuscript": the Writers Panel's Export tab for
	 * the active project. The grid in front of the writer wins; otherwise the
	 * Writers Panel's own choice (the one active project every view shares).
	 */
	async exportManuscriptCommand(): Promise<void> {
		const activeGrid = this.app.workspace.getActiveViewOfType(StorygridView)?.getFilePath();
		if (activeGrid) {
			await this.openOutlineCompile(activeGrid);
			return;
		}
		if (this.findAllGridFiles().length > 0) {
			const panel = await this.revealOutline();
			const grid = panel?.getCurrentGridFile();
			if (panel && grid) {
				await panel.showCompileTab(grid.path);
				return;
			}
		}
		new Notice(t('command.exportManuscript.noProject'));
	}

	/** Open the Writers Panel directly on the Compile tab for a given grid. */
	async openOutlineCompile(gridPath: string): Promise<void> {
		// A Writers Panel tab Obsidian hasn't loaded since startup (1.7+ deferred
		// tabs) holds a placeholder, not our view — load it before calling into
		// it, or the grid's Export button silently does nothing.
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE)[0];
		const view = await loadedView(existing, StorygridOutlineView);
		if (existing && view) {
			await this.app.workspace.revealLeaf(existing);
			await view.showCompileTab(gridPath);
			return;
		}
		const leaf = existing ?? this.app.workspace.getLeftLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({
			type: VIEW_TYPE_OUTLINE,
			state: { gridPath, activeTab: 'compile' },
			active: true,
		});
		this.dedupeWritersPanels(leaf);
		this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Open (or reveal) the Codex. Optionally focused on a specific
	 * project root folder — e.g. when invoked from a grid's toolbar.
	 */
	async openDashboard(projectRoot?: string): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
		const view = await loadedView(existing, StorygridDashboardView);
		if (existing && view) {
			await this.app.workspace.revealLeaf(existing);
			if (projectRoot !== undefined) await view.showProject(projectRoot);
			return;
		}
		const root = projectRoot
			?? (this.settings.activeProjectRoot || undefined)
			?? findProjects(this.app)[0]?.rootPath
			?? '';
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: VIEW_TYPE_DASHBOARD,
			state: { projectRoot: root },
		});
		this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * The Guide's user-initiated "Show me around" — opens the Dashboard (the
	 * one surface every setup keeps) and points out its edit-layout control.
	 * No forced multi-step tour: research says those get skipped; a single
	 * anchored callout the user asked for is the pattern that actually works.
	 */
	async showMeAround(): Promise<void> {
		await this.openDashboard();
		const view = await loadedView(this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0], StorygridDashboardView);
		requestAnimationFrame(() => view?.runTourCoachMark());
	}

	/**
	 * Count words typed by hand into scene documents. Deltas are sampled on a
	 * debounce; a large jump in one sample window is treated as a paste and
	 * ignored, so goals reward writing rather than clipboard work.
	 */
	/** True if the file lives under any project's Scenes folder. */
	private isSceneFile(filePath: string): boolean {
		return /(?:^|\/)Scenes\//.test(filePath) && filePath.endsWith('.md') && !isSafetyNetPath(filePath);
	}

	/** Populate manuscriptWordCache from all scene files in the vault. */
	private async buildManuscriptWordCache(): Promise<void> {
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this.isSceneFile(file.path)) continue;
			try {
				const text = await this.app.vault.cachedRead(file);
				this.manuscriptWordCache.set(file.path, countWords(text));
			} catch { /* unreadable — skip */ }
		}
	}

	/** Total word count across all scene files belonging to a project root. */
	getProjectManuscriptWords(rootPath: string): number {
		const prefix = rootPath ? `${rootPath}/Scenes/` : 'Scenes/';
		let total = 0;
		for (const [path, count] of this.manuscriptWordCache) {
			if (path.startsWith(prefix)) total += count;
		}
		return total;
	}

	private trackTypedWords(file: TFile | null, text: string): void {
		if (!file || file.extension !== 'md' || isSafetyNetPath(file.path)) return;
		// Only manuscript writing counts: files inside a project's Scenes folder
		const m = file.path.match(/^(?:(.*)\/)?Scenes\//);
		if (!m) return;
		const root = m[1] ?? '';

		this.pendingTypedFile = { path: file.path, root, text };
		if (this.typedWordsTimer !== null) window.clearTimeout(this.typedWordsTimer);
		this.typedWordsTimer = window.setTimeout(() => { // 300ms: responsive but not per-keystroke
			const pending = this.pendingTypedFile;
			this.pendingTypedFile = null;
			if (!pending) return;
			void ensureDailySnapshot(this.app, pending.path, pending.text, this.seenDailySnapshots);
			const count = countWords(pending.text);
			const baseline = this.wordBaselines.get(pending.path);
			this.wordBaselines.set(pending.path, count);
			if (baseline === undefined) return; // first sample only sets the baseline
			const delta = count - baseline;
			const dash = ensureDashboard(this.settings);
			const today = dayKey(new Date());
			// Ignore large jumps in either direction — these are pastes or bulk cuts (moving text).
			// Normal typing/deleting (within the threshold) counts fully: additions add, deletions subtract.
			const pasteThreshold = this.settings.pasteWordThreshold ?? 80;
			if (Math.abs(delta) > pasteThreshold) {
				if (delta > 0) {
					const skipped = (dash.skippedWords ??= {});
					const skippedHistory = (skipped[pending.root] ??= {});
					skippedHistory[today] = (skippedHistory[today] ?? 0) + delta;
					void this.saveData(this.settings);
					scheduleProjectMirror(this.app, pending.root, dash);
				}
				return;
			}
			if (delta === 0) return;
			const history = (dash.typedWords[pending.root] ??= {});
			// Floor at 0 so the daily total never goes negative
			history[today] = Math.max(0, (history[today] ?? 0) + delta);
			document.dispatchEvent(new CustomEvent('storygrid:words-changed'));

			// Update streak for this project
			const streaks = (dash.streaks ??= {});
			const s = (streaks[pending.root] ??= { current: 0, longest: 0, lastDate: '' });
			if (s.lastDate !== today) {
				// Local-calendar subtraction: `now - 24h` lands on the wrong day across a DST change.
				const now = new Date();
				const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
				s.current = s.lastDate === yesterday ? s.current + 1 : 1;
				s.longest = Math.max(s.longest, s.current);
				s.lastDate = today;
			}

			void this.saveData(this.settings); // quiet save — no settings-changed event
			scheduleProjectMirror(this.app, pending.root, dash);
		}, 300);
	}

	/** Add/remove sheet styling classes on every markdown view, by frontmatter. */
	applySheetViewClasses(): void {
		const kindClasses = registeredKinds().map((k) => `sg-sheet-${k}`);
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view as unknown as { file?: TFile | null; containerEl?: HTMLElement };
			const el = view.containerEl;
			if (!el) continue;
			el.classList.remove('storygrid-sheet', ...kindClasses);
			const t = view.file
				? this.app.metadataCache.getFileCache(view.file)?.frontmatter?.['storygrid-type']
				: undefined;
			if (typeof t === 'string' && hasKind(t)) {
				el.classList.add('storygrid-sheet', `sg-sheet-${t}`);
			}
		}
	}

	/**
	 * Bring every codex document up to the current sheet layout (infobox +
	 * sections) through the preserving writer: modern structure is added where
	 * it is missing, and nothing on the sheet — loose prose, the writer's own
	 * callouts, frontmatter keys we don't know — is dropped.
	 */
	async upgradeCodexSheets(): Promise<void> {
		new ConfirmModal(
			this.app,
			'Upgrade all Codex documents to the current entry layout? Your text is kept — this only adds the modern structure (infobox and sections) where an entry is missing it.',
			'Upgrade entries',
			async () => {
				let count = 0;
				for (const project of findProjects(this.app)) {
					for (const kind of getCodexKindOrder()) {
						for (const info of this.entityIndex.list(project.rootPath, kind)) {
							try {
								const content = await this.app.vault.read(info.file);
								const parsed = parseEntityDocument(content, info.file.basename);
								// A type the registry doesn't know is left exactly as written.
								if (!parsed.kind || !hasKind(parsed.kind)) continue;
								// A no-change save: every parsed field written back to
								// where it belongs, which materializes missing structure.
								const before = parsed.fields.map((f) => ({ id: f.id, label: f.label, type: f.type }));
								await updateEntitySheet(this.app, info.file, {
									kind: parsed.kind,
									name: parsed.name,
									fields: parsed.fields,
									before,
									entityId: parsed.entityId ?? undefined,
									aliases: parsed.aliases,
									staleKeys: parsed.ownedKeys,
								});
								if (await this.app.vault.read(info.file) !== content) count++;
							} catch { /* unreadable file — skip */ }
						}
					}
				}
				new Notice(count > 0 ? `Upgraded ${count} Codex ${count === 1 ? 'entry' : 'entries'}.` : 'All Codex entries are already up to date.');
			}
		).open();
	}

	/** Open the merged Social Maps view (Connections Map + Story Tree tabs), scoped to the active book/series. No tab given = the tab last used (the Story Tree the first time). */
	async openSocialMaps(requestedTab?: SocialMapsTab, scopeRoot?: string): Promise<void> {
		const tab: SocialMapsTab = requestedTab ?? (this.settings.socialMapsLastTab === 'map' ? 'map' : 'tree');
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SOCIAL_MAPS)[0];
		if (existing) {
			// A tab Obsidian hasn't loaded yet isn't a SocialMapsView until it is.
			await existing.loadIfDeferred?.();
			const view = existing.view;
			if (view instanceof SocialMapsView) view.switchTo(tab, scopeRoot);
			this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		// No root given = the view follows the Dashboard's active project itself.
		const scope = scopeRoot !== undefined ? { scopeRoot, explicitScope: true } : {};
		await leaf.setViewState({ type: VIEW_TYPE_SOCIAL_MAPS, active: true, state: { activeTab: tab, ...scope } });
		this.app.workspace.revealLeaf(leaf);
	}

	/** Thin alias — kept so every existing call site (dashboard tiles/banners, grid-view.ts, welcome-view) keeps working unchanged. */
	async openRelGraph(scopeRoot?: string): Promise<void> {
		await this.openSocialMaps('map', scopeRoot);
	}

	/** Thin alias — see openRelGraph. */
	async openStoryTree(scopeRoot?: string): Promise<void> {
		await this.openSocialMaps('tree', scopeRoot);
	}

	/** Open the project's Story Timeline, creating `Timeline.timeline` in the project root on first use. */
	async openOrCreateTimeline(scopeRoot?: string): Promise<void> {
		const root = scopeRoot ?? this.resolveActiveRoot();
		// Reuse any .timeline already sitting in the project root (a project may
		// have named its own, e.g. "History of Saltmarch.timeline") rather than
		// putting a second, empty "Timeline.timeline" next to it.
		const existingInRoot = this.app.vault.getFiles()
			.filter((f) => f.extension === 'timeline' && (f.parent?.path ?? '/') === (root || '/'))
			.sort((a, b) => a.name.localeCompare(b.name))[0];
		const filePath = existingInRoot?.path ?? (root ? `${root}/Timeline.timeline` : 'Timeline.timeline');

		let file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			try {
				const data = createEmptyTimeline('Timeline', GREGORIAN_CALENDAR, this.settings.timelineAppearance);
				file = await this.app.vault.create(filePath, JSON.stringify(data, null, 2));
			} catch (err) {
				new Notice(`Plotverk: Could not create the timeline. ${err instanceof Error ? err.message : ''}`);
				return;
			}
		}

		// Saved state, not leaf.view: a not-yet-loaded tab of this timeline counts too.
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE).find(
			(leaf) => leafStateString(leaf, 'filePath') === filePath
		);
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_TIMELINE, state: { filePath } });
		this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Mark `projectRoot` as the shared active project — Codex, Writers Panel, History,
	 * and Dashboard all resolve to this when no explicit root is passed. Called whenever
	 * a grid file loads, and by the Dashboard's own project switcher.
	 */
	async setActiveProjectRoot(projectRoot: string): Promise<void> {
		const bookRegistry = this.settings.bookRegistry ?? {};
		const livesHere = (b: { gridPath?: string } | undefined): boolean =>
			!!b?.gridPath && projectRootFromGridPath(b.gridPath) === projectRoot;
		// Keep the current book if it lives in this folder (two books can share one).
		const currentId = this.settings.activeBookId;
		const matchedBook = currentId && livesHere(bookRegistry[currentId])
			? [currentId, bookRegistry[currentId]] as const
			: Object.entries(bookRegistry).find(([, b]) => livesHere(b));
		if (this.settings.activeProjectRoot === projectRoot) {
			// Same folder, but the saved book can be out of step with it (an older
			// version kept Book 2 while the folder was Book 1's): re-sync, then tell
			// the views — otherwise the Writers Panel and Dashboard keep disagreeing.
			if (!matchedBook || this.settings.activeBookId === matchedBook[0]) return;
			this.settings.activeBookId = matchedBook[0];
			this.settings.activeSeriesId = matchedBook[1].seriesId;
			await this.saveData(this.settings);
			document.dispatchEvent(new CustomEvent('storygrid:project-changed'));
			return;
		}
		this.settings.activeProjectRoot = projectRoot;
		// Keep series/book registry in sync so series-mode views resolve correctly
		const seriesRegistry = this.settings.seriesRegistry ?? {};
		const matchedSeries = Object.entries(seriesRegistry).find(
			([, s]) => s.rootPath === projectRoot,
		);
		if (matchedBook) {
			// A book's own folder — even when it doubles as the series folder (a
			// series whose Book 1 sits at the root): picking it means THAT book, so
			// the Writers Panel follows the Dashboard instead of keeping the old book.
			this.settings.activeBookId = matchedBook[0];
			this.settings.activeSeriesId = matchedBook[1].seriesId;
		} else if (matchedSeries) {
			// Entire-series focus: activate the series but keep the current book
			// if it belongs to it — the Writers Panel always holds one book.
			const [sid] = matchedSeries;
			this.settings.activeSeriesId = sid;
			const current = this.settings.activeBookId ? bookRegistry[this.settings.activeBookId] : undefined;
			if (!current || current.seriesId !== sid) {
				const firstBook = Object.entries(bookRegistry).find(([, b]) => b.seriesId === sid);
				if (firstBook) this.settings.activeBookId = firstBook[0];
			}
		} else {
			// A standalone project belongs to no series: leaving the previous
			// series "active" made the Timeline / Codex / Social Maps keep opening
			// THAT series instead of the project the user just opened. Everything
			// follows the active project.
			this.settings.activeSeriesId = undefined;
		}
		await this.saveData(this.settings);
		document.dispatchEvent(new CustomEvent('storygrid:project-changed'));
	}

	/**
	 * The ONE project root every "open X" (Codex, Timeline, Social Maps…) uses
	 * when no explicit root is passed: the active project if its folder still
	 * exists → the active series root if it still exists → the first project in
	 * the vault. Keeps all views on the same project ("everything is connected").
	 */
	resolveActiveRoot(): string {
		const exists = (p: string | undefined): p is string =>
			!!p && this.app.vault.getAbstractFileByPath(p) instanceof TFolder;
		if (exists(this.settings.activeProjectRoot)) return this.settings.activeProjectRoot;
		if (this.settings.isSeriesMode && this.settings.activeSeriesId) {
			const seriesRoot = this.settings.seriesRegistry?.[this.settings.activeSeriesId]?.rootPath;
			if (exists(seriesRoot)) return seriesRoot;
		}
		return findProjects(this.app)[0]?.rootPath ?? '';
	}

	/** The active series' folder in series mode, else undefined — how a book maps to its whole series in Social Maps. */
	activeSeriesRoot(): string | undefined {
		if (!this.settings.isSeriesMode || !this.settings.activeSeriesId) return undefined;
		return this.settings.seriesRegistry?.[this.settings.activeSeriesId]?.rootPath;
	}

	/**
	 * Drop series (and their books) whose folder and every book grid are gone
	 * from the vault — deleted in the file explorer, so the delete handler never
	 * saw them. A ghost series otherwise keeps resolving as an empty scope and
	 * can stay "active" forever. Runs once at startup.
	 */
	private async pruneDeadSeries(): Promise<void> {
		const seriesRegistry = this.settings.seriesRegistry ?? {};
		const bookRegistry = this.settings.bookRegistry ?? {};
		let changed = false;
		for (const [sid, series] of Object.entries(seriesRegistry)) {
			const rootExists = this.app.vault.getAbstractFileByPath(series.rootPath) instanceof TFolder;
			const books = Object.entries(bookRegistry).filter(([, b]) => b.seriesId === sid);
			const anyBookExists = books.some(([, b]) => b.gridPath && this.app.vault.getAbstractFileByPath(b.gridPath) instanceof TFile);
			if (rootExists || anyBookExists) continue;
			delete seriesRegistry[sid];
			for (const [bid] of books) delete bookRegistry[bid];
			if (this.settings.activeSeriesId === sid) this.settings.activeSeriesId = undefined;
			if (this.settings.activeBookId && books.some(([bid]) => bid === this.settings.activeBookId)) this.settings.activeBookId = undefined;
			if (this.settings.activeProjectRoot === series.rootPath) this.settings.activeProjectRoot = '';
			changed = true;
		}
		if (changed && Object.keys(seriesRegistry).length === 0) this.settings.isSeriesMode = false;
		if (changed) {
			await this.saveData(this.settings);
			document.dispatchEvent(new CustomEvent('storygrid:project-changed'));
		}
	}

	/**
	 * A .storygrid file was deleted: drop the book it backed from the registry,
	 * drop its series once no books remain, and clear active pointers that now
	 * dangle. Driven by the vault delete *event* rather than a disk scan on
	 * purpose — a synced vault can have files temporarily missing, and a scan
	 * could prune a book that is merely mid-sync. Here we know it was deleted.
	 */
	private async pruneDeletedProject(deletedPath: string): Promise<void> {
		if (!deletedPath.endsWith('.storygrid')) return;

		const bookRegistry = this.settings.bookRegistry ?? {};
		const seriesRegistry = this.settings.seriesRegistry ?? {};
		let changed = false;

		for (const [bid, book] of Object.entries(bookRegistry)) {
			if (book.gridPath !== deletedPath) continue;
			delete bookRegistry[bid];
			changed = true;
			if (this.settings.activeBookId === bid) {
				this.settings.activeBookId = undefined;
			}
			// Series with no books left is dead weight; its entry would otherwise
			// keep resolving as an empty phantom scope.
			const seriesStillUsed = Object.values(bookRegistry).some((b) => b.seriesId === book.seriesId);
			if (!seriesStillUsed && seriesRegistry[book.seriesId]) {
				const deadRoot = seriesRegistry[book.seriesId].rootPath;
				delete seriesRegistry[book.seriesId];
				if (this.settings.activeSeriesId === book.seriesId) {
					this.settings.activeSeriesId = undefined;
				}
				if (this.settings.activeProjectRoot === deadRoot) {
					this.settings.activeProjectRoot = '';
				}
			}
		}

		// Standalone project (or the book's own folder) was the active one.
		const deletedRoot = projectRootFromGridPath(deletedPath);
		if (deletedRoot && this.settings.activeProjectRoot === deletedRoot) {
			this.settings.activeProjectRoot = '';
			changed = true;
		}

		if (!changed) return;
		await this.saveData(this.settings);
		document.dispatchEvent(new CustomEvent('storygrid:project-changed'));
	}

	/**
	 * Focus a whole series: make sure its Series Arc grid exists (a normal
	 * .storygrid at the series root, one column per book — home for arcs that
	 * span books), then make the series root the active project.
	 */
	async focusEntireSeries(seriesId: string): Promise<void> {
		const series = this.settings.seriesRegistry?.[seriesId];
		if (!series) return;
		await this.ensureSeriesArcGrid(seriesId);
		if (this.settings.activeProjectRoot === series.rootPath) {
			// Already focused — just make sure the series id is current.
			this.settings.activeSeriesId = seriesId;
			await this.saveData(this.settings);
			document.dispatchEvent(new CustomEvent('storygrid:project-changed'));
		} else {
			await this.setActiveProjectRoot(series.rootPath);
		}
		new Notice(`Focused: ${series.name} (entire series)`);
	}

	/** Create the series-level arc grid on first entire-series focus. */
	private async ensureSeriesArcGrid(seriesId: string): Promise<TFile | null> {
		const series = this.settings.seriesRegistry?.[seriesId];
		if (!series) return null;
		// Any grid already sitting at the series root counts as the arc grid
		const atRoot = this.app.vault.getFiles().find(
			(f) => f.extension === 'storygrid' && projectRootFromGridPath(f.path) === series.rootPath,
		);
		if (atRoot) return atRoot;
		const grid = createEmptyGrid(`${series.name} — Series Arc`);
		const books = Object.values(this.settings.bookRegistry ?? {}).filter((b) => b.seriesId === seriesId);
		grid.columns = books.length > 0
			? books.map((b, i) => ({ id: generateId(), label: b.name, order: i }))
			: [{ id: generateId(), label: 'Book 1', order: 0 }];
		grid.rows = ['Character arcs', 'Plot threads', 'World & lore']
			.map((label, i) => ({ id: generateId(), label, order: i }));
		const safeName = `${series.name} — Series Arc`.replace(/[\\/:*?"<>|]/g, '-');
		const path = series.rootPath ? `${series.rootPath}/${safeName}.storygrid` : `${safeName}.storygrid`;
		try {
			const file = await this.app.vault.create(path, JSON.stringify(grid, null, 2));
			new Notice(`Created "${safeName}" — a grid for arcs that span the whole series.`);
			return file;
		} catch {
			return null;
		}
	}

	/** Open (or reveal) the Activity / History view. */
	async openHistory(projectRoot?: string): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HISTORY)[0];
		const view = await loadedView(existing, StorygridHistoryView);
		if (existing && view) {
			await this.app.workspace.revealLeaf(existing);
			if (projectRoot !== undefined) await view.showProject(projectRoot);
			return;
		}
		const root = projectRoot ?? this.settings.activeProjectRoot ?? findProjects(this.app)[0]?.rootPath ?? '';
		const leaf = existing ?? this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_HISTORY, active: true, state: { projectRoot: root } });
		this.app.workspace.revealLeaf(leaf);
	}

	/** Manually snapshot every scene in a project, asking which project when several exist. */
	async snapshotProjectNowCommand(): Promise<void> {
		const scopes = findCodexScopes(this.app, this.settings);
		if (scopes.length === 0) {
			new Notice('No story projects found — create a plot grid first.');
			return;
		}
		const run = async (rootPath: string) => {
			const count = await snapshotProjectNow(this.app, rootPath);
			new Notice(count > 0 ? `Snapshotted ${count} scene${count === 1 ? '' : 's'}.` : 'All scenes already match their latest snapshot.');
		};
		if (scopes.length === 1) {
			await run(scopes[0].rootPath);
			return;
		}
		new (class extends FuzzySuggestModal<StoryProject> {
			getItems(): StoryProject[] { return scopes; }
			getItemText(p: StoryProject): string { return p.name; }
			onChooseItem(p: StoryProject): void { void run(p.rootPath); }
		})(this.app).open();
	}

	async openCodex(projectRoot?: string, detailPath?: string, fromTab?: SocialMapsTab): Promise<void> {
		// Resolve the authoritative project once, up front, so the Codex never
		// flashes a stale/wrong project (e.g. the alphabetically-first one) before
		// correcting itself. Priority: explicit arg → the one active root every
		// view shares (resolveActiveRoot).
		const root = projectRoot || this.resolveActiveRoot();

		let targetLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX)[0];
		if (!targetLeaf) {
			targetLeaf = this.app.workspace.getLeaf('tab');
			await targetLeaf.setViewState({ type: VIEW_TYPE_CODEX, state: { projectRoot: root } });
		}

		// Close any duplicate codex leaves that may have opened (e.g. rapid double-click)
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX)) {
			if (leaf !== targetLeaf) leaf.detach();
		}

		// A Codex tab Obsidian hasn't loaded since startup holds a placeholder:
		// load it first (one load, then the reveal — never both at once).
		let view = await loadedView(targetLeaf, StorygridCodexView);
		if (!view) {
			await targetLeaf.setViewState({ type: VIEW_TYPE_CODEX, state: { projectRoot: root } });
			view = await loadedView(targetLeaf, StorygridCodexView);
		}
		await this.app.workspace.revealLeaf(targetLeaf);
		if (!view) return;
		// Always re-sync the (possibly stale) revealed view to the resolved project
		// before doing anything else — clears old content in the same tick.
		await view.showProject(root);
		if (detailPath) {
			// Remember which Social Maps leaf (and tab) the writer came from, so the
			// entry page can offer a way back. Only when that leaf is open right now.
			const socialLeaf = fromTab ? this.app.workspace.getLeavesOfType(VIEW_TYPE_SOCIAL_MAPS)[0] : undefined;
			await view.openEntityDetail(detailPath, fromTab && socialLeaf ? { leaf: socialLeaf, tab: fromTab } : undefined);
		} else {
			view.goHome();
		}
	}

	/**
	 * Social Maps double-click / Ctrl-click: a Codex entry opens as its Codex
	 * page (the formatted view), anything the Codex doesn't know opens as the note.
	 * `fromTab` is the Social Maps tab that asked — it powers the Codex page's
	 * "Back to …" button.
	 */
	async openEntryInCodex(projectRoot: string, path: string, fromTab?: SocialMapsTab): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		if (this.entityIndex.getAllEntities().some((e) => e.file.path === path)) {
			await this.openCodex(projectRoot, path, fromTab);
		} else {
			await openOrReveal(this.app, file);
		}
	}

	/** True while `leaf` is still an open Social Maps tab (it may have been closed since). */
	isSocialMapsLeafOpen(leaf: WorkspaceLeaf): boolean {
		return this.app.workspace.getLeavesOfType(VIEW_TYPE_SOCIAL_MAPS).includes(leaf);
	}

	/** Codex "Back to …" button: bring the Social Maps tab it came from back to the front, on the same tab. */
	returnToSocialMaps(leaf: WorkspaceLeaf, tab: SocialMapsTab): void {
		if (!this.isSocialMapsLeafOpen(leaf)) return;
		if (leaf.view instanceof SocialMapsView) leaf.view.switchTo(tab);
		this.app.workspace.revealLeaf(leaf);
	}

	/** Codex "View family tree" on a Bloodline entry: the Story Tree's family view, showing only the families tied to it. */
	async openFamilyTree(scopeRoot: string, bloodlinePath: string): Promise<void> {
		await this.openScopedTree(scopeRoot, { mode: 'family', focusPath: '', bloodlinePath, factionPath: '' });
	}

	/** Codex "View faction tree" on a faction entry: the Story Tree's faction hierarchy, showing only that faction. */
	async openFactionTree(scopeRoot: string, factionPath: string): Promise<void> {
		await this.openScopedTree(scopeRoot, { mode: 'faction', focusPath: '', bloodlinePath: '', factionPath });
	}

	/** Codex "View family tree" on a character: the Family tree focused on them, their family around them. */
	async openPersonFamilyTree(scopeRoot: string, personPath: string): Promise<void> {
		await this.openScopedTree(scopeRoot, { mode: 'family', focusPath: personPath, bloodlinePath: '', factionPath: '' });
	}

	private async openScopedTree(scopeRoot: string, tree: Record<string, unknown>): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SOCIAL_MAPS)[0];
		await existing?.loadIfDeferred?.();
		if (existing && existing.view instanceof SocialMapsView) {
			existing.view.showStoryTree(tree, scopeRoot);
			this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = existing ?? this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_SOCIAL_MAPS, active: true, state: { activeTab: 'tree', scopeRoot, explicitScope: true, tree } });
		this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Stamp a stable `storygrid-id` onto any entity file that lacks one.
	 * Called once after the index is built on startup. Uses processFrontMatter
	 * so only the frontmatter block is touched; prose is never rewritten.
	 */
	private async stampMissingEntityIds(): Promise<void> {
		const allEntities = this.entityIndex.getAllEntities();
		for (const entity of allEntities) {
			if (entity.entityId !== null) continue;
			try {
				await this.app.fileManager.processFrontMatter(entity.file, (fm) => {
					if (!fm['storygrid-id']) fm['storygrid-id'] = generateEntityId();
				});
			} catch {
				// Non-fatal — the next change event will retry via the index
			}
		}
	}

	/**
	 * Update `linkedDocPath` on cards in all closed grid files when a linked
	 * document (or a folder containing one) is renamed or moved.
	 */
	/**
	 * A Codex sheet was renamed or moved (from any view, or Obsidian's file
	 * list): its picture folder follows (see `shouldFollowRename` for the one
	 * case that is left alone: a whole project folder moved).
	 */
	private async followSheetImages(file: TAbstractFile, oldPath: string): Promise<void> {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		if (!shouldFollowRename(this.app, file, oldPath)) return;
		// Moves wait until renames have been quiet for a moment, so Obsidian's
		// own link updates for the renamed sheet(s) run first and the two never
		// edit the same note at once. Then they run one at a time: a renamed
		// folder fires once per sheet inside it, and two moves must not race to
		// create the same new folder.
		this.pendingImageFollows.push({ file, oldPath });
		if (this.imageFollowTimer !== null) window.clearTimeout(this.imageFollowTimer);
		this.imageFollowTimer = window.setTimeout(() => {
			this.imageFollowTimer = null;
			const batch = this.pendingImageFollows.splice(0);
			for (const { file: sheet, oldPath: from } of batch) {
				this.imageFollowQueue = this.imageFollowQueue.then(async () => {
					try {
						await followSheetRename(this.app, sheet, from);
					} catch (err) {
						new Notice(t('codex.images.notice.followFailed', { msg: err instanceof Error ? err.message : '' }));
					}
				});
			}
		}, 500);
	}
	private pendingImageFollows: Array<{ file: TFile; oldPath: string }> = [];
	private imageFollowTimer: number | null = null;
	private imageFollowQueue: Promise<void> = Promise.resolve();

	async syncRenamedDocLinks(file: TAbstractFile, oldPath: string): Promise<void> {
		const isFile = file instanceof TFile;
		if (isFile && file.extension !== 'md' && file.extension !== 'canvas') return;
		const oldPrefix = `${oldPath}/`;
		const newPrefix = `${file.path}/`;

		// Grids LOADED in a view manage their own renames — skip those. A tab
		// Obsidian hasn't loaded yet reads the file fresh later, so fix it on disk.
		const openPaths = new Set(
			liveViews(this.app.workspace, VIEW_TYPE_STORYGRID, StorygridView).map((v) => v.getFilePath())
		);

		for (const gridFile of this.findAllGridFiles()) {
			if (openPaths.has(gridFile.path)) continue;
			try {
				const grid = JSON.parse(await this.app.vault.read(gridFile));
				let changed = false;
				const cards = (grid.cards ?? []).map((c: { linkedDocPath?: string }) => {
					if (!c.linkedDocPath) return c;
					if (isFile && c.linkedDocPath === oldPath) {
						changed = true;
						return { ...c, linkedDocPath: file.path };
					}
					if (!isFile && c.linkedDocPath.startsWith(oldPrefix)) {
						changed = true;
						return { ...c, linkedDocPath: newPrefix + c.linkedDocPath.slice(oldPrefix.length) };
					}
					return c;
				});
				if (changed) {
					await this.app.vault.modify(
						gridFile,
						JSON.stringify({ ...grid, cards, updatedAt: new Date().toISOString() }, null, 2)
					);
				}
			} catch {
				// Unreadable grid — leave it alone
			}
		}

		// Patch task link.path in dashboard settings when a linked doc is renamed.
		let taskLinksChanged = false;
		const changedRoots = new Set<string>();
		const dash = this.settings.dashboard;
		if (dash) {
			for (const [root, projectTodos] of Object.entries(dash.todos ?? {})) {
				for (const todo of projectTodos) {
					if (!todo.link) continue;
					if (isFile && todo.link.path === oldPath) {
						todo.link.path = file.path;
						todo.link.label = (file as TFile).basename;
						taskLinksChanged = true;
						changedRoots.add(root);
					} else if (!isFile && todo.link.path.startsWith(oldPrefix)) {
						todo.link.path = newPrefix + todo.link.path.slice(oldPrefix.length);
						taskLinksChanged = true;
						changedRoots.add(root);
					}
				}
			}
			// Writers Panel manuscript order tracks scene docs by path — patch it
			// too so a renamed scene keeps its place instead of dropping to the end.
			for (const [root, order] of Object.entries(dash.sceneOrder ?? {})) {
				for (let i = 0; i < order.length; i++) {
					if (isFile && order[i] === oldPath) {
						order[i] = file.path;
						taskLinksChanged = true;
						changedRoots.add(root);
					} else if (!isFile && order[i].startsWith(oldPrefix)) {
						order[i] = newPrefix + order[i].slice(oldPrefix.length);
						taskLinksChanged = true;
						changedRoots.add(root);
					}
				}
			}
			// Same for the outline tree — patch doc-node paths, structure untouched.
			for (const [root, tree] of Object.entries(dash.sceneTree ?? {})) {
				const affected = collectDocPaths(tree).filter((p) =>
					isFile ? p === oldPath : p.startsWith(oldPrefix)
				);
				if (!affected.length) continue;
				let next = tree;
				for (const oldp of affected) {
					const newp = isFile ? file.path : newPrefix + oldp.slice(oldPrefix.length);
					next = renameDocPath(next, oldp, newp);
				}
				dash.sceneTree![root] = next;
				taskLinksChanged = true;
				changedRoots.add(root);
			}
			// "Who's gone quiet": a renamed character stays left out.
			for (const [root, paths] of Object.entries(dash.quietLeftOut ?? {})) {
				for (let i = 0; i < paths.length; i++) {
					if (isFile ? paths[i] === oldPath : paths[i].startsWith(oldPrefix)) {
						paths[i] = isFile ? file.path : newPrefix + paths[i].slice(oldPrefix.length);
						taskLinksChanged = true;
						changedRoots.add(root);
					}
				}
			}
		}
		if (taskLinksChanged) {
			await this.saveData(this.settings);
			for (const root of changedRoots) void writeProjectMirror(this.app, root, dash!);
		}
	}

	/**
	 * Keep per-grid compile choices attached across renames and moves. The state
	 * is keyed by grid file path and holds scene doc paths (`excluded`) plus a
	 * cover image path — none of which Obsidian rewrites for us, so without this
	 * a renamed scene silently rejoins the export and the cover goes missing.
	 * Not folded into `syncRenamedDocLinks`: that one only runs for .md/.canvas,
	 * while these paths point at .storygrid files and images too.
	 */
	async syncRenamedCompileState(file: TAbstractFile, oldPath: string): Promise<void> {
		const state = this.settings.compileState;
		if (!state) return;
		const isFile = file instanceof TFile;
		const oldPrefix = `${oldPath}/`;
		const newPrefix = `${file.path}/`;
		const remap = (p: string): string | null => {
			if (isFile && p === oldPath) return file.path;
			if (!isFile && p.startsWith(oldPrefix)) return newPrefix + p.slice(oldPrefix.length);
			return null;
		};

		let changed = false;
		for (const gridPath of Object.keys(state)) {
			const entry = state[gridPath];
			if (!entry) continue;
			if (entry.excluded) {
				for (let i = 0; i < entry.excluded.length; i++) {
					const next = remap(entry.excluded[i]);
					if (next) {
						entry.excluded[i] = next;
						changed = true;
					}
				}
			}
			if (entry.coverImagePath) {
				const next = remap(entry.coverImagePath);
				if (next) {
					entry.coverImagePath = next;
					changed = true;
				}
			}
			const nextGridPath = remap(gridPath);
			if (nextGridPath && nextGridPath !== gridPath) {
				state[nextGridPath] = entry;
				delete state[gridPath];
				changed = true;
			}
		}
		if (changed) await this.saveData(this.settings);
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	async loadSettings(): Promise<void> {
		this.settings = mergeSettings(DEFAULT_SETTINGS, await this.loadData());
		// Migrate pre-profession intent ids (plotWrite/buildWorld/…) silently.
		if (this.settings.intent && LEGACY_INTENT_MAP[this.settings.intent as string]) {
			const legacy = this.settings.intent as string;
			this.settings.intent = LEGACY_INTENT_MAP[legacy];
			if (legacy === 'plotWrite') this.settings.writingStyle = 'plotter';
			await this.saveSettings();
		}
		// Merge legacy connectionsMap/storyTree module flags into the new socialMaps flag.
		this.settings.enabledModules = migrateEnabledModules(this.settings.enabledModules as Record<string, boolean> | undefined) as typeof this.settings.enabledModules;
		// Merge any user-defined custom kinds into the live kind registry.
		initKindRegistry(this.settings.customKinds ?? []);
		// Prose Coach: highlightsAlwaysOn/helpLevel → mode (off | revising | always).
		if (this.settings.proseCoach && migrateProseCoach(this.settings.proseCoach)) await this.saveSettings();
		await this.migrateCompileWorkflows();
	}

	/**
	 * One-time migration to the named-workflow compile model. A pre-overhaul
	 * single `compileWorkflow` becomes the first entry of `compileWorkflows`;
	 * per-grid `excluded` card ids are remapped to their scene doc paths (the
	 * new scene-list key). Runs only while `compileWorkflows` is unset.
	 */
	private async migrateCompileWorkflows(): Promise<void> {
		if (this.settings.compileWorkflows) return;
		this.settings.compileWorkflows = [migrateLegacyWorkflow(this.settings.compileWorkflow)];
		delete this.settings.compileWorkflow;

		// Remap excluded card ids → linked scene doc paths, per grid.
		const state = this.settings.compileState;
		if (state) {
			for (const gridPath of Object.keys(state)) {
				const entry = state[gridPath];
				if (!entry?.excluded?.length) continue;
				const grid = await this.readGridData(gridPath);
				if (!grid) continue;
				const byId = new Map(grid.cards.map((c) => [c.id, c.linkedDocPath]));
				entry.excluded = entry.excluded
					.map((id) => byId.get(id))
					.filter((p): p is string => !!p && p.endsWith('.md'));
			}
		}
		await this.saveData(this.settings);
	}

	/** Read and parse a `.storygrid` file's GridData, or null if unreadable. */
	private async readGridData(path: string): Promise<GridData | null> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return null;
		try {
			return JSON.parse(await this.app.vault.read(f)) as GridData;
		} catch {
			return null;
		}
	}

	/** One-time-per-launch: mirror each project's tasks/goals/stats into its own
	 *  vault folder, and recover from that mirror if local settings are missing
	 *  a project (e.g. after reinstall or a data.json sync conflict). */
	private async syncProjectDataMirrors(): Promise<void> {
		const dash = ensureDashboard(this.settings);
		const roots = findProjects(this.app).map((p) => p.rootPath);
		// Before anything writes pvbackup/: fold in the safety folder's first name (Plotverk/).
		await migrateSafetyFolders(this.app);
		const changed = await syncProjectMirrors(this.app, dash, roots);
		if (changed) await this.saveData(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.applyCodexSheetClasses();
		// Notify all open grid views to re-render with updated settings
		(this.app.workspace as any).trigger('storygrid:settings-changed');
		this._injectSidebarTabButtons();
	}

	/** Persist settings without the vault-wide `settings-changed` broadcast —
	 *  for settings that only the view writing them ever reads (e.g. Connections
	 *  Map force sliders), so other open views don't re-render for no reason. */
	async saveSettingsQuiet(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Codex sheet styling is driven by body classes so existing documents
	 * respond to settings changes without being rewritten.
	 */
	applyCodexSheetClasses(): void {
		document.body.classList.toggle('sg-sheets-styled', this.settings.codexSheetStyling);
		document.body.classList.remove('sg-infobox-left', 'sg-infobox-top');
		if (this.settings.codexInfoboxPosition === 'left') document.body.classList.add('sg-infobox-left');
		if (this.settings.codexInfoboxPosition === 'top') document.body.classList.add('sg-infobox-top');
	}

	// ─── Grid opening and creation ────────────────────────────────────────────

	async openOrCreateGrid(): Promise<void> {
		const grids = this.findAllGridFiles();
		if (grids.length === 0) {
			await this.createNewGrid();
		} else {
			await this.openGridPicker();
		}
	}

	findAllGridFiles(): TFile[] {
		return this.app.vault.getFiles().filter((f) => f.extension === 'storygrid');
	}

	/**
	 * New-project flow: ask series vs standalone, collect names, then pick a
	 * template and build the grid(s).
	 *   • standalone → one grid under the grid folder.
	 *   • series     → register the series + every book, build a grid per book
	 *                  (all sharing the chosen template), open the first.
	 */
	async createNewGrid(): Promise<void> {
		new GridScopeModal(this.app, this, (result) => {
			if (result.kind === 'standalone') {
				this.pickTemplate(result.novelName, async (templateId) => {
					const file = await this.createGridFile(result.novelName, this.settings.gridFolder, templateId);
					if (file) {
						new Notice(t('wizard.notice.projectCreated', { name: result.novelName }));
						await this.landAfterProjectCreation(file);
					}
				});
			} else {
				void this.setupSeries(result.seriesName, result.bookNames);
			}
		}).open();
	}

	/** Register a new series + its books, then pick one template and build a grid per book. */
	private async setupSeries(seriesName: string, bookNames: string[]): Promise<void> {
		const sid = 'series_' + generateId().slice(0, 8);
		const safeSeries = seriesName.replace(/[\\/:*?"<>|]/g, '-');
		const seriesRoot = this.settings.gridFolder ? `${this.settings.gridFolder}/${safeSeries}` : safeSeries;

		if (!this.settings.seriesRegistry) this.settings.seriesRegistry = {};
		if (!this.settings.bookRegistry) this.settings.bookRegistry = {};
		this.settings.seriesRegistry[sid] = { name: seriesName, rootPath: seriesRoot };

		const bookIds: string[] = [];
		for (const name of bookNames) {
			const bid = 'book_' + generateId().slice(0, 8);
			// gridPath is filled in below, as soon as each book's grid file is created.
			this.settings.bookRegistry[bid] = { name, seriesId: sid, gridPath: '' };
			bookIds.push(bid);
		}

		this.settings.isSeriesMode = true;
		this.settings.activeSeriesId = sid;
		this.settings.activeBookId = bookIds[0];
		await this.saveSettings();

		this.pickTemplate(bookNames[0], async (templateId) => {
			let firstFile: TFile | null = null;
			for (let i = 0; i < bookIds.length; i++) {
				const file = await this.createGridFile(bookNames[i], seriesRoot, templateId);
				if (file) {
					this.settings.bookRegistry![bookIds[i]].gridPath = file.path;
					if (i === 0) firstFile = file;
				}
			}
			await this.saveSettings();
			new Notice(bookIds.length === 1
				? wizardText(this.settings.intent, 'wizard.notice.seriesCreated.one', { name: seriesName })
				: wizardText(this.settings.intent, 'wizard.notice.seriesCreated.other', { name: seriesName, count: bookIds.length }));
			if (firstFile) await this.landAfterProjectCreation(firstFile);
		});
	}

	/** Open the template picker (NewGridModal at the template step) and return the chosen id. */
	private pickTemplate(defaultName: string, onPick: (templateId: string) => void | Promise<void>): void {
		new NewGridModal(
			this.app,
			'',
			async (_name, _folder, templateId) => { await onPick(templateId); },
			this.settings.customTemplates,
			3,
			defaultName
		).open();
	}

	/** Create one .storygrid file + its project folders under `parentFolder`. Returns the file or null on error. */
	private async createGridFile(name: string, parentFolder: string, templateId: string): Promise<TFile | null> {
		const safeName = name.trim().replace(/[\\/:*?"<>|]/g, '-');
		const gridFolderPath = parentFolder ? `${parentFolder}/${safeName}` : safeName;
		const gridFilePath = `${gridFolderPath}/${safeName}.storygrid`;

		let gridData = createEmptyGrid(name.trim(), templateId);
		const template =
			getTemplateById(templateId) ??
			this.settings.customTemplates.find((t) => t.id === templateId);
		if (template) gridData = applyTemplate(gridData, template, t('grid.guide.header'));

		try {
			const { charactersPath, scenesPath, locationsPath } = await buildProjectStructure(
				this.app,
				parentFolder,
				safeName
			);
			const file = await this.app.vault.create(gridFilePath, JSON.stringify(gridData, null, 2));
			this.lastProjectPaths = { charactersPath, scenesPath, locationsPath };
			this.newGridTourPaths.add(file.path);
			return file;
		} catch (err) {
			new Notice(t('wizard.notice.createFailed', { reason: err instanceof Error ? err.message : '' }));
			return null;
		}
	}

	async openGridPicker(): Promise<void> {
		const grids = this.findAllGridFiles();
		if (grids.length === 0) {
			// No grids exist yet — go straight to the wizard
			await this.createNewGrid();
			return;
		}
		new GridPickerModal(
			this.app,
			(file: TFile) => this.openGridFile(file),
			() => this.createNewGrid()
		).open();
	}

	async openGridFile(file: TFile): Promise<void> {
		// Saved state, not leaf.view: a not-yet-loaded tab of this grid must be
		// found too, or a second tab of the same grid opens.
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_STORYGRID).find(
			(leaf) => (leafStateString(leaf, 'filePath') ?? leafStateString(leaf, 'file')) === file.path
		);

		if (existing) {
			this.app.workspace.revealLeaf(existing);
			return;
		}

		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: VIEW_TYPE_STORYGRID,
			state: { filePath: file.path },
		});
		this.app.workspace.revealLeaf(leaf);
	}
}

/** One row in the project switcher: a standalone book project or a whole series. */
type SwitchEntry =
	| { kind: 'book'; name: string; rootPath: string }
	| { kind: 'series'; name: string; rootPath: string; seriesId: string; bookCount: number };

/** Fuzzy picker for the globally active project (ribbon hub menu → Switch project…). */
class ProjectSwitchModal extends FuzzySuggestModal<SwitchEntry> {
	constructor(app: App, private plugin: StorygridPlugin) {
		super(app);
		this.setPlaceholder('Switch active project…');
	}

	getItems(): SwitchEntry[] {
		const s = this.plugin.settings;
		const entries: SwitchEntry[] = [];
		const seriesRegistry = (s.isSeriesMode ? s.seriesRegistry : undefined) ?? {};
		const bookRegistry = s.bookRegistry ?? {};
		const seriesRoots = new Set<string>();
		const bookGridPaths = new Set(
			Object.values(bookRegistry).map((b) => b.gridPath).filter(Boolean),
		);
		for (const [sid, sr] of Object.entries(seriesRegistry)) {
			const bookCount = Object.values(bookRegistry).filter((b) => b.seriesId === sid).length;
			entries.push({ kind: 'series', name: sr.name, rootPath: sr.rootPath, seriesId: sid, bookCount });
			seriesRoots.add(sr.rootPath);
		}
		for (const p of findProjects(this.app)) {
			if (seriesRoots.has(p.rootPath)) continue; // the series arc grid's root
			if (p.gridFiles.every((g) => bookGridPaths.has(g.path))) continue; // books listed via their series
			entries.push({ kind: 'book', name: p.name, rootPath: p.rootPath });
		}
		return entries;
	}

	getItemText(e: SwitchEntry): string {
		return e.name;
	}

	renderSuggestion(match: FuzzyMatch<SwitchEntry>, el: HTMLElement): void {
		const e = match.item;
		el.addClass('sg-switch-suggestion');
		el.createSpan({ cls: 'sg-switch-name', text: e.name });
		el.createSpan({
			cls: 'sg-switch-badge' + (e.kind === 'series' ? ' sg-switch-badge--series' : ''),
			text: e.kind === 'series'
				? `Series · ${e.bookCount} book${e.bookCount === 1 ? '' : 's'}`
				: 'Book',
		});
	}

	onChooseItem(e: SwitchEntry): void {
		if (e.kind === 'series') {
			new SeriesFocusModal(this.app, this.plugin, e.seriesId, e.name).open();
		} else {
			void this.plugin.setActiveProjectRoot(e.rootPath).then(() => {
				new Notice(`Active project: ${e.name}`);
			});
		}
	}
}

/** Second step after picking a series: focus the whole series, or one of its books. */
class SeriesFocusModal extends FuzzySuggestModal<{ label: string; badge: string; bookRoot?: string }> {
	constructor(
		app: App,
		private plugin: StorygridPlugin,
		private seriesId: string,
		private seriesName: string,
	) {
		super(app);
		this.setPlaceholder(`Focus ${seriesName} on…`);
	}

	getItems(): Array<{ label: string; badge: string; bookRoot?: string }> {
		const items: Array<{ label: string; badge: string; bookRoot?: string }> = [
			{ label: `Entire series — ${this.seriesName}`, badge: 'Series' },
		];
		const bookRegistry = this.plugin.settings.bookRegistry ?? {};
		for (const b of Object.values(bookRegistry)) {
			if (b.seriesId !== this.seriesId || !b.gridPath) continue;
			items.push({ label: b.name, badge: 'Book', bookRoot: projectRootFromGridPath(b.gridPath) });
		}
		return items;
	}

	getItemText(it: { label: string }): string {
		return it.label;
	}

	renderSuggestion(match: FuzzyMatch<{ label: string; badge: string; bookRoot?: string }>, el: HTMLElement): void {
		el.addClass('sg-switch-suggestion');
		el.createSpan({ cls: 'sg-switch-name', text: match.item.label });
		el.createSpan({
			cls: 'sg-switch-badge' + (match.item.badge === 'Series' ? ' sg-switch-badge--series' : ''),
			text: match.item.badge,
		});
	}

	onChooseItem(it: { label: string; bookRoot?: string }): void {
		if (it.bookRoot !== undefined) {
			void this.plugin.setActiveProjectRoot(it.bookRoot).then(() => {
				new Notice(`Focused: ${it.label}`);
			});
		} else {
			void this.plugin.focusEntireSeries(this.seriesId);
		}
	}
}

/** The CodeMirror view inside a Markdown leaf (not in Obsidian's typings). */
function coachEditorView(view: unknown): EditorView | null {
	if (!(view instanceof MarkdownView)) return null;
	return (view.editor as unknown as { cm?: EditorView }).cm ?? null;
}
