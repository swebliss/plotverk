import { classifyEntity, eventDurationFrom, eventSummaryFromFrontmatter, isTimelineEmpty, storyPresent, storyPresentDay } from './timeline-events';

describe('classifyEntity()', () => {
	test('an Event sheet with a valid date is dated-event', () => {
		const result = classifyEntity('event', '{"year":940}', undefined, undefined);
		expect(result).toEqual({ bucket: 'dated-event', date: { year: 940 } });
	});

	test('an Event sheet with no date field at all is undated-event', () => {
		const result = classifyEntity('event', undefined, undefined, undefined);
		expect(result).toEqual({ bucket: 'undated-event' });
	});

	test('an Event sheet whose date is an empty string is undated-event', () => {
		const result = classifyEntity('event', '', undefined, undefined);
		expect(result).toEqual({ bucket: 'undated-event' });
	});

	test('an Event sheet whose date is unparseable JSON is undated-event, not skipped', () => {
		const result = classifyEntity('event', 'not json', undefined, undefined);
		expect(result).toEqual({ bucket: 'undated-event' });
	});

	test('an Event sheet whose date is the wrong type (not a string) is undated-event', () => {
		const result = classifyEntity('event', 12345, undefined, undefined);
		expect(result).toEqual({ bucket: 'undated-event' });
	});

	test('a Character sheet reports parsed born/died, independently', () => {
		const result = classifyEntity('character', undefined, '{"year":900}', '{"year":960}');
		expect(result).toEqual({ bucket: 'character', born: { year: 900 }, died: { year: 960 } });
	});

	test('a Character sheet with neither born nor died parses both to null — never undated', () => {
		const result = classifyEntity('character', undefined, undefined, undefined);
		expect(result).toEqual({ bucket: 'character', born: null, died: null });
	});

	test('any other storygrid-type (or none) is skipped', () => {
		expect(classifyEntity('location', '{"year":1}', undefined, undefined)).toEqual({ bucket: 'skip' });
		expect(classifyEntity(undefined, undefined, undefined, undefined)).toEqual({ bucket: 'skip' });
	});

	test('an Event with an end date on/after its start date produces a span (end field present)', () => {
		const result = classifyEntity('event', '{"year":940}', undefined, undefined, '{"year":942}');
		expect(result).toEqual({ bucket: 'dated-event', date: { year: 940 }, end: { year: 942 } });
	});

	test('an end date with no start date is dropped — the event is undated, end never surfaces', () => {
		const result = classifyEntity('event', undefined, undefined, undefined, '{"year":942}');
		expect(result).toEqual({ bucket: 'undated-event' });
	});

	test('an end date before the start date is dropped — the event stays a point, not an error, not swapped', () => {
		const result = classifyEntity('event', '{"year":940}', undefined, undefined, '{"year":900}');
		expect(result).toEqual({ bucket: 'dated-event', date: { year: 940 } });
	});

	test('a fully undated event with an end-date value present remains undated, unaffected', () => {
		const result = classifyEntity('event', '', undefined, undefined, '{"year":942}');
		expect(result).toEqual({ bucket: 'undated-event' });
	});
});

describe('isTimelineEmpty()', () => {
	test('true when there are neither dated nor undated events', () => {
		expect(isTimelineEmpty(0, 0)).toBe(true);
	});

	test('false when there is at least one dated event', () => {
		expect(isTimelineEmpty(1, 0)).toBe(false);
	});

	test('false when there is at least one undated event — a shelf with items is not empty', () => {
		expect(isTimelineEmpty(0, 1)).toBe(false);
	});

	test('false when there is both', () => {
		expect(isTimelineEmpty(2, 3)).toBe(false);
	});
});

