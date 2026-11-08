/**
 * Coach mark — a single accent-colored callout anchored to a real element in
 * one of our own views, with an arrow pointing at it and a "Got it" button.
 * Never a forced multi-step tour: at most `showCoachMarkChain` chains 3 of
 * these together (Next → Next → Got it), always skippable. Positioned via
 * `getBoundingClientRect()` + viewport clamping (same technique as
 * color-picker-popover.ts) so it only ever floats over our own UI, never
 * Obsidian's or another plugin's.
 */

import { t } from '../i18n';

export type CoachMarkPlacement = 'top' | 'bottom' | 'left' | 'right';

/** The class every coach mark callout carries. */
export const COACH_MARK_CLASS = 'sg-coach-mark';

/**
 * True when a click/mousedown landed on a coach mark (or something inside one).
 * A mark floats over the UI it points at, so to a panel's "click outside to
 * close" handler its Next / Got it buttons look like clicks outside the panel.
 */
export function isOnCoachMark(target: EventTarget | null): boolean {
	const el = target as { closest?: (selector: string) => unknown } | null;
	return !!el?.closest?.(`.${COACH_MARK_CLASS}`);
}

export interface CoachMarkStep {
	/** Element the callout points at. Skipped (not shown) if not currently in the DOM. */
	anchor: HTMLElement;
	text: string;
	title?: string;
	placement?: CoachMarkPlacement;
}

interface ShowSingleOptions {
	title?: string;
	placement?: CoachMarkPlacement;
	buttonLabel: string;
	/** Shown only when more steps remain in a chain. */
	skipLabel?: string;
	onPrimary: () => void;
	onSkip?: () => void;
	/** Fired only when the anchor becomes invisible (e.g. the user navigated to another tab) — never on an explicit dismissal. Distinct from onSkip/onPrimary so callers can tell "not shown yet" apart from "user closed it". */
	onHide?: () => void;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

/** Renders one callout; returns a close function. Caller owns advancing/dismissing. */
function showSingle(anchor: HTMLElement, text: string, opts: ShowSingleOptions): () => void {
	const mark = document.createElement('div');
	mark.className = COACH_MARK_CLASS;

	const arrow = document.createElement('div');
	arrow.className = 'sg-coach-mark-arrow';
	mark.appendChild(arrow);

	if (opts.title) {
		const title = document.createElement('div');
		title.className = 'sg-coach-mark-title';
		title.textContent = opts.title;
		mark.appendChild(title);
	}

	const body = document.createElement('div');
	body.className = 'sg-coach-mark-text';
	body.textContent = text;
	mark.appendChild(body);

	const footer = document.createElement('div');
	footer.className = 'sg-coach-mark-footer';
	if (opts.skipLabel) {
		const skip = document.createElement('button');
		skip.className = 'sg-coach-mark-skip';
		skip.textContent = opts.skipLabel;
		skip.addEventListener('click', () => { close(); opts.onSkip?.(); });
		footer.appendChild(skip);
	}
	const primary = document.createElement('button');
	primary.className = 'sg-coach-mark-btn';
	primary.textContent = opts.buttonLabel;
	primary.addEventListener('click', () => { close(); opts.onPrimary(); });
	footer.appendChild(primary);
	mark.appendChild(footer);

	document.body.appendChild(mark);

	const placement = opts.placement ?? 'bottom';
	const position = (): void => {
		const rect = anchor.getBoundingClientRect();
		const mw = mark.offsetWidth, mh = mark.offsetHeight;
		let top: number, left: number;
		switch (placement) {
			case 'top':
				top = rect.top - mh - 10;
				left = rect.left + rect.width / 2 - mw / 2;
				break;
			case 'left':
				top = rect.top + rect.height / 2 - mh / 2;
				left = rect.left - mw - 10;
				break;
			case 'right':
				top = rect.top + rect.height / 2 - mh / 2;
				left = rect.right + 10;
				break;
			case 'bottom':
			default:
				top = rect.bottom + 10;
				left = rect.left + rect.width / 2 - mw / 2;
				break;
		}
		// Flip vertically if it would run off either edge before clamping horizontally
		if (placement === 'bottom' && top + mh > window.innerHeight - 8) top = rect.top - mh - 10;
		if (placement === 'top' && top < 8) top = rect.bottom + 10;
		top = clamp(top, 8, window.innerHeight - mh - 8);
		left = clamp(left, 8, window.innerWidth - mw - 8);
		mark.style.top = `${top}px`;
		mark.style.left = `${left}px`;
		mark.classList.toggle('sg-coach-mark--arrow-top', top > rect.bottom - 4);
		mark.classList.toggle('sg-coach-mark--arrow-bottom', top + mh < rect.top + 4);
	};
	position();

	const onReposition = () => position();
	window.addEventListener('resize', onReposition);
	window.addEventListener('scroll', onReposition, true);

	let closed = false;
	const close = (): void => {
		if (closed) return;
		closed = true;
		window.removeEventListener('resize', onReposition);
		window.removeEventListener('scroll', onReposition, true);
		document.removeEventListener('keydown', onKeydown);
		visibilityObserver.disconnect();
		mark.remove();
	};
	const onKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') { close(); opts.onSkip?.(); }
	};
	document.addEventListener('keydown', onKeydown);

