import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { EntityKind, getCodexKindOrder, getKindSpec, hasKind } from './entity-kinds';
import { CODEX_FOLDER, entityFolderPath } from './entity-manager';
import { parseEntityDocument } from './entity-parse';
import { writeSheetImages } from './entity-write';
import {
	DEFAULT_IMAGES_FOLDER,
	galleryOrder,
	isDirectChild,
	isImagePath,
	isInsideFolder,
	joinVaultPath,
	planPortrait,
	safeImageFileName,
	safePathSegment,
	sheetImageFolder,
	uniqueChildPath,
} from './sheet-images-path';

/**
 * Obsidian half of "one image folder per Codex sheet". The path rules live in
 * `sheet-images-path.ts` (pure, tested); this file touches the vault.
 *
 * Every picture the plugin imports goes through `saveImageForSheet`, so the
 * "Where images go" setting is honoured in exactly one place.
 *
 * Safety rules every action here keeps:
 *  - Only pictures DIRECTLY inside a sheet's own folder count as its own.
 *  - A picture another note links to is never trashed, only taken off the sheet.
 *  - Folders are looked up ignoring capitals (Windows, macOS and iOS disks do).
 */

export type ImageLocation = 'per-sheet' | 'obsidian';

interface ImageConfig {
	location: () => ImageLocation;
	folderName: () => string;
	/** The project a vault path belongs to, or null (see `EntityIndex.rootFor`). */
	rootFor: (path: string) => string | null;
}

let config: ImageConfig = {
	location: () => 'per-sheet',
	folderName: () => DEFAULT_IMAGES_FOLDER,
	rootFor: () => null,
};

/** Called once from the plugin's onload so every caller sees live settings. */
export function configureSheetImages(next: ImageConfig): void {
	config = next;
}

/** Who a picture is for: a sheet that may not exist on disk yet. */
export interface SheetImageTarget {
	projectRoot: string | null;
	kind: EntityKind;
	/** The sheet's file name (no `.md`), which names its folder. */
	sheetName: string;
	/** The sheet's own picture folder, when already known (an existing sheet, sub-folders included). */
	folder?: string;
	/** The sheet's path (or the path it will get) — lets "Follow Obsidian" use "same folder as the note". */
	sourcePath?: string;
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

/** The folder at `path` ('' = the vault root), or null. */
function folderAt(app: App, path: string): TFolder | null {
	const f = path ? app.vault.getAbstractFileByPath(path) : app.vault.getRoot();
	return f instanceof TFolder ? f : null;
}

/**
 * `path` with each part that already exists spelled the way it is on disk
 * ("images/characters/mara" → "Images/Characters/Mara" when those exist).
 * Parts that do not exist yet are kept as given.
 */
export function resolveCase(app: App, path: string): string {
	let current = '';
	const parts = path.split('/').filter(Boolean);
	for (let i = 0; i < parts.length; i++) {
		const wanted = joinVaultPath(current, parts[i]);
		const exact = app.vault.getAbstractFileByPath(wanted);
		const match = exact ?? folderAt(app, current)?.children.find((c) => c.path.toLowerCase() === wanted.toLowerCase()) ?? null;
		if (!match) return joinVaultPath(current, ...parts.slice(i));
		current = match.path;
	}
	return current;
}

/** Does anything live at `path`, ignoring case? */
export function existsIgnoringCase(app: App, path: string): boolean {
	return !!app.vault.getAbstractFileByPath(resolveCase(app, path));
}

function linkPath(raw: string): string {
	return raw.split('|')[0].split('#')[0].trim();
}

function kindFromFrontmatter(app: App, file: TFile): EntityKind | null {
	const v = app.metadataCache.getFileCache(file)?.frontmatter?.['storygrid-type'];
	return typeof v === 'string' && hasKind(v) ? (v as EntityKind) : null;
}

/**
 * The kind a sheet at `path` counts as: its own `storygrid-type`, else the
 * kind whose folder holds it. `path` can be an OLD path (after a rename the
 * file's frontmatter is unchanged, but the folder it came from may differ).
 */
function kindAtPath(app: App, file: TFile, path: string): EntityKind | null {
	const fm = kindFromFrontmatter(app, file);
	if (fm) return fm;
	const slash = path.lastIndexOf('/');
	const parent = slash === -1 ? '' : path.slice(0, slash);
	for (const kind of getCodexKindOrder()) {
		const folder = entityFolderPath('', kind);
		if (parent === folder || parent.endsWith(`/${folder}`)) return kind;
	}
	return null;
}

function basenameOf(path: string): string {
	const name = path.split('/').pop() ?? '';
	return name.endsWith('.md') ? name.slice(0, -3) : name;
}

function parentOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

export function imageFolderFor(projectRoot: string, kind: EntityKind, sheetName: string, subfolders: readonly string[] = []): string {
	return sheetImageFolder(projectRoot, config.folderName(), getKindSpec(kind).folderName, sheetName, subfolders);
}

/** The folder a sheet at `atPath` would use, spelled as computed (not looked up on disk). */
function computedImageFolder(app: App, file: TFile, atPath: string): string | null {
	if (!atPath.endsWith('.md')) return null;
	const root = config.rootFor(atPath);
	const kind = kindAtPath(app, file, atPath);
	if (root === null || !kind) return null;
	// A sheet in a sub-folder of its kind's folder keeps that sub-folder in its folder name.
	const parent = parentOf(atPath);
	const kindFolder = entityFolderPath(root, kind);
	const subfolders = parent.toLowerCase().startsWith(`${kindFolder.toLowerCase()}/`)
		? parent.slice(kindFolder.length + 1).split('/').filter(Boolean)
		: [];
	return imageFolderFor(root, kind, basenameOf(atPath), subfolders);
}

/**
 * The picture folder of the sheet `file` (or of where it used to be,
 * `atPath`), spelled the way it exists on disk. Null when it is not a
 * project sheet.
 */
export function imageFolderForSheet(app: App, file: TFile, atPath: string = file.path): string | null {
	const computed = computedImageFolder(app, file, atPath);
	return computed === null ? null : resolveCase(app, computed);
}

/** An existing sheet, as the place a new picture is for. */
export function targetForSheet(app: App, sheet: TFile): SheetImageTarget | null {
	const kind = kindAtPath(app, sheet, sheet.path);
	if (!kind) return null;
	return {
		projectRoot: config.rootFor(sheet.path),
		kind,
		sheetName: sheet.basename,
		folder: imageFolderForSheet(app, sheet) ?? undefined,
		sourcePath: sheet.path,
	};
}

/** The pictures directly inside a folder (never another sheet's, never deeper). */
export function imagesInFolder(app: App, folderPath: string | null): TFile[] {
	if (folderPath === null) return [];
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) return [];
	return folder.children.filter((f): f is TFile => f instanceof TFile && isImagePath(f.path));
}

