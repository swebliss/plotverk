import { App, Modal } from 'obsidian';
import { t } from '../i18n';
import { normalizeWebUrl, WebLink } from '../utils/web-links';

/**
 * Add a web page to a Plot Grid card: the address, and an optional name.
 * A wrong address shows a hint under the field and keeps the window open,
 * so nothing the writer typed is lost.
 */
export class WebLinkModal extends Modal {
	constructor(app: App, private readonly onAdd: (link: WebLink) => void) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('storygrid-modal');
		const { contentEl } = this;
		contentEl.addClass('sg-prompt-modal', 'sg-web-link-modal');
		contentEl.createEl('h3', { text: t('grid.webLink.title') });

		const urlLabel = contentEl.createEl('label', { cls: 'sg-web-link-field' });
		urlLabel.createSpan({ cls: 'sg-web-link-field-label', text: t('grid.webLink.address') });
		const urlInput = urlLabel.createEl('input', {
			cls: 'sg-modal-input',
			type: 'url',
			attr: { placeholder: 'https://', inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' },
		});
		const error = contentEl.createDiv({ cls: 'sg-web-link-error', attr: { role: 'alert' } });

		const nameLabel = contentEl.createEl('label', { cls: 'sg-web-link-field' });
		nameLabel.createSpan({ cls: 'sg-web-link-field-label', text: t('grid.webLink.name') });
		const nameInput = nameLabel.createEl('input', {
			cls: 'sg-modal-input',
			type: 'text',
			attr: { placeholder: t('grid.webLink.namePlaceholder') },
		});

		const actions = contentEl.createDiv({ cls: 'sg-modal-actions' });
		const addBtn = actions.createEl('button', { cls: 'sg-modal-btn sg-modal-btn-primary', text: t('grid.webLink.add') });
		const cancelBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: t('common.cancel') });

		const submit = () => {
			const url = normalizeWebUrl(urlInput.value);
			if (!url) {
				error.setText(t('grid.webLink.invalid'));
				urlInput.focus();
				return;
			}
			const label = nameInput.value.trim();
			this.close();
			this.onAdd(label ? { url, label } : { url });
		};

		addBtn.addEventListener('click', submit);
		cancelBtn.addEventListener('click', () => this.close());
		urlInput.addEventListener('input', () => error.setText(''));
		for (const input of [urlInput, nameInput]) {
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { e.preventDefault(); submit(); }
			});
		}
		urlInput.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
