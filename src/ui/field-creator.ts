import { setTooltip } from 'obsidian';
import { FieldType, FIELD_TYPES, FieldConfig, defaultConfig } from '../entities/field-types';
import { CatalogCategory } from '../entities/entity-kinds';
import {
	renderSearchableSelect,
	SearchableOption,
	SearchableSelectHandle,
} from './searchable-select';

/**
 * Inline "new field" card — title, hover text, type dropdown, per-type config,
 * and a category picker. Shared by the sheet editor's "+ Add field" (custom
 * fields on a single entity) and the Settings template builder (fields on a
 * reusable template), so both surfaces ask the same questions the same way.
 */

export interface FieldCreatorResult {
	label: string;
	type: FieldType;
	prompt?: string;
	config?: FieldConfig;
	category?: string;
}

export interface FieldCreatorOptions {
	/** Categories already used by this kind, offered in the flat card's picker. */
	categories: string[];
	/**
	 * Titles of the sections currently on the sheet, offered as step 1 of the
	 * staged card. These are the sections the user can actually see in the form
	 * — not saved templates, which are a different thing entirely.
	 */
	sections?: string[];
	/** The category → field tree offered by the "New" route. */
	catalog?: CatalogCategory[];
	onSubmit: (result: FieldCreatorResult) => void;
	onCancel: () => void;
	/** Card heading; defaults to "New field". */
	title?: string;
	/**
	 * Ask one thing at a time behind a progress bar, instead of showing every
	 * input at once. Used by the sheet editor, where the card sits in the place
	 * the finished field will occupy and settles into it on Done. The Settings
	 * template builder leaves this off: there you are entering a list of fields
	 * in a row, and the flat form is faster.
	 */
	staged?: boolean;
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
	text: 'Text',
	textarea: 'Long text',
	tags: 'Tags',
	image: 'Image',
	number: 'Number',
	slider: 'Slider',
	select: 'Dropdown',
	checkbox: 'Yes / No',
	date: 'Date',
	matrix: 'Chart (two scales)',
	list: 'List',
	table: 'Table',
	color: 'Color',
	storydate: 'Story date',
};

/** One-line description of what each type is for, shown beside the picker. */
export const FIELD_TYPE_HINTS: Record<FieldType, string> = {
	text: 'A single line — names, titles, short answers.',
	textarea: 'A paragraph or more, with room to write.',
	tags: 'Small chips — traits, keywords, or links to other Codex entries.',
	image: 'A picture from your vault or computer.',
	number: 'A plain number — age, population, price.',
	slider: 'A dial between two ends, like a 0–100 trait score.',
	select: 'Pick one from a list you define.',
	checkbox: 'A simple yes or no.',
	date: 'A calendar date.',
	matrix: 'A dot placed on two crossed scales at once.',
	list: 'A running list of items you can add to and reorder.',
	table: 'A grid with columns you name — inventories, timelines, casts.',
	color: 'A single color — pick from a swatch.',
	storydate: 'A date on your story’s own calendar — powers the Timeline.',
};

/**
 * Render the per-type configuration controls (dropdown choices, slider bounds,
 * chart poles, entity-link toggle) into `host`, reporting the live config back
 * through `onChange`. Shared by the inline creator card and the Add-field
 * wizard so both ask for the same settings in the same words.
 */
