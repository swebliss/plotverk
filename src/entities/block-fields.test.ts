import {
	encodeYamlValue,
	decodeValue,
	formatFieldValue,
	parseListItems,
	parseTableRows,
	stringifyTableRows,
} from './field-types';
import { buildEntityDocument } from './entity-doc';
import { parseEntityDocument } from './entity-parse';
import { CharacterField } from '../grid-data';

const field = (over: Partial<CharacterField>): CharacterField => ({
	id: 'f1', label: 'Field', value: '', type: 'text', ...over,
});

describe('list fields', () => {
	it('encodes items as a YAML flow sequence and reads them back', () => {
		const value = 'Sword\nRope\nLantern';
		const yaml = encodeYamlValue('list', value);
		expect(yaml).toBe('["Sword", "Rope", "Lantern"]');
		expect(decodeValue('list', yaml!)).toBe(value);
	});

	it('omits an empty list from frontmatter entirely', () => {
		expect(encodeYamlValue('list', '')).toBeNull();
		expect(encodeYamlValue('list', '\n  \n')).toBeNull();
	});

	it('survives commas inside an item', () => {
		const value = 'A long, winding road\nPlain';
		const round = decodeValue('list', encodeYamlValue('list', value)!);
		expect(round).toBe(value);
	});

	it('renders as a markdown bullet list', () => {
		expect(formatFieldValue('list', 'One\nTwo')).toBe('- One\n- Two');
	});

	it('ignores blank lines between items', () => {
		expect(parseListItems('One\n\n  \nTwo')).toEqual(['One', 'Two']);
	});
});

describe('table fields', () => {
	const config = { columns: ['Item', 'Where'] };
	const rows = [['Sword', 'On his back'], ['Letter', 'Sewn into a coat']];

	it('encodes rows as flow maps keyed by column name', () => {
		const yaml = encodeYamlValue('table', JSON.stringify(rows), config);
		expect(yaml).toBe(
			'[{"Item": "Sword", "Where": "On his back"}, {"Item": "Letter", "Where": "Sewn into a coat"}]'
		);
	});

	it('round-trips through the column order in the schema', () => {
		const yaml = encodeYamlValue('table', JSON.stringify(rows), config)!;
		expect(parseTableRows(decodeValue('table', yaml, config))).toEqual(rows);
	});

	it('falls back to the order written in the note when there is no schema', () => {
		const yaml = encodeYamlValue('table', JSON.stringify(rows), config)!;
		expect(parseTableRows(decodeValue('table', yaml))).toEqual(rows);
	});

	it('treats a grid of blanks as an empty field', () => {
		expect(stringifyTableRows([['', ''], ['', '']])).toBe('');
		expect(encodeYamlValue('table', stringifyTableRows([['', '']]), config)).toBeNull();
	});

	it('survives commas and quotes inside a cell', () => {
		const tricky = [['He said "no", twice', 'Nowhere']];
		const yaml = encodeYamlValue('table', JSON.stringify(tricky), config)!;
		expect(parseTableRows(decodeValue('table', yaml, config))).toEqual(tricky);
	});

	it('renders as a markdown table', () => {
		expect(formatFieldValue('table', JSON.stringify(rows), config)).toBe(
			'| Item | Where |\n| --- | --- |\n| Sword | On his back |\n| Letter | Sewn into a coat |'
		);
	});

	it('reads malformed json as no rows rather than throwing', () => {
		expect(parseTableRows('{not json')).toEqual([]);
	});
});

describe('block fields inside a whole document', () => {
	const fields: CharacterField[] = [
		field({ id: 'a', label: 'Age', value: '34', type: 'number' }),
		field({ id: 'b', label: 'Backstory', value: 'Raised at sea.', type: 'textarea' }),
		field({ id: 'c', label: 'Carries', value: 'Sword\nRope', type: 'list' }),
		field({
			id: 'd', label: 'Inventory', type: 'table',
			value: JSON.stringify([['Sword', 'On his back']]),
			config: { columns: ['Item', 'Where'] },
		}),
	];

	it('round-trips every block type through build and parse', () => {
		const doc = buildEntityDocument('character', 'Ren', fields);
		const parsed = parseEntityDocument(doc, 'Ren');

		const byLabel = new Map(parsed.fields.map((f) => [f.label, f]));
		expect(byLabel.get('Carries')?.type).toBe('list');
		expect(byLabel.get('Carries')?.value).toBe('Sword\nRope');
		expect(byLabel.get('Inventory')?.type).toBe('table');
		expect(parseTableRows(byLabel.get('Inventory')!.value)).toEqual([['Sword', 'On his back']]);
		expect(byLabel.get('Inventory')?.config?.columns).toEqual(['Item', 'Where']);
		expect(byLabel.get('Backstory')?.type).toBe('textarea');
		expect(byLabel.get('Backstory')?.value).toBe('Raised at sea.');
	});

	it('writes lists and tables as readable body sections, not infobox rows', () => {
		const doc = buildEntityDocument('character', 'Ren', fields);
		expect(doc).toContain('## Carries');
		expect(doc).toContain('- Sword');
		expect(doc).toContain('## Inventory');
		expect(doc).toContain('| Item | Where |');
		// The at-a-glance callout keeps only single-value fields.
		expect(doc).not.toContain('> | **Carries**');
		expect(doc).not.toContain('> | **Inventory**');
	});

	it('keeps frontmatter authoritative when the body rendering is stale', () => {
		const doc = buildEntityDocument('character', 'Ren', fields);
		const tampered = doc.replace('- Sword\n- Rope', '- Something a human typed');
		const parsed = parseEntityDocument(tampered, 'Ren');
		const carries = parsed.fields.find((f) => f.label === 'Carries');
		expect(carries?.value).toBe('Sword\nRope');
	});

	it('still lets prose sections win over their frontmatter copy', () => {
		const doc = buildEntityDocument('character', 'Ren', fields);
		// Edit the body section, not the frontmatter copy that precedes it.
		const edited = doc.replace('## Backstory\n\nRaised at sea.', '## Backstory\n\nRaised in the hills.');
		const parsed = parseEntityDocument(edited, 'Ren');
		expect(parsed.fields.find((f) => f.label === 'Backstory')?.value).toBe('Raised in the hills.');
	});
});
