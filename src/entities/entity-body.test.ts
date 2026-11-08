import { parseBody, renderBody, applyFields, setTitle, SectionBlock, InfoboxBlock } from './entity-body';
import { parseEntityDocument } from './entity-parse';
import { CharacterField } from '../grid-data';

function field(overrides: Partial<CharacterField> & Pick<CharacterField, 'label' | 'type' | 'value'>): CharacterField {
	return { id: `id-${overrides.label}`, ...overrides };
}

/** A sheet in exactly the shape buildEntityDocument emits (body only, no frontmatter). */
const GENERATED = [
	'# Mara',
	'',
	'> [!info|sg-infobox] Character at a Glance',
	'> ![[Portraits/mara.png]]',
	'>',
	'> | Field | Value |',
	'> | --- | --- |',
	'> | **Full Name** | Mara Vale |',
	'> | **Age** | 31 |',
	'',
	'## Backstory',
	'',
	'A long story.',
	'',
].join('\n');

/**
 * A `## ` line inside a code fence. Kept separate because the OLD parser
 * (`entity-parse.ts`) is not fence-aware and mis-splits on it — see the
 * `test.failing` at the bottom of this file.
 */
const FENCED_HEADING = [
	'```md',
	'## Not a heading, it is inside a fence',
	'> [!info|sg-infobox] nor is this a callout',
	'```',
	'',
];

/** The same sheet after a writer has been living in it for a while. */
const HAND_EDITED_HEAD = [
	'---rule-above-is-body-not-frontmatter',
	'# Mara',
	'',
	'Some loose prose the sheet builder knows nothing about.',
	'',
	'> [!info|sg-infobox] Character at a Glance',
	'> ![[Portraits/mara.png]]',
	'>',
	'> > [!warning] Spoilers',
	'> > She dies in book three.',
	'>',
	'> | Field | Value |',
	'> | --- | --- |',
	'> | **Full Name** | Mara Vale |',
	'',
	'![[research/mara-notes.pdf]]',
	'',
	'---',
	'',
	'## Backstory',
	'',
	'A long story.',
	'',
	'More prose between the sections.',
	'',
	'## My Own Heading',
	'',
	'Nothing to do with any field.',
	'',
];

const HAND_EDITED_TAIL = ['Trailing words with no newline at the end.'];

const HAND_EDITED = [...HAND_EDITED_HEAD, ...FENCED_HEADING, ...HAND_EDITED_TAIL].join('\n');

/** The same sheet minus the one construct the old parser cannot read. */
const PARSER_SAFE = [...HAND_EDITED_HEAD, ...HAND_EDITED_TAIL].join('\n');

describe('parseBody / renderBody — the round-trip law', () => {
	const inputs: Array<[string, string]> = [
		['empty string', ''],
		['a lone newline', '\n'],
		['generated sheet', GENERATED],
		['hand-edited sheet', HAND_EDITED],
		['no trailing newline', '# Mara\n\nprose'],
		['CRLF throughout', '# Mara\r\n\r\n## Backstory\r\n\r\nProse.\r\n'],
		['only prose', 'just some words'],
		['unterminated code fence', '# X\n\n```ts\n## still code\n'],
		['tildes fence', '# X\n\n~~~\n## still code\n~~~\n\n## real\n\nbody\n'],
		['consecutive blank lines', '# X\n\n\n\n\n## Y\n\n\n'],
		['horizontal rules', '---\n\n# X\n\n---\n\n## Y\n\n---\n'],
		['two H1s', '# One\n\n# Two\n\nbody\n'],
		['plain blockquote, not a callout', '> just a quote\n> line two\n\n# X\n'],
		['callout before any heading', '> [!note] hello\n> world\n\n# X\n'],
	];

	test.each(inputs)('render(parse(x)) === x — %s', (_name, input) => {
		expect(renderBody(parseBody(input))).toBe(input);
	});

	test('every byte lands in exactly one block', () => {
		const doc = parseBody(HAND_EDITED);
		expect(doc.blocks.map((b) => b.text).join('')).toBe(HAND_EDITED);
		expect(doc.blocks.every((b) => b.text.length > 0)).toBe(true);
	});
});

