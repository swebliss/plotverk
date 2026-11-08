/**
 * Every registered Codex kind must open as itself and save as itself.
 *
 * The bug this guards: the parser used to check only the original eight kinds,
 * so the other 28 read back as "no kind", the detail page showed them as a
 * Character, and the Edit button re-saved them as one. These tests walk the
 * whole registry (`registeredKinds()`), so a kind added later is covered
 * without anyone remembering to list it here.
 */
import { parseEntityDocument, mergeWithSpecDefaults } from './entity-parse';
import { buildEntityDocument, buildEntityFrontmatter } from './entity-doc';
import { applyEntityEdits, applyOwnedFrontmatter, planFieldWrites } from './entity-write';
import {
	ENTITY_KINDS,
	EntityKindSpec,
	getKindSpec,
	hasKind,
	initKindRegistry,
	instantiateFields,
	registeredKinds,
} from './entity-kinds';
import { splitFrontmatter } from './entity-parse';
import { CharacterField } from '../grid-data';

/** Fill the writable text-like fields so the sheet has real content to lose. */
function filledFields(kind: string): CharacterField[] {
	const spec = getKindSpec(kind);
	return instantiateFields(spec.defaultFields, 'Test Name').map((f, i) =>
		f.type === 'text' || f.type === 'textarea' ? { ...f, value: f.value || `Sample text ${i}` } : f
	);
}

describe('every registered kind round-trips as itself', () => {
	afterEach(() => initKindRegistry());

	it('the registry is bigger than the original eight (so the bug could bite)', () => {
		expect(registeredKinds().length).toBeGreaterThanOrEqual(36);
		for (const k of Object.keys(ENTITY_KINDS)) expect(hasKind(k)).toBe(true);
	});

	it.each(registeredKinds())('%s: build → parse → merge → save keeps its kind', (kind) => {
		const fields = filledFields(kind);
		const doc = buildEntityDocument(kind, 'Test Name', fields, 'sg_roundtrip01');

		// Opens as itself
		const parsed = parseEntityDocument(doc, 'Test Name');
		expect(parsed.kind).toBe(kind);
		expect(parsed.name).toBe('Test Name');
		expect(parsed.entityId).toBe('sg_roundtrip01');

		// The editor sees every field the kind defines, filled or not
		const merged = mergeWithSpecDefaults(parsed.kind, parsed.fields);
		const labels = new Set(merged.map((f) => f.label));
		for (const def of getKindSpec(kind).defaultFields) {
			// Preset-driven kinds merge against the best-fitting set, so only
			// insist on the labels the sheet actually carried or the defaults.
			if (fields.some((f) => f.label === def.label)) expect(labels.has(def.label)).toBe(true);
		}

		// Saves as itself: the frontmatter the writer assigns names the same kind
		const before = merged.map((f) => ({ id: f.id, label: f.label, type: f.type }));
		const owned = buildEntityFrontmatter(parsed.kind!, merged, parsed.entityId ?? undefined, parsed.aliases);
		expect(owned['storygrid-type']).toBe(kind);
		expect(owned['cssclasses']).toContain(`sg-sheet-${kind}`);

		// A save with no edits leaves the sheet's body exactly as it was
		const saved = applyEntityEdits(doc, parsed.kind!, parsed.name, planFieldWrites(before, merged));
		expect(splitFrontmatter(saved).body).toBe(splitFrontmatter(doc).body);

		// And the file, with the frontmatter applied the way Obsidian would, still parses as the kind
		const fm: Record<string, unknown> = {};
		applyOwnedFrontmatter(fm, owned, parsed.ownedKeys);
		expect(fm['storygrid-type']).toBe(kind);
		expect(parseEntityDocument(saved, parsed.name).kind).toBe(kind);
	});
});

describe('kinds outside the built-in list', () => {
	const CUSTOM: EntityKindSpec = {
		kind: 'creature',
		singular: 'Creature',
		plural: 'Creatures',
		icon: 'paw-print',
		fallbackIcon: '🐾',
		folderName: 'Creatures',
		calloutType: 'note',
		calloutTitle: 'Creature at a Glance',
		tagline: '',
		defaultName: 'Untitled Creature',
		defaultFields: [{ label: 'Name', type: 'text', prompt: 'What is it called?' }],
	};

	afterEach(() => initKindRegistry());

	it('a custom kind opens and saves as itself', () => {
		initKindRegistry([CUSTOM]);
		expect(registeredKinds()).toContain('creature');
		const fields = filledFields('creature');
		const doc = buildEntityDocument('creature', 'Wyrm', fields);
		const parsed = parseEntityDocument(doc, 'Wyrm');
		expect(parsed.kind).toBe('creature');
		const merged = mergeWithSpecDefaults(parsed.kind, parsed.fields);
		expect(buildEntityFrontmatter(parsed.kind!, merged)['storygrid-type']).toBe('creature');
	});

	it('a type the registry does not know is kept as written, and its fields are left alone', () => {
		const doc = '---\nstorygrid-type: mystery-kind\nrole: Stranger\n---\n\n# Odd One\n';
		const parsed = parseEntityDocument(doc, 'Odd One');
		expect(parsed.kind).toBe('mystery-kind');
		expect(hasKind('mystery-kind')).toBe(false);

		// No spec to merge against, so nothing is added to the sheet…
		expect(mergeWithSpecDefaults(parsed.kind, parsed.fields)).toBe(parsed.fields);
		// …and a save names the same type again instead of falling back to Character
		expect(buildEntityFrontmatter(parsed.kind!, parsed.fields)['storygrid-type']).toBe('mystery-kind');
	});

	it('a sheet with no storygrid-type reports no kind (the caller must not guess Character)', () => {
		const parsed = parseEntityDocument('# Plain Note\n\nJust words.\n', 'Plain Note');
		expect(parsed.kind).toBeNull();
		expect(mergeWithSpecDefaults(parsed.kind, parsed.fields)).toBe(parsed.fields);
	});
});
