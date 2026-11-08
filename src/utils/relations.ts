import { EntityKind } from '../entities/entity-kinds';

/**
 * Pure relationship-graph logic for the Canvas relationship map (no Obsidian
 * imports so it stays unit-testable).
 *
 * Writers declare relations as plain prose lines inside any section of an
 * entity sheet:  `Mother: [[Queen Vess]]`  or  `- Ally: [[Marn]]`.
 * Bare wikilinks to other entities become unlabeled connection lines.
 * Family labels (mother/father/parent/child/…) drive a generation-layered
 * family-tree layout; everything else clusters by entity kind.
 */

export interface RelationLine {
	/** Relation label, '' for a bare wikilink */
	label: string;
	/** Wikilink target (display part stripped) */
	target: string;
	/** Bond strength 1–10 from a trailing `(intensity N)` annotation. */
	intensity?: number;
	/** Timeline era from a trailing `(epoch …)` annotation — stored for the future Timeline feature, rendered nowhere yet. */
	epoch?: string;
	/** Unrecognized annotation items, preserved verbatim so a round-trip never loses them. */
	extra?: string[];
	/** The exact trimmed source line — lets editors re-emit untouched lines byte-for-byte. */
	raw?: string;
}

/**
 * Parse the optional trailing annotation of a relation line:
 * `Rival: [[Beron]] (intensity 8)` / `Mentor: [[A]] (intensity 3, epoch The Long Winter)`.
 * Known keys are `intensity <1-10>` and `epoch <text>`; anything else in the
 * parens is kept in `extra` so writing the line back preserves it. Lines
 * without a trailing parenthetical parse exactly as before.
 */
function parseAnnotations(line: string): { rest: string; intensity?: number; epoch?: string; extra?: string[] } {
	const m = line.match(/\(([^()]*)\)\s*$/);
	// Only treat parens as an annotation when they come after the last wikilink,
	// so `Ally ([[Marn]])` style prose is untouched.
	if (!m || line.lastIndexOf(']]') > (m.index ?? 0)) return { rest: line };
	let intensity: number | undefined;
	let epoch: string | undefined;
	const extra: string[] = [];
	for (const item of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
		const iMatch = item.match(/^intensity\s+(\d{1,2})$/i);
		const eMatch = item.match(/^epoch\s+(.+)$/i);
		if (iMatch) intensity = Math.min(10, Math.max(1, parseInt(iMatch[1], 10)));
		else if (eMatch) epoch = eMatch[1].trim();
		else extra.push(item);
	}
	return {
		rest: line.slice(0, m.index).trimEnd(),
		intensity,
		epoch,
		extra: extra.length > 0 ? extra : undefined,
	};
}

/**
 * Serialize a RelationLine back into its prose form — the exact inverse of
 * {@link parseRelationLines} for a single-target line. Editors that rebuild a
 * Relationships section should emit unmodified lines from `raw` instead, and
 * only serialize relations the writer actually changed.
 */
export function serializeRelationLine(rel: RelationLine): string {
	const base = rel.label ? `${rel.label}: [[${rel.target}]]` : `[[${rel.target}]]`;
	const items: string[] = [];
	if (rel.intensity !== undefined) items.push(`intensity ${Math.min(10, Math.max(1, Math.round(rel.intensity)))}`);
	if (rel.epoch) items.push(`epoch ${rel.epoch}`);
	if (rel.extra) items.push(...rel.extra);
	return items.length > 0 ? `${base} (${items.join(', ')})` : base;
}

