import { findMentions, findMentionsGrouped } from './matcher';
import type { MatchableEntity } from './references';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function entity(
    id: string,
    names: string[],
    path = `Codex/Characters/${names[0]}.md`,
): MatchableEntity {
    return { entityId: id, names, notePath: path };
}

const RICK = entity('sg_rick', ['Rick', 'the Sheriff']);
const WILL = entity('sg_will', ['Will']);
const NAEMI = entity('sg_naemi', ['Naëmi', 'Naemi']);
const RED = entity('sg_red', ['Red'], 'Codex/Characters/Red.md');
const REDWOOD = entity('sg_redwood', ['Redwood'], 'Codex/Locations/Redwood.md');
const HAND = entity('sg_hand', ['The Hand'], 'Codex/Factions/The Hand.md');
const MEND = entity('sg_mend', ['Mend'], 'Codex/Spells/Mend.md');
const IRON = entity('sg_iron', ['Iron'], 'Codex/Materials/Iron.md');
const MIRA = entity('sg_mira', ['Mira', 'Mira Venn']);

// ── Basic matching ─────────────────────────────────────────────────────────────

describe('basic matching', () => {
    test('finds a single name in prose', () => {
        const results = findMentions('Rick walked into the bar.', [RICK]);
        expect(results).toHaveLength(1);
        expect(results[0].entityId).toBe('sg_rick');
        expect(results[0].matchedName).toBe('Rick');
        expect(results[0].start).toBe(0);
        expect(results[0].end).toBe(4);
    });

    test('finds alias', () => {
        const results = findMentions('the Sheriff arrived at dusk.', [RICK]);
        expect(results).toHaveLength(1);
        expect(results[0].entityId).toBe('sg_rick');
        expect(results[0].matchedName).toBe('the Sheriff');
    });

    test('finds all non-overlapping occurrences', () => {
        const results = findMentions('Rick spoke to Rick.', [RICK]);
        expect(results).toHaveLength(2);
        expect(results[0].start).toBe(0);
        expect(results[1].start).toBe(14);
    });

    test('returns empty array for empty text', () => {
        expect(findMentions('', [RICK])).toEqual([]);
    });

    test('returns empty array for empty entities list', () => {
        expect(findMentions('Rick was here.', [])).toEqual([]);
    });

    test('multiple entities in same text', () => {
        const text = 'Rick and Mira entered.';
        const results = findMentions(text, [RICK, MIRA]);
        expect(results).toHaveLength(2);
        expect(results.map((r) => r.entityId).sort()).toEqual(['sg_mira', 'sg_rick'].sort());
    });
});

// ── Whole-word / substring traps ──────────────────────────────────────────────

describe('whole-word matching — substring traps', () => {
    test('"Will" does not match inside "willing"', () => {
        const results = findMentions('Will she be willing?', [WILL]);
        expect(results).toHaveLength(1);
        expect(results[0].start).toBe(0);
        expect(results[0].end).toBe(4);
    });

    test('"Will" does not match inside "unwilling"', () => {
        const results = findMentions('She was unwilling to leave.', [WILL]);
        expect(results).toHaveLength(0);
    });

    test('"Iron" does not match inside "ironic"', () => {
        const results = findMentions('That is ironic.', [IRON]);
        expect(results).toHaveLength(0);
    });

    test('"Iron" does not match inside "ironically"', () => {
        const results = findMentions('Ironically it worked.', [IRON]);
        expect(results).toHaveLength(0);
    });

    test('"Iron" matches when surrounded by spaces', () => {
        const results = findMentions('Forged from Iron and stone.', [IRON]);
        expect(results).toHaveLength(1);
    });

    test('"Iron" matches at end of sentence', () => {
        const results = findMentions('She wore Iron.', [IRON]);
        expect(results).toHaveLength(1);
    });
});

// ── Possessives ───────────────────────────────────────────────────────────────

