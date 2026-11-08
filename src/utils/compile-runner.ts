import { App, Notice, TFile } from 'obsidian';
import { openOrReveal } from './workspace';
import {
	stripFrontmatter,
	countWords,
	assembleManuscript,
	ManuscriptItem,
	ManuscriptOptions,
	DEFAULT_MANUSCRIPT_OPTIONS,
} from './compile';
import { SceneTree, flattenTree } from './scene-tree';
import { buildDocx, DocxOptions } from './docx';
import { buildEpub, chaptersFromItems, EpubCover } from './epub';
import { ConfirmModal } from '../modals/prompt-modal';
import { writeSceneSnapshot } from './scene-snapshots';

/**
 * Obsidian-coupled compile pipeline, driven by the Writers Panel outline tree
 * (scene documents + dividers). The pure ordering/assembly logic lives in
 * `compile.ts`; this module handles vault reads/writes and user feedback.
 *
 * The manuscript order the writer arranges in the Writing tab IS the compile
 * order — there is no separate grid-card walk. Divider rows become headings;
 * doc rows become scenes read from disk.
 */

export type WordCountCache = Map<string, { mtime: number; words: number }>;

/** Word count of a markdown doc, cached until the file's mtime changes. */
export async function docWordCount(
	app: App,
	path: string,
	cache: WordCountCache
): Promise<number | null> {
	const f = app.vault.getAbstractFileByPath(path);
	if (!(f instanceof TFile) || f.extension !== 'md') return null;
	const cached = cache.get(path);
	if (cached && cached.mtime === f.stat.mtime) return cached.words;
	try {
		const words = countWords(stripFrontmatter(await app.vault.read(f)));
		cache.set(path, { mtime: f.stat.mtime, words });
		return words;
	} catch {
		return null;
	}
}

/**
 * Flatten the outline tree into ordered manuscript items. Dividers become
 * headings; doc nodes become scenes whose text is the file body read from the
 * vault (raw — the "Remove document properties" step decides on frontmatter).
 * Excluded doc paths and docs missing from disk are skipped. This runs on every
 * render of the Compile tab, so it must stay read-only — snapshots are written
 * by `snapshotCompiledScenes` at export time instead.
 */
export async function gatherManuscript(
	app: App,
	tree: SceneTree,
	excluded: Set<string> = new Set()
): Promise<ManuscriptItem[]> {
	const items: ManuscriptItem[] = [];
	for (const flat of flattenTree(tree)) {
		const { node, depth, number } = flat;
		if (node.kind === 'divider') {
			items.push({ kind: 'heading', depth, number, label: node.label ?? '' });
			continue;
		}
		const path = node.docPath;
		if (!path || excluded.has(path)) continue;
		const f = app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) continue; // vanished from disk — drop silently
		let text = '';
		try {
			text = (await app.vault.read(f)).trim();
		} catch {
			continue;
		}
		items.push({ kind: 'scene', depth, number, title: f.basename, docPath: path, text });
	}
	return items;
}

/**
 * Write a `'compile'` scene snapshot for every scene in an export. Only real
 * exports may call this: the per-scene snapshot cap would otherwise prune away
 * genuine daily/manual history, because the Compile tab re-renders on every
 * autosave.
 */
export async function snapshotCompiledScenes(app: App, items: ManuscriptItem[]): Promise<void> {
	for (const item of items) {
		if (item.kind !== 'scene') continue;
		try {
			await writeSceneSnapshot(app, item.docPath, item.text, 'compile');
		} catch {
			// A snapshot failure must never block the export itself
		}
	}
}

/** Are there any scene documents in the tree at all (headings alone don't count)? */
export function treeHasScenes(tree: SceneTree): boolean {
	return flattenTree(tree).some((f) => f.node.kind === 'doc' && !!f.node.docPath);
}

/** Default manuscript file name (without extension) for a project. */
export function defaultManuscriptName(name: string): string {
	return `${name.replace(/[\\/:*?"<>|]/g, '-')} - Manuscript`;
}

/**
 * Manuscript output path next to the grid file, with the given extension.
 * `fileName` (if set) overrides the default name; any extension it carries is
 * stripped and replaced with `ext`.
 */
