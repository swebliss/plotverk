import { DashboardSettings } from '../grid-data';
import { FakeVault, fakeApp } from '../test/fake-vault';
import {
	flushProjectMirrors,
	mirrorPath,
	holdProjectMirrors,
	projectDataReady,
	readProjectMirror,
	rekeyScheduledMirrors,
	releaseProjectMirrors,
	scheduleProjectMirror,
	syncProjectMirrors,
	writeProjectMirror,
} from './project-data-store';

const ROOT = 'Saltmarch';
const MIRROR = 'Saltmarch/pvbackup/Project data.json';
const LEGACY = 'Saltmarch/.storygrid-data.json';

/** A vault where the project's folder exists (a data copy is never written for a folder that doesn't). */
function projectVault(): FakeVault {
	const v = new FakeVault();
	v.folders.add(ROOT);
	return v;
}

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
		const v = projectVault();
		const app = fakeApp(v);
		await writeProjectMirror(app, ROOT, dash('first'));
		await writeProjectMirror(app, ROOT, dash('second'));
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('second');
		expect(v.files.has('Saltmarch/pvbackup/What is this folder.md')).toBe(true);
	});

	it('skips the disk when nothing changed', async () => {
		const v = projectVault();
		const app = fakeApp(v);
		await writeProjectMirror(app, ROOT, dash('same'));
		await writeProjectMirror(app, ROOT, dash('same'));
		expect(v.written.filter((p) => p === MIRROR)).toHaveLength(1);
	});

	it('survives several fire-and-forget writes at once, last one wins', async () => {
		const v = projectVault();
		const app = fakeApp(v);
		await Promise.all([1, 2, 3].map((n) => writeProjectMirror(app, ROOT, dash(`write ${n}`))));
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('write 3');
	});

	it('writes nothing for a project with no data', async () => {
		const v = projectVault();
		await writeProjectMirror(fakeApp(v), ROOT, dash());
		expect(v.files.size).toBe(0);
	});

	it('never writes the old hidden file', async () => {
		const v = projectVault();
		v.seed(LEGACY, '{"todos":[]}');
		await writeProjectMirror(fakeApp(v), ROOT, dash('new'));
		expect(v.files.get(LEGACY)).toBe('{"todos":[]}');
	});
});

describe('recovery', () => {
	it('reads the safety-folder copy first', async () => {
		const v = projectVault();
		v.seed(MIRROR, JSON.stringify({ todos: [{ id: 'a', text: 'new copy', done: false, createdAt: '2026-11-01' }] }));
		v.seed(LEGACY, JSON.stringify({ todos: [{ id: 'b', text: 'old copy', done: false, createdAt: '2026-11-01' }] }));
		expect((await readProjectMirror(fakeApp(v), ROOT))?.todos?.[0].text).toBe('new copy');
	});

	it('falls back to the old hidden copy', async () => {
		const v = projectVault();
		v.seed(LEGACY, JSON.stringify({ todos: [{ id: 'b', text: 'old copy', done: false, createdAt: '2026-11-01' }] }));
		const d = dash();
		expect(await syncProjectMirrors(fakeApp(v), d, [ROOT])).toBe(true);
		expect(d.todos[ROOT][0].text).toBe('old copy');
	});

	// The old hidden copy is the first write ever made — months stale — so it must not stand in for a damaged new one.
	it('does NOT fall back to the old hidden copy when the new one exists but is damaged', async () => {
		const v = projectVault();
		v.seed(MIRROR, '{ broken');
		v.seed(LEGACY, JSON.stringify({ todos: [{ id: 'b', text: 'old copy', done: false, createdAt: '2026-11-01' }] }));
		expect(await readProjectMirror(fakeApp(v), ROOT)).toBeNull();
	});

	it('refreshes the copy when local settings have data', async () => {
		const v = projectVault();
		expect(await syncProjectMirrors(fakeApp(v), dash('local'), [ROOT])).toBe(false);
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('local');
	});
});

