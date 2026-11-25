import { chapterWord, planLine, stageLine } from './stage';

describe('chapter words', () => {
	it('say "Chapter" on big surfaces and "Ch." on small ones', () => {
		expect(chapterWord(3)).toBe('Chapter 3');
		expect(chapterWord(3, true)).toBe('Ch. 3');
		expect(stageLine('reminded', 14, true)).toBe('Reminded in Ch. 14');
		expect(stageLine('reminded', null, true)).toBe('Reminded');
		expect(planLine({ stage: 'paid-off', chapter: 12, label: 'The duel' }, true)).toMatch(/Ch\. 12/);
		expect(planLine({ stage: 'paid-off', chapter: null, label: 'The duel' }, true)).toMatch(/The duel/);
	});
});
