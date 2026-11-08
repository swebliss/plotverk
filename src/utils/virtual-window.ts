/**
 * Pure windowed-virtualization math — no DOM, no Obsidian imports.
 *
 * Given a scroll position and a fixed item height, works out which slice of a
 * long list is actually near the viewport, plus the spacer heights that stand
 * in for the un-rendered items above and below. The caller renders only the
 * slice, so a 2000-row lexicon costs the same DOM as a 20-row one.
 *
 * Supports both single-column lists (rows) and multi-column grids (cards):
 * pass `columns` for grids, where every visual row holds `columns` items and
 * is `itemH` tall.
 */

export interface WindowInput {
	/** Current scroll offset of the scroll container, in px. */
	scrollTop: number;
	/** Visible height of the scroll container, in px. */
	viewportH: number;
	/** Height of one visual row (including row gap), in px. */
	itemH: number;
	/** Total number of items in the full list. */
	count: number;
	/** Extra visual rows to render above and below the viewport. Default 3. */
	overscan?: number;
	/** Items per visual row for grid layouts. Default 1 (a plain list). */
	columns?: number;
}

export interface WindowResult {
	/** First item index to render (inclusive). */
	startIndex: number;
	/** Last item index to render (inclusive). -1 when the list is empty. */
	endIndex: number;
	/** Spacer height standing in for un-rendered items above the slice, in px. */
	padTop: number;
	/** Spacer height standing in for un-rendered items below the slice, in px. */
	padBottom: number;
}

/**
 * Compute the index range to render and the surrounding spacer heights.
 *
 * Defensive against the messy inputs a real scroll container produces:
 * negative `scrollTop` (mobile overscroll bounce) is clamped to 0, and a
 * non-positive `itemH` falls back to rendering everything rather than dividing
 * by zero.
 */
export function computeWindow(input: WindowInput): WindowResult {
	const { scrollTop, viewportH, itemH, count } = input;
	const overscan = Math.max(0, Math.floor(input.overscan ?? 3));
	const columns = Math.max(1, Math.floor(input.columns ?? 1));

	if (count <= 0) {
		return { startIndex: 0, endIndex: -1, padTop: 0, padBottom: 0 };
	}

	const totalRows = Math.ceil(count / columns);

	// Bad geometry (height not measured yet, or zero-height rows): render all.
	if (!(itemH > 0)) {
		return { startIndex: 0, endIndex: count - 1, padTop: 0, padBottom: 0 };
	}

	const top = Math.max(0, scrollTop);
	const firstVisibleRow = Math.floor(top / itemH);
	const lastVisibleRow = Math.floor((top + Math.max(0, viewportH)) / itemH);

	const startRow = Math.max(0, firstVisibleRow - overscan);
	const endRow = Math.min(totalRows - 1, lastVisibleRow + overscan);

	const startIndex = startRow * columns;
	const endIndex = Math.min(count - 1, (endRow + 1) * columns - 1);

	const padTop = startRow * itemH;
	const padBottom = (totalRows - 1 - endRow) * itemH;

	return { startIndex, endIndex, padTop, padBottom };
}
