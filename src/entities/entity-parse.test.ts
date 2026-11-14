import { parseEntityDocument, mergeWithSpecDefaults, splitFrontmatter } from './entity-parse';
import { buildEntityDocument } from './entity-doc';
import { CharacterField } from '../grid-data';
import { initKindRegistry, EntityKindSpec } from './entity-kinds';

describe('parseEntityDocument', () => {
	const fields: CharacterField[] = [
		{ id: '1', label: 'Full Name', value: 'Mara Venn', type: 'text' },
		{ id: '2', label: 'Role', value: 'Protagonist', type: 'text' },
		{ id: '3', label: 'One-Line Essence', value: 'A tide-smuggler who hears the sea lie', type: 'text' },
		{ id: '4', label: 'Portrait', value: 'Images/mara.png', type: 'image' },
		{ id: '5', label: 'Backstory', value: 'Raised on the docks.\n\nThe wreck was never declared.', type: 'textarea' },
		{ id: '6', label: 'Notes', value: '', type: 'textarea' },
	];

	test('round-trips a generated character document', () => {
		const doc = buildEntityDocument('character', 'Mara Venn', fields);
		const parsed = parseEntityDocument(doc, 'Mara Venn');

		expect(parsed.kind).toBe('character');
		expect(parsed.name).toBe('Mara Venn');

		const byLabel = new Map(parsed.fields.map((f) => [f.label, f]));
		// Exact labels recovered from the callout table, including punctuation
		expect(byLabel.get('Full Name')?.value).toBe('Mara Venn');
		expect(byLabel.get('Role')?.value).toBe('Protagonist');
		expect(byLabel.get('One-Line Essence')?.value).toBe('A tide-smuggler who hears the sea lie');
		// Image embed recovered as an image field
		expect(byLabel.get('Portrait')?.type).toBe('image');
		expect(byLabel.get('Portrait')?.value).toBe('Images/mara.png');
		// Prose sections recovered with paragraphs intact
		expect(byLabel.get('Backstory')?.type).toBe('textarea');
		expect(byLabel.get('Backstory')?.value).toBe('Raised on the docks.\n\nThe wreck was never declared.');
		// Empty sections are no longer written to disk, so they don't parse back…
		expect(byLabel.has('Notes')).toBe(false);
		// …but merging with the spec restores them as empties for the editor
		const merged = mergeWithSpecDefaults(parsed.kind, parsed.fields);
		const mergedByLabel = new Map(merged.map((f) => [f.label, f]));
		expect(mergedByLabel.get('Notes')?.type).toBe('textarea');
		expect(mergedByLabel.get('Notes')?.value).toBe('');
		expect(mergedByLabel.get('Want')?.value).toBe('');
		// Filled values survive the merge untouched
		expect(mergedByLabel.get('Full Name')?.value).toBe('Mara Venn');
	});

	test('mergeWithSpecDefaults keeps custom fields and prefers a matching preset', () => {
		const custom = mergeWithSpecDefaults('character', [
			{ id: 'c1', label: 'Sword Style', value: 'Two blades', type: 'text' },
		]);
		expect(custom[custom.length - 1].label).toBe('Sword Style');
		expect(custom.some((f) => f.label === 'Want')).toBe(true);

		// A sheet built from the Magic System preset merges against that preset,
		// not the generic system defaults
		const magic = mergeWithSpecDefaults('system', [
			{ id: 'm1', label: 'Source of Power', value: 'The tide', type: 'text' },
			{ id: 'm2', label: 'How It Is Learned', value: 'Apprenticeship', type: 'textarea' },
			{ id: 'm3', label: 'Rules', value: 'Routes must be sailed.', type: 'textarea' },
		]);
		expect(magic.some((f) => f.label === 'Costs')).toBe(true); // shared field restored
		expect(magic.some((f) => f.label === 'Access & Control')).toBe(false); // defaults-only field NOT added
	});

	test('aliases round-trip', () => {
		const doc = buildEntityDocument('character', 'Officer Dan', fields, 'id-123', ['the police', 'the cop']);
		const parsed = parseEntityDocument(doc, 'Officer Dan');
		expect(parsed.aliases).toEqual(['the police', 'the cop']);
		const rebuilt = buildEntityDocument(parsed.kind!, parsed.name, parsed.fields, parsed.entityId ?? undefined, parsed.aliases);
		expect(rebuilt).toBe(doc);
	});

	test('aliases empty when not present', () => {
		const doc = buildEntityDocument('character', 'Mara Venn', fields);
		const parsed = parseEntityDocument(doc, 'Mara Venn');
		expect(parsed.aliases).toEqual([]);
	});

	test('build → parse → build is stable', () => {
		const doc = buildEntityDocument('system', 'Tidebinding', [
			{ id: '1', label: 'Type', value: 'Hard magic', type: 'text' },
			{ id: '2', label: 'Rules', value: 'Routes must be sailed.', type: 'textarea' },
		]);
		const parsed = parseEntityDocument(doc, 'Tidebinding');
		const rebuilt = buildEntityDocument(parsed.kind!, parsed.name, parsed.fields);
		expect(rebuilt).toBe(doc);
	});

	test('prose edits in the body win over stale frontmatter', () => {
		const doc = [
			'---',
			'storygrid-type: location',
			'type: "Tavern"',
			'history: |',
			'  Old frontmatter copy.',
			'---',
			'',
			'# The Anchor',
			'',
			'## History',
			'',
			'Hand-edited body copy.',
			'',
		].join('\n');
		const parsed = parseEntityDocument(doc, 'The Anchor');
		const history = parsed.fields.find((f) => f.label === 'History');
		expect(history?.type).toBe('textarea');
		expect(history?.value).toBe('Hand-edited body copy.');
		// And the scalar field still comes through
		expect(parsed.fields.find((f) => f.label === 'Type')?.value).toBe('Tavern');
	});

	test('handles documents without frontmatter or known structure', () => {
		const parsed = parseEntityDocument('# Stray Note\n\nJust text.', 'Stray Note');
		expect(parsed.kind).toBeNull();
		expect(parsed.name).toBe('Stray Note');
	});
});

