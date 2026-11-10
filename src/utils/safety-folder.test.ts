import { FakeVault, fakeApp } from '../test/fake-vault';
import { migrateSafetyFolders } from './safety-folder';
import { isSafetyNetPath, wasSafetyNetPath } from './safety-paths';

const OLD = 'Saltmarch/Plotverk';
const NEW = 'Saltmarch/pvbackup';

describe('wasSafetyNetPath', () => {
	it.each([`${OLD}/Grid backups/Saltmarch/a.json`, `${OLD}/Project data.json`, 'Plotverk/Note snapshots/x/y.txt'])(
		'%s was ours', (p) => expect(wasSafetyNetPath(p)).toBe(true));
	it.each(['Plotverk/Scenes/Opening.md', `${OLD}/My plan.md`, `${NEW}/Project data.json`])(
		'%s was not', (p) => expect(wasSafetyNetPath(p)).toBe(false));
});

describe('isSafetyNetPath ignores the folder\'s letter case (case-insensitive disks)', () => {
	it.each(['Saltmarch/PVBackup/Project data.json', 'Saltmarch/Pvbackup/Grid backups/a/b.json'])(
		'%s', (p) => expect(isSafetyNetPath(p)).toBe(true));
	it('but not the entry names', () => expect(isSafetyNetPath('Saltmarch/pvbackup/project data.json')).toBe(false));
});

describe('migrateSafetyFolders: Plotverk/ → pvbackup/', () => {
	it('moves the old safety folder\'s entries and writes the note in its new wording', async () => {
		const v = new FakeVault();
		v.seed(`${OLD}/What is this folder.md`, 'old note');
		v.seed(`${OLD}/Project data.json`, '{"a":1}');
		v.seed(`${OLD}/Book order.md`, 'order');
		v.seed(`${OLD}/Grid backups/Saltmarch/2026-11-01T10-00-00-000Z.json`, '{}');
		await migrateSafetyFolders(fakeApp(v));
		expect(v.files.get(`${NEW}/Project data.json`)).toBe('{"a":1}');
		expect(v.files.get(`${NEW}/Book order.md`)).toBe('order');
		expect(v.files.has(`${NEW}/Grid backups/Saltmarch/2026-11-01T10-00-00-000Z.json`)).toBe(true);
		expect(v.files.get(`${NEW}/What is this folder.md`)).toContain('Please leave this folder alone');
		expect(v.trashed).toEqual([`${OLD}/What is this folder.md`]);
		expect(v.folders.has(OLD)).toBe(false);
	});

	it('on a clash keeps the NEWER copy, whichever folder it is in, and trashes the other', async () => {
		const v = new FakeVault();
		v.seed(`${OLD}/What is this folder.md`, 'old note');
		v.seed(`${OLD}/Project data.json`, '{"old folder, newer":1}', 2000);
		v.seed(`${OLD}/Book order.md`, 'old folder, older', 1000);
		v.seed(`${NEW}/What is this folder.md`, 'new note');
		v.seed(`${NEW}/Project data.json`, '{"pvbackup, older":1}', 1000);
		v.seed(`${NEW}/Book order.md`, 'pvbackup, newer', 2000);
		await migrateSafetyFolders(fakeApp(v));
		expect(v.files.get(`${NEW}/Project data.json`)).toBe('{"old folder, newer":1}');
		expect(v.files.get(`${NEW}/Book order.md`)).toBe('pvbackup, newer');
		expect(v.trashed.sort()).toEqual([`${OLD}/Book order.md`, `${NEW}/Project data.json`, `${OLD}/What is this folder.md`].sort());
		expect(v.folders.has(OLD)).toBe(false);
	});

	it('merges snapshot folders entry by entry', async () => {
		const v = new FakeVault();
		v.seed(`${OLD}/What is this folder.md`, 'old note');
		v.seed(`${OLD}/Scene snapshots/Opening/2026-11-01T10-00-00-000Z.daily.txt`, 'v1');
		v.seed(`${NEW}/Scene snapshots/Opening/2026-11-02T10-00-00-000Z.daily.txt`, 'v2');
		await migrateSafetyFolders(fakeApp(v));
		expect(v.files.get(`${NEW}/Scene snapshots/Opening/2026-11-01T10-00-00-000Z.daily.txt`)).toBe('v1');
		expect(v.files.get(`${NEW}/Scene snapshots/Opening/2026-11-02T10-00-00-000Z.daily.txt`)).toBe('v2');
		expect(v.folders.has(OLD)).toBe(false);
	});

	it('finds old folders outside grid folders too (vault-root note snapshots)', async () => {
		const v = new FakeVault();
		v.seed('Plotverk/What is this folder.md', 'old note');
		v.seed('Plotverk/Note snapshots/Loose/Prologue/2026-11-01T10-00-00-000Z.manual.txt', 'p');
		await migrateSafetyFolders(fakeApp(v));
		expect(v.files.get('pvbackup/Note snapshots/Loose/Prologue/2026-11-01T10-00-00-000Z.manual.txt')).toBe('p');
	});

	it('never touches a writer\'s own "Plotverk" folder (no note of ours inside)', async () => {
		const v = new FakeVault();
		v.seed(`${OLD}/Project data.json`, 'theirs');
		v.seed(`${OLD}/Ideas.md`, 'theirs');
		await migrateSafetyFolders(fakeApp(v));
		expect(v.files.get(`${OLD}/Project data.json`)).toBe('theirs');
		expect(v.folders.has(NEW)).toBe(false);
	});

	it('moves only our exact entries: a writer\'s "Book order notes.md" stays, so does the folder', async () => {
		const v = new FakeVault();
		v.seed(`${OLD}/What is this folder.md`, 'old note');
		v.seed(`${OLD}/Book order notes.md`, 'theirs');
		v.seed(`${OLD}/My plan.md`, 'theirs');
		await migrateSafetyFolders(fakeApp(v));
		expect(v.files.get(`${OLD}/Book order notes.md`)).toBe('theirs');
		expect(v.files.get(`${OLD}/My plan.md`)).toBe('theirs');
		expect(v.folders.has(OLD)).toBe(true);
	});

	it('does nothing in a vault without old folders', async () => {
		const v = new FakeVault();
		v.seed('Saltmarch/Scenes/Opening.md', 'x');
		await migrateSafetyFolders(fakeApp(v));
		expect(v.written).toEqual([]);
	});
});

