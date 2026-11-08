import { backupBaseName, backupFileName, backupFolderFor, isBackupNameFor } from './grid-backup-names';

describe('backupFolderFor', () => {
	it('puts the hidden folder next to the grid', () => {
		expect(backupFolderFor('My Story/Plot Grid/Book.storygrid')).toBe(
			'My Story/Plot Grid/.storygrid-backups'
		);
	});

	it('handles a grid at the vault root', () => {
		expect(backupFolderFor('Book.storygrid')).toBe('.storygrid-backups');
	});
});

describe('backupBaseName', () => {
	it('strips the folder and the .storygrid extension', () => {
		expect(backupBaseName('My Story/Plot Grid/Book.storygrid')).toBe('Book');
	});

	it('keeps dots that are part of the name', () => {
		expect(backupBaseName('Book.2.storygrid')).toBe('Book.2');
	});
});

describe('isBackupNameFor', () => {
	const STAMP = '2026-08-19T16-39-29-973Z';

	it('matches this grid own backup', () => {
		expect(isBackupNameFor(`Book.${STAMP}.bak.storygrid`, 'Book')).toBe(true);
	});

	it('round-trips the name the writer actually generates', () => {
		expect(isBackupNameFor(backupFileName('Book', new Date()), 'Book')).toBe(true);
	});

	it('does not match a longer grid name that starts the same', () => {
		expect(isBackupNameFor(`Book Two.${STAMP}.bak.storygrid`, 'Book')).toBe(false);
	});

	it('does not match a dotted sibling grid name', () => {
		expect(isBackupNameFor(`Book.2.${STAMP}.bak.storygrid`, 'Book')).toBe(false);
	});

	it('does not match the shorter grid backup from the longer grid side', () => {
		expect(isBackupNameFor(`Book.${STAMP}.bak.storygrid`, 'Book.2')).toBe(false);
	});

	it('matches a grid whose own name contains dots', () => {
		expect(isBackupNameFor(`Book.2.${STAMP}.bak.storygrid`, 'Book.2')).toBe(true);
	});

	it('rejects a file with the right base but no timestamp', () => {
		expect(isBackupNameFor('Book.notes.bak.storygrid', 'Book')).toBe(false);
	});

	it('rejects the live grid file itself', () => {
		expect(isBackupNameFor('Book.storygrid', 'Book')).toBe(false);
	});

	it('rejects a stray file without the backup suffix', () => {
		expect(isBackupNameFor(`Book.${STAMP}.md`, 'Book')).toBe(false);
	});
});
