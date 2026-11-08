// "Years shown" for the Story Timeline — pure TypeScript, no Obsidian imports.
// A timeline either follows its events (Automatic, no `viewSettings.range`)
// or shows chosen years. Chosen years only ever GROW by themselves: an event
// that lands outside stretches the range just enough to include it (snapped
// outward to a whole year, or a round 5/10 on a long span), and the writer
// gets one plain notice. Never shrinks on its own.

import { absoluteDayToStoryDate, resolveAbsoluteYear, storyDateToAbsoluteDay } from './calendar';
import type { CalendarDef, StoryDate, TimelineRange } from './timeline-data';

/** Year numbers a writer can type. Day math walks year by year, so a typo like 1e9 must never reach it. */
export const RANGE_YEAR_LIMIT = 100000;

/** A range in absolute years, plus its days: `startDay` is the first day shown, `endDay` the first day AFTER the last year (exclusive). */
export interface ResolvedRange {
	startYear: number;
	endYear: number;
	startDay: number;
	endDay: number;
}

/** One event's extent in absolute days (a moment has endDay === startDay; an ongoing bar ends at the story's present). */
export interface RangeItem {
	name: string;
	/** Same key = one thing (a character's Born and Died share their sheet) — counted once in the notice. */
	key?: string;
	/** The name for the notice when several items with this key are outside at once (the sheet's name, not "— born"). */
	groupName?: string;
	startDay: number;
	endDay: number;
}

/** First day of an absolute year. */
export function yearStartDay(calendar: CalendarDef, absoluteYear: number): number {
	return storyDateToAbsoluteDay(calendar, { year: absoluteYear });
}

/** The absolute year a day falls in. */
export function absoluteYearOfDay(calendar: CalendarDef, day: number): number {
	return resolveAbsoluteYear(calendar, absoluteDayToStoryDate(calendar, Math.floor(day)));
}

/** An absolute year as the writer reads it: era + that era's own year number when the calendar has eras, a plain year otherwise. */
export function yearAsStoryDate(calendar: CalendarDef, absoluteYear: number): StoryDate {
	const d = absoluteDayToStoryDate(calendar, yearStartDay(calendar, absoluteYear));
	return d.era ? { era: d.era, year: d.year } : { year: d.year };
}

/** A year for the notice and the inputs: "1188", or "Second Age 12". Plain numbers, so no English "Year" lands in es/fr text. */
export function yearLabel(calendar: CalendarDef, absoluteYear: number): string {
	const d = yearAsStoryDate(calendar, absoluteYear);
	return d.era ? `${d.era} ${d.year}` : String(d.year);
}

function isYearDate(date: unknown): date is StoryDate {
	if (!date || typeof date !== 'object') return false;
	const d = date as Record<string, unknown>;
	return typeof d.year === 'number' && Number.isInteger(d.year) && Math.abs(d.year) <= RANGE_YEAR_LIMIT
		&& (d.era === undefined || typeof d.era === 'string');
}

/**
 * The saved range in absolute years and days, or null for Automatic. A
 * hand-edited file with a broken range (missing year, start after end, a
 * gigantic number) also reads as Automatic rather than breaking the view.
 */
export function resolveRange(calendar: CalendarDef, range: TimelineRange | undefined): ResolvedRange | null {
	if (!range || !isYearDate(range.start) || !isYearDate(range.end)) return null;
	// An era the calendar no longer has would read its year as an absolute
	// one and quietly move the range — treat it as Automatic instead.
	const knownEra = (d: StoryDate): boolean => !d.era || !!calendar.eras?.some((e) => e.name === d.era);
	if (!knownEra(range.start) || !knownEra(range.end)) return null;
	const startYear = resolveAbsoluteYear(calendar, range.start);
	const endYear = resolveAbsoluteYear(calendar, range.end);
	if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || startYear > endYear) return null;
	if (Math.abs(startYear) > RANGE_YEAR_LIMIT || Math.abs(endYear) > RANGE_YEAR_LIMIT) return null;
	return { startYear, endYear, startDay: yearStartDay(calendar, startYear), endDay: yearStartDay(calendar, endYear + 1) };
}

/** A range to save from two absolute years, each written the way the calendar names it. */
export function rangeFromYears(calendar: CalendarDef, startYear: number, endYear: number): TimelineRange {
	return { start: yearAsStoryDate(calendar, startYear), end: yearAsStoryDate(calendar, endYear) };
}

export type RangeInputError = 'number' | 'order' | 'limit';

