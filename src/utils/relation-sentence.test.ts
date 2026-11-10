import { mirrorPreviewText, relationSentence, relationSentenceParts, relationWordShape, sentenceShapeFor } from './relation-sentence';
import { MirrorContext, MirrorGender, mirrorWord } from './relation-mirror';
import { classifyRelation, parseRelationLines } from './relations';

const chars = (ownerGender: MirrorGender = null): MirrorContext => ({ ownerKind: 'character', targetKind: 'character', ownerGender });

/** What the editor shows under the adder: the save path's own word, then the text. */
const preview = (other: string, self: string, word: string, ctx: MirrorContext, locale = 'en') =>
	mirrorPreviewText(other, self, mirrorWord(word, ctx), locale);

describe('relationSentence — the word names the linked person', () => {
	it('reads a Child line the right way round', () => {
		// Konrad's sheet: `Child: [[Tobin Ferrow]]` means Tobin is Konrad's child.
		expect(relationSentence('Tobin Ferrow', 'Konrad', 'Child', 'en')).toBe('Tobin Ferrow is Konrad’s child');
	});

	it('agrees with how the Story Tree classifies the stored line', () => {
		// The registry reads `Child: [[X]]` as X below the owner — the sentence must say the same.
		const [rel] = parseRelationLines('Child: [[Tobin Ferrow]]');
		expect(classifyRelation(rel.label).category).toBe('child');
		expect(relationSentence(rel.target, 'Konrad', rel.label, 'en')).toMatch(/^Tobin Ferrow is Konrad’s child$/);
		const [up] = parseRelationLines('Grandmother: [[Tull]]');
		expect(classifyRelation(up.label).category).toBe('parent');
		expect(relationSentence(up.target, 'Mara', up.label, 'en')).toBe('Tull is Mara’s grandmother');
	});

	it.each([
		['Aunt', 'Ilse is Mara’s aunt'],
		['Niece/Nephew', 'Ilse is Mara’s niece/nephew'],
		['Guardian', 'Ilse is Mara’s guardian'],
		['Step-parent', 'Ilse is Mara’s step-parent'],
		['Parent-in-law', 'Ilse is Mara’s parent-in-law'],
		['Sibling', 'Ilse is Mara’s sibling'],
		['Best Friend', 'Ilse is Mara’s best friend'],
	])('%s', (word, sentence) => {
		expect(relationSentence('Ilse', 'Mara', word, 'en')).toBe(sentence);
	});

	it('turns round for words that describe the sheet’s owner', () => {
		// "Ancestor of: [[Tobin]]" on Konrad: the registry puts Tobin BELOW Konrad.
		expect(classifyRelation('Ancestor of').category).toBe('child');
		expect(relationSentence('Tobin', 'Konrad', 'Ancestor of', 'en')).toBe('Konrad is ancestor of Tobin');
		expect(relationSentence('Saltmarch', 'Konrad', 'Resident of', 'en')).toBe('Konrad is resident of Saltmarch');
		expect(relationSentence('Tull', 'Konrad', 'Trained by', 'en')).toBe('Konrad is trained by Tull');
		expect(relationSentence('Tull', 'Konrad', 'Reports to', 'en')).toBe('Konrad reports to Tull');
		expect(relationSentence('Bo', 'Konrad', 'Trains', 'en')).toBe('Konrad trains Bo');
	});

	it('uses “this character” before the sheet has a name', () => {
		expect(relationSentence('Tobin Ferrow', '  ', 'Child', 'en')).toBe('Tobin Ferrow is this character’s child');
		expect(relationSentence('Tobin Ferrow', '', 'Child', 'es')).toBe('Tobin Ferrow es child de este personaje');
		expect(relationSentence('Tobin Ferrow', '', 'Child', 'fr')).toBe('Tobin Ferrow est child de ce personnage');
		expect(relationSentence('Mara', '', 'Leader', 'en', { isCharacter: false })).toBe('Mara is this entry’s leader');
	});

	it('Spanish and French: “{other} es/est {word} de {self}”', () => {
		expect(relationSentence('Tobin Ferrow', 'Konrad', 'Child', 'es')).toBe('Tobin Ferrow es child de Konrad');
		expect(relationSentence('Tobin Ferrow', 'Konrad', 'Child', 'fr')).toBe('Tobin Ferrow est child de Konrad');
		expect(relationSentence('Tobin', 'Konrad', 'Ancestor of', 'es')).toBe('Konrad es ancestor of Tobin');
	});

	it('French elides “de” before a vowel or silent h', () => {
		expect(relationSentence('Tobin', 'Anna', 'Child', 'fr')).toBe('Tobin est child d’Anna');
		expect(relationSentence('Tobin', 'Hélène', 'Child', 'fr')).toBe('Tobin est child d’Hélène');
		expect(relationSentence('Tobin', 'Konrad', 'Child', 'fr')).toBe('Tobin est child de Konrad');
		// Spanish never elides.
		expect(relationSentence('Tobin', 'Anna', 'Child', 'es')).toBe('Tobin es child de Anna');
	});

	it('an unknown locale falls back to English', () => {
		expect(relationSentence('Tobin', 'Konrad', 'Child', 'sv')).toBe('Tobin is Konrad’s child');
	});

	it('a name with braces is never read as a placeholder', () => {
		expect(relationSentence('{self}', 'The {word} Vault', 'Child', 'en')).toBe('{self} is The {word} Vault’s child');
	});
});

