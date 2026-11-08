// Pure adverb (-ly word) detector — no Obsidian imports.
import { ProseFinding } from './types';
import { tokenizeWords, normalizeWord } from './tokenize';

/**
 * Words ending in "-ly" that are not manner adverbs — mostly -ly ADJECTIVES
 * (friendly, lovely, worldly…) and nouns/other parts of speech that happen to
 * end that way (family, July, jelly…). Adjectives are deliberately excluded
 * here because they aren't the "walked slowly" style problem this engine
 * targets — flagging "a friendly dog" would just be noise.
 */
export const ADVERB_WHITELIST: ReadonlySet<string> = new Set([
	'family', 'only', 'early', 'likely', 'unlikely', 'supply', 'apply', 'reply', 'imply', 'comply', 'multiply',
	'belly', 'jelly', 'rally', 'ally', 'bully', 'folly', 'holy', 'italy', 'july', 'assembly', 'monopoly',
	'anomaly', 'melancholy', 'butterfly', 'dragonfly', 'firefly', 'lily', 'dolly', 'jolly', 'silly', 'ugly',
	'deadly', 'friendly', 'lovely', 'lonely', 'elderly', 'orderly', 'ghastly', 'costly', 'curly', 'burly',
	'surly', 'holly', 'molly', 'gully', 'sully', 'tally', 'manly', 'womanly', 'heavenly', 'beastly', 'courtly',
	'kingly', 'knightly', 'princely', 'cowardly', 'miserly', 'scholarly', 'sisterly', 'brotherly', 'motherly',
	'fatherly', 'worldly', 'weekly', 'monthly', 'yearly', 'daily',
]);

/**
 * Finds -ly manner adverbs in `text`, with offsets. Each part of a hyphenated
 * word is checked on its own ("slowly-moving" flags "slowly"). Words in
 * `ignore` (Codex names, the writer's "never" list) are never flagged.
 */
export function findAdverbs(text: string, ignore?: ReadonlySet<string>): ProseFinding[] {
	const findings: ProseFinding[] = [];
	for (const t of tokenizeWords(text)) {
		if (ignore?.has(normalizeWord(t.word))) continue;
		const surface = text.slice(t.from, t.to);
		let offset = 0;
		for (const part of surface.split('-')) {
			const from = t.from + offset;
			offset += part.length + 1;
			const word = normalizeWord(part);
			if (word.length < 4 || !word.endsWith('ly')) continue; // "fly", "ply", "sly" — never adverbs
			if (ADVERB_WHITELIST.has(word) || ignore?.has(word)) continue;
			// Offsets cover the letters only (no edge apostrophe).
			const lead = part.length - part.replace(/^['’]+/, '').length;
			const start = from + lead;
			const end = start + part.replace(/^['’]+/, '').replace(/['’]+$/, '').length;
			findings.push({ kind: 'adverb', from: start, to: end, text: text.slice(start, end), word });
		}
	}
	return findings;
}
