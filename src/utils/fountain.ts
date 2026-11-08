import {
	ManuscriptItem,
	ManuscriptOptions,
	buildTitlePage,
	prepareItems,
} from './compile';

/**
 * Fountain exporter — the industry plain-text screenplay format. A .fountain
 * file opens in Final Draft, Fade In, WriterDuet, Highland, etc. with correct
 * Courier formatting, so we never fake screenplay margins in markdown: the
 * writer authors sluglines/dialogue/action in their scene documents using
 * Fountain conventions, and this module only assembles them in order with the
 * title page, section headers, and (for TV) act markers.
 *
 * Pure module — no Obsidian imports.
 */

export interface FountainOptions extends ManuscriptOptions {
	/** Insert "> END OF <section> <" after each top-level section (TV teleplays). */
	actMarkers?: boolean;
}

/** Fountain centres text with "> … <" — used for END OF ACT markers. */
function centered(text: string): string {
	return `> ${text} <`;
}

/**
 * Assemble a Fountain screenplay from ordered manuscript items. Top-level
 * dividers become `#` sections (their labels are act names like "TEASER" /
 * "ACT ONE" for teleplays); nested dividers step down to `##`/`###`. Scene
 * text passes through after the scene-stage steps run.
 */
export function assembleFountain(name: string, items: ManuscriptItem[], opts: FountainOptions): string {
	const prepared = prepareItems(items, opts.steps ?? []);

	const lines: string[] = [];
	if ((opts.titlePage ?? 'fountain') === 'fountain') {
		lines.push(buildTitlePage('fountain', name, { author: opts.author, contact: opts.contact, credit: opts.credit }, 0));
	}

	let topLabel: string | null = null;
	let topHadContent = false;

	const closeAct = () => {
		if (opts.actMarkers && topLabel && topHadContent) {
			lines.push('', centered(`END OF ${topLabel.toUpperCase()}`), '');
		}
	};

	for (const item of prepared) {
		if (item.kind === 'heading') {
			if (item.depth === 0) {
				closeAct();
				topLabel = item.label.trim() || null;
				topHadContent = false;
				if (opts.includeHeadings && item.label.trim()) lines.push('', `# ${item.label.trim()}`, '');
			} else if (opts.includeHeadings && item.label.trim()) {
				lines.push('', `${'#'.repeat(Math.min(item.depth + 1, 6))} ${item.label.trim()}`, '');
			}
		} else {
			lines.push('', item.text, '');
			topHadContent = true;
		}
	}
	closeAct();

	if (opts.endMark?.trim()) lines.push('', centered(opts.endMark.trim().toUpperCase()), '');

	// Collapse blank-line runs so the title page and sections stay tidy.
	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
