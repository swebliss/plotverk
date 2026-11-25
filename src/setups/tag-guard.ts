import { ChangeSet, ChangeSpec, EditorSelection, EditorState, Extension, Line, Text, Transaction, TransactionSpec } from '@codemirror/state';

/**
 * Keeps a hidden setup tag (` ^pv-k3f9a2` at the end of a marked paragraph)
 * whole and at its paragraph's end while the writer types around it. The tag
 * is invisible (see hide-tags.ts), so ordinary keys must never cut it in half
 * or push text behind it:
 *
 * - the cursor never rests inside or after a tag: it lands just before it, so
 *   typing at the end of a marked paragraph goes before the tag;
 * - Enter (or list continuation, or a multi-line paste) at the end of a marked
 *   paragraph starts the new line after the tag, so the tag stays with the
 *   paragraph it marks;
 * - joining the next line onto a marked paragraph (Delete at its end, or
 *   Backspace at the start of the next line) moves the tag to the end of the
 *   joined line instead of leaving it stuck in the middle;
 * - a selection on the tag's own line stops before it; one begun on an earlier
 *   line (or Ctrl+A) takes it in whole, so deleting it leaves no stray tag.
 *
 * Only the writer's own edits are adjusted — Plotverk's own writes, undo and
 * sync changes pass through untouched. Pure state logic: unit-tested without a DOM.
 */

const TAG_AT_LINE_END = /[ \t]\^pv-[a-z0-9]{6}[ \t]*$/;

export interface HiddenTag {
	/** Start of the tag, its leading space included. */
	from: number;
	/** End of the line (the tag runs to it). */
	to: number;
	/** The tag as written, leading space included, trailing spaces dropped (` ^pv-k3f9a2`). */
	text: string;
	line: Line;
}

export function tagOnLine(line: Line): HiddenTag | null {
	const m = TAG_AT_LINE_END.exec(line.text);
	if (!m) return null;
	return { from: line.from + m.index, to: line.to, text: m[0].replace(/[ \t]+$/, '').replace(/^[ \t]+/, ' '), line };
}

/** The tag whose span `[from, to]` holds `pos`, if any. */
export function tagAt(doc: Text, pos: number): HiddenTag | null {
	return tagOnLine(doc.lineAt(pos));
}

/** Tags touched by `[a, b]` (adjacent ends included). */
function tagsTouched(doc: Text, a: number, b: number): HiddenTag[] {
	const out: HiddenTag[] = [];
	const first = doc.lineAt(a).number;
	const last = doc.lineAt(b).number;
	for (let n = first; n <= last; n++) {
		const tag = tagOnLine(doc.line(n));
		if (tag && tag.from <= b && tag.to >= a) out.push(tag);
	}
	return out;
}

/** Where a moved tag goes on `line`: after its text, before trailing spaces. */
function lineEndForTag(line: Line): number {
	return line.from + line.text.replace(/[ \t]+$/, '').length;
}

interface SingleChange {
	from: number;
	to: number;
	insert: string;
}

function onlyChange(tr: Transaction): SingleChange | null {
	let found: SingleChange | null = null;
	let count = 0;
	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		count++;
		found = { from: fromA, to: toA, insert: inserted.toString() };
	});
	return count === 1 ? found : null;
}

/**
 * The adjusted edit for one change, or null to keep the writer's edit as is.
 * `cursorAfter` is where the cursor goes when the edit is replaced.
 */
