// Divider colour for Plot Grid cells / row headers filled with a row or column
// colour: a dark line on light fills, a light line on dark fills, so the grid
// lines stay visible whatever palette the writer picks. Pure (no DOM).

const DARK_LINE = 'color-mix(in srgb, #000 22%, transparent)';
const LIGHT_LINE = 'color-mix(in srgb, #fff 35%, transparent)';
/** Fills lighter than this get the dark line. */
const LIGHT_FILL_THRESHOLD = 0.45;

const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

function relativeLuminance(r: number, g: number, b: number): number {
	const lin = (c: number) => {
		const v = c / 255;
		return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Luminance (0–1) of one hex / rgb() / hsl() colour, or null if it can't be read. */
export function colorLuminance(color: string): number | null {
	const c = color.trim().toLowerCase();
	if (c.startsWith('#')) {
		let hex = c.slice(1);
		if (hex.length === 3 || hex.length === 4) hex = hex.slice(0, 3).split('').map((ch) => ch + ch).join('');
		if (hex.length !== 6 && hex.length !== 8) return null;
		const n = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
		return n.some(Number.isNaN) ? null : relativeLuminance(n[0], n[1], n[2]);
	}
	const parts = c.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
	if (!parts) return null;
	const nums = parts[2].split(/[\s,/]+/).filter(Boolean).map((p) => parseFloat(p));
	if (nums.length < 3 || nums.slice(0, 3).some(Number.isNaN)) return null;
	if (parts[1].startsWith('rgb')) {
		const ch = parts[2].split(/[\s,/]+/).filter(Boolean).slice(0, 3)
			.map((p, i) => (p.endsWith('%') ? (nums[i] / 100) * 255 : nums[i]));
		return relativeLuminance(ch[0], ch[1], ch[2]);
	}
	const [r, g, b] = hslToRgb(((nums[0] % 360) + 360) % 360, nums[1] / 100, nums[2] / 100);
	return relativeLuminance(r, g, b);
}

/** Luminance of a fill: a plain colour, or the average of a gradient's readable stops. Null if nothing is readable. */
export function fillLuminance(fill: string): number | null {
	if (!fill.includes('gradient(')) return colorLuminance(fill);
	const lums = (fill.match(COLOR_TOKEN) ?? []).map(colorLuminance).filter((l): l is number => l !== null);
	return lums.length ? lums.reduce((a, b) => a + b, 0) / lums.length : null;
}

/** Divider colour for a cell painted with these fills (row and/or column colour; mixes average). */
export function axisLineColor(fills: Array<string | undefined>): string {
	const lums = fills.filter((f): f is string => !!f).map(fillLuminance).filter((l): l is number => l !== null);
	if (!lums.length) return DARK_LINE;
	const avg = lums.reduce((a, b) => a + b, 0) / lums.length;
	return avg > LIGHT_FILL_THRESHOLD ? DARK_LINE : LIGHT_LINE;
}
