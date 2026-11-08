// Eras on the Story Timeline — pure TypeScript, no Obsidian imports.
// An era is an Event sheet whose How Long is "An era" (EVENT_HOW_LONG.era):
// a soft, translucent colour band behind everything, across its years and
// the full width of the timeline, its name in a calm label at the band's
// start edge. Eras are never badges or bars and never take a column.

import { EVENT_HOW_LONG } from '../entities/entity-kinds';
import type { CalendarDef } from './timeline-data';
import { absoluteYearOfDay, yearStartDay } from './timeline-range';
import type { LayoutRect } from './timeline-layout';

/** True when a sheet's How Long (frontmatter `how-long`) says "An era". */
export function isEraHowLong(howLongRaw: unknown): boolean {
	return typeof howLongRaw === 'string' && howLongRaw.trim().toLowerCase() === EVENT_HOW_LONG.era.toLowerCase();
}

/**
 * Where an era's band stops, as an absolute day: its End Date; still going
 * on (no End Date) → the story's present; and when there is no present yet,
 * or the era starts at/after it, the end of its first year — a band always
 * has some length, so it never shrinks to an invisible line.
 */
export function eraEndDay(calendar: CalendarDef, startDay: number, endDay: number | undefined, presentDay: number | undefined): number {
	if (endDay !== undefined && endDay > startDay) return endDay;
	if (endDay === undefined && presentDay !== undefined && presentDay > startDay) return presentDay;
	return yearStartDay(calendar, absoluteYearOfDay(calendar, startDay) + 1);
}

/** Starting strength of a band's colour. Kept low: an era is a mood behind the story, not a block over it. */
export const ERA_BAND_OPACITY = 0.16;
/** Weakest a band gets when many eras overlap — still there, never gone. */
export const ERA_BAND_MIN_OPACITY = 0.07;

export interface EraSpan {
	id: string;
	startDay: number;
	/** Exclusive end — see eraEndDay. */
	endDay: number;
}

export interface EraBand extends EraSpan {
	/** Most eras (this one included) covering any single day of this era. */
	depth: number;
	/** Fill opacity: ERA_BAND_OPACITY softened by how many eras overlap it. */
	opacity: number;
	/** Label line: 0 for the first, then one line further for each overlapping era that already has a label line. */
	labelSlot: number;
}

const overlaps = (a: EraSpan, b: EraSpan): boolean => a.startDay < b.endDay && b.startDay < a.endDay;

/**
 * Overlapping eras share the full width, each one SOFTER (opacity divided by
 * √depth) rather than split into side-by-side strips: strips would cut
 * through the events' columns and make the background busy, while two soft
 * washes simply blend — the shared years read as "both ages at once" and the
 * overlap never gets much darker than one band. Labels of overlapping eras
 * get their own lines (labelSlot) so two names never sit on top of each other.
 * Bands come back in paint order: longer first, so a short era painted later
 * is never hidden under a long one's label area.
 */
export function layoutEraBands(eras: EraSpan[]): EraBand[] {
	const valid = eras.filter((e) => Number.isFinite(e.startDay) && Number.isFinite(e.endDay) && e.endDay > e.startDay);
	const order = [...valid].sort((a, b) => a.startDay - b.startDay || (b.endDay - b.startDay) - (a.endDay - a.startDay) || a.id.localeCompare(b.id));
	const slots = new Map<string, number>();
	for (const era of order) {
		const taken = new Set(order.filter((o) => o !== era && slots.has(o.id) && overlaps(o, era)).map((o) => slots.get(o.id)!));
		let slot = 0;
		while (taken.has(slot)) slot++;
		slots.set(era.id, slot);
	}
	const bands = order.map((era) => {
		const others = valid.filter((o) => o !== era && overlaps(o, era));
		// Deepest point of the era: a day where most eras are under way at once
		// — always one of the start days inside it (its own, or another's).
		const probes = [era.startDay, ...others.map((o) => o.startDay).filter((d) => d > era.startDay && d < era.endDay)];
		const depth = Math.max(...probes.map((d) => 1 + others.filter((o) => o.startDay <= d && d < o.endDay).length));
		const opacity = Math.max(ERA_BAND_MIN_OPACITY, ERA_BAND_OPACITY / Math.sqrt(depth));
		return { ...era, depth, opacity, labelSlot: slots.get(era.id) ?? 0 };
	});
	return bands.sort((a, b) => (b.endDay - b.startDay) - (a.endDay - a.startDay));
}

