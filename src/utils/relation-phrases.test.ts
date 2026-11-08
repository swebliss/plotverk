import { mirrorWord } from './relation-mirror';
import { relationSentence, sentenceShapeFor } from './relation-sentence';
import { RELATIONSHIP_TYPES, RELATIONSHIP_TYPE_OTHER, RelEntity, buildRelationGraph, classifyRelation } from './relations';
import type { EntityKind } from '../entities/entity-kinds';

/**
 * Every relationship word with a preposition ("Sworn to", "Reports to", "Trained
 * by"…) reads as a sentence about the sheet's OWNER, but the registry files a
 * word under the role of the person it LINKS to. These words are the easy ones
 * to file backwards, so each one is pinned here: which way the Connections map
 * draws it, what gets written on the other sheet, and how the editor reads it.
 *
 * Setup per row: Aldric's sheet says `<Word>: [[Pike]]`.
 *  - `above` is who the map draws higher (the arrow runs from above to below)
 *    for the ranked words; `owner → other` for everything else.
 *  - `mirror` is the word written on Pike's sheet (null = nothing is written).
 */
type Row = {
	word: string;
	/** Kind of the sheet that is linked to. */
	other?: EntityKind;
	/** Who the map draws on top / at the start of the arrow. */
	from: 'owner' | 'other';
	mirror: string | null;
	sentence: string;
};

const ROWS: Row[] = [
	// ── Couples and allies: same word both ways ──────────────────────────────
	{ word: 'Married to', from: 'owner', mirror: 'Spouse', sentence: 'Aldric is married to Pike' },
	{ word: 'Engaged to', from: 'owner', mirror: 'Betrothed', sentence: 'Aldric is engaged to Pike' },
	{ word: 'Partner of', from: 'owner', mirror: 'Partner of', sentence: 'Aldric is partner of Pike' },
	{ word: 'Ally of', from: 'owner', mirror: 'Ally of', sentence: 'Aldric is ally of Pike' },
	// ── One-sided feelings: nothing written back ─────────────────────────────
	{ word: 'In love with', from: 'owner', mirror: null, sentence: 'Aldric is in love with Pike' },
	{ word: 'Pines for', from: 'owner', mirror: null, sentence: 'Aldric pines for Pike' },
	// ── Family lines: the ancestor is drawn above ────────────────────────────
	{ word: 'Ancestor of', from: 'owner', mirror: 'Descendant of', sentence: 'Aldric is ancestor of Pike' },
	{ word: 'Forebear of', from: 'owner', mirror: 'Descendant of', sentence: 'Aldric is forebear of Pike' },
	{ word: 'Descendant of', from: 'other', mirror: 'Ancestor of', sentence: 'Aldric is descendant of Pike' },
	{ word: 'Heir of', from: 'other', mirror: 'Ancestor of', sentence: 'Aldric is heir of Pike' },
	// ── Teaching: Pike is the mentor ─────────────────────────────────────────
	{ word: 'Trained by', from: 'owner', mirror: 'Apprentice', sentence: 'Aldric is trained by Pike' },
	{ word: 'Apprentice of', from: 'owner', mirror: 'Apprentice', sentence: 'Aldric is apprentice of Pike' },
	{ word: 'Student of', from: 'owner', mirror: 'Student', sentence: 'Aldric is student of Pike' },
	// ── Rank: the higher one is drawn above ──────────────────────────────────
	{ word: 'Reports to', from: 'other', mirror: 'Subordinate', sentence: 'Aldric reports to Pike' },
	{ word: 'Sworn to', from: 'other', mirror: 'Vassal', sentence: 'Aldric is sworn to Pike' },
	{ word: 'Superior of', from: 'owner', mirror: 'Ruler', sentence: 'Aldric is superior of Pike' },
	// ── Support: Pike is the one giving it ───────────────────────────────────
	{ word: 'Sponsored by', from: 'owner', mirror: 'Beneficiary', sentence: 'Aldric is sponsored by Pike' },
	// ── Character → world element: one-sided, nothing written on the world sheet
	{ word: 'Resident of', other: 'location', from: 'owner', mirror: null, sentence: 'Aldric is resident of Pike' },
	{ word: 'Member of', other: 'faction', from: 'owner', mirror: null, sentence: 'Aldric is member of Pike' },
	{ word: 'Belongs to', other: 'faction', from: 'owner', mirror: null, sentence: 'Aldric belongs to Pike' },
	{ word: 'Employee of', other: 'faction', from: 'owner', mirror: null, sentence: 'Aldric is employee of Pike' },
	{ word: 'Works for', other: 'faction', from: 'owner', mirror: null, sentence: 'Aldric works for Pike' },
	{ word: 'Affiliated with', other: 'faction', from: 'owner', mirror: null, sentence: 'Aldric is affiliated with Pike' },
	{ word: 'Owner of', other: 'item', from: 'owner', mirror: null, sentence: 'Aldric is owner of Pike' },
	{ word: 'Bearer of', other: 'item', from: 'owner', mirror: null, sentence: 'Aldric is bearer of Pike' },
	{ word: 'Practitioner of', other: 'system', from: 'owner', mirror: null, sentence: 'Aldric is practitioner of Pike' },
	{ word: 'Wielder of', other: 'system', from: 'owner', mirror: null, sentence: 'Aldric is wielder of Pike' },
];

