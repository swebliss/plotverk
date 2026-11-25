import { t } from '../i18n';
import { setPhosphorIcon } from '../utils/icons';
import { PickRow, PickableSetup } from './picker';
import { STAGE_ICON, stageWord } from './stage';

/**
 * The small Plant / Remind / Pay off windows (design v19). Rules (Emma,
 * 2026-11-20 — locked):
 * - NOT an Obsidian Modal: a small window under the marked words, inside the
 *   pane being written in. Nothing is dimmed or locked; other tabs, splits and
 *   windows stay usable.
 * - It closes only on Enter (which acts), Esc or ×. Clicking elsewhere does
 *   not close it.
 * - Esc and × KEEP the draft: choosing the same action on the same words
 *   again brings back what was typed. Only Enter plants.
 */

export interface WindowPlace {
	/** A positioned element the window lives in (the pane). */
	host: HTMLElement;
	/** Where the marked words (or card) are on screen right now; null = unknown. */
	rect: () => DOMRect | null;
	/** Elements whose scrolling moves the marked words. */
	scrollers?: HTMLElement[];
	/** Put the cursor back in the text when the window closes. */
	refocus?: () => void;
	/** Is the pane still showing what the window was opened on? */
	alive?: () => boolean;
	/** An extra class for the window (opened from the card editor: it must sit over the phone's bottom sheet). */
	cls?: string;
}

const GAP = 6;
const EDGE = 8;

abstract class SetupWindow {
	protected el: HTMLElement;
	private cleanups: Array<() => void> = [];
	private closed = false;
	private placed = false;

	constructor(protected place: WindowPlace, ariaLabel: string, private onClosed: () => void) {
		this.el = place.host.createEl('form', {
			cls: 'sg-setup-win',
			attr: { role: 'dialog', 'aria-label': ariaLabel, autocomplete: 'off' },
		});
		if (place.cls) this.el.addClass(place.cls);
		this.el.addEventListener('submit', (e) => {
			e.preventDefault();
			this.submit();
		});
		this.el.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.close(true);
				return;
			}
			this.onKey(e);
			// Keys typed here are for the window, never for Obsidian's hotkeys or the editor.
			e.stopPropagation();
		});
		// A press inside the window must not move the editor's selection or close anything.
		this.el.addEventListener('mousedown', (e) => e.stopPropagation());
		this.el.addEventListener('contextmenu', (e) => e.stopPropagation());

		const reposition = () => this.reposition();
		for (const scroller of place.scrollers ?? []) {
			scroller.addEventListener('scroll', reposition, { passive: true });
			this.cleanups.push(() => scroller.removeEventListener('scroll', reposition));
		}
		const win = place.host.win;
		win.addEventListener('resize', reposition);
		this.cleanups.push(() => win.removeEventListener('resize', reposition));
	}

	protected abstract submit(): void;
	/** Save what was typed (Esc / ×), or drop it (after Enter). */
	protected abstract keepDraft(keep: boolean): void;
	protected onKey(_e: KeyboardEvent): void {}

	protected closeButton(parent: HTMLElement): void {
		const x = parent.createEl('button', { cls: 'sg-setup-win-x', attr: { type: 'button', 'aria-label': t('setups.win.close'), title: t('setups.win.close') } });
		setPhosphorIcon(x, 'x', '×');
		x.addEventListener('click', () => this.close(true));
	}

	/** Place the window under the marked words; above them when there is no room below. */
	reposition(): void {
		if (this.closed) return;
		const host = this.place.host.getBoundingClientRect();
		const anchor = this.place.rect();
		const width = Math.min(this.el.offsetWidth, host.width - EDGE * 2);
		const height = this.el.offsetHeight;
		// The words scrolled out of sight: stay where the window was.
		if (!anchor && this.placed) return;
		this.placed = true;
		let left = EDGE;
		let top = EDGE;
		if (anchor) {
			left = anchor.left - host.left;
			top = anchor.bottom - host.top + GAP;
			if (top + height > host.height - EDGE) {
				const above = anchor.top - host.top - height - GAP;
				top = above >= EDGE ? above : Math.max(EDGE, host.height - height - EDGE);
			}
		}
		left = Math.max(EDGE, Math.min(left, host.width - width - EDGE));
		top = Math.max(EDGE, top);
		this.el.style.left = `${Math.round(left)}px`;
		this.el.style.top = `${Math.round(top)}px`;
	}

	close(keep: boolean): void {
		if (this.closed) return;
		this.closed = true;
		this.keepDraft(keep);
		for (const fn of this.cleanups) fn();
		this.el.remove();
		this.onClosed();
		this.place.refocus?.();
	}

	get isOpen(): boolean {
		return !this.closed;
	}
}