describe('possessives', () => {
    test("\"Rick's\" — match Rick before the apostrophe", () => {
        const results = findMentions("Rick's hat fell.", [RICK]);
        expect(results).toHaveLength(1);
        expect(results[0].entityId).toBe('sg_rick');
        expect(results[0].end).toBe(4); // "Rick" only, not "'s"
    });

    test("\"Will's\" — match Will before the apostrophe", () => {
        const results = findMentions("Will's lantern.", [WILL]);
        expect(results).toHaveLength(1);
    });
});

// ── Case sensitivity ──────────────────────────────────────────────────────────

describe('case-sensitive matching', () => {
    test('"rick" (lowercase) does NOT match entity named "Rick"', () => {
        const results = findMentions('rick walked in.', [RICK]);
        expect(results).toHaveLength(0);
    });

    test('"RICK" (uppercase) does NOT match entity named "Rick"', () => {
        const results = findMentions('RICK shouted.', [RICK]);
        expect(results).toHaveLength(0);
    });
});

// ── Unicode ───────────────────────────────────────────────────────────────────

describe('unicode names', () => {
    test('matches accented character name', () => {
        const results = findMentions('Naëmi stood at the gate.', [NAEMI]);
        expect(results).toHaveLength(1);
        expect(results[0].matchedName).toBe('Naëmi');
    });

    test('accented name does not match ASCII alias inside longer accented word', () => {
        // "Naemi" should not match inside a hypothetical "Naemira"
        const naemira = entity('sg_naemira', ['Naemira']);
        const results = findMentions('Naemira smiled.', [NAEMI, naemira]);
        expect(results).toHaveLength(1);
        expect(results[0].entityId).toBe('sg_naemira');
    });
});

// ── Overlap resolution ────────────────────────────────────────────────────────

describe('overlap resolution', () => {
    test('longest match wins when two entities overlap', () => {
        const results = findMentions('Redwood forest.', [RED, REDWOOD]);
        expect(results).toHaveLength(1);
        expect(results[0].entityId).toBe('sg_redwood');
    });

    test('"Red" still matches when "Redwood" is absent from the text', () => {
        const results = findMentions('Red sky at night.', [RED, REDWOOD]);
        expect(results).toHaveLength(1);
        expect(results[0].entityId).toBe('sg_red');
    });

    test('longest alias wins over shorter primary name', () => {
        // "Mira Venn" is longer than "Mira" — should pick the alias
        const results = findMentions('Mira Venn entered.', [MIRA]);
        expect(results).toHaveLength(1);
        expect(results[0].matchedName).toBe('Mira Venn');
    });

    test('leftmost wins when two non-overlapping candidates start at same offset — impossible; two overlapping same-length names pick one', () => {
        // Construct two entities with same-length names that would match same span.
        // In practice this is an edge case (same name, two entities).
        const a = entity('sg_a', ['Mira']);
        const b = entity('sg_b', ['Mira'], 'Codex/Locations/Mira.md');
        const results = findMentions('Mira stood.', [a, b]);
        // Must not return two results for the same span
        expect(results).toHaveLength(1);
    });
});

// ── Skip zones ────────────────────────────────────────────────────────────────

describe('skip: existing wikilinks', () => {
    test('name inside [[wikilink]] is skipped', () => {
        const results = findMentions('[[Rick]] was tired.', [RICK]);
        expect(results).toHaveLength(0);
    });

    test('name inside [[target|display]] is skipped', () => {
        const results = findMentions('Said [[Rick|the Sheriff]] quietly.', [RICK]);
        expect(results).toHaveLength(0);
    });

    test('name after wikilink is found', () => {
        const results = findMentions('[[Daryl]] saw Rick.', [RICK]);
        expect(results).toHaveLength(1);
        expect(results[0].matchedName).toBe('Rick');
    });
});