/** Whether a picture sits directly in the sheet's own folder. */
export function isSheetOwnImage(app: App, sheet: TFile, image: TFile): boolean {
	const folder = imageFolderForSheet(app, sheet);
	return !!folder && isDirectChild(image.path, folder);
}

/**
 * Does anything other than `except` use `image`? Notes (Obsidian's link
 * index) and the files that index never reads: canvases, grids and
 * timelines, which name pictures by path.
 */
export async function usedElsewhere(app: App, image: TFile, except: string): Promise<boolean> {
	const resolved = app.metadataCache.resolvedLinks ?? {};
	for (const [source, targets] of Object.entries(resolved)) {
		if (source !== except && targets && targets[image.path]) return true;
	}
	const quoted = JSON.stringify(image.path);
	for (const f of app.vault.getFiles()) {
		if (f.path === except || !['canvas', 'storygrid', 'timeline'].includes(f.extension)) continue;
		try {
			if ((await app.vault.cachedRead(f)).includes(quoted)) return true;
		} catch { /* unreadable: ignore */ }
	}
	return false;
}

/** The sheet's portrait slots, as the sheet editor reads them: raw link text + the file each one opens. */
async function readPortraitSlots(app: App, sheet: TFile): Promise<Array<{ raw: string; file: TFile | null }>> {
	const content = await app.vault.read(sheet);
	return parseEntityDocument(content, sheet.basename).fields
		.filter((f) => f.type === 'image')
		.map((f) => {
			const dest = app.metadataCache.getFirstLinkpathDest(linkPath(f.value), sheet.path);
			return { raw: f.value, file: dest instanceof TFile ? dest : null };
		});
}

/** How many times the sheet embeds `image` anywhere (picture lines and writing alike). */
function embedCount(app: App, sheet: TFile, image: TFile): number {
	return (app.metadataCache.getFileCache(sheet)?.embeds ?? [])
		.filter((e) => app.metadataCache.getFirstLinkpathDest(linkPath(e.link), sheet.path)?.path === image.path)
		.length;
}