export function renderTypeConfigControls(
	host: HTMLElement,
	type: FieldType,
	initial: FieldConfig | undefined,
	onChange: (config: FieldConfig) => void
): void {
	host.empty();
	const config: FieldConfig = { ...defaultConfig(type), ...(initial ?? {}) };
	const push = () => onChange({ ...config });
	push();

	if (type === 'select') {
		const row = host.createDiv({ cls: 'sg-fc-row' });
		row.createDiv({ cls: 'sg-fc-label', text: 'Choices' });
		const input = row.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
		input.placeholder = 'Option one, option two, option three';
		input.value = (config.options ?? []).join(', ');
		input.addEventListener('input', () => {
			config.options = input.value.split(',').map((o) => o.trim()).filter(Boolean);
			push();
		});
	} else if (type === 'slider') {
		const row = host.createDiv({ cls: 'sg-fc-row sg-fc-row--triple' });
		const mk = (placeholder: string, value: number) => {
			const i = row.createEl('input', { cls: 'sg-sheet-field-input', type: 'number' });
			i.placeholder = placeholder;
			i.value = String(value);
			return i;
		};
		const minInput = mk('Min', config.min ?? 0);
		const maxInput = mk('Max', config.max ?? 100);
		const stepInput = mk('Step', config.step ?? 1);
		const sync = () => {
			config.min = Number(minInput.value) || 0;
			config.max = Number(maxInput.value) || 100;
			config.step = Number(stepInput.value) || 1;
			push();
		};
		[minInput, maxInput, stepInput].forEach((i) => i.addEventListener('input', sync));
	} else if (type === 'matrix') {
		const [xNeg, xPos] = config.xAxis ?? ['', ''];
		const [yNeg, yPos] = config.yAxis ?? ['', ''];
		const xRow = host.createDiv({ cls: 'sg-fc-row sg-fc-row--double' });
		const mk = (parent: HTMLElement, placeholder: string, value: string) => {
			const i = parent.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
			i.placeholder = placeholder;
			i.value = value;
			return i;
		};
		const xNegInput = mk(xRow, 'Left end (e.g. Cold)', xNeg);
		const xPosInput = mk(xRow, 'Right end (e.g. Warm)', xPos);
		const yRow = host.createDiv({ cls: 'sg-fc-row sg-fc-row--double' });
		const yNegInput = mk(yRow, 'Bottom end (e.g. Calm)', yNeg);
		const yPosInput = mk(yRow, 'Top end (e.g. Bold)', yPos);
		const sync = () => {
			config.xAxis = [xNegInput.value.trim(), xPosInput.value.trim()];
			config.yAxis = [yNegInput.value.trim(), yPosInput.value.trim()];
			push();
		};
		[xNegInput, xPosInput, yNegInput, yPosInput].forEach((i) => i.addEventListener('input', sync));
	} else if (type === 'tags') {
		const row = host.createDiv({ cls: 'sg-fc-row' });
		const toggleLabel = row.createEl('label', { cls: 'sg-fc-checkbox-label' });
		const toggle = toggleLabel.createEl('input', { type: 'checkbox' });
		toggle.checked = !!config.entityLink;
		toggleLabel.appendText(' Link to real Codex entries instead of free-text tags');
		toggle.addEventListener('change', () => { config.entityLink = toggle.checked; push(); });
	} else if (type === 'table') {
		const row = host.createDiv({ cls: 'sg-fc-row' });
		row.createDiv({ cls: 'sg-fc-label', text: 'Columns' });
		const input = row.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
		input.placeholder = 'Item, Where it is, Notes';
		input.value = (config.columns ?? []).join(', ');
		input.addEventListener('input', () => {
			const cols = input.value.split(',').map((c) => c.trim()).filter(Boolean);
			config.columns = cols.length > 0 ? cols : ['Name', 'Notes'];
			push();
		});
	}
}

const NEW_CATEGORY_SENTINEL = '__new__';

/**
 * The staged creator, rendered inline where the finished field will live.
 *
 * Step 1 always asks which SECTION the field joins (or starts a new one).
 * Step 2 forks:
 *   New    → pick an existing field from a category → field tree. 3 steps.
 *   Custom → name it and write its help text, then choose a type and fill in
 *            whatever that type needs. 4 steps.
 * The progress bar and the step markers follow whichever route is taken.
 */
