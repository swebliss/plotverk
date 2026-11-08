import { DashboardWidgetConfig, DashboardWidgetSlot } from './grid-data';
import { IntentId } from './modules';

/**
 * A dashboard widget the user can show/hide (and, for column widgets, reorder).
 *
 * `slot` decides placement and capability:
 *  - 'band' — a full-width section at a fixed vertical position (action cards,
 *    jump-to tiles, footer). Show/hide only.
 *  - 'top'  — the paired top row (Today hero + Sprint panel). Show/hide only.
 *  - 'left' / 'right' — the two reorderable columns.
 */
export interface DashboardWidgetDef {
	id: string;
	label: string;
	icon: string;
	fallbackIcon: string;
	slot: DashboardWidgetSlot | 'band' | 'top';
	defaultVisible: boolean;
	/** Setups whose dashboard starts with this widget hidden — a one-time preset
	 *  applied when the widget config is first created, not an ongoing rule; the
	 *  user can always re-show it via the eye icon in edit mode afterward. */
	hideForIntent?: IntentId[];
}

/**
 * The canonical widget set. Registry order is also the default order within a
 * column and the structural order of the bands, so this list alone reproduces
 * today's hardcoded layout when no config is saved.
 */
export const DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
	{ id: 'action-cards', label: 'Main action card', icon: 'rocket-launch', fallbackIcon: '🚀', slot: 'band', defaultVisible: true },
	{ id: 'today', label: 'Today', icon: 'sun', fallbackIcon: '☀️', slot: 'top', defaultVisible: true },
	{ id: 'sprint', label: 'Sprint timer', icon: 'timer', fallbackIcon: '⏱', slot: 'top', defaultVisible: true, hideForIntent: ['worldbuilder'] },
	{ id: 'jump-to', label: 'Jump to', icon: 'compass', fallbackIcon: '🧭', slot: 'band', defaultVisible: true },
	{ id: 'goals', label: 'Word goals', icon: 'target', fallbackIcon: '🎯', slot: 'left', defaultVisible: true },
	{ id: 'activity', label: 'Activity', icon: 'chart-line', fallbackIcon: '📈', slot: 'left', defaultVisible: true },
	{ id: 'balance', label: 'Character balance', icon: 'user', fallbackIcon: '👥', slot: 'left', defaultVisible: true, hideForIntent: ['journalist'] },
	{ id: 'quiet', label: "Who's gone quiet", icon: 'user-minus', fallbackIcon: '…', slot: 'left', defaultVisible: true, hideForIntent: ['journalist'] },
	{ id: 'todos', label: 'To-dos', icon: 'check-square', fallbackIcon: '✓', slot: 'right', defaultVisible: true },
	{ id: 'statuses', label: 'Scene status', icon: 'kanban', fallbackIcon: '▦', slot: 'right', defaultVisible: true, hideForIntent: ['journalist', 'worldbuilder'] },
	// Pro coach, whole book (src/prose/pro/book.ts).
	{ id: 'habits', label: 'Crutch words across the book', icon: 'repeat', fallbackIcon: '↻', slot: 'right', defaultVisible: true },
	{ id: 'pace', label: 'Pace across the book', icon: 'wave-sine', fallbackIcon: '~', slot: 'right', defaultVisible: true, hideForIntent: ['journalist'] },
	{ id: 'footer', label: 'Footer stats', icon: 'info', fallbackIcon: 'ℹ', slot: 'band', defaultVisible: true },
];

const BY_ID = new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w]));

export function getWidgetDef(id: string): DashboardWidgetDef | undefined {
	return BY_ID.get(id);
}

/**
 * Starting hidden-widget preset for a first-launch setup. `statuses` (scene
 * status pipeline) needs plot-grid cards, so it's hidden by default wherever
 * Plot Grid itself defaults off (journalist, worldbuilder — see modules.ts);
 * `balance` (character mentions in prose) is hidden for journalists, who
 * generally track sources rather than characters; `sprint` (word-count sprint
 * timer) is hidden for worldbuilders, who aren't drafting manuscript prose
 * against a clock. Everything else starts visible for every setup. Applied
 * once when the widget config is first created — fully reversible afterward.
 */
export function defaultHiddenWidgetIds(intent: IntentId | null): string[] {
	if (!intent) return [];
	return DASHBOARD_WIDGETS.filter((w) => w.hideForIntent?.includes(intent)).map((w) => w.id);
}

