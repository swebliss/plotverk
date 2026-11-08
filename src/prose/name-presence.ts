// Pure: which characters a scene's prose names, and how often. No Obsidian imports.
import { maskNonProse } from './mask';
import { normalizeWord, tokenizeWords } from './tokenize';

export interface NamedCharacter {
	path: string;
	/** Every name the Codex knows them by: sheet name, file name, aliases. */
	names: string[];
}

/**
 * One way to name something, as normalized word keys ("mara", "ferrow").
 * `path` '' = another Codex entry (a place, a faction…): it is matched only so
 * that "Crane Yard" is read as the yard, never as Halvard Crane.
 */
export type NamePattern = { path: string; words: string[]; lowerOk: boolean };

/**
 * Titles, articles and joining words never stand for a character on their own:
 * "Captain Yorrin Pike" is found by "Yorrin" or "Pike", never by "Captain".
 */
const NOT_A_NAME = new Set([
	'the', 'of', 'and', 'von', 'van', 'der', 'de', 'di', 'da', 'la', 'le', 'les', 'du', 'des', 'del', 'el', 'los', 'las', 'al',
	'captain', 'doctor', 'dr', 'councillor', 'councilor', 'grandmother', 'grandfather', 'grandma', 'grandpa', 'old', 'young',
	'little', 'big', 'lady', 'lord', 'sir', 'dame', 'mister', 'mr', 'mrs', 'ms', 'miss', 'madam', 'aunt', 'uncle',
	'father', 'mother', 'brother', 'sister', 'king', 'queen', 'prince', 'princess', 'master', 'mistress',
	'general', 'sergeant', 'professor', 'saint', 'st',
	'don', 'doña', 'señor', 'señora', 'san', 'santa', 'tío', 'tía', 'abuela', 'abuelo',
	'monsieur', 'madame', 'mademoiselle', 'mme', 'mlle', 'sainte', 'oncle', 'tante', 'grand-mère', 'grand-père',
]);

const keysOf = (s: string): string[] =>
	tokenizeWords(s.normalize('NFC')).map((t) => normalizeWord(t.word)).filter(Boolean);
/**
 * May this name start lowercase in prose? Only a particle name like
 * "d'Artagnan" or "al-Rashid" — never "bell hooks" or an alias like "the boy",
 * which would match ordinary words.
 */
const lowerNameOk = (s: string): boolean => {
	const t = s.trim().normalize('NFC');
	const c = t.charAt(0);
	return c !== '' && c === c.toLowerCase() && c !== c.toUpperCase() && /^\p{Ll}{1,3}['’-]\p{L}/u.test(t);
};

/**
 * How each character can be named in prose:
 * - a full name or alias, word for word ("Mara Ferrow");
 * - any single part of their name that no other character shares, is at least
 *   two letters, and is not a title ("Mara", "Pike", "Sepp" — but never
 *   "Ferrow" when five Ferrows exist, never "Captain", never an initial).
 * `otherNames` are the project's other Codex entries (places, factions, items…):
 * a match on one of those wins, so "Crane Yard" is not Halvard Crane.
 * Longest patterns first, so "Mara Ferrow" is one mention, not two.
 */
export function buildNamePatterns(characters: NamedCharacter[], otherNames: string[] = []): NamePattern[] {
	const patterns: NamePattern[] = [];
	const seen = new Set<string>();
	const add = (path: string, words: string[], lowerOk: boolean) => {
		const key = `${path}\u0000${words.join(' ')}`;
		if (words.length === 0 || seen.has(key)) return;
		seen.add(key);
		patterns.push({ path, words, lowerOk });
	};
	const owners = new Map<string, Set<string>>();
	const lowerParts = new Set<string>();
	for (const c of characters) {
		for (const name of c.names) {
			if (typeof name !== 'string') continue;
			const words = keysOf(name);
			add(c.path, words, lowerNameOk(name));
			const nfc = name.normalize('NFC');
			for (const raw of tokenizeWords(nfc)) {
				const w = normalizeWord(raw.word);
				if (!w || NOT_A_NAME.has(w) || [...w].length < 2) continue;
				(owners.get(w) ?? owners.set(w, new Set()).get(w)!).add(c.path);
				// raw.word is already lowercased — read the casing from the name itself.
				if (lowerNameOk(nfc.slice(raw.from, raw.to))) lowerParts.add(w); // "d'Artagnan"
			}
		}
	}
	for (const [word, who] of owners) {
		if (who.size === 1) add([...who][0], [word], lowerParts.has(word));
	}
	const characterKeys = new Set(patterns.map((p) => p.words.join(' ')));
	for (const name of otherNames) {
		if (typeof name !== 'string') continue;
		const words = keysOf(name);
		// A place called exactly like a character ("Saltmarch" the town and a
		// character "Saltmarch") stays the character's.
		if (words.length > 0 && !characterKeys.has(words.join(' '))) add('', words, lowerNameOk(name));
	}
	return patterns.sort((a, b) => b.words.length - a.words.length);
}

/**
 * Mentions per character path in `text`. Prose, beat headings and the names
 * inside [[links]] count; frontmatter, code and comments do not (see
 * maskNonProse). Whole words only, possessives included ("Mara's", "Mara’s");
 * a mention must start with a capital letter, so "a crane" or "will" in
 * ordinary prose is not a name — unless the Codex name itself starts lowercase.
 */
export function countNameMentions(text: string, patterns: NamePattern[]): Record<string, number> {
	const out: Record<string, number> = {};
	if (!text || patterns.length === 0) return out;
	const src = text.normalize('NFC');
	// Headings stay: in a scene they are beat titles, and they name who is there.
	const tokens = tokenizeWords(maskNonProse(src, { keepHeadings: true, keepLinkTargets: true }));
	const keys = tokens.map((t) => normalizeWord(t.word));
	const byFirst = new Map<string, NamePattern[]>();
	for (const p of patterns) (byFirst.get(p.words[0]) ?? byFirst.set(p.words[0], []).get(p.words[0])!).push(p);
	for (let i = 0; i < tokens.length; ) {
		const candidates = byFirst.get(keys[i]);
		const first = src[tokens[i].from];
		// Not a lowercase letter: a capital, or a script with no case at all.
		const lowercase = first === first.toLowerCase() && first !== first.toUpperCase();
		const hit = candidates?.find((p) => (p.lowerOk || !lowercase) && p.words.every((w, k) => keys[i + k] === w));
		if (hit) {
			if (hit.path) out[hit.path] = (out[hit.path] ?? 0) + 1;
			i += hit.words.length;
		} else {
			i++;
		}
	}
	return out;
}
