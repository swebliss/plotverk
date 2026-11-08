// Story Timeline appearance model — pure TypeScript with NO imports at all.
//
// Deliberately import-free so both `grid-data.ts` (which owns
// StorygridSettings, the global defaults) and `timeline-data.ts` (which owns
// TimelineViewSettings, the per-file override) can depend on it without
// creating an import cycle — timeline-data already imports from grid-data.
//
// Every knob here is a stored value, resolved through one function, so the
// Phase B sliders panel has exactly one seam to write to and the renderer has
// exactly one seam to read from. DEFAULTS reproduce today's hardcoded look
// byte for byte, which is what makes this step visually inert: a timeline with
// no `appearance` block renders precisely as it did before.

/**
 * How event name labels behave. 'hover' also covers the tapped/active state on touch.
 * Both 'room' (the default since the 2026-11-03 redesign) and 'always' hide a
 * name that would sit on another name or on a badge; 'room' also keeps a wider
 * gap between names, for a calmer overview.
 */
export type TimelineLabelMode = 'room' | 'always' | 'hover' | 'off';

/**
 * Which way label text runs. Decoupled from orientation on purpose (Emma's
 * A2 verdict): a vertical timeline may still want upright, readable labels.
 * 'readable' keeps text horizontal in both orientations; 'along-axis' turns it
 * to run parallel with the time axis (a no-op in horizontal view, where the
 * time axis IS horizontal).
 */
export type TimelineLabelDirection = 'readable' | 'along-axis';

/**
 * What the spine is measured in. 'auto' keeps the semantic-zoom behavior the
 * timeline shipped with (years when far out, months closer, days when very
 * close); the three explicit units pin the scale so a writer can say "show me
 * years" and have it stay years at any zoom.
 */
export type TimelineAxisUnit = 'auto' | 'year' | 'month' | 'day';

export interface TimelineAppearance {
	/** Thickness of the central spine, in on-screen px (the same at every zoom). */
	spineWidth: number;
	/** Thickness of each plotline guide line, in on-screen px. */
	trackWidth: number;
	/** Span bar knob — on-screen thickness is barThicknessFor(this) in timeline-layout.ts. */
	barThickness: number;
	/** Badge knob — on-screen radius is badgeRadiusFor(this) in timeline-layout.ts. */
	markerSize: number;
	/** Across-axis distance from the spine to the first track ring, and ring to ring. */
	spacing: number;
	/** Stitch hairlines from each event back to the spine. */
	stitches: boolean;
	labelMode: TimelineLabelMode;
	labelDirection: TimelineLabelDirection;
	/** Spine tick unit — 'auto' derives it from zoom, the rest pin it. */
	axisUnit: TimelineAxisUnit;
	/**
	 * Spine color override (B3). OPTIONAL and absent by default — unlike every
	 * other knob here, there is no DEFAULT_TIMELINE_APPEARANCE value for it,
	 * because "absent" has its own meaning: fall back to styles.css's
	 * `.sg-tl-spine` rule rather than to a hardcoded hex that would just be a
	 * second copy of the same color. No clamping — it's a CSS color/gradient
	 * string, and the color picker (the only writer) already only ever hands
	 * back something paintable.
	 */
	spineColor?: string;
}

/**
 * The shipped look. Every size is on-screen px since the 2026-11-03 redesign
 * (zoom no longer shrinks them), so spineWidth rose to 4 (clearly visible, far
 * from a slab), spacing to 104 (room for two badges side by side — 26px by default since 2026-11-06), and
 * labels default to 'room'. Kept as literal numbers rather than read out of
 * DEFAULT_LAYOUT_SPEC so this module stays import-free.
 */
export const DEFAULT_TIMELINE_APPEARANCE: TimelineAppearance = {
	spineWidth: 4,
	trackWidth: 2,
	barThickness: 12,
	markerSize: 10,
	spacing: 104,
	stitches: false,
	labelMode: 'room',
	labelDirection: 'readable',
	axisUnit: 'auto',
};

export interface AppearanceLimit {
	min: number;
	max: number;
	step: number;
}

/**
 * Slider bounds — the single source of truth for both the Phase B panel's
 * `<input type="range">` attributes and the clamping in resolveAppearance().
 * That second job matters independently of the UI: `.timeline` files are plain
 * JSON a user can hand-edit (or a future import could malform), and a
 * barThickness of 4000 would paint a page-filling block with no way back
 * except editing the file again.
 */
export const APPEARANCE_LIMITS: Record<
	'spineWidth' | 'trackWidth' | 'barThickness' | 'markerSize' | 'spacing',
	AppearanceLimit
