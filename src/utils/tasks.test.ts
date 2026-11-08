import { isOverdue, isDueToday, splitCompleted, sortTasks, formatDue, reorderTasks, moveTaskToEnd, subtaskProgress, isParentComplete, applySubtaskRollup } from './tasks';
import { TodoItem } from '../grid-data';

const todo = (over: Partial<TodoItem>): TodoItem => ({
	id: 't', text: 'task', done: false, createdAt: '2026-06-13T00:00:00Z', ...over,
});

const NOW = new Date(2026, 5, 13); // 2026-06-13 local

// NOW = 2026-06-13T00:00:00 local; use a mid-day NOW for datetime tests
const NOW_MIDDAY = new Date(2026, 5, 13, 12, 0, 0); // 2026-06-13 noon

describe('isOverdue', () => {
	test('no due date → not overdue', () => {
		expect(isOverdue(todo({}), NOW)).toBe(false);
	});
	test('due yesterday (date-only) → overdue', () => {
		expect(isOverdue(todo({ due: '2026-06-12' }), NOW)).toBe(true);
	});
	test('due today (date-only) → not overdue', () => {
		expect(isOverdue(todo({ due: '2026-06-13' }), NOW)).toBe(false);
	});
	test('due tomorrow (date-only) → not overdue', () => {
		expect(isOverdue(todo({ due: '2026-06-14' }), NOW)).toBe(false);
	});
	test('datetime in the past → overdue', () => {
		expect(isOverdue(todo({ due: '2026-06-13T08:00' }), NOW_MIDDAY)).toBe(true);
	});
	test('datetime in the future → not overdue', () => {
		expect(isOverdue(todo({ due: '2026-06-13T18:00' }), NOW_MIDDAY)).toBe(false);
	});
});

describe('isDueToday', () => {
	test('no due date → false', () => {
		expect(isDueToday(todo({}), NOW)).toBe(false);
	});
	test('due today (date-only) → true', () => {
		expect(isDueToday(todo({ due: '2026-06-13' }), NOW)).toBe(true);
	});
	test('due yesterday (date-only) → false', () => {
		expect(isDueToday(todo({ due: '2026-06-12' }), NOW)).toBe(false);
	});
	test('datetime later today → true', () => {
		expect(isDueToday(todo({ due: '2026-06-13T18:00' }), NOW_MIDDAY)).toBe(true);
	});
	test('datetime earlier today (already overdue) → false', () => {
		expect(isDueToday(todo({ due: '2026-06-13T08:00' }), NOW_MIDDAY)).toBe(false);
	});
	test('datetime tomorrow → false', () => {
		expect(isDueToday(todo({ due: '2026-06-14T09:00' }), NOW_MIDDAY)).toBe(false);
	});
});

describe('formatDue', () => {
	test('date-only returns as-is', () => {
		expect(formatDue('2026-06-15', NOW_MIDDAY)).toBe('2026-06-15');
	});
	test('datetime today → Today HH:MM', () => {
		expect(formatDue('2026-06-13T18:30', NOW_MIDDAY)).toBe('Today 18:30');
	});
	test('datetime tomorrow → Tomorrow HH:MM', () => {
		expect(formatDue('2026-06-14T09:00', NOW_MIDDAY)).toBe('Tomorrow 09:00');
	});
	test('datetime other date → Mon D, HH:MM', () => {
		expect(formatDue('2026-06-20T14:00', NOW_MIDDAY)).toBe('Jun 20, 14:00');
	});
});

describe('splitCompleted', () => {
	test('separates active and done', () => {
		const todos = [todo({ id: 'a', done: false }), todo({ id: 'b', done: true }), todo({ id: 'c', done: false })];
		const { active, completed } = splitCompleted(todos);
		expect(active.map((t) => t.id)).toEqual(['a', 'c']);
		expect(completed.map((t) => t.id)).toEqual(['b']);
	});
	test('all active', () => {
		const { active, completed } = splitCompleted([todo({ id: 'x' })]);
		expect(active).toHaveLength(1);
		expect(completed).toHaveLength(0);
	});
});

