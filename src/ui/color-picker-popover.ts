/**
 * Color picker for Plotverk.
 *
 *   InlineColorPicker  — a premium HSV picker (saturation/value square, hue
 *                        slider, hex field, saved-palette dropdown, and a
 *                        persistent "Saved colors" strip). Mounts into any
 *                        container; used inline in the card editor.
 *   ColorPickerPopover — floating wrapper around InlineColorPicker, used for
 *                        right-click card / row / column color picking.
 */

import { setStaticMarkup } from '../utils/dom-html';

let _recentColors: string[] = [];
const MAX_RECENT = 8;

/** Cleanup for the currently-open popover, so a new `show()` can release the
 *  previous instance's own listeners (and its stale `onCommit` closure)
 *  before opening another — see ColorPickerPopover.show(). */
let activeCleanup: (() => void) | null = null;

export const GRADIENT_NAMES: Record<string, string> = {
	'linear-gradient(135deg, #C165DD 0%, #5C27FE 100%)': 'Lavender Light',
	'linear-gradient(135deg, #FAD6A5 0%, #F06966 100%)': 'Peachy',
	'linear-gradient(135deg, #FA7CBB 0%, #F14658 100%)': 'Lovebomb',
	'linear-gradient(135deg, #9055FF 0%, #13E2DA 100%)': 'FreshFish',
	'linear-gradient(135deg, #D6FF7F 0%, #00B3CC 100%)': 'Bermuda',
	'linear-gradient(135deg, #30BE96 0%, #402565 100%)': 'Monster',
	'linear-gradient(135deg, #638BAB 0%, #27526F 100%)': 'Blue Lagune',
	'linear-gradient(135deg, #F36265 0%, #961276 100%)': 'Purple-Popp',
	'linear-gradient(135deg, #EDE8D8 0%, #F5F2E8 100%)': 'Sunflower',
	'linear-gradient(135deg, #D8D0DC 0%, #E4DDE8 100%)': 'Tulip',
	'linear-gradient(135deg, #Fdfbfb 0%, #ebedee 100%)': 'Snow',
	'linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)': 'Cotton Candy',
	'linear-gradient(135deg, #fdfcfb 0%, #e2d1c3 100%)': 'Vanilla',
	'linear-gradient(135deg, #f5efef 0%, #feada6 100%)': 'Salmon Dust',
	'linear-gradient(135deg, #fda085 0%, #f6d365 100%)': 'Sun-Morning',
	'linear-gradient(135deg, #fad0c4 0%, #ff9a9e 100%)': 'Cream Peach',
	'linear-gradient(135deg, #c1dfc4 0%, #deecdd 100%)': 'Spring Green',
	'linear-gradient(135deg, #DCD9D4 0%, #d0ded9 100%)': 'Cotton',
	'linear-gradient(135deg, #EADFDF 0%, #ECE2DF 100%)': 'Elegance',
	'linear-gradient(135deg, #CDDCDC 0%, #d9e5e5 100%)': 'Bleech',
	'linear-gradient(135deg, #e4efe9 0%, #93a5cf 100%)': 'Clean Mirror',
	'linear-gradient(135deg, #D5Dee7 0%, #E2E7Ed 100%)': 'Cold',
	'linear-gradient(135deg, #FFE6FA 0%, #E3FDF5 100%)': 'Pearl',
	'linear-gradient(135deg, #FFFEFF 0%, #D7FFFE 100%)': 'Ice',
	'linear-gradient(135deg, #d4d4b1 0%, #c1c161 100%)': 'Algae',
	'linear-gradient(135deg, #ffffff 0%, #dfe9f3 100%)': 'Glass',
	'linear-gradient(135deg, #ffdde1 0%, #ee9ca9 100%)': 'Soft Rose',
	'linear-gradient(135deg, #f3e7e9 0%, #dad4ec 100%)': 'Dreams',
	'linear-gradient(135deg, #abecd6 0%, #fbed96 100%)': 'Meadow',
	'linear-gradient(135deg, #80d0c7 0%, #13549a 100%)': 'Aqua',
	'linear-gradient(135deg, #f77062 0%, #fe6196 100%)': 'Popsicle',
	'linear-gradient(135deg, #FFC796 0%, #FF6B95 100%)': 'Savanna Sunset',
	'linear-gradient(135deg, #FF8FC4 0%, #FF5BAD 100%)': 'Flamingo',
	'linear-gradient(135deg, #CF94FF 0%, #A855FF 100%)': 'Grape',
	'linear-gradient(135deg, #7EC8FF 0%, #5B9FFF 100%)': 'Bluebird',
	'linear-gradient(135deg, #FFE566 0%, #FFAB45 100%)': 'Citrus',
	'linear-gradient(135deg, #FF9B7A 0%, #FF5E7A 100%)': 'Coral',
	'linear-gradient(135deg, #FF9955 0%, #FF3311 100%)': 'Ember',
	'linear-gradient(135deg, #55FF99 0%, #00BB55 100%)': 'Jungle',
	'linear-gradient(135deg, #FF3366 0%, #33FFCC 100%)': 'Flamingo Bay',
	'linear-gradient(135deg, #FF8800 0%, #0055EE 100%)': 'Papaya',
	'linear-gradient(135deg, #BB00FF 0%, #00FFBB 100%)': 'Parrot',
	'linear-gradient(135deg, #FFCC00 0%, #6600EE 100%)': 'Mango',
	'linear-gradient(135deg, #FF4400 0%, #00AAFF 100%)': 'Toucan',
	'linear-gradient(135deg, #EE0066 0%, #00EEB3 100%)': 'Hibiscus',
	'linear-gradient(135deg, #AAEE00 0%, #EE00AA 100%)': 'Tropicana',
	'linear-gradient(135deg, #FF6644 0%, #4466FF 100%)': 'Sunset Reef',
	'linear-gradient(135deg, #FC6076 0%, #FF9A44 100%)': 'Orange Juice',
	'linear-gradient(135deg, #B7F8DB 0%, #50A7C2 100%)': 'Cyan Sea',
	'linear-gradient(135deg, #f4d03f 0%, #16a085 100%)': 'Palmtree',
	'linear-gradient(135deg, #aBcaba 0%, #5d4157 100%)': 'Supernatural',
	'linear-gradient(135deg, #f78ca0 0%, #fe9a8b 100%)': 'Bliss Pink',
	'radial-gradient(at 20% 30%, hsla(28, 100%, 74%, 0.7) 0px, transparent 80%), radial-gradient(at 80% 20%, hsla(189, 100%, 56%, 0.7) 0px, transparent 80%), radial-gradient(at 70% 80%, hsla(340, 100%, 76%, 0.7) 0px, transparent 80%), radial-gradient(at 10% 90%, hsla(269, 100%, 77%, 0.6) 0px, transparent 80%)': 'Explosion',
};

