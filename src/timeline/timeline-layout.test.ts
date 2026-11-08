// Tests for the pure timeline layout engine (timeline-layout.ts).
// Everything here runs with zero Obsidian: geometry in, geometry out.

import {
	BAR_CAP_LENGTH,
	TIMELINE_MAX_ZOOM,
	TIMELINE_MIN_ZOOM,
	timelineWheelAction,
	canFitViewport,
	badgeRadiusFor,
	badgeRingWidthFor,
	badgeHaloFor,
	ongoingArrowSize,
	barThicknessFor,
	endBadgeRadiusFor,
	DEFAULT_LAYOUT_SPEC,
	LayoutEvent,
	TimelineLayoutSpec,
	axisPoint,
	axisRectFromSegment,
	computeSpineTicks,
	computeTimelineLayout,
	computeColumnLayout,
	nearestTrackIndex,
	trackAcrossOffset,
	trackSlot,
} from './timeline-layout';
import { GREGORIAN_CALENDAR } from './calendar';
import { computeTimelineFit } from '../utils/graph-shared';
import type { CalendarDef } from './timeline-data';

/** Round numbers so 30-day months etc. produce exact expectations: A=10 days, B=20 days, year=30 days. */
const TOY_CALENDAR: CalendarDef = {
	id: 'toy',
	name: 'Toy',
	months: [
		{ name: 'A', days: 10 },
		{ name: 'B', days: 20 },
	],
};

const MONTHLESS_CALENDAR: CalendarDef = { id: 'flat', name: 'Flat' };

/** Toy calendar plus eras: "Second" starts at absolute year 3 and resets counting to 1. */
const ERA_CALENDAR: CalendarDef = {
	...TOY_CALENDAR,
	id: 'era-toy',
	eras: [
		{ name: 'First', startYear: 1, resetsYearTo1: false },
		{ name: 'Second', startYear: 3, resetsYearTo1: true },
	],
};

const SPEC: TimelineLayoutSpec = {
	...DEFAULT_LAYOUT_SPEC,
	orientation: 'horizontal',
	pxPerDay: 10,
	spacing: 50,
	barThickness: 12,
	markerRadius: 10,
	fanSpacing: 22,
	overhang: 14,
	labelGap: 6,
	stitches: true,
};

const point = (id: string, trackId: string, startDay: number): LayoutEvent => ({ id, trackId, startDay });
const bar = (id: string, trackId: string, startDay: number, endDay: number): LayoutEvent => ({ id, trackId, startDay, endDay });

describe('trackSlot / trackAcrossOffset', () => {
	it('alternates sides around the spine, moving outward ring by ring', () => {
		expect(trackSlot(0)).toEqual({ side: -1, ring: 0 });
		expect(trackSlot(1)).toEqual({ side: 1, ring: 0 });
		expect(trackSlot(2)).toEqual({ side: -1, ring: 1 });
		expect(trackSlot(3)).toEqual({ side: 1, ring: 1 });
	});

	it('spaces rings by the spacing parameter (the slider input)', () => {
		expect(trackAcrossOffset(0, 56)).toBe(-56);
		expect(trackAcrossOffset(1, 56)).toBe(56);
		expect(trackAcrossOffset(2, 56)).toBe(-112);
		expect(trackAcrossOffset(3, 56)).toBe(112);
		expect(trackAcrossOffset(2, 30)).toBe(-60);
	});
});

describe('nearestTrackIndex', () => {
	it('answers the slot whose offset is closest to the across position', () => {
		// 4 tracks at spacing 50 sit at -50, +50, -100, +100.
		expect(nearestTrackIndex(-45, 4, 50)).toBe(0);
		expect(nearestTrackIndex(60, 4, 50)).toBe(1);
		expect(nearestTrackIndex(-90, 4, 50)).toBe(2);
		expect(nearestTrackIndex(300, 4, 50)).toBe(3);
	});

	it('breaks ties toward the lower index and answers 0 for an empty list', () => {
		// Across 0 is equidistant from -50 and +50.
		expect(nearestTrackIndex(0, 2, 50)).toBe(0);
		expect(nearestTrackIndex(123, 0, 50)).toBe(0);
	});
});

describe('axisPoint', () => {
	it('maps along/across to x/y per orientation', () => {
		expect(axisPoint(100, -50, 'horizontal')).toEqual({ x: 100, y: -50 });
		expect(axisPoint(100, -50, 'vertical')).toEqual({ x: -50, y: 100 });
	});
});