describe('reorderTasks', () => {
	const mkTodos = (ids: string[], orders?: number[]): TodoItem[] =>
		ids.map((id, i) => todo({ id, order: orders ? orders[i] : undefined }));

	test('moves fromId to just before toId', () => {
		const todos = mkTodos(['a', 'b', 'c', 'd']);
		reorderTasks(todos, 'c', 'a');
		const ordered = [...todos].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
		expect(ordered.map((t) => t.id)).toEqual(['c', 'a', 'b', 'd']);
	});

	test('lazy-assigns order when missing', () => {
		const todos = mkTodos(['a', 'b', 'c']);
		todos.forEach((t) => { delete t.order; });
		reorderTasks(todos, 'b', 'a');
		todos.forEach((t) => expect(t.order).toBeDefined());
	});

	test('no-op when fromId === toId', () => {
		const todos = mkTodos(['a', 'b']);
		const before = todos.map((t) => t.order);
		reorderTasks(todos, 'a', 'a');
		expect(todos.map((t) => t.order)).toEqual(before);
	});

	test('no-op when id not found', () => {
		const todos = mkTodos(['a', 'b']);
		reorderTasks(todos, 'z', 'a'); // 'z' doesn't exist
		const ordered = [...todos].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
		expect(ordered.map((t) => t.id)).toEqual(['a', 'b']);
	});

	test('produces identical result regardless of display sort order', () => {
		// Build two copies with same items but different urgency (array positions differ when sorted)
		const base = [
			todo({ id: 'overdue', due: '2026-06-10', order: 0 }),
			todo({ id: 'normal', order: 1 }),
			todo({ id: 'high', priority: 'high', order: 2 }),
		];
		const copy = base.map((t) => ({ ...t }));

		// Reorder in "manual" list
		reorderTasks(base, 'high', 'overdue');

		// Shuffle copy to simulate urgency-sorted display, then reorder by same IDs
		copy.sort((a, b) => (a.due ? -1 : a.priority === 'high' ? 0 : 1) - (b.due ? -1 : b.priority === 'high' ? 0 : 1));
		reorderTasks(copy, 'high', 'overdue');

		const result1 = [...base].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((t) => t.id);
		const result2 = [...copy].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((t) => t.id);
		expect(result1).toEqual(result2);
	});
});

