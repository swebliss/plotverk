import {
	parseRelationLines,
	nonRelationText,
	fieldsToRelationSections,
	buildRelationGraph,
	layoutGraph,
	buildCanvasJson,
	categorizeLabel,
	classifyRelation,
	getReciprocalType,
	customTypeToRegistry,
	buildCustomRegistry,
	buildCustomTypesFromWizard,
	findHierarchyLoops,
	serializeRelationLine,
	partitionRelationLines,
	removeRelationFromText,
	setRelationIntensity,
	shouldAutoWriteReciprocal,
	MAIN_RELATION_LABELS,
	relationChoices,
	COMMON_RELATION_CHOICES,
	RELATIONSHIP_TYPES,
	RELATIONSHIP_TYPE_OTHER,
	RelEntity,
	SG_KIND_CANVAS_COLORS,
	SG_EDGE_CATEGORY_COLORS,
} from './relations';

const entity = (name: string, sections: Record<string, string>, kind: RelEntity['kind'] = 'character'): RelEntity => ({
	path: `Book/Characters/${name}.md`,
	name,
	kind,
	sections,
});

describe('parseRelationLines', () => {
	test('labeled relations, list bullets, and display-text links', () => {
		const rels = parseRelationLines([
			'Mother: [[Queen Vess]]',
			'- Ally: [[Marn|the smuggler]]',
			'Some prose mentioning [[The Anchor]] in passing.',
		].join('\n'));
		expect(rels).toMatchObject([
			{ label: 'Mother', target: 'Queen Vess' },
			{ label: 'Ally', target: 'Marn' },
			{ label: '', target: 'The Anchor' },
		]);
	});

	test('multiple targets on one labeled line', () => {
		const rels = parseRelationLines('Children: [[Ana]], [[Bo]]');
		expect(rels).toMatchObject([
			{ label: 'Children', target: 'Ana' },
			{ label: 'Children', target: 'Bo' },
		]);
	});

	test('categorizeLabel buckets family labels', () => {
		expect(categorizeLabel('Mother')).toBe('parent');
		expect(categorizeLabel('son')).toBe('child');
		expect(categorizeLabel('Spouse')).toBe('partner');
		expect(categorizeLabel('Sworn enemy')).toBe('other');
	});
});

describe('buildRelationGraph', () => {
	test('normalizes parent direction and ignores unknown targets', () => {
		const edges = buildRelationGraph([
			entity('Mara', { Relationships: 'Mother: [[Vess]]\nAlly: [[Nobody Known]]' }),
			entity('Vess', {}),
		]);
		expect(edges).toEqual([
			{ fromPath: 'Book/Characters/Vess.md', toPath: 'Book/Characters/Mara.md', label: 'Mother', sourcePath: 'Book/Characters/Mara.md' },
		]);
	});

	test("a person's rank line to a faction names their role in it, from either sheet", () => {
		const idris = 'Book/Characters/Idris.md';
		const council = 'Book/Characters/Council.md';
		const bex = 'Book/Characters/Bex.md';
		const edges = buildRelationGraph([
			entity('Idris', { Rel: 'Leader: [[Council]]' }),
			entity('Council', { Rel: 'Leader: [[Idris]]' }, 'faction'),
			entity('Bex', { Rel: 'Member: [[Council]]\nLeader: [[Idris]]' }),
		]);
		// Both sheets agree: the Council sits above Idris — one edge, no two-way loop.
		expect(edges.filter((e) => e.fromPath === council && e.toPath === idris)).toHaveLength(1);
		expect(edges.some((e) => e.fromPath === idris && e.toPath === council)).toBe(false);
		// A member sits under the faction.
		expect(edges.some((e) => e.fromPath === council && e.toPath === bex && e.label === 'Member')).toBe(true);
		// Person-to-person rank lines keep the target-role rule.
		expect(edges.some((e) => e.fromPath === idris && e.toPath === bex && e.label === 'Leader')).toBe(true);
	});

	test('labeled edge wins over a bare mention of the same pair', () => {
		const edges = buildRelationGraph([
			entity('Mara', { Relationships: 'Rival: [[Joss]]', Backstory: 'She met [[Joss]] at sea.' }),
			entity('Joss', {}),
		]);
		expect(edges).toHaveLength(1);
		expect(edges[0].label).toBe('Rival');
	});
});

