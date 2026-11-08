// Reads dateable codex entities (Event sheets, Character Born/Died) for a
// project's Timeline view. metadataCache only — no disk reads.

import { App, TFile } from 'obsidian';
import { GREGORIAN_CALENDAR, parseStoryDate, storyDateToAbsoluteDay } from './calendar';
import type { CalendarDef, StoryDate } from './timeline-data';
import { EVENT_HOW_LONG } from '../entities/entity-kinds';

/** 'era' = an Event sheet whose How Long is "An era": a soft band behind the timeline, never a badge or bar (see timeline-eras.ts). */
export type TimelineEventKind = 'event' | 'era' | 'character-born' | 'character-died';

export interface TimelineEvent {
	/** Unique per rendered dot — a character contributes up to two (born/died) from one file. */
	id: string;
	/** The codex note path — the key into TimelineData.eventDisplay. Shared by a character's born/died pair. */
	notePath: string;
	name: string;
	date: StoryDate;
	/**
	 * Optional end date — present only when the Event sheet's `end-date`
	 * frontmatter parses AND is on/after `date` (day-compared via the
	 * project's calendar). An end date with no start, or an end date before
	 * the start, is dropped upstream (classifyEntity/collectTimelineData) —
	 * this field is never invalid to consume. Only ever set for kind 'event'.
	 */
	end?: StoryDate;
	/** "Lasts a while" with no End Date: still going on — drawn as a bar up to the story's present (storyPresentDay). Never set together with `end`. */
	ongoing?: boolean;
	kind: TimelineEventKind;
	file: TFile;
}

/**
 * An Event sheet with no parseable `date` — a writer who hasn't decided when
 * something happens yet, not an error. Character born/died stay date-only:
 * an undated birth/death has nothing meaningful to show on the Undated shelf.
 */
export interface UndatedTimelineEvent {
	notePath: string;
	name: string;
	file: TFile;
}

export interface TimelineCollection {
	dated: TimelineEvent[];
	undated: UndatedTimelineEvent[];
	/** Dated eras (kind 'era') — kept apart from `dated` so nothing that lays out badges and bars ever sees them. An undated era sits on the Undated shelf like any event. */
	eras: TimelineEvent[];
}

function inProjectScope(path: string, projectRoot: string): boolean {
	if (!projectRoot) return true;
	return path === projectRoot || path.startsWith(projectRoot + '/');
}

/** Pure classification of one Codex sheet's `storygrid-type` + dateable raw frontmatter values — no Obsidian imports, so the dated/undated split is unit-testable without a metadataCache. */
export type EntityClassification =
	| { bucket: 'dated-event'; date: StoryDate; end?: StoryDate; ongoing?: boolean; era?: boolean }
	| { bucket: 'undated-event' }
	| { bucket: 'character'; born: StoryDate | null; died: StoryDate | null }
	| { bucket: 'skip' };

/**
 * An Event sheet's "How Long" answer (frontmatter `how-long`): 'moment',
 * 'lasting' or 'era'. Left empty (or anything unrecognised) it follows the
 * sheet: an End Date means it lasts, none means a moment — so sheets written
 * before the field existed keep drawing exactly as they did.
 */
export function eventDurationFrom(howLongRaw: unknown, hasEndDate: boolean): 'moment' | 'lasting' | 'era' {
	const v = typeof howLongRaw === 'string' ? howLongRaw.trim().toLowerCase() : '';
	if (v === EVENT_HOW_LONG.moment.toLowerCase()) return 'moment';
	if (v === EVENT_HOW_LONG.lasting.toLowerCase()) return 'lasting';
	if (v === EVENT_HOW_LONG.era.toLowerCase()) return 'era';
	return hasEndDate ? 'lasting' : 'moment';
}

/**
 * Given a sheet's `storygrid-type` and its raw `date`/`born`/`died`/`end-date`
 * frontmatter values (as `getFileCache().frontmatter` hands them over —
 * untyped), decide where it belongs. An Event sheet with a missing or
 * unparseable `date` is 'undated-event', not skipped — that's what feeds the
 * Undated shelf. A Character sheet's `born`/`died` stay date-only: one with
 * neither parses is simply a character with nothing to show on the Timeline.
 *
 * `endRaw` only ever produces an `end` on a 'dated-event' — an end date with
 * no start date is meaningless and is silently dropped (never even reaches
 * this function's end-date handling, since the whole branch requires `date`
 * to have parsed first). An end date before the start (day-compared via
 * `calendar`) is also dropped, so the event renders as a point, never an
 * error and never swapped. `calendar` defaults to Gregorian so existing
 * 4-arg call sites keep parsing exactly as before.
 */
export function classifyEntity(
	kind: unknown,
	dateRaw: unknown,
	bornRaw: unknown,
	diedRaw: unknown,
	endRaw?: unknown,
	calendar: CalendarDef = GREGORIAN_CALENDAR,
	howLongRaw?: unknown,
): EntityClassification {
	if (kind === 'event') {
		const date = typeof dateRaw === 'string' ? parseStoryDate(dateRaw) : null;
		if (!date) return { bucket: 'undated-event' };
		const endParsed = typeof endRaw === 'string' ? parseStoryDate(endRaw) : null;
		const validEnd = endParsed && storyDateToAbsoluteDay(calendar, endParsed) >= storyDateToAbsoluteDay(calendar, date) ? endParsed : null;
		// "A moment" wins over a leftover End Date; "Lasts a while" with an
		// EMPTY End Date is still going on. One that is filled in but unusable
		// (unreadable, or before the start) is not "ongoing" — the sheet shows
		// an end — so it draws as the moment it was before How Long existed.
		const duration = eventDurationFrom(howLongRaw, !!validEnd);
		if (duration === 'moment') return { bucket: 'dated-event', date };
		// An era follows the same End Date rule as "Lasts a while" — it just draws as a band.
		const era = duration === 'era' ? { era: true } : {};
		if (validEnd) return { bucket: 'dated-event', date, end: validEnd, ...era };
		const endTyped = typeof endRaw === 'string' ? endRaw.trim() !== '' : endRaw != null;
		return endTyped ? { bucket: 'dated-event', date, ...era } : { bucket: 'dated-event', date, ongoing: true, ...era };
	}
	if (kind === 'character') {
		return {
			bucket: 'character',
			born: typeof bornRaw === 'string' ? parseStoryDate(bornRaw) : null,
			died: typeof diedRaw === 'string' ? parseStoryDate(diedRaw) : null,
		};
	}
	return { bucket: 'skip' };
}

