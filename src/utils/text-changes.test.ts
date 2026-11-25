import { DashboardSettings } from '../grid-data';
import { addTextChange, cleanTextChanges, findTextChange, mergeTextChanges, placesIn, MAX_TEXT_CHANGES, TextChangeRecord } from './text-changes';
import { applyPathMove, rebaseSlicePaths } from './project-move';
import { extractProjectSlice } from './project-data-store';
import { buildHistory } from './history';

function record(id: string, root = 'Novel', at = '2026-11-24T10:00:00.000Z'): TextChangeRecord {
	return {
		id, at, kind: 'alias',
		sheetPath: `${root}/Codex/Characters/Mr Gibbins.md`, sheetId: 'sg_1', sheetName: 'Mr Gibbins',
		from: 'Dad', to: 'Papa', state: 'applied',
		files: [
			{ path: `${root}/Scenes/One.md`, edits: [{ before: 'Hi ', after: ' said', from: 'Dad', to: 'Papa' }] },
			{ path: `${root}/Scenes/Two.md`, edits: [
				{ before: '', after: ' left', from: 'Dad', to: 'Papa' },
				{ before: 'and ', after: '.', from: 'dad', to: 'papa' },
			] },
		],
	};
}

function dashWith(root: string, ...records: TextChangeRecord[]): DashboardSettings {
	return { goals: {}, todos: {}, typedWords: {}, streaks: {}, textChanges: { [root]: records } };
}

describe('text change records', () => {
	test('places counts every changed link', () => {
		expect(placesIn(record('a'))).toBe(3);
	});

	test('add keeps the newest MAX_TEXT_CHANGES', () => {
		const map: Record<string, TextChangeRecord[]> = {};
		for (let i = 0; i < MAX_TEXT_CHANGES + 5; i++) addTextChange(map, 'Novel', record(`r${i}`));
		expect(map['Novel']).toHaveLength(MAX_TEXT_CHANGES);
		expect(map['Novel'][0].id).toBe('r5');
	});

	test('find by id across projects', () => {
		const map = { A: [record('a', 'A')], B: [record('b', 'B')] };
		expect(findTextChange(map, 'b')?.root).toBe('B');
		expect(findTextChange(map, 'zzz')).toBeNull();
		expect(findTextChange(undefined, 'a')).toBeNull();
	});

	test('damaged records are dropped or mended, never thrown on', () => {
		const good = record('a');
		const mixed = [
			good,
			null,
			{ id: 'b' },
			{ ...record('c'), files: [{ path: 'x.md' }, { path: 'y.md', edits: [{ before: '', after: '', from: 'Dad', to: 'Papa' }, { from: 1 }] }, 'junk'] },
			{ ...record('d'), state: 'weird' },
		] as unknown;
		const out = cleanTextChanges(mixed);
		expect(out.map((r) => r.id)).toEqual(['a', 'c']);
		expect(out[1].files).toEqual([{ path: 'y.md', edits: [{ before: '', after: '', from: 'Dad', to: 'Papa' }] }]);
		expect(cleanTextChanges('nope')).toEqual([]);
	});

	test('merge keeps each record once, oldest first', () => {
		const a = record('a', 'N', '2026-11-20T00:00:00.000Z');
		const b = record('b', 'N', '2026-11-22T00:00:00.000Z');
		expect(mergeTextChanges([b], [a, b]).map((r) => r.id)).toEqual(['a', 'b']);
	});
});

describe('text change records follow the project', () => {
	test('a project folder rename moves the records and every path in them', () => {
		const settings = { dashboard: dashWith('Novel', record('a')) };
		const res = applyPathMove(settings, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true });
		expect(res.changed).toBe(true);
		const list = settings.dashboard.textChanges!['Saltmarch'];
		expect(list).toHaveLength(1);
		expect(settings.dashboard.textChanges!['Novel']).toBeUndefined();
		expect(list[0].sheetPath).toBe('Saltmarch/Codex/Characters/Mr Gibbins.md');
		expect(list[0].files.map((f) => f.path)).toEqual(['Saltmarch/Scenes/One.md', 'Saltmarch/Scenes/Two.md']);
		expect(res.touchedRoots).toContain('Saltmarch');
	});

	test('a scene file renamed: its path in the record follows', () => {
		const settings = { dashboard: dashWith('Novel', record('a')) };
		applyPathMove(settings, { oldPath: 'Novel/Scenes/One.md', newPath: 'Novel/Scenes/Opening.md', isFolder: false });
		expect(settings.dashboard.textChanges!['Novel'][0].files[0].path).toBe('Novel/Scenes/Opening.md');
	});

	test('the data copy in pvbackup carries the records', () => {
		const dash = dashWith('Novel', record('a'));
		expect(extractProjectSlice(dash, 'Novel').textChanges).toHaveLength(1);
	});

	test('a copy read back after a move nobody saw gets its paths rebased', () => {
		const out = rebaseSlicePaths({ textChanges: [record('a')] }, 'Novel', 'Books/Novel');
		expect(out.textChanges![0].files[1].path).toBe('Books/Novel/Scenes/Two.md');
		expect(out.textChanges![0].sheetPath).toBe('Books/Novel/Codex/Characters/Mr Gibbins.md');
	});
});

describe('Activity history shows text changes', () => {
	test('a record becomes an event on its day', () => {
		const r = record('a', 'Novel', new Date(2026, 10, 24, 15, 0).toISOString());
		const days = buildHistory({ todos: [], typedWords: {}, sprints: [], entityCreations: [], textChanges: [r] });
		expect(days).toHaveLength(1);
		expect(days[0].day).toBe('2026-11-24');
		expect(days[0].events[0]).toEqual({ type: 'text-change', record: r });
	});
});
