// Grid data types and pure helper functions.
// No Obsidian API imports in this file — it is pure TypeScript.

// Type-only import (erased at compile time — no runtime dependency cycle).
import type { EntityKindSpec } from './entities/entity-kinds';
import type { CustomRelationshipType } from './utils/relations';
import type { ModuleId, IntentId, WritingStyle, WritersPanelTab } from './modules';
import type { SceneTree } from './utils/scene-tree';
import type { FieldType, FieldConfig } from './entities/field-types';
import type { ForceSettings } from './utils/force-sim';
import type { TimelineAppearance } from './timeline/timeline-appearance';
import type { StartMode } from './entities/start-mode';
import type { ProseCoachSettings } from './prose/coach-settings';

export type QuickLinkKey = 'codex' | 'grid' | 'dashboard' | 'connectionsMap' | 'timeline';
/**
 * WHERE a quick-link shortcut appears. These are two genuinely different
 * places, not one slider between them:
 *  - 'panel' — INSIDE the Writers Panel, in its own header row. The default.
 *  - 'top'   — ABOVE it, in Obsidian's sidebar tab strip beside the Writers
 *              Panel tab. NEVER a default; only ever a manual choice.
 *  - 'both'  — manual only. Nothing may put a shortcut in both places on its
 *              own: not a default, and never as part of a writing mode.
 */
export type QuickLinkPlacement = 'top' | 'panel' | 'both';

export type CardStatus = 'idea' | 'outline' | 'draft' | 'written' | 'revised' | 'final';
export type LinkDisplayMode = 'first-lines' | 'synopsis' | 'title-only';
/** Which grid axis provides the manuscript's section headings (and primary story order). */
export type ManuscriptHeadingSource = 'columns' | 'rows' | 'none';

export interface GridRow {
	id: string;
	label: string;
	color?: string;
	height?: number;
	width?: number;
	order: number;
	/** Template-only: the beat's guide text ("~10% · what belongs here"). applyTemplate turns it into an ordinary card in a first "Beat guide" column and does not keep it on the row. */
	hint?: string;
}

export interface GridColumn {
	id: string;
	label: string;
	color?: string;
	width?: number;
	order: number;
}

export interface SceneCard {
	id: string;
	rowId: string;
	colId: string;
	title: string;
	synopsis: string;
	color: string;
	status: CardStatus;
	linkedDocPath?: string;
	linkDisplayMode: LinkDisplayMode;
	tags?: string[];
	frameColor?: string;
	povCharacter?: string;
	location?: string;
	characterPaths?: string[];
	/** Codex entity file paths for non-character kinds (location, faction, system, item, research), keyed by EntityKind. */
	linkedEntityPaths?: Record<string, string[]>;
	conflict?: string;
	act?: string;
	chapter?: string;
	sceneIcon?: string;
	/** A template's Beat guide card (explains the beat, not part of the story): editable like any card, left out of the Dashboard's counts. */
	guide?: boolean;
	/** Target word count for this scene (0 or missing = no goal). */
	wordGoal?: number;
}

export interface GridData {
	version: 1;
	id: string;
	name: string;
	templateId?: string;
	rows: GridRow[];
	columns: GridColumn[];
	cards: SceneCard[];
	/** Lightweight text notes per cell. Key format: "${rowId}:${colId}" */
	cellTexts?: Record<string, string>;
	/** Last-used zoom level for this grid (0.5–2.0). Optional; defaults to 1. */
	zoom?: number;
	createdAt: string;
	updatedAt: string;
}

export interface CharacterField {
	id: string;
	label: string;
	value: string;
	type: FieldType;
	/** Hover-help / placeholder text shown in the editor. Built-in fields get theirs from entity-kinds.ts; this carries it for custom fields. */
	prompt?: string;
	/** Per-type widget configuration (slider min/max/step, select options, matrix axis poles, tag entity-link mode). */
	config?: FieldConfig;
	/** Template category this field belongs to, for grouping in the sheet editor. Undefined = falls into the kind's spec sections / "More". */
	category?: string;
}

export interface StorygridTemplate {
	id: string;
	name: string;
	description: string;
	rows: Omit<GridRow, 'id' | 'order'>[];
	columns: Omit<GridColumn, 'id' | 'order'>[];
}

export interface ColorPalette {
	id: string;
	name: string;
	colors: string[];
}

export interface CharacterFieldTemplate {
	id: string;
	name: string;
	fields: Array<{ label: string; type: CharacterField['type']; prompt?: string; config?: FieldConfig; category?: string }>;
	/** Ordered category list (title + optional icon) this template's fields group under. */
	categories?: Array<{ title: string; icon?: string }>;
}

/** One configured compile step: which step, which pipeline stage, its options. */
export interface CompileStepConfig {
	id: string;
	/** 'scene' = runs on every scene; 'manuscript' = runs once on the whole output. */
	stage?: 'scene' | 'manuscript';
	options: Record<string, boolean | string>;
}

/**
 * A named, persisted compile workflow (Longform-style — writers keep several
 * side by side, seeded from industry presets). Structurally compatible with
 * ManuscriptOptions in utils/compile.ts (defined here to keep this module
 * dependency-free).
 */
