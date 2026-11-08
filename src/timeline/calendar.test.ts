import {
	GREGORIAN_CALENDAR,
	storyDateToAbsoluteDay,
	absoluteDayToStoryDate,
	diffYears,
	formatStoryDate,
	formatStoryDatePlain,
	parseStoryDate,
	serializeStoryDate,
} from './calendar';
import { CalendarDef, StoryDate } from './timeline-data';

describe('GREGORIAN_CALENDAR preset', () => {
	test('has 12 months and 7 weekdays', () => {
		expect(GREGORIAN_CALENDAR.months).toHaveLength(12);
		expect(GREGORIAN_CALENDAR.weekdays).toHaveLength(7);
	});

	test('non-leap year totals 365 days', () => {
		// Year 1 is not divisible by 4.
		const jan1 = storyDateToAbsoluteDay(GREGORIAN_CALENDAR, { year: 1, month: 1, day: 1 });
		const nextJan1 = storyDateToAbsoluteDay(GREGORIAN_CALENDAR, { year: 2, month: 1, day: 1 });
		expect(nextJan1 - jan1).toBe(365);
	});

	test('leap year (divisible by 4) totals 366 days', () => {
		const jan1Y4 = storyDateToAbsoluteDay(GREGORIAN_CALENDAR, { year: 4, month: 1, day: 1 });
		const jan1Y5 = storyDateToAbsoluteDay(GREGORIAN_CALENDAR, { year: 5, month: 1, day: 1 });
		expect(jan1Y5 - jan1Y4).toBe(366);
	});

	test('Feb 29 is a valid date only in a leap year (round-trips to Feb 29)', () => {
		const day = storyDateToAbsoluteDay(GREGORIAN_CALENDAR, { year: 4, month: 2, day: 29 });
		const back = absoluteDayToStoryDate(GREGORIAN_CALENDAR, day);
		expect(back.month).toBe(2);
		expect(back.day).toBe(29);
		expect(back.year).toBe(4);
	});
});

describe('round-trip stability (label-stable dates)', () => {
	const cases: StoryDate[] = [
		{ year: 1, month: 1, day: 1 },
		{ year: 940, month: 6, day: 15 },
		{ year: 940, month: 12, day: 31 },
		{ year: 3, month: 3, day: 3, minute: 500 },
		{ year: -5, month: 2, day: 10 },
	];

	for (const date of cases) {
		test(`${JSON.stringify(date)} survives absoluteDay round-trip`, () => {
			const absDay = storyDateToAbsoluteDay(GREGORIAN_CALENDAR, date);
			const back = absoluteDayToStoryDate(GREGORIAN_CALENDAR, absDay);
			expect(back.year).toBe(date.year);
			expect(back.month).toBe(date.month);
			expect(back.day).toBe(date.day);
			if (date.minute != null) expect(back.minute).toBe(date.minute);
		});
	}

	test('absolute day strictly increases with calendar-forward dates', () => {
		const a = storyDateToAbsoluteDay(GREGORIAN_CALENDAR, { year: 900, month: 1, day: 1 });
		const b = storyDateToAbsoluteDay(GREGORIAN_CALENDAR, { year: 900, month: 6, day: 1 });
		const c = storyDateToAbsoluteDay(GREGORIAN_CALENDAR, { year: 901, month: 1, day: 1 });
		expect(a).toBeLessThan(b);
		expect(b).toBeLessThan(c);
	});
});

describe('monthless (day-of-year) calendars', () => {
	const monthless: CalendarDef = { id: 'plain', name: 'Plain Days' };

	test('day-of-year value round-trips directly', () => {
		const absDay = storyDateToAbsoluteDay(monthless, { year: 5, day: 200 });
		const back = absoluteDayToStoryDate(monthless, absDay);
		expect(back.year).toBe(5);
		expect(back.day).toBe(200);
		expect(back.month).toBeUndefined();
	});

	test('defaults to a 365-day year with no leap rules', () => {
		const y1 = storyDateToAbsoluteDay(monthless, { year: 1, day: 1 });
		const y2 = storyDateToAbsoluteDay(monthless, { year: 2, day: 1 });
		expect(y2 - y1).toBe(365);
	});

	test('a leap rule extends the monthless year length', () => {
		const withLeap: CalendarDef = { id: 'plain-leap', name: 'Plain Days Leap', leapRules: [{ everyYears: 4, addDaysToMonth: 1 }] };
		const y4 = storyDateToAbsoluteDay(withLeap, { year: 4, day: 1 });
		const y5 = storyDateToAbsoluteDay(withLeap, { year: 5, day: 1 });
		expect(y5 - y4).toBe(366);
	});
});

