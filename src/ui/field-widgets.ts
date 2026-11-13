import { App, Component, Menu, MarkdownRenderer, Notice, TFile, setTooltip } from 'obsidian';
import { CharacterField } from '../grid-data';
import {
	FieldConfig,
	formatFieldValue,
	parseListItems,
	parseTableRows,
	stringifyTableRows,
} from '../entities/field-types';
import {
	DEFAULT_STORYDATE_LIMITS,
	StoryDateDraft,
	StoryDateEdit,
	applyStoryDateEdit,
	draftFromValue,
	numberFromInput,
} from '../entities/story-date-edit';
import { ImagePickerModal } from '../modals/image-picker-modal';
import { EntityPickerModal } from '../modals/entity-picker-modal';
import { EntityKind } from '../entities/entity-kinds';
import { saveImageForSheet } from '../entities/sheet-images';

/**
 * Per-type editor/read widgets for Codex fields — the single place that knows
 * how to render each of the 10 field types. Shared by the sheet editor
 * (EntityModal, mode 'edit'), the codex detail page (mode 'read'), and later
 * the Writers Panel codex tab. Keep every branch here, not duplicated in
 * call sites, so a new field type only needs to be taught once.
 */

export interface FieldWidgetCallbacks {
	app: App;
	onChange: (value: string) => void;
	/**
	 * Some widgets edit their own definition, not just their value — a table's
	 * columns are part of its config. Callers that allow that pass this; read
	 * mode and read-only callers can omit it.
	 */
	onConfigChange?: (config: FieldConfig) => void;
	/** Enables the entity-link "+ Pick…" affordance on tags fields. Omit/null to disable. */
	projectRoot?: string | null;
	/**
	 * Fired when an entity-link tags field gains a link, so the caller can write
	 * the matching relation onto the other sheet. Without this, a "Father" field
	 * would only ever know the relationship from one side.
	 */
	onEntityLinked?: (file: TFile, fieldLabel: string) => void;
	/** Placeholder / hover text. Falls back to a generic prompt per type when omitted. */
	prompt?: string;
	/**
	 * When both are supplied, a read-mode text/tags value containing `[[` renders
	 * through MarkdownRenderer instead of as plain text, so wikilinks become real,
	 * clickable links. Omit either to keep the plain-text fallback (e.g. callers
	 * with no owning Component). Pass the hosting ItemView, never a throwaway
	 * Component — same rule as entity-preview.ts's own MarkdownRenderer calls.
	 */
	component?: Component;
	sourcePath?: string;
	/**
	 * Saves an uploaded or dropped picture and returns its path. The sheet
	 * editor passes its own, so the picture lands in that sheet's folder; without
	 * one, Obsidian's attachment setting decides.
	 */
	saveImage?: (file: File) => Promise<string>;
}

export interface FieldWidgetResult {
	el: HTMLElement;
	/** Exposed only for type 'textarea' so callers (EntityModal's relationship quick-add) can drive it directly. */
	textareaEl?: HTMLTextAreaElement;
}

const RELATION_KINDS: EntityKind[] = ['character', 'location', 'faction', 'system', 'item', 'research'];

function assertNever(x: never): never {
	throw new Error(`Unhandled field type: ${String(x)}`);
}

/**
 * Appends a small "ⓘ" help affordance to a label: hover shows Obsidian's
 * native tooltip on desktop; tap shows a Notice on mobile. Mirrors the
 * pattern in grid-view.ts's renderFieldHelp, shared here for the sheet
 * editor and the template builder — always shown (no plugin-settings gate;
 * EntityModal has no plugin reference, and these surfaces are spacious).
 */
export function renderHoverHelp(container: HTMLElement, help: string): void {
	if (!help) return;
	const info = container.createSpan({ cls: 'sg-field-help-icon', text: 'ⓘ' });
	setTooltip(info, help, { placement: 'top', delay: 80, classes: ['sg-tooltip'] });
	info.setAttribute('aria-label', help);
	info.addEventListener('mousedown', (e) => e.stopPropagation());
	info.addEventListener('click', (e) => {
		e.stopPropagation();
		new Notice(help, 5000);
	});
}

