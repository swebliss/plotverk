import {
	applyStoryDateEdit,
	draftFromValue,
	numberFromInput,
	storyDateValue,
	EMPTY_STORYDATE_DRAFT,
	StoryDateDraft,
} from './story-date-edit';
import { parseStoryDateJson } from './field-types';

/** Replay a sequence of edits the way the widget does: carry the draft forward. */
function type(start: StoryDateDraft, ...edits: Parameters<typeof applyStoryDateEdit>[1][]) {
	let draft = start;
	let value = storyDateValue(start);
	for (const e of edits) {
		const r = applyStoryDateEdit(draft, e);
		draft = r.draft;
		value = r.value;
	}
	return { draft, value, parsed: parseStoryDateJson(value) };
}

describe('story-date editing keeps what was typed', () => {
	it('year, then month, then day all survive (the self-wipe bug)', () => {
		const r = type(EMPTY_STORYDATE_DRAFT, { year: 412 }, { month: 3 }, { day: 14 });
		expect(r.parsed).toEqual({ year: 412, month: 3, day: 14 });
	});

	it('the order of typing does not matter', () => {
		const r = type(EMPTY_STORYDATE_DRAFT, { day: 9 }, { month: 2 }, { year: 1000 });
		expect(r.parsed).toEqual({ year: 1000, month: 2, day: 9 });
	});

	it('month and day typed before any year are held, and appear once a year arrives', () => {
		const r1 = type(EMPTY_STORYDATE_DRAFT, { month: 5 }, { day: 6 });
		expect(r1.value).toBe('');
		const r2 = applyStoryDateEdit(r1.draft, { year: 77 });
		expect(parseStoryDateJson(r2.value)).toEqual({ year: 77, month: 5, day: 6 });
	});

	it('clearing the year empties the saved value but keeps month/day in the draft', () => {
		const r = type(draftFromValue('{"year":300,"month":4,"day":2}'), { year: null });
		expect(r.value).toBe('');
		expect(r.draft.month).toBe(4);
		expect(r.draft.day).toBe(2);
		// …so retyping the year brings the whole date back
		expect(parseStoryDateJson(applyStoryDateEdit(r.draft, { year: 301 }).value)).toEqual({ year: 301, month: 4, day: 2 });
	});

	it('editing one part leaves the others as they were', () => {
		const r = type(draftFromValue('{"era":"Third Age","year":3019,"month":3,"day":25}'), { month: 4 });
		expect(r.parsed).toEqual({ era: 'Third Age', year: 3019, month: 4, day: 25 });
	});

	it('clearing the month or day removes just that part', () => {
		const r = type(draftFromValue('{"year":50,"month":6,"day":7}'), { day: null }, { month: null });
		expect(r.parsed).toEqual({ year: 50 });
	});

	it('keeps the time of day set elsewhere (the widget has no box for it)', () => {
		const r = type(draftFromValue('{"year":10,"month":1,"day":1,"minute":540}'), { year: 11 });
		expect(r.parsed).toEqual({ year: 11, month: 1, day: 1, minute: 540 });
	});

	it('typing an era keeps the date, and a blank era drops the key', () => {
		const withEra = type(draftFromValue('{"year":5}'), { era: 'Dawn' });
		expect(withEra.parsed).toEqual({ era: 'Dawn', year: 5 });
		const blank = type(withEra.draft, { era: '  ' });
		expect(blank.parsed).toEqual({ year: 5 });
		expect(blank.value).not.toContain('era');
	});

	it('accepts a negative year', () => {
		expect(type(EMPTY_STORYDATE_DRAFT, { year: -200 }).parsed).toEqual({ year: -200 });
	});

	it('year 0 is a year, not "no year"', () => {
		expect(type(EMPTY_STORYDATE_DRAFT, { year: 0 }).parsed).toEqual({ year: 0 });
	});
});

describe('story-date limits', () => {
	it('pulls a typed month and day into range', () => {
		const r = type(draftFromValue('{"year":1}'), { month: 13 }, { day: 99 });
		expect(r.parsed).toEqual({ year: 1, month: 12, day: 31 });
		expect(type(draftFromValue('{"year":1}'), { month: 0 }, { day: -4 }).parsed).toEqual({ year: 1, month: 1, day: 1 });
	});

	it('honours a calendar with more months', () => {
		const r = applyStoryDateEdit(draftFromValue('{"year":1}'), { month: 13 }, { maxMonth: 13, maxDay: 28 });
		expect(parseStoryDateJson(r.value)?.month).toBe(13);
	});

	it('never alters a part it was not asked to edit', () => {
		// month 13 came from a 13-month calendar; editing the year must not squash it to 12
		const r = type(draftFromValue('{"year":9,"month":13,"day":40}'), { year: 10 });
		expect(r.parsed).toEqual({ year: 10, month: 13, day: 40 });
	});
});

describe('draftFromValue / numberFromInput / storyDateValue', () => {
	it('blank or malformed saved values give an empty draft', () => {
		expect(draftFromValue('')).toEqual(EMPTY_STORYDATE_DRAFT);
		expect(draftFromValue('not json')).toEqual(EMPTY_STORYDATE_DRAFT);
		expect(draftFromValue('{"month":3}')).toEqual(EMPTY_STORYDATE_DRAFT); // no year
	});

	it('round-trips a full date byte-for-byte in key order', () => {
		const value = '{"era":"E","year":1,"month":2,"day":3,"minute":4}';
		expect(storyDateValue(draftFromValue(value))).toBe(value);
	});

	it('numberFromInput reads empties and half-typed text as no value, never 0', () => {
		expect(numberFromInput('')).toBeNull();
		expect(numberFromInput('   ')).toBeNull();
		expect(numberFromInput('-')).toBeNull();
		expect(numberFromInput('abc')).toBeNull();
		expect(numberFromInput('Infinity')).toBeNull();
		expect(numberFromInput('0')).toBe(0);
		expect(numberFromInput('412')).toBe(412);
		expect(numberFromInput('-7')).toBe(-7);
		expect(numberFromInput('3.9')).toBe(3);
	});
});
