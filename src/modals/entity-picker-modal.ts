import { App, SuggestModal, TFile } from 'obsidian';
import { EntityKind, getKindSpec } from '../entities/entity-kinds';
import { listEntities, EntityInfo } from '../entities/entity-manager';

interface Sentinel { sentinel: true; kind: EntityKind }
type PickItem = EntityInfo | Sentinel;

/**
 * Reusable codex entity picker. Lists entities of one or more kinds with
 * fuzzy search. An optional "+ New [kind]..." sentinel lets callers open
 * EntityModal for quick inline creation — the caller handles the creation
 * logic (this modal stays dependency-free of EntityModal).
 */
export class EntityPickerModal extends SuggestModal<PickItem> {
	private readonly kinds: EntityKind[];
	private readonly onSelect: (file: TFile) => void;
	private readonly onNew: ((kind: EntityKind) => void) | null;
	private readonly allItems: PickItem[];

	constructor(
		app: App,
		projectRoot: string,
		kinds: EntityKind | EntityKind[],
		onSelect: (file: TFile) => void,
		onNew?: (kind: EntityKind) => void
	) {
		super(app);
		this.kinds = Array.isArray(kinds) ? kinds : [kinds];
		this.onSelect = onSelect;
		this.onNew = onNew ?? null;

		const label =
			this.kinds.length === 1
				? getKindSpec(this.kinds[0]).singular.toLowerCase()
				: 'entity';
		this.setPlaceholder(`Search for a ${label}…`);

		// Load and sort entities across all requested kinds
		const entities: EntityInfo[] = [];
		for (const k of this.kinds) {
			entities.push(...listEntities(app, projectRoot, k));
		}
		entities.sort((a, b) => a.name.localeCompare(b.name));

		// Sentinel items (one per kind) sit above entities when onNew is provided
		const sentinels: PickItem[] = onNew
			? this.kinds.map((kind) => ({ sentinel: true as const, kind }))
			: [];

		this.allItems = [...sentinels, ...entities];
	}

	getSuggestions(query: string): PickItem[] {
		const lower = query.trim().toLowerCase();
		if (!lower) return this.allItems;
		return this.allItems.filter((item) =>
			'sentinel' in item ? true : item.name.toLowerCase().includes(lower)
		);
	}

	renderSuggestion(item: PickItem, el: HTMLElement): void {
		if ('sentinel' in item) {
			const spec = getKindSpec(item.kind);
			el.addClass('sg-entity-picker-sentinel');
			el.createSpan({ cls: 'sg-entity-picker-sentinel-plus', text: '+' });
			el.createSpan({ cls: 'sg-entity-picker-sentinel-label', text: `New ${spec.singular}…` });
			return;
		}
		const spec = getKindSpec(item.kind);
		const nameRow = el.createDiv({ cls: 'sg-entity-picker-name-row' });
		nameRow.createSpan({ cls: 'sg-entity-picker-emoji', text: spec.fallbackIcon });
		nameRow.createSpan({ cls: 'sg-entity-picker-name', text: item.name });
		if (this.kinds.length > 1) {
			nameRow.createSpan({ cls: 'sg-entity-picker-kind-tag', text: spec.singular });
		}
		if (item.facts.length > 0) {
			el.createDiv({
				cls: 'sg-entity-picker-facts',
				text: item.facts
					.slice(0, 2)
					.map((f) => `${f.key}: ${f.value}`)
					.join(' · '),
			});
		}
	}

	onChooseSuggestion(item: PickItem): void {
		if ('sentinel' in item) {
			this.onNew?.(item.kind);
		} else {
			this.onSelect(item.file);
		}
	}
}
