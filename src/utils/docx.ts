import { buildZip } from './zip';
import {
	ManuscriptItem,
	ManuscriptOptions,
	prepareItems,
	manuscriptWordTotal,
	roundedWordCount,
	rebasedLevel,
	sceneBlocks,
	shallowestSceneHeading,
} from './compile';

/**
 * Word .docx exporter producing a standard (Shunn) submission manuscript:
 * Times New Roman 12pt, double-spaced, 1" margins, a `Lastname / TITLE / page#`
 * running header, chapters starting on a new page with the title dropped down,
 * centred `#` scene breaks, and `THE END`. A .docx is what agents expect to
 * mark up, and it converts to PDF in one click from Word.
 *
 * A .docx is a ZIP of OOXML parts — we reuse the stored-ZIP writer in ./zip.
 * Pure module (no Obsidian imports); the vault write lives in compile-runner.
 */

// ─── Units ───────────────────────────────────────────────────────────────────
// 1 inch = 1440 twips. 12pt = 24 half-points. Double spacing = 480 (240 = single).
const MARGIN = 1440; // 1"
const FIRST_LINE_INDENT = 720; // 0.5"
const RIGHT_TAB = 12240 - MARGIN * 2; // page content width (Letter, 8.5")
const CHAPTER_DROP = 2400; // ~1.6" — chapter title dropped down the page

function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Author surname for the running header (last whitespace-separated token). */
export function surnameOf(author: string): string {
	const parts = author.trim().split(/\s+/).filter(Boolean);
	return parts.length ? parts[parts.length - 1] : '';
}

// ─── Inline runs (bold / italic) ─────────────────────────────────────────────

interface RunOpts {
	underlineItalics?: boolean;
}

/**
 * Split a line into runs, honouring **bold**, *italic*, and _italic_. Italics
 * can render as underline (the classic typewriter-manuscript convention) when
 * `underlineItalics` is set. Newlines within the piece become `<w:br/>`.
 */
export function runsForText(text: string, opts: RunOpts = {}): string {
	const tokens: Array<{ text: string; bold?: boolean; italic?: boolean }> = [];
	const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (m.index > last) tokens.push({ text: text.slice(last, m.index) });
		if (m[1] !== undefined) tokens.push({ text: m[1], bold: true });
		else if (m[2] !== undefined) tokens.push({ text: m[2], italic: true });
		else if (m[3] !== undefined) tokens.push({ text: m[3], italic: true });
		last = re.lastIndex;
	}
	if (last < text.length) tokens.push({ text: text.slice(last) });

	return tokens
		.map((t) => {
			const props: string[] = [];
			if (t.bold) props.push('<w:b/>');
			if (t.italic) props.push(opts.underlineItalics ? '<w:u w:val="single"/>' : '<w:i/>');
			const rpr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
			const parts = t.text.split('\n');
			const inner = parts
				.map((p, i) => (i > 0 ? '<w:br/>' : '') + `<w:t xml:space="preserve">${esc(p)}</w:t>`)
				.join('');
			return `<w:r>${rpr}${inner}</w:r>`;
		})
		.join('');
}

// ─── Paragraph builders ──────────────────────────────────────────────────────

type Align = 'left' | 'center' | 'right';

function para(
	runs: string,
	opts: { style?: string; align?: Align; indent?: boolean; spaceBefore?: number; keepNext?: boolean } = {}
): string {
	const pr: string[] = [];
	if (opts.style) pr.push(`<w:pStyle w:val="${opts.style}"/>`);
	// Keep a heading on the same page as the paragraph under it.
	if (opts.keepNext) pr.push('<w:keepNext/>');
	if (opts.align && opts.align !== 'left') pr.push(`<w:jc w:val="${opts.align}"/>`);
	if (opts.indent) pr.push(`<w:ind w:firstLine="${FIRST_LINE_INDENT}"/>`);
	if (opts.spaceBefore) pr.push(`<w:spacing w:before="${opts.spaceBefore}"/>`);
	const ppr = pr.length ? `<w:pPr>${pr.join('')}</w:pPr>` : '';
	return `<w:p>${ppr}${runs}</w:p>`;
}

