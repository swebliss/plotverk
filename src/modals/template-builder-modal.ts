import { App, Modal } from 'obsidian';
import { CharacterFieldTemplate, generateId } from '../grid-data';
import { renderFieldCreatorCard } from '../ui/field-creator';
import { setPhosphorIcon } from '../utils/icons';
import { t } from '../i18n';

type TemplateField = CharacterFieldTemplate['fields'][number];
type TemplateCategory = NonNullable<CharacterFieldTemplate['categories']>[number];

/**
 * Settings → Codex "New template" / "Edit" modal — build a full reusable
 * field template: name, an ordered group (category) list, and fields per
 * group using the same field-creator card the sheet editor's "+ Add field"
 * uses. Saves a CharacterFieldTemplate; the caller persists it into the
 * kind's settings array.
 */
export class TemplateBuilderModal extends Modal {
	private name: string;
	private fields: TemplateField[];
	private categories: TemplateCategory[];
	private readonly existingId: string | null;
	private creatorOpen = false;

	constructor(
		app: App,
		private kindLabel: string,
		existing: CharacterFieldTemplate | null,
		private onSave: (template: CharacterFieldTemplate) => void,
	) {
		super(app);
		this.existingId = existing?.id ?? null;
		this.name = existing?.name ?? t('settings.codex.templateBuilder.defaultName', { kind: kindLabel });
		this.fields = existing ? existing.fields.map((f) => ({ ...f })) : [];
		this.categories = existing?.categories ? existing.categories.map((c) => ({ ...c })) : [];
	}

	onOpen(): void {
		this.modalEl.addClass('storygrid-modal', 'sg-tplb-host');
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sg-tplb');

		contentEl.createEl('h2', {
			text: this.existingId
				? t('settings.codex.templateBuilder.editTitle', { kind: this.kindLabel })
				: t('settings.codex.templateBuilder.newTitle', { kind: this.kindLabel }),
		});

		const nameInput = contentEl.createEl('input', { cls: 'sg-sheet-field-input sg-tplb-name', type: 'text' });
		nameInput.placeholder = t('settings.codex.templateBuilder.namePlaceholder');
		nameInput.value = this.name;
		nameInput.addEventListener('input', () => { this.name = nameInput.value; });

		this.renderCategories(contentEl);
		this.renderFields(contentEl);
		this.renderFooter(contentEl);
	}

	// ─── Groups (categories) ────────────────────────────────────────────────────

	private renderCategories(parent: HTMLElement): void {
		const sec = parent.createDiv({ cls: 'sg-tplb-cats' });
		sec.createDiv({ cls: 'sg-fc-title', text: t('settings.codex.templateBuilder.groups') });

		this.categories.forEach((cat, i) => {
			const row = sec.createDiv({ cls: 'sg-tplb-row' });
			const input = row.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
			input.value = cat.title;
			input.addEventListener('change', () => {
				const oldTitle = cat.title;
				const newTitle = input.value.trim() || oldTitle;
				cat.title = newTitle;
				for (const f of this.fields) if (f.category === oldTitle) f.category = newTitle;
			});
			this.renderReorderButtons(row, this.categories, i, () => this.render());
			this.renderDeleteButton(row, () => {
				this.categories = this.categories.filter((c) => c !== cat);
				for (const f of this.fields) if (f.category === cat.title) f.category = undefined;
				this.render();
			});
		});

		const addBtn = sec.createEl('button', {
			cls: 'sg-sheet-btn sg-sheet-btn--ghost sg-sheet-btn--small',
			text: t('settings.codex.templateBuilder.addGroup'),
		});
		addBtn.addEventListener('click', () => {
			this.categories.push({ title: t('settings.codex.templateBuilder.newGroupName', { n: this.categories.length + 1 }) });
			this.render();
		});
	}

	// ─── Fields ──────────────────────────────────────────────────────────────────

	private renderFields(parent: HTMLElement): void {
		const sec = parent.createDiv({ cls: 'sg-tplb-fields' });
		sec.createDiv({ cls: 'sg-fc-title', text: t('settings.codex.templateBuilder.fields') });

		if (this.fields.length === 0 && !this.creatorOpen) {
			sec.createEl('p', { cls: 'sg-settings-desc', text: t('settings.codex.templateBuilder.noFields') });
		}

		this.fields.forEach((field, i) => {
			const row = sec.createDiv({ cls: 'sg-tplb-row' });
			row.createSpan({ cls: 'sg-tplb-field-label', text: field.label });
			row.createSpan({ cls: 'sg-tplb-field-type', text: field.type });
			if (field.category) row.createSpan({ cls: 'sg-tplb-field-cat', text: field.category });
			this.renderReorderButtons(row, this.fields, i, () => this.render());
			this.renderDeleteButton(row, () => {
				this.fields.splice(i, 1);
				this.render();
			});
		});

		if (this.creatorOpen) {
			renderFieldCreatorCard(sec, {
				categories: this.categories.map((c) => c.title),
				onSubmit: (result) => {
					this.fields.push({
						label: result.label, type: result.type, prompt: result.prompt,
						config: result.config, category: result.category,
					});
					this.creatorOpen = false;
					this.render();
				},
				onCancel: () => { this.creatorOpen = false; this.render(); },
			});
		} else {
			const addFieldBtn = sec.createEl('button', { cls: 'sg-sheet-btn sg-sheet-btn--ghost', text: '+ ' + t('settings.codex.templateBuilder.addField') });
			addFieldBtn.addEventListener('click', () => { this.creatorOpen = true; this.render(); });
		}
	}

	// ─── Shared row controls ─────────────────────────────────────────────────────

	private renderReorderButtons<T>(row: HTMLElement, list: T[], index: number, onReorder: () => void): void {
		const upBtn = row.createEl('button', { cls: 'sg-sheet-btn sg-sheet-btn--small', text: '↑' });
		upBtn.disabled = index === 0;
		upBtn.addEventListener('click', () => {
			if (index === 0) return;
			[list[index - 1], list[index]] = [list[index], list[index - 1]];
			onReorder();
		});
		const downBtn = row.createEl('button', { cls: 'sg-sheet-btn sg-sheet-btn--small', text: '↓' });
		downBtn.disabled = index === list.length - 1;
		downBtn.addEventListener('click', () => {
			if (index === list.length - 1) return;
			[list[index + 1], list[index]] = [list[index], list[index + 1]];
			onReorder();
		});
	}

	private renderDeleteButton(row: HTMLElement, onDelete: () => void): void {
		const del = row.createEl('button', {
			cls: 'sg-sheet-field-del sg-tplb-del',
			attr: { type: 'button', 'aria-label': 'Delete field' },
		});
		setPhosphorIcon(del, 'trash', '◆');
		del.addEventListener('click', onDelete);
	}

	// ─── Footer ──────────────────────────────────────────────────────────────────

	private renderFooter(parent: HTMLElement): void {
		const footer = parent.createDiv({ cls: 'sg-tplb-footer' });
		const cancelBtn = footer.createEl('button', { cls: 'sg-sheet-btn', text: t('settings.codex.templateBuilder.cancel') });
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = footer.createEl('button', { cls: 'sg-sheet-btn sg-sheet-btn--primary', text: t('settings.codex.templateBuilder.save') });
		saveBtn.addEventListener('click', () => {
			if (!this.name.trim() || this.fields.length === 0) return;
			this.onSave({
				id: this.existingId ?? generateId(),
				name: this.name.trim(),
				fields: this.fields,
				categories: this.categories.length > 0 ? this.categories : undefined,
			});
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
