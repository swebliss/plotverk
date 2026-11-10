import { Notice, TFile, TFolder } from 'obsidian';
import type StorygridPlugin from '../main';
import { generateId } from '../grid-data';
import { ensureDashboard } from '../dashboard-view';
import { t } from '../i18n';
import { writeProjectMirror } from '../utils/project-data-store';
import type { SceneTree } from '../utils/scene-tree';
import { SAMPLE_FOLDER, base64ToArrayBuffer, buildSamplePlan, type SamplePlan } from './sample-plan';
import {
	SAMPLE_BOOKS,
	SAMPLE_IMAGE_FILES,
	SAMPLE_SCENE_TREES,
	SAMPLE_SOURCE_ROOT,
	SAMPLE_TEXT_FILES,
} from './saltmarch-data';

/**
 * "Load the sample story": writes the packed Saltmarch series into its own new
 * top-level folder, registers it as a two-book series, and opens Book 1.
 *
 * Safety rules:
 *  - Writes ONLY inside its own new folder. If a folder with that name already
 *    exists (any capitals), nothing is written: an earlier sample is opened, or
 *    the user is told the name is taken.
 *  - If writing fails half-way, only what this load created goes to the system
 *    trash (recoverable) — never a file or folder that was already there.
 *  - Every load gets brand-new Codex sheet ids (see freshEntityIds).
 *  - No network: everything comes from inside the plugin.
 */

let loading = false;

function samplePlan(): SamplePlan {
	return buildSamplePlan({
		sourceRoot: SAMPLE_SOURCE_ROOT,
		textFiles: SAMPLE_TEXT_FILES,
		imageFiles: SAMPLE_IMAGE_FILES,
		sceneTrees: SAMPLE_SCENE_TREES,
		books: SAMPLE_BOOKS,
	});
}

/** A top-level file or folder whose name matches `name` ignoring capitals (Windows, macOS and iOS disks do). */
function topLevelMatch(plugin: StorygridPlugin, name: string): TFolder | TFile | null {
	const lower = name.toLowerCase();
	for (const child of plugin.app.vault.getRoot().children) {
		if (child.name.toLowerCase() === lower && (child instanceof TFolder || child instanceof TFile)) return child;
	}
	return null;
}

/** Register the sample as a series with its books (replacing any earlier entry for the same folder), and make Book 1 active. */
function registerSeries(plugin: StorygridPlugin, plan: SamplePlan): void {
	const s = plugin.settings;
	const seriesRegistry = (s.seriesRegistry ??= {});
	const bookRegistry = (s.bookRegistry ??= {});
	// A sample deleted in the file explorer and loaded again keeps its old entry until the
	// next start — drop it so the switcher never shows the sample twice.
	const inSample = (p: string): boolean => p === plan.root || p.startsWith(plan.root + '/');
	const dropped = new Set<string>();
	for (const [sid, series] of Object.entries(seriesRegistry)) {
		if (series.rootPath === plan.root) { delete seriesRegistry[sid]; dropped.add(sid); }
	}
	for (const [bid, book] of Object.entries(bookRegistry)) {
		if (dropped.has(book.seriesId) || (book.gridPath && inSample(book.gridPath))) delete bookRegistry[bid];
	}

	const sid = 'series_' + generateId().slice(0, 8);
	seriesRegistry[sid] = { name: plan.series.name, rootPath: plan.series.rootPath };
	const bookIds = plan.books.map((book) => {
		const bid = 'book_' + generateId().slice(0, 8);
		bookRegistry[bid] = { name: book.name, seriesId: sid, gridPath: book.gridPath };
		return bid;
	});
	s.isSeriesMode = true;
	s.activeSeriesId = sid;
	s.activeBookId = bookIds[0];
}

/** Give the Writers Panel the sample's chapter order. */
function setSceneOrder(plugin: StorygridPlugin, plan: SamplePlan): void {
	const dash = ensureDashboard(plugin.settings);
	const trees = (dash.sceneTree ??= {});
	for (const [root, tree] of Object.entries(plan.sceneTrees)) trees[root] = tree as SceneTree;
}

