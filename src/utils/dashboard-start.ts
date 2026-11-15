/**
 * Where the Dashboard's "get started" buttons lead. The usual target is the
 * Plot Grid, but a writer can switch that module off — then the grid command
 * refuses to run and the buttons would do nothing, so they lead elsewhere.
 * Pure (no Obsidian imports) so it can be unit-tested.
 */

/** The no-story-yet screen: the i18n key of the text above the button, the button's label key, and what clicking it does. */
export interface EmptyStateStart {
	descKey: 'dashboard.empty.desc' | 'dashboard.empty.descNoGrid';
	labelKey: 'dashboard.empty.cta' | 'dashboard.empty.ctaNoGrid';
	/** 'openGrid' = the open-grid command (picker, or setup when no grid exists); 'newStory' = story setup directly. */
	action: 'openGrid' | 'newStory';
}

export function emptyStateStart(plotGridOn: boolean): EmptyStateStart {
	return plotGridOn
		? { descKey: 'dashboard.empty.desc', labelKey: 'dashboard.empty.cta', action: 'openGrid' }
		: { descKey: 'dashboard.empty.descNoGrid', labelKey: 'dashboard.empty.ctaNoGrid', action: 'newStory' };
}

/** The "Start Writing — create your first scene" card: open the grid, or the Writers Panel's new-scene box. */
export function startWritingTarget(plotGridOn: boolean): 'openGrid' | 'writersPanelNewScene' {
	return plotGridOn ? 'openGrid' : 'writersPanelNewScene';
}