function addRecent(color: string): void {
	_recentColors = [color, ..._recentColors.filter((c) => c !== color)].slice(0, MAX_RECENT);
}

// ── Color math ────────────────────────────────────────────────────────────────

function isHex(c: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(c);
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16),
	} : null;
}

function rgbToHex(r: number, g: number, b: number): string {
	return '#' + [r, g, b].map((x) => {
		const hex = Math.round(clamp(x, 0, 255)).toString(16);
		return hex.length === 1 ? '0' + hex : hex;
	}).join('');
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d !== 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	let r = 0, g = 0, b = 0;
	if (h < 60) { r = c; g = x; }
	else if (h < 120) { r = x; g = c; }
	else if (h < 180) { g = c; b = x; }
	else if (h < 240) { g = x; b = c; }
	else if (h < 300) { r = x; b = c; }
	else { r = c; b = x; }
	return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
	const rgb = hexToRgb(hex);
	if (!rgb) return { h: 0, s: 0, v: 1 };
	return rgbToHsv(rgb.r, rgb.g, rgb.b);
}

function hsvToHex(h: number, s: number, v: number): string {
	const { r, g, b } = hsvToRgb(h, s, v);
	return rgbToHex(r, g, b);
}

function hueHex(h: number): string {
	return hsvToHex(h, 1, 1);
}

// Minimal DOM helpers (no Obsidian dependency)
function el<K extends keyof HTMLElementTagNameMap>(
	tag: K, cls: string, parent?: HTMLElement, text?: string
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	parent?.appendChild(e);
	return e;
}

function div(cls: string, parent?: HTMLElement, text?: string): HTMLDivElement {
	return el('div', cls, parent, text);
}

const PALETTE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>';

const SOLID_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>';
const GRAD_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" fill-opacity="0.3"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>';

