import { App, TFile } from 'obsidian';
import { SetupIndex } from './setup-index';

function note(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split('/').pop() ?? path;
	f.basename = f.name.replace(/\.md$/, '');
	f.extension = 'md';
	return f;
}

const block = (id: string, line: number) => ({ id, position: { start: { line, col: 0, offset: 0 }, end: { line, col: 0, offset: 0 } } });

describe('SetupIndex', () => {
	it("finds a mark that reuses the writer's own block id", () => {
		const scene = note('Book/Scenes/One.md');
		const blocks: Record<string, Record<string, ReturnType<typeof block>>> = {
			'Book/Scenes/One.md': { 'my-id': block('My-Id', 4), 'pv-abc123': block('pv-abc123', 8) },
		};
		const app = {
			vault: { getMarkdownFiles: () => [scene] },
			metadataCache: { getFileCache: (f: TFile) => ({ blocks: blocks[f.path] }) },
		} as unknown as App;
		const index = new SetupIndex(app);
		expect(index.placeOf('My-Id')).toEqual({ path: 'Book/Scenes/One.md', line: 4 });
		expect(index.placeOf('my-id')).toEqual({ path: 'Book/Scenes/One.md', line: 4 });
		expect(index.placeOf('pv-abc123')).toEqual({ path: 'Book/Scenes/One.md', line: 8 });
		expect(index.placeOf('nope')).toBeNull();
	});
});