function pageBreakPara(): string {
	return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

// ─── Title page (Shunn) ──────────────────────────────────────────────────────

function titlePageParas(title: string, author: string, contact: string, words: number): string[] {
	const paras: string[] = [];
	// Top row: contact (left) + word count (right), aligned with a right tab.
	const wc = `About ${roundedWordCount(words).toLocaleString('en-US')} words`;
	const topRuns =
		`<w:r><w:t xml:space="preserve">${esc(author.trim())}</w:t></w:r>` +
		`<w:r><w:tab/></w:r>` +
		`<w:r><w:t xml:space="preserve">${esc(wc)}</w:t></w:r>`;
	paras.push(
		`<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${RIGHT_TAB}"/></w:tabs></w:pPr>${topRuns}</w:p>`
	);
	for (const line of contact.trim().split('\n').filter(Boolean)) {
		paras.push(para(`<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`));
	}
	// Drop to the vertical middle for the title block.
	for (let i = 0; i < 11; i++) paras.push('<w:p/>');
	paras.push(para(`<w:r><w:t xml:space="preserve">${esc(title)}</w:t></w:r>`, { align: 'center' }));
	paras.push('<w:p/>');
	if (author.trim()) {
		paras.push(para(`<w:r><w:t xml:space="preserve">by ${esc(author.trim())}</w:t></w:r>`, { align: 'center' }));
	}
	paras.push(pageBreakPara());
	return paras;
}

// ─── Body from manuscript items ──────────────────────────────────────────────

/**
 * Word level for a scene's shallowest in-scene heading. Dividers only ever use
 * Heading1 (chapters) and Heading2 (anything nested), so Heading3 always sits
 * below them in Word's navigation pane — whatever level the writer typed.
 */
const SCENE_HEADING_BASE = 3;

function sceneParas(text: string, opts: RunOpts, shallowest: number): string[] {
	return sceneBlocks(text).map((b) =>
		b.kind === 'heading'
			? para(runsForText(b.text, opts), {
					style: `Heading${rebasedLevel(b.level, shallowest, SCENE_HEADING_BASE)}`,
					keepNext: true,
				})
			: para(runsForText(b.text, opts), { indent: true })
	);
}

export interface DocxOptions extends ManuscriptOptions {
	underlineItalics?: boolean;
}

/** Build the OOXML `<w:body>` inner content from ordered items. */
export function buildDocxBody(name: string, items: ManuscriptItem[], opts: DocxOptions, author: string): string {
	const prepared = prepareItems(items, opts.steps ?? []);
	const runOpts: RunOpts = { underlineItalics: opts.underlineItalics };
	const sep = opts.sceneSeparator || '#';
	// One level map for the whole manuscript, so a heading level means the same everywhere.
	const shallowest = shallowestSceneHeading(prepared);

	const paras: string[] = [];
	// Title page only for the novel style.
	if ((opts.titlePage ?? 'none') === 'novel') {
		paras.push(...titlePageParas(name, author, opts.contact ?? '', manuscriptWordTotal(prepared)));
	} else {
		paras.push(para(`<w:r><w:t xml:space="preserve">${esc(name)}</w:t></w:r>`, { style: 'Heading1', align: 'center' }));
	}

	let prevWasScene = false;
	let firstChapter = true;
	for (const item of prepared) {
		if (item.kind === 'heading') {
			if (opts.includeHeadings && item.label.trim()) {
				if (item.depth === 0) {
					// New chapter: fresh page, title dropped down.
					if (!firstChapter) paras.push(pageBreakPara());
					paras.push(
						para(`<w:r><w:t xml:space="preserve">${esc(item.label.trim())}</w:t></w:r>`, {
							style: 'Heading1',
							align: 'center',
							spaceBefore: CHAPTER_DROP,
						})
					);
					firstChapter = false;
				} else {
					paras.push(
						para(`<w:r><w:t xml:space="preserve">${esc(item.label.trim())}</w:t></w:r>`, {
							style: 'Heading2',
							align: 'center',
						})
					);
				}
			}
			prevWasScene = false;
		} else {
			if (prevWasScene) paras.push(para(`<w:r><w:t>${esc(sep)}</w:t></w:r>`, { align: 'center' }));
			paras.push(...sceneParas(item.text, runOpts, shallowest));
			prevWasScene = true;
			firstChapter = false;
		}
	}

	if (opts.endMark?.trim()) {
		paras.push(para(`<w:r><w:t xml:space="preserve">${esc(opts.endMark.trim())}</w:t></w:r>`, { align: 'center' }));
	}

	// Section props: 1" margins, header ref, first-page-header suppressed.
	const sectPr =
		'<w:sectPr>' +
		'<w:headerReference w:type="default" r:id="rId10"/>' +
		'<w:titlePg/>' +
		`<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="720" w:footer="720" w:gutter="0"/>` +
		'</w:sectPr>';
	return paras.join('') + `<w:p><w:pPr>${sectPr}</w:pPr></w:p>`;
}

// ─── Static parts ────────────────────────────────────────────────────────────

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
</Relationships>`;

const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`;

// Normal: TNR 12, double-spaced, 0.5" first-line indent handled per-paragraph.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`;

function headerXml(surname: string, title: string): string {
	// Right-aligned "Surname / TITLE / <page>" running header (suppressed on p.1).
	const label = [surname, title.toUpperCase()].filter(Boolean).join(' / ');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:jc w:val="right"/></w:pPr>
    <w:r><w:t xml:space="preserve">${esc(label)} / </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:hdr>`;
}

function documentXml(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${body}</w:body>
</w:document>`;
}

/** Build the complete .docx file bytes from ordered manuscript items. */
export function buildDocx(name: string, items: ManuscriptItem[], opts: DocxOptions, author: string): Uint8Array {
	const encoder = new TextEncoder();
	const body = buildDocxBody(name, items, opts, author);
	return buildZip([
		{ name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
		{ name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
		{ name: 'word/document.xml', data: encoder.encode(documentXml(body)) },
		{ name: 'word/_rels/document.xml.rels', data: encoder.encode(DOC_RELS) },
		{ name: 'word/styles.xml', data: encoder.encode(STYLES) },
		{ name: 'word/settings.xml', data: encoder.encode(SETTINGS) },
		{ name: 'word/header2.xml', data: encoder.encode(headerXml(surnameOf(author), name)) },
	]);
}