export function guardChange(
	doc: Text,
	change: SingleChange,
	userEvent: string,
): { changes: ChangeSpec[]; cursorAfter: number } | 'cancel' | null {
	const { from: a, to: b, insert } = change;
	const tags = tagsTouched(doc, a, b);
	if (tags.length !== 1) return null;
	const tag = tags[0];
	const isCut = userEvent.startsWith('delete.cut');
	const startsWithBreak = /^\r?\n/.test(insert);

	// A line break typed or pasted at the paragraph's visible end (Enter — which
	// in Obsidian also eats the space after the cursor, the tag's own —, list
	// continuation, a multi-line paste): what comes before the first break stays
	// in front of the tag, the rest starts after it. The tag keeps its space and
	// stays at the end of the paragraph it marks.
	const visibleEnd = tag.line.from + tag.line.text.slice(0, tag.from - tag.line.from).replace(/[ \t]+$/, '').length;
	let sa = a;
	let sInsert = insert;
	if (/\n/.test(insert) && a < visibleEnd && b >= visibleEnd && b <= tag.to) {
		// Obsidian's list / quote / callout Enter replaces the last visible
		// character with itself plus the break (`.` → `.\n- `): the echoed text
		// is no change, so the edit really starts at the visible end.
		const echoed = doc.sliceString(a, visibleEnd);
		const firstBreak = insert.search(/\r?\n/);
		if (insert.startsWith(echoed) && firstBreak >= echoed.length) {
			sa = visibleEnd;
			sInsert = insert.slice(echoed.length);
		}
	}
	const breakAt = sInsert.search(/\r?\n/);
	// Also when it replaces the paragraph's last words (a paste or Enter over a
	// selection that starts on the tag's line and ends at the visible end).
	const atEnd = sa >= visibleEnd || (sa >= tag.line.from && b >= visibleEnd);
	if (breakAt !== -1 && atEnd && sa < tag.to && b <= tag.to) {
		const before = sInsert.slice(0, breakAt);
		const after = sInsert.slice(breakAt);
		const delFrom = Math.min(sa, tag.from);
		const delTo = Math.max(delFrom, Math.min(b, tag.from));
		const changes: ChangeSpec[] = [];
		if (before || delTo > delFrom) changes.push({ from: delFrom, to: delTo, insert: before });
		changes.push({ from: tag.to, insert: after });
		return { changes, cursorAfter: tag.to - (delTo - delFrom) + before.length + after.length };
	}

	// Pure insertion (typing, Enter, paste).
	if (a === b) {
		if (a < tag.from) return null;
		if (startsWithBreak) {
			if (a === tag.to) return null;
			// Enter at the paragraph's visible end: the new line starts after the tag.
			return { changes: [{ from: tag.to, insert }], cursorAfter: tag.to + insert.length };
		}
		if (a === tag.from) return null;
		// Anything else typed inside or after the tag goes in front of it.
		return { changes: [{ from: tag.from, insert }], cursorAfter: tag.from + insert.length };
	}

	// The edit crosses the end of the tag's line: that line joins what follows.
	if (b > tag.to) {
		if (a > tag.to) return null;
		const from = Math.min(a, tag.from);
		// Deleting from the very start of the line takes the tag with the text,
		// and a cut carries the tag to wherever it is pasted — unless the cut
		// starts after the tag (a drag begun past the line's end), so the
		// clipboard never got it.
		const keepTag = (!isCut || a >= tag.to) && a > tag.line.from && !/\n/.test(insert);
		if (!keepTag) return from === a ? null : { changes: [{ from, to: b, insert }], cursorAfter: from + insert.length };
		const joined = doc.lineAt(b);
		if (tagOnLine(joined)) {
			// The joined line already ends in a tag of its own: two marks cannot
			// share one paragraph end, so this one lets go of its place cleanly
			// (the setup keeps its sentence and says the place is gone).
			return { changes: [{ from, to: b, insert }], cursorAfter: from + insert.length };
		}
		return {
			changes: [{ from, to: b, insert }, { from: lineEndForTag(joined), insert: tag.text }],
			cursorAfter: from + insert.length,
		};
	}

	// The edit ends inside the tag but starts before it: stop before the tag —
	// unless it takes the whole line, the tag included (Ctrl+A, or a selection
	// begun on an earlier line): that paragraph's end is gone, and so is its tag.
	if (a < tag.from) {
		if (a <= tag.line.from && b >= tag.to) return null;
		// From an earlier line to exactly the paragraph's end (a selection there
		// stops before the hidden tag): the marked paragraph's end is gone, so its
		// tag goes too instead of clinging to the paragraph above.
		if (a < tag.line.from && b === tag.from && !/\n/.test(insert)) {
			return { changes: [{ from: a, to: tag.to, insert }], cursorAfter: a + insert.length };
		}
		return { changes: [{ from: a, to: tag.from, insert }], cursorAfter: a + insert.length };
	}

	// The edit lies wholly inside the hidden tag.
	if (insert) return { changes: [{ from: tag.from, insert }], cursorAfter: tag.from + insert.length };
	// Delete at the paragraph's visible end: join the next line, tag moves to its end.
	if (tag.line.number >= doc.lines) return 'cancel';
	const next = doc.line(tag.line.number + 1);
	if (tagOnLine(next)) return { changes: [{ from: tag.from, to: next.from }], cursorAfter: tag.from };
	return {
		changes: [{ from: tag.from, to: next.from }, { from: lineEndForTag(next), insert: tag.text }],
		cursorAfter: tag.from,
	};
}

/**
 * Where a selection's ends go around tags. Only a selection that covers the
 * whole note (Ctrl+A) or runs on past the tag's line may take a tag in whole;
 * any other selection ending on a tag's line stops before it, so selecting a
 * paragraph's words never selects its invisible tag (and Bold / Italic /
 * `[[` wrap the words, never the tag).
 */
