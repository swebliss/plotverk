import { DashboardSettings, StorygridSettings, TodoItem } from '../grid-data';
import {
	MovableSettings,
	applyPathMove,
	gridRootMove,
	keepOutlineFromCopy,
	movedRoot,
	rebasePath,
	rebaseSlicePaths,
	widenUnseenMove,
} from './project-move';

function todo(id: string, text: string, linkPath?: string): TodoItem {
	const t: TodoItem = { id, text, done: false, createdAt: '2026-11-01' };
	if (linkPath) t.link = { kind: 'scene', path: linkPath, label: linkPath.split('/').pop()!.replace(/\.md$/, '') };
	return t;
}

function emptyDash(): DashboardSettings {
	return { goals: {}, todos: {}, typedWords: {}, streaks: {} };
}

/** A project "Novel" with something in every root-keyed dashboard map. */
function seedProject(dash: DashboardSettings, root: string): void {
	const p = root ? `${root}/` : '';
	dash.goals[root] = { daily: 500 };
	dash.todos[root] = [todo('t1', 'Fix the opening', `${p}Scenes/Opening.md`)];
	dash.typedWords[root] = { '2026-11-01': 300 };
	dash.streaks[root] = { current: 3, longest: 5, lastDate: '2026-11-01' };
	(dash.celebratedGoals ??= {})[root] = { daily: '2026-11-01' };
	(dash.skippedWords ??= {})[root] = { '2026-11-01': 90 };
	(dash.sceneOrder ??= {})[root] = [`${p}Scenes/Opening.md`, `${p}Scenes/Second.md`];
	(dash.sceneTree ??= {})[root] = [
		{ id: 'd1', kind: 'divider', label: 'Act 1', children: [
			{ id: 'n1', kind: 'doc', docPath: `${p}Scenes/Opening.md`, children: [] },
		] },
		{ id: 'n2', kind: 'doc', docPath: `${p}Scenes/Second.md`, children: [] },
	];
	(dash.quietLeftOut ??= {})[root] = [`${p}Characters/Mira.md`];
}

function settingsWith(...roots: string[]): MovableSettings {
	const dashboard = emptyDash();
	for (const r of roots) seedProject(dashboard, r);
	return { dashboard };
}

const ROOT_MAPS = ['goals', 'todos', 'typedWords', 'streaks', 'celebratedGoals', 'skippedWords', 'sceneOrder', 'sceneTree', 'quietLeftOut'] as const;

function keysOf(s: MovableSettings, map: typeof ROOT_MAPS[number]): string[] {
	return Object.keys((s.dashboard as unknown as Record<string, Record<string, unknown>>)[map] ?? {}).sort();
}

describe('rebasePath (path segments, never a partial name)', () => {
	it('moves the folder itself and anything inside it', () => {
		expect(rebasePath('Book', 'Book', 'Novel')).toBe('Novel');
		expect(rebasePath('Book/Scenes/A.md', 'Book', 'Novel')).toBe('Novel/Scenes/A.md');
	});
	it('never matches a sibling whose name only starts the same', () => {
		expect(rebasePath('Book 2/Scenes/A.md', 'Book', 'Novel')).toBeNull();
		expect(rebasePath('Book 2', 'Book', 'Novel')).toBeNull();
		expect(rebasePath('Bookish', 'Book', 'Novel')).toBeNull();
	});
	it('handles the vault root on either side', () => {
		expect(rebasePath('Scenes/A.md', '', 'Novel')).toBe('Novel/Scenes/A.md');
		expect(rebasePath('', '', 'Novel')).toBe('Novel');
		expect(rebasePath('Novel/Scenes/A.md', 'Novel', '')).toBe('Scenes/A.md');
		expect(rebasePath('Novel', 'Novel', '')).toBe('');
	});
});

