import { EntityKind } from '../entities/entity-kinds';
import {
	CustomRelationshipType,
	GROUP_KINDS,
	NEUTRAL_AUNT_UNCLE,
	NEUTRAL_NIECE_NEPHEW,
	RELATIONSHIP_TYPE_OTHER,
	RelationLine,
	buildCustomRegistry,
	categorizeLabel,
	classifyRelation,
	groupRoleOf,
	parseRelationLines,
	removeRelationFromText,
} from './relations';

/**
 * Two-sided relationships: the word a relationship line puts on the OTHER sheet
 * (pure, no Obsidian imports).
 *
 * A line names the target's role: `Grandmother: [[Tull]]` on Mara's sheet means
 * Tull is Mara's grandmother, so Tull's sheet gets `Grandchild: [[Mara]]`. The
 * written word is always the exact counterpart — never a broader word that
 * changes the meaning ("Child" for a grandchild draws the tree a generation
 * off). No sheet records gender, so the counterpart is the neutral word.
 */

/** How the Story Tree draws a word: rows up/down from the sheet's owner, or the same row. */
export type TreeReading = { up: boolean; delta: number; kind: 'line' | 'kin' } | { same: true };

interface WordGroup {
	id: string;
	/** The word written on the other sheet when this group is the counterpart. */
	neutral: string;
	/** Forms for a person whose sheet says Female / Male. Missing = the neutral word for everyone. */
	female?: string;
	male?: string;
	/** Lowercase words that mean this relationship (gendered forms included). */
	words: readonly string[];
	/** Counterpart group id; omitted = symmetric (the counterpart is this group). */
	opposite?: string;
	/** Family words: only mirrored between two characters. */
	family: boolean;
	/**
	 * Groups that state the same relationship in other words (Teacher and Mentor)
	 * share a meaning — used both to avoid adding a duplicate and to find the
	 * line to remove, so the two can never disagree. Defaults to the id.
	 */
	meaning?: string;
	/** Story Tree reading. Omitted where the registry's parent/child/sibling reading already places it. */
	tree?: TreeReading;
}

const up = (delta: number, kind: 'line' | 'kin'): TreeReading => ({ up: true, delta, kind });
const down = (delta: number, kind: 'line' | 'kin'): TreeReading => ({ up: false, delta, kind });

/**
 * The table of opposites. Every word here is also known to the relationship
 * registry (map colour/legend) and, where it has a row, to the Story Tree —
 * `relation-mirror.test.ts` checks both, so a mirrored word always draws at the
 * right generation.
 */
