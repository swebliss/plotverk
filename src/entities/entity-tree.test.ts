import { buildEntityTree, descendantNames, parseParentRef } from './entity-tree';

const e = (name: string, parent: string | null = null) => ({ name, parent });

describe('parseParentRef', () => {
	it('accepts plain names', () => {
		expect(parseParentRef('Planet Rogu')).toBe('Planet Rogu');
	});
	it('unwraps wikilinks', () => {
		expect(parseParentRef('[[Planet Rogu]]')).toBe('Planet Rogu');
		expect(parseParentRef('[[Planet Rogu|Rogu]]')).toBe('Planet Rogu');
	});
	it('rejects non-strings and empties', () => {
		expect(parseParentRef(undefined)).toBeNull();
		expect(parseParentRef(42)).toBeNull();
		expect(parseParentRef('  ')).toBeNull();
	});
});

describe('buildEntityTree', () => {
	it('nests to arbitrary depth and sorts siblings', () => {
		const tree = buildEntityTree([
			e('Leppi City', 'Kambidi Country'),
			e('Grockura Dimension'),
			e('Planet Rogu', 'Grockura Dimension'),
			e('Planet Helios', 'Grockura Dimension'),
			e('Lokoko Continent', 'Planet Rogu'),
			e('Kambidi Country', 'Lokoko Continent'),
		]);
		expect(tree).toHaveLength(1);
		const dim = tree[0];
		expect(dim.entity.name).toBe('Grockura Dimension');
		expect(dim.children.map((c) => c.entity.name)).toEqual(['Planet Helios', 'Planet Rogu']);
		const city = dim.children[1].children[0].children[0].children[0];
		expect(city.entity.name).toBe('Leppi City');
		expect(city.depth).toBe(4);
	});

	it('matches parents case-insensitively', () => {
		const tree = buildEntityTree([e('planet rogu', 'GROCKURA'), e('Grockura')]);
		expect(tree[0].children[0].entity.name).toBe('planet rogu');
	});

	it('promotes orphans (missing parent) to top level', () => {
		const tree = buildEntityTree([e('Lost City', 'Atlantis')]);
		expect(tree).toHaveLength(1);
		expect(tree[0].depth).toBe(0);
	});

	it('survives parent cycles', () => {
		const tree = buildEntityTree([e('A', 'B'), e('B', 'A'), e('Root')]);
		const names = new Set<string>();
		const walk = (nodes: ReturnType<typeof buildEntityTree>) =>
			nodes.forEach((n) => {
				names.add(n.entity.name);
				walk(n.children);
			});
		walk(tree);
		expect(names).toEqual(new Set(['A', 'B', 'Root']));
	});
});

describe('descendantNames', () => {
	it('collects the whole subtree including the root', () => {
		const all = [
			e('Dimension'),
			e('Planet', 'Dimension'),
			e('City', 'Planet'),
			e('Other'),
		];
		expect(descendantNames(all, 'Dimension')).toEqual(new Set(['dimension', 'planet', 'city']));
	});
});
