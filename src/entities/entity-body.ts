import { CharacterField } from '../grid-data';
import { EntityKind, getKindSpec } from './entity-kinds';
import { formatFieldValue, isFieldEmpty } from './field-types';
import { isBlockField } from './entity-doc';

/**
 * Total, byte-exact model of an entity sheet *body* (everything after the YAML
 * frontmatter).
 *
 * The point of this module is that `renderBody(parseBody(x)) === x` holds for
 * ANY input string — generated, hand-written, or mangled. That is achieved
 * structurally rather than by feature coverage: every block carries the
 * verbatim source text it was parsed from, `renderBody` is a plain
 * concatenation of those texts, and every byte of the input lands in exactly
 * one block (anything unrecognised becomes a `raw` block). So "preserve what
 * we don't understand" is not something a future edit can forget to do.
 *
 * The consequence is that all the risk lives in the mutation helpers
 * (`applyFields`, `setTitle`), which rebuild `text` only for the pieces they
 * touched and leave every other byte alone. Contrast with `entity-doc.ts`,
 * which builds a whole document from scratch and so can only ever contain what
 * it knows how to emit — everything else is lost on save.
 *
 * Pure — no Obsidian imports, so it is unit-testable like `entity-doc.ts`.
 */

/** The `# Name` title line. */
export interface H1Block {
	kind: 'h1';
	text: string;
	title: string;
}

/**
 * The at-a-glance callout: a run of `>` lines opened by `> [!type|sg-infobox]`.
 * Held as raw lines rather than as parsed rows so that anything inside it we do
 * not model — nested callouts, extra prose, hand-written rows — survives an
 * edit that only rewrites one row.
 */
export interface InfoboxBlock {
	kind: 'infobox';
	text: string;
	lines: string[];
}

/** A `## Label` heading plus everything up to the next top-level `## `. */
export interface SectionBlock {
	kind: 'section';
	text: string;
	/** The heading line, verbatim, including its line terminator. */
	heading: string;
	label: string;
	/** Everything after the heading line, verbatim. */
	content: string;
}

/** Anything else: loose prose, tables, embeds, `---` rules, other callouts. */
export interface RawBlock {
	kind: 'raw';
	text: string;
}

export type BodyBlock = H1Block | InfoboxBlock | SectionBlock | RawBlock;

export interface BodyDoc {
	blocks: BodyBlock[];
	/** Line ending of the source document; lines we add match it. */
	eol: string;
}

// ── Line handling ───────────────────────────────────────────────────────────
// Lines keep their terminators so that joining them reproduces the source
// byte-for-byte, CRLF included.

const LINE_RE = /[^\n]*\n|[^\n]+/g;

function splitLines(text: string): string[] {
	return text.match(LINE_RE) ?? [];
}

/** The line without its `\n` / `\r\n` terminator. */
function bare(line: string): string {
	return line.replace(/\r?\n$/, '');
}

function terminatorOf(line: string): string {
	const m = line.match(/\r?\n$/);
	return m ? m[0] : '';
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const H1_RE = /^# +(.*)$/;
const H2_RE = /^## +(.*)$/;
const CALLOUT_OPEN_RE = /^>\s*\[![^\]]*\]/;
const ROW_RE = /^(>\s*\|\s*\*\*)(.+?)(\*\*\s*\|)(.*?)(\|\s*)$/;
const EMBED_RE = /^(>?\s*!\[\[)([^\]]+)(\]\]\s*)$/;

function isFenceClose(line: string, marker: string): boolean {
	const char = marker[0] === '`' ? '`' : '~';
	return new RegExp('^ {0,3}' + char + '{' + marker.length + ',}\\s*$').test(line);
}

/**
 * Whether the `>` run starting at `start` is our at-a-glance callout rather
 * than a callout the writer added themselves. `sg-infobox` is the marker every
 * generated sheet carries; the fact-table fallback covers sheets written before
 * that marker existed.
 */
