/**
 * Where a Codex sheet's pictures live, as pure path logic (no Obsidian
 * imports, unit-tested). Every sheet gets its own folder:
 *
 *   <Project root>/<Images folder>/<Kind folder>/<Sheet file name>/
 *   e.g. Saltmarch/Images/Characters/Mara Ferrow/
 *
 * The sheet's FILE name (not its title) names the folder, so the folder can
 * always be found again from the sheet's path alone — that is what lets a
 * rename or a move bring the folder along.
 */

export const DEFAULT_IMAGES_FOLDER = 'Images';

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] as const;

/** Characters Obsidian (or Windows/iOS file systems) refuse in a file or folder name. */
const FORBIDDEN_CHARS = /[\\/:*?"<>|#^[\]]/g;
/** ASCII control characters (0-31 and 127), checked by char code. */
const isControlChar = (ch: string): boolean => ch.charCodeAt(0) <= 0x1f || ch.charCodeAt(0) === 0x7f;
/** Names Windows will not create, with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Make one path segment safe: no slashes (so a name can never climb out of
 * its folder), no characters Obsidian rejects, no leading dots (hidden
 * folders, `..`), no trailing dots or spaces (Windows drops them silently).
 */
export function safePathSegment(name: string, fallback: string): string {
	let s = Array.from(name ?? '', (ch) => (isControlChar(ch) ? '-' : ch)).join('').replace(FORBIDDEN_CHARS, '-').replace(/\s+/g, ' ').trim();
	s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
	if (!s || /^-+$/.test(s)) s = fallback;
	if (WINDOWS_RESERVED.test(s)) s = `${s}_`;
	return s;
}

/** Join vault path segments, dropping empty ones ('' = vault root). */
export function joinVaultPath(...parts: string[]): string {
	return parts.filter((p) => p !== '').join('/');
}

/** Joins a sheet's sub-folders and name into one folder name. */
export const SUBFOLDER_JOINER = ' › ';

/**
 * The folder that holds every picture of one sheet. `subfolders` are the
 * folders between the kind's folder and the sheet (a scene in
 * `Scenes/Chapter 1/`). They become part of ONE folder name
 * (`Chapter 1 › Opening`), never nested folders: a sheet's picture folder
 * must never sit inside another sheet's (`Sweden.md` next to
 * `Sweden/Gothenburg.md`), or deleting one would take the other's pictures.
 */
export function sheetImageFolder(
	projectRoot: string,
	imagesFolderName: string,
	kindFolderName: string,
	sheetName: string,
	subfolders: readonly string[] = [],
): string {
	return joinVaultPath(
		projectRoot,
		safePathSegment(imagesFolderName, DEFAULT_IMAGES_FOLDER),
		safePathSegment(kindFolderName, 'Other'),
		[...subfolders, sheetName].map((s) => safePathSegment(s, 'Untitled')).join(SUBFOLDER_JOINER),
	);
}

/** Is `path` directly inside `folder` (not deeper)? Case-insensitive, like the disks Obsidian runs on. */
export function isDirectChild(path: string, folder: string): boolean {
	const slash = path.lastIndexOf('/');
	return (slash === -1 ? '' : path.slice(0, slash)).toLowerCase() === folder.toLowerCase();
}

/** Split `photo.final.PNG` into `photo.final` + `PNG` (no extension → ''). */
export function splitExtension(fileName: string): { base: string; ext: string } {
	const dot = fileName.lastIndexOf('.');
	if (dot <= 0 || dot === fileName.length - 1) return { base: fileName, ext: '' };
	return { base: fileName.slice(0, dot), ext: fileName.slice(dot + 1) };
}

export function isImageExtension(ext: string): boolean {
	return (IMAGE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export function isImagePath(path: string): boolean {
	return isImageExtension(splitExtension(path.split('/').pop() ?? '').ext);
}

/** The extension a pasted picture with no usable name should get, from its type. */
export function extensionForMime(mime: string): string {
	const sub = (mime.split('/')[1] ?? '').toLowerCase();
	if (sub === 'jpeg' || sub === 'pjpeg') return 'jpg';
	if (sub === 'svg+xml') return 'svg';
	return isImageExtension(sub) ? sub : 'png';
}

/**
 * A safe file name for an incoming picture. Phones paste every picture as
 * `image.png`, so a missing or generic name falls back to `fallbackBase`
 * (the sheet's name) — `Mara Ferrow.png` reads better in the folder.
 */
export function safeImageFileName(fileName: string, mime: string, fallbackBase: string): string {
	const { base, ext } = splitExtension((fileName ?? '').split(/[\\/]/).pop() ?? '');
	const cleanExt = isImageExtension(ext) ? ext.toLowerCase() : extensionForMime(mime);
	const generic = !base.trim() || /^image$/i.test(base.trim());
	const cleanBase = safePathSegment(generic ? fallbackBase : base, 'image');
	return `${cleanBase}.${cleanExt}`;
}

/**
 * First free path for `fileName` inside `folder`: `name.png`, then
 * `name 2.png`, `name 3.png`… `exists` must answer case-insensitively on
 * case-insensitive disks — callers pass a check that does.
 */
export function uniqueChildPath(folder: string, fileName: string, exists: (path: string) => boolean): string {
	const { base, ext } = splitExtension(fileName);
	const suffix = ext ? `.${ext}` : '';
	let candidate = joinVaultPath(folder, `${base}${suffix}`);
	for (let n = 2; exists(candidate); n++) {
		candidate = joinVaultPath(folder, `${base} ${n}${suffix}`);
	}
	return candidate;
}

/** Is `path` inside `folder` (at any depth)? Case-insensitive, like the disks Obsidian runs on. */
export function isInsideFolder(path: string, folder: string): boolean {
	if (!folder) return true;
	return path.toLowerCase().startsWith(`${folder.toLowerCase()}/`);
}

// ─── Gallery planning ─────────────────────────────────────────────────────────

/**
 * The gallery's order: the sheet's embedded pictures first, in the order the
 * sheet shows them (so the first is the portrait), then everything else in
 * the sheet's folder by name. Each picture once.
 */
export function galleryOrder(embedded: readonly string[], inFolder: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const p of [...embedded, ...[...inFolder].sort((a, b) => a.localeCompare(b))]) {
		if (!p || seen.has(p)) continue;
		seen.add(p);
		out.push(p);
	}
	return out;
}

/**
 * The sheet's image embeds after "Use as portrait". `current` is the sheet's
 * embedded pictures in order (resolved paths; the raw link text for one
 * that no longer resolves, so it is kept, never blanked). Nothing is ever dropped: an old portrait that lives outside the
 * sheet's folder stays on the sheet as a second picture, because otherwise it
 * would vanish from the gallery.
 */
export function planPortrait(current: readonly string[], chosen: string, oldPortraitIsInFolder: boolean): string[] {
	const idx = current.indexOf(chosen);
	if (idx === 0) return [...current];
	if (idx > 0) {
		const next = [...current];
		next[idx] = current[0];
		next[0] = chosen;
		return next;
	}
	if (current.length === 0) return [chosen];
	if (oldPortraitIsInFolder) return [chosen, ...current.slice(1)];
	return [chosen, ...current];
}
