import { App, Menu, Modal, Notice, Platform, TFile, setTooltip } from 'obsidian';
import type StorygridPlugin from '../main';
import { CharacterField, CharacterFieldTemplate, generateId } from '../grid-data';
import { FieldConfig, FieldTint, FIELD_TINTS, defaultValueForType } from '../entities/field-types';
import {
	EntityKind,
	EntityFieldSpec,
	getKindSpec,
	instantiateFields,
	getFieldPrompt,
	groupFieldsIntoSections,
	iconForCustomLabel,
	GroupedSection,
	fieldCatalogForKind,
} from '../entities/entity-kinds';
import { setPhosphorIcon } from '../utils/icons';
import { adoptImagesIntoSheetFolder, resolveImageField, saveImageForSheet, SheetImageTarget, targetForSheet } from '../entities/sheet-images';
import { entityFolderPath, localizedDefaultName } from '../entities/entity-manager';
import { TextPromptModal, ConfirmModal } from './prompt-modal';
import { EntityPickerModal } from './entity-picker-modal';
import {
	RelationChoice,
	RelationLine,
	COMMON_RELATION_CHOICES,
	relationChoices,
} from '../utils/relations';
import { MirrorGender, genderFromFields } from '../utils/relation-mirror';
import { mirrorRelationChanges, mirrorTarget, relationLinesOf } from '../relation-sync';
import { mirrorPreviewText, relationSentenceParts, sentenceShapeFor } from '../utils/relation-sentence';
import { renderFieldWidget, renderHoverHelp } from '../ui/field-widgets';
import { eventDurationFrom } from '../timeline/timeline-events';
import { renderFieldCreatorCard } from '../ui/field-creator';
import { mountRelTypeWizard } from '../ui/rel-type-wizard';
import { mountRelationshipEditor } from '../ui/relationship-editor';
import { t, hasKey, getLocale } from '../i18n';
import {
	StartMode,
	SheetStart,
	TemplateOption,
	GUIDED_TEMPLATE,
	templateOptions,
	showsTemplatePicker,
	resolveDefaultTemplate,
	rememberDefaultTemplate,
	defaultTemplateAfterPick,
	savedTemplatesFor,
	asksStartMode,
	cleanSlateFieldSpecs,
	offersStartChoice,
	rememberStartMode,
	rememberedStartMode,
	withStartValues,
} from '../entities/start-mode';

export type { EntityKind } from '../entities/entity-kinds';

/**
 * The running plugin, registered once at load so every pop-up can read and
 * remember the "template or clean slate" choice. Most callers never pass
 * `plugin` (that option also switches on the relationship-type wizard).
 */
let registeredPlugin: StorygridPlugin | null = null;
export function registerEntityModalPlugin(plugin: StorygridPlugin | null): void {
	registeredPlugin = plugin;
}

const NAME_LABELS = ['Full Name', 'Name', 'Title', 'Topic'];

/** "character", "lieu"… — the kind's own word in the reader's language, for "New character". */
function kindWord(kind: EntityKind): string {
	const key = `settings.codex.kinds.${kind}`;
	return (hasKey(key) ? t(key) : getKindSpec(kind).singular).toLowerCase();
}

/**
 * Copy/paste buffers shared across every open sheet editor, so a field or a
 * whole group can be carried from one character to another. Deliberately
 * in-memory only — this is a clipboard, not saved state.
 */
let fieldClipboard: CharacterField | null = null;
let groupClipboard: CharacterField[] | null = null;

/** A kind of sheet within a kind, offered by a caller (the Timeline's era: an Event sheet with How Long = "An era"). */
export interface EntityModalVariant {
	singular: string;
	/** The lower-case word in the reader's language, for "New {kind}". */
	word: string;
	icon: string;
	fallbackIcon: string;
	tagline: string;
	cleanSlateFields: EntityFieldSpec[];
	guidedFields: EntityFieldSpec[];
}

/**
 * The Plotverk sheet editor — one designed surface for creating and editing
 * every worldbuilding kind. Layout: a portrait rail on the left (image, name,
 * templates, progress) and collapsible, icon-headed field sections on the
 * right. On phones the rail folds into a compact header. All per-kind copy,
 * fields, and section groupings come from the entity-kinds registry; the
 * field-template plumbing is unchanged so settings stay compatible.
 */
export class EntityModal extends Modal {
	private kind: EntityKind;
	private name: string;
	private fields: CharacterField[];
	private aliases: string[];
	/**
	 * Resolve to the saved sheet's file to have its relationship changes
	 * mirrored onto the other sheets; resolve to nothing (or fail) and no other
	 * sheet is touched.
	 */
	private onSave: (name: string, fields: CharacterField[], aliases: string[], start: SheetStart) => void | Promise<TFile | void>;
	private onSaveTemplate?: (template: CharacterFieldTemplate) => void;
	private savedTemplates: CharacterFieldTemplate[];
	/** Section titles the user folded shut (per modal instance) */
	private collapsed: Set<string> = new Set();
	/**
	 * The sheet's relationship lines as they were when the editor opened. Save
	 * diffs against them, so only lines the writer added, changed or removed are
	 * mirrored onto the other sheets — and only on SAVE; cancelling the modal
	 * leaves other files untouched.
	 */
	private relationsAtOpen: RelationLine[];
	/** The sheet's file name and title when the editor opened — other sheets' links may still use either after a rename. */
	private namesAtOpen: string[];
	/** Whether the "+ Add field" inline creator card is open. */
	private fieldCreatorOpen = false;
	private progressEl: HTMLElement | null = null;
	/** Redraws whatever names this sheet or reads its Gender (the relationship sentences). Rebuilt on every render. */
	private ownerListeners: Array<() => void> = [];
	/** A person picked in a relationship row but not yet added, per field: kept across redraws, added on Save. */
	private pendingRelations = new Map<string, { name: string; word: string; picked: boolean }>();
	/**
	 * Sibling rects cached once at drag-start and read by the section body's
	 * `dragover` handler, instead of re-querying and measuring every sibling's
	 * bounding rect on every `dragover` event during a single drag.
	 */
	private dragFieldRects: Array<{ el: HTMLElement; rect: DOMRect }> | null = null;
	/** Project root path, used to power the relationship entity picker. */
	private projectRoot: string | null = null;
	/** Relationship words offered in the "Add relationship" dropdown. */
	private relationChoices: RelationChoice[];
	/** Plugin reference, only used to power "+ New relationship type…" in the relationship dropdown. */
	private plugin: StorygridPlugin | null = null;
	/** The sheet being edited, when it already exists — its pictures go in its own folder. */
	private sheetPath: string | null = null;
	/** Pictures imported while this editor was open: tidied into the new sheet's folder on save, trashed on cancel. */
	private uploaded: TFile[] = [];
	private saved = false;
	/** A brand-new, empty sheet: the pop-up first asks "template or clean slate". */
	private readonly offerStart: boolean;
	/** Which start the form is built from. */
	private startMode: StartMode = 'template';
	/** What the pop-up shows: the "template or clean slate" step, the template picker, or the form. */
	private step: 'choose' | 'pick' | 'form' = 'form';
	/** The template the form is built from, when `startMode` is 'template'. */
	private templateId = GUIDED_TEMPLATE;
	/** "Make this my default" from the picker, applied on Save: an id, null to clear, undefined to leave alone. */
	private pendingDefault: string | null | undefined = undefined;
	/** Fields the current start put on the sheet — dropped when the writer switches start, unless filled. */
	private startFieldIds = new Set<string>();
	/** Values the caller already knows (the Timeline's clicked date), poured into every start. */
	private startValues: Record<string, string> = {};
	/** The caller's own small block under the name (the Timeline's plotline choice). */
	private railExtra?: (rail: HTMLElement) => void;
	/** A caller's own kind of sheet within this kind (the Timeline's "Add era"): its words, icon and two starts. */
	private variant: EntityModalVariant | null = null;