function isInfoboxRun(lines: string[], start: number, end: number): boolean {
	if (!CALLOUT_OPEN_RE.test(bare(lines[start]))) return false;
	if (bare(lines[start]).includes('sg-infobox')) return true;
	for (let i = start + 1; i < end; i++) {
		if (ROW_RE.test(bare(lines[i]))) return true;
	}
	return false;
}

// ── Parse ───────────────────────────────────────────────────────────────────

/**
 * Split a body into blocks. Never throws and never drops input: whatever is not
 * recognised becomes a `raw` block.
 *
 * Fence-aware — a `## ` or `> [!...]` line inside a triple-backtick or `~~~`
 * code fence is content, not a new block. (The older section regex in
 * `entity-parse.ts` is not, and splits sections inside code samples.)
 */
export function parseBody(body: string): BodyDoc {
	const lines = splitLines(body);
	const firstTerminated = lines.find((l) => /\r?\n$/.test(l));
	const eol = firstTerminated ? terminatorOf(firstTerminated) : '\n';

	const blocks: BodyBlock[] = [];
	let raw: string[] = [];
	let fence: string | null = null;
	let sawH1 = false;
	let sawInfobox = false;
	let section: { heading: string; label: string; content: string[] } | null = null;

	const flushRaw = () => {
		if (raw.length) {
			blocks.push({ kind: 'raw', text: raw.join('') });
			raw = [];
		}
	};
	const flushSection = () => {
		if (!section) return;
		const content = section.content.join('');
		blocks.push({ kind: 'section', text: section.heading + content, heading: section.heading, label: section.label, content });
		section = null;
	};
	const pushLine = (line: string) => {
		if (section) section.content.push(line);
		else raw.push(line);
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const s = bare(line);

		// Inside a code fence nothing is structural.
		if (fence !== null) {
			pushLine(line);
			if (isFenceClose(s, fence)) fence = null;
			continue;
		}
		const opening = s.match(FENCE_OPEN_RE);
		if (opening) {
			fence = opening[1];
			pushLine(line);
			continue;
		}

		const h2 = s.match(H2_RE);
		if (h2) {
			flushSection();
			flushRaw();
			section = { heading: line, label: h2[1].trim(), content: [] };
			continue;
		}

		// A section runs to the next `## `, so an H1 or a callout inside one is
		// content — only look for those while outside a section.
		if (!section) {
			const h1 = s.match(H1_RE);
			if (h1 && !sawH1) {
				flushRaw();
				blocks.push({ kind: 'h1', text: line, title: h1[1].trim() });
				sawH1 = true;
				continue;
			}
			if (!sawInfobox && s.startsWith('>')) {
				let end = i;
				while (end < lines.length && bare(lines[end]).startsWith('>')) end++;
				if (isInfoboxRun(lines, i, end)) {
					flushRaw();
					const runLines = lines.slice(i, end);
					blocks.push({ kind: 'infobox', text: runLines.join(''), lines: runLines });
					sawInfobox = true;
					i = end - 1;
					continue;
				}
			}
		}

		pushLine(line);
	}
	flushSection();
	flushRaw();

	return { blocks, eol };
}

/** Byte-exact inverse of `parseBody`. */
export function renderBody(doc: BodyDoc): string {
	return doc.blocks.map((b) => b.text).join('');
}

// ── Block editing helpers ───────────────────────────────────────────────────

/** Rebuild a block from an edited line list, keeping its parsed fields in step. */
function withLines(block: BodyBlock, lines: string[]): BodyBlock {
	const text = lines.join('');
	switch (block.kind) {
		case 'h1': {
			const m = bare(lines[0] ?? '').match(H1_RE);
			return { kind: 'h1', text, title: m ? m[1].trim() : block.title };
		}
		case 'infobox':
			return { kind: 'infobox', text, lines };
		case 'section': {
			const heading = lines[0] ?? '';
			const m = bare(heading).match(H2_RE);
			return { kind: 'section', text, heading, label: m ? m[1].trim() : block.label, content: lines.slice(1).join('') };
		}
		case 'raw':
			return { kind: 'raw', text };
	}
}

