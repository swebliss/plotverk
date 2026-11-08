import {
	IndexedEntity,
	assignRoot,
	buildIndexData,
	listFromIndex,
	upsertEntity,
	removeEntityByPath,
} from './entity-index';
import type { EntityInfo } from './entity-manager';
import type { EntityKind } from './entity-kinds';

// Minimal IndexedEntity factory — the pure logic only touches `file.path`,
// `name`, `kind`, and `rootPath`, so the TFile is a structural stub.
function ent(path: string, name: string, kind: EntityKind, rootPath: string): IndexedEntity {
	return {
		file: { path } as EntityInfo['file'],
		kind,
		name,
		facts: [],
		imagePath: null,
		parent: null,
		entityId: null,
		rootPath,
	};
}

describe('assignRoot', () => {
	test('picks the deepest project root that is a prefix', () => {
		const roots = ['', 'Books', 'Books/Saga'];
		expect(assignRoot('Books/Saga/Codex/Characters/Vex.md', roots)).toBe('Books/Saga');
		expect(assignRoot('Books/Codex/Characters/Vex.md', roots)).toBe('Books');
		expect(assignRoot('Loose/Note.md', roots)).toBe('');
	});

	test('returns null when no root (not even vault root) contains the path', () => {
		expect(assignRoot('Books/Note.md', ['Books/Saga'])).toBeNull();
	});

	test('requires a path-segment boundary, not a bare string prefix', () => {
		// "BooksClub" must NOT be claimed by the "Books" project.
		expect(assignRoot('BooksClub/Note.md', ['', 'Books'])).toBe('');
	});

	test('an exact folder-path match counts as contained', () => {
		expect(assignRoot('Books', ['', 'Books'])).toBe('Books');
	});
});

describe('buildIndexData', () => {
	test('groups by root then kind and sorts each leaf by name', () => {
		const data = buildIndexData([
			ent('R/Codex/Characters/Zara.md', 'Zara', 'character', 'R'),
			ent('R/Codex/Characters/Ada.md', 'Ada', 'character', 'R'),
			ent('R/Codex/Locations/Keep.md', 'Keep', 'location', 'R'),
			ent('S/Codex/Characters/Bo.md', 'Bo', 'character', 'S'),
		]);

		expect(listFromIndex(data, 'R', 'character').map((e) => e.name)).toEqual(['Ada', 'Zara']);
		expect(listFromIndex(data, 'R', 'location').map((e) => e.name)).toEqual(['Keep']);
		expect(listFromIndex(data, 'S', 'character').map((e) => e.name)).toEqual(['Bo']);
	});

	test('does not leak the rootPath tag into stored EntityInfo', () => {
		const data = buildIndexData([ent('R/x.md', 'X', 'character', 'R')]);
		expect('rootPath' in listFromIndex(data, 'R', 'character')[0]).toBe(false);
	});

	test('listFromIndex returns [] for unknown root or kind', () => {
		const data = buildIndexData([]);
		expect(listFromIndex(data, 'nope', 'character')).toEqual([]);
	});
});

