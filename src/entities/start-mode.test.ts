import {
	CLEAN_SLATE_VALUE,
	GUIDED_TEMPLATE,
	START_MODE_KEY,
	defaultTemplateAfterPick,
	rememberDefaultTemplate,
	resolveDefaultTemplate,
	savedTemplatesFor,
	showsTemplatePicker,
	templateOptions,
	asksStartMode,
	cleanSlateFieldSpecs,
	offersStartChoice,
	withStartValues,
	rememberStartMode,
	rememberedStartMode,
} from './start-mode';
import { BuiltinEntityKind, getFieldPrompt, getKindSpec, instantiateFields } from './entity-kinds';
import { buildEntityDocument, buildEntityFrontmatter } from './entity-doc';
import { mergeWithSpecDefaults, parseEntityDocument } from './entity-parse';
import { DEFAULT_SETTINGS } from '../default-settings';
import { mergeSettings } from '../utils/settings-merge';
import { createEntitySheet } from './entity-write';
import { GREGORIAN_CALENDAR, absoluteDayToStoryDate, serializeStoryDate, storyDateToAbsoluteDay } from '../timeline/calendar';
import type { CalendarDef } from '../timeline/timeline-data';
import { classifyEntity } from '../timeline/timeline-events';
import type { App } from 'obsidian';

const BUILTIN_KINDS: BuiltinEntityKind[] = ['character', 'location', 'scene', 'faction', 'system', 'item', 'research', 'event'];

/** What the pop-up's save does to a clean-slate sheet once it exists: one marker line in the frontmatter. */
function stampCleanSlate(doc: string): string {
	return doc.replace(/^---\n/, `---\n${START_MODE_KEY}: ${CLEAN_SLATE_VALUE}\n`);
}

describe('start mode: remember and ask', () => {
	it('starts every kind on the template until the writer picks otherwise', () => {
		expect(rememberedStartMode(undefined, 'character')).toBe('template');
		expect(rememberedStartMode({}, 'location')).toBe('template');
	});

	it('remembers a clean slate per kind, without touching other kinds', () => {
		const saved = rememberStartMode({}, 'character', 'clean');
		expect(rememberedStartMode(saved, 'character')).toBe('clean');
		expect(rememberedStartMode(saved, 'location')).toBe('template');
		expect(rememberedStartMode(rememberStartMode(saved, 'character', 'template'), 'character')).toBe('template');
	});

	it('never mutates the saved record (DEFAULT_SETTINGS must stay clean)', () => {
		const before = { ...DEFAULT_SETTINGS.entityStartMode };
		rememberStartMode(DEFAULT_SETTINGS.entityStartMode, 'character', 'clean');
		expect(DEFAULT_SETTINGS.entityStartMode).toEqual(before);
	});

	it('ignores a value it does not know', () => {
		expect(rememberedStartMode({ character: 'weird' as never }, 'character')).toBe('template');
	});

	it('asks unless the setting is off — existing users have no value yet and are asked', () => {
		expect(asksStartMode(undefined)).toBe(true);
		expect(asksStartMode(true)).toBe(true);
		expect(asksStartMode(false)).toBe(false);
	});

	it('existing users\' saved settings gain the defaults on load', () => {
		const loaded = mergeSettings(DEFAULT_SETTINGS, { codexImagesFolderName: 'Pics' });
		expect(loaded.entityAskStartMode).toBe(true);
		expect(loaded.entityStartMode).toEqual({});
		const kept = mergeSettings(DEFAULT_SETTINGS, { entityAskStartMode: false, entityStartMode: { item: 'clean' } });
		expect(kept.entityAskStartMode).toBe(false);
		expect(rememberedStartMode(kept.entityStartMode, 'item')).toBe('clean');
	});

	it('offers the choice only for a brand-new, empty sheet', () => {
		expect(offersStartChoice(true, 0)).toBe(true);
		expect(offersStartChoice(false, 0)).toBe(false); // editing an existing sheet
		expect(offersStartChoice(true, 3)).toBe(false); // a flow that hands the pop-up its own fields
	});
});