// ─── Plant ──────────────────────────────────────────────────────────────────

export interface LinkChoice {
	id: string;
	name: string;
	/** The kind's word ("Character") shown faintly in the search list. */
	kindWord: string;
}

export interface PlantDraft {
	name: string;
	description: string;
	descriptionOpen: boolean;
	linkOpen: boolean;
	linked: LinkChoice[];
	later: boolean;
	/** True once the writer has typed in the name (it is then no longer pre-selected). */
	touched: boolean;
}

export interface PlantWindowOptions {
	place: WindowPlace;
	/** A kept draft, or the fresh start (name = the selected words). */
	draft: PlantDraft;
	/** Entries the marked words mention — offered as one-tap "Add Kael", never added by themselves. */
	suggested: LinkChoice[];
	/** Type-to-find over every Codex entry in the book. */
	search: (query: string) => LinkChoice[];
	onPlant: (draft: PlantDraft) => void;
	onClose: (kept: PlantDraft | null) => void;
}

export class PlantWindow extends SetupWindow {
	private draft: PlantDraft;
	private nameInput!: HTMLInputElement;
	private kept: PlantDraft | null = null;

	constructor(private opts: PlantWindowOptions) {
		super(opts.place, t('setups.menu.plant'), () => opts.onClose(this.kept));
		this.draft = { ...opts.draft, linked: [...opts.draft.linked] };
		this.el.addClass('sg-setup-win--plant');
		this.render();
		this.reposition();
		this.nameInput.focus();
		// The name starts selected, so the first key replaces it.
		if (!this.draft.touched) {
			this.nameInput.select();
			// A long sentence shows from its start, not its end.
			this.nameInput.scrollLeft = 0;
		}
	}

	private render(): void {
		const el = this.el;
		el.empty();

		const top = el.createDiv({ cls: 'sg-setup-win-top' });
		setPhosphorIcon(top.createSpan({ cls: 'sg-setup-win-icon' }), 'plant', '•');
		this.nameInput = top.createEl('input', {
			cls: 'sg-setup-win-name',
			attr: { type: 'text', placeholder: t('setups.plant.namePlaceholder'), 'aria-label': t('setups.plant.nameAria'), enterkeyhint: 'done' },
		});
		this.nameInput.value = this.draft.name;
		this.nameInput.addEventListener('input', () => {
			this.draft.name = this.nameInput.value;
			this.draft.touched = true;
		});
		this.closeButton(top);

		if (this.draft.descriptionOpen) {
			const row = el.createDiv({ cls: 'sg-setup-win-row' });
			setPhosphorIcon(row.createSpan({ cls: 'sg-setup-win-row-icon' }), 'arrow-right', '→');
			const input = row.createEl('input', {
				cls: 'sg-setup-win-input',
				attr: { type: 'text', placeholder: t('setups.plant.descriptionPlaceholder'), 'aria-label': t('setups.sheet.addDescription') },
			});
			input.value = this.draft.description;
			input.addEventListener('input', () => { this.draft.description = input.value; });
			input.dataset.focus = 'description';
		}

		if (this.draft.linkOpen) this.renderLinkRow(el);

		const foot = el.createDiv({ cls: 'sg-setup-win-foot' });
		if (!this.draft.descriptionOpen) {
			this.option(foot, 'plus', t('setups.sheet.addDescription'), () => {
				this.draft.descriptionOpen = true;
				this.rerender('description');
			});
		}
		if (!this.draft.linkOpen) {
			this.option(foot, 'plus', t('setups.sheet.linkToCodex'), () => {
				this.draft.linkOpen = true;
				this.rerender('link');
			});
		}
		const book = this.option(foot, 'books', t(this.draft.later ? 'setups.sheet.laterBook' : 'setups.sheet.thisBook'), () => {
			this.draft.later = !this.draft.later;
			this.rerender('book');
		});
		book.setAttr('aria-pressed', String(this.draft.later));
		book.toggleClass('is-on', this.draft.later);
		book.dataset.focus = 'book';

		const go = foot.createEl('button', { cls: 'sg-setup-win-go', attr: { type: 'submit' } });
		go.createSpan({ text: t('setups.plant.go') });
		go.createSpan({ cls: 'sg-setup-win-key', text: t('setups.key.enter') });
	}

