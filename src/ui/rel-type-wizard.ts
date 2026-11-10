import type StorygridPlugin from '../main';
import { generateId } from '../grid-data';
import {
	CustomRelationshipType,
	LineStyle,
	RelTypeWizardInput,
	buildCustomTypesFromWizard,
} from '../utils/relations';
import { edgeGeometry, dashArrayFor, needsRoundCap } from '../utils/edge-style';
import { ColorPickerPopover } from './color-picker-popover';
import { setPhosphorIcon } from '../utils/icons';
import { t } from '../i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';

const LINE_STYLES: LineStyle[] = ['solid', 'dotted', 'dashed', 'dashdot', 'double', 'jagged', 'zigzag', 'wavy'];

const STYLE_LABEL_KEYS: Record<LineStyle, string> = {
	solid: 'relWizard.style.solid',
	dotted: 'relWizard.style.dotted',
	dashed: 'relWizard.style.dashed',
	dashdot: 'relWizard.style.dashdot',
	double: 'relWizard.style.double',
	jagged: 'relWizard.style.jagged',
	zigzag: 'relWizard.style.zigzag',
	wavy: 'relWizard.style.wavy',
};

const SAMPLE_WEIGHT = 1.5;

export interface LineStylePickerHandle {
	/** Update the sample strokes' color (e.g. when a paired color swatch changes). */
	setColor(color: string): void;
}

/**
 * The 8-button line-style strip (48×22, inner 40×10 SVG sample drawn via the
 * real `edgeGeometry` used on the map, so previews match the live line
 * pixel-for-pixel). Shared by the wizard's own color/style row and by each
 * existing type's row in Settings, so both draw identically.
 */
export function renderLineStylePicker(
	host: HTMLElement,
	initialStyle: LineStyle,
	initialColor: string,
	onChange: (style: LineStyle) => void,
): LineStylePickerHandle {
	const wrap = host.createDiv({ cls: 'sg-rtw-styles' });
	const samplePaths: SVGPathElement[] = [];
	const buttons = new Map<LineStyle, HTMLButtonElement>();
	let color = initialColor;

	function drawSample(svg: SVGSVGElement, style: LineStyle): void {
		const geom = edgeGeometry(style, 2, 5, 38, 5, SAMPLE_WEIGHT);
		const dash = dashArrayFor(style, SAMPLE_WEIGHT);
		const round = needsRoundCap(style);
		for (const d of [geom.d, geom.d2].filter((v): v is string => !!v)) {
			const path = host.doc.createElementNS(SVG_NS, 'path');
			path.setAttribute('d', d);
			path.setAttribute('fill', 'none');
			path.setAttribute('stroke', color);
			path.setAttribute('stroke-width', String(SAMPLE_WEIGHT));
			if (dash) path.setAttribute('stroke-dasharray', dash);
			if (round) path.setAttribute('stroke-linecap', 'round');
			svg.appendChild(path);
			samplePaths.push(path);
		}
	}

	for (const style of LINE_STYLES) {
		const label = t(STYLE_LABEL_KEYS[style]);
		const btn = wrap.createEl('button', {
			cls: 'sg-rtw-style',
			attr: { type: 'button', title: label, 'aria-label': label },
		});
		const svg = host.doc.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('width', '40');
		svg.setAttribute('height', '10');
		svg.setAttribute('viewBox', '0 0 40 10');
		btn.appendChild(svg);
		drawSample(svg, style);
		btn.addEventListener('click', () => {
			onChange(style);
			for (const [s, b] of buttons) b.toggleClass('is-active', s === style);
		});
		buttons.set(style, btn);
	}
	buttons.get(initialStyle)?.addClass('is-active');

	return {
		setColor(c: string): void {
			color = c;
			for (const p of samplePaths) p.setAttribute('stroke', c);
		},
	};
}

export interface RelTypeWizardOptions {
	/** Fired after the new type(s) are persisted to plugin.settings.customRelationshipTypes. */
	onCreated: (created: CustomRelationshipType[]) => void;
	/** Fired when the user cancels. Caller decides how to remove/collapse `host`. */
	onCancel?: () => void;
}

