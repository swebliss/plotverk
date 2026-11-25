// Pure — no Obsidian imports.

/**
 * A setup's marks live only in the setup sheet's own frontmatter, one readable
 * line each, so the writer can see (and even fix) them in Obsidian's
 * properties panel:
 *
 *   storygrid-marks:
 *     - "planted · text:pv-k3f9a2 · Beneath the loose hearthstone lay the sword…"
 *     - "reminded · card:g_1a2b/c_9f8e · The market"
 *     - "paid-off · entity:sg_k2j4 · The duel"
 *
 * Scene files only ever get the tiny `^pv-…` tag; grid and timeline files are
 * never written. Lines Plotverk cannot read (hand edits, a newer version's
 * format) are kept exactly as they are and written back unchanged.
 */

export type SetupStage = 'planted' | 'reminded' | 'paid-off';
/** Where a setup stands, including the writer's own "let it go". */
export type SetupState = SetupStage | 'let-go';

export const SETUP_STAGES: readonly SetupStage[] = ['planted', 'reminded', 'paid-off'];

export type MarkTarget =
	/** A paragraph in a scene, by its block id. */
	| { kind: 'text'; anchor: string }
	/** A grid card, by the grid's and the card's permanent ids. */
	| { kind: 'card'; gridId: string; cardId: string }
	/** A Codex sheet (a timeline event is one), by its `storygrid-id`. */
	| { kind: 'entity'; entityId: string };

export interface SetupMark {
	stage: SetupStage;
	target: MarkTarget;
	/** The marked words as they were when marked — shown if the place is gone. */
	quote: string;
}

/** One stored line: a mark Plotverk understands, or a line kept verbatim. */
export type StoredMarkLine = { mark: SetupMark; raw?: undefined } | { mark?: undefined; raw: string };

const SEP = ' · ';
const QUOTE_MAX = 240;

/** One line of plain text, short enough for a frontmatter list. */
export function cleanQuote(text: string): string {
	const flat = text.replace(/\^pv-[a-z0-9]{6}/g, '').replace(/\s+/g, ' ').trim();
	return flat.length > QUOTE_MAX ? flat.slice(0, QUOTE_MAX - 1).trimEnd() + '…' : flat;
}

export function encodeTarget(t: MarkTarget): string {
	switch (t.kind) {
		case 'text': return `text:${t.anchor}`;
		case 'card': return `card:${t.gridId}/${t.cardId}`;
		case 'entity': return `entity:${t.entityId}`;
	}
}

export function decodeTarget(s: string): MarkTarget | null {
	const m = /^(text|card|entity):(.+)$/.exec(s.trim());
	if (!m) return null;
	const value = m[2].trim();
	if (!value) return null;
	if (m[1] === 'text') return /^[A-Za-z0-9-]+$/.test(value) ? { kind: 'text', anchor: value } : null;
	if (m[1] === 'entity') return { kind: 'entity', entityId: value };
	const slash = value.indexOf('/');
	if (slash <= 0 || slash === value.length - 1) return null;
	return { kind: 'card', gridId: value.slice(0, slash), cardId: value.slice(slash + 1) };
}

export function encodeMark(mark: SetupMark): string {
	const quote = cleanQuote(mark.quote);
	return quote ? [mark.stage, encodeTarget(mark.target), quote].join(SEP) : [mark.stage, encodeTarget(mark.target)].join(SEP);
}

export function decodeMark(line: string): SetupMark | null {
	if (typeof line !== 'string') return null;
	const first = line.indexOf(SEP);
	if (first === -1) return null;
	const stage = line.slice(0, first).trim();
	if (!(SETUP_STAGES as readonly string[]).includes(stage)) return null;
	const rest = line.slice(first + SEP.length);
	const second = rest.indexOf(SEP);
	const targetText = second === -1 ? rest : rest.slice(0, second);
	const target = decodeTarget(targetText);
	if (!target) return null;
	const quote = second === -1 ? '' : rest.slice(second + SEP.length).trim();
	return { stage: stage as SetupStage, target, quote };
}

/**
 * Read the frontmatter value (Obsidian gives a list, a single string, or
 * nothing). Every line is kept — unreadable ones as `raw`.
 */
export function readMarkLines(value: unknown): StoredMarkLine[] {
	const list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
	return list.map((item) => {
		const raw = String(item ?? '');
		const mark = decodeMark(raw);
		return mark ? { mark } : { raw };
	});
}

export function writeMarkLines(lines: readonly StoredMarkLine[]): string[] {
	return lines.map((l) => (l.mark ? encodeMark(l.mark) : l.raw));
}

export function marksOf(lines: readonly StoredMarkLine[]): SetupMark[] {
	return lines.flatMap((l) => (l.mark ? [l.mark] : []));
}

