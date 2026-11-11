import { FakeVault, fakeApp } from '../test/fake-vault';
import { sceneSnapshotFolderFor, sceneSnapshotRoot } from './scene-snapshots-paths';
import {
	ensureDailySnapshot,
	listSceneSnapshots,
	readSceneSnapshot,
	restoreSceneSnapshot,
	snapshotProjectNow,
	writeSceneSnapshot,
} from './scene-snapshots';

const SCENE = 'Saltmarch/Scenes/Act 1/Opening.md';
const NEW_DIR = 'Saltmarch/pvbackup/Scene snapshots/Act 1/Opening';
const OLD_DIR = 'Saltmarch/Scenes/Act 1/.storygrid-snapshots/Opening.md';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
let tick = 0;
function nextSecond(): void {
	jest.setSystemTime(T0 + 1000 * tick++);
}

beforeEach(() => { jest.useFakeTimers(); tick = 0; nextSecond(); });
afterEach(() => jest.useRealTimers());

function vault(): FakeVault {
	const v = new FakeVault();
	v.seed(SCENE, 'draft one');
	return v;
}

describe('sceneSnapshotFolderFor', () => {
	it('mirrors the path below Scenes inside the project safety folder', () => {
		expect(sceneSnapshotFolderFor(SCENE)).toBe(NEW_DIR);
	});
	it('handles a project at the vault root', () => {
		expect(sceneSnapshotFolderFor('Scenes/Opening.md')).toBe('pvbackup/Scene snapshots/Opening');
	});
	it('uses the first Scenes folder as the project boundary', () => {
		expect(sceneSnapshotRoot('Series/Book 1/Scenes/Scenes of war/Siege.md')).toEqual({
			root: 'Series/Book 1',
			dir: 'Scene snapshots',
			rel: 'Scenes of war/Siege.md',
		});
	});
	it('puts a document outside any Scenes folder under Note snapshots of its nearest project', () => {
		const isRoot = (f: string) => f === 'Saltmarch';
		expect(sceneSnapshotFolderFor('Saltmarch/Codex/Characters/Mira.md', isRoot))
			.toBe('Saltmarch/pvbackup/Note snapshots/Codex/Characters/Mira');
	});
	it('falls back to the vault root when no project encloses the document', () => {
		expect(sceneSnapshotFolderFor('Loose/Prologue.md')).toBe('pvbackup/Note snapshots/Loose/Prologue');
	});
	it('a note and a scene with the same name never share a history folder', () => {
		const isRoot = (f: string) => f === 'P';
		expect(sceneSnapshotFolderFor('P/Prologue.md', isRoot)).not.toBe(sceneSnapshotFolderFor('P/Scenes/Prologue.md', isRoot));
	});
	it('uses the OUTERMOST Scenes folder, so pvbackup/ never lands inside a Scenes folder', () => {
		expect(sceneSnapshotRoot('Scenes/Scenes/x.md').root).toBe('');
		expect(sceneSnapshotRoot('P/Scenes/Part/Scenes/x.md').root).toBe('P');
	});
	// The snapshot path must never look like a scene: word counts and scene lists match "/Scenes/" + ".md".
	it('never puts a Scenes/ segment or a .md file into the snapshot path', () => {
		expect(sceneSnapshotFolderFor(SCENE)).not.toMatch(/(?:^|\/)Scenes\//);
	});
});

describe('scene snapshots in the visible safety folder', () => {
	it('writes a .txt copy and the explainer note', async () => {
		const v = vault();
		expect(await writeSceneSnapshot(fakeApp(v), SCENE, 'draft one', 'manual')).toBe(true);
		expect(v.files.get(`${NEW_DIR}/2026-11-01T10-00-00-000Z.manual.txt`)).toBe('draft one');
		expect(v.files.has('Saltmarch/pvbackup/What is this folder.md')).toBe(true);
		expect(v.getMarkdownFiles().map((f) => f.path)).not.toContain(expect.stringContaining('Scene snapshots'));
	});

	it('skips a copy identical to the newest one', async () => {
		const v = vault();
		const app = fakeApp(v);
		await writeSceneSnapshot(app, SCENE, 'same', 'manual');
		nextSecond();
		expect(await writeSceneSnapshot(app, SCENE, 'same', 'manual')).toBe(false);
		expect((await listSceneSnapshots(app, SCENE))).toHaveLength(1);
	});

	it('keeps the newest 20 of its own copies and never touches old hidden ones', async () => {
		const v = vault();
		v.seed(`${OLD_DIR}/2026-08-01T10-00-00-000Z.daily.md`, 'old hidden');
		const app = fakeApp(v);
		for (let i = 0; i < 23; i++) {
			nextSecond();
			await writeSceneSnapshot(app, SCENE, `v${i}`, 'manual');
		}
		const list = await listSceneSnapshots(app, SCENE);
		expect(list.filter((s) => !s.legacy)).toHaveLength(20);
		expect(list.filter((s) => s.legacy)).toHaveLength(1);
		expect(v.files.get(`${OLD_DIR}/2026-08-01T10-00-00-000Z.daily.md`)).toBe('old hidden');
		// The three oldest went for good, not to the trash.
		expect(v.deleted.filter((p) => p.startsWith(NEW_DIR))).toHaveLength(3);
		expect(v.trashed).toHaveLength(0);
	});

	it('lists and restores an old hidden snapshot', async () => {
		const v = vault();
		v.seed(`${OLD_DIR}/2026-08-01T10-00-00-000Z.daily.md`, 'old hidden');
		const app = fakeApp(v);
		const [snap] = await listSceneSnapshots(app, SCENE);
		expect(snap.legacy).toBe(true);
		expect(await readSceneSnapshot(app, snap)).toBe('old hidden');
		await restoreSceneSnapshot(app, SCENE, snap);
		expect(v.files.get(SCENE)).toBe('old hidden');
		// The text it replaced was saved first.
		const after = await listSceneSnapshots(app, SCENE);
		expect(after[0].reason).toBe('pre-restore');
		expect(await readSceneSnapshot(app, after[0])).toBe('draft one');
	});

	it('restoring the oldest of 20 still works (read before the pre-restore copy prunes it)', async () => {
		const v = vault();
		const app = fakeApp(v);
		for (let i = 0; i < 20; i++) {
			nextSecond();
			await writeSceneSnapshot(app, SCENE, `v${i}`, 'manual');
		}
		const list = await listSceneSnapshots(app, SCENE);
		const oldest = list[list.length - 1];
		nextSecond();
		await restoreSceneSnapshot(app, SCENE, oldest);
		expect(v.files.get(SCENE)).toBe('v0');
	});

	it('takes one daily snapshot per day', async () => {
		const v = vault();
		const app = fakeApp(v);
		const seen = new Set<string>();
		await ensureDailySnapshot(app, SCENE, 'a', seen);
		nextSecond();
		await ensureDailySnapshot(app, SCENE, 'b', new Set());
		expect(await listSceneSnapshots(app, SCENE)).toHaveLength(1);
	});

	it('"Snapshot project now" counts the scenes it actually saved', async () => {
		const v = vault();
		v.seed('Saltmarch/Scenes/Act 1/Storm.md', 'storm');
		const app = fakeApp(v);
		expect(await snapshotProjectNow(app, 'Saltmarch')).toBe(2);
		nextSecond();
		expect(await snapshotProjectNow(app, 'Saltmarch')).toBe(0);
	});
});

describe('snapshots of a linked note outside Scenes', () => {
	it('go to the enclosing project\'s Note snapshots, not a stray pvbackup/ in the Codex folder', async () => {
		const v = vault();
		v.seed('Saltmarch/Saltmarch.storygrid', '{}');
		v.seed('Saltmarch/Codex/Characters/Mira.md', 'Mira');
		const app = fakeApp(v);
		expect(await writeSceneSnapshot(app, 'Saltmarch/Codex/Characters/Mira.md', 'Mira', 'manual')).toBe(true);
		expect([...v.files.keys()].some((p) => p.startsWith('Saltmarch/pvbackup/Note snapshots/Codex/Characters/Mira/'))).toBe(true);
		expect([...v.folders].some((p) => p.startsWith('Saltmarch/Codex/Characters/pvbackup'))).toBe(false);
	});
});
