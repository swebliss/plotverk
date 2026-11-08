/**
 * Pure SVG path/dasharray math for Connections Map line styles. No DOM, no
 * Obsidian imports — fully unit-testable.
 *
 * Wiggly styles (jagged/zigzag/wavy) are computed in a canonical point order
 * (lexicographically smaller endpoint first) and only reversed for output —
 * this guarantees the drawn line is pixel-identical no matter which endpoint
 * a caller happens to pass first, which matters here because a pair's "A" and
 * "B" ends are assigned by an unrelated path-string sort, not by geometry.
 */

import { LineStyle } from './relations';

export interface EdgeGeom {
	/** Primary path `d` attribute. */
	d: string;
	/** Second parallel path, only present for the `double` style. */
	d2?: string;
}

const round = (n: number): number => Math.round(n * 100) / 100;

function lineD(x1: number, y1: number, x2: number, y2: number): string {
	return `M${round(x1)},${round(y1)} L${round(x2)},${round(y2)}`;
}

/** SVG `stroke-dasharray` value for a line style, or null for a solid/path-shaped style. */
export function dashArrayFor(style: LineStyle, weight: number): string | null {
	switch (style) {
		case 'dotted': return `0.1 ${Math.max(3, weight * 2.5)}`;
		case 'dashed': return `${weight * 3 + 3} ${weight * 2 + 2}`;
		case 'dashdot': return `${weight * 3 + 4} 3 0.1 3`;
		default: return null;
	}
}

/** Dotted/dash-dot rely on near-zero-length dash segments rendering as round dots. */
export function needsRoundCap(style: LineStyle): boolean {
	return style === 'dotted' || style === 'dashdot';
}

// ─── Deterministic per-segment jitter ──────────────────────────────────────────

/** Cheap deterministic pseudo-random in [0,1) — same inputs always give the same value. */
function seeded(ax: number, ay: number, bx: number, by: number, i: number): number {
	const s = Math.sin(ax * 12.9898 + ay * 78.233 + bx * 39.346 + by * 11.135 + i * 7.234) * 43758.5453;
	return s - Math.floor(s);
}

function isReversed(x1: number, y1: number, x2: number, y2: number): boolean {
	return x1 > x2 || (x1 === x2 && y1 > y2);
}

// ─── Jagged / zigzag (straight-segment spikes) ─────────────────────────────────

interface Point { x: number; y: number }

function spikedPoints(ax: number, ay: number, bx: number, by: number, style: 'jagged' | 'zigzag'): Point[] {
	const dx = bx - ax, dy = by - ay;
	const len = Math.hypot(dx, dy);
	const ux = dx / len, uy = dy / len;
	const nx = -uy, ny = ux;

	const segLen = style === 'jagged' ? 9 : 8;
	const steps = Math.max(2, Math.round(len / segLen));
	const actualSeg = len / steps;

	const pts: Point[] = [{ x: ax, y: ay }];
	for (let i = 1; i < steps; i++) {
		const d = actualSeg * i;
		const px = ax + ux * d, py = ay + uy * d;
		const sign = i % 2 === 0 ? 1 : -1;
		const amp = style === 'zigzag' ? 3.5 : 3 + seeded(ax, ay, bx, by, i) * 2; // jagged: 3–5px
		pts.push({ x: px + nx * amp * sign, y: py + ny * amp * sign });
	}
	pts.push({ x: bx, y: by });
	return pts;
}

