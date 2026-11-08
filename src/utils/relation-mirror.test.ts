import {
	applyMirrorEdit,
	relabelForGender,
	genderFromFields,
	isFamilyLabel,
	mirrorWord,
	MirrorContext,
	planMirrorEdits,
	sameRelationWord,
	wordGroupsForTest,
} from './relation-mirror';
import {
	COMMON_RELATION_CHOICES,
	CustomRelationshipType,
	RELATIONSHIP_TYPE_OTHER,
	RelEntity,
	RelationLine,
	buildRelationGraph,
	classifyRelation,
	parseRelationLines,
} from './relations';
import { buildTreeData, kinReadingOf } from './story-tree';

const people: MirrorContext = { ownerKind: 'character', targetKind: 'character' };
const mirror = (label: string, ctx: MirrorContext = people) => mirrorWord(label, ctx);

describe('mirrorWord — the exact counterpart, never a broader word', () => {
	test.each([
		['Grandmother', 'Grandchild'],
		['grandfather', 'Grandchild'],
		['Grandparent', 'Grandchild'],
		['Granddaughter', 'Grandparent'],
		['Grandchild', 'Grandparent'],
		['Great-grandmother', 'Great-grandchild'],
		['Great-grandson', 'Great-grandparent'],
		['Mother', 'Child'],
		['Father', 'Child'],
		['Son', 'Parent'],
		['Daughter', 'Parent'],
		['Aunt', 'Niece/Nephew'],
		['Uncle', 'Niece/Nephew'],
		['Niece', 'Aunt/Uncle'],
		['Nephew', 'Aunt/Uncle'],
		['Great-aunt', 'Great-niece/nephew'],
		['Guardian', 'Ward'],
		['Ward', 'Guardian'],
		['Foster mother', 'Foster child'],
		['Foster son', 'Foster parent'],
		['Adoptive father', 'Adopted child'],
		['Stepmother', 'Step-child'],
		['Step-parent', 'Step-child'],
		['Stepdaughter', 'Step-parent'],
		['Mother-in-law', 'Child-in-law'],
		['Son-in-law', 'Parent-in-law'],
		['Brother-in-law', 'Sibling-in-law'],
		['Brother', 'Sibling'],
		['Sister', 'Sibling'],
		['Sibling', 'Sibling'],
		['Twin', 'Twin'],
		['Half-sister', 'Half-sibling'],
		['Stepbrother', 'Step-sibling'],
		['Cousin', 'Cousin'],
		['Husband', 'Spouse'],
		['Wife', 'Spouse'],
		['Fiancée', 'Betrothed'],
		['Ex-wife', 'Ex-spouse'],
	])('%s → %s', (label, expected) => {
		expect(mirror(label)).toBe(expected);
	});

	test('the non-family pairs keep their counterparts', () => {
		expect(mirror('Mentor')).toBe('Apprentice');
		expect(mirror('Apprentice')).toBe('Mentor');
		expect(mirror('Ruler')).toBe('Vassal');
		expect(mirror('Vassal')).toBe('Ruler');
		expect(mirror('Benefactor')).toBe('Beneficiary');
		expect(mirror('Beneficiary')).toBe('Benefactor');
		// A patron IS the one who gives support, so it is the benefactor's own word.
		expect(mirror('Patron')).toBe('Beneficiary');
		expect(mirror('Commander')).toBe('Subordinate');
		expect(mirror('Subordinate')).toBe('Commander');
		expect(mirror('Ancestor of')).toBe('Descendant of');
		expect(mirror('Descendant of')).toBe('Ancestor of');
		expect(mirror('Leader')).toBe('Member');
		expect(mirror('Member')).toBe('Leader');
		expect(mirror('Teacher')).toBe('Student');
	});

	test('rank words whose direction is uncertain write nothing back (never the inverse)', () => {
		for (const w of ['Boss', 'President', 'Head', 'Chief', 'King', 'Queen', 'Lord', 'Subject', 'Master', 'Soldier', 'Follower']) {
			expect([w, mirror(w)]).toEqual([w, null]);
		}
	});

	test('between a person and a group only role words are mirrored', () => {
		expect(mirror('Vassal', { ownerKind: 'faction', targetKind: 'character' })).toBeNull();
		expect(mirror('Subject', { ownerKind: 'faction', targetKind: 'character' })).toBeNull();
		expect(mirror('Reports to', { ownerKind: 'character', targetKind: 'faction' })).toBeNull();
		expect(mirror('Ally', { ownerKind: 'character', targetKind: 'faction' })).toBe('Ally');
	});

	test('a plural word becomes the singular (one person)', () => {
		expect(mirror('Allies')).toBe('Ally');
		expect(mirror('Friends')).toBe('Friend');
		expect(mirror('Enemies')).toBe('Enemy');
		expect(mirror('Rivals')).toBe('Rival');
		expect(mirror('Partners')).toBe('Partner');
		expect(mirror('Mentors')).toBe('Apprentice');
	});

	test('symmetric ties keep the writer\'s own word', () => {
		expect(mirror('Rival')).toBe('Rival');
		expect(mirror('Best Friend')).toBe('Best Friend');
		expect(mirror('ally')).toBe('Ally');
		expect(mirror('Enemy')).toBe('Enemy');
		expect(mirror('Partner')).toBe('Partner');
	});

	test('one-way feelings, world links and unknown words write nothing back', () => {
		expect(mirror('Unrequited love')).toBeNull();
		expect(mirror('Crush on')).toBeNull();
		expect(mirror('Resident of')).toBeNull();
		expect(mirror('Member of')).toBeNull();
		expect(mirror('Owner of')).toBeNull();
		expect(mirror('Neighbour')).toBeNull();
		expect(mirror('')).toBeNull();
	});

	test('family words are only mirrored between two characters', () => {
		expect(mirror('Grandmother', { ownerKind: 'character', targetKind: 'location' })).toBeNull();
		expect(mirror('Mother', { ownerKind: 'faction', targetKind: 'character' })).toBeNull();
	});

	test('a role in a group reads the same from both sheets', () => {
		expect(mirror('Member', { ownerKind: 'character', targetKind: 'faction' })).toBe('Member');
		expect(mirror('Leader', { ownerKind: 'faction', targetKind: 'character' })).toBe('Leader');
		// …but "Member of" is a world link: nothing goes onto the faction sheet.
		expect(mirror('Member of', { ownerKind: 'character', targetKind: 'faction' })).toBeNull();
	});

	test('custom types: pair, symmetric, one-way, and a pair whose partner is gone', () => {
		const customTypes: CustomRelationshipType[] = [
			{ id: 'p', label: 'Professor', color: '#000', reciprocal: 's' },
			{ id: 's', label: 'Student', color: '#000', reciprocal: 'p' },
			{ id: 'b', label: 'Blood-sworn', color: '#000', reciprocal: 'self' },
			{ id: 'o', label: 'Haunts', color: '#000', reciprocal: 'none' },
			{ id: 'x', label: 'Orphaned', color: '#000', reciprocal: 'missing' },
		];
		const ctx = { ...people, customTypes };
		expect(mirror('Professor', ctx)).toBe('Student');
		expect(mirror('student', ctx)).toBe('Professor'); // custom wins over the stock "student"
		expect(mirror('Blood-sworn', ctx)).toBe('Blood-sworn');
		expect(mirror('Haunts', ctx)).toBeNull();
		expect(mirror('Orphaned', ctx)).toBeNull();
	});

	test('every editor dropdown choice writes exactly what the mirror writes', () => {
		for (const c of COMMON_RELATION_CHOICES) {
			// World links: the dropdown says null and so does the mirror.
			expect([c.label, mirror(c.label)]).toEqual([c.label, c.reciprocal]);
		}
	});

	test('the dropdown offers the extended family', () => {
		const labels = COMMON_RELATION_CHOICES.map((c) => c.label);
		for (const w of ['Grandparent', 'Grandchild', 'Aunt', 'Uncle', 'Niece', 'Nephew', 'Cousin', 'Guardian', 'Ward', 'Step-parent', 'Step-child', 'Parent-in-law', 'Child-in-law']) {
			expect(labels).toContain(w);
		}
	});
});

