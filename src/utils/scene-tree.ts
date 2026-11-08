import { generateId } from '../grid-data';

/**
 * Pure, Obsidian-free tree model for the Writers Panel outline. Replaces the
 * flat `sceneOrder: string[]` with a nestable structure of scene documents
 * and freeform "divider" rows (a heading with no document behind it, e.g.
 * "Act 1" or "Investigation" for a journalist's project).
 *
 * Numbering is NEVER stored — it is always derived from tree position, so
 * moving/nesting a node automatically renumbers everything under it. This
 * mirrors how Longform's outline behaves and is the whole point of the tree.
 */

export type SceneTreeNodeKind = 'doc' | 'divider';

export interface SceneTreeNode {
	id: string;
	kind: SceneTreeNodeKind;
	/** Set when kind === 'doc'. The linked scene document's vault path. */
	docPath?: string;
	/** Set when kind === 'divider'. User-chosen label, e.g. "Act 1". */
	label?: string;
	children: SceneTreeNode[];
}

export type SceneTree = SceneTreeNode[];

export interface FlatSceneNode {
	node: SceneTreeNode;
	depth: number;
	number: string;
	parentId: string | null;
}

export function createDocNode(docPath: string): SceneTreeNode {
	return { id: generateId(), kind: 'doc', docPath, children: [] };
}

export function createDividerNode(label: string): SceneTreeNode {
	return { id: generateId(), kind: 'divider', label, children: [] };
}

/** Migration helper: turn today's flat, alphabetically-resolved path list into a flat (unnested) tree. */
export function buildTreeFromFlatOrder(paths: string[]): SceneTree {
	return paths.map((p) => createDocNode(p));
}

/** Depth-first walk producing display numbers ("1", "1.1", "2.3.1") purely from position. */
export function flattenTree(tree: SceneTree): FlatSceneNode[] {
	const out: FlatSceneNode[] = [];
	const walk = (nodes: SceneTreeNode[], depth: number, prefix: string, parentId: string | null) => {
		nodes.forEach((node, i) => {
			const number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
			out.push({ node, depth, number, parentId });
			if (node.children.length) walk(node.children, depth + 1, number, node.id);
		});
	};
	walk(tree, 0, '', null);
	return out;
}

export function findNode(tree: SceneTree, id: string): SceneTreeNode | null {
	for (const node of tree) {
		if (node.id === id) return node;
		const found = findNode(node.children, id);
		if (found) return found;
	}
	return null;
}

interface LocatedNode {
	parentId: string | null;
	siblings: SceneTreeNode[];
	index: number;
}

function locate(tree: SceneTree, id: string, parentId: string | null = null): LocatedNode | null {
	const index = tree.findIndex((n) => n.id === id);
	if (index !== -1) return { parentId, siblings: tree, index };
	for (const node of tree) {
		const found = locate(node.children, id, node.id);
		if (found) return found;
	}
	return null;
}

/** Returns a new tree with the node removed, plus the removed node itself (or null if not found). */
export function removeNode(tree: SceneTree, id: string): { tree: SceneTree; removed: SceneTreeNode | null } {
	let removed: SceneTreeNode | null = null;
	const strip = (nodes: SceneTreeNode[]): SceneTreeNode[] =>
		nodes
			.filter((n) => {
				if (n.id === id) { removed = n; return false; }
				return true;
			})
			.map((n) => (n.children.length ? { ...n, children: strip(n.children) } : n));
	const next = strip(tree);
	return { tree: next, removed };
}

/** Returns a new tree with `node` inserted at `index` under `parentId` (null = root). */
export function insertNode(tree: SceneTree, node: SceneTreeNode, parentId: string | null, index: number): SceneTree {
	if (parentId === null) {
		const next = [...tree];
		next.splice(Math.max(0, Math.min(index, next.length)), 0, node);
		return next;
	}
	return tree.map((n) => {
		if (n.id === parentId) {
			const children = [...n.children];
			children.splice(Math.max(0, Math.min(index, children.length)), 0, node);
			return { ...n, children };
		}
		if (n.children.length) return { ...n, children: insertNode(n.children, node, parentId, index) };
		return n;
	});
}