describe('round-trip for all 10 field types', () => {
	// Ordered scalars → image → textarea, matching the convention every real
	// entity-kind spec uses (and the shape the parser reconstructs: frontmatter
	// scalars, then image embeds, then prose sections, in that order).
	const cases: Array<Pick<CharacterField, 'label' | 'type' | 'value' | 'config'>> = [
		{ label: 'Full Name', type: 'text', value: 'Mara Venn' },
		{ label: 'Quirks', type: 'tags', value: 'bites nails, hums when lying' },
		{ label: 'Threat Level', type: 'number', value: '27' },
		{ label: 'Charisma', type: 'slider', value: '62', config: { min: 0, max: 100, step: 1 } },
		{ label: 'Life Status', type: 'select', value: 'Alive', config: { options: ['Alive', 'Deceased'] } },
		{ label: 'Is Immortal', type: 'checkbox', value: 'true' },
		{ label: 'Born', type: 'date', value: '2026-07-30' },
		{ label: 'Temperament', type: 'matrix', value: '62,-30', config: { xAxis: ['Cold', 'Warm'], yAxis: ['Calm', 'Bold'] } },
		{ label: 'Portrait', type: 'image', value: 'Images/mara.png' },
		{ label: 'Backstory', type: 'textarea', value: 'Raised on the docks.\n\nThe wreck was never declared.' },
	];

	for (const c of cases) {
		test(`${c.type} field round-trips through build → parse`, () => {
			const field: CharacterField = { id: 'x', ...c };
			const doc = buildEntityDocument('character', 'Mara Venn', [field]);
			const parsed = parseEntityDocument(doc, 'Mara Venn');
			const found = parsed.fields.find((f) => f.label === c.label);
			expect(found).toBeDefined();
			expect(found?.type).toBe(c.type);
			expect(found?.value).toBe(c.value);
			if (c.config) expect(found?.config).toEqual(c.config);
		});
	}

	test('a custom field carries its category and prompt through the round trip', () => {
		const field: CharacterField = {
			id: 'x', label: 'Weapon of Choice', type: 'text', value: 'Rapier',
			category: 'Combat', prompt: 'What do they fight with?',
		};
		const doc = buildEntityDocument('character', 'Mara Venn', [field]);
		const parsed = parseEntityDocument(doc, 'Mara Venn');
		const found = parsed.fields.find((f) => f.label === 'Weapon of Choice');
		expect(found?.category).toBe('Combat');
		expect(found?.prompt).toBe('What do they fight with?');
	});

	test('storygrid-schema does not leak as a visible field', () => {
		const field: CharacterField = { id: 'x', label: 'Charisma', type: 'slider', value: '62', config: { min: 0, max: 100, step: 1 } };
		const doc = buildEntityDocument('character', 'Mara Venn', [field]);
		const parsed = parseEntityDocument(doc, 'Mara Venn');
		expect(parsed.fields.some((f) => f.label.toLowerCase().includes('schema'))).toBe(false);
	});

	test('build → parse → build is stable for a document using every new field type', () => {
		const fields: CharacterField[] = cases.map((c, i) => ({ id: `f${i}`, ...c }));
		const doc = buildEntityDocument('character', 'Mara Venn', fields);
		const parsed = parseEntityDocument(doc, 'Mara Venn');
		const rebuilt = buildEntityDocument(parsed.kind!, parsed.name, parsed.fields);
		expect(rebuilt).toBe(doc);
	});
});

