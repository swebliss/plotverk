import { dashArrayFor, needsRoundCap, edgeGeometry, intensityStops } from './edge-style';
import { LineStyle } from './relations';

/** Parses `M x,y L x,y L x,y ...` into an ordered point list. */
function parseLinePoints(d: string): Array<{ x: number; y: number }> {
	const matches = [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)];
	return matches.map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

/** Parses `M x,y Q cx,cy ex,ey Q cx,cy ex,ey ...` into start + quad segments. */
function parseQuadPath(d: string): { start: { x: number; y: number }; segs: Array<{ cx: number; cy: number; ex: number; ey: number }> } {
	const startMatch = d.match(/^M(-?[\d.]+),(-?[\d.]+)/);
	const start = { x: Number(startMatch![1]), y: Number(startMatch![2]) };
	const segMatches = [...d.matchAll(/Q(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)/g)];
	const segs = segMatches.map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), ex: Number(m[3]), ey: Number(m[4]) }));
	return { start, segs };
}

const ALL_STYLES: LineStyle[] = ['solid', 'dotted', 'dashed', 'dashdot', 'double', 'jagged', 'zigzag', 'wavy'];

describe('dashArrayFor', () => {
	it('returns null for shape-driven styles', () => {
		for (const style of ['solid', 'double', 'jagged', 'zigzag', 'wavy'] as LineStyle[]) {
			expect(dashArrayFor(style, 2)).toBeNull();
		}
	});

	it('returns a dot pattern for dotted, scaling with weight', () => {
		expect(dashArrayFor('dotted', 1)).toBe('0.1 3'); // max(3, 1*2.5) = 3
		expect(dashArrayFor('dotted', 2)).toBe('0.1 5');
	});

	it('returns a dash-gap pattern for dashed', () => {
		expect(dashArrayFor('dashed', 1)).toBe('6 4');
		expect(dashArrayFor('dashed', 3)).toBe('12 8');
	});

	it('returns a dash-dot pattern for dashdot', () => {
		expect(dashArrayFor('dashdot', 1)).toBe('7 3 0.1 3');
	});
});

describe('needsRoundCap', () => {
	it('is true only for dot-bearing styles', () => {
		expect(needsRoundCap('dotted')).toBe(true);
		expect(needsRoundCap('dashdot')).toBe(true);
		expect(needsRoundCap('solid')).toBe(false);
		expect(needsRoundCap('dashed')).toBe(false);
		expect(needsRoundCap('double')).toBe(false);
		expect(needsRoundCap('wavy')).toBe(false);
	});
});

describe('intensityStops', () => {
	it('returns null when either side has no declared intensity', () => {
		expect(intensityStops(undefined, undefined)).toBeNull();
		expect(intensityStops(9, undefined)).toBeNull();
		expect(intensityStops(undefined, 2)).toBeNull();
	});

	it('clamps out-of-range intensities before computing stops', () => {
		expect(intensityStops(15, -3)).toEqual({ opacityA: 1, opacityB: 0.325 });
	});

	it('is null right at the balance threshold and qualifies just past it', () => {
		expect(intensityStops(5, 6)).toBeNull(); // gap 1 — balanced, no gradient
		expect(intensityStops(5, 7)).toEqual({ opacityA: 0.625, opacityB: 0.775 }); // gap 2 — qualifies
	});

	it('computes stop opacity as 0.25 + intensity * 0.075 per end', () => {
		const stops = intensityStops(9, 2)!;
		expect(stops.opacityA).toBeCloseTo(0.925);
		expect(stops.opacityB).toBeCloseTo(0.4);
	});
});

describe('edgeGeometry — endpoint fidelity', () => {
	it('straight styles start and end exactly on the given endpoints', () => {
		for (const style of ['solid', 'dotted', 'dashed', 'dashdot'] as LineStyle[]) {
			const g = edgeGeometry(style, 10, 20, 110, 60, 2);
			const pts = parseLinePoints(g.d);
			expect(pts[0]).toEqual({ x: 10, y: 20 });
			expect(pts[pts.length - 1]).toEqual({ x: 110, y: 60 });
			expect(g.d2).toBeUndefined();
		}
	});

	it('jagged/zigzag start and end exactly on the given endpoints', () => {
		for (const style of ['jagged', 'zigzag'] as LineStyle[]) {
			const g = edgeGeometry(style, 0, 0, 100, 40, 2);
			const pts = parseLinePoints(g.d);
			expect(pts[0]).toEqual({ x: 0, y: 0 });
			expect(pts[pts.length - 1]).toEqual({ x: 100, y: 40 });
		}
	});

	it('wavy starts and ends exactly on the given endpoints', () => {
		const g = edgeGeometry('wavy', 0, 0, 120, 0, 2);
		const { start, segs } = parseQuadPath(g.d);
		expect(start).toEqual({ x: 0, y: 0 });
		expect(segs[segs.length - 1]).toMatchObject({ ex: 120, ey: 0 });
	});

	it('collapses to a straight line under 2px regardless of style', () => {
		for (const style of ALL_STYLES) {
			const g = edgeGeometry(style, 5, 5, 5.5, 5.5, 2);
			expect(g.d).toBe('M5,5 L5.5,5.5');
			expect(g.d2).toBeUndefined();
		}
	});
});

