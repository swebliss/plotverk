import { App, Modal } from 'obsidian';
import type StorygridPlugin from '../main';
import { t } from '../i18n';

/**
 * Creator Grid View talks about projects, not novels and books. Each key listed here has a
 * `wizard.creator.<same rest>` twin that is used instead when the writer picked that mode.
 */
const CREATOR_WIZARD_KEYS = new Set(['wizard.step1.question', 'wizard.series.label', 'wizard.series.desc', 'wizard.novel.label', 'wizard.novel.desc', 'wizard.novelStep.title', 'wizard.novelName.label', 'wizard.novelName.placeholder', 'wizard.seriesStep.title', 'wizard.seriesName.label', 'wizard.seriesName.placeholder', 'wizard.books.desc', 'wizard.book.label', 'wizard.book.firstPlaceholder', 'wizard.book.placeholder', 'wizard.book.removeAria', 'wizard.addBook', 'wizard.notice.seriesCreated.one', 'wizard.notice.seriesCreated.other']);

export function wizardText(intent: string | null | undefined, key: string, vars?: Record<string, string | number>): string {
	if (intent === 'creator' && CREATOR_WIZARD_KEYS.has(key)) return t(key.replace('wizard.', 'wizard.creator.'), vars);
	return t(key, vars);
}

/** What the writer is setting up. */
export type ProjectKind = 'series' | 'standalone';

/** Collected by the wizard, handed to main.ts to register + build grids. */
export type ProjectSetupResult =
	| { kind: 'standalone'; novelName: string }
	| { kind: 'series'; seriesName: string; bookNames: string[] };

/**
 * Project-type wizard shown when creating a new project.
 * Step 1: Series or standalone novel?
 * Step 2a (standalone): name the novel.
 * Step 2b (series): name the series + one-or-more books (+ to add more).
 * The template picker (NewGridModal step 3) runs afterwards in main.ts.
 */
export class GridScopeModal extends Modal {
	private plugin: StorygridPlugin;
	private onComplete: (result: ProjectSetupResult) => void;

	private step: 1 | 2 = 1;
	private kind: ProjectKind | null = null;

	// Standalone
	private novelName: string = '';

	// Series
	private seriesName: string = '';
	private bookNames: string[] = [''];

	// Author — prefilled from settings, saved back on continue. Used for title
	// pages/EPUB today; future AI features greet the writer by name.
	private author: string = '';

	constructor(app: App, plugin: StorygridPlugin, onComplete: (result: ProjectSetupResult) => void) {
		super(app);
		this.plugin = plugin;
		this.onComplete = onComplete;
		this.author = plugin.settings.authorName ?? '';
	}

	/** "Written by" field, shared by both step-2 variants. */
	private renderAuthorRow(contentEl: HTMLElement): void {
		const row = contentEl.createDiv({ cls: 'sg-scope-modal-book-row' });
		row.createEl('label', { cls: 'sg-scope-modal-book-label', text: t('wizard.author.label') });
		const input = row.createEl('input', {
			cls: 'sg-scope-modal-input',
			type: 'text',
			placeholder: t('wizard.author.placeholder'),
		});
		input.value = this.author;
		input.addEventListener('input', () => { this.author = input.value; });
	}

	private async saveAuthor(): Promise<void> {
		const name = this.author.trim();
		if (name && name !== this.plugin.settings.authorName) {
			this.plugin.settings.authorName = name;
			await this.plugin.saveSettings();
		}
	}

	onOpen(): void {
		this.render();
	}

	/** Wording for this wizard: project words in Creator Grid View, novel/book words otherwise. */
	private w(key: string, vars?: Record<string, string | number>): string {
		return wizardText(this.plugin.settings.intent, key, vars);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sg-scope-modal');
		if (this.step === 1) this.renderTypeStep();
		else if (this.kind === 'standalone') this.renderNovelStep();
		else this.renderSeriesStep();
	}

