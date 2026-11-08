// Pure aggregation of the three prose engines — no Obsidian imports.
import { ProseFinding, ProseCounts, RepetitionGroup, FindingKind } from './types';
import { findAdverbs } from './adverbs';
import { findPassive } from './passive';
import { findRepetitionGroups, groupsToFindings } from './repetition';
import { maskNonProse } from './mask';
import { normalizeWord } from './tokenize';

export interface ScanEnabledFlags {
	adverbs: boolean;
	passive: boolean;
	repetition: boolean;
}

/**
 * The engine switches from saved settings. Adverbs and repeated words are on
 * unless switched off; passive sentences are OFF unless switched on (the
 * passive check guesses more often than the other two).
 */
export function resolveEngineFlags(s?: { adverbs?: boolean; passive?: boolean; repetition?: boolean }): ScanEnabledFlags {
	return {
		adverbs: s?.adverbs !== false,
		passive: s?.passive === true,
		repetition: s?.repetition !== false,
	};
}

/** The key "Not here" stores for a finding: `${kind}:${word}`. */
export function dismissalKey(kind: FindingKind, word: string): string {
	return `${kind}:${word}`;
}

/**
 * The word "Never this word" stores for a finding. Adverbs and repeated words
 * store the word itself; a passive phrase ("was opened") stores its last word,
 * the participle, so the whole construction with that verb stops being flagged.
 */
export function neverKeyFor(f: Pick<ProseFinding, 'kind' | 'word' | 'text'>): string {
	const word = f.word ?? f.text.toLowerCase();
	if (f.kind !== 'passive') return normalizeWord(word);
	const parts = word.trim().split(/\s+/);
	return normalizeWord(parts[parts.length - 1] ?? '');
}

export interface ScanOptions {
	/** normalizeWord keys never to flag: Codex names + aliases + the "never" list (see buildIgnoreSet). */
	ignore?: ReadonlySet<string>;
	/** "Not here" keys for this scene (`${kind}:${word}`). */
	dismissed?: ReadonlySet<string>;
}

export interface ScanResult {
	/** Every finding (repetition: one per use), sorted by offset — for the editor marks. */
	findings: ProseFinding[];
	counts: ProseCounts;
	/** Repetition clusters, sorted by offset — for the Coach tab. */
	repetitionGroups: RepetitionGroup[];
}

/**
 * Scans a whole note. Only prose is read: frontmatter, headings, the scene
 * metadata line, wikilink targets, code and comments are skipped (see
 * maskNonProse). Offsets point into `text` itself.
 */
export function scanAll(text: string, enabled: ScanEnabledFlags, opts: ScanOptions = {}): ScanResult {
	const prose = maskNonProse(text);
	const ignore = opts.ignore;
	const dismissed = opts.dismissed;
	const keep = (f: ProseFinding) => !dismissed || !f.word || !dismissed.has(dismissalKey(f.kind, f.word));

	const adverbFindings = enabled.adverbs ? findAdverbs(prose, ignore).filter(keep) : [];
	const passiveFindings = enabled.passive
		? findPassive(prose).filter((f) => keep(f) && !ignore?.has(neverKeyFor(f)))
		: [];
	const repetitionGroups = enabled.repetition
		? findRepetitionGroups(prose, undefined, ignore).filter((g) => !dismissed?.has(dismissalKey('repetition', g.word)))
		: [];
	const repetitionFindings = groupsToFindings(text, repetitionGroups);

	const findings = [...adverbFindings, ...passiveFindings, ...repetitionFindings]
		.map((f) => ({ ...f, text: text.slice(f.from, f.to) }))
		.sort((a, b) => a.from - b.from || a.to - b.to);

	return {
		findings,
		counts: {
			adverbs: adverbFindings.length,
			passive: passiveFindings.length,
			repetition: repetitionGroups.length,
		},
		repetitionGroups,
	};
}
