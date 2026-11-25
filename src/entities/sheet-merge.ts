import type { CharacterField } from '../grid-data';
import type { FieldSnapshot } from './entity-write';
import { makeFieldLabelsUnique } from './field-labels';
import { parseRelationLines, RelationLine, serializeRelationLine } from '../utils/relations';

/**
 * Saving a sheet that changed on disk while its editor was open — another
 * sheet's relationship mirrored into it, a rename in the Codex, a hand edit,
 * Sync. Pure (no Obsidian), so every rule here is tested.
 *
 * A three-way merge, field by field, of the sheet as the editor OPENED it,
 * as it is on disk NOW, and as the writer has it. Nothing either side wrote
 * is ever dropped:
 * - a field the writer left alone takes what is on disk now;
 * - a field the writer changed keeps the writer's value, and when the disk
 *   changed it too:
 *   · Relationships: line by line — lines added or removed elsewhere are
 *     carried over, so relationships stay two-sided;
 *   · a list: item by item, the same way;
 *   · any other text: the writer's text stays exactly as written, and
 *     paragraphs that are new on disk are added after it;
 *   · a single value (a name, a date…): the writer's;
 * - a field deleted on disk stays deleted unless the writer changed it;
 *   a field added on disk is kept (renamed if the writer used its name);
 * - name: the writer's when they changed it, otherwise disk's; aliases and
 *   pictures merge the same three ways.
 */

/** A field as it was when the editor opened (the editor changes its field objects in place, so this is a copy). */
export interface OpenField {
	id: string;
	label: string;
	type: CharacterField['type'];
	value: string;
}

export interface SheetVersion<F> {
	name: string;
	aliases: string[];
	fields: F[];
}

export interface MergedSheet {
	name: string;
	aliases: string[];
	/** What to write: ids match the disk's fields wherever a field still exists there. */
	fields: CharacterField[];
	/** The disk's fields as they are now — what `updateEntitySheet` diffs the write against. */
	before: FieldSnapshot[];
}

/** How a text block merges when both sides changed it. */
export type BlockKind = 'relations' | 'list' | 'prose';

function sameLabel(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** The block the relationship mirror writes into (the rule `editRelationshipsField` follows). */
function blockKind(field: { label: string; type: CharacterField['type'] }): BlockKind | null {
	if (field.type === 'list') return 'list';
	if (field.type !== 'textarea') return null;
	return /relationship/i.test(field.label) ? 'relations' : 'prose';
}

function linesOf(text: string): string[] {
	return text.replace(/\r\n/g, '\n').split('\n');
}

function trimEndBlank(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && !lines[end - 1].trim()) end--;
	return lines.slice(0, end);
}

/** The labeled relationships a line declares ("Sister: [[Tom]]"); a bare [[link]] in a sentence is not one. */
function labeledRelations(line: string): RelationLine[] {
	return parseRelationLines(line).filter((r) => r.label);
}

const relationKey = (r: RelationLine): string => `${r.label.toLowerCase()}→${r.target.toLowerCase()}`;

/** "Sister: [[B]]" and nothing more (a leading "- " allowed): one relationship, no other words, no note. */
function isPlainLine(line: string): boolean {
	const rels = labeledRelations(line);
	if (rels.length !== 1) return false;
	const text = line.trim().replace(/^[-*]\s*/, '');
	return text === serializeRelationLine({ label: rels[0].label, target: rels[0].target });
}

/** Three ways, one item list (aliases): the writer's, plus added elsewhere, minus removed elsewhere and left alone by the writer. */
export function mergeItems(base: readonly string[], disk: readonly string[], mine: readonly string[]): string[] {
	const out = mine.filter((a) => !(base.includes(a) && !disk.includes(a)));
	for (const a of disk) if (!base.includes(a) && !out.includes(a)) out.push(a);
	return out;
}

/** Lines: the writer's, minus lines removed elsewhere that the writer left as they were. */
function withoutRemovedLines(base: string, disk: string, mine: string): string[] {
	const baseSet = new Set(linesOf(base).map((l) => l.trim()).filter(Boolean));
	const diskSet = new Set(linesOf(disk).map((l) => l.trim()).filter(Boolean));
	return linesOf(mine).filter((l) => {
		const t = l.trim();
		return !t || !baseSet.has(t) || diskSet.has(t);
	});
}