describe('intercalary festival days', () => {
	const calendar: CalendarDef = {
		id: 'festival-cal',
		name: 'Festival Calendar',
		months: [
			{ name: 'Frostmoon', days: 30 },
			{ name: 'Thawmoon', days: 30 },
		],
		intercalary: [{ name: 'Midwinter Fair', afterMonth: 1, days: 5 }],
	};

	test('a date in the month after the festival counts the festival days first', () => {
		const frostmoonLast = storyDateToAbsoluteDay(calendar, { year: 1, month: 1, day: 30 });
		const thawmoonFirst = storyDateToAbsoluteDay(calendar, { year: 1, month: 2, day: 1 });
		// 5 festival days sit between the last day of Frostmoon and the first of Thawmoon.
		expect(thawmoonFirst - frostmoonLast).toBe(6);
	});

	test('daysInYear (via a full-year round trip) includes intercalary days', () => {
		const y1 = storyDateToAbsoluteDay(calendar, { year: 1, month: 1, day: 1 });
		const y2 = storyDateToAbsoluteDay(calendar, { year: 2, month: 1, day: 1 });
		expect(y2 - y1).toBe(30 + 30 + 5);
	});
});

describe('year-resetting eras', () => {
	const calendar: CalendarDef = {
		id: 'ages',
		name: 'Ages of the World',
		months: [{ name: 'Onemonth', days: 30 }],
		eras: [
			{ name: 'First Age', startYear: 1, resetsYearTo1: true },
			{ name: 'Second Age', startYear: 101, resetsYearTo1: true },
		],
	};

	test('a dated era resolves to the correct absolute year', () => {
		const secondAgeYear5 = storyDateToAbsoluteDay(calendar, { era: 'Second Age', year: 5, month: 1, day: 1 });
		const absoluteYear105 = storyDateToAbsoluteDay(calendar, { year: 105, month: 1, day: 1 });
		expect(secondAgeYear5).toBe(absoluteYear105);
	});

	test('reverse conversion attaches the correct era name and resets the year', () => {
		const absDay = storyDateToAbsoluteDay(calendar, { year: 105, month: 1, day: 1 });
		const back = absoluteDayToStoryDate(calendar, absDay);
		expect(back.era).toBe('Second Age');
		expect(back.year).toBe(5);
	});

	test('a year still inside First Age resolves to First Age, year 1-based', () => {
		const absDay = storyDateToAbsoluteDay(calendar, { year: 50, month: 1, day: 1 });
		const back = absoluteDayToStoryDate(calendar, absDay);
		expect(back.era).toBe('First Age');
		expect(back.year).toBe(50);
	});
});

describe('diffYears (ages)', () => {
	test('exact anniversary gives a whole-number age', () => {
		const born: StoryDate = { year: 900, month: 5, day: 10 };
		const now: StoryDate = { year: 940, month: 5, day: 10 };
		expect(diffYears(born, now, GREGORIAN_CALENDAR)).toBe(40);
	});

	test('a day before the anniversary is one year younger', () => {
		const born: StoryDate = { year: 900, month: 5, day: 10 };
		const now: StoryDate = { year: 940, month: 5, day: 9 };
		expect(diffYears(born, now, GREGORIAN_CALENDAR)).toBe(39);
	});

	test('a day after the anniversary already counts the new year', () => {
		const born: StoryDate = { year: 900, month: 5, day: 10 };
		const now: StoryDate = { year: 940, month: 5, day: 11 };
		expect(diffYears(born, now, GREGORIAN_CALENDAR)).toBe(40);
	});

	test('same year gives age 0', () => {
		expect(diffYears({ year: 900, month: 1, day: 1 }, { year: 900, month: 6, day: 1 }, GREGORIAN_CALENDAR)).toBe(0);
	});
});