/**
 * The sheet's gallery: its picture slots first (the first is the portrait),
 * then any other picture embedded in the sheet, then the rest of its folder.
 */
export async function listSheetImages(app: App, sheet: TFile): Promise<{ images: TFile[]; folder: string | null; portrait: TFile | null }> {
	const folder = imageFolderForSheet(app, sheet);
	const slots = await readPortraitSlots(app, sheet);
	const embedded: string[] = slots.map((s) => s.file?.path ?? '').filter((p) => p && isImagePath(p));
	for (const e of app.metadataCache.getFileCache(sheet)?.embeds ?? []) {
		const dest = app.metadataCache.getFirstLinkpathDest(linkPath(e.link), sheet.path);
		if (dest instanceof TFile && isImagePath(dest.path)) embedded.push(dest.path);
	}
	const order = galleryOrder(embedded, imagesInFolder(app, folder).map((f) => f.path));
	const images = order
		.map((p) => app.vault.getAbstractFileByPath(p))
		.filter((f): f is TFile => f instanceof TFile);
	const first = slots[0]?.file ?? null;
	return { images, folder, portrait: first && isImagePath(first.path) ? first : null };
}

// ─── Saving ───────────────────────────────────────────────────────────────────

/**
 * Create every missing folder along `path`. A folder that already exists with
 * different capitals is reused as it is (two "Images" folders that differ
 * only by case cannot both exist on most disks). Returns the real path.
 */
export async function ensureFolder(app: App, path: string): Promise<string> {
	let current = '';
	for (const segment of path.split('/').filter(Boolean)) {
		const wanted = joinVaultPath(current, segment);
		const exact = app.vault.getAbstractFileByPath(wanted);
		const match = exact ?? folderAt(app, current)?.children.find((c) => c.path.toLowerCase() === wanted.toLowerCase()) ?? null;
		if (match instanceof TFolder) { current = match.path; continue; }
		if (match) throw new Error(`“${match.path}” is a file, not a folder`);
		await app.vault.createFolder(wanted);
		current = wanted;
	}
	return current;
}

/**
 * Save an incoming picture (file picker, drop, or paste) and return the new
 * file. "A folder per sheet" puts it in the sheet's folder; "Follow
 * Obsidian" — or a sheet that belongs to no project — uses Obsidian's own
 * "Default location for new attachments".
 */
export async function saveImageForSheet(app: App, file: File, target: SheetImageTarget | null): Promise<TFile> {
	const buf = await file.arrayBuffer();
	let path: string;
	if (config.location() === 'per-sheet' && target && target.projectRoot !== null) {
		const folder = await ensureFolder(app, target.folder ?? imageFolderFor(target.projectRoot, target.kind, target.sheetName));
		const name = safeImageFileName(file.name, file.type, target.sheetName || 'image');
		path = uniqueChildPath(folder, name, (p) => existsIgnoringCase(app, p));
	} else {
		const name = safeImageFileName(file.name, file.type, target?.sheetName || 'image');
		const fm = app.fileManager as unknown as {
			getAvailablePathForAttachment?: (name: string, sourcePath?: string) => Promise<string>;
		};
		const suggested = fm.getAvailablePathForAttachment
			? await fm.getAvailablePathForAttachment(name, target?.sourcePath)
			: name;
		const slash = suggested.lastIndexOf('/');
		// Obsidian may suggest a folder that does not exist yet.
		const folder = slash === -1 ? '' : await ensureFolder(app, suggested.slice(0, slash));
		path = uniqueChildPath(folder, suggested.slice(slash + 1), (p) => existsIgnoringCase(app, p));
	}
	return app.vault.createBinary(path, buf);
}

/**
 * After a NEW sheet is saved, move the pictures added while it was being
 * written into its folder. The name typed at upload time can differ from the
 * file name the sheet finally got ("Mara" → "Mara 2"), and "Follow Obsidian"
 * uploads stay where Obsidian put them.
 */