/**
 * Three-way merge of one text block whose writer's AND disk's text both
 * changed since the editor opened. See the module comment.
 */
export function mergeTextBlock(kind: BlockKind, base: string, disk: string, mine: string): string {
	if (kind === 'prose') {
		// Paragraph by paragraph: the writer's words exactly as written, minus
		// paragraphs deleted elsewhere that the writer left as they were; then
		// the paragraphs new elsewhere. A paragraph edited on both sides keeps
		// both versions — never one silently.
		const split = (text: string) => text.replace(/\r\n/g, '\n').split(/\n[ \t]*\n/);
		const paragraphs = (text: string) => split(text).map((p) => p.trim()).filter(Boolean);
		const baseParas = paragraphs(base);
		const diskList = paragraphs(disk);
		const baseSet = new Set(baseParas);
		const diskSet = new Set(diskList);
		// Edited elsewhere, paragraph for paragraph (same count, same places):
		// the new version takes the old one's place in the writer's text.
		const edited = new Map<string, string>();
		if (baseParas.length === diskList.length) {
			baseParas.forEach((p, i) => {
				const now = diskList[i];
				if (p !== now && !diskSet.has(p) && !baseSet.has(now)) edited.set(p, now);
			});
		}
		const removed = new Set(baseParas.filter((p) => !diskSet.has(p)));
		const placed = new Set<string>();
		const mineParts = split(mine);
		let changed = false;
		const parts: string[] = [];
		for (const part of mineParts) {
			const t = part.trim();
			const replacement = edited.get(t);
			if (replacement !== undefined) {
				parts.push(replacement);
				placed.add(replacement);
				changed = true;
			} else if (removed.has(t)) {
				changed = true;
			} else {
				parts.push(part);
			}
		}
		const own = changed ? parts.join('\n\n') : mine;
		const known = new Set([...baseParas, ...paragraphs(mine), ...placed]);
		const added = diskList.filter((p) => !known.has(p));
		if (added.length === 0) return own;
		return [trimEndBlank(linesOf(own)).join('\n'), ...added].filter(Boolean).join('\n\n');
	}

	const baseSet = new Set(linesOf(base).map((l) => l.trim()).filter(Boolean));
	const out = withoutRemovedLines(base, disk, mine);
	const outSet = new Set(out.map((l) => l.trim()).filter(Boolean));
	const keys = new Set(kind === 'relations' ? out.flatMap((l) => labeledRelations(l).map(relationKey)) : []);
	const added: string[] = [];
	for (const line of linesOf(disk).map((l) => l.trim()).filter(Boolean)) {
		if (baseSet.has(line) || outSet.has(line)) continue;
		const rels = kind === 'relations' ? labeledRelations(line) : [];
		if (rels.length === 0) {
			added.push(line);
			outSet.add(line);
			continue;
		}
		const missing = rels.filter((r) => !keys.has(relationKey(r)));
		if (missing.length === 0) {
			// The writer already has every relationship on this line. A bare
			// "Sister: [[B]]" adds nothing; a line with more words or a note does:
			// it replaces the writer's own bare line for it, or else joins the
			// block — words are never dropped (a repeated relationship is the
			// lesser harm).
			if (isPlainLine(line)) continue;
			const i = rels.length === 1
				? out.findIndex((l) => isPlainLine(l) && labeledRelations(l).some((r) => relationKey(r) === relationKey(rels[0])))
				: -1;
			if (i >= 0) out[i] = line;
			else added.push(line);
			outSet.add(line);
			continue;
		}
		// Only the relationships the writer doesn't have yet — never one twice.
		const lines = missing.length === rels.length ? [line] : missing.map(serializeRelationLine);
		for (const l of lines) {
			added.push(l);
			outSet.add(l);
		}
		for (const r of missing) keys.add(relationKey(r));
	}
	if (added.length === 0) return out.join('\n');
	return [...trimEndBlank(out), ...added].join('\n');
}

/** A changed-on-both-sides value: merged by kind of block, or the writer's. */
function mergeValue(field: { label: string; type: CharacterField['type'] }, base: string, disk: string, mine: string): string {
	const kind = blockKind(field);
	return kind ? mergeTextBlock(kind, base, disk, mine) : mine;
}