	private renderLinkRow(el: HTMLElement): void {
		const row = el.createDiv({ cls: 'sg-setup-win-row sg-setup-win-row--link' });
		setPhosphorIcon(row.createSpan({ cls: 'sg-setup-win-row-icon' }), 'link', '•');
		const body = row.createDiv({ cls: 'sg-setup-win-linkbody' });
		// On screen (and for Tab): the search first, then the chips beside it, then the hits below.
		const input = body.createEl('input', {
			cls: 'sg-setup-win-input',
			attr: { type: 'text', placeholder: t('setups.plant.linkPlaceholder'), 'aria-label': t('setups.sheet.linkToCodex') },
		});
		input.dataset.focus = 'link';
		const chips = body.createDiv({ cls: 'sg-setup-win-chips' });
		const isLinked = (id: string) => this.draft.linked.some((l) => l.id === id);
		const toggle = (choice: LinkChoice) => {
			this.draft.linked = isLinked(choice.id)
				? this.draft.linked.filter((l) => l.id !== choice.id)
				: [...this.draft.linked, choice];
			this.rerender('link');
		};
		// Already added: a ticked chip (tap to take it away again).
		for (const choice of this.draft.linked) {
			const chip = this.option(chips, 'check-square', choice.name, () => toggle(choice));
			chip.addClass('is-on');
			chip.setAttr('aria-pressed', 'true');
		}
		// Mentioned in the sentence: offered, never added by itself.
		for (const choice of this.opts.suggested) {
			if (isLinked(choice.id)) continue;
			const chip = this.option(chips, 'plus', t('setups.plant.addEntity', { name: choice.name }), () => toggle(choice));
			chip.setAttr('title', t('setups.plant.mentionedHint', { name: choice.name }));
			chip.setAttr('aria-pressed', 'false');
		}
		const results = body.createDiv({ cls: 'sg-setup-win-results' });
		let hits: LinkChoice[] = [];
		let at = 0;
		const draw = () => {
			results.empty();
			const q = input.value.trim();
			hits = q ? this.opts.search(q).filter((h) => !isLinked(h.id)).slice(0, 6) : [];
			at = Math.min(at, Math.max(0, hits.length - 1));
			if (q && hits.length === 0) results.createDiv({ cls: 'sg-setup-win-empty', text: t('setups.plant.noMatch') });
			hits.forEach((hit, i) => {
				const r = results.createEl('button', { cls: 'sg-setup-win-result', attr: { type: 'button', tabindex: '-1' } });
				r.toggleClass('is-on', i === at);
				r.createSpan({ cls: 'sg-setup-win-result-name', text: hit.name });
				r.createSpan({ cls: 'sg-setup-win-result-kind', text: hit.kindWord });
				r.addEventListener('pointermove', () => {
					if (at === i) return;
					at = i;
					Array.from(results.children).forEach((c, j) => c.toggleClass('is-on', j === at));
				});
				r.addEventListener('click', () => toggle(hit));
			});
			this.reposition();
		};
		input.addEventListener('input', () => { at = 0; draw(); });
		input.addEventListener('keydown', (e) => {
			if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) {
				e.preventDefault();
				at = (at + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
				draw();
			} else if (e.key === 'Enter' && hits.length) {
				// Enter in the search adds the marked entry; a second Enter plants.
				e.preventDefault();
				toggle(hits[at]);
			}
		});
	}

	private option(parent: HTMLElement, icon: string, text: string, onClick: () => void): HTMLElement {
		const btn = parent.createEl('button', { cls: 'sg-setup-win-opt', attr: { type: 'button' } });
		setPhosphorIcon(btn.createSpan({ cls: 'sg-setup-win-opt-icon' }), icon, '+');
		btn.createSpan({ text });
		btn.addEventListener('click', onClick);
		return btn;
	}

	private rerender(focus: 'description' | 'link' | 'book'): void {
		this.render();
		this.reposition();
		const target = this.el.querySelector<HTMLElement>(`[data-focus="${focus}"]`);
		(target ?? this.nameInput).focus();
	}

	protected submit(): void {
		const name = this.draft.name.trim();
		if (!name) {
			this.nameInput.focus();
			return;
		}
		const done = { ...this.draft, name, description: this.draft.description.trim() };
		this.close(false);
		this.opts.onPlant(done);
	}

	protected keepDraft(keep: boolean): void {
		this.kept = keep ? { ...this.draft } : null;
	}
}

// ─── Remind / Pay off ───────────────────────────────────────────────────────

export interface PickWindowOptions<T extends PickableSetup> {
	place: WindowPlace;
	mode: 'reminded' | 'paid-off';
	/** What was typed before Esc / ×, if anything. */
	query: string;
	/** True when the book has no open setup at all. */
	noneOpen: boolean;
	rows: (query: string) => PickRow<T>[];
	onPick: (setup: T) => void;
	onClose: (keptQuery: string | null) => void;
}

