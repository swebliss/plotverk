import { App, TFile } from 'obsidian';
import { ReferenceIndex } from './reference-index';
import type { EntityIndex } from '../entities/entity-index-store';

function note(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split('/').pop() ?? path;
	f.basename = f.name.replace(/\.md$/, '');
	f.extension = 'md';
	return f;
}

describe('ReferenceIndex — setups are not names', () => {
	const mara = note('Book/Codex/Characters/Mara.md');
	const setup = note('Book/Codex/Setups/She was really just tired.md');
	const entities = [
		{ file: mara, kind: 'character', name: 'Mara', entityId: 'id-mara' },
		{ file: setup, kind: 'setup', name: 'She was really just tired', entityId: 'id-setup' },
	];
	const fm: Record<string, Record<string, unknown>> = {
		[mara.path]: { 'storygrid-type': 'character', 'storygrid-id': 'id-mara' },
		[setup.path]: { 'storygrid-type': 'setup', 'storygrid-id': 'id-setup' },
	};
	const app = {
		metadataCache: { resolvedLinks: {}, getFileCache: (f: TFile) => ({ frontmatter: fm[f.path] }) },
	} as unknown as App;
	const entityIndex = { getAllEntities: () => entities } as unknown as EntityIndex;

	it('never offers a setup sheet for mention matching (scan, @ picker suggestions)', () => {
		const index = new ReferenceIndex(app, entityIndex);
		index.rebuild();
		const ids = () => index.buildMatchableEntities().map((m) => m.entityId);
		expect(ids()).toEqual(['id-mara']);
		expect(index.buildMatchableEntitiesFor('Book/Scenes/One.md').map((m) => m.entityId)).toEqual(['id-mara']);
		// Editing the setup sheet does not bring it back.
		index.handleChange(setup);
		expect(ids()).toEqual(['id-mara']);
		// Its links are still known (a setup is still a Codex entry).
		expect(index.getEntityIdForPath(setup.path)).toBe('id-setup');
	});
});
