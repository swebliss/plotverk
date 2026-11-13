/**
 * How a Plot Grid card's tags reach its linked note — pure, no Obsidian imports.
 *
 * The card never overwrites the note's tag list: only the tags the writer
 * added to or removed from the card change on the note. Tags the writer put
 * on the note themselves always stay.
 */

/**
 * "#Hämnd", "love triangle" → "#hämnd", "#love-triangle". Any alphabet is kept.
 * Returns "#" (too short to be accepted) when nothing usable is left — Obsidian
 * ignores tags that are only digits, so those come back as "#" too.
 */
export function normalizeCardTag(tag: string): string {
	const body = tag
		.normalize('NFC')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^\p{L}\p{N}\p{M}\-_/]/gu, '')
		.replace(/^[-/]+|[-/]+$/g, '');
	if (!/[^\p{N}]/u.test(body)) return '#';
	return '#' + body;
}

const bare = (tag: string): string => (tag.startsWith('#') ? tag.slice(1) : tag);
const same = (a: string, b: string): boolean =>
	bare(a).normalize('NFC').toLowerCase() === bare(b).normalize('NFC').toLowerCase();

/** A note's `tags` property as a list — Obsidian accepts a list or one "a, b" / "a b" text. */
export function noteTagList(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw.filter((t) => t !== null && t !== undefined && String(t).trim()).map((t) => String(t).trim());
	if (typeof raw === 'string') return raw.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
	return [];
}

/** Tags in `after` but not `before`, and the other way round. */
export function cardTagChanges(before: readonly string[], after: readonly string[]): { added: string[]; removed: string[] } {
	return {
		added: after.filter((t) => !before.some((b) => same(b, t))),
		removed: before.filter((t) => !after.some((a) => same(a, t))),
	};
}

/**
 * The note's new tag list after the card's changes, or null when the note
 * would not change (so nothing is written).
 */
export function applyCardTagChanges(raw: unknown, added: readonly string[], removed: readonly string[]): string[] | null {
	const current = noteTagList(raw);
	const next = current.filter((t) => !removed.some((r) => same(r, t)));
	for (const t of added) {
		if (!next.some((n) => same(n, t))) next.push(bare(t));
	}
	const unchanged = next.length === current.length && next.every((t, i) => t === current[i]);
	return unchanged ? null : next;
}
