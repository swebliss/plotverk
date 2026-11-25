// Pure — no Obsidian imports.

/** What writers mention most leads the @ list: characters, then items, then the rest. */
const KIND_ORDER = ['character', 'item'];
const kindRank = (kind: string) => { const i = KIND_ORDER.indexOf(kind); return i === -1 ? KIND_ORDER.length : i; };
/** How much a match counts extra while typing (fuzzy scores are small negatives): characters most, items a little. */
const BONUS: Record<string, number> = { character: 0.5, item: 0.25 };

interface Named {
	name: string;
	kind: string;
}

/** Nothing typed yet: characters, then items, then everything else, each alphabetical. */
export function orderWithoutQuery<T extends Named>(items: readonly T[]): T[] {
	return [...items].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name));
}

/** While typing: best match first, characters (then items) nudged ahead of an equally good match. */
export function orderByScore<T extends Named>(scored: ReadonlyArray<{ entity: T; score: number }>): T[] {
	const rank = (s: { entity: T; score: number }) => s.score + (BONUS[s.entity.kind] ?? 0);
	return [...scored]
		.sort((a, b) => rank(b) - rank(a) || a.entity.name.localeCompare(b.entity.name))
		.map((s) => s.entity);
}

/**
 * The words a picked entry's link shows in the sentence.
 *
 * The core idea (Emma, locked): a NAME lives on its sheet only. A link that
 * shows the sheet's own name is written bare (`[[Mr Gibbins]]`), so renaming
 * the sheet in the Codex changes the text everywhere. Never freeze the name
 * into the link.
 *
 * An ALIAS is the writer's own word for that person in this sentence ("Dad"):
 * the link keeps it (`[[Mr Gibbins|Dad]]`) and never swaps it for the name.
 *
 * - wrote the name itself, any case → the name (bare link, follows renames)
 * - wrote one of the aliases in full → exactly what was written
 * - a few letters that found the entry through an alias ("@da") → that alias
 * - anything else (a few letters of the name) → the name
 */
export function linkWords(written: string, name: string, aliases: readonly string[], matchedAlias: string | null): string {
	const w = written.trim();
	const low = w.toLocaleLowerCase();
	if (!w || low === name.trim().toLocaleLowerCase()) return name;
	if (aliases.some((a) => a.trim().toLocaleLowerCase() === low)) return w;
	if (matchedAlias?.trim()) return matchedAlias.trim();
	return name;
}

/**
 * "@" typed right in front of a name already written ("@Halvard Crane said"):
 * the longest entry name (or alias) the text after the cursor starts with,
 * any case, ending at a word edge. Picking it replaces that name with the link.
 */
export function nameAfterCursor(after: string, names: readonly string[]): string | null {
	const low = after.toLocaleLowerCase();
	let best: string | null = null;
	for (const name of names) {
		const n = name.trim();
		if (!n || n.length > after.length) continue;
		if (!low.startsWith(n.toLocaleLowerCase())) continue;
		const next = after.charAt(n.length);
		if (next && /[\p{L}\p{N}_]/u.test(next)) continue;
		if (!best || n.length > best.length) best = after.slice(0, n.length);
	}
	return best;
}
