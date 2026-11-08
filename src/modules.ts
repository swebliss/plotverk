// Pure, Obsidian-free module registry — no plugin imports, fully portable.
// Controls which features appear in the ribbon hub menu, the command palette,
// dashboard tiles, and startup auto-open behavior. The Dashboard is the one
// permanent surface (every switch needs a home that never disappears); all
// other features are switchable in Settings → Modules.
//
// Three independent layers decide whether a module is visible:
//   1. `intent` — the first-launch answer to "what do you create?"
//      supplies a *default* on/off per module (see defaultForIntent below).
//   2. `writingStyle` — novelists also answer "how do you write?"
//      (Plotter / Pantser / Plantser). Pantsers get planning tools off by
//      default so the writing experience stays front and center.
//   3. `enabledModules` — explicit per-module overrides set later in
//      Settings. An explicit override always wins.
// Existing installs (upgrading from before this system existed) have
// `intent: null` and no `enabledModules` entries — isModuleEnabled() treats
// that as "show everything," so nobody's menu changes without them choosing.

export type ModuleId =
	| 'plotGrid'
	| 'codex'
	| 'tasks'
	| 'writersPanel'
	| 'socialMaps'
	| 'history'
	| 'timeline';

export type IntentId =
	| 'journalist'
	| 'novelist'
	| 'scriptwriter'
	| 'worldbuilder'
	| 'everything'
	/** Creator Grid View: only the Plot Grid + Codex — plot your thoughts for videos, books, any creative project. */
	| 'creator';

/** Novelists' follow-up: how do you write? (The Plotter / The Pantser / The Plantser.) */
export type WritingStyle = 'plotter' | 'pantser' | 'plantser';

/** Pre-2026-07 intent ids → their closest profession. Applied once in loadSettings. */
export const LEGACY_INTENT_MAP: Record<string, IntentId> = {
	plotWrite: 'novelist',
	buildWorld: 'worldbuilder',
	runCampaign: 'worldbuilder',
	// Storyboards moved to the standalone Videoflow plugin (2026-07-25); the
	// retired video-creator intent falls back to showing everything.
	createVideos: 'everything',
	videoCreator: 'everything',
	everything: 'everything',
};

export interface ModuleDef {
	id: ModuleId;
	/** i18n key — resolve with t() at render sites. Kept as a key (not a literal) so this file stays Obsidian-free. */
	nameKey: string;
	descKey: string;
	/** Who this module is aimed at — shown on the Guide's per-module card. */
	whoForKey: string;
	/** One concrete first action — shown on the Guide's per-module card. */
	firstStepKey: string;
	/** Label in front of firstStepKey on the Guide card; defaults to "First step:". */
	firstStepLabelKey?: string;
	icon: string;
	/** Shown big on the settings "Modules" section. */
	mainFeature: boolean;
	defaultForIntent: Record<IntentId, boolean>;
}

export const MODULES: ModuleDef[] = [
	{
		id: 'writersPanel',
		nameKey: 'modules.writersPanel.name',
		descKey: 'modules.writersPanel.desc',
		whoForKey: 'modules.writersPanel.whoFor',
		firstStepKey: 'modules.writersPanel.firstStep',
		// Already open from the start, so its card says where it is, not what to do first.
		firstStepLabelKey: 'guide.moduleCard.findItLabel',
		icon: 'sg-pen-nib',
		mainFeature: true,
		defaultForIntent: { journalist: true, novelist: true, scriptwriter: true, worldbuilder: true, everything: true, creator: true },
	},
	{
		id: 'plotGrid',
		nameKey: 'modules.plotGrid.name',
		descKey: 'modules.plotGrid.desc',
		whoForKey: 'modules.plotGrid.whoFor',
		firstStepKey: 'modules.plotGrid.firstStep',
		icon: 'sg-squares-four',
		mainFeature: true,
		defaultForIntent: { journalist: false, novelist: true, scriptwriter: true, worldbuilder: false, everything: true, creator: true },
	},
	{
		id: 'codex',
		nameKey: 'modules.codex.name',
		descKey: 'modules.codex.desc',
		whoForKey: 'modules.codex.whoFor',
		firstStepKey: 'modules.codex.firstStep',
		icon: 'sg-globe',
		mainFeature: true,
		defaultForIntent: { journalist: true, novelist: true, scriptwriter: true, worldbuilder: true, everything: true, creator: true },
	},
	{
		id: 'tasks',
		nameKey: 'modules.tasks.name',
		descKey: 'modules.tasks.desc',
		whoForKey: 'modules.tasks.whoFor',
		firstStepKey: 'modules.tasks.firstStep',
		icon: 'check-square',
		mainFeature: true,
		defaultForIntent: { journalist: true, novelist: true, scriptwriter: true, worldbuilder: true, everything: true, creator: false },
	},
	{
		id: 'socialMaps',
		nameKey: 'modules.socialMaps.name',
		descKey: 'modules.socialMaps.desc',
		whoForKey: 'modules.socialMaps.whoFor',
		firstStepKey: 'modules.socialMaps.firstStep',
		icon: 'sg-graph',
		mainFeature: true,
		// OR of the two merged modules' old defaults (connectionsMap / storyTree) so nobody who saw either loses it.
		defaultForIntent: { journalist: false, novelist: true, scriptwriter: true, worldbuilder: true, everything: true, creator: false },
	},
	{
		id: 'timeline',
		nameKey: 'modules.timeline.name',
		descKey: 'modules.timeline.desc',
		whoForKey: 'modules.timeline.whoFor',
		firstStepKey: 'modules.timeline.firstStep',
		icon: 'git-commit',
		mainFeature: true,
		defaultForIntent: { journalist: true, novelist: true, scriptwriter: true, worldbuilder: true, everything: true, creator: false },
	},
	{
		id: 'history',
		nameKey: 'modules.history.name',
		descKey: 'modules.history.desc',
		whoForKey: 'modules.history.whoFor',
		firstStepKey: 'modules.history.firstStep',
		icon: 'history',
		mainFeature: false,
		defaultForIntent: { journalist: true, novelist: true, scriptwriter: true, worldbuilder: true, everything: true, creator: false },
	},
];

