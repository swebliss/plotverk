import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { FakeVault } from '../test/fake-vault';
import { buildEntityDocument } from './entity-doc';
import { assignRoot } from './entity-index';
import { instantiateFields, getKindSpec } from './entity-kinds';
import { parseEntityDocument } from './entity-parse';
import {
	adoptImagesIntoSheetFolder,
	appendSheetImage,
	configureSheetImages,
	followSheetRename,
	imagesFolderNameProblem,
	imagesInFolder,
	isSheetOwnImage,
	listSheetImages,
	removalFor,
	removeSheetImage,
	renameImagesFolders,
	saveImageForSheet,
	sheetDeletePlan,
	shouldFollowRename,
	targetForSheet,
	trashSheet,
	useAsPortrait,
} from './sheet-images';

/**
 * End-to-end run of the sheet-images flows against an in-memory vault that
 * behaves like Obsidian where it matters here: `fileManager.renameFile`
 * moves a file or folder AND rewrites links to it, TFile objects are renamed
 * in place, the trash keeps what it gets, and the disk is case-insensitive
 * (a rename onto a name that differs only by case is refused, which is
 * stricter than Obsidian).
 */
function makeApp(seed: Record<string, string>) {
	const vault = new FakeVault();
	vault.folders.add('.trash');
	for (const [p, c] of Object.entries(seed)) vault.seed(p, c);
	const v = vault as unknown as Record<string, unknown>;
	v.getRoot = () => (vault as unknown as { folderNode(p: string): TFolder }).folderNode('');
	v.createBinary = async (path: string) => {
		const clash = [...vault.files.keys(), ...vault.folders].find((p) => p.toLowerCase() === path.toLowerCase());
		if (clash) throw new Error(`File already exists: ${clash}`);
		return vault.create(path, `<image ${path}>`);
	};
	v.process = async (file: TFile, fn: (c: string) => string) => {
		const next = fn(await vault.read(file));
		await vault.modify(file, next);
		return next;
	};
	const realRename = vault.rename.bind(vault);
	vault.rename = async (item: TFile | TFolder, newPath: string) => {
		const clash = [...vault.files.keys(), ...vault.folders].find((p) => p.toLowerCase() === newPath.toLowerCase() && p !== item.path);
		if (clash) throw new Error(`Destination already exists: ${clash}`);
		await realRename(item, newPath);
	};

	const relink = (from: string, to: string, isFolder: boolean) => {
		for (const [p, c] of [...vault.files]) {
			if (!p.endsWith('.md')) continue;
			const next = isFolder ? c.split(`[[${from}/`).join(`[[${to}/`) : c.split(`[[${from}`).join(`[[${to}`);
			if (next !== c) vault.files.set(p, next);
		}
	};
	const moveNode = (item: TAbstractFile, newPath: string) => {
		item.path = newPath;
		item.name = newPath.split('/').pop() ?? newPath;
		if (item instanceof TFile) {
			const dot = item.name.lastIndexOf('.');
			item.basename = dot > 0 ? item.name.slice(0, dot) : item.name;
		}
	};
	const fileManager = {
		renameFile: async (item: TFile | TFolder, newPath: string) => {
			const from = item.path;
			const isFolder = vault.folders.has(from);
			await vault.rename(item, newPath);
			relink(from, newPath, isFolder);
			moveNode(item, newPath);
		},
		trashFile: async (item: TFile | TFolder) => {
			const dest = `.trash/${item.path.split('/').join('__')}`;
			await realRename(item, dest);
			vault.trashed.push(item.path);
		},
		getAvailablePathForAttachment: async (name: string) => `Attachments/${name}`,
	};
	const linkTarget = (link: string, source: string): TFile | null => {
		const clean = link.split('|')[0].split('#')[0].trim();
		for (const cand of [clean, `${clean}.md`]) {
			const hit = vault.getAbstractFileByPath(cand);
			if (hit instanceof TFile) return hit;
		}
		const byName = vault.getFiles().filter((f) => f.path === clean || f.path.endsWith(`/${clean}`) || f.name === clean);
		void source;
		return byName[0] ?? null;
	};
	const metadataCache = {
		getFileCache: (file: TFile) => {
			const c = vault.files.get(file.path);
			if (c === undefined) return null;
			const type = c.match(/^storygrid-type:\s*(\S+)/m)?.[1];
			const embeds = [...c.matchAll(/!\[\[([^\]]+)\]\]/g)].map((m) => ({ link: m[1].split('|')[0] }));
			return { frontmatter: type ? { 'storygrid-type': type } : {}, embeds };
		},
		getFirstLinkpathDest: linkTarget,
		get resolvedLinks() {
			const out: Record<string, Record<string, number>> = {};
			for (const [src, c] of vault.files) {
				if (!src.endsWith('.md')) continue;
				const targets: Record<string, number> = {};
				for (const m of c.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
					const dest = linkTarget(m[1], src);
					if (dest) targets[dest.path] = (targets[dest.path] ?? 0) + 1;
				}
				out[src] = targets;
			}
			return out;
		},
	};
	let location: 'per-sheet' | 'obsidian' = 'per-sheet';
	configureSheetImages({
		location: () => location,
		folderName: () => 'Images',
		rootFor: (p) => assignRoot(p, [...vault.files.keys()].filter((f) => f.endsWith('.storygrid')).map((f) => f.slice(0, Math.max(0, f.lastIndexOf('/'))))),
	});
	const app = { vault, fileManager, metadataCache } as unknown as App;
	const file = (p: string) => {
		const f = vault.getAbstractFileByPath(p);
		if (!(f instanceof TFile)) throw new Error(`missing ${p}`);
		return f;
	};
	return { app, vault, fileManager, file, setLocation: (l: typeof location) => { location = l; } };
}

