// Pure — no Obsidian imports. Lift-and-reuse in any future standalone port.

/**
 * A Codex entity the matcher can search for in manuscript text.
 * Built by the Obsidian-coupled reference-index layer from the entity index.
 */
export interface MatchableEntity {
    entityId: string;   // stable sg_xxx ID — never changes when name/path changes
    names: string[];    // [primaryName, ...aliases] — all spellings to match
    notePath: string;   // current vault path — used to build the wikilink target
}

/**
 * A single unconfirmed candidate mention found by findMentions().
 * The scan confirm UI shows these; the user picks which to link.
 */
export interface MentionCandidate {
    entityId: string;
    matchedName: string;    // which name/alias actually matched
    notePath: string;       // passed through so apply step can build the wikilink
    start: number;          // inclusive char offset in original text
    end: number;            // exclusive char offset
    isCommonWord: boolean;  // true → confirm UI defaults this OFF (e.g. "Will", "Mend")
}

/** Raw parts of a parsed [[target|display]] wikilink (without delimiters). */
export interface WikilinkParts {
    target: string;
    display?: string;
}

/** Parse the inner text between [[ and ]] into its target and optional display parts. */
export function parseWikilinkInner(inner: string): WikilinkParts {
    const pipeIdx = inner.indexOf('|');
    if (pipeIdx === -1) return { target: inner.trim() };
    return {
        target: inner.slice(0, pipeIdx).trim(),
        display: inner.slice(pipeIdx + 1).trim() || undefined,
    };
}

/** Build a [[target|display]] or [[target]] string. */
export function buildWikilinkString(target: string, display?: string): string {
    return display ? `[[${target}|${display}]]` : `[[${target}]]`;
}

/**
 * Build the full [[basename|display]] wikilink that goes into manuscript prose.
 * Uses the file basename (without .md) as the wikilink target so Obsidian's
 * rename engine tracks it and updates it automatically on entity rename.
 */
export function buildEntityWikilink(notePath: string, display?: string): string {
    const basename = notePath.split('/').pop()?.replace(/\.md$/, '') ?? notePath;
    // Suppress display when it matches the basename — produces [[Rick]] not [[Rick|Rick]]
    const effectiveDisplay = display && display !== basename ? display : undefined;
    return buildWikilinkString(basename, effectiveDisplay);
}
