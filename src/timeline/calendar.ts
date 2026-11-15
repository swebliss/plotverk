// Story Timeline calendar engine — pure TypeScript, no Obsidian imports.
// Converts between structured StoryDate values (label-stable — "Year 940"
// always stays "Year 940") and an absolute day number used for layout/sort
// math. Supports custom months (or monthless day-of-year mode), leap rules,
// intercalary festival days, and year-resetting eras.

import type { CalendarDef, CalendarEra, StoryDate } from './timeline-data';

/** Earth-like Gregorian calendar, the default for writers who don't need worldbuilding. */
export const GREGORIAN_CALENDAR: CalendarDef = {
	id: 'gregorian',
	name: 'Gregorian',
	months: [
		{ name: 'January', days: 31 },
		{ name: 'February', days: 28 },
		{ name: 'March', days: 31 },
		{ name: 'April', days: 30 },
		{ name: 'May', days: 31 },
		{ name: 'June', days: 30 },
		{ name: 'July', days: 31 },
		{ name: 'August', days: 31 },
		{ name: 'September', days: 30 },
		{ name: 'October', days: 31 },
		{ name: 'November', days: 30 },
		{ name: 'December', days: 31 },
	],
	weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
	// Simplified every-4-years rule (not the real century/400-year exception) —
	// close enough for any story-relevant year range, and keeps the engine's
	// generic leap-rule math simple, fast, and testable.
	leapRules: [{ everyYears: 4, addDaysToMonth: 2 }],
	minutesPerDay: 1440,
	unitNames: { hour: 'hours', minute: 'minutes' },
};

/**
 * Furthest year (either side of Year 1) the day math places. A date beyond it
 * — a typo like 1e12 — is drawn at this edge instead; its saved text is never
 * changed. A billion years keeps every day count an exact whole number in a
 * JS double (≈3.65e11 days for a 365-day year, far below 2^53).
 */
export const MAX_STORY_YEAR = 1_000_000_000;

/**
 * Pulls a year into -MAX_STORY_YEAR..`top`. NaN passes through (the day math
 * has always read it as Year 1's start). A year stored as text in a
 * hand-edited file ("-4") becomes the number the old walk's comparisons and
 * `y++` turned it into.
 */
function clampYear(year: number, top = MAX_STORY_YEAR): number {
	const y = Number(year);
	if (y > top) return top;
	if (y < -MAX_STORY_YEAR) return -MAX_STORY_YEAR;
	return y;
}

const DEFAULT_MONTHLESS_YEAR_LENGTH = 365;
const DEFAULT_MINUTES_PER_DAY = 1440;

// ─── Internal helpers ──────────────────────────────────────────────────────

/** True when `year` triggers `rule` (every N years, including negative/zero years). */
function ruleApplies(rule: { everyYears: number }, year: number): boolean {
	return rule.everyYears > 0 && year % rule.everyYears === 0;
}

/** This year's months with any leap-rule days added. Base months are never mutated. */
function monthsForYear(calendar: CalendarDef, absoluteYear: number): CalendarMonth[] {
	const months = (calendar.months ?? []).map((m) => ({ ...m }));
	for (const rule of calendar.leapRules ?? []) {
		if (!ruleApplies(rule, absoluteYear)) continue;
		const idx = rule.addDaysToMonth - 1;
		if (months[idx]) months[idx] = { ...months[idx], days: months[idx].days + 1 };
	}
	return months;
}

interface CalendarMonth {
	name: string;
	days: number;
}

/** Total days in `absoluteYear`, honoring leap rules and intercalary festival days. */
function daysInYear(calendar: CalendarDef, absoluteYear: number): number {
	if (!calendar.months) {
		let base = DEFAULT_MONTHLESS_YEAR_LENGTH;
		for (const rule of calendar.leapRules ?? []) {
			if (ruleApplies(rule, absoluteYear)) base += 1;
		}
		return base;
	}
	const months = monthsForYear(calendar, absoluteYear);
	const monthTotal = months.reduce((sum, m) => sum + m.days, 0);
	const intercalaryTotal = (calendar.intercalary ?? []).reduce((sum, ic) => sum + ic.days, 0);
	return monthTotal + intercalaryTotal;
}

