import { liveViews, loadedView, leafStateString } from './live-views';

class FakeDashboard {
	refreshed = 0;
	refreshSprintPanel(): void { this.refreshed++; }
}

/** What Obsidian 1.7+ puts in `leaf.view` for a tab not shown since startup. */
const deferredPlaceholder = { getViewType: () => 'storygrid-dashboard-view', getState: () => ({}) };

describe('liveViews', () => {
	test('skips a deferred tab instead of calling a method it does not have', () => {
		const loaded = new FakeDashboard();
		const workspace = {
			getLeavesOfType: (type: string) => (type === 'storygrid-dashboard-view'
				? [{ view: deferredPlaceholder }, { view: loaded }]
				: []),
		};
		// The old loop — `(leaf.view as Dashboard).refreshSprintPanel()` — threw here,
		// which aborted startSprint before the sprint began (no notice, no timer).
		expect(() => {
			for (const v of liveViews(workspace, 'storygrid-dashboard-view', FakeDashboard)) v.refreshSprintPanel();
		}).not.toThrow();
		expect(loaded.refreshed).toBe(1);
	});

	test('no tabs of that type → nothing', () => {
		expect(liveViews({ getLeavesOfType: () => [] }, 'x', FakeDashboard)).toEqual([]);
	});
});

describe('loadedView', () => {
	test('loads a deferred tab first, then returns the real view', async () => {
		const real = new FakeDashboard();
		const leaf: { view: unknown; loadIfDeferred: () => Promise<void> } = {
			view: deferredPlaceholder,
			loadIfDeferred: async () => { leaf.view = real; },
		};
		expect(await loadedView(leaf, FakeDashboard)).toBe(real);
	});

	test('a leaf holding some other view → null, never a wrong cast', async () => {
		expect(await loadedView({ view: deferredPlaceholder }, FakeDashboard)).toBeNull();
		expect(await loadedView(undefined, FakeDashboard)).toBeNull();
	});
});

describe('leafStateString', () => {
	test('reads the saved state, which a deferred tab still has', () => {
		const leaf = { getViewState: () => ({ type: 'x', state: { filePath: 'A/B.storygrid', n: 3 } }) };
		expect(leafStateString(leaf, 'filePath')).toBe('A/B.storygrid');
		expect(leafStateString(leaf, 'n')).toBeNull();
		expect(leafStateString({ getViewState: () => ({}) }, 'filePath')).toBeNull();
	});
});
