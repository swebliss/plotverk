import { resolvePhosphorIcon, TIMELINE_ICON } from './icons';
import { MODULES } from '../modules';

describe('module icons resolve (no ◆ fallback on the Welcome page / settings cards)', () => {
	it.each(MODULES.map((m) => [m.id, m.icon]))('%s → %s', (_id, icon) => {
		expect(resolvePhosphorIcon(icon)).toContain('<svg');
	});
	it('the Timeline icon is the dot on a line', () => {
		expect(TIMELINE_ICON).toBe('git-commit');
		expect(resolvePhosphorIcon('sg-git-commit')).toBe(resolvePhosphorIcon('git-commit'));
	});
});
