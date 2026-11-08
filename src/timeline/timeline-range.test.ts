import { GREGORIAN_CALENDAR, storyDateToAbsoluteDay } from './calendar';
import { CalendarDef, StoryDate } from './timeline-data';
import {
	clampTicksToLine,
	lineEnds,
	growRangeToFit,
	rangeFromYears,
	rangeNotice,
	rangeZoomFloor,
	RangeItem,
	resolveRange,
	snapStep,
	snapYear,
	validateRangeInput,
	yearLabel,
	yearStartDay,
	RANGE_YEAR_LIMIT,
} from './timeline-range';

const G = GREGORIAN_CALENDAR;
const day = (cal: CalendarDef, d: StoryDate): number => storyDateToAbsoluteDay(cal, d);
const moment = (name: string, cal: CalendarDef, d: StoryDate): RangeItem => ({ name, startDay: day(cal, d), endDay: day(cal, d) });

const AGES: CalendarDef = {
	id: 'ages',
	name: 'Ages',
	months: [{ name: 'Onemonth', days: 30 }],
	eras: [
		{ name: 'First Age', startYear: 1, resetsYearTo1: true },
		{ name: 'Second Age', startYear: 101, resetsYearTo1: true },
	],
};

describe('resolveRange', () => {
	test('absent range = Automatic', () => {
		expect(resolveRange(G, undefined)).toBeNull();
	});

	test('covers the start of the first year to the end of the last year', () => {
		const r = resolveRange(G, { start: { year: 1200 }, end: { year: 1220 } })!;
		expect(r.startYear).toBe(1200);
		expect(r.endYear).toBe(1220);
		expect(r.startDay).toBe(day(G, { year: 1200, month: 1, day: 1 }));
		expect(r.endDay).toBe(day(G, { year: 1221, month: 1, day: 1 }));
	});

	test('one year is a valid range', () => {
		expect(resolveRange(G, { start: { year: 5 }, end: { year: 5 } })).not.toBeNull();
	});

	test('a broken hand-edited range reads as Automatic', () => {
		expect(resolveRange(G, { start: { year: 1220 }, end: { year: 1200 } })).toBeNull();
		expect(resolveRange(G, { start: { year: 1e9 }, end: { year: 1e9 + 1 } })).toBeNull();
		expect(resolveRange(G, { start: { year: 1.5 }, end: { year: 3 } })).toBeNull();
		expect(resolveRange(G, { start: {} as StoryDate, end: { year: 3 } })).toBeNull();
	});

	test('era years resolve through the era (Second Age 5 = absolute 105)', () => {
		const r = resolveRange(AGES, { start: { era: 'Second Age', year: 5 }, end: { era: 'Second Age', year: 9 } })!;
		expect(r.startYear).toBe(105);
		expect(r.endYear).toBe(109);
	});

	test('negative and zero years work', () => {
		const r = resolveRange(G, { start: { year: -10 }, end: { year: 0 } })!;
		expect(r.startYear).toBe(-10);
		expect(r.endDay).toBe(yearStartDay(G, 1));
	});
});

describe('validateRangeInput', () => {
	test('accepts two years in order', () => {
		const v = validateRangeInput(G, { year: '1200' }, { year: '1220' });
		expect(v).toEqual({ ok: true, range: { start: { year: 1200 }, end: { year: 1220 } } });
	});

	test('start after end is refused', () => {
		expect(validateRangeInput(G, { year: '1220' }, { year: '1200' })).toEqual({ ok: false, error: 'order' });
	});

	test('blank or non-whole numbers are refused', () => {
		expect(validateRangeInput(G, { year: '' }, { year: '1200' })).toEqual({ ok: false, error: 'number' });
		expect(validateRangeInput(G, { year: '12.5' }, { year: '1200' })).toEqual({ ok: false, error: 'number' });
	});

	test('huge numbers are refused', () => {
		expect(validateRangeInput(G, { year: '1' }, { year: '99999999' })).toEqual({ ok: false, error: 'limit' });
	});

	test('negative years and a typographic minus are fine', () => {
		const v = validateRangeInput(G, { year: '−50' }, { year: '-10' });
		expect(v).toEqual({ ok: true, range: { start: { year: -50 }, end: { year: -10 } } });
	});

	test('order compares across eras, not raw numbers', () => {
		// Second Age 2 (abs 102) is after First Age 90 (abs 90), though 2 < 90.
		const v = validateRangeInput(AGES, { era: 'First Age', year: '90' }, { era: 'Second Age', year: '2' });
		expect(v).toEqual({ ok: true, range: { start: { era: 'First Age', year: 90 }, end: { era: 'Second Age', year: 2 } } });
		expect(validateRangeInput(AGES, { era: 'Second Age', year: '2' }, { era: 'First Age', year: '90' }))
			.toEqual({ ok: false, error: 'order' });
	});

	test('a year past the era end is saved under the era it really falls in', () => {
		const v = validateRangeInput(AGES, { era: 'First Age', year: '95' }, { era: 'First Age', year: '105' });
		expect(v).toEqual({ ok: true, range: { start: { era: 'First Age', year: 95 }, end: { era: 'Second Age', year: 5 } } });
	});
});

