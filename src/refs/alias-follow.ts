// Pure — no Obsidian imports.
//
// "An alias changed in the Codex changes in the text." A NAME lives on its
// sheet only: prose links to a sheet by its own name are bare (`[[Mr Gibbins]]`)
// and follow a rename through Obsidian. An ALIAS is the writer's word for that
// person in a sentence (`[[Mr Gibbins|Dad]]`). When the writer renames the
// alias on the sheet (Dad → Papa), the links that show the old word get the new
// one. Nothing else is touched: plain unlinked words, bare links, links to
// other sheets, embeds, frontmatter and code all stay as they are.
//
// Every change is remembered as an `AliasEdit` (the two words plus the text
// right around the link) so it can be undone or redone days later on just
// those links — never by restoring whole files, since the writer has usually
// written more since.

/** A rename of one alias on a sheet. */
export interface AliasRename {
	from: string;
	to: string;
}

/**
 * One link changed by an alias rename. `before` / `after` are up to
 * CONTEXT_CHARS of the same line around the link, with every wikilink in them
 * collapsed to one placeholder character, so a neighbouring link changing its
 * word (or its target, after a sheet rename) does not hide this one.
 */
export interface AliasEdit {
	before: string;
	after: string;
	/** The word the link showed before the change, exactly as written. */
	from: string;
	/** The word it shows after the change. */
	to: string;
}

/** One word swap in a text: replace text[start, end) with `word` (offsets in the text as it was handed in). */
export interface TextSwap {
	start: number;
	end: number;
	word: string;
}

const CONTEXT_CHARS = 24;
const LINK_MARK = '\u0000';

function cleanList(list: readonly string[]): string[] {
	return [...new Set(list.map((a) => a.trim()).filter(Boolean))];
}

/**
 * The alias rename between two alias lists, or null when it is not clearly a
 * rename: exactly one alias went away and exactly one new alias came in.
 * Only added, only removed, reordered or several changed → null.
 */
export function aliasRename(before: readonly string[], after: readonly string[]): AliasRename | null {
	const a = cleanList(before);
	const b = cleanList(after);
	const removed = a.filter((x) => !b.includes(x));
	const added = b.filter((x) => !a.includes(x));
	if (removed.length !== 1 || added.length !== 1) return null;
	return { from: removed[0], to: added[0] };
}

interface Zone { start: number; end: number }

/**
 * Frontmatter, fenced code, inline code and %% comments: never rewritten.
 * Fences may be indented (inside a list) or quoted (`> ```), close only on a
 * fence of the same character at least as long, and run to the end when
 * never closed — like Obsidian draws them. No lookbehind (older iPhones).
 */
