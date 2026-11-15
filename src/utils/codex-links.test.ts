import { addCodexLink, groupCodexLinks, isCodexLinked, removeCodexLink, toggleCodexLink } from './codex-links';
import { getCodexGroups, initKindRegistry, type EntityKindSpec } from '../entities/entity-kinds';

const label = (id: string): string => getCodexGroups().find((g) => g.id === id)?.label ?? `missing group ${id}`;

describe('groupCodexLinks()', () => {
	afterEach(() => initKindRegistry()); // back to built-ins only

	it('shows nothing for a card with no links', () => {
		expect(groupCodexLinks(undefined)).toEqual([]);
		expect(groupCodexLinks({})).toEqual([]);
		expect(groupCodexLinks({ monster: [], item: [] })).toEqual([]);
	});

	it('puts a new kind under its Codex group', () => {
		const out = groupCodexLinks({ monster: ['P/Codex/Monsters/Wyrm.md'], settlement: ['P/Codex/Settlements/Oslo.md'] });
		expect(out.map((g) => g.label)).toEqual([label('places'), label('creatures')]);
		expect(out[1].entries).toEqual([{ kind: 'monster', path: 'P/Codex/Monsters/Wyrm.md' }]);
	});

	it('keeps showing links saved by the old five-kind editor', () => {
		const out = groupCodexLinks({
			location: ['P/Places/Dock.md'],
			faction: ['P/Factions/Guild.md'],
			system: ['P/Systems/Magic.md'],
			item: ['P/Items/Key.md'],
			research: ['P/Research/Tides.md'],
		});
		const rows = Object.fromEntries(out.map((g) => [g.label, g.entries.map((e) => e.path)]));
		expect(rows).toEqual({
			[label('places')]: ['P/Places/Dock.md'],
			[label('groups')]: ['P/Factions/Guild.md'],
			[label('systems')]: ['P/Systems/Magic.md'],
			[label('items')]: ['P/Items/Key.md'],
			Research: ['P/Research/Tides.md'],
		});
		// Every stored link is still there, under its own kind.
		expect(out.flatMap((g) => g.entries).map((e) => e.kind).sort()).toEqual(['faction', 'item', 'location', 'research', 'system']);
	});

	it('orders a group by its kinds, with a retired kind after the current ones', () => {
		const out = groupCodexLinks({ location: ['P/Old.md'], landmark: ['P/Tower.md'], region: ['P/North.md'] });
		expect(out).toHaveLength(1);
		expect(out[0].entries.map((e) => e.kind)).toEqual(['region', 'landmark', 'location']);
	});

	it('follows Codex sidebar order across groups', () => {
		const out = groupCodexLinks({ prophecy: ['P/A.md'], item: ['P/B.md'], species: ['P/C.md'] });
		expect(out.map((g) => g.id)).toEqual(['creatures', 'items', 'history']);
	});

	it('shows custom kinds under "Your Own"', () => {
		const tongue: EntityKindSpec = {
			kind: 'tongue', singular: 'Tongue', plural: 'Tongues', icon: 'note-pencil', fallbackIcon: '🗣',
			folderName: 'Tongues', calloutType: 'note', calloutTitle: 'Tongue at a Glance', tagline: '',
			defaultName: 'Unnamed Tongue', defaultFields: [{ label: 'Name', type: 'text', prompt: 'Name?' }],
		};
		initKindRegistry([tongue]);
		const out = groupCodexLinks({ tongue: ['P/Tongues/Elvish.md'] });
		expect(out).toEqual([{ id: 'custom', label: 'Your Own', entries: [{ kind: 'tongue', path: 'P/Tongues/Elvish.md' }] }]);
	});

	it('still shows a kind nobody knows about (a custom kind deleted since, a hand-edited file)', () => {
		const out = groupCodexLinks({ 'sea-shanty': ['P/Song.md'] });
		expect(out).toHaveLength(1);
		expect(out[0].label).toBe('Sea Shanty');
		expect(out[0].entries).toEqual([{ kind: 'sea-shanty', path: 'P/Song.md' }]);
	});

	it('leaves out kinds shown elsewhere in the editor', () => {
		const out = groupCodexLinks({ event: ['P/Flood.md'], myth: ['P/Myth.md'] }, ['event']);
		expect(out.flatMap((g) => g.entries)).toEqual([{ kind: 'myth', path: 'P/Myth.md' }]);
	});

	it('copes with damaged data instead of throwing, and shows a doubled path once', () => {
		const odd = { item: 'P/A.md', monster: [5, 'P/B.md', 'P/B.md', ''], weather: { x: 1 } } as unknown as Record<string, string[]>;
		expect(groupCodexLinks(odd).flatMap((g) => g.entries)).toEqual([
			{ kind: 'monster', path: 'P/B.md' },
			{ kind: 'item', path: 'P/A.md' },
		]);
		expect(groupCodexLinks([] as unknown as Record<string, string[]>)).toEqual([]);
	});

	it('handles a lone string where a list belongs: linked, removable, and kept when adding', () => {
		const odd = { item: 'P/A.md' } as unknown as Record<string, string[]>;
		expect(isCodexLinked(odd, 'P/A.md')).toBe(true);
		expect(removeCodexLink(odd, 'P/A.md')).toEqual({ item: [] });
		expect(addCodexLink(odd, 'item', 'P/B.md')).toEqual({ item: ['P/A.md', 'P/B.md'] });
	});
});