describe('the table of opposites stays consistent with the registry and the Story Tree', () => {
	const groups = wordGroupsForTest();
	const byId = new Map(groups.map((g) => [g.id, g]));

	test('every pair points back at itself', () => {
		for (const g of groups) {
			if (!g.opposite) continue;
			expect([g.id, byId.get(g.opposite)?.opposite]).toEqual([g.id, g.id]);
		}
	});

	test('no word belongs to two groups, and each neutral word is one of its own words', () => {
		const seen = new Map<string, string>();
		for (const g of groups) {
			expect(g.words).toContain(g.neutral.toLowerCase());
			for (const w of g.words) {
				expect([w, seen.get(w)]).toEqual([w, undefined]);
				seen.set(w, g.id);
			}
		}
	});

	test('every word is known to the map registry', () => {
		for (const g of groups) for (const w of g.words) {
			expect([w, classifyRelation(w).id !== RELATIONSHIP_TYPE_OTHER.id]).toEqual([w, true]);
		}
	});

	test('the tree reads a word and its counterpart as opposite ends of the same step', () => {
		for (const g of groups) {
			if (!g.opposite || !g.tree) continue;
			const o = byId.get(g.opposite)!;
			for (const w of g.words) {
				for (const ow of o.words) {
					const a = kinReadingOf(w);
					const b = kinReadingOf(ow);
					expect(a && b && 'up' in a && 'up' in b).toBe(true);
					if (a && b && 'up' in a && 'up' in b) {
						expect([w, ow, a.up, a.delta, a.kind]).toEqual([w, ow, !b.up, b.delta, b.kind]);
					}
				}
			}
		}
	});

	test('parent/child-category words keep that category on both ends (the tree draws them as lines)', () => {
		for (const id of ['parent', 'grandparent', 'step-parent']) {
			for (const w of byId.get(id)!.words) expect([w, classifyRelation(w).category]).toEqual([w, 'parent']);
			for (const w of byId.get(byId.get(id)!.opposite!)!.words) expect([w, classifyRelation(w).category]).toEqual([w, 'child']);
		}
	});

	test('great-grandparents stay out of the parent category, so existing maps and loop warnings keep their shape', () => {
		expect(classifyRelation('Great-grandmother').category).toBe('other');
		expect(classifyRelation('Great-grandson').category).toBe('other');
		expect(kinReadingOf('Great-grandmother')).toEqual({ up: true, delta: 3, kind: 'line' });
	});

	test('great-aunts sit two rows up, great-nieces two rows down', () => {
		expect(kinReadingOf('Great-aunt')).toEqual({ up: true, delta: 2, kind: 'kin' });
		expect(kinReadingOf('Great-niece/nephew')).toEqual({ up: false, delta: 2, kind: 'kin' });
	});

	test('the dashboard counts the extended family as family', () => {
		for (const w of ['Grandchild', 'Ward', 'Cousin', 'Aunt/Uncle', 'Mother']) expect(isFamilyLabel(w)).toBe(true);
		expect(isFamilyLabel('Rival')).toBe(false);
	});
});

