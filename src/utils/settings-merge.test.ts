import { mergeSettings } from './settings-merge';
import { DEFAULT_SETTINGS } from '../default-settings';

const defaults = {
	count: 3,
	intent: null as string | null,
	statusColors: { idea: '#a', outline: '#b', final: '#c' },
	palettes: [
		{ id: 'default', colors: ['#1', '#2'] },
		{ id: 'warm', colors: ['#3'] },
	],
	windows: ['daily', 'weekly'],
	sparse: {} as Record<string, number>,
};

describe('mergeSettings', () => {
	test('a nested default added after the save was written is filled in', () => {
		const savedBeforeFinalExisted = { statusColors: { idea: '#x', outline: '#y' } };
		const out = mergeSettings(defaults, savedBeforeFinalExisted);
		expect(out.statusColors).toEqual({ idea: '#x', outline: '#y', final: '#c' });
	});

	test('saved scalars win over defaults', () => {
		expect(mergeSettings(defaults, { count: 7, intent: 'novelist' })).toMatchObject({ count: 7, intent: 'novelist' });
	});

	test('saved lists are taken whole: a deleted palette stays deleted, a turned-off window stays off', () => {
		const out = mergeSettings(defaults, { palettes: [{ id: 'warm', colors: ['#3'] }], windows: ['daily'] });
		expect(out.palettes).toEqual([{ id: 'warm', colors: ['#3'] }]);
		expect(out.windows).toEqual(['daily']);
	});

	test('saved keys the defaults do not know about are kept', () => {
		const out = mergeSettings(defaults, { dashboard: { todos: { p: [] } } }) as Record<string, unknown>;
		expect(out.dashboard).toEqual({ todos: { p: [] } });
	});

	test('a sparse default object stays sparse', () => {
		expect(mergeSettings(defaults, { sparse: { a: 1 } }).sparse).toEqual({ a: 1 });
		expect(mergeSettings(defaults, null).sparse).toEqual({});
	});

	test('no data.json (null or undefined) yields the defaults', () => {
		expect(mergeSettings(defaults, null)).toEqual(defaults);
		expect(mergeSettings(defaults, undefined)).toEqual(defaults);
	});

	test('an explicit undefined in saved data keeps the default (Object.assign would have wiped it)', () => {
		expect(mergeSettings(defaults, { count: undefined }).count).toBe(3);
	});

	test('a fresh install shares nothing with the defaults', () => {
		const out = mergeSettings(defaults, null);
		out.palettes[0].colors.push('#new');
		out.statusColors.idea = '#changed';
		expect(defaults.palettes[0].colors).toEqual(['#1', '#2']);
		expect(defaults.statusColors.idea).toBe('#a');
	});

	test('the defaults are never mutated by a merge', () => {
		const before = JSON.stringify(defaults);
		mergeSettings(defaults, { statusColors: { idea: '#x' }, sparse: { z: 9 }, palettes: [] });
		expect(JSON.stringify(defaults)).toBe(before);
	});

	test('prototype keys in saved data are ignored', () => {
		const saved = JSON.parse('{"__proto__": {"polluted": true}, "count": 1}');
		const out = mergeSettings(defaults, saved) as Record<string, unknown>;
		expect(out.count).toBe(1);
		expect(out.polluted).toBeUndefined();
		expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
	});
});

describe('mergeSettings with the shipped DEFAULT_SETTINGS', () => {
	test('an old save missing a status color gets the shipped default for it', () => {
		const { outline, draft, written, revised } = DEFAULT_SETTINGS.statusColors;
		const savedWithoutFinal = { statusColors: { idea: '#123456', outline, draft, written, revised } };
		const out = mergeSettings(DEFAULT_SETTINGS, savedWithoutFinal);
		expect(out.statusColors.idea).toBe('#123456');
		expect(out.statusColors.final).toBe(DEFAULT_SETTINGS.statusColors.final);
	});

	test('a fresh install is a deep copy of the shipped defaults', () => {
		const out = mergeSettings(DEFAULT_SETTINGS, null);
		expect(out).toEqual(DEFAULT_SETTINGS);
		expect(out.colorPalettes).not.toBe(DEFAULT_SETTINGS.colorPalettes);
		expect(out.colorPalettes[0]).not.toBe(DEFAULT_SETTINGS.colorPalettes[0]);
		expect(out.colorPalettes[0].colors).not.toBe(DEFAULT_SETTINGS.colorPalettes[0].colors);
		expect(out.statusColors).not.toBe(DEFAULT_SETTINGS.statusColors);
	});

	test('lazily-created optional groups survive the load untouched', () => {
		const out = mergeSettings(DEFAULT_SETTINGS, {
			hasSeenWelcome: true,
			compileState: { 'a.storygrid': { excluded: ['s.md'] } },
		});
		expect(out.hasSeenWelcome).toBe(true);
		expect(out.compileState).toEqual({ 'a.storygrid': { excluded: ['s.md'] } });
	});
});
