import { en } from '../i18n/locales/en';
import { es } from '../i18n/locales/es';
import { fr } from '../i18n/locales/fr';
import type { EntityKind } from '../entities/entity-kinds';
import { CustomRelationshipType, GROUP_KINDS, RELATIONSHIP_TYPE_OTHER, buildCustomRegistry, categorizeLabel, classifyRelation, groupRoleOf } from './relations';

/**
 * A relationship line read aloud as one sentence (pure, no Obsidian imports).
 *
 * The stored line never changes: `Child: [[Tobin Ferrow]]` on Konrad's sheet
 * means Tobin is Konrad's child — the word names the LINKED person's role. The
 * old editor row read "Child to Tobin", which flips that in the reader's head,
 * so the editor now says it the right way round: "Tobin Ferrow is Konrad's child".
 *
 * Words with a preposition ("Ancestor of", "Resident of", "Trained by") or a
 * verb ("Reports to", "Owns") describe the OWNER instead — "Ancestor of:
 * [[Tobin]]" on Konrad's sheet means Konrad is Tobin's ancestor, which is how
 * the registry and the mirror table read them — so those sentences start with
 * the sheet's own name.
 *
 * Some words get no sentence and stay "Word: Name" (the 'plain' shape),
 * because which way they point is not certain: words Plotverk doesn't know
 * and the writer's own types ("Protects", "Mentored by").
 */

export type RelationSentencePart = { type: 'text'; text: string } | { type: 'other' } | { type: 'word' };

const DICTS: Record<string, Record<string, string>> = { en, es, fr };

/** Verbs that read without "is": "Konrad reports to Tull", not "Konrad is reports to Tull". */
const VERBS = new Set(['reports', 'belongs', 'works', 'lives', 'resides', 'serves', 'owns', 'wields', 'carries', 'practices', 'trains', 'loves', 'pines']);
const PREPOSITION_END = /\s(of|by|to|from|with|in|for|on|at)$/;

export type SentenceShape = 'noun' | 'phrase' | 'verb' | 'role' | 'plain';

/** How a word reads: a role of the linked person, or something the owner is / does. */
export function relationWordShape(word: string): 'noun' | 'phrase' | 'verb' {
	const w = word.trim().toLowerCase();
	if (VERBS.has(w.split(/\s+/)[0])) return 'verb';
	if (PREPOSITION_END.test(w)) return 'phrase';
	return 'noun';
}

/**
 * The shape for a line on a real sheet. 'role' is a person's role in a
 * group — "Leader: [[Council]]" on Konrad means Konrad leads the Council, the
 * way the map and the tree read it — so it says "Konrad is Council’s leader".
 */
export function sentenceShapeFor(
	label: string,
	ctx: { customTypes?: readonly CustomRelationshipType[]; ownerKind?: EntityKind; targetKind?: EntityKind | null } = {},
): SentenceShape {
	const l = label.trim().toLowerCase();
	if (!l) return 'plain';
	if ((ctx.customTypes ?? []).some((c) => c.label.trim().toLowerCase() === l)) return 'plain';
	const extra = buildCustomRegistry(ctx.customTypes ?? []);
	if (classifyRelation(l, extra).id === RELATIONSHIP_TYPE_OTHER.id) return 'plain';
	const cat = categorizeLabel(l, extra);
	if (ctx.ownerKind === 'character' && ctx.targetKind && GROUP_KINDS.has(ctx.targetKind)
		&& (cat === 'superior' || cat === 'subordinate') && groupRoleOf(l)) return 'role';
	return relationWordShape(l);
}

function dict(locale: string): Record<string, string> {
	return DICTS[locale] ?? en;
}

function str(locale: string, key: string): string {
	return dict(locale)[key] ?? en[key];
}

/** French "de" becomes "d’" before a vowel or a silent h: "fille d’Anna", "la fiche d’Hélène". */
function elide(template: string, vars: Record<string, string>, locale: string): string {
	if (locale !== 'fr') return template;
	return template.replace(/\bde \{(\w+)\}/g, (whole, name: string) =>
		/^[aeiouyàâäéèêëîïôöùûüœæh]/i.test(vars[name] ?? '') ? `d’{${name}}` : whole,
	);
}

