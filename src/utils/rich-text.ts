// Pure, DOM-free markdown ↔ HTML converter for the card synopsis WYSIWYG editor.
//
// Scope is intentionally tiny — only the five formats the panel toolbar offers:
//   **bold**, _italic_, `# ` H1, `## ` H2, and `- ` bullet lists.
//
// It is deliberately string-based (no DOMParser) so it runs unchanged in the
// browser AND in the `node` Jest environment, and so the round-trip invariant
// (markdown → html → markdown === markdown) can be proven by tests. The HTML
// vocabulary it has to understand is small and predictable because:
//   1. the editor DOM is only ever built from markdownToHtml() output,
//      through setRichText() in utils/dom-html.ts, which allow-lists tags, and
//   2. the editor pastes as plain text (see grid-view side panel),
// so the contenteditable never accumulates exotic tags we'd have to handle.

const BLOCK_CLOSE = /(div|p|li|h1|h2)/;

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeEntities(s: string): string {
	return s
		.replace(/&nbsp;/gi, ' ')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#0*39;/gi, "'")
		.replace(/&apos;/gi, "'")
		.replace(/&amp;/gi, '&'); // must run last
}

// Convert inline markdown (already HTML-escaped) into inline HTML tags.
// Bold before italic so `**x**` is not mis-read as italic first.
function inlineMdToHtml(s: string): string {
	return s
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/_(.+?)_/g, '<em>$1</em>');
}

/**
 * Render a limited markdown string as HTML suitable for a contenteditable.
 * Empty lines become `<div><br></div>` so they stay visible and selectable
 * (Chrome/Electron convention).
 */
export function markdownToHtml(md: string): string {
	const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n');
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (/^- /.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^- /.test(lines[i])) {
				items.push('<li>' + inlineMdToHtml(escapeHtml(lines[i].slice(2))) + '</li>');
				i++;
			}
			out.push('<ul>' + items.join('') + '</ul>');
			continue;
		}
		if (/^## /.test(line)) { out.push('<h2>' + inlineMdToHtml(escapeHtml(line.slice(3))) + '</h2>'); i++; continue; }
		if (/^# /.test(line))  { out.push('<h1>' + inlineMdToHtml(escapeHtml(line.slice(2))) + '</h1>'); i++; continue; }
		if (line === '')       { out.push('<div><br></div>'); i++; continue; }
		out.push('<div>' + inlineMdToHtml(escapeHtml(line)) + '</div>');
		i++;
	}
	return out.join('');
}

/**
 * Serialize contenteditable HTML back to limited markdown. Handles the tag
 * vocabulary markdownToHtml() emits plus the shapes Chrome/Electron produce
 * while editing (bare first line, `<div>` per line, trailing `<br>` fillers,
 * `<b>`/`<i>` as well as `<strong>`/`<em>`).
 */
export function htmlToMarkdown(html: string): string {
	let s = html ?? '';
	// A <br> that only exists to fill an otherwise-empty block is not a line break.
	s = s.replace(new RegExp(`<br\\s*/?>(?=\\s*</${BLOCK_CLOSE.source}>)`, 'gi'), '');
	// Inline emphasis → markdown markers.
	s = s.replace(/<\s*(strong|b)\b[^>]*>/gi, '**').replace(/<\s*\/\s*(strong|b)\s*>/gi, '**');
	s = s.replace(/<\s*(em|i)\b[^>]*>/gi, '_').replace(/<\s*\/\s*(em|i)\s*>/gi, '_');
	// Real line breaks.
	s = s.replace(/<br\s*\/?>/gi, '\n');
	// Block openers become a new line, with a prefix for headings / list items.
	s = s.replace(/<\s*h1\b[^>]*>/gi, '\n# ');
	s = s.replace(/<\s*h2\b[^>]*>/gi, '\n## ');
	s = s.replace(/<\s*li\b[^>]*>/gi, '\n- ');
	s = s.replace(/<\s*(div|p)\b[^>]*>/gi, '\n');
	// Drop list wrappers and any remaining/closing tags.
	s = s.replace(/<\s*\/?\s*(ul|ol)\b[^>]*>/gi, '');
	s = s.replace(/<[^>]+>/g, '');
	s = decodeEntities(s);
	s = s.replace(/\r\n?/g, '\n');
	// Trim boundary newlines introduced by the first/last block; keep internal blanks.
	return s.replace(/^\n+/, '').replace(/\n+$/, '');
}