describe('applyPathMove — a project folder renamed', () => {
	it('carries every root-keyed map, and the paths inside them, to the new name', () => {
		const s = settingsWith('Novel');
		const r = applyPathMove(s, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true });
		expect(r.changed).toBe(true);
		for (const m of ROOT_MAPS) expect(keysOf(s, m)).toEqual(['Saltmarch']);
		const d = s.dashboard!;
		expect(d.todos['Saltmarch'][0].link!.path).toBe('Saltmarch/Scenes/Opening.md');
		expect(d.sceneOrder!['Saltmarch']).toEqual(['Saltmarch/Scenes/Opening.md', 'Saltmarch/Scenes/Second.md']);
		expect(d.sceneTree!['Saltmarch'][0].children[0].docPath).toBe('Saltmarch/Scenes/Opening.md');
		expect(d.sceneTree!['Saltmarch'][1].docPath).toBe('Saltmarch/Scenes/Second.md');
		expect(d.quietLeftOut!['Saltmarch']).toEqual(['Saltmarch/Characters/Mira.md']);
		expect(d.goals['Saltmarch']).toEqual({ daily: 500 });
		expect(d.typedWords['Saltmarch']).toEqual({ '2026-11-01': 300 });
		expect(d.streaks['Saltmarch'].current).toBe(3);
		expect(r.touchedRoots).toEqual(['Saltmarch']);
	});

	it('moves the active project along', () => {
		const s = settingsWith('Novel');
		s.activeProjectRoot = 'Novel';
		const r = applyPathMove(s, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true });
		expect(s.activeProjectRoot).toBe('Saltmarch');
		expect(r.activeChanged).toBe(true);
	});

	it('moved INTO another folder', () => {
		const s = settingsWith('Novel');
		applyPathMove(s, { oldPath: 'Novel', newPath: 'Writing/2026/Novel', isFolder: true });
		for (const m of ROOT_MAPS) expect(keysOf(s, m)).toEqual(['Writing/2026/Novel']);
		expect(s.dashboard!.todos['Writing/2026/Novel'][0].link!.path).toBe('Writing/2026/Novel/Scenes/Opening.md');
	});

	it('an ancestor holding two projects carries both', () => {
		const s = settingsWith('Drafts/One', 'Drafts/Two', 'Elsewhere');
		applyPathMove(s, { oldPath: 'Drafts', newPath: 'Books', isFolder: true });
		for (const m of ROOT_MAPS) expect(keysOf(s, m)).toEqual(['Books/One', 'Books/Two', 'Elsewhere']);
		expect(s.dashboard!.sceneOrder!['Books/Two'][0]).toBe('Books/Two/Scenes/Opening.md');
		expect(s.dashboard!.sceneOrder!['Elsewhere'][0]).toBe('Elsewhere/Scenes/Opening.md');
	});

	it('"Book" renamed leaves "Book 2" exactly as it was', () => {
		const s = settingsWith('Book', 'Book 2');
		s.activeProjectRoot = 'Book 2';
		const before = JSON.stringify(s.dashboard!.todos['Book 2']);
		applyPathMove(s, { oldPath: 'Book', newPath: 'Book 1', isFolder: true });
		expect(keysOf(s, 'todos')).toEqual(['Book 1', 'Book 2']);
		expect(JSON.stringify(s.dashboard!.todos['Book 2'])).toBe(before);
		expect(s.activeProjectRoot).toBe('Book 2');
	});

	it('a folder INSIDE a project only patches paths, the project key stays', () => {
		const s = settingsWith('Novel');
		applyPathMove(s, { oldPath: 'Novel/Scenes', newPath: 'Novel/Chapters', isFolder: true });
		expect(keysOf(s, 'todos')).toEqual(['Novel']);
		expect(s.dashboard!.sceneOrder!['Novel']).toEqual(['Novel/Chapters/Opening.md', 'Novel/Chapters/Second.md']);
		expect(s.dashboard!.todos['Novel'][0].link!.path).toBe('Novel/Chapters/Opening.md');
	});

	it('is idempotent: the same rename twice, then the per-file events that follow, change nothing more', () => {
		const s = settingsWith('Novel');
		applyPathMove(s, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true });
		const after = JSON.stringify(s);
		expect(applyPathMove(s, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true }).changed).toBe(false);
		for (const f of ['Scenes/Opening.md', 'Scenes/Second.md', 'Characters/Mira.md']) {
			expect(applyPathMove(s, { oldPath: `Novel/${f}`, newPath: `Saltmarch/${f}`, isFolder: false }).changed).toBe(false);
		}
		expect(JSON.stringify(s)).toBe(after);
	});

	it('does not depend on event order: child file events first, then the folder', () => {
		const a = settingsWith('Novel');
		const b = settingsWith('Novel');
		applyPathMove(a, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true });
		for (const f of ['Scenes/Opening.md', 'Scenes/Second.md', 'Characters/Mira.md']) {
			applyPathMove(b, { oldPath: `Novel/${f}`, newPath: `Saltmarch/${f}`, isFolder: false });
		}
		applyPathMove(b, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true });
		expect(b).toEqual(a);
	});

	it('leaves the vault-root project ("" root) alone when a folder is renamed', () => {
		const s = settingsWith('');
		s.activeProjectRoot = '';
		const before = JSON.stringify(s);
		expect(applyPathMove(s, { oldPath: 'Archive', newPath: 'Old', isFolder: true }).changed).toBe(false);
		expect(JSON.stringify(s)).toBe(before);
	});

	it('patches a vault-root project\'s paths when its Scenes folder moves', () => {
		const s = settingsWith('');
		applyPathMove(s, { oldPath: 'Scenes', newPath: 'Chapters', isFolder: true });
		expect(keysOf(s, 'todos')).toEqual(['']);
		expect(s.dashboard!.sceneOrder!['']).toEqual(['Chapters/Opening.md', 'Chapters/Second.md']);
	});

	it('also follows sprint history, folded Writers Panel sections and the default grid folder', () => {
		const s = settingsWith('Novel') as StorygridSettings;
		s.sprintHistory = [
			{ endedAt: 'x', minutes: 10, words: 100, completed: true, projectRoot: 'Novel' },
			{ endedAt: 'y', minutes: 10, words: 100, completed: true, projectRoot: 'Novel 2' },
			{ endedAt: 'z', minutes: 10, words: 100, completed: true },
		];
		s.outlineCollapsedGroups = {
			'tree::Novel::n1': true,
			'world::Novel::character': true,
			'world-group::Novel 2::people': true,
		};
		s.gridFolder = 'Novel';
		applyPathMove(s, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true });
		expect(s.sprintHistory.map((r) => r.projectRoot)).toEqual(['Saltmarch', 'Novel 2', undefined]);
		expect(Object.keys(s.outlineCollapsedGroups).sort()).toEqual([
			'tree::Saltmarch::n1', 'world-group::Novel 2::people', 'world::Saltmarch::character',
		]);
		expect(s.gridFolder).toBe('Saltmarch');
	});
});