/** Open Book 1 (or the Codex when the Plot Grid is switched off). */
async function openSample(plugin: StorygridPlugin, plan: SamplePlan): Promise<void> {
	await plugin.setActiveProjectRoot(plan.root);
	const book1 = plugin.app.vault.getAbstractFileByPath(plan.books[0].gridPath);
	if (book1 instanceof TFile && plugin.isModuleOn('plotGrid')) await plugin.openGridFile(book1);
	else await plugin.openCodex(plan.root);
}

/** What one load has created so far — the only things a failed load may take back. */
interface Created { folders: string[]; files: string[] }

async function writeFiles(plugin: StorygridPlugin, plan: SamplePlan, created: Created): Promise<void> {
	const vault = plugin.app.vault;
	for (const folder of plan.folders) {
		if (vault.getAbstractFileByPath(folder) instanceof TFolder) continue;
		await vault.createFolder(folder);
		created.folders.push(folder);
	}
	// Pictures first, so the sheets that show them find them the moment they appear.
	for (const img of plan.imageFiles) {
		await vault.createBinary(img.path, base64ToArrayBuffer(img.base64));
		created.files.push(img.path);
	}
	// Notes before grids and the timeline, so the grids' links resolve as soon as they load.
	const ordered = [...plan.textFiles].sort((a, b) => Number(!a.path.endsWith('.md')) - Number(!b.path.endsWith('.md')));
	for (const f of ordered) {
		await vault.create(f.path, f.content);
		created.files.push(f.path);
	}
}

/**
 * Take back a failed load: to the system trash (recoverable), only the files it created,
 * then only the folders it created that are now empty. Anything else that turned up in
 * the folder meanwhile (a sync still arriving, say) is left exactly where it is.
 */
async function undoPartialLoad(plugin: StorygridPlugin, created: Created): Promise<void> {
	const vault = plugin.app.vault;
	for (const path of [...created.files].reverse()) {
		const f = vault.getAbstractFileByPath(path);
		if (f instanceof TFile) {
			try { await plugin.app.fileManager.trashFile(f); } catch { /* leave it */ }
		}
	}
	for (const path of [...created.folders].reverse()) {
		const f = vault.getAbstractFileByPath(path);
		if (f instanceof TFolder && f.children.length === 0) {
			try { await plugin.app.fileManager.trashFile(f); } catch { /* leave it */ }
		}
	}
}

export async function loadSampleStory(plugin: StorygridPlugin): Promise<void> {
	if (loading) return;
	loading = true;
	try {
		const plan = samplePlan();
		const existing = topLevelMatch(plugin, SAMPLE_FOLDER);
		if (existing) {
			const book1 = plugin.app.vault.getAbstractFileByPath(plan.books[0].gridPath);
			if (existing instanceof TFolder && existing.path === plan.root && book1 instanceof TFile) {
				// Loaded before: open it as it is now (the user may have changed it). Re-register
				// only when the series entry went missing, so their book choice is kept.
				const registered = Object.values(plugin.settings.seriesRegistry ?? {}).some((s) => s.rootPath === plan.root);
				if (!registered) {
					registerSeries(plugin, plan);
					await plugin.saveSettings();
				}
				new Notice(t('sample.notice.alreadyLoaded', { folder: plan.root }));
				await openSample(plugin, plan);
			} else {
				new Notice(t('sample.notice.folderTaken', { folder: existing.name }), 10000);
			}
			return;
		}

		const progress = new Notice(t('sample.notice.loading'), 0);
		const created: Created = { folders: [], files: [] };
		try {
			await writeFiles(plugin, plan, created);
		} catch (err) {
			progress.hide();
			console.error('Plotverk: loading the sample story failed', err);
			await undoPartialLoad(plugin, created);
			new Notice(t('sample.notice.failed'), 10000);
			return;
		}
		progress.hide();

		registerSeries(plugin, plan);
		setSceneOrder(plugin, plan);
		await plugin.saveSettings();
		for (const root of Object.keys(plan.sceneTrees)) {
			await writeProjectMirror(plugin.app, root, ensureDashboard(plugin.settings));
		}
		await openSample(plugin, plan);
		new Notice(t('sample.notice.loaded', { folder: plan.root }), 10000);
	} finally {
		loading = false;
	}
}
