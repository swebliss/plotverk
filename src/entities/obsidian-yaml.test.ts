import { parseEntityDocument } from './entity-parse';
import { buildEntityDocument } from './entity-doc';
import { unquoteYaml, yamlQuote, encodeYamlValue, decodeValue } from './field-types';

/**
 * Plotverk no longer writes frontmatter itself — `processFrontMatter` hands the
 * YAML to Obsidian. So the parser has to read Obsidian's serializer, not ours.
 *
 * These shapes are not guesses. Every sheet the plugin has stamped a
 * `storygrid-id` onto has already been rewritten by Obsidian, and 27 of the 28
 * entity sheets in the test vault came back in this form: arrays as two-space
 * block sequences, plain scalars re-emitted unquoted, numbers-as-text kept
 * quoted, long text as a `|` block scalar.
 */

const sheet = (lines: string[]): string => ['---', ...lines, '---', '', '# Mara', ''].join('\n');
const valueOf = (doc: string, label: string): string | undefined =>
	parseEntityDocument(doc, 'Mara').fields.find((f) => f.label === label)?.value;

describe('reading frontmatter the way Obsidian writes it', () => {
	test('aliases as a block sequence', () => {
		const parsed = parseEntityDocument(
			sheet(['storygrid-type: character', 'aliases:', '  - the police', '  - the cop']),
			'Mara'
		);
		expect(parsed.aliases).toEqual(['the police', 'the cop']);
	});

	test('aliases as a flow sequence still work', () => {
		const parsed = parseEntityDocument(
			sheet(['storygrid-type: character', 'aliases: [the police, "the cop, retired"]']),
			'Mara'
		);
		expect(parsed.aliases).toEqual(['the police', 'the cop, retired']);
	});

	test('a tags field as a block sequence keeps its values', () => {
		// The headline regression: create a character with tags filled in, let
		// Obsidian touch the sheet once, reopen Edit sheet — the tags were gone.
		const doc = sheet([
			'storygrid-type: character',
			`storygrid-schema: '${JSON.stringify([{ label: 'Traits', type: 'tags' }])}'`,
			'traits:',
			'  - brave',
			'  - loyal',
		]);
		expect(valueOf(doc, 'Traits')).toBe('brave, loyal');
	});

	test('a list field as a block sequence keeps its line breaks', () => {
		const doc = sheet([
			'storygrid-type: character',
			`storygrid-schema: '${JSON.stringify([{ label: 'Carries', type: 'list' }])}'`,
			'carries:',
			'  - Sword',
			'  - Rope',
		]);
		expect(valueOf(doc, 'Carries')).toBe('Sword\nRope');
	});

	test('a matrix field as a nested block map', () => {
		const doc = sheet([
			'storygrid-type: character',
			`storygrid-schema: '${JSON.stringify([{ label: 'Temperament', type: 'matrix' }])}'`,
			'temperament:',
			'  x: 62',
			'  y: -30',
		]);
		expect(valueOf(doc, 'Temperament')).toBe('62,-30');
	});

	test('a table field as a sequence of block maps', () => {
		const schema = JSON.stringify([{ label: 'Crew', type: 'table', config: { columns: ['Name', 'Role'] } }]);
		const doc = sheet([
			'storygrid-type: character',
			`storygrid-schema: '${schema}'`,
			'crew:',
			'  - Name: Ada',
			'    Role: pilot',
			'  - Name: Bo',
			'    Role: cook',
		]);
		expect(valueOf(doc, 'Crew')).toBe(JSON.stringify([['Ada', 'pilot'], ['Bo', 'cook']]));
	});

	test('a table cell that reads as a number is still text', () => {
		const schema = JSON.stringify([{ label: 'Crew', type: 'table', config: { columns: ['Name', 'Age'] } }]);
		const doc = sheet([
			'storygrid-type: character',
			`storygrid-schema: '${schema}'`,
			'crew:',
			'  - Name: Ada',
			'    Age: 41',
		]);
		expect(valueOf(doc, 'Crew')).toBe(JSON.stringify([['Ada', '41']]));
	});

	test('a quoted sequence item keeps the character that forced the quotes', () => {
		const doc = sheet([
			'storygrid-type: character',
			`storygrid-schema: '${JSON.stringify([{ label: 'Traits', type: 'tags' }])}'`,
			'traits:',
			'  - "brave, to a fault"',
			'  - loyal',
		]);
		expect(valueOf(doc, 'Traits')).toBe('brave, to a fault, loyal');
	});

	test('a folded block scalar becomes one line again', () => {
		const doc = sheet([
			'storygrid-type: character',
			'background: >',
			'  A vastly wealthy aristocrat',
			'  who buys political influence.',
		]);
		expect(valueOf(doc, 'Background')).toBe('A vastly wealthy aristocrat who buys political influence.');
	});

	test('a literal block scalar keeps its line breaks whatever depth it sits at', () => {
		const doc = sheet([
			'storygrid-type: character',
			'relationships: |',
			'    Mother: [[Lily Potter]]',
			'    Father: [[James Potter]]',
		]);
		expect(valueOf(doc, 'Relationships')).toBe('Mother: [[Lily Potter]]\nFather: [[James Potter]]');
	});

	test('a wrapped plain scalar is joined back up', () => {
		const doc = sheet([
			'storygrid-type: character',
			'background: A vastly wealthy aristocrat',
			'  who buys political influence.',
		]);
		expect(valueOf(doc, 'Background')).toBe('A vastly wealthy aristocrat who buys political influence.');
	});

	test('an unquoted plain scalar is not mistaken for something else', () => {
		const doc = sheet(['storygrid-type: character', 'full-name: Harry James Potter', 'age: "15"']);
		expect(valueOf(doc, 'Full Name')).toBe('Harry James Potter');
		expect(valueOf(doc, 'Age')).toBe('15');
	});

	test('cssclasses rewritten as a block sequence does not become a field', () => {
		// This is the exact rewrite Obsidian performed on 27 sheets in the test vault.
		const doc = sheet([
			'storygrid-type: character',
			'cssclasses:',
			'  - storygrid-sheet',
			'  - sg-sheet-character',
			'full-name: Mara Venn',
		]);
		const labels = parseEntityDocument(doc, 'Mara').fields.map((f) => f.label);
		expect(labels).not.toContain('Cssclasses');
		expect(labels).toContain('Full Name');
	});

	test("a writer's own tags: key is left out of the field list", () => {
		const doc = sheet([
			'storygrid-type: character',
			'tags:',
			'  - reading-list',
			'full-name: Mara Venn',
		]);
		const labels = parseEntityDocument(doc, 'Mara').fields.map((f) => f.label);
		expect(labels).toEqual(['Full Name']);
	});

	test('a non-Latin label survives Obsidian dropping the quotes', () => {
		const written = buildEntityDocument('character', 'マラ', [
			{ id: '1', label: '名前', value: 'マラ・ヴェン', type: 'text' },
		]);
		// Obsidian re-emits a plain string unquoted.
		const rewritten = written.replace('field-1cadmz3: "マラ・ヴェン"', 'field-1cadmz3: マラ・ヴェン');
		expect(rewritten).not.toBe(written);
		const byLabel = new Map(parseEntityDocument(rewritten, 'マラ').fields.map((f) => [f.label, f.value]));
		expect(byLabel.get('名前')).toBe('マラ・ヴェン');
	});

	test('an empty key holds nothing rather than swallowing the next one', () => {
		const doc = sheet(['storygrid-type: character', 'nickname:', 'full-name: Mara Venn']);
		expect(valueOf(doc, 'Nickname')).toBe('');
		expect(valueOf(doc, 'Full Name')).toBe('Mara Venn');
	});
});

