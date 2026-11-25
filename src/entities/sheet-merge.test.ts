import { CharacterField } from '../grid-data';
import { buildEntityDocument } from './entity-doc';
import { applyEntityEdits, editRelationshipsField, planFieldWrites } from './entity-write';
import { mergeWithSpecDefaults, parseEntityDocument } from './entity-parse';
import { mergeSheetSave, mergeTextBlock, OpenField } from './sheet-merge';
import { parseRelationLines } from '../utils/relations';

function f(id: string, label: string, value: string, type: CharacterField['type'] = 'text'): CharacterField {
	return { id, label, value, type };
}
const snap = (fields: CharacterField[]): OpenField[] => fields.map(({ id, label, type, value }) => ({ id, label, type, value }));
const valueOf = (fields: CharacterField[], label: string) => fields.find((x) => x.label === label)?.value;

describe('mergeTextBlock — Relationships, line by line', () => {
	test('a line added on disk joins the writer’s new line', () => {
		expect(mergeTextBlock('relations', 'Ally: [[Marn]]', 'Ally: [[Marn]]\nSister: [[Alice]]', 'Ally: [[Marn]]\nFriend: [[Carl]]'))
			.toBe('Ally: [[Marn]]\nFriend: [[Carl]]\nSister: [[Alice]]');
	});
	test('a line removed on disk goes when the writer left it alone', () => {
		expect(mergeTextBlock('relations', 'Ally: [[Marn]]\nRival: [[Beron]]', 'Ally: [[Marn]]', 'Ally: [[Marn]]\nRival: [[Beron]]\nFriend: [[Carl]]'))
			.toBe('Ally: [[Marn]]\nFriend: [[Carl]]');
	});
	test('a relationship the writer already wrote their own way is not added twice', () => {
		expect(mergeTextBlock('relations', '', '- Sister: [[Alice]]', 'Sister: [[Alice]] (intensity 7)')).toBe('Sister: [[Alice]] (intensity 7)');
	});
	test('a note on the disk’s line is kept when the writer’s same line has none', () => {
		expect(mergeTextBlock('relations', '', 'Sister: [[B]] (estranged)', 'Sister: [[B]]\nAlly: [[C]]')).toBe('Sister: [[B]] (estranged)\nAlly: [[C]]');
	});
	test('a line with several people adds only the ones the writer doesn’t have', () => {
		expect(mergeTextBlock('relations', '', 'Siblings: [[B]], [[C]]', 'Siblings: [[B]]')).toBe('Siblings: [[B]]\nSiblings: [[C]]');
	});
	test('a sentence that only mentions someone is never taken for their relationship', () => {
		expect(mergeTextBlock('relations', '', '[[Tom]] taught her to read.', 'Raised by [[Tom]].')).toBe('Raised by [[Tom]].\n[[Tom]] taught her to read.');
	});
	test('the writer’s own words after a relationship are never swapped for the other version’s note', () => {
		expect(mergeTextBlock('relations', 'Sister: [[B]]', 'Sister: [[B]] (estranged)', 'Sister: [[B]] taught her to sail'))
			.toBe('Sister: [[B]] taught her to sail\nSister: [[B]] (estranged)');
	});
	test('words on a line added elsewhere are kept even when the writer has that relationship', () => {
		expect(mergeTextBlock('relations', '', 'Sister: [[B]] taught her to sail', 'Sister: [[B]]')).toBe('Sister: [[B]] taught her to sail');
		expect(mergeTextBlock('relations', '', 'Siblings: [[B]], [[C]] (twins)', 'Siblings: [[B]]\nSiblings: [[C]]'))
			.toBe('Siblings: [[B]]\nSiblings: [[C]]\nSiblings: [[B]], [[C]] (twins)');
	});
	test('added lines go after the writer’s last line, not after trailing blank lines', () => {
		expect(mergeTextBlock('relations', '', 'Sister: [[Alice]]', 'Notes about him\n\n')).toBe('Notes about him\nSister: [[Alice]]');
	});
});

