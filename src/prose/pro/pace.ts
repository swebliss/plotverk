// PUBLIC RELEASE: only the shared word-count shape and the percent helper.
// The pace engine itself is a Pro check and is not included.

/** Word counts. dialogue + action + narration = words. */
export interface PaceCounts {
	words: number;
	dialogue: number;
	action: number;
	narration: number;
}

/** A share as a whole percent (0 when there are no words). */
export function percent(part: number, whole: number): number {
	return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
