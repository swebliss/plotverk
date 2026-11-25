import { App, TFile } from 'obsidian';
import { stripAnchors } from '../setups/anchors';

/**
 * Strip YAML frontmatter from a markdown string.
 * Frontmatter is any block enclosed between opening and closing "---" lines
 * at the very beginning of the file.
 */
export function stripFrontmatter(content: string): string {
	const lines = content.split('\n');
	if (lines[0].trim() !== '---') {
		return content;
	}
	let closingIndex = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === '---') {
			closingIndex = i;
			break;
		}
	}
	if (closingIndex === -1) {
		return content;
	}
	return lines.slice(closingIndex + 1).join('\n');
}

/**
 * Previews already read, per note. A note is read again as soon as it changes
 * (its modified time or size differs), so a preview is never older than the note.
 * Keyed by the file object itself: a rename keeps it, a new note never sees an old entry.
 */
const previewCache = new WeakMap<TFile, { mtime: number; size: number; lineCount: number; preview: string }>();

/**
 * Read a vault document and return the first N non-empty lines of body text,
 * with frontmatter (Obsidian properties) stripped.
 *
 * For .canvas files (which are JSON internally), returns a placeholder
 * because canvas content cannot be meaningfully previewed as text.
 */
export async function getDocPreview(
	app: App,
	filePath: string,
	lineCount: number
): Promise<string> {
	const file = app.vault.getAbstractFileByPath(filePath);

	if (!(file instanceof TFile)) {
		return '';
	}

	if (file.extension === 'canvas') {
		return `[Canvas: ${file.basename}]`;
	}

	const { mtime, size } = file.stat;
	const hit = previewCache.get(file);
	if (hit && hit.mtime === mtime && hit.size === size && hit.lineCount === lineCount) return hit.preview;

	try {
		const raw = await app.vault.read(file);
		const preview = previewFromText(raw, lineCount);
		previewCache.set(file, { mtime, size, lineCount, preview });
		return preview;
	} catch {
		return '';
	}
}

/** The first `lineCount` non-empty body lines of a note's text, joined by spaces. */
function previewFromText(raw: string, lineCount: number): string {
	const body = stripAnchors(stripFrontmatter(raw)).trim();
	if (!body) return '';
	return body
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.slice(0, lineCount)
		.join(' ');
}
