import { App, SuggestModal, setIcon } from 'obsidian';
import { RelEntity } from '../utils/relations';
import { getKindSpec } from '../entities/entity-kinds';

/** Type-to-search focus picker for the Story Tree view, scoped to whichever entity kinds are relevant to the current mode. */
export class TreeFocusModal extends SuggestModal<RelEntity> {
	private candidates: RelEntity[];
	private onSelect: (entity: RelEntity) => void;

	constructor(app: App, candidates: RelEntity[], onSelect: (entity: RelEntity) => void, placeholder = 'Search for a person to focus on…') {
		super(app);
		this.candidates = candidates;
		this.onSelect = onSelect;
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): RelEntity[] {
		const lower = query.toLowerCase();
		return this.candidates
			.filter((e) => !query || e.name.toLowerCase().includes(lower))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	renderSuggestion(entity: RelEntity, el: HTMLElement): void {
		const spec = getKindSpec(entity.kind);
		const name = el.createDiv({ cls: 'sg-link-modal-name' });
		const iconEl = name.createSpan({ cls: 'sg-link-modal-icon' });
		setIcon(iconEl, spec.icon);
		if (!iconEl.querySelector('svg')) iconEl.textContent = spec.fallbackIcon;
		name.createSpan({ text: entity.name });
	}

	onChooseSuggestion(entity: RelEntity): void {
		this.onSelect(entity);
	}
}