	constructor(
		app: App,
		kind: EntityKind,
		entityName: string = '',
		fields: CharacterField[] = [],
		onSave: (name: string, fields: CharacterField[], aliases: string[], start: SheetStart) => void | Promise<TFile | void>,
		options?: {
			onSaveTemplate?: (template: CharacterFieldTemplate) => void;
			savedTemplates?: CharacterFieldTemplate[];
			/** Pass the project root to enable the entity picker in relationship fields. */
			projectRoot?: string;
			/** Pre-populate the "Also known as" field when editing an existing entity. */
			initialAliases?: string[];
			/** Relationship words for the "Add relationship" dropdown (custom types + built-ins). */
			relationChoices?: RelationChoice[];
			/** Enables "+ New relationship type…" in the relationship dropdown. */
			plugin?: StorygridPlugin;
			/** The sheet's file name, when editing an existing sheet (it can differ from the title). */
			fileBasename?: string;
			/** The sheet's path, when editing an existing sheet: pictures added here go in its folder. */
			sheetPath?: string;
			/** Editing a sheet that began as a clean slate: no template fields, even when it has no fields at all. */
			cleanSlate?: boolean;
			/** A new sheet only: field values to start with, by label (e.g. the Timeline's clicked `Date`), whichever start is chosen. */
			startValues?: Record<string, string>;
			/** Draws the caller's own small block in the side column, under the name. Called on every redraw. */
			railExtra?: (rail: HTMLElement) => void;
			/** A new sheet only: a kind of sheet within this kind (an Era is an Event sheet) — its own words, icon, clean slate and guided fields, and no template picker. */
			variant?: EntityModalVariant;
		}
	) {
		super(app);
		this.kind = kind;
		this.name = entityName;
		this.startValues = { ...options?.startValues };
		this.railExtra = options?.railExtra;
		this.variant = !options?.sheetPath && fields.length === 0 ? options?.variant ?? null : null;
		this.fields = fields.length > 0 || options?.cleanSlate
			? [...fields]
			: instantiateFields(this.variant?.guidedFields ?? getKindSpec(kind).defaultFields, entityName);
		this.plugin = options?.plugin ?? null;
		this.savedTemplates = options?.savedTemplates ?? savedTemplatesFor(this.settingsHost(), kind);
		this.offerStart = offersStartChoice(!options?.sheetPath, fields.length);
		if (this.offerStart) {
			this.fields = withStartValues(kind, this.fields, this.startValues);
			const settings = this.settingsHost()?.settings;
			this.startFieldIds = new Set(this.fields.map((f) => f.id));
			// Asked: the first step. Not asked: straight to the remembered start
			// (and the default template, when the writer set one).
			this.step = asksStartMode(settings?.entityAskStartMode) ? 'choose' : 'form';
			const mode = rememberedStartMode(settings?.entityStartMode, kind);
			const tpl = resolveDefaultTemplate(settings?.entityDefaultTemplate, kind, this.templateOptions());
			if (mode === 'clean' || tpl !== GUIDED_TEMPLATE) this.applyStart(mode, tpl);
		} else if (options?.cleanSlate) {
			this.startMode = 'clean';
		}
		this.aliases = options?.initialAliases ? [...options.initialAliases] : [];
		this.onSave = onSave;
		this.onSaveTemplate = options?.onSaveTemplate;
		this.projectRoot = options?.projectRoot ?? null;
		this.relationChoices = options?.relationChoices ?? [...COMMON_RELATION_CHOICES];
		this.sheetPath = options?.sheetPath ?? null;
		this.relationsAtOpen = relationLinesOf(this.fields);
		this.namesAtOpen = [entityName, options?.fileBasename ?? '']
			.map((n) => n.trim().toLowerCase())
			.filter(Boolean);
	}