export interface CompileWorkflowSettings {
	id: string;
	name: string;
	/** Output file format this workflow produces. */
	output: 'md' | 'fountain' | 'docx' | 'epub';
	/** Emit divider labels as headings/sections/chapters. */
	includeHeadings: boolean;
	sceneSeparator: string;
	steps: CompileStepConfig[];
	titlePage: 'none' | 'novel' | 'fountain';
	author: string;
	contact: string;
	/** Fountain credit line ("Written by" / "A play by"). */
	credit?: string;
	endMark: string;
	/** Fountain: insert END OF ACT markers after each top-level section. */
	actMarkers?: boolean;
	/** DOCX: render italics as underline (classic manuscript convention). */
	underlineItalics?: boolean;
}

export interface SubtaskItem {
	id: string;
	text: string;
	done: boolean;
	/** Optional due datetime ('YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD'). */
	due?: string;
	/** Optional priority — inherits parent's urgency model. */
	priority?: TaskPriority;
}

export type TaskPriority = 'low' | 'normal' | 'high';

export interface TaskLink {
	kind: 'scene' | 'chapter' | 'character' | 'grid';
	path: string;
	label: string;
}

/** One to-do entry on the Dashboard. */
export interface TodoItem {
	id: string;
	text: string;
	done: boolean;
	createdAt: string;
	subtasks?: SubtaskItem[];
	/** Due datetime — 'YYYY-MM-DDTHH:MM' from datetime-local input, or legacy 'YYYY-MM-DD'. */
	due?: string;
	priority?: TaskPriority;
	/** ISO datetime set when the task is checked done; cleared on uncheck. */
	completedAt?: string;
	/** Optional link to a story document (scene, codex entity, grid file). */
	link?: TaskLink;
	/** Explicit manual sort position. Decoupled from array index so drag-reorder
	 *  works independently of urgency sort. Absent on legacy records — lazy-defaulted on read. */
	order?: number;
}

/** Word-count targets per goal window; 0 or missing = no goal set. */
export interface ProjectGoals {
	daily: number;
	weekly: number;
	monthly: number;
	yearly: number;
	total: number;
}

export interface StreakData {
	current: number;
	longest: number;
	lastDate: string; // YYYY-MM-DD in local time
}

/** One finished writing sprint (completed or stopped early). */
export interface SprintRecord {
	/** ISO datetime when the sprint ended. */
	endedAt: string;
	/** Planned length in minutes. */
	minutes: number;
	/** Words typed during the sprint. */
	words: number;
	/** True if the countdown ran to zero, false if stopped early. */
	completed: boolean;
	/** Root path of the project that was active when the sprint was logged.
	 *  Absent on legacy records (pre-dating project-scoped history) — those
	 *  are shown under every project rather than none. */
	projectRoot?: string;
}

/**
 * Persisted Dashboard state, keyed by project root path.
 * `typedWords` records words actually typed (not pasted) per local day.
 * `streaks` tracks consecutive writing days per project.
 */
export interface DashboardSettings {
	goals: Record<string, Partial<ProjectGoals>>;
	todos: Record<string, TodoItem[]>;
	typedWords: Record<string, Record<string, number>>;
	streaks: Record<string, StreakData>;
	/**
	 * Tracks which goal windows have shown their celebration animation, keyed by
	 * projectRoot → goalKey → YYYY-MM-DD. Keying by date means the daily goal
	 * celebration is fresh again each new day.
	 */
	celebratedGoals?: Record<string, Record<string, string>>;
	/**
	 * Words detected as paste (delta > threshold) that were NOT counted, keyed by
	 * projectRoot → YYYY-MM-DD. Surfaced in the dashboard so writers can credit
	 * them if the heuristic was wrong.
	 */
	skippedWords?: Record<string, Record<string, number>>;
	/**
	 * Dashboard layout customization (global, not per-project — it's a UI
	 * preference). `hidden` lists widget ids the user has switched off; `order`
	 * holds the saved sequence of column-widget ids per column slot. Empty/absent
	 * config reproduces the default layout exactly.
	 */
	widgets?: DashboardWidgetConfig;
	/**
	 * Writers Panel manuscript order: scene-doc paths per project root, in the
	 * order the author arranged them (drag-to-reorder in the Writing tab). Docs
	 * on disk but missing from the list render appended (alphabetical); listed
	 * paths whose files are gone are dropped on the next save.
	 */
	sceneOrder?: Record<string, string[]>;
	/**
	 * Writers Panel outline as a nestable tree (scene docs + freeform divider
	 * rows), replacing the flat `sceneOrder` above. Numbering is never stored —
	 * always derived from position (see utils/scene-tree.ts). `sceneOrder` is
	 * kept only as a one-time migration source for projects that predate this.
	 */
	sceneTree?: Record<string, SceneTree>;
	/**
	 * "Who's gone quiet": character sheet paths the writer chose to leave out,
	 * per project root. Paths follow renames (see syncRenamedDocLinks).
	 */
	quietLeftOut?: Record<string, string[]>;
}

export type DashboardWidgetSlot = 'left' | 'right';