describe('legacy / hand-edited documents without storygrid-schema', () => {
	test('a pre-upgrade document (tags as a quoted comma string) still parses — as text, best-effort', () => {
		const doc = [
			'---',
			'storygrid-type: character',
			'quirks: "bites nails, hums when lying"',
			'---',
			'',
			'# Mara',
			'',
		].join('\n');
		const parsed = parseEntityDocument(doc, 'Mara');
		const found = parsed.fields.find((f) => f.label === 'Quirks');
		expect(found?.type).toBe('text');
		expect(found?.value).toBe('bites nails, hums when lying');
	});

	test('hand-typed scalar YAML (bare number/boolean/date) parses without throwing and stays with the writer', () => {
		const doc = [
			'---',
			'storygrid-type: character',
			'charisma: 62',
			'is-immortal: true',
			'born: 2026-07-30',
			'---',
			'',
			'# Mara',
			'',
		].join('\n');
		expect(() => parseEntityDocument(doc, 'Mara')).not.toThrow();
		const parsed = parseEntityDocument(doc, 'Mara');
		// Taken in as text, a save would write them back as "62" and "true".
		expect(parsed.fields.find((f) => f.label === 'Charisma')).toBeUndefined();
		expect(parsed.fields.find((f) => f.label === 'Is Immortal')).toBeUndefined();
		expect(parsed.ownedKeys).not.toContain('charisma');
		expect(parsed.ownedKeys).not.toContain('is-immortal');
	});

	test('a corrupted storygrid-schema value is ignored, not thrown', () => {
		const doc = [
			'---',
			'storygrid-type: character',
			"storygrid-schema: 'not valid json'",
			'threat-level: 27',
			'---',
			'',
			'# Mara',
			'',
		].join('\n');
		expect(() => parseEntityDocument(doc, 'Mara')).not.toThrow();
	});
});

