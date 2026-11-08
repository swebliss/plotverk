import {
	writeSheetImages,
	appendAlias,
	applyEntityEdits,
	applyOwnedFrontmatter,
	FieldSnapshot,
	mergeSheetCssClasses,
	planFieldWrites,
	editRelationshipsField,
	relationshipsFrontmatterValue,
	retitleDocument,
} from './entity-write';
import { buildEntityBody, buildEntityDocument, buildEntityFrontmatter } from './entity-doc';
import { toYamlValue } from './field-types';
import { mergeWithSpecDefaults, parseEntityDocument } from './entity-parse';
import { CharacterField } from '../grid-data';
import { getKindSpec, instantiateFields } from './entity-kinds';
import { RelationLine, parseRelationLines } from '../utils/relations';
import { applyMirrorEdit, relabelForGender } from '../utils/relation-mirror';

function field(overrides: Partial<CharacterField> & Pick<CharacterField, 'label' | 'type' | 'value'>): CharacterField {
	return { id: `id-${overrides.label}`, ...overrides };
}

describe('toYamlValue — native values for processFrontMatter', () => {
	test('scalars keep their real YAML type', () => {
		expect(toYamlValue('text', 'Mara Venn')).toBe('Mara Venn');
		expect(toYamlValue('number', '27')).toBe(27);
		expect(toYamlValue('slider', '62')).toBe(62);
		expect(toYamlValue('checkbox', 'true')).toBe(true);
		expect(toYamlValue('checkbox', 'false')).toBe(false);
		expect(toYamlValue('date', '2026-07-30')).toBe('2026-07-30');
		expect(toYamlValue('color', '#7C69C8')).toBe('#7C69C8');
	});

	test('collections come out as real arrays and maps, not YAML source text', () => {
		expect(toYamlValue('tags', 'brave, loyal')).toEqual(['brave', 'loyal']);
		expect(toYamlValue('list', 'Sword\nRope')).toEqual(['Sword', 'Rope']);
		expect(toYamlValue('matrix', '62,-30')).toEqual({ x: 62, y: -30 });
		expect(
			toYamlValue('table', JSON.stringify([['Ada', 'pilot'], ['Bo', 'cook']]), { columns: ['Name', 'Role'] })
		).toEqual([{ Name: 'Ada', Role: 'pilot' }, { Name: 'Bo', Role: 'cook' }]);
	});

	test('a value that cannot break the block is no longer escaped by us', () => {
		// The old writer produced `key: "C:\"`, where the trailing backslash
		// escaped the closing quote and destroyed the whole frontmatter block.
		expect(toYamlValue('text', 'C:\\')).toBe('C:\\');
		expect(toYamlValue('text', 'She said "hi"')).toBe('She said "hi"');
	});

	test('nothing to store means no key at all', () => {
		expect(toYamlValue('image', 'Portraits/mara.png')).toBeUndefined();
		expect(toYamlValue('text', '   ')).toBeUndefined();
		expect(toYamlValue('number', 'not a number')).toBeUndefined();
		expect(toYamlValue('list', '\n  \n')).toBeUndefined();
	});

	test('a textarea belongs in frontmatter here, unlike in the source encoder', () => {
		// encodeYamlValue returns null for textarea because the document builder
		// handles text and textarea in its own branch first. There is no second
		// branch on this side, so the rule lives here.
		expect(toYamlValue('textarea', 'Raised on the docks.')).toBe('Raised on the docks.');
	});
});

describe('buildEntityFrontmatter', () => {
	const fields = [
		field({ label: 'Full Name', type: 'text', value: 'Mara Venn' }),
		field({ label: 'Portrait', type: 'image', value: 'Portraits/mara.png' }),
		field({ label: 'Traits', type: 'tags', value: 'brave, loyal' }),
		field({ label: 'Notes', type: 'textarea', value: '' }),
	];

	test('carries the sheet keys Plotverk owns', () => {
		const fm = buildEntityFrontmatter('character', fields, 'sg_abc123', ['the smuggler']);
		expect(fm['storygrid-type']).toBe('character');
		expect(fm['storygrid-id']).toBe('sg_abc123');
		expect(fm['aliases']).toEqual(['the smuggler']);
		expect(fm['cssclasses']).toEqual(['storygrid-sheet', 'sg-sheet-character']);
		expect(fm['full-name']).toBe('Mara Venn');
		expect(fm['traits']).toEqual(['brave', 'loyal']);
	});

	test('omits images, empty fields, and absent optionals', () => {
		const fm = buildEntityFrontmatter('character', fields);
		expect(fm).not.toHaveProperty('portrait');
		expect(fm).not.toHaveProperty('notes');
		expect(fm).not.toHaveProperty('storygrid-id');
		expect(fm).not.toHaveProperty('aliases');
	});

	test('the schema sidecar is plain JSON — the quoting is Obsidian\'s job now', () => {
		const fm = buildEntityFrontmatter('character', [
			field({ label: 'Charisma', type: 'slider', value: '62', config: { min: 0, max: 100, step: 1 } }),
		]);
		const schema = JSON.parse(String(fm['storygrid-schema'])) as Array<{ label: string; type: string }>;
		expect(schema[0].label).toBe('Charisma');
		expect(schema[0].type).toBe('slider');
	});

	test('two labels that slug the same still get one key each', () => {
		const fm = buildEntityFrontmatter('character', [
			field({ label: 'Age?', type: 'text', value: 'Thirty-one' }),
			field({ label: 'Age!', type: 'text', value: 'Old enough' }),
		]);
		expect(fm['age']).toBe('Thirty-one');
		expect(fm['age-2']).toBe('Old enough');
	});
});

