import { mergeTextChanges, remapTextChangePaths, TextChangeRecord } from './text-changes';
import type { DashboardSettings, StorygridSettings, StreakData, TodoItem } from '../grid-data';
import { collectDocPaths, renameDocPath } from './scene-tree';
import type { SceneTree, SceneTreeNode } from './scene-tree';
import { plotverkEvents } from './plotverk-events';

/**
 * A project is known by its folder path: much of what Plotverk stores per
 * project (to-dos, goals, streaks, typed words, the Writers Panel outline…)
 * sits in settings under that path, and some settings hold paths of grids,
 * scenes and series folders. When the writer renames or moves a folder or a
 * grid in Obsidian's file list, everything here follows it, so the project
 * at its new place shows exactly what it showed before.
 *
 * Pure (no Obsidian): main.ts calls `applyPathMove` from the vault's rename
 * event and saves once. Obsidian fires that event for a renamed folder AND
 * for every file inside it, in no promised order — every step here is
 * idempotent, so the burst ends in the same state whatever the order.
 *
 * Paths match on whole segments only: "Book" never matches "Book 2".
 */

/** A lone .storygrid file moved to another folder: the project it made moves from one folder key to another. */
export interface RootMove { from: string; to: string }

export interface PathMove {
	oldPath: string;
	newPath: string;
	/** A folder moves everything under it; a file moves only its own path. */
	isFolder: boolean;
	/** Only for a moved grid whose old folder is no longer a project (worked out by the caller, who can see the vault). */
	rootMove?: RootMove;
}

export interface PathMoveResult {
	changed: boolean;
	/** `activeProjectRoot` changed. */
	activeChanged: boolean;
	/** The series or book registry changed. */
	registryChanged: boolean;
	/** Project keys (after the move) whose dashboard data changed — their data copies need writing. */
	touchedRoots: string[];
}

export type MovableSettings = Partial<Pick<StorygridSettings,
	'dashboard' | 'seriesRegistry' | 'bookRegistry' | 'activeProjectRoot' | 'sprintHistory' | 'outlineCollapsedGroups' | 'gridFolder'>>;

/**
 * `path` moved from under `from` to under `to`, or null when it isn't `from`
 * or inside it. '' is the vault root: everything is inside it.
 */
export function rebasePath(path: string, from: string, to: string): string | null {
	let rest: string;
	if (from === '') rest = path;
	else if (path === from) rest = '';
	else if (path.startsWith(`${from}/`)) rest = path.slice(from.length + 1);
	else return null;
	if (rest === '') return to;
	return to ? `${to}/${rest}` : rest;
}

/** Where a stored file or folder path ends up after `move`, or null when the move doesn't touch it. */
export function movedPath(path: string, move: PathMove): string | null {
	if (!move.isFolder) return path === move.oldPath ? move.newPath : null;
	if (move.oldPath === '') return null; // the vault root itself is never renamed
	return rebasePath(path, move.oldPath, move.newPath);
}

/** Where a project/series root KEY ends up after `move`, or null when it stays. */
export function movedRoot(root: string, move: PathMove): string | null {
	if (move.rootMove && root === move.rootMove.from) return move.rootMove.to;
	if (!move.isFolder) return null;
	return movedPath(root, move);
}

/**
 * Open views keep their own project root / grid path in memory and in their
 * saved tab state. main.ts announces every rename (after settings followed
 * it); a view calls `movedRoot` / `movedPath` on what it holds. Returns the
 * unsubscribe function (pass it to the view's `register`).
 */
export const PATHS_MOVED_EVENT = 'storygrid:paths-moved';

export function announcePathMove(move: PathMove): void {
	recordPathMove(move);
	plotverkEvents.dispatchEvent(new CustomEvent<PathMove>(PATHS_MOVED_EVENT, { detail: move }));
}

/**
 * The moves announced lately, oldest first, so a path remembered earlier can
 * catch up: a new-sheet editor tab that remembered its project's folder when
 * it opened saves into wherever that folder is now, never re-creating the
 * old one. Kept short — only an editor left open across many renames could
 * miss the oldest, and then it saves where it remembered, as before.
 */
const MOVE_LOG_SIZE = 500;
const moveLog: PathMove[] = [];
/** How many moves have dropped off the front of the log. */
let moveLogDropped = 0;

