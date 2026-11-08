import { App, SuggestModal, TFile } from 'obsidian';
import { isSafetyNetPath } from '../utils/safety-paths';

/**
 * A modal for searching and selecting any .md or .canvas file in the vault
 * to link to a scene card.
 */
export class LinkDocModal extends SuggestModal<TFile> {
	private onSelect: (file: TFile) => void;

	constructor(app: App, onSelect: (file: TFile) => void) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder('Search for a document or canvas to link…');
	}

	getSuggestions(query: string): TFile[] {
		const lower = query.toLowerCase();
		return this.app.vault
			.getFiles()
			.filter(
				(f) =>
					(f.extension === 'md' || f.extension === 'canvas') &&
					!isSafetyNetPath(f.path) &&
					(query === '' || f.path.toLowerCase().includes(lower))
			)
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		const icon = file.extension === 'canvas' ? '🖼 ' : '📄 ';
		el.createDiv({ cls: 'sg-link-modal-name', text: icon + file.basename });
		el.createDiv({ cls: 'sg-link-modal-path', text: file.path });
	}

	onChooseSuggestion(file: TFile): void {
		this.onSelect(file);
	}
}