describe('mergeWithSpecDefaults generalized type repair', () => {
	const CUSTOM_KIND: EntityKindSpec = {
		kind: 'creature',
		singular: 'Creature',
		plural: 'Creatures',
		icon: 'paw-print',
		fallbackIcon: '🐾',
		folderName: 'Creatures',
		calloutType: 'note',
		calloutTitle: 'Creature at a Glance',
		tagline: '',
		defaultName: 'Unnamed Creature',
		defaultFields: [
			{ label: 'Name', type: 'text', prompt: 'What is it called?' },
			{ label: 'Danger Level', type: 'slider', prompt: 'How dangerous is it, 0-100?' },
		],
	};

	afterEach(() => initKindRegistry());

	test('promotes a spec field parsed as text (no schema) to the spec-declared type', () => {
		initKindRegistry([CUSTOM_KIND]);
		const merged = mergeWithSpecDefaults('creature', [
			{ id: '1', label: 'Name', value: 'Wyrm', type: 'text' },
			{ id: '2', label: 'Danger Level', value: '80', type: 'text' }, // legacy: parsed as text, no schema
		]);
		const danger = merged.find((f) => f.label === 'Danger Level');
		expect(danger?.type).toBe('slider');
		expect(danger?.value).toBe('80');
	});

	test('never overrides a type the parser was already sure of', () => {
		initKindRegistry([CUSTOM_KIND]);
		const merged = mergeWithSpecDefaults('creature', [
			{ id: '2', label: 'Danger Level', value: '80', type: 'number' }, // schema said number, not slider
		]);
		expect(merged.find((f) => f.label === 'Danger Level')?.type).toBe('number');
	});
});

describe('entity ID round-trip', () => {
	it('parses storygrid-id from frontmatter and does not leak it as a field', () => {
		const fields: CharacterField[] = [
			{ id: '1', label: 'Role', value: 'Protagonist', type: 'text' },
		];
		const doc = buildEntityDocument('character', 'Rick', fields, 'sg_abc123def456');
		expect(doc).toContain('storygrid-id: sg_abc123def456');

		const parsed = parseEntityDocument(doc, 'Rick');
		expect(parsed.entityId).toBe('sg_abc123def456');
		// Must not leak as a user-visible field
		expect(parsed.fields.find((f) => f.label.toLowerCase().includes('storygrid'))).toBeUndefined();
		expect(parsed.fields.find((f) => f.label.toLowerCase().includes('id'))).toBeUndefined();
	});

	it('returns null entityId for legacy documents without storygrid-id', () => {
		const doc = '---\nstorygrid-type: character\n---\n# Old\n';
		const parsed = parseEntityDocument(doc, 'Old');
		expect(parsed.entityId).toBeNull();
	});
});

