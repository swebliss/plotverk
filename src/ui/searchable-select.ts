/**
 * A dropdown you can type into, for lists too long to scan.
 *
 * Options may carry a `group`, which renders as a collapsible branch — that is
 * how a category → field tree fits in one control instead of two chained
 * dropdowns. Small catalogs open every branch by default so there's nothing
 * to click through; large ones default collapsed, and a branch's rows are
 * only built in the DOM once it's expanded, so a catalog of thousands stays
 * cheap. Typing a search auto-expands only the branches with a match.
 *
 * The panel is portaled to `document.body` and positioned `fixed` from the
 * trigger's on-screen rect (same pattern as `color-picker-popover.ts`) so it
 * is never clipped by an ancestor's `overflow: hidden` — the staged
 * field-creator card needs that overflow for its settle animation, and the
 * panel used to be cut off by it.
 */

import { setStaticMarkup } from '../utils/dom-html';

export interface SearchableOption {
	value: string;
	label: string;
	/** Category heading this option sits under. */
	group?: string;
	/** Shown under the label in the list, and beneath the closed control. */
	hint?: string;
}

export interface SearchableSelectOptions {
	options: SearchableOption[];
	/** Shown on the closed control before anything is chosen. */
	placeholder?: string;
	/** Placeholder inside the search box. */
	searchPlaceholder?: string;
	value?: string;
	onChange: (value: string, option: SearchableOption) => void;
}

export interface SearchableSelectHandle {
	el: HTMLElement;
	getValue: () => string;
	destroy: () => void;
}

/** Below this many total options, every branch opens by default — nothing to click through. At or above it, branches start collapsed. */
const AUTO_EXPAND_THRESHOLD = 12;

const CHEVRON_SVG =
	'<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>';
const CARET_SVG =
	'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

/** Bumped once per instance so each dropdown's listbox/option ids are unique
 *  document-wide — needed for aria-controls / aria-activedescendant to
 *  resolve correctly when more than one select is mounted at once. */
let _instanceSeq = 0;

