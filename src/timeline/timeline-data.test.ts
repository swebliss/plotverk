import {
	createPlotline,
	createEmptyTimeline,
	openLoop,
	closeLoop,
	loopStatus,
	anchorsForBook,
	remapTimelinePath,
	Loop,
	TimelineData,
} from './timeline-data';
import { GREGORIAN_CALENDAR } from './calendar';

describe('createPlotline()', () => {
	test('generates a unique id and carries the given fields', () => {
		const p = createPlotline('B-plot', '#ff0000', 'dashed');
		expect(p.id).toBeTruthy();
		expect(p.name).toBe('B-plot');
		expect(p.color).toBe('#ff0000');
		expect(p.lineStyle).toBe('dashed');
	});

	test('defaults lineStyle to solid', () => {
		const p = createPlotline('A-plot', '#00ff00');
		expect(p.lineStyle).toBe('solid');
	});

	test('two plotlines never share an id', () => {
		const a = createPlotline('A', '#000');
		const b = createPlotline('B', '#111');
		expect(a.id).not.toBe(b.id);
	});
});

describe('createEmptyTimeline()', () => {
	test('starts with empty collections and the given calendar', () => {
		const data = createEmptyTimeline('My Story', GREGORIAN_CALENDAR);
		expect(data.version).toBe(1);
		expect(data.name).toBe('My Story');
		expect(data.calendar).toBe(GREGORIAN_CALENDAR);
		expect(data.plotlines).toEqual([]);
		expect(data.loops).toEqual([]);
		expect(data.links).toEqual([]);
		expect(data.eventDisplay).toEqual({});
		expect(data.sceneDates).toEqual({});
	});

	test('leaves viewSettings empty when there are no global appearance defaults to inherit', () => {
		expect(createEmptyTimeline('A', GREGORIAN_CALENDAR).viewSettings).toEqual({});
		expect(createEmptyTimeline('A', GREGORIAN_CALENDAR, {}).viewSettings).toEqual({});
	});

	test('seeds the plugin-global appearance defaults into the new file', () => {
		const globalDefaults = { spacing: 90, labelMode: 'hover' as const };
		const data = createEmptyTimeline('A', GREGORIAN_CALENDAR, globalDefaults);
		expect(data.viewSettings.appearance).toEqual(globalDefaults);
		// Copied, not aliased — editing the timeline must not write back into settings.
		expect(data.viewSettings.appearance).not.toBe(globalDefaults);
	});
});

describe('loop lifecycle: openLoop / closeLoop / loopStatus', () => {
	function emptyData(): TimelineData {
		return createEmptyTimeline('Test', GREGORIAN_CALENDAR);
	}

	test('a freshly opened loop has no payoff and status "open"', () => {
		const data = openLoop(emptyData(), 'The Missing Sword', { gridPath: 'Book 1.storygrid', docPath: 'Scenes/Setup.md' });
		expect(data.loops).toHaveLength(1);
		const loop = data.loops[0];
		expect(loop.name).toBe('The Missing Sword');
		expect(loop.payoff).toBeUndefined();
		expect(loop.middles).toEqual([]);
		expect(loopStatus(loop)).toBe('open');
	});

	test('closeLoop sets the payoff anchor and flips status to "closed"', () => {
		let data = openLoop(emptyData(), 'The Missing Sword', { gridPath: 'Book 1.storygrid', docPath: 'Scenes/Setup.md' });
		const loopId = data.loops[0].id;
		data = closeLoop(data, loopId, { gridPath: 'Book 3.storygrid', docPath: 'Scenes/Payoff.md' });
		const loop = data.loops.find((l) => l.id === loopId)!;
		expect(loop.payoff).toEqual({ gridPath: 'Book 3.storygrid', docPath: 'Scenes/Payoff.md' });
		expect(loopStatus(loop)).toBe('closed');
	});

	test('closeLoop only touches the targeted loop', () => {
		let data = openLoop(emptyData(), 'Loop A', { gridPath: 'Book 1.storygrid' });
		data = openLoop(data, 'Loop B', { gridPath: 'Book 1.storygrid' });
		const [loopA, loopB] = data.loops;
		data = closeLoop(data, loopA.id, { gridPath: 'Book 1.storygrid' });
		expect(loopStatus(data.loops.find((l) => l.id === loopA.id)!)).toBe('closed');
		expect(loopStatus(data.loops.find((l) => l.id === loopB.id)!)).toBe('open');
	});
});

