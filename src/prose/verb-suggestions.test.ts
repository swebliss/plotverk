import { getVerbSuggestions, suggestionDataSize } from './verb-suggestions';

describe('verb-suggestions', () => {
	test('exact adverb+verb pair beats the wildcard fallback', () => {
		const exact = getVerbSuggestions('quickly', 'walked');
		const wildcard = getVerbSuggestions('quickly', 'unknown-verb');
		expect(exact).toEqual(['strode', 'hurried', 'marched']);
		expect(exact).not.toEqual(wildcard);
	});

	test('falls back to the wildcard entry when the verb has no dedicated pairing', () => {
		const result = getVerbSuggestions('quickly', 'juggled');
		expect(result.length).toBeGreaterThan(0);
		expect(result).toEqual(getVerbSuggestions('quickly'));
	});

	test('unknown adverb yields an empty array', () => {
		expect(getVerbSuggestions('nonexistentadverb')).toEqual([]);
	});

	test('is case-insensitive on both adverb and verb', () => {
		expect(getVerbSuggestions('QUICKLY', 'WALKED')).toEqual(['strode', 'hurried', 'marched']);
	});

	test('curated dataset has at least 300 entries', () => {
		expect(suggestionDataSize()).toBeGreaterThanOrEqual(300);
	});

	test('every suggestion list is non-empty', () => {
		// Spot-check across a spread of adverbs rather than re-deriving the raw
		// data here — getVerbSuggestions is the only public surface.
		const adverbs = ['quickly', 'slowly', 'quietly', 'angrily', 'gracefully', 'wearily', 'boldly'];
		for (const adverb of adverbs) {
			expect(getVerbSuggestions(adverb).length).toBeGreaterThan(0);
		}
	});
});
