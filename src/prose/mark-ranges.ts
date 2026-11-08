// Pure: which coach marks to draw — no Obsidian, no CodeMirror.
import { ProseFinding } from './types';

/**
 * The ranges to mark, in the strictly sorted order CodeMirror's
 * RangeSetBuilder needs. Findings that touch the skipped span (the cursor's
 * line) are left out, so nothing moves under the writer's cursor. Two
 * findings on the exact same range draw one mark, not a doubled tint.
 * A sentence-rhythm run (many sentences) is flagged `run`: it is drawn as an
 * underline in the same amber, not a tint, so a whole paragraph never glows.
 */
export function markRanges(
	findings: readonly ProseFinding[],
	skip?: { from: number; to: number }
): Array<{ from: number; to: number; run?: boolean }> {
	const out: Array<{ from: number; to: number; run?: boolean }> = [];
	const sorted = [...findings].sort((a, b) => a.from - b.from || a.to - b.to);
	const seen = new Set<string>();
	for (const f of sorted) {
		if (f.to <= f.from) continue;
		if (skip && f.from <= skip.to && f.to >= skip.from) continue;
		const run = f.kind === 'rhythm';
		const key = `${f.from}:${f.to}:${run ? 'r' : 'm'}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(run ? { from: f.from, to: f.to, run } : { from: f.from, to: f.to });
	}
	return out;
}

/** The finding a mark element stands for: a run mark → its rhythm run, otherwise the narrowest finding there. */
export function findingForMark(findings: readonly ProseFinding[], pos: number, isRun: boolean): ProseFinding | null {
	if (isRun) return findings.find((f) => f.kind === 'rhythm' && pos >= f.from && pos < f.to) ?? null;
	return findingAt(findings.filter((f) => f.kind !== 'rhythm'), pos);
}

/**
 * The finding under a document position, preferring the narrowest one
 * (a repeated word inside a passive phrase wins over the phrase).
 */
export function findingAt(findings: readonly ProseFinding[], pos: number): ProseFinding | null {
	let best: ProseFinding | null = null;
	for (const f of findings) {
		if (pos < f.from || pos > f.to) continue;
		if (!best || f.to - f.from < best.to - best.from) best = f;
	}
	return best;
}
