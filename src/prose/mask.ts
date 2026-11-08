// Pure "what counts as prose" mask — no Obsidian imports.

/**
 * Returns a copy of `text`, exactly the same length, where everything that is
 * not the writer's prose is blanked to spaces (line breaks are kept). Every
 * engine scans the masked copy, so offsets still point into the real text.
 *
 * Blanked: frontmatter, fenced code, `%%comments%%`, HTML comments, headings,
 * the scene metadata line (`POV: … · Location: … · Status: …`), inline code,
 * wikilink targets (an alias after `|` stays, it is visible text), markdown
 * link URLs and bare URLs.
 *
 * The metadata line is why the coach used to report "location / status / idea
 * ×3": those words repeat on that line in every scene.
 */
export function maskNonProse(text: string, opts?: { keepHeadings?: boolean; keepLinkTargets?: boolean }): string {
	if (!text) return text;
	const chars = text.split('');
	const blank = (from: number, to: number) => {
		for (let i = Math.max(0, from); i < to && i < chars.length; i++) {
			if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
		}
	};
	const current = () => chars.join('');
	const blankAll = (re: RegExp) => {
		const src = current();
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(src))) {
			if (m[0].length === 0) { re.lastIndex++; continue; }
			blank(m.index, m.index + m[0].length);
		}
	};

	// 1. Frontmatter — only at the very top of the file.
	const fm = /^﻿?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/.exec(text);
	if (fm) blank(0, fm[0].length);

	// 2. Fenced code blocks (``` or ~~~), line by line. An unclosed fence runs to the end.
	{
		const src = current();
		let pos = 0;
		let fence: { ch: string; len: number; start: number } | null = null;
		while (pos <= src.length) {
			const nl = src.indexOf('\n', pos);
			const end = nl === -1 ? src.length : nl;
			const line = src.slice(pos, end);
			const open = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
			if (fence) {
				if (open && open[1][0] === fence.ch && open[1].length >= fence.len && line.trim() === open[1]) {
					blank(fence.start, end);
					fence = null;
				}
			} else if (open) {
				fence = { ch: open[1][0], len: open[1].length, start: pos };
			}
			if (nl === -1) break;
			pos = nl + 1;
		}
		if (fence) blank(fence.start, src.length);
	}

	// 3. Comments: Obsidian %%…%% (may span lines) and HTML <!-- … -->.
	blankAll(/%%[\s\S]*?(?:%%|$)/g);
	blankAll(/<!--[\s\S]*?(?:-->|$)/g);

	// 4. Whole lines: headings and the scene metadata line. (keepHeadings: a beat
	// title inside a scene — "## Mara asks Roke…" — does say who is in it.)
	{
		const src = current();
		let pos = 0;
		while (pos <= src.length) {
			const nl = src.indexOf('\n', pos);
			const end = nl === -1 ? src.length : nl;
			const line = src.slice(pos, end);
			const heading = !opts?.keepHeadings && /^[ \t]{0,3}#{1,6}(?:[ \t]|$)/.test(line);
			if (heading || isMetadataLine(line)) blank(pos, end);
			if (nl === -1) break;
			pos = nl + 1;
		}
	}

	// 5. Inline code.
	blankAll(/`[^`\n]+`/g);

	// 6. Wikilinks and embeds: blank the target; keep a visible alias.
	{
		const src = current();
		const re = /!?\[\[([^\]\n]*)\]\]/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(src))) {
			const start = m.index;
			const endAll = start + m[0].length;
			const pipe = m[1].indexOf('|');
			if (opts?.keepLinkTargets && !m[0].startsWith('!')) {
				// Keep only the linked note's name: "[[Saltmarch/Mara Ferrow#Early|Mara]]"
				// reads "Mara Ferrow" — no folder, no heading, and the alias blanked
				// so one link is one mention.
				const innerStart = start + 2;
				const target = pipe === -1 ? m[1] : m[1].slice(0, pipe);
				const hash = target.indexOf('#');
				const nameEnd = hash === -1 ? target.length : hash;
				const nameStart = target.slice(0, nameEnd).lastIndexOf('/') + 1;
				blank(start, innerStart + nameStart);
				blank(innerStart + nameEnd, endAll);
			} else if (pipe === -1 || m[0].startsWith('!')) {
				blank(start, endAll);
			} else {
				const innerStart = start + m[0].indexOf('[[') + 2;
				blank(start, innerStart + pipe + 1); // "[[target|"
				blank(endAll - 2, endAll); // "]]"
			}
		}
	}

	// 7. Markdown link URLs "](…)" and bare URLs.
	blankAll(/\]\([^)\n]*\)/g);
	blankAll(/\bhttps?:\/\/[^\s)>\]]+/g);

	return current();
}

/**
 * The scene metadata line Plotverk writes under a scene title:
 * `*POV: [[Mara]] · Location: [[The Tidehouse]] · Status: written*`.
 * Matched by its shape — a known key and a colon at the start, plus the
 * "·" separator or a leading POV — so an ordinary sentence is never blanked.
 */
export function isMetadataLine(line: string): boolean {
	const m = /^[ \t>]*[*_]*[ \t]*(pov|location|status)[ \t]*[*_]*[ \t]*:/i.exec(line);
	if (!m) return false;
	return line.includes('·') || m[1].toLowerCase() === 'pov';
}
