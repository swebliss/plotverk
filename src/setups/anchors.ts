// Pure — no Obsidian imports, so every offset rule here is unit-tested.

/**
 * Setup marks remember a place in the text by an Obsidian block id at the end
 * of the marked paragraph (`… the sword. ^pv-k3f9a2`). The tag travels with the
 * words: renaming the scene, moving its folder, reorganising on the phone or
 * cutting the paragraph into another scene never breaks the link, because
 * Obsidian's metadata cache finds the block id wherever the paragraph now is.
 *
 * Plotverk's own tags always look like `pv-` + six base-36 characters. A block
 * id the writer made herself (any other `^id`) is reused as it is, never
 * replaced, so her own block links keep working.
 */

export const PV_ANCHOR_RE = /^pv-[a-z0-9]{6}$/;

/** A Plotverk tag (`pv-k3f9a2`), not a block id the writer made herself. */
export function isPlotverkAnchor(id: string): boolean {
	return PV_ANCHOR_RE.test(id);
}

/** A fresh `pv-xxxxxx` id. `taken` lets the caller skip ids already in use. */
export function newAnchorId(taken: (id: string) => boolean = () => false, rand: () => number = Math.random): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	for (let attempt = 0; attempt < 50; attempt++) {
		let id = 'pv-';
		for (let i = 0; i < 6; i++) id += chars[Math.floor(rand() * chars.length) % chars.length];
		if (!taken(id)) return id;
	}
	// 36^6 ids: fifty collisions in a row means `rand` is broken, not bad luck.
	throw new Error('Could not make a new setup tag');
}

interface Line {
	/** Offset of the first character. */
	start: number;
	/** Offset just past the last character, before any `\r\n` / `\n`. */
	end: number;
	text: string;
	/** Inside frontmatter, a fenced code block (fence lines included). */
	shielded: boolean;
}

function splitLines(text: string): Line[] {
	const lines: Line[] = [];
	let pos = 0;
	while (pos <= text.length) {
		const nl = text.indexOf('\n', pos);
		let end = nl === -1 ? text.length : nl;
		if (end > pos && text[end - 1] === '\r') end--;
		lines.push({ start: pos, end, text: text.slice(pos, end), shielded: false });
		if (nl === -1) break;
		pos = nl + 1;
	}
	// Frontmatter: only at the very top.
	if (lines.length && /^\uFEFF?---[ \t]*$/.test(lines[0].text)) {
		for (let i = 1; i < lines.length; i++) {
			if (/^(---|\.\.\.)[ \t]*$/.test(lines[i].text)) {
				for (let j = 0; j <= i; j++) lines[j].shielded = true;
				break;
			}
		}
	}
	// Fenced code (``` or ~~~). An unclosed fence runs to the end.
	let fence: { ch: string; len: number } | null = null;
	for (const line of lines) {
		if (line.shielded) continue;
		const open = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line.text);
		if (fence) {
			line.shielded = true;
			if (open && open[1][0] === fence.ch && open[1].length >= fence.len && line.text.trim() === open[1]) fence = null;
		} else if (open) {
			line.shielded = true;
			fence = { ch: open[1][0], len: open[1].length };
		}
	}
	return lines;
}

const isBlank = (l: Line) => l.text.trim() === '';
const isHeading = (l: Line) => /^[ \t]{0,3}#{1,6}(?:[ \t]|$)/.test(l.text);
const isTable = (l: Line) => /^[ \t]*\|/.test(l.text);
const isListStart = (l: Line) => /^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+\S/.test(l.text);
const isQuote = (l: Line) => /^[ \t]*>/.test(l.text);
/** A quote line with nothing after its `>` marks — it separates paragraphs inside the quote. */
const isEmptyQuote = (l: Line) => isQuote(l) && l.text.replace(/^[ \t>]*/, '').trim() === '';
/** A line that is only a block id (`^my-id`), as Obsidian writes after a list or table. */
const OWN_LINE_ID = /^[ \t]*\^([A-Za-z0-9-]+)[ \t]*$/;
/** A block id at the end of a line, after whitespace. */
const LINE_END_ID = /[ \t]\^([A-Za-z0-9-]+)[ \t]*$/;