/** Parse a two-stop linear gradient back into editable parts. */
function parseLinearGradient(str: string): { angle: number; c1: string; c2: string } | null {
	if (typeof str !== 'string') return null;
	const m = /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(#[0-9a-fA-F]{6})\b[^,]*,\s*(#[0-9a-fA-F]{6})\b/.exec(str.trim());
	return m ? { angle: parseFloat(m[1]), c1: m[2], c2: m[3] } : null;
}

/** A pleasant default second stop for a new gradient (hue-shifted from the first). */
function secondStop(hex: string): string {
	const hsv = hexToHsv(hex);
	return hsvToHex((hsv.h + 40) % 360, Math.max(0.4, hsv.s), hsv.v);
}

export type CreatedPalette = { id: string; name: string; colors: string[] };

// ── Inline HSV color picker ─────────────────────────────────────────────────────

export interface InlineColorPickerOptions {
	currentColor: string;
	palettes: Array<{ id: string; name: string; colors: string[] }>;
	activePaletteId: string;
	savedColors: string[];
	onSaveColor: (color: string) => void;
	onRemoveSaved: (color: string) => void;
	onChange: (color: string) => void;
	/** Promote the given colors into a new saved palette; returns the created palette (or null). */
	onCreatePalette?: (colors: string[]) => CreatedPalette | null;
}

export class InlineColorPicker {
	private _el: HTMLElement;
	private _opts: InlineColorPickerOptions;
	private _mode: 'solid' | 'gradient' = 'solid';
	private _h = 0;
	private _s = 0;
	private _v = 1;
	private _stops: [string, string] = ['#7c69c8', '#13e2da'];
	private _angle = 135;
	private _activeStop = 0;
	private _value: string;
	private _saved: string[];
	private _activePaletteId: string;

	private _tabSolid!: HTMLButtonElement;
	private _tabGrad!: HTMLButtonElement;
	private _gradPanel!: HTMLElement;
	private _gradPreview!: HTMLElement;
	private _stopEls: HTMLButtonElement[] = [];
	private _angleInput!: HTMLInputElement;
	private _angleLabel!: HTMLElement;
	private _sv!: HTMLElement;
	private _svThumb!: HTMLElement;
	private _hueThumb!: HTMLElement;
	private _dot!: HTMLElement;
	private _hexInput!: HTMLInputElement;
	private _palMenu!: HTMLElement;
	private _palGridSection!: HTMLElement;
	private _palGridName!: HTMLElement;
	private _palGrid!: HTMLElement;
	private _savedGrid!: HTMLElement;
	private _saveAsBtn!: HTMLButtonElement;

	constructor(container: HTMLElement, opts: InlineColorPickerOptions) {
		this._el = container;
		this._opts = opts;
		this._value = opts.currentColor;
		this._saved = [...opts.savedColors];
		this._activePaletteId = opts.activePaletteId;
		this._initFromValue(opts.currentColor);
		this._build();
		this._initialRender();
	}

	/** Seed mode + stops + HSV from an incoming color (hex or gradient). */
	private _initFromValue(color: string): void {
		const g = parseLinearGradient(color);
		if (g) {
			this._mode = 'gradient';
			this._stops = [g.c1, g.c2];
			this._angle = g.angle;
			this._activeStop = 0;
			const hsv = hexToHsv(g.c1);
			this._h = hsv.h; this._s = hsv.s; this._v = hsv.v;
		} else if (isHex(color)) {
			this._mode = 'solid';
			const hsv = hexToHsv(color);
			this._h = hsv.h; this._s = hsv.s; this._v = hsv.v;
		} else {
			this._mode = 'solid';
		}
	}

	private _activeStopHex(): string {
		return hsvToHex(this._h, this._s, this._v);
	}

	private _gradientStr(): string {
		return `linear-gradient(${Math.round(this._angle)}deg, ${this._stops[0]} 0%, ${this._stops[1]} 100%)`;
	}

	// ── Build ──────────────────────────────────────────────────────────────────
	private _build(): void {
		this._el.classList.add('sg-cpick');

		// Mode tabs: Solid | Gradient
		const tabs = div('sg-cpick-tabs', this._el);
		this._tabSolid = el('button', 'sg-cpick-tab', tabs);
		this._tabSolid.type = 'button';
		setStaticMarkup(this._tabSolid, SOLID_ICON + '<span>Solid</span>');
		this._tabSolid.addEventListener('click', () => this._setMode('solid', true));
		this._tabGrad = el('button', 'sg-cpick-tab', tabs);
		this._tabGrad.type = 'button';
		setStaticMarkup(this._tabGrad, GRAD_ICON + '<span>Gradient</span>');
		this._tabGrad.addEventListener('click', () => this._setMode('gradient', true));

		// Gradient panel: live preview bar with two stops + angle
		this._gradPanel = div('sg-cpick-grad sg-cpick-collapsible', this._el);
		this._gradPreview = div('sg-cpick-grad-preview', this._gradPanel);
		[0, 1].forEach((i) => {
			const st = el('button', 'sg-cpick-stop', this._gradPreview);
			st.type = 'button';
			st.title = i === 0 ? 'Start color' : 'End color';
			st.addEventListener('click', (e) => { e.stopPropagation(); this._selectStop(i); });
			this._stopEls[i] = st;
		});
		const angleRow = div('sg-cpick-angle-row', this._gradPanel);
		el('span', 'sg-cpick-mini-label', angleRow, 'Angle');
		this._angleInput = el('input', 'sg-cpick-angle', angleRow);
		this._angleInput.type = 'range';
		this._angleInput.min = '0';
		this._angleInput.max = '360';
		this._angleInput.step = '5';
		this._angleInput.value = String(this._angle);
		this._angleInput.addEventListener('input', () => {
			this._angle = parseInt(this._angleInput.value, 10) || 0;
			this._value = this._gradientStr();
			this._syncUI();
			this._opts.onChange(this._value);
		});
		this._angleLabel = el('span', 'sg-cpick-angle-val', angleRow, `${this._angle}°`);

		// Saturation / value square (edits the solid color, or the active gradient stop)
		this._sv = div('sg-cpick-sv', this._el);
		this._svThumb = div('sg-cpick-sv-thumb', this._sv);
		this._attachDrag(this._sv, (x, y, rect) => {
			this._s = clamp((x - rect.left) / rect.width, 0, 1);
			this._v = clamp(1 - (y - rect.top) / rect.height, 0, 1);
			this._commitHsv();
		});

		// Hue slider
		const hue = div('sg-cpick-hue', this._el);
		this._hueThumb = div('sg-cpick-hue-thumb', hue);
		this._attachDrag(hue, (x, _y, rect) => {
			this._h = clamp((x - rect.left) / rect.width, 0, 1) * 360;
			this._commitHsv();
		});

		const controls = div('sg-cpick-controls', this._el);

		// Hex row: preview dot + hex input + palette icon
		const hexRow = div('sg-cpick-hex-row', controls);
		this._dot = div('sg-cpick-dot', hexRow);

		this._hexInput = el('input', 'sg-cpick-hex', hexRow);
		this._hexInput.type = 'text';
		this._hexInput.spellcheck = false;
		this._hexInput.maxLength = 7;
		this._hexInput.setAttribute('aria-label', 'Hex color');
		this._hexInput.addEventListener('input', () => {
			let v = this._hexInput.value.trim();
			if (v && !v.startsWith('#')) v = '#' + v;
			if (isHex(v)) {
				const hsv = hexToHsv(v);
				this._h = hsv.h; this._s = hsv.s; this._v = hsv.v;
				this._commitHsv(true);
			}
		});

		const palBtn = el('button', 'sg-cpick-pal-btn', hexRow);
		palBtn.type = 'button';
		palBtn.title = 'Pick from saved palettes';
		setStaticMarkup(palBtn, PALETTE_ICON);
		palBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this._togglePalMenu();
		});

		// Palette name dropdown (collapsed list of palette names)
		this._palMenu = div('sg-cpick-pal-menu sg-cpick-collapsed', controls);

		// Active palette grid in the body (≤ 2 rows, smooth elongation)
		this._palGridSection = div('sg-cpick-palgrid-section sg-cpick-collapsible', controls);
		const pgHdr = div('sg-cpick-palgrid-hdr', this._palGridSection);
		this._palGridName = el('span', 'sg-cpick-mini-label', pgHdr, '');
		this._palGrid = div('sg-cpick-palgrid', this._palGridSection);

		// Saved colors header (minimal text actions) + grid
		const savedHdr = div('sg-cpick-saved-hdr', controls);
		el('span', 'sg-cpick-saved-label', savedHdr, 'Saved colors');
		const savedActions = div('sg-cpick-saved-actions', savedHdr);
		const addBtn = el('button', 'sg-cpick-text-btn', savedActions);
		addBtn.type = 'button';
		setStaticMarkup(addBtn, '<span class="sg-cpick-plus">+</span> Add');
		addBtn.addEventListener('click', () => {
			if (this._saved.includes(this._value)) { this._flash(this._value); return; }
			this._saved = [this._value, ...this._saved].slice(0, 32);
			this._opts.onSaveColor(this._value);
			this._renderSaved();
			this._flash(this._value);
		});
		this._saveAsBtn = el('button', 'sg-cpick-text-btn sg-cpick-text-btn--muted', savedActions);
		this._saveAsBtn.type = 'button';
		this._saveAsBtn.textContent = 'Save as palette';
		this._saveAsBtn.title = 'Turn your saved colors into a reusable palette';
		this._saveAsBtn.addEventListener('click', () => this._saveAsPalette());
		if (!this._opts.onCreatePalette) this._saveAsBtn.style.display = 'none';

		this._savedGrid = div('sg-cpick-saved-grid', controls);
		this._renderSaved();
	}

	/** First paint — set mode + active palette without animation. */
	private _initialRender(): void {
		this._applyModeUI();
		this._setCollapsed(this._gradPanel, this._mode !== 'gradient', false);
		const active = this._resolveActivePalette();
		if (active) {
			this._renderPaletteGrid(active);
			this._setCollapsed(this._palGridSection, false, false);
		} else {
			this._setCollapsed(this._palGridSection, true, false);
		}
		this._syncUI();
	}

	private _resolveActivePalette(): CreatedPalette | undefined {
		const palettes = this._opts.palettes ?? [];
		return palettes.find((p) => p.id === this._activePaletteId) ?? palettes[0];
	}

	// ── Solid / Gradient mode ────────────────────────────────────────────────────
	private _setMode(mode: 'solid' | 'gradient', animate: boolean): void {
		if (this._mode === mode) return;
		this._mode = mode;
		if (mode === 'gradient') {
			if (isHex(this._value)) this._stops = [this._value, secondStop(this._value)];
			this._activeStop = 0;
			const hsv = hexToHsv(this._stops[0]);
			this._h = hsv.h; this._s = hsv.s; this._v = hsv.v;
			this._value = this._gradientStr();
		} else {
			this._value = this._activeStopHex();
		}
		this._applyModeUI();
		this._setCollapsed(this._gradPanel, mode !== 'gradient', animate);
		this._syncUI();
		this._opts.onChange(this._value);
	}

	private _applyModeUI(): void {
		this._tabSolid.classList.toggle('sg-cpick-tab--active', this._mode === 'solid');
		this._tabGrad.classList.toggle('sg-cpick-tab--active', this._mode === 'gradient');
	}

	private _selectStop(i: number): void {
		this._activeStop = i;
		const hsv = hexToHsv(this._stops[i]);
		this._h = hsv.h; this._s = hsv.s; this._v = hsv.v;
		this._syncUI();
	}

	// ── Drag (pointer events; works mouse + touch) ───────────────────────────────
	private _attachDrag(
		target: HTMLElement,
		onMove: (x: number, y: number, rect: DOMRect) => void
	): void {
		const run = (e: PointerEvent) => onMove(e.clientX, e.clientY, target.getBoundingClientRect());
		target.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			target.setPointerCapture(e.pointerId);
			target.classList.add('sg-cpick-dragging');
			run(e);
			const move = (ev: PointerEvent) => run(ev);
			const up = () => {
				target.classList.remove('sg-cpick-dragging');
				target.removeEventListener('pointermove', move);
				target.removeEventListener('pointerup', up);
			};
			target.addEventListener('pointermove', move);
			target.addEventListener('pointerup', up);
		});
	}

	// ── State → UI ───────────────────────────────────────────────────────────────
	private _commitHsv(fromHex = false): void {
		const hex = this._activeStopHex();
		if (this._mode === 'gradient') {
			this._stops[this._activeStop] = hex;
			this._value = this._gradientStr();
		} else {
			this._value = hex;
		}
		this._syncUI(fromHex);
		this._opts.onChange(this._value);
	}

	/** Apply a raw color (hex or gradient) from a swatch — adopts its mode. */
	private _applyRaw(color: string): void {
		this._initFromValue(color);
		this._value = color;
		this._applyModeUI();
		this._setCollapsed(this._gradPanel, this._mode !== 'gradient', true);
		this._syncUI();
		this._opts.onChange(color);
	}

	private _syncUI(skipHexInput = false): void {
		this._sv.style.background =
			`linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), ${hueHex(this._h)}`;
		this._svThumb.style.left = `${this._s * 100}%`;
		this._svThumb.style.top = `${(1 - this._v) * 100}%`;
		this._svThumb.style.background = this._activeStopHex();
		this._hueThumb.style.left = `${(this._h / 360) * 100}%`;
		this._hueThumb.style.background = hueHex(this._h);
		this._dot.style.background = this._value;
		if (!skipHexInput && document.activeElement !== this._hexInput) {
			this._hexInput.value = this._activeStopHex().toUpperCase();
		}
		if (this._mode === 'gradient') {
			this._gradPreview.style.background = this._gradientStr();
			this._stopEls.forEach((stEl, i) => {
				stEl.style.background = this._stops[i];
				stEl.classList.toggle('sg-cpick-stop--active', i === this._activeStop);
			});
			this._angleLabel.textContent = `${Math.round(this._angle)}°`;
			this._angleInput.value = String(Math.round(this._angle));
		}
		// active highlight across all chips
		this._el.querySelectorAll('.sg-cpick-chip--active').forEach((c) => c.classList.remove('sg-cpick-chip--active'));
		this._el.querySelectorAll<HTMLElement>('.sg-cpick-chip').forEach((c) => {
			if (c.dataset.color === this._value) c.classList.add('sg-cpick-chip--active');
		});
	}

	// ── Chips / saved colors ─────────────────────────────────────────────────────
	private _chip(parent: HTMLElement, color: string, removable: boolean, onPick: () => void): void {
		const chip = el('button', 'sg-cpick-chip', parent);
		chip.type = 'button';
		chip.style.background = color;
		chip.dataset.color = color;
		chip.title = GRADIENT_NAMES[color] ?? (isHex(color) ? color : '');
		if (color === this._value) chip.classList.add('sg-cpick-chip--active');
		chip.addEventListener('click', onPick);
		if (removable) {
			const x = el('span', 'sg-cpick-chip-x', chip, '×');
			x.addEventListener('click', (e) => {
				e.stopPropagation();
				this._saved = this._saved.filter((c) => c !== color);
				this._opts.onRemoveSaved(color);
				this._renderSaved();
			});
		}
	}

	private _renderSaved(): void {
		this._savedGrid.replaceChildren();
		if (this._saved.length === 0) {
			div('sg-cpick-saved-empty', this._savedGrid, 'Tap + Add to keep colors you reuse');
		} else {
			this._saved.forEach((c) => this._chip(this._savedGrid, c, true, () => this._applyRaw(c)));
		}
		if (this._saveAsBtn) this._saveAsBtn.disabled = this._saved.length === 0;
	}

	private _flash(color: string): void {
		const chip = this._savedGrid.querySelector<HTMLElement>(`.sg-cpick-chip[data-color="${CSS.escape(color)}"]`);
		if (!chip) return;
		chip.classList.remove('sg-cpick-chip--pop');
		void chip.offsetWidth; // restart animation
		chip.classList.add('sg-cpick-chip--pop');
	}

	/** How many swatches fit across two rows (becomes the palette size cap). */
	private _fitCount(): number {
		const w = this._palGrid?.clientWidth || this._savedGrid?.clientWidth || 0;
		const per = 24 + 7; // chip width + gap
		const cols = w > 0 ? Math.max(1, Math.floor((w + 7) / per)) : 7;
		return cols * 2;
	}

	private _saveAsPalette(): void {
		if (!this._opts.onCreatePalette || this._saved.length === 0) return;
		const colors = this._saved.slice(0, this._fitCount());
		const pal = this._opts.onCreatePalette(colors);
		if (pal) {
			this._renderPaletteGrid(pal);
			this._setCollapsed(this._palGridSection, false, true);
		}
	}

	// ── Active palette grid (body) ────────────────────────────────────────────────
	private _renderPaletteGrid(p: CreatedPalette): void {
		this._activePaletteId = p.id;
		this._palGridName.textContent = p.name;
		this._palGrid.replaceChildren();
		(p.colors ?? []).slice(0, this._fitCount()).forEach((c) =>
			this._chip(this._palGrid, c, false, () => this._applyRaw(c))
		);
	}

	/** Smoothly grow/shrink a collapsible section. */
	private _setCollapsed(elm: HTMLElement, collapsed: boolean, animate = true): void {
		if (!animate) {
			elm.classList.toggle('sg-cpick-collapsed', collapsed);
			elm.style.display = collapsed ? 'none' : '';
			elm.style.maxHeight = collapsed ? '0px' : '';
			return;
		}
		if (collapsed) {
			elm.style.maxHeight = `${elm.scrollHeight}px`;
			void elm.offsetWidth;
			elm.classList.add('sg-cpick-collapsed');
			elm.style.maxHeight = '0px';
			window.setTimeout(() => {
				if (elm.classList.contains('sg-cpick-collapsed')) elm.style.display = 'none';
			}, 260);
		} else {
			elm.style.display = '';
			elm.classList.remove('sg-cpick-collapsed');
			const h = elm.scrollHeight;
			elm.style.maxHeight = '0px';
			void elm.offsetWidth;
			elm.style.maxHeight = `${h}px`;
			window.setTimeout(() => {
				if (!elm.classList.contains('sg-cpick-collapsed')) elm.style.maxHeight = '';
			}, 260);
		}
	}

	// ── Palette name dropdown ──────────────────────────────────────────────────────
	private _buildPalMenu(): void {
		this._palMenu.replaceChildren();
		const palettes = this._opts.palettes ?? [];
		if (palettes.length === 0) {
			div('sg-cpick-saved-empty', this._palMenu, 'No palettes yet — use “Save as palette”');
			return;
		}
		palettes.forEach((p) => {
			const item = el('button', 'sg-cpick-pal-item', this._palMenu);
			item.type = 'button';
			if (p.id === this._activePaletteId) item.classList.add('sg-cpick-pal-item--active');
			el('span', 'sg-cpick-pal-item-name', item, p.name);
			const dots = div('sg-cpick-pal-dots', item);
			(p.colors ?? []).slice(0, 6).forEach((c) => {
				div('sg-cpick-pal-dot', dots).style.background = c;
			});
			item.addEventListener('click', () => {
				this._renderPaletteGrid(p);
				this._setCollapsed(this._palGridSection, false, true);
				this._closePalMenu();
			});
		});
	}

	private _togglePalMenu(): void {
		if (this._palMenu.classList.contains('sg-cpick-collapsed')) {
			this._buildPalMenu();
			this._palMenu.classList.remove('sg-cpick-collapsed');
		} else {
			this._closePalMenu();
		}
	}

	private _closePalMenu(): void {
		this._palMenu.classList.add('sg-cpick-collapsed');
	}

	// ── Public (inline show/hide controlled by the host) ─────────────────────────
	open(): void {
		this._el.classList.remove('sg-cpick-hidden');
		this._saved = [...this._opts.savedColors];
		this._renderSaved();
		this._closePalMenu();
		const active = this._resolveActivePalette();
		if (active) {
			this._renderPaletteGrid(active);
			this._setCollapsed(this._palGridSection, false, false);
		}
		this._syncUI();
		addRecent(this._value);
	}

	close(): void {
		this._el.classList.add('sg-cpick-hidden');
		this._closePalMenu();
	}

	toggle(): void {
		if (this.isOpen()) this.close(); else this.open();
	}

	isOpen(): boolean {
		return !this._el.classList.contains('sg-cpick-hidden');
	}

	updateColor(color: string): void {
		this._applyRaw(color);
	}
}

