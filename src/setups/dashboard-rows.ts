// Pure — no Obsidian imports.
import { SetupSummary, chaptersQuiet } from './book-order';
import { SetupState } from './setup-marks';

/** A setup with no mention for this many chapters gets the one accent colour on the Dashboard. */
export const QUIET_NUDGE_CHAPTERS = 10;

export interface DashSetupIn {
	name: string;
	state: SetupState;
	later: boolean;
	summary: SetupSummary;
}

export type DashFact =
	| { kind: 'paid'; chapter: number | null }
	| { kind: 'later' }
	| { kind: 'quiet'; chapters: number }
	| { kind: 'stage' };

export interface DashRow<T extends DashSetupIn> {
	setup: T;
	fact: DashFact;
	/** Gone quiet for QUIET_NUDGE_CHAPTERS or more (open, this book only). */
	quiet: boolean;
}

export interface DashSetups<T extends DashSetupIn> {
	/** Paid off (this book's count; later-book setups are not counted). */
	paid: number;
	/** Paid off + still open in this book. */
	total: number;
	/** Open first (quietest on top), then the later-book ones, then paid off (latest payoff first). */
	rows: DashRow<T>[];
	letGo: number;
	/** The quietest setup, when it has gone quiet long enough to say so. */
	nudge: DashRow<T> | null;
}

/**
 * The Dashboard's Setups section, as data (design v19): "2 of 5 paid off",
 * the list order, and the one quiet setup worth a nudge. `currentChapter` is
 * the furthest chapter the writer has written in; quiet = chapters since the
 * setup was last written about.
 */
export function dashboardSetups<T extends DashSetupIn>(setups: readonly T[], currentChapter: number | null): DashSetups<T> {
	const open = setups.filter((s) => (s.state === 'planted' || s.state === 'reminded') && !s.later);
	const later = setups.filter((s) => (s.state === 'planted' || s.state === 'reminded') && s.later);
	const paid = setups.filter((s) => s.state === 'paid-off');
	const letGo = setups.filter((s) => s.state === 'let-go').length;

	const openRows = open
		.map((setup) => {
			const q = chaptersQuiet(setup.summary, currentChapter);
			const fact: DashFact = q === null ? { kind: 'stage' } : { kind: 'quiet', chapters: q };
			return { setup, fact, quiet: q !== null && q >= QUIET_NUDGE_CHAPTERS, q };
		})
		.sort((a, b) => {
			// Quietest first; setups with no place in the book order after the rest.
			if (a.q !== null && b.q !== null && a.q !== b.q) return b.q - a.q;
			if ((a.q === null) !== (b.q === null)) return a.q === null ? 1 : -1;
			return a.setup.name.localeCompare(b.setup.name);
		})
		.map(({ setup, fact, quiet }) => ({ setup, fact, quiet }));
	const laterRows = [...later]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((setup): DashRow<T> => ({ setup, fact: { kind: 'later' }, quiet: false }));
	const paidRows = [...paid]
		.sort((a, b) => (b.summary.stageChapter ?? -1) - (a.summary.stageChapter ?? -1) || a.name.localeCompare(b.name))
		.map((setup): DashRow<T> => ({ setup, fact: { kind: 'paid', chapter: setup.summary.stageChapter }, quiet: false }));

	const first = openRows[0];
	return {
		paid: paid.length,
		total: paid.length + open.length,
		rows: [...openRows, ...laterRows, ...paidRows],
		letGo,
		nudge: first && first.quiet ? first : null,
	};
}