describe('template picker and "make this my default"', () => {
	const saved = [
		{ id: 't1', name: 'My hero sheet', fields: [{}, {}, {}] },
		{ id: 't2', name: 'Quick villain', fields: [{}] },
	];

	it('lists the guided fields first, then presets, then the writer\'s own templates', () => {
		expect(templateOptions('character', 'Guided', saved).map((o) => o.id)).toEqual([GUIDED_TEMPLATE, 'saved:t1', 'saved:t2']);
		const sys = templateOptions('system', 'Guided', []);
		expect(sys[0].id).toBe(GUIDED_TEMPLATE);
		expect(sys.slice(1).map((o) => o.id)).toEqual((getKindSpec('system').presets ?? []).map((p) => `preset:${p.name}`));
	});

	it('is hidden when there is nothing to pick beyond the guided fields', () => {
		expect(showsTemplatePicker(templateOptions('character', 'Guided', []))).toBe(false);
		expect(showsTemplatePicker(templateOptions('character', 'Guided', saved))).toBe(true);
		expect(showsTemplatePicker(templateOptions('system', 'Guided', []))).toBe(true); // built-in presets
		// A saved template with no fields is not a template to start from.
		expect(showsTemplatePicker(templateOptions('character', 'Guided', [{ id: 'e', name: 'Empty', fields: [] }]))).toBe(false);
	});

	it('a default that still exists is used; a deleted one falls back to the guided fields, silently', () => {
		const opts = templateOptions('character', 'Guided', saved);
		expect(resolveDefaultTemplate({ character: 'saved:t2' }, 'character', opts)).toBe('saved:t2');
		expect(resolveDefaultTemplate({ character: 'saved:gone' }, 'character', opts)).toBe(GUIDED_TEMPLATE);
		expect(resolveDefaultTemplate(undefined, 'character', opts)).toBe(GUIDED_TEMPLATE);
		expect(resolveDefaultTemplate({ location: 'saved:t1' }, 'character', opts)).toBe(GUIDED_TEMPLATE);
	});

	it('ticking sets the default; unticking clears it only for the current default', () => {
		expect(defaultTemplateAfterPick('saved:t1', true, undefined)).toBe('saved:t1');
		expect(defaultTemplateAfterPick('saved:t1', false, 'saved:t1')).toBeNull();
		expect(defaultTemplateAfterPick('saved:t2', false, 'saved:t1')).toBeUndefined();
	});

	it('remembering a default never mutates, and the guided fields mean "no default"', () => {
		const before = { character: 'saved:t1' };
		const after = rememberDefaultTemplate(before, 'location', 'saved:t9');
		expect(before).toEqual({ character: 'saved:t1' });
		expect(after).toEqual({ character: 'saved:t1', location: 'saved:t9' });
		expect(rememberDefaultTemplate(after, 'character', null)).toEqual({ location: 'saved:t9' });
		expect(rememberDefaultTemplate(after, 'character', GUIDED_TEMPLATE)).toEqual({ location: 'saved:t9' });
	});

	it('the default survives a restart (saved settings load back) and existing users start with none', () => {
		const reloaded = mergeSettings(DEFAULT_SETTINGS, JSON.parse(JSON.stringify({ entityDefaultTemplate: { character: 'saved:t1' } })));
		expect(reloaded.entityDefaultTemplate).toEqual({ character: 'saved:t1' });
		expect(mergeSettings(DEFAULT_SETTINGS, {}).entityDefaultTemplate).toEqual({});
		expect(DEFAULT_SETTINGS.entityDefaultTemplate).toEqual({});
	});

	it('finds the writer\'s saved templates in the same lists the Codex saves into', () => {
		const settings = mergeSettings(DEFAULT_SETTINGS, {
			characterFieldTemplates: [{ id: 'a', name: 'A', fields: [] }],
			customKindFieldTemplates: { deity: [{ id: 'b', name: 'B', fields: [] }] },
		});
		expect(savedTemplatesFor({ settings }, 'character').map((x) => x.id)).toEqual(['a']);
		expect(savedTemplatesFor({ settings }, 'deity').map((x) => x.id)).toEqual(['b']);
		expect(savedTemplatesFor({ settings }, 'event')).toEqual([]);
		expect(savedTemplatesFor(null, 'character')).toEqual([]);
	});
});