describe('applyPathMove — series', () => {
	function seriesSettings(): MovableSettings {
		const s = settingsWith('Saga', 'Saga/Book 1', 'Saga/Book 2');
		s.seriesRegistry = { series_a: { name: 'Saga', rootPath: 'Saga' }, series_b: { name: 'Other', rootPath: 'Saga 2' } };
		s.bookRegistry = {
			book_1: { name: 'Book 1', seriesId: 'series_a', gridPath: 'Saga/Book 1/Book 1.storygrid' },
			book_2: { name: 'Book 2', seriesId: 'series_a', gridPath: 'Saga/Book 2/Book 2.storygrid' },
			book_x: { name: 'X', seriesId: 'series_b', gridPath: 'Saga 2/X.storygrid' },
		};
		s.activeProjectRoot = 'Saga/Book 2';
		return s;
	}

	it('renaming the series folder carries the registry, every book and the active project', () => {
		const s = seriesSettings();
		const r = applyPathMove(s, { oldPath: 'Saga', newPath: 'The Saltmarch Saga', isFolder: true });
		expect(s.seriesRegistry!.series_a.rootPath).toBe('The Saltmarch Saga');
		expect(s.seriesRegistry!.series_b.rootPath).toBe('Saga 2');
		expect(s.bookRegistry!.book_1.gridPath).toBe('The Saltmarch Saga/Book 1/Book 1.storygrid');
		expect(s.bookRegistry!.book_2.gridPath).toBe('The Saltmarch Saga/Book 2/Book 2.storygrid');
		expect(s.bookRegistry!.book_x.gridPath).toBe('Saga 2/X.storygrid');
		expect(s.activeProjectRoot).toBe('The Saltmarch Saga/Book 2');
		expect(keysOf(s, 'todos')).toEqual(['The Saltmarch Saga', 'The Saltmarch Saga/Book 1', 'The Saltmarch Saga/Book 2']);
		expect(r.registryChanged).toBe(true);
		expect(r.activeChanged).toBe(true);
	});

	it('renaming one book folder moves only that book', () => {
		const s = seriesSettings();
		applyPathMove(s, { oldPath: 'Saga/Book 1', newPath: 'Saga/The Marsh', isFolder: true });
		expect(s.seriesRegistry!.series_a.rootPath).toBe('Saga');
		expect(s.bookRegistry!.book_1.gridPath).toBe('Saga/The Marsh/Book 1.storygrid');
		expect(s.bookRegistry!.book_2.gridPath).toBe('Saga/Book 2/Book 2.storygrid');
		expect(keysOf(s, 'todos')).toEqual(['Saga', 'Saga/Book 2', 'Saga/The Marsh']);
	});
});

