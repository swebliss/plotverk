import { t } from '../i18n';
import { isBookPosition, type BeatGuide } from '../templates/beat-guide';
import { setPhosphorIcon } from '../utils/icons';
import { bindInfoTrigger } from './info-popover';

/**
 * New beat-guide words ("Start of your book", "End of your book", "of the way through
 * your book") are drafts Emma has not approved yet (2026-11-26). Off until she does;
 * flip to true to show them.
 */
export const SHOW_DRAFT_BEAT_WORDS = false;

/**
 * The beat guide's explanations, as small info boxes in the Plot Grid (they replace the
 * old beat guide window). Every sentence of that window lives on here, word for word:
 * - the general box (the beat guide column's "i", and the template line under the grid title):
 *   top-to-bottom reading first, then "What are beats?", "How to read this grid" and "The beats";
 * - a guide card's own box: where the beat falls, its name and the card's own words.
 */

/** Fills the general box. `name` = the template's name (or the guide column's name). */
export function fillBeatGuideBox(box: HTMLElement, guide: BeatGuide, name: string): void {
	box.createDiv({ cls: 'sg-info-pop-eyebrow', text: name || t('grid.guide.header') });

	// First line: how to read the grid, top (start of the book) to bottom (the end).
	const lead = box.createDiv({ cls: 'sg-info-pop-lead' });
	setPhosphorIcon(lead.createSpan({ cls: 'sg-info-pop-lead-icon' }), 'caret-down', '↓');
	lead.createSpan({ text: t('grid.beatGuide.howTopBottom') });

	box.createDiv({ cls: 'sg-info-pop-heading', text: t('grid.beatGuide.whatTitle') });
	box.createEl('p', { cls: 'sg-info-pop-text', text: t('grid.beatGuide.whatText', { count: guide.beats.length }) });

	box.createDiv({ cls: 'sg-info-pop-heading', text: t('grid.beatGuide.howTitle') });
	const how = box.createEl('ul', { cls: 'sg-info-pop-list' });
	for (const key of ['howRows', 'howGuideColumn', 'howThreads', 'howEditable']) {
		how.createEl('li', { text: t(`grid.beatGuide.${key}`) });
	}

	box.createDiv({ cls: 'sg-info-pop-heading', text: t('grid.beatGuide.listTitle') });
	const list = box.createEl('ol', { cls: 'sg-info-pop-beats' });
	for (const beat of guide.beats) {
		const li = list.createEl('li');
		if (beat.where) li.createSpan({ cls: 'sg-info-pop-beat-where', text: beat.where });
		li.createSpan({ text: beat.label });
	}
}

/** Fills one guide card's box: "~10% of the way through your book", the beat's name, the card's words. */
export function fillBeatBox(box: HTMLElement, where: string, name: string, words: string): void {
	const w = where.trim();
	if (w) {
		const row = box.createDiv({ cls: 'sg-info-pop-where' });
		row.createSpan({ cls: 'sg-info-pop-chip', text: w });
		if (SHOW_DRAFT_BEAT_WORDS && isBookPosition(w)) row.createSpan({ text: t('grid.beatGuide.ofTheWay') });
	}
	if (name.trim()) box.createDiv({ cls: 'sg-info-pop-title', text: name });
	if (words.trim()) box.createEl('p', { cls: 'sg-info-pop-text sg-info-pop-words', text: words });
}

/** A small "i" button inside `parent` that opens a box. */
export function createInfoButton(
	parent: HTMLElement,
	cls: string,
	ariaLabel: string,
	build: (box: HTMLElement) => void,
	wide = false,
): HTMLButtonElement {
	const btn = parent.createEl('button', { cls: `sg-info-btn ${cls}`, attr: { type: 'button', 'aria-label': ariaLabel } });
	setPhosphorIcon(btn.createSpan({ cls: 'sg-info-btn-icon' }), 'info', 'ⓘ');
	bindInfoTrigger(btn, { build, label: () => ariaLabel, wide });
	return btn;
}