/** Move an existing node elsewhere in the tree (reorder and/or re-nest). No-op if the node or target parent doesn't exist. */
export function moveNode(tree: SceneTree, id: string, parentId: string | null, index: number): SceneTree {
	const { tree: stripped, removed } = removeNode(tree, id);
	if (!removed) return tree;
	if (parentId !== null && !findNode(stripped, parentId)) return tree;
	return insertNode(stripped, removed, parentId, index);
}

/** All descendant ids of a node (not including the node itself). */
export function getDescendantIds(tree: SceneTree, id: string): Set<string> {
	const node = findNode(tree, id);
	const out = new Set<string>();
	if (!node) return out;
	const walk = (nodes: SceneTreeNode[]) => nodes.forEach((n) => { out.add(n.id); walk(n.children); });
	walk(node.children);
	return out;
}

/** A visible-row projection input: the flattened rows the user actually sees (dragged subtree excluded). */
export interface ProjectionRow {
	id: string;
	parentId: string | null;
	depth: number;
}

export interface Projection {
	depth: number;
	parentId: string | null;
}

/**
 * Given the visible rows (dragged subtree excluded), the insertion index, and
 * the depth the pointer's horizontal position is asking for, decide the final
 * clamped depth and which node becomes the parent. This is the classic
 * outline-drag projection (Notion / Longform / dnd-kit style): you can nest at
 * most one level deeper than the row above, and no shallower than the row below.
 */
export function getProjection(rows: ProjectionRow[], overIndex: number, dragDepth: number): Projection {
	const prev = rows[overIndex - 1];
	const next = rows[overIndex];
	const maxDepth = prev ? prev.depth + 1 : 0;
	const minDepth = next ? next.depth : 0;
	let depth = dragDepth;
	if (depth > maxDepth) depth = maxDepth;
	if (depth < minDepth) depth = minDepth;

	let parentId: string | null;
	if (depth <= 0 || !prev) {
		parentId = null;
	} else if (depth === prev.depth) {
		parentId = prev.parentId;
	} else if (depth > prev.depth) {
		parentId = prev.id;
	} else {
		const ancestor = rows.slice(0, overIndex).reverse().find((r) => r.depth === depth);
		parentId = ancestor?.parentId ?? null;
	}
	return { depth, parentId };
}

/**
 * Move a node (with its whole subtree) to sit under `parentId`, immediately
 * before `beforeId` (or at the end of the parent's children when `beforeId`
 * is null). Referencing the target by sibling id — instead of a numeric index
 * — keeps this correct even when some of the parent's children are hidden by a
 * collapsed divider. No-op if the node or target parent is missing.
 */
export function moveNodeBefore(
	tree: SceneTree,
	draggedId: string,
	parentId: string | null,
	beforeId: string | null
): SceneTree {
	if (draggedId === parentId) return tree;
	const { tree: stripped, removed } = removeNode(tree, draggedId);
	if (!removed) return tree;
	if (parentId !== null && !findNode(stripped, parentId)) return tree;
	const siblings = parentId === null ? stripped : findNode(stripped, parentId)!.children;
	let index = siblings.length;
	if (beforeId) {
		const i = siblings.findIndex((n) => n.id === beforeId);
		if (i !== -1) index = i;
	}
	return insertNode(stripped, removed, parentId, index);
}

/** Nest a node as the last child of its previous sibling. No-op if it's already the first sibling at its level. */
export function indentNode(tree: SceneTree, id: string): SceneTree {
	const loc = locate(tree, id);
	if (!loc || loc.index === 0) return tree;
	const prevSibling = loc.siblings[loc.index - 1];
	return moveNode(tree, id, prevSibling.id, prevSibling.children.length);
}

/** Un-nest a node to become the next sibling of its current parent. No-op at root. */
export function outdentNode(tree: SceneTree, id: string): SceneTree {
	const loc = locate(tree, id);
	if (!loc || loc.parentId === null) return tree;
	const grandparent = locate(tree, loc.parentId);
	return moveNode(tree, id, grandparent?.parentId ?? null, (grandparent?.index ?? -1) + 1);
}