export function recordPathMove(move: PathMove): void {
	// A folder rename arrives as one event per file and folder inside it; those
	// are already explained by the folder's own move, so they are not logged
	// (a big project can't push the folder's move off the end of the log).
	if (moveLog.some((earlier) => earlier.isFolder && movedPath(move.oldPath, earlier) === move.newPath)) return;
	moveLog.push(move);
	if (moveLog.length > MOVE_LOG_SIZE) {
		moveLog.shift();
		moveLogDropped++;
	}
}

/** A bookmark in the move log: pass it to `followPathMoves` later. */
export function pathMoveMark(): number {
	return moveLogDropped + moveLog.length;
}

/** Where `path` is now, after every move recorded since `mark`. */
export function followPathMoves(path: string, mark: number): string {
	let now = path;
	for (let i = Math.max(0, mark - moveLogDropped); i < moveLog.length; i++) {
		now = movedPath(now, moveLog[i]) ?? now;
	}
	return now;
}

export function onPathMove(handler: (move: PathMove) => void): () => void {
	const listener = (e: Event): void => handler((e as CustomEvent<PathMove>).detail);
	plotverkEvents.addEventListener(PATHS_MOVED_EVENT, listener);
	return () => plotverkEvents.removeEventListener(PATHS_MOVED_EVENT, listener);
}

function lastSegmentBasename(path: string): string {
	const name = path.split('/').pop() ?? path;
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}

// ─── Merging, when the new key already holds data ──────────────────────────
// Rare (a project moved onto a folder name that still has leftover data), but
// nothing may be lost: each map has one plain rule. "Moved" = the project that
// was just moved; "kept" = what was already stored under the new name.

/** To-dos: the moved list, then every kept to-do whose id isn't already there. */
function mergeTodos(kept: TodoItem[], moved: TodoItem[]): TodoItem[] {
	const ids = new Set(moved.map((t) => t.id));
	return [...moved, ...kept.filter((t) => !ids.has(t.id))];
}

/** Field maps (goals, celebrated goals, folded sections): the moved value wins per field, other fields kept. */
function mergeFields<T extends object>(kept: T, moved: T): T {
	return { ...kept, ...moved };
}

/** Day counts (typed / skipped words): every day kept; on a day both have, the larger count (never double-counted). */
function mergeDayCounts(kept: Record<string, number>, moved: Record<string, number>): Record<string, number> {
	const out = { ...kept };
	for (const [day, n] of Object.entries(moved)) out[day] = Math.max(out[day] ?? 0, n);
	return out;
}

/** Streak: the moved project's streak, unless it never started. */
function mergeStreak(kept: StreakData, moved: StreakData): StreakData {
	return moved.lastDate || moved.current || moved.longest ? moved : kept;
}

/** Path lists (scene order, left-out characters): union, moved first, no duplicates. */
function mergeList(kept: string[], moved: string[]): string[] {
	return [...new Set([...moved, ...kept])];
}

/**
 * Outline: the moved tree, then kept rows it doesn't have yet. A kept row is
 * dropped when the moved tree already has its id or its scene (its own rows
 * move up into its place); a kept divider emptied that way is dropped too, so
 * no act heading ever appears twice. Dividers the writer left empty stay.
 */
function mergeTree(kept: SceneTree, moved: SceneTree): SceneTree {
	if (!moved.length) return kept;
	const ids = new Set<string>();
	const walkIds = (nodes: SceneTreeNode[]): void => {
		for (const n of nodes) {
			ids.add(n.id);
			walkIds(n.children ?? []);
		}
	};
	walkIds(moved);
	const docs = new Set(collectDocPaths(moved));
	const prune = (nodes: SceneTreeNode[]): SceneTreeNode[] =>
		nodes.flatMap((n) => {
			const children = prune(n.children ?? []);
			if (ids.has(n.id) || (n.kind === 'doc' && !!n.docPath && docs.has(n.docPath))) return children;
			if (n.kind === 'divider' && children.length === 0 && (n.children ?? []).length > 0) return [];
			return [{ ...n, children }];
		});
	return [...moved, ...prune(kept)];
}

