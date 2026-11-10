import { TFile } from 'obsidian';
import { getKindSpec } from '../entities/entity-kinds';
import type { EntityInfo } from '../entities/entity-manager';
import type StorygridPlugin from '../main';

const HIDE_DELAY_MS = 150;

// Last-known mouse position, tracked by one listener for the plugin's
// lifetime (registered in registerEntityHover) so `show()` can tell whether the cursor is already
// resting over the popover the instant it appears — browsers only fire
// `mouseenter` on actual pointer movement, so a stationary cursor would
// otherwise never cancel a pending hide and could flicker the popover shut.
let lastMouseX = 0;
let lastMouseY = 0;

// ─── Popover singleton ────────────────────────────────────────────────────────

export class EntityPopover {
	private el: HTMLDivElement;
	private hideTimer: number | null = null;
	private currentEntityId: string | null = null;

	constructor(private readonly plugin: StorygridPlugin) {
		this.el = activeDocument.body.createDiv({ cls: 'sg-entity-popover' });
		this.el.hide();
		this.el.addEventListener('mouseenter', () => this.cancelHide());
		this.el.addEventListener('mouseleave', () => this.scheduleHide());
	}

	show(entity: EntityInfo, anchorRect: DOMRect, anchorEl?: HTMLElement): void {
		this.cancelHide();
		if (this.currentEntityId === entity.entityId && this.el.style.display !== 'none') {
			// Same entity, but possibly a different link to it (the same character
			// can be mentioned twice on a page). Skip the rebuild — the contents are
			// identical — but re-run positioning, otherwise the popover stays parked
			// at the first link's coordinates and reads as a stuck/misplaced box.
			this.position(anchorRect);
			return;
		}
		this.currentEntityId = entity.entityId;
		this.build(entity);
		this.position(anchorRect);

		// If the cursor is already resting over the popover (or the anchor
		// that triggered it) without having moved since the popover appeared,
		// no mouseenter will fire to cancel a pending hide — check directly
		// and cancel one proactively so the popover doesn't flicker shut.
		const atRest = this.el.doc.elementFromPoint(lastMouseX, lastMouseY);
		if (
			atRest &&
			(atRest === this.el ||
				this.el.contains(atRest) ||
				(anchorEl && (atRest === anchorEl || anchorEl.contains(atRest))))
		) {
			this.cancelHide();
		}
	}

	scheduleHide(): void {
		this.cancelHide();
		this.hideTimer = window.setTimeout(() => {
			this.el.hide();
			this.currentEntityId = null;
		}, HIDE_DELAY_MS);
	}

	cancelHide(): void {
		if (this.hideTimer !== null) {
			window.clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
	}

	destroy(): void {
		this.cancelHide();
		this.el.remove();
	}

	private build(entity: EntityInfo): void {
		const { el } = this;
		el.empty();

		const spec = getKindSpec(entity.kind);

		// ── Header ───────────────────────────────────────────────────────────
		const header = el.createDiv({ cls: 'sg-ep-header' });

		if (entity.imagePath) {
			const imgFile = this.plugin.app.vault.getAbstractFileByPath(entity.imagePath);
			if (imgFile instanceof TFile) {
				const src = this.plugin.app.vault.getResourcePath(imgFile);
				const img = header.createEl('img', { cls: 'sg-ep-portrait' });
				img.src = src;
				img.alt = entity.name;
			}
		}

		const titleBlock = header.createDiv({ cls: 'sg-ep-title-block' });
		const nameRow = titleBlock.createDiv({ cls: 'sg-ep-name-row' });
		nameRow.createDiv({
			cls: `sg-ep-avatar sg-cs-kind--${entity.kind}`,
			text: spec.singular[0].toUpperCase(),
		});
		nameRow.createSpan({ cls: 'sg-ep-name', text: entity.name });
		titleBlock.createDiv({ cls: 'sg-ep-kind', text: spec.singular });

		// ── Facts ────────────────────────────────────────────────────────────
		if (entity.facts.length > 0) {
			const factsEl = el.createDiv({ cls: 'sg-ep-facts' });
			for (const fact of entity.facts.slice(0, 3)) {
				const row = factsEl.createDiv({ cls: 'sg-ep-fact-row' });
				row.createSpan({ cls: 'sg-ep-fact-key', text: fact.key });
				row.createSpan({ cls: 'sg-ep-fact-val', text: fact.value });
			}
		}

		// Show then measure for positioning
		el.show();
		el.addClass('sg-entity-popover--measuring');
	}

	private position(anchorRect: DOMRect): void {
		const { el } = this;
		const popW = el.offsetWidth || 220;
		const popH = el.offsetHeight || 80;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		// Keep this gap tiny (not 0) so a straight-line mouse path from the
		// anchor to the popover never crosses a dead zone wide enough for a
		// mouseleave to fire before the popover's own mouseenter takes over.
		let top = anchorRect.bottom + 2;
		let left = anchorRect.left;

		if (left + popW > vw - 8) left = vw - popW - 8;
		if (left < 8) left = 8;
		if (top + popH > vh - 8) top = anchorRect.top - popH - 2;

		el.style.top = `${top}px`;
		el.style.left = `${left}px`;
		el.removeClass('sg-entity-popover--measuring');
	}
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerEntityHover(plugin: StorygridPlugin): void {
	const popover = new EntityPopover(plugin);
	plugin.register(() => popover.destroy());

	plugin.registerDomEvent(activeDocument, 'mousemove', (e: MouseEvent) => {
		lastMouseX = e.clientX;
		lastMouseY = e.clientY;
	});

	plugin.registerDomEvent(activeDocument.body, 'mouseover', (e: MouseEvent) => {
		const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.internal-link');
		if (!link) return;

		const linktext = link.getAttribute('data-href') ?? link.getAttribute('href') ?? '';
		if (!linktext) return;

		const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? '';
		const resolved = plugin.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
		if (!resolved) return;

		const entityId = plugin.referenceIndex.getEntityIdForPath(resolved.path);
		if (!entityId) return;

		const entity = plugin.entityIndex.getAllEntities().find((en) => en.entityId === entityId);
		if (!entity) return;

		popover.show(entity, link.getBoundingClientRect(), link);
	});

	plugin.registerDomEvent(activeDocument.body, 'mouseout', (e: MouseEvent) => {
		const link = (e.target as HTMLElement).closest('a.internal-link');
		if (link) popover.scheduleHide();
	});
}
