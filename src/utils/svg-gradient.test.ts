import {
	isGradientColor,
	parseCssGradient,
	linearGradientVector,
	solidFromColor,
} from './svg-gradient';

describe('isGradientColor', () => {
	it('recognises the gradient forms the palettes ship', () => {
		expect(isGradientColor('linear-gradient(135deg, #C165DD 0%, #5C27FE 100%)')).toBe(true);
		expect(isGradientColor('radial-gradient(at 20% 30%, #fff 0px, transparent 80%)')).toBe(true);
		expect(isGradientColor('repeating-linear-gradient(45deg, #000 0%, #fff 100%)')).toBe(true);
	});

	it('leaves solid colors and junk alone', () => {
		expect(isGradientColor('#7c5fd3')).toBe(false);
		expect(isGradientColor('rgba(1, 2, 3, 0.5)')).toBe(false);
		expect(isGradientColor('var(--text-muted)')).toBe(false);
		expect(isGradientColor(undefined)).toBe(false);
		expect(isGradientColor(null)).toBe(false);
		expect(isGradientColor(42)).toBe(false);
	});
});

describe('parseCssGradient — the two-stop case every palette uses', () => {
	it('reads angle, colors and positions', () => {
		const g = parseCssGradient('linear-gradient(135deg, #C165DD 0%, #5C27FE 100%)');
		expect(g).toEqual({
			kind: 'linear',
			angle: 135,
			stops: [
				{ color: '#C165DD', offset: 0, opacity: 1 },
				{ color: '#5C27FE', offset: 1, opacity: 1 },
			],
		});
	});

	it('keeps negative and fractional angles', () => {
		expect(parseCssGradient('linear-gradient(-45deg, #000 0%, #fff 100%)')?.angle).toBe(-45);
		expect(parseCssGradient('linear-gradient(22.5deg, #000 0%, #fff 100%)')?.angle).toBe(22.5);
	});

	it('accepts turn units and to-side keywords', () => {
		expect(parseCssGradient('linear-gradient(0.25turn, #000, #fff)')?.angle).toBe(90);
		expect(parseCssGradient('linear-gradient(to right, #000, #fff)')?.angle).toBe(90);
		expect(parseCssGradient('linear-gradient(to bottom right, #000, #fff)')?.angle).toBe(135);
		expect(parseCssGradient('linear-gradient(to top, #000, #fff)')?.angle).toBe(0);
	});

	it('defaults to `to bottom` when no direction is given', () => {
		const g = parseCssGradient('linear-gradient(#000, #fff)');
		expect(g?.angle).toBe(180);
		expect(g?.stops.map((s) => s.offset)).toEqual([0, 1]);
	});
});

describe('parseCssGradient — positions', () => {
	it('pins the ends and spreads interior gaps evenly', () => {
		const g = parseCssGradient('linear-gradient(90deg, #a00, #0a0, #00a, #aa0)');
		expect(g?.stops.map((s) => s.offset)).toEqual([0, 1 / 3, 2 / 3, 1]);
	});

	it('interpolates unpositioned stops between the known ones', () => {
		const g = parseCssGradient('linear-gradient(90deg, #a00 0%, #0a0, #00a 60%, #aa0 100%)');
		expect(g?.stops.map((s) => s.offset)).toEqual([0, 0.3, 0.6, 1]);
	});

	it('never runs backwards when the source positions do', () => {
		const g = parseCssGradient('linear-gradient(90deg, #a00 40%, #0a0 10%, #00a 100%)');
		expect(g?.stops.map((s) => s.offset)).toEqual([0.4, 0.4, 1]);
	});

	it('treats a 0 length as position 0 and ignores lengths it cannot resolve', () => {
		const g = parseCssGradient('linear-gradient(90deg, #a00 0px, #0a0 40px, #00a 100%)');
		expect(g?.stops[0].offset).toBe(0);
		expect(g?.stops[1].offset).toBeCloseTo(0.5);
		expect(g?.stops[2].offset).toBe(1);
	});
});

describe('parseCssGradient — alpha, the other route to a black bar', () => {
	it('lifts rgba/hsla alpha into stop-opacity', () => {
		const g = parseCssGradient('linear-gradient(90deg, rgba(255, 0, 0, 0.5) 0%, hsla(28, 100%, 74%, 0.7) 100%)');
		expect(g?.stops).toEqual([
			{ color: 'rgb(255, 0, 0)', offset: 0, opacity: 0.5 },
			{ color: 'hsl(28, 100%, 74%)', offset: 1, opacity: 0.7 },
		]);
	});

	it('handles slash alpha and 8-digit hex', () => {
		const g = parseCssGradient('linear-gradient(90deg, rgb(1 2 3 / 50%) 0%, #11223380 100%)');
		expect(g?.stops[0]).toEqual({ color: 'rgb(1, 2, 3)', offset: 0, opacity: 0.5 });
		expect(g?.stops[1].color).toBe('#112233');
		expect(g?.stops[1].opacity).toBeCloseTo(0.502, 2);
	});

	it('borrows a neighbouring color for `transparent` instead of fading to black', () => {
		const g = parseCssGradient('linear-gradient(90deg, #ff8800 0%, transparent 100%)');
		expect(g?.stops[1]).toEqual({ color: '#ff8800', offset: 1, opacity: 0 });
	});

	it('borrows forwards too when the first stop is transparent', () => {
		const g = parseCssGradient('linear-gradient(90deg, transparent 0%, #ff8800 100%)');
		expect(g?.stops[0]).toEqual({ color: '#ff8800', offset: 0, opacity: 0 });
	});
});

