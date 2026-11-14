import { plotverkEvents } from './utils/plotverk-events';
import { ItemView, WorkspaceLeaf, TFile, Notice, Menu, FuzzySuggestModal, App, MarkdownRenderer, Platform, ViewStateResult } from 'obsidian';
import type StorygridPlugin from './main';
import type { SocialMapsTab } from './social-maps-view';
import { setPhosphorIcon, GRID_VIEW_ICON } from './utils/icons';
import { reportError, runSafely } from './utils/report-error';
import { CharacterField, CharacterFieldTemplate, GridData } from './grid-data';
import { ERA_SHEET, EntityKind, UNTYPED_KIND, getKindSpec, getCodexKindOrder, getCodexGroups, groupFieldsIntoSections } from './entities/entity-kinds';
import { isEraHowLong } from './timeline/timeline-eras';
import { buildRelationGraph, RelEntity, nonRelationText, parseRelationLines, relationChoices, fieldsToRelationSections, partitionRelationLines, classifyRelation, buildCustomRegistry, RELATIONSHIP_TYPE_OTHER, RelationLine } from './utils/relations';
import {
	StoryProject,
	EntityInfo,
	findCodexScopes,
	createEntityFile,
	kindForFile,
} from './entities/entity-manager';
import { parseEntityDocument, mergeWithSpecDefaults } from './entities/entity-parse';
import { updateEntitySheet } from './entities/entity-write';
import { renameEntitySheet, sheetFileName, sheetNameTaken, sheetPathFor } from './entities/sheet-rename';
import { buildEntityTree, descendantNames, EntityTreeNode } from './entities/entity-tree';
import { EntityModal } from './modals/entity-modal';
import { TextPromptModal, ConfirmModal } from './modals/prompt-modal';
import { openOrReveal } from './utils/workspace';
import { isSafetyNetPath } from './utils/safety-paths';
import { VirtualScroller } from './ui/virtual-scroller';
import { renderFieldWidget } from './ui/field-widgets';
import {
	appendSheetImage,
	imagesFromDataTransfer,
	isSheetOwnImage,
	listSheetImages,
	removalFor,
	removeSheetImage,
	resolveImageField,
	saveImageForSheet,
	sheetDeletePlan,
	trashSheet,
	targetForSheet,
	useAsPortrait,
} from './entities/sheet-images';
import { t } from './i18n';
import { isFamilyGroup, hasFamilyTie } from './utils/story-tree';
import { isEchoOfEarlierField } from './entities/field-types';

export const VIEW_TYPE_CODEX = 'storygrid-codex-view';

/** Above this many items, the list/tiles view switches to windowed virtualization. */
const VIRTUALIZE_MIN = 80;
/** Fixed row height (px) for virtualized list rows — must match CSS. Desktop. */
const VIRTUAL_ROW_H = 56;
/** Taller touch row height on mobile (easier tap target). Must match CSS. */
const VIRTUAL_ROW_H_MOBILE = 64;
/** Extra rows rendered above/below the viewport on desktop. */
const VIRTUAL_OVERSCAN = 4;
/**
 * Larger overscan on mobile: iOS momentum scroll can travel 300+ px between
 * rAF ticks, so a small overscan would recycle rows that are still drifting
 * into view — this eliminates the flash-of-empty-row glitch.
 */
const VIRTUAL_OVERSCAN_MOBILE = 10;
/** Fixed card height (px) for virtualized tile grids — must match CSS. Desktop. */
const VIRTUAL_CARD_H = 240;
/** Shorter card on mobile. Must match CSS. */
const VIRTUAL_CARD_H_MOBILE = 200;
/** Taller card for portrait kinds (character/faction) — the overlapping photo adds height. Must match CSS. */
const VIRTUAL_CARD_H_PORTRAIT = 290;
const VIRTUAL_CARD_H_PORTRAIT_MOBILE = 270;
/** Gap between cards (px) — matches gap: 14px on .sg-codex-grid--tiles. */
const VIRTUAL_CARD_GAP = 14;
/** Minimum card width (px) — matches minmax(210px, 1fr) in .sg-codex-grid--tiles. */
const VIRTUAL_CARD_MIN_W = 210;
/** Narrower track for portrait cards (~20% narrower) — matches .sg-codex-grid--portrait. */
const VIRTUAL_CARD_MIN_W_PORTRAIT = 168;

/** One card appearance of a character inside a grid, in story order. */
interface Appearance {
	gridName: string;
	gridPath: string;
	cardTitle: string;
	columnLabel: string;
	order: number;
}

/** The Social Maps tab an entry page was opened from, and which of its two tabs. */
export interface CodexOrigin {
	leaf: WorkspaceLeaf;
	tab: SocialMapsTab;
}

/**
 * The Codex — a per-project worldbuilding hub.
 * Browse, search, create, and open Characters, Locations, Factions,
 * Systems, Items, and Scenes as a visual card gallery.
 */
export class StorygridCodexView extends ItemView {
	private plugin: StorygridPlugin;
	private projectRoot: string | null = null;
	private activeKind: EntityKind = 'character';
	/**
	 * Sidebar group ids the user has opened. Opt-IN, not opt-out: the sidebar
	 * starts fully folded for a clean overview, and nothing ever force-opens a
	 * group — otherwise selecting a kind would make its group impossible to fold.
	 */
	private expandedGroups: Set<string> = new Set();
	private searchQuery: string = '';
	/** characterFilePath → ordered appearances across this project's grids */
	private appearanceIndex: Map<string, Appearance[]> = new Map();
	private refreshTimer: number | null = null;
	private _projectChangedHandler: (() => void) | null = null;
	/** File paths of location tree nodes the user has folded shut */
	private collapsedLocations: Set<string> = new Set();
	/** When set, the Codex shows this entity's rendered detail page instead of the gallery */
	private detailPath: string | null = null;
	/** Whether the sheet page's "Images" section is unfolded (folded by default; kept across re-renders). */
	private imagesOpen = false;
	/** Set only when the entry was opened from Social Maps; powers the "Back to …" button. Never saved in view state. */
	private origin: CodexOrigin | null = null;
	/** Entries left by clicking a relationship chip, newest last: "Back to <name>" walks them back. */
	private cameFrom: string[] = [];
	/** Gallery layout: 'tiles' (default card grid) or 'list' (detail rows) */
	private viewMode: 'tiles' | 'list' = 'tiles';
	/** Active windowed scroller for the list view (large collections only) */
	private galleryScroller: VirtualScroller | null = null;
	/** Watches the gallery container so the JS-computed column count in the
	 *  virtualized tile-grid branch of renderGallery() doesn't go stale after
	 *  a window/pane resize. */
	private galleryResizeObserver: ResizeObserver | null = null;
	private galleryResizeTimer: number | null = null;
	private lastGalleryWidth: number | null = null;
	/** Cache for getDisplayText() — see cachedProjectForDisplay(). undefined means "not yet computed". */
	private _displayProjectCache: StoryProject | null | undefined = undefined;
	private _displayProjectActiveRootSeen: string | undefined = undefined;
	/** Set true by the vault listeners in onOpen() on any create/delete/rename
	 *  that could add/remove/move a project; forces cachedProjectForDisplay()
	 *  to recompute on the next getDisplayText() call. */
	private _projectsDirty = true;

	/** Returns the natural view mode for a kind based on its displayShape spec. */
	private defaultViewModeForKind(kind: EntityKind): 'tiles' | 'list' {
		return getKindSpec(kind).displayShape === 'row' ? 'list' : 'tiles';
	}

