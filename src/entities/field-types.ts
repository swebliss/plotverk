// Pure field-type registry — no Obsidian imports. Single source of truth for
// the ten Codex attribute types: what they store, how they serialize to
// frontmatter YAML, and how they format for read-only display. Used by the
// serializer (entity-doc.ts), the parser (entity-parse.ts), and the editor
// widgets (ui/field-widgets.ts) so all three stay in lockstep.

export type FieldType =
	| 'text'
	| 'textarea'
	| 'tags'
	| 'image'
	| 'number'
	| 'slider'
	| 'select'
	| 'checkbox'
	| 'date'
	| 'matrix'
	| 'list'
	| 'table'
	| 'color'
	| 'storydate';

export const FIELD_TYPES: FieldType[] = [
	'text', 'textarea', 'tags', 'image', 'number', 'slider', 'select', 'checkbox', 'date', 'matrix',
	'list', 'table', 'color', 'storydate',
];

/** Types that hold a block of content rather than a single value — they render full-width. */
export const BLOCK_FIELD_TYPES: FieldType[] = ['textarea', 'list', 'table', 'matrix'];

/** Per-type widget configuration. All optional — old fields keep working with no config. */
export interface FieldConfig {
	min?: number;
	max?: number;
	step?: number;
	/** Dropdown choices for a `select` field. */
	options?: string[];
	/** Matrix horizontal axis poles: [negative-side label, positive-side label]. */
	xAxis?: [string, string];
	/** Matrix vertical axis poles: [negative-side label, positive-side label]. */
	yAxis?: [string, string];
	/** `tags` field in entity-link mode: which Codex kinds the picker offers. */
	linkKinds?: string[];
	/** `tags` field: link to real Codex entities ("[[Name]]") instead of free-text tags. */
	entityLink?: boolean;
	/** `table` field: the column headers. Rows live in the field's value. */
	columns?: string[];
	/** Background tint name applied to the field's card in the editor and on the detail page. */
	tint?: FieldTint;
}

/** The tint palette offered in the field and group menus. Names, not hex, so light and dark can differ. */
export type FieldTint = 'yellow' | 'green' | 'blue' | 'purple' | 'red' | 'grey';

export const FIELD_TINTS: Array<{ id: FieldTint; label: string }> = [
	{ id: 'yellow', label: 'Yellow' },
	{ id: 'green', label: 'Green' },
	{ id: 'blue', label: 'Blue' },
	{ id: 'purple', label: 'Purple' },
	{ id: 'red', label: 'Red' },
	{ id: 'grey', label: 'Grey' },
];

/**
 * Rows of a `table` field. The canonical string value is a JSON array of rows,
 * each row an array of cell strings aligned to `config.columns`.
 */
export function parseTableRows(value: string): string[][] {
	const v = value.trim();
	if (!v) return [];
	try {
		const parsed: unknown = JSON.parse(v);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((row): row is unknown[] => Array.isArray(row))
			.map((row) => row.map((cell) => (cell == null ? '' : String(cell))));
	} catch {
		return [];
	}
}

export function stringifyTableRows(rows: string[][]): string {
	// A table of nothing but blanks is an empty field, not an empty grid.
	return rows.some((row) => row.some((cell) => cell.trim())) ? JSON.stringify(rows) : '';
}

