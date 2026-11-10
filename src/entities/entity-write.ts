import type { App, TFile } from 'obsidian';
import { CharacterField, generateEntityId } from '../grid-data';
import { EntityKind } from './entity-kinds';
import { START_MODE_KEY, CLEAN_SLATE_VALUE } from './start-mode';
import { buildEntityBody, buildEntityFrontmatter, isBlockField } from './entity-doc';
import { applyFields, parseBody, renderBody, setTitle } from './entity-body';
import { parseEntityDocument, splitFrontmatter } from './entity-parse';
import { slugsForLabels, toYamlValue } from './field-types';
import { RelationLine, fieldsToRelationSections, parseRelationLines } from '../utils/relations';

/**
 * The one place Plotverk writes an entity sheet's frontmatter.
 *
 * It never serializes YAML itself. The body is written as plain text and the
 * frontmatter is handed to `app.fileManager.processFrontMatter`, which parses
 * the block, lets us mutate a plain object, and re-serializes it. Three things
 * fall out of that:
 *
 *  - Values that used to break the block — one ending in a backslash, a label
 *    in a script with no ASCII letters — are now Obsidian's problem to encode,
 *    and it encodes them correctly. A sheet whose frontmatter will not parse
 *    disappears from the Codex, so this was never cosmetic.
 *  - Keys we do not know about are left alone. A writer's own `tags:`, a
 *    Dataview field, a Templater stamp: all survive a save.
 *  - Only the frontmatter block is touched. Prose is never rewritten.
 *
 * The merge rule is a pure function so it can be tested without Obsidian —
 * there is no Obsidian mock in this repo.
 */

/** Is this one of the `cssclasses` entries Plotverk puts there? */
function isOwnedCssClass(value: string): boolean {
	return value === 'storygrid-sheet' || value.startsWith('sg-sheet-');
}

/**
 * Merge our sheet classes into whatever `cssclasses` already holds, keeping
 * anyone else's classes and dropping only our own stale ones (which is what
 * makes changing an entity's kind clean up the old `sg-sheet-*` class).
 * Idempotent: saving twice does not reshuffle the list.
 */
export function mergeSheetCssClasses(existing: unknown, ours: string[]): string[] {
	const before = Array.isArray(existing)
		? existing.map((c) => String(c))
		: typeof existing === 'string' && existing.trim()
			? [existing.trim()]
			: [];
	const kept = before.filter((c) => !isOwnedCssClass(c) && !ours.includes(c));
	return [...ours, ...kept];
}

/**
 * Write the frontmatter keys Plotverk owns into `fm`, in place, leaving every
 * other key untouched.
 *
 * `staleKeys` are keys the caller knows *used* to be ours — the field keys it
 * read out of the sheet before the writer renamed or removed those fields. Only
 * those are deleted, and only when the new frontmatter has no value for them.
 * Nothing else is ever removed: the writer cannot tell a key it has never seen
 * from a key the user added by hand, so it does not guess.
 */
export function applyOwnedFrontmatter(
	fm: Record<string, unknown>,
	owned: Record<string, unknown>,
	staleKeys: readonly string[] = []
): void {
	for (const key of staleKeys) {
		if (!(key in owned)) delete fm[key];
	}
	for (const [key, value] of Object.entries(owned)) {
		// cssclasses is shared ground — merge rather than overwrite.
		fm[key] = key === 'cssclasses' ? mergeSheetCssClasses(fm[key], value as string[]) : value;
	}
}

/**
 * Replace only the `# Title` line of a full sheet document. The frontmatter is
 * passed through verbatim and the body goes through `entity-body`'s byte-exact
 * blocks, so every other byte of the file survives — including the entity's
 * `storygrid-id` and aliases, which the old parse-and-rebuild rename dropped.
 */
export function retitleDocument(content: string, name: string): string {
	const { frontmatter, body } = splitFrontmatter(content);
	return frontmatter + renderBody(setTitle(parseBody(body), name));
}