type RootMaps = {
	[K in 'goals' | 'todos' | 'typedWords' | 'streaks' | 'celebratedGoals' | 'skippedWords' | 'sceneOrder' | 'sceneTree' | 'quietLeftOut' | 'textChanges']:
		{ merge: (kept: never, moved: never) => unknown }
};

const ROOT_MAPS: RootMaps = {
	goals: { merge: mergeFields },
	todos: { merge: mergeTodos },
	typedWords: { merge: mergeDayCounts },
	streaks: { merge: mergeStreak },
	celebratedGoals: { merge: mergeFields },
	skippedWords: { merge: mergeDayCounts },
	sceneOrder: { merge: mergeList },
	sceneTree: { merge: mergeTree },
	quietLeftOut: { merge: mergeList },
	textChanges: { merge: mergeTextChanges },
};

/**
 * Re-key `map` (project key → value) for `move`, merging into a key that
 * already has data. Old keys are removed only once their value sits under
 * the new key. Returns the new keys that changed.
 */
function rekeyMap<V>(map: Record<string, V> | undefined, move: PathMove, merge: (kept: V, moved: V) => V): string[] {
	if (!map) return [];
	const touched: string[] = [];
	// Snapshot first: moves never write onto a key that is still to be read (new keys lie outside the old folder).
	for (const [key, value] of Object.entries(map)) {
		const next = movedRoot(key, move);
		if (next === null || next === key) continue;
		const kept = map[next];
		let merged: V;
		try {
			merged = kept == null ? value : value == null ? kept : merge(kept, value);
		} catch {
			continue; // damaged data that can't be merged: left exactly where it was, never dropped
		}
		map[next] = merged;
		delete map[key];
		touched.push(next);
	}
	return touched;
}

/** Paths stored inside the dashboard data follow the move, under every project key. Returns the keys that changed. */
function patchDashboardPaths(dash: DashboardSettings, move: PathMove): string[] {
	const touched = new Set<string>();
	for (const [root, todos] of Object.entries(dash.todos ?? {})) {
		if (!Array.isArray(todos)) continue;
		for (const todo of todos) {
			if (!todo?.link || typeof todo.link.path !== 'string') continue;
			const next = movedPath(todo.link.path, move);
			if (next === null || next === todo.link.path) continue;
			todo.link.path = next;
			// A renamed file shows its new name; a moved folder changes no names.
			if (!move.isFolder) todo.link.label = lastSegmentBasename(next);
			touched.add(root);
		}
	}
	for (const map of [dash.sceneOrder, dash.quietLeftOut]) {
		for (const [root, paths] of Object.entries(map ?? {})) {
			if (!Array.isArray(paths)) continue;
			for (let i = 0; i < paths.length; i++) {
				if (typeof paths[i] !== 'string') continue;
				const next = movedPath(paths[i], move);
				if (next === null || next === paths[i]) continue;
				paths[i] = next;
				touched.add(root);
			}
		}
	}
	for (const [root, records] of Object.entries(dash.textChanges ?? {})) {
		if (!Array.isArray(records)) continue;
		if (remapTextChangePaths(records, (p) => movedPath(p, move) ?? p)) touched.add(root);
	}
	for (const [root, tree] of Object.entries(dash.sceneTree ?? {})) {
		if (!Array.isArray(tree)) continue;
		let next = tree;
		try {
			for (const p of collectDocPaths(tree)) {
				const np = typeof p === 'string' ? movedPath(p, move) : null;
				if (np !== null && np !== p) next = renameDocPath(next, p, np);
			}
		} catch {
			continue; // a damaged outline is left exactly as it is
		}
		if (next === tree) continue;
		dash.sceneTree![root] = next;
		touched.add(root);
	}
	return [...touched];
}

/** `outlineCollapsedGroups` keys look like `tree::<project root>::<id>`: re-key the root part. */
function rekeyCollapsedGroups(map: Record<string, boolean> | undefined, move: PathMove): boolean {
	if (!map) return false;
	let changed = false;
	for (const [key, value] of Object.entries(map)) {
		const first = key.indexOf('::');
		const last = key.lastIndexOf('::');
		if (first === -1 || last === first) continue;
		const root = key.slice(first + 2, last);
		const next = movedRoot(root, move);
		if (next === null || next === root) continue;
		map[`${key.slice(0, first)}::${next}${key.slice(last)}`] = value;
		delete map[key];
		changed = true;
	}
	return changed;
}