describe('field labels the slug function cannot reproduce', () => {
	const frontmatterOf = (doc: string): string => doc.slice(0, doc.indexOf('\n---\n', 4));

	test('a non-Latin label produces valid frontmatter instead of an empty key', () => {
		const doc = buildEntityDocument('character', 'マラ', [
			{ id: '1', label: '名前', value: 'マラ・ヴェン', type: 'text' },
			{ id: '2', label: '年齢', value: '31', type: 'text' },
		]);
		// The bug this closes: both labels stripped to '' and the sheet wrote
		// `: "マラ・ヴェン"`, which breaks the whole block and hides the entity.
		expect(frontmatterOf(doc)).not.toMatch(/^\s*:/m);
		expect(doc).toContain('field-1cadmz3: "マラ・ヴェン"');
		expect(doc).toContain('field-15on74j: "31"');
	});

	test('a non-Latin label round-trips back to its exact text', () => {
		const doc = buildEntityDocument('character', 'マラ', [
			{ id: '1', label: '名前', value: 'マラ・ヴェン', type: 'text' },
		]);
		const byLabel = new Map(parseEntityDocument(doc, 'マラ').fields.map((f) => [f.label, f.value]));
		expect(byLabel.get('名前')).toBe('マラ・ヴェン');
	});

	test('two labels that slug the same both survive', () => {
		const doc = buildEntityDocument('character', 'Mara', [
			{ id: '1', label: 'Age?', value: 'Thirty-one', type: 'text' },
			{ id: '2', label: 'Age!', value: 'Old enough', type: 'text' },
		]);
		// Before: both wrote `age:` and the second overwrote the first.
		expect(doc).toContain('age: "Thirty-one"');
		expect(doc).toContain('age-2: "Old enough"');

		const byLabel = new Map(parseEntityDocument(doc, 'Mara').fields.map((f) => [f.label, f.value]));
		expect(byLabel.get('Age?')).toBe('Thirty-one');
		expect(byLabel.get('Age!')).toBe('Old enough');
	});

	test('an ordinary sheet gains no schema noise from the key machinery', () => {
		const doc = buildEntityDocument('character', 'Mara', [
			{ id: '1', label: 'Full Name', value: 'Mara Venn', type: 'text' },
			{ id: '2', label: 'Backstory', value: 'Raised on the docks.', type: 'textarea' },
		]);
		expect(doc).not.toContain('storygrid-schema');
	});

	test('a reserved-key label still round-trips through the field- prefix', () => {
		const doc = buildEntityDocument('character', 'Mara', [
			{ id: '1', label: 'Tags', value: 'smuggler', type: 'text' },
		]);
		expect(doc).toContain('field-tags: "smuggler"');
		const byLabel = new Map(parseEntityDocument(doc, 'Mara').fields.map((f) => [f.label, f.value]));
		expect(byLabel.get('Tags')).toBe('smuggler');
	});

	test('a schema written before keys were recorded still resolves by label', () => {
		// Back-compat: no `key` on the entry, so the parser recomputes the slug.
		const schema = JSON.stringify([{ label: 'Charisma', type: 'slider', config: { min: 0, max: 100, step: 1 } }]);
		const doc = [
			'---',
			'storygrid-type: character',
			`storygrid-schema: '${schema}'`,
			'charisma: 62',
			'---',
			'',
			'# Mara',
			'',
			'> [!info|sg-infobox] Character at a Glance',
			'>',
			'> | Field | Value |',
			'> | --- | --- |',
			'> | **Charisma** | 62 |',
			'',
		].join('\n');
		const field = parseEntityDocument(doc, 'Mara').fields.find((f) => f.label === 'Charisma');
		expect(field?.type).toBe('slider');
		expect(field?.value).toBe('62');
	});
});

describe('splitFrontmatter', () => {
	test('frontmatter + body is the input, byte for byte', () => {
		const content = '---\ntags: [keep]\nstorygrid-id: sg_1\n---\n\n# Mara\n\nProse.\n';
		const { frontmatter, body } = splitFrontmatter(content);
		expect(frontmatter).toBe('---\ntags: [keep]\nstorygrid-id: sg_1\n---\n');
		expect(frontmatter + body).toBe(content);
	});

	test('no frontmatter means an empty prefix, not a guess', () => {
		const content = '# Mara\n\n---\n\nA thematic break, not a frontmatter fence.\n';
		const { frontmatter, body } = splitFrontmatter(content);
		expect(frontmatter).toBe('');
		expect(body).toBe(content);
	});

	test('CRLF documents split without losing a byte', () => {
		const content = '---\r\nkey: v\r\n---\r\n\r\n# Mara\r\n';
		const { frontmatter, body } = splitFrontmatter(content);
		expect(frontmatter + body).toBe(content);
		expect(body).toBe('\r\n# Mara\r\n');
	});
});

