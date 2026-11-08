import { markRanges, findingAt } from './mark-ranges';
import { tryOfferAt, matchCase } from './coach-card';
import { findVerbPairing } from './verb-suggestions';
import { neverKeyFor, scanAll } from './counts';
import { buildIgnoreSet } from './tokenize';
import { ProseFinding } from './types';

const f = (kind: ProseFinding['kind'], from: number, to: number, word = 'w'): ProseFinding => ({ kind, from, to, text: word, word });

describe('markRanges', () => {
	test('sorted, deduped, and nothing on the skipped (cursor) line', () => {
		const out = markRanges(
			[f('repetition', 30, 36), f('adverb', 5, 11), f('adverb', 30, 36), f('adverb', 50, 56)],
			{ from: 45, to: 60 }
		);
		expect(out).toEqual([{ from: 5, to: 11 }, { from: 30, to: 36 }]);
	});
	test('a finding touching the line edge is skipped too', () => {
		expect(markRanges([f('adverb', 40, 45)], { from: 45, to: 60 })).toEqual([]);
	});
	test('empty ranges are dropped', () => {
		expect(markRanges([f('adverb', 3, 3)])).toEqual([]);
	});
});

describe('findingAt', () => {
	test('the narrowest finding wins', () => {
		const phrase = f('passive', 10, 20, 'was opened');
		const word = f('repetition', 14, 20, 'opened');
		expect(findingAt([phrase, word], 15)).toBe(word);
		expect(findingAt([phrase, word], 11)).toBe(phrase);
		expect(findingAt([phrase, word], 30)).toBeNull();
	});
});

describe('Try chips', () => {
	test('a curated pairing on either side, single words only', () => {
		const p = findVerbPairing('quickly', 'walked', undefined);
		expect(p?.side).toBe('prev');
		expect(p?.suggestions.every((s) => !/\s/.test(s))).toBe(true);
		expect(findVerbPairing('quickly', 'the', 'walked')?.side).toBe('next');
	});
	test('no generic fallback: an unknown neighbour gives no chips', () => {
		expect(findVerbPairing('quickly', 'zebra', 'banana')).toBeNull();
		expect(findVerbPairing('notanadverbly', 'walked')).toBeNull();
	});
	test('the offer covers the verb and the adverb', () => {
		const doc = 'She walked quickly to the door.';
		const from = doc.indexOf('quickly');
		const offer = tryOfferAt(doc, { kind: 'adverb', from, to: from + 7, word: 'quickly' });
		expect(offer && doc.slice(offer.from, offer.to)).toBe('walked quickly');
	});
	test('adverb first: "quickly walked"', () => {
		const doc = 'She quickly walked out.';
		const from = doc.indexOf('quickly');
		const offer = tryOfferAt(doc, { kind: 'adverb', from, to: from + 7, word: 'quickly' });
		expect(offer && doc.slice(offer.from, offer.to)).toBe('quickly walked');
	});
	test('only adverbs get offers', () => {
		expect(tryOfferAt('cold cold cold', { kind: 'repetition', from: 0, to: 4, word: 'cold' })).toBeNull();
	});
	test('matchCase keeps a leading capital', () => {
		expect(matchCase('Walked quickly', 'strode')).toBe('Strode');
		expect(matchCase('walked quickly', 'strode')).toBe('strode');
	});
});

describe('"Never this word" for a passive phrase', () => {
	test('stores the participle, and that silences the phrase', () => {
		const passive: ProseFinding = { kind: 'passive', from: 9, to: 19, text: 'was opened', word: 'was opened' };
		expect(neverKeyFor(passive)).toBe('opened');
		const on = { adverbs: true, passive: true, repetition: true };
		expect(scanAll('The door was opened by her.', on).counts.passive).toBe(1);
		expect(scanAll('The door was opened by her.', on, { ignore: buildIgnoreSet([], ['opened']) }).counts.passive).toBe(0);
	});
	test('adverb and repeated word store the word itself', () => {
		expect(neverKeyFor({ kind: 'adverb', text: 'Slowly', word: 'slowly' })).toBe('slowly');
	});
});