	/** People/group kinds use the overlapping-portrait card (round photo above the card). */
	private isPortraitKind(kind: EntityKind): boolean {
		return kind === 'character' || kind === 'faction';
	}

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CODEX;
	}

	getDisplayText(): string {
		const project = this.cachedProjectForDisplay();
		return project ? t('codex.tabTitleWithProject', { name: project.name }) : t('codex.title');
	}

	getIcon(): string {
		return 'sg-globe';
	}

	// ─── Lifecycle / state ─────────────────────────────────────────────────────

	/**
	 * Does a changed vault path matter to the project currently on screen?
	 * Gates the vault/metadataCache listeners below so an edit anywhere else
	 * in the vault doesn't force a full Codex rebuild. Same prefix-match
	 * convention currentProject() uses further down; mirrors touchesScope()
	 * in social-maps-view.ts, adapted to this view's projectRoot.
	 */
	private touchesScope(path: string): boolean {
		if (isSafetyNetPath(path)) return false;
		if (!this.projectRoot) return true;
		return (
			path === this.projectRoot ||
			path.startsWith(this.projectRoot + '/') ||
			this.projectRoot.startsWith(path + '/')
		);
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('sg-codex-root');

		// Re-render when files change so the gallery stays live. Gated by
		// touchesScope() so an edit anywhere else in the vault doesn't force a
		// full teardown/rebuild of a Codex that isn't showing that project.
		const scheduleRefresh = () => {
			if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
			this.refreshTimer = window.setTimeout(() => { void this.renderAll(); }, 400);
		};
		this.registerEvent(this.app.vault.on('create', (f) => {
			this._projectsDirty = true;
			if (this.touchesScope(f.path)) scheduleRefresh();
		}));
		this.registerEvent(this.app.vault.on('delete', (f) => {
			this._projectsDirty = true;
			if (this.touchesScope(f.path)) scheduleRefresh();
		}));
		this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
			this._projectsDirty = true;
			if (this.touchesScope(f.path) || this.touchesScope(oldPath)) scheduleRefresh();
		}));
		this.registerEvent(this.app.metadataCache.on('changed', (f) => {
			if (this.touchesScope(f.path)) scheduleRefresh();
		}));

		this._projectChangedHandler = () => {
			this.projectRoot = '';
			void this.renderAll();
		};
		plotverkEvents.addEventListener('storygrid:project-changed', this._projectChangedHandler);

		// Paste a picture while a sheet is open here (Ctrl+V / Cmd+V, or the
		// paste box on a phone): it joins that sheet's images.
		this.registerDomEvent(this.containerEl.doc, 'paste', (e: ClipboardEvent) => this.handleImagePaste(e));

		await this.renderAll();
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
		this.galleryScroller?.destroy();
		this.galleryScroller = null;
		this.galleryResizeObserver?.disconnect();
		this.galleryResizeObserver = null;
		if (this.galleryResizeTimer) window.clearTimeout(this.galleryResizeTimer);
		if (this._projectChangedHandler) {
			plotverkEvents.removeEventListener('storygrid:project-changed', this._projectChangedHandler);
			this._projectChangedHandler = null;
		}
	}

	getState(): Record<string, unknown> {
		return { projectRoot: this.projectRoot, activeKind: this.activeKind, detailPath: this.detailPath };
	}

	async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
		if (state && typeof state['projectRoot'] === 'string') {
			this.projectRoot = state['projectRoot'];
		}
		if (state && typeof state['activeKind'] === 'string') {
			this.activeKind = state['activeKind'];
			this.viewMode = this.defaultViewModeForKind(this.activeKind);
			this.revealKindInSidebar(this.activeKind);
		}
		if (state && typeof state['detailPath'] === 'string') {
			this.detailPath = state['detailPath'];
			this.cameFrom = [];
		}
		await this.renderAll();
		await super.setState(state, result);
	}

	/** Switch the Codex to the rendered detail page for an entity. */
	private showDetail(entity: EntityInfo): void {
		this.detailPath = entity.file.path;
		this.origin = null;
		this.cameFrom = [];
		void this.renderAll();
	}

	/** Used by the plugin to point an existing codex tab at a project. */
	/**
	 * Open the sidebar group that owns `kind`, so a programmatic jump doesn't
	 * land the user on a kind they cannot see in the nav. Only called for
	 * navigation — never from render, which would defeat manual folding.
	 */
	private revealKindInSidebar(kind: EntityKind): void {
		const group = getCodexGroups().find((g) => g.kinds.includes(kind));
		if (group) this.expandedGroups.add(group.id);
	}

	async showProject(projectRoot: string): Promise<void> {
		this.projectRoot = projectRoot;
		await this.renderAll();
	}

	/** Navigate to the detail page for a specific entity file path (called externally). */
	async openEntityDetail(filePath: string, origin?: CodexOrigin): Promise<void> {
		this.detailPath = filePath;
		this.origin = origin ?? null;
		this.cameFrom = [];
		void this.renderAll();
	}

	/** Reset to the gallery (clears any open detail page). Called when the user asks to open the Codex without a specific entity. */
	goHome(): void {
		this.detailPath = null;
		this.origin = null;
		this.cameFrom = [];
		void this.renderAll();
	}

	/**
	 * Cheap, side-effect-free read for getDisplayText() — Obsidian calls that
	 * for every tab-title render, and currentProject() below does a
	 * vault-wide scope scan and mutates this.projectRoot, which is wasteful
	 * (and semantically wrong for a "getter") to redo on every call. Only
	 * recomputes when the Dashboard's active project changed, or a vault
	 * event that could affect project discovery fired since the last call
	 * (see _projectsDirty, set in onOpen()'s vault listeners above).
	 */
	private cachedProjectForDisplay(): StoryProject | null {
		const activeRoot = this.plugin.settings.activeProjectRoot;
		if (
			this._displayProjectCache === undefined ||
			this._projectsDirty ||
			activeRoot !== this._displayProjectActiveRootSeen
		) {
			this._displayProjectCache = this.currentProject();
			this._displayProjectActiveRootSeen = activeRoot;
			this._projectsDirty = false;
		}
		return this._displayProjectCache;
	}

	private currentProject(): StoryProject | null {
		const scopes = findCodexScopes(this.app, this.plugin.settings);
		if (scopes.length === 0) return null;

		// Dashboard-selected project is the primary source of truth
		const activeRoot = this.plugin.settings.activeProjectRoot;
		if (activeRoot) {
			const fromDash = scopes.find((p) => p.rootPath === activeRoot)
				?? scopes.find((p) => activeRoot.startsWith(p.rootPath + '/'));
			if (fromDash) {
				this.projectRoot = fromDash.rootPath;
				return fromDash;
			}
		}

		// Exact match on the locally stored root (workspace restore / setState)
		const exact = scopes.find((p) => p.rootPath === this.projectRoot);
		if (exact) return exact;

		// In series mode: resolve up to parent series scope
		if (this.plugin.settings.isSeriesMode && this.projectRoot) {
			const root = this.projectRoot;
			const parent = scopes.find(
				(p) => root === p.rootPath ||
					root.startsWith(p.rootPath + '/')
			);
			if (parent) {
				this.projectRoot = parent.rootPath;
				return parent;
			}
		}

		// Final fallback: active series, then first
		const activeSeriesId = this.plugin.settings.activeSeriesId;
		if (this.plugin.settings.isSeriesMode && activeSeriesId) {
			const sr = this.plugin.settings.seriesRegistry?.[activeSeriesId];
			const activeScope = sr ? scopes.find((p) => p.rootPath === sr.rootPath) : null;
			if (activeScope) {
				this.projectRoot = activeScope.rootPath;
				return activeScope;
			}
		}

		this.projectRoot = scopes[0].rootPath;
		return scopes[0];
	}

	// ─── Appearance index (character → scene cards across grids) ──────────────

	private async buildAppearanceIndex(project: StoryProject): Promise<void> {
		this.appearanceIndex = new Map();
		for (const gridFile of project.gridFiles) {
			let grid: GridData;
			try {
				grid = JSON.parse(await this.app.vault.read(gridFile)) as GridData;
			} catch {
				continue;
			}
			// A grid file whose content parses to `null` (or any non-object) would
			// otherwise throw on the very next line reading `.columns` off it —
			// and since renderAll() empties the container before awaiting this
			// function, that uncaught exception left the whole Codex blank.
			if (!grid || typeof grid !== 'object') continue;
			const colOrder = new Map<string, { order: number; label: string }>();
			(grid.columns ?? []).forEach((c) => colOrder.set(c.id, { order: c.order, label: c.label }));

			for (const card of grid.cards ?? []) {
				for (const charPath of card.characterPaths ?? []) {
					const col = colOrder.get(card.colId);
					const list = this.appearanceIndex.get(charPath) ?? [];
					list.push({
						gridName: grid.name,
						gridPath: gridFile.path,
						cardTitle: card.title || t('codex.card.untitled'),
						columnLabel: col?.label ?? '',
						order: col?.order ?? 999,
					});
					this.appearanceIndex.set(charPath, list);
				}
			}
		}
		for (const list of this.appearanceIndex.values()) {
			list.sort((a, b) => a.order - b.order);
		}
	}

	// ─── Rendering ─────────────────────────────────────────────────────────────

	/** Bumped on every render; stale async renders bail out instead of
	 *  appending a second copy of the page after a newer render finished. */
	private _renderGen = 0;

	private async renderAll(): Promise<void> {
		const gen = ++this._renderGen;
		const el = this.contentEl;
		el.empty();

		const project = this.currentProject();
		if (!project) {
			this.renderNoProjects(el);
			return;
		}

		await this.buildAppearanceIndex(project);
		if (gen !== this._renderGen) return;

		// Detail mode: a single entity's rendered page replaces the gallery.
		if (this.detailPath) {
			const file = this.app.vault.getAbstractFileByPath(this.detailPath);
			if (file instanceof TFile) {
				await this.renderDetail(el, file);
				return;
			}
			this.detailPath = null; // file vanished — fall back to the gallery
		}

		this.renderHeader(el, project);
		this.renderIntro(el);

		const body = el.createDiv({ cls: 'sg-codex-body' });
		this.renderSidebar(body, project);
		this.renderGallery(body, project);
		if (Platform.isPhone && this.phoneNavOpen) this.renderPhoneNavSheet(el, project);
	}

	// ─── Phone menu — a ☰ button next to the section heading + bottom sheet ─────

	/** Whether the phone menu sheet is open; kept across re-renders (picking a kind or a background refresh re-renders). */
	private phoneNavOpen = false;
	private phoneNavScrollTop = 0;
	/** The sheet already slid in — later re-renders (background refresh) show it without replaying the animation. */
	private phoneNavShown = false;

	/** Phones hide the sidebar; this boxed ☰ sits left of the "Characters" heading (no extra bar). */
	private renderPhoneNavButton(el: HTMLElement, spec: ReturnType<typeof getKindSpec>): void {
		const btn = el.createEl('button', {
			cls: 'sg-codex-phone-nav',
			attr: { type: 'button', 'aria-haspopup': 'dialog', 'aria-label': t('codex.phoneNav.aria', { plural: spec.plural }) },
		});
		setPhosphorIcon(btn, 'list', '☰');
		btn.addEventListener('click', () => {
			// Open with the current kind's group unfolded, so "you are here" is visible.
			const group = getCodexGroups().find((g) => g.kinds.includes(this.activeKind));
			if (group) this.expandedGroups.add(group.id);
			this.phoneNavOpen = true;
			this.phoneNavShown = false;
			this.phoneNavScrollTop = 0;
			void this.renderAll();
		});
	}

	private renderPhoneNavSheet(el: HTMLElement, project: StoryProject): void {
		const close = () => { this.phoneNavOpen = false; void this.renderAll(); };
		const instant = this.phoneNavShown;
		this.phoneNavShown = true;
		const backdrop = el.createDiv({ cls: 'sg-codex-phone-sheet-backdrop' });
		if (instant) backdrop.addClass('is-instant');
		backdrop.addEventListener('click', close);
		const sheet = el.createDiv({ cls: 'sg-codex-phone-sheet', attr: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('codex.phoneNav.title') } });
		if (instant) sheet.addClass('is-instant');
		sheet.createDiv({ cls: 'sg-codex-phone-sheet-grip' });
		const head = sheet.createDiv({ cls: 'sg-codex-phone-sheet-head' });
		head.createEl('h3', { text: t('codex.phoneNav.title') });
		const x = head.createEl('button', { cls: 'sg-codex-phone-sheet-close clickable-icon', attr: { type: 'button', 'aria-label': t('codex.phoneNav.close') } });
		setPhosphorIcon(x, 'x', '×');
		x.addEventListener('click', close);
		const list = sheet.createDiv({ cls: 'sg-codex-phone-sheet-list' });
		this.renderNavTree(list, project, () => { this.phoneNavOpen = false; });
		// A full re-render (background refresh) rebuilds the sheet: keep the list where the thumb left it.
		list.scrollTop = this.phoneNavScrollTop;
		list.addEventListener('scroll', () => { this.phoneNavScrollTop = list.scrollTop; });
	}

	// ─── Detail page — a custom rendered entity sheet (no markdown tab) ─────────

	/** A sheet's picture when it has none of its own: its kind's icon — or the hourglass for an Event sheet that is an era (How Long = "An era"), so eras stand out among the events. */
	private sheetIcon(file: TFile, spec: ReturnType<typeof getKindSpec>): { icon: string; fallbackIcon: string; label?: string } {
		if (spec.kind === 'event' && isEraHowLong(this.app.metadataCache.getFileCache(file)?.frontmatter?.['how-long'])) {
			return { icon: ERA_SHEET.icon, fallbackIcon: ERA_SHEET.fallbackIcon, label: t('timeline.key.era') };
		}
		return { icon: spec.icon, fallbackIcon: spec.fallbackIcon };
	}

	private async renderDetail(el: HTMLElement, file: TFile): Promise<void> {
		const gen = this._renderGen;
		let content: string;
		try {
			content = await this.app.vault.read(file);
		} catch {
			this.detailPath = null;
			await this.renderAll();
			return;
		}
		if (gen !== this._renderGen) return;
		const parsed = parseEntityDocument(content, file.basename);
		// The sheet's own type wins; an untyped one counts as the kind of folder it
		// sits in. Never 'character' by default — Edit would re-save it as one.
		const kind = parsed.kind ?? kindForFile(this.app, file) ?? UNTYPED_KIND;
		const spec = getKindSpec(kind);
		// Merge against the spec so empty (unwritten) fields are known — they
		// power the "not written yet" chips and the completion meter.
		const fields = mergeWithSpecDefaults(kind, parsed.fields, parsed.cleanSlate);
		const entity: EntityInfo = {
			file, kind, name: parsed.name, facts: [], imagePath: null, parent: null, entityId: null,
		};

		const page = el.createDiv({ cls: `sg-detail sg-detail--${kind}` });

		// ── Banner: back · kind chip · actions (name lives in the hero) ────────
		const band = page.createDiv({ cls: 'sg-detail-band' });
		const goBack = () => { this.detailPath = null; this.origin = null; this.cameFrom = []; this.activeKind = kind; void this.renderAll(); };

		// Came from Social Maps? Offer the way back — unless that tab has been closed since.
		const origin = this.origin;
		if (origin && this.plugin.isSocialMapsLeafOpen(origin.leaf)) {
			const label = t(origin.tab === 'tree' ? 'codex.detail.backToStoryTree' : 'codex.detail.backToConnectionsMap');
			band.addClass('sg-detail-band--has-origin');
			const backToMaps = band.createEl('button', { cls: 'sg-detail-back sg-detail-back--origin', title: label });
			setPhosphorIcon(backToMaps.createSpan(), 'arrow-left', '‹');
			backToMaps.createSpan({ text: label });
			backToMaps.addEventListener('click', () => this.plugin.returnToSocialMaps(origin.leaf, origin.tab));
		}

		// Arrived by clicking a relationship chip: back to the entry it was on.
		const prevPath = this.cameFrom[this.cameFrom.length - 1];
		const prevFile = prevPath ? this.app.vault.getAbstractFileByPath(prevPath) : null;
		if (prevFile instanceof TFile) {
			const label = t('codex.detail.backToEntry', { name: prevFile.basename });
			band.addClass('sg-detail-band--has-origin');
			const backToEntry = band.createEl('button', { cls: 'sg-detail-back sg-detail-back--origin', title: label });
			setPhosphorIcon(backToEntry.createSpan(), 'arrow-left', '‹');
			backToEntry.createSpan({ text: label });
			backToEntry.addEventListener('click', () => {
				this.cameFrom.pop();
				this.detailPath = prevFile.path;
				void this.renderAll();
			});
		}

		const back = band.createEl('button', { cls: 'sg-detail-back', title: t('codex.detail.backTo', { plural: spec.plural }) });
		setPhosphorIcon(back.createSpan(), 'arrow-left', '‹');
		back.createSpan({ text: spec.plural });
		back.addEventListener('click', goBack);

		const chip = band.createDiv({ cls: 'sg-detail-chip', attr: { role: 'button', tabindex: '0', 'aria-label': t('codex.detail.backTo', { plural: spec.plural }), title: t('codex.detail.backTo', { plural: spec.plural }) } });
		setPhosphorIcon(chip, spec.icon, spec.fallbackIcon);
		chip.addEventListener('click', goBack);
		chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goBack(); } });

		band.createDiv({ cls: 'sg-detail-name', text: parsed.name });

		band.createDiv({ cls: 'sg-detail-band-spacer' });

		// A Bloodline (or a faction whose Type says Family / House): open its family in the Story Tree.
		const projectRoot = this.projectRoot;
		if (projectRoot && isFamilyGroup(kind, fields)) {
			band.addClass('sg-detail-band--has-tree');
			const treeBtn = band.createEl('button', { cls: 'sg-detail-action sg-detail-action--tree' });
			setPhosphorIcon(treeBtn.createSpan(), 'tree-structure', '⌥');
			treeBtn.createSpan({ text: t('codex.detail.viewFamilyTree') });
			treeBtn.addEventListener('click', () => void this.plugin.openFamilyTree(projectRoot, file.path));
		}

		// A character with family on either sheet: open the Family tree focused on them.
		// Shown once the project's sheets are read, so it never offers an empty tree.
		if (projectRoot && kind === 'character') {
			band.addClass('sg-detail-band--has-tree');
			const personBtn = band.createEl('button', { cls: 'sg-detail-action sg-detail-action--tree' });
			setPhosphorIcon(personBtn.createSpan(), 'tree-structure', '⌥');
			personBtn.createSpan({ text: t('codex.detail.viewFamilyTree') });
			personBtn.addEventListener('click', () => void this.plugin.openPersonFamilyTree(projectRoot, file.path));
			personBtn.hide();
			void this.hasFamilyInProject(projectRoot, file.path).then((yes) => { if (yes) personBtn.show(); });
		}

		// Every faction: open its own org chart in the Story Tree (after the family button when both apply).
		if (projectRoot && kind === 'faction') {
			band.addClass('sg-detail-band--has-tree');
			const factionBtn = band.createEl('button', { cls: 'sg-detail-action sg-detail-action--tree' });
			setPhosphorIcon(factionBtn.createSpan(), 'users-three', '⌥');
			factionBtn.createSpan({ text: t('codex.detail.viewFactionTree') });
			factionBtn.addEventListener('click', () => void this.plugin.openFactionTree(projectRoot, file.path));
		}

		const editBtn = band.createEl('button', { cls: 'sg-detail-action sg-detail-action--primary', text: t('codex.detail.edit') });
		editBtn.addEventListener('click', () => { runSafely(this.editEntity(entity)); });

		const moreBtn = band.createEl('button', { cls: 'sg-detail-action', title: t('codex.detail.more'), attr: { 'aria-label': t('codex.detail.more') } });
		setPhosphorIcon(moreBtn, 'dots-three', '⋯');
		moreBtn.addEventListener('click', (e) => this.showDetailMenu(e, entity));

		const quoteField = fields.find(
			(f) => (f.type === 'text') && f.value.trim() &&
				/one[- ]line|one sentence|essence|motto|creed|core belief|in one/i.test(f.label)
		);
		const heroSpecs = spec.heroFields ?? [];
		const heroLabels = new Set(heroSpecs.map((h) => h.label));
		const nameLabels = ['Full Name', 'Name', 'Title', 'Topic'];

		// ── Hero: portrait · name · vitals line · essence · completion ─────────
		const hero = page.createDiv({ cls: 'sg-detail-hero' });
		const imageField = fields.find((f) => f.type === 'image' && f.value.trim());
		const portrait = hero.createDiv({ cls: 'sg-detail-portrait' });
		const imgFile = imageField ? resolveImageField(this.app, imageField.value, file.path) : null;
		if (imgFile instanceof TFile) {
			portrait.createEl('img', { attr: { src: this.app.vault.getResourcePath(imgFile), alt: parsed.name } });
		} else {
			const ph = portrait.createDiv({ cls: 'sg-detail-portrait-ph' });
			const look = this.sheetIcon(file, spec);
			setPhosphorIcon(ph, look.icon, look.fallbackIcon);
		}

		const heroInfo = hero.createDiv({ cls: 'sg-detail-hero-info' });
		const heroTop = heroInfo.createDiv({ cls: 'sg-detail-hero-top' });
		heroTop.createSpan({ cls: 'sg-detail-hero-name', text: parsed.name });
		heroTop.createSpan({ cls: 'sg-detail-hero-kind', text: spec.singular });
		// A short identity line from the first couple of filled vitals (Role · Age)
		const vitalsInline = fields
			.filter((f) => f.type === 'text' && f.value.trim() &&
				!nameLabels.includes(f.label) && f !== quoteField && !heroLabels.has(f.label))
			.slice(0, 2)
			.map((f) => f.value.trim());
		if (vitalsInline.length > 0) {
			heroTop.createSpan({ cls: 'sg-detail-hero-sub', text: vitalsInline.join(' · ') });
		}
		if (quoteField) {
			heroInfo.createDiv({ cls: 'sg-detail-quote', text: `“${quoteField.value.trim()}”` });
		}
		this.renderImagesSection(page, file);

		const grid = page.createDiv({ cls: 'sg-detail-grid' });

		// ── Aside: vitals + appearances ─────────────────────────────────────────
		const aside = grid.createDiv({ cls: 'sg-detail-aside' });
		// Block types (prose, lists, tables) need the full width of the main column;
		// only single-value fields belong in the narrow Vitals rail. And only the
		// kind's OWN built-in fields belong in Vitals at all — same rule the editor's
		// rail already follows (railFactFields in entity-modal.ts). A field you add
		// with the field builder keeps its own titled section instead, in whatever
		// category you actually filed it under; before this it landed in Vitals no
		// matter what section you picked, because this filter didn't check.
		const isBlock = (f: CharacterField) =>
			f.type === 'textarea' || f.type === 'list' || f.type === 'table';
		const defaultLabels = new Set(spec.defaultFields.map((d) => d.label));
		const factFields = fields.filter(
			(f) => !isBlock(f) && f.type !== 'image' && f.value.trim() && defaultLabels.has(f.label) &&
				!nameLabels.includes(f.label) && f !== quoteField && !heroLabels.has(f.label)
		);
		if (factFields.length > 0) {
			const box = aside.createDiv({ cls: 'sg-detail-facts' });
			box.createDiv({ cls: 'sg-detail-facts-title', text: t('codex.detail.vitalsTitle') });
			for (const f of factFields) {
				const row = box.createDiv({ cls: 'sg-detail-fact' });
				if (f.config?.tint) row.setAttr('data-tint', f.config.tint);
				const key = row.createDiv({ cls: 'sg-detail-fact-key', text: f.label });
				// The field's craft question, shown on hover. A visible ⓘ on every
				// row would clutter a page meant to be scanned at a glance.
				if (f.prompt) key.setAttr('title', f.prompt);
				const val = row.createDiv({ cls: 'sg-detail-fact-val' });
				if (f.type === 'text') {
					this.renderInline(val, f.value, file.path);
				} else {
					renderFieldWidget(val, f, 'read', { app: this.app, onChange: () => {} });
				}
			}
		}

		// Character appearances across grids
		if (kind === 'character') {
			const appearances = this.appearanceIndex.get(file.path) ?? [];
			if (appearances.length > 0) {
				const box = aside.createDiv({ cls: 'sg-detail-facts' });
				box.createDiv({ cls: 'sg-detail-facts-title', text: appearances.length === 1 ? t('codex.detail.appearsInOne', { count: appearances.length }) : t('codex.detail.appearsInOther', { count: appearances.length }) });
				for (const a of appearances.slice(0, 12)) {
					const row = box.createDiv({ cls: 'sg-detail-appearance' });
					row.setAttribute('role', 'button');
					row.setAttribute('tabindex', '0');
					row.createSpan({ cls: 'sg-detail-appearance-col', text: a.columnLabel || a.gridName });
					row.createSpan({ cls: 'sg-detail-appearance-title', text: a.cardTitle });
					const openGrid = () => {
						const g = this.app.vault.getAbstractFileByPath(a.gridPath);
						if (g instanceof TFile) runSafely(this.plugin.openGridFile(g));
					};
					row.addEventListener('click', openGrid);
					row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openGrid(); });
				}
			}
		}

		// ── Main: drives · connections · prose sections ────────────────────────
		const main = grid.createDiv({ cls: 'sg-detail-main' });

		// Drives chip grid — the craft heart of this kind (Want/Need/Flaw etc.)
		// Reading page shows only what the writer filled in: an empty drive gets no
		// chip, and with none filled the whole section stays off the page. Edit
		// still lists every field.
		const heroFieldSpecs = spec.heroFields ?? [];
		const filledHeroes = heroFieldSpecs
			.map((heroSpec) => ({ heroSpec, matched: fields.find((f) => f.label === heroSpec.label) }))
			.filter(({ matched }) => !!matched?.value.trim());
		if (filledHeroes.length > 0) {
			const drivesSection = main.createDiv({ cls: 'sg-detail-section sg-detail-section--drives' });
			drivesSection.createDiv({ cls: 'sg-detail-section-title', text: spec.heroTitle ?? t('codex.detail.coreDrivesFallback') });
			const drivesGrid = drivesSection.createDiv({ cls: 'sg-detail-drives' });
			for (const { heroSpec, matched } of filledHeroes) {
				const chip = drivesGrid.createDiv({ cls: 'sg-detail-drive-chip' });
				const chipIcon = chip.createSpan({ cls: 'sg-detail-drive-icon' });
				setPhosphorIcon(chipIcon, heroSpec.icon, '•');
				const chipLabel = chip.createSpan({ cls: 'sg-detail-drive-label', text: heroSpec.label });
				if (matched?.prompt) chipLabel.setAttr('title', matched.prompt);
				chip.createDiv({ cls: 'sg-detail-drive-val', text: matched!.value.trim() });
			}
		}

		/** Relationships prose fields the chips stand in for (left out of the sections below). */
		let relProse: CharacterField[] = [];
		// Relationship chips — from the Relationships prose AND any typed field
		// that links to real Codex entries, so both routes show up here.
		{
			const relSources = fields.filter(
				(f) => (f.type === 'textarea' && /relationship/i.test(f.label)) ||
					(f.type === 'tags' && f.config?.entityLink)
			);
			const relations: ReturnType<typeof parseRelationLines> = [];
			const seen = new Set<string>();
			for (const text of Object.values(fieldsToRelationSections(relSources))) {
				for (const rel of parseRelationLines(text)) {
					const key = `${rel.label.toLowerCase()}→${rel.target}`;
					if (seen.has(key)) continue;
					seen.add(key);
					relations.push(rel);
				}
			}
			relProse = relations.length > 0 ? relSources.filter((f) => f.type === 'textarea') : [];
			if (relations.length > 0) {
				// Key relationships (father/mother/partner/… — the main words)
				// first, everything else under its own quieter heading. Chips
				// carry the relation type's map color as an underline bar, and
				// a small meter when the writer declared a bond strength.
				const extraTypes = buildCustomRegistry(this.plugin.settings.customRelationshipTypes);
				const renderChips = (host: HTMLElement, rels: RelationLine[]): void => {
					const relChips = host.createDiv({ cls: 'sg-detail-relations' });
					for (const rel of rels) {
						const chip = relChips.createDiv({ cls: 'sg-detail-rel-chip' });
						// A chip naming a real Codex entry opens it (a div, not a <button>:
						// Obsidian squeezes buttons onto one line). Others stay plain.
						const dest = this.app.metadataCache.getFirstLinkpathDest(rel.target, file.path);
						if (dest?.extension === 'md' && kindForFile(this.app, dest)) {
							chip.addClass('sg-detail-rel-chip--link');
							chip.setAttrs({ role: 'button', tabindex: '0', 'aria-label': t('codex.detail.openEntry', { name: dest.basename }) });
							const open = () => {
								this.cameFrom.push(file.path);
								this.detailPath = dest.path;
								void this.renderAll();
							};
							chip.addEventListener('click', open);
							chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
						}
						chip.createDiv({ cls: 'sg-detail-rel-avatar', text: rel.target.charAt(0).toUpperCase() });
						const relInfo = chip.createDiv({ cls: 'sg-detail-rel-info' });
						relInfo.createSpan({ cls: 'sg-detail-rel-name', text: rel.target });
						if (rel.label) relInfo.createSpan({ cls: 'sg-detail-rel-type', text: rel.label });
						const relType = classifyRelation(rel.label, extraTypes);
						if (relType.id !== RELATIONSHIP_TYPE_OTHER.id) {
							const bar = chip.createDiv({ cls: 'sg-detail-rel-bar' });
							bar.style.background = relType.color;
						}
						if (rel.intensity !== undefined) {
							const meter = chip.createDiv({ cls: 'sg-detail-rel-meter' });
							const fill = meter.createDiv({ cls: 'sg-detail-rel-meter-fill' });
							fill.style.width = `${rel.intensity * 10}%`;
							fill.style.background = relType.color;
							meter.setAttr('aria-label', t('codex.detail.bondStrengthAria', { intensity: rel.intensity }));
						}
					}
				};
				const { main: keyRels, other: otherRels } = partitionRelationLines(relations);
				const relSection = main.createDiv({ cls: 'sg-detail-section sg-detail-section--relations' });
				// Both groups: "Key relationships" + "Other relationships". One group: just "Relationships".
				if (keyRels.length > 0 && otherRels.length > 0) {
					relSection.createDiv({ cls: 'sg-detail-section-title', text: t('codex.detail.keyRelationships') });
					renderChips(relSection, keyRels);
					relSection.createDiv({ cls: 'sg-detail-section-title sg-detail-section-title--other', text: t('codex.detail.otherRelationships') });
					renderChips(relSection, otherRels);
				} else {
					relSection.createDiv({ cls: 'sg-detail-section-title', text: t('codex.detail.relationships') });
					renderChips(relSection, keyRels.length > 0 ? keyRels : otherRels);
				}
				// The chips replace the Relationships prose section; any free writing
				// in it that made no chip still shows here, so nothing disappears.
				for (const f of relProse) {
					const rest = nonRelationText(f.value);
					if (rest) await MarkdownRenderer.render(this.app, rest, relSection.createDiv({ cls: 'sg-detail-section-body sg-detail-rel-notes' }), file.path, this);
				}
			}
		}

		// Everything that isn't in Vitals gets its own titled section, in the same
		// section order the editor uses — this now includes non-prose custom fields
		// (a slider, a number, a dropdown…), not just textarea/list/table ones, so
		// a custom field's category actually decides where it shows up.
		const factIds = new Set(factFields.map((f) => f.id));
		const grouped = groupFieldsIntoSections(kind, fields);
		const detailFields: CharacterField[] = [];
		for (const section of grouped) {
			for (const f of section.fields) {
				if (factIds.has(f.id) || nameLabels.includes(f.label) || f === quoteField || heroLabels.has(f.label)) continue;
				detailFields.push(f);
			}
		}
		const blockFields = fields.filter(isBlock);
		for (const f of blockFields) if (!detailFields.includes(f)) detailFields.push(f);

		if (detailFields.every((f) => !f.value.trim()) && heroFieldSpecs.every((h) => !fields.find((f) => f.label === h.label)?.value.trim()) && factFields.length === 0) {
			main.createDiv({ cls: 'sg-detail-empty', text: t('codex.detail.emptySheet') });
		}

		for (const f of detailFields) {
			if (!f.value.trim()) continue;
			if (relProse.some((r) => r.id === f.id)) continue;
			// An old key next to the one Plotverk writes ("Voice Mannerisms" beside
			// "Voice & Mannerisms") with the same text: show it once.
			if (isEchoOfEarlierField(f, detailFields.slice(0, detailFields.indexOf(f)))) continue;
			const sec = main.createDiv({ cls: 'sg-detail-section' });
			if (f.config?.tint) sec.setAttr('data-tint', f.config.tint);
			const secTitle = sec.createDiv({ cls: 'sg-detail-section-title', text: f.label });
			if (f.prompt) secTitle.setAttr('title', f.prompt);
			const bodyEl = sec.createDiv({ cls: 'sg-detail-section-body' });
			if (f.type === 'textarea') {
				await MarkdownRenderer.render(this.app, f.value, bodyEl, file.path, this);
			} else {
				renderFieldWidget(bodyEl, f, 'read', { app: this.app, onChange: () => {} });
			}
		}
	}

	// ─── Images — one folded section on the sheet page ──────────────────────────

	/**
	 * "Images (N)": every picture in the sheet's own folder plus any picture the
	 * sheet shows, portrait first. Folded by default; all actions live inside.
	 */
	private renderImagesSection(page: HTMLElement, sheet: TFile): void {
		const gen = this._renderGen;
		const sec = page.createDiv({ cls: 'sg-detail-images' });
		const head = sec.createEl('button', { cls: 'sg-detail-images-head', attr: { type: 'button' } });
		const caret = head.createSpan({ cls: 'sg-detail-images-caret' });
		const title = head.createSpan({ cls: 'sg-detail-images-title', text: t('codex.images.title', { count: '…' }) });
		const body = sec.createDiv({ cls: 'sg-detail-images-body' });
		const applyOpen = () => {
			caret.empty();
			setPhosphorIcon(caret, this.imagesOpen ? 'caret-down' : 'caret-right', this.imagesOpen ? '▾' : '▸');
			head.setAttr('aria-expanded', String(this.imagesOpen));
			body.toggle(this.imagesOpen);
		};
		applyOpen();
		head.addEventListener('click', () => { this.imagesOpen = !this.imagesOpen; applyOpen(); });

		void listSheetImages(this.app, sheet).then(async ({ images, portrait }) => {
			// What Remove may do to each picture: trash it, only take it off the sheet, or nothing.
			const removals = await Promise.all(images.map((img) => removalFor(this.app, sheet, img)));
			if (gen !== this._renderGen) return;
			title.setText(t('codex.images.title', { count: images.length }));

			const actions = body.createDiv({ cls: 'sg-detail-images-actions' });
			const addBtn = actions.createEl('button', { cls: 'sg-detail-action sg-detail-images-add', attr: { type: 'button' } });
			setPhosphorIcon(addBtn.createSpan(), 'image', '+');
			addBtn.createSpan({ text: t('codex.images.add') });
			addBtn.addEventListener('click', () => {
				const picker = createEl('input');
				picker.type = 'file';
				picker.accept = 'image/*';
				picker.multiple = true;
				picker.onchange = () => {
					const files = Array.from(picker.files ?? []);
					if (files.length > 0) void this.addImagesToSheet(sheet, files);
				};
				picker.click();
			});
			if (Platform.isMobile) {
				// Phones only offer Paste on something editable: a box that takes a
				// pasted picture and nothing else (no keyboard pops up).
				const box = actions.createDiv({
					cls: 'sg-detail-images-paste',
					attr: { contenteditable: 'true', inputmode: 'none', role: 'textbox', 'aria-label': t('codex.images.pasteHintMobile'), 'data-placeholder': t('codex.images.pasteHintMobile') },
				});
				box.addEventListener('beforeinput', (e) => e.preventDefault());
				box.addEventListener('input', () => box.empty());
			} else {
				actions.createSpan({ cls: 'sg-detail-images-hint', text: t('codex.images.pasteHint') });
			}

			if (images.length === 0) {
				body.createDiv({ cls: 'sg-detail-images-empty', text: t('codex.images.empty') });
				return;
			}
			const grid = body.createDiv({ cls: 'sg-detail-images-grid' });
			for (const img of images) {
				const tile = grid.createDiv({ cls: 'sg-detail-image' });
				const open = tile.createEl('button', { cls: 'sg-detail-image-open', attr: { type: 'button', 'aria-label': t('codex.images.open', { name: img.name }), title: img.name } });
				open.createEl('img', { attr: { src: this.app.vault.getResourcePath(img), alt: img.name, loading: 'lazy' } });
				open.addEventListener('click', () => void openOrReveal(this.app, img));
				const isPortrait = portrait?.path === img.path;
				if (isPortrait) tile.createDiv({ cls: 'sg-detail-image-badge', text: t('codex.images.portrait') });
				tile.createDiv({ cls: 'sg-detail-image-name', text: img.name });
				const btns = tile.createDiv({ cls: 'sg-detail-image-btns' });
				if (!isPortrait) {
					const use = btns.createEl('button', { cls: 'sg-detail-image-btn', text: t('codex.images.usePortrait'), attr: { type: 'button' } });
					use.addEventListener('click', () => void this.runImageAction(() => useAsPortrait(this.app, sheet, img)));
				}
				const how = removals[images.indexOf(img)];
				if (!how) continue; // only used inside the sheet's writing: edit the text to remove it
				const remove = btns.createEl('button', { cls: 'sg-detail-image-btn sg-detail-image-btn--remove', text: t('codex.images.remove'), attr: { type: 'button' } });
				remove.addEventListener('click', () => {
					new ConfirmModal(
						this.app,
						t(how === 'trash' ? 'codex.images.confirm.trash' : 'codex.images.confirm.unlink', { name: img.name }),
						how === 'trash' ? t('codex.images.remove') : t('codex.images.confirm.unlinkButton'),
						() => void this.runImageAction(() => removeSheetImage(this.app, sheet, img, how)),
					).open();
				});
			}
		});
	}

	private async runImageAction(action: () => Promise<void>): Promise<void> {
		try {
			await action();
		} catch (err) {
			new Notice(t('codex.images.notice.actionFailed', { msg: err instanceof Error ? err.message : '' }));
		}
		this.imagesOpen = true;
		void this.renderAll();
	}

	/**
	 * Save pictures for a sheet. The first picture a sheet ever gets becomes
	 * its portrait; one saved outside the sheet's folder ("Follow Obsidian")
	 * is put on the sheet so the gallery still finds it.
	 */
	private async addImagesToSheet(sheet: TFile, files: File[]): Promise<void> {
		await this.runImageAction(async () => {
			const target = targetForSheet(this.app, sheet);
			let { portrait } = await listSheetImages(this.app, sheet);
			for (const f of files) {
				const created = await saveImageForSheet(this.app, f, target);
				if (!portrait) {
					await useAsPortrait(this.app, sheet, created);
					portrait = created;
				} else if (!isSheetOwnImage(this.app, sheet, created)) {
					await appendSheetImage(this.app, sheet, created);
				}
				new Notice(t('codex.images.notice.added', { name: created.name }));
			}
		});
	}

	/** A paste of pictures while this view shows a sheet adds them to it. Typing fields keep their own paste. */
	private handleImagePaste(e: ClipboardEvent): void {
		if (!this.detailPath || this.app.workspace.getActiveViewOfType(StorygridCodexView) !== this) return;
		// Never while a dialog is open (the sheet editor would then save over it),
		// and only from inside this view or with nothing focused at all.
		if (this.containerEl.doc.querySelector('.modal-container')) return;
		const rawTarget = e.target as Node | null;
		const target = rawTarget?.instanceOf(HTMLElement) ? rawTarget : null;
		if (target && target !== this.containerEl.doc.body && !this.containerEl.contains(target)) return;
		const inPasteBox = !!target?.closest('.sg-detail-images-paste');
		if (!inPasteBox && target && (target.isContentEditable || target.closest('input, textarea'))) return;
		const files = imagesFromDataTransfer(e.clipboardData);
		if (files.length === 0) return;
		const sheet = this.app.vault.getAbstractFileByPath(this.detailPath);
		if (!(sheet instanceof TFile)) return;
		e.preventDefault();
		void this.addImagesToSheet(sheet, files);
	}

	/** Render a single line of markdown (wikilinks, emphasis) inline. */
	private renderInline(el: HTMLElement, md: string, sourcePath: string): void {
		void MarkdownRenderer.render(this.app, md, el, sourcePath, this).then(() => {
			// Unwrap the single <p> Obsidian wraps a one-liner in, so it sits inline
			const p = el.querySelector(':scope > p');
			if (p && el.childElementCount === 1) {
				el.replaceChildren(...Array.from(p.childNodes));
			}
		});
	}

	/** Whether the Story Tree reads any family line to or from this entry: every sheet in the project, read the way the tree reads them. */
	private async hasFamilyInProject(projectRoot: string, path: string): Promise<boolean> {
		const jobs: Array<Promise<RelEntity | null>> = [];
		for (const kind of getCodexKindOrder()) {
			for (const info of this.plugin.entityIndex.list(projectRoot, kind)) {
				jobs.push(this.app.vault.cachedRead(info.file).then((text) => {
					const parsed = parseEntityDocument(text, info.file.basename);
					return { path: info.file.path, name: info.file.basename, kind, sections: fieldsToRelationSections(parsed.fields) };
				}).catch(() => null));
			}
		}
		const entities = (await Promise.all(jobs)).filter((e): e is RelEntity => e !== null);
		return hasFamilyTie(path, buildRelationGraph(entities, buildCustomRegistry(this.plugin.settings.customRelationshipTypes)));
	}

	private showDetailMenu(e: MouseEvent, entity: EntityInfo): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(t('codex.menu.editSheet')).setIcon('pencil')
			.onClick(() => this.editEntity(entity)));
		menu.addItem((item) => item.setTitle(t('codex.menu.openAsNote')).setIcon('file-text')
			.onClick(() => openOrReveal(this.app, entity.file, { state: { mode: 'preview' } })));
		menu.addItem((item) => item.setTitle(t('codex.menu.rename')).setIcon('pencil')
			.onClick(() => {
				new TextPromptModal(this.app, t('codex.rename.title', { name: entity.name }), entity.name, (newName) => { runSafely((async () => {
					if (!newName || newName === entity.name) return;
					try {
						if (await renameEntitySheet(this.app, entity.file, newName) === 'taken') {
							new Notice(t('codex.notice.nameTaken', { name: newName }));
							return;
						}
						this.detailPath = entity.file.path;
					} catch (err) {
						new Notice(t('codex.notice.renameFailed', { msg: err instanceof Error ? err.message : '' }));
					}
				})()); }).open();
			}));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(t('common.delete')).setIcon('trash')
			.onClick(() => {
				this.confirmDeleteSheet(entity, () => {
					this.detailPath = null;
					void this.renderAll();
				});
			}));
		menu.showAtMouseEvent(e);
	}

	private renderNoProjects(el: HTMLElement): void {
		const empty = el.createDiv({ cls: 'sg-codex-empty-state' });
		const icon = empty.createDiv({ cls: 'sg-codex-empty-icon' });
		setPhosphorIcon(icon, 'books', '◆');
		empty.createEl('h2', { text: t('codex.noProjects.title') });
		empty.createEl('p', { text: t('codex.noProjects.desc') });
		const btn = empty.createEl('button', { cls: 'sg-codex-btn sg-codex-btn--primary', text: t('codex.noProjects.cta') });
		btn.addEventListener('click', () => { runSafely(this.plugin.createNewGrid()); });
	}

	private renderIntro(parent: HTMLElement): void {
		const key = 'codex';
		if (this.plugin.settings.dismissedIntros?.[key]) return;
		const bar = parent.createDiv({ cls: 'sg-tab-intro' });
		bar.createSpan({
			cls: 'sg-tab-intro-text',
			text: t('codex.intro.text'),
		});
		const closeBtn = bar.createEl('button', { cls: 'sg-tab-intro-close', text: '×' });
		closeBtn.setAttribute('aria-label', t('codex.intro.dismissAria'));
		closeBtn.addEventListener('click', () => {
			if (!this.plugin.settings.dismissedIntros) this.plugin.settings.dismissedIntros = {};
			this.plugin.settings.dismissedIntros[key] = true;
			void this.plugin.saveSettings();
			bar.classList.add('sg-tab-intro--fade');
			window.setTimeout(() => bar.remove(), 350);
		});
	}

	private renderHeader(el: HTMLElement, project: StoryProject): void {
		const header = el.createDiv({ cls: 'sg-codex-header' });

		const titleWrap = header.createDiv({ cls: 'sg-codex-title-wrap' });
		const titleIcon = titleWrap.createSpan({ cls: 'sg-codex-title-icon' });
		setPhosphorIcon(titleIcon, 'books', '◆');
		titleWrap.createEl('h2', { cls: 'sg-codex-title', text: t('codex.title') });

		// Project name — read-only; active project is set from the Dashboard only
		header.createSpan({ cls: 'sg-codex-project-name', text: project.name });

		// Search
		const searchWrap = header.createDiv({ cls: 'sg-codex-search' });
		const searchIcon = searchWrap.createSpan({ cls: 'sg-codex-search-icon' });
		setPhosphorIcon(searchIcon, 'magnifying-glass', '◆');
		const searchInput = searchWrap.createEl('input', {
			type: 'text',
			placeholder: t('codex.header.searchPlaceholder'),
		});
		searchInput.value = this.searchQuery;
		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value;
			const body = this.contentEl.querySelector('.sg-codex-body');
			if (body?.instanceOf(HTMLElement)) {
				body.empty();
				this.renderSidebar(body, project);
				this.renderGallery(body, project);
				const refocus = this.contentEl.querySelector('.sg-codex-search input');
				if (refocus?.instanceOf(HTMLInputElement)) {
					refocus.value = this.searchQuery;
				}
			}
		});

		// Standard quick-launch row — identical to the one in the Writers Panel and
		// Dashboard headers; per-link visibility + placement come from Settings → Quick-links.
		const quickLaunch = header.createDiv({ cls: 'sg-quicklaunch-row' });
		this.plugin.renderQuickLaunchRow(quickLaunch, 'panel', project.gridFiles[0]);
	}

	private renderSidebar(body: HTMLElement, project: StoryProject): void {
		if (Platform.isPhone) return; // phones use the menu button + sheet instead
		const sidebar = body.createDiv({ cls: 'sg-codex-sidebar' });
		this.renderNavTree(sidebar, project);
	}

	/** The group → kind tree, shared by the desktop sidebar and the phone sheet. `onPick` runs before the re-render when a kind is chosen. */
	private renderNavTree(sidebar: HTMLElement, project: StoryProject, onPick?: () => void): void {
		for (const group of getCodexGroups()) {
			// Open only if the user opened it. Deliberately NOT force-opened for
			// the active kind — that made the selected group impossible to fold.
			const open = this.expandedGroups.has(group.id);

			const groupEl = sidebar.createDiv({ cls: 'sg-codex-nav-group' });
			if (!open) groupEl.addClass('is-collapsed');

			const head = groupEl.createDiv({ cls: 'sg-codex-nav-group-head' });
			head.setAttribute('role', 'button');
			head.setAttribute('tabindex', '0');
			head.setAttribute('aria-expanded', String(open));
			// The group's info line doubles as the hover tooltip.
			head.setAttribute('title', t('codex.sidebar.groupTooltip', { label: group.label, info: group.info }));

			const groupIcon = head.createSpan({ cls: 'sg-codex-nav-group-icon' });
			setPhosphorIcon(groupIcon, group.icon, group.fallbackIcon);
			head.createSpan({ cls: 'sg-codex-nav-group-label', text: group.label });
			const caret = head.createSpan({ cls: 'sg-codex-nav-group-caret' });
			setPhosphorIcon(caret, open ? 'caret-down' : 'caret-right', open ? '▾' : '▸');

			const toggleGroup = () => {
				if (this.expandedGroups.has(group.id)) this.expandedGroups.delete(group.id);
				else this.expandedGroups.add(group.id);
				// Redraw just this tree — a full renderAll blanks the page while it re-scans
				// every grid, and on phones made the open sheet slide up again on each fold.
				sidebar.empty();
				this.renderNavTree(sidebar, project, onPick);
			};
			head.addEventListener('click', toggleGroup);
			head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(); } });

			if (!open) continue;

			const kidsEl = groupEl.createDiv({ cls: 'sg-codex-nav-group-kinds' });
			for (const kind of group.kinds) {
				const spec = getKindSpec(kind);
				const count = this.plugin.entityIndex.list(project.rootPath, kind).length;

				const item = kidsEl.createDiv({ cls: 'sg-codex-nav-item' });
				item.setAttribute('role', 'button');
				item.setAttribute('tabindex', '0');
				item.setAttribute('title', t('codex.sidebar.kindTooltip', { plural: spec.plural, tagline: spec.tagline }));
				if (kind === this.activeKind) item.addClass('is-active');

				const icon = item.createSpan({ cls: 'sg-codex-nav-icon' });
				setPhosphorIcon(icon, spec.icon, spec.fallbackIcon);
				item.createSpan({ cls: 'sg-codex-nav-label', text: spec.plural });
				if (count > 0) item.createSpan({ cls: 'sg-codex-nav-count', text: String(count) });

				const activateKind = () => { onPick?.(); this.activeKind = kind; this.viewMode = this.defaultViewModeForKind(kind); void this.renderAll(); };
				item.addEventListener('click', activateKind);
				item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') activateKind(); });
			}
		}
	}

	private renderGallery(body: HTMLElement, project: StoryProject): void {
		const spec = getKindSpec(this.activeKind);
		// A previous render's scroller (if any) is now detached — tear it down.
		this.galleryScroller?.destroy();
		this.galleryScroller = null;
		this.galleryResizeObserver?.disconnect();
		this.galleryResizeObserver = null;
		if (this.galleryResizeTimer) { window.clearTimeout(this.galleryResizeTimer); this.galleryResizeTimer = null; }
		const gallery = body.createDiv({ cls: 'sg-codex-gallery' });

		// Section header
		const sectionHead = gallery.createDiv({ cls: 'sg-codex-section-head' });
		if (Platform.isPhone) {
			// Phones: ☰ · Characters 13 · ⚙ · + — four same-sized boxes on one line,
			// the tagline on its own line below. Desktop/tablet keep the full row.
			sectionHead.addClass('sg-codex-section-head--phone');
			this.renderPhoneNavButton(sectionHead, spec);
			const headText = sectionHead.createDiv({ cls: 'sg-codex-section-head-text' });
			const h3 = headText.createEl('h3', { text: spec.plural });
			const count = this.plugin.entityIndex.list(project.rootPath, this.activeKind).length;
			if (count > 0) h3.createSpan({ cls: 'sg-codex-section-count', text: String(count) });

			const cog = sectionHead.createEl('button', {
				cls: 'sg-codex-phone-box',
				attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-label': t('codex.gallery.viewOptions') },
			});
			setPhosphorIcon(cog, 'gear', '⚙');
			cog.addEventListener('click', () => {
				const menu = new Menu();
				menu.addItem((item) => item.setTitle(t('codex.gallery.cardView')).setIcon('layout-grid').setChecked(this.viewMode === 'tiles')
					.onClick(() => { this.viewMode = 'tiles'; void this.renderAll(); }));
				menu.addItem((item) => item.setTitle(t('codex.gallery.listView')).setIcon('list').setChecked(this.viewMode === 'list')
					.onClick(() => { this.viewMode = 'list'; void this.renderAll(); }));
				const r = cog.getBoundingClientRect();
				menu.showAtPosition({ x: r.right, y: r.bottom + 4 });
			});

			const plus = sectionHead.createEl('button', {
				cls: 'sg-codex-phone-box sg-codex-phone-box--primary',
				attr: { type: 'button', 'aria-label': t('codex.gallery.newEntity', { singular: spec.singular }) },
			});
			setPhosphorIcon(plus, 'plus', '+');
			plus.addEventListener('click', () => this.createEntity(project, this.activeKind));

			gallery.createEl('p', { cls: 'sg-codex-section-tagline sg-codex-section-tagline--phone', text: spec.tagline });
		}
		const headText = Platform.isPhone ? null : sectionHead.createDiv({ cls: 'sg-codex-section-head-text' });
		headText?.createEl('h3', { text: spec.plural });
		headText?.createEl('p', { cls: 'sg-codex-section-tagline', text: spec.tagline });

		// View mode toggle + New button (desktop/tablet; phones have the cog and + above)
		const viewToggle = sectionHead.createDiv({ cls: 'sg-codex-view-toggle' });
		if (Platform.isPhone) viewToggle.hide();
		const tileBtn = viewToggle.createEl('button', {
			cls: 'sg-codex-view-btn' + (this.viewMode === 'tiles' ? ' is-active' : ''),
			title: t('codex.gallery.cardView'),
			attr: { 'aria-label': t('codex.gallery.cardView') },
		});
		setPhosphorIcon(tileBtn, GRID_VIEW_ICON, '⊞');
		const listBtn = viewToggle.createEl('button', {
			cls: 'sg-codex-view-btn' + (this.viewMode === 'list' ? ' is-active' : ''),
			title: t('codex.gallery.listView'),
			attr: { 'aria-label': t('codex.gallery.listView') },
		});
		// 'rows', not 'list': the ☰ list glyph is the phone menu button's symbol.
		setPhosphorIcon(listBtn, 'rows', '≡');
		tileBtn.addEventListener('click', () => { this.viewMode = 'tiles'; void this.renderAll(); });
		listBtn.addEventListener('click', () => { this.viewMode = 'list'; void this.renderAll(); });

		const newBtn = sectionHead.createEl('button', { cls: 'sg-codex-btn sg-codex-btn--primary' });
		if (Platform.isPhone) newBtn.hide();
		const ni = newBtn.createSpan();
		setPhosphorIcon(ni, 'plus', '+');
		newBtn.createSpan({ text: t('codex.gallery.newEntity', { singular: spec.singular }) });
		newBtn.addEventListener('click', () => this.createEntity(project, this.activeKind));

		// Entities (filtered by search)
		let entities = this.plugin.entityIndex.list(project.rootPath, this.activeKind);
		const q = this.searchQuery.trim().toLowerCase();
		if (q) {
			entities = entities.filter(
				(e) =>
					e.name.toLowerCase().includes(q) ||
					e.facts.some((fact) => fact.value.toLowerCase().includes(q))
			);
		}

		// Locations are a hierarchy — render them as a tree unless searching
		// (search results read better as a flat gallery of matches)
		if (this.activeKind === 'location' && !q && entities.length > 0) {
			this.renderLocationTree(gallery, project, entities);
			return;
		}

		// Dense-row kinds get a one-line quick-add instead of opening the full modal
		if (spec.displayShape === 'row') {
			this.renderQuickAdd(gallery, project);
		}

		const grid = gallery.createDiv({
			cls: `sg-codex-grid sg-codex-grid--${this.viewMode}`,
		});
		const portraitGrid = this.viewMode === 'tiles' && this.isPortraitKind(this.activeKind);
		if (portraitGrid) grid.addClass('sg-codex-grid--portrait');

		if (entities.length === 0) {
			const empty = grid.createDiv({ cls: 'sg-codex-gallery-empty' });
			// Ghost preview — the real card markup, faded and inert, so a
			// first-time visitor sees the destination before doing anything.
			// Only built for characters: they're the kind every writer starts
			// with, and the portrait-card shape reads clearly even faded.
			if (!q && this.activeKind === 'character') {
				this.renderGhostCharacterCard(empty);
			} else if (!q) {
				const icon = empty.createDiv({ cls: 'sg-codex-empty-icon' });
				setPhosphorIcon(icon, spec.icon, spec.fallbackIcon);
			}
			empty.createEl('p', {
				text: q
					? t('codex.gallery.emptySearch', { plural: spec.plural.toLowerCase(), query: this.searchQuery })
					: t('codex.gallery.emptyState', { plural: spec.plural.toLowerCase(), tagline: spec.tagline }),
			});
			if (!q) {
				const btn = empty.createEl('button', { cls: 'sg-codex-btn sg-codex-btn--primary', text: t('codex.gallery.createFirst', { singular: spec.singular.toLowerCase() }) });
				btn.addEventListener('click', () => this.createEntity(project, this.activeKind));
			}
			return;
		}

		// Large list collections are windowed: only the rows near the viewport
		// are in the DOM, so a 2000-entry kind costs the same as a small one.
		if (this.viewMode === 'list' && entities.length > VIRTUALIZE_MIN) {
			grid.addClass('is-virtualized');
			if (Platform.isMobile) grid.addClass('is-mobile');
			const rowH = Platform.isMobile ? VIRTUAL_ROW_H_MOBILE : VIRTUAL_ROW_H;
			const overscan = Platform.isMobile ? VIRTUAL_OVERSCAN_MOBILE : VIRTUAL_OVERSCAN;
			const gen = this._renderGen;
			this.galleryScroller = new VirtualScroller({
				scrollEl: gallery,
				contentEl: grid,
				count: entities.length,
				itemH: rowH,
				columns: 1,
				overscan,
				isStale: () => gen !== this._renderGen,
				renderSlice: (start, end) => {
					for (let i = start; i <= end; i++) this.renderEntityCard(grid, entities[i]);
					this.wireCardRoving(grid, '.sg-codex-card');
				},
			});
			return;
		}

		// Large tile grids are also windowed. Column count is derived from the
		// container width (clientWidth forces a layout flush so the value is live).
		// We then lock grid-template-columns to a fixed track count so the VirtualScroller's
		// slice-plus-padding approach works correctly — auto-fill would reflow unpredictably
		// as the number of rendered cards changes.
		if (this.viewMode === 'tiles' && entities.length > VIRTUALIZE_MIN) {
			const containerW = grid.clientWidth || gallery.clientWidth || 700;
			const minW = portraitGrid ? VIRTUAL_CARD_MIN_W_PORTRAIT : VIRTUAL_CARD_MIN_W;
			const cols = Math.max(1, Math.floor((containerW + VIRTUAL_CARD_GAP) / (minW + VIRTUAL_CARD_GAP)));
			grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
			const cardH = portraitGrid
				? (Platform.isMobile ? VIRTUAL_CARD_H_PORTRAIT_MOBILE : VIRTUAL_CARD_H_PORTRAIT)
				: (Platform.isMobile ? VIRTUAL_CARD_H_MOBILE : VIRTUAL_CARD_H);
			const rowH = cardH + VIRTUAL_CARD_GAP;
			const overscan = Platform.isMobile ? VIRTUAL_OVERSCAN_MOBILE : VIRTUAL_OVERSCAN;
			const gen = this._renderGen;
			grid.addClass('is-virtualized');
			if (Platform.isMobile) grid.addClass('is-mobile');
			// cols above is computed once from the container's current width, so
			// it goes stale on a window/pane resize — watch the gallery and
			// recompute (thresholded + debounced) when the width actually changes.
			this.galleryResizeObserver = new ResizeObserver((entries) => {
				const w = Math.round(entries[0]?.contentRect.width ?? 0);
				if (w === 0 || w === this.lastGalleryWidth) return;
				this.lastGalleryWidth = w;
				if (this.galleryResizeTimer) window.clearTimeout(this.galleryResizeTimer);
				this.galleryResizeTimer = window.setTimeout(() => void this.renderAll(), 400);
			});
			this.lastGalleryWidth = Math.round(containerW);
			this.galleryResizeObserver.observe(gallery);
			this.galleryScroller = new VirtualScroller({
				scrollEl: gallery,
				contentEl: grid,
				count: entities.length,
				itemH: rowH,
				columns: cols,
				overscan,
				isStale: () => gen !== this._renderGen,
				renderSlice: (start, end) => {
					for (let i = start; i <= end; i++) this.renderEntityCard(grid, entities[i]);
					this.wireCardRoving(grid, '.sg-codex-card');
				},
			});
			return;
		}

		for (const entity of entities) {
			this.renderEntityCard(grid, entity);
		}
		this.wireCardRoving(grid, '.sg-codex-card');
	}

	/**
	 * Roving tabindex for a rendered group of card/row buttons: the first
	 * element matching `selector` inside `container` becomes the only tab
	 * stop, the rest are pulled out of tab order. Re-run this after every
	 * (re)build of the group — including each virtualized slice — since a
	 * torn-down-and-rebuilt group doesn't keep its old tabindex assignments.
	 */
	private wireCardRoving(container: HTMLElement, selector: string): void {
		const items = Array.from(container.querySelectorAll<HTMLElement>(selector));
		items.forEach((item, i) => item.setAttribute('tabindex', i === 0 ? '0' : '-1'));
	}

	/**
	 * Arrow-key navigation between sibling cards/rows sharing `selector`
	 * inside `container`. `horizontal` also wires Left/Right (tile/list
	 * galleries); pass false for a single vertical list (the location tree).
	 */
	private handleCardGroupKeydown(
		e: KeyboardEvent,
		container: HTMLElement,
		selector: string,
		current: HTMLElement,
		horizontal = true
	): void {
		// Cards are role="button" divs, so Enter/Space activation is ours to
		// provide. Only when the card itself has focus — a key pressed on the
		// Edit button inside it must reach that button instead.
		if ((e.key === 'Enter' || e.key === ' ') && e.target === current && current.tagName !== 'BUTTON'
			&& !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			current.click();
			return;
		}
		let delta = 0;
		if (e.key === 'ArrowDown' || (horizontal && e.key === 'ArrowRight')) delta = 1;
		else if (e.key === 'ArrowUp' || (horizontal && e.key === 'ArrowLeft')) delta = -1;
		else return;
		const items = Array.from(container.querySelectorAll<HTMLElement>(selector));
		const i = items.indexOf(current);
		if (i === -1) return;
		const next = (i + delta + items.length) % items.length;
		e.preventDefault();
		items[i].setAttribute('tabindex', '-1');
		items[next].setAttribute('tabindex', '0');
		items[next].focus();
	}

	/**
	 * Collapsible hierarchy for locations: any location can nest inside
	 * another (dimension → planet → continent → country → city → street).
	 */
	private renderLocationTree(container: HTMLElement, project: StoryProject, entities: EntityInfo[]): void {
		const spec = getKindSpec('location');
		const treeEl = container.createDiv({ cls: 'sg-codex-tree' });

		const countDescendants = (node: EntityTreeNode<EntityInfo>): number =>
			node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);

		const renderNode = (node: EntityTreeNode<EntityInfo>): void => {
			const entity = node.entity;
			const hasKids = node.children.length > 0;
			const collapsed = this.collapsedLocations.has(entity.file.path);

			const row = treeEl.createEl('button', { cls: 'sg-codex-tree-row', attr: { type: 'button' } });
			row.style.paddingLeft = `${10 + node.depth * 22}px`;
			row.addEventListener('keydown', (e) => this.handleCardGroupKeydown(e, treeEl, '.sg-codex-tree-row', row, false));

			const chev = row.createEl('button', { cls: 'sg-codex-tree-chevron' });
			if (hasKids) {
				setPhosphorIcon(chev, collapsed ? 'caret-right' : 'caret-down', collapsed ? '▸' : '▾');
				chev.title = collapsed ? t('codex.tree.expand') : t('codex.tree.collapse');
				chev.addEventListener('click', (e) => {
					e.stopPropagation();
					if (collapsed) this.collapsedLocations.delete(entity.file.path);
					else this.collapsedLocations.add(entity.file.path);
					void this.renderAll();
				});
			} else {
				chev.addClass('sg-codex-tree-chevron--leaf');
			}

			const icon = row.createSpan({ cls: 'sg-codex-tree-icon' });
			setPhosphorIcon(icon, spec.icon, spec.fallbackIcon);
			row.createSpan({ cls: 'sg-codex-tree-name', text: entity.name });
			if (hasKids) {
				const n = countDescendants(node);
				row.createSpan({ cls: 'sg-codex-tree-count', text: n === 1 ? t('codex.tree.placeCountOne', { count: n }) : t('codex.tree.placeCountOther', { count: n }) });
			}

			const addBtn = row.createEl('button', {
				cls: 'sg-codex-tree-add',
				title: t('codex.tree.newLocationInside', { name: entity.name }),
			});
			setPhosphorIcon(addBtn, 'plus', '+');
			addBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.createEntity(project, 'location', entity.name);
			});

			row.addEventListener('click', () => {
				runSafely(openOrReveal(this.app, entity.file, { state: { mode: 'preview' } }));
			});
			row.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				this.showEntityMenu(e, entity);
			});

			if (!collapsed) node.children.forEach(renderNode);
		};

		buildEntityTree(entities).forEach(renderNode);
		this.wireCardRoving(treeEl, '.sg-codex-tree-row');

		container.createDiv({
			cls: 'sg-codex-tree-hint',
			text: t('codex.tree.hint'),
		});
	}

	/** Re-parent a location: pick where it belongs (or make it top-level). */
	private pickParentFor(entity: EntityInfo): void {
		const project = this.currentProject();
		if (!project) return;
		const all = this.plugin.entityIndex.list(project.rootPath, 'location');
		// A location can't move under itself or anything inside it
		const blocked = descendantNames(all, entity.name);
		const candidates = all.filter((e) => !blocked.has(e.name.toLowerCase()));

		new ParentPickModal(this.app, candidates, (parent) => { runSafely((async () => {
			try {
				await this.app.fileManager.processFrontMatter(entity.file, (fm: Record<string, unknown>) => {
					// Stored as a wikilink so Obsidian keeps it valid on renames
					if (parent) fm['storygrid-parent'] = `[[${parent.name}]]`;
					else delete fm['storygrid-parent'];
				});
				new Notice(
					parent
						? t('codex.notice.movedUnderParent', { name: entity.name, parent: parent.name })
						: t('codex.notice.movedTopLevel', { name: entity.name })
				);
			} catch (err) {
				new Notice(t('codex.notice.moveFailed', { name: entity.name, msg: err instanceof Error ? err.message : '' }));
			}
		})()); }).open();
	}

	/** Faded, inert preview of what a filled character card looks like — reuses the real card markup so it's an honest preview, not a mockup. */
	private renderGhostCharacterCard(parent: HTMLElement): void {
		const card = parent.createDiv({ cls: 'sg-codex-card sg-codex-card--portrait sg-codex-card--ghost sg-ghost' });
		const ring = card.createDiv({ cls: 'sg-codex-card-portrait-ring' });
		const ph = ring.createDiv({ cls: 'sg-codex-card-portrait-placeholder' });
		setPhosphorIcon(ph, 'user', '◍');
		const body = card.createDiv({ cls: 'sg-codex-card-portrait-body' });
		body.createDiv({ cls: 'sg-codex-card-name', text: t('codex.ghost.name') });
		body.createDiv({ cls: 'sg-codex-card-portrait-subtitle', text: t('codex.ghost.subtitle') });
		const inner = body.createDiv({ cls: 'sg-codex-card-portrait-inner' });
		const wantsRow = inner.createDiv({ cls: 'sg-codex-card-portrait-inner-row' });
		wantsRow.createSpan({ cls: 'sg-codex-card-portrait-inner-label', text: t('codex.card.wantsLabel') });
		wantsRow.createSpan({ cls: 'sg-codex-card-portrait-inner-value', text: t('codex.ghost.wantsValue') });
		const needsRow = inner.createDiv({ cls: 'sg-codex-card-portrait-inner-row' });
		needsRow.createSpan({ cls: 'sg-codex-card-portrait-inner-label', text: t('codex.card.needsLabel') });
		needsRow.createSpan({ cls: 'sg-codex-card-portrait-inner-value', text: t('codex.ghost.needsValue') });
	}

	private renderEntityCard(grid: HTMLElement, entity: EntityInfo): void {
		const spec = getKindSpec(entity.kind);
		// A div acting as a button, not a <button>: Obsidian's button rules pin
		// buttons to one input-height line, which collapsed these tall cards
		// and stacked the gallery rows on top of each other. It also holds a
		// real <button> (Edit sheet), which a <button> must not contain.
		const card = grid.createDiv({
			cls: `sg-codex-card sg-codex-card--${entity.kind}`,
			attr: { role: 'button' },
		});
		card.addEventListener('keydown', (e) => this.handleCardGroupKeydown(e, grid, '.sg-codex-card', card));

		if (this.viewMode === 'list') {
			this.renderEntityRow(card, entity, spec);
			return;
		}

		// Portrait layout for person/group kinds
		if (entity.kind === 'character' || entity.kind === 'faction') {
			card.addClass('sg-codex-card--portrait');

			// Visible card surface — sits below the overlapping photo. Name centered
			// (directly under the photo), all other text left-aligned.
			const bodyEl = card.createDiv({ cls: 'sg-codex-card-portrait-body' });
			bodyEl.createDiv({ cls: 'sg-codex-card-name', text: entity.name });

			const fm = this.app.metadataCache.getFileCache(entity.file)?.frontmatter ?? {};
			const role = String(fm['role'] ?? '').trim();
			const age = String(fm['age'] ?? '').trim();
			const want = String(fm['want'] ?? '').trim();
			const need = String(fm['need'] ?? '').trim();

			if (role || age) {
				const subtitle = bodyEl.createDiv({ cls: 'sg-codex-card-portrait-subtitle' });
				if (role) subtitle.createSpan({ text: role });
				if (role && age) subtitle.createSpan({ cls: 'sg-codex-card-portrait-dot', text: ' · ' });
				if (age) subtitle.createSpan({ text: age });
			}

			if (want || need) {
				const inner = bodyEl.createDiv({ cls: 'sg-codex-card-portrait-inner' });
				if (want) {
					const row = inner.createDiv({ cls: 'sg-codex-card-portrait-inner-row' });
					row.createSpan({ cls: 'sg-codex-card-portrait-inner-label', text: t('codex.card.wantsLabel') });
					row.createSpan({ cls: 'sg-codex-card-portrait-inner-value', text: want });
				}
				if (need) {
					const row = inner.createDiv({ cls: 'sg-codex-card-portrait-inner-row' });
					row.createSpan({ cls: 'sg-codex-card-portrait-inner-label', text: t('codex.card.needsLabel') });
					row.createSpan({ cls: 'sg-codex-card-portrait-inner-value', text: need });
				}
			}

			// Arc strip (characters only)
			if (entity.kind === 'character') {
				const appearances = this.appearanceIndex.get(entity.file.path) ?? [];
				if (appearances.length > 0) {
					const strip = bodyEl.createDiv({ cls: 'sg-codex-arc-strip' });
					const badge = strip.createSpan({ cls: 'sg-codex-arc-badge' });
					const bi = badge.createSpan();
					setPhosphorIcon(bi, 'film-script', '◆');
					badge.createSpan({
						text: appearances.length === 1 ? t('codex.card.sceneCountOne', { count: appearances.length }) : t('codex.card.sceneCountOther', { count: appearances.length }),
					});
					badge.title = appearances
						.map((a) => `${a.columnLabel ? a.columnLabel + ' — ' : ''}${a.cardTitle}`)
						.join('\n');
					badge.addEventListener('click', (e) => {
						e.stopPropagation();
						const file = this.app.vault.getAbstractFileByPath(appearances[0].gridPath);
						if (file instanceof TFile) runSafely(this.plugin.openGridFile(file));
					});
				}
			}

			// Round photo ring — placed after body so it renders on top (DOM order)
			const ring = card.createDiv({ cls: 'sg-codex-card-portrait-ring' });
			if (entity.imagePath) {
				const imgFile = this.app.vault.getAbstractFileByPath(entity.imagePath);
				if (imgFile instanceof TFile) {
					ring.createEl('img', {
						attr: { src: this.app.vault.getResourcePath(imgFile), alt: entity.name },
					});
				}
			}
			if (!ring.querySelector('img')) {
				const ph = ring.createDiv({ cls: 'sg-codex-card-portrait-placeholder' });
				setPhosphorIcon(ph, entity.kind === 'faction' ? spec.icon : 'user', entity.kind === 'faction' ? spec.fallbackIcon : '👤');
			}

			const editBtn = card.createEl('button', { cls: 'sg-codex-card-edit', title: t('codex.card.editSheet'), attr: { 'aria-label': t('codex.card.editSheet') } });
			setPhosphorIcon(editBtn, 'note-pencil', '✎');
			editBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				runSafely(this.editEntity(entity));
			});
			card.addEventListener('click', () => this.showDetail(entity));
			card.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				this.showEntityMenu(e, entity);
			});
			return;
		}

		// Standard tile layout — square image header, facts list
		const media = card.createDiv({ cls: 'sg-codex-card-media' });
		if (entity.imagePath) {
			const imgFile = this.app.vault.getAbstractFileByPath(entity.imagePath);
			if (imgFile instanceof TFile) {
				media.createEl('img', {
					attr: { src: this.app.vault.getResourcePath(imgFile), alt: entity.name },
				});
			}
		}
		if (!media.querySelector('img')) {
			const ph = media.createDiv({ cls: 'sg-codex-card-media-icon' });
			const look = this.sheetIcon(entity.file, spec);
			setPhosphorIcon(ph, look.icon, look.fallbackIcon);
			if (look.label) ph.setAttr('aria-label', look.label);
		}

		const bodyEl = card.createDiv({ cls: 'sg-codex-card-body' });
		bodyEl.createDiv({ cls: 'sg-codex-card-name', text: entity.name });

		const factsEl = bodyEl.createDiv({ cls: 'sg-codex-card-facts' });
		for (const fact of entity.facts) {
			const row = factsEl.createDiv({ cls: 'sg-codex-card-fact' });
			row.createSpan({ cls: 'sg-codex-card-fact-key', text: fact.key });
			row.createSpan({ cls: 'sg-codex-card-fact-value', text: fact.value });
		}

		const editBtn = card.createEl('button', { cls: 'sg-codex-card-edit', title: t('codex.card.editSheet'), attr: { 'aria-label': t('codex.card.editSheet') } });
		setPhosphorIcon(editBtn, 'note-pencil', '✎');
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			runSafely(this.editEntity(entity));
		});
		card.addEventListener('click', () => this.showDetail(entity));
		card.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showEntityMenu(e, entity);
		});
	}

	/** Compact inbox-style row used in list view (reuses outer `.sg-codex-card`). */
	private renderEntityRow(
		card: HTMLElement,
		entity: EntityInfo,
		spec: ReturnType<typeof getKindSpec>
	): void {
		card.addClass('sg-codex-row');

		// Round avatar — cover image if present, otherwise a tinted kind icon
		const avatar = card.createDiv({ cls: 'sg-codex-row-avatar' });
		if (entity.imagePath) {
			const imgFile = this.app.vault.getAbstractFileByPath(entity.imagePath);
			if (imgFile instanceof TFile) {
				avatar.createEl('img', {
					attr: { src: this.app.vault.getResourcePath(imgFile), alt: entity.name },
				});
			}
		}
		if (!avatar.querySelector('img')) {
			avatar.addClass('sg-codex-row-avatar--icon');
			const ic = avatar.createDiv({ cls: 'sg-codex-row-avatar-icon' });
			const look = this.sheetIcon(entity.file, spec);
			setPhosphorIcon(ic, look.icon, look.fallbackIcon);
			if (look.label) ic.setAttr('aria-label', look.label);
		}

		// Main — bold name + muted one-line fact summary
		const main = card.createDiv({ cls: 'sg-codex-row-main' });
		main.createDiv({ cls: 'sg-codex-row-name', text: entity.name });
		const summary = entity.facts.map((f) => f.value).join(' · ');
		if (summary) {
			main.createDiv({ cls: 'sg-codex-row-summary', text: summary });
		}

		// Right meta — scene-count badge for characters
		if (entity.kind === 'character') {
			const appearances = this.appearanceIndex.get(entity.file.path) ?? [];
			if (appearances.length > 0) {
				const badge = card.createSpan({ cls: 'sg-codex-row-badge' });
				const bi = badge.createSpan();
				setPhosphorIcon(bi, 'film-script', '◆');
				badge.createSpan({
					text: appearances.length === 1 ? t('codex.card.sceneCountOne', { count: appearances.length }) : t('codex.card.sceneCountOther', { count: appearances.length }),
				});
				badge.title = appearances
					.map((a) => `${a.columnLabel ? a.columnLabel + ' — ' : ''}${a.cardTitle}`)
					.join('\n');
				badge.addEventListener('click', (e) => {
					e.stopPropagation();
					const file = this.app.vault.getAbstractFileByPath(appearances[0].gridPath);
					if (file instanceof TFile) runSafely(this.plugin.openGridFile(file));
				});
			}
		}

		// Hover edit button — opens the guided sheet editor
		const editBtn = card.createEl('button', { cls: 'sg-codex-card-edit', title: t('codex.card.editSheet'), attr: { 'aria-label': t('codex.card.editSheet') } });
		setPhosphorIcon(editBtn, 'note-pencil', '✎');
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			runSafely(this.editEntity(entity));
		});

		// Interactions — open the rendered detail page inside the Codex
		card.addEventListener('click', () => this.showDetail(entity));
		card.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showEntityMenu(e, entity);
		});
	}

	private showEntityMenu(e: MouseEvent, entity: EntityInfo): void {
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle(t('codex.menu.open'))
			.setIcon('file-text')
			.onClick(() => this.showDetail(entity)));
		menu.addItem((item) => item
			.setTitle(t('codex.menu.editSheet'))
			.setIcon('pencil')
			.onClick(() => this.editEntity(entity)));
		if (entity.kind === 'location') {
			menu.addItem((item) => item
				.setTitle(t('codex.menu.newLocationInside'))
				.setIcon('plus')
				.onClick(() => {
					const project = this.currentProject();
					if (project) this.createEntity(project, 'location', entity.name);
				}));
			menu.addItem((item) => item
				.setTitle(t('codex.menu.moveUnder'))
				.setIcon('corner-down-right')
				.onClick(() => this.pickParentFor(entity)));
		}
		menu.addItem((item) => item
			.setTitle(t('codex.menu.rename'))
			.setIcon('pencil')
			.onClick(() => {
				new TextPromptModal(this.app, t('codex.rename.title', { name: entity.name }), entity.name, (newName) => { runSafely((async () => {
					if (!newName || newName === entity.name) return;
					try {
						if (await renameEntitySheet(this.app, entity.file, newName) === 'taken') {
							new Notice(t('codex.notice.nameTaken', { name: newName }));
						}
					} catch (err) {
						new Notice(t('codex.notice.renameFailed', { msg: err instanceof Error ? err.message : '' }));
					}
				})()); }).open();
			}));
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle(t('common.delete'))
			.setIcon('trash')
			.onClick(() => {
				this.confirmDeleteSheet(entity);
			}));
		menu.showAtMouseEvent(e);
	}

	/**
	 * Move a sheet to the trash. When it has pictures in its own folder, the
	 * same question asks whether they go too ("Keep images" leaves them).
	 * Pictures kept anywhere else are never touched — other notes may use them.
	 */
	private confirmDeleteSheet(entity: EntityInfo, after?: () => void): void {
		void this.askDeleteSheet(entity, after);
	}

	private async askDeleteSheet(entity: EntityInfo, after?: () => void): Promise<void> {
		// Only pictures in the sheet's own folder that nothing else uses are offered.
		const images = (await sheetDeletePlan(this.app, entity.file)).trashable;
		const doTrash = async (withImages: boolean) => {
			try {
				await trashSheet(this.app, entity.file, withImages);
				new Notice(t('codex.notice.deleted', { name: entity.name }));
			} catch (err) {
				new Notice(t('codex.images.notice.actionFailed', { msg: err instanceof Error ? err.message : '' }));
			}
			after?.();
		};
		if (images.length === 0) {
			new ConfirmModal(this.app, t('codex.confirm.moveToTrash', { name: entity.name }), t('common.delete'), () => void doTrash(false)).open();
			return;
		}
		new ConfirmModal(
			this.app,
			t(images.length === 1 ? 'codex.confirm.trashWithImagesOne' : 'codex.confirm.trashWithImagesOther', { name: entity.name, count: images.length }),
			t('codex.confirm.imagesToo'),
			() => void doTrash(true),
			{ label: t('codex.confirm.keepImages'), onChoose: () => void doTrash(false) },
		).open();
	}

	// ─── Entity creation ───────────────────────────────────────────────────────

	private templatesForKind(kind: EntityKind): CharacterFieldTemplate[] {
		const s = this.plugin.settings;
		switch (kind) {
			case 'character': return s.characterFieldTemplates;
			case 'scene': return s.sceneFieldTemplates;
			case 'location': return s.locationFieldTemplates;
			case 'faction': return s.factionFieldTemplates;
			case 'system': return s.systemFieldTemplates;
			case 'item': return s.itemFieldTemplates;
			case 'research': return s.researchFieldTemplates ?? (s.researchFieldTemplates = []);
			default: {
				const store = s.customKindFieldTemplates ?? (s.customKindFieldTemplates = {});
				return store[kind] ?? (store[kind] = []);
			}
		}
	}

	/**
	 * Re-open an existing entity document in the guided sheet editor.
	 * The document is parsed back into fields, edited in the modal, and the
	 * file is rewritten (and renamed, if the name changed) on save.
	 */
	private async editEntity(entity: EntityInfo): Promise<void> {
		let content: string;
		try {
			content = await this.app.vault.read(entity.file);
		} catch (err) {
			new Notice(t('codex.notice.readFailed', { name: entity.name, msg: err instanceof Error ? err.message : '' }));
			return;
		}

		const parsed = parseEntityDocument(content, entity.file.basename);
		const kind = parsed.kind ?? entity.kind;
		const merged = mergeWithSpecDefaults(kind, parsed.fields, parsed.cleanSlate);
		// The modal edits these field objects in place (labels included), so what
		// was on disk has to be remembered now — the save diffs against it to know
		// which fields the writer deleted or relabeled.
		const before = merged.map((f) => ({ id: f.id, label: f.label, type: f.type }));
		// The file is renamed only when the writer changes the name here. A title
		// and file name that already differ (a rename in Obsidian's file list, a
		// clashing name) must never send the file back to the title.
		const startName = parsed.name;

		new EntityModal(
			this.app,
			kind,
			startName,
			merged,
			async (name, fields, aliases) => {
				const renamed = !!sheetFileName(name) && name.trim() !== startName.trim();
				// Another sheet already has the new name: nothing is written, and the
				// editor stays open with the writer's work so they can pick another.
				if (renamed && sheetNameTaken(this.app, entity.file, name)) {
					new Notice(t('codex.notice.nameTaken', { name: name.trim() }));
					return;
				}
				try {
					await updateEntitySheet(this.app, entity.file, {
						kind,
						name,
						fields,
						before,
						entityId: parsed.entityId ?? undefined,
						aliases,
						staleKeys: parsed.ownedKeys,
					});
				} catch (err) {
					// Nothing back: the sheet editor stays open with the writer's work.
					new Notice(t('codex.notice.saveFailed', { kind, msg: err instanceof Error ? err.message : '' }));
					return;
				}
				// The sheet is saved. From here a hiccup is reported, never a reason to save again.
				try {
					// The writer renamed the sheet in the editor: the file follows.
					const newPath = sheetPathFor(entity.file, name);
					if (renamed && newPath !== entity.file.path) {
						if (!sheetNameTaken(this.app, entity.file, name)) {
							const wasInDetail = this.detailPath === entity.file.path;
							try {
								await this.app.fileManager.renameFile(entity.file, newPath);
							} catch (err) {
								// The sheet is saved under its new title; only the file kept its
								// old name. Say so plainly (the menu's Rename can try again).
								new Notice(t('codex.notice.renameFailed', { msg: err instanceof Error ? err.message : '' }));
							}
							if (wasInDetail) this.detailPath = entity.file.path;
						}
					}
					new Notice(t('codex.notice.entityUpdated', { singular: getKindSpec(kind).singular, name }));
					void this.renderAll();
				} catch (err) {
					reportError(err);
				}
				// Renamed in place above, so this is the sheet as it is on disk now.
				return entity.file;
			},
			{
				savedTemplates: this.templatesForKind(kind),
				onSaveTemplate: (tpl) => {
					this.templatesForKind(kind).push(tpl);
					runSafely(this.plugin.saveSettings().then(() => { new Notice(t('codex.notice.templateSaved', { name: tpl.name })); }));
				},
				projectRoot: this.projectRoot ?? undefined,
				initialAliases: parsed.aliases,
				relationChoices: relationChoices(this.plugin.settings.customRelationshipTypes),
				plugin: this.plugin,
				fileBasename: entity.file.basename,
				sheetPath: entity.file.path,
				cleanSlate: parsed.cleanSlate,
			}
		).open();
	}

	/** Inline name-only quick-add row for dense `displayShape: 'row'` kinds. */
	private renderQuickAdd(container: HTMLElement, project: StoryProject): void {
		const kind = this.activeKind;
		const spec = getKindSpec(kind);
		const row = container.createDiv({ cls: 'sg-codex-quickadd' });
		const input = row.createEl('input', {
			cls: 'sg-codex-quickadd-input',
			attr: { type: 'text', placeholder: t('codex.quickAdd.placeholder', { singular: spec.singular.toLowerCase() }) },
		});
		const btn = row.createEl('button', { cls: 'sg-codex-btn sg-codex-quickadd-btn' });
		const bi = btn.createSpan();
		setPhosphorIcon(bi, 'plus', '+');
		btn.createSpan({ text: t('codex.quickAdd.button') });

		const submit = async () => {
			const name = input.value.trim();
			if (!name) { input.focus(); return; }
			input.disabled = true;
			btn.disabled = true;
			try {
				await createEntityFile(this.app, project.rootPath, kind, name, []);
				void this.renderAll();
			} catch (err) {
				new Notice(t('codex.notice.createFailed', { kind, msg: err instanceof Error ? err.message : '' }));
				input.disabled = false;
				btn.disabled = false;
				input.focus();
			}
		};

		input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } });
		btn.addEventListener('click', () => void submit());
	}

	private createEntity(project: StoryProject, kind: EntityKind, parentName?: string): void {
		new EntityModal(
			this.app,
			kind,
			'',
			[],
			async (name, fields, aliases, start) => {
				let file: TFile;
				try {
					file = await createEntityFile(this.app, project.rootPath, kind, name, fields, aliases, start?.cleanSlate);
				} catch (err) {
					// Nothing back: the sheet editor stays open with the writer's work.
					new Notice(t('codex.notice.createFailed', { kind, msg: err instanceof Error ? err.message : '' }));
					return;
				}
				// The sheet exists. From here a hiccup is reported, never a reason to save again (a second copy).
				try {
					if (parentName) {
						// Stored as a wikilink so Obsidian keeps it valid on renames
						await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
							fm['storygrid-parent'] = `[[${parentName}]]`;
						});
					}
					new Notice(
						parentName
							? t('codex.notice.entityCreatedWithParent', { singular: getKindSpec(kind).singular, basename: file.basename, parent: parentName })
							: t('codex.notice.entityCreated', { singular: getKindSpec(kind).singular, basename: file.basename })
					);
					this.plugin.celebrateMilestone('first-sheet', t('codex.milestone.firstEntry'));
					// Show the new entity in the codex detail view instead of a plain markdown tab
					this.detailPath = file.path;
					void this.renderAll();
				} catch (err) {
					reportError(err);
				}
				return file;
			},
			{
				savedTemplates: this.templatesForKind(kind),
				onSaveTemplate: (tpl) => {
					this.templatesForKind(kind).push(tpl);
					runSafely(this.plugin.saveSettings().then(() => { new Notice(t('codex.notice.templateSaved', { name: tpl.name })); }));
				},
				projectRoot: project.rootPath,
				relationChoices: relationChoices(this.plugin.settings.customRelationshipTypes),
				plugin: this.plugin,
			}
		).open();
	}
}

/** Fuzzy picker for a location's new parent — null means top level. */
class ParentPickModal extends FuzzySuggestModal<EntityInfo | null> {
	constructor(
		app: App,
		private candidates: EntityInfo[],
		private onPick: (parent: EntityInfo | null) => void
	) {
		super(app);
		this.setPlaceholder(t('codex.parentPick.placeholder'));
	}

	getItems(): Array<EntityInfo | null> {
		return [null, ...this.candidates];
	}

	getItemText(item: EntityInfo | null): string {
		return item ? item.name : t('codex.parentPick.topLevel');
	}

	onChooseItem(item: EntityInfo | null): void {
		this.onPick(item);
	}
}
