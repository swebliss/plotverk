/**
 * Pure hierarchy-tree builder for the Story Tree view (family trees and
 * faction chains-of-command). No Obsidian imports — fully unit-testable.
 *
 * Reuses the barycenter-positioning math that the Canvas relationship-map's
 * `layoutGraph` proved out in relations.ts, but reads the sheets the way
 * writers write them before layering:
 *  - kinship words carry a generation step (a grandmother is two rows up, with
 *    an in-memory "unknown parent" between), and cousins, aunts, uncles,
 *    guardians and wards are understood;
 *  - an older "child" than its "parent" is read the other way round (with a note);
 *  - a person's rank line to a faction is their role in it (members under the
 *    faction, leaders between the two);
 *  - a loop between two sheets is skipped with a note instead of pushing rows down.
 * The tree never writes back to a sheet.
 */

import { EntityKind } from '../entities/entity-kinds';
import {
	RelEntity,
	RelEdge,
	categorizeLabel,
	classifyRelation,
	treeParents,
	treeChildren,
	midX,
	GROUP_KINDS,
	groupRoleOf,
} from './relations';
import { TreeReading, treeReadingsFromWordGroups } from './relation-mirror';

export type TreeMode = 'family' | 'faction';

/** What the tree knows about a person's life, read from their sheet. */
export interface LifeFacts {
	/** Age as written on the sheet ("81"). */
	age?: number;
	/** Birth year as written on the sheet ("1102", "b. 1102 AE"). */
	born?: number;
	/** Year of death as written on the sheet ("1129"); only when the Died field holds one. */
	died?: number;
	deceased?: boolean;
}

export interface TreeFilterOptions {
	/** Vault path of the entity to center the tree on. Omit for the whole hierarchy-connected network. */
	focusPath?: string;
	/** Max generations above the focus entity to include. Ignored without focusPath. Default: unlimited. */
	generationsUp?: number;
	/** Max generations below the focus entity to include. Ignored without focusPath. Default: unlimited. */
	generationsDown?: number;
	/** Family mode only: include partners of included entities at their same generation. Default: true. */
	includePartners?: boolean;
	/** Age / birth year per entity path — used to catch a family line written the wrong way round. */
	lifeFacts?: ReadonlyMap<string, LifeFacts>;
}

export interface TreeNode {
	path: string;
	name: string;
	kind: EntityKind;
	/** Row number. Relative to the focus entity (0) when focused; rows start at 0 otherwise. Never has gaps. */
	generation: number;
	/** An in-memory "unknown parent" standing in for a generation no sheet names. Has no file. */
	placeholder?: boolean;
	/**
	 * Faction mode: this card is a second copy of someone who belongs to more than
	 * one group, drawn inside that other group's block. `refPath` is the real entry;
	 * `path` is a made-up key ("<entry>#in:<group>") that is never a file.
	 */
	refPath?: string;
}

/**
 * How an edge is drawn:
 *  - 'line'    parent → child, group → member, superior → subordinate: the solid
 *              right-angle connector. Only these drive the layout.
 *  - 'kin'     guardian/ward, aunt/uncle, niece/nephew: a faint dotted line.
 *  - 'partner' | 'sibling' | 'cousin': two people on the same row.
 */
export type TreeEdgeKind = 'line' | 'kin' | 'partner' | 'sibling' | 'cousin';

export interface TreeEdge {
	/** Higher row (ancestor / superior), or either partner/sibling/cousin. */
	fromPath: string;
	/** Lower row (descendant / subordinate), or the other partner/sibling/cousin. */
	toPath: string;
	label: string;
	kind: TreeEdgeKind;
	/** Faction members: the group's leaders, drawn between the group and its members. */
	viaPaths?: string[];
}

/** Something the tree had to decide about the sheets, shown to the writer as a quiet note. */
export type TreeNote =
	/** Two sheets put each other above one another; the line from→to was left out. */
	| { type: 'loop'; fromPath: string; toPath: string; label: string }
	/** `label: [[target]]` on source's sheet was read with source as the older one. */
	| { type: 'flipped'; sourcePath: string; targetPath: string; label: string };

export interface TreeData {
	nodes: TreeNode[];
	edges: TreeEdge[];
	/** Paths whose row could not settle (only possible through partner/sibling rows that contradict each other). */
	cycleNodes?: string[];
	notes?: TreeNote[];
}

export interface TreePosition {
	path: string;
	x: number;
	generation: number;
}

export interface TreeUnion {
	/** Exactly 2 parent paths, sorted for stable identity. */
	parentPaths: string[];
	childPaths: string[];
	/** What the two sheets say about the pair (see `coupleStatus`). */
	status: CoupleStatus;
}

// ─── Reading the sheets ───────────────────────────────────────────────────────

/**
 * Family words the relationship registry doesn't separate from plain
 * parent/child (grand-, great-grand-) or doesn't know at all (cousin, aunt,
 * guardian…). Tree-only on purpose: the Connections Map's types, colours and
 * legend stay exactly as they are. `up` = the linked entry sits above the
 * sheet's owner ("Grandmother: [[Tull]]" on Mara's sheet → Tull is two rows up).
 */
const KIN_WORDS: Record<string, TreeReading> = {};
const kin = (words: string[], value: TreeReading) => {
	for (const w of words) KIN_WORDS[w] = value;
};
kin(['grandmother', 'grandfather', 'grandparent', 'grandparents', 'grandma', 'grandpa', 'granny', 'grandmother of'], { up: true, delta: 2, kind: 'line' });
kin(['great-grandmother', 'great-grandfather', 'great-grandparent', 'great grandmother', 'great grandfather', 'great grandparent'], { up: true, delta: 3, kind: 'line' });
kin(['grandchild', 'grandchildren', 'grandson', 'granddaughter', 'grandsons', 'granddaughters'], { up: false, delta: 2, kind: 'line' });
kin(['great-grandchild', 'great-grandson', 'great-granddaughter', 'great grandchild', 'great grandson', 'great granddaughter'], { up: false, delta: 3, kind: 'line' });
kin(['aunt', 'uncle', 'aunts', 'uncles', 'great-aunt', 'great-uncle', 'great aunt', 'great uncle'], { up: true, delta: 1, kind: 'kin' });
kin(['niece', 'nephew', 'nieces', 'nephews', 'grandniece', 'grandnephew'], { up: false, delta: 1, kind: 'kin' });
kin(['guardian', 'legal guardian', 'foster mother', 'foster father', 'foster parent', 'adoptive mother', 'adoptive father'], { up: true, delta: 1, kind: 'kin' });
kin(['ward', 'wards', 'foster child', 'foster son', 'foster daughter'], { up: false, delta: 1, kind: 'kin' });
kin(['cousin', 'cousins', 'second cousin', 'first cousin'], { same: true });
// The mirroring table's words (Aunt/Uncle, Parent-in-law, Adopted child…), so
// every word Plotverk writes onto another sheet draws on the right row.
for (const { words, reading } of treeReadingsFromWordGroups()) kin([...words], reading);

/** Test seam: how the tree reads one relationship word, or undefined when the kin table doesn't know it. */
export function kinReadingOf(label: string): TreeReading | undefined {
	return KIN_WORDS[label.toLowerCase().trim()];
}

/**
 * How a couple stands, drawn on the line between them (genogram style):
 * divorced = two slashes, separated = one slash, married = solid,
 * together = dashed (unmarried, living together, engaged), child = a soft
 * plain line for two people who only share a child.
 */
export type CoupleStatus = 'divorced' | 'separated' | 'married' | 'together' | 'child';

/** Most specific first: where the two sheets disagree, the earlier one wins. */
const COUPLE_ORDER: CoupleStatus[] = ['divorced', 'separated', 'married', 'together', 'child'];

/**
 * Couple words in English, Spanish and French. Tree-only like KIN_WORDS: the
 * registry's partner words still mean "married" here, and words it doesn't
 * know (ex-wife, novia, divorcé…) become partner lines in the tree only.
 */