describe('parseBody — block classification', () => {
	test('generated sheet splits into title, infobox and section', () => {
		const doc = parseBody(GENERATED);
		const kinds = doc.blocks.map((b) => b.kind);
		expect(kinds).toContain('h1');
		expect(kinds).toContain('infobox');
		expect(kinds).toContain('section');
		const h1 = doc.blocks.find((b) => b.kind === 'h1');
		expect(h1 && h1.kind === 'h1' && h1.title).toBe('Mara');
		const section = doc.blocks.find((b) => b.kind === 'section') as SectionBlock;
		expect(section.label).toBe('Backstory');
		expect(section.content).toContain('A long story.');
	});

	test('a `## ` line inside a code fence does not start a section', () => {
		const doc = parseBody(HAND_EDITED);
		const labels = doc.blocks.filter((b) => b.kind === 'section').map((b) => (b as SectionBlock).label);
		expect(labels).toEqual(['Backstory', 'My Own Heading']);
		expect(labels).not.toContain('Not a heading, it is inside a fence');
	});

	test('a nested callout stays inside the infobox block', () => {
		const infobox = parseBody(HAND_EDITED).blocks.find((b) => b.kind === 'infobox') as InfoboxBlock;
		expect(infobox.text).toContain('> > [!warning] Spoilers');
		expect(infobox.text).toContain('> > She dies in book three.');
	});

	test('a plain blockquote is raw, not the infobox', () => {
		const doc = parseBody('> just a quote\n> line two\n\n# X\n');
		expect(doc.blocks.some((b) => b.kind === 'infobox')).toBe(false);
	});

	test('a legacy callout with fact rows but no sg-infobox marker still counts', () => {
		const doc = parseBody('# X\n\n> [!info] Character at a Glance\n> | **Age** | 31 |\n');
		expect(doc.blocks.some((b) => b.kind === 'infobox')).toBe(true);
	});

	test('CRLF documents keep their line endings and report them', () => {
		const doc = parseBody('# Mara\r\n\r\n## Backstory\r\n\r\nProse.\r\n');
		expect(doc.eol).toBe('\r\n');
		expect(renderBody(doc)).toContain('\r\n');
	});
});

