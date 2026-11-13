import { CLEAN_SLATE_NOTES, EntityKind, EntityFieldSpec, getKindSpec, instantiateFields } from './entity-kinds';
import type { CharacterField, CharacterFieldTemplate, StorygridSettings } from '../grid-data';

/**
 * How a new Codex entry starts: the kind's guided template fields, or a clean
 * slate (a name and an empty page). Pure — no Obsidian imports — so the
 * remember/ask rules and the clean-slate field set are unit-testable.
 */
export type StartMode = 'template' | 'clean';

/**
 * Frontmatter marker on a sheet that began as a clean slate. Sheets never write
 * empty fields, and the editor normally refills the kind's template fields as
 * empties on every edit — this marker is what stops a clean sheet growing the
 * whole template back the first time it is edited.
 */
export const START_MODE_KEY = 'storygrid-start';
export const CLEAN_SLATE_VALUE = 'clean-slate';

/** How the pop-up's sheet began, handed to the caller's save so it can write the marker with the sheet. */
export interface SheetStart {
	cleanSlate: boolean;
}

/** The writer's last choice for this kind; a template until they pick otherwise. */
export function rememberedStartMode(
	saved: Partial<Record<string, StartMode>> | undefined,
	kind: EntityKind
): StartMode {
	return saved?.[kind] === 'clean' ? 'clean' : 'template';
}

/** A copy of `saved` with this kind's choice recorded. Never mutates `saved`. */
export function rememberStartMode(
	saved: Partial<Record<string, StartMode>> | undefined,
	kind: EntityKind,
	mode: StartMode
): Partial<Record<string, StartMode>> {
	return { ...(saved ?? {}), [kind]: mode };
}

/**
 * Whether a pop-up is creating a brand-new, empty sheet — the only case that
 * gets the "template or clean slate" choice. Editing an existing sheet, or a
 * flow that hands the pop-up fields of its own, never does.
 */
export function offersStartChoice(isNewSheet: boolean, prefilledFieldCount: number): boolean {
	return isNewSheet && prefilledFieldCount === 0;
}

/** The "ask every time" setting; on unless the writer turned it off. */
export function asksStartMode(setting: boolean | undefined): boolean {
	return setting !== false;
}

/**
 * The fields a clean slate starts with: the kind's portrait/image field (if it
 * has one) and, for characters, Relationships — the one field other sheets
 * write into, so two-sided relationships always have a home on the sheet.
 * A kind that declares its own clean slate (an Event: Date, End Date,
 * Description) gets exactly that. The name is not a field here: it is the
 * sheet's title.
 */
export function cleanSlateFieldSpecs(kind: EntityKind): EntityFieldSpec[] {
	const spec = getKindSpec(kind);
	if (spec.cleanSlateFields) return spec.cleanSlateFields;
	// One big text box, nothing else (Emma, 2026-11-12: "a clean slate should
	// only have a large text field to start with"). The kind's own Notes field
	// when it has one, so the template and the clean slate agree on it.
	// Relationships needs no place here: editRelationshipsField adds it the
	// moment another sheet links to this one.
	const notes = spec.defaultFields.find((f) => f.label === CLEAN_SLATE_NOTES.label && f.type === 'textarea');
	return [notes ?? CLEAN_SLATE_NOTES];
}


/**
 * Values the caller already knows (the Timeline's clicked date, as
 * `{ Date: '<storydate>' }`) poured into a new sheet's fields: into the empty
 * field with that label, or — when the start has none — a new field from the
 * kind's own field list. A label the kind does not know is skipped. Never mutates.
 */
export function withStartValues(
	kind: EntityKind,
	fields: CharacterField[],
	values: Record<string, string> | undefined
): CharacterField[] {
	const out = fields.map((f) => ({ ...f }));
	for (const [label, value] of Object.entries(values ?? {})) {
		if (!value) continue;
		const slot = out.find((f) => f.label === label);
		if (slot) {
			if (!slot.value.trim()) slot.value = value;
			continue;
		}
		const spec = getKindSpec(kind);
		const def = [...spec.defaultFields, ...(spec.cleanSlateFields ?? [])].find((d) => d.label === label);
		if (def) out.push({ ...instantiateFields([def], '')[0], value });
	}
	return out;
}

