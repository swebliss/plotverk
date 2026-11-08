import type { SceneTree } from './scene-tree';

/**
 * Pure builder for the "Book order" note — a readable shadow copy of the
 * Writers Panel outline, written into the project's safety folder so the
 * chapter and scene order survives a lost or conflicted settings file.
 * Nothing reads it back yet: settings stay the source of truth.
 *
 * Dividers become headings, scene documents become list lines (nested scenes
 * indented). Scene names are plain text on purpose: a wikilink would make this
 * note count as a mention of every scene in Obsidian's backlinks and in
 * Plotverk's own reference index.
 */
export function buildBookOrderNote(tree: SceneTree, intro: string): string | null {
	const lines: string[] = [];
	let docCount = 0;

	const walk = (nodes: SceneTree, headingLevel: number, indent: number) => {
		for (const node of nodes) {
			if (node.kind === 'divider') {
				if (lines.length && lines[lines.length - 1] !== '') lines.push('');
				lines.push(`${'#'.repeat(Math.min(headingLevel, 6))} ${node.label?.trim() || '—'}`);
				lines.push('');
				walk(node.children, headingLevel + 1, 0);
			} else {
				docCount++;
				lines.push(`${'  '.repeat(indent)}- ${sceneName(node.docPath ?? '')}`);
				walk(node.children, headingLevel, indent + 1);
			}
		}
	};
	walk(tree, 2, 0);

	if (docCount === 0) return null;
	while (lines[lines.length - 1] === '') lines.pop();
	return `${intro}\n\n${lines.join('\n')}\n`;
}

function sceneName(docPath: string): string {
	const file = docPath.split('/').pop() ?? docPath;
	return file.replace(/\.md$/i, '') || docPath;
}
