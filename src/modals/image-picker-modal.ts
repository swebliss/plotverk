import { App, SuggestModal, TFile } from 'obsidian';

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'];

/** Fuzzy picker for any image already in the vault. Shared by the compile cover-image picker and the sheet-editor image field widget. */
export class ImagePickerModal extends SuggestModal<TFile> {
	constructor(app: App, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder('Search for an image…');
	}

	getSuggestions(query: string): TFile[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getFiles()
			.filter((f) => IMAGE_EXTS.includes(f.extension.toLowerCase()))
			.filter((f) => !q || f.path.toLowerCase().includes(q))
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, 50);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createDiv({ text: file.basename });
		el.createEl('small', { text: file.path });
	}

	onChooseSuggestion(file: TFile): void {
		this.onPick(file);
	}
}