/** True when the node has a sibling in that direction (-1 = up, 1 = down) at its own level. */
export function canMoveSibling(tree: SceneTree, id: string, direction: -1 | 1): boolean {
	const loc = locate(tree, id);
	if (!loc) return false;
	const target = loc.index + direction;
	return target >= 0 && target < loc.siblings.length;
}

/**
 * Swap a node (with its whole subtree) with its neighbour at the same level — "Move up" / "Move down"
 * in the Writers Panel menu, the no-drag way to reorder. Never changes nesting. No-op at either end.
 */
export function moveSibling(tree: SceneTree, id: string, direction: -1 | 1): SceneTree {
	const loc = locate(tree, id);
	if (!loc || !canMoveSibling(tree, id, direction)) return tree;
	return moveNode(tree, id, loc.parentId, loc.index + direction);
}

/** Patch a doc node's path after a vault rename. */
export function renameDocPath(tree: SceneTree, oldPath: string, newPath: string): SceneTree {
	return tree.map((n) => {
		const updated = n.kind === 'doc' && n.docPath === oldPath ? { ...n, docPath: newPath } : n;
		return updated.children.length ? { ...updated, children: renameDocPath(updated.children, oldPath, newPath) } : updated;
	});
}

/** Rename a divider's label in place (structure and id untouched). */
export function renameDividerLabel(tree: SceneTree, id: string, label: string): SceneTree {
	return tree.map((n) => {
		const updated = n.id === id && n.kind === 'divider' ? { ...n, label } : n;
		return updated.children.length ? { ...updated, children: renameDividerLabel(updated.children, id, label) } : updated;
	});
}

/** Remove any node by id, promoting its children to where it was (used to delete a divider without losing what's under it). */
export function removeNodePromotingChildren(tree: SceneTree, id: string): SceneTree {
	const index = tree.findIndex((n) => n.id === id);
	if (index !== -1) {
		const target = tree[index];
		return [...tree.slice(0, index), ...target.children, ...tree.slice(index + 1)];
	}
	return tree.map((n) => (n.children.length ? { ...n, children: removeNodePromotingChildren(n.children, id) } : n));
}

/** Remove a doc node by path (e.g. after vault delete), promoting its children to where it was. */
export function removeDocByPath(tree: SceneTree, path: string): SceneTree {
	const target = tree.find((n) => n.kind === 'doc' && n.docPath === path);
	if (target) {
		const index = tree.indexOf(target);
		return [...tree.slice(0, index), ...target.children, ...tree.slice(index + 1)];
	}
	return tree.map((n) => {
		if (!n.children.length) return n;
		const before = n.children.find((c) => c.kind === 'doc' && c.docPath === path);
		if (!before) return { ...n, children: removeDocByPath(n.children, path) };
		const index = n.children.indexOf(before);
		const children = [...n.children.slice(0, index), ...before.children, ...n.children.slice(index + 1)];
		return { ...n, children };
	});
}

export function collectDocPaths(tree: SceneTree): string[] {
	const out: string[] = [];
	const walk = (nodes: SceneTreeNode[]) => {
		for (const n of nodes) {
			if (n.kind === 'doc' && n.docPath) out.push(n.docPath);
			if (n.children.length) walk(n.children);
		}
	};
	walk(tree);
	return out;
}

/** Append any doc paths not yet present anywhere in the tree as new root-level nodes, alphabetically. */
export function addMissingDocs(tree: SceneTree, paths: string[]): SceneTree {
	const known = new Set(collectDocPaths(tree));
	const missing = paths.filter((p) => !known.has(p)).sort((a, b) => a.localeCompare(b));
	if (!missing.length) return tree;
	return [...tree, ...missing.map((p) => createDocNode(p))];
}

/**
 * Resolve the tree to use for a project: the stored tree if one exists,
 * else a one-time migration from the legacy flat `sceneOrder`, else empty.
 * Either way, any doc on disk that isn't in the tree yet gets appended.
 */
export function resolveSceneTree(
	stored: SceneTree | undefined,
	legacyOrder: string[] | undefined,
	allPaths: string[]
): SceneTree {
	const base = stored?.length ? stored : legacyOrder?.length ? buildTreeFromFlatOrder(legacyOrder) : [];
	return addMissingDocs(base, allPaths);
}
