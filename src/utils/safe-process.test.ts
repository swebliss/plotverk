import { TFile } from 'obsidian';
import type { App } from 'obsidian';
// The test stand-in for Obsidian (same module the 'obsidian' import resolves to in tests).
import { shownNotices } from '../__mocks__/obsidian';
import { processKeepingText } from './safe-process';

function fakeApp(initial: string): { app: App; disk: () => string } {
	let text = initial;
	const app = {
		vault: {
			process: async (_f: TFile, fn: (c: string) => string) => { text = fn(text); return text; },
		},
	} as unknown as App;
	return { app, disk: () => text };
}

const sheet = Object.assign(new TFile(), { path: 'Codex/Characters/Mara.md', basename: 'Mara' });

describe('processKeepingText', () => {
	beforeEach(() => { shownNotices.length = 0; });

	it('writes a normal change exactly as before, with no message', async () => {
		const { app, disk } = fakeApp('# Mara\nOld line');
		expect(await processKeepingText(app, sheet, (c) => c.replace('Old', 'New'))).toBe(false);
		expect(disk()).toBe('# Mara\nNew line');
		expect(shownNotices).toEqual([]);
	});

	it('keeps the text when a change would empty the page, and says so', async () => {
		const { app, disk } = fakeApp('# Mara\nShe keeps the lighthouse.');
		expect(await processKeepingText(app, sheet, () => '')).toBe(true);
		expect(disk()).toBe('# Mara\nShe keeps the lighthouse.');
		expect(shownNotices).toHaveLength(1);
		expect(shownNotices[0]).toContain('Mara');
	});
});
