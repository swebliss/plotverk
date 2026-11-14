import { parseEntityDocument, isTakeableTextProperty, titleBelongsToFile } from './entity-parse';
import { buildEntityDocument, buildEntityFrontmatter } from './entity-doc';
import { retitleAfterFileRename } from './entity-write';
import { CharacterField } from '../grid-data';

/** A Plotverk character sheet with the writer's own Obsidian properties added on top. */
function sheetWithOwnProperties(): string {
	const fields: CharacterField[] = [
		{ id: 'a', label: 'Role', value: 'Hero', type: 'text' },
		{ id: 'b', label: 'Backstory', value: 'Grew up by the sea.', type: 'textarea' },
	];
	const doc = buildEntityDocument('character', 'Anna', fields);
	const own = [
		'date_created: 2026-01-02',
		'Status: draft',
		'rating: 5',
		'done: true',
		'moods:',
		'  - calm',
		'  - angry',
		'wishlist:',
		'mood: happy',
	].join('\n');
	return doc.replace(/^---\n/, `---\n${own}\n`);
}

describe('the writer\'s own properties', () => {
	const parsed = parseEntityDocument(sheetWithOwnProperties(), 'Anna');
	const labels = parsed.fields.map((f) => f.label);

	it('never become fields or owned keys, so a save leaves them as written', () => {
		for (const key of ['date_created', 'Status', 'rating', 'done', 'moods', 'wishlist']) {
			expect(parsed.ownedKeys).not.toContain(key);
		}
		expect(labels).not.toContain('Date_created');
		expect(labels).not.toContain('Rating');
		expect(labels).not.toContain('Done');
		expect(labels).not.toContain('Moods');
	});

	it('plain text under a simple key is still taken in as a field', () => {
		expect(parsed.ownedKeys).toContain('mood');
		expect(parsed.fields.find((f) => f.label === 'Mood')?.value).toBe('happy');
	});

	it('Plotverk\'s own fields are still owned and read', () => {
		expect(parsed.ownedKeys).toEqual(expect.arrayContaining(['storygrid-type', 'role', 'backstory']));
		expect(parsed.fields.find((f) => f.label === 'Role')?.value).toBe('Hero');
	});
});

describe('isTakeableTextProperty', () => {
	it.each([
		['mood', 'happy', true],
		['mood', '"quoted text"', true],
		['date-created', 'last spring', true],
		['date_created', 'x', false],
		['Status', 'draft', false],
		['mood', '', false],
		['mood', '""', false],
		['rating', '5', false],
		['rating', '-2.5', false],
		['done', 'true', false],
		['done', 'No', false],
		['when', '2026-01-02', false],
		['list', '[a, b]', false],
		['map', '{a: 1}', false],
		['nothing', 'null', false],
	])('%s: %s → %s', (key, raw, expected) => {
		expect(isTakeableTextProperty(key, raw)).toBe(expected);
	});
});

describe('a new field next to a property the writer added', () => {
	it('gets its own key instead of writing over the property', () => {
		const fm = buildEntityFrontmatter('character', [{ id: 'r', label: 'Rating', value: 'High', type: 'text' }], 'id1', undefined, undefined, ['rating']);
		expect(fm['rating']).toBeUndefined();
		expect(fm['rating-2']).toBe('High');
		// The schema records the moved key, so the field reads back as "Rating".
		expect(String(fm['storygrid-schema'])).toContain('"key":"rating-2"');
	});
});

describe('the protection lasts beyond one save', () => {
	it('after a field moved to rating-2, the rating the writer added stays theirs on reopen', () => {
		const fields: CharacterField[] = [{ id: 'r', label: 'Rating', value: 'High', type: 'text' }];
		const fm = buildEntityFrontmatter('location', fields, 'id1', undefined, undefined, ['rating']);
		const schema = String(fm['storygrid-schema']);
		const written = buildEntityDocument('location', 'Harbour', fields);
		const line = written.split('\n').find((l) => l.startsWith('rating:'));
		expect(line).toBeDefined();
		const doc = written.replace(line as string, ['rating: 5', 'rating-2: "High"', "storygrid-schema: '" + schema + "'"].join('\n'));
		const parsed = parseEntityDocument(doc, 'Harbour');
		expect(parsed.ownedKeys).not.toContain('rating');
		expect(parsed.ownedKeys).toContain('rating-2');
		const ratings = parsed.fields.filter((f) => f.label === 'Rating');
		expect(ratings.map((f) => f.value)).toEqual(['High']);
	});
});

describe('titleBelongsToFile', () => {
	it.each([
		['Anna', 'Anna', true],
		['Who? Me', 'Who- Me', true],
		['Chapter 1: [Draft]', 'Chapter 1- [Draft]', true],
		['Chapter 1: [Draft]', 'Chapter 1- -Draft-', true],
		['Anna', 'Anna 2', true],
		['Anna', 'Anna Berg', false],
		['Anna', 'Anna 2b', false],
		['', 'Anna', false],
	])('%s / %s → %s', (title, base, expected) => {
		expect(titleBelongsToFile(title, base)).toBe(expected);
	});
});

describe('retitleAfterFileRename', () => {
	const doc = buildEntityDocument('character', 'Anna', [{ id: 'a', label: 'Role', value: 'Hero', type: 'text' }]);

	it('the title follows a rename in the file list', () => {
		const out = retitleAfterFileRename(doc, 'Anna', 'Anna Berg');
		expect(out).toContain('# Anna Berg');
		expect(out).not.toMatch(/^# Anna$/m);
		expect(out).toContain('Hero');
	});

	it('leaves a title the writer set by hand, or one already changed', () => {
		const handEdited = doc.replace('# Anna', '# Robert');
		expect(retitleAfterFileRename(handEdited, 'Anna', 'Anna Berg')).toBeNull();
		expect(retitleAfterFileRename(doc.replace('# Anna', '# Anna Berg'), 'Anna', 'Anna Berg')).toBeNull();
		expect(retitleAfterFileRename(doc, 'Anna', 'Anna')).toBeNull();
	});

	it('leaves a note that is not a sheet', () => {
		expect(retitleAfterFileRename('# Anna\n\nText', 'Anna', 'Anna Berg')).toBeNull();
	});
});
