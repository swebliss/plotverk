import { App, ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import type StorygridPlugin from './main';
import { getCodexKindOrder } from './entities/entity-kinds';
import { findCodexScopes, StoryProject } from './entities/entity-manager';
import { parseEntityDocument } from './entities/entity-parse';
import { buildGraphData, legendEntries, bareEdgeCount, isCollapsibleMutualPair, nodesWithinDegrees, membersOfGroups, GraphNode, GraphData, GraphEdge, GraphEntityInput } from './utils/graph-data';
import { buildCustomRegistry, fieldsToRelationSections, findHierarchyLoops, LineStyle } from './utils/relations';
import { edgeGeometry, dashArrayFor, needsRoundCap, intensityStops } from './utils/edge-style';
import { GraphSimulation, SimLinkInput, ForceSettings, DEFAULT_FORCE_SETTINGS } from './utils/force-sim';
import { setPhosphorIcon } from './utils/icons';
import { KIND_COLORS, makeSvg, truncate, pointerDist, isTap } from './utils/graph-shared';
import { renderSearchableSelect, SearchableOption, SearchableSelectHandle } from './ui/searchable-select';
import { StorygridOutlineView } from './outline-view';
import { pickScopeRoot } from './utils/scope-pick';
import { t } from './i18n';

export const VIEW_TYPE_REL_GRAPH = 'storygrid-rel-graph-view';

/** Off / on-hover / always — shared by relationship-type labels and character-name labels. */
type LabelVisibilityMode = 'off' | 'hover' | 'always';

/**
 * Omniscient = today's view, no fading. Ego/Groups fade nodes outside the
 * chosen scope. 'subjective'/'chrono' are reserved, typed-but-never-rendered
 * hooks for the deferred POV and Timeline features (never offered in the
 * Perspective dropdown; only here so a future feature can extend this enum
 * without a saved-state migration).
 */
type Perspective = 'omniscient' | 'ego' | 'groups' | 'subjective' | 'chrono';

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_R = 6;
const MAX_REL_WEIGHT = 3;

/** Two taps on the same node within this window count as a double-click. */
const DOUBLE_TAP_MS = 350;

function ordinalDegree(n: number): string {
	const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
	return `${n}${suffix}-degree`;
}

/**
 * Pull-slider key for an edge: the relationship word exactly as the writer
 * typed it, lowercased. Deliberately NOT `relType.id` — many words share one
 * internal type ("Father"/"Mother" are both `parent`, "Member" is
 * `subordinate`), so keying by type would show sliders under names that never
 * appear on the map. Bare wikilinks have no word and are never tunable.
 */
function relationPullKey(edge: { label: string }): string {
	return edge.label.trim().toLowerCase();
}

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * Renders the force-directed Connections Map into a host element supplied by
 * the caller (`SocialMapsView`). Not an `ItemView` itself — the view shell,
 * tab switching, and vault-event listening live one level up so the same
 * controller instance can be mounted/unmounted as the user flips tabs
 * without losing in-memory layout state.
 */
export class RelGraphController {
	private app: App;

	private scopeRoot = '';
	/** The project Social Maps asked for at mount (the Dashboard's, or a button's); re-picked on every rebuild. */
	private requestedRoot = '';
	private scopes: StoryProject[] = [];
	private graphData: GraphData | null = null;
	private sim: GraphSimulation | null = null;

	// SVG viewport transform
	private tx = 0;
	private ty = 0;
	private scale = 1;
	private svgViewport: SVGGElement | null = null;
	private edgeGroup: SVGGElement | null = null;
	private nodeGroup: SVGGElement | null = null;
	private defsEl: SVGDefsElement | null = null;

	// Hover state
	private hoveredPath: string | null = null;

	// Drag state
	private draggingNodeId: string | null = null;
	private dragStartClientX = 0;
	private dragStartClientY = 0;
	private dragMoved = false;

	// Tap state. The SVG captures the pointer on every pointerdown (see
	// bindSvgEvents), which retargets the synthesized 'click' to the <svg> —
	// so a 'click'/'dblclick' listener on a node <g> never fires. Taps are
	// therefore detected from the pointerdown/up pair, the same events the
	// drag path already relies on.
	private tapCandidate: { node: GraphNode; openFile: boolean } | null = null;
	private lastTap: { path: string; time: number } | null = null;

	// Pan state
	private panning = false;
	private panClientStart = { x: 0, y: 0 };
	private panTxStart = 0;
	private panTyStart = 0;

	// Multi-touch tracking. `panPointerId`/`pinchPointerIds` name the exact
	// pointers that own the current gesture — a 3rd+ touch (a palm edge, the
	// other hand) still lands in `activePointers` for bookkeeping, but must
	// never re-key the gesture. Keying off `activePointers.size` instead let a
	// 3rd finger drive the pinch with cross-finger deltas and snap-zoom the
	// view on the way back down to two. Same pattern as StorygridTreeView.
	private activePointers = new Map<number, { x: number; y: number }>();
	private isPinching = false;
	private pinchStartDist = 0;
	private pinchStartScale = 1;
	private panPointerId: number | null = null;
	private pinchPointerIds: [number, number] | null = null;

	// Filter state (persisted via getState/setState)
	private allGraphData: GraphData | null = null;
	private hiddenKinds = new Set<string>();
	private hiddenRelTypes = new Set<string>();
	nodeLabelMode: LabelVisibilityMode = 'hover';
	edgeLabelMode: LabelVisibilityMode = 'hover';
	private forceSettings: ForceSettings = { ...DEFAULT_FORCE_SETTINGS };

	// Settings panel (transient — not persisted, always starts closed)
	private settingsOpen = false;
	private settingsPanelEl: HTMLElement | null = null;
	private settingsBtnEl: HTMLElement | null = null;

	// Perspective filter (persisted via getState/setState). Toolbar-only —
	// never set by clicking/dragging a node (see the toolbar controls below).
	private perspective: Perspective = 'omniscient';
	private egoAnchor: string | null = null;
	private egoDegrees = 2;
	private selectedGroups = new Set<string>();
	/** Reserved for the deferred Timeline feature — never written by current UI. */
	private chronoEpoch: string | undefined = undefined;

	// Perspective toolbar (transient — rebuilt on every renderToolbar/renderPerspectiveControls call)
	private egoAnchorSelectHandle: SearchableSelectHandle | null = null;
	private groupPopoverOpen = false;
	private groupPopoverEl: HTMLElement | null = null;
	private groupPopoverDocClick: ((e: MouseEvent) => void) | null = null;

	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
	/** Set by resetScope(): the next mount lays out a new project from scratch (fresh centre, fresh layout). */
	private pendingFullReset = false;

	/** Escape closes the settings panel or the group-color popover, whichever
	 *  is open — registered for the lifetime of a mount, torn down in unmount(). */
	private globalKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

	constructor(
		private plugin: StorygridPlugin,
		private host: HTMLElement,
		private getScopeRoot: () => string,
		private onScopeChange: (root: string) => void,
	) {
		this.app = plugin.app;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	mount(): void {
		this.requestedRoot = this.getScopeRoot();
		this.scopeRoot = this.requestedRoot;
		// Hydrate from global settings every mount — covers a fresh tab, a tab
		// switch back from Story Tree, and a scope change, so Filters/Display/
		// Forces always reflect the one saved setting, not stale per-instance state.
		const s = this.plugin.settings;
		this.hiddenKinds = new Set(s.connMapHiddenKinds ?? []);
		// The receiving type was once called 'patron'; a saved hidden filter keeps working under its new id.
		this.hiddenRelTypes = new Set((s.connMapHiddenRelTypes ?? []).map((id) => (id === 'patron' ? 'beneficiary' : id)));
		this.nodeLabelMode = s.connMapNodeLabelMode ?? 'hover';
		this.edgeLabelMode = s.connMapEdgeLabelMode ?? 'hover';
		this.forceSettings = { ...DEFAULT_FORCE_SETTINGS, ...s.connMapForceSettings };

		if (this.globalKeydownHandler) document.removeEventListener('keydown', this.globalKeydownHandler); // dedupe if mount() is ever called twice without an intervening unmount()
		this.globalKeydownHandler = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			if (this.groupPopoverOpen) {
				e.stopPropagation();
				this.closeGroupPopover();
			} else if (this.settingsOpen) {
				e.stopPropagation();
				this.closeSettingsPanel();
			}
		};
		document.addEventListener('keydown', this.globalKeydownHandler);

		const fullReset = this.pendingFullReset;
		this.pendingFullReset = false;
		void this.rebuild({ fullReset });
	}

	unmount(): void {
		// Invalidate any rebuild() still awaiting its load — without this, a
		// rebuild kicked off while this controller was mounted can resolve
		// AFTER the other controller has since rendered into the same shared
		// `host` (see SocialMapsView) and clobber it.
		this._renderGen++;
		this.sim?.stop();
		if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
		if (this.settingsSaveTimer) {
			// Flush rather than drop — a pending debounced save still reflects
			// real user intent (e.g. mid force-slider drag when the tab closed).
			clearTimeout(this.settingsSaveTimer);
			this.settingsSaveTimer = null;
			void this.plugin.saveSettingsQuiet();
		}
		this.egoAnchorSelectHandle?.destroy();
		this.egoAnchorSelectHandle = null;
		this.closeGroupPopover();
		if (this.globalKeydownHandler) {
			document.removeEventListener('keydown', this.globalKeydownHandler);
			this.globalKeydownHandler = null;
		}
		this.host.empty();
	}

	/** Called by the parent view's shared, debounced vault listener. */
	refresh(): void {
		void this.rebuild();
	}

	/** Debounced settings save — avoids a disk write on every slider-drag tick.
	 *  Quiet: force/relationship-pull settings are only ever read by this view,
	 *  so there's no need to broadcast `storygrid:settings-changed` and force
	 *  every other open Plotverk view (Writers Panel, Dashboard, Grid) to
	 *  re-render on each drag tick. */
	private scheduleSettingsSave(): void {
		if (this.settingsSaveTimer) clearTimeout(this.settingsSaveTimer);
		this.settingsSaveTimer = setTimeout(() => {
			this.settingsSaveTimer = null;
			void this.plugin.saveSettingsQuiet();
		}, 400);
	}

	getState(): Record<string, unknown> {
		return {
			perspective: this.perspective,
			egoAnchor: this.egoAnchor,
			egoDegrees: this.egoDegrees,
			selectedGroups: [...this.selectedGroups],
			chronoEpoch: this.chronoEpoch,
		};
	}

	/**
	 * Restore transient UI state. Call before `mount()` — this does not itself render.
	 * Filters/Display/Forces no longer round-trip through here — they live in
	 * `plugin.settings` (global, not per-tab) and `mount()` reads them directly.
	 * The one-time adoption below carries over anything already sitting in an
	 * old saved workspace leaf so upgrading doesn't look like a reset.
	 */
	setState(state: Record<string, unknown>): void {
		const s = this.plugin.settings;
		let migrated = false;
		if (s.connMapHiddenKinds === undefined && Array.isArray(state.hiddenKinds)) {
			s.connMapHiddenKinds = state.hiddenKinds as string[];
			migrated = true;
		}
		if (s.connMapHiddenRelTypes === undefined && Array.isArray(state.hiddenRelTypes)) {
			s.connMapHiddenRelTypes = state.hiddenRelTypes as string[];
			migrated = true;
		}
		if (s.connMapNodeLabelMode === undefined) {
			if (state.nodeLabelMode === 'off' || state.nodeLabelMode === 'hover' || state.nodeLabelMode === 'always') {
				s.connMapNodeLabelMode = state.nodeLabelMode;
				migrated = true;
			} else if (typeof state.showLabelsAlways === 'boolean') {
				// Migrate the old boolean toggle from a previously saved workspace state.
				s.connMapNodeLabelMode = state.showLabelsAlways ? 'always' : 'hover';
				migrated = true;
			}
		}
		if (
			s.connMapEdgeLabelMode === undefined &&
			(state.edgeLabelMode === 'off' || state.edgeLabelMode === 'hover' || state.edgeLabelMode === 'always')
		) {
			s.connMapEdgeLabelMode = state.edgeLabelMode;
			migrated = true;
		}
		if (s.connMapForceSettings === undefined && state.forceSettings && typeof state.forceSettings === 'object') {
			s.connMapForceSettings = state.forceSettings as Partial<ForceSettings>;
			migrated = true;
		}
		if (migrated) void this.plugin.saveSettingsQuiet();

		if (
			state.perspective === 'omniscient' || state.perspective === 'ego' || state.perspective === 'groups' ||
			state.perspective === 'subjective' || state.perspective === 'chrono'
		) {
			this.perspective = state.perspective;
		}
		if (typeof state.egoAnchor === 'string' || state.egoAnchor === null) this.egoAnchor = state.egoAnchor as string | null;
		if (typeof state.egoDegrees === 'number') this.egoDegrees = state.egoDegrees;
		if (Array.isArray(state.selectedGroups)) this.selectedGroups = new Set(state.selectedGroups as string[]);
		if (typeof state.chronoEpoch === 'string') this.chronoEpoch = state.chronoEpoch;
	}

	// ── Build cycle ───────────────────────────────────────────────────────────

	/** Bumped on every rebuild(); a stale async continuation bails out instead
	 *  of clobbering whatever the OTHER controller has since rendered into the
	 *  same shared host (both controllers are mounted into one `bodyEl` — see
	 *  SocialMapsView). Ported from the same `_renderGen` idiom in codex-view.ts. */
	private _renderGen = 0;

	/** `fullReset` forces a fresh center + re-seeded layout — used by scope switches and the toolbar's "Reset layout". */
	async rebuild(opts: { fullReset?: boolean } = {}): Promise<void> {
		const gen = ++this._renderGen;
		const fullReset = opts.fullReset ?? false;

		this.scopes = findCodexScopes(this.app, this.plugin.settings);
		if (this.scopes.length === 0) {
			this.renderEmpty('No story projects found. Create a plot grid first.');
			return;
		}

		// The Dashboard decides the project; a book inside a series shows its whole series.
		const picked = pickScopeRoot(this.scopes, this.requestedRoot, this.plugin.activeSeriesRoot());
		if (picked !== this.scopeRoot) {
			this.scopeRoot = picked;
			this.onScopeChange(picked);
		}

		const entities = await this.loadEntities(this.scopeRoot);
		if (gen !== this._renderGen) return;
		this.allGraphData = buildGraphData(
			entities,
			buildCustomRegistry(this.plugin.settings.customRelationshipTypes),
		);
		// A restored or older focus can name people from another project — drop what isn't here.
		const here = new Set(this.allGraphData.nodes.map((n) => n.path));
		if (this.egoAnchor && !here.has(this.egoAnchor)) this.egoAnchor = null;
		this.selectedGroups = new Set([...this.selectedGroups].filter((p) => here.has(p)));
		this.applyFiltersAndRender(fullReset);
	}

	/** Filter `allGraphData` by current `hiddenKinds` / `hiddenRelTypes` and re-render. */
	applyFiltersAndRender(fullReset = false): void {
		if (!this.allGraphData) return;

		// Capture the live layout before stopping the old sim, so a data
		// refresh (a Codex edit) doesn't visibly reshuffle the graph or
		// reset the user's pan/zoom.
		const prevPositions = new Map<string, { x: number; y: number }>();
		if (!fullReset && this.sim) {
			for (const n of this.sim.nodes()) prevPositions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
		}
		this.sim?.stop();

		// Apply kind + rel-type filters
		let { nodes, edges } = this.allGraphData;

		if (this.hiddenKinds.size > 0) {
			nodes = nodes.filter((n) => !this.hiddenKinds.has(n.kind));
			const allowed = new Set(nodes.map((n) => n.path));
			edges = edges.filter((e) => allowed.has(e.fromPath) && allowed.has(e.toPath));
		}

		if (this.hiddenRelTypes.size > 0) {
			// Bare wikilinks (label='') are never filtered — only labeled relations
			edges = edges.filter((e) => e.label === '' || !this.hiddenRelTypes.has(e.relType.id));
			// Drop nodes that are now isolated
			const connected = new Set(edges.flatMap((e) => [e.fromPath, e.toPath]));
			nodes = nodes.filter((n) => connected.has(n.path));
		}

		this.graphData = { nodes, edges };

		const pulls = this.plugin.settings.connMapRelationPull;
		const simLinks: SimLinkInput[] = edges.map((e) => {
			const key = relationPullKey(e);
			return {
				source: e.fromPath,
				target: e.toPath,
				strength: e.relType.weight / MAX_REL_WEIGHT,
				key,
				pull: (key ? pulls?.[key] : undefined) ?? 1,
			};
		});

		const seedPositions = prevPositions.size > 0 ? prevPositions : undefined;
		this.sim = new GraphSimulation(nodes.map((n) => n.path), simLinks, { seedPositions, forces: this.forceSettings });

		// Only snap-solve + recenter on a true reset (Reset-layout button, or the
		// very first load with no prior sim to carry positions from). A plain
		// filter toggle keeps the camera and lets newly-visible nodes drift into
		// place through the live tick loop below — an instant warmUp() here would
		// re-solve the whole layout in one jump, and force layouts have no fixed
		// orientation, so it can visibly mirror or rotate the graph.
		const freshStart = fullReset || prevPositions.size === 0;
		if (freshStart) this.sim.warmUp(80);

		this.renderAll(!freshStart);

		// Apply character-name label mode + relationship-label mode (independent settings)
		this.host.dataset.nodeLabelMode = this.nodeLabelMode;
		this.host.dataset.edgeLabelMode = this.edgeLabelMode;

		if (nodes.length > 0) {
			this.sim.onTick(() => this.syncPositions()).start();
		}
	}

	private async loadEntities(scopeRoot: string): Promise<GraphEntityInput[]> {
		const out: GraphEntityInput[] = [];
		for (const kind of getCodexKindOrder()) {
			for (const info of this.plugin.entityIndex.list(scopeRoot, kind)) {
				try {
					const text = await this.app.vault.cachedRead(info.file);
					const parsed = parseEntityDocument(text, info.file.basename);
					const sections = fieldsToRelationSections(parsed.fields);
					out.push({ path: info.file.path, name: info.file.basename, kind, sections, imagePath: info.imagePath ?? null });
				} catch {
					// skip malformed files
				}
			}
		}
		return out;
	}

	// ── Render ────────────────────────────────────────────────────────────────

	private renderEmpty(msg: string): void {
		this.host.empty();
		this.host.createDiv({ cls: 'sg-rg-empty' }).createEl('p', { text: msg });
	}

	/**
	 * "No connections yet" is the single best moment to teach the
	 * `Label: [[Target]]` prose convention that drives this whole view — the
	 * map is otherwise a blank canvas with no visible reason to exist. A faded
	 * ghost graph (real SVG markup, not a screenshot) shows the destination;
	 * a code-styled example line shows exactly what to type to get there.
	 */
	private renderNoConnectionsState(root: HTMLElement): void {
		const wrap = root.createDiv({ cls: 'sg-rg-no-connections' });

		const ghostSvg = makeSvg('svg', { class: 'sg-rg-ghost-svg sg-ghost', viewBox: '0 0 220 120' }) as SVGSVGElement;
		const positions: Array<[number, number]> = [[110, 24], [40, 96], [180, 96]];
		const [a, b, c] = positions;
		for (const [x1, y1] of [a]) {
			for (const [x2, y2] of [b, c]) {
				const line = makeSvg('line', {
					x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2),
					stroke: 'currentColor', 'stroke-width': '1.5',
				});
				ghostSvg.appendChild(line);
			}
		}
		for (const [x, y] of positions) {
			const dot = makeSvg('circle', { cx: String(x), cy: String(y), r: '9', fill: 'currentColor' });
			ghostSvg.appendChild(dot);
		}
		wrap.appendChild(ghostSvg);

		wrap.createEl('h3', { text: 'See how your characters connect' });
		wrap.createEl('p', {
			text: 'This map draws itself from lines already on your character entries. Open any entry and add a line like:',
		});
		wrap.createEl('code', { cls: 'sg-rg-example-line', text: 'Mother: [[Elena Voss]]' });
		wrap.createEl('p', {
			cls: 'sg-rg-example-note',
			text: 'Family words (Mother, Father, Partner…) become tree branches; anything else becomes a labeled connection.',
		});

		const btn = wrap.createEl('button', { cls: 'sg-rg-empty-cta', text: 'Open the Codex' });
		btn.addEventListener('click', () => void this.plugin.openCodex(this.scopeRoot));
	}

	private renderAll(preserveView = false): void {
		// The old toolbar's Ego anchor picker (if mounted) portals a panel to
		// <body> and holds document-level listeners — host.empty() below would
		// orphan it if not torn down first.
		this.egoAnchorSelectHandle?.destroy();
		this.egoAnchorSelectHandle = null;
		this.closeGroupPopover();
		this.host.empty();
		this.svgViewport = null;
		this.edgeGroup = null;
		this.nodeGroup = null;
		this.defsEl = null;
		this.hoveredPath = null;
		if (!preserveView) { this.tx = 0; this.ty = 0; this.scale = 1; }

		if (!this.graphData || !this.sim) return;

		const root = this.host.createDiv({ cls: 'sg-rg-root' });
		this.renderToolbar(root);
		this.renderSettingsPanel(root);

		if (this.graphData.nodes.length === 0) {
			this.renderNoConnectionsState(root);
			this.renderLegend(root);
			return;
		}

		if (this.graphData.nodes.length > 80) {
			root.createDiv({ cls: 'sg-rg-large-graph-warning' }).createEl('p', {
				text: `Large graph (${this.graphData.nodes.length} nodes) — use the filters above to focus on a subset for best performance.`,
			});
		}

		this.renderLoopWarning(root);

		const svgWrap = root.createDiv({ cls: 'sg-rg-svg-wrap' });
		const svg = makeSvg('svg', { class: 'sg-rg-svg' }) as SVGSVGElement;
		svgWrap.appendChild(svg);

		const defs = makeSvg('defs') as SVGDefsElement;
		svg.appendChild(defs);
		this.defsEl = defs;
		this.addArrowMarkers(defs);

		const vp = makeSvg('g', { class: 'sg-rg-viewport' }) as SVGGElement;
		svg.appendChild(vp);
		this.svgViewport = vp;

		this.edgeGroup = makeSvg('g', { class: 'sg-rg-edges' }) as SVGGElement;
		vp.appendChild(this.edgeGroup);
		this.nodeGroup = makeSvg('g', { class: 'sg-rg-nodes' }) as SVGGElement;
		vp.appendChild(this.nodeGroup);

		this.renderEdges();
		this.renderNodes();
		this.applyPerspectiveFade();
		this.renderLegend(root);
		this.bindSvgEvents(svg, svgWrap);

		if (preserveView) {
			this.applyTransform();
		} else {
			requestAnimationFrame(() => this.centerViewport(svg));
		}
	}

	private renderToolbar(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: 'sg-rg-toolbar' });

		// Just the name: the project is changed in the Dashboard, never here.
		bar.createSpan({
			cls: 'sg-rg-scope-name',
			text: this.scopes.find((s) => s.rootPath === this.scopeRoot)?.name ?? '—',
			attr: { title: t('socialMaps.projectHint') },
		});

		const zoomWrap = bar.createDiv({ cls: 'sg-rg-zoom' });
		const zoomOut = zoomWrap.createEl('button', { cls: 'sg-rg-zoom-btn', title: 'Zoom out', attr: { 'aria-label': 'Zoom out' } });
		setPhosphorIcon(zoomOut, 'minus', '−');
		const zoomIn = zoomWrap.createEl('button', { cls: 'sg-rg-zoom-btn', title: 'Zoom in', attr: { 'aria-label': 'Zoom in' } });
		setPhosphorIcon(zoomIn, 'plus', '+');
		zoomOut.addEventListener('click', () => this.applyZoom(this.scale / 1.25));
		zoomIn.addEventListener('click', () => this.applyZoom(this.scale * 1.25));

		const perspectiveWrap = bar.createDiv({ cls: 'sg-rg-perspective' });
		this.renderPerspectiveControls(perspectiveWrap);

		const refreshBtn = bar.createEl('button', { cls: 'sg-rg-refresh-btn', title: 'Reset layout', attr: { 'aria-label': 'Reset layout' } });
		setPhosphorIcon(refreshBtn, 'arrows-clockwise', '↺');
		refreshBtn.addEventListener('click', () => void this.rebuild({ fullReset: true }));

		const settingsBtn = bar.createEl('button', {
			cls: `sg-rg-settings-btn${this.settingsOpen ? ' is-active' : ''}`,
			title: 'Filters & display settings',
			attr: { 'aria-label': 'Filters & display settings' },
		});
		setPhosphorIcon(settingsBtn, 'gear', '⚙');
		settingsBtn.addEventListener('click', () => {
			this.settingsOpen = !this.settingsOpen;
			this.settingsPanelEl?.classList.toggle('is-open', this.settingsOpen);
			settingsBtn.classList.toggle('is-active', this.settingsOpen);
		});
		this.settingsBtnEl = settingsBtn;
	}

	// ── Perspective filter (toolbar-only — never set by clicking a node) ──────

	/**
	 * Rebuilds just the `.sg-rg-perspective` toolbar group: the mode select,
	 * plus whichever sub-controls the current mode needs (Ego's anchor picker
	 * + degree slider, or Groups' checklist button). Called on mount and again
	 * whenever the mode itself changes — cheap, since it never touches the SVG.
	 */
	private renderPerspectiveControls(wrap: HTMLElement): void {
		// The searchable-select panel is portaled to <body> — destroy it before
		// wrap.empty() below orphans it (and its document listeners).
		this.egoAnchorSelectHandle?.destroy();
		this.egoAnchorSelectHandle = null;
		this.closeGroupPopover();
		wrap.empty();

		wrap.createSpan({ cls: 'sg-rg-perspective-label', text: 'Perspective:' });

		const select = wrap.createEl('select', { cls: 'sg-rg-perspective-select' });
		const perspectiveOptions: Array<{ value: Perspective; label: string }> = [
			{ value: 'omniscient', label: 'Omniscient' },
			{ value: 'ego', label: 'Ego' },
			{ value: 'groups', label: 'Groups' },
		];
		for (const opt of perspectiveOptions) {
			const optionEl = select.createEl('option', { value: opt.value, text: opt.label });
			if (opt.value === this.perspective) optionEl.selected = true;
		}
		select.addEventListener('change', () => {
			this.perspective = select.value as Perspective;
			this.renderPerspectiveControls(wrap);
			this.applyPerspectiveFade();
		});

		if (this.perspective === 'ego') {
			const anchorHost = wrap.createDiv({ cls: 'sg-rg-ego-anchor' });
			const characterOptions: SearchableOption[] = (this.allGraphData?.nodes ?? [])
				.filter((n) => n.kind === 'character')
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((n) => ({ value: n.path, label: n.name }));
			this.egoAnchorSelectHandle = renderSearchableSelect(anchorHost, {
				options: characterOptions,
				placeholder: 'Choose a character…',
				searchPlaceholder: 'Search characters…',
				value: this.egoAnchor ?? '',
				onChange: (value) => {
					this.egoAnchor = value || null;
					this.applyPerspectiveFade();
				},
			});

			const degreesWrap = wrap.createDiv({ cls: 'sg-rg-ego-degrees' });
			const slider = degreesWrap.createEl('input', {
				cls: 'sg-rg-ego-degrees-slider',
				attr: { type: 'range', min: '1', max: '4', step: '1', value: String(this.egoDegrees) },
			});
			const readout = degreesWrap.createSpan({ cls: 'sg-rg-ego-degrees-val', text: ordinalDegree(this.egoDegrees) });
			slider.addEventListener('input', () => {
				this.egoDegrees = Number(slider.value);
				readout.setText(ordinalDegree(this.egoDegrees));
				this.applyPerspectiveFade();
			});
		}

		if (this.perspective === 'groups') {
			const groupBtn = wrap.createEl('button', { cls: 'sg-rg-group-btn' });
			groupBtn.setText(`Choose groups${this.selectedGroups.size > 0 ? ` (${this.selectedGroups.size})` : ''} ▾`);
			groupBtn.addEventListener('click', () => this.toggleGroupPopover(wrap, groupBtn));
		}
	}

	/** Popover checklist of scope factions/locations, anchored under the group button. */
	private toggleGroupPopover(wrap: HTMLElement, btn: HTMLElement): void {
		if (this.groupPopoverOpen) { this.closeGroupPopover(); return; }
		this.groupPopoverOpen = true;

		const popover = wrap.createDiv({ cls: 'sg-rg-group-popover' });
		this.groupPopoverEl = popover;

		const groupNodes = (this.allGraphData?.nodes ?? [])
			.filter((n) => n.kind === 'faction' || n.kind === 'location')
			.sort((a, b) => a.name.localeCompare(b.name));

		if (groupNodes.length === 0) {
			popover.createDiv({ cls: 'sg-rg-group-popover-empty', text: 'No factions or locations yet.' });
		} else {
			for (const node of groupNodes) {
				const row = popover.createEl('label', { cls: 'sg-rg-group-popover-row' });
				const checkbox = row.createEl('input', { attr: { type: 'checkbox' } });
				checkbox.checked = this.selectedGroups.has(node.path);
				const dot = row.createSpan({ cls: 'sg-rg-pill-dot' });
				dot.style.background = KIND_COLORS[node.kind] ?? '#6b7280';
				row.createSpan({ text: node.name });
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) this.selectedGroups.add(node.path);
					else this.selectedGroups.delete(node.path);
					btn.setText(`Choose groups${this.selectedGroups.size > 0 ? ` (${this.selectedGroups.size})` : ''} ▾`);
					this.applyPerspectiveFade();
				});
			}
		}

		// Same outside-click convention as searchable-select.ts: register now,
		// and rely on `wrap.contains(target)` (true for the button that opened
		// it) rather than stopPropagation to avoid re-closing on this same click.
		this.groupPopoverDocClick = (e: MouseEvent) => {
			if (!wrap.contains(e.target as Node)) this.closeGroupPopover();
		};
		document.addEventListener('click', this.groupPopoverDocClick);
	}

	private closeGroupPopover(): void {
		this.groupPopoverOpen = false;
		this.groupPopoverEl?.remove();
		this.groupPopoverEl = null;
		if (this.groupPopoverDocClick) {
			document.removeEventListener('click', this.groupPopoverDocClick);
			this.groupPopoverDocClick = null;
		}
	}

	/**
	 * Toggles `.sg-rg-node` / `.sg-rg-edge` / `.sg-rg-edge-label` `is-faded` to
	 * reflect the current perspective. Independent of hover dimming (a
	 * different class, applied by `applyHover`) — the two compose rather than
	 * conflict. Omniscient, or Ego/Groups with nothing chosen yet, fades nothing.
	 */
	private applyPerspectiveFade(): void {
		if (!this.nodeGroup || !this.edgeGroup || !this.graphData) return;

		let visible: Set<string> | null = null;
		if (this.perspective === 'ego' && this.egoAnchor) {
			visible = nodesWithinDegrees(this.graphData, this.egoAnchor, this.egoDegrees);
		} else if (this.perspective === 'groups' && this.selectedGroups.size > 0) {
			visible = membersOfGroups(this.graphData, [...this.selectedGroups]);
			for (const groupPath of this.selectedGroups) visible.add(groupPath);
		}

		this.nodeGroup.querySelectorAll<SVGGElement>('.sg-rg-node').forEach((g) => {
			const path = g.dataset.path ?? '';
			g.classList.toggle('is-faded', visible !== null && !visible.has(path));
		});
		this.edgeGroup.querySelectorAll<SVGPathElement>('.sg-rg-edge').forEach((path) => {
			const a = path.dataset.a ?? '';
			const b = path.dataset.b ?? '';
			path.classList.toggle('is-faded', visible !== null && (!visible.has(a) || !visible.has(b)));
		});
		this.edgeGroup.querySelectorAll<SVGTextElement>('.sg-rg-edge-label').forEach((label) => {
			const a = label.dataset.a ?? '';
			const b = label.dataset.b ?? '';
			label.classList.toggle('is-faded', visible !== null && (!visible.has(a) || !visible.has(b)));
		});
	}

	private addArrowMarkers(defs: SVGDefsElement): void {
		const colors = new Set<string>();
		if (this.graphData) {
			for (const e of this.graphData.edges) colors.add(e.label ? e.relType.color : 'var(--text-faint)');
		}
		for (const color of colors) {
			const marker = makeSvg('marker', {
				id: arrowMarkerId(color),
				markerWidth: '4', markerHeight: '4',
				refX: '3', refY: '2',
				orient: 'auto', markerUnits: 'strokeWidth',
			}) as SVGMarkerElement;
			const path = makeSvg('path', { d: 'M0,0 L0,4 L4,2 z', fill: color });
			marker.appendChild(path);
			defs.appendChild(marker);
		}
	}

	/**
	 * Collapse the directed edge list into one entry per unordered pair, keeping
	 * both directions when each character declares their own relation.
	 * `aToB` = how A regards B (A's sheet), `bToA` = how B regards A (B's sheet).
	 */
	private mergedPairs(): MergedPair[] {
		const map = new Map<string, MergedPair>();
		// Family/rank words ('parent'/'superior' category) get direction-normalized
		// upstream so the arrow always points down the hierarchy — but when BOTH
		// sheets declare their own side of the same bond ("Father: [[Lucius]]" on
		// Draco's sheet AND "Son: [[Draco]]" on Lucius's), both facts land on this
		// same directed slot. Prefer the normalized ('parent'/'superior') edge —
		// its label correctly names the source node's own role; the other is the
		// identical fact phrased from the target's side and would read backwards
		// once shown on this end of the line.
		const rank = (e: GraphEdge): number =>
			e.relType.category === 'parent' || e.relType.category === 'superior' ? 1 : 0;
		for (const e of this.graphData!.edges) {
			const [a, b] = e.fromPath < e.toPath ? [e.fromPath, e.toPath] : [e.toPath, e.fromPath];
			const key = `${a} ${b}`;
			let m = map.get(key);
			if (!m) { m = { a, b, aToB: null, bToA: null, bare: false }; map.set(key, m); }
			if (e.label === '') { m.bare = true; continue; }
			if (e.fromPath === a) {
				if (!m.aToB || rank(e) >= rank(m.aToB)) m.aToB = e;
			} else {
				if (!m.bToA || rank(e) >= rank(m.bToA)) m.bToA = e;
			}
		}
		return [...map.values()];
	}

	private renderEdges(): void {
		if (!this.edgeGroup || !this.graphData || !this.sim) return;

		let gradIndex = 0;

		for (const pair of this.mergedPairs()) {
			const colorA = pair.aToB?.relType.color;   // how A feels about B → arrow at B
			const colorB = pair.bToA?.relType.color;   // how B feels about A → arrow at A

			// Both sides declare the SAME reciprocal-behavior type (Rival, Enemy…) with
			// bond strengths far enough apart to draw as a fading gradient instead of
			// today's flat split line. Missing/close intensities fall through untouched.
			const reciprocalStops = pair.aToB && pair.bToA
				&& pair.aToB.relType.behavior === 'reciprocal'
				&& pair.aToB.relType.id === pair.bToA.relType.id
				? intensityStops(pair.aToB.intensity, pair.bToA.intensity)
				: null;

			const tip = reciprocalStops
				? reciprocalIntensityTooltip(pair, this.nodeName(pair.a), this.nodeName(pair.b))
				: pairTooltip(pair, this.nodeName(pair.a), this.nodeName(pair.b));

			// Common data written on every segment of this pair.
			const common: Record<string, string> = {
				class: 'sg-rg-edge',
				'data-a': pair.a,
				'data-b': pair.b,
			};
			if (colorA) common['data-color-a'] = colorA; // hovering A shows A's outgoing color
			if (colorB) common['data-color-b'] = colorB; // hovering B shows B's outgoing color

			const addSeg = (role: EdgeRole, color: string, weight: number, style: LineStyle, arrowColor?: string, opts?: { skipHoverColor?: boolean }) => {
				const attrs: Record<string, string> = {
					...common,
					'data-role': role,
					'data-style': style,
					stroke: color,
					fill: 'none',
					'stroke-width': String(weight),
				};
				// The gradient stroke fades intensity end-to-end — the hover recolor
				// (below) would flatten it to a solid color, so this segment opts out.
				if (opts?.skipHoverColor) {
					delete attrs['data-color-a'];
					delete attrs['data-color-b'];
				}
				const dasharray = dashArrayFor(style, weight);
				if (dasharray) attrs['stroke-dasharray'] = dasharray;
				if (needsRoundCap(style)) attrs['stroke-linecap'] = 'round';
				// Mutual relations read the same both ways — an arrowhead would
				// wrongly imply direction, so they never get one even when only
				// one sheet declares the relation.
				if (arrowColor) attrs['marker-end'] = `url(#${arrowMarkerId(arrowColor)})`;

				const makeSeg = (twin: boolean) => {
					const path = makeSvg('path', twin ? { ...attrs, 'data-twin': '1' } : attrs);
					if (twin) path.removeAttribute('marker-end'); // one arrowhead per pair, not two
					const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
					t.textContent = tip;
					path.appendChild(t);
					this.edgeGroup!.appendChild(path);
				};
				makeSeg(false);
				if (style === 'double') makeSeg(true);
			};

			const addLabel = (text: string, pos: 'mid' | 'a' | 'b' = 'mid') => {
				const label = makeSvg('text', {
					class: 'sg-rg-edge-label',
					'data-a': pair.a,
					'data-b': pair.b,
					'data-pos': pos,
					'text-anchor': 'middle',
					'font-size': '9',
					'paint-order': 'stroke fill',
					stroke: 'var(--background-primary)',
					'stroke-width': '3',
				});
				label.textContent = text;
				this.edgeGroup!.appendChild(label);
			};

			if (isCollapsibleMutualPair(pair.aToB ?? undefined, pair.bToA ?? undefined)) {
				// Both sheets declare the same mutual type ("Spouse" both ways) —
				// one clean line, no arrow, the type word centered on it.
				const rt = pair.aToB!.relType;
				addSeg('full-mutual', rt.color, rt.weight, rt.lineStyle);
				addLabel(rt.edgeLabel ?? rt.displayLabel);
			} else if (reciprocalStops) {
				// Imbalanced reciprocal pair (e.g. Aldric's Enemy 9 vs Beron's Enemy 2) —
				// one line, same type color both ends, opacity fading per declared strength.
				const rt = pair.aToB!.relType;
				const gradId = `sg-rg-grad-${gradIndex++}`;
				const grad = makeSvg('linearGradient', {
					id: gradId,
					class: 'sg-rg-edge-gradient',
					gradientUnits: 'userSpaceOnUse',
					'data-a': pair.a,
					'data-b': pair.b,
				});
				grad.appendChild(makeSvg('stop', { offset: '0%', 'stop-color': rt.color, 'stop-opacity': String(reciprocalStops.opacityA) }));
				grad.appendChild(makeSvg('stop', { offset: '100%', 'stop-color': rt.color, 'stop-opacity': String(reciprocalStops.opacityB) }));
				this.defsEl?.appendChild(grad);

				const maxIntensity = Math.max(pair.aToB!.intensity!, pair.bToA!.intensity!);
				const weight = rt.weight * (0.6 + (maxIntensity / 10) * 0.8);
				addSeg('full-reciprocal', `url(#${gradId})`, weight, rt.lineStyle, undefined, { skipHoverColor: true });
				addLabel(rt.edgeLabel ?? rt.displayLabel);
			} else if (pair.aToB && pair.bToA) {
				// Two views → split line: A-half colored by B's view (arrow at A),
				// B-half colored by A's view (arrow at B). Each half gets its own
				// label near that end, matching which type is declared there.
				const rtB = pair.bToA.relType, rtA = pair.aToB.relType;
				addSeg('a', colorB!, rtB.weight, rtB.lineStyle, rtB.behavior === 'mutual' ? undefined : colorB);
				addSeg('b', colorA!, rtA.weight, rtA.lineStyle, rtA.behavior === 'mutual' ? undefined : colorA);
				// Each label sits by the person who wrote it — not by the segment
				// whose arrow/color it happens to drive — so it reads as that
				// person's own declared role instead of the other way round.
				addLabel(pair.aToB.label || rtA.displayLabel, 'a');
				addLabel(pair.bToA.label || rtB.displayLabel, 'b');
			} else if (pair.aToB) {
				const rt = pair.aToB.relType;
				addSeg('full-ab', colorA!, rt.weight, rt.lineStyle, rt.behavior === 'mutual' ? undefined : colorA);
				addLabel(pair.aToB.label || rt.displayLabel);
			} else if (pair.bToA) {
				const rt = pair.bToA.relType;
				addSeg('full-ba', colorB!, rt.weight, rt.lineStyle, rt.behavior === 'mutual' ? undefined : colorB);
				addLabel(pair.bToA.label || rt.displayLabel);
			} else {
				// Bare connection only — thin gray line, no arrow.
				addSeg('full-ab', 'var(--text-faint)', 0.5, 'solid');
			}
		}
	}

	private nodeName(path: string): string {
		return this.graphData?.nodes.find((n) => n.path === path)?.name ?? path;
	}

	/** Shortened endpoints + midpoint for a pair, derived from live sim positions. */
	private segGeom(a: string, b: string): SegGeom | null {
		const pa = this.sim?.getNode(a);
		const pb = this.sim?.getNode(b);
		if (!pa || !pb) return null;
		const [ax, ay, bx, by] = shortenLine(pa.x ?? 0, pa.y ?? 0, pb.x ?? 0, pb.y ?? 0, NODE_R + 4);
		return { ax, ay, bx, by, mx: (ax + bx) / 2, my: (ay + by) / 2 };
	}

	private renderNodes(): void {
		if (!this.nodeGroup || !this.graphData || !this.sim) return;

		// Safe to call repeatedly (e.g. live from the Display settings) — clear
		// out any previously rendered nodes and their clip-paths first.
		while (this.nodeGroup.firstChild) this.nodeGroup.removeChild(this.nodeGroup.firstChild);
		this.defsEl?.querySelectorAll('[id^="sg-rg-clip-"]').forEach((el) => el.remove());

		// Degree map: path → number of edges (both directions)
		const degree = new Map<string, number>();
		for (const edge of this.graphData.edges) {
			degree.set(edge.fromPath, (degree.get(edge.fromPath) ?? 0) + 1);
			degree.set(edge.toPath, (degree.get(edge.toPath) ?? 0) + 1);
		}

		const scaleBySize = this.plugin.settings.connMapScaleBySize !== false;
		const showPortraits = this.plugin.settings.connMapNodeDisplay === 'portrait';
		const defs = this.defsEl;
		let portraitCounter = 0;

		for (const node of this.graphData.nodes) {
			const p = this.sim.getNode(node.path);
			if (!p) continue;

			const color = KIND_COLORS[node.kind] ?? '#6b7280';
			const connections = degree.get(node.path) ?? 1;
			const r = scaleBySize ? Math.min(NODE_R + Math.sqrt(connections - 1) * 1.5, 9) : NODE_R;

			const g = makeSvg('g', {
				class: 'sg-rg-node',
				transform: `translate(${p.x ?? 0},${p.y ?? 0})`,
				'data-path': node.path,
				tabindex: '0',
				role: 'button',
				'aria-label': node.name,
			}) as SVGGElement;

			const imgFile = showPortraits && node.imagePath
				? this.app.vault.getAbstractFileByPath(node.imagePath)
				: null;

			if (imgFile instanceof TFile && defs) {
				const portraitR = r * 2;
				const clipId = `sg-rg-clip-${portraitCounter++}`;
				const clip = makeSvg('clipPath', { id: clipId }) as SVGClipPathElement;
				clip.appendChild(makeSvg('circle', { r: String(portraitR) }));
				defs.appendChild(clip);

				const image = makeSvg('image', {
					x: String(-portraitR), y: String(-portraitR), width: String(portraitR * 2), height: String(portraitR * 2),
					href: this.app.vault.getResourcePath(imgFile),
					'clip-path': `url(#${clipId})`,
					preserveAspectRatio: 'xMidYMid slice',
				});
				g.appendChild(image);
				g.appendChild(makeSvg('circle', {
					r: String(portraitR), fill: 'none', stroke: color, 'stroke-width': '2', class: 'sg-rg-node-circle has-portrait',
				}));

				const label = makeSvg('text', {
					'text-anchor': 'middle',
					y: String(Math.round(portraitR) + 11),
					fill: 'var(--text-normal)',
					'font-size': '10',
					'pointer-events': 'none',
					class: 'sg-rg-node-label',
					'paint-order': 'stroke fill',
					stroke: 'var(--background-primary)',
					'stroke-width': '3',
					'stroke-linejoin': 'round',
				});
				label.textContent = truncate(node.name, 26);
				g.appendChild(label);
			} else {
				const circle = makeSvg('circle', {
					r: String(Math.round(r)),
					fill: color,
					class: 'sg-rg-node-circle',
				});
				g.appendChild(circle);

				const label = makeSvg('text', {
					'text-anchor': 'middle',
					y: String(Math.round(r) + 11),
					fill: 'var(--text-normal)',
					'font-size': '10',
					'pointer-events': 'none',
					class: 'sg-rg-node-label',
					'paint-order': 'stroke fill',
					stroke: 'var(--background-primary)',
					'stroke-width': '3',
					'stroke-linejoin': 'round',
				});
				label.textContent = truncate(node.name, 26);
				g.appendChild(label);
			}

			this.bindNodeEvents(g, node);
			this.nodeGroup.appendChild(g);
		}
	}

	// ── Hover state ───────────────────────────────────────────────────────────

	private applyHover(hoveredPath: string | null): void {
		if (!this.edgeGroup || !this.nodeGroup || !this.graphData) return;
		this.hoveredPath = hoveredPath;

		if (!hoveredPath) {
			this.edgeGroup.querySelectorAll<SVGPathElement>('.sg-rg-edge').forEach((path) => {
				path.classList.remove('is-highlighted', 'is-dimmed');
				path.style.stroke = '';
			});
			this.edgeGroup.querySelectorAll<SVGTextElement>('.sg-rg-edge-label').forEach((label) => {
				label.classList.remove('is-highlighted', 'is-dimmed');
			});
			this.nodeGroup.querySelectorAll('.sg-rg-node').forEach((el) => {
				el.classList.remove('is-hovered', 'is-connected', 'is-dimmed');
			});
			return;
		}

		// Connected paths for this node
		const connected = new Set<string>();
		for (const edge of this.graphData.edges) {
			if (edge.fromPath === hoveredPath) connected.add(edge.toPath);
			else if (edge.toPath === hoveredPath) connected.add(edge.fromPath);
		}

		// Style edges — a touched line recolors to the hovered character's own view
		// of the relationship (their outgoing color). Falls back to the segment's
		// resting color when the hovered end declared nothing.
		this.edgeGroup.querySelectorAll<SVGPathElement>('.sg-rg-edge').forEach((path) => {
			const a = path.dataset.a ?? '';
			const b = path.dataset.b ?? '';
			const touches = a === hoveredPath || b === hoveredPath;
			path.classList.toggle('is-highlighted', touches);
			path.classList.toggle('is-dimmed', !touches);

			if (touches) {
				const outColor = hoveredPath === a ? path.dataset.colorA : path.dataset.colorB;
				path.style.stroke = outColor ?? '';
			} else {
				path.style.stroke = '';
			}
		});

		// Edge labels dim/highlight in step with their line (same touch test).
		this.edgeGroup.querySelectorAll<SVGTextElement>('.sg-rg-edge-label').forEach((label) => {
			const a = label.dataset.a ?? '';
			const b = label.dataset.b ?? '';
			const touches = a === hoveredPath || b === hoveredPath;
			label.classList.toggle('is-highlighted', touches);
			label.classList.toggle('is-dimmed', !touches);
		});

		// Style nodes
		this.nodeGroup.querySelectorAll<SVGGElement>('.sg-rg-node').forEach((g) => {
			const path = g.dataset.path ?? '';
			const isHovered = path === hoveredPath;
			const isConnected = connected.has(path);
			g.classList.toggle('is-hovered', isHovered);
			g.classList.toggle('is-connected', isConnected);
			g.classList.toggle('is-dimmed', !isHovered && !isConnected);
		});
	}

	// ── Node events ───────────────────────────────────────────────────────────

	private bindNodeEvents(g: SVGGElement, node: GraphNode): void {
		// Hover: mouse only (touch has no hover state)
		g.addEventListener('pointerenter', (e: PointerEvent) => {
			if (e.pointerType === 'mouse') this.applyHover(node.path);
		});
		g.addEventListener('pointerleave', (e: PointerEvent) => {
			// svg.setPointerCapture() (called on the svg's own pointerdown, for
			// pan/pinch) makes the browser fire a spurious pointerleave on the node
			// you're pressing — without this guard the dim effect flickers off for
			// the whole press-and-hold and back on at release. A real leave (moving
			// off a node you're not pressing) still clears hover normally.
			if (e.pointerType === 'mouse' && this.draggingNodeId !== node.path) this.applyHover(null);
		});

		g.addEventListener('pointerdown', (e: PointerEvent) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			// Don't stopPropagation — svg pointerdown must also fire to call setPointerCapture
			this.draggingNodeId = node.path;
			this.dragStartClientX = e.clientX;
			this.dragStartClientY = e.clientY;
			this.dragMoved = false;
			this.tapCandidate = { node, openFile: e.ctrlKey || e.metaKey };
			// Pinning + reheating the sim here (unconditionally, on every pointerdown)
			// used to make the whole graph visibly jiggle on a plain click/tap, since
			// a tap is also a pointerdown — deferred to pointermove, once real drag
			// movement is confirmed, so a click that never moves never reheats.
			g.classList.add('is-dragging');
		});

		// Keyboard equivalent of a plain click (see onPointerUp in bindSvgEvents) —
		// the node <g> is tabindex="0"/role="button" above, but had no key handler at all.
		g.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.previewNode(node);
			}
		});
	}

	/** True when this tap follows another on the same node inside the double-tap window. */
	private isDoubleTap(path: string): boolean {
		const now = Date.now();
		const isDouble = this.lastTap?.path === path && now - this.lastTap.time < DOUBLE_TAP_MS;
		this.lastTap = isDouble ? null : { path, time: now };
		return isDouble;
	}

	private openNodeFile(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		// Codex entries open as their Codex page; anything else as the note.
		if (file instanceof TFile) void this.plugin.openEntryInCodex(this.scopeRoot, file.path, 'map');
	}

	/** Single click on a node: open/refresh the Writers Panel preview.
	 *  Deliberately the same in every perspective mode — Ego anchor selection
	 *  stays toolbar-only (see the Perspective controls), never set by
	 *  clicking a node. */
	private previewNode(node: GraphNode): void {
		void (async () => {
			const view = await this.plugin.revealOutline();
			if (view instanceof StorygridOutlineView) {
				await view.showEntityPreview(this.scopeRoot, node.path);
			}
		})();
	}

	/**
	 * Finish an in-progress node drag: release the pin and cool the sim only if
	 * a real drag ever pinned it (a plain tap never touched the sim), then drop
	 * the visual state. Called both when the dragging pointer lifts and when a
	 * 2nd finger turns the gesture into a pinch — a pinch that left the node
	 * half-dragged meant the leftover finger silently kept dragging it.
	 */
	private endNodeDrag(): void {
		if (this.draggingNodeId && this.dragMoved) {
			this.sim?.releaseNode(this.draggingNodeId);
			this.sim?.coolDown();
		}
		this.nodeGroup?.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
		this.draggingNodeId = null;
		this.dragMoved = false;
	}

	// ── SVG pan / zoom ────────────────────────────────────────────────────────

	private bindSvgEvents(svg: SVGSVGElement, wrap: HTMLElement): void {
		// Scroll-to-zoom (mouse wheel only)
		wrap.addEventListener('wheel', (e: WheelEvent) => {
			e.preventDefault();
			this.applyZoom(this.scale * (e.deltaY < 0 ? 1.1 : 0.9), { x: e.clientX, y: e.clientY });
		}, { passive: false });

		svg.addEventListener('pointerdown', (e: PointerEvent) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			svg.setPointerCapture(e.pointerId);
			this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

			// A pinch already owns its two pointers — a 3rd+ touch must never
			// re-key it or re-arm a pan with cross-finger deltas. It is still
			// recorded above so cleanup and "is anything still down?" checks stay
			// correct, but it drives nothing.
			if (this.pinchPointerIds) return;

			const others = Array.from(this.activePointers.keys()).filter((id) => id !== e.pointerId);
			if (others.length === 1) {
				// A 2nd pointer upgrades whatever the first one was doing — a pan
				// OR a node drag — into a pinch, keyed to exactly these two ids.
				this.isPinching = true;
				this.panning = false;
				this.panPointerId = null;
				svg.style.cursor = '';
				this.pinchPointerIds = [others[0], e.pointerId];
				const a = this.activePointers.get(others[0]);
				const b = this.activePointers.get(e.pointerId);
				this.pinchStartDist = a && b ? pointerDist(a, b) : 0;
				this.pinchStartScale = this.scale;
				// A pinch is never a tap, and must not leave a node half-dragged:
				// otherwise the finger still down when the pinch ends keeps
				// dragging that node (pinning it + reheating the sim), and its
				// release resolves as a tap that hijacks the Writers Panel preview.
				this.tapCandidate = null;
				this.endNodeDrag();
				return;
			}

			// First pointer down, and not on a node → pan.
			if (!this.draggingNodeId) {
				this.panning = true;
				this.panPointerId = e.pointerId;
				this.panClientStart = { x: e.clientX, y: e.clientY };
				this.panTxStart = this.tx;
				this.panTyStart = this.ty;
				svg.style.cursor = 'grabbing';
			}
		});

		svg.addEventListener('pointermove', (e: PointerEvent) => {
			if (!this.activePointers.has(e.pointerId)) return;
			this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

			if (this.isPinching && this.pinchPointerIds) {
				const [id1, id2] = this.pinchPointerIds;
				// Ignore any pointer that isn't one of the two that started this
				// pinch — a stray extra touch moving must never perturb it.
				if (e.pointerId !== id1 && e.pointerId !== id2) return;
				const a = this.activePointers.get(id1);
				const b = this.activePointers.get(id2);
				if (a && b && this.pinchStartDist > 0) {
					const dist = pointerDist(a, b);
					const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
					this.applyZoom(this.pinchStartScale * (dist / this.pinchStartDist), center);
				}
			} else if (this.draggingNodeId && this.sim) {
				// No pointer-id check needed here: a 2nd pointer arriving ends the
				// node drag and starts a pinch (see pointerdown), so whenever
				// `draggingNodeId` is set exactly one pointer is down.
				const dx = e.clientX - this.dragStartClientX;
				const dy = e.clientY - this.dragStartClientY;
				if (!this.dragMoved && !isTap(dx, dy)) {
					// Real drag confirmed for the first time this pointer-down — this is
					// the one point where the sim actually needs pinning + reheating.
					this.dragMoved = true;
					const start = this.sim.getNode(this.draggingNodeId);
					if (start) this.sim.pinNode(this.draggingNodeId, start.x ?? 0, start.y ?? 0);
					this.sim.reheat();
				}
				if (this.dragMoved) {
					const n = this.sim.getNode(this.draggingNodeId);
					if (n) {
						this.sim.pinNode(
							this.draggingNodeId,
							(n.fx ?? n.x ?? 0) + dx / this.scale,
							(n.fy ?? n.y ?? 0) + dy / this.scale,
						);
						this.dragStartClientX = e.clientX;
						this.dragStartClientY = e.clientY;
					}
				}
			} else if (this.panning) {
				if (e.pointerId !== this.panPointerId) return; // stray extra touch — ignore
				this.tx = this.panTxStart + (e.clientX - this.panClientStart.x);
				this.ty = this.panTyStart + (e.clientY - this.panClientStart.y);
				this.applyTransform();
			}
		});

		const onPointerUp = (e: PointerEvent) => {
			this.activePointers.delete(e.pointerId);

			// End the pinch only when one of ITS two tracked pointers ends — a
			// stray extra touch lifting must not drop the view out of the pinch
			// and then snap-zoom it off the stale start distance.
			if (this.isPinching && this.pinchPointerIds && this.pinchPointerIds.includes(e.pointerId)) {
				this.isPinching = false;
				this.pinchPointerIds = null;
				const remaining = Array.from(this.activePointers.entries());
				if (remaining.length === 1) {
					// Hand the gesture to the finger still down, so pinch-then-drag
					// keeps panning instead of dead-ending until the user lifts and
					// presses again. Its CURRENT position is the new pan origin, so
					// the view doesn't jump.
					const [id, pt] = remaining[0];
					this.panning = true;
					this.panPointerId = id;
					this.panClientStart = { x: pt.x, y: pt.y };
					this.panTxStart = this.tx;
					this.panTyStart = this.ty;
					svg.style.cursor = 'grabbing';
				}
			}

			// Pointer went down on a node and came back up without dragging → a tap.
			// A pointercancel is not a tap (the OS took the gesture away), but the
			// candidate is still dropped so it can never fire later.
			if (this.tapCandidate && this.activePointers.size === 0) {
				const { node, openFile } = this.tapCandidate;
				this.tapCandidate = null;
				if (e.type === 'pointerup' && !this.dragMoved) {
					if (openFile || this.isDoubleTap(node.path)) this.openNodeFile(node.path);
					else this.previewNode(node);
				}
			}

			if (this.draggingNodeId && this.activePointers.size === 0) this.endNodeDrag();

			// End the pan only when ITS own tracked pointer ends — never when a
			// stray touch lifts, and never when the pan was just re-armed above
			// for a different finger.
			if (this.panning && e.pointerId === this.panPointerId) {
				this.panning = false;
				this.panPointerId = null;
				svg.style.cursor = '';
			}
		};

		svg.addEventListener('pointerup', onPointerUp);
		svg.addEventListener('pointercancel', onPointerUp);
	}

	// ── Live position sync ────────────────────────────────────────────────────

	private syncPositions(): void {
		if (!this.sim || !this.nodeGroup || !this.edgeGroup || !this.graphData) return;

		this.nodeGroup.querySelectorAll<SVGGElement>('.sg-rg-node').forEach((g) => {
			const p = this.sim!.getNode(g.dataset.path ?? '');
			if (p) g.setAttribute('transform', `translate(${p.x ?? 0},${p.y ?? 0})`);
		});

		this.edgeGroup.querySelectorAll<SVGPathElement>('path.sg-rg-edge').forEach((path) => {
			const g = this.segGeom(path.dataset.a ?? '', path.dataset.b ?? '');
			if (!g) return;
			// Each role draws from a specific point to another; the arrow (marker-end)
			// always sits on the second point.
			let x1 = g.ax, y1 = g.ay, x2 = g.bx, y2 = g.by;
			switch (path.dataset.role as EdgeRole) {
				case 'a':           x1 = g.mx; y1 = g.my; x2 = g.ax; y2 = g.ay; break; // midpoint → A (arrow at A)
				case 'b':           x1 = g.mx; y1 = g.my; x2 = g.bx; y2 = g.by; break; // midpoint → B (arrow at B)
				case 'full-ab':     x1 = g.ax; y1 = g.ay; x2 = g.bx; y2 = g.by; break; // A → B (arrow at B)
				case 'full-ba':     x1 = g.bx; y1 = g.by; x2 = g.ax; y2 = g.ay; break; // B → A (arrow at A)
				case 'full-mutual': x1 = g.ax; y1 = g.ay; x2 = g.bx; y2 = g.by; break; // no arrow, symmetric
				case 'full-reciprocal': x1 = g.ax; y1 = g.ay; x2 = g.bx; y2 = g.by; break; // no arrow, fades A→B
			}
			const weight = Number(path.getAttribute('stroke-width') ?? '1');
			const style = (path.dataset.style ?? 'solid') as LineStyle;
			const geom = edgeGeometry(style, x1, y1, x2, y2, weight);
			path.setAttribute('d', path.dataset.twin === '1' ? (geom.d2 ?? geom.d) : geom.d);
		});

		this.edgeGroup.querySelectorAll<SVGTextElement>('.sg-rg-edge-label').forEach((label) => {
			const g = this.segGeom(label.dataset.a ?? '', label.dataset.b ?? '');
			if (!g) return;
			const dx = g.bx - g.ax, dy = g.by - g.ay;
			const len = Math.hypot(dx, dy) || 1;
			const nx = -dy / len, ny = dx / len;
			// Split-pair halves sit on their own segment (midpoint↔end), not the
			// line's true center, so each label reads next to the type it names.
			let lx = g.mx, ly = g.my;
			if (label.dataset.pos === 'a') { lx = (g.ax + g.mx) / 2; ly = (g.ay + g.my) / 2; }
			else if (label.dataset.pos === 'b') { lx = (g.bx + g.mx) / 2; ly = (g.by + g.my) / 2; }
			label.setAttribute('x', String(lx + nx * 3));
			label.setAttribute('y', String(ly + ny * 3));
		});

		this.defsEl?.querySelectorAll<SVGLinearGradientElement>('.sg-rg-edge-gradient').forEach((grad) => {
			const g = this.segGeom(grad.dataset.a ?? '', grad.dataset.b ?? '');
			if (!g) return;
			grad.setAttribute('x1', String(g.ax));
			grad.setAttribute('y1', String(g.ay));
			grad.setAttribute('x2', String(g.bx));
			grad.setAttribute('y2', String(g.by));
		});
	}

	// ── Viewport ──────────────────────────────────────────────────────────────

	private applyTransform(): void {
		this.svgViewport?.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.scale})`);
		// Obsidian-style zoom-dependent labels: invisible when zoomed far out,
		// fading in as you zoom closer (fully visible from 1.5x up).
		const fade = Math.max(0, Math.min(1, (this.scale - 0.8) / 0.7));
		this.host.style.setProperty('--sg-rg-label-fade', fade.toFixed(2));
	}

	private applyZoom(newScale: number, anchorClient?: { x: number; y: number }): void {
		const clamped = Math.max(0.15, Math.min(6, newScale));
		const svg = this.svgViewport?.ownerSVGElement;
		if (svg) {
			const rect = svg.getBoundingClientRect();
			const anchorX = anchorClient ? anchorClient.x - rect.left : rect.width / 2;
			const anchorY = anchorClient ? anchorClient.y - rect.top : rect.height / 2;
			const worldX = (anchorX - this.tx) / this.scale;
			const worldY = (anchorY - this.ty) / this.scale;
			this.tx = anchorX - worldX * clamped;
			this.ty = anchorY - worldY * clamped;
		}
		this.scale = clamped;
		this.applyTransform();
	}

	private centerViewport(svg: SVGSVGElement): void {
		if (!this.sim) return;
		const nodes = this.sim.nodes();
		if (!nodes.length) return;
		const rect = svg.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		const cx = nodes.reduce((s, n) => s + (n.x ?? 0), 0) / nodes.length;
		const cy = nodes.reduce((s, n) => s + (n.y ?? 0), 0) / nodes.length;
		this.tx = rect.width / 2 - cx * this.scale;
		this.ty = rect.height / 2 - cy * this.scale;
		this.applyTransform();
	}

	// ── Settings panel (Obsidian-graph-style slide-out: Filters + Display) ────

	private renderSettingsPanel(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: `sg-rg-settings-panel${this.settingsOpen ? ' is-open' : ''}` });
		this.settingsPanelEl = panel;

		const header = panel.createDiv({ cls: 'sg-rg-settings-header' });
		header.createSpan({ cls: 'sg-rg-settings-title', text: 'Filters & display' });
		const closeBtn = header.createEl('button', { cls: 'sg-rg-settings-close', title: 'Close', attr: { 'aria-label': 'Close' } });
		setPhosphorIcon(closeBtn, 'x', '✕');
		closeBtn.addEventListener('click', () => this.closeSettingsPanel());

		const body = panel.createDiv({ cls: 'sg-rg-settings-body' });

		// ── Filters section ──
		const filtersSection = this.renderFoldableSection(body, 'Filters');

		// Present kinds (in registry order)
		const kindOrder = getCodexKindOrder();
		const presentKinds = this.allGraphData
			? kindOrder.filter((k) => this.allGraphData!.nodes.some((n) => n.kind === k))
			: [];

		// Present labeled rel types (deduplicated, insertion order)
		const seenIds = new Set<string>();
		const presentRelTypes: Array<{ id: string; color: string; displayLabel: string }> = [];
		// Distinct relationship WORDS (not types) + how many edges use each —
		// this is what the Weights section is built from. See relationPullKey.
		const relWords = new Map<string, { label: string; color: string; count: number }>();
		if (this.allGraphData) {
			for (const edge of this.allGraphData.edges) {
				if (edge.label !== '' && !seenIds.has(edge.relType.id)) {
					seenIds.add(edge.relType.id);
					presentRelTypes.push({ id: edge.relType.id, color: edge.relType.color, displayLabel: edge.relType.displayLabel });
				}
				const key = relationPullKey(edge);
				if (!key) continue;
				const seenWord = relWords.get(key);
				if (seenWord) seenWord.count++;
				else relWords.set(key, { label: edge.label.trim(), color: edge.relType.color, count: 1 });
			}
		}

		// Kind pills
		if (presentKinds.length > 1) {
			const group = filtersSection.createDiv({ cls: 'sg-rg-filter-group' });
			group.createSpan({ cls: 'sg-rg-filter-label', text: 'Show:' });
			for (const kind of presentKinds) {
				const isHidden = this.hiddenKinds.has(kind);
				const color = KIND_COLORS[kind] ?? '#6b7280';
				const pill = group.createEl('button', {
					cls: `sg-rg-filter-pill${isHidden ? ' is-hidden' : ''}`,
					title: isHidden ? `Show ${kind}s` : `Hide ${kind}s`,
				});
				const dot = pill.createSpan({ cls: 'sg-rg-pill-dot' });
				dot.style.background = color;
				pill.createSpan({ text: kind.charAt(0).toUpperCase() + kind.slice(1) });
				pill.addEventListener('click', () => {
					if (this.hiddenKinds.has(kind)) this.hiddenKinds.delete(kind);
					else this.hiddenKinds.add(kind);
					this.plugin.settings.connMapHiddenKinds = [...this.hiddenKinds];
					void this.plugin.saveSettingsQuiet();
					this.applyFiltersAndRender();
				});
			}
		}

		// Rel type pills
		if (presentRelTypes.length > 1) {
			const group = filtersSection.createDiv({ cls: 'sg-rg-filter-group' });
			group.createSpan({ cls: 'sg-rg-filter-label', text: 'Relations:' });
			for (const rt of presentRelTypes) {
				const isHidden = this.hiddenRelTypes.has(rt.id);
				const pill = group.createEl('button', {
					cls: `sg-rg-filter-pill${isHidden ? ' is-hidden' : ''}`,
					title: isHidden ? `Show ${rt.displayLabel}` : `Hide ${rt.displayLabel}`,
				});
				const swatch = pill.createSpan({ cls: 'sg-rg-pill-swatch' });
				swatch.style.background = rt.color;
				pill.createSpan({ text: rt.displayLabel });
				pill.addEventListener('click', () => {
					if (this.hiddenRelTypes.has(rt.id)) this.hiddenRelTypes.delete(rt.id);
					else this.hiddenRelTypes.add(rt.id);
					this.plugin.settings.connMapHiddenRelTypes = [...this.hiddenRelTypes];
					void this.plugin.saveSettingsQuiet();
					this.applyFiltersAndRender();
				});
			}
		}

		if (presentKinds.length <= 1 && presentRelTypes.length <= 1) {
			filtersSection.createEl('p', { cls: 'sg-rg-settings-empty', text: 'Nothing to filter yet.' });
		}

		// ── Display section ──
		const displaySection = this.renderFoldableSection(body, 'Display');

		// Three distinct states, not a toggle: Off (never, not even on hover),
		// On hover (default — matches the node-hover convention), Always show.
		// Both rows share this exact control so the two settings read as a pair.
		const labelModeOptions: Array<{ value: LabelVisibilityMode; label: string }> = [
			{ value: 'off', label: 'Off' },
			{ value: 'hover', label: 'On hover' },
			{ value: 'always', label: 'Always show' },
		];
		const addLabelModeRow = (
			rowLabel: string,
			current: LabelVisibilityMode,
			onChange: (mode: LabelVisibilityMode) => void,
		): void => {
			const row = displaySection.createDiv({ cls: 'sg-rg-settings-row' });
			row.createSpan({ cls: 'sg-rg-settings-row-label', text: rowLabel });
			const select = row.createEl('select', { cls: 'sg-rg-settings-select' });
			for (const opt of labelModeOptions) {
				const optionEl = select.createEl('option', { value: opt.value, text: opt.label });
				if (opt.value === current) optionEl.selected = true;
			}
			select.addEventListener('change', () => onChange(select.value as LabelVisibilityMode));
		};

		addLabelModeRow('Relationship labels', this.edgeLabelMode, (mode) => {
			this.edgeLabelMode = mode;
			this.host.dataset.edgeLabelMode = this.edgeLabelMode;
			this.plugin.settings.connMapEdgeLabelMode = mode;
			void this.plugin.saveSettingsQuiet();
		});
		addLabelModeRow('Character names', this.nodeLabelMode, (mode) => {
			this.nodeLabelMode = mode;
			this.host.dataset.nodeLabelMode = this.nodeLabelMode;
			this.plugin.settings.connMapNodeLabelMode = mode;
			void this.plugin.saveSettingsQuiet();
		});

		const nodeDisplayRow = displaySection.createDiv({ cls: 'sg-rg-settings-row' });
		nodeDisplayRow.createSpan({ cls: 'sg-rg-settings-row-label', text: 'Node display' });
		const nodeDisplaySelect = nodeDisplayRow.createEl('select', { cls: 'sg-rg-settings-select' });
		const nodeDisplayOptions: Array<{ value: 'dot' | 'portrait'; label: string }> = [
			{ value: 'dot', label: 'Colored dots' },
			{ value: 'portrait', label: 'Portraits' },
		];
		for (const opt of nodeDisplayOptions) {
			const optionEl = nodeDisplaySelect.createEl('option', { value: opt.value, text: opt.label });
			if (opt.value === (this.plugin.settings.connMapNodeDisplay ?? 'dot')) optionEl.selected = true;
		}
		nodeDisplaySelect.addEventListener('change', () => {
			this.plugin.settings.connMapNodeDisplay = nodeDisplaySelect.value as 'dot' | 'portrait';
			void this.plugin.saveSettingsQuiet();
			this.renderNodes();
		});

		const scaleBySizeRow = displaySection.createDiv({ cls: 'sg-rg-settings-row' });
		scaleBySizeRow.createSpan({ cls: 'sg-rg-settings-row-label', text: 'Size nodes by connections' });
		const scaleBySizeCheckbox = scaleBySizeRow.createEl('input', { attr: { type: 'checkbox' } });
		scaleBySizeCheckbox.checked = this.plugin.settings.connMapScaleBySize !== false;
		scaleBySizeCheckbox.addEventListener('change', () => {
			this.plugin.settings.connMapScaleBySize = scaleBySizeCheckbox.checked;
			void this.plugin.saveSettingsQuiet();
			this.renderNodes();
		});

		// ── Forces section ──
		// Same 4 concepts as Obsidian's own graph view (Center/Repel/Link force,
		// Link distance). The last two are specific to this map: distance/strength
		// here already vary per-edge by relationship weight (Parent/Child pulls
		// tighter than Rival) — *Variation* is how much that spread applies, on
		// top of the Link-force/-distance sliders which scale the whole result.
		const forcesSection = this.renderFoldableSection(body, 'Forces');

		const addSliderRow = (
			rowLabel: string,
			min: number, max: number, step: number,
			value: number,
			format: (v: number) => string,
			onChange: (v: number) => void,
		): void => {
			const row = forcesSection.createDiv({ cls: 'sg-rg-settings-row' });
			row.createSpan({ cls: 'sg-rg-settings-row-label', text: rowLabel });
			const controls = row.createDiv({ cls: 'sg-rg-settings-slider-controls' });
			const slider = controls.createEl('input', {
				cls: 'sg-rg-settings-slider',
				attr: { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) },
			});
			const readout = controls.createSpan({ cls: 'sg-rg-settings-slider-val', text: format(value) });
			slider.addEventListener('input', () => {
				const v = Number(slider.value);
				readout.setText(format(v));
				onChange(v);
			});
		};

		const fs = this.forceSettings;
		const plain = (v: number) => v.toFixed(2);
		addSliderRow('Center force', 0, 1, 0.01, fs.centerForce, plain, (v) => {
			this.forceSettings.centerForce = v;
			this.sim?.updateForces({ centerForce: v });
			this.plugin.settings.connMapForceSettings = { ...this.forceSettings };
			this.scheduleSettingsSave();
		});
		addSliderRow('Repel force', 0, 20, 1, fs.repelForce, (v) => String(v), (v) => {
			this.forceSettings.repelForce = v;
			this.sim?.updateForces({ repelForce: v });
			this.plugin.settings.connMapForceSettings = { ...this.forceSettings };
			this.scheduleSettingsSave();
		});
		addSliderRow('Link force', 0, 1, 0.01, fs.linkForce, plain, (v) => {
			this.forceSettings.linkForce = v;
			this.sim?.updateForces({ linkForce: v });
			this.plugin.settings.connMapForceSettings = { ...this.forceSettings };
			this.scheduleSettingsSave();
		});
		addSliderRow('Link distance', 0.5, 2, 0.05, fs.linkDistance, (v) => `${v.toFixed(2)}×`, (v) => {
			this.forceSettings.linkDistance = v;
			this.sim?.updateForces({ linkDistance: v });
			this.plugin.settings.connMapForceSettings = { ...this.forceSettings };
			this.scheduleSettingsSave();
		});
		addSliderRow('Distance variation', 0, 1, 0.01, fs.distanceVariation, plain, (v) => {
			this.forceSettings.distanceVariation = v;
			this.sim?.updateForces({ distanceVariation: v });
			this.plugin.settings.connMapForceSettings = { ...this.forceSettings };
			this.scheduleSettingsSave();
		});
		addSliderRow('Strength variation', 0, 1, 0.01, fs.strengthVariation, plain, (v) => {
			this.forceSettings.strengthVariation = v;
			this.sim?.updateForces({ strengthVariation: v });
			this.plugin.settings.connMapForceSettings = { ...this.forceSettings };
			this.scheduleSettingsSave();
		});

		// ── Relationship pull section ──
		// One slider per relationship WORD actually on the map, most-used first.
		// 1× is the relationship's natural pull, so an untouched map looks
		// exactly as it did before this section existed. Physics only — line
		// thickness stays tied to the type's built-in weight.
		// Updates the live sim in place (updateLinkPulls) rather than
		// re-rendering: a re-render would rebuild this panel mid-drag and pop
		// every folded section back open.
		const weightsSection = this.renderFoldableSection(body, 'Relationship pull');
		const words = [...relWords.entries()].sort((a, b) => b[1].count - a[1].count);
		if (words.length > 0) {
			for (const [key, info] of words) {
				const row = weightsSection.createDiv({ cls: 'sg-rg-settings-row' });
				const rowLabel = row.createSpan({ cls: 'sg-rg-settings-row-label' });
				const swatch = rowLabel.createSpan({ cls: 'sg-rg-pill-swatch' });
				swatch.style.background = info.color;
				rowLabel.createSpan({ text: info.label });
				const controls = row.createDiv({ cls: 'sg-rg-settings-slider-controls' });
				const current = this.plugin.settings.connMapRelationPull?.[key] ?? 1;
				const slider = controls.createEl('input', {
					cls: 'sg-rg-settings-slider',
					attr: { type: 'range', min: '0.25', max: '3', step: '0.05', value: String(current) },
				});
				const readout = controls.createSpan({ cls: 'sg-rg-settings-slider-val', text: `${current.toFixed(2)}×` });
				slider.addEventListener('input', () => {
					const v = Number(slider.value);
					readout.setText(`${v.toFixed(2)}×`);
					(this.plugin.settings.connMapRelationPull ??= {})[key] = v;
					this.sim?.updateLinkPulls((k) => this.plugin.settings.connMapRelationPull?.[k] ?? 1);
					this.scheduleSettingsSave();
				});
			}
		} else {
			weightsSection.createEl('p', { cls: 'sg-rg-settings-empty', text: 'No labeled relationships yet.' });
		}
	}

	/**
	 * Builds a collapsible settings section: a clickable header (title + chevron)
	 * plus a content wrapper the caller fills with rows. Fold state is a plain
	 * class toggle — it resets next time the panel opens, same as Obsidian's
	 * own graph settings.
	 *
	 * Every section starts FOLDED: four open sections at once read as a wall
	 * of controls (demo feedback 2026-11-03: "messy and scary"). The user
	 * opens only the one they need.
	 */
	private renderFoldableSection(parent: HTMLElement, title: string): HTMLElement {
		const section = parent.createDiv({ cls: 'sg-rg-settings-section is-collapsed' });

		const header = section.createDiv({ cls: 'sg-rg-settings-section-header' });
		header.setAttribute('role', 'button');
		header.setAttribute('tabindex', '0');
		header.setAttribute('aria-expanded', 'false');
		const chevron = header.createSpan({ cls: 'sg-rg-settings-chevron' });
		setPhosphorIcon(chevron, 'caret-down', '▾');
		header.createSpan({ cls: 'sg-rg-settings-section-title', text: title });

		const content = section.createDiv({ cls: 'sg-rg-settings-section-content' });

		const toggle = () => {
			const collapsed = section.classList.toggle('is-collapsed');
			header.setAttribute('aria-expanded', String(!collapsed));
		};
		header.addEventListener('click', toggle);
		header.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
		});

		return content;
	}

	private closeSettingsPanel(): void {
		this.settingsOpen = false;
		this.settingsPanelEl?.classList.remove('is-open');
		this.settingsBtnEl?.classList.remove('is-active');
	}

	// ── Loop warning ──────────────────────────────────────────────────────────

	/**
	 * A genealogy/rank loop (someone their own ancestor or commander) is a
	 * writing contradiction, not a graph the user can visually parse away —
	 * flag it plainly instead of silently drawing the impossible cycle.
	 */
	private renderLoopWarning(parent: HTMLElement): void {
		if (!this.graphData) return;
		const extraTypes = buildCustomRegistry(this.plugin.settings.customRelationshipTypes);
		const loops = findHierarchyLoops(this.graphData.edges, extraTypes);
		if (loops.length === 0) return;

		const banner = parent.createDiv({ cls: 'sg-rg-loop-warning' });
		banner.createSpan({ cls: 'sg-rg-loop-warning-title', text: 'Logical contradiction detected.' });
		const chain = loops[0].map((path) => this.nodeName(path)).join(' → ');
		banner.createSpan({
			cls: 'sg-rg-loop-warning-detail',
			text: `${chain} — a character cannot be their own ancestor or commander.`,
		});
	}

	// ── Legend ────────────────────────────────────────────────────────────────

	private renderLegend(parent: HTMLElement): void {
		if (!this.graphData) return;
		const entries = legendEntries(this.graphData);
		const bare = bareEdgeCount(this.graphData);
		if (entries.length === 0 && bare === 0) return;

		const legend = parent.createDiv({ cls: 'sg-rg-legend' });
		for (const rt of entries) {
			const item = legend.createDiv({ cls: 'sg-rg-legend-item' });
			const swatch = item.createDiv({ cls: 'sg-rg-legend-swatch' });
			swatch.style.background = rt.color;
			swatch.style.height = `${Math.round(rt.weight + 1)}px`;
			item.createSpan({ cls: 'sg-rg-legend-label', text: rt.displayLabel });
		}
		if (bare > 0) {
			const item = legend.createDiv({ cls: 'sg-rg-legend-item' });
			const swatch = item.createDiv({ cls: 'sg-rg-legend-swatch' });
			swatch.style.background = 'var(--text-faint)';
			swatch.style.height = '1px';
			item.createSpan({ cls: 'sg-rg-legend-label', text: `Unspecified (${bare})` });
		}
	}

	// ── Project change ────────────────────────────────────────────────────────

	/** The Dashboard picked another project. Draws nothing — the next mount() lays the new project out fresh. */
	resetScope(): void {
		// Anchor/group paths belong to the old project — stale otherwise.
		this.egoAnchor = null;
		this.selectedGroups = new Set();
		this.pendingFullReset = true;
	}
}

// ─── Legacy view shim ───────────────────────────────────────────────────────
// Saved workspaces may still reference this leaf type. Rather than duplicate
// rendering logic, it silently redirects into the merged Social Maps view and
// detaches itself.

export class StorygridRelGraphView extends ItemView {
	plugin: StorygridPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_REL_GRAPH; }
	getDisplayText(): string { return 'Connections Map'; }
	getIcon(): string { return 'git-fork'; }

	async setState(state: Record<string, unknown>): Promise<void> {
		// An old saved layout's project is stale: Social Maps follows the Dashboard's project.
		setTimeout(() => {
			void this.plugin.openSocialMaps('map');
			this.leaf.detach();
		}, 0);
	}
}

// ─── Merged-edge types ──────────────────────────────────────────────────────

/** Which part of a pair's connection a `<path>` segment represents. */
type EdgeRole = 'a' | 'b' | 'full-ab' | 'full-ba' | 'full-mutual' | 'full-reciprocal';

/** One unordered pair of nodes with each side's declared relation (if any). */
interface MergedPair {
	a: string;
	b: string;
	/** Relation A→B (from A's sheet): how A regards B. */
	aToB: GraphEdge | null;
	/** Relation B→A (from B's sheet): how B regards A. */
	bToA: GraphEdge | null;
	/** An unlabeled bare-wikilink connection exists between the pair. */
	bare: boolean;
}

/** Shortened endpoints + midpoint for a pair, in world coordinates. */
interface SegGeom {
	ax: number; ay: number;
	bx: number; by: number;
	mx: number; my: number;
}

/** Tooltip summarizing both declared directions of a pair. */
function pairTooltip(pair: MergedPair, nameA: string, nameB: string): string {
	const parts: string[] = [];
	if (pair.aToB) parts.push(`${nameA} → ${nameB}: ${pair.aToB.label}`);
	if (pair.bToA) parts.push(`${nameB} → ${nameA}: ${pair.bToA.label}`);
	if (parts.length === 0) parts.push(`${nameA} — ${nameB}`);
	return parts.join('\n');
}

/** Tooltip for a reciprocal-intensity gradient pair — each side's own declared strength. */
function reciprocalIntensityTooltip(pair: MergedPair, nameA: string, nameB: string): string {
	const aToB = pair.aToB!, bToA = pair.bToA!;
	const labelA = aToB.label || aToB.relType.displayLabel;
	const labelB = bToA.label || bToA.relType.displayLabel;
	return `${nameA}'s ${labelA}: ${aToB.intensity! * 10}% | ${nameB}'s ${labelB}: ${bToA.intensity! * 10}%`;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function arrowMarkerId(color: string): string {
	// Strip everything but letters/digits, not just a leading '#' — colors can
	// now also be a CSS var like 'var(--text-faint)', whose parens/dashes
	// aren't legal in an SVG/HTML id. Strictly broader than the old '#'-only
	// replace, so every existing hex-color id is unchanged.
	return `sg-rg-arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
}

function shortenLine(x1: number, y1: number, x2: number, y2: number, r: number): [number, number, number, number] {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.sqrt(dx * dx + dy * dy) || 1;
	const shorten = Math.min(r, len * 0.4);
	const ux = dx / len;
	const uy = dy / len;
	return [x1 + ux * shorten, y1 + uy * shorten, x2 - ux * shorten, y2 - uy * shorten];
}
