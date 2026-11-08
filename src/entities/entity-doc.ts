import { CharacterField } from '../grid-data';
import { EntityKind, getKindSpec } from './entity-kinds';
import { encodeYamlValue, formatFieldValue, slugForLabel, slugsForLabels, toYamlValue, yamlQuote, FieldConfig } from './field-types';

/**
 * Pure document builder for entity markdown files (no Obsidian imports so it
 * stays unit-testable). YAML frontmatter holds all field values; the sheet
 * body is an H1 title, a styled infobox callout (portrait + fact rows), and
 * prose sections. The `cssclasses` frontmatter keys scope the polished sheet
 * styling in styles.css (`storygrid-sheet` + per-kind accent class).
 *
 * Two ways out of here, sharing every decision underneath:
 *  - `buildEntityDocument` renders the whole file, frontmatter included, as
 *    text. Still used by the callers that have not moved yet.
 *  - `buildEntityFrontmatter` + `buildEntityBody` split it in two, so the
 *    frontmatter can be handed to Obsidian as native values (see
 *    `entity-write.ts`) instead of being serialized here by hand.
 */

/** Sidecar record for one field in `storygrid-schema` — only fields the parser can't losslessly infer from plain YAML need one (see `needsSchemaEntry`). */
export interface SchemaEntry {
	label: string;
	type: CharacterField['type'];
	/**
	 * The frontmatter key this field's value lives under, recorded only when it
	 * cannot be re-derived from the label — a hashed key for a non-Latin label,
	 * or a de-duplicated one where two labels slug the same. Writing it down
	 * beats having the writer and the parser each recompute the same lossy
	 * function and hope they agree. Absent on sheets written before this
	 * existed, where the parser falls back to `slugForLabel`.
	 */
	key?: string;
	config?: FieldConfig;
	category?: string;
	prompt?: string;
}

/**
 * Whether a field needs a `storygrid-schema` entry to round-trip losslessly.
 * Plain text/textarea/image fields with no config, category, or custom prompt
 * are fully recoverable from the YAML/body shape alone and stay off the
 * schema — this is what keeps it compact on ordinary sheets.
 */
/** Multi-line field types that live as their own body section, not an infobox row. */
export function isBlockField(field: CharacterField): boolean {
	return field.type === 'textarea' || field.type === 'list' || field.type === 'table';
}

function needsSchemaEntry(field: CharacterField, key: string, ambiguous: boolean): boolean {
	const inferableType = field.type === 'text' || field.type === 'textarea' || field.type === 'image';
	// Images live as body embeds, not under a frontmatter key, so their key is
	// never worth recording.
	const inferableKey = field.type === 'image' || (!ambiguous && key === slugForLabel(field.label));
	return !inferableType || !inferableKey || !!field.config || !!field.category || !!field.prompt;
}

/**
 * Build the `storygrid-schema` value as raw JSON, or null if nothing needs it.
 * The document builder wraps this in a single-quoted YAML scalar; the native
 * builder hands the string to Obsidian and lets it choose the quoting.
 *
 * A key is recorded whenever the label cannot be recovered from it — which
 * covers every member of a collision group, not only the ones that ended up
 * with a suffix. "Age?" keeps the plain `age` key, but the parser still cannot
 * tell it from "Age!" without being told, because both slug to `age`.
 */
/**
 * A field exactly as its kind defines it, settings included (the character's
 * Gender dropdown). The kind restores type and settings when the sheet is
 * opened, so it needs no schema entry — and an untouched sheet saves
 * byte-for-byte as before.
 */
function isSpecDefaultWithSettings(kind: EntityKind, f: CharacterField): boolean {
	if (f.category || f.prompt) return false;
	const def = getKindSpec(kind).defaultFields.find((d) => d.label === f.label);
	return !!def?.config && def.type === f.type && JSON.stringify(def.config) === JSON.stringify(f.config ?? null);
}

