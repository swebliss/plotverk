// Pure — no Obsidian imports.
// ⚠️ DANGER ZONE: boundary and offset logic. Changes here risk manuscript corruption.
// Never touch without exhaustive tests in matcher.test.ts passing first.

import type { MatchableEntity, MentionCandidate } from './references';

// Single-word entity names that are common English words.
// Matches flagged as isCommonWord=true → confirm UI defaults them OFF.
// Multi-word names (e.g. "The Hand") are never flagged, regardless of word content.
const COMMON_WORDS = new Set<string>([
    // articles, conjunctions, prepositions
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'by', 'with', 'from', 'as', 'if', 'so', 'yet', 'nor',
    // auxiliaries and copulas
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
    'need', 'dare', 'ought',
    // pronouns
    'it', 'its', 'he', 'she', 'they', 'we', 'you', 'i', 'me', 'him',
    'her', 'us', 'them', 'my', 'your', 'his', 'their', 'our', 'its',
    'who', 'what', 'when', 'where', 'how', 'why', 'which', 'that', 'this',
    'these', 'those',
    // common adverbs / determiners
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'not', 'only', 'same', 'too', 'very', 'just', 'then',
    'now', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'here',
    'there', 'once', 'also', 'even', 'still', 'back', 'away',
    // prepositions continued
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'about', 'against', 'along', 'around', 'near', 'since',
    'while', 'although', 'because', 'unless', 'until', 'within', 'without',
    // common nouns and verbs that frequently appear as fantasy entity names
    'will',   // name AND auxiliary
    'grace',  // name AND noun
    'hope',   // name AND noun
    'faith',  // name AND noun
    'joy',    // name AND noun
    'may',    // name AND modal
    'mark',   // name AND verb
    'ward',   // name AND noun
    'mend',   // spell AND verb
    'dawn',   // name AND noun
    'ash',    // name AND noun
    'ember',  // name AND noun
    'storm',  // name AND noun/verb
    'rift',   // name AND noun
    'vale',   // name AND noun
    'glen',   // name AND noun
]);

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface TextSpan {
    start: number;
    end: number;
}

/**
 * Collect regions of text the matcher must skip:
 * frontmatter, fenced code, inline code, existing wikilinks, headings, MD links.
 */
