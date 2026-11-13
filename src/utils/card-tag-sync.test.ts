import { applyCardTagChanges, cardTagChanges, normalizeCardTag, noteTagList } from './card-tag-sync';

describe('normalizeCardTag', () => {
	it('keeps Swedish and other alphabets', () => {
		expect(normalizeCardTag('Hämnd')).toBe('#hämnd');
		expect(normalizeCardTag('#år')).toBe('#år');
		expect(normalizeCardTag('förräderi')).toBe('#förräderi');
		expect(normalizeCardTag('месть')).toBe('#месть');
	});
	it('turns spaces into a dash instead of gluing words', () => {
		expect(normalizeCardTag('love triangle')).toBe('#love-triangle');
	});
	it('keeps nested tags and drops punctuation', () => {
		expect(normalizeCardTag('plot/twist!')).toBe('#plot/twist');
		expect(normalizeCardTag('a#b')).toBe('#ab');
	});
	it('gives nothing usable for tags Obsidian would ignore', () => {
		expect(normalizeCardTag('123')).toBe('#');
		expect(normalizeCardTag('-')).toBe('#');
		expect(normalizeCardTag('##')).toBe('#');
		expect(normalizeCardTag('-plot-')).toBe('#plot');
		expect(normalizeCardTag('2nd')).toBe('#2nd');
	});
	it('stores å the same way however it was typed', () => {
		expect(normalizeCardTag('år')).toBe(normalizeCardTag('år'));
	});
});

describe('noteTagList', () => {
	it('reads a list, a comma text, or nothing', () => {
		expect(noteTagList(['a', 'b'])).toEqual(['a', 'b']);
		expect(noteTagList('a, b c')).toEqual(['a', 'b', 'c']);
		expect(noteTagList(undefined)).toEqual([]);
		expect(noteTagList([null, ' x '])).toEqual(['x']);
	});
});

describe('cardTagChanges', () => {
	it('finds what the writer added and removed', () => {
		expect(cardTagChanges(['#a', '#b'], ['#b', '#c'])).toEqual({ added: ['#c'], removed: ['#a'] });
	});
	it('sees no change when nothing changed', () => {
		expect(cardTagChanges(['#a'], ['#a'])).toEqual({ added: [], removed: [] });
	});
});

describe('applyCardTagChanges', () => {
	it("adds a card tag without touching the note's own tags", () => {
		expect(applyCardTagChanges(['mine', 'draft'], ['#heist'], [])).toEqual(['mine', 'draft', 'heist']);
	});
	it('removes only the tag removed on the card', () => {
		expect(applyCardTagChanges(['mine', 'heist'], [], ['#heist'])).toEqual(['mine']);
	});
	it('matches without caring about capitals', () => {
		expect(applyCardTagChanges(['Hämnd'], [], ['#hämnd'])).toEqual([]);
		expect(applyCardTagChanges(['Hämnd'], ['#hämnd'], [])).toBeNull();
	});
	it('writes nothing when the note would not change', () => {
		expect(applyCardTagChanges(['mine'], [], ['#gone'])).toBeNull();
		expect(applyCardTagChanges(undefined, [], ['#gone'])).toBeNull();
	});
	it('starts a list on a note without tags', () => {
		expect(applyCardTagChanges(undefined, ['#heist'], [])).toEqual(['heist']);
	});
});
