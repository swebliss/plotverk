import type { CharacterField } from '../grid-data';

/**
 * Field names on one sheet must differ: a sheet stores each long-text field
 * under its name as a `## Heading`, and two fields with the same heading
 * write into the same section, so one would overwrite the other. Names are
 * compared the way the sheet matches them (ignoring case and outer spaces).
 * Pictures are exempt: they are matched by position, not by name.
 */
const key = (label: string) => label.trim().toLowerCase();

/** `label`, or `label 2`, `label 3`… — the first that no other field on the sheet uses. */
export function freeFieldLabel(label: string, fields: readonly CharacterField[], self?: CharacterField): string {
	const base = label.trim();
	const used = new Set(fields.filter((f) => f !== self && f.type !== 'image').map((f) => key(f.label)));
	if (!used.has(key(base))) return base;
	for (let n = 2; ; n++) {
		const next = `${base} ${n}`;
		if (!used.has(key(next))) return next;
	}
}

/**
 * The last check before a save: any field (pictures aside) whose name an
 * earlier field already uses gets a free name, in place. The earlier field
 * keeps its name, so the text already on the sheet stays where it is.
 */
export function makeFieldLabelsUnique(fields: CharacterField[]): void {
	const seen: CharacterField[] = [];
	for (const f of fields) {
		if (f.type === 'image') continue;
		if (seen.some((s) => key(s.label) === key(f.label))) f.label = freeFieldLabel(f.label, fields, f);
		seen.push(f);
	}
}
