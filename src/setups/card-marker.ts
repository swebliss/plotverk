// Pure — no Obsidian imports.

import { SETUP_STAGES, SetupStage } from './setup-marks';

/** One planned setup step on a grid card, as much as the marker needs of it. */
export interface MarkerLine {
	stage: SetupStage;
	/** Written in the text of the scene the card is linked to. */
	written: boolean;
	setup: { name: string };
}

/** One icon of the small marker on a grid card. */
export interface MarkerStage {
	stage: SetupStage;
	/** Filled icon: every step of this stage on the card is written in its scene. */
	written: boolean;
	/** Setups whose step is still only planned here. */
	planned: string[];
	/** Setups whose step is already written in the card's scene. */
	writtenNames: string[];
}

/**
 * The marker on a grid card: one icon per stage that has a plan on the card
 * (Plant → Remind → Pay off), however many setups there are — it stays tiny.
 * An icon is filled only once nothing of that stage is left to write.
 */
export function cardMarkerStages(lines: readonly MarkerLine[]): MarkerStage[] {
	const out: MarkerStage[] = [];
	for (const stage of SETUP_STAGES) {
		const here = lines.filter((l) => l.stage === stage);
		if (here.length === 0) continue;
		const planned = here.filter((l) => !l.written).map((l) => l.setup.name);
		const writtenNames = here.filter((l) => l.written).map((l) => l.setup.name);
		out.push({ stage, written: planned.length === 0, planned, writtenNames });
	}
	return out;
}

export interface MarkerWords {
	/** "Plant planned", "Reminder planned", "Payoff planned". */
	planned: Record<SetupStage, string>;
	/** "Planted", "Reminded", "Paid off". */
	written: Record<SetupStage, string>;
}

/** The marker in words (tooltip + screen readers): "Plant planned: Sword · Paid off: Debt". */
export function markerLabel(stages: readonly MarkerStage[], words: MarkerWords): string {
	const parts: string[] = [];
	for (const s of stages) {
		if (s.planned.length) parts.push(`${words.planned[s.stage]}: ${s.planned.join(', ')}`);
		if (s.writtenNames.length) parts.push(`${words.written[s.stage]}: ${s.writtenNames.join(', ')}`);
	}
	return parts.join(' · ');
}

/**
 * Everything the grid shows about setups, as one string: when it is the same
 * as last time, nothing on screen has to be touched.
 */
export function linesKey<S extends { name: string }>(
	byCard: ReadonlyMap<string, readonly (MarkerLine & { setup: S })[]>, setupId: (setup: S) => string,
): string {
	return [...byCard.keys()].sort().map((cardId) => {
		const lines = byCard.get(cardId) ?? [];
		return `${cardId}=${lines.map((l) => [l.stage, l.written ? 'w' : 'p', setupId(l.setup), l.setup.name].join('|')).join(';')}`;
	}).join('\n');
}
