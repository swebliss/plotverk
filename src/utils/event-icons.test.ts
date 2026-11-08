import { EVENT_ICONS, EVENT_ICON_BY_ID, fallbackEventIcon, phosphorIconValue, resolveEventIcon } from './event-icons';

describe('EVENT_ICONS registry integrity', () => {
	it('has non-empty path data for every entry', () => {
		for (const icon of EVENT_ICONS) {
			expect(icon.path.length).toBeGreaterThan(0);
			// Every source file is a single 256x256 Bold path — a sanity check
			// that nothing was truncated or pasted in twice.
			expect(icon.path).toMatch(/^[0-9a-zA-Z.,\- ]+$/);
		}
	});

	it('has unique ids', () => {
		const ids = EVENT_ICONS.map((i) => i.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('has lowercase keywords', () => {
		for (const icon of EVENT_ICONS) {
			for (const kw of icon.keywords) {
				expect(kw).toBe(kw.toLowerCase());
			}
		}
	});

	it('has at least one keyword per icon', () => {
		for (const icon of EVENT_ICONS) {
			expect(icon.keywords.length).toBeGreaterThan(0);
		}
	});

	// Bundle discipline: the plan calls for "roughly 60", not the full
	// 1512-icon Phosphor set.
	it('stays in the curated ~60 range, not the full Phosphor set', () => {
		expect(EVENT_ICONS.length).toBeGreaterThanOrEqual(50);
		expect(EVENT_ICONS.length).toBeLessThanOrEqual(70);
	});

	it('EVENT_ICON_BY_ID indexes every entry in EVENT_ICONS', () => {
		expect(Object.keys(EVENT_ICON_BY_ID).length).toBe(EVENT_ICONS.length);
		for (const icon of EVENT_ICONS) {
			expect(EVENT_ICON_BY_ID[icon.id]).toBe(icon);
		}
	});
});

describe('phosphorIconValue()', () => {
	it('prefixes the id with "phosphor:"', () => {
		expect(phosphorIconValue('sword')).toBe('phosphor:sword');
	});
});

describe('resolveEventIcon()', () => {
	it('prefers the event\'s own icon over the track\'s', () => {
		const icon = resolveEventIcon(phosphorIconValue('sword'), phosphorIconValue('heart'));
		expect(icon?.id).toBe('sword');
	});

	it('falls back to the track icon when the event has none', () => {
		const icon = resolveEventIcon(undefined, phosphorIconValue('heart'));
		expect(icon?.id).toBe('heart');
	});

	it('resolves to no icon when neither the event nor the track has one', () => {
		expect(resolveEventIcon(undefined, undefined)).toBeUndefined();
	});

	it('resolves an unknown event icon id to no icon (never throws)', () => {
		expect(resolveEventIcon(phosphorIconValue('does-not-exist'), undefined)).toBeUndefined();
	});

	it('falls through to the track icon when the event icon id is unknown', () => {
		const icon = resolveEventIcon(phosphorIconValue('does-not-exist'), phosphorIconValue('heart'));
		expect(icon?.id).toBe('heart');
	});

	it('resolves a malformed value (no prefix) to no icon rather than throwing', () => {
		expect(resolveEventIcon('sword', undefined)).toBeUndefined();
	});

	it('resolves a value with the wrong prefix (e.g. a future "image:" reference) to no icon today', () => {
		expect(resolveEventIcon('image:Assets/crest.png', undefined)).toBeUndefined();
	});

	it('resolves an empty string to no icon', () => {
		expect(resolveEventIcon('', undefined)).toBeUndefined();
	});
});

describe('fallbackEventIcon', () => {
	it('gives every kind of timeline event a real registry icon', () => {
		for (const kind of ['event', 'character-born', 'character-died'] as const) {
			expect(EVENT_ICONS).toContain(fallbackEventIcon(kind));
		}
	});
	it('says birth and death at a glance', () => {
		expect(fallbackEventIcon('character-born').id).toBe('baby');
		expect(fallbackEventIcon('character-died').id).toBe('skull');
	});
});