describe('applyPathMove — a lone .storygrid file', () => {
	it('renamed in place: the book registry follows, the project key stays', () => {
		const s = settingsWith('Saga/Book 1');
		s.bookRegistry = { b: { name: 'Book 1', seriesId: 's', gridPath: 'Saga/Book 1/Book 1.storygrid' } };
		const r = applyPathMove(s, { oldPath: 'Saga/Book 1/Book 1.storygrid', newPath: 'Saga/Book 1/The Marsh.storygrid', isFolder: false });
		expect(s.bookRegistry.b.gridPath).toBe('Saga/Book 1/The Marsh.storygrid');
		expect(keysOf(s, 'todos')).toEqual(['Saga/Book 1']);
		expect(r.registryChanged).toBe(true);
	});

	it('a to-do linked to the grid follows it, with the new name', () => {
		const s = settingsWith('Novel');
		s.dashboard!.todos['Novel'].push({ id: 'g', text: 'Plot', done: false, createdAt: 'x', link: { kind: 'grid', path: 'Novel/Plot.storygrid', label: 'Plot' } });
		applyPathMove(s, { oldPath: 'Novel/Plot.storygrid', newPath: 'Novel/Outline.storygrid', isFolder: false });
		expect(s.dashboard!.todos['Novel'][1].link).toEqual({ kind: 'grid', path: 'Novel/Outline.storygrid', label: 'Outline' });
	});

	it('moved to another folder (old folder no longer a project): the project data moves with the root move', () => {
		const s = settingsWith('Novel');
		s.activeProjectRoot = 'Novel';
		applyPathMove(s, {
			oldPath: 'Novel/Novel.storygrid', newPath: 'Archive/Novel.storygrid', isFolder: false,
			rootMove: { from: 'Novel', to: 'Archive' },
		});
		for (const m of ROOT_MAPS) expect(keysOf(s, m)).toEqual(['Archive']);
		// Only the grid moved: the scenes are still where they were.
		expect(s.dashboard!.sceneOrder!['Archive'][0]).toBe('Novel/Scenes/Opening.md');
		expect(s.activeProjectRoot).toBe('Archive');
	});

	it('a vault-root grid moved into a folder: only the "" key moves, no other project', () => {
		const s = settingsWith('', 'Other');
		applyPathMove(s, {
			oldPath: 'Story.storygrid', newPath: 'Story/Story.storygrid', isFolder: false,
			rootMove: { from: '', to: 'Story' },
		});
		expect(keysOf(s, 'todos')).toEqual(['Other', 'Story']);
		expect(s.dashboard!.todos['Other'][0].link!.path).toBe('Other/Scenes/Opening.md');
	});
});

