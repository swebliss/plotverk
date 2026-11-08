import { isSafetyNetPath, joinVaultPath, safetyFolderFor } from './safety-paths';

describe('safetyFolderFor', () => {
	it('sits inside the project root', () => {
		expect(safetyFolderFor('Books/Saltmarch')).toBe('Books/Saltmarch/pvbackup');
	});
	it('handles a project at the vault root', () => {
		expect(safetyFolderFor('')).toBe('pvbackup');
	});
});

describe('joinVaultPath', () => {
	it('skips the empty vault-root segment', () => {
		expect(joinVaultPath('', 'pvbackup', 'Book order.md')).toBe('pvbackup/Book order.md');
	});
});

describe('isSafetyNetPath', () => {
	it.each([
		'Saltmarch/pvbackup/What is this folder.md',
		'Saltmarch/pvbackup/Book order.md',
		'Saltmarch/pvbackup/Project data.json',
		'Saltmarch/pvbackup/Grid backups',
		'Saltmarch/pvbackup/Grid backups/Book/2026-11-01T10-00-00-000Z.json',
		'Saltmarch/pvbackup/Scene snapshots/Act 1/Opening/2026-11-01T10-00-00-000Z.daily.txt',
		'pvbackup/Project data.json',
		'Saltmarch/pvbackup/Note snapshots/Codex/Mira/2026-11-01T10-00-00-000Z.manual.txt',
		// Sync-conflict twins of our own files
		'Saltmarch/pvbackup/Project data 2.json',
		'Saltmarch/pvbackup/Book order (conflict).md',
	])('matches our own file %s', (p) => {
		expect(isSafetyNetPath(p)).toBe(true);
	});

	// A writer's own folder may share the name (or be called "Plotverk", the old safety-folder name) — its notes must still refresh the views.
	it.each([
		'pvbackup/Scenes/Opening.md',
		'pvbackup/Characters/Mira.md',
		'pvbackup/Book.storygrid',
		'Saltmarch/pvbackup/My notes.md',
		'Saltmarch/pvbackup notes/Book order.md',
		'Saltmarch/Scenes/Book order.md',
		'Saltmarch/pvbackup/Grid backupsX/a.json',
		'Saltmarch/pvbackup',
		'pvbackup',
		'Plotverk/Scenes/Opening.md',
		'Saltmarch/Plotverk/Book order.md',
		'Saltmarch/Plotverk/Grid backups/Book/2026-11-01T10-00-00-000Z.json',
	])('leaves the writer\'s own file %s alone', (p) => {
		expect(isSafetyNetPath(p)).toBe(false);
	});
});