describe('sameRelationWord', () => {
	test('exact or the same group', () => {
		expect(sameRelationWord('Granddaughter', 'Grandchild')).toBe(true);
		expect(sameRelationWord('grandchild', 'Grandchild')).toBe(true);
		expect(sameRelationWord('Rival', 'rival')).toBe(true);
	});
	test('registry synonyms and other relationships do not count', () => {
		expect(sameRelationWord('Friend', 'Confidant')).toBe(false);
		expect(sameRelationWord('Child', 'Grandchild')).toBe(false);
		expect(sameRelationWord('Ward', 'Grandchild')).toBe(false);
	});
});

describe('planMirrorEdits — only what changed', () => {
	const lines = (text: string): RelationLine[] => parseRelationLines(text);
	const byName = (rel: RelationLine) => {
		const word = mirror(rel.label);
		return word ? { key: rel.target, word } : null;
	};

	test('adding a line adds the counterpart', () => {
		expect(planMirrorEdits([], lines('Grandmother: [[Grandmother Tull]]'), byName))
			.toEqual([{ key: 'Grandmother Tull', add: ['Grandchild'], remove: [] }]);
	});

	test('untouched lines are never mirrored again', () => {
		const text = 'Grandmother: [[Grandmother Tull]]\nRival: [[Halvard Crane]] (intensity 4)';
		expect(planMirrorEdits(lines(text), lines(text), byName)).toEqual([]);
	});

	test('a changed word is a remove plus an add on the same sheet', () => {
		expect(planMirrorEdits(lines('Guardian: [[Tull]]'), lines('Grandmother: [[Tull]]'), byName))
			.toEqual([{ key: 'Tull', add: ['Grandchild'], remove: ['Ward'] }]);
	});

	test('a changed person moves the counterpart', () => {
		expect(planMirrorEdits(lines('Mentor: [[Old Sepp]]'), lines('Mentor: [[Nessa Quillon]]'), byName)).toEqual([
			{ key: 'Old Sepp', add: [], remove: ['Apprentice'] },
			{ key: 'Nessa Quillon', add: ['Apprentice'], remove: [] },
		]);
	});

	test('two words with the same counterpart cancel out; intensity changes are not a change', () => {
		expect(planMirrorEdits(lines('Mother: [[Ilse]]'), lines('Parent: [[Ilse]]'), byName)).toEqual([]);
		expect(planMirrorEdits(lines('Rival: [[H]] (intensity 2)'), lines('Rival: [[H]] (intensity 9)'), byName)).toEqual([]);
	});

	test('removing one of two lines with the same counterpart keeps it', () => {
		expect(planMirrorEdits(lines('Mother: [[Ilse]]\nParent: [[Ilse]]'), lines('Mother: [[Ilse]]'), byName)).toEqual([]);
	});

	test('a removed line removes the counterpart; one-way lines produce nothing', () => {
		expect(planMirrorEdits(lines('Grandmother: [[Tull]]\nCrush on: [[Nessa]]'), lines(''), byName))
			.toEqual([{ key: 'Tull', add: [], remove: ['Grandchild'] }]);
	});
});

