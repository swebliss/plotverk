import { findPassive } from './passive';

describe('findPassive', () => {
	test('matches simple be + irregular participle', () => {
		const findings = findPassive('The letter was taken from the drawer.');
		expect(findings.length).toBe(1);
		expect(findings[0].text.toLowerCase()).toBe('was taken');
	});

	test('matches be + adverb + participle', () => {
		const findings = findPassive('The wound has been thoroughly examined.');
		expect(findings.length).toBe(1);
		expect(findings[0].text.toLowerCase()).toBe('has been thoroughly examined');
	});

	test('matches get-passive', () => {
		const findings = findPassive('The key got hidden under the mat.');
		expect(findings.length).toBe(1);
		expect(findings[0].text.toLowerCase()).toBe('got hidden');
	});

	test('flags a trailing by-phrase as high confidence', () => {
		const findings = findPassive('The letter will be written by the clerk.');
		expect(findings.length).toBe(1);
		expect(findings[0].hasByPhrase).toBe(true);
	});

	test('does not flag "was happy"', () => {
		expect(findPassive('She was happy.')).toEqual([]);
	});

	test('does not flag "is open"', () => {
		expect(findPassive('The door is open.')).toEqual([]);
	});

	test('does not flag "were seven"', () => {
		expect(findPassive('They were seven in total.')).toEqual([]);
	});

	test('offsets round-trip against the original text', () => {
		const text = 'The vase was broken by the wind.';
		const findings = findPassive(text);
		for (const f of findings) {
			expect(text.slice(f.from, f.to)).toBe(f.text);
		}
	});
});
