// Pure: the free checks and the Pro checks, read together — no Obsidian imports.
// This is the CLIENT side: today `scanPro` runs here; later it is a server call
// and only `mergeCoach` stays.
import { ProseFinding, ProseCounts, RepetitionGroup } from './types';
import { ScanEnabledFlags, ScanResult, scanAll } from './counts';
import { groupsToFindings, REPEAT_MIN_COUNT, REPEAT_WINDOW } from './repetition';
import { tokenizeWords } from './tokenize';
import { mergeSpans, overlapsAny } from './pro/dialogue';
import { ProFlags, ProScanResult, scanPro, proTotal } from './pro';

export interface CoachProContext {
	flags: ProFlags;
	/** Multi-word entries of the "never" list. */
	neverPhrases: ReadonlySet<string>;
	/** Every Codex name and alias, as written. */
	names?: readonly string[];
}

export interface CoachScanContext {
	flags: ScanEnabledFlags;
	ignore: ReadonlySet<string>;
	dismissed: ReadonlySet<string>;
	/** null → the Pro checks don't run (no Pro, see canUse('prose-coach')). */
	pro?: CoachProContext | null;
}

export interface CoachScan {
	/** Every finding to mark, free and Pro, sorted by offset. */
	findings: ProseFinding[];
	/** Repeated-word clusters left after the Pro checks claimed theirs. */
	repetitionGroups: RepetitionGroup[];
	counts: ProseCounts;
	pro: ProScanResult | null;
	/** What the verdict sentence counts: every group's count, free and Pro. */
	total: number;
}

/**
 * Puts the free and Pro results together so the same word is never reported
 * twice in a confusing way. Pro phrases win over free findings inside them
 * (an adverb in "absolutely essential", a passive "was completely destroyed",
 * "heart" repeated inside three "heart pounding"s), and a word a Pro check
 * flags (a crutch word, a misspelt name) is not also an adverb or a repeated
 * word. Hidden Pro findings keep their place, so "Not here" on one never
 * brings another back in the same spot.
 */
export function mergeCoach(text: string, free: ScanResult, pro: ProScanResult | null): CoachScan {
	if (!pro) {
		const c = free.counts;
		return { findings: free.findings, repetitionGroups: free.repetitionGroups, counts: c, pro: null, total: c.adverbs + c.passive + c.repetition };
	}
	const claimed = new Set(pro.claimed);
	const phrases = mergeSpans(pro.phraseSpans);
	const inPhrase = (r: { from: number; to: number }) => overlapsAny(phrases, r.from, r.to);

	const adverbs = free.findings.filter((f) => f.kind === 'adverb' && !(f.word && claimed.has(f.word)) && !inPhrase(f));
	const passive = free.findings.filter((f) => f.kind === 'passive' && !inPhrase(f));
	const repetitionGroups: RepetitionGroup[] = [];
	for (const g of free.repetitionGroups) {
		if (claimed.has(g.word)) continue;
		const ranges = g.ranges.filter((r) => !inPhrase(r));
		if (ranges.length === g.ranges.length) { repetitionGroups.push(g); continue; }
		// What is left must still be a cluster by the free check's own rule:
		// REPEAT_MIN_COUNT uses within REPEAT_WINDOW words somewhere in it.
		const span = (a: number, b: number) => tokenizeWords(text.slice(ranges[a].from, ranges[b].to)).length;
		let cluster = false;
		for (let k = 0; k + REPEAT_MIN_COUNT - 1 < ranges.length && !cluster; k++) {
			cluster = span(k, k + REPEAT_MIN_COUNT - 1) <= REPEAT_WINDOW;
		}
		if (!cluster) continue;
		const from = ranges[0].from;
		const to = ranges[ranges.length - 1].to;
		repetitionGroups.push({ ...g, ranges, count: ranges.length, from, to, window: tokenizeWords(text.slice(from, to)).length });
	}
	const findings = [...adverbs, ...passive, ...groupsToFindings(text, repetitionGroups), ...pro.findings]
		.sort((a, b) => a.from - b.from || a.to - b.to);
	const counts: ProseCounts = { adverbs: adverbs.length, passive: passive.length, repetition: repetitionGroups.length };
	return { findings, repetitionGroups, counts, pro, total: counts.adverbs + counts.passive + counts.repetition + proTotal(pro.counts) };
}

/** Reads a whole note with every check the context switches on. */
export function scanCoach(text: string, ctx: CoachScanContext): CoachScan {
	const free = scanAll(text, ctx.flags, { ignore: ctx.ignore, dismissed: ctx.dismissed });
	const pro = ctx.pro
		? scanPro(text, ctx.pro.flags, { ignore: ctx.ignore, neverPhrases: ctx.pro.neverPhrases, dismissed: ctx.dismissed, names: ctx.pro.names })
		: null;
	return mergeCoach(text, free, pro);
}
