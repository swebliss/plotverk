import { AnchorMap } from './anchor-map';

describe('AnchorMap', () => {
	it('finds a tag, follows renames and forgets deleted notes', () => {
		const m = new AnchorMap();
		m.setNote('Book/Ch1.md', [{ id: 'pv-aaaaaa', line: 4 }]);
		expect(m.placeOf('pv-aaaaaa')).toEqual({ path: 'Book/Ch1.md', line: 4 });
		m.renameNote('Book/Ch1.md', 'Book/Part 1/Ch1.md');
		expect(m.placeOf('pv-aaaaaa')?.path).toBe('Book/Part 1/Ch1.md');
		m.removeNote('Book/Part 1/Ch1.md');
		expect(m.placeOf('pv-aaaaaa')).toBeNull();
		expect(m.has('pv-aaaaaa')).toBe(false);
	});

	it('a paragraph cut into another scene is found there', () => {
		const m = new AnchorMap();
		m.setNote('a.md', [{ id: 'pv-aaaaaa', line: 1 }]);
		m.setNote('a.md', []);
		m.setNote('b.md', [{ id: 'pv-aaaaaa', line: 7 }]);
		expect(m.placeOf('pv-aaaaaa')).toEqual({ path: 'b.md', line: 7 });
	});

	it('a tag in two notes stays steady, the hint wins', () => {
		const m = new AnchorMap();
		m.setNote('z.md', [{ id: 'pv-aaaaaa', line: 1 }]);
		m.setNote('c.md', [{ id: 'pv-aaaaaa', line: 2 }]);
		expect(m.placeOf('pv-aaaaaa')?.path).toBe('c.md');
		expect(m.placeOf('pv-aaaaaa', 'z.md')?.path).toBe('z.md');
		expect(m.placesOf('pv-aaaaaa')).toHaveLength(2);
	});

	it('a copied scene ("Scene 3 1.md") never steals the mark from the one in the book', () => {
		const m = new AnchorMap();
		m.setNote('Book/Scenes/Scene 3.md', [{ id: 'pv-aaaaaa', line: 2 }]);
		m.setNote('Book/Scenes/Scene 3 1.md', [{ id: 'pv-aaaaaa', line: 2 }]);
		m.setNote('Book/Scenes/Scene 1.md', [{ id: 'pv-aaaaaa', line: 9 }]);
		const chapters: Record<string, number> = { 'Book/Scenes/Scene 1.md': 1, 'Book/Scenes/Scene 3.md': 3 };
		expect(m.placeOf('pv-aaaaaa', (p) => chapters[p] ?? null)?.path).toBe('Book/Scenes/Scene 1.md');
		delete chapters['Book/Scenes/Scene 1.md'];
		expect(m.placeOf('pv-aaaaaa', (p) => chapters[p] ?? null)?.path).toBe('Book/Scenes/Scene 3.md');
		// Nothing in the book: the steady alphabetical pick.
		expect(m.placeOf('pv-aaaaaa', () => null)?.path).toBe('Book/Scenes/Scene 1.md');
	});
});