/** Items of a `list` field — one per line in the canonical value. */
export function parseListItems(value: string): string[] {
	return value.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * A `storydate` field's canonical value is a JSON-encoded structured date
 * (year required; era/month/day/minute optional) — see StoryDate in
 * timeline/timeline-data.ts. Parsed locally here (rather than importing that
 * module) so the always-loaded Codex field system never depends on the
 * optional Timeline feature. Returns null for blank/malformed input.
 */
export function parseStoryDateJson(value: string): { era?: string; year: number; month?: number; day?: number; minute?: number } | null {
	const v = value.trim();
	if (!v) return null;
	try {
		const parsed: unknown = JSON.parse(v);
		if (!parsed || typeof parsed !== 'object') return null;
		const d = parsed as Record<string, unknown>;
		if (typeof d.year !== 'number' || !Number.isFinite(d.year)) return null;
		const date: { era?: string; year: number; month?: number; day?: number; minute?: number } = { year: d.year };
		if (typeof d.era === 'string' && d.era) date.era = d.era;
		if (typeof d.month === 'number' && Number.isFinite(d.month)) date.month = d.month;
		if (typeof d.day === 'number' && Number.isFinite(d.day)) date.day = d.day;
		if (typeof d.minute === 'number' && Number.isFinite(d.minute)) date.minute = d.minute;
		return date;
	} catch {
		return null;
	}
}

function assertNever(x: never): never {
	throw new Error(`Unhandled field type: ${String(x)}`);
}

export function defaultConfig(type: FieldType): FieldConfig {
	switch (type) {
		case 'slider':
			return { min: 0, max: 100, step: 1 };
		case 'select':
			return { options: [] };
		case 'matrix':
			return { xAxis: ['', ''], yAxis: ['', ''] };
		case 'table':
			return { columns: ['Name', 'Notes'] };
		case 'text':
		case 'textarea':
		case 'tags':
		case 'image':
		case 'number':
		case 'checkbox':
		case 'date':
		case 'list':
		case 'color':
		case 'storydate':
			return {};
		default:
			return assertNever(type);
	}
}

/**
 * The value a brand-new field of this type should start with. Most types
 * start genuinely blank — the widget shows nothing until you type. But a
 * slider, checkbox, or matrix widget always paints a resting position (0,
 * unchecked, dead centre) even with an empty value, so a field left exactly
 * where it was created reads as "answered" on screen while its stored value
 * is still `''` — and the read-only Codex view, which hides anything with an
 * empty value, then shows nothing for it at all. Giving these three a real
 * starting value at creation keeps the data honest with what's on screen.
 */
export function defaultValueForType(type: FieldType, config?: FieldConfig): string {
	switch (type) {
		case 'slider':
			return String(config?.min ?? 0);
		case 'checkbox':
			return 'false';
		case 'matrix':
			return '0,0';
		case 'text':
		case 'textarea':
		case 'tags':
		case 'image':
		case 'number':
		case 'select':
		case 'date':
		case 'list':
		case 'table':
		case 'color':
		case 'storydate':
			return '';
		default:
			return assertNever(type);
	}
}

/**
 * Frontmatter keys already reserved by Obsidian or Plotverk itself. A custom
 * field's slug must never collide with one of these — e.g. a field named
 * "Tags" would otherwise silently overwrite Obsidian's own `tags:` key.
 */
const RESERVED_KEYS = new Set([
	'tags', 'cssclass', 'cssclasses', 'aliases', 'position',
	'storygrid-type', 'storygrid-id', 'storygrid-parent', 'storygrid-schema', 'storygrid-start',
]);

/**
 * 32-bit FNV-1a hash of a label, base36. Determinism is the entire point: the
 * same label must produce the same frontmatter key on every save, in every
 * session, on every machine — otherwise the sheet stops round-tripping and the
 * field's value is orphaned under a key nothing looks for.
 */
function hashLabel(label: string): string {
	let h = 2166136261;
	for (let i = 0; i < label.length; i++) {
		h = Math.imul(h ^ label.charCodeAt(i), 16777619);
	}
	return (h >>> 0).toString(36);
}

/**
 * Turn a field label into a frontmatter key, prefixing `field-` on collision
 * with a reserved key.
 *
 * A label written in a script with no ASCII letters or digits — Japanese,
 * Cyrillic, an emoji, punctuation alone — strips down to nothing or to bare
 * dashes. An empty or `---` YAML key breaks the entire frontmatter block, and
 * a sheet whose frontmatter will not parse vanishes from the Codex. Those fall
 * back to a hashed key; the exact label is recorded in the `storygrid-schema`
 * sidecar so the parser can put it back.
 */
export function slugForLabel(label: string): string {
	const raw = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
	if (raw === '' || /^-+$/.test(raw)) return `field-${hashLabel(label)}`;
	return RESERVED_KEYS.has(raw) ? `field-${raw}` : raw;
}

/**
 * Whether `field` only repeats an earlier field: the same label once spaces
 * and punctuation are ignored ("Voice Mannerisms" / "Voice & Mannerisms"), and
 * the same text. Sheets that carry an old hand-written key next to the key the
 * plugin writes read back as two such fields; the Codex page shows one.
 */
export function isEchoOfEarlierField(field: { label: string; value: string }, earlier: ReadonlyArray<{ label: string; value: string }>): boolean {
	const squash = (label: string) => label.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
	const value = field.value.trim();
	return earlier.some((e) => e !== field && squash(e.label) === squash(field.label) && e.value.trim() === value);
}

/**
 * Frontmatter keys for a whole field set, de-duplicated.
 *
 * Distinct labels can slug to the same key — "Age?" and "Age!" both give
 * `age` — and without this the second field silently overwrites the first on
 * save. Suffixes are handed out in field order, so the result is deterministic
 * for a given field set; the resolved key is recorded in the schema sidecar so
 * the parser never has to re-derive it.
 */
export function slugsForLabels(labels: string[], taken: Iterable<string> = []): string[] {
	// `taken`: keys already on the sheet that are not ours to write (the
	// writer's own properties). A field never lands on one; it gets `-2`.
	const used = new Set<string>(taken);
	return labels.map((label) => {
		const base = slugForLabel(label);
		let key = base;
		for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
		used.add(key);
		return key;
	});
}

/**
 * Wrap a string as a double-quoted YAML scalar, escaping what YAML requires.
 *
 * The backslash escape is the one that matters: a value ending in a backslash
 * — a Windows path, a LaTeX macro — used to be written as `key: "C:\"`, where
 * that trailing backslash escapes the closing quote and destroys the whole
 * frontmatter block. A sheet whose frontmatter will not parse vanishes from the
 * Codex. `unquoteYaml` is the exact inverse.
 */
export function yamlQuote(s: string): string {
	const escaped = s
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t');
	return `"${escaped}"`;
}

function unescapeDoubleQuoted(s: string): string {
	return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_m, seq: string) => {
		if (seq[0] === 'u' || seq[0] === 'x') return String.fromCharCode(parseInt(seq.slice(1), 16));
		switch (seq) {
			case 'n': return '\n';
			case 't': return '\t';
			case 'r': return '\r';
			case 'b': return '\b';
			case 'f': return '\f';
			case '0': return '\0';
			// Everything else — including an escaped backslash and an escaped
			// quote — is the character itself.
			default: return seq;
		}
	});
}