	onOpen(): void {
		const { contentEl } = this;
		const spec = getKindSpec(this.kind);

		this.modalEl.addClass('storygrid-modal', 'sg-sheet-host');
		contentEl.addClass('sg-sheet');
		contentEl.addClass(`sg-sheet--${this.kind}`);
		this.modalEl.toggleClass('sg-sheet-host--start', this.step !== 'form');
		if (this.step === 'choose') {
			this.renderStartChoice();
			return;
		}
		if (this.step === 'pick') {
			this.renderTemplatePicker();
			return;
		}

		this.ownerListeners = [];

		// ── Accent band ────────────────────────────────────────────────────────
		const band = contentEl.createDiv({ cls: 'sg-sheet-band' });
		if (this.offerStart) {
			// Back to the step before: the template picker when this form came
			// from it, otherwise the "template or clean slate" choice.
			const toPicker = this.startMode === 'template' && showsTemplatePicker(this.templateOptions());
			this.renderBack(band, toPicker ? 'pick' : 'choose');
		}
		const look = this.look();
		const chip = band.createDiv({ cls: 'sg-sheet-band-chip' });
		setPhosphorIcon(chip, look.icon, look.fallbackIcon);
		const bandText = band.createDiv({ cls: 'sg-sheet-band-text' });
		bandText.createDiv({
			cls: 'sg-sheet-band-title',
			text: this.name ? this.name : `New ${look.singular}`,
		});
		bandText.createDiv({ cls: 'sg-sheet-band-tagline', text: look.tagline });

		// ── Body: rail + sections ──────────────────────────────────────────────
		const body = contentEl.createDiv({ cls: 'sg-sheet-body' });
		const rail = body.createDiv({ cls: 'sg-sheet-rail' });
		const main = body.createDiv({ cls: 'sg-sheet-main' });

		this.renderRail(rail, band);
		this.renderSections(main);

		// ── Footer ─────────────────────────────────────────────────────────────
		const footer = contentEl.createDiv({ cls: 'sg-sheet-footer' });

		if (this.onSaveTemplate) {
			const tplBtn = footer.createEl('button', {
				cls: 'sg-sheet-btn sg-sheet-btn--ghost',
				text: 'Save as template',
			});
			tplBtn.setAttr('aria-label', 'Save the current field structure as a reusable template (values are not saved)');
			tplBtn.addEventListener('click', () => {
				new TextPromptModal(this.app, 'Template name', `My ${spec.singular} Template`, (tplName) => {
					const categories = this.existingCategories();
					this.onSaveTemplate!({
						id: generateId(),
						name: tplName,
						fields: this.fields.map((f) => ({
							label: f.label, type: f.type, prompt: f.prompt, config: f.config, category: f.category,
						})),
						categories: categories.length > 0 ? categories.map((title) => ({ title })) : undefined,
					});
				}).open();
			});
		}

		const spacer = footer.createDiv({ cls: 'sg-sheet-footer-spacer' });
		void spacer;

		const cancelBtn = footer.createEl('button', { cls: 'sg-sheet-btn', text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = footer.createEl('button', {
			cls: 'sg-sheet-btn sg-sheet-btn--primary',
			text: `Save ${look.singular.toLowerCase()}`,
		});
		saveBtn.addEventListener('click', () => {
			this.addPendingRelations();
			if (!this.name.trim()) {
				const nameField = this.fields.find((f) => ['Full Name', 'Name', 'Title', 'Topic'].includes(f.label));
				this.name = nameField?.value.trim() || spec.defaultName;
			}
			const after = relationLinesOf(this.fields);
			const gender = genderFromFields(this.fields);
			this.saved = true;
			this.rememberStart();
			// The caller writes the clean-slate marker in the same write as the sheet,
			// so the first edit never refills the template the writer turned down.
			const saved = this.onSave(this.name, this.fields, this.aliases, {
				cleanSlate: this.offerStart && this.startMode === 'clean',
			});
			this.close();
			const uploaded = this.isNewSheet() ? [...this.uploaded] : [];
			// Other sheets follow only once this one is safely on disk.
			void Promise.resolve(saved).then(
				async (file) => {
					if (!(file instanceof TFile)) return;
					if (uploaded.length > 0) {
						try { await adoptImagesIntoSheetFolder(this.app, file, uploaded); }
						catch (err) { new Notice(`Plotverk: Could not move the new images into the sheet’s folder. ${err instanceof Error ? err.message : ''}`); }
					}
					return this.mirrorRelationChanges(file, after, gender);
				},
				() => { /* the save reported its own failure */ },
			);
		});
	}

	private rerender(): void {
		this.contentEl.empty();
		this.contentEl.removeClass('sg-sheet', `sg-sheet--${this.kind}`);
		this.onOpen();
	}

	// ─── First step: template or clean slate ───────────────────────────────────

	private settingsHost(): StorygridPlugin | null {
		return this.plugin ?? registeredPlugin;
	}

	/**
	 * Two equal choices, the last one used preselected with focus. Arrow keys
	 * move between them, Enter picks, Escape closes the pop-up (Obsidian's own).
	 */
	private renderStartChoice(): void {
		const { contentEl } = this;
		const look = this.look();
		const saved = this.settingsHost()?.settings.entityStartMode;
		const remembered = rememberedStartMode(saved, this.kind);

		const band = contentEl.createDiv({ cls: 'sg-sheet-band' });
		const chip = band.createDiv({ cls: 'sg-sheet-band-chip' });
		setPhosphorIcon(chip, look.icon, look.fallbackIcon);
		const bandText = band.createDiv({ cls: 'sg-sheet-band-text' });
		bandText.createDiv({ cls: 'sg-sheet-band-title', text: t('entityStart.title', { kind: look.word }) });
		bandText.createDiv({ cls: 'sg-sheet-band-tagline', text: t('entityStart.question') });

		const list = contentEl.createDiv({
			cls: 'sg-start-choices',
			attr: { role: 'group', 'aria-label': t('entityStart.question') },
		});
		const choices: Array<{ mode: StartMode; icon: string; title: string; desc: string }> = [
			{ mode: 'template', icon: 'list', title: t('entityStart.template.title'), desc: t('entityStart.template.desc') },
			{ mode: 'clean', icon: 'pen-nib', title: t('entityStart.clean.title'), desc: t('entityStart.clean.desc') },
		];
		const buttons = choices.map((c) => {
			const btn = list.createEl('button', { cls: 'sg-start-choice', attr: { type: 'button' } });
			const icon = btn.createSpan({ cls: 'sg-start-choice-icon' });
			setPhosphorIcon(icon, c.icon, '•');
			const text = btn.createSpan({ cls: 'sg-start-choice-text' });
			text.createSpan({ cls: 'sg-start-choice-title', text: c.title });
			text.createSpan({ cls: 'sg-start-choice-desc', text: c.desc });
			if (c.mode === remembered) {
				btn.addClass('is-selected');
				// Only a choice actually made before earns the "Last time" note.
				if (saved?.[this.kind]) btn.createSpan({ cls: 'sg-start-choice-badge', text: t('entityStart.lastChoice') });
			}
			btn.addEventListener('click', () => this.chooseStart(c.mode));
			return btn;
		});
		list.addEventListener('keydown', (e: KeyboardEvent) => {
			const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1
				: e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
			if (!step) return;
			e.preventDefault();
			const at = buttons.findIndex((b) => b === document.activeElement);
			buttons[((at < 0 ? 0 : at) + step + buttons.length) % buttons.length].focus();
		});
		const preselected = buttons[remembered === 'clean' ? 1 : 0];
		window.setTimeout(() => preselected.focus(), 50);

		const footer = contentEl.createDiv({ cls: 'sg-sheet-footer' });
		footer.createDiv({ cls: 'sg-sheet-footer-spacer' });
		const cancelBtn = footer.createEl('button', { cls: 'sg-sheet-btn', text: t('common.cancel') });
		cancelBtn.addEventListener('click', () => this.close());
	}

	private chooseStart(mode: StartMode): void {
		if (mode === 'template' && showsTemplatePicker(this.templateOptions())) {
			this.step = 'pick';
		} else {
			if (mode !== this.startMode || (mode === 'template' && this.templateId !== GUIDED_TEMPLATE)) {
				this.applyStart(mode, GUIDED_TEMPLATE);
			}
			this.step = 'form';
		}
		this.rerender();
	}

	/** "‹ Back" at the top left of a step's band. */
	private renderBack(band: HTMLElement, to: 'choose' | 'pick'): void {
		const back = band.createEl('button', {
			cls: 'sg-sheet-back',
			text: t('entityStart.back'),
			attr: { type: 'button', 'aria-label': t(to === 'pick' ? 'entityStart.backToPicker' : 'entityStart.backLabel') },
		});
		back.addEventListener('click', () => {
			this.step = to;
			this.fieldCreatorOpen = false;
			this.rerender();
		});
	}

	/** The rows the template picker offers for this kind. A caller's own field sets (an era) offer only their guided fields — so no picker. */
	private templateOptions(): TemplateOption[] {
		if (this.variant) return [{ id: GUIDED_TEMPLATE, name: t('entityStart.guided'), fieldCount: this.variant.guidedFields.length }];
		return templateOptions(this.kind, t('entityStart.guided'), this.savedTemplates);
	}

	/** What the pop-up calls this sheet: the kind's own words and icon, or the caller's variant's (an Era is an Event sheet). */
	private look(): { singular: string; icon: string; fallbackIcon: string; tagline: string; word: string } {
		const spec = getKindSpec(this.kind);
		const v = this.variant;
		return v
			? { singular: v.singular, icon: v.icon, fallbackIcon: v.fallbackIcon, tagline: v.tagline, word: v.word }
			: { singular: spec.singular, icon: spec.icon, fallbackIcon: spec.fallbackIcon, tagline: spec.tagline, word: kindWord(this.kind) };
	}

	/**
	 * Second step, only when there is more than the guided fields to choose
	 * from: one plain list, the default (or the last pick) preselected with
	 * focus, so Enter-Enter reaches the form. Arrow keys move between rows.
	 */
	private renderTemplatePicker(): void {
		const { contentEl } = this;
		const spec = getKindSpec(this.kind);
		const host = this.settingsHost();
		const options = this.templateOptions();
		const currentDefault = host?.settings.entityDefaultTemplate?.[this.kind];
		const resolvedDefault = resolveDefaultTemplate(host?.settings.entityDefaultTemplate, this.kind, options);
		const hasDefault = resolvedDefault !== GUIDED_TEMPLATE;
		const preselect = this.startMode === 'template' && options.some((o) => o.id === this.templateId)
			? this.templateId
			: resolvedDefault;

		const band = contentEl.createDiv({ cls: 'sg-sheet-band' });
		this.renderBack(band, 'choose');
		const chip = band.createDiv({ cls: 'sg-sheet-band-chip' });
		setPhosphorIcon(chip, spec.icon, spec.fallbackIcon);
		const bandText = band.createDiv({ cls: 'sg-sheet-band-text' });
		bandText.createDiv({ cls: 'sg-sheet-band-title', text: t('entityStart.title', { kind: kindWord(this.kind) }) });
		bandText.createDiv({ cls: 'sg-sheet-band-tagline', text: t('entityStart.pickQuestion') });

		const body = contentEl.createDiv({ cls: 'sg-start-picker' });
		const list = body.createDiv({
			cls: 'sg-start-rows',
			attr: { role: 'group', 'aria-label': t('entityStart.pickQuestion') },
		});
		const tick = createEl('input', { type: 'checkbox', cls: 'sg-start-default-box' });
		tick.id = 'sg-start-default-box';
		// The box shows whether the row in focus IS the default — until the
		// writer touches it; then their tick stands for whichever row they pick.
		let touched = false;
		tick.addEventListener('change', () => { touched = true; });
		const syncTick = (id: string) => { if (!touched) tick.checked = hasDefault && id === resolvedDefault; };
		syncTick(preselect);
		const rows = options.map((o) => {
			const row = list.createEl('button', { cls: 'sg-start-row', attr: { type: 'button' } });
			row.createSpan({ cls: 'sg-start-row-name', text: o.name });
			row.createSpan({
				cls: 'sg-start-row-count',
				text: o.fieldCount === 1 ? t('entityStart.fieldCountOne') : t('entityStart.fieldCount', { count: o.fieldCount }),
			});
			if (hasDefault && o.id === resolvedDefault) row.createSpan({ cls: 'sg-start-row-badge', text: t('entityStart.isDefault') });
			if (o.id === preselect) row.addClass('is-selected');
			row.addEventListener('focus', () => syncTick(o.id));
			row.addEventListener('click', () => {
				this.pendingDefault = defaultTemplateAfterPick(o.id, tick.checked, currentDefault);
				this.applyStart('template', o.id);
				this.step = 'form';
				this.rerender();
			});
			return row;
		});
		list.addEventListener('keydown', (e: KeyboardEvent) => {
			const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
			if (!dir) return;
			e.preventDefault();
			const at = rows.findIndex((r) => r === document.activeElement);
			rows[((at < 0 ? 0 : at) + dir + rows.length) % rows.length].focus();
		});
		const focusRow = rows[Math.max(0, options.findIndex((o) => o.id === preselect))];
		window.setTimeout(() => focusRow.focus(), 50);

		const label = body.createEl('label', { cls: 'sg-start-default', attr: { for: tick.id } });
		label.appendChild(tick);
		label.createSpan({ text: t('entityStart.makeDefault', { kind: kindWord(this.kind) }) });

		const footer = contentEl.createDiv({ cls: 'sg-sheet-footer' });
		footer.createDiv({ cls: 'sg-sheet-footer-spacer' });
		const cancelBtn = footer.createEl('button', { cls: 'sg-sheet-btn', text: t('common.cancel') });
		cancelBtn.addEventListener('click', () => this.close());
	}

	/** Remember how this new sheet started — only once it is saved, so Cancel changes nothing. */
	private rememberStart(): void {
		const host = this.settingsHost();
		// A caller's variant (an era) is not this kind's usual sheet: its choice must not change how the next Event starts.
		if (!this.offerStart || !host || this.variant) return;
		host.settings.entityStartMode = rememberStartMode(host.settings.entityStartMode, this.kind, this.startMode);
		if (this.pendingDefault !== undefined) {
			host.settings.entityDefaultTemplate = rememberDefaultTemplate(host.settings.entityDefaultTemplate, this.kind, this.pendingDefault);
		}
		void host.saveSettings();
	}

	/** The fields a start puts on a new sheet. A template that no longer exists falls back to the guided fields. */
	private startFields(mode: StartMode, templateId: string): CharacterField[] {
		const spec = getKindSpec(this.kind);
		if (this.variant) return instantiateFields(mode === 'clean' ? this.variant.cleanSlateFields : this.variant.guidedFields, this.name);
		if (mode === 'clean') return instantiateFields(cleanSlateFieldSpecs(this.kind), this.name);
		if (templateId.startsWith('preset:')) {
			const preset = spec.presets?.find((p) => `preset:${p.name}` === templateId);
			if (preset) return instantiateFields(preset.fields, this.name);
		}
		if (templateId.startsWith('saved:')) {
			const tpl = this.savedTemplates.find((x) => `saved:${x.id}` === templateId);
			// The same field definition the side column's "Load field template" carries.
			if (tpl) return tpl.fields.map((f, i) => ({
				id: generateId(),
				label: f.label,
				type: f.type,
				value: i === 0 && NAME_LABELS.includes(f.label) ? this.name : defaultValueForType(f.type, f.config),
				prompt: f.prompt,
				config: f.config,
				category: f.category,
			}));
		}
		return instantiateFields(spec.defaultFields, this.name);
	}

	/**
	 * Rebuild the fields for a start, keeping the writer's own work: a filled
	 * field takes the place of the same empty field, or is kept after them, and
	 * a field they added themselves stays even while empty — so going "‹ Back"
	 * and choosing again never loses anything. Only the previous start's own
	 * untouched fields are dropped.
	 */
	private applyStart(mode: StartMode, templateId: string): void {
		// A pre-filled value the writer cleared stays cleared through every switch.
		for (const f of this.fields) {
			if (f.label in this.startValues && this.startFieldIds.has(f.id) && !f.value.trim()) delete this.startValues[f.label];
		}
		const next = withStartValues(this.kind, this.startFields(mode, templateId), this.startValues);
		const nextIds = new Set(next.map((f) => f.id));
		// What a start fills in by itself (the caller's start values) counts as untouched.
		const asStarted = (f: CharacterField) => !f.value.trim() || f.value === this.startValues[f.label];
		// A start's own field the writer filled keeps counting as the start's,
		// so emptying it again later lets the next switch tidy it away.
		const carriedStartIds: string[] = [];
		for (const f of this.fields) {
			const untouched = asStarted(f) || f.value === defaultValueForType(f.type, f.config);
			if (untouched && this.startFieldIds.has(f.id)) continue;
			if (this.startFieldIds.has(f.id)) carriedStartIds.push(f.id);
			// The template's name field only echoes the name box; a clean slate has none.
			if (NAME_LABELS.includes(f.label) && f.value === this.name) continue;
			const slot = next.findIndex((n) => n.label === f.label && nextIds.has(n.id) && asStarted(n));
			if (slot >= 0) next[slot] = f;
			else next.push(f);
		}
		this.fields = next;
		this.startFieldIds = new Set([...nextIds, ...carriedStartIds]);
		this.startMode = mode;
		this.templateId = mode === 'template' ? templateId : GUIDED_TEMPLATE;
		// A clean slate opens quiet: a character's Relationships stays on the
		// sheet (other sheets' relationship lines land there) but folded away.
		this.collapsed.clear();
		// A kind with a clean slate of its own (an Event's dates) opens it unfolded.
		if (mode === 'clean' && !getKindSpec(this.kind).cleanSlateFields) {
			for (const s of groupFieldsIntoSections(this.kind, this.fields)) {
				if (s.fields.every((f) => !f.value.trim())) this.collapsed.add(s.title);
			}
		}
	}

	// ─── Left rail: portrait, name, templates, progress ────────────────────────

	private renderRail(rail: HTMLElement, band: HTMLElement): void {
		const spec = getKindSpec(this.kind);

		// Portrait — the first image field, or a placeholder that creates one
		const imageFields = this.fields.filter((f) => f.type === 'image');
		const portraitField = imageFields[0] ?? null;

		const portrait = rail.createEl('button', { cls: 'sg-sheet-portrait', attr: { type: 'button' } });
		const file = portraitField?.value
			? resolveImageField(this.app, portraitField.value, this.sheetPath ?? '')
			: null;
		if (file instanceof TFile) {
			const img = portrait.createEl('img', { cls: 'sg-sheet-portrait-img' });
			img.src = this.app.vault.getResourcePath(file);
		} else {
			const ph = portrait.createDiv({ cls: 'sg-sheet-portrait-ph' });
			setPhosphorIcon(ph, spec.icon, spec.fallbackIcon);
		}
		portrait.createDiv({
			cls: 'sg-sheet-portrait-hint',
			text: file instanceof TFile ? 'Change image' : 'Add an image',
		});
		portrait.setAttr('aria-label', 'Pick an image from your computer');
		portrait.addEventListener('click', () => void this.pickImage(portraitField));

		// Name — large, focal
		const nameInput = rail.createEl('input', { cls: 'sg-sheet-name', type: 'text' });
		nameInput.id = 'sg-entity-name-input';
		nameInput.placeholder = this.variant ? `Untitled ${this.variant.singular}` : spec.defaultName;
		nameInput.value = this.name;
		nameInput.setAttr('aria-label', `${this.look().singular} name`);
		const bandTitle = band.querySelector('.sg-sheet-band-title');
		nameInput.addEventListener('input', () => {
			this.name = nameInput.value;
			if (bandTitle) bandTitle.textContent = this.name || `New ${this.look().singular}`;
			// Mirror into the first name-like field so the sheet stays consistent
			const nameField = this.fields.find((f) => ['Full Name', 'Name', 'Title', 'Topic'].includes(f.label));
			if (nameField) {
				nameField.value = this.name;
				this.updateProgress();
			}
			for (const redraw of this.ownerListeners) redraw();
		});
		if (!this.name && !Platform.isMobile) window.setTimeout(() => nameInput.focus(), 50);

		// Also known as — aliases (comma-separated)
		const aliasInput = rail.createEl('input', { cls: 'sg-sheet-aliases', type: 'text' });
		aliasInput.id = 'sg-entity-aliases-input';
		aliasInput.placeholder = 'Also known as… (comma-separated)';
		aliasInput.setAttr('aria-label', 'Also known as (comma-separated aliases)');
		aliasInput.value = this.aliases.join(', ');
		aliasInput.addEventListener('input', () => {
			this.aliases = aliasInput.value.split(',').map((a) => a.trim()).filter(Boolean);
		});

		// Basic facts — age, role, and anything short filed under the kind's first
		// section. They belong beside the portrait, not buried in the prose column.
		const railFields = this.railFactFields();
		if (railFields.length > 0) {
			const facts = rail.createDiv({ cls: 'sg-sheet-rail-facts' });
			facts.createDiv({
				cls: 'sg-sheet-rail-facts-title',
				text: getKindSpec(this.kind).sections?.[0]?.title ?? 'Basics',
			});
			railFields.forEach((field, i) => {
				this.renderFieldRow(facts, field, false, railFields, i);
			});
		}

		this.railExtra?.(rail);

		// Starting points & saved templates. A clean slate offers only the
		// writer's own saved templates, never the kind's premade presets.
		if (spec.presets && spec.presets.length > 0 && !this.offerStart && this.startMode !== 'clean') {
			const presetSelect = rail.createEl('select', { cls: 'sg-sheet-rail-select' });
			presetSelect.createEl('option', { text: 'Start from…', value: '' });
			spec.presets.forEach((p, i) => presetSelect.createEl('option', { text: p.name, value: String(i) }));
			presetSelect.addEventListener('change', () => {
				const preset = spec.presets![Number(presetSelect.value)];
				if (!preset) return;
				const applyPreset = () => {
					this.fields = instantiateFields(preset.fields, this.name);
					this.rerender();
				};
				if (this.fields.some((f) => f.value.trim())) {
					new ConfirmModal(
						this.app,
						`Starting from “${preset.name}” will replace every field value already entered on this sheet.`,
						'Replace fields',
						applyPreset
					).open();
				} else {
					applyPreset();
				}
			});
		}
		if (this.savedTemplates.length > 0 && !this.offerStart) {
			const tplSelect = rail.createEl('select', { cls: 'sg-sheet-rail-select' });
			tplSelect.createEl('option', { text: 'Load field template…', value: '' });
			this.savedTemplates.forEach((t) => tplSelect.createEl('option', { text: t.name, value: t.id }));
			tplSelect.addEventListener('change', () => {
				const tpl = this.savedTemplates.find((t) => t.id === tplSelect.value);
				if (!tpl) return;
				const applyTemplate = () => {
					// Carry the whole field definition across — dropping prompt/config/
					// category here silently stripped hover text, slider ranges, dropdown
					// choices and grouping from every template-loaded sheet.
					this.fields = tpl.fields.map((f, i) => ({
						id: generateId(),
						label: f.label,
						type: f.type,
						value: i === 0 ? this.name : defaultValueForType(f.type, f.config),
						prompt: f.prompt,
						config: f.config,
						category: f.category,
					}));
					this.rerender();
				};
				if (this.fields.some((f) => f.value.trim())) {
					new ConfirmModal(
						this.app,
						`Loading “${tpl.name}” will replace every field value already entered on this sheet.`,
						'Replace fields',
						applyTemplate
					).open();
				} else {
					applyTemplate();
				}
			});
		}

		// Additional images beyond the portrait stay reachable
		for (const extra of imageFields.slice(1)) {
			const row = rail.createDiv({ cls: 'sg-sheet-extra-image' });
			row.createSpan({ cls: 'sg-sheet-extra-image-label', text: extra.label });
			const btn = row.createEl('button', { cls: 'sg-sheet-btn sg-sheet-btn--ghost sg-sheet-btn--small', text: extra.value ? 'Change' : 'Pick…' });
			btn.addEventListener('click', () => void this.pickImage(extra));
		}
	}

	private async pickImage(field: CharacterField | null): Promise<void> {
		const picker = document.createElement('input');
		picker.type = 'file';
		picker.accept = 'image/*';
		picker.onchange = async () => {
			const f = picker.files?.[0];
			if (!f) return;
			try {
				const created = await this.importImage(f);
				if (field) {
					field.value = created.path;
				} else {
					const spec = getKindSpec(this.kind);
					const label = spec.defaultFields.find((df) => df.type === 'image')?.label ?? 'Image';
					this.fields.push({ id: generateId(), label, value: created.path, type: 'image' });
				}
				this.rerender();
			} catch (err) {
				new Notice(`Plotverk: Could not import image. ${err instanceof Error ? err.message : ''}`);
			}
		};
		picker.click();
	}

	private isNewSheet(): boolean {
		return this.sheetPath === null;
	}

	/**
	 * Where a picture added in this editor belongs. An existing sheet: its own
	 * folder. A new sheet: the folder of the name it will most likely get
	 * (the same "Name", "Name 2" rule `createEntityFile` uses); the save
	 * moves it if the final name differs.
	 */
	private imageTarget(): SheetImageTarget | null {
		if (this.sheetPath) {
			const sheet = this.app.vault.getAbstractFileByPath(this.sheetPath);
			if (sheet instanceof TFile) return targetForSheet(this.app, sheet);
		}
		if (this.projectRoot === null) return null;
		const folder = entityFolderPath(this.projectRoot, this.kind);
		const safe = this.name.trim().replace(/[\\/:*?"<>|#^[\]]/g, '-') || localizedDefaultName(this.kind);
		let sheetName = safe;
		for (let n = 2; this.app.vault.getAbstractFileByPath(`${folder}/${sheetName}.md`); n++) sheetName = `${safe} ${n}`;
		return { projectRoot: this.projectRoot, kind: this.kind, sheetName, sourcePath: `${folder}/${sheetName}.md` };
	}

	/** Every picture this editor imports (portrait, image fields, drops) comes through here. */
	private async importImage(file: File): Promise<TFile> {
		const created = await saveImageForSheet(this.app, file, this.imageTarget());
		this.uploaded.push(created);
		return created;
	}

	// ─── Sections ──────────────────────────────────────────────────────────────

	private renderSections(main: HTMLElement): void {
		const spec = getKindSpec(this.kind);
		// Labels the registry knows for this kind — these get clean static labels;
		// everything else (custom fields) gets an editable label + type control.
		const knownLabels = new Set([
			...spec.defaultFields.map((f) => f.label),
			...(spec.presets ?? []).flatMap((p) => p.fields.map((f) => f.label)),
			...(spec.extraFieldSets ?? []).flat().map((f) => f.label),
		]);

		// The progress line describes the form, so it heads the form — it used to
		// sit in the portrait rail, where it read as a caption for the picture.
		this.progressEl = main.createDiv({ cls: 'sg-sheet-progress' });
		this.updateProgress();

		// Fields shown in the rail must not appear twice.
		const railIds = new Set(this.railFactFields().map((f) => f.id));
		const sections = groupFieldsIntoSections(this.kind, this.fields)
			.map((s) => ({ ...s, fields: s.fields.filter((f) => !railIds.has(f.id)) }))
			.filter((s) => s.fields.length > 0);

		sections.forEach((section, sectionIndex) => {
			const secEl = main.createDiv({ cls: 'sg-sheet-section' });
			if (this.collapsed.has(section.title)) secEl.addClass('is-collapsed');

			const head = secEl.createDiv({ cls: 'sg-sheet-section-head' });
			const iconEl = head.createSpan({ cls: 'sg-sheet-section-icon' });
			setPhosphorIcon(iconEl, section.icon, '◆');
			head.createSpan({ cls: 'sg-sheet-section-title', text: section.title });
			const filled = section.fields.filter((f) => f.value.trim()).length;
			head.createSpan({ cls: 'sg-sheet-section-count', text: `${filled}/${section.fields.length}` });

			const more = head.createEl('button', { cls: 'sg-sheet-section-more', attr: { type: 'button' } });
			setPhosphorIcon(more, 'dots-three', '⋯');
			more.setAttr('aria-label', `More options for “${section.title}”`);
			more.addEventListener('click', (e) => {
				e.stopPropagation();
				this.showSectionMenu(e, sections, sectionIndex);
			});

			const chevron = head.createSpan({ cls: 'sg-sheet-section-chevron', text: '›' });
			void chevron;
			head.addEventListener('click', () => {
				if (this.collapsed.has(section.title)) this.collapsed.delete(section.title);
				else this.collapsed.add(section.title);
				secEl.toggleClass('is-collapsed', this.collapsed.has(section.title));
			});

			const bodyEl = secEl.createDiv({ cls: 'sg-sheet-section-body' });
			// Live-insert the dragging field row by cursor position, same technique
			// as the Dashboard's column drag — the actual data model is only
			// updated once, from the final DOM order, on the handle's dragend.
			bodyEl.addEventListener('dragover', (e: DragEvent) => {
				e.preventDefault();
				const dragging = bodyEl.querySelector<HTMLElement>(':scope > .sg-sheet-field.is-dragging');
				if (!dragging || !this.dragFieldRects) return;
				// Rects are cached once at dragstart (see the drag handle below)
				// instead of being re-queried and re-measured on every dragover.
				const next = this.dragFieldRects.find(({ rect: r }) => e.clientY <= r.top + r.height / 2);
				bodyEl.insertBefore(dragging, next?.el ?? null);
			});
			bodyEl.addEventListener('dragenter', (e: DragEvent) => e.preventDefault());

			section.fields.forEach((field, i) => {
				this.renderFieldRow(bodyEl, field, !knownLabels.has(field.label), section.fields, i);
			});
		});

		if (this.fieldCreatorOpen) {
			// Opening the creator rebuilds the sheet, which sends the scroll back
			// to the top — so the card has to carry the view down to itself.
			const creatorCard = renderFieldCreatorCard(main, {
				staged: true,
				categories: this.existingCategories(),
				// The sections actually on the sheet, so step 1 offers what the
				// user can see in front of them rather than saved templates.
				sections: sections.map((s) => s.title),
				catalog: fieldCatalogForKind(this.kind, this.fields.map((f) => f.label)),
				onSubmit: (result) => {
					const id = generateId();
					this.fields.push({
						id,
						label: result.label,
						value: defaultValueForType(result.type, result.config),
						type: result.type,
						prompt: result.prompt,
						config: result.config,
						category: result.category,
					});
					// A new field must be seen: unfold the section it landed in
					// (a clean slate starts with its sections folded).
					const home = groupFieldsIntoSections(this.kind, this.fields).find((s) => s.fields.some((f) => f.id === id));
					if (home) this.collapsed.delete(home.title);
					this.fieldCreatorOpen = false;
					this.rerender();
				},
				onCancel: () => {
					this.fieldCreatorOpen = false;
					this.rerender();
				},
			});
			window.setTimeout(
				() => creatorCard.scrollIntoView({ block: 'center', behavior: 'smooth' }),
				40
			);
		} else {
			// "Add field" belongs at the end of the list it adds to, not in the
			// footer beside Save — that distance is what made the sheet appear to
			// jump when the card opened somewhere else entirely.
			const addRow = main.createDiv({ cls: 'sg-sheet-addfield-row' });
			const addBtn = addRow.createEl('button', {
				cls: 'sg-sheet-btn sg-sheet-btn--ghost sg-sheet-addfield',
				text: '+ Add field',
			});
			addBtn.addEventListener('click', () => {
				this.fieldCreatorOpen = true;
				this.rerender();
			});
		}

		this.renderSuggestedFields(main);
	}

	/**
	 * The short factual fields that live in the rail: the kind's first section
	 * (Identity, Essentials…) minus anything long-form and minus the name, which
	 * the rail's own big name input already owns. Deliberately section-based
	 * rather than type-based — Want, Need and Flaw are single-line text fields
	 * too, and they are the heart of the sheet, not basic facts.
	 */
	private railFactFields(): CharacterField[] {
		const first = getKindSpec(this.kind).sections?.[0];
		if (!first) return [];
		const inFirst = new Set(first.fields);
		const longForm = new Set(['textarea', 'list', 'table', 'image', 'matrix']);
		const nameMirrors = new Set(['Full Name', 'Name', 'Title', 'Topic']);
		return this.fields.filter(
			(f) => inFirst.has(f.label) && !longForm.has(f.type) && !nameMirrors.has(f.label)
		);
	}

	/** Categories already in use for this kind — current fields plus any saved templates' category lists. */
	private existingCategories(): string[] {
		const set = new Set<string>();
		for (const f of this.fields) if (f.category) set.add(f.category);
		for (const t of this.savedTemplates) for (const c of t.categories ?? []) set.add(c.title);
		return [...set].sort();
	}

	/** One-click "Explore deeper" chips for spec.suggestedFields not yet in the form. */
	private renderSuggestedFields(main: HTMLElement): void {
		const spec = getKindSpec(this.kind);
		const suggested = spec.suggestedFields ?? [];
		// A clean slate is the writer's own page; "+ Add field" is their way in.
		if (suggested.length === 0 || this.startMode === 'clean') return;

		const existing = new Set(this.fields.map((f) => f.label.toLowerCase()));
		const available = suggested.filter((s) => !existing.has(s.label.toLowerCase()));
		if (available.length === 0) return;

		const wrap = main.createDiv({ cls: 'sg-sheet-suggested' });
		wrap.createDiv({ cls: 'sg-sheet-suggested-title', text: 'Explore deeper' });
		const chips = wrap.createDiv({ cls: 'sg-sheet-suggested-chips' });
		for (const s of available) {
			const chip = chips.createEl('button', { cls: 'sg-sheet-suggested-chip' });
			const icon = chip.createSpan({ cls: 'sg-sheet-suggested-chip-icon' });
			setPhosphorIcon(icon, iconForCustomLabel(s.label), '+');
			chip.createSpan({ text: s.label });
			chip.title = s.prompt;
			chip.addEventListener('click', () => {
				this.fields.push({ id: generateId(), label: s.label, value: defaultValueForType(s.type), type: s.type });
				this.rerender();
			});
		}
	}

	/**
	 * An Event's End Date only shows once "How Long" says "Lasts a while"
	 * (kept calm: a moment has no end to fill in). A sheet without a How Long
	 * field (written before it existed) always shows its End Date. Pass the
	 * row while it is being built; otherwise it is looked up.
	 */
	private syncEventEndDate(row?: HTMLElement): void {
		if (this.kind !== 'event') return;
		const byLabel = (label: string) => this.fields.find((x) => x.label.trim().toLowerCase() === label);
		const endDate = byLabel('end date');
		if (!endDate) return;
		const el = row ?? this.contentEl.querySelector<HTMLElement>(`.sg-sheet-field[data-field-id="${CSS.escape(endDate.id)}"]`);
		if (!el) return;
		el.style.display = this.isEventEndDateHidden() ? 'none' : '';
		this.updateProgress();
	}

	/** An Event's End Date is hidden (and not counted) unless How Long says it lasts; a sheet without How Long always shows it. */
	private isEventEndDateHidden(field?: CharacterField): boolean {
		if (this.kind !== 'event') return false;
		const byLabel = (label: string) => this.fields.find((x) => x.label.trim().toLowerCase() === label);
		const endDate = byLabel('end date');
		if (!endDate || (field && field !== endDate)) return false;
		const howLong = byLabel('how long');
		return !!howLong && eventDurationFrom(howLong.value, !!endDate.value?.trim()) === 'moment';
	}

	private renderFieldRow(
		parent: HTMLElement,
		field: CharacterField,
		isCustom: boolean,
		siblings: CharacterField[] = [],
		indexInSection = 0
	): void {
		const row = parent.createDiv({ cls: 'sg-sheet-field' });
		row.setAttr('data-field-id', field.id);
		if (field.config?.tint) row.setAttr('data-tint', field.config.tint);
		const labelRow = row.createDiv({ cls: 'sg-sheet-field-labelrow' });

		// Drag-to-reorder handle. Desktop only — touch doesn't fire native HTML5
		// drag events reliably, and mobile already has Move up/down in the ⋯ menu.
		// Only the handle itself is draggable (not the row), so dragging inside a
		// field's own input/textarea to select text is never mistaken for a reorder.
		if (!Platform.isMobile) {
			row.addClass('has-drag');
			const handle = labelRow.createSpan({ cls: 'sg-sheet-field-drag' });
			setPhosphorIcon(handle, 'dots-six-vertical', '⠿');
			handle.setAttr('aria-label', 'Drag to reorder');
			handle.draggable = true;
			handle.addEventListener('dragstart', (e) => {
				row.addClass('is-dragging');
				// Cache every other field's rect once, up front — the section
				// body's dragover handler reads this instead of re-querying and
				// re-measuring every sibling on every dragover event.
				this.dragFieldRects = [...parent.querySelectorAll<HTMLElement>(':scope > .sg-sheet-field:not(.is-dragging)')]
					.map((el) => ({ el, rect: el.getBoundingClientRect() }));
				e.dataTransfer?.setData('text/plain', field.id);
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';

				const ghost = document.createElement('div');
				ghost.textContent = field.label || 'Field';
				Object.assign(ghost.style, {
					position: 'fixed', top: '-9999px', left: '-9999px',
					padding: '6px 12px',
					background: 'var(--background-primary)',
					border: '1px dashed var(--interactive-accent)',
					borderRadius: '6px',
					color: 'var(--text-normal)',
					fontSize: '12px', fontWeight: '600',
					pointerEvents: 'none', boxSizing: 'border-box',
				});
				document.body.appendChild(ghost);
				e.dataTransfer?.setDragImage(ghost, 20, 14);
				window.setTimeout(() => {
					if (document.body.contains(ghost)) document.body.removeChild(ghost);
				}, 0);
			});
			handle.addEventListener('dragend', () => {
				row.removeClass('is-dragging');
				const orderedIds = [...parent.querySelectorAll<HTMLElement>(':scope > .sg-sheet-field[data-field-id]')]
					.map((el) => el.dataset.fieldId!)
					.filter(Boolean);
				this.applyFieldOrder(orderedIds);
				this.dragFieldRects = null;
				this.rerender();
			});
		}

		if (isCustom) {
			const labelInput = labelRow.createEl('input', { cls: 'sg-sheet-field-labelinput', type: 'text' });
			labelInput.placeholder = 'Field name';
			labelInput.value = field.label;
			// Size to content so the label hugs its text and the help icon sits
			// right beside it, exactly like a static built-in label.
			const fitLabel = () => {
				labelInput.size = Math.max(6, (labelInput.value || labelInput.placeholder).length + 1);
			};
			fitLabel();
			labelInput.addEventListener('input', fitLabel);
			labelInput.addEventListener('change', () => { field.label = labelInput.value; });
		} else {
			labelRow.createSpan({ cls: 'sg-sheet-field-label', text: field.label });
		}

		const prompt = getFieldPrompt(this.kind, field.label) || field.prompt || '';
		if (prompt) renderHoverHelp(labelRow, prompt);

		const more = labelRow.createEl('button', { cls: 'sg-sheet-field-more', attr: { type: 'button' } });
		setPhosphorIcon(more, 'dots-three', '⋯');
		more.setAttr('aria-label', `More options for “${field.label || 'this field'}”`);
		more.addEventListener('click', (e) => {
			e.stopPropagation();
			this.showFieldMenu(e, field, siblings, indexInSection);
		});

		const result = renderFieldWidget(row, field, 'edit', {
			app: this.app,
			onChange: (value) => {
				field.value = value;
				this.updateProgress();
				// The relationship preview writes Mother or Father by this sheet's Gender.
				if (field.label.trim().toLowerCase() === 'gender') for (const redraw of this.ownerListeners) redraw();
				if (field.label.trim().toLowerCase() === 'how long') this.syncEventEndDate();
			},
			onConfigChange: (config) => { field.config = config; },
			projectRoot: this.projectRoot,
			prompt,
			saveImage: async (file) => (await this.importImage(file)).path,
		});

		if (this.kind === 'event' && field.label.trim().toLowerCase() === 'end date') this.syncEventEndDate(row);

		// Text and textarea already surface the prompt as placeholder text; every
		// other widget (slider, chart, dropdown, date…) has nowhere to show it, so
		// hover the control itself.
		if (prompt && field.type !== 'text' && field.type !== 'textarea') {
			setTooltip(result.el, prompt, { placement: 'top' });
		}

		// Quick relationship adder for any textarea field whose label contains "relationship"
		if (field.type === 'textarea' && result.textareaEl && /relationship/i.test(field.label)) {
			const ta = result.textareaEl;
			const relAdd = row.createDiv({ cls: 'sg-sheet-rel-add' });
			const sentenceEl = relAdd.createDiv({ cls: 'sg-sheet-rel-add-sentence' });
			const previewEl = relAdd.createDiv({ cls: 'sg-sheet-rel-add-preview' });
			const relWizardHost = row.createDiv({ cls: 'sg-rtw-host' });
			relWizardHost.setCssStyles({ display: 'none' });

			// Relationship-type dropdown (custom types first, then common words,
			// then — when a plugin reference is available — a way to define a new one).
			// It sits inside the sentence below, wherever the language puts the word.
			const NEW_TYPE_VALUE = '__new__';
			const relSelect = createEl('select', { cls: 'sg-sheet-rel-add-select' });
			const populateRelSelect = (): void => {
				relSelect.empty();
				this.relationChoices.forEach((c, i) => {
					relSelect.createEl('option', { text: c.label, value: String(i) });
				});
				if (this.plugin) {
					relSelect.createEl('option', { text: '+ New relationship type…', value: NEW_TYPE_VALUE });
				}
			};
			populateRelSelect();
			// The last real word picked: while "+ New relationship type…" is showing,
			// Add and the preview keep using it rather than whatever is first in the list.
			let wordIndex = 0;
			const chosen = (): RelationChoice => this.relationChoices[wordIndex] ?? this.relationChoices[0];

			const appendLine = (label: string, name: string) => {
				const line = `${label}: [[${name}]]`;
				field.value = field.value.trim() ? `${field.value.trim()}\n${line}` : line;
				// Drive the widget through its own 'input' handler so grow() and
				// onChange() stay in one place instead of being duplicated here.
				ta.value = field.value;
				ta.dispatchEvent(new Event('input'));
			};

			// One sentence, person first: "[Pick a person…] is Konrad’s [Child ▾]".
			// The word names the PICKED person's role (that is how the line is
			// stored), so the row says it that way round — the old "Child to
			// [Tobin]" read as the opposite. A picked person waits for "Add", with
			// a line underneath saying what their sheet will get on save; Save adds
			// one still waiting, so the preview never promises what isn't written.
			const isCharacter = this.kind === 'character';
			const customTypes = this.plugin?.settings.customRelationshipTypes ?? [];
			const pending = (): { name: string; word: string; picked: boolean } | undefined => this.pendingRelations.get(field.id);
			const setPending = (name: string, picked = pending()?.picked ?? false): void => {
				if (name) this.pendingRelations.set(field.id, { name, word: chosen().label, picked });
				else this.pendingRelations.delete(field.id);
			};
			// A redraw (a field added, the sheet reordered) keeps the waiting person and word.
			const restored = pending();
			if (restored) {
				const idx = this.relationChoices.findIndex((c) => c.label === restored.word);
				if (idx >= 0) wordIndex = idx;
			}
			relSelect.value = String(wordIndex);
			const nameInput = this.projectRoot ? null : createEl('input', { cls: 'sg-sheet-rel-add-input', type: 'text' });
			if (nameInput) nameInput.value = restored?.name ?? '';
			const addBtn = createEl('button', { cls: 'sg-sheet-btn sg-sheet-btn--primary sg-sheet-btn--small sg-sheet-rel-add-go', text: t('rel.add.button') });
			const otherName = (): string => pending()?.name ?? '';

			// The save's own resolver: same sheet lookup (from where this sheet is or
			// will be saved), same word, same Gender.
			const resolve = (other: string) => {
				const ownPath = this.sheetPath ?? this.imageTarget()?.sourcePath ?? '';
				const m = mirrorTarget(this.app, customTypes, {
					path: ownPath,
					kind: this.kind,
					gender: genderFromFields(this.fields),
					projectRoot: this.projectRoot,
				}, { label: chosen().label, target: other });
				const self = !!ownPath && this.app.metadataCache.getFirstLinkpathDest(other, ownPath)?.path === ownPath;
				const kind: unknown = m.file ? this.app.metadataCache.getFileCache(m.file)?.frontmatter?.['storygrid-type'] : null;
				return { ...m, self, targetKind: typeof kind === 'string' ? kind as EntityKind : null };
			};
			// The name the link on the other sheet will carry: this sheet's file name after Save.
			const savedName = (): string => (this.sheetPath ? this.name.trim() : this.imageTarget()?.sheetName ?? this.name);

			const renderPreview = (): void => {
				previewEl.empty();
				const other = otherName();
				previewEl.toggleClass('is-hidden', !other);
				if (!other) return;
				const m = resolve(other);
				previewEl.createSpan({ cls: 'sg-sheet-rel-add-preview-arrow', text: '→' });
				previewEl.createSpan({
					cls: 'sg-sheet-rel-add-preview-text',
					text: mirrorPreviewText(other, savedName(), m.word, getLocale(), m.self ? 'self' : m.file ? 'oneWay' : 'noSheet', { isCharacter }),
				});
			};

			const renderAdder = (): void => {
				sentenceEl.empty();
				const other = otherName();
				const target = other ? resolve(other) : null;
				const shape = sentenceShapeFor(chosen().label, { customTypes, ownerKind: this.kind, targetKind: target?.targetKind });
				const parts = relationSentenceParts(this.name, chosen().label, getLocale(), { isCharacter, otherName: other, shape });
				for (const part of parts) {
					if (part.type === 'text') {
						const text = part.text.trim();
						if (text) sentenceEl.createSpan({ cls: 'sg-sheet-rel-add-text', text });
					} else if (part.type === 'word') {
						sentenceEl.appendChild(relSelect);
					} else if (nameInput) {
						sentenceEl.appendChild(nameInput);
					} else {
						const pickBtn = sentenceEl.createEl('button', {
							cls: `sg-sheet-btn sg-sheet-btn--small sg-sheet-rel-add-pick${other ? ' is-picked' : ' sg-sheet-btn--ghost'}`,
							text: other || t('rel.add.pick'),
						});
						if (other) pickBtn.setAttr('aria-label', t('rel.add.change'));
						pickBtn.addEventListener('click', () => {
							const RELATION_KINDS: EntityKind[] = [
								'character', 'location', 'faction', 'system', 'item', 'research',
							];
							new EntityPickerModal(this.app, this.projectRoot!, RELATION_KINDS, (file: TFile) => {
								setPending(file.basename, true);
								renderAdder();
							}).open();
						});
					}
				}
				sentenceEl.appendChild(addBtn);
				addBtn.disabled = !other || !!target?.self;
				renderPreview();
			};

			const openTypeWizard = (): void => {
				if (!this.plugin) return;
				const plugin = this.plugin;
				relWizardHost.setCssStyles({ display: '' });
				mountRelTypeWizard(relWizardHost, plugin, {
					onCreated: (created) => {
						this.relationChoices = relationChoices(plugin.settings.customRelationshipTypes);
						populateRelSelect();
						const idx = this.relationChoices.findIndex((c) => c.label === created[0].label);
						wordIndex = idx >= 0 ? idx : 0;
						relSelect.value = String(wordIndex);
						relWizardHost.empty();
						relWizardHost.setCssStyles({ display: 'none' });
						setPending(otherName());
						renderAdder();
					},
					onCancel: () => {
						relWizardHost.empty();
						relWizardHost.setCssStyles({ display: 'none' });
						relSelect.value = String(wordIndex);
						renderAdder();
					},
				});
			};

			relSelect.addEventListener('change', () => {
				if (relSelect.value === NEW_TYPE_VALUE) {
					openTypeWizard();
					return;
				}
				wordIndex = Number(relSelect.value);
				setPending(otherName());
				renderAdder();
			});

			if (nameInput) {
				// Fallback: manual name entry when no project context is available.
				nameInput.placeholder = t('rel.add.namePlaceholder');
				nameInput.addEventListener('input', () => {
					setPending(nameInput.value.trim(), false);
					const name = otherName();
					addBtn.disabled = !name || resolve(name).self;
					renderPreview();
				});
				// The sentence's shape can depend on who was typed (a group): redraw once typing stops.
				nameInput.addEventListener('change', () => renderAdder());
				nameInput.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
				});
			}

			addBtn.addEventListener('click', () => {
				const name = otherName();
				if (!name || resolve(name).self) return;
				// The other sheet gets the matching line when this one is saved.
				appendLine(chosen().label, name);
				setPending('');
				if (nameInput) nameInput.value = '';
				renderAdder();
			});

			if (this.plugin) {
				// Visible sibling to the dropdown's own "+ New relationship type…"
				// option — on its own line under the sentence, deliberately away
				// from the person and "Add" so the common action and the rare one
				// don't sit next to each other and get confused.
				const newTypeBtn = relAdd.createEl('button', {
					cls: 'sg-sheet-btn sg-sheet-btn--ghost sg-sheet-btn--small sg-sheet-rel-add-newtype',
					text: '+ New relationship type',
				});
				newTypeBtn.addEventListener('click', () => openTypeWizard());
			}

			renderAdder();

			// Structured relationship rows replace the raw textarea's DISPLAY
			// only — the textarea stays in the DOM (hidden inside the editor)
			// as the single source of truth, and the quick-add row above is
			// adopted into the editor's layout unchanged.
			const relEditor = mountRelationshipEditor(row, {
				app: this.app,
				plugin: this.plugin,
				projectRoot: this.projectRoot,
				getOwnerName: () => this.name,
				ownerKind: this.kind,
				textarea: ta,
				adderEl: relAdd,
			});
			// The sentences name this sheet, and the preview uses its Gender: keep both current.
			this.ownerListeners.push(() => {
				renderAdder();
				relEditor.relabel();
			});
			// The editor mounted after the wizard host — push the host back to
			// the bottom so the "+ New relationship type" form unfolds below
			// the adder that opened it, same as before.
			row.appendChild(relWizardHost);
		}
	}

	// ─── Field and group menus ─────────────────────────────────────────────────

	/** Swap `field` with the sibling `delta` places away inside its own section. */
	private moveField(field: CharacterField, siblings: CharacterField[], indexInSection: number, delta: number): void {
		const neighbour = siblings[indexInSection + delta];
		if (!neighbour) return;
		const a = this.fields.indexOf(field);
		const b = this.fields.indexOf(neighbour);
		if (a < 0 || b < 0) return;
		[this.fields[a], this.fields[b]] = [this.fields[b], this.fields[a]];
		this.rerender();
	}

	/**
	 * Applies a drag-reordered section's final DOM order back to `this.fields`.
	 * The section's own fields move to reflect `orderedIds`; every other field
	 * keeps its existing relative position around them.
	 */
	private applyFieldOrder(orderedIds: string[]): void {
		const idSet = new Set(orderedIds);
		const idToField = new Map(this.fields.map((f) => [f.id, f]));
		const reordered = orderedIds.map((id) => idToField.get(id)).filter((f): f is CharacterField => !!f);
		if (reordered.length !== orderedIds.length) return;

		const others = this.fields.filter((f) => !idSet.has(f.id));
		let insertAt = 0;
		for (const f of this.fields) {
			if (idSet.has(f.id)) break;
			insertAt++;
		}
		this.fields = [...others.slice(0, insertAt), ...reordered, ...others.slice(insertAt)];
	}

	private setTint(fields: CharacterField[], tint: FieldTint | null): void {
		for (const f of fields) {
			const config: FieldConfig = { ...(f.config ?? {}) };
			if (tint) config.tint = tint;
			else delete config.tint;
			f.config = Object.keys(config).length > 0 ? config : undefined;
		}
		this.rerender();
	}

	/**
	 * Add the shared "Background" choices. Submenus are not part of Obsidian's
	 * published API, so this uses one when the running version offers it and
	 * falls back to flat "Background: Blue" items when it does not.
	 */
	private addTintItems(menu: Menu, fields: CharacterField[]): void {
		const choices: Array<{ label: string; tint: FieldTint | null }> = [
			{ label: 'None', tint: null },
			...FIELD_TINTS.map((t) => ({ label: t.label, tint: t.id as FieldTint | null })),
		];

		let nested = false;
		menu.addItem((item) => {
			item.setTitle('Background').setIcon('palette');
			const maybe = item as unknown as { setSubmenu?: () => Menu };
			if (typeof maybe.setSubmenu !== 'function') return;
			nested = true;
			const sub = maybe.setSubmenu();
			for (const c of choices) {
				sub.addItem((i) => i.setTitle(c.label).onClick(() => this.setTint(fields, c.tint)));
			}
		});
		if (nested) return;

		for (const c of choices) {
			menu.addItem((i) => i.setTitle(`Background: ${c.label}`)
				.onClick(() => this.setTint(fields, c.tint)));
		}
	}

	private showFieldMenu(
		e: MouseEvent,
		field: CharacterField,
		siblings: CharacterField[],
		indexInSection: number
	): void {
		const menu = new Menu();

		menu.addItem((item) => item.setTitle('Rename…').setIcon('pencil').onClick(() => {
			new TextPromptModal(this.app, 'Field name', field.label, (name) => {
				const trimmed = name.trim();
				if (!trimmed) return;
				field.label = trimmed;
				this.rerender();
			}).open();
		}));

		menu.addItem((item) => item.setTitle('Edit hover text…').setIcon('help-circle').onClick(() => {
			new TextPromptModal(this.app, 'Hover text', field.prompt ?? '', (text) => {
				field.prompt = text.trim() || undefined;
				this.rerender();
			}).open();
		}));

		menu.addSeparator();

		if (indexInSection > 0) {
			menu.addItem((item) => item.setTitle('Move up').setIcon('arrow-up')
				.onClick(() => this.moveField(field, siblings, indexInSection, -1)));
		}
		if (indexInSection < siblings.length - 1) {
			menu.addItem((item) => item.setTitle('Move down').setIcon('arrow-down')
				.onClick(() => this.moveField(field, siblings, indexInSection, 1)));
		}

		this.addTintItems(menu, [field]);

		menu.addSeparator();

		menu.addItem((item) => item.setTitle('Duplicate').setIcon('copy').onClick(() => {
			const idx = this.fields.indexOf(field);
			this.fields.splice(idx + 1, 0, {
				...field,
				id: generateId(),
				label: `${field.label} copy`,
				config: field.config ? { ...field.config } : undefined,
			});
			this.rerender();
		}));

		menu.addItem((item) => item.setTitle('Copy field').setIcon('clipboard-copy').onClick(() => {
			fieldClipboard = { ...field, config: field.config ? { ...field.config } : undefined };
			new Notice(`Plotverk: copied “${field.label}”. Paste it on any sheet.`);
		}));

		if (fieldClipboard) {
			const pasted = fieldClipboard;
			menu.addItem((item) => item.setTitle(`Paste “${pasted.label}”`).setIcon('clipboard-paste').onClick(() => {
				const idx = this.fields.indexOf(field);
				this.fields.splice(idx + 1, 0, {
					...pasted,
					id: generateId(),
					category: field.category,
					config: pasted.config ? { ...pasted.config } : undefined,
				});
				this.rerender();
			}));
		}

		menu.addSeparator();

		menu.addItem((item) => item.setTitle('Remove field').setIcon('trash').onClick(() => {
			const idx = this.fields.indexOf(field);
			if (idx >= 0) this.fields.splice(idx, 1);
			this.rerender();
		}));

		menu.showAtMouseEvent(e);
	}

	private showSectionMenu(e: MouseEvent, sections: GroupedSection[], index: number): void {
		const section = sections[index];
		const menu = new Menu();
		// Only groups the user made are renameable or movable — the kind's own
		// sections come from the registry and are the same on every sheet.
		const isCustomGroup = section.fields.every((f) => f.category === section.title);

		if (isCustomGroup) {
			menu.addItem((item) => item.setTitle('Rename group…').setIcon('pencil').onClick(() => {
				new TextPromptModal(this.app, 'Group name', section.title, (name) => {
					const trimmed = name.trim();
					if (!trimmed) return;
					for (const f of section.fields) f.category = trimmed;
					this.collapsed.delete(section.title);
					this.rerender();
				}).open();
			}));

			const swapWith = (other: GroupedSection) => {
				// Groups are ordered by where their fields first appear, so moving a
				// group means moving its whole block of fields past the neighbour's.
				const rest = this.fields.filter(
					(f) => !section.fields.includes(f) && !other.fields.includes(f)
				);
				const anchor = this.fields.findIndex(
					(f) => section.fields.includes(f) || other.fields.includes(f)
				);
				const before = rest.filter((f) => this.fields.indexOf(f) < anchor);
				const after = rest.filter((f) => this.fields.indexOf(f) > anchor);
				this.fields = [...before, ...other.fields, ...section.fields, ...after];
				this.rerender();
			};

			const prev = sections[index - 1];
			if (prev && prev.fields.every((f) => f.category === prev.title)) {
				menu.addItem((item) => item.setTitle('Move group up').setIcon('arrow-up')
					.onClick(() => swapWith(prev)));
			}
			const next = sections[index + 1];
			if (next && next.fields.every((f) => f.category === next.title)) {
				menu.addItem((item) => item.setTitle('Move group down').setIcon('arrow-down')
					.onClick(() => {
						const rest = this.fields.filter(
							(f) => !section.fields.includes(f) && !next.fields.includes(f)
						);
						const anchor = this.fields.findIndex(
							(f) => section.fields.includes(f) || next.fields.includes(f)
						);
						const before = rest.filter((f) => this.fields.indexOf(f) < anchor);
						const after = rest.filter((f) => this.fields.indexOf(f) > anchor);
						this.fields = [...before, ...next.fields, ...section.fields, ...after];
						this.rerender();
					}));
			}
		}

		this.addTintItems(menu, section.fields);

		menu.addItem((item) => item.setTitle('Copy all fields').setIcon('clipboard-copy').onClick(() => {
			groupClipboard = section.fields.map((f) => ({
				...f, config: f.config ? { ...f.config } : undefined,
			}));
			new Notice(`Plotverk: copied ${section.fields.length} field${section.fields.length === 1 ? '' : 's'} from “${section.title}”.`);
		}));

		if (groupClipboard && groupClipboard.length > 0) {
			const pasted = groupClipboard;
			menu.addItem((item) => item.setTitle(`Paste ${pasted.length} field${pasted.length === 1 ? '' : 's'} here`)
				.setIcon('clipboard-paste').onClick(() => {
					for (const f of pasted) {
						this.fields.push({
							...f,
							id: generateId(),
							category: isCustomGroup ? section.title : f.category,
							config: f.config ? { ...f.config } : undefined,
						});
					}
					this.rerender();
				}));
		}

		if (isCustomGroup) {
			menu.addSeparator();
			// Ungroup rather than delete — losing a group should never lose writing.
			menu.addItem((item) => item.setTitle('Ungroup (keeps the fields)').setIcon('folder-minus').onClick(() => {
				for (const f of section.fields) f.category = undefined;
				this.rerender();
			}));
		}

		menu.showAtMouseEvent(e);
	}

	/**
	 * Make the other sheets agree with this one: every relationship line added,
	 * changed or removed since the editor opened writes, rewrites or removes the
	 * matching line on the other sheet ("Grandmother: [[Tull]]" here →
	 * "Grandchild: [[Mara]]" on Tull's). Typed link fields ("Father", "Allies")
	 * count too — they read as `Father: [[Name]]` lines everywhere else.
	 *
	 * Only Plotverk sheets (in this project, when there is one) are written to.
	 * One-way feelings and character → world links write nothing back. New words
	 * use this sheet's Gender at save; a Gender change itself is reworded on the
	 * other sheets by RelationSync, which sees the saved file change.
	 */
	private async mirrorRelationChanges(owner: TFile, after: RelationLine[], gender: MirrorGender): Promise<void> {
		await mirrorRelationChanges(this.app, this.plugin?.settings.customRelationshipTypes ?? [], {
			path: owner.path,
			basename: owner.basename,
			kind: this.kind,
			gender,
			exists: true,
			oldNames: this.namesAtOpen,
			projectRoot: this.projectRoot,
		}, this.relationsAtOpen, after);
	}

	/**
	 * A person picked in a relationship row but never confirmed with Add: the
	 * preview already said what their sheet will get, so Save adds the line
	 * rather than dropping it silently. Only a sheet picked from the list — a
	 * half-typed name in the fallback box is not a decision — and never this
	 * sheet itself.
	 */
	private addPendingRelations(): void {
		const ownPath = this.sheetPath ?? this.imageTarget()?.sourcePath ?? '';
		for (const [fieldId, p] of this.pendingRelations) {
			const f = this.fields.find((x) => x.id === fieldId);
			if (!f || !p.picked || !p.name.trim()) continue;
			if (ownPath && this.app.metadataCache.getFirstLinkpathDest(p.name.trim(), ownPath)?.path === ownPath) continue;
			const line = `${p.word}: [[${p.name.trim()}]]`;
			f.value = f.value.trim() ? `${f.value.trim()}\n${line}` : line;
		}
		this.pendingRelations.clear();
	}

	private updateProgress(): void {
		if (!this.progressEl) return;
		const editable = this.fields.filter((f) => f.type !== 'image' && !this.isEventEndDateHidden(f));
		const filled = editable.filter((f) => f.value.trim()).length;
		this.progressEl.textContent = `${filled} of ${editable.length} fields filled`;
		// A clean slate with no fields yet has nothing to count.
		this.progressEl.toggleClass('is-hidden', editable.length === 0);
	}

	onClose(): void {
		this.contentEl.empty();
		// Cancel means nothing changed: pictures imported in this editor go to the
		// trash (recoverable there). Only ones still unused — a picture the save
		// already wrote never gets here, because a save sets `saved` first.
		if (!this.saved) {
			for (const img of this.uploaded) {
				if (this.app.vault.getAbstractFileByPath(img.path)) void this.app.fileManager.trashFile(img);
			}
		}
		this.uploaded = [];
	}
}
