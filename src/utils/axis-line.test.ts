import { axisLineColor, colorLuminance, fillLuminance } from './axis-line';

const DARK = 'color-mix(in srgb, #000 22%, transparent)';
const LIGHT = 'color-mix(in srgb, #fff 35%, transparent)';

describe('colorLuminance', () => {
	it('reads hex in short and long form', () => {
		expect(colorLuminance('#fff')).toBeCloseTo(1);
		expect(colorLuminance('#000000')).toBeCloseTo(0);
	});
	it('reads rgb() and hsl()', () => {
		expect(colorLuminance('rgb(255, 255, 255)')).toBeCloseTo(1);
		expect(colorLuminance('rgba(0 0 0 / 50%)')).toBeCloseTo(0);
		expect(colorLuminance('hsl(0, 0%, 100%)')).toBeCloseTo(1);
		expect(colorLuminance('hsl(210deg 50% 10%)')!).toBeLessThan(0.05);
	});
	it('returns null for what it cannot read', () => {
		expect(colorLuminance('rebeccapurple')).toBeNull();
		expect(colorLuminance('#12')).toBeNull();
	});
});

describe('fillLuminance', () => {
	it('averages the stops of a gradient', () => {
		const l = fillLuminance('linear-gradient(135deg, #30BE96 0%, #402565 100%)')!;
		const avg = (colorLuminance('#30BE96')! + colorLuminance('#402565')!) / 2;
		expect(l).toBeCloseTo(avg);
	});
});

describe('axisLineColor', () => {
	it('dark line on pale fills', () => {
		expect(axisLineColor(['#dbeafe'])).toBe(DARK);
	});
	it('light line on deep fills', () => {
		for (const c of ['#402565', '#13549a', '#27526F']) expect(axisLineColor([c])).toBe(LIGHT);
		expect(axisLineColor(['linear-gradient(135deg, #30BE96 0%, #402565 100%)'])).toBe(LIGHT);
	});
	it('averages a row and a column colour', () => {
		expect(axisLineColor(['#ffffff', '#000000'])).toBe(DARK);   // avg 0.5
		expect(axisLineColor(['#dbeafe', undefined])).toBe(DARK);
	});
	it('falls back to the dark line when nothing is readable', () => {
		expect(axisLineColor(['rebeccapurple'])).toBe(DARK);
		expect(axisLineColor([])).toBe(DARK);
	});
});
