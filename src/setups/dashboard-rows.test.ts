import { dashboardSetups, DashSetupIn } from './dashboard-rows';
import { SetupState } from './setup-marks';

const s = (name: string, state: SetupState, last: number | null, extra: Partial<DashSetupIn> = {}): DashSetupIn => ({
	name,
	state,
	later: false,
	summary: { stageChapter: last, plantedChapter: last, lastChapter: last, previousStage: null, writtenYet: last !== null, nextPlan: null },
	...extra,
});

describe('dashboardSetups', () => {
	it('counts paid off out of this book\'s open + paid; later-book and let-go are not counted', () => {
		const d = dashboardSetups([
			s('A', 'planted', 3),
			s('B', 'reminded', 5),
			s('C', 'paid-off', 9),
			s('D', 'planted', 2, { later: true }),
			s('E', 'let-go', 1),
		], 12);
		expect(d.paid).toBe(1);
		expect(d.total).toBe(3);
		expect(d.letGo).toBe(1);
	});

	it('orders open (quietest first), then later-book, then paid off (latest first)', () => {
		const d = dashboardSetups([
			s('Paid early', 'paid-off', 4),
			s('Recent', 'reminded', 10),
			s('Later', 'planted', 1, { later: true }),
			s('Old', 'planted', 2),
			s('Paid late', 'paid-off', 11),
			s('Nowhere', 'planted', null),
		], 12);
		expect(d.rows.map((r) => r.setup.name)).toEqual(['Old', 'Recent', 'Nowhere', 'Later', 'Paid late', 'Paid early']);
		expect(d.rows[0].fact).toEqual({ kind: 'quiet', chapters: 10 });
		expect(d.rows[2].fact).toEqual({ kind: 'stage' });
		expect(d.rows[3].fact).toEqual({ kind: 'later' });
		expect(d.rows[4].fact).toEqual({ kind: 'paid', chapter: 11 });
	});

	it('nudges only at 10 or more quiet chapters, and never for a later book', () => {
		expect(dashboardSetups([s('A', 'planted', 3)], 12).nudge).toBeNull();
		expect(dashboardSetups([s('A', 'planted', 2)], 12).nudge?.setup.name).toBe('A');
		expect(dashboardSetups([s('A', 'planted', 1, { later: true })], 30).nudge).toBeNull();
	});

	it('without a current chapter nothing is quiet', () => {
		const d = dashboardSetups([s('A', 'planted', 1)], null);
		expect(d.nudge).toBeNull();
		expect(d.rows[0].fact).toEqual({ kind: 'stage' });
	});
});