describe('clean slate sheets stay connected', () => {
	it.each(BUILTIN_KINDS)('a clean %s still writes the frontmatter every view reads', (kind) => {
		const fields = instantiateFields(cleanSlateFieldSpecs(kind), 'Mara');
		const fm = buildEntityFrontmatter(kind, fields, 'ent-123', ['M']);
		expect(fm['storygrid-type']).toBe(kind);
		expect(fm['storygrid-id']).toBe('ent-123');
		expect(fm['cssclasses']).toEqual(['storygrid-sheet', `sg-sheet-${kind}`]);
		expect(fm['aliases']).toEqual(['M']);
		const doc = buildEntityDocument(kind, 'Mara', fields, 'ent-123');
		expect(doc).toContain(`storygrid-type: ${kind}`);
		expect(doc).toContain('storygrid-id: ent-123');
		expect(doc).toContain('# Mara');
	});

	it('a clean slate holds only the picture field (and Relationships for characters)', () => {
		expect(cleanSlateFieldSpecs('character').map((f) => f.label)).toEqual(['Portrait', 'Relationships']);
		for (const kind of BUILTIN_KINDS) {
			if (kind === 'event') continue; // its own clean slate: see 'a clean event'
			const specs = cleanSlateFieldSpecs(kind);
			expect(specs.length).toBeLessThan(getKindSpec(kind).defaultFields.length);
			for (const s of specs) expect(s.type === 'image' || s.label === 'Relationships').toBe(true);
		}
	});

	it('round-trips through parse → edit → save without growing the template back or losing anything', () => {
		const fields = instantiateFields(cleanSlateFieldSpecs('character'), 'Mara');
		fields.find((f) => f.label === 'Relationships')!.value = 'Mother: [[Tull]]';
		fields.push({ id: 'c1', label: 'Favourite Song', type: 'text', value: 'Salt and Rope' });
		// Gender comes from the "+ Add field" catalog: a dropdown that stores no schema of its own.
		const gender = getKindSpec('character').defaultFields.find((f) => f.label === 'Gender')!;
		fields.push({ id: 'c2', label: 'Gender', type: gender.type, value: 'Female', config: { ...gender.config } });
		fields.push({ id: 'c3', label: 'Empty Custom', type: 'textarea', value: '' });

		const doc = stampCleanSlate(buildEntityDocument('character', 'Mara', fields, 'ent-9'));
		const parsed = parseEntityDocument(doc, 'Mara');
		expect(parsed.cleanSlate).toBe(true);
		expect(parsed.kind).toBe('character');
		expect(parsed.entityId).toBe('ent-9');
		// The marker is never a field and never something a save may delete.
		expect(parsed.fields.some((f) => f.label.toLowerCase().includes('storygrid'))).toBe(false);
		expect(parsed.ownedKeys).not.toContain(START_MODE_KEY);

		const merged = mergeWithSpecDefaults('character', parsed.fields, parsed.cleanSlate);
		const labels = merged.map((f) => f.label);
		expect(labels).not.toContain('Want');
		expect(labels).not.toContain('Full Name');
		expect(labels).toEqual(expect.arrayContaining(['Relationships', 'Favourite Song', 'Gender', 'Portrait']));
		expect(merged.find((f) => f.label === 'Relationships')!.value).toBe('Mother: [[Tull]]');
		expect(merged.find((f) => f.label === 'Favourite Song')!.value).toBe('Salt and Rope');
		const g = merged.find((f) => f.label === 'Gender')!;
		expect(g.type).toBe(gender.type);
		expect(g.value).toBe('Female');

		// Saving the edit again writes the same sheet back (re-stamped marker survives: not owned).
		const again = stampCleanSlate(buildEntityDocument('character', parsed.name, merged, parsed.entityId ?? undefined));
		const reparsed = parseEntityDocument(again, 'Mara');
		expect(mergeWithSpecDefaults('character', reparsed.fields, reparsed.cleanSlate).map((f) => [f.label, f.value]))
			.toEqual(merged.map((f) => [f.label, f.value]));
	});

	it('an empty clean slate still opens with its own few fields', () => {
		const doc = stampCleanSlate(buildEntityDocument('scene', 'Dawn', [], 'ent-1'));
		const parsed = parseEntityDocument(doc, 'Dawn');
		expect(parsed.cleanSlate).toBe(true);
		expect(mergeWithSpecDefaults('scene', parsed.fields, true).map((f) => f.label))
			.toEqual(cleanSlateFieldSpecs('scene').map((f) => f.label));
	});

	it('template sheets are untouched: no marker, the full template comes back', () => {
		const fields = instantiateFields(getKindSpec('character').defaultFields, 'Mara');
		const parsed = parseEntityDocument(buildEntityDocument('character', 'Mara', fields, 'ent-2'), 'Mara');
		expect(parsed.cleanSlate).toBe(false);
		expect(mergeWithSpecDefaults('character', parsed.fields, parsed.cleanSlate).map((f) => f.label))
			.toEqual(getKindSpec('character').defaultFields.map((f) => f.label));
	});

	it('a new sheet gets the marker in the same single frontmatter write as its id — template sheets never do', async () => {
		for (const cleanSlate of [true, false]) {
			const fm: Record<string, unknown> = {};
			let writes = 0;
			const app = {
				vault: { create: async () => ({ path: 'C/Mara.md' }) },
				fileManager: { processFrontMatter: async (_f: unknown, fn: (fm: Record<string, unknown>) => void) => { writes++; fn(fm); } },
			} as unknown as App;
			await createEntitySheet(app, 'C/Mara.md', 'character', 'Mara', [], { cleanSlate });
			expect(writes).toBe(1);
			expect(fm['storygrid-type']).toBe('character');
			expect(fm['storygrid-id']).toBeTruthy();
			expect(fm[START_MODE_KEY]).toBe(cleanSlate ? CLEAN_SLATE_VALUE : undefined);
		}
	});

	it('reads the marker however Obsidian quotes it', () => {
		for (const v of [CLEAN_SLATE_VALUE, `'${CLEAN_SLATE_VALUE}'`, `"${CLEAN_SLATE_VALUE}"`]) {
			const doc = buildEntityDocument('item', 'Key', [], 'x').replace(/^---\n/, `---\n${START_MODE_KEY}: ${v}\n`);
			expect(parseEntityDocument(doc, 'Key').cleanSlate).toBe(true);
		}
	});
});

