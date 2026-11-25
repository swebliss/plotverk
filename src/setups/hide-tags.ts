import { Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { setupTagGuard } from './tag-guard';
import { anchorRangesInLine } from './anchors';

/**
 * Setup tags are invisible while writing (Emma, 2026-11-24: "hide it"). A
 * marked paragraph looks exactly like any other, in Live Preview and Source
 * mode alike; Reading view already hides block ids by itself.
 *
 * - The tag is replaced by nothing and is atomic, so arrow keys step over it.
 * - The tag guard keeps typing, Enter and joins from cutting it up.
 * - Copying a marked paragraph leaves the tag out, so a pasted copy never
 *   shares the original's place. Cutting keeps it: cut + paste moves the
 *   paragraph, and its setup mark moves with it.
 */

const hidden = Decoration.replace({});

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;
	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = doc.lineAt(pos);
			// The line-end tag, and any stray copy stuck mid-line (a phone copy, a paste).
			for (const [a, b] of anchorRangesInLine(line.text)) builder.add(line.from + a, line.from + b, hidden);
			pos = line.to + 1;
		}
	}
	return builder.finish();
}

const hideTagsPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view);
		}
	},
	{
		decorations: (p) => p.decorations,
		provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
	}
);

/** Set while the editor handles a copy, so the clipboard filter can tell copy from cut. */
let copying = false;

function clipboardParts(): Extension[] {
	// The clipboard filter only exists in newer CodeMirror builds; an older
	// Obsidian simply copies the tag along (harmless: the index keeps the first place).
	const filterFacet = (EditorView as unknown as { clipboardOutputFilter?: typeof EditorView.clipboardOutputFilter }).clipboardOutputFilter;
	if (!filterFacet) return [];
	return [
		EditorView.domEventHandlers({
			copy: () => {
				copying = true;
				window.setTimeout(() => { copying = false; }, 0);
				return false;
			},
			cut: () => {
				copying = false;
				return false;
			},
		}),
		filterFacet.of((text) => (copying ? text.replace(/[ \t]\^pv-[a-z0-9]{6}(?=[ \t]*(\r?\n|$))/g, '') : text)),
	];
}

/** Everything the editor needs for invisible, unbreakable setup tags. */
export function hiddenSetupTags(): Extension {
	return [hideTagsPlugin, setupTagGuard(), ...clipboardParts()];
}
