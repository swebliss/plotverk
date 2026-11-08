// PUBLIC RELEASE stand-in for the Pro whole-book views (Dashboard habits and pace).
// Same shapes, no findings. The Dashboard only calls these when Pro is on,
// which it never is in the public build.
import { PaceCounts } from './pace';

export interface BookScene {
	label: string;
	text: string;
	dismissed?: ReadonlySet<string>;
}

export interface Habit {
	key: string;
	kind: 'crutch' | 'cliche';
	total: number;
	perScene: number[];
}

export interface HabitsResult {
	habits: Habit[];
	englishScenes: number;
}

export interface HabitOptions {
	ignore?: ReadonlySet<string>;
	neverPhrases?: ReadonlySet<string>;
	top?: number;
	minTotal?: number;
}

export function crutchHabits(_scenes: readonly BookScene[], _opts: HabitOptions = {}): HabitsResult {
	return { habits: [], englishScenes: 0 };
}

export interface PaceRow {
	label: string;
	index: number;
	counts: PaceCounts;
	english: boolean;
}

export interface PaceCurve {
	rows: PaceRow[];
	short: number;
}

export const PACE_MIN_WORDS = 200;

export function paceCurve(_scenes: readonly BookScene[], _minWords = PACE_MIN_WORDS): PaceCurve {
	return { rows: [], short: 0 };
}