describe('a clean event on the Timeline', () => {
	const ages: CalendarDef = {
		id: 'ages',
		name: 'Ages of the World',
		months: [{ name: 'Frost', days: 20 }, { name: 'Thaw', days: 35 }, { name: 'Ember', days: 30 }],
		eras: [
			{ name: 'First Age', startYear: 1, resetsYearTo1: true },
			{ name: 'Second Age', startYear: 101, resetsYearTo1: true },
		],
	};

	it('has exactly Date, How Long, End Date and Description — the name is its title', () => {
		const specs = cleanSlateFieldSpecs('event');
		expect(specs.map((f) => [f.label, f.type])).toEqual([
			['Date', 'storydate'],
			['How Long', 'select'],
			['End Date', 'storydate'],
			['Description', 'textarea'],
		]);
		// Every one of them has a question to show in the empty box.
		for (const s of specs) expect(getFieldPrompt('event', s.label)).not.toBe('');
	});

	it('keeps its four fields after a save and an edit', () => {
		const doc = stampCleanSlate(buildEntityDocument('event', 'The Flood', instantiateFields(cleanSlateFieldSpecs('event'), 'The Flood'), 'ent-7'));
		const parsed = parseEntityDocument(doc, 'The Flood');
		expect(parsed.cleanSlate).toBe(true);
		expect(mergeWithSpecDefaults('event', parsed.fields, true).map((f) => f.label)).toEqual(['Date', 'How Long', 'End Date', 'Description']);
	});

	it('pre-fills the clicked date into the empty Date field, and nothing else', () => {
		const date = serializeStoryDate({ year: 940, month: 3, day: 12 });
		const fields = withStartValues('event', instantiateFields(cleanSlateFieldSpecs('event'), ''), { Date: date });
		expect(fields.map((f) => [f.label, f.value])).toEqual([['Date', date], ['How Long', ''], ['End Date', ''], ['Description', '']]);
	});

	it('pre-fills the guided template too, and never overwrites a date already there', () => {
		const date = serializeStoryDate({ year: 1 });
		const guided = withStartValues('event', instantiateFields(getKindSpec('event').defaultFields, ''), { Date: date });
		expect(guided.find((f) => f.label === 'Date')!.value).toBe(date);
		expect(guided).toHaveLength(getKindSpec('event').defaultFields.length);
		const kept = withStartValues('event', guided, { Date: serializeStoryDate({ year: 2 }) });
		expect(kept.find((f) => f.label === 'Date')!.value).toBe(date);
	});

	it('adds a Date field when the chosen template has none, and skips labels the kind does not know', () => {
		const date = serializeStoryDate({ year: 5 });
		const fields = withStartValues('event', [{ id: 'x', label: 'Mood', type: 'text', value: '' }], { Date: date, Nonsense: 'x', 'End Date': '' });
		expect(fields.map((f) => [f.label, f.type, f.value])).toEqual([['Mood', 'text', ''], ['Date', 'storydate', date]]);
	});

	it('never changes the fields it was given', () => {
		const before = instantiateFields(cleanSlateFieldSpecs('event'), '');
		withStartValues('event', before, { Date: serializeStoryDate({ year: 9 }) });
		expect(before.every((f) => f.value === '')).toBe(true);
	});

	it.each([
		['Gregorian', GREGORIAN_CALENDAR, 740_000],
		['a custom calendar with year-resetting eras', ages, 130 * 85 + 47],
	] as const)('a date clicked on the axis lands back on the same day (%s)', (_name, calendar, day) => {
		const clicked = absoluteDayToStoryDate(calendar, day);
		const fields = withStartValues('event', instantiateFields(cleanSlateFieldSpecs('event'), 'The Flood'), { Date: serializeStoryDate(clicked) });
		const fm = buildEntityFrontmatter('event', fields, 'ent-1', []);
		const result = classifyEntity(fm['storygrid-type'], fm['date'], undefined, undefined, fm['end-date'], calendar);
		expect(result.bucket).toBe('dated-event');
		if (result.bucket !== 'dated-event') return;
		expect(storyDateToAbsoluteDay(calendar, result.date)).toBe(day);
	});

	it('an event saved with no date is still a sheet, but sits off the axis', () => {
		const fields = instantiateFields(cleanSlateFieldSpecs('event'), 'Someday');
		const fm = buildEntityFrontmatter('event', fields, 'ent-2', []);
		expect(fm['storygrid-type']).toBe('event');
		expect(classifyEntity(fm['storygrid-type'], fm['date'], undefined, undefined, fm['end-date']).bucket).toBe('undated-event');
	});
});

