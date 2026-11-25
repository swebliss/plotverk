/**
 * Last checks before Plotverk writes over a file the writer owns. Pure (no
 * Obsidian), so every rule is tested. They never change what a normal save
 * writes: each one only stops a save that would destroy work.
 */

/** The newest file version this Plotverk knows how to write. Grids and timelines are both at 1. */
export const CURRENT_FILE_VERSION = 1;

/**
 * A file written by a newer Plotverk (say, on the phone after an update) may
 * hold things this Plotverk does not know about; saving over it would drop
 * them. A missing or odd version is treated as old, as files always were.
 */
export function isFromNewerPlotverk(version: unknown): boolean {
	return typeof version === 'number' && Number.isFinite(version) && version > CURRENT_FILE_VERSION;
}

/**
 * Never let a change empty a page that had text: returns the text to write,
 * which is the old text when the change would have left nothing.
 */
export function keepIfEmptied(before: string, after: string): { text: string; kept: boolean } {
	if (after.trim() === '' && before.trim() !== '') return { text: before, kept: true };
	return { text: after, kept: false };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A grid that came out broken (lists missing) is never saved over the file. */
export function isWholeGrid(data: unknown): boolean {
	return isObject(data) && Array.isArray(data.rows) && Array.isArray(data.columns) && Array.isArray(data.cards);
}

/**
 * A timeline that came out broken is never saved over the file. Only what every
 * timeline has always had is required: older files may lack the later parts.
 */
export function isWholeTimeline(data: unknown): boolean {
	return isObject(data) && Array.isArray(data.plotlines) && isObject(data.calendar);
}
