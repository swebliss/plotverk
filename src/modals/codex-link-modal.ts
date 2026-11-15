import { App, Platform, SuggestModal } from 'obsidian';
import { t } from '../i18n';
import { EntityKind, getCodexGroups, getCodexKindOrder, getKindSpec } from '../entities/entity-kinds';
import { listEntities, EntityInfo } from '../entities/entity-manager';

/** Kinds the card editor links in their own rows, never through the Codex picker. */
const NOT_FROM_CODEX: readonly string[] = ['character', 'scene'];
/** Retired kinds: no longer in the Codex sidebar, but old sheets of them must stay findable. */
const RETIRED_KINDS: readonly EntityKind[] = ['location', 'system', 'research'];

interface NewEntryRow { newEntry: true }
type CodexRow = EntityInfo | NewEntryRow;

/** Every Codex entry in the project a card can link to (no characters, no scenes), each once, by name. */
function linkableEntries(app: App, projectRoot: string): EntityInfo[] {
	const kinds = [...getCodexKindOrder(), ...RETIRED_KINDS].filter((k) => !NOT_FROM_CODEX.includes(k));
	const seen = new Set<string>();
	const out: EntityInfo[] = [];
	for (const kind of kinds) {
		if (seen.has(`kind:${kind}`)) continue;
		seen.add(`kind:${kind}`);
		for (const entry of listEntities(app, projectRoot, kind)) {
			if (seen.has(entry.file.path)) continue;
			seen.add(entry.file.path);
			out.push(entry);
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Link any number of Codex entries to a Plot Grid card. Choosing a row links
 * it, choosing it again unlinks it, and the picker stays open for the next
 * pick (Esc or a click outside closes it). The first row starts a new entry.
 */
export class CodexLinkModal extends SuggestModal<CodexRow> {
	private readonly allRows: CodexRow[];
	/** The element showing each entry, so a toggle can repaint just that row (the highlight stays put). */
	private readonly rowEls = new Map<string, HTMLElement>();

	constructor(
		app: App,
		projectRoot: string,
		private readonly isLinked: (path: string) => boolean,
		private readonly onToggle: (entry: EntityInfo) => void,
		private readonly onNew: () => void
	) {
		super(app);
		this.limit = 1000;
		this.setPlaceholder(t('grid.codexLink.placeholder'));
		this.setInstructions([
			{ command: '↵', purpose: t('grid.codexLink.instructionToggle') },
			{ command: 'esc', purpose: t('grid.codexLink.instructionDone') },
		]);
		this.modalEl.addClass('sg-codex-link-modal');
		this.allRows = [{ newEntry: true }, ...linkableEntries(app, projectRoot)];
	}

	getSuggestions(query: string): CodexRow[] {
		const lower = query.trim().toLowerCase();
		if (!lower) return this.allRows;
		// While searching, the matches come first, so Enter links the top match
		// instead of starting a new entry; "New Codex entry…" moves to the end.
		const matches = this.allRows.filter((row) =>
			!('newEntry' in row) &&
			(row.name.toLowerCase().includes(lower) || getKindSpec(row.kind).singular.toLowerCase().includes(lower))
		);
		return [...matches, { newEntry: true }];
	}

	renderSuggestion(row: CodexRow, el: HTMLElement): void {
		if ('newEntry' in row) {
			el.addClass('sg-entity-picker-sentinel');
			el.createSpan({ cls: 'sg-entity-picker-sentinel-plus', text: '+' });
			el.createSpan({ cls: 'sg-entity-picker-sentinel-label', text: t('grid.codexLink.newEntry') });
			return;
		}
		const spec = getKindSpec(row.kind);
		el.addClass('sg-codex-link-row');
		const nameRow = el.createDiv({ cls: 'sg-entity-picker-name-row' });
		nameRow.createSpan({ cls: 'sg-codex-link-check', attr: { 'aria-hidden': 'true' } });
		nameRow.createSpan({ cls: 'sg-entity-picker-emoji', text: spec.fallbackIcon });
		nameRow.createSpan({ cls: 'sg-entity-picker-name', text: row.name });
		nameRow.createSpan({ cls: 'sg-entity-picker-kind-tag', text: spec.singular });
		nameRow.createSpan({ cls: 'sg-codex-link-state', text: t('grid.codexLink.linked') });
		this.rowEls.set(row.file.path, el);
		this.paint(el, this.isLinked(row.file.path));
	}

	private paint(el: HTMLElement, linked: boolean): void {
		el.toggleClass('sg-codex-link-row--linked', linked);
		const check = el.querySelector('.sg-codex-link-check');
		if (check) check.textContent = linked ? '✓' : '';
	}

	/** Entries toggle and keep the picker open; only "New Codex entry…" closes it. */
	selectSuggestion(row: CodexRow, evt: MouseEvent | KeyboardEvent): void {
		if ('newEntry' in row) {
			super.selectSuggestion(row, evt);
			return;
		}
		this.onChooseSuggestion(row);
	}

	onChooseSuggestion(row: CodexRow): void {
		if ('newEntry' in row) {
			this.onNew();
			return;
		}
		this.onToggle(row);
		const el = this.rowEls.get(row.file.path);
		if (el?.isConnected) this.paint(el, this.isLinked(row.file.path));
		// A toggle can redraw the card editor behind the picker, which moves the cursor into
		// the card's synopsis; bring it back so further typing stays in the search. Desktop
		// only — on a phone this would pop the keyboard up after every tap.
		if (!Platform.isMobile) {
			window.requestAnimationFrame(() => {
				if (this.inputEl.isConnected) this.inputEl.focus();
			});
		}
	}
}

interface KindRow { kind: EntityKind; groupLabel: string }

/** Which kind of Codex entry to create — every Codex kind except characters and scenes. */
export class CodexKindPickerModal extends SuggestModal<KindRow> {
	private readonly rows: KindRow[];

	constructor(app: App, private readonly onPick: (kind: EntityKind) => void) {
		super(app);
		this.limit = 1000;
		this.setPlaceholder(t('grid.codexLink.kindPlaceholder'));
		this.rows = getCodexGroups().flatMap((g) =>
			g.kinds.filter((k) => !NOT_FROM_CODEX.includes(k)).map((kind) => ({ kind, groupLabel: g.label }))
		);
	}

	getSuggestions(query: string): KindRow[] {
		const lower = query.trim().toLowerCase();
		if (!lower) return this.rows;
		return this.rows.filter((r) =>
			getKindSpec(r.kind).singular.toLowerCase().includes(lower) || r.groupLabel.toLowerCase().includes(lower)
		);
	}

	renderSuggestion(row: KindRow, el: HTMLElement): void {
		const spec = getKindSpec(row.kind);
		const nameRow = el.createDiv({ cls: 'sg-entity-picker-name-row' });
		nameRow.createSpan({ cls: 'sg-entity-picker-emoji', text: spec.fallbackIcon });
		nameRow.createSpan({ cls: 'sg-entity-picker-name', text: spec.singular });
		nameRow.createSpan({ cls: 'sg-entity-picker-kind-tag', text: row.groupLabel });
	}

	onChooseSuggestion(row: KindRow): void {
		this.onPick(row.kind);
	}
}