/**
 * Merge the writer's version of a sheet with what is on disk now, given the
 * sheet as the editor opened it. See the module comment for the rules.
 * Never changes the objects it is given.
 */
export function mergeSheetSave(
	open: SheetVersion<OpenField>,
	disk: SheetVersion<CharacterField>,
	mine: SheetVersion<CharacterField>,
): MergedSheet {
	const name = mine.name.trim() === open.name.trim() ? disk.name : mine.name;
	const aliases = mergeItems(open.aliases, disk.aliases, mine.aliases);
	const before: FieldSnapshot[] = disk.fields.map((f) => ({ id: f.id, label: f.label, type: f.type }));

	// Pictures: the disk's when the writer left them alone; the writer's when
	// they changed them, written into the disk's picture slots in order (the
	// sheet's embeds are matched by order), so untouched embeds keep their place.
	const openImages = open.fields.filter((f) => f.type === 'image').map((f) => f.value);
	const mineImages = mine.fields.filter((f) => f.type === 'image');
	const diskImages = disk.fields.filter((f) => f.type === 'image');
	const images: CharacterField[] = sameList(mineImages.map((f) => f.value), openImages)
		? diskImages.map((d) => ({ ...d }))
		: mineImages.map((m, i) => ({ ...m, id: diskImages[i]?.id ?? m.id }));

	// Every other field: each field the editor opened with, matched to the disk
	// field of the same name (first unused one, in order).
	const diskFields = disk.fields.filter((f) => f.type !== 'image');
	const used = new Set<string>();
	const openToDisk = new Map<string, CharacterField>();
	for (const o of open.fields) {
		if (o.type === 'image') continue;
		const d = diskFields.find((f) => !used.has(f.id) && sameLabel(f.label, o.label));
		if (d) {
			used.add(d.id);
			openToDisk.set(o.id, d);
		}
	}
	const openById = new Map(open.fields.map((o) => [o.id, o]));
	const mineIds = new Set(mine.fields.map((f) => f.id));
	const claimed = new Set<string>();
	const out: CharacterField[] = [];

	for (const m of mine.fields) {
		if (m.type === 'image') continue;
		const o = openById.get(m.id);
		if (!o) {
			// Added in the editor. Added on disk too, under the same name: one field, both sides' text.
			const d = diskFields.find((f) => !used.has(f.id) && !claimed.has(f.id) && sameLabel(f.label, m.label) && f.type === m.type);
			if (d) {
				claimed.add(d.id);
				out.push({ ...m, id: d.id, value: mergeValue(m, '', d.value, m.value) });
			} else {
				out.push({ ...m });
			}
			continue;
		}
		const changed = m.value !== o.value || !sameLabel(m.label, o.label) || m.type !== o.type;
		const d = openToDisk.get(o.id);
		if (!d) {
			// Deleted on disk: stays deleted, unless the writer changed it (then it comes back as theirs).
			if (changed) out.push({ ...m });
			continue;
		}
		claimed.add(d.id);
		if (!changed) {
			out.push({ ...m, id: d.id, label: d.label, type: d.type, value: d.value });
		} else if (d.value === o.value) {
			out.push({ ...m, id: d.id });
		} else {
			const value = m.type === o.type ? mergeValue(m, o.value, d.value, m.value) : m.value;
			out.push({ ...m, id: d.id, value });
		}
	}

	// Fields the writer deleted: they go — but text added on disk meanwhile
	// (a mirrored relationship line, a paragraph) stays, in the field it was written to.
	for (const o of open.fields) {
		if (o.type === 'image' || mineIds.has(o.id)) continue;
		const d = openToDisk.get(o.id);
		if (!d || d.value === o.value || !blockKind(d)) continue;
		const kept = mergeValue(d, o.value, d.value, '');
		if (kept.trim()) {
			claimed.add(d.id);
			out.push({ ...d, value: kept });
		}
	}

	// Fields added on disk while the editor was open: kept as they are, last,
	// so if the writer gave one of theirs the same name, the disk's is renamed.
	for (const d of diskFields) {
		if (!used.has(d.id) && !claimed.has(d.id)) out.push({ ...d });
	}
	makeFieldLabelsUnique(out);

	return { name, aliases, fields: [...out, ...images], before };
}