/**
 * Rewrite only a sheet's picture lines (the embeds above the first section,
 * which the parser reads as image fields), in order. `images` holds the link
 * text for every slot: an unchanged value keeps its line, '' removes that
 * line, and extra values are added after the last picture. Every other byte
 * of the sheet — frontmatter included — survives.
 */
export function writeSheetImages(content: string, kind: EntityKind, images: readonly string[]): string {
	const { frontmatter, body } = splitFrontmatter(content);
	const fields: CharacterField[] = images.map((value, i) => ({ id: `image-${i}`, label: 'Image', value, type: 'image' }));
	return frontmatter + renderBody(applyFields(parseBody(body), fields, kind));
}

/** Rename a sheet's title in place, atomically. The caller renames the file itself. */
export async function retitleEntitySheet(app: App, file: TFile, name: string): Promise<void> {
	await app.vault.process(file, (content) => retitleDocument(content, name));
}

/**
 * Append an alias to whatever `aliases` already holds — absent, a single
 * string, or a list (Obsidian's Properties panel writes a block sequence, and
 * entries someone typed by hand may not even be strings; they all survive).
 * Returns `null` when the alias is already present, so the caller can skip the
 * write entirely.
 */
export function appendAlias(existing: unknown, alias: string): unknown[] | null {
	const before: unknown[] = Array.isArray(existing)
		? existing
		: typeof existing === 'string' && existing.trim()
			? [existing]
			: [];
	if (before.some((a) => typeof a === 'string' && a === alias)) return null;
	return [...before, alias];
}

/**
 * Add `alias` to the sheet's `aliases` frontmatter. Frontmatter-only — the body
 * is never read, parsed, or rewritten.
 */
export async function addEntityAlias(app: App, file: TFile, alias: string): Promise<'added' | 'duplicate'> {
	let result: 'added' | 'duplicate' = 'duplicate';
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		const next = appendAlias(fm['aliases'], alias);
		if (next !== null) {
			fm['aliases'] = next;
			result = 'added';
		}
	});
	return result;
}

/**
 * What the Edit-sheet save remembers about each field from BEFORE the modal
 * opened. The modal mutates the very field objects it was given (labels are
 * edited in place), so by save time the input list no longer shows what was on
 * disk — this snapshot does.
 */
export interface FieldSnapshot {
	id: string;
	label: string;
	type: CharacterField['type'];
}

/** Same body destination (infobox row / prose section / embed)? A field that moved must clear its old home. */
function sameFamily(a: CharacterField['type'], b: CharacterField['type']): boolean {
	const family = (t: CharacterField['type']) =>
		t === 'image' ? 'image' : isBlockField({ id: '', label: '', value: '', type: t }) ? 'block' : 'scalar';
	return family(a) === family(b);
}

