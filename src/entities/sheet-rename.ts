import type { App, TFile } from 'obsidian';
import { parseEntityDocument } from './entity-parse';
import { retitleEntitySheet } from './entity-write';
import { resolveCase } from './sheet-images';

/** The file name a sheet title gets: the characters a file name cannot hold become `-`. */
export function sheetFileName(name: string): string {
	return name.trim().replace(/[\\/:*?"<>|#^[\]]/g, '-');
}

/** Where a sheet called `name` would live, next to `file`. */
export function sheetPathFor(file: TFile, name: string): string {
	const dir = file.parent?.path ?? '';
	const base = `${sheetFileName(name)}.md`;
	return !dir || dir === '/' ? base : `${dir}/${base}`;
}

/**
 * Whether another file already holds the name `name` next to `file` (ignoring
 * case, as Windows and macOS do). The sheet's own file never counts, so a
 * capitals-only rename is allowed.
 */
export function sheetNameTaken(app: App, file: TFile, name: string): boolean {
	const target = resolveCase(app, sheetPathFor(file, name));
	return target.toLowerCase() !== file.path.toLowerCase() && !!app.vault.getAbstractFileByPath(target);
}

/**
 * Rename a sheet: title and file together, or neither. A name another sheet
 * already has changes nothing and returns 'taken'. If the file rename fails
 * after the title changed, the title is put back before the error goes on.
 */
export async function renameEntitySheet(app: App, file: TFile, name: string): Promise<'renamed' | 'taken'> {
	if (sheetNameTaken(app, file, name)) return 'taken';
	const newPath = sheetPathFor(file, name);
	const before = await app.vault.read(file);
	const hadTitle = /^#[ \t]+\S/m.test(before);
	const oldTitle = parseEntityDocument(before, file.basename).name;
	await retitleEntitySheet(app, file, name);
	if (newPath === file.path) return 'renamed';
	try {
		await app.fileManager.renameFile(file, newPath);
	} catch (err) {
		// The file did move (a later step failed): the new title is right, keep it.
		if (file.path === newPath) return 'renamed';
		// Put the old title back, unless the sheet had none to begin with.
		if (hadTitle) {
			try { await retitleEntitySheet(app, file, oldTitle); } catch { /* the rename error below is what the writer needs */ }
		}
		throw err;
	}
	return 'renamed';
}