function pointsToPathD(pts: Point[]): string {
	return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)},${round(p.y)}`).join(' ');
}

// ─── Wavy (chained quadratic curves) ───────────────────────────────────────────

interface QuadSeg { cx: number; cy: number; ex: number; ey: number }

function wavySegments(ax: number, ay: number, bx: number, by: number): QuadSeg[] {
	const dx = bx - ax, dy = by - ay;
	const len = Math.hypot(dx, dy);
	const ux = dx / len, uy = dy / len;
	const nx = -uy, ny = ux;

	const half = 8; // half of the 16px wavelength — one hump per half-wave
	const steps = Math.max(1, Math.round(len / half));
	const actualHalf = len / steps;

	const segs: QuadSeg[] = [];
	for (let i = 1; i <= steps; i++) {
		const midLen = actualHalf * (i - 0.5);
		const endLen = actualHalf * i;
		const sign = i % 2 === 0 ? 1 : -1;
		segs.push({
			cx: ax + ux * midLen + nx * 3.5 * sign,
			cy: ay + uy * midLen + ny * 3.5 * sign,
			ex: ax + ux * endLen,
			ey: ay + uy * endLen,
		});
	}
	return segs;
}

function wavyPathForward(ax: number, ay: number, segs: QuadSeg[]): string {
	let d = `M${round(ax)},${round(ay)}`;
	for (const s of segs) d += ` Q${round(s.cx)},${round(s.cy)} ${round(s.ex)},${round(s.ey)}`;
	return d;
}

/** Traces the same curve backward — start at b, chain the same control points in reverse. */
function wavyPathReversed(ax: number, ay: number, bx: number, by: number, segs: QuadSeg[]): string {
	let d = `M${round(bx)},${round(by)}`;
	for (let i = segs.length - 1; i >= 0; i--) {
		const prevEnd = i === 0 ? { x: ax, y: ay } : { x: segs[i - 1].ex, y: segs[i - 1].ey };
		d += ` Q${round(segs[i].cx)},${round(segs[i].cy)} ${round(prevEnd.x)},${round(prevEnd.y)}`;
	}
	return d;
}

// ─── Reciprocal intensity gradient stops ───────────────────────────────────────

export interface IntensityStops {
	/** Stop opacity at the A-declared end (0–1). */
	opacityA: number;
	/** Stop opacity at the B-declared end (0–1). */
	opacityB: number;
}

/**
 * Per-endpoint gradient stop opacities for a reciprocal-behavior pair whose two
 * sides declared different bond strengths — e.g. Aldric's `Enemy (intensity 9)`
 * vs Beron's `Enemy (intensity 2)`. Returns `null` when the pair doesn't
 * qualify for the fading-gradient treatment: either side missing an intensity,
 * or the two are close enough to read as balanced (gap under 2) — both cases
 * fall back to the plain single-color line.
 */
export function intensityStops(iA: number | undefined, iB: number | undefined): IntensityStops | null {
	if (iA === undefined || iB === undefined) return null;
	const a = Math.min(10, Math.max(1, iA));
	const b = Math.min(10, Math.max(1, iB));
	if (Math.abs(a - b) < 2) return null;
	return { opacityA: 0.25 + a * 0.075, opacityB: 0.25 + b * 0.075 };
}

// ─── Public geometry builder ────────────────────────────────────────────────────

/**
 * Build the SVG path geometry for one edge segment. Endpoints are always
 * exactly (x1,y1) and (x2,y2) — the line style only shapes what happens
 * between them. Segments under 2px collapse to a straight line to avoid
 * degenerate direction math.
 */
export function edgeGeometry(
	style: LineStyle,
	x1: number, y1: number, x2: number, y2: number,
	weight: number,
): EdgeGeom {
	const len = Math.hypot(x2 - x1, y2 - y1);
	if (len < 2) return { d: lineD(x1, y1, x2, y2) };

	if (style === 'double') {
		const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
		const off = weight + 1;
		return {
			d: lineD(x1 + nx * off, y1 + ny * off, x2 + nx * off, y2 + ny * off),
			d2: lineD(x1 - nx * off, y1 - ny * off, x2 - nx * off, y2 - ny * off),
		};
	}

	if (style === 'jagged' || style === 'zigzag') {
		const reversed = isReversed(x1, y1, x2, y2);
		const [ax, ay, bx, by] = reversed ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
		const pts = spikedPoints(ax, ay, bx, by, style);
		return { d: pointsToPathD(reversed ? [...pts].reverse() : pts) };
	}

	if (style === 'wavy') {
		const reversed = isReversed(x1, y1, x2, y2);
		const [ax, ay, bx, by] = reversed ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
		const segs = wavySegments(ax, ay, bx, by);
		return { d: reversed ? wavyPathReversed(ax, ay, bx, by, segs) : wavyPathForward(ax, ay, segs) };
	}

	// solid / dotted / dashed / dashdot — shape comes from stroke-dasharray, not the path.
	return { d: lineD(x1, y1, x2, y2) };
}