describe('snapping', () => {
	test('step grows with the span', () => {
		expect(snapStep(20)).toBe(1);
		expect(snapStep(44)).toBe(5);
		expect(snapStep(500)).toBe(10);
	});

	test('rounds outward, negative years included', () => {
		expect(snapYear(G, 1188, 5, 'down')).toBe(1185);
		expect(snapYear(G, 1232, 5, 'up')).toBe(1235);
		expect(snapYear(G, -7, 5, 'down')).toBe(-10);
		expect(snapYear(G, -7, 5, 'up')).toBe(-5);
		expect(snapYear(G, 1188, 1, 'down')).toBe(1188);
	});

	test('rounds in the era’s own numbers and never crosses into the era before', () => {
		// Second Age 7 = abs 107 → Second Age 5 = abs 105.
		expect(snapYear(AGES, 107, 5, 'down')).toBe(105);
		// Second Age 3 = abs 103 → would be Second Age 0 (First Age 100): stays Second Age 1.
		expect(snapYear(AGES, 103, 5, 'down')).toBe(101);
		// First Age 98 → would be First Age 100 (abs 100), fine; First Age 99 up by 10 → First Age 100.
		expect(snapYear(AGES, 99, 10, 'up')).toBe(100);
	});
});

describe('growRangeToFit', () => {
	const current = resolveRange(G, { start: { year: 1200 }, end: { year: 1220 } })!;

	test('nothing outside → null (and stays null on a second pass: no save loop)', () => {
		expect(growRangeToFit(G, current, [moment('A', G, { year: 1210, month: 3, day: 1 })])).toBeNull();
	});

	test('one event before the start grows the start to its year', () => {
		const g = growRangeToFit(G, current, [moment('The Levies Are Built', G, { year: 1195, month: 6, day: 1 })])!;
		expect(g.range).toEqual({ start: { year: 1195 }, end: { year: 1220 } });
		expect(growRangeToFit(G, g.after, [moment('The Levies Are Built', G, { year: 1195, month: 6, day: 1 })])).toBeNull();
	});

	test('an event on the last day of the end year is inside; the first day after is outside', () => {
		expect(growRangeToFit(G, current, [moment('A', G, { year: 1220, month: 12, day: 31 })])).toBeNull();
		const g = growRangeToFit(G, current, [moment('B', G, { year: 1221, month: 1, day: 1 })])!;
		expect(g.range.end).toEqual({ year: 1221 });
	});

	test('a bar that ends (or an ongoing bar that reaches the present) past the end grows the end', () => {
		const bar: RangeItem = { name: 'Wrenna Is Indentured', startDay: day(G, { year: 1210 }), endDay: day(G, { year: 1232, month: 5, day: 26 }) };
		const g = growRangeToFit(G, current, [bar])!;
		expect(g.range).toEqual({ start: { year: 1200 }, end: { year: 1235 } });
	});

	test('several events: one growth that covers all, snapped to round 5s on a long span', () => {
		const g = growRangeToFit(G, current, [
			moment('A', G, { year: 1188 }),
			moment('B', G, { year: 1232, month: 6, day: 4 }),
			moment('C', G, { year: 1210 }),
		])!;
		expect(g.range).toEqual({ start: { year: 1185 }, end: { year: 1235 } });
		expect(g.outside.map((o) => o.name)).toEqual(['A', 'B']);
	});

	test('never shrinks', () => {
		const wide = resolveRange(G, { start: { year: 1000 }, end: { year: 1300 } })!;
		const g = growRangeToFit(G, wide, [moment('A', G, { year: 1305 })])!;
		expect(g.after.startYear).toBe(1000);
		expect(g.after.endYear).toBeGreaterThanOrEqual(1305);
	});

	test('is the same answer from two windows seeing the same events (no fight)', () => {
		const items = [moment('A', G, { year: 1190 }), moment('B', G, { year: 1229 })];
		expect(growRangeToFit(G, current, items)).toEqual(growRangeToFit(G, current, [...items].reverse()));
	});

	test('ignores unusable days', () => {
		expect(growRangeToFit(G, current, [{ name: 'X', startDay: NaN, endDay: NaN }])).toBeNull();
	});

	test('era calendar: grows into the earlier era with that era’s own label', () => {
		const ages = resolveRange(AGES, { start: { era: 'Second Age', year: 1 }, end: { era: 'Second Age', year: 10 } })!;
		const g = growRangeToFit(AGES, ages, [moment('Old war', AGES, { era: 'First Age', year: 95 })])!;
		expect(g.range.start).toEqual({ era: 'First Age', year: 95 });
		expect(g.range.end).toEqual({ era: 'Second Age', year: 10 });
	});
});

