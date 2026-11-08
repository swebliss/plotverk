import { sentenceBounds, quoteFor, quoteToString } from './sentences';

const at = (text: string, word: string, nth = 0) => {
	let i = -1;
	for (let k = 0; k <= nth; k++) i = text.indexOf(word, i + 1);
	return { from: i, to: i + word.length };
};

describe('sentenceBounds', () => {
	const text = 'Wrenna opened the door. She walked slowly to the window, and stopped! "Who?" she said.';
	test('the whole sentence around a word', () => {
		const r = at(text, 'slowly');
		const b = sentenceBounds(text, r.from, r.to);
		expect(text.slice(b.from, b.to)).toBe('She walked slowly to the window, and stopped!');
	});
	test('first sentence and closing quotes', () => {
		const a = at(text, 'opened');
		expect(text.slice(...Object.values(sentenceBounds(text, a.from, a.to)) as [number, number])).toBe('Wrenna opened the door.');
		const w = at(text, 'Who');
		expect(text.slice(...Object.values(sentenceBounds(text, w.from, w.to)) as [number, number])).toBe('"Who?"');
	});
	test('never crosses a line break; list and quote markers are left out', () => {
		const t = 'First line without stop\n> - She ran quickly home\nNext.';
		const r = at(t, 'quickly');
		const b = sentenceBounds(t, r.from, r.to);
		expect(t.slice(b.from, b.to)).toBe('She ran quickly home');
	});
	test('CRLF lines', () => {
		const t = 'One.\r\nShe ran quickly.\r\nTwo.';
		const r = at(t, 'quickly');
		const b = sentenceBounds(t, r.from, r.to);
		expect(t.slice(b.from, b.to)).toBe('She ran quickly.');
	});
});

describe('quoteFor', () => {
	test('one sentence, word marked', () => {
		const t = 'She walked slowly to the door, and stopped. The cold had got in.';
		expect(quoteToString(quoteFor(t, [at(t, 'slowly')]))).toBe('She walked [slowly] to the door, and stopped.');
	});
	test('neighbouring sentences joined, separate ones with …', () => {
		const t = 'She opened the ledger. The ledger was old. Rain fell. Wind came. The ledger did not lie.';
		const q = quoteToString(quoteFor(t, [at(t, 'ledger'), at(t, 'ledger', 1), at(t, 'ledger', 2)]));
		expect(q).toBe('She opened the [ledger]. The [ledger] was old. … The [ledger] did not lie.');
	});
	test('two marks in one sentence', () => {
		const t = 'Her cold fingers turned a cold page.';
		expect(quoteToString(quoteFor(t, [at(t, 'cold'), at(t, 'cold', 1)]))).toBe('Her [cold] fingers turned a [cold] page.');
	});
	test('a very long sentence is trimmed around the mark', () => {
		const t = `${'word '.repeat(200)}slowly ${'word '.repeat(200)}end.`;
		const q = quoteToString(quoteFor(t, [at(t, 'slowly')], 120));
		expect(q.length).toBeLessThan(200);
		expect(q.startsWith('…')).toBe(true);
		expect(q.endsWith('…')).toBe(true);
		expect(q).toContain('[slowly]');
	});
	test('no ranges, no quote', () => {
		expect(quoteFor('Text.', [])).toEqual([]);
	});
});
