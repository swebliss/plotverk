import { App, TFile, TFolder } from 'obsidian';
import {
	backupBaseName,
	backupFolderFor,
	gridBackupFileName,
	gridBackupFolderFor,
	gridBackupStamp,
} from './grid-backup-names';
import { ensureFolderPath, ensureSafetyFolder, listLegacyFiles, readLegacyFile } from './safety-folder';
import { parentPath } from './safety-paths';
import { formatSnapshotTimestamp } from './scene-snapshots-paths';

/**
 * Rolling backups for .storygrid files, written to the project's visible
 * `pvbackup/Grid backups/<grid name>/` folder so a corrupted save or crash
 * mid-write doesn't cost the whole grid. Kept deliberately dumb: plain file
 * copies, no diffing.
 *
 * Backups from before the safety folder sit in a hidden `.storygrid-backups`
 * folder next to the grid. They are still offered for restore, read past the
 * vault index, but never written to or pruned.
 */

const MAX_BACKUPS = 3;

export interface GridBackup {
	/** Vault path of the backup file. */
	path: string;
	/** ISO stamp from the file name (`:`/`.` replaced by `-`) — sorts as a plain string. */
	stamp: string;
	/** True for a copy in the old hidden folder: read-only, never pruned. */
	legacy: boolean;
	/** The indexed file, for current backups only. */
	file?: TFile;
}

export async function writeGridBackup(app: App, filePath: string, content: string): Promise<void> {
	await ensureSafetyFolder(app, parentPath(filePath));
	const folder = gridBackupFolderFor(filePath);
	await ensureFolderPath(app, folder);
	await app.vault.create(`${folder}/${gridBackupFileName(new Date())}`, content);
	await pruneOldBackups(app, filePath);
}

/** Every backup of this grid, current and legacy, newest first. */
export async function listGridBackups(app: App, filePath: string): Promise<GridBackup[]> {
	const base = backupBaseName(filePath);
	const out: GridBackup[] = [];

	const folder = app.vault.getAbstractFileByPath(gridBackupFolderFor(filePath));
	if (folder instanceof TFolder) {
		for (const f of folder.children) {
			if (!(f instanceof TFile)) continue;
			const stamp = gridBackupStamp(f.name, base);
			if (stamp) out.push({ path: f.path, stamp, legacy: false, file: f });
		}
	}

	for (const path of await listLegacyFiles(app, backupFolderFor(filePath))) {
		const name = path.split('/').pop() ?? path;
		if (name.endsWith('.json')) continue; // only legacy-shaped names belong to the old folder
		const stamp = gridBackupStamp(name, base);
		if (stamp) out.push({ path, stamp, legacy: true });
	}

	// Newest first; on an identical stamp the current copy wins.
	return out.sort((a, b) => b.stamp.localeCompare(a.stamp) || Number(a.legacy) - Number(b.legacy));
}

async function pruneOldBackups(app: App, filePath: string): Promise<void> {
	const current = (await listGridBackups(app, filePath)).filter((b) => !b.legacy);
	for (const backup of current.slice(MAX_BACKUPS)) {
		try {
			// Permanent on purpose: these are rolling copies Plotverk made itself and newer
			// ones always exist; sending each to the trash would fill it during normal editing.
			// Removed through the adapter, which the vault index follows like any other delete.
			await app.vault.adapter.remove(backup.path);
		} catch {
			// Best-effort cleanup; a stray old backup is harmless.
		}
	}
}

async function readBackup(app: App, backup: GridBackup): Promise<string | null> {
	if (backup.file) {
		try {
			return await app.vault.read(backup.file);
		} catch {
			return null;
		}
	}
	return readLegacyFile(app, backup.path);
}

/** Newest backup whose content parses as valid JSON, or null if none do. `backupName` is its date, for display. */
export async function restoreNewestValidBackup(
	app: App,
	filePath: string
): Promise<{ content: string; backupName: string } | null> {
	for (const backup of await listGridBackups(app, filePath)) {
		const content = await readBackup(app, backup);
		if (content === null) continue;
		try {
			JSON.parse(content);
		} catch {
			continue;
		}
		return { content, backupName: formatSnapshotTimestamp(backup.stamp) };
	}
	return null;
}