describe('applyMirrorEdit — the other sheet\'s Relationships text', () => {
	const owner = (t: string) => t.toLowerCase() === 'mara ferrow';
	const base = { ownerName: 'Mara Ferrow', isOwner: owner };

	test('adds the line at the end, keeping everything else', () => {
		const text = 'Ward: [[Bex Ferrow-Tull]]\nShe keeps the ledger.';
		expect(applyMirrorEdit(text, { ...base, add: ['Grandchild'], remove: [] })).toEqual({
			text: 'Ward: [[Bex Ferrow-Tull]]\nShe keeps the ledger.\nGrandchild: [[Mara Ferrow]]',
			added: ['Grandchild: Mara Ferrow'],
			removed: [],
		});
	});

	test('into an empty field', () => {
		expect(applyMirrorEdit('', { ...base, add: ['Grandchild'], remove: [] }).text).toBe('Grandchild: [[Mara Ferrow]]');
	});

	test('never writes a duplicate — exact, another form of the word, or elsewhere on the sheet', () => {
		for (const text of ['Grandchild: [[Mara Ferrow]]', 'Granddaughter: [[Mara Ferrow|Mara]]', 'grandchild: [[Mara Ferrow]] (intensity 3)']) {
			expect(applyMirrorEdit(text, { ...base, add: ['Grandchild'], remove: [] })).toEqual({ text, added: [], removed: [] });
		}
		const elsewhere = parseRelationLines('Grandchild: [[Mara Ferrow]]');
		expect(applyMirrorEdit('', { ...base, add: ['Grandchild'], remove: [], elsewhere }).text).toBe('');
	});

	test('Student and Apprentice mean the same: not added twice, and removed together — never one without the other', () => {
		expect(applyMirrorEdit('Student: [[Mara Ferrow]]', { ...base, add: ['Apprentice'], remove: [] }).added).toEqual([]);
		expect(applyMirrorEdit('Student: [[Mara Ferrow]]', { ...base, add: [], remove: ['Apprentice'] }).text).toBe('');
		// Mentor → Rival on Mara: Sepp ends with Rival only, no stale Student.
		expect(applyMirrorEdit('Student: [[Mara Ferrow]]', { ...base, add: ['Rival'], remove: ['Apprentice'] }).text).toBe('Rival: [[Mara Ferrow]]');
	});

	test('a stale "Child" never passes for "Grandchild", and is not removed by it', () => {
		expect(applyMirrorEdit('Child: [[Mara Ferrow]]', { ...base, add: ['Grandchild'], remove: [] }).text)
			.toBe('Child: [[Mara Ferrow]]\nGrandchild: [[Mara Ferrow]]');
		expect(applyMirrorEdit('Child: [[Mara Ferrow]]', { ...base, add: [], remove: ['Grandchild'] }).removed).toEqual([]);
	});

	test('Friend and Ally are different words: neither blocks nor removes the other', () => {
		expect(applyMirrorEdit('Friend: [[Mara Ferrow]]', { ...base, add: ['Ally'], remove: [] }).added).toEqual(['Ally: Mara Ferrow']);
		expect(applyMirrorEdit('Friend: [[Mara Ferrow]]', { ...base, add: [], remove: ['Ally'] }).removed).toEqual([]);
	});

	test('a line with words around its links is the writer\'s sentence and is never cut', () => {
		for (const text of ['Grandchild: [[Mara Ferrow]] and her friend [[Bo]]', 'Grandchildren: [[Bo]] and [[Mara Ferrow]]']) {
			expect(applyMirrorEdit(text, { ...base, add: [], remove: ['Grandchild'] })).toEqual({ text, added: [], removed: [] });
		}
		expect(applyMirrorEdit('Grandchildren: [[Bo]], [[Mara Ferrow]] (intensity 3)', { ...base, add: [], remove: ['Grandchild'] }).text)
			.toBe('Grandchildren: [[Bo]] (intensity 3)');
	});

	test('a CRLF field stays CRLF', () => {
		const text = 'Grandchild: [[Mara Ferrow]]\r\nWard: [[Bex]]\r\nRival: [[Tobin]]';
		expect(applyMirrorEdit(text, { ...base, add: ['Cousin'], remove: ['Grandchild'] }).text)
			.toBe('Ward: [[Bex]]\r\nRival: [[Tobin]]\r\nCousin: [[Mara Ferrow]]');
	});

	test('a different relationship to the same person is kept and the new one added', () => {
		expect(applyMirrorEdit('Rival: [[Mara Ferrow]]', { ...base, add: ['Grandchild'], remove: [] }).text)
			.toBe('Rival: [[Mara Ferrow]]\nGrandchild: [[Mara Ferrow]]');
	});

	test('removes only the exact mirror, and every copy of it', () => {
		const text = 'Grandchild: [[Mara Ferrow]]\nRival: [[Mara Ferrow]]\nGrandchild: [[Tobin Ferrow]]\nGranddaughter: [[Mara Ferrow]]';
		expect(applyMirrorEdit(text, { ...base, add: [], remove: ['Grandchild'] })).toEqual({
			text: 'Rival: [[Mara Ferrow]]\nGrandchild: [[Tobin Ferrow]]',
			added: [],
			removed: ['Grandchild: Mara Ferrow', 'Granddaughter: Mara Ferrow'],
		});
	});

	test('on a shared line only the owner\'s link goes', () => {
		expect(applyMirrorEdit('Grandchildren: [[Tobin Ferrow]], [[Mara Ferrow]]', { ...base, add: [], remove: ['Grandchild'] }).text)
			.toBe('Grandchildren: [[Tobin Ferrow]]');
	});

	test('a remove with nothing to remove changes nothing', () => {
		const text = 'Ward: [[Bex Ferrow-Tull]]';
		expect(applyMirrorEdit(text, { ...base, add: [], remove: ['Grandchild'] })).toEqual({ text, added: [], removed: [] });
	});

	test('change the word: the old mirror goes, the new one arrives', () => {
		expect(applyMirrorEdit('Ward: [[Mara Ferrow]]', { ...base, add: ['Grandchild'], remove: ['Ward'] }).text)
			.toBe('Grandchild: [[Mara Ferrow]]');
	});
});

