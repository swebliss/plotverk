import { buildEntityDocument } from './entity-doc';
import { CharacterField } from '../grid-data';

function field(overrides: Partial<CharacterField> & Pick<CharacterField, 'label' | 'type' | 'value'>): CharacterField {
	return { id: `id-${overrides.label}`, ...overrides };
}

describe('buildEntityDocument', () => {
	test('plain text/textarea/image doc has no storygrid-schema key', () => {
		const doc = buildEntityDocument('character', 'Mara', [
			field({ label: 'Full Name', type: 'text', value: 'Mara' }),
			field({ label: 'Portrait', type: 'image', value: 'Portraits/mara.png' }),
			field({ label: 'Backstory', type: 'textarea', value: 'A long story.' }),
		]);
		expect(doc).not.toContain('storygrid-schema');
		expect(doc).toContain('full-name: "Mara"');
		expect(doc).toContain('> ![[Portraits/mara.png]]');
		expect(doc).toContain('## Backstory');
		expect(doc).toContain('A long story.');
	});

	test('empty fields are omitted from frontmatter and body', () => {
		const doc = buildEntityDocument('character', 'Mara', [
			field({ label: 'Full Name', type: 'text', value: 'Mara' }),
			field({ label: 'Age', type: 'text', value: '' }),
			field({ label: 'Notes', type: 'textarea', value: '   ' }),
		]);
		expect(doc).not.toContain('age:');
		expect(doc).not.toContain('## Notes');
	});

	describe('new field types emit typed YAML', () => {
		test('number emits a bare integer', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Threat Level', type: 'number', value: '27' }),
			]);
			expect(doc).toContain('threat-level: 27');
		});

		test('slider emits a bare integer', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Charisma', type: 'slider', value: '62', config: { min: 0, max: 100, step: 1 } }),
			]);
			expect(doc).toContain('charisma: 62');
		});

		test('select emits a quoted string', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Life Status', type: 'select', value: 'Alive', config: { options: ['Alive', 'Deceased'] } }),
			]);
			expect(doc).toContain('life-status: "Alive"');
		});

		test('checkbox emits a bare boolean', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Is Immortal', type: 'checkbox', value: 'true' }),
			]);
			expect(doc).toContain('is-immortal: true');
		});

		test('date emits unquoted', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Born', type: 'date', value: '2026-07-30' }),
			]);
			expect(doc).toContain('born: 2026-07-30');
			expect(doc).not.toContain('born: "2026-07-30"');
		});

		test('matrix emits a flow map', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Temperament', type: 'matrix', value: '62,-30', config: { xAxis: ['Cold', 'Warm'], yAxis: ['Calm', 'Bold'] } }),
			]);
			expect(doc).toContain('temperament: {x: 62, y: -30}');
		});

		test('tags emits a flow array', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Quirks', type: 'tags', value: 'bites nails, hums when lying' }),
			]);
			expect(doc).toContain('quirks: ["bites nails", "hums when lying"]');
		});
	});

	test('a field literally named "Tags" does not collide with the reserved tags: key', () => {
		const doc = buildEntityDocument('character', 'Mara', [
			field({ label: 'Tags', type: 'tags', value: 'brave, loyal' }),
		]);
		expect(doc).toContain('field-tags: ["brave", "loyal"]');
		expect(doc).not.toMatch(/^tags: /m);
	});

	describe('storygrid-schema sidecar', () => {
		test('present when a field has a non-inferable type', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Charisma', type: 'slider', value: '62', config: { min: 0, max: 100, step: 1 } }),
			]);
			expect(doc).toMatch(/storygrid-schema: '.*'/);
			const m = doc.match(/storygrid-schema: '(.*)'/);
			const parsed = JSON.parse(m![1].replace(/''/g, "'"));
			expect(parsed).toEqual([{ label: 'Charisma', type: 'slider', config: { min: 0, max: 100, step: 1 } }]);
		});

		test('carries category and prompt for a custom field', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Weapon of Choice', type: 'text', value: 'Rapier', category: 'Combat', prompt: 'What do they fight with?' }),
			]);
			const m = doc.match(/storygrid-schema: '(.*)'/);
			expect(m).toBeTruthy();
			const parsed = JSON.parse(m![1].replace(/''/g, "'"));
			expect(parsed).toEqual([{ label: 'Weapon of Choice', type: 'text', category: 'Combat', prompt: 'What do they fight with?' }]);
		});

		test('absent when every field is plain text/textarea/image with no config', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Full Name', type: 'text', value: 'Mara' }),
				field({ label: 'Backstory', type: 'textarea', value: 'A story.' }),
			]);
			expect(doc).not.toContain('storygrid-schema');
		});
	});

	describe('infobox table formatting', () => {
		test('slider shows value / max', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Charisma', type: 'slider', value: '62', config: { min: 0, max: 100, step: 1 } }),
			]);
			expect(doc).toContain('| **Charisma** | 62 / 100 |');
		});

		test('checkbox shows a check mark', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Is Immortal', type: 'checkbox', value: 'true' }),
			]);
			expect(doc).toContain('| **Is Immortal** | ✓ |');
		});

		test('matrix shows pole labels', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Temperament', type: 'matrix', value: '62,-30', config: { xAxis: ['Cold', 'Warm'], yAxis: ['Calm', 'Bold'] } }),
			]);
			expect(doc).toContain('| **Temperament** | Warm 62 · Calm -30 |');
		});

		test('a textarea field never appears in the infobox table', () => {
			const doc = buildEntityDocument('character', 'Mara', [
				field({ label: 'Full Name', type: 'text', value: 'Mara' }),
				field({ label: 'Backstory', type: 'textarea', value: 'A long story.' }),
			]);
			expect(doc).not.toContain('| **Backstory** |');
		});
	});
});
