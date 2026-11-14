import { buildRelationGraph, RelEntity } from './relations';
import { buildTreeData, layoutTreePositions, computeUnions, isDeceasedStatus, lifeFactsFromFields, wrapName, initialsOf, layoutTreeBlocks, restrictTreeData, coupleStatus, coupleStatusOf, hasFamilyTie, TreeNode } from './story-tree';

const entity = (name: string, sections: Record<string, string>, kind: RelEntity['kind'] = 'character'): RelEntity => ({
	path: `Book/Characters/${name}.md`,
	name,
	kind,
	sections,
});

const p = (name: string) => `Book/Characters/${name}.md`;

describe('buildTreeData — family mode', () => {
	const entities = [
		entity('Grandma', { Rel: 'Children: [[Mom]]' }),
		entity('Mom', { Rel: 'Mother: [[Grandma]]\nPartner: [[Dad]]\nChildren: [[Kid]]' }),
		entity('Dad', { Rel: 'Partner: [[Mom]]\nChildren: [[Kid]]' }),
		entity('Kid', { Rel: 'Mother: [[Mom]]\nFather: [[Dad]]' }),
	];
	const edges = buildRelationGraph(entities);

	test('whole-network mode (no focus) includes every family-connected entity', () => {
		const data = buildTreeData(entities, edges, 'family');
		expect(data.nodes.map((n) => n.path).sort()).toEqual([p('Dad'), p('Grandma'), p('Kid'), p('Mom')].sort());
	});

	test('generations are correctly layered: grandparent < parent < child', () => {
		const data = buildTreeData(entities, edges, 'family');
		const genOf = new Map(data.nodes.map((n) => [n.path, n.generation]));
		expect(genOf.get(p('Grandma'))).toBeLessThan(genOf.get(p('Mom')) as number);
		expect(genOf.get(p('Mom'))).toBeLessThan(genOf.get(p('Kid')) as number);
	});

	test('partners share the same generation', () => {
		const data = buildTreeData(entities, edges, 'family');
		const genOf = new Map(data.nodes.map((n) => [n.path, n.generation]));
		expect(genOf.get(p('Mom'))).toBe(genOf.get(p('Dad')));
	});

	test('focus + generationsDown=0 includes only the focus entity and its partner (same gen)', () => {
		const data = buildTreeData(entities, edges, 'family', { focusPath: p('Mom'), generationsUp: 0, generationsDown: 0 });
		expect(data.nodes.map((n) => n.path).sort()).toEqual([p('Dad'), p('Mom')].sort());
	});

	test('focus + generationsUp=1 pulls in the parent but not the grandparent', () => {
		const data = buildTreeData(entities, edges, 'family', { focusPath: p('Kid'), generationsUp: 1, generationsDown: 0 });
		const paths = data.nodes.map((n) => n.path);
		expect(paths).toContain(p('Kid'));
		expect(paths).toContain(p('Mom'));
		expect(paths).not.toContain(p('Grandma'));
	});

	test('focus + generationsUp=2 reaches the grandparent', () => {
		const data = buildTreeData(entities, edges, 'family', { focusPath: p('Kid'), generationsUp: 2, generationsDown: 0 });
		expect(data.nodes.map((n) => n.path)).toContain(p('Grandma'));
	});

	test('includePartners: false excludes partners even within depth', () => {
		const data = buildTreeData(entities, edges, 'family', { focusPath: p('Mom'), generationsUp: 0, generationsDown: 0, includePartners: false });
		expect(data.nodes.map((n) => n.path)).toEqual([p('Mom')]);
	});

	test('an isolated entity with no family edges is excluded entirely', () => {
		const withStranger = [...entities, entity('Stranger', {})];
		const strangerEdges = buildRelationGraph(withStranger);
		const data = buildTreeData(withStranger, strangerEdges, 'family');
		expect(data.nodes.map((n) => n.path)).not.toContain(p('Stranger'));
	});
});

describe('buildTreeData — siblings (family mode)', () => {
	test('a sibling-only pair (no shared recorded parent) lands at the same generation', () => {
		const entities = [
			entity('Grandma', { Rel: 'Children: [[Mom]]' }),
			entity('Mom', { Rel: 'Mother: [[Grandma]]\nSister: [[Aunt]]' }),
			entity('Aunt', { Rel: 'Sister: [[Mom]]' }),
		];
		const edges = buildRelationGraph(entities);
		const data = buildTreeData(entities, edges, 'family');

		const genOf = new Map(data.nodes.map((n) => [n.path, n.generation]));
		expect(genOf.get(p('Aunt'))).toBe(genOf.get(p('Mom')));
		expect(data.edges.some((e) => (e.fromPath === p('Mom') && e.toPath === p('Aunt')) || (e.fromPath === p('Aunt') && e.toPath === p('Mom')))).toBe(true);
	});

	test('sibling edges do not leak into faction mode', () => {
		const entities = [
			entity('General', { Rel: 'Member: [[Captain]]' }),
			entity('Captain', { Rel: 'Leader: [[General]]\nBrother: [[Major]]' }),
			entity('Major', { Rel: 'Brother: [[Captain]]' }),
		];
		const edges = buildRelationGraph(entities);
		const data = buildTreeData(entities, edges, 'faction');
		expect(data.nodes.map((n) => n.path)).not.toContain(p('Major'));
	});
});