export function manuscriptPathFor(
	gridFilePath: string,
	name: string,
	ext = '.md',
	fileName?: string
): string {
	const folder = gridFilePath.includes('/') ? gridFilePath.split('/').slice(0, -1).join('/') : '';
	const safe = (fileName?.trim().replace(/[\\/:*?"<>|]/g, '-') || defaultManuscriptName(name)).replace(
		/\.(md|fountain|docx|epub)$/i,
		''
	);
	return `${folder ? folder + '/' : ''}${safe}${ext}`;
}

/**
 * Assemble and write a markdown (or fountain — both are text) manuscript from
 * ordered items, confirming before overwriting, then open the result.
 */
export async function writeManuscript(
	app: App,
	gridFilePath: string,
	name: string,
	items: ManuscriptItem[],
	opts: ManuscriptOptions,
	fileName?: string,
	coverImagePath?: string
): Promise<void> {
	const sceneCount = items.filter((i) => i.kind === 'scene').length;
	if (sceneCount === 0) {
		new Notice('Plotverk: No scenes to compile.');
		return;
	}

	const coverBlock = coverImagePath ? `![[${coverImagePath}]]\n\n` : '';
	const md = coverBlock + assembleManuscript(name, items, opts);
	const words = countWords(md);
	const path = manuscriptPathFor(gridFilePath, name, '.md', fileName);
	const existing = app.vault.getAbstractFileByPath(path);

	const write = async () => {
		try {
			let file: TFile;
			if (existing instanceof TFile) {
				await app.vault.modify(existing, md);
				file = existing;
			} else {
				file = await app.vault.create(path, md);
			}
			new Notice(`Manuscript compiled — ${sceneCount} scenes, ${words.toLocaleString()} words.`);
			await openOrReveal(app, file);
		} catch (err) {
			new Notice(`Plotverk: Could not write manuscript. ${err instanceof Error ? err.message : ''}`);
		}
	};

	if (existing) {
		new ConfirmModal(
			app,
			`"${path.split('/').pop()}" already exists. Overwrite it with the new compile?`,
			'Overwrite',
			write
		).open();
	} else {
		await write();
	}
}

/**
 * Write already-assembled text to a manuscript file with the given extension
 * (used by the Fountain exporter), confirming before overwriting.
 */
export async function writeTextManuscript(
	app: App,
	gridFilePath: string,
	name: string,
	content: string,
	ext: string,
	fileName?: string
): Promise<void> {
	const path = manuscriptPathFor(gridFilePath, name, ext, fileName);
	const existing = app.vault.getAbstractFileByPath(path);
	const write = async () => {
		try {
			let file: TFile;
			if (existing instanceof TFile) {
				await app.vault.modify(existing, content);
				file = existing;
			} else {
				file = await app.vault.create(path, content);
			}
			new Notice(`Compiled ${path.split('/').pop()}.`);
			await openOrReveal(app, file);
		} catch (err) {
			new Notice(`Plotverk: Could not write file. ${err instanceof Error ? err.message : ''}`);
		}
	};
	if (existing) {
		new ConfirmModal(app, `"${path.split('/').pop()}" already exists. Overwrite it?`, 'Overwrite', write).open();
	} else {
		await write();
	}
}

/** Build .epub bytes from ordered items, reading the cover image if set. */
export async function buildEpubBytes(
	app: App,
	title: string,
	author: string,
	items: ManuscriptItem[],
	opts: ManuscriptOptions,
	coverImagePath?: string
): Promise<Uint8Array | null> {
	const chapters = chaptersFromItems(items, opts);
	if (chapters.length === 0) return null;
	let cover: EpubCover | undefined;
	if (coverImagePath) {
		const f = app.vault.getAbstractFileByPath(coverImagePath);
		if (f instanceof TFile) cover = { data: new Uint8Array(await app.vault.readBinary(f)), ext: f.extension };
	}
	return buildEpub(title, author, chapters, cover);
}

/** Write (or overwrite) a .docx next to the grid file and confirm with a notice. */
export async function exportDocx(
	app: App,
	docxPath: string,
	name: string,
	author: string,
	items: ManuscriptItem[],
	opts: DocxOptions
): Promise<void> {
	if (!items.some((i) => i.kind === 'scene')) {
		new Notice('Plotverk: No scenes to compile.');
		return;
	}
	const write = async () => {
		const bytes = buildDocx(name, items, opts, author);
		const buf = new ArrayBuffer(bytes.length);
		new Uint8Array(buf).set(bytes);
		try {
			const existing = app.vault.getAbstractFileByPath(docxPath);
			if (existing instanceof TFile) await app.vault.modifyBinary(existing, buf);
			else await app.vault.createBinary(docxPath, buf);
			new Notice(`Word manuscript exported — ${docxPath.split('/').pop()}`);
			const f = app.vault.getAbstractFileByPath(docxPath);
			if (f instanceof TFile) await openOrReveal(app, f);
		} catch (err) {
			new Notice(`Plotverk: Could not write .docx. ${err instanceof Error ? err.message : ''}`);
		}
	};
	const existing = app.vault.getAbstractFileByPath(docxPath);
	if (existing) {
		new ConfirmModal(app, `"${docxPath.split('/').pop()}" already exists. Overwrite it?`, 'Overwrite', write).open();
	} else {
		await write();
	}
}

/**
 * Compile the outline tree into a markdown manuscript file, confirming before
 * overwriting an existing compile, then open the result.
 */
export async function runCompile(
	app: App,
	gridFilePath: string,
	name: string,
	tree: SceneTree,
	opts: ManuscriptOptions = DEFAULT_MANUSCRIPT_OPTIONS,
	fileName?: string
): Promise<void> {
	if (!treeHasScenes(tree)) {
		new Notice('Plotverk: No scenes to compile.');
		return;
	}
	const items = await gatherManuscript(app, tree);
	await snapshotCompiledScenes(app, items);
	await writeManuscript(app, gridFilePath, name, items, opts, fileName);
}