describe('applyPathMove — destination already has data (merge, nothing lost)', () => {
	function merged(): MovableSettings {
		const s = settingsWith('Novel');
		const d = s.dashboard!;
		// Leftovers already stored under the destination name.
		d.goals['Saltmarch'] = { daily: 100, weekly: 2000 };
		d.todos['Saltmarch'] = [todo('t1', 'stale copy of t1'), todo('old', 'An old leftover task')];
		d.typedWords['Saltmarch'] = { '2026-11-01': 1000, '2026-10-01': 50 };
		d.streaks['Saltmarch'] = { current: 9, longest: 9, lastDate: '2026-10-01' };
		d.celebratedGoals!['Saltmarch'] = { weekly: '2026-10-01', daily: '2026-10-01' };
		d.skippedWords!['Saltmarch'] = { '2026-10-02': 10 };
		d.sceneOrder!['Saltmarch'] = ['Saltmarch/Scenes/Second.md', 'Saltmarch/Scenes/Leftover.md'];
		d.sceneTree!['Saltmarch'] = [
			{ id: 'x1', kind: 'doc', docPath: 'Saltmarch/Scenes/Second.md', children: [] },
			{ id: 'x2', kind: 'divider', label: 'Old part', children: [
				{ id: 'x3', kind: 'doc', docPath: 'Saltmarch/Scenes/Leftover.md', children: [] },
			] },
		];
		d.quietLeftOut!['Saltmarch'] = ['Saltmarch/Characters/Old.md', 'Saltmarch/Characters/Mira.md'];
		applyPathMove(s, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true });
		return s;
	}

	it('to-dos: the moved list first, then leftovers whose id is not already there', () => {
		const d = merged().dashboard!;
		expect(d.todos['Saltmarch'].map((t) => `${t.id}:${t.text}`)).toEqual(['t1:Fix the opening', 'old:An old leftover task']);
		expect(d.todos['Novel']).toBeUndefined();
	});
	it('goals and celebrations: the moved value wins per field, other fields kept', () => {
		const d = merged().dashboard!;
		expect(d.goals['Saltmarch']).toEqual({ daily: 500, weekly: 2000 });
		expect(d.celebratedGoals!['Saltmarch']).toEqual({ daily: '2026-11-01', weekly: '2026-10-01' });
	});
	it('typed and skipped words: every day kept, the larger count on a shared day', () => {
		const d = merged().dashboard!;
		expect(d.typedWords['Saltmarch']).toEqual({ '2026-11-01': 1000, '2026-10-01': 50 });
		expect(d.skippedWords!['Saltmarch']).toEqual({ '2026-11-01': 90, '2026-10-02': 10 });
	});
	it('streak: the moved project\'s streak wins', () => {
		expect(merged().dashboard!.streaks['Saltmarch']).toEqual({ current: 3, longest: 5, lastDate: '2026-11-01' });
	});
	it('scene order and left-out characters: union, moved first, no duplicates', () => {
		const d = merged().dashboard!;
		expect(d.sceneOrder!['Saltmarch']).toEqual(['Saltmarch/Scenes/Opening.md', 'Saltmarch/Scenes/Second.md', 'Saltmarch/Scenes/Leftover.md']);
		expect(d.quietLeftOut!['Saltmarch']).toEqual(['Saltmarch/Characters/Mira.md', 'Saltmarch/Characters/Old.md']);
	});
	it('outline tree: the moved tree, then leftover rows not already in it (dividers kept)', () => {
		const tree = merged().dashboard!.sceneTree!['Saltmarch'];
		expect(tree.map((n) => n.id)).toEqual(['d1', 'n2', 'x2']);
		expect(tree[2].children.map((n) => n.docPath)).toEqual(['Saltmarch/Scenes/Leftover.md']);
	});
	it('an empty moved value never wipes the leftover one', () => {
		const s: MovableSettings = { dashboard: emptyDash() };
		const d = s.dashboard!;
		d.todos['Novel'] = [];
		d.todos['Saltmarch'] = [todo('keep', 'Keep me')];
		(d.sceneTree ??= {})['Novel'] = [];
		d.sceneTree['Saltmarch'] = [{ id: 'k', kind: 'doc', docPath: 'Saltmarch/A.md', children: [] }];
		d.streaks['Novel'] = { current: 0, longest: 0, lastDate: '' };
		d.streaks['Saltmarch'] = { current: 2, longest: 4, lastDate: '2026-10-01' };
		applyPathMove(s, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true });
		expect(d.todos['Saltmarch'].map((t) => t.id)).toEqual(['keep']);
		expect(d.sceneTree['Saltmarch'].map((n) => n.id)).toEqual(['k']);
		expect(d.streaks['Saltmarch'].current).toBe(2);
	});
});

