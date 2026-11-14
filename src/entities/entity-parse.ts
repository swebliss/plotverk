import { CharacterField, generateId } from '../grid-data';
import { ERA_SHEET, EVENT_HOW_LONG, EntityFieldSpec, EntityKind, getKindSpec, hasKind } from './entity-kinds';
import { FIELD_TYPES, FieldType, decodeValue, defaultValueForType, formatFieldValue, slugForLabel, splitFlowItems, unquoteYaml, yamlQuote } from './field-types';
import { SchemaEntry } from './entity-doc';
import { parseBody } from './entity-body';
import { START_MODE_KEY, cleanSlateFieldSpecs, isCleanSlateValue } from './start-mode';

/**
 * Pure parser that turns an entity markdown document (as produced by
 * buildEntityDocument) back into editable CharacterFields, so sheets can be
 * re-opened in the EntityModal without the writer touching raw YAML.
 *
 * Recovery strategy, in order of trust:
 *  - `storygrid-type` frontmatter → kind
 *  - `storygrid-schema` frontmatter → exact type/config/category/prompt for
 *    fields that plain YAML can't distinguish (slider vs. number, custom
 *    select options, matrix axis poles…)
 *  - At-a-glance callout rows → exact labels + values for scalar fields
 *  - Frontmatter scalars without a callout row → fields with prettified labels
 *  - `## Heading` sections → textarea fields (exact labels, prose preserved)
 *  - Top-level `![[...]]` embeds before the first section → image fields
 *
 * Round-trips losslessly for documents we generated. Hand-edited documents are
 * parsed best-effort: unknown H2 sections simply become long-text fields.
 */

export interface ParsedEntity {
	kind: EntityKind | null;
	name: string;
	fields: CharacterField[];
	/** Stable entity ID from `storygrid-id` frontmatter. Null on legacy files until stamped. */
	entityId: string | null;
	/** Display-name aliases from `aliases` frontmatter (YAML flow sequence). */
	aliases: string[];
	/**
	 * The frontmatter keys this parse attributed to Plotverk: every key that
	 * became (or fed) a field, plus `storygrid-type`/`-id`/`-schema` and
	 * `aliases` when present. The Edit-sheet save hands these to
	 * `applyOwnedFrontmatter` as its stale set, so a deleted or renamed field's
	 * old key is cleaned up. Never listed: `cssclasses`, `tags`, `position`
	 * (the user's and Obsidian's ground) and `storygrid-parent` (owned by the
	 * location-nesting feature, not by the sheet writer — a save must never
	 * delete it).
	 */
	ownedKeys: string[];
	/**
	 * The sheet began as a clean slate (`storygrid-start: clean-slate`), so an
	 * edit must not refill the kind's template fields. Like `storygrid-parent`,
	 * the marker is never a field and never in `ownedKeys`.
	 */
	cleanSlate: boolean;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split a document into its frontmatter block — verbatim, terminator included,
 * `''` when there is none — and the body. `frontmatter + body` is always the
 * input, byte for byte, so an edit that only touches one half cannot disturb
 * the other.
 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	const m = content.match(FRONTMATTER_RE);
	const frontmatter = m ? m[0] : '';
	return { frontmatter, body: content.slice(frontmatter.length) };
}

const FM_KEY_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/;

function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

/** Is this trimmed line a `key: value` map entry rather than a plain scalar? */
function isMapEntry(t: string): boolean {
	// A quoted scalar can contain a colon without being a mapping.
	if (t.startsWith('"') || t.startsWith("'")) return false;
	return /^[^:]+:(\s|$)/.test(t);
}

/**
 * Normalise one YAML scalar into a flow-form token `decodeValue` can read.
 * Numbers, booleans and nulls stay bare so they still read as numbers and
 * booleans; everything else is double-quoted, escaping exactly what
 * `unquoteYaml` reverses and nothing more.
 */
function flowScalar(raw: string): string {
	const t = raw.trim();
	if (t === '') return '""';
	if (t.startsWith('"') || t.startsWith("'")) return yamlQuote(unquoteYaml(t));
	if (t === 'true' || t === 'false' || t === 'null' || t === '~') return t;
	if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(t)) return t;
	return yamlQuote(t);
}

/**
 * A `key: value` line as a flow-map pair. The key stays bare unless quoting it
 * is the only way to keep the flow syntax splittable — a bare key is what the
 * matrix decoder compares against, and the table decoder unquotes either way.
 */