describe('eventSummaryFromFrontmatter()', () => {
	test('prefers Description, then What Happened', () => {
		expect(eventSummaryFromFrontmatter({ description: 'A', 'what-happened': 'B' })).toBe('A');
		expect(eventSummaryFromFrontmatter({ 'what-happened': 'B' })).toBe('B');
	});

	test('takes the first non-empty line and shows link words, not brackets', () => {
		const fm = { description: '\n  [[Mara Ferrow|Mara]] dives on **the** [[Holding]].\nSecond line' };
		expect(eventSummaryFromFrontmatter(fm)).toBe('Mara dives on the Holding.');
	});

	test('skips an empty field and falls through to the next one', () => {
		expect(eventSummaryFromFrontmatter({ description: '   ', 'what-happened': 'Flood.' })).toBe('Flood.');
	});

	test('trims a long line on a word boundary with an ellipsis', () => {
		const out = eventSummaryFromFrontmatter({ description: 'word '.repeat(60) }, 40);
		expect(out.endsWith('…')).toBe(true);
		expect(out.length).toBeLessThanOrEqual(41);
	});

	test('answers an empty string when there is nothing to show', () => {
		expect(eventSummaryFromFrontmatter(undefined)).toBe('');
		expect(eventSummaryFromFrontmatter({ type: 'Political', description: 3 })).toBe('');
	});
});

describe('"How Long" (2026-11-03)', () => {
	const date = '{"year":1210,"month":3,"day":15}';
	const end = '{"year":1212,"month":1,"day":1}';
	test('left empty, it follows the sheet: an End Date lasts, none is a moment (old sheets unchanged)', () => {
		expect(eventDurationFrom(undefined, true)).toBe('lasting');
		expect(eventDurationFrom('', false)).toBe('moment');
		expect(classifyEntity('event', date, undefined, undefined, end)).toEqual({ bucket: 'dated-event', date: { year: 1210, month: 3, day: 15 }, end: { year: 1212, month: 1, day: 1 } });
		expect(classifyEntity('event', date, undefined, undefined, undefined)).toEqual({ bucket: 'dated-event', date: { year: 1210, month: 3, day: 15 } });
	});
	test('"Lasts a while" with no End Date is still going on', () => {
		expect(classifyEntity('event', date, undefined, undefined, undefined, undefined, 'Lasts a while')).toEqual({ bucket: 'dated-event', date: { year: 1210, month: 3, day: 15 }, ongoing: true });
	});
	test('"A moment" wins over a leftover End Date', () => {
		expect(classifyEntity('event', date, undefined, undefined, end, undefined, 'A moment')).toEqual({ bucket: 'dated-event', date: { year: 1210, month: 3, day: 15 } });
	});
	test('a filled-in End Date that cannot be used (before the start, unreadable) is a moment, never "ongoing"', () => {
		const before = '{"year":1200}';
		expect(classifyEntity('event', date, undefined, undefined, before, undefined, 'lasts a while ')).toEqual({ bucket: 'dated-event', date: { year: 1210, month: 3, day: 15 } });
		expect(classifyEntity('event', date, undefined, undefined, 'soon', undefined, 'Lasts a while')).toEqual({ bucket: 'dated-event', date: { year: 1210, month: 3, day: 15 } });
		expect(classifyEntity('event', date, undefined, undefined, '  ', undefined, 'Lasts a while')).toMatchObject({ ongoing: true });
	});
});

describe('storyPresentDay()', () => {
	const cal = { id: 'flat', name: 'Flat' };
	test('is the latest chapter date when the timeline has any', () => {
		expect(storyPresentDay(cal, { a: { year: 5 }, b: { year: 9 } }, [{ date: { year: 20 } }])).toBe(storyPresentDay(cal, {}, [{ date: { year: 9 } }]));
	});
	test('else the latest date any event reaches, end dates included', () => {
		expect(storyPresentDay(cal, {}, [{ date: { year: 3 }, end: { year: 12 } }, { date: { year: 10 } }])).toBe(storyPresentDay(cal, {}, [{ date: { year: 12 } }]));
	});
	test('storyPresent keeps the chapter date exactly as written', () => {
		expect(storyPresent(cal, { a: { year: 5 }, b: { year: 9 } }, [])?.date).toEqual({ year: 9 });
	});
	test('is undefined with nothing dated', () => {
		expect(storyPresentDay(cal, {}, [])).toBeUndefined();
	});
});
