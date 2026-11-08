// Pure: whole-sentence quotes for the Coach tab — no Obsidian imports.

/** One piece of a quote: plain text, a marked word, or the "…" between two separate sentences. */
export interface QuotePiece {
	text: string;
	mark?: boolean;
	gap?: boolean;
}

const LIST_PREFIX = /^[ \t]*(?:>[ \t]*)*(?:[-*+][ \t]+|\d+[.)][ \t]+)?/;
// A sentence runs up to . ! ? or … (plus any closing quotes/brackets/emphasis) followed by a space, or the line end.
const SENTENCE = /[^ \t].*?(?:[.!?…]+["'”’»)\]*_]*(?=[ \t]|$)|$)/gu;

/**
 * Every sentence in `text`, split the same way as sentenceBounds: on . ! ?
 * (and …) followed by a space, never across a line break. Quote/list markers
 * at a line start and trailing spaces are left out; blank lines give nothing.
 */
export function sentenceSpans(text: string): Array<{ from: number; to: number }> {
	const out: Array<{ from: number; to: number }> = [];
	const re = new RegExp(SENTENCE.source, SENTENCE.flags);
	let lineStart = 0;
	while (lineStart <= text.length) {
		let lineEnd = text.indexOf('\n', lineStart);
		if (lineEnd === -1) lineEnd = text.length;
		const line = text.slice(lineStart, lineEnd).replace(/\r$/, '');
		const prefix = LIST_PREFIX.exec(line)?.[0].length ?? 0;
		const body = line.slice(prefix);
		const base = lineStart + prefix;
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(body))) {
			if (m[0].length === 0) { re.lastIndex++; if (re.lastIndex > body.length) break; continue; }
			const len = m[0].replace(/[ \t]+$/, '').length;
			if (len > 0) out.push({ from: base + m.index, to: base + m.index + len });
		}
		if (lineEnd >= text.length) break;
		lineStart = lineEnd + 1;
	}
	return out;
}

/**
 * The sentence holding [from, to): split on . ! ? (and …) followed by a space,
 * never across a line break. Quote/list markers at the line start are left out.
 */
export function sentenceBounds(text: string, from: number, to: number = from): { from: number; to: number } {
	const lineStart = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
	let lineEnd = text.indexOf('\n', from);
	if (lineEnd === -1) lineEnd = text.length;
	const line = text.slice(lineStart, lineEnd).replace(/\r$/, '');
	const prefix = LIST_PREFIX.exec(line)?.[0].length ?? 0;
	const body = line.slice(prefix);
	const base = lineStart + prefix;
	let start = -1;
	let end = -1;
	SENTENCE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = SENTENCE.exec(body))) {
		if (m[0].length === 0) { SENTENCE.lastIndex++; if (SENTENCE.lastIndex > body.length) break; continue; }
		const s = base + m.index;
		const e = s + m[0].length;
		if (start === -1 && from < e) start = s;
		if (start !== -1 && to <= e) { end = e; break; }
	}
	if (start === -1) start = Math.min(from, base + body.length);
	if (end === -1) end = Math.max(to, base + body.length);
	return { from: Math.min(start, from), to: Math.max(end, to) };
}

/**
 * The quote the Coach tab shows for a finding: every sentence that holds one
 * of `ranges`, in order, with those ranges marked. Sentences next to each
 * other are joined; separate ones get a "…" between them. A very long
 * sentence is trimmed around its marks (`maxLen`), with "…" at the cut.
 */
export function quoteFor(text: string, ranges: ReadonlyArray<{ from: number; to: number }>, maxLen = 320): QuotePiece[] {
	const sorted = [...ranges].filter((r) => r.to > r.from).sort((a, b) => a.from - b.from);
	if (sorted.length === 0) return [];

	// Sentence spans, merged when they overlap or only whitespace separates them.
	const spans: Array<{ from: number; to: number; marks: Array<{ from: number; to: number }> }> = [];
	for (const r of sorted) {
		const b = sentenceBounds(text, r.from, r.to);
		const last = spans[spans.length - 1];
		if (last && b.from <= last.to + 1 && /^[ \t]*$/.test(text.slice(last.to, Math.max(last.to, b.from)))) {
			last.to = Math.max(last.to, b.to);
			last.marks.push(r);
		} else if (last && b.from < last.to) {
			last.marks.push(r);
		} else {
			spans.push({ from: b.from, to: b.to, marks: [r] });
		}
	}

	const pieces: QuotePiece[] = [];
	const plain = (s: string) => s.replace(/\s+/g, ' ');
	spans.forEach((span, i) => {
		if (i > 0) pieces.push({ text: ' … ', gap: true });
		let from = span.from;
		let to = span.to;
		if (to - from > maxLen) {
			const pad = Math.max(40, Math.floor((maxLen - (span.marks[span.marks.length - 1].to - span.marks[0].from)) / 2));
			from = Math.max(span.from, span.marks[0].from - pad);
			to = Math.min(span.to, span.marks[span.marks.length - 1].to + pad);
			// Cut on a word boundary.
			if (from > span.from) { const sp = text.indexOf(' ', from); if (sp !== -1 && sp < span.marks[0].from) from = sp + 1; }
			if (to < span.to) { const sp = text.lastIndexOf(' ', to); if (sp > span.marks[span.marks.length - 1].to) to = sp; }
		}
		if (from > span.from) pieces.push({ text: '…', gap: true });
		let pos = from;
		for (const m of span.marks) {
			if (m.from < pos || m.to > to) continue;
			if (m.from > pos) pieces.push({ text: plain(text.slice(pos, m.from)) });
			pieces.push({ text: text.slice(m.from, m.to), mark: true });
			pos = m.to;
		}
		if (pos < to) pieces.push({ text: plain(text.slice(pos, to)) });
		if (to < span.to) pieces.push({ text: '…', gap: true });
	});
	return pieces;
}

/** A quote as plain text with the marks in [brackets] — for tests and screen readers. */
export function quoteToString(pieces: readonly QuotePiece[]): string {
	return pieces.map((p) => (p.mark ? `[${p.text}]` : p.text)).join('');
}