/**
 * Strip the quotes from a YAML scalar and undo its escapes — the single
 * unquoter for the whole plugin. There used to be three partial copies (here,
 * and twice inside the parser), each handling a different subset of the escape
 * rules, which meant a value could survive one reader and be mangled by
 * another. Obsidian's own YAML writer emits the full escape set, so anything
 * less than this loses data on a sheet Obsidian has touched.
 */
export function unquoteYaml(s: string): string {
	const t = s.trim();
	if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
		return unescapeDoubleQuoted(t.slice(1, -1));
	}
	if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
		return t.slice(1, -1).replace(/''/g, "'");
	}
	return s;
}

/**
 * Split the inside of a YAML flow sequence/map on top-level commas, respecting
 * quoted strings and nesting — a table is a sequence of maps, so a comma inside
 * `{...}` must not end the item.
 */
export function splitFlowItems(inner: string): string[] {
	const out: string[] = [];
	let cur = '';
	let inQuotes = false;
	let quoteChar = '';
	let depth = 0;
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i];
		if (inQuotes) {
			cur += c;
			if (c === quoteChar && inner[i - 1] !== '\\') inQuotes = false;
		} else if (c === '"' || c === "'") {
			inQuotes = true;
			quoteChar = c;
			cur += c;
		} else if (c === '{' || c === '[') {
			depth++;
			cur += c;
		} else if (c === '}' || c === ']') {
			depth--;
			cur += c;
		} else if (c === ',' && depth === 0) {
			out.push(cur.trim());
			cur = '';
		} else {
			cur += c;
		}
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}

