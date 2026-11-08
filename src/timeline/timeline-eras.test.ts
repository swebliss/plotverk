import { GREGORIAN_CALENDAR, storyDateToAbsoluteDay } from './calendar';
import type { CalendarDef } from './timeline-data';
import {
	ERA_BAND_MIN_OPACITY,
	ERA_BAND_OPACITY,
	ERA_DEFAULT_COLORS,
	ERA_LABEL_PAD,
	defaultEraColor,
	eraBandRect,
	eraEndDay,
	eraLabelAlong,
	isEraHowLong,
	layoutEraBands,
	placeEraLabels,
} from './timeline-eras';
import { classifyEntity, eventDurationFrom } from './timeline-events';
import { growRangeToFit, resolveRange } from './timeline-range';

const G = GREGORIAN_CALENDAR;
const day = (year: number, month?: number, d?: number): number => storyDateToAbsoluteDay(G, { year, month, day: d });

describe('an era is an Event sheet whose How Long says "An era"', () => {
	test('isEraHowLong reads the sheet value, any case and spacing', () => {
		expect(isEraHowLong('An era')).toBe(true);
		expect(isEraHowLong('  an ERA ')).toBe(true);
		expect(isEraHowLong('Lasts a while')).toBe(false);
		expect(isEraHowLong(undefined)).toBe(false);
		expect(isEraHowLong(3)).toBe(false);
	});

	test('eventDurationFrom knows the third value, and an empty value still follows the End Date', () => {
		expect(eventDurationFrom('An era', false)).toBe('era');
		expect(eventDurationFrom('An era', true)).toBe('era');
		expect(eventDurationFrom('', true)).toBe('lasting');
		expect(eventDurationFrom(undefined, false)).toBe('moment');
	});

	test('classifyEntity marks it as an era, with the same End Date rules as "Lasts a while"', () => {
		const start = '{"year":1190}';
		expect(classifyEntity('event', start, undefined, undefined, '{"year":1210}', G, 'An era'))
			.toEqual({ bucket: 'dated-event', date: { year: 1190 }, end: { year: 1210 }, era: true });
		// No End Date: still going on.
		expect(classifyEntity('event', start, undefined, undefined, undefined, G, 'An era'))
			.toEqual({ bucket: 'dated-event', date: { year: 1190 }, ongoing: true, era: true });
		// An End Date before the start is not "ongoing" — the sheet shows an end — but it is still an era.
		expect(classifyEntity('event', start, undefined, undefined, '{"year":1100}', G, 'An era'))
			.toEqual({ bucket: 'dated-event', date: { year: 1190 }, era: true });
		// No date at all: the Undated shelf, like any event.
		expect(classifyEntity('event', '', undefined, undefined, undefined, G, 'An era')).toEqual({ bucket: 'undated-event' });
		// Switching back to an event draws it as an event again.
		expect(classifyEntity('event', start, undefined, undefined, '{"year":1210}', G, 'Lasts a while')).not.toHaveProperty('era');
	});
});

describe('eraEndDay — where a band stops', () => {
	test('its End Date', () => {
		expect(eraEndDay(G, day(1190), day(1210), day(1232))).toBe(day(1210));
	});

	test('no End Date: up to the story\'s present', () => {
		expect(eraEndDay(G, day(1210), undefined, day(1232, 6, 4))).toBe(day(1232, 6, 4));
	});

	test('no present yet, or a present before it starts: to the end of its first year, never zero length', () => {
		expect(eraEndDay(G, day(1210, 3, 1), undefined, undefined)).toBe(day(1211));
		expect(eraEndDay(G, day(1210, 3, 1), undefined, day(1200))).toBe(day(1211));
		// An End Date on the start day is no length at all.
		expect(eraEndDay(G, day(1210), day(1210), undefined)).toBe(day(1211));
	});

	test('a custom calendar counts its own year length', () => {
		const cal: CalendarDef = {
			id: 'test', name: 'Test',
			months: [{ name: 'Thaw', days: 50 }, { name: 'Frost', days: 50 }],
			eras: [{ name: 'Second Age', startYear: 101, resetsYearTo1: true }],
		};
		const start = storyDateToAbsoluteDay(cal, { era: 'Second Age', year: 3, month: 2, day: 10 });
		const end = eraEndDay(cal, start, undefined, undefined);
		expect(end).toBe(storyDateToAbsoluteDay(cal, { era: 'Second Age', year: 4 }));
		expect(end - start).toBe(41);
	});
});