const COUPLE_WORDS: Record<string, CoupleStatus> = {};
const couple = (words: string[], status: CoupleStatus) => {
	for (const w of words) COUPLE_WORDS[w] = status;
};
couple([
	'ex', 'ex-partner', 'ex-partners', 'ex-spouse', 'ex-husband', 'ex-wife', 'former partner', 'former spouse', 'former husband', 'former wife', 'divorced', 'divorced from', 'divorcee',
	'ex-esposo', 'ex-esposa', 'exesposo', 'exesposa', 'ex-marido', 'exmarido', 'ex-mujer', 'exmujer', 'ex-pareja', 'expareja', 'ex-cónyuge', 'divorciado', 'divorciada', 'divorciado de', 'divorciada de',
	'ex-mari', 'ex-femme', 'ex-époux', 'ex-épouse', 'ex-conjoint', 'ex-conjointe', 'divorcé', 'divorcée', 'divorcé de', 'divorcée de',
], 'divorced');
couple([
	'separated', 'separated from', 'estranged husband', 'estranged wife', 'estranged spouse', 'ex-lover', 'broken betrothal',
	'separado', 'separada', 'separado de', 'separada de', 'ex-novio', 'ex-novia', 'exnovio', 'exnovia', 'ex-amante',
	'séparé', 'séparée', 'séparé de', 'séparée de', 'ex-compagnon', 'ex-compagne', 'ex-amant', 'ex-fiancé', 'ex-fiancée',
], 'separated');
couple([
	'partner', 'partners', 'partner of', 'spouse', 'spouses', 'husband', 'wife', 'married', 'married to',
	'esposo', 'esposa', 'marido', 'mujer', 'cónyuge', 'pareja', 'casado con', 'casada con',
	'mari', 'femme', 'époux', 'épouse', 'conjoint', 'conjointe', 'partenaire', 'marié à', 'mariée à',
], 'married');
couple([
	'lover', 'lovers', 'boyfriend', 'girlfriend', 'living with', 'lives with', 'cohabiting', 'cohabitant', 'common-law partner', 'common-law spouse', 'betrothed', 'fiancé', 'fiancée', 'fiance', 'fiancee', 'engaged to',
	'amante', 'novio', 'novia', 'prometido', 'prometida', 'conviviente', 'vive con', 'pareja de hecho',
	'amant', 'compagnon', 'compagne', 'concubin', 'concubine', 'vit avec', 'fiancé à', 'fiancée à',
], 'together');

/** The couple status one relationship word stands for, or null when it isn't a couple word. */
export function coupleStatusOf(label: string): CoupleStatus | null {
	const l = label.toLowerCase().trim();
	return COUPLE_WORDS[l] ?? (classifyRelation(l).category === 'partner' ? 'married' : null);
}

/** One status for a couple from every word either sheet uses for the other: the most specific wins; none = 'child'. */
export function coupleStatus(labels: readonly string[]): CoupleStatus {
	const found = new Set(labels.map(coupleStatusOf));
	return COUPLE_ORDER.find((s) => found.has(s)) ?? 'child';
}

/** A "this one sits `delta` rows above that one" reading of one edge. */
interface Link {
	hi: string;
	lo: string;
	delta: number;
	kind: 'line' | 'kin';
	label: string;
	sourcePath?: string;
	via?: string[];
}

interface SameLink {
	a: string;
	b: string;
	kind: 'partner' | 'sibling' | 'cousin';
	label: string;
}

/**
 * Whether the Family tree has anything to show around this entry: one line,
 * written on either sheet, that the tree reads as family (parent, child,
 * sibling, partner or ex, cousin, grand-, aunt, guardian…). Uses the tree's
 * own reading, so a "View family tree" button and the tree never disagree.
 */
export function hasFamilyTie(path: string, edges: readonly RelEdge[]): boolean {
	return edges.some((e) => (e.fromPath === path || e.toPath === path) && readFamilyEdge(e) !== null);
}

/** The other end of an edge from the sheet it was written on. */
function targetOf(e: RelEdge, source: string): string {
	return source === e.fromPath ? e.toPath : e.fromPath;
}

function readFamilyEdge(e: RelEdge): Link | SameLink | null {
	const word = KIN_WORDS[e.label.toLowerCase().trim()];
	if (word && 'same' in word) return { a: e.fromPath, b: e.toPath, kind: 'cousin', label: e.label };
	const rt = classifyRelation(e.label);
	if (word) {
		// buildRelationGraph already put the higher one first for registry
		// parent/child words; for everything else the edge starts at the sheet.
		const registryOriented = rt.category === 'parent' || rt.category === 'child';
		const source = e.sourcePath ?? (registryOriented && word.up ? e.toPath : e.fromPath);
		const target = targetOf(e, source);
		return {
			hi: word.up ? target : source,
			lo: word.up ? source : target,
			delta: word.delta,
			kind: word.kind,
			label: e.label,
			sourcePath: e.sourcePath,
		};
	}
	if (coupleStatusOf(e.label)) return { a: e.fromPath, b: e.toPath, kind: 'partner', label: e.label };
	if (rt.id === 'sibling') return { a: e.fromPath, b: e.toPath, kind: 'sibling', label: e.label };
	if (rt.category === 'parent' || rt.category === 'child') {
		return { hi: e.fromPath, lo: e.toPath, delta: 1, kind: 'line', label: e.label, sourcePath: e.sourcePath };
	}
	return null;
}

/**
 * Faction mode: person ↔ group rank lines become "role in the group" (leaders
 * one row under the group, members one row under its leaders); every other
 * superior/subordinate line is a plain one-row step, higher end first.
 */
function readFactionEdges(edges: RelEdge[], kindOf: (path: string) => EntityKind | undefined): Link[] {
	const links: Link[] = [];
	// group → person → best role ('leader' beats 'member')
	const roles = new Map<string, Map<string, { leader: boolean; label: string; sourcePath?: string }>>();

	for (const e of edges) {
		const cat = categorizeLabel(e.label);
		const isRank = cat === 'superior' || cat === 'subordinate';
		const fromKind = kindOf(e.fromPath);
		const toKind = kindOf(e.toPath);
		const fromGroup = fromKind !== undefined && GROUP_KINDS.has(fromKind);
		const toGroup = toKind !== undefined && GROUP_KINDS.has(toKind);
		const personGroup = (fromGroup && toKind === 'character') || (toGroup && fromKind === 'character');
		const role = personGroup ? groupRoleOf(e.label) : null;
		if (role) {
			const group = fromGroup ? e.fromPath : e.toPath;
			const person = fromGroup ? e.toPath : e.fromPath;
			const leader = role === 'leader';
			if (!roles.has(group)) roles.set(group, new Map());
			const byPerson = roles.get(group) as Map<string, { leader: boolean; label: string; sourcePath?: string }>;
			const prev = byPerson.get(person);
			if (!prev || (leader && !prev.leader)) byPerson.set(person, { leader, label: e.label, sourcePath: e.sourcePath });
		} else if (isRank) {
			links.push({ hi: e.fromPath, lo: e.toPath, delta: 1, kind: 'line', label: e.label, sourcePath: e.sourcePath });
		}
	}

	for (const [group, byPerson] of roles) {
		const leaders = [...byPerson].filter(([, r]) => r.leader).map(([p]) => p);
		for (const [person, r] of byPerson) {
			const base = { hi: group, lo: person, kind: 'line' as const, label: r.label, sourcePath: r.sourcePath };
			if (r.leader || leaders.length === 0) links.push({ ...base, delta: 1 });
			else links.push({ ...base, delta: 2, via: leaders });
		}
	}
	return links;
}

/** true when `a` is known to be older than `b`; undefined when the sheets don't say. */
function isOlder(a: LifeFacts | undefined, b: LifeFacts | undefined): boolean | undefined {
	if (a?.born !== undefined && b?.born !== undefined) return a.born < b.born;
	if (a?.age !== undefined && b?.age !== undefined) return a.age > b.age;
	return undefined;
}

// ─── Building the tree ────────────────────────────────────────────────────────