/**
 * Encode a field's canonical string `value` as the YAML right-hand side for
 * frontmatter (everything after `key: `). Returns null for types that never
 * live in frontmatter (image → infobox embed, textarea → prose section) or
 * whose value is empty (empty fields are omitted from frontmatter entirely).
 */
export function encodeYamlValue(type: FieldType, value: string, config?: FieldConfig): string | null {
	const v = value.trim();
	switch (type) {
		case 'image':
		case 'textarea':
			return null;
		case 'text':
		case 'storydate':
			return v ? yamlQuote(v) : null;
		case 'select':
			return v ? yamlQuote(v) : null;
		case 'color':
			return v ? yamlQuote(v) : null;
		case 'tags': {
			const items = v.split(',').map((t) => t.trim()).filter(Boolean);
			if (items.length === 0) return null;
			return `[${items.map((t) => yamlQuote(t)).join(', ')}]`;
		}
		case 'number':
		case 'slider': {
			if (v === '' || Number.isNaN(Number(v))) return null;
			return String(Number(v));
		}
		case 'checkbox':
			return v === '' ? null : String(v === 'true');
		case 'date':
			return v || null; // unquoted — Obsidian's YAML parser reads this as a date
		case 'matrix': {
			if (!v) return null;
			const [xs, ys] = v.split(',');
			const x = Number((xs ?? '').trim());
			const y = Number((ys ?? '').trim());
			if (Number.isNaN(x) || Number.isNaN(y)) return null;
			return `{x: ${x}, y: ${y}}`;
		}
		case 'list': {
			const items = parseListItems(v);
			if (items.length === 0) return null;
			return `[${items.map((t) => yamlQuote(t)).join(', ')}]`;
		}
		case 'table': {
			// Written as a flow sequence of maps keyed by column name, so the data
			// stays legible in the note and queryable by other plugins rather than
			// being an opaque blob.
			const rows = parseTableRows(v);
			if (rows.length === 0) return null;
			const columns = config?.columns ?? [];
			const encoded = rows.map((row) => {
				const pairs = row.map((cell, i) => `${yamlQuote(columns[i] ?? `column${i + 1}`)}: ${yamlQuote(cell)}`);
				return `{${pairs.join(', ')}}`;
			});
			return `[${encoded.join(', ')}]`;
		}
		default:
			return assertNever(type);
	}
}

/**
 * Encode a field's canonical string `value` as a **native JavaScript value** for
 * `app.fileManager.processFrontMatter`, which serializes the YAML itself.
 * Returns `undefined` for a field that does not belong in frontmatter at all
 * (an image lives as a body embed) or that is empty — in both cases the caller
 * omits the key.
 *
 * The twin of `encodeYamlValue`, which produces YAML *source text* for the
 * hand-written document builder. Two representations of the same mapping is one
 * more than anybody wants, but they are genuinely different targets: one hands
 * Obsidian a value, the other hands it a string of YAML. Keeping them
 * side-by-side in this file is what stops them drifting.
 *
 * One deliberate difference: `textarea` returns its text here, where
 * `encodeYamlValue` returns null. That is not a divergence in behaviour — the
 * document builder handles `text` and `textarea` in its own branch before it
 * ever calls `encodeYamlValue`, and both end up in frontmatter. Here there is no
 * second branch, so the rule lives in one place.
 */