describe('layoutEraBands — overlapping eras', () => {
	test('one era: full strength, first label line', () => {
		const [b] = layoutEraBands([{ id: 'a', startDay: 0, endDay: 100 }]);
		expect(b).toMatchObject({ depth: 1, opacity: ERA_BAND_OPACITY, labelSlot: 0 });
	});

	test('eras that only touch (one ends where the next begins) do not overlap', () => {
		const bands = layoutEraBands([{ id: 'a', startDay: 0, endDay: 100 }, { id: 'b', startDay: 100, endDay: 200 }]);
		expect(bands.map((b) => [b.id, b.depth, b.labelSlot])).toEqual([['a', 1, 0], ['b', 1, 0]]);
	});

	test('two overlapping eras: both softer, the second name on its own line', () => {
		const bands = layoutEraBands([{ id: 'late', startDay: 50, endDay: 150 }, { id: 'early', startDay: 0, endDay: 100 }]);
		const byId = new Map(bands.map((b) => [b.id, b]));
		expect(byId.get('early')).toMatchObject({ depth: 2, labelSlot: 0 });
		expect(byId.get('late')).toMatchObject({ depth: 2, labelSlot: 1 });
		expect(byId.get('early')!.opacity).toBeCloseTo(ERA_BAND_OPACITY / Math.SQRT2);
		// Where they overlap the wash is about one band's strength, never much darker.
		const a = byId.get('early')!.opacity;
		const combined = 1 - (1 - a) * (1 - a);
		expect(combined).toBeLessThan(ERA_BAND_OPACITY * 1.5);
	});

	test('depth counts eras under way on the same day, not every era it touches', () => {
		// a spans everything; b and c sit inside it one after the other — never three at once.
		const bands = layoutEraBands([
			{ id: 'a', startDay: 0, endDay: 300 },
			{ id: 'b', startDay: 10, endDay: 100 },
			{ id: 'c', startDay: 150, endDay: 250 },
		]);
		const byId = new Map(bands.map((b) => [b.id, b]));
		expect(byId.get('a')!.depth).toBe(2);
		// b and c never overlap each other, so they share the second label line.
		expect(byId.get('b')!.labelSlot).toBe(1);
		expect(byId.get('c')!.labelSlot).toBe(1);
		// Longest first: a short era is painted after (on top of) a long one.
		expect(bands[0].id).toBe('a');
	});

	test('many eras at once never fade below the floor', () => {
		const many = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, startDay: i, endDay: 1000 }));
		for (const b of layoutEraBands(many)) expect(b.opacity).toBeGreaterThanOrEqual(ERA_BAND_MIN_OPACITY);
	});

	test('a band with no length, or broken numbers, is dropped rather than drawn', () => {
		expect(layoutEraBands([{ id: 'x', startDay: 5, endDay: 5 }, { id: 'y', startDay: NaN, endDay: 9 }])).toEqual([]);
	});
});

describe('eraBandRect — the band behind everything', () => {
	test('vertical: its days down the time axis, the whole width across', () => {
		expect(eraBandRect({ startDay: 10, endDay: 30 }, 2, 'vertical', 500)).toEqual({ x: -500, y: 20, width: 1000, height: 40 });
	});

	test('horizontal: its days along, the whole height across', () => {
		expect(eraBandRect({ startDay: 10, endDay: 30 }, 2, 'horizontal', 500)).toEqual({ x: 20, y: -500, width: 40, height: 1000 });
	});

	test('an ongoing era runs to the story\'s present', () => {
		const end = eraEndDay(G, day(1210), undefined, day(1232, 6, 4));
		const rect = eraBandRect({ startDay: day(1210), endDay: end }, 1, 'vertical');
		expect(rect.y + rect.height).toBe(day(1232, 6, 4));
	});
});

