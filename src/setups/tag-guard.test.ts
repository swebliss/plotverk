import { EditorSelection, EditorState, TransactionSpec } from '@codemirror/state';
import { setupTagGuard } from './tag-guard';

const TAG = ' ^pv-abc123';
const make = (doc: string, cursor?: number) =>
	EditorState.create({ doc, selection: cursor === undefined ? undefined : EditorSelection.cursor(cursor), extensions: [setupTagGuard()] });
const run = (state: EditorState, spec: TransactionSpec) => state.update(spec).state;
const text = (s: EditorState) => s.doc.toString();
const head = (s: EditorState) => s.selection.main.head;

describe('setup tag guard', () => {
	const doc = `She hid the key.${TAG}\nNext line.`;
	const visibleEnd = 'She hid the key.'.length;
	const lineEnd = visibleEnd + TAG.length;

	it('puts the cursor before the tag when it lands after it (End key, click past the line)', () => {
		const s = run(make(doc, 0), { selection: EditorSelection.cursor(lineEnd) });
		expect(head(s)).toBe(visibleEnd);
	});

	it('typing at the end of a marked paragraph goes before the tag', () => {
		const s0 = make(doc, visibleEnd);
		const s = run(s0, { changes: { from: visibleEnd, insert: ' Then' }, userEvent: 'input.type' });
		expect(text(s)).toBe(`She hid the key. Then${TAG}\nNext line.`);
	});

	it('Enter at the visible end starts the new line after the tag', () => {
		const s = run(make(doc, visibleEnd), { changes: { from: visibleEnd, insert: '\n' }, userEvent: 'input' });
		expect(text(s)).toBe(`She hid the key.${TAG}\n\nNext line.`);
		expect(head(s)).toBe(lineEnd + 1);
	});

	it('Delete at the visible end joins the next line and keeps the tag at the end', () => {
		// Without atomic ranges the key deletes the space; with them, the whole tag.
		for (const to of [visibleEnd + 1, lineEnd]) {
			const s = run(make(doc, visibleEnd), { changes: { from: visibleEnd, to }, userEvent: 'delete.forward' });
			expect(text(s)).toBe(`She hid the key.Next line.${TAG}`);
		}
	});

	it('Backspace at the start of the next line joins it the same way', () => {
		const s = run(make(doc, lineEnd + 1), { changes: { from: lineEnd, to: lineEnd + 1 }, userEvent: 'delete.backward' });
		expect(text(s)).toBe(`She hid the key.Next line.${TAG}`);
		expect(head(s)).toBe(visibleEnd);
	});

	it('Delete at the end of the last line does nothing (the tag stays)', () => {
		const last = `Only.${TAG}`;
		const s = run(make(last, 5), { changes: { from: 5, to: last.length }, userEvent: 'delete.forward' });
		expect(text(s)).toBe(last);
	});

	it('a selection deletion that ends in the tag stops before it', () => {
		const s = run(make(doc, 4), { changes: { from: 4, to: visibleEnd + 3 }, userEvent: 'delete.selection' });
		expect(text(s)).toBe(`She ${TAG}\nNext line.`);
	});

	it('deleting whole lines from their start takes the tag along', () => {
		const s = run(make(doc, 0), { changes: { from: 0, to: lineEnd + 1 }, userEvent: 'delete.selection' });
		expect(text(s)).toBe('Next line.');
	});

	it('a cut keeps the tag with the cut text', () => {
		const s = run(make(doc, 4), { changes: { from: 4, to: lineEnd + 1 }, userEvent: 'delete.cut' });
		expect(text(s)).toBe('She Next line.');
	});

	it('two tags never end up on one line', () => {
		const two = `A.${TAG}\nB. ^pv-zzz999`;
		const s = run(make(two, 2), { changes: { from: 2, to: 2 + TAG.length }, userEvent: 'delete.forward' });
		expect(text(s)).toBe('A.B. ^pv-zzz999');
	});

	it("leaves Plotverk's own writes, undo and sync alone", () => {
		const s = run(make(doc, 0), { changes: { from: visibleEnd, to: lineEnd } });
		expect(text(s)).toBe('She hid the key.\nNext line.');
	});

	// ── Obsidian's real edit shapes ────────────────────────────────────────────

	it("real Enter (insertNewlineAndIndent eats the space after the cursor) keeps the tag on its paragraph", () => {
		// CM's insertNewlineAndIndent deletes whitespace after the cursor: the tag's own space.
		let s = run(make(doc, visibleEnd), { changes: { from: visibleEnd, to: visibleEnd + 1, insert: '\n' }, userEvent: 'input' });
		expect(text(s)).toBe(`She hid the key.${TAG}\n\nNext line.`);
		expect(head(s)).toBe(lineEnd + 1);
		// Enter again on the empty line, then type a new paragraph: the tag stays put.
		s = run(s, { changes: { from: head(s), insert: '\n' }, selection: EditorSelection.cursor(head(s) + 1), userEvent: 'input' });
		s = run(s, { changes: { from: head(s), insert: 'A brand new paragraph.' }, userEvent: 'input.type' });
		expect(text(s)).toBe(`She hid the key.${TAG}\n\nA brand new paragraph.\nNext line.`);
	});

	it('real Enter on the last line keeps the tag there', () => {
		const last = `Only.${TAG}`;
		const s = run(make(last, 5), { changes: { from: 5, to: 6, insert: '\n' }, userEvent: 'input' });
		expect(text(s)).toBe(`Only.${TAG}\n`);
		expect(head(s)).toBe(last.length + 1);
	});

	it('list continuation (Enter in a list item) keeps the tag on its item', () => {
		const list = `- She hid the key.${TAG}\n- Next`;
		const end = '- She hid the key.'.length;
		for (const to of [end, end + 1]) {
			const s = run(make(list, end), { changes: { from: end, to, insert: '\n- ' }, userEvent: 'input.type' });
			expect(text(s)).toBe(`- She hid the key.${TAG}\n- \n- Next`);
			expect(head(s)).toBe(end + TAG.length + 3);
		}
	});

	it('a multi-line paste at the visible end: the first line joins the paragraph, the rest goes after the tag', () => {
		const s = run(make(doc, visibleEnd), { changes: { from: visibleEnd, insert: ' More.\n\nNew para.' }, userEvent: 'input.paste' });
		expect(text(s)).toBe(`She hid the key. More.${TAG}\n\nNew para.\nNext line.`);
		expect(head(s)).toBe(text(s).indexOf('New para.') + 'New para.'.length);
	});

	it('a multi-line paste replacing the tag space (Enter-like shape) splits the same way', () => {
		const s = run(make(doc, visibleEnd), { changes: { from: visibleEnd, to: visibleEnd + 1, insert: ' More.\nNew.' }, userEvent: 'input.paste' });
		expect(text(s)).toBe(`She hid the key. More.${TAG}\nNew.\nNext line.`);
	});

	it('Ctrl+A covers a tag on the last line; Delete and cut then remove it too', () => {
		const two = `First para.\n\nShe hid the key.${TAG}`;
		for (const d of [two, `Only.${TAG}`]) {
			const sel = run(make(d, 0), { selection: EditorSelection.range(0, d.length) });
			expect(sel.selection.main.from).toBe(0);
			expect(sel.selection.main.to).toBe(d.length);
			for (const userEvent of ['delete.backward', 'delete.cut', 'delete.selection']) {
				const s = run(sel, { changes: { from: 0, to: d.length }, userEvent });
				expect(text(s)).toBe('');
			}
		}
	});

	// Obsidian 1.15's list / quote / callout Enter replaces the last visible
	// character with itself + the break: from = visibleEnd - 1, insert = "." + "\n- ".
	it.each([
		['list', '- She hid the key.', '\n- ', '\n- Next'],
		['quote', '> She hid the key.', '\n> ', '\n> Next'],
		['callout', '> [!note] Title\n> She hid the key.', '\n> ', ''],
	])('Enter in a %s item (last character echoed back) keeps the tag on its line', (_kind, before, cont, rest) => {
		const d = `${before}${TAG}${rest}`;
		const end = before.length;
		for (const to of [end, end + 1]) {
			const s = run(make(d, end), { changes: { from: end - 1, to, insert: '.' + cont }, userEvent: 'input.type' });
			expect(text(s)).toBe(`${before}${TAG}${cont}${rest}`);
			expect(head(s)).toBe(end + TAG.length + cont.length);
		}
	});

	it('Shift+End from an earlier line stops before the tag, so Bold wraps the words, not the tag', () => {
		const d = `Intro.\nShe hid the key.${TAG}\nAfter.`;
		const tagLineEnd = d.indexOf('\nAfter.');
		const s = run(make(d, 0), { selection: EditorSelection.range(2, tagLineEnd) });
		const end = tagLineEnd - TAG.length;
		expect(s.selection.main.head).toBe(end);
		// Obsidian's Bold: "**" at the selection start and at its end, one transaction.
		const s2 = run(s, { changes: [{ from: 2, insert: '**' }, { from: s.selection.main.head, insert: '**' }], userEvent: 'input' });
		expect(text(s2)).toBe(`In**tro.\nShe hid the key.**${TAG}\nAfter.`);
	});

	it('deleting from an earlier line to the end of a marked paragraph takes its tag along (Backspace, type-over, cut)', () => {
		const d = `Intro.\nShe hid the key.${TAG}\nAfter.`;
		const tagFrom = d.indexOf(TAG);
		const sel = run(make(d, 0), { selection: EditorSelection.range(3, d.indexOf('\nAfter.')) });
		expect(sel.selection.main.head).toBe(tagFrom);
		const cases: Array<[string, string, string]> = [['delete.backward', '', 'Int\nAfter.'], ['input.type', 'X', 'IntX\nAfter.'], ['delete.cut', '', 'Int\nAfter.']];
		for (const [userEvent, insert, want] of cases) {
			const s = run(sel, { changes: { from: 3, to: tagFrom, insert }, userEvent });
			expect(text(s)).toBe(want);
			expect(head(s)).toBe(3 + insert.length);
		}
	});

	it("replacing a paragraph's last words with text holding a line break keeps the tag after the first line", () => {
		const d = `She hid it in the box.${TAG}\nNext.`;
		const from = d.indexOf('the box.');
		const tagFrom = d.indexOf(TAG);
		// Paste over the selected last words.
		let s = run(make(d, from), { changes: { from, to: tagFrom, insert: 'the chest.\n\nLater.' }, userEvent: 'input.paste' });
		expect(text(s)).toBe(`She hid it in the chest.${TAG}\n\nLater.\nNext.`);
		expect(head(s)).toBe(text(s).indexOf('Later.') + 'Later.'.length);
		// Enter over a selection (real shape also eats the tag's space).
		s = run(make(d, from), { changes: { from, to: tagFrom + 1, insert: '\n' }, userEvent: 'input' });
		expect(text(s)).toBe(`She hid it in ${TAG}\n\nNext.`);
	});

	it('a selection reaching past the tag line is left alone', () => {
		const d = `Intro.\nShe hid the key.${TAG}\nAfter.`;
		const s = run(make(d, 0), { selection: EditorSelection.range(2, d.length - 2) });
		expect(s.selection.main.head).toBe(d.length - 2);
	});

	it('a wrap that lands right after a tag (Ctrl+A, then Bold) puts the closing marks before it', () => {
		const d = `Only.${TAG}`;
		const sel = run(make(d, 0), { selection: EditorSelection.range(0, d.length) });
		const s = run(sel, { changes: [{ from: 0, insert: '**' }, { from: d.length, insert: '**' }], selection: EditorSelection.range(2, d.length + 2), userEvent: 'input' });
		expect(text(s)).toBe(`**Only.**${TAG}`);
		expect(s.selection.main.from).toBe(2);
		expect(s.selection.main.to).toBe(7);
	});

	it('a selection on the same line still stops before the tag (Shift+End)', () => {
		const s = run(make(doc, 0), { selection: EditorSelection.range(0, lineEnd) });
		expect(s.selection.main.head).toBe(visibleEnd);
	});

	it('a drag started past the line end, going back, never selects the hidden tag', () => {
		const s = run(make(doc, 0), { selection: EditorSelection.range(lineEnd, 4) });
		expect(s.selection.main.anchor).toBe(visibleEnd);
		expect(s.selection.main.head).toBe(4);
	});

	it('a cut starting right after the tag (drag from past the line end) keeps the tag', () => {
		const d = `She hid the key.${TAG}\nNext line.\nThird.`;
		const b = lineEnd + 1 + 'Next line.'.length;
		const s = run(make(d, 0), { changes: { from: lineEnd, to: b }, userEvent: 'delete.cut' });
		expect(text(s)).toBe(`She hid the key.${TAG}\nThird.`);
	});

	it("does nothing on lines without a tag, or with the writer's own id", () => {
		const own = 'Mine. ^my-id\nx';
		const s = run(make(own, 5), { changes: { from: 5, insert: '\n' }, userEvent: 'input' });
		expect(text(s)).toBe('Mine.\n ^my-id\nx');
	});
});