function renderStagedCard(container: HTMLElement, options: FieldCreatorOptions): HTMLElement {
	const card = container.createDiv({ cls: 'sg-fc-card sg-fc-card--staged' });

	type Route = 'new' | 'custom' | null;

	let stage = 0;
	let route: Route = null;
	let section = '';
	let newSection = '';
	let label = '';
	let type: FieldType = 'text';
	let prompt = '';
	let config: FieldConfig = defaultConfig('text');
	/** Set only on the "New" route, where the catalog supplies the whole field. */
	let picked:
		| { label: string; type: FieldType; prompt?: string; config?: FieldConfig; category: string }
		| null = null;
	/** The open searchable dropdown, so its document listener can be released. */
	let selectHandle: SearchableSelectHandle | null = null;

	const catalog = options.catalog ?? [];
	const sections = options.sections ?? options.categories;

	/** How many stages this route has. Steps are numbered, never named. */
	const stageCount = (): number => (route === 'custom' ? 4 : 3);

	const head = card.createDiv({ cls: 'sg-fc-head' });
	head.createDiv({ cls: 'sg-fc-title', text: options.title ?? 'New field' });
	const counter = head.createDiv({ cls: 'sg-fc-stepcount', attr: { 'aria-live': 'polite' } });

	const stepsRow = card.createDiv({ cls: 'sg-fc-steps' });
	const body = card.createDiv({ cls: 'sg-fc-stage' });

	const actions = card.createDiv({ cls: 'sg-fc-actions' });
	const cancelBtn = actions.createEl('button', { cls: 'sg-sheet-btn sg-fc-cancel', text: 'Cancel' });
	cancelBtn.addEventListener('click', () => {
		// Cancelling while the "New" route's searchable dropdown is on screen
		// otherwise leaks its portaled panel + 3 global listeners — see the
		// same call in finish() and renderStage().
		selectHandle?.destroy();
		selectHandle = null;
		options.onCancel();
	});
	actions.createDiv({ cls: 'sg-fc-actions-spacer' });
	const backBtn = actions.createEl('button', { cls: 'sg-sheet-btn', text: 'Back' });
	backBtn.addEventListener('click', () => go(stage - 1));
	const nextBtn = actions.createEl('button', { cls: 'sg-sheet-btn sg-sheet-btn--primary' });
	nextBtn.addEventListener('click', () => {
		if (isLastStage()) finish();
		else go(stage + 1);
	});

	const isLastStage = () => stage === stageCount() - 1;

	/** What each stage needs before it will let you move on. */
	const canLeaveStage = (): boolean => {
		if (stage === 0) return section !== NEW_CATEGORY_SENTINEL || newSection.trim().length > 0;
		if (stage === 1) return route !== null;
		if (route === 'new' && stage === 2) return picked !== null;
		if (route === 'custom' && stage === 2) return label.trim().length > 0;
		return true;
	};

	/**
	 * Same per-stage conditions as canLeaveStage(), but explains why when
	 * blocked, for the disabled Next button's tooltip. Kept as a separate
	 * function rather than changing canLeaveStage()'s return type, since
	 * canLeaveStage() has other callers that only want the boolean.
	 */
	const leaveStageBlockedReason = (): string | null => {
		if (stage === 0 && !(section !== NEW_CATEGORY_SENTINEL || newSection.trim().length > 0)) {
			return 'Name the new section first.';
		}
		if (stage === 1 && route === null) {
			return 'Pick a route first.';
		}
		if (route === 'new' && stage === 2 && picked === null) {
			return 'Pick a field first.';
		}
		if (route === 'custom' && stage === 2 && label.trim().length === 0) {
			return 'Enter a label first.';
		}
		return null;
	};

	/**
	 * Numbered dots joined by connectors; a finished step shows a tick.
	 * Rendered as `div[role=button]`, not `<button>` — Obsidian's own button
	 * skin paints a background/box-shadow behind real buttons that no CSS
	 * override on `.sg-fc-step` could beat, showing as a square behind the
	 * round dot. A div never picks up that skin, so it needs its own
	 * click + keyboard (Enter/Space) handling instead of getting it for free.
	 */
	const renderSteps = (): void => {
		stepsRow.empty();
		const total = stageCount();
		for (let i = 0; i < total; i++) {
			if (i > 0) {
				const line = stepsRow.createDiv({ cls: 'sg-fc-line' });
				line.toggleClass('is-done', i <= stage);
			}
			const done = i < stage;
			const b = stepsRow.createDiv({ cls: 'sg-fc-step', attr: { role: 'button', tabindex: done ? '0' : '-1' } });
			b.toggleClass('is-current', i === stage);
			b.toggleClass('is-done', done);
			b.toggleClass('is-clickable', done);
			b.setAttr('aria-label', `Step ${i + 1}`);
			b.createSpan({ cls: 'sg-fc-step-dot', text: done ? '✓' : String(i + 1) });
			// Only completed steps are reachable; jumping ahead would skip a
			// question the next stage depends on.
			const activate = () => { if (done) go(i); };
			b.addEventListener('click', activate);
			b.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
			});
		}
	};

	const syncChrome = (): void => {
		counter.setText(`Step ${stage + 1} of ${stageCount()}`);
		renderSteps();
		backBtn.style.visibility = stage === 0 ? 'hidden' : '';
		nextBtn.setText(isLastStage() ? 'Done' : 'Next');
		const blockedReason = leaveStageBlockedReason();
		nextBtn.toggleClass('is-disabled', blockedReason !== null);
		nextBtn.disabled = blockedReason !== null;
		setTooltip(nextBtn, blockedReason ?? '');
	};

	function go(next: number): void {
		if (next > stage && !canLeaveStage()) return;
		stage = Math.max(0, Math.min(stageCount() - 1, next));
		renderStage();
	}

	function finish(): void {
		if (!canLeaveStage()) return;
		// The "New" route's pick stage is also its last stage, so Done never
		// passes through renderStage()'s own teardown — release the portaled
		// dropdown panel and its 3 global listeners here too.
		selectHandle?.destroy();
		selectHandle = null;
		const resolvedSection = section === NEW_CATEGORY_SENTINEL ? newSection.trim() : section;
		const result: FieldCreatorResult =
			route === 'new' && picked
				? {
						label: picked.label,
						type: picked.type,
						prompt: picked.prompt,
						config: picked.config ?? defaultConfig(picked.type),
						category: resolvedSection || undefined,
					}
				: {
						label: label.trim(),
						type,
						prompt: prompt.trim() || undefined,
						config,
						category: resolvedSection || undefined,
					};
		// Fade before the sheet rebuilds, so the finished field appears to settle
		// into the space this card was holding.
		card.addClass('sg-fc-card--settling');
		window.setTimeout(() => options.onSubmit(result), 170);
	}

	/** Step 1 — which section does this field join? */
	function renderSectionStage(): void {
		body.createDiv({ cls: 'sg-fc-ask', text: 'Which section should it go in?' });
		const list = body.createDiv({ cls: 'sg-fc-choices' });
		const choices = [
			...sections.map((s) => ({ value: s, text: s })),
			{ value: NEW_CATEGORY_SENTINEL, text: '+ New section…' },
		];
		let nameInput: HTMLInputElement | null = null;
		const paint = () => {
			list.findAll('.sg-fc-choice').forEach((el) => {
				el.toggleClass('is-selected', el.getAttr('data-value') === section);
			});
			if (nameInput) nameInput.style.display = section === NEW_CATEGORY_SENTINEL ? '' : 'none';
			syncChrome();
		};
		for (const c of choices) {
			const btn = list.createEl('button', { cls: 'sg-fc-choice', text: c.text });
			btn.setAttr('data-value', c.value);
			btn.toggleClass('sg-fc-choice--new', c.value === NEW_CATEGORY_SENTINEL);
			btn.addEventListener('click', () => {
				section = c.value;
				paint();
				if (c.value === NEW_CATEGORY_SENTINEL) nameInput?.focus();
			});
		}
		nameInput = body.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
		nameInput.placeholder = 'Name the new section';
		nameInput.value = newSection;
		nameInput.addEventListener('input', () => { newSection = nameInput.value; syncChrome(); });
		paint();
	}

	/** Step 2 — a ready-made field, or one built from scratch? */
	function renderRouteStage(): void {
		body.createDiv({ cls: 'sg-fc-ask', text: 'How do you want to add it?' });
		const routes = body.createDiv({ cls: 'sg-fc-routes' });
		const mk = (value: Exclude<Route, null>, title: string, blurb: string) => {
			const disabled = value === 'new' && catalog.length === 0;
			const b = routes.createEl('button', { cls: 'sg-fc-route' });
			b.toggleClass('is-selected', route === value);
			b.createSpan({ cls: 'sg-fc-route-title', text: title });
			b.createSpan({
				cls: 'sg-fc-route-blurb',
				text: disabled ? 'Nothing left to add — every ready-made field is already here.' : blurb,
			});
			b.addEventListener('click', () => {
				route = value;
				// One click picks the route AND moves on — a second click on "Next"
				// to confirm a choice that only has two options was pure friction.
				go(stage + 1);
			});
			if (disabled) {
				b.disabled = true;
				b.addClass('is-disabled');
			}
		};
		mk('new', 'New', 'Pick a field that already exists.');
		mk('custom', 'Custom', 'Build a brand new field of your own.');
	}

	/**
	 * Step 3, "New" route — one searchable dropdown holding the whole
	 * category → field tree, rather than two chained pickers.
	 */
	function renderPickStage(): void {
		body.createDiv({ cls: 'sg-fc-ask', text: 'Which field?' });

		const options: SearchableOption[] = catalog.flatMap((category) =>
			category.fields.map((f) => ({
				value: `${category.title}::${f.label}`,
				label: f.label,
				group: category.title,
				hint: f.prompt,
			}))
		);

		const flat = catalog.flatMap((c) => c.fields);
		selectHandle = renderSearchableSelect(body, {
			options,
			placeholder: 'Choose a field…',
			searchPlaceholder: 'Search fields…',
			value: picked ? `${picked.category}::${picked.label}` : '',
			onChange: (value) => {
				const label = value.split('::')[1];
				const spec = flat.find((f) => f.label === label);
				picked = spec
					? { label: spec.label, type: spec.type, prompt: spec.prompt, config: spec.config, category: value.split('::')[0] }
					: null;
				syncChrome();
			},
		});
	}

	/** Step 3, "Custom" route — what it is called and what it asks. */
	function renderNameStage(): void {
		body.createDiv({ cls: 'sg-fc-ask', text: 'What should the field be called?' });
		const nameInput = body.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
		nameInput.placeholder = 'e.g. Childhood memories';
		nameInput.value = label;
		nameInput.addEventListener('input', () => { label = nameInput.value; syncChrome(); });
		nameInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && canLeaveStage()) { e.preventDefault(); go(stage + 1); }
		});

		body.createDiv({ cls: 'sg-fc-ask', text: 'What should its help text say?' });
		const helpInput = body.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
		helpInput.placeholder = 'e.g. What does she need?';
		helpInput.value = prompt;
		helpInput.addEventListener('input', () => { prompt = helpInput.value; });
		body.createDiv({
			cls: 'sg-fc-hint',
			text: 'Shown on the ⓘ beside the label — hover on a computer, tap on a phone.',
		});
		window.setTimeout(() => nameInput.focus(), 30);
	}

	/** Step 4, "Custom" route — the type, and whatever that type needs. */
	function renderTypeStage(): void {
		body.createDiv({ cls: 'sg-fc-ask', text: 'What kind of answer does it hold?' });
		const typeSelect = body.createEl('select', { cls: 'sg-sheet-rail-select sg-fc-select' });
		for (const t of FIELD_TYPES) {
			typeSelect.createEl('option', { text: FIELD_TYPE_LABELS[t], value: t });
		}
		typeSelect.value = type;

		const hint = body.createDiv({ cls: 'sg-fc-hint', text: FIELD_TYPE_HINTS[type] });
		const configHost = body.createDiv({ cls: 'sg-fc-config' });

		const paint = () => {
			type = typeSelect.value as FieldType;
			hint.setText(FIELD_TYPE_HINTS[type]);
			renderTypeConfigControls(configHost, type, undefined, (cfg) => { config = cfg; });
		};
		typeSelect.addEventListener('change', paint);
		paint();
	}

	function renderStage(): void {
		// Emptying the host detaches the dropdown but not its document-level
		// click listener, so release that first.
		selectHandle?.destroy();
		selectHandle = null;
		body.empty();
		syncChrome();
		if (stage === 0) return renderSectionStage();
		if (stage === 1) return renderRouteStage();
		if (route === 'new') return renderPickStage();
		if (stage === 2) return renderNameStage();
		return renderTypeStage();
	}

	renderStage();
	return card;
}
export function renderFieldCreatorCard(container: HTMLElement, options: FieldCreatorOptions): HTMLElement {
	if (options.staged) return renderStagedCard(container, options);

	const card = container.createDiv({ cls: 'sg-fc-card' });
	card.createDiv({ cls: 'sg-fc-title', text: options.title ?? 'New field' });

	const labelRow = card.createDiv({ cls: 'sg-fc-row' });
	labelRow.createDiv({ cls: 'sg-fc-label', text: 'Name' });
	const labelInput = labelRow.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
	labelInput.placeholder = 'Field name';

	const helpRow = card.createDiv({ cls: 'sg-fc-row' });
	helpRow.createDiv({ cls: 'sg-fc-label', text: 'Hover text' });
	const helpInput = helpRow.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
	helpInput.placeholder = 'Shown when someone hovers this field (optional)';

	const typeRow = card.createDiv({ cls: 'sg-fc-row' });
	typeRow.createDiv({ cls: 'sg-fc-label', text: 'Kind of block' });
	const typeSelect = typeRow.createEl('select', { cls: 'sg-sheet-field-typeselect' });
	for (const t of FIELD_TYPES) typeSelect.createEl('option', { text: FIELD_TYPE_LABELS[t], value: t });

	const configHost = card.createDiv({ cls: 'sg-fc-config' });
	let config: FieldConfig = defaultConfig('text');

	const renderConfig = () => {
		renderTypeConfigControls(configHost, typeSelect.value as FieldType, undefined, (cfg) => { config = cfg; });
	};
	typeSelect.addEventListener('change', renderConfig);
	renderConfig();

	const categoryRow = card.createDiv({ cls: 'sg-fc-row' });
	categoryRow.createDiv({ cls: 'sg-fc-label', text: 'Group' });
	const categorySelect = categoryRow.createEl('select', { cls: 'sg-sheet-rail-select' });
	categorySelect.createEl('option', { text: 'No group', value: '' });
	for (const c of options.categories) categorySelect.createEl('option', { text: c, value: c });
	categorySelect.createEl('option', { text: '+ New group…', value: NEW_CATEGORY_SENTINEL });
	const newCategoryInput = categoryRow.createEl('input', { cls: 'sg-sheet-field-input', type: 'text' });
	newCategoryInput.placeholder = 'Group name';
	newCategoryInput.hide();
	categorySelect.addEventListener('change', () => {
		newCategoryInput.style.display = categorySelect.value === NEW_CATEGORY_SENTINEL ? '' : 'none';
		if (categorySelect.value === NEW_CATEGORY_SENTINEL) newCategoryInput.focus();
	});

	const actions = card.createDiv({ cls: 'sg-fc-actions' });
	const cancelBtn = actions.createEl('button', { cls: 'sg-sheet-btn', text: 'Cancel' });
	cancelBtn.addEventListener('click', () => options.onCancel());
	const addBtn = actions.createEl('button', { cls: 'sg-sheet-btn sg-sheet-btn--primary', text: 'Add field' });
	addBtn.addEventListener('click', () => {
		const label = labelInput.value.trim();
		if (!label) { labelInput.focus(); return; }
		const category = categorySelect.value === NEW_CATEGORY_SENTINEL
			? newCategoryInput.value.trim()
			: categorySelect.value;
		options.onSubmit({
			label,
			type: typeSelect.value as FieldType,
			prompt: helpInput.value.trim() || undefined,
			config,
			category: category || undefined,
		});
	});

	window.setTimeout(() => labelInput.focus(), 30);
	return card;
}
