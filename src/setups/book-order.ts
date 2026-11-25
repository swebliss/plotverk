// Pure — no Obsidian imports.
import { SETUP_STAGES, SetupMark, SetupStage, SetupState, isPlanned } from './setup-marks';

/**
 * Chapters for setups. A "chapter" is one scene document in the book's order
 * (the Writing tab's list — the same count the Dashboard uses), numbered from 1.
 * A mark finds its chapter through the place it points at:
 * - text → the note holding the paragraph's tag;
 * - grid card → the scene the card is linked to;
 * - Codex sheet (a timeline event) → the first scene that links to it.
 * A place outside the book (a card with no scene yet, a deleted paragraph)
 * has no chapter, and is never guessed.
 */
export interface PlaceLookups {
	/** The note that holds a tag now, or null when the paragraph is gone. */
	anchorPath(anchor: string): string | null;
	/** The scene a grid card is linked to (null: none, or no such card). */
	cardScene(gridId: string, cardId: string): string | null;
	/** Notes that link to a Codex entry. */
	entityScenes(entityId: string): readonly string[];
	/** The chapter number of a note (1-based), or null when it is not in the book. */
	chapterOf(path: string): number | null;
	/** The grid file with this grid id (to jump to a planned card). */
	gridPath?(gridId: string): string | null;
}

/** 1-based chapter numbers from the book's ordered scene paths. */
export function chapterNumbers(orderedPaths: readonly string[]): Map<string, number> {
	const out = new Map<string, number>();
	orderedPaths.forEach((p, i) => {
		if (!out.has(p)) out.set(p, i + 1);
	});
	return out;
}

/** The note a mark points at, if it can be found. */
export function markNote(mark: SetupMark, lk: PlaceLookups): string | null {
	const t = mark.target;
	if (t.kind === 'text') return lk.anchorPath(t.anchor);
	if (t.kind === 'card') return lk.cardScene(t.gridId, t.cardId);
	let best: { path: string; ch: number } | null = null;
	for (const path of lk.entityScenes(t.entityId)) {
		const ch = lk.chapterOf(path);
		if (ch !== null && (!best || ch < best.ch)) best = { path, ch };
	}
	return best?.path ?? null;
}

export function markChapter(mark: SetupMark, lk: PlaceLookups): number | null {
	const note = markNote(mark, lk);
	return note === null ? null : lk.chapterOf(note);
}

/** One stage of a setup: where it is planned (cards, events) and where it is written (text). */
export interface StageProgress {
	planned: SetupMark[];
	written: SetupMark[];
	/** Realized = written in the text somewhere. */
	realized: boolean;
}

/** Every stage's planned and written places, in the order they were marked. */
export function stageProgress(marks: readonly SetupMark[]): Record<SetupStage, StageProgress> {
	const out = {} as Record<SetupStage, StageProgress>;
	for (const stage of SETUP_STAGES) {
		const own = marks.filter((m) => m.stage === stage);
		const written = own.filter((m) => !isPlanned(m));
		out[stage] = { planned: own.filter(isPlanned), written, realized: written.length > 0 };
	}
	return out;
}

/**
 * A plan came true where it was planned: the same stage is written in the
 * text of the scene its card is linked to (or, for a timeline event, the
 * first scene that links to it). A place with no scene is never realized here.
 */
export function realizedHere(plan: SetupMark, marks: readonly SetupMark[], lk: PlaceLookups): boolean {
	if (!isPlanned(plan)) return false;
	const scene = markNote(plan, lk);
	if (scene === null) return false;
	return marks.some((m) => m.stage === plan.stage && !isPlanned(m) && markNote(m, lk) === scene);
}

/** The next planned step: "Payoff planned for Chapter 12" (or for the card's name when it has no chapter). */
export interface NextPlan {
	stage: SetupStage;
	chapter: number | null;
	/** The card's or event's name as marked. */
	label: string;
}

export interface SetupSummary {
	/** Chapter of the WRITTEN mark that decides the stage line ("Reminded in Chapter 14"). */
	stageChapter: number | null;
	/** Earliest written plant's chapter. */
	plantedChapter: number | null;
	/** Latest chapter that writes about it in the text (any stage). */
	lastChapter: number | null;
	/** The stage a setup was at before its current one, from its marks (for "Moved here from …"). */
	previousStage: SetupStage | null;
	/** Is anything written in the text yet? False = only planned (or not marked at all). */
	writtenYet: boolean;
	/** The nearest stage that is planned but not written yet; null once paid off or let go. */
	nextPlan: NextPlan | null;
}

const minOf = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const maxOf = (xs: number[]) => (xs.length ? Math.max(...xs) : null);