const WORD_GROUPS: readonly WordGroup[] = [
	// ── Family: up and down ────────────────────────────────────────────────
	{ id: 'parent', neutral: 'Parent', female: 'Mother', male: 'Father', opposite: 'child', family: true,
		words: ['parent', 'parents', 'mother', 'father', 'mom', 'mum', 'dad', 'mor', 'far'] },
	{ id: 'child', neutral: 'Child', female: 'Daughter', male: 'Son', opposite: 'parent', family: true,
		words: ['child', 'children', 'son', 'daughter', 'sons', 'daughters', 'barn'] },
	{ id: 'grandparent', neutral: 'Grandparent', female: 'Grandmother', male: 'Grandfather', opposite: 'grandchild', family: true, tree: up(2, 'line'),
		words: ['grandparent', 'grandparents', 'grandmother', 'grandfather', 'grandma', 'grandpa', 'granny'] },
	{ id: 'grandchild', neutral: 'Grandchild', female: 'Granddaughter', male: 'Grandson', opposite: 'grandparent', family: true, tree: down(2, 'line'),
		words: ['grandchild', 'grandchildren', 'grandson', 'granddaughter', 'grandsons', 'granddaughters'] },
	{ id: 'great-grandparent', neutral: 'Great-grandparent', female: 'Great-grandmother', male: 'Great-grandfather', opposite: 'great-grandchild', family: true, tree: up(3, 'line'),
		words: ['great-grandparent', 'great-grandparents', 'great-grandmother', 'great-grandfather', 'great grandparent', 'great grandmother', 'great grandfather'] },
	{ id: 'great-grandchild', neutral: 'Great-grandchild', female: 'Great-granddaughter', male: 'Great-grandson', opposite: 'great-grandparent', family: true, tree: down(3, 'line'),
		words: ['great-grandchild', 'great-grandchildren', 'great-grandson', 'great-granddaughter', 'great grandchild', 'great grandson', 'great granddaughter'] },
	{ id: 'aunt-uncle', neutral: NEUTRAL_AUNT_UNCLE, female: 'Aunt', male: 'Uncle', opposite: 'niece-nephew', family: true, tree: up(1, 'kin'),
		words: ['aunt', 'uncle', 'aunts', 'uncles', NEUTRAL_AUNT_UNCLE.toLowerCase()] },
	{ id: 'niece-nephew', neutral: NEUTRAL_NIECE_NEPHEW, female: 'Niece', male: 'Nephew', opposite: 'aunt-uncle', family: true, tree: down(1, 'kin'),
		words: ['niece', 'nephew', 'nieces', 'nephews', NEUTRAL_NIECE_NEPHEW.toLowerCase()] },
	{ id: 'great-aunt-uncle', neutral: `Great-${NEUTRAL_AUNT_UNCLE.toLowerCase()}`, female: 'Great-aunt', male: 'Great-uncle', opposite: 'great-niece-nephew', family: true, tree: up(2, 'kin'),
		words: ['great-aunt', 'great-uncle', 'great aunt', 'great uncle', `great-${NEUTRAL_AUNT_UNCLE.toLowerCase()}`] },
	{ id: 'great-niece-nephew', neutral: `Great-${NEUTRAL_NIECE_NEPHEW.toLowerCase()}`, female: 'Great-niece', male: 'Great-nephew', opposite: 'great-aunt-uncle', family: true, tree: down(2, 'kin'),
		words: ['great-niece', 'great-nephew', 'great niece', 'great nephew', 'grandniece', 'grandnephew', `great-${NEUTRAL_NIECE_NEPHEW.toLowerCase()}`] },
	{ id: 'guardian', neutral: 'Guardian', opposite: 'ward', family: true, tree: up(1, 'kin'),
		words: ['guardian', 'guardians', 'legal guardian'] },
	{ id: 'ward', neutral: 'Ward', opposite: 'guardian', family: true, tree: down(1, 'kin'),
		words: ['ward', 'wards'] },
	{ id: 'foster-parent', neutral: 'Foster parent', female: 'Foster mother', male: 'Foster father', opposite: 'foster-child', family: true, tree: up(1, 'kin'),
		words: ['foster parent', 'foster parents', 'foster mother', 'foster father'] },
	{ id: 'foster-child', neutral: 'Foster child', female: 'Foster daughter', male: 'Foster son', opposite: 'foster-parent', family: true, tree: down(1, 'kin'),
		words: ['foster child', 'foster children', 'foster son', 'foster daughter'] },
	{ id: 'adoptive-parent', neutral: 'Adoptive parent', female: 'Adoptive mother', male: 'Adoptive father', opposite: 'adopted-child', family: true, tree: up(1, 'kin'),
		words: ['adoptive parent', 'adoptive parents', 'adoptive mother', 'adoptive father'] },
	{ id: 'adopted-child', neutral: 'Adopted child', female: 'Adopted daughter', male: 'Adopted son', opposite: 'adoptive-parent', family: true, tree: down(1, 'kin'),
		words: ['adopted child', 'adopted children', 'adopted son', 'adopted daughter'] },
	{ id: 'step-parent', neutral: 'Step-parent', female: 'Stepmother', male: 'Stepfather', opposite: 'step-child', family: true,
		words: ['step-parent', 'stepparent', 'step-parents', 'stepparents', 'stepmother', 'stepfather', 'step-mother', 'step-father'] },
	{ id: 'step-child', neutral: 'Step-child', female: 'Stepdaughter', male: 'Stepson', opposite: 'step-parent', family: true,
		words: ['step-child', 'stepchild', 'step-children', 'stepchildren', 'stepson', 'stepdaughter', 'step-son', 'step-daughter'] },
	{ id: 'parent-in-law', neutral: 'Parent-in-law', female: 'Mother-in-law', male: 'Father-in-law', opposite: 'child-in-law', family: true, tree: up(1, 'kin'),
		words: ['parent-in-law', 'parents-in-law', 'mother-in-law', 'father-in-law'] },
	{ id: 'child-in-law', neutral: 'Child-in-law', female: 'Daughter-in-law', male: 'Son-in-law', opposite: 'parent-in-law', family: true, tree: down(1, 'kin'),
		words: ['child-in-law', 'children-in-law', 'son-in-law', 'daughter-in-law'] },

	// ── Family: same row ───────────────────────────────────────────────────
	{ id: 'sibling', neutral: 'Sibling', female: 'Sister', male: 'Brother', family: true,
		words: ['sibling', 'siblings', 'brother', 'sister', 'brothers', 'sisters'] },
	{ id: 'twin', neutral: 'Twin', family: true, words: ['twin', 'twins', 'twin brother', 'twin sister'] },
	{ id: 'half-sibling', neutral: 'Half-sibling', female: 'Half-sister', male: 'Half-brother', family: true,
		words: ['half-sibling', 'half-siblings', 'half-brother', 'half-sister'] },
	{ id: 'step-sibling', neutral: 'Step-sibling', female: 'Stepsister', male: 'Stepbrother', family: true,
		words: ['step-sibling', 'stepsibling', 'step-siblings', 'stepsiblings', 'stepbrother', 'stepsister', 'step-brother', 'step-sister'] },
	{ id: 'sibling-in-law', neutral: 'Sibling-in-law', female: 'Sister-in-law', male: 'Brother-in-law', family: true,
		words: ['sibling-in-law', 'siblings-in-law', 'brother-in-law', 'sister-in-law'] },
	{ id: 'cousin', neutral: 'Cousin', family: true, tree: { same: true },
		words: ['cousin', 'cousins', 'first cousin'] },
	{ id: 'second-cousin', neutral: 'Second cousin', family: true, tree: { same: true }, words: ['second cousin'] },

	// ── Couples (gendered words → the neutral one) ─────────────────────────
	{ id: 'spouse', neutral: 'Spouse', female: 'Wife', male: 'Husband', family: false, words: ['spouse', 'spouses', 'husband', 'wife', 'married to'] },
	{ id: 'ex-spouse', neutral: 'Ex-spouse', female: 'Ex-wife', male: 'Ex-husband', family: false,
		words: ['ex-spouse', 'ex-husband', 'ex-wife', 'former spouse', 'former husband', 'former wife'] },
	{ id: 'betrothed', neutral: 'Betrothed', female: 'Fiancée', male: 'Fiancé', family: false,
		words: ['betrothed', 'fiancé', 'fiancée', 'fiance', 'fiancee', 'engaged to'] },

	// ── Paired roles. Only words whose direction is unambiguous: a rank word
	// that could be read either way ("Boss", "King", "Subject") is not here,
	// so it writes nothing back rather than the wrong thing. ────────────────
	{ id: 'mentor', neutral: 'Mentor', opposite: 'apprentice', family: false,
		words: ['mentor', 'mentors', 'guide', 'coach', 'trained by', 'apprentice of'] },
	{ id: 'apprentice', neutral: 'Apprentice', opposite: 'mentor', family: false,
		words: ['apprentice', 'apprentices', 'mentee', 'mentees', 'trains'] },
	{ id: 'teacher', neutral: 'Teacher', opposite: 'student', family: false, meaning: 'mentor',
		words: ['teacher', 'teachers', 'student of'] },
	{ id: 'student', neutral: 'Student', opposite: 'teacher', family: false, meaning: 'apprentice',
		words: ['student', 'students', 'pupil', 'pupils'] },
	{ id: 'ruler', neutral: 'Ruler', opposite: 'vassal', family: false, words: ['ruler', 'liege', 'sworn to'] },
	{ id: 'vassal', neutral: 'Vassal', opposite: 'ruler', family: false, words: ['vassal', 'vassals', 'liegeman', 'superior of'] },
	{ id: 'benefactor', neutral: 'Benefactor', opposite: 'beneficiary', family: false, words: ['benefactor', 'patron', 'sponsor', 'sponsored by'] },
	{ id: 'beneficiary', neutral: 'Beneficiary', opposite: 'benefactor', family: false, words: ['beneficiary'] },
	{ id: 'commander', neutral: 'Commander', opposite: 'subordinate', family: false,
		words: ['commander', 'commanding officer', 'superior officer', 'reports to'] },
	{ id: 'subordinate', neutral: 'Subordinate', opposite: 'commander', family: false,
		words: ['subordinate', 'subordinates', 'underling', 'deputy', 'lieutenant', 'second-in-command', 'second in command', 'right hand'] },
	{ id: 'leader', neutral: 'Leader', opposite: 'member', family: false, words: ['leader', 'leaders'] },
	{ id: 'member', neutral: 'Member', opposite: 'leader', family: false, words: ['member', 'members'] },
	{ id: 'ancestor-of', neutral: 'Ancestor of', opposite: 'descendant-of', family: false, words: ['ancestor of', 'forebear of'] },
	{ id: 'descendant-of', neutral: 'Descendant of', opposite: 'ancestor-of', family: false,
		words: ['descendant of', 'descended from', 'heir of'] },
];