const sheetDoc = (kind: 'character' | 'faction', name: string) =>
	buildEntityDocument(kind, name, instantiateFields(getKindSpec(kind).defaultFields, name), 'id12345678ab');
const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
const portraitLinks = (content: string, name: string) =>
	parseEntityDocument(content, name).fields.filter((f) => f.type === 'image').map((f) => f.value);

/** The Codex page's "Add image" (codex-view addImagesToSheet), on the module calls it makes. */
async function addImages(app: App, sheet: TFile, files: File[]): Promise<TFile[]> {
	const target = targetForSheet(app, sheet);
	let { portrait } = await listSheetImages(app, sheet);
	const out: TFile[] = [];
	for (const f of files) {
		const created = await saveImageForSheet(app, f, target);
		if (!portrait) { await useAsPortrait(app, sheet, created); portrait = created; }
		else if (!isSheetOwnImage(app, sheet, created)) await appendSheetImage(app, sheet, created);
		out.push(created);
	}
	return out;
}

/** The gallery's Remove (codex-view), on the module calls it makes. */
async function remove(app: App, sheet: TFile, img: TFile): Promise<'trash' | 'unlink' | null> {
	const how = await removalFor(app, sheet, img);
	if (how) await removeSheetImage(app, sheet, img, how);
	return how;
}

