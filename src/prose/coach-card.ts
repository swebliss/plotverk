import type { EditorView } from '@codemirror/view';
import { t } from '../i18n';
import { ProseFinding, RepetitionGroup } from './types';
import { findVerbPairing } from './verb-suggestions';

/**
 * The little card a coach mark opens — on hover (desktop) or tap (phone).
 * It points, it never writes: the most it offers is one word ("Try: crept"),
 * and only the writer's own tap puts that word in.
 *
 * word · kind (· "4 times in 60 words") / one-line why / [Try chips, Pro] /
 * Not here · Never this word
 */

export interface CoachCardActions {
	isPro(): boolean;
	/** "Not here": hide this kind + word in this scene. */
	notHere(view: EditorView, finding: ProseFinding): void;
	/** "Never this word": add it to the global list. */
	never(finding: ProseFinding): void;
}

/** Kind label + why line keys, shared with the Coach tab. */
export const COACH_KIND_KEY: Record<ProseFinding['kind'], string> = {
	adverb: 'coach.kind.adverb',
	repetition: 'coach.kind.repetition',
	passive: 'coach.kind.passive',
	wordy: 'coach.kind.wordy',
	crutch: 'coach.kind.crutch',
	cliche: 'coach.kind.cliche',
	name: 'coach.kind.name',
	rhythm: 'coach.kind.rhythm',
};
export const COACH_WHY_KEY: Record<ProseFinding['kind'], string> = {
	adverb: 'coach.why.adverb',
	repetition: 'coach.why.repetition',
	passive: 'coach.why.passive',
	wordy: 'coach.why.wordy',
	crutch: 'coach.why.crutch',
	cliche: 'coach.why.cliche',
	name: 'coach.why.name',
	rhythm: 'coach.why.rhythm',
};

/** Kinds with no single word to put on the "never" list: only "Not here" is offered. */
export const NO_NEVER_KINDS: ReadonlySet<ProseFinding['kind']> = new Set(['rhythm']);

/** Kinds whose finding is a phrase: the card and the Coach tab show the words as written. */
export const PHRASE_KINDS: ReadonlySet<ProseFinding['kind']> = new Set(['passive', 'wordy', 'cliche']);

/** The words a card / list item shows for a finding. */
export function findingLabel(f: Pick<ProseFinding, 'kind' | 'word' | 'text' | 'count'>): string {
	if (f.kind === 'rhythm') return t('coach.rhythmHead', { count: String(f.count ?? 0) });
	// Names show as written ("Tamsyn"), not as the lower-case key.
	return PHRASE_KINDS.has(f.kind) || f.kind === 'name' ? f.text : (f.word ?? f.text);
}

/**
 * The "Try" offer for an adverb in a document, if the word right next to it is
 * a verb we have a pairing for. `from`/`to` cover the verb AND the adverb —
 * the span a chip replaces.
 */
