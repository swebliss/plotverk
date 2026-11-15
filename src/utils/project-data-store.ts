import { App, TFile, TFolder } from 'obsidian';
import { DashboardSettings, ProjectGoals, TodoItem, StreakData } from '../grid-data';
import { buildTreeFromFlatOrder } from './scene-tree';
import type { SceneTree } from './scene-tree';
import { t } from '../i18n';
import { buildBookOrderNote } from './book-order-note';
import { ensureSafetyFolder, readLegacyFile, writeTextIfChanged } from './safety-folder';
import { BOOK_ORDER_FILE, PROJECT_DATA_FILE, joinVaultPath, safetyFolderFor } from './safety-paths';
import { keepOutlineFromCopy, rebaseSlicePaths } from './project-move';

/**
 * Per-project data (tasks, word goals, typed-word history, streaks) lives in
 * plugin-global settings (data.json), keyed by project root. That's a single
 * shared file across every project on the device — if it's lost, reset, or
 * conflicts during sync, every project's tasks and stats go with it.
 *
 * This module mirrors each project's slice out to a small JSON file inside
 * that project's own folder in the vault, so the data travels with the
 * project (and with vault sync/git) instead of living only in plugin
 * settings. The mirror is a best-effort copy, not the source of truth —
 * settings.dashboard is never deleted or bypassed by this module.
 *
 * The copy lives at `<project>/pvbackup/Project data.json`. It used to be a
 * hidden `.storygrid-data.json`, which Obsidian's vault index can't see — so
 * after its first write every update failed with "already exists". That old
 * file is still read as a recovery fallback, never written.
 */

export interface ProjectDataSlice {
	goals?: Partial<ProjectGoals>;
	todos?: TodoItem[];
	typedWords?: Record<string, number>;
	streaks?: StreakData;
	celebratedGoals?: Record<string, string>;
	skippedWords?: Record<string, number>;
	/** Writers Panel manuscript order (scene-doc paths, author-arranged). Superseded by sceneTree; kept for one-time migration. */
	sceneOrder?: string[];
	/** Writers Panel outline tree (scene docs + dividers, nestable). */
	sceneTree?: SceneTree;
	/** "Who's gone quiet": character sheet paths the writer left out. */
	quietLeftOut?: string[];
	/** Only in the copy on disk: the folder it was written for. Absent in copies written by older versions. */
	projectRoot?: string;
}

const LEGACY_MIRROR_FILE_NAME = '.storygrid-data.json';

export function mirrorPath(projectRoot: string): string {
	return joinVaultPath(safetyFolderFor(projectRoot), PROJECT_DATA_FILE);
}

function legacyMirrorPath(projectRoot: string): string {
	return joinVaultPath(projectRoot, LEGACY_MIRROR_FILE_NAME);
}

function isEmptySlice(slice: ProjectDataSlice): boolean {
	// An empty `{}` (e.g. a day list created by a button before anything was counted) is no data either.
	const none = (o: object | undefined): boolean => !o || Object.keys(o).length === 0;
	return none(slice.goals) && !slice.todos?.length && none(slice.typedWords)
		&& none(slice.streaks) && none(slice.celebratedGoals) && none(slice.skippedWords)
		&& !slice.sceneOrder?.length && !slice.sceneTree?.length && !slice.quietLeftOut?.length;
}

export function extractProjectSlice(dash: DashboardSettings, projectRoot: string): ProjectDataSlice {
	return {
		goals: dash.goals[projectRoot],
		todos: dash.todos[projectRoot],
		typedWords: dash.typedWords[projectRoot],
		streaks: dash.streaks?.[projectRoot],
		celebratedGoals: dash.celebratedGoals?.[projectRoot],
		skippedWords: dash.skippedWords?.[projectRoot],
		sceneOrder: dash.sceneOrder?.[projectRoot],
		sceneTree: dash.sceneTree?.[projectRoot],
		quietLeftOut: dash.quietLeftOut?.[projectRoot],
	};
}

let heldMirrors: Map<string, { app: App; dash: DashboardSettings }> | null = null;

/**
 * Plugin start: hold every copy write until `syncProjectMirrors` has read the
 * copies on disk. A view drawn at startup (the Writers Panel is always open)
 * would otherwise overwrite a moved or restored project's only copy with an
 * empty or freshly built one before it is read.
 */
export function holdProjectMirrors(): void {
	heldMirrors ??= new Map();
}

/** The startup check is done: write what was held, now. */
export function releaseProjectMirrors(): void {
	const held = heldMirrors;
	heldMirrors = null;
	if (!held) return;
	for (const [root, entry] of held) void writeProjectMirror(entry.app, root, entry.dash);
}

/** False while copies are held at startup: views must not seed or rebuild project data yet. */
export function projectDataReady(): boolean {
	return heldMirrors === null;
}

