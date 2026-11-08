// Story Timeline layout engine — pure TypeScript, no Obsidian imports,
// mirroring the grid-data.ts convention.
//
// Computes world-space geometry for the redesigned timeline (mock approved
// 2026-08-30): a central spine with year chips and month ticks, colored
// tracks on both sides of it, ranged events as bars with darker end caps,
// one-time events as point markers, "stitch" connectors from every event
// back to the spine, and label anchors. The renderer (timeline-render.ts)
// becomes a dumb painter over this output: every visual decision — spacing,
// bar thickness, marker size, stitches, orientation — arrives here as a
// pure function input, so the Phase B sliders plug straight in with no
// layout rework.
//
// Units (2026-11-03 redesign): the camera stretches ONLY the time axis, so
// across-axis numbers here are plain on-screen px, and along-axis positions
// are world px (day × pxPerDay) that the camera multiplies by its zoom.
// Every SIZE (badge radius, bar thickness, gaps) is on-screen px. The engine
// gets the zoom as `alongScale` only so it can tell which badges would
// overlap on screen and spread them sideways.

import type { CalendarDef } from './timeline-data';
import type { TimelineAxisUnit } from './timeline-appearance';
import { fanSpacingFor } from './timeline-appearance';
import { absoluteDayToStoryDate, formatStoryDate, storyDateToAbsoluteDay } from './calendar';
import { fanOffsets } from '../utils/graph-shared';

export type TimelineOrientation = 'horizontal' | 'vertical';

/**
 * One dated item to lay out. The caller resolves eventDisplay.plotlineId to
 * a trackId first — an id not present in the track list falls back to the
 * first track, matching timeline-render's laneIndex() behavior, so no event
 * ever silently vanishes. `endDay` greater than `startDay` makes a bar;
 * missing or equal (a moment, not a span) makes a point marker. An endDay
 * BEFORE startDay is invalid input (the UI forbids entering it) and is
 * defensively treated as a point at startDay.
 */
export interface LayoutEvent {
	id: string;
	trackId: string;
	startDay: number;
	endDay?: number;
	/** Per-event override of spec.markerRadius (point events only) — B2.1. Already clamped by the caller (timeline-render's read seam); the engine trusts it as-is. Absent = follow the spec default. */
	markerRadius?: number;
	/** Per-event override of spec.barThickness (ranged events only) — B2.1. Same clamp/absent contract as markerRadius. */
	barThickness?: number;
	/** Still going on: the caller set endDay to the story's present, and the bar ends in an arrow there instead of an end badge. */
	ongoing?: boolean;
}

/**
 * The geometry knobs. These are Emma's "customization not limits" sliders:
 * each one is a plain number so Phase B can wire a slider straight to it.
 * Stroke widths for the spine/threads/stitches are paint (renderer) concerns
 * — only measurements that move geometry live here.
 */
export interface TimelineLayoutSpec {
	orientation: TimelineOrientation;
	/** World px per absolute day. Zoom multiplies on top in the camera, not here. */
	pxPerDay: number;
	/** Across-axis distance between neighboring track rings, and from the spine to the first ring — the "spacing" slider. */
	spacing: number;
	/** Bar cross-axis thickness — the "bar thickness" slider. */
	barThickness: number;
	/** Badge radius in on-screen px (see badgeRadiusFor) — the "marker size" slider. */
	markerRadius: number;
	/** Across-axis gap between same-day markers fanned out on one track. */
	fanSpacing: number;
	/** How far (on-screen px, past the badge edge) the spine and each track thread extend past their first/last event. */
	overhang: number;
	/** Gap (on-screen px) between a badge/bar edge and its label anchor. */
	labelGap: number;
	/** The camera's zoom: on-screen px per world px ALONG the time axis. Only collision packing and along-axis paddings read it. */
	alongScale: number;
	/** Smallest on-screen gap kept between two badges on one track before they are spread sideways. */
	badgeGap: number;
	/** Lane-free layout only: on-screen px kept clear between the main line and the nearest badge edge (room for the year labels sitting on the line). */
	columnInset: number;
	/** Stitches default ON with a per-timeline toggle — false simply yields no stitch geometry. */
	stitches: boolean;
}

/**
 * Defaults sourced from the approved mock's "thin" weights (bar 12, marker
 * r10, overhang 14) and the current renderer's constants (pxPerDay = the old
 * BASE_PX_PER_DAY = 3; fanSpacing = marker diameter + 2, the old
 * NODE_FAN_SPACING convention). Spacing ≈ the mock's ring gap.
 */
export const DEFAULT_LAYOUT_SPEC: TimelineLayoutSpec = {
	orientation: 'horizontal',
	pxPerDay: 3,
	spacing: 104,
	barThickness: 12,
	markerRadius: 10,
	fanSpacing: 22,
	overhang: 14,
	labelGap: 6,
	stitches: false,
	alongScale: 1,
	badgeGap: 4,
	columnInset: 10,
};

/**
 * On-screen badge radius for a "marker size" knob. Compressive on purpose:
 * the default knob (10) lands on a 26px badge (Emma, 2026-11-06: the 40px
 * ones felt "big and bulky"), the slider still scales it (3 → 17px,
 * 28 → 49px), and the old big per-event sizes (20 → 39px) stay sane instead
 * of doubling. It is exactly 0.65 × the 2026-11-03 formula (knob + 10), so a
 * timeline's size differences between events keep their old proportions.
 * Rounded to half a pixel so the circle edges stay crisp.
 */
