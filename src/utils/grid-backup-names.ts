import { GRID_BACKUPS_DIR, joinVaultPath, parentPath, safetyFolderFor } from './safety-paths';

/**
 * Pure filename helpers for the rolling .storygrid backups. Split out of
 * grid-backup.ts so they can be unit-tested — that module imports Obsidian,
 * which ships types only and can't be loaded by Jest.
 */

export const BACKUP_FOLDER_NAME = '.storygrid-backups';
export const BACKUP_SUFFIX = '.bak.storygrid';

/** Timestamp shape written by backupFileName, e.g. 2026-08-19T16-39-29-973Z. */
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export function backupFolderFor(filePath: string): string {
	const lastSlash = filePath.lastIndexOf('/');
	const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : '';
	return dir ? `${dir}/${BACKUP_FOLDER_NAME}` : BACKUP_FOLDER_NAME;
}

export function backupBaseName(filePath: string): string {
	const lastSlash = filePath.lastIndexOf('/');
	const name = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
	return name.replace(/\.storygrid$/, '');
}

export function backupFileName(base: string, at: Date): string {
	return `${base}.${at.toISOString().replace(/[:.]/g, '-')}${BACKUP_SUFFIX}`;
}

/**
 * True when `name` is a backup of exactly `base` — `${base}.<timestamp>.bak.storygrid`.
 * A plain `startsWith(base)` test would also match backups of "Book Two" and
 * "Book.2" for the grid "Book", so pruning could delete another grid's history.
 */
export function isBackupNameFor(name: string, base: string): boolean {
	if (!name.startsWith(`${base}.`) || !name.endsWith(BACKUP_SUFFIX)) return false;
	const stamp = name.slice(base.length + 1, name.length - BACKUP_SUFFIX.length);
	return STAMP_RE.test(stamp);
}

// ── Visible safety folder (current) ─────────────────────────────────────────
// The hidden `.storygrid-backups` names above are now read-only fallbacks: new
// backups go to `<project>/pvbackup/Grid backups/<grid name>/<stamp>.json`.

export const GRID_BACKUP_EXT = '.json';

/** Folder holding this grid's backups, inside its project's safety folder (the project root is the grid's folder). */
export function gridBackupFolderFor(filePath: string): string {
	return joinVaultPath(safetyFolderFor(parentPath(filePath)), GRID_BACKUPS_DIR, backupBaseName(filePath));
}

export function gridBackupFileName(at: Date): string {
	return `${at.toISOString().replace(/[:.]/g, '-')}${GRID_BACKUP_EXT}`;
}

/** Timestamp of a backup file name, or null when `name` is not one (current or legacy shape). */
export function gridBackupStamp(name: string, base: string): string | null {
	if (name.endsWith(GRID_BACKUP_EXT)) {
		const stamp = name.slice(0, -GRID_BACKUP_EXT.length);
		return STAMP_RE.test(stamp) ? stamp : null;
	}
	return isBackupNameFor(name, base) ? name.slice(base.length + 1, name.length - BACKUP_SUFFIX.length) : null;
}
