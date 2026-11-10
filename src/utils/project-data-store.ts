import { App, TFile } from 'obsidian';
import { DashboardSettings, ProjectGoals, TodoItem, StreakData } from '../grid-data';
import { buildTreeFromFlatOrder } from './scene-tree';
import type { SceneTree } from './scene-tree';
import { t } from '../i18n';
import { buildBookOrderNote } from './book-order-note';
import { ensureSafetyFolder, readLegacyFile, writeTextIfChanged } from './safety-folder';
import { BOOK_ORDER_FILE, PROJECT_DATA_FILE, joinVaultPath, safetyFolderFor } from './safety-paths';

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
}

const LEGACY_MIRROR_FILE_NAME = '.storygrid-data.json';

export function mirrorPath(projectRoot: string): string {
	return joinVaultPath(safetyFolderFor(projectRoot), PROJECT_DATA_FILE);
}

function legacyMirrorPath(projectRoot: string): string {
	return joinVaultPath(projectRoot, LEGACY_MIRROR_FILE_NAME);
}

function isEmptySlice(slice: ProjectDataSlice): boolean {
	return !slice.goals && !slice.todos?.length && !slice.typedWords
		&& !slice.streaks && !slice.celebratedGoals && !slice.skippedWords
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

/** Write (or update) this project's mirror file — only when its content changed. Best-effort — failures are swallowed. */
export async function writeProjectMirror(app: App, projectRoot: string, dash: DashboardSettings): Promise<void> {
	const slice = extractProjectSlice(dash, projectRoot);
	if (isEmptySlice(slice)) return;
	try {
		await ensureSafetyFolder(app, projectRoot);
		await writeTextIfChanged(app, mirrorPath(projectRoot), JSON.stringify(slice, null, 2));
	} catch {
		// Mirror write is best-effort; settings.dashboard remains authoritative.
	}
	try {
		// Shadow copy of the outline as a readable note. Nothing reads it back yet.
		const tree = slice.sceneTree?.length ? slice.sceneTree : buildTreeFromFlatOrder(slice.sceneOrder ?? []);
		const note = buildBookOrderNote(tree, t('safetyNet.bookOrderIntro'));
		if (note) await writeTextIfChanged(app, bookOrderPath(projectRoot), note);
	} catch {
		// Best-effort, like the mirror.
	}
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
 * Runs once per plugin load. For every known project: if local settings
 * already have data for it, refresh (or create) the vault mirror. If local
 * settings have NO data for it but a vault mirror exists, recover from the
 * mirror into settings — this is what saves the day after a reinstall or a
 * data.json sync conflict that dropped a project. Never deletes anything.
 * Returns true if settings were changed (caller should persist them).
 */
export async function syncProjectMirrors(
	app: App,
	dash: DashboardSettings,
	projectRoots: string[]
): Promise<boolean> {
	let settingsChanged = false;
	for (const root of projectRoots) {
		const local = extractProjectSlice(dash, root);
		if (!isEmptySlice(local)) {
			await writeProjectMirror(app, root, dash);
			continue;
		}
		const mirror = await readProjectMirror(app, root);
		if (!mirror || isEmptySlice(mirror)) continue;
		if (mirror.goals) dash.goals[root] = mirror.goals;
		if (mirror.todos) dash.todos[root] = mirror.todos;
		if (mirror.typedWords) dash.typedWords[root] = mirror.typedWords;
		if (mirror.streaks) (dash.streaks ??= {})[root] = mirror.streaks;
		if (mirror.celebratedGoals) (dash.celebratedGoals ??= {})[root] = mirror.celebratedGoals;
		if (mirror.skippedWords) (dash.skippedWords ??= {})[root] = mirror.skippedWords;
		if (mirror.sceneOrder) (dash.sceneOrder ??= {})[root] = mirror.sceneOrder;
		if (mirror.sceneTree) (dash.sceneTree ??= {})[root] = mirror.sceneTree;
		if (Array.isArray(mirror.quietLeftOut)) {
			(dash.quietLeftOut ??= {})[root] = mirror.quietLeftOut.filter((p): p is string => typeof p === 'string');
		}
		settingsChanged = true;
	}
	return settingsChanged;
}
