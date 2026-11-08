import { App, Modal, Setting } from 'obsidian';
import { STORY_TEMPLATES } from '../templates/story-templates';
import { StorygridTemplate } from '../grid-data';
import { FolderSuggest } from './folder-suggest';
// Imported as `i18n`, not `t`: renderStep3's map callback binds `t` to a template.
import { t as i18n } from '../i18n';

/**
 * 3-step wizard modal for creating a new plot grid.
 * Step 1: Name the story
 * Step 2: Choose folder
 * Step 3: Select storytelling template (built-in + custom)
 */
export class NewGridModal extends Modal {
	private step: 1 | 2 | 3 = 1;
	private startStep: 1 | 2 | 3 = 1;
	private name: string = '';
	private folder: string = '';
	private templateId: string = 'default-storygrid';
	private onComplete: (name: string, folder: string, templateId: string) => void;
	private customTemplates: StorygridTemplate[];

	constructor(
		app: App,
		defaultFolder: string,
		onComplete: (name: string, folder: string, templateId: string) => void,
		customTemplates: StorygridTemplate[] = [],
		startStep: 1 | 2 | 3 = 1,
		defaultName: string = ''
	) {
		super(app);
		this.folder = defaultFolder;
		this.onComplete = onComplete;
		this.customTemplates = customTemplates;
		this.step = startStep;
		this.startStep = startStep;
		this.name = defaultName;
	}

	onOpen(): void {
		this.modalEl.addClass('sg-new-grid-modal');
		switch (this.step) {
			case 1:
				this.renderStep1();
				break;
			case 2:
				this.renderStep2();
				break;
			case 3:
				this.renderStep3();
				break;
		}
	}

	private renderStep1(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Create a new plot grid' });
		contentEl.createEl('p', { text: 'Step 1 of 3: Name your story' });

		new Setting(contentEl)
			.setName('Story or novel name')
			.addText((text) =>
				text
					.setPlaceholder('e.g., The Lost Kingdom')
					.setValue(this.name || 'Untitled Story')
					.onChange((v) => { this.name = v; })
			);

		this.renderNavButtons(contentEl, false, true, () => {
			if (!this.name.trim()) {
				this.name = 'Untitled Story';
			}
			this.step = 2;
			this.onOpen();
		});
	}

	private renderStep2(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Create a new plot grid' });
		contentEl.createEl('p', { text: 'Step 2 of 3: Choose a folder (optional)' });

		const storyName = this.name || 'My Story';

		const updatePreview = (folderPath: string) => {
			const root = folderPath.trim() ? `${folderPath.trim()}/${storyName}` : storyName;
			previewEl.setText(`📁 ${root} / ${storyName}.storygrid · Scenes · Codex`);
		};

		const setting = new Setting(contentEl)
			.setName('Folder path')
			.setDesc('Leave blank to use vault root. Start typing to search existing folders.');

		// Replace the default text component with a raw input so we can bind FolderSuggest
		setting.controlEl.empty();
		const input = setting.controlEl.createEl('input', {
			cls: 'sg-wizard-folder-input',
			type: 'text',
			placeholder: 'vault root',
		});
		input.value = this.folder;
		input.addEventListener('input', () => {
			this.folder = input.value.trim();
			updatePreview(this.folder);
		});

		// Bind folder autocomplete
		new FolderSuggest(this.app, input, (folder) => {
			this.folder = folder.path;
			input.value = folder.path;
			updatePreview(this.folder);
		});

		// Structure preview
		const previewEl = contentEl.createDiv({ cls: 'sg-wizard-preview' });
		updatePreview(this.folder);

		// Word-count rule hint
		contentEl.createDiv({
			cls: 'sg-wizard-hint',
			text: '💡 Words you type in the Scenes folder count toward your writing goals.',
		});

		this.renderNavButtons(contentEl, true, true, () => {
			this.step = 3;
			this.onOpen();
		});
	}

	private renderStep3(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: i18n('wizard.templateStep.title') });
		contentEl.createEl('p', { cls: 'sg-template-step-desc', text: i18n('wizard.templateStep.desc') });

		const templates: StorygridTemplate[] = [
			...STORY_TEMPLATES,
			...this.customTemplates.map((t) => ({ ...t, description: t.description || i18n('wizard.customTemplate') })),
		];
		const templateContainer = contentEl.createDiv({ cls: 'sg-template-picker' });

		templates.forEach((template) => {
			const card = templateContainer.createEl('button', { cls: 'sg-template-card', attr: { type: 'button' } });
			card.classList.toggle('sg-template-card--selected', template.id === this.templateId);

			card.createDiv({ cls: 'sg-template-card-title', text: template.name });
			card.createDiv({ cls: 'sg-template-card-desc', text: template.description });

			card.addEventListener('click', () => {
				templateContainer.querySelectorAll('.sg-template-card').forEach((c) => c.classList.remove('sg-template-card--selected'));
				card.classList.add('sg-template-card--selected');
				this.templateId = template.id;
			});
		});

		this.renderNavButtons(contentEl, this.step !== this.startStep, true, () => {
			this.onComplete(this.name, this.folder, this.templateId);
			this.close();
		}, i18n('wizard.create'));
	}

	private renderNavButtons(
		container: HTMLElement,
		showBack: boolean,
		showNext: boolean,
		onNext: () => void,
		nextLabel: string = 'Next'
	): void {
		const actions = container.createDiv({ cls: 'sg-modal-actions' });

		if (showBack) {
			const backBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: 'Back' });
			backBtn.addEventListener('click', () => {
				this.step = (this.step - 1) as 1 | 2 | 3;
				this.onOpen();
			});
		}

		if (showNext) {
			const nextBtn = actions.createEl('button', { cls: 'sg-modal-btn sg-modal-btn-primary', text: nextLabel });
			nextBtn.addEventListener('click', onNext);
		}
	}
}