describe('toggleCodexLink()', () => {
	it('links an entry under its own kind', () => {
		const r = toggleCodexLink({ location: ['P/Dock.md'] }, 'monster', 'P/Wyrm.md');
		expect(r.nowLinked).toBe(true);
		expect(r.linked).toEqual({ location: ['P/Dock.md'], monster: ['P/Wyrm.md'] });
	});

	it('links onto a card that has no links yet', () => {
		expect(toggleCodexLink(undefined, 'item', 'P/Key.md')).toEqual({ linked: { item: ['P/Key.md'] }, nowLinked: true });
	});

	it('unlinks an entry that is already linked, leaving the emptied kind as []', () => {
		const r = toggleCodexLink({ monster: ['P/Wyrm.md'], item: ['P/Key.md'] }, 'monster', 'P/Wyrm.md');
		expect(r.nowLinked).toBe(false);
		expect(r.linked).toEqual({ monster: [], item: ['P/Key.md'] });
	});

	it('toggling twice gets back to where it started', () => {
		const start = { item: ['P/Key.md'] };
		const once = toggleCodexLink(start, 'monster', 'P/Wyrm.md').linked;
		const twice = toggleCodexLink(once, 'monster', 'P/Wyrm.md').linked;
		expect(twice).toEqual({ item: ['P/Key.md'], monster: [] });
	});

	it('never links a sheet twice, even when it was stored under an older kind', () => {
		// A sheet linked as a 'location' before it became a 'settlement': picking it again unlinks it.
		const r = toggleCodexLink({ location: ['P/Oslo.md'] }, 'settlement', 'P/Oslo.md');
		expect(r.nowLinked).toBe(false);
		expect(r.linked).toEqual({ location: [] });
		expect(addCodexLink({ location: ['P/Oslo.md'] }, 'settlement', 'P/Oslo.md')).toEqual({ location: ['P/Oslo.md'] });
	});

	it('leaves the record it was given untouched', () => {
		const start = { item: ['P/Key.md'] };
		toggleCodexLink(start, 'item', 'P/Key.md');
		toggleCodexLink(start, 'monster', 'P/Wyrm.md');
		expect(start).toEqual({ item: ['P/Key.md'] });
	});
});

describe('isCodexLinked() / removeCodexLink()', () => {
	it('finds a path under any kind', () => {
		expect(isCodexLinked({ myth: ['P/A.md'] }, 'P/A.md')).toBe(true);
		expect(isCodexLinked({ myth: ['P/A.md'] }, 'P/B.md')).toBe(false);
		expect(isCodexLinked(undefined, 'P/A.md')).toBe(false);
	});

	it('removes a path from every kind it is stored under, doubles included', () => {
		expect(removeCodexLink({ location: ['P/A.md', 'P/B.md'], settlement: ['P/A.md', 'P/A.md'] }, 'P/A.md'))
			.toEqual({ location: ['P/B.md'], settlement: [] });
	});
});
