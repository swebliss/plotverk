import { App, TFile } from 'obsidian';
import type { GridData, StorygridSettings } from '../grid-data';
import { projectRootFromGridPath } from '../entities/entity-manager';
import { resolveSceneTree, collectDocPaths } from '../utils/scene-tree';
import type { ReferenceIndex } from '../refs/reference-index';
import { PlaceLookups, chapterNumbers } from './book-order';
import { SetupIndex } from './setup-index';

/**
 * The live side of setup chapters: the book's scene order, where tags are, and
 * which scene each grid card is linked to. Read-only — it never writes the
 * book order or a grid.
 */

/** The project's scenes in the Writing tab's order (the Dashboard's rule: notes in `<project>/Scenes/`). */
export function orderedScenePaths(app: App, settings: StorygridSettings, root: string): string[] {
	const scenesPrefix = root ? `${root}/Scenes/` : 'Scenes/';
	let files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(scenesPrefix));
	// Series Mode: only this book's scenes, as the Writers Panel counts them
	// (outline-view.ts sceneDocsFor) — unstamped scenes count, other books' do not.
	if (settings.isSeriesMode && settings.activeBookId) {
		const bookId = settings.activeBookId;
		files = files.filter((f) => {
			const fm = app.metadataCache.getFileCache(f)?.frontmatter;
			if (!fm?.['storygrid-book-id']) return true;
			return fm['storygrid-book-id'] === bookId;
		});
	}
	const docs = files.map((f) => f.path);
	const dash = settings.dashboard;
	return collectDocPaths(resolveSceneTree(dash?.sceneTree?.[root], dash?.sceneOrder?.[root], docs));
}

export class SetupPlaces {
	private gridCache = new WeakMap<TFile, { mtime: number; size: number; grid: GridData | null }>();

	constructor(
		private app: App,
		private settings: () => StorygridSettings,
		private setupIndex: SetupIndex,
		private referenceIndex: ReferenceIndex,
	) {}

	private async readGrid(file: TFile): Promise<GridData | null> {
		const { mtime, size } = file.stat;
		const hit = this.gridCache.get(file);
		if (hit && hit.mtime === mtime && hit.size === size) return hit.grid;
		let grid: GridData | null = null;
		try {
			const parsed: unknown = JSON.parse(await this.app.vault.cachedRead(file));
			grid = parsed && typeof parsed === 'object' ? (parsed as GridData) : null;
		} catch {
			grid = null;
		}
		this.gridCache.set(file, { mtime, size, grid });
		return grid;
	}

	/**
	 * Everything needed to turn marks into chapters for one book. Grids are read
	 * (only when changed since the last read); everything else comes from indexes.
	 */
	async lookups(root: string): Promise<PlaceLookups & { orderedPaths: string[] }> {
		const orderedPaths = orderedScenePaths(this.app, this.settings(), root);
		const chapters = chapterNumbers(orderedPaths);
		const cards = new Map<string, string>();
		const grids = new Map<string, string>();
		// Every grid in the vault: a card id is only meaningful with its grid id,
		// and a series may keep grids in more than one book.
		for (const file of this.app.vault.getFiles()) {
			if (file.extension !== 'storygrid') continue;
			const inBook = !root || file.path.startsWith(root + '/') || root.startsWith(projectRootFromGridPath(file.path) + '/');
			if (!inBook) continue;
			const grid = await this.readGrid(file);
			if (!grid?.id) continue;
			if (!grids.has(grid.id)) grids.set(grid.id, file.path);
			for (const card of grid.cards ?? []) {
				if (card.linkedDocPath) cards.set(`${grid.id}/${card.id}`, card.linkedDocPath);
			}
		}
		return {
			orderedPaths,
			// A paragraph copied into another note: the copy in the book order wins.
			anchorPath: (anchor) => this.setupIndex.placeOf(anchor, (p) => chapters.get(p) ?? null)?.path ?? null,
			cardScene: (gridId, cardId) => cards.get(`${gridId}/${cardId}`) ?? null,
			entityScenes: (entityId) => this.referenceIndex.getEntityScenes(entityId),
			chapterOf: (path) => chapters.get(path) ?? null,
			gridPath: (gridId) => grids.get(gridId) ?? null,
		};
	}
}
