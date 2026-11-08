import { resetFirstTimeTips } from './first-time-tips';
import { DEFAULT_SETTINGS } from '../default-settings';
import { mergeSettings } from './settings-merge';
import { StorygridSettings } from '../grid-data';

describe('resetFirstTimeTips', () => {
	const used = (): StorygridSettings => {
		const s = mergeSettings(DEFAULT_SETTINGS, {}) as StorygridSettings;
		s.hasSeenWelcome = true;
		s.coachMarksSeen = { 'story-tree': true };
		s.milestonesSeen = { 'first-card': true, 'first-sheet': true };
		s.dismissedIntros = { codex: true, 'sidebar-writing': true };
		s.taskOnboarding = false;
		s.intent = 'novel' as StorygridSettings['intent'];
		s.writingStyle = 'plotter' as StorygridSettings['writingStyle'];
		s.enabledModules = { timeline: false } as StorygridSettings['enabledModules'];
		s.authorName = 'Emma';
		s.taskDefaultSort = 'manual';
		return s;
	};

	test('every "already seen" flag is back to first-run', () => {
		const s = used();
		resetFirstTimeTips(s);
		expect([s.hasSeenWelcome, s.coachMarksSeen, s.milestonesSeen, s.dismissedIntros, s.taskOnboarding])
			.toEqual([false, {}, {}, {}, true]);
	});

	test('real choices stay exactly as they were', () => {
		const s = used();
		const before = JSON.parse(JSON.stringify(s));
		resetFirstTimeTips(s);
		for (const k of ['hasSeenWelcome', 'coachMarksSeen', 'milestonesSeen', 'dismissedIntros', 'taskOnboarding']) {
			delete before[k];
			delete (s as unknown as Record<string, unknown>)[k];
		}
		expect(s).toEqual(before);
	});
});
