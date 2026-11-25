import { Notice, TFile } from 'obsidian';
import type StorygridPlugin from '../main';
import type { CharacterField } from '../grid-data';
import type { SheetFormOptions, SheetSaveHandler } from '../modals/entity-sheet-form';
import { EntityKind, getKindSpec } from './entity-kinds';
import { mergeWithSpecDefaults, parseEntityDocument } from './entity-parse';
import { FieldSnapshot, UpdateEntitySheetOptions, updateEntitySheetFrom } from './entity-write';
import { asksForRename, sheetNameTaken, sheetPathFor } from './sheet-rename';
import { mergeSheetSave, OpenField } from './sheet-merge';
import { writableTemplatesFor } from './start-mode';
import { relationChoices } from '../utils/relations';
import { reportError, runSafely } from '../utils/report-error';
import { t } from '../i18n';

/** Everything the sheet editor needs to edit one existing sheet. */
export interface SheetEdit {
	file: TFile;
	kind: EntityKind;
	/** The sheet's title as it was when the editor opened. */
	startName: string;
	/** The fields the editor shows — it edits these objects in place. */
	fields: CharacterField[];
	/** Writes the sheet back; hands back the saved file, or nothing when it failed (a notice says why). */
	save: SheetSaveHandler;
	options: SheetFormOptions;
}

/**
 * What an editor tab needs to notice the sheet changing elsewhere while it is
 * open: the text the editor was opened from, and a way to open it afresh.
 */
export interface SheetEditWatch {
	openedContent: string;
	/** Read the sheet again and prepare a fresh edit (same follow-ups as this one); null when it can't be read. */
	reload(): Promise<SheetEdit | null>;
}

/** One save's write, and the sheet's title on disk it was written over (for "did the writer rename it?"). */
interface SheetWritePlan extends UpdateEntitySheetOptions {
	currentName: string;
}

interface PrepareOptions {
	/** The kind to use when the sheet doesn't say. */
	fallbackKind: EntityKind;
	/** The name shown in the "could not read" notice. */
	displayName: string;
	projectRoot?: string;
	onSaved?: (file: TFile, oldPath: string) => void;
}

/**
 * Read an existing sheet and prepare its edit: the fields to show, and the
 * save that writes them back. The same routine whichever module or host
 * (pop-up or tab) opens the editor.
 *
 * The save keeps the sheet-writing rules: what was on disk is remembered
 * NOW, before the editor can change anything (ids, labels, types, values —
 * the save diffs against it); the sheet is updated in place, never rebuilt;
 * the file follows only a name changed in the editor. When the sheet changed
 * on disk while the editor was open (a relationship mirrored in from another
 * sheet, a rename in the Codex, Sync), the save merges instead of writing
 * over it — see `sheet-merge`. `onSaved` runs after every successful save
 * with the file (already at its new place after a rename) and the path it
 * had before.
 *
 * Null when the sheet can't be read (a notice says why).
 */