describe('axisRectFromSegment — B3 line-to-rect geometry for gradient-carrying spine/track threads', () => {
	it('spans the along axis and centers thickness on the across coordinate, horizontal', () => {
		const seg = { start: { x: 50, y: 0 }, end: { x: 250, y: 0 } };
		expect(axisRectFromSegment(seg, 10, 'horizontal')).toEqual({ x: 50, y: -5, width: 200, height: 10 });
	});

	it('spans the along axis and centers thickness on the across coordinate, vertical', () => {
		const seg = { start: { x: 0, y: 50 }, end: { x: 0, y: 250 } };
		expect(axisRectFromSegment(seg, 10, 'vertical')).toEqual({ x: -5, y: 50, width: 10, height: 200 });
	});

	it('centers off-zero across coordinates too (a track thread, not just the spine)', () => {
		const seg = { start: { x: 50, y: 56 }, end: { x: 250, y: 56 } };
		expect(axisRectFromSegment(seg, 4, 'horizontal')).toEqual({ x: 50, y: 54, width: 200, height: 4 });
	});

	it('is order-independent — start/end reversed gives the same rect', () => {
		const forward = { start: { x: 50, y: 0 }, end: { x: 250, y: 0 } };
		const reversed = { start: { x: 250, y: 0 }, end: { x: 50, y: 0 } };
		expect(axisRectFromSegment(reversed, 10, 'horizontal')).toEqual(axisRectFromSegment(forward, 10, 'horizontal'));
	});

	it('collapses to a zero-length span without going negative', () => {
		const seg = { start: { x: 100, y: 0 }, end: { x: 100, y: 0 } };
		expect(axisRectFromSegment(seg, 6, 'horizontal')).toEqual({ x: 100, y: -3, width: 0, height: 6 });
	});
});

describe('computeTimelineLayout — spine and tracks', () => {
	const events = [point('e1', 't1', 10), bar('e2', 't2', 20, 30)];

	it('spans the spine over every dated event (bar ends included) plus overhang past the outer badges, at across 0', () => {
		const { spine } = computeTimelineLayout(events, ['t1', 't2'], SPEC);
		// 100 - (overhang 14 + badge 10); 300 + (14 + end badge 6).
		expect(spine).toEqual({ start: { x: 76, y: 0 }, end: { x: 320, y: 0 } });
	});

	it('gives each track its thread spanning only its own events, with a label anchor before the start', () => {
		const { tracks } = computeTimelineLayout(events, ['t1', 't2'], SPEC);
		expect(tracks[0]).toEqual({
			trackId: 't1',
			side: -1,
			acrossOffset: -50,
			line: { start: { x: 76, y: -50 }, end: { x: 124, y: -50 } },
			labelAnchor: { x: 70, y: -50 },
		});
		expect(tracks[1].acrossOffset).toBe(50);
		expect(tracks[1].line).toEqual({ start: { x: 176, y: 50 }, end: { x: 320, y: 50 } });
	});

	it('leaves a track with no dated events without a line or label anchor', () => {
		const { tracks } = computeTimelineLayout(events, ['t1', 't2', 'empty'], SPEC);
		expect(tracks[2]).toEqual({ trackId: 'empty', side: -1, acrossOffset: -100, line: null, labelAnchor: null });
	});

	it('returns a null spine and empty geometry when nothing is dated', () => {
		const layout = computeTimelineLayout([], ['t1'], SPEC);
		expect(layout.spine).toBeNull();
		expect(layout.tracks[0].line).toBeNull();
		expect(layout.markers).toEqual([]);
		expect(layout.bars).toEqual([]);
		expect(layout.stitches).toEqual([]);
		expect(layout.labels).toEqual([]);
	});

	it('falls back to the first track for an unknown trackId — no event ever vanishes', () => {
		const layout = computeTimelineLayout([point('lost', 'no-such-track', 10)], ['t1', 't2'], SPEC);
		expect(layout.markers[0].center).toEqual({ x: 100, y: -50 });
		expect(layout.tracks[0].line).not.toBeNull();
	});
});

describe('computeTimelineLayout — points vs bars', () => {
	it('renders endDay > startDay as a bar with darker end caps', () => {
		const { bars, markers } = computeTimelineLayout([bar('e', 't1', 20, 30)], ['t1'], SPEC);
		expect(markers).toEqual([]);
		expect(bars[0].rect).toEqual({ x: 200, y: -56, width: 100, height: 12 });
		expect(bars[0].startCap).toEqual({ x: 200, y: -56, width: BAR_CAP_LENGTH, height: 12 });
		expect(bars[0].endCap).toEqual({ x: 296, y: -56, width: BAR_CAP_LENGTH, height: 12 });
	});

	it('treats a missing endDay, a same-day end, and an inverted end all as point markers', () => {
		const events = [point('a', 't1', 5), bar('b', 't1', 8, 8), bar('c', 't1', 11, 3)];
		const { bars, markers } = computeTimelineLayout(events, ['t1'], SPEC);
		expect(bars).toEqual([]);
		expect(markers.map((m) => m.eventId).sort()).toEqual(['a', 'b', 'c']);
		// The inverted end is ignored: 'c' sits at its startDay.
		expect(markers.find((m) => m.eventId === 'c')?.center).toEqual({ x: 110, y: -50 });
	});

	it('clamps end caps on a bar too short to hold two full caps', () => {
		const { bars } = computeTimelineLayout([bar('tiny', 't1', 10, 10.5)], ['t1'], SPEC);
		expect(bars[0].rect.width).toBe(5);
		expect(bars[0].startCap.width).toBe(2.5);
		expect(bars[0].endCap).toEqual({ x: 102.5, y: -56, width: 2.5, height: 12 });
	});

	it('sizes bars from barThickness — the slider input', () => {
		const { bars } = computeTimelineLayout([bar('e', 't1', 20, 30)], ['t1'], { ...SPEC, barThickness: 20 });
		expect(bars[0].rect).toEqual({ x: 200, y: -60, width: 100, height: 20 });
	});
});