describe('one unquoter, one quoter', () => {
	test('a value ending in a backslash round-trips', () => {
		// Before: `route: "C:\"` — the backslash escaped the closing quote and
		// took the whole frontmatter block, and the entity, with it.
		const value = 'C:\\';
		expect(yamlQuote(value)).toBe('"C:\\\\"');
		expect(unquoteYaml(yamlQuote(value))).toBe(value);
	});

	test('the sheet builder now writes a backslash value that parses back', () => {
		const doc = buildEntityDocument('character', 'Mara', [
			{ id: '1', label: 'Route', value: 'C:\\', type: 'text' },
		]);
		expect(doc).toContain('route: "C:\\\\"');
		const byLabel = new Map(parseEntityDocument(doc, 'Mara').fields.map((f) => [f.label, f.value]));
		expect(byLabel.get('Route')).toBe('C:\\');
	});

	test('quotes, tabs and newlines survive the round trip', () => {
		for (const value of ['She said "hi"', 'a\tb', 'one\ntwo', 'plain']) {
			expect(unquoteYaml(yamlQuote(value))).toBe(value);
		}
	});

	test('a single-quoted scalar undoubles its quotes', () => {
		expect(unquoteYaml("'it''s here'")).toBe("it's here");
	});

	test('an unquoted scalar is returned untouched', () => {
		expect(unquoteYaml('Harry James Potter')).toBe('Harry James Potter');
		expect(unquoteYaml('2026-07-30')).toBe('2026-07-30');
	});

	test('the escapes Obsidian writes are the escapes we read', () => {
		expect(unquoteYaml('"line\\nbreak"')).toBe('line\nbreak');
		expect(unquoteYaml('"back\\\\slash"')).toBe('back\\slash');
		expect(unquoteYaml('"\\u00e9"')).toBe('é');
	});

	test('every field type still survives its own source encoder', () => {
		const cases: Array<[Parameters<typeof encodeYamlValue>[0], string]> = [
			['text', 'She said "hi" \\'],
			['tags', 'brave, loyal'],
			['list', 'Sword\nRope'],
			['select', 'Alive'],
		];
		for (const [type, value] of cases) {
			const encoded = encodeYamlValue(type, value);
			expect(decodeValue(type, encoded as string)).toBe(value);
		}
	});
});