export function renderFieldWidget(
	container: HTMLElement,
	field: CharacterField,
	mode: 'edit' | 'read',
	callbacks: FieldWidgetCallbacks
): FieldWidgetResult {
	switch (field.type) {
		case 'text':
			return renderTextWidget(container, field, mode, callbacks);
		case 'textarea':
			return renderTextareaWidget(container, field, mode, callbacks);
		case 'tags':
			return renderTagsWidget(container, field, mode, callbacks);
		case 'image':
			return renderImageWidget(container, field, mode, callbacks);
		case 'number':
			return renderNumberWidget(container, field, mode, callbacks);
		case 'slider':
			return renderSliderWidget(container, field, mode, callbacks);
		case 'select':
			return renderSelectWidget(container, field, mode, callbacks);
		case 'checkbox':
			return renderCheckboxWidget(container, field, mode, callbacks);
		case 'date':
			return renderDateWidget(container, field, mode, callbacks);
		case 'matrix':
			return renderMatrixWidget(container, field, mode, callbacks);
		case 'list':
			return renderListWidget(container, field, mode, callbacks);
		case 'table':
			return renderTableWidget(container, field, mode, callbacks);
		case 'color':
			return renderColorWidget(container, field, mode, callbacks);
		case 'storydate':
			return renderStoryDateWidget(container, field, mode, callbacks);
		default:
			return assertNever(field.type);
	}
}

/**
 * Read-mode value: renders through MarkdownRenderer (so `[[wikilinks]]` become
 * real, clickable links) when the value has one AND the caller supplied a
 * Component + sourcePath; otherwise plain text, same as before this existed.
 */
function renderReadValue(el: HTMLElement, value: string, callbacks: FieldWidgetCallbacks): void {
	if (value.includes('[[') && callbacks.component && callbacks.sourcePath) {
		void MarkdownRenderer.render(callbacks.app, value, el, callbacks.sourcePath, callbacks.component);
	} else {
		el.setText(value);
	}
}

// ─── text ────────────────────────────────────────────────────────────────────

function renderTextWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-fw-read-text' });
		renderReadValue(el, field.value, callbacks);
		return { el };
	}
	const input = container.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
	input.placeholder = callbacks.prompt || 'Write here…';
	input.value = field.value;
	input.setAttr('aria-label', field.label);
	input.addEventListener('input', () => callbacks.onChange(input.value));
	return { el: input };
}

// ─── textarea ────────────────────────────────────────────────────────────────

function renderTextareaWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-fw-read-prose', text: field.value });
		return { el };
	}
	const ta = container.createEl('textarea', { cls: 'sg-sheet-field-area' });
	ta.placeholder = callbacks.prompt || 'Write here…';
	ta.value = field.value;
	ta.setAttr('aria-label', field.label);
	const grow = () => {
		// Drop the inline height (back to the stylesheet's auto) so scrollHeight measures the text.
		ta.setCssStyles({ height: '' });
		ta.style.height = `${Math.min(ta.scrollHeight + 2, 360)}px`;
	};
	ta.addEventListener('input', () => { callbacks.onChange(ta.value); grow(); });
	window.setTimeout(grow, 0);
	return { el: ta, textareaEl: ta };
}

// ─── tags ────────────────────────────────────────────────────────────────────

function renderTagsWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	const items = () => field.value.split(',').map((t) => t.trim()).filter(Boolean);

	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-chip-container sg-fw-read' });
		for (const t of items()) renderReadValue(el.createDiv({ cls: 'sg-chip' }), t, callbacks);
		return { el };
	}

	const config: FieldConfig = field.config ?? {};
	const el = container.createDiv({ cls: 'sg-chip-container' });

	const renderChips = () => {
		el.empty();
		items().forEach((tag, i) => {
			const chip = el.createDiv({ cls: 'sg-chip' });
			chip.createSpan({ text: tag });
			const x = chip.createEl('button', { cls: 'sg-chip-remove', text: '×' });
			x.addEventListener('mousedown', (e) => {
				e.preventDefault();
				const next = items().filter((_, idx) => idx !== i);
				callbacks.onChange(next.join(', '));
				renderChips();
			});
		});

		const input = el.createEl('input', { cls: 'sg-chip-input', type: 'text' });
		input.placeholder = config.entityLink ? 'Type a name, press Enter…' : 'Add tag, press Enter…';
		input.setAttr('aria-label', field.label);
		const commit = () => {
			const raw = input.value.trim().replace(/,$/, '');
			if (!raw) return;
			callbacks.onChange([...items(), raw].join(', '));
			input.value = '';
			renderChips();
		};
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
		});
		input.addEventListener('blur', () => { if (input.value.trim()) commit(); });

		if (config.entityLink && callbacks.projectRoot) {
			const pickBtn = el.createEl('button', { cls: 'sg-sheet-btn sg-sheet-btn--ghost sg-sheet-btn--small', text: '+ Pick…' });
			pickBtn.addEventListener('click', (e) => {
				e.preventDefault();
				const kinds = config.linkKinds && config.linkKinds.length > 0
					? (config.linkKinds as EntityKind[])
					: RELATION_KINDS;
				new EntityPickerModal(callbacks.app, callbacks.projectRoot!, kinds, (file: TFile) => {
					callbacks.onChange([...items(), file.basename].join(', '));
					renderChips();
					callbacks.onEntityLinked?.(file, field.label);
				}).open();
			});
		}
	};
	renderChips();
	return { el };
}

