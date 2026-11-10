/**
 * CSS gradient strings → SVG paint.
 *
 * Plotverk stores every user-picked color as a CSS string, because most of the
 * UI is HTML where `style.background = 'linear-gradient(...)'` just works. SVG
 * is different: `fill`/`stroke` take a *paint* (a color or `url(#id)`), never an
 * image — handing them a gradient string is invalid, so the shape falls back to
 * the initial `fill` value and renders BLACK. This module converts the strings
 * into real `<linearGradient>`/`<radialGradient>` defs.
 *
 * The parsing half is pure and tested; `SvgGradientDefs` at the bottom is the
 * thin DOM half. Both are view-agnostic on purpose — rel-graph and story-tree
 * can adopt them without a second copy.
 */

export interface GradientStop {
	/** Solid color for `stop-color`. Never `transparent` — alpha is split out. */
	color: string;
	/** Position along the gradient line, 0..1. */
	offset: number;
	/** Alpha for `stop-opacity`, 0..1. */
	opacity: number;
}

export interface ParsedGradient {
	kind: 'linear' | 'radial';
	/** CSS angle in degrees (0 = to top, growing clockwise). Linear only. */
	angle: number;
	stops: GradientStop[];
}

const GRADIENT_HEAD = /(?:repeating-)?(linear|radial)-gradient\s*\(/i;

/** A color string that no SVG `fill` can take as-is. */
export function isGradientColor(value: unknown): boolean {
	return typeof value === 'string' && GRADIENT_HEAD.test(value);
}

/** Split on commas that sit at paren depth 0 — `rgba(1, 2, 3, .5)` stays whole. */
function splitTopLevel(input: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		else if (ch === ',' && depth === 0) {
			parts.push(input.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(input.slice(start));
	return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

const SIDE_ANGLES: Record<string, number> = {
	top: 0,
	'top right': 45,
	'right top': 45,
	right: 90,
	'bottom right': 135,
	'right bottom': 135,
	bottom: 180,
	'bottom left': 225,
	'left bottom': 225,
	left: 270,
	'top left': 315,
	'left top': 315,
};

/**
 * Read the leading config argument, if the first part is one. Returns the angle
 * and whether the part was consumed (a first part that is a color is not).
 */
function readConfig(first: string, kind: 'linear' | 'radial'): { angle: number; consumed: boolean } {
	const deg = /^(-?\d*\.?\d+)deg$/i.exec(first);
	if (deg) return { angle: parseFloat(deg[1]), consumed: true };

	const turn = /^(-?\d*\.?\d+)turn$/i.exec(first);
	if (turn) return { angle: parseFloat(turn[1]) * 360, consumed: true };

	const side = /^to\s+([a-z]+(?:\s+[a-z]+)?)$/i.exec(first);
	if (side) {
		const key = side[1].toLowerCase().replace(/\s+/g, ' ');
		return { angle: SIDE_ANGLES[key] ?? 180, consumed: true };
	}

	// Radial shape/size/position config ("circle", "farthest-corner at 20% 30%",
	// "at 50% 50%") — we always approximate radials as a centered circle, so the
	// config only needs swallowing, not reading.
	if (kind === 'radial' && /^(circle|ellipse|closest|farthest|at\s)/i.test(first)) {
		return { angle: 180, consumed: true };
	}

	// CSS default when no direction is given is `to bottom`.
	return { angle: 180, consumed: false };
}

/** `rgba()`/`hsla()`/`transparent` → an SVG-safe (color, opacity) pair. */
function splitAlpha(raw: string): { color: string; opacity: number } {
	const color = raw.trim();
	if (/^transparent$/i.test(color)) return { color: '', opacity: 0 };

	const fn = /^(rgba?|hsla?)\s*\(([^)]*)\)$/i.exec(color);
	if (fn) {
		// Comma syntax, space syntax and `/ alpha` all reduce to a token list.
		const args = fn[2].split(/[,/\s]+/).filter((a) => a.length > 0);
		if (args.length === 4) {
			const a = args[3].endsWith('%') ? parseFloat(args[3]) / 100 : parseFloat(args[3]);
			const base = fn[1].toLowerCase().startsWith('rgb') ? 'rgb' : 'hsl';
			return {
				color: `${base}(${args.slice(0, 3).join(', ')})`,
				opacity: Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1,
			};
		}
	}

	// #rrggbbaa / #rgba — SVG ignores alpha on stop-color, so lift it out.
	const hex8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(color);
	if (hex8) return { color: `#${hex8[1]}`, opacity: parseInt(hex8[2], 16) / 255 };
	const hex4 = /^#([0-9a-f]{3})([0-9a-f])$/i.exec(color);
	if (hex4) return { color: `#${hex4[1]}`, opacity: parseInt(hex4[2] + hex4[2], 16) / 255 };

	return { color, opacity: 1 };
}

/** Split one stop part into its color and its optional position. */
function readStop(part: string): { color: string; opacity: number; offset?: number } | null {
	// Position, when present, is the trailing token after the color.
	const m = /^(.*?)(?:\s+(-?\d*\.?\d+)(%|px|em|rem)?)?$/s.exec(part.trim());
	if (!m) return null;
	const rawColor = (m[1] || '').trim();
	if (!rawColor) return null;

	const { color, opacity } = splitAlpha(rawColor);
	let offset: number | undefined;
	if (m[2] !== undefined) {
		const n = parseFloat(m[2]);
		if (m[3] === '%') offset = n / 100;
		// Absolute lengths need geometry we do not have here. 0 is unambiguous;
		// anything else is left for even distribution.
		else if (n === 0) offset = 0;
	}
	return { color, opacity, offset };
}

/**
 * Parse the FIRST gradient layer of a CSS color string. Stacked layers (used by
 * the "Explosion" palette entry) cannot be expressed as one SVG paint, so the
 * first layer stands in for the stack — colored and recognisable beats black.
 * Returns null when nothing usable is in there; callers fall back to
 * `solidFromColor`.
 */
export function parseCssGradient(value: unknown): ParsedGradient | null {
	if (!isGradientColor(value)) return null;
	const str = value as string;

	const head = GRADIENT_HEAD.exec(str);
	if (!head) return null;
	const kind = head[1].toLowerCase() as 'linear' | 'radial';

	// Walk to the matching close paren so nested rgba()/hsla() are safe.
	const open = head.index + head[0].length;
	let depth = 1;
	let close = -1;
	for (let i = open; i < str.length; i++) {
		if (str[i] === '(') depth++;
		else if (str[i] === ')') {
			depth--;
			if (depth === 0) {
				close = i;
				break;
			}
		}
	}
	if (close < 0) return null;

	const parts = splitTopLevel(str.slice(open, close));
	if (parts.length === 0) return null;

	const cfg = readConfig(parts[0], kind);
	const stopParts = cfg.consumed ? parts.slice(1) : parts;

	const raw: Array<{ color: string; opacity: number; offset?: number }> = [];
	for (const part of stopParts) {
		const stop = readStop(part);
		if (stop) raw.push(stop);
	}
	if (raw.length < 2) return null;

	// A `transparent` stop has no color of its own; borrowing the nearest real
	// one keeps the fade from sliding through black.
	for (let i = 0; i < raw.length; i++) {
		if (raw[i].color) continue;
		let borrowed = '';
		for (let d = 1; d < raw.length && !borrowed; d++) {
			borrowed = raw[i - d]?.color || raw[i + d]?.color || '';
		}
		raw[i].color = borrowed || '#888888';
	}

	// Fill in missing positions: ends pin to 0/1, interior gaps spread evenly
	// between their known neighbours, and the sequence never runs backwards.
	const offsets: Array<number | undefined> = raw.map((s) => s.offset);
	if (offsets[0] === undefined) offsets[0] = 0;
	if (offsets[offsets.length - 1] === undefined) offsets[offsets.length - 1] = 1;
	for (let i = 1; i < offsets.length - 1; i++) {
		if (offsets[i] !== undefined) continue;
		let next = i + 1;
		while (next < offsets.length && offsets[next] === undefined) next++;
		const from = offsets[i - 1] as number;
		const to = offsets[next] ?? 1;
		const span = next - (i - 1);
		for (let k = i; k < next; k++) offsets[k] = from + ((to - from) * (k - (i - 1))) / span;
	}

	let running = 0;
	const stops: GradientStop[] = raw.map((s, i) => {
		const offset = Math.min(1, Math.max(running, offsets[i] as number));
		running = offset;
		return { color: s.color, offset, opacity: s.opacity };
	});

	return { kind, angle: cfg.angle, stops };
}

/**
 * CSS angle → `objectBoundingBox` gradient line. The vector is stretched so it
 * touches the box edge on its longest axis, which reproduces CSS exactly for
 * the axis-aligned and square-diagonal cases the palettes actually use.
 */
export function linearGradientVector(angle: number): { x1: number; y1: number; x2: number; y2: number } {
	const rad = ((angle % 360) * Math.PI) / 180;
	const dx = Math.sin(rad);
	const dy = -Math.cos(rad);
	const longest = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
	const hx = dx / longest / 2;
	const hy = dy / longest / 2;
	const round = (n: number): number => Math.round(n * 1e4) / 1e4;
	return { x1: round(0.5 - hx), y1: round(0.5 - hy), x2: round(0.5 + hx), y2: round(0.5 + hy) };
}

/**
 * A single representative color for contexts where a gradient cannot go: line
 * strokes (a zero-area bounding box makes an `objectBoundingBox` gradient
 * vanish entirely) and small text. Non-gradients pass straight through.
 */
export function solidFromColor(value: string, end: 'first' | 'last' = 'first'): string {
	if (!isGradientColor(value)) return value;
	const parsed = parseCssGradient(value);
	const stops = end === 'last' ? [...(parsed?.stops ?? [])].reverse() : parsed?.stops ?? [];
	const opaque = stops.find((s) => s.opacity > 0);
	if (opaque) return opaque.color;
	const literal = /#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\s*\([^)]*\)/.exec(value);
	return literal ? literal[0] : 'var(--text-muted)';
}

// ── DOM half ────────────────────────────────────────────────────────────────

let scopeSeq = 0;

/**
 * Owns the `<linearGradient>`/`<radialGradient>` elements one SVG view needs.
 * Each instance namespaces its ids, so two open views never collide, and
 * `clear()` drops only its own defs.
 *
 * Usage per repaint: `defsOwner.clear(defs)` then `el.style.fill =
 * defsOwner.paint(defs, color)`.
 */
export class SvgGradientDefs {
	private readonly idPrefix = `sg-grad-${++scopeSeq}-`;
	private readonly ids = new Map<string, string>();
	private seq = 0;

	/** Remove this instance's gradients from `defs` (call before repainting). */
	clear(defs: SVGDefsElement | null): void {
		defs?.querySelectorAll(`[id^="${this.idPrefix}"]`).forEach((el) => el.remove());
		this.ids.clear();
		this.seq = 0;
	}

	/**
	 * Paint value for a shape with area (rect, circle, text): `url(#id)` for a
	 * gradient, the color itself otherwise. Assign it through inline `style`
	 * rather than the `fill` attribute so CSS custom properties still resolve.
	 *
	 * `angleOverride` (CSS degrees) replaces the direction baked into the color
	 * string. A view wants this when its shapes have a strong axis of their own:
	 * `objectBoundingBox` normalises the shape to a unit square and stretches
	 * back afterwards, so on a tall thin bar a 135° diagonal comes out reading
	 * left-to-right. Overriding to a straight 0/90/180/270 is immune — those
	 * vectors survive the stretch exactly. Cached per (color, angle) pair.
	 */
	paint(defs: SVGDefsElement | null, color: string, angleOverride?: number): string {
		if (!defs || !isGradientColor(color)) return color;

		const key = angleOverride === undefined ? color : `${color}@${angleOverride}`;
		const cached = this.ids.get(key);
		if (cached) return `url(#${cached})`;

		const parsed = parseCssGradient(color);
		if (!parsed) return solidFromColor(color);

		const id = `${this.idPrefix}${++this.seq}`;
		const ns = 'http://www.w3.org/2000/svg';
		const grad = activeDocument.createElementNS(ns, parsed.kind === 'radial' ? 'radialGradient' : 'linearGradient');
		grad.setAttribute('id', id);
		if (parsed.kind === 'radial') {
			// Centered circle standing in for any CSS radial config; 0.7071 is
			// the unit square's half-diagonal, i.e. CSS `farthest-corner`.
			grad.setAttribute('cx', '0.5');
			grad.setAttribute('cy', '0.5');
			grad.setAttribute('r', '0.7071');
		} else {
			const v = linearGradientVector(angleOverride ?? parsed.angle);
			grad.setAttribute('x1', String(v.x1));
			grad.setAttribute('y1', String(v.y1));
			grad.setAttribute('x2', String(v.x2));
			grad.setAttribute('y2', String(v.y2));
		}
		for (const stop of parsed.stops) {
			const el = activeDocument.createElementNS(ns, 'stop');
			el.setAttribute('offset', String(stop.offset));
			el.setAttribute('stop-color', stop.color);
			if (stop.opacity < 1) el.setAttribute('stop-opacity', String(stop.opacity));
			grad.appendChild(el);
		}
		defs.appendChild(grad);
		this.ids.set(key, id);
		return `url(#${id})`;
	}
}