describe('edgeGeometry — double', () => {
	it('offsets two parallel paths by weight+1 on each side', () => {
		const g = edgeGeometry('double', 0, 0, 100, 0, 2); // horizontal line, normal is vertical
		const p1 = parseLinePoints(g.d!);
		const p2 = parseLinePoints(g.d2!);
		expect(Math.abs(p1[0].y)).toBeCloseTo(3); // weight+1 = 3
		expect(Math.abs(p2[0].y)).toBeCloseTo(3);
		expect(p1[0].y).toBeCloseTo(-p2[0].y);
		expect(p1[0].x).toBeCloseTo(0);
		expect(p1[1].x).toBeCloseTo(100);
	});
});

describe('edgeGeometry — jagged amplitude', () => {
	it('keeps every spike within the 3-5px band', () => {
		const g = edgeGeometry('jagged', 0, 0, 200, 0, 2); // horizontal — deviation is pure |y|
		const pts = parseLinePoints(g.d);
		for (const p of pts.slice(1, -1)) {
			expect(Math.abs(p.y)).toBeGreaterThanOrEqual(3);
			expect(Math.abs(p.y)).toBeLessThanOrEqual(5);
		}
	});

	it('is deterministic for the same endpoints', () => {
		const a = edgeGeometry('jagged', 3, 7, 203, 47, 2);
		const b = edgeGeometry('jagged', 3, 7, 203, 47, 2);
		expect(a.d).toBe(b.d);
	});
});

describe('edgeGeometry — zigzag amplitude', () => {
	it('uses a fixed 3.5px amplitude', () => {
		const g = edgeGeometry('zigzag', 0, 0, 200, 0, 2);
		const pts = parseLinePoints(g.d);
		for (const p of pts.slice(1, -1)) {
			expect(Math.abs(p.y)).toBeCloseTo(3.5);
		}
	});
});

describe('edgeGeometry — reversal symmetry', () => {
	it('jagged/zigzag draw the identical set of points in reverse order when endpoints swap', () => {
		for (const style of ['jagged', 'zigzag'] as LineStyle[]) {
			const forward = parseLinePoints(edgeGeometry(style, 12, 34, 212, 74, 2).d);
			const backward = parseLinePoints(edgeGeometry(style, 212, 74, 12, 34, 2).d);
			expect(backward).toEqual([...forward].reverse());
		}
	});

	it('wavy traces a congruent curve in reverse — same control points, same endpoints', () => {
		const forward = parseQuadPath(edgeGeometry('wavy', 12, 34, 212, 34, 2).d);
		const backward = parseQuadPath(edgeGeometry('wavy', 212, 34, 12, 34, 2).d);

		expect(backward.start).toEqual({ x: 212, y: 34 });
		expect(forward.start).toEqual({ x: 12, y: 34 });

		const forwardControls = forward.segs.map((s) => `${s.cx},${s.cy}`).sort();
		const backwardControls = backward.segs.map((s) => `${s.cx},${s.cy}`).sort();
		expect(backwardControls).toEqual(forwardControls);
	});

	it('double offsets are mirrored when endpoints swap', () => {
		const forward = edgeGeometry('double', 0, 0, 100, 0, 2);
		const backward = edgeGeometry('double', 100, 0, 0, 0, 2);
		// Same two parallel lines exist either way, just traversed start<->end.
		const fPts = [parseLinePoints(forward.d), parseLinePoints(forward.d2!)];
		const bPts = [parseLinePoints(backward.d), parseLinePoints(backward.d2!)];
		const fYs = fPts.map((pts) => pts[0].y).sort();
		const bYs = bPts.map((pts) => pts[0].y).sort();
		expect(bYs).toEqual(fYs);
	});
});