/**
 * Write (or update) this project's mirror file — only when its content changed. Best-effort — failures are swallowed.
 * Never for a project folder that doesn't exist (renamed, moved or deleted): writing would bring the old
 * folder back as an empty ghost. The vault root ('') always exists. The copy records which folder it was
 * written for (`projectRoot`), so a copy that travels with a moved folder can be pointed at its new place.
 */
export async function writeProjectMirror(app: App, projectRoot: string, dash: DashboardSettings): Promise<void> {
	if (heldMirrors) {
		// Startup: the copies on disk are still to be checked (a moved or restored project
		// reads its data from them) — written once the check is done (releaseProjectMirrors).
		heldMirrors.set(projectRoot, { app, dash });
		return;
	}
	await writeMirrorNow(app, projectRoot, dash);
}

async function writeMirrorNow(app: App, projectRoot: string, dash: DashboardSettings): Promise<void> {
	const slice = extractProjectSlice(dash, projectRoot);
	if (isEmptySlice(slice)) return;
	const rootExists = (): boolean => projectRoot === '' || app.vault.getAbstractFileByPath(projectRoot) instanceof TFolder;
	if (!rootExists()) return;
	// Queued now, in call order (so the last call's data is the one that lands); the folder is checked again just before creating anything.
	const prepare = async (): Promise<boolean> => {
		if (!rootExists()) return false;
		await ensureSafetyFolder(app, projectRoot);
		return rootExists();
	};
	let note: string | null = null;
	try {
		// Shadow copy of the outline as a readable note. Nothing reads it back yet.
		const tree = slice.sceneTree?.length ? slice.sceneTree : buildTreeFromFlatOrder(slice.sceneOrder ?? []);
		note = buildBookOrderNote(tree, t('safetyNet.bookOrderIntro'));
	} catch {
		// Best-effort, like the mirror.
	}
	// Mirror writes are best-effort; settings.dashboard remains authoritative.
	const writes: Array<Promise<void>> = [
		writeTextIfChanged(app, mirrorPath(projectRoot), JSON.stringify({ projectRoot, ...slice }, null, 2), prepare),
	];
	if (note) writes.push(writeTextIfChanged(app, bookOrderPath(projectRoot), note, prepare));
	const settled = writes.map((w) => w.catch(() => undefined));
	try {
		// The folder's "What is this folder" note comes back if the writer removed it (as before).
		if (rootExists()) await ensureSafetyFolder(app, projectRoot);
	} catch {
		// Best-effort.
	}
	await Promise.all(settled);
}

export function bookOrderPath(projectRoot: string): string {
	return joinVaultPath(safetyFolderFor(projectRoot), BOOK_ORDER_FILE);
}

/** The project's mirror, from the safety folder or else the old hidden file. Null if neither parses. */
export async function readProjectMirror(app: App, projectRoot: string): Promise<ProjectDataSlice | null> {
	const parse = (raw: string | null): ProjectDataSlice | null => {
		if (raw === null) return null;
		try {
			return JSON.parse(raw) as ProjectDataSlice;
		} catch {
			return null;
		}
	};
	const file = app.vault.getAbstractFileByPath(mirrorPath(projectRoot));
	if (file instanceof TFile) {
		// A damaged current copy is NOT replaced by the old hidden one: that file is the first write ever
		// made, so "recovering" from it would bring back months-old tasks and stats as if they were current.
		try {
			return parse(await app.vault.read(file));
		} catch {
			return null;
		}
	}
	return parse(await readLegacyFile(app, legacyMirrorPath(projectRoot)));
}

const MIRROR_DEBOUNCE_MS = 30_000;
const pendingMirrors = new Map<string, { timer: number; app: App; dash: DashboardSettings }>();

/**
 * Debounced `writeProjectMirror` for callers that fire on every typing pause
 * (word counts, streaks, the Dashboard's quiet save): one write per project
 * at most every 30 s instead of one per second, which keeps a visible,
 * synced file from churning. Settings stay authoritative, so a copy that is
 * up to 30 s behind costs nothing; `flushProjectMirrors` writes the rest.
 */
export function scheduleProjectMirror(app: App, projectRoot: string, dash: DashboardSettings): void {
	const pending = pendingMirrors.get(projectRoot);
	if (pending) {
		pending.dash = dash;
		return;
	}
	const entry = {
		app,
		dash,
		timer: window.setTimeout(() => {
			pendingMirrors.delete(projectRoot);
			void writeProjectMirror(entry.app, projectRoot, entry.dash);
		}, MIRROR_DEBOUNCE_MS),
	};
	pendingMirrors.set(projectRoot, entry);
}

/** Write every scheduled mirror now (plugin unload). */
export function flushProjectMirrors(): void {
	for (const [root, entry] of pendingMirrors) {
		window.clearTimeout(entry.timer);
		void writeProjectMirror(entry.app, root, entry.dash);
	}
	pendingMirrors.clear();
}

/**
 * A project folder was renamed or moved: scheduled copies follow their
 * project to its new key (`mapRoot` gives the new key, or null to leave one
 * alone), so a pending copy is written at the new place and never at the old.
 */
