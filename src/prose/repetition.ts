// Pure repeated-word ("echo") detector — no Obsidian imports.
import { ProseFinding, RepetitionGroup } from './types';
import { tokenizeWords, normalizeWord } from './tokenize';

/** Common English function words — never flagged as an echo, however often they repeat. */
export const STOPWORDS: ReadonlySet<string> = new Set([
	'the', 'and', 'that', 'have', 'with', 'this', 'from', 'they', 'been', 'were', 'said', 'would', 'could',
	'their', 'there', 'about', 'which', 'when', 'then', 'them', 'than', 'some', 'into', 'more', 'other', 'time',
	'just', 'like', 'over', 'also', 'back', 'after', 'before', 'again', 'down', 'only', 'well', 'because', 'these',
	'those', 'what', 'where', 'while', 'here', 'your', 'you', 'she', 'her', 'his', 'him', 'its', 'our', 'out',
	'not', 'but', 'for', 'are', 'was', 'has', 'had', 'did', 'does', 'can', 'will', 'all', 'any', 'now', 'own',
	'too', 'very', 'still', 'even', 'much', 'many', 'most', 'such', 'same', 'each', 'both', 'few', 'off', 'up',
	'into', 'onto', 'upon', 'across', 'along', 'among', 'around', 'behind', 'below', 'beneath', 'beside', 'between',
	'beyond', 'during', 'inside', 'outside', 'through', 'toward', 'towards', 'under', 'within', 'without', 'yet',
	'so', 'if', 'or', 'as', 'at', 'by', 'in', 'is', 'it', 'of', 'on', 'to', 'be', 'he', 'we', 'do', 'an', 'no',
]);

/** The writer-facing rule: three or more uses within a hundred words. */
export const REPEAT_WINDOW = 100;
export const REPEAT_MIN_COUNT = 3;

export interface RepetitionOptions {
	/** Window size in words of running text (every word counts). Default 100. */
	windowSize?: number;
	/** Minimum uses within the window to flag. Default 3. */
	minCount?: number;
	/** Minimum word length to consider — very short words are skipped. Default 4. */
	minWordLength?: number;
}

/**
 * Finds words used `minCount`+ times within `windowSize` words of each other
 * (the writer-facing rule: "three or more times within a hundred words").
 * Each cluster becomes one group; a word that clusters twice far apart gives
 * two groups. Uses far from any cluster are not part of a group.
 *
 * Stopwords, short words and words in `ignore` (Codex names, the "never"
 * list) are never flagged. "Ledger" and "ledger's" count as one word.
 * O(n) over the text plus O(k) per candidate word.
 */
export function findRepetitionGroups(
	text: string,
	opts?: RepetitionOptions,
	ignore?: ReadonlySet<string>
): RepetitionGroup[] {
	const windowSize = opts?.windowSize ?? REPEAT_WINDOW;
	const minCount = Math.max(2, opts?.minCount ?? REPEAT_MIN_COUNT);
	const minWordLength = opts?.minWordLength ?? 4;

	const tokens = tokenizeWords(text);
	const byWord = new Map<string, number[]>();
	tokens.forEach((t, i) => {
		const key = normalizeWord(t.word);
		if (key.length < minWordLength || STOPWORDS.has(key)) return;
		if (ignore && (ignore.has(key) || ignore.has(t.word))) return;
		const list = byWord.get(key);
		if (list) list.push(i);
		else byWord.set(key, [i]);
	});

	const groups: RepetitionGroup[] = [];
	for (const [word, idxs] of byWord) {
		if (idxs.length < minCount) continue;
		// Mark every use that sits in some run of `minCount` uses spanning < windowSize words.
		const marked = new Array<boolean>(idxs.length).fill(false);
		for (let a = 0; a + minCount - 1 < idxs.length; a++) {
			if (idxs[a + minCount - 1] - idxs[a] < windowSize) {
				for (let k = a; k < a + minCount; k++) marked[k] = true;
			}
		}
		// Chain marked uses into clusters: a gap of a full window or more starts a new one.
		let cur: number[] = [];
		const flush = () => {
			if (cur.length >= minCount) {
				const first = tokens[idxs[cur[0]]];
				const last = tokens[idxs[cur[cur.length - 1]]];
				groups.push({
					word,
					count: cur.length,
					window: idxs[cur[cur.length - 1]] - idxs[cur[0]] + 1,
					from: first.from,
					to: last.to,
					ranges: cur.map((k) => ({ from: tokens[idxs[k]].from, to: tokens[idxs[k]].to })),
				});
			}
			cur = [];
		};
		for (let k = 0; k < idxs.length; k++) {
			if (!marked[k]) { flush(); continue; }
			if (cur.length > 0 && idxs[k] - idxs[cur[cur.length - 1]] >= windowSize) flush();
			cur.push(k);
		}
		flush();
	}
	return groups.sort((a, b) => a.from - b.from);
}

/** Every use inside a repetition group, as flat findings sorted by offset (for editor marks). */
export function findRepetition(text: string, opts?: RepetitionOptions, ignore?: ReadonlySet<string>): ProseFinding[] {
	return groupsToFindings(text, findRepetitionGroups(text, opts, ignore));
}

export function groupsToFindings(text: string, groups: readonly RepetitionGroup[]): ProseFinding[] {
	const findings: ProseFinding[] = [];
	for (const g of groups) {
		for (const r of g.ranges) {
			findings.push({ kind: 'repetition', from: r.from, to: r.to, text: text.slice(r.from, r.to), word: g.word });
		}
	}
	return findings.sort((a, b) => a.from - b.from);
}
