import type { EntityKind } from './entity-kinds';
import type { EntityInfo } from './entity-manager';

/**
 * Pure, Obsidian-free core of the project entity index (F2 of the worldbuilder
 * spine). The heavy `metadataCache` extraction lives in `entity-manager.ts`;
 * this module only groups the resulting `EntityInfo` records by project root and
 * kind, and patches that grouping incrementally as individual files change.
 *
 * Grouping shape: `Map<rootPath, Map<kindId, EntityInfo[]>>`, with each leaf
 * array kept sorted by entity name (matching the old `listEntities` contract).
 *
 * Nothing here imports Obsidian (only the `EntityInfo`/`EntityKind` *types*, which
 * are erased at build time), so the whole module is unit-testable in isolation.
 */

/** An `EntityInfo` tagged with the project root it belongs to. */
export interface IndexedEntity extends EntityInfo {
	/** Vault path of the owning project root ('' = vault root). */
	rootPath: string;
}

/** root → kind → entities (each leaf array sorted by name). */
export type EntityIndexData = Map<string, Map<EntityKind, EntityInfo[]>>;

/**
 * Pick the project root that owns `path`: the longest known root that is a
 * prefix of the path. The vault-root project (`''`) matches everything but only
 * wins when no deeper project contains the file. Returns null if no project
 * contains the path (only possible when `''` is not among the roots).
 */
export function assignRoot(path: string, roots: readonly string[]): string | null {
	let best: string | null = null;
	for (const root of roots) {
		if (root === '') {
			if (best === null) best = '';
			continue;
		}
		if (path === root || path.startsWith(root + '/')) {
			if (best === null || root.length > best.length) best = root;
		}
	}
	return best;
}

function byName(a: EntityInfo, b: EntityInfo): number {
	return a.name.localeCompare(b.name);
}

/** Build the grouped index from a flat list of tagged entities. */
export function buildIndexData(entities: readonly IndexedEntity[]): EntityIndexData {
	const data: EntityIndexData = new Map();
	for (const entity of entities) {
		bucketFor(data, entity.rootPath, entity.kind).push(stripRoot(entity));
	}
	for (const byKind of data.values()) {
		for (const list of byKind.values()) list.sort(byName);
	}
	return data;
}

/**
 * Read the entities for `rootPath` and `kind` from the index, including all
 * entities that live under descendant project roots.
 *
 * This is the behaviour callers need in series mode: a series root
 * (`My First Series`) should see all entities owned by its books
 * (`My First Series/The First Book`). The vault-root project (`''`) sees
 * entities from every project. Entity names are deduplicated (impossible in
 * practice but safe) and the list is sorted by name.
 */
export function listFromIndex(
	data: EntityIndexData,
	rootPath: string,
	kind: EntityKind
): EntityInfo[] {
	const results: EntityInfo[] = [];
	for (const [r, byKind] of data) {
		if (rootContains(rootPath, r)) {
			const list = byKind.get(kind);
			if (list) results.push(...list);
		}
	}
	if (results.length === 0) return results;
	results.sort(byName);
	return results;
}

/**
 * Does `ancestor` contain `descendant`?
 * '' contains everything; otherwise we require an exact match or a path-segment boundary.
 */
function rootContains(ancestor: string, descendant: string): boolean {
	if (ancestor === '') return true;
	return descendant === ancestor || descendant.startsWith(ancestor + '/');
}

/**
 * Insert or replace a single entity. The entity is first removed from wherever
 * it currently lives (its kind or root may have changed), then inserted into its
 * new bucket with the sort order preserved.
 */
export function upsertEntity(data: EntityIndexData, entity: IndexedEntity): void {
	removeEntityByPath(data, entity.file.path);
	const list = bucketFor(data, entity.rootPath, entity.kind);
	list.push(stripRoot(entity));
	list.sort(byName);
}

/**
 * Remove whichever entity occupies `path`, pruning now-empty buckets so the
 * index does not accumulate empty maps over a long session. Returns true if an
 * entity was removed.
 */
export function removeEntityByPath(data: EntityIndexData, path: string): boolean {
	for (const [root, byKind] of data) {
		for (const [kind, list] of byKind) {
			const idx = list.findIndex((e) => e.file.path === path);
			if (idx === -1) continue;
			list.splice(idx, 1);
			if (list.length === 0) byKind.delete(kind);
			if (byKind.size === 0) data.delete(root);
			return true;
		}
	}
	return false;
}

function bucketFor(data: EntityIndexData, root: string, kind: EntityKind): EntityInfo[] {
	let byKind = data.get(root);
	if (!byKind) {
		byKind = new Map();
		data.set(root, byKind);
	}
	let list = byKind.get(kind);
	if (!list) {
		list = [];
		byKind.set(kind, list);
	}
	return list;
}

/** The index stores plain `EntityInfo`; the `rootPath` tag is only an input key. */
function stripRoot(entity: IndexedEntity): EntityInfo {
	const { rootPath: _rootPath, ...info } = entity;
	return info;
}