describe('end to end: Grandmother on Mara\'s sheet draws Mara two rows under Tull', () => {
	const sheet = (name: string, text: string): RelEntity => ({
		path: `Saltmarch/Codex/Characters/${name}.md`, name, kind: 'character', sections: { Relationships: text },
	});

	test('Mara two generations below Tull, from either sheet', () => {
		const mara = 'Grandmother: [[Grandmother Tull]]';
		const tullText = applyMirrorEdit('', { ownerName: 'Mara Ferrow', isOwner: () => true, add: [mirror('Grandmother')!], remove: [] }).text;
		expect(tullText).toBe('Grandchild: [[Mara Ferrow]]');
		for (const entities of [
			[sheet('Mara Ferrow', mara), sheet('Grandmother Tull', '')],
			[sheet('Mara Ferrow', ''), sheet('Grandmother Tull', tullText)],
			[sheet('Mara Ferrow', mara), sheet('Grandmother Tull', tullText)],
		]) {
			const tree = buildTreeData(entities, buildRelationGraph(entities), 'family');
			const gen = (n: string) => tree.nodes.find((x) => x.name === n)?.generation;
			expect((gen('Mara Ferrow') ?? 0) - (gen('Grandmother Tull') ?? 0)).toBe(2);
		}
	});

	test('Aunt/Uncle and Niece/Nephew read as the same one-row step', () => {
		const a = [sheet('Mara Ferrow', 'Aunt/Uncle: [[Ilse]]'), sheet('Ilse', '')];
		const b = [sheet('Mara Ferrow', ''), sheet('Ilse', 'Niece/Nephew: [[Mara Ferrow]]')];
		for (const entities of [a, b]) {
			const tree = buildTreeData(entities, buildRelationGraph(entities), 'family');
			const gen = (n: string) => tree.nodes.find((x) => x.name === n)?.generation;
			expect((gen('Mara Ferrow') ?? 0) - (gen('Ilse') ?? 0)).toBe(1);
		}
	});
});