// ─── image ───────────────────────────────────────────────────────────────────

async function saveImportedImage(callbacks: FieldWidgetCallbacks, file: File): Promise<string> {
	if (callbacks.saveImage) return callbacks.saveImage(file);
	return (await saveImageForSheet(callbacks.app, file, null)).path;
}

function renderImageWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-fw-image-read' });
		const file = field.value ? callbacks.app.vault.getAbstractFileByPath(field.value.trim()) : null;
		if (file instanceof TFile) {
			const img = el.createEl('img', { cls: 'sg-fw-image-read-img' });
			img.src = callbacks.app.vault.getResourcePath(file);
			img.alt = field.label;
		}
		return { el };
	}

	const el = container.createDiv({ cls: 'sg-fw-image' });

	const renderPreview = () => {
		el.empty();
		const file = field.value ? callbacks.app.vault.getAbstractFileByPath(field.value.trim()) : null;
		if (file instanceof TFile) {
			const img = el.createEl('img', { cls: 'sg-fw-image-img' });
			img.src = callbacks.app.vault.getResourcePath(file);
			img.alt = field.label;
		} else {
			el.createDiv({ cls: 'sg-fw-image-ph', text: 'Drop an image, or click to pick' });
		}
	};
	renderPreview();

	const uploadNew = () => {
		const picker = createEl('input');
		picker.type = 'file';
		picker.accept = 'image/*';
		picker.onchange = async () => {
			const f = picker.files?.[0];
			if (!f) return;
			try {
				const path = await saveImportedImage(callbacks, f);
				callbacks.onChange(path);
				renderPreview();
			} catch (err) {
				new Notice(`Plotverk: Could not import image. ${err instanceof Error ? err.message : ''}`);
			}
		};
		picker.click();
	};

	el.setAttr('role', 'button');
	el.setAttr('aria-label', 'Pick an image');
	el.setAttr('tabindex', '0');
	// Shared by both the click and keydown paths so the menu-building logic
	// lives in exactly one place — keyboard activation has no mouse position,
	// so it opens the same menu anchored to the element instead.
	const openMenu = (e: MouseEvent | KeyboardEvent) => {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Pick from vault').setIcon('image').onClick(() => {
			new ImagePickerModal(callbacks.app, (file) => {
				callbacks.onChange(file.path);
				renderPreview();
			}).open();
		}));
		menu.addItem((i) => i.setTitle('Upload from computer').setIcon('upload').onClick(() => uploadNew()));
		if (e instanceof MouseEvent) {
			menu.showAtMouseEvent(e);
		} else {
			const rect = el.getBoundingClientRect();
			menu.showAtPosition({ x: rect.left, y: rect.bottom });
		}
	};
	el.addEventListener('click', openMenu);
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
			e.preventDefault();
			openMenu(e);
		}
	});
	el.addEventListener('dragover', (e) => { e.preventDefault(); el.addClass('is-dragover'); });
	el.addEventListener('dragleave', () => el.removeClass('is-dragover'));
	el.addEventListener('drop', (e) => {
		e.preventDefault();
		el.removeClass('is-dragover');
		const f = e.dataTransfer?.files?.[0];
		if (!f || !f.type.startsWith('image/')) return;
		void (async () => {
			try {
				const path = await saveImportedImage(callbacks, f);
				callbacks.onChange(path);
				renderPreview();
			} catch (err) {
				new Notice(`Plotverk: Could not import image. ${err instanceof Error ? err.message : ''}`);
			}
		})();
	});

	return { el };
}

// ─── number ──────────────────────────────────────────────────────────────────

function renderNumberWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-fw-read-text', text: field.value });
		return { el };
	}
	const input = container.createEl('input', { cls: 'sg-sheet-field-input', type: 'number' });
	input.placeholder = callbacks.prompt || '';
	input.value = field.value;
	input.setAttr('aria-label', field.label);
	input.addEventListener('input', () => callbacks.onChange(input.value));
	return { el: input };
}

// ─── slider ──────────────────────────────────────────────────────────────────

function renderSliderWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	const config: FieldConfig = field.config ?? {};
	const min = config.min ?? 0;
	const max = config.max ?? 100;

	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-fw-slider-read' });
		const current = Number(field.value) || 0;
		const pct = max === min ? 0 : Math.max(0, Math.min(100, ((current - min) / (max - min)) * 100));
		const track = el.createDiv({ cls: 'sg-fw-slider-read-track' });
		track.createDiv({ cls: 'sg-fw-slider-read-fill' }).style.width = `${pct}%`;
		el.createSpan({ cls: 'sg-fw-slider-read-val', text: `${current} / ${max}` });
		return { el };
	}

	const step = config.step ?? 1;
	const current = Number(field.value) || min;
	const row = container.createDiv({ cls: 'sg-fw-slider' });
	const slider = row.createEl('input', { cls: 'sg-fw-slider-input', type: 'range' });
	slider.min = String(min);
	slider.max = String(max);
	slider.step = String(step);
	slider.value = String(current);
	slider.setAttr('aria-label', field.label);
	const display = row.createSpan({ cls: 'sg-fw-slider-val', text: String(current) });
	slider.addEventListener('input', () => {
		display.textContent = slider.value;
		callbacks.onChange(slider.value);
	});
	return { el: row };
}

// ─── select ──────────────────────────────────────────────────────────────────

function renderSelectWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-fw-read-text', text: field.value });
		return { el };
	}
	const config: FieldConfig = field.config ?? {};
	const options = config.options ?? [];
	const select = container.createEl('select', { cls: 'sg-sheet-field-input' });
	select.createEl('option', { text: 'Choose…', value: '' });
	for (const opt of options) select.createEl('option', { text: opt, value: opt });
	select.value = field.value;
	select.setAttr('aria-label', field.label);
	select.addEventListener('change', () => callbacks.onChange(select.value));
	return { el: select };
}

// ─── checkbox ────────────────────────────────────────────────────────────────

function renderCheckboxWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	if (mode === 'read') {
		const el = container.createSpan({ cls: 'sg-fw-checkbox-read', text: formatFieldValue('checkbox', field.value) });
		return { el };
	}
	const wrap = container.createDiv({ cls: 'sg-fw-checkbox' });
	const checkbox = wrap.createEl('input', { type: 'checkbox' });
	checkbox.checked = field.value === 'true';
	checkbox.setAttr('aria-label', field.label);
	const stateLabel = wrap.createSpan({ cls: 'sg-fw-checkbox-label', text: checkbox.checked ? 'Yes' : 'No' });
	checkbox.addEventListener('change', () => {
		stateLabel.textContent = checkbox.checked ? 'Yes' : 'No';
		callbacks.onChange(String(checkbox.checked));
	});
	return { el: wrap };
}

// ─── date ────────────────────────────────────────────────────────────────────

function renderDateWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-fw-read-text', text: field.value });
		return { el };
	}
	const input = container.createEl('input', { cls: 'sg-sheet-field-input', type: 'date' });
	input.value = field.value;
	input.setAttr('aria-label', field.label);
	input.addEventListener('input', () => callbacks.onChange(input.value));
	return { el: input };
}

// ─── storydate ───────────────────────────────────────────────────────────────
// Plain structured input (era/year/month/day) for now — the calendar-aware
// picker with real month names comes with the Timeline view (Phase 3).

// The widget has no access to the project's actual CalendarDef (custom
// calendars can have shorter/longer months), so its month/day limits are the
// static ones in story-date-edit.ts — they stop an obviously wrong number, they
// are not calendar-accurate validation.

function renderStoryDateWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-fw-read-text', text: formatFieldValue('storydate', field.value) });
		return { el };
	}

	// One draft for the life of the widget. Every keystroke is applied to it (and
	// not to a copy parsed at draw time), so typing the year and then the month
	// keeps both. The rules live in entities/story-date-edit.ts, tested without a DOM.
	let draft = draftFromValue(field.value);
	const wrap = container.createDiv({ cls: 'sg-fw-storydate' });

	const edit = (change: StoryDateEdit): StoryDateDraft => {
		const next = applyStoryDateEdit(draft, change);
		draft = next.draft;
		callbacks.onChange(next.value);
		return draft;
	};

	const eraInput = wrap.createEl('input', { cls: 'sg-sheet-field-input sg-fw-storydate-era', type: 'text' });
	eraInput.placeholder = 'Era (optional)';
	eraInput.value = draft.era;
	eraInput.setAttr('aria-label', field.label);
	eraInput.addEventListener('input', () => edit({ era: eraInput.value }));

	const yearInput = wrap.createEl('input', { cls: 'sg-sheet-field-input sg-fw-storydate-num', type: 'number' });
	yearInput.placeholder = 'Year';
	yearInput.value = draft.year != null ? String(draft.year) : '';
	yearInput.setAttr('aria-label', field.label);
	yearInput.addEventListener('input', () => edit({ year: numberFromInput(yearInput.value) }));

	const monthInput = wrap.createEl('input', { cls: 'sg-sheet-field-input sg-fw-storydate-num', type: 'number' });
	monthInput.placeholder = 'Month';
	monthInput.value = draft.month != null ? String(draft.month) : '';
	monthInput.min = '1';
	monthInput.max = String(DEFAULT_STORYDATE_LIMITS.maxMonth);
	monthInput.setAttr('aria-label', field.label);
	monthInput.addEventListener('input', () => {
		// The min/max attributes only affect the native spinner, they don't stop
		// someone from typing 13 directly — the edit clamps, and the box shows it.
		const typed = numberFromInput(monthInput.value);
		const { month } = edit({ month: typed });
		if (month !== typed && month != null) monthInput.value = String(month);
	});

	const dayInput = wrap.createEl('input', { cls: 'sg-sheet-field-input sg-fw-storydate-num', type: 'number' });
	dayInput.placeholder = 'Day';
	dayInput.value = draft.day != null ? String(draft.day) : '';
	dayInput.min = '1';
	dayInput.max = String(DEFAULT_STORYDATE_LIMITS.maxDay);
	dayInput.setAttr('aria-label', field.label);
	dayInput.addEventListener('input', () => {
		const typed = numberFromInput(dayInput.value);
		const { day } = edit({ day: typed });
		if (day !== typed && day != null) dayInput.value = String(day);
	});

	return { el: wrap };
}

// ─── color ───────────────────────────────────────────────────────────────────

// Full 6-digit hex only — matches what <input type="color"> can hold natively,
// same convention as isHex() in color-picker-popover.ts (no 3-digit shorthand).
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function renderColorWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-fw-color-read' });
		const v = field.value.trim();
		const swatch = el.createDiv({ cls: 'sg-fw-color-swatch' });
		if (HEX_COLOR_RE.test(v)) swatch.style.background = v;
		else swatch.addClass('is-empty');
		el.createSpan({ cls: 'sg-fw-read-text', text: field.value });
		return { el };
	}

	const row = container.createDiv({ cls: 'sg-fw-color' });

	const swatch = row.createEl('button', { cls: 'sg-fw-color-swatch' });
	swatch.type = 'button';
	swatch.setAttr('aria-label', 'Pick a color');

	// Never appended to the DOM — same trick renderImageWidget uses for its file
	// input. The swatch button is the visible trigger, styled to match the
	// sheet's other controls instead of the browser's own color chip.
	const picker = createEl('input');
	picker.type = 'color';

	const hexInput = row.createEl('input', { cls: 'sg-sheet-field-input sg-fw-color-hex', type: 'text' });
	hexInput.placeholder = callbacks.prompt || '#RRGGBB';
	hexInput.spellcheck = false;
	hexInput.maxLength = 7;
	hexInput.setAttr('aria-label', field.label);

	const paint = (value: string) => {
		const v = value.trim();
		if (HEX_COLOR_RE.test(v)) {
			swatch.style.background = v;
			swatch.removeClass('is-empty');
			picker.value = v;
		} else {
			swatch.setCssStyles({ background: '' });
			swatch.addClass('is-empty');
		}
	};

	hexInput.value = field.value;
	paint(field.value);

	hexInput.addEventListener('input', () => {
		callbacks.onChange(hexInput.value);
		paint(hexInput.value);
	});

	swatch.addEventListener('click', () => picker.click());
	picker.addEventListener('input', () => {
		hexInput.value = picker.value;
		callbacks.onChange(picker.value);
		paint(picker.value);
	});

	return { el: row };
}