function flowPair(line: string): string {
	const idx = line.indexOf(':');
	const key = unquoteYaml(line.slice(0, idx).trim());
	const safeKey = /^[^,:{}[\]"']+$/.test(key) ? key : yamlQuote(key);
	return `${safeKey}: ${flowScalar(line.slice(idx + 1))}`;
}

/** Fold a `>` block scalar: consecutive lines join with a space, a blank line is a break. */
function foldLines(lines: string[]): string {
	const out: string[] = [];
	let run = '';
	for (const line of lines) {
		if (line.trim() === '') {
			if (run) out.push(run);
			run = '';
			out.push('');
			continue;
		}
		run = run ? `${run} ${line.trim()}` : line.trim();
	}
	if (run) out.push(run);
	return out.join('\n');
}

/**
 * A block sequence — `- item` lines — as a flow sequence. Items that are
 * themselves `key: value` maps (how a table field comes back) become flow maps.
 */
function readBlockSequence(lines: string[], start: number, indent: number): { value: string; next: number } {
	const items: string[] = [];
	let i = start;
	while (i < lines.length) {
		const line = lines[i];
		const t = line.trim();
		if (t === '' || indentOf(line) !== indent || !t.startsWith('-')) break;
		const after = t.slice(1).trim();
		i++;
		if (!isMapEntry(after)) {
			items.push(flowScalar(after));
			continue;
		}
		const pairs = [flowPair(after)];
		while (i < lines.length) {
			const child = lines[i];
			const ct = child.trim();
			if (ct === '' || ct.startsWith('-') || indentOf(child) <= indent || !isMapEntry(ct)) break;
			pairs.push(flowPair(ct));
			i++;
		}
		items.push(`{${pairs.join(', ')}}`);
	}
	return { value: `[${items.join(', ')}]`, next: i };
}

/** A nested block map — one level, which is all a matrix field needs — as a flow map. */
function readBlockMap(lines: string[], start: number, indent: number): { value: string; next: number } {
	const pairs: string[] = [];
	let i = start;
	while (i < lines.length) {
		const line = lines[i];
		const t = line.trim();
		if (t === '' || indentOf(line) !== indent || t.startsWith('-') || !isMapEntry(t)) break;
		pairs.push(flowPair(t));
		i++;
	}
	return { value: `{${pairs.join(', ')}}`, next: i };
}

/**
 * Read a frontmatter block into key/value pairs, where every value is the flow
 * form `decodeValue` speaks.
 *
 * This has to read more YAML than Plotverk writes. `processFrontMatter` hands
 * serialization to Obsidian, and Obsidian writes arrays as block sequences,
 * re-quotes scalars to its own taste, and wraps long values onto continuation
 * lines. It has already rewritten sheets in the wild — anything the plugin
 * stamped a `storygrid-id` onto came back in Obsidian's shape — so a reader that
 * only understands our own output silently loses a field's value.
 *
 * Block shapes are normalised *into* the flow forms `decodeValue` already reads
 * rather than decoded to native values here. That keeps one decoder for all
 * fourteen field types instead of growing a second.
 */
function parseFrontmatterBlock(block: string): Array<{ key: string; value: string }> {
	const entries: Array<{ key: string; value: string }> = [];
	const lines = block.split(/\r?\n/);
	let i = 0;
	while (i < lines.length) {
		const m = lines[i].match(FM_KEY_RE);
		if (!m) {
			i++;
			continue;
		}
		const key = m[1];
		const rest = m[2].trim();
		i++;

		// ── Block scalar: `|` keeps the line breaks, `>` folds them ──────────
		const style = /^([|>])[+-]?\d*$/.exec(rest);
		if (style) {
			const collected: string[] = [];
			while (i < lines.length && !(lines[i].trim() !== '' && indentOf(lines[i]) === 0)) {
				collected.push(lines[i]);
				i++;
			}
			while (collected.length && collected[collected.length - 1].trim() === '') collected.pop();
			// Strip the block's own indentation, whatever depth it was written at.
			const strip = collected.reduce(
				(min, l) => (l.trim() === '' ? min : Math.min(min, indentOf(l))),
				Number.MAX_SAFE_INTEGER
			);
			const dedented = collected.map((l) => (l.trim() === '' ? '' : l.slice(strip)));
			// Re-encoded so the entry keeps the module's contract — every value is
			// YAML flow source, decoded exactly once by the consumer. Handing the
			// literal text through raw made block scalars the one shape that must
			// NOT be unquoted, and that fork is what bred the double-unquote bug.
			const literal = style[1] === '|' ? dedented.join('\n') : foldLines(dedented);
			entries.push({ key, value: yamlQuote(literal) });
			continue;
		}

		// ── Nothing after the colon: a block sequence or map may follow ──────
		if (rest === '') {
			const line = i < lines.length ? lines[i] : '';
			const t = line.trim();
			if (t.startsWith('-')) {
				const seq = readBlockSequence(lines, i, indentOf(line));
				entries.push({ key, value: seq.value });
				i = seq.next;
				continue;
			}
			if (t !== '' && indentOf(line) > 0 && isMapEntry(t)) {
				const map = readBlockMap(lines, i, indentOf(line));
				entries.push({ key, value: map.value });
				i = map.next;
				continue;
			}
			entries.push({ key, value: '' });
			continue;
		}

		// ── Plain or quoted scalar, possibly wrapped onto continuation lines ─
		// Kept as YAML source, quotes intact: `decodeValue` (and the direct
		// consumers in parseEntityDocument) unquote exactly once. Unquoting here
		// AND there meant a value that is literally `"quoted"` lost its quotes.
		let value = rest;
		while (i < lines.length) {
			const line = lines[i];
			const t = line.trim();
			if (t === '' || indentOf(line) === 0 || t.startsWith('- ')) break;
			value += ` ${t}`;
			i++;
		}
		entries.push({ key, value });
	}
	return entries;
}

/**
 * Whether a property Plotverk did not write may still be taken in as a text
 * field: its key must come back unchanged through label → key (no `_`, no
 * capitals, no other letters the key maker drops), and its value must be
 * non-empty plain text. A number, yes/no, date, list or empty value would come
 * back as text or be deleted on save, so those stay the writer's own.
 */
export function isTakeableTextProperty(key: string, raw: string): boolean {
	if (slugForLabel(prettifyKey(key)) !== key) return false;
	const v = raw.trim();
	if (!v) return false;
	if (v.startsWith('"') || v.startsWith("'")) return unquoteYaml(v).trim() !== '';
	if (/^[[{|>&*!%@`]/.test(v)) return false;
	if (/^(true|false|yes|no|on|off|y|n|null|~)$/i.test(v)) return false;
	if (/^[-+]?(\.\d+|\d[\d_]*(\.\d*)?)([eE][-+]?\d+)?$/.test(v)) return false;
	if (/^(0x[0-9a-f]+|0o[0-7]+|[-+]?\.(inf|nan))$/i.test(v)) return false;
	if (/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
	return true;
}

/**
 * Whether a sheet's file name is the one its title would get: the title
 * itself, the title with the characters a file name cannot hold replaced (by
 * the Codex's rule or the Plot Grid's narrower one), or either with the " 2"
 * a clashing new sheet got.
 */
export function titleBelongsToFile(title: string, fileBasename: string): boolean {
	const t = title.trim();
	if (!t) return false;
	const candidates = new Set([t, t.replace(/[\\/:*?"<>|#^[\]]/g, '-'), t.replace(/[\\/:*?"<>|]/g, '-')]);
	for (const c of candidates) {
		if (fileBasename === c) return true;
		if (fileBasename.startsWith(`${c} `) && /^\d+$/.test(fileBasename.slice(c.length + 1))) return true;
	}
	return false;
}

function prettifyKey(key: string): string {
	return key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Parse the `storygrid-schema` sidecar (already unwrapped from its
 * single-quoted scalar). Corrupted/hand-edited JSON is treated as absent
 * rather than thrown.
 *
 * Indexed by key as well as by label: the key is the only reliable way back to
 * a label the slug function cannot reproduce — a Japanese or emoji label that
 * slugs to a hash, or the second of two labels that slug the same.
 */
function parseSchema(raw: string | undefined): { byLabel: Map<string, SchemaEntry>; byKey: Map<string, SchemaEntry> } {
	const byLabel = new Map<string, SchemaEntry>();
	const byKey = new Map<string, SchemaEntry>();
	if (!raw) return { byLabel, byKey };
	try {
		const entries = JSON.parse(raw) as SchemaEntry[];
		if (Array.isArray(entries)) {
			for (const e of entries) {
				if (!e || typeof e.label !== 'string') continue;
				byLabel.set(e.label, e);
				// Sheets written before the sidecar carried keys fall back to
				// recomputing the slug — which is what wrote them at the time.
				byKey.set(typeof e.key === 'string' && e.key ? e.key : slugForLabel(e.label), e);
			}
		}
	} catch {
		// Hand-edited or corrupted — fall back to the plain-YAML heuristics below.
	}
	return { byLabel, byKey };
}

export function parseEntityDocument(content: string, fileBasename: string): ParsedEntity {
	// ── Frontmatter ────────────────────────────────────────────────────────
	const fmMatch = content.match(FRONTMATTER_RE);
	const fmEntries = fmMatch ? parseFrontmatterBlock(fmMatch[1]) : [];
	const body = fmMatch ? content.slice(fmMatch[0].length) : content;

	const typeEntry = fmEntries.find((e) => e.key === 'storygrid-type');
	const typeValue = typeEntry ? unquoteYaml(typeEntry.value).trim() : '';
	// The document's own word for what it is, kept as written. Checking only the
	// original eight kinds here (`in ENTITY_KINDS`) is what once made the other
	// 28 read back as "no kind", so they opened and re-saved as Characters.
	// A type the registry has never heard of still comes back as itself — the
	// caller decides how to display it, nothing here relabels it.
	const kind: EntityKind | null = typeValue || null;

	const idEntry = fmEntries.find((e) => e.key === 'storygrid-id');
	const entityId: string | null = (idEntry && unquoteYaml(idEntry.value).trim()) || null;

	const aliasEntry = fmEntries.find((e) => e.key === 'aliases');
	const aliases: string[] = [];
	if (aliasEntry?.value) {
		// A block sequence has already been normalised to flow form by the
		// frontmatter reader, so both shapes land here as `[a, b]`.
		const raw = aliasEntry.value.trim();
		if (raw.startsWith('[') && raw.endsWith(']')) {
			for (const item of splitFlowItems(raw.slice(1, -1))) {
				const alias = unquoteYaml(item);
				if (alias) aliases.push(alias);
			}
		} else if (raw) {
			const alias = unquoteYaml(raw);
			if (alias) aliases.push(alias);
		}
	}

	const schemaEntry = fmEntries.find((e) => e.key === 'storygrid-schema');
	const { byLabel: schemaByLabel, byKey: schemaByKey } = parseSchema(
		schemaEntry ? unquoteYaml(schemaEntry.value) : undefined
	);

	// ── Callout rows give us the exact display labels for scalar fields ────
	// Format: > | **Label** | value |
	const calloutLabels = new Map<string, string>(); // frontmatter key → exact label
	for (const m of body.matchAll(/^> \| \*\*([^|*]+)\*\* \|/gm)) {
		const label = m[1].trim();
		// First row wins: two labels can slug the same, and this map is only the
		// fallback for when the schema has not recorded the key outright.
		if (!calloutLabels.has(slugForLabel(label))) calloutLabels.set(slugForLabel(label), label);
	}

	// ── H2 prose sections → textarea fields ───────────────────────────────
	// Sections come from entity-body's splitter — the same one the preserving
	// writer edits through — so a `## ` inside a code fence is content here for
	// the same reason it is content there. A second, fence-blind regex is how
	// the parser and the writer used to disagree about where a section ends.
	const bodyDoc = parseBody(body);
	const sections: Array<{ label: string; value: string }> = [];
	for (const block of bodyDoc.blocks) {
		if (block.kind !== 'section') continue;
		let text = block.content.trim();
		if (text === '_No content yet._') text = '';
		sections.push({ label: block.label, value: text });
	}
	const sectionLabelSet = new Set(sections.map((s) => s.label));
	// Section headings recover exact labels too, the same way callout rows do —
	// list and table fields get a body section but no infobox row.
	const sectionLabels = new Map<string, string>();
	for (const s of sections) sectionLabels.set(slugForLabel(s.label), s.label);

	// ── Image embeds above the first prose section → image fields ─────────
	// Covers both bare top-level embeds and embeds inside the infobox callout.
	// The preamble is assembled from the fence-aware blocks, not a `^## ` split,
	// so a heading inside a code sample cannot cut it short.
	let preamble = '';
	for (const block of bodyDoc.blocks) {
		if (block.kind === 'section') break;
		preamble += block.text;
	}
	const images: string[] = [];
	// Same rule as entity-body's EMBED_RE (`>![[x]]`, `>  ![[x]]`, indented),
	// so the writer's picture slots line up with the fields read here.
	for (const m of preamble.matchAll(/^>?[ \t]*!\[\[([^\]]+)\]\][ \t]*\r?$/gm)) {
		images.push(m[1].trim());
	}

	// ── Assemble fields in the kind's default order where possible ────────
	const fields: CharacterField[] = [];
	const ownedKeys: string[] = [];
	// Every key Plotverk itself writes on this sheet: recorded in the schema,
	// shown as an infobox row or a section, or one of the kind's own fields.
	// A label the schema files under another key (a field moved to `rating-2`
	// because the writer's own `rating` was already there) does not claim the
	// plain key: that one stays the writer's.
	const movedAway = (label: string) => {
		const key = schemaByLabel.get(label)?.key;
		return !!key && key !== slugForLabel(label);
	};
	const plotverkKeys = new Set<string>([
		...schemaByKey.keys(),
		...[...calloutLabels].filter(([, label]) => !movedAway(label)).map(([key]) => key),
		...[...sectionLabels].filter(([, label]) => !movedAway(label)).map(([key]) => key),
		...(kind && hasKind(kind) ? [...kindFieldLabels(kind)].filter((l) => !movedAway(l)).map(slugForLabel) : []),
	]);

	// Scalar fields come from frontmatter (skipping the type key and any key
	// that is actually a prose section stored as a block scalar)
	for (const entry of fmEntries) {
		// Not ours to manage: the user's own tags, Obsidian's bookkeeping, and
		// the parent link the location-nesting feature maintains. These never
		// become fields and never land in `ownedKeys`, so a save can neither
		// rewrite nor delete them.
		if (
			entry.key === 'cssclasses' || entry.key === 'tags' || entry.key === 'position' ||
			entry.key === 'storygrid-parent' || entry.key === START_MODE_KEY
		) continue;
		const reserved =
			entry.key === 'storygrid-type' || entry.key === 'storygrid-id' ||
			entry.key === 'storygrid-schema' || entry.key === 'aliases';
		// A property the writer added in Obsidian themselves (`date_created`,
		// `Status`, `rating: 5`, a list, an empty one) is theirs: it never becomes
		// a field and is never owned, so a save leaves it exactly as written. Only
		// plain text under a key that writes back unchanged is taken in as a field.
		if (!reserved && !plotverkKeys.has(entry.key) && !isTakeableTextProperty(entry.key, entry.value)) continue;
		ownedKeys.push(entry.key);
		if (reserved) continue;
		// The schema's recorded key is the highest-trust route back to a label,
		// because it is the only one that survives a label the slug function
		// cannot reproduce.
		const fromKey = schemaByKey.get(entry.key);
		const label = fromKey?.label ?? calloutLabels.get(entry.key) ?? sectionLabels.get(entry.key) ?? prettifyKey(entry.key);
		const schema = fromKey ?? schemaByLabel.get(label);
		const type = schema?.type ?? 'text';
		// For prose, the body wins over a stale frontmatter block scalar. Typed
		// blocks are the other way round: frontmatter holds the real structured
		// data and the body section is only a rendered copy for reading.
		if (sectionLabelSet.has(label) && type !== 'list' && type !== 'table') continue;
		// Config matters here, not just for display: a table's column order is what
		// maps each written cell back to the right column.
		const value = decodeValue(type, entry.value, schema?.config);
		const field: CharacterField = { id: generateId(), label, value, type };
		if (schema?.config) field.config = schema.config;
		if (schema?.category) field.category = schema.category;
		if (schema?.prompt) field.prompt = schema.prompt;
		fields.push(field);
	}

	// Image fields — label them from the kind's default image field if present
	const defaultImageLabel = kind
		? getKindSpec(kind).defaultFields.find((f) => f.type === 'image')?.label ?? 'Image'
		: 'Image';
	images.forEach((img, i) => {
		const label = i === 0 ? defaultImageLabel : `${defaultImageLabel} ${i + 1}`;
		const schema = schemaByLabel.get(label);
		const field: CharacterField = { id: generateId(), label, value: img, type: 'image' };
		if (schema?.category) field.category = schema.category;
		if (schema?.prompt) field.prompt = schema.prompt;
		fields.push(field);
	});

	// Prose sections (the markdown body is the source of truth for long text,
	// not the frontmatter block scalar, so hand edits to prose survive)
	for (const section of sections) {
		const schema = schemaByLabel.get(section.label);
		// A list or table already came back from frontmatter above; its body
		// section is a rendering, not the data.
		if (schema?.type === 'list' || schema?.type === 'table') continue;
		const field: CharacterField = { id: generateId(), label: section.label, value: section.value, type: 'textarea' };
		if (schema?.config) field.config = schema.config;
		if (schema?.category) field.category = schema.category;
		if (schema?.prompt) field.prompt = schema.prompt;
		fields.push(field);
	}

	// ── Empty fields the schema remembers ─────────────────────────────────
	// An empty field writes no value and no section, so only its schema entry
	// says it exists. Bring it back empty, so a field the writer added stays on
	// the sheet until they remove it. Non-picture entries come back even without
	// the `empty` mark: sheets saved before the mark existed dropped such fields
	// on reopen while their entry (help text, section) was still on disk.
	// Pictures need the mark: an embed is labelled by position, so an unmarked
	// picture entry may already be on the sheet under another label.
	const present = new Set(fields.map((f) => f.label));
	// A value on disk under the entry's key means the field is already here,
	// maybe under a label recovered another way: never add a second, empty copy.
	const fmKeys = new Set(fmEntries.map((e) => e.key));
	// An unmarked entry for one of the kind's own fields is left to
	// mergeWithSpecDefaults, which refills those in the kind's own order.
	const kindLabels = kind && hasKind(kind) ? kindFieldLabels(kind) : new Set<string>();
	for (const entry of schemaByLabel.values()) {
		// A type this version does not know (a hand edit, a newer Plotverk) is
		// skipped, never thrown on: one odd entry must not stop the sheet opening.
		if (present.has(entry.label) || !FIELD_TYPES.includes(entry.type)) continue;
		if (!entry.empty && (entry.type === 'image' || kindLabels.has(entry.label))) continue;
		if (entry.type !== 'image' && fmKeys.has(entry.key ?? slugForLabel(entry.label))) continue;
		const field: CharacterField = {
			id: generateId(), label: entry.label, value: defaultValueForType(entry.type, entry.config), type: entry.type,
		};
		if (entry.config) field.config = entry.config;
		if (entry.category) field.category = entry.category;
		if (entry.prompt) field.prompt = entry.prompt;
		fields.push(field);
		present.add(entry.label);
	}

	// ── Name: H1 title, falling back to the file name ─────────────────────
	const h1 = bodyDoc.blocks.find((b) => b.kind === 'h1');
	const name = h1 && h1.kind === 'h1' && h1.title ? h1.title : fileBasename;

	const startEntry = fmEntries.find((e) => e.key === START_MODE_KEY);
	const cleanSlate = !!startEntry && isCleanSlateValue(unquoteYaml(startEntry.value));

	return { kind, name, fields, entityId, aliases, ownedKeys, cleanSlate };
}

/**
 * Merge parsed fields with the kind's default field set. Documents omit empty
 * fields entirely (see buildEntityDocument), so a parsed sheet only contains
 * what was filled in — this restores the missing spec fields as empties, in
 * the spec's order, and corrects field types the parser can't infer from
 * plain YAML alone (the parser falls back to 'text' when there's no
 * storygrid-schema entry — e.g. documents saved before this field carried a
 * schema, or a spec field the schema doesn't mention). One-directional: it
 * only repairs away from that 'text' fallback, never overrides a type the
 * parser was actually sure of.
 */
/** Every label the kind itself defines: template, presets, extra sets and clean slate. */
function kindFieldLabels(kind: EntityKind): Set<string> {
	const spec = getKindSpec(kind);
	return new Set(
		[
			...spec.defaultFields,
			...(spec.presets ?? []).flatMap((p) => p.fields),
			...(spec.extraFieldSets ?? []).flat(),
			...(spec.cleanSlateFields ?? []),
			...(kind === 'event' ? ERA_SHEET.cleanSlateFields : []),
		].map((d) => d.label)
	);
}

/**
 * Labels of the empty fields a save must remember explicitly. An empty field
 * writes no value, so it comes back on reopen only if the kind's own field set
 * refills it (`mergeWithSpecDefaults`). Every empty field that refill would not
 * produce — a custom field, a catalog field, a template field on a clean slate —
 * is returned here, so the writer can record it and nothing the writer added
 * disappears. Untouched template fields are left out, keeping ordinary sheets'
 * frontmatter exactly as compact as before.
 */
export function emptyFieldsToKeep(kind: EntityKind, fields: CharacterField[], cleanSlate = false): Set<string> {
	const empties = fields.filter((f) => !f.value.trim());
	if (empties.length === 0) return new Set();
	const filled = fields.filter((f) => f.value.trim());
	// Reopen sees the filled fields PLUS the ones kept here, and those can tip
	// the merge to a different field set (an era, a Magic System preset) that no
	// longer refills the rest. So grow the kept set until reopening it refills
	// every other empty field. It only grows, so this always ends.
	const keep = new Set<string>();
	for (;;) {
		const reopened = [...filled, ...empties.filter((f) => keep.has(f.label))];
		const refilled = new Set(mergeWithSpecDefaults(kind, reopened, cleanSlate).map((f) => f.label));
		const before = keep.size;
		for (const f of empties) if (!refilled.has(f.label)) keep.add(f.label);
		if (keep.size === before) return keep;
	}
}

export function mergeWithSpecDefaults(kind: EntityKind | null, fields: CharacterField[], cleanSlate = false): CharacterField[] {
	// An unregistered kind has no field set to merge against; the generic spec's
	// lone "Name" field would be bolted on to a sheet that never asked for it.
	if (!kind || !hasKind(kind)) return fields;
	const spec = getKindSpec(kind);
	// Labels match the way the sheet matches its headings: capitals and outer
	// spaces aside. A hand-typed "## appearance" IS the kind's Appearance; an
	// exact-only match added a second, empty Appearance next to it.
	const norm = (label: string) => label.trim().toLowerCase();

	// A clean slate keeps the writer's own order and fields. Fields that share a
	// label with the kind's own still get their type and settings repaired (a
	// Gender dropdown added from the catalog stores no schema), but the template
	// the writer turned down is never refilled — only the clean slate's own few.
	if (cleanSlate) {
		const known = new Map(
			[...(spec.presets ?? []).flatMap((p) => p.fields), ...(spec.extraFieldSets ?? []).flat(), ...spec.defaultFields].map((d) => [norm(d.label), d] as const)
		);
		const out = fields.map((f) => {
			const def = known.get(norm(f.label));
			// A capitals-only match is left as the writer made it (see below).
			return def && def.label === f.label ? repairFromSpec(f, def) : f;
		});
		// A clean-slate era keeps the era's own few (its Color too, even while empty).
		const isEra = kind === 'event' && fields.some((f) => f.label === 'How Long' && f.value.trim().toLowerCase() === EVENT_HOW_LONG.era.toLowerCase());
		for (const def of isEra ? ERA_SHEET.cleanSlateFields : cleanSlateFieldSpecs(kind)) {
			if (!out.some((f) => norm(f.label) === norm(def.label))) out.push(blankFromSpec(def));
		}
		return out;
	}

	// Merge against whichever field set fits best — the defaults or a preset —
	// so a "Magic System" sheet doesn't sprout the generic system fields.
	const labels = new Set(fields.map((f) => norm(f.label)));
	let bestSet = spec.defaultFields;
	let bestScore = spec.defaultFields.filter((d) => labels.has(norm(d.label))).length;
	for (const set of [...(spec.presets ?? []).map((p) => p.fields), ...(spec.extraFieldSets ?? [])]) {
		const score = set.filter((d) => labels.has(norm(d.label))).length;
		if (score > bestScore) { bestScore = score; bestSet = set; }
	}

	const remaining = [...fields];
	const out: CharacterField[] = [];

	for (const def of bestSet) {
		// The exact label first, so a sheet holding both "Appearance" and
		// "appearance" keeps each where it was.
		// A capitals-only match takes the kind's slot as it is: only a field of
		// the same sort (one line, or long text) and with its own type kept, so a
		// hand-made one-line row never turns into a second, long-text copy.
		const exact = remaining.findIndex((f) => f.label === def.label);
		const loose = exact >= 0 ? -1 : remaining.findIndex((f) =>
			f.type !== 'image' && norm(f.label) === norm(def.label) && isLongText(f.type) === isLongText(def.type));
		if (exact >= 0) {
			out.push(repairFromSpec(remaining.splice(exact, 1)[0], def));
		} else if (loose >= 0) {
			out.push(remaining.splice(loose, 1)[0]);
		} else {
			out.push(blankFromSpec(def));
		}
	}
	// Custom / preset-only fields keep their parsed order after the defaults
	out.push(...remaining);
	return out;
}

const isLongText = (type: string) => type === 'textarea' || type === 'list' || type === 'table';

/** A parsed field that shares a label with a kind field, with the type and settings the parser could not infer put back. */
function repairFromSpec(found: CharacterField, def: EntityFieldSpec): CharacterField {
	// A same-named field the writer made themselves, holding a value the spec's
	// dropdown doesn't offer ("Woman" in a hand-made Gender field), stays as
	// they made it — a dropdown would show it as empty.
	const options = def.config?.options;
	if (options && found.value.trim() && !options.includes(found.value.trim())) return found;
	// The parser falls back to 'text' when it has no schema info; trust the spec's type in that case only.
	const type = found.type === 'text' && def.type !== 'text' ? def.type : found.type;
	// Settings (a dropdown's choices) come from the spec when the sheet stored none.
	const config = found.config ?? (def.config ? { ...def.config } : undefined);
	return { ...found, type, ...(config ? { config } : {}) };
}

/** An empty field as the kind defines it — the sheet never wrote it because it was empty. */
function blankFromSpec(def: EntityFieldSpec): CharacterField {
	return { id: generateId(), label: def.label, value: defaultValueForType(def.type, def.config), type: def.type, ...(def.config ? { config: { ...def.config } } : {}) };
}

// ─── Exports: leave a sheet's planning out of the manuscript ────────────────

/** One line as it reads: line ending and trailing spaces aside. */
function readLine(line: string): string {
	return line.replace(/\r?\n$/, '').replace(/[ \t]+$/, '');
}

/**
 * If `content` (a section's text, verbatim) opens with exactly `expected` —
 * line endings, trailing spaces and blank lines around it aside — return what
 * follows it, byte for byte with its leading blank lines dropped. Otherwise
 * null: the section no longer holds what the sheet stored.
 */
function afterStoredAnswer(content: string, expected: string): string | null {
	const want = expected.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
	while (want.length && want[0].trim() === '') want.shift();
	while (want.length && want[want.length - 1].trim() === '') want.pop();
	if (!want.length) return null;
	want[0] = want[0].trimStart();

	const lines = content.match(/[^\n]*\n|[^\n]+/g) ?? [];
	let i = 0;
	while (i < lines.length && readLine(lines[i]).trim() === '') i++;
	for (let w = 0; w < want.length; w++, i++) {
		if (i >= lines.length) return null;
		const got = w === 0 ? readLine(lines[i]).trimStart() : readLine(lines[i]);
		if (got !== want[w]) return null;
	}
	while (i < lines.length && readLine(lines[i]).trim() === '') i++;
	return lines.slice(i).join('');
}

/**
 * A Plotverk sheet's planning, left out of an export: its `# Title`, its
 * at-a-glance box and its own sections (Summary, Notes…). Everything else on
 * the page — the writer's story text and their own headings — stays.
 *
 * When in doubt, text stays:
 * - A section goes only when the sheet stored that field (its property is in
 *   the frontmatter) and the section opens with exactly what was stored — for
 *   a list or table, exactly the rows the stored value draws. Story typed
 *   below the stored answer stays; a hand-edited section stays whole.
 * - The page's last section always stays. A section runs to the end of the
 *   page, so story typed at the bottom lands inside it — and once the sheet
 *   editor has saved the page, that story IS the stored answer. There is no
 *   telling them apart, so it is never left out.
 * - The title goes only when it belongs to the file.
 *
 * `content` is the whole file; a page without `storygrid-type` comes back as is.
 */
export function stripSheetPlanning(content: string, fileBasename?: string): string {
	const { frontmatter, body } = splitFrontmatter(content);
	if (!frontmatter) return content;
	const fmMatch = frontmatter.match(FRONTMATTER_RE);
	const entries = fmMatch ? parseFrontmatterBlock(fmMatch[1]) : [];
	if (!entries.some((e) => e.key === 'storygrid-type' && unquoteYaml(e.value).trim())) return content;

	const stored = new Map(entries.map((e) => [e.key, e.value]));
	const schemaEntry = entries.find((e) => e.key === 'storygrid-schema');
	const { byLabel } = parseSchema(schemaEntry ? unquoteYaml(schemaEntry.value) : undefined);

	const doc = parseBody(body);
	const sections = doc.blocks.filter((b) => b.kind === 'section');
	const lastSection = sections[sections.length - 1];
	const kept: string[] = [];
	for (const block of doc.blocks) {
		if (block.kind === 'infobox') continue;
		if (block.kind === 'h1') {
			if (fileBasename && titleBelongsToFile(block.title, fileBasename)) continue;
			kept.push(block.text);
			continue;
		}
		if (block.kind !== 'section') { kept.push(block.text); continue; }

		const schema = byLabel.get(block.label);
		const key = typeof schema?.key === 'string' && schema.key ? schema.key : slugForLabel(block.label);
		const raw = stored.get(key);
		if (raw === undefined) { kept.push(block.text); continue; } // the writer's own heading, even an empty one

		const content = block.content.trim();
		if (content === '' || content === '_No content yet._') continue;
		if (block === lastSection) { kept.push(block.text); continue; }

		const type: FieldType = schema?.type ?? 'textarea';
		const expected = type === 'textarea'
			? decodeValue('textarea', raw)
			: formatFieldValue(type, decodeValue(type, raw, schema?.config), schema?.config);
		// An answer of several paragraphs stays whole: that is the shape of story
		// text the sheet editor took into a field (typed at the bottom of the page,
		// then a later field was added below it). Planning answers are short.
		if (type === 'textarea' && /\n[ \t]*\n/.test(expected.replace(/\r\n?/g, '\n').trim())) { kept.push(block.text); continue; }
		const rest = afterStoredAnswer(block.content, expected);
		if (rest === null) { kept.push(block.text); continue; }
		// The stored answer goes; story typed below it stays, as typed.
		if (rest.trim()) kept.push(rest.replace(/\s+$/, '') + doc.eol + doc.eol);
	}
	return frontmatter + kept.join('');
}