export async function prepareSheetEdit(plugin: StorygridPlugin, file: TFile, opts: PrepareOptions): Promise<SheetEdit | null> {
	const app = plugin.app;
	let content: string;
	try {
		content = await app.vault.read(file);
	} catch (err) {
		new Notice(t('codex.notice.readFailed', { name: opts.displayName, msg: err instanceof Error ? err.message : '' }));
		return null;
	}

	const parsed = parseEntityDocument(content, file.basename);
	const kind = parsed.kind ?? opts.fallbackKind;
	const fields = mergeWithSpecDefaults(kind, parsed.fields, parsed.cleanSlate);
	// The editor edits these field objects in place (labels included), so what
	// was on disk has to be remembered now — the save diffs against it to know
	// which fields the writer deleted, relabeled or changed.
	const before: FieldSnapshot[] = fields.map((f) => ({ id: f.id, label: f.label, type: f.type }));
	const openFields: OpenField[] = fields.map((f) => ({ id: f.id, label: f.label, type: f.type, value: f.value }));
	const startName = parsed.name;

	const save: SheetSaveHandler = async (editorName, savedFields, editorAliases) => {
		/**
		 * What to write, and against what, given the sheet's text right now:
		 * the sheet as the editor opened it, or — when it changed on disk
		 * meanwhile — merged with that (see `sheet-merge`).
		 */
		const planFor = (now: string): SheetWritePlan => {
			if (now === content) {
				return {
					kind, name: editorName, aliases: editorAliases, fields: savedFields, before,
					entityId: parsed.entityId ?? undefined, staleKeys: parsed.ownedKeys, currentName: startName,
				};
			}
			const disk = parseEntityDocument(now, file.basename);
			const diskFields = mergeWithSpecDefaults(disk.kind ?? kind, disk.fields, disk.cleanSlate);
			const merged = mergeSheetSave(
				{ name: startName, aliases: parsed.aliases, fields: openFields },
				{ name: disk.name, aliases: disk.aliases, fields: diskFields },
				{ name: editorName, aliases: editorAliases, fields: savedFields },
			);
			return {
				kind,
				name: merged.name,
				aliases: merged.aliases,
				fields: merged.fields,
				before: merged.before,
				entityId: disk.entityId ?? parsed.entityId ?? undefined,
				staleKeys: [...new Set([...parsed.ownedKeys, ...disk.ownedKeys])],
				currentName: disk.name,
			};
		};

		// Read first, to refuse a rename onto a taken name before anything is
		// written. A sheet that can't be read now is not written blind.
		let now: string;
		try {
			now = await app.vault.read(file);
		} catch (err) {
			new Notice(t('codex.notice.saveFailed', { kind, msg: err instanceof Error ? err.message : '' }));
			return;
		}
		const ahead = planFor(now);
		// The aliases on disk right before this save (an alias renamed here may be followed into the text).
		const aliasesBefore = now === content ? parsed.aliases : parseEntityDocument(now, file.basename).aliases;
		// Another sheet already has the new name: nothing is written, and the
		// editor stays open with the writer's work so they can pick another.
		if (asksForRename(ahead.name, ahead.currentName) && sheetNameTaken(app, file, ahead.name)) {
			new Notice(t('codex.notice.nameTaken', { name: ahead.name.trim() }));
			return;
		}
		// The write decides again from the text at the moment of writing, so a
		// change landing in between (a mirrored relationship) is merged too.
		let written: SheetWritePlan;
		try {
			written = await updateEntitySheetFrom(app, file, planFor);
		} catch (err) {
			// Nothing back: the sheet editor stays open with the writer's work.
			new Notice(t('codex.notice.saveFailed', { kind, msg: err instanceof Error ? err.message : '' }));
			return;
		}
		const name = written.name;
		const renamed = asksForRename(name, written.currentName);
		// The sheet is saved. From here a hiccup is reported, never a reason to save again.
		const oldPath = file.path;
		try {
			// The writer renamed the sheet in the editor: the file follows.
			const newPath = sheetPathFor(file, name);
			if (renamed && newPath !== file.path && !sheetNameTaken(app, file, name)) {
				try {
					await app.fileManager.renameFile(file, newPath);
				} catch (err) {
					// The sheet is saved under its new title; only the file kept its
					// old name. Say so plainly (the menu's Rename can try again).
					new Notice(t('codex.notice.renameFailed', { msg: err instanceof Error ? err.message : '' }));
				}
			}
			new Notice(t('codex.notice.entityUpdated', { singular: getKindSpec(kind).singular, name }));
			opts.onSaved?.(file, oldPath);
			plugin.aliasFollow?.sheetSaved(file, aliasesBefore, written.aliases ?? []);
		} catch (err) {
			reportError(err);
		}
		// Renamed in place above, so this is the sheet as it is on disk now.
		return file;
	};

	const watch: SheetEditWatch = {
		openedContent: content,
		reload: () => prepareSheetEdit(plugin, file, opts),
	};

	return {
		file,
		kind,
		startName,
		fields,
		save,
		options: {
			savedTemplates: writableTemplatesFor(plugin.settings, kind),
			onSaveTemplate: (tpl) => {
				writableTemplatesFor(plugin.settings, kind).push(tpl);
				runSafely(plugin.saveSettings().then(() => { new Notice(t('codex.notice.templateSaved', { name: tpl.name })); }));
			},
			projectRoot: opts.projectRoot,
			initialAliases: parsed.aliases,
			relationChoices: relationChoices(plugin.settings.customRelationshipTypes),
			plugin,
			fileBasename: file.basename,
			sheetPath: file.path,
			cleanSlate: parsed.cleanSlate,
			sheetWatch: watch,
		},
	};
}
