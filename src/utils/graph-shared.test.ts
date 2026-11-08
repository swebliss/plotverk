import { isTap, TAP_SLOP_PX, truncate, pointerDist, fanOffsets, computeTimelineFit } from './graph-shared';

describe('isTap', () => {
	it('treats zero movement as a tap', () => {
		expect(isTap(0, 0)).toBe(true);
	});

	it('allows travel up to the slop on either axis', () => {
		expect(isTap(TAP_SLOP_PX, 0)).toBe(true);
		expect(isTap(0, TAP_SLOP_PX)).toBe(true);
		expect(isTap(-TAP_SLOP_PX, TAP_SLOP_PX)).toBe(true);
	});

	it('rejects travel past the slop on either axis', () => {
		expect(isTap(TAP_SLOP_PX + 1, 0)).toBe(false);
		expect(isTap(0, TAP_SLOP_PX + 1)).toBe(false);
		expect(isTap(-(TAP_SLOP_PX + 1), 0)).toBe(false);
	});

	it('uses per-axis distance, not diagonal', () => {
		// 3px on both axes is ~4.24px diagonal travel but still a tap —
		// per-axis semantics, preserving the historical `Math.abs(d) > 3`
		// drag checks this helper replaced.
		expect(isTap(TAP_SLOP_PX, TAP_SLOP_PX)).toBe(true);
	});
});

describe('truncate', () => {
	it('returns short strings untouched', () => {
		expect(truncate('abc', 5)).toBe('abc');
		expect(truncate('abcde', 5)).toBe('abcde');
	});

	it('cuts to max length including the ellipsis', () => {
		const out = truncate('abcdefgh', 5);
		expect(out).toBe('abcd…');
		expect(out.length).toBe(5);
	});
});

describe('pointerDist', () => {
	it('computes euclidean distance', () => {
		expect(pointerDist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
		expect(pointerDist({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
	});
});

describe('fanOffsets', () => {
	it('returns a single zero offset for one item', () => {
		expect(fanOffsets(1, 10)).toEqual([0]);
	});

	it('returns nothing for zero items', () => {
		expect(fanOffsets(0, 10)).toEqual([]);
	});

	it('centers a pair symmetrically around zero', () => {
		expect(fanOffsets(2, 10)).toEqual([-5, 5]);
	});

	it('centers an odd count on zero, including the middle item', () => {
		expect(fanOffsets(3, 10)).toEqual([-10, 0, 10]);
	});

	it('spaces every item by exactly `spacing`', () => {
		const out = fanOffsets(5, 4);
		for (let i = 1; i < out.length; i++) {
			expect(out[i] - out[i - 1]).toBe(4);
		}
	});

	it('sums to zero regardless of count (stays centered)', () => {
		expect(fanOffsets(4, 6).reduce((a, b) => a + b, 0)).toBe(0);
		expect(fanOffsets(7, 3).reduce((a, b) => a + b, 0)).toBe(0);
	});
});

describe('computeTimelineFit', () => {
	const VIEWPORT = 800;
	const PX_PER_DAY = 3;
	const MIN_SCALE = 0.15;
	const MAX_SCALE = 8;

	it('keeps currentScale and centers on nothing when there are no events', () => {
		const { scale, offset } = computeTimelineFit([], VIEWPORT, PX_PER_DAY, MIN_SCALE, MAX_SCALE, 1);
		expect(scale).toBe(1);
		expect(offset).toBe(0);
	});

	it('keeps currentScale for a single event (zero span) and centers on its day', () => {
		const { scale, offset } = computeTimelineFit([100], VIEWPORT, PX_PER_DAY, MIN_SCALE, MAX_SCALE, 2);
		expect(scale).toBe(2);
		// offset should place day 100 at the viewport's midpoint at the current scale.
		expect(offset).toBe(VIEWPORT / 2 - 100 * PX_PER_DAY * 2);
	});

	it('treats repeated identical days (multiple events, zero span) the same as a single event', () => {
		const { scale } = computeTimelineFit([50, 50, 50], VIEWPORT, PX_PER_DAY, MIN_SCALE, MAX_SCALE, 1.5);
		expect(scale).toBe(1.5);
	});

	it('clamps to the minimum zoom for a huge span (2000 story-years apart)', () => {
		const { scale } = computeTimelineFit([0, 717000], VIEWPORT, PX_PER_DAY, MIN_SCALE, MAX_SCALE, 1);
		expect(scale).toBe(MIN_SCALE);
	});

	it('clamps to the maximum zoom for a tiny span', () => {
		const { scale } = computeTimelineFit([0, 1], VIEWPORT, PX_PER_DAY, MIN_SCALE, MAX_SCALE, 1);
		expect(scale).toBe(MAX_SCALE);
	});

	it('fits a mid-sized span within bounds and centers its midpoint', () => {
		// Span of 100 days at 3px/day needs 300px of world width; with 0.8
		// padding on an 800px viewport (640px budget) the fit scale is well
		// inside [0.15, 8], so it should not be clamped to either bound.
		const { scale, offset } = computeTimelineFit([0, 100], VIEWPORT, PX_PER_DAY, MIN_SCALE, MAX_SCALE, 1);
		expect(scale).toBeGreaterThan(MIN_SCALE);
		expect(scale).toBeLessThan(MAX_SCALE);
		const expectedScale = (VIEWPORT * 0.8) / (100 * PX_PER_DAY);
		expect(scale).toBeCloseTo(expectedScale);
		const expectedOffset = VIEWPORT / 2 - 50 * PX_PER_DAY * expectedScale;
		expect(offset).toBeCloseTo(expectedOffset);
	});

	it('returns currentScale unchanged when the viewport has no size yet', () => {
		const { scale, offset } = computeTimelineFit([0, 100], 0, PX_PER_DAY, MIN_SCALE, MAX_SCALE, 1);
		expect(scale).toBe(1);
		expect(offset).toBe(0);
	});
});
