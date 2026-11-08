import {
	ProseCoachSettings, resolveCoachMode, isRevisingStatus, noteIsRevising, migrateProseCoach, addNeverWord, removeNeverWord,
	dismissInScene, dismissedFor, renameDismissedPaths, forgetDismissedPath,
} from './coach-settings';
import { DEFAULT_SETTINGS } from '../default-settings';
import { mergeSettings } from '../utils/settings-merge';

describe('migrateProseCoach', () => {
	test('highlightsAlwaysOn: true becomes mode "always"', () => {
		const s: ProseCoachSettings = { highlightsAlwaysOn: true, helpLevel: 'suggestions' };
		expect(migrateProseCoach(s)).toBe(true);
		expect(s).toEqual({ mode: 'always' });
	});
	test('anything else becomes mode "off"', () => {
		for (const legacy of [{ highlightsAlwaysOn: false }, {}, { helpLevel: 'highlights' }] as ProseCoachSettings[]) {
			migrateProseCoach(legacy);
			expect(legacy.mode).toBe('off');
			expect('highlightsAlwaysOn' in legacy).toBe(false);
			expect('helpLevel' in legacy).toBe(false);
		}
	});
	test('an existing mode is kept and a second run changes nothing', () => {
		const s: ProseCoachSettings = { mode: 'revising', adverbs: false };
		expect(migrateProseCoach(s)).toBe(false);
		expect(s).toEqual({ mode: 'revising', adverbs: false });
	});
	test('an unknown saved mode is repaired', () => {
		const s = { mode: 'sometimes' } as unknown as ProseCoachSettings;
		migrateProseCoach(s);
		expect(s.mode).toBe('off');
	});
	test('cleans hand-edited lists', () => {
		const s = {
			mode: 'off',
			neverWords: ['Slowly', 'slowly', '', 7, " Ledger's "],
			dismissed: { 'a.md': ['adverb:slowly', 'adverb:slowly', 3, 'junk'], 'b.md': [], 'c.md': 'x' },
		} as unknown as ProseCoachSettings;
		expect(migrateProseCoach(s)).toBe(true);
		expect(s.neverWords).toEqual(['slowly', 'ledger']);
		expect(s.dismissed).toEqual({ 'a.md': ['adverb:slowly'] });
		expect(migrateProseCoach(s)).toBe(false);
	});
});

describe('resolveCoachMode / isRevisingStatus', () => {
	test('reads mode, falls back to the legacy flag, defaults to off', () => {
		expect(resolveCoachMode(undefined)).toBe('off');
		expect(resolveCoachMode({ highlightsAlwaysOn: true })).toBe('always');
		expect(resolveCoachMode({ mode: 'revising', highlightsAlwaysOn: true })).toBe('revising');
	});
	test('written / revised / final count as revising, in any case', () => {
		for (const s of ['written', 'Revised', ' final ']) expect(isRevisingStatus(s)).toBe(true);
		for (const s of ['idea', 'outline', 'draft', '', undefined, 3]) expect(isRevisingStatus(s)).toBe(false);
	});
});

describe('noteIsRevising', () => {
	const line = (st: string) => `*POV: [[Mara]] · Location: [[Tidehouse]] · Status: ${st}*`;
	test('frontmatter status wins', () => {
		expect(noteIsRevising('written', line('idea'))).toBe(true);
		expect(noteIsRevising('draft', line('final'))).toBe(false);
	});
	test('without frontmatter, every metadata line must be revising', () => {
		expect(noteIsRevising(undefined, ['## One', line('written'), 'Text.', '## Two', line('revised')].join('\n'))).toBe(true);
		expect(noteIsRevising(undefined, [line('written'), line('draft')].join('\r\n'))).toBe(false);
		expect(noteIsRevising('', 'Just prose, no status.')).toBe(false);
		expect(noteIsRevising(undefined, 'POV: Mara · Status: **final**')).toBe(true);
	});
});

describe('"Never this word"', () => {
	test('adds once, normalized; removes', () => {
		const s: ProseCoachSettings = {};
		expect(addNeverWord(s, 'Ledger’s')).toBe(true);
		expect(addNeverWord(s, 'ledger')).toBe(false);
		expect(s.neverWords).toEqual(['ledger']);
		expect(removeNeverWord(s, 'LEDGER')).toBe(true);
		expect(s.neverWords).toEqual([]);
		expect(addNeverWord(s, '   ')).toBe(false);
	});
});

describe('"Not here"', () => {
	test('per scene, no duplicates, read back as a set', () => {
		const s: ProseCoachSettings = {};
		expect(dismissInScene(s, 'Book/Scenes/One.md', 'adverb:slowly')).toBe(true);
		expect(dismissInScene(s, 'Book/Scenes/One.md', 'adverb:slowly')).toBe(false);
		expect([...dismissedFor(s, 'Book/Scenes/One.md')]).toEqual(['adverb:slowly']);
		expect(dismissedFor(s, 'Book/Scenes/Two.md').size).toBe(0);
		expect(dismissedFor(undefined, 'x.md').size).toBe(0);
	});
	test('follows a renamed scene and a renamed folder; merges on collision', () => {
		const s: ProseCoachSettings = {
			dismissed: {
				'Book/Scenes/One.md': ['adverb:slowly'],
				'Book/Scenes/Two.md': ['repetition:cold'],
				'Other/Three.md': ['adverb:quietly'],
			},
		};
		expect(renameDismissedPaths(s, 'Book/Scenes/One.md', 'Book/Scenes/Uno.md')).toBe(true);
		expect(renameDismissedPaths(s, 'Book/Scenes', 'Book/Chapters')).toBe(true);
		expect(s.dismissed).toEqual({
			'Book/Chapters/Uno.md': ['adverb:slowly'],
			'Book/Chapters/Two.md': ['repetition:cold'],
			'Other/Three.md': ['adverb:quietly'],
		});
		s.dismissed!['Book/Chapters/Dos.md'] = ['adverb:slowly', 'adverb:fast'];
		renameDismissedPaths(s, 'Book/Chapters/Uno.md', 'Book/Chapters/Dos.md');
		expect(s.dismissed!['Book/Chapters/Dos.md']).toEqual(['adverb:slowly', 'adverb:fast']);
		// "Book/Sc" must not match "Book/Scenes…" (prefix needs the slash)
		expect(renameDismissedPaths(s, 'Other/Thr', 'X')).toBe(false);
	});
});

describe('defaults', () => {
	test('a fresh install has marks off and passive off', () => {
		const settings = mergeSettings(DEFAULT_SETTINGS, {});
		expect(resolveCoachMode(settings.proseCoach)).toBe('off');
		expect(settings.proseCoach?.passive === true).toBe(false);
	});
});

describe('forgetDismissedPath', () => {
	test('a deleted scene or folder forgets its "Not here" choices', () => {
		const s: ProseCoachSettings = { dismissed: { 'A/one.md': ['a:b'], 'A/B/two.md': ['a:b'], 'AB/x.md': ['a:b'] } };
		expect(forgetDismissedPath(s, 'A')).toBe(true);
		expect(s.dismissed).toEqual({ 'AB/x.md': ['a:b'] });
		expect(forgetDismissedPath(s, 'Nope.md')).toBe(false);
	});
});
