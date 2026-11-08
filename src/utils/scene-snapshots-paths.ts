// Pure path/filename logic for scene snapshots — no Obsidian imports, so it's
// unit-testable (the `obsidian` module has no runtime implementation under
// Jest, only ambient types, so anything that imports it can't be tested).

import { NOTE_SNAPSHOTS_DIR, SCENE_SNAPSHOTS_DIR, joinVaultPath, parentPath, safetyFolderFor } from './safety-paths';

/** The old hidden folder name — only read now, as a fallback (see sceneSnapshotFolderFor). */
export const SNAPSHOT_FOLDER_NAME = '.storygrid-snapshots';

/** Snapshots are `.txt`, never `.md`: an indexed `.md` copy would count as a scene, a mention and a search hit. */
export const SNAPSHOT_EXT = 'txt';

export type SnapshotReason = 'daily' | 'compile' | 'manual' | 'pre-restore';

/**
 * Where a document's snapshots live.
 *
 * A scene (anything below a `Scenes/` folder) belongs to the folder holding
 * its outermost `Scenes/` folder — the same project root the grid uses — and
 * goes to `Scene snapshots/<path below Scenes>`. Any other linked document
 * (a card can link a Codex sheet or a loose note) goes to `Note snapshots/
 * <path below the root>` of its nearest project (`isProjectRoot`, walking up),
 * or the vault root — never the scene subtree, so a note called "Prologue"
 * can't share history with the scene "Prologue", and never a stray
 * `pvbackup/` folder inside a Codex folder.
 */
export function sceneSnapshotRoot(
	scenePath: string,
	isProjectRoot: (folder: string) => boolean = () => false
): { root: string; dir: string; rel: string } {
	const m = scenePath.match(/^(?:(.*?)\/)??Scenes\/(.+)$/);
	if (m) return { root: m[1] ?? '', dir: SCENE_SNAPSHOTS_DIR, rel: m[2] };
	let root = parentPath(scenePath);
	while (root && !isProjectRoot(root)) root = parentPath(root);
	return { root, dir: NOTE_SNAPSHOTS_DIR, rel: root ? scenePath.slice(root.length + 1) : scenePath };
}

/** Folder holding this document's snapshots, e.g. `<root>/pvbackup/Scene snapshots/Act 1/Opening`. */
export function sceneSnapshotFolderFor(scenePath: string, isProjectRoot?: (folder: string) => boolean): string {
	const { root, dir, rel } = sceneSnapshotRoot(scenePath, isProjectRoot);
	return joinVaultPath(safetyFolderFor(root), dir, rel.replace(/\.md$/i, ''));
}

/** OLD hidden folder that held this scene's snapshots — named after the file, inside the scene's own directory. Read-only now. */
export function snapshotFolderFor(scenePath: string): string {
	const lastSlash = scenePath.lastIndexOf('/');
	const dir = lastSlash >= 0 ? scenePath.slice(0, lastSlash) : '';
	const name = lastSlash >= 0 ? scenePath.slice(lastSlash + 1) : scenePath;
	return dir ? `${dir}/${SNAPSHOT_FOLDER_NAME}/${name}` : `${SNAPSHOT_FOLDER_NAME}/${name}`;
}

/** Filename for a new snapshot: an ISO stamp (`:`/`.` replaced by `-`) plus the reason it was taken. */
export function snapshotFileName(reason: SnapshotReason, now: Date = new Date()): string {
	const stamp = now.toISOString().replace(/[:.]/g, '-');
	return `${stamp}.${reason}.${SNAPSHOT_EXT}`;
}

/** Inverse of `snapshotFileName` — recovers the timestamp/reason from a snapshot file's basename. */
export function parseSnapshotFileName(basename: string): { timestamp: string; reason: SnapshotReason } | null {
	const m = basename.match(/^(.+)\.(daily|compile|manual|pre-restore)$/);
	if (!m) return null;
	return { timestamp: m[1], reason: m[2] as SnapshotReason };
}

/** Snapshot filename timestamps display-formatted, e.g. "Jul 2, 2026, 4:05 PM". Returns the raw stamp if unparseable. */
export function formatSnapshotTimestamp(stamp: string): string {
	const iso = stamp.replace(
		/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
		'$1T$2:$3:$4.$5Z'
	);
	const d = new Date(iso);
	if (isNaN(d.getTime())) return stamp;
	return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