describe('layoutGraph + buildCanvasJson', () => {
	test('family generations layer parent above child; canvas serializes', () => {
		const ents = [
			entity('Vess', {}),
			entity('Mara', { Relationships: 'Mother: [[Vess]]' }),
			entity('Tam', { Relationships: 'Mother: [[Mara]]' }),
		];
		const edges = buildRelationGraph(ents);
		const positions = layoutGraph(ents, edges);
		const byPath = new Map(positions.map((p) => [p.path, p]));
		const yVess = byPath.get('Book/Characters/Vess.md')?.y ?? -1;
		const yMara = byPath.get('Book/Characters/Mara.md')?.y ?? -1;
		const yTam = byPath.get('Book/Characters/Tam.md')?.y ?? -1;
		expect(yVess).toBeLessThan(yMara);
		expect(yMara).toBeLessThan(yTam);

		const canvas = JSON.parse(buildCanvasJson(positions, edges));
		expect(canvas.nodes).toHaveLength(3);
		expect(canvas.edges).toHaveLength(2);
		expect(canvas.edges[0].label).toBe('Mother');
		expect(canvas.edges[0].fromSide).toBe('bottom');
	});

	test('only connected entities are placed', () => {
		const ents = [
			entity('Mara', { Relationships: 'Ally: [[Joss]]' }),
			entity('Joss', {}),
			entity('Loner', {}),
		];
		const edges = buildRelationGraph(ents);
		const positions = layoutGraph(ents, edges);
		expect(positions.map((p) => p.path)).not.toContain('Book/Characters/Loner.md');
		expect(positions).toHaveLength(2);
	});

	test('family edges get the red color, partner edges get violet', () => {
		const ents = [
			entity('Vess', {}),
			entity('Mara', { Relationships: 'Mother: [[Vess]]\nSpouse: [[Tam]]' }),
			entity('Tam', {}),
		];
		const edges = buildRelationGraph(ents);
		const positions = layoutGraph(ents, edges);
		const canvas = JSON.parse(buildCanvasJson(positions, edges));
		const familyEdge = canvas.edges.find((e: { label: string }) => e.label === 'Mother');
		const partnerEdge = canvas.edges.find((e: { label: string }) => e.label === 'Spouse');
		expect(familyEdge?.color).toBe(SG_EDGE_CATEGORY_COLORS.parent);
		expect(partnerEdge?.color).toBe(SG_EDGE_CATEGORY_COLORS.partner);
	});

	test('other labeled edges get the blue color; bare wikilinks get no color', () => {
		const ents = [
			entity('Mara', { Relationships: 'Rival: [[Joss]]\nShe also met [[Tam]] once.' }),
			entity('Joss', {}),
			entity('Tam', {}),
		];
		const edges = buildRelationGraph(ents);
		const positions = layoutGraph(ents, edges);
		const canvas = JSON.parse(buildCanvasJson(positions, edges));
		const rivalEdge = canvas.edges.find((e: { label: string }) => e.label === 'Rival');
		const bareEdge  = canvas.edges.find((e: { label: string }) => e.label === '');
		expect(rivalEdge?.color).toBe(SG_EDGE_CATEGORY_COLORS.other);
		expect(bareEdge?.color).toBeUndefined();
	});

	test('nodes carry kind-based canvas colors', () => {
		const ents = [
			entity('Mara', { Relationships: 'Lives in: [[Thornvale]]' }, 'character'),
			entity('Thornvale', {}, 'location'),
		];
		const edges = buildRelationGraph(ents);
		const positions = layoutGraph(ents, edges);
		const canvas = JSON.parse(buildCanvasJson(positions, edges));
		const charNode = canvas.nodes.find((n: { file: string }) => n.file.endsWith('Mara.md'));
		const locNode  = canvas.nodes.find((n: { file: string }) => n.file.endsWith('Thornvale.md'));
		expect(charNode?.color).toBe(SG_KIND_CANVAS_COLORS.character);
		expect(locNode?.color).toBe(SG_KIND_CANVAS_COLORS.location);
	});

	test('position preservation: saved x/y overrides auto-layout', () => {
		// The relmap.ts glue handles the merge, so test the merge logic in isolation
		const ents = [
			entity('Mara', { Relationships: 'Ally: [[Joss]]' }),
			entity('Joss', {}),
		];
		const edges = buildRelationGraph(ents);
		const autoPositions = layoutGraph(ents, edges);
		// Simulate what relmap.ts does: override with saved positions
		const savedPos = new Map([['Book/Characters/Mara.md', { x: 999, y: 888 }]]);
		const merged = autoPositions.map((p) => {
			const saved = savedPos.get(p.path);
			return saved ? { ...p, ...saved } : p;
		});
		const maraPos = merged.find((p) => p.path.endsWith('Mara.md'));
		const jossPos = merged.find((p) => p.path.endsWith('Joss.md'));
		expect(maraPos?.x).toBe(999);
		expect(maraPos?.y).toBe(888);
		// Joss was not in saved positions — keeps auto value
		expect(jossPos?.x).toBe(autoPositions.find((p) => p.path.endsWith('Joss.md'))?.x);
	});
});

describe('layoutGraph — barycenter + centering + partner adjacency', () => {
	test('parent is horizontally centered over two children', () => {
		// Vess is the parent of both Mara and Ana
		const ents = [
			entity('Vess', {}),
			entity('Mara', { Relationships: 'Mother: [[Vess]]' }),
			entity('Ana',  { Relationships: 'Mother: [[Vess]]' }),
		];
		const edges = buildRelationGraph(ents);
		const positions = layoutGraph(ents, edges);
		const byPath = new Map(positions.map((p) => [p.path, p]));
		const xVess = byPath.get('Book/Characters/Vess.md')?.x ?? NaN;
		const xMara = byPath.get('Book/Characters/Mara.md')?.x ?? NaN;
		const xAna  = byPath.get('Book/Characters/Ana.md')?.x ?? NaN;
		// Vess should be between Mara and Ana (centered over them)
		expect(xVess).toBeGreaterThanOrEqual(Math.min(xMara, xAna));
		expect(xVess).toBeLessThanOrEqual(Math.max(xMara, xAna));
	});

	test('partners are placed adjacent (|x_A - x_B| ≤ NODE_W + GAP_X)', () => {
		// Vess and Tam are partners; Mara is their child
		const ents = [
			entity('Vess', { Relationships: 'Spouse: [[Tam]]' }),
			entity('Tam',  {}),
			entity('Mara', { Relationships: 'Mother: [[Vess]]' }),
		];
		const edges = buildRelationGraph(ents);
		const positions = layoutGraph(ents, edges);
		const byPath = new Map(positions.map((p) => [p.path, p]));
		const xVess = byPath.get('Book/Characters/Vess.md')?.x ?? NaN;
		const xTam  = byPath.get('Book/Characters/Tam.md')?.x ?? NaN;
		const NODE_W = 260, GAP_X = 100;
		expect(Math.abs(xVess - xTam)).toBeLessThanOrEqual(NODE_W + GAP_X + 1);
	});

	test('siblings are not placed in a worse order than barycenter would suggest', () => {
		// Zara and Ana are both children of Vess.
		// Neither name-sort nor barycenter can distinguish them here, but both should
		// be placed next to each other (not scattered), and Vess should be between them.
		const ents = [
			entity('Vess', {}),
			entity('Zara', { Relationships: 'Mother: [[Vess]]' }),
			entity('Ana',  { Relationships: 'Mother: [[Vess]]' }),
		];
		const edges = buildRelationGraph(ents);
		const positions = layoutGraph(ents, edges);
		const byPath = new Map(positions.map((p) => [p.path, p]));
		const xVess = byPath.get('Book/Characters/Vess.md')?.x ?? NaN;
		const xZara = byPath.get('Book/Characters/Zara.md')?.x ?? NaN;
		const xAna  = byPath.get('Book/Characters/Ana.md')?.x ?? NaN;
		// Vess centered over children
		expect(xVess).toBeGreaterThanOrEqual(Math.min(xZara, xAna) - 1);
		expect(xVess).toBeLessThanOrEqual(Math.max(xZara, xAna) + 1);
	});

	test('three-generation chain: grandparent above parent above child', () => {
		const ents = [
			entity('Gran', {}),
			entity('Vess', { Relationships: 'Mother: [[Gran]]' }),
			entity('Mara', { Relationships: 'Mother: [[Vess]]' }),
		];
		const edges = buildRelationGraph(ents);
		const positions = layoutGraph(ents, edges);
		const byPath = new Map(positions.map((p) => [p.path, p]));
		// Y ordering preserved
		expect(byPath.get('Book/Characters/Gran.md')!.y).toBeLessThan(byPath.get('Book/Characters/Vess.md')!.y);
		expect(byPath.get('Book/Characters/Vess.md')!.y).toBeLessThan(byPath.get('Book/Characters/Mara.md')!.y);
		// Gran should be near Vess x (single-child chain → directly above)
		const xGran = byPath.get('Book/Characters/Gran.md')!.x;
		const xVess = byPath.get('Book/Characters/Vess.md')!.x;
		expect(Math.abs(xGran - xVess)).toBeLessThanOrEqual(260 + 100 + 1);
	});

	test('no two nodes in the same generation overlap (x positions differ by ≥ gap)', () => {
		const ents = [
			entity('Root', {}),
			entity('A', { Relationships: 'Mother: [[Root]]' }),
			entity('B', { Relationships: 'Mother: [[Root]]' }),
			entity('C', { Relationships: 'Mother: [[Root]]' }),
		];
		const edges = buildRelationGraph(ents);
		const positions = layoutGraph(ents, edges);
		const gen1 = positions.filter((p) => p.path !== 'Book/Characters/Root.md');
		const xs = gen1.map((p) => p.x).sort((a, b) => a - b);
		for (let i = 1; i < xs.length; i++) {
			expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(100); // at least GAP_X apart
		}
	});
});

