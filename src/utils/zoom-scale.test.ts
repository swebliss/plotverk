import { measuredScale, toLayoutPx } from './zoom-scale';

describe('measuredScale', () => {
	it('is exactly 1 at 100% — nothing changes there', () => {
		expect(measuredScale(200, 200)).toBe(1);
	});

	it('is the zoom for every step the toolbar offers (50% … 200%)', () => {
		for (const z of [0.5, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2]) {
			expect(measuredScale(200 * z, 200)).toBeCloseTo(z, 5);
		}
	});

	it('treats rounding noise around 100% as exactly 1', () => {
		expect(measuredScale(200.4, 200)).toBe(1); // offsetWidth is rounded to a whole number
		expect(measuredScale(199.6, 200)).toBe(1);
	});

	it('shrugs off the whole-pixel rounding of the layout width at other zooms', () => {
		// true layout width 120.4, reported 120: ~0.3% off, well under a pixel over a 300px drag
		const reported = measuredScale(1.5 * 120.4, 120);
		expect(Math.abs(reported - 1.5)).toBeLessThan(0.01);
	});

	it('falls back to 1 for anything unusable', () => {
		expect(measuredScale(0, 0)).toBe(1);        // hidden element
		expect(measuredScale(100, 0)).toBe(1);
		expect(measuredScale(0, 100)).toBe(1);
		expect(measuredScale(NaN, 100)).toBe(1);
		expect(measuredScale(100, Infinity)).toBe(1);
		expect(measuredScale(-50, 100)).toBe(1);
		expect(measuredScale(2000, 100)).toBe(1);   // 20× is not a zoom, it is a bad measurement
		expect(measuredScale(10, 100)).toBe(1);
	});
});

describe('toLayoutPx', () => {
	it('leaves a distance alone at 100%', () => {
		expect(toLayoutPx(120, 1)).toBe(120);
		expect(toLayoutPx(-37.5, 1)).toBe(-37.5);
	});

	it('shrinks a screen distance at 150% so the element lands on the pointer', () => {
		// pointer moved 150 screen px; the element is drawn at 1.5×, so translate 100 layout px
		expect(toLayoutPx(150, 1.5)).toBeCloseTo(100, 9);
		// and the on-screen result equals the pointer's travel
		expect(toLayoutPx(150, 1.5) * 1.5).toBeCloseTo(150, 9);
	});

	it('grows a screen distance at 50% (translate more layout px, since each is drawn half size)', () => {
		expect(toLayoutPx(100, 0.5)).toBeCloseTo(200, 9);
		expect(toLayoutPx(100, 0.5) * 0.5).toBeCloseTo(100, 9);
	});

	it('keeps the pointer and the element together at every zoom the toolbar offers', () => {
		for (const z of [0.5, 0.7, 1, 1.3, 1.5, 2]) {
			const scale = measuredScale(200 * z, 200);
			for (const travel of [-420, -35, 0, 12, 300]) {
				expect(toLayoutPx(travel, scale) * z).toBeCloseTo(travel, 6);
			}
		}
	});

	it('ignores a nonsense scale rather than amplifying it', () => {
		expect(toLayoutPx(100, 0)).toBe(100);
		expect(toLayoutPx(100, -2)).toBe(100);
		expect(toLayoutPx(100, NaN)).toBe(100);
	});
});
