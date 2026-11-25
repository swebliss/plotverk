import { t } from '../i18n';
import { setPhosphorIcon } from '../utils/icons';
import { SetupStage, SetupState } from './setup-marks';
import type { NextPlan } from './book-order';

/** The one icon for each stage — the same everywhere setups appear. */
export const STAGE_ICON: Record<SetupState, string> = {
	planted: 'plant',
	reminded: 'bell-ringing',
	'paid-off': 'seal-check',
	'let-go': 'wind',
};

/**
 * The same three icons, filled: a planned step that is WRITTEN in the text.
 * The outline above = only planned so far. One rule wherever plans show
 * (grid card marker, card editor).
 */
export const STAGE_ICON_WRITTEN: Record<SetupStage, string> = {
	planted: 'plant-fill',
	reminded: 'bell-ringing-fill',
	'paid-off': 'seal-check-fill',
};

/** A plan on a card, short: "Plant planned", "Reminder planned", "Payoff planned". */
export function planWord(stage: SetupStage): string {
	return t(`setups.card.plan.${stage}`);
}

export function stageWord(state: SetupState): string {
	return t(`setups.stage.${state}`);
}

/** "Chapter 14", or "Ch. 14" on a small surface (a card, a picker row). */
export function chapterWord(n: number, short = false): string {
	return t(short ? 'setups.place.chapterShort' : 'setups.place.chapter', { n });
}

/** "Reminded in Chapter 14" ("in Ch. 14" when short), or just "Reminded" when the place is not in the book. */
export function stageLine(state: SetupState, chapter: number | null, short = false): string {
	const word = stageWord(state);
	if (chapter === null || state === 'let-go') return word;
	return `${word} ${t('setups.sheet.inPlace', { place: chapterWord(chapter, short) })}`;
}

/** "Payoff planned for Chapter 12" ("Ch. 12" when short), or for the card's / event's name when it has no chapter yet. */
export function planLine(plan: NextPlan, short = false): string {
	const place = plan.chapter !== null ? chapterWord(plan.chapter, short) : plan.label || '…';
	return t(`setups.plan.${plan.stage}`, { place });
}

/** "open for 9 chapters". */
export function openFor(chapters: number): string {
	return chapters === 1 ? t('setups.openForOne') : t('setups.openForOther', { n: chapters });
}

/** A small grey stage icon + word (`Planted` with its sprout). */
export function renderStage(host: HTMLElement, state: SetupState, cls = 'sg-setup-stage'): HTMLElement {
	const el = host.createDiv({ cls });
	setPhosphorIcon(el.createSpan({ cls: 'sg-setup-stage-icon' }), STAGE_ICON[state], '•');
	el.createSpan({ cls: 'sg-setup-stage-word', text: stageWord(state) });
	return el;
}
