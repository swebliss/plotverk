import { parseStoryDateJson } from './field-types';

/**
 * The editing rules of the story-date field, as pure functions with no DOM.
 *
 * The widget used to parse the saved value once, when it was drawn, and build
 * every later edit from that frozen copy. Typing a year and then a month made
 * the month edit see "no year", so it wrote an empty date and the writer's year
 * vanished. The widget now keeps a `StoryDateDraft` and runs every keystroke
 * through `applyStoryDateEdit(draft, edit)`, which returns the next draft AND
 * the string to save — so what is typed is what is kept.
 */

export interface StoryDateDraft {
	era: string;
	year: number | null;
	month: number | null;
	day: number | null;
	/** Time of day. The widget has no box for it, but a date set elsewhere (the Timeline) may carry one, and an edit here must not drop it. */
	minute: number | null;
}

export type StoryDateEdit = Partial<Pick<StoryDateDraft, 'era' | 'year' | 'month' | 'day'>>;

export interface StoryDateLimits {
	maxMonth: number;
	maxDay: number;
}

/**
 * Bounds used when the widget cannot see the project's calendar. 12 and 31 are
 * the widest a month number / day number can honestly be across the calendars
 * this plugin supports; they only stop an obviously wrong number, they do not
 * validate against a specific calendar.
 */
export const DEFAULT_STORYDATE_LIMITS: StoryDateLimits = { maxMonth: 12, maxDay: 31 };

export const EMPTY_STORYDATE_DRAFT: StoryDateDraft = { era: '', year: null, month: null, day: null, minute: null };

/** The draft for a saved value. A blank or unreadable value gives an empty draft. */
export function draftFromValue(value: string): StoryDateDraft {
	const parsed = parseStoryDateJson(value);
	if (!parsed) return { ...EMPTY_STORYDATE_DRAFT };
	return {
		era: parsed.era ?? '',
		year: parsed.year,
		month: parsed.month ?? null,
		day: parsed.day ?? null,
		minute: parsed.minute ?? null,
	};
}

/**
 * Read a number box's text. Empty — and anything that is not a finite number,
 * which is what a half-typed "-" or "e" reads as — means "no value", never 0.
 * Whole numbers only: a story year or day has no fraction.
 */
export function numberFromInput(raw: string): number | null {
	if (raw.trim() === '') return null;
	const n = Number(raw);
	return Number.isFinite(n) ? Math.trunc(n) : null;
}

function clampInto(value: number | null | undefined, max: number): number | null {
	if (value === null || value === undefined) return null;
	return Math.min(max, Math.max(1, value));
}

/**
 * Apply one edit to the draft.
 *
 * - Fields the edit does not mention keep their drafted value — including month
 *   and day while the year box is momentarily empty, so retyping the year brings
 *   them back instead of finding them gone.
 * - A month or day being typed is pulled into 1..max (the number boxes' own
 *   min/max stop only the spinner, not typing); the year is not bounded —
 *   negative years are real. Parts the edit does not touch are never altered.
 * - The saved value is '' when there is no year (a date needs one), otherwise the
 *   JSON the field stores. Unset parts are left out of it, not written as null.
 */
export function applyStoryDateEdit(
	draft: StoryDateDraft,
	edit: StoryDateEdit,
	limits: StoryDateLimits = DEFAULT_STORYDATE_LIMITS
): { draft: StoryDateDraft; value: string } {
	const next: StoryDateDraft = {
		era: edit.era !== undefined ? edit.era : draft.era,
		year: edit.year !== undefined ? edit.year : draft.year,
		// Only the part being typed is bounded. A stored month 13 (a 13-month
		// calendar, set from the Timeline) must survive an edit to the year.
		month: edit.month !== undefined ? clampInto(edit.month, limits.maxMonth) : draft.month,
		day: edit.day !== undefined ? clampInto(edit.day, limits.maxDay) : draft.day,
		minute: draft.minute,
	};
	return { draft: next, value: storyDateValue(next) };
}

/** The string a field stores for a draft: '' until there is a year. */
export function storyDateValue(draft: StoryDateDraft): string {
	if (draft.year === null) return '';
	const era = draft.era.trim();
	return JSON.stringify({
		era: era || undefined,
		year: draft.year,
		month: draft.month ?? undefined,
		day: draft.day ?? undefined,
		minute: draft.minute ?? undefined,
	});
}
