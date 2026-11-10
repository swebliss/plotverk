import { App, TFile, TFolder } from 'obsidian';
import {
	sceneSnapshotFolderFor,
	sceneSnapshotRoot,
	snapshotFolderFor,
	snapshotFileName,
	parseSnapshotFileName,
	SNAPSHOT_EXT,
} from './scene-snapshots-paths';
import type { SnapshotReason } from './scene-snapshots-paths';
import { ensureFolderPath, ensureSafetyFolder, listLegacyFiles, readLegacyFile } from './safety-folder';
import { isSafetyNetPath } from './safety-paths';

/** A folder is a project root when it directly holds a `.storygrid` file (as in `findProjects`). */
function isProjectRootIn(app: App): (folder: string) => boolean {
	return (folder) => {
		const f = app.vault.getAbstractFileByPath(folder);
		return f instanceof TFolder && f.children.some((c) => c instanceof TFile && c.extension === 'storygrid');
	};
}

/**
 * Version history for scene documents: timestamped copies in the project's
 * visible `pvbackup/Scene snapshots/` folder, so a bad edit or a manuscript
 * typo doesn't cost prior work. Three triggers: before every compile, once
 * per day on first edit, and on-demand via the "Snapshot project now"
 * command. Kept dumb like grid-backup.ts: plain file copies, no diffing,
 * bounded per-scene so the vault doesn't bloat.
 *
 * Copies from before the safety folder (hidden `.storygrid-snapshots`
 * folders) are still listed and restorable, read past the vault index, but
 * never written to or pruned.
 *
 * Path/filename logic lives in scene-snapshots-paths.ts (no Obsidian import,
 * so it's unit-testable) — this file is the Obsidian-coupled vault plumbing.
 */

export { snapshotFolderFor, snapshotFileName, parseSnapshotFileName, formatSnapshotTimestamp } from './scene-snapshots-paths';
export type { SnapshotReason } from './scene-snapshots-paths';

const MAX_SNAPSHOTS_PER_SCENE = 20;

export interface SceneSnapshot {
	/** Vault path of the snapshot file. */
	path: string;
	/** ISO-ish timestamp with `:`/`.` replaced by `-`, as stored in the filename. */
	timestamp: string;
	reason: SnapshotReason;
	/** True for a copy in the old hidden folder: read-only, never pruned. */
	legacy: boolean;
	/** The indexed file, for current snapshots only. */
	file?: TFile;
}

export async function listSceneSnapshots(app: App, scenePath: string): Promise<SceneSnapshot[]> {
	const out: SceneSnapshot[] = [];

	const folder = app.vault.getAbstractFileByPath(sceneSnapshotFolderFor(scenePath, isProjectRootIn(app)));
	if (folder instanceof TFolder) {
		for (const f of folder.children) {
			if (!(f instanceof TFile) || f.extension !== SNAPSHOT_EXT) continue;
			const parsed = parseSnapshotFileName(f.basename);
			if (parsed) out.push({ path: f.path, ...parsed, legacy: false, file: f });
		}
	}

	for (const path of await listLegacyFiles(app, snapshotFolderFor(scenePath))) {
		const name = path.split('/').pop() ?? path;
		if (!name.endsWith('.md')) continue;
		const parsed = parseSnapshotFileName(name.slice(0, -'.md'.length));
		if (parsed) out.push({ path, ...parsed, legacy: true });
	}

	// Timestamps are ISO strings (colons/dots replaced) — they sort correctly as plain strings.
	return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || Number(a.legacy) - Number(b.legacy));
}

/** The snapshot's text. Throws if it can no longer be read. */
export async function readSceneSnapshot(app: App, snapshot: SceneSnapshot): Promise<string> {
	if (snapshot.file) return app.vault.read(snapshot.file);
	const content = await readLegacyFile(app, snapshot.path);
	if (content === null) throw new Error('Snapshot file not found.');
	return content;
}