> = {
	spineWidth: { min: 0.5, max: 10, step: 0.5 },
	trackWidth: { min: 0.5, max: 10, step: 0.5 },
	barThickness: { min: 4, max: 48, step: 1 },
	markerSize: { min: 3, max: 28, step: 1 },
	spacing: { min: 24, max: 240, step: 4 },
};

const LABEL_MODES: readonly TimelineLabelMode[] = ['room', 'always', 'hover', 'off'];
const LABEL_DIRECTIONS: readonly TimelineLabelDirection[] = ['readable', 'along-axis'];
const AXIS_UNITS: readonly TimelineAxisUnit[] = ['auto', 'year', 'month', 'day'];

/**
 * Clamp to a knob's limits, rejecting NaN/Infinity/non-numbers by answering
 * `undefined` — the same "absent = follow the next layer" contract
 * resolveAppearance() uses for its own fields. Exported so the B2.1 per-event
 * size overrides (markerSize/barThickness on EventDisplay, width on
 * Plotline) can clamp through this exact rule at their own read seam in
 * timeline-render.ts, rather than re-deriving a second clamp: a
 * hand-edited `.timeline` file can put anything in eventDisplay too.
 */
export function clampKnob(value: unknown, limit: AppearanceLimit): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return Math.min(limit.max, Math.max(limit.min, value));
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Three-layer resolve: per-timeline override → plugin-global default →
 * DEFAULT_TIMELINE_APPEARANCE. Total by construction — any missing, malformed
 * or out-of-range field falls through to the next layer rather than throwing,
 * so a hand-broken file still renders. Never mutates its inputs.
 */
export function resolveAppearance(
	fromFile?: Partial<TimelineAppearance> | null,
	fromGlobal?: Partial<TimelineAppearance> | null,
): TimelineAppearance {
	const layers = [fromFile, fromGlobal].filter((l): l is Partial<TimelineAppearance> => !!l && typeof l === 'object');

	const num = (key: keyof typeof APPEARANCE_LIMITS): number => {
		for (const layer of layers) {
			const v = clampKnob(layer[key], APPEARANCE_LIMITS[key]);
			if (v !== undefined) return v;
		}
		return DEFAULT_TIMELINE_APPEARANCE[key];
	};

	const bool = (key: 'stitches'): boolean => {
		for (const layer of layers) {
			if (typeof layer[key] === 'boolean') return layer[key] as boolean;
		}
		return DEFAULT_TIMELINE_APPEARANCE[key];
	};

	const labelMode = (): TimelineLabelMode => {
		for (const layer of layers) {
			const v = pickEnum(layer.labelMode, LABEL_MODES);
			if (v) return v;
		}
		return DEFAULT_TIMELINE_APPEARANCE.labelMode;
	};

	const labelDirection = (): TimelineLabelDirection => {
		for (const layer of layers) {
			const v = pickEnum(layer.labelDirection, LABEL_DIRECTIONS);
			if (v) return v;
		}
		return DEFAULT_TIMELINE_APPEARANCE.labelDirection;
	};

	const axisUnit = (): TimelineAxisUnit => {
		for (const layer of layers) {
			const v = pickEnum(layer.axisUnit, AXIS_UNITS);
			if (v) return v;
		}
		return DEFAULT_TIMELINE_APPEARANCE.axisUnit;
	};

	// spineColor has no DEFAULT_TIMELINE_APPEARANCE fallback (see the field's
	// own doc comment) — a non-empty string from either layer wins, and
	// finding one nowhere just leaves it undefined rather than reaching for a
	// hardcoded hex.
	const spineColor = (): string | undefined => {
		for (const layer of layers) {
			if (typeof layer.spineColor === 'string' && layer.spineColor.length > 0) return layer.spineColor;
		}
		return undefined;
	};

	return {
		spineWidth: num('spineWidth'),
		trackWidth: num('trackWidth'),
		barThickness: num('barThickness'),
		markerSize: num('markerSize'),
		spacing: num('spacing'),
		stitches: bool('stitches'),
		labelMode: labelMode(),
		labelDirection: labelDirection(),
		axisUnit: axisUnit(),
		spineColor: spineColor(),
	};
}

/**
 * Across-axis gap between same-day markers fanned out on one track. DERIVED
 * from marker size (diameter + 2px breathing room) rather than being its own
 * slider — the old DEFAULT_LAYOUT_SPEC.fanSpacing of 22 is exactly this
 * formula at the default radius of 10, and deriving it means enlarging markers
 * can never make a same-day cluster overlap itself.
 */
export function fanSpacingFor(markerSize: number): number {
	return markerSize * 2 + 2;
}
