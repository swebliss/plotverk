import { computeWindow } from '../utils/virtual-window';

/**
 * Drives windowed virtualization for a single long list.
 *
 * DOM-only — no Obsidian imports. The caller owns the markup: a scroll
 * container (`scrollEl`, `overflow-y: auto`) and a content element
 * (`contentEl`) that holds the rendered slice. The scroller measures the
 * scroll position on every frame, asks {@link computeWindow} which slice is
 * near the viewport, stands in for the rest with top/bottom padding on
 * `contentEl`, and re-renders only when the visible index range changes.
 *
 * Assumes a FIXED row height (`itemH`) — the caller is responsible for making
 * every row that height (e.g. a fixed-height CSS rule on virtualized rows).
 */
export interface VirtualScrollerOptions {
	/** The scrolling element (has `overflow-y: auto`). */
	scrollEl: HTMLElement;
	/** Child of `scrollEl` that receives the rendered slice + spacer padding. */
	contentEl: HTMLElement;
	/** Total number of items in the (already filtered) list. */
	count: number;
	/** Fixed height of one visual row, in px (must match the rendered rows). */
	itemH: number;
	/** Items per visual row for grid layouts. Default 1. */
	columns?: number;
	/** Extra rows rendered above/below the viewport. Default 3. */
	overscan?: number;
	/** Render items [start..end] (inclusive) into `contentEl`. */
	renderSlice: (start: number, end: number) => void;
	/** Return true once a newer render has superseded this scroller. */
	isStale?: () => boolean;
}

export class VirtualScroller {
	private opts: VirtualScrollerOptions;
	private rafId = 0;
	private offsetTop = 0;
	private lastStart = -1;
	private lastEnd = -2;
	private readonly onScroll = () => this.schedule();

	constructor(opts: VirtualScrollerOptions) {
		this.opts = opts;
		this.measureOffset();
		this.opts.scrollEl.addEventListener('scroll', this.onScroll, { passive: true });
		this.update();
	}

	/** Detach listeners and cancel any pending frame. Call before re-rendering. */
	destroy(): void {
		this.opts.scrollEl.removeEventListener('scroll', this.onScroll);
		if (this.rafId) {
			window.cancelAnimationFrame(this.rafId);
			this.rafId = 0;
		}
	}

	/** Distance from the top of the scroll content to the top of `contentEl`. */
	private measureOffset(): void {
		const { scrollEl, contentEl } = this.opts;
		this.offsetTop =
			contentEl.getBoundingClientRect().top -
			scrollEl.getBoundingClientRect().top +
			scrollEl.scrollTop;
	}

	private schedule(): void {
		if (this.rafId) return;
		this.rafId = window.requestAnimationFrame(() => {
			this.rafId = 0;
			this.update();
		});
	}

	private update(): void {
		if (this.opts.isStale?.()) {
			this.destroy();
			return;
		}
		const { scrollEl, contentEl, itemH, count, columns, overscan } = this.opts;
		// Re-measure each frame so a wrapping section header (resize) can't drift.
		this.measureOffset();

		const w = computeWindow({
			scrollTop: scrollEl.scrollTop - this.offsetTop,
			viewportH: scrollEl.clientHeight,
			itemH,
			count,
			columns,
			overscan,
		});

		contentEl.style.paddingTop = `${w.padTop}px`;
		contentEl.style.paddingBottom = `${w.padBottom}px`;

		if (w.startIndex === this.lastStart && w.endIndex === this.lastEnd) return;
		this.lastStart = w.startIndex;
		this.lastEnd = w.endIndex;

		contentEl.replaceChildren();
		if (w.endIndex >= w.startIndex) {
			this.opts.renderSlice(w.startIndex, w.endIndex);
		}
	}
}