const GROUP_BY_ID = new Map(WORD_GROUPS.map((g) => [g.id, g]));
const GROUP_BY_WORD = new Map<string, WordGroup>();
for (const g of WORD_GROUPS) for (const w of g.words) GROUP_BY_WORD.set(w, g);

const norm = (label: string): string => label.toLowerCase().trim();
const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Story Tree rows for the table's words — read by `story-tree.ts`'s kin table. */
export function treeReadingsFromWordGroups(): Array<{ words: readonly string[]; reading: TreeReading }> {
	return WORD_GROUPS.filter((g) => g.tree).map((g) => ({ words: g.words, reading: g.tree as TreeReading }));
}

/** Every family word in the table (grand-, aunt, ward, in-law, cousin…). */
export function isFamilyWord(label: string): boolean {
	return GROUP_BY_WORD.get(norm(label))?.family === true;
}

/** Test seam: the table itself. */
export function wordGroupsForTest(): readonly WordGroup[] {
	return WORD_GROUPS;
}

/**
 * A person's gender as the mirror uses it. 'nonbinary' and null (unknown) both
 * write the neutral word; they differ only when the Gender changes — becoming
 * non-binary rewords gendered lines, while clearing the field leaves them.
 */
export type MirrorGender = 'female' | 'male' | 'nonbinary' | null;