describe('computeTimelineLayout — B2.1 per-event size overrides', () => {
	it('follows the spec default when an event carries no override', () => {
		const { markers, bars } = computeTimelineLayout([point('a', 't1', 10), bar('r', 't1', 20, 30)], ['t1'], SPEC);
		expect(markers[0].radius).toBe(SPEC.markerRadius);
		expect(bars[0].rect.height).toBe(SPEC.barThickness);
	});

	it('an oversized marker radius pushes its label anchor out further, and is reflected on the marker itself', () => {
		const events: LayoutEvent[] = [{ id: 'a', trackId: 't1', startDay: 10, markerRadius: 20 }];
		const { markers, labels } = computeTimelineLayout(events, ['t1'], SPEC);
		expect(markers[0].radius).toBe(20);
		// t1 is side -1; edge (20) + labelGap (6) further out than the default (10 + 6).
		expect(labels[0]).toEqual({ eventId: 'a', kind: 'point', anchor: { x: 100, y: -76 }, side: -1 });
	});

	it('an oversized bar thickness widens the rect AND both end caps', () => {
		const events: LayoutEvent[] = [{ id: 'e', trackId: 't1', startDay: 20, endDay: 30, barThickness: 30 }];
		const { bars, labels } = computeTimelineLayout(events, ['t1'], SPEC);
		expect(bars[0].rect).toEqual({ x: 200, y: -65, width: 100, height: 30 });
		expect(bars[0].startCap).toEqual({ x: 200, y: -65, width: BAR_CAP_LENGTH, height: 30 });
		expect(bars[0].endCap).toEqual({ x: 296, y: -65, width: BAR_CAP_LENGTH, height: 30 });
		// The label edge offset (bar thickness / 2) grows with it too.
		expect(labels[0].anchor).toEqual({ x: 200, y: -50 - 15 - 6 });
	});

	it('a mixed same-day group fans by its LARGEST effective marker radius, not the spec default', () => {
		const events: LayoutEvent[] = [
			{ id: 'a', trackId: 't1', startDay: 10, markerRadius: 5 },
			{ id: 'b', trackId: 't1', startDay: 10, markerRadius: 30 },
			{ id: 'c', trackId: 't1', startDay: 10, markerRadius: 5 },
		];
		const { markers } = computeTimelineLayout(events, ['t1'], { ...SPEC, spacing: 200 });
		const byId = new Map(markers.map((m) => [m.eventId, m]));
		// fanSpacingFor(30) = 62 (the group max), applied to all three despite
		// two of them being tiny — a flat spacing sized for radius 5 would let
		// the radius-30 marker overlap its neighbors.
		expect(byId.get('a')?.fanOffset).toBe(-62);
		expect(byId.get('b')?.fanOffset).toBe(0);
		expect(byId.get('c')?.fanOffset).toBe(62);
		// Each marker still paints at its own radius, independent of the group's fan spacing.
		expect(byId.get('a')?.radius).toBe(5);
		expect(byId.get('b')?.radius).toBe(30);
	});
});

describe('computeTimelineLayout — same-day fanning', () => {
	it('fans markers sharing one day on one track symmetrically, ordered by id regardless of input order', () => {
		const events = [point('c', 't1', 10), point('a', 't1', 10), point('b', 't1', 10)];
		const { markers } = computeTimelineLayout(events, ['t1'], { ...SPEC, spacing: 100 });
		const byId = new Map(markers.map((m) => [m.eventId, m]));
		expect(byId.get('a')?.fanOffset).toBe(-22);
		expect(byId.get('b')?.fanOffset).toBe(0);
		expect(byId.get('c')?.fanOffset).toBe(22);
		expect(byId.get('a')?.center).toEqual({ x: 100, y: -122 });
	});

	it('does not fan markers on different days or different tracks', () => {
		const events = [point('a', 't1', 10), point('b', 't1', 13), point('c', 't2', 10)];
		const { markers } = computeTimelineLayout(events, ['t1', 't2'], SPEC);
		expect(markers.every((m) => m.fanOffset === 0)).toBe(true);
	});
});