export function getModuleDef(id: ModuleId): ModuleDef | undefined {
	return MODULES.find((m) => m.id === id);
}

/** Planning-heavy tools a discovery writer ("Pantser") starts without. */
const PANTSER_OFF: ModuleId[] = ['plotGrid', 'socialMaps', 'timeline'];

/** The intent+style default for a module, before any explicit override. */
export function moduleDefault(id: ModuleId, intent: IntentId, style: WritingStyle | null | undefined): boolean {
	if (intent === 'novelist' && style === 'pantser' && PANTSER_OFF.includes(id)) return false;
	return getModuleDef(id)?.defaultForIntent[intent] ?? true;
}

/**
 * The single gate every module checks before showing a menu item,
 * registering a command, rendering a dashboard tile, or auto-opening.
 */
export function isModuleEnabled(
	enabledModules: Partial<Record<ModuleId, boolean>> | undefined,
	moduleId: ModuleId,
	intent: IntentId | null | undefined,
	style?: WritingStyle | null,
): boolean {
	const override = enabledModules?.[moduleId];
	if (override !== undefined) return override;
	if (!intent) return true;
	return moduleDefault(moduleId, intent, style);
}

/**
 * `connectionsMap`/`storyTree` merged into one `socialMaps` module. Existing
 * installs may have either or both legacy keys explicitly set in settings —
 * this derives `socialMaps` from them (enabled wins) without ever deleting
 * the old keys, so nobody's saved preference silently disappears.
 */
export function migrateEnabledModules(
	record: Record<string, boolean> | undefined,
): Record<string, boolean> | undefined {
	if (!record) return record;
	if ('socialMaps' in record) return record;
	const cm = record.connectionsMap;
	const st = record.storyTree;
	if (cm === undefined && st === undefined) return record;
	return { ...record, socialMaps: cm === true || st === true };
}

/** The Writers Panel's tabs, in display order. ('compile' is a drill-in page, not a tab.) */
export type WritersPanelTab = 'writing' | 'world' | 'coach' | 'dashboard';
export const WRITERS_PANEL_TABS: WritersPanelTab[] = ['writing', 'world', 'coach', 'dashboard'];

/**
 * The mode's default for one Writers Panel tab, before any explicit switch.
 * Creator Grid View keeps only the Codex and Progress — the grid is where that
 * writer works, so no manuscript (Writing) or prose Coach; Worldbuilder the
 * same; Script Writer drops the Coach. Novelist, Journalist, Everything (and no
 * mode chosen) show all.
 */
export function writersPanelTabDefault(tab: WritersPanelTab, intent: IntentId | null | undefined): boolean {
	// Emma approved 2026-11-06: Worldbuilder = Codex + Progress too; Script Writer has no prose Coach.
	if (intent === 'creator' || intent === 'worldbuilder') return tab === 'world' || tab === 'dashboard';
	if (intent === 'scriptwriter') return tab !== 'coach';
	return true;
}

/**
 * Which Writers Panel tabs show, in display order. An explicit switch in
 * Settings → Writers Panel → Tabs always wins over the mode's default (same
 * rule as isModuleEnabled). Progress is the panel's permanent surface: if every
 * tab is switched off it stays, so the panel is never empty.
 */
export function writersPanelTabsFor(
	intent: IntentId | null | undefined,
	overrides?: Partial<Record<WritersPanelTab, boolean>>,
): WritersPanelTab[] {
	const shown = WRITERS_PANEL_TABS.filter((tab) => overrides?.[tab] ?? writersPanelTabDefault(tab, intent));
	return shown.length ? shown : ['dashboard'];
}
