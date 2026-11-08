import { findAdverbs } from './adverbs';

describe('findAdverbs', () => {
	test('finds manner adverbs with exact offsets', () => {
		const text = 'She walked slowly and spoke quietly.';
		const findings = findAdverbs(text);
		const words = findings.map((f) => f.word);
		expect(words).toEqual(['slowly', 'quietly']);
		for (const f of findings) {
			expect(text.slice(f.from, f.to).toLowerCase()).toBe(f.word);
		}
	});

	test('skips whitelisted non-adverb -ly words', () => {
		const text = 'Her family lives in Italy, and only she seemed likely to leave.';
		expect(findAdverbs(text)).toEqual([]);
	});

	test('is case-insensitive and skips 3-letter -ly words', () => {
		const findings = findAdverbs('QUICKLY the fly landed.');
		expect(findings.map((f) => f.word)).toEqual(['quickly']);
	});

	test('empty text yields no findings', () => {
		expect(findAdverbs('')).toEqual([]);
	});
});