/** Checks two typed years (each in its chosen era) before anything is saved. */
export function validateRangeInput(calendar: CalendarDef, start: { era?: string; year: string }, end: { era?: string; year: string }):
	{ ok: true; range: TimelineRange } | { ok: false; error: RangeInputError } {
	const parse = (s: string): number | null => (/^\s*[-−]?\d+\s*$/.test(s) ? Number(s.trim().replace('−', '-')) : null);
	const a = parse(start.year);
	const b = parse(end.year);
	if (a === null || b === null) return { ok: false, error: 'number' };
	if (Math.abs(a) > RANGE_YEAR_LIMIT || Math.abs(b) > RANGE_YEAR_LIMIT) return { ok: false, error: 'limit' };
	const startYear = resolveAbsoluteYear(calendar, { era: start.era || undefined, year: a });
	const endYear = resolveAbsoluteYear(calendar, { era: end.era || undefined, year: b });
	if (Math.abs(startYear) > RANGE_YEAR_LIMIT || Math.abs(endYear) > RANGE_YEAR_LIMIT) return { ok: false, error: 'limit' };
	if (startYear > endYear) return { ok: false, error: 'order' };
	return { ok: true, range: rangeFromYears(calendar, startYear, endYear) };
}

/** Round-number step for a grown range: whole years on a short span, 5 on a long one, 10 on a very long one. */
export function snapStep(spanYears: number): number {
	if (spanYears <= 30) return 1;
	if (spanYears <= 200) return 5;
	return 10;
}

/** First absolute year of the era covering `absoluteYear`, and of the era after it (undefined = none). */
function eraBounds(calendar: CalendarDef, absoluteYear: number): { start?: number; next?: number } {
	const starts = [...(calendar.eras ?? [])].map((e) => e.startYear).sort((x, y) => x - y);
	let start: number | undefined;
	let next: number | undefined;
	for (const s of starts) {
		if (s <= absoluteYear) start = s;
		else { next = s; break; }
	}
	return { start, next };
}

/**
 * Rounds an absolute year outward to a multiple of `step` in the numbers the
 * writer reads (a year-resetting era counts from its own year 1), never
 * crossing into a neighbouring era — so a grown range reads "Second Age 5",
 * not a stray year of the era before it.
 */
export function snapYear(calendar: CalendarDef, absoluteYear: number, step: number, direction: 'down' | 'up'): number {
	if (step <= 1) return absoluteYear;
	const shown = yearAsStoryDate(calendar, absoluteYear);
	const rounded = direction === 'down' ? Math.floor(shown.year / step) * step : Math.ceil(shown.year / step) * step;
	const snapped = absoluteYear + (rounded - shown.year);
	const { start, next } = eraBounds(calendar, absoluteYear);
	if (direction === 'down' && start !== undefined && snapped < start) return start;
	if (direction === 'up' && next !== undefined && snapped >= next) return next - 1;
	// "Year 0" exists in the day math but no reader expects it after year 1.
	if (direction === 'down' && absoluteYear >= 1 && snapped < 1) return 1;
	return snapped;
}

export interface RangeGrowth {
	range: TimelineRange;
	before: ResolvedRange;
	after: ResolvedRange;
	/** The events that were outside, in time order. */
	outside: RangeItem[];
}

/**
 * Grows `current` just enough to hold every item (start AND end), snapped
 * outward; null when everything already fits. Pure and idempotent: growing
 * an already-grown range again returns null, which is what keeps two windows
 * (or a save → reload) from fighting — both can only ever agree on "bigger".
 */
export function growRangeToFit(calendar: CalendarDef, current: ResolvedRange, items: RangeItem[]): RangeGrowth | null {
	const valid = items.filter((i) => Number.isFinite(i.startDay) && Number.isFinite(i.endDay));
	let outside = valid
		.filter((i) => i.startDay < current.startDay || Math.max(i.startDay, i.endDay) >= current.endDay)
		.sort((x, y) => x.startDay - y.startDay);
	if (outside.length === 0) return null;
	// A year past the limit (a typo like 1188000) can't be shown — leave that
	// one out rather than let it block the growth every other event needs.
	const lo = yearStartDay(calendar, -RANGE_YEAR_LIMIT);
	const hi = yearStartDay(calendar, RANGE_YEAR_LIMIT + 1);
	outside = outside.filter((i) => i.startDay >= lo && Math.max(i.startDay, i.endDay) < hi);
	if (outside.length === 0) return null;
	const minDay = Math.min(current.startDay, ...outside.map((i) => i.startDay));
	const maxDay = Math.max(...outside.map((i) => Math.max(i.startDay, i.endDay)));
	const rawStart = minDay < current.startDay ? absoluteYearOfDay(calendar, minDay) : current.startYear;
	const rawEnd = maxDay >= current.endDay ? absoluteYearOfDay(calendar, maxDay) : current.endYear;
	const step = snapStep(Math.max(rawEnd, current.endYear) - Math.min(rawStart, current.startYear));
	const startYear = Math.min(current.startYear, rawStart < current.startYear ? snapYear(calendar, rawStart, step, 'down') : current.startYear);
	const endYear = Math.max(current.endYear, rawEnd > current.endYear ? snapYear(calendar, rawEnd, step, 'up') : current.endYear);
	const range = rangeFromYears(calendar, startYear, endYear);
	const after = resolveRange(calendar, range);
	// Only reachable past RANGE_YEAR_LIMIT — leave the range alone rather than save one that reads as Automatic.
	if (!after) return null;
	return { range, before: current, after, outside };
}

