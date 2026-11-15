// The calendar's date <-> day math must answer in constant time whatever the
// year. It used to walk year by year from Year 1, so typing a story year like
// 999999999 froze Obsidian. These tests pin two things:
//   1. huge (and broken: Infinity, NaN) years answer fast and never hang;
//   2. for every ordinary date the fast math gives EXACTLY what the old
//      year-by-year walk gave — checked against a verbatim copy of that walk
//      (REFERENCE below) across many years, negative years, eras, leap rules,
//      intercalary days and custom/monthless calendars.

import {
	GREGORIAN_CALENDAR,
	MAX_STORY_YEAR,
	absoluteDayToStoryDate,
	storyDateToAbsoluteDay,
} from './calendar';
import { computeSpineTicks } from './timeline-layout';
import { eraEndDay } from './timeline-eras';
import { lineEnds } from './timeline-range';
import type { CalendarDef, CalendarEra, StoryDate } from './timeline-data';

// ─── REFERENCE: the old engine, copied verbatim (minus its cache) ───────────

const REF_MONTHLESS = 365;
const REF_MINUTES = 1440;

function refRuleApplies(rule: { everyYears: number }, year: number): boolean {
	return rule.everyYears > 0 && year % rule.everyYears === 0;
}
function refMonthsForYear(calendar: CalendarDef, absoluteYear: number): Array<{ name: string; days: number }> {
	const months = (calendar.months ?? []).map((m) => ({ ...m }));
	for (const rule of calendar.leapRules ?? []) {
		if (!refRuleApplies(rule, absoluteYear)) continue;
		const idx = rule.addDaysToMonth - 1;
		if (months[idx]) months[idx] = { ...months[idx], days: months[idx].days + 1 };
	}
	return months;
}
function refDaysInYear(calendar: CalendarDef, absoluteYear: number): number {
	if (!calendar.months) {
		let base = REF_MONTHLESS;
		for (const rule of calendar.leapRules ?? []) if (refRuleApplies(rule, absoluteYear)) base += 1;
		return base;
	}
	const months = refMonthsForYear(calendar, absoluteYear);
	const monthTotal = months.reduce((sum, m) => sum + m.days, 0);
	const intercalaryTotal = (calendar.intercalary ?? []).reduce((sum, ic) => sum + ic.days, 0);
	return monthTotal + intercalaryTotal;
}
function refDaysBeforeYear(calendar: CalendarDef, year: number): number {
	let total = 0;
	if (year >= 1) {
		for (let y = 1; y < year; y++) total += refDaysInYear(calendar, y);
	} else {
		for (let y = year; y < 1; y++) total -= refDaysInYear(calendar, y);
	}
	return total;
}
function refYearForAbsoluteDay(calendar: CalendarDef, dayFloor: number): { year: number; dayOfYear: number } {
	if (dayFloor >= 0) {
		let year = 1;
		let cursor = 0;
		for (;;) {
			const len = refDaysInYear(calendar, year);
			if (len <= 0) throw new Error(`Calendar has no days in year ${year}`);
			if (dayFloor < cursor + len) return { year, dayOfYear: dayFloor - cursor + 1 };
			cursor += len;
			year += 1;
		}
	}
	let year = 1;
	let cursor = 0;
	for (;;) {
		year -= 1;
		const len = refDaysInYear(calendar, year);
		if (len <= 0) throw new Error(`Calendar has no days in year ${year}`);
		cursor -= len;
		if (dayFloor >= cursor) return { year, dayOfYear: dayFloor - cursor + 1 };
	}
}
function refDayOfYearIndex(calendar: CalendarDef, absoluteYear: number, date: StoryDate): number {
	if (!calendar.months) return Math.max(1, date.day ?? 1);
	const months = refMonthsForYear(calendar, absoluteYear);
	const month = Math.min(Math.max(1, date.month ?? 1), Math.max(1, months.length));
	let total = 0;
	for (let m = 1; m < month; m++) {
		total += months[m - 1]?.days ?? 0;
		for (const ic of calendar.intercalary ?? []) if (ic.afterMonth === m) total += ic.days;
	}
	return total + Math.max(1, date.day ?? 1);
}
function refStoryDateFromDayOfYear(calendar: CalendarDef, absoluteYear: number, dayOfYear: number): { month?: number; day: number } {
	if (!calendar.months) return { day: dayOfYear };
	const months = refMonthsForYear(calendar, absoluteYear);
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
function refEraFor(calendar: CalendarDef, absoluteYear: number): CalendarEra | undefined {
	if (!calendar.eras || calendar.eras.length === 0) return undefined;
	const sorted = [...calendar.eras].sort((a, b) => a.startYear - b.startYear);
	let match: CalendarEra | undefined;
	for (const era of sorted) {
		if (absoluteYear >= era.startYear) match = era;
		else break;
	}
	return match;
}
function refResolveAbsoluteYear(calendar: CalendarDef, date: StoryDate): number {
	if (date.era) {
		const era = calendar.eras?.find((e) => e.name === date.era);
		if (era) return era.resetsYearTo1 ? era.startYear + date.year - 1 : date.year;
	}
	return date.year;
}
function refToDay(calendar: CalendarDef, date: StoryDate): number {
	const absYear = refResolveAbsoluteYear(calendar, date);
	const dayCount = refDaysBeforeYear(calendar, absYear) + (refDayOfYearIndex(calendar, absYear, date) - 1);
	const minutesPerDay = calendar.minutesPerDay ?? REF_MINUTES;
	const fraction = date.minute != null ? Math.min(Math.max(date.minute, 0), minutesPerDay - 1) / minutesPerDay : 0;
	return dayCount + fraction;
}
function refToDate(calendar: CalendarDef, absoluteDay: number): StoryDate {
	const dayFloor = Math.floor(absoluteDay);
	const fraction = absoluteDay - dayFloor;
	const { year: absYear, dayOfYear } = refYearForAbsoluteDay(calendar, dayFloor);
	const { month, day } = refStoryDateFromDayOfYear(calendar, absYear, dayOfYear);
	const era = refEraFor(calendar, absYear);
	const year = era?.resetsYearTo1 ? absYear - era.startYear + 1 : absYear;
	const minutesPerDay = calendar.minutesPerDay ?? REF_MINUTES;
	const minute = fraction > 0 ? Math.round(fraction * minutesPerDay) : undefined;
	return { era: era?.name, year, month: calendar.months ? month : undefined, day, minute };
}

// ─── Calendars under test ────────────────────────────────────────────────────

const CALENDARS: Record<string, CalendarDef> = {
	gregorian: GREGORIAN_CALENDAR,
	monthless: { id: 'plain', name: 'Plain' },
	monthlessLeaps: {
		id: 'plain-leaps',
		name: 'Plain leaps',
		leapRules: [{ everyYears: 4, addDaysToMonth: 1 }, { everyYears: 100, addDaysToMonth: 99 }, { everyYears: 7, addDaysToMonth: 1 }],
	},
	fantasy: {
		id: 'fantasy',
		name: 'Fantasy',
		months: [
			{ name: 'Deepwinter', days: 33 },
			{ name: 'Thaw', days: 29 },
			{ name: 'Sowing', days: 31 },
			{ name: 'Highsun', days: 40 },
			{ name: 'Harvest', days: 30 },
		],
		intercalary: [
			{ name: 'Midwinter', afterMonth: 1, days: 3 },
			{ name: 'Shieldmeet', afterMonth: 4, days: 1 },
		],
		leapRules: [
			{ everyYears: 3, addDaysToMonth: 2 },
			{ everyYears: 12, addDaysToMonth: 2 },   // stacks on the same month
			{ everyYears: 5, addDaysToMonth: 4 },
			{ everyYears: 9, addDaysToMonth: 42 },   // month that does not exist: never adds
			{ everyYears: 0, addDaysToMonth: 1 },    // never applies
			{ everyYears: -4, addDaysToMonth: 1 },   // never applies
		],
		eras: [
			{ name: 'Elder Days', startYear: -300, resetsYearTo1: true },
			{ name: 'Crown Age', startYear: 1, resetsYearTo1: false },
			{ name: 'Ash Age', startYear: 250, resetsYearTo1: true },
		],
		minutesPerDay: 600,
	},
	oddRules: {
		id: 'odd',
		name: 'Odd rules',
		months: [{ name: 'A', days: 20 }, { name: 'B', days: 21 }],
		leapRules: [
			{ everyYears: 2.5, addDaysToMonth: 1 },  // fractional: whole years divisible by 5
			{ everyYears: 1, addDaysToMonth: 2 },    // every year
			{ everyYears: 1e20, addDaysToMonth: 1 }, // only year 0
		],
	},
	festivalOnly: {
		id: 'festival-only',
		name: 'Festival only',
		months: [],
		intercalary: [{ name: 'The Long Feast', afterMonth: 0, days: 200 }],
		leapRules: [{ everyYears: 2, addDaysToMonth: 1 }],
	},
};

// ─── 1. Huge years never hang ────────────────────────────────────────────────

/** Runs `fn` and fails if it took longer than `ms` (the old walk took seconds to forever here). */
function fast<T>(ms: number, fn: () => T): T {
	const t0 = Date.now();
	const out = fn();
	expect(Date.now() - t0).toBeLessThan(ms);
	return out;
}

describe('a huge story year answers at once (no freeze)', () => {
	test('Year 5,000,000 converts both ways in well under a frame', () => {
		const date = { year: 5_000_000, month: 12, day: 31 };
		const day = fast(50, () => storyDateToAbsoluteDay({ ...GREGORIAN_CALENDAR }, date));
		const back = fast(50, () => absoluteDayToStoryDate({ ...GREGORIAN_CALENDAR }, day));
		expect(back).toMatchObject(date);
	});

	test('Year 999,999,999 and -999,999,999 round-trip exactly', () => {
		for (const name of Object.keys(CALENDARS)) {
			const cal = { ...CALENDARS[name] };
			for (const year of [999_999_999, -999_999_999]) {
				const date: StoryDate = cal.months && cal.months.length ? { year, month: 1, day: 2 } : { year, day: 2 };
				const day = fast(50, () => storyDateToAbsoluteDay(cal, date));
				expect(Number.isFinite(day)).toBe(true);
				const back = fast(50, () => absoluteDayToStoryDate(cal, day));
				const shown = cal.eras ? { ...back, era: undefined, year: refResolveAbsoluteYear(cal, back) } : back;
				expect(shown.year).toBe(year);
				// A calendar of festival days only has no month to name a day in (the old engine read it back as day 1 too).
				if (!cal.months || cal.months.length > 0) expect(shown.day).toBe(2);
				// And the day lands exactly 1 day after the year's first day.
				expect(day - storyDateToAbsoluteDay(cal, { ...date, day: 1 })).toBe(1);
			}
		}
	});

	test('absurd years (1e12, 1e300, Infinity) are silently held at the edge and stay in order', () => {
		const cal = { ...GREGORIAN_CALENDAR };
		const edge = fast(50, () => storyDateToAbsoluteDay(cal, { year: MAX_STORY_YEAR }));
		for (const year of [1e12, 1e300, Infinity]) {
			expect(fast(50, () => storyDateToAbsoluteDay(cal, { year }))).toBe(edge);
		}
		const lowEdge = storyDateToAbsoluteDay(cal, { year: -MAX_STORY_YEAR });
		for (const year of [-1e12, -1e300, -Infinity]) {
			expect(fast(50, () => storyDateToAbsoluteDay(cal, { year }))).toBe(lowEdge);
		}
		expect(storyDateToAbsoluteDay(cal, { year: 2000 })).toBeLessThan(edge);
		expect(lowEdge).toBeLessThan(storyDateToAbsoluteDay(cal, { year: -2000 }));
	});

	test('absurd days going back to a date are held at the edge years too', () => {
		const cal = { ...GREGORIAN_CALENDAR };
		expect(fast(50, () => absoluteDayToStoryDate(cal, 1e15)).year).toBe(MAX_STORY_YEAR);
		expect(fast(50, () => absoluteDayToStoryDate(cal, -1e15)).year).toBe(-MAX_STORY_YEAR);
		expect(fast(50, () => absoluteDayToStoryDate(cal, Infinity)).year).toBe(MAX_STORY_YEAR);
		expect(fast(50, () => absoluteDayToStoryDate(cal, NaN)).year).toBe(1);
	});

	test('an era that starts at a huge year resolves fast', () => {
		const cal: CalendarDef = { ...GREGORIAN_CALENDAR, eras: [{ name: 'Far', startYear: 400_000_000, resetsYearTo1: true }] };
		const day = fast(50, () => storyDateToAbsoluteDay(cal, { era: 'Far', year: 3, month: 5, day: 6 }));
		expect(fast(50, () => absoluteDayToStoryDate(cal, day))).toMatchObject({ era: 'Far', year: 3, month: 5, day: 6 });
	});

	test('an era or a lone event at a huge year still has length (the edge year keeps its end)', () => {
		const cal = { ...GREGORIAN_CALENDAR };
		for (const year of [1e12, MAX_STORY_YEAR, MAX_STORY_YEAR - 1]) {
			const start = storyDateToAbsoluteDay(cal, { year });
			expect(eraEndDay(cal, start, undefined, undefined)).toBeGreaterThan(start);
			const ends = lineEnds(cal, null, [{ name: 'Far', startDay: start, endDay: start }]);
			expect(ends!.endDay).toBeGreaterThan(ends!.startDay);
		}
	});

	test('timeline year chips around a huge year are computed fast', () => {
		const cal = { ...GREGORIAN_CALENDAR };
		const at = storyDateToAbsoluteDay(cal, { year: 999_999_000 });
		const ticks = fast(200, () => computeSpineTicks(cal, at - 400_000, at + 400_000, 0.0015, 480, 'auto', 96));
		expect(ticks.length).toBeGreaterThan(0);
		// Day ticks pinned across the far edge of the year range still stop.
		const edge = storyDateToAbsoluteDay(cal, { year: MAX_STORY_YEAR, month: 12, day: 31 });
		expect(fast(200, () => computeSpineTicks(cal, edge - 100, edge + 100, 40, 480, 'day')).length).toBeLessThanOrEqual(480);
		expect(fast(200, () => computeSpineTicks(cal, edge - 1e6, edge + 1e9, 0.0015, 480, 'year', 96)).length).toBeLessThanOrEqual(480);
	});
});

// ─── 2. Same answers as the old walk for ordinary dates ──────────────────────

describe('fast calendar math matches the old year-by-year walk exactly', () => {
	for (const [name, calendar] of Object.entries(CALENDARS)) {
		const hasMonths = !!calendar.months && calendar.months.length > 0;
		const monthCount = calendar.months?.length ?? 0;

		test(`${name}: date -> day for every year from -800 to 800`, () => {
			for (let year = -800; year <= 800; year++) {
				const dates: StoryDate[] = hasMonths
					? [
						{ year, month: 1, day: 1 },
						{ year, month: 2, day: 29 },
						{ year, month: monthCount, day: 1, minute: 333 },
						{ year, month: monthCount, day: 45 },
						{ year },
					]
					: [{ year, day: 1 }, { year, day: 366 }, { year }];
				for (const date of dates) expect(storyDateToAbsoluteDay(calendar, date)).toBe(refToDay(calendar, date));
			}
		});

		test(`${name}: era-named dates`, () => {
			for (const era of calendar.eras ?? []) {
				for (let year = -50; year <= 400; year += 7) {
					const date: StoryDate = { era: era.name, year, month: hasMonths ? 2 : undefined, day: 3 };
					expect(storyDateToAbsoluteDay(calendar, date)).toBe(refToDay(calendar, date));
				}
			}
		});

		test(`${name}: day -> date around every year boundary from -800 to 800`, () => {
			for (let year = -800; year <= 800; year++) {
				const start = refDaysBeforeYear(calendar, year);
				for (const d of [start - 1, start, start + 1, start + 37, start + 0.25, start - 0.5]) {
					expect(absoluteDayToStoryDate(calendar, d)).toEqual(refToDate(calendar, d));
				}
			}
		});

		test(`${name}: far years (spot checks against the old walk)`, () => {
			for (const year of [4000, 12_345, 99_999, 100_000, -4000, -12_345, -99_999, -100_000]) {
				const date: StoryDate = hasMonths ? { year, month: 2, day: 5 } : { year, day: 5 };
				const day = refToDay(calendar, date);
				expect(storyDateToAbsoluteDay(calendar, date)).toBe(day);
				expect(absoluteDayToStoryDate(calendar, day)).toEqual(refToDate(calendar, day));
				expect(absoluteDayToStoryDate(calendar, day - 40)).toEqual(refToDate(calendar, day - 40));
			}
		});

		test(`${name}: fractional years from a hand-edited file`, () => {
			for (const year of [2.5, 1.5, 1.0001, 0.5, -0.5, -2.5, -17.25, 400.75]) {
				const date: StoryDate = hasMonths ? { year, month: 1, day: 1 } : { year, day: 1 };
				expect(storyDateToAbsoluteDay(calendar, date)).toBe(refToDay(calendar, date));
			}
		});
	}

	test('a year stored as text in a hand-edited file reads like before', () => {
		for (const calendar of Object.values(CALENDARS)) {
			for (const year of ['-4', '-5', '0', '1990', '', 'abc']) {
				const date = { year } as unknown as StoryDate;
				expect(storyDateToAbsoluteDay(calendar, date)).toBe(refToDay(calendar, date));
			}
		}
	});

	test('NaN year behaves like before (Year 1 start), no hang', () => {
		for (const calendar of Object.values(CALENDARS)) {
			expect(storyDateToAbsoluteDay(calendar, { year: NaN })).toBe(refToDay(calendar, { year: NaN }));
		}
	});
});
