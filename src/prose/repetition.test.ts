import { findRepetition, STOPWORDS } from './repetition';

function repeatWord(word: string, times: number, gapWords = 0): string {
	const gap = gapWords > 0 ? Array.from({ length: gapWords }, (_, i) => `filler${i}`).join(' ') + ' ' : '';
	return Array.from({ length: times }, () => `${word} ${gap}`).join('').trim();
}

describe('findRepetition', () => {
	test('flags a word used 3+ times within the window, at every occurrence', () => {
		const text = 'The cold wind bit at her cold hands in the cold night.';
		const findings = findRepetition(text);
		const coldFindings = findings.filter((f) => f.word === 'cold');
		expect(coldFindings.length).toBe(3);
	});

	test('does not flag a word repeated 3 times but spread far apart', () => {
		const text = repeatWord('shadow', 3, 150); // ~150 filler words between each occurrence
		const findings = findRepetition(text, { windowSize: 100 });
		expect(findings.filter((f) => f.word === 'shadow')).toEqual([]);
	});

	test('never flags stopwords no matter how often they repeat', () => {
		const text = Array.from({ length: 20 }, () => 'the').join(' ');
		expect(findRepetition(text)).toEqual([]);
		expect(STOPWORDS.has('the')).toBe(true);
	});

	test('ignores words shorter than the minimum length', () => {
		const text = Array.from({ length: 5 }, () => 'red').join(' shirt ');
		const findings = findRepetition(text, { minWordLength: 4 });
		expect(findings.filter((f) => f.word === 'red')).toEqual([]);
	});

	test('performs in reasonable time on a very long text', () => {
		const bigText = Array.from({ length: 50000 }, (_, i) => (i % 500 === 0 ? 'ominous' : `word${i}`)).join(' ');
		const start = Date.now();
		findRepetition(bigText);
		expect(Date.now() - start).toBeLessThan(2000);
	});
});