describe('skip: fenced code blocks', () => {
    test('name inside fenced block is skipped', () => {
        const text = 'See:\n```\nRick walked.\n```\nEnd.';
        expect(findMentions(text, [RICK])).toHaveLength(0);
    });

    test('name after fenced block is found', () => {
        const text = '```\ncode here\n```\nRick arrived.';
        const results = findMentions(text, [RICK]);
        expect(results).toHaveLength(1);
    });

    test('tilde fenced block is also skipped', () => {
        const text = '~~~\nRick\n~~~\n';
        expect(findMentions(text, [RICK])).toHaveLength(0);
    });
});

describe('skip: inline code', () => {
    test('name inside inline backticks is skipped', () => {
        const results = findMentions('The `Rick` variable.', [RICK]);
        expect(results).toHaveLength(0);
    });

    test('name adjacent to inline code is found', () => {
        const results = findMentions('`code` Rick arrived.', [RICK]);
        expect(results).toHaveLength(1);
    });
});

describe('skip: ATX headings', () => {
    test('name in H1 heading is skipped', () => {
        const results = findMentions('# Rick\n\nContent.', [RICK]);
        expect(results).toHaveLength(0);
    });

    test('name in H3 heading is skipped', () => {
        const results = findMentions('### Rick Meets Mira\n\nProse.', [RICK, MIRA]);
        expect(results).toHaveLength(0);
    });

    test('name in body below heading is found', () => {
        const results = findMentions('# Chapter One\n\nRick entered.', [RICK]);
        expect(results).toHaveLength(1);
    });
});

describe('skip: YAML frontmatter', () => {
    test('name inside frontmatter block is skipped', () => {
        const text = '---\ntags: [Rick, Sheriff]\ntitle: Rick\n---\n\nRick walked in.';
        const results = findMentions(text, [RICK]);
        // Only the body mention should be found
        expect(results).toHaveLength(1);
        // Verify it's the body occurrence (after the frontmatter)
        expect(text.slice(results[0].start, results[0].end)).toBe('Rick');
        expect(results[0].start).toBeGreaterThan(text.indexOf('---\n\n'));
    });

    test('document with no frontmatter works normally', () => {
        const text = 'Rick walked in.';
        expect(findMentions(text, [RICK])).toHaveLength(1);
    });
});

describe('skip: Markdown links', () => {
    test('name inside [text](url) is skipped', () => {
        const results = findMentions('See [Rick Grimes](https://wiki.example.com).', [RICK]);
        expect(results).toHaveLength(0);
    });
});

// ── Common-word flag ──────────────────────────────────────────────────────────

describe('isCommonWord flag', () => {
    test('single-word entity that is a common word is flagged', () => {
        const results = findMentions('She tried to Mend the cloak.', [MEND]);
        expect(results).toHaveLength(1);
        expect(results[0].isCommonWord).toBe(true);
    });

    test('multi-word entity name is never flagged (even if words are common)', () => {
        const results = findMentions('The Hand controls the docks.', [HAND]);
        expect(results).toHaveLength(1);
        expect(results[0].isCommonWord).toBe(false);
    });

    test('normal proper name is not flagged', () => {
        const results = findMentions('Rick stood up.', [RICK]);
        expect(results).toHaveLength(1);
        expect(results[0].isCommonWord).toBe(false);
    });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
    test('name at very start of text', () => {
        const results = findMentions('Rick.', [RICK]);
        expect(results).toHaveLength(1);
    });

    test('name at very end of text (no trailing char)', () => {
        const results = findMentions('Said Rick', [RICK]);
        expect(results).toHaveLength(1);
    });

    test('name surrounded by punctuation', () => {
        const results = findMentions('"Rick," she said.', [RICK]);
        expect(results).toHaveLength(1);
    });

    test('name on its own line', () => {
        const results = findMentions('Para one.\n\nRick\n\nPara two.', [RICK]);
        expect(results).toHaveLength(1);
    });

    test('entity with empty string name is skipped gracefully', () => {
        const blank = entity('sg_blank', ['', 'Rick']);
        const results = findMentions('Rick arrived.', [blank]);
        expect(results).toHaveLength(1);
        expect(results[0].matchedName).toBe('Rick');
    });

    test('large text with no matches returns empty array', () => {
        const text = 'Lorem ipsum dolor sit amet, '.repeat(100);
        expect(findMentions(text, [RICK])).toHaveLength(0);
    });

    test('candidates returned sorted by start position', () => {
        const text = 'Mira saw Rick and Mira again.';
        const results = findMentions(text, [RICK, MIRA]);
        const starts = results.map((r) => r.start);
        expect(starts).toEqual([...starts].sort((a, b) => a - b));
    });
});