describe('outline merge never shows an act heading twice', () => {
	const tree = () => [
		{ id: 'd1', kind: 'divider' as const, label: 'Act 1', children: [
			{ id: 'n1', kind: 'doc' as const, docPath: 'Saltmarch/Scenes/A.md', children: [] },
		] },
		{ id: 'n2', kind: 'doc' as const, docPath: 'Saltmarch/Scenes/B.md', children: [] },
		{ id: 'd2', kind: 'divider' as const, label: 'Empty on purpose', children: [] },
	];

	it('keepOutlineFromCopy: an identical copy changes nothing', () => {
		const d = emptyDash();
		d.sceneTree = { Saltmarch: tree() };
		expect(keepOutlineFromCopy(d, 'Saltmarch', { sceneTree: tree() })).toBe(false);
		expect(d.sceneTree['Saltmarch']).toEqual(tree());
	});

	it('keepOutlineFromCopy: only rows settings lost come back, no duplicate headings', () => {
		const d = emptyDash();
		d.sceneTree = { Saltmarch: [{ id: 'd1', kind: 'divider', label: 'Act 1', children: [] }] };
		expect(keepOutlineFromCopy(d, 'Saltmarch', { sceneTree: tree() })).toBe(true);
		const out = d.sceneTree['Saltmarch'];
		expect(out.map((n) => n.id)).toEqual(['d1', 'n1', 'n2', 'd2']);
	});

	it('merging onto a used name: a heading emptied by the merge is dropped, ids stay unique', () => {
		const s: MovableSettings = { dashboard: emptyDash() };
		const d = s.dashboard!;
		d.sceneTree = {
			Novel: [{ id: 'm1', kind: 'doc', docPath: 'Novel/Scenes/A.md', children: [] }],
			Saltmarch: [{ id: 'old', kind: 'divider', label: 'Old act', children: [
				{ id: 'x', kind: 'doc', docPath: 'Saltmarch/Scenes/A.md', children: [] },
			] }],
		};
		applyPathMove(s, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true });
		expect(d.sceneTree['Saltmarch'].map((n) => n.id)).toEqual(['m1']);
	});
});

describe('movedRoot', () => {
	it('folder moves use path segments; a lone file only moves its own root move', () => {
		expect(movedRoot('Novel/Book', { oldPath: 'Novel', newPath: 'N', isFolder: true })).toBe('N/Book');
		expect(movedRoot('Novel 2', { oldPath: 'Novel', newPath: 'N', isFolder: true })).toBeNull();
		expect(movedRoot('Novel', { oldPath: 'Novel/a.md', newPath: 'Novel/b.md', isFolder: false })).toBeNull();
		expect(movedRoot('', { oldPath: 'a.storygrid', newPath: 'X/a.storygrid', isFolder: false, rootMove: { from: '', to: 'X' } })).toBe('X');
	});
});

describe('rebaseSlicePaths (mirror recovery after a move Plotverk never saw)', () => {
	const slice = () => ({
		todos: [todo('t1', 'a', 'Novel/Scenes/A.md'), todo('t2', 'b', 'Notes/Elsewhere.md')],
		sceneOrder: ['Novel/Scenes/A.md'],
		sceneTree: [{ id: 'n', kind: 'doc' as const, docPath: 'Novel/Scenes/A.md', children: [] }],
		quietLeftOut: ['Novel/Characters/M.md'],
		goals: { daily: 5 },
	});

	it('moves every path under the old root to the new root; other paths untouched', () => {
		const out = rebaseSlicePaths(slice(), 'Novel', 'Books/Novel');
		expect(out.todos![0].link!.path).toBe('Books/Novel/Scenes/A.md');
		expect(out.todos![1].link!.path).toBe('Notes/Elsewhere.md');
		expect(out.sceneOrder).toEqual(['Books/Novel/Scenes/A.md']);
		expect(out.sceneTree![0].docPath).toBe('Books/Novel/Scenes/A.md');
		expect(out.quietLeftOut).toEqual(['Books/Novel/Characters/M.md']);
		expect(out.goals).toEqual({ daily: 5 });
	});

	it('from the vault root: keeps a path that still exists where it was', () => {
		const s = { todos: [todo('t1', 'a', 'Scenes/A.md'), todo('t2', 'b', 'Notes/Elsewhere.md')] };
		const exists = (p: string) => p === 'Story/Scenes/A.md' || p === 'Notes/Elsewhere.md';
		const out = rebaseSlicePaths(s, '', 'Story', (oldP, newP) => exists(oldP) && !exists(newP));
		expect(out.todos!.map((t) => t.link!.path)).toEqual(['Story/Scenes/A.md', 'Notes/Elsewhere.md']);
	});
});

