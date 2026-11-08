import { Menu } from 'obsidian';
import { setStaticMarkup } from '../utils/dom-html';

// ─── Rich-text markdown toolbar for contenteditable panel editors ─────────────
// Extracted verbatim from grid-view.ts so the Timeline's event editor panel can
// share the exact grid card-editor synopsis toolbar (A5) — one implementation,
// one look.

export function buildPanelRichToolbar(toolbar: HTMLElement, editor: HTMLElement, onChange: () => void): void {
	// Phosphor Bold SVG icons — read from @phosphor-icons/core/assets/bold/
	const PHOS = {
		bold:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M185.08,114.46A48,48,0,0,0,148,36H80A12,12,0,0,0,68,48V200a12,12,0,0,0,12,12h80a52,52,0,0,0,25.08-97.54ZM92,60h56a24,24,0,0,1,0,48H92Zm68,128H92V132h68a28,28,0,0,1,0,56Z"/></svg>`,
		italic: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M204,56a12,12,0,0,1-12,12H160.65l-40,120H144a12,12,0,0,1,0,24H64a12,12,0,0,1,0-24H95.35l40-120H112a12,12,0,0,1,0-24h80A12,12,0,0,1,204,56Z"/></svg>`,
		h1:     `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M236,112v96a12,12,0,0,1-24,0V134.42L206.66,138a12,12,0,0,1-13.32-20l24-16A12,12,0,0,1,236,112ZM144,44a12,12,0,0,0-12,12v48H52V56a12,12,0,0,0-24,0V176a12,12,0,0,0,24,0V128h80v48a12,12,0,0,0,24,0V56A12,12,0,0,0,144,44Z"/></svg>`,
		h2:     `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M156,56V176a12,12,0,0,1-24,0V128H52v48a12,12,0,0,1-24,0V56a12,12,0,0,1,24,0v48h80V56a12,12,0,0,1,24,0Zm84,140H216l28.74-38.33A36,36,0,1,0,182.05,124a12,12,0,0,0,22.63,8,11.67,11.67,0,0,1,1.73-3.22,12,12,0,1,1,19.15,14.46L182.4,200.8A12,12,0,0,0,192,220h48a12,12,0,0,0,0-24Z"/></svg>`,
		list:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M76,64A12,12,0,0,1,88,52H216a12,12,0,0,1,0,24H88A12,12,0,0,1,76,64Zm140,52H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24Zm0,64H88a12,12,0,0,0,0,24H216a12,12,0,0,0,0-24ZM44,112a16,16,0,1,0,16,16A16,16,0,0,0,44,112Zm0-64A16,16,0,1,0,60,64,16,16,0,0,0,44,48Zm0,128a16,16,0,1,0,16,16A16,16,0,0,0,44,176Z"/></svg>`,
	};

	const sep = () => toolbar.createDiv({ cls: 'sg-md-toolbar-sep' });
	// execCommand is deprecated but the only reliable rich-edit path in Obsidian's
	// Chromium runtime; the codebase already relies on it (see known-quirk #6).
	const exec = (cmd: string, val?: string) => {
		editor.focus();
		document.execCommand(cmd, false, val);
		onChange();
		updateActive();
	};
	const mkBtn = (svg: string, title: string, action: () => void) => {
		const btn = toolbar.createEl('button', { cls: 'sg-md-toolbar-btn', title });
		setStaticMarkup(btn, svg);
		btn.addEventListener('mousedown', (e) => { e.preventDefault(); action(); });
		btn.addEventListener('touchend', (e) => { e.preventDefault(); action(); });
		return btn;
	};

	// ── Block formatting (text size) ─────────────────────────────────────────
	// Done by directly renaming the line element rather than
	// execCommand('formatBlock'), whose heading-revert is unreliable inside a
	// list item in Obsidian's Chromium — so the "Normal" option always works.
	const lineBlock = (): HTMLElement | null => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const node = sel.anchorNode;
		if (!node || !editor.contains(node)) return null;
		const el = node instanceof HTMLElement ? node : node.parentElement;
		const block = el?.closest('h1,h2,p,div,li') as HTMLElement | null;
		// Never treat the editor root itself as a line block.
		return block && block !== editor ? block : null;
	};
	const restoreCaret = (into: HTMLElement) => {
		const sel = window.getSelection();
		if (!sel) return;
		const r = editor.ownerDocument.createRange();
		r.selectNodeContents(into);
		r.collapse(false);
		sel.removeAllRanges();
		sel.addRange(r);
	};
	const applyBlock = (block: HTMLElement | null, tag: 'div' | 'h1' | 'h2') => {
		editor.focus();
		if (!block) {
			// Bare, unwrapped line (e.g. the very first line) — let the browser wrap it.
			document.execCommand('formatBlock', false, tag === 'div' ? 'p' : tag);
		} else if (block.tagName === 'LI') {
			// A raw bullet has no heading to change, and headings can't live in a
			// list in our markdown model — ignore heading requests on a bullet.
		} else if (tag === 'div' && block.parentElement?.tagName === 'LI') {
			// "Normal" on a heading that ended up inside a bullet → unwrap to clean
			// bullet text (keeps the markdown round-trip tidy).
			const li = block.parentElement;
			while (block.firstChild) li.insertBefore(block.firstChild, block);
			block.remove();
			restoreCaret(li);
		} else if (block.tagName.toLowerCase() !== tag) {
			const repl = editor.ownerDocument.createElement(tag);
			while (block.firstChild) repl.appendChild(block.firstChild);
			block.replaceWith(repl);
			restoreCaret(repl);
		}
		onChange();
		updateActive();
	};

	const boldBtn   = mkBtn(PHOS.bold,   'Bold',   () => exec('bold'));
	const italicBtn = mkBtn(PHOS.italic, 'Italic', () => exec('italic'));
	sep();

	// Minimal text-size dropdown: one small button (shows the current size) that
	// opens a Normal / Heading 1 / Heading 2 menu.
	const sizeBtn = toolbar.createEl('button', { cls: 'sg-md-toolbar-btn sg-md-toolbar-size', title: 'Text size' });
	const sizeGlyph = sizeBtn.createSpan({ cls: 'sg-md-size-glyph', text: 'Aa' });
	sizeBtn.createSpan({ cls: 'sg-md-size-caret', text: '▾' });
	const openSizeMenu = () => {
		const block = lineBlock();
		const onBullet = block?.tagName === 'LI';
		const cur = block && /^h[12]$/i.test(block.tagName) ? block.tagName.toLowerCase() : 'normal';
		const menu = new Menu();
		([['Normal', 'div', 'normal'], ['Heading 1', 'h1', 'h1'], ['Heading 2', 'h2', 'h2']] as const)
			.forEach(([label, tag, key]) => menu.addItem((mi) => {
				mi.setTitle(label).setChecked(cur === key);
				// Headings aren't offered while the caret is on a raw bullet line.
				if (onBullet && key !== 'normal') mi.setDisabled(true);
				mi.onClick(() => applyBlock(block, tag));
			}));
		const r = sizeBtn.getBoundingClientRect();
		menu.showAtPosition({ x: r.left, y: r.bottom + 2 });
	};
	sizeBtn.addEventListener('mousedown', (e) => e.preventDefault()); // keep caret in the editor
	sizeBtn.addEventListener('click', (e) => { e.preventDefault(); openSizeMenu(); });
	sizeBtn.addEventListener('touchend', (e) => { e.preventDefault(); openSizeMenu(); });

	sep();
	const listBtn = mkBtn(PHOS.list, 'Bullet list', () => exec('insertUnorderedList'));

	// Reflect the caret's current formatting on the toolbar: the size button shows
	// the current line's size, and bold/italic/list glow when active.
	// (Hoisted function declaration so exec/applyBlock above can call it.)
	function updateActive() {
		const block = lineBlock();
		sizeGlyph.setText(block && /^h[12]$/i.test(block.tagName) ? block.tagName.toUpperCase() : 'Aa');
		try {
			boldBtn.toggleClass('is-active', document.queryCommandState('bold'));
			italicBtn.toggleClass('is-active', document.queryCommandState('italic'));
			listBtn.toggleClass('is-active', document.queryCommandState('insertUnorderedList'));
		} catch { /* queryCommandState throws when nothing is focused */ }
	}
	// Scoped to the editor element so listeners die with the panel — no leaks.
	['keyup', 'mouseup', 'click', 'input', 'focus'].forEach((ev) =>
		editor.addEventListener(ev, updateActive),
	);
}