describe('the two writers cannot drift', () => {
	const fields = [
		field({ label: 'Full Name', type: 'text', value: 'Mara Venn' }),
		field({ label: 'Portrait', type: 'image', value: 'Portraits/mara.png' }),
		field({ label: 'Traits', type: 'tags', value: 'brave, loyal' }),
		field({ label: 'Charisma', type: 'slider', value: '62', config: { min: 0, max: 100, step: 1 } }),
		field({ label: 'Backstory', type: 'textarea', value: 'Raised on the docks.' }),
	];

	const documentKeys = (doc: string): string[] => {
		const close = doc.indexOf('\n---\n', 4);
		return doc
			.slice(4, close)
			.split('\n')
			.map((line) => line.match(/^([A-Za-z0-9_-]+):/))
			.filter((m): m is RegExpMatchArray => m !== null)
			.map((m) => m[1]);
	};

	test('the same keys, in the same order, whoever writes them', () => {
		const doc = buildEntityDocument('character', 'Mara Venn', fields, 'sg_abc123', ['the smuggler']);
		const fm = buildEntityFrontmatter('character', fields, 'sg_abc123', ['the smuggler']);
		expect(documentKeys(doc)).toEqual(Object.keys(fm));
	});

	test('the document is still exactly its frontmatter plus its body', () => {
		const doc = buildEntityDocument('character', 'Mara Venn', fields, 'sg_abc123');
		const close = doc.indexOf('\n---\n', 4);
		expect(doc.slice(close + '\n---\n\n'.length)).toBe(buildEntityBody('character', 'Mara Venn', fields));
	});
});

describe('applyOwnedFrontmatter', () => {
	test('writes our keys onto a sheet that has none', () => {
		const fm: Record<string, unknown> = {};
		applyOwnedFrontmatter(fm, { 'storygrid-type': 'character', 'full-name': 'Mara' });
		expect(fm).toEqual({ 'storygrid-type': 'character', 'full-name': 'Mara' });
	});

	test('leaves keys we did not write completely alone', () => {
		// The audit finding this closes: a save wiped the writer's own `tags:`
		// and anything another plugin had stamped on the sheet.
		const fm: Record<string, unknown> = {
			tags: ['reading-list'],
			'dataview-progress': 40,
			'full-name': 'Mara',
		};
		applyOwnedFrontmatter(fm, { 'full-name': 'Mara Venn' });
		expect(fm['tags']).toEqual(['reading-list']);
		expect(fm['dataview-progress']).toBe(40);
		expect(fm['full-name']).toBe('Mara Venn');
	});

	test('removes a key only when told it used to be ours and is now gone', () => {
		const fm: Record<string, unknown> = { 'full-name': 'Mara', nickname: 'Tide', tags: ['keep-me'] };
		applyOwnedFrontmatter(fm, { 'full-name': 'Mara' }, ['full-name', 'nickname', 'tags']);
		expect(fm).not.toHaveProperty('nickname'); // named as ours, no longer written
		expect(fm['full-name']).toBe('Mara');
		// `tags` was named too — a sheet whose Tags field really was deleted.
		expect(fm).not.toHaveProperty('tags');
	});

	test('an unnamed key survives even when it looks like one of ours', () => {
		const fm: Record<string, unknown> = { 'full-name': 'Mara', age: '31' };
		applyOwnedFrontmatter(fm, { 'full-name': 'Mara' });
		expect(fm['age']).toBe('31');
	});
});