describe('on-screen sizes (2026-11-03 redesign)', () => {
	it('lands the default knobs on a 26px badge and a 7px bar (2026-11-06), and still scales with the sliders', () => {
		expect(badgeRadiusFor(10) * 2).toBe(26);
		// The Marker size slider's ends: small but still a badge, big but not a slab.
		expect(badgeRadiusFor(3) * 2).toBe(17);
		expect(badgeRadiusFor(28) * 2).toBe(49);
		// Old per-event sizes (Saltmarch uses 10–20) stay sane and keep their proportions.
		expect(badgeRadiusFor(20) * 2).toBe(39);
		expect(badgeRadiusFor(20) / badgeRadiusFor(10)).toBe(1.5);
		expect(barThicknessFor(12)).toBeCloseTo(7);
		expect(barThicknessFor(29)).toBeLessThan(13);
		expect(barThicknessFor(48)).toBeGreaterThan(barThicknessFor(12));
	});

	it('scales the ring and halo with the badge, never to a speck', () => {
		expect(badgeRingWidthFor(badgeRadiusFor(10))).toBe(1.75);
		expect(badgeRingWidthFor(badgeRadiusFor(3))).toBe(1.5);
		expect(badgeRingWidthFor(badgeRadiusFor(28))).toBe(2.5);
		expect(badgeHaloFor(badgeRadiusFor(10))).toBe(2);
		expect(badgeHaloFor(badgeRadiusFor(3))).toBe(1.5);
		expect(badgeHaloFor(badgeRadiusFor(28))).toBe(3);
	});

	it('sizes the still-going-on arrow from the bar, with small floors', () => {
		const arrow = ongoingArrowSize(barThicknessFor(12));
		expect(arrow.half).toBeCloseTo(6.65);
		expect(arrow.length).toBeCloseTo(10.5);
		expect(ongoingArrowSize(2)).toEqual({ half: 6, length: 9 });
	});

	it('makes a span\'s end badge a smaller echo of its start badge, never a speck', () => {
		expect(endBadgeRadiusFor(20)).toBe(12);
		expect(endBadgeRadiusFor(4)).toBe(6);
	});
});

describe('computeTimelineLayout — zoom-aware spreading', () => {
	// Two badges 3 days apart: 30 world px. At zoom 1 that is 30px on screen
	// (clear of two r10 badges + gap), at zoom 0.2 it is 6px (overlapping).
	const close = [point('a', 't1', 10), point('b', 't1', 13)];

	it('leaves badges in place when they have room on screen', () => {
		const { markers } = computeTimelineLayout(close, ['t1'], { ...SPEC, spacing: 100 });
		expect(markers.every((m) => m.fanOffset === 0)).toBe(true);
	});

	it('spreads badges sideways once zooming out would make them overlap', () => {
		const { markers } = computeTimelineLayout(close, ['t1'], { ...SPEC, spacing: 100, alongScale: 0.2 });
		const byId = new Map(markers.map((m) => [m.eventId, m]));
		expect(byId.get('a')?.fanOffset).toBe(-11);
		expect(byId.get('b')?.fanOffset).toBe(11);
	});

	it('reuses a column once it is free again, so a chain only needs two columns', () => {
		// Each neighbour overlaps the next on screen, but a and c do not.
		const chain = [point('a', 't1', 10), point('b', 't1', 11.5), point('c', 't1', 13)];
		const { markers } = computeTimelineLayout(chain, ['t1'], { ...SPEC, spacing: 100 });
		const byId = new Map(markers.map((m) => [m.eventId, m]));
		expect(byId.get('a')?.fanOffset).toBe(byId.get('c')?.fanOffset);
		expect(byId.get('b')?.fanOffset).not.toBe(byId.get('a')?.fanOffset);
	});

	it('packs a span with the badges it overlaps, and puts its badges on the spread line', () => {
		const events = [bar('span', 't1', 10, 30), point('p', 't1', 20)];
		const { bars, markers } = computeTimelineLayout(events, ['t1'], { ...SPEC, spacing: 100 });
		expect(bars[0].fanOffset).not.toBe(markers[0].fanOffset);
		const across = -100 + bars[0].fanOffset;
		expect(bars[0].startCenter).toEqual({ x: 100, y: across });
		expect(bars[0].endCenter).toEqual({ x: 300, y: across });
		expect(bars[0].endRadius).toBe(endBadgeRadiusFor(bars[0].startRadius));
	});

	it('squeezes a wide spread to stay inside its lane, but never past half a badge', () => {
		const pile = ['a', 'b', 'c', 'd', 'e'].map((id) => point(id, 't1', 10));
		const { markers } = computeTimelineLayout(pile, ['t1'], { ...SPEC, spacing: 50 });
		const columns = [...new Set(markers.map((m) => m.fanOffset))].sort((x, y) => x - y);
		// Four columns fit at a half-overlap (step = radius 10); the fifth badge shares one.
		expect(columns).toEqual([-15, -5, 5, 15]);
		for (const m of markers) expect(Math.abs(m.fanOffset) + m.radius).toBeLessThanOrEqual(25);
	});

	it('never spills a busy day onto the next plotline or across the spine', () => {
		const spec = { ...SPEC, spacing: 104, markerRadius: 20, alongScale: 0.15 };
		const busy = Array.from({ length: 12 }, (_, i) => point(`e${i}`, 't2', 10 + i));
		const { markers } = computeTimelineLayout(busy, ['t0', 't1', 't2'], spec);
		for (const m of markers) expect(Math.abs(m.fanOffset) + m.radius).toBeLessThanOrEqual(spec.spacing / 2);
	});

	it('keeps the along-axis paddings the same on screen at any zoom', () => {
		const zoomedOut = computeTimelineLayout([point('a', 't1', 10)], ['t1'], { ...SPEC, alongScale: 0.25 });
		// overhang 14 + badge 10 = 24 screen px = 96 world px at zoom 0.25.
		expect(zoomedOut.tracks[0].line?.start.x).toBe(100 - 96);
		expect(zoomedOut.tracks[0].labelAnchor?.x).toBe(100 - 96 - 24);
	});

	it('treats a broken zoom as 1 rather than dividing by zero', () => {
		const layout = computeTimelineLayout([point('a', 't1', 10)], ['t1'], { ...SPEC, alongScale: 0 });
		expect(layout.tracks[0].line?.start.x).toBe(76);
	});
});