/**
 * Every dateable entity in a project: Event sheets' `date`/`end-date` fields,
 * and Character sheets' `born`/`died` fields (slugForLabel('Date') = 'date',
 * slugForLabel('End Date') = 'end-date', slugForLabel('Born') = 'born',
 * slugForLabel('Died') = 'died' — see entities/field-types.ts:slugForLabel).
 * Event sheets with no parseable date come back separately in `undated`, for
 * the Timeline's Undated shelf. `calendar` drives the end-before-start check
 * in classifyEntity — pass the project's own calendar, not Gregorian, unless
 * the project genuinely uses Gregorian.
 */
export function collectTimelineData(app: App, projectRoot: string, calendar: CalendarDef = GREGORIAN_CALENDAR): TimelineCollection {
	const dated: TimelineEvent[] = [];
	const undated: UndatedTimelineEvent[] = [];
	const eras: TimelineEvent[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (!inProjectScope(file.path, projectRoot)) continue;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;

		const result = classifyEntity(fm['storygrid-type'], fm['date'], fm['born'], fm['died'], fm['end-date'], calendar, fm['how-long']);
		switch (result.bucket) {
			case 'dated-event':
				if (result.era) eras.push({ id: `era:${file.path}`, notePath: file.path, name: file.basename, date: result.date, end: result.end, ongoing: result.ongoing, kind: 'era', file });
				else dated.push({ id: file.path, notePath: file.path, name: file.basename, date: result.date, end: result.end, ongoing: result.ongoing, kind: 'event', file });
				break;
			case 'undated-event':
				undated.push({ notePath: file.path, name: file.basename, file });
				break;
			case 'character':
				if (result.born) dated.push({ id: `${file.path}#born`, notePath: file.path, name: `${file.basename} — born`, date: result.born, kind: 'character-born', file });
				if (result.died) dated.push({ id: `${file.path}#died`, notePath: file.path, name: `${file.basename} — died`, date: result.died, kind: 'character-died', file });
				break;
			case 'skip':
				break;
		}
	}
	return { dated, undated, eras };
}

/**
 * True when the Timeline should show its ghost-content empty state — neither
 * a dated dot nor an Undated-shelf chip to show. A shelf with items means the
 * view isn't empty, even with zero dated events.
 */
export function isTimelineEmpty(datedCount: number, undatedCount: number): boolean {
	return datedCount === 0 && undatedCount === 0;
}

/** Frontmatter keys tried, in order, for an event's one-line summary (the clean-slate sheet's Description, then the guided sheet's What Happened). */
const SUMMARY_KEYS = ['description', 'what-happened', 'synopsis', 'summary'];

/**
 * First readable line of an event sheet's description, for the timeline's
 * hover/tap card. Reads frontmatter only (metadataCache already holds it, so
 * no file read), turns [[Link|Alias]] into its visible words, and trims to
 * `max` characters on a word boundary. Empty string when there is nothing.
 */
export function eventSummaryFromFrontmatter(fm: Record<string, unknown> | undefined, max = 140): string {
	if (!fm) return '';
	for (const key of SUMMARY_KEYS) {
		const raw = fm[key];
		if (typeof raw !== 'string') continue;
		const line = raw
			.split(/\r?\n/)
			.map((l) => l
				.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
				.replace(/\[\[([^\]]+)\]\]/g, '$1')
				.replace(/[*_`]/g, '')
				.trim())
			.find((l) => l.length > 0);
		if (!line) continue;
		if (line.length <= max) return line;
		const cut = line.slice(0, max);
		const space = cut.lastIndexOf(' ');
		return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
	}
	return '';
}

/**
 * The story's present, as an absolute day: the latest chapter date the
 * timeline knows (`sceneDates`), else the latest date any event reaches.
 * Ongoing events ("Lasts a while" with no End Date) run up to here, so their
 * bars stretch by themselves as chapters move on. Undefined with nothing dated.
 */
export function storyPresentDay(calendar: CalendarDef, sceneDates: Record<string, StoryDate>, events: Array<{ date: StoryDate; end?: StoryDate }>): number | undefined {
	return storyPresent(calendar, sceneDates, events)?.day;
}

/** storyPresentDay plus the date it came from, exactly as written (a year-only chapter date stays year-only on the card). */
export function storyPresent(calendar: CalendarDef, sceneDates: Record<string, StoryDate>, events: Array<{ date: StoryDate; end?: StoryDate }>): { day: number; date: StoryDate } | undefined {
	const latest = (dates: StoryDate[]): { day: number; date: StoryDate } | undefined => {
		let best: { day: number; date: StoryDate } | undefined;
		for (const date of dates) {
			const day = storyDateToAbsoluteDay(calendar, date);
			if (!best || day > best.day) best = { day, date };
		}
		return best;
	};
	return latest(Object.values(sceneDates)) ?? latest(events.flatMap((e) => [e.date, ...(e.end ? [e.end] : [])]));
}
