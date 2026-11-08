import {
	countWords,
	dayKey,
	startOfWeek,
	startOfMonth,
	startOfYear,
	sumSince,
	summarizeStatuses,
	parseWikilinkTargets,
} from './stats';
import { SceneCard } from '../grid-data';

describe('countWords', () => {
	test('counts plain prose', () => {
		expect(countWords('The quick brown fox jumps.')).toBe(5);
	});

	test('ignores frontmatter, embeds, and markdown syntax', () => {
		const doc = [
			'---',
			'storygrid-type: scene',
			'title: "Ambush"',
			'---',
			'',
			'# Ambush',
			'',
			'![[mara.png]]',
			'',
			'She ran. **Fast.** See [[Mara Venn|Mara]].',
		].join('\n');
		// Ambush + She ran Fast Mara = 6
		expect(countWords(doc)).toBe(6);
	});

	test('empty document is zero words', () => {
		expect(countWords('')).toBe(0);
		expect(countWords('---\ntitle: "x"\n---\n')).toBe(0);
	});
});

describe('goal windows', () => {
	test('dayKey is local and zero-padded', () => {
		expect(dayKey(new Date(2026, 5, 3))).toBe('2026-06-03');
	});

	test('startOfWeek snaps to Monday', () => {
		// 2026-06-11 is a Thursday → Monday is 2026-06-08
		expect(dayKey(startOfWeek(new Date(2026, 5, 11)))).toBe('2026-06-08');
		// A Monday stays put
		expect(dayKey(startOfWeek(new Date(2026, 5, 8)))).toBe('2026-06-08');
	});

	test('startOfMonth and startOfYear', () => {
		expect(dayKey(startOfMonth(new Date(2026, 5, 11)))).toBe('2026-06-01');
		expect(dayKey(startOfYear(new Date(2026, 5, 11)))).toBe('2026-01-01');
	});

	test('sumSince sums only days inside the window', () => {
		const history = { '2026-06-01': 100, '2026-06-08': 250, '2026-06-11': 50, '2026-05-30': 999 };
		const now = new Date(2026, 5, 11);
		expect(sumSince(history, now, now)).toBe(50); // today only
		expect(sumSince(history, startOfWeek(now), now)).toBe(300);
		expect(sumSince(history, startOfMonth(now), now)).toBe(400);
		expect(sumSince(history, startOfYear(now), now)).toBe(1399);
	});
});

describe('card statistics', () => {
	const card = (over: Partial<SceneCard>): SceneCard => ({
		id: 'c', rowId: 'r', colId: 'k', title: '', synopsis: '', color: '#fff',
		status: 'idea', linkDisplayMode: 'synopsis', ...over,
	});

	test('summarizeStatuses counts every status bucket', () => {
		const counts = summarizeStatuses([
			card({ status: 'idea' }), card({ status: 'idea' }), card({ status: 'final' }),
		]);
		expect(counts.idea).toBe(2);
		expect(counts.final).toBe(1);
		expect(counts.draft).toBe(0);
	});

	test('parseWikilinkTargets extracts and normalises wikilink basenames', () => {
		expect(parseWikilinkTargets('Hello [[Mara]] and [[Io]].')).toEqual(['Mara', 'Io']);
		expect(parseWikilinkTargets('See [[Characters/Mara.md|her]] later.')).toEqual(['Mara']);
		expect(parseWikilinkTargets('No links here.')).toEqual([]);
		expect(parseWikilinkTargets('[[A]] [[B]] [[A]]')).toEqual(['A', 'B', 'A']);
		expect(parseWikilinkTargets('![[image.png]] [[Char]]')).toEqual(['Char']);
	});

});