/** Read a sheet's Gender value ("Female", "male", "Woman"…). Anything else, or empty, is null. */
export function genderOf(value: string | undefined): MirrorGender {
	const v = norm(value ?? '');
	// Whole words only: a single letter typed on the way to another word must never count.
	if (['female', 'woman', 'girl'].includes(v)) return 'female';
	if (['male', 'man', 'boy'].includes(v)) return 'male';
	if (['non-binary', 'nonbinary', 'enby', 'nb'].includes(v)) return 'nonbinary';
	return null;
}

/** The Gender of a sheet from its fields (the first field labelled "Gender"). */
export function genderFromFields(fields: ReadonlyArray<{ label: string; value: string }>): MirrorGender {
	return genderOf(fields.find((f) => norm(f.label) === 'gender')?.value);
}

export interface MirrorContext {
	/** The writer's own relationship types (exact label match wins over everything else). */
	customTypes?: readonly CustomRelationshipType[];
	/** Kind of the sheet the line is written on. */
	ownerKind: EntityKind;
	/** Kind of the sheet the line links to (where the counterpart would be written). */
	targetKind: EntityKind;
	/**
	 * Gender of the sheet's owner — the person the written word describes
	 * ("Aunt: [[Ilse]]" on Mara's sheet writes Mara's word on Ilse's: Niece).
	 */
	ownerGender?: MirrorGender;
}

/**
 * The word to write on the target's sheet for a line written on the owner's
 * sheet, or null when nothing should be written back: a one-way feeling, a
 * character → world link, a family word between non-characters, or a word
 * Plotverk doesn't know (guessing would put nonsense on someone else's sheet).
 */