describe('"Add era" on the Timeline: an Event sheet with How Long = "An era" (2026-11-03)', () => {
	const { ERA_SHEET, EVENT_HOW_LONG } = jest.requireActual('./entity-kinds');
	const eraStart = { 'How Long': EVENT_HOW_LONG.era };

	it('a clean-slate era is Date, How Long (preset to "An era"), End Date, Color and Description', () => {
		const fields = withStartValues('event', instantiateFields(ERA_SHEET.cleanSlateFields, ''), eraStart);
		expect(fields.map((f) => [f.label, f.type, f.value])).toEqual([
			['Date', 'storydate', ''],
			['How Long', 'select', 'An era'],
			['End Date', 'storydate', ''],
			['Color', 'color', ''],
			['Description', 'textarea', ''],
		]);
		for (const f of fields) expect(f.prompt).not.toBe('');
	});

	it('a clean-slate era keeps its fields and stays an era after a save and an edit', () => {
		const fields = withStartValues('event', instantiateFields(ERA_SHEET.cleanSlateFields, 'The Drowned Years'), eraStart);
		fields.find((f) => f.label === 'Date')!.value = serializeStoryDate({ year: 1210 });
		fields.find((f) => f.label === 'Color')!.value = '#7fa7d9';
		const doc = stampCleanSlate(buildEntityDocument('event', 'The Drowned Years', fields, 'ent-era'));
		const parsed = parseEntityDocument(doc, 'The Drowned Years');
		const merged = mergeWithSpecDefaults('event', parsed.fields, parsed.cleanSlate);
		// An empty End Date is not written, so the edit adds it back after the others.
		expect(merged.map((f) => f.label).sort()).toEqual(['Color', 'Date', 'Description', 'End Date', 'How Long']);
		expect(merged.find((f) => f.label === 'Color')).toMatchObject({ type: 'color', value: '#7fa7d9' });
		const fm = buildEntityFrontmatter('event', merged, 'ent-era', []);
		expect(fm['how-long']).toBe('An era');
		expect(classifyEntity(fm['storygrid-type'], fm['date'], undefined, undefined, fm['end-date'], GREGORIAN_CALENDAR, fm['how-long']))
			.toMatchObject({ bucket: 'dated-event', era: true, ongoing: true });
	});

	it('a guided era is edited as an era — the Event template\'s own fields never grow back', () => {
		const fields = withStartValues('event', instantiateFields(ERA_SHEET.guidedFields, 'Before the Flood'), eraStart);
		fields.find((f) => f.label === 'What Defines This Age')!.value = 'The levies hold.';
		const doc = buildEntityDocument('event', 'Before the Flood', fields, 'ent-era2');
		const parsed = parseEntityDocument(doc, 'Before the Flood');
		const labels = mergeWithSpecDefaults('event', parsed.fields).map((f) => f.label);
		expect(labels).toEqual(ERA_SHEET.guidedFields.map((f: { label: string }) => f.label));
		expect(labels).not.toContain('Location');
		expect(getFieldPrompt('event', 'How It Ends')).not.toBe('');
	});

	it('switching an era back to an event is just its How Long — the sheet keeps everything else', () => {
		const fields = withStartValues('event', instantiateFields(ERA_SHEET.cleanSlateFields, 'X'), eraStart);
		fields.find((f) => f.label === 'Date')!.value = serializeStoryDate({ year: 1210 });
		fields.find((f) => f.label === 'How Long')!.value = EVENT_HOW_LONG.lasting;
		const fm = buildEntityFrontmatter('event', fields, 'ent-x', []);
		expect(classifyEntity('event', fm['date'], undefined, undefined, fm['end-date'], GREGORIAN_CALENDAR, fm['how-long'])).not.toHaveProperty('era');
	});

	it('How Long offers all three, in order', () => {
		const howLong = getKindSpec('event').defaultFields.find((f) => f.label === 'How Long');
		expect(howLong?.config?.options).toEqual(['A moment', 'Lasts a while', 'An era']);
	});
});

