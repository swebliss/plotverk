import {
	APPEARANCE_LIMITS,
	DEFAULT_TIMELINE_APPEARANCE,
	TimelineAppearance,
	clampKnob,
	fanSpacingFor,
	resolveAppearance,
} from './timeline-appearance';
import { DEFAULT_LAYOUT_SPEC } from './timeline-layout';

describe('DEFAULT_TIMELINE_APPEARANCE', () => {
	// The whole point of B1 being visually inert: the model's defaults must be
	// the numbers the layout engine already shipped with.
	it('matches the layout engine defaults for the geometry knobs', () => {
		expect(DEFAULT_TIMELINE_APPEARANCE.spacing).toBe(DEFAULT_LAYOUT_SPEC.spacing);
		expect(DEFAULT_TIMELINE_APPEARANCE.barThickness).toBe(DEFAULT_LAYOUT_SPEC.barThickness);
		expect(DEFAULT_TIMELINE_APPEARANCE.markerSize).toBe(DEFAULT_LAYOUT_SPEC.markerRadius);
		expect(DEFAULT_TIMELINE_APPEARANCE.stitches).toBe(DEFAULT_LAYOUT_SPEC.stitches);
	});

	it('keeps the shipped stroke weights and label behavior', () => {
		expect(DEFAULT_TIMELINE_APPEARANCE.spineWidth).toBe(4);
		expect(DEFAULT_TIMELINE_APPEARANCE.trackWidth).toBe(2);
		expect(DEFAULT_TIMELINE_APPEARANCE.labelMode).toBe('room');
		expect(DEFAULT_TIMELINE_APPEARANCE.labelDirection).toBe('readable');
		expect(DEFAULT_TIMELINE_APPEARANCE.axisUnit).toBe('auto');
	});

	it('sits inside its own slider limits', () => {
		for (const key of Object.keys(APPEARANCE_LIMITS) as Array<keyof typeof APPEARANCE_LIMITS>) {
			const { min, max } = APPEARANCE_LIMITS[key];
			expect(DEFAULT_TIMELINE_APPEARANCE[key]).toBeGreaterThanOrEqual(min);
			expect(DEFAULT_TIMELINE_APPEARANCE[key]).toBeLessThanOrEqual(max);
		}
	});
});

describe('fanSpacingFor()', () => {
	it('reproduces the old fanSpacing constant at the default marker size', () => {
		expect(fanSpacingFor(DEFAULT_TIMELINE_APPEARANCE.markerSize)).toBe(DEFAULT_LAYOUT_SPEC.fanSpacing);
	});

	it('always leaves a gap wider than one marker diameter', () => {
		for (const size of [3, 10, 17, 28]) {
			expect(fanSpacingFor(size)).toBeGreaterThan(size * 2);
		}
	});
});

describe('clampKnob() — B2.1 per-event/per-track size overrides read seam', () => {
	it('passes through an in-range value unchanged', () => {
		expect(clampKnob(15, APPEARANCE_LIMITS.markerSize)).toBe(15);
	});

	it('clamps an out-of-range number to the limit it exceeds', () => {
		expect(clampKnob(9999, APPEARANCE_LIMITS.barThickness)).toBe(APPEARANCE_LIMITS.barThickness.max);
		expect(clampKnob(-40, APPEARANCE_LIMITS.barThickness)).toBe(APPEARANCE_LIMITS.barThickness.min);
	});

	it('answers undefined for undefined/malformed input — "no override", not a bad one', () => {
		expect(clampKnob(undefined, APPEARANCE_LIMITS.markerSize)).toBeUndefined();
		expect(clampKnob(null, APPEARANCE_LIMITS.markerSize)).toBeUndefined();
		expect(clampKnob('big', APPEARANCE_LIMITS.markerSize)).toBeUndefined();
		expect(clampKnob(NaN, APPEARANCE_LIMITS.markerSize)).toBeUndefined();
		expect(clampKnob(Infinity, APPEARANCE_LIMITS.markerSize)).toBeUndefined();
	});
});

