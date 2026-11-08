import { FuzzySuggestModal, Notice, Editor, MarkdownView, Menu } from 'obsidian';
import type { EntityInfo } from '../entities/entity-manager';
import { buildEntityWikilink } from '../refs/references';
import { addEntityAlias } from '../entities/entity-write';
import { getKindSpec } from '../entities/entity-kinds';
import type StorygridPlugin from '../main';
import { t } from '../i18n';

class EntityPickerModal extends FuzzySuggestModal<EntityInfo> {
	constructor(
		private readonly plugin: StorygridPlugin,
		private readonly selectedText: string,
		private readonly editor: Editor,
	) {
		super(plugin.app);
		this.setPlaceholder('Pick a Codex entry to link to…');
	}

	getItems(): EntityInfo[] {
		return this.plugin.entityIndex
			.getAllEntities()
			.filter((e) => e.entityId !== null);
	}

	getItemText(entity: EntityInfo): string {
		const spec = getKindSpec(entity.kind);
		return `${entity.name} (${spec.singular})`;
	}

	onChooseItem(entity: EntityInfo): void {
		const wikilink = buildEntityWikilink(entity.file.path, this.selectedText);
		this.editor.replaceSelection(wikilink);
	}
}

class AddAliasModal extends FuzzySuggestModal<EntityInfo> {
	constructor(
		private readonly plugin: StorygridPlugin,
		private readonly alias: string,
	) {
		super(plugin.app);
		this.setPlaceholder(`Add "${alias}" as alias to which entry?`);
	}

	getItems(): EntityInfo[] {
		return this.plugin.entityIndex
			.getAllEntities()
			.filter((e) => e.entityId !== null);
	}

	getItemText(entity: EntityInfo): string {
		const spec = getKindSpec(entity.kind);
		return `${entity.name} (${spec.singular})`;
	}

	async onChooseItem(entity: EntityInfo): Promise<void> {
		try {
			const result = await addEntityAlias(this.app, entity.file, this.alias);
			if (result === 'duplicate') {
				new Notice(`"${this.alias}" is already an alias for ${entity.name}.`);
				return;
			}
			new Notice(`Added "${this.alias}" as alias for ${entity.name}.`);
		} catch (err) {
			// FuzzySuggestModal calls this without awaiting it, so a rejection
			// here used to vanish into an unhandled-promise warning — the writer
			// saw the modal close and assumed the alias was saved.
			new Notice(`Plotverk: Could not add alias. ${err instanceof Error ? err.message : ''}`);
		}
	}
}

export function registerLinkSelectionCommand(plugin: StorygridPlugin): void {
	plugin.addCommand({
		id: 'link-selection',
		name: t('command.linkSelection'),
		editorCallback(editor: Editor) {
			const selected = editor.getSelection();
			if (!selected.trim()) {
				new Notice('Select some text first, then run this command.');
				return;
			}
			new EntityPickerModal(plugin, selected, editor).open();
		},
	});

	plugin.registerEvent(
		plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
			const selected = editor.getSelection();
			if (selected.trim()) {
				menu.addItem((item) => {
					item
						.setTitle('Link to Codex entry')
						.setIcon('link')
						.onClick(() => {
							new EntityPickerModal(plugin, selected, editor).open();
						});
				});
				menu.addItem((item) => {
					item
						.setTitle(`Add "${selected}" as Codex alias`)
						.setIcon('tag')
						.onClick(() => {
							new AddAliasModal(plugin, selected).open();
						});
				});
			}
		})
	);
}
