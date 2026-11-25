import { pickRows, wikilinkTargets, nameFromSelection, DraftStore, relocate, PickableSetup } from './picker';

const s = (name: string, state: PickableSetup['state'], linkedIds: string[] = []): PickableSetup =>
	({ path: name + '.md', name, state, linkedIds, description: '', later: false });

describe('pickRows', () => {
	const all = [
		s('The locked door', 'planted'),
		s('Mara’s promise', 'reminded', ['kael']),
		s('The hidden sword', 'paid-off', ['kael']),
		s('The limp', 'let-go'),
		s('A silver coin', 'planted'),
	];
	it('lists only open setups, a linked one in this scene first', () => {
		const rows = pickRows(all, '', new Map([['kael', 'Kael']]));
		expect(rows.map((r) => r.setup.name)).toEqual(['Mara’s promise', 'A silver coin', 'The locked door']);
		expect(rows[0].inSceneName).toBe('Kael');
		expect(rows[1].inSceneName).toBeNull();
	});
	it('narrows by any part of the name, any case', () => {
		expect(pickRows(all, 'DOOR', new Map()).map((r) => r.setup.name)).toEqual(['The locked door']);
		expect(pickRows(all, 'zzz', new Map())).toEqual([]);
	});
});

describe('wikilinkTargets', () => {
	it('reads targets, without headings, aliases or doubles', () => {
		expect(wikilinkTargets('[[Kael]] met [[Mara Ferrow|Mara]] at [[The Tower#Gate]] and [[Kael]].'))
			.toEqual(['Kael', 'Mara Ferrow', 'The Tower']);
	});
});

describe('nameFromSelection', () => {
	it('is the sentence in plain words', () => {
		expect(nameFromSelection('Beneath the **loose** stone lay [[Kael|Kael’s]] sword. ^pv-abc123')).toBe('Beneath the loose stone lay Kael’s sword.');
		expect(nameFromSelection('> quoted\n> line')).toBe('quoted line');
		expect(nameFromSelection('[[Places/North Tower#Gate]]')).toBe('North Tower');
	});
	it('stays a sensible length', () => {
		expect(nameFromSelection('word '.repeat(100)).length).toBe(120);
	});
});

describe('DraftStore', () => {
	it('brings back a draft for the same words, forgets the oldest', () => {
		const d = new DraftStore<string>();
		const k = DraftStore.key('plant', 'a.md', 'She hid it.');
		d.set(k, 'The key');
		expect(d.get(k)).toBe('The key');
		expect(d.get(DraftStore.key('plant', 'a.md', 'Other'))).toBeUndefined();
		for (let i = 0; i < 40; i++) d.set(DraftStore.key('plant', 'a.md', String(i)), 'x');
		expect(d.get(k)).toBeUndefined();
	});
});

describe('relocate', () => {
	it('finds the words nearest their old place', () => {
		const doc = 'He ran. New line here. He ran.';
		expect(relocate(doc, 'He ran.', 20)).toBe(23);
		expect(relocate(doc, 'He ran.', 1)).toBe(0);
	});
	it('gives up when the marked words are gone, instead of marking whatever is there now', () => {
		const doc = 'He ran. New line here. He ran.';
		expect(relocate(doc, 'gone', 5)).toBeNull();
		expect(relocate(doc, 'gone', 999)).toBeNull();
	});
});
