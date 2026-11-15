import type { App } from 'obsidian';
import { entityFolderForGrid } from './entity-manager';
import { buildProjectStructure, newProjectGridLocation } from '../utils/folder-builder';

describe('entityFolderForGrid', () => {
	it('puts sheets in the grid’s own project, per kind', () => {
		expect(entityFolderForGrid('Book One/Book One.storygrid', 'character')).toBe('Book One/Codex/Characters');
		expect(entityFolderForGrid('Book One/Book One.storygrid', 'location')).toBe('Book One/Codex/Places');
		expect(entityFolderForGrid('Book One/Book One.storygrid', 'scene')).toBe('Book One/Scenes');
	});

	it('depends only on the grid path, so two grids never share a destination', () => {
		const a = entityFolderForGrid('Old Book/Old.storygrid', 'character');
		const b = entityFolderForGrid('New Book/New.storygrid', 'character');
		expect(a).toBe('Old Book/Codex/Characters');
		expect(b).toBe('New Book/Codex/Characters');
	});

	it('handles nested projects and a grid at the vault root', () => {
		expect(entityFolderForGrid('Sweden/Gothenburg/Gothenburg.storygrid', 'character')).toBe('Sweden/Gothenburg/Codex/Characters');
		expect(entityFolderForGrid('Loose.storygrid', 'character')).toBe('Codex/Characters');
		expect(entityFolderForGrid(null, 'scene')).toBe('Scenes');
	});

	it('a new series: Book 1’s grid gives Book 1’s own Scenes folder, the one setup made for it (not the last book’s)', async () => {
		// Mirrors setupSeries → createGridFile (same helpers, same order): every book's folders
		// are built first, then the story lands on Book 1's grid. A writer who skips planning
		// gets a blank first scene in the folder worked out from that grid's path
		// (main.ts landAfterProjectCreation), never the last-built book's.
		const folders = new Set<string>();
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => (folders.has(p) ? {} : null),
				createFolder: async (p: string) => { folders.add(p); },
			},
		} as unknown as App;
		const seriesRoot = 'Stories/The Saga';
		const built: { gridPath: string; scenesPath: string }[] = [];
		for (const book of [' Book One ', 'Book: Two?', 'Book Three']) {
			const { safeName, gridFilePath } = newProjectGridLocation(book, seriesRoot);
			const { scenesPath } = await buildProjectStructure(app, seriesRoot, safeName);
			built.push({ gridPath: gridFilePath, scenesPath });
		}
		expect(built[0].gridPath).toBe('Stories/The Saga/Book One/Book One.storygrid');
		const firstBookScenes = entityFolderForGrid(built[0].gridPath, 'scene');
		expect(firstBookScenes).toBe('Stories/The Saga/Book One/Scenes');
		expect(folders.has(firstBookScenes)).toBe(true);
		expect(firstBookScenes).not.toBe(built[built.length - 1].scenesPath);
		// Every book: the folder worked out from its grid is exactly the one setup built.
		for (const b of built) expect(entityFolderForGrid(b.gridPath, 'scene')).toBe(b.scenesPath);
	});

	it('a standalone story, with or without a grid folder: the grid’s Scenes folder is the one setup built', async () => {
		const folders = new Set<string>();
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => (folders.has(p) ? {} : null),
				createFolder: async (p: string) => { folders.add(p); },
			},
		} as unknown as App;
		for (const parent of ['', 'Writing']) {
			const { safeName, gridFilePath } = newProjectGridLocation('My Novel', parent);
			const { scenesPath } = await buildProjectStructure(app, parent, safeName);
			expect(entityFolderForGrid(gridFilePath, 'scene')).toBe(scenesPath);
		}
	});
});