describe('classifyRelation', () => {
	test('family labels map to the correct type ids', () => {
		expect(classifyRelation('Mother').id).toBe('parent');
		expect(classifyRelation('Father').id).toBe('parent');
		expect(classifyRelation('Grandmother').id).toBe('parent');
		expect(classifyRelation('son').id).toBe('child');
		expect(classifyRelation('Daughter').id).toBe('child');
		expect(classifyRelation('sibling').id).toBe('sibling');
		expect(classifyRelation('Brother').id).toBe('sibling');
	});

	test('partner labels map to the partner type', () => {
		expect(classifyRelation('Spouse').id).toBe('partner');
		expect(classifyRelation('married to').id).toBe('partner');
		expect(classifyRelation('wife').id).toBe('partner');
	});

	test('social labels map to specific typed entries', () => {
		expect(classifyRelation('rival').id).toBe('rival');
		expect(classifyRelation('Sworn enemy').id).toBe('enemy');
		expect(classifyRelation('Ally').id).toBe('ally');
		expect(classifyRelation('friend').id).toBe('ally');
		expect(classifyRelation('Mentor').id).toBe('mentor');
		expect(classifyRelation('trained by').id).toBe('mentor');
	});

	test('categorizeLabel still returns the correct RelationCategory', () => {
		expect(categorizeLabel('Mother')).toBe('parent');
		expect(categorizeLabel('son')).toBe('child');
		expect(categorizeLabel('Spouse')).toBe('partner');
		expect(categorizeLabel('Sworn enemy')).toBe('other');
		expect(categorizeLabel('ally')).toBe('other');
	});

	test('hierarchy labels map to the correct type ids', () => {
		expect(classifyRelation('Leader').id).toBe('ruler');
		expect(classifyRelation('chief').id).toBe('ruler');
		expect(classifyRelation('King').id).toBe('ruler');
		expect(classifyRelation('member').id).toBe('subordinate');
		expect(classifyRelation('reports to').id).toBe('commander');
		expect(classifyRelation('Second-in-command').id).toBe('subordinate');
		expect(classifyRelation('deputy').id).toBe('subordinate');
	});

	test('hierarchy labels map to superior/subordinate categories', () => {
		expect(categorizeLabel('Leader')).toBe('superior');
		expect(categorizeLabel('member')).toBe('subordinate');
		expect(categorizeLabel('deputy')).toBe('subordinate');
	});

	test('unrecognized labels fall back to RELATIONSHIP_TYPE_OTHER', () => {
		expect(classifyRelation('Sworn advisor').id).toBe('other');
		expect(classifyRelation('knows of')).toBe(RELATIONSHIP_TYPE_OTHER);
	});

	test('empty label (bare wikilink) falls back to RELATIONSHIP_TYPE_OTHER', () => {
		expect(classifyRelation('')).toBe(RELATIONSHIP_TYPE_OTHER);
	});

	test('every registry entry has a valid hex color and positive weight', () => {
		const hexColor = /^#[0-9a-f]{6}$/i;
		for (const rt of RELATIONSHIP_TYPES) {
			expect(rt.color).toMatch(hexColor);
			expect(rt.weight).toBeGreaterThan(0);
			expect(rt.displayLabel.length).toBeGreaterThan(0);
		}
		expect(RELATIONSHIP_TYPE_OTHER.color).toMatch(hexColor);
	});

	test('every registry entry has a unique id', () => {
		const ids = RELATIONSHIP_TYPES.map((rt) => rt.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('classifyRelation returns the same color the registry declares', () => {
		const allyType = classifyRelation('ally');
		expect(allyType.color).toBe('#2E7D32');
		expect(allyType.weight).toBe(1.5);

		const rivalType = classifyRelation('rival');
		expect(rivalType.color).toBe('#C62828');
		expect(rivalType.weight).toBe(2);
	});
});

describe('getReciprocalType', () => {
	test('parent reciprocal is child', () => {
		const parent = classifyRelation('Mother');
		const reciprocal = getReciprocalType(parent);
		expect(reciprocal.id).toBe('child');
	});

	test('child reciprocal is parent', () => {
		const child = classifyRelation('Son');
		const reciprocal = getReciprocalType(child);
		expect(reciprocal.id).toBe('parent');
	});

	test('parent↔child reciprocal is symmetric (two hops return to original)', () => {
		const parent = classifyRelation('Father');
		expect(getReciprocalType(getReciprocalType(parent)).id).toBe(parent.id);
	});

	test('symmetric types return themselves', () => {
		for (const label of ['ally', 'rival', 'sibling', 'partner', 'mentor']) {
			const rt = classifyRelation(label);
			if (!rt.reciprocalId) {
				expect(getReciprocalType(rt)).toBe(rt);
			}
		}
	});

	test('RELATIONSHIP_TYPE_OTHER returns itself (no reciprocal)', () => {
		expect(getReciprocalType(RELATIONSHIP_TYPE_OTHER)).toBe(RELATIONSHIP_TYPE_OTHER);
	});

	test('ruler reciprocal is vassal', () => {
		const ruler = classifyRelation('Leader');
		expect(getReciprocalType(ruler).id).toBe('vassal');
	});

	test('subordinate reciprocal is commander', () => {
		const member = classifyRelation('member');
		expect(getReciprocalType(member).id).toBe('commander');
	});

	test('deputy (subordinate) reciprocal is commander', () => {
		const second = classifyRelation('deputy');
		expect(getReciprocalType(second).id).toBe('commander');
	});

	test('mentor reciprocal is apprentice and back again', () => {
		const mentor = classifyRelation('Mentor');
		expect(getReciprocalType(mentor).id).toBe('apprentice');
		expect(getReciprocalType(getReciprocalType(mentor)).id).toBe('mentor');
	});

	test('all reciprocalIds in the registry point to a real entry', () => {
		const ids = new Set(RELATIONSHIP_TYPES.map((rt) => rt.id));
		for (const rt of RELATIONSHIP_TYPES) {
			if (rt.reciprocalId) {
				expect(ids.has(rt.reciprocalId)).toBe(true);
			}
		}
	});
});

describe('custom relationship types', () => {
	const professor = customTypeToRegistry({
		id: 'prof', label: 'Professor', color: '#ff8800', reciprocal: 'student',
	});
	const student = customTypeToRegistry({
		id: 'student', label: 'Student', color: '#0088ff', reciprocal: 'prof',
	});
	const bestie = customTypeToRegistry({
		id: 'bestie', label: 'Best Friend', color: '#22cc88', reciprocal: 'self',
	});
	const admirer = customTypeToRegistry({
		id: 'admirer', label: 'Admires', color: '#cc22aa', reciprocal: 'none',
	});
	const custom = [professor, student, bestie, admirer];

	test('unrecognized labels get a gray "other" distinct from mentor blue', () => {
		expect(RELATIONSHIP_TYPE_OTHER.color).not.toBe(classifyRelation('mentor').color);
		expect(classifyRelation('made up word').color).toBe(RELATIONSHIP_TYPE_OTHER.color);
	});

	test('customTypeToRegistry maps label, color, and namespaced id', () => {
		expect(professor.id).toBe('custom:prof');
		expect(professor.color).toBe('#ff8800');
		expect(professor.displayLabel).toBe('Professor');
		expect(professor.labels).toEqual(['professor']);
	});

	test('a custom type is matched (case-insensitively) before falling back to other', () => {
		expect(classifyRelation('Professor', custom).id).toBe('custom:prof');
		expect(classifyRelation('professor', custom).color).toBe('#ff8800');
		// Without the custom list, the same word is unclassified
		expect(classifyRelation('Professor').id).toBe('other');
	});

	test('a custom type overrides a built-in word of the same label', () => {
		const override = customTypeToRegistry({ id: 'x', label: 'friend', color: '#000000', reciprocal: 'self' });
		expect(classifyRelation('friend', [override]).id).toBe('custom:x');
		// built-in still wins when no custom override present
		expect(classifyRelation('friend').id).toBe('ally');
	});

	test('asymmetric custom pair resolves each other as reciprocal', () => {
		expect(getReciprocalType(professor, custom).id).toBe('custom:student');
		expect(getReciprocalType(student, custom).id).toBe('custom:prof');
	});

	test('symmetric custom type (reciprocal "self") returns itself', () => {
		expect(bestie.reciprocalId).toBeUndefined();
		expect(getReciprocalType(bestie, custom)).toBe(bestie);
	});

	test('one-way custom type (reciprocal "none") is flagged oneWay with no reverse', () => {
		expect(admirer.oneWay).toBe(true);
		expect(admirer.reciprocalId).toBeUndefined();
		expect(getReciprocalType(admirer, custom)).toBe(admirer);
	});

	test('buildCustomRegistry converts a whole list preserving order', () => {
		const reg = buildCustomRegistry([
			{ id: 'a', label: 'A', color: '#111111', reciprocal: 'self' },
			{ id: 'b', label: 'B', color: '#222222', reciprocal: 'none' },
		]);
		expect(reg.map((r) => r.id)).toEqual(['custom:a', 'custom:b']);
		expect(reg[1].oneWay).toBe(true);
	});

	test('classifyRelation without extras is unchanged (back-compat)', () => {
		expect(classifyRelation('Mother').id).toBe('parent');
		expect(getReciprocalType(classifyRelation('Mother')).id).toBe('child');
	});
});

describe('relationChoices (editor dropdown)', () => {
	test('with no custom types, returns the common choices as-is', () => {
		expect(relationChoices()).toEqual([...COMMON_RELATION_CHOICES]);
	});

	test('common choices pair mentor↔apprentice and keep symmetric ones self-paired', () => {
		const mentor = COMMON_RELATION_CHOICES.find((c) => c.label === 'Mentor');
		const friend = COMMON_RELATION_CHOICES.find((c) => c.label === 'Friend');
		expect(mentor?.reciprocal).toBe('Apprentice');
		expect(friend?.reciprocal).toBe('Friend');
	});

	test('character→world choices write nothing back to the world sheet', () => {
		for (const label of ['Resident of', 'Member of', 'Owner of', 'Practitioner of']) {
			expect(COMMON_RELATION_CHOICES.find((c) => c.label === label)?.reciprocal).toBeNull();
		}
	});

	test('custom types are listed first and resolve their reciprocal word', () => {
		const choices = relationChoices([
			{ id: 'prof', label: 'Professor', color: '#f80', reciprocal: 'pupil' },
			{ id: 'pupil', label: 'Pupil', color: '#08f', reciprocal: 'prof' },
			{ id: 'bff', label: 'Best Friend', color: '#0f8', reciprocal: 'self' },
			{ id: 'fan', label: 'Admires', color: '#f0f', reciprocal: 'none' },
		]);
		// Custom first
		expect(choices.slice(0, 4).map((c) => c.label)).toEqual(['Professor', 'Pupil', 'Best Friend', 'Admires']);
		expect(choices.find((c) => c.label === 'Professor')?.reciprocal).toBe('Pupil');
		expect(choices.find((c) => c.label === 'Best Friend')?.reciprocal).toBe('Best Friend');
		// One-way writes nothing back
		expect(choices.find((c) => c.label === 'Admires')?.reciprocal).toBeNull();
	});

	test('blank-labelled custom types are skipped', () => {
		const choices = relationChoices([{ id: 'x', label: '   ', color: '#000', reciprocal: 'self' }]);
		expect(choices).toEqual([...COMMON_RELATION_CHOICES]);
	});
});

describe('registry v2 — the five relationship categories', () => {
	const byId = (id: string) => RELATIONSHIP_TYPES.find((rt) => rt.id === id);

	test('every category-1 mutual type is drawn as one labelled line with no arrows', () => {
		for (const id of ['partner', 'sibling', 'ally', 'ex-partner']) {
			const rt = byId(id);
			expect(rt?.behavior).toBe('mutual');
			expect(rt?.edgeLabel).toBeTruthy();
			expect(rt?.reciprocalId).toBeUndefined();
		}
	});

	test('the exact colours and line styles of each type', () => {
		const expected: Record<string, [string, string]> = {
			'partner':         ['#E91E63', 'solid'],
			'sibling':         ['#757575', 'solid'],
			'ally':            ['#2E7D32', 'dotted'],
			'ex-partner':      ['#FF9800', 'solid'],
			'parent':          ['#757575', 'solid'],
			'mentor':          ['#008080', 'solid'],
			'ruler':           ['#FFD700', 'solid'],
			'benefactor':      ['#3F51B5', 'solid'],
			'rival':           ['#C62828', 'solid'],
			'enemy':           ['#8B0000', 'jagged'],
			'unrequited-love': ['#F06292', 'dashed'],
			'ancestor-of':     ['#37474F', 'solid'],
			'commander':       ['#1A237E', 'solid'],
			'resident-of':     ['#4A90E2', 'solid'],
			'member-of':       ['#4CAF50', 'solid'],
			'owner-of':        ['#9C27B0', 'solid'],
			'practitioner-of': ['#673AB7', 'solid'],
		};
		for (const [id, [color, lineStyle]] of Object.entries(expected)) {
			expect(byId(id)?.color).toBe(color);
			expect(byId(id)?.lineStyle).toBe(lineStyle);
		}
	});

	test('paired opposites point at each other in both directions', () => {
		const pairs: [string, string][] = [
			['parent', 'child'],
			['mentor', 'apprentice'],
			['ruler', 'vassal'],
			['benefactor', 'beneficiary'],
			['ancestor-of', 'descendant-of'],
			['commander', 'subordinate'],
		];
		for (const [a, b] of pairs) {
			expect(byId(a)?.reciprocalId).toBe(b);
			expect(byId(b)?.reciprocalId).toBe(a);
		}
	});

	test('category-5 world ties are one-sided character → world element', () => {
		for (const id of ['resident-of', 'member-of', 'owner-of', 'practitioner-of']) {
			const rt = byId(id);
			expect(rt?.behavior).toBe('world');
			expect(rt?.reciprocalId).toBeUndefined();
			// category 'other' keeps buildRelationGraph from flipping the arrow,
			// so the edge always runs character → world element.
			expect(rt?.category).toBe('other');
		}
	});

	test('no label word is claimed by two different types', () => {
		const seen = new Map<string, string>();
		for (const rt of RELATIONSHIP_TYPES) {
			for (const label of rt.labels) {
				expect(label).toBe(label.toLowerCase());
				if (seen.has(label)) {
					throw new Error(`Label "${label}" is claimed by both ${seen.get(label)} and ${rt.id}`);
				}
				seen.set(label, rt.id);
			}
		}
	});

	test('every entry declares a line style and a behavior', () => {
		for (const rt of RELATIONSHIP_TYPES) {
			expect(rt.lineStyle).toBeTruthy();
			expect(rt.behavior).toBeTruthy();
		}
	});

	test('MAIN_RELATION_LABELS holds the eight prominent sheet fields', () => {
		expect([...MAIN_RELATION_LABELS]).toEqual(
			['father', 'mother', 'sibling', 'partner', 'best friend', 'mentor', 'familiar', 'pet']
		);
	});
});

describe('migration — words writers already typed keep working', () => {
	// Every label from the pre-v2 registry. If one of these ever stops
	// classifying, existing sheets silently lose their coloured lines.
	const LEGACY_LABELS: [string, string][] = [
		['mother', 'parent'], ['father', 'parent'], ['parent', 'parent'], ['parents', 'parent'],
		['mor', 'parent'], ['far', 'parent'], ['grandmother', 'parent'], ['grandfather', 'parent'],
		['grandparent', 'parent'],
		['child', 'child'], ['children', 'child'], ['son', 'child'], ['daughter', 'child'],
		['barn', 'child'], ['grandchild', 'child'], ['grandson', 'child'], ['granddaughter', 'child'],
		['sibling', 'sibling'], ['siblings', 'sibling'], ['brother', 'sibling'], ['sister', 'sibling'],
		['twin', 'sibling'], ['half-sibling', 'sibling'], ['half-brother', 'sibling'], ['half-sister', 'sibling'],
		['partner', 'partner'], ['spouse', 'partner'], ['husband', 'partner'], ['wife', 'partner'],
		['lover', 'partner'], ['married to', 'partner'], ['partner of', 'partner'], ['betrothed', 'partner'],
		['fiancé', 'partner'], ['fiancée', 'partner'],
		['ally', 'ally'], ['allies', 'ally'], ['friend', 'ally'], ['friends', 'ally'],
		['confidant', 'ally'], ['comrade', 'ally'], ['companion', 'ally'], ['trusted', 'ally'], ['ally of', 'ally'],
		['enemy', 'enemy'], ['enemies', 'enemy'], ['foe', 'enemy'], ['foes', 'enemy'],
		['nemesis', 'enemy'], ['sworn enemy', 'enemy'], ['antagonist', 'enemy'], ['adversary', 'enemy'],
		['rival', 'rival'], ['rivals', 'rival'],
		['mentor', 'mentor'], ['teacher', 'mentor'], ['trained by', 'mentor'], ['student of', 'mentor'],
		['apprentice of', 'mentor'], ['master', 'mentor'], ['guide', 'mentor'], ['coach', 'mentor'],
		['trains', 'apprentice'],
		['leader', 'ruler'], ['chief', 'ruler'], ['head', 'ruler'], ['ruler', 'ruler'],
		['boss', 'ruler'], ['king', 'ruler'], ['queen', 'ruler'], ['president', 'ruler'], ['sworn to', 'ruler'], ['superior of', 'vassal'],
		['commander', 'commander'], ['reports to', 'commander'],
		['member', 'subordinate'], ['subordinate', 'subordinate'], ['follower', 'subordinate'],
		['soldier', 'subordinate'], ['second-in-command', 'subordinate'], ['second in command', 'subordinate'],
		['deputy', 'subordinate'], ['lieutenant', 'subordinate'], ['right hand', 'subordinate'],
		['vice-leader', 'subordinate'],
		['employee of', 'member-of'], ['serves', 'member-of'],
	];

	test.each(LEGACY_LABELS)('"%s" still classifies as %s', (label, expectedId) => {
		expect(classifyRelation(label).id).toBe(expectedId);
		expect(classifyRelation(label)).not.toBe(RELATIONSHIP_TYPE_OTHER);
	});

	test('legacy family and rank labels keep the layout category the trees rely on', () => {
		expect(categorizeLabel('Mother')).toBe('parent');
		expect(categorizeLabel('Son')).toBe('child');
		expect(categorizeLabel('Spouse')).toBe('partner');
		expect(categorizeLabel('Leader')).toBe('superior');
		expect(categorizeLabel('Reports to')).toBe('superior');
		expect(categorizeLabel('Member')).toBe('subordinate');
		expect(categorizeLabel('Deputy')).toBe('subordinate');
	});
});

describe('relation line annotations (intensity / epoch)', () => {
	test('a plain line parses exactly as before', () => {
		expect(parseRelationLines('Mother: [[Vess]]')).toMatchObject([
			{ label: 'Mother', target: 'Vess' },
		]);
		expect(parseRelationLines('Mother: [[Vess]]')[0].intensity).toBeUndefined();
	});

	test('reads intensity', () => {
		const [rel] = parseRelationLines('Rival: [[Beron]] (intensity 8)');
		expect(rel).toMatchObject({ label: 'Rival', target: 'Beron', intensity: 8 });
	});

	test('reads intensity and epoch together', () => {
		const [rel] = parseRelationLines('Mentor: [[Aldric]] (intensity 3, epoch The Long Winter)');
		expect(rel.intensity).toBe(3);
		expect(rel.epoch).toBe('The Long Winter');
	});

	test('intensity is clamped to 1–10', () => {
		expect(parseRelationLines('Rival: [[B]] (intensity 99)')[0].intensity).toBe(10);
		expect(parseRelationLines('Rival: [[B]] (intensity 0)')[0].intensity).toBe(1);
	});

	test('unknown annotation keys are kept, not dropped', () => {
		const [rel] = parseRelationLines('Ally: [[Marn]] (intensity 4, mood wary)');
		expect(rel.intensity).toBe(4);
		expect(rel.extra).toEqual(['mood wary']);
		expect(serializeRelationLine(rel)).toBe('Ally: [[Marn]] (intensity 4, mood wary)');
	});

	test('parentheses that are part of the prose are left alone', () => {
		const [rel] = parseRelationLines('Ally: [[Marn]] (the smuggler)');
		expect(rel.target).toBe('Marn');
		expect(rel.extra).toEqual(['the smuggler']);
	});

	test('a wikilink inside parentheses is not mistaken for an annotation', () => {
		const rels = parseRelationLines('Crew ([[Marn]])');
		expect(rels).toMatchObject([{ label: '', target: 'Marn' }]);
		expect(rels[0].extra).toBeUndefined();
	});

	test('annotations survive a parse → serialize round trip', () => {
		for (const line of [
			'Mother: [[Queen Vess]]',
			'Rival: [[Beron]] (intensity 8)',
			'Enemy: [[Aldric]] (intensity 10, epoch Act II)',
			'[[The Anchor]]',
		]) {
			expect(serializeRelationLine(parseRelationLines(line)[0])).toBe(line);
		}
	});

	test('annotated relations reach the graph with their intensity intact', () => {
		const edges = buildRelationGraph([
			entity('Aldric', { Relationships: 'Enemy: [[Beron]] (intensity 9)' }),
			entity('Beron', { Relationships: 'Enemy: [[Aldric]] (intensity 2)' }),
		]);
		expect(edges.find((e) => e.fromPath.endsWith('Aldric.md'))?.intensity).toBe(9);
		expect(edges.find((e) => e.fromPath.endsWith('Beron.md'))?.intensity).toBe(2);
	});
});

describe('findHierarchyLoops', () => {
	test('a clean genealogy has no loops', () => {
		const edges = buildRelationGraph([
			entity('Gran', {}),
			entity('Vess', { Rel: 'Mother: [[Gran]]' }),
			entity('Mara', { Rel: 'Mother: [[Vess]]' }),
		]);
		expect(findHierarchyLoops(edges)).toEqual([]);
	});

	test('a two-character loop is detected', () => {
		// Each claims to be the other's ancestor — impossible.
		const edges = buildRelationGraph([
			entity('Aldric', { Rel: 'Ancestor of: [[Beron]]' }),
			entity('Beron', { Rel: 'Ancestor of: [[Aldric]]' }),
		]);
		const loops = findHierarchyLoops(edges);
		expect(loops).toHaveLength(1);
		expect(loops[0][0]).toBe(loops[0][loops[0].length - 1]);
		expect(new Set(loops[0]).size).toBe(2);
	});

	test('a three-character chain-of-command loop is detected once', () => {
		const edges = buildRelationGraph([
			entity('A', { Rel: 'Commander: [[C]]' }),
			entity('B', { Rel: 'Commander: [[A]]' }),
			entity('C', { Rel: 'Commander: [[B]]' }),
		]);
		const loops = findHierarchyLoops(edges);
		expect(loops).toHaveLength(1);
		expect(new Set(loops[0]).size).toBe(3);
	});

	test('a grandchild claiming to be their own ancestor is caught', () => {
		const edges = buildRelationGraph([
			entity('Arthur', { Rel: 'Mother: [[Kid]]' }),
			entity('Kid', { Rel: 'Mother: [[Arthur]]' }),
		]);
		expect(findHierarchyLoops(edges).length).toBeGreaterThan(0);
	});

	test('mutual and reciprocal ties are never contradictions', () => {
		const edges = buildRelationGraph([
			entity('Aldric', { Rel: 'Spouse: [[Beron]]\nEnemy: [[Cass]]' }),
			entity('Beron', { Rel: 'Spouse: [[Aldric]]' }),
			entity('Cass', { Rel: 'Enemy: [[Aldric]]' }),
		]);
		expect(findHierarchyLoops(edges)).toEqual([]);
	});
});

describe('buildCustomTypesFromWizard', () => {
	const base = { color: '#E91E63', lineStyle: 'dashed' as const };

	test('mutual creates one self-paired type', () => {
		const out = buildCustomTypesFromWizard(
			{ ...base, label: 'Sworn Kin', behavior: 'mutual' },
			{ primary: 'k1' },
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ id: 'k1', label: 'Sworn Kin', reciprocal: 'self', behavior: 'mutual', lineStyle: 'dashed' });
		expect(customTypeToRegistry(out[0]).edgeLabel).toBe('Sworn Kin');
	});

	test('one-way creates a type that writes nothing back', () => {
		const out = buildCustomTypesFromWizard(
			{ ...base, label: 'Crush on', behavior: 'oneWay' },
			{ primary: 'c1' },
		);
		expect(out[0].reciprocal).toBe('none');
		expect(customTypeToRegistry(out[0]).oneWay).toBe(true);
	});

	test('opposites creates two types pointing at each other', () => {
		const out = buildCustomTypesFromWizard(
			{ ...base, label: 'Professor', behavior: 'opposites', oppositeLabel: 'Pupil' },
			{ primary: 'p1', opposite: 'p2' },
		);
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({ id: 'p1', label: 'Professor', reciprocal: 'p2' });
		expect(out[1]).toMatchObject({ id: 'p2', label: 'Pupil', reciprocal: 'p1' });
		const registry = buildCustomRegistry(out);
		expect(getReciprocalType(registry[0], registry).displayLabel).toBe('Pupil');
		expect(getReciprocalType(registry[1], registry).displayLabel).toBe('Professor');
	});

	test('opposites with no opposite title falls back to a single mutual type', () => {
		const out = buildCustomTypesFromWizard(
			{ ...base, label: 'Half-thought', behavior: 'opposites' },
			{ primary: 'h1' },
		);
		expect(out).toHaveLength(1);
		expect(out[0].reciprocal).toBe('self');
	});

	test('optional details are carried through only when given', () => {
		const withExtras = buildCustomTypesFromWizard(
			{ ...base, label: 'Bond', behavior: 'mutual', defaultIntensity: 7, epoch: 'Act II' },
			{ primary: 'b1' },
		);
		expect(withExtras[0]).toMatchObject({ defaultIntensity: 7, epoch: 'Act II' });
		const without = buildCustomTypesFromWizard({ ...base, label: 'Bond', behavior: 'mutual' }, { primary: 'b2' });
		expect(without[0].defaultIntensity).toBeUndefined();
		expect(without[0].epoch).toBeUndefined();
	});
});

describe('custom types saved before the wizard existed', () => {
	test('behavior and line style are derived, not required', () => {
		const legacy = customTypeToRegistry({ id: 'x', label: 'Professor', color: '#f80', reciprocal: 'y' });
		expect(legacy.lineStyle).toBe('solid');
		expect(legacy.behavior).toBe('opposites');

		const symmetric = customTypeToRegistry({ id: 'y', label: 'Bestie', color: '#0f8', reciprocal: 'self' });
		expect(symmetric.behavior).toBe('mutual');

		const oneWay = customTypeToRegistry({ id: 'z', label: 'Admires', color: '#f0f', reciprocal: 'none' });
		expect(oneWay.behavior).toBe('oneWay');
	});
});

describe('fieldsToRelationSections', () => {
	it('renders a typed entity-link field as a labelled relation line', () => {
		const sections = fieldsToRelationSections([
			{ label: 'Father', value: 'Queen Vess', type: 'tags', config: { entityLink: true } },
		]);
		expect(parseRelationLines(sections['Father'])).toMatchObject([
			{ label: 'Father', target: 'Queen Vess' },
		]);
	});

	it('splits a multi-target link field into one relation per target', () => {
		const sections = fieldsToRelationSections([
			{ label: 'Allies', value: 'Marn, Ilse', type: 'tags', config: { entityLink: true } },
		]);
		expect(parseRelationLines(sections['Allies'])).toMatchObject([
			{ label: 'Allies', target: 'Marn' },
			{ label: 'Allies', target: 'Ilse' },
		]);
	});

	it('leaves free-text tags out — they are keywords, not links', () => {
		const sections = fieldsToRelationSections([
			{ label: 'Traits', value: 'brave, stubborn', type: 'tags' },
		]);
		expect(sections['Traits']).toBeUndefined();
	});

	it('passes prose sections through untouched', () => {
		const sections = fieldsToRelationSections([
			{ label: 'Relationships', value: 'Mother: [[Vess]]', type: 'textarea' },
		]);
		expect(sections['Relationships']).toBe('Mother: [[Vess]]');
	});

	it('reaches the graph the same way whether typed or written by hand', () => {
		const typed = fieldsToRelationSections([
			{ label: 'Mother', value: 'Vess', type: 'tags', config: { entityLink: true } },
		]);
		const written = fieldsToRelationSections([
			{ label: 'Relationships', value: 'Mother: [[Vess]]', type: 'textarea' },
		]);
		expect(parseRelationLines(Object.values(typed).join('\n')))
			.toEqual(parseRelationLines(Object.values(written).join('\n')));
	});

	it('picks up wikilinks inside a list field', () => {
		const sections = fieldsToRelationSections([
			{ label: 'Crew', value: '[[Marn]]\n[[Ilse]]', type: 'list' },
		]);
		expect(parseRelationLines(sections['Crew']).map((r) => r.target)).toEqual(['Marn', 'Ilse']);
	});

	it('ignores an empty link field', () => {
		const sections = fieldsToRelationSections([
			{ label: 'Father', value: '', type: 'tags', config: { entityLink: true } },
		]);
		expect(sections['Father']).toBeUndefined();
	});
});

describe('partitionRelationLines', () => {
	test('main labels in MAIN_RELATION_LABELS order, rest in declaration order', () => {
		const rels = parseRelationLines([
			'Rival: [[Beron]]',
			'Mentor: [[Aldric]]',
			'Father: [[King Voss]]',
			'[[The Anchor]]',
			'Pet: [[Whiskers]]',
		].join('\n'));
		const { main, other } = partitionRelationLines(rels);
		expect(main.map((r) => r.label)).toEqual(['Father', 'Mentor', 'Pet']);
		expect(other.map((r) => r.target)).toEqual(['Beron', 'The Anchor']);
	});

	test('case-insensitive main match; bare links always go to other', () => {
		const { main, other } = partitionRelationLines(parseRelationLines('MOTHER: [[Vess]]\n[[Marn]]'));
		expect(main).toHaveLength(1);
		expect(other).toHaveLength(1);
	});

	test('every MAIN_RELATION_LABELS word actually partitions as main', () => {
		for (const word of MAIN_RELATION_LABELS) {
			const label = word.charAt(0).toUpperCase() + word.slice(1);
			const { main } = partitionRelationLines(parseRelationLines(`${label}: [[X]]`));
			expect(main.map((r) => r.label)).toEqual([label]);
		}
	});
});

describe('removeRelationFromText', () => {
	test('removes only the matching line, other lines stay byte-for-byte', () => {
		const text = 'Some prose the writer typed.\nRival: [[Beron]] (intensity 8)\nMother: [[Vess]]';
		const rel = parseRelationLines(text).find((r) => r.target === 'Beron')!;
		expect(removeRelationFromText(text, rel))
			.toBe('Some prose the writer typed.\nMother: [[Vess]]');
	});

	test('multi-target line loses just the one wikilink', () => {
		const text = 'Allies: [[Marn]], [[Ilse]], [[Tobb]]';
		const rel = parseRelationLines(text).find((r) => r.target === 'Ilse')!;
		expect(removeRelationFromText(text, rel)).toBe('Allies: [[Marn]], [[Tobb]]');
	});

	test('removing the last target on a multi-target line', () => {
		const text = 'Allies: [[Marn]], [[Ilse]]';
		const rel = parseRelationLines(text).find((r) => r.target === 'Ilse')!;
		expect(removeRelationFromText(text, rel)).toBe('Allies: [[Marn]]');
	});

	test('unknown relation (raw not found) returns text unchanged', () => {
		const text = 'Mother: [[Vess]]';
		expect(removeRelationFromText(text, { label: 'Rival', target: 'Beron', raw: 'Rival: [[Beron]]' }))
			.toBe(text);
	});
});

describe('setRelationIntensity', () => {
	test('adds an annotation to a bare line', () => {
		const text = 'Rival: [[Beron]]';
		const rel = parseRelationLines(text)[0];
		expect(setRelationIntensity(text, rel, 8)).toBe('Rival: [[Beron]] (intensity 8)');
	});

	test('updates in place, preserving epoch and unknown items verbatim', () => {
		const text = 'Enemy: [[Beron]] (intensity 3, epoch Act II, custom thing)';
		const rel = parseRelationLines(text)[0];
		expect(setRelationIntensity(text, rel, 9))
			.toBe('Enemy: [[Beron]] (intensity 9, epoch Act II, custom thing)');
	});

	test('clearing intensity keeps remaining items, drops empty parens', () => {
		const withEpoch = 'Rival: [[B]] (intensity 5, epoch Act I)';
		expect(setRelationIntensity(withEpoch, parseRelationLines(withEpoch)[0], undefined))
			.toBe('Rival: [[B]] (epoch Act I)');
		const bare = 'Rival: [[B]] (intensity 5)';
		expect(setRelationIntensity(bare, parseRelationLines(bare)[0], undefined)).toBe('Rival: [[B]]');
	});

	test('clamps to 1–10 and preserves list-bullet indentation', () => {
		const text = '  - Rival: [[B]]';
		const rel = parseRelationLines(text)[0];
		expect(setRelationIntensity(text, rel, 99)).toBe('  - Rival: [[B]] (intensity 10)');
	});

	test('edited line round-trips through the parser', () => {
		const text = 'Unrequited love: [[Elena]] (epoch The Long Winter)';
		const updated = setRelationIntensity(text, parseRelationLines(text)[0], 7);
		expect(parseRelationLines(updated)[0]).toMatchObject({
			label: 'Unrequited love',
			target: 'Elena',
			intensity: 7,
			epoch: 'The Long Winter',
		});
	});
});

describe('shouldAutoWriteReciprocal', () => {
	test('world-behavior relations never write back to the target sheet', () => {
		expect(shouldAutoWriteReciprocal('Resident of')).toBe(false);
		expect(shouldAutoWriteReciprocal('Member of')).toBe(false);
		expect(shouldAutoWriteReciprocal('Owner of')).toBe(false);
		expect(shouldAutoWriteReciprocal('Practitioner of')).toBe(false);
	});

	test('every non-world behavior keeps the auto-write', () => {
		expect(shouldAutoWriteReciprocal('Mother')).toBe(true);
		expect(shouldAutoWriteReciprocal('Spouse')).toBe(true);
		expect(shouldAutoWriteReciprocal('Rival')).toBe(true);
		expect(shouldAutoWriteReciprocal('Commander')).toBe(true);
		// Unrecognized words classify as OTHER (oneWay) but are NOT suppressed
		// here — the existing null-reciprocal logic already handles them.
		expect(shouldAutoWriteReciprocal('Sworn frenemy of destiny')).toBe(true);
	});

	test('a custom world-ish type is only suppressed via extraTypes', () => {
		const custom = customTypeToRegistry({ id: 'x', label: 'Haunts', color: '#000', reciprocal: 'self' });
		expect(shouldAutoWriteReciprocal('Haunts', [custom])).toBe(true);
	});
});

describe('nonRelationText (free writing left in a Relationships field)', () => {
	test('lines with a link become chips; the rest stays', () => {
		const text = 'Ex-Partner: [[Ilse Ferrow]]\nThey never speak of the flood.\n\n- Rival: [[Mara Ferrow]]';
		expect(nonRelationText(text)).toBe('They never speak of the flood.');
	});
	test('only links: nothing left', () => {
		expect(nonRelationText('Mother: [[A]]\r\nBrother: [[B]]')).toBe('');
	});
});