describe('mergeTextBlock — other text keeps the writer’s words exactly', () => {
	test('a paragraph added elsewhere follows the writer’s text, even when it names the same person', () => {
		expect(mergeTextBlock('prose', 'She grew up by the sea.', 'She grew up by the sea.\n\n[[Tom]] taught her to read.', 'She grew up by the sea.\n\nRaised by [[Tom]] at the mill.'))
			.toBe('She grew up by the sea.\n\nRaised by [[Tom]] at the mill.\n\n[[Tom]] taught her to read.');
	});
	test('both sides changed different paragraphs: each edit in its own place, nothing glued or lost', () => {
		expect(mergeTextBlock('prose', 'P1\n\nP2', 'P1 edited\n\nP2', 'P1\n\nP2 edited')).toBe('P1 edited\n\nP2 edited');
	});
	test('the same paragraph edited on both sides keeps both versions', () => {
		expect(mergeTextBlock('prose', 'P1\n\nP2', 'P1 theirs\n\nP2', 'P1 mine\n\nP2')).toBe('P1 mine\n\nP2\n\nP1 theirs');
	});
	test('a paragraph deleted elsewhere and left alone by the writer stays deleted', () => {
		expect(mergeTextBlock('prose', 'P1\n\nP2\n\nP3', 'P1\n\nP3 x', 'P1 mine\n\nP2\n\nP3')).toBe('P1 mine\n\nP3 x');
	});
	test('the writer’s own new paragraph and spacing stay as written', () => {
		expect(mergeTextBlock('prose', 'A\n\nB', 'A\n\nB\n\nD', 'A\n\nB\n\n\nC\n')).toBe('A\n\nB\n\n\nC\n\nD');
	});
	test('a list merges item by item', () => {
		expect(mergeTextBlock('list', 'sword\nshield', 'sword\nshield\nlamp', 'sword\nshield\nrope')).toBe('sword\nshield\nrope\nlamp');
	});
});

