/**
 * Zoom maths for drags inside the grid table.
 *
 * The table is shown with CSS `zoom`, but pointer positions and
 * getBoundingClientRect() are in screen pixels. A `translate(Npx)` set on an
 * element INSIDE the table is multiplied by the zoom, so moving something by a
 * screen-pixel distance means translating by `distance / scale` — otherwise it
 * runs ahead of the pointer when zoomed in and lags behind when zoomed out.
 * At 100% the scale is exactly 1, so nothing changes there.
 *
 * The scale is measured (screen width ÷ layout width of an element inside the
 * table) rather than read from the zoom setting: what the engine reports for
 * zoomed content differs between versions, and the ratio is right either way.
 */

/** Smaller than this is rounding noise (offsetWidth is a whole number), not zoom. */
const SNAP_TO_ONE = 0.005;

/**
 * Screen px per layout px, from one element's on-screen width and its layout
 * width. Returns 1 for anything unusable (hidden element, zero width, NaN) so a
 * bad measurement can only ever mean "no correction", never a wild one.
 */
export function measuredScale(screenWidth: number, layoutWidth: number): number {
	if (!Number.isFinite(screenWidth) || !Number.isFinite(layoutWidth) || screenWidth <= 0 || layoutWidth <= 0) return 1;
	const scale = screenWidth / layoutWidth;
	if (scale < 0.25 || scale > 4) return 1;
	return Math.abs(scale - 1) < SNAP_TO_ONE ? 1 : scale;
}

/** A distance in screen px, expressed in the px an element inside the zoomed table is positioned in. */
export function toLayoutPx(screenDelta: number, scale: number): number {
	return scale === 1 || !Number.isFinite(scale) || scale <= 0 ? screenDelta : screenDelta / scale;
}
