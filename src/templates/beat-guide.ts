import type { StorygridTemplate } from '../grid-data';
import { getTemplateById } from './story-templates';

/** One beat as the beat guide window lists it: roughly where it falls ("~10%") and its name. */
export interface BeatGuideBeat {
	where: string;
	label: string;
}

/** What the beat guide window shows for a grid: the template's name and every beat in order. */
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