describe('buildTreeData — faction mode', () => {
	const entities = [
		entity('General', { Rel: 'Member: [[Captain]]' }),
		entity('Captain', { Rel: 'Leader: [[General]]\nMember: [[Soldier]]' }),
		entity('Soldier', { Rel: 'Reports to: [[Captain]]' }),
	];
	const edges = buildRelationGraph(entities);

	test('rank chain layers General above Captain above Soldier', () => {
		const data = buildTreeData(entities, edges, 'faction');
		const genOf = new Map(data.nodes.map((n) => [n.path, n.generation]));
		expect(genOf.get(p('General'))).toBeLessThan(genOf.get(p('Captain')) as number);
		expect(genOf.get(p('Captain'))).toBeLessThan(genOf.get(p('Soldier')) as number);
	});

	test('focus on Captain with depth 1 each way includes General and Soldier but not beyond', () => {
		const data = buildTreeData(entities, edges, 'faction', { focusPath: p('Captain'), generationsUp: 1, generationsDown: 1 });
		expect(data.nodes.map((n) => n.path).sort()).toEqual([p('Captain'), p('General'), p('Soldier')].sort());
	});

	test('focus on Soldier with generationsUp=0 excludes the whole chain of command', () => {
		const data = buildTreeData(entities, edges, 'faction', { focusPath: p('Soldier'), generationsUp: 0, generationsDown: 0 });
		expect(data.nodes.map((n) => n.path)).toEqual([p('Soldier')]);
	});

	test('family edges do not leak into faction mode', () => {
		const mixed = [
			entity('Parent', { Rel: 'Children: [[Child]]' }),
			entity('Child', { Rel: 'Mother: [[Parent]]\nLeader: [[Boss]]' }),
			entity('Boss', { Rel: 'Member: [[Child]]' }),
		];
		const mixedEdges = buildRelationGraph(mixed);
		const data = buildTreeData(mixed, mixedEdges, 'faction');
		expect(data.nodes.map((n) => n.path)).not.toContain('Book/Characters/Parent.md');
	});
});

describe('layoutTreePositions', () => {
	test('every generation row is internally non-overlapping (x positions ≥ node width + gap apart)', () => {
		const entities = [
			entity('Mom', { Rel: 'Children: [[A]], [[B]], [[C]]' }),
			entity('A', { Rel: 'Mother: [[Mom]]' }),
			entity('B', { Rel: 'Mother: [[Mom]]' }),
			entity('C', { Rel: 'Mother: [[Mom]]' }),
		];
		const edges = buildRelationGraph(entities);
		const data = buildTreeData(entities, edges, 'family');
		const positions = layoutTreePositions(data, 'family');
		const childXs = positions.filter((pos) => pos.generation === 1).map((pos) => pos.x).sort((a, b) => a - b);
		for (let i = 1; i < childXs.length; i++) {
			expect(childXs[i] - childXs[i - 1]).toBeGreaterThanOrEqual(100);
		}
	});

	test('a parent with one child is centered above that child', () => {
		const entities = [entity('Mom', { Rel: 'Children: [[Kid]]' }), entity('Kid', { Rel: 'Mother: [[Mom]]' })];
		const edges = buildRelationGraph(entities);
		const data = buildTreeData(entities, edges, 'family');
		const positions = layoutTreePositions(data, 'family');
		const momX = positions.find((pos) => pos.path === p('Mom'))?.x;
		const kidX = positions.find((pos) => pos.path === p('Kid'))?.x;
		expect(momX).toBe(kidX);
	});

	test('faction mode positions the leader centered over its members', () => {
		const entities = [
			entity('Boss', { Rel: 'Member: [[A]], [[B]]' }),
			entity('A', { Rel: 'Leader: [[Boss]]' }),
			entity('B', { Rel: 'Leader: [[Boss]]' }),
		];
		const edges = buildRelationGraph(entities);
		const data = buildTreeData(entities, edges, 'faction');
		const positions = layoutTreePositions(data, 'faction');
		const bossX = positions.find((pos) => pos.path === p('Boss'))?.x as number;
		const memberXs = positions.filter((pos) => pos.path !== p('Boss')).map((pos) => pos.x);
		expect(bossX).toBe((Math.min(...memberXs) + Math.max(...memberXs)) / 2);
	});

	test('returns no positions for an empty tree', () => {
		expect(layoutTreePositions({ nodes: [], edges: [] }, 'family')).toEqual([]);
	});
});

describe('isDeceasedStatus', () => {
	test.each(['Deceased', 'dead', 'Died in the war', 'Passed away in 1990', 'DECEASED'])(
		'"%s" reads as deceased',
		(value) => expect(isDeceasedStatus(value)).toBe(true),
	);

	test.each(['Alive', 'Missing', 'Unknown', '', 'Living quietly in exile'])(
		'"%s" does not read as deceased',
		(value) => expect(isDeceasedStatus(value)).toBe(false),
	);
});