/** Extract labeled relations and bare wikilinks from a prose section. */
export function parseRelationLines(text: string): RelationLine[] {
	const out: RelationLine[] = [];
	const seen = new Set<string>();
	for (const rawLine of text.split(/\r?\n/)) {
		const raw = rawLine.trim();
		const ann = parseAnnotations(raw);
		const line = ann.rest;
		// Labeled form: `Mother: [[Target]]` / `- Ally: [[A]], [[B]]`
		const labeled = line.match(/^[-*]?\s*([\p{L}][\p{L} &/'’-]{0,40}?)\s*:\s*(.*\[\[.+)$/u);
		const label = labeled ? labeled[1].trim() : '';
		const linkSource = labeled ? labeled[2] : line;
		for (const m of linkSource.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
			const target = m[1].trim();
			const key = `${label.toLowerCase()}→${target}`;
			if (!target || seen.has(key)) continue;
			seen.add(key);
			out.push({
				label,
				target,
				...(ann.intensity !== undefined ? { intensity: ann.intensity } : {}),
				...(ann.epoch ? { epoch: ann.epoch } : {}),
				...(ann.extra ? { extra: ann.extra } : {}),
				raw,
			});
		}
	}
	return out;
}

/**
 * The lines of a relationships field that hold no [[link]], so turn into no
 * chip: free writing the Codex page still shows under the chips. Blank lines
 * at the ends are dropped; the text is never changed otherwise.
 */
export function nonRelationText(text: string): string {
	return text.split(/\r?\n/).filter((line) => parseRelationLines(line).length === 0).join('\n').trim();
}

/** The parts of a parsed field this module needs — a structural subset of CharacterField. */
export interface RelationSourceField {
	label: string;
	value: string;
	type: string;
	config?: { entityLink?: boolean };
}

/**
 * Turn an entity's parsed fields into the `sections` map the relation graph
 * reads. Prose comes through as written; a typed field that links to real Codex
 * entries is rendered into the same `Label: [[Target]]` shape, so a "Father"
 * field built in the Add-field wizard and a hand-typed "Father: [[X]]" line
 * reach the Connections Map and Story Tree identically.
 *
 * Every surface that builds a RelEntity should go through this, or a new field
 * type will silently be invisible to the graph.
 */
export function fieldsToRelationSections(fields: RelationSourceField[]): Record<string, string> {
	const sections: Record<string, string> = {};
	for (const f of fields) {
		if (f.type === 'textarea') {
			sections[f.label] = f.value;
		} else if (f.type === 'tags' && f.config?.entityLink) {
			const links = f.value.split(',').map((t) => t.trim()).filter(Boolean);
			if (links.length > 0) {
				sections[f.label] = `${f.label}: ${links.map((t) => `[[${t}]]`).join(', ')}`;
			}
		} else if (f.type === 'text' && f.value.includes('[[')) {
			sections[f.label] = `${f.label}: ${f.value}`;
		} else if (f.type === 'list' && f.value.includes('[[')) {
			const lines = f.value.split('\n').map((l) => l.trim()).filter((l) => l.includes('[['));
			if (lines.length > 0) {
				sections[f.label] = lines.map((l) => `${f.label}: ${l}`).join('\n');
			}
		}
	}
	return sections;
}

// ─── Graph building ──────────────────────────────────────────────────────────

export interface RelEntity {
	path: string;
	name: string;
	kind: EntityKind;
	/** section heading → prose text */
	sections: Record<string, string>;
}

export interface RelEdge {
	fromPath: string;
	toPath: string;
	label: string;
	/** Bond strength 1–10 declared by the source sheet, when annotated. */
	intensity?: number;
	/** Timeline era declared by the source sheet, when annotated. */
	epoch?: string;
	/** Path of the sheet the line was written on (either end, depending on how the label was oriented). */
	sourcePath?: string;
}

/**
 * Kinds that are groups of people rather than people. A rank line between a
 * character and one of these names the character's role IN the group, from
 * either sheet — see {@link buildRelationGraph}.
 */
export const GROUP_KINDS: ReadonlySet<string> = new Set(['faction', 'bloodline', 'government', 'military', 'religion', 'social-class']);

const GROUP_LEADER_WORDS = new Set(['leader', 'head', 'chief', 'boss', 'king', 'queen', 'president', 'ruler', 'lord', 'commander', 'commanding officer']);
const GROUP_MEMBER_WORDS = new Set([
	'member', 'subordinate', 'second-in-command', 'second in command', 'deputy', 'lieutenant', 'right hand',
	'vice-leader', 'soldier', 'follower', 'underling', 'member of', 'belongs to', 'employee of', 'serves', 'works for', 'affiliated with',
]);

/**
 * A role noun a person can hold in a group, read the same from either sheet
 * ("Leader: [[Council]]" on Idris = "Leader: [[Idris]]" on the Council).
 * Lines that point at someone else ("Reports to", "Vassal", "Liege") are not
 * roles and keep the target-role rule.
 */
export function groupRoleOf(label: string): 'leader' | 'member' | null {
	const l = label.toLowerCase().trim();
	if (GROUP_LEADER_WORDS.has(l)) return 'leader';
	if (GROUP_MEMBER_WORDS.has(l)) return 'member';
	return null;
}

export type RelationCategory = 'parent' | 'child' | 'partner' | 'superior' | 'subordinate' | 'other';

/**
 * How a relationship line is drawn on the Connections Map. Thickness is a
 * separate axis (the `weight` field), so "thick dotted" is expressible.
 * `jagged` = irregular sharp spikes (betrayal, hatred); `zigzag` = an even
 * triangle wave; `wavy` = smooth curves.
 */
export type LineStyle = 'solid' | 'dotted' | 'dashed' | 'dashdot' | 'double' | 'jagged' | 'zigzag' | 'wavy';

/**
 * How a relationship behaves between the two sheets — the five categories the
 * map and the sheet editor reason about:
 *  - 'mutual'     Symmetrical. Same title both ways, single line, no arrowheads.
 *  - 'opposites'  Paired roles (Mentor→Apprentice). One arrow; the counterpart
 *                 title is auto-written to the target's sheet.
 *  - 'reciprocal' Both sides hold the status but the intensity can differ —
 *                 imbalance is drawn as a fading line with a split tooltip.
 *  - 'hierarchy'  Strict one-way rank or lineage. Loops are a contradiction.
 *  - 'world'      Character → world element (location, faction, item, system).
 *                 Strictly one-sided; nothing is written back.
 *  - 'oneWay'     One-sided feeling with no implied counterpart ("Crush on").
 */
export type RelationBehavior = 'mutual' | 'opposites' | 'reciprocal' | 'hierarchy' | 'world' | 'oneWay';

/**
 * Describes one relationship type in the extensible registry.
 * To add a new relationship type, append one entry to RELATIONSHIP_TYPES — that
 * single change flows through to edge colors, weights, and the legend everywhere.
 */
export interface RelationshipType {
	/** Stable id — used as a key in legends and persistence. */
	id: string;
	/** Broad grouping for layout decisions (parent/child drives generation-layer tree). */
	category: RelationCategory;
	/** Lowercase label strings this type matches exactly. */
	labels: ReadonlyArray<string>;
	/** Edge hex color. */
	color: string;
	/** Stroke-weight multiplier: 1 = thin, 2 = medium, 3 = thick. */
	weight: number;
	/** Human-readable label shown in the graph legend. */
	displayLabel: string;
	/** How the line is drawn on the Connections Map. */
	lineStyle: LineStyle;
	/** How the relation behaves between the two sheets (see {@link RelationBehavior}). */
	behavior: RelationBehavior;
	/**
	 * Short word drawn centered ON a collapsed mutual line ("Spouses").
	 * Only mutual types set this — everything else uses an arrow instead.
	 */
	edgeLabel?: string;
	/**
	 * Id of the RelationshipType that represents this relation from the OTHER end.
	 * Omit for symmetric relations (ally, enemy, sibling…) — they map to themselves.
	 * Example: parent.reciprocalId = 'child', child.reciprocalId = 'parent'.
	 */
	reciprocalId?: string;
	/**
	 * One-way (unrequited) relation — the other end has NO implied feeling back
	 * (admires, fears, idolizes…).  The graph draws no reverse arrow and the
	 * editor auto-writes nothing to the target's sheet.  Mutually exclusive with
	 * reciprocalId.
	 */
	oneWay?: boolean;
}

/**
 * A user-defined relationship type, stored in settings.  Converted to a
 * runtime {@link RelationshipType} via {@link customTypeToRegistry} so custom
 * and built-in types flow through the same color/weight/legend machinery.
 */
export interface CustomRelationshipType {
	/** Stable id (also used to build the runtime `custom:<id>` type id). */
	id: string;
	/** The word written on the sheet and shown in the legend, e.g. "Professor". */
	label: string;
	/** Edge hex color. */
	color: string;
	/** Stroke-weight multiplier (1 thin – 3 thick). Default 2. */
	weight?: number;
	/**
	 * Reciprocal behavior:
	 *  - 'self'  → symmetric (both ends identical, e.g. Friend)
	 *  - 'none'  → one-way / unrequited (no reverse arrow, no auto-write)
	 *  - <id>    → id of the paired custom type shown at the other end (Professor→Student)
	 */
	reciprocal: 'self' | 'none' | string;
	/** How the line is drawn. Defaults to 'solid' for types saved before line styles existed. */
	lineStyle?: LineStyle;
	/**
	 * Behavior picked in the creation wizard. Omitted on types saved before the
	 * wizard existed — {@link customTypeToRegistry} then derives it from `reciprocal`.
	 */
	behavior?: 'mutual' | 'opposites' | 'oneWay';
	/** Optional default bond strength 1–10 suggested when the writer uses this type. */
	defaultIntensity?: number;
	/** Optional era/date restriction — stored for the future Timeline feature. */
	epoch?: string;
}

/**
 * Fallback used for labeled relations that don't match any registered type.
 * Neutral gray on purpose — distinct from Mentor blue so an unrecognized word
 * reads visibly as "unclassified" rather than masquerading as a known type.
 */
export const RELATIONSHIP_TYPE_OTHER: RelationshipType = {
	id: 'other',
	category: 'other',
	labels: [],
	color: '#98a0ad',
	weight: 1,
	displayLabel: 'Other',
	lineStyle: 'solid',
	behavior: 'oneWay',
};

/**
 * Neutral words for the sibling-of-a-parent pair, written on the other sheet
 * when a relationship is mirrored (no sheet records gender). One place, so
 * changing the wording is one edit.
 */
export const NEUTRAL_AUNT_UNCLE = 'Aunt/Uncle';
export const NEUTRAL_NIECE_NEPHEW = 'Niece/Nephew';

/**
 * The relationship words that get their own prominent row in the Codex sheet
 * editor. Everything else is grouped under "Other relationships".
 */
export const MAIN_RELATION_LABELS: ReadonlyArray<string> = [
	'father', 'mother', 'sibling', 'partner', 'best friend', 'mentor', 'familiar', 'pet',
];

/**
 * Ordered relationship-type registry.  First matching entry wins.
 * All edge coloring, weighting, line styling and legend text flows from this
 * table — adding a new relationship kind is one object added here.
 *
 * Grouped into the five relationship categories:
 *   1. Symmetrical / Mutual        (behavior 'mutual')
 *   2. Asymmetrical / Paired       (behavior 'opposites')
 *   3. Reciprocal, weighted        (behavior 'reciprocal')
 *   4. Anti-symmetrical hierarchy  (behavior 'hierarchy')
 *   5. Entity-to-world             (behavior 'world')
 *
 * A `labels` word always names the TARGET's role: `Mother: [[Vess]]` on Mara's
 * sheet means Vess is Mara's mother. That is why `category` is what it is —
 * buildRelationGraph flips 'parent' and 'superior' edges so the arrow always
 * points from the higher rank down, which is what both tree layouts assume.
 *
 * Words with a preposition read as a sentence about the sheet's OWNER ("Sworn
 * to: [[Pike]]" = the owner is sworn to Pike), so they are filed under the
 * role of the person they LINK to: Pike is the ruler, so it sits in 'ruler'.
 * "Superior of: [[Pike]]" makes Pike the subordinate (vassal); "Sponsored by:
 * [[Pike]]" makes Pike the benefactor. `relation-phrases.test.ts` pins the
 * direction and the mirrored word of every such label, so a new one can't be
 * filed backwards unnoticed.
 */
export const RELATIONSHIP_TYPES: ReadonlyArray<RelationshipType> = [
	// ── Category 1 — Symmetrical / Mutual ────────────────────────────────────
	{
		id: 'partner',
		category: 'partner',
		labels: ['partner', 'partners', 'spouse', 'spouses', 'husband', 'wife', 'lover', 'married to', 'partner of', 'betrothed', 'fiancé', 'fiancée', 'fiance', 'fiancee', 'engaged to'],
		color: '#E91E63',
		weight: 2.5,
		displayLabel: 'Spouses / Partners',
		edgeLabel: 'Spouses',
		lineStyle: 'solid',
		behavior: 'mutual',
	},
	{
		id: 'sibling',
		category: 'other',
		labels: [
			'sibling', 'siblings', 'brother', 'sister', 'brothers', 'sisters', 'twin', 'twins', 'twin brother', 'twin sister',
			'half-sibling', 'half-siblings', 'half-brother', 'half-sister',
			'stepbrother', 'stepsister', 'step-sibling', 'stepsibling', 'step-siblings', 'stepsiblings', 'step-brother', 'step-sister',
		],
		color: '#757575',
		weight: 2,
		displayLabel: 'Siblings',
		edgeLabel: 'Siblings',
		lineStyle: 'solid',
		behavior: 'mutual',
	},
	{
		id: 'ally',
		category: 'other',
		labels: ['ally', 'allies', 'friend', 'friends', 'best friend', 'confidant', 'comrade', 'companion', 'trusted', 'ally of', 'sworn companion'],
		color: '#2E7D32',
		weight: 1.5,
		displayLabel: 'Allies',
		edgeLabel: 'Allies',
		lineStyle: 'dotted',
		behavior: 'mutual',
	},
	{
		id: 'ex-partner',
		category: 'other',
		labels: ['ex', 'ex-partner', 'ex-partners', 'ex-husband', 'ex-wife', 'ex-spouse', 'former spouse', 'former husband', 'former wife', 'ex-lover', 'former partner', 'broken betrothal'],
		color: '#FF9800',
		weight: 1.5,
		displayLabel: 'Ex-Partners',
		edgeLabel: 'Ex-Partners',
		lineStyle: 'solid',
		behavior: 'mutual',
	},

	// ── Category 2 — Asymmetrical / Paired Opposites ─────────────────────────
	{
		id: 'parent',
		category: 'parent',
		labels: [
			'mother', 'father', 'parent', 'parents', 'mor', 'far', 'mom', 'mum', 'dad',
			'grandmother', 'grandfather', 'grandparent', 'grandparents', 'grandma', 'grandpa', 'granny',
			'stepmother', 'stepfather', 'step-parent', 'stepparent', 'step-parents', 'stepparents', 'step-mother', 'step-father',
		],
		color: '#757575',
		weight: 3,
		displayLabel: 'Parent',
		lineStyle: 'solid',
		behavior: 'opposites',
		reciprocalId: 'child',
	},
	{
		id: 'child',
		category: 'child',
		labels: [
			'child', 'children', 'son', 'daughter', 'sons', 'daughters', 'barn',
			'grandchild', 'grandchildren', 'grandson', 'granddaughter', 'grandsons', 'granddaughters',
			'stepson', 'stepdaughter', 'step-child', 'stepchild', 'step-children', 'stepchildren', 'step-son', 'step-daughter',
		],
		color: '#757575',
		weight: 2.5,
		displayLabel: 'Child',
		lineStyle: 'solid',
		behavior: 'opposites',
		reciprocalId: 'parent',
	},
	// Extended family. Category 'other' on purpose: the Story Tree reads these
	// words from its own kin table (the right row); the map only needs to know
	// they come in pairs. Great-grandparents stay out of 'parent' so the map's
	// layout and the loop warning treat them as they always have.
	{
		id: 'great-grandparent',
		category: 'other',
		labels: ['great-grandparent', 'great-grandparents', 'great-grandmother', 'great-grandfather', 'great grandparent', 'great grandmother', 'great grandfather'],
		color: '#757575',
		weight: 2,
		displayLabel: 'Great-grandparent',
		lineStyle: 'solid',
		behavior: 'opposites',
		reciprocalId: 'great-grandchild',
	},
	{
		id: 'great-grandchild',
		category: 'other',
		labels: ['great-grandchild', 'great-grandchildren', 'great-grandson', 'great-granddaughter', 'great grandchild', 'great grandson', 'great granddaughter'],
		color: '#757575',
		weight: 2,
		displayLabel: 'Great-grandchild',
		lineStyle: 'solid',
		behavior: 'opposites',
		reciprocalId: 'great-grandparent',
	},
	{
		id: 'aunt-uncle',
		category: 'other',
		labels: ['aunt', 'uncle', 'aunts', 'uncles', NEUTRAL_AUNT_UNCLE.toLowerCase(), 'great-aunt', 'great-uncle', 'great aunt', 'great uncle', `great-${NEUTRAL_AUNT_UNCLE.toLowerCase()}`],
		color: '#8D6E63',
		weight: 1.5,
		displayLabel: 'Aunt / Uncle',
		lineStyle: 'dashed',
		behavior: 'opposites',
		reciprocalId: 'niece-nephew',
	},
	{
		id: 'niece-nephew',
		category: 'other',
		labels: ['niece', 'nephew', 'nieces', 'nephews', NEUTRAL_NIECE_NEPHEW.toLowerCase(), 'great-niece', 'great-nephew', 'great niece', 'great nephew', 'grandniece', 'grandnephew', `great-${NEUTRAL_NIECE_NEPHEW.toLowerCase()}`],
		color: '#8D6E63',
		weight: 1.5,
		displayLabel: 'Niece / Nephew',
		lineStyle: 'dashed',
		behavior: 'opposites',
		reciprocalId: 'aunt-uncle',
	},
	{
		id: 'guardian',
		category: 'other',
		labels: ['guardian', 'guardians', 'legal guardian', 'foster parent', 'foster parents', 'foster mother', 'foster father', 'adoptive parent', 'adoptive parents', 'adoptive mother', 'adoptive father'],
		color: '#6D4C41',
		weight: 2,
		displayLabel: 'Guardian',
		lineStyle: 'dashed',
		behavior: 'opposites',
		reciprocalId: 'ward',
	},
	{
		id: 'ward',
		category: 'other',
		labels: ['ward', 'wards', 'foster child', 'foster children', 'foster son', 'foster daughter', 'adopted child', 'adopted children', 'adopted son', 'adopted daughter'],
		color: '#6D4C41',
		weight: 2,
		displayLabel: 'Ward',
		lineStyle: 'dashed',
		behavior: 'opposites',
		reciprocalId: 'guardian',
	},
	{
		id: 'parent-in-law',
		category: 'other',
		labels: ['parent-in-law', 'parents-in-law', 'mother-in-law', 'father-in-law'],
		color: '#A1887F',
		weight: 1.5,
		displayLabel: 'Parent-in-law',
		lineStyle: 'dashed',
		behavior: 'opposites',
		reciprocalId: 'child-in-law',
	},
	{
		id: 'child-in-law',
		category: 'other',
		labels: ['child-in-law', 'children-in-law', 'son-in-law', 'daughter-in-law'],
		color: '#A1887F',
		weight: 1.5,
		displayLabel: 'Child-in-law',
		lineStyle: 'dashed',
		behavior: 'opposites',
		reciprocalId: 'parent-in-law',
	},
	{
		id: 'sibling-in-law',
		category: 'other',
		labels: ['sibling-in-law', 'siblings-in-law', 'brother-in-law', 'sister-in-law'],
		color: '#A1887F',
		weight: 1.5,
		displayLabel: 'Siblings-in-law',
		edgeLabel: 'In-laws',
		lineStyle: 'dashed',
		behavior: 'mutual',
	},
	{
		id: 'cousin',
		category: 'other',
		labels: ['cousin', 'cousins', 'first cousin', 'second cousin'],
		color: '#8D6E63',
		weight: 1.5,
		displayLabel: 'Cousins',
		edgeLabel: 'Cousins',
		lineStyle: 'dashed',
		behavior: 'mutual',
	},
	{
		id: 'mentor',
		category: 'other',
		labels: ['mentor', 'mentors', 'teacher', 'teachers', 'master', 'guide', 'coach', 'trained by', 'student of', 'apprentice of'],
		color: '#008080',
		weight: 1.5,
		displayLabel: 'Mentor',
		lineStyle: 'solid',
		behavior: 'opposites',
		reciprocalId: 'apprentice',
	},
	{
		id: 'apprentice',
		category: 'other',
		labels: ['apprentice', 'apprentices', 'student', 'students', 'pupil', 'pupils', 'mentee', 'mentees', 'trains'],
		color: '#008080',
		weight: 1.5,
		displayLabel: 'Apprentice',
		lineStyle: 'solid',
		behavior: 'opposites',
		reciprocalId: 'mentor',
	},
	{
		id: 'ruler',
		category: 'superior',
		labels: ['ruler', 'king', 'queen', 'president', 'boss', 'chief', 'head', 'leader', 'leaders', 'sworn to', 'liege', 'lord'],
		color: '#FFD700',
		weight: 2.5,
		displayLabel: 'Ruler',
		lineStyle: 'solid',
		behavior: 'opposites',
		reciprocalId: 'vassal',
	},
	{
		id: 'vassal',
		category: 'subordinate',
		labels: ['vassal', 'vassals', 'subject', 'liegeman', 'superior of'],
		color: '#FFD700',
		weight: 1.5,
		displayLabel: 'Vassal',
		lineStyle: 'solid',
		behavior: 'opposites',
		reciprocalId: 'ruler',
	},
	{
		id: 'benefactor',
		category: 'other',
		labels: ['benefactor', 'patron', 'sponsor', 'sponsored by'],
		color: '#3F51B5',
		weight: 1.5,
		displayLabel: 'Benefactor',
		lineStyle: 'solid',
		behavior: 'opposites',
		reciprocalId: 'beneficiary',
	},
	{
		id: 'beneficiary',
		category: 'other',
		labels: ['beneficiary'],
		color: '#3F51B5',
		weight: 1.5,
		displayLabel: 'Beneficiary',
		lineStyle: 'solid',
		behavior: 'opposites',
		reciprocalId: 'benefactor',
	},

	// ── Category 3 — Reciprocal (weighted feelings) ──────────────────────────
	{
		id: 'rival',
		category: 'other',
		labels: ['rival', 'rivals'],
		color: '#C62828',
		weight: 2,
		displayLabel: 'Rivals',
		edgeLabel: 'Rivals',
		lineStyle: 'solid',
		behavior: 'reciprocal',
	},
	{
		id: 'enemy',
		category: 'other',
		labels: ['enemy', 'enemies', 'foe', 'foes', 'nemesis', 'sworn enemy', 'antagonist', 'adversary', 'blood feud'],
		color: '#8B0000',
		weight: 2,
		displayLabel: 'Enemies',
		edgeLabel: 'Enemies',
		lineStyle: 'jagged',
		behavior: 'reciprocal',
	},
	{
		id: 'unrequited-love',
		category: 'other',
		labels: ['unrequited love', 'loves', 'in love with', 'crush on', 'pines for'],
		color: '#F06292',
		weight: 1.5,
		displayLabel: 'Unrequited Love',
		lineStyle: 'dashed',
		behavior: 'reciprocal',
	},

	// ── Category 4 — Anti-symmetrical / Strict hierarchy (no loops) ──────────
	{
		id: 'ancestor-of',
		category: 'child',
		labels: ['ancestor of', 'forebear of'],
		color: '#37474F',
		weight: 2.5,
		displayLabel: 'Ancestor',
		lineStyle: 'solid',
		behavior: 'hierarchy',
		reciprocalId: 'descendant-of',
	},
	{
		id: 'descendant-of',
		category: 'parent',
		labels: ['descendant of', 'descended from', 'heir of'],
		color: '#37474F',
		weight: 2,
		displayLabel: 'Descendant',
		lineStyle: 'solid',
		behavior: 'hierarchy',
		reciprocalId: 'ancestor-of',
	},
	{
		id: 'commander',
		category: 'superior',
		labels: ['commander', 'commanding officer', 'superior officer', 'reports to'],
		color: '#1A237E',
		weight: 2.5,
		displayLabel: 'Commander',
		lineStyle: 'solid',
		behavior: 'hierarchy',
		reciprocalId: 'subordinate',
	},
	{
		id: 'subordinate',
		category: 'subordinate',
		labels: ['subordinate', 'subordinates', 'second-in-command', 'second in command', 'deputy', 'lieutenant', 'right hand', 'vice-leader', 'soldier', 'follower', 'member', 'members', 'underling'],
		color: '#1A237E',
		weight: 1.5,
		displayLabel: 'Subordinate',
		lineStyle: 'solid',
		behavior: 'hierarchy',
		reciprocalId: 'commander',
	},

	// ── Category 5 — Entity-to-world (strictly character → world element) ────
	{
		id: 'resident-of',
		category: 'other',
		labels: ['resident of', 'lives in', 'resides in', 'home', 'based in'],
		color: '#4A90E2',
		weight: 1.5,
		displayLabel: 'Resident Of',
		lineStyle: 'solid',
		behavior: 'world',
	},
	{
		id: 'member-of',
		category: 'other',
		labels: ['member of', 'belongs to', 'employee of', 'serves', 'works for', 'affiliated with'],
		color: '#4CAF50',
		weight: 1.5,
		displayLabel: 'Member Of',
		lineStyle: 'solid',
		behavior: 'world',
	},
	{
		id: 'owner-of',
		category: 'other',
		labels: ['owner of', 'owns', 'wields', 'carries', 'bearer of'],
		color: '#9C27B0',
		weight: 1.5,
		displayLabel: 'Owner Of',
		lineStyle: 'solid',
		behavior: 'world',
	},
	{
		id: 'practitioner-of',
		category: 'other',
		labels: ['practitioner of', 'practices', 'wielder of', 'trained in'],
		color: '#673AB7',
		weight: 1.5,
		displayLabel: 'Practitioner Of',
		lineStyle: 'solid',
		behavior: 'world',
	},
];

/**
 * Classify a relation label against the registry.
 * Returns the first matching RelationshipType, or RELATIONSHIP_TYPE_OTHER for
 * labels not in the registry.  An empty label (bare wikilink) also returns
 * RELATIONSHIP_TYPE_OTHER — callers should treat weight/color as "none" for bare links.
 */
export function classifyRelation(
	label: string,
	extraTypes: readonly RelationshipType[] = [],
): RelationshipType {
	const l = label.toLowerCase().trim();
	if (!l) return RELATIONSHIP_TYPE_OTHER;
	// User-defined types win over built-ins so a writer can override a stock word.
	return extraTypes.find((rt) => rt.labels.includes(l))
		?? RELATIONSHIP_TYPES.find((rt) => rt.labels.includes(l))
		?? RELATIONSHIP_TYPE_OTHER;
}

/**
 * Returns the RelationshipType representing the given relation from the OTHER
 * end of the edge.  For symmetric types (ally, enemy, sibling…) this is the
 * same type.  For asymmetric pairs (parent↔child, professor↔student) it returns
 * the counterpart.  `extraTypes` lets custom pairs resolve their own counterparts.
 */
export function getReciprocalType(
	rt: RelationshipType,
	extraTypes: readonly RelationshipType[] = [],
): RelationshipType {
	if (!rt.reciprocalId) return rt;
	return extraTypes.find((t) => t.id === rt.reciprocalId)
		?? RELATIONSHIP_TYPES.find((t) => t.id === rt.reciprocalId)
		?? rt;
}

/** Returns the layout category for a label — thin wrapper over classifyRelation. */
export function categorizeLabel(
	label: string,
	extraTypes: readonly RelationshipType[] = [],
): RelationCategory {
	return classifyRelation(label, extraTypes).category;
}

/**
 * Convert a user-defined {@link CustomRelationshipType} into a runtime
 * {@link RelationshipType}.  Custom types are always layout-category 'other'
 * (they never drive the family-tree generation layout).  The runtime id is
 * namespaced `custom:<id>` so it can't collide with a built-in type id.
 */
export function customTypeToRegistry(c: CustomRelationshipType): RelationshipType {
	// Types saved before the creation wizard existed carry no `behavior`, so
	// derive it from the reciprocal setting they do have.
	const behavior: RelationBehavior =
		c.behavior ?? (c.reciprocal === 'self' ? 'mutual' : c.reciprocal === 'none' ? 'oneWay' : 'opposites');
	return {
		id: `custom:${c.id}`,
		category: 'other',
		labels: [c.label.toLowerCase().trim()],
		color: c.color,
		weight: c.weight ?? 2,
		displayLabel: c.label,
		lineStyle: c.lineStyle ?? 'solid',
		behavior,
		...(behavior === 'mutual' ? { edgeLabel: c.label } : {}),
		reciprocalId:
			c.reciprocal === 'self' || c.reciprocal === 'none'
				? undefined
				: `custom:${c.reciprocal}`,
		oneWay: c.reciprocal === 'none',
	};
}

/**
 * Input collected by the Relationship Creation Wizard. `oppositeLabel` is only
 * used when behavior is 'opposites' — it becomes a second, paired custom type.
 */
export interface RelTypeWizardInput {
	label: string;
	color: string;
	lineStyle: LineStyle;
	behavior: 'mutual' | 'opposites' | 'oneWay';
	oppositeLabel?: string;
	defaultIntensity?: number;
	epoch?: string;
}

/**
 * Turn one wizard submission into the {@link CustomRelationshipType} entries to
 * append to settings. 'opposites' produces TWO linked types (Mentor + Apprentice)
 * that point at each other; the other behaviors produce one.
 * Ids are supplied by the caller so this stays pure and testable.
 */
export function buildCustomTypesFromWizard(
	input: RelTypeWizardInput,
	ids: { primary: string; opposite?: string },
): CustomRelationshipType[] {
	const shared = {
		color: input.color,
		lineStyle: input.lineStyle,
		...(input.defaultIntensity !== undefined ? { defaultIntensity: input.defaultIntensity } : {}),
		...(input.epoch ? { epoch: input.epoch } : {}),
	};
	if (input.behavior === 'opposites' && input.oppositeLabel?.trim() && ids.opposite) {
		return [
			{ id: ids.primary, label: input.label.trim(), reciprocal: ids.opposite, behavior: 'opposites', ...shared },
			{ id: ids.opposite, label: input.oppositeLabel.trim(), reciprocal: ids.primary, behavior: 'opposites', ...shared },
		];
	}
	// 'opposites' with no opposite title has nothing to pair with, so it settles
	// into a mutual type rather than silently becoming one-way.
	const behavior = input.behavior === 'opposites' ? 'mutual' : input.behavior;
	return [{
		id: ids.primary,
		label: input.label.trim(),
		reciprocal: behavior === 'oneWay' ? 'none' : 'self',
		behavior,
		...shared,
	}];
}

/** Convert a whole list of custom types to the runtime registry shape. */
export function buildCustomRegistry(
	customTypes: readonly CustomRelationshipType[] = [],
): RelationshipType[] {
	return customTypes.map(customTypeToRegistry);
}

/**
 * A pickable relationship for the character-editor dropdown.
 * `reciprocal` is the word auto-written on the OTHER character's sheet:
 * the same word for symmetric ties, the counterpart for pairs, or `null`
 * for one-way (unrequited) relations that write nothing back.
 */
export interface RelationChoice {
	label: string;
	reciprocal: string | null;
}

/**
 * Curated everyday relationship words offered in the editor dropdown, each
 * paired with the word to write on the reciprocal sheet.  Kept clean and
 * single-word so the written line (`Mentor: [[X]]`) classifies cleanly.
 */
export const COMMON_RELATION_CHOICES: readonly RelationChoice[] = [
	{ label: 'Mother',   reciprocal: 'Child' },
	{ label: 'Father',   reciprocal: 'Child' },
	{ label: 'Parent',   reciprocal: 'Child' },
	{ label: 'Child',    reciprocal: 'Parent' },
	{ label: 'Son',      reciprocal: 'Parent' },
	{ label: 'Daughter', reciprocal: 'Parent' },
	{ label: 'Grandparent', reciprocal: 'Grandchild' },
	{ label: 'Grandmother', reciprocal: 'Grandchild' },
	{ label: 'Grandfather', reciprocal: 'Grandchild' },
	{ label: 'Grandchild',  reciprocal: 'Grandparent' },
	{ label: 'Aunt',     reciprocal: NEUTRAL_NIECE_NEPHEW },
	{ label: 'Uncle',    reciprocal: NEUTRAL_NIECE_NEPHEW },
	{ label: 'Niece',    reciprocal: NEUTRAL_AUNT_UNCLE },
	{ label: 'Nephew',   reciprocal: NEUTRAL_AUNT_UNCLE },
	{ label: 'Cousin',   reciprocal: 'Cousin' },
	{ label: 'Guardian', reciprocal: 'Ward' },
	{ label: 'Ward',     reciprocal: 'Guardian' },
	{ label: 'Step-parent', reciprocal: 'Step-child' },
	{ label: 'Step-child',  reciprocal: 'Step-parent' },
	{ label: 'Parent-in-law', reciprocal: 'Child-in-law' },
	{ label: 'Child-in-law',  reciprocal: 'Parent-in-law' },
	{ label: 'Sibling-in-law', reciprocal: 'Sibling-in-law' },
	{ label: 'Sibling',  reciprocal: 'Sibling' },
	{ label: 'Partner',  reciprocal: 'Partner' },
	{ label: 'Spouse',   reciprocal: 'Spouse' },
	{ label: 'Ex-Partner', reciprocal: 'Ex-Partner' },
	{ label: 'Friend',   reciprocal: 'Friend' },
	{ label: 'Best Friend', reciprocal: 'Best Friend' },
	{ label: 'Ally',     reciprocal: 'Ally' },
	{ label: 'Enemy',    reciprocal: 'Enemy' },
	{ label: 'Rival',    reciprocal: 'Rival' },
	{ label: 'Unrequited love', reciprocal: null },
	{ label: 'Mentor',   reciprocal: 'Apprentice' },
	{ label: 'Apprentice', reciprocal: 'Mentor' },
	{ label: 'Ruler',    reciprocal: 'Vassal' },
	{ label: 'Vassal',   reciprocal: 'Ruler' },
	{ label: 'Benefactor', reciprocal: 'Beneficiary' },
	{ label: 'Patron',   reciprocal: 'Beneficiary' },
	{ label: 'Beneficiary', reciprocal: 'Benefactor' },
	{ label: 'Commander', reciprocal: 'Subordinate' },
	{ label: 'Subordinate', reciprocal: 'Commander' },
	{ label: 'Ancestor of', reciprocal: 'Descendant of' },
	{ label: 'Descendant of', reciprocal: 'Ancestor of' },
	{ label: 'Leader',   reciprocal: 'Member' },
	{ label: 'Member',   reciprocal: 'Leader' },
	// Category 5 — character → world element. Strictly one-sided: a location or
	// faction sheet never gets a line written back onto it.
	{ label: 'Resident of', reciprocal: null },
	{ label: 'Member of',   reciprocal: null },
	{ label: 'Owner of',    reciprocal: null },
	{ label: 'Practitioner of', reciprocal: null },
];

/**
 * Merge the user's custom relationship types (first, so they're prominent) with
 * the curated common words into a single dropdown list.  Custom types resolve
 * their own reciprocal word: same label when symmetric, the paired type's label
 * when asymmetric, or `null` when one-way.
 */
export function relationChoices(
	customTypes: readonly CustomRelationshipType[] = [],
): RelationChoice[] {
	const custom: RelationChoice[] = customTypes
		.filter((c) => c.label.trim())
		.map((c) => {
			let reciprocal: string | null;
			if (c.reciprocal === 'none') reciprocal = null;
			else if (c.reciprocal === 'self') reciprocal = c.label;
			else reciprocal = customTypes.find((t) => t.id === c.reciprocal)?.label ?? c.label;
			return { label: c.label, reciprocal };
		});
	return [...custom, ...COMMON_RELATION_CHOICES];
}

// ─── Visual palette for Canvas output ───────────────────────────────────────

/**
 * Obsidian Canvas node color per entity kind.
 * Values "1"–"6" are Canvas presets (red/orange/yellow/green/cyan/purple).
 * Hex strings are used where a preset doesn't match the Plotverk accent.
 * Export prefix `SG_` namespaces these so they don't collide with other plugins
 * that may also export color maps.
 */
export const SG_KIND_CANVAS_COLORS: Partial<Record<EntityKind, string>> = {
	character: '6',        // purple  — matches sheet accent #7c5fd3
	location:  '4',        // green   — matches sheet accent #1f9d6b
	faction:   '1',        // red     — matches sheet accent #d05050
	system:    '#2089c4',  // blue    — hex, distinct from cyan preset
	item:      '3',        // amber   — matches sheet accent #c98a1b
	research:  '5',        // cyan    — matches sheet accent #0d9488
	// scene: intentionally no color — scenes are supporting context in the map
};

/**
 * Canvas edge color per relation category.
 * Red = blood/family · violet = romantic/partner · blue = named social ties.
 * Unlabeled bare-wikilink edges get no color (Canvas default grey).
 */
export const SG_EDGE_CATEGORY_COLORS: Record<RelationCategory, string | undefined> = {
	parent:      '#e06b6b', // warm red    — blood/family
	child:       '#e06b6b', // same
	partner:     '#c07ec4', // soft violet — romantic/partnership
	superior:    '#4a7d9c', // steel blue  — faction rank
	subordinate: '#4a7d9c', // same
	other:       '#5b9ac8', // calm blue   — ally, rival, mentor…
};

/**
 * Build the deduplicated edge list between known entities. Targets are
 * matched to entities by name (file basename). Parent/child labels are
 * normalized so the edge always points parent → child with the label kept
 * readable ('Mother', 'Son', …).
 */
export function buildRelationGraph(
	entities: RelEntity[],
	extraTypes: readonly RelationshipType[] = [],
): RelEdge[] {
	const byName = new Map<string, RelEntity>();
	for (const e of entities) byName.set(e.name.toLowerCase(), e);

	const edges: RelEdge[] = [];
	const seen = new Set<string>();
	const add = (fromPath: string, toPath: string, rel: RelationLine, sourcePath: string) => {
		if (fromPath === toPath) return;
		const label = rel.label;
		// Unlabeled duplicates of an existing pair (either direction) are noise
		const pair = [fromPath, toPath].sort().join('↔');
		const key = `${fromPath}→${toPath}:${label.toLowerCase()}`;
		if (seen.has(key)) return;
		if (label === '' && [...seen].some((k) => k.startsWith(`${fromPath}→${toPath}:`) || k.startsWith(`${toPath}→${fromPath}:`))) return;
		seen.add(key);
		seen.add(`pair:${pair}`);
		edges.push({
			fromPath,
			toPath,
			label,
			...(rel.intensity !== undefined ? { intensity: rel.intensity } : {}),
			...(rel.epoch ? { epoch: rel.epoch } : {}),
			sourcePath,
		});
	};

	for (const entity of entities) {
		for (const [, text] of Object.entries(entity.sections)) {
			for (const rel of parseRelationLines(text)) {
				const target = byName.get(rel.target.toLowerCase());
				if (!target) continue;
				const cat = categorizeLabel(rel.label, extraTypes);
				// Only rank-type role nouns; "Member of" (a world link) keeps its own direction on the map.
				const roleInGroup = (cat === 'superior' || cat === 'subordinate') && groupRoleOf(rel.label) !== null;
				if (roleInGroup && entity.kind === 'character' && GROUP_KINDS.has(target.kind)) {
					// "Leader: [[Council]]" / "Member: [[Guild]]" on a person's sheet is how
					// writers say "my role in that group" — the person is the Council's
					// leader, not led by it. The group outranks; the label names the person.
					add(target.path, entity.path, rel, entity.path);
				} else if (roleInGroup && GROUP_KINDS.has(entity.kind) && target.kind === 'character') {
					// The group's own "Leader: [[Idris]]" says the same thing from the other
					// side, so both sheets now produce one edge instead of a two-way loop.
					add(entity.path, target.path, rel, entity.path);
				} else if (cat === 'parent' || cat === 'superior') {
					// "Mother: [[B]]" / "Reports to: [[B]]" on A's sheet → B outranks A
					add(target.path, entity.path, rel, entity.path);
				} else {
					add(entity.path, target.path, rel, entity.path);
				}
			}
		}
	}

	// Drop unlabeled edges that duplicate a labeled connection between the same pair
	const labeledPairs = new Set(
		edges.filter((e) => e.label !== '').map((e) => [e.fromPath, e.toPath].sort().join('↔'))
	);
	return edges.filter((e) => e.label !== '' || !labeledPairs.has([e.fromPath, e.toPath].sort().join('↔')));
}

// ─── Relationship editor helpers (Codex sheet editor / detail page / preview) ─

/**
 * Split parsed relations into the prominent rows (labels in
 * {@link MAIN_RELATION_LABELS}, shown in that order) and everything else
 * (shown collapsed under "Other relationships", original order kept).
 * Bare wikilinks (empty label) always land in `other`.
 */
export function partitionRelationLines(
	rels: readonly RelationLine[],
): { main: RelationLine[]; other: RelationLine[] } {
	const main: RelationLine[] = [];
	const other: RelationLine[] = [];
	for (const rel of rels) {
		if (rel.label && MAIN_RELATION_LABELS.includes(rel.label.toLowerCase().trim())) main.push(rel);
		else other.push(rel);
	}
	main.sort(
		(a, b) =>
			MAIN_RELATION_LABELS.indexOf(a.label.toLowerCase().trim()) -
			MAIN_RELATION_LABELS.indexOf(b.label.toLowerCase().trim()),
	);
	return { main, other };
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/** Index of the first line whose trimmed text equals the relation's `raw` source line. */
function findRawLine(lines: string[], rel: RelationLine): number {
	if (!rel.raw) return -1;
	return lines.findIndex((l) => l.trim() === rel.raw);
}

/**
 * Remove one relation from the section text with a targeted line edit — every
 * other line stays byte-for-byte untouched. On a multi-target line
 * (`Allies: [[A]], [[B]]`) only that wikilink (plus its comma separator) is
 * removed; the line disappears only when it holds no other link. Returns the
 * text unchanged when the relation's source line can't be found.
 */
export function removeRelationFromText(text: string, rel: RelationLine): string {
	const lines = text.split(/\r?\n/);
	const idx = findRawLine(lines, rel);
	if (idx === -1) return text;
	const line = lines[idx];
	const links = [...line.matchAll(WIKILINK_RE)];
	const target = links.find((m) => m[1].trim() === rel.target);
	if (!target || links.length <= 1) {
		lines.splice(idx, 1);
	} else {
		const start = target.index ?? 0;
		let before = line.slice(0, start);
		let after = line.slice(start + target[0].length);
		// Eat one comma separator so `[[A]], [[B]]` collapses cleanly either way.
		if (/,\s*$/.test(before)) before = before.replace(/,\s*$/, '');
		else after = after.replace(/^\s*,\s*/, /\s$/.test(before) ? '' : ' ');
		lines[idx] = `${before}${after}`.trimEnd();
		if (!lines[idx].trim()) lines.splice(idx, 1);
	}
	return lines.join('\n');
}

/**
 * Set (or clear, with `undefined`) the intensity annotation on a relation's
 * source line, preserving the line's own text plus any epoch/unknown
 * annotation items verbatim. Targeted line edit like
 * {@link removeRelationFromText}; unchanged text when the line isn't found.
 */
export function setRelationIntensity(
	text: string,
	rel: RelationLine,
	intensity: number | undefined,
): string {
	const lines = text.split(/\r?\n/);
	const idx = findRawLine(lines, rel);
	if (idx === -1) return text;
	const indent = lines[idx].match(/^\s*/)?.[0] ?? '';
	const ann = parseAnnotations(lines[idx].trim());
	const items: string[] = [];
	if (intensity !== undefined) items.push(`intensity ${Math.min(10, Math.max(1, Math.round(intensity)))}`);
	if (ann.epoch) items.push(`epoch ${ann.epoch}`);
	if (ann.extra) items.push(...ann.extra);
	lines[idx] = indent + (items.length > 0 ? `${ann.rest} (${items.join(', ')})` : ann.rest);
	return lines.join('\n');
}

/**
 * Whether declaring `label` on one sheet may auto-write a reciprocal line on
 * the target's sheet. False ONLY for 'world' behavior — Category 5 is strictly
 * character→world, nothing is ever written on a Location/Faction sheet. Every
 * other behavior keeps the pre-existing auto-write logic (one-way relations
 * are already skipped by their null reciprocal word, not here).
 */
export function shouldAutoWriteReciprocal(
	label: string,
	extraTypes: readonly RelationshipType[] = [],
): boolean {
	return classifyRelation(label, extraTypes).behavior !== 'world';
}

// ─── Hierarchy contradiction detection ───────────────────────────────────────

/**
 * Find impossible loops in the strict-hierarchy edges — a character who ends up
 * their own ancestor, or a chain of command that eats its own tail.
 *
 * Only edges that are genealogy or rank are considered: relationship types whose
 * behavior is 'hierarchy', plus the parent/child family categories. Every such
 * edge points downward after {@link buildRelationGraph} normalizes direction, so
 * ANY directed cycle among them is a logical contradiction.
 *
 * Returns one array of vault paths per cycle found, each starting and ending on
 * the same path (`[A, B, A]`), ready to join with " → " for the warning banner.
 */
export function findHierarchyLoops(
	edges: RelEdge[],
	extraTypes: readonly RelationshipType[] = [],
): string[][] {
	const strict = edges.filter((e) => {
		if (!e.label) return false;
		const rt = classifyRelation(e.label, extraTypes);
		return rt.behavior === 'hierarchy' || rt.category === 'parent' || rt.category === 'child';
	});
	if (strict.length === 0) return [];

	const out = new Map<string, string[]>();
	for (const e of strict) {
		if (!out.has(e.fromPath)) out.set(e.fromPath, []);
		(out.get(e.fromPath) as string[]).push(e.toPath);
	}

	const cycles: string[][] = [];
	const seenCycles = new Set<string>();
	const state = new Map<string, 'visiting' | 'done'>();
	const stack: string[] = [];

	const visit = (path: string): void => {
		const mark = state.get(path);
		if (mark === 'done') return;
		if (mark === 'visiting') {
			// Found a back-edge — slice the cycle out of the current stack.
			const start = stack.indexOf(path);
			if (start === -1) return;
			const cycle = [...stack.slice(start), path];
			// Rotate to a canonical starting point so the same loop isn't reported twice.
			const body = cycle.slice(0, -1);
			const pivot = body.indexOf([...body].sort()[0]);
			const key = [...body.slice(pivot), ...body.slice(0, pivot)].join('→');
			if (!seenCycles.has(key)) {
				seenCycles.add(key);
				cycles.push(cycle);
			}
			return;
		}
		state.set(path, 'visiting');
		stack.push(path);
		for (const next of out.get(path) ?? []) visit(next);
		stack.pop();
		state.set(path, 'done');
	};

	for (const path of out.keys()) visit(path);
	return cycles;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

export interface NodePosition {
	path: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Entity kind — used for node color in Canvas output. */
	kind?: EntityKind;
}

const NODE_W = 260;
const NODE_H = 130;
const GAP_X = 100;
const GAP_Y = 100;
const GAP_Y_CLUSTER = 60; // tighter vertical spacing within same-kind columns

/**
 * Position connected entities for the Canvas. Characters joined by family
 * edges are layered by generation (a family tree); everything else clusters
 * in columns by kind to the right of the tree.
 */
export function layoutGraph(entities: RelEntity[], edges: RelEdge[]): NodePosition[] {
	const connected = new Set<string>();
	for (const e of edges) { connected.add(e.fromPath); connected.add(e.toPath); }
	const nodes = entities.filter((e) => connected.has(e.path));

	// Generation layering over parent edges (parent → child after normalization)
	const parentEdges = edges.filter((e) => {
		const cat = categorizeLabel(e.label);
		return cat === 'parent' || cat === 'child';
	});
	const partnerEdges = edges.filter((e) => categorizeLabel(e.label) === 'partner');
	const inFamily = new Set<string>();
	for (const e of parentEdges) { inFamily.add(e.fromPath); inFamily.add(e.toPath); }
	// Partners of family members join the tree on the same layer
	for (const e of partnerEdges) {
		if (inFamily.has(e.fromPath) || inFamily.has(e.toPath)) {
			inFamily.add(e.fromPath); inFamily.add(e.toPath);
		}
	}

	const generation = new Map<string, number>();
	for (const path of inFamily) generation.set(path, 0);
	// Relax generations: child = parent + 1; partners equalize. Few iterations suffice.
	for (let i = 0; i < 12; i++) {
		let changed = false;
		for (const e of parentEdges) {
			const g = Math.max(generation.get(e.toPath) ?? 0, (generation.get(e.fromPath) ?? 0) + 1);
			if (g !== generation.get(e.toPath)) { generation.set(e.toPath, g); changed = true; }
		}
		for (const e of partnerEdges) {
			if (!inFamily.has(e.fromPath)) continue;
			const g = Math.max(generation.get(e.fromPath) ?? 0, generation.get(e.toPath) ?? 0);
			if (generation.get(e.fromPath) !== g) { generation.set(e.fromPath, g); changed = true; }
			if (generation.get(e.toPath) !== g) { generation.set(e.toPath, g); changed = true; }
		}
		if (!changed) break;
	}

	// Quick lookup: vault path → entity (for kind tagging on NodePosition)
	const entityByPath = new Map(entities.map((e) => [e.path, e]));

	const positions: NodePosition[] = [];

	// ── Family tree layout (barycenter + partner adjacency + parent centering) ──
	const byGen = new Map<number, string[]>();
	for (const path of inFamily) {
		const g = generation.get(path) ?? 0;
		if (!byGen.has(g)) byGen.set(g, []);
		(byGen.get(g) as string[]).push(path);
	}
	const sortedGens = [...byGen.keys()].sort((a, b) => a - b);

	// Mutable x-position map; y is always fixed by generation
	const xOf = new Map<string, number>();

	// Pass 1 — top-down: sort each generation by barycenter of already-placed parents
	for (const g of sortedGens) {
		const row = [...(byGen.get(g) as string[])];

		row.sort((a, b) => {
			const bcA = midX(treeParents(a, parentEdges).map((p) => xOf.get(p)).filter((x): x is number => x !== undefined));
			const bcB = midX(treeParents(b, parentEdges).map((p) => xOf.get(p)).filter((x): x is number => x !== undefined));
			// Nodes with no placed parents sort alphabetically at the front
			if (bcA === null && bcB === null) return (entityByPath.get(a)?.name ?? a).localeCompare(entityByPath.get(b)?.name ?? b);
			if (bcA === null) return -1;
			if (bcB === null) return 1;
			return bcA - bcB;
		});

		// Keep partners side-by-side: the second partner is pulled next to the first
		arrangePartnersAdjacent(row, partnerEdges);

		row.forEach((path, i) => xOf.set(path, i * (NODE_W + GAP_X)));
		byGen.set(g, row); // store sorted order for later passes
	}

	// Pass 2 — bottom-up: center each parent over the midpoint of its children
	for (const g of [...sortedGens].reverse()) {
		for (const path of byGen.get(g) as string[]) {
			const kidXs = treeChildren(path, parentEdges)
				.map((p) => xOf.get(p))
				.filter((x): x is number => x !== undefined);
			const center = midX(kidXs);
			if (center !== null) xOf.set(path, center);
		}
	}

	// Pass 3 — top-down compaction: restore minimum spacing after centering moves
	// Sort each generation by current x, then sweep left-to-right ensuring no overlap
	for (const g of sortedGens) {
		const row = [...(byGen.get(g) as string[])].sort((a, b) => (xOf.get(a) ?? 0) - (xOf.get(b) ?? 0));
		let prevRight = -Infinity;
		for (const path of row) {
			const x = Math.max(xOf.get(path) ?? 0, prevRight + GAP_X);
			xOf.set(path, x);
			prevRight = x + NODE_W;
		}
		byGen.set(g, row);
	}

	// Emit final NodePositions and compute tree width
	let treeWidth = 0;
	for (const g of sortedGens) {
		for (const path of byGen.get(g) as string[]) {
			const x = xOf.get(path) ?? 0;
			positions.push({
				path,
				x,
				y: g * (NODE_H + GAP_Y),
				width: NODE_W,
				height: NODE_H,
				kind: entityByPath.get(path)?.kind,
			});
			treeWidth = Math.max(treeWidth, x + NODE_W + GAP_X);
		}
	}

	// Everyone else: columns clustered by kind, to the right of the tree
	const rest = nodes.filter((n) => !inFamily.has(n.path));
	const kindOrder: EntityKind[] = ['character', 'location', 'faction', 'system', 'item', 'research', 'scene'];
	const startX = treeWidth > 0 ? treeWidth + 2 * GAP_X : 0;
	let col = 0;
	for (const kind of kindOrder) {
		const ofKind = rest.filter((n) => n.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
		if (ofKind.length === 0) continue;
		ofKind.forEach((n, i) => {
			positions.push({
				path: n.path,
				x: startX + col * (NODE_W + GAP_X),
				y: i * (NODE_H + GAP_Y_CLUSTER),
				width: NODE_W,
				height: NODE_H,
				kind: n.kind,
			});
		});
		col++;
	}

	return positions;
}

// ─── Family layout helpers (pure, used only by layoutGraph) ──────────────────

/**
 * Paths of entities that are parents of `path` (edges point parent → child).
 * Exported for reuse by other hierarchy-layout modules (e.g. the Story Tree
 * view's faction-rank layout), which pass in their own up→down edge list.
 */
export function treeParents(path: string, parentEdges: RelEdge[]): string[] {
	return parentEdges.filter((e) => e.toPath === path).map((e) => e.fromPath);
}

/** Paths of entities that are children of `path`. */
export function treeChildren(path: string, parentEdges: RelEdge[]): string[] {
	return parentEdges.filter((e) => e.fromPath === path).map((e) => e.toPath);
}

/**
 * Midpoint of a list of x-coordinates: (min + max) / 2.
 * Returns null for an empty list so callers can handle "no data" explicitly.
 */
export function midX(xs: number[]): number | null {
	if (xs.length === 0) return null;
	return (Math.min(...xs) + Math.max(...xs)) / 2;
}

/**
 * Reorder `row` in place so that partners appear immediately adjacent.
 * The first partner encountered in the sorted order "pulls" its counterpart
 * to the slot right after it.
 */
export function arrangePartnersAdjacent(row: string[], partnerEdges: RelEdge[]): void {
	const partnerOf = new Map<string, string>();
	for (const e of partnerEdges) {
		partnerOf.set(e.fromPath, e.toPath);
		partnerOf.set(e.toPath, e.fromPath);
	}
	const result: string[] = [];
	const placed = new Set<string>();
	for (const path of row) {
		if (placed.has(path)) continue;
		result.push(path);
		placed.add(path);
		const partner = partnerOf.get(path);
		if (partner && row.includes(partner) && !placed.has(partner)) {
			result.push(partner);
			placed.add(partner);
		}
	}
	row.splice(0, row.length, ...result);
}

// ─── Canvas serialization ────────────────────────────────────────────────────

/** Stable node id from a vault path (canvas-internal only). */
function nodeId(path: string): string {
	let hash = 0;
	for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) | 0;
	return 'sg' + Math.abs(hash).toString(36);
}

/** Serialize positions + edges into Obsidian Canvas JSON. */
export function buildCanvasJson(positions: NodePosition[], edges: RelEdge[]): string {
	const ids = new Map(positions.map((p) => [p.path, nodeId(p.path)]));
	const yOf = new Map(positions.map((p) => [p.path, p.y]));

	const nodes = positions.map((p) => {
		const color = p.kind ? SG_KIND_CANVAS_COLORS[p.kind] : undefined;
		return {
			id: ids.get(p.path),
			type: 'file',
			file: p.path,
			x: p.x,
			y: p.y,
			width: p.width,
			height: p.height,
			...(color ? { color } : {}),
		};
	});

	const canvasEdges = edges
		.filter((e) => ids.has(e.fromPath) && ids.has(e.toPath))
		.map((e, i) => {
			const fromY = yOf.get(e.fromPath) ?? 0;
			const toY = yOf.get(e.toPath) ?? 0;
			const vertical = fromY !== toY;
			// Leave from whichever side faces the target so lines never loop
			const fromAbove = fromY < toY;
			const edgeColor = e.label
				? SG_EDGE_CATEGORY_COLORS[categorizeLabel(e.label)]
				: undefined;
			return {
				id: `sge${i.toString(36)}`,
				fromNode: ids.get(e.fromPath),
				fromSide: vertical ? (fromAbove ? 'bottom' : 'top') : 'right',
				toNode: ids.get(e.toPath),
				toSide: vertical ? (fromAbove ? 'top' : 'bottom') : 'left',
				...(e.label ? { label: e.label } : {}),
				...(edgeColor ? { color: edgeColor } : {}),
			};
		});

	return JSON.stringify({ nodes, edges: canvasEdges }, null, '\t');
}
