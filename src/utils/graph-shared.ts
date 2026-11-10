// Shared, Obsidian-free rendering helpers used by the SVG pan/zoom
// controllers (Connections Map, Story Tree, Timeline) — extracted so they
// stop drifting out of sync with byte-identical copies of the same code.

/** Node fill color per Codex entity kind, used by both graph renderers. */
export const KIND_COLORS: Record<string, string> = {
	character: '#7c5fd3',
	location:  '#1f9d6b',
	faction:   '#d05050',
	system:    '#2089c4',
	item:      '#c98a1b',
	research:  '#0d9488',
	scene:     '#6b7280',
};

export function makeSvg(tag: string, attrs: Record<string, string> = {}): Element {
	const el = createSvg(tag as keyof SVGElementTagNameMap);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	return el;
}

export function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Symmetric, deterministic offsets (in px, centered on 0) for `count` items
 * that would otherwise land on the exact same point — e.g. Timeline dots
 * sharing a date. Item order in the returned array matches the caller's own
 * ordering, so pass items in a stable order (e.g. sorted by id) for
 * reproducible results across renders.
 */
export function fanOffsets(count: number, spacing: number): number[] {
	if (count <= 1) return count === 1 ? [0] : [];
	const mid = (count - 1) / 2;
	return Array.from({ length: count }, (_, i) => (i - mid) * spacing);
}

export function pointerDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return Math.sqrt(dx * dx + dy * dy);
}

/** Pointer travel within this (px, per axis, inclusive) still counts as a tap.
 *  8px (not the tighter 3px this used to be) leaves room for real finger
 *  tremor on a touch screen — 3px only ever worked reliably with a mouse. */
export const TAP_SLOP_PX = 8;

/**
 * Pure zoom-to-fit + centering math for a single along-axis (Timeline's day
 * axis): given the absolute-day positions of every event, picks a scale that
 * fits the whole span inside `viewportPx` with comfortable padding — clamped
 * to the same min/max zoom bounds manual pinch/wheel zoom already enforces —
 * plus the along-axis offset that centers the span's midpoint in the
 * viewport at that scale. No events, or a single day repeated (zero span),
 * has nothing to "fit": scale is left at `currentScale` and only the offset
 * is computed (centering on that one day, or 0 when there's nothing to
 * center on at all).
 */
export function computeTimelineFit(
	days: number[],
	viewportPx: number,
	pxPerDay: number,
	minScale: number,
	maxScale: number,
	currentScale: number,
	padding = 0.8,
): { scale: number; offset: number } {
	if (days.length === 0 || viewportPx <= 0) return { scale: currentScale, offset: 0 };
	const min = Math.min(...days);
	const max = Math.max(...days);
	const span = max - min;
	const scale = span > 0
		? Math.max(minScale, Math.min(maxScale, (viewportPx * padding) / (span * pxPerDay)))
		: currentScale;
	const center = (min + max) / 2;
	const offset = viewportPx / 2 - center * pxPerDay * scale;
	return { scale, offset };
}

/**
 * True when the pointer's travel between down and up stays inside the tap
 * slop — i.e. the gesture is a tap, not a drag/pan. Kept pure so the
 * capture-retargeting workaround (detect taps from the pointerdown/up pair,
 * never from 'click' — see rel-graph-view.ts bindNodeEvents) is unit-testable.
 */
export function isTap(dx: number, dy: number): boolean {
	return Math.abs(dx) <= TAP_SLOP_PX && Math.abs(dy) <= TAP_SLOP_PX;
}
