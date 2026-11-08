import { App, TFile, TFolder } from 'obsidian';
import { CharacterField, StorygridSettings } from '../grid-data';
import { EntityKind, getKindSpec, hasKind, getCodexKindOrder } from './entity-kinds';
import { t, hasKey } from '../i18n';
import { createEntitySheet } from './entity-write';
import { parseParentRef } from './entity-tree';
import { assignRoot, type IndexedEntity } from './entity-index';

export { buildEntityDocument } from './entity-doc';

/**
 * Shared logic for creating and discovering worldbuilding entity documents.
 * Used by both the grid view and the Codex view.
 */

export interface StoryProject {
	/** Display name — the grid's name, falling back to the folder name */
	name: string;
	/** Vault path of the project root folder ('' = vault root) */
	rootPath: string;
	/** The .storygrid files that live in this project */
	gridFiles: TFile[];
}

export interface EntityInfo {
	file: TFile;
	kind: EntityKind;
	name: string;
	/** Frontmatter key/value pairs (excluding storygrid-type) for the gallery preview */
	facts: Array<{ key: string; value: string }>;
	/** First embedded image path, if any */
	imagePath: string | null;
	/** Name of the parent entity (`storygrid-parent` frontmatter), if nested */
	parent: string | null;
	/** Stable identity ID (`storygrid-id` frontmatter). Null on legacy files until stamped. */
	entityId: string | null;
}

// ─── Project discovery ───────────────────────────────────────────────────────

/** Project root = the folder containing the .storygrid file. */
export function projectRootFromGridPath(gridFilePath: string): string {
	const idx = gridFilePath.lastIndexOf('/');
	return idx === -1 ? '' : gridFilePath.slice(0, idx);
}

