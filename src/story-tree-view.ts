import { App, ItemView, WorkspaceLeaf, TFile, Menu, Notice } from 'obsidian';
import type StorygridPlugin from './main';
import { getCodexKindOrder, getKindSpec } from './entities/entity-kinds';
import { createEntityFile, findCodexScopes, StoryProject } from './entities/entity-manager';
import { parseEntityDocument } from './entities/entity-parse';
import { EntityModal } from './modals/entity-modal';
import { GROUP_KINDS, RelEntity, RelationshipType, buildCustomRegistry, buildRelationGraph, fieldsToRelationSections, groupRoleOf, parseRelationLines, relationChoices } from './utils/relations';
import { buildTreeData, layoutTreeBlocks, restrictTreeData, computeUnions, coupleStatus, CoupleStatus, initialsOf, isFamilyGroup, lifeFactsFromFields, wrapName, LifeFacts, TreeBlock, TreeMode, TreeData, TreeEdge, TreeNode, TreeNote, TreePosition } from './utils/story-tree';
import { t } from './i18n';
import { PHOSPHOR_ICONS, setPhosphorIcon } from './utils/icons';
import { TreeFocusModal } from './modals/tree-focus-modal';
import { COACH_MARK_CLASS, showCoachMark } from './ui/coach-mark';
import { KIND_COLORS, makeSvg, truncate, pointerDist, isTap } from './utils/graph-shared';
import { StorygridOutlineView } from './outline-view';
import { pickScopeRoot } from './utils/scope-pick';

/** Seen-flag (in `coachMarksSeen`) for the one-time tip on "Add a character". */
const ADD_CHARACTER_TIP = 'story-tree-add-character';

export const VIEW_TYPE_STORY_TREE = 'storygrid-story-tree-view';

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_R = 8;
const CARD_W = 184;
const CARD_H = 60;
const CARD_PORTRAIT = 38;
const CARD_PAD = 10;

// Row height and horizontal footprint per node style. Card rows are taller so
// the right-angle connectors between generations have room to breathe; dot
// nodes reserve enough width for their labels underneath.
const ROW_H_CARD = 128;
const ROW_H_DOT = 100;
const LAYOUT_CARD = { nodeW: CARD_W, gapX: 48 };
const LAYOUT_DOT = { nodeW: 140, gapX: 44 };

/** Room between a block's frame and its cards; a family block's title sits in extra room above. */
const BLOCK_PAD = 18;
/**
 * One colour per faction or family entry (in name order), for its header, the
 * strip on its people's cards and their initials. Mid tones that read on both
 * the light and the dark theme.
 */
const GROUP_COLORS = ['#c0694f', '#4f8fc0', '#d9822b', '#5aa37a', '#8a6fd1', '#2a9d8f', '#b08a2e', '#c0587e'];

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 6;
/** Largest name size (tree units) when zoomed far out — two lines of it still fit a card row. */
const LABEL_MAX = 28;
/** From this name size (about 57 % zoom and below) a card drops its portrait and shows just the name. */
const NAME_ONLY_FROM = 22;
/** Average glyph width as a share of the font size — for wrapping names to a card. */
const GLYPH_W = 0.56;

/** Corner radius for right-angle connector bends. */
const EDGE_BEND_R = 7;

/** Two taps on the same node within this window count as a double-click. */
const DOUBLE_TAP_MS = 350;

/** One child hanging from a connector, with the sheet relationships that put it there. */
interface ConnChild {
	x: number;
	topY: number;
	path: string;
	edges: TreeEdge[];
}

/** A stem → rail → drops connector from one source (a person, a couple, or a group's leaders). */
interface Connector {
	srcX: number;
	srcY: number;
	childGen: number;
	children: ConnChild[];
	cls: string;
	/** Everyone the source stands for: the parent(s), or the group and its leaders. */
	srcPeople: string[];
	/** Extra bar/drop paths drawn at the source — they belong to the whole connector. */
	decor: SVGPathElement[];
}

/** A relationship word waiting to be shown at a spot on the tree (hover, or always). */
interface WordAnchor {
	/** Words sharing a key are written together at one spot ("Mother · Father"). */
	key: string;
	x: number;
	y: number;
	center: boolean;
	label: string;
	/** Both people the word is about — hovering either shows it. */
	people: string[];
}

type EdgeInfoMode = 'off' | 'hover' | 'always';

/** Most relationships a pointed-at line lists before saying "+N more". */
const TIP_MAX_LINES = 4;

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * Renders the Story Tree (family tree / faction hierarchy) into a host
 * element supplied by the caller (`SocialMapsView`). See `RelGraphController`
 * in `rel-graph-view.ts` for the shared design rationale — not an `ItemView`,
 * so the same instance survives tab switches without losing in-memory state.
 */
export class StoryTreeController {
	private app: App;

	private scopeRoot = '';
	/** The project Social Maps asked for at mount (the Dashboard's, or a button's); re-picked on every rebuild. */
	private requestedRoot = '';
	private scopes: StoryProject[] = [];
	private entities: RelEntity[] = [];
	private imagePathByPath = new Map<string, string | null>();
	private deceasedByPath = new Map<string, boolean>();
	/** Faction / family entry → its colour (see GROUP_COLORS). */
	private groupColorByPath = new Map<string, string>();
	/** Person → the colour of their main group (one they lead, else the first by name), for the card strip and initials. */
	private personColorByPath = new Map<string, string>();
	/** Every line between a person and a group entry, from either sheet — names family blocks and scopes the bloodline view. */
	private groupLinks: Array<{ person: string; group: string }> = [];
	/** Bloodline entries, and factions whose Type calls them a family or house. */
	private familyGroupPaths = new Set<string>();
	/** "View family tree" from a Bloodline entry: only the families tied to it are shown. */
	private bloodlinePath = '';
	/** "View faction tree" from a faction entry: only that faction's org chart is shown. */
	private factionPath = '';
	/** Couple line looks drawn in the last render, for the couple key. */
	private coupleStatusesShown = new Set<CoupleStatus>();
	private blocks: TreeBlock[] = [];
	private blockGroup: SVGGElement | null = null;
	private lifeFactsByPath = new Map<string, LifeFacts>();
	/** Custom relationship types resolved for the active scope — threaded into buildRelationGraph/classifyRelation so custom types affect the tree too. */
	private customTypes: RelationshipType[] = [];

	private mode: TreeMode;
	private focusPath = '';
	private generationsUp: number | undefined = undefined;
	private generationsDown: number | undefined = undefined;
	private includePartners: boolean;

	private treeData: TreeData | null = null;
	private positions: TreePosition[] = [];

	// SVG viewport transform
	private tx = 0;
	private ty = 0;
	private scale = 1;
	/** Fit the whole tree into the window on the next render (first open, new mode/focus/project). */
	private needsFit = true;
	/** Every card's path from the last layout, to notice when someone joins or leaves. */
	private lastCast = '';
	private svgViewport: SVGGElement | null = null;
	private nodeGroup: SVGGElement | null = null;
	private edgeGroup: SVGGElement | null = null;
	private wordGroup: SVGGElement | null = null;
	private tipEl: HTMLElement | null = null;
	private defsEl: SVGDefsElement | null = null;
	/** The one "Add a character" button on screen (toolbar, or the empty-tree message). */
	private addCharacterBtn: HTMLElement | null = null;
	/** Closes the "Add a character" tip while it's on screen. */
	private closeAddCharacterTip: (() => void) | null = null;
	/** The gear's "Focus and display" slide-out; stays open across redraws until closed. */
	private focusPanelOpen = false;
	private focusPanelEl: HTMLElement | null = null;
	private focusPanelBtnEl: HTMLElement | null = null;

	// Hover (relationship info). Only ever toggles classes / draws small labels —
	// never touches the view state (focus, mode, pan, zoom).
	/** Per drawn line: the people it joins (for fading) and the relationships it stands for (for the tag). */
	private edgeMeta = new Map<Element, { people: string[]; edges: TreeEdge[] }>();
	private wordAnchors: WordAnchor[] = [];
	private hoveredPath: string | null = null;
	/** What the word layer was last drawn for ("mode|hovered|size"), so it only redraws on a change. */
	private drawnWords = '';
	/** Name size the nodes were last drawn at — they redraw only when zooming changes it. */
	private drawnLabelSize = 0;

	// Pan state
	private panning = false;
	private panClientStart = { x: 0, y: 0 };
	private panTxStart = 0;
	private panTyStart = 0;

	// Tap state. The SVG captures the pointer on every pointerdown (see
	// bindSvgEvents), which retargets the synthesized 'click' to the <svg> —
	// so a 'click'/'dblclick' listener on a node <g> never fires. Taps are
	// therefore detected from the pointerdown/up pair instead.
	private tapCandidate: { node: TreeNode; openFile: boolean; x: number; y: number } | null = null;
	private lastTap: { path: string; time: number } | null = null;

	// Multi-touch tracking. `panPointerId`/`pinchPointerIds` name the exact
	// pointer(s) that started the current gesture — a stray 3rd touch (e.g. a
	// palm edge) still lands in `activePointers` for bookkeeping, but must
	// never reassign an already-active pan/pinch's reference point, and must
	// never be mistaken for one of the pointers that can end that gesture.
	private activePointers = new Map<number, { x: number; y: number }>();
	private isPinching = false;
	private pinchStartDist = 0;
	private pinchStartScale = 1;
	private panPointerId: number | null = null;
	private pinchPointerIds: [number, number] | null = null;