// ── Floating popover (right-click card / row / column) ──────────────────────────

export interface ColorPickerPopoverOptions {
	currentColor: string;
	palettes: Array<{ id: string; name: string; colors: string[] }>;
	activePaletteId: string;
	savedColors: string[];
	onSaveColor: (color: string) => void;
	onRemoveSaved: (color: string) => void;
	onCreatePalette?: (colors: string[]) => CreatedPalette | null;
	onPreview?: (color: string) => void;
	onCommit: (color: string) => void;
}

export class ColorPickerPopover {
	static show(anchor: HTMLElement, opts: ColorPickerPopoverOptions): void {
		// Release the previous instance's own listeners — not just its DOM
		// node — otherwise its stale `onOutside`/`onCommit` closure stays
		// attached to `document` forever and can fire on a later click
		// anywhere in the app, silently committing a stale color.
		activeCleanup?.();
		activeCleanup = null;
		document.querySelector('.sg-color-popover')?.remove();

		let selected = opts.currentColor;

		const popover = document.createElement('div');
		popover.className = 'sg-color-popover sg-color-popover--v2';

		// Draggable handle — lets the user slide the picker aside to see cards
		const handle = document.createElement('div');
		handle.className = 'sg-color-popover-handle';
		setStaticMarkup(handle,
			'<span class="sg-color-popover-grip"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="3" r="1.2"/><circle cx="7.5" cy="3" r="1.2"/><circle cx="2.5" cy="7" r="1.2"/><circle cx="7.5" cy="7" r="1.2"/><circle cx="2.5" cy="11" r="1.2"/><circle cx="7.5" cy="11" r="1.2"/></svg></span>'
			+ '<span class="sg-color-popover-title">Pick a color</span>');
		popover.appendChild(handle);

		const host = document.createElement('div');
		popover.appendChild(host);
		new InlineColorPicker(host, {
			currentColor: opts.currentColor,
			palettes: opts.palettes,
			activePaletteId: opts.activePaletteId,
			savedColors: opts.savedColors,
			onSaveColor: opts.onSaveColor,
			onRemoveSaved: opts.onRemoveSaved,
			onCreatePalette: opts.onCreatePalette,
			onChange: (c) => { selected = c; opts.onPreview?.(c); },
		});

		const footer = document.createElement('div');
		footer.className = 'sg-color-popover-footer';
		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'sg-color-popover-btn';
		cancelBtn.textContent = 'Cancel';
		const doneBtn = document.createElement('button');
		doneBtn.className = 'sg-color-popover-btn sg-color-popover-btn--done';
		doneBtn.textContent = 'Done';
		footer.appendChild(cancelBtn);
		footer.appendChild(doneBtn);
		popover.appendChild(footer);

		document.body.appendChild(popover);

		// Position below the anchor, flipping/clamping to stay on screen
		const rect = anchor.getBoundingClientRect();
		const pw = popover.offsetWidth, ph = popover.offsetHeight;
		let top = rect.bottom + 6;
		let left = rect.left;
		if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top - ph - 6);
		left = Math.min(left, window.innerWidth - pw - 8);
		left = Math.max(8, left);
		popover.style.top = `${top}px`;
		popover.style.left = `${left}px`;