/**
 * Mounts the inline Relationship Creation Wizard into `host`. Used by both
 * Settings ("+ Create New Relationship Type") and the Codex sheet editor's
 * relationship dropdown ("+ New relationship type…") — never a modal, per the
 * "no modal-on-modal" design law. Does not unmount itself on create/cancel;
 * the caller owns `host` and decides what happens to it afterward.
 */
export function mountRelTypeWizard(host: HTMLElement, plugin: StorygridPlugin, options: RelTypeWizardOptions): void {
	host.empty();
	const root = host.createDiv({ cls: 'sg-rtw-root' });
	// Unique per mount so label `for`/id pairs never collide — this wizard can
	// be mounted more than once at a time (Settings and a Codex sheet editor's
	// relationship dropdown can both be open together).
	const uid = generateId();

	let color = '#7c5fd3';
	let lineStyle: LineStyle = 'solid';
	let behavior: 'mutual' | 'opposites' | 'oneWay' = 'mutual';
	let moreOpen = false;

	// ── Name ─────────────────────────────────────────────────────────────────
	const nameRow = root.createDiv({ cls: 'sg-rtw-row' });
	nameRow.createEl('label', { cls: 'sg-rtw-label', text: t('relWizard.name'), attr: { for: `sg-rtw-name-${uid}` } });
	const nameInput = nameRow.createEl('input', {
		cls: 'sg-rtw-name',
		attr: { type: 'text', placeholder: t('relWizard.namePlaceholder'), id: `sg-rtw-name-${uid}` },
	});

	// ── Color & style ────────────────────────────────────────────────────────
	const styleRow = root.createDiv({ cls: 'sg-rtw-row' });
	styleRow.createEl('label', { cls: 'sg-rtw-label', text: t('relWizard.colorStyle'), attr: { for: `sg-rtw-swatch-${uid}` } });
	const swatch = styleRow.createEl('button', {
		cls: 'sg-rtw-swatch',
		attr: { type: 'button', id: `sg-rtw-swatch-${uid}`, 'aria-label': 'Relationship type color' },
	});
	swatch.style.background = color;

	const stylePicker = renderLineStylePicker(styleRow, lineStyle, color, (style) => { lineStyle = style; });

	swatch.addEventListener('click', () => {
		ColorPickerPopover.show(swatch, {
			currentColor: color,
			palettes: plugin.settings.colorPalettes,
			activePaletteId: plugin.settings.activeColorPaletteId,
			savedColors: plugin.settings.savedColors ?? [],
			onSaveColor: (c) => {
				const saved = [...(plugin.settings.savedColors ?? [])];
				if (!saved.includes(c)) {
					plugin.settings.savedColors = [c, ...saved].slice(0, 32);
					void plugin.saveSettings();
				}
			},
			onRemoveSaved: (c) => {
				plugin.settings.savedColors = (plugin.settings.savedColors ?? []).filter((x) => x !== c);
				void plugin.saveSettings();
			},
			onPreview: (c) => { color = c; swatch.style.background = c; stylePicker.setColor(c); },
			onCommit: (c) => { color = c; swatch.style.background = c; stylePicker.setColor(c); },
		});
	});

	// ── Behavior ─────────────────────────────────────────────────────────────
	const behaviorRow = root.createDiv({ cls: 'sg-rtw-row' });
	behaviorRow.createEl('label', { cls: 'sg-rtw-label', text: t('relWizard.behavior'), attr: { for: `sg-rtw-behavior-${uid}` } });
	const behaviorSelect = behaviorRow.createEl('select', { cls: 'sg-rtw-behavior', attr: { id: `sg-rtw-behavior-${uid}` } });
	const behaviorOptions: Array<{ value: 'mutual' | 'opposites' | 'oneWay'; key: string }> = [
		{ value: 'mutual', key: 'relWizard.behavior.mutual' },
		{ value: 'opposites', key: 'relWizard.behavior.opposites' },
		{ value: 'oneWay', key: 'relWizard.behavior.oneWay' },
	];
	for (const opt of behaviorOptions) {
		behaviorSelect.createEl('option', { value: opt.value, text: t(opt.key) });
	}

	const oppositeRow = root.createDiv({ cls: 'sg-rtw-row sg-rtw-opposite' });
	oppositeRow.createEl('label', { text: t('relWizard.oppositeTitle'), attr: { for: `sg-rtw-opposite-${uid}` } });
	const oppositeInput = oppositeRow.createEl('input', {
		cls: 'sg-rtw-opposite-name',
		attr: { type: 'text', placeholder: t('relWizard.oppositeTitlePlaceholder'), id: `sg-rtw-opposite-${uid}` },
	});

	function refreshOppositeVisibility(): void {
		oppositeRow.style.display = behavior === 'opposites' ? '' : 'none';
	}
	refreshOppositeVisibility();

	behaviorSelect.addEventListener('change', () => {
		behavior = behaviorSelect.value as typeof behavior;
		refreshOppositeVisibility();
	});

	// ── Optional extras ──────────────────────────────────────────────────────
	const moreToggle = root.createEl('button', {
		cls: 'sg-rtw-more-toggle',
		attr: { type: 'button', 'aria-label': t('relWizard.optionalDetails') },
	});
	setPhosphorIcon(moreToggle, 'plus', '+');

	const more = root.createDiv({ cls: 'sg-rtw-more' });
	more.hide();

	const intensityRow = more.createDiv({ cls: 'sg-rtw-row' });
	intensityRow.createEl('label', { text: t('relWizard.bondStrength'), attr: { for: `sg-rtw-intensity-${uid}` } });
	const intensityInput = intensityRow.createEl('input', {
		cls: 'sg-rtw-intensity',
		attr: { type: 'range', min: '1', max: '10', value: '5', id: `sg-rtw-intensity-${uid}` },
	});
	const intensityVal = intensityRow.createSpan({ cls: 'sg-rtw-intensity-val', text: '5' });
	intensityInput.addEventListener('input', () => { intensityVal.setText(intensityInput.value); });

	const epochRow = more.createDiv({ cls: 'sg-rtw-row' });
	epochRow.createEl('label', { text: t('relWizard.epoch'), attr: { for: `sg-rtw-epoch-${uid}` } });
	const epochInput = epochRow.createEl('input', {
		cls: 'sg-rtw-epoch',
		attr: { type: 'text', placeholder: t('relWizard.epochPlaceholder'), id: `sg-rtw-epoch-${uid}` },
	});

	moreToggle.addEventListener('click', () => {
		moreOpen = !moreOpen;
		more.style.display = moreOpen ? '' : 'none';
		moreToggle.toggleClass('is-active', moreOpen);
	});

	// ── Actions ──────────────────────────────────────────────────────────────
	const actions = root.createDiv({ cls: 'sg-rtw-actions' });
	const cancelBtn = actions.createEl('button', { cls: 'sg-rtw-cancel', text: t('relWizard.cancel') });
	const createBtn = actions.createEl('button', { cls: 'sg-rtw-create mod-cta', text: t('relWizard.create') });

	cancelBtn.addEventListener('click', () => options.onCancel?.());

	createBtn.addEventListener('click', () => {
		const label = nameInput.value.trim();
		if (!label) {
			nameInput.focus();
			return;
		}
		const input: RelTypeWizardInput = {
			label,
			color,
			lineStyle,
			behavior,
			oppositeLabel: behavior === 'opposites' ? oppositeInput.value.trim() : undefined,
			defaultIntensity: moreOpen ? Number(intensityInput.value) : undefined,
			epoch: moreOpen ? epochInput.value.trim() : undefined,
		};
		const ids = { primary: generateId(), opposite: behavior === 'opposites' ? generateId() : undefined };
		const created = buildCustomTypesFromWizard(input, ids);

		plugin.settings.customRelationshipTypes = [...(plugin.settings.customRelationshipTypes ?? []), ...created];
		void plugin.saveSettings().then(() => options.onCreated(created));
	});
}
