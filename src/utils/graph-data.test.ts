import {
	buildGraphData,
	legendEntries,
	bareEdgeCount,
	isCollapsibleMutualPair,
	nodesWithinDegrees,
	membersOfGroups,
	GraphEntityInput,
	RELATIONSHIP_TYPE_OTHER,
} from './graph-data';
import { buildCustomRegistry } from './relations';

const ent = (
	name: string,
	sections: Record<string, string>,
	kind: GraphEntityInput['kind'] = 'character',
	imagePath: string | null = null,
): GraphEntityInput => ({
	path: `Book/Characters/${name}.md`,
	name,
	kind,
	sections,
	imagePath,
});

describe('buildGraphData', () => {
	test('returns empty graph when no entities have connections', () => {
		const data = buildGraphData([
			ent('Loner', {}),
			ent('Also Loner', {}),
		]);
		expect(data.nodes).toHaveLength(0);
		expect(data.edges).toHaveLength(0);
	});

	test('only connected entities become nodes — isolated ones are dropped', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Ally: [[Joss]]' }),
			ent('Joss', {}),
			ent('Nobody', {}),
		]);
		expect(data.nodes).toHaveLength(2);
		expect(data.nodes.map((n) => n.name).sort()).toEqual(['Joss', 'Mara']);
	});

	test('each edge carries the classified relType', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Mother: [[Vess]]\nRival: [[Joss]]' }),
			ent('Vess', {}),
			ent('Joss', {}),
		]);
		const motherEdge = data.edges.find((e) => e.label === 'Mother');
		const rivalEdge = data.edges.find((e) => e.label === 'Rival');
		expect(motherEdge?.relType.id).toBe('parent');
		expect(motherEdge?.relType.color).toBe('#757575');
		expect(motherEdge?.relType.weight).toBeGreaterThan(2);
		expect(rivalEdge?.relType.id).toBe('rival');
		expect(rivalEdge?.relType.color).toBe('#C62828');
	});

	test('ally and mentor edges get their specific types', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Mentor: [[Vess]]\nAlly: [[Joss]]' }),
			ent('Vess', {}),
			ent('Joss', {}),
		]);
		expect(data.edges.find((e) => e.label === 'Mentor')?.relType.id).toBe('mentor');
		expect(data.edges.find((e) => e.label === 'Ally')?.relType.id).toBe('ally');
	});

	test('bare wikilinks get RELATIONSHIP_TYPE_OTHER with empty label', () => {
		const data = buildGraphData([
			ent('Mara', { Notes: 'She once met [[Joss]] in passing.' }),
			ent('Joss', {}),
		]);
		expect(data.edges).toHaveLength(1);
		expect(data.edges[0].label).toBe('');
		expect(data.edges[0].relType).toBe(RELATIONSHIP_TYPE_OTHER);
	});

	test('node carries imagePath when provided', () => {
		const data = buildGraphData([
			{ ...ent('Mara', { Relationships: 'Ally: [[Joss]]' }), imagePath: 'Book/img/mara.png' },
			ent('Joss', {}),
		]);
		const mara = data.nodes.find((n) => n.name === 'Mara');
		const joss = data.nodes.find((n) => n.name === 'Joss');
		expect(mara?.imagePath).toBe('Book/img/mara.png');
		expect(joss?.imagePath).toBeNull();
	});

	test('node kind is preserved', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Lives in: [[Thornvale]]' }, 'character'),
			{ ...ent('Thornvale', {}, 'location'), path: 'Book/Locations/Thornvale.md' },
		]);
		expect(data.nodes.find((n) => n.name === 'Mara')?.kind).toBe('character');
		expect(data.nodes.find((n) => n.name === 'Thornvale')?.kind).toBe('location');
	});

	test('parent direction is normalized (child sheet → parent→child edge)', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Mother: [[Vess]]' }),
			ent('Vess', {}),
		]);
		expect(data.edges).toHaveLength(1);
		// After normalization fromPath = Vess (the parent), toPath = Mara (the child)
		expect(data.edges[0].fromPath).toContain('Vess');
		expect(data.edges[0].toPath).toContain('Mara');
		expect(data.edges[0].relType.id).toBe('parent');
		// toRelType is the child's perspective
		expect(data.edges[0].toRelType.id).toBe('child');
	});

	test('symmetric relations have matching relType and toRelType', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Ally: [[Joss]]' }),
			ent('Joss', {}),
		]);
		expect(data.edges).toHaveLength(1);
		expect(data.edges[0].relType.id).toBe('ally');
		expect(data.edges[0].toRelType.id).toBe('ally');
		expect(data.edges[0].toRelType).toBe(data.edges[0].relType);
	});

	test('bare wikilink edge has toRelType === RELATIONSHIP_TYPE_OTHER', () => {
		const data = buildGraphData([
			ent('Mara', { Notes: 'She once met [[Joss]] in passing.' }),
			ent('Joss', {}),
		]);
		expect(data.edges[0].toRelType).toBe(RELATIONSHIP_TYPE_OTHER);
	});
});

