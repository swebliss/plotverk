import * as fs from 'fs';
import * as nodePath from 'path';
import { App, TFile, TFolder } from 'obsidian';

/**
 * In-memory stand-in for the slice of Obsidian's vault the safety nets use,
 * for Jest only (with `src/__mocks__/obsidian.ts`). It copies the one quirk
 * that broke the old nets: any path with a dot-segment (".storygrid-backups",
 * ".storygrid-data.json") is invisible to the vault index —
 * `getAbstractFileByPath` returns null — while `adapter` still sees it.
 *
 * Stricter than Obsidian where that is cheaper to be safe: `create` and
 * `createFolder` refuse a missing parent or an existing path.
 */
export class FakeVault {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	/** Paths created or modified through the vault API, in order. */
	readonly written: string[] = [];
	readonly deleted: string[] = [];
	/** Old paths of renamed files and folders. */
	readonly movedFrom: string[] = [];
	private nodes = new Map<string, TFile>();
	/** Modification time per file path (ms); seeded files default to 0, writes stamp Date.now(). */
	readonly mtimes = new Map<string, number>();

	static isHidden(path: string): boolean {
		return path.split('/').some((seg) => seg.startsWith('.'));
	}

	/** Seed a file (and its folders) without recording it as written. */
	seed(path: string, content: string, mtime = 0): void {
		this.mtimes.set(path, mtime);
		const parts = path.split('/');
		for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join('/'));
		this.files.set(path, content);
	}

	private parentOf(path: string): string {
		const i = path.lastIndexOf('/');
		return i === -1 ? '' : path.slice(0, i);
	}

	private fileNode(path: string): TFile {
		let f = this.nodes.get(path);
		if (!f) {
			f = new TFile();
			f.path = path;
			f.name = path.split('/').pop() ?? path;
			const dot = f.name.lastIndexOf('.');
			f.basename = dot > 0 ? f.name.slice(0, dot) : f.name;
			f.extension = dot > 0 ? f.name.slice(dot + 1) : '';
			this.nodes.set(path, f);
		}
		f.stat = { ctime: 0, mtime: this.mtimes.get(path) ?? 0, size: this.files.get(path)?.length ?? 0 };
		return f;
	}

	private folderNode(path: string): TFolder {
		const folder = new TFolder();
		folder.path = path;
		folder.name = path.split('/').pop() ?? path;
		for (const f of this.files.keys()) {
			if (this.parentOf(f) === path && !FakeVault.isHidden(f)) folder.children.push(this.fileNode(f));
		}
		for (const d of this.folders) {
			if (this.parentOf(d) === path && !FakeVault.isHidden(d)) folder.children.push(this.folderNode(d));
		}
		return folder;
	}

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		if (FakeVault.isHidden(path)) return null;
		if (this.files.has(path)) return this.fileNode(path);
		if (this.folders.has(path)) return this.folderNode(path);
		return null;
	}

	/** Every indexed folder and file (the vault root itself left out). */
	getAllLoadedFiles(): (TFile | TFolder)[] {
		const folders = [...this.folders].filter((p) => !FakeVault.isHidden(p)).map((p) => this.folderNode(p));
		return [...folders, ...this.getFiles()];
	}

	getFiles(): TFile[] {
		return [...this.files.keys()].filter((p) => !FakeVault.isHidden(p)).map((p) => this.fileNode(p));
	}

	getMarkdownFiles(): TFile[] {
		return this.getFiles().filter((f) => f.extension === 'md');
	}

	private assertParent(path: string): void {
		const parent = this.parentOf(path);
		if (parent && !this.folders.has(parent)) throw new Error(`Parent folder missing: ${parent}`);
	}

	async createFolder(path: string): Promise<void> {
		if (this.folders.has(path) || this.files.has(path)) throw new Error('Folder already exists.');
		this.assertParent(path);
		this.folders.add(path);
	}

	async create(path: string, content: string): Promise<TFile> {
		if (this.files.has(path) || this.folders.has(path)) throw new Error('File already exists.');
		this.assertParent(path);
		this.files.set(path, content);
		this.mtimes.set(path, Date.now());
		this.written.push(path);
		return this.fileNode(path);
	}

	async modify(file: TFile, content: string): Promise<void> {
		if (!this.files.has(file.path)) throw new Error('File not found.');
		this.files.set(file.path, content);
		this.mtimes.set(file.path, Date.now());
		this.written.push(file.path);
	}

	async read(file: TFile): Promise<string> {
		const c = this.files.get(file.path);
		if (c === undefined) throw new Error('File not found.');
		return c;
	}

	cachedRead(file: TFile): Promise<string> {
		return this.read(file);
	}

	/** Deletes a file, or a folder only when it is empty (stricter than Obsidian, which would take the subtree). */
	async delete(file: TFile | TFolder): Promise<void> {
		if (this.folders.has(file.path)) {
			const prefix = `${file.path}/`;
			if ([...this.files.keys(), ...this.folders].some((p) => p.startsWith(prefix))) throw new Error('Folder not empty.');
			this.folders.delete(file.path);
			this.deleted.push(file.path);
			return;
		}
		this.files.delete(file.path);
		this.nodes.delete(file.path);
		this.deleted.push(file.path);
	}

	/** Paths sent to Obsidian's trash (recoverable), kept apart from hard deletes. */
	readonly trashed: string[] = [];

	async trash(file: TFile, _system: boolean): Promise<void> {
		this.files.delete(file.path);
		this.nodes.delete(file.path);
		this.trashed.push(file.path);
	}

	/** Moves a file or a whole folder subtree; refuses an existing target or a missing parent. */
	async rename(item: TFile | TFolder, newPath: string): Promise<void> {
		if (this.files.has(newPath) || this.folders.has(newPath)) throw new Error('Destination already exists.');
		this.assertParent(newPath);
		const from = item.path;
		this.movedFrom.push(from);
		const move = (p: string) => newPath + p.slice(from.length);
		if (this.files.has(from)) {
			this.files.set(newPath, this.files.get(from)!);
			this.mtimes.set(newPath, this.mtimes.get(from) ?? 0);
			this.files.delete(from);
			this.nodes.delete(from);
			this.written.push(newPath);
			return;
		}
		const prefix = `${from}/`;
		for (const d of [...this.folders]) {
			if (d === from || d.startsWith(prefix)) { this.folders.delete(d); this.folders.add(move(d)); }
		}
		for (const [p, c] of [...this.files]) {
			if (p.startsWith(prefix)) {
				this.files.delete(p); this.nodes.delete(p);
				this.files.set(move(p), c); this.mtimes.set(move(p), this.mtimes.get(p) ?? 0);
				this.written.push(move(p));
			}
		}
	}

	readonly adapter = {
		exists: async (path: string): Promise<boolean> => this.files.has(path) || this.folders.has(path),
		list: async (folder: string): Promise<{ files: string[]; folders: string[] }> => ({
			files: [...this.files.keys()].filter((p) => this.parentOf(p) === folder),
			folders: [...this.folders].filter((p) => this.parentOf(p) === folder),
		}),
		read: async (path: string): Promise<string> => {
			const c = this.files.get(path);
			if (c === undefined) throw new Error('File not found.');
			return c;
		},
		/** Permanent file delete, like Vault.delete: the index forgets the file at once. */
		remove: async (path: string): Promise<void> => {
			if (!this.files.delete(path)) throw new Error('File not found.');
			this.nodes.delete(path);
			this.deleted.push(path);
		},
		/** Non-recursive only, like a plain OS rmdir: refuses a folder holding anything, hidden files included. */
		rmdir: async (path: string, recursive: boolean): Promise<void> => {
			if (recursive) throw new Error('FakeVault: recursive rmdir not supported.');
			const prefix = `${path}/`;
			if ([...this.files.keys(), ...this.folders].some((p) => p.startsWith(prefix))) throw new Error('Directory not empty.');
			if (!this.folders.delete(path)) throw new Error('No such directory.');
			this.deleted.push(path);
		},
	};

	/** Load a real vault folder from disk (skipping `.obsidian`), for smoke tests on vault copies. */
	static fromDisk(root: string): FakeVault {
		const v = new FakeVault();
		const walk = (abs: string, rel: string) => {
			for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
				if (entry.name === '.obsidian' || entry.name === '.trash') continue;
				const childRel = rel ? `${rel}/${entry.name}` : entry.name;
				const childAbs = nodePath.join(abs, entry.name);
				if (entry.isDirectory()) {
					v.folders.add(childRel);
					walk(childAbs, childRel);
				} else {
					v.files.set(childRel, fs.readFileSync(childAbs, 'utf8'));
					v.mtimes.set(childRel, fs.statSync(childAbs).mtimeMs);
				}
			}
		};
		walk(root, '');
		return v;
	}

	/** Write every file this session created or changed back to `root` (a vault COPY), and apply deletes. */
	flushTo(root: string): void {
		for (const p of new Set(this.written)) {
			const content = this.files.get(p);
			if (content === undefined) continue;
			fs.mkdirSync(nodePath.dirname(nodePath.join(root, p)), { recursive: true });
			fs.writeFileSync(nodePath.join(root, p), content);
		}
		// Then remove what left the vault: deleted, trashed and moved-away paths that hold nothing any more.
		// Deepest first, so a folder is emptied before it is removed; a folder still holding anything stays.
		const gone = [...new Set([...this.deleted, ...this.trashed, ...this.movedFrom])]
			.filter((p) => !this.files.has(p) && !this.folders.has(p))
			.sort((a, b) => b.length - a.length);
		for (const p of gone) {
			const abs = nodePath.join(root, p);
			if (!fs.existsSync(abs)) continue;
			if (fs.statSync(abs).isDirectory()) {
				for (const f of fs.readdirSync(abs, { recursive: true, withFileTypes: true })) {
					if (f.isFile() && !this.files.has(nodePath.relative(root, nodePath.join(f.parentPath, f.name)).split(nodePath.sep).join('/'))) {
						fs.rmSync(nodePath.join(f.parentPath, f.name));
					}
				}
				for (const d of fs.readdirSync(abs, { recursive: true }).map(String).sort((a, b) => b.length - a.length)) {
					const sub = nodePath.join(abs, d);
					if (fs.statSync(sub).isDirectory() && fs.readdirSync(sub).length === 0) fs.rmdirSync(sub);
				}
				if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
			} else {
				fs.rmSync(abs);
			}
		}
	}
}

export function fakeApp(vault: FakeVault): App {
	// fileManager.trashFile is what the plugin calls to remove files; here it lands in `vault.trashed`.
	return {
		vault,
		fileManager: { trashFile: (file: TFile | TFolder) => vault.trash(file as TFile, true) },
	} as unknown as App;
}