describe('gender — the written word describes the sheet owner, in their gender', () => {
	const as = (ownerGender: 'female' | 'male' | 'nonbinary' | null) => ({ ...people, ownerGender });

	test('Female / Male pick the form; empty or non-binary keeps the neutral word', () => {
		expect(mirror('Aunt', as('female'))).toBe('Niece');
		expect(mirror('Aunt', as('male'))).toBe('Nephew');
		expect(mirror('Aunt', as(null))).toBe('Niece/Nephew');
		expect(mirror('Niece', as('male'))).toBe('Uncle');
		expect(mirror('Grandmother', as('female'))).toBe('Granddaughter');
		expect(mirror('Grandmother', as('male'))).toBe('Grandson');
		expect(mirror('Granddaughter', as('female'))).toBe('Grandmother');
		expect(mirror('Mother', as('male'))).toBe('Son');
		expect(mirror('Son', as('female'))).toBe('Mother');
		expect(mirror('Brother', as('female'))).toBe('Sister');
		expect(mirror('Husband', as('female'))).toBe('Wife');
		expect(mirror('Stepmother', as('male'))).toBe('Stepson');
		expect(mirror('Mother-in-law', as('female'))).toBe('Daughter-in-law');
		expect(mirror('Great-grandfather', as('male'))).toBe('Great-grandson');
		expect(mirror('Great-uncle', as('female'))).toBe('Great-niece');
		expect(mirror('Fiancé', as('female'))).toBe('Fiancée');
		// Words without gendered forms stay as they are.
		expect(mirror('Guardian', as('female'))).toBe('Ward');
		expect(mirror('Cousin', as('male'))).toBe('Cousin');
		expect(mirror('Mentor', as('female'))).toBe('Apprentice');
	});

	test('reading the Gender field', () => {
		expect(genderFromFields([{ label: 'Gender', value: 'Female' }])).toBe('female');
		expect(genderFromFields([{ label: 'gender', value: 'male' }])).toBe('male');
		expect(genderFromFields([{ label: 'Gender', value: '' }])).toBeNull();
		expect(genderFromFields([])).toBeNull();
	});

	test('every gendered form is a word of its own group (so it reads back, draws, and is found for removal)', () => {
		for (const g of wordGroupsForTest()) {
			for (const form of [g.female, g.male]) if (form) expect([g.id, g.words.includes(form.toLowerCase())]).toEqual([g.id, true]);
		}
	});

	test('a Gender change rewords an untouched line\'s mirror; no change, no edit', () => {
		const rels = parseRelationLines('Grandmother: [[Tull]]\nRival: [[Halvard]]');
		const by = (before: 'female' | 'male' | null, after: 'female' | 'male' | null) => (rel: RelationLine, side: 'before' | 'after') => {
			const word = mirror(rel.label, as(side === 'before' ? before : after));
			return word ? { key: rel.target, word } : null;
		};
		expect(planMirrorEdits(rels, rels, by(null, 'female'))).toEqual([{ key: 'Tull', add: ['Granddaughter'], remove: ['Grandchild'] }]);
		expect(planMirrorEdits(rels, rels, by('female', 'female'))).toEqual([]);
	});

	const base = { ownerName: 'Mara Ferrow', isOwner: (t: string) => t.toLowerCase() === 'mara ferrow' };

	test('the reworded line stays where it was, annotation and all', () => {
		const text = 'Ward: [[Bex]]\n- Grandchild: [[Mara Ferrow|Mara]] (intensity 4)\nRival: [[Tobin]]';
		expect(applyMirrorEdit(text, { ...base, add: ['Granddaughter'], remove: ['Grandchild'] })).toEqual({
			text: 'Ward: [[Bex]]\n- Granddaughter: [[Mara Ferrow|Mara]] (intensity 4)\nRival: [[Tobin]]',
			added: ['Granddaughter: Mara Ferrow'],
			removed: ['Grandchild: Mara Ferrow'],
		});
	});

	test('a shared line is left as written', () => {
		const text = 'Grandchildren: [[Tobin Ferrow]], [[Mara Ferrow]]';
		expect(applyMirrorEdit(text, { ...base, add: ['Granddaughter'], remove: ['Grandchild'] })).toEqual({ text, added: [], removed: [] });
	});

	test('rewording never leaves two lines', () => {
		expect(applyMirrorEdit('Grandchild: [[Mara Ferrow]]\nGranddaughter: [[Mara Ferrow]]', { ...base, add: ['Grandson'], remove: ['Granddaughter'] })).toEqual({
			text: 'Grandson: [[Mara Ferrow]]',
			added: ['Grandson: Mara Ferrow'],
			removed: ['Grandchild: Mara Ferrow', 'Granddaughter: Mara Ferrow'],
		});
		expect(applyMirrorEdit('Grandson: [[Mara Ferrow]]\nGrandchild: [[Mara Ferrow]]', { ...base, add: ['Grandson'], remove: ['Grandchild'] }).text)
			.toBe('Grandson: [[Mara Ferrow]]');
	});

	test('nothing to reword: nothing is added (a Gender change never fills in an out-of-step sheet)', () => {
		expect(applyMirrorEdit('Enemy: [[Bo]]', { ...base, add: ['Niece'], remove: ['Niece/Nephew'] })).toEqual({ text: 'Enemy: [[Bo]]', added: [], removed: [] });
	});

	test('Non-binary reads as the neutral word', () => {
		expect(genderFromFields([{ label: 'Gender', value: 'Non-binary' }])).toBe('nonbinary');
		expect(mirror('Aunt', as('nonbinary'))).toBe('Niece/Nephew');
	});

	test('a link inside a trailing note keeps the line whole', () => {
		const text = 'Grandchild: [[Mara Ferrow]] (epoch [[The Flood]])';
		expect(applyMirrorEdit(text, { ...base, add: [], remove: ['Grandchild'] }).text).toBe(text);
		expect(applyMirrorEdit(text, { ...base, add: ['Granddaughter'], remove: ['Grandchild'] }).text).toBe(text);
	});

	test('a line with other words around it is never reworded', () => {
		const text = 'Grandchild: [[Mara Ferrow]] who never visits';
		expect(applyMirrorEdit(text, { ...base, add: ['Granddaughter'], remove: ['Grandchild'] }).text).toBe(text);
	});
});

