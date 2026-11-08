import { buildBookOrderNote } from './book-order-note';
import type { SceneTree, SceneTreeNode } from './scene-tree';

const doc = (path: string, children: SceneTreeNode[] = []): SceneTreeNode => ({ id: path, kind: 'doc', docPath: path, children });
const divider = (label: string, children: SceneTreeNode[] = []): SceneTreeNode => ({ id: label, kind: 'divider', label, children });

describe('buildBookOrderNote', () => {
	it('writes the intro, dividers as headings and scenes as plain-name list lines', () => {
		const tree: SceneTree = [
			divider('Act 1', [doc('S/Scenes/Opening.md'), doc('S/Scenes/Storm.md')]),
			divider('Act 2', [doc('S/Scenes/Act 2/Siege.md')]),
		];
		expect(buildBookOrderNote(tree, 'Kept in sync.')).toBe(
			'Kept in sync.\n\n## Act 1\n\n- Opening\n- Storm\n\n## Act 2\n\n- Siege\n'
		);
	});

	it('indents nested scenes and deepens nested dividers', () => {
		const tree: SceneTree = [
			divider('Part One', [divider('Chapter 1', [doc('Scenes/A.md', [doc('Scenes/A1.md')])])]),
		];
		expect(buildBookOrderNote(tree, 'i')).toBe('i\n\n## Part One\n\n### Chapter 1\n\n- A\n  - A1\n');
	});

	it('never writes wikilinks (they would count as mentions of every scene)', () => {
		expect(buildBookOrderNote([doc('Scenes/Opening.md')], 'i')).not.toContain('[[');
	});

	it('returns null when there are no scenes, so no empty note is written', () => {
		expect(buildBookOrderNote([], 'i')).toBeNull();
		expect(buildBookOrderNote([divider('Act 1')], 'i')).toBeNull();
	});

	it('keeps scenes that sit before any divider', () => {
		expect(buildBookOrderNote([doc('Scenes/Prologue.md'), divider('Act 1', [doc('Scenes/One.md')])], 'i')).toBe(
			'i\n\n- Prologue\n\n## Act 1\n\n- One\n'
		);
	});
});