describe('computeTimelineLayout — stitches', () => {
	it('stitches every event straight back to the spine — a fanned marker from its fanned center, a bar from its start edge', () => {
		const events = [point('b', 't1', 10), point('a', 't1', 10), bar('r', 't2', 20, 30)];
		const { stitches } = computeTimelineLayout(events, ['t1', 't2'], SPEC);
		const byId = new Map(stitches.map((s) => [s.eventId, s]));
		expect(byId.get('a')?.from).toEqual({ x: 100, y: -61 });
		expect(byId.get('a')?.to).toEqual({ x: 100, y: 0 });
		expect(byId.get('b')?.from).toEqual({ x: 100, y: -39 });
		expect(byId.get('r')?.from).toEqual({ x: 200, y: 50 });
		expect(byId.get('r')?.to).toEqual({ x: 200, y: 0 });
	});

	it('returns no stitch geometry when the per-timeline toggle is off', () => {
		const events = [point('a', 't1', 10)];
		const { stitches } = computeTimelineLayout(events, ['t1'], { ...SPEC, stitches: false });
		expect(stitches).toEqual([]);
	});
});

describe('computeTimelineLayout — labels', () => {
	it('anchors point labels outward from the marker, away from the spine', () => {
		const events = [point('up', 't1', 10), point('down', 't2', 10)];
		const { labels } = computeTimelineLayout(events, ['t1', 't2'], SPEC);
		const byId = new Map(labels.map((l) => [l.eventId, l]));
		// t1 sits above the spine (side -1): label grows further up (markerRadius 10 + labelGap 6).
		expect(byId.get('up')).toEqual({ eventId: 'up', kind: 'point', anchor: { x: 100, y: -66 }, side: -1 });
		expect(byId.get('down')).toEqual({ eventId: 'down', kind: 'point', anchor: { x: 100, y: 66 }, side: 1 });
	});

	it('anchors bar labels at the bar start, offset past the bar edge', () => {
		const { labels } = computeTimelineLayout([bar('r', 't2', 20, 30)], ['t1', 't2'], SPEC);
		// Clear of the start badge (radius 10), which is wider than half the bar (6).
		expect(labels[0]).toEqual({ eventId: 'r', kind: 'bar', anchor: { x: 200, y: 66 }, side: 1 });
	});

	it('follows a fanned marker to its fanned position', () => {
		const events = [point('a', 't1', 10), point('b', 't1', 10)];
		const { labels } = computeTimelineLayout(events, ['t1'], SPEC);
		const a = labels.find((l) => l.eventId === 'a');
		expect(a?.anchor).toEqual({ x: 100, y: -50 - 11 - 16 });
	});
});

describe('computeTimelineLayout — orientation', () => {
	it('produces the vertical layout as the exact x/y swap of the horizontal one', () => {
		const events = [point('p', 't1', 10), bar('r', 't2', 20, 30)];
		const h = computeTimelineLayout(events, ['t1', 't2'], SPEC);
		const v = computeTimelineLayout(events, ['t1', 't2'], { ...SPEC, orientation: 'vertical' });

		expect(v.spine).toEqual({ start: { x: 0, y: 76 }, end: { x: 0, y: 320 } });
		expect(v.markers[0].center).toEqual({ x: h.markers[0].center.y, y: h.markers[0].center.x });
		expect(v.stitches[0].from).toEqual({ x: h.stitches[0].from.y, y: h.stitches[0].from.x });
		expect(v.labels[0].anchor).toEqual({ x: h.labels[0].anchor.y, y: h.labels[0].anchor.x });
		// The bar rect swaps roles: along-axis length becomes height.
		expect(v.bars[0].rect).toEqual({ x: 44, y: 200, width: 12, height: 100 });
		expect(v.bars[0].endCap).toEqual({ x: 44, y: 296, width: 12, height: BAR_CAP_LENGTH });
	});
});

describe('computeSpineTicks — day granularity', () => {
	it('marks year starts, month starts and plain days distinctly (Gregorian)', () => {
		const ticks = computeSpineTicks(GREGORIAN_CALENDAR, 0, 31, 30);
		expect(ticks[0]).toEqual({ day: 0, label: 'Year 1', kind: 'year' });
		expect(ticks[1].kind).toBe('day');
		expect(ticks[1].label).toBe('2 January, Year 1');
		expect(ticks[31]).toEqual({ day: 31, label: 'February', kind: 'month' });
	});

	it('treats every day-1 as a year start in a monthless calendar', () => {
		const ticks = computeSpineTicks(MONTHLESS_CALENDAR, 0, 2, 30);
		expect(ticks[0]).toEqual({ day: 0, label: 'Year 1', kind: 'year' });
		expect(ticks[1]).toEqual({ day: 1, label: 'Day 2, Year 1', kind: 'day' });
	});
});