// ─── Which template ─────────────────────────────────────────────────────────

/** The kind's own guided fields — always the first template, and the fallback. */
export const GUIDED_TEMPLATE = 'guided';

/** One row of the template picker. Ids: `guided`, `preset:<name>`, `saved:<id>`. */
export interface TemplateOption {
	id: string;
	name: string;
	fieldCount: number;
}

/** The picker's rows: the guided fields, then the kind's presets, then the writer's saved templates. */
export function templateOptions(
	kind: EntityKind,
	guidedName: string,
	saved: Array<{ id: string; name: string; fields: unknown[] }>
): TemplateOption[] {
	const spec = getKindSpec(kind);
	return [
		{ id: GUIDED_TEMPLATE, name: guidedName, fieldCount: spec.defaultFields.length },
		...(spec.presets ?? []).map((p) => ({ id: `preset:${p.name}`, name: p.name, fieldCount: p.fields.length })),
		...saved.filter((t) => t.fields.length > 0).map((t) => ({ id: `saved:${t.id}`, name: t.name, fieldCount: t.fields.length })),
	];
}

/**
 * The writer's saved field templates for a kind — the same lists the Codex
 * saves into. Read-only: never creates a missing list.
 */
export function savedTemplatesFor(
	host: { settings: StorygridSettings } | null,
	kind: EntityKind
): CharacterFieldTemplate[] {
	const s = host?.settings;
	if (!s) return [];
	switch (kind) {
		case 'character': return s.characterFieldTemplates ?? [];
		case 'scene': return s.sceneFieldTemplates ?? [];
		case 'location': return s.locationFieldTemplates ?? [];
		case 'faction': return s.factionFieldTemplates ?? [];
		case 'system': return s.systemFieldTemplates ?? [];
		case 'item': return s.itemFieldTemplates ?? [];
		case 'research': return s.researchFieldTemplates ?? [];
		default: return s.customKindFieldTemplates?.[kind] ?? [];
	}
}

/** The picker only appears when there is something to pick beyond the guided fields. */
export function showsTemplatePicker(options: TemplateOption[]): boolean {
	return options.length > 1;
}

/**
 * The template a new sheet of this kind starts from: the writer's default when
 * it still exists, otherwise the guided fields — a deleted default falls back
 * silently, never an error.
 */
export function resolveDefaultTemplate(
	saved: Partial<Record<string, string>> | undefined,
	kind: EntityKind,
	options: TemplateOption[]
): string {
	const id = saved?.[kind];
	return id && options.some((o) => o.id === id) ? id : GUIDED_TEMPLATE;
}

/** A copy of `saved` with this kind's default set (or cleared, for null / the guided fields). Never mutates. */
export function rememberDefaultTemplate(
	saved: Partial<Record<string, string>> | undefined,
	kind: EntityKind,
	id: string | null
): Partial<Record<string, string>> {
	const out = { ...(saved ?? {}) };
	if (id && id !== GUIDED_TEMPLATE) out[kind] = id;
	else delete out[kind];
	return out;
}

/**
 * What ticking (or not) "Make this my default" means once the sheet is saved:
 * ticked → this template; unticked on the current default → no default;
 * unticked on anything else → leave the default alone (undefined).
 */
export function defaultTemplateAfterPick(
	picked: string,
	ticked: boolean,
	currentDefault: string | undefined
): string | null | undefined {
	if (ticked) return picked;
	return picked === currentDefault ? null : undefined;
}

/** True when a sheet's `storygrid-start` frontmatter value marks it as a clean slate. */
export function isCleanSlateValue(value: unknown): boolean {
	return typeof value === 'string' && value.trim().replace(/^['"]|['"]$/g, '') === CLEAN_SLATE_VALUE;
}