describe('plurals and group roles', () => {
	const base = { ownerName: 'Mara Ferrow', isOwner: (t: string) => t.toLowerCase() === 'mara ferrow' };

	test('"Rivals" already says "Rival": no duplicate, and it is removed with it', () => {
		expect(sameRelationWord('Rivals', 'Rival')).toBe(true);
		expect(sameRelationWord('Allies', 'ally')).toBe(true);
		expect(applyMirrorEdit('Rivals: [[Mara Ferrow]]', { ...base, add: ['Rival'], remove: [] }).added).toEqual([]);
		expect(applyMirrorEdit('Allies: [[Mara Ferrow]], [[Bo]]', { ...base, add: [], remove: ['Ally'] }).text).toBe('Allies: [[Bo]]');
	});

	test('"Members: [[Guild]]" writes "Member" on the guild sheet', () => {
		expect(mirror('Members', { ownerKind: 'character', targetKind: 'faction' })).toBe('Member');
	});
});

describe('relabelForGender — a Gender changed outside the editor rewords lines about that person', () => {
	const isMara = (t: string) => t.toLowerCase() === 'mara ferrow';

	test('rewords one-link lines about the person to her gender, in place', () => {
		const text = 'Ward: [[Bex]]\n- Niece/Nephew: [[Mara Ferrow|Mara]] (intensity 4)\nGrandchild: [[Mara Ferrow]]\nRival: [[Mara Ferrow]]';
		expect(relabelForGender(text, isMara, 'female')).toEqual({
			text: 'Ward: [[Bex]]\n- Niece: [[Mara Ferrow|Mara]] (intensity 4)\nGranddaughter: [[Mara Ferrow]]\nRival: [[Mara Ferrow]]',
			changed: ['“Niece/Nephew” → “Niece: Mara Ferrow”', '“Grandchild” → “Granddaughter: Mara Ferrow”'],
		});
	});

	test('male, and non-binary back to the neutral word', () => {
		expect(relabelForGender('Niece: [[Mara Ferrow]]', isMara, 'male').text).toBe('Nephew: [[Mara Ferrow]]');
		expect(relabelForGender('Niece: [[Mara Ferrow]]', isMara, 'nonbinary').text).toBe('Niece/Nephew: [[Mara Ferrow]]');
		expect(relabelForGender('Wife: [[Mara Ferrow]]', isMara, 'male').text).toBe('Husband: [[Mara Ferrow]]');
	});

	test('lines about other people, shared lines, prose and words without gendered forms stay', () => {
		const text = [
			'Grandchild: [[Tobin Ferrow]]',
			'Grandchildren: [[Tobin Ferrow]], [[Mara Ferrow]]',
			'Grandchild: [[Mara Ferrow]] who never visits',
			'Grandchild: [[Mara Ferrow]] (epoch [[The Flood]])',
			'Ward: [[Mara Ferrow]]',
			'Cousin: [[Mara Ferrow]]',
		].join('\n');
		expect(relabelForGender(text, isMara, 'female')).toEqual({ text, changed: [] });
	});

	test('never leaves two lines saying the same thing', () => {
		expect(relabelForGender('Grandchild: [[Mara Ferrow]]\nGranddaughter: [[Mara Ferrow]]', isMara, 'female').text).toBe('Granddaughter: [[Mara Ferrow]]');
		expect(relabelForGender('Grandson: [[Mara Ferrow]]\nGrandchild: [[Mara Ferrow]]', isMara, 'female').text).toBe('Granddaughter: [[Mara Ferrow]]');
	});

	test('already right: nothing changes; CRLF stays CRLF', () => {
		expect(relabelForGender('Niece: [[Mara Ferrow]]', isMara, 'female').changed).toEqual([]);
		expect(relabelForGender('Ward: [[Bex]]\r\nNiece/Nephew: [[Mara Ferrow]]', isMara, 'female').text).toBe('Ward: [[Bex]]\r\nNiece: [[Mara Ferrow]]');
	});
});

