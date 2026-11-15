/**
 * The Codex entries linked to a Plot Grid card, grouped for the card editor
 * (pure, no Obsidian imports — unit-tested).
 *
 * A card stores its links as `linkedEntityPaths`: vault paths keyed by entry
 * kind (`{ monster: ['P/Codex/Monsters/Wyrm.md'], location: [...] }`). This
 * module turns that into rows by Codex group, and adds or removes one link.
 * A stored link is never hidden: retired kinds join the group that replaced
 * them, and kinds outside every group get a row of their own.
 */

import { getCodexGroups, getKindSpec } from '../entities/entity-kinds';

export type LinkedEntityPaths = Record<string, string[]>;

export interface CodexLinkEntry {
	kind: string;
	path: string;
}

export interface CodexLinkGroup {
	/** Codex group id, or `kind:<id>` for a kind outside every group. */
	id: string;
	label: string;
	entries: CodexLinkEntry[];
}

/**
 * Retired kinds (still registered so old sheets resolve) shown under the group
 * that took over their job. `research` has no successor and keeps its own row.
 */
const RETIRED_KIND_GROUP: Record<string, string> = {
	location: 'places',
	system: 'systems',
};

/**
 * The stored paths for one kind, keeping only real strings, each once. A lone
 * string (a hand-edited file) counts as a list of one, so it is not hidden.
 */
function cleanPaths(list: unknown): string[] {
	if (typeof list === 'string') return list ? [list] : [];
	if (!Array.isArray(list)) return [];
	const out: string[] = [];
	for (const p of list) {
		if (typeof p === 'string' && p && !out.includes(p)) out.push(p);
	}
	return out;
}

/**
 * Linked entries grouped by Codex group, in Codex sidebar order. Only groups
 * holding at least one link are returned. Kinds in `skipKinds` (shown elsewhere
 * in the editor) are left out.
 */
export function groupCodexLinks(linked: LinkedEntityPaths | undefined | null, skipKinds: readonly string[] = []): CodexLinkGroup[] {
	if (!linked || typeof linked !== 'object' || Array.isArray(linked)) return [];

	const groups = getCodexGroups();
	const groupOfKind = new Map<string, string>();
	for (const g of groups) for (const k of g.kinds) groupOfKind.set(String(k), g.id);
	for (const [kind, groupId] of Object.entries(RETIRED_KIND_GROUP)) {
		if (!groupOfKind.has(kind) && groups.some((g) => g.id === groupId)) groupOfKind.set(kind, groupId);
	}

	const byGroup = new Map<string, CodexLinkEntry[]>();
	const ownRows: CodexLinkGroup[] = [];
	for (const [kind, list] of Object.entries(linked)) {
		if (skipKinds.includes(kind)) continue;
		const paths = cleanPaths(list);
		if (paths.length === 0) continue;
		const entries = paths.map((path) => ({ kind, path }));
		const groupId = groupOfKind.get(kind);
		if (groupId) {
			byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), ...entries]);
		} else {
			ownRows.push({ id: `kind:${kind}`, label: getKindSpec(kind).plural, entries });
		}
	}

	const out: CodexLinkGroup[] = [];
	for (const g of groups) {
		const entries = byGroup.get(g.id);
		if (!entries) continue;
		// Kinds in the group's own order; a retired kind after the current ones.
		const rank = (kind: string): number => {
			const i = g.kinds.indexOf(kind);
			return i === -1 ? g.kinds.length : i;
		};
		const sorted = entries
			.map((e, i) => ({ e, i }))
			.sort((a, b) => rank(a.e.kind) - rank(b.e.kind) || a.i - b.i)
			.map(({ e }) => e);
		out.push({ id: g.id, label: g.label, entries: sorted });
	}
	return [...out, ...ownRows];
}

/** True when `path` is linked under any kind. */
export function isCodexLinked(linked: LinkedEntityPaths | undefined | null, path: string): boolean {
	if (!linked || typeof linked !== 'object') return false;
	return Object.values(linked).some((list) => cleanPaths(list).includes(path));
}

/**
 * `path` removed from every kind it is stored under. An emptied kind keeps its
 * `[]`, as the card editor has always left it.
 */
export function removeCodexLink(linked: LinkedEntityPaths | undefined | null, path: string): LinkedEntityPaths {
	const out: LinkedEntityPaths = {};
	if (!linked || typeof linked !== 'object' || Array.isArray(linked)) return out;
	for (const [kind, list] of Object.entries(linked)) {
		const value: unknown = list;
		if (Array.isArray(value)) out[kind] = (value as string[]).filter((p) => p !== path);
		else if (value === path) out[kind] = [];
		else out[kind] = list;
	}
	return out;
}

/** `path` added under `kind`, unless it is already linked (under any kind). */
export function addCodexLink(linked: LinkedEntityPaths | undefined | null, kind: string, path: string): LinkedEntityPaths {
	const out: LinkedEntityPaths = linked && typeof linked === 'object' && !Array.isArray(linked) ? { ...linked } : {};
	if (isCodexLinked(out, path)) return out;
	const value: unknown = out[kind];
	const current: unknown[] = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
	out[kind] = [...(current as string[]), path];
	return out;
}

/**
 * Link `path` under `kind` if it is not linked yet; otherwise unlink it from
 * every kind it is stored under. Never stores one sheet twice.
 */
export function toggleCodexLink(
	linked: LinkedEntityPaths | undefined | null,
	kind: string,
	path: string
): { linked: LinkedEntityPaths; nowLinked: boolean } {
	if (isCodexLinked(linked, path)) return { linked: removeCodexLink(linked, path), nowLinked: false };
	return { linked: addCodexLink(linked, kind, path), nowLinked: true };
}