describe('eraLabelAlong — the name at the band\'s start edge', () => {
	test('just inside the start edge while it is on screen', () => {
		expect(eraLabelAlong(100, 400, 0, 18)).toBe(100 + ERA_LABEL_PAD);
	});

	test('held at the view\'s edge once the start has scrolled away', () => {
		expect(eraLabelAlong(-300, 400, 0, 18)).toBe(ERA_LABEL_PAD);
	});

	test('a second overlapping era sits one line further in', () => {
		expect(eraLabelAlong(100, 400, 0, 18, 18)).toBe(100 + ERA_LABEL_PAD + 18);
	});

	test('no room left inside the visible band: no label (never spills outside its era)', () => {
		expect(eraLabelAlong(100, 120, 0, 18)).toBeNull();
		expect(eraLabelAlong(-300, 20, 0, 18)).toBeNull();
	});
});

describe('defaultEraColor', () => {
	test('the same era always gets the same gentle colour from the palette', () => {
		const c = defaultEraColor('Saltmarch/Codex/Events/The Drowned Years.md');
		expect(defaultEraColor('Saltmarch/Codex/Events/The Drowned Years.md')).toBe(c);
		expect(ERA_DEFAULT_COLORS).toContain(c);
	});
});

describe('eras count toward "Years shown"', () => {
	test('an era outside the chosen years grows them, by its start and its end', () => {
		const range = resolveRange(G, { start: { year: 1200 }, end: { year: 1220 } })!;
		const growth = growRangeToFit(G, range, [{ name: 'Before the Flood', startDay: day(1150), endDay: day(1210) }]);
		expect(growth?.after.startYear).toBe(1150);
		expect(growth?.after.endYear).toBe(1220);
	});

	test('an ongoing era reaches the story\'s present and grows the end too', () => {
		const range = resolveRange(G, { start: { year: 1200 }, end: { year: 1220 } })!;
		const end = eraEndDay(G, day(1215), undefined, day(1232, 6, 4));
		const growth = growRangeToFit(G, range, [{ name: 'Crane’s Rule', startDay: day(1215), endDay: end }]);
		// 1232, rounded up to a round 5 on a 30+ year span.
		expect(growth?.after.endYear).toBe(1235);
	});
});

describe('placeEraLabels — names never sit on top of each other', () => {
	test('time running down: a second era starting at the same place moves one line further in', () => {
		const spots = placeEraLabels([
			{ id: 'a', start: 100, end: 900, slot: 0, length: 18 },
			{ id: 'b', start: 100, end: 400, slot: 1, length: 18 },
		], 0, 'lines');
		expect(spots.get('a')).toEqual({ along: 108, row: 0 });
		expect(spots.get('b')).toEqual({ along: 126, row: 0 });
	});

	test('time running down: eras far apart keep their own start edges', () => {
		const spots = placeEraLabels([
			{ id: 'a', start: 0, end: 900, slot: 0, length: 18 },
			{ id: 'b', start: 300, end: 600, slot: 1, length: 18 },
		], 0, 'lines');
		expect(spots.get('b')).toEqual({ along: 308, row: 0 });
	});

	test('time running down: both scrolled past their start — held at the top, one under the other', () => {
		const spots = placeEraLabels([
			{ id: 'a', start: -500, end: 900, slot: 0, length: 18 },
			{ id: 'b', start: -200, end: 900, slot: 1, length: 18 },
		], 0, 'lines');
		expect(spots.get('a')!.along).toBe(8);
		expect(spots.get('b')!.along).toBe(26);
	});

	test('time running down: no room left in a short band — that name is left out, not spilled', () => {
		const spots = placeEraLabels([
			{ id: 'a', start: 100, end: 900, slot: 0, length: 18 },
			{ id: 'b', start: 100, end: 130, slot: 1, length: 18 },
		], 0, 'lines');
		expect(spots.get('b')).toBeNull();
	});

	test('time running sideways: overlapping eras get their own rows', () => {
		const spots = placeEraLabels([
			{ id: 'a', start: 100, end: 900, slot: 0, length: 120 },
			{ id: 'b', start: 100, end: 900, slot: 1, length: 120 },
		], 0, 'rows');
		expect(spots.get('a')).toEqual({ along: 108, row: 0 });
		expect(spots.get('b')).toEqual({ along: 108, row: 1 });
	});
});