describe('computeSpineTicks — month granularity', () => {
	it('emits year chips at year starts and month ticks between them', () => {
		const ticks = computeSpineTicks(TOY_CALENDAR, 0, 30, 5);
		const at = (day: number) => ticks.find((t) => t.day === day);
		expect(at(0)).toEqual({ day: 0, label: 'Year 1', kind: 'year' });
		expect(at(10)).toEqual({ day: 10, label: 'B', kind: 'month' });
		expect(at(30)).toEqual({ day: 30, label: 'Year 2', kind: 'year' });
		expect(ticks.some((t) => t.kind === 'day')).toBe(false);
	});

	it('emits only year chips for a monthless calendar', () => {
		const ticks = computeSpineTicks(MONTHLESS_CALENDAR, 0, 800, 5);
		expect(ticks.length).toBeGreaterThan(0);
		expect(ticks.every((t) => t.kind === 'year')).toBe(true);
		expect(ticks.find((t) => t.day === 365)?.label).toBe('Year 2');
	});
});

describe('computeSpineTicks — year granularity', () => {
	it('emits only year chips when zoomed far out', () => {
		const ticks = computeSpineTicks(TOY_CALENDAR, 0, 90, 1);
		expect(ticks.every((t) => t.kind === 'year')).toBe(true);
		const days = ticks.map((t) => t.day);
		expect(days).toEqual(expect.arrayContaining([0, 30, 60, 90]));
	});

	it('lands era-reset year chips on the right days with the era\'s own numbering', () => {
		const ticks = computeSpineTicks(ERA_CALENDAR, 0, 90, 1);
		const at = (day: number) => ticks.find((t) => t.day === day);
		expect(at(0)?.label).toBe('First 1');
		expect(at(30)?.label).toBe('First 2');
		expect(at(60)?.label).toBe('Second 1');
		expect(at(90)?.label).toBe('Second 2');
	});
});

describe('computeSpineTicks — pinned axis unit', () => {
	// 'auto' is the shipped semantic-zoom behavior; an explicit unit has to
	// override the zoom entirely, in BOTH directions.
	it('forces years even when zoomed close enough for days', () => {
		const ticks = computeSpineTicks(TOY_CALENDAR, 0, 90, 30, 240, 'year');
		expect(ticks.length).toBeGreaterThan(0);
		expect(ticks.every((t) => t.kind === 'year')).toBe(true);
	});

	it('forces months even when zoomed close enough for days', () => {
		const ticks = computeSpineTicks(TOY_CALENDAR, 0, 30, 30, 240, 'month');
		expect(ticks.some((t) => t.kind === 'month')).toBe(true);
		expect(ticks.some((t) => t.kind === 'day')).toBe(false);
	});

	it('forces days even when zoomed far enough out for years', () => {
		const ticks = computeSpineTicks(GREGORIAN_CALENDAR, 0, 40, 0.5, 240, 'day');
		expect(ticks.some((t) => t.kind === 'day')).toBe(true);
		// Year/month starts still upgrade to their own kind inside day mode.
		expect(ticks[0].kind).toBe('year');
	});

	it('matches the zoom-derived result when the unit is auto (or omitted)', () => {
		const omitted = computeSpineTicks(TOY_CALENDAR, 0, 30, 5);
		expect(computeSpineTicks(TOY_CALENDAR, 0, 30, 5, 240, 'auto')).toEqual(omitted);
	});

	it('still honours maxTicks when a unit is pinned', () => {
		const ticks = computeSpineTicks(GREGORIAN_CALENDAR, 0, 100_000, 0.01, 12, 'day');
		expect(ticks).toHaveLength(12);
	});
});

describe('computeSpineTicks — guards', () => {
	it('caps output at maxTicks', () => {
		expect(computeSpineTicks(TOY_CALENDAR, 0, 30000, 1, 5)).toHaveLength(5);
	});

	it('returns nothing for an inverted range or a non-positive zoom', () => {
		expect(computeSpineTicks(TOY_CALENDAR, 10, 0, 5)).toEqual([]);
		expect(computeSpineTicks(TOY_CALENDAR, 0, 10, 0)).toEqual([]);
	});

	it('never loops forever on a degenerate zero-length-year calendar', () => {
		const broken: CalendarDef = { id: 'x', name: 'X', months: [{ name: 'Void', days: 0 }] };
		// yearForAbsoluteDay throws on such calendars before the walker even starts —
		// the point is that this returns (or throws) instead of hanging.
		expect(() => computeSpineTicks(broken, 0, 100, 1)).toThrow();
	});
});

