/**
 * Info popover — the small box behind an "i" button (beat guide cards, the beat guide
 * column's name, the template line under the grid title).
 *
 * Opens on mouse hover (desktop) and on click / tap / Enter; Esc, a click elsewhere
 * or focus moving away closes it. One box at a time, anywhere in the app.
 *
 * The box is attached to the trigger's own document body — never inside the zoomed
 * grid — so it works in popout windows and is not scaled by the grid's zoom. It stays
 * inside the screen edges and clear of the notch / home bar (safe areas, measured with
 * a hidden probe styled in styles.css).
 */

const HOVER_OPEN_MS = 300;
const HOVER_CLOSE_MS = 200;

export interface InfoTriggerOptions {
	/** Fills the box. Called every time it opens, so it always shows the current words. */
	build: (box: HTMLElement) => void;
	/** The box's name for screen readers. */
	label: () => string;
	/** The wider box (for the longer, general explanation). */
	wide?: boolean;
}

export interface InfoRect { left: number; top: number; right: number; bottom: number }

export interface InfoBoxPlacement {
	left: number;
	top: number;
	/** Tallest the box may be; its text scrolls inside beyond this. */
	maxHeight: number;
	/** True when the box sits above the "i" (not enough room below). */
	above: boolean;
	/** Where the little arrow points, from the box's left edge. */
	arrowLeft: number;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

/**
 * Where the box goes: under the "i" when it fits, otherwise on the side with more room;
 * its left edge starts just left of the "i" and slides to stay inside `safe`.
 * Pure (no DOM) so it can be tested.
 */
export function placeInfoBox(
	anchor: InfoRect,
	box: { width: number; height: number },
	safe: InfoRect,
	gap = 8,
): InfoBoxPlacement {
	const spaceBelow = Math.max(0, safe.bottom - anchor.bottom - gap);
	const spaceAbove = Math.max(0, anchor.top - safe.top - gap);
	const above = box.height > spaceBelow && spaceAbove > spaceBelow;
	const maxHeight = above ? spaceAbove : spaceBelow;
	const height = Math.min(box.height, maxHeight);
	const width = Math.min(box.width, Math.max(0, safe.right - safe.left));
	const centre = (anchor.left + anchor.right) / 2;
	const left = clamp(centre - 22, safe.left, Math.max(safe.left, safe.right - width));
	return {
		left,
		top: above ? anchor.top - gap - height : anchor.bottom + gap,
		maxHeight,
		above,
		arrowLeft: clamp(centre - left, 14, Math.max(14, width - 14)),
	};
}

interface OpenBox {
	trigger: HTMLElement;
	el: HTMLElement;
	pinned: boolean;
	close: (returnFocus?: boolean) => void;
	cancelHide: () => void;
	scheduleHide: () => void;
}

let current: OpenBox | null = null;
let idCounter = 0;

/** Closes the open box. With `within`, only when its "i" sits inside that element (a view redrawing itself). */
export function closeInfoPopover(within?: HTMLElement): void {
	if (!current) return;
	if (within && !within.contains(current.trigger)) return;
	current.close();
}

/** The usable part of the screen: inside the safe areas, with a small margin (styles.css: .sg-info-pop-safe). */
function safeRect(doc: Document): InfoRect {
	const probe = doc.body.createDiv({ cls: 'sg-info-pop-safe' });
	const r = probe.getBoundingClientRect();
	probe.remove();
	if (r.width > 0 && r.height > 0) return r;
	const win = doc.defaultView;
	return { left: 8, top: 8, right: (win?.innerWidth ?? 800) - 8, bottom: (win?.innerHeight ?? 600) - 8 };
}

function openBox(trigger: HTMLElement, opts: InfoTriggerOptions, pinned: boolean, focusBox: boolean): void {
	current?.close();
	const doc = trigger.doc;
	const win = trigger.win;
	const id = `sg-info-pop-${++idCounter}`;

	const el = doc.body.createDiv({
		cls: opts.wide ? 'sg-info-pop sg-info-pop--wide' : 'sg-info-pop',
		attr: { id, role: 'dialog', 'aria-label': opts.label() },
	});
	el.createDiv({ cls: 'sg-info-pop-arrow' });
	const body = el.createDiv({ cls: 'sg-info-pop-body', attr: { tabindex: '-1' } });
	opts.build(body);

	const position = (): void => {
		if (!trigger.isConnected) { close(); return; }
		// Measure at the top-left corner, hidden, at its natural width (class, not static styles:
		// the store's checker flags static style assignments).
		el.addClass('sg-info-pop--measuring');
		el.setCssProps({ '--sg-pop-width': '', '--sg-pop-maxh': '' });
		const safe = safeRect(doc);
		const safeWidth = Math.max(0, safe.right - safe.left);
		// Narrow screens: the box takes the safe width (its text wraps, so measure the height after).
		if (el.offsetWidth > safeWidth) el.setCssProps({ '--sg-pop-width': `${safeWidth}px` });
		const place = placeInfoBox(trigger.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, safe);
		// The border (1px top + bottom) sits outside the scrolling text.
		el.setCssProps({
			'--sg-pop-maxh': `${Math.max(0, place.maxHeight - 2)}px`,
			'--sg-pop-left': `${place.left}px`,
			'--sg-pop-top': `${place.top}px`,
			'--sg-pop-arrow-left': `${place.arrowLeft}px`,
		});
		el.removeClass('sg-info-pop--measuring');
		el.toggleClass('sg-info-pop--above', place.above);
	};

	let hideTimer: number | null = null;
	const cancelHide = (): void => {
		if (hideTimer !== null) { win.clearTimeout(hideTimer); hideTimer = null; }
	};
	const scheduleHide = (): void => {
		cancelHide();
		hideTimer = win.setTimeout(() => { if (current?.el === el && !current.pinned) close(); }, HOVER_CLOSE_MS);
	};

	const onPointerDownOutside = (e: PointerEvent): void => {
		const t = e.target as Node | null;
		if (t && (el.contains(t) || trigger.contains(t))) return;
		close();
	};
	const onKeydown = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape') return;
		const active = doc.activeElement;
		const inside = !!active && (el.contains(active) || active === trigger);
		// A box only shown by the resting mouse, while the writer types elsewhere: close it
		// quietly and let Esc reach what they are typing in (the card editor).
		if (!inside && !(current?.el === el && current.pinned)) { close(); return; }
		// Otherwise Esc closes only this box (not the card editor or a window behind it).
		e.preventDefault();
		e.stopPropagation();
		close(inside);
	};
	const onFocusIn = (e: FocusEvent): void => {
		const t = e.target as Node | null;
		if (t && (el.contains(t) || trigger.contains(t))) return;
		close();
	};
	const onReposition = (e?: Event): void => {
		// Scrolling the box's own text never moves the box.
		const t = e?.target;
		if (t && t !== doc && el.contains(t as Node)) return;
		position();
	};
	// The trigger's own window's observer, so a popout window watches its own screen.
	const Observer = (win as Window & { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver;
	const visibility = new Observer((entries) => {
		if (entries.some((en) => !en.isIntersecting)) close();
	}, { threshold: 0 });

	let closed = false;
	function close(returnFocus = false): void {
		if (closed) return;
		closed = true;
		cancelHide();
		doc.removeEventListener('pointerdown', onPointerDownOutside, true);
		doc.removeEventListener('keydown', onKeydown, true);
		doc.removeEventListener('focusin', onFocusIn, true);
		doc.removeEventListener('scroll', onReposition, true);
		win.removeEventListener('resize', onReposition);
		visibility.disconnect();
		el.remove();
		trigger.setAttribute('aria-expanded', 'false');
		trigger.removeAttribute('aria-controls');
		trigger.removeClass('is-open');
		if (current?.el === el) current = null;
		if (returnFocus && trigger.isConnected) trigger.focus();
	}

	el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') cancelHide(); });
	el.addEventListener('pointerleave', (e) => {
		if (e.pointerType === 'mouse' && current?.el === el && !current.pinned) scheduleHide();
	});

	current = { trigger, el, pinned, close, cancelHide, scheduleHide };
	trigger.setAttribute('aria-expanded', 'true');
	trigger.setAttribute('aria-controls', id);
	trigger.addClass('is-open');
	position();

	doc.addEventListener('pointerdown', onPointerDownOutside, true);
	doc.addEventListener('keydown', onKeydown, true);
	doc.addEventListener('focusin', onFocusIn, true);
	doc.addEventListener('scroll', onReposition, true);
	win.addEventListener('resize', onReposition);
	visibility.observe(trigger);

	// Opened from the keyboard: move focus into the box so it is read out and its text can be scrolled.
	if (focusBox) body.focus();
}

/**
 * Makes `trigger` (a small "i" button) open an info box. The press never reaches what the
 * "i" sits on: no card drag, card select / fold-out, column drag or rename starts from it.
 */
export function bindInfoTrigger(trigger: HTMLElement, opts: InfoTriggerOptions): void {
	trigger.setAttribute('aria-haspopup', 'dialog');
	trigger.setAttribute('aria-expanded', 'false');
	const win = (): Window => trigger.win;
	let openTimer: number | null = null;
	const cancelOpen = (): void => {
		if (openTimer !== null) { win().clearTimeout(openTimer); openTimer = null; }
	};
	const stop = (e: Event): void => e.stopPropagation();

	// The card / column header below listens for these to drag, long-press or select.
	trigger.addEventListener('pointerdown', stop);
	trigger.addEventListener('mousedown', stop);
	trigger.addEventListener('touchstart', stop, { passive: true });
	trigger.addEventListener('touchend', stop);
	trigger.addEventListener('dblclick', stop);
	// Right-click / Android long-press on the "i" must not open the card or column menu.
	trigger.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
	trigger.addEventListener('keydown', (e) => {
		// Enter / Space press the "i" itself; the grid's own Enter (open the card editor) must not run.
		if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
	});

	trigger.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		cancelOpen();
		if (current?.trigger === trigger) {
			// Opened by hovering: a click keeps it open. Already kept open: a click closes it.
			if (current.pinned) current.close();
			else { current.pinned = true; current.cancelHide(); }
			return;
		}
		openBox(trigger, opts, true, e.detail === 0);
	});

	trigger.addEventListener('pointerenter', (e) => {
		if (e.pointerType !== 'mouse') return;
		if (current?.trigger === trigger) { current.cancelHide(); return; }
		cancelOpen();
		openTimer = win().setTimeout(() => {
			openTimer = null;
			if (trigger.isConnected && current?.trigger !== trigger) openBox(trigger, opts, false, false);
		}, HOVER_OPEN_MS);
	});
	trigger.addEventListener('pointerleave', (e) => {
		if (e.pointerType !== 'mouse') return;
		cancelOpen();
		if (current?.trigger === trigger && !current.pinned) current.scheduleHide();
	});
}