function normalizeSelection(doc: Text, anchor: number, head: number): { anchor: number; head: number } {
	const wholeDoc = Math.min(anchor, head) === 0 && Math.max(anchor, head) === doc.length;
	const ht = tagAt(doc, head);
	if (ht && head > ht.from) head = wholeDoc ? ht.to : ht.from;
	const at = tagAt(doc, anchor);
	if (at && anchor > at.from && head !== anchor) {
		if (wholeDoc || head > at.to) {
			// Begun inside or right after the tag (a drag from past the line's end)
			// and running on past it: whole tag or none of it.
			if (anchor < at.to) anchor = at.to;
		} else {
			anchor = at.from;
		}
	}
	return { anchor, head };
}

/** Move empty cursors that sit inside or after a tag to just before it. */
function normalizeCursors(state: { doc: Text; selection: EditorSelection }): EditorSelection | null {
	let changed = false;
	const ranges = state.selection.ranges.map((r) => {
		if (!r.empty) {
			// A selection's ends never rest inside a tag either.
			const n = normalizeSelection(state.doc, r.anchor, r.head);
			if (n.anchor === r.anchor && n.head === r.head) return r;
			changed = true;
			return n.anchor === n.head ? EditorSelection.cursor(n.head) : EditorSelection.range(n.anchor, n.head);
		}
		const tag = tagAt(state.doc, r.head);
		if (tag && r.head > tag.from) {
			changed = true;
			return EditorSelection.cursor(tag.from);
		}
		return r;
	});
	return changed ? EditorSelection.create(ranges, state.selection.mainIndex) : null;
}

/**
 * Safety net for edits made of several changes (Bold / Italic / Highlight /
 * `[[` wrap a selection in two inserts): an insert landing right after a tag,
 * on its line, goes in front of the tag instead, so the tag stays the line's
 * block id. Null when nothing needs moving.
 */
function moveInsertsOffTagEnds(tr: Transaction): TransactionSpec | null {
	const doc = tr.startState.doc;
	const specs: ChangeSpec[] = [];
	const moved: HiddenTag[] = [];
	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		const text = inserted.toString();
		let from = fromA;
		let to = toA;
		if (fromA === toA && text && !/^\r?\n/.test(text)) {
			const tag = tagAt(doc, fromA);
			if (tag && fromA === tag.to && tag.to > tag.from) {
				from = to = tag.from;
				moved.push(tag);
			}
		}
		specs.push({ from, to, insert: text });
	});
	if (moved.length === 0) return null;
	const changes = ChangeSet.of(specs, doc.length);
	// The writer's selection, in the old text, with any end inside a moved tag
	// put at the tag's start; then carried through the corrected edit.
	const back = tr.changes.invertedDesc;
	const visible = (p: number) => {
		for (const tag of moved) if (p > tag.from && p <= tag.to) return tag.from;
		return p;
	};
	const ranges = tr.newSelection.ranges.map((r) => {
		if (r.empty) return EditorSelection.cursor(changes.mapPos(visible(back.mapPos(r.head, -1)), -1));
		const from = changes.mapPos(visible(back.mapPos(r.from, 1)), 1);
		const to = changes.mapPos(visible(back.mapPos(r.to, -1)), -1);
		return r.anchor <= r.head ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
	});
	return {
		changes,
		selection: EditorSelection.create(ranges, tr.newSelection.mainIndex),
		userEvent: userEventOf(tr),
		scrollIntoView: tr.scrollIntoView,
	};
}

function userEventOf(tr: Transaction): string {
	return tr.annotation(Transaction.userEvent) ?? '';
}

/** The editor extension: edit guard first, then cursor placement. */
export function setupTagGuard(): Extension {
	const editGuard = EditorState.transactionFilter.of((tr) => {
		if (!tr.docChanged) return tr;
		const event = userEventOf(tr);
		if (!event.startsWith('input') && !event.startsWith('delete')) return tr;
		const change = onlyChange(tr);
		if (!change) return moveInsertsOffTagEnds(tr) ?? tr;
		const guarded = guardChange(tr.startState.doc, change, event);
		if (guarded === null) return tr;
		if (guarded === 'cancel') return [];
		const spec: TransactionSpec = {
			changes: guarded.changes,
			selection: EditorSelection.cursor(guarded.cursorAfter),
			userEvent: event,
			scrollIntoView: tr.scrollIntoView,
		};
		return spec;
	});

	const cursorGuard = EditorState.transactionFilter.of((tr) => {
		if (!tr.selection && !tr.docChanged) return tr;
		const doc = tr.newDoc;
		const fixed = normalizeCursors({ doc, selection: tr.newSelection });
		if (!fixed) return tr;
		return [tr, { selection: fixed, sequential: true }];
	});

	return [editGuard, cursorGuard];
}