// ─── Day-math cache (performance) ──────────────────────────────────────────
// daysBeforeYear/yearForAbsoluteDay below used to walk year-by-year from
// Year 1, which froze Obsidian on a typed year like 999999999. They are now
// closed-form (see "Fast year math" below), but computeSpineTicks()
// (timeline-layout.ts) still asks about the same years/days on every pan/zoom
// animation frame, so the answers stay memoized.
//
// Cached per calendar OBJECT (WeakMap keyed by reference, not by `id` or a
// content hash): everywhere this codebase changes a calendar's definition, it
// does so by replacing the whole TimelineData with a fresh object via an
// immutable `{ ...data, ... }` spread (see TimelineControllerHost.mutate in
// timeline-render.ts) or by re-parsing the file from disk (TimelineView.
// loadTimeline's `JSON.parse(raw)`) — never by mutating a CalendarDef's
// months/leapRules/eras/intercalary arrays in place (checked across the
// plugin — there is no such call site today). So a calendar argument is
// either the exact same object as a previous call (cache stays valid) or a
// brand-new one (starts with an empty cache; the old object and its cache
// entries become unreachable and are garbage-collected together — no manual
// invalidation to get wrong, no leak). If a future change starts editing a
// CalendarDef's fields in place instead of replacing the object, this cache
// would need a different key.
interface DayMathCache {
	/** The calendar's year-length pattern (see yearShape). */
	shape: YearShape;
	/** year -> daysBeforeYear(calendar, year) */
	beforeYear: Map<number, number>;
	/** dayFloor -> yearForAbsoluteDay(calendar, dayFloor) */
	forDay: Map<number, { year: number; dayOfYear: number }>;
}

const dayMathCaches = new WeakMap<CalendarDef, DayMathCache>();

function dayMathCache(calendar: CalendarDef): DayMathCache {
	let cache = dayMathCaches.get(calendar);
	if (!cache) {
		cache = { shape: yearShape(calendar), beforeYear: new Map(), forDay: new Map() };
		dayMathCaches.set(calendar, cache);
	}
	return cache;
}

// ─── Fast year math ─────────────────────────────────────────────────────────
// A year's length is always `base` (the year no leap rule touches) plus one
// day for each leap rule that fires that year — rules only ever ADD a day
// (see monthsForYear/daysInYear). A rule "every N years" fires on whole years
// divisible by N. So the days before a year are `years × base` plus, per
// rule, a count of multiples in a range — plain floor arithmetic, the same
// cost for Year 5 as for Year 999,999,999. For whole-number data the result
// is identical to the old year-by-year walk (every partial sum is an exact
// integer in a double); calendar-fast-math.test.ts checks that against a
// verbatim copy of the old walk.

interface YearShape {
	/** Days in a year where no leap rule fires (months + festival days, or 365 without months). */
	base: number;
	/**
	 * One entry per leap rule that can add a day: the whole-year period it
	 * fires on (a rule fires on year y exactly when y is a multiple of it),
	 * or Infinity for a rule that only ever fires on year 0.
	 */
	periods: number[];
	/** False when a rule's everyYears is fractional — such a rule can also fire on a fractional year (hand-edited files only). */
	wholeRules: boolean;
	/** Every year has at least one day, so day -> year can binary-search (the old walk threw on a zero-length year instead). */
	searchable: boolean;
}

/**
 * Read a calendar's leap rules the way ruleApplies/monthsForYear apply them:
 * `everyYears > 0` and `year % everyYears === 0`, and with months only when
 * `addDaysToMonth` names a month that exists.
 */
