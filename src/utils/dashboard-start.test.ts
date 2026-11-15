import { emptyStateStart, startWritingTarget } from './dashboard-start';
import { en } from '../i18n/locales/en';
import { es } from '../i18n/locales/es';
import { fr } from '../i18n/locales/fr';

describe('emptyStateStart', () => {
	it('opens the grid setup when the Plot Grid is on', () => {
		expect(emptyStateStart(true)).toEqual({ descKey: 'dashboard.empty.desc', labelKey: 'dashboard.empty.cta', action: 'openGrid' });
	});

	it('starts a new story directly when the Plot Grid is off, with the same words', () => {
		expect(emptyStateStart(false)).toEqual({ descKey: 'dashboard.empty.desc', labelKey: 'dashboard.empty.cta', action: 'newStory' });
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

	it('the text never mentions a plot grid, so it fits with the Plot Grid on or off', () => {
		expect(en['dashboard.empty.desc']).toBe('Start a Plotverk project first to let the Dashboard help you with your progress.');
		expect(en['dashboard.empty.cta']).toBe('New project');
		expect(en['dashboard.empty.desc']).not.toMatch(/grid/i);
		expect(es['dashboard.empty.desc']).not.toMatch(/cuadrícula/i);
		expect(fr['dashboard.empty.desc']).not.toMatch(/grille/i);
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
