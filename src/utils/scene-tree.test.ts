import {
	SceneTree,
	buildTreeFromFlatOrder,
	flattenTree,
	createDividerNode,
	createDocNode,
	moveNode,
	indentNode,
	outdentNode,
	renameDocPath,
	removeDocByPath,
	collectDocPaths,
	addMissingDocs,
	resolveSceneTree,
	renameDividerLabel,
	removeNodePromotingChildren,
	getDescendantIds,
	getProjection,
	moveNodeBefore,
	moveSibling,
	canMoveSibling,
	ProjectionRow,
} from './scene-tree';

describe('moveSibling (Move up / Move down)', () => {
	test('moves a scene up and down one place at the root', () => {
		let tree = buildTreeFromFlatOrder(['a.md', 'b.md', 'c.md']);
		const cId = tree[2].id;
		tree = moveSibling(tree, cId, -1);
		expect(collectDocPaths(tree)).toEqual(['a.md', 'c.md', 'b.md']);
		tree = moveSibling(tree, cId, 1);
		expect(collectDocPaths(tree)).toEqual(['a.md', 'b.md', 'c.md']);
	});

	test('is a no-op at either end, and canMoveSibling says so', () => {
		const tree = buildTreeFromFlatOrder(['a.md', 'b.md']);
		const [a, b] = tree;
		expect(canMoveSibling(tree, a.id, -1)).toBe(false);
		expect(canMoveSibling(tree, b.id, 1)).toBe(false);
		expect(canMoveSibling(tree, a.id, 1)).toBe(true);
		expect(moveSibling(tree, a.id, -1)).toBe(tree);
		expect(moveSibling(tree, b.id, 1)).toBe(tree);
		expect(canMoveSibling(tree, 'missing', 1)).toBe(false);
	});

	test('stays inside its chapter and never changes nesting', () => {
		const act = createDividerNode('Act 1');
		const x = createDocNode('x.md');
		const y = createDocNode('y.md');
		act.children = [x, y];
		let tree: SceneTree = [act, createDocNode('z.md')];
		expect(canMoveSibling(tree, x.id, -1)).toBe(false); // first in its chapter: cannot leave it
		tree = moveSibling(tree, y.id, -1);
		const flat = flattenTree(tree);
		expect(flat.map((f) => f.node.docPath ?? f.node.label)).toEqual(['Act 1', 'y.md', 'x.md', 'z.md']);
		expect(flat[1].parentId).toBe(act.id);
		expect(flat[2].parentId).toBe(act.id);
	});

	test('a divider moves with its whole chapter', () => {
		const act = createDividerNode('Act 2');
		act.children = [createDocNode('p.md'), createDocNode('q.md')];
		let tree: SceneTree = [createDocNode('a.md'), act];
		tree = moveSibling(tree, act.id, -1);
		expect(collectDocPaths(tree)).toEqual(['p.md', 'q.md', 'a.md']);
		expect(flattenTree(tree).map((f) => f.number)).toEqual(['1', '1.1', '1.2', '2']);
	});
});