function yearShape(calendar: CalendarDef): YearShape {
	const base = daysInYear({ ...calendar, leapRules: [] }, 0);
	const monthSlots = (calendar.months ?? []).map((m) => ({ ...m }));
	const periods: number[] = [];
	let wholeRules = true;
	let everyYear = 0;
	for (const rule of calendar.leapRules ?? []) {
		// Number() coerces exactly like `>` and `%` do in ruleApplies.
		const n = Number(rule.everyYears);
		if (!(n > 0)) continue;
		if (calendar.months && !monthSlots[rule.addDaysToMonth - 1]) continue;
		if (n === Infinity) {
			// y % Infinity === 0 only for y === 0.
			periods.push(Infinity);
			continue;
		}
		// A finite double is p / 2^k with p a whole number (odd when k > 0);
		// a whole year y is an exact multiple of it exactly when p divides y.
		// At most ~1074 doublings, and it stops before it could overflow.
		let p = n;
		while (!Number.isInteger(p)) {
			p *= 2;
			wholeRules = false;
		}
		periods.push(p);
		if (p === 1) everyYear += 1;
	}
	return { base, periods, wholeRules, searchable: Number.isFinite(base) && base + everyYear > 0 };
}

/** How many whole years in [from, to] (inclusive, from <= to) are multiples of `period`. */
function multiplesIn(period: number, from: number, to: number): number {
	if (period === Infinity) return from <= 0 && 0 <= to ? 1 : 0;
	return Math.floor(to / period) - Math.floor((from - 1) / period);
}

/** Sum of daysInYear over the whole years from..to (inclusive, from <= to). */
function daysInYears(shape: YearShape, from: number, to: number): number {
	let total = (to - from + 1) * shape.base;
	for (const p of shape.periods) total += multiplesIn(p, from, to);
	return total;
}

/** Fractional years below 1 with a fractional everyYears: walk, but never more than this many years (absurd hand-edited data only). */
const FRACTIONAL_WALK_LIMIT = 100_000;

/** Closed-form days before `year` — the same answer the old year-by-year walk from Year 1 gave. */
function computeDaysBeforeYear(calendar: CalendarDef, shape: YearShape, year: number): number {
	// The old walk ran zero times for NaN (and so returned 0).
	if (Number.isNaN(year)) return 0;
	if (year >= 1) {
		// The old walk summed the whole years 1, 2, … while y < year.
		const last = Math.ceil(year) - 1;
		return last < 1 ? 0 : daysInYears(shape, 1, last);
	}
	if (Number.isInteger(year)) return -daysInYears(shape, year, 0);
	// A fractional year below 1 (hand-edited file): the old walk visited
	// year, year+1, … — never a whole year, so a whole-number rule never fires
	// and each visited year is just `base` long.
	const visited = Math.ceil(1 - year);
	if (shape.wholeRules || visited > FRACTIONAL_WALK_LIMIT) return -(visited * shape.base);
	let total = 0;
	for (let y = year; y < 1; y++) total -= daysInYear(calendar, y);
	return total;
}

/** Absolute day count at the start of `year` (0-based, day 0 = Year 1's first day). Memoized per calendar object — see the cache note above. */
function daysBeforeYear(calendar: CalendarDef, year: number): number {
	const cache = dayMathCache(calendar);
	const cached = cache.beforeYear.get(year);
	if (cached !== undefined) return cached;
	const total = computeDaysBeforeYear(calendar, cache.shape, year);
	cache.beforeYear.set(year, total);
	return total;
}

/** Inverse of daysBeforeYear + daysInYear: which absolute year (and 1-based day-of-year) a 0-based absolute day falls in. Memoized per calendar object — see the cache note above. */
function yearForAbsoluteDay(calendar: CalendarDef, dayFloor: number): { year: number; dayOfYear: number } {
	const cache = dayMathCache(calendar);
	const cached = cache.forDay.get(dayFloor);
	if (cached !== undefined) return cached;
	const result = cache.shape.searchable
		? searchYearForAbsoluteDay(calendar, cache.shape, dayFloor)
		// NaN/±Infinity could never finish the walk (it hung on them before).
		: walkYearForAbsoluteDay(calendar, Number.isFinite(dayFloor) ? dayFloor : 0);
	cache.forDay.set(dayFloor, result);
	return result;
}