/**
 * Read, scope and row-layer a relationship graph for the given mode. With no
 * focusPath, includes the whole hierarchy-connected network (every
 * disconnected cluster starts at the top row). With a focusPath, walks
 * outward from it along the hierarchy and same-row lines up to the given
 * generation limits.
 */
export function buildTreeData(entities: RelEntity[], allEdges: RelEdge[], mode: TreeMode, opts: TreeFilterOptions = {}): TreeData {
	const entityByPath = new Map(entities.map((e) => [e.path, e]));
	const includePartners = mode === 'family' && opts.includePartners !== false;
	const notes: TreeNote[] = [];

	let links: Link[] = [];
	const sameLinks: SameLink[] = [];
	if (mode === 'family') {
		for (const e of allEdges) {
			const r = readFamilyEdge(e);
			if (!r) continue;
			if ('hi' in r) links.push(r);
			else if (r.kind !== 'partner' || includePartners) sameLinks.push(r);
		}
		links = flipYoungerElders(links, opts.lifeFacts, notes);
	} else {
		links = readFactionEdges(allEdges, (p) => entityByPath.get(p)?.kind);
	}
	links = dedupeLinks(links);

	const placeholders: TreeNode[] = [];
	if (mode === 'family') links = bridgeSkippedGenerations(links, sameLinks, placeholders);

	const active = removeLoops(links, sameLinks, notes);

	let generation: Map<string, number>;
	let cycleNodes: string[] = [];
	if (opts.focusPath && entityByPath.has(opts.focusPath)) {
		const bfs = focusGenerations(opts.focusPath, active, sameLinks, opts.generationsUp ?? Infinity, opts.generationsDown ?? Infinity);
		generation = compactRows(bfs.gen, opts.focusPath);
		cycleNodes = bfs.cycleNodes;
	} else {
		generation = compactRows(wholeTreeGenerations(active, sameLinks));
	}

	const placeholderByPath = new Map(placeholders.map((n) => [n.path, n]));
	const nodes: TreeNode[] = [];
	for (const [path, g] of generation) {
		const e = entityByPath.get(path);
		if (e) nodes.push({ path, name: e.name, kind: e.kind, generation: g });
		else if (placeholderByPath.has(path)) nodes.push({ ...(placeholderByPath.get(path) as TreeNode), generation: g });
	}

	const included = new Set(nodes.map((n) => n.path));
	const edges: TreeEdge[] = [];
	for (const l of active) {
		if (!included.has(l.hi) || !included.has(l.lo)) continue;
		const via = l.via?.filter((p) => included.has(p));
		edges.push({ fromPath: l.hi, toPath: l.lo, label: l.label, kind: l.kind, ...(via?.length ? { viaPaths: via } : {}) });
	}
	for (const s of sameLinks) {
		if (included.has(s.a) && included.has(s.b)) edges.push({ fromPath: s.a, toPath: s.b, label: s.label, kind: s.kind });
	}

	if (mode === 'faction') {
		const split = splitFactionCopies(nodes, edges, opts.focusPath && entityByPath.has(opts.focusPath) ? opts.focusPath : undefined);
		nodes.splice(0, nodes.length, ...split.nodes);
		edges.splice(0, edges.length, ...split.edges);
	}

	const shownNotes = notes.filter((n) =>
		n.type === 'loop' ? included.has(n.fromPath) || included.has(n.toPath) : included.has(n.sourcePath) || included.has(n.targetPath)
	);
	return {
		nodes,
		edges,
		...(cycleNodes.length ? { cycleNodes } : {}),
		...(shownNotes.length ? { notes: shownNotes } : {}),
	};
}

/** The made-up key for `person`'s second card inside `group`'s block (`#` never appears in a vault path). */
const copyKey = (person: string, group: string): string => `${person}#in:${group}`;

/**
 * Faction mode: someone in more than one group gets a card in each group's
 * block, so every block holds all its people and no line runs between blocks.
 * The entry itself stays in the group they lead (or the first by name); the
 * other groups get a copy (`refPath`). Rows are worked out again afterwards,
 * since a person no longer has to sit low enough for every group at once.
 */
function splitFactionCopies(nodes: TreeNode[], edges: TreeEdge[], focus?: string): { nodes: TreeNode[]; edges: TreeEdge[] } {
	const byPath = new Map(nodes.map((n) => [n.path, n]));
	const isGroup = (p: string) => GROUP_KINDS.has(byPath.get(p)?.kind ?? '');
	const nameOf = (p: string) => byPath.get(p)?.name ?? p;

	const groupsOf = new Map<string, Array<{ group: string; leader: boolean }>>();
	for (const e of edges) {
		if (e.kind !== 'line' || !isGroup(e.fromPath) || isGroup(e.toPath)) continue;
		const list = groupsOf.get(e.toPath) ?? [];
		const leader = !e.viaPaths?.length && groupRoleOf(e.label) === 'leader';
		const prev = list.find((x) => x.group === e.fromPath);
		if (prev) prev.leader = prev.leader || leader;
		else list.push({ group: e.fromPath, leader });
		groupsOf.set(e.toPath, list);
	}
	const homeOf = new Map<string, string>();
	for (const [person, list] of groupsOf) {
		if (list.length < 2) continue;
		const sorted = [...list].sort((a, b) => Number(b.leader) - Number(a.leader) || nameOf(a.group).localeCompare(nameOf(b.group)));
		homeOf.set(person, sorted[0].group);
	}

	const copies = new Map<string, TreeNode>();
	const keyIn = (person: string, group: string): string => {
		const home = homeOf.get(person);
		if (!home || home === group) return person;
		const key = copyKey(person, group);
		if (!copies.has(key)) copies.set(key, { ...(byPath.get(person) as TreeNode), path: key, refPath: person });
		return key;
	};
	const outEdges = edges.map((e) => {
		if (e.kind !== 'line' || !isGroup(e.fromPath) || isGroup(e.toPath)) return e;
		const via = e.viaPaths?.map((v) => keyIn(v, e.fromPath));
		return { ...e, toPath: keyIn(e.toPath, e.fromPath), ...(via ? { viaPaths: via } : {}) };
	});

	// Longest path down the lines; a member also sits below its group's leaders.
	const all = [...nodes, ...copies.values()];
	const gen = new Map(all.map((n) => [n.path, 0]));
	for (let pass = 0; pass <= all.length; pass++) {
		let changed = false;
		for (const e of outEdges) {
			if (e.kind !== 'line') continue;
			const need = Math.max((gen.get(e.fromPath) ?? 0) + 1, ...(e.viaPaths ?? []).map((v) => (gen.get(v) ?? 0) + 1));
			if (need > (gen.get(e.toPath) ?? 0)) {
				gen.set(e.toPath, need);
				changed = true;
			}
		}
		if (!changed) break;
	}
	const rows = compactRows(gen, focus);
	return { nodes: all.map((n) => ({ ...n, generation: rows.get(n.path) ?? n.generation })), edges: outEdges };
}

/** A "parent" the sheets say is younger than their "child" is read the other way round. */
function flipYoungerElders(links: Link[], facts: ReadonlyMap<string, LifeFacts> | undefined, notes: TreeNote[]): Link[] {
	if (!facts) return links;
	return links.map((l) => {
		// A younger aunt or guardian is ordinary, so a dotted line is only checked
		// when another entry states the same bond the other way round.
		const contested = l.kind === 'line' || links.some((o) => o.kind === l.kind && o.hi === l.lo && o.lo === l.hi);
		if (!contested || isOlder(facts.get(l.lo), facts.get(l.hi)) !== true) return l;
		if (l.sourcePath) notes.push({ type: 'flipped', sourcePath: l.sourcePath, targetPath: l.sourcePath === l.hi ? l.lo : l.hi, label: l.label });
		return { ...l, hi: l.lo, lo: l.hi };
	});
}

