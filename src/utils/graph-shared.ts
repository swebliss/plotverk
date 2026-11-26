// Shared, Obsidian-free rendering helpers used by the SVG pan/zoom
// controllers (Connections Map, Story Tree, Timeline) — extracted so they
// stop drifting out of sync with byte-identical copies of the same code.

import { CODEX_GROUPS } from '../entities/worldbuilding-kinds';

/** Node fill color per Codex entity kind. The Story Tree still uses it; the
 *  Connections Map draws its nodes by family instead (see nodeFamily below). */
export const KIND_COLORS: Record<string, string> = {
	character: '#7c5fd3',
	location:  '#1f9d6b',
	faction:   '#d05050',
	system:    '#2089c4',
	item:      '#c98a1b',
	research:  '#0d9488',
	scene:     '#6b7280',
};

// ─── Connections Map node shapes ────────────────────────────────────────────
// One shape per Codex family, not per kind (Emma 2026-11-26, sketch v2):
// characters stay today's round dot; places a soft triangle, groups a hexagon,
// items a diamond, everything else a grey rounded square. User-made kinds have
// no family of their own, so they are "everything else".

export type NodeFamily = 'character' | 'place' | 'item' | 'group' | 'other';

/** Key order at the bottom of the map. */
export const NODE_FAMILIES: readonly NodeFamily[] = ['character', 'place', 'item', 'group', 'other'];

const FAMILY_BY_CODEX_GROUP = new Map<string, NodeFamily>([
	['characters', 'character'],
	['places', 'place'],
	['groups', 'group'],
	['items', 'item'],
]);

/** Retired kinds that are no longer in CODEX_GROUPS but still sit on older sheets. */
const RETIRED_KIND_FAMILY = new Map<string, NodeFamily>([
	['location', 'place'],
]);

/** The map family (and so the shape and colour) of a Codex kind. */
export function nodeFamily(kind: string): NodeFamily {
	const group = CODEX_GROUPS.find((g) => g.kinds.includes(kind));
	if (group) return FAMILY_BY_CODEX_GROUP.get(group.id) ?? 'other';
	return RETIRED_KIND_FAMILY.get(kind) ?? 'other';
}

/** Theme colour per family (CSS value). The variables are set on .sg-rg-root in
 *  styles.css from Obsidian's own --color-* theme colours. */
export const NODE_FAMILY_COLOR: Record<NodeFamily, string> = {
	character: 'var(--sg-rg-node-character)',
	place: 'var(--sg-rg-node-place)',
	item: 'var(--sg-rg-node-item)',
	group: 'var(--sg-rg-node-group)',
	other: 'var(--sg-rg-node-other)',
};

/** Hovered / dragged nodes grow to this radius, as the round dot always has. */
export const NODE_HOVER_R = 10;

/**
 * The visible outline of a non-character node, centred on 0,0, for a node
 * whose round dot would have radius `r` (6–9px by connection count). Every
 * shape stays inside that dot (the triangle's tip reaches 1.08 × r), so lines
 * still stop at the same distance from the centre as before.
 * Characters are a plain circle and have no entry here.
 */
export function nodeShapeOutline(
	family: Exclude<NodeFamily, 'character'>,
	r: number,
): { tag: 'polygon'; points: string } | { tag: 'rect'; x: number; y: number; size: number; rx: number } {
	const pts = (list: Array<[number, number]>): string =>
		list.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(' ');
	if (family === 'place') {
		const R = r * 1.08;
		return { tag: 'polygon', points: pts([[0, -R], [R * 0.866, R * 0.5], [-R * 0.866, R * 0.5]]) };
	}
	if (family === 'group') {
		const R = r * 0.86;
		return { tag: 'polygon', points: pts([[0, -R], [R * 0.866, -R * 0.5], [R * 0.866, R * 0.5], [0, R], [-R * 0.866, R * 0.5], [-R * 0.866, -R * 0.5]]) };
	}
	if (family === 'item') {
		const R = r * 0.98;
		const W = R * 0.78;
		return { tag: 'polygon', points: pts([[0, -R], [W, 0], [0, R], [-W, 0]]) };
	}
	const h = r * 0.74;
	return { tag: 'rect', x: -h, y: -h, size: 2 * h, rx: 1.4 };
}

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