/** One-pass substitution, like t(): a value is never re-scanned for placeholders. */
function fill(template: string, vars: Record<string, string>): string {
	return template.replace(/\{([^{}]+)\}/g, (whole, name: string) =>
		Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
	);
}

/** The sheet's own name, or "this character" / "this entry" before it has one. */
export function selfLabel(selfName: string, locale: string, isCharacter = true): string {
	return selfName.trim() || str(locale, isCharacter ? 'rel.sentence.thisCharacter' : 'rel.sentence.thisEntry');
}

/**
 * The sentence as pieces, so the editor can put a button or a dropdown where
 * the other person and the word go. The owner's name is already filled in.
 */
export function relationSentenceParts(
	selfName: string,
	word: string,
	locale: string,
	opts: { isCharacter?: boolean; otherName?: string; shape?: SentenceShape } = {},
): RelationSentencePart[] {
	const self = selfLabel(selfName, locale, opts.isCharacter);
	const key = `rel.sentence.${opts.shape ?? relationWordShape(word)}`;
	// The other person's name only matters for French elision ("de Anna" → "d’Anna").
	const template = elide(str(locale, key), { self, other: opts.otherName ?? '' }, locale);
	const parts: RelationSentencePart[] = [];
	const re = /\{(other|self|word)\}/g;
	let last = 0;
	let m: RegExpExecArray | null;
	const pushText = (text: string) => { if (text) parts.push({ type: 'text', text }); };
	while ((m = re.exec(template))) {
		pushText(template.slice(last, m.index));
		if (m[1] === 'self') pushText(self);
		else parts.push({ type: m[1] as 'other' | 'word' });
		last = m.index + m[0].length;
	}
	pushText(template.slice(last));
	// Merge neighbouring text pieces so a renderer gets one span per stretch of words.
	return parts.reduce<RelationSentencePart[]>((out, p) => {
		const prev = out[out.length - 1];
		if (p.type === 'text' && prev?.type === 'text') prev.text += p.text;
		else out.push(p.type === 'text' ? { ...p } : p);
		return out;
	}, []);
}

/** "Tobin Ferrow is Konrad’s child" — the stored line `Child: [[Tobin Ferrow]]` on Konrad's sheet, read aloud. */
export function relationSentence(
	otherName: string,
	selfName: string,
	word: string,
	locale: string,
	opts: { isCharacter?: boolean; shape?: SentenceShape } = {},
): string {
	return relationSentenceParts(selfName, word, locale, { ...opts, otherName })
		.map((p) => (p.type === 'text' ? p.text : p.type === 'other' ? otherName : sentenceWord(word, opts.shape)))
		.join('');
}

/** The word as it sits in the sentence: lower case mid-sentence, as written in the plain form. */
export function sentenceWord(word: string, shape?: SentenceShape): string {
	return shape === 'plain' ? word.trim() : word.trim().toLowerCase();
}

/** Why nothing would be written on the other sheet. */
export type MirrorMissReason = 'noSheet' | 'oneWay' | 'self';

/**
 * The line under the adder that says what the OTHER sheet will get on save.
 * `mirrored` is the word the save path itself computed (relation-sync's
 * `mirrorTarget` → relation-mirror's `mirrorWord`), never worked out here.
 */
export function mirrorPreviewText(
	otherName: string,
	selfName: string,
	mirrored: string | null,
	locale: string,
	reason: MirrorMissReason = 'oneWay',
	opts: { isCharacter?: boolean } = {},
): string {
	// The name exactly as the link on the other sheet will spell it (the caller passes the would-be file name).
	const self = selfLabel(selfName, locale, opts.isCharacter);
	const key = mirrored ? 'rel.preview.writes' : `rel.preview.${reason}`;
	const vars = { other: otherName, line: mirrored ? `${mirrored}: ${self}` : '' };
	return fill(elide(str(locale, key), vars, locale), vars);
}