const sheet = (name: string, kind: EntityKind, sections: Record<string, string> = {}): RelEntity => ({
	path: `Book/${name}.md`,
	name,
	kind,
	sections,
});

describe('words with a preposition — direction, mirrored word, sentence', () => {
	test.each(ROWS)('$word', ({ word, other = 'character', from, mirror, sentence }) => {
		// 1. The map draws the right one on top.
		const edges = buildRelationGraph([
			sheet('Aldric', 'character', { Relationships: `${word}: [[Pike]]` }),
			sheet('Pike', other),
		]);
		expect(edges).toHaveLength(1);
		const [owner, linked] = ['Book/Aldric.md', 'Book/Pike.md'];
		expect([edges[0].fromPath, edges[0].toPath]).toEqual(from === 'owner' ? [owner, linked] : [linked, owner]);

		// 2. The exact counterpart is what the other sheet gets.
		expect(mirrorWord(word, { ownerKind: 'character', targetKind: other })).toBe(mirror);

		// 3. The editor says it the right way round.
		const shape = sentenceShapeFor(word, { ownerKind: 'character', targetKind: other });
		expect(relationSentence('Pike', 'Aldric', word, 'en', { shape })).toBe(sentence);

		// 4. Old sheets still use the word: it stays a known word, never "unclassified".
		expect(classifyRelation(word).id).not.toBe(RELATIONSHIP_TYPE_OTHER.id);
	});

	test('the table covers every preposition word in the registry (a new one cannot slip in unreviewed)', () => {
		const phrase = /\b(of|to|by|for|with)\b/;
		const inRegistry = RELATIONSHIP_TYPES.flatMap((rt) => rt.labels).filter((l) => phrase.test(l)).sort();
		expect(ROWS.map((r) => r.word.toLowerCase()).sort()).toEqual(inRegistry);
		expect(inRegistry).toHaveLength(27);
	});
});

describe('what the three backwards words used to do', () => {
	test('"Superior of: [[Pike]]" makes Pike the subordinate, so Aldric is drawn above', () => {
		expect(classifyRelation('Superior of').category).toBe('subordinate');
		expect(classifyRelation('Superior of').id).toBe('vassal');
	});

	test('"Sworn to: [[Pike]]" makes Pike the ruler, so Pike is drawn above', () => {
		expect(classifyRelation('Sworn to').category).toBe('superior');
		expect(classifyRelation('Sworn to').id).toBe('ruler');
	});

	test('the two sheets of one pair agree: a Sworn-to line and its mirrored Vassal line draw one arrow', () => {
		const edges = buildRelationGraph([
			sheet('Mara', 'character', { Relationships: 'Sworn to: [[Pike]]' }),
			sheet('Pike', 'character', { Relationships: 'Vassal: [[Mara]]' }),
		]);
		expect(new Set(edges.map((e) => `${e.fromPath}>${e.toPath}`))).toEqual(new Set(['Book/Pike.md>Book/Mara.md']));
	});

	test('a Superior-of line and its mirrored Ruler line draw one arrow', () => {
		const edges = buildRelationGraph([
			sheet('Aldric', 'character', { Relationships: 'Superior of: [[Pike]]' }),
			sheet('Pike', 'character', { Relationships: 'Ruler: [[Aldric]]' }),
		]);
		expect(new Set(edges.map((e) => `${e.fromPath}>${e.toPath}`))).toEqual(new Set(['Book/Aldric.md>Book/Pike.md']));
	});
});

describe('patron — the one who gives the support', () => {
	test('Patron, Sponsor, Sponsored by and Benefactor are all the giver', () => {
		for (const w of ['Patron', 'Sponsor', 'Sponsored by', 'Benefactor']) {
			expect([w, classifyRelation(w).id]).toEqual([w, 'benefactor']);
			expect([w, mirrorWord(w, { ownerKind: 'character', targetKind: 'character' })]).toEqual([w, 'Beneficiary']);
		}
	});

	test('the receiving side is the Beneficiary, and it points back at the giver', () => {
		expect(classifyRelation('Beneficiary').id).toBe('beneficiary');
		expect(classifyRelation('Beneficiary').reciprocalId).toBe('benefactor');
		expect(mirrorWord('Beneficiary', { ownerKind: 'character', targetKind: 'character' })).toBe('Benefactor');
	});
});
