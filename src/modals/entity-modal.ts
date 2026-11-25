import { App, Modal } from 'obsidian';
import type { EntityKind } from '../entities/entity-kinds';
import type { CharacterField } from '../grid-data';
import { EntitySheetForm, SheetFormHost, SheetFormOptions, SheetSaveHandler } from './entity-sheet-form';

export type { EntityKind } from '../entities/entity-kinds';
export { registerEntityModalPlugin } from './entity-sheet-form';
export type { EntityModalVariant, SheetFormOptions, SheetSaveHandler } from './entity-sheet-form';

/**
 * The sheet editor as an Obsidian pop-up: a thin shell around
 * `EntitySheetForm`, which holds all of the editor itself. Every way the
 * pop-up can close (Cancel, ×, Escape, a click on the dimmed background)
 * goes through the form's close guard first.
 */
export class SheetFormModal extends Modal {
	protected readonly form: EntitySheetForm;

	/**
	 * `makeForm` builds the form for this pop-up's host (or moves an existing
	 * one in). `askOnOpen`: show the "Discard?" bar straight away — a sheet tab
	 * was closed with unsaved work, so the writer chooses here.
	 */
	constructor(app: App, makeForm: (host: SheetFormHost) => EntitySheetForm, private readonly askOnOpen = false) {
		super(app);
		this.form = makeForm({ app, rootEl: this.modalEl, contentEl: this.contentEl, closeHost: () => this.closeNow() });
	}

	/** Every way out asks the form first: with unsaved work it shows its Discard bar instead. */
	close(): void {
		this.form.requestClose();
	}

	/** The form is done (saved, or the writer chose Discard): really close the pop-up. */
	private closeNow(): void {
		super.close();
	}

	onOpen(): void {
		this.form.render();
		if (this.askOnOpen) this.form.askBeforeLeaving();
	}

	onClose(): void {
		this.form.dispose();
	}
}

/** The sheet editor as a pop-up, for a new or existing sheet. */
export class EntityModal extends SheetFormModal {
	constructor(
		app: App,
		kind: EntityKind,
		entityName: string = '',
		fields: CharacterField[] = [],
		onSave: SheetSaveHandler,
		options?: SheetFormOptions
	) {
		super(app, (host) => new EntitySheetForm(host, kind, entityName, fields, onSave, options));
	}
}
