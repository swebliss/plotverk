import { TodoItem } from '../grid-data';

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

function localDateKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * True when a task's due value is strictly in the past.
 * Handles both date-only ('YYYY-MM-DD') and datetime ('YYYY-MM-DDTHH:MM') values.
 */
export function isOverdue(todo: TodoItem, now: Date = new Date()): boolean {
	if (!todo.due) return false;
	if (todo.due.includes('T')) return new Date(todo.due) < now;
	return todo.due < localDateKey(now);
}

/**
 * True when a task is due today and not yet overdue.
 * Handles both date-only and datetime values.
 */
export function isDueToday(todo: TodoItem, now: Date = new Date()): boolean {
	if (!todo.due) return false;
	const datepart = todo.due.slice(0, 10);
	if (datepart !== localDateKey(now)) return false;
	if (todo.due.includes('T')) return new Date(todo.due) >= now;
	return true;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function relativeDay(locale: string, days: number): string {
	return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
}

/**
 * Format a due value for display in the task row pill.
 * Date-only → date string as-is; datetime → human-readable relative label.
 * `locale` defaults to 'en' so callers that don't pass one (and existing tests) are unaffected.
 */
export function formatDue(due: string, now: Date = new Date(), locale: string = 'en'): string {
	if (!due.includes('T')) return due;
	const timeStr = due.slice(11, 16); // HH:MM
	const datepart = due.slice(0, 10);
	const todayKey = localDateKey(now);
	if (datepart === todayKey) return `${capitalize(relativeDay(locale, 0))} ${timeStr}`;
	const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	if (datepart === localDateKey(tomorrow)) return `${capitalize(relativeDay(locale, 1))} ${timeStr}`;
	const dt = new Date(due);
	const month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(dt);
	return `${month} ${dt.getDate()}, ${timeStr}`;
}

/** Split a todos array into active and completed lists. */
export function splitCompleted(todos: TodoItem[]): { active: TodoItem[]; completed: TodoItem[] } {
	return {
		active: todos.filter((t) => !t.done),
		completed: todos.filter((t) => t.done),
	};
}

/**
 * Sort active todos by urgency: overdue → due-today → high-priority → normal → low.
 * Within the same bucket the original manual order is preserved (stable sort).
 */
export function sortTasks(todos: TodoItem[], now: Date = new Date()): TodoItem[] {
	return [...todos].sort((a, b) => taskUrgency(a, now) - taskUrgency(b, now));
}

function taskUrgency(todo: TodoItem, now: Date): number {
	if (isOverdue(todo, now)) return 0;
	if (isDueToday(todo, now)) return 1;
	const pRank = PRIORITY_RANK[todo.priority ?? 'normal'] ?? 1;
	return 2 + pRank;
}

/**
 * Move a task to just before another task in the manual order.
 * Lazy-assigns `order` to items that don't have it yet (using array index).
 * Produces identical results whether the caller's display list is urgency-sorted
 * or manual — only the IDs matter, not array positions.
 * Mutates `todos` in-place (only the `order` field of each item).
 */
export function reorderTasks(todos: TodoItem[], fromId: string, toId: string): void {
	if (fromId === toId) return;
	todos.forEach((t, i) => { if (t.order === undefined) t.order = i; });
	const sorted = [...todos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	const fromIdx = sorted.findIndex((t) => t.id === fromId);
	const toIdx = sorted.findIndex((t) => t.id === toId);
	if (fromIdx < 0 || toIdx < 0) return;
	const [item] = sorted.splice(fromIdx, 1);
	const insertAt = sorted.findIndex((t) => t.id === toId);
	sorted.splice(insertAt, 0, item);
	sorted.forEach((t, i) => { t.order = i; });
}

/**
 * Move a task to the end of the manual order — the drop-past-the-last-row case
 * that `reorderTasks` (which always inserts *before* an anchor) can't express.
 * Mutates `todos` in-place (only the `order` field of each item).
 */
export function moveTaskToEnd(todos: TodoItem[], fromId: string): void {
	todos.forEach((t, i) => { if (t.order === undefined) t.order = i; });
	const sorted = [...todos].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	const fromIdx = sorted.findIndex((t) => t.id === fromId);
	if (fromIdx < 0) return;
	const [item] = sorted.splice(fromIdx, 1);
	sorted.push(item);
	sorted.forEach((t, i) => { t.order = i; });
}

/** Returns the done/total subtask counts for a parent task. */
export function subtaskProgress(todo: TodoItem): { done: number; total: number } {
	const subtasks = todo.subtasks ?? [];
	return { done: subtasks.filter((s) => s.done).length, total: subtasks.length };
}

/**
 * True when a task has at least one subtask and all subtasks are done.
 * Used to auto-complete the parent when the last subtask is checked.
 */
export function isParentComplete(todo: TodoItem): boolean {
	const subtasks = todo.subtasks ?? [];
	return subtasks.length > 0 && subtasks.every((s) => s.done);
}

/**
 * Roll a subtask toggle up to its parent: complete the parent when its last
 * subtask is checked, and un-complete it again when a subtask is un-checked.
 * Returns true when the parent's own done state changed — the caller must then
 * do a full re-render, since the row moves between the open and done groups.
 * With `rollup` off (the `taskSubtaskRollup` setting) the parent is manual-only.
 */
export function applySubtaskRollup(todo: TodoItem, rollup: boolean, now: Date = new Date()): boolean {
	if (!rollup) return false;
	// A task with no subtasks is manual-only — rollup must never un-complete it.
	if ((todo.subtasks ?? []).length === 0) return false;
	const complete = isParentComplete(todo);
	// Already in agreement — never re-stamp completedAt on an already-done parent.
	if (complete === todo.done) return false;
	if (complete) {
		todo.done = true;
		if (!todo.completedAt) todo.completedAt = now.toISOString();
	} else {
		todo.done = false;
		delete todo.completedAt;
	}
	return true;
}