describe('mergeSheetSave — the sheet changed on disk while its editor was open', () => {
	const open = {
		name: 'Bob',
		aliases: ['Bobby'],
		fields: [f('o1', 'Age', '30'), f('o2', 'Relationships', 'Ally: [[Marn]]', 'textarea'), f('o3', 'Goal', 'Gold', 'textarea')],
	};

	test('fields the writer left alone take the disk’s value; changed ones keep the writer’s', () => {
		const disk = { name: 'Bob', aliases: ['Bobby'], fields: [f('d1', 'Age', '31'), f('d2', 'Relationships', 'Ally: [[Marn]]', 'textarea'), f('d3', 'Goal', 'Gold', 'textarea')] };
		const mine = { name: 'Bob', aliases: ['Bobby'], fields: [f('o1', 'Age', '30'), f('o2', 'Relationships', 'Ally: [[Marn]]', 'textarea'), f('o3', 'Goal', 'Revenge', 'textarea')] };
		const r = mergeSheetSave({ ...open, fields: snap(open.fields) }, disk, mine);
		expect(valueOf(r.fields, 'Age')).toBe('31');
		expect(valueOf(r.fields, 'Goal')).toBe('Revenge');
		// Written against the disk's fields: same ids, so nothing is seen as deleted.
		expect(r.fields.map((x) => x.id).sort()).toEqual(['d1', 'd2', 'd3']);
		expect(r.before.map((b) => b.id)).toEqual(['d1', 'd2', 'd3']);
	});

	test('a relationship mirrored in meanwhile survives the writer’s own relationship edit', () => {
		const disk = { name: 'Bob', aliases: ['Bobby'], fields: [f('d1', 'Age', '30'), f('d2', 'Relationships', 'Ally: [[Marn]]\nBrother: [[Alice]]', 'textarea'), f('d3', 'Goal', 'Gold', 'textarea')] };
		const mine = { name: 'Bob', aliases: ['Bobby'], fields: [f('o1', 'Age', '30'), f('o2', 'Relationships', 'Ally: [[Marn]]\nFriend: [[Carl]]', 'textarea'), f('o3', 'Goal', 'Gold', 'textarea')] };
		const r = mergeSheetSave({ ...open, fields: snap(open.fields) }, disk, mine);
		expect(valueOf(r.fields, 'Relationships')).toBe('Ally: [[Marn]]\nFriend: [[Carl]]\nBrother: [[Alice]]');
	});

	test('the writer deleted the Relationships field: a line mirrored in meanwhile still stays', () => {
		const disk = { name: 'Bob', aliases: [], fields: [f('d1', 'Age', '30'), f('d2', 'Relationships', 'Ally: [[Marn]]\nBrother: [[Alice]]', 'textarea'), f('d3', 'Goal', 'Gold', 'textarea')] };
		const mine = { name: 'Bob', aliases: ['Bobby'], fields: [f('o1', 'Age', '30'), f('o3', 'Goal', 'Gold', 'textarea')] };
		const r = mergeSheetSave({ ...open, fields: snap(open.fields) }, disk, mine);
		expect(valueOf(r.fields, 'Relationships')).toBe('Brother: [[Alice]]');
	});

	test('a field deleted on disk stays deleted unless the writer changed it; one added on disk is kept', () => {
		const disk = { name: 'Bob', aliases: ['Bobby'], fields: [f('d1', 'Age', '30'), f('d2', 'Relationships', 'Ally: [[Marn]]', 'textarea'), f('d9', 'Height', 'Tall')] };
		const mineUntouched = { name: 'Bob', aliases: ['Bobby'], fields: open.fields.map((x) => ({ ...x })) };
		const r1 = mergeSheetSave({ ...open, fields: snap(open.fields) }, disk, mineUntouched);
		expect(valueOf(r1.fields, 'Goal')).toBeUndefined();
		expect(valueOf(r1.fields, 'Height')).toBe('Tall');
		const mineChanged = { ...mineUntouched, fields: mineUntouched.fields.map((x) => (x.label === 'Goal' ? { ...x, value: 'Revenge' } : x)) };
		expect(valueOf(mergeSheetSave({ ...open, fields: snap(open.fields) }, disk, mineChanged).fields, 'Goal')).toBe('Revenge');
	});

	test('a rename elsewhere is kept when the writer did not rename; the writer’s own rename wins', () => {
		const disk = { name: 'Robert', aliases: ['Bobby', 'Rob'], fields: [f('d1', 'Age', '30')] };
		const keep = mergeSheetSave({ ...open, fields: snap(open.fields) }, disk, { name: 'Bob', aliases: ['Bobby'], fields: [] });
		expect(keep.name).toBe('Robert');
		expect(keep.aliases).toEqual(['Bobby', 'Rob']);
		const own = mergeSheetSave({ ...open, fields: snap(open.fields) }, disk, { name: 'Bobbert', aliases: [], fields: [] });
		expect(own.name).toBe('Bobbert');
		// The writer removed "Bobby"; the alias added elsewhere ("Rob") stays.
		expect(own.aliases).toEqual(['Rob']);
	});

	test('the writer renames a field to a name that was just added on disk: both texts stay, under two names', () => {
		const openN = { name: 'Bob', aliases: [], fields: [f('o1', 'Notes', 'old notes', 'textarea')] };
		const disk = { name: 'Bob', aliases: [], fields: [f('d1', 'Notes', 'old notes', 'textarea'), f('d2', 'Backstory', 'from the phone', 'textarea')] };
		const mine = { name: 'Bob', aliases: [], fields: [f('o1', 'Backstory', 'my notes', 'textarea')] };
		const r = mergeSheetSave({ ...openN, fields: snap(openN.fields) }, disk, mine);
		expect(valueOf(r.fields, 'Backstory')).toBe('my notes');
		expect(r.fields.find((x) => x.value === 'from the phone')?.label).not.toBe('Backstory');
		expect(new Set(r.fields.map((x) => x.label.toLowerCase())).size).toBe(r.fields.length);
	});

	test('changed pictures are written into the disk’s picture slots, so untouched ones stay in place', () => {
		const openPics = { name: 'Bob', aliases: [], fields: [f('o1', 'Image', 'a.png', 'image'), f('o2', 'Image', 'b.png', 'image')] };
		const disk = { name: 'Bob', aliases: [], fields: [f('d1', 'Image', 'a.png', 'image'), f('d2', 'Image', 'b.png', 'image'), f('d3', 'Age', '31')] };
		const mine = { name: 'Bob', aliases: [], fields: [f('o1', 'Image', 'a.png', 'image'), f('o2', 'Image', 'c.png', 'image')] };
		const r = mergeSheetSave({ ...openPics, fields: snap(openPics.fields) }, disk, mine);
		expect(r.fields.filter((x) => x.type === 'image').map((x) => `${x.id}:${x.value}`)).toEqual(['d1:a.png', 'd2:c.png']);
	});

	test('never changes the objects it is given', () => {
		const disk = { name: 'Bob', aliases: [], fields: [f('d1', 'Backstory', 'x', 'textarea')] };
		const mine = { name: 'Bob', aliases: [], fields: [f('n1', 'Backstory', 'y', 'textarea'), f('n2', 'Backstory', 'z', 'textarea')] };
		const copy = JSON.stringify([disk, mine]);
		mergeSheetSave({ name: 'Bob', aliases: [], fields: [] }, disk, mine);
		expect(JSON.stringify([disk, mine])).toBe(copy);
	});

	test('pictures: the disk’s when the writer left them alone, the writer’s when they changed them', () => {
		const openPics = { name: 'Bob', aliases: [], fields: [f('o1', 'Image', 'a.png', 'image')] };
		const disk = { name: 'Bob', aliases: [], fields: [f('d1', 'Image', 'a.png', 'image'), f('d2', 'Image', 'b.png', 'image')] };
		const same = mergeSheetSave({ ...openPics, fields: snap(openPics.fields) }, disk, { ...openPics, fields: openPics.fields.map((x) => ({ ...x })) });
		expect(same.fields.filter((x) => x.type === 'image').map((x) => x.value)).toEqual(['a.png', 'b.png']);
		const changed = mergeSheetSave({ ...openPics, fields: snap(openPics.fields) }, disk, { ...openPics, fields: [f('o1', 'Image', 'c.png', 'image')] });
		expect(changed.fields.filter((x) => x.type === 'image').map((x) => x.value)).toEqual(['c.png']);
	});
});