export function toYamlValue(type: FieldType, value: string, config?: FieldConfig): unknown {
	const v = value.trim();
	switch (type) {
		case 'image':
			return undefined;
		case 'text':
		case 'textarea':
			// Untrimmed on purpose: this is what the document builder writes, and a
			// deliberate trailing blank line in a long-text field is the writer's.
			return v === '' ? undefined : value;
		case 'select':
		case 'color':
		case 'storydate':
		case 'date':
			return v === '' ? undefined : v;
		case 'tags': {
			const items = v.split(',').map((t) => t.trim()).filter(Boolean);
			return items.length === 0 ? undefined : items;
		}
		case 'number':
		case 'slider': {
			if (v === '' || Number.isNaN(Number(v))) return undefined;
			return Number(v);
		}
		case 'checkbox':
			return v === '' ? undefined : v === 'true';
		case 'matrix': {
			if (!v) return undefined;
			const [xs, ys] = v.split(',');
			const x = Number((xs ?? '').trim());
			const y = Number((ys ?? '').trim());
			if (Number.isNaN(x) || Number.isNaN(y)) return undefined;
			return { x, y };
		}
		case 'list': {
			const items = parseListItems(v);
			return items.length === 0 ? undefined : items;
		}
		case 'table': {
			// A sequence of maps keyed by column name — the same shape
			// `encodeYamlValue` writes, so a table stays legible in the note and
			// queryable by other plugins rather than being an opaque blob.
			const rows = parseTableRows(v);
			if (rows.length === 0) return undefined;
			const columns = config?.columns ?? [];
			return rows.map((row) => {
				const out: Record<string, string> = {};
				row.forEach((cell, i) => {
					out[columns[i] ?? `column${i + 1}`] = cell;
				});
				return out;
			});
		}
		default:
			return assertNever(type);
	}
}

/**
 * Decode a raw frontmatter right-hand side (already isolated by the parser,
 * quotes/brackets intact) back into the field's canonical string `value`.
 * Inverse of `encodeYamlValue`.
 */
export function decodeValue(type: FieldType, raw: string, config?: FieldConfig): string {
	const v = raw.trim();
	switch (type) {
		// Every scalar branch unquotes exactly once: the frontmatter reader hands
		// over YAML source with the quotes intact (block scalars arrive re-quoted
		// to keep that contract), so unquoting is this function's job alone.
		case 'image':
		case 'textarea':
		case 'text':
		case 'select':
		case 'color':
		case 'storydate':
			return unquoteYaml(v);
		case 'tags': {
			if (v.startsWith('[') && v.endsWith(']')) {
				return splitFlowItems(v.slice(1, -1)).map(unquoteYaml).join(', ');
			}
			return unquoteYaml(v);
		}
		case 'number':
		case 'slider':
		case 'checkbox':
		case 'date':
			// Obsidian keeps quotes on values that would otherwise change type
			// unquoted (`age: "114"`), so these strip them too.
			return unquoteYaml(v);
		case 'matrix': {
			if (v.startsWith('{') && v.endsWith('}')) {
				let x = 0;
				let y = 0;
				for (const part of splitFlowItems(v.slice(1, -1))) {
					const idx = part.indexOf(':');
					if (idx === -1) continue;
					const key = part.slice(0, idx).trim();
					const num = Number(part.slice(idx + 1).trim());
					if (key === 'x') x = num;
					else if (key === 'y') y = num;
				}
				return `${x},${y}`;
			}
			return unquoteYaml(v);
		}
		case 'list': {
			if (v.startsWith('[') && v.endsWith(']')) {
				return splitFlowItems(v.slice(1, -1)).map(unquoteYaml).join('\n');
			}
			return unquoteYaml(v);
		}
		case 'table': {
			if (!v.startsWith('[') || !v.endsWith(']')) return '';
			const columns = config?.columns;
			const rows: string[][] = [];
			for (const item of splitFlowItems(v.slice(1, -1))) {
				const inner = item.trim();
				if (!inner.startsWith('{') || !inner.endsWith('}')) continue;
				const cells = new Map<string, string>();
				const order: string[] = [];
				for (const pair of splitFlowItems(inner.slice(1, -1))) {
					const idx = pair.indexOf(':');
					if (idx === -1) continue;
					const key = unquoteYaml(pair.slice(0, idx).trim());
					cells.set(key, unquoteYaml(pair.slice(idx + 1).trim()));
					order.push(key);
				}
				// Prefer the schema's column order; fall back to the order written
				// in the note when a table has no schema entry to lean on.
				const keys = columns ?? order;
				rows.push(keys.map((k) => cells.get(k) ?? ''));
			}
			return stringifyTableRows(rows);
		}
		default:
			return assertNever(type);
	}
}