describe('relationSentenceParts — slots for the editor’s button and dropdown', () => {
	it('English noun: [person] is Konrad’s [word]', () => {
		expect(relationSentenceParts('Konrad', 'Child', 'en')).toEqual([
			{ type: 'other' }, { type: 'text', text: ' is Konrad’s ' }, { type: 'word' },
		]);
	});
	it('Spanish noun: [person] es [word] de Konrad', () => {
		expect(relationSentenceParts('Konrad', 'Child', 'es')).toEqual([
			{ type: 'other' }, { type: 'text', text: ' es ' }, { type: 'word' }, { type: 'text', text: ' de Konrad' },
		]);
	});
	it('phrase: Konrad is [word] [person]', () => {
		expect(relationSentenceParts('Konrad', 'Resident of', 'en')).toEqual([
			{ type: 'text', text: 'Konrad is ' }, { type: 'word' }, { type: 'text', text: ' ' }, { type: 'other' },
		]);
	});
	it('shapes', () => {
		expect(relationWordShape('Child')).toBe('noun');
		expect(relationWordShape('Married to')).toBe('phrase');
		expect(relationWordShape('Lives in')).toBe('verb');
	});
});

describe('mirror preview — the real mirror, never a second table', () => {
	it('a Child line previews as Parent on the other sheet', () => {
		expect(preview('Tobin Ferrow', 'Konrad', 'Child', chars())).toBe('Tobin Ferrow’s sheet will say: Parent: Konrad');
	});

	it('uses the sheet’s Gender, like the save does', () => {
		expect(preview('Tobin', 'Konrad', 'Child', chars('male'))).toBe('Tobin’s sheet will say: Father: Konrad');
		expect(preview('Tull', 'Mara', 'Grandmother', chars('female'))).toBe('Tull’s sheet will say: Granddaughter: Mara');
		expect(preview('Tull', 'Mara', 'Grandmother', chars())).toBe('Tull’s sheet will say: Grandchild: Mara');
		expect(preview('Ilse', 'Mara', 'Aunt', chars('male'))).toBe('Ilse’s sheet will say: Nephew: Mara');
		expect(preview('Ilse', 'Mara', 'Niece', chars('female'))).toBe('Ilse’s sheet will say: Aunt: Mara');
		expect(preview('Bo', 'Mara', 'Guardian', chars())).toBe('Bo’s sheet will say: Ward: Mara');
		expect(preview('Bo', 'Mara', 'Step-child', chars('male'))).toBe('Bo’s sheet will say: Stepfather: Mara');
		expect(preview('Bo', 'Mara', 'Child-in-law', chars())).toBe('Bo’s sheet will say: Parent-in-law: Mara');
	});

	it('symmetric words come back as themselves', () => {
		expect(preview('Bo', 'Mara', 'Sibling', chars('female'))).toBe('Bo’s sheet will say: Sister: Mara');
		expect(preview('Bo', 'Mara', 'Spouse', chars())).toBe('Bo’s sheet will say: Spouse: Mara');
		expect(preview('Bo', 'Mara', 'Friend', chars())).toBe('Bo’s sheet will say: Friend: Mara');
	});

	it('custom types follow the writer’s own pair', () => {
		const ctx: MirrorContext = {
			...chars(),
			customTypes: [
				{ id: 'p', label: 'Professor', color: '#000', reciprocal: 's' },
				{ id: 's', label: 'Student', color: '#000', reciprocal: 'p' },
				{ id: 'a', label: 'Admires', color: '#000', reciprocal: 'none' },
			],
		};
		expect(preview('Bo', 'Mara', 'Professor', ctx)).toBe('Bo’s sheet will say: Student: Mara');
		expect(preview('Bo', 'Mara', 'Admires', ctx)).toBe('Nothing is added to Bo’s sheet — this one goes one way only.');
	});

	it('says plainly when nothing is written', () => {
		expect(preview('Saltmarch', 'Mara', 'Resident of', { ownerKind: 'character', targetKind: 'location' }))
			.toBe('Nothing is added to Saltmarch’s sheet — this one goes one way only.');
		expect(mirrorPreviewText('Bo', 'Mara', null, 'en', 'noSheet')).toBe('Bo has no sheet in this project, so only this sheet changes.');
	});

	it('before the sheet has a name', () => {
		expect(preview('Tobin', '', 'Child', chars())).toBe('Tobin’s sheet will say: Parent: this character');
	});

	it('Spanish and French', () => {
		expect(preview('Tobin', 'Konrad', 'Child', chars(), 'es')).toBe('La ficha de Tobin dirá: Parent: Konrad');
		expect(preview('Tobin', 'Konrad', 'Child', chars(), 'fr')).toBe('La fiche de Tobin indiquera : Parent: Konrad');
		expect(preview('Anna', 'Konrad', 'Child', chars(), 'fr')).toBe('La fiche d’Anna indiquera : Parent: Konrad');
	});
});

