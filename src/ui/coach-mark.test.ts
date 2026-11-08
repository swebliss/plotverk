import { COACH_MARK_CLASS, isOnCoachMark } from './coach-mark';

/** A stand-in for a DOM element: `closest` answers only for the selectors it "sits inside". */
const fakeElement = (insideSelectors: string[]) => ({
	closest: (sel: string) => (insideSelectors.includes(sel) ? {} : null),
}) as unknown as EventTarget;

describe('isOnCoachMark', () => {
	it('is true for the mark itself or anything inside it (its Next / Got it buttons)', () => {
		expect(isOnCoachMark(fakeElement([`.${COACH_MARK_CLASS}`]))).toBe(true);
	});

	it('is false for anything else, so a real outside click still closes the panel', () => {
		expect(isOnCoachMark(fakeElement(['.sg-side-panel']))).toBe(false);
		expect(isOnCoachMark(fakeElement([]))).toBe(false);
	});

	it('copes with no target or a target that is not an element', () => {
		expect(isOnCoachMark(null)).toBe(false);
		expect(isOnCoachMark({} as EventTarget)).toBe(false);
	});

	it('uses the same class the marks are built with', () => {
		expect(COACH_MARK_CLASS).toBe('sg-coach-mark');
	});
});
