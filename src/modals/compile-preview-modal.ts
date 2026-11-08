import { App, Modal, Component, MarkdownRenderer } from 'obsidian';
import { ManuscriptItem, ManuscriptOptions, assembleManuscript, countWords } from '../utils/compile';

/**
 * Full-size preview of the assembled manuscript before compiling. A section
 * rail on the left (built from the rendered headings) jumps the preview to
 * any section or scene; the footer offers the real compile and export.
 * For non-markdown outputs (fountain / docx) this previews the assembled
 * markdown that feeds the exporter — the structure, not the final typography.
 */
export class CompilePreviewModal extends Modal {
	private renderComponent = new Component();

	constructor(
		app: App,
		private gridName: string,
		private items: ManuscriptItem[],
		private opts: ManuscriptOptions,
		private onCompile: () => void,
		private compileLabel = 'Compile to file'
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('storygrid-modal', 'sg-preview-modal');
		const { contentEl } = this;
		contentEl.addClass('sg-preview-root');

		const md = assembleManuscript(this.gridName, this.items, this.opts);
		const words = countWords(md);
		const sceneCount = this.items.filter((i) => i.kind === 'scene').length;

		// ── Header ───────────────────────────────────────────────────────────
		const header = contentEl.createDiv({ cls: 'sg-preview-header' });
		header.createEl('h2', { text: 'Manuscript preview' });
		header.createSpan({
			cls: 'sg-preview-meta',
			text: `${sceneCount} scene${sceneCount === 1 ? '' : 's'} · ${words.toLocaleString()} words`,
		});

		// ── Body: section rail + rendered preview ────────────────────────────
		const body = contentEl.createDiv({ cls: 'sg-preview-body' });
		const rail = body.createDiv({ cls: 'sg-preview-rail' });
		const pane = body.createDiv({ cls: 'sg-preview-pane' });
		const prose = pane.createDiv({ cls: 'sg-preview-prose markdown-rendered' });

		this.renderComponent.load();
		void MarkdownRenderer.render(this.app, md, prose, '', this.renderComponent).then(() => {
			const headings = Array.from(prose.querySelectorAll<HTMLElement>('h1, h2, h3'));
			if (headings.length === 0) {
				rail.createDiv({ cls: 'sg-preview-rail-empty', text: 'No sections — this format compiles as continuous text.' });
				return;
			}
			for (const h of headings) {
				const level = Number(h.tagName.slice(1));
				const item = rail.createDiv({ cls: `sg-preview-rail-item sg-preview-rail-item--h${level}` });
				item.setText(h.textContent ?? '');
				item.setAttribute('role', 'button');
				item.setAttribute('tabindex', '0');
				const jump = () => {
					h.scrollIntoView({ behavior: 'smooth', block: 'start' });
					rail.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
					item.addClass('is-active');
				};
				item.addEventListener('click', jump);
				item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); } });
			}
		});

		// ── Footer ───────────────────────────────────────────────────────────
		const actions = contentEl.createDiv({ cls: 'sg-modal-actions sg-preview-actions' });
		const compileBtn = actions.createEl('button', { cls: 'sg-modal-btn sg-modal-btn-primary', text: this.compileLabel });
		const closeBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: 'Close' });

		compileBtn.addEventListener('click', () => { this.close(); this.onCompile(); });
		closeBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.renderComponent.unload();
		this.contentEl.empty();
	}
}