// ─── list ────────────────────────────────────────────────────────────────────

function renderListWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	const items = () => parseListItems(field.value);

	if (mode === 'read') {
		const el = container.createEl('ul', { cls: 'sg-fw-list-read' });
		for (const item of items()) el.createEl('li', { text: item });
		return { el };
	}

	const el = container.createDiv({ cls: 'sg-fw-list' });

	// The rows on screen, empty ones included. Edits work on these — re-reading the
	// saved value would skip an emptied row and write the typing into the next one.
	const rows: string[] = items();

	const commit = () => {
		field.value = rows.map((r) => r.trim()).filter(Boolean).join('\n');
		callbacks.onChange(field.value);
	};

	const render = () => {
		el.empty();

		rows.forEach((item, i) => {
			const row = el.createDiv({ cls: 'sg-fw-list-row' });
			row.createSpan({ cls: 'sg-fw-list-bullet', text: '•' });

			const input = row.createEl('input', { cls: 'sg-fw-list-input', type: 'text' });
			input.value = item;
			input.setAttr('aria-label', field.label);
			input.addEventListener('input', () => {
				rows[i] = input.value;
				// Write straight through without re-rendering, or the caret jumps.
				commit();
			});
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					rows.splice(i + 1, 0, '');
					commit();
					render();
					focusRow(i + 1);
				} else if (e.key === 'Backspace' && input.value === '' && rows.length > 1) {
					e.preventDefault();
					rows.splice(i, 1);
					commit();
					render();
					focusRow(Math.max(0, i - 1));
				}
			});

			const del = row.createEl('button', { cls: 'sg-fw-list-del', text: '×' });
			del.setAttr('aria-label', 'Remove this item');
			del.addEventListener('click', (e) => {
				e.preventDefault();
				rows.splice(i, 1);
				commit();
				render();
			});
		});

		const add = el.createEl('button', { cls: 'sg-fw-list-add', text: '+ Add item' });
		add.addEventListener('click', (e) => {
			e.preventDefault();
			rows.push('');
			commit();
			render();
			focusRow(rows.length - 1);
		});
	};

	const focusRow = (index: number) => {
		const inputs = el.querySelectorAll<HTMLInputElement>('.sg-fw-list-input');
		inputs[index]?.focus();
	};

	render();
	return { el };
}

// ─── table ───────────────────────────────────────────────────────────────────

function renderTableWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	const columns = () => {
		const cols = field.config?.columns;
		return cols && cols.length > 0 ? cols : ['Name', 'Notes'];
	};

	if (mode === 'read') {
		const rows = parseTableRows(field.value);
		const el = container.createDiv({ cls: 'sg-fw-table-read' });
		const table = el.createEl('table');
		const headRow = table.createEl('thead').createEl('tr');
		for (const col of columns()) headRow.createEl('th', { text: col });
		const tbody = table.createEl('tbody');
		for (const row of rows) {
			const tr = tbody.createEl('tr');
			columns().forEach((_, i) => tr.createEl('td', { text: row[i] ?? '' }));
		}
		return { el };
	}

	const el = container.createDiv({ cls: 'sg-fw-table' });

	const setColumns = (next: string[]) => {
		const config: FieldConfig = { ...(field.config ?? {}), columns: next };
		field.config = config;
		callbacks.onConfigChange?.(config);
	};

	const commit = (rows: string[][]) => {
		field.value = stringifyTableRows(rows);
		callbacks.onChange(field.value);
	};

	/** Rows padded to the current column count, with at least one editable row. */
	const rowsFor = (cols: string[]): string[][] => {
		const raw = parseTableRows(field.value);
		const padded = raw.map((row) => cols.map((_, i) => row[i] ?? ''));
		return padded.length > 0 ? padded : [cols.map(() => '')];
	};

	const render = () => {
		el.empty();
		const cols = columns();
		const rows = rowsFor(cols);

		const scroll = el.createDiv({ cls: 'sg-fw-table-scroll' });
		const table = scroll.createEl('table', { cls: 'sg-fw-table-grid' });

		// Header — column names are editable in place
		const headRow = table.createEl('thead').createEl('tr');
		cols.forEach((col, c) => {
			const th = headRow.createEl('th');
			const input = th.createEl('input', { cls: 'sg-fw-table-head-input', type: 'text' });
			input.value = col;
			input.placeholder = `Column ${c + 1}`;
			input.addEventListener('change', () => {
				const next = [...cols];
				next[c] = input.value.trim() || `Column ${c + 1}`;
				setColumns(next);
				render();
			});
			if (cols.length > 1) {
				const del = th.createEl('button', { cls: 'sg-fw-table-colDel', text: '×' });
				del.setAttr('aria-label', `Remove the “${col}” column`);
				del.addEventListener('click', (e) => {
					e.preventDefault();
					setColumns(cols.filter((_, i) => i !== c));
					commit(rows.map((row) => row.filter((_, i) => i !== c)));
					render();
				});
			}
		});
		headRow.createEl('th', { cls: 'sg-fw-table-gutter' });

		const tbody = table.createEl('tbody');
		rows.forEach((row, r) => {
			const tr = tbody.createEl('tr');
			cols.forEach((_, c) => {
				const td = tr.createEl('td');
				const input = td.createEl('input', { cls: 'sg-fw-table-cell', type: 'text' });
				input.value = row[c] ?? '';
				input.setAttr('aria-label', field.label);
				input.addEventListener('input', () => {
					const next = rowsFor(cols);
					next[r][c] = input.value;
					// Straight through — re-rendering here would drop the caret.
					field.value = stringifyTableRows(next);
					callbacks.onChange(field.value);
				});
				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						const next = rowsFor(cols);
						next.splice(r + 1, 0, cols.map(() => ''));
						commit(next);
						render();
						focusCell(r + 1, c);
					}
				});
			});
			const gutter = tr.createEl('td', { cls: 'sg-fw-table-gutter' });
			if (rows.length > 1) {
				const del = gutter.createEl('button', { cls: 'sg-fw-table-rowDel', text: '×' });
				del.setAttr('aria-label', 'Remove this row');
				del.addEventListener('click', (e) => {
					e.preventDefault();
					commit(rows.filter((_, i) => i !== r));
					render();
				});
			}
		});

		const actions = el.createDiv({ cls: 'sg-fw-table-actions' });
		const addRow = actions.createEl('button', { cls: 'sg-fw-table-btn', text: '+ Row' });
		addRow.addEventListener('click', (e) => {
			e.preventDefault();
			const next = [...rowsFor(cols), cols.map(() => '')];
			commit(next);
			render();
			focusCell(next.length - 1, 0);
		});
		const addCol = actions.createEl('button', { cls: 'sg-fw-table-btn', text: '+ Column' });
		addCol.addEventListener('click', (e) => {
			e.preventDefault();
			setColumns([...cols, `Column ${cols.length + 1}`]);
			commit(rowsFor(cols).map((row) => [...row, '']));
			render();
		});
	};

	const focusCell = (row: number, col: number) => {
		const trs = el.querySelectorAll('tbody tr');
		const inputs = trs[row]?.querySelectorAll<HTMLInputElement>('.sg-fw-table-cell');
		inputs?.[col]?.focus();
	};

	render();
	return { el };
}

// ─── matrix ──────────────────────────────────────────────────────────────────

const MATRIX_RANGE = 100;