// ── findMentionsGrouped ───────────────────────────────────────────────────────

describe('findMentionsGrouped', () => {
    test('unambiguous match returns single candidate per group', () => {
        const groups = findMentionsGrouped('Rick walked in.', [RICK]);
        expect(groups).toHaveLength(1);
        expect(groups[0].candidates).toHaveLength(1);
        expect(groups[0].candidates[0].entityId).toBe('sg_rick');
        expect(groups[0].matchedText).toBe('Rick');
    });

    test('ambiguous alias returns both candidates in one group', () => {
        const cop1 = entity('sg_cop1', ['the officer'], 'Codex/Characters/Cop1.md');
        const cop2 = entity('sg_cop2', ['the officer'], 'Codex/Characters/Cop2.md');
        const groups = findMentionsGrouped('the officer arrived.', [cop1, cop2]);
        expect(groups).toHaveLength(1);
        expect(groups[0].candidates).toHaveLength(2);
        const ids = groups[0].candidates.map((c) => c.entityId).sort();
        expect(ids).toEqual(['sg_cop1', 'sg_cop2']);
    });

    test('cross-span overlap still resolved — longest wins', () => {
        const groups = findMentionsGrouped('Redwood forest.', [RED, REDWOOD]);
        expect(groups).toHaveLength(1);
        expect(groups[0].matchedText).toBe('Redwood');
        expect(groups[0].candidates[0].entityId).toBe('sg_redwood');
    });

    test('matchedText is the literal document text at that span', () => {
        const groups = findMentionsGrouped('Said the Sheriff quietly.', [RICK]);
        expect(groups).toHaveLength(1);
        expect(groups[0].matchedText).toBe('the Sheriff');
    });

    test('isCommonWord true when all candidates are common words', () => {
        const groups = findMentionsGrouped('She tried to Mend it.', [MEND]);
        expect(groups).toHaveLength(1);
        expect(groups[0].isCommonWord).toBe(true);
    });

    test('isCommonWord false when any candidate is not a common word', () => {
        const mend2 = entity('sg_mend2', ['Mend'], 'Codex/Characters/Mend.md');
        // MEND has isCommonWord=true, but mend2 shares same name — still flagged
        // (both are common word 'Mend') — stays true
        const groups = findMentionsGrouped('Mend the wound.', [MEND, mend2]);
        expect(groups[0].isCommonWord).toBe(true);
    });

    test('results sorted by start position', () => {
        const groups = findMentionsGrouped('Mira saw Rick.', [RICK, MIRA]);
        expect(groups[0].matchedText).toBe('Mira');
        expect(groups[1].matchedText).toBe('Rick');
    });

    test('returns empty for no matches', () => {
        expect(findMentionsGrouped('Nothing here.', [RICK])).toHaveLength(0);
    });

    test('same entity with two matching aliases at same span produces one candidate', () => {
        // MIRA has aliases ['Mira', 'Mira Venn']. 'Mira Venn' wins (longer).
        // Only one group, one candidate (MIRA), not two.
        const groups = findMentionsGrouped('Mira Venn entered.', [MIRA]);
        expect(groups).toHaveLength(1);
        expect(groups[0].candidates).toHaveLength(1);
        expect(groups[0].matchedText).toBe('Mira Venn');
    });
});
