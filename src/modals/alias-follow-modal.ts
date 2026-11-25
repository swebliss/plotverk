import { App, Modal } from 'obsidian';
import { t } from '../i18n';

/**
 * "Change "Dad" to "Papa" in 14 places in 6 notes?" — asked after an alias was
 * renamed on a Codex sheet. Change them / Leave the text; closing the window
 * (Esc, ×, a click outside) leaves the text as it is.
 */
export class AliasFollowModal extends Modal {
	private chose = false;

	constructor(
		app: App,
		private readonly message: string,
		private readonly detail: string,
		private readonly onChange: () => void,
		/** Runs once the window is gone, whatever was chosen. */
		private readonly onClosed?: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('sg-prompt-modal', 'sg-alias-follow');
		contentEl.createEl('p', { cls: 'sg-alias-follow-question', text: this.message });
		contentEl.createEl('p', { cls: 'sg-alias-follow-detail', text: this.detail });
		const actions = contentEl.createDiv({ cls: 'sg-modal-actions' });
		const change = actions.createEl('button', { cls: 'sg-modal-btn sg-modal-btn-primary mod-cta', text: t('aliasFollow.change') });
		const leave = actions.createEl('button', { cls: 'sg-modal-btn', text: t('aliasFollow.leave') });
		change.addEventListener('click', () => {
			if (this.chose) return;
			this.chose = true;
			this.close();
			this.onChange();
		});
		leave.addEventListener('click', () => this.close());
		// The safe choice has the focus: an Enter meant for something else never rewrites text.
		leave.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		this.onClosed?.();
	}
}