describe('migrateSafetyFolders: other-case PVBackup/ → pvbackup/', () => {
	it('renames it through a temporary name', async () => {
		const v = new FakeVault();
		v.seed('Saltmarch/PVBackup/What is this folder.md', 'note');
		v.seed('Saltmarch/PVBackup/Project data.json', '{}');
		await migrateSafetyFolders(fakeApp(v));
		expect(v.files.get(`${NEW}/Project data.json`)).toBe('{}');
		expect(v.folders.has('Saltmarch/PVBackup')).toBe(false);
		expect([...v.folders].some((p) => p.includes('renaming'))).toBe(false);
	});

	it('merges it when both exist (case-sensitive disks, e.g. Android)', async () => {
		const v = new FakeVault();
		v.seed('Saltmarch/PVBackup/What is this folder.md', 'note');
		v.seed('Saltmarch/PVBackup/Grid backups/S/2026-11-01T10-00-00-000Z.json', '{}');
		v.seed(`${NEW}/What is this folder.md`, 'note');
		await migrateSafetyFolders(fakeApp(v));
		expect(v.files.has(`${NEW}/Grid backups/S/2026-11-01T10-00-00-000Z.json`)).toBe(true);
		expect(v.folders.has('Saltmarch/PVBackup')).toBe(false);
	});
});

describe('migrateSafetyFolders: emptied old folders', () => {
	it('removes an old Plotverk/ that an earlier run emptied (no note left), on the next start', async () => {
		const v = new FakeVault();
		v.folders.add('Saltmarch');
		v.folders.add(OLD);
		v.seed(`${NEW}/Project data.json`, '{}');
		await migrateSafetyFolders(fakeApp(v));
		expect(v.folders.has(OLD)).toBe(false);
		expect(v.files.get(`${NEW}/Project data.json`)).toBe('{}');
	});

	it('keeps an old Plotverk/ that still holds anything, even a hidden file', async () => {
		const v = new FakeVault();
		v.seed(`${OLD}/.DS_Store`, 'x');
		await migrateSafetyFolders(fakeApp(v));
		expect(v.folders.has(OLD)).toBe(true);
		expect(v.files.get(`${OLD}/.DS_Store`)).toBe('x');
	});
});
