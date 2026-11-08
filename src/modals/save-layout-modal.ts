import { Modal, App, Setting } from 'obsidian';
import type { StorygridTemplate, GridRow, GridColumn } from '../grid-data';
import { generateId } from '../grid-data';

export class SaveLayoutModal extends Modal {
	private templateName: string = '';
	private templateDescription: string = '';
	private rows: Omit<GridRow, 'id' | 'order'>[];
	private columns: Omit<GridColumn, 'id' | 'order'>[];
	private onSave: (template: StorygridTemplate) => void;

	constructor(
		app: App,
		rows: Omit<GridRow, 'id' | 'order'>[],
		columns: Omit<GridColumn, 'id' | 'order'>[],
		onSave: (template: StorygridTemplate) => void
	) {
		super(app);
		this.rows = rows;
		this.columns = columns;
		this.onSave = onSave;
	}

	onOpen(): void {
		this.modalEl.addClass('storygrid-modal');
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Save grid layout as template' });

		new Setting(contentEl)
			.setName('Template name')
			.addText((text) =>
				text
					.setPlaceholder('e.g. My Story Structure')
					.onChange((value) => { this.templateName = value; })
			);

		new Setting(contentEl)
			.setName('Description')
			.addText((text) =>
				text
					.setPlaceholder('Optional: what is this template for?')
					.onChange((value) => { this.templateDescription = value; })
			);

		contentEl.createEl('p', {
			text: `This will save ${this.rows.length} row${this.rows.length !== 1 ? 's' : ''} and ${this.columns.length} column${this.columns.length !== 1 ? 's' : ''}.`,
			cls: 'sg-settings-desc',
		});

		const actions = contentEl.createDiv({ cls: 'sg-modal-actions' });
		const saveBtn = actions.createEl('button', { cls: 'sg-modal-btn sg-modal-btn-primary', text: 'Save' });
		const cancelBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: 'Cancel' });

		saveBtn.addEventListener('click', () => {
			const name = this.templateName.trim() || 'Custom Layout';
			const desc = this.templateDescription.trim() || `Custom template with ${this.rows.length} rows and ${this.columns.length} columns`;
			this.onSave({
				id: generateId(),
				name,
				description: desc,
				rows: this.rows,
				columns: this.columns,
			});
			this.close();
		});

		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