function labelsMatch(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Turn the modal's before/after picture into the field list `applyFields`
 * needs, with deletions made explicit.
 *
 * `applyFields` is deliberately non-destructive: a section it is not told
 * about is kept, because hand-written prose and a just-deleted field's section
 * look identical on disk. The save path is the only place that knows the
 * difference — a field in `before` whose id is gone from `after` was deleted
 * by the writer, not written by hand. Those (and the old label of a relabeled
 * or re-typed field) come back as empty-valued entries, which `applyFields`
 * reads as "explicitly cleared: remove the row/section/embed".
 *
 * Images are matched to embeds positionally, so their write order must mirror
 * the parse order: deleted ones become placeholders in their original slot,
 * kept ones stay in disk order (even if the modal reordered them), and new
 * ones append.
 */
export function planFieldWrites(before: readonly FieldSnapshot[], after: CharacterField[]): CharacterField[] {
	const afterById = new Map(after.map((f) => [f.id, f]));

	const cleared: CharacterField[] = [];
	for (const b of before) {
		if (b.type === 'image') continue;
		const now = afterById.get(b.id);
		// Kept, same home: applyFields edits it in place (labels compare
		// case-insensitively there too, so a case-only relabel is an in-place edit).
		if (now && labelsMatch(now.label, b.label) && sameFamily(now.type, b.type)) continue;
		cleared.push({ id: `cleared-${b.id}`, label: b.label, value: '', type: b.type });
	}

	const beforeImages = before.filter((b) => b.type === 'image');
	const beforeImageIds = new Set(beforeImages.map((b) => b.id));
	const imageWrites: CharacterField[] = beforeImages.map((b) => {
		const now = afterById.get(b.id);
		return now && now.type === 'image'
			? now
			: { id: `cleared-${b.id}`, label: b.label, value: '', type: 'image' };
	});
	for (const f of after) {
		if (f.type === 'image' && !beforeImageIds.has(f.id)) imageWrites.push(f);
	}

	// Clears go first so a relabel removes the old block before the new label
	// writes — otherwise a case-insensitive match could delete the fresh write.
	return [...cleared, ...after.filter((f) => f.type !== 'image'), ...imageWrites];
}

/**
 * The preserving Edit-sheet save, body half, as a pure function: retitle, then
 * write the planned fields into the blocks they came from. Frontmatter passes
 * through verbatim (it is Obsidian's to rewrite, via `processFrontMatter`);
 * every body byte the writer did not explicitly change survives.
 */
export function applyEntityEdits(content: string, kind: EntityKind, name: string, writes: CharacterField[]): string {
	const { frontmatter, body } = splitFrontmatter(content);
	const doc = applyFields(setTitle(parseBody(body), name), writes, kind);
	return frontmatter + renderBody(doc);
}

export interface UpdateEntitySheetOptions {
	kind: EntityKind;
	name: string;
	/** The fields as the modal returned them. */
	fields: CharacterField[];
	/** Snapshot of the field list the modal was OPENED with — see FieldSnapshot. */
	before: readonly FieldSnapshot[];
	/** From the parse that fed the modal; a legacy sheet without one gets stamped. */
	entityId?: string;
	aliases?: string[];
	/** `ParsedEntity.ownedKeys` — the on-disk frontmatter keys a save may clean up. */
	staleKeys?: readonly string[];
}

/**
 * Save an edited entity sheet in place. The body is edited block-wise
 * (atomically, via `vault.process`); the frontmatter goes through
 * `processFrontMatter`, writing only our keys and deleting only `staleKeys`
 * that are no longer written. Replaces the old save's parse-and-rebuild, which
 * kept only what the builder knew how to emit.
 */
export async function updateEntitySheet(app: App, file: TFile, opts: UpdateEntitySheetOptions): Promise<void> {
	const writes = planFieldWrites(opts.before, opts.fields);
	await app.vault.process(file, (content) => applyEntityEdits(content, opts.kind, opts.name, writes));
	const owned = buildEntityFrontmatter(opts.kind, opts.fields, opts.entityId ?? generateEntityId(), opts.aliases);
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		applyOwnedFrontmatter(fm, owned, opts.staleKeys ?? []);
	});
}

/** The result of {@link editRelationshipsField}: the new document and the frontmatter half of the same change. */
export interface RelationshipsFieldEdit {
	content: string;
	/** The field's new text ('' = the section was removed). */
	value: string;
	/** The frontmatter key the field lives under. */
	key: string;
}

/**
 * Edit only the Relationships field of an existing sheet, as a pure function —
 * the write half of two-sided relationships (another sheet's line changed, so
 * this one follows). `edit` gets the field's text and every relation line the
 * sheet holds elsewhere, and returns the new text.
 *
 * Only that one section is handed to `applyFields`, so every other byte of the
 * body survives (no retitle, no other field rewritten). Returns null when the
 * file is not a Plotverk sheet or nothing changed. A sheet with no
 * Relationships field gets one, the same way the sheet editor would add it.
 */