function schemaJson(kind: EntityKind, fields: CharacterField[], keys: string[]): string | null {
	const baseCounts = new Map<string, number>();
	for (const f of fields) {
		if (f.type === 'image') continue;
		const base = slugForLabel(f.label);
		baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
	}

	const entries: SchemaEntry[] = [];
	fields.forEach((f, i) => {
		const ambiguous = f.type !== 'image' && (baseCounts.get(slugForLabel(f.label)) ?? 0) > 1;
		if (!needsSchemaEntry(f, keys[i], ambiguous) || isSpecDefaultWithSettings(kind, f)) return;
		const entry: SchemaEntry = { label: f.label, type: f.type };
		if (f.type !== 'image' && (ambiguous || keys[i] !== slugForLabel(f.label))) entry.key = keys[i];
		if (f.config) entry.config = f.config;
		if (f.category) entry.category = f.category;
		if (f.prompt) entry.prompt = f.prompt;
		entries.push(entry);
	});
	return entries.length === 0 ? null : JSON.stringify(entries);
}

/**
 * The fields that belong in frontmatter, paired with the key each one lives
 * under. Both writers go through here, so neither can invent its own answer to
 * "which fields are frontmatter fields" or "what key does this label get".
 *
 * Empty fields are omitted entirely: they regenerate from the kind spec on the
 * next edit (see mergeWithSpecDefaults), so the file stays readable. Images are
 * never here — they live as body embeds.
 */
function frontmatterFields(fields: CharacterField[], keys: string[]): Array<{ key: string; field: CharacterField }> {
	const out: Array<{ key: string; field: CharacterField }> = [];
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i];
		if (field.type === 'image') continue;
		if (!field.value.trim()) continue;
		out.push({ key: keys[i], field });
	}
	return out;
}

/** The `cssclasses` entries Plotverk owns on a sheet of this kind. */
export function sheetCssClasses(kind: EntityKind): string[] {
	return ['storygrid-sheet', `sg-sheet-${kind}`];
}

/**
 * The entity's frontmatter as native JavaScript values, ready to hand to
 * `app.fileManager.processFrontMatter`. Obsidian does the YAML serialization,
 * which is the whole point: a value ending in a backslash, a label in a script
 * with no ASCII, a table of rows — none of them can produce YAML that fails to
 * parse and takes the sheet out of the Codex with it.
 *
 * There is no `name` here on purpose. The entity's name is the H1 in the body,
 * not a frontmatter key.
 */
export function buildEntityFrontmatter(
	kind: EntityKind,
	fields: CharacterField[],
	entityId?: string,
	aliases?: string[]
): Record<string, unknown> {
	const fm: Record<string, unknown> = { 'storygrid-type': kind };
	if (entityId) fm['storygrid-id'] = entityId;
	if (aliases && aliases.length > 0) fm['aliases'] = [...aliases];
	fm['cssclasses'] = sheetCssClasses(kind);

	// Keys are resolved for the whole field set at once so two labels that slug
	// the same do not overwrite each other.
	const keys = slugsForLabels(fields.map((f) => f.label));
	for (const { key, field } of frontmatterFields(fields, keys)) {
		const value = toYamlValue(field.type, field.value, field.config);
		if (value === undefined) continue;
		fm[key] = value;
	}

	const schema = schemaJson(kind, fields, keys);
	if (schema) fm['storygrid-schema'] = schema;
	return fm;
}