describe('widenUnseenMove (series folder renamed while Obsidian was closed)', () => {
	it('climbs to the folder that was really renamed, when the caller allows it', () => {
		const allowed = (o: string, n: string) => o === 'Saga' && n === 'Saltmarch Saga';
		expect(widenUnseenMove('Saga/Book 1', 'Saltmarch Saga/Book 1', allowed)).toEqual({ from: 'Saga', to: 'Saltmarch Saga' });
	});
	it('stops when the caller says no (e.g. not a series folder, or it still exists)', () => {
		expect(widenUnseenMove('Saga/Book 1', 'Archive/Book 1', () => false)).toEqual({ from: 'Saga/Book 1', to: 'Archive/Book 1' });
	});
	it('stops when the last names differ', () => {
		expect(widenUnseenMove('Saga/Book 1', 'Saltmarch/The Marsh', () => true)).toEqual({ from: 'Saga/Book 1', to: 'Saltmarch/The Marsh' });
	});
	it('never widens to the vault root', () => {
		expect(widenUnseenMove('Book 1', 'Archive/Book 1', () => true)).toEqual({ from: 'Book 1', to: 'Archive/Book 1' });
	});
});

describe('gridRootMove (a lone .storygrid moved to another folder)', () => {
	it('the project goes with the grid when the old folder is left without a grid', () => {
		expect(gridRootMove('Novel/Novel.storygrid', 'Archive/Novel.storygrid', ['Archive/Novel.storygrid'], []))
			.toEqual({ from: 'Novel', to: 'Archive' });
	});
	it('vault root to a folder', () => {
		expect(gridRootMove('Story.storygrid', 'Story/Story.storygrid', ['Story/Story.storygrid'], [])).toEqual({ from: '', to: 'Story' });
	});
	it('stays when the old folder still has a grid (two books in one folder)', () => {
		expect(gridRootMove('Novel/A.storygrid', 'Archive/A.storygrid', ['Novel/B.storygrid'], [])).toBeUndefined();
	});
	it('never merges into a live project: destination has a grid or is a series folder', () => {
		expect(gridRootMove('Novel/A.storygrid', 'Other/A.storygrid', ['Other/B.storygrid'], [])).toBeUndefined();
		expect(gridRootMove('Novel/A.storygrid', 'Saga/A.storygrid', [], ['Saga'])).toBeUndefined();
	});
	it('a series folder keeps its data when its arc grid moves out', () => {
		expect(gridRootMove('Saga/Arc.storygrid', 'Elsewhere/Arc.storygrid', [], ['Saga'])).toBeUndefined();
	});
	it('a rename in place is no move', () => {
		expect(gridRootMove('Novel/A.storygrid', 'Novel/B.storygrid', [], [])).toBeUndefined();
	});
});

describe('applyPathMove — damaged settings never stop a move or lose data', () => {
	it('skips odd entries, and leaves an unmergeable value where it was', () => {
		const s: MovableSettings = { dashboard: emptyDash() };
		const d = s.dashboard as unknown as Record<string, Record<string, unknown>>;
		d.todos['Novel'] = [null, { id: 'a', text: 'x', done: false, createdAt: 'x', link: { kind: 'scene', path: 42 } }, todo('b', 'y', 'Novel/S.md')];
		d.todos['Saltmarch'] = 'not a list';
		d.sceneOrder = { Novel: [7, 'Novel/S.md'] };
		d.sceneTree = { Novel: [{ id: 'x', kind: 'doc', docPath: 'Novel/S.md' }] };
		expect(() => applyPathMove(s, { oldPath: 'Novel', newPath: 'Saltmarch', isFolder: true })).not.toThrow();
		expect(d.sceneOrder['Saltmarch']).toEqual([7, 'Saltmarch/S.md']);
		// "not a list" can't take the to-dos: both stay where they were.
		expect(d.todos['Saltmarch']).toBe('not a list');
		expect((d.todos['Novel'] as TodoItem[])[2].link!.path).toBe('Saltmarch/S.md');
	});
});