export function tryOfferAt(
	doc: string,
	finding: Pick<ProseFinding, 'kind' | 'from' | 'to' | 'word'>
): { from: number; to: number; suggestions: string[] } | null {
	if (finding.kind !== 'adverb' || !finding.word) return null;
	const before = doc.slice(Math.max(0, finding.from - 40), finding.from);
	const after = doc.slice(finding.to, finding.to + 40);
	const prev = /(\p{L}[\p{L}\p{M}'’-]*)[ \t]+$/u.exec(before);
	const next = /^[ \t]+(\p{L}[\p{L}\p{M}'’-]*)/u.exec(after);
	const pairing = findVerbPairing(finding.word, prev?.[1], next?.[1]);
	if (!pairing) return null;
	if (pairing.side === 'prev' && prev) {
		return { from: finding.from - (before.length - prev.index), to: finding.to, suggestions: pairing.suggestions };
	}
	if (pairing.side === 'next' && next) {
		return { from: finding.from, to: finding.to + next[0].length, suggestions: pairing.suggestions };
	}
	return null;
}

/** The one-word hand-out under a Pro finding ("Often just: to"), or null. */
export function suggestionLine(f: Pick<ProseFinding, 'kind' | 'suggestion' | 'parts'>): string | null {
	if (f.kind === 'rhythm' && f.parts?.length) {
		const lens = f.parts.map((p) => p.words);
		const lo = Math.min(...lens);
		const hi = Math.max(...lens);
		return lo === hi ? t('coach.rhythmSame', { words: String(lo) }) : t('coach.rhythmRange', { min: String(lo), max: String(hi) });
	}
	if (!f.suggestion) return null;
	if (f.kind === 'wordy') return t('coach.wordyHint', { word: f.suggestion });
	if (f.kind === 'name') return t('coach.nameHint', { name: f.suggestion });
	return null;
}

/** A chip's word with the replaced span's capital kept ("Walked slowly" → "Crept"). */
export function matchCase(replaced: string, word: string): string {
	const first = replaced.charAt(0);
	return first && first !== first.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

export class CoachCard {
	private el: HTMLElement | null = null;
	/** The document the card lives in — a popout window's, when the editor is in one. */
	private doc: Document = activeDocument;
	private hideTimer: number | null = null;
	private overCard = false;
	private readonly onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.hide(); };
	private readonly onDown = (e: PointerEvent) => {
		if (this.el && !this.el.contains(e.target as Node)) this.hide();
	};
	private readonly onScroll = (e: Event) => {
		if (this.el && !this.el.contains(e.target as Node)) this.hide();
	};

	constructor(private readonly actions: CoachCardActions) {}

	show(view: EditorView, finding: ProseFinding, group: RepetitionGroup | undefined, rect: DOMRect, viaTap: boolean): void {
		this.hide();
		this.doc = view.dom.ownerDocument;
		const card = this.doc.body.createDiv({ cls: 'sg-prose-card' });
		if (viaTap) card.addClass('sg-prose-card--tap');
		card.setAttribute('role', 'dialog');
		this.el = card;

		const head = card.createDiv({ cls: 'sg-prose-card-head' });
		head.createSpan({ cls: 'sg-prose-card-word', text: findingLabel(finding) });
		head.createSpan({ cls: 'sg-prose-card-kind', text: t(COACH_KIND_KEY[finding.kind]) });
		if (finding.kind === 'crutch' && finding.count) {
			head.createSpan({ cls: 'sg-prose-card-kind', text: t('coach.crutchMeta', { count: String(finding.count) }) });
		}
		if (group) {
			head.createSpan({
				cls: 'sg-prose-card-kind',
				text: t('coach.repeatMeta', { count: String(group.count), window: String(group.window) }),
			});
		}
		card.createDiv({ cls: 'sg-prose-card-why', text: t(COACH_WHY_KEY[finding.kind]) });
		const hint = suggestionLine(finding);
		if (hint) card.createDiv({ cls: 'sg-prose-card-why', text: hint });

		if (this.actions.isPro()) {
			const offer = tryOfferAt(view.state.doc.toString(), finding);
			if (offer) {
				const row = card.createDiv({ cls: 'sg-prose-try' });
				row.createSpan({ cls: 'sg-prose-try-label', text: t('coach.try') });
				const replaced = view.state.doc.sliceString(offer.from, offer.to);
				for (const s of offer.suggestions) {
					const chip = row.createEl('button', { cls: 'sg-prose-chip', text: s });
					chip.setAttribute('aria-label', t('coach.tryAria', { span: replaced, word: s }));
					chip.addEventListener('click', () => {
						// Only replace if the text is still what the offer was made for.
						if (view.state.doc.sliceString(offer.from, offer.to) === replaced) {
							view.dispatch({
								changes: { from: offer.from, to: offer.to, insert: matchCase(replaced, s) },
								userEvent: 'input.coach',
							});
						}
						this.hide();
					});
				}
			}
		}

		const acts = card.createDiv({ cls: 'sg-prose-acts' });
		const notHere = acts.createEl('button', { cls: 'sg-prose-act', text: t('coach.notHere') });
		notHere.addEventListener('click', () => { this.hide(); this.actions.notHere(view, finding); });
		if (!NO_NEVER_KINDS.has(finding.kind)) {
			const never = acts.createEl('button', { cls: 'sg-prose-act', text: t('coach.never') });
			never.addEventListener('click', () => { this.hide(); this.actions.never(finding); });
		}

		card.addEventListener('mouseenter', () => { this.overCard = true; this.cancelHide(); });
		card.addEventListener('mouseleave', () => { this.overCard = false; this.scheduleHide(); });

		this.place(card, rect);
		this.doc.addEventListener('keydown', this.onKey, true);
		this.doc.addEventListener('pointerdown', this.onDown, true);
		// A tap can scroll the editor (keyboard, cursor), so only a hover card closes on scroll.
		if (!viaTap) this.doc.addEventListener('scroll', this.onScroll, true);
	}

	/** The pointer left the mark: close soon, unless it reaches the card. */
	leaveMark(): void {
		if (this.el && !this.overCard) this.scheduleHide();
	}

	hide(): void {
		this.cancelHide();
		this.overCard = false;
		this.doc.removeEventListener('keydown', this.onKey, true);
		this.doc.removeEventListener('pointerdown', this.onDown, true);
		this.doc.removeEventListener('scroll', this.onScroll, true);
		this.el?.remove();
		this.el = null;
	}

	private scheduleHide(): void {
		this.cancelHide();
		this.hideTimer = window.setTimeout(() => this.hide(), 250);
	}

	private cancelHide(): void {
		if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
		this.hideTimer = null;
	}

	/** Below the mark if it fits, else above; always inside the visible window. */
	private place(card: HTMLElement, rect: DOMRect): void {
		const margin = 8;
		const win = this.doc.defaultView ?? window;
		const vw = win.visualViewport?.width ?? win.innerWidth;
		const vh = win.visualViewport?.height ?? win.innerHeight;
		const box = card.getBoundingClientRect();
		let left = Math.min(Math.max(margin, rect.left), vw - box.width - margin);
		let top = rect.bottom + 6;
		if (top + box.height > vh - margin) top = Math.max(margin, rect.top - box.height - 6);
		left = Math.max(margin, left);
		card.style.left = `${Math.round(left)}px`;
		card.style.top = `${Math.round(top)}px`;
	}
}
