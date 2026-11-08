// Pure word tokenizer with offsets — no Obsidian imports.

export interface Token {
	/** Lowercased word text. */
	word: string;
	from: number;
	to: number;
}

// Any letter in any script (å, ö, é, ñ, Cyrillic…), then letters, apostrophes or hyphens.
// The old ASCII-only pattern split "Sjöberg" into "Sj" + "berg".
const WORD_RE = /\p{L}[\p{L}\p{M}'’-]*/gu;

/** Tokenizes `text` into words with character offsets. O(n), single pass. */
export function tokenizeWords(text: string): Token[] {
	const tokens: Token[] = [];
	WORD_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = WORD_RE.exec(text))) {
		tokens.push({ word: m[0].toLowerCase(), from: m.index, to: m.index + m[0].length });
	}
	return tokens;
}

/**
 * The comparison key for a word: lowercased, curly apostrophes made straight,
 * a possessive "'s" dropped, and stray edge apostrophes/hyphens trimmed — so
 * "Ledger", "ledger's" and "ledger" all count as the same word.
 */
export function normalizeWord(word: string): string {
	return word
		.toLowerCase()
		.replace(/’/g, "'")
		.replace(/'s$/, '')
		.replace(/^['-]+|['-]+$/g, '');
}

/**
 * The words the coach must never flag: every word of every Codex name and
 * alias (so "Mara Ferrow" protects "mara" and "ferrow"), plus the writer's
 * own "Never this word" list. Keys are `normalizeWord` keys.
 */
export function buildIgnoreSet(names: Iterable<string>, neverWords: Iterable<string> = []): Set<string> {
	const out = new Set<string>();
	for (const source of [names, neverWords]) {
		for (const entry of source) {
			if (typeof entry !== 'string') continue;
			for (const t of tokenizeWords(entry)) {
				const key = normalizeWord(t.word);
				if (key) out.add(key);
			}
		}
	}
	return out;
}