function sameLabel(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Replace the meat of a section, leaving its blank-line padding as it was. */
function withSectionContent(block: SectionBlock, rendered: string, eol: string): SectionBlock {
	const lines = splitLines(block.content);
	let first = 0;
	while (first < lines.length && bare(lines[first]).trim() === '') first++;
	let last = lines.length - 1;
	while (last >= first && bare(lines[last]).trim() === '') last--;

	// Inherit the terminator of the line being replaced, so a document that
	// ended without a trailing newline does not silently gain one.
	const terminator = first > last ? eol : (terminatorOf(lines[last]) || (last === lines.length - 1 ? '' : eol));
	const replacement = splitLines(rendered.replace(/\r?\n$/, '') + terminator);
	const next = first > last
		// Section held nothing: give it the standard blank-line-then-prose shape.
		? [...lines.slice(0, first), ...(first === 0 ? [eol] : []), ...replacement]
		: [...lines.slice(0, first), ...replacement, ...lines.slice(last + 1)];

	const content = next.join('');
	return { kind: 'section', text: block.heading + content, heading: block.heading, label: block.label, content };
}

/** How a block field's value is written into its body section. */
function renderBlockValue(field: CharacterField): string {
	const rendered = field.type === 'textarea'
		? field.value.trim()
		: formatFieldValue(field.type, field.value, field.config);
	return rendered.trim() ? rendered : '';
}

function scalarValue(field: CharacterField): string {
	if (isFieldEmpty(field.type, field.value, field.config)) return '';
	return formatFieldValue(field.type, field.value, field.config).trim();
}

// ── Infobox helpers ─────────────────────────────────────────────────────────

function rowIndexFor(lines: string[], label: string): number {
	return lines.findIndex((l) => {
		const m = bare(l).match(ROW_RE);
		return !!m && sameLabel(m[2], label);
	});
}

function tableHeaderIndex(lines: string[]): number {
	return lines.findIndex((l) => /^>\s*\|\s*-{2,}/.test(bare(l)));
}

function lastRowIndex(lines: string[]): number {
	for (let i = lines.length - 1; i >= 0; i--) {
		if (ROW_RE.test(bare(lines[i]))) return i;
	}
	return -1;
}

function setRowValue(line: string, value: string): string {
	const m = bare(line).match(ROW_RE);
	if (!m) return line;
	return `${m[1]}${m[2]}${m[3]} ${value} ${m[5]}${terminatorOf(line)}`;
}

/** Append a fact row, creating the table header (and its required blank `>` line) if needed. */
function appendRow(lines: string[], label: string, value: string, eol: string): string[] {
	const next = [...lines];
	const row = `> | **${label}** | ${value} |${eol}`;
	const last = lastRowIndex(next);
	if (last >= 0) {
		next.splice(last + 1, 0, row);
		return next;
	}
	const header = tableHeaderIndex(next);
	if (header >= 0) {
		next.splice(header + 1, 0, row);
		return next;
	}
	// The blank `>` line is required: without it Obsidian renders the raw pipes
	// instead of a table (see entity-doc.ts).
	next.push(`>${eol}`, `> | Field | Value |${eol}`, `> | --- | --- |${eol}`, row);
	return next;
}

function embedIndices(lines: string[]): number[] {
	const out: number[] = [];
	lines.forEach((l, i) => { if (EMBED_RE.test(bare(l))) out.push(i); });
	return out;
}

function setEmbedTarget(line: string, target: string): string {
	const m = bare(line).match(EMBED_RE);
	if (!m) return line;
	return `${m[1]}${target}${m[3]}${terminatorOf(line)}`;
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** Replace the H1 line only — every other byte of the document is untouched. */
export function setTitle(doc: BodyDoc, name: string): BodyDoc {
	const idx = doc.blocks.findIndex((b) => b.kind === 'h1');
	if (idx < 0) {
		const h1: H1Block = { kind: 'h1', text: `# ${name}${doc.eol}`, title: name };
		const gap: RawBlock[] = doc.blocks.length ? [{ kind: 'raw', text: doc.eol }] : [];
		return { ...doc, blocks: [h1, ...gap, ...doc.blocks] };
	}
	const existing = doc.blocks[idx] as H1Block;
	if (existing.title === name) return doc;
	const blocks = [...doc.blocks];
	blocks[idx] = { kind: 'h1', text: `# ${name}${terminatorOf(existing.text) || doc.eol}`, title: name };
	return { ...doc, blocks };
}

/**
 * Write field values back into the blocks they came from.
 *
 * Deliberately non-destructive: a `raw` block is never removed, and a section
 * or fact row whose label matches no supplied field is left exactly as it is —
 * hand-written prose is indistinguishable from a field the writer deleted, so
 * the safe reading is "keep it". A field that IS supplied but holds an empty
 * value counts as explicitly cleared, and its row/section is removed — matching
 * how `buildEntityDocument` omits empty fields.
 *
 * Image fields are matched to embeds positionally, exactly the way
 * `parseEntityDocument` reads them, so callers must pass the field list that
 * was parsed from *this* document (optionally merged with spec defaults) — not
 * an unrelated one.
 *
 * `kind` is only consulted when the sheet has no at-a-glance callout yet and
 * one has to be created; without it, values with nowhere to go are left unwritten.
 */
export function applyFields(doc: BodyDoc, fields: CharacterField[], kind?: EntityKind): BodyDoc {
	const eol = doc.eol;
	let blocks = [...doc.blocks];

	// ── Block fields → body sections ───────────────────────────────────────
	for (const field of fields.filter(isBlockField)) {
		const idx = blocks.findIndex((b) => b.kind === 'section' && sameLabel(b.label, field.label));
		const rendered = renderBlockValue(field);
		if (!rendered) {
			if (idx >= 0) blocks.splice(idx, 1);
			continue;
		}
		if (idx >= 0) blocks[idx] = withSectionContent(blocks[idx] as SectionBlock, rendered, eol);
		else blocks = appendSection(blocks, field.label, rendered, eol);
	}

	// ── Images → embeds, matched positionally the way the parser reads them ─
	const images = fields.filter((f) => f.type === 'image');
	if (images.length > 0) blocks = applyEmbeds(blocks, images, eol, kind);

	// ── Scalars → at-a-glance rows ─────────────────────────────────────────
	const scalars = fields.filter((f) => !isBlockField(f) && f.type !== 'image');
	if (scalars.length > 0) blocks = applyRows(blocks, scalars, eol, kind);

	return { blocks: blocks.filter((b) => b.text !== ''), eol };
}

function applyRows(blocks: BodyBlock[], scalars: CharacterField[], eol: string, kind?: EntityKind): BodyBlock[] {
	let out = [...blocks];
	let idx = out.findIndex((b) => b.kind === 'infobox');
	// Nothing to write and nowhere to write it: don't create an empty callout.
	if (idx < 0 && !scalars.some((f) => scalarValue(f))) return out;
	if (idx < 0) {
		if (!kind) return out;
		out = insertInfobox(out, kind, eol);
		idx = out.findIndex((b) => b.kind === 'infobox');
	}

	let lines = [...(out[idx] as InfoboxBlock).lines];
	for (const field of scalars) {
		const value = scalarValue(field);
		const at = rowIndexFor(lines, field.label);
		if (!value) {
			if (at >= 0) lines.splice(at, 1);
			continue;
		}
		if (at >= 0) lines[at] = setRowValue(lines[at], value);
		else lines = appendRow(lines, field.label, value, eol);
	}
	out[idx] = withLines(out[idx], lines);
	return out;
}

function applyEmbeds(blocks: BodyBlock[], images: CharacterField[], eol: string, kind?: EntityKind): BodyBlock[] {
	let out = [...blocks];
	// The parser only reads embeds ahead of the first prose section, so only
	// those are candidates for being rewritten in place.
	const firstSection = out.findIndex((b) => b.kind === 'section');
	const limit = firstSection < 0 ? out.length : firstSection;

	const slots: Array<{ block: number; line: number }> = [];
	for (let b = 0; b < limit; b++) {
		for (const line of embedIndices(splitLines(out[b].text))) slots.push({ block: b, line });
	}

	const values = images.map((f) => f.value.trim());
	const removals: Array<{ block: number; line: number }> = [];

	slots.forEach((slot, i) => {
		const target = values[i];
		if (target === undefined) return;   // more embeds than fields: leave them alone
		if (!target) { removals.push(slot); return; }
		const lines = splitLines(out[slot.block].text);
		lines[slot.line] = setEmbedTarget(lines[slot.line], target);
		out[slot.block] = withLines(out[slot.block], lines);
	});

	// Remove back-to-front so earlier indices stay valid.
	for (const slot of [...removals].reverse()) {
		const lines = splitLines(out[slot.block].text);
		lines.splice(slot.line, 1);
		out[slot.block] = withLines(out[slot.block], lines);
	}

	const extra = values.slice(slots.length).filter(Boolean);
	if (extra.length === 0) return out.filter((b) => b.text !== '');

	// Pictures already on the sheet: new ones go right after the last of them,
	// quoted the same way, so they can never land ahead of the portrait.
	let last: { block: number; line: number } | null = null;
	const firstSectionNow = out.findIndex((b) => b.kind === 'section');
	for (let b = 0; b < (firstSectionNow < 0 ? out.length : firstSectionNow); b++) {
		const idxs = embedIndices(splitLines(out[b].text));
		if (idxs.length) last = { block: b, line: idxs[idxs.length - 1] };
	}
	if (last) {
		const lines = splitLines(out[last.block].text);
		const quoted = bare(lines[last.line]).startsWith('>');
		const lineEol = terminatorOf(lines[last.line]) || eol;
		if (!terminatorOf(lines[last.line])) lines[last.line] += eol;
		lines.splice(last.line + 1, 0, ...extra.map((t) => `${quoted ? '> ' : ''}![[${t}]]${lineEol}`));
		out[last.block] = withLines(out[last.block], lines);
		return out.filter((b) => b.text !== '');
	}

	let idx = out.findIndex((b) => b.kind === 'infobox');
	if (idx < 0) {
		if (!kind) return out.filter((b) => b.text !== '');
		out = insertInfobox(out, kind, eol);
		idx = out.findIndex((b) => b.kind === 'infobox');
	}
	const lines = [...(out[idx] as InfoboxBlock).lines];
	const existing = embedIndices(lines);
	const at = existing.length ? existing[existing.length - 1] + 1 : 1;
	lines.splice(at, 0, ...extra.map((t) => `> ![[${t}]]${eol}`));
	out[idx] = withLines(out[idx], lines);
	return out.filter((b) => b.text !== '');
}

/** Create the at-a-glance callout, placed just after the title like a generated sheet. */
function insertInfobox(blocks: BodyBlock[], kind: EntityKind, eol: string): BodyBlock[] {
	const spec = getKindSpec(kind);
	const line = `> [!${spec.calloutType}|sg-infobox] ${spec.calloutTitle}${eol}`;
	const block: InfoboxBlock = { kind: 'infobox', text: line, lines: [line] };
	const h1 = blocks.findIndex((b) => b.kind === 'h1');
	const at = h1 < 0 ? 0 : h1 + 1;
	const before: BodyBlock[] = h1 < 0 ? [] : [{ kind: 'raw', text: eol }];
	const followsOn = at < blocks.length && !/^\r?\n/.test(blocks[at].text);
	const after: BodyBlock[] = followsOn ? [{ kind: 'raw', text: eol }] : [];
	return [...blocks.slice(0, at), ...before, block, ...after, ...blocks.slice(at)];
}

/** Append a new `## Label` section, padded so it starts after a blank line. */
function appendSection(blocks: BodyBlock[], label: string, rendered: string, eol: string): BodyBlock[] {
	const out = [...blocks];
	const tail = out.map((b) => b.text).join('');
	let pad = '';
	if (tail.length > 0) {
		if (!/\n$/.test(tail)) pad = eol + eol;
		else if (!/\n[ \t]*\r?\n$/.test(tail)) pad = eol;
	}
	if (pad) out.push({ kind: 'raw', text: pad });
	const heading = `## ${label}${eol}`;
	const content = `${eol}${rendered}${eol}`;
	out.push({ kind: 'section', text: heading + content, heading, label, content });
	return out;
}
