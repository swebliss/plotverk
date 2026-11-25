import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { getDocPreview } from './doc-preview';

function setup(text: string): { app: App; note: TFile; reads: () => number; write: (t: string, mtime: number) => void } {
	let body = text;
	let count = 0;
	const note = Object.assign(new TFile(), { path: 'Scenes/Harbour.md', basename: 'Harbour', extension: 'md' });
	note.stat = { ctime: 1, mtime: 100, size: body.length };
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (p === note.path ? note : null),
			read: async () => { count++; return body; },
		},
	} as unknown as App;
	return {
		app, note, reads: () => count,
		write: (t, mtime) => { body = t; note.stat = { ...note.stat, mtime, size: t.length }; },
	};
}

describe('getDocPreview', () => {
	it('shows the first lines without the properties block', async () => {
		const { app } = setup('---\ntags: [a]\n---\n\nThe tide came in.\n\nMara waited.\nThird line.');
		expect(await getDocPreview(app, 'Scenes/Harbour.md', 2)).toBe('The tide came in. Mara waited.');
	});

	it('reads an unchanged note only once', async () => {
		const { app, reads } = setup('The tide came in.');
		await getDocPreview(app, 'Scenes/Harbour.md', 2);
		expect(await getDocPreview(app, 'Scenes/Harbour.md', 2)).toBe('The tide came in.');
		expect(reads()).toBe(1);
	});

	it('reads the note again as soon as it changes', async () => {
		const { app, reads, write } = setup('The tide came in.');
		await getDocPreview(app, 'Scenes/Harbour.md', 2);
		write('The tide went out.', 200);
		expect(await getDocPreview(app, 'Scenes/Harbour.md', 2)).toBe('The tide went out.');
		expect(reads()).toBe(2);
	});

	it('reads again when a different number of lines is asked for', async () => {
		const { app, reads } = setup('One.\nTwo.\nThree.');
		expect(await getDocPreview(app, 'Scenes/Harbour.md', 1)).toBe('One.');
		expect(await getDocPreview(app, 'Scenes/Harbour.md', 3)).toBe('One. Two. Three.');
		expect(reads()).toBe(2);
	});
});
