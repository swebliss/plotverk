// Pure — no Obsidian imports.
//
// A sheet's "Also known as" list: one alias per row, added one at a time.
// A name is never used twice in a book: not on this sheet, not as this
// sheet's own name, and not as another entry's name or alias (the @ list and
// the mention scan would no longer know who is meant).

/** One Codex entry and the names it answers to. */
export interface AliasOwner {
	path: string;
	name: string;
	aliases: readonly string[];
}

export type AliasProblem =
	| { word: string; reason: 'here' }
	| { word: string; reason: 'own-name' }
	| { word: string; reason: 'taken'; owner: string };

const key = (s: string) => s.trim().toLocaleLowerCase();

/** The other entry that already answers to `word` (its name or an alias), or null. `selfPath` is never counted. */
export function aliasOwner(word: string, selfPath: string | null, owners: readonly AliasOwner[]): AliasOwner | null {
	const k = key(word);
	if (!k) return null;
	for (const o of owners) {
		if (selfPath && o.path === selfPath) continue;
		if (key(o.name) === k || o.aliases.some((a) => key(a) === k)) return o;
	}
	return null;
}

/**
 * Add what the writer typed (one name, or several separated by commas) to
 * the list. Free names go in at the end, trimmed; the rest are reported and
 * left out. Returns a new list.
 */
export function addAlias(
	list: readonly string[],
	typed: string,
	selfPath: string | null,
	owners: readonly AliasOwner[],
	ownName = '',
): { list: string[]; added: string[]; problems: AliasProblem[] } {
	const out = [...list];
	const added: string[] = [];
	const problems: AliasProblem[] = [];
	for (const raw of typed.split(',')) {
		const word = raw.trim();
		if (!word) continue;
		if (out.some((a) => key(a) === key(word))) {
			if (!added.some((a) => key(a) === key(word))) problems.push({ word, reason: 'here' });
			continue;
		}
		if (ownName && key(ownName) === key(word)) {
			problems.push({ word, reason: 'own-name' });
			continue;
		}
		const owner = aliasOwner(word, selfPath, owners);
		if (owner) {
			problems.push({ word, reason: 'taken', owner: owner.name });
			continue;
		}
		out.push(word);
		added.push(word);
	}
	return { list: out, added, problems };
}
