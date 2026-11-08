import { ENTITY_KINDS, CODEX_GROUPS, getCodexKindOrder, getKindSpec, hasKind, instantiateFields, getFieldPrompt, groupFieldsIntoSections, fieldCatalogForKind, initKindRegistry, type EntityKindSpec } from './entity-kinds';
import { NEW_WORLDBUILDING_KINDS } from './worldbuilding-kinds';
import { buildEntityDocument } from './entity-doc';
import { CharacterField } from '../grid-data';

describe('entity-kinds registry', () => {
	test('every kind has a spec with required copy and fields', () => {
		for (const spec of Object.values(ENTITY_KINDS)) {
			expect(spec.singular).toBeTruthy();
			expect(spec.plural).toBeTruthy();
			expect(spec.folderName).toBeTruthy();
			expect(spec.defaultFields.length).toBeGreaterThan(3);
			// Every default field carries a guided prompt
			for (const field of spec.defaultFields) {
				expect(field.prompt).toBeTruthy();
			}
		}
	});

	test('every restructure kind ships a complete default template', () => {
		const ids = new Set<string>();
		for (const spec of NEW_WORLDBUILDING_KINDS) {
			expect(spec.singular).toBeTruthy();
			expect(spec.plural).toBeTruthy();
			expect(spec.folderName).toBeTruthy();
			expect(spec.tagline).toBeTruthy();
			expect(spec.defaultFields.length).toBeGreaterThan(3);
			for (const field of spec.defaultFields) expect(field.prompt).toBeTruthy();
			// Every section must reference fields that actually exist on the spec.
			const labels = new Set(spec.defaultFields.map((f) => f.label));
			for (const section of spec.sections ?? []) {
				for (const label of section.fields) expect(labels.has(label)).toBe(true);
			}
			expect(ids.has(String(spec.kind))).toBe(false); // no duplicate kind ids
			ids.add(String(spec.kind));
		}
	});

	test('codex order is exactly the groups, flattened', () => {
		// CODEX_GROUPS is the single source of truth for sidebar order — a kind
		// missing from the groups must not appear in the sidebar, and vice versa.
		expect(getCodexKindOrder()).toEqual(CODEX_GROUPS.flatMap((g) => g.kinds));
	});

	test('retired kinds still resolve but are absent from the sidebar', () => {
		const order = getCodexKindOrder();
		// scene is the manuscript; location/system/research were superseded by the
		// 2026-08 restructure. All four keep working specs so old documents open.
		for (const retired of ['scene', 'location', 'system', 'research']) {
			expect(order).not.toContain(retired);
			expect(getKindSpec(retired).singular).not.toBe('Entry'); // not the generic fallback
		}
	});

	test('every kind referenced by a group is registered', () => {
		for (const group of CODEX_GROUPS) {
			for (const kind of group.kinds) {
				expect(hasKind(kind)).toBe(true);
			}
		}
	});

	test('system kind ships worldbuilding presets', () => {
		const presets = getKindSpec('system').presets ?? [];
		const names = presets.map((p) => p.name);
		expect(names).toContain('Magic System');
		expect(names).toContain('Government');
	});

	test('instantiateFields fills the name into the first name-like field only', () => {
		const fields = instantiateFields(getKindSpec('character').defaultFields, 'Mara');
		expect(fields[0].label).toBe('Full Name');
		expect(fields[0].value).toBe('Mara');
		expect(fields.slice(1).every((f) => f.value === '')).toBe(true);
		// Fresh ids per instantiation
		const again = instantiateFields(getKindSpec('character').defaultFields, 'Mara');
		expect(again[0].id).not.toBe(fields[0].id);
	});

	test('groupFieldsIntoSections covers every non-image field exactly once', () => {
		for (const spec of Object.values(ENTITY_KINDS)) {
			const fields = instantiateFields(spec.defaultFields, 'X');
			const sections = groupFieldsIntoSections(spec.kind, fields);
			const placed = sections.flatMap((s) => s.fields.map((f) => f.id));
			const expected = fields.filter((f) => f.type !== 'image').map((f) => f.id);
			expect(placed.sort()).toEqual(expected.sort());
		}
	});

	test('custom fields land in a trailing catch-all section', () => {
		const fields = instantiateFields(getKindSpec('character').defaultFields, 'X');
		fields.push({ id: 'custom1', label: 'Sword Style', value: '', type: 'text' });
		const sections = groupFieldsIntoSections('character', fields);
		const last = sections[sections.length - 1];
		expect(last.title).toBe('More');
		expect(last.fields.map((f) => f.id)).toContain('custom1');
	});

	test('categorized custom fields group into their own section, ordered by first appearance', () => {
		const fields = instantiateFields(getKindSpec('character').defaultFields, 'X');
		fields.push(
			{ id: 'combat1', label: 'Weapon of Choice', value: '', type: 'text', category: 'Combat' },
			{ id: 'gear1', label: 'Armor', value: '', type: 'text', category: 'Gear' },
			{ id: 'combat2', label: 'Fighting Style', value: '', type: 'text', category: 'Combat' },
		);
		const sections = groupFieldsIntoSections('character', fields);
		const combat = sections.find((s) => s.title === 'Combat');
		const gear = sections.find((s) => s.title === 'Gear');
		expect(combat?.fields.map((f) => f.id)).toEqual(['combat1', 'combat2']);
		expect(gear?.fields.map((f) => f.id)).toEqual(['gear1']);
		// Combat appeared first among the custom fields, so its section comes first
		expect(sections.indexOf(combat!)).toBeLessThan(sections.indexOf(gear!));
		// Categorized fields never fall into "More"
		const more = sections.find((s) => s.title === 'More');
		expect(more).toBeUndefined();
	});

	test('category sections come after built-in spec sections', () => {
		const fields = instantiateFields(getKindSpec('character').defaultFields, 'X');
		fields.push({ id: 'combat1', label: 'Weapon of Choice', value: '', type: 'text', category: 'Combat' });
		const sections = groupFieldsIntoSections('character', fields);
		const identityIdx = sections.findIndex((s) => s.title === 'Identity');
		const combatIdx = sections.findIndex((s) => s.title === 'Combat');
		expect(identityIdx).toBeGreaterThanOrEqual(0);
		expect(combatIdx).toBeGreaterThan(identityIdx);
	});

	test('getFieldPrompt resolves prompts from defaults and presets', () => {
		expect(getFieldPrompt('character', 'Want')).toMatch(/consciously/);
		expect(getFieldPrompt('system', 'Source of Power')).toBeTruthy(); // preset-only field
		expect(getFieldPrompt('character', 'Not A Field')).toBe('');
	});
});