/** The frontmatter block's inner lines, serialized by hand. Kept byte-identical to what shipped. */
function frontmatterSourceLines(kind: EntityKind, fields: CharacterField[], entityId?: string, aliases?: string[]): string[] {
	const lines: string[] = [`storygrid-type: ${kind}`];
	if (entityId) lines.push(`storygrid-id: ${entityId}`);
	if (aliases && aliases.length > 0) {
		const escaped = aliases.map((a) =>
			a.includes(',') || a.includes(']') || a.includes('"') ? yamlQuote(a) : a
		);
		lines.push(`aliases: [${escaped.join(', ')}]`);
	}
	lines.push(`cssclasses: [${sheetCssClasses(kind).join(', ')}]`);

	const keys = slugsForLabels(fields.map((f) => f.label));
	for (const { key, field } of frontmatterFields(fields, keys)) {
		if (field.type === 'text' || field.type === 'textarea') {
			// Bug-compatible with the original builder: a literal newline in a
			// "text" field (rare, but possible from a paste) also gets block-scalar treatment.
			if (field.value.includes('\n')) {
				const indented = field.value.split('\n').map((l) => `  ${l}`).join('\n');
				lines.push(`${key}: |\n${indented}`);
			} else {
				lines.push(`${key}: ${yamlQuote(field.value)}`);
			}
			continue;
		}
		const encoded = encodeYamlValue(field.type, field.value, field.config);
		if (encoded === null) continue;
		lines.push(`${key}: ${encoded}`);
	}

	const schema = schemaJson(kind, fields, keys);
	// Single-quoted YAML scalar: the only escape needed is doubling a literal quote.
	if (schema) lines.push(`storygrid-schema: '${schema.replace(/'/g, "''")}'`);
	return lines;
}

/** The sheet body: H1 title, infobox callout, then a section per block field. */
function bodyLines(kind: EntityKind, name: string, fields: CharacterField[]): string[] {
	const spec = getKindSpec(kind);
	const lines: string[] = [`# ${name}`, ''];

	// ── Infobox callout: image embeds + at-a-glance fact rows ─────────────
	const imageFields = fields.filter((f) => f.type === 'image' && f.value.trim());
	// Lists and tables are multi-line: they get their own body section below
	// rather than being crushed into a single at-a-glance row.
	const tableFields = fields.filter(
		(f) => !isBlockField(f) && f.type !== 'image' && f.value.trim()
	);
	if (imageFields.length > 0 || tableFields.length > 0) {
		lines.push(`> [!${spec.calloutType}|sg-infobox] ${spec.calloutTitle}`);
		for (const imgField of imageFields) {
			lines.push(`> ![[${imgField.value.trim()}]]`);
		}
		if (tableFields.length > 0) {
			// A blank callout line is REQUIRED here: without it Obsidian treats
			// the table as a continuation of the image/title block and renders
			// the raw "| Field | Value |" pipes instead of a table.
			lines.push('>');
			lines.push('> | Field | Value |');
			lines.push('> | --- | --- |');
			for (const f of tableFields) {
				const val = formatFieldValue(f.type, f.value, f.config);
				lines.push(`> | **${f.label}** | ${val} |`);
			}
		}
		lines.push('');
	}

	// ── Block fields as body sections (empty ones are not written) ────────
	// Prose is the source of truth for textarea fields; for lists and tables the
	// frontmatter is authoritative and this is the readable rendering of it, so
	// the note stays useful to read (and to other plugins) while you write.
	const proseFields = fields.filter((f) => isBlockField(f) && f.value.trim());
	for (const f of proseFields) {
		lines.push(`## ${f.label}`, '');
		const rendered = f.type === 'textarea'
			? f.value.trim()
			: formatFieldValue(f.type, f.value, f.config);
		lines.push(rendered, '');
	}

	return lines;
}

/**
 * The sheet body with no frontmatter — what `entity-write.ts` creates the file
 * with before handing the frontmatter to Obsidian.
 */
export function buildEntityBody(kind: EntityKind, name: string, fields: CharacterField[]): string {
	return bodyLines(kind, name, fields).join('\n');
}

export function buildEntityDocument(kind: EntityKind, name: string, fields: CharacterField[], entityId?: string, aliases?: string[]): string {
	return [
		'---',
		...frontmatterSourceLines(kind, fields, entityId, aliases),
		'---',
		'',
		...bodyLines(kind, name, fields),
	].join('\n');
}