	private refreshTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private plugin: StorygridPlugin,
		private host: HTMLElement,
		private getScopeRoot: () => string,
		private onScopeChange: (root: string) => void,
	) {
		this.app = plugin.app;
		this.mode = plugin.settings.storyTreeDefaultMode ?? 'family';
		this.includePartners = plugin.settings.storyTreeIncludePartners ?? true;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	/** True while this tab is the one drawn into the shared host (the Connections map shares it). */
	private mounted = false;

	/** Escape closes the "Focus and display" panel wherever the keyboard focus is (as on the Connections map). */
	private escapeHandler = (e: KeyboardEvent): void => {
		// A pop-up on top (the Focus picker) gets Escape first; the panel stays.
		if (e.key !== 'Escape' || !this.focusPanelOpen || document.querySelector('.modal-container')) return;
		e.stopPropagation();
		this.setFocusPanelOpen(false);
	};

	mount(): void {
		this.mounted = true;
		document.removeEventListener('keydown', this.escapeHandler);
		document.addEventListener('keydown', this.escapeHandler);
		this.requestedRoot = this.getScopeRoot();
		this.scopeRoot = this.requestedRoot;
		void this.rebuild();
	}

	unmount(): void {
		this.mounted = false;
		document.removeEventListener('keydown', this.escapeHandler);
		// Invalidate any rebuild() still awaiting its load — without this, a
		// rebuild kicked off while this controller was mounted can resolve
		// AFTER the other controller has since rendered into the same shared
		// `host` (see SocialMapsView) and clobber it.
		this._renderGen++;
		if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
		this.host.empty();
	}

	/** Called by the parent view's shared, debounced vault listener. */
	refresh(): void {
		void this.rebuild();
	}

	getState(): Record<string, unknown> {
		return {
			mode: this.mode,
			focusPath: this.focusPath,
			generationsUp: this.generationsUp ?? null,
			generationsDown: this.generationsDown ?? null,
			includePartners: this.includePartners,
			bloodlinePath: this.bloodlinePath,
			factionPath: this.factionPath,
		};
	}

	/** Restore transient UI state. Call before `mount()` — this does not itself render. */
	setState(state: Record<string, unknown>): void {
		if (state.mode === 'family' || state.mode === 'faction') this.mode = state.mode;
		if (typeof state.focusPath === 'string') {
			if (state.focusPath !== this.focusPath) this.needsFit = true;
			this.focusPath = state.focusPath;
		}
		if (typeof state.generationsUp === 'number') this.generationsUp = state.generationsUp;
		if (typeof state.generationsDown === 'number') this.generationsDown = state.generationsDown;
		if (typeof state.includePartners === 'boolean') this.includePartners = state.includePartners;
		if (typeof state.bloodlinePath === 'string') {
			this.bloodlinePath = state.bloodlinePath;
			this.needsFit = true;
		}
		if (typeof state.factionPath === 'string') {
			this.factionPath = state.factionPath;
			this.needsFit = true;
		}
	}

	// ── Build cycle ───────────────────────────────────────────────────────────

	/** Bumped on every rebuild(); a stale async continuation bails out instead
	 *  of clobbering whatever the OTHER controller has since rendered into the
	 *  same shared host (both controllers are mounted into one `bodyEl` — see
	 *  SocialMapsView). Ported from the same `_renderGen` idiom in codex-view.ts. */
	private _renderGen = 0;

	async rebuild(): Promise<void> {
		const gen = ++this._renderGen;
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

		this.entities = await this.loadEntities(this.scopeRoot);
		if (gen !== this._renderGen) return;
		if (this.focusPath && !this.entities.find((e) => e.path === this.focusPath)) {
			this.focusPath = '';
		}
		if (this.bloodlinePath && !this.entities.find((e) => e.path === this.bloodlinePath)) {
			this.bloodlinePath = '';
		}
		if (this.factionPath && !this.entities.find((e) => e.path === this.factionPath)) {
			this.factionPath = '';
		}
		this.recomputeAndRender();
	}

	/** Rebuild tree data + layout from the current mode/focus/depth filters and re-render. */
	recomputeAndRender(): void {
		this.customTypes = buildCustomRegistry(this.plugin.settings.customRelationshipTypes);
		const edges = buildRelationGraph(this.entities, this.customTypes);
		const kindByPath = new Map(this.entities.map((e) => [e.path, e.kind as string]));
		const nameByPath = new Map(this.entities.map((e) => [e.path, e.name]));
		// Each group gets a colour in name order, so it keeps it between visits.
		const groups = this.entities.filter((e) => GROUP_KINDS.has(e.kind)).sort((a, b) => a.name.localeCompare(b.name));
		this.groupColorByPath = new Map(groups.map((g, i) => [g.path, GROUP_COLORS[i % GROUP_COLORS.length]]));
		// A person's main group is one they lead, else the first by name; its colour is theirs.
		this.groupLinks = [];
		const mainGroup = new Map<string, { group: string; leader: boolean }>();
		for (const e of edges) {
			const fromGroup = GROUP_KINDS.has(kindByPath.get(e.fromPath) ?? '');
			const toGroup = GROUP_KINDS.has(kindByPath.get(e.toPath) ?? '');
			if (fromGroup === toGroup) continue;
			const group = fromGroup ? e.fromPath : e.toPath;
			const person = fromGroup ? e.toPath : e.fromPath;
			this.groupLinks.push({ person, group });
			const leader = groupRoleOf(e.label) === 'leader';
			const prev = mainGroup.get(person);
			const earlier = !!prev && (nameByPath.get(group) ?? '').localeCompare(nameByPath.get(prev.group) ?? '') < 0;
			if (!prev || (leader && !prev.leader) || (leader === prev.leader && earlier)) mainGroup.set(person, { group, leader });
		}
		this.personColorByPath = new Map(
			[...mainGroup].map(([person, m]) => [person, this.groupColorByPath.get(m.group) ?? KIND_COLORS.faction])
		);

		let data = buildTreeData(this.entities, edges, this.mode, {
			focusPath: this.focusPath || undefined,
			generationsUp: this.generationsUp,
			generationsDown: this.generationsDown,
			includePartners: this.includePartners,
			lifeFacts: this.lifeFactsByPath,
		});
		let layout = layoutTreeBlocks(data, this.mode, this.layoutOpts());
		if (this.mode === 'family' && this.bloodlinePath) {
			// Opened from a Bloodline entry: keep only the families someone on it belongs to.
			const tied = new Set(this.groupLinks.filter((l) => l.group === this.bloodlinePath).map((l) => l.person));
			data = restrictTreeData(data, new Set(layout.blocks.filter((b) => b.paths.some((p) => tied.has(p))).flatMap((b) => b.paths)));
			layout = layoutTreeBlocks(data, this.mode, this.layoutOpts());
		} else if (this.mode === 'faction' && this.factionPath) {
			// Opened from a faction entry: keep only that faction's own org chart.
			// A faction with nobody under it counts as empty, so the hint shows instead of a lone title.
			const own = layout.blocks.find((b) => b.paths.includes(this.factionPath))?.paths ?? [];
			data = restrictTreeData(data, new Set(own.length > 1 ? own : []));
			layout = layoutTreeBlocks(data, this.mode, this.layoutOpts());
		}
		// Someone joined or left (a line added on a sheet, a filter changed): fit
		// again, or a newcomer placed at the edge can land outside the view.
		const cast = data.nodes.map((n) => n.path).sort().join('|');
		if (cast !== this.lastCast) this.needsFit = true;
		this.lastCast = cast;
		this.treeData = data;
		this.positions = layout.positions;
		this.blocks = layout.blocks;
		this.renderAll();
	}

	private isCardStyle(): boolean {
		return (this.plugin.settings.storyTreeNodeStyle ?? 'card') === 'card';
	}

	private rowH(): number {
		return this.isCardStyle() ? ROW_H_CARD : ROW_H_DOT;
	}

	private layoutOpts(): { nodeW: number; gapX: number } {
		return this.isCardStyle() ? LAYOUT_CARD : LAYOUT_DOT;
	}

	/** Offset from a node's layout x to its visual center. */
	private halfW(): number {
		return this.layoutOpts().nodeW / 2;
	}

	private async loadEntities(scopeRoot: string): Promise<RelEntity[]> {
		this.imagePathByPath.clear();
		this.deceasedByPath.clear();
		this.lifeFactsByPath.clear();
		this.familyGroupPaths.clear();

		const jobs: Array<Promise<RelEntity | null>> = [];
		for (const kind of getCodexKindOrder()) {
			for (const info of this.plugin.entityIndex.list(scopeRoot, kind)) {
				jobs.push(
					this.app.vault.cachedRead(info.file).then((text) => {
						const parsed = parseEntityDocument(text, info.file.basename);
						const sections = fieldsToRelationSections(parsed.fields);
						const facts = lifeFactsFromFields(parsed.fields);
						this.lifeFactsByPath.set(info.file.path, facts);
						this.deceasedByPath.set(info.file.path, facts.deceased === true);
						this.imagePathByPath.set(info.file.path, info.imagePath ?? null);
						if (isFamilyGroup(kind, parsed.fields)) this.familyGroupPaths.add(info.file.path);
						return { path: info.file.path, name: info.file.basename, kind, sections };
					}).catch(() => null) // skip malformed files
				);
			}
		}
		return (await Promise.all(jobs)).filter((e): e is RelEntity => e !== null);
	}

	// ── Render ────────────────────────────────────────────────────────────────

	private renderEmpty(msg: string): void {
		this.host.empty();
		this.host.createDiv({ cls: 'sg-st-empty' }).createEl('p', { text: msg });
	}

	/**
	 * "No relations found" is the moment to teach the `Label: [[Target]]`
	 * convention this whole tree is built from. A faded two-generation ghost
	 * tree (real SVG, not a screenshot) shows the destination; a code-styled
	 * example line shows exactly what to type on a character sheet.
	 */
	private renderNoConnectionsState(root: HTMLElement): void {
		const wrap = root.createDiv({ cls: 'sg-st-no-connections' });

		const ghostSvg = makeSvg('svg', { class: 'sg-st-ghost-svg sg-ghost', viewBox: '0 0 220 120' }) as SVGSVGElement;
		const parent: [number, number] = [110, 20];
		const children: Array<[number, number]> = [[60, 96], [160, 96]];
		for (const [x, y] of children) {
			const line = makeSvg('line', {
				x1: String(parent[0]), y1: String(parent[1]), x2: String(x), y2: String(y),
				stroke: 'currentColor', 'stroke-width': '1.5',
			});
			ghostSvg.appendChild(line);
		}
		for (const [x, y] of [parent, ...children]) {
			const dot = makeSvg('circle', { cx: String(x), cy: String(y), r: '9', fill: 'currentColor' });
			ghostSvg.appendChild(dot);
		}
		wrap.appendChild(ghostSvg);

		const isFamily = this.mode === 'family';
		wrap.createEl('h3', { text: isFamily ? 'See your family trees take shape' : 'See your chain of command take shape' });
		wrap.createEl('p', {
			text: 'This tree draws itself from lines already on your character entries. Open any entry and add a line like:',
		});
		wrap.createEl('code', {
			cls: 'sg-st-example-line',
			text: isFamily ? 'Mother: [[Elena Voss]]' : 'Leader: [[Elena Voss]]',
		});
		wrap.createEl('p', {
			cls: 'sg-st-example-note',
			text: isFamily
				? 'Mother, Father, Partner, Child… any family word becomes a branch here.'
				: 'Leader, Commander, Reports to… any chain-of-command word becomes a branch here.',
		});

		// One obvious action: "Add a character" leads, "Open the Codex" sits beside it, quieter.
		const actions = wrap.createDiv({ cls: 'sg-st-empty-actions' });
		this.renderAddCharacterButton(actions, 'sg-st-empty-cta');
		const btn = actions.createEl('button', { cls: 'sg-st-empty-cta sg-st-empty-cta--quiet', text: 'Open the Codex' });
		btn.addEventListener('click', () => void this.plugin.openCodex(this.scopeRoot));
	}

	private renderAddCharacterButton(parent: HTMLElement, cls: string): void {
		const btn = parent.createEl('button', { cls: `${cls} sg-st-add-character-btn` });
		setPhosphorIcon(btn.createSpan({ cls: 'sg-st-add-character-icon' }), 'user-plus', '+');
		btn.createSpan({ text: t('storyTree.addCharacter') });
		btn.addEventListener('click', () => this.addCharacter());
		this.addCharacterBtn = btn;
	}

	/**
	 * First visit: one yellow tip on "Add a character". Waits a frame so the
	 * button is laid out; skipped while another tip is on screen (one at a
	 * time) or while the tree is hidden. A redraw removes the old button, which
	 * hides the tip without counting as seen — so it tries again on the new one.
	 */
	private maybeShowAddCharacterTip(): void {
		const id = ADD_CHARACTER_TIP;
		if (this.plugin.hasSeenCoachMark(id)) return;
		requestAnimationFrame(() => {
			const anchor = this.addCharacterBtn;
			if (!this.mounted || !anchor?.isConnected || anchor.getClientRects().length === 0) return;
			if (document.querySelector(`.${COACH_MARK_CLASS}`)) return;
			if (!this.plugin.canShowCoachMark(id)) return;
			this.closeAddCharacterTip = showCoachMark(anchor, t('storyTree.coachMark.addCharacter'), {
				placement: 'bottom',
				onDismiss: () => { this.closeAddCharacterTip = null; this.plugin.markCoachMarkSeen(id); },
				onHide: () => {
					this.closeAddCharacterTip = null;
					this.plugin.releasePendingCoachMark(id);
					// Only a redraw (button replaced) retries; a hidden tab waits for the next visit.
					if (!anchor.isConnected) this.maybeShowAddCharacterTip();
				},
			});
		});
	}

	/**
	 * "Add a character": the same character pop-up the Codex opens, saving into
	 * this project's Characters folder through the same `createEntityFile`, so
	 * the sheet is identical to one made in the Codex. Returning the file lets
	 * the pop-up file its pictures and write the other side of each relationship.
	 */
	private addCharacter(): void {
		// '' is a real project (a grid at the vault root), so only "no projects at all" stops here.
		if (this.scopes.length === 0) return;
		const projectRoot = this.scopeRoot;
		// Using the button counts as having seen its tip; never leave it floating over the pop-up.
		this.closeAddCharacterTip?.();
		this.plugin.markCoachMarkSeen(ADD_CHARACTER_TIP);
		new EntityModal(
			this.app,
			'character',
			'',
			[],
			async (name, fields, aliases, start) => {
				try {
					const file = await createEntityFile(this.app, projectRoot, 'character', name, fields, aliases, start?.cleanSlate);
					// No relationship yet means nothing new on the tree — say why instead of looking broken.
					// Sections include every (even empty) text box, so count real `Label: [[Name]]` lines.
					const hasRelation = Object.values(fieldsToRelationSections(fields)).flatMap(parseRelationLines).length > 0;
					new Notice(hasRelation
						? t('codex.notice.entityCreated', { singular: getKindSpec('character').singular, basename: file.basename })
						: t('storyTree.notice.addedNoRelation', { name: file.basename }));
					this.plugin.celebrateMilestone('first-sheet', t('codex.milestone.firstEntry'));
					// Redraw now; Social Maps' own vault listener redraws again once
					// the other sheets' mirrored relationship lines are written.
					if (this.mounted) void this.rebuild();
					return file;
				} catch (err) {
					new Notice(t('codex.notice.createFailed', { kind: 'character', msg: err instanceof Error ? err.message : '' }));
				}
			},
			{
				savedTemplates: this.plugin.settings.characterFieldTemplates,
				onSaveTemplate: async (tpl) => {
					this.plugin.settings.characterFieldTemplates.push(tpl);
					await this.plugin.saveSettings();
					new Notice(t('codex.notice.templateSaved', { name: tpl.name }));
				},
				projectRoot,
				relationChoices: relationChoices(this.plugin.settings.customRelationshipTypes),
				plugin: this.plugin,
			}
		).open();
	}

	private renderAll(): void {
		this.host.empty();
		this.svgViewport = null;
		this.nodeGroup = null;
		this.edgeGroup = null;
		this.wordGroup = null;
		this.tipEl = null;
		this.hoveredPath = null;
		this.drawnWords = '';
		this.defsEl = null;
		this.blockGroup = null;
		this.addCharacterBtn = null;
		this.focusPanelEl = null;
		this.focusPanelBtnEl = null;

		if (!this.treeData) return;

		const root = this.host.createDiv({ cls: 'sg-st-root' });
		// An empty tree shows "Add a character" in its message instead, so it's never on screen twice.
		const showsEmptyMessage = this.treeData.nodes.length === 0 && !this.bloodlinePath && !this.factionPath;
		this.renderToolbar(root, !showsEmptyMessage);
		this.maybeShowAddCharacterTip();
		this.renderFocusPanel(root);
		this.renderFocusBar(root);
		// Notes strip (renderNotes) is off: Emma — the relationship on the lines is enough.
		// The notes are still computed; bring them back as a quieter link later.

		if (this.treeData.nodes.length === 0) {
			if (this.bloodlinePath) {
				const name = this.entities.find((e) => e.path === this.bloodlinePath)?.name ?? '';
				root.createDiv({ cls: 'sg-st-empty' }).createEl('p', { text: t('storyTree.bloodline.empty', { name }) });
			} else if (this.factionPath) {
				const name = this.entities.find((e) => e.path === this.factionPath)?.name ?? '';
				root.createDiv({ cls: 'sg-st-empty' }).createEl('p', { text: t('storyTree.faction.empty', { name }) });
			} else {
				this.renderNoConnectionsState(root);
			}
			return;
		}

		const nodeStyle = this.plugin.settings.storyTreeNodeStyle ?? 'card';
		if (nodeStyle === 'card' && this.treeData.nodes.length > 60) {
			root.createDiv({ cls: 'sg-st-large-tree-warning' }).createEl('p', {
				text: `Large tree (${this.treeData.nodes.length} people) — switch to Compact dots in Settings → Story Tree for better performance.`,
			});
		}

		const svgWrap = root.createDiv({ cls: 'sg-st-svg-wrap' });
		const svg = makeSvg('svg', { class: 'sg-st-svg' }) as SVGSVGElement;
		svgWrap.appendChild(svg);

		const defs = makeSvg('defs') as SVGDefsElement;
		svg.appendChild(defs);

		const vp = makeSvg('g', { class: 'sg-st-viewport' }) as SVGGElement;
		svg.appendChild(vp);
		this.svgViewport = vp;

		// Block frames sit behind everything (drawn with the cards, whose heights they follow).
		const blockGroup = makeSvg('g', { class: 'sg-st-blocks', 'pointer-events': 'none' }) as SVGGElement;
		vp.appendChild(blockGroup);
		this.blockGroup = blockGroup;
		const edgeGroup = makeSvg('g', { class: 'sg-st-edges' }) as SVGGElement;
		vp.appendChild(edgeGroup);
		const nodeGroup = makeSvg('g', { class: 'sg-st-nodes' }) as SVGGElement;
		vp.appendChild(nodeGroup);
		// Relationship words sit on top of the cards and never catch the pointer.
		const wordGroup = makeSvg('g', { class: 'sg-st-words', 'pointer-events': 'none' }) as SVGGElement;
		vp.appendChild(wordGroup);
		this.tipEl = svgWrap.createDiv({ cls: 'sg-st-edge-tip' });

		this.nodeGroup = nodeGroup;
		this.edgeGroup = edgeGroup;
		this.wordGroup = wordGroup;
		this.defsEl = defs;
		this.renderEdges(edgeGroup);
		this.renderNodes();
		this.syncWords();
		this.renderCoupleKey(root);
		this.renderLegend(root);
		this.bindSvgEvents(svg, svgWrap);

		requestAnimationFrame(() => {
			if (this.needsFit && this.fitToView(svg)) {
				this.needsFit = false;
			} else {
				this.applyTransform();
			}
		});
	}

	/**
	 * What the tree decided about the sheets (a skipped loop, a line read the
	 * other way round because of the ages) — a quiet strip, never a popup, so
	 * a vault refresh doesn't keep interrupting. The tree never edits a sheet.
	 */
	private renderNotes(parent: HTMLElement): void {
		const notes = this.treeData?.notes ?? [];
		if (notes.length === 0) return;
		const nameOf = (path: string) => this.entities.find((e) => e.path === path)?.name ?? t('storyTree.unknownParent');
		const text = (n: TreeNote) =>
			n.type === 'loop'
				? t('storyTree.note.loop', { a: nameOf(n.fromPath), b: nameOf(n.toPath), label: n.label || '—' })
				: t('storyTree.note.flipped', { label: n.label, target: nameOf(n.targetPath), source: nameOf(n.sourcePath) });

		const MAX_SHOWN = 3;
		const strip = parent.createDiv({ cls: 'sg-st-notes' });
		for (const n of notes.slice(0, MAX_SHOWN)) strip.createEl('p', { cls: 'sg-st-note', text: text(n) });
		if (notes.length > MAX_SHOWN) {
			strip.createEl('p', {
				cls: 'sg-st-note sg-st-note-more',
				text: t('storyTree.note.more', { count: String(notes.length - MAX_SHOWN) }),
				attr: { title: notes.slice(MAX_SHOWN).map(text).join('\n') },
			});
		}
	}

	/**
	 * What the couple lines mean, as a plain row of text under the tree (never
	 * over the cards). Only when a line other than plain "married" is drawn.
	 */
	private renderCoupleKey(parent: HTMLElement): void {
		if (this.mode !== 'family' || ![...this.coupleStatusesShown].some((s) => s !== 'married')) return;
		const key = parent.createDiv({ cls: 'sg-st-couple-key' });
		const order: CoupleStatus[] = ['married', 'together', 'separated', 'divorced', 'child'];
		for (const status of order.filter((s) => this.coupleStatusesShown.has(s))) {
			const item = key.createDiv({ cls: 'sg-st-legend-item' });
			const swatch = makeSvg('svg', { class: 'sg-st-legend-swatch', viewBox: '0 0 28 14', width: '28', height: '14' }) as SVGSVGElement;
			swatch.appendChild(makeSvg('line', { x1: '1', y1: '7', x2: '27', y2: '7', class: `sg-st-edge sg-st-couple sg-st-couple--${status}` }));
			const slashes = status === 'divorced' ? [-3.5, 3.5] : status === 'separated' ? [0] : [];
			for (const off of slashes) {
				swatch.appendChild(makeSvg('line', { x1: String(14 + off - 3), y1: '12', x2: String(14 + off + 3), y2: '2', class: 'sg-st-edge sg-st-couple-slash' }));
			}
			item.appendChild(swatch);
			item.createSpan({ cls: 'sg-st-legend-label', text: t(`storyTree.couple.${status}`) });
		}
	}

	private renderLegend(parent: HTMLElement): void {
		if (!this.treeData) return;
		const legend = parent.createDiv({ cls: 'sg-st-legend' });

		const addLine = (label: string, extraClass: string) => {
			const item = legend.createDiv({ cls: 'sg-st-legend-item' });
			const swatch = makeSvg('svg', { class: 'sg-st-legend-swatch', viewBox: '0 0 28 10', width: '28', height: '10' }) as SVGSVGElement;
			swatch.appendChild(makeSvg('line', {
				x1: '1', y1: '5', x2: '27', y2: '5',
				class: `sg-st-edge${extraClass ? ' ' + extraClass : ''}`,
			}));
			item.appendChild(swatch);
			item.createSpan({ cls: 'sg-st-legend-label', text: label });
		};

		const has = (kind: string) => this.treeData?.edges.some((e) => e.kind === kind) ?? false;
		const coupleKey = this.mode === 'family' && [...this.coupleStatusesShown].some((s) => s !== 'married');
		if (this.mode === 'family') {
			addLine('Parent → child', '');
			if (!coupleKey) addLine('Partners', 'sg-st-couple sg-st-couple--married');
			addLine('Siblings', 'sg-st-edge-sibling');
			if (has('cousin')) addLine(t('storyTree.legend.cousins'), 'sg-st-edge-cousin');
			if (has('kin')) addLine(t('storyTree.legend.kin'), 'sg-st-edge-kin');
		} else {
			// No "same rank" line: nothing in faction mode ever draws one.
			addLine('Chain of command', '');
		}

		const shown = new Set(this.treeData.nodes.map((n) => n.refPath ?? n.path));
		if ([...shown].some((p) => this.deceasedByPath.get(p))) {
			const item = legend.createDiv({ cls: 'sg-st-legend-item' });
			item.createSpan({ cls: 'sg-st-legend-deceased' });
			item.createSpan({ cls: 'sg-st-legend-label', text: t('storyTree.legend.deceased') });
		}
		if (this.treeData.nodes.some((n) => n.refPath)) {
			const item = legend.createDiv({ cls: 'sg-st-legend-item' });
			setPhosphorIcon(item.createSpan({ cls: 'sg-st-legend-also' }), 'link', '∞');
			item.createSpan({ cls: 'sg-st-legend-label', text: t('storyTree.legend.alsoIn') });
		}
	}

	private renderToolbar(parent: HTMLElement, withAddCharacter: boolean): void {
		const bar = parent.createDiv({ cls: 'sg-st-toolbar' });

		// Just the name: the project is changed in the Dashboard, never here.
		bar.createSpan({
			cls: 'sg-st-scope-name',
			text: this.scopes.find((s) => s.rootPath === this.scopeRoot)?.name ?? '—',
			attr: { title: t('socialMaps.projectHint') },
		});

		// Mode toggle: Family tree / Faction hierarchy
		const modeWrap = bar.createDiv({ cls: 'sg-st-mode-toggle' });
		const familyBtn = modeWrap.createEl('button', {
			cls: `sg-st-mode-btn${this.mode === 'family' ? ' is-active' : ''}`,
			text: 'Family tree',
		});
		const factionBtn = modeWrap.createEl('button', {
			cls: `sg-st-mode-btn${this.mode === 'faction' ? ' is-active' : ''}`,
			text: 'Faction hierarchy',
		});
		familyBtn.addEventListener('click', () => this.setMode('family'));
		factionBtn.addEventListener('click', () => this.setMode('faction'));

		if (withAddCharacter) this.renderAddCharacterButton(bar, 'sg-st-toolbar-add');

		const zoomWrap = bar.createDiv({ cls: 'sg-st-zoom' });
		const zoomOut = zoomWrap.createEl('button', { cls: 'sg-st-zoom-btn', title: 'Zoom out', attr: { 'aria-label': 'Zoom out' } });
		setPhosphorIcon(zoomOut, 'minus', '−');
		const zoomIn = zoomWrap.createEl('button', { cls: 'sg-st-zoom-btn', title: 'Zoom in', attr: { 'aria-label': 'Zoom in' } });
		setPhosphorIcon(zoomIn, 'plus', '+');
		const fitBtn = zoomWrap.createEl('button', { cls: 'sg-st-zoom-btn', title: t('storyTree.fit'), attr: { 'aria-label': t('storyTree.fit') } });
		setPhosphorIcon(fitBtn, 'corners-out', '⤢');
		zoomOut.addEventListener('click', () => this.applyZoom(this.scale / 1.25));
		zoomIn.addEventListener('click', () => this.applyZoom(this.scale * 1.25));
		fitBtn.addEventListener('click', () => {
			const svg = this.svgViewport?.ownerSVGElement;
			if (svg) this.fitToView(svg);
		});

		const refreshBtn = bar.createEl('button', { cls: 'sg-st-refresh-btn', title: 'Refresh', attr: { 'aria-label': 'Refresh' } });
		setPhosphorIcon(refreshBtn, 'arrows-clockwise', '↺');
		refreshBtn.addEventListener('click', () => void this.rebuild());

		// Same gear, same place as the Connections map's: the Focus choice lives behind it.
		const panelBtn = bar.createEl('button', {
			cls: `sg-rg-settings-btn sg-st-focus-panel-btn${this.focusPanelOpen ? ' is-active' : ''}`,
			title: t('storyTree.focusPanel.title'),
			attr: { 'aria-label': t('storyTree.focusPanel.title'), 'aria-expanded': String(this.focusPanelOpen) },
		});
		setPhosphorIcon(panelBtn, 'gear', '⚙');
		panelBtn.addEventListener('click', () => this.setFocusPanelOpen(!this.focusPanelOpen));
		this.focusPanelBtnEl = panelBtn;
	}

	/** The gear's slide-out (same panel as the Connections map's): who the tree centres on, how far it reaches, partners. */
	private renderFocusPanel(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: `sg-rg-settings-panel sg-st-focus-panel${this.focusPanelOpen ? ' is-open' : ''}` });
		this.focusPanelEl = panel;
		// Closed = out of reach for Tab and clicks, even where it still overlaps the toolbar.
		panel.toggleAttribute('inert', !this.focusPanelOpen);

		const header = panel.createDiv({ cls: 'sg-rg-settings-header' });
		header.createSpan({ cls: 'sg-rg-settings-title', text: t('storyTree.focusPanel.title') });
		const closeBtn = header.createEl('button', { cls: 'sg-rg-settings-close', title: t('storyTree.focusPanel.close'), attr: { 'aria-label': t('storyTree.focusPanel.close') } });
		setPhosphorIcon(closeBtn, 'x', '✕');
		closeBtn.addEventListener('click', () => this.setFocusPanelOpen(false));

		// Little content, so no folding: the rows sit straight in the panel.
		const body = panel.createDiv({ cls: 'sg-rg-settings-body' });

		const focusRow = body.createDiv({ cls: 'sg-st-focus-row' });
		focusRow.createSpan({ cls: 'sg-st-focus-label', text: t('storyTree.focusPanel.focus') });
		// Whatever the tree is narrowed to: a person, or a family / faction (from here or the Codex).
		const narrowedTo = this.focusPath || (this.mode === 'family' ? this.bloodlinePath : this.factionPath);
		const focusEntity = narrowedTo ? this.entities.find((e) => e.path === narrowedTo) : undefined;
		const focusBtn = focusRow.createEl('button', {
			cls: 'sg-st-focus-select',
			text: focusEntity ? focusEntity.name : t('storyTree.focusPanel.wholeTree'),
		});
		focusBtn.addEventListener('click', () => {
			const placeholder = t(this.mode === 'family' ? 'storyTree.focusPanel.searchFamily' : 'storyTree.focusPanel.searchFaction');
			new TreeFocusModal(this.app, this.focusCandidates(), (entity) => {
				// A person centres the tree; a family or faction shows just that one, as the Codex buttons do.
				const isGroup = GROUP_KINDS.has(entity.kind);
				this.focusPath = isGroup ? '' : entity.path;
				this.bloodlinePath = isGroup && this.mode === 'family' ? entity.path : '';
				this.factionPath = isGroup && this.mode === 'faction' ? entity.path : '';
				this.needsFit = true;
				this.recomputeAndRender();
			}, placeholder).open();
		});
		if (focusEntity) this.renderClearFocusButton(focusRow);

		if (this.focusPath) {
			const depthWrap = body.createDiv({ cls: 'sg-st-depth' });
			depthWrap.createSpan({ cls: 'sg-st-depth-label', text: this.mode === 'family' ? 'Generations up:' : 'Ranks up:' });
			depthWrap.appendChild(this.makeDepthInput(this.generationsUp, (v) => { this.generationsUp = v; this.recomputeAndRender(); }));
			depthWrap.createSpan({ cls: 'sg-st-depth-label', text: 'down:' });
			depthWrap.appendChild(this.makeDepthInput(this.generationsDown, (v) => { this.generationsDown = v; this.recomputeAndRender(); }));
		}

		if (this.mode === 'family') {
			const partnersBtn = body.createEl('button', {
				cls: `sg-st-focus-pill${this.includePartners ? ' is-active' : ''}`,
				text: 'Partners',
				title: this.includePartners ? 'Hide partners' : 'Show partners',
			});
			partnersBtn.addEventListener('click', () => {
				this.includePartners = !this.includePartners;
				this.recomputeAndRender();
			});
		}
	}

	private setFocusPanelOpen(open: boolean): void {
		this.focusPanelOpen = open;
		this.focusPanelEl?.classList.toggle('is-open', open);
		this.focusPanelEl?.toggleAttribute('inert', !open);
		this.focusPanelBtnEl?.classList.toggle('is-active', open);
		this.focusPanelBtnEl?.setAttribute('aria-expanded', String(open));
	}

	private renderClearFocusButton(parent: HTMLElement): void {
		const clearBtn = parent.createEl('button', {
			cls: 'sg-st-focus-clear-btn',
			text: '✕',
			title: 'Clear focus — show the whole tree',
			attr: { 'aria-label': 'Clear focus — show the whole tree' },
		});
		clearBtn.addEventListener('click', () => {
			this.focusPath = '';
			this.bloodlinePath = '';
			this.factionPath = '';
			this.needsFit = true;
			this.recomputeAndRender();
		});
	}

	/**
	 * What the tree is narrowed to, only while it is narrowed — a focus picked
	 * in the panel, or a family / faction opened from the Codex — each with a
	 * ✕ back to the whole tree. Nothing narrowed: no bar at all.
	 */
	private renderFocusBar(parent: HTMLElement): void {
		const focusEntity = this.focusPath ? this.entities.find((e) => e.path === this.focusPath) : undefined;
		const bloodlineShown = this.mode === 'family' && !!this.bloodlinePath;
		const factionShown = this.mode === 'faction' && !!this.factionPath;
		if (!focusEntity && !bloodlineShown && !factionShown) return;

		const bar = parent.createDiv({ cls: 'sg-st-focus-bar' });

		if (focusEntity) {
			bar.createSpan({ cls: 'sg-st-bloodline', text: t('storyTree.focus.showing', { name: focusEntity.name }) });
			this.renderClearFocusButton(bar);
		}

		// Opened from a Bloodline entry: say which family is shown, with a way back to all of them.
		const bloodline = this.mode === 'family' && this.bloodlinePath ? this.entities.find((e) => e.path === this.bloodlinePath) : undefined;
		if (bloodline) {
			bar.createSpan({ cls: 'sg-st-bloodline', text: t('storyTree.bloodline.showing', { name: bloodline.name }) });
			const allBtn = bar.createEl('button', {
				cls: 'sg-st-focus-clear-btn',
				text: '✕',
				title: t('storyTree.bloodline.clear'),
				attr: { 'aria-label': t('storyTree.bloodline.clear') },
			});
			allBtn.addEventListener('click', () => {
				this.bloodlinePath = '';
				this.needsFit = true;
				this.recomputeAndRender();
			});
		}

		// Opened from a faction entry: same chip, with a way back to every faction.
		const faction = this.mode === 'faction' && this.factionPath ? this.entities.find((e) => e.path === this.factionPath) : undefined;
		if (faction) {
			bar.createSpan({ cls: 'sg-st-bloodline', text: t('storyTree.faction.showing', { name: faction.name }) });
			const allBtn = bar.createEl('button', {
				cls: 'sg-st-focus-clear-btn',
				text: '✕',
				title: t('storyTree.faction.clear'),
				attr: { 'aria-label': t('storyTree.faction.clear') },
			});
			allBtn.addEventListener('click', () => {
				this.factionPath = '';
				this.needsFit = true;
				this.recomputeAndRender();
			});
		}
	}

	private makeDepthInput(value: number | undefined, onChange: (v: number | undefined) => void): HTMLInputElement {
		const input = document.createElement('input');
		input.type = 'number';
		input.min = '0';
		input.placeholder = '∞';
		input.className = 'sg-st-depth-input';
		if (value !== undefined) input.value = String(value);
		input.addEventListener('change', () => {
			const n = input.value.trim() === '' ? undefined : Math.max(0, Number(input.value));
			onChange(n !== undefined && Number.isFinite(n) ? n : undefined);
		});
		return input;
	}

	/** What the Focus list offers: Family tree → people and families; Faction hierarchy → factions and other groups, never people. */
	private focusCandidates(): RelEntity[] {
		if (this.mode === 'family') return this.entities.filter((e) => e.kind === 'character' || this.familyGroupPaths.has(e.path));
		return this.entities.filter((e) => GROUP_KINDS.has(e.kind) && e.kind !== 'bloodline');
	}

	private setMode(mode: TreeMode): void {
		if (this.mode === mode) return;
		this.mode = mode;
		this.bloodlinePath = '';
		this.factionPath = '';
		// A focus the new mode's list wouldn't offer (a person in the faction hierarchy) goes too.
		if (this.focusPath && !this.focusCandidates().some((e) => e.path === this.focusPath)) this.focusPath = '';
		this.needsFit = true;
		this.recomputeAndRender();
	}

	/** Half-width/half-height from a node's center to its visible edge, for routing edge lines. */
	private nodeExtent(path: string): { rv: number; rh: number } {
		if ((this.plugin.settings.storyTreeNodeStyle ?? 'card') === 'card') {
			return { rv: CARD_H / 2, rh: CARD_W / 2 };
		}
		const showPortraits = this.plugin.settings.storyTreeShowPortraits ?? true;
		const entry = this.treeData?.nodes.find((n) => n.path === path)?.refPath ?? path;
		const r = showPortraits && this.app.vault.getAbstractFileByPath(this.imagePathByPath.get(entry) ?? '') instanceof TFile
			? NODE_R * 2
			: NODE_R;
		return { rv: r, rh: r };
	}

	private renderEdges(edgeGroup: SVGGElement): void {
		if (!this.treeData) return;
		const rowH = this.rowH();
		const halfW = this.halfW();
		const posByPath = new Map(this.positions.map((p) => [p.path, p]));
		const centerX = (p: TreePosition) => p.x + halfW;
		const rowY = (g: number) => g * rowH;

		const unions = computeUnions(this.treeData, this.mode);
		const unionChildren = new Set<string>();
		const unionPairKeys = new Set<string>();
		for (const u of unions) {
			unionPairKeys.add(u.parentPaths.join('|'));
			for (const c of u.childPaths) unionChildren.add(c);
		}

		const hierEdges = this.treeData.edges.filter((e) => e.kind === 'line');
		const parentsOf = new Map<string, Set<string>>();
		for (const e of hierEdges) {
			if (!parentsOf.has(e.toPath)) parentsOf.set(e.toPath, new Set());
			(parentsOf.get(e.toPath) as Set<string>).add(e.fromPath);
		}
		const sharesParent = (a: string, b: string): boolean => {
			const pa = parentsOf.get(a), pb = parentsOf.get(b);
			if (!pa || !pb) return false;
			for (const p of pa) if (pb.has(p)) return true;
			return false;
		};

		this.edgeMeta.clear();
		this.wordAnchors = [];
		const allEdges = this.treeData.edges;
		const pairEdges = (a: string, b: string, kind: TreeEdge['kind']): TreeEdge[] =>
			allEdges.filter((e) => e.kind === kind && ((e.fromPath === a && e.toPath === b) || (e.fromPath === b && e.toPath === a)));
		const addPath = (d: string, cls: string, people: string[], edges: TreeEdge[]): SVGPathElement => {
			const el = makeSvg('path', { d, class: cls, fill: 'none' }) as SVGPathElement;
			edgeGroup.appendChild(el);
			this.edgeMeta.set(el, { people, edges });
			return el;
		};
		// A wide invisible twin of a line, so a thin line can actually be pointed at.
		const addHit = (d: string, people: string[], edges: TreeEdge[]): void => {
			const el = makeSvg('path', { d, class: 'sg-st-edge-hit', fill: 'none' }) as SVGPathElement;
			edgeGroup.appendChild(el);
			this.edgeMeta.set(el, { people, edges });
		};
		// A couple's line: its look follows how the pair stands (solid, dashed or soft),
		// with one slash for separated and two for divorced, centred on `slashX`.
		this.coupleStatusesShown.clear();
		const addCouple = (d: string, status: CoupleStatus, slashX: number, y: number, people: string[], edges: TreeEdge[]): void => {
			addPath(d, `sg-st-edge sg-st-couple sg-st-couple--${status}`, people, edges);
			addHit(d, people, edges);
			this.coupleStatusesShown.add(status);
			const slashes = status === 'divorced' ? [-3.5, 3.5] : status === 'separated' ? [0] : [];
			for (const off of slashes) {
				const el = makeSvg('path', { d: `M${slashX + off - 3.5},${y + 6} L${slashX + off + 3.5},${y - 6}`, class: 'sg-st-edge sg-st-couple-slash', fill: 'none' }) as SVGPathElement;
				edgeGroup.appendChild(el);
				this.edgeMeta.set(el, { people, edges });
			}
		};
		const addWords = (edges: TreeEdge[], x: number, y: number, center: boolean, key: string): void => {
			for (const e of edges) {
				if (e.label) this.wordAnchors.push({ key, x, y, center, label: e.label, people: [e.fromPath, e.toPath, ...(e.viaPaths ?? [])] });
			}
		};

		// ── Non-connector edges: partners (straight), siblings/cousins (arc), kin (dotted) ──
		// Both sheets usually list the relation (reciprocal lines), so dedupe
		// per pair — otherwise every bond draws twice and looks darker.
		const drawnPairs = new Set<string>();
		for (const edge of this.treeData.edges) {
			if (edge.kind === 'line') continue;
			const from = posByPath.get(edge.fromPath);
			const to = posByPath.get(edge.toPath);
			if (!from || !to) continue;
			const pairKey = [edge.fromPath, edge.toPath].sort().join('|') + '|' + edge.kind;
			if (drawnPairs.has(pairKey)) continue;
			drawnPairs.add(pairKey);

			const fx = centerX(from), fy = rowY(from.generation);
			const tx = centerX(to), ty = rowY(to.generation);
			const fExt = this.nodeExtent(edge.fromPath), tExt = this.nodeExtent(edge.toPath);

			if (edge.kind === 'kin' && from.generation !== to.generation) {
				// Guardian / aunt / uncle: a soft dotted S-curve from the higher card
				// down to the lower one — never the parent connector.
				const top = from.generation < to.generation ? { x: fx, y: fy + fExt.rv } : { x: tx, y: ty + tExt.rv };
				const bot = from.generation < to.generation ? { x: tx, y: ty - tExt.rv } : { x: fx, y: fy - fExt.rv };
				const midY = (top.y + bot.y) / 2;
				const d = `M${top.x},${top.y} C${top.x},${midY} ${bot.x},${midY} ${bot.x},${bot.y}`;
				const people = [edge.fromPath, edge.toPath];
				const edges = pairEdges(edge.fromPath, edge.toPath, 'kin');
				addPath(d, 'sg-st-edge sg-st-edge-kin', people, edges);
				addHit(d, people, edges);
				// The word sits where the line lands on the lower card.
				const lowerPath = from.generation < to.generation ? edge.toPath : edge.fromPath;
				const lowerPos = from.generation < to.generation ? to : from;
				addWords(edges, centerX(lowerPos) + 6, rowY(lowerPos.generation) - this.nodeExtent(lowerPath).rv - 8, false, `top:${lowerPath}`);
			} else if (edge.kind === 'sibling' || edge.kind === 'cousin' || edge.kind === 'kin') {
				// Siblings who share a drawn parent are already joined by that
				// parent's rail — an extra line would just be clutter.
				if (edge.kind === 'sibling' && sharesParent(edge.fromPath, edge.toPath)) continue;
				const peak = Math.min(fy - fExt.rv, ty - tExt.rv) - 18;
				const d = `M${fx},${fy - fExt.rv} Q${(fx + tx) / 2},${peak} ${tx},${ty - tExt.rv}`;
				const people = [edge.fromPath, edge.toPath];
				const edges = pairEdges(edge.fromPath, edge.toPath, edge.kind);
				addPath(d, `sg-st-edge sg-st-edge-${edge.kind}`, people, edges);
				addHit(d, people, edges);
				// Word at the middle of the arc (a quadratic curve at t = 0.5).
				const arcY = 0.25 * (fy - fExt.rv) + 0.5 * peak + 0.25 * (ty - tExt.rv);
				addWords(edges, (fx + tx) / 2, arcY - 4, true, `mid:${Math.round((fx + tx) / 2)}:${Math.round(arcY)}`);
			} else {
				// Partner — a union bar between the same couple already shows the bond.
				const key = [edge.fromPath, edge.toPath].sort().join('|');
				if (unionPairKeys.has(key)) continue;
				const leftFirst = fx <= tx;
				const startX = leftFirst ? fx + fExt.rh : fx - fExt.rh;
				const endX = leftFirst ? tx - tExt.rh : tx + tExt.rh;
				const d = `M${startX},${fy} L${endX},${ty}`;
				const people = [edge.fromPath, edge.toPath];
				const edges = pairEdges(edge.fromPath, edge.toPath, 'partner');
				addCouple(d, coupleStatus(edges.map((e) => e.label)), (startX + endX) / 2, (fy + ty) / 2, people, edges);
				addWords(edges, (startX + endX) / 2, (fy + ty) / 2 - 6, true, `mid:${Math.round((startX + endX) / 2)}:${Math.round((fy + ty) / 2)}`);
			}
		}

		// ── Hierarchy connectors: right-angle stem → rail → drops ──
		const conns: Connector[] = [];

		for (const u of unions) {
			const pos1 = posByPath.get(u.parentPaths[0]);
			const pos2 = posByPath.get(u.parentPaths[1]);
			if (!pos1 || !pos2) continue;

			const y = rowY(pos1.generation);
			const x1 = centerX(pos1), x2 = centerX(pos2);
			const ext1 = this.nodeExtent(u.parentPaths[0]), ext2 = this.nodeExtent(u.parentPaths[1]);
			const leftExt = x1 <= x2 ? ext1 : ext2, rightExt = x1 <= x2 ? ext2 : ext1;
			const barStartX = Math.min(x1, x2) + leftExt.rh, barEndX = Math.max(x1, x2) - rightExt.rh;
			if (barEndX > barStartX) {
				const d = `M${barStartX},${y} L${barEndX},${y}`;
				const edges = pairEdges(u.parentPaths[0], u.parentPaths[1], 'partner');
				// The children's line drops from the middle, so the slashes sit just left of it.
				const mid = (barStartX + barEndX) / 2;
				addCouple(d, u.status, barEndX - barStartX >= 40 ? mid - 13 : mid, y, u.parentPaths, edges);
				addWords(edges, (barStartX + barEndX) / 2, y - 6, true, `mid:${Math.round((barStartX + barEndX) / 2)}:${Math.round(y)}`);
			}

			const kidsByGen = new Map<number, ConnChild[]>();
			for (const childPath of u.childPaths) {
				const childPos = posByPath.get(childPath);
				if (!childPos) continue;
				const cExt = this.nodeExtent(childPath);
				if (!kidsByGen.has(childPos.generation)) kidsByGen.set(childPos.generation, []);
				(kidsByGen.get(childPos.generation) as ConnChild[]).push({
					x: centerX(childPos),
					topY: rowY(childPos.generation) - cExt.rv,
					path: childPath,
					edges: hierEdges.filter((e) => e.toPath === childPath && u.parentPaths.includes(e.fromPath)),
				});
			}
			for (const [g, children] of kidsByGen) {
				conns.push({ srcX: (x1 + x2) / 2, srcY: y, childGen: g, children, cls: 'sg-st-edge sg-st-edge-union-drop', srcPeople: u.parentPaths, decor: [] });
			}
		}

		// Single-parent edges (skip union children — their rail covers them)
		const singleGroups = new Map<string, Connector>();
		for (const e of hierEdges) {
			if (unionChildren.has(e.toPath)) continue;
			const from = posByPath.get(e.fromPath);
			const to = posByPath.get(e.toPath);
			if (!from || !to || from.generation === to.generation) continue;
			// Draw from whichever node sits higher, regardless of edge direction.
			const top = from.generation < to.generation ? from : to;
			const bottom = from.generation < to.generation ? to : from;
			const topPath = top === from ? e.fromPath : e.toPath;
			const bottomPath = bottom === to ? e.toPath : e.fromPath;
			// Faction members hang from their group's leaders (drawn between the
			// group and its members), so the line never runs through a leader card.
			const via = (e.viaPaths ?? [])
				.map((p) => ({ p, pos: posByPath.get(p) }))
				.filter((v): v is { p: string; pos: TreePosition } => !!v.pos && v.pos.generation < bottom.generation);
			const key = via.length
				? `via:${via.map((v) => v.p).sort().join('|')}→${bottom.generation}`
				: `${topPath}→${bottom.generation}`;
			if (!singleGroups.has(key)) {
				const srcGen = via.length ? Math.max(...via.map((v) => v.pos.generation)) : top.generation;
				const leaders = via.filter((v) => v.pos.generation === srcGen);
				const viaXs = leaders.map((v) => centerX(v.pos));
				let srcY = rowY(srcGen) + (leaders.length ? this.nodeExtent(leaders[0].p).rv : this.nodeExtent(topPath).rv);
				const decor: SVGPathElement[] = [];
				if (leaders.length > 1) {
					// Two leaders share their members: a short drop from each onto one bar.
					const barY = srcY + 10;
					for (const x of viaXs) decor.push(addPath(`M${x},${srcY} L${x},${barY}`, 'sg-st-edge', [], []));
					decor.push(addPath(`M${Math.min(...viaXs)},${barY} L${Math.max(...viaXs)},${barY}`, 'sg-st-edge', [], []));
					srcY = barY;
				}
				singleGroups.set(key, {
					srcX: leaders.length ? (Math.min(...viaXs) + Math.max(...viaXs)) / 2 : centerX(top),
					srcY,
					childGen: bottom.generation,
					children: [],
					cls: 'sg-st-edge',
					srcPeople: [topPath, ...leaders.map((v) => v.p)],
					decor,
				});
			}
			const bExt = this.nodeExtent(bottomPath);
			const conn = singleGroups.get(key) as Connector;
			if (!conn.srcPeople.includes(topPath)) conn.srcPeople.push(topPath);
			conn.children.push({
				x: centerX(bottom),
				topY: rowY(bottom.generation) - bExt.rv,
				path: bottomPath,
				edges: [e],
			});
		}
		conns.push(...singleGroups.values());
		// The bar drawn at a faction's leaders belongs to the whole connector, so it
		// stays bright whenever anyone on it is pointed at.
		for (const c of conns) {
			const people = [...c.srcPeople, ...c.children.map((k) => k.path)];
			for (const el of c.decor) this.edgeMeta.set(el, { people, edges: [] });
		}

		// Relationship words: one per parent line, written on the lower card where
		// the line lands ("Mother · Father" when both parents land on one child).
		for (const e of hierEdges) {
			const from = posByPath.get(e.fromPath);
			const to = posByPath.get(e.toPath);
			if (!from || !to || from.generation === to.generation) continue;
			const lowerPath = from.generation < to.generation ? e.toPath : e.fromPath;
			const lowerPos = from.generation < to.generation ? to : from;
			addWords([e], centerX(lowerPos) + 6, rowY(lowerPos.generation) - this.nodeExtent(lowerPath).rv - 8, false, `top:${lowerPath}`);
		}

		// Assign each connector its own rail lane within the row gap so two
		// families' rails never overlap into one confusing line.
		const byGen = new Map<number, Connector[]>();
		for (const c of conns) {
			if (!byGen.has(c.childGen)) byGen.set(c.childGen, []);
			(byGen.get(c.childGen) as Connector[]).push(c);
		}
		for (const [g, group] of byGen) {
			group.sort((a, b) => a.srcX - b.srcX);
			const n = group.length;
			group.forEach((c, i) => {
				const offset = Math.max(-16, Math.min(16, (i - (n - 1) / 2) * 8));
				this.drawConnector(edgeGroup, c, rowY(g) - rowH / 2 + offset);
			});
		}
	}

	/** Draw one stem → rail → drops connector with rounded bends. */
	private drawConnector(edgeGroup: SVGGElement, c: Connector, railY: number): void {
		// Every piece remembers who it joins (for fading) and, through an invisible
		// wide twin, which relationships it stands for (for the tag). A child's own
		// drop speaks for that child alone; the stem and rail speak for everyone on it.
		const everyone = [...c.srcPeople, ...c.children.map((k) => k.path)];
		const everyEdge = c.children.flatMap((k) => k.edges);
		const addPath = (d: string, own?: ConnChild): void => {
			const el = makeSvg('path', { d, class: c.cls, fill: 'none' }) as SVGPathElement;
			edgeGroup.appendChild(el);
			this.edgeMeta.set(el, own ? { people: [...c.srcPeople, own.path], edges: own.edges } : { people: everyone, edges: everyEdge });
		};
		const addHit = (d: string, own?: ConnChild): void => {
			const el = makeSvg('path', { d, class: 'sg-st-edge-hit', fill: 'none' }) as SVGPathElement;
			edgeGroup.appendChild(el);
			this.edgeMeta.set(el, own ? { people: [...c.srcPeople, own.path], edges: own.edges } : { people: everyone, edges: everyEdge });
		};
		if (c.children.length === 0) return;

		if (c.children.length === 1) {
			const k = c.children[0];
			const d = Math.abs(k.x - c.srcX) < 0.5
				? `M${c.srcX},${c.srcY} L${k.x},${k.topY}`
				: roundedOrthoPath([[c.srcX, c.srcY], [c.srcX, railY], [k.x, railY], [k.x, k.topY]], EDGE_BEND_R);
			addPath(d, k);
			addHit(d, k);
			return;
		}

		const sorted = [...c.children].sort((a, b) => a.x - b.x);
		const left = sorted[0], right = sorted[sorted.length - 1];

		// Stem from source down to the rail
		const stem = `M${c.srcX},${c.srcY} L${c.srcX},${railY}`;
		addPath(stem);
		addHit(stem);
		// Outer frame: left drop, rail, right drop — one path so the corners round cleanly
		addPath(roundedOrthoPath([[left.x, left.topY], [left.x, railY], [right.x, railY], [right.x, right.topY]], EDGE_BEND_R));
		// Rail extensions when the source sits outside the children's span
		if (c.srcX < left.x) addPath(`M${c.srcX},${railY} L${left.x},${railY}`);
		if (c.srcX > right.x) addPath(`M${right.x},${railY} L${c.srcX},${railY}`);
		// Interior drops
		for (let i = 1; i < sorted.length - 1; i++) {
			addPath(`M${sorted[i].x},${railY} L${sorted[i].x},${sorted[i].topY}`, sorted[i]);
		}
		// Pointing areas: the rail as a whole, plus one drop per child (so the outer
		// children's drops can be pointed at on their own, though they are drawn as one frame).
		addHit(`M${Math.min(left.x, c.srcX)},${railY} L${Math.max(right.x, c.srcX)},${railY}`);
		for (const k of sorted) addHit(`M${k.x},${railY} L${k.x},${k.topY}`, k);
	}

	/** (Re)draw every node. Called on render and whenever zooming steps the name size. */
	private renderNodes(): void {
		const nodeGroup = this.nodeGroup, defs = this.defsEl;
		if (!nodeGroup || !defs) return;
		nodeGroup.replaceChildren();
		defs.replaceChildren();
		const nodeStyle = this.plugin.settings.storyTreeNodeStyle ?? 'card';
		const showPortraits = this.plugin.settings.storyTreeShowPortraits ?? true;
		const fontSize = this.labelSize();
		this.drawnLabelSize = fontSize;
		// Far out, a card is just its name — larger, no portrait — so it stays readable.
		const nameOnly = fontSize >= NAME_ONLY_FROM;
		const lineH = Math.round(fontSize * 1.2);
		let portraitCounter = 0;
		const nodeByPath = new Map((this.treeData?.nodes ?? []).map((n) => [n.path, n]));
		const cardHByPath = new Map<string, number>();

		// Someone in more than one faction has a card in each block; each card names the other factions.
		const blockGroupOf = new Map<string, string>();
		const groupsOfEntry = new Map<string, string[]>();
		for (const b of this.blocks) {
			if (!b.groupPath) continue;
			for (const p of b.paths) {
				const n = nodeByPath.get(p);
				if (!n || GROUP_KINDS.has(n.kind)) continue;
				blockGroupOf.set(p, b.groupPath);
				const entry = n.refPath ?? n.path;
				groupsOfEntry.set(entry, [...(groupsOfEntry.get(entry) ?? []), b.groupPath]);
			}
		}

		for (const pos of this.positions) {
			const node = nodeByPath.get(pos.path);
			if (!node) continue;

			// A second card for someone in two factions stands for the same entry.
			const entryPath = node.refPath ?? node.path;
			const isHeader = this.mode === 'faction' && GROUP_KINDS.has(node.kind);
			const color = (isHeader ? this.groupColorByPath.get(node.path) : this.personColorByPath.get(entryPath))
				?? KIND_COLORS[node.kind] ?? '#6b7280';
			const cx = pos.x + this.halfW();
			const cy = pos.generation * this.rowH();
			const imagePath = showPortraits ? this.imagePathByPath.get(entryPath) : null;
			const imgFile = imagePath ? this.app.vault.getAbstractFileByPath(imagePath) : null;
			const hasPortrait = imgFile instanceof TFile && !(nodeStyle === 'card' && nameOnly);
			const deceased = this.deceasedByPath.get(entryPath) ?? false;
			const name = node.placeholder ? t('storyTree.unknownParent') : node.name;
			const alsoIn = (groupsOfEntry.get(entryPath) ?? [])
				.filter((gp) => gp !== blockGroupOf.get(node.path))
				.map((gp) => nodeByPath.get(gp)?.name ?? '');
			const alsoText = alsoIn.length ? t('storyTree.alsoIn', { names: alsoIn.join(', ') }) : '';
			let cardH = CARD_H;

			// The "unknown parent" has no file: drawn faint, not focusable, no click.
			const g = makeSvg('g', node.placeholder
				? { class: 'sg-st-node is-placeholder', transform: `translate(${cx},${cy})`, 'data-path': node.path, 'aria-label': name }
				: {
					class: `sg-st-node${entryPath === this.focusPath ? ' is-focus' : ''}${hasPortrait ? ' has-portrait' : ''}${deceased ? ' is-deceased' : ''}${isHeader ? ' is-header' : ''}`,
					transform: `translate(${cx},${cy})`,
					'data-path': node.path,
					tabindex: '0',
					role: 'button',
					'aria-label': alsoText ? `${name} · ${alsoText}` : name,
				}) as SVGGElement;
			if (isHeader) g.setAttribute('style', `--sg-st-group: ${color}`);

			if (nodeStyle === 'card') {
				const portraitCx = -CARD_W / 2 + CARD_PAD + CARD_PORTRAIT / 2;
				// No image on the entry: a round placeholder takes the portrait's place and
				// size — initials, a "?" for the unknown parent, a shield on a faction header.
				const showCircle = !nameOnly && !hasPortrait && (isHeader || !!node.placeholder || showPortraits);
				const textLeft = nameOnly ? -CARD_W / 2 + CARD_PAD : hasPortrait || showCircle ? portraitCx + CARD_PORTRAIT / 2 + 9 : -CARD_W / 2 + CARD_PAD + 6;
				const textWidth = CARD_W / 2 - CARD_PAD - textLeft - (alsoText && !nameOnly ? 14 : 0);
				// Full name over up to two lines, then a small line: years, a role, or a head count.
				const sub = nameOnly ? '' : this.cardSubline(node, entryPath);
				const subSize = Math.max(10, Math.round(fontSize * 0.85));
				const lines = wrapName(name, Math.max(4, Math.floor(textWidth / (fontSize * GLYPH_W))), 2);
				const textH = lines.length * lineH + (sub ? subSize + 4 : 0);
				cardH = Math.max(CARD_H, textH + 18);

				g.appendChild(makeSvg('rect', {
					x: String(-CARD_W / 2), y: String(-cardH / 2),
					width: String(CARD_W), height: String(cardH),
					rx: '6', class: `sg-st-node-card${isHeader ? ' sg-st-node-header' : ''}`,
				}));
				// The strip on the left is the person's faction or family colour (their kind colour without one).
				if (!isHeader && !node.placeholder) {
					g.appendChild(makeSvg('rect', {
						x: String(-CARD_W / 2), y: String(-cardH / 2 + 10),
						width: '4', height: String(cardH - 20), fill: color, class: 'sg-st-node-accent',
					}));
				}

				if (hasPortrait) {
					const r = CARD_PORTRAIT / 2;
					const clipId = `sg-st-clip-${portraitCounter++}`;
					const clip = makeSvg('clipPath', { id: clipId }) as SVGClipPathElement;
					clip.appendChild(makeSvg('circle', { cx: String(portraitCx), cy: '0', r: String(r) }));
					defs.appendChild(clip);

					g.appendChild(makeSvg('image', {
						x: String(portraitCx - r), y: String(-r), width: String(r * 2), height: String(r * 2),
						href: this.app.vault.getResourcePath(imgFile),
						'clip-path': `url(#${clipId})`,
						preserveAspectRatio: 'xMidYMid slice',
					}));
					g.appendChild(makeSvg('circle', {
						cx: String(portraitCx), cy: '0', r: String(r), fill: 'none', stroke: color, 'stroke-width': '2', class: 'sg-st-node-circle',
					}));
				} else if (isHeader && showCircle) {
					g.appendChild(phosphorSvg('shield-bold', portraitCx - 15, -15, 30, 'sg-st-header-icon')).setAttribute('pointer-events', 'none');
				} else {
					if (showCircle) {
						// Tinted by the faction colour when the person has one, a calm neutral otherwise
						// (the tint is a CSS variable, so light and dark are handled in styles.css).
						const tint = node.placeholder ? undefined : this.personColorByPath.get(entryPath);
						const circle = makeSvg('g', { class: `sg-st-ph${node.placeholder ? ' is-unknown' : ''}`, 'pointer-events': 'none' }) as SVGGElement;
						if (tint) circle.setAttribute('style', `--sg-st-ph: ${tint}`);
						circle.appendChild(makeSvg('circle', { cx: String(portraitCx), cy: '0', r: String(CARD_PORTRAIT / 2), class: 'sg-st-ph-circle' }));
						const letters = makeSvg('text', {
							x: String(portraitCx), y: '0',
							'text-anchor': 'middle', 'dominant-baseline': 'central',
							'font-size': '13', class: 'sg-st-ph-initials',
						});
						letters.textContent = node.placeholder ? '?' : initialsOf(name);
						circle.appendChild(letters);
						g.appendChild(circle);
					}
				}

				const label = makeSvg('text', {
					'text-anchor': nameOnly ? 'middle' : 'start',
					fill: 'var(--text-normal)',
					'font-size': String(fontSize),
					'pointer-events': 'none',
					class: 'sg-st-node-label',
				});
				const top = -textH / 2;
				lines.forEach((line, i) => {
					const span = makeSvg('tspan', { x: String(nameOnly ? 0 : textLeft), y: String(top + lineH / 2 + fontSize * 0.35 + i * lineH) });
					span.textContent = line;
					label.appendChild(span);
				});
				g.appendChild(label);
				if (sub) {
					const subEl = makeSvg('text', {
						x: String(textLeft), y: String(top + lines.length * lineH + 4 + subSize * 0.8),
						'font-size': String(subSize), 'pointer-events': 'none', class: 'sg-st-node-sub',
					});
					subEl.textContent = truncate(sub, Math.max(6, Math.floor(textWidth / (subSize * GLYPH_W))));
					g.appendChild(subEl);
				}
				if (alsoText && !nameOnly) {
					// Also in another faction: a small link mark that names the others on hover.
					const mark = phosphorSvg('link', CARD_W / 2 - 20, -cardH / 2 + 6, 14, 'sg-st-also-in');
					const tip = makeSvg('title');
					tip.textContent = alsoText;
					mark.appendChild(tip);
					g.appendChild(mark);
				}
				cardHByPath.set(node.path, cardH);
			} else {
				// Compact dots are only 16-32px across (NODE_R or NODE_R*2 with a
				// portrait) — well under the 44pt/48dp minimum touch target. Rather
				// than change the locked visual size, an invisible larger circle
				// underneath gives touch users a comfortable hit area for free:
				// pointer handlers below are bound to the parent <g>, so any child
				// that catches the pointer event (visible dot or this one) bubbles
				// up to the same listener.
				g.appendChild(makeSvg('circle', { r: '22', fill: 'transparent', class: 'sg-st-node-hit' }));

				if (hasPortrait) {
					const r = NODE_R * 2;
					const clipId = `sg-st-clip-${portraitCounter++}`;
					const clip = makeSvg('clipPath', { id: clipId }) as SVGClipPathElement;
					clip.appendChild(makeSvg('circle', { r: String(r) }));
					defs.appendChild(clip);

					const image = makeSvg('image', {
						x: String(-r), y: String(-r), width: String(r * 2), height: String(r * 2),
						href: this.app.vault.getResourcePath(imgFile),
						'clip-path': `url(#${clipId})`,
						preserveAspectRatio: 'xMidYMid slice',
					});
					g.appendChild(image);
					g.appendChild(makeSvg('circle', { r: String(r), fill: 'none', stroke: color, 'stroke-width': '2', class: 'sg-st-node-circle' }));
				} else {
					const circle = makeSvg('circle', { r: String(NODE_R), fill: color, class: 'sg-st-node-circle' });
					g.appendChild(circle);
				}

				const label = makeSvg('text', {
					'text-anchor': 'middle',
					y: String((hasPortrait ? NODE_R * 2 : NODE_R) + 3 + fontSize),
					fill: 'var(--text-normal)',
					'font-size': String(fontSize),
					'pointer-events': 'none',
					class: 'sg-st-node-label',
				});
				const dotRoom = LAYOUT_DOT.nodeW + LAYOUT_DOT.gapX * 0.8;
				label.textContent = truncate(name, Math.max(8, Math.min(24, Math.floor(dotRoom / (fontSize * GLYPH_W)))));
				g.appendChild(label);
			}

			// Deceased: the card is greyed (styles.css) and the small line shows the years — no ✕.

			if (node.placeholder) {
				nodeGroup.appendChild(g);
				continue;
			}

			g.addEventListener('pointerdown', (e: PointerEvent) => {
				if (e.pointerType === 'mouse' && e.button !== 0) return;
				// A pinch is already active (e.g. a palm edge landing on a different
				// node as a 3rd touch) — don't arm a tap that could fire once every
				// finger eventually lifts. See bindSvgEvents for the rest of this guard.
				if (this.isPinching) return;
				// Don't stopPropagation — the svg pointerdown must still run to pan/capture.
				this.tapCandidate = { node, openFile: e.ctrlKey || e.metaKey, x: e.clientX, y: e.clientY };
			});

			g.addEventListener('contextmenu', (e: MouseEvent) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((i) => i.setTitle('Focus here').setIcon('crosshair').onClick(() => {
					this.focusPath = entryPath;
					this.bloodlinePath = '';
					this.factionPath = '';
					this.needsFit = true;
					this.recomputeAndRender();
				}));
				menu.showAtMouseEvent(e);
			});

			// Keyboard equivalent of a plain click (see onPointerUp in bindSvgEvents) —
			// the node <g> is tabindex="0"/role="button" above, but had no key handler at all.
			g.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					this.previewNode(node);
				}
			});

			nodeGroup.appendChild(g);
		}
		this.renderBlocks(cardHByPath);
	}

	/** The small line under a name: the unknown parent's note, a faction's head count, a member's role, or the years. */
	private cardSubline(node: TreeNode, entryPath: string): string {
		if (node.placeholder) return t('storyTree.unknownParentNote');
		if (this.mode === 'faction' && GROUP_KINDS.has(node.kind)) {
			const block = this.blocks.find((b) => b.groupPath === node.path);
			const kinds = new Map((this.treeData?.nodes ?? []).map((n) => [n.path, n.kind as string]));
			const count = block ? block.paths.filter((p) => !GROUP_KINDS.has(kinds.get(p) ?? '')).length : 0;
			return count === 1 ? t('storyTree.block.person') : t('storyTree.block.people', { count: String(count) });
		}
		if (this.mode === 'faction') {
			// Their role in the faction, as written on the sheet ("Leader", "Member").
			const roles = (this.treeData?.edges ?? [])
				.filter((e) => e.kind === 'line' && e.toPath === node.path && groupRoleOf(e.label) !== null)
				.sort((a, b) => Number(groupRoleOf(b.label) === 'leader') - Number(groupRoleOf(a.label) === 'leader'));
			if (roles.length) return roles[0].label;
		}
		return this.yearsText(entryPath);
	}

	/** "1061–1129", "b. 1102", "aged 81", or "died" — from the sheet's Born, Died, Age and Life Status. */
	private yearsText(path: string): string {
		const f = this.lifeFactsByPath.get(path);
		if (!f) return '';
		if (f.born !== undefined && f.died !== undefined) return `${f.born}–${f.died}`;
		if (f.died !== undefined) return t('storyTree.years.died', { year: String(f.died) });
		if (f.born !== undefined) return t(f.deceased ? 'storyTree.years.bornDeceased' : 'storyTree.years.born', { year: String(f.born) });
		if (f.age !== undefined) return t(f.deceased ? 'storyTree.years.diedAged' : 'storyTree.years.aged', { age: String(f.age) });
		return f.deceased ? t('storyTree.years.deceased') : '';
	}

	/**
	 * Group labels, no frames: "Leads" / "Members" beside a faction's rows (its
	 * header is the faction's own label) and a plain title above each family of two
	 * or more, named after its Bloodline entry. Redrawn with the cards, so labels
	 * follow card heights and the title grows with the names when zoomed out.
	 */
	private renderBlocks(cardHByPath: Map<string, number>): void {
		const group = this.blockGroup;
		if (!group || !this.treeData) return;
		group.replaceChildren();
		const card = this.isCardStyle();
		const fontSize = this.labelSize();
		const nameOnly = card && fontSize >= NAME_ONLY_FROM;
		const rowH = this.rowH();
		const posByPath = new Map(this.positions.map((p) => [p.path, p]));
		const nodeByPath = new Map(this.treeData.nodes.map((n) => [n.path, n]));
		const titleSize = fontSize + 3;
		const titleH = Math.round(titleSize * 1.4) + 8;

		for (const b of this.blocks) {
			if (b.kind !== 'faction' && b.paths.length < 2) continue;
			const title = b.kind === 'family' ? this.familyTitle(b) : '';
			let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
			for (const p of b.paths) {
				const pos = posByPath.get(p);
				if (!pos) continue;
				const cx = pos.x + this.halfW(), cy = pos.generation * rowH;
				const halfH = card ? (cardHByPath.get(p) ?? CARD_H) / 2 : NODE_R * 2;
				const below = card ? halfH : NODE_R * 2 + fontSize + 8; // dot labels sit under the dot
				const halfW = card ? CARD_W / 2 : LAYOUT_DOT.nodeW / 2;
				minX = Math.min(minX, cx - halfW);
				maxX = Math.max(maxX, cx + halfW);
				minY = Math.min(minY, cy - halfH);
				maxY = Math.max(maxY, cy + below);
			}
			if (minX === Infinity) continue;
			// No frame around a group (Emma: framed boxes look ugly) — the spacing between
			// groups and a plain title above each family is the grouping.
			const top = minY - BLOCK_PAD - (title ? titleH : 0);

			if (title) {
				const text = makeSvg('text', {
					x: String(minX - BLOCK_PAD + 12), y: String(top + 8 + titleSize),
					'font-size': String(titleSize), class: 'sg-st-block-title',
				});
				// Never wider than its own frame, so it can't run into the next family's.
				const room = maxX - minX + BLOCK_PAD * 2 - 24;
				text.textContent = truncate(title, Math.max(6, Math.floor(room / (titleSize * GLYPH_W))));
				group.appendChild(text);
			}

			// Rank names on the left of a faction's leader row and member row.
			if (b.kind === 'faction' && b.groupPath && card && !nameOnly) {
				const fromGroup = this.treeData.edges.filter((e) => e.kind === 'line' && e.fromPath === b.groupPath);
				const members = new Set(fromGroup.filter((e) => e.viaPaths?.length).map((e) => e.toPath));
				const leaders = new Set(fromGroup.flatMap((e) => e.viaPaths ?? []));
				for (const e of fromGroup) if (!e.viaPaths?.length && groupRoleOf(e.label) === 'leader') leaders.add(e.toPath);
				const rows = new Map<number, string[]>();
				for (const p of b.paths) {
					const pos = posByPath.get(p);
					if (pos) rows.set(pos.generation, [...(rows.get(pos.generation) ?? []), p]);
				}
				for (const [gen, paths] of rows) {
					const word = paths.every((p) => leaders.has(p)) ? t('storyTree.rank.leads')
						: paths.every((p) => members.has(p)) ? t('storyTree.rank.members') : '';
					if (!word || paths.some((p) => nodeByPath.get(p)?.kind && GROUP_KINDS.has(nodeByPath.get(p)?.kind as string))) continue;
					const rowTop = gen * rowH - Math.max(...paths.map((p) => cardHByPath.get(p) ?? CARD_H)) / 2;
					const label = makeSvg('text', {
						x: String(minX - BLOCK_PAD + 10), y: String(rowTop - 7),
						'font-size': '10', class: 'sg-st-rank-label',
					});
					label.textContent = word.toLocaleUpperCase();
					group.appendChild(label);
				}
			}
		}
	}

	/**
	 * A family block's title: the Bloodline (or family-type faction) most of its
	 * people are tied to; else the surname most of them share ("The Ferrow
	 * family"); else the eldest person's family.
	 */
	private familyTitle(b: TreeBlock): string {
		const inBlock = new Set(b.paths);
		const nameOf = (p: string) => this.entities.find((e) => e.path === p)?.name ?? '';
		const counts = new Map<string, number>();
		for (const l of this.groupLinks) {
			if (inBlock.has(l.person) && this.familyGroupPaths.has(l.group)) counts.set(l.group, (counts.get(l.group) ?? 0) + 1);
		}
		const best = [...counts].sort((a, c) => c[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(c[0])))[0];
		if (best) return nameOf(best[0]);
		const people = (this.treeData?.nodes ?? []).filter((n) => inBlock.has(n.path) && !n.placeholder);
		const surnames = new Map<string, number>();
		for (const n of people) {
			const words = n.name.trim().split(/\s+/);
			if (words.length > 1) surnames.set(words[words.length - 1], (surnames.get(words[words.length - 1]) ?? 0) + 1);
		}
		const surname = [...surnames].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0]))[0];
		if (surname && surname[1] >= 2) return t('storyTree.block.surname', { name: surname[0] });
		const eldest = [...people].sort((a, c) => a.generation - c.generation || a.name.localeCompare(c.name))[0];
		return eldest ? t('storyTree.block.familyOf', { name: eldest.name }) : '';
	}

	private openNodeFile(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		// Codex entries open as their Codex page; anything else as the note.
		if (file instanceof TFile) void this.plugin.openEntryInCodex(this.scopeRoot, file.path, 'tree');
	}

	/** True when this tap follows another on the same node inside the double-tap window. */
	private isDoubleTap(path: string): boolean {
		const now = Date.now();
		const isDouble = this.lastTap?.path === path && now - this.lastTap.time < DOUBLE_TAP_MS;
		this.lastTap = isDouble ? null : { path, time: now };
		return isDouble;
	}

	/** Single click on a node: open/refresh the Writers Panel preview. */
	private previewNode(node: TreeNode): void {
		// Same path as the Connections Map: reveal the panel WITHOUT pointing it at
		// another grid first (openOutline re-targets the panel to the active plot
		// grid and renders it, which could replace the preview).
		void (async () => {
			const view = await this.plugin.revealOutline();
			if (view instanceof StorygridOutlineView) {
				await view.showEntityPreview(this.scopeRoot, node.refPath ?? node.path);
			}
		})();
	}

	// ── SVG pan / zoom ────────────────────────────────────────────────────────

	private bindSvgEvents(svg: SVGSVGElement, wrap: HTMLElement): void {
		// A fresh SVG has no pointer on it. A re-render (vault refresh) that lands
		// while a button is held leaves the old SVG's pointer-up unheard; without
		// this reset that pointer stays "down" forever, every later click reads as
		// a second finger (pinch), and no tap — no preview — ever fires again.
		this.activePointers.clear();
		this.panning = false;
		this.panPointerId = null;
		this.isPinching = false;
		this.pinchPointerIds = null;
		this.tapCandidate = null;

		wrap.addEventListener('wheel', (e: WheelEvent) => {
			e.preventDefault();
			this.applyZoom(this.scale * (e.deltaY < 0 ? 1.1 : 0.9), { x: e.clientX, y: e.clientY });
		}, { passive: false });

		svg.addEventListener('pointerdown', (e: PointerEvent) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			svg.setPointerCapture(e.pointerId);
			this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

			// A pinch already has its two pointers tracked — a 3rd+ touch (e.g. a
			// palm edge) must never reassign its reference point. It still lands
			// in `activePointers` above (for bookkeeping/cleanup) but is otherwise
			// ignored here.
			if (this.pinchPointerIds) return;

			if (this.panPointerId !== null) {
				// A 2nd finger joining an active single-finger pan upgrades it to a
				// pinch, tracked by exactly these two pointer ids — never by
				// whichever two entries happen to be in `activePointers`.
				const firstId = this.panPointerId;
				this.isPinching = true;
				this.panning = false;
				this.panPointerId = null;
				svg.style.cursor = '';
				this.pinchPointerIds = [firstId, e.pointerId];
				const a = this.activePointers.get(firstId);
				const b = this.activePointers.get(e.pointerId);
				this.pinchStartDist = a && b ? pointerDist(a, b) : 0;
				this.pinchStartScale = this.scale;
				// A pinch has started — this gesture can never resolve to a tap
				// (see onPointerUp), even if the first finger never moved.
				this.tapCandidate = null;
				return;
			}

			// First finger down — start a pan.
			this.panning = true;
			this.panPointerId = e.pointerId;
			this.panClientStart = { x: e.clientX, y: e.clientY };
			this.panTxStart = this.tx;
			this.panTyStart = this.ty;
			svg.style.cursor = 'grabbing';
		});

		svg.addEventListener('pointermove', (e: PointerEvent) => {
			if (!this.activePointers.has(e.pointerId)) return;
			this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

			// Moved far enough to be a pan, not a tap — cancel the pending tap.
			if (this.tapCandidate && !isTap(e.clientX - this.tapCandidate.x, e.clientY - this.tapCandidate.y)) {
				this.tapCandidate = null;
			}

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
			// stray extra touch lifting must not affect an active pinch.
			if (this.isPinching && this.pinchPointerIds && this.pinchPointerIds.includes(e.pointerId)) {
				this.isPinching = false;
				this.pinchPointerIds = null;
				const remaining = Array.from(this.activePointers.entries());
				if (remaining.length === 1) {
					// Hand the gesture to the finger still down, so pinch-then-drag
					// keeps panning instead of dead-ending until the writer lifts and
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

			// Pointer went down on a node and came back up without panning → a tap.
			// A pointercancel is NOT a tap — the OS took the gesture away (a system
			// gesture, an incoming call, the WebView scrolling underneath), and a
			// stationary press cancelled that way used to resolve as a tap and open
			// a preview the writer never asked for. The candidate is still dropped
			// so it can never fire later.
			if (this.tapCandidate && this.activePointers.size === 0) {
				const { node, openFile } = this.tapCandidate;
				this.tapCandidate = null;
				if (e.type === 'pointerup') {
					if (openFile || this.isDoubleTap(node.path)) this.openNodeFile(node.refPath ?? node.path);
					else this.previewNode(node);
				}
			}

			// End the pan only when ITS own tracked pointer ends.
			if (this.panning && e.pointerId === this.panPointerId) {
				this.panning = false;
				this.panPointerId = null;
				svg.style.cursor = '';
			}
		};

		svg.addEventListener('pointerup', onPointerUp);
		svg.addEventListener('pointercancel', onPointerUp);

		// ── Hover: relationship info ──
		// Mouse/pen only, and never while a button is held (that is a pan or a tap
		// in progress). Hover only fades, labels and tags — it changes no view state.
		svg.addEventListener('pointerover', (e: PointerEvent) => {
			if (e.pointerType === 'touch' || this.activePointers.size > 0) return;
			const target = e.target instanceof Element ? e.target : null;
			const nodeEl = target?.closest('.sg-st-node:not(.is-placeholder)') ?? null;
			const hitEl = nodeEl ? null : target?.closest('.sg-st-edge-hit') ?? null;
			this.applyHover(nodeEl?.getAttribute('data-path') ?? null);
			if (hitEl) this.showTip(hitEl, e, wrap);
			else this.hideTip();
		});
		svg.addEventListener('pointermove', (e: PointerEvent) => {
			if (this.tipEl?.classList.contains('is-visible')) this.placeTip(e, wrap);
		});
		svg.addEventListener('pointerleave', () => {
			if (this.activePointers.size > 0) return;
			this.applyHover(null);
			this.hideTip();
		});
	}

	// ── Hover: relationship info ──────────────────────────────────────────────

	private edgeInfoMode(): EdgeInfoMode {
		return this.plugin.settings.storyTreeEdgeLabelMode ?? 'hover';
	}

	private nameOfPath(path: string): string {
		const node = this.treeData?.nodes.find((n) => n.path === path);
		if (node?.placeholder) return t('storyTree.unknownParent');
		return node?.name ?? this.entities.find((e) => e.path === path)?.name ?? t('storyTree.unknownParent');
	}

	/**
	 * Point at a person: they and everyone they are connected to stay bright, the
	 * rest fades, and (in "On hover") their relationship words appear. `null`
	 * clears it. Only classes and the small word layer change.
	 */
	private applyHover(path: string | null): void {
		if (this.edgeInfoMode() === 'off') path = null;
		this.hoveredPath = path;

		// Someone in two factions has two cards: pointing at either lights up both, with their lines.
		const entryOf = (p: string) => this.treeData?.nodes.find((n) => n.path === p)?.refPath ?? p;
		const twins = new Set<string>();
		if (path && this.treeData) {
			const entry = entryOf(path);
			for (const n of this.treeData.nodes) if ((n.refPath ?? n.path) === entry) twins.add(n.path);
			twins.add(path);
		}
		const connected = new Set<string>();
		if (path && this.treeData) {
			for (const p of twins) connected.add(p);
			for (const e of this.treeData.edges) {
				const touches = twins.has(e.fromPath) || twins.has(e.toPath) || (e.viaPaths?.some((v) => twins.has(v)) ?? false);
				if (!touches) continue;
				connected.add(e.fromPath);
				connected.add(e.toPath);
				for (const v of e.viaPaths ?? []) connected.add(v);
			}
		}

		this.nodeGroup?.querySelectorAll('.sg-st-node').forEach((g) => {
			const p = g.getAttribute('data-path') ?? '';
			g.classList.toggle('is-dimmed', !!path && !connected.has(p));
		});
		this.edgeGroup?.querySelectorAll('.sg-st-edge').forEach((el) => {
			const meta = this.edgeMeta.get(el);
			el.classList.toggle('is-dimmed', !!path && !!meta && !meta.people.some((p) => twins.has(p)));
		});
		this.syncWords();
	}

	/** Redraw the relationship words only when what they depend on has changed. */
	private syncWords(): void {
		if (`${this.edgeInfoMode()}|${this.hoveredPath ?? ''}|${this.labelSize()}` !== this.drawnWords) this.renderWords();
	}

	/**
	 * Relationship words ("Mother", "Cousin", "Leader"): just the pointed-at
	 * person's in "On hover", every line's in "Always show". Words that land on the
	 * same spot are written together ("Mother · Father").
	 */
	private renderWords(): void {
		const group = this.wordGroup;
		if (!group) return;
		const mode = this.edgeInfoMode();
		const hovered = this.hoveredPath;
		group.replaceChildren();
		this.drawnWords = `${mode}|${hovered ?? ''}|${this.labelSize()}`;
		if (mode === 'off') return;

		// Both cards of someone in two factions show their words.
		const entryOf = (p: string) => this.treeData?.nodes.find((n) => n.path === p)?.refPath ?? p;
		const hoveredEntry = hovered ? entryOf(hovered) : null;
		const bySpot = new Map<string, { at: WordAnchor; labels: string[] }>();
		for (const a of this.wordAnchors) {
			if (mode !== 'always' && !(hoveredEntry && a.people.some((p) => entryOf(p) === hoveredEntry))) continue;
			const spot = bySpot.get(a.key) ?? { at: a, labels: [] };
			if (!spot.labels.includes(a.label)) spot.labels.push(a.label);
			bySpot.set(a.key, spot);
		}
		const fontSize = Math.max(11, Math.round(this.labelSize() * 0.9));
		for (const { at, labels } of bySpot.values()) {
			const text = makeSvg('text', {
				x: String(at.x), y: String(at.y),
				'text-anchor': at.center ? 'middle' : 'start',
				'font-size': String(fontSize),
				class: 'sg-st-word',
			});
			text.textContent = labels.join(' · ');
			group.appendChild(text);
		}
	}

	/** Tag on a pointed-at line: who → who: the word, one row per relationship the line stands for. */
	private showTip(hit: Element, e: PointerEvent, wrap: HTMLElement): void {
		const tip = this.tipEl;
		const meta = this.edgeMeta.get(hit);
		if (!tip || !meta || meta.edges.length === 0 || this.edgeInfoMode() === 'off') {
			this.hideTip();
			return;
		}
		const lines: string[] = [];
		for (const edge of meta.edges) {
			const from = this.nameOfPath(edge.fromPath);
			const to = this.nameOfPath(edge.toPath);
			const line = edge.label
				? t('storyTree.hover.edge', { from, to, label: edge.label })
				: t('storyTree.hover.edgeNoLabel', { from, to });
			if (!lines.includes(line)) lines.push(line);
		}
		tip.empty();
		for (const line of lines.slice(0, TIP_MAX_LINES)) tip.createDiv({ text: line });
		if (lines.length > TIP_MAX_LINES) {
			tip.createDiv({ cls: 'sg-st-edge-tip-more', text: t('storyTree.hover.more', { count: String(lines.length - TIP_MAX_LINES) }) });
		}
		tip.classList.add('is-visible');
		this.placeTip(e, wrap);
	}

	private placeTip(e: PointerEvent, wrap: HTMLElement): void {
		const tip = this.tipEl;
		if (!tip) return;
		const rect = wrap.getBoundingClientRect();
		const OFFSET = 14;
		let x = e.clientX - rect.left + OFFSET;
		let y = e.clientY - rect.top + OFFSET;
		// Keep it inside the window: flip to the other side of the pointer near an edge.
		if (x + tip.offsetWidth > rect.width) x = Math.max(0, e.clientX - rect.left - OFFSET - tip.offsetWidth);
		if (y + tip.offsetHeight > rect.height) y = Math.max(0, e.clientY - rect.top - OFFSET - tip.offsetHeight);
		tip.style.left = `${x}px`;
		tip.style.top = `${y}px`;
	}

	private hideTip(): void {
		this.tipEl?.classList.remove('is-visible');
	}

	// ── Viewport ──────────────────────────────────────────────────────────────

	private applyTransform(): void {
		this.svgViewport?.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.scale})`);
		// Zooming far out grows the names (see labelSize) — redraw only when the size steps.
		if (this.nodeGroup && this.labelSize() !== this.drawnLabelSize) {
			this.renderNodes();
			// The cards were rebuilt: put the fade back, and resize the words to match.
			this.applyHover(this.hoveredPath);
		}
	}

	/**
	 * Name size in tree units: the normal size at 100 %, and growing as the
	 * view zooms out so a name stays about 12 px on screen, up to a cap that
	 * still fits the card. Stepped by 2 so a pinch doesn't redraw every frame.
	 */
	private labelSize(): number {
		const base = this.isCardStyle() ? 12 : 11;
		const size = Math.min(LABEL_MAX, Math.max(base, 12 / this.scale));
		return size <= base ? base : Math.round(size / 2) * 2;
	}

	private applyZoom(newScale: number, anchorClient?: { x: number; y: number }): void {
		const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
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

	/**
	 * Zoom and center so the whole tree fills the window — never above 100 %,
	 * so a three-person tree isn't blown up. Returns false when the view has no
	 * size yet (hidden tab), so the caller can try again on the next render.
	 */
	private fitToView(svg: SVGSVGElement): boolean {
		if (this.positions.length === 0) return false;
		const rect = svg.getBoundingClientRect();
		if (!rect.width || !rect.height) return false;
		const xs = this.positions.map((p) => p.x + this.halfW());
		const ys = this.positions.map((p) => p.generation * this.rowH());
		const card = this.isCardStyle();
		// Room for the block frames around the cards and a family block's title above them.
		const padX = (card ? CARD_W / 2 : LAYOUT_DOT.nodeW / 2) + BLOCK_PAD;
		const padTop = (card ? CARD_H : NODE_R * 2) + BLOCK_PAD + 30;
		const padBottom = (card ? CARD_H : NODE_R * 2 + 28) + BLOCK_PAD; // dot labels sit under the dot
		const minX = Math.min(...xs) - padX, maxX = Math.max(...xs) + padX;
		const minY = Math.min(...ys) - padTop, maxY = Math.max(...ys) + padBottom;
		const MARGIN = 24;
		const fit = Math.min((rect.width - MARGIN * 2) / (maxX - minX), (rect.height - MARGIN * 2) / (maxY - minY));
		this.scale = Math.max(ZOOM_MIN, Math.min(1, fit));
		this.tx = rect.width / 2 - ((minX + maxX) / 2) * this.scale;
		this.ty = rect.height / 2 - ((minY + maxY) / 2) * this.scale;
		this.applyTransform();
		return true;
	}

	// ── Project change ────────────────────────────────────────────────────────

	/** The Dashboard picked another project: forget who the tree was centred on. Draws nothing — the next mount() does. */
	resetScope(): void {
		this.focusPath = '';
		this.bloodlinePath = '';
		this.factionPath = '';
		this.needsFit = true;
	}
}

// ─── Legacy view shim ───────────────────────────────────────────────────────
// Saved workspaces may still reference this leaf type. Rather than duplicate
// rendering logic, it silently redirects into the merged Social Maps view and
// detaches itself.

export class StorygridStoryTreeView extends ItemView {
	plugin: StorygridPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_STORY_TREE; }
	getDisplayText(): string { return 'Story Tree'; }
	getIcon(): string { return 'list-tree'; }

	async setState(state: Record<string, unknown>): Promise<void> {
		// An old saved layout's project is stale: Social Maps follows the Dashboard's project.
		setTimeout(() => {
			void this.plugin.openSocialMaps('tree');
			this.leaf.detach();
		}, 0);
	}
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * SVG path for an axis-aligned polyline with rounded corners: straight
 * segments joined by small quadratic bends at each interior point.
 */
function roundedOrthoPath(pts: Array<[number, number]>, r: number): string {
	let d = `M${pts[0][0]},${pts[0][1]}`;
	for (let i = 1; i < pts.length - 1; i++) {
		const [px, py] = pts[i - 1];
		const [cx, cy] = pts[i];
		const [nx, ny] = pts[i + 1];
		const inLen = Math.abs(cx - px) + Math.abs(cy - py);
		const outLen = Math.abs(nx - cx) + Math.abs(ny - cy);
		const rr = Math.min(r, inLen / 2, outLen / 2);
		if (rr < 0.5) {
			d += ` L${cx},${cy}`;
			continue;
		}
		const ux = Math.sign(cx - px), uy = Math.sign(cy - py);
		const vx = Math.sign(nx - cx), vy = Math.sign(ny - cy);
		d += ` L${cx - ux * rr},${cy - uy * rr} Q${cx},${cy} ${cx + vx * rr},${cy + vy * rr}`;
	}
	const [lx, ly] = pts[pts.length - 1];
	d += ` L${lx},${ly}`;
	return d;
}

/**
 * A Phosphor Bold icon from the registry as an SVG element at (x, y), `size`
 * across. The tree is one SVG, so it can't use `setPhosphorIcon` (HTML only).
 */
function phosphorSvg(name: string, x: number, y: number, size: number, cls: string): SVGSVGElement {
	const svg = makeSvg('svg', {
		x: String(x), y: String(y), width: String(size), height: String(size), viewBox: '0 0 256 256', class: cls,
	}) as SVGSVGElement;
	for (const m of (PHOSPHOR_ICONS[name] ?? '').matchAll(/ d="([^"]+)"/g)) svg.appendChild(makeSvg('path', { d: m[1] }));
	return svg;
}
