import { buildHistory, formatDayHeading, isoToLocalDay, EntityCreationRecord } from './history';
import { TodoItem, SprintRecord } from '../grid-data';

// ── Factories ─────────────────────────────────────────────────────────────────

const todo = (over: Partial<TodoItem>): TodoItem => ({
	id: 't1', text: 'Write chapter 1', done: false, createdAt: '2026-06-01T10:00:00Z', ...over,
});

const sprint = (over: Partial<SprintRecord> = {}): SprintRecord => ({
	endedAt: '2026-06-24T14:00:00Z', minutes: 25, words: 500, completed: true, ...over,
});

const entity = (over: Partial<EntityCreationRecord> = {}): EntityCreationRecord => ({
	kind: 'character', name: 'Aria', createdAt: '2026-06-24T11:00:00Z', ...over,
});

// ── isoToLocalDay ─────────────────────────────────────────────────────────────

describe('isoToLocalDay', () => {
	test('returns empty string for invalid input', () => {
		expect(isoToLocalDay('')).toBe('');
		expect(isoToLocalDay('not-a-date')).toBe('');
	});

	test('extracts local date from ISO datetime', () => {
		// Localising — just check it returns a YYYY-MM-DD shaped string
		const result = isoToLocalDay('2026-06-24T14:00:00Z');
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

// ── buildHistory ─────────────────────────────────────────────────────────────

describe('buildHistory', () => {
	test('empty input → empty output', () => {
		expect(buildHistory({ todos: [], typedWords: {}, sprints: [], entityCreations: [] })).toEqual([]);
	});

	test('completed task appears in correct day bucket', () => {
		const result = buildHistory({
			todos: [todo({ done: true, completedAt: '2026-06-24T09:00:00Z' })],
			typedWords: {}, sprints: [], entityCreations: [],
		});
		expect(result).toHaveLength(1);
		expect(result[0].events[0]).toMatchObject({ type: 'task-done', text: 'Write chapter 1' });
	});

	test('undone task is excluded', () => {
		expect(buildHistory({ todos: [todo({ done: false })], typedWords: {}, sprints: [], entityCreations: [] }))
			.toHaveLength(0);
	});

	test('done task without completedAt is excluded', () => {
		expect(buildHistory({ todos: [todo({ done: true, completedAt: undefined })], typedWords: {}, sprints: [], entityCreations: [] }))
			.toHaveLength(0);
	});

	test('zero-count words day is excluded', () => {
		const result = buildHistory({ todos: [], typedWords: { '2026-06-24': 0 }, sprints: [], entityCreations: [] });
		expect(result).toHaveLength(0);
	});

	test('positive word count appears', () => {
		const result = buildHistory({ todos: [], typedWords: { '2026-06-24': 350 }, sprints: [], entityCreations: [] });
		expect(result).toHaveLength(1);
		expect(result[0].events[0]).toMatchObject({ type: 'words', count: 350 });
	});

	test('sprint appears in correct bucket', () => {
		const result = buildHistory({ todos: [], typedWords: {}, sprints: [sprint()], entityCreations: [] });
		expect(result[0].events[0]).toMatchObject({ type: 'sprint', words: 500, minutes: 25, completed: true });
	});

	test('entity creation appears in correct bucket', () => {
		const result = buildHistory({ todos: [], typedWords: {}, sprints: [], entityCreations: [entity()] });
		expect(result[0].events[0]).toMatchObject({ type: 'entity-created', kind: 'character', name: 'Aria' });
	});

	test('multi-source events on same day merge into one bucket', () => {
		const result = buildHistory({
			todos: [todo({ done: true, completedAt: '2026-06-24T09:00:00Z' })],
			typedWords: { '2026-06-24': 800 },
			sprints: [sprint()],
			entityCreations: [entity()],
		});
		expect(result).toHaveLength(1);
		expect(result[0].events).toHaveLength(4);
	});

	test('event insertion order within a day: tasks → words → entities → sprints', () => {
		const result = buildHistory({
			todos: [todo({ done: true, completedAt: '2026-06-24T09:00:00Z' })],
			typedWords: { '2026-06-24': 800 },
			sprints: [sprint()],
			entityCreations: [entity()],
		});
		const types = result[0].events.map(e => e.type);
		expect(types).toEqual(['task-done', 'words', 'entity-created', 'sprint']);
	});

	test('multi-day buckets sorted newest first', () => {
		const result = buildHistory({
			todos: [],
			typedWords: { '2026-06-22': 200, '2026-06-24': 400, '2026-06-23': 300 },
			sprints: [], entityCreations: [],
		});
		expect(result.map(b => b.day)).toEqual(['2026-06-24', '2026-06-23', '2026-06-22']);
	});

	test('multiple tasks on same day all appear', () => {
		const result = buildHistory({
			todos: [
				todo({ id: 't1', text: 'Task A', done: true, completedAt: '2026-06-24T08:00:00Z' }),
				todo({ id: 't2', text: 'Task B', done: true, completedAt: '2026-06-24T18:00:00Z' }),
			],
			typedWords: {}, sprints: [], entityCreations: [],
		});
		expect(result[0].events).toHaveLength(2);
		expect(result[0].events.map(e => (e as any).text)).toEqual(['Task A', 'Task B']);
	});
});

// ── formatDayHeading ──────────────────────────────────────────────────────────

describe('formatDayHeading', () => {
	const TODAY = '2026-06-24';

	test('same day → Today', () => {
		expect(formatDayHeading(TODAY, TODAY)).toBe('Today');
	});

	test('one day ago → Yesterday', () => {
		expect(formatDayHeading('2026-06-23', TODAY)).toBe('Yesterday');
	});

	test('older same year → weekday + day + month, no year', () => {
		const result = formatDayHeading('2026-06-15', TODAY);
		expect(result).toContain('Jun');
		expect(result).toContain('15');
		expect(result).not.toContain('2026');
	});

	test('previous year → includes year', () => {
		const result = formatDayHeading('2025-12-01', TODAY);
		expect(result).toContain('2025');
		expect(result).toContain('Dec');
	});

	test('month boundary yesterday (Jul 1 → Jun 30)', () => {
		expect(formatDayHeading('2026-06-30', '2026-07-01')).toBe('Yesterday');
	});

	test('year boundary yesterday (Jan 1 → Dec 31)', () => {
		expect(formatDayHeading('2025-12-31', '2026-01-01')).toBe('Yesterday');
	});
});