		// Drag the popover by its handle (keeps it on screen)
		let offX = 0, offY = 0;
		handle.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			handle.setPointerCapture(e.pointerId);
			handle.classList.add('sg-color-popover-handle--grab');
			const r = popover.getBoundingClientRect();
			offX = e.clientX - r.left;
			offY = e.clientY - r.top;
			const move = (ev: PointerEvent) => {
				const nl = clamp(ev.clientX - offX, 8, window.innerWidth - popover.offsetWidth - 8);
				const nt = clamp(ev.clientY - offY, 8, window.innerHeight - popover.offsetHeight - 8);
				popover.style.left = `${nl}px`;
				popover.style.top = `${nt}px`;
			};
			const up = () => {
				handle.classList.remove('sg-color-popover-handle--grab');
				handle.removeEventListener('pointermove', move);
				handle.removeEventListener('pointerup', up);
			};
			handle.addEventListener('pointermove', move);
			handle.addEventListener('pointerup', up);
		});

		function cleanup(): void {
			popover.remove();
			document.removeEventListener('mousedown', onOutside);
			// Idempotent guard: only clear the module-level pointer if it's
			// still ours, so a stray second call can't null out a newer
			// (superseding) instance's cleanup.
			if (activeCleanup === cleanup) activeCleanup = null;
		}
		function commit(): void {
			addRecent(selected);
			opts.onCommit(selected);
			cleanup();
		}
		function onOutside(e: MouseEvent): void {
			if (!popover.contains(e.target as Node) && e.target !== anchor) commit();
		}
		activeCleanup = cleanup;

		cancelBtn.addEventListener('click', () => { opts.onPreview?.(opts.currentColor); cleanup(); });
		doneBtn.addEventListener('click', commit);
		setTimeout(() => document.addEventListener('mousedown', onOutside), 50);
	}
}
