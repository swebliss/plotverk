import { App, Component, TFile, MarkdownRenderer } from 'obsidian';
import { parseEntityDocument, mergeWithSpecDefaults } from '../entities/entity-parse';
import { RelationLine, classifyRelation, parseRelationLines, partitionRelationLines, RELATIONSHIP_TYPE_OTHER } from '../utils/relations';
import { UNTYPED_KIND, getKindSpec, groupFieldsIntoSections } from '../entities/entity-kinds';
import { kindForFile } from '../entities/entity-manager';
import { isFieldEmpty } from '../entities/field-types';
import { renderFieldWidget } from './field-widgets';
import { setPhosphorIcon } from '../utils/icons';
import { resolveImageField } from '../entities/sheet-images';

/**
 * Read-only, single-column Codex entity card for narrow surfaces (the Writers
 * Panel sidebar). Deliberately NOT a refactor of codex-view.ts's renderDetail:
 * that page is a 2-column layout coupled to the Codex view's own navigation
 * and appearance index, and re-shaping it for a ~250-330px sidebar would risk
 * regressing a page that already works. Both renderers share the same pure
 * pipeline (parseEntityDocument → mergeWithSpecDefaults → groupFieldsIntoSections
 * → renderFieldWidget), so they can't drift out of sync with each other.
 *
 * Progressive disclosure: any field for which isFieldEmpty() is true is
 * dropped entirely before rendering — no placeholder chips, no empty
 * portrait box, no "Not yet defined" rows. Only what the writer actually
 * filled in appears.
 */

const NAME_LABELS = ['Full Name', 'Name', 'Title', 'Topic'];

export interface EntityPreviewOptions {
	app: App;
	/** Owns the MarkdownRenderer lifecycle — pass the hosting ItemView, never a throwaway Component. */
	component: Component;
	file: TFile;
	projectRoot: string;
	/** Back to the entity list — what the "‹ Codex" link calls, regardless of
	 *  how many in-card wikilinks were followed to get here. */
	onBack: () => void;
	/** In-panel navigation to another entity's card (clicked a wikilink inside the sheet). */
	onNavigate: (entityPath: string) => void;
	/** The ONLY escape hatch to the full, editable Codex in the main window. */
	onEdit: () => void;
	/** Resolve a wikilink's linktext to a Codex entity's file path, or null if it isn't one. */
	resolveEntity: (linktext: string) => string | null;
}

export async function renderEntityPreview(el: HTMLElement, opts: EntityPreviewOptions): Promise<void> {
	el.empty();

	let content: string;
	try {
		content = await opts.app.vault.read(opts.file);
	} catch {
		opts.onBack();
		return;
	}

	const parsed = parseEntityDocument(content, opts.file.basename);
	const kind = parsed.kind ?? kindForFile(opts.app, opts.file) ?? UNTYPED_KIND;
	const spec = getKindSpec(kind);
	const fields = mergeWithSpecDefaults(kind, parsed.fields, parsed.cleanSlate);

	// The progressive-disclosure line: everything below renders only from `filled`.
	const filled = fields.filter((f) => !isFieldEmpty(f.type, f.value, f.config));

	const root = el.createDiv({ cls: `sg-outline-preview sg-outline-preview--${kind}` });

	// ── Band: back-to-Codex link · kind chip · spacer · edit ────────────────
	const band = root.createDiv({ cls: 'sg-outline-preview-band' });
	renderBackLink(band, opts);

	band.createDiv({ cls: 'sg-outline-preview-kind', text: spec.singular });
	band.createDiv({ cls: 'sg-outline-preview-band-spacer' });

	const editBtn = band.createEl('button', { cls: 'sg-outline-preview-edit', attr: { 'aria-label': 'Open in Codex to edit' } });
	setPhosphorIcon(editBtn, 'pencil', '✎');
	editBtn.addEventListener('click', () => opts.onEdit());

	// ── Hero: portrait · name · sub-line ──────────────────────────────────
	const hero = root.createDiv({ cls: 'sg-outline-preview-hero' });
	const imageField = filled.find((f) => f.type === 'image');
	if (imageField) {
		const imgFile = resolveImageField(opts.app, imageField.value, opts.file.path);
		if (imgFile instanceof TFile) {
			const portrait = hero.createDiv({ cls: 'sg-outline-preview-portrait' });
			portrait.createEl('img', { attr: { src: opts.app.vault.getResourcePath(imgFile), alt: parsed.name } });
		}
	}
	const heroInfo = hero.createDiv({ cls: 'sg-outline-preview-hero-info' });
	heroInfo.createDiv({ cls: 'sg-outline-preview-name', text: parsed.name });
	const subLine = filled
		.filter((f) => f.type === 'text' && !NAME_LABELS.includes(f.label))
		.slice(0, 2)
		.map((f) => f.value.trim())
		.filter(Boolean);
	if (subLine.length > 0) {
		heroInfo.createDiv({ cls: 'sg-outline-preview-sub', text: subLine.join(' · ') });
	}

	// ── Sections, rendered as labeled form fieldsets (groupFieldsIntoSections
	// already excludes image fields; each section carries the same icon used
	// by the sheet editor's own collapsible sections, so the card and the
	// form it was filled out on read as one system). ──────────────────────
	const sections = groupFieldsIntoSections(kind, filled);
	let renderedAny = sections.some((s) => s.fields.some((f) => !NAME_LABELS.includes(f.label)));

	if (renderedAny) {
		const sectionsHost = root.createDiv({ cls: 'sg-outline-preview-sections' });
		for (const section of sections) {
			const sectionFields = section.fields.filter((f) => !NAME_LABELS.includes(f.label));
			if (sectionFields.length === 0) continue;

			const sectionEl = sectionsHost.createDiv({ cls: 'sg-outline-preview-section' });
			const head = sectionEl.createDiv({ cls: 'sg-outline-preview-section-head' });
			setPhosphorIcon(head.createSpan({ cls: 'sg-outline-preview-section-icon' }), section.icon, '');
			head.createSpan({ cls: 'sg-outline-preview-section-title', text: section.title });

			const sectionBody = sectionEl.createDiv({ cls: 'sg-outline-preview-section-body' });
			for (const field of sectionFields) {
				const fieldEl = sectionBody.createDiv({ cls: 'sg-outline-preview-field' });
				fieldEl.createDiv({ cls: 'sg-outline-preview-field-label', text: field.label });
				if (field.type === 'textarea' && /relationship/i.test(field.label)) {
					await renderRelationRows(fieldEl, field.value, opts);
				} else if (field.type === 'textarea') {
					const proseEl = fieldEl.createDiv({ cls: 'sg-outline-preview-field-value sg-outline-preview-field-value--prose' });
					await MarkdownRenderer.render(opts.app, field.value, proseEl, opts.file.path, opts.component);
				} else {
					const valEl = fieldEl.createDiv({ cls: 'sg-outline-preview-field-value' });
					renderFieldWidget(valEl, field, 'read', {
						app: opts.app,
						onChange: () => {},
						component: opts.component,
						sourcePath: opts.file.path,
					});
					// Widgets with their own chrome (tag chips, slider track) sit in a
					// slimmer box — see .sg-outline-preview-field-value--inset.
					if (valEl.querySelector('.sg-chip-container, .sg-fw-slider-read')) {
						valEl.addClass('sg-outline-preview-field-value--inset');
					}
				}
			}
		}
	}

	if (!renderedAny) {
		root.createDiv({ cls: 'sg-outline-preview-empty', text: 'This sheet is empty. Tap ✎ to fill it in.' });
	}

	// ── In-card wikilink navigation — capture so Obsidian's own internal-link
	// handler (which would open a main-pane tab) never gets a chance to fire. ──
	root.addEventListener('click', (evt) => {
		const a = (evt.target as HTMLElement).closest<HTMLAnchorElement>('a.internal-link');
		if (!a) return;
		evt.preventDefault();
		evt.stopPropagation();
		const linktext = a.getAttribute('data-href') ?? a.getAttribute('href') ?? '';
		const target = opts.resolveEntity(linktext);
		if (target) opts.onNavigate(target);
		else void opts.app.workspace.openLinkText(linktext, opts.file.path);
	}, true);
}