export function mirrorWord(label: string, ctx: MirrorContext): string | null {
	const l = norm(label);
	if (!l) return null;

	// 1. The writer's own types, exactly as defined in settings.
	const custom = (ctx.customTypes ?? []).find((c) => norm(c.label) === l && c.label.trim());
	if (custom) {
		if (custom.reciprocal === 'none') return null;
		if (custom.reciprocal === 'self') return custom.label.trim();
		const pair = (ctx.customTypes ?? []).find((c) => c.id === custom.reciprocal);
		return pair?.label.trim() || null;
	}

	const extra = buildCustomRegistry(ctx.customTypes ?? []);
	const rt = classifyRelation(l, extra);

	// 2. Between a person and a group, a rank word is either a role in the group
	// ("Leader: [[Council]]"), which reads the same from both sheets, or too
	// ambiguous to turn around ("Vassal: [[Idris]]" on the Council would put
	// "Ruler" on Idris, which the tree reads as the Council's leader).
	const cat = rt.category;
	const personGroup =
		(ctx.ownerKind === 'character' && GROUP_KINDS.has(ctx.targetKind)) ||
		(GROUP_KINDS.has(ctx.ownerKind) && ctx.targetKind === 'character');
	if (personGroup && (cat === 'superior' || cat === 'subordinate')) {
		const one = singularIn(l, rt.labels) ?? l; // "Members" → one person is a "Member"
		return groupRoleOf(one) ? capitalize(one === l ? label.trim() : one) : null;
	}

	// 3. The table of opposites.
	const group = GROUP_BY_WORD.get(l);
	if (group) {
		if (group.family && (ctx.ownerKind !== 'character' || ctx.targetKind !== 'character')) return null;
		const counterpart = group.opposite ? GROUP_BY_ID.get(group.opposite) as WordGroup : group;
		const g = ctx.ownerGender;
		return (g === 'female' || g === 'male' ? counterpart[g] : undefined) || counterpart.neutral;
	}

	// 4. The registry: symmetric ties keep the word (one person, so "Allies"
	// becomes "Ally"). A paired word the table doesn't list writes nothing —
	// its direction isn't certain enough to put on someone else's sheet.
	if (rt.id === RELATIONSHIP_TYPE_OTHER.id || rt.id === 'unrequited-love') return null;
	if (rt.oneWay || rt.behavior === 'world' || rt.behavior === 'oneWay') return null;
	if (rt.reciprocalId) return null;
	return capitalize(singularIn(l, rt.labels) ?? label.trim());
}

/** The singular of a plural registry word, when the registry also lists it ("allies" → "ally"). */
function singularIn(word: string, labels: readonly string[]): string | null {
	for (const s of [word.replace(/ies$/, 'y'), word.replace(/es$/, ''), word.replace(/s$/, '')]) {
		if (s !== word && labels.includes(s)) return s;
	}
	return null;
}

/**
 * Do two words state the same relationship? Exact match, two forms of one
 * table group (Granddaughter = Grandchild), or table groups that share a
 * meaning (Student = Apprentice). Registry synonyms outside the table do NOT
 * count (Friend ≠ Confidant): a writer who picked another word may mean
 * something else. The same test decides both "already there, don't add" and
 * "this is the mirror, remove it", so a change can never leave two lines.
 */
export function sameRelationWord(a: string, b: string): boolean {
	const x = singularOf(norm(a));
	const y = singularOf(norm(b));
	if (x === y) return true;
	const gx = GROUP_BY_WORD.get(x);
	const gy = GROUP_BY_WORD.get(y);
	return gx !== undefined && gy !== undefined && (gx.meaning ?? gx.id) === (gy.meaning ?? gy.id);
}

/** "Rivals" and "Rival" are one word here; table words already list their plurals. */
function singularOf(word: string): string {
	if (GROUP_BY_WORD.has(word)) return word;
	return singularIn(word, classifyRelation(word).labels) ?? word;
}

/** What has to change on one other sheet. `key` is whatever the caller resolved the link to (a file path). */
export interface MirrorEdit {
	key: string;
	add: string[];
	remove: string[];
}

/**
 * Diff the owner's relationship lines from when the sheet was opened against
 * the saved ones, and turn the difference into edits on the other sheets. Only
 * changed lines produce work: a line that was already there is never mirrored
 * again on save (out-of-step sheets are not rewritten behind the writer's back).
 * Changing a word, or the person, is a remove plus an add; two words with the
 * same counterpart (Mother → Parent) cancel out.
 *
 * `mirror` resolves one line to the sheet it lands on and the word to write
 * there, or null when nothing is written back. It is told which side it is
 * reading, so a Gender change between open and save turns an untouched line's
 * counterpart from "Grandchild" into "Granddaughter".
 */