describe('dynamic kind registry (hybrid built-in + custom)', () => {
	const TONGUE: EntityKindSpec = {
		// NOT 'language' — that is now a shipped kind, and built-ins always win
		// over custom kinds, which is what 'may not override a built-in id' asserts.
		kind: 'tongue',
		singular: 'Tongue',
		plural: 'Tongues',
		icon: 'note-pencil',
		fallbackIcon: '🗣',
		folderName: 'Tongues',
		calloutType: 'note',
		calloutTitle: 'Tongue at a Glance',
		tagline: 'The languages of your world.',
		defaultName: 'Unnamed Tongue',
		defaultFields: [{ label: 'Name', type: 'text', prompt: 'What is it called?' }],
		displayShape: 'row',
	};

	afterEach(() => initKindRegistry()); // reset to built-ins only

	test('custom kinds merge into the registry, marked non-builtin', () => {
		initKindRegistry([TONGUE]);
		const spec = getKindSpec('tongue');
		expect(spec.singular).toBe('Tongue');
		expect(spec.builtin).toBe(false);
		expect(spec.displayShape).toBe('row');
		// built-ins are untouched and marked builtin
		expect(getKindSpec('character').builtin).toBe(true);
	});

	test('custom kinds appear in the codex order', () => {
		initKindRegistry([TONGUE]);
		const order = getCodexKindOrder();
		expect(order).toContain('tongue');
		expect(order).not.toContain('scene');
	});

	test('custom kinds may not override a built-in id', () => {
		initKindRegistry([{ ...getKindSpec('character'), singular: 'HIJACKED' }]);
		expect(getKindSpec('character').singular).toBe('Character');
	});

	test('unknown kind id falls back to a generic spec, never undefined', () => {
		const spec = getKindSpec('totally-unknown-kind');
		expect(spec).toBeTruthy();
		expect(spec.singular).toBeTruthy();
		expect(spec.defaultFields.length).toBeGreaterThan(0);
	});

	test('groupFieldsIntoSections works for a custom kind (all fields land in a section)', () => {
		initKindRegistry([TONGUE]);
		const fields = instantiateFields(getKindSpec('tongue').defaultFields, 'Sindarin');
		const sections = groupFieldsIntoSections('tongue', fields);
		const placed = sections.flatMap((s) => s.fields.map((f) => f.id));
		expect(placed.sort()).toEqual(fields.map((f) => f.id).sort());
	});
});