describe('sentenceShapeFor — only a sentence when the direction is certain', () => {
	it('a person’s role in a group reads from the person: “Konrad is Council’s leader”', () => {
		// The map and tree read "Leader: [[Council]]" on Konrad as Konrad leading the Council.
		const shape = sentenceShapeFor('Leader', { ownerKind: 'character', targetKind: 'faction' });
		expect(shape).toBe('role');
		expect(relationSentence('Council', 'Konrad', 'Leader', 'en', { shape })).toBe('Konrad is Council’s leader');
		expect(relationSentence('Council', 'Konrad', 'Member', 'es', { shape: sentenceShapeFor('Member', { ownerKind: 'character', targetKind: 'faction' }) }))
			.toBe('Konrad es member de Council');
		expect(relationSentence('Ordre', 'Konrad', 'Leader', 'fr', { shape })).toBe('Konrad est leader d’Ordre');
	});
	it('the group’s own line, and a person-to-person line, keep the noun reading', () => {
		expect(sentenceShapeFor('Leader', { ownerKind: 'faction', targetKind: 'character' })).toBe('noun');
		expect(sentenceShapeFor('Leader', { ownerKind: 'character', targetKind: 'character' })).toBe('noun');
		expect(sentenceShapeFor('Commander', { ownerKind: 'character', targetKind: 'faction' })).toBe('role');
	});
	it('the writer’s own types and unknown words stay “Word: Name”', () => {
		const customTypes = [{ id: 'x', label: 'Protects', color: '#000', reciprocal: 'none' as const }];
		const shape = sentenceShapeFor('Protects', { customTypes });
		expect(shape).toBe('plain');
		expect(relationSentence('Tobin', 'Konrad', 'Protects', 'en', { shape })).toBe('Protects: Tobin');
		expect(sentenceShapeFor('Grew up with')).toBe('plain');
	});
	it('the three words once filed backwards now read as sentences', () => {
		for (const w of ['Superior of', 'Sworn to', 'Sponsored by']) expect(sentenceShapeFor(w)).toBe('phrase');
		expect(sentenceShapeFor('Child')).toBe('noun');
		expect(sentenceShapeFor('Ancestor of')).toBe('phrase');
		expect(sentenceShapeFor('Reports to')).toBe('verb');
	});
	it('picking the sheet itself says so', () => {
		expect(mirrorPreviewText('Konrad', 'Konrad', null, 'en', 'self')).toBe('That is this sheet itself — pick someone else.');
	});
});