export async function adoptImagesIntoSheetFolder(app: App, sheet: TFile, uploaded: readonly TFile[]): Promise<void> {
	if (config.location() !== 'per-sheet') return;
	const target = imageFolderForSheet(app, sheet);
	if (!target) return;
	const leftBehind = new Set<TFolder>();
	for (const img of uploaded) {
		if (!app.vault.getAbstractFileByPath(img.path)) continue; // removed meanwhile
		if (isDirectChild(img.path, target)) continue;
		const folder = await ensureFolder(app, target);
		if (img.parent) leftBehind.add(img.parent);
		await app.fileManager.renameFile(img, uniqueChildPath(folder, img.name, (p) => existsIgnoringCase(app, p)));
	}
	// A folder the typed name created and nothing else uses goes quietly.
	const imagesRoot = joinVaultPath(config.rootFor(sheet.path) ?? '', safePathSegment(config.folderName(), DEFAULT_IMAGES_FOLDER));
	for (const f of leftBehind) {
		if (f.children.length === 0 && isInsideFolder(f.path, imagesRoot)) await app.fileManager.trashFile(f);
	}
}

// ─── Following a sheet ──────────────────────────────────────────────────────

/** Obsidian's "Automatically update internal links" (a private setting); false only when switched off. */
function linksAutoUpdate(app: App): boolean {
	const getConfig = (app.vault as unknown as { getConfig?: (key: string) => unknown }).getConfig;
	return getConfig?.call(app.vault, 'alwaysUpdateLinks') !== false;
}

/** Move a picture folder (or file) through Obsidian, so links to it follow. */
async function moveWithLinks(app: App, item: TAbstractFile, to: string, sheet: TFile): Promise<void> {
	const from = item.path;
	await app.fileManager.renameFile(item, to);
	// With Obsidian's link updating switched off, at least the sheet's own
	// picture lines keep working.
	if (!linksAutoUpdate(app)) {
		await app.vault.process(sheet, (c) => c.split(`[[${from}/`).join(`[[${to}/`).split(`[[${from}]]`).join(`[[${to}]]`).split(`[[${from}|`).join(`[[${to}|`));
	}
}

/**
 * A sheet was renamed or moved: bring its picture folder along. Uses
 * `fileManager.renameFile`, so Obsidian rewrites every link to the pictures.
 * Never overwrites: if the new folder already exists, pictures move in one by
 * one under free names.
 */
export async function followSheetRename(app: App, sheet: TFile, oldPath: string): Promise<void> {
	const from = imageFolderForSheet(app, sheet, oldPath);
	const computedTo = computedImageFolder(app, sheet, sheet.path);
	if (!from || !computedTo) return;
	const source = app.vault.getAbstractFileByPath(from);
	if (!(source instanceof TFolder)) return;

	const slash = computedTo.lastIndexOf('/');
	const parent = await ensureFolder(app, slash === -1 ? '' : computedTo.slice(0, slash));
	const dest = joinVaultPath(parent, computedTo.slice(slash + 1));
	if (dest === from) return;

	if (dest.toLowerCase() === from.toLowerCase()) {
		// Case-insensitive disks see "mara" and "Mara" as the same folder, so
		// step through a temporary name.
		const temp = uniqueChildPath(parent, `${computedTo.slice(slash + 1)} (renaming)`, (p) => existsIgnoringCase(app, p));
		await moveWithLinks(app, source, temp, sheet);
		await moveWithLinks(app, source, dest, sheet);
		return;
	}
	if (!existsIgnoringCase(app, dest)) {
		await moveWithLinks(app, source, dest, sheet);
		return;
	}
	const into = await ensureFolder(app, dest);
	for (const child of [...source.children]) {
		await moveWithLinks(app, child, uniqueChildPath(into, child.name, (p) => existsIgnoringCase(app, p)), sheet);
	}
	if (source.children.length === 0) await app.fileManager.trashFile(source);
}

/**
 * Should a rename of `file` (from `oldPath`) bring its pictures along?
 * Not when a whole PROJECT folder was renamed or moved: its Images folder
 * already travelled with it, and the old path would now point into a
 * different project. Any other move — the sheet itself, or a sub-folder of
 * sheets, even into another project — is followed.
 */
export function shouldFollowRename(app: App, file: TFile, oldPath: string): boolean {
	if (app.vault.getAbstractFileByPath(parentOf(oldPath))) return true; // the sheet moved on its own
	const newRoot = config.rootFor(file.path);
	if (newRoot === null) return false;
	const rel = newRoot ? file.path.slice(newRoot.length + 1) : file.path;
	// Same place inside its project as before, and the old project folder is gone: the project moved.
	if (oldPath === rel || oldPath.endsWith(`/${rel}`)) {
		const oldRoot = oldPath === rel ? '' : oldPath.slice(0, oldPath.length - rel.length - 1);
		if (oldRoot !== newRoot && !app.vault.getAbstractFileByPath(oldRoot)) return false;
	}
	return true;
}