describe('zooming out far enough (regression: 2026-11-03, a 44-year story could not zoom out past four years)', () => {
	const fits = (years: number, viewportPx: number): boolean => {
		const span = years * 365;
		const { scale } = computeTimelineFit([0, span], viewportPx, DEFAULT_LAYOUT_SPEC.pxPerDay, TIMELINE_MIN_ZOOM, TIMELINE_MAX_ZOOM, 1);
		return span * DEFAULT_LAYOUT_SPEC.pxPerDay * scale <= viewportPx;
	};
	it('fits the whole Saltmarch demo (44 years) on a phone-height view', () => {
		expect(fits(44, 500)).toBe(true);
	});
	it('fits a long saga (1,200 years) on a desktop view', () => {
		expect(fits(1200, 800)).toBe(true);
	});
});

describe('computeSpineTicks — year chips thin out when zoomed far out', () => {
	it('keeps every year when there is room, and only round years when there is not', () => {
		const roomy = computeSpineTicks(GREGORIAN_CALENDAR, 0, 365 * 5, 1, 240, 'auto', 48);
		expect(roomy.filter((t) => t.kind === 'year').length).toBeGreaterThanOrEqual(5);
		// 0.01 px/day = 3.65px per year: a 20-year step is the first round step at least 48px apart.
		const far = computeSpineTicks(GREGORIAN_CALENDAR, 0, 365 * 200, 0.01, 240, 'auto', 48);
		const years = far.map((t) => Number(t.label.replace(/\D/g, '')));
		expect(years.length).toBeGreaterThan(3);
		for (const y of years) expect(y % 20).toBe(0);
		for (let i = 1; i < far.length; i++) expect((far[i].day - far[i - 1].day) * 0.01).toBeGreaterThanOrEqual(48);
	});
	it('changes nothing when no gap is asked for (the default)', () => {
		const ticks = computeSpineTicks(GREGORIAN_CALENDAR, 0, 365 * 20, 0.01);
		expect(ticks.length).toBeGreaterThanOrEqual(20);
	});
});

describe('timelineWheelAction (regression: 2026-11-03, a sideways swipe zoomed out instead of scrolling)', () => {
	it('scrolls through time on a sideways swipe or Shift+wheel, never zooms', () => {
		expect(timelineWheelAction(40, 0)).toEqual({ kind: 'pan', by: 40 });
		expect(timelineWheelAction(-120, 3)).toEqual({ kind: 'pan', by: -120 });
	});
	it('does nothing for an empty wheel event', () => {
		expect(timelineWheelAction(0, 0)).toEqual({ kind: 'none' });
	});
	it('zooms out on wheel down and in on wheel up, about 10% per mouse notch', () => {
		const out = timelineWheelAction(0, 100);
		const into = timelineWheelAction(0, -100);
		expect(out.kind === 'zoom' && out.factor).toBeCloseTo(0.86, 2);
		expect(into.kind === 'zoom' && into.factor).toBeCloseTo(1.16, 2);
	});
	it('lets a trackpad\'s small deltas zoom a little each, not a full step', () => {
		const tiny = timelineWheelAction(0, 4);
		expect(tiny.kind === 'zoom' && tiny.factor).toBeGreaterThan(0.99);
	});
	it('turns line-mode deltas into px and caps one event at 2x either way', () => {
		const lines = timelineWheelAction(0, 3, 1);
		expect(lines.kind === 'zoom' && lines.factor).toBeCloseTo(Math.exp(-48 * 0.0015), 5);
		const huge = timelineWheelAction(0, -5000);
		expect(huge.kind === 'zoom' && huge.factor).toBe(2);
	});
});

describe('computeSpineTicks — far zoom-out edge cases', () => {
	it('steps a pinned day or month unit up to years when it could never fit (instead of a blank spine)', () => {
		const ticks = computeSpineTicks(GREGORIAN_CALENDAR, 0, 365 * 500, 0.002, 240, 'month', 48);
		expect(ticks.length).toBeGreaterThan(0);
		expect(ticks.every((t) => t.kind === 'year')).toBe(true);
		expect(computeSpineTicks(GREGORIAN_CALENDAR, 0, 365 * 500, 0.002, 240, 'day', 48).every((t) => t.kind === 'year')).toBe(true);
	});
	it('restarts the count at an era that resets to year 1, and the era start gets its chip', () => {
		// Toy year = 30 days; "Second" starts at absolute year 3. 0.2 px/day = 6px per year, so steps of 10 at a 48px gap.
		const ticks = computeSpineTicks(ERA_CALENDAR, 0, 30 * 60, 0.2, 240, 'auto', 48);
		const labels = ticks.map((t) => t.label);
		expect(labels.some((l) => l.startsWith('Second 1'))).toBe(true);
		for (let i = 1; i < ticks.length; i++) expect((ticks[i].day - ticks[i - 1].day) * 0.2).toBeGreaterThanOrEqual(48);
	});
	it('keeps round steps for years before year 1 and for calendars without months', () => {
		const neg = computeSpineTicks(GREGORIAN_CALENDAR, -365 * 200, 0, 0.01, 240, 'auto', 48);
		for (const t of neg) expect(Math.abs(Number(t.label.replace(/[^\d-]/g, ''))) % 20).toBe(0);
		const flat = computeSpineTicks(MONTHLESS_CALENDAR, 0, 5000, 0.5, 240, 'auto', 48);
		for (let i = 1; i < flat.length; i++) expect((flat[i].day - flat[i - 1].day) * 0.5).toBeGreaterThanOrEqual(48);
	});
});

