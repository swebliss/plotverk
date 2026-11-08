import {
	createEmptyGrid,
	createRow,
	createColumn,
	createCard,
	linkNewDocIfUnlinked,
	addCharacterToCard,
	commitCardDraft,
	draftEdits,
	updateCard,
	cardsInRow,
	cardsInColumn,
	snapshotRow,
	snapshotColumn,
	restoreRow,
	restoreColumn,
	pendingCards,
	sortByOrder,
	SceneCard,
	deleteRow,
	deleteColumn,
	moveCard,
	deleteCard,
	applyTemplate,
	generateEntityId,
	StorygridTemplate,
	GridData,
} from './grid-data';

describe('generateEntityId()', () => {
	it('produces an sg_ prefixed 15-char ID', () => {
		const id = generateEntityId();
		expect(id).toMatch(/^sg_[a-z0-9]{12}$/);
	});

	it('generates unique IDs', () => {
		const ids = new Set(Array.from({ length: 200 }, generateEntityId));
		expect(ids.size).toBe(200);
	});
});

describe('Grid Defaults — Landscape Postcard Cell Appearance', () => {
	describe('createRow()', () => {
		it('should set default height to 130px for postcard appearance', () => {
			const row = createRow('Thread 1');
			expect(row.height).toBe(130);
		});

		it('should preserve other row properties', () => {
			const row = createRow('Act 1', 0);
			expect(row.label).toBe('Act 1');
			expect(row.order).toBe(0);
			expect(row.id).toBeDefined();
			expect(row.id).toMatch(/^[\da-f-]+$/); // UUID format
		});

		it('should use default order if not provided', () => {
			const row = createRow('Scene 1');
			expect(row.order).toBe(999);
		});
	});

	describe('applyTemplate()', () => {
		it('should set default height 130 on rows without explicit height', () => {
			const template: StorygridTemplate = {
				id: 'test-template',
				name: 'Test',
				description: 'Test template',
				rows: [
					{ label: 'Row 1' },
					{ label: 'Row 2' },
				],
				columns: [{ label: 'Col 1' }],
			};

			const grid: GridData = {
				version: 1,
				id: 'grid-1',
				name: 'Test Grid',
				rows: [],
				columns: [],
				cards: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const result = applyTemplate(grid, template);

			expect(result.rows).toHaveLength(2);
			expect(result.rows[0].height).toBe(130);
			expect(result.rows[1].height).toBe(130);
		});

		it('should preserve explicit row heights from template', () => {
			const template: StorygridTemplate = {
				id: 'test-template',
				name: 'Test',
				description: 'Test template',
				rows: [
					{ label: 'Row 1', height: 200 },
					{ label: 'Row 2' }, // No height, should default
				],
				columns: [{ label: 'Col 1' }],
			};

			const grid: GridData = {
				version: 1,
				id: 'grid-1',
				name: 'Test Grid',
				rows: [],
				columns: [],
				cards: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const result = applyTemplate(grid, template);

			expect(result.rows[0].height).toBe(200); // Explicit height preserved
			expect(result.rows[1].height).toBe(130); // Falls back to default
		});

		it('should reset grid cards when applying template', () => {
			const template: StorygridTemplate = {
				id: 'test-template',
				name: 'Test',
				description: 'Test template',
				rows: [{ label: 'Row 1' }],
				columns: [{ label: 'Col 1' }],
			};

			const grid: GridData = {
				version: 1,
				id: 'grid-1',
				name: 'Test Grid',
				rows: [],
				columns: [],
				cards: [
					{
						id: 'card-1',
						rowId: 'row-1',
						colId: 'col-1',
						title: 'Old Card',
						synopsis: '',
						color: '#fff',
						status: 'idea',
						linkDisplayMode: 'first-lines',
					},
				],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			const result = applyTemplate(grid, template);

			expect(result.cards).toHaveLength(0);
		});
	});

	describe('createColumn()', () => {
		it('should create column with all required properties', () => {
			const col = createColumn('Act 1');
			expect(col.label).toBe('Act 1');
			expect(col.order).toBe(999);
			expect(col.id).toBeDefined();
		});

		it('should respect provided order', () => {
			const col = createColumn('Act 2', 1);
			expect(col.order).toBe(1);
		});
	});
});

// ── Card / Scene decoupling — PROTECTED behavior ───────────────────────────
// Cards and scene documents are independent. A new card must NEVER auto-create
// a scene document, and a new scene document must NEVER auto-create a grid card.
// The link is opt-in: the user must explicitly choose "Create scene document"
// or drag a scene from the Writers Panel. Do not remove or weaken these tests.
describe('Card / Scene decoupling', () => {
	it('createCard() produces no linkedDocPath by default', () => {
		const card = createCard('row-1', 'col-1', {});
		expect(card.linkedDocPath).toBeUndefined();
	});

	it('createCard() with a title still has no linkedDocPath', () => {
		const card = createCard('row-1', 'col-1', { title: 'The Burning Bridge' });
		expect(card.linkedDocPath).toBeUndefined();
	});

	it('createCard() only sets linkedDocPath when explicitly passed', () => {
		const card = createCard('row-1', 'col-1', { linkedDocPath: 'Scenes/MyScene.md' });
		expect(card.linkedDocPath).toBe('Scenes/MyScene.md');
	});

	it('createCard() never lets a stale id in defaults override the generated id', () => {
		const card = createCard('row-1', 'col-1', { id: 'stale', title: undefined as any });
		expect(card.id).not.toBe('stale');
		expect(card.title).toBe('');
	});
});

describe('linkNewDocIfUnlinked — a second document never replaces the card’s link', () => {
	const gridWith = (cards: GridData['cards']): GridData => ({
		version: 1, id: 'g', name: 'G', rows: [], columns: [], cards, createdAt: '', updatedAt: '',
	});

	it('links a card that has no document yet', () => {
		const grid = gridWith([createCard('r', 'c', { id: undefined, title: 'Opening' })]);
		const next = linkNewDocIfUnlinked(grid, grid.cards[0].id, 'Codex/Characters/Mira.md');
		expect(next.cards[0].linkedDocPath).toBe('Codex/Characters/Mira.md');
		expect(next.cards[0].linkDisplayMode).toBe('synopsis');
	});

	it('leaves a card that already has a scene page exactly as it was', () => {
		const grid = gridWith([createCard('r', 'c', { linkedDocPath: 'Scenes/Opening.md' })]);
		const next = linkNewDocIfUnlinked(grid, grid.cards[0].id, 'Codex/Characters/Mira.md');
		expect(next).toBe(grid); // same object: nothing to re-render or save
		expect(next.cards[0].linkedDocPath).toBe('Scenes/Opening.md');
	});

	it('ignores a card that no longer exists', () => {
		const grid = gridWith([createCard('r', 'c', {})]);
		expect(linkNewDocIfUnlinked(grid, 'gone', 'x.md')).toBe(grid);
	});
});

describe('commitCardDraft — the editor’s draft never moves a card', () => {
	const rowA = 'row-a', rowB = 'row-b', col = 'col-1';
	const base = (): GridData => ({
		version: 1, id: 'g', name: 'G', rows: [], columns: [], createdAt: '', updatedAt: '',
		cards: [
			{ ...createCard(rowA, col, { title: 'Opening' }), id: 'A' },
			{ ...createCard(rowB, col, { title: 'Midpoint' }), id: 'B' },
		],
	});

	it('writes the edited content', () => {
		const grid = base();
		const draft = { ...grid.cards[0], title: 'New title', synopsis: 'Edited' };
		const next = commitCardDraft(grid, draft);
		expect(next.cards[0].title).toBe('New title');
		expect(next.cards[0].synopsis).toBe('Edited');
	});

	it('a card moved while its editor was open stays where it was moved', () => {
		const grid = base();
		const draft = { ...grid.cards[0] };                 // editor opens on A (in row A)
		const moved = moveCard(grid, 'A', 'row-c', col);     // A is dragged to an empty cell
		const next = commitCardDraft(moved, { ...draft, title: 'Typed after the move' });
		const a = next.cards.find((c) => c.id === 'A')!;
		expect([a.rowId, a.colId]).toEqual(['row-c', col]);
		expect(a.title).toBe('Typed after the move');
	});

	it('a card swapped by another card dropped on it keeps its swapped cell, and no two cards share one', () => {
		const grid = base();
		const draftOfB = { ...grid.cards[1] };               // editor open on B
		const swapped = moveCard(grid, 'A', rowB, col);      // A dropped on B → they swap
		const next = commitCardDraft(swapped, { ...draftOfB, title: 'Edited B' });
		const a = next.cards.find((c) => c.id === 'A')!;
		const b = next.cards.find((c) => c.id === 'B')!;
		expect([b.rowId, b.colId]).toEqual([rowA, col]);
		expect([a.rowId, a.colId]).toEqual([rowB, col]);
		expect(new Set(next.cards.map((c) => `${c.rowId}:${c.colId}`)).size).toBe(next.cards.length);
	});

	it('does nothing for a card that has been deleted', () => {
		const grid = base();
		const next = commitCardDraft(deleteCard(grid, 'A'), { ...grid.cards[0], title: 'Ghost' });
		expect(next.cards.map((c) => c.id)).toEqual(['B']);
	});
});

describe('deleting a row or column can be undone', () => {
	const grid = (): GridData => {
		const rows = [createRow('Act 1', 0), createRow('Act 2', 1), createRow('Act 3', 2)];
		const columns = [createColumn('Mira', 0), createColumn('Kael', 1)];
		const card = (r: number, c: number, title: string) => createCard(rows[r].id, columns[c].id, { title });
		return {
			version: 1, id: 'g', name: 'G', rows, columns, createdAt: '', updatedAt: '',
			cards: [card(0, 0, 'a'), card(1, 0, 'b'), card(1, 1, 'c'), card(2, 1, 'd')],
		};
	};
	const drawn = (items: Array<{ label: string; order: number }>) => sortByOrder(items).map((i) => i.label);
	const titles = (g: GridData) => g.cards.map((c) => c.title).sort();

	it('counts the cards a delete would take', () => {
		const g = grid();
		expect(cardsInRow(g, g.rows[1].id).map((c) => c.title)).toEqual(['b', 'c']);
		expect(cardsInColumn(g, g.columns[0].id).map((c) => c.title)).toEqual(['a', 'b']);
		expect(cardsInRow(g, 'nope')).toEqual([]);
	});

	it('delete then restore a row gives back the same grid contents, drawn in the same place', () => {
		const g = grid();
		const snap = snapshotRow(g, g.rows[1].id)!;
		const after = deleteRow(g, g.rows[1].id);
		expect(after.rows).toHaveLength(2);
		expect(after.cards).toHaveLength(2);
		const back = restoreRow(after, snap);
		expect(drawn(back.rows)).toEqual(['Act 1', 'Act 2', 'Act 3']);
		expect(titles(back)).toEqual(['a', 'b', 'c', 'd']);
		const b = back.cards.find((c) => c.title === 'b')!;
		expect([b.rowId, b.colId]).toEqual([g.rows[1].id, g.columns[0].id]);
	});

	it('delete then restore a column does the same', () => {
		const g = grid();
		const snap = snapshotColumn(g, g.columns[0].id)!;
		const back = restoreColumn(deleteColumn(g, g.columns[0].id), snap);
		expect(drawn(back.columns)).toEqual(['Mira', 'Kael']);
		expect(titles(back)).toEqual(['a', 'b', 'c', 'd']);
	});

	it('first and last positions come back too', () => {
		const g = grid();
		const first = restoreRow(deleteRow(g, g.rows[0].id), snapshotRow(g, g.rows[0].id)!);
		expect(drawn(first.rows)).toEqual(['Act 1', 'Act 2', 'Act 3']);
		const last = restoreRow(deleteRow(g, g.rows[2].id), snapshotRow(g, g.rows[2].id)!);
		expect(drawn(last.rows)).toEqual(['Act 1', 'Act 2', 'Act 3']);
	});

	it('keeps the drawn position when rows were reordered after the delete (no shared order values)', () => {
		const g = grid();
		const snap = snapshotRow(g, g.rows[1].id)!;                       // Act 2 sat between Act 1 and Act 3
		const after = deleteRow(g, g.rows[1].id);
		// the writer drags Act 3 to the top: the grid renumbers like the drag handler does
		const reordered = [after.rows[1], after.rows[0]].map((r, i) => ({ ...r, order: i }));
		const back = restoreRow({ ...after, rows: reordered }, snap);     // now Act 3, Act 1
		expect(drawn(back.rows)).toEqual(['Act 3', 'Act 1', 'Act 2']);    // directly after the row it followed
		expect(new Set(back.rows.map((r) => r.order)).size).toBe(back.rows.length);
	});

	it('falls back to the old position when the row it followed is gone too', () => {
		const g = grid();
		const snap = snapshotRow(g, g.rows[1].id)!;                       // followed Act 1
		let after = deleteRow(g, g.rows[1].id);
		after = deleteRow(after, g.rows[0].id);                           // Act 1 deleted as well
		const back = restoreRow(after, snap);
		expect(drawn(back.rows)).toEqual(['Act 2', 'Act 3']);
	});

	it('keeps whatever else was edited after the delete', () => {
		const g = grid();
		const snap = snapshotRow(g, g.rows[1].id)!;
		let after = deleteRow(g, g.rows[1].id);
		after = { ...after, cards: after.cards.map((c) => (c.title === 'a' ? { ...c, title: 'a (edited)' } : c)) };
		const back = restoreRow(after, snap);
		expect(back.cards.find((c) => c.id === g.cards[0].id)!.title).toBe('a (edited)');
	});

	it('a row added after the delete is kept, and the undo still works', () => {
		const g = grid();
		const snap = snapshotRow(g, g.rows[1].id)!;
		const after = deleteRow(g, g.rows[1].id);
		const added = createRow('New row', 2);
		const back = restoreRow({ ...after, rows: [...after.rows, added] }, snap);
		expect(drawn(back.rows)).toEqual(['Act 1', 'Act 2', 'Act 3', 'New row']);
	});

	it('undoing twice does not duplicate anything', () => {
		const g = grid();
		const snap = snapshotRow(g, g.rows[1].id)!;
		const once = restoreRow(deleteRow(g, g.rows[1].id), snap);
		const twice = restoreRow(once, snap);
		expect(twice).toBe(once);
		expect(twice.cards).toHaveLength(4);
	});

	it('leaves out cards whose other row/column has since been deleted, rather than hiding them off-grid', () => {
		const g = grid();
		const colSnap = snapshotColumn(g, g.columns[1].id)!;      // delete column Kael (cards c, d)
		let after = deleteColumn(g, g.columns[1].id);
		after = deleteRow(after, g.rows[2].id);                    // then delete row Act 3 (d's row)
		const back = restoreColumn(after, colSnap);
		expect(titles(back)).toEqual(['a', 'b', 'c']);
		for (const c of back.cards) {
			expect(back.rows.some((r) => r.id === c.rowId)).toBe(true);
			expect(back.columns.some((col) => col.id === c.colId)).toBe(true);
		}
	});

	describe('a card at the crossing of a deleted row and a deleted column', () => {
		/** Delete row Act 2 (takes b, c), then column Mira (takes a): b sits at the crossing of Act 2 × Mira. */
		const bothDeleted = () => {
			const g = grid();
			const rowSnap = snapshotRow(g, g.rows[1].id)!;
			const afterRow = deleteRow(g, g.rows[1].id);
			const colSnap = snapshotColumn(afterRow, g.columns[0].id)!;
			const afterBoth = deleteColumn(afterRow, g.columns[0].id);
			return { g, rowSnap, colSnap, afterBoth };
		};

		/** What the view does: offer a snapshot's cards plus the ones still pending from earlier Undos. */
		const undo = (state: GridData, pool: SceneCard[], snap: ReturnType<typeof snapshotRow> | ReturnType<typeof snapshotColumn>, kind: 'row' | 'column') => {
			const candidate = { ...snap!, cards: [...snap!.cards, ...pool] } as never;
			const next = kind === 'row' ? restoreRow(state, candidate) : restoreColumn(state, candidate);
			return { next, pool: pendingCards(next, (candidate as { cards: SceneCard[] }).cards) };
		};

		it('is not lost when the row is undone first, then the column', () => {
			const { rowSnap, colSnap, afterBoth } = bothDeleted();
			const r1 = undo(afterBoth, [], rowSnap, 'row');
			expect(titles(r1.next)).toEqual(['c', 'd']);               // row back with c; b (in Mira's column) must wait
			const r2 = undo(r1.next, r1.pool, colSnap, 'column');
			expect(titles(r2.next)).toEqual(['a', 'b', 'c', 'd']);
			expect(r2.pool).toEqual([]);
		});

		it('is not lost when the column is undone first, then the row', () => {
			const { rowSnap, colSnap, afterBoth } = bothDeleted();
			const r1 = undo(afterBoth, [], colSnap, 'column');
			const r2 = undo(r1.next, r1.pool, rowSnap, 'row');
			expect(titles(r2.next)).toEqual(['a', 'b', 'c', 'd']);
		});
	});

	it('never puts two cards in one cell', () => {
		const g = grid();
		const snap = snapshotRow(g, g.rows[1].id)!;
		const after = deleteRow(g, g.rows[1].id);
		// a card somehow already sits where "b" used to be
		const squatter = createCard(g.rows[1].id, g.columns[0].id, { title: 'squatter' });
		const back = restoreRow({ ...after, cards: [...after.cards, squatter] }, snap);
		const cells = back.cards.map((c) => `${c.rowId}:${c.colId}`);
		expect(new Set(cells).size).toBe(cells.length);
		expect(titles(back)).toContain('squatter');                    // the card already there stays…
		expect(titles(back)).not.toContain('b');                       // …and the returning one yields rather than overlap
	});

	it('snapshots of a row or column that does not exist are null', () => {
		const g = grid();
		expect(snapshotRow(g, 'x')).toBeNull();
		expect(snapshotColumn(g, 'x')).toBeNull();
	});
});

describe('addCharacterToCard', () => {
	const gridWith = (cards: GridData['cards']): GridData => ({
		version: 1, id: 'g', name: 'G', rows: [], columns: [], cards, createdAt: '', updatedAt: '',
	});

	it('adds the character to a card that has none', () => {
		const grid = gridWith([createCard('r', 'c', { title: 'Opening' })]);
		const next = addCharacterToCard(grid, grid.cards[0].id, 'Codex/Characters/Mira.md');
		expect(next.cards[0].characterPaths).toEqual(['Codex/Characters/Mira.md']);
	});

	it('keeps the characters already on the card, and never lists one twice', () => {
		const grid = gridWith([createCard('r', 'c', { characterPaths: ['Codex/Characters/Kael.md'] })]);
		const once = addCharacterToCard(grid, grid.cards[0].id, 'Codex/Characters/Mira.md');
		expect(once.cards[0].characterPaths).toEqual(['Codex/Characters/Kael.md', 'Codex/Characters/Mira.md']);
		expect(addCharacterToCard(once, once.cards[0].id, 'Codex/Characters/Mira.md')).toBe(once);
	});

	it('works alongside a scene link: the card keeps its page and gains the character', () => {
		const grid = gridWith([createCard('r', 'c', { linkedDocPath: 'Scenes/Opening.md' })]);
		const id = grid.cards[0].id;
		let next = linkNewDocIfUnlinked(grid, id, 'Codex/Characters/Mira.md');
		next = addCharacterToCard(next, id, 'Codex/Characters/Mira.md');
		expect(next.cards[0].linkedDocPath).toBe('Scenes/Opening.md');
		expect(next.cards[0].characterPaths).toEqual(['Codex/Characters/Mira.md']);
	});

	it('ignores a card that no longer exists', () => {
		const grid = gridWith([createCard('r', 'c', {})]);
		expect(addCharacterToCard(grid, 'gone', 'x.md')).toBe(grid);
	});
});

describe('commitCardDraft with a baseline — the draft only writes what the writer edited', () => {
	const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
	const base = (): GridData => ({
		version: 1, id: 'g', name: 'G', rows: [], columns: [], createdAt: '', updatedAt: '',
		cards: [{ ...createCard('r', 'c', { title: 'Opening', synopsis: 'Old', linkedDocPath: 'Scenes/Opening.md' }), id: 'A' }],
	});

	it('writes the field the writer edited', () => {
		const grid = base();
		const baseline = clone(grid.cards[0]);
		const draft = { ...clone(baseline), synopsis: 'Typed' };
		expect(commitCardDraft(grid, draft, baseline).cards[0].synopsis).toBe('Typed');
	});

	it('keeps a link that changed outside the editor while it was open', () => {
		const grid = base();
		const baseline = clone(grid.cards[0]);                          // editor opens
		const renamed = updateCard(grid, 'A', { linkedDocPath: 'Scenes/Opening (renamed).md' }); // note renamed meanwhile
		const draft = { ...clone(baseline), synopsis: 'Typed after the rename' };               // stale link in the draft
		const next = commitCardDraft(renamed, draft, baseline);
		expect(next.cards[0].linkedDocPath).toBe('Scenes/Opening (renamed).md');
		expect(next.cards[0].synopsis).toBe('Typed after the rename');
	});

	it('the writer’s own edit of a field wins over an outside change to the same field', () => {
		const grid = base();
		const baseline = clone(grid.cards[0]);
		const changed = updateCard(grid, 'A', { title: 'Changed elsewhere' });
		const draft = { ...clone(baseline), title: 'Typed title' };
		expect(commitCardDraft(changed, draft, baseline).cards[0].title).toBe('Typed title');
	});

	it('sees an array edited in place as an edit', () => {
		const grid = base();
		const baseline = clone(grid.cards[0]);
		const draft = clone(baseline);
		draft.tags = draft.tags ?? [];
		draft.tags.push('act-one');
		expect(commitCardDraft(grid, draft, baseline).cards[0].tags).toEqual(['act-one']);
	});

	it('does nothing (same object) when nothing was edited', () => {
		const grid = base();
		const baseline = clone(grid.cards[0]);
		expect(commitCardDraft(grid, clone(baseline), baseline)).toBe(grid);
	});

	it('never writes position, even if the draft differs', () => {
		const grid = base();
		const baseline = clone(grid.cards[0]);
		const draft = { ...clone(baseline), rowId: 'stale-row', title: 'T' };
		const next = commitCardDraft(grid, draft, baseline);
		expect(next.cards[0].rowId).toBe('r');
		expect(draftEdits(baseline, draft)).toEqual({ title: 'T' });
	});
});

describe('beat hints from templates (2026-11-07)', () => {
	it('applyTemplate puts each beat’s guide on an ordinary card in a first Beat guide column', () => {
		const grid = createEmptyGrid('Hinted');
		const tpl = {
			id: 'x', name: 'x', description: '',
			rows: [{ label: 'Setup', color: undefined, hint: '0–10% · Normal life.' }, { label: 'Climax', color: undefined }],
			columns: [{ label: 'Main Plot', color: undefined }],
		};
		const out = applyTemplate(grid, tpl, 'Beat guide');
		const cols = [...out.columns].sort((a, b) => a.order - b.order);
		expect(cols.map((c) => c.label)).toEqual(['Beat guide', 'Main Plot']);
		expect(out.rows.every((r) => r.hint === undefined)).toBe(true); // not kept on the rows
		expect(out.cards).toHaveLength(1); // only hinted rows get a card
		expect(out.cards[0]).toMatchObject({ rowId: out.rows[0].id, colId: cols[0].id, title: '0–10%', synopsis: 'Normal life.', guide: true });
	});
	it('a template without guide text gets no guide column', () => {
		const out = applyTemplate(createEmptyGrid('Plain'), { id: 'y', name: 'y', description: '', rows: [{ label: 'A', color: undefined }], columns: [{ label: 'B', color: undefined }] });
		expect(out.columns.map((c) => c.label)).toEqual(['B']);
		expect(out.cards).toEqual([]);
	});
	it('an empty grid has the templates’ shape: beats down, threads across', () => {
		const g = createEmptyGrid('Empty');
		expect(g.rows[0].label).toBe('Beat 1');
		expect(g.columns[0].label).toBe('Thread 1');
	});
});