// ─── Deleting a sheet ─────────────────────────────────────────────────────────

/**
 * What deleting a sheet would do to its pictures: those in its own folder
 * that no other note uses can go to the trash; the rest always stay.
 */
export async function sheetDeletePlan(app: App, sheet: TFile): Promise<{ folder: TFolder | null; trashable: TFile[] }> {
	const path = imageFolderForSheet(app, sheet);
	const folder = path ? app.vault.getAbstractFileByPath(path) : null;
	if (!(folder instanceof TFolder)) return { folder: null, trashable: [] };
	const trashable: TFile[] = [];
	for (const img of imagesInFolder(app, folder.path)) {
		if (!(await usedElsewhere(app, img, sheet.path))) trashable.push(img);
	}
	return { folder, trashable };
}

/**
 * Trash a sheet, and (when asked) the pictures of its own folder that no
 * other note uses. Whatever stays behind is renamed "<name> (kept)", so a
 * new sheet with the same name does not inherit it.
 */
export async function trashSheet(app: App, sheet: TFile, withImages: boolean): Promise<void> {
	const { folder, trashable } = await sheetDeletePlan(app, sheet);
	if (folder && withImages) for (const img of trashable) await app.fileManager.trashFile(img);
	// Rename what stays BEFORE the sheet goes, while Obsidian still updates
	// its links — so a sheet restored from the trash still shows its pictures.
	if (folder && folder.children.length > 0) {
		await app.fileManager.renameFile(folder, uniqueChildPath(parentOf(folder.path), `${folder.name} (kept)`, (p) => existsIgnoringCase(app, p)));
	}
	await app.fileManager.trashFile(sheet);
	if (folder && folder.children.length === 0) await app.fileManager.trashFile(folder);
}

// ─── Gallery actions ──────────────────────────────────────────────────────────

/** Make `image` the sheet's portrait (its first picture). Nothing else on the sheet changes. */
export async function useAsPortrait(app: App, sheet: TFile, image: TFile): Promise<void> {
	const folder = imageFolderForSheet(app, sheet);
	await app.vault.process(sheet, (content) => {
		const parsed = parseEntityDocument(content, sheet.basename);
		const kind = parsed.kind ?? kindAtPath(app, sheet, sheet.path) ?? 'character';
		const raws = parsed.fields.filter((f) => f.type === 'image').map((f) => f.value);
		// Plan on resolved paths, write the original link text for the slots that stay.
		const keyOf = (raw: string) => {
			const dest = app.metadataCache.getFirstLinkpathDest(linkPath(raw), sheet.path);
			return dest instanceof TFile ? dest.path : raw;
		};
		const keys = raws.map(keyOf);
		const oldIsInFolder = !!folder && keys.length > 0 && isDirectChild(keys[0], folder);
		const planned = planPortrait(keys, image.path, oldIsInFolder);
		const rawFor = (key: string) => {
			const i = keys.indexOf(key);
			return i >= 0 ? raws[i] : image.path;
		};
		// Old slots the plan dropped (a replaced in-folder portrait) become '' so their line goes.
		const next = planned.map(rawFor);
		while (next.length < raws.length) next.push('');
		return writeSheetImages(content, kind, next);
	});
}

/**
 * Put a picture on the sheet as its last picture line. Used for a picture
 * saved outside the sheet's folder ("Follow Obsidian"), which the gallery
 * would otherwise not know belongs to this sheet.
 */
export async function appendSheetImage(app: App, sheet: TFile, image: TFile): Promise<void> {
	await app.vault.process(sheet, (content) => {
		const parsed = parseEntityDocument(content, sheet.basename);
		const kind = parsed.kind ?? kindAtPath(app, sheet, sheet.path) ?? 'character';
		const raws = parsed.fields.filter((f) => f.type === 'image').map((f) => f.value);
		return writeSheetImages(content, kind, [...raws, image.path]);
	});
}

/**
 * What "Remove" would do to a picture in the gallery:
 *  - 'trash': it is the sheet's own and nothing else uses it — off the sheet and into the trash;
 *  - 'unlink': it is one of the sheet's picture lines — taken off the sheet, the file stays;
 *  - null: it only appears inside the sheet's writing, so Remove is not offered.
 */
