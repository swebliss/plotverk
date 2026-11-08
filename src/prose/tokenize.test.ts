import { tokenizeWords } from './tokenize';

describe('tokenizeWords', () => {
	test('offsets round-trip against the original text', () => {
		const text = 'She walked quickly, then ran.';
		const tokens = tokenizeWords(text);
		for (const t of tokens) {
			expect(text.slice(t.from, t.to).toLowerCase()).toBe(t.word);
		}
	});

	test('splits on punctuation and whitespace', () => {
		const tokens = tokenizeWords('Hello, world! It\'s fine-ish.');
		expect(tokens.map((t) => t.word)).toEqual(['hello', 'world', "it's", 'fine-ish']);
	});

	test('empty text yields no tokens', () => {
		expect(tokenizeWords('')).toEqual([]);
	});
});