export function rekeyScheduledMirrors(mapRoot: (root: string) => string | null): void {
	for (const [root, entry] of [...pendingMirrors]) {
		const next = mapRoot(root);
		if (next === null || next === root) continue;
		window.clearTimeout(entry.timer);
		pendingMirrors.delete(root);
		scheduleProjectMirror(entry.app, next, entry.dash);
	}
}

export interface SyncMirrorOptions {
	/**
	 * Settings still hold a project under `from`, a folder that no longer
	 * exists, and the copy found at `to` says it was written at `from`: the
	 * folder was moved while Plotverk wasn't watching (Obsidian closed, or a
	 * synced move). Settings are newer than any copy, so the caller moves
	 * them to `to` (returns true) instead of recovering from the copy.
	 */
	adoptMovedProject?: (from: string, to: string) => boolean;
}

/**
 * Runs once per plugin load. For every known project: if local settings
 * already have data for it, refresh (or create) the vault mirror. If local
 * settings have NO data for it but a vault mirror exists, recover from the
 * mirror into settings — this is what saves the day after a reinstall or a
 * data.json sync conflict that dropped a project. Never deletes anything.
 * A copy written at another folder (the project was moved since) has its
 * paths pointed at the new folder first. Copies from older versions don't
 * say where they were written and load exactly as before.
 * Returns true if settings were changed (caller should persist them).
 */
export async function syncProjectMirrors(
	app: App,
	dash: DashboardSettings,
	projectRoots: string[],
	options: SyncMirrorOptions = {},
): Promise<boolean> {
	let settingsChanged = false;
	const folderExists = (p: string): boolean => p === '' || app.vault.getAbstractFileByPath(p) instanceof TFolder;
	const pathExists = (p: string): boolean => app.vault.getAbstractFileByPath(p) !== null;
	for (const root of projectRoots) {
		try {
			// Read lazily: without a move to look for, a project with local data never needs its copy.
			let mirror: ProjectDataSlice | null | undefined;
			const readMirror = async (): Promise<ProjectDataSlice | null> => (mirror === undefined ? (mirror = await readProjectMirror(app, root)) : mirror);
			const writtenAtOf = (m: ProjectDataSlice | null): string | null => (m && typeof m.projectRoot === 'string' ? m.projectRoot : null);
			if (options.adoptMovedProject) {
				// Checked even when this folder already has data (a view may have put
				// something there first): the move merges, so neither side is lost.
				const copy = await readMirror();
				const writtenAt = writtenAtOf(copy);
				if (copy && writtenAt !== null && writtenAt !== root && !folderExists(writtenAt)
					&& !isEmptySlice(extractProjectSlice(dash, writtenAt))
					&& options.adoptMovedProject(writtenAt, root)) {
					settingsChanged = true;
					// Outline rows only the travelled copy still has are kept too.
					try {
						keepOutlineFromCopy(dash, root, rebaseSlicePaths(copy, writtenAt, root, (oldPath, newPath) => pathExists(oldPath) && !pathExists(newPath)));
					} catch {
						// A damaged copy adds nothing.
					}
				}
			}
			const local = extractProjectSlice(dash, root);
			if (!isEmptySlice(local)) {
				await writeMirrorNow(app, root, dash);
				continue;
			}
			let recovered = await readMirror();
			if (!recovered || isEmptySlice(recovered)) continue;
			const writtenAt = writtenAtOf(recovered);
			if (writtenAt !== null && writtenAt !== root) {
				// A path still found where it was (and not at the new place) points outside the project: keep it.
				recovered = rebaseSlicePaths(recovered, writtenAt, root, (oldPath, newPath) => pathExists(oldPath) && !pathExists(newPath));
			}
			if (recovered.goals) dash.goals[root] = recovered.goals;
			if (recovered.todos) dash.todos[root] = recovered.todos;
			if (recovered.typedWords) dash.typedWords[root] = recovered.typedWords;
			if (recovered.streaks) (dash.streaks ??= {})[root] = recovered.streaks;
			if (recovered.celebratedGoals) (dash.celebratedGoals ??= {})[root] = recovered.celebratedGoals;
			if (recovered.skippedWords) (dash.skippedWords ??= {})[root] = recovered.skippedWords;
			if (recovered.sceneOrder) (dash.sceneOrder ??= {})[root] = recovered.sceneOrder;
			if (recovered.sceneTree) (dash.sceneTree ??= {})[root] = recovered.sceneTree;
			if (Array.isArray(recovered.quietLeftOut)) {
				(dash.quietLeftOut ??= {})[root] = recovered.quietLeftOut.filter((p): p is string => typeof p === 'string');
			}
			settingsChanged = true;
			// The copy now says the folder it really is in, so it is never taken for a moved project later.
			await writeMirrorNow(app, root, dash);
		} catch (err) {
			// One damaged copy never stops the check of the other projects; settings stay as they are for this one.
			console.error('Plotverk: could not check the project data copy of', root || '(vault root)', err);
		}
	}
	return settingsChanged;
}