export interface DashboardWidgetConfig {
	hidden: string[];
	order: Record<DashboardWidgetSlot, string[]>;
	/** Column-section ids the user has folded shut (body hidden, header bar kept). */
	collapsed?: string[];
}

/** One configured multi-book series. */
export interface SeriesRecord {
	name: string;
	/** Top-level folder path. Shared Codex entities (Characters/, Locations/, …) live here. */
	rootPath: string;
}

/** One book registered within a series. */
export interface BookRecord {
	name: string;
	seriesId: string;
	/** Path to the .storygrid file for this book. */
	gridPath: string;
}

export interface StorygridSettings {
	defaultTemplateId: string;
	colorPalettes: ColorPalette[];
	activeColorPaletteId: string;
	gridFolder: string;
	showFirstLinesCount: number;
	customTemplates: StorygridTemplate[];
	characterFieldTemplates: CharacterFieldTemplate[];
	sceneFieldTemplates: CharacterFieldTemplate[];
	locationFieldTemplates: CharacterFieldTemplate[];
	factionFieldTemplates: CharacterFieldTemplate[];
	systemFieldTemplates: CharacterFieldTemplate[];
	itemFieldTemplates: CharacterFieldTemplate[];
	researchFieldTemplates: CharacterFieldTemplate[];
	/** Field templates for 'event' and any user-defined custom kind, keyed by kind id. Created lazily. */
	customKindFieldTemplates?: Record<string, CharacterFieldTemplate[]>;
	cardBorderRadius: 'rounded' | 'square';
	manuscriptHeadingSource: ManuscriptHeadingSource;
	statusFrameEnabled: boolean;
	showGridTitle: boolean;
	typewriterMode: boolean;
	typewriterDimming: boolean;
	/** How strongly non-active rows fade, 10–90 (% of full dim). */
	typewriterDimStrength: number;
	/** Where the typed row rests, as % down the viewport (10–90). */
	typewriterLinePosition: number;
	/** How many visual rows around the cursor stay fully visible (1–7). */
	typewriterSolidRows: number;
	statusColors: Record<CardStatus, string>;
	/** Polished codex sheet styling in reading view (infobox, accents, typography). */
	codexSheetStyling: boolean;
	/** Where the at-a-glance infobox sits on codex sheets. */
	codexInfoboxPosition: 'right' | 'left' | 'top';
	/** Where pictures added to Codex sheets are saved: one folder per sheet, or Obsidian's attachment setting. */
	codexImageLocation: 'per-sheet' | 'obsidian';
	/** The per-project folder that holds every sheet's picture folder. */
	codexImagesFolderName: string;
	/** Ask "template or clean slate" when a new Codex entry is created. Off = go straight to the remembered choice. */
	entityAskStartMode: boolean;
	/** The last "template or clean slate" choice per entry kind; preselected next time. */
	entityStartMode: Partial<Record<string, StartMode>>;
	/** "Make this my default": the template id per entry kind (`preset:…` / `saved:…`). Missing or deleted = guided fields. */
	entityDefaultTemplate: Partial<Record<string, string>>;
	/** Legacy single workflow — migrated into compileWorkflows on load, then cleared. */
	compileWorkflow?: unknown;
	/** Named compile workflows (Longform-style). Created lazily. */
	compileWorkflows?: CompileWorkflowSettings[];
	/** Created lazily, like compileWorkflows, so DEFAULT_SETTINGS is never mutated. */
	dashboard?: DashboardSettings;
	/** Set to true after the user has seen the welcome/tutorial view at least once. */
	hasSeenWelcome?: boolean;
	/** First-launch answer to "what do you create?" — sets module defaults. Null = not yet asked. */
	intent?: IntentId | null;
	/** Novelists' follow-up: Plotter / Pantser / Plantser. Null = not asked / not a novelist. */
	writingStyle?: WritingStyle | null;
	/** Explicit per-module on/off overrides, set in Settings → General → Modules. Undefined = fall back to the intent's default (see modules.ts). */
	enabledModules?: Partial<Record<ModuleId, boolean>>;
	/** Explicit per-tab on/off for the Writers Panel (Settings → Writers Panel → Tabs). Undefined = the mode's default (writersPanelTabsFor). */
	writersPanelTabs?: Partial<Record<WritersPanelTab, boolean>>;
	/** Fire-once flags for first-time milestone toasts ('first-card' | 'first-sheet' | 'first-relation' | 'first-compile'). */
	milestonesSeen?: Partial<Record<string, boolean>>;
	/**
	 * Tracks which first-visit intro banners have been dismissed.
	 * Keys: 'sidebar-writing' | 'sidebar-world' | 'sidebar-compile' | 'codex'
	 */
	dismissedIntros?: Record<string, boolean>;
	/** Which goal windows to show in the Writers Panel Goals tab. */
	sidebarGoalWindows: Array<'daily' | 'weekly' | 'monthly'>;
	/**
	 * Per-grid compile choices, keyed by grid file path. Created lazily.
	 * `excluded` holds scene doc paths unchecked in the compile scene list
	 * (pre-overhaul data held card ids — migrated on load);
	 * `manuscriptName` is the custom output file name (without extension);
	 * `workflowId` remembers which named workflow this grid compiles with.
	 */
	compileState?: Record<
		string,
		{ excluded: string[]; manuscriptName?: string; coverImagePath?: string; workflowId?: string }
	>;
	/** Which markdown files typewriter mode applies to. Default 'all'. */
	typewriterScope?: 'all' | 'scenes';
	/** Write mode on/off — typewriter + collapsed sidebars, toggled exactly like typewriter mode. */
	writingMode?: 'write' | null;
	/** Internal: typewriter state captured before a writing mode was activated, for restoration on clear. */
	_preModeTypewriter?: boolean;
	/** Default writing-sprint length in minutes (used by the sprint button and menus). */
	sprintDefaultMinutes?: number;
	/** Log of finished sprints, newest last. Capped to the most recent 1000. */
	sprintHistory?: SprintRecord[];
	/** Collapsed Writing-tab sections, keyed by `${gridPath}::${groupId}`. Created lazily. */
	outlineCollapsedGroups?: Record<string, boolean>;
	/** Open the Dashboard automatically when Obsidian starts. */
	openDashboardOnStartup?: boolean;
	/** The writer's name — default for title pages and EPUB metadata. */
	authorName?: string;
	/** Target number of finished sprints per day (0/unset = no goal). */
	sprintGoalDaily?: number;
	/** Target number of finished sprints per week (0/unset = no goal). */
	sprintGoalWeekly?: number;
	/** Play a chime when a sprint completes. */
	sprintSound?: boolean;
	/** How the sidebar shows time left in a sprint. */
	sprintTimerStyle?: 'digital' | 'bar' | 'ring';
	/** Global word-count goals, set in Settings → Goals, shown in dashboard + sidebar. */
	wordGoals?: Partial<ProjectGoals>;
	/** Seed the 5 starter to-dos on first visit to a project. Default true. */
	taskOnboarding?: boolean;
	/** How many active tasks the sidebar shows before "+ N more". Default 5. */
	taskSidebarMaxOpen?: number;
	/** Word-count jump in one typing sample treated as a paste (ignored by goals). Default 80. */
	pasteWordThreshold?: number;
	/** User-saved custom colors, persisted across sessions. Max 32. */
	savedColors?: string[];
	/** Per quick-link on/off. Undefined = follow the link's module (intent defaults). */
	writersPanelActions?: Partial<Record<QuickLinkKey, boolean>>;
	/** DEPRECATED (pre per-link placement): global "show in tab strip" switch. */
	writersPanelTabStripIcons?: boolean;
	/** DEPRECATED (pre per-link placement): global "show inside panel" switch. */
	writersPanelInlineIcons?: boolean;
	/** Where each quick-link lives: Obsidian's top tab strip, the Writers Panel header, or both. Default 'both'. */
	quickLinkPlacement?: Partial<Record<QuickLinkKey, QuickLinkPlacement>>;
	/** User-defined custom entity kinds, merged on top of the seven built-ins at load (hybrid registry). */
	customKinds?: EntityKindSpec[];
	/** Whether to show the Completed group in both the dashboard and sidebar. Default true. */
	taskShowCompleted?: boolean;
	/** How active tasks are sorted: by urgency (overdue → due-today → priority) or manual order. Default 'urgency'. */
	taskDefaultSort?: 'urgency' | 'manual';
	/** Auto-complete a parent task when all its subtasks are checked done. Default true. */
	taskSubtaskRollup?: boolean;
	/** Show the completion date beneath done tasks. Default false. */
	taskShowCompletedDate?: boolean;
	/** Enable multi-book series architecture with two-tier navigation in the Writers Panel. */
	isSeriesMode?: boolean;
	/** Series metadata registry. Key: "series_<id>". */
	seriesRegistry?: Record<string, SeriesRecord>;
	/** Book metadata registry. Key: "book_<id>". */
	bookRegistry?: Record<string, BookRecord>;
	/** UUID key of the currently selected series (series mode only). */
	activeSeriesId?: string;
	/** UUID key of the currently selected book (series mode only). */
	activeBookId?: string;
	/** Root path of the project selected on the Dashboard — shared source of truth for all views. */
	activeProjectRoot?: string;
	/** Reserved for future payment integration. Validated server-side; never used for local-only gating. */
	licenseKey?: string;
	/** Story Tree view: which hierarchy a freshly-opened tab starts on. Default 'family'. */
	storyTreeDefaultMode?: 'family' | 'faction';
	/** Story Tree view: show partner nodes alongside the family tree by default. Default true. */
	storyTreeIncludePartners?: boolean;
	/** Story Tree view: show entity portrait images on nodes instead of plain color dots. Default true. */
	storyTreeShowPortraits?: boolean;
	/** Story Tree view: render nodes as small named cards, or as compact dots (better for very large trees). Default 'card'. */
	storyTreeNodeStyle?: 'card' | 'dots';
	/** Story Tree view: relationship info on hover (fade others + words on lines + tag on a pointed line). 'always' keeps the words on every line. Default 'hover'. */
	storyTreeEdgeLabelMode?: 'off' | 'hover' | 'always';
	/** Connections Map: show entity portrait images on nodes instead of plain color dots. Default 'dot'. */
	connMapNodeDisplay?: 'dot' | 'portrait';
	/** Connections Map: scale node radius up with connection count. Default true. */
	connMapScaleBySize?: boolean;
	/** Connections Map: per-relationship pull multiplier, keyed by the relationship word as written, lowercased (`'father'`, `'best friend'`). 1 = the relationship's natural pull, >1 tighter, <1 looser. Sparse — absent means 1. Affects physics only, never line thickness. */
	connMapRelationPull?: Record<string, number>;
	/** Connections Map: hidden entity kinds (Filters section). Global, not per-tab — absent/empty means nothing hidden. */
	connMapHiddenKinds?: string[];
	/** Social Maps: the tab the writer was last on, so the view reopens there. Absent = the Story Tree. */
	socialMapsLastTab?: 'map' | 'tree';
	/** Connections Map: hidden relationship-type ids (Filters section). Global, not per-tab. */
	connMapHiddenRelTypes?: string[];
	/** Connections Map: character-name label visibility mode. Default 'hover'. */
	connMapNodeLabelMode?: 'off' | 'hover' | 'always';
	/** Connections Map: relationship-label visibility mode. Default 'hover'. */
	connMapEdgeLabelMode?: 'off' | 'hover' | 'always';
	/** Connections Map: physics force tuning (Forces section sliders). Partial — merged over DEFAULT_FORCE_SETTINGS when read. */
	connMapForceSettings?: Partial<ForceSettings>;
	/** User-defined relationship types (name + color + reciprocal) for the Connections Map. Merged on top of the built-ins. */
	customRelationshipTypes?: CustomRelationshipType[];
	/**
	 * Sheets deleted with relationship lines, newest first (path + storygrid-id).
	 * When one comes back from the trash its mirrored lines are written again.
	 */
	relationDeletedSheets?: Array<{
		path: string;
		id?: string;
		at: number;
		/** The lines the delete took off other sheets, word for word, so a restore puts back exactly those. */
		removed?: Array<{ sheet: string; line: string }>;
	}>;
	/** Story Timeline: global appearance defaults new timelines inherit on create. Partial — merged under a timeline's own `viewSettings.appearance` when read (resolveAppearance). */
	timelineAppearance?: Partial<TimelineAppearance>;
	/** Fire-once flags for coach-mark callouts (distinct from milestonesSeen toasts). */
	coachMarksSeen?: Partial<Record<string, boolean>>;
	/** Hover/tap "ⓘ" help on card-editor fields. Default true. */
	cardEditorHoverHelp?: boolean;
	/** Ask "Delete the card …?" before deleting a card. Default true; the dialog's "Don't ask me again" box turns it off, the Plot Grid settings switch turns it back on. */
	confirmCardDelete?: boolean;
	/** Left-clicking a wikilink to a Codex entity opens its preview in the Writers Panel instead of a tab. Default true. */
	openCodexLinksInPanel?: boolean;
	/**
	 * Prose Coach: per-check switches (adverbs + repeated words on, passive off
	 * unless set), when marks show (`mode`, default 'off'), the global "Never
	 * this word" list and per-scene "Not here" choices. Created lazily; legacy
	 * `highlightsAlwaysOn` / `helpLevel` are migrated away at load. See
	 * prose/coach-settings.ts.
	 */
	proseCoach?: ProseCoachSettings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a random UUID v4-style ID.
 */
export function generateId(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Generate a short, stable entity ID for Codex entries (12 alphanumeric chars).
 * Distinct from generateId() UUIDs used for grid/card elements so the two
 * namespaces never collide. Portable — no Obsidian dependency.
 */
export function generateEntityId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let id = 'sg_';
	for (let i = 0; i < 12; i++) {
		id += chars[Math.floor(Math.random() * chars.length)];
	}
	return id;
}

/**
 * Find a card by row and column ID.
 */
export function findCard(
	cards: SceneCard[],
	rowId: string,
	colId: string
): SceneCard | undefined {
	return cards.find((c) => c.rowId === rowId && c.colId === colId);
}

/**
 * Create a new scene card with defaults.
 */
export function createCard(
	rowId: string,
	colId: string,
	defaults: Partial<SceneCard> = {}
): SceneCard {
	return {
		...defaults,
		id: generateId(),
		rowId,
		colId,
		title: defaults.title || '',
		synopsis: defaults.synopsis || '',
		color: defaults.color || '#fafafa',
		status: (defaults.status as CardStatus) || 'idea',
		linkDisplayMode: (defaults.linkDisplayMode as LinkDisplayMode) || 'synopsis',
		tags: defaults.tags || [],
		sceneIcon: defaults.sceneIcon || '',
	};
}

/**
 * Create a new row with default landscape postcard dimensions (130px height).
 * Height of 130px creates wider, shorter cells for horizontal postcard appearance.
 * Users can resize rows by dragging after creation. Do not change height without explicit user approval.
 */
export function createRow(label: string, order?: number): GridRow {
	return {
		id: generateId(),
		label,
		height: 130, // Landscape postcard height — LOCKED without explicit approval
		order: order ?? 999,
	};
}

/**
 * Create a new column with a default order (append to end).
 */
export function createColumn(label: string, order?: number): GridColumn {
	return {
		id: generateId(),
		label,
		order: order ?? 999,
	};
}

/**
 * Create an empty grid with one row and one column.
 */
export function createEmptyGrid(name: string, templateId?: string): GridData {
	const now = new Date().toISOString();
	return {
		version: 1,
		id: generateId(),
		name,
		templateId,
		// Same shape as every template: beats down the side, threads across the top.
		rows: [createRow('Beat 1', 0)],
		columns: [createColumn('Thread 1', 0)],
		cards: [],
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * Sort an array by the `order` property (ascending).
 */
export function sortByOrder<T extends { order: number }>(items: T[]): T[] {
	return [...items].sort((a, b) => a.order - b.order);
}

/**
 * Apply a storytelling template to a grid.
 * Replaces rows and columns, clears cards. When the template's rows carry guide
 * text, a first "Beat guide" column is added holding one ordinary, editable card
 * per beat (title = where it falls, synopsis = what belongs there); the story
 * columns start one to the right.
 * Rows default to 130px height (landscape postcard) unless explicitly set in template.
 */
export function applyTemplate(grid: GridData, template: StorygridTemplate, guideLabel = 'Beat guide'): GridData {
	const newRows = template.rows.map(({ hint: _hint, ...r }, i) => ({
		...r,
		id: generateId(),
		height: r.height ?? 130, // Default to 130px landscape postcard height if not specified
		order: i,
	}));
	const hasGuide = template.rows.some((r) => r.hint);
	const offset = hasGuide ? 1 : 0;
	const newColumns = template.columns.map((c, i) => ({
		...c,
		id: generateId(),
		order: i + offset,
	}));
	const cards: SceneCard[] = [];
	if (hasGuide) {
		const guideCol = createColumn(guideLabel, 0);
		newColumns.unshift(guideCol);
		template.rows.forEach((r, i) => {
			if (!r.hint) return;
			const sep = r.hint.indexOf(' · ');
			const title = sep > 0 ? r.hint.slice(0, sep) : '';
			const synopsis = sep > 0 ? r.hint.slice(sep + 3) : r.hint;
			cards.push(createCard(newRows[i].id, guideCol.id, { title, synopsis, guide: true }));
		});
	}

	return {
		...grid,
		rows: newRows,
		columns: newColumns,
		cards,
		templateId: template.id,
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Swap two rows by their order values.
 */
export function swapRows(rows: GridRow[], index1: number, index2: number): GridRow[] {
	const sorted = sortByOrder(rows);
	if (index1 < 0 || index2 < 0 || index1 >= sorted.length || index2 >= sorted.length) {
		return rows;
	}
	[sorted[index1].order, sorted[index2].order] = [sorted[index2].order, sorted[index1].order];
	return sorted;
}

/**
 * Swap two columns by their order values.
 */
export function swapColumns(cols: GridColumn[], index1: number, index2: number): GridColumn[] {
	const sorted = sortByOrder(cols);
	if (index1 < 0 || index2 < 0 || index1 >= sorted.length || index2 >= sorted.length) {
		return cols;
	}
	[sorted[index1].order, sorted[index2].order] = [sorted[index2].order, sorted[index1].order];
	return sorted;
}

/**
 * Get the row at a given index (after sorting by order).
 */
export function getRowByIndex(rows: GridRow[], index: number): GridRow | undefined {
	const sorted = sortByOrder(rows);
	return sorted[index];
}

/**
 * Get the column at a given index (after sorting by order).
 */
export function getColumnByIndex(cols: GridColumn[], index: number): GridColumn | undefined {
	const sorted = sortByOrder(cols);
	return sorted[index];
}

/**
 * Delete a row and all cards in that row.
 */
export function deleteRow(grid: GridData, rowId: string): GridData {
	return {
		...grid,
		rows: grid.rows.filter((r) => r.id !== rowId),
		cards: grid.cards.filter((c) => c.rowId !== rowId),
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Delete a column and all cards in that column.
 */
export function deleteColumn(grid: GridData, colId: string): GridData {
	return {
		...grid,
		columns: grid.columns.filter((c) => c.id !== colId),
		cards: grid.cards.filter((c) => c.colId !== colId),
		updatedAt: new Date().toISOString(),
	};
}

/** The cards that would be deleted along with a row. */
export function cardsInRow(grid: GridData, rowId: string): SceneCard[] {
	return grid.cards.filter((c) => c.rowId === rowId);
}

/** The cards that would be deleted along with a column. */
export function cardsInColumn(grid: GridData, colId: string): SceneCard[] {
	return grid.cards.filter((c) => c.colId === colId);
}

/**
 * Everything `deleteRow` / `deleteColumn` removed, kept so the delete can be
 * undone: the row or column itself, where it sat (in the order the grid is
 * DRAWN — by `order`, not by list position), and its cards.
 */
export interface DeletedLine<T extends GridRow | GridColumn> {
	line: T;
	/** Position in the drawn order when it was deleted. */
	index: number;
	/** The row/column that sat directly before it, or null if it was first. */
	afterId: string | null;
	/** The row/column that sat directly after it, or null if it was last. */
	beforeId: string | null;
	cards: SceneCard[];
}

function snapshotLine<T extends GridRow | GridColumn>(lines: T[], id: string, cards: SceneCard[]): DeletedLine<T> | null {
	const sorted = sortByOrder(lines);
	const index = sorted.findIndex((l) => l.id === id);
	if (index < 0) return null;
	return {
		line: sorted[index],
		index,
		afterId: index > 0 ? sorted[index - 1].id : null,
		beforeId: index < sorted.length - 1 ? sorted[index + 1].id : null,
		cards,
	};
}

export function snapshotRow(grid: GridData, rowId: string): DeletedLine<GridRow> | null {
	return snapshotLine(grid.rows, rowId, cardsInRow(grid, rowId));
}

export function snapshotColumn(grid: GridData, colId: string): DeletedLine<GridColumn> | null {
	return snapshotLine(grid.columns, colId, cardsInColumn(grid, colId));
}

/**
 * Put a deleted row/column back into the drawn order: directly after the one
 * that preceded it, else directly before the one that followed it, else at its
 * old position (if both neighbours are gone too), then
 * renumber `order` 0..n-1 — the same renumbering a drag-reorder does — so two
 * lines can never share an `order` after rows were reordered in between.
 */
function insertLine<T extends GridRow | GridColumn>(lines: T[], deleted: DeletedLine<T>): T[] {
	const sorted = sortByOrder(lines);
	const afterAt = deleted.afterId === null ? -1 : sorted.findIndex((l) => l.id === deleted.afterId);
	const beforeAt = deleted.beforeId === null ? -1 : sorted.findIndex((l) => l.id === deleted.beforeId);
	let at: number;
	if (deleted.afterId === null) at = 0;
	else if (afterAt >= 0) at = afterAt + 1;
	else if (beforeAt >= 0) at = beforeAt;
	else at = Math.min(deleted.index, sorted.length);
	sorted.splice(at, 0, deleted.line);
	return sorted.map((l, i) => ({ ...l, order: i }));
}

/**
 * Cards from a deleted row/column that may safely come back: the other axis
 * must still exist (a card in a since-deleted column would be invisible), the
 * cell must be free, and the card must not already be there. Anything else is
 * left out rather than put somewhere wrong.
 */
function restorableCards(grid: GridData, cards: SceneCard[]): SceneCard[] {
	const rows = new Set(grid.rows.map((r) => r.id));
	const cols = new Set(grid.columns.map((c) => c.id));
	const taken = new Set(grid.cards.map((c) => `${c.rowId}:${c.colId}`));
	const ids = new Set(grid.cards.map((c) => c.id));
	const back: SceneCard[] = [];
	for (const card of cards) {
		const cell = `${card.rowId}:${card.colId}`;
		if (!rows.has(card.rowId) || !cols.has(card.colId) || taken.has(cell) || ids.has(card.id)) continue;
		taken.add(cell);
		back.push(card);
	}
	return back;
}

/**
 * Cards that an Undo had to leave out ONLY because their other row/column is
 * still deleted. A card at the crossing of a deleted row and a deleted column
 * is in neither one's snapshot of its own, so whoever undoes must carry these
 * forward and offer them again to the next Undo — otherwise the card is lost
 * whenever the two Undos are pressed in the "wrong" order.
 */
export function pendingCards(grid: GridData, cards: SceneCard[]): SceneCard[] {
	const rows = new Set(grid.rows.map((r) => r.id));
	const cols = new Set(grid.columns.map((c) => c.id));
	const ids = new Set(grid.cards.map((c) => c.id));
	return cards.filter((c) => !ids.has(c.id) && (!rows.has(c.rowId) || !cols.has(c.colId)));
}

/** Undo `deleteRow`: put the row back where it was, with its cards. Safe to call twice. */
export function restoreRow(grid: GridData, deleted: DeletedLine<GridRow>): GridData {
	if (grid.rows.some((r) => r.id === deleted.line.id)) return grid;
	const withRow: GridData = { ...grid, rows: insertLine(grid.rows, deleted) };
	return { ...withRow, cards: [...grid.cards, ...restorableCards(withRow, deleted.cards)], updatedAt: new Date().toISOString() };
}

/** Undo `deleteColumn`: put the column back where it was, with its cards. Safe to call twice. */
export function restoreColumn(grid: GridData, deleted: DeletedLine<GridColumn>): GridData {
	if (grid.columns.some((c) => c.id === deleted.line.id)) return grid;
	const withColumn: GridData = { ...grid, columns: insertLine(grid.columns, deleted) };
	return { ...withColumn, cards: [...grid.cards, ...restorableCards(withColumn, deleted.cards)], updatedAt: new Date().toISOString() };
}

/**
 * Rename a row.
 */
export function renameRow(grid: GridData, rowId: string, newLabel: string): GridData {
	return {
		...grid,
		rows: grid.rows.map((r) => (r.id === rowId ? { ...r, label: newLabel } : r)),
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Rename a column.
 */
export function renameColumn(grid: GridData, colId: string, newLabel: string): GridData {
	return {
		...grid,
		columns: grid.columns.map((c) => (c.id === colId ? { ...c, label: newLabel } : c)),
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Set row color.
 */
export function setRowColor(grid: GridData, rowId: string, color?: string): GridData {
	return {
		...grid,
		rows: grid.rows.map((r) => (r.id === rowId ? { ...r, color } : r)),
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Set column color.
 */
export function setColumnColor(grid: GridData, colId: string, color?: string): GridData {
	return {
		...grid,
		columns: grid.columns.map((c) => (c.id === colId ? { ...c, color } : c)),
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Update a card in the grid.
 */
export function updateCard(grid: GridData, cardId: string, updates: Partial<SceneCard>): GridData {
	return {
		...grid,
		cards: grid.cards.map((c) => (c.id === cardId ? { ...c, ...updates } : c)),
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Save the card editor's working copy (the "draft") back to the grid.
 *
 * The draft is a snapshot taken when the editor opened, and a card can be moved
 * while it is open (dragged, or swapped by dropping another card onto it). The
 * draft's row/column are then stale, and writing them back would put the card
 * back where it was — possibly on top of another card. So position (`rowId`,
 * `colId`) and `id` are never taken from a draft: the editor edits content,
 * the grid owns where a card sits.
 */
export function commitCardDraft(grid: GridData, draft: SceneCard, baseline?: SceneCard): GridData {
	if (baseline) {
		// Only what the writer changed in the editor since the draft was made (or last saved).
		// Everything else is left as the grid has it now, so a link renamed or created while
		// the editor was open is not overwritten by the draft's stale copy.
		const edits = draftEdits(baseline, draft);
		return Object.keys(edits).length === 0 ? grid : updateCard(grid, draft.id, edits);
	}
	const { id, rowId: _rowId, colId: _colId, ...content } = draft;
	return updateCard(grid, id, content);
}

/**
 * The content fields of `draft` that differ from `baseline` (a copy of the draft
 * taken when it was made or last saved). Position and id are never included.
 * Compared by value, so an array edited in place still counts as changed.
 */
export function draftEdits(baseline: SceneCard, draft: SceneCard): Partial<SceneCard> {
	const edits: Record<string, unknown> = {};
	const before = baseline as unknown as Record<string, unknown>;
	const after = draft as unknown as Record<string, unknown>;
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (key === 'id' || key === 'rowId' || key === 'colId') continue;
		if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) edits[key] = after[key];
	}
	return edits;
}

/**
 * Link a card to a document the writer has just created FROM it — but only if
 * the card has no linked document yet. A card's link is its scene page; making
 * a second document (a character sheet, say) from the same card must never
 * swap that link out from under it. Returns the same `grid` object when nothing
 * changes, so callers can tell whether to re-render and save.
 */
export function linkNewDocIfUnlinked(grid: GridData, cardId: string, docPath: string): GridData {
	const card = grid.cards.find((c) => c.id === cardId);
	if (!card || card.linkedDocPath) return grid;
	return updateCard(grid, cardId, { linkedDocPath: docPath, linkDisplayMode: 'synopsis' });
}

/**
 * Add a character sheet to a card's characters (the card's character
 * assignments, shown as the round faces on the card). Already there: nothing
 * changes and the same `grid` object comes back, so callers can tell whether
 * to re-render and save.
 */
export function addCharacterToCard(grid: GridData, cardId: string, characterPath: string): GridData {
	const card = grid.cards.find((c) => c.id === cardId);
	if (!card || (card.characterPaths ?? []).includes(characterPath)) return grid;
	return updateCard(grid, cardId, { characterPaths: [...(card.characterPaths ?? []), characterPath] });
}

/**
 * Delete a card.
 */
export function deleteCard(grid: GridData, cardId: string): GridData {
	return {
		...grid,
		cards: grid.cards.filter((c) => c.id !== cardId),
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Move a card to a new position.
 * If the target cell is occupied, swaps the two cards.
 */
export function moveCard(
	grid: GridData,
	cardId: string,
	targetRowId: string,
	targetColId: string
): GridData {
	const dragged = grid.cards.find((c) => c.id === cardId);
	const occupying = grid.cards.find((c) => c.rowId === targetRowId && c.colId === targetColId);

	if (!dragged) {
		return grid;
	}

	const newCards = [...grid.cards];

	if (occupying && occupying.id !== cardId) {
		// Swap
		const draggedIndex = newCards.indexOf(dragged);
		const occupyingIndex = newCards.indexOf(occupying);
		newCards[draggedIndex] = { ...dragged, rowId: targetRowId, colId: targetColId };
		newCards[occupyingIndex] = {
			...occupying,
			rowId: dragged.rowId,
			colId: dragged.colId,
		};
	} else {
		// Move to empty
		const draggedIndex = newCards.indexOf(dragged);
		newCards[draggedIndex] = { ...dragged, rowId: targetRowId, colId: targetColId };
	}

	return {
		...grid,
		cards: newCards,
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Create a copy of the grid with a new name and ID (for duplicating grids).
 */
export function duplicateGrid(grid: GridData, newName: string): GridData {
	const now = new Date().toISOString();
	return {
		...grid,
		id: generateId(),
		name: newName,
		createdAt: now,
		updatedAt: now,
	};
}
