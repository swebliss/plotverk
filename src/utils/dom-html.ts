/**
 * The plugin's only string → DOM path, so that `innerHTML` is never assigned.
 *
 * Obsidian's plugin review rejects `innerHTML`/`outerHTML` assignment, and the
 * rule is a good one: it is the single API that turns a string into live
 * markup. Both helpers here parse through `DOMParser`, which builds an inert
 * document — scripts in the string never run, and no resource is fetched.
 *
 * Reading `.innerHTML` is a different thing and stays allowed: it serializes
 * DOM the browser already built and cannot introduce anything. The synopsis
 * editors read it to convert what the writer typed back into markdown.
 *
 * No Obsidian imports — `color-picker-popover.ts` and `searchable-select.ts`
 * are deliberately framework-free, and this sits underneath both.
 */

/** Parse into an inert document. Nothing here executes or loads. */
function parseInert(markup: string): HTMLElement {
	return new DOMParser().parseFromString(markup, 'text/html').body;
}

function adoptInto(el: HTMLElement, source: HTMLElement): void {
	el.replaceChildren(...Array.from(source.childNodes, (n) => document.importNode(n, true)));
}

/**
 * Replace `el`'s children with a markup literal written in this codebase —
 * icon SVGs and the labels beside them.
 *
 * Only ever call this with a constant. Anything that came from a note, a
 * setting, or a field the writer filled in belongs in `textContent`, or in
 * `setRichText` if it genuinely has to carry formatting.
 */
export function setStaticMarkup(el: HTMLElement, markup: string): void {
	adoptInto(el, parseInert(markup));
}

/** Everything `markdownToHtml()` emits, plus what a contenteditable adds on its own. */
const RICH_TEXT_TAGS = new Set(['DIV', 'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'H1', 'H2', 'UL', 'OL', 'LI']);

/** Dropped whole rather than unwrapped — their text is source code, not prose. */
const DISCARD_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TEMPLATE']);

/**
 * Fill a synopsis editor from `markdownToHtml()` output.
 *
 * That converter escapes the writer's text before adding its own tags, so
 * nothing typed into a synopsis can arrive here as markup. The allow-list is
 * the second lock, covering the case the converter cannot see: a `.storygrid`
 * file edited by hand, or written by some other tool. Unknown tags are
 * unwrapped to the text inside them and every attribute is dropped, so no
 * link, image, style, or event handler can survive.
 */
export function setRichText(el: HTMLElement, html: string): void {
	const body = parseInert(html);
	scrub(body);
	adoptInto(el, body);
}

function scrub(parent: ParentNode): void {
	for (const child of Array.from(parent.children)) {
		if (DISCARD_TAGS.has(child.tagName)) {
			child.remove();
			continue;
		}
		scrub(child);
		if (RICH_TEXT_TAGS.has(child.tagName)) {
			for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
		} else {
			child.replaceWith(...Array.from(child.childNodes));
		}
	}
}