describe('listFromIndex — series / ancestor inclusion', () => {
	// Series "My First Series" owns no .storygrid of its own; its book lives at
	// "My First Series/The First Book" and entities are indexed under that deeper root.
	const SERIES = 'My First Series';
	const BOOK = 'My First Series/The First Book';

	function seriesData() {
		return buildIndexData([
			ent(`${BOOK}/Codex/Characters/Ted.md`, 'Ted', 'character', BOOK),
			ent(`${BOOK}/Codex/Locations/Keep.md`, 'Keep', 'location', BOOK),
			ent('Other Series/Book A/Codex/Characters/Zara.md', 'Zara', 'character', 'Other Series/Book A'),
		]);
	}

	test('series root sees entities from descendant book roots', () => {
		const data = seriesData();
		expect(listFromIndex(data, SERIES, 'character').map((e) => e.name)).toEqual(['Ted']);
		expect(listFromIndex(data, SERIES, 'location').map((e) => e.name)).toEqual(['Keep']);
	});

	test('book root sees only its own entities, not siblings or cousins', () => {
		const data = seriesData();
		expect(listFromIndex(data, BOOK, 'character').map((e) => e.name)).toEqual(['Ted']);
		expect(listFromIndex(data, BOOK, 'character').map((e) => e.name)).not.toContain('Zara');
	});

	test('vault root ("") sees entities from every project', () => {
		const data = seriesData();
		expect(listFromIndex(data, '', 'character').map((e) => e.name)).toEqual(['Ted', 'Zara']);
	});

	test('series root does not match unrelated roots with same prefix characters', () => {
		// "My First" should NOT accidentally see "My First SeriesClub/..."
		const data = buildIndexData([
			ent('My First SeriesClub/Book/Codex/Characters/Ghost.md', 'Ghost', 'character', 'My First SeriesClub/Book'),
			ent(`${BOOK}/Codex/Characters/Ted.md`, 'Ted', 'character', BOOK),
		]);
		expect(listFromIndex(data, SERIES, 'character').map((e) => e.name)).toEqual(['Ted']);
	});

	test('result is merged and sorted by name across multiple book roots', () => {
		const data = buildIndexData([
			ent('Series/Book2/Codex/Characters/Zara.md', 'Zara', 'character', 'Series/Book2'),
			ent('Series/Book1/Codex/Characters/Ada.md', 'Ada', 'character', 'Series/Book1'),
			ent('Series/Book1/Codex/Characters/Mira.md', 'Mira', 'character', 'Series/Book1'),
		]);
		expect(listFromIndex(data, 'Series', 'character').map((e) => e.name)).toEqual(['Ada', 'Mira', 'Zara']);
	});
});

describe('upsertEntity', () => {
	test('inserts a new entity in sorted position', () => {
		const data = buildIndexData([ent('R/Ada.md', 'Ada', 'character', 'R')]);
		upsertEntity(data, ent('R/Mira.md', 'Mira', 'character', 'R'));
		upsertEntity(data, ent('R/Bea.md', 'Bea', 'character', 'R'));
		expect(listFromIndex(data, 'R', 'character').map((e) => e.name)).toEqual(['Ada', 'Bea', 'Mira']);
	});

	test('replaces an existing entity by path (rename within same bucket)', () => {
		const data = buildIndexData([ent('R/Ada.md', 'Ada', 'character', 'R')]);
		upsertEntity(data, ent('R/Ada.md', 'Adalind', 'character', 'R'));
		expect(listFromIndex(data, 'R', 'character').map((e) => e.name)).toEqual(['Adalind']);
	});

	test('moves an entity that changed kind, leaving no stale copy', () => {
		const data = buildIndexData([ent('R/X.md', 'X', 'character', 'R')]);
		upsertEntity(data, ent('R/X.md', 'X', 'faction', 'R'));
		expect(listFromIndex(data, 'R', 'character')).toEqual([]);
		expect(listFromIndex(data, 'R', 'faction').map((e) => e.name)).toEqual(['X']);
	});

	test('moves an entity that changed project root', () => {
		const data = buildIndexData([ent('R/X.md', 'X', 'character', 'R')]);
		// Simulate the file now resolving to a deeper project (same path key here
		// is fine — the test only exercises the grouping move).
		upsertEntity(data, ent('R/X.md', 'X', 'character', 'S'));
		expect(listFromIndex(data, 'R', 'character')).toEqual([]);
		expect(listFromIndex(data, 'S', 'character').map((e) => e.name)).toEqual(['X']);
	});
});

describe('removeEntityByPath', () => {
	test('removes the entity and reports success', () => {
		const data = buildIndexData([
			ent('R/A.md', 'A', 'character', 'R'),
			ent('R/B.md', 'B', 'character', 'R'),
		]);
		expect(removeEntityByPath(data, 'R/A.md')).toBe(true);
		expect(listFromIndex(data, 'R', 'character').map((e) => e.name)).toEqual(['B']);
	});

	test('returns false for an unknown path', () => {
		const data = buildIndexData([ent('R/A.md', 'A', 'character', 'R')]);
		expect(removeEntityByPath(data, 'R/ghost.md')).toBe(false);
	});

	test('prunes empty kind and root buckets', () => {
		const data = buildIndexData([ent('R/A.md', 'A', 'character', 'R')]);
		removeEntityByPath(data, 'R/A.md');
		expect(data.has('R')).toBe(false);
	});
});