describe('anchorsForBook() — cross-book loop filtering', () => {
	test('returns only the anchors belonging to the requested book, in setup → middles → payoff order', () => {
		const loop: Loop = {
			id: 'loop-1',
			name: 'Prophecy',
			setup: { gridPath: 'Book 1.storygrid', docPath: 'Scenes/A.md' },
			middles: [
				{ gridPath: 'Book 1.storygrid', docPath: 'Scenes/B.md' },
				{ gridPath: 'Book 2.storygrid', docPath: 'Scenes/C.md' },
			],
			payoff: { gridPath: 'Book 3.storygrid', docPath: 'Scenes/D.md' },
		};

		expect(anchorsForBook(loop, 'Book 1.storygrid')).toEqual([
			{ gridPath: 'Book 1.storygrid', docPath: 'Scenes/A.md' },
			{ gridPath: 'Book 1.storygrid', docPath: 'Scenes/B.md' },
		]);
		expect(anchorsForBook(loop, 'Book 2.storygrid')).toEqual([
			{ gridPath: 'Book 2.storygrid', docPath: 'Scenes/C.md' },
		]);
		expect(anchorsForBook(loop, 'Book 3.storygrid')).toEqual([
			{ gridPath: 'Book 3.storygrid', docPath: 'Scenes/D.md' },
		]);
	});

	test('a book with no anchors returns an empty array', () => {
		const loop: Loop = {
			id: 'loop-2',
			name: 'Untouched',
			setup: { gridPath: 'Book 1.storygrid' },
			middles: [],
		};
		expect(anchorsForBook(loop, 'Book 9.storygrid')).toEqual([]);
	});

	test('an unclosed loop (no payoff) is excluded from the payoff slot', () => {
		const loop: Loop = {
			id: 'loop-3',
			name: 'Still Open',
			setup: { gridPath: 'Book 1.storygrid' },
			middles: [{ gridPath: 'Book 1.storygrid' }],
		};
		expect(anchorsForBook(loop, 'Book 1.storygrid')).toHaveLength(2);
	});
});

describe('remapTimelinePath() — rename sync', () => {
	function fixture(): TimelineData {
		const data = createEmptyTimeline('Test', GREGORIAN_CALENDAR);
		return {
			...data,
			sceneDates: { 'Scenes/Old.md': { year: 900 } },
			eventDisplay: { 'Events/Old Event.md': { color: '#fff' } },
			loops: [
				{
					id: 'loop-1',
					name: 'The Ring',
					setup: { gridPath: 'Old Book.storygrid', docPath: 'Scenes/Old.md' },
					middles: [{ gridPath: 'Old Book.storygrid', docPath: 'Scenes/Other.md' }],
					payoff: { gridPath: 'Old Book.storygrid', docPath: 'Scenes/Old.md' },
				},
			],
			links: [{ id: 'link-1', scenePath: 'Scenes/Old.md', targetNotePath: 'Events/Old Event.md' }],
		};
	}

	test('remaps a scene doc path everywhere it appears', () => {
		const remapped = remapTimelinePath(fixture(), 'Scenes/Old.md', 'Scenes/New.md');

		expect(remapped.sceneDates).toEqual({ 'Scenes/New.md': { year: 900 } });
		expect(remapped.loops[0].setup.docPath).toBe('Scenes/New.md');
		expect(remapped.loops[0].payoff!.docPath).toBe('Scenes/New.md');
		expect(remapped.loops[0].middles[0].docPath).toBe('Scenes/Other.md'); // untouched
		expect(remapped.links[0].scenePath).toBe('Scenes/New.md');
	});

	test('remaps a grid (book) path across all loop anchors', () => {
		const remapped = remapTimelinePath(fixture(), 'Old Book.storygrid', 'New Book.storygrid');

		expect(remapped.loops[0].setup.gridPath).toBe('New Book.storygrid');
		expect(remapped.loops[0].middles[0].gridPath).toBe('New Book.storygrid');
		expect(remapped.loops[0].payoff!.gridPath).toBe('New Book.storygrid');
	});

	test('remaps an event note path in eventDisplay and chrono links', () => {
		const remapped = remapTimelinePath(fixture(), 'Events/Old Event.md', 'Events/New Event.md');

		expect(remapped.eventDisplay).toEqual({ 'Events/New Event.md': { color: '#fff' } });
		expect(remapped.links[0].targetNotePath).toBe('Events/New Event.md');
	});

	test('paths that do not match are left untouched', () => {
		const original = fixture();
		const remapped = remapTimelinePath(original, 'Nothing/Matches.md', 'Nothing/Else.md');
		expect(remapped).toEqual(original);
	});

	test('is pure — never mutates the input', () => {
		const original = fixture();
		const snapshot = JSON.parse(JSON.stringify(original));
		remapTimelinePath(original, 'Scenes/Old.md', 'Scenes/New.md');
		expect(original).toEqual(snapshot);
	});
});
