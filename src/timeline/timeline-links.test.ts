import {
	parseWikilinks,
	hasWikilink,
	addWikilink,
	removeWikilink,
	sceneLinkFor,
	setSceneLink,
	removeSceneLink,
} from './timeline-links';
import type { ChronoLink } from './timeline-data';

describe('parseWikilinks', () => {
	it('extracts plain targets in order', () => {
		expect(parseWikilinks('[[Anna]], [[Bruno]]')).toEqual(['Anna', 'Bruno']);
	});

	it('extracts the target of an aliased link', () => {
		expect(parseWikilinks('[[Anna Karlsson|Anna]] fights')).toEqual(['Anna Karlsson']);
	});

	it('returns [] for prose with no links', () => {
		expect(parseWikilinks('somewhere in the north')).toEqual([]);
	});

	it('ignores empty targets and trims whitespace', () => {
		expect(parseWikilinks('[[ ]] and [[ Anna ]]')).toEqual(['Anna']);
	});
});

describe('hasWikilink', () => {
	it('matches case-insensitively', () => {
		expect(hasWikilink('[[Anna]]', 'anna')).toBe(true);
		expect(hasWikilink('[[Anna]]', 'Bruno')).toBe(false);
	});
});

describe('addWikilink', () => {
	it('sets the link on an empty value', () => {
		expect(addWikilink('', 'Anna')).toBe('[[Anna]]');
		expect(addWikilink('   ', 'Anna')).toBe('[[Anna]]');
	});

	it('appends with a comma after existing content', () => {
		expect(addWikilink('[[Anna]]', 'Bruno')).toBe('[[Anna]], [[Bruno]]');
	});

	it('keeps surrounding prose', () => {
		expect(addWikilink('mostly villagers', 'Anna')).toBe('mostly villagers, [[Anna]]');
	});

	it('does not double an existing separator', () => {
		expect(addWikilink('[[Anna]],', 'Bruno')).toBe('[[Anna]], [[Bruno]]');
	});

	it('is a no-op when the target is already linked (any case)', () => {
		expect(addWikilink('[[Anna]]', 'anna')).toBe('[[Anna]]');
	});
});

describe('removeWikilink', () => {
	it('removes the only link', () => {
		expect(removeWikilink('[[Anna]]', 'Anna')).toBe('');
	});

	it('removes one link from a comma list, keeping the others', () => {
		expect(removeWikilink('[[Anna]], [[Bruno]]', 'Anna')).toBe('[[Bruno]]');
		expect(removeWikilink('[[Anna]], [[Bruno]]', 'Bruno')).toBe('[[Anna]]');
	});

	it('removes an aliased link by target', () => {
		expect(removeWikilink('[[Anna Karlsson|Anna]]', 'anna karlsson')).toBe('');
	});

	it('keeps prose around the removed link', () => {
		expect(removeWikilink('the square at [[Gothenburg]]', 'Gothenburg')).toBe('the square at');
	});

	it('leaves other targets and prose untouched', () => {
		expect(removeWikilink('[[Anna]] and villagers', 'Bruno')).toBe('[[Anna]] and villagers');
	});

	it('round-trips with addWikilink', () => {
		const v = addWikilink(addWikilink('', 'Anna'), 'Bruno');
		expect(removeWikilink(v, 'Bruno')).toBe('[[Anna]]');
	});
});

describe('ChronoLink scene helpers', () => {
	const link = (id: string, scenePath: string, targetNotePath: string): ChronoLink => ({ id, scenePath, targetNotePath });

	it('sceneLinkFor finds the link for one event note', () => {
		const links = [link('1', 'Scenes/A.md', 'Codex/Events/Fire.md')];
		expect(sceneLinkFor(links, 'Codex/Events/Fire.md')).toEqual(links[0]);
		expect(sceneLinkFor(links, 'Codex/Events/Other.md')).toBeUndefined();
	});

	it('setSceneLink replaces the existing link for that event (one scene chip max)', () => {
		const links = [link('1', 'Scenes/A.md', 'E.md'), link('2', 'Scenes/B.md', 'F.md')];
		const next = setSceneLink(links, link('3', 'Scenes/C.md', 'E.md'));
		expect(next).toEqual([link('2', 'Scenes/B.md', 'F.md'), link('3', 'Scenes/C.md', 'E.md')]);
	});

	it('setSceneLink appends when the event had none', () => {
		expect(setSceneLink([], link('1', 'S.md', 'E.md'))).toEqual([link('1', 'S.md', 'E.md')]);
	});

	it('removeSceneLink removes only this event\'s link', () => {
		const links = [link('1', 'S.md', 'E.md'), link('2', 'S2.md', 'F.md')];
		expect(removeSceneLink(links, 'E.md')).toEqual([link('2', 'S2.md', 'F.md')]);
		expect(removeSceneLink(links, 'missing.md')).toEqual(links);
	});
});