describe('mergeSheetCssClasses', () => {
	const ours = ['storygrid-sheet', 'sg-sheet-character'];

	test('a fresh sheet just gets ours', () => {
		expect(mergeSheetCssClasses(undefined, ours)).toEqual(ours);
	});

	test("keeps the writer's own classes", () => {
		expect(mergeSheetCssClasses(['storygrid-sheet', 'sg-sheet-character', 'wide-table'], ours))
			.toEqual([...ours, 'wide-table']);
	});

	test('drops our stale class when the kind changes', () => {
		expect(mergeSheetCssClasses(['storygrid-sheet', 'sg-sheet-character'], ['storygrid-sheet', 'sg-sheet-location']))
			.toEqual(['storygrid-sheet', 'sg-sheet-location']);
	});

	test('a single string value is a list of one', () => {
		expect(mergeSheetCssClasses('wide-table', ours)).toEqual([...ours, 'wide-table']);
	});

	test('saving twice does not reshuffle the list', () => {
		const once = mergeSheetCssClasses(['wide-table'], ours);
		expect(mergeSheetCssClasses(once, ours)).toEqual(once);
	});
});

describe('retitleDocument — a rename is one line, not a rebuild', () => {
	// A sheet the old rename would have flattened: user frontmatter keys, an ID,
	// aliases, hand-written prose, a code fence hiding a fake heading, a nested
	// callout, and a thematic break.
	const mangled = [
		'---',
		'storygrid-type: character',
		'storygrid-id: sg_keepme',
		'aliases:',
		'  - the smuggler',
		'tags: [reading-list]',
		'---',
		'',
		'# Mara Venn',
		'',
		'> [!character|sg-infobox] Character',
		'>',
		'> | Field | Value |',
		'> | --- | --- |',
		'> | **Role** | Protagonist |',
		'',
		'Loose prose the writer typed by hand.',
		'',
		'## Backstory',
		'',
		'```md',
		'## Not a real section',
		'```',
		'',
		'---',
		'',
		'> [!note] A callout of the writer\'s own.',
		'',
	].join('\n');

	test('changes exactly the H1 line and nothing else', () => {
		expect(retitleDocument(mangled, 'Mara Tide'))
			.toBe(mangled.replace('# Mara Venn', '# Mara Tide'));
	});

	test('the same name is a byte-exact no-op', () => {
		expect(retitleDocument(mangled, 'Mara Venn')).toBe(mangled);
	});

	test('a document with no frontmatter still retitles cleanly', () => {
		const doc = '# Old Name\n\nProse.\n';
		expect(retitleDocument(doc, 'New Name')).toBe('# New Name\n\nProse.\n');
	});

	test('a document with no H1 gains one at the top', () => {
		const doc = '---\nstorygrid-type: character\n---\nJust prose.\n';
		expect(retitleDocument(doc, 'Mara'))
			.toBe('---\nstorygrid-type: character\n---\n# Mara\n\nJust prose.\n');
	});

	test('CRLF documents keep their line endings', () => {
		const doc = '---\r\nkey: v\r\n---\r\n\r\n# Old\r\n\r\nProse.\r\n';
		expect(retitleDocument(doc, 'New')).toBe('---\r\nkey: v\r\n---\r\n\r\n# New\r\n\r\nProse.\r\n');
	});
});

