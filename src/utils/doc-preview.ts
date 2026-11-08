import { App, TFile } from 'obsidian';

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

	try {
		const raw = await app.vault.read(file);
		const body = stripFrontmatter(raw).trim();

		if (!body) {
			return '';
		}

		const nonEmptyLines = body
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l.length > 0)
			.slice(0, lineCount);

		return nonEmptyLines.join(' ');
	} catch {
		return '';
	}
}