describe('computeUnions', () => {
	test('full siblings sharing both parents form one union', () => {
		const entities = [
			entity('Mom', { Rel: 'Partner: [[Dad]]\nChildren: [[Kid1]]\nChildren: [[Kid2]]' }),
			entity('Dad', { Rel: 'Partner: [[Mom]]\nChildren: [[Kid1]]\nChildren: [[Kid2]]' }),
			entity('Kid1', { Rel: 'Mother: [[Mom]]\nFather: [[Dad]]' }),
			entity('Kid2', { Rel: 'Mother: [[Mom]]\nFather: [[Dad]]' }),
		];
		const edges = buildRelationGraph(entities);
		const data = buildTreeData(entities, edges, 'family');

		const unions = computeUnions(data, 'family');
		expect(unions).toHaveLength(1);
		expect(unions[0].parentPaths.sort()).toEqual([p('Dad'), p('Mom')].sort());
		expect(unions[0].childPaths.sort()).toEqual([p('Kid1'), p('Kid2')].sort());
	});

	test('half-siblings from a remarriage form two separate unions, not one merged bar', () => {
		const entities = [
			entity('Dad', { Rel: 'Children: [[Kid1]]\nChildren: [[Kid2]]' }),
			entity('Mom', { Rel: 'Children: [[Kid1]]' }),
			entity('Stepmom', { Rel: 'Children: [[Kid2]]' }),
			entity('Kid1', { Rel: 'Mother: [[Mom]]\nFather: [[Dad]]' }),
			entity('Kid2', { Rel: 'Mother: [[Stepmom]]\nFather: [[Dad]]' }),
		];
		const edges = buildRelationGraph(entities);
		const data = buildTreeData(entities, edges, 'family');

		const unions = computeUnions(data, 'family');
		expect(unions).toHaveLength(2);
		const byChild = new Map(unions.map((u) => [u.childPaths[0], u]));
		expect(byChild.get(p('Kid1'))?.parentPaths.sort()).toEqual([p('Dad'), p('Mom')].sort());
		expect(byChild.get(p('Kid2'))?.parentPaths.sort()).toEqual([p('Dad'), p('Stepmom')].sort());
	});

	test('a child with only one recorded parent produces no union', () => {
		const entities = [
			entity('Mom', { Rel: 'Children: [[Kid]]' }),
			entity('Kid', { Rel: 'Mother: [[Mom]]' }),
		];
		const edges = buildRelationGraph(entities);
		const data = buildTreeData(entities, edges, 'family');

		expect(computeUnions(data, 'family')).toEqual([]);
	});

	describe('couple status (genogram lines)', () => {
		const unionOf = (momRel: string, dadRel: string) => {
			const entities = [
				entity('Mom', { Rel: momRel }),
				entity('Dad', { Rel: dadRel }),
				entity('Kid', { Rel: 'Mother: [[Mom]]\nFather: [[Dad]]' }),
			];
			const unions = computeUnions(buildTreeData(entities, buildRelationGraph(entities), 'family'), 'family');
			expect(unions).toHaveLength(1);
			return unions[0];
		};

		test('two named parents with nothing said about the pair still form a pair: "share a child"', () => {
			expect(unionOf('', '').status).toBe('child');
		});

		test('each word gives its own look', () => {
			expect(unionOf('Wife: [[Dad]]', '').status).toBe('married');
			expect(unionOf('Partner: [[Dad]]', '').status).toBe('married');
			expect(unionOf('Lover: [[Dad]]', '').status).toBe('together');
			expect(unionOf('Separated: [[Dad]]', '').status).toBe('separated');
			expect(unionOf('Ex-husband: [[Dad]]', '').status).toBe('divorced');
		});

		test('Spanish and French words count too', () => {
			expect(unionOf('Esposo: [[Dad]]', '').status).toBe('married');
			expect(unionOf('Novia: [[Dad]]', '').status).toBe('together');
			expect(unionOf('Séparée de: [[Dad]]', '').status).toBe('separated');
			expect(unionOf('Ex-mari: [[Dad]]', '').status).toBe('divorced');
		});

		test('where the two sheets disagree, the most specific word wins', () => {
			expect(unionOf('Wife: [[Dad]]', 'Ex-wife: [[Mom]]').status).toBe('divorced');
			expect(unionOf('Separated: [[Dad]]', 'Ex-wife: [[Mom]]').status).toBe('divorced');
			expect(unionOf('Husband: [[Dad]]', 'Separated from: [[Mom]]').status).toBe('separated');
			expect(unionOf('Lover: [[Dad]]', 'Wife: [[Mom]]').status).toBe('married');
		});

		test('an ex with no child together is still read as a couple line in the tree', () => {
			const entities = [entity('A', { Rel: 'Ex-wife: [[B]]\nChildren: [[K]]' }), entity('B', { Rel: '' }), entity('K', { Rel: 'Mother: [[A]]' })];
			const data = buildTreeData(entities, buildRelationGraph(entities), 'family');
			const partner = data.edges.filter((e) => e.kind === 'partner');
			expect(partner).toHaveLength(1);
			expect(coupleStatus(partner.map((e) => e.label))).toBe('divorced');
		});

		test('Saltmarch: "Ex-Partner" written only on Ilse pulls Halvard in on her row, in her family block', () => {
			// A one-sided line: Halvard's own sheet says nothing back, and they share no child.
			const entities = [
				entity('Ilse Ferrow', { Rel: 'Daughter: [[Mara Ferrow]]\nSon: [[Tobin Ferrow]]\nEnemy: [[Councillor Idris Vane]]\nEx-Partner: [[Halvard Crane]]' }),
				entity('Mara Ferrow', { Rel: 'Mother: [[Ilse Ferrow]]\nBrother: [[Tobin Ferrow]]\nRival: [[Halvard Crane]]\nCousin: [[Bex Ferrow-Tull]]' }),
				entity('Tobin Ferrow', { Rel: 'Mother: [[Ilse Ferrow]]' }),
				entity('Grandmother Tull', { Rel: 'Grandchild: [[Mara Ferrow]]\nGrandchild: [[Tobin Ferrow]]\nWard: [[Bex Ferrow-Tull]]' }),
				entity('Bex Ferrow-Tull', { Rel: 'Cousin: [[Mara Ferrow]]\nGuardian: [[Grandmother Tull]]' }),
				entity('Halvard Crane', { Rel: 'Rival: [[Mara Ferrow]]\nEmploys: [[Wrenna Sull]]' }),
				entity('Wrenna Sull', { Rel: '' }),
			];
			const graph = buildRelationGraph(entities);
			for (const focusPath of [undefined, p('Mara Ferrow'), p('Ilse Ferrow')]) {
				const data = buildTreeData(entities, graph, 'family', { focusPath, generationsUp: 1, generationsDown: 1 });
				const gen = new Map(data.nodes.map((n) => [n.path, n.generation]));
				expect(gen.get(p('Halvard Crane'))).toBe(gen.get(p('Ilse Ferrow')));
				const partner = data.edges.filter((e) => e.kind === 'partner');
				expect(coupleStatus(partner.map((e) => e.label))).toBe('divorced');
				// One block with Ilse, so "View family tree" (which keeps whole blocks) keeps him too.
				const blocks = layoutTreeBlocks(data, 'family', { nodeW: 184, gapX: 48 }).blocks;
				expect(blocks.find((b) => b.paths.includes(p('Ilse Ferrow')))?.paths).toContain(p('Halvard Crane'));
			}
		});

		test('word lookup', () => {
			expect(coupleStatusOf('  DIVORCED ')).toBe('divorced');
			expect(coupleStatusOf('Fiancée')).toBe('together');
			expect(coupleStatusOf('Mother')).toBeNull();
			expect(coupleStatusOf('Friend')).toBeNull();
			expect(coupleStatus([])).toBe('child');
		});
	});
});