/** Single "‹ Codex" link back to the entity list — no multi-step trail. */
function renderBackLink(band: HTMLElement, opts: EntityPreviewOptions): void {
	const btn = band.createEl('button', { cls: 'sg-outline-preview-crumb' });
	btn.createSpan({ cls: 'sg-outline-preview-crumb-arrow', text: '‹' });
	btn.createSpan({ text: 'Codex' });
	btn.addEventListener('click', opts.onBack);
}

/**
 * Grouped read-only relationship rows for the preview card — main words first,
 * the rest under a quiet "Other relationships" sub-label, each row = linked
 * name + relation word + a mini bond-strength meter when declared. Any prose
 * lines in the field that aren't relation declarations still render as
 * markdown below the rows, so nothing the writer typed disappears.
 */
async function renderRelationRows(fieldEl: HTMLElement, value: string, opts: EntityPreviewOptions): Promise<void> {
	const relations = parseRelationLines(value);
	if (relations.length === 0) {
		// No parseable relations — fall back to plain prose rendering.
		const proseEl = fieldEl.createDiv({ cls: 'sg-outline-preview-field-value sg-outline-preview-field-value--prose' });
		await MarkdownRenderer.render(opts.app, value, proseEl, opts.file.path, opts.component);
		return;
	}

	const host = fieldEl.createDiv({ cls: 'sg-outline-preview-rels' });
	const renderGroup = (rels: RelationLine[]): void => {
		for (const rel of rels) {
			const row = host.createDiv({ cls: 'sg-outline-preview-rel' });
			const relType = classifyRelation(rel.label);
			if (rel.label) row.createSpan({ cls: 'sg-outline-preview-rel-word', text: rel.label });
			row.createEl('a', {
				cls: 'internal-link sg-outline-preview-rel-name',
				text: rel.target,
				attr: { 'data-href': rel.target, href: rel.target },
			});
			if (rel.intensity !== undefined) {
				const meter = row.createDiv({ cls: 'sg-outline-preview-rel-meter' });
				const fill = meter.createDiv({ cls: 'sg-outline-preview-rel-meter-fill' });
				fill.style.width = `${rel.intensity * 10}%`;
				if (relType.id !== RELATIONSHIP_TYPE_OTHER.id) fill.style.background = relType.color;
				meter.setAttr('aria-label', `Bond strength ${rel.intensity} of 10`);
			}
		}
	};
	const { main, other } = partitionRelationLines(relations);
	renderGroup(main);
	if (other.length > 0) {
		if (main.length > 0) host.createDiv({ cls: 'sg-outline-preview-rel-sub', text: `Other relationships (${other.length})` });
		renderGroup(other);
	}

	// Prose lines that aren't relation declarations (no source `raw` match).
	const relLines = new Set(relations.map((r) => r.raw));
	const leftovers = value
		.split(/\r?\n/)
		.filter((l) => l.trim() && !relLines.has(l.trim()))
		.join('\n');
	if (leftovers) {
		const proseEl = fieldEl.createDiv({ cls: 'sg-outline-preview-field-value sg-outline-preview-field-value--prose' });
		await MarkdownRenderer.render(opts.app, leftovers, proseEl, opts.file.path, opts.component);
	}
}
