import { DashboardSettings } from '../grid-data';
import { FakeVault, fakeApp } from '../test-support/fake-vault';
import {
	flushProjectMirrors,
	mirrorPath,
	readProjectMirror,
	scheduleProjectMirror,
	syncProjectMirrors,
	writeProjectMirror,
} from './project-data-store';

const ROOT = 'Saltmarch';
const MIRROR = 'Saltmarch/pvbackup/Project data.json';
const LEGACY = 'Saltmarch/.storygrid-data.json';

function dash(todoText?: string): DashboardSettings {
	const d = { goals: {}, todos: {}, typedWords: {} } as unknown as DashboardSettings;
	if (todoText) d.todos[ROOT] = [{ id: 't1', text: todoText, done: false, createdAt: '2026-11-01' }];
	return d;
}

describe('mirrorPath', () => {
	it('lives in the project safety folder', () => {
		expect(mirrorPath(ROOT)).toBe(MIRROR);
		expect(mirrorPath('')).toBe('pvbackup/Project data.json');
	});
});

describe('project data copy', () => {
	it('is created, then UPDATED on later writes (the old hidden copy never updated)', async () => {
		const v = new FakeVault();
		const app = fakeApp(v);
		await writeProjectMirror(app, ROOT, dash('first'));
		await writeProjectMirror(app, ROOT, dash('second'));
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('second');
		expect(v.files.has('Saltmarch/pvbackup/What is this folder.md')).toBe(true);
	});

	it('skips the disk when nothing changed', async () => {
		const v = new FakeVault();
		const app = fakeApp(v);
		await writeProjectMirror(app, ROOT, dash('same'));
		await writeProjectMirror(app, ROOT, dash('same'));
		expect(v.written.filter((p) => p === MIRROR)).toHaveLength(1);
	});

	it('survives several fire-and-forget writes at once, last one wins', async () => {
		const v = new FakeVault();
		const app = fakeApp(v);
		await Promise.all([1, 2, 3].map((n) => writeProjectMirror(app, ROOT, dash(`write ${n}`))));
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('write 3');
	});

	it('writes nothing for a project with no data', async () => {
		const v = new FakeVault();
		await writeProjectMirror(fakeApp(v), ROOT, dash());
		expect(v.files.size).toBe(0);
	});

	it('never writes the old hidden file', async () => {
		const v = new FakeVault();
		v.seed(LEGACY, '{"todos":[]}');
		await writeProjectMirror(fakeApp(v), ROOT, dash('new'));
		expect(v.files.get(LEGACY)).toBe('{"todos":[]}');
	});
});

describe('recovery', () => {
	it('reads the safety-folder copy first', async () => {
		const v = new FakeVault();
		v.seed(MIRROR, JSON.stringify({ todos: [{ id: 'a', text: 'new copy', done: false, createdAt: '2026-11-01' }] }));
		v.seed(LEGACY, JSON.stringify({ todos: [{ id: 'b', text: 'old copy', done: false, createdAt: '2026-11-01' }] }));
		expect((await readProjectMirror(fakeApp(v), ROOT))?.todos?.[0].text).toBe('new copy');
	});

	it('falls back to the old hidden copy', async () => {
		const v = new FakeVault();
		v.seed(LEGACY, JSON.stringify({ todos: [{ id: 'b', text: 'old copy', done: false, createdAt: '2026-11-01' }] }));
		const d = dash();
		expect(await syncProjectMirrors(fakeApp(v), d, [ROOT])).toBe(true);
		expect(d.todos[ROOT][0].text).toBe('old copy');
	});

	// The old hidden copy is the first write ever made — months stale — so it must not stand in for a damaged new one.
	it('does NOT fall back to the old hidden copy when the new one exists but is damaged', async () => {
		const v = new FakeVault();
		v.seed(MIRROR, '{ broken');
		v.seed(LEGACY, JSON.stringify({ todos: [{ id: 'b', text: 'old copy', done: false, createdAt: '2026-11-01' }] }));
		expect(await readProjectMirror(fakeApp(v), ROOT)).toBeNull();
	});

	it('refreshes the copy when local settings have data', async () => {
		const v = new FakeVault();
		expect(await syncProjectMirrors(fakeApp(v), dash('local'), [ROOT])).toBe(false);
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('local');
	});
});

describe('Book order note', () => {
	const ORDER = 'Saltmarch/pvbackup/Book order.md';

	it('is written next to the data copy from the outline tree', async () => {
		const v = new FakeVault();
		const d = dash();
		(d.sceneTree ??= {})[ROOT] = [{ id: 'a', kind: 'divider', label: 'Act 1', children: [
			{ id: 'b', kind: 'doc', docPath: 'Saltmarch/Scenes/Opening.md', children: [] },
		] }];
		await writeProjectMirror(fakeApp(v), ROOT, d);
		expect(v.files.get(ORDER)).toContain('## Act 1\n\n- Opening');
	});

	it('falls back to the old flat scene order', async () => {
		const v = new FakeVault();
		const d = dash();
		(d.sceneOrder ??= {})[ROOT] = ['Saltmarch/Scenes/One.md', 'Saltmarch/Scenes/Two.md'];
		await writeProjectMirror(fakeApp(v), ROOT, d);
		expect(v.files.get(ORDER)).toContain('- One\n- Two');
	});

	it('is not written for a project without scenes in its outline', async () => {
		const v = new FakeVault();
		await writeProjectMirror(fakeApp(v), ROOT, dash('a task'));
		expect(v.files.has(ORDER)).toBe(false);
	});
});

describe('scheduleProjectMirror (typing-rate callers)', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('coalesces a burst into one write ~30 s later, with the latest data', async () => {
		const v = new FakeVault();
		const app = fakeApp(v);
		for (let i = 1; i <= 20; i++) scheduleProjectMirror(app, ROOT, dash(`tick ${i}`));
		expect(v.files.has(MIRROR)).toBe(false);
		await jest.advanceTimersByTimeAsync(30_000);
		expect(v.written.filter((p) => p === MIRROR)).toHaveLength(1);
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('tick 20');
	});

	it('flushProjectMirrors writes pending copies right away (plugin unload)', async () => {
		const v = new FakeVault();
		scheduleProjectMirror(fakeApp(v), ROOT, dash('unsaved'));
		flushProjectMirrors();
		await jest.advanceTimersByTimeAsync(0);
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('unsaved');
	});
});