describe('hasFamilyTie (Codex "View family tree" on a character)', () => {
	const entities = [
		entity('Ilse', { Rel: 'Daughter: [[Mara]]\nEnemy: [[Idris]]' }),
		entity('Mara', { Rel: 'Rival: [[Halvard]]' }),
		entity('Halvard', { Rel: 'Ex-wife: [[Wrenna]]\nEmploys: [[Pike]]' }),
		entity('Wrenna', { Rel: '' }),
		entity('Idris', { Rel: 'Enemy: [[Ilse]]\nLeader: [[Council]]' }),
		entity('Pike', { Rel: '' }),
		entity('Bex', { Rel: 'Guardian: [[Tull]]' }),
		entity('Tull', { Rel: '' }),
		entity('Nessa', { Rel: 'Cousin: [[Ilse]]' }),
		entity('Council', { Leader: 'Leader: [[Idris]]' }, 'faction'),
	];
	const edges = buildRelationGraph(entities);

	test('a family word on their own sheet or on the other one counts', () => {
		expect(hasFamilyTie(p('Ilse'), edges)).toBe(true); // wrote Daughter
		expect(hasFamilyTie(p('Mara'), edges)).toBe(true); // named on Ilse's sheet only
		expect(hasFamilyTie(p('Wrenna'), edges)).toBe(true); // an ex, written on Halvard's sheet
		expect(hasFamilyTie(p('Tull'), edges)).toBe(true); // guardian
		expect(hasFamilyTie(p('Nessa'), edges)).toBe(true); // cousin
	});

	test('enemies, rivals, employers and factions are not family', () => {
		expect(hasFamilyTie(p('Idris'), edges)).toBe(false);
		expect(hasFamilyTie(p('Pike'), edges)).toBe(false);
		expect(hasFamilyTie(p('Council'), edges)).toBe(false);
	});
});

describe('buildTreeData — parent cycles', () => {
	test('A↔B mutual parents terminates and reports the cycle (used to hang forever)', () => {
		const entities = [
			entity('A', { Rel: 'Mother: [[B]]' }),
			entity('B', { Rel: 'Mother: [[A]]' }),
		];
		const edges = buildRelationGraph(entities);
		const data = buildTreeData(entities, edges, 'family', { focusPath: p('A') });

		expect(data.nodes.length).toBe(2);
		expect(data.notes).toHaveLength(1);
		const note = data.notes?.[0];
		expect(note?.type).toBe('loop');
		if (note?.type === 'loop') expect([note.fromPath, note.toPath].sort()).toEqual([p('A'), p('B')]);
	});

	test('a legitimate DAG reports no cycle', () => {
		const entities = [
			entity('Grandma', { Rel: 'Children: [[Mom]]' }),
			entity('Mom', { Rel: 'Mother: [[Grandma]]\nChildren: [[Kid]]' }),
			entity('Kid', { Rel: 'Mother: [[Mom]]' }),
		];
		const edges = buildRelationGraph(entities);
		const data = buildTreeData(entities, edges, 'family', { focusPath: p('Mom') });
		expect(data.cycleNodes).toBeUndefined();
		expect(data.notes).toBeUndefined();
	});

	test('whole tree: a loop never pushes rows down — rows stay tight and the note names both entries', () => {
		const entities = [
			entity('A', { Rel: 'Commander: [[B]]' }),
			entity('B', { Rel: 'Commander: [[A]]' }),
			entity('C', { Rel: 'Commander: [[B]]' }),
			entity('D', { Rel: 'Commander: [[C]]' }),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'faction');
		const gens = data.nodes.map((n) => n.generation);
		expect(Math.max(...gens)).toBe(2); // B over A and C, C over D
		expect(new Set(gens).size).toBe(Math.max(...gens) + 1); // no empty row
		expect(data.notes?.filter((n) => n.type === 'loop')).toHaveLength(1);
	});
});

// ─── Saltmarch-shaped fixture (the demo project's real lines, trimmed) ─────────