export function editRelationshipsField(
	content: string,
	fileBasename: string,
	edit: (value: string, elsewhere: RelationLine[]) => string,
): RelationshipsFieldEdit | null {
	const parsed = parseEntityDocument(content, fileBasename);
	if (!parsed.kind) return null;
	const fields = [...parsed.fields];
	// The Relationships field itself first; "Relationship Arc" only when there is no such field.
	let idx = fields.findIndex((f) => f.type === 'textarea' && /^\s*relationships?\s*$/i.test(f.label));
	if (idx < 0) idx = fields.findIndex((f) => f.type === 'textarea' && /relationship/i.test(f.label));
	if (idx < 0) {
		fields.push({ id: 'mirror-relationships', label: 'Relationships', value: '', type: 'textarea' });
		idx = fields.length - 1;
	}
	const field = fields[idx];
	const elsewhere = Object.values(fieldsToRelationSections(fields.filter((_, i) => i !== idx))).flatMap(parseRelationLines);
	const value = edit(field.value, elsewhere);
	if (value === field.value) return null;
	const { frontmatter, body } = splitFrontmatter(content);
	const bodyDoc = parseBody(body);
	// Keep the sheet's own line endings inside the section too.
	const sectionValue = value.replace(/\r?\n/g, bodyDoc.eol);
	const doc = applyFields(bodyDoc, [{ ...field, value: sectionValue }], parsed.kind);
	return { content: frontmatter + renderBody(doc), value, key: slugsForLabels(fields.map((f) => f.label))[idx] };
}

/**
 * The frontmatter half of the same edit: always the Relationships section's
 * new text — the rule the parser and the Edit-sheet save already follow (the
 * body wins). Copying the body, rather than editing the key's own copy, means
 * a write also heals a frontmatter that had fallen behind (older versions
 * wrote mirrored lines into the body only), so after any write both
 * halves say exactly the same lines. A key holding something other than text
 * is replaced too, as the Edit-sheet save would.
 */
export function relationshipsFrontmatterValue(bodyValue: string): { set: unknown } | { remove: true } {
	const yaml = toYamlValue('textarea', bodyValue.replace(/\r\n/g, '\n'));
	return yaml === undefined ? { remove: true } : { set: yaml };
}

/**
 * Apply {@link editRelationshipsField} to a sheet on disk. The body goes through
 * `vault.process`, so the edit runs on the file's CURRENT content (a concurrent
 * save can't be clobbered); then the frontmatter key gets the same new text via
 * `processFrontMatter`, so the two halves always agree. Returns whether
 * anything was written.
 */
export async function updateEntityRelationships(
	app: App,
	file: TFile,
	edit: (value: string, elsewhere: RelationLine[]) => string,
): Promise<boolean> {
	let result: RelationshipsFieldEdit | null = null;
	await app.vault.process(file, (content) => {
		result = editRelationshipsField(content, file.basename, edit);
		return result ? result.content : content;
	});
	const done = result as RelationshipsFieldEdit | null;
	if (!done) return false;
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		const change = relationshipsFrontmatterValue(done.value);
		if ('remove' in change) delete fm[done.key];
		else fm[done.key] = change.set;
	});
	return true;
}

export interface EntitySheetOptions {
	/** Stable `storygrid-id`. One is generated when omitted — an entity with no ID cannot be linked to. */
	entityId?: string;
	aliases?: string[];
	/** Began as a clean slate: marked, in this same write, so edits never refill the template. */
	cleanSlate?: boolean;
}

/**
 * Create an entity sheet at `filePath`: body first, then the frontmatter through
 * Obsidian. The folder must already exist — callers differ on where that is and
 * on what to do when it doesn't.
 */
export async function createEntitySheet(
	app: App,
	filePath: string,
	kind: EntityKind,
	name: string,
	fields: CharacterField[],
	opts: EntitySheetOptions = {}
): Promise<TFile> {
	const file = await app.vault.create(filePath, buildEntityBody(kind, name, fields));
	// Every sheet gets an ID at birth. Sheets created without one used to stay
	// ID-less until the next Obsidian restart stamped them, and anything that
	// links by ID — "link selection to a Codex entity" — could not see them.
	const entityId = opts.entityId ?? generateEntityId();
	const owned = buildEntityFrontmatter(kind, fields, entityId, opts.aliases);
	if (opts.cleanSlate) owned[START_MODE_KEY] = CLEAN_SLATE_VALUE;
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		applyOwnedFrontmatter(fm, owned);
	});
	return file;
}
