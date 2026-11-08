import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { EntityKind } from './entity-kinds';
import { EntityInfo, extractEntityInfo, projectRootFromGridPath } from './entity-manager';
import {
	EntityIndexData,
	IndexedEntity,
	assignRoot,
	buildIndexData,
	listFromIndex,
	removeEntityByPath,
	upsertEntity,
} from './entity-index';

/**
 * Live, plugin-owned wrapper around the pure entity index (F2 of the
 * worldbuilder spine). Built once off `metadataCache`, then patched
 * incrementally from vault/metadata events so reads never rescan the vault.
 *
 * The set of project roots is derived from `.storygrid` files; any event that
 * could change that set (a `.storygrid` create/delete/rename, or any folder
 * move) triggers a full rebuild, since reparenting can change which project an
 * entity belongs to. Ordinary markdown edits patch a single bucket.
 */
export class EntityIndex {
	private data: EntityIndexData = new Map();
	private roots: string[] = [];
	/** Extra roots supplied by the caller (e.g. series rootPaths from the registry). */
	private extraRoots: () => string[] = () => [];

	constructor(private app: App) {}

	/**
	 * Register a callback that returns additional root paths to include when
	 * building the index (e.g. series roots from `settings.seriesRegistry`).
	 * Must be called before the first `rebuild()`.
	 */
	setExtraRoots(fn: () => string[]): void {
		this.extraRoots = fn;
	}

	/** Full rebuild from the metadata cache. Cheap relative to per-render scans. */
	rebuild(): void {
		this.roots = this.collectRoots();
		const entities: IndexedEntity[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const entity = extractEntityInfo(this.app, file, this.roots);
			if (entity) entities.push(entity);
		}
		this.data = buildIndexData(entities);
	}

	/** Read a kind's entities for a project — no scan, no file reads. */
	list(rootPath: string, kind: EntityKind): EntityInfo[] {
		return listFromIndex(this.data, rootPath, kind);
	}

	/**
	 * The project a vault path belongs to (the deepest root holding it), or
	 * null. Reads the roots fresh, so it is right even before a rebuild.
	 */
	rootFor(path: string): string | null {
		return assignRoot(path, this.collectRoots());
	}

	/** Return every indexed entity across all projects and kinds. */
	getAllEntities(): EntityInfo[] {
		const result: EntityInfo[] = [];
		for (const byKind of this.data.values()) {
			for (const entities of byKind.values()) {
				result.push(...entities);
			}
		}
		return result;
	}

	// ─── Incremental invalidation ──────────────────────────────────────────────

	handleCreate(file: TAbstractFile): void {
		if (this.needsRebuild(file)) return void this.rebuild();
		this.refreshFile(file);
	}

	handleDelete(file: TAbstractFile): void {
		if (file instanceof TFolder || this.isGrid(file.path)) return void this.rebuild();
		removeEntityByPath(this.data, file.path);
	}

	handleRename(file: TAbstractFile, oldPath: string): void {
		// A grid move (either end) or a folder move can reparent entities → rebuild.
		if (file instanceof TFolder || this.isGrid(file.path) || this.isGrid(oldPath)) {
			return void this.rebuild();
		}
		removeEntityByPath(this.data, oldPath);
		this.refreshFile(file);
	}

	/** Fired by `metadataCache.on('changed')` — frontmatter/embeds may have moved. */
	handleChange(file: TFile): void {
		this.refreshFile(file);
	}

	// ─── internals ───────────────────────────────────────────────────────────

	/** Re-extract a single markdown file and upsert, or drop it if no longer an entity. */
	private refreshFile(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		const entity = extractEntityInfo(this.app, file, this.roots);
		if (entity) upsertEntity(this.data, entity);
		else removeEntityByPath(this.data, file.path);
	}

	private needsRebuild(file: TAbstractFile): boolean {
		return file instanceof TFolder || this.isGrid(file.path);
	}

	private isGrid(path: string): boolean {
		return path.endsWith('.storygrid');
	}

	/**
	 * Project roots = folders containing a `.storygrid` file, plus any extra
	 * roots (e.g. series roots that own a shared Codex but no grid of their own).
	 */
	private collectRoots(): string[] {
		const roots = new Set<string>();
		for (const file of this.app.vault.getFiles()) {
			if (file.extension === 'storygrid') roots.add(projectRootFromGridPath(file.path));
		}
		for (const r of this.extraRoots()) roots.add(r);
		return [...roots];
	}
}
