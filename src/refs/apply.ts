// Pure — no Obsidian imports.
// Applies a confirmed set of MentionCandidates to manuscript text by wrapping
// each span with a wikilink, processing end→start so earlier offsets stay valid.

import type { MentionCandidate } from './references';
import { buildEntityWikilink } from './references';

/**
 * Replace each confirmed candidate span in `text` with its wikilink.
 * Candidates must not overlap (findMentions guarantees this).
 * Processing is done end→start so inserting a wikilink at offset N does
 * not shift the offsets of candidates that start before N.
 */
export function applySpans(text: string, confirmed: MentionCandidate[]): string {
    if (!confirmed.length) return text;

    const sorted = [...confirmed].sort((a, b) => b.start - a.start);

    let result = text;
    for (const span of sorted) {
        const link = buildEntityWikilink(span.notePath, span.matchedName);
        result = result.slice(0, span.start) + link + result.slice(span.end);
    }
    return result;
}
