import { TodoItem, SprintRecord } from '../grid-data';

// ── Event types ───────────────────────────────────────────────────────────────

export interface TaskDoneEvent {
	type: 'task-done';
	text: string;
	completedAt: string;
}

export interface WordsEvent {
	type: 'words';
	count: number;
}

export interface SprintEvent {
	type: 'sprint';
	words: number;
	minutes: number;
	completed: boolean;
	endedAt: string;
}

export interface EntityCreatedEvent {
	type: 'entity-created';
	kind: string;
	name: string;
	createdAt: string;
}

export type HistoryEvent = TaskDoneEvent | WordsEvent | SprintEvent | EntityCreatedEvent;

// ── Input / output shapes ─────────────────────────────────────────────────────

/** An entity file record passed in by the view layer (from file.stat.ctime). */
export interface EntityCreationRecord {
	kind: string;
	name: string;
	/** ISO datetime string — typically new Date(file.stat.ctime).toISOString(). */
	createdAt: string;
}

/** One calendar day's worth of activity events. */
export interface DayBucket {
	/** Local date as YYYY-MM-DD. */
	day: string;
	events: HistoryEvent[];
}

export interface BuildHistoryOpts {
	todos: TodoItem[];
	/** Inner typedWords map for one project — Record<localDay, wordCount>. */
	typedWords: Record<string, number>;
	sprints: SprintRecord[];
	entityCreations: EntityCreationRecord[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function localDay(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Convert any ISO datetime string to a local YYYY-MM-DD string. Returns '' on invalid input. */
export function isoToLocalDay(iso: string): string {
	const d = new Date(iso);
	if (isNaN(d.getTime())) return '';
	return localDay(d);
}

// ── Core aggregator ───────────────────────────────────────────────────────────

/**
 * Build a reverse-chronological list of day buckets from all activity sources.
 * Events within a bucket preserve insertion order (tasks → words → entities → sprints).
 */
export function buildHistory(opts: BuildHistoryOpts): DayBucket[] {
	const map = new Map<string, HistoryEvent[]>();

	const add = (day: string, event: HistoryEvent) => {
		if (!day) return;
		if (!map.has(day)) map.set(day, []);
		map.get(day)!.push(event);
	};

	for (const todo of opts.todos) {
		if (todo.done && todo.completedAt) {
			add(isoToLocalDay(todo.completedAt), { type: 'task-done', text: todo.text, completedAt: todo.completedAt });
		}
	}

	for (const [day, count] of Object.entries(opts.typedWords)) {
		if (count > 0) add(day, { type: 'words', count });
	}

	for (const rec of opts.entityCreations) {
		const day = isoToLocalDay(rec.createdAt);
		add(day, { type: 'entity-created', kind: rec.kind, name: rec.name, createdAt: rec.createdAt });
	}

	for (const sprint of opts.sprints) {
		const day = isoToLocalDay(sprint.endedAt);
		add(day, { type: 'sprint', words: sprint.words, minutes: sprint.minutes, completed: sprint.completed, endedAt: sprint.endedAt });
	}

	const days = [...map.keys()].sort((a, b) => b.localeCompare(a));
	return days.map(day => ({ day, events: map.get(day)! }));
}

// ── Formatting ────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function relativeDay(locale: string, days: number): string {
	return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
}

/**
 * Format a YYYY-MM-DD bucket heading relative to today's local date string.
 * `locale` defaults to 'en' so callers that don't pass one (and existing tests) are unaffected.
 */
export function formatDayHeading(day: string, todayDay: string, locale: string = 'en'): string {
	if (day === todayDay) return capitalize(relativeDay(locale, 0));
	const [ty, tm, td] = todayDay.split('-').map(Number);
	const yesterday = localDay(new Date(ty, tm - 1, td - 1));
	if (day === yesterday) return capitalize(relativeDay(locale, -1));
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	const dayName = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
	const monthName = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
	if (y === ty) return `${dayName} ${d} ${monthName}`;
	return `${dayName} ${d} ${monthName} ${y}`;
}
