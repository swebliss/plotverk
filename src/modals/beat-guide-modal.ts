import { App, Modal } from 'obsidian';
import { t } from '../i18n';
import type { BeatGuide } from '../templates/beat-guide';

/**
 * Explains a template grid in plain words: what beats are, how to read the grid
 * (top row = beginning of the book, bottom row = the end), and every beat in order.
 * Opened from the template name under the grid title, and once for a brand-new grid.
 */
export class BeatGuideModal extends Modal {
	constructor(app: App, private guide: BeatGuide, private onDone?: () => void) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('storygrid-modal', 'sg-beat-guide-modal');
		const { contentEl } = this;
		this.titleEl.setText(this.guide.name || t('grid.guide.header'));

		const body = contentEl.createDiv({ cls: 'sg-beat-guide-body' });

		body.createEl('h3', { cls: 'sg-beat-guide-heading', text: t('grid.beatGuide.whatTitle') });
		body.createEl('p', { text: t('grid.beatGuide.whatText', { count: this.guide.beats.length }) });

		body.createEl('h3', { cls: 'sg-beat-guide-heading', text: t('grid.beatGuide.howTitle') });
		const how = body.createEl('ul', { cls: 'sg-beat-guide-how' });
		for (const key of ['howTopBottom', 'howRows', 'howGuideColumn', 'howThreads', 'howEditable']) {
			how.createEl('li', { text: t(`grid.beatGuide.${key}`) });
		}

		body.createEl('h3', { cls: 'sg-beat-guide-heading', text: t('grid.beatGuide.listTitle') });
		const list = body.createEl('ol', { cls: 'sg-beat-guide-list' });
		for (const beat of this.guide.beats) {
			const li = list.createEl('li', { cls: 'sg-beat-guide-beat' });
			li.createSpan({ cls: 'sg-beat-guide-where', text: beat.where });
			li.createSpan({ cls: 'sg-beat-guide-label', text: beat.label });
		}

		const actions = contentEl.createDiv({ cls: 'sg-modal-actions sg-beat-guide-actions' });
		const okBtn = actions.createEl('button', { cls: 'sg-modal-btn sg-modal-btn-primary', text: t('common.ok') });
		okBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
		const done = this.onDone;
		this.onDone = undefined;
		done?.();
	}
}
