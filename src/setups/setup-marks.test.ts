import {
	decodeMark, encodeMark, readMarkLines, writeMarkLines, addMark, removeMark, marksOf,
	setupState, isOpenState, paysOffLater, isLetGo, readLinkedIds, orderMarks, cleanQuote,
	chaptersSinceLastMark, isPlanned, removePlanMarks, SetupMark,
} from './setup-marks';

const planted: SetupMark = { stage: 'planted', target: { kind: 'text', anchor: 'pv-abc123' }, quote: 'She hid the key.' };

describe('mark lines', () => {
	it('round-trip every target kind', () => {
		const marks: SetupMark[] = [
			planted,
			{ stage: 'reminded', target: { kind: 'card', gridId: 'g1', cardId: 'c/2' }, quote: 'The market' },
			{ stage: 'paid-off', target: { kind: 'entity', entityId: 'sg_k2' }, quote: '' },
		];
		for (const m of marks) expect(decodeMark(encodeMark(m))).toEqual(m);
		expect(encodeMark(planted)).toBe('planted · text:pv-abc123 · She hid the key.');
	});

	it('keeps a quote that itself contains the separator', () => {
		const m = { ...planted, quote: 'Rain · then sun' };
		expect(decodeMark(encodeMark(m))).toEqual(m);
	});

	it('keeps lines it cannot read, verbatim', () => {
		const stored = readMarkLines(['planted · text:pv-abc123 · x', 'hand-written note', 'sown · text:pv-a · y']);
		expect(stored.map((s) => !!s.mark)).toEqual([true, false, false]);
		expect(writeMarkLines(stored)).toEqual(['planted · text:pv-abc123 · x', 'hand-written note', 'sown · text:pv-a · y']);
	});

	it('reads a single string or nothing', () => {
		expect(readMarkLines('planted · text:pv-abc123')).toHaveLength(1);
		expect(readMarkLines(undefined)).toEqual([]);
		expect(readMarkLines('')).toEqual([]);
	});

	it('cleans quotes to one short line without tags', () => {
		expect(cleanQuote('She  hid\nthe key. ^pv-abc123')).toBe('She hid the key.');
		expect(cleanQuote('x'.repeat(400)).length).toBe(240);
	});
});

describe('addMark / removeMark', () => {
	it('adds, ignores the very same mark, keeps two marks in one paragraph', () => {
		let lines = addMark([], planted);
		lines = addMark(lines, planted);
		expect(lines).toHaveLength(1);
		// The payoff is a sentence later in the same paragraph: the plant stays.
		lines = addMark(lines, { ...planted, stage: 'paid-off', quote: 'She used the key.' });
		expect(marksOf(lines).map((m) => m.stage)).toEqual(['planted', 'paid-off']);
	});
	it('keeps unreadable lines when adding and removing', () => {
		let lines = readMarkLines(['odd line']);
		lines = addMark(lines, planted);
		expect(writeMarkLines(lines)).toEqual(['odd line', encodeMark(planted)]);
		lines = removeMark(lines, planted);
		expect(writeMarkLines(lines)).toEqual(['odd line']);
	});
});

describe('setupState', () => {
	const rem = { ...planted, stage: 'reminded' as const, target: { kind: 'text' as const, anchor: 'pv-bbbbbb' } };
	const pay = { ...planted, stage: 'paid-off' as const, target: { kind: 'text' as const, anchor: 'pv-cccccc' } };
	it('is the furthest stage marked; let go wins', () => {
		expect(setupState([], false)).toBe('planted');
		expect(setupState([planted, rem], false)).toBe('reminded');
		expect(setupState([pay, planted], false)).toBe('paid-off');
		expect(setupState([pay], true)).toBe('let-go');
		expect(isOpenState('reminded')).toBe(true);
		expect(isOpenState('let-go')).toBe(false);
	});
	it('follows the text: a payoff or reminder planned on a card or event does not move it', () => {
		const cardPay = { ...planted, stage: 'paid-off' as const, target: { kind: 'card' as const, gridId: 'g1', cardId: 'c1' } };
		const eventRem = { ...planted, stage: 'reminded' as const, target: { kind: 'entity' as const, entityId: 'sg_ev' } };
		expect(isPlanned(cardPay)).toBe(true);
		expect(isPlanned(eventRem)).toBe(true);
		expect(isPlanned(rem)).toBe(false);
		expect(setupState([planted, cardPay, eventRem], false)).toBe('planted');
		expect(setupState([planted, rem, cardPay], false)).toBe('reminded');
		expect(setupState([cardPay], false)).toBe('planted');
		expect(setupState([cardPay, pay], false)).toBe('paid-off');
	});
	it('reads the sheet switches', () => {
		expect(paysOffLater('later-book')).toBe(true);
		expect(paysOffLater(undefined)).toBe(false);
		expect(isLetGo(true)).toBe(true);
		expect(isLetGo('true')).toBe(true);
		expect(isLetGo(null)).toBe(false);
		expect(readLinkedIds(['a', ' a', '', 'b'])).toEqual(['a', 'b']);
		expect(readLinkedIds('x')).toEqual(['x']);
	});
});

describe('book order', () => {
	it('sorts placed marks by scene then line; unplaced last in marked order', () => {
		const items = [
			{ n: 1, place: null },
			{ n: 2, place: { sceneIndex: 3, line: 1 } },
			{ n: 3, place: { sceneIndex: 0, line: 9 } },
			{ n: 4, place: null },
			{ n: 5, place: { sceneIndex: 3, line: 0 } },
		];
		expect(orderMarks(items).map((i) => i.n)).toEqual([3, 5, 2, 1, 4]);
	});
	it('counts chapters waited', () => {
		expect(chaptersSinceLastMark(12, 21)).toBe(9);
		expect(chaptersSinceLastMark(null, 21)).toBeNull();
		expect(chaptersSinceLastMark(5, 3)).toBe(0);
	});
});

describe('removePlanMarks', () => {
	it('takes every copy of a plan off its card, whatever its words; never a text mark', () => {
		const target = { kind: 'card' as const, gridId: 'g1', cardId: 'c1' };
		const a: SetupMark = { stage: 'reminded', target, quote: 'Old title' };
		const b: SetupMark = { stage: 'reminded', target, quote: 'New title' };
		const pay: SetupMark = { stage: 'paid-off', target, quote: 'New title' };
		const lines = [{ mark: a }, { raw: 'odd line' }, { mark: b }, { mark: pay }, { mark: planted }];
		expect(writeMarkLines(removePlanMarks(lines, b))).toEqual(['odd line', encodeMark(pay), encodeMark(planted)]);
		expect(removePlanMarks(lines, planted)).toHaveLength(5);
	});
});