describe('two sheets edited at the same time stay two-sided (the plan’s test)', () => {
	/** A sheet as the Edit-sheet save reads it. */
	function read(content: string, basename: string) {
		const p = parseEntityDocument(content, basename);
		return { ...p, fields: mergeWithSpecDefaults(p.kind, p.fields, p.cleanSlate) };
	}

	test('edit A and B together, add A→B, save A (mirrors into B), save B → both lines stay on B', () => {
		const bobFile = buildEntityDocument('character', 'Bob', [f('x', 'Relationships', 'Ally: [[Marn]]', 'textarea')], 'sg_bob');
		// B's editor opens: what it read and remembered.
		const bobOpen = read(bobFile, 'Bob');
		const openSnap = snap(bobOpen.fields);
		// A is saved with "Sister: [[Bob]]": the mirror writes Bob's half into Bob's file.
		const mirrored = editRelationshipsField(bobFile, 'Bob', (v) => `${v}\nBrother: [[Alice]]`)!.content;
		// Meanwhile the writer adds their own line in B's editor.
		const mine = bobOpen.fields.map((x) => (/^relationships$/i.test(x.label) ? { ...x, value: `${x.value}\nFriend: [[Carl]]` } : { ...x }));
		// Save B: merged against B as it is on disk now.
		const disk = read(mirrored, 'Bob');
		const merged = mergeSheetSave(
			{ name: bobOpen.name, aliases: bobOpen.aliases, fields: openSnap },
			{ name: disk.name, aliases: disk.aliases, fields: disk.fields },
			{ name: bobOpen.name, aliases: bobOpen.aliases, fields: mine },
		);
		const saved = applyEntityEdits(mirrored, 'character', merged.name, planFieldWrites(merged.before, merged.fields));
		const lines = read(saved, 'Bob').fields.flatMap((x) => (x.type === 'textarea' ? parseRelationLines(x.value) : []));
		const keys = lines.map((l) => `${l.label}|${l.target}`);
		expect(keys).toEqual(expect.arrayContaining(['Ally|Marn', 'Brother|Alice', 'Friend|Carl']));
		expect(keys.filter((k) => k === 'Brother|Alice')).toHaveLength(1);
	});
});