/** Can `b` continue the paragraph that `a` is part of (b directly below a)? */
function continues(a: Line, b: Line): boolean {
	if (a.shielded || b.shielded) return false;
	if (isBlank(a) || isBlank(b) || isHeading(a) || isHeading(b) || isTable(a) || isTable(b)) return false;
	if (isQuote(a) !== isQuote(b)) return false;
	if (isEmptyQuote(a) || isEmptyQuote(b)) return false;
	if (OWN_LINE_ID.test(b.text)) return false;
	if (isListStart(b)) return false; // a new list item starts a new block
	return true;
}

export type AnchorRefusal = 'frontmatter-or-code' | 'heading' | 'table' | 'empty';

export type AnchorPlan =
	/** The paragraph already ends in a block id — Plotverk's or the writer's own. */
	| { kind: 'reuse'; id: string; line: number }
	/** Replace `[from, to)` with `insert` (always ` ^<id>`). */
	| { kind: 'insert'; id: string; line: number; from: number; to: number; insert: string }
	| { kind: 'refuse'; reason: AnchorRefusal };

/**
 * Where the tag for the paragraph holding `offset` goes. `makeId` is only
 * called when a new tag is needed. The tag replaces any trailing spaces on the
 * paragraph's last line (they mean nothing at the end of a paragraph), so
 * Obsidian always sees it as the line's block id.
 */
export function planAnchor(text: string, offset: number, makeId: () => string): AnchorPlan {
	const lines = splitLines(text);
	const at = Math.max(0, Math.min(offset, text.length));
	let i = lines.findIndex((l, idx) => at >= l.start && (at <= l.end || idx === lines.length - 1 || at < lines[idx + 1].start));
	if (i === -1) i = lines.length - 1;
	const line = lines[i];
	if (line.shielded) return { kind: 'refuse', reason: 'frontmatter-or-code' };
	if (isHeading(line)) return { kind: 'refuse', reason: 'heading' };
	if (isTable(line)) return { kind: 'refuse', reason: 'table' };
	if (isBlank(line) || isEmptyQuote(line)) return { kind: 'refuse', reason: 'empty' };

	let last = i;
	if (OWN_LINE_ID.test(line.text)) {
		// The cursor sits on a lone `^id` line: it belongs to the block above.
		const m = OWN_LINE_ID.exec(line.text)!;
		return { kind: 'reuse', id: m[1], line: i };
	}
	while (last + 1 < lines.length && continues(lines[last], lines[last + 1])) last++;

	const end = lines[last];
	const own = LINE_END_ID.exec(end.text);
	if (own) return { kind: 'reuse', id: own[1], line: last };
	const next = lines[last + 1];
	if (next && !next.shielded) {
		const lone = OWN_LINE_ID.exec(next.text);
		if (lone) return { kind: 'reuse', id: lone[1], line: last + 1 };
	}

	const trimmedEnd = end.start + end.text.replace(/[ \t]+$/, '').length;
	const id = makeId();
	return { kind: 'insert', id, line: last, from: trimmedEnd, to: end.end, insert: ` ^${id}` };
}

/** Apply an `insert` plan to `text` (tests and non-editor callers). */
export function applyAnchorPlan(text: string, plan: AnchorPlan): string {
	if (plan.kind !== 'insert') return text;
	return text.slice(0, plan.from) + plan.insert + text.slice(plan.to);
}