	// ── Step 1: series vs standalone ──────────────────────────────────────────
	private renderTypeStep(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: t('wizard.step1.title') });
		contentEl.createEl('p', {
			cls: 'sg-scope-modal-desc',
			text: this.w('wizard.step1.question'),
		});

		const opts = contentEl.createDiv({ cls: 'sg-scope-modal-opts' });

		const mkOpt = (kind: ProjectKind, label: string, desc: string) => {
			const btn = opts.createEl('button', { cls: 'sg-scope-modal-opt' });
			btn.createEl('strong', { text: label });
			btn.createEl('span', { text: desc });
			btn.addEventListener('click', () => {
				this.kind = kind;
				this.step = 2;
				this.render();
			});
		};

		mkOpt('series', this.w('wizard.series.label'), this.w('wizard.series.desc'));
		mkOpt('standalone', this.w('wizard.novel.label'), this.w('wizard.novel.desc'));

		const actions = contentEl.createDiv({ cls: 'sg-modal-actions' });
		const cancelBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: t('common.cancel') });
		cancelBtn.addEventListener('click', () => this.close());
	}

	// ── Step 2a: standalone novel name ────────────────────────────────────────
	private renderNovelStep(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.w('wizard.novelStep.title') });

		const row = contentEl.createDiv({ cls: 'sg-scope-modal-book-row' });
		row.createEl('label', { cls: 'sg-scope-modal-book-label', text: this.w('wizard.novelName.label') });
		const input = row.createEl('input', {
			cls: 'sg-scope-modal-input',
			type: 'text',
			placeholder: this.w('wizard.novelName.placeholder'),
		});
		input.value = this.novelName;
		input.addEventListener('input', () => { this.novelName = input.value; });
		setTimeout(() => input.focus(), 50);

		this.renderAuthorRow(contentEl);

		this.renderNav(contentEl, () => {
			if (!this.novelName.trim()) { input.addClass('sg-series-mgr-err'); return; }
			void this.saveAuthor();
			this.close();
			this.onComplete({ kind: 'standalone', novelName: this.novelName.trim() });
		});
	}

	// ── Step 2b: series name + books ──────────────────────────────────────────
	private renderSeriesStep(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.w('wizard.seriesStep.title') });

		const seriesRow = contentEl.createDiv({ cls: 'sg-scope-modal-book-row' });
		seriesRow.createEl('label', { cls: 'sg-scope-modal-book-label', text: this.w('wizard.seriesName.label') });
		const seriesInput = seriesRow.createEl('input', {
			cls: 'sg-scope-modal-input',
			type: 'text',
			placeholder: this.w('wizard.seriesName.placeholder'),
		});
		seriesInput.value = this.seriesName;
		seriesInput.addEventListener('input', () => { this.seriesName = seriesInput.value; });

		contentEl.createEl('p', {
			cls: 'sg-scope-modal-desc',
			text: this.w('wizard.books.desc'),
		});

		const list = contentEl.createDiv({ cls: 'sg-scope-modal-books' });
		this.bookNames.forEach((bookName, i) => {
			const bookRow = list.createDiv({ cls: 'sg-scope-modal-book-row' });
			bookRow.createEl('label', { cls: 'sg-scope-modal-book-label', text: this.w('wizard.book.label', { n: i + 1 }) });
			const bookInput = bookRow.createEl('input', {
				cls: 'sg-scope-modal-input',
				type: 'text',
				placeholder: i === 0 ? this.w('wizard.book.firstPlaceholder') : this.w('wizard.book.placeholder'),
			});
			bookInput.value = bookName;
			bookInput.addEventListener('input', () => { this.bookNames[i] = bookInput.value; });

			// Remove button (only when more than one book)
			if (this.bookNames.length > 1) {
				const del = bookRow.createEl('button', { cls: 'sg-scope-modal-book-del', text: '✕' });
				del.setAttribute('aria-label', this.w('wizard.book.removeAria', { n: i + 1 }));
				del.addEventListener('click', () => {
					this.bookNames.splice(i, 1);
					this.render();
				});
			}
		});

		const addBtn = contentEl.createEl('button', { cls: 'sg-scope-modal-addbook', text: this.w('wizard.addBook') });
		addBtn.addEventListener('click', () => {
			this.bookNames.push('');
			this.render();
		});

		this.renderAuthorRow(contentEl);

		this.renderNav(contentEl, () => {
			if (!this.seriesName.trim()) { seriesInput.addClass('sg-series-mgr-err'); return; }
			void this.saveAuthor();
			const books = this.bookNames.map((b) => b.trim()).filter((b) => b.length > 0);
			if (books.length === 0) {
				const firstInput = list.querySelector('input');
				firstInput?.addClass('sg-series-mgr-err');
				return;
			}
			this.close();
			this.onComplete({ kind: 'series', seriesName: this.seriesName.trim(), bookNames: books });
		});
	}

	private renderNav(container: HTMLElement, onNext: () => void): void {
		const actions = container.createDiv({ cls: 'sg-modal-actions' });
		const backBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: t('wizard.back') });
		backBtn.addEventListener('click', () => { this.step = 1; this.render(); });
		const nextBtn = actions.createEl('button', { cls: 'sg-modal-btn sg-modal-btn-primary', text: t('wizard.chooseTemplate') });
		nextBtn.addEventListener('click', onNext);
	}
}