/** Find every story project in the vault, grouped by project root folder. */
export function findProjects(app: App): StoryProject[] {
	const byRoot = new Map<string, StoryProject>();
	for (const file of app.vault.getFiles()) {
		if (file.extension !== 'storygrid') continue;
		const rootPath = projectRootFromGridPath(file.path);
		const existing = byRoot.get(rootPath);
		if (existing) {
			existing.gridFiles.push(file);
		} else {
			const folderName = rootPath.split('/').pop() || 'Vault';
			byRoot.set(rootPath, { name: folderName, rootPath, gridFiles: [file] });
		}
	}
	return [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Compute the Codex scope list — what appears in the Codex project switcher.
 *
 * In series mode: one scope per series (rootPath = series root, gridFiles =
 * all books in that series), plus any standalone grids not belonging to any
 * series. Series are fully isolated — their books' grids are grouped under the
 * series, never shown separately.
 *
 * Outside series mode: identical to `findProjects()`.
 */
export function findCodexScopes(app: App, settings: StorygridSettings): StoryProject[] {
	if (!settings.isSeriesMode) return findProjects(app);

	const seriesRegistry = settings.seriesRegistry ?? {};
	const bookRegistry = settings.bookRegistry ?? {};

	// Build a fast set of book gridPaths that belong to a series
	const bookGridPaths = new Set<string>();
	for (const book of Object.values(bookRegistry)) {
		if (book.gridPath) bookGridPaths.add(book.gridPath);
	}

	// One scope per series, collecting grids from all its books
	const scopes: StoryProject[] = [];
	for (const [sid, series] of Object.entries(seriesRegistry)) {
		const booksInSeries = Object.values(bookRegistry).filter((b) => b.seriesId === sid);
		const gridFiles: TFile[] = [];
		for (const book of booksInSeries) {
			if (!book.gridPath) continue;
			const f = app.vault.getAbstractFileByPath(book.gridPath);
			if (f instanceof TFile) gridFiles.push(f);
		}
		// A series whose books have all been deleted would otherwise linger as a
		// phantom scope — selectable in the Codex, and matched by a stale
		// activeProjectRoot — while the Dashboard (which resolves against real
		// files) shows a different project. Skip it rather than pruning the
		// registry here: a synced vault can have files temporarily missing, and
		// hiding an empty scope is reversible where deleting the entry is not.
		if (gridFiles.length === 0) continue;
		scopes.push({ name: series.name, rootPath: series.rootPath, gridFiles });
	}

	// Standalone grids not claimed by any series
	for (const file of app.vault.getFiles()) {
		if (file.extension !== 'storygrid') continue;
		if (bookGridPaths.has(file.path)) continue;
		const rootPath = projectRootFromGridPath(file.path);
		const existing = scopes.find((s) => s.rootPath === rootPath);
		if (existing) {
			existing.gridFiles.push(file);
		} else {
			const folderName = rootPath.split('/').pop() || 'Vault';
			scopes.push({ name: folderName, rootPath, gridFiles: [file] });
		}
	}

	return scopes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every selectable focus scope: series scopes (rootPath = series root, grids =
 * all books' grids plus any series-level arc grid) AND individual project roots
 * (books + standalones). Used by Dashboard/History so both "entire series" and
 * single-book focuses resolve. Outside series mode: identical to `findProjects()`.
 */
export function findFocusScopes(app: App, settings: StorygridSettings): StoryProject[] {
	const scopes = findCodexScopes(app, settings);
	// A series whose Book 1 sits in the series folder itself: on the Dashboard and
	// History that folder IS Book 1, so count only the grids that live there —
	// otherwise its entry mixed every book's cards while the Writers Panel showed
	// Book 1 alone. Series with no book at the root keep their all-books scope.
	if (settings.isSeriesMode) {
		const bookPaths = new Set(Object.values(settings.bookRegistry ?? {})
			.map((b) => b.gridPath).filter((p): p is string => !!p));
		for (const scope of scopes) {
			const atRoot = scope.gridFiles.filter((f) => projectRootFromGridPath(f.path) === scope.rootPath);
			if (atRoot.some((f) => bookPaths.has(f.path))) scope.gridFiles = atRoot;
		}
	}
	for (const p of findProjects(app)) {
		if (!scopes.some((s) => s.rootPath === p.rootPath)) scopes.push(p);
	}
	return scopes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Worldbuilding entities live under a `Codex/` subfolder; scenes (the manuscript
 * itself) stay at the project's top level alongside the grid.
 */
export const CODEX_FOLDER = 'Codex';

/** Folder where entities of `kind` live for a given project root. */
export function entityFolderPath(projectRoot: string, kind: EntityKind): string {
	const folderName = getKindSpec(kind).folderName;
	const rel = kind === 'scene' ? folderName : `${CODEX_FOLDER}/${folderName}`;
	return projectRoot ? `${projectRoot}/${rel}` : rel;
}

/**
 * Folder where a sheet of `kind` created FROM a grid belongs: the grid's own
 * project, worked out from the grid's path alone. Nothing global is consulted —
 * an earlier version preferred "the project most recently created", so a card
 * in an older book put its new character into the newest book's Characters
 * folder.
 */
export function entityFolderForGrid(gridFilePath: string | null, kind: EntityKind): string {
	return entityFolderPath(gridFilePath ? projectRootFromGridPath(gridFilePath) : '', kind);
}

// ─── Entity discovery ────────────────────────────────────────────────────────

const FACT_LIMIT = 3;

function kindFromFrontmatter(value: unknown): EntityKind | null {
	return typeof value === 'string' && hasKind(value) ? (value as EntityKind) : null;
}

/**
 * List all entities of a kind inside a project. An entity is any markdown file
 * that either lives in the kind's folder or carries `storygrid-type: <kind>`
 * frontmatter anywhere under the project root.
 *
 * This is the unindexed fallback (one full markdown scan per call). Hot callers
 * should read the shared `EntityIndex` instead — see `entity-index.ts`.
 */
export function listEntities(app: App, projectRoot: string, kind: EntityKind): EntityInfo[] {
	const folder = entityFolderPath(projectRoot, kind);
	const prefix = projectRoot ? `${projectRoot}/` : '';
	const results: EntityInfo[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		if (projectRoot && !file.path.startsWith(prefix)) continue;
		const cache = app.metadataCache.getFileCache(file);
		const fmKind = kindFromFrontmatter(cache?.frontmatter?.['storygrid-type']);
		const inFolder = file.parent?.path === folder;
		// Frontmatter wins; untyped files count if they sit in the kind's folder
		if (fmKind ? fmKind !== kind : !inFolder) continue;

		results.push(buildEntityInfo(app, file, kind, cache));
	}

	return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Determine which entity kind a file represents, for the project root it lives
 * under. Frontmatter `storygrid-type` wins; otherwise the file counts as the
 * kind whose folder is its direct parent. Returns null for non-entity files.
 */
function detectKind(
	app: App,
	file: TFile,
	root: string,
	cache: ReturnType<App['metadataCache']['getFileCache']>
): EntityKind | null {
	const fmKind = kindFromFrontmatter(cache?.frontmatter?.['storygrid-type']);
	if (fmKind) return fmKind;
	const parentPath = file.parent?.path;
	if (parentPath == null) return null;
	for (const kind of getCodexKindOrder()) {
		if (entityFolderPath(root, kind) === parentPath) return kind;
	}
	return null;
}

/**
 * The kind a sheet counts as when its own text does not name a registered one:
 * the kind whose folder it sits in (under any project root). Null when neither
 * says — callers show such a sheet as a plain entry, never as a Character.
 */
export function kindForFile(app: App, file: TFile): EntityKind | null {
	const fmKind = kindFromFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter?.['storygrid-type']);
	if (fmKind) return fmKind;
	const parent = file.parent?.path;
	if (!parent) return null;
	for (const kind of getCodexKindOrder()) {
		const folder = entityFolderPath('', kind);
		if (parent === folder || parent.endsWith(`/${folder}`)) return kind;
	}
	return null;
}

/**
 * Build the gallery `EntityInfo` (facts/image/parent) for a known kind+file.
 * Shared by `listEntities` and the index extractor so both stay in lockstep.
 */
function buildEntityInfo(
	app: App,
	file: TFile,
	kind: EntityKind,
	cache: ReturnType<App['metadataCache']['getFileCache']>
): EntityInfo {
	const facts: Array<{ key: string; value: string }> = [];
	const fm = cache?.frontmatter ?? {};
	const parent = parseParentRef(fm['storygrid-parent']);
	for (const [key, raw] of Object.entries(fm)) {
		if (key === 'storygrid-type' || key === 'storygrid-parent' || key === 'storygrid-id' || key === 'storygrid-schema' || key === 'storygrid-start' || key === 'tags' || key === 'position') continue;
		// Internal/styling frontmatter is never a story fact
		if (key === 'cssclasses' || key === 'cssclass' || key === 'aliases') continue;
		if (facts.length >= FACT_LIMIT) break;
		// Show wikilinks as their display text, not raw [[..]] syntax
		const value = String(raw ?? '')
			.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
			.replace(/\[\[([^\]]+)\]\]/g, '$1')
			.trim();
		if (!value || value.includes('\n')) continue;
		// Skip the redundant name fact (it equals the file name)
		if (['full-name', 'name', 'title'].includes(key) && value === file.basename) continue;
		facts.push({ key: prettifyKey(key), value });
	}

	const firstEmbed = cache?.embeds?.find((e) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(e.link));
	const imagePath = firstEmbed
		? app.metadataCache.getFirstLinkpathDest(firstEmbed.link, file.path)?.path ?? null
		: null;

	const entityId = typeof fm['storygrid-id'] === 'string' && fm['storygrid-id'].length > 0
		? fm['storygrid-id'] as string
		: null;

	return { file, kind, name: file.basename, facts, imagePath, parent, entityId };
}

/**
 * Extract a single file's entity record for the shared index, tagged with the
 * project root it belongs to (the deepest project containing it). Returns null
 * if the file is not an entity or sits under no known project. Reads only the
 * metadata cache — never the file body.
 */
export function extractEntityInfo(
	app: App,
	file: TFile,
	roots: readonly string[]
): IndexedEntity | null {
	const root = assignRoot(file.path, roots);
	if (root === null) return null;
	const cache = app.metadataCache.getFileCache(file);
	const kind = detectKind(app, file, root, cache);
	if (!kind) return null;
	return { ...buildEntityInfo(app, file, kind, cache), rootPath: root };
}

function prettifyKey(key: string): string {
	return key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Entity document creation ────────────────────────────────────────────────

/**
 * Create the entity document on disk (creating the folder if needed, and
 * de-duplicating the file name with a numeric suffix on collision).
 */
/**
 * The filename a blank-named entity of this kind gets.
 *
 * The kind registry is deliberately Obsidian-free and its `defaultName` is English. This
 * is the one place that layers a translation over it, so the Codex and the Plot Grid — which
 * build their file paths separately — cannot end up naming the same blank entity two
 * different things in the same vault. Kinds with no `entity.default.<kind>` string fall
 * back to the registry, so partial locale coverage stays consistent rather than divergent.
 */
export function localizedDefaultName(kind: EntityKind): string {
	const key = `entity.default.${kind}`;
	return hasKey(key) ? t(key) : getKindSpec(kind).defaultName;
}

export async function createEntityFile(
	app: App,
	projectRoot: string,
	kind: EntityKind,
	name: string,
	fields: CharacterField[],
	aliases?: string[],
	cleanSlate?: boolean
): Promise<TFile> {
	const spec = getKindSpec(kind);
	const folder = entityFolderPath(projectRoot, kind);
	const safeName = name.trim().replace(/[\\/:*?"<>|#^[\]]/g, '-') || localizedDefaultName(kind);

	if (!(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
		await app.vault.createFolder(folder);
	}

	let filePath = `${folder}/${safeName}.md`;
	let counter = 2;
	while (app.vault.getAbstractFileByPath(filePath)) {
		filePath = `${folder}/${safeName} ${counter}.md`;
		counter++;
	}

	return createEntitySheet(app, filePath, kind, name, fields, { aliases, cleanSlate });
}