/**
 * Carry everything in settings that is keyed by, or holds, a project folder,
 * series folder or grid path along with a rename/move. Mutates `settings`;
 * the caller saves once. Safe to apply the same move again (no change).
 */
export function applyPathMove(settings: MovableSettings, move: PathMove): PathMoveResult {
	const result: PathMoveResult = { changed: false, activeChanged: false, registryChanged: false, touchedRoots: [] };
	if (move.oldPath === move.newPath && !move.rootMove) return result;
	const touched = new Set<string>();

	const dash = settings.dashboard;
	if (dash) {
		// Paths first (under their current keys), then the keys themselves.
		for (const root of patchDashboardPaths(dash, move)) touched.add(movedRoot(root, move) ?? root);
		const record = dash as unknown as Record<string, Record<string, unknown> | undefined>;
		for (const [name, { merge }] of Object.entries(ROOT_MAPS)) {
			for (const root of rekeyMap(record[name], move, merge as (a: unknown, b: unknown) => unknown)) touched.add(root);
		}
	}

	for (const series of Object.values(settings.seriesRegistry ?? {})) {
		const next = move.isFolder ? movedPath(series.rootPath, move) : null;
		if (next === null || next === series.rootPath) continue;
		series.rootPath = next;
		result.registryChanged = true;
	}
	for (const book of Object.values(settings.bookRegistry ?? {})) {
		if (!book.gridPath) continue;
		const next = movedPath(book.gridPath, move);
		if (next === null || next === book.gridPath) continue;
		book.gridPath = next;
		result.registryChanged = true;
	}

	if (typeof settings.activeProjectRoot === 'string') {
		const next = movedRoot(settings.activeProjectRoot, move);
		if (next !== null && next !== settings.activeProjectRoot) {
			settings.activeProjectRoot = next;
			result.activeChanged = true;
		}
	}

	let otherChanged = false;
	for (const record of settings.sprintHistory ?? []) {
		if (typeof record.projectRoot !== 'string') continue;
		const next = movedRoot(record.projectRoot, move);
		if (next === null || next === record.projectRoot) continue;
		record.projectRoot = next;
		otherChanged = true;
	}
	if (rekeyCollapsedGroups(settings.outlineCollapsedGroups, move)) otherChanged = true;
	// The folder the writer picked for new projects follows a rename of it.
	if (move.isFolder && settings.gridFolder) {
		const next = movedPath(settings.gridFolder, move);
		if (next !== null && next !== settings.gridFolder) {
			settings.gridFolder = next;
			otherChanged = true;
		}
	}

	result.touchedRoots = [...touched];
	result.changed = touched.size > 0 || result.activeChanged || result.registryChanged || otherChanged;
	return result;
}

// ─── Moves Plotverk never saw (folder moved while Obsidian was closed, or by Sync) ──

interface PathCarryingSlice {
	todos?: TodoItem[];
	sceneOrder?: string[];
	sceneTree?: SceneTree;
	quietLeftOut?: string[];
	textChanges?: TextChangeRecord[];
}

/**
 * A project's data copy, written while the project lived at `from`, read back
 * at `to`: every path inside it that was under `from` now points under `to`.
 * `keepOriginal(old, new)` can veto one path (e.g. it still exists where it
 * was and the moved one doesn't — a link outside the project). Returns a copy.
 */
export function rebaseSlicePaths<T extends PathCarryingSlice>(
	slice: T,
	from: string,
	to: string,
	keepOriginal?: (oldPath: string, newPath: string) => boolean,
): T {
	const map = (p: string): string => {
		const next = rebasePath(p, from, to);
		if (next === null || next === p) return p;
		return keepOriginal?.(p, next) ? p : next;
	};
	const walk = (nodes: SceneTreeNode[]): SceneTreeNode[] =>
		nodes.map((n) => ({ ...n, docPath: n.docPath ? map(n.docPath) : n.docPath, children: walk(n.children ?? []) }));
	const out: T = { ...slice };
	if (Array.isArray(slice.todos)) {
		out.todos = slice.todos.map((t) => (t.link && typeof t.link.path === 'string' ? { ...t, link: { ...t.link, path: map(t.link.path) } } : t));
	}
	if (Array.isArray(slice.sceneOrder)) out.sceneOrder = slice.sceneOrder.map((p) => (typeof p === 'string' ? map(p) : p));
	if (Array.isArray(slice.sceneTree)) out.sceneTree = walk(slice.sceneTree);
	if (Array.isArray(slice.quietLeftOut)) out.quietLeftOut = slice.quietLeftOut.map((p) => (typeof p === 'string' ? map(p) : p));
	if (Array.isArray(slice.textChanges)) {
		const copy = JSON.parse(JSON.stringify(slice.textChanges)) as TextChangeRecord[];
		remapTextChangePaths(copy, map);
		out.textChanges = copy;
	}
	return out;
}