	// Auto-close (silently — this does NOT count as dismissed, so it can still
	// fire again later) once the anchor is no longer visible. Obsidian keeps
	// inactive tabs' content in the DOM rather than removing it, so without
	// this a callout — positioned `fixed` directly on document.body — would
	// keep floating on top of whatever view the user switches to next.
	const visibilityObserver = new IntersectionObserver((entries) => {
		if (!entries[0]?.isIntersecting) { close(); opts.onHide?.(); }
	}, { threshold: 0 });
	visibilityObserver.observe(anchor);

	return close;
}

/** Single coach mark, dismissed with "Got it". Returns a close function that fires neither callback. */
export function showCoachMark(
	anchor: HTMLElement,
	text: string,
	opts: { title?: string; placement?: CoachMarkPlacement; buttonLabel?: string; onDismiss?: () => void; onHide?: () => void } = {}
): () => void {
	return showSingle(anchor, text, {
		title: opts.title,
		placement: opts.placement,
		buttonLabel: opts.buttonLabel ?? t('coachMark.gotIt'),
		onPrimary: () => opts.onDismiss?.(),
		// Escape counts as an explicit dismissal too (the user chose to close it),
		// unlike the callout simply vanishing because its anchor's view closed.
		onSkip: () => opts.onDismiss?.(),
		onHide: opts.onHide,
	});
}

/**
 * Chains up to 3 coach marks (Next → Next → Got it), always skippable —
 * skipping (× / Escape / the Skip button) ends the whole chain, not just
 * the current step. Steps whose anchor isn't in the DOM are silently
 * dropped so a missing/collapsed element never breaks the chain.
 */
export function showCoachMarkChain(steps: CoachMarkStep[], onDone?: () => void, onHide?: () => void): void {
	const live = steps.filter((s) => document.body.contains(s.anchor)).slice(0, 3);
	if (!live.length) { onDone?.(); return; }
	let i = 0;
	const advance = (): void => {
		if (i >= live.length) { onDone?.(); return; }
		const step = live[i];
		const isLast = i === live.length - 1;
		// A step whose anchor is scrolled out of view (e.g. a lower section in a short card editor) would
		// otherwise count as "the user left" and end the tour unseen — so it restarted on every open.
		// 'nearest' scrolls only when needed, and only as far as needed.
		try { step.anchor.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* detached */ }
		showSingle(step.anchor, step.text, {
			title: step.title,
			placement: step.placement,
			buttonLabel: isLast ? t('coachMark.gotIt') : t('coachMark.next'),
			skipLabel: isLast ? undefined : t('coachMark.skip'),
			// Escape always ends the whole chain (never just the current step);
			// the "Skip" button is only rendered before the last step since
			// "Got it" already ends it there.
			onSkip: () => onDone?.(),
			onPrimary: () => { i++; advance(); },
			// The step's anchor went invisible (user navigated away) — this is
			// not a dismissal, so the whole chain just stops quietly, leaving
			// it eligible to run again next time.
			onHide: () => onHide?.(),
		});
	};
	advance();
}
