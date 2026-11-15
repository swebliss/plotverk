import { emptyStateStart, startWritingTarget } from './dashboard-start';
import { en } from '../i18n/locales/en';
import { es } from '../i18n/locales/es';
import { fr } from '../i18n/locales/fr';

describe('emptyStateStart', () => {
	it('keeps today’s text and button when the Plot Grid is on', () => {
		expect(emptyStateStart(true)).toEqual({ descKey: 'dashboard.empty.desc', labelKey: 'dashboard.empty.cta', action: 'openGrid' });
	});

	it('starts a new story, and says so, when the Plot Grid is off', () => {
		expect(emptyStateStart(false)).toEqual({ descKey: 'dashboard.empty.descNoGrid', labelKey: 'dashboard.empty.ctaNoGrid', action: 'newStory' });
	});

	it('every text and label it can pick exists in English, Spanish and French', () => {
		for (const on of [true, false]) {
			const { descKey, labelKey } = emptyStateStart(on);
			for (const dict of [en, es, fr]) {
				expect(dict[descKey]).toBeTruthy();
				expect(dict[labelKey]).toBeTruthy();
			}
		}
	});

	it('with the Plot Grid off, the text never mentions a plot grid', () => {
		expect(en['dashboard.empty.descNoGrid']).toBe('Start a story first. The Dashboard tracks your progress for each story.');
		expect(en['dashboard.empty.descNoGrid']).not.toMatch(/grid/i);
		expect(es['dashboard.empty.descNoGrid']).not.toMatch(/cuadrícula/i);
		expect(fr['dashboard.empty.descNoGrid']).not.toMatch(/grille/i);
	});
});

describe('startWritingTarget', () => {
	it('opens the grid when the Plot Grid is on', () => {
		expect(startWritingTarget(true)).toBe('openGrid');
	});

	it('opens the Writers Panel’s new-scene box when the Plot Grid is off', () => {
		expect(startWritingTarget(false)).toBe('writersPanelNewScene');
	});
});