/**
 * What the card and sheet say about where a setup stands. Chapters come from
 * the text only: the stage line uses the written mark that put it there (the
 * earliest plant for Planted, the latest reminder for Reminded, the payoff
 * for Paid off). Plans on cards and events only feed `nextPlan`.
 */
export function summarizeSetup(marks: readonly SetupMark[], state: SetupState, lk: PlaceLookups): SetupSummary {
	const written = marks.filter((m) => !isPlanned(m));
	const placed = written.map((m) => ({ m, ch: markChapter(m, lk) }));
	const chapters = (stage: SetupStage) => placed.filter((p) => p.m.stage === stage && p.ch !== null).map((p) => p.ch as number);
	const planted = minOf(chapters('planted'));
	const reminded = maxOf(chapters('reminded'));
	const paid = minOf(chapters('paid-off'));
	const all = placed.filter((p) => p.ch !== null).map((p) => p.ch as number);
	let stageChapter: number | null = null;
	if (state === 'planted') stageChapter = planted;
	else if (state === 'reminded') stageChapter = reminded;
	else if (state === 'paid-off') stageChapter = paid;
	const has = (stage: SetupStage) => written.some((m) => m.stage === stage);
	let previousStage: SetupStage | null = null;
	if (state === 'reminded') previousStage = 'planted';
	else if (state === 'paid-off') previousStage = has('reminded') ? 'reminded' : 'planted';
	return {
		stageChapter, plantedChapter: planted, lastChapter: maxOf(all), previousStage,
		writtenYet: written.length > 0,
		nextPlan: nextPlanOf(marks, state, written.length > 0, lk),
	};
}

/**
 * The nearest stage after the written one that has a plan (with nothing
 * written at all, the plant plan counts too). Of that stage's plans, the
 * earliest one in the book; a plan with no chapter only when none has one.
 */
function nextPlanOf(marks: readonly SetupMark[], state: SetupState, writtenYet: boolean, lk: PlaceLookups): NextPlan | null {
	if (state === 'let-go' || state === 'paid-off') return null;
	const from = writtenYet ? SETUP_STAGES.indexOf(state) + 1 : 0;
	for (const stage of SETUP_STAGES.slice(from)) {
		const plans = marks.filter((m) => m.stage === stage && isPlanned(m));
		if (plans.length === 0) continue;
		let best: { m: SetupMark; ch: number | null } | null = null;
		for (const m of plans) {
			const ch = markChapter(m, lk);
			if (!best || (ch !== null && (best.ch === null || ch < best.ch))) best = { m, ch };
		}
		if (best) return { stage, chapter: best.ch, label: best.m.quote };
	}
	return null;
}

/**
 * How many chapters a still-open setup has waited since it was last written
 * about, counted up to `currentChapter` (the chapter being written, or the
 * last chapter of the book). Null when nothing is placed yet.
 */
export function chaptersQuiet(summary: SetupSummary, currentChapter: number | null): number | null {
	if (summary.lastChapter === null || currentChapter === null) return null;
	return Math.max(0, currentChapter - summary.lastChapter);
}

/** Board order inside a column: by the stage line's chapter, places outside the book last, then by name. */
export function compareForBoard(
	a: { name: string; summary: SetupSummary },
	b: { name: string; summary: SetupSummary },
): number {
	const ca = a.summary.stageChapter;
	const cb = b.summary.stageChapter;
	if (ca !== null && cb !== null && ca !== cb) return ca - cb;
	if ((ca === null) !== (cb === null)) return ca === null ? 1 : -1;
	return a.name.localeCompare(b.name);
}

/** One setup step planned on a grid card: shown in the card editor and as the card's small marker. */
export interface CardSetupLine<T> {
	setup: T;
	stage: SetupStage;
	/** The plan as stored (to remove it again). */
	mark: SetupMark;
	/** Written in the text of the scene this card is linked to. */
	written: boolean;
}

/**
 * Every setup step planned on one grid card, Plant → Remind → Pay off, then
 * by name. A setup planned twice on the same card
 * for the same stage shows once.
 */
export function setupsOnCard<T extends { name: string; marks: readonly SetupMark[] }>(
	setups: readonly T[], gridId: string, cardId: string, lk: PlaceLookups,
): CardSetupLine<T>[] {
	const out: CardSetupLine<T>[] = [];
	for (const setup of setups) {
		for (const mark of setup.marks) {
			const t = mark.target;
			if (t.kind !== 'card' || t.gridId !== gridId || t.cardId !== cardId) continue;
			if (out.some((l) => l.setup === setup && l.stage === mark.stage)) continue;
			out.push({ setup, stage: mark.stage, mark, written: realizedHere(mark, setup.marks, lk) });
		}
	}
	const rank = (s: SetupStage) => SETUP_STAGES.indexOf(s);
	return out.sort((x, y) => rank(x.stage) - rank(y.stage) || x.setup.name.localeCompare(y.setup.name));
}