/** `[from, to)` of every inline code span (`` `x` ``, ``` ``x`` ```) on one line. */
function inlineCodeRanges(lineText: string): Array<[number, number]> {
	const runs: Array<{ at: number; len: number }> = [];
	const re = /`+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(lineText))) runs.push({ at: m.index, len: m[0].length });
	const out: Array<[number, number]> = [];
	for (let i = 0; i < runs.length; i++) {
		const j = runs.findIndex((r, k) => k > i && r.len === runs[i].len);
		if (j === -1) continue; // a lone backtick run is just text
		out.push([runs[i].at, runs[j].at + runs[j].len]);
		i = j;
	}
	return out;
}

/**
 * A Plotverk tag anywhere on a line, its leading space included. Only a tag at
 * a line's end is a block id, but a copy can land mid-line (copied on the
 * phone, cut from a drag begun past the line's end, edited without Plotverk).
 * Never a footnote (`[^pv-…]`).
 */
const LOOSE_PV_TAG = /[ \t]?\^pv-[a-z0-9]{6}(?![A-Za-z0-9-])/g;

/** Column ranges `[from, to)` of Plotverk tags in the middle of a line, outside inline code. */
function looseTagRanges(lineText: string): Array<[number, number]> {
	if (!lineText.includes('^pv-')) return [];
	const code = inlineCodeRanges(lineText);
	const out: Array<[number, number]> = [];
	LOOSE_PV_TAG.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = LOOSE_PV_TAG.exec(lineText))) {
		const from = m.index;
		let to = from + m[0].length;
		const spaced = /^[ \t]/.test(m[0]);
		if (!spaced && lineText[from - 1] === '[') continue; // a footnote
		if (code.some(([a, b]) => from < b && to > a)) continue;
		// A tag at the very start of a line takes the space after it instead.
		if (!spaced && /[ \t]/.test(lineText[to] ?? '')) to++;
		out.push([from, to]);
	}
	return out;
}

/**
 * Remove block-id tags from text meant for readers (exports, word counts).
 * By default only Plotverk's own `^pv-xxxxxx` tags go (at a line's end or
 * stuck mid-line); `all` also removes the writer's own block ids at line ends,
 * including lone `^id` lines. Code blocks, inline code, frontmatter and
 * footnotes are left exactly as they are.
 */
export function stripAnchors(text: string, opts?: { all?: boolean }): string {
	if (!text || !text.includes('^')) return text;
	const lines = splitLines(text);
	const tail = opts?.all ? /[ \t]+\^[A-Za-z0-9-]+(?=[ \t]*$)/ : /[ \t]+\^pv-[a-z0-9]{6}(?=[ \t]*$)/;
	let out = '';
	let pos = 0;
	for (const line of lines) {
		if (line.shielded) continue;
		if (opts?.all && OWN_LINE_ID.test(line.text)) {
			// Drop the whole line, newline included.
			const nlEnd = text.indexOf('\n', line.end);
			const cut = nlEnd === -1 ? text.length : nlEnd + 1;
			out += text.slice(pos, line.start);
			pos = cut;
			continue;
		}
		if (!opts?.all && /^[ \t]*\^pv-[a-z0-9]{6}[ \t]*$/.test(line.text)) {
			const nlEnd = text.indexOf('\n', line.end);
			const cut = nlEnd === -1 ? text.length : nlEnd + 1;
			out += text.slice(pos, line.start);
			pos = cut;
			continue;
		}
		let body = line.text;
		const m = tail.exec(body);
		if (m) body = body.slice(0, m.index) + body.slice(m.index + m[0].length);
		const loose = looseTagRanges(body);
		for (let i = loose.length - 1; i >= 0; i--) body = body.slice(0, loose[i][0]) + body.slice(loose[i][1]);
		if (body === line.text) continue;
		out += text.slice(pos, line.start) + body;
		pos = line.end;
	}
	return out + text.slice(pos);
}

/**
 * Every Plotverk tag in `text` with the line it ends (0-based), skipping code
 * and frontmatter. Used to find a mark again when the metadata cache is not
 * ready yet, and by tests.
 */
export function findAnchors(text: string): Array<{ id: string; line: number }> {
	const found: Array<{ id: string; line: number }> = [];
	if (!text.includes('^pv-')) return found;
	splitLines(text).forEach((line, idx) => {
		if (line.shielded) return;
		const m = /(?:^|[ \t])\^(pv-[a-z0-9]{6})[ \t]*$/.exec(line.text);
		if (m) found.push({ id: m[1], line: idx });
	});
	return found;
}

/**
 * The visible-text column ranges `[from, to)` of every Plotverk tag on one
 * line, leading space included, in order — what the editor hides while
 * writing. The line-end tag (the real block id) runs to the line's end; stray
 * mid-line copies outside inline code are listed too.
 */
export function anchorRangesInLine(lineText: string): Array<[number, number]> {
	if (!lineText.includes('^pv-')) return [];
	const m = /[ \t]\^pv-[a-z0-9]{6}[ \t]*$/.exec(lineText);
	const endFrom = m ? m.index : lineText.length;
	const found = looseTagRanges(lineText.slice(0, endFrom)).filter(([, to]) => to <= endFrom);
	if (m) found.push([m.index, m.index + m[0].length]);
	// Tags side by side touch or overlap: hand them over as one range.
	const out: Array<[number, number]> = [];
	for (const [from, to] of found) {
		const last = out[out.length - 1];
		if (last && from <= last[1]) last[1] = Math.max(last[1], to);
		else out.push([from, to]);
	}
	return out;
}
