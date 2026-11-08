import { scopeToBook } from './project-scope';

type Entry = { path: string; kind: string };
const e = (path: string, kind = 'character'): Entry => ({ path, kind });
const scope = (items: Entry[], note: string) => scopeToBook(items, note, (x) => x).map((x) => x.path);

// Two single-book projects, and a series with one shared Codex and two books.
const VAULT: Entry[] = [
	e('Saltmarch/Codex/Characters/Mara.md'),
	e('Saltmarch/Codex/Places/Harbour.md', 'location'),
	e('Saltmarch/Scenes/Arrival.md', 'scene'),
	e('Other Book/Codex/Characters/Zed.md'),
	e('Other Book/Scenes/Opening.md', 'scene'),
	e('Sweden/Codex/Characters/Ilse.md'),
	e('Sweden/Gothenburg/Scenes/One.md', 'scene'),
	e('Sweden/Stockholm/Scenes/Two.md', 'scene'),
];

describe('scopeToBook — which Codex entries a note can see', () => {
	test('a scene sees only its own book', () => {
		expect(scope(VAULT, 'Saltmarch/Scenes/Draft.md')).toEqual([
			'Saltmarch/Codex/Characters/Mara.md',
			'Saltmarch/Codex/Places/Harbour.md',
			'Saltmarch/Scenes/Arrival.md',
		]);
		expect(scope(VAULT, 'Other Book/Scenes/Draft.md')).toEqual(['Other Book/Codex/Characters/Zed.md', 'Other Book/Scenes/Opening.md']);
	});

	test('a folder holding only scenes is not a Codex: the series Codex further up is used', () => {
		const found = scope(VAULT, 'Sweden/Gothenburg/Scenes/Draft.md');
		expect(found).toContain('Sweden/Codex/Characters/Ilse.md');
		expect(found).not.toContain('Saltmarch/Codex/Characters/Mara.md');
		expect(found).not.toContain('Other Book/Codex/Characters/Zed.md');
	});

	test('a book with its own Codex uses that one (deepest folder wins)', () => {
		const items = [e('Sweden/Codex/Characters/Ilse.md'), e('Sweden/Gothenburg/Codex/Characters/Anders.md')];
		expect(scope(items, 'Sweden/Gothenburg/Scenes/Draft.md')).toEqual(['Sweden/Gothenburg/Codex/Characters/Anders.md']);
	});

	test('a sheet inside the Codex sees its whole book, not just its own kind of entry', () => {
		expect(scope(VAULT, 'Saltmarch/Codex/Characters/Mara.md')).toEqual([
			'Saltmarch/Codex/Characters/Mara.md',
			'Saltmarch/Codex/Places/Harbour.md',
			'Saltmarch/Scenes/Arrival.md',
		]);
	});

	test('a folder called Codex around a book does not confuse the scope', () => {
		const items = [e('Codex/Book1/Codex/Characters/A.md'), e('Codex/Book1/Scenes/S.md', 'scene'), e('Codex/Book2/Codex/Characters/B.md')];
		// A plain note there: the deepest folder holding entries.
		expect(scope(items, 'Codex/Book1/Chapter1.md')).toEqual(['Codex/Book1/Codex/Characters/A.md', 'Codex/Book1/Scenes/S.md']);
		// A sheet there: back to the folder above its own Codex.
		expect(scope(items, 'Codex/Book1/Codex/Characters/A.md')).toEqual(['Codex/Book1/Codex/Characters/A.md', 'Codex/Book1/Scenes/S.md']);
	});

	test('a note outside every project keeps the whole vault', () => {
		expect(scope(VAULT, 'Daily/2026-11-06.md')).toEqual(VAULT.map((x) => x.path));
		expect(scope(VAULT, 'Inbox.md')).toEqual(VAULT.map((x) => x.path));
	});

	test('a similar folder name is not the same project', () => {
		const items = [e('Salt/Codex/Characters/A.md'), e('Saltmarch/Codex/Characters/B.md')];
		expect(scope(items, 'Saltmarch/Scenes/x.md')).toEqual(['Saltmarch/Codex/Characters/B.md']);
	});

	test('only scenes, events and research above the note: nothing anchors, so the whole vault', () => {
		const items = [e('Solo/Scenes/A.md', 'scene'), e('Solo/Timeline/B.md', 'event'), e('Elsewhere/Codex/Characters/C.md')];
		expect(scope(items, 'Solo/Scenes/x.md')).toEqual(items.map((x) => x.path));
	});

	test('an empty vault gives an empty list', () => {
		expect(scope([], 'Saltmarch/Scenes/x.md')).toEqual([]);
	});

	test('returns the caller\'s own items, in order, without changing the list passed in', () => {
		const items = [...VAULT];
		const out = scopeToBook(items, 'Saltmarch/Scenes/x.md', (x) => x);
		expect(items).toEqual(VAULT);
		expect(out[0]).toBe(VAULT[0]);
	});
});