export function badgeRadiusFor(markerSize: number): number {
	return Math.round(0.65 * (markerSize + 10) * 2) / 2;
}

/** The light ring around a badge's coloured disc: thinner on a smaller badge so it reads light, never a speck. */
export function badgeRingWidthFor(radius: number): number {
	return Math.min(2.5, Math.max(1.5, Math.round(radius * 0.125 * 4) / 4));
}

/** The theme-coloured cut-out around a badge (where lines under it stop), in proportion to the badge. */
export function badgeHaloFor(radius: number): number {
	return Math.min(3, Math.max(1.5, Math.round(radius * 0.15 * 2) / 2));
}

/** A span's end badge: a smaller echo of its start badge. */
export function endBadgeRadiusFor(startRadius: number): number {
	return Math.max(6, Math.round(startRadius * 0.6));
}

/**
 * On-screen bar thickness for a "bar thickness" knob — the default (12) lands
 * on 7px; a big old value (29) stays well short of a slab. 0.8 × the
 * 2026-11-03 formula: thinned less than the badges (0.65×) on purpose — next
 * to 26px badges it stays a clear bar, never the "thin lines" Emma rejected.
 */
export function barThicknessFor(barThickness: number): number {
	return Math.round((3.2 + barThickness * 0.32) * 10) / 10;
}

/**
 * The arrow at the end of a bar that is still going on, from the bar's
 * on-screen thickness: half its width across the bar, and how far its tip
 * reaches past the story's present. The painter draws it and the column
 * packer keeps room for it, from this one formula.
 */
export function ongoingArrowSize(thickness: number): { half: number; length: number } {
	return { half: Math.max(6, thickness * 0.95), length: Math.max(9, thickness * 1.5) };
}

/** Darker end caps on bars are this long (world px), clamped for tiny bars. From the mock. */
export const BAR_CAP_LENGTH = 4;

export interface LayoutPoint {
	x: number;
	y: number;
}

export interface LayoutRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LayoutSegment {
	start: LayoutPoint;
	end: LayoutPoint;
}

export interface TrackLayout {
	trackId: string;
	/** -1 = above the spine (horizontal) / left of it (vertical); +1 = the other side. */
	side: -1 | 1;
	/** Signed across-axis offset from the spine (which sits at across 0). */
	acrossOffset: number;
	/** The track's thread, spanning its own events plus overhang — null for a track with no dated events. */
	line: LayoutSegment | null;
	/** Anchor for the track name, just before the thread's early end — null when line is null. */
	labelAnchor: LayoutPoint | null;
}

export interface MarkerLayout {
	eventId: string;
	trackId: string;
	center: LayoutPoint;
	/** Across-axis shift applied when badges on one track would overlap on screen at this zoom (0 otherwise). */
	fanOffset: number;
	/** Effective radius this marker paints at — the event's own override, or spec.markerRadius. The painter reads this instead of the spec value so B2.1 overrides reach the halo/dot without re-resolving. */
	radius: number;
}

export interface BarLayout {
	eventId: string;
	trackId: string;
	rect: LayoutRect;
	/** Same sideways spread as MarkerLayout.fanOffset — a span is packed with the badges around it. */
	fanOffset: number;
	/** The start badge: at the bar's start, on its centre line. */
	startCenter: LayoutPoint;
	startRadius: number;
	/** The smaller end badge, at the bar's end. */
	endCenter: LayoutPoint;
	endRadius: number;
	/** Still going on: the bar ends at the story's present in an arrow (endRadius is its size), not an end badge. */
	ongoing: boolean;
	/** Darker cap at the start edge — same thickness as the bar. */
	startCap: LayoutRect;
	/** Darker cap at the end edge. */
	endCap: LayoutRect;
}

export interface StitchLayout {
	eventId: string;
	/** The event's end of the hairline: a marker's (fanned) center, or a bar's start edge. */
	from: LayoutPoint;
	/** The spine end, where the renderer paints the stitch dot. */
	to: LayoutPoint;
}

export interface EventLabelLayout {
	eventId: string;
	kind: 'point' | 'bar';
	/** Where the label text starts. Text runs along the time axis (horizontal text in horizontal view, vertical in vertical view) — rotation is the painter's job. */
	anchor: LayoutPoint;
	/** Outward side (away from the spine) the label should grow toward. */
	side: -1 | 1;
}