export interface ResolvedWidgetLayout {
	/** Whether a widget should render. Honors saved hidden list + registry default. */
	isVisible: (id: string) => boolean;
	/**
	 * All widget ids for a column slot in display order — saved order first
	 * (pruned to ids that still exist in this slot), then any registry widgets
	 * not yet in the saved order appended at the end (so a newly added widget
	 * surfaces rather than vanishing). Includes hidden ids; filter with
	 * `isVisible` when rendering, keep them when drawing the edit panel.
	 */
	columnOrder: (slot: DashboardWidgetSlot) => string[];
}

/**
 * Pure layout resolver. Given the saved (possibly undefined/partial) config,
 * produces the visibility predicate and per-column ordering used by both the
 * dashboard render and the edit panel.
 */
export function resolveWidgetLayout(config: DashboardWidgetConfig | undefined): ResolvedWidgetLayout {
	const hidden = new Set(config?.hidden ?? []);

	const isVisible = (id: string): boolean => {
		if (hidden.has(id)) return false;
		const def = BY_ID.get(id);
		return def ? def.defaultVisible : true;
	};

	// A widget is "column-placeable" if its registry slot is one of the columns.
	// Such widgets may live in *either* column (the registry slot is only the
	// first-run default) — placement is driven by which saved order array holds
	// the id, so the user can drag a widget from left to right and back.
	const isColumnId = (id: string): boolean => {
		const def = BY_ID.get(id);
		return !!def && (def.slot === 'left' || def.slot === 'right');
	};

	// Resolve saved placement once, de-duplicating any id that leaked into both
	// columns (left wins) so a widget can never render twice.
	const COLUMN_SLOTS: DashboardWidgetSlot[] = ['left', 'right'];
	const savedBySlot: Record<DashboardWidgetSlot, string[]> = { left: [], right: [] };
	const placed = new Set<string>();
	for (const slot of COLUMN_SLOTS) {
		for (const id of config?.order?.[slot] ?? []) {
			if (isColumnId(id) && !placed.has(id)) {
				savedBySlot[slot].push(id);
				placed.add(id);
			}
		}
	}

	const columnOrder = (slot: DashboardWidgetSlot): string[] => {
		// Unplaced column widgets fall back to their registry-default column.
		const unplaced = DASHBOARD_WIDGETS
			.filter((w) => w.slot === slot && !placed.has(w.id))
			.map((w) => w.id);
		return [...savedBySlot[slot], ...unplaced];
	};

	return { isVisible, columnOrder };
}

// ─────────────────────────────────────────────────────────────────────────────
// Character presence pacing notes — pure math over per-scene link counts.
// Feeds the Prose Style Coach tab's Pro-only "Pacing Note" line; the Character
// Balance widget above shows the same underlying counts as percentages.
// ─────────────────────────────────────────────────────────────────────────────

export interface ScenePresenceInput {
	path: string;
	/** targetPath → link count, straight from Obsidian's metadataCache.resolvedLinks. */
	links: Record<string, number>;
}

export interface PresenceNote {
	characterPath: string;
	characterName: string;
	kind: 'absent-streak' | 'minor-spike';
	/** absent-streak: how many trailing scenes in a row lack this character. */
	streak?: number;
	/** absent-streak: their longest gap between two earlier appearances (0 = never missed one). */
	usualGap?: number;
	/** minor-spike: index into `scenes` of the scene that spiked. */
	sceneIndex?: number;
	message: string;
}

/**
 * Gentle pacing observations from per-scene character link counts. `scenes`
 * MUST already be in manuscript order (the Writing-tab scene tree order) —
 * this function has no notion of ordering beyond array position.
 *
 * - absent-streak: someone who is usually around and has now been missing
 *   for longer than usual. Each character is judged against their OWN rhythm,
 *   so a series with hundreds of characters never nags about the minor ones:
 *   - a regular: in at least `minScenes` scenes, and in roughly one of every
 *     three scenes from their first appearance to their last (`minShare`);
 *   - an unusual gap: the scenes since their last appearance number at least
 *     `absentThreshold` AND at least `gapFactor` times their longest earlier
 *     gap between two appearances.
 *   - not gone for good: someone missing for more than `leftFactor` times
 *     their whole stretch in the story (first to last appearance) has most
 *     likely left it — a finished subplot, a prologue — and the writer knows.
 *     Without this, a five-chapter subplot in book one would top the list for
 *     the rest of the series (a usual gap of 0 makes any gap look surprising).
 *   Most surprising first: current gap ÷ longest earlier gap.
 * - minor-spike: a character in the bottom half by total links whose count
 *   in a single scene is at least 3x their own per-scene average (and at
 *   least 4) — a minor character suddenly dominating one scene.
 *
 * Capped at 3 notes, absent notes first.
 */
