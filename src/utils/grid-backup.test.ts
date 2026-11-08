import { FakeVault, fakeApp } from '../test-support/fake-vault';
import { listGridBackups, restoreNewestValidBackup, writeGridBackup } from './grid-backup';

const GRID = 'Saltmarch/Saltmarch.storygrid';
const NEW_DIR = 'Saltmarch/pvbackup/Grid backups/Saltmarch';
const OLD_DIR = 'Saltmarch/.storygrid-backups';

function vaultWithGrid(): FakeVault {
	const v = new FakeVault();
	v.seed(GRID, '{"name":"live"}');
	return v;
}

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
let tick = 0;
/** Each backup gets its own second, so stamps are distinct and ordered. */
async function backup(v: FakeVault, content: string): Promise<void> {
	jest.setSystemTime(T0 + 1000 * tick++);
	await writeGridBackup(fakeApp(v), GRID, content);
}

describe('grid backups in the visible safety folder', () => {
	beforeEach(() => { jest.useFakeTimers(); tick = 0; });
	afterEach(() => jest.useRealTimers());

	it('writes into pvbackup/Grid backups/<grid name>/ and creates the explainer note', async () => {
		const v = vaultWithGrid();
		await backup(v, '{"v":1}');
		expect(v.files.get(`${NEW_DIR}/2026-11-01T10-00-00-000Z.json`)).toBe('{"v":1}');
		expect(v.files.get('Saltmarch/pvbackup/What is this folder.md')).toContain('# What is this folder?');
	});

	it('keeps only the newest 3 of its own backups', async () => {
		const v = vaultWithGrid();
		const app = fakeApp(v);
		for (let i = 1; i <= 5; i++) await backup(v, `{"v":${i}}`);
		const left = [...v.files.keys()].filter((p) => p.startsWith(NEW_DIR));
		expect(left).toHaveLength(3);
		expect(left.map((p) => v.files.get(p)).sort()).toEqual(['{"v":3}', '{"v":4}', '{"v":5}']);
	});

	it('never prunes, rewrites or deletes the old hidden backups', async () => {
		const v = vaultWithGrid();
		for (let i = 0; i < 5; i++) v.seed(`${OLD_DIR}/Saltmarch.2026-08-30T16-56-4${i}-000Z.bak.storygrid`, `{"old":${i}}`);
		const app = fakeApp(v);
		for (let i = 1; i <= 4; i++) await backup(v, `{"v":${i}}`);
		expect([...v.files.keys()].filter((p) => p.startsWith(OLD_DIR))).toHaveLength(5);
		expect(v.deleted.some((p) => p.startsWith(OLD_DIR))).toBe(false);
		expect(v.written.some((p) => p.startsWith(OLD_DIR))).toBe(false);
	});

	it('lists new and old backups together, newest first', async () => {
		const v = vaultWithGrid();
		v.seed(`${OLD_DIR}/Saltmarch.2026-08-30T16-56-40-000Z.bak.storygrid`, '{"old":1}');
		v.seed(`${OLD_DIR}/Saltmarch Two.2026-12-30T16-56-40-000Z.bak.storygrid`, '{"other grid":1}');
		await backup(v, '{"v":1}');
		const list = await listGridBackups(fakeApp(v), GRID);
		expect(list.map((b) => [b.stamp, b.legacy])).toEqual([
			['2026-11-01T10-00-00-000Z', false],
			['2026-08-30T16-56-40-000Z', true],
		]);
	});

	it('restores from the old hidden folder when it holds the only good copy', async () => {
		const v = vaultWithGrid();
		v.seed(`${OLD_DIR}/Saltmarch.2026-08-30T16-56-40-000Z.bak.storygrid`, '{"old":"good"}');
		const app = fakeApp(v);
		await backup(v, 'not json {');
		const restored = await restoreNewestValidBackup(app, GRID);
		expect(restored?.content).toBe('{"old":"good"}');
	});

	it('prefers the newest valid backup', async () => {
		const v = vaultWithGrid();
		v.seed(`${OLD_DIR}/Saltmarch.2026-08-30T16-56-40-000Z.bak.storygrid`, '{"old":"good"}');
		const app = fakeApp(v);
		await backup(v, '{"new":"good"}');
		expect((await restoreNewestValidBackup(app, GRID))?.content).toBe('{"new":"good"}');
	});

	it('returns null when there is nothing valid to restore', async () => {
		expect(await restoreNewestValidBackup(fakeApp(vaultWithGrid()), GRID)).toBeNull();
	});

	it('a grid at the vault root gets pvbackup/ at the vault root', async () => {
		const v = new FakeVault();
		v.seed('Book.storygrid', '{}');
		await writeGridBackup(fakeApp(v), 'Book.storygrid', '{"v":1}');
		expect([...v.files.keys()].some((p) => p.startsWith('pvbackup/Grid backups/Book/'))).toBe(true);
	});
});
