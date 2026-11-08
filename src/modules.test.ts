import { migrateEnabledModules, moduleDefault, isModuleEnabled, writersPanelTabsFor } from './modules';

describe('module defaults matrix (Phase 4-T T3)', () => {
	it('timeline defaults on for journalist', () => {
		expect(moduleDefault('timeline', 'journalist', null)).toBe(true);
	});

	it('writersPanel defaults on for worldbuilder', () => {
		expect(moduleDefault('writersPanel', 'worldbuilder', null)).toBe(true);
	});

	it('timeline still defaults off for a novelist Pantser, via PANTSER_OFF', () => {
		expect(moduleDefault('timeline', 'novelist', 'pantser')).toBe(false);
	});

	it('isModuleEnabled follows the same journalist/worldbuilder defaults with no explicit override', () => {
		expect(isModuleEnabled(undefined, 'timeline', 'journalist')).toBe(true);
		expect(isModuleEnabled(undefined, 'writersPanel', 'worldbuilder')).toBe(true);
		expect(isModuleEnabled(undefined, 'timeline', 'novelist', 'pantser')).toBe(false);
	});
});

describe('quick-link module mapping (timeline joins connectionsMap/socialMaps)', () => {
	// The `timeline` QuickLinkKey (grid-data.ts) maps to the `timeline` ModuleId
	// the same way `connectionsMap` maps to `socialMaps` — quickLinkOn() in
	// main.ts falls back to isModuleEnabled() for that mapped module when there
	// is no explicit per-link override. These cases pin the pure default that
	// fallback reads, for both quick-link mappings side by side.
	it('the timeline module (backing the timeline quick-link) is on by default for journalist', () => {
		expect(isModuleEnabled(undefined, 'timeline', 'journalist')).toBe(true);
	});

	it('the socialMaps module (backing the connectionsMap quick-link) is off by default for journalist', () => {
		expect(isModuleEnabled(undefined, 'socialMaps', 'journalist')).toBe(false);
	});

	it('an explicit override still wins for the timeline module, same as any other quick-link module', () => {
		expect(isModuleEnabled({ timeline: false }, 'timeline', 'journalist')).toBe(false);
		expect(isModuleEnabled({ timeline: true }, 'timeline', 'novelist', 'pantser')).toBe(true);
	});
});

describe('migrateEnabledModules', () => {
	it('passes through undefined', () => {
		expect(migrateEnabledModules(undefined)).toBeUndefined();
	});

	it('leaves a record with no legacy keys untouched', () => {
		const record = { codex: true };
		expect(migrateEnabledModules(record)).toBe(record);
	});

	it('leaves a record that already has socialMaps untouched', () => {
		const record = { socialMaps: false, connectionsMap: true };
		expect(migrateEnabledModules(record)).toBe(record);
	});

	it('derives socialMaps=true when connectionsMap is true', () => {
		const result = migrateEnabledModules({ connectionsMap: true });
		expect(result).toEqual({ connectionsMap: true, socialMaps: true });
	});

	it('derives socialMaps=true when storyTree is true', () => {
		const result = migrateEnabledModules({ storyTree: true });
		expect(result).toEqual({ storyTree: true, socialMaps: true });
	});

	it('enabled wins when the two legacy keys disagree', () => {
		const result = migrateEnabledModules({ connectionsMap: false, storyTree: true });
		expect(result).toEqual({ connectionsMap: false, storyTree: true, socialMaps: true });
	});

	it('derives socialMaps=false when both legacy keys are explicitly false', () => {
		const result = migrateEnabledModules({ connectionsMap: false, storyTree: false });
		expect(result).toEqual({ connectionsMap: false, storyTree: false, socialMaps: false });
	});

	it('never deletes the old keys', () => {
		const result = migrateEnabledModules({ connectionsMap: true, storyTree: false });
		expect(result).toHaveProperty('connectionsMap', true);
		expect(result).toHaveProperty('storyTree', false);
	});
});

describe('Creator Grid View mode', () => {
	it('starts with only the Plot Grid, the Codex and the Writers Panel on', () => {
		const on = (id: Parameters<typeof isModuleEnabled>[1]) => isModuleEnabled(undefined, id, 'creator', null);
		expect(on('plotGrid')).toBe(true);
		expect(on('codex')).toBe(true);
		expect(on('writersPanel')).toBe(true);
		for (const id of ['tasks', 'socialMaps', 'timeline', 'history'] as const) expect(on(id)).toBe(false);
	});
	it('a switch in settings still wins over the mode', () => {
		expect(isModuleEnabled({ timeline: true }, 'timeline', 'creator', null)).toBe(true);
	});
	it('Writers Panel shows only Codex + Progress; other modes keep every tab', () => {
		expect(writersPanelTabsFor('creator')).toEqual(['world', 'dashboard']);
		expect(writersPanelTabsFor('novelist')).toEqual(['writing', 'world', 'coach', 'dashboard']);
		expect(writersPanelTabsFor(null)).toEqual(['writing', 'world', 'coach', 'dashboard']);
		expect(writersPanelTabsFor('journalist')).toEqual(['writing', 'world', 'coach', 'dashboard']);
		expect(writersPanelTabsFor('everything')).toEqual(['writing', 'world', 'coach', 'dashboard']);
		expect(writersPanelTabsFor('scriptwriter')).toEqual(['writing', 'world', 'dashboard']);
		expect(writersPanelTabsFor('worldbuilder')).toEqual(['world', 'dashboard']);
	});
	it('a tab switch in settings wins over the mode, in display order', () => {
		expect(writersPanelTabsFor('creator', { writing: true })).toEqual(['writing', 'world', 'dashboard']);
		expect(writersPanelTabsFor('creator', { writing: true, coach: true })).toEqual(['writing', 'world', 'coach', 'dashboard']);
		expect(writersPanelTabsFor('novelist', { coach: false })).toEqual(['writing', 'world', 'dashboard']);
	});
	it('Progress stays when every tab is switched off, so the panel is never empty', () => {
		expect(writersPanelTabsFor('novelist', { writing: false, world: false, coach: false, dashboard: false })).toEqual(['dashboard']);
	});
});