describe('Book order note', () => {
	const ORDER = 'Saltmarch/pvbackup/Book order.md';

	it('is written next to the data copy from the outline tree', async () => {
		const v = projectVault();
		const d = dash();
		(d.sceneTree ??= {})[ROOT] = [{ id: 'a', kind: 'divider', label: 'Act 1', children: [
			{ id: 'b', kind: 'doc', docPath: 'Saltmarch/Scenes/Opening.md', children: [] },
		] }];
		await writeProjectMirror(fakeApp(v), ROOT, d);
		expect(v.files.get(ORDER)).toContain('## Act 1\n\n- Opening');
	});

	it('falls back to the old flat scene order', async () => {
		const v = projectVault();
		const d = dash();
		(d.sceneOrder ??= {})[ROOT] = ['Saltmarch/Scenes/One.md', 'Saltmarch/Scenes/Two.md'];
		await writeProjectMirror(fakeApp(v), ROOT, d);
		expect(v.files.get(ORDER)).toContain('- One\n- Two');
	});

	it('is not written for a project without scenes in its outline', async () => {
		const v = projectVault();
		await writeProjectMirror(fakeApp(v), ROOT, dash('a task'));
		expect(v.files.has(ORDER)).toBe(false);
	});
});

describe('scheduleProjectMirror (typing-rate callers)', () => {
	// The store uses `window.setTimeout`; Jest's node environment has no `window`, so alias it.
	beforeEach(() => {
		(globalThis as { window?: unknown }).window = globalThis;
		jest.useFakeTimers();
	});
	afterEach(() => {
		jest.useRealTimers();
		delete (globalThis as { window?: unknown }).window;
	});

	it('coalesces a burst into one write ~30 s later, with the latest data', async () => {
		const v = projectVault();
		const app = fakeApp(v);
		for (let i = 1; i <= 20; i++) scheduleProjectMirror(app, ROOT, dash(`tick ${i}`));
		expect(v.files.has(MIRROR)).toBe(false);
		await jest.advanceTimersByTimeAsync(30_000);
		expect(v.written.filter((p) => p === MIRROR)).toHaveLength(1);
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('tick 20');
	});

	it('flushProjectMirrors writes pending copies right away (plugin unload)', async () => {
		const v = projectVault();
		scheduleProjectMirror(fakeApp(v), ROOT, dash('unsaved'));
		flushProjectMirrors();
		await jest.advanceTimersByTimeAsync(0);
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('unsaved');
	});

	it('a scheduled copy for a renamed project never brings the old folder back', async () => {
		const v = new FakeVault();
		v.folders.add('Saltmarch Saga');
		const app = fakeApp(v);
		const d = dash('typed');
		scheduleProjectMirror(app, ROOT, d);
		// The folder is renamed before the 30 s are up, and the settings key follows.
		d.todos['Saltmarch Saga'] = d.todos[ROOT];
		delete d.todos[ROOT];
		rekeyScheduledMirrors((root) => (root === ROOT ? 'Saltmarch Saga' : null));
		await jest.advanceTimersByTimeAsync(30_000);
		expect(v.folders.has(ROOT)).toBe(false);
		expect(JSON.parse(v.files.get('Saltmarch Saga/pvbackup/Project data.json')!).todos[0].text).toBe('typed');
	});

	it('an old scheduled copy whose folder is gone writes nothing', async () => {
		const v = new FakeVault();
		scheduleProjectMirror(fakeApp(v), ROOT, dash('typed'));
		await jest.advanceTimersByTimeAsync(30_000);
		expect(v.folders.has(ROOT)).toBe(false);
		expect(v.files.size).toBe(0);
	});
});

describe('startup hold (views drawn before the copies are read never overwrite them)', () => {
	afterEach(() => releaseProjectMirrors());

	it('holds writes, lets the startup check write and read, then writes what was held', async () => {
		const v = projectVault();
		v.seed(MIRROR, JSON.stringify({ projectRoot: ROOT, todos: [{ id: 'real', text: 'the real list', done: false, createdAt: 'x' }] }));
		const app = fakeApp(v);
		holdProjectMirrors();
		expect(projectDataReady()).toBe(false);
		// A view draws first and writes a fresh, near-empty copy: held.
		const fresh = dash('fresh starter');
		await writeProjectMirror(app, ROOT, fresh);
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].id).toBe('real');
		// The startup check still sees (and recovers from) the real copy.
		const d = dash();
		await syncProjectMirrors(app, d, [ROOT]);
		expect(d.todos[ROOT][0].id).toBe('real');
		releaseProjectMirrors();
		expect(projectDataReady()).toBe(true);
		await new Promise((r) => setTimeout(r, 0));
		expect(JSON.parse(v.files.get(MIRROR)!).todos[0].text).toBe('fresh starter');
	});
});