describe('formatStoryDate (calendar-aware, granularity-sensitive)', () => {
	test('year-only date renders wide, no month/day', () => {
		expect(formatStoryDate(GREGORIAN_CALENDAR, { year: 940 })).toBe('Year 940');
	});

	test('month + year with no day', () => {
		expect(formatStoryDate(GREGORIAN_CALENDAR, { year: 940, month: 3 })).toBe('March, Year 940');
	});

	test('full date uses the calendar month name', () => {
		expect(formatStoryDate(GREGORIAN_CALENDAR, { year: 940, month: 3, day: 14 })).toBe('14 March, Year 940');
	});

	test('era name replaces the generic "Year" label', () => {
		expect(formatStoryDate(GREGORIAN_CALENDAR, { era: 'Fourth Age', year: 12, month: 1, day: 1 })).toBe('1 January, Fourth Age 12');
	});

	test('default 1440 minutesPerDay formats a 24h clock', () => {
		expect(formatStoryDate(GREGORIAN_CALENDAR, { year: 1, month: 1, day: 1, minute: 90 })).toBe('1 January, Year 1 01:30');
	});

	test('custom minutesPerDay falls back to a raw unit label', () => {
		const custom: CalendarDef = { id: 'c', name: 'C', months: GREGORIAN_CALENDAR.months, minutesPerDay: 1000, unitNames: { minute: 'bells' } };
		expect(formatStoryDate(custom, { year: 1, month: 1, day: 1, minute: 500 })).toBe('1 January, Year 1 500 bells');
	});

	test('monthless calendar renders "Day N"', () => {
		const monthless: CalendarDef = { id: 'plain', name: 'Plain Days' };
		expect(formatStoryDate(monthless, { year: 5, day: 200 })).toBe('Day 200, Year 5');
	});
});

describe('formatStoryDatePlain (no calendar context)', () => {
	test('renders numeric parts with no month-name lookup', () => {
		expect(formatStoryDatePlain({ year: 940, month: 3, day: 14 })).toBe('Year 940, Month 3, Day 14');
	});

	test('includes era when present', () => {
		expect(formatStoryDatePlain({ era: 'Fourth Age', year: 12 })).toBe('Fourth Age, Year 12');
	});
});

describe('parseStoryDate / serializeStoryDate', () => {
	test('round-trips a full date', () => {
		const date: StoryDate = { era: 'Fourth Age', year: 12, month: 3, day: 14, minute: 90 };
		expect(parseStoryDate(serializeStoryDate(date))).toEqual(date);
	});

	test('round-trips a year-only date', () => {
		const date: StoryDate = { year: 940 };
		expect(parseStoryDate(serializeStoryDate(date))).toEqual(date);
	});

	test('blank input parses to null', () => {
		expect(parseStoryDate('')).toBeNull();
		expect(parseStoryDate('   ')).toBeNull();
	});

	test('malformed JSON parses to null', () => {
		expect(parseStoryDate('{not json')).toBeNull();
	});

	test('an object with no year parses to null', () => {
		expect(parseStoryDate(JSON.stringify({ month: 3, day: 14 }))).toBeNull();
	});
});

describe('zero-day calendars', () => {
	test('a calendar with no months throws instead of looping forever', () => {
		const empty: CalendarDef = { id: 'empty', name: 'Empty', months: [] };
		expect(() => absoluteDayToStoryDate(empty, 10)).toThrow(/no days/i);
		expect(() => absoluteDayToStoryDate(empty, -10)).toThrow(/no days/i);
	});
});

