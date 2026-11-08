import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { t } from '../i18n';
import {
	BOOK_ORDER_FILE,
	GRID_BACKUPS_DIR,
	NOTE_SNAPSHOTS_DIR,
	OLD_SAFETY_FOLDER_NAME,
	PROJECT_DATA_FILE,
	README_FILE,
	SAFETY_FOLDER_NAME,
	SCENE_SNAPSHOTS_DIR,
	joinVaultPath,
	parentPath,
	safetyFolderFor,
} from './safety-paths';

/**
 * Vault plumbing shared by every safety net (see safety-paths.ts for the
 * layout). All writes go through the normal vault API into visible folders,
 * so Obsidian indexes them and the nets can list, prune and restore their own
 * files. The old dot-folder copies are only read, through the adapter
 * (`readLegacy*`), never written or deleted.
 */

/** Creates every missing folder level in `path`, tolerating races with concurrent creators. */
export async function ensureFolderPath(app: App, path: string): Promise<void> {
	if (!path) return;
	let cur = '';
	for (const part of path.split('/')) {
		cur = cur ? `${cur}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(cur)) {
			try {
				await app.vault.createFolder(cur);
			} catch {
				// Lost a race with another create — folder exists now either way.
			}
		}
	}
}

/** Creates the project's `pvbackup/` folder and its "What is this folder" note if either is missing. Never overwrites the note. */
export async function ensureSafetyFolder(app: App, projectRoot: string): Promise<string> {
	const folder = safetyFolderFor(projectRoot);
	await ensureFolderPath(app, folder);
	const readme = joinVaultPath(folder, README_FILE);
	if (!app.vault.getAbstractFileByPath(readme)) {
		try {
			await app.vault.create(readme, t('safetyNet.readme'));
		} catch {
			// Lost a race, or the writer made one themselves — either way, keep what's there.
		}
	}
	return folder;
}

const writeQueues = new Map<string, Promise<unknown>>();

/**
 * Runs `task` after every earlier task queued for the same path has settled.
 * Mirror writes are fire-and-forget from several views at once; without this,
 * two first writes race and the loser's `create` fails with "already exists".
 */
function queueForPath<T>(path: string, task: () => Promise<T>): Promise<T> {
	const prev = writeQueues.get(path) ?? Promise.resolve();
	const run = prev.then(task, task);
	writeQueues.set(path, run);
	void run.finally(() => {
		if (writeQueues.get(path) === run) writeQueues.delete(path);
	}).catch(() => undefined);
	return run;
}

/**
 * Writes `content` to `path`, creating parent folders as needed, and skips the
 * write when the file already holds exactly that — so an unchanged copy never
 * touches the disk (no sync churn, no vault events).
 */
export function writeTextIfChanged(app: App, path: string, content: string): Promise<void> {
	return queueForPath(path, async () => {
		const existing = app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			if ((await app.vault.read(existing)) === content) return;
			await app.vault.modify(existing, content);
			return;
		}
		await ensureFolderPath(app, parentPath(path));
		await app.vault.create(path, content);
	});
}

/** File paths directly inside a (possibly hidden) folder, read past the vault index. [] if the folder is missing. */
export async function listLegacyFiles(app: App, folder: string): Promise<string[]> {
	try {
		if (!(await app.vault.adapter.exists(folder))) return [];
		return (await app.vault.adapter.list(folder)).files;
	} catch {
		return [];
	}
}

/** Reads a (possibly hidden) file past the vault index, or null if it is missing or unreadable. */
export async function readLegacyFile(app: App, path: string): Promise<string | null> {
	try {
		if (!(await app.vault.adapter.exists(path))) return null;
		return await app.vault.adapter.read(path);
	} catch {
		return null;
	}
}

/** Exactly the entries Plotverk writes into a safety folder (the note is handled on its own). */
const MIGRATED_ENTRY_NAMES = new Set([PROJECT_DATA_FILE, BOOK_ORDER_FILE, GRID_BACKUPS_DIR, SCENE_SNAPSHOTS_DIR, NOTE_SNAPSHOTS_DIR]);

/**
 * Startup, before any safety write: fold every older safety folder into its
 * exact-case `pvbackup/` — the first name `Plotverk/` (writers took a folder
 * named after the plugin for a place to keep their own things), and any
 * other-case `PVBackup/` (case-insensitive disks see one folder, but Obsidian
 * and isSafetyNetPath compare paths exactly). Scans the whole vault, not just
 * grid folders: note snapshots can sit under the vault root or a Scenes
 * parent without a grid.
 */
export async function migrateSafetyFolders(app: App): Promise<void> {
	const folders = () => app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && f.path !== '/');
	for (const f of folders()) {
		if (f.name !== SAFETY_FOLDER_NAME && f.name.toLowerCase() === SAFETY_FOLDER_NAME) await mergeSafetyFolder(app, f.path);
	}
	for (const f of folders()) {
		if (f.name !== OLD_SAFETY_FOLDER_NAME) continue;
		await mergeSafetyFolder(app, f.path);
		// An old folder an earlier run emptied (its note is gone, so the merge above skips it). Empty on disk only.
		await removeIfEmpty(app, f.path);
	}
}

/**
 * Merges one older safety folder into `pvbackup/` beside it. Only touched
 * when it carries our "What is this folder" note — a writer's own folder with
 * the same name is never touched — and only our own entries move. When a
 * file exists on both sides the newer one is kept and the other goes to
 * Obsidian's trash (recoverable, never deleted outright). The old note is
 * never carried over (its wording predates the rename) and the old folder is
 * removed only once it is empty.
 */
async function mergeSafetyFolder(app: App, oldPath: string): Promise<void> {
	const old = app.vault.getAbstractFileByPath(oldPath);
	if (!(old instanceof TFolder)) return;
	if (!(app.vault.getAbstractFileByPath(joinVaultPath(oldPath, README_FILE)) instanceof TFile)) return;
	const projectRoot = parentPath(oldPath);
	const dest = safetyFolderFor(projectRoot);
	try {
		if (!app.vault.getAbstractFileByPath(dest) && old.name.toLowerCase() === SAFETY_FOLDER_NAME) {
			// Case-only rename: through a temporary name, as case-insensitive disks treat both names as one.
			const tmp = `${dest}-renaming-${Date.now()}`;
			await app.vault.rename(old, tmp);
			const moved = app.vault.getAbstractFileByPath(tmp);
			if (moved) await app.vault.rename(moved, dest);
			return;
		}
		// Writes the note in its current (firmer) wording if pvbackup has none yet.
		await ensureSafetyFolder(app, projectRoot);
		for (const child of [...old.children]) {
			if (MIGRATED_ENTRY_NAMES.has(child.name)) await mergeInto(app, child, joinVaultPath(dest, child.name));
		}
		// Last, as it marks the folder as ours: a failed run above leaves it, so the next start retries.
		const oldNote = app.vault.getAbstractFileByPath(joinVaultPath(oldPath, README_FILE));
		if (oldNote instanceof TFile) await app.vault.trash(oldNote, false);
		await removeIfEmpty(app, oldPath);
	} catch (err) {
		console.error('Plotverk: could not move the old safety folder', oldPath, err);
	}
}

async function mergeInto(app: App, item: TAbstractFile, target: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(target);
	if (!existing) {
		await app.vault.rename(item, target);
		return;
	}
	if (item instanceof TFolder && existing instanceof TFolder) {
		for (const child of [...item.children]) await mergeInto(app, child, joinVaultPath(target, child.name));
		await removeIfEmpty(app, item.path);
		return;
	}
	if (item instanceof TFile && existing instanceof TFile) {
		// Keep whichever copy is newer: an older build may have written the old folder after pvbackup existed.
		if (item.stat.mtime > existing.stat.mtime) {
			await app.vault.trash(existing, false);
			await app.vault.rename(item, target);
		} else {
			await app.vault.trash(item, false);
		}
	}
}

/**
 * Removes the folder only when it is empty ON DISK. Asks the adapter, not the
 * vault index: right after a burst of renames and trashes Obsidian's
 * `TFolder.children` can still list the moved items, which left an emptied
 * `Plotverk/` behind. A non-recursive rmdir also refuses anything non-empty
 * (hidden files included), so this can never take content with it.
 */
async function removeIfEmpty(app: App, path: string): Promise<void> {
	try {
		if (!(await app.vault.adapter.exists(path))) return;
		const { files, folders } = await app.vault.adapter.list(path);
		if (files.length === 0 && folders.length === 0) await app.vault.adapter.rmdir(path, false);
	} catch {
		// Left in place; harmless, and an empty old folder is retried on the next start.
	}
}
