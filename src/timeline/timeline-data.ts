// Story Timeline data types and pure mutation helpers.
// No Obsidian API imports in this file — it is pure TypeScript, mirroring the
// grid-data.ts convention. See calendar.ts for date <-> absolute-day math.

import { generateId } from '../grid-data';
import type { TimelineAppearance } from './timeline-appearance';

/**
 * A structured, label-stable story date. Editing a project's calendar
 * re-derives absolute-day positions from these fields, but the fields
 * themselves never change — "Year 940" always stays "Year 940".
 * Coarser dates are valid: year-only, or year+month with no day.
 */
export interface StoryDate {
	/** Era name, matching a CalendarDef.eras entry. Absent = no era in play. */
	era?: string;
	year: number;
	/** 1-based index into CalendarDef.months. Absent in monthless (day-of-year) calendars. */
	month?: number;
	/** 1-based day of month, or (monthless calendars) 1-based day of year. */
	day?: number;
	/** Minutes since day start, 0 to CalendarDef.minutesPerDay - 1. */
	minute?: number;
}

export interface CalendarMonth {
	name: string;
	days: number;
}

/** Every `everyYears` years, one day is added to the named month (1-based index). */
export interface CalendarLeapRule {
	everyYears: number;
	addDaysToMonth: number;
}

/** Festival/holiday days outside the month structure, inserted right after a given month. */
export interface CalendarIntercalary {
	name: string;
	/** 1-based month index this block follows. */
	afterMonth: number;
	days: number;
}

/** A named span of years. `resetsYearTo1` makes StoryDate.year relative to this era's start. */
export interface CalendarEra {
	name: string;
	startYear: number;
	resetsYearTo1: boolean;
}