export function sameTarget(a: MarkTarget, b: MarkTarget): boolean {
	return encodeTarget(a) === encodeTarget(b);
}

/** The very same mark: same stage, same place, same words. */
export function sameMark(a: SetupMark, b: SetupMark): boolean {
	return encodeMark(a) === encodeMark(b);
}

/**
 * Add a mark. The very same mark twice changes nothing. Anything else is
 * added, even at a place that already has a mark: one paragraph can hold the
 * plant in one sentence and a reminder in the next, and a tag marks the whole
 * paragraph — so an earlier mark is never replaced or lost.
 */
export function addMark(lines: readonly StoredMarkLine[], mark: SetupMark): StoredMarkLine[] {
	if (lines.some((l) => l.mark && sameMark(l.mark, mark))) return [...lines];
	return [...lines, { mark }];
}

/**
 * Take a plan off a card or event: every mark of that stage at that place,
 * whatever words it was marked with (a renamed card planned twice leaves two
 * quotes). Text marks are never touched here.
 */
export function removePlanMarks(lines: readonly StoredMarkLine[], plan: SetupMark): StoredMarkLine[] {
	if (!isPlanned(plan)) return [...lines];
	return lines.filter((l) => !(l.mark && l.mark.stage === plan.stage && sameTarget(l.mark.target, plan.target)));
}

/** Remove one mark (the "Remove this mark" action on the sheet). */
export function removeMark(lines: readonly StoredMarkLine[], mark: SetupMark): StoredMarkLine[] {
	return lines.filter((l) => !(l.mark && sameMark(l.mark, mark)));
}

/**
 * A mark on a grid card or a timeline event is a PLAN ("pay it off here");
 * a mark in the text is WRITTEN — the reader actually sees it.
 */
export function isPlanned(mark: SetupMark): boolean {
	return mark.target.kind !== 'text';
}

/**
 * Where the setup stands. "Let it go" is the writer's own choice and wins;
 * otherwise the furthest stage WRITTEN in the text — a payoff, then a
 * reminder, then a plant. Plans on cards and events never move it. A setup
 * with nothing written counts as planted (made from the Codex or only
 * planned so far).
 */
export function setupState(marks: readonly SetupMark[], letGo: boolean): SetupState {
	if (letGo) return 'let-go';
	const written = marks.filter((m) => !isPlanned(m));
	if (written.some((m) => m.stage === 'paid-off')) return 'paid-off';
	if (written.some((m) => m.stage === 'reminded')) return 'reminded';
	return 'planted';
}

/** Open = still waiting for its payoff (planted or reminded, not let go). */
export function isOpenState(state: SetupState): boolean {
	return state === 'planted' || state === 'reminded';
}

/** `storygrid-pays-off` → does it pay off in this book (the default) or a later one? */
export function paysOffLater(value: unknown): boolean {
	return String(value ?? '').trim().toLowerCase() === 'later-book';
}

/** `storygrid-let-go` → true when the writer chose "Let it go". */
export function isLetGo(value: unknown): boolean {
	return value === true || String(value ?? '').trim().toLowerCase() === 'true';
}

/** `storygrid-linked-ids` → the linked Codex entries' ids, in order, no blanks or doubles. */
export function readLinkedIds(value: unknown): string[] {
	const list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
	const out: string[] = [];
	for (const item of list) {
		const id = String(item ?? '').trim();
		if (id && !out.includes(id)) out.push(id);
	}
	return out;
}

// ─── Book order ─────────────────────────────────────────────────────────────

/**
 * Where a mark sits in the book, once resolved by the live index: the scene's
 * position in the book's scene order (0-based) and the line in that scene.
 * `null` = not in the book yet (a card with no scene, a missing place).
 */
export interface BookPlace {
	sceneIndex: number;
	line: number;
}

export function compareBookPlace(a: BookPlace | null, b: BookPlace | null): number {
	if (a && b) return a.sceneIndex - b.sceneIndex || a.line - b.line;
	if (a) return -1;
	if (b) return 1;
	return 0;
}

/** Marks in book order; places not in the book go last, in the order they were marked. */
export function orderMarks<T extends { place: BookPlace | null }>(marks: readonly T[]): T[] {
	return marks
		.map((m, i) => ({ m, i }))
		.sort((x, y) => compareBookPlace(x.m.place, y.m.place) || x.i - y.i)
		.map((x) => x.m);
}

/**
 * How many chapters a still-open setup has waited since it was last written
 * about: from the last placed mark to the furthest chapter the writer has
 * written. Null when nothing is placed in the book yet.
 */
export function chaptersSinceLastMark(lastChapter: number | null, currentChapter: number | null): number | null {
	if (lastChapter == null || currentChapter == null) return null;
	return Math.max(0, currentChapter - lastChapter);
}