export function computePresenceNotes(
	scenes: ScenePresenceInput[],
	characters: Array<{ path: string; name: string }>,
	opts?: { absentThreshold?: number; minScenes?: number; minShare?: number; gapFactor?: number; leftFactor?: number }
): PresenceNote[] {
	const leftFactor = opts?.leftFactor ?? 2;
	const absentThreshold = opts?.absentThreshold ?? 3;
	const minScenes = opts?.minScenes ?? 4;
	const minShare = opts?.minShare ?? 0.3;
	const gapFactor = opts?.gapFactor ?? 2;
	if (scenes.length === 0 || characters.length === 0) return [];

	const perScene = characters.map((c) => ({
		...c,
		counts: scenes.map((s) => s.links[c.path] ?? 0),
	}));
	const withTotals = perScene.map((c) => ({
		...c,
		total: c.counts.reduce((sum, n) => sum + n, 0),
	}));

	const absentNotes: Array<PresenceNote & { surprise: number; seen: number }> = [];
	for (const c of withTotals) {
		const seenAt: number[] = [];
		c.counts.forEach((n, i) => { if (n > 0) seenAt.push(i); });
		if (seenAt.length < minScenes) continue;
		const first = seenAt[0];
		const last = seenAt[seenAt.length - 1];
		// Their share of the scenes while they were in the story (the current gap
		// is left out, or the gap itself would make them look like a minor character).
		if (seenAt.length / (last - first + 1) < minShare) continue;
		let usualGap = 0;
		for (let k = 1; k < seenAt.length; k++) usualGap = Math.max(usualGap, seenAt[k] - seenAt[k - 1] - 1);
		const streak = c.counts.length - 1 - last;
		if (streak < absentThreshold || streak < gapFactor * usualGap) continue;
		if (streak > leftFactor * (last - first + 1)) continue;
		absentNotes.push({
			characterPath: c.path,
			characterName: c.name,
			kind: 'absent-streak',
			streak,
			usualGap,
			message: `${c.name} hasn't appeared in the last ${streak} scenes.`,
			surprise: streak / Math.max(1, usualGap),
			seen: seenAt.length,
		});
	}

	const sortedByTotal = [...withTotals].sort((a, b) => a.total - b.total);
	const bottomHalf = new Set(sortedByTotal.slice(0, Math.ceil(sortedByTotal.length / 2)).map((c) => c.path));

	const spikeNotes: Array<PresenceNote & { magnitude: number }> = [];
	for (const c of withTotals) {
		if (!bottomHalf.has(c.path) || c.total === 0) continue;
		const scenesWithAppearance = c.counts.filter((n) => n > 0).length;
		const average = c.total / Math.max(1, scenesWithAppearance);
		let bestIndex = -1;
		let bestCount = 0;
		c.counts.forEach((n, i) => {
			if (n >= 4 && n >= average * 3 && n > bestCount) { bestCount = n; bestIndex = i; }
		});
		if (bestIndex >= 0) {
			spikeNotes.push({
				characterPath: c.path,
				characterName: c.name,
				kind: 'minor-spike',
				sceneIndex: bestIndex,
				message: `${c.name} (a minor character) dominates scene ${bestIndex + 1}.`,
				magnitude: bestCount,
			});
		}
	}
	spikeNotes.sort((a, b) => b.magnitude - a.magnitude);

	// Most surprising first; on a tie the longer gap, then the bigger part in the story.
	const sortedAbsent = absentNotes
		.sort((a, b) => b.surprise - a.surprise || (b.streak ?? 0) - (a.streak ?? 0) || b.seen - a.seen)
		.map(({ surprise, seen, ...note }) => note);
	return [...sortedAbsent, ...spikeNotes.map(({ magnitude, ...note }) => note)].slice(0, 3);
}