describe('fitting a view that is not on screen yet (regression: 2026-11-03, the Writers Panel icon showed only the main line)', () => {
	it('a 0×0 view cannot be fitted — the fit would leave the camera on day 0, far from every event', () => {
		const saltmarchDays = [441_000, 457_000];
		expect(computeTimelineFit(saltmarchDays, 0, 3, TIMELINE_MIN_ZOOM, TIMELINE_MAX_ZOOM, 1)).toEqual({ scale: 1, offset: 0 });
		expect(canFitViewport(0, 0)).toBe(false);
		expect(canFitViewport(1200, 0)).toBe(false);
	});
	it('once the view has a size, the fit lands the events on screen', () => {
		expect(canFitViewport(1200, 800)).toBe(true);
		const { scale, offset } = computeTimelineFit([441_000, 457_000], 800, 3, TIMELINE_MIN_ZOOM, TIMELINE_MAX_ZOOM, 1);
		for (const day of [441_000, 457_000]) {
			const y = day * 3 * scale + offset;
			expect(y).toBeGreaterThanOrEqual(0);
			expect(y).toBeLessThanOrEqual(800);
		}
	});
});

describe('computeColumnLayout — events without plotline lanes (2026-11-03)', () => {
	const spec = { ...SPEC, markerRadius: 20, alongScale: 1 };
	const onScreenOverlap = (a: { x: number; y: number }, ra: number, b: { x: number; y: number }, rb: number) =>
		Math.hypot(a.x - b.x, a.y - b.y) < ra + rb;

	it('puts the first event in the column right beside the main line, the next clash on the other side', () => {
		const { markers, tracks } = computeColumnLayout([point('a', 'x', 10), point('b', 'y', 10)], spec);
		expect(tracks).toEqual([]);
		const byId = new Map(markers.map((m) => [m.eventId, m]));
		expect(byId.get('a')?.center.y).toBe(30); // radius 20 + 10, right/below the line
		expect(byId.get('b')?.center.y).toBe(-30);
	});

	it('never lets badges overlap on screen, at any zoom, while the columns have room (4 a side)', () => {
		const many = Array.from({ length: 8 }, (_, i) => point(`e${i}`, 't', i * 2));
		for (const alongScale of [0.05, 0.2, 1, 3]) {
			const { markers } = computeColumnLayout(many, { ...spec, alongScale });
			const screen = markers.map((m) => ({ x: m.center.x * alongScale, y: m.center.y }));
			let clashes = 0;
			for (let i = 0; i < screen.length; i++) for (let j = i + 1; j < screen.length; j++) if (onScreenOverlap(screen[i], 20, screen[j], 20)) clashes++;
			expect(clashes).toBe(0);
		}
	});

	it('keeps a span\'s column until it ends, and marks a still-going one', () => {
		const events: LayoutEvent[] = [
			{ id: 'span', trackId: 't', startDay: 10, endDay: 50, ongoing: true },
			point('during', 't', 30),
		];
		const { bars, markers } = computeColumnLayout(events, spec);
		expect(bars[0].ongoing).toBe(true);
		expect(markers[0].center.y).not.toBe(bars[0].startCenter.y);
		expect(bars[0].endCenter).toEqual({ x: 500, y: bars[0].startCenter.y });
	});

	it('keeps room for a still-going bar’s arrow: nothing lands under it, and the next column clears its width', () => {
		// Bar 30px thick: arrow 45px past the present (day 50 = 500px), 28.5px either side.
		const events: LayoutEvent[] = [
			{ id: 'span', trackId: 't', startDay: 10, endDay: 50, ongoing: true, barThickness: 30 },
			point('after', 't', 56), // its badge starts at 540px — under the arrow tip (545px)
		];
		const { bars, markers } = computeColumnLayout(events, spec);
		expect(markers[0].center.y).not.toBe(bars[0].startCenter.y);
		expect(Math.abs(markers[0].center.y - bars[0].startCenter.y)).toBeGreaterThanOrEqual(28.5 + 20);
	});

	it('draws nothing (and no spine) for no events', () => {
		expect(computeColumnLayout([], spec).spine).toBeNull();
	});
});

describe('computeColumnLayout — a big pile', () => {
	it('beyond 4 columns a side, extra events share a column instead of spreading across the view', () => {
		const spec = { ...SPEC, markerRadius: 20, alongScale: 1 };
		const pile = Array.from({ length: 20 }, (_, i) => point(`p${i}`, 't', 10));
		const { markers } = computeColumnLayout(pile, spec);
		const furthest = Math.max(...markers.map((m) => Math.abs(m.center.y)));
		expect(furthest).toBe(30 + 3 * (2 * 20 + 2 * SPEC.badgeGap));
	});
});
