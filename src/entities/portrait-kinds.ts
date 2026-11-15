import type { EntityKind } from './entity-kinds';

/**
 * Codex kinds drawn as the round-portrait card (round photo overlapping the
 * card) instead of the square-image tile: people, living creatures, and the
 * groups they form. The ONE list — every portrait-vs-tile decision in the
 * Codex gallery reads it.
 *
 * Wildlife is left out on purpose: it holds plants and crops as well as
 * animals. Illness is not a creature. Custom (user-made) kinds are never
 * portrait.
 */
export const PORTRAIT_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
	'character',
	// Creatures & Life
	'species',
	'monster',
	// Groups & Factions
	'faction',
	'bloodline',
	'government',
	'military',
	'social-class',
]);

export function isPortraitKind(kind: EntityKind): boolean {
	return PORTRAIT_KINDS.has(kind);
}

export interface PortraitFact {
	key: string;
	value: string;
}

/**
 * What a non-character portrait card shows under the name: the entry's
 * "what sort of thing is it" fact (Type — or Form for governments, Rank for
 * social classes) as a muted subtitle, then its other gallery facts as
 * labelled rows. Facts that only repeat the entry's name (e.g. a bloodline's
 * "Family Name") are dropped. Empty input → nothing shown.
 */
const SUBTITLE_KEYS = ['type', 'form', 'rank'];

export function portraitCardText(
	name: string,
	facts: readonly PortraitFact[]
): { subtitle: string; rows: PortraitFact[] } {
	const sameAsName = (v: string) => v.trim().toLowerCase() === name.trim().toLowerCase();
	const useful = facts.filter((f) => f.value.trim() && !sameAsName(f.value));
	const typeFact = useful.find((f) => SUBTITLE_KEYS.includes(f.key.trim().toLowerCase()));
	return {
		subtitle: typeFact ? typeFact.value.trim() : '',
		rows: useful.filter((f) => f !== typeFact),
	};
}