describe('Saltmarch fixture', () => {
	const ch = (name: string, rel: string) => entity(name, { Relationships: rel });
	const fa = (name: string, leader: string) => entity(name, { Leader: `Leader: ${leader}` }, 'faction');
	const entities = [
		ch('Grandmother Tull', 'Grandmother: [[Mara Ferrow]]\nGrandmother: [[Tobin Ferrow]]\nGuardian: [[Bex Ferrow-Tull]]'),
		ch('Ilse Ferrow', 'Daughter: [[Mara Ferrow]]\nSon: [[Tobin Ferrow]]\nEnemy: [[Councillor Idris Vane]]'),
		ch('Mara Ferrow', 'Mother: [[Ilse Ferrow]]\nBrother: [[Tobin Ferrow]]\nCousin: [[Bex Ferrow-Tull]]\nMember: [[The Salvagers Guild]]'),
		ch('Tobin Ferrow', 'Sister: [[Mara Ferrow]]\nMother: [[Ilse Ferrow]]\nMember: [[The Tideward Council]]'),
		ch('Bex Ferrow-Tull', 'Cousin: [[Mara Ferrow]]\nCousin: [[Tobin Ferrow]]\nGuardian: [[Grandmother Tull]]\nMember: [[The Salvagers Guild]]'),
		ch('Councillor Idris Vane', 'Ally: [[Tobin Ferrow]]\nLeader: [[The Tideward Council]]'),
		ch('Nessa Quillon', 'Member: [[The Tideward Council]]'),
		ch('Old Sepp', 'Member: [[The Salvagers Guild]]'),
		ch('Halvard Crane', 'Employs: [[Wrenna Sull]]\nLeader: [[Crane Salvage & Freight]]'),
		ch('Wrenna Sull', 'Employer: [[Halvard Crane]]\nMember: [[Crane Salvage & Freight]]'),
		fa('The Tideward Council', '[[Councillor Idris Vane]]'),
		fa('The Salvagers Guild', '[[Old Sepp]] in name, [[Mara Ferrow]] in practice'),
		fa('Crane Salvage & Freight', '[[Halvard Crane]]'),
	];
	const lifeFacts = new Map([
		[p('Grandmother Tull'), { age: 81 }],
		[p('Mara Ferrow'), { age: 34 }],
		[p('Tobin Ferrow'), { age: 29 }],
		[p('Bex Ferrow-Tull'), { age: 22 }],
	]);
	const edges = buildRelationGraph(entities);
	const genOf = (data: ReturnType<typeof buildTreeData>) => new Map(data.nodes.map((n) => [n.path, n.generation]));

	describe('faction hierarchy', () => {
		const data = buildTreeData(entities, edges, 'faction');
		const g = genOf(data);

		test('no loop and no empty rows: three tight rows (faction, leaders, members)', () => {
			expect(data.notes).toBeUndefined();
			expect([...new Set(g.values())].sort()).toEqual([0, 1, 2]);
		});

		test('each faction sits above its leader, and its members sit under the leader', () => {
			expect(g.get(p('The Tideward Council'))).toBe(0);
			expect(g.get(p('Councillor Idris Vane'))).toBe(1);
			expect(g.get(p('Nessa Quillon'))).toBe(2);
			expect(g.get(p('Tobin Ferrow'))).toBe(2);
			expect(g.get(p('Crane Salvage & Freight'))).toBe(0);
			expect(g.get(p('Halvard Crane'))).toBe(1);
			expect(g.get(p('Wrenna Sull'))).toBe(2);
		});

		test("a person named leader on the faction's sheet stays a leader even if their own sheet says Member", () => {
			expect(g.get(p('Mara Ferrow'))).toBe(1);
			expect(g.get(p('Old Sepp'))).toBe(1);
			const bex = data.edges.find((e) => e.toPath === p('Bex Ferrow-Tull'));
			expect(bex?.fromPath).toBe(p('The Salvagers Guild'));
			expect([...(bex?.viaPaths ?? [])].sort()).toEqual([p('Mara Ferrow'), p('Old Sepp')]);
		});

		test('no couples in faction mode (Halvard and Wrenna are not married)', () => {
			expect(computeUnions(data, 'faction')).toEqual([]);
		});
	});

	describe('family tree', () => {
		const data = buildTreeData(entities, edges, 'family', { lifeFacts });
		const g = genOf(data);
		const placeholder = data.nodes.find((n) => n.placeholder);

		test('everyone in the family is drawn, cousins included', () => {
			for (const name of ['Grandmother Tull', 'Ilse Ferrow', 'Mara Ferrow', 'Tobin Ferrow', 'Bex Ferrow-Tull']) {
				expect(g.has(p(name))).toBe(true);
			}
		});

		test('the reversed grandmother line is flipped by age, with a note', () => {
			expect(g.get(p('Grandmother Tull'))).toBe(0);
			const flips = (data.notes ?? []).filter((n) => n.type === 'flipped');
			expect(flips.length).toBeGreaterThanOrEqual(1);
			expect(flips.every((n) => n.type === 'flipped' && n.sourcePath === p('Grandmother Tull'))).toBe(true);
		});

		test('a grandmother sits two rows up, with one "unknown parent" between', () => {
			expect(placeholder).toBeDefined();
			expect(data.nodes.filter((n) => n.placeholder)).toHaveLength(1);
			expect(placeholder?.generation).toBe(1);
			expect(g.get(p('Ilse Ferrow'))).toBe(1);
			expect(g.get(p('Mara Ferrow'))).toBe(2);
			expect(g.get(p('Tobin Ferrow'))).toBe(2);
		});

		test('cousins share their row; the guardian line is a dotted kin line from above', () => {
			expect(g.get(p('Bex Ferrow-Tull'))).toBe(2);
			const guardian = data.edges.filter((e) => e.kind === 'kin');
			expect(guardian).toHaveLength(1);
			expect(guardian[0].fromPath).toBe(p('Grandmother Tull'));
			expect(guardian[0].toPath).toBe(p('Bex Ferrow-Tull'));
			expect(data.edges.some((e) => e.kind === 'cousin')).toBe(true);
		});

		test('nobody is married to their brother, and the placeholder never forms a couple', () => {
			expect(computeUnions(data, 'family')).toEqual([]);
		});
	});
});

describe('family words', () => {
	test('a grandparent line is dropped when the parent in between is already named', () => {
		const entities = [
			entity('Gran', { Rel: 'Daughter: [[Mom]]\nGrandchild: [[Kid]]' }),
			entity('Mom', { Rel: 'Son: [[Kid]]' }),
			entity('Kid', {}),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'family');
		expect(data.nodes.some((n) => n.placeholder)).toBe(false);
		expect(new Map(data.nodes.map((n) => [n.path, n.generation])).get(p('Kid'))).toBe(2);
	});

	test('great-grandparent = three rows, two placeholders', () => {
		const entities = [entity('Old', { Rel: 'Great-grandson: [[Young]]' }), entity('Young', {})];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'family');
		expect(data.nodes.filter((n) => n.placeholder)).toHaveLength(2);
		expect(data.nodes.find((n) => n.path === p('Young'))?.generation).toBe(3);
	});

	test('aunt/uncle one row up and niece one row down as kin lines, not parents', () => {
		const entities = [
			entity('Kid', { Rel: 'Mother: [[Mom]]\nAunt: [[Tess]]' }),
			entity('Mom', {}),
			entity('Tess', { Rel: 'Niece: [[Kid]]' }),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'family');
		const g = new Map(data.nodes.map((n) => [n.path, n.generation]));
		expect(g.get(p('Tess'))).toBe(g.get(p('Mom')));
		expect(data.edges.filter((e) => e.kind === 'kin')).toHaveLength(1);
		expect(computeUnions(data, 'family')).toEqual([]);
	});

	test('the age check uses birth years when both sheets give one', () => {
		const entities = [entity('Elder', { Rel: 'Mother: [[Young]]' }), entity('Young', {})];
		const lifeFacts = new Map([[p('Elder'), { born: 1050 }], [p('Young'), { born: 1090 }]]);
		const data = buildTreeData(entities, buildRelationGraph(entities), 'family', { lifeFacts });
		const g = new Map(data.nodes.map((n) => [n.path, n.generation]));
		expect(g.get(p('Elder'))).toBe(0);
		expect(data.notes?.[0]).toEqual({ type: 'flipped', sourcePath: p('Elder'), targetPath: p('Young'), label: 'Mother' });
	});

	test('no flip when ages are unknown or agree', () => {
		const entities = [entity('Kid', { Rel: 'Mother: [[Mom]]' }), entity('Mom', {})];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'family', { lifeFacts: new Map([[p('Kid'), { age: 9 }]]) });
		expect(data.notes).toBeUndefined();
		expect(data.nodes.find((n) => n.path === p('Mom'))?.generation).toBe(0);
	});

	test('two named parents who are not related still form a couple', () => {
		const entities = [
			entity('Kid', { Rel: 'Mother: [[Mom]]\nFather: [[Dad]]' }),
			entity('Mom', {}),
			entity('Dad', {}),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'family');
		expect(computeUnions(data, 'family')).toHaveLength(1);
	});
});