function buildSkipZones(text: string): TextSpan[] {
    const zones: TextSpan[] = [];
    let m: RegExpExecArray | null;

    // YAML frontmatter block (must start at position 0)
    if (/^---\r?\n/.test(text)) {
        // closing --- must be on its own line
        const close = text.search(/\n---[ \t]*(\r?\n|$)/);
        if (close !== -1) {
            const closeEnd = text.indexOf('\n', close + 1);
            zones.push({ start: 0, end: closeEnd === -1 ? text.length : closeEnd + 1 });
        }
    }

    // Fenced code blocks (``` or ~~~, multiline)
    const fenced = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm;
    while ((m = fenced.exec(text)) !== null) {
        zones.push({ start: m.index, end: m.index + m[0].length });
    }

    // Inline code spans (single backtick, no newline)
    const inline = /`[^`\n]+`/g;
    while ((m = inline.exec(text)) !== null) {
        zones.push({ start: m.index, end: m.index + m[0].length });
    }

    // Existing wikilinks [[...]] — skip entire link including display text
    const wikilinks = /\[\[[^\]]*?\]\]/g;
    while ((m = wikilinks.exec(text)) !== null) {
        zones.push({ start: m.index, end: m.index + m[0].length });
    }

    // ATX headings (entire line starting with one or more #)
    const headings = /^#{1,6}[ \t].+$/gm;
    while ((m = headings.exec(text)) !== null) {
        zones.push({ start: m.index, end: m.index + m[0].length });
    }

    // Standard Markdown links [text](url)
    const mdLinks = /\[[^\]]+\]\([^)]+\)/g;
    while ((m = mdLinks.exec(text)) !== null) {
        zones.push({ start: m.index, end: m.index + m[0].length });
    }

    return zones;
}

function isInSkipZone(start: number, end: number, zones: TextSpan[]): boolean {
    return zones.some(z => start < z.end && end > z.start);
}

/**
 * Resolve overlapping candidates: longest match wins; on equal length, leftmost wins.
 * Returns candidates sorted by start position, one per non-overlapping span.
 */
function resolveOverlaps(candidates: MentionCandidate[]): MentionCandidate[] {
    // Sort: longest first, then leftmost on tie
    const sorted = [...candidates].sort((a, b) => {
        const lenA = a.end - a.start;
        const lenB = b.end - b.start;
        if (lenB !== lenA) return lenB - lenA;
        return a.start - b.start;
    });

    const picked: MentionCandidate[] = [];
    for (const c of sorted) {
        if (!picked.some(p => c.start < p.end && c.end > p.start)) {
            picked.push(c);
        }
    }

    return picked.sort((a, b) => a.start - b.start);
}

/**
 * Find all unlinked mentions of Codex entity names in a block of text.
 *
 * - Whole-word match only: uses Unicode property escapes (\p{L}\p{N}) so
 *   accented names work and partial-word matches ("Rick" inside "ricking") are rejected.
 * - Case-sensitive: "Rick" ≠ "rick". Proper names are capitalised; add aliases for
 *   sentence-start variants if needed.
 * - Alias-aware: all entries in entity.names are searched.
 * - Skips: YAML frontmatter, fenced/inline code, existing wikilinks, ATX headings,
 *   standard Markdown links.
 * - Overlap resolution: if "Red" and "Redwood" both match at the same position, the
 *   longer match ("Redwood") wins.
 * - Common-word flag: single-word entity names that are common English words get
 *   isCommonWord=true so the confirm UI can default them OFF.
 */
export function findMentions(text: string, entities: MatchableEntity[]): MentionCandidate[] {
    if (!text || !entities.length) return [];

    const skipZones = buildSkipZones(text);
    const raw: MentionCandidate[] = [];

    for (const entity of entities) {
        for (const name of entity.names) {
            if (!name.trim()) continue;

            // Unicode-aware whole-word boundary:
            // not preceded/followed by a letter, digit, or underscore (including accented chars).
            const pattern = `(?<![\\p{L}\\p{N}_])${escapeRegex(name)}(?![\\p{L}\\p{N}_])`;
            const re = new RegExp(pattern, 'gu');

            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                const start = m.index;
                const end = start + m[0].length;

                if (!isInSkipZone(start, end, skipZones)) {
                    // Flag single-word names that are common English words
                    const isCommonWord =
                        !name.includes(' ') && COMMON_WORDS.has(name.toLowerCase());

                    raw.push({
                        entityId: entity.entityId,
                        matchedName: name,
                        notePath: entity.notePath,
                        start,
                        end,
                        isCommonWord,
                    });
                }
            }
        }
    }

    return resolveOverlaps(raw);
}

// ─── Grouped variant (for the scan UI ambiguity chooser) ─────────────────────

/** A span in the document with one or more entity candidates. */
export interface GroupedMention {
    start: number;
    end: number;
    /** The literal text at this span in the document. */
    matchedText: string;
    /** All entity candidates for this span. Length > 1 means ambiguous. */
    candidates: MentionCandidate[];
    /** True when every candidate is a common English word (UI defaults these OFF). */
    isCommonWord: boolean;
}

/**
 * Like findMentions, but groups same-span candidates instead of arbitrarily
 * picking one. Groups with candidates.length > 1 are ambiguous — the text
 * matches an alias on more than one entity. Cross-span overlaps are still
 * resolved the same way as findMentions (longest wins, leftmost on tie).
 *
 * The existing findMentions and resolveOverlaps are not changed.
 */
export function findMentionsGrouped(text: string, entities: MatchableEntity[]): GroupedMention[] {
    if (!text || !entities.length) return [];

    const skipZones = buildSkipZones(text);

    // ── Inner scan: same boundary logic as findMentions ──────────────────────
    const bySpan = new Map<string, MentionCandidate[]>();

    for (const entity of entities) {
        for (const name of entity.names) {
            if (!name.trim()) continue;
            const pattern = `(?<![\\p{L}\\p{N}_])${escapeRegex(name)}(?![\\p{L}\\p{N}_])`;
            const re = new RegExp(pattern, 'gu');
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                const start = m.index;
                const end = start + m[0].length;
                if (!isInSkipZone(start, end, skipZones)) {
                    const isCommonWord = !name.includes(' ') && COMMON_WORDS.has(name.toLowerCase());
                    const key = `${start}:${end}`;
                    const group = bySpan.get(key) ?? [];
                    // One entry per entityId per span (entity may have multiple aliases matching here)
                    if (!group.some((c) => c.entityId === entity.entityId)) {
                        group.push({ entityId: entity.entityId, matchedName: name, notePath: entity.notePath, start, end, isCommonWord });
                    }
                    bySpan.set(key, group);
                }
            }
        }
    }

    // ── Cross-span overlap resolution: longest wins, leftmost on tie ─────────
    const entries = [...bySpan.entries()].map(([, candidates]) => ({
        start: candidates[0].start,
        end: candidates[0].end,
        candidates,
    }));
    entries.sort((a, b) => {
        const lenDiff = (b.end - b.start) - (a.end - a.start);
        return lenDiff !== 0 ? lenDiff : a.start - b.start;
    });
    const picked: typeof entries = [];
    for (const entry of entries) {
        if (!picked.some((p) => entry.start < p.end && entry.end > p.start)) {
            picked.push(entry);
        }
    }

    // ── Assemble result sorted by position ───────────────────────────────────
    return picked
        .sort((a, b) => a.start - b.start)
        .map((g) => ({
            start: g.start,
            end: g.end,
            matchedText: text.slice(g.start, g.end),
            candidates: g.candidates,
            isCommonWord: g.candidates.every((c) => c.isCommonWord),
        }));
}
