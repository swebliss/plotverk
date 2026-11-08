import { entityFolderForGrid } from './entity-manager';

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
});
