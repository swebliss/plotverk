import { renameCardPaths, renameGridCardPaths } from './card-paths';
import type { GridData, SceneCard } from '../grid-data';

function card(extra: Partial<SceneCard> = {}): SceneCard {
	return {
		id: 'c1', rowId: 'r1', colId: 'k1', title: 'Scene', synopsis: '', color: '#fff',
		status: 'idea', linkDisplayMode: 'synopsis', ...extra,
	};
}

function grid(cards: SceneCard[]): GridData {
	return {
		version: 1, id: 'g', name: 'G', rows: [], columns: [], cards,
		createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
	};
}

describe('renameCardPaths()', () => {
	it('follows a renamed character sheet', () => {
		const c = card({ characterPaths: ['P/Characters/Mara.md', 'P/Characters/Tobin.md'] });
		const out = renameCardPaths(c, 'P/Characters/Mara.md', 'P/Characters/Mara Ferrow.md');
		expect(out.characterPaths).toEqual(['P/Characters/Mara Ferrow.md', 'P/Characters/Tobin.md']);
	});

	it('follows every linked sheet kind', () => {
		const c = card({
			linkedEntityPaths: { location: ['P/Places/Dock.md'], event: ['P/Events/Flood.md', 'P/Places/Dock.md'] },
		});
		const out = renameCardPaths(c, 'P/Places/Dock.md', 'P/Places/Old Dock.md');
		expect(out.linkedEntityPaths).toEqual({
			location: ['P/Places/Old Dock.md'],
			event: ['P/Events/Flood.md', 'P/Places/Old Dock.md'],
		});
	});

	it('follows the linked scene page, point-of-view character and location', () => {
		const c = card({ linkedDocPath: 'P/Scenes/One.md', povCharacter: 'P/Characters/Mara.md', location: 'P/Places/Dock.md' });
		expect(renameCardPaths(c, 'P/Scenes/One.md', 'P/Scenes/Uno.md').linkedDocPath).toBe('P/Scenes/Uno.md');
		expect(renameCardPaths(c, 'P/Characters/Mara.md', 'P/Characters/M.md').povCharacter).toBe('P/Characters/M.md');
		expect(renameCardPaths(c, 'P/Places/Dock.md', 'P/Places/Pier.md').location).toBe('P/Places/Pier.md');
	});

	it('follows a renamed or moved folder, but not a sibling that only shares the start of its name', () => {
		const c = card({
			characterPaths: ['P/Characters/Mara.md', 'P/Characters Old/Ilse.md'],
			linkedEntityPaths: { location: ['P/Characters/Sub/Deep.md'] },
			linkedDocPath: 'P/Characters/Mara.md',
		});
		const out = renameCardPaths(c, 'P/Characters', 'Q/Cast');
		expect(out.characterPaths).toEqual(['Q/Cast/Mara.md', 'P/Characters Old/Ilse.md']);
		expect(out.linkedEntityPaths).toEqual({ location: ['Q/Cast/Sub/Deep.md'] });
		expect(out.linkedDocPath).toBe('Q/Cast/Mara.md');
	});

	it('matches whole paths only', () => {
		const c = card({ characterPaths: ['P/Ann.md', 'P/Anna.md'] });
		expect(renameCardPaths(c, 'P/Ann', 'P/X').characterPaths).toEqual(['P/Ann.md', 'P/Anna.md']);
		expect(renameCardPaths(c, 'P/Ann.md', 'P/Annie.md').characterPaths).toEqual(['P/Annie.md', 'P/Anna.md']);
	});

	it('does not list the same sheet twice after a rename', () => {
		const c = card({ characterPaths: ['P/Old.md', 'P/New.md'] });
		expect(renameCardPaths(c, 'P/Old.md', 'P/New.md').characterPaths).toEqual(['P/New.md']);
	});

	it('returns the very same card when nothing points at the renamed path', () => {
		const c = card({ characterPaths: ['P/A.md'], linkedEntityPaths: { item: ['P/I.md'] }, linkedDocPath: 'P/S.md' });
		expect(renameCardPaths(c, 'P/Z.md', 'P/Y.md')).toBe(c);
	});

	it('leaves the card it was given untouched', () => {
		const c = card({ characterPaths: ['P/A.md'], linkedEntityPaths: { item: ['P/A.md'] } });
		renameCardPaths(c, 'P/A.md', 'P/B.md');
		expect(c.characterPaths).toEqual(['P/A.md']);
		expect(c.linkedEntityPaths).toEqual({ item: ['P/A.md'] });
	});

	it('copes with damaged card data instead of throwing', () => {
		const odd = { ...card(), characterPaths: 'P/A.md', linkedEntityPaths: { item: 'P/A.md', place: [5, 'P/A.md'] } } as unknown as SceneCard;
		const out = renameCardPaths(odd, 'P/A.md', 'P/B.md') as unknown as Record<string, unknown>;
		expect(out.characterPaths).toBe('P/A.md');
		expect(out.linkedEntityPaths).toEqual({ item: 'P/A.md', place: [5, 'P/B.md'] });
		expect(renameCardPaths(null as unknown as SceneCard, 'P/A.md', 'P/B.md')).toBeNull();
	});
});

describe('renameGridCardPaths()', () => {
	it('updates only the cards that point at the renamed path', () => {
		const a = card({ id: 'a', characterPaths: ['P/Mara.md'] });
		const b = card({ id: 'b', characterPaths: ['P/Tobin.md'] });
		const g = grid([a, b]);
		const out = renameGridCardPaths(g, 'P/Mara.md', 'P/Mara F.md');
		expect(out).not.toBe(g);
		expect(out.cards[0].characterPaths).toEqual(['P/Mara F.md']);
		expect(out.cards[1]).toBe(b);
		expect(g.cards[0].characterPaths).toEqual(['P/Mara.md']);
	});

	it('returns the very same grid when no card points at the renamed path, so nothing is rewritten', () => {
		const g = grid([card({ characterPaths: ['P/Tobin.md'] })]);
		expect(renameGridCardPaths(g, 'P/Mara.md', 'P/Mara F.md')).toBe(g);
	});

	it('copes with a grid file that has no usable card list', () => {
		const noCards = { version: 1 } as unknown as GridData;
		expect(renameGridCardPaths(noCards, 'P/A.md', 'P/B.md')).toBe(noCards);
		expect(renameGridCardPaths(null as unknown as GridData, 'P/A.md', 'P/B.md')).toBeNull();
	});
});