describe('sheet images — the full scenario on a scratch project', () => {
	const ROOT = '_ImageTest';
	const MARA = `${ROOT}/Codex/Characters/Mara.md`;
	const FACTION = `${ROOT}/Codex/Factions/Mara.md`;
	const seed = () => makeApp({
		[`${ROOT}/${ROOT}.storygrid`]: '{}',
		[MARA]: sheetDoc('character', 'Mara'),
		[FACTION]: sheetDoc('faction', 'Mara'),
		[`${ROOT}/Images/Factions/Mara/banner.png`]: '<image>',
		'shared.jpg': '<image>',
		'Notes/uses-shared.md': '![[shared.jpg]]',
		'Other/Other.storygrid': '{}',
	});

	it('create → add 3 → rename → case-only rename → portrait → remove → delete, without touching anything else', async () => {
		const { app, vault, fileManager, file } = seed();
		const mara = file(MARA);

		// Add three pictures (two share a name): the first becomes the portrait.
		const added = await addImages(app, mara, [png('dive.png'), png('harbour.png'), png('dive.png')]);
		expect(added.map((f) => f.path)).toEqual([
			`${ROOT}/Images/Characters/Mara/dive.png`,
			`${ROOT}/Images/Characters/Mara/harbour.png`,
			`${ROOT}/Images/Characters/Mara/dive 2.png`,
		]);
		expect(portraitLinks(vault.files.get(MARA)!, 'Mara')).toEqual([`${ROOT}/Images/Characters/Mara/dive.png`]);
		expect((await listSheetImages(app, mara)).images.map((f) => f.name)).toEqual(['dive.png', 'dive 2.png', 'harbour.png']);

		// Rename the sheet: the folder follows and the portrait link is rewritten.
		const before = vault.files.get(MARA)!;
		await fileManager.renameFile(mara, `${ROOT}/Codex/Characters/Mara Ferrow.md`);
		await followSheetRename(app, mara, MARA);
		expect(vault.folders.has(`${ROOT}/Images/Characters/Mara`)).toBe(false);
		expect(imagesInFolder(app, `${ROOT}/Images/Characters/Mara Ferrow`).map((f) => f.name).sort()).toEqual(['dive 2.png', 'dive.png', 'harbour.png']);
		const afterRename = vault.files.get(mara.path)!;
		expect(afterRename).toBe(before.split('/Images/Characters/Mara/').join('/Images/Characters/Mara Ferrow/'));
		expect(linkTargetOk(app, mara)).toBe(true);

		// Case-only rename: two-step move on a case-insensitive disk.
		const oldPath = mara.path;
		await vault.rename(mara, `${ROOT}/Codex/Characters/mara ferrow.md`); // the sheet itself (Obsidian's job)
		mara.path = `${ROOT}/Codex/Characters/mara ferrow.md`; mara.basename = 'mara ferrow'; mara.name = 'mara ferrow.md';
		await followSheetRename(app, mara, oldPath);
		expect(vault.folders.has(`${ROOT}/Images/Characters/mara ferrow`)).toBe(true);
		expect([...vault.folders].some((f) => f.includes('(renaming)'))).toBe(false);
		expect(linkTargetOk(app, mara)).toBe(true);

		// Use the second picture as portrait: the old one (in the folder) leaves the sheet but stays in the gallery.
		const harbour = file(`${ROOT}/Images/Characters/mara ferrow/harbour.png`);
		await useAsPortrait(app, mara, harbour);
		expect(portraitLinks(vault.files.get(mara.path)!, 'Mara')).toEqual([harbour.path]);
		const gallery = await listSheetImages(app, mara);
		expect(gallery.portrait?.path).toBe(harbour.path);
		expect(gallery.images).toHaveLength(3);

		// Remove one picture: it goes to the trash; the sheet still opens fine.
		const dive2 = file(`${ROOT}/Images/Characters/mara ferrow/dive 2.png`);
		expect(await remove(app, mara, dive2)).toBe('trash');
		expect(vault.trashed).toContain(`${ROOT}/Images/Characters/mara ferrow/dive 2.png`);
		expect((await listSheetImages(app, mara)).images).toHaveLength(2);

		// Delete the sheet with its images.
		expect((await sheetDeletePlan(app, mara)).trashable).toHaveLength(2);
		await trashSheet(app, mara, true);
		expect(vault.folders.has(`${ROOT}/Images/Characters/mara ferrow`)).toBe(false);

		// Nothing else was touched: the same-named faction, the shared picture, the note using it.
		expect(vault.files.has(FACTION)).toBe(true);
		expect(vault.files.has(`${ROOT}/Images/Factions/Mara/banner.png`)).toBe(true);
		expect(vault.files.has('shared.jpg')).toBe(true);
		expect(vault.files.get('Notes/uses-shared.md')).toBe('![[shared.jpg]]');
	});

	it('Remove on a picture kept elsewhere only takes it off the sheet', async () => {
		const { app, vault, file, setLocation } = seed();
		const mara = file(MARA);
		await addImages(app, mara, [png('first.png')]);
		setLocation('obsidian');
		const [outside] = await addImages(app, mara, [png('elsewhere.png')]);
		expect(outside.path).toBe('Attachments/elsewhere.png');
		expect(portraitLinks(vault.files.get(MARA)!, 'Mara')).toEqual([`${ROOT}/Images/Characters/Mara/first.png`, 'Attachments/elsewhere.png']);
		expect(isSheetOwnImage(app, mara, outside)).toBe(false);
		expect(await remove(app, mara, outside)).toBe('unlink');
		expect(vault.files.has('Attachments/elsewhere.png')).toBe(true);
		expect(portraitLinks(vault.files.get(MARA)!, 'Mara')).toEqual([`${ROOT}/Images/Characters/Mara/first.png`]);
	});

	it('Use as portrait keeps an old portrait from outside the folder on the sheet', async () => {
		const { app, vault, file } = makeApp({
			[`${ROOT}/${ROOT}.storygrid`]: '{}',
			[MARA]: sheetDoc('character', 'Mara').replace('# Mara', '# Mara\n\n> [!infobox]\n> ![[shared.jpg|300]]'),
			'shared.jpg': '<image>',
		});
		const mara = file(MARA);
		const [img] = await addImages(app, mara, [png('new.png')]);
		await useAsPortrait(app, mara, img);
		expect(portraitLinks(vault.files.get(MARA)!, 'Mara')).toEqual([img.path, 'shared.jpg|300']);
	});

	it('moving a sheet to another project moves its folder there', async () => {
		const { app, vault, fileManager, file } = seed();
		const mara = file(MARA);
		await addImages(app, mara, [png('a.png')]);
		vault.folders.add('Other/Codex'); vault.folders.add('Other/Codex/Characters');
		await fileManager.renameFile(mara, 'Other/Codex/Characters/Mara.md');
		await followSheetRename(app, mara, MARA);
		expect(vault.files.has('Other/Images/Characters/Mara/a.png')).toBe(true);
		expect(vault.files.get('Other/Codex/Characters/Mara.md')).toContain('![[Other/Images/Characters/Mara/a.png]]');
	});

	it('a rename onto a name whose folder already exists merges without overwriting', async () => {
		const { app, vault, fileManager, file } = seed();
		vault.seed(`${ROOT}/Images/Characters/Mara Ferrow/a.png`, '<old>');
		const mara = file(MARA);
		await addImages(app, mara, [png('a.png')]);
		await fileManager.renameFile(mara, `${ROOT}/Codex/Characters/Mara Ferrow.md`);
		await followSheetRename(app, mara, MARA);
		expect(vault.files.get(`${ROOT}/Images/Characters/Mara Ferrow/a.png`)).toBe('<old>');
		expect(vault.files.has(`${ROOT}/Images/Characters/Mara Ferrow/a 2.png`)).toBe(true);
		expect(vault.files.get(mara.path)).toContain('Mara Ferrow/a 2.png');
	});

	it('a new sheet’s pictures move into its final folder on save', async () => {
		const { app, vault, file } = seed();
		// Typed "Mara" while a Mara exists: the sheet is saved as "Mara 2".
		const up = await saveImageForSheet(app, png('p.png'), { projectRoot: ROOT, kind: 'character', sheetName: 'Mara' });
		vault.seed(`${ROOT}/Codex/Characters/Mara 2.md`, sheetDoc('character', 'Mara').replace('# Mara', `# Mara\n\n> [!infobox]\n> ![[${up.path}]]`));
		await adoptImagesIntoSheetFolder(app, file(`${ROOT}/Codex/Characters/Mara 2.md`), [up]);
		expect(up.path).toBe(`${ROOT}/Images/Characters/Mara 2/p.png`);
		expect(vault.files.get(`${ROOT}/Codex/Characters/Mara 2.md`)).toContain(`![[${ROOT}/Images/Characters/Mara 2/p.png]]`);
	});

	it('a typed name cannot put a picture outside the Images folder', async () => {
		const { app } = seed();
		const up = await saveImageForSheet(app, png('../../x.png'), { projectRoot: ROOT, kind: 'character', sheetName: '../../../evil' });
		expect(up.path.startsWith(`${ROOT}/Images/Characters/`)).toBe(true);
		expect(up.path.split('/')).not.toContain('..');
	});
});

