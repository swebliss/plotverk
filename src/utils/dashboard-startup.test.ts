import { shouldAskDashboardStartup } from './dashboard-startup';

describe('shouldAskDashboardStartup', () => {
	it('asks a writer who has never answered and has the setting off', () => {
		expect(shouldAskDashboardStartup({})).toBe(true);
		expect(shouldAskDashboardStartup({ openDashboardOnStartup: false })).toBe(true);
		expect(shouldAskDashboardStartup({ openDashboardOnStartup: false, dashboardStartupAsked: false })).toBe(true);
	});

	it('does not ask when the Dashboard already opens on startup', () => {
		expect(shouldAskDashboardStartup({ openDashboardOnStartup: true })).toBe(false);
		expect(shouldAskDashboardStartup({ openDashboardOnStartup: true, dashboardStartupAsked: false })).toBe(false);
	});

	it('does not ask again once the writer has answered', () => {
		expect(shouldAskDashboardStartup({ dashboardStartupAsked: true })).toBe(false);
		expect(shouldAskDashboardStartup({ openDashboardOnStartup: false, dashboardStartupAsked: true })).toBe(false);
	});
});