describe('parseCssGradient — awkward input', () => {
	it('takes the first layer of a stacked multi-gradient (the "Explosion" palette)', () => {
		const explosion =
			'radial-gradient(at 20% 30%, hsla(28, 100%, 74%, 0.7) 0px, transparent 80%), ' +
			'radial-gradient(at 80% 20%, hsla(189, 100%, 56%, 0.7) 0px, transparent 80%)';
		const g = parseCssGradient(explosion);
		expect(g?.kind).toBe('radial');
		expect(g?.stops).toEqual([
			{ color: 'hsl(28, 100%, 74%)', offset: 0, opacity: 0.7 },
			{ color: 'hsl(28, 100%, 74%)', offset: 0.8, opacity: 0 },
		]);
	});

	it('returns null for non-gradients and for gradients with too few stops', () => {
		expect(parseCssGradient('#7c5fd3')).toBeNull();
		expect(parseCssGradient('linear-gradient(90deg)')).toBeNull();
		expect(parseCssGradient('linear-gradient(90deg, #fff)')).toBeNull();
		expect(parseCssGradient('linear-gradient(90deg, #000, #fff')).toBeNull();
		expect(parseCssGradient(undefined)).toBeNull();
	});
});

describe('linearGradientVector', () => {
	it('maps the cardinal directions onto the unit box', () => {
		expect(linearGradientVector(0)).toEqual({ x1: 0.5, y1: 1, x2: 0.5, y2: 0 });
		expect(linearGradientVector(90)).toEqual({ x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
		expect(linearGradientVector(180)).toEqual({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
		expect(linearGradientVector(270)).toEqual({ x1: 1, y1: 0.5, x2: 0, y2: 0.5 });
	});

	it('keeps the cardinal directions axis-pure, which is why views override to them', () => {
		// An objectBoundingBox gradient is applied in a normalised unit square
		// and stretched back, so any DIAGONAL vector gets sheared by the shape's
		// aspect ratio — a 135deg fade on a tall thin bar ends up reading
		// left-to-right. A cardinal vector varies along exactly one axis and is
		// therefore immune. The timeline relies on this when it forces gradients
		// to run along the time axis.
		for (const angle of [0, 180]) {
			const v = linearGradientVector(angle);
			expect(v.x1).toBe(v.x2);
			expect(v.y1).not.toBe(v.y2);
		}
		for (const angle of [90, 270]) {
			const v = linearGradientVector(angle);
			expect(v.y1).toBe(v.y2);
			expect(v.x1).not.toBe(v.x2);
		}
	});

	it('reaches corner to corner on the 135deg diagonal the palettes use', () => {
		expect(linearGradientVector(135)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
		expect(linearGradientVector(45)).toEqual({ x1: 0, y1: 1, x2: 1, y2: 0 });
	});

	it('stays inside the box at in-between angles', () => {
		const v = linearGradientVector(20);
		for (const n of [v.x1, v.y1, v.x2, v.y2]) {
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThanOrEqual(1);
		}
		// 20deg points up and to the right, so the line runs bottom-left → top-right.
		expect(v.x2).toBeGreaterThan(v.x1);
		expect(v.y2).toBeLessThan(v.y1);
	});

	it('normalises angles past a full turn', () => {
		expect(linearGradientVector(450)).toEqual(linearGradientVector(90));
	});
});

describe('solidFromColor', () => {
	it('passes solid colors through untouched', () => {
		expect(solidFromColor('#7c5fd3')).toBe('#7c5fd3');
		expect(solidFromColor('var(--text-muted)')).toBe('var(--text-muted)');
	});

	it('takes a gradient down to its first visible stop', () => {
		expect(solidFromColor('linear-gradient(135deg, #C165DD 0%, #5C27FE 100%)')).toBe('#C165DD');
		expect(solidFromColor('linear-gradient(90deg, transparent 0%, #ff8800 100%)')).toBe('#ff8800');
	});

	it('falls back to a literal color found in an unparseable gradient', () => {
		expect(solidFromColor('linear-gradient(90deg, #abcdef')).toBe('#abcdef');
	});

	it('falls back to the muted theme color when there is nothing to read', () => {
		expect(solidFromColor('linear-gradient(nonsense')).toBe('var(--text-muted)');
	});
});