describe('rangeNotice', () => {
	const current = resolveRange(G, { start: { year: 1188 }, end: { year: 1232 } })!;

	test('one event before', () => {
		const g = growRangeToFit(G, current, [moment('The Levies Are Built', G, { year: 1185 })])!;
		expect(rangeNotice(G, g)).toEqual({
			key: 'timeline.range.notice.before',
			vars: { name: 'The Levies Are Built', year: '1185', oldStart: '1188', newStart: '1185' },
		});
	});

	test('one event after', () => {
		const g = growRangeToFit(G, current, [moment('X', G, { year: 1236 })])!;
		expect(rangeNotice(G, g)).toEqual({ key: 'timeline.range.notice.after', vars: { name: 'X', year: '1236', oldEnd: '1232', newEnd: '1240' } });
	});

	test('one bar lasting past the end', () => {
		const g = growRangeToFit(G, current, [{ name: 'Y', startDay: day(G, { year: 1230 }), endDay: day(G, { year: 1234 }) }])!;
		expect(rangeNotice(G, g).key).toBe('timeline.range.notice.afterLasts');
		expect(rangeNotice(G, g).vars.year).toBe('1234');
	});

	test('one bar sticking out on both sides', () => {
		const g = growRangeToFit(G, current, [{ name: 'Z', startDay: day(G, { year: 1180 }), endDay: day(G, { year: 1240 }) }])!;
		expect(rangeNotice(G, g)).toEqual({ key: 'timeline.range.notice.both', vars: { name: 'Z', from: '1180', to: '1240', newStart: '1180', newEnd: '1240' } });
	});

	test('several events → one combined notice', () => {
		const g = growRangeToFit(G, current, [moment('A', G, { year: 1180 }), moment('B', G, { year: 1181 }), moment('C', G, { year: 1240 })])!;
		expect(rangeNotice(G, g)).toEqual({ key: 'timeline.range.notice.many', vars: { count: 3, newStart: '1180', newEnd: '1240' } });
	});

	test('era labels read like the calendar', () => {
		expect(yearLabel(AGES, 105)).toBe('Second Age 5');
		expect(yearLabel(G, -3)).toBe('-3');
	});
});

describe('review fixes', () => {
	const current = resolveRange(G, { start: { year: 1180 }, end: { year: 1200 } })!;

	test('an event past the year limit does not block growth for the others', () => {
		const typo: RangeItem = { name: 'Typo', startDay: yearStartDay(G, RANGE_YEAR_LIMIT + 5), endDay: yearStartDay(G, RANGE_YEAR_LIMIT + 5) };
		const g = growRangeToFit(G, current, [moment('Real', G, { year: 1210 }), typo])!;
		expect(g.range.end).toEqual({ year: 1210 });
		expect(g.outside.map((o) => o.name)).toEqual(['Real']);
	});

	test('a range naming an era the calendar no longer has reads as Automatic', () => {
		expect(resolveRange(AGES, { start: { era: 'Third Age', year: 1 }, end: { era: 'Second Age', year: 5 } })).toBeNull();
	});

	test('snapping down never lands on year 0 after year 1', () => {
		expect(snapYear(G, 3, 10, 'down')).toBe(1);
		expect(snapYear(G, -3, 10, 'down')).toBe(-10);
	});

	test('a character born and died outside counts once', () => {
		const born: RangeItem = { name: 'Mara', key: 'Codex/Mara.md', ...{ startDay: day(G, { year: 1170 }), endDay: day(G, { year: 1170 }) } };
		const died: RangeItem = { name: 'Mara', key: 'Codex/Mara.md', ...{ startDay: day(G, { year: 1230 }), endDay: day(G, { year: 1230 }) } };
		const g = growRangeToFit(G, current, [{ ...born, name: 'Mara — born', groupName: 'Mara' }, { ...died, name: 'Mara — died', groupName: 'Mara' }])!;
		expect(rangeNotice(G, g)).toMatchObject({ key: 'timeline.range.notice.both', vars: { name: 'Mara', from: '1170', to: '1230' } });
	});
});

