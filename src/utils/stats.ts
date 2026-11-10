import { SceneCard, CardStatus } from '../grid-data';

/**
 * Pure statistics helpers for the Dashboard (no Obsidian imports so
 * they stay unit-testable). Word counting, goal-window sums, card status
 * summaries, and character appearance balance.
 */

// ─── Word counting ───────────────────────────────────────────────────────────

/** Count prose words in a markdown document (frontmatter and syntax stripped). */
export function countWords(text: string): number {
	let body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
	body = body
		.replace(/!\[\[[^\]]*\]\]/g, ' ') // image embeds are not prose
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // wikilink display text
		.replace(/\[\[([^\]]+)\]\]/g, '$1')
		.replace(/`[^`]*`/g, ' ')
		.replace(/[#>*_=~]/g, ' ');
	return body.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// ─── Day keys and goal windows ───────────────────────────────────────────────

/** Local-time day key, e.g. '2026-06-11'. */
export function dayKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function startOfWeek(d: Date): Date {
	const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const dow = (out.getDay() + 6) % 7; // Monday = 0
	out.setDate(out.getDate() - dow);
	return out;
}

export function startOfMonth(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function startOfYear(d: Date): Date {
	return new Date(d.getFullYear(), 0, 1);
}

/** Sum a day-keyed word history over [since, now] (inclusive, by day key). */
export function sumSince(history: Record<string, number>, since: Date, now: Date): number {
	const from = dayKey(since);
	const to = dayKey(now);
	let total = 0;
	for (const [key, words] of Object.entries(history)) {
		if (key >= from && key <= to) total += words;
	}
	return total;
}

// ─── Card statistics ─────────────────────────────────────────────────────────

export const STATUS_ORDER: CardStatus[] = ['idea', 'outline', 'draft', 'written', 'revised', 'final'];

export function summarizeStatuses(cards: SceneCard[]): Record<CardStatus, number> {
	const counts: Record<CardStatus, number> = { idea: 0, outline: 0, draft: 0, written: 0, revised: 0, final: 0 };
	for (const card of cards) {
		if (card.status in counts) counts[card.status]++;
	}
	return counts;
}

export interface CharacterBalance {
	/** Vault path of the character document */
	path: string;
	/** Display name (file basename) */
	name: string;
	/** Number of wikilink mentions across scene documents */
	appearances: number;
}

/**
 * Extract wikilink targets from markdown text, normalised to just the
 * basename (no path prefix, no .md suffix).
 * [[Characters/Mara.md|her]] → 'Mara', [[Io]] → 'Io'
 */
export function parseWikilinkTargets(text: string): string[] {
	const targets: string[] = [];
	// An optional leading "!" marks an embed (![[image.png]]), which is skipped.
	// (No lookbehind: old iOS WebViews refuse to parse it.)
	const re = /(!?)\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (m[1] === '!') {
			// Resume just after the "!" so a "[[" inside the skipped span is still tried
			// (the "[[" right after the "!" is the embed itself and never matches).
			re.lastIndex = m.index + 2;
			continue;
		}
		const raw = m[2].trim();
		const base = (raw.split('/').pop() ?? raw).replace(/\.md$/i, '');
		if (base) targets.push(base);
	}
	return targets;
}