describe('appendAlias — frontmatter aliases in every shape Obsidian hands us', () => {
	test('absent becomes a list of one', () => {
		expect(appendAlias(undefined, 'the smuggler')).toEqual(['the smuggler']);
	});

	test('a single string value becomes a list of two', () => {
		expect(appendAlias('the tide', 'the smuggler')).toEqual(['the tide', 'the smuggler']);
	});

	test('a list is appended to, in order', () => {
		expect(appendAlias(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
	});

	test('an alias already present means no write at all', () => {
		expect(appendAlias(['the smuggler'], 'the smuggler')).toBeNull();
		expect(appendAlias('the smuggler', 'the smuggler')).toBeNull();
	});

	test('entries that are not strings survive — we never drop what we did not write', () => {
		// `aliases: [42]` parses to a number; rewriting the list must not lose it.
		expect(appendAlias([42, 'the tide'], 'the smuggler')).toEqual([42, 'the tide', 'the smuggler']);
	});

	test('a blank string value counts as absent', () => {
		expect(appendAlias('   ', 'the smuggler')).toEqual(['the smuggler']);
	});
});

// ── The preserving Edit-sheet save ──────────────────────────────────────────

const snap = (f: Pick<CharacterField, 'id' | 'label' | 'type'>): FieldSnapshot =>
	({ id: f.id, label: f.label, type: f.type });

describe('planFieldWrites', () => {
	const before: FieldSnapshot[] = [
		{ id: 'a', label: 'Full Name', type: 'text' },
		{ id: 'b', label: 'Backstory', type: 'textarea' },
		{ id: 'p1', label: 'Portrait', type: 'image' },
		{ id: 'p2', label: 'Portrait 2', type: 'image' },
	];

	test('a kept field passes through, no clears', () => {
		const after = [
			field({ id: 'a', label: 'Full Name', type: 'text', value: 'Mara' } as CharacterField),
			field({ id: 'b', label: 'Backstory', type: 'textarea', value: 'Docks.' } as CharacterField),
			field({ id: 'p1', label: 'Portrait', type: 'image', value: 'a.png' } as CharacterField),
			field({ id: 'p2', label: 'Portrait 2', type: 'image', value: 'b.png' } as CharacterField),
		];
		expect(planFieldWrites(before, after)).toEqual(after);
	});

	test('a deleted field becomes an explicit empty-valued clear, ahead of the writes', () => {
		const after = [field({ id: 'a', label: 'Full Name', type: 'text', value: 'Mara' } as CharacterField)];
		const writes = planFieldWrites(before.slice(0, 2), after);
		expect(writes[0]).toMatchObject({ label: 'Backstory', type: 'textarea', value: '' });
		expect(writes[1]).toBe(after[0]);
	});

	test('a relabel clears the old label so the new one cannot duplicate it', () => {
		const after = [field({ id: 'b', label: 'History', type: 'textarea', value: 'Docks.' } as CharacterField)];
		const writes = planFieldWrites([before[1]], after);
		expect(writes[0]).toMatchObject({ label: 'Backstory', value: '' });
		expect(writes[1]).toMatchObject({ label: 'History', value: 'Docks.' });
	});

	test('a case-only relabel edits in place — no clear', () => {
		const after = [field({ id: 'a', label: 'FULL NAME', type: 'text', value: 'Mara' } as CharacterField)];
		expect(planFieldWrites([before[0]], after)).toEqual(after);
	});

	test('a field moved to another body home clears its old one', () => {
		// text lives in an infobox row; textarea lives in a section. Same label,
		// but the old row must go or it lingers with the stale value.
		const after = [field({ id: 'a', label: 'Full Name', type: 'textarea', value: 'Mara, at length.' } as CharacterField)];
		const writes = planFieldWrites([before[0]], after);
		expect(writes[0]).toMatchObject({ label: 'Full Name', type: 'text', value: '' });
	});

	test('images keep parse order: deletions hold their slot, new ones append', () => {
		const after = [
			field({ id: 'p2', label: 'Portrait 2', type: 'image', value: 'b.png' } as CharacterField),
			field({ id: 'p3', label: 'Portrait 3', type: 'image', value: 'c.png' } as CharacterField),
		];
		const writes = planFieldWrites(before.slice(2), after).filter((f) => f.type === 'image');
		expect(writes.map((f) => f.value)).toEqual(['', 'b.png', 'c.png']);
	});
});

describe('applyEntityEdits — verified against a hand-mangled sheet', () => {
	const BACKSTORY_SECTION = [
		'## Backstory',
		'',
		'Raised on the docks.',
		'',
		'```md',
		'## Not a heading',
		'```',
		'',
	].join('\n');

	const MANGLED = [
		'---',
		'storygrid-type: character',
		'storygrid-id: sg_keep',
		'tags: [reading-list]',
		'full-name: "Mara Vale"',
		'---',
		'',
		'# Mara',
		'',
		'Loose prose the builder knows nothing about.',
		'',
		'> [!character|sg-infobox] Character',
		'> ![[Portraits/mara.png]]',
		'>',
		'> | Field | Value |',
		'> | --- | --- |',
		'> | **Full Name** | Mara Vale |',
		'',
		'> [!warning] Hand-made callout',
		'> Spoilers within.',
		'',
		BACKSTORY_SECTION,
	].join('\n');

	/** Parse → snapshot → (edit) → plan → apply: the full Edit-sheet save, minus Obsidian. */
	function save(doc: string, edit?: (fields: CharacterField[]) => CharacterField[]): string {
		const parsed = parseEntityDocument(doc, 'Mara');
		const merged = mergeWithSpecDefaults(parsed.kind ?? 'character', parsed.fields);
		const before = merged.map(snap);
		const after = edit ? edit(merged) : merged;
		return applyEntityEdits(doc, parsed.kind ?? 'character', parsed.name, planFieldWrites(before, after));
	}

	test('a save that changes nothing is byte-exact', () => {
		expect(save(MANGLED)).toBe(MANGLED);
	});

	test('editing one fact changes exactly that row', () => {
		const edit = (fs: CharacterField[]) =>
			fs.map((f) => (f.label === 'Full Name' ? { ...f, value: 'Mara Valeria' } : f));
		expect(save(MANGLED, edit)).toBe(MANGLED.replace('| Mara Vale |', '| Mara Valeria |'));
	});

	test('deleting a field removes its section and nothing else', () => {
		const edit = (fs: CharacterField[]) => fs.filter((f) => f.label !== 'Backstory');
		expect(save(MANGLED, edit)).toBe(MANGLED.replace(BACKSTORY_SECTION, ''));
	});

	test('relabeling a field moves its whole content, fence included', () => {
		const edit = (fs: CharacterField[]) =>
			fs.map((f) => (f.label === 'Backstory' ? { ...f, label: 'History' } : f));
		const out = save(MANGLED, edit);
		expect(out).not.toContain('## Backstory');
		expect(out).toContain('## History');
		expect(out).toContain('## Not a heading');
		expect(out).toContain('Hand-made callout');
	});

	test('the round trip: what was saved is what parses back', () => {
		const edit = (fs: CharacterField[]) =>
			fs.map((f) => (f.label === 'Full Name' ? { ...f, value: 'Mara Valeria' } : f));
		// applyEntityEdits is only the body half of updateEntitySheet. For a
		// scalar the parser's source of truth is the frontmatter, which the real
		// save updates through processFrontMatter — emulate that rewrite here.
		const fullSave = save(MANGLED, edit)
			.replace('full-name: "Mara Vale"', 'full-name: Mara Valeria');
		const reparsed = parseEntityDocument(fullSave, 'Mara');
		expect(reparsed.fields.find((f) => f.label === 'Full Name')?.value).toBe('Mara Valeria');
		expect(reparsed.entityId).toBe('sg_keep');
	});

	test('upgrading a bare legacy sheet adds structure without touching its prose', () => {
		// The upgradeCodexSheets path: a no-change save over a sheet that
		// predates the infobox layout materializes the missing structure.
		const legacy = [
			'---',
			'storygrid-type: character',
			'full-name: Mara',
			'---',
			'',
			'# Mara',
			'',
			'Loose prose from the old days.',
			'',
		].join('\n');
		const out = save(legacy);
		expect(out).toContain('|sg-infobox]');
		expect(out).toContain('| **Full Name** | Mara |');
		expect(out).toContain('Loose prose from the old days.');
	});

	test('frontmatter cleanup composes: a deleted field loses its key, the user keeps theirs', () => {
		const parsed = parseEntityDocument(MANGLED, 'Mara');
		const kept = parsed.fields.filter((f) => f.label !== 'Full Name');
		const owned = buildEntityFrontmatter('character', kept, parsed.entityId ?? undefined);
		const fm: Record<string, unknown> = {
			'storygrid-type': 'character',
			'storygrid-id': 'sg_keep',
			tags: ['reading-list'],
			'full-name': 'Mara Vale',
		};
		applyOwnedFrontmatter(fm, owned, parsed.ownedKeys);
		expect(fm).not.toHaveProperty('full-name');
		expect(fm['tags']).toEqual(['reading-list']);
		expect(fm['storygrid-id']).toBe('sg_keep');
	});
});

describe('editRelationshipsField — the other sheet follows, nothing else moves', () => {
	const tull = [
		'---',
		'storygrid-type: character',
		'full-name: "Grandmother Tull"',
		'role: "Family matriarch"',
		'relationships: |',
		'  Grandchild: [[Tobin Ferrow]]',
		'  Ward: [[Bex Ferrow-Tull]]',
		'storygrid-id: sg_demo0000b',
		'---',
		'',
		'# Grandmother Tull',
		'',
		'> [!info|sg-infobox] Character at a Glance',
		'>',
		'> | Field | Value |',
		'> | --- | --- |',
		'> | **Full Name** | Grandmother Tull |',
		'> | **Role** | Family matriarch |',
		'',
		'## Backstory',
		'',
		'Married into the Ferrows at seventeen. Took [[Mara Ferrow]] in after the flood.',
		'',
		'## Relationships',
		'',
		'Grandchild: [[Tobin Ferrow]]',
		'Ward: [[Bex Ferrow-Tull]]',
		'',
		'## Notes',
		'',
		'Kept apart on purpose.',
		'',
	].join('\n');

	const add = (line: string) => (v: string) => `${v.trimEnd()}\n${line}`;

	test('adds the line to the Relationships section and reports the frontmatter half', () => {
		const r = editRelationshipsField(tull, 'Grandmother Tull', add('Grandchild: [[Mara Ferrow]]'))!;
		expect(r.key).toBe('relationships');
		expect(r.value).toBe('Grandchild: [[Tobin Ferrow]]\nWard: [[Bex Ferrow-Tull]]\nGrandchild: [[Mara Ferrow]]');
		// Only the Relationships section changed — frontmatter, title, infobox, other sections byte-exact.
		expect(r.content).toBe(tull.replace('Ward: [[Bex Ferrow-Tull]]\n\n## Notes', 'Ward: [[Bex Ferrow-Tull]]\nGrandchild: [[Mara Ferrow]]\n\n## Notes'));
		// And the parser reads the new line back.
		expect(parseEntityDocument(r.content, 'Grandmother Tull').fields.find((f) => f.label === 'Relationships')?.value)
			.toContain('Grandchild: [[Mara Ferrow]]');
	});

	test('hands the lines from other sections to the edit, so they are not duplicated', () => {
		let seen: string[] = [];
		editRelationshipsField(tull, 'Grandmother Tull', (v, elsewhere) => { seen = elsewhere.map((r) => `${r.label}|${r.target}`); return v; });
		expect(seen).toContain('|Mara Ferrow');
		expect(seen).not.toContain('Ward|Bex Ferrow-Tull');
	});

	test('no change → null (nothing is written)', () => {
		expect(editRelationshipsField(tull, 'Grandmother Tull', (v) => v)).toBeNull();
	});

	test('not a Plotverk sheet → null', () => {
		expect(editRelationshipsField('# Just a note\n\nGrandchild: [[Mara]]\n', 'Note', add('x: [[y]]'))).toBeNull();
	});

	test('removing the last line removes the section and empties the value', () => {
		const one = tull.replace('Grandchild: [[Tobin Ferrow]]\nWard', 'Ward').replace('  Grandchild: [[Tobin Ferrow]]\n', '');
		const r = editRelationshipsField(one, 'Grandmother Tull', () => '')!;
		expect(r.value).toBe('');
		expect(r.content).not.toContain('## Relationships');
		expect(r.content).toContain('## Notes\n\nKept apart on purpose.');
	});

	test('a sheet without a Relationships field gets one', () => {
		const bare = tull.replace(/## Relationships\n\nGrandchild: \[\[Tobin Ferrow\]\]\nWard: \[\[Bex Ferrow-Tull\]\]\n\n/, '')
			.replace(/relationships: \|\n  Grandchild: \[\[Tobin Ferrow\]\]\n  Ward: \[\[Bex Ferrow-Tull\]\]\n/, '');
		const r = editRelationshipsField(bare, 'Grandmother Tull', () => 'Grandchild: [[Mara Ferrow]]')!;
		expect(r.key).toBe('relationships');
		expect(r.content).toContain('## Relationships\n\nGrandchild: [[Mara Ferrow]]');
		expect(r.content.startsWith(bare.slice(0, bare.indexOf('## Notes')))).toBe(true);
	});
});

describe('a mirrored write leaves both halves saying the same lines', () => {
	// Halvard's sheet as the pre-2026-11-03 plugin left it: a mirrored line in the
	// body (right under the heading) that the frontmatter never got.
	const drifted = [
		'---',
		'storygrid-type: character',
		'relationships: |',
		'  Rival: [[Mara Ferrow]]',
		'  Employs: [[Wrenna Sull]]',
		'storygrid-id: sg_demo00003',
		'---',
		'',
		'# Halvard Crane',
		'',
		'## Relationships',
		'',
		'Ex-Partner: [[Ilse Ferrow]]',
		'Rival: [[Mara Ferrow]]',
		'Employs: [[Wrenna Sull]]',
		'',
	].join('\n');
	const isIlse = (t: string) => t === 'Ilse Ferrow';
	const isMara = (t: string) => t === 'Mara Ferrow';
	const lines = (text: string) => parseRelationLines(text).map((r) => `${r.label}|${r.target}`).sort();
	const bodyLines = (content: string) => lines(content.split(/^## Relationships\s*$/m)[1] ?? '');
	/** What the frontmatter key holds after updateEntityRelationships. */
	const frontmatterAfter = (value: string) => {
		const change = relationshipsFrontmatterValue(value);
		return 'remove' in change ? '' : String(change.set);
	};

	const paths: Record<string, (v: string, elsewhere: RelationLine[]) => string> = {
		'mirror add (editor save, restore)': (v, elsewhere) =>
			applyMirrorEdit(v, { ownerName: 'Nessa Quillon', isOwner: (t) => t === 'Nessa Quillon', add: ['Ally'], remove: [], elsewhere }).text,
		'mirror remove (editor save, delete)': (v, elsewhere) =>
			applyMirrorEdit(v, { ownerName: 'Ilse Ferrow', isOwner: isIlse, add: [], remove: ['Ex-Partner'], elsewhere }).text,
		'gender relabel (Properties change)': (v) => relabelForGender(v.replace('Rival', 'Sister'), isMara, 'male').text,
		'restore a remembered line': (v) => `${v.trimEnd()}\nEnemy: [[Councillor Idris Vane]] (intensity 7)`,
	};

	test.each(Object.entries(paths))('%s', (_name, edit) => {
		for (const content of [drifted, drifted.replace(/\n/g, '\r\n')]) {
			const r = editRelationshipsField(content, 'Halvard Crane', edit)!;
			expect(r).not.toBeNull();
			expect(lines(frontmatterAfter(r.value))).toEqual(bodyLines(r.content));
		}
	});

	test('the frontmatter value is the body text: emptied removes the key, CRLF is never stored', () => {
		expect(relationshipsFrontmatterValue('Ward: [[Bex]]\r\nRival: [[Tobin]]')).toEqual({ set: 'Ward: [[Bex]]\nRival: [[Tobin]]' });
		expect(relationshipsFrontmatterValue('')).toEqual({ remove: true });
	});
});

describe('editRelationshipsField — picks the right field, keeps line endings', () => {
	const sheet = (sections: string, eol = '\n') => [
		'---', 'storygrid-type: character', '---', '', '# Tull', '', sections,
	].join('\n').replace(/\n/g, eol);

	test('"Relationships" wins over "Relationship Arc"', () => {
		const doc = sheet('## Relationship Arc\n\nShe softens.\n\n## Relationships\n\nWard: [[Bex]]\n');
		const r = editRelationshipsField(doc, 'Tull', (v) => `${v}\nGrandchild: [[Mara]]`)!;
		expect(r.content).toContain('## Relationship Arc\n\nShe softens.\n');
		expect(r.value).toBe('Ward: [[Bex]]\nGrandchild: [[Mara]]');
	});

	test('a CRLF sheet stays CRLF', () => {
		const doc = sheet('## Relationships\n\nWard: [[Bex]]\nRival: [[Tobin]]\n', '\r\n');
		const r = editRelationshipsField(doc, 'Tull', (v) => v.split(/\r?\n/).filter((l) => !l.startsWith('Ward')).concat('Grandchild: [[Mara]]').join('\n'))!;
		expect(r.content.replace(/\r\n/g, '')).not.toContain('\n');
		expect(r.content).toContain('Rival: [[Tobin]]\r\nGrandchild: [[Mara]]');
	});
});

describe('the character Gender field', () => {
	const spec = getKindSpec('character').defaultFields.find((d) => d.label === 'Gender')!;

	test('is a Female / Male / Non-binary dropdown, empty by default', () => {
		expect(spec.type).toBe('select');
		expect(spec.config?.options).toEqual(['Female', 'Male', 'Non-binary']);
		const made = instantiateFields(getKindSpec('character').defaultFields, 'Mara').find((f) => f.label === 'Gender')!;
		expect(made.value).toBe('');
		expect(made.config?.options).toEqual(['Female', 'Male', 'Non-binary']);
	});

	test('left untouched it writes nothing: no key, no schema entry', () => {
		const fields = mergeWithSpecDefaults('character', [field({ label: 'Full Name', type: 'text', value: 'Mara' })]);
		const fm = buildEntityFrontmatter('character', fields, 'sg_x');
		expect(fm['gender']).toBeUndefined();
		expect(fm['storygrid-schema']).toBeUndefined();
	});

	test('set, it is one plain key and comes back as the same dropdown', () => {
		const fields = mergeWithSpecDefaults('character', [field({ label: 'Full Name', type: 'text', value: 'Mara' })]);
		fields.find((f) => f.label === 'Gender')!.value = 'Female';
		const fm = buildEntityFrontmatter('character', fields, 'sg_x');
		expect(fm['gender']).toBe('Female');
		expect(fm['storygrid-schema']).toBeUndefined();
		const doc = buildEntityDocument('character', 'Mara', fields);
		const back = mergeWithSpecDefaults('character', parseEntityDocument(doc, 'Mara').fields).find((f) => f.label === 'Gender')!;
		expect([back.type, back.value, back.config?.options]).toEqual(['select', 'Female', ['Female', 'Male', 'Non-binary']]);
	});

	test('a Gender field the writer made herself, with her own word, stays a text field', () => {
		const g = mergeWithSpecDefaults('character', [field({ label: 'Gender', type: 'text', value: 'Woman' })]).find((f) => f.label === 'Gender')!;
		expect([g.type, g.value, g.config]).toEqual(['text', 'Woman', undefined]);
		const offered = mergeWithSpecDefaults('character', [field({ label: 'Gender', type: 'text', value: 'Male' })]).find((f) => f.label === 'Gender')!;
		expect(offered.type).toBe('select');
	});

	test('an existing sheet without Gender saves byte-for-byte unchanged', () => {
		const doc = buildEntityDocument('character', 'Mara', [field({ label: 'Full Name', type: 'text', value: 'Mara' }), field({ label: 'Relationships', type: 'textarea', value: 'Grandmother: [[Tull]]' })]);
		const parsed = parseEntityDocument(doc, 'Mara');
		const merged = mergeWithSpecDefaults('character', parsed.fields);
		const before = merged.map((f) => ({ id: f.id, label: f.label, type: f.type }));
		expect(applyEntityEdits(doc, 'character', 'Mara', planFieldWrites(before, merged))).toBe(doc);
	});
});

describe('writeSheetImages — only the picture lines change', () => {
	const sheet = [
		'---',
		'storygrid-type: character',
		'role: Diver',
		'---',
		'# Mara',
		'',
		'> [!infobox]',
		'> ![[mara.jpeg|300]]',
		'> ![[S/Images/Characters/Mara/harbour.png]]',
		'> | Role | Diver |',
		'',
		'## Backstory',
		'She dives. ![[S/Images/Characters/Mara/inline.png]]',
		'',
	].join('\n');
	const imagesOf = (doc: string) => parseEntityDocument(doc, 'Mara').fields.filter((f) => f.type === 'image').map((f) => f.value);

	it('swaps the portrait, keeping the size suffix with its picture', () => {
		const out = writeSheetImages(sheet, 'character', ['S/Images/Characters/Mara/harbour.png', 'mara.jpeg|300']);
		expect(imagesOf(out)).toEqual(['S/Images/Characters/Mara/harbour.png', 'mara.jpeg|300']);
		expect(out.split('\n').slice(0, 5)).toEqual(sheet.split('\n').slice(0, 5));
		expect(out).toContain('## Backstory\nShe dives. ![[S/Images/Characters/Mara/inline.png]]');
	});

	it('removes one picture line and leaves the rest of the sheet alone', () => {
		const out = writeSheetImages(sheet, 'character', ['mara.jpeg|300', '']);
		expect(imagesOf(out)).toEqual(['mara.jpeg|300']);
		expect(out).toBe(sheet.replace('> ![[S/Images/Characters/Mara/harbour.png]]\n', ''));
	});

	it('adds a first picture to a sheet that has none', () => {
		const bare = '---\nstorygrid-type: character\n---\n# Mara\n\n## Backstory\nText\n';
		const out = writeSheetImages(bare, 'character', ['S/Images/Characters/Mara/new.png']);
		expect(imagesOf(out)).toEqual(['S/Images/Characters/Mara/new.png']);
		expect(out).toContain('## Backstory\nText');
	});
});

describe('writeSheetImages — picture lines the reader and writer must agree on', () => {
	const imagesOf = (doc: string) => parseEntityDocument(doc, 'Mara').fields.filter((f) => f.type === 'image').map((f) => f.value);

	it('counts ">![[x]]" lines as pictures, so a swap never overwrites the wrong line', () => {
		const sheet = '---\nstorygrid-type: character\n---\n# Mara\n\n>![[map.png]]\n> ![[portrait.png]]\n\n## Notes\nText\n';
		expect(imagesOf(sheet)).toEqual(['map.png', 'portrait.png']);
		const out = writeSheetImages(sheet, 'character', ['portrait.png', 'map.png']);
		expect(imagesOf(out)).toEqual(['portrait.png', 'map.png']);
		expect(out).toContain('## Notes\nText');
	});

	it('adds a new picture right after existing bare picture lines, never ahead of the portrait', () => {
		const sheet = '---\nstorygrid-type: character\n---\n# Mara\n\n![[portrait.png]]\n\n## Notes\nText\n';
		const out = writeSheetImages(sheet, 'character', ['portrait.png', 'new.png']);
		expect(imagesOf(out)).toEqual(['portrait.png', 'new.png']);
		expect(out).toContain('![[portrait.png]]\n![[new.png]]\n');
	});
});
