import type { GridRow, SceneCard, StorygridTemplate } from '../grid-data';
import { getTemplateById } from './story-templates';

/** One beat as the beat guide box lists it: roughly where it falls ("~10%") and its name. */
export interface BeatGuideBeat {
	where: string;
	label: string;
}

/** What the beat guide box shows for a grid: the template's name and every beat in order. */
export interface BeatGuide {
	name: string;
	beats: BeatGuideBeat[];
}

/** The template a grid was made from: a built-in one first, else one of the writer's saved templates. */
export function findTemplate(
	templateId: string | undefined,
	customTemplates: StorygridTemplate[] | undefined,
): StorygridTemplate | undefined {
	if (!templateId) return undefined;
	return getTemplateById(templateId)
		?? (Array.isArray(customTemplates) ? customTemplates.find((tpl) => tpl?.id === templateId) : undefined);
}

/** The "where in the book" part of a beat hint: the text before " · " ("~10% · text" → "~10%"). */
export function beatWhere(hint: unknown): string {
	if (typeof hint !== 'string') return '';
	const sep = hint.indexOf(' · ');
	return sep > 0 ? hint.slice(0, sep).trim() : '';
}

/**
 * The beat guide for a grid made from `templateId`, or null when there is nothing to explain:
 * no template, or a template without guide text (the blank grid, most saved templates).
 */
export function beatGuideFor(
	templateId: string | undefined,
	customTemplates: StorygridTemplate[] | undefined,
): BeatGuide | null {
	const tpl = findTemplate(templateId, customTemplates);
	if (!tpl || !Array.isArray(tpl.rows)) return null;
	if (!tpl.rows.some((r) => typeof r?.hint === 'string' && r.hint.trim())) return null;
	return {
		name: typeof tpl.name === 'string' ? tpl.name.trim() : '',
		beats: tpl.rows.map((r) => ({
			where: beatWhere(r?.hint),
			label: typeof r?.label === 'string' ? r.label : '',
		})),
	};
}

/**
 * The same guide read from the grid itself, for a grid whose template is gone or unknown but which still
 * has guide cards: every row in order, with its guide card's title ("~10%") as the "where" part.
 * Null when the grid has no guide cards.
 */
export function beatGuideFromGrid(rows: GridRow[], cards: SceneCard[]): BeatGuide | null {
	const guides = cards.filter((c) => c.guide);
	if (!guides.length) return null;
	return {
		name: '',
		beats: [...rows].sort((a, b) => a.order - b.order).map((r) => ({
			where: (guides.find((c) => c.rowId === r.id)?.title ?? '').trim(),
			label: r.label,
		})),
	};
}

/** The columns holding a template's guide cards (normally one: the beat guide column). */
export function guideColumnIds(cards: SceneCard[]): Set<string> {
	return new Set(cards.filter((c) => c.guide).map((c) => c.colId));
}

/** True when a guide card's title reads as a place in the book ("~10%", "0–1%", "10 – 20 %"),
 *  so the beat box can add "of the way through your book" after it. */
export function isBookPosition(text: unknown): boolean {
	return typeof text === 'string' && /\d\s*%/.test(text);
}