export function renderSearchableSelect(
	container: HTMLElement,
	opts: SearchableSelectOptions
): SearchableSelectHandle {
	const wrap = container.createDiv({ cls: 'sg-select' });
	let value = opts.value ?? '';
	let open = false;
	/** Index into the currently rendered option rows, for keyboard use. */
	let active = -1;
	/** Unique id prefix for this instance's listbox and option rows. */
	const instanceId = `sg-select-${++_instanceSeq}`;

	const trigger = wrap.createDiv({ cls: 'sg-select-trigger', attr: { tabindex: '0', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' } });
	const triggerText = trigger.createSpan({ cls: 'sg-select-value' });
	const caret = trigger.createSpan({ cls: 'sg-select-caret' });
	setStaticMarkup(caret, CARET_SVG);

	// Plain DOM, not container.createDiv() — this panel lives outside the
	// normal container tree (appended to <body> below) so it is never
	// clipped by an ancestor's overflow:hidden.
	const panel = document.createElement('div');
	panel.className = 'sg-select-panel';
	const search = document.createElement('input');
	search.className = 'sg-select-search';
	search.type = 'text';
	search.placeholder = opts.searchPlaceholder ?? 'Search…';
	panel.appendChild(search);
	const list = document.createElement('div');
	list.className = 'sg-select-list';
	list.setAttribute('role', 'listbox');
	list.id = `${instanceId}-listbox`;
	panel.appendChild(list);
	trigger.setAttribute('aria-controls', list.id);
	const empty = document.createElement('div');
	empty.className = 'sg-select-empty';
	empty.textContent = 'Nothing matches that.';
	empty.setCssStyles({ display: 'none' });
	panel.appendChild(empty);
	document.body.appendChild(panel);

	// ── Grouping ────────────────────────────────────────────────────────────
	// Buckets in order of first appearance; options with no group render flat.
	const groupOrder: string[] = [];
	const buckets = new Map<string, SearchableOption[]>();
	const ungrouped: SearchableOption[] = [];
	for (const option of opts.options) {
		if (option.group) {
			if (!buckets.has(option.group)) {
				buckets.set(option.group, []);
				groupOrder.push(option.group);
			}
			buckets.get(option.group)!.push(option);
		} else {
			ungrouped.push(option);
		}
	}
	const autoExpand = opts.options.length < AUTO_EXPAND_THRESHOLD;
	const expandedGroups = new Set<string>(autoExpand ? groupOrder : []);

	/** Rows actually in the DOM right now, in visual order — for keyboard nav and selection state. */
	let renderedRows: Array<{ el: HTMLElement; option: SearchableOption }> = [];

	const matches = (option: SearchableOption, q: string): boolean => {
		const haystack = `${option.group ?? ''} ${option.label} ${option.hint ?? ''}`.toLowerCase();
		return haystack.includes(q);
	};

	const makeRow = (option: SearchableOption, index: number): HTMLElement => {
		const row = document.createElement('div');
		row.className = 'sg-select-option';
		row.setAttribute('role', 'option');
		row.id = `${instanceId}-option-${index}`;
		const isSelected = option.value === value;
		row.classList.toggle('is-selected', isSelected);
		row.setAttribute('aria-selected', String(isSelected));
		const label = document.createElement('span');
		label.className = 'sg-select-option-label';
		label.textContent = option.label;
		row.appendChild(label);
		if (option.hint) {
			const hint = document.createElement('span');
			hint.className = 'sg-select-option-hint';
			hint.textContent = option.hint;
			row.appendChild(hint);
		}
		row.addEventListener('click', () => choose(option));
		return row;
	};

	const makeGroupHeader = (name: string, count: number, expanded: boolean, onToggle: () => void): HTMLElement => {
		const header = document.createElement('div');
		header.className = 'sg-select-group-header';
		header.setAttribute('role', 'button');
		header.setAttribute('tabindex', '0');
		header.setAttribute('aria-expanded', String(expanded));
		header.classList.toggle('is-expanded', expanded);
		const chevron = document.createElement('span');
		chevron.className = 'sg-select-group-chevron';
		setStaticMarkup(chevron, CHEVRON_SVG);
		header.appendChild(chevron);
		const title = document.createElement('span');
		title.className = 'sg-select-group-title';
		title.textContent = name;
		header.appendChild(title);
		const badge = document.createElement('span');
		badge.className = 'sg-select-group-count';
		badge.textContent = String(count);
		header.appendChild(badge);
		const activate = () => onToggle();
		// stopPropagation matters here: onToggle() rebuilds the list synchronously,
		// which detaches this very header from the DOM. If the click were left to
		// bubble, the document-level outside-click listener below would see a
		// detached target — `panel.contains(target)` is false for a detached node
		// even though the panel is still open — and close the whole dropdown.
		header.addEventListener('click', (e) => { e.stopPropagation(); activate(); });
		header.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
		});
		return header;
	};

	/** Rebuilds the list from scratch for the given query. Collapsed branches don't get their rows built at all. */
	const renderList = (query: string): void => {
		list.replaceChildren();
		renderedRows = [];
		const q = query.trim().toLowerCase();
		const searching = q.length > 0;

		for (const option of ungrouped) {
			if (searching && !matches(option, q)) continue;
			const row = makeRow(option, renderedRows.length);
			list.appendChild(row);
			renderedRows.push({ el: row, option });
		}

		for (const name of groupOrder) {
			const groupOptions = buckets.get(name)!;
			const shown = searching ? groupOptions.filter((o) => matches(o, q)) : groupOptions;
			if (searching && shown.length === 0) continue;
			// A search always shows what matched, regardless of collapsed state.
			const expanded = searching || expandedGroups.has(name);
			const header = makeGroupHeader(name, shown.length, expanded, () => {
				if (expandedGroups.has(name)) expandedGroups.delete(name);
				else expandedGroups.add(name);
				renderList(search.value);
			});
			list.appendChild(header);
			if (expanded) {
				const body = document.createElement('div');
				body.className = 'sg-select-group-body';
				for (const option of shown) {
					const row = makeRow(option, renderedRows.length);
					body.appendChild(row);
					renderedRows.push({ el: row, option });
				}
				list.appendChild(body);
			}
		}

		const nothingToShow = searching && renderedRows.length === 0;
		empty.style.display = nothingToShow ? '' : 'none';
		active = renderedRows.length > 0 ? 0 : -1;
		paintActive();
	};

	const paintTrigger = () => {
		const current = opts.options.find((o) => o.value === value);
		triggerText.setText(current ? current.label : opts.placeholder ?? 'Choose…');
		trigger.toggleClass('is-empty', !current);
	};

	const paintActive = () => {
		renderedRows.forEach(({ el }) => el.classList.remove('is-active'));
		if (active >= 0 && active < renderedRows.length) {
			const activeRow = renderedRows[active].el;
			activeRow.classList.add('is-active');
			activeRow.scrollIntoView({ block: 'nearest' });
			trigger.setAttribute('aria-activedescendant', activeRow.id);
		} else {
			trigger.removeAttribute('aria-activedescendant');
		}
	};

	function choose(option: SearchableOption): void {
		value = option.value;
		paintTrigger();
		setOpen(false);
		opts.onChange(option.value, option);
	}

	/** Positions the portaled panel from the trigger's live rect, flipping above it and clamping horizontally when there isn't room. */
	function positionPanel(): void {
		const rect = trigger.getBoundingClientRect();
		panel.style.width = `${rect.width}px`;
		panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
		const panelHeight = panel.offsetHeight;
		const spaceBelow = window.innerHeight - rect.bottom;
		const openUp = spaceBelow < panelHeight + 8 && rect.top > spaceBelow;
		panel.classList.toggle('sg-select-panel--up', openUp);
		if (openUp) {
			panel.setCssStyles({ top: '' });
			panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
		} else {
			panel.setCssStyles({ bottom: '' });
			panel.style.top = `${rect.bottom + 6}px`;
		}
	}

	const reposition = () => { if (open) positionPanel(); };

	function setOpen(next: boolean): void {
		open = next;
		wrap.toggleClass('is-open', open);
		trigger.setAttr('aria-expanded', String(open));
		panel.classList.toggle('is-open', open);
		if (open) {
			search.value = '';
			renderList('');
			positionPanel();
			window.setTimeout(() => search.focus(), 20);
		}
	}

	trigger.addEventListener('click', () => setOpen(!open));
	trigger.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
			e.preventDefault();
			setOpen(true);
		}
	});
	search.addEventListener('input', () => { renderList(search.value); positionPanel(); });
	search.addEventListener('keydown', (e) => {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = Math.min(active + 1, renderedRows.length - 1);
			paintActive();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(active - 1, 0);
			paintActive();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (renderedRows[active]) choose(renderedRows[active].option);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			setOpen(false);
			trigger.focus();
		}
	});

	// Clicking anywhere else closes it. The panel lives outside `wrap` (it's
	// portaled to <body>), so both are checked.
	const onDocClick = (e: MouseEvent) => {
		const target = e.target as Node;
		if (!wrap.contains(target) && !panel.contains(target)) setOpen(false);
	};
	document.addEventListener('click', onDocClick);
	// The portaled panel doesn't scroll with an ancestor (e.g. a modal body),
	// so it has to be repositioned live. Capture phase catches scrolling on
	// any nested container, not just the window.
	window.addEventListener('scroll', reposition, true);
	window.addEventListener('resize', reposition);

	paintTrigger();

	return {
		el: wrap,
		getValue: () => value,
		destroy: () => {
			document.removeEventListener('click', onDocClick);
			window.removeEventListener('scroll', reposition, true);
			window.removeEventListener('resize', reposition);
			panel.remove();
		},
	};
}