describe('applyFields — updating recognised content', () => {
	test('changes a fact row in place without touching the rest', () => {
		const before = parseBody(GENERATED);
		const after = renderBody(applyFields(before, [field({ label: 'Age', type: 'text', value: '32' })], 'character'));
		expect(after).toContain('> | **Age** | 32 |');
		expect(after).toContain('> | **Full Name** | Mara Vale |');
		expect(after).toContain('## Backstory');
		expect(after).toContain('A long story.');
	});

	test('changes a prose section in place', () => {
		const before = parseBody(GENERATED);
		const after = renderBody(applyFields(before, [field({ label: 'Backstory', type: 'textarea', value: 'A shorter story.' })], 'character'));
		expect(after).toContain('## Backstory\n\nA shorter story.\n');
		expect(after).not.toContain('A long story.');
	});

	test('appends a section for a field the sheet does not have yet', () => {
		const before = parseBody(GENERATED);
		const after = renderBody(applyFields(before, [field({ label: 'Voice', type: 'textarea', value: 'Dry and clipped.' })], 'character'));
		expect(after).toContain('## Voice\n\nDry and clipped.');
		expect(after).toContain('## Backstory');
	});

	test('appends a fact row for a new scalar field', () => {
		const before = parseBody(GENERATED);
		const after = renderBody(applyFields(before, [field({ label: 'Occupation', type: 'text', value: 'Cartographer' })], 'character'));
		expect(after).toContain('> | **Age** | 31 |\n> | **Occupation** | Cartographer |');
	});

	test('an emptied field loses its row and its section', () => {
		const before = parseBody(GENERATED);
		const after = renderBody(applyFields(before, [
			field({ label: 'Age', type: 'text', value: '' }),
			field({ label: 'Backstory', type: 'textarea', value: '' }),
		], 'character'));
		expect(after).not.toContain('**Age**');
		expect(after).not.toContain('## Backstory');
		expect(after).toContain('> | **Full Name** | Mara Vale |');
	});

	test('rewrites the portrait embed rather than adding a second one', () => {
		const before = parseBody(GENERATED);
		const after = renderBody(applyFields(before, [field({ label: 'Portrait', type: 'image', value: 'Portraits/mara-v2.png' })], 'character'));
		expect(after).toContain('> ![[Portraits/mara-v2.png]]');
		expect(after).not.toContain('mara.png');
		expect(after.match(/!\[\[/g)).toHaveLength(1);
	});

	test('creates the at-a-glance callout when the sheet has none', () => {
		const before = parseBody('# Mara\n\n## Backstory\n\nA long story.\n');
		const after = renderBody(applyFields(before, [field({ label: 'Age', type: 'text', value: '31' })], 'character'));
		expect(after).toContain('> [!info|sg-infobox] Character at a Glance');
		expect(after).toContain('> | Field | Value |');
		expect(after).toContain('> | **Age** | 31 |');
		expect(after).toContain('## Backstory');
	});

	test('no fields at all is a no-op', () => {
		expect(renderBody(applyFields(parseBody(HAND_EDITED), []))).toBe(HAND_EDITED);
	});
});

describe('applyFields — preserving what it does not own', () => {
	// A section's whole content is the textarea field's value (that is how
	// parseEntityDocument reads it), so a realistic caller passes it back in
	// full — here with only the first paragraph edited.
	const FIELDS = [
		field({ label: 'Full Name', type: 'text', value: 'Mara Vale' }),
		field({ label: 'Age', type: 'text', value: '32' }),
		field({ label: 'Portrait', type: 'image', value: 'Portraits/mara.png' }),
		field({ label: 'Backstory', type: 'textarea', value: 'A rewritten story.\n\nMore prose between the sections.' }),
	];

	const after = renderBody(applyFields(parseBody(HAND_EDITED), FIELDS, 'character'));

	test('the edit it was asked for happened', () => {
		expect(after).toContain('> | **Age** | 32 |');
		expect(after).toContain('## Backstory\n\nA rewritten story.');
	});

	test('loose prose survives', () => {
		expect(after).toContain('Some loose prose the sheet builder knows nothing about.');
		expect(after).toContain('More prose between the sections.');
		expect(after).toContain('Trailing words with no newline at the end.');
	});

	test('a nested callout inside the infobox survives', () => {
		expect(after).toContain('> > [!warning] Spoilers');
		expect(after).toContain('> > She dies in book three.');
	});

	test('a non-image embed survives', () => {
		expect(after).toContain('![[research/mara-notes.pdf]]');
	});

	test('a hand-written heading that matches no field survives untouched', () => {
		expect(after).toContain('## My Own Heading\n\nNothing to do with any field.');
	});

	test('horizontal rules in the body survive', () => {
		expect(after).toContain('\n---\n');
		expect(after).toContain('---rule-above-is-body-not-frontmatter');
	});

	test('a code fence survives verbatim', () => {
		expect(after).toContain('```md\n## Not a heading, it is inside a fence\n');
	});

	test('a section holds its field value in full — a shorter value shortens the section', () => {
		// The flip side of the rule above, stated deliberately: this is what
		// makes it possible to delete a paragraph from the editor at all.
		const short = renderBody(applyFields(parseBody(GENERATED), [
			field({ label: 'Backstory', type: 'textarea', value: 'Short.' }),
		], 'character'));
		expect(short).toContain('## Backstory\n\nShort.\n');
		expect(short).not.toContain('A long story.');
	});
});

describe('the law that matters: parseEntityDocument → applyFields loses nothing', () => {
	const FRONTMATTER = [
		'---',
		'storygrid-type: character',
		'cssclasses: [storygrid-sheet, sg-sheet-character]',
		'full-name: "Mara Vale"',
		'---',
		'',
	].join('\n');

	const save = (body: string, edit?: (f: CharacterField) => CharacterField): string => {
		const parsed = parseEntityDocument(FRONTMATTER + body, 'Mara');
		const fields = edit ? parsed.fields.map(edit) : parsed.fields;
		return renderBody(applyFields(parseBody(body), fields, 'character'));
	};

	test('a hand-mangled sheet survives a save that changes nothing', () => {
		expect(save(PARSER_SAFE)).toBe(PARSER_SAFE);
	});

	test('a save that changes one fact leaves every other byte alone', () => {
		const rename = (f: CharacterField) => (f.label === 'Full Name' ? { ...f, value: 'Mara Valeria' } : f);
		expect(save(PARSER_SAFE, rename)).toBe(PARSER_SAFE.replace('| Mara Vale |', '| Mara Valeria |'));
	});

	// Closed in 3a-5: entity-parse now reads sections through entity-body's
	// fence-aware splitter, so the `## ` inside the code fence is content on
	// both sides of the round trip. (This was pinned as `test.failing` from
	// 3a-1 until the shared splitter landed.)
	test('a `## ` inside a code fence survives a no-op save', () => {
		expect(save(HAND_EDITED)).toBe(HAND_EDITED);
	});
});

describe('setTitle', () => {
	test('replaces the H1 line and nothing else', () => {
		const before = parseBody(HAND_EDITED);
		const after = renderBody(setTitle(before, 'Mara Vale'));
		expect(after).toContain('# Mara Vale\n');
		expect(after).toBe(HAND_EDITED.replace('# Mara\n', '# Mara Vale\n'));
	});

	test('renaming to the same name is a no-op', () => {
		expect(renderBody(setTitle(parseBody(GENERATED), 'Mara'))).toBe(GENERATED);
	});

	test('adds a title to a body that has none', () => {
		expect(renderBody(setTitle(parseBody('Just prose.\n'), 'Mara'))).toBe('# Mara\n\nJust prose.\n');
	});

	test('keeps CRLF line endings', () => {
		const doc = parseBody('# Mara\r\n\r\nProse.\r\n');
		expect(renderBody(setTitle(doc, 'Vale'))).toBe('# Vale\r\n\r\nProse.\r\n');
	});
});