describe('moveTaskToEnd', () => {
	const mkTodos = (ids: string[]): TodoItem[] => ids.map((id, i) => todo({ id, order: i }));
	const byOrder = (todos: TodoItem[]) =>
		[...todos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((t) => t.id);

	test('moves the task to the end of the manual order', () => {
		const todos = mkTodos(['a', 'b', 'c']);
		moveTaskToEnd(todos, 'a');
		expect(byOrder(todos)).toEqual(['b', 'c', 'a']);
	});

	test('already last → order unchanged', () => {
		const todos = mkTodos(['a', 'b', 'c']);
		moveTaskToEnd(todos, 'c');
		expect(byOrder(todos)).toEqual(['a', 'b', 'c']);
	});

	test('lazy-assigns order when missing', () => {
		const todos = mkTodos(['a', 'b', 'c']);
		todos.forEach((t) => { delete t.order; });
		moveTaskToEnd(todos, 'a');
		todos.forEach((t) => expect(t.order).toBeDefined());
		expect(byOrder(todos)).toEqual(['b', 'c', 'a']);
	});

	test('no-op when id not found', () => {
		const todos = mkTodos(['a', 'b']);
		moveTaskToEnd(todos, 'z');
		expect(byOrder(todos)).toEqual(['a', 'b']);
	});

	test('does not disturb tasks that were never rendered', () => {
		// The sidebar only draws 5 rows — hidden tasks must keep their relative order.
		const todos = mkTodos(['a', 'b', 'c', 'd', 'e', 'hidden1', 'hidden2']);
		moveTaskToEnd(todos, 'b');
		expect(byOrder(todos)).toEqual(['a', 'c', 'd', 'e', 'hidden1', 'hidden2', 'b']);
	});
});

describe('subtaskProgress', () => {
	test('no subtasks → 0/0', () => {
		expect(subtaskProgress(todo({}))).toEqual({ done: 0, total: 0 });
	});
	test('some done', () => {
		const t = todo({ subtasks: [
			{ id: 's1', text: 'a', done: true },
			{ id: 's2', text: 'b', done: false },
			{ id: 's3', text: 'c', done: true },
		] });
		expect(subtaskProgress(t)).toEqual({ done: 2, total: 3 });
	});
	test('all done', () => {
		const t = todo({ subtasks: [
			{ id: 's1', text: 'a', done: true },
			{ id: 's2', text: 'b', done: true },
		] });
		expect(subtaskProgress(t)).toEqual({ done: 2, total: 2 });
	});
});

describe('isParentComplete', () => {
	test('no subtasks → false', () => {
		expect(isParentComplete(todo({}))).toBe(false);
	});
	test('subtasks but not all done → false', () => {
		const t = todo({ subtasks: [
			{ id: 's1', text: 'a', done: true },
			{ id: 's2', text: 'b', done: false },
		] });
		expect(isParentComplete(t)).toBe(false);
	});
	test('all subtasks done → true', () => {
		const t = todo({ subtasks: [
			{ id: 's1', text: 'a', done: true },
			{ id: 's2', text: 'b', done: true },
		] });
		expect(isParentComplete(t)).toBe(true);
	});
	test('empty subtasks array → false', () => {
		expect(isParentComplete(todo({ subtasks: [] }))).toBe(false);
	});
});

describe('applySubtaskRollup', () => {
	const STAMPED = '2026-06-01T09:00:00.000Z';
	const parent = (subs: boolean[], over: Partial<TodoItem> = {}): TodoItem =>
		todo({ subtasks: subs.map((done, i) => ({ id: `s${i}`, text: 's', done })), ...over });

	test('last subtask checked → parent completes and gets a completedAt', () => {
		const t = parent([true, true]);
		expect(applySubtaskRollup(t, true, NOW)).toBe(true);
		expect(t.done).toBe(true);
		expect(t.completedAt).toBe(NOW.toISOString());
	});

	test('rollup off → parent is left alone', () => {
		const t = parent([true, true]);
		expect(applySubtaskRollup(t, false, NOW)).toBe(false);
		expect(t.done).toBe(false);
		expect(t.completedAt).toBeUndefined();
	});

	test('a subtask un-checked on a completed parent re-opens the parent', () => {
		const t = parent([true, false], { done: true, completedAt: STAMPED });
		expect(applySubtaskRollup(t, true, NOW)).toBe(true);
		expect(t.done).toBe(false);
		expect(t.completedAt).toBeUndefined();
	});

	test('rollup off → an un-checked subtask does not re-open the parent', () => {
		const t = parent([true, false], { done: true, completedAt: STAMPED });
		expect(applySubtaskRollup(t, false, NOW)).toBe(false);
		expect(t.done).toBe(true);
		expect(t.completedAt).toBe(STAMPED);
	});

	test('already-complete parent keeps its original completedAt', () => {
		const t = parent([true, true], { done: true, completedAt: STAMPED });
		expect(applySubtaskRollup(t, true, NOW)).toBe(false);
		expect(t.completedAt).toBe(STAMPED);
	});

	test('still-open parent with an unfinished subtask is untouched', () => {
		const t = parent([true, false]);
		expect(applySubtaskRollup(t, true, NOW)).toBe(false);
		expect(t.done).toBe(false);
	});

	test('a task with no subtasks is never re-opened by rollup', () => {
		const t = todo({ done: true, completedAt: STAMPED });
		expect(applySubtaskRollup(t, true, NOW)).toBe(false);
		expect(t.done).toBe(true);
		expect(t.completedAt).toBe(STAMPED);
	});
});

describe('sortTasks', () => {
	test('overdue comes before due-today comes before high-priority comes before normal', () => {
		const tasks = [
			todo({ id: 'normal', priority: 'normal' }),
			todo({ id: 'high', priority: 'high' }),
			todo({ id: 'today', due: '2026-06-13' }),
			todo({ id: 'overdue', due: '2026-06-10' }),
		];
		const sorted = sortTasks(tasks, NOW);
		expect(sorted.map((t) => t.id)).toEqual(['overdue', 'today', 'high', 'normal']);
	});
	test('preserves original order within same urgency bucket', () => {
		const tasks = [
			todo({ id: 'b', priority: 'normal' }),
			todo({ id: 'a', priority: 'normal' }),
		];
		const sorted = sortTasks(tasks, NOW);
		expect(sorted.map((t) => t.id)).toEqual(['b', 'a']);
	});
	test('does not mutate the original array', () => {
		const tasks = [todo({ id: 'x' }), todo({ id: 'y' })];
		sortTasks(tasks, NOW);
		expect(tasks[0].id).toBe('x');
	});
});