function parseMatrixValue(v: string): { x: number; y: number } {
	const [xs, ys] = v.split(',');
	const x = Number((xs ?? '').trim());
	const y = Number((ys ?? '').trim());
	return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

function renderMatrixWidget(container: HTMLElement, field: CharacterField, mode: 'edit' | 'read', callbacks: FieldWidgetCallbacks): FieldWidgetResult {
	const config: FieldConfig = field.config ?? {};
	const [xNeg, xPos] = config.xAxis ?? ['', ''];
	const [yNeg, yPos] = config.yAxis ?? ['', ''];
	let { x, y } = parseMatrixValue(field.value);

	const svgNS = 'http://www.w3.org/2000/svg';
	const buildSvg = (): { svg: SVGSVGElement; point: SVGCircleElement } => {
		const svg = container.doc.createElementNS(svgNS, 'svg');
		svg.setAttribute('viewBox', '0 0 160 160');
		svg.classList.add('sg-fw-matrix-svg');
		const hLine = container.doc.createElementNS(svgNS, 'line');
		hLine.setAttribute('x1', '4'); hLine.setAttribute('x2', '156'); hLine.setAttribute('y1', '80'); hLine.setAttribute('y2', '80');
		hLine.classList.add('sg-fw-matrix-axis');
		const vLine = container.doc.createElementNS(svgNS, 'line');
		vLine.setAttribute('x1', '80'); vLine.setAttribute('x2', '80'); vLine.setAttribute('y1', '4'); vLine.setAttribute('y2', '156');
		vLine.classList.add('sg-fw-matrix-axis');
		svg.appendChild(hLine);
		svg.appendChild(vLine);
		const point = container.doc.createElementNS(svgNS, 'circle');
		point.setAttribute('r', '6');
		point.classList.add('sg-fw-matrix-point');
		svg.appendChild(point);
		return { svg, point };
	};
	const toSvg = (px: number, py: number) => ({
		sx: 80 + (px / MATRIX_RANGE) * 72,
		sy: 80 - (py / MATRIX_RANGE) * 72,
	});

	const buildLabels = (parent: HTMLElement) => {
		const labels = parent.createDiv({ cls: 'sg-fw-matrix-labels' });
		labels.createDiv({ cls: 'sg-fw-matrix-label sg-fw-matrix-label--top', text: yPos });
		labels.createDiv({ cls: 'sg-fw-matrix-label sg-fw-matrix-label--bottom', text: yNeg });
		labels.createDiv({ cls: 'sg-fw-matrix-label sg-fw-matrix-label--left', text: xNeg });
		labels.createDiv({ cls: 'sg-fw-matrix-label sg-fw-matrix-label--right', text: xPos });
	};

	if (mode === 'read') {
		const el = container.createDiv({ cls: 'sg-fw-matrix sg-fw-matrix--read' });
		const { svg, point } = buildSvg();
		const { sx, sy } = toSvg(x, y);
		point.setAttribute('cx', String(sx));
		point.setAttribute('cy', String(sy));
		el.appendChild(svg);
		buildLabels(el);
		return { el };
	}

	const el = container.createDiv({ cls: 'sg-fw-matrix' });
	const { svg, point } = buildSvg();
	const update = () => {
		const { sx, sy } = toSvg(x, y);
		point.setAttribute('cx', String(sx));
		point.setAttribute('cy', String(sy));
	};
	update();
	el.appendChild(svg);
	buildLabels(el);

	// x/y is a free-form 2D position, not a set of discrete selectable cells,
	// so this reads as an "application" widget with its own key behavior
	// rather than a literal grid.
	svg.setAttribute('tabindex', '0');
	svg.setAttribute('role', 'application');
	svg.setAttribute('aria-label', field.label);

	// The one place that clamps/rounds/fires onChange — both the pointer drag
	// and the keyboard nudge below call this, so neither duplicates it.
	const setXY = (nextX: number, nextY: number) => {
		x = Math.max(-MATRIX_RANGE, Math.min(MATRIX_RANGE, nextX));
		y = Math.max(-MATRIX_RANGE, Math.min(MATRIX_RANGE, nextY));
		update();
		callbacks.onChange(`${Math.round(x)},${Math.round(y)}`);
	};
	const setFromClient = (clientX: number, clientY: number) => {
		const rect = svg.getBoundingClientRect();
		const relX = (clientX - rect.left) / rect.width;
		const relY = (clientY - rect.top) / rect.height;
		setXY((relX - 0.5) * 2 * MATRIX_RANGE, (0.5 - relY) * 2 * MATRIX_RANGE);
	};
	let dragging = false;
	svg.addEventListener('pointerdown', (e) => {
		dragging = true;
		svg.setPointerCapture(e.pointerId);
		setFromClient(e.clientX, e.clientY);
	});
	svg.addEventListener('pointermove', (e) => { if (dragging) setFromClient(e.clientX, e.clientY); });
	svg.addEventListener('pointerup', () => { dragging = false; });
	svg.addEventListener('pointercancel', () => { dragging = false; });

	// Baseline keyboard equivalent — arrow keys nudge the point by a small
	// step. This is not full keyboard-grid-navigation (there's no "cell" here,
	// the value is continuous); see the accessibility-sweep report for a note
	// on taking this further.
	const MATRIX_KEY_STEP = MATRIX_RANGE / 20;
	svg.addEventListener('keydown', (e) => {
		switch (e.key) {
			case 'ArrowLeft': e.preventDefault(); setXY(x - MATRIX_KEY_STEP, y); break;
			case 'ArrowRight': e.preventDefault(); setXY(x + MATRIX_KEY_STEP, y); break;
			case 'ArrowUp': e.preventDefault(); setXY(x, y + MATRIX_KEY_STEP); break;
			case 'ArrowDown': e.preventDefault(); setXY(x, y - MATRIX_KEY_STEP); break;
		}
	});

	return { el };
}