/** Format a field's value for read-only display (infobox table, detail page). Empty value → ''. */
export function formatFieldValue(type: FieldType, value: string, config?: FieldConfig): string {
	const v = value.trim();
	if (!v) return '';
	switch (type) {
		case 'text':
		case 'select':
		case 'date':
		case 'textarea':
		case 'image':
		case 'number':
		case 'color':
			return v;
		case 'tags': {
			const items = v.split(',').map((t) => t.trim()).filter(Boolean);
			// Entity-link tags must render as real wikilinks, not code chips —
			// otherwise Obsidian's own backlinks and graph never see the relation.
			return config?.entityLink
				? items.map((t) => `[[${t}]]`).join(', ')
				: items.map((t) => `\`${t}\``).join(' ');
		}
		case 'slider': {
			const max = config?.max ?? 100;
			return `${v} / ${max}`;
		}
		case 'checkbox':
			return v === 'true' ? '✓' : '✗';
		case 'matrix': {
			const [xs, ys] = v.split(',');
			const x = Number(xs);
			const y = Number(ys);
			const [xNeg, xPos] = config?.xAxis ?? ['', ''];
			const [yNeg, yPos] = config?.yAxis ?? ['', ''];
			const xLabel = x >= 0 ? xPos : xNeg;
			const yLabel = y >= 0 ? yPos : yNeg;
			const xPart = xLabel ? `${xLabel} ${x}` : `${x}`;
			const yPart = yLabel ? `${yLabel} ${y}` : `${y}`;
			return `${xPart} · ${yPart}`;
		}
		case 'list':
			return parseListItems(v).map((item) => `- ${item}`).join('\n');
		case 'table': {
			const rows = parseTableRows(v);
			if (rows.length === 0) return '';
			const columns = config?.columns ?? [];
			const header = `| ${columns.join(' | ')} |`;
			const divider = `|${columns.map(() => ' --- ').join('|')}|`;
			const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
			return `${header}\n${divider}\n${body}`;
		}
		case 'storydate': {
			// Plain numeric rendering — no calendar available here (custom month
			// names etc. render via timeline/calendar.ts's formatStoryDate once a
			// project's actual calendar is in scope, e.g. the Timeline view).
			const date = parseStoryDateJson(v);
			if (!date) return '';
			const parts: string[] = [];
			if (date.era) parts.push(date.era);
			parts.push(`Year ${date.year}`);
			if (date.month != null) parts.push(`Month ${date.month}`);
			if (date.day != null) parts.push(`Day ${date.day}`);
			if (date.minute != null) parts.push(`${date.minute}m`);
			return parts.join(', ');
		}
		default:
			return assertNever(type);
	}
}

/**
 * True when a field holds no author-entered information and should be hidden
 * from read-only previews. Complements defaultValueForType: a slider resting
 * at min, an unchecked checkbox, or a dead-centre matrix count as empty even
 * though their stored value is non-blank.
 */
export function isFieldEmpty(type: FieldType, value: string, config?: FieldConfig): boolean {
	const v = value.trim();
	switch (type) {
		case 'text':
		case 'textarea':
		case 'tags':
		case 'image':
		case 'number':
		case 'select':
		case 'date':
		case 'color':
			return v === '';
		case 'slider':
			return v === '' || Number(v) === (config?.min ?? 0);
		case 'checkbox':
			return v === '' || v === 'false';
		case 'matrix': {
			if (v === '') return true;
			const [xs, ys] = v.split(',');
			return Number(xs ?? '0') === 0 && Number(ys ?? '0') === 0;
		}
		case 'list':
			return parseListItems(v).length === 0;
		case 'table':
			return parseTableRows(v).length === 0;
		case 'storydate':
			return parseStoryDateJson(v) === null;
		default:
			return assertNever(type);
	}
}