describe('lifeFactsFromFields', () => {
	test('reads age and birth year as numbers only when written as numbers', () => {
		expect(lifeFactsFromFields([{ label: 'Age', value: '81' }, { label: 'Born', value: 'b. 1102 AE' }])).toEqual({ age: 81, born: 1102 });
		expect(lifeFactsFromFields([{ label: 'Age', value: '—' }, { label: 'Born', value: 'Spring of the Long Winter' }])).toEqual({});
	});

	test('a filled-in Died field means deceased; an empty one falls back to Life Status', () => {
		expect(lifeFactsFromFields([{ label: 'Died', value: '1129' }]).deceased).toBe(true);
		expect(lifeFactsFromFields([{ label: 'Died', value: '—' }, { label: 'Life Status', value: 'Deceased' }]).deceased).toBe(true);
		expect(lifeFactsFromFields([{ label: 'Died', value: '' }]).deceased).toBeUndefined();
		expect(lifeFactsFromFields([{ label: 'Life Status', value: 'Alive' }]).deceased).toBeUndefined();
	});
});

describe('wrapName', () => {
	test('wraps on words into at most two lines', () => {
		expect(wrapName('Councillor Idris Vane', 12, 2)).toEqual(['Councillor', 'Idris Vane']);
		expect(wrapName('Old Sepp', 12, 2)).toEqual(['Old Sepp']);
	});

	test('marks a cut with an ellipsis', () => {
		expect(wrapName('The Very Long Name Of Somebody', 8, 2)).toEqual(['The Very', 'Long…']);
		expect(wrapName('Supercalifragilistic', 8, 2)).toEqual(['Superca…']);
	});
});

describe('review fixes', () => {
	test('"Vassals" and "Reports to" between a person and a group keep pointing at the other one', () => {
		const entities = [
			entity('King', { Rel: 'Vassals: [[House Vale]]' }),
			entity('House Vale', { Rel: 'Reports to: [[King]]' }, 'faction'),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'faction');
		const g = new Map(data.nodes.map((n) => [n.path, n.generation]));
		expect(g.get(p('King'))).toBe(0);
		expect(g.get(p('House Vale'))).toBe(1);
	});

	test('a younger aunt is not flipped; only solid parent lines get the age check', () => {
		const entities = [entity('Niece', { Rel: 'Aunt: [[Young Aunt]]' }), entity('Young Aunt', {})];
		const lifeFacts = new Map([[p('Niece'), { age: 30 }], [p('Young Aunt'), { age: 25 }]]);
		const data = buildTreeData(entities, buildRelationGraph(entities), 'family', { lifeFacts });
		expect(data.notes).toBeUndefined();
		expect(data.nodes.find((n) => n.path === p('Young Aunt'))?.generation).toBe(0);
	});

	test('birth year is the last 3-5 digit number; "still alive" is not a death', () => {
		expect(lifeFactsFromFields([{ label: 'Born', value: '3rd of Frostmonth, 1130' }]).born).toBe(1130);
		expect(lifeFactsFromFields([{ label: 'Died', value: 'Still alive' }]).deceased).toBeUndefined();
		expect(lifeFactsFromFields([{ label: 'Died', value: 'Unknown' }, { label: 'Life Status', value: 'Dead' }]).deceased).toBe(true);
	});

	test('faction members are placed under the leader they hang from', () => {
		const entities = [
			entity('Council', { Rel: 'Leader: [[Idris]]' }, 'faction'),
			entity('Guild', { Rel: 'Leader: [[Sepp]]' }, 'faction'),
			entity('Idris', {}),
			entity('Sepp', {}),
			entity('Nessa', { Rel: 'Member: [[Council]]' }),
			entity('Bex', { Rel: 'Member: [[Guild]]' }),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'faction');
		const x = new Map(layoutTreePositions(data, 'faction', { nodeW: 100, gapX: 20 }).map((q) => [q.path, q.x]));
		expect(x.get(p('Nessa'))).toBe(x.get(p('Idris')));
		expect(x.get(p('Bex'))).toBe(x.get(p('Sepp')));
		expect(x.get(p('Council'))).toBe(x.get(p('Idris')));
	});
});

describe('initialsOf', () => {
	it('takes the first letter of the first two capitalised words', () => {
		expect(initialsOf('Idris Vane')).toBe('IV');
		expect(initialsOf('Ilse of Saltmarch')).toBe('IS');
		expect(initialsOf('Mara Ashe-Marsh the Younger')).toBe('MA');
	});

	it('gives one letter for a single name', () => {
		expect(initialsOf('Bex')).toBe('B');
	});

	it('falls back to the first two words when nothing is capitalised', () => {
		expect(initialsOf('old tull')).toBe('OT');
	});

	it('skips leading punctuation and handles non-Latin letters', () => {
		expect(initialsOf('"Red" Bryn')).toBe('B');
		expect(initialsOf('Élodie Çelik')).toBe('ÉÇ');
		expect(initialsOf('林 小明')).toBe('林小');
	});

	it('is empty when there is no letter', () => {
		expect(initialsOf('')).toBe('');
		expect(initialsOf('123 ???')).toBe('');
	});
});

