import { CharacterField } from '../grid-data';
import { buildEntityDocument } from './entity-doc';
import { emptyFieldsToKeep, mergeWithSpecDefaults, parseEntityDocument } from './entity-parse';
import { getCodexKindOrder, EVENT_HOW_LONG, EntityKind, getKindSpec, instantiateFields } from './entity-kinds';
import { cleanSlateFieldSpecs } from './start-mode';
import { CLEAN_SLATE_VALUE, START_MODE_KEY } from './start-mode';

/**
 * A field the writer adds stays on the sheet until they remove it — filled in
 * or not, with help text or without. Emma, 2026-11-12: losing work is a disaster.
 */

function custom(label: string, type: CharacterField['type'] = 'text', extra: Partial<CharacterField> = {}): CharacterField {
	return { id: `id-${label}`, label, value: '', type, ...extra };
}

/** Save the way the app does, then reopen the way the Edit button does. */
function saveAndReopen(kind: EntityKind, fields: CharacterField[], cleanSlate = false): CharacterField[] {
	let doc = buildEntityDocument(kind, 'Mandy', fields, 'sg_test', undefined, emptyFieldsToKeep(kind, fields, cleanSlate));
	if (cleanSlate) doc = doc.replace('\n---\n', `\n${START_MODE_KEY}: ${CLEAN_SLATE_VALUE}\n---\n`);
	const parsed = parseEntityDocument(doc, 'Mandy');
	expect(parsed.cleanSlate).toBe(cleanSlate);
	return mergeWithSpecDefaults(kind, parsed.fields, parsed.cleanSlate);
}

const labels = (fs: CharacterField[]) => fs.map((f) => f.label);