export interface CalendarDef {
	id: string;
	name: string;
	/** Omit for monthless (day-of-year) mode. */
	months?: CalendarMonth[];
	weekdays?: string[];
	leapRules?: CalendarLeapRule[];
	intercalary?: CalendarIntercalary[];
	eras?: CalendarEra[];
	/** Default 1440 (24×60), matching real-world minutes. */
	minutesPerDay?: number;
	unitNames?: { hour?: string; minute?: string };
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface Plotline {
	id: string;
	name: string;
	color: string;
	lineStyle: LineStyle;
	/**
	 * Track-default glyph (B4) — a prefixed value like "phosphor:sword", same
	 * format as EventDisplay.icon. Every event on this track paints this icon
	 * unless it has its own EventDisplay.icon override; see resolveEventIcon()
	 * in event-icons.ts for the exact fallback order.
	 */
	icon?: string;
	/** Track thread stroke width override (world px). Paint only; absent falls back to appearance.trackWidth. Clamped to APPEARANCE_LIMITS.trackWidth at the renderer's read seam. */
	width?: number;
}

/** Timeline-only display overrides for a codex event, keyed by note path in TimelineData.eventDisplay. */
export interface EventDisplay {
	plotlineId?: string;
	color?: string;
	lineStyle?: LineStyle;
	/** Point-marker radius override (world px), only meaningful while the event has no end date. Absent falls back to appearance.markerSize. Clamped to APPEARANCE_LIMITS.markerSize at the renderer's read seam. */
	markerSize?: number;
	/** Ranged-event bar thickness override (world px), only meaningful once the event has an end date. Absent falls back to appearance.barThickness. Clamped to APPEARANCE_LIMITS.barThickness at the renderer's read seam. */
	barThickness?: number;
	/**
	 * Point/bar glyph override (B4) — a prefixed value like "phosphor:sword"
	 * (see event-icons.ts's stored-value comment for why it's prefixed).
	 * Absent falls back to the event's track (Plotline.icon); resolution is
	 * resolveEventIcon() in event-icons.ts, mirroring the color/size fallback
	 * shape exactly. Never mutated to a resolved value — clearing deletes the
	 * key, same as markerSize/barThickness above.
	 */
	icon?: string;
}

/** One point a loop touches: a book (grid) and optionally a scene doc and/or a plot-grid card within it. */
export interface LoopAnchor {
	gridPath: string;
	docPath?: string;
	cardId?: string;
}

/** A setup → payoff story loop. Open while `payoff` is unset; spans books from day one. */
export interface Loop {
	id: string;
	name: string;
	color?: string;
	setup: LoopAnchor;
	payoff?: LoopAnchor;
	middles: LoopAnchor[];
}

/** A flashback/foreshadowing bridge between a narrative scene and a world event. */
export interface ChronoLink {
	id: string;
	scenePath: string;
	targetNotePath: string;
}

export interface TimelineViewSettings {
	orientation?: 'horizontal' | 'vertical';
	zoom?: number;
	/**
	 * Per-timeline appearance overrides. Sparse on purpose: an absent key
	 * inherits the plugin-global default, and an absent `appearance` block
	 * inherits everything — see resolveAppearance() in timeline-appearance.ts.
	 */
	appearance?: Partial<TimelineAppearance>;
	/**
	 * "Years shown": the main line runs from the start of `start`'s year to
	 * the end of `end`'s year (both year-only dates, with an era when the
	 * calendar has eras). Absent = Automatic, first to last event. It only
	 * ever grows by itself, when an event lands outside — see timeline-range.ts.
	 */
	range?: TimelineRange;
}

/** The years a timeline shows, both ends included. */
export interface TimelineRange {
	start: StoryDate;
	end: StoryDate;
}

export interface TimelineData {
	version: 1;
	name: string;
	calendar: CalendarDef;
	plotlines: Plotline[];
	/** Keyed by codex note path. */
	eventDisplay: Record<string, EventDisplay>;
	loops: Loop[];
	/** Keyed by scene doc path. */
	sceneDates: Record<string, StoryDate>;
	links: ChronoLink[];
	viewSettings: TimelineViewSettings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/** Create a new plotline with a generated id. */
export function createPlotline(name: string, color: string, lineStyle: LineStyle = 'solid'): Plotline {
	return { id: generateId(), name, color, lineStyle };
}

/**
 * Create an empty timeline for a fresh project. `appearance` seeds the new
 * file with the plugin-global appearance defaults so a writer who has tuned
 * the sliders once does not re-tune every new timeline; an empty or omitted
 * object simply inherits at render time instead.
 */
export function createEmptyTimeline(
	name: string,
	calendar: CalendarDef,
	appearance?: Partial<TimelineAppearance>,
): TimelineData {
	const hasAppearance = !!appearance && Object.keys(appearance).length > 0;
	return {
		version: 1,
		name,
		calendar,
		plotlines: [],
		eventDisplay: {},
		loops: [],
		sceneDates: {},
		links: [],
		viewSettings: hasAppearance ? { appearance: { ...appearance } } : {},
	};
}

/** Open a new loop at its setup anchor. Payoff is unset until closeLoop(). */
export function openLoop(data: TimelineData, name: string, setup: LoopAnchor, color?: string): TimelineData {
	const loop: Loop = { id: generateId(), name, color, setup, middles: [] };
	return { ...data, loops: [...data.loops, loop] };
}

/** Close an existing loop by setting its payoff anchor. */
export function closeLoop(data: TimelineData, loopId: string, payoff: LoopAnchor): TimelineData {
	return {
		...data,
		loops: data.loops.map((l) => (l.id === loopId ? { ...l, payoff } : l)),
	};
}

/** A loop is closed once it has a payoff anchor, open otherwise. */
export function loopStatus(loop: Loop): 'open' | 'closed' {
	return loop.payoff ? 'closed' : 'open';
}

/** Every anchor of a loop that belongs to a given book (gridPath), in setup → middles → payoff order. */
export function anchorsForBook(loop: Loop, gridPath: string): LoopAnchor[] {
	const all: LoopAnchor[] = [loop.setup, ...loop.middles, ...(loop.payoff ? [loop.payoff] : [])];
	return all.filter((a) => a.gridPath === gridPath);
}

/**
 * Remap every reference to `oldPath` to `newPath` across a TimelineData:
 * sceneDates keys, eventDisplay keys, loop anchors (gridPath and docPath),
 * and chrono links (scenePath and targetNotePath). Mirrors the
 * syncRenamedDocLinks rename-sync pattern used elsewhere in the plugin —
 * Phase 3 wires this into the vault's 'rename' event.
 */
export function remapTimelinePath(data: TimelineData, oldPath: string, newPath: string): TimelineData {
	const remapAnchor = (a: LoopAnchor): LoopAnchor => ({
		...a,
		gridPath: a.gridPath === oldPath ? newPath : a.gridPath,
		docPath: a.docPath === oldPath ? newPath : a.docPath,
	});

	const sceneDates: Record<string, StoryDate> = {};
	for (const [path, date] of Object.entries(data.sceneDates)) {
		sceneDates[path === oldPath ? newPath : path] = date;
	}

	const eventDisplay: Record<string, EventDisplay> = {};
	for (const [path, display] of Object.entries(data.eventDisplay)) {
		eventDisplay[path === oldPath ? newPath : path] = display;
	}

	return {
		...data,
		sceneDates,
		eventDisplay,
		loops: data.loops.map((l) => ({
			...l,
			setup: remapAnchor(l.setup),
			payoff: l.payoff ? remapAnchor(l.payoff) : undefined,
			middles: l.middles.map(remapAnchor),
		})),
		links: data.links.map((link) => ({
			...link,
			scenePath: link.scenePath === oldPath ? newPath : link.scenePath,
			targetNotePath: link.targetNotePath === oldPath ? newPath : link.targetNotePath,
		})),
	};
}
