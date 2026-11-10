import {
	Extension,
	RangeSetBuilder,
	EditorSelection,
	StateEffect,
	StateField,
} from '@codemirror/state';
import {
	EditorView,
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
} from '@codemirror/view';

/**
 * Typewriter mode — two CodeMirror 6 extensions applied to every markdown
 * editor while the mode is on:
 *
 * 1. `typewriterScroll()` keeps the line being typed vertically centered,
 *    like paper in a typewriter. Scrolling is only triggered by actual
 *    typing/deleting, never by clicking or scrolling, so reading and
 *    navigation feel completely normal.
 *
 * 2. `focusDimming()` fades all visible text except the visual row(s)
 *    around the cursor. The dim is pure CSS opacity (theme-agnostic) and
 *    lifts while the editor is unfocused — see styles.css.
 */

export function typewriterScroll(linePosition: () => number = () => 50): Extension {
	let pending = false;
	return EditorView.updateListener.of((update: ViewUpdate) => {
		if (!update.docChanged) return;
		const typed = update.transactions.some(
			(tr) => tr.isUserEvent('input') || tr.isUserEvent('delete')
		);
		if (!typed || pending) return;
		pending = true;
		// Scroll the DOM directly instead of dispatching a CodeMirror scroll
		// effect — CM re-measures and overrides animated scrolls, which made
		// the effect-based approach unreliable. Deferred one frame so the
		// caret coordinates reflect the keystroke that triggered this.
		window.requestAnimationFrame(() => {
			pending = false;
			const view = update.view;
			try {
				const coords = view.coordsAtPos(view.state.selection.main.head);
				if (!coords) return;
				// Rest the typed row at linePosition()% down the viewport
				const pct = Math.min(90, Math.max(10, linePosition())) / 100;
				const scroller = view.scrollDOM;
				const targetY = scroller.getBoundingClientRect().top + scroller.clientHeight * pct;
				const delta = coords.top - targetY;
				if (Math.abs(delta) > 2) {
					const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
					scroller.scrollBy({ top: delta, behavior: reducedMotion ? 'auto' : 'smooth' });
				}
			} catch {
				// View was destroyed between frames — nothing to scroll
			}
		});
	});
}

const dimMark = Decoration.mark({ class: 'sg-tw-dim' });

/**
 * The range of text (the visual rows around the cursor) that stays solid.
 *
 * Finding visual-row boundaries requires measuring the rendered layout, and
 * CodeMirror forbids layout reads inside an update cycle (they throw — which
 * previously made the dim silently fall back to whole-paragraph behavior).
 * So the measurement happens one animation frame later, outside the update,
 * and the result is fed back in through this effect + field.
 */
const setSolidRange = StateEffect.define<{ from: number; to: number }>();

const solidRangeField = StateField.define<{ from: number; to: number } | null>({
	create: () => null,
	update(value, tr) {
		if (value && tr.docChanged) {
			value = {
				from: tr.changes.mapPos(value.from),
				to: tr.changes.mapPos(value.to, 1),
			};
		}
		for (const e of tr.effects) {
			if (e.is(setSolidRange)) value = e.value;
		}
		return value;
	},
});

export function focusDimming(solidRows: () => number = () => 1): Extension {
	// Measures the visual rows around the cursor (deferred to a frame where
	// layout reads are legal) and publishes the result into solidRangeField
	const measurePlugin = ViewPlugin.fromClass(
		class {
			private scheduled = false;
			constructor(readonly view: EditorView) {
				this.schedule();
			}
			update(u: ViewUpdate) {
				if (
					u.docChanged ||
					u.selectionSet ||
					u.viewportChanged ||
					u.geometryChanged ||
					u.focusChanged
				) {
					this.schedule();
				}
			}
			private schedule() {
				if (this.scheduled) return;
				this.scheduled = true;
				window.requestAnimationFrame(() => {
					this.scheduled = false;
					try {
						const range = measureSolidRange(this.view, solidRows());
						const cur = this.view.state.field(solidRangeField);
						if (!cur || cur.from !== range.from || cur.to !== range.to) {
							this.view.dispatch({ effects: setSolidRange.of(range) });
						}
					} catch {
						// View destroyed between frames — nothing to do
					}
				});
			}
		}
	);

	// Renders the dim marks from the published range — no layout reads here,
	// so it is safe to rebuild on every update
	const decoPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = buildDimDecorations(view);
			}
			update(u: ViewUpdate) {
				this.decorations = buildDimDecorations(u.view);
			}
		},
		{ decorations: (v) => v.decorations }
	);

	return [solidRangeField, measurePlugin, decoPlugin];
}

/**
 * Find the start/end of the visual rows around the cursor. "Row" means a row
 * as seen on screen — a soft-wrapped segment of a paragraph — not a document
 * line (in markdown a whole paragraph is one document line). Must only be
 * called outside an update cycle: it measures the rendered layout.
 */
function measureSolidRange(view: EditorView, solidRows: number): { from: number; to: number } {
	const head = view.state.selection.main.head;
	const rows = Math.max(1, Math.round(solidRows));
	const above = Math.floor((rows - 1) / 2);
	const below = Math.ceil((rows - 1) / 2);

	let start = EditorSelection.cursor(head);
	for (let i = 0; i < above; i++) start = view.moveVertically(start, false);
	const from = view.moveToLineBoundary(start, false, true).head;

	let end = EditorSelection.cursor(head);
	for (let i = 0; i < below; i++) end = view.moveVertically(end, true);
	const to = view.moveToLineBoundary(end, true, true).head;

	return { from: Math.min(from, to), to: Math.max(from, to) };
}

/** Dim all visible text outside the published solid range. */
function buildDimDecorations(view: EditorView): DecorationSet {
	const solid = view.state.field(solidRangeField, false) ?? null;
	if (!solid) return Decoration.none;

	const builder = new RangeSetBuilder<Decoration>();
	for (const range of view.visibleRanges) {
		const beforeTo = Math.min(range.to, solid.from);
		if (beforeTo > range.from) builder.add(range.from, beforeTo, dimMark);
		const afterFrom = Math.max(range.from, solid.to);
		if (range.to > afterFrom) builder.add(afterFrom, range.to, dimMark);
	}
	return builder.finish();
}