describe('keys that are not the sheet writer\'s to touch', () => {
	test('storygrid-parent never becomes a field', () => {
		// Before this skip, a nested location parsed a junk "Storygrid Parent"
		// field, and saving the sheet moved the real parent link under
		// `field-storygrid-parent` — orphaning the entity in the tree.
		const doc = [
			'---',
			'storygrid-type: location',
			'storygrid-parent: Locations/The Keep.md',
			'---',
			'',
			'# The Armory',
			'',
		].join('\n');
		const parsed = parseEntityDocument(doc, 'The Armory');
		expect(parsed.fields.find((f) => f.label.toLowerCase().includes('parent'))).toBeUndefined();
		expect(parsed.ownedKeys).not.toContain('storygrid-parent');
	});

	test('ownedKeys lists exactly what a save may clean up', () => {
		const doc = buildEntityDocument('character', 'Mara Venn', [
			{ id: '1', label: 'Full Name', value: 'Mara Venn', type: 'text' },
			{ id: '2', label: 'Backstory', value: 'Raised on the docks.', type: 'textarea' },
		], 'sg_abc123', ['the smuggler']);
		// A sheet also carrying keys that belong to the user and to Obsidian.
		const withForeign = doc.replace(
			'---\nstorygrid-type:',
			'---\ntags: [reading-list]\nstorygrid-parent: X.md\nstorygrid-type:'
		);
		const parsed = parseEntityDocument(withForeign, 'Mara Venn');
		expect(parsed.ownedKeys).toEqual(
			expect.arrayContaining(['storygrid-type', 'storygrid-id', 'aliases', 'full-name', 'backstory'])
		);
		expect(parsed.ownedKeys).not.toContain('tags');
		expect(parsed.ownedKeys).not.toContain('cssclasses');
		expect(parsed.ownedKeys).not.toContain('storygrid-parent');
	});
});

describe('one unquote, exactly once', () => {
	test('a value that is literally "quoted" keeps its quotes', () => {
		// The old reader unquoted in parseFrontmatterBlock AND in decodeValue,
		// so the writer's own quotation marks were eaten on every open.
		const doc = buildEntityDocument('character', 'Mara', [
			{ id: '1', label: 'Catchphrase', value: '"No refunds."', type: 'text' },
		]);
		const parsed = parseEntityDocument(doc, 'Mara');
		expect(parsed.fields.find((f) => f.label === 'Catchphrase')?.value).toBe('"No refunds."');
	});

	test('an Obsidian-quoted numeric string still reads as its bare value', () => {
		const doc = ['---', 'storygrid-type: character', 'age: "114"', '---', '', '# Nick', ''].join('\n');
		const parsed = parseEntityDocument(doc, 'Nick');
		expect(parsed.fields.find((f) => f.label === 'Age')?.value).toBe('114');
	});
});

describe('fence-aware sections', () => {
	test('a `## ` inside a code fence stays inside its section', () => {
		const doc = buildEntityDocument('character', 'Mara', [
			{ id: '1', label: 'Backstory', value: 'Her ledger begins:\n\n```md\n## Not a heading\n```\n\nAnd ends there.', type: 'textarea' },
		]);
		const parsed = parseEntityDocument(doc, 'Mara');
		const backstory = parsed.fields.find((f) => f.label === 'Backstory');
		expect(backstory?.value).toContain('## Not a heading');
		expect(parsed.fields.find((f) => f.label === 'Not a heading')).toBeUndefined();
	});
});

describe('an Event\'s "How Long" choice survives a save and an edit (2026-11-03)', () => {
	it('keeps "Lasts a while" with an empty End Date, as frontmatter how-long and as the field', () => {
		const { getKindSpec, instantiateFields } = jest.requireActual('./entity-kinds');
		const fields: CharacterField[] = instantiateFields(getKindSpec('event').defaultFields, 'The Guild');
		const set = (label: string, value: string) => { const f = fields.find((x) => x.label === label); if (f) f.value = value; };
		set('Date', '{"year":1211,"month":9,"day":1}');
		set('How Long', 'Lasts a while');
		const doc = buildEntityDocument('event', 'The Guild', fields, 'ent-hl');
		const fm = splitFrontmatter(doc);
		expect(fm.frontmatter).toMatch(/^how-long: "?Lasts a while"?$/m);
		const parsed = parseEntityDocument(doc, 'The Guild');
		// The editor's own path: parse, then repair spec field types (as Gender does).
		const merged = mergeWithSpecDefaults('event', parsed.fields);
		expect(merged.find((f) => f.label === 'How Long')).toMatchObject({ type: 'select', value: 'Lasts a while' });
		expect(parsed.fields.find((f) => f.label === 'End Date')?.value ?? '').toBe('');
	});
});