describe('review fixes: nothing the writer added is lost', () => {
	const isMara = (t: string) => t.toLowerCase() === 'mara ferrow';
	const base = { ownerName: 'Mara Ferrow', isOwner: isMara };

	test('a line with a note is reworded, never dropped as a "duplicate"', () => {
		expect(relabelForGender('Brother: [[Mara Ferrow]] (intensity 3)\nSister: [[Mara Ferrow]]', isMara, 'female').text)
			.toBe('Sister: [[Mara Ferrow]] (intensity 3)\nSister: [[Mara Ferrow]]');
		expect(applyMirrorEdit('Grandson: [[Mara Ferrow]]\nGrandchild: [[Mara Ferrow]] (intensity 2)', { ...base, add: ['Grandson'], remove: ['Grandchild'] }).text)
			.toBe('Grandson: [[Mara Ferrow]]\nGrandson: [[Mara Ferrow]] (intensity 2)');
	});

	test('a single letter is not a gender (typing "f" on the way to "fluid")', () => {
		for (const v of ['f', 'm', 'F', 'M', 'fe', 'ma']) expect([v, genderFromFields([{ label: 'Gender', value: v }])]).toEqual([v, null]);
		expect(genderFromFields([{ label: 'Gender', value: 'Woman' }])).toBe('female');
	});

	test('a remove reports each line it takes out, as it stood, so a restore can put it back', () => {
		const taken: string[] = [];
		applyMirrorEdit('- Grandchild: [[Mara Ferrow|Mara]] (intensity 9, epoch The Flood)\nWard: [[Bex]]', {
			...base, add: [], remove: ['Grandchild'], onRemove: (rel) => taken.push(rel.raw ?? ''),
		});
		expect(taken).toEqual(['- Grandchild: [[Mara Ferrow|Mara]] (intensity 9, epoch The Flood)']);
	});
});