describe('rangeZoomFloor', () => {
	test('half the fit, clamped between the global floor and the fit', () => {
		expect(rangeZoomFloor(0.02, 0.0005)).toBe(0.01);
		expect(rangeZoomFloor(0.0006, 0.0005)).toBe(0.0005);
		expect(rangeZoomFloor(0.0004, 0.0005)).toBe(0.0004);
	});
});

describe('lineEnds', () => {
	test('chosen years: exact first day to the end of the last year, named on the caps', () => {
		const r = resolveRange(G, rangeFromYears(G, 1200, 1220))!;
		expect(lineEnds(G, r, [moment('A', G, { year: 1210 })])).toEqual({ startDay: r.startDay, endDay: r.endDay, startYear: 1200, endYear: 1220, startLabel: '1200', endLabel: '1220' });
	});

	test('Automatic: first event to the last end, or the present when later', () => {
		const a = moment('A', G, { year: 1188, month: 3, day: 1 });
		const b: RangeItem = { name: 'B', startDay: day(G, { year: 1200 }), endDay: day(G, { year: 1230 }) };
		const present = day(G, { year: 1232, month: 6, day: 4 });
		expect(lineEnds(G, null, [a, b])).toMatchObject({ startDay: a.startDay, endDay: b.endDay, startLabel: '1188', endLabel: '1230' });
		expect(lineEnds(G, null, [a, b], present)).toMatchObject({ endDay: present, endLabel: '1232' });
	});

	test('everything on one day: the line covers that year (no stub)', () => {
		const a = moment('A', G, { year: 1188, month: 3, day: 1 });
		expect(lineEnds(G, null, [a, a], a.startDay)).toEqual({
			startDay: yearStartDay(G, 1188), endDay: yearStartDay(G, 1189), startYear: 1188, endYear: 1188, startLabel: '1188', endLabel: '1188',
		});
	});

	test('nothing dated, Automatic → no ends', () => {
		expect(lineEnds(G, null, [])).toBeNull();
		expect(lineEnds(G, null, [{ name: 'X', startDay: NaN, endDay: NaN }])).toBeNull();
	});

	test('era calendars name the era on the caps', () => {
		const r = resolveRange(AGES, { start: { era: 'First Age', year: 90 }, end: { era: 'Second Age', year: 3 } })!;
		expect(lineEnds(AGES, r, [])).toMatchObject({ startLabel: 'First Age 90', endLabel: 'Second Age 3' });
	});
});

describe('clampTicksToLine', () => {
	const ends = { startDay: yearStartDay(G, 1203), endDay: yearStartDay(G, 1219) };
	const tick = (y: number, kind = 'year') => ({ day: yearStartDay(G, y), label: String(y), kind });

	test('drops ticks off the line and year chips that would crowd a cap', () => {
		const ticks = [tick(1195), tick(1200), tick(1205), tick(1210), tick(1215), tick(1220)];
		expect(clampTicksToLine(ticks, ends, 365 * 5).map((t) => t.label)).toEqual(['1210']);
	});

	test('a year a cap already names is never shown twice', () => {
		const ticks = [tick(1210)];
		expect(clampTicksToLine(ticks, ends, 1, ['1210'])).toEqual([]);
	});

	test('month ticks on the line stay, even next to a cap', () => {
		const m = { day: day(G, { year: 1203, month: 2, day: 1 }), label: 'February', kind: 'month' };
		expect(clampTicksToLine([m], ends, 365 * 4)).toEqual([m]);
	});
});