describe('moves: the copy knows which folder it was written for', () => {
	it('stores the project folder inside the copy', async () => {
		const v = projectVault();
		await writeProjectMirror(fakeApp(v), ROOT, dash('a'));
		expect(JSON.parse(v.files.get(MIRROR)!).projectRoot).toBe(ROOT);
	});

	it('never creates a folder for a project that does not exist (no ghost folder)', async () => {
		const v = new FakeVault();
		await writeProjectMirror(fakeApp(v), ROOT, dash('a'));
		expect(v.folders.has(ROOT)).toBe(false);
		expect(v.files.size).toBe(0);
	});

	it('the vault-root project ("") is still written', async () => {
		const v = new FakeVault();
		const d = { goals: {}, todos: { '': [{ id: 't', text: 'root', done: false, createdAt: 'x' }] }, typedWords: {} } as unknown as DashboardSettings;
		await writeProjectMirror(fakeApp(v), '', d);
		expect(JSON.parse(v.files.get('pvbackup/Project data.json')!).projectRoot).toBe('');
	});

	it('recovering a copy that travelled with a moved folder points its paths at the new place', async () => {
		const v = new FakeVault();
		v.seed('Books/Saltmarch/Scenes/Opening.md', '');
		v.seed('Books/Saltmarch/pvbackup/Project data.json', JSON.stringify({
			projectRoot: ROOT,
			todos: [{ id: 't', text: 'x', done: false, createdAt: 'x', link: { kind: 'scene', path: 'Saltmarch/Scenes/Opening.md', label: 'Opening' } }],
			sceneOrder: ['Saltmarch/Scenes/Opening.md'],
			sceneTree: [{ id: 'n', kind: 'doc', docPath: 'Saltmarch/Scenes/Opening.md', children: [] }],
			quietLeftOut: ['Saltmarch/Characters/M.md'],
		}));
		const d = dash();
		expect(await syncProjectMirrors(fakeApp(v), d, ['Books/Saltmarch'])).toBe(true);
		const root = 'Books/Saltmarch';
		expect(d.todos[root][0].link!.path).toBe('Books/Saltmarch/Scenes/Opening.md');
		expect(d.sceneOrder![root]).toEqual(['Books/Saltmarch/Scenes/Opening.md']);
		expect(d.sceneTree![root][0].docPath).toBe('Books/Saltmarch/Scenes/Opening.md');
		expect(d.quietLeftOut![root]).toEqual(['Books/Saltmarch/Characters/M.md']);
		expect((d as unknown as Record<string, unknown>).projectRoot).toBeUndefined();
	});

	it('an old copy without a stored folder still loads exactly as before', async () => {
		const v = projectVault();
		v.seed(MIRROR, JSON.stringify({ sceneOrder: ['Elsewhere/Scenes/A.md'] }));
		const d = dash();
		expect(await syncProjectMirrors(fakeApp(v), d, [ROOT])).toBe(true);
		expect(d.sceneOrder![ROOT]).toEqual(['Elsewhere/Scenes/A.md']);
	});

	it('settings still holding the project under its old, vanished folder: hands the move over instead of using the older copy', async () => {
		const v = new FakeVault();
		v.seed('Saltmarch Saga/pvbackup/Project data.json', JSON.stringify({ projectRoot: ROOT, todos: [{ id: 'old', text: 'copy', done: false, createdAt: 'x' }] }));
		const d = dash('newest settings');
		const adopted: Array<[string, string]> = [];
		const adopt = (from: string, to: string) => {
			adopted.push([from, to]);
			d.todos[to] = d.todos[from];
			delete d.todos[from];
			return true;
		};
		expect(await syncProjectMirrors(fakeApp(v), d, ['Saltmarch Saga'], { adoptMovedProject: adopt })).toBe(true);
		expect(adopted).toEqual([[ROOT, 'Saltmarch Saga']]);
		expect(d.todos['Saltmarch Saga'][0].text).toBe('newest settings');
		expect(JSON.parse(v.files.get('Saltmarch Saga/pvbackup/Project data.json')!).todos[0].text).toBe('newest settings');
	});

	it('hands the move over even when the new place already got starter data (the move merges, nothing lost)', async () => {
		const v = new FakeVault();
		v.seed('Saltmarch Saga/pvbackup/Project data.json', JSON.stringify({ projectRoot: ROOT, todos: [] }));
		const d = dash('real task');
		d.todos['Saltmarch Saga'] = [{ id: 'starter', text: 'starter', done: false, createdAt: 'x' }];
		const adopt = jest.fn(() => true);
		await syncProjectMirrors(fakeApp(v), d, ['Saltmarch Saga'], { adoptMovedProject: adopt });
		expect(adopt).toHaveBeenCalledWith(ROOT, 'Saltmarch Saga');
	});

	it('after handing over, outline rows only the travelled copy still has are kept (a move synced in as delete + create)', async () => {
		const v = new FakeVault();
		v.seed('Saltmarch Saga/pvbackup/Project data.json', JSON.stringify({
			projectRoot: ROOT,
			sceneTree: [
				{ id: 'a', kind: 'doc', docPath: 'Saltmarch/Scenes/A.md', children: [] },
				{ id: 'b', kind: 'doc', docPath: 'Saltmarch/Scenes/B.md', children: [] },
			],
		}));
		const d = dash('task');
		// Settings lost row B to the "delete" half of the synced move.
		(d.sceneTree ??= {})[ROOT] = [{ id: 'a', kind: 'doc', docPath: 'Saltmarch/Scenes/A.md', children: [] }];
		const adopt = (from: string, to: string) => {
			for (const m of ['todos', 'sceneTree'] as const) {
				const map = d[m] as Record<string, unknown>;
				map[to] = map[from];
				delete map[from];
			}
			d.sceneTree![to] = [{ id: 'a', kind: 'doc', docPath: 'Saltmarch Saga/Scenes/A.md', children: [] }];
			return true;
		};
		await syncProjectMirrors(fakeApp(v), d, ['Saltmarch Saga'], { adoptMovedProject: adopt });
		expect(d.sceneTree!['Saltmarch Saga'].map((n) => n.docPath)).toEqual(['Saltmarch Saga/Scenes/A.md', 'Saltmarch Saga/Scenes/B.md']);
	});

	it('an empty day list created before the check does not block recovery', async () => {
		const v = projectVault();
		v.seed(MIRROR, JSON.stringify({ projectRoot: ROOT, todos: [{ id: 'real', text: 'real', done: false, createdAt: 'x' }] }));
		const d = dash();
		d.typedWords[ROOT] = {};
		await syncProjectMirrors(fakeApp(v), d, [ROOT]);
		expect(d.todos[ROOT][0].id).toBe('real');
	});

	it('one damaged copy never stops the check of the other projects', async () => {
		const v = new FakeVault();
		v.seed('A/pvbackup/Project data.json', JSON.stringify({ projectRoot: 'Old A', todos: [null] }));
		v.seed('B/pvbackup/Project data.json', JSON.stringify({ todos: [{ id: 'b', text: 'kept', done: false, createdAt: 'x' }] }));
		const d = dash();
		const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		await syncProjectMirrors(fakeApp(v), d, ['A', 'B']);
		spy.mockRestore();
		expect(d.todos['B'][0].text).toBe('kept');
	});

	it('does not hand over when the old folder still exists (a copied project folder)', async () => {
		const v = projectVault();
		v.seed('Saltmarch copy/pvbackup/Project data.json', JSON.stringify({ projectRoot: ROOT, sceneOrder: ['Saltmarch/Scenes/A.md'] }));
		const d = dash('original');
		const adopt = jest.fn(() => true);
		await syncProjectMirrors(fakeApp(v), d, ['Saltmarch copy'], { adoptMovedProject: adopt });
		expect(adopt).not.toHaveBeenCalled();
		expect(d.todos[ROOT][0].text).toBe('original');
		expect(d.sceneOrder!['Saltmarch copy']).toEqual(['Saltmarch copy/Scenes/A.md']);
	});
});
