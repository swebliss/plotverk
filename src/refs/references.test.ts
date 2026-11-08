import {
    parseWikilinkInner,
    buildWikilinkString,
    buildEntityWikilink,
} from './references';

describe('parseWikilinkInner', () => {
    test('plain target — no pipe', () => {
        expect(parseWikilinkInner('Rick')).toEqual({ target: 'Rick' });
    });

    test('target with display', () => {
        expect(parseWikilinkInner('Rick|the Sheriff')).toEqual({
            target: 'Rick',
            display: 'the Sheriff',
        });
    });

    test('trims whitespace from both parts', () => {
        expect(parseWikilinkInner('  Rick  |  the Sheriff  ')).toEqual({
            target: 'Rick',
            display: 'the Sheriff',
        });
    });

    test('empty display after pipe returns no display field', () => {
        expect(parseWikilinkInner('Rick|')).toEqual({ target: 'Rick' });
    });

    test('path with heading anchor', () => {
        expect(parseWikilinkInner('Codex/Characters/Rick#Backstory')).toEqual({
            target: 'Codex/Characters/Rick#Backstory',
        });
    });
});

describe('buildWikilinkString', () => {
    test('no display → [[target]]', () => {
        expect(buildWikilinkString('Rick')).toBe('[[Rick]]');
    });

    test('with display → [[target|display]]', () => {
        expect(buildWikilinkString('Rick', 'the Sheriff')).toBe('[[Rick|the Sheriff]]');
    });

    test('empty display treated as no display', () => {
        expect(buildWikilinkString('Rick', '')).toBe('[[Rick]]');
    });
});

describe('buildEntityWikilink', () => {
    test('strips .md extension from basename', () => {
        expect(buildEntityWikilink('Codex/Characters/Rick.md')).toBe('[[Rick]]');
    });

    test('with display text', () => {
        expect(buildEntityWikilink('Codex/Characters/Rick.md', 'the Sheriff')).toBe(
            '[[Rick|the Sheriff]]',
        );
    });

    test('nested path uses only the final segment', () => {
        expect(buildEntityWikilink('My Story/Codex/Characters/Mira.md')).toBe('[[Mira]]');
    });

    test('path with no extension passes basename as-is', () => {
        expect(buildEntityWikilink('Rick')).toBe('[[Rick]]');
    });

    test('round-trip: build then parse recovers target and display', () => {
        const link = buildEntityWikilink('Codex/Rick.md', 'the Sheriff');
        const inner = link.slice(2, -2); // strip [[ ]]
        const parsed = parseWikilinkInner(inner);
        expect(parsed.target).toBe('Rick');
        expect(parsed.display).toBe('the Sheriff');
    });
});
