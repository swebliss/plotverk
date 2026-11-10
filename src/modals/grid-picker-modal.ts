import { App, SuggestModal, TFile, Notice } from 'obsidian';
import { setPhosphorIcon } from '../utils/icons';
import { ConfirmModal } from './prompt-modal';
import { runSafely } from '../utils/report-error';

type GridPickerItem = TFile | 'new';

/**
 * Search and open an existing .storygrid file, or create a new one.
 * "Create new grid" is always the first item in the list.
 * Each file suggestion has a 🗑 delete button.
 */
export class GridPickerModal extends SuggestModal<GridPickerItem> {
	private onSelect: (file: TFile) => void;
	private onCreateNew?: () => void;

	constructor(app: App, onSelect: (file: TFile) => void, onCreateNew?: () => void) {
		super(app);
		this.onSelect = onSelect;
		this.onCreateNew = onCreateNew;
		this.setPlaceholder('Search for a plot grid…');
	}

	getSuggestions(query: string): GridPickerItem[] {
		const lower = query.toLowerCase();
		const files: GridPickerItem[] = this.app.vault
			.getFiles()
			.filter(
				(f) =>
					f.extension === 'storygrid' &&
					(query === '' || f.path.toLowerCase().includes(lower))
			)
			.sort((a, b) => b.stat.mtime - a.stat.mtime);

		// "Create new grid" always appears first
		return ['new', ...files];
	}

	renderSuggestion(item: GridPickerItem, el: HTMLElement): void {
		if (item === 'new') {
			el.addClass('sg-picker-new-item');
			const icon = el.createSpan({ cls: 'sg-picker-new-icon' });
			setPhosphorIcon(icon, 'plus-circle', '+');
			el.createSpan({ text: 'Create new grid', cls: 'sg-picker-new-label' });
			return;
		}

		el.addClass('sg-picker-file-item');
		const info = el.createDiv({ cls: 'sg-picker-info' });
		info.createDiv({ cls: 'sg-grid-picker-name', text: item.basename });
		info.createDiv({ cls: 'sg-grid-picker-path', text: item.path });

		// Delete button — stopPropagation prevents triggering the file selection
		const deleteBtn = el.createEl('button', {
			cls: 'sg-picker-delete-btn',
			title: 'Delete this grid (moves to system trash)',
		});
		setPhosphorIcon(deleteBtn, 'trash', '🗑');

		deleteBtn.addEventListener('mousedown', (e) => {
			e.stopPropagation();
			e.preventDefault();
			new ConfirmModal(
				this.app,
				`Are you sure you want to delete "${item.basename}"?\n\nThe file will be moved to the system trash.`,
				'Delete',
				() => {
					runSafely((async () => {
						try {
							await this.app.fileManager.trashFile(item);
							new Notice(`"${item.basename}" moved to trash.`);
							// Force the suggestion list to refresh
							this.inputEl.dispatchEvent(new Event('input'));
						} catch (err) {
							new Notice(`Could not delete grid: ${err instanceof Error ? err.message : String(err)}`);
						}
					})());
				}
			).open();
		});
	}

	onChooseSuggestion(item: GridPickerItem): void {
		if (item === 'new') {
			this.onCreateNew?.();
		} else {
			this.onSelect(item);
		}
	}
}
