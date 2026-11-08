import { App, Notice, TFile } from 'obsidian';
import {
	ManuscriptItem,
	ManuscriptOptions,
	prepareItems,
	rebaseSceneHeadings,
	sceneBlocks,
	shallowestSceneHeading,
} from './compile';
import { buildZip, ZipEntry } from './zip';

/**
 * Minimal dependency-free EPUB 3 writer. The container is an uncompressed ZIP
 * (via ./zip), which every reader accepts. Markdown conversion is intentionally
 * small: headings, paragraphs, emphasis, scene separators — manuscript prose,
 * not full CommonMark.
 */

// ─── Markdown → XHTML (manuscript subset) ────────────────────────────────────

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMd(s: string): string {
	return s
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\*([^*]+)\*/g, '<em>$1</em>')
		.replace(/_([^_]+)_/g, '<em>$1</em>');
}

/** Convert manuscript-flavoured markdown to XHTML body content. */
export function mdToXhtml(md: string): string {
	const out: string[] = [];
	// sceneBlocks gives every heading line (# … ######) its own block, even
	// when the prose follows on the next line; a lone "#" stays a paragraph.
	// No fence tracking here: chapter text mixes several scenes and the scene
	// separators (which may be "~~~"). Each scene's fences were handled when
	// its headings were re-based (chaptersFromItems → rebaseSceneHeadings).
	for (const block of sceneBlocks(md, { trackFences: false })) {
		if (block.kind === 'heading') {
			out.push(`<h${block.level}>${inlineMd(escapeXml(block.text))}</h${block.level}>`);
		} else if (block.text === '***' || block.text === '---') {
			out.push('<hr/>');
		} else if (block.text === '#') {
			out.push('<p class="scene-break">#</p>');
		} else {
			// "\#" at a line start is Markdown's escaped "#" (see rebaseSceneHeadings).
			const unescaped = block.text.replace(/^( {0,3})\\#/gm, '$1#');
			const text = inlineMd(escapeXml(unescaped)).replace(/\n/g, '<br/>');
			out.push(`<p>${text}</p>`);
		}
	}
	return out.join('\n');
}

/** Nested dividers become <h(depth+2)> inside their chapter (see chaptersFromItems). */
function dividerLevel(depth: number): number {
	return Math.min(depth + 2, 6);
}

// ─── EPUB assembly ───────────────────────────────────────────────────────────

export interface EpubChapter {
	title: string;
	markdown: string;
}

/**
 * Group ordered manuscript items into EPUB chapters. Each top-level (depth 0)
 * divider starts a new chapter; nested dividers become inline headings within
 * their chapter; adjacent scenes are joined with the separator. Scenes before
 * any divider fall into an opening "Manuscript" chapter.
 */
export function chaptersFromItems(items: ManuscriptItem[], opts: ManuscriptOptions): EpubChapter[] {
	const prepared = prepareItems(items, opts.steps ?? []);
	if (prepared.length === 0) return [];

	const sep = opts.sceneSeparator || '***';
	// In-scene headings sit one level below the deepest nested divider (never
	// above h3), so a beat never ties with or outranks its own section; one
	// manuscript-wide level map keeps a level meaning the same in every scene.
	let deepestDivider = 2;
	for (const it of prepared) {
		if (it.kind === 'heading' && it.depth > 0 && opts.includeHeadings && it.label.trim()) {
			deepestDivider = Math.max(deepestDivider, dividerLevel(it.depth));
		}
	}
	const sceneBase = Math.min(6, deepestDivider + 1);
	const shallowest = shallowestSceneHeading(prepared);
	const chapters: EpubChapter[] = [];
	let current: EpubChapter | null = null;
	let prevWasScene = false;

	const ensureChapter = () => {
		if (!current) {
			current = { title: 'Manuscript', markdown: '' };
			chapters.push(current);
		}
		return current;
	};

	for (const item of prepared) {
		if (item.kind === 'heading') {
			if (item.depth === 0) {
				current = { title: item.label.trim() || 'Chapter', markdown: '' };
				chapters.push(current);
			} else if (opts.includeHeadings && item.label.trim()) {
				const ch = ensureChapter();
				const prefix = ch.markdown ? '\n\n' : '';
				ch.markdown += `${prefix}${'#'.repeat(dividerLevel(item.depth))} ${item.label.trim()}`;
			}
			prevWasScene = false;
		} else {
			const ch = ensureChapter();
			if (ch.markdown) ch.markdown += prevWasScene ? `\n\n${sep}\n\n` : '\n\n';
			ch.markdown += rebaseSceneHeadings(item.text, sceneBase, shallowest);
			prevWasScene = true;
		}
	}

	const nonEmpty = chapters.filter((c) => c.markdown.trim());
	if (opts.endMark?.trim() && nonEmpty.length > 0) {
		nonEmpty[nonEmpty.length - 1].markdown += `\n\n${opts.endMark.trim()}`;
	}
	return nonEmpty;
}

const EPUB_CSS = `body { font-family: serif; line-height: 1.6; margin: 1em; }
h1, h2, h3, h4, h5, h6 { font-family: sans-serif; line-height: 1.25; }
p { text-indent: 1.5em; margin: 0; }
p:first-of-type, h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p, hr + p, p.scene-break + p { text-indent: 0; }
p.scene-break { text-align: center; text-indent: 0; margin: 1em 0; }
hr { border: none; text-align: center; margin: 1em 0; }
`;

function chapterXhtml(title: string, body: string): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>
`;
}

export interface EpubCover {
	data: Uint8Array;
	/** File extension without the dot, e.g. 'jpg' | 'png' | 'webp'. */
	ext: string;
}

const COVER_MIME: Record<string, string> = {
	jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
	webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
};

/** Build the complete .epub file bytes. */
export function buildEpub(title: string, author: string, chapters: EpubChapter[], cover?: EpubCover): Uint8Array {
	const encoder = new TextEncoder();
	const uid = `urn:uuid:${'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	})}`;
	const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

	const coverExt = cover ? (COVER_MIME[cover.ext.toLowerCase()] ? cover.ext.toLowerCase() : 'jpg') : '';
	const coverMime = cover ? (COVER_MIME[coverExt] ?? 'image/jpeg') : '';

	const manifestItems = [
		...(cover ? [
			`<item id="cover-image" href="cover.${coverExt}" media-type="${coverMime}" properties="cover-image"/>`,
			`<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
		] : []),
		...chapters.map((_, i) => `<item id="ch${i + 1}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`),
	].join('\n    ');
	const spineItems = [
		...(cover ? ['<itemref idref="cover-page"/>'] : []),
		...chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`),
	].join('\n    ');

	const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${uid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>en</dc:language>
    ${author.trim() ? `<dc:creator>${escapeXml(author.trim())}</dc:creator>` : ''}
    ${cover ? '<meta name="cover" content="cover-image"/>' : ''}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>
`;

	const navItems = chapters
		.map((ch, i) => `<li><a href="chapter-${i + 1}.xhtml">${escapeXml(ch.title)}</a></li>`)
		.join('\n        ');
	const nav = chapterXhtml('Contents', `<nav epub:type="toc" id="toc">
  <h1>Contents</h1>
  <ol>
        ${navItems}
  </ol>
</nav>`);

	const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

	const entries: ZipEntry[] = [
		// Per spec the mimetype entry must come first and be uncompressed
		{ name: 'mimetype', data: encoder.encode('application/epub+zip') },
		{ name: 'META-INF/container.xml', data: encoder.encode(container) },
		{ name: 'OEBPS/content.opf', data: encoder.encode(opf) },
		{ name: 'OEBPS/nav.xhtml', data: encoder.encode(nav) },
		{ name: 'OEBPS/style.css', data: encoder.encode(EPUB_CSS) },
		...(cover ? [
			{ name: `OEBPS/cover.${coverExt}`, data: cover.data },
			{
				name: 'OEBPS/cover.xhtml',
				data: encoder.encode(chapterXhtml('Cover',
					`<div style="text-align:center;margin:0;"><img src="cover.${coverExt}" alt="Cover" style="max-width:100%;max-height:100%;"/></div>`)),
			},
		] : []),
		...chapters.map((ch, i) => ({
			name: `OEBPS/chapter-${i + 1}.xhtml`,
			data: encoder.encode(chapterXhtml(ch.title, mdToXhtml(ch.markdown))),
		})),
	];
	return buildZip(entries);
}

/** Write (or overwrite) the .epub next to the grid file and confirm with a notice. */
export async function exportEpub(
	app: App,
	epubPath: string,
	title: string,
	author: string,
	items: ManuscriptItem[],
	opts: ManuscriptOptions,
	coverImagePath?: string
): Promise<void> {
	const chapters = chaptersFromItems(items, opts);
	if (chapters.length === 0) {
		new Notice('Plotverk: Nothing to export — all scenes are empty.');
		return;
	}
	let cover: EpubCover | undefined;
	if (coverImagePath) {
		const f = app.vault.getAbstractFileByPath(coverImagePath);
		if (f instanceof TFile) {
			cover = { data: new Uint8Array(await app.vault.readBinary(f)), ext: f.extension };
		}
	}
	const bytes = buildEpub(title, author, chapters, cover);
	// Copy into a fresh ArrayBuffer so the binary write gets exact bounds
	const buf = new ArrayBuffer(bytes.length);
	new Uint8Array(buf).set(bytes);
	try {
		const existing = app.vault.getAbstractFileByPath(epubPath);
		if (existing instanceof TFile) {
			await app.vault.modifyBinary(existing, buf);
		} else {
			await app.vault.createBinary(epubPath, buf);
		}
		new Notice(`EPUB exported — ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}: ${epubPath.split('/').pop()}`);
	} catch (err) {
		new Notice(`Plotverk: Could not write EPUB. ${err instanceof Error ? err.message : ''}`);
	}
}