describe('a clean-slate era with an empty Color (review fix, 2026-11-04)', () => {
	it('keeps its Color row after a save and an edit, so a colour can still be picked later', () => {
		const { ERA_SHEET, EVENT_HOW_LONG } = jest.requireActual('./entity-kinds');
		const fields = withStartValues('event', instantiateFields(ERA_SHEET.cleanSlateFields, 'Quiet Age'), { 'How Long': EVENT_HOW_LONG.era });
		fields.find((f) => f.label === 'Date')!.value = serializeStoryDate({ year: 900 });
		const doc = stampCleanSlate(buildEntityDocument('event', 'Quiet Age', fields, 'ent-q'));
		const parsed = parseEntityDocument(doc, 'Quiet Age');
		const merged = mergeWithSpecDefaults('event', parsed.fields, parsed.cleanSlate);
		expect(merged.find((f) => f.label === 'Color')).toMatchObject({ type: 'color', value: '' });
		// A plain clean-slate event still gets only its own four.
		const ev = stampCleanSlate(buildEntityDocument('event', 'Flood', instantiateFields(cleanSlateFieldSpecs('event'), 'Flood'), 'ent-f'));
		expect(mergeWithSpecDefaults('event', parseEntityDocument(ev, 'Flood').fields, true).map((f) => f.label)).not.toContain('Color');
	});
});