describe('sheet images — what the hostile review found', () => {
	const ROOT = 'P';
	const base = (extra: Record<string, string> = {}) => makeApp({ [`${ROOT}/P.storygrid`]: '{}', ...extra });

	it('a sheet next to a same-named sub-folder of sheets never shares or swallows its pictures', async () => {
		const { app, vault, file } = base({
			[`${ROOT}/Codex/Places/Sweden.md`]: sheetDoc('character', 'Sweden').replace('character', 'location'),
			[`${ROOT}/Codex/Places/Sweden/Gothenburg.md`]: sheetDoc('character', 'Gothenburg').replace('character', 'location'),
		});
		const sweden = file(`${ROOT}/Codex/Places/Sweden.md`);
		const goth = file(`${ROOT}/Codex/Places/Sweden/Gothenburg.md`);
		const [g] = await addImages(app, goth, [png('harbour.png')]);
		const [s] = await addImages(app, sweden, [png('flag.png')]);
		expect(g.path).toBe(`${ROOT}/Images/Places/Sweden › Gothenburg/harbour.png`);
		expect(s.path).toBe(`${ROOT}/Images/Places/Sweden/flag.png`);
		expect((await listSheetImages(app, sweden)).images.map((f) => f.name)).toEqual(['flag.png']);
		await trashSheet(app, sweden, true);
		expect(vault.files.has(g.path)).toBe(true);
	});

	it('a picture another note uses is never trashed — Remove only takes it off, delete keeps it', async () => {
		const { app, vault, file } = base({ [`${ROOT}/Codex/Characters/Mara.md`]: sheetDoc('character', 'Mara') });
		const mara = file(`${ROOT}/Codex/Characters/Mara.md`);
		const [img, other] = await addImages(app, mara, [png('a.png'), png('b.png')]);
		vault.seed(`${ROOT}/Scenes/Dive.md`, `![[${img.path}]] and ![[${other.path}]]`);
		expect(await removalFor(app, mara, img)).toBe('unlink');
		expect((await sheetDeletePlan(app, mara)).trashable).toEqual([]);
		await trashSheet(app, mara, true);
		expect(vault.files.has(`${ROOT}/Images/Characters/Mara (kept)/a.png`)).toBe(true);
		expect(vault.files.get(`${ROOT}/Scenes/Dive.md`)).toBe(`![[${ROOT}/Images/Characters/Mara (kept)/a.png]] and ![[${ROOT}/Images/Characters/Mara (kept)/b.png]]`);
	});

	it('a picture used only inside the sheet’s writing gets no Remove button', async () => {
		const { app, vault, file } = base({ [`${ROOT}/Codex/Characters/Mara.md`]: sheetDoc('character', 'Mara') });
		const mara = file(`${ROOT}/Codex/Characters/Mara.md`);
		await addImages(app, mara, [png('portrait.png')]);
		const inText = await saveImageForSheet(app, png('map.png'), targetForSheet(app, mara));
		vault.files.set(mara.path, vault.files.get(mara.path)! + `\n## Notes\nSee ![[${inText.path}]]\n`);
		expect(await removalFor(app, mara, inText)).toBeNull();
	});

	it('a picture a canvas uses is never trashed either', async () => {
		const { app, vault, file } = base({ [`${ROOT}/Codex/Characters/Mara.md`]: sheetDoc('character', 'Mara') });
		const mara = file(`${ROOT}/Codex/Characters/Mara.md`);
		const [img] = await addImages(app, mara, [png('a.png')]);
		vault.seed(`${ROOT}/Board.canvas`, JSON.stringify({ nodes: [{ type: 'file', file: img.path }] }));
		expect(await removalFor(app, mara, img)).toBe('unlink');
		expect((await sheetDeletePlan(app, mara)).trashable).toEqual([]);
	});

	it('a sheet restored from the trash still points at its kept pictures', async () => {
		const { app, vault, file } = base({ [`${ROOT}/Codex/Characters/Mara.md`]: sheetDoc('character', 'Mara') });
		await addImages(app, file(`${ROOT}/Codex/Characters/Mara.md`), [png('a.png')]);
		await trashSheet(app, file(`${ROOT}/Codex/Characters/Mara.md`), false);
		const trashed = [...vault.files.entries()].find(([p]) => p.startsWith('.trash/') && p.endsWith('Mara.md'));
		expect(trashed?.[1]).toContain(`![[${ROOT}/Images/Characters/Mara (kept)/a.png]]`);
	});

	it('the Images folder name changes everywhere or nowhere', async () => {
		const { app, vault, file } = base({ 'Q/Q.storygrid': '{}', [`${ROOT}/Codex/Characters/Mara.md`]: sheetDoc('character', 'Mara'), 'Q/Codex/Characters/Ilse.md': sheetDoc('character', 'Ilse') });
		await addImages(app, file(`${ROOT}/Codex/Characters/Mara.md`), [png('a.png')]);
		await addImages(app, file('Q/Codex/Characters/Ilse.md'), [png('b.png')]);
		vault.folders.add('Q/Art');
		const result = await renameImagesFolders(app, [ROOT, 'Q'], 'Images', 'Art');
		expect(result.blocked).toEqual(['Q/Art']);
		expect(vault.files.has(`${ROOT}/Images/Characters/Mara/a.png`)).toBe(true);
		expect(vault.files.has('Q/Images/Characters/Ilse/b.png')).toBe(true);
	});

	it('"Keep images" renames the leftovers, so a new sheet with that name starts empty', async () => {
		const { app, vault, file } = base({ [`${ROOT}/Codex/Characters/Mara.md`]: sheetDoc('character', 'Mara') });
		await addImages(app, file(`${ROOT}/Codex/Characters/Mara.md`), [png('a.png')]);
		await trashSheet(app, file(`${ROOT}/Codex/Characters/Mara.md`), false);
		expect(vault.files.has(`${ROOT}/Images/Characters/Mara (kept)/a.png`)).toBe(true);
		vault.seed(`${ROOT}/Codex/Characters/Mara.md`, sheetDoc('character', 'Mara'));
		expect((await listSheetImages(app, file(`${ROOT}/Codex/Characters/Mara.md`))).images).toEqual([]);
	});

	it('a sheet in a sub-folder saves its pictures where they are looked for', async () => {
		const { app, file } = base({ [`${ROOT}/Codex/Characters/Villains/Mara.md`]: sheetDoc('character', 'Mara') });
		const mara = file(`${ROOT}/Codex/Characters/Villains/Mara.md`);
		const [a, b] = await addImages(app, mara, [png('a.png'), png('b.png')]);
		expect(a.path).toBe(`${ROOT}/Images/Characters/Villains › Mara/a.png`);
		expect(isSheetOwnImage(app, mara, b)).toBe(true);
		expect((await listSheetImages(app, mara)).images).toHaveLength(2);
	});

	it('an existing "images" folder with other capitals is found again', async () => {
		const { app, vault, file } = base({ [`${ROOT}/Codex/Characters/Mara.md`]: sheetDoc('character', 'Mara') });
		vault.folders.add(`${ROOT}/images`);
		const mara = file(`${ROOT}/Codex/Characters/Mara.md`);
		const [a] = await addImages(app, mara, [png('a.png'), png('b.png')]);
		expect(a.path).toBe(`${ROOT}/images/Characters/Mara/a.png`);
		expect((await listSheetImages(app, mara)).images).toHaveLength(2);
		expect((await sheetDeletePlan(app, mara)).trashable).toHaveLength(2);
	});

	it('a renamed project folder is left alone; a sub-folder moved to another project is followed', async () => {
		const { app, vault, file } = base({ 'Q/Q.storygrid': '{}', [`${ROOT}/Codex/Characters/Villains/Mara.md`]: sheetDoc('character', 'Mara') });
		const mara = file(`${ROOT}/Codex/Characters/Villains/Mara.md`);
		await addImages(app, mara, [png('a.png')]);
		// Villains/ dragged into project Q.
		vault.folders.add('Q/Codex'); vault.folders.add('Q/Codex/Characters');
		await vault.rename(vault.getAbstractFileByPath(`${ROOT}/Codex/Characters/Villains`) as TFolder, 'Q/Codex/Characters/Villains');
		const moved = file('Q/Codex/Characters/Villains/Mara.md');
		expect(shouldFollowRename(app, moved, `${ROOT}/Codex/Characters/Villains/Mara.md`)).toBe(true);
		await followSheetRename(app, moved, `${ROOT}/Codex/Characters/Villains/Mara.md`);
		expect(vault.files.has('Q/Images/Characters/Villains › Mara/a.png')).toBe(true);
		// Project folder P renamed to R: its Images folder came along; nothing to do.
		vault.seed('P/Codex/Characters/Ilse.md', sheetDoc('character', 'Ilse'));
		await vault.rename(vault.getAbstractFileByPath('P') as TFolder, 'R');
		expect(shouldFollowRename(app, file('R/Codex/Characters/Ilse.md'), 'P/Codex/Characters/Ilse.md')).toBe(false);
	});

	it('changing the Images folder name renames every project’s folder, and refuses sheet folder names', async () => {
		const { app, vault, file } = base({ 'Q/Q.storygrid': '{}', [`${ROOT}/Codex/Characters/Mara.md`]: sheetDoc('character', 'Mara') });
		const mara = file(`${ROOT}/Codex/Characters/Mara.md`);
		await addImages(app, mara, [png('a.png')]);
		expect(imagesFolderNameProblem('Codex')).toBe('taken');
		expect(imagesFolderNameProblem('characters')).toBe('taken');
		expect(imagesFolderNameProblem('Pictures')).toBeNull();
		await renameImagesFolders(app, [ROOT, 'Q'], 'Images', 'Pictures');
		expect(vault.files.has(`${ROOT}/Pictures/Characters/Mara/a.png`)).toBe(true);
		expect(vault.files.get(mara.path)).toContain(`![[${ROOT}/Pictures/Characters/Mara/a.png]]`);
	});
});

/** Every picture link on the sheet still opens a file. */
function linkTargetOk(app: App, sheet: TFile): boolean {
	const content = (app.vault as unknown as FakeVault).files.get(sheet.path) ?? '';
	return portraitLinks(content, sheet.basename).every((l) => app.metadataCache.getFirstLinkpathDest(l.split('|')[0], sheet.path) !== null);
}
