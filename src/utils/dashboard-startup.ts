/**
 * Story setup asks once whether the Dashboard should open when Obsidian starts.
 * Pure (no Obsidian imports) so it can be unit-tested.
 */

export interface DashboardStartupFlags {
	openDashboardOnStartup?: boolean;
	dashboardStartupAsked?: boolean;
}

/** Ask only when the Dashboard isn't already set to open, and the writer hasn't answered before. */
export function shouldAskDashboardStartup(settings: DashboardStartupFlags): boolean {
	return settings.openDashboardOnStartup !== true && settings.dashboardStartupAsked !== true;
}
