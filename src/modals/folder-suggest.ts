import { AbstractInputSuggest, App, TFolder } from 'obsidian';

/**
 * Inline folder autocomplete for text inputs.
 * Extends Obsidian's AbstractInputSuggest so suggestions appear beneath
 * the bound <input> using the native Obsidian popover — no custom DOM or
 * z-index wrestling needed.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	// Named onPick to avoid clashing with AbstractInputSuggest's own onSelect method.
	private onPick: (folder: TFolder) => void;

	constructor(app: App, inputEl: HTMLInputElement, onPick: (folder: TFolder) => void) {
		super(app, inputEl);
		this.onPick = onPick;
	}

	getSuggestions(query: string): TFolder[] {
		const lower = query.toLowerCase();
		return this.app.vault
			.getAllFolders(false)
			.filter((f) => !lower || f.path.toLowerCase().includes(lower))
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.createSpan({ text: folder.path || '/' });
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.onPick(folder);
		this.close();
	}
}