export function planMirrorEdits(
	before: readonly RelationLine[],
	after: readonly RelationLine[],
	mirror: (rel: RelationLine, side: 'before' | 'after') => { key: string; word: string } | null,
): MirrorEdit[] {
	const collect = (rels: readonly RelationLine[], side: 'before' | 'after') => {
		const out = new Map<string, Map<string, string>>();
		for (const rel of rels) {
			const m = mirror(rel, side);
			if (!m) continue;
			const words = out.get(m.key) ?? new Map<string, string>();
			words.set(norm(m.word), m.word);
			out.set(m.key, words);
		}
		return out;
	};
	const was = collect(before, 'before');
	const now = collect(after, 'after');

	const edits: MirrorEdit[] = [];
	for (const key of new Set([...was.keys(), ...now.keys()])) {
		const w = was.get(key) ?? new Map<string, string>();
		const n = now.get(key) ?? new Map<string, string>();
		const add = [...n].filter(([k]) => !w.has(k)).map(([, v]) => v);
		const remove = [...w].filter(([k]) => !n.has(k)).map(([, v]) => v);
		if (add.length || remove.length) edits.push({ key, add, remove });
	}
	return edits;
}

/**
 * Apply one sheet's edit to the text of its relationships field. `isOwner`
 * says whether a link target is the sheet being saved (its new name, old name,
 * or anything that resolves to its file). `elsewhere` is every relation line on
 * the target sheet outside this field, so a line the writer keeps in another
 * section is not duplicated.
 *
 *  - remove: deletes only lines to the owner that state the same relationship
 *    (sameRelationWord). A line with another meaning is the writer's and stays,
 *    and so does a line that is more than links ("Grandchild: [[Mara]] and her
 *    friend [[Bo]]") — taking Mara out of it would turn Bo into a grandchild.
 *  - an add and a remove of two forms of one relationship (Grandchild →
 *    Granddaughter, after a Gender change) reword the owner's one-link lines
 *    in place; nothing is appended for them and no duplicate is left.
 *  - Line endings follow the text (a CRLF sheet stays CRLF).
 *  - add: skipped when the sheet already states it anywhere (in any form);
 *    otherwise the line is appended.
 */
