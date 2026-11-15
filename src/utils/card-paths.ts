/**
 * Keep Plot Grid cards pointing at their sheets when a file or folder is
 * renamed or moved (pure, no Obsidian imports — unit-tested).
 *
 * A card stores vault paths in several places: its scene page (`linkedDocPath`),
 * its characters (`characterPaths`), its other linked sheets
 * (`linkedEntityPaths`), and `povCharacter` / `location`. All of them follow.
 * Grids read from disk may be hand-edited or damaged, so every field is checked
 * for its shape before it is touched; anything unexpected is left as it is.
 */

import type { GridData, SceneCard } from '../grid-data';

/** `path` after `oldPath` became `newPath` — the path itself, or anything inside it when it is a folder. */
export function renamedPath(path: string, oldPath: string, newPath: string): string {
	if (path === oldPath) return newPath;
	if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length);
	return path;
}

/** A renamed copy of `list`, or the same list when nothing in it changed. Never lists one sheet twice. */
function renamedList(list: unknown, oldPath: string, newPath: string): unknown {
	if (!Array.isArray(list)) return list;
	let changed = false;
	const next = list.map((p: unknown) => {
		if (typeof p !== 'string') return p;
		const r = renamedPath(p, oldPath, newPath);
		if (r !== p) changed = true;
		return r;
	});
	if (!changed) return list;
	return next.filter((p, i) => typeof p !== 'string' || next.indexOf(p) === i);
}

/** The card with every stored path following the rename; the very same card when nothing changed. */
export function renameCardPaths(card: SceneCard, oldPath: string, newPath: string): SceneCard {
	if (!card || typeof card !== 'object') return card;
	const updates: Record<string, unknown> = {};

	for (const key of ['linkedDocPath', 'povCharacter', 'location'] as const) {
		const value: unknown = card[key];
		if (typeof value !== 'string') continue;
		const r = renamedPath(value, oldPath, newPath);
		if (r !== value) updates[key] = r;
	}

	const chars = renamedList(card.characterPaths, oldPath, newPath);
	if (chars !== card.characterPaths) updates.characterPaths = chars;

	const linked: unknown = card.linkedEntityPaths;
	if (linked && typeof linked === 'object' && !Array.isArray(linked)) {
		let linkedChanged = false;
		const nextLinked: Record<string, unknown> = {};
		for (const [kind, list] of Object.entries(linked as Record<string, unknown>)) {
			const r = renamedList(list, oldPath, newPath);
			if (r !== list) linkedChanged = true;
			nextLinked[kind] = r;
		}
		if (linkedChanged) updates.linkedEntityPaths = nextLinked;
	}

	return Object.keys(updates).length === 0 ? card : { ...card, ...updates };
}

/**
 * The grid with every card following the rename; the very same grid when no
 * card pointed at the renamed path (so callers can skip saving). Does not
 * touch `updatedAt` — the caller stamps it when it writes.
 */
export function renameGridCardPaths(grid: GridData, oldPath: string, newPath: string): GridData {
	if (!grid || typeof grid !== 'object' || !Array.isArray(grid.cards)) return grid;
	let changed = false;
	const cards = grid.cards.map((c) => {
		const r = renameCardPaths(c, oldPath, newPath);
		if (r !== c) changed = true;
		return r;
	});
	return changed ? { ...grid, cards } : grid;
}