describe('legendEntries', () => {
	test('returns only types actually used, no duplicates', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Ally: [[Joss]]\nAlly: [[Vess]]' }),
			ent('Joss', {}),
			ent('Vess', {}),
		]);
		const entries = legendEntries(data);
		const ids = entries.map((e) => e.id);
		expect(ids).toContain('ally');
		expect(new Set(ids).size).toBe(ids.length); // no duplicates
	});

	test('excludes bare wikilink edges from legend', () => {
		const data = buildGraphData([
			ent('Mara', { Notes: 'She met [[Joss]].' }),
			ent('Joss', {}),
		]);
		expect(legendEntries(data)).toHaveLength(0);
	});
});

describe('bareEdgeCount', () => {
	test('counts only unlabeled edges', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Ally: [[Joss]]', Notes: 'Knows [[Vess]].' }),
			ent('Joss', {}),
			ent('Vess', {}),
		]);
		expect(bareEdgeCount(data)).toBe(1);
	});
});

describe('isCollapsibleMutualPair', () => {
	const edgesBetween = (aSection: string, bSection: string) => {
		const data = buildGraphData([
			ent('Aldric', { Rel: aSection }),
			ent('Beron', { Rel: bSection }),
		]);
		return {
			aToB: data.edges.find((e) => e.fromPath.endsWith('Aldric.md')),
			bToA: data.edges.find((e) => e.fromPath.endsWith('Beron.md')),
		};
	};

	test('both sheets saying "Spouse" collapse into one line', () => {
		const { aToB, bToA } = edgesBetween('Spouse: [[Beron]]', 'Spouse: [[Aldric]]');
		expect(isCollapsibleMutualPair(aToB, bToA)).toBe(true);
	});

	test('different words on each side stay as two lines', () => {
		const { aToB, bToA } = edgesBetween('Mentor: [[Beron]]', 'Friend: [[Aldric]]');
		expect(isCollapsibleMutualPair(aToB, bToA)).toBe(false);
	});

	test('a paired-opposites tie is never collapsed — it keeps its arrow', () => {
		const { aToB, bToA } = edgesBetween('Mentor: [[Beron]]', 'Apprentice: [[Aldric]]');
		expect(isCollapsibleMutualPair(aToB, bToA)).toBe(false);
	});

	test('a one-sided declaration has nothing to collapse with', () => {
		const { aToB, bToA } = edgesBetween('Spouse: [[Beron]]', '');
		expect(isCollapsibleMutualPair(aToB, bToA)).toBe(false);
	});
});

describe('intensity and epoch on edges', () => {
	test('annotated relations carry their intensity onto the graph edge', () => {
		const data = buildGraphData([
			ent('Aldric', { Rel: 'Enemy: [[Beron]] (intensity 9, epoch Act II)' }),
			ent('Beron', { Rel: 'Enemy: [[Aldric]] (intensity 2)' }),
		]);
		const aToB = data.edges.find((e) => e.fromPath.endsWith('Aldric.md'));
		const bToA = data.edges.find((e) => e.fromPath.endsWith('Beron.md'));
		expect(aToB?.intensity).toBe(9);
		expect(aToB?.epoch).toBe('Act II');
		expect(bToA?.intensity).toBe(2);
		expect(bToA?.epoch).toBeUndefined();
	});

	test('unannotated relations leave intensity undefined', () => {
		const data = buildGraphData([
			ent('Aldric', { Rel: 'Ally: [[Beron]]' }),
			ent('Beron', {}),
		]);
		expect(data.edges[0].intensity).toBeUndefined();
	});
});