async function pruneOldSnapshots(app: App, scenePath: string): Promise<void> {
	const current = (await listSceneSnapshots(app, scenePath)).filter((s) => !s.legacy);
	for (const s of current.slice(MAX_SNAPSHOTS_PER_SCENE)) {
		try {
			// Permanent on purpose: rolling snapshots Plotverk made itself, newer ones exist.
			if (s.file) await app.vault.delete(s.file);
		} catch {
			// Best-effort cleanup; a stray old snapshot is harmless.
		}
	}
}

/**
 * Write a timestamped snapshot of `content` for the scene at `scenePath`.
 * Skips if content is identical to the newest existing snapshot (nothing
 * changed, no point bloating the vault). Best-effort — never throws, so a
 * snapshot failure can't block the real save/compile it rides along with.
 * Returns true when a new snapshot was written.
 */
export async function writeSceneSnapshot(
	app: App,
	scenePath: string,
	content: string,
	reason: SnapshotReason
): Promise<boolean> {
	try {
		const existing = await listSceneSnapshots(app, scenePath);
		if (existing.length > 0) {
			try {
				if ((await readSceneSnapshot(app, existing[0])) === content) return false;
			} catch {
				// Newest copy unreadable — take a fresh one.
			}
		}
		await ensureSafetyFolder(app, sceneSnapshotRoot(scenePath, isProjectRootIn(app)).root);
		const folder = sceneSnapshotFolderFor(scenePath, isProjectRootIn(app));
		await ensureFolderPath(app, folder);
		await app.vault.create(`${folder}/${snapshotFileName(reason)}`, content);
		await pruneOldSnapshots(app, scenePath);
		return true;
	} catch {
		// Snapshotting is best-effort; never block the caller's real operation.
		return false;
	}
}

/**
 * Snapshot a scene once per local day, the first time it's edited in a
 * session. `seen` is an in-memory cache (keyed `path|day`) the caller keeps
 * across calls so repeat edits the same day short-circuit without touching
 * the vault; a fresh session still checks disk in case a snapshot from an
 * earlier session already covers today.
 */
export async function ensureDailySnapshot(
	app: App,
	scenePath: string,
	content: string,
	seen: Set<string>
): Promise<void> {
	const day = new Date().toISOString().slice(0, 10);
	const key = `${scenePath}|${day}`;
	if (seen.has(key)) return;
	seen.add(key);
	const existing = await listSceneSnapshots(app, scenePath);
	if (existing.some((s) => s.timestamp.startsWith(day))) return;
	await writeSceneSnapshot(app, scenePath, content, 'daily');
}

/**
 * Restore a scene to a prior snapshot. The current on-disk state is
 * snapshotted first (reason 'pre-restore'), so restoring is itself
 * reversible — nothing is ever silently overwritten.
 */
export async function restoreSceneSnapshot(app: App, scenePath: string, snapshot: SceneSnapshot): Promise<void> {
	const file = app.vault.getAbstractFileByPath(scenePath);
	if (!(file instanceof TFile)) throw new Error('Scene file not found.');
	// Read the chosen version first: the pre-restore snapshot below may prune the oldest copy.
	const restored = await readSceneSnapshot(app, snapshot);
	const current = await app.vault.read(file);
	if (!(await writeSceneSnapshot(app, scenePath, current, 'pre-restore'))) {
		// False also means "already saved as the newest snapshot" — only go ahead if that is true.
		const newest = (await listSceneSnapshots(app, scenePath))[0];
		const newestText = newest ? await readSceneSnapshot(app, newest).catch(() => null) : null;
		if (newestText !== current) throw new Error('Could not save the current text first, so nothing was changed.');
	}
	await app.vault.modify(file, restored);
}

/** Snapshot every scene document under a project's Scenes folder. Returns how many actually changed. */
export async function snapshotProjectNow(app: App, projectRoot: string): Promise<number> {
	const prefix = projectRoot ? `${projectRoot}/Scenes/` : 'Scenes/';
	let count = 0;
	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(prefix) || isSafetyNetPath(file.path)) continue;
		try {
			const content = await app.vault.read(file);
			if (await writeSceneSnapshot(app, file.path, content, 'manual')) count++;
		} catch {
			// Unreadable file — skip it, keep going for the rest of the project.
		}
	}
	return count;
}