function skipZones(text: string): Zone[] {
	const zones: Zone[] = [];
	// Frontmatter, also behind an invisible byte-order mark.
	const fmStart = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	if (/^---\r?\n/.test(text.slice(fmStart))) {
		const close = text.slice(fmStart).search(/\n---[ \t]*(\r?\n|$)/);
		if (close !== -1) {
			const closeAt = fmStart + close;
			const closeEnd = text.indexOf('\n', closeAt + 1);
			zones.push({ start: 0, end: closeEnd === -1 ? text.length : closeEnd + 1 });
		}
	}

	// Fenced code, line by line.
	let pos = 0;
	let open: { start: number; char: string; len: number } | null = null;
	while (pos <= text.length) {
		const nl = text.indexOf('\n', pos);
		const lineEnd = nl === -1 ? text.length : nl;
		const line = text.slice(pos, lineEnd).replace(/\r$/, '');
		const m = /^[ \t>]*(`{3,}|~{3,})(.*)$/.exec(line);
		if (open) {
			if (m && m[1][0] === open.char && m[1].length >= open.len && !m[2].trim()) {
				zones.push({ start: open.start, end: lineEnd });
				open = null;
			}
		} else if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
			open = { start: pos, char: m[1][0], len: m[1].length };
		}
		if (nl === -1) break;
		pos = nl + 1;
	}
	if (open) zones.push({ start: open.start, end: text.length });

	const inZone = (i: number) => zones.some((z) => i >= z.start && i < z.end);

	// Inline code: a run of N backticks closed by the next run of exactly N in the same paragraph.
	// Paragraph ends, found once (a long paragraph full of stray backticks stays fast).
	const breaks: number[] = [];
	const breakRe = /\n[ \t]*\r?\n/g;
	let br: RegExpExecArray | null;
	while ((br = breakRe.exec(text)) !== null) breaks.push(br.index);
	let b = 0;
	let i = 0;
	while (i < text.length) {
		if (text[i] !== '`' || inZone(i)) { i++; continue; }
		let n = 1;
		while (text[i + n] === '`') n++;
		while (b < breaks.length && breaks[b] < i) b++;
		const limit = b < breaks.length ? breaks[b] : text.length;
		let j = i + n;
		let closed = -1;
		while (j < limit) {
			if (text[j] !== '`') { j++; continue; }
			let k = 1;
			while (text[j + k] === '`') k++;
			if (k === n) { closed = j + k; break; }
			j += k;
		}
		if (closed !== -1) {
			zones.push({ start: i, end: closed });
			i = closed;
		} else {
			i += n;
		}
	}

	// %% comments %% (inline or over several lines).
	const comments = /%%[\s\S]*?%%/g;
	let c: RegExpExecArray | null;
	while ((c = comments.exec(text)) !== null) {
		if (!inZone(c.index)) zones.push({ start: c.index, end: c.index + c[0].length });
	}
	return zones;
}

interface FoundLink {
	start: number;
	end: number;
	embed: boolean;
	skipped: boolean;
	/** The link's target without `#heading` / `#^block`. */
	linkpath: string;
	/** Display word, or null for a bare link. */
	display: string | null;
	/** Where the display word starts and ends in the text. */
	displayStart: number;
	displayEnd: number;
	before: string;
	after: string;
}

/** Every `[[…]]` in the text, with its parts and the text around it. */
function findLinks(text: string): FoundLink[] {
	const zones = skipZones(text);
	const raw: Array<{ start: number; end: number; embed: boolean; inner: string }> = [];
	const re = /(!?)\[\[([^[\]\n]*?)\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		raw.push({ start: m.index, end: m.index + m[0].length, embed: m[1] === '!', inner: m[2] });
	}

	// The text with each link collapsed to one mark, and where each link sits in it.
	let masked = '';
	const maskedAt: number[] = [];
	let pos = 0;
	for (const r of raw) {
		masked += text.slice(pos, r.start);
		maskedAt.push(masked.length);
		masked += LINK_MARK;
		pos = r.end;
	}
	masked += text.slice(pos);

	return raw.map((r, i) => {
		const p = maskedAt[i];
		// Context ignores carriage returns, so a note saved with Windows or Unix line ends reads the same.
		let before = masked.slice(Math.max(0, p - CONTEXT_CHARS - 1), p).split('\r').join('');
		before = before.slice(Math.max(0, before.length - CONTEXT_CHARS));
		const nl = before.lastIndexOf('\n');
		if (nl !== -1) before = before.slice(nl + 1);
		let after = masked.slice(p + 1, p + 2 + CONTEXT_CHARS).split('\r').join('');
		after = after.slice(0, CONTEXT_CHARS);
		const nl2 = after.indexOf('\n');
		if (nl2 !== -1) after = after.slice(0, nl2);

		const innerStart = r.start + (r.embed ? 3 : 2);
		const bar = r.inner.indexOf('|');
		let target = r.inner;
		let display: string | null = null;
		let displayStart = -1;
		if (bar !== -1) {
			const escaped = bar > 0 && r.inner[bar - 1] === '\\';
			target = r.inner.slice(0, escaped ? bar - 1 : bar);
			display = r.inner.slice(bar + 1);
			displayStart = innerStart + bar + 1;
		}
		const hash = target.indexOf('#');
		const linkpath = hash === -1 ? target : target.slice(0, hash);
		const skipped = zones.some((z) => r.start < z.end && r.end > z.start);
		return {
			start: r.start, end: r.end, embed: r.embed, skipped, linkpath, display,
			displayStart, displayEnd: displayStart + (display?.length ?? 0), before, after,
		};
	});
}

/** The new word, with a lowercase start kept when the writer wrote one ("dad" → "papa"). */
function matchStart(written: string, word: string): string {
	const w = written.charAt(0);
	if (w && w !== w.toUpperCase() && w === w.toLowerCase()) {
		return word.charAt(0).toLowerCase() + word.slice(1);
	}
	return word;
}

/** Apply swaps (offsets in `text`, never overlapping) end → start. */
export function applySwaps(text: string, changes: readonly TextSwap[]): string {
	let out = text;
	for (const c of [...changes].sort((a, b) => b.start - a.start)) {
		out = out.slice(0, c.start) + c.word + out.slice(c.end);
	}
	return out;
}

/**
 * Change every link to the sheet (`isTarget` decides from the link's target)
 * that shows `oldAlias` (any letter case) so it shows `newAlias`. Returns the
 * new text and one `AliasEdit` per changed link (empty when nothing changed —
 * the text is then returned as it was).
 */
export function rewriteAliasLinks(
	text: string,
	isTarget: (linkpath: string) => boolean,
	oldAlias: string,
	newAlias: string,
): { text: string; edits: AliasEdit[]; changes: TextSwap[] } {
	const oldKey = oldAlias.trim().toLocaleLowerCase();
	const word = newAlias.trim();
	if (!oldKey || !word) return { text, edits: [], changes: [] };
	const edits: AliasEdit[] = [];
	const changes: TextSwap[] = [];
	for (const link of findLinks(text)) {
		if (link.embed || link.skipped || link.display === null || !link.linkpath.trim()) continue;
		if (link.display.toLocaleLowerCase() !== oldKey) continue;
		if (!isTarget(link.linkpath)) continue;
		const to = matchStart(link.display, word);
		if (to === link.display) continue;
		changes.push({ start: link.displayStart, end: link.displayEnd, word: to });
		edits.push({ before: link.before, after: link.after, from: link.display, to });
	}
	if (!changes.length) return { text, edits, changes };
	return { text: applySwaps(text, changes), edits, changes };
}

/**
 * Undo (to → from) or redo (from → to) remembered alias edits on the text as
 * it is now. Only links to the sheet that still show exactly the remembered
 * word, with the same text around them, are changed; every remembered edit
 * not found that way is `left` (the writer edited it since).
 */
export function replayAliasEdits(
	text: string,
	isTarget: (linkpath: string) => boolean,
	edits: readonly AliasEdit[],
	direction: 'undo' | 'redo',
): { text: string; done: number; left: number; changes: TextSwap[] } {
	const seek = (e: AliasEdit) => (direction === 'undo' ? e.to : e.from);
	const keyOf = (word: string, before: string, after: string) => `${word}\u0001${before}\u0001${after}`;
	const wanted = new Map<string, AliasEdit[]>();
	for (const e of edits) {
		const k = keyOf(seek(e), e.before, e.after);
		const list = wanted.get(k);
		if (list) list.push(e); else wanted.set(k, [e]);
	}
	// The links that look like a remembered one, grouped by how they look.
	const found = new Map<string, FoundLink[]>();
	for (const link of findLinks(text)) {
		if (link.embed || link.skipped || link.display === null || !link.linkpath.trim()) continue;
		const k = keyOf(link.display, link.before, link.after);
		if (!wanted.has(k) || !isTarget(link.linkpath)) continue;
		const list = found.get(k);
		if (list) list.push(link); else found.set(k, [link]);
	}
	const changes: TextSwap[] = [];
	for (const [k, links] of found) {
		const list = wanted.get(k)!;
		// More look-alikes in the text than Plotverk changed: some are the
		// writer's own, and there is no telling which — touch none of them.
		if (links.length > list.length) continue;
		links.forEach((link, i) => {
			const e = list[i];
			changes.push({ start: link.displayStart, end: link.displayEnd, word: direction === 'undo' ? e.from : e.to });
		});
	}
	return {
		text: changes.length ? applySwaps(text, changes) : text,
		done: changes.length,
		left: edits.length - changes.length,
		changes,
	};
}