describe('layoutTreeBlocks', () => {
	const W = 176, GAP = 56;
	const opts = { nodeW: W, gapX: GAP };
	const ch = (name: string, rel: string) => entity(name, { Relationships: rel });
	const fa = (name: string, leader: string) => entity(name, { Leader: `Leader: ${leader}` }, 'faction');

	describe('faction org chart (Saltmarch)', () => {
		const entities = [
			ch('Mara Ferrow', 'Member: [[The Salvagers Guild]]'),
			ch('Tobin Ferrow', 'Member: [[The Tideward Council]]'),
			ch('Bex Ferrow-Tull', 'Member: [[The Salvagers Guild]]'),
			ch('Councillor Idris Vane', 'Leader: [[The Tideward Council]]'),
			ch('Nessa Quillon', 'Member: [[The Tideward Council]]'),
			ch('Old Sepp', 'Member: [[The Salvagers Guild]]'),
			ch('Halvard Crane', 'Leader: [[Crane Salvage & Freight]]'),
			ch('Wrenna Sull', 'Member: [[Crane Salvage & Freight]]'),
			fa('The Tideward Council', '[[Councillor Idris Vane]]'),
			fa('The Salvagers Guild', '[[Old Sepp]] in name, [[Mara Ferrow]] in practice'),
			fa('Crane Salvage & Freight', '[[Halvard Crane]]'),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'faction');
		const layout = layoutTreeBlocks(data, 'faction', opts);
		const mid = (name: string) => (layout.positions.find((q) => q.path === p(name)) as { x: number }).x + W / 2;
		const blockOf = (name: string) => layout.blocks.find((b) => b.paths.includes(p(name)));

		test('one block per faction, headed by the faction', () => {
			expect(layout.blocks.map((b) => b.groupPath)).toEqual([p('Crane Salvage & Freight'), p('The Salvagers Guild'), p('The Tideward Council')]);
			expect(blockOf('Nessa Quillon')?.groupPath).toBe(p('The Tideward Council'));
			expect(blockOf('Bex Ferrow-Tull')?.groupPath).toBe(p('The Salvagers Guild'));
		});

		test('blocks never overlap sideways', () => {
			const ranges = layout.blocks.map((b) => {
				const xs = layout.positions.filter((q) => b.paths.includes(q.path)).map((q) => q.x);
				return [Math.min(...xs), Math.max(...xs) + W];
			}).sort((a, b) => a[0] - b[0]);
			for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBeGreaterThan(ranges[i - 1][1]);
		});

		test('the leader sits under the faction and the members sit under their own leader', () => {
			expect(mid('Councillor Idris Vane')).toBeCloseTo(mid('The Tideward Council'));
			expect((mid('Nessa Quillon') + mid('Tobin Ferrow')) / 2).toBeCloseTo(mid('Councillor Idris Vane'));
			expect(mid('Wrenna Sull')).toBeCloseTo(mid('Halvard Crane'));
			// Two leaders share one member: the member sits under the middle of the two.
			expect(mid('Bex Ferrow-Tull')).toBeCloseTo((mid('Mara Ferrow') + mid('Old Sepp')) / 2);
			expect(mid('The Salvagers Guild')).toBeCloseTo(mid('Bex Ferrow-Tull'));
		});
	});

	test('someone in two factions gets a card in each block; the one they lead keeps the entry', () => {
		const entities = [
			ch('Bryn', 'Leader: [[Ember Watch]]\nMember: [[Salt Council]]'),
			ch('Edda', 'Leader: [[Salt Council]]'),
			ch('Rook', 'Member: [[Ember Watch]]'),
			fa('Ember Watch', '[[Bryn]]'),
			fa('Salt Council', '[[Edda]]'),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'faction');
		const copy = data.nodes.find((n) => n.refPath === p('Bryn'));
		expect(copy?.path).toBe(`${p('Bryn')}#in:${p('Salt Council')}`);
		expect(data.nodes.filter((n) => n.path === p('Bryn'))).toHaveLength(1);
		const gen = new Map(data.nodes.map((n) => [n.path, n.generation]));
		expect(gen.get(p('Bryn'))).toBe(1); // leads the Watch: right under it
		expect(gen.get(copy?.path as string)).toBe(2); // a member of the Council: under Edda
		const layout = layoutTreeBlocks(data, 'faction', opts);
		expect(layout.blocks).toHaveLength(2);
		const council = layout.blocks.find((b) => b.groupPath === p('Salt Council'));
		expect(council?.paths).toContain(copy?.path);
		expect(council?.paths).not.toContain(p('Bryn'));
	});

	test('two unrelated families are two blocks, biggest first, side by side', () => {
		const entities = [
			ch('Ann', 'Son: [[Ben]]\nDaughter: [[Cat]]'),
			ch('Ben', ''),
			ch('Cat', ''),
			ch('Dov', 'Son: [[Eli]]'),
			ch('Eli', ''),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'family');
		const layout = layoutTreeBlocks(data, 'family', opts);
		expect(layout.blocks.map((b) => b.paths.length)).toEqual([3, 2]);
		const maxFirst = Math.max(...layout.positions.filter((q) => layout.blocks[0].paths.includes(q.path)).map((q) => q.x));
		const minSecond = Math.min(...layout.positions.filter((q) => layout.blocks[1].paths.includes(q.path)).map((q) => q.x));
		expect(minSecond).toBeGreaterThan(maxFirst + W);
	});

	test('the year of death is read from the Died field', () => {
		expect(lifeFactsFromFields([{ label: 'Born', value: '1061' }, { label: 'Died', value: 'Winter, 1129' }])).toEqual({ born: 1061, died: 1129, deceased: true });
		// A dash between date parts is not a minus sign.
		expect(lifeFactsFromFields([{ label: 'Born', value: '01-02-1061' }, { label: 'Died', value: '12-03-1129' }])).toEqual({ born: 1061, died: 1129, deceased: true });
		expect(lifeFactsFromFields([{ label: 'Born', value: '-250' }]).born).toBe(-250);
	});

	describe('a "Reports to" between two factions\' people', () => {
		const entities = [
			ch('A', 'Leader: [[G1]]'),
			ch('B', 'Leader: [[G2]]\nReports to: [[A]]'),
			ch('C', 'Member: [[G2]]'),
			fa('G1', '[[A]]'),
			fa('G2', '[[B]]'),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'faction');
		const gen = new Map(data.nodes.map((n) => [n.path, n.generation]));
		const layout = layoutTreeBlocks(data, 'faction', opts);
		const mid = (name: string) => (layout.positions.find((q) => q.path === p(name)) as { x: number }).x + W / 2;

		test('keeps each faction its own block', () => {
			expect(layout.blocks.map((b) => b.groupPath)).toEqual([p('G1'), p('G2')]);
		});

		test('a member still sits a row below a leader who was pushed down, and under them', () => {
			expect(gen.get(p('C'))).toBe((gen.get(p('B')) as number) + 1);
			expect(mid('C')).toBeCloseTo(mid('B'));
		});

		test('one faction on its own ("View faction tree") keeps only its block and the lines inside it', () => {
			const own = layout.blocks.find((b) => b.paths.includes(p('G2')))?.paths ?? [];
			const only = restrictTreeData(data, new Set(own));
			expect(only.nodes.map((n) => n.path).sort()).toEqual([p('B'), p('C'), p('G2')]);
			// The Reports-to line up to the other faction's leader goes; G2's own lines stay.
			expect(only.edges.some((e) => e.fromPath === p('A') || e.toPath === p('A'))).toBe(false);
			expect(only.edges.length).toBe(data.edges.filter((e) => own.includes(e.fromPath) && own.includes(e.toPath)).length);
			const again = layoutTreeBlocks(only, 'faction', opts);
			expect(again.blocks.map((b) => b.groupPath)).toEqual([p('G2')]);
			expect(Math.min(...again.positions.map((q) => q.x))).toBe(0);
		});
	});

	test('restrictTreeData keeps only the notes that name a kept card', () => {
		const data = {
			nodes: [{ path: 'a' }, { path: 'b' }, { path: 'c' }] as TreeNode[],
			edges: [],
			cycleNodes: ['a', 'c'],
			notes: [
				{ type: 'loop' as const, fromPath: 'a', toPath: 'z', label: 'x' },
				{ type: 'flipped' as const, sourcePath: 'y', targetPath: 'z', label: 'x' },
			],
		};
		const only = restrictTreeData(data, new Set(['a', 'b']));
		expect(only.nodes.map((n) => n.path)).toEqual(['a', 'b']);
		expect(only.cycleNodes).toEqual(['a']);
		expect(only.notes).toHaveLength(1);
		expect(restrictTreeData(data, new Set()).nodes).toEqual([]);
	});

	test('someone with no faction who reports to two factions\' leaders does not merge the factions', () => {
		const entities = [
			ch('A', 'Leader: [[G1]]'),
			ch('B', 'Leader: [[G2]]'),
			ch('Spy', 'Reports to: [[A]]\nReports to: [[B]]'),
			fa('G1', '[[A]]'),
			fa('G2', '[[B]]'),
		];
		const data = buildTreeData(entities, buildRelationGraph(entities), 'faction');
		const layout = layoutTreeBlocks(data, 'faction', opts);
		expect(layout.blocks.map((b) => b.groupPath)).toEqual([p('G1'), p('G2')]);
		expect(layout.blocks.filter((b) => b.paths.includes(p('Spy')))).toHaveLength(1);
	});
});

