import { App, Modal } from 'obsidian';
import { t } from '../i18n';

/**
 * Mobile-safe replacements for window.prompt / window.confirm, which are
 * no-ops in Obsidian on iOS and Android.
 */

export class TextPromptModal extends Modal {
	private title: string;
	private initialValue: string;
	private onSubmit: (value: string) => void;

	constructor(app: App, title: string, initialValue: string, onSubmit: (value: string) => void) {
		super(app);
		this.title = title;
		this.initialValue = initialValue;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.modalEl.addClass('storygrid-modal');
		const { contentEl } = this;
		contentEl.addClass('sg-prompt-modal');
		contentEl.createEl('h3', { text: this.title });

		const input = contentEl.createEl('input', {
			cls: 'sg-modal-input',
			type: 'text',
			attr: { 'aria-label': this.title },
		});
		input.value = this.initialValue;

		const actions = contentEl.createDiv({ cls: 'sg-modal-actions' });
		const okBtn = actions.createEl('button', { cls: 'sg-modal-btn sg-modal-btn-primary', text: 'OK' });
		const cancelBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: 'Cancel' });

		const submit = () => {
			const value = input.value.trim();
			this.close();
			if (value) this.onSubmit(value);
		};

		okBtn.addEventListener('click', submit);
		cancelBtn.addEventListener('click', () => this.close());
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); submit(); }
		});

		input.focus();
		input.select();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ConfirmModal extends Modal {
	private message: string;
	private confirmLabel: string;
	private onConfirm: () => void;
	/** An optional second, milder choice shown between confirm and Cancel. */
	private alternative?: { label: string; onChoose: () => void };
	/** An optional "Don't ask me again" tick box. Its callback runs only when the user ticks it AND confirms —
	 *  ticking it and then pressing Cancel changes nothing. */
	private dontAsk?: { label: string; onConfirmDontAsk: () => void };

	constructor(
		app: App, message: string, confirmLabel: string, onConfirm: () => void,
		alternative?: { label: string; onChoose: () => void },
		dontAsk?: { label: string; onConfirmDontAsk: () => void },
	) {
		super(app);
		this.message = message;
		this.confirmLabel = confirmLabel;
		this.onConfirm = onConfirm;
		this.alternative = alternative;
		this.dontAsk = dontAsk;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('sg-prompt-modal');
		contentEl.createEl('p', { text: this.message });

		let dontAskBox: HTMLInputElement | null = null;
		if (this.dontAsk) {
			const row = contentEl.createEl('label', { cls: 'sg-modal-dontask' });
			dontAskBox = row.createEl('input', { type: 'checkbox' });
			row.createSpan({ text: this.dontAsk.label });
		}

		const actions = contentEl.createDiv({ cls: 'sg-modal-actions' });
		const okBtn = actions.createEl('button', { cls: 'sg-modal-btn sg-modal-btn-danger', text: this.confirmLabel });
		const alt = this.alternative;
		if (alt) {
			const altBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: alt.label });
			altBtn.addEventListener('click', () => { this.close(); alt.onChoose(); });
		}
		const cancelBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: t('common.cancel') });

		okBtn.addEventListener('click', () => {
			const skipNextTime = dontAskBox?.checked === true;
			this.close();
			if (skipNextTime) this.dontAsk?.onConfirmDontAsk();
			this.onConfirm();
		});
		cancelBtn.addEventListener('click', () => this.close());
		cancelBtn.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
