import { App, TFile, TFolder, TAbstractFile } from 'obsidian';
import { renameEntitySheet, sheetNameTaken, sheetPathFor } from './sheet-rename';
import { buildEntityDocument } from './entity-doc';

/** A folder of sheets in memory, with Obsidian's rename and process. */
function vault(names: string[], opts: { renameFails?: boolean } = {}) {
	const folder = new TFolder();
	folder.path = 'Codex/Characters';
	const codex = new TFolder();
	codex.path = 'Codex';
	codex.children.push(folder);
	const byPath = new Map<string, TAbstractFile>([[codex.path, codex], [folder.path, folder]]);
	const content = new Map<TFile, string>();
	const files = names.map((n) => {
		const f = new TFile();
		f.basename = n; f.extension = 'md'; f.name = `${n}.md`; f.path = `${folder.path}/${n}.md`; f.parent = folder;
		byPath.set(f.path, f);
		folder.children.push(f);
		content.set(f, buildEntityDocument('character', n, [{ id: 'r', label: 'Role', value: 'Hero', type: 'text' }]));
		return f;
	});
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getRoot: () => folder,
			read: async (f: TFile) => content.get(f) ?? '',
			process: async (f: TFile, fn: (c: string) => string) => { content.set(f, fn(content.get(f) ?? '')); },
		},
		fileManager: {
			renameFile: async (f: TFile, to: string) => {
				if (opts.renameFails) throw new Error('disk said no');
				byPath.delete(f.path);
				f.path = to; f.basename = to.split('/').pop()!.replace(/\.md$/, ''); f.name = `${f.basename}.md`;
				byPath.set(to, f);
			},
		},
	} as unknown as App;
	return { app, files, titleOf: (f: TFile) => /^# (.*)$/m.exec(content.get(f) ?? '')?.[1] };
}

describe('renaming a sheet', () => {
	it('renames title and file together', async () => {
		const { app, files, titleOf } = vault(['Anna', 'Bob']);
		expect(await renameEntitySheet(app, files[0], 'Anna Berg')).toBe('renamed');
		expect(files[0].path).toBe('Codex/Characters/Anna Berg.md');
		expect(titleOf(files[0])).toBe('Anna Berg');
	});

	it('a name another sheet has changes nothing at all', async () => {
		const { app, files, titleOf } = vault(['Anna', 'Bob']);
		expect(await renameEntitySheet(app, files[0], 'Bob')).toBe('taken');
		expect(await renameEntitySheet(app, files[0], 'bob')).toBe('taken');
		expect(files[0].path).toBe('Codex/Characters/Anna.md');
		expect(titleOf(files[0])).toBe('Anna');
	});

	it('a capitals-only rename of the same sheet is allowed', () => {
		const { app, files } = vault(['Anna']);
		expect(sheetNameTaken(app, files[0], 'ANNA')).toBe(false);
	});

	it('a title change that keeps the same file name only changes the title', async () => {
		const { app, files, titleOf } = vault(['Who- Me']);
		expect(await renameEntitySheet(app, files[0], 'Who: Me')).toBe('renamed');
		expect(files[0].path).toBe('Codex/Characters/Who- Me.md');
		expect(titleOf(files[0])).toBe('Who: Me');
	});

	it('a failed file rename puts the title back', async () => {
		const { app, files, titleOf } = vault(['Anna'], { renameFails: true });
		await expect(renameEntitySheet(app, files[0], 'Anna Berg')).rejects.toThrow('disk said no');
		expect(titleOf(files[0])).toBe('Anna');
		expect(files[0].path).toBe('Codex/Characters/Anna.md');
	});

	it('the path is built next to the sheet', () => {
		const { files } = vault(['Anna']);
		expect(sheetPathFor(files[0], ' A/B ')).toBe('Codex/Characters/A-B.md');
	});
});