export async function removalFor(app: App, sheet: TFile, image: TFile): Promise<'trash' | 'unlink' | null> {
	const slots = await readPortraitSlots(app, sheet);
	const inSlots = slots.filter((s) => s.file?.path === image.path).length;
	const inWriting = embedCount(app, sheet, image) > inSlots;
	if (isSheetOwnImage(app, sheet, image) && !inWriting && !(await usedElsewhere(app, image, sheet.path))) return 'trash';
	return inSlots > 0 ? 'unlink' : null;
}

/** Carry out {@link removalFor}'s answer. */
export async function removeSheetImage(app: App, sheet: TFile, image: TFile, how: 'trash' | 'unlink'): Promise<void> {
	await app.vault.process(sheet, (content) => {
		const parsed = parseEntityDocument(content, sheet.basename);
		const kind = parsed.kind ?? kindAtPath(app, sheet, sheet.path) ?? 'character';
		const raws = parsed.fields.filter((f) => f.type === 'image').map((f) => f.value);
		const next = raws.map((raw) => {
			const dest = app.metadataCache.getFirstLinkpathDest(linkPath(raw), sheet.path);
			return dest instanceof TFile && dest.path === image.path ? '' : raw;
		});
		return next.some((v, i) => v !== raws[i]) ? writeSheetImages(content, kind, next) : content;
	});
	if (how === 'trash') await app.fileManager.trashFile(image);
}

// ─── The Images folder name setting ──────────────────────────────────────────

/** Why a name cannot be the Images folder (it would mix pictures into sheet folders), or null when it is fine. */
export function imagesFolderNameProblem(name: string): string | null {
	const clean = safePathSegment(name, '');
	if (!clean) return 'empty';
	const taken = [CODEX_FOLDER, ...getCodexKindOrder().map((k) => getKindSpec(k).folderName)].map((n) => n.toLowerCase());
	return taken.includes(clean.toLowerCase()) ? 'taken' : null;
}

/**
 * Rename every project's Images folder when the setting changes, so no
 * sheet loses its pictures. All or nothing: if any project already has a
 * folder with the new name, nothing is renamed and those folders are
 * returned as `blocked`; if a rename fails part-way, the ones already done
 * are put back and the error is passed on. The caller keeps the old setting
 * in both cases.
 */
export async function renameImagesFolders(app: App, roots: readonly string[], from: string, to: string): Promise<{ moved: number; blocked: string[] }> {
	const oldName = safePathSegment(from, DEFAULT_IMAGES_FOLDER);
	const newName = safePathSegment(to, DEFAULT_IMAGES_FOLDER);
	if (oldName === newName) return { moved: 0, blocked: [] };
	const caseOnly = oldName.toLowerCase() === newName.toLowerCase();
	const plan: Array<{ source: TFolder; root: string; before: string; dest: string }> = [];
	const blocked: string[] = [];
	for (const root of new Set(roots)) {
		const source = app.vault.getAbstractFileByPath(resolveCase(app, joinVaultPath(root, oldName)));
		if (!(source instanceof TFolder)) continue;
		const dest = joinVaultPath(root, newName);
		if (!caseOnly && existsIgnoringCase(app, dest)) blocked.push(dest);
		else plan.push({ source, root, before: source.path, dest });
	}
	if (blocked.length > 0) return { moved: 0, blocked };
	const done: typeof plan = [];
	try {
		for (const step of plan) {
			if (caseOnly) {
				const temp = uniqueChildPath(step.root, `${newName} (renaming)`, (p) => existsIgnoringCase(app, p));
				await app.fileManager.renameFile(step.source, temp);
			}
			await app.fileManager.renameFile(step.source, step.dest);
			done.push(step);
		}
	} catch (err) {
		for (const step of done.reverse()) {
			try { await app.fileManager.renameFile(step.source, step.before); } catch { /* best effort */ }
		}
		throw err;
	}
	return { moved: done.length, blocked: [] };
}

/** Pictures in a paste or drop, with a usable name. */
export function imagesFromDataTransfer(data: DataTransfer | null): File[] {
	if (!data) return [];
	const out: File[] = [];
	for (const f of Array.from(data.files ?? [])) if (f.type.startsWith('image/')) out.push(f);
	if (out.length === 0) {
		for (const item of Array.from(data.items ?? [])) {
			if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
			const f = item.getAsFile();
			if (f) out.push(f);
		}
	}
	return out;
}