describe('couples stay together (the sample story’s Ferrow family)', () => {
	const entities = [
		entity('Grandmother Tull', { Relationships: 'Granddaughter: [[Mara Ferrow]]\nGrandson: [[Tobin Ferrow]]\nWard: [[Bex Ferrow-Tull]]\nSon: [[Corran Ferrow]]' }),
		entity('Corran Ferrow', { Relationships: 'Wife: [[Ilse Ferrow]]\nDaughter: [[Mara Ferrow]]\nSon: [[Tobin Ferrow]]\nMother: [[Grandmother Tull]]' }),
		entity('Ilse Ferrow', { Relationships: 'Daughter: [[Mara Ferrow]]\nSon: [[Tobin Ferrow]]\nEx-Partner: [[Halvard Crane]]\nHusband: [[Corran Ferrow]]' }),
		entity('Halvard Crane', { Relationships: 'Ex-Partner: [[Ilse Ferrow]]\nRival: [[Mara Ferrow]]' }),
		entity('Bex Ferrow-Tull', { Relationships: 'Cousin: [[Mara Ferrow]]\nCousin: [[Tobin Ferrow]]\nGuardian: [[Grandmother Tull]]' }),
		entity('Mara Ferrow', { Relationships: 'Father: [[Corran Ferrow]]\nMother: [[Ilse Ferrow]]\nBrother: [[Tobin Ferrow]]' }),
		entity('Tobin Ferrow', { Relationships: 'Father: [[Corran Ferrow]]\nMother: [[Ilse Ferrow]]\nSister: [[Mara Ferrow]]' }),
	];
	// Focused on Grandmother Tull: this is the view that put Bex between the
	// couple and hung Mara and Tobin under Bex (GitHub report, 2026-11-13).
	const data = buildTreeData(entities, buildRelationGraph(entities), 'family', { focusPath: p('Grandmother Tull'), includePartners: true });
	const positions = layoutTreePositions(data, 'family');
	const xOf = (name: string) => positions.find((pos) => pos.path === p(name))?.x as number;
	const rowOf = (name: string) => positions.find((pos) => pos.path === p(name))?.generation;
	const sameRowOrder = (name: string) => positions
		.filter((pos) => pos.generation === rowOf(name))
		.sort((a, b) => a.x - b.x)
		.map((pos) => pos.path);

	test('Ilse sits between her ex-partner and her husband, with no one in between', () => {
		const row = sameRowOrder('Ilse Ferrow');
		const i = row.indexOf(p('Ilse Ferrow'));
		expect([row[i - 1], row[i + 1]].sort()).toEqual([p('Corran Ferrow'), p('Halvard Crane')].sort());
	});

	test('the children hang under the married couple, not under Bex', () => {
		const coupleMid = (xOf('Ilse Ferrow') + xOf('Corran Ferrow')) / 2;
		const kidsMid = (xOf('Mara Ferrow') + xOf('Tobin Ferrow')) / 2;
		expect(Math.abs(coupleMid - kidsMid)).toBeLessThan(1);
		const row = sameRowOrder('Ilse Ferrow');
		const bex = row.indexOf(p('Bex Ferrow-Tull'));
		if (bex >= 0) {
			const between = (a: number, b: number) => (bex > Math.min(a, b) && bex < Math.max(a, b));
			expect(between(row.indexOf(p('Ilse Ferrow')), row.indexOf(p('Corran Ferrow')))).toBe(false);
		}
	});

	test('no two cards in a row overlap', () => {
		for (const g of new Set(positions.map((pos) => pos.generation))) {
			const xs = positions.filter((pos) => pos.generation === g).map((pos) => pos.x).sort((a, b) => a - b);
			for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(360);
		}
	});
});