describe('resolveAppearance()', () => {
	it('returns the defaults for no input at all', () => {
		expect(resolveAppearance()).toEqual(DEFAULT_TIMELINE_APPEARANCE);
		expect(resolveAppearance(undefined, undefined)).toEqual(DEFAULT_TIMELINE_APPEARANCE);
		expect(resolveAppearance({}, {})).toEqual(DEFAULT_TIMELINE_APPEARANCE);
		expect(resolveAppearance(null, null)).toEqual(DEFAULT_TIMELINE_APPEARANCE);
	});

	it('lets the file win over the global default, per field', () => {
		const resolved = resolveAppearance({ spacing: 80 }, { spacing: 120, barThickness: 20 });
		expect(resolved.spacing).toBe(80);
		// Not overridden by the file, so the global default still applies.
		expect(resolved.barThickness).toBe(20);
		// Set by neither layer.
		expect(resolved.markerSize).toBe(DEFAULT_TIMELINE_APPEARANCE.markerSize);
	});

	it('clamps out-of-range numbers to the slider limits', () => {
		const big = resolveAppearance({ barThickness: 9999, spacing: 10_000, markerSize: 500, spineWidth: 99, trackWidth: 99 });
		expect(big.barThickness).toBe(APPEARANCE_LIMITS.barThickness.max);
		expect(big.spacing).toBe(APPEARANCE_LIMITS.spacing.max);
		expect(big.markerSize).toBe(APPEARANCE_LIMITS.markerSize.max);
		expect(big.spineWidth).toBe(APPEARANCE_LIMITS.spineWidth.max);
		expect(big.trackWidth).toBe(APPEARANCE_LIMITS.trackWidth.max);

		const small = resolveAppearance({ barThickness: -40, spacing: 0, markerSize: 0, spineWidth: 0, trackWidth: -1 });
		expect(small.barThickness).toBe(APPEARANCE_LIMITS.barThickness.min);
		expect(small.spacing).toBe(APPEARANCE_LIMITS.spacing.min);
		expect(small.markerSize).toBe(APPEARANCE_LIMITS.markerSize.min);
		expect(small.spineWidth).toBe(APPEARANCE_LIMITS.spineWidth.min);
		expect(small.trackWidth).toBe(APPEARANCE_LIMITS.trackWidth.min);
	});

	it('falls through malformed values instead of trusting them', () => {
		// A hand-edited .timeline can hold anything; every one of these must
		// yield the next layer's value rather than NaN or a crash.
		const junk = {
			barThickness: 'thick',
			spacing: NaN,
			markerSize: Infinity,
			spineWidth: null,
			trackWidth: {},
			stitches: 'yes',
			labelMode: 'sometimes',
			labelDirection: 'sideways',
			axisUnit: 'fortnights',
		} as unknown as Partial<TimelineAppearance>;
		expect(resolveAppearance(junk)).toEqual(DEFAULT_TIMELINE_APPEARANCE);
		// …and the global layer still gets its say when the file's value is junk.
		expect(resolveAppearance(junk, { barThickness: 18, labelMode: 'hover' })).toMatchObject({
			barThickness: 18,
			labelMode: 'hover',
		});
	});

	it('accepts stitches: false from either layer (a falsy value is still a value)', () => {
		expect(resolveAppearance({ stitches: false }).stitches).toBe(false);
		expect(resolveAppearance({}, { stitches: false }).stitches).toBe(false);
		// The file's `true` must beat the global `false`, not be skipped as default-ish.
		expect(resolveAppearance({ stitches: true }, { stitches: false }).stitches).toBe(true);
	});

	it('accepts every valid label mode, direction and axis unit', () => {
		for (const labelMode of ['room', 'always', 'hover', 'off'] as const) {
			expect(resolveAppearance({ labelMode }).labelMode).toBe(labelMode);
		}
		for (const labelDirection of ['readable', 'along-axis'] as const) {
			expect(resolveAppearance({ labelDirection }).labelDirection).toBe(labelDirection);
		}
		for (const axisUnit of ['auto', 'year', 'month', 'day'] as const) {
			expect(resolveAppearance({ axisUnit }).axisUnit).toBe(axisUnit);
		}
	});

	it('never mutates its inputs', () => {
		const file = { spacing: 5 };
		const global = { barThickness: 999 };
		const fileCopy = { ...file };
		const globalCopy = { ...global };
		resolveAppearance(file, global);
		expect(file).toEqual(fileCopy);
		expect(global).toEqual(globalCopy);
	});
});

describe('resolveAppearance() — spineColor (B3)', () => {
	it('stays undefined with no override at all — "whatever styles.css paints today"', () => {
		expect(resolveAppearance().spineColor).toBeUndefined();
		expect(resolveAppearance({}, {}).spineColor).toBeUndefined();
	});

	it('lets the per-file override win over the plugin-global one', () => {
		const resolved = resolveAppearance({ spineColor: '#ff0000' }, { spineColor: '#00ff00' });
		expect(resolved.spineColor).toBe('#ff0000');
	});

	it('falls through to the global layer when the file has none', () => {
		expect(resolveAppearance({}, { spineColor: '#00ff00' }).spineColor).toBe('#00ff00');
		expect(resolveAppearance(undefined, { spineColor: '#00ff00' }).spineColor).toBe('#00ff00');
	});

	it('passes a gradient string through unchanged — no clamping, it is a color', () => {
		const gradient = 'linear-gradient(90deg, #ff0000, #0000ff)';
		expect(resolveAppearance({ spineColor: gradient }).spineColor).toBe(gradient);
	});

	it('rejects malformed values (empty string, non-string) rather than trusting them', () => {
		expect(resolveAppearance({ spineColor: '' }).spineColor).toBeUndefined();
		expect(resolveAppearance({ spineColor: 123 as unknown as string }).spineColor).toBeUndefined();
		expect(resolveAppearance({ spineColor: null as unknown as string }).spineColor).toBeUndefined();
		// A malformed file value still lets the global layer's good value through.
		expect(resolveAppearance({ spineColor: '' }, { spineColor: '#123456' }).spineColor).toBe('#123456');
	});
});