// daysBeforeYear/yearForAbsoluteDay memoize per calendar object (see the cache
// note above their definitions in calendar.ts) — a real fix for the per-frame
// cost of walking year-by-year from Year 1 on a fantasy calendar with a huge
// year number. These tests exercise that caching directly: same calendar
// object queried repeatedly stays correct, and different calendar objects
// (including one that reuses another's `id`, mirroring a settings edit) never
// bleed cached values into each other.
describe('day-math caching (performance)', () => {
	test('repeated storyDateToAbsoluteDay/absoluteDayToStoryDate calls on the same calendar object return identical results', () => {
		const calendar: CalendarDef = { id: 'cache-a', name: 'Cache A', months: GREGORIAN_CALENDAR.months, leapRules: GREGORIAN_CALENDAR.leapRules };
		const date: StoryDate = { year: 940, month: 6, day: 15 };

		const day1 = storyDateToAbsoluteDay(calendar, date);
		const day2 = storyDateToAbsoluteDay(calendar, date);
		expect(day2).toBe(day1);

		const back1 = absoluteDayToStoryDate(calendar, day1);
		const back2 = absoluteDayToStoryDate(calendar, day1);
		expect(back2).toEqual(back1);
		expect(back1).toMatchObject({ year: 940, month: 6, day: 15 });
	});

	test('a run of consecutive-day lookups (simulating a pan/zoom tick walk) is identical cold vs warm, even at a huge year number', () => {
		const calendar: CalendarDef = { id: 'cache-huge', name: 'Cache Huge', months: GREGORIAN_CALENDAR.months, leapRules: GREGORIAN_CALENDAR.leapRules };
		const startDay = storyDateToAbsoluteDay(calendar, { year: 50000, month: 1, day: 1 });
		const offsets = [0, 1, 30, 31, 364];

		const cold = offsets.map((offset) => absoluteDayToStoryDate(calendar, startDay + offset));
		const warm = offsets.map((offset) => absoluteDayToStoryDate(calendar, startDay + offset));
		expect(warm).toEqual(cold);
		expect(cold[0]).toMatchObject({ year: 50000, month: 1, day: 1 });
		expect(cold[3]).toMatchObject({ year: 50000, month: 2, day: 1 }); // offset 31 rolls Jan (31 days) into Feb 1
	});

	test('two different calendar objects never share or corrupt each other\'s cached values', () => {
		const shortYear: CalendarDef = { id: 'short', name: 'Short', months: [{ name: 'Onemonth', days: 10 }] };
		const longYear: CalendarDef = { id: 'long', name: 'Long', months: [{ name: 'Onemonth', days: 100 }] };

		// Interleaved on purpose: a cache keyed only by year/day (not also by
		// calendar identity) would leak one calendar's answer into the other's.
		const shortDay = storyDateToAbsoluteDay(shortYear, { year: 3, month: 1, day: 1 });
		const longDay = storyDateToAbsoluteDay(longYear, { year: 3, month: 1, day: 1 });
		expect(shortDay).toBe(20); // two full 10-day years before year 3
		expect(longDay).toBe(200); // two full 100-day years before year 3

		expect(absoluteDayToStoryDate(shortYear, shortDay)).toMatchObject({ year: 3, month: 1, day: 1 });
		expect(absoluteDayToStoryDate(longYear, longDay)).toMatchObject({ year: 3, month: 1, day: 1 });
	});

	test('a calendar edit (a freshly-built object reusing the same id) is never masked by a stale cache', () => {
		// Mirrors how an edit reaches this module in practice: settings changes
		// replace TimelineData.calendar with a freshly-built object (see
		// TimelineControllerHost.mutate in timeline-render.ts) rather than
		// mutating months/leapRules/eras in place — the `id` can stay the same
		// while the definition itself changes. A cache keyed by `id` instead of
		// object reference would incorrectly serve the pre-edit value here.
		const before: CalendarDef = { id: 'editable', name: 'Editable', months: [{ name: 'Onemonth', days: 10 }] };
		expect(storyDateToAbsoluteDay(before, { year: 3, month: 1, day: 1 })).toBe(20);

		const after: CalendarDef = { id: 'editable', name: 'Editable', months: [{ name: 'Onemonth', days: 40 }] };
		expect(storyDateToAbsoluteDay(after, { year: 3, month: 1, day: 1 })).toBe(80);
	});
});
