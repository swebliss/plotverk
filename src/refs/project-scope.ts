// Pure — no Obsidian imports. Which Codex entries belong with a given note.

/**
 * Kinds that never pick the project folder: their sheets sit next to the
 * manuscript (scenes) or are loose notes, so a folder holding only those is
 * not "the Codex of a book".
 */
const NON_ANCHOR_KINDS: ReadonlySet<string> = new Set(['scene', 'event', 'research']);

/** The Codex sub-folder's name (`CODEX_FOLDER` in entities/entity-manager.ts, kept here so this file stays Obsidian-free). */
const CODEX_SEGMENT = 'Codex';

/**
 * Narrow a vault-wide list of Codex entries to the book (or series) a note
 * belongs to. The book = the deepest folder above the note that holds Codex
 * entries of its own; a series Codex further up counts when the book has none
 * of its own. This is the rule the Prose Coach uses for name checks, shared so
 * the @ picker and the mention scan agree with it.
 *
 * A Codex sheet itself (a character sheet, say — the note is one of the
 * entries) starts from the folder that holds its last `Codex/` segment, so it
 * sees its whole book and not just its own kind's folder. Any other note in a
 * folder that happens to be called Codex is scoped like a normal note.
 *
 * A note outside every project (nothing above it holds a Codex entry) keeps the
 * whole vault, as before.
 */
export function scopeToBook<T>(
	items: readonly T[],
	notePath: string,
	describe: (item: T) => { path: string; kind: string },
): T[] {
	let parts = notePath.split('/').slice(0, -1);
	const described = items.map((item) => ({ item, ...describe(item) }));
	if (described.some((d) => d.path === notePath)) {
		const codexAt = parts.lastIndexOf(CODEX_SEGMENT);
		if (codexAt !== -1) parts = parts.slice(0, codexAt);
	}
	for (let depth = parts.length; depth > 0; depth--) {
		const prefix = `${parts.slice(0, depth).join('/')}/`;
		const inFolder = described.filter((d) => d.path.startsWith(prefix));
		if (inFolder.some((d) => !NON_ANCHOR_KINDS.has(d.kind))) return inFolder.map((d) => d.item);
	}
	return [...items];
}