export class PickWindow<T extends PickableSetup> extends SetupWindow {
	private input!: HTMLInputElement;
	private list!: HTMLElement;
	private hits: PickRow<T>[] = [];
	private at = 0;
	private keptQuery: string | null = null;

	constructor(private opts: PickWindowOptions<T>) {
		super(opts.place, t(opts.mode === 'reminded' ? 'setups.menu.remind' : 'setups.menu.payOff'), () => opts.onClose(this.keptQuery));
		this.el.addClass('sg-setup-win--pick');
		const remind = opts.mode === 'reminded';

		const top = this.el.createDiv({ cls: 'sg-setup-win-top' });
		setPhosphorIcon(top.createSpan({ cls: 'sg-setup-win-icon' }), STAGE_ICON[opts.mode], '•');
		this.input = top.createEl('input', {
			cls: 'sg-setup-win-name',
			attr: {
				type: 'text',
				placeholder: t(remind ? 'setups.pick.remindPlaceholder' : 'setups.pick.payPlaceholder'),
				'aria-label': t(remind ? 'setups.pick.remindPlaceholder' : 'setups.pick.payPlaceholder'),
				enterkeyhint: 'done',
			},
		});
		this.input.value = opts.query;
		this.input.addEventListener('input', () => { this.at = 0; this.draw(); });
		this.closeButton(top);

		this.list = this.el.createDiv({ cls: 'sg-setup-win-list', attr: { role: 'listbox', 'aria-label': t('setups.pick.listAria') } });

		const foot = this.el.createDiv({ cls: 'sg-setup-win-foot' });
		foot.createSpan({ cls: 'sg-setup-win-keys', text: t('setups.pick.keys') });
		const go = foot.createEl('button', { cls: 'sg-setup-win-go', attr: { type: 'submit' } });
		go.createSpan({ text: t(remind ? 'setups.pick.remindGo' : 'setups.pick.payGo') });
		go.createSpan({ cls: 'sg-setup-win-key', text: t('setups.key.enter') });

		this.draw();
		this.input.focus();
	}

	private draw(): void {
		this.hits = this.opts.rows(this.input.value);
		this.at = Math.min(this.at, Math.max(0, this.hits.length - 1));
		this.list.empty();
		if (this.hits.length === 0) {
			this.list.createDiv({
				cls: 'sg-setup-win-empty',
				text: t(this.opts.noneOpen ? 'setups.pick.none' : 'setups.pick.empty'),
			});
		}
		this.hits.forEach((row, i) => {
			const r = this.list.createEl('button', {
				cls: 'sg-setup-win-pickrow',
				attr: { type: 'button', role: 'option', tabindex: '-1', 'aria-selected': String(i === this.at) },
			});
			r.toggleClass('is-on', i === this.at);
			const ic = r.createSpan({ cls: 'sg-setup-win-pickrow-icon', attr: { title: stageWord(row.setup.state) } });
			setPhosphorIcon(ic, STAGE_ICON[row.setup.state], '•');
			const main = r.createSpan({ cls: 'sg-setup-win-pickrow-main' });
			main.createSpan({ cls: 'sg-setup-win-pickrow-name', text: row.setup.name });
			const sub = main.createSpan({ cls: 'sg-setup-win-pickrow-sub' });
			if (row.inSceneName) sub.createSpan({ cls: 'sg-setup-win-pickrow-why', text: t('setups.pick.inScene', { name: row.inSceneName }) });
			const rest = row.setup.where || row.setup.description || (row.inSceneName ? '' : stageWord(row.setup.state));
			if (row.inSceneName && rest) sub.appendText(' · ');
			if (rest) sub.appendText(rest);
			r.addEventListener('pointermove', () => {
				if (this.at !== i) {
					this.at = i;
					this.mark();
				}
			});
			r.addEventListener('click', () => {
				this.at = i;
				this.submit();
			});
		});
		this.reposition();
	}

	private mark(): void {
		Array.from(this.list.children).forEach((child, i) => {
			child.toggleClass('is-on', i === this.at);
			child.setAttr('aria-selected', String(i === this.at));
		});
	}

	protected onKey(e: KeyboardEvent): void {
		if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && this.hits.length) {
			e.preventDefault();
			this.at = (this.at + (e.key === 'ArrowDown' ? 1 : -1) + this.hits.length) % this.hits.length;
			this.mark();
			this.list.children[this.at]?.scrollIntoView({ block: 'nearest' });
		}
	}

	protected submit(): void {
		const hit = this.hits[this.at];
		if (!hit) {
			this.input.focus();
			return;
		}
		this.close(false);
		this.opts.onPick(hit.setup);
	}

	protected keepDraft(keep: boolean): void {
		this.keptQuery = keep ? this.input.value : null;
	}
}