export function applyMirrorEdit(
	text: string,
	opts: {
		ownerName: string;
		isOwner: (target: string) => boolean;
		add: readonly string[];
		remove: readonly string[];
		elsewhere?: readonly RelationLine[];
		/** Told about every line a remove takes out, so it can be put back exactly (a deleted sheet's restore). */
		onRemove?: (rel: RelationLine) => void;
	},
): { text: string; added: string[]; removed: string[] } {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	let out = text;
	const added: string[] = [];
	const removed: string[] = [];
	const add = [...opts.add];
	const remove = [...opts.remove];

	// Same relationship, new form — only a Gender change does this. Reword the
	// owner's own one-link lines in place. Never append (an out-of-step sheet is
	// not filled in just because a Gender changed), never leave two lines, and
	// leave shared lines ("Grandchildren: [[Tobin]], [[Mara]]") as written.
	for (const word of [...add]) {
		const r = remove.findIndex((w) => sameRelationWord(w, word));
		if (r < 0) continue;
		remove.splice(r, 1);
		add.splice(add.indexOf(word), 1);
		const ownLine = (x: RelationLine) =>
			opts.isOwner(x.target) && sameRelationWord(x.label, word) && isLinksOnly(x.raw ?? '') && ((x.raw ?? '').match(/\[\[/g) ?? []).length === 1;
		let done = parseRelationLines(out).some((x) => ownLine(x) && norm(x.label) === norm(word));
		for (;;) {
			const hit = parseRelationLines(out).find((x) => ownLine(x) && norm(x.label) !== norm(word));
			if (!hit) break;
			if (done && isPlain(hit)) {
				// Already said in the new form: this plain older copy goes instead of becoming a
				// duplicate. A copy with a note or an alias is the writer's detail and is reworded instead.
				const next = removeRelationFromText(out, hit).replace(/\r?\n/g, eol);
				if (next === out) break;
				out = next;
			} else {
				const lines = out.split(/\r?\n/);
				const idx = lines.findIndex((l) => l.trim() === hit.raw);
				if (idx < 0) break;
				lines[idx] = lines[idx].replace(/^(\s*[-*]?\s*)[^:]*?(\s*:)/, `$1${word}$2`);
				out = lines.join(eol);
				added.push(`${word}: ${opts.ownerName}`);
				done = true;
			}
			removed.push(`${hit.label}: ${hit.target}`);
		}
	}

	for (const word of remove) {
		for (;;) {
			const hit = parseRelationLines(out).find((r) => opts.isOwner(r.target) && sameRelationWord(r.label, word) && isLinksOnly(r.raw ?? ''));
			if (!hit) break;
			const next = removeRelationFromText(out, hit).replace(/\r?\n/g, eol);
			if (next === out) break;
			out = next;
			removed.push(`${hit.label}: ${hit.target}`);
			opts.onRemove?.(hit);
		}
	}
	for (const word of add) {
		const states = (r: RelationLine) => opts.isOwner(r.target) && sameRelationWord(r.label, word);
		if (parseRelationLines(out).some(states) || (opts.elsewhere ?? []).some(states)) continue;
		const line = `${word}: [[${opts.ownerName}]]`;
		const trimmed = out.replace(/\s+$/, '');
		out = trimmed ? `${trimmed}${eol}${line}` : line;
		added.push(`${word}: ${opts.ownerName}`);
	}
	return { text: out, added, removed };
}

/** A line that is exactly `Label: [[Target]]` — no bullet, alias or note to lose. */
function isPlain(rel: RelationLine): boolean {
	return (rel.raw ?? '').trim() === `${rel.label}: [[${rel.target}]]`;
}

/**
 * A relationship line that is nothing but its label and comma-separated links
 * (plus an optional "(intensity …)" note): `Allies: [[A]], [[B]]`. Any other
 * words around the links make it the writer's sentence, which a mirror edit
 * never cuts.
 */
function isLinksOnly(raw: string): boolean {
	const rest = raw
		.replace(/^[-*]?\s*[^:[\]]*:\s*/, '')
		// A trailing note, unless it holds a link — then it's part of the sentence.
		.replace(/\s*\([^()[\]]*\)\s*$/, '')
		.replace(/\[\[[^\]]+\]\]/g, '')
		.replace(/,/g, '')
		.trim();
	return rest === '';
}

/**
 * A person's Gender changed: reword the lines on ANOTHER sheet that describe
 * them. Every line pointing at someone names that someone's role ("Niece:
 * [[Mara]]" on Ilse's sheet says Mara is the niece), so the right form follows
 * Mara's gender: Niece / Nephew / Niece/Nephew. Only one-link lines in a word
 * group that has gendered forms are touched; prose, shared lines and every
 * other word stay exactly as written. A line that would become a copy of one
 * already there is removed instead. Line endings are kept.
 */
export function relabelForGender(
	text: string,
	isPerson: (target: string) => boolean,
	gender: Exclude<MirrorGender, null>,
): { text: string; changed: string[] } {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/);
	const changed: string[] = [];
	const candidate = (line: string) => {
		const rels = parseRelationLines(line);
		const rel = rels.length === 1 ? rels[0] : null;
		const group = rel ? GROUP_BY_WORD.get(norm(rel.label)) : undefined;
		if (!rel || !group || !(group.female || group.male) || !isPerson(rel.target) || !isLinksOnly(rel.raw ?? '')) return null;
		const want = (gender === 'female' ? group.female : gender === 'male' ? group.male : undefined) ?? group.neutral;
		return { rel, want, key: `${norm(want)}→${norm(rel.target)}` };
	};
	// Lines already in the right form, wherever they are: a reworded line never duplicates one.
	const seen = new Set(lines.map(candidate).filter((c) => c && norm(c.rel.label) === norm(c.want)).map((c) => c!.key));
	const out: string[] = [];
	for (const line of lines) {
		const c = candidate(line);
		if (!c || norm(c.rel.label) === norm(c.want)) {
			out.push(line);
			continue;
		}
		const { rel, want, key } = c;
		if (seen.has(key) && isPlain(rel)) {
			changed.push(`removed “${rel.label}: ${rel.target}” (already “${want}”)`);
			continue;
		}
		seen.add(key);
		out.push(line.replace(/^(\s*[-*]?\s*)[^:]*?(\s*:)/, `$1${want}$2`));
		changed.push(`“${rel.label}” → “${want}: ${rel.target}”`);
	}
	return { text: out.join(eol), changed };
}

/** Layout category check the Dashboard's family hint shares with the tree. */
export function isFamilyLabel(label: string): boolean {
	const cat = categorizeLabel(label);
	return cat === 'parent' || cat === 'child' || isFamilyWord(label);
}
