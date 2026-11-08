// Pure types shared by the prose-coach engines — no Obsidian, no CodeMirror.

/** Free kinds run locally; the rest are the Pro checks (src/prose/pro). */
export type FindingKind = 'adverb' | 'passive' | 'repetition' | 'wordy' | 'crutch' | 'cliche' | 'name' | 'rhythm';

export interface ProseFinding {
	kind: FindingKind;
	/** Character offsets into the scanned text, [from, to). */
	from: number;
	to: number;
	/** The matched surface text (for the findings list). */
	text: string;
	/**
	 * The comparison key used for "Not here" / "Never this word"
	 * (dismissal key = `${kind}:${word}`). adverb: the -ly word;
	 * repetition: the repeated word; passive: the whole phrase. Lowercased.
	 */
	word?: string;
	/** passive only: a "by …" agent phrase follows the match — a high-confidence signal. */
	hasByPhrase?: boolean;
	/** Pro: ONE word the coach may hand out (wordy: "to" for "in order to"; name: the Codex spelling). Never a rewrite. */
	suggestion?: string;
	/** crutch: how many times this word is flagged in the scene. rhythm: sentences in the run. */
	count?: number;
	/** rhythm: each sentence of the run with its length in words. */
	parts?: Array<{ from: number; to: number; words: number }>;
}

/**
 * One cluster of a repeated word: `count` uses of `word` within `window`
 * words of running text (first use to last, inclusive). The panel shows it
 * as "ledger · 4 times in 60 words"; the editor marks every range.
 */
export interface RepetitionGroup {
	word: string;
	count: number;
	window: number;
	/** Span of the whole cluster, first use to last. */
	from: number;
	to: number;
	ranges: Array<{ from: number; to: number }>;
}

export interface ProseCounts {
	adverbs: number;
	passive: number;
	/** Number of repetition GROUPS (one per cluster), not of marked words. */
	repetition: number;
}