describe('buildEntityDocument', () => {
	const fields: CharacterField[] = [
		{ id: '1', label: 'Full Name', value: 'Mara Venn', type: 'text' },
		{ id: '2', label: 'Role', value: 'Protagonist', type: 'text' },
		{ id: '3', label: 'Portrait', value: 'Images/mara.png', type: 'image' },
		{ id: '4', label: 'Backstory', value: 'Raised on the docks.', type: 'textarea' },
		{ id: '5', label: 'Empty Section', value: '', type: 'textarea' },
	];

	test('produces frontmatter, callout table, embeds, and prose sections', () => {
		const doc = buildEntityDocument('character', 'Mara Venn', fields);
		expect(doc).toContain('storygrid-type: character');
		expect(doc).toContain('full-name: "Mara Venn"');
		expect(doc).toContain('# Mara Venn');
		expect(doc).toContain('cssclasses: [storygrid-sheet, sg-sheet-character]');
		expect(doc).toContain('> ![[Images/mara.png]]'); // portrait lives inside the infobox
		expect(doc).toContain('> [!info|sg-infobox] Character at a Glance');
		expect(doc).toContain('| **Role** | Protagonist |');
		expect(doc).toContain('## Backstory');
		// Empty sections and empty fields are omitted — the file stays clean
		expect(doc).not.toContain('Empty Section');
		expect(doc).not.toContain('_No content yet._');
		// Image fields never leak into frontmatter
		expect(doc).not.toContain('portrait:');
	});

	test('empty text fields are omitted from frontmatter', () => {
		const doc = buildEntityDocument('character', 'Mara', [
			{ id: '1', label: 'Full Name', value: 'Mara', type: 'text' },
			{ id: '2', label: 'Fear', value: '', type: 'text' },
		]);
		expect(doc).not.toContain('fear:');
		expect(doc).not.toContain('| **Fear** |');
	});

	test('frontmatter keys are sanitised (no punctuation from labels)', () => {
		const doc = buildEntityDocument('faction', 'Guild', [
			{ id: '1', label: 'Motto or Creed?', value: 'Every light is owed', type: 'text' },
		]);
		expect(doc).toContain('motto-or-creed: "Every light is owed"');
	});

	test('uses each kind’s own callout', () => {
		const doc = buildEntityDocument('system', 'Tidebinding', [
			{ id: '1', label: 'Type', value: 'Hard magic', type: 'text' },
		]);
		expect(doc).toContain('> [!note|sg-infobox] System at a Glance');
	});
});

describe('sections and the ready-made field catalog', () => {
	test('a custom field filed under a built-in section joins it instead of opening a twin', () => {
		const sections = groupFieldsIntoSections('character', [
			{ id: '1', label: 'Age', value: '34', type: 'text' },
			{ id: '2', label: 'Height', value: '181cm', type: 'text', category: 'Identity' },
		]);
		const identity = sections.filter((s) => s.title === 'Identity');
		expect(identity).toHaveLength(1);
		expect(identity[0].fields.map((f) => f.label)).toEqual(['Age', 'Height']);
	});

	test('the catalog groups fields by the section that owns them', () => {
		const catalog = fieldCatalogForKind('character', []);
		const identity = catalog.find((c) => c.title === 'Identity');
		expect(identity?.fields.map((f) => f.label)).toContain('Age');
		// Every entry carries the type and prompt it will be created with.
		for (const category of catalog) {
			for (const field of category.fields) {
				expect(field.label).toBeTruthy();
				expect(field.type).toBeTruthy();
			}
		}
	});

	test('fields already on the sheet are not offered again', () => {
		const withAge = fieldCatalogForKind('character', ['Age']);
		const labels = withAge.flatMap((c) => c.fields.map((f) => f.label));
		expect(labels).not.toContain('Age');
	});

	test('a category disappears once all of its fields are used', () => {
		const spec = getKindSpec('character');
		const allLabels = spec.defaultFields.map((f) => f.label);
		const catalog = fieldCatalogForKind('character', allLabels);
		expect(catalog.find((c) => c.title === 'Identity')).toBeUndefined();
	});
});

describe('user-supplied attribute catalog', () => {
	test('Personality › Paranoid is offered to characters as a slider', () => {
		const catalog = fieldCatalogForKind('character', []);
		const personality = catalog.find((c) => c.title === 'Personality');
		expect(personality).toBeTruthy();
		const paranoid = personality!.fields.find((f) => f.label === 'Paranoid');
		expect(paranoid?.type).toBe('slider');
		expect(paranoid?.config).toEqual({ min: 0, max: 100, step: 1 });
		expect(paranoid?.prompt).toBeTruthy();
	});

	test('other kinds are unaffected until they are given their own categories', () => {
		const catalog = fieldCatalogForKind('location', []);
		expect(catalog.find((c) => c.title === 'Personality')).toBeUndefined();
	});
});