/**
 * The band's rect in world px: its days along time (start to end), and the
 * full width across. Across px are screen px (the camera only stretches
 * time), so `acrossHalf` is simply "wider than any screen".
 */
export function eraBandRect(band: { startDay: number; endDay: number }, pxPerDay: number, orientation: 'horizontal' | 'vertical', acrossHalf = 20000): LayoutRect {
	const along = band.startDay * pxPerDay;
	const length = Math.max(0, (band.endDay - band.startDay) * pxPerDay);
	return orientation === 'horizontal'
		? { x: along, y: -acrossHalf, width: length, height: 2 * acrossHalf }
		: { x: -acrossHalf, y: along, width: 2 * acrossHalf, height: length };
}

/** On-screen height of one label line (px). */
export const ERA_LABEL_LINE = 18;
/** Gap between a band's start edge (or the view's edge) and its label (px). */
export const ERA_LABEL_PAD = 8;

/**
 * Where an era's name sits along time, in on-screen px: just inside the
 * band's start edge — and once that edge has scrolled out of view, held at
 * the view's edge so the name stays readable while any of the era shows.
 * `labelLength` is the label's extent along time (its width when time runs
 * sideways, one line's height when it runs down). Null when the visible part
 * of the band is too short to hold the label inside it.
 */
export function eraLabelAlong(
	bandStart: number,
	bandEnd: number,
	viewStart: number,
	labelLength: number,
	slotOffset = 0,
): number | null {
	const at = Math.max(bandStart, viewStart) + ERA_LABEL_PAD + slotOffset;
	if (at + labelLength > bandEnd - ERA_LABEL_PAD / 2) return null;
	return at;
}

/**
 * A gentle colour for an era that has none on its sheet: picked from a soft
 * palette by its name, so it is the same every time and two eras rarely
 * match. Mid-tones, so a 16% wash shows on white and on a dark theme alike.
 */
export const ERA_DEFAULT_COLORS = ['#7fa7d9', '#a99bd6', '#8fbf8a', '#d9b27a', '#d99a9a', '#7fbfbf'] as const;
export function defaultEraColor(key: string): string {
	let h = 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
	return ERA_DEFAULT_COLORS[h % ERA_DEFAULT_COLORS.length];
}

export interface EraLabelInput {
	id: string;
	/** The band's start and end along time, on screen (px). */
	start: number;
	end: number;
	/** From layoutEraBands: overlapping eras have different slots. */
	slot: number;
	/** The label's extent along time (px): its width when time runs sideways, one line when it runs down. */
	length: number;
}

/** Where a label goes: along time (on-screen px) and which row across (0 = nearest the view's edge). */
export interface EraLabelSpot {
	along: number;
	row: number;
}

/**
 * Every era's label, kept inside its own band and clear of the others.
 * Time running sideways: overlapping eras' names sit on separate rows (their
 * slot). Time running down: they share the left edge, so a name that would
 * land on another's line moves one line further down its own band — and is
 * left out (null) when that pushes it past the band's visible end.
 */
export function placeEraLabels(labels: EraLabelInput[], viewStart: number, stack: 'rows' | 'lines'): Map<string, EraLabelSpot | null> {
	const out = new Map<string, EraLabelSpot | null>();
	const placed: Array<{ along: number; length: number }> = [];
	const order = [...labels].sort((a, b) => a.slot - b.slot || a.start - b.start || a.id.localeCompare(b.id));
	for (const l of order) {
		let along = eraLabelAlong(l.start, l.end, viewStart, l.length);
		if (along !== null && stack === 'lines') {
			// Bump past any name already on (or overlapping) this line, until clear.
			for (let guard = 0; guard < placed.length + 1; guard++) {
				const hit = placed.find((p) => along! < p.along + p.length && p.along < along! + l.length);
				if (!hit) break;
				along = hit.along + hit.length;
				if (along + l.length > l.end - ERA_LABEL_PAD / 2) { along = null; break; }
			}
		}
		out.set(l.id, along === null ? null : { along, row: stack === 'rows' ? l.slot : 0 });
		if (along !== null && stack === 'lines') placed.push({ along, length: l.length });
	}
	return out;
}