export interface TimelineLayout {
	/** Spine spanning every dated event plus overhang, at across 0 — null when nothing is dated. */
	spine: LayoutSegment | null;
	tracks: TrackLayout[];
	markers: MarkerLayout[];
	bars: BarLayout[];
	stitches: StitchLayout[];
	labels: EventLabelLayout[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Placement primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic side/ring placement around the central spine: track 0 sits
 * on side -1 ring 0 (above/left, like the mock's Main plot), track 1 on
 * side +1 ring 0, then outward ring by ring. Pure and order-driven, so the
 * caller's track order fully decides the picture.
 */
export function trackSlot(index: number): { side: -1 | 1; ring: number } {
	return { side: index % 2 === 0 ? -1 : 1, ring: Math.floor(index / 2) };
}

/** Signed across-axis offset of a track from the spine, `spacing` apart ring to ring. */
export function trackAcrossOffset(index: number, spacing: number): number {
	const { side, ring } = trackSlot(index);
	return side * (ring + 1) * spacing;
}

/** Map (along the time axis, across from the spine) to concrete x/y for an orientation. */
export function axisPoint(along: number, across: number, orientation: TimelineOrientation): LayoutPoint {
	return orientation === 'horizontal' ? { x: along, y: across } : { x: across, y: along };
}

/**
 * Turns an along-axis segment (the spine's span, or a solid-style track
 * thread's line) into a thickness-centered rect. B3 needs this because an
 * axis-aligned `<line>` has a zero-area bounding box and this codebase's
 * gradients are `objectBoundingBox` — a gradient on a line paints nothing, so
 * anything that should carry a real gradient (rather than solidFromColor's
 * flattened single color) has to become a shape with area instead. Assumes
 * the segment's across coordinate is constant across both ends, which holds
 * for every segment this engine produces (nothing here ever runs diagonally).
 */
export function axisRectFromSegment(
	seg: LayoutSegment,
	thickness: number,
	orientation: TimelineOrientation,
): LayoutRect {
	const alongOf = (p: LayoutPoint): number => (orientation === 'horizontal' ? p.x : p.y);
	const acrossOf = (p: LayoutPoint): number => (orientation === 'horizontal' ? p.y : p.x);
	const alongFrom = Math.min(alongOf(seg.start), alongOf(seg.end));
	const alongLen = Math.abs(alongOf(seg.end) - alongOf(seg.start));
	const across = acrossOf(seg.start);
	const half = thickness / 2;
	return orientation === 'horizontal'
		? { x: alongFrom, y: across - half, width: alongLen, height: thickness }
		: { x: across - half, y: alongFrom, width: thickness, height: alongLen };
}

/**
 * Inverse of trackAcrossOffset for pointer hit-testing: which track slot a
 * world across-position is closest to (e.g. double-click-to-add picking the
 * plotline under the cursor). Ties go to the lower index; an empty track
 * list answers 0, matching the unknown-trackId fallback.
 */
export function nearestTrackIndex(across: number, trackCount: number, spacing: number): number {
	let best = 0;
	let bestDist = Infinity;
	for (let i = 0; i < trackCount; i++) {
		const d = Math.abs(across - trackAcrossOffset(i, spacing));
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	}
	return best;
}

/** An axis-aligned rect from an along-axis span and an across-axis center + thickness. */
function axisRect(
	alongStart: number,
	alongLength: number,
	acrossCenter: number,
	thickness: number,
	orientation: TimelineOrientation,
): LayoutRect {
	return orientation === 'horizontal'
		? { x: alongStart, y: acrossCenter - thickness / 2, width: alongLength, height: thickness }
		: { x: acrossCenter - thickness / 2, y: alongStart, width: thickness, height: alongLength };
}

// ─────────────────────────────────────────────────────────────────────────────
// The layout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lay out one timeline. `trackIds` is the caller's ordered track list (the
 * renderer passes the unsorted pseudo-track first, then the file's
 * plotlines, matching today's laneList()). Pure: same inputs, same output.
 */
export function computeTimelineLayout(
	events: LayoutEvent[],
	trackIds: string[],
	spec: TimelineLayoutSpec,
): TimelineLayout {
	const { orientation, pxPerDay, spacing, overhang, labelGap } = spec;
	const along = (day: number): number => day * pxPerDay;
	// Paddings along the time axis are meant in on-screen px, so they are
	// divided by the zoom to land at the same visible distance at every zoom.
	const zoom = spec.alongScale > 0 && Number.isFinite(spec.alongScale) ? spec.alongScale : 1;
	const alongPad = (screenPx: number): number => screenPx / zoom;

	const indexOfTrack = new Map<string, number>();
	trackIds.forEach((id, i) => {
		if (!indexOfTrack.has(id)) indexOfTrack.set(id, i);
	});
	// Unknown trackId → first track, same fallback as timeline-render's laneIndex().
	const trackIndex = (id: string): number => indexOfTrack.get(id) ?? 0;

	interface Placed {
		event: LayoutEvent;
		idx: number;
		side: -1 | 1;
		across: number;
		startDay: number;
		endDay: number;
		isBar: boolean;
		/** Badge radius (on-screen px) — a span's start badge. */
		radius: number;
		/** A span's smaller end badge; equal to `radius` for a point. */
		endRadius: number;
	}
	const placed: Placed[] = events.map((event) => {
		const idx = trackIndex(event.trackId);
		const isBar = event.endDay != null && event.endDay > event.startDay;
		const radius = event.markerRadius ?? spec.markerRadius;
		return {
			event,
			idx,
			side: trackSlot(idx).side,
			across: trackAcrossOffset(idx, spacing),
			startDay: event.startDay,
			endDay: isBar ? (event.endDay as number) : event.startDay,
			isBar,
			radius,
			endRadius: isBar ? endBadgeRadiusFor(radius) : radius,
		};
	});

	// The first/last item of a set, for "how far past its badge does the line run".
	const earliest = (list: Placed[]): Placed => list.reduce((a, b) => (b.startDay < a.startDay ? b : a));
	const latest = (list: Placed[]): Placed => list.reduce((a, b) => (b.endDay > a.endDay ? b : a));

	// ── Spine: spans everything dated, plus overhang past the outer badges, at across 0 ──
	let spine: LayoutSegment | null = null;
	if (placed.length > 0) {
		const first = earliest(placed);
		const last = latest(placed);
		spine = {
			start: axisPoint(along(first.startDay) - alongPad(overhang + first.radius), 0, orientation),
			end: axisPoint(along(last.endDay) + alongPad(overhang + last.endRadius), 0, orientation),
		};
	}

	// ── Tracks: each thread spans only its own events ──
	const tracks: TrackLayout[] = trackIds.map((trackId, idx) => {
		const { side } = trackSlot(idx);
		const acrossOffset = trackAcrossOffset(idx, spacing);
		const own = placed.filter((p) => p.idx === idx);
		if (own.length === 0) {
			return { trackId, side, acrossOffset, line: null, labelAnchor: null };
		}
		const first = earliest(own);
		const last = latest(own);
		const startAlong = along(first.startDay) - alongPad(overhang + first.radius);
		return {
			trackId,
			side,
			acrossOffset,
			line: {
				start: axisPoint(startAlong, acrossOffset, orientation),
				end: axisPoint(along(last.endDay) + alongPad(overhang + last.endRadius), acrossOffset, orientation),
			},
			labelAnchor: axisPoint(startAlong - alongPad(labelGap), acrossOffset, orientation),
		};
	});

	// ── Sideways spread: items on one track whose badges would overlap ON SCREEN ──
	// An item's footprint is its on-screen stretch of the time axis (a point:
	// its badge; a span: start badge to end badge). Overlapping footprints
	// chain into a cluster; inside a cluster each item takes the first column
	// that is free again by its start, and the columns are centred on the
	// track. A same-day pile is just the zero-distance case of this, so it
	// fans exactly as before. Zoom changes the footprints, which is why the
	// renderer re-runs this once a zoom settles.
	const fanShift = new Map<string, number>();
	const footprint = (p: Placed): { from: number; to: number } => ({
		from: along(p.startDay) * zoom - p.radius,
		to: along(p.endDay) * zoom + p.endRadius,
	});
	const byId = (a: Placed, b: Placed): number => (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0);
	const spreadCluster = (cluster: Placed[]): void => {
		// Spacing comes from the cluster's LARGEST badge, so a mix of a huge
		// and a tiny badge never overlaps (fanSpacingFor = radius*2+2). The
		// spread must stay inside the lane (half the spacing each way, minus
		// the badge), so the number of columns is capped at what fits with at
		// most a half-overlap; anything beyond that shares the column that
		// frees up soonest (overlapping along time — zoom in to separate)
		// rather than spilling onto the next plotline or across the spine.
		const maxRadius = Math.max(...cluster.map((p) => p.radius));
		const room = Math.max(0, spacing - 2 * maxRadius);
		const maxColumns = Math.max(1, Math.floor(room / maxRadius) + 1);
		const columnEnds: number[] = [];
		const columnOf = new Map<string, number>();
		for (const p of cluster) {
			const f = footprint(p);
			let col = columnEnds.findIndex((end) => end + spec.badgeGap <= f.from);
			if (col === -1 && columnEnds.length < maxColumns) {
				col = columnEnds.length;
				columnEnds.push(f.to);
			} else {
				if (col === -1) col = columnEnds.indexOf(Math.min(...columnEnds));
				columnEnds[col] = Math.max(columnEnds[col], f.to);
			}
			columnOf.set(p.event.id, col);
		}
		const columns = columnEnds.length;
		const step = columns > 1 ? Math.min(fanSpacingFor(maxRadius), room / (columns - 1)) : 0;
		const offsets = fanOffsets(columns, step);
		for (const p of cluster) fanShift.set(p.event.id, offsets[columnOf.get(p.event.id) ?? 0]);
	};
	for (let idx = 0; idx < trackIds.length; idx++) {
		const own = placed.filter((p) => p.idx === idx).sort((a, b) => a.startDay - b.startDay || byId(a, b));
		let cluster: Placed[] = [];
		let clusterEnd = -Infinity;
		for (const p of own) {
			const f = footprint(p);
			if (cluster.length > 0 && f.from >= clusterEnd + spec.badgeGap) {
				spreadCluster(cluster);
				cluster = [];
				clusterEnd = -Infinity;
			}
			cluster.push(p);
			clusterEnd = Math.max(clusterEnd, f.to);
		}
		if (cluster.length > 0) spreadCluster(cluster);
	}
	const fanOf = (p: Placed): number => fanShift.get(p.event.id) ?? 0;

	// ── Point markers (badges) ──
	const markers: MarkerLayout[] = placed
		.filter((p) => !p.isBar)
		.map((p) => {
			const fanOffset = fanOf(p);
			return {
				eventId: p.event.id,
				trackId: p.event.trackId,
				center: axisPoint(along(p.startDay), p.across + fanOffset, orientation),
				fanOffset,
				radius: p.radius,
			};
		});

	// ── Spans: a bar from start badge to end badge (cap length clamped so tiny bars stay sane) ──
	const bars: BarLayout[] = placed
		.filter((p) => p.isBar)
		.map((p) => {
			const startAlong = along(p.startDay);
			const length = along(p.endDay) - startAlong;
			const cap = Math.min(BAR_CAP_LENGTH, length / 2);
			const thickness = p.event.barThickness ?? spec.barThickness;
			const fanOffset = fanOf(p);
			const center = p.across + fanOffset;
			return {
				eventId: p.event.id,
				trackId: p.event.trackId,
				rect: axisRect(startAlong, length, center, thickness, orientation),
				startCap: axisRect(startAlong, cap, center, thickness, orientation),
				endCap: axisRect(startAlong + length - cap, cap, center, thickness, orientation),
				fanOffset,
				startCenter: axisPoint(startAlong, center, orientation),
				startRadius: p.radius,
				endCenter: axisPoint(startAlong + length, center, orientation),
				endRadius: p.endRadius,
				ongoing: !!p.event.ongoing,
			};
		});

	// ── Stitches: hairline from each event's (spread) start straight back to the spine ──
	const stitches: StitchLayout[] = spec.stitches
		? placed.map((p) => {
				const startAlong = along(p.startDay);
				return {
					eventId: p.event.id,
					from: axisPoint(startAlong, p.across + fanOf(p), orientation),
					to: axisPoint(startAlong, 0, orientation),
				};
		  })
		: [];

	// ── Label anchors, growing outward (away from the spine) ──
	// Whether they render always or on hover is the per-timeline label-mode
	// setting — a paint decision; the geometry is identical either way. A
	// span's label sits by its start badge, clear of the badge or the bar,
	// whichever is wider.
	const labels: EventLabelLayout[] = placed.map((p) => {
		const startAlong = along(p.startDay);
		const edge = p.isBar ? Math.max(p.radius, (p.event.barThickness ?? spec.barThickness) / 2) : p.radius;
		return {
			eventId: p.event.id,
			kind: p.isBar ? 'bar' : 'point',
			anchor: axisPoint(startAlong, p.across + fanOf(p) + p.side * (edge + labelGap), orientation),
			side: p.side,
		};
	});

	return { spine, tracks, markers, bars, stitches, labels };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lane-free layout: compact columns beside the main line (2026-11-03)
// ─────────────────────────────────────────────────────────────────────────────

/** Columns per side of the main line before items start sharing (overlapping along time — zoom in to separate). */
export const MAX_COLUMNS_PER_SIDE = 4;

/**
 * The Timeline without plotline lanes (Emma, 2026-11-03: "it's enough to have
 * events"): every event sits in one of a few compact columns either side of
 * the main line, World Anvil style. Items are packed by time at the CURRENT
 * zoom (spec.alongScale): each takes the column closest to the line —
 * right, left, then the next pair out — that is free again by its start, so
 * badges and bars never overlap on screen. A span or an ongoing bar holds
 * its column until its end. Same output shape as computeTimelineLayout (no
 * tracks), so the painter draws both the same way. Plotline data is not
 * read here at all — it stays in the file, untouched, for when lanes return.
 */
export function computeColumnLayout(events: LayoutEvent[], spec: TimelineLayoutSpec): TimelineLayout {
	const { orientation, pxPerDay, overhang, labelGap, badgeGap } = spec;
	const along = (day: number): number => day * pxPerDay;
	const zoom = spec.alongScale > 0 && Number.isFinite(spec.alongScale) ? spec.alongScale : 1;
	const alongPad = (screenPx: number): number => screenPx / zoom;

	interface Item {
		event: LayoutEvent;
		startDay: number;
		endDay: number;
		isBar: boolean;
		radius: number;
		endRadius: number;
		/** How far past its end it reaches on screen: the end badge, or an ongoing bar's arrow. */
		endReach: number;
		/** Half its width across the time axis — what decides how far apart columns sit. */
		halfWidth: number;
	}
	const items: Item[] = events.map((event) => {
		const isBar = event.endDay != null && event.endDay > event.startDay;
		const radius = event.markerRadius ?? spec.markerRadius;
		const endRadius = isBar ? endBadgeRadiusFor(radius) : radius;
		const arrow = isBar && event.ongoing ? ongoingArrowSize(event.barThickness ?? spec.barThickness) : null;
		return {
			event,
			startDay: event.startDay,
			endDay: isBar ? (event.endDay as number) : event.startDay,
			isBar,
			radius,
			endRadius,
			endReach: arrow ? arrow.length : endRadius,
			halfWidth: arrow ? Math.max(radius, arrow.half) : radius,
		};
	});
	const empty: TimelineLayout = { spine: null, tracks: [], markers: [], bars: [], stitches: [], labels: [] };
	if (items.length === 0) return empty;

	// One regular grid of columns, sized by the biggest badge so none ever
	// touches its neighbour column. The first column sits just clear of the
	// main line and the year labels on it (spec.columnInset).
	const maxRadius = Math.max(...items.map((i) => i.radius));
	const step = 2 * Math.max(...items.map((i) => i.halfWidth)) + 2 * badgeGap;
	const inset = maxRadius + spec.columnInset;
	const columnAcross = (col: number): number => {
		const side = col % 2 === 0 ? 1 : -1;
		return side * (inset + Math.floor(col / 2) * step);
	};

	const footprint = (i: Item): { from: number; to: number } => ({
		from: along(i.startDay) * zoom - i.radius,
		to: along(i.endDay) * zoom + i.endReach,
	});
	const sorted = [...items].sort((a, b) => a.startDay - b.startDay || (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0));
	const columnEnds: number[] = [];
	const columnOf = new Map<string, number>();
	const maxColumns = 2 * MAX_COLUMNS_PER_SIDE;
	for (const item of sorted) {
		const fp = footprint(item);
		let col = columnEnds.findIndex((end) => end + badgeGap <= fp.from);
		if (col === -1 && columnEnds.length < maxColumns) {
			col = columnEnds.length;
			columnEnds.push(fp.to);
		} else {
			if (col === -1) col = columnEnds.indexOf(Math.min(...columnEnds));
			columnEnds[col] = Math.max(columnEnds[col], fp.to);
		}
		columnOf.set(item.event.id, col);
	}
	const acrossOf = (i: Item): number => columnAcross(columnOf.get(i.event.id) ?? 0);
	const sideOf = (i: Item): -1 | 1 => (acrossOf(i) < 0 ? -1 : 1);

	const first = sorted[0];
	const last = items.reduce((a, b) => (b.endDay > a.endDay ? b : a));
	const spine: LayoutSegment = {
		start: axisPoint(along(first.startDay) - alongPad(overhang + first.radius), 0, orientation),
		end: axisPoint(along(last.endDay) + alongPad(overhang + last.endRadius), 0, orientation),
	};

	const markers: MarkerLayout[] = items.filter((i) => !i.isBar).map((i) => ({
		eventId: i.event.id,
		trackId: i.event.trackId,
		center: axisPoint(along(i.startDay), acrossOf(i), orientation),
		fanOffset: 0,
		radius: i.radius,
	}));

	const bars: BarLayout[] = items.filter((i) => i.isBar).map((i) => {
		const startAlong = along(i.startDay);
		const length = along(i.endDay) - startAlong;
		const cap = Math.min(BAR_CAP_LENGTH, length / 2);
		const thickness = i.event.barThickness ?? spec.barThickness;
		const across = acrossOf(i);
		return {
			eventId: i.event.id,
			trackId: i.event.trackId,
			rect: axisRect(startAlong, length, across, thickness, orientation),
			startCap: axisRect(startAlong, cap, across, thickness, orientation),
			endCap: axisRect(startAlong + length - cap, cap, across, thickness, orientation),
			fanOffset: 0,
			startCenter: axisPoint(startAlong, across, orientation),
			startRadius: i.radius,
			endCenter: axisPoint(startAlong + length, across, orientation),
			endRadius: i.endRadius,
			ongoing: !!i.event.ongoing,
		};
	});

	const stitches: StitchLayout[] = spec.stitches
		? items.map((i) => ({
				eventId: i.event.id,
				from: axisPoint(along(i.startDay), acrossOf(i), orientation),
				to: axisPoint(along(i.startDay), 0, orientation),
		  }))
		: [];

	const labels: EventLabelLayout[] = items.map((i) => {
		const side = sideOf(i);
		const edge = i.isBar ? Math.max(i.radius, (i.event.barThickness ?? spec.barThickness) / 2) : i.radius;
		return {
			eventId: i.event.id,
			kind: i.isBar ? 'bar' : 'point',
			anchor: axisPoint(along(i.startDay), acrossOf(i) + side * (edge + labelGap), orientation),
			side,
		};
	});

	return { spine, tracks: [], markers, bars, stitches, labels };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spine ticks (semantic zoom)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What boundary a tick marks — NOT the zoom level. 'year' ticks are the ones
 * the renderer draws as year chips; 'month' ticks get the small tick + month
 * name; 'day' ticks appear only when zoomed close enough to see single days.
 */
export type SpineTickKind = 'year' | 'month' | 'day';

export interface SpineTick {
	day: number;
	label: string;
	kind: SpineTickKind;
}

/**
 * Camera zoom bounds (on-screen px per world px along the time axis). The
 * floor is low on purpose: since badges keep their size, zooming out only
 * packs dates closer, so the fit can show a whole saga — half a pixel per
 * year at the floor, ~1500 years on one screen. (It was 0.15 while sizes
 * still shrank with zoom; with fixed sizes that left a 44-year story stuck
 * showing four years at its furthest zoom-out.)
 */
export const TIMELINE_MIN_ZOOM = 0.0005;
export const TIMELINE_MAX_ZOOM = 8;

/**
 * Whether the camera can be fitted to the events now. A view that is not on
 * screen yet (a new tab opened from the Writers Panel icon, before Obsidian
 * shows it) measures 0×0, and fitting then parks the camera at zoom 1 on day 0
 * — far from every event, so only the main line shows (Emma, 2026-11-03).
 * The renderer waits for a real size instead and fits then.
 */
export function canFitViewport(width: number, height: number): boolean {
	return width > 0 && height > 0;
}

export type TimelineWheelAction = { kind: 'zoom'; factor: number } | { kind: 'pan'; by: number } | { kind: 'none' };

/**
 * What one wheel event does on the timeline. Mostly-sideways movement (a
 * trackpad swipe, or Shift+wheel, which browsers send as deltaX) scrolls
 * through time — it used to count as "zoom out" (deltaY 0 ≠ < 0), so a light
 * swipe shrank the view to nothing within a second. Up/down (and a trackpad
 * pinch, sent as ctrl+wheel) zooms by an amount that follows how far the
 * wheel moved: one mouse notch (~100px) ≈ the old 10% step, while a
 * trackpad's stream of tiny deltas adds up smoothly. Line/page delta modes
 * are turned into px first.
 */
export function timelineWheelAction(deltaX: number, deltaY: number, deltaMode = 0): TimelineWheelAction {
	const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
	const dx = (Number.isFinite(deltaX) ? deltaX : 0) * unit;
	const dy = (Number.isFinite(deltaY) ? deltaY : 0) * unit;
	if (Math.abs(dx) > Math.abs(dy)) return { kind: 'pan', by: dx };
	if (dy === 0) return { kind: 'none' };
	return { kind: 'zoom', factor: Math.min(2, Math.max(0.5, Math.exp(-dy * 0.0015))) };
}

/** Same granularity thresholds the old renderer used (world px per day × zoom). */
const DAY_TICK_MIN_PX = 30;
const MONTH_TICK_MIN_PX = 2;
/** Days of slack outside the visible range so edge ticks don't pop in/out while panning. */
const TICK_CULL_BUFFER_DAYS = 60;

/** Era-aware year label, e.g. "Year 940" or "Third Age 12" — via formatStoryDate's year-only path. */
function yearChipLabel(calendar: CalendarDef, era: string | undefined, year: number): string {
	return formatStoryDate(calendar, { era, year });
}

/**
 * Ticks for the visible day range at the current effective zoom
 * (pxPerDay × camera scale): single days when close, month starts further
 * out, year starts only when far away. Walks real year starts through the
 * calendar (era- and leap-aware) instead of assuming year numbers are
 * absolute — a year-resetting era's chips land on the right days and carry
 * the era's own year numbers. Capped at `maxTicks`, matching the old
 * renderer's MAX_TICKS guard.
 */
export function computeSpineTicks(
	calendar: CalendarDef,
	startDay: number,
	endDay: number,
	effectivePxPerDay: number,
	maxTicks = 240,
	unit: TimelineAxisUnit = 'auto',
	minYearGapPx = 0,
): SpineTick[] {
	if (!(endDay >= startDay) || !(effectivePxPerDay > 0)) return [];
	const ticks: SpineTick[] = [];
	const months = calendar.months;

	// 'auto' keeps the zoom-derived granularity; an explicit unit pins it, which
	// is the whole point of the setting — "show me years" has to stay years when
	// the writer zooms in. maxTicks is still the backstop: forcing days across a
	// century asks for far more ticks than can be drawn, and the cap answers it
	// by covering the first stretch rather than freezing.
	let granularity: SpineTickKind = unit !== 'auto'
		? unit
		: effectivePxPerDay >= DAY_TICK_MIN_PX
			? 'day'
			: effectivePxPerDay >= MONTH_TICK_MIN_PX
				? 'month'
				: 'year';
	// A pinned unit that would need more than maxTicks over this range (days
	// or months across centuries, zoomed far out) used to spend the whole cap
	// in the off-screen buffer and leave the spine blank — step up instead.
	const span = endDay - startDay;
	const avgMonthDays = months && months.length > 0 ? months.reduce((sum, m) => sum + m.days, 0) / months.length : Infinity;
	if (granularity === 'day' && span > maxTicks) granularity = span / avgMonthDays <= maxTicks ? 'month' : 'year';
	if (granularity === 'month' && span / avgMonthDays > maxTicks) granularity = 'year';

	if (granularity === 'day') {
		// Day granularity: every day, upgraded to 'month'/'year' on boundaries.
		for (let d = Math.floor(startDay); d <= Math.ceil(endDay) && ticks.length < maxTicks; d++) {
			const date = absoluteDayToStoryDate(calendar, d);
			const isMonthStart = date.day === 1;
			const isYearStart = isMonthStart && (months ? date.month === 1 : true);
			if (isYearStart) {
				ticks.push({ day: d, label: yearChipLabel(calendar, date.era, date.year), kind: 'year' });
			} else if (isMonthStart && months) {
				ticks.push({ day: d, label: months[(date.month ?? 1) - 1]?.name ?? `Month ${date.month}`, kind: 'month' });
			} else {
				ticks.push({ day: d, label: formatStoryDate(calendar, { ...date, minute: undefined }), kind: 'day' });
			}
		}
		return ticks;
	}

	// Month/year granularity: walk real year starts through the calendar.
	// Start one year before the visible range (partial first years still get
	// their chip) and stop one buffer past its end.
	const monthTicks = granularity === 'month';
	const first = absoluteDayToStoryDate(calendar, Math.floor(startDay));
	// Zoomed far out, a chip per year would pile up: only every `step`th year
	// (a round 1/2/5/10/20/50… step) gets a chip, so neighbours stay at least
	// `minYearGapPx` apart on screen. Months are never thinned — at month
	// granularity years are hundreds of px apart anyway.
	const yearStep = (): number => {
		if (monthTicks || !(minYearGapPx > 0)) return 1;
		const y0 = storyDateToAbsoluteDay(calendar, { era: first.era, year: first.year, month: months ? 1 : undefined, day: 1 });
		const y1 = storyDateToAbsoluteDay(calendar, { era: first.era, year: first.year + 1, month: months ? 1 : undefined, day: 1 });
		const pxPerYear = Math.max(1, y1 - y0) * effectivePxPerDay;
		for (let magnitude = 1; magnitude < 1e9; magnitude *= 10) {
			for (const m of [1, 2, 5]) if (pxPerYear * m * magnitude >= minYearGapPx) return m * magnitude;
		}
		return 1e9;
	};
	const step = yearStep();
	let cursor = storyDateToAbsoluteDay(calendar, {
		era: first.era,
		year: Math.floor((first.year - 1) / step) * step,
		month: months ? 1 : undefined,
		day: 1,
	});
	const stop = endDay + TICK_CULL_BUFFER_DAYS;
	const inRange = (day: number): boolean => day >= startDay - TICK_CULL_BUFFER_DAYS && day <= stop;

	// Era starts, as absolute days: a thinned walk steps in the CURRENT era's
	// year numbers, so it must stop at the next era's first day and resume
	// counting there — otherwise "A 500" lands inside era B, right next to "B 20".
	const eraStarts = [...(calendar.eras ?? [])]
		.map((e) => storyDateToAbsoluteDay(calendar, { era: e.name, year: e.resetsYearTo1 ? 1 : e.startYear, month: months ? 1 : undefined, day: 1 }))
		.sort((a, b) => a - b);

	while (cursor <= stop && ticks.length < maxTicks) {
		// Re-derive the date at the cursor so era boundaries relabel correctly.
		const date = absoluteDayToStoryDate(calendar, cursor);
		if (inRange(cursor)) {
			const tick: SpineTick = { day: cursor, label: yearChipLabel(calendar, date.era, date.year), kind: 'year' };
			const last = ticks[ticks.length - 1];
			const tooClose = step > 1 && last?.kind === 'year' && (cursor - last.day) * effectivePxPerDay < minYearGapPx;
			// An era's first year wins over the round year just before it.
			if (!tooClose) ticks.push(tick);
			else if (eraStarts.includes(cursor)) ticks[ticks.length - 1] = tick;
		}
		if (monthTicks && months) {
			for (let m = 2; m <= months.length && ticks.length < maxTicks; m++) {
				const day = storyDateToAbsoluteDay(calendar, { era: date.era, year: date.year, month: m, day: 1 });
				if (!inRange(day)) continue;
				ticks.push({ day, label: months[m - 1].name, kind: 'month' });
			}
		}
		const stepped = storyDateToAbsoluteDay(calendar, {
			era: date.era,
			year: Math.floor(date.year / step) * step + step,
			month: months ? 1 : undefined,
			day: 1,
		});
		const eraStart = eraStarts.find((d) => d > cursor);
		const next = eraStart !== undefined && eraStart < stepped ? eraStart : stepped;
		if (next <= cursor) break; // degenerate calendar (zero-length year) — never loop forever
		cursor = next;
	}
	return ticks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zoomed-out label legibility
// ─────────────────────────────────────────────────────────────────────────────

/** On-screen label size in px — the same at every zoom, since labels are counter-scaled with their badge. */
export const MIN_LABEL_SCREEN_PX = 12;

/** How one label's text sits around its anchor — mirrors the painter's text-anchor / baseline / rotation choices. */
export type LabelPlacement =
	| 'centered-above' | 'centered-below'   // horizontal view, event labels
	| 'beside-left' | 'beside-right'        // vertical view, readable event labels
	| 'rotated-left' | 'rotated-right'      // vertical view, along-axis event labels
	| 'ends-at' | 'centered-on-top';        // track names: horizontal / vertical view

/** Rough box (in whatever px the anchor is in — the renderer passes on-screen px) a label's text covers. Char width is an estimate (0.6em, bold-ish UI font) — good enough to tell "crowded" from "has room". */
export function labelBox(anchor: LayoutPoint, text: string, fontSize: number, placement: LabelPlacement): LayoutRect {
	const w = text.length * fontSize * 0.6;
	const h = fontSize;
	const { x, y } = anchor;
	switch (placement) {
		case 'centered-above': return { x: x - w / 2, y: y - h, width: w, height: h };
		case 'centered-below': return { x: x - w / 2, y, width: w, height: h };
		case 'beside-left': return { x: x - w, y: y - h / 2, width: w, height: h };
		case 'beside-right': return { x, y: y - h / 2, width: w, height: h };
		// rotate(90): the text runs down the time axis; glyphs sit on one side of the anchor.
		case 'rotated-left': return { x: x - h, y: y - w / 2, width: h, height: w };
		case 'rotated-right': return { x, y: y - w / 2, width: h, height: w };
		case 'ends-at': return { x: x - w, y: y - h / 2, width: w, height: h };
		case 'centered-on-top': return { x: x - w / 2, y: y - h, width: w, height: h };
	}
}

/**
 * Ids of labels to hide so the shown ones never overlap. Greedy in input
 * order: a label shows only if its box clears every label already shown, so
 * callers put the most important first (track names, then events in time
 * order — which on a crowded overview reads as "every Nth event").
 * `obstacles` are boxes no label may cover but which are never hidden
 * themselves — the badges, in the "only when there's room" label mode.
 */
export function crowdedLabelIds(boxes: Array<{ id: string; box: LayoutRect }>, gap: number, obstacles: LayoutRect[] = []): Set<string> {
	const shown: LayoutRect[] = [...obstacles];
	const hidden = new Set<string>();
	for (const { id, box } of boxes) {
		const clash = shown.some((s) =>
			box.x < s.x + s.width + gap && s.x < box.x + box.width + gap &&
			box.y < s.y + s.height + gap && s.y < box.y + box.height + gap);
		if (clash) hidden.add(id);
		else shown.push(box);
	}
	return hidden;
}