/** The one notice for a growth, as an i18n key + its values (the caller translates — keeps this file free of the i18n module). */
export function rangeNotice(calendar: CalendarDef, growth: RangeGrowth): { key: string; vars: Record<string, string | number> } {
	const { before, after } = growth;
	const label = (absYear: number): string => yearLabel(calendar, absYear);
	const newStart = label(after.startYear);
	const newEnd = label(after.endYear);
	// One entry per sheet: a character born AND died outside counts once, spanning both.
	const byKey = new Map<string, RangeItem>();
	for (const o of growth.outside) {
		const k = o.key ?? o.name;
		const seen = byKey.get(k);
		byKey.set(k, seen
			? { ...seen, name: o.groupName ?? seen.name, startDay: Math.min(seen.startDay, o.startDay), endDay: Math.max(seen.startDay, seen.endDay, o.startDay, o.endDay) }
			: o);
	}
	const outside = [...byKey.values()];
	if (outside.length > 1) {
		return { key: 'timeline.range.notice.many', vars: { count: outside.length, newStart, newEnd } };
	}
	const e = outside[0];
	const last = Math.max(e.startDay, e.endDay);
	const isBefore = e.startDay < before.startDay;
	const isAfter = last >= before.endDay;
	const from = label(absoluteYearOfDay(calendar, e.startDay));
	const to = label(absoluteYearOfDay(calendar, last));
	if (isBefore && isAfter) {
		return { key: 'timeline.range.notice.both', vars: { name: e.name, from, to, newStart, newEnd } };
	}
	if (isBefore) {
		return { key: 'timeline.range.notice.before', vars: { name: e.name, year: from, oldStart: label(before.startYear), newStart } };
	}
	return {
		key: e.startDay >= before.endDay ? 'timeline.range.notice.after' : 'timeline.range.notice.afterLasts',
		vars: { name: e.name, year: to, oldEnd: label(before.endYear), newEnd },
	};
}

/**
 * The furthest the camera may zoom out while years are chosen: the chosen
 * years still fill at least ~40% of the view (half the fit). Never above the
 * fit itself, never below the global floor.
 */
export function rangeZoomFloor(fitScale: number, globalMin: number): number {
	return Math.min(fitScale, Math.max(globalMin, fitScale * 0.5));
}

export interface RangeTick {
	day: number;
	label: string;
	kind: string;
}

/** Where the main line starts and stops (absolute days) and the year named on each end cap. */
export interface LineEnds {
	startDay: number;
	endDay: number;
	/** The absolute years the caps name. */
	startYear: number;
	endYear: number;
	startLabel: string;
	endLabel: string;
}

/**
 * The main line's two ends. Chosen years: exactly their first day and the
 * end of their last year. Automatic: the first event to the last event's end
 * (an ongoing bar's present included), or the story's present when that is
 * later. Null with nothing dated and no chosen years.
 */
export function lineEnds(calendar: CalendarDef, range: ResolvedRange | null, items: RangeItem[], presentDay?: number): LineEnds | null {
	const named = (startDay: number, endDay: number, startYear: number, endYear: number): LineEnds => ({
		startDay, endDay, startYear, endYear,
		startLabel: yearLabel(calendar, startYear), endLabel: yearLabel(calendar, endYear),
	});
	if (range) return named(range.startDay, range.endDay, range.startYear, range.endYear);
	const days = items.flatMap((i) => [i.startDay, i.endDay]).filter((d) => Number.isFinite(d));
	if (days.length === 0) return null;
	const startDay = Math.min(...days);
	const endDay = Math.max(...days, ...(presentDay !== undefined && Number.isFinite(presentDay) ? [presentDay] : []));
	// Everything on one day: no stub (Emma, 2026-08-31) — the line covers
	// that whole year, both caps naming it, like chosen years "1188 to 1188".
	if (endDay === startDay) {
		const year = absoluteYearOfDay(calendar, startDay);
		return named(yearStartDay(calendar, year), yearStartDay(calendar, year + 1), year, year);
	}
	return named(startDay, endDay, absoluteYearOfDay(calendar, startDay), absoluteYearOfDay(calendar, endDay));
}

/**
 * Year labels along a line with end caps: only ticks on the line, and no
 * year chip so close to a cap that it would collide with the cap's own year
 * (`minGapDays` = the year-chip gap in days at the current zoom).
 */
export function clampTicksToLine<T extends RangeTick>(ticks: T[], ends: { startDay: number; endDay: number }, minGapDays: number, capLabels: string[] = []): T[] {
	return ticks.filter((tk) => {
		if (tk.day < ends.startDay || tk.day > ends.endDay) return false;
		if (tk.kind !== 'year') return true;
		// A cap already names this year — never show it twice.
		if (capLabels.includes(tk.label)) return false;
		return Math.abs(tk.day - ends.startDay) >= minGapDays && Math.abs(ends.endDay - tk.day) >= minGapDays;
	});
}