/**
 * Day -> year by binary search over ±MAX_STORY_YEAR (~31 steps). Every year
 * is at least one day long here, so the year whose start is the last one at
 * or before the day is unique — the same year the old walk stopped on. A day
 * past either edge (or NaN, which used to hang the walk) is held at the edge
 * (NaN: day 0, Year 1's first day).
 */
function searchYearForAbsoluteDay(calendar: CalendarDef, shape: YearShape, dayFloor: number): { year: number; dayOfYear: number } {
	const before = (y: number): number => computeDaysBeforeYear(calendar, shape, y);
	const firstDay = before(-MAX_STORY_YEAR);
	const lastDay = before(MAX_STORY_YEAR + 1) - 1;
	const day = Number.isNaN(dayFloor) ? 0 : Math.min(lastDay, Math.max(firstDay, dayFloor));
	let lo = -MAX_STORY_YEAR;
	let hi = MAX_STORY_YEAR;
	while (lo < hi) {
		const mid = Math.floor((lo + hi + 1) / 2);
		if (before(mid) <= day) lo = mid;
		else hi = mid - 1;
	}
	return { year: lo, dayOfYear: day - before(lo) + 1 };
}

/**
 * The old year-by-year walk, kept only for a calendar that has a year with no
 * days (or no readable length). There it stops within two years — on the
 * first such year, with the same error as before — so it can't run long.
 */
function walkYearForAbsoluteDay(calendar: CalendarDef, dayFloor: number): { year: number; dayOfYear: number } {
	if (dayFloor >= 0) {
		let year = 1;
		let cursor = 0;
		for (;;) {
			const len = daysInYear(calendar, year);
			if (!(len > 0)) throw new Error(`Calendar has no days in year ${year} — check its month definitions.`);
			if (dayFloor < cursor + len) return { year, dayOfYear: dayFloor - cursor + 1 };
			cursor += len;
			year += 1;
		}
	}
	let year = 1;
	let cursor = 0;
	for (;;) {
		year -= 1;
		const len = daysInYear(calendar, year);
		if (!(len > 0)) throw new Error(`Calendar has no days in year ${year} — check its month definitions.`);
		cursor -= len;
		if (dayFloor >= cursor) return { year, dayOfYear: dayFloor - cursor + 1 };
	}
}

/** 1-based day-of-year for a date within `absoluteYear`, honoring month lengths and intercalary offsets. */
function dayOfYearIndex(calendar: CalendarDef, absoluteYear: number, date: StoryDate): number {
	if (!calendar.months) return Math.max(1, date.day ?? 1);

	const months = monthsForYear(calendar, absoluteYear);
	const month = Math.min(Math.max(1, date.month ?? 1), Math.max(1, months.length));
	let total = 0;
	for (let m = 1; m < month; m++) {
		total += months[m - 1]?.days ?? 0;
		for (const ic of calendar.intercalary ?? []) {
			if (ic.afterMonth === m) total += ic.days;
		}
	}
	return total + Math.max(1, date.day ?? 1);
}

/** Inverse of dayOfYearIndex: month/day for a 1-based day-of-year within `absoluteYear`. Days landing inside an intercalary block clamp to day 1 of the following month. */
function storyDateFromDayOfYear(calendar: CalendarDef, absoluteYear: number, dayOfYear: number): { month?: number; day: number } {
	if (!calendar.months) return { day: dayOfYear };

	const months = monthsForYear(calendar, absoluteYear);
	let remaining = dayOfYear;
	for (let m = 1; m <= months.length; m++) {
		const len = months[m - 1].days;
		if (remaining <= len) return { month: m, day: remaining };
		remaining -= len;
		for (const ic of calendar.intercalary ?? []) {
			if (ic.afterMonth !== m) continue;
			if (remaining <= ic.days) return { month: Math.min(m + 1, months.length), day: 1 };
			remaining -= ic.days;
		}
	}
	const lastMonth = months.length;
	return { month: lastMonth, day: months[lastMonth - 1]?.days ?? 1 };
}