describe('two-way (divergent) relationships', () => {
	test('each side keeps its own directed edge and color when the views differ', () => {
		// Liam sees Kim as a mentor; Kim sees Liam as a friend.
		const data = buildGraphData([
			ent('Liam', { Relationships: 'Mentor: [[Kim]]' }),
			ent('Kim', { Relationships: 'Friend: [[Liam]]' }),
		]);
		const liamToKim = data.edges.find((e) => e.fromPath.endsWith('Liam.md') && e.toPath.endsWith('Kim.md'));
		const kimToLiam = data.edges.find((e) => e.fromPath.endsWith('Kim.md') && e.toPath.endsWith('Liam.md'));
		expect(liamToKim?.relType.id).toBe('mentor');
		expect(kimToLiam?.relType.id).toBe('ally'); // 'friend' classifies as ally
		// The two directions carry different colors so the map can split the line.
		expect(liamToKim?.relType.color).not.toBe(kimToLiam?.relType.color);
	});

	test('custom types flow through buildGraphData via the extra registry', () => {
		const custom = buildCustomRegistry([
			{ id: 'prof', label: 'Professor', color: '#ff8800', reciprocal: 'pupil' },
			{ id: 'pupil', label: 'Pupil', color: '#0088ff', reciprocal: 'prof' },
		]);
		const data = buildGraphData([
			ent('Liam', { Relationships: 'Professor: [[Kim]]' }),
			ent('Kim', { Relationships: 'Pupil: [[Liam]]' }),
		], custom);
		const liamToKim = data.edges.find((e) => e.fromPath.endsWith('Liam.md'));
		const kimToLiam = data.edges.find((e) => e.fromPath.endsWith('Kim.md'));
		expect(liamToKim?.relType.id).toBe('custom:prof');
		expect(liamToKim?.relType.color).toBe('#ff8800');
		expect(kimToLiam?.relType.id).toBe('custom:pupil');
		expect(kimToLiam?.relType.color).toBe('#0088ff');
	});
});

describe('nodesWithinDegrees', () => {
	test('includes the start node and its direct connections at degree 1', () => {
		const data = buildGraphData([
			ent('A', { Relationships: 'Ally: [[B]]' }),
			ent('B', {}),
			ent('C', {}),
		]);
		const path = (name: string) => data.nodes.find((n) => n.name === name)!.path;
		expect([...nodesWithinDegrees(data, path('A'), 1)].sort()).toEqual([path('A'), path('B')].sort());
	});

	test('walks a chain out to the given degree and no further', () => {
		const data = buildGraphData([
			ent('A', { Relationships: 'Ally: [[B]]' }),
			ent('B', { Relationships: 'Ally: [[C]]' }),
			ent('C', { Relationships: 'Ally: [[D]]' }),
			ent('D', {}),
		]);
		const path = (name: string) => data.nodes.find((n) => n.name === name)!.path;
		expect([...nodesWithinDegrees(data, path('A'), 2)].sort()).toEqual([path('A'), path('B'), path('C')].sort());
	});

	test('a cycle does not cause infinite traversal', () => {
		const data = buildGraphData([
			ent('A', { Relationships: 'Ally: [[B]]' }),
			ent('B', { Relationships: 'Ally: [[C]]' }),
			ent('C', { Relationships: 'Ally: [[A]]' }),
		]);
		const path = (name: string) => data.nodes.find((n) => n.name === name)!.path;
		expect([...nodesWithinDegrees(data, path('A'), 4)].sort()).toEqual([path('A'), path('B'), path('C')].sort());
	});

	test('disconnected nodes never appear regardless of degree', () => {
		const data = buildGraphData([
			ent('A', { Relationships: 'Ally: [[B]]' }),
			ent('B', {}),
			ent('C', { Relationships: 'Ally: [[D]]' }),
			ent('D', {}),
		]);
		const path = (name: string) => data.nodes.find((n) => n.name === name)!.path;
		const within = nodesWithinDegrees(data, path('A'), 4);
		expect(within.has(path('C'))).toBe(false);
		expect(within.has(path('D'))).toBe(false);
	});

	test('a start path absent from the graph yields only itself', () => {
		const data = buildGraphData([
			ent('A', { Relationships: 'Ally: [[B]]' }),
			ent('B', {}),
		]);
		expect([...nodesWithinDegrees(data, 'Book/Characters/Ghost.md', 3)]).toEqual(['Book/Characters/Ghost.md']);
	});
});

describe('membersOfGroups', () => {
	test('collects entities with a Member Of edge into the given group', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Member Of: [[The Guild]]' }),
			ent('Joss', { Relationships: 'Member Of: [[The Guild]]' }),
			ent('Vess', {}),
			{ ...ent('The Guild', {}, 'faction'), path: 'Book/Factions/The Guild.md' },
		]);
		const path = (name: string) => data.nodes.find((n) => n.name === name)!.path;
		expect([...membersOfGroups(data, [path('The Guild')])].sort()).toEqual([path('Joss'), path('Mara')].sort());
	});

	test('an empty group list returns an empty set', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Member Of: [[The Guild]]' }),
			{ ...ent('The Guild', {}, 'faction'), path: 'Book/Factions/The Guild.md' },
		]);
		expect(membersOfGroups(data, []).size).toBe(0);
	});

	test('non-membership relation types are not counted', () => {
		const data = buildGraphData([
			ent('Mara', { Relationships: 'Ally: [[Joss]]' }),
			ent('Joss', {}),
		]);
		const joss = data.nodes.find((n) => n.name === 'Joss')!.path;
		expect(membersOfGroups(data, [joss]).size).toBe(0);
	});
});