describe('empty fields are never lost', () => {
	test('a new custom field with no help text and no value survives save + reopen', () => {
		const fields = [...instantiateFields(getKindSpec('character').defaultFields, 'Mandy'), custom('Favourite food')];
		expect(labels(saveAndReopen('character', fields))).toContain('Favourite food');
	});

	test('the same on a clean slate', () => {
		const fields = [...instantiateFields(cleanSlateFieldSpecs('character'), 'Mandy'), custom('Favourite food')];
		expect(labels(saveAndReopen('character', fields, true))).toContain('Favourite food');
	});

	test('help text, section and type come back with it', () => {
		const fields = [custom('Eyes', 'tags', { prompt: 'What colour?', category: 'Looks' })];
		const back = saveAndReopen('character', fields, true).find((f) => f.label === 'Eyes');
		expect(back).toMatchObject({ type: 'tags', prompt: 'What colour?', category: 'Looks', value: '' });
	});

	test('every field type survives empty', () => {
		const types: CharacterField['type'][] = ['text', 'textarea', 'tags', 'list', 'table', 'number', 'date', 'color', 'checkbox', 'image'];
		const fields = types.map((t) => custom(`My ${t}`, t));
		const back = labels(saveAndReopen('character', fields, true));
		for (const t of types) expect(back).toContain(`My ${t}`);
	});

	test('a template field added to a clean slate and left empty survives', () => {
		const backstory = getKindSpec('character').defaultFields.find((f) => f.label === 'Backstory');
		expect(backstory).toBeDefined();
		const fields = [...instantiateFields(cleanSlateFieldSpecs('character'), 'Mandy'), { ...custom('Backstory', backstory!.type) }];
		expect(labels(saveAndReopen('character', fields, true))).toContain('Backstory');
	});

	test('a field that is filled in later keeps its value, once', () => {
		const first = saveAndReopen('character', [custom('Favourite food')], true);
		const filled = first.map((f) => (f.label === 'Favourite food' ? { ...f, value: 'Pancakes' } : f));
		const again = saveAndReopen('character', filled, true).filter((f) => f.label === 'Favourite food');
		expect(again).toHaveLength(1);
		expect(again[0].value).toBe('Pancakes');
	});

	test('a removed field stays removed', () => {
		const first = saveAndReopen('character', [custom('Favourite food'), custom('Pet')], true);
		const back = labels(saveAndReopen('character', first.filter((f) => f.label !== 'Pet'), true));
		expect(back).toContain('Favourite food');
		expect(back).not.toContain('Pet');
	});

	test('untouched template fields add nothing to the file', () => {
		const fields = instantiateFields(getKindSpec('character').defaultFields, 'Mandy');
		const keep = emptyFieldsToKeep('character', fields);
		expect(keep.size).toBe(0);
		expect(buildEntityDocument('character', 'Mandy', fields, 'sg_test', undefined, keep)).toBe(
			buildEntityDocument('character', 'Mandy', fields, 'sg_test')
		);
	});

	test('a sheet saved before the fix gets its remembered empty field back', () => {
		// The old writer kept a schema entry for an emptied field with help text,
		// but the parser never brought it back. It does now.
		const doc = [
			'---',
			'storygrid-type: character',
			'storygrid-id: sg_old',
			'cssclasses: [storygrid-sheet, sg-sheet-character]',
			`storygrid-schema: '[{"label":"Manys eyes","type":"text","category":"Test section","prompt":"what color"}]'`,
			'---',
			'',
			'# Mandy',
			'',
		].join('\n');
		const back = parseEntityDocument(doc, 'Mandy').fields.find((f) => f.label === 'Manys eyes');
		expect(back).toMatchObject({ value: '', prompt: 'what color', category: 'Test section' });
	});

	test('a filled field is never doubled by its schema entry', () => {
		const fields = [custom('Manys eyes', 'text', { value: 'blue', prompt: 'what color', category: 'Test section' })];
		const back = saveAndReopen('character', fields, true).filter((f) => f.label === 'Manys eyes');
		expect(back).toHaveLength(1);
		expect(back[0].value).toBe('blue');
	});

	test('an era with event fields added from the list keeps every one of them', () => {
		const era = [
			custom('Date', 'storydate', { value: '1' }),
			custom('How Long', 'select', { value: EVENT_HOW_LONG.era }),
			...getKindSpec('event').defaultFields
				.filter((d) => !['Date', 'How Long'].includes(d.label))
				.map((d) => custom(d.label, d.type, d.config ? { config: { ...d.config } } : {})),
		];
		const back = labels(saveAndReopen('event', era));
		for (const f of era) expect(back).toContain(f.label);
	});

	test('every kind and every field set: one field filled, the rest empty, nothing is lost', () => {
		for (const kind of getCodexKindOrder()) {
			const spec = getKindSpec(kind);
			const sets = [spec.defaultFields, ...(spec.presets ?? []).map((p) => p.fields), ...(spec.extraFieldSets ?? [])];
			for (const set of sets) {
				for (const other of sets) {
					// Fill the first plain field of one set, add the other set's fields empty.
					const fill = set.find((d) => d.type === 'text' || d.type === 'textarea');
					if (!fill) continue;
					const byLabel = new Map<string, CharacterField>();
					for (const d of [...set, ...other]) {
						if (d.type === 'image' || byLabel.has(d.label)) continue;
						byLabel.set(d.label, custom(d.label, d.type, d.config ? { config: { ...d.config } } : {}));
					}
					byLabel.get(fill.label)!.value = 'Filled';
					const fields = [...byLabel.values()];
					for (const clean of [false, true]) {
						const back = labels(saveAndReopen(kind, fields, clean));
						for (const f of fields) expect([kind, clean, f.label, back.includes(f.label)]).toEqual([kind, clean, f.label, true]);
					}
				}
			}
		}
	});

	test('an unknown field type in the schema is skipped, never a crash', () => {
		const doc = [
			'---',
			'storygrid-type: character',
			`storygrid-schema: '[{"label":"Mood","type":"rating","empty":true},{"label":"Pet","type":"text","empty":true}]'`,
			'---',
			'',
			'# Mandy',
		].join('\n');
		const fields = labels(parseEntityDocument(doc, 'Mandy').fields);
		expect(fields).toContain('Pet');
		expect(fields).not.toContain('Mood');
	});
});
