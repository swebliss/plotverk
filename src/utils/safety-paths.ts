/**
 * Pure path logic for the per-project safety folder — no Obsidian imports, so
 * it's unit-testable.
 *
 * Every safety net (grid backups, scene snapshots, the project data copy and
 * the Book order note) lives in one VISIBLE folder per project:
 *
 *   <project root>/pvbackup/
 *     What is this folder.md
 *     Book order.md
 *     Project data.json
 *     Grid backups/<grid name>/<stamp>.json
 *     Scene snapshots/<scene path under Scenes, no .md>/<stamp>.<reason>.txt
 *
 * The nets used to live in dot-folders (`.storygrid-backups`,
 * `.storygrid-snapshots`, `.storygrid-data.json`), which Obsidian's vault
 * index skips — so nothing could list, prune or restore them, and the data
 * copy could never be updated after its first write. Those old files are left
 * alone and only ever READ as a fallback.
 *
 * Folder and file names stay English on purpose: they are paths, and a
 * locale switch must never split one project's copies across two folders.
 * Backups are `.json` and snapshots `.txt` (never `.storygrid` or `.md`), so
 * they can't show up as extra grids, extra scenes, word counts or search hits.
 */

export const SAFETY_FOLDER_NAME = 'pvbackup';
export const GRID_BACKUPS_DIR = 'Grid backups';
export const SCENE_SNAPSHOTS_DIR = 'Scene snapshots';
/** Snapshots of linked documents outside any Scenes folder — kept apart so a note can never share a scene's history. */
export const NOTE_SNAPSHOTS_DIR = 'Note snapshots';
export const PROJECT_DATA_FILE = 'Project data.json';
export const BOOK_ORDER_FILE = 'Book order.md';
export const README_FILE = 'What is this folder.md';

/** Joins vault path segments, skipping empty ones (the vault root is ''). */
export function joinVaultPath(...parts: string[]): string {
	return parts.filter((p) => p !== '').join('/');
}

export function parentPath(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
}

export function safetyFolderFor(projectRoot: string): string {
	return joinVaultPath(projectRoot, SAFETY_FOLDER_NAME);
}

/**
 * True for anything Plotverk writes into a safety folder, and for those
 * folders themselves — views use this to ignore their own safety writes so a
 * backup never triggers a re-render. Deliberately precise: a writer may have
 * a folder of their own with the same name, and its notes must still refresh
 * the views, so only our exact names inside it match. The data copy
 * and Book order also match sync-conflict twins ("Project data 2.json").
 * The folder name itself matches in any letter case: Windows and macOS disks
 * treat "PVBackup" and "pvbackup" as one folder, and a stray-case copy must
 * not slip past the filters (startup renames it to the exact name).
 */
const SAFETY_PATH_RE = new RegExp(
	`(?:^|/)${anyCase(SAFETY_FOLDER_NAME)}/(?:` +
		`(?:${GRID_BACKUPS_DIR}|${SCENE_SNAPSHOTS_DIR}|${NOTE_SNAPSHOTS_DIR})(?:$|/.*)` +
		`|${escapeRe(stem(PROJECT_DATA_FILE))}[^/]*\\.json$` +
		`|${escapeRe(stem(BOOK_ORDER_FILE))}[^/]*\\.md$` +
		`|${escapeRe(README_FILE)}$` +
	`)`
);

/** `pvbackup` → `[pP][vV]…`: a case-insensitive piece without the `i` flag, which would loosen the entry names too. */
function anyCase(s: string): string {
	return [...s].map((c) => (c.toLowerCase() !== c.toUpperCase() ? `[${c.toLowerCase()}${c.toUpperCase()}]` : escapeRe(c))).join('');
}

function stem(fileName: string): string {
	return fileName.replace(/\.[^.]+$/, '');
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isSafetyNetPath(path: string): boolean {
	return SAFETY_PATH_RE.test(path);
}

/** The safety folder's first name (step 5, 2026-11-01) — read once at startup to merge it into pvbackup. */
export const OLD_SAFETY_FOLDER_NAME = 'Plotverk';

/**
 * True for a path inside a safety folder under its first name (`…/Plotverk/
 * Grid backups/…`) — so the startup move into pvbackup doesn't trigger a full
 * index rebuild per moved item.
 */
export function wasSafetyNetPath(path: string): boolean {
	const segs = path.split('/');
	return segs.some((s, i) => s === OLD_SAFETY_FOLDER_NAME
		&& isSafetyNetPath([...segs.slice(0, i), SAFETY_FOLDER_NAME, ...segs.slice(i + 1)].join('/')));
}
