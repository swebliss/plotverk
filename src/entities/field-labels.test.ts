import { CharacterField } from '../grid-data';
import { freeFieldLabel, makeFieldLabelsUnique } from './field-labels';
import { buildEntityDocument } from './entity-doc';
import { mergeWithSpecDefaults, parseEntityDocument } from './entity-parse';
import { applyEntityEdits, planFieldWrites } from './entity-write';

const field = (label: string, value = '', type: CharacterField['type'] = 'textarea'): CharacterField =>
	({ id: `${label}-${value}`, label, value, type });

describe('freeFieldLabel', () => {
	it('keeps a free name, numbers a taken one', () => {
		const fields = [field('Backstory'), field('Backstory 2'), field('Goal')];
		expect(freeFieldLabel('Fears', fields)).toBe('Fears');
		expect(freeFieldLabel('backstory', fields)).toBe('backstory 3');
		expect(freeFieldLabel(' Goal ', fields)).toBe('Goal 2');
	});

	it('a field may keep its own name', () => {
		const goal = field('Goal');
		expect(freeFieldLabel('Goal', [goal, field('Fears')], goal)).toBe('Goal');
	});

	it('pictures never block a name', () => {
		expect(freeFieldLabel('Portrait', [field('Portrait', 'a.png', 'image')])).toBe('Portrait');
	});
});

describe('two long-text fields with the same name', () => {
	it('the later one gets a free name, the earlier keeps its own', () => {
		const fields = [field('Backstory', 'A'), field('Goal', 'G'), field('backstory', 'B')];
		makeFieldLabelsUnique(fields);
		expect(fields.map((f) => f.label)).toEqual(['Backstory', 'Goal', 'backstory 2']);
	});

	it('a pasted copy no longer overwrites the original on save', () => {
		const original: CharacterField[] = [field('Backstory', 'Grew up by the sea.')];
		const doc = buildEntityDocument('character', 'Anna', original);
		const parsed = parseEntityDocument(doc, 'Anna');
		const before = parsed.fields.map((f) => ({ id: f.id, label: f.label, type: f.type }));
		// The writer pastes a second "Backstory" and writes in it.
		const edited = [...parsed.fields, { ...field('Backstory', 'Ran away at twelve.'), id: 'pasted' }];
		makeFieldLabelsUnique(edited);
		const out = applyEntityEdits(doc, 'character', 'Anna', planFieldWrites(before, edited));
		expect(out).toContain('Grew up by the sea.');
		expect(out).toContain('Ran away at twelve.');
		expect(out).toContain('## Backstory 2');
	});

	it('a hand-typed heading in other capitals is the kind’s own field, not a duplicate', () => {
		const doc = ['---', 'storygrid-type: character', '---', '', '# Anna', '', '## appearance', '', 'MY TEXT', ''].join('\n');
		const parsed = parseEntityDocument(doc, 'Anna');
		const merged = mergeWithSpecDefaults('character', parsed.fields, parsed.cleanSlate);
		expect(merged.filter((f) => f.label.toLowerCase() === 'appearance')).toHaveLength(1);
		const before = merged.map((f) => ({ id: f.id, label: f.label, type: f.type }));
		const edited = merged.map((f) => ({ ...f }));
		makeFieldLabelsUnique(edited);
		const out = applyEntityEdits(doc, 'character', 'Anna', planFieldWrites(before, edited));
		expect(out).toContain('## appearance');
		expect(out).not.toContain('appearance 2');
		expect(out).toContain('MY TEXT');
	});

	it('a hand-written sheet with two sections of one name keeps both texts', () => {
		const doc = ['---', 'storygrid-type: character', '---', '', '# Anna', '', '## Notes', '', 'First.', '', '## Notes', '', 'Second.', ''].join('\n');
		const parsed = parseEntityDocument(doc, 'Anna');
		const before = parsed.fields.map((f) => ({ id: f.id, label: f.label, type: f.type }));
		const edited = parsed.fields.map((f) => ({ ...f }));
		makeFieldLabelsUnique(edited);
		const out = applyEntityEdits(doc, 'character', 'Anna', planFieldWrites(before, edited));
		expect(out).toContain('First.');
		expect(out).toContain('Second.');
	});
});