/** The era covering `absoluteYear` — the era with the greatest startYear <= absoluteYear. */
function eraForAbsoluteYear(calendar: CalendarDef, absoluteYear: number): CalendarEra | undefined {
	if (!calendar.eras || calendar.eras.length === 0) return undefined;
	const sorted = [...calendar.eras].sort((a, b) => a.startYear - b.startYear);
	let match: CalendarEra | undefined;
	for (const era of sorted) {
		if (absoluteYear >= era.startYear) match = era;
		else break;
	}
	return match;
}

/**
 * Holds a day count inside the years the day math covers (±MAX_STORY_YEAR),
 * so a huge day number (a monthless "Day 1e15") lands at the edge like a huge
 * year does. Only on a calendar where every year has days — on a broken one
 * the edges mean nothing, and its numbers pass through as before.
 */
function clampDayCount(calendar: CalendarDef, dayCount: number): number {
	if (!dayMathCache(calendar).shape.searchable) return dayCount;
	const firstDay = daysBeforeYear(calendar, -MAX_STORY_YEAR);
	const lastDay = daysBeforeYear(calendar, MAX_STORY_YEAR + 1) - 1;
	return Math.min(lastDay, Math.max(firstDay, dayCount));
}

/** Resolve a StoryDate's `year` field to an absolute year, unwinding a year-resetting era if the date names one. */
export function resolveAbsoluteYear(calendar: CalendarDef, date: StoryDate): number {
	if (date.era) {
		const era = calendar.eras?.find((e) => e.name === date.era);
		if (era) return era.resetsYearTo1 ? era.startYear + date.year - 1 : date.year;
	}
	return date.year;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * First day of an absolute year — what storyDateToAbsoluteDay gives for a
 * year-only date. One difference: the year right after the top edge
 * (MAX_STORY_YEAR + 1) keeps its own start, so "the end of the last year"
 * (an era band's or the main line's far end) never folds back onto that
 * year's start and turns into a zero-length line.
 */
export function absoluteYearStartDay(calendar: CalendarDef, absoluteYear: number): number {
	return daysBeforeYear(calendar, clampYear(absoluteYear, MAX_STORY_YEAR + 1));
}

/**
 * Convert a StoryDate to an absolute day number (0-based, fractional part
 * encodes time-of-day). Used for layout/sort math — never shown to the user.
 */
export function storyDateToAbsoluteDay(calendar: CalendarDef, date: StoryDate): number {
	// A year past ±MAX_STORY_YEAR (a typo like 1e12, or Infinity) is placed at
	// the edge — the date's own fields are untouched, so its label still reads
	// what was typed.
	const absYear = clampYear(resolveAbsoluteYear(calendar, date));
	const dayCount = clampDayCount(calendar, daysBeforeYear(calendar, absYear) + (dayOfYearIndex(calendar, absYear, date) - 1));
	const minutesPerDay = calendar.minutesPerDay ?? DEFAULT_MINUTES_PER_DAY;
	const fraction = date.minute != null ? Math.min(Math.max(date.minute, 0), minutesPerDay - 1) / minutesPerDay : 0;
	return dayCount + fraction;
}

/**
 * Convert an absolute day number back to a StoryDate. Inverse of
 * storyDateToAbsoluteDay — editing the calendar re-derives positions but a
 * date's own fields ("Year 940") only change if the writer edits them.
 */
export function absoluteDayToStoryDate(calendar: CalendarDef, absoluteDay: number): StoryDate {
	const dayFloor = Math.floor(absoluteDay);
	const fraction = absoluteDay - dayFloor;
	const { year: absYear, dayOfYear } = yearForAbsoluteDay(calendar, dayFloor);
	const { month, day } = storyDateFromDayOfYear(calendar, absYear, dayOfYear);
	const era = eraForAbsoluteYear(calendar, absYear);
	const year = era?.resetsYearTo1 ? absYear - era.startYear + 1 : absYear;
	const minutesPerDay = calendar.minutesPerDay ?? DEFAULT_MINUTES_PER_DAY;
	const minute = fraction > 0 ? Math.round(fraction * minutesPerDay) : undefined;

	return {
		era: era?.name,
		year,
		month: calendar.months ? month : undefined,
		day,
		minute,
	};
}

/**
 * Whole-year difference between two dates, like a birthday not yet reached
 * this year (`toDate` is younger by one if its month/day hasn't caught up to
 * `fromDate`'s within the year). Used for character ages at a given event.
 */
export function diffYears(fromDate: StoryDate, toDate: StoryDate, calendar: CalendarDef): number {
	const fromYear = resolveAbsoluteYear(calendar, fromDate);
	const toYear = resolveAbsoluteYear(calendar, toDate);
	let years = toYear - fromYear;

	const fromMonth = fromDate.month ?? 1;
	const toMonth = toDate.month ?? 1;
	const fromDay = fromDate.day ?? 1;
	const toDay = toDate.day ?? 1;
	if (toMonth < fromMonth || (toMonth === fromMonth && toDay < fromDay)) years -= 1;

	return years;
}

function formatTimeOfDay(calendar: CalendarDef, minute: number): string {
	const minutesPerDay = calendar.minutesPerDay ?? DEFAULT_MINUTES_PER_DAY;
	if (minutesPerDay === DEFAULT_MINUTES_PER_DAY) {
		const h = Math.floor(minute / 60) % 24;
		const m = minute % 60;
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}
	const unit = calendar.unitNames?.minute ?? 'minutes';
	return `${minute} ${unit}`;
}

/**
 * Human-readable rendering that respects the calendar's own month names and
 * granularity — a year-only date reads "Year 940", not "Year 940, Month 1".
 */
export function formatStoryDate(calendar: CalendarDef, date: StoryDate): string {
	const yearLabel = date.era ? `${date.era} ${date.year}` : `Year ${date.year}`;

	if (calendar.months && date.month != null) {
		const monthName = calendar.months[date.month - 1]?.name ?? `Month ${date.month}`;
		if (date.day != null) {
			const timePart = date.minute != null ? ` ${formatTimeOfDay(calendar, date.minute)}` : '';
			return `${date.day} ${monthName}, ${yearLabel}${timePart}`;
		}
		return `${monthName}, ${yearLabel}`;
	}

	if (!calendar.months && date.day != null) {
		return `Day ${date.day}, ${yearLabel}`;
	}

	return yearLabel;
}

/**
 * Calendar-agnostic plain rendering (numeric era/year/month/day) for contexts
 * with no CalendarDef available — e.g. a generic Codex field display before a
 * project's actual calendar has been loaded.
 */
export function formatStoryDatePlain(date: StoryDate): string {
	const parts: string[] = [];
	if (date.era) parts.push(date.era);
	parts.push(`Year ${date.year}`);
	if (date.month != null) parts.push(`Month ${date.month}`);
	if (date.day != null) parts.push(`Day ${date.day}`);
	if (date.minute != null) parts.push(`${date.minute}m`);
	return parts.join(', ');
}

/**
 * Safely parse a StoryDate from its canonical JSON string storage (the
 * `storydate` field's value). Returns null for blank/malformed input —
 * callers treat that as "no date set", never throw.
 */
export function parseStoryDate(raw: string): StoryDate | null {
	const v = raw.trim();
	if (!v) return null;
	try {
		const parsed: unknown = JSON.parse(v);
		if (!parsed || typeof parsed !== 'object') return null;
		const d = parsed as Record<string, unknown>;
		if (typeof d.year !== 'number' || !Number.isFinite(d.year)) return null;
		const date: StoryDate = { year: d.year };
		if (typeof d.era === 'string' && d.era) date.era = d.era;
		if (typeof d.month === 'number' && Number.isFinite(d.month)) date.month = d.month;
		if (typeof d.day === 'number' && Number.isFinite(d.day)) date.day = d.day;
		if (typeof d.minute === 'number' && Number.isFinite(d.minute)) date.minute = d.minute;
		return date;
	} catch {
		return null;
	}
}

/** Canonical JSON string storage for a StoryDate. Inverse of parseStoryDate. */
export function serializeStoryDate(date: StoryDate): string {
	return JSON.stringify(date);
}
