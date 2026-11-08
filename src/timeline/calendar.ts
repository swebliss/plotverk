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
// daysBeforeYear/yearForAbsoluteDay below both walk year-by-year from Year 1
// (or down from Year 1, for years/days before it) — negligible for ordinary
// story-length ranges, but a real per-frame cost for a fantasy calendar with
// a huge year number (e.g. 50,000): computeSpineTicks() (timeline-layout.ts)
// calls into this math up to ~240 times per call, and that call itself runs
// on every animation frame while panning/zooming the timeline
// (timeline-render.ts's renderAxisTicks, rAF-scheduled from applyTransform).
// A single pan/zoom gesture re-asks about the same (or heavily overlapping)
// set of years/days on every frame, so memoizing is a direct fix.
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
	/** year -> daysBeforeYear(calendar, year) */
	beforeYear: Map<number, number>;
	/** dayFloor -> yearForAbsoluteDay(calendar, dayFloor) */
	forDay: Map<number, { year: number; dayOfYear: number }>;
}

const dayMathCaches = new WeakMap<CalendarDef, DayMathCache>();

function dayMathCache(calendar: CalendarDef): DayMathCache {
	let cache = dayMathCaches.get(calendar);
	if (!cache) {
		cache = { beforeYear: new Map(), forDay: new Map() };
		dayMathCaches.set(calendar, cache);
	}
	return cache;
}

/** Absolute day count at the start of `year` (0-based, day 0 = Year 1's first day). Memoized per calendar object — see the cache note above. */
function daysBeforeYear(calendar: CalendarDef, year: number): number {
	const cache = dayMathCache(calendar).beforeYear;
	const cached = cache.get(year);
	if (cached !== undefined) return cached;
	const total = computeDaysBeforeYear(calendar, year);
	cache.set(year, total);
	return total;
}

/** Uncached walk — identical to daysBeforeYear's old body; daysBeforeYear itself now just memoizes this. */
function computeDaysBeforeYear(calendar: CalendarDef, year: number): number {
	let total = 0;
	if (year >= 1) {
		for (let y = 1; y < year; y++) total += daysInYear(calendar, y);
	} else {
		for (let y = year; y < 1; y++) total -= daysInYear(calendar, y);
	}
	return total;
}

/** Inverse of daysBeforeYear + daysInYear: which absolute year (and 1-based day-of-year) a 0-based absolute day falls in. Memoized per calendar object — see the cache note above. */
function yearForAbsoluteDay(calendar: CalendarDef, dayFloor: number): { year: number; dayOfYear: number } {
	const cache = dayMathCache(calendar).forDay;
	const cached = cache.get(dayFloor);
	if (cached !== undefined) return cached;
	const result = computeYearForAbsoluteDay(calendar, dayFloor);
	cache.set(dayFloor, result);
	return result;
}

/** Uncached walk — identical to yearForAbsoluteDay's old body; yearForAbsoluteDay itself now just memoizes this. */
function computeYearForAbsoluteDay(calendar: CalendarDef, dayFloor: number): { year: number; dayOfYear: number } {
	if (dayFloor >= 0) {
		let year = 1;
		let cursor = 0;
		for (;;) {
			const len = daysInYear(calendar, year);
			if (len <= 0) throw new Error(`Calendar has no days in year ${year} — check its month definitions.`);
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
		if (len <= 0) throw new Error(`Calendar has no days in year ${year} — check its month definitions.`);
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
 * Convert a StoryDate to an absolute day number (0-based, fractional part
 * encodes time-of-day). Used for layout/sort math — never shown to the user.
 */
export function storyDateToAbsoluteDay(calendar: CalendarDef, date: StoryDate): number {
	const absYear = resolveAbsoluteYear(calendar, date);
	const dayCount = daysBeforeYear(calendar, absYear) + (dayOfYearIndex(calendar, absYear, date) - 1);
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
