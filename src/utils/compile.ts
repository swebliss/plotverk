import { CompileStepConfig, CompileWorkflowSettings, generateId } from '../grid-data';
import { stripSheetPlanning } from '../entities/entity-parse';

/**
 * Longform-style compile: turn the Writers Panel outline tree into a single
 * manuscript. Story order comes from the scene tree (docs + dividers), NOT
 * from grid cards — the outline the writer arranges IS the manuscript.
 * Pure module (no Obsidian imports) so ordering, steps, and assembly stay
 * unit-testable.
 */

// ─── Manuscript items (produced from the scene tree) ─────────────────────────

/** One entry of the ordered manuscript: a divider heading or a scene body. */
export type ManuscriptItem =
	| { kind: 'heading'; depth: number; number: string; label: string }
	| { kind: 'scene'; depth: number; number: string; title: string; docPath: string; text: string };

/**
 * A frontmatter body line: a `key:` entry, a list item, an indented
 * continuation, a comment, or blank. Prose fails this — which is how a leading
 * `---` thematic break is told apart from a real frontmatter block.
 */
const YAML_BODY_LINE = /^(?:[A-Za-z0-9_.$-]+[ \t]*:(?:[ \t]|$)|-[ \t]|[ \t]+\S|#|$)/;

/** Remove a leading YAML frontmatter block, if present. */
export function stripFrontmatter(content: string): string {
	// Anchored at index 0 (no `m` flag) so only a block at the very start of the
	// file counts; `\r?` keeps CRLF documents working.
	const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
	if (m && m[1].split(/\r?\n/).every((line) => YAML_BODY_LINE.test(line))) {
		return content.slice(m[0].length).trim();
	}
	return content.trim();
}

/** Rough prose word count — markdown punctuation doesn't inflate the number. */
export function countWords(text: string): number {
	const cleaned = text.replace(/[#*_>`[\]|]+/g, ' ');
	return cleaned.split(/\s+/).filter((w) => /[^\s\-—–.,!?:;'"()]/.test(w)).length;
}

// ─── Compile steps (Longform-style, user-composable) ─────────────────────────

export type CompileStepStage = 'scene' | 'manuscript';

export interface CompileStepOptionSpec {
	key: string;
	label: string;
	/** Absent = checkbox. 'text' = single-line input. 'multiline' = textarea. */
	type?: 'text' | 'multiline';
	default: boolean | string;
}

export interface CompileStepSpec {
	id: string;
	name: string;
	description: string;
	/** Which pipeline stages this step may run in (drives the add-step menus). */
	stages: CompileStepStage[];
	options: CompileStepOptionSpec[];
}

/** Every step a writer can add to a compile workflow. */
export const COMPILE_STEP_SPECS: CompileStepSpec[] = [
	{
		id: 'remove-planning',
		name: 'Remove planning',
		description:
			'Leaves out a sheet’s title, its at-a-glance box and its own sections (like Summary and Notes). Your own writing on the page stays.',
		stages: ['scene'],
		options: [],
	},
	{
		id: 'strip-frontmatter',
		name: 'Remove document properties',
		description: 'Removes the YAML frontmatter (properties) block.',
		stages: ['scene', 'manuscript'],
		options: [],
	},
	{
		id: 'remove-comments',
		name: 'Remove comments',
		description: 'Removes markdown and/or HTML comments.',
		stages: ['scene', 'manuscript'],
		options: [
			{ key: 'markdown', label: 'Markdown comments (%% text %%)', default: true },
			{ key: 'html', label: 'HTML comments (<!-- text -->)', default: true },
		],
	},
	{
		id: 'remove-links',
		name: 'Remove links',
		description: 'Removes wiki and/or external links, leaving only the text.',
		stages: ['scene', 'manuscript'],
		options: [
			{ key: 'wikilinks', label: 'Remove brackets from [[wikilinks]]', default: true },
			{ key: 'external', label: 'External links — keep only the anchor text', default: true },
		],
	},
	{
		id: 'remove-strikethroughs',
		name: 'Remove strikethroughs',
		description: 'Removes struck-through ~~text~~ entirely.',
		stages: ['scene', 'manuscript'],
		options: [],
	},
	{
		id: 'remove-tags',
		name: 'Remove #tags',
		description: 'Removes inline #tags from the text.',
		stages: ['scene', 'manuscript'],
		options: [],
	},
	{
		id: 'tidy-whitespace',
		name: 'Tidy whitespace',
		description: 'Collapses runs of blank lines and trims trailing spaces.',
		stages: ['scene', 'manuscript'],
		options: [],
	},
	{
		id: 'prepend-title',
		name: 'Prepend scene title',
		description:
			'Puts each scene\'s title above its text. $1 = title, $2 = outline number (like 2.3), $3{#} repeats "#" once per nesting level.',
		stages: ['scene'],
		options: [
			{ key: 'format', label: 'Title format', type: 'text', default: '$1' },
			{ key: 'separator', label: 'Between title and text', type: 'text', default: '\\n\\n' },
		],
	},
	{
		id: 'add-frontmatter',
		name: 'Add document properties',
		description: 'Adds a YAML frontmatter block to the top of the finished manuscript.',
		stages: ['manuscript'],
		options: [{ key: 'yaml', label: 'Properties (YAML)', type: 'multiline', default: '' }],
	},
];

export function getStepSpec(id: string): CompileStepSpec | undefined {
	return COMPILE_STEP_SPECS.find((s) => s.id === id);
}

/** A step config with the spec's default options, pinned to a pipeline stage. */
export function defaultStepConfig(id: string, stage: CompileStepStage = 'scene'): CompileStepConfig {
	const spec = getStepSpec(id);
	const options: Record<string, boolean | string> = {};
	for (const o of spec?.options ?? []) options[o.key] = o.default;
	return { id, stage, options };
}

export function removeComments(text: string, opts: { markdown?: boolean; html?: boolean }): string {
	let out = text;
	if (opts.markdown !== false) out = out.replace(/%%[\s\S]*?%%/g, '');
	if (opts.html !== false) out = out.replace(/<!--[\s\S]*?-->/g, '');
	return out;
}

export function removeLinks(text: string, opts: { wikilinks?: boolean; external?: boolean }): string {
	let out = text;
	if (opts.wikilinks !== false) {
		// ![[embeds]] are dropped entirely; [[target|display]] keeps the display text
		out = out.replace(/!\[\[[^\]]*\]\]/g, '');
		out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m: string, target: string, display: string | undefined) => display ?? target);
	}
	if (opts.external !== false) {
		out = out.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
	}
	return out;
}

export function removeStrikethroughs(text: string): string {
	return text.replace(/~~[\s\S]*?~~/g, '');
}

export function removeTags(text: string): string {
	return text.replace(/\s+#[\w/-]+/g, '').replace(/^#[\w/-]+\s*/gm, '');
}

export function tidyWhitespace(text: string): string {
	return text
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Expand a prepend-title format string: $1 = title, $2 = outline number,
 * $3{x} = "x" repeated (depth + 1) times. Longform-style tokens (not fully
 * Longform-compatible: every occurrence is replaced, and $2/$3 count dividers),
 * so writers coming from there feel at home.
 * Values go in through replacer functions, never as replacement strings: a
 * title like "Cash $& Carry" must come out as typed, not with `$&` expanded.
 */
export function formatSceneTitle(format: string, title: string, number: string, depth: number): string {
	return format
		.replace(/\$3\{([^}]*)\}/g, (_m, tok: string) => tok.repeat(depth + 1))
		.replace(/\$2/g, () => number)
		.replace(/\$1/g, () => title);
}

/** Text options store literal "\n" so separators survive JSON; expand at run time. */
export function expandEscapes(value: string): string {
	return value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

export interface StepContext {
	stage: CompileStepStage;
	title?: string;
	number?: string;
	depth?: number;
}

/**
 * Run text through the configured steps, in order, applying only the steps
 * pinned to the given stage. Per-scene callers pass title/number/depth so
 * prepend-title can do its work.
 */
export function applyCompileSteps(
	text: string,
	steps: CompileStepConfig[],
	ctx: StepContext = { stage: 'scene' }
): string {
	let out = text;
	// Planning goes first, wherever the step sits in the list: telling a sheet's
	// stored answers from story text needs the page as it is on disk, before any
	// other step has touched its links, comments or properties.
	if (ctx.stage === 'scene' && steps.some((st) => st.id === 'remove-planning' && (st.stage ?? 'scene') === 'scene')) {
		out = stripSheetPlanning(out, ctx.title);
	}
	for (const step of steps) {
		if ((step.stage ?? 'scene') !== ctx.stage) continue;
		switch (step.id) {
			case 'strip-frontmatter':
				out = stripFrontmatter(out);
				break;
			case 'remove-comments':
				out = removeComments(out, {
					markdown: step.options['markdown'] !== false,
					html: step.options['html'] !== false,
				});
				break;
			case 'remove-links':
				out = removeLinks(out, {
					wikilinks: step.options['wikilinks'] !== false,
					external: step.options['external'] !== false,
				});
				break;
			case 'remove-strikethroughs':
				out = removeStrikethroughs(out);
				break;
			case 'remove-tags':
				out = removeTags(out);
				break;
			case 'tidy-whitespace':
				out = tidyWhitespace(out);
				break;
			case 'prepend-title': {
				const title = (ctx.title ?? '').trim();
				if (!title) break;
				const fmt = typeof step.options['format'] === 'string' ? step.options['format'] : '$1';
				const sep = typeof step.options['separator'] === 'string' ? (step.options['separator']) : '\\n\\n';
				const rendered = formatSceneTitle(fmt, title, ctx.number ?? '', ctx.depth ?? 0);
				out = rendered + expandEscapes(sep) + out;
				break;
			}
			case 'add-frontmatter': {
				const yaml = typeof step.options['yaml'] === 'string' ? (step.options['yaml']).trim() : '';
				if (yaml) out = `---\n${yaml}\n---\n\n${out}`;
				break;
			}
		}
	}
	return out.trim();
}

// ─── Headings inside a scene ─────────────────────────────────────────────────

/** One block of scene prose: a Markdown heading line, or a paragraph of text. */
export type SceneBlock = { kind: 'heading'; level: number; text: string } | { kind: 'para'; text: string };

/**
 * An ATX heading line: 1–6 `#`, at least one space, then text (an optional
 * closing run of `#` is dropped). A lone `#` — the manuscript scene break —
 * and `#tag` are deliberately NOT headings.
 */
const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

function atxHeading(line: string): { level: number; text: string } | null {
	const m = ATX_HEADING.exec(line);
	if (!m || !m[2].trim()) return null;
	return { level: m[1].length, text: m[2].trim() };
}

/** Opening/closing line of a fenced code block: nothing inside one is a heading. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Each line of scene text (Windows `\r\n` endings normalised — scene notes
 * imported from Word or Scrivener carry them), with its heading if it is one
 * outside a code fence.
 */
function scanLines(text: string, trackFences = true): ScannedLine[] {
	// A fence only counts when it is closed later in the same text: a lone
	// "~~~" or "```" a writer uses as a section break must not swallow every
	// heading after it.
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const out: ScannedLine[] = [];
	let fence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const f = trackFences ? FENCE.exec(line) : null;
		if (f) {
			const ch = f[1][0];
			if (fence === null) {
				if (lines.slice(i + 1).some((l) => FENCE.exec(l)?.[1][0] === ch)) fence = ch;
			} else if (ch === fence) {
				fence = null;
			}
			out.push({ line, heading: null, fenced: false });
			continue;
		}
		const h = atxHeading(line);
		out.push(fence === null ? { line, heading: h, fenced: false } : { line, heading: null, fenced: h !== null });
	}
	return out;
}

interface ScannedLine {
	line: string;
	heading: { level: number; text: string } | null;
	/** A heading-looking line inside a closed code fence: text, not a heading. */
	fenced: boolean;
}

/**
 * Split scene text into headings and paragraphs. Paragraphs are separated by
 * blank lines; a heading line is always its own block, even when the prose
 * follows it on the very next line (Obsidian renders `## Beat\nText` as a
 * heading plus a paragraph, so the export must too).
 */
export function sceneBlocks(text: string, opts: { trackFences?: boolean } = {}): SceneBlock[] {
	const out: SceneBlock[] = [];
	let lines: string[] = [];
	const flush = () => {
		const body = lines.join('\n').trim();
		if (body) out.push({ kind: 'para', text: body });
		lines = [];
	};
	for (const { line, heading } of scanLines(text, opts.trackFences !== false)) {
		if (heading) {
			flush();
			out.push({ kind: 'heading', level: heading.level, text: heading.text });
		} else if (!line.trim()) {
			flush();
		} else {
			lines.push(line);
		}
	}
	flush();
	return out;
}

/**
 * Heading level inside a scene, re-based so the manuscript's shallowest
 * in-scene heading lands on `base` and deeper ones keep their relative steps
 * (capped at 6). Keeps a writer's `# Beat` from outranking the chapter it
 * sits under.
 */
export function rebasedLevel(level: number, shallowest: number, base: number): number {
	return Math.min(6, base + Math.max(0, level - shallowest));
}

/** The shallowest heading level in scene text, or 0 when it has none. */
function shallowestIn(text: string): number {
	let min = 0;
	for (const { heading } of scanLines(text)) if (heading && (min === 0 || heading.level < min)) min = heading.level;
	return min;
}

/**
 * The shallowest in-scene heading across ALL scenes of a manuscript (0 = none).
 * Re-basing against one manuscript-wide level — not each scene's own — keeps
 * a level meaning the same thing everywhere: a "### Title" from the Prepend
 * scene title step lands on the same Word/EPUB level in every scene, whether
 * or not that scene also has a "# Beat".
 */
export function shallowestSceneHeading(items: ManuscriptItem[]): number {
	let min = 0;
	for (const it of items) {
		if (it.kind !== 'scene') continue;
		const s = shallowestIn(it.text);
		if (s && (min === 0 || s < min)) min = s;
	}
	return min;
}

/**
 * Rewrite the heading lines of scene text so level `shallowest` (default:
 * the text's own shallowest) becomes level `base`. A heading-looking line
 * inside a code fence is escaped as `\#`: the chapter-level EPUB renderer
 * that reads this text later cannot track fences (a "~~~" scene separator
 * would look like one), so the escape is what keeps it text there.
 */
export function rebaseSceneHeadings(text: string, base: number, shallowest = shallowestIn(text)): string {
	return scanLines(text)
		.map(({ line, heading, fenced }) => {
			if (fenced) return line.replace(/^( {0,3})#/, '$1\\#');
			if (heading && shallowest > 0) return `${'#'.repeat(rebasedLevel(heading.level, shallowest, base))} ${heading.text}`;
			return line;
		})
		.join('\n');
}

// ─── Title pages ─────────────────────────────────────────────────────────────

export type TitlePageStyle = 'none' | 'novel' | 'fountain';

export interface ManuscriptMeta {
	author?: string;
	contact?: string;
	/** Fountain credit line, e.g. "Written by" (film/TV) or "by" (stage play). */
	credit?: string;
}

/** Industry convention: quote the length as a round number, not an exact count. */
export function roundedWordCount(words: number): number {
	if (words < 1000) return Math.max(100, Math.round(words / 100) * 100);
	if (words < 20000) return Math.round(words / 500) * 500;
	return Math.round(words / 1000) * 1000;
}

/**
 * Title page block. 'novel' follows standard manuscript format (author and
 * contact, approximate word count, title and byline); 'fountain' emits a
 * Fountain title page for screenwriting tools.
 */
export function buildTitlePage(
	style: TitlePageStyle,
	title: string,
	meta: ManuscriptMeta,
	totalWords: number
): string {
	if (style === 'novel') {
		const lines: string[] = [];
		if (meta.author?.trim()) lines.push(meta.author.trim());
		if (meta.contact?.trim()) lines.push(...meta.contact.trim().split('\n'));
		if (lines.length > 0) lines.push('');
		// English number formatting — the standard for submission manuscripts
		lines.push(`About ${roundedWordCount(totalWords).toLocaleString('en-US')} words`, '');
		lines.push('---', '');
		lines.push(`# ${title}`, '');
		if (meta.author?.trim()) lines.push(`by ${meta.author.trim()}`, '');
		lines.push('---', '');
		return lines.join('\n');
	}
	if (style === 'fountain') {
		const lines: string[] = [`Title: ${title}`, `Credit: ${meta.credit?.trim() || 'Written by'}`];
		if (meta.author?.trim()) lines.push(`Author: ${meta.author.trim()}`);
		if (meta.contact?.trim()) {
			const contactLines = meta.contact.trim().split('\n');
			lines.push(`Contact: ${contactLines[0]}`);
			for (const extra of contactLines.slice(1)) lines.push(`    ${extra}`);
		}
		lines.push('', '===', '');
		return lines.join('\n');
	}
	return '';
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export interface ManuscriptOptions {
	/** Emit divider labels as headings (level from nesting depth). */
	includeHeadings: boolean;
	/** Separator between adjacent scenes (e.g. "***" or the centred "#"). */
	sceneSeparator: string;
	/** Steps applied per scene and to the whole manuscript, in order. */
	steps?: CompileStepConfig[];
	titlePage?: TitlePageStyle;
	author?: string;
	contact?: string;
	credit?: string;
	/** Text after the last scene, e.g. "THE END" for submission manuscripts. */
	endMark?: string;
}

export const DEFAULT_MANUSCRIPT_OPTIONS: ManuscriptOptions = {
	includeHeadings: true,
	sceneSeparator: '***',
	steps: [defaultStepConfig('remove-planning'), defaultStepConfig('strip-frontmatter')],
	titlePage: 'none',
	endMark: '',
};

/** Run every scene item through the scene-stage steps; drop scenes that end up empty. */
export function prepareItems(items: ManuscriptItem[], steps: CompileStepConfig[]): ManuscriptItem[] {
	return items
		.map((item) => {
			if (item.kind !== 'scene') return item;
			const text = applyCompileSteps(item.text, steps, {
				stage: 'scene',
				title: item.title,
				number: item.number,
				depth: item.depth,
			});
			return { ...item, text };
		})
		.filter((item) => item.kind !== 'scene' || item.text.length > 0);
}

/** Total prose words across prepared scene items. */
export function manuscriptWordTotal(items: ManuscriptItem[]): number {
	return items.reduce((sum, it) => (it.kind === 'scene' ? sum + countWords(it.text) : sum), 0);
}

/**
 * Assemble the final manuscript markdown from ordered items. Dividers become
 * headings (## at the top level, ### one level in, …), adjacent scenes are
 * joined with the separator, and manuscript-stage steps run over the result.
 */
export function assembleManuscript(
	name: string,
	items: ManuscriptItem[],
	opts: ManuscriptOptions = DEFAULT_MANUSCRIPT_OPTIONS
): string {
	const steps = opts.steps ?? [];
	const prepared = prepareItems(items, steps);

	const lines: string[] = [];
	const titlePage = opts.titlePage ?? 'none';
	if (titlePage !== 'none') {
		const total = manuscriptWordTotal(prepared);
		lines.push(
			buildTitlePage(titlePage, name, { author: opts.author, contact: opts.contact, credit: opts.credit }, total),
			''
		);
	} else {
		lines.push(`# ${name}`, '');
	}

	let prevWasScene = false;
	for (const item of prepared) {
		if (item.kind === 'heading') {
			if (opts.includeHeadings && item.label.trim()) {
				lines.push(`${'#'.repeat(Math.min(item.depth + 2, 6))} ${item.label.trim()}`, '');
			}
			prevWasScene = false;
		} else {
			if (prevWasScene && opts.sceneSeparator) lines.push(opts.sceneSeparator, '');
			lines.push(item.text, '');
			prevWasScene = true;
		}
	}

	if (opts.endMark?.trim()) lines.push(opts.endMark.trim(), '');

	let out = lines.join('\n').trimEnd() + '\n';
	const manuscriptSteps = steps.filter((s) => (s.stage ?? 'scene') === 'manuscript');
	if (manuscriptSteps.length) out = applyCompileSteps(out, manuscriptSteps, { stage: 'manuscript' }).trimEnd() + '\n';
	return out;
}

// ─── Named workflows & industry presets ──────────────────────────────────────

export type CompileOutputFormat = 'md' | 'fountain' | 'docx' | 'epub';

export const OUTPUT_FORMAT_LABELS: Record<CompileOutputFormat, string> = {
	md: 'Markdown note (.md)',
	fountain: 'Screenplay (.fountain)',
	docx: 'Word manuscript (.docx)',
	epub: 'E-book (.epub)',
};

export const OUTPUT_FORMAT_EXT: Record<CompileOutputFormat, string> = {
	md: '.md',
	fountain: '.fountain',
	docx: '.docx',
	epub: '.epub',
};

export interface WorkflowPreset {
	id: string;
	name: string;
	description: string;
	build: () => CompileWorkflowSettings;
}

const CLEANUP_STEPS = (): CompileStepConfig[] => [
	defaultStepConfig('remove-planning'),
	defaultStepConfig('strip-frontmatter'),
	defaultStepConfig('remove-comments'),
	defaultStepConfig('remove-links'),
	defaultStepConfig('remove-strikethroughs'),
	defaultStepConfig('tidy-whitespace'),
];

/**
 * Finished, industry-standard starting points. Creating a workflow copies the
 * preset; from then on it's the writer's own to rename and edit freely.
 */
export const WORKFLOW_PRESETS: WorkflowPreset[] = [
	{
		id: 'novel-docx',
		name: 'Novel manuscript (Word)',
		description:
			'Agent-submission standard manuscript: Times New Roman 12, double-spaced, 1" margins, running header, chapters on new pages, centred # scene breaks, THE END.',
		build: () => ({
			id: generateId(),
			name: 'Novel manuscript (Word)',
			output: 'docx',
			includeHeadings: true,
			sceneSeparator: '#',
			steps: CLEANUP_STEPS(),
			titlePage: 'novel',
			author: '',
			contact: '',
			endMark: 'THE END',
		}),
	},
	{
		id: 'novel-md',
		name: 'Novel manuscript (Markdown)',
		description: 'The same structure as the Word manuscript, kept as a vault note.',
		build: () => ({
			id: generateId(),
			name: 'Novel manuscript (Markdown)',
			output: 'md',
			includeHeadings: true,
			sceneSeparator: '#',
			steps: CLEANUP_STEPS(),
			titlePage: 'novel',
			author: '',
			contact: '',
			endMark: 'THE END',
		}),
	},
	{
		id: 'film-fountain',
		name: 'Feature film (Fountain)',
		description:
			'Industry plain-text screenplay. Opens in Final Draft, Fade In, or WriterDuet with correct Courier formatting. Dividers become # sections.',
		build: () => ({
			id: generateId(),
			name: 'Feature film',
			output: 'fountain',
			includeHeadings: true,
			sceneSeparator: '',
			steps: CLEANUP_STEPS(),
			titlePage: 'fountain',
			author: '',
			contact: '',
			credit: 'Written by',
			endMark: '',
		}),
	},
	{
		id: 'tv-fountain',
		name: 'TV teleplay (Fountain)',
		description:
			'Screenplay with act structure: name your dividers TEASER, ACT ONE, ACT TWO… and END OF ACT markers are inserted automatically.',
		build: () => ({
			id: generateId(),
			name: 'TV teleplay',
			output: 'fountain',
			includeHeadings: true,
			sceneSeparator: '',
			steps: CLEANUP_STEPS(),
			titlePage: 'fountain',
			author: '',
			contact: '',
			credit: 'Written by',
			endMark: '',
			actMarkers: true,
		}),
	},
	{
		id: 'play-fountain',
		name: 'Stage play (Fountain)',
		description: 'Play script in Fountain, with a stage-play title page credit.',
		build: () => ({
			id: generateId(),
			name: 'Stage play',
			output: 'fountain',
			includeHeadings: true,
			sceneSeparator: '',
			steps: CLEANUP_STEPS(),
			titlePage: 'fountain',
			author: '',
			contact: '',
			credit: 'A play by',
			endMark: '',
		}),
	},
	{
		id: 'epub',
		name: 'E-book (EPUB)',
		description: 'An .epub for e-readers — top-level dividers become chapters.',
		build: () => ({
			id: generateId(),
			name: 'E-book',
			output: 'epub',
			includeHeadings: true,
			sceneSeparator: '***',
			steps: CLEANUP_STEPS(),
			titlePage: 'none',
			author: '',
			contact: '',
			endMark: 'THE END',
		}),
	},
];

export function getWorkflowPreset(id: string): WorkflowPreset | undefined {
	return WORKFLOW_PRESETS.find((p) => p.id === id);
}

/** Manuscript options from a saved workflow. */
export function workflowOptions(wf: CompileWorkflowSettings): ManuscriptOptions {
	return {
		includeHeadings: wf.includeHeadings,
		sceneSeparator: wf.sceneSeparator,
		steps: wf.steps,
		titlePage: wf.titlePage,
		author: wf.author,
		contact: wf.contact,
		credit: wf.credit,
		endMark: wf.endMark,
	};
}

/**
 * One-time migration of a pre-overhaul single workflow (preset/
 * includeBeatHeadings/includeSceneTitles shape) into a named workflow.
 * "Scene titles" becomes an explicit prepend-title step so nothing is lost.
 */
export function migrateLegacyWorkflow(legacy: unknown): CompileWorkflowSettings {
	const old = (legacy ?? {}) as Record<string, unknown>;
	const steps: CompileStepConfig[] = Array.isArray(old['steps'])
		? (old['steps'] as CompileStepConfig[]).map((s) => ({ ...s, stage: s.stage ?? 'scene' }))
		: [defaultStepConfig('remove-planning'), defaultStepConfig('strip-frontmatter')];
	if (old['includeSceneTitles'] === true && !steps.some((s) => s.id === 'prepend-title')) {
		const prepend = defaultStepConfig('prepend-title');
		prepend.options['format'] = '### $1'; // old "Scene titles" toggle rendered ### headings
		steps.unshift(prepend);
	}
	const wasScreenplay = old['preset'] === 'screenplay';
	return {
		id: generateId(),
		name: 'My workflow',
		output: wasScreenplay ? 'fountain' : 'md',
		includeHeadings: old['includeBeatHeadings'] !== false,
		sceneSeparator: typeof old['sceneSeparator'] === 'string' ? (old['sceneSeparator']) : '***',
		steps,
		titlePage: (['none', 'novel', 'fountain'] as const).includes(old['titlePage'] as TitlePageStyle)
			? (old['titlePage'] as TitlePageStyle)
			: 'none',
		author: typeof old['author'] === 'string' ? old['author'] : '',
		contact: typeof old['contact'] === 'string' ? (old['contact']) : '',
		endMark: typeof old['endMark'] === 'string' ? (old['endMark']) : '',
	};
}

/**
 * Give every saved workflow the "Remove planning" step once. Workflows made
 * before the step existed would otherwise keep exporting sheets' planning.
 * Returns whether anything changed; the caller records that it ran, so a
 * writer who later removes the step keeps it removed.
 */
export function addPlanningStep(workflows: CompileWorkflowSettings[]): boolean {
	let changed = false;
	for (const wf of workflows) {
		if (!Array.isArray(wf.steps) || wf.steps.some((st) => st.id === 'remove-planning')) continue;
		wf.steps.unshift(defaultStepConfig('remove-planning'));
		changed = true;
	}
	return changed;
}