/** Both sheets usually state the same bond; keep one reading per pair and kind. */
function dedupeLinks(links: Link[]): Link[] {
	const seen = new Set<string>();
	return links.filter((l) => {
		const key = `${l.hi}→${l.lo}:${l.kind}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * A grandparent line spans two rows. When the sheets already name the parent
 * in between, the line adds nothing and is dropped; otherwise an in-memory
 * "unknown parent" fills each skipped row. Grandchildren who are siblings (or
 * share a named parent) hang from the same placeholder.
 */
function bridgeSkippedGenerations(links: Link[], sameLinks: SameLink[], placeholders: TreeNode[]): Link[] {
	const direct = links.filter((l) => l.kind === 'line' && l.delta === 1);
	const childrenOf = new Map<string, string[]>();
	const parentsOf = new Map<string, Set<string>>();
	for (const l of direct) {
		if (!childrenOf.has(l.hi)) childrenOf.set(l.hi, []);
		(childrenOf.get(l.hi) as string[]).push(l.lo);
		if (!parentsOf.has(l.lo)) parentsOf.set(l.lo, new Set());
		(parentsOf.get(l.lo) as Set<string>).add(l.hi);
	}
	const reachesIn = (from: string, to: string, steps: number): boolean => {
		let frontier = [from];
		for (let i = 0; i < steps; i++) frontier = frontier.flatMap((p) => childrenOf.get(p) ?? []);
		return frontier.includes(to);
	};
	const siblingPairs = new Set(sameLinks.filter((s) => s.kind === 'sibling').map((s) => [s.a, s.b].sort().join('|')));
	const related = (a: string, b: string): boolean => {
		if (siblingPairs.has([a, b].sort().join('|'))) return true;
		const pa = parentsOf.get(a), pb = parentsOf.get(b);
		return !!pa && !!pb && [...pa].some((p) => pb.has(p));
	};

	const out: Link[] = [];
	const skipping = new Map<string, Link[]>(); // `${hi}|${delta}` → links
	for (const l of links) {
		if (l.kind !== 'line' || l.delta < 2) {
			out.push(l);
		} else if (!reachesIn(l.hi, l.lo, l.delta)) {
			const key = `${l.hi}|${l.delta}`;
			if (!skipping.has(key)) skipping.set(key, []);
			(skipping.get(key) as Link[]).push(l);
		}
	}

	for (const group of skipping.values()) {
		// Split the grandchildren into sibling sets; each set gets its own chain.
		const sets: Link[][] = [];
		for (const l of group) {
			const home = sets.find((s) => s.some((m) => related(m.lo, l.lo)));
			if (home) home.push(l);
			else sets.push([l]);
		}
		for (const set of sets) {
			const { hi, delta } = set[0];
			let prev = hi;
			for (let k = 1; k < delta; k++) {
				const path = `unknown:${hi}:${set[0].lo}:${k}`;
				placeholders.push({ path, name: '', kind: 'character', generation: 0, placeholder: true });
				out.push({ hi: prev, lo: path, delta: 1, kind: 'line', label: '' });
				prev = path;
			}
			for (const l of set) out.push({ hi: prev, lo: l.lo, delta: 1, kind: 'line', label: l.label, sourcePath: l.sourcePath });
		}
	}
	return out;
}

/** Union-find over same-row links: everyone in one group shares a row. */
function sameRowGroups(sameLinks: SameLink[]): (path: string) => string {
	const parent = new Map<string, string>();
	const find = (x: string): string => {
		let r = x;
		while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as string;
		if (r !== x) parent.set(x, r);
		return r;
	};
	for (const s of sameLinks) {
		const ra = find(s.a), rb = find(s.b);
		if (ra !== rb) parent.set(ra, rb);
	}
	return find;
}

/**
 * Leave out every line that closes a loop ("A is above B" while B is, through
 * any chain, above A — or on A's own row), noting the two entries it joins.
 * What remains is loop-free, so no row can be pushed down endlessly.
 */
function removeLoops(links: Link[], sameLinks: SameLink[], notes: TreeNote[]): Link[] {
	const group = sameRowGroups(sameLinks);
	const skip = new Set<Link>();
	const flag = (l: Link) => {
		skip.add(l);
		notes.push({ type: 'loop', fromPath: l.hi, toPath: l.lo, label: l.label });
	};
	for (const l of links) if (group(l.hi) === group(l.lo)) flag(l);

	for (;;) {
		const out = new Map<string, Link[]>();
		for (const l of links) {
			if (skip.has(l)) continue;
			const g = group(l.hi);
			if (!out.has(g)) out.set(g, []);
			(out.get(g) as Link[]).push(l);
		}
		const state = new Map<string, 1 | 2>(); // 1 visiting, 2 done
		let back: Link | null = null;
		const visit = (g: string): void => {
			state.set(g, 1);
			for (const l of out.get(g) ?? []) {
				if (back) return;
				const next = group(l.lo);
				const s = state.get(next);
				if (s === 1) back = l;
				else if (s === undefined) visit(next);
			}
			state.set(g, 2);
		};
		for (const g of out.keys()) {
			if (back) break;
			if (!state.has(g)) visit(g);
		}
		if (!back) break;
		flag(back);
	}
	return links.filter((l) => !skip.has(l));
}

/**
 * Whole-network layering on a loop-free graph: longest path from the top, then
 * entries with nothing above them are pulled down to sit right over their
 * highest child (a mother with no parents of her own sits one row above her
 * children, not at the very top next to the grandmother).
 */
function wholeTreeGenerations(links: Link[], sameLinks: SameLink[]): Map<string, number> {
	const group = sameRowGroups(sameLinks);
	const members = new Map<string, string[]>();
	const addMember = (p: string) => {
		const g = group(p);
		if (!members.has(g)) members.set(g, []);
		const list = members.get(g) as string[];
		if (!list.includes(p)) list.push(p);
	};
	for (const l of links) {
		addMember(l.hi);
		addMember(l.lo);
	}
	// Same-row partners/siblings/cousins join only when someone in their group is in the tree.
	for (const s of sameLinks) {
		if (members.has(group(s.a))) {
			addMember(s.a);
			addMember(s.b);
		}
	}

	const out = new Map<string, Array<{ to: string; d: number }>>();
	const indeg = new Map<string, number>();
	for (const g of members.keys()) indeg.set(g, 0);
	for (const l of links) {
		const a = group(l.hi), b = group(l.lo);
		if (!out.has(a)) out.set(a, []);
		(out.get(a) as Array<{ to: string; d: number }>).push({ to: b, d: l.delta });
		indeg.set(b, (indeg.get(b) ?? 0) + 1);
	}

	const order: string[] = [];
	const remaining = new Map(indeg);
	const queue = [...members.keys()].filter((g) => (indeg.get(g) ?? 0) === 0);
	const gen = new Map<string, number>(queue.map((g) => [g, 0]));
	while (queue.length) {
		const g = queue.shift() as string;
		order.push(g);
		for (const { to, d } of out.get(g) ?? []) {
			gen.set(to, Math.max(gen.get(to) ?? 0, (gen.get(g) as number) + d));
			const left = (remaining.get(to) as number) - 1;
			remaining.set(to, left);
			if (left === 0) queue.push(to);
		}
	}
	for (const g of [...order].reverse()) {
		if ((indeg.get(g) ?? 0) !== 0) continue;
		const below = (out.get(g) ?? []).map(({ to, d }) => (gen.get(to) as number) - d);
		if (below.length) gen.set(g, Math.min(...below));
	}

	const result = new Map<string, number>();
	for (const [g, paths] of members) for (const p of paths) result.set(p, gen.get(g) ?? 0);
	return result;
}

/**
 * A node in a legitimate DAG is only re-relaxed as many times as there are distinct
 * ancestor paths to it — a handful even in tangled fictional families. The cap
 * turns any leftover contradiction into a detectable stop instead of a UI freeze.
 */
const MAX_RELAX_PER_NODE = 100;

/** Walk out from a focus entity along hierarchy + same-row lines, depth-limited per direction. */
function focusGenerations(
	focusPath: string,
	links: Link[],
	sameLinks: SameLink[],
	upLimit: number,
	downLimit: number
): { gen: Map<string, number>; cycleNodes: string[] } {
	const up = new Map<string, Array<{ to: string; d: number }>>();
	const down = new Map<string, Array<{ to: string; d: number }>>();
	const push = (m: Map<string, Array<{ to: string; d: number }>>, k: string, v: { to: string; d: number }) => {
		if (!m.has(k)) m.set(k, []);
		(m.get(k) as Array<{ to: string; d: number }>).push(v);
	};
	for (const l of links) {
		push(down, l.hi, { to: l.lo, d: l.delta });
		push(up, l.lo, { to: l.hi, d: l.delta });
	}
	const sameOf = new Map<string, string[]>();
	for (const s of sameLinks) {
		if (!sameOf.has(s.a)) sameOf.set(s.a, []);
		(sameOf.get(s.a) as string[]).push(s.b);
		if (!sameOf.has(s.b)) sameOf.set(s.b, []);
		(sameOf.get(s.b) as string[]).push(s.a);
	}

	const gen = new Map<string, number>([[focusPath, 0]]);
	const relaxCount = new Map<string, number>();
	const cycleNodes = new Set<string>();
	const relax = (path: string, ng: number): boolean => {
		const n = (relaxCount.get(path) ?? 0) + 1;
		relaxCount.set(path, n);
		if (n > MAX_RELAX_PER_NODE) {
			cycleNodes.add(path);
			return false;
		}
		gen.set(path, ng);
		return true;
	};

	const queue: string[] = [focusPath];
	while (queue.length) {
		const path = queue.shift() as string;
		const g = gen.get(path) as number;
		for (const { to, d } of up.get(path) ?? []) {
			const ng = g - d;
			if (ng >= -upLimit && (!gen.has(to) || (gen.get(to) as number) > ng) && relax(to, ng)) queue.push(to);
		}
		for (const { to, d } of down.get(path) ?? []) {
			const ng = g + d;
			if (ng <= downLimit && (!gen.has(to) || (gen.get(to) as number) < ng) && relax(to, ng)) queue.push(to);
		}
		for (const sib of sameOf.get(path) ?? []) {
			if (!gen.has(sib) && relax(sib, g)) queue.push(sib);
		}
	}
	return { gen, cycleNodes: [...cycleNodes] };
}

/** Renumber rows so no row is ever empty. With an anchor, that path stays at row 0. */
function compactRows(gen: Map<string, number>, anchor?: string): Map<string, number> {
	const used = [...new Set(gen.values())].sort((a, b) => a - b);
	const index = new Map(used.map((g, i) => [g, i]));
	const shift = anchor !== undefined && gen.has(anchor) ? (index.get(gen.get(anchor) as number) as number) : 0;
	const out = new Map<string, number>();
	for (const [p, g] of gen) out.set(p, (index.get(g) as number) - shift);
	return out;
}

/**
 * Groups children by their exact pair of parents, so a couple's kids hang off
 * one shared connector. Family mode only, and only for a real couple: two
 * parents become a pair when a sheet says they are partners, or when both are
 * that child's named parents and are not siblings, cousins or each other's
 * parent. Two bosses of the same person, a brother and sister, or an
 * "unknown parent" placeholder never get a marriage bar. Different
 * parent-pairs (half-siblings after a remarriage) stay separate unions.
 */
export function computeUnions(data: TreeData, mode: TreeMode): TreeUnion[] {
	if (mode !== 'family') return [];
	const placeholder = new Set(data.nodes.filter((n) => n.placeholder).map((n) => n.path));
	const pairKey = (a: string, b: string) => [a, b].sort().join('|');
	const partnerLabels = new Map<string, string[]>();
	for (const e of data.edges) {
		if (e.kind !== 'partner') continue;
		const key = pairKey(e.fromPath, e.toPath);
		partnerLabels.set(key, [...(partnerLabels.get(key) ?? []), e.label]);
	}
	const partners = new Set(partnerLabels.keys());
	const notACouple = new Set(
		data.edges.filter((e) => e.kind === 'sibling' || e.kind === 'cousin' || e.kind === 'line').map((e) => pairKey(e.fromPath, e.toPath))
	);

	const parentsOfChild = new Map<string, Set<string>>();
	for (const e of data.edges) {
		if (e.kind !== 'line' || placeholder.has(e.fromPath)) continue;
		if (!parentsOfChild.has(e.toPath)) parentsOfChild.set(e.toPath, new Set());
		(parentsOfChild.get(e.toPath) as Set<string>).add(e.fromPath);
	}
	const shareAParent = (a: string, b: string): boolean => {
		const pa = parentsOfChild.get(a), pb = parentsOfChild.get(b);
		return !!pa && !!pb && [...pa].some((p) => pb.has(p));
	};

	const unions = new Map<string, TreeUnion>();
	for (const [child, parents] of parentsOfChild) {
		const distinct = [...parents].sort();
		if (distinct.length !== 2) continue;
		const key = distinct.join('|');
		const isCouple = partners.has(key) || (!notACouple.has(key) && !shareAParent(distinct[0], distinct[1]));
		if (!isCouple) continue;
		if (!unions.has(key)) unions.set(key, { parentPaths: distinct, childPaths: [], status: coupleStatus(partnerLabels.get(key) ?? []) });
		(unions.get(key) as TreeUnion).childPaths.push(child);
	}
	return [...unions.values()];
}

// ─── Life facts ───────────────────────────────────────────────────────────────

const DECEASED_KEYWORDS = ['deceased', 'dead', 'died', 'passed away', 'passed on'];

/** Whether a "Life Status"-style field value reads as deceased (loose keyword match, not an enum). */
export function isDeceasedStatus(value: string): boolean {
	const v = value.toLowerCase();
	return DECEASED_KEYWORDS.some((k) => v.includes(k));
}

const AGE_LABELS = new Set(['age']);
const BORN_LABELS = new Set(['born', 'birth', 'birth year', 'birthdate', 'birth date', 'date of birth', 'year of birth']);
const DIED_LABELS = new Set(['died', 'death', 'death year', 'date of death', 'year of death']);
/** Died-field values that mean "not filled in" (fall back to Life Status) or "still alive". */
const DIED_EMPTY = new Set(['', '-', '—', '–', '?', 'n/a', 'na', 'none', 'unknown', 'tbd']);
const DIED_ALIVE = new Set(['alive', 'living', 'not yet']);

/**
 * The year in a date as written: the last 3-5 digit number ("3rd of Frostmonth,
 * 1130" is 1130, not 3). A minus counts only when it isn't a date separator, so
 * "12-03-1129" is 1129 while "-250" stays a year before the calendar's start.
 */
function lastYear(value: string): number | undefined {
	const found = [...value.matchAll(/-?\d{3,5}/g)].pop();
	if (!found) return undefined;
	const dashIsSeparator = found[0].startsWith('-') && /\d/.test(value.charAt((found.index ?? 0) - 1));
	return parseInt(dashIsSeparator ? found[0].slice(1) : found[0], 10);
}

/**
 * Age, birth year and deceased-ness from a sheet's fields. A filled-in Died
 * field decides deceased; "Life Status" words are the fallback. Numbers are
 * only taken when the sheet writes one ("Spring of the Long Winter" is no year).
 */
export function lifeFactsFromFields(fields: ReadonlyArray<{ label: string; value: string }>): LifeFacts {
	const facts: LifeFacts = {};
	let died: boolean | undefined;
	let statusDeceased = false;
	for (const f of fields) {
		const label = f.label.toLowerCase().trim();
		const value = f.value.trim();
		if (AGE_LABELS.has(label)) {
			const m = value.match(/^(\d{1,4})\b/);
			if (m) facts.age = parseInt(m[1], 10);
		} else if (BORN_LABELS.has(label)) {
			// The year is the last 3-5 digit number: "3rd of Frostmonth, 1130" is 1130, not 3.
			const year = lastYear(value);
			if (year !== undefined) facts.born = year;
		} else if (DIED_LABELS.has(label)) {
			const v = value.toLowerCase();
			if (v === 'no' || [...DIED_ALIVE].some((w) => v.includes(w))) died = false;
			else if (!DIED_EMPTY.has(v)) {
				died = true;
				const year = lastYear(value);
				if (year !== undefined) facts.died = year;
			}
		} else if (label === 'life status') {
			statusDeceased = isDeceasedStatus(value);
		}
	}
	const deceased = died ?? statusDeceased;
	if (deceased) facts.deceased = true;
	return facts;
}

/**
 * Up to two letters for a person without a portrait: the first letter of the
 * first two capitalised words ("Ilse of Saltmarch" → "IS", skipping "of"). A name
 * with no capitalised word falls back to its first two words as written; a single
 * word gives one letter. Empty when the name holds no letter at all.
 */
export function initialsOf(name: string): string {
	const words = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
	// An uppercase letter is one that has a different lowercase form.
	const capitalised = words.filter((w) => {
		const first = Array.from(w)[0];
		return first !== first.toLocaleLowerCase();
	});
	const picked = (capitalised.length > 0 ? capitalised : words).slice(0, 2);
	return picked.map((w) => Array.from(w)[0].toLocaleUpperCase()).join('');
}

/**
 * Word-wrap a name into at most `maxLines` lines of `maxChars` characters.
 * The last line ends in "…" only when something genuinely didn't fit; a single
 * word longer than a line is cut.
 */
export function wrapName(name: string, maxChars: number, maxLines: number): string[] {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let i = 0;
	while (i < words.length && lines.length < maxLines) {
		let line = words[i].length > maxChars ? words[i].slice(0, maxChars) : words[i];
		const cut = words[i].length > maxChars;
		i++;
		while (!cut && i < words.length && line.length + 1 + words[i].length <= maxChars) line += ' ' + words[i++];
		lines.push(line);
		if (cut) {
			lines[lines.length - 1] = line.slice(0, Math.max(1, maxChars - 1)) + '…';
			if (lines.length === maxLines) return lines;
		}
	}
	if (i < words.length && lines.length) {
		const last = lines[lines.length - 1];
		lines[lines.length - 1] = (last.length >= maxChars ? last.slice(0, maxChars - 1) : last) + '…';
	}
	return lines;
}

/** Type words that make a faction a family ("Family", "House", "Clan"…), in the three plugin languages. */
const FAMILY_TYPE_WORDS = new Set([
	'family', 'house', 'clan', 'dynasty', 'bloodline', 'lineage',
	'familia', 'casa', 'dinastía', 'linaje', 'estirpe',
	'famille', 'maison', 'dynastie', 'lignée',
]);

/**
 * A Bloodline entry, or a faction whose Type calls it a family or house — what
 * a family block is named after, and what gets a "View family tree" button.
 */
export function isFamilyGroup(kind: string, fields: ReadonlyArray<{ label: string; value: string }>): boolean {
	if (kind === 'bloodline') return true;
	if (kind !== 'faction') return false;
	const type = fields.find((f) => f.label.toLowerCase().trim() === 'type')?.value ?? '';
	return type.toLowerCase().split(/[^\p{L}]+/u).some((w) => FAMILY_TYPE_WORDS.has(w));
}

// ─── Positioning ──────────────────────────────────────────────────────────

/**
 * One generation row as units. People joined by partner lines form one unit,
 * ordered along their lines: Halvard – Ilse – Corran, never Ilse – Bex –
 * Corran. Units keep the row's own order (by where their first member stood),
 * and a unit with a sibling or cousin of the one before it follows it.
 */
export function orderRowUnits(row: string[], partnerEdges: readonly TreeEdge[], kinEdges: readonly TreeEdge[]): string[][] {
	const inRow = new Set(row);
	const rank = new Map(row.map((path, i) => [path, i]));
	const partners = new Map<string, string[]>();
	for (const e of partnerEdges) {
		if (!inRow.has(e.fromPath) || !inRow.has(e.toPath) || e.fromPath === e.toPath) continue;
		for (const [a, b] of [[e.fromPath, e.toPath], [e.toPath, e.fromPath]]) {
			const list = partners.get(a) ?? [];
			if (!list.includes(b)) list.push(b);
			partners.set(a, list);
		}
	}
	const byRank = (a: string, b: string) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
	const units: string[][] = [];
	const seen = new Set<string>();
	for (const start of row) {
		if (seen.has(start)) continue;
		// Everyone joined to `start` by partner lines.
		const group: string[] = [];
		const stack = [start];
		const inGroup = new Set([start]);
		while (stack.length) {
			const cur = stack.pop() as string;
			group.push(cur);
			for (const nb of partners.get(cur) ?? []) if (!inGroup.has(nb)) { inGroup.add(nb); stack.push(nb); }
		}
		// Walk the lines from an end (someone with one partner), earliest first,
		// so a person with two partners sits between them.
		const ends = group.filter((path) => (partners.get(path)?.length ?? 0) <= 1).sort(byRank);
		const first = ends[0] ?? [...group].sort(byRank)[0];
		const unit: string[] = [];
		const walk = (path: string) => {
			unit.push(path);
			seen.add(path);
			for (const nb of [...(partners.get(path) ?? [])].sort(byRank)) if (!seen.has(nb)) walk(nb);
		};
		walk(first);
		units.push(unit);
	}
	// Siblings and cousins with no partner tie still sit together where they can.
	const kin = new Map<string, Set<string>>();
	for (const e of kinEdges) {
		if (!inRow.has(e.fromPath) || !inRow.has(e.toPath)) continue;
		if (!kin.has(e.fromPath)) kin.set(e.fromPath, new Set());
		if (!kin.has(e.toPath)) kin.set(e.toPath, new Set());
		(kin.get(e.fromPath) as Set<string>).add(e.toPath);
		(kin.get(e.toPath) as Set<string>).add(e.fromPath);
	}
	const related = (a: string[], b: string[]) => a.some((x) => b.some((y) => kin.get(x)?.has(y)));
	const out: string[][] = [];
	const placed = new Set<string[]>();
	for (const u of units) {
		if (placed.has(u)) continue;
		out.push(u);
		placed.add(u);
		for (const other of units) {
			if (!placed.has(other) && related(u, other)) { out.push(other); placed.add(other); }
		}
	}
	return out;
}

const NODE_W = 260;
const GAP_X = 100;

export interface TreeLayoutOptions {
	/** Horizontal footprint of one node. Default 260 (Canvas-era sizing). */
	nodeW?: number;
	/** Minimum horizontal gap between nodes in a row. Default 100. */
	gapX?: number;
}

/**
 * Assign an x position to every node within its generation row: barycenter
 * of already-placed parents (top-down), then centered over its own children
 * (bottom-up) — couples with shared children move as one unit so they stay
 * adjacent — then a compaction sweep to restore minimum spacing, and one
 * more center+compact round to settle positions. y is left to the caller
 * (generation × row height).
 */
export function layoutTreePositions(data: TreeData, mode: TreeMode, layoutOpts: TreeLayoutOptions = {}): TreePosition[] {
	const nodeW = layoutOpts.nodeW ?? NODE_W;
	const gapX = layoutOpts.gapX ?? GAP_X;
	// Faction members hang from their group's leaders (viaPaths), so for placement
	// the leaders are their parents — members then sit under the leader they're drawn from.
	const hierEdges = data.edges
		.filter((e) => e.kind === 'line')
		.flatMap((e) => (e.viaPaths?.length ? e.viaPaths.map((v) => ({ fromPath: v, toPath: e.toPath, label: e.label })) : [e]));
	const partnerEdges = data.edges.filter((e) => e.kind === 'partner');
	const kinEdges = data.edges.filter((e) => e.kind === 'sibling' || e.kind === 'cousin');
	// Each row is laid out as units: everyone joined by partner lines, in the
	// order their lines run (an ex on one side, a spouse on the other). A unit
	// is never split, so no one lands between a couple.
	const unitsOfGen = new Map<number, string[][]>();

	const byGen = new Map<number, string[]>();
	for (const n of data.nodes) {
		if (!byGen.has(n.generation)) byGen.set(n.generation, []);
		(byGen.get(n.generation) as string[]).push(n.path);
	}
	const sortedGens = [...byGen.keys()].sort((a, b) => a - b);
	const nameOf = new Map(data.nodes.map((n) => [n.path, n.name]));

	const xOf = new Map<string, number>();

	// Pass 1 — top-down: sort each generation by barycenter of already-placed parents
	for (const g of sortedGens) {
		const row = [...(byGen.get(g) as string[])];

		row.sort((a, b) => {
			const bcA = midX(treeParents(a, hierEdges).map((p) => xOf.get(p)).filter((x): x is number => x !== undefined));
			const bcB = midX(treeParents(b, hierEdges).map((p) => xOf.get(p)).filter((x): x is number => x !== undefined));
			if (bcA === null && bcB === null) return (nameOf.get(a) ?? a).localeCompare(nameOf.get(b) ?? b);
			if (bcA === null) return -1;
			if (bcB === null) return 1;
			return bcA - bcB;
		});

		const units = orderRowUnits(row, partnerEdges, kinEdges);
		unitsOfGen.set(g, units);
		const ordered = units.flat();
		ordered.forEach((path, i) => xOf.set(path, i * (nodeW + gapX)));
		byGen.set(g, ordered);
	}

	const genOfPath = new Map(data.nodes.map((n) => [n.path, n.generation]));
	const unions = computeUnions(data, mode);
	const unitOf = new Map<string, string[]>();
	for (const units of unitsOfGen.values()) for (const u of units) for (const path of u) unitOf.set(path, u);

	// Bottom-up centering: couples with shared children shift as one unit
	// (keeps partners glued together instead of both collapsing onto the same
	// child midpoint), everyone else centers over their own children.
	const centerPass = () => {
		for (const g of [...sortedGens].reverse()) {
			const handled = new Set<string>();
			for (const u of unions) {
				const [p1, p2] = u.parentPaths;
				if (genOfPath.get(p1) !== g || genOfPath.get(p2) !== g) continue;
				if (handled.has(p1) || handled.has(p2)) continue;
				const kidXs = u.childPaths.map((c) => xOf.get(c)).filter((x): x is number => x !== undefined);
				const center = midX(kidXs);
				if (center === null) continue;
				const x1 = xOf.get(p1) ?? 0;
				const x2 = xOf.get(p2) ?? 0;
				const delta = center - (x1 + x2) / 2;
				// The whole partner unit moves, so an ex or a second spouse stays beside them.
				const moving = unitOf.get(p1)?.includes(p2) ? (unitOf.get(p1) as string[]) : [p1, p2];
				for (const m of moving) {
					if (handled.has(m)) continue;
					xOf.set(m, (xOf.get(m) ?? 0) + delta);
					handled.add(m);
				}
			}
			for (const path of byGen.get(g) as string[]) {
				if (handled.has(path)) continue;
				const kidXs = treeChildren(path, hierEdges)
					.map((p) => xOf.get(p))
					.filter((x): x is number => x !== undefined);
				const center = midX(kidXs);
				if (center !== null) xOf.set(path, center);
			}
		}
	};

	// Top-down compaction: restore minimum spacing after centering moves
	const compactPass = () => {
		for (const g of sortedGens) {
			// Units keep their inner order; they are sorted by where they now sit.
			const centreOf = (u: string[]) => u.reduce((sum, path) => sum + (xOf.get(path) ?? 0), 0) / u.length;
			const units = [...(unitsOfGen.get(g) ?? [])].sort((a, b) => centreOf(a) - centreOf(b));
			const row: string[] = [];
			let prevRight = -Infinity;
			for (const u of units) {
				for (const path of u) {
					const x = Math.max(xOf.get(path) ?? 0, prevRight + gapX);
					xOf.set(path, x);
					prevRight = x + nodeW;
					row.push(path);
				}
			}
			unitsOfGen.set(g, units);
			byGen.set(g, row);
		}
	};

	// Top-down: a couple's children slide under the couple when the couple
	// could not come to them (someone else holds the space beside the couple).
	// Rows are settled top to bottom, so grandchildren follow their parents.
	const childrenUnderParentsPass = () => {
		for (const g of sortedGens) {
			for (const u of unions) {
				const [p1, p2] = u.parentPaths;
				if (genOfPath.get(p1) !== g || genOfPath.get(p2) !== g) continue;
				const kids = u.childPaths.filter((c) => genOfPath.get(c) === g + 1 && xOf.has(c));
				const kidsMid = midX(kids.map((c) => xOf.get(c) as number));
				if (kidsMid === null) continue;
				const delta = ((xOf.get(p1) ?? 0) + (xOf.get(p2) ?? 0)) / 2 - kidsMid;
				// Only rightward: compaction keeps every row's left side packed, so a
				// leftward move would only be pushed back.
				if (delta <= 0.5) continue;
				for (const c of kids) xOf.set(c, (xOf.get(c) as number) + delta);
			}
			compactPass();
		}
	};

	centerPass();
	compactPass();
	centerPass();
	compactPass();
	childrenUnderParentsPass();
	// Parents settle over children that moved.
	centerPass();
	compactPass();

	const positions: TreePosition[] = [];
	for (const g of sortedGens) {
		for (const path of byGen.get(g) as string[]) {
			positions.push({ path, x: xOf.get(path) ?? 0, generation: g });
		}
	}
	return positions;
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

/**
 * One titled area of the tree: a faction with its people, or one family that
 * shares no line with any other.
 */
export interface TreeBlock {
	/** 'faction': headed by a group entry; 'family': one connected family; 'people': rank lines with no group above. */
	kind: 'faction' | 'family' | 'people';
	/** The group entry heading a faction block (the top-most one when groups are joined). */
	groupPath?: string;
	paths: string[];
}

export interface TreeLayout {
	positions: TreePosition[];
	blocks: TreeBlock[];
}

/**
 * Lay the tree out as separate blocks side by side: each set of people joined
 * by any line is laid out on its own and gets its own strip of width, so two
 * families or two factions never run into each other. Faction blocks are tidy
 * org charts (see `tidyPositions`); family blocks use `layoutTreePositions`,
 * which keeps couples together.
 */
export function layoutTreeBlocks(data: TreeData, mode: TreeMode, layoutOpts: TreeLayoutOptions & { blockGap?: number } = {}): TreeLayout {
	const nodeW = layoutOpts.nodeW ?? NODE_W;
	const gapX = layoutOpts.gapX ?? GAP_X;
	const blockGap = layoutOpts.blockGap ?? gapX * 2 + 48;

	// Joined sets (union-find over every line, including the leaders a member hangs from).
	const parent = new Map(data.nodes.map((n) => [n.path, n.path]));
	const find = (p: string): string => {
		let r = p;
		while (parent.get(r) !== r) r = parent.get(r) as string;
		parent.set(p, r);
		return r;
	};
	const join = (a: string, b: string) => {
		if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
	};
	// Faction mode: a block is one group and its people. A person hangs into a block
	// only through their group, or under a superior when they belong to no group
	// themselves — so a "Reports to" between two factions' people, or one faction
	// under another, stays a line between two blocks instead of merging them.
	const isGroup = new Set(data.nodes.filter((n) => GROUP_KINDS.has(n.kind)).map((n) => n.path));
	const inAGroup = new Set(data.edges.filter((e) => e.kind === 'line' && isGroup.has(e.fromPath)).map((e) => e.toPath));
	// Someone with no group joins one superior's block only — two would merge two factions.
	const joinedUnder = new Set<string>();
	for (const e of data.edges) {
		if (mode === 'faction' && !isGroup.has(e.fromPath) && (isGroup.has(e.toPath) || inAGroup.has(e.toPath))) continue;
		if (mode === 'faction' && isGroup.has(e.fromPath) && isGroup.has(e.toPath)) continue;
		if (mode === 'faction' && !isGroup.has(e.fromPath)) {
			if (joinedUnder.has(e.toPath)) continue;
			joinedUnder.add(e.toPath);
		}
		join(e.fromPath, e.toPath);
		for (const v of e.viaPaths ?? []) join(v, e.toPath);
	}
	const sets = new Map<string, TreeNode[]>();
	for (const n of data.nodes) {
		const r = find(n.path);
		if (!sets.has(r)) sets.set(r, []);
		(sets.get(r) as TreeNode[]).push(n);
	}

	const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name);
	type Draft = TreeBlock & { nodes: TreeNode[] };
	const blocks: Draft[] = [...sets.values()].map((nodes): Draft => {
		const paths = nodes.map((n) => n.path);
		if (mode === 'family') return { kind: 'family', paths, nodes };
		const groups = nodes.filter((n) => GROUP_KINDS.has(n.kind)).sort((a, b) => a.generation - b.generation || byName(a, b));
		return groups.length ? { kind: 'faction', groupPath: groups[0].path, paths, nodes } : { kind: 'people', paths, nodes };
	});
	const headName = (b: Draft) =>
		b.groupPath ? b.nodes.find((n) => n.path === b.groupPath)?.name ?? '' : [...b.nodes].sort(byName)[0]?.name ?? '';
	// Factions by name, then loose rank chains; families biggest first.
	blocks.sort((a, b) =>
		Number(a.kind === 'people') - Number(b.kind === 'people') ||
		(mode === 'family' ? b.nodes.length - a.nodes.length : 0) ||
		headName(a).localeCompare(headName(b))
	);

	const positions: TreePosition[] = [];
	let cursor = 0;
	for (const b of blocks) {
		const inBlock = new Set(b.paths);
		const sub: TreeData = {
			nodes: b.nodes,
			edges: data.edges
				.filter((e) => inBlock.has(e.fromPath) && inBlock.has(e.toPath))
				.map((e) => (e.viaPaths ? { ...e, viaPaths: e.viaPaths.filter((v) => inBlock.has(v)) } : e)),
		};
		const pos = mode === 'faction' ? tidyPositions(sub, nodeW, gapX) : layoutTreePositions(sub, mode, layoutOpts);
		const minX = Math.min(...pos.map((p) => p.x));
		const maxX = Math.max(...pos.map((p) => p.x)) + nodeW;
		for (const p of pos) positions.push({ ...p, x: p.x - minX + cursor });
		cursor += maxX - minX + blockGap;
	}
	return { positions, blocks: blocks.map(({ kind, groupPath, paths }) => ({ kind, paths, ...(groupPath ? { groupPath } : {}) })) };
}

/**
 * Only the given cards: their nodes, the lines between two of them, and the
 * notes that name one of them. Used to show one bloodline's families or one
 * faction on its own; lay the result out again afterwards.
 */
export function restrictTreeData(data: TreeData, keep: ReadonlySet<string>): TreeData {
	return {
		nodes: data.nodes.filter((n) => keep.has(n.path)),
		edges: data.edges.filter((e) => keep.has(e.fromPath) && keep.has(e.toPath)),
		...(data.cycleNodes ? { cycleNodes: data.cycleNodes.filter((p) => keep.has(p)) } : {}),
		...(data.notes ? { notes: data.notes.filter((n) => (n.type === 'loop' ? keep.has(n.fromPath) || keep.has(n.toPath) : keep.has(n.sourcePath) || keep.has(n.targetPath))) } : {}),
	};
}

/**
 * A faction block as a tidy org chart. Every card hangs under one parent: a
 * group's leaders count as one unit that its members hang from; anyone else
 * hangs from the nearest line above them. Each parent is centred over its own
 * people, and subtrees side by side never share width — so members always sit
 * under their own leader and no line crosses another.
 */
function tidyPositions(data: TreeData, nodeW: number, gapX: number): TreePosition[] {
	const genOf = new Map(data.nodes.map((n) => [n.path, n.generation]));
	const nameOf = new Map(data.nodes.map((n) => [n.path, n.name]));
	const byName = (a: string, b: string) => (nameOf.get(a) ?? a).localeCompare(nameOf.get(b) ?? b);

	// group → the leaders its members are drawn from; those leaders form one unit
	const leadersOf = new Map<string, string[]>();
	for (const e of data.edges) {
		if (e.kind !== 'line' || !e.viaPaths?.length) continue;
		leadersOf.set(e.fromPath, [...new Set([...(leadersOf.get(e.fromPath) ?? []), ...e.viaPaths])]);
	}
	const unitOfLeader = new Map<string, string>();
	for (const [group, leaders] of leadersOf) {
		for (const l of [...leaders].sort(byName)) if (!unitOfLeader.has(l)) unitOfLeader.set(l, `unit:${group}`);
	}
	const unitMembers = new Map<string, string[]>();
	for (const [l, u] of unitOfLeader) unitMembers.set(u, [...(unitMembers.get(u) ?? []), l]);
	for (const list of unitMembers.values()) list.sort(byName);
	const rowOf = (v: string): number => {
		const members = unitMembers.get(v);
		return members ? Math.min(...members.map((l) => genOf.get(l) ?? 0)) : genOf.get(v) ?? 0;
	};
	const vertexOf = (p: string) => unitOfLeader.get(p) ?? p;

	const kids = new Map<string, string[]>();
	const hasParent = new Set<string>();
	const attach = (parentV: string, childV: string) => {
		if (hasParent.has(childV) || parentV === childV) return;
		if (!kids.has(parentV)) kids.set(parentV, []);
		(kids.get(parentV) as string[]).push(childV);
		hasParent.add(childV);
	};
	for (const u of unitMembers.keys()) attach(u.slice('unit:'.length), u);
	for (const n of data.nodes) {
		if (unitOfLeader.has(n.path)) continue;
		const row = genOf.get(n.path) ?? 0;
		// The nearest line above wins (a member's leaders before the group itself).
		const candidates = data.edges
			.filter((e) => e.kind === 'line' && e.toPath === n.path)
			.map((e) => (e.viaPaths?.length && leadersOf.has(e.fromPath) ? `unit:${e.fromPath}` : vertexOf(e.fromPath)))
			.filter((v) => v !== n.path && rowOf(v) < row)
			.sort((a, b) => rowOf(b) - rowOf(a) || byName(a, b));
		if (candidates.length) attach(candidates[0], n.path);
	}

	const widthOf = (v: string) => {
		const k = unitMembers.get(v)?.length ?? 1;
		return k * nodeW + (k - 1) * gapX;
	};
	// A group's leaders first, then everyone else by name.
	const childrenOf = (v: string) =>
		[...(kids.get(v) ?? [])].sort((a, b) => Number(b.startsWith('unit:')) - Number(a.startsWith('unit:')) || byName(a, b));
	const kidsWidth = (v: string) => {
		const cs = childrenOf(v);
		return cs.reduce((s, c) => s + spanOf(c), 0) + gapX * Math.max(0, cs.length - 1);
	};
	const span = new Map<string, number>();
	const spanOf = (v: string): number => {
		const known = span.get(v);
		if (known !== undefined) return known;
		const w = Math.max(widthOf(v), kidsWidth(v));
		span.set(v, w);
		return w;
	};

	const xOf = new Map<string, number>();
	const place = (v: string, left: number) => {
		const w = spanOf(v);
		let cx = left + (w - kidsWidth(v)) / 2;
		for (const c of childrenOf(v)) {
			place(c, cx);
			cx += spanOf(c) + gapX;
		}
		const ownLeft = left + (w - widthOf(v)) / 2;
		const members = unitMembers.get(v);
		if (members) members.forEach((l, i) => xOf.set(l, ownLeft + i * (nodeW + gapX)));
		else xOf.set(v, ownLeft);
	};

	const roots = data.nodes
		.map((n) => n.path)
		.filter((p) => !unitOfLeader.has(p) && !hasParent.has(p))
		.sort((a, b) => (genOf.get(a) ?? 0) - (genOf.get(b) ?? 0) || byName(a, b));
	let left = 0;
	for (const r of roots) {
		place(r, left);
		left += spanOf(r) + gapX;
	}
	return data.nodes.map((n) => ({ path: n.path, x: xOf.get(n.path) ?? 0, generation: n.generation }));
}