/**
 * After settings were carried to `root` for a move Plotverk didn't see: the
 * copy that travelled with the folder may still hold outline rows settings
 * lost meanwhile (a move synced in as delete + create empties the outline of
 * the "deleted" scenes). Settings' outline first, then any rows only the copy
 * has. Returns true when something was added.
 */
export function keepOutlineFromCopy(dash: DashboardSettings, root: string, copy: PathCarryingSlice): boolean {
	let changed = false;
	try {
		if (Array.isArray(copy.sceneTree) && copy.sceneTree.length) {
			const cur = dash.sceneTree?.[root];
			const next = Array.isArray(cur) && cur.length ? mergeTree(copy.sceneTree, cur) : copy.sceneTree;
			if (JSON.stringify(next) !== JSON.stringify(cur)) {
				(dash.sceneTree ??= {})[root] = next;
				changed = true;
			}
		}
		if (Array.isArray(copy.sceneOrder) && copy.sceneOrder.length) {
			const cur = dash.sceneOrder?.[root];
			const next = Array.isArray(cur) ? mergeList(copy.sceneOrder, cur) : copy.sceneOrder;
			if (JSON.stringify(next) !== JSON.stringify(cur)) {
				(dash.sceneOrder ??= {})[root] = next;
				changed = true;
			}
		}
	} catch {
		// A damaged copy adds nothing; settings stay as they are.
	}
	return changed;
}

/**
 * A project seen at `to` whose data copy says it was written at `from`, and
 * `from` is gone: find the folder that was really renamed. While both last
 * segments match and `canClimb(oldParent, newParent)` agrees, climb — so
 * "Saga/Book 1" → "Saltmarch Saga/Book 1" becomes the series folder move
 * "Saga" → "Saltmarch Saga" (registry, sibling books and all). The caller
 * only lets it climb to a registered series folder that is gone, whose new
 * place exists and whose every book is found there. Never climbs to the vault root.
 */
export function widenUnseenMove(from: string, to: string, canClimb: (oldParent: string, newParent: string) => boolean): RootMove {
	let f = from;
	let t = to;
	for (;;) {
		const fi = f.lastIndexOf('/');
		const ti = t.lastIndexOf('/');
		if (fi === -1 || ti === -1) break;
		if (f.slice(fi + 1) !== t.slice(ti + 1)) break;
		const fParent = f.slice(0, fi);
		const tParent = t.slice(0, ti);
		if (fParent === tParent || !canClimb(fParent, tParent)) break;
		f = fParent;
		t = tParent;
	}
	return { from: f, to: t };
}

/**
 * A .storygrid file moved from one folder to another: does its project's data
 * (keyed by the folder) go with it? Only when the old folder is no longer a
 * project — no other grid there, not a series folder — and the new folder is
 * not one already: no other grid there, not a series folder. Two live projects
 * are never merged by moving a grid; when it doesn't move, the data stays
 * under the old folder name, untouched (moving the grid back brings it back
 * into view). Leftover data under the new folder name (a project deleted
 * there) is merged like any move onto a used name — never dropped.
 */
export function gridRootMove(
	oldGridPath: string,
	newGridPath: string,
	otherGridPaths: string[],
	seriesRoots: string[],
): RootMove | undefined {
	const parent = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
	const from = parent(oldGridPath);
	const to = parent(newGridPath);
	if (from === to) return undefined;
	const others = otherGridPaths.filter((g) => g !== newGridPath && g !== oldGridPath).map(parent);
	if (others.includes(from) || seriesRoots.includes(from)) return undefined;
	if (others.includes(to) || seriesRoots.includes(to)) return undefined;
	return { from, to };
}
