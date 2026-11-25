import { addAlias, aliasOwner, AliasOwner } from './alias-list';

const owners: AliasOwner[] = [
	{ path: 'Book/Codex/Characters/Mr Gibbins.md', name: 'Mr Gibbins', aliases: ['Dad', 'Andreas'] },
	{ path: 'Book/Codex/Characters/Bex Ferrow-Tull.md', name: 'Bex Ferrow-Tull', aliases: ['Bexxie'] },
	{ path: 'Book/Codex/Places/The Mill.md', name: 'The Mill', aliases: [] },
];

describe('aliasOwner — who already has this name', () => {
	test('another entry\'s alias, any case', () => {
		expect(aliasOwner('bexxie', 'Book/Codex/Characters/Mr Gibbins.md', owners)?.name).toBe('Bex Ferrow-Tull');
	});
	test('another entry\'s own name', () => {
		expect(aliasOwner('the mill', 'Book/Codex/Characters/Mr Gibbins.md', owners)?.name).toBe('The Mill');
	});
	test('the sheet itself never counts', () => {
		expect(aliasOwner('Dad', 'Book/Codex/Characters/Mr Gibbins.md', owners)).toBeNull();
	});
	test('a new sheet (no file yet) is checked against everyone', () => {
		expect(aliasOwner('Dad', null, owners)?.name).toBe('Mr Gibbins');
	});
	test('a free name, or blanks around it', () => {
		expect(aliasOwner('Papa', null, owners)).toBeNull();
		expect(aliasOwner('  ', null, owners)).toBeNull();
		expect(aliasOwner(' Bexxie ', null, owners)?.name).toBe('Bex Ferrow-Tull');
	});
});

describe('addAlias — adding to the sheet\'s list', () => {
	const self = 'Book/Codex/Characters/Mr Gibbins.md';
	test('a free name is added at the end, trimmed', () => {
		expect(addAlias(['Dad'], '  Papa ', self, owners)).toEqual({ list: ['Dad', 'Papa'], added: ['Papa'], problems: [] });
	});
	test('several at once, split on commas (pasting "Dad, Papa")', () => {
		expect(addAlias([], 'Papa, Pops,', self, owners).list).toEqual(['Papa', 'Pops']);
	});
	test('already on this sheet: not added twice', () => {
		const r = addAlias(['Dad'], 'dad', self, owners);
		expect(r.list).toEqual(['Dad']);
		expect(r.problems).toEqual([{ word: 'dad', reason: 'here' }]);
	});
	test('the sheet\'s own name: not added', () => {
		const r = addAlias([], 'mr gibbins', self, owners, 'Mr Gibbins');
		expect(r.list).toEqual([]);
		expect(r.problems).toEqual([{ word: 'mr gibbins', reason: 'own-name' }]);
	});
	test('another entry has it: not added, and says who', () => {
		const r = addAlias(['Dad'], 'Bexxie', self, owners);
		expect(r.list).toEqual(['Dad']);
		expect(r.problems).toEqual([{ word: 'Bexxie', reason: 'taken', owner: 'Bex Ferrow-Tull' }]);
	});
	test('a mix: the free ones go in, the others are reported', () => {
		const r = addAlias([], 'Papa, Bexxie, Pops', self, owners);
		expect(r.list).toEqual(['Papa', 'Pops']);
		expect(r.problems.map((p) => p.word)).toEqual(['Bexxie']);
	});
	test('the same new name twice in one go is added once', () => {
		expect(addAlias([], 'Papa, papa', self, owners).list).toEqual(['Papa']);
	});
});
