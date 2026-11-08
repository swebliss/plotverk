/**
 * Pure hierarchy builder for entities that carry a "parent" reference —
 * used by the Codex to nest locations (dimension → planet → continent →
 * country → city → street, to any depth). No Obsidian imports.
 */

export interface TreeEntityLike {
	name: string;
	/** Parent entity name, or null for a top-level entity */
	parent: string | null;
}

export interface EntityTreeNode<T extends TreeEntityLike> {
	entity: T;
	depth: number;
	children: EntityTreeNode<T>[];
}

/**
 * Strip an optional wikilink wrapper from a stored parent reference:
 * "[[Planet Rogu]]" or "[[Planet Rogu|Rogu]]" → "Planet Rogu".
 */
export function parseParentRef(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const m = raw.trim().match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
	const name = (m ? m[1] : raw).trim();
	return name.length > 0 ? name : null;
}

/**
 * Arrange a flat entity list into a forest. Parent references are matched
 * by name, case-insensitively. Entities whose parent doesn't exist become
 * top-level; cycles are broken by promoting their members to top-level.
 * Siblings are sorted alphabetically.
 */
export function buildEntityTree<T extends TreeEntityLike>(entities: T[]): EntityTreeNode<T>[] {
	const byName = new Map<string, T>();
	for (const e of entities) {
		const key = e.name.toLowerCase();
		if (!byName.has(key)) byName.set(key, e);
	}

	const childrenOf = new Map<T, T[]>();
	const roots: T[] = [];
	for (const e of entities) {
		const parent = e.parent ? byName.get(e.parent.toLowerCase()) : undefined;
		if (parent && parent !== e) {
			const list = childrenOf.get(parent);
			if (list) list.push(e);
			else childrenOf.set(parent, [e]);
		} else {
			roots.push(e);
		}
	}

	const visited = new Set<T>();
	const toNode = (e: T, depth: number): EntityTreeNode<T> => {
		visited.add(e);
		const kids = (childrenOf.get(e) ?? [])
			.filter((c) => !visited.has(c))
			.sort((a, b) => a.name.localeCompare(b.name));
		return { entity: e, depth, children: kids.map((c) => toNode(c, depth + 1)) };
	};

	const forest = roots
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((r) => toNode(r, 0));

	// Cycle members are reachable from no root — surface them as top-level
	for (const e of entities) {
		if (!visited.has(e)) forest.push(toNode(e, 0));
	}
	return forest;
}

/** All names in the subtree rooted at `name` (including the root itself). */
export function descendantNames<T extends TreeEntityLike>(entities: T[], name: string): Set<string> {
	const result = new Set<string>([name.toLowerCase()]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const e of entities) {
			const key = e.name.toLowerCase();
			if (!result.has(key) && e.parent && result.has(e.parent.toLowerCase())) {
				result.add(key);
				grew = true;
			}
		}
	}
	return result;
}