describe('scene-tree', () => {
	test('migration from flat order numbers 1, 2, 3…', () => {
		const tree = buildTreeFromFlatOrder(['a.md', 'b.md', 'c.md']);
		const flat = flattenTree(tree);
		expect(flat.map((f) => f.number)).toEqual(['1', '2', '3']);
		expect(flat.map((f) => f.depth)).toEqual([0, 0, 0]);
	});

	test('nested numbering follows position, not stored data', () => {
		const beat = createDividerNode('Break Into 2');
		const scene = createDocNode('b-story.md');
		beat.children = [scene];
		const tree: SceneTree = [createDividerNode('Act 1'), beat];
		const flat = flattenTree(tree);
		expect(flat.map((f) => f.number)).toEqual(['1', '2', '2.1']);
		expect(flat[2].depth).toBe(1);
	});

	test('moveNode reorders and renumbers automatically', () => {
		let tree = buildTreeFromFlatOrder(['a.md', 'b.md', 'c.md']);
		const bId = tree[1].id;
		tree = moveNode(tree, bId, null, 0);
		expect(collectDocPaths(tree)).toEqual(['b.md', 'a.md', 'c.md']);
		expect(flattenTree(tree).map((f) => f.number)).toEqual(['1', '2', '3']);
	});

	test('moveNode can re-nest a node under another', () => {
		let tree = buildTreeFromFlatOrder(['a.md', 'b.md']);
		const [a, b] = tree;
		tree = moveNode(tree, b.id, a.id, 0);
		const flat = flattenTree(tree);
		expect(flat.map((f) => f.number)).toEqual(['1', '1.1']);
		expect(flat[1].parentId).toBe(a.id);
	});

	test('indentNode nests under previous sibling; no-op on first sibling', () => {
		let tree = buildTreeFromFlatOrder(['a.md', 'b.md', 'c.md']);
		const bId = tree[1].id;
		tree = indentNode(tree, bId);
		let flat = flattenTree(tree);
		expect(flat.map((f) => f.number)).toEqual(['1', '1.1', '2']);

		const aId = tree[0].id;
		const unchanged = indentNode(tree, aId);
		expect(flattenTree(unchanged).map((f) => f.number)).toEqual(['1', '1.1', '2']);
	});

	test('outdentNode reverses indentNode', () => {
		let tree = buildTreeFromFlatOrder(['a.md', 'b.md', 'c.md']);
		const bId = tree[1].id;
		tree = indentNode(tree, bId);
		tree = outdentNode(tree, bId);
		expect(flattenTree(tree).map((f) => f.number)).toEqual(['1', '2', '3']);
		expect(collectDocPaths(tree)).toEqual(['a.md', 'b.md', 'c.md']);
	});

	test('outdentNode is a no-op at root', () => {
		const tree = buildTreeFromFlatOrder(['a.md']);
		expect(outdentNode(tree, tree[0].id)).toEqual(tree);
	});

	test('renameDocPath patches nested doc nodes without touching id', () => {
		const beat = createDividerNode('Beat');
		const scene = createDocNode('old.md');
		beat.children = [scene];
		const tree: SceneTree = [beat];
		const renamed = renameDocPath(tree, 'old.md', 'new.md');
		expect(collectDocPaths(renamed)).toEqual(['new.md']);
		expect(renamed[0].children[0].id).toBe(scene.id);
	});

	test('removeDocByPath promotes children to where the removed node was', () => {
		const parent = createDocNode('parent.md');
		const child = createDocNode('child.md');
		parent.children = [child];
		const tree: SceneTree = [parent, createDocNode('sibling.md')];
		const next = removeDocByPath(tree, 'parent.md');
		expect(collectDocPaths(next)).toEqual(['child.md', 'sibling.md']);
		expect(flattenTree(next).map((f) => f.depth)).toEqual([0, 0]);
	});

	test('removeDocByPath finds nested targets too', () => {
		const beat = createDividerNode('Beat');
		const scene = createDocNode('deep.md');
		beat.children = [scene];
		const tree: SceneTree = [beat];
		const next = removeDocByPath(tree, 'deep.md');
		expect(collectDocPaths(next)).toEqual([]);
		expect(next[0].children).toEqual([]);
	});

	test('addMissingDocs appends unknown paths alphabetically without disturbing existing tree', () => {
		const tree = buildTreeFromFlatOrder(['b.md']);
		const next = addMissingDocs(tree, ['b.md', 'a.md', 'c.md']);
		expect(collectDocPaths(next)).toEqual(['b.md', 'a.md', 'c.md']);
	});

	test('addMissingDocs is a no-op when nothing is missing', () => {
		const tree = buildTreeFromFlatOrder(['a.md']);
		expect(addMissingDocs(tree, ['a.md'])).toEqual(tree);
	});

	test('resolveSceneTree prefers a stored tree over legacy order', () => {
		const stored = buildTreeFromFlatOrder(['x.md']);
		const result = resolveSceneTree(stored, ['a.md', 'b.md'], ['x.md']);
		expect(collectDocPaths(result)).toEqual(['x.md']);
	});

	test('resolveSceneTree migrates from legacy flat order when no tree is stored', () => {
		const result = resolveSceneTree(undefined, ['a.md', 'b.md'], ['a.md', 'b.md']);
		expect(collectDocPaths(result)).toEqual(['a.md', 'b.md']);
		expect(flattenTree(result).map((f) => f.number)).toEqual(['1', '2']);
	});

	test('resolveSceneTree starts empty and appends unknown docs when nothing exists yet', () => {
		const result = resolveSceneTree(undefined, undefined, ['b.md', 'a.md']);
		expect(collectDocPaths(result)).toEqual(['a.md', 'b.md']);
	});

	test('resolveSceneTree appends new docs onto an existing stored tree', () => {
		const stored = buildTreeFromFlatOrder(['a.md']);
		const result = resolveSceneTree(stored, undefined, ['a.md', 'b.md']);
		expect(collectDocPaths(result)).toEqual(['a.md', 'b.md']);
	});

	test('renameDividerLabel renames the divider without touching its children', () => {
		const beat = createDividerNode('Beat');
		beat.children = [createDocNode('scene.md')];
		const tree: SceneTree = [beat];
		const renamed = renameDividerLabel(tree, beat.id, 'Beat One');
		expect(renamed[0].label).toBe('Beat One');
		expect(collectDocPaths(renamed)).toEqual(['scene.md']);
	});

	test('removeNodePromotingChildren deletes a divider and lifts its children into its place', () => {
		const beat = createDividerNode('Beat');
		const scene = createDocNode('scene.md');
		beat.children = [scene];
		const tree: SceneTree = [beat, createDocNode('after.md')];
		const next = removeNodePromotingChildren(tree, beat.id);
		expect(collectDocPaths(next)).toEqual(['scene.md', 'after.md']);
		expect(flattenTree(next).map((f) => f.depth)).toEqual([0, 0]);
	});

	describe('drag helpers', () => {
		test('getDescendantIds collects the whole subtree, not the node itself', () => {
			const div = createDividerNode('D');
			const child = createDocNode('c.md');
			const grand = createDocNode('g.md');
			child.children = [grand];
			div.children = [child];
			const tree: SceneTree = [div];
			const ids = getDescendantIds(tree, div.id);
			expect(ids.has(child.id)).toBe(true);
			expect(ids.has(grand.id)).toBe(true);
			expect(ids.has(div.id)).toBe(false);
		});

		// Rows a,b,c at root; pointer between b and c (overIndex 2).
		const rows: ProjectionRow[] = [
			{ id: 'a', parentId: null, depth: 0 },
			{ id: 'b', parentId: null, depth: 0 },
			{ id: 'c', parentId: null, depth: 0 },
		];

		test('getProjection: no horizontal drag keeps a node at root', () => {
			expect(getProjection(rows, 2, 0)).toEqual({ depth: 0, parentId: null });
		});

		test('getProjection: dragging right nests under the row above (clamped to +1)', () => {
			expect(getProjection(rows, 2, 5)).toEqual({ depth: 1, parentId: 'b' });
		});

		test('getProjection: cannot go shallower than the row below', () => {
			const nested: ProjectionRow[] = [
				{ id: 'a', parentId: null, depth: 0 },
				{ id: 'b', parentId: 'a', depth: 1 },
				{ id: 'c', parentId: 'a', depth: 1 },
			];
			// Between b and c (both depth 1) — minDepth is 1, so depth 0 is rejected.
			expect(getProjection(nested, 2, 0)).toEqual({ depth: 1, parentId: 'a' });
		});

		test('getProjection: at the very top, depth is forced to 0/root', () => {
			expect(getProjection(rows, 0, 3)).toEqual({ depth: 0, parentId: null });
		});

		test('moveNodeBefore reorders by reference at root', () => {
			let tree = buildTreeFromFlatOrder(['a.md', 'b.md', 'c.md']);
			const [a, b, c] = tree;
			tree = moveNodeBefore(tree, c.id, null, a.id);
			expect(collectDocPaths(tree)).toEqual(['c.md', 'a.md', 'b.md']);
		});

		test('moveNodeBefore appends to a parent when beforeId is null', () => {
			const div = createDividerNode('D');
			const tree: SceneTree = [div, createDocNode('x.md')];
			const xId = tree[1].id;
			const next = moveNodeBefore(tree, xId, div.id, null);
			expect(next[0].children.map((n) => n.docPath)).toEqual(['x.md']);
			expect(collectDocPaths(next)).toEqual(['x.md']);
		});

		test('moveNodeBefore carries the dragged subtree along', () => {
			const div = createDividerNode('D');
			const parent = createDocNode('p.md');
			parent.children = [createDocNode('child.md')];
			const tree: SceneTree = [div, parent];
			const next = moveNodeBefore(tree, parent.id, div.id, null);
			const flat = flattenTree(next);
			expect(flat.map((f) => f.number)).toEqual(['1', '1.1', '1.1.1']);
		});

		test('moveNodeBefore refuses to drop a node into itself', () => {
			const tree = buildTreeFromFlatOrder(['a.md']);
			expect(moveNodeBefore(tree, tree[0].id, tree[0].id, null)).toEqual(tree);
		});
	});
});
