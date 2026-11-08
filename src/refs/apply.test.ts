import { applySpans } from './apply';
import { findMentions } from './matcher';
import type { MentionCandidate, MatchableEntity } from './references';

function span(
    start: number,
    end: number,
    matchedName: string,
    notePath = `Codex/Characters/${matchedName}.md`,
): MentionCandidate {
    return { entityId: 'sg_x', matchedName, notePath, start, end, isCommonWord: false };
}

function entity(id: string, names: string[], path?: string): MatchableEntity {
    return {
        entityId: id,
        names,
        notePath: path ?? `Codex/Characters/${names[0]}.md`,
    };
}

// ── Basic apply ───────────────────────────────────────────────────────────────

describe('applySpans — basic', () => {
    test('empty confirmed list returns text unchanged', () => {
        expect(applySpans('Rick walked in.', [])).toBe('Rick walked in.');
    });

    test('single span at start of text', () => {
        const result = applySpans('Rick walked in.', [span(0, 4, 'Rick')]);
        expect(result).toBe('[[Rick]] walked in.');
    });

    test('single span in middle of text', () => {
        const text = 'She saw Rick arrive.';
        const result = applySpans(text, [span(8, 12, 'Rick')]);
        expect(result).toBe('She saw [[Rick]] arrive.');
    });

    test('single span at end of text', () => {
        const text = 'Arrived with Rick';
        const result = applySpans(text, [span(13, 17, 'Rick')]);
        expect(result).toBe('Arrived with [[Rick]]');
    });

    test('alias match builds wikilink with display', () => {
        // "the Sheriff" is an alias for Rick; wikilink should be [[Rick|the Sheriff]]
        const text = 'the Sheriff walked in.';
        const s = span(0, 11, 'the Sheriff', 'Codex/Characters/Rick.md');
        const result = applySpans(text, [s]);
        expect(result).toBe('[[Rick|the Sheriff]] walked in.');
    });

    test('name matching basename suppresses pipe display', () => {
        // matchedName === basename → [[Rick]] not [[Rick|Rick]]
        const text = 'Rick arrived.';
        const s = span(0, 4, 'Rick', 'Codex/Characters/Rick.md');
        const result = applySpans(text, [s]);
        expect(result).toBe('[[Rick]] arrived.');
        expect(result).not.toContain('[[Rick|Rick]]');
    });
});

// ── Offset integrity — two spans ──────────────────────────────────────────────

describe('applySpans — offset integrity with multiple spans', () => {
    test('two spans: earlier offsets remain valid after later insertion', () => {
        // "Rick and Mira walked."
        //  0123456789...
        const text = 'Rick and Mira walked.';
        const candidates = [
            span(0, 4, 'Rick', 'Codex/Characters/Rick.md'),
            span(9, 13, 'Mira', 'Codex/Characters/Mira.md'),
        ];
        const result = applySpans(text, candidates);
        expect(result).toBe('[[Rick]] and [[Mira]] walked.');
    });

    test('three spans preserve all offsets', () => {
        const text = 'Rick saw Mira near Redwood.';
        //            0    5    0    5    0    5
        // Rick: 0-4, Mira: 9-13, Redwood: 19-26
        const candidates = [
            span(0, 4, 'Rick', 'Codex/Characters/Rick.md'),
            span(9, 13, 'Mira', 'Codex/Characters/Mira.md'),
            span(19, 26, 'Redwood', 'Codex/Locations/Redwood.md'),
        ];
        const result = applySpans(text, candidates);
        expect(result).toBe('[[Rick]] saw [[Mira]] near [[Redwood]].');
    });

    test('order of confirmed list does not affect result (function sorts internally)', () => {
        const text = 'Rick and Mira.';
        const forward = [
            span(0, 4, 'Rick'),
            span(9, 13, 'Mira', 'Codex/Characters/Mira.md'),
        ];
        const backward = [
            span(9, 13, 'Mira', 'Codex/Characters/Mira.md'),
            span(0, 4, 'Rick'),
        ];
        expect(applySpans(text, forward)).toBe(applySpans(text, backward));
    });
});

// ── Idempotency via findMentions skip-zones ───────────────────────────────────

describe('idempotency — scanner skips already-linked spans', () => {
    const RICK = entity('sg_rick', ['Rick'], 'Codex/Characters/Rick.md');

    test('applying once then scanning again finds zero new mentions', () => {
        const text = 'Rick walked in.';
        const first = findMentions(text, [RICK]);
        expect(first).toHaveLength(1);

        const applied = applySpans(text, first);
        expect(applied).toBe('[[Rick]] walked in.');

        // Second scan on the already-linked text
        const second = findMentions(applied, [RICK]);
        expect(second).toHaveLength(0);
    });

    test('custom-display link is also skipped on re-scan', () => {
        const SHERIFF = entity('sg_rick', ['Rick', 'the Sheriff'], 'Codex/Characters/Rick.md');
        const text = 'the Sheriff arrived.';
        const first = findMentions(text, [SHERIFF]);
        expect(first).toHaveLength(1);

        const applied = applySpans(text, first);
        expect(applied).toBe('[[Rick|the Sheriff]] arrived.');

        const second = findMentions(applied, [SHERIFF]);
        expect(second).toHaveLength(0);
    });

    test('applying with empty list (all deselected) leaves text identical', () => {
        const text = 'Rick and Mira arrived.';
        expect(applySpans(text, [])).toBe(text);
    });
});

// ── Partial confirm — only some matches applied ───────────────────────────────

describe('applySpans — partial selection', () => {
    const RICK = entity('sg_rick', ['Rick'], 'Codex/Characters/Rick.md');
    const MIRA = entity('sg_mira', ['Mira'], 'Codex/Characters/Mira.md');

    test('confirming only Rick leaves Mira as plain text', () => {
        const text = 'Rick and Mira arrived.';
        const all = findMentions(text, [RICK, MIRA]);
        const onlyRick = all.filter((c) => c.entityId === 'sg_rick');
        const result = applySpans(text, onlyRick);
        expect(result).toBe('[[Rick]] and Mira arrived.');
    });
});
