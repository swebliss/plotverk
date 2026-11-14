import { App, EventRef, MarkdownView, Menu, Notice, Platform, TFile } from 'obsidian';
import type StorygridPlugin from '../main';
import { TimelineData, TimelineRange, Plotline, LineStyle, StoryDate, createPlotline, remapTimelinePath } from './timeline-data';
import { storyDateToAbsoluteDay, absoluteDayToStoryDate, serializeStoryDate, parseStoryDate, formatStoryDate } from './calendar';
import { addWikilink, parseWikilinks, removeWikilink, removeSceneLink, sceneLinkFor, setSceneLink } from './timeline-links';
import { classifyEntity, collectTimelineData, eventSummaryFromFrontmatter, isTimelineEmpty, storyPresent, storyPresentDay, TimelineEvent, UndatedTimelineEvent } from './timeline-events';
import { makeSvg, pointerDist, isTap, truncate, computeTimelineFit } from '../utils/graph-shared';
import { clampTicksToLine, growRangeToFit, lineEnds, LineEnds, rangeFromYears, rangeNotice, rangeZoomFloor, resolveRange, ResolvedRange, RangeItem, absoluteYearOfDay, validateRangeInput, yearAsStoryDate, RANGE_YEAR_LIMIT } from './timeline-range';
import {
	DEFAULT_LAYOUT_SPEC,
	LayoutEvent,
	LayoutPoint,
	LayoutRect,
	TimelineLayoutSpec,
	axisPoint,
	axisRectFromSegment,
	computeSpineTicks,
	computeTimelineLayout,
	computeColumnLayout,
	nearestTrackIndex,
	LabelPlacement,
	MIN_LABEL_SCREEN_PX,
	crowdedLabelIds,
	labelBox,
	badgeRadiusFor,
	badgeRingWidthFor,
	badgeHaloFor,
	barThicknessFor,
	ongoingArrowSize,
	TIMELINE_MIN_ZOOM,
	TIMELINE_MAX_ZOOM,
	timelineWheelAction,
	canFitViewport,
} from './timeline-layout';
import {
	APPEARANCE_LIMITS,
	TimelineAppearance,
	TimelineAxisUnit,
	TimelineLabelDirection,
	TimelineLabelMode,
	clampKnob,
	fanSpacingFor,
	resolveAppearance,
} from './timeline-appearance';
import { dashArrayFor, needsRoundCap } from '../utils/edge-style';
import { SvgGradientDefs, solidFromColor } from '../utils/svg-gradient';
import { getContrastColor } from '../utils/color-contrast';
import { ColorPickerPopover } from '../ui/color-picker-popover';
import { createEntityFile } from '../entities/entity-manager';
import { ERA_SHEET, EVENT_HOW_LONG, getKindSpec } from '../entities/entity-kinds';
import { parseBody, renderBody, applyFields } from '../entities/entity-body';
import { splitFrontmatter, parseEntityDocument } from '../entities/entity-parse';
import { renameEntitySheet } from '../entities/sheet-rename';
import { slugForLabel, toYamlValue } from '../entities/field-types';
import { EntityPickerModal } from '../modals/entity-picker-modal';
import { markdownToHtml, htmlToMarkdown } from '../utils/rich-text';
import { setRichText } from '../utils/dom-html';
import { buildPanelRichToolbar } from '../ui/rich-toolbar';
import { generateId } from '../grid-data';
import type { CharacterField } from '../grid-data';
import { openOrReveal } from '../utils/workspace';
import { setPhosphorIcon } from '../utils/icons';
import { ERA_LABEL_LINE, ERA_LABEL_PAD, EraBand, defaultEraColor, eraBandRect, eraEndDay, isEraHowLong, layoutEraBands, placeEraLabels } from './timeline-eras';
import { EVENT_ICONS, EventIconEntry, fallbackEventIcon, phosphorIconValue, resolveEventIcon } from '../utils/event-icons';
import { EntityModal } from '../modals/entity-modal';
import { t } from '../i18n';
import { reportError, runSafely } from '../utils/report-error';

/** An event target as a Node, or null (focus/pointer targets may also be a Window). */
function asNode(target: EventTarget | null): Node | null {
	return target && 'nodeType' in target ? (target as Node) : null;
}

/**
 * Renders the plotline-lane timeline into a host element supplied by the
 * caller (`TimelineView`). Not an `ItemView` itself, mirroring
 * `RelGraphController` — the file-load/save lifecycle lives one level up.
 */

export interface TimelineControllerHost {
	getData: () => TimelineData;
	/** Immutable update — the caller schedules its own debounced save. */
	mutate: (updater: (data: TimelineData) => TimelineData) => void;
	getProjectRoot: () => string;
}

// All world-space geometry comes from the pure layout engine
// (timeline-layout.ts) — this file is the painter. The engine's world px
// scale together with the viewport transform, exactly like
// RelGraphController's node radius.
const BASE_PX_PER_DAY = DEFAULT_LAYOUT_SPEC.pxPerDay;
/** Zoom bounds shared by manual pinch/wheel zoom (applyZoom) and the zoom-to-fit camera (centerOnEvents/panToDay) — one source of truth, in timeline-layout.ts. */
const MIN_ZOOM = TIMELINE_MIN_ZOOM;
const MAX_ZOOM = TIMELINE_MAX_ZOOM;
/**
 * Plotline lanes on the canvas — OFF for now: the events alone carry the
 * timeline. With it off, events pack into compact columns beside the main line
 * (computeColumnLayout), and the Plotlines button, the plotline row in the key,
 * the plotline slider/spacing controls and the add-event Plotline choice are
 * hidden. Plotline DATA (plotlines, eventDisplay.plotlineId) is never touched,
 * and an event without its own colour still takes its plotline's — flip this
 * back to true to bring lanes back exactly as they were.
 */
const SHOW_PLOTLINE_LANES = false;

/**
 * The last "Years shown" notice, shared by every open timeline: two windows
 * (or a save → reload) growing the same range at the same moment would
 * otherwise each say it — the same words within a few seconds show once.
 */
let lastRangeNotice = { text: '', at: 0 };
function showRangeNotice(text: string): void {
	const now = Date.now();
	if (text === lastRangeNotice.text && now - lastRangeNotice.at < 10000) return;
	lastRangeNotice = { text, at: now };
	new Notice(text, 10000);
}

/** Max event-name characters shown on a node label, matching rel-graph's convention. */
const NODE_LABEL_MAX = 26;

// ── Badges ───────────────────────────────────────────────────────────────────
// Every event is a round badge: a disc in the event's colour, a light ring,
// and its Phosphor icon centred in a contrasting colour. All sizes below are
// on-screen px — the badge group is counter-scaled against the camera (see
// applyTransform / K_TRANSFORM), so zoom moves badges apart without ever
// shrinking or stretching them.
/** Glyph side as a fraction of the badge radius: a clear picture with breathing room inside the disc. */
const BADGE_GLYPH_FRACTION = 1.15;
// The ring width and the theme-background cut-out around it (so lines passing
// under a badge stop cleanly at its edge) scale with the badge — see
// badgeRingWidthFor / badgeHaloFor in timeline-layout.ts.
/** Smallest touch target radius on phones (44pt Apple / 48dp Android ≈ 22–24px radius). */
const TOUCH_HIT_RADIUS = 24;

/** An era band's fill/edge opacity, strengthened on a dark page by --sg-tl-era-strength (styles.css, .theme-dark). */
function eraOpacity(base: number): string {
	return `calc(${Math.min(1, base).toFixed(4)} * var(--sg-tl-era-strength, 1))`;
}

/**
 * Build one glyph <svg> from a registry entry's raw path data, sized and
 * positioned by the caller (marker vs bar placement differs — see the two
 * call sites in renderLanesAndNodes). `pointer-events: none` is load-bearing:
 * without it a click landing on the glyph's own painted pixels would not
 * bubble to the sg-tl-node <g> the same way a click on the dot's bare fill
 * does, and `closest('.sg-tl-node')` in the tap-resolution code would still
 * find the group either way — but leaving pointer-events at its default
 * would make the glyph capable of becoming e.target for hover/press logic
 * that assumes the target IS the node, which is more fragile than never
 * letting the glyph intercept anything in the first place.
 */
function makeIconGlyph(icon: EventIconEntry, x: number, y: number, size: number, glyphColor: string): SVGSVGElement {
	const svg = makeSvg('svg', {
		class: 'sg-tl-node-icon',
		x: String(x), y: String(y),
		width: String(size), height: String(size),
		viewBox: '0 0 256 256',
	}) as SVGSVGElement;
	// The glyph sits on a fill the WRITER chose, where a fixed light color
	// disappears the moment that fill is a pastel — so the caller passes
	// glyphColorOn()'s dark-or-light pick (the same rule that keeps grid card
	// titles readable on any card color). Inline, so it beats any stylesheet.
	svg.style.color = glyphColor;
	svg.appendChild(makeSvg('path', { d: icon.path, fill: 'currentColor' }));
	return svg;
}

/** Radius of the colored dot a stitch pins onto the spine (from the approved mock). */
const STITCH_DOT_R = 2.6;

/**
 * The counter-scale for anything that must keep its on-screen size: the
 * camera stretches only the time axis by `scale`, so this squeezes that one
 * axis back by `--sg-tl-k` (= 1/scale, set on the <svg> in applyTransform).
 * Written as an INLINE style on each element at paint time — only the
 * custom property changes per zoom frame, so a pinch costs one style write,
 * not a DOM rebuild, and nothing depends on the stylesheet having reloaded.
 * Origin is the element's own (0,0), which every caller puts at the badge
 * or label anchor via a parent translate.
 */
function counterScale(horizontal: boolean): string {
	return horizontal ? 'scale(var(--sg-tl-k, 1), 1)' : 'scale(1, var(--sg-tl-k, 1))';
}

/** A colour as #rrggbb when it can be read: 3/4/8-digit hex and rgb()/rgba() are normalised; anything else answers null. */
function toHex6(color: string): string | null {
	const c = color.trim();
	let m = /^#([0-9a-f]{3,4})$/i.exec(c);
	if (m) return '#' + m[1].slice(0, 3).split('').map((ch) => ch + ch).join('');
	m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(c);
	if (m) return '#' + m[1];
	m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(c);
	if (m) return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, Math.round(Number(n))).toString(16).padStart(2, '0')).join('');
	return null;
}

/**
 * Dark-or-light glyph colour on an event's own fill. `resolve` turns a theme
 * variable into the colour it currently stands for, so a badge painted with
 * e.g. var(--color-yellow) still gets a readable icon. A colour that cannot
 * be read at all (hsl(), a named colour) gets the theme background, which
 * contrasts with Obsidian's own muted/accent tones.
 */
function glyphColorOn(color: string, resolve: (c: string) => string): string {
	const hex = toHex6(resolve(solidFromColor(color)));
	return hex ? getContrastColor(hex) : 'var(--background-primary)';
}

/** Always-present pseudo-lane for events with no plotline assignment yet — keeps Codex-created events visible with no manual double-feeding. */
const UNSORTED_PLOTLINE: Plotline = { id: '', name: 'Unsorted', color: 'var(--text-muted)', lineStyle: 'dotted' };

export class TimelineController {
	private app: App;

	private events: TimelineEvent[] = [];
	private undatedEvents: UndatedTimelineEvent[] = [];
	/** Dated eras (kind 'era'): soft bands behind everything — never in `events`, so they never become badges, bars or columns. */
	private eras: TimelineEvent[] = [];
	private orientation: 'horizontal' | 'vertical' = 'vertical';

	// Viewport transform. `scale` stretches ONLY the time axis:
	// across-axis px are always screen px, so lane spacing and every size stay
	// put while zoom changes the distance between dates.
	private tx = 0;
	private ty = 0;
	private scale = 1;

	private wrapEl: HTMLElement | null = null;
	private svgEl: SVGSVGElement | null = null;
	private svgViewport: SVGGElement | null = null;
	/** The era bands and their names — inside the camera's group, under the main line and every event. */
	private eraGroup: SVGGElement | null = null;
	/** Each painted era's name and the band it belongs to (world px along time), so pans can keep the name in view without a repaint — see positionEraLabels. */
	private eraLabels: Array<{ id: string; el: SVGGElement; startPx: number; endPx: number; slot: number; length: number }> = [];
	/** The era whose band the mouse rests on — its card waits a moment (eraHoverTimer) so sweeping across the background doesn't flash cards. */
	private hoveredEraId: string | null = null;
	private eraHoverTimer: number | null = null;
	/** The press began on an era's name (not just its band): a mouse click there opens the sheet; on the bare band it acts like the background. */
	private tapOnEraLabel = false;
	/** The key's "Era" row — hidden while the timeline has none. */
	private eraKeyRow: HTMLElement | null = null;
	private laneGroup: SVGGElement | null = null;
	private nodeGroup: SVGGElement | null = null;
	private axisGroup: SVGGElement | null = null;
	/** Unscaled overlay holding plotline names pinned to the view's edge once a thread's own name has scrolled away. */
	private pinGroup: SVGGElement | null = null;
	/** Screen-independent thread spans from the last layout, so the pinned names can follow pans without re-running the layout. */
	private pinnedTracks: Array<{ trackId: string; name: string; color: string; across: number; startAlong: number; endAlong: number }> = [];
	private defsEl: SVGDefsElement | null = null;
	/** The spine's own <rect> — kept so the color picker can read its live computed `fill` as the "current color" swatch when no override is set, rather than duplicating styles.css's color as a second hardcoded default. */
	private spineEl: SVGRectElement | null = null;
	/**
	 * SVG cannot fill a shape with a CSS gradient string — it needs a real
	 * `<linearGradient>` in `<defs>` and `fill: url(#id)`, or the shape paints
	 * black. This owns those defs for the timeline's own gradients.
	 */
	private readonly gradients = new SvgGradientDefs();
	// Plotline manager panel. Docks in the same right-side slot as the
	// Appearance panel — the two are mutually exclusive (opening one closes
	// the other), see toggleAppearancePanel/togglePlotlinePanel. Its own
	// document keydown/click listeners mirror the event editor's and
	// appearance panel's own Escape/outside-click guards — see
	// closePlotlinePanel().
	private plotlinePanelEl: HTMLElement | null = null;
	private plotlineKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
	private plotlineOutsideClickHandler: ((e: MouseEvent) => void) | null = null;
	// Appearance panel. Docks in the same right-side slot as the
	// plotline panel and is mutually exclusive with it (opening one closes
	// the other) so the two never literally overlap — see toggleAppearancePanel/
	// togglePlotlinePanel. Its own document keydown listener mirrors the event
	// editor's Escape handling (closeAppearancePanel), which is why it needs
	// an explicit close helper rather than a bare `.remove()` — same reason
	// the plotline panel has its own closePlotlinePanel().
	private appearancePanelEl: HTMLElement | null = null;
	private appearanceKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
	/** Puts the saved "Years shown" back into the open Appearance panel's boxes after the range grew by itself. */
	private syncRangeControls: (() => void) | null = null;
	/** Coalesces the many `input` events one slider drag fires into one repaint per frame (see scheduleAppearanceRepaint). */
	private appearanceRenderScheduled = false;
	private emptyStateEl: HTMLElement | null = null;
	private shelfEl: HTMLElement | null = null;

	// Pan/pinch state
	private panning = false;
	private panClientStart = { x: 0, y: 0 };
	private panTxStart = 0;
	private panTyStart = 0;
	// `panPointerId`/`pinchPointerIds` name the exact pointers that own the
	// current gesture. A 3rd+ touch still lands in `activePointers` for
	// bookkeeping but drives nothing: keying off `activePointers.size` instead
	// let a 3rd finger fall into the pan arm (jumping the view by a
	// cross-finger delta) and snap-zoom on the way back down to two, because
	// `pinchStartDist` had been measured between a different pair of fingers.
	// Same pattern as StorygridTreeView and RelGraphController.
	private activePointers = new Map<number, { x: number; y: number }>();
	private isPinching = false;
	private pinchStartDist = 0;
	private pinchStartScale = 1;
	private panPointerId: number | null = null;
	private pinchPointerIds: [number, number] | null = null;
	private pointerDownWasDrag = false;

	// Tap state. The svg calls setPointerCapture() on every pointerdown (for
	// pan/pinch), which retargets the synthesized 'click'/'dblclick' to the
	// <svg> — so a 'click' listener on an event dot never fires, and
	// `e.target.closest('.sg-tl-node')` guards on the svg's own click/dblclick
	// always miss. Same trap as rel-graph-view.ts bindNodeEvents: taps are
	// detected from the pointerdown/up pair instead. The pointerdown itself
	// still targets the real element (capture only retargets what follows),
	// so that's where the pressed dot's id is remembered. An id, not the
	// event object — it's resolved against this.events at pointerup, so a
	// refresh() landing mid-press can't hand the tap action a stale event.
	// Rewritten by every accepted pointerdown and deliberately NOT cleared at
	// pointerup: the svg's dblclick guard reads it after the second tap.
	private tapCandidateId: string | null = null;

	private renderScheduled = false;
	private cullTimer: number | null = null;
	/** Waits for event edits to settle before "Years shown" may grow — see refresh(). */
	private rangeCheckTimer: number | null = null;
	/** A growth put off because the writer is still in that event's sheet — retried when they leave it. */
	private rangeDeferred = false;
	private leafChangeRef: EventRef | null = null;
	/** A fit to the events is still owed: it was asked for while the view had no size (a tab not on screen yet). See canFitViewport. */
	private fitPending = false;
	/** Watches the svg wrapper: pays the owed fit once the view gets a real size, and re-culls on later resizes. */
	private resizeObserver: ResizeObserver | null = null;

	private hoveredId: string | null = null;
	private activeEventId: string | null = null;
	/** notePath of the selected Undated-shelf chip — mutually exclusive with activeEventId. */
	private activeUndatedPath: string | null = null;
	private closeAddPopover: (() => void) | null = null;
	/** The hover/tap event card (showEventCard) — an HTML sibling of the svg, so repaints never touch it. */
	private cardEl: HTMLElement | null = null;
	/** True for the phone's tapped card (stays until dismissed); false for a mouse hover card. */
	private cardPinned = false;
	/** Which event the card shows — a repaint re-anchors a tapped card to it, or closes the card if the event is gone. */
	private cardEventId: string | null = null;
	/**
	 * The date guide, so a hovered event shows exactly which date it sits on:
	 * while the card is open, a line from the event to the main line, a dot
	 * on it and the exact date beside it. Lines sit under the badges, the date
	 * tags above them; both live in the camera's group, so they pan and zoom
	 * with the events and never cause a relayout. Drawn by showEventCard,
	 * removed by hideEventCard — it can never outlive the card.
	 */
	private guideLineGroup: SVGGElement | null = null;
	/** The axis's tick elements by tick (orientation|kind|day|label), so a settle refresh only adds and removes — see renderAxisTicks. */
	private axisTickEls = new Map<string, SVGGElement>();
	private guideTagGroup: SVGGElement | null = null;
	/** Where each painted event sits in world px (start, and end for a bar) and its colour — refreshed every repaint, read by the guide. */
	private guideAnchors = new Map<string, { start: LayoutPoint; end?: LayoutPoint; color: string }>();

	// Event editor panel (A5). The panel element is a sibling of the svg wrap
	// inside .sg-tl-root — renderLanesAndNodes()/renderShelf() never touch it,
	// so the refresh() a field commit triggers repaints the dots underneath
	// without destroying the panel or any in-progress edit.
	private editorEl: HTMLElement | null = null;
	private editorFile: TFile | null = null;
	private editorKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
	/** Commits every dirty blur-committed field (title, synopsis) — called on close/swap/unmount. */
	private editorFlush: (() => void) | null = null;

	constructor(
		private plugin: StorygridPlugin,
		private host: HTMLElement,
		private ctrlHost: TimelineControllerHost,
	) {
		this.app = plugin.app;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	mount(): void {
		const data = this.ctrlHost.getData();
		this.orientation = data.viewSettings.orientation ?? 'vertical';
		const { dated, undated, eras } = collectTimelineData(this.app, this.ctrlHost.getProjectRoot(), data.calendar);
		this.events = dated;
		this.undatedEvents = undated;
		this.eras = eras;
		this.checkShownRange();
		// Leaving a sheet still being edited lets a growth put off for it happen.
		this.leafChangeRef = this.app.workspace.on('active-leaf-change', () => {
			if (this.rangeDeferred) this.scheduleRangeCheck();
		});
		this.buildSkeleton();
		this.fitPending = true;
		window.requestAnimationFrame(() => this.centerOnEvents());
	}

	unmount(): void {
		if (this.cullTimer) { window.clearTimeout(this.cullTimer); this.cullTimer = null; }
		if (this.rangeCheckTimer) { window.clearTimeout(this.rangeCheckTimer); this.rangeCheckTimer = null; }
		if (this.eraHoverTimer) { window.clearTimeout(this.eraHoverTimer); this.eraHoverTimer = null; }
		if (this.leafChangeRef) { this.app.workspace.offref(this.leafChangeRef); this.leafChangeRef = null; }
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.closeEventEditor(true, { instant: true });
		this.closeAppearancePanel();
		this.closePlotlinePanel();
		this.activeEventId = null;
		this.activeUndatedPath = null;
		this.closeAddPopover?.();
		this.hideEventCard();
		this.host.empty();
		this.wrapEl = null;
		this.svgEl = null;
		this.svgViewport = null;
		this.eraGroup = null;
		this.eraLabels = [];
		this.laneGroup = null;
		this.nodeGroup = null;
		this.guideLineGroup = null;
		this.guideTagGroup = null;
		this.axisGroup = null;
		this.defsEl = null;
		this.emptyStateEl = null;
		this.shelfEl = null;
	}

	/** Called by the host on vault/metadataCache changes touching this project. */
	refresh(): void {
		const { dated, undated, eras } = collectTimelineData(this.app, this.ctrlHost.getProjectRoot(), this.data().calendar);
		// The first events arriving (Obsidian's file index was still loading when
		// the view opened) deserve the same fit an opening view gets.
		const firstEvents = this.events.length === 0 && this.eras.length === 0 && dated.length + eras.length > 0;
		this.events = dated;
		this.undatedEvents = undated;
		this.eras = eras;
		this.syncEraKeyRow();
		if (firstEvents) {
			// Opening with the file index still loading: same check an opening view gets.
			this.checkShownRange();
			this.centerOnEvents();
		} else {
			this.renderLanesAndNodes();
			this.scheduleRangeCheck();
		}
	}

	/**
	 * Growing "Years shown" after an event change waits until the writer is
	 * done: never while an outside event's sheet is the note being edited
	 * (a date typed by hand saves on the way: 1 → 11 → 1188, and the range
	 * never shrinks by itself, so "year 1" would stick) — it runs when they
	 * leave that sheet — and at least 4s after the last change otherwise.
	 */
	private scheduleRangeCheck(): void {
		if (this.rangeCheckTimer) window.clearTimeout(this.rangeCheckTimer);
		this.rangeCheckTimer = window.setTimeout(() => {
			this.rangeCheckTimer = null;
			if (!this.checkShownRange({ waitWhileEditing: true })) return;
			// The main line got longer — redraw it, its caps and year labels.
			this.renderLanesAndNodes();
			this.renderAxisTicks();
		}, 4000);
	}

	/**
	 * Chosen years only ever grow: an event whose start or end (an ongoing
	 * bar ends at the story's present) falls outside them stretches the saved
	 * range just enough, with ONE plain notice. Runs whenever events are
	 * (re)read and when the writer sets the years; never on Automatic.
	 * growRangeToFit answers null once everything fits, so the save, the
	 * reload it can cause, or a second window growing at the same time all
	 * settle on the same (bigger) range instead of looping. True if it grew.
	 */
	private checkShownRange(opts: { waitWhileEditing?: boolean } = {}): boolean {
		this.rangeDeferred = false;
		const data = this.data();
		const range = resolveRange(data.calendar, data.viewSettings.range);
		if (!range || (this.events.length === 0 && this.eras.length === 0)) return false;
		const growth = growRangeToFit(data.calendar, range, this.rangeItems());
		if (!growth) return false;
		if (opts.waitWhileEditing) {
			const editing = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
			if (editing && growth.outside.some((o) => o.key === editing)) {
				this.rangeDeferred = true;
				return false;
			}
		}
		this.ctrlHost.mutate((d) => ({ ...d, viewSettings: { ...d.viewSettings, range: growth.range } }));
		const notice = rangeNotice(data.calendar, growth);
		showRangeNotice(t(notice.key, notice.vars));
		this.syncRangeControls?.();
		return true;
	}

	getState(): Record<string, unknown> {
		return { orientation: this.orientation };
	}

	setState(state: Record<string, unknown>): void {
		if (state.orientation === 'horizontal' || state.orientation === 'vertical') this.orientation = state.orientation;
	}

	// ── Data helpers ──────────────────────────────────────────────────────────

	private data(): TimelineData {
		return this.ctrlHost.getData();
	}

	private resolvePlotline(notePath: string): Plotline {
		const pid = this.data().eventDisplay[notePath]?.plotlineId;
		const found = pid ? this.data().plotlines.find((p) => p.id === pid) : undefined;
		return found ?? UNSORTED_PLOTLINE;
	}

	private laneList(): Plotline[] {
		return [UNSORTED_PLOTLINE, ...this.data().plotlines];
	}

	private absoluteDay(evt: TimelineEvent): number {
		return storyDateToAbsoluteDay(this.data().calendar, evt.date);
	}

	// ── Skeleton ──────────────────────────────────────────────────────────────

	private buildSkeleton(): void {
		// host.empty() below would drop the editor/appearance/plotline panels'
		// DOM without removing their document keydown (and, for the plotline
		// panel, outside-click) listeners — and, for the editor, without
		// flushing pending edits — close them properly first.
		this.closeEventEditor(true, { instant: true });
		this.closeAppearancePanel();
		this.closePlotlinePanel();
		this.hideEventCard();
		this.host.empty();
		// The old <svg> and its pointer listeners just went away — a pointer
		// still down at that moment (orientation toggle mid-touch) can never
		// finish its gesture, and a stale activePointers entry would shunt
		// every later first finger into the pinch branch. Reset gesture state.
		this.activePointers.clear();
		this.tapCandidateId = null;
		this.hoveredEraId = null;
		if (this.eraHoverTimer) { window.clearTimeout(this.eraHoverTimer); this.eraHoverTimer = null; }
		this.panning = false;
		this.isPinching = false;
		this.pointerDownWasDrag = false;
		this.plotlinePanelEl = null;
		this.appearancePanelEl = null;
		this.emptyStateEl = null;
		this.shelfEl = null;
		this.closeAddPopover?.();
		const root = this.host.createDiv({ cls: 'sg-tl-root' });
		this.renderToolbar(root);

		const svgWrap = root.createDiv({ cls: 'sg-tl-svg-wrap' });
		this.wrapEl = svgWrap;
		const svg = makeSvg('svg', { class: 'sg-tl-svg' }) as SVGSVGElement;
		svgWrap.appendChild(svg);
		this.svgEl = svg;

		const defs = makeSvg('defs') as SVGDefsElement;
		svg.appendChild(defs);
		this.defsEl = defs;

		const vp = makeSvg('g', { class: 'sg-tl-viewport' }) as SVGGElement;
		svg.appendChild(vp);
		this.svgViewport = vp;

		// Eras first: soft bands behind the main line and every event.
		this.eraGroup = makeSvg('g', { class: 'sg-tl-eras' }) as SVGGElement;
		vp.appendChild(this.eraGroup);
		this.laneGroup = makeSvg('g', { class: 'sg-tl-lanes' }) as SVGGElement;
		vp.appendChild(this.laneGroup);
		this.guideLineGroup = makeSvg('g', { class: 'sg-tl-guide' }) as SVGGElement;
		vp.appendChild(this.guideLineGroup);
		this.nodeGroup = makeSvg('g', { class: 'sg-tl-nodes' }) as SVGGElement;
		vp.appendChild(this.nodeGroup);
		// Axis ticks ride INSIDE the camera's group (world positions, counter-
		// scaled sizes — see renderAxisTicks), above the events, so the dates
		// stay attached to the main line on every frame of a drag or pinch.
		this.axisGroup = makeSvg('g', { class: 'sg-tl-axis' }) as SVGGElement;
		vp.appendChild(this.axisGroup);
		this.axisTickEls.clear();
		this.guideTagGroup = makeSvg('g', { class: 'sg-tl-guide' }) as SVGGElement;
		vp.appendChild(this.guideTagGroup);
		this.pinGroup = makeSvg('g', { class: 'sg-tl-pins' }) as SVGGElement;
		svg.appendChild(this.pinGroup);

		this.renderKey(root);

		this.bindSvgEvents(svg, svgWrap);
		this.resizeObserver?.disconnect();
		this.resizeObserver = new ResizeObserver(() => {
			const rect = svgWrap.getBoundingClientRect();
			if (!canFitViewport(rect.width, rect.height)) return;
			if (this.fitPending) this.centerOnEvents();
			else this.scheduleCullRefresh();
		});
		this.resizeObserver.observe(svgWrap);
		this.applyTransform();
		this.renderAxisTicks();
		this.renderLanesAndNodes();
	}

	private renderToolbar(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: 'sg-tl-toolbar' });

		const orientBtn = bar.createEl('button', { cls: 'sg-tl-btn', title: t('timeline.toolbar.orientation') });
		setPhosphorIcon(orientBtn, this.orientation === 'horizontal' ? 'rows' : 'columns', this.orientation === 'horizontal' ? '≡' : '⫴');
		orientBtn.addEventListener('click', () => this.toggleOrientation());

		const zoomOut = bar.createEl('button', { cls: 'sg-tl-btn', title: 'Zoom out' });
		setPhosphorIcon(zoomOut, 'minus', '−');
		zoomOut.addEventListener('click', () => this.applyZoom(this.scale * 0.8));

		const zoomIn = bar.createEl('button', { cls: 'sg-tl-btn', title: 'Zoom in' });
		setPhosphorIcon(zoomIn, 'plus', '+');
		zoomIn.addEventListener('click', () => this.applyZoom(this.scale * 1.25));

		const fitBtn = bar.createEl('button', { cls: 'sg-tl-btn', title: t('timeline.toolbar.fit') });
		setPhosphorIcon(fitBtn, 'corners-out', '⤢');
		fitBtn.addEventListener('click', () => this.centerOnEvents());

		bar.createDiv({ cls: 'sg-tl-toolbar-spacer' });

		if (SHOW_PLOTLINE_LANES) {
			const plotlinesBtn = bar.createEl('button', { cls: 'sg-tl-btn sg-tl-btn-labeled' });
			setPhosphorIcon(plotlinesBtn.createSpan(), 'list', '☰');
			plotlinesBtn.createSpan({ text: t('timeline.toolbar.plotlines') });
			plotlinesBtn.addEventListener('click', () => this.togglePlotlinePanel());
		}

		const appearanceBtn = bar.createEl('button', { cls: 'sg-tl-btn sg-tl-btn-labeled' });
		setPhosphorIcon(appearanceBtn.createSpan(), 'sliders-horizontal', '≡');
		appearanceBtn.createSpan({ text: t('timeline.toolbar.appearance') });
		appearanceBtn.addEventListener('click', () => this.toggleAppearancePanel());

		// An era (an Event sheet with How Long = "An era") — a soft band behind its years.
		const eraBtn = bar.createEl('button', { cls: 'sg-tl-btn sg-tl-btn-primary sg-tl-btn-labeled sg-tl-btn-era' });
		setPhosphorIcon(eraBtn.createSpan(), ERA_SHEET.icon, ERA_SHEET.fallbackIcon);
		eraBtn.createSpan({ text: t('timeline.toolbar.addEra') });
		eraBtn.addEventListener('click', () => this.openAddEventSheet({ era: true }));

		const addBtn = bar.createEl('button', { cls: 'sg-tl-btn sg-tl-btn-primary sg-tl-btn-labeled' });
		setPhosphorIcon(addBtn.createSpan(), 'plus', '+');
		addBtn.createSpan({ text: t('timeline.toolbar.addEvent') });
		addBtn.addEventListener('click', () => this.openAddEventSheet());
	}

	private toggleOrientation(): void {
		this.orientation = this.orientation === 'horizontal' ? 'vertical' : 'horizontal';
		this.ctrlHost.mutate((d) => ({ ...d, viewSettings: { ...d.viewSettings, orientation: this.orientation } }));
		this.buildSkeleton();
		window.requestAnimationFrame(() => this.centerOnEvents());
	}

	// ── Layout (all geometry from timeline-layout.ts) ──────────────────────────

	/**
	 * The resolved appearance for this timeline: its own `viewSettings.appearance`
	 * over the plugin-global defaults over the shipped defaults. Cheap enough to
	 * call per paint (a merge of eight fields), and always re-read rather than
	 * cached so a settings change lands on the next repaint with no invalidation
	 * bookkeeping.
	 */
	private appearance(): TimelineAppearance {
		return resolveAppearance(this.data().viewSettings.appearance, this.plugin.settings.timelineAppearance);
	}

	/**
	 * This event's icon, if any: its own EventDisplay.icon wins, else its
	 * track's Plotline.icon, else none (see resolveEventIcon). A method rather
	 * than a render-time closure because renderLanesAndNodes needs the answer
	 * TWICE at different moments — once while building layout events (to grow
	 * an icon marker before anything is placed) and again while painting.
	 */
	private iconForPath(notePath: string): EventIconEntry | undefined {
		return resolveEventIcon(this.data().eventDisplay[notePath]?.icon, this.resolvePlotline(notePath).icon);
	}

	/** The geometry knobs for this render pass, from the resolved appearance model. */
	private layoutSpec(): TimelineLayoutSpec {
		const a = this.appearance();
		return {
			...DEFAULT_LAYOUT_SPEC,
			orientation: this.orientation,
			// Lanes never closer than two default badges side by side: a
			// spacing saved back when events were 10px dots (or the slider's
			// low end) would otherwise put neighbouring plotlines' badges on
			// top of each other.
			spacing: Math.max(a.spacing, 2 * badgeRadiusFor(a.markerSize) + 8),
			barThickness: barThicknessFor(a.barThickness),
			markerRadius: badgeRadiusFor(a.markerSize),
			fanSpacing: fanSpacingFor(badgeRadiusFor(a.markerSize)),
			stitches: a.stitches,
			alongScale: this.scale,
			// Clear of the year labels on the main line: a vertical view's label is
			// ~72px wide across the line, a horizontal one ~20px tall.
			columnInset: Math.max(a.spineWidth / 2, this.orientation === 'horizontal' ? 20 : 40) + 4,
		};
	}

	/**
	 * SVG attrs for one event label. Shared by the bar and marker painters so
	 * the two can never drift apart.
	 *
	 * `readable` (default) keeps text upright in both orientations: centered
	 * above/below the dot in horizontal view, growing sideways away from the
	 * spine in vertical view. `along-axis` only differs in VERTICAL view (the
	 * time axis is already horizontal in horizontal view) — there it rotates
	 * the text a quarter turn so it runs downward with time, which trades
	 * across-axis clutter for along-axis length.
	 *
	 * The `is-below` class (dominant-baseline: hanging) is what decides which
	 * side of the baseline the glyphs sit on. Under the rotation, local +y maps
	 * to world -x, so it flips meaning: side -1 (left of the spine) is the case
	 * that needs it, the mirror of the unrotated horizontal case.
	 */
	private labelAttrs(x: number, y: number, side: -1 | 1, appearance: TimelineAppearance): Record<string, string> {
		const horizontal = this.orientation === 'horizontal';
		if (!horizontal && appearance.labelDirection === 'along-axis') {
			return {
				class: 'sg-tl-ev-label' + (side === -1 ? ' is-below' : ''),
				'text-anchor': 'middle',
				x: String(x),
				y: String(y),
				transform: `rotate(90 ${x} ${y})`,
			};
		}
		return {
			class: 'sg-tl-ev-label' + (horizontal && side === 1 ? ' is-below' : ''),
			'text-anchor': horizontal ? 'middle' : (side === -1 ? 'end' : 'start'),
			// Vertical/readable labels sit beside the marker, so nudge the
			// baseline to optically center the text on it.
			y: String(horizontal ? y : y + 4),
			x: String(x),
		};
	}

	/**
	 * A plotline's name sits where its thread starts. Once that spot scrolls
	 * out of view the name is pinned to the view's edge instead (left edge in
	 * horizontal view, top edge in vertical), so every visible lane stays
	 * named. Screen-space, so it is always 11px; the world copy hides meanwhile.
	 */
	private renderPinnedTrackNames(): void {
		const group = this.pinGroup;
		if (!group || !this.wrapEl) return;
		group.empty();
		const horizontal = this.orientation === 'horizontal';
		const alongOffset = horizontal ? this.tx : this.ty;
		const acrossOffset = horizontal ? this.ty : this.tx;
		const acrossSize = horizontal ? this.wrapEl.clientHeight : this.wrapEl.clientWidth;
		const pinned: Array<{ id: string; box: LayoutRect }> = [];
		const texts = new Map<string, SVGElement>();
		for (const tr of this.pinnedTracks) {
			const start = tr.startAlong * this.scale + alongOffset;
			const end = tr.endAlong * this.scale + alongOffset;
			// Across-axis px are screen px (the camera only stretches time).
			const across = tr.across + acrossOffset;
			const width = tr.name.length * MIN_LABEL_SCREEN_PX * 0.6;
			// Still readable in place → leave it; thread gone from view → nothing to name.
			const ownNameVisible = horizontal ? start - width > 0 : start - 2 * MIN_LABEL_SCREEN_PX > 0;
			const onScreen = end > 40 && across > 0 && across < acrossSize;
			const world = this.laneGroup?.querySelector(`.sg-tl-track-name[data-track-id="${CSS.escape(tr.trackId)}"]`);
			world?.classList.toggle('is-pinned-away', !ownNameVisible && onScreen);
			if (ownNameVisible || !onScreen) continue;
			const anchor = horizontal ? { x: 8, y: across - 7 } : { x: across, y: 16 };
			const text = makeSvg('text', {
				class: 'sg-tl-pinned-name',
				'text-anchor': horizontal ? 'start' : 'middle',
				x: String(anchor.x), y: String(anchor.y),
			}) as SVGTextElement;
			text.style.fill = tr.color;
			text.textContent = tr.name;
			texts.set(tr.trackId, text);
			pinned.push({ id: tr.trackId, box: labelBox(anchor, tr.name, MIN_LABEL_SCREEN_PX, horizontal ? 'beside-right' : 'centered-above') });
		}
		const crowded = crowdedLabelIds(pinned, 4);
		for (const [id, text] of texts) if (!crowded.has(id)) group.appendChild(text);
	}

	/** Plain-text key under the timeline: what the spine, a plotline, a dot and a stitch mean. No frame, on purpose. */
	private syncEraKeyRow(): void {
		if (this.eraKeyRow) this.eraKeyRow.style.display = this.eras.length > 0 ? '' : 'none';
	}

	private renderKey(root: HTMLElement): void {
		const key = root.createDiv({ cls: 'sg-tl-key' });
		const item = (glyph: (svg: SVGSVGElement) => void, label: string): HTMLElement => {
			const row = key.createSpan({ cls: 'sg-tl-key-item' });
			const svg = makeSvg('svg', { class: 'sg-tl-key-glyph', viewBox: '0 0 20 10', width: '20', height: '10', 'aria-hidden': 'true' }) as SVGSVGElement;
			glyph(svg);
			row.appendChild(svg);
			row.createSpan({ text: label });
			return row;
		};
		item((svg) => svg.appendChild(makeSvg('rect', { class: 'sg-tl-key-spine', x: '0', y: '3', width: '20', height: '4' })), t('timeline.key.spine'));
		if (SHOW_PLOTLINE_LANES) item((svg) => svg.appendChild(makeSvg('line', { class: 'sg-tl-key-thread', x1: '2', y1: '5', x2: '18', y2: '5' })), t('timeline.key.plotline'));
		item((svg) => svg.appendChild(makeSvg('circle', { class: 'sg-tl-key-dot', cx: '10', cy: '5', r: '4.25' })), t('timeline.key.event'));
		// Always built, shown only while the timeline has eras (syncEraKeyRow) — so the first era added shows here without reopening.
		this.eraKeyRow = item((svg) => svg.appendChild(makeSvg('rect', { class: 'sg-tl-key-era', x: '0', y: '0', width: '20', height: '10' })), t('timeline.key.era'));
		this.syncEraKeyRow();
		if (this.appearance().stitches) item((svg) => svg.appendChild(makeSvg('line', { class: 'sg-tl-key-stitch', x1: '10', y1: '0', x2: '10', y2: '10' })), t('timeline.key.stitch'));
	}

	/** Which side of its anchor a label's text sits on — the box twin of labelAttrs(). */
	private labelPlacement(side: -1 | 1, appearance: TimelineAppearance): LabelPlacement {
		if (this.orientation === 'horizontal') return side === 1 ? 'centered-below' : 'centered-above';
		if (appearance.labelDirection === 'along-axis') return side === -1 ? 'rotated-left' : 'rotated-right';
		return side === -1 ? 'beside-left' : 'beside-right';
	}

	/**
	 * Labels (track names first, then events in time order) that would overlap
	 * at the current zoom — those get .is-crowded and only show on hover (and
	 * in the hover/tap card). Measured in on-screen px: along-axis positions
	 * times the zoom, across as-is. Names never land on each other or on a
	 * badge; 'room' (the default) also keeps a wider gap, for a calmer overview.
	 * 'hover'/'off' already keep the overview clear, so nothing is thinned there.
	 */
	private crowdedLabels(
		layout: ReturnType<typeof computeTimelineLayout>,
		lanes: Plotline[],
		eventById: Map<string, TimelineEvent>,
		pxPerDay: number,
		appearance: TimelineAppearance,
	): Set<string> {
		if (appearance.labelMode !== 'always' && appearance.labelMode !== 'room') return new Set();
		const font = MIN_LABEL_SCREEN_PX;
		const { start, end } = this.visibleDayRange();
		const horizontal = this.orientation === 'horizontal';
		const alongOf = (p: LayoutPoint): number => (horizontal ? p.x : p.y);
		const onScreen = (p: LayoutPoint): boolean => {
			const day = alongOf(p) / pxPerDay;
			return day >= start && day <= end;
		};
		const toScreen = (p: LayoutPoint): LayoutPoint =>
			(horizontal ? { x: p.x * this.scale, y: p.y } : { x: p.x, y: p.y * this.scale });
		const trackBoxes: Array<{ id: string; box: LayoutRect }> = [];
		const boxes: Array<{ id: string; box: LayoutRect }> = [];
		layout.tracks.forEach((track, idx) => {
			const name = lanes[idx]?.name;
			if (!track.labelAnchor || !name) return;
			trackBoxes.push({ id: 'track:' + track.trackId, box: labelBox(toScreen(track.labelAnchor), name, font, horizontal ? 'ends-at' : 'centered-on-top') });
		});
		[...layout.labels]
			.filter((l) => onScreen(l.anchor))
			.sort((a, b) => alongOf(a.anchor) - alongOf(b.anchor))
			.forEach((l) => {
				const evt = eventById.get(l.eventId);
				if (!evt) return;
				boxes.push({ id: l.eventId, box: labelBox(toScreen(l.anchor), truncate(evt.name, NODE_LABEL_MAX), font, this.labelPlacement(l.side, appearance)) });
			});
		// A name painted under someone else's badge reads as broken, so badges
		// are obstacles in both modes; 'room' also keeps a wider breathing gap.
		const obstacles: LayoutRect[] = [];
		const badge = (center: LayoutPoint, r: number): void => {
			if (!onScreen(center)) return;
			const c = toScreen(center);
			obstacles.push({ x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r });
		};
		for (const m of layout.markers) badge(m.center, m.radius);
		for (const b of layout.bars) {
			badge(b.startCenter, b.startRadius);
			badge(b.endCenter, b.endRadius);
		}
		// Gap stays below the layout's labelGap (6), so a name never collides with its OWN badge.
		const gap = appearance.labelMode === 'room' ? 5 : 3;
		// Plotline names only yield to each other, never to badges — a lane
		// whose name is hidden while still on screen would have no name at all
		// (the pinned copy only steps in once the name scrolls away). The
		// names that show then count as obstacles for the event names.
		const hiddenTracks = crowdedLabelIds(trackBoxes, gap);
		const shownTracks = trackBoxes.filter((b) => !hiddenTracks.has(b.id)).map((b) => b.box);
		const hiddenEvents = crowdedLabelIds(boxes, gap, [...shownTracks, ...obstacles]);
		return new Set([...hiddenTracks, ...hiddenEvents]);
	}

	private timeAxisPos(absoluteDay: number): number {
		return absoluteDay * BASE_PX_PER_DAY;
	}

	/** Inverse of the viewport transform: screen (client) px -> world-space day + nearest track slot. */
	private screenToWorld(clientX: number, clientY: number): { day: number; trackIdx: number } {
		const rect = this.svgEl!.getBoundingClientRect();
		const horizontal = this.orientation === 'horizontal';
		// Only the time axis is zoomed; across stays in screen px.
		const sx = clientX - rect.left - this.tx;
		const sy = clientY - rect.top - this.ty;
		const along = (horizontal ? sx : sy) / this.scale;
		const across = horizontal ? sy : sx;
		const spec = this.layoutSpec();
		return {
			day: along / spec.pxPerDay,
			trackIdx: nearestTrackIndex(across, this.laneList().length, spec.spacing),
		};
	}

	/** Visible world-space day range, with a half-viewport buffer on each side for culling. */
	private visibleDayRange(): { start: number; end: number } {
		const rect = this.wrapEl!.getBoundingClientRect();
		const alongSize = this.orientation === 'horizontal' ? rect.width : rect.height;
		const alongOffset = this.orientation === 'horizontal' ? this.tx : this.ty;
		const startPx = (-alongOffset) / this.scale;
		const endPx = (alongSize - alongOffset) / this.scale;
		const startDay = startPx / BASE_PX_PER_DAY;
		const endDay = endPx / BASE_PX_PER_DAY;
		const buffer = (endDay - startDay) * 0.5;
		return { start: startDay - buffer, end: endDay + buffer };
	}

	/**
	 * Zoom-to-fit: picks a scale that fits every event's day span in the
	 * viewport (clamped to the same MIN_ZOOM/MAX_ZOOM as manual zoom) and
	 * centers on it. A single event, or several events sharing one day, has
	 * no span to fit — the scale is left as-is and only the pan changes.
	 */
	/** Every dated event as days: start, and end (a moment ends where it starts; an ongoing bar at the story's present). */
	private rangeItems(): RangeItem[] {
		const cal = this.data().calendar;
		const present = this.presentDay();
		return this.events.map((evt) => {
			const startDay = this.absoluteDay(evt);
			const endDay = this.isDrawnOngoing(evt, present) ? present
				: evt.end ? storyDateToAbsoluteDay(cal, evt.end) : startDay;
			return { name: evt.name, key: evt.notePath, groupName: evt.file.basename, startDay, endDay };
		}).concat(this.eraSpans().map(({ era, startDay, endDay }) => ({ name: era.name, key: era.notePath, groupName: era.file.basename, startDay, endDay })));
	}

	/** Each dated era's days: its start, and where its band stops (eraEndDay: End Date, else the story's present). */
	private eraSpans(): Array<{ era: TimelineEvent; startDay: number; endDay: number }> {
		const cal = this.data().calendar;
		const present = this.presentDay();
		return this.eras.map((era) => {
			const startDay = this.absoluteDay(era);
			const end = era.end ? storyDateToAbsoluteDay(cal, era.end) : undefined;
			return { era, startDay, endDay: eraEndDay(cal, startDay, end, era.ongoing ? present : undefined) };
		});
	}

	/**
	 * An era's band colour: the sheet's own Color, else a colour this timeline
	 * gave the sheet before it became an era, else a gentle palette colour
	 * picked by its path (always the same one).
	 */
	private eraColor(era: TimelineEvent): string {
		const own: unknown = this.app.metadataCache.getFileCache(era.file)?.frontmatter?.['color'];
		if (typeof own === 'string' && own.trim()) return own.trim();
		return this.data().eventDisplay[era.notePath]?.color ?? defaultEraColor(era.notePath);
	}

	/** Where the main line starts and stops — the chosen years, or first event to last (or the present). */
	private lineEnds(): LineEnds | null {
		return lineEnds(this.data().calendar, this.shownRange(), this.rangeItems(), this.events.length > 0 || this.eras.length > 0 ? this.presentDay() : undefined);
	}

	/** The chosen "Years shown", or null for Automatic (first to last event). */
	private shownRange(): ResolvedRange | null {
		return resolveRange(this.data().calendar, this.data().viewSettings.range);
	}

	/**
	 * How far the camera may zoom out: with chosen years, until they fill
	 * ~40% of the view (rangeZoomFloor); on Automatic, the global floor.
	 */
	private minZoom(): number {
		const range = this.shownRange();
		if (!range || !this.wrapEl) return MIN_ZOOM;
		const rect = this.wrapEl.getBoundingClientRect();
		const viewportPx = this.orientation === 'horizontal' ? rect.width : rect.height;
		if (viewportPx <= 0) return MIN_ZOOM;
		const fit = computeTimelineFit([range.startDay, range.endDay], viewportPx, BASE_PX_PER_DAY, MIN_ZOOM, MAX_ZOOM, this.scale).scale;
		return rangeZoomFloor(fit, MIN_ZOOM);
	}

	/** The story's present (latest chapter date, else latest event date) as an absolute day — where ongoing bars end. */
	private presentDay(): number | undefined {
		return storyPresentDay(this.data().calendar, this.data().sceneDates ?? {}, this.events);
	}

	/**
	 * Whether an ongoing event really draws as a bar: only when the present is
	 * after its start (one starting at or after the present is a badge for
	 * now). The painter, the fit and the hover card all ask this, so the card
	 * never says "Ongoing" over a plain badge.
	 */
	private isDrawnOngoing(evt: TimelineEvent, present: number | undefined): present is number {
		return !!evt.ongoing && present !== undefined && present > this.absoluteDay(evt);
	}

	private centerOnEvents(): void {
		if (!this.wrapEl) return;
		// Chosen years: the fit shows exactly them (every event is inside —
		// checkShownRange grows the range before anything is drawn).
		const ends = this.lineEnds();
		if (ends) {
			this.applyFit([ends.startDay, ends.endDay]);
			return;
		}
		if (this.events.length === 0) {
			// Nothing to center — but still render, so the empty state shows.
			this.applyTransform();
			this.renderAxisTicks();
			this.renderLanesAndNodes();
			return;
		}
		// Start AND end dates, so a long span ending late still fits.
		const cal = this.data().calendar;
		const present = this.presentDay();
		const days = this.events.flatMap((e) => [
			this.absoluteDay(e),
			...(e.end ? [storyDateToAbsoluteDay(cal, e.end)] : []),
			...(this.isDrawnOngoing(e, present) ? [present] : []),
		]);
		this.applyFit(days);
	}

	/** Pans (scale unchanged) to bring a single day to the center of the viewport — used after creating a new event so its dot is visible without disturbing the current zoom level. */
	private panToDay(day: number): void {
		if (!this.wrapEl) return;
		this.applyFit([day]);
	}

	private applyFit(days: number[]): void {
		if (!this.wrapEl) return;
		const rect = this.wrapEl.getBoundingClientRect();
		// Not on screen yet: fitting now would park the camera on day 0. Keep
		// the debt; the ResizeObserver pays it once the view has a size.
		if (!canFitViewport(rect.width, rect.height)) {
			this.fitPending = true;
			this.applyTransform();
			this.renderAxisTicks();
			this.renderLanesAndNodes();
			return;
		}
		this.fitPending = false;
		const viewportPx = this.orientation === 'horizontal' ? rect.width : rect.height;
		const { scale, offset } = computeTimelineFit(days, viewportPx, BASE_PX_PER_DAY, MIN_ZOOM, MAX_ZOOM, this.scale);
		this.scale = scale;
		// The spine sits at world across 0 with tracks on both sides — center
		// it in the viewport's cross axis.
		if (this.orientation === 'horizontal') {
			this.tx = offset;
			this.ty = rect.height / 2;
		} else {
			this.ty = offset;
			this.tx = rect.width / 2;
		}
		this.applyTransform();
		this.renderAxisTicks();
		this.renderLanesAndNodes();
	}

	// ── Pan / zoom (mirrors RelGraphController's pointer handling) ────────────

	private bindSvgEvents(svg: SVGSVGElement, wrap: HTMLElement): void {
		wrap.addEventListener('wheel', (e: WheelEvent) => {
			e.preventDefault();
			// The card points at a badge that is about to move.
			this.hideEventCard();
			const action = timelineWheelAction(e.deltaX, e.deltaY, e.deltaMode);
			if (action.kind === 'pan') {
				// Scroll through time along the time axis.
				if (this.orientation === 'horizontal') this.tx -= action.by;
				else this.ty -= action.by;
				this.scheduleRender();
				return;
			}
			if (action.kind === 'none') return;
			this.applyZoom(this.scale * action.factor, { x: e.clientX, y: e.clientY });
			this.scheduleCullRefresh();
		}, { passive: false });

		svg.addEventListener('pointerdown', (e: PointerEvent) => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			svg.setPointerCapture(e.pointerId);
			this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

			// A pinch already owns its two pointers — a 3rd+ touch must never
			// re-key it, re-arm a pan against it, or re-point the tap candidate.
			// It is still recorded above so cleanup stays correct.
			if (this.pinchPointerIds) return;

			const others = Array.from(this.activePointers.keys()).filter((id) => id !== e.pointerId);
			if (others.length === 1) {
				// A 2nd pointer upgrades the pan to a pinch, keyed to exactly these
				// two pointer ids. A pinch is never a tap — and the 2nd finger's own
				// target must not become the tap / context-menu candidate either.
				this.isPinching = true;
				this.panning = false;
				this.panPointerId = null;
				this.pointerDownWasDrag = true;
				this.tapCandidateId = null;
				this.pinchPointerIds = [others[0], e.pointerId];
				const a = this.activePointers.get(others[0]);
				const b = this.activePointers.get(e.pointerId);
				this.pinchStartDist = a && b ? pointerDist(a, b) : 0;
				this.pinchStartScale = this.scale;
				return;
			}

			// First pointer down. Its own target is trustworthy (see the tap-state
			// comment above) — record whether it pressed a dot.
			const nodeEl = (e.target as Element).closest('.sg-tl-node');
			// An event on top wins; only a press on the bare band (or its name) is the era's.
			let eraEl = nodeEl ? null : (e.target as Element).closest('[data-era-id]');
			// Stacked names' finger targets overlap (each 44pt, the names 18px apart): the name nearest the finger wins.
			if (eraEl?.classList.contains('sg-tl-era-label')) eraEl = this.nearestEraLabel(e.clientX, e.clientY) ?? eraEl;
			this.tapCandidateId = nodeEl?.getAttribute('data-id') ?? eraEl?.getAttribute('data-era-id') ?? null;
			this.tapOnEraLabel = !!eraEl?.classList.contains('sg-tl-era-label');
			this.pointerDownWasDrag = false;
			this.panning = true;
			this.panPointerId = e.pointerId;
			this.panClientStart = { x: e.clientX, y: e.clientY };
			this.panTxStart = this.tx;
			this.panTyStart = this.ty;
			svg.addClass('sg-tl-svg--panning');
		});

		svg.addEventListener('pointermove', (e: PointerEvent) => {
			if (!this.activePointers.has(e.pointerId)) return;
			this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

			if (this.isPinching && this.pinchPointerIds) {
				const [id1, id2] = this.pinchPointerIds;
				// Ignore any pointer that isn't one of the pinch's own two — a stray
				// extra touch moving must never perturb it.
				if (e.pointerId !== id1 && e.pointerId !== id2) return;
				const a = this.activePointers.get(id1);
				const b = this.activePointers.get(id2);
				if (a && b && this.pinchStartDist > 0) {
					const dist = pointerDist(a, b);
					const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
					this.applyZoom(this.pinchStartScale * (dist / this.pinchStartDist), center);
				}
				this.pointerDownWasDrag = true;
				this.hideEventCard();
			} else if (this.panning) {
				if (e.pointerId !== this.panPointerId) return; // stray extra touch — ignore
				const dx = e.clientX - this.panClientStart.x;
				const dy = e.clientY - this.panClientStart.y;
				if (!isTap(dx, dy)) {
					if (!this.pointerDownWasDrag) this.hideEventCard();
					this.pointerDownWasDrag = true;
				}
				this.tx = this.panTxStart + dx;
				this.ty = this.panTyStart + dy;
				this.scheduleRender();
			}
		});

		const onPointerUp = (e: PointerEvent) => {
			// Ignore pointers the pointerdown handler never registered (non-left
			// mouse buttons, presses that began outside the svg) — otherwise a
			// right-click would run tap resolution against stale state and close
			// the selection, which the old synthesized 'click' never did.
			if (!this.activePointers.delete(e.pointerId)) return;

			// End the pinch only when one of ITS two tracked pointers ends — a
			// stray extra touch lifting must not drop out of the pinch and then
			// snap-zoom off the stale start distance.
			if (this.isPinching && this.pinchPointerIds && this.pinchPointerIds.includes(e.pointerId)) {
				this.isPinching = false;
				this.pinchPointerIds = null;
				const remaining = Array.from(this.activePointers.entries());
				if (remaining.length === 1) {
					// Hand the gesture to the finger still down, so pinch-then-drag
					// keeps panning instead of dead-ending. Its CURRENT position is
					// the new pan origin, so the view doesn't jump.
					const [id, pt] = remaining[0];
					this.panning = true;
					this.panPointerId = id;
					this.panClientStart = { x: pt.x, y: pt.y };
					this.panTxStart = this.tx;
					this.panTyStart = this.ty;
					svg.addClass('sg-tl-svg--panning');
				} else {
					// Gesture over, and it ended as a pinch: the 'grabbing' cursor set
					// back when it began as a pan was never cleared, and the zoom that
					// just happened needs the same off-screen-culling refresh a
					// finished pan gets — neither used to run on this path.
					svg.removeClass('sg-tl-svg--panning');
					this.scheduleCullRefresh();
				}
			}

			// End the pan only when ITS own tracked pointer ends — never when a
			// stray touch lifts, and never when the pan was just re-armed above for
			// a different finger.
			if (this.panning && e.pointerId === this.panPointerId) {
				this.panning = false;
				this.panPointerId = null;
				svg.removeClass('sg-tl-svg--panning');
				this.scheduleCullRefresh();
			}

			// Tap resolution — never from 'click', which pointer capture retargets
			// to the <svg> (see tap-state comment on the fields). A pointercancel
			// is not a tap; neither is anything that panned or pinched.
			if (this.activePointers.size === 0) {
				// Hover leaves were suppressed for the whole press (see the dot's
				// pointerleave guard) and boundary events are not guaranteed to
				// re-fire after capture release — clear hover unconditionally; a
				// genuine hover re-enters on its own, and a tapped dot shows the
				// identical ring via is-active anyway.
				this.setHovered(null);
				this.setHoveredEra(null);
				if (this.eraHoverTimer) { window.clearTimeout(this.eraHoverTimer); this.eraHoverTimer = null; }
				if (e.type === 'pointerup' && !this.pointerDownWasDrag) {
					const evt = this.drawnById(this.tapCandidateId);
					const somethingOpen = this.cardPinned || this.activeEventId !== null || this.activeUndatedPath !== null;
					if (evt?.kind === 'era' && !this.tapOnEraLabel && (e.pointerType === 'mouse' || somethingOpen)) {
						// The bare band is also the background: a mouse click there (the
						// hover card already answers "what is this?"), or a tap while a
						// card or selection is open, closes things — a tap on a calm
						// timeline shows the era's card. Its name always opens it.
						this.clearSelection();
					} else if (evt && e.pointerType === 'mouse') {
						this.selectEvent(evt);
					} else if (evt) {
						// Touch / pen: select, and show the card with its "Open
						// sheet" button instead of jumping to the sidebar.
						this.selectEvent(evt, false);
						this.showEventCard(evt, true);
					} else if (!this.tapCandidateId) {
						this.clearSelection();
					}
					// A candidate whose event vanished mid-press (a refresh raced
					// the tap) does nothing — neither a stale preview nor a clear.
				}
			}
		};
		svg.addEventListener('pointerup', onPointerUp);
		svg.addEventListener('pointercancel', onPointerUp);

		// Mobile long-press: pointer capture retargets the WebView's synthesized
		// contextmenu to the <svg> (same trap as the synthesized click), so the
		// dot's own contextmenu listener never sees it. Resolve the pressed dot
		// from the pointerdown-recorded candidate — but ONLY while the finger is
		// still down (desktop right-clicks are never registered/captured, so
		// activePointers is empty and a stale candidate can't misfire here).
		svg.addEventListener('contextmenu', (e: MouseEvent) => {
			if (this.activePointers.size === 0 || !this.tapCandidateId) return;
			const evt = this.drawnById(this.tapCandidateId);
			if (!evt) return;
			e.preventDefault();
			// The press became a menu: its release must not also count as a tap
			// (some WebViews send pointerup, not pointercancel, after a long-press).
			this.pointerDownWasDrag = true;
			this.hideEventCard();
			const anchor = (evt.kind === 'era' ? this.eraAnchor(evt.id) : this.nodeGroup?.querySelector(`[data-id="${CSS.escape(evt.id)}"]`)) ?? svg;
			this.showEventContextMenu(e, evt.file, true, anchor, evt);
		});

		svg.addEventListener('dblclick', (e: MouseEvent) => {
			// Retargeting makes `e.target.closest('.sg-tl-node')` always miss
			// here, so the "was this press on a dot?" answer comes from the
			// pointerdown-recorded candidate instead — a double-click on an
			// existing dot must not create a duplicate event underneath it.
			// A double-click inside an era's band still adds an event there — not on its name, which opens the era.
			if (this.tapOnEraLabel) return;
			if (this.tapCandidateId && !this.eras.some((era) => era.id === this.tapCandidateId)) return;
			const { day, trackIdx } = this.screenToWorld(e.clientX, e.clientY);
			const plotline = this.laneList()[trackIdx] ?? UNSORTED_PLOTLINE;
			this.openAddEventSheet({
				plotlineId: SHOW_PLOTLINE_LANES ? plotline.id : undefined,
				date: absoluteDayToStoryDate(this.data().calendar, Math.round(day)),
			});
		});
	}

	private applyTransform(): void {
		// Zoom stretches the time axis only. Badges, labels and stitch dots
		// undo that stretch through --sg-tl-k (see counterScale()); lines use
		// vector-effect: non-scaling-stroke; the spine, lanes and bars are
		// rects whose thickness runs across, which this never scales. So every
		// size stays what the Appearance panel says, at every zoom.
		const sx = this.orientation === 'horizontal' ? this.scale : 1;
		const sy = this.orientation === 'horizontal' ? 1 : this.scale;
		this.svgViewport?.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${sx},${sy})`);
		this.svgEl?.style.setProperty('--sg-tl-k', String(1 / this.scale));
		// Era names stay in view at the band's start edge as the camera moves.
		this.positionEraLabels();
		// The axis ticks sit inside svgViewport, so this one transform also
		// carries them every frame, so dates stay attached while dragging.
		// Ticks are NOT rebuilt here — that used to make every scheduleRender()
		// animation frame during a pan/zoom drag do a full axisGroup.empty() +
		// rebuild (real per-frame DOM churn). scheduleRender() now settles the
		// ticks the same way scheduleCullRefresh() already settles the culled
		// node/lane set; callers that need ticks rebuilt immediately after a
		// one-off (non-per-frame) transform change call renderAxisTicks()
		// themselves right after this — see buildSkeleton, centerOnEvents,
		// applyFit, resetAppearance, scheduleAppearanceRepaint.
	}

	private applyZoom(newScale: number, anchorClient?: { x: number; y: number }): void {
		// Never below the floor — but a floor that rose (the window grew wider)
		// must not snap a view that is already further out back in.
		const clamped = Math.max(Math.min(this.minZoom(), this.scale), Math.min(MAX_ZOOM, newScale));
		if (this.svgEl) {
			const rect = this.svgEl.getBoundingClientRect();
			// Only the time axis zooms, so only its offset moves to keep the
			// point under the cursor/fingers in place.
			if (this.orientation === 'horizontal') {
				const anchorX = anchorClient ? anchorClient.x - rect.left : rect.width / 2;
				this.tx = anchorX - ((anchorX - this.tx) / this.scale) * clamped;
			} else {
				const anchorY = anchorClient ? anchorClient.y - rect.top : rect.height / 2;
				this.ty = anchorY - ((anchorY - this.ty) / this.scale) * clamped;
			}
		}
		this.scale = clamped;
		this.scheduleRender();
	}

	/**
	 * Batches the (cheap) transform attribute update into one requestAnimationFrame
	 * per burst of pointer/wheel events, and restarts the settle-timer that
	 * rebuilds the culled node/lane set AND the axis ticks once the gesture
	 * actually stops (see scheduleCullRefresh) — so the two expensive full
	 * rebuilds wait for pan/zoom to settle instead of running on every frame.
	 */
	private scheduleRender(): void {
		if (this.renderScheduled) return;
		this.renderScheduled = true;
		window.requestAnimationFrame(() => {
			this.renderScheduled = false;
			this.applyTransform();
			this.scheduleCullRefresh();
		});
	}

	/** Rebuilds the culled DOM node/lane set AND the axis ticks once panning/zooming settles — not on every frame. Shares one timer so both land together, ~150ms after the last pan/zoom/wheel event. */
	private scheduleCullRefresh(): void {
		if (this.cullTimer) window.clearTimeout(this.cullTimer);
		this.cullTimer = window.setTimeout(() => {
			this.renderLanesAndNodes();
			this.renderAxisTicks();
		}, 150);
	}

	// ── Spine ticks (semantic zoom, unscaled overlay) ───────────────────────────

	/**
	 * Year chips + month/day ticks pinned to the spine. Tick DAYS come from
	 * the pure engine (computeSpineTicks); this method only paints them. They
	 * live in the unscaled overlay so the text stays legible at any zoom —
	 * screen positions are computed by hand from tx/ty/scale, with the
	 * spine's cross-axis screen position derived the same way (world 0).
	 */
	private renderAxisTicks(): void {
		if (!this.axisGroup || !this.wrapEl) return;
		const axis = this.axisGroup;
		this.renderPinnedTrackNames();

		const cal = this.data().calendar;
		// A full extra view each side (on top of the cull buffer), so a pan
		// never outruns the ticks before the settle refresh adds more.
		const visible = this.visibleDayRange();
		const pad = (visible.end - visible.start) * 0.5;
		const start = visible.start - pad;
		const end = visible.end + pad;
		// Unit comes from the appearance model: 'auto' keeps the zoom-derived
		// granularity, the explicit units pin it so the writer chooses the
		// measurement.
		// Year chips stay apart on screen when zoomed far out (a horizontal chip is ~70px wide, a vertical one 20px tall).
		// The range is twice what it was (a full view each side), so the tick cap is too — else days give way to months early.
		const minYearGapPx = this.orientation === 'horizontal' ? 96 : 48;
		// Labels only along the main line, and none crowding an end cap's own
		// year (the caps name the first and last year — see renderLineCaps).
		const ends = this.lineEnds();
		const from = ends ? Math.max(start, ends.startDay) : start;
		const to = ends ? Math.min(end, ends.endDay) : end;
		let ticks = from <= to
			? computeSpineTicks(cal, from, to, BASE_PX_PER_DAY * this.scale, 480, this.appearance().axisUnit, minYearGapPx)
			: [];
		if (ends) {
			const capLabels = [ends.startYear, ends.endYear].map((y) => formatStoryDate(cal, yearAsStoryDate(cal, y)));
			ticks = clampTicksToLine(ticks, ends, minYearGapPx / (BASE_PX_PER_DAY * this.scale), capLabels);
		}

		// Ticks live in the camera's group at their WORLD position, counter-
		// scaled like the badges — so they ride every pan/zoom/pinch frame with the main
		// line and nothing is rebuilt per frame. This settle pass only decides
		// WHICH ticks show: a tick that stays keeps its element untouched (it
		// can't jump), new ones fade in (CSS), gone ones are removed.
		const horizontal = this.orientation === 'horizontal';
		const kTransform = counterScale(horizontal);
		const wanted = new Set<string>();
		for (const tick of ticks) {
			const key = `${this.orientation}|${tick.kind}|${tick.day}|${tick.label}`;
			wanted.add(key);
			const existing = this.axisTickEls.get(key);
			if (existing && existing.parentNode === axis) continue;

			const along = this.timeAxisPos(tick.day);
			const at = makeSvg('g', { class: 'sg-tl-axis-tick is-new', transform: horizontal ? `translate(${along},0)` : `translate(0,${along})` }) as SVGGElement;
			const k = makeSvg('g', {}) as SVGGElement;
			k.style.transform = kTransform;
			at.appendChild(k);
			axis.appendChild(at);
			this.axisTickEls.set(key, at);
			// Fade in once: Obsidian hides background tabs with display:none,
			// which would replay a still-attached animation on every return.
			at.addEventListener('animationend', () => at.classList.remove('is-new'), { once: true });

			if (tick.kind === 'year') {
				// Chip: text first (so it can be measured), then a 6px-radius
				// rect (the locked shape system) slid in behind it. Coordinates
				// are screen px around the tick's point on the main line.
				const g = makeSvg('g', { class: 'sg-tl-year-chip' });
				k.appendChild(g);
				const text = makeSvg('text', { class: 'sg-tl-year-chip-text', 'text-anchor': 'middle', x: '0', y: '4' }) as SVGTextElement;
				text.textContent = tick.label;
				g.appendChild(text);
				// A view drawn while hidden measures text as 0, and a kept chip is never redrawn — estimate instead.
				const measured = text.getComputedTextLength();
				const w = Math.max(44, (measured > 0 ? measured : tick.label.length * 7) + 18);
				const rect = makeSvg('rect', { class: 'sg-tl-year-chip-bg', x: String(-w / 2), y: '-10', width: String(w), height: '20', rx: '6' });
				g.insertBefore(rect, text);
				continue;
			}

			const tickCls = 'sg-tl-spine-tick' + (tick.kind === 'day' ? ' is-day' : '');
			k.appendChild(horizontal
				? makeSvg('line', { class: tickCls, x1: '0', y1: '-5', x2: '0', y2: '5' })
				: makeSvg('line', { class: tickCls, x1: '-5', y1: '0', x2: '5', y2: '0' }));
			const label = makeSvg('text', {
				class: 'sg-tl-tick-label' + (tick.kind === 'day' ? ' is-day' : ''),
				'text-anchor': 'middle', x: '0', y: horizontal ? '18' : '-8',
			});
			label.textContent = tick.label;
			k.appendChild(label);
		}
		for (const [key, el] of this.axisTickEls) {
			if (wanted.has(key) && el.parentNode === axis) continue;
			el.remove();
			this.axisTickEls.delete(key);
		}
	}

	// ── Scene paint (dumb painter over computeTimelineLayout) ──────────────────

	/**
	 * Eras: one
	 * soft, translucent band per era across its years and the full width,
	 * under the main line and every event, its name calm at the band's start
	 * edge. Overlapping eras share the width and get softer (layoutEraBands).
	 * Hovering the band (not an event on top of it) shows the event card; a
	 * tap does too on phones; right-click has the era's menu.
	 */
	private renderEraBands(pxPerDay: number, visibleDays: { start: number; end: number }): void {
		const group = this.eraGroup;
		this.eraLabels = [];
		if (!group) return;
		group.empty();
		if (this.eras.length === 0) return;
		const horizontal = this.orientation === 'horizontal';
		const kTransform = counterScale(horizontal);
		const spans = this.eraSpans();
		const byId = new Map(spans.map((s) => [s.era.id, s.era]));
		const bands = layoutEraBands(spans.map((s) => ({ id: s.era.id, startDay: s.startDay, endDay: s.endDay })));
		// Two layers: every band first, then every name — so one era's wash
		// never covers (or catches the clicks of) another era's name.
		const bandLayer = makeSvg('g', { class: 'sg-tl-era-bands' }) as SVGGElement;
		const nameLayer = makeSvg('g', { class: 'sg-tl-era-names' }) as SVGGElement;
		group.appendChild(bandLayer);
		group.appendChild(nameLayer);
		const names: Array<{ text: SVGTextElement; at: SVGGElement; band: EraBand; era: TimelineEvent }> = [];
		const paint = (band: EraBand, era: TimelineEvent): void => {
			const color = solidFromColor(this.eraColor(era));
			const geom = eraBandRect(band, pxPerDay, this.orientation);
			const rect = makeSvg('rect', {
				class: 'sg-tl-era-band',
				'data-era-id': era.id,
				x: String(geom.x), y: String(geom.y), width: String(geom.width), height: String(geom.height),
			}) as SVGRectElement;
			// Inline, like the badges: a band must not wait for a reloaded stylesheet
			// to be soft. --sg-tl-era-strength (styles.css) makes it a little
			// stronger on a dark page, which swallows a pale wash.
			rect.style.fill = color;
			rect.dataset.sgOpacity = String(band.opacity);
			rect.style.fillOpacity = eraOpacity(era.id === this.hoveredEraId ? band.opacity * 1.6 : band.opacity);
			bandLayer.appendChild(rect);
			// A hairline at each end, so where an age begins and ends reads even where two overlap.
			for (const day of [band.startDay, band.endDay]) {
				const along = day * pxPerDay;
				const edge = makeSvg('line', {
					class: 'sg-tl-era-edge',
					x1: String(horizontal ? along : -20000), y1: String(horizontal ? -20000 : along),
					x2: String(horizontal ? along : 20000), y2: String(horizontal ? 20000 : along),
					'vector-effect': 'non-scaling-stroke',
				}) as SVGLineElement;
				edge.style.stroke = color;
				edge.style.strokeOpacity = eraOpacity(0.45);
				bandLayer.appendChild(edge);
			}
			// The name: a dot in the era's colour and its name, in plain screen
			// px (counter-scaled), placed and kept in view by positionEraLabels.
			const at = makeSvg('g', { class: 'sg-tl-era-label', 'data-era-id': era.id }) as SVGGElement;
			const k = makeSvg('g') as SVGGElement;
			k.style.transform = kTransform;
			if (Platform.isMobile) {
				// The name is small; a finger gets a 44pt-tall target along it (sized once measured, below).
				const hit = makeSvg('rect', { class: 'sg-tl-era-label-hit', x: '-6', y: String(-TOUCH_HIT_RADIUS), height: String(2 * TOUCH_HIT_RADIUS), width: '0' }) as SVGRectElement;
				k.appendChild(hit);
			}
			const dot = makeSvg('circle', { cx: '4', cy: '0', r: '4' }) as SVGCircleElement;
			dot.style.fill = color;
			k.appendChild(dot);
			const text = makeSvg('text', { class: 'sg-tl-era-name', x: '13', y: '0', 'dominant-baseline': 'central' }) as SVGTextElement;
			text.textContent = truncate(era.name, NODE_LABEL_MAX + 4);
			k.appendChild(text);
			at.appendChild(k);
			nameLayer.appendChild(at);
			names.push({ text, at, band, era });
			for (const target of [rect, at]) this.wireEra(target, era);
		};
		for (const band of bands) {
			if (band.endDay < visibleDays.start || band.startDay > visibleDays.end) continue;
			const era = byId.get(band.id);
			if (era) paint(band, era);
		}
		// Measured once everything is in place — one layout, not one per era.
		for (const { text, at, band, era } of names) {
			const measured = text.getComputedTextLength();
			const width = 13 + Math.ceil(measured > 0 ? measured : (text.textContent ?? '').length * 7);
			at.querySelector('.sg-tl-era-label-hit')?.setAttribute('width', String(width + 12));
			this.eraLabels.push({ id: era.id, el: at, startPx: band.startDay * pxPerDay, endPx: band.endDay * pxPerDay, slot: band.labelSlot, length: horizontal ? width : ERA_LABEL_LINE });
		}
		this.positionEraLabels();
	}

	/**
	 * Puts each era's name just inside its band's start edge — or at the
	 * view's edge once that has scrolled away, so the name stays while any of
	 * the era shows — clear of the other eras' names (placeEraLabels). Cheap
	 * (a handful of transforms), so it runs on every camera frame.
	 */
	private positionEraLabels(): void {
		if (this.eraLabels.length === 0 || !this.wrapEl) return;
		const horizontal = this.orientation === 'horizontal';
		const alongOffset = horizontal ? this.tx : this.ty;
		const acrossOffset = horizontal ? this.ty : this.tx;
		const spots = placeEraLabels(this.eraLabels.map((l) => ({
			id: l.id, slot: l.slot, length: l.length,
			start: l.startPx * this.scale + alongOffset,
			end: l.endPx * this.scale + alongOffset,
		})), 0, horizontal ? 'rows' : 'lines');
		for (const l of this.eraLabels) {
			const spot = spots.get(l.id);
			l.el.style.display = spot ? '' : 'none';
			if (!spot) continue;
			// Screen px → the camera's world: along is scaled, across is not.
			// Time down: the name's line is centred on `along`; sideways: it starts there.
			const alongScreen = horizontal ? spot.along : spot.along + ERA_LABEL_LINE / 2;
			const acrossScreen = horizontal ? ERA_LABEL_PAD + ERA_LABEL_LINE / 2 + spot.row * ERA_LABEL_LINE : ERA_LABEL_PAD + 2;
			const alongWorld = (alongScreen - alongOffset) / this.scale;
			const acrossWorld = acrossScreen - acrossOffset;
			l.el.setAttribute('transform', horizontal ? `translate(${alongWorld},${acrossWorld})` : `translate(${acrossWorld},${alongWorld})`);
		}
	}

	/** An era's band and name: hover card (after a short rest), right-click menu. Taps are resolved in the svg's pointerup, like events. */
	private wireEra(target: SVGElement, era: TimelineEvent): void {
		target.addEventListener('pointerenter', (e: PointerEvent) => {
			if (e.pointerType !== 'mouse' || this.activePointers.size > 0) return;
			this.setHoveredEra(era.id);
			if (this.eraHoverTimer) window.clearTimeout(this.eraHoverTimer);
			this.eraHoverTimer = window.setTimeout(() => {
				this.eraHoverTimer = null;
				if (this.hoveredEraId === era.id && !this.cardPinned && this.hoveredId === null) this.showEventCard(era, false);
			}, 250);
		});
		target.addEventListener('pointerleave', (e: PointerEvent) => {
			if (e.pointerType !== 'mouse' || this.activePointers.size > 0) return;
			// Band → its own name (or back) is still the same era.
			const to = asNode(e.relatedTarget)?.instanceOf(Element) ? (e.relatedTarget as Element).closest('[data-era-id]') : null;
			if (to?.getAttribute('data-era-id') === era.id) return;
			if (this.eraHoverTimer) { window.clearTimeout(this.eraHoverTimer); this.eraHoverTimer = null; }
			this.setHoveredEra(null);
			if (!this.cardPinned && this.cardEventId === era.id) this.hideEventCard();
		});
		target.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			this.hideEventCard();
			this.showEventContextMenu(e, era.file, true, this.eraAnchor(era.id) ?? target, era);
		});
	}

	/** Lights an era's band a little while the mouse rests on it (inline, like everything else on the band). */
	private setHoveredEra(id: string | null): void {
		if (this.hoveredEraId === id) return;
		this.hoveredEraId = id;
		this.eraGroup?.querySelectorAll<SVGRectElement>('.sg-tl-era-band').forEach((rect) => {
			const base = Number(rect.dataset.sgOpacity ?? '0');
			rect.style.fillOpacity = eraOpacity(rect.getAttribute('data-era-id') === id ? base * 1.6 : base);
		});
	}

	/** The era's name on screen — what its card and menus sit beside. Null when the name is hidden (no room in view). */
	private eraAnchor(eraId: string): SVGGElement | null {
		const el = this.eraGroup?.querySelector<SVGGElement>(`.sg-tl-era-label[data-era-id="${CSS.escape(eraId)}"]`);
		return el && el.style.display !== 'none' ? el : null;
	}

	/**
	 * Where an era's card goes: beside its name — or, when the name has no
	 * room in view (a short era zoomed out), at the visible corner of its band,
	 * so every era on screen can still be hovered and tapped. Null when the
	 * band is not drawn at all.
	 */
	private eraCardAnchor(eraId: string): DOMRect | null {
		const label = this.eraAnchor(eraId);
		if (label) return label.getBoundingClientRect();
		const band = this.eraGroup?.querySelector<SVGRectElement>(`.sg-tl-era-band[data-era-id="${CSS.escape(eraId)}"]`);
		if (!band || !this.wrapEl) return null;
		const b = band.getBoundingClientRect();
		const w = this.wrapEl.getBoundingClientRect();
		const left = Math.max(b.left, w.left);
		const top = Math.max(b.top, w.top);
		if (left >= Math.min(b.right, w.right) || top >= Math.min(b.bottom, w.bottom)) return null;
		return new DOMRect(left + ERA_LABEL_PAD, top + ERA_LABEL_PAD, 0, 0);
	}

	/** The shown era name whose text is nearest a point on screen. */
	private nearestEraLabel(clientX: number, clientY: number): SVGGElement | null {
		let best: { el: SVGGElement; d: number } | null = null;
		for (const l of this.eraLabels) {
			if (l.el.style.display === 'none') continue;
			const text = l.el.querySelector('text');
			if (!text) continue;
			const b = text.getBoundingClientRect();
			const dx = Math.max(b.left - clientX, 0, clientX - b.right);
			const dy = Math.max(b.top - clientY, 0, clientY - b.bottom);
			const d = dx * dx + dy * dy;
			if (!best || d < best.d) best = { el: l.el, d };
		}
		return best?.el ?? null;
	}

	/** An event or an era by its drawn id — what a tap or long-press resolves against. */
	private drawnById(id: string | null): TimelineEvent | undefined {
		if (!id) return undefined;
		return this.events.find((ev) => ev.id === id) ?? this.eras.find((era) => era.id === id);
	}

	private renderLanesAndNodes(): void {
		if (!this.laneGroup || !this.nodeGroup) return;
		this.laneGroup.empty();
		this.nodeGroup.empty();
		// Gradient defs are not inside the groups we just emptied, so they need
		// their own sweep — otherwise every repaint leaks another copy.
		this.gradients.clear(this.defsEl);
		// A hover card points at a badge this repaint is about to replace; a
		// tapped (pinned) card is re-anchored at the end of this paint.
		if (this.cardEl && !this.cardPinned) this.hideEventCard();
		this.syncEmptyState();
		this.renderShelf();

		const spec = this.layoutSpec();
		const appearance = this.appearance();
		// Label mode is pure CSS state (see styles.css) rather than a paint
		// branch: 'hover' must still build the <text> nodes so the existing
		// is-hovered/is-active classes can reveal them without a repaint.
		this.svgEl?.classList.toggle('sg-tl-labels-hover', appearance.labelMode === 'hover');
		this.svgEl?.classList.toggle('sg-tl-labels-off', appearance.labelMode === 'off');
		const lanes = this.laneList();
		const eventById = new Map(this.events.map((e) => [e.id, e]));
		const horizontal = this.orientation === 'horizontal';
		const kTransform = counterScale(horizontal);

		// Layout over the FULL event list (not the culled visible range) so
		// spine/thread spans and sideways spreads stay stable while panning;
		// culling happens at paint time below.
		const present = this.presentDay();
		const layoutEvents: LayoutEvent[] = this.events.map((evt) => {
			// Per-event size overrides live on eventDisplay (keyed by note path,
			// the same seam color reads) — this is the single point where a
			// hand-edited `.timeline` file's stray numbers get clamped before
			// they reach the layout engine, matching how resolveAppearance()
			// clamps the global sliders. They are knob values, turned into
			// on-screen sizes by the same formulas as the defaults.
			const display = this.data().eventDisplay[evt.notePath];
			const ownMarker = clampKnob(display?.markerSize, APPEARANCE_LIMITS.markerSize);
			const ownBar = clampKnob(display?.barThickness, APPEARANCE_LIMITS.barThickness);
			const startDay = this.absoluteDay(evt);
			// Still going on: a bar up to the story's present. One that starts at
			// (or after) the present has nothing to stretch yet — a badge for now.
			const ongoing = this.isDrawnOngoing(evt, present);
			return {
				id: evt.id,
				trackId: this.resolvePlotline(evt.notePath).id,
				startDay,
				endDay: ongoing ? present : evt.end ? storyDateToAbsoluteDay(this.data().calendar, evt.end) : undefined,
				ongoing,
				markerRadius: ownMarker === undefined ? undefined : badgeRadiusFor(ownMarker),
				barThickness: ownBar === undefined ? undefined : barThicknessFor(ownBar),
			};
		});
		const layout = SHOW_PLOTLINE_LANES
			? computeTimelineLayout(layoutEvents, lanes.map((p) => p.id), spec)
			: computeColumnLayout(layoutEvents, spec);
		const crowded = this.crowdedLabels(layout, lanes, eventById, spec.pxPerDay, appearance);
		const labelById = new Map(layout.labels.map((l) => [l.eventId, l]));
		const alongOf = (p: LayoutPoint): number => (horizontal ? p.x : p.y);
		this.pinnedTracks = layout.tracks.flatMap((track, idx) => {
			const lane = lanes[idx];
			if (!track.line || !lane?.name) return [];
			return [{
				trackId: track.trackId, name: lane.name, color: solidFromColor(lane.color),
				across: track.acrossOffset, startAlong: alongOf(track.line.start), endAlong: alongOf(track.line.end),
			}];
		});

		const { start, end } = this.visibleDayRange();
		const visible = (p: LayoutPoint): boolean => {
			const day = alongOf(p) / spec.pxPerDay;
			return day >= start && day <= end;
		};
		const colorOf = (eventId: string): string => {
			const evt = eventById.get(eventId);
			if (!evt) return 'var(--text-muted)';
			return this.data().eventDisplay[evt.notePath]?.color ?? this.resolvePlotline(evt.notePath).color;
		};
		// The event's own icon, else its plotline's (resolveEventIcon), else a
		// kind fallback — every badge carries a picture.
		const iconOf = (evt: TimelineEvent): EventIconEntry => this.iconForPath(evt.notePath) ?? fallbackEventIcon(evt.kind);
		// Paint for shapes WITH AREA (bars, badges): a gradient becomes a real
		// `url(#…)` def. Lines and text go through `solidFromColor` instead —
		// an axis-aligned <line> has a zero-area bounding box, and an
		// objectBoundingBox gradient on a zero-area box renders nothing at all.
		// Gradients run ALONG the time axis, never across it: a fade that travels with time reads as duration,
		// and a straight 90°/180° vector is the one that survives a thin
		// shape's aspect-ratio stretch exactly.
		const gradientAngle = horizontal ? 90 : 180;
		const fillOf = (eventId: string): string => this.gradients.paint(this.defsEl, colorOf(eventId), gradientAngle);
		this.guideAnchors = new Map([
			...layout.markers.map((m) => [m.eventId, { start: m.center, color: colorOf(m.eventId) }] as const),
			...layout.bars.map((b) => [b.eventId, { start: b.startCenter, end: b.endCenter, color: colorOf(b.eventId) }] as const),
			// An era's guide marks its first and last day right on the main line.
			...this.eraSpans().map(({ era, startDay, endDay }) => [era.id, {
				start: axisPoint(startDay * spec.pxPerDay, 0, this.orientation),
				end: axisPoint(endDay * spec.pxPerDay, 0, this.orientation),
				color: this.eraColor(era),
			}] as const),
		]);
		this.renderEraBands(spec.pxPerDay, { start, end });
		// Theme variables resolved once per paint (a handful of distinct values at most), for glyph contrast.
		const resolvedVars = new Map<string, string>();
		const resolveVar = (c: string): string => {
			const m = /^var\(\s*(--[\w-]+)/.exec(c.trim());
			if (!m || !this.svgEl) return c;
			let v = resolvedVars.get(m[1]);
			if (v === undefined) {
				v = getComputedStyle(this.svgEl).getPropertyValue(m[1]).trim();
				resolvedVars.set(m[1], v);
			}
			return v || c;
		};

		/**
		 * One round badge centred on `center`: a theme-coloured cut-out (so
		 * lines under it stop cleanly), the event's colour as a disc with a
		 * light ring, and optionally its icon. Every part of its paint is set
		 * INLINE: an SVG circle with no fill of its own paints solid black, and
		 * a badge must not depend on a freshly reloaded stylesheet to be
		 * visible (CSS needs a plugin reload, JS-set styles do not). Returns
		 * the counter-scaled group, so a caller can put the label inside it.
		 */
		const paintBadge = (parent: SVGGElement, center: LayoutPoint, r: number, evt: TimelineEvent, withGlyph: boolean): SVGGElement => {
			const at = makeSvg('g', { transform: `translate(${center.x},${center.y})` }) as SVGGElement;
			const k = makeSvg('g', { class: 'sg-tl-badge' }) as SVGGElement;
			k.style.transform = kTransform;
			if (Platform.isMobile) {
				// Invisible, finger-sized target around a badge that may be smaller.
				const hit = makeSvg('circle', { class: 'sg-tl-node-hit', r: String(Math.max(TOUCH_HIT_RADIUS, r + badgeHaloFor(r))) }) as SVGCircleElement;
				k.appendChild(hit);
			}
			const halo = makeSvg('circle', { class: 'sg-tl-node-halo', r: String(r + badgeHaloFor(r)) }) as SVGCircleElement;
			k.appendChild(halo);
			// The ring is the disc's own stroke, inset so the badge's outer edge sits at exactly r.
			const ringWidth = badgeRingWidthFor(r);
			const disc = makeSvg('circle', { class: 'sg-tl-node-badge', r: String(r - ringWidth / 2) }) as SVGCircleElement;
			disc.style.fill = fillOf(evt.id);
			const ring = 'var(--sg-tl-badge-ring, #ffffff)';
			// Stashed so setHovered() can put it back after the accent highlight.
			disc.dataset.sgPaint = ring;
			disc.dataset.sgRing = String(ringWidth);
			const lit = evt.id === this.hoveredId || evt.id === this.activeEventId;
			disc.style.stroke = lit ? 'var(--interactive-accent)' : ring;
			disc.style.strokeWidth = `${lit ? ringWidth + 0.5 : ringWidth}px`;
			k.appendChild(disc);
			if (withGlyph) {
				// One clear solid even for a gradient fill — a ramp under a 20px glyph reads as mud.
				const size = r * BADGE_GLYPH_FRACTION;
				k.appendChild(makeIconGlyph(iconOf(evt), -size / 2, -size / 2, size, glyphColorOn(colorOf(evt.id), resolveVar)));
			}
			at.appendChild(k);
			parent.appendChild(at);
			return k;
		};

		/**
		 * The end of a bar that is still going on: a solid arrow in the bar's
		 * colour at the story's present, pointing on along time. Counter-scaled
		 * like a badge so it keeps its shape at every zoom; sized from the bar.
		 */
		const paintArrow = (parent: SVGGElement, tip: LayoutPoint, thickness: number, evt: TimelineEvent): void => {
			const at = makeSvg('g', { transform: `translate(${tip.x},${tip.y})` }) as SVGGElement;
			const k = makeSvg('g', { class: 'sg-tl-badge sg-tl-ongoing-arrow' }) as SVGGElement;
			k.style.transform = kTransform;
			const { half, length } = ongoingArrowSize(thickness);
			// Base just behind the bar's end, tip one arrow-length past the present.
			const pts = horizontal
				? [[-2, -half], [length, 0], [-2, half]]
				: [[-half, -2], [0, length], [half, -2]];
			const arrow = makeSvg('polygon', { class: 'sg-tl-bar-arrow', points: pts.map((p) => p.join(',')).join(' ') }) as SVGPolygonElement;
			// The bar's gradient runs along time, so the arrow carries on in its LAST colour.
			arrow.style.fill = solidFromColor(colorOf(evt.id), 'last');
			k.appendChild(arrow);
			at.appendChild(k);
			parent.appendChild(at);
		};

		/** The event's name, inside its badge's counter-scaled group (label coordinates relative to the badge centre). */
		const paintLabel = (badge: SVGGElement, evt: TimelineEvent, center: LayoutPoint): void => {
			const labelLayout = labelById.get(evt.id);
			if (!labelLayout) return;
			// Label anchors differ from the centre only ACROSS the time axis,
			// which is plain screen px — so the offset is valid as-is inside
			// the counter-scaled group. Direction is the labelDirection
			// setting, decoupled from orientation.
			const label = makeSvg('text', this.labelAttrs(labelLayout.anchor.x - center.x, labelLayout.anchor.y - center.y, labelLayout.side, appearance));
			label.textContent = truncate(evt.name, NODE_LABEL_MAX);
			if (crowded.has(evt.id)) label.classList.add('is-crowded');
			badge.appendChild(label);
		};

		/** Hover (mouse only — touch has no hover), right-click, and leave, shared by badges and spans. */
		const wireNode = (g: SVGGElement, evt: TimelineEvent): void => {
			// Opening the sheet lives in the svg's pointerup tap resolution, NOT
			// a 'click' listener here — pointer capture would retarget it away.
			g.addEventListener('pointerenter', (e: PointerEvent) => {
				if (e.pointerType !== 'mouse' || this.activePointers.size > 0) return;
				this.setHovered(evt.id);
				if (!this.cardPinned) this.showEventCard(evt, false);
			});
			g.addEventListener('contextmenu', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				this.hideEventCard();
				this.showEventContextMenu(e, evt.file, true, g, evt);
			});
			g.addEventListener('pointerleave', (e: PointerEvent) => {
				// svg.setPointerCapture() fires a spurious pointerleave on the
				// badge being pressed — ignore leaves while a pointer is down so
				// hover doesn't flicker off mid-press.
				if (e.pointerType !== 'mouse' || this.activePointers.size > 0) return;
				this.setHovered(null);
				if (!this.cardPinned) this.hideEventCard();
			});
		};

		// 1 · Spine, under everything, between the line's two ends (lineEnds):
		// the chosen years, or the first event to the last (or the present).
		// A line that stopped next to the only event read as a broken stub;
		// the round end caps make the ends deliberate,
		// and a one-day line covers that whole year instead of being a stub.
		this.spineEl = null;
		// Chosen years: the main line runs exactly from their first day to the
		// end of their last year — drawn even before any event exists.
		// Automatic: first event to the last (or the story's present). Both
		// ends get a round cap with the year, so the line's end is visible.
		const ends = this.lineEnds();
		if (ends) {
			const spineFrom = axisPoint(ends.startDay * spec.pxPerDay, 0, this.orientation);
			const spineTo = axisPoint(ends.endDay * spec.pxPerDay, 0, this.orientation);
			// A <rect>, not a <line>: an axis-aligned line has a zero-area
			// bounding box, so an objectBoundingBox gradient on it renders
			// nothing. Its thickness runs across the time axis, which the
			// camera never scales — so it is spineWidth on-screen px at any zoom.
			const rectGeom = axisRectFromSegment({ start: spineFrom, end: spineTo }, appearance.spineWidth, this.orientation);
			const spineEl = makeSvg('rect', {
				class: 'sg-tl-spine',
				x: String(rectGeom.x), y: String(rectGeom.y),
				width: String(rectGeom.width), height: String(rectGeom.height),
			}) as SVGRectElement;
			// No override: leave `fill` unset so styles.css's `.sg-tl-spine`
			// rule paints it (the model's inertness rule). An override paints
			// through the gradient defs on the same along-axis angle the bars use.
			if (appearance.spineColor) {
				spineEl.style.fill = this.gradients.paint(this.defsEl, appearance.spineColor, gradientAngle);
			}
			spineEl.addEventListener('contextmenu', (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				this.showSpineContextMenu(e, spineEl);
			});
			this.laneGroup.appendChild(spineEl);
			this.spineEl = spineEl;
			// Caps right after the line, under the stitch dots and badges.
			this.renderLineCaps(ends, appearance, this.laneGroup);
		}

		// 2 · Stitches: hairline from each event back to the spine, dot on the
		// spine — the story's pulse. Both take the gradient's representative
		// solid. The hairline keeps its width under the camera's stretch
		// (non-scaling-stroke); the dot is counter-scaled so it stays round.
		for (const s of layout.stitches) {
			if (!visible(s.from)) continue;
			const color = solidFromColor(colorOf(s.eventId));
			const line = makeSvg('line', {
				class: 'sg-tl-stitch',
				x1: String(s.from.x), y1: String(s.from.y), x2: String(s.to.x), y2: String(s.to.y),
				'vector-effect': 'non-scaling-stroke',
			});
			(line as SVGElement).style.stroke = color;
			this.laneGroup.appendChild(line);
			const dotAt = makeSvg('g', { transform: `translate(${s.to.x},${s.to.y})` });
			const dot = makeSvg('circle', { class: 'sg-tl-stitch-dot', r: String(STITCH_DOT_R) }) as SVGCircleElement;
			dot.style.fill = color;
			dot.style.transform = kTransform;
			dotAt.appendChild(dot);
			this.laneGroup.appendChild(dotAt);
		}

		// 3 · Plotline lanes: quiet guide lines in the plotline's colour (the
		// events' own colours carry the identity) + the plotline names.
		layout.tracks.forEach((track, idx) => {
			if (!track.line) return;
			const plotline = lanes[idx];
			// Per-track thickness override — paint only, resolved right
			// here. clampKnob answers undefined for an absent or malformed
			// plotline.width, which falls through to the appearance default.
			const trackWidth = clampKnob(plotline.width, APPEARANCE_LIMITS.trackWidth) ?? appearance.trackWidth;
			// Solid lanes are a <rect> so a gradient can genuinely paint on
			// them. Dashed/dotted need a real stroke to carve the dash pattern
			// out of, so those stay a <line> — non-scaling, so neither the width
			// nor the dashes stretch with zoom.
			let threadEl: SVGElement;
			if (plotline.lineStyle === 'solid') {
				const rectGeom = axisRectFromSegment(track.line, trackWidth, this.orientation);
				const rect = makeSvg('rect', {
					class: 'sg-tl-lane-thread',
					x: String(rectGeom.x), y: String(rectGeom.y),
					width: String(rectGeom.width), height: String(rectGeom.height),
				}) as SVGRectElement;
				rect.style.fill = this.gradients.paint(this.defsEl, plotline.color, gradientAngle);
				threadEl = rect;
			} else {
				const line = makeSvg('line', {
					class: 'sg-tl-lane-thread',
					x1: String(track.line.start.x), y1: String(track.line.start.y),
					x2: String(track.line.end.x), y2: String(track.line.end.y),
					stroke: solidFromColor(plotline.color), 'stroke-width': String(trackWidth),
					'vector-effect': 'non-scaling-stroke',
				}) as SVGLineElement;
				// Dash geometry scales with the stroke, so a thicker thread keeps
				// reading as dashed/dotted instead of collapsing into a solid line.
				const dash = dashArrayFor(plotline.lineStyle, trackWidth);
				if (dash) line.setAttribute('stroke-dasharray', dash);
				if (needsRoundCap(plotline.lineStyle)) line.setAttribute('stroke-linecap', 'round');
				threadEl = line;
			}
			this.laneGroup!.appendChild(threadEl);

			// Right-click → track color. Skipped for the synthetic Unsorted
			// lane (plotline.id === '') — it has no persisted Plotline record.
			if (plotline.id) {
				threadEl.addEventListener('contextmenu', (e: MouseEvent) => {
					e.preventDefault();
					e.stopPropagation();
					this.showTrackContextMenu(e, plotline, threadEl);
				});
			}

			if (track.labelAnchor) {
				const nameAt = makeSvg('g', { transform: `translate(${track.labelAnchor.x},${track.labelAnchor.y})` });
				const name = makeSvg('text', {
					class: 'sg-tl-track-name',
					'data-track-id': track.trackId,
					'text-anchor': horizontal ? 'end' : 'middle',
					x: '0',
					y: String(horizontal ? 4 : -4),
				});
				(name as SVGElement).style.transform = kTransform;
				// Solid, not the gradient: small text reads worse under a fade,
				// and it keeps the name matched to its own lane.
				(name as SVGElement).style.fill = solidFromColor(plotline.color);
				name.textContent = plotline.name;
				if (crowded.has('track:' + track.trackId)) name.classList.add('is-crowded');
				if (plotline.id) {
					(name as SVGElement).addEventListener('contextmenu', (e: MouseEvent) => {
						e.preventDefault();
						e.stopPropagation();
						this.showTrackContextMenu(e, plotline, name);
					});
				}
				nameAt.appendChild(name);
				this.laneGroup!.appendChild(nameAt);
			}
		});

		// 4 · Spans (start + end date): a thick bar in the event's colour, a
		// smaller end badge, and the full badge (icon + name) at the start.
		// Same 'sg-tl-node' class as point badges, so tap resolution's
		// `closest('.sg-tl-node')` and the contextmenu fallback work unchanged.
		const barVisible = (rect: LayoutRect): boolean => {
			const alongStart = horizontal ? rect.x : rect.y;
			const alongLen = horizontal ? rect.width : rect.height;
			const dayStart = alongStart / spec.pxPerDay;
			const dayEnd = (alongStart + alongLen) / spec.pxPerDay;
			return dayEnd >= start && dayStart <= end;
		};
		for (const b of layout.bars) {
			if (!barVisible(b.rect)) continue;
			const evt = eventById.get(b.eventId);
			if (!evt) continue;
			const g = makeSvg('g', {
				class: 'sg-tl-node sg-tl-node--bar' + (evt.id === this.hoveredId ? ' is-hovered' : '') + (evt.id === this.activeEventId ? ' is-active' : ''),
				'data-id': evt.id,
			}) as SVGGElement;
			const rect = makeSvg('rect', {
				class: 'sg-tl-bar-rect',
				x: String(b.rect.x), y: String(b.rect.y),
				width: String(b.rect.width), height: String(b.rect.height),
			}) as SVGRectElement;
			rect.style.fill = fillOf(evt.id);
			g.appendChild(rect);
			if (Platform.isMobile) {
				// The bar itself is ~9px thick — give a finger a 48px-wide target along its whole length.
				const grow = Math.max(0, 2 * TOUCH_HIT_RADIUS - (horizontal ? b.rect.height : b.rect.width)) / 2;
				const hit = makeSvg('rect', {
					class: 'sg-tl-node-hit',
					x: String(horizontal ? b.rect.x : b.rect.x - grow), y: String(horizontal ? b.rect.y - grow : b.rect.y),
					width: String(horizontal ? b.rect.width : b.rect.width + 2 * grow), height: String(horizontal ? b.rect.height + 2 * grow : b.rect.height),
				}) as SVGRectElement;
				g.appendChild(hit);
			}
			if (b.ongoing) paintArrow(g, b.endCenter, horizontal ? b.rect.height : b.rect.width, evt);
			else paintBadge(g, b.endCenter, b.endRadius, evt, false);
			paintLabel(paintBadge(g, b.startCenter, b.startRadius, evt, true), evt, b.startCenter);
			wireNode(g, evt);
			this.nodeGroup.appendChild(g);
		}

		// 5 · Moments: one badge each, with its name nested inside so the
		// hover/active CSS reaches both.
		for (const m of layout.markers) {
			if (!visible(m.center)) continue;
			const evt = eventById.get(m.eventId);
			if (!evt) continue;
			const g = makeSvg('g', {
				class: 'sg-tl-node' + (evt.id === this.hoveredId ? ' is-hovered' : '') + (evt.id === this.activeEventId ? ' is-active' : ''),
				'data-id': evt.id,
			}) as SVGGElement;
			paintLabel(paintBadge(g, m.center, m.radius, evt, true), evt, m.center);
			wireNode(g, evt);
			this.nodeGroup.appendChild(g);
		}
		this.renderPinnedTrackNames();

		// A tapped card follows its badge through zoom buttons, fit, appearance
		// changes and vault refreshes — or closes if the badge is gone/off-screen.
		if (this.cardEl && this.cardPinned) {
			const evt = this.cardEventId ? eventById.get(this.cardEventId) : undefined;
			const era = this.cardEventId ? this.eras.find((e) => e.id === this.cardEventId) : undefined;
			if (evt && this.nodeGroup.querySelector(`.sg-tl-node[data-id="${CSS.escape(evt.id)}"]`)) this.showEventCard(evt, true);
			else if (era && this.eraCardAnchor(era.id)) this.showEventCard(era, true);
			else this.hideEventCard();
		}
	}

	/**
	 * Ghost-content empty state, mirroring the Social Maps no-connections
	 * states (rel-graph-view.ts renderNoConnectionsState): a faded miniature
	 * of what the view becomes — two plotline threads over a ticked axis —
	 * plus the two sheet fields that feed it. Unlike the siblings' "Open the
	 * Codex" hand-off, the CTA resolves the emptiness in place: it opens the
	 * existing add-event popover, and the created event's dot replaces this
	 * overlay on the refresh() that follows.
	 */
	private syncEmptyState(): void {
		if (!isTimelineEmpty(this.events.length + this.eras.length, this.undatedEvents.length)) {
			this.emptyStateEl?.remove();
			this.emptyStateEl = null;
			return;
		}
		if (this.emptyStateEl || !this.wrapEl) return;

		const wrap = this.wrapEl.createDiv({ cls: 'sg-tl-empty' });
		this.emptyStateEl = wrap;

		const ghost = makeSvg('svg', { class: 'sg-tl-ghost-svg sg-ghost', viewBox: '0 0 220 120' }) as SVGSVGElement;
		const lanes: Array<{ y: number; xs: number[] }> = [
			{ y: 38, xs: [40, 110, 180] },
			{ y: 72, xs: [75, 145] },
		];
		for (const lane of lanes) {
			ghost.appendChild(makeSvg('line', {
				x1: String(lane.xs[0]), y1: String(lane.y),
				x2: String(lane.xs[lane.xs.length - 1]), y2: String(lane.y),
				stroke: 'currentColor', 'stroke-width': '1.5',
			}));
			for (const x of lane.xs) {
				ghost.appendChild(makeSvg('circle', { cx: String(x), cy: String(lane.y), r: '5', fill: 'currentColor' }));
			}
		}
		ghost.appendChild(makeSvg('line', { x1: '16', y1: '102', x2: '204', y2: '102', stroke: 'currentColor', 'stroke-width': '1' }));
		for (const x of [40, 110, 180]) {
			ghost.appendChild(makeSvg('line', { x1: String(x), y1: '102', x2: String(x), y2: '108', stroke: 'currentColor', 'stroke-width': '1' }));
		}
		wrap.appendChild(ghost);

		wrap.createEl('h3', { text: t('timeline.empty.title') });
		wrap.createEl('p', { cls: 'sg-tl-empty-body', text: t('timeline.empty.body') });
		const hints = wrap.createDiv({ cls: 'sg-tl-empty-hints' });
		hints.createSpan({ cls: 'sg-tl-empty-hint', text: t('timeline.empty.hintEvent') });
		hints.createSpan({ cls: 'sg-tl-empty-hint', text: t('timeline.empty.hintCharacter') });

		const btn = wrap.createEl('button', { cls: 'sg-tl-empty-cta', text: t('timeline.empty.cta') });
		btn.addEventListener('click', () => this.openAddEventSheet());
	}

	/**
	 * Compact strip docked at the bottom edge of the view, outside the SVG —
	 * so it stays put across both orientations and can later become a
	 * drag-and-drop target with no rework. Hidden entirely with no undated
	 * events; refreshed in the same cycle as the dots (renderLanesAndNodes).
	 */
	private renderShelf(): void {
		const root = this.host.querySelector('.sg-tl-root');
		if (!root) return;

		if (this.undatedEvents.length === 0) {
			this.shelfEl?.remove();
			this.shelfEl = null;
			return;
		}

		if (!this.shelfEl) this.shelfEl = root.createDiv({ cls: 'sg-tl-shelf' });
		const shelf = this.shelfEl;
		shelf.empty();

		shelf.createDiv({
			cls: 'sg-tl-shelf-header',
			text: t('timeline.shelf.label', { count: this.undatedEvents.length }),
		});

		const chips = shelf.createDiv({ cls: 'sg-tl-shelf-chips' });
		const sorted = [...this.undatedEvents].sort((a, b) => a.notePath.localeCompare(b.notePath));
		for (const evt of sorted) {
			const display = this.data().eventDisplay[evt.notePath];
			const color = display?.color ?? 'var(--text-muted)';

			const chip = chips.createEl('button', {
				cls: 'sg-tl-shelf-chip' + (evt.notePath === this.activeUndatedPath ? ' is-active' : ''),
			});
			const dot = chip.createSpan({ cls: 'sg-tl-shelf-chip-dot' });
			dot.style.background = color;
			chip.createSpan({ cls: 'sg-tl-shelf-chip-label', text: truncate(evt.name, NODE_LABEL_MAX) });
			chip.addEventListener('click', () => this.selectUndated(evt));
			chip.addEventListener('contextmenu', (e: MouseEvent) => {
				e.preventDefault();
				this.showEventContextMenu(e, evt.file, false, chip);
			});
		}
	}

	private setHovered(id: string | null): void {
		if (this.hoveredId === id) return;
		this.hoveredId = id;
		this.nodeGroup?.querySelectorAll('.sg-tl-node').forEach((el) => {
			const isHovered = el.getAttribute('data-id') === id;
			el.classList.toggle('is-hovered', isHovered);
			// Badges paint their ring inline (see paintBadge for why), and
			// inline beats any stylesheet rule — so the accent highlight is
			// applied the same way instead of through .is-hovered CSS. Falls
			// back to the stashed ring colour, or keeps the accent if this node
			// is the selected one. A span has two badges; both light up.
			const lit = isHovered || el.getAttribute('data-id') === this.activeEventId;
			el.querySelectorAll<SVGCircleElement>('.sg-tl-node-badge').forEach((disc) => {
				disc.style.stroke = lit ? 'var(--interactive-accent)' : disc.dataset.sgPaint ?? '';
				const ringWidth = Number(disc.dataset.sgRing) || 2;
				disc.style.strokeWidth = `${lit ? ringWidth + 0.5 : ringWidth}px`;
			});
		});
	}

	// ── Selection, sidebar preview, event card & context menu ──────────────────
	// Clicking an event shows its sheet in the writer sidebar, like Social Maps
	// does. A small card also answers "what is this?" in place: on hover with
	// a mouse, or on tap on a phone — where it carries the button that opens
	// the sheet, because jumping straight to the sidebar drawer on every tap
	// hid the timeline.

	/** Tap/click on a dated badge: select it and (by default) preview its sheet in the sidebar. */
	private selectEvent(evt: TimelineEvent, preview = true): void {
		this.activeEventId = evt.id;
		this.activeUndatedPath = null;
		this.renderLanesAndNodes();
		if (preview) this.previewInSidebar(evt.notePath);
	}

	/** Tap/click on an Undated-shelf chip: same, keyed by note path. */
	private selectUndated(evt: UndatedTimelineEvent): void {
		this.hideEventCard();
		this.activeUndatedPath = evt.notePath;
		this.activeEventId = null;
		this.renderLanesAndNodes();
		this.previewInSidebar(evt.notePath);
	}

	private clearSelection(): void {
		this.hideEventCard();
		if (this.activeEventId === null && this.activeUndatedPath === null) return;
		this.activeEventId = null;
		this.activeUndatedPath = null;
		this.renderLanesAndNodes();
	}

	/**
	 * The event card: name, date (or date range) in this project's calendar,
	 * and the first line of the sheet's description. Everything comes from
	 * data already in memory — the event list and metadataCache's frontmatter
	 * — so hovering never reads a file. `pinned` is the phone's tapped card:
	 * it takes pointer events and carries the "Open sheet" button; a hover
	 * card never takes the pointer, so it can't steal the hover that made it.
	 */
	private showEventCard(evt: TimelineEvent, pinned: boolean): void {
		this.hideEventCard();
		const wrap = this.wrapEl;
		if (!wrap) return;
		// A span has two badges; the card belongs to its start badge (the last
		// one painted). Measured on the disc itself — the badge group also holds
		// the name and, on phones, the bigger touch target.
		const badges = this.nodeGroup?.querySelectorAll(`.sg-tl-node[data-id="${CSS.escape(evt.id)}"] .sg-tl-node-badge`);
		// An era has no badge: its card sits beside the era's name (or its band's visible corner).
		const badge = evt.kind === 'era' ? null : badges && badges.length > 0 ? badges[badges.length - 1] : null;
		const anchorRect = evt.kind === 'era' ? this.eraCardAnchor(evt.id) : badge?.getBoundingClientRect();
		if (!anchorRect) return;

		const card = wrap.createDiv({ cls: 'sg-tl-card' + (pinned ? ' is-pinned' : '') });
		card.createDiv({ cls: 'sg-tl-card-title', text: evt.name });
		const cal = this.data().calendar;
		// A span ending on its start day is drawn as one badge, so it reads as one date too.
		const isSpan = !!evt.end && storyDateToAbsoluteDay(cal, evt.end) > storyDateToAbsoluteDay(cal, evt.date);
		const when = isSpan && evt.end
			? t('timeline.card.range', { start: formatStoryDate(cal, evt.date), end: formatStoryDate(cal, evt.end) })
			: formatStoryDate(cal, evt.date);
		card.createDiv({ cls: 'sg-tl-card-date', text: when });
		const present = evt.ongoing ? storyPresent(cal, this.data().sceneDates ?? {}, this.events) : undefined;
		if (present && this.isDrawnOngoing(evt, present.day)) {
			card.createDiv({ cls: 'sg-tl-card-date', text: t('timeline.card.ongoing', { date: formatStoryDate(cal, present.date) }) });
		}
		if (evt.kind === 'event' || evt.kind === 'era') {
			const summary = eventSummaryFromFrontmatter(this.app.metadataCache.getFileCache(evt.file)?.frontmatter);
			if (summary) card.createDiv({ cls: 'sg-tl-card-summary', text: summary });
		}
		if (pinned) {
			const open = card.createEl('button', { cls: 'sg-tl-card-open' });
			setPhosphorIcon(open.createSpan(), 'file-text', '');
			open.createSpan({ text: t('timeline.editor.openSheet') });
			open.addEventListener('click', (e) => {
				e.stopPropagation();
				this.hideEventCard();
				this.previewInSidebar(evt.notePath);
			});
		}
		this.cardEl = card;
		this.cardPinned = pinned;
		this.cardEventId = evt.id;
		this.showEventGuide(evt);

		// Beside the badge (right of it, or left when there is no room), kept inside the view.
		const w = wrap.getBoundingClientRect();
		const b = anchorRect;
		const gap = 10;
		const cw = card.offsetWidth;
		const ch = card.offsetHeight;
		let left = b.right - w.left + gap;
		if (left + cw > w.width - 8) left = b.left - w.left - gap - cw;
		left = Math.max(8, Math.min(left, w.width - cw - 8));
		const top = Math.max(8, Math.min(b.top - w.top + b.height / 2 - ch / 2, w.height - ch - 8));
		card.style.left = `${left}px`;
		card.style.top = `${top}px`;
	}

	/** Draws the date guide for an event (see guideLineGroup). Called once the card is up. */
	private showEventGuide(evt: TimelineEvent): void {
		this.hideEventGuide();
		const anchor = this.guideAnchors.get(evt.id);
		const lines = this.guideLineGroup;
		const tags = this.guideTagGroup;
		if (!anchor || !lines || !tags) return;
		const horizontal = this.orientation === 'horizontal';
		const kTransform = counterScale(horizontal);
		const cal = this.data().calendar;
		const startText = formatStoryDate(cal, evt.date);
		let endText: string | undefined;
		if (anchor.end) {
			const present = evt.ongoing ? storyPresent(cal, this.data().sceneDates ?? {}, this.events) : undefined;
			let endDate = present?.date ?? evt.end;
			if (evt.kind === 'era' && !evt.end && !(present && this.isDrawnOngoing(evt, present.day))) {
				// No present past its start: the band stops at the end of its first year — say that day.
				const span = this.eraSpans().find((x) => x.era.id === evt.id);
				endDate = span ? absoluteDayToStoryDate(cal, span.endDay - 1) : undefined;
			}
			endText = endDate ? formatStoryDate(cal, endDate) : undefined;
		}
		const alongOf = (p: LayoutPoint): number => (horizontal ? p.x : p.y);
		const acrossOf = (p: LayoutPoint): number => (horizontal ? p.y : p.x);
		const onLine = (p: LayoutPoint): LayoutPoint => (horizontal ? { x: p.x, y: 0 } : { x: 0, y: p.y });
		const spineHalf = this.appearance().spineWidth / 2;
		const TAG_H = 20;
		// The year labels sit ON the main line and are painted above the
		// camera's layers — start the tag past one so it is never hidden.
		const chip = this.axisGroup?.querySelector('.sg-tl-year-chip-bg')?.getBoundingClientRect();
		const chipHalf = chip ? (horizontal ? chip.height : chip.width) / 2 : 0;
		const gap = Math.max(spineHalf, chipHalf) + 6;
		// A short bar's two dates would sit on top of each other: one tag, "start to end".
		const endTooClose = anchor.end && Math.abs(alongOf(anchor.end) - alongOf(anchor.start)) * this.scale < (horizontal ? 160 : TAG_H + 6);

		const guide = (p: LayoutPoint, text: string, color: string, colorEnd: 'first' | 'last' = 'first'): void => {
			// A gradient's own colour at this end of the bar (it runs along time).
			const solid = solidFromColor(color, colorEnd);
			const foot = onLine(p);
			const line = makeSvg('line', { class: 'sg-tl-guide-line', x1: String(p.x), y1: String(p.y), x2: String(foot.x), y2: String(foot.y) }) as SVGLineElement;
			line.setAttribute('vector-effect', 'non-scaling-stroke');
			line.style.stroke = solid;
			lines.appendChild(line);

			// Dot + date tag share one counter-scaled group at the foot, so
			// inside it every coordinate is plain screen px.
			const at = makeSvg('g', { transform: `translate(${foot.x},${foot.y})` }) as SVGGElement;
			const k = makeSvg('g', { class: 'sg-tl-guide-tag' }) as SVGGElement;
			k.style.transform = kTransform;
			const dot = makeSvg('circle', { class: 'sg-tl-guide-dot', cx: '0', cy: '0', r: '4.5' }) as SVGCircleElement;
			dot.style.fill = solid;
			k.appendChild(dot);
			// The tag goes on the OTHER side of the main line from the event, so
			// it never sits on the line it explains.
			const side = acrossOf(p) < 0 ? 1 : -1;
			const label = makeSvg('text', { class: 'sg-tl-guide-text', 'dominant-baseline': 'central' }) as SVGTextElement;
			label.textContent = text;
			const bg = makeSvg('rect', { class: 'sg-tl-guide-bg', rx: '6', ry: '6', height: String(TAG_H) }) as SVGRectElement;
			bg.style.stroke = solid;
			k.appendChild(bg);
			k.appendChild(label);
			at.appendChild(k);
			tags.appendChild(at);
			// A view drawn while hidden measures text as 0 — estimate instead of a 14px sliver.
			const measured = label.getComputedTextLength();
			const width = Math.ceil(measured > 0 ? measured : text.length * 7) + 14;
			let x: number;
			let y: number;
			if (horizontal) {
				x = -width / 2;
				y = side < 0 ? -gap - TAG_H : gap;
			} else {
				x = side < 0 ? -gap - width : gap;
				y = -TAG_H / 2;
			}
			bg.setAttribute('x', String(x));
			bg.setAttribute('y', String(y));
			bg.setAttribute('width', String(width));
			label.setAttribute('x', String(x + 7));
			label.setAttribute('y', String(y + TAG_H / 2));
		};

		if (anchor.end && endText && endTooClose) {
			guide(anchor.start, t('timeline.card.range', { start: startText, end: endText }), anchor.color);
			return;
		}
		guide(anchor.start, startText, anchor.color);
		if (anchor.end && endText) guide(anchor.end, endText, anchor.color, 'last');
	}

	private hideEventGuide(): void {
		this.guideLineGroup?.empty();
		this.guideTagGroup?.empty();
	}

	private hideEventCard(): void {
		this.hideEventGuide();
		this.cardEl?.remove();
		this.cardEl = null;
		this.cardPinned = false;
		this.cardEventId = null;
	}

	/**
	 * Show the Event sheet in the Writers Panel's World tab — the exact
	 * Social Maps flow (rel-graph-view.ts previewNode): reveal the panel,
	 * push the entity onto its preview stack. Never navigates away from
	 * the timeline.
	 */
	private previewInSidebar(notePath: string): void {
		void (async () => {
			const view = await this.plugin.revealOutline();
			if (view) await view.showEntityPreview(this.ctrlHost.getProjectRoot(), notePath);
		})();
	}

	/**
	 * Right-click / long-press menu on a dot, bar, or shelf chip — the grid
	 * cards' pattern. Carries the retired info card's actions; A5 adds
	 * "Edit event…" and "Change color…" here. `event` is the TimelineEvent
	 * behind a dated dot/bar — undefined for an Undated-shelf chip, and only
	 * consulted (for the End Date items) on genuine Event sheets, never on a
	 * character's born/died dot.
	 */
	private showEventContextMenu(e: MouseEvent, file: TFile, dated: boolean, anchor: Element, event?: TimelineEvent): void {
		if (event?.kind === 'era') {
			this.showEraContextMenu(e, event, anchor);
			return;
		}
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle(t('timeline.editor.menuEdit'))
			.setIcon('pencil')
			.onClick(() => void this.openEventEditor(file)));
		menu.addItem((item) => item
			.setTitle(t('timeline.editor.menuColor'))
			.setIcon('palette')
			.onClick(() => this.openEventColorPicker(anchor, file.path)));
		// Only for something actually drawn on the timeline: an Undated-shelf
		// chip has no marker to resize (or paint a glyph on), so offering
		// these controls there would visibly do nothing. A bar exists only
		// once the event has an end date; everything else (including a
		// character's born/died dot) is a point.
		if (dated) {
			menu.addItem((item) => item
				.setTitle(t('timeline.editor.menuIcon'))
				.setIcon('image')
				.onClick(() => this.openEventIconPopover(anchor, file.path)));
			menu.addItem((item) => item
				.setTitle(t('timeline.editor.menuSize'))
				.setIcon('ruler')
				.onClick(() => this.openEventSizePopover(anchor, file.path, !!event?.end || (!!event && this.isDrawnOngoing(event, this.presentDay())))));
		}
		menu.addSeparator();
		if (dated) {
			menu.addItem((item) => item
				.setTitle(t('timeline.info.removeDate'))
				.setIcon('calendar-x')
				.onClick(() => void this.clearEventDate(file)));
			if (event && event.kind === 'event') {
				if (event.end) {
					menu.addItem((item) => item
						.setTitle(t('timeline.info.removeEndDate'))
						.setIcon('calendar-x')
						.onClick(() => void this.clearEventEndDate(file)));
				} else {
					menu.addItem((item) => item
						.setTitle(t('timeline.info.setEndDate'))
						.setIcon('calendar-plus')
						.onClick(() => this.openSetEndDatePopover(anchor, file, event.date)));
				}
			}
		} else {
			menu.addItem((item) => item
				.setTitle(t('timeline.info.setDate'))
				.setIcon('calendar')
				.onClick(() => this.openSetDatePopover(anchor, file)));
		}
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle(t('timeline.info.openNote'))
			.setIcon('file-text')
			.onClick(() => void openOrReveal(this.app, file)));
		menu.showAtMouseEvent(e);
	}

	// ── Event editor side panel (A5) ──────────────────────────────────────────
	// Desktop: right-side slide-in inside the timeline view; mobile: bottom
	// sheet. The grid card editor's sibling — same label/field/toolbar atoms
	// (sg-panel-*, sg-md-toolbar), timeline-scoped container classes
	// (sg-tl-editor-*). COMMIT STRATEGY: every field writes through the
	// entity-write machinery on blur/Enter/close, never per keystroke — event
	// sheets are watched vault files and the timeline's refresh() debounce
	// absorbs each commit's metadata event without touching this panel.

	/**
	 * An era's menu: the event menu's own words where they apply, without the
	 * badge-only Icon and Size. Its End Date items keep it an era (they never
	 * touch How Long — see updateEventEndDateField).
	 */
	private showEraContextMenu(e: MouseEvent, era: TimelineEvent, anchor: Element): void {
		const file = era.file;
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle(t('timeline.editor.menuEditEra'))
			.setIcon('pencil')
			.onClick(() => void this.openEventEditor(file)));
		menu.addItem((item) => item
			.setTitle(t('timeline.editor.menuColor'))
			.setIcon('palette')
			.onClick(() => this.openEventColorPicker(anchor, file.path)));
		menu.addSeparator();
		if (era.end) {
			menu.addItem((item) => item
				.setTitle(t('timeline.info.removeEndDate'))
				.setIcon('calendar-x')
				.onClick(() => void this.clearEventEndDate(file)));
		} else {
			menu.addItem((item) => item
				.setTitle(t('timeline.info.setEndDate'))
				.setIcon('calendar-plus')
				.onClick(() => this.openSetEndDatePopover(anchor, file, era.date)));
		}
		menu.addItem((item) => item
			.setTitle(t('timeline.info.removeDate'))
			.setIcon('calendar-x')
			.onClick(() => void this.clearEventDate(file)));
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle(t('timeline.info.openNote'))
			.setIcon('file-text')
			.onClick(() => void openOrReveal(this.app, file)));
		menu.showAtMouseEvent(e);
	}

	/** eventDisplay color, falling back to the plotline's — the same rule the painter uses. An era's is its sheet's Color (eraColor). */
	private displayColor(notePath: string): string {
		const era = this.eras.find((x) => x.notePath === notePath);
		if (era) return this.eraColor(era);
		return this.data().eventDisplay[notePath]?.color ?? this.resolvePlotline(notePath).color;
	}

	/**
	 * An era's colour lives on its sheet (its Color field), so the Codex, the
	 * sheet and the band always agree. A colour this timeline kept for the
	 * sheet from its event days is cleared in the same step, so there is only
	 * ever one.
	 */
	private async writeEraColor(era: TimelineEvent, color: string): Promise<void> {
		try {
			await this.writeSheetTextField(era.file, 'Color', 'color', color);
			if (this.data().eventDisplay[era.notePath]?.color !== undefined) {
				this.ctrlHost.mutate((d) => {
					const { color: _drop, ...rest } = d.eventDisplay[era.notePath] ?? {};
					void _drop;
					return { ...d, eventDisplay: { ...d.eventDisplay, [era.notePath]: rest } };
				});
			}
		} catch (err) {
			new Notice(t('timeline.editor.saveFailed', { msg: err instanceof Error ? err.message : '' }));
		}
	}

	/** Context menu's "Change color…" and the panel's swatch share this picker. */
	private openEventColorPicker(anchor: Element, notePath: string, onCommit?: (c: string) => void): void {
		const era = this.eras.find((x) => x.notePath === notePath);
		ColorPickerPopover.show(anchor as HTMLElement, {
			currentColor: this.displayColor(notePath),
			palettes: this.plugin.settings.colorPalettes,
			activePaletteId: this.plugin.settings.activeColorPaletteId,
			savedColors: this.plugin.settings.savedColors ?? [],
			onSaveColor: (c) => this.saveColor(c),
			onRemoveSaved: (c) => this.removeSavedColor(c),
			onCommit: (c) => {
				if (era) {
					// The band repaints from the sheet once Obsidian has read the new Color.
					void this.writeEraColor(era, c);
					onCommit?.(c);
					return;
				}
				this.ctrlHost.mutate((d) => ({
					...d,
					eventDisplay: { ...d.eventDisplay, [notePath]: { ...d.eventDisplay[notePath], color: c } },
				}));
				this.renderLanesAndNodes();
				onCommit?.(c);
			},
		});
	}

	// ── Track & spine color ────────────────────────────────────────────
	// Same picker/menu pattern as event colors above, scoped to a track's
	// Plotline.color or the spine's viewSettings.appearance.spineColor.

	/** Right-click on a solid-style track's thread or its name — the track equivalent of showEventContextMenu. Never wired for the synthetic Unsorted lane (see the call sites' plotline.id guard). */
	private showTrackContextMenu(e: MouseEvent, plotline: Plotline, anchor: Element): void {
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle(t('timeline.editor.menuColor'))
			.setIcon('palette')
			.onClick(() => this.openTrackColorPicker(anchor, plotline.id)));
		menu.showAtMouseEvent(e);
	}

	/** Looks the plotline up fresh by id (rather than trusting the closed-over `plotline` from render time) so a color picked a moment after a plotline edit still writes to the right, current record. */
	private openTrackColorPicker(anchor: Element, plotlineId: string): void {
		const plotline = this.data().plotlines.find((p) => p.id === plotlineId);
		if (!plotline) return;
		ColorPickerPopover.show(anchor as HTMLElement, {
			currentColor: plotline.color,
			palettes: this.plugin.settings.colorPalettes,
			activePaletteId: this.plugin.settings.activeColorPaletteId,
			savedColors: this.plugin.settings.savedColors ?? [],
			onSaveColor: (c) => this.saveColor(c),
			onRemoveSaved: (c) => this.removeSavedColor(c),
			onCommit: (c) => this.updatePlotline(plotlineId, { color: c }),
		});
	}

	/** Right-click on the spine's <rect>. "Use default" deletes the override key outright (see clearSpineColor) rather than writing the resolved color back — a later plugin-global default change should still reach a "reset" timeline. */
	private showSpineContextMenu(e: MouseEvent, anchor: Element): void {
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle(t('timeline.editor.menuColor'))
			.setIcon('palette')
			.onClick(() => this.openSpineColorPicker(anchor)));
		menu.addItem((item) => item
			.setTitle(t('timeline.spine.useDefault'))
			.setIcon('rotate-ccw')
			.onClick(() => this.clearSpineColor()));
		menu.showAtMouseEvent(e);
	}

	private openSpineColorPicker(anchor: Element): void {
		// No override yet: show the picker the color it's actually rendering
		// right now (styles.css's resolved `var(--text-faint)`) rather than a
		// second hardcoded hex duplicating that rule.
		const computedFallback = (this.spineEl?.isConnected ? getComputedStyle(this.spineEl).fill : '') || '#888888';
		const current = this.appearance().spineColor ?? computedFallback;
		ColorPickerPopover.show(anchor as HTMLElement, {
			currentColor: current,
			palettes: this.plugin.settings.colorPalettes,
			activePaletteId: this.plugin.settings.activeColorPaletteId,
			savedColors: this.plugin.settings.savedColors ?? [],
			onSaveColor: (c) => this.saveColor(c),
			onRemoveSaved: (c) => this.removeSavedColor(c),
			onCommit: (c) => this.setSpineColor(c),
		});
	}

	/** Sparse-patches viewSettings.appearance.spineColor through the same seam setAppearance() uses for the Appearance sliders. */
	private setSpineColor(color: string): void {
		this.ctrlHost.mutate((d) => ({
			...d,
			viewSettings: { ...d.viewSettings, appearance: { ...d.viewSettings.appearance, spineColor: color } },
		}));
		this.scheduleAppearanceRepaint();
	}

	/** "Use default": deletes the key rather than writing the resolved default back — see resetAppearance()'s identical reasoning for the whole appearance block. */
	private clearSpineColor(): void {
		this.ctrlHost.mutate((d) => {
			const appearance = d.viewSettings.appearance;
			if (!appearance || appearance.spineColor === undefined) return d;
			const { spineColor: _spineColor, ...rest } = appearance;
			return { ...d, viewSettings: { ...d.viewSettings, appearance: rest } };
		});
		this.scheduleAppearanceRepaint();
	}

	/**
	 * Sparse-patches one per-event size override through the standard
	 * mutate seam, then repaints via the same throttled path the Appearance
	 * sliders use (scheduleAppearanceRepaint) — never renderLanesAndNodes()
	 * called directly here, since a slider drag fires many of these per
	 * second and this popover/the event editor panel must survive the
	 * repaint unmolested.
	 */
	private setEventSize(notePath: string, key: 'markerSize' | 'barThickness', value: number): void {
		this.ctrlHost.mutate((d) => ({
			...d,
			eventDisplay: { ...d.eventDisplay, [notePath]: { ...d.eventDisplay[notePath], [key]: value } },
		}));
		this.scheduleAppearanceRepaint();
	}

	/** Clears one size override back to "follow the default" — deletes the key rather than writing the resolved default value, so a later change to the default/appearance sliders still reaches this event. */
	private clearEventSize(notePath: string, key: 'markerSize' | 'barThickness'): void {
		this.ctrlHost.mutate((d) => {
			const existing = d.eventDisplay[notePath];
			if (!existing || existing[key] === undefined) return d;
			const next = { ...existing };
			delete next[key];
			return { ...d, eventDisplay: { ...d.eventDisplay, [notePath]: next } };
		});
		this.scheduleAppearanceRepaint();
	}

	/** Sparse-patches one B4 per-event icon override through the standard mutate seam — same shape as setEventSize. `value` is the prefixed stored form, e.g. phosphorIconValue('sword'). */
	private setEventIcon(notePath: string, value: string): void {
		this.ctrlHost.mutate((d) => ({
			...d,
			eventDisplay: { ...d.eventDisplay, [notePath]: { ...d.eventDisplay[notePath], icon: value } },
		}));
		this.scheduleAppearanceRepaint();
	}

	/** "No icon": deletes the key rather than writing an empty string, mirroring clearEventSize — so this event keeps following its track's icon (or none) if that later changes. */
	private clearEventIcon(notePath: string): void {
		this.ctrlHost.mutate((d) => {
			const existing = d.eventDisplay[notePath];
			if (!existing || existing.icon === undefined) return d;
			const next = { ...existing };
			delete next.icon;
			return { ...d, eventDisplay: { ...d.eventDisplay, [notePath]: next } };
		});
		this.scheduleAppearanceRepaint();
	}

	/**
	 * Context menu's "Size…" and the A5 panel's size row share this popover —
	 * mirrors openDatePopover's shape (sg-tl-add-popover container, so the
	 * event editor's and appearance panel's own Escape guards leave it alone)
	 * but reuses the Appearance panel's own slider-row atoms
	 * (sg-tl-appearance-*) since this is the exact same kind of control.
	 * Shows ONE slider — marker size for a point, bar thickness for a bar —
	 * never both, per the "an event is either a dot or a bar" rule.
	 */
	private openEventSizePopover(anchor: Element, notePath: string, isBar: boolean): void {
		const existing = this.host.doc.querySelector('.sg-tl-add-popover');
		existing?.remove();

		const key: 'markerSize' | 'barThickness' = isBar ? 'barThickness' : 'markerSize';
		const limit = APPEARANCE_LIMITS[key];
		const appearanceDefault = this.appearance()[key];

		const popover = this.host.doc.body.createDiv({ cls: 'sg-tl-add-popover' });
		popover.createDiv({ cls: 'sg-tl-add-title', text: t('timeline.size.title') });

		const row = popover.createDiv({ cls: 'sg-tl-appearance-row' });
		const labelRow = row.createDiv({ cls: 'sg-tl-appearance-label-row' });
		labelRow.createSpan({ cls: 'sg-tl-appearance-label', text: t(isBar ? 'timeline.size.bar' : 'timeline.size.marker') });
		const valueEl = labelRow.createSpan({ cls: 'sg-tl-appearance-value' });
		const currentValue = (): number => this.data().eventDisplay[notePath]?.[key] ?? appearanceDefault;
		valueEl.setText(String(currentValue()));
		const slider = row.createEl('input', { cls: 'sg-tl-appearance-slider', type: 'range' });
		slider.min = String(limit.min);
		slider.max = String(limit.max);
		slider.step = String(limit.step);
		slider.value = String(currentValue());
		slider.addEventListener('input', () => {
			const value = Number(slider.value);
			valueEl.setText(String(value));
			this.setEventSize(notePath, key, value);
		});

		const resetBtn = popover.createEl('button', { cls: 'sg-tl-editor-quiet-btn', text: t('timeline.size.reset') });
		resetBtn.addEventListener('click', () => {
			this.clearEventSize(notePath, key);
			slider.value = String(appearanceDefault);
			valueEl.setText(String(appearanceDefault));
		});

		const onDocClick = (e: MouseEvent) => {
			if (!popover.contains(e.target as Node) && e.target !== anchor) close();
		};
		const close = () => {
			popover.remove();
			this.host.doc.removeEventListener('click', onDocClick, { capture: true });
			this.closeAddPopover = null;
		};
		this.closeAddPopover = close;

		this.positionPopover(popover, anchor);
		window.setTimeout(() => this.host.doc.addEventListener('click', onDocClick, { capture: true }), 0);
	}

	/**
	 * Searchable icon picker (B4) — shared by the context menu's "Icon…", the
	 * A5 panel's icon row, AND the Tracks panel's per-track icon button, which
	 * is why it takes a plain `onSelect` callback rather than writing to
	 * eventDisplay itself the way openEventColorPicker/openEventSizePopover
	 * do: a track's icon lives on Plotline, not EventDisplay, so there's no
	 * one notePath this function could always write to. `currentValue` is the
	 * raw stored value (e.g. "phosphor:sword" or undefined) being edited —
	 * NOT the resolved/fallback value, so the picker highlights exactly what
	 * this event or track has explicitly set, never a value it only inherits.
	 * Same popover shell as openEventSizePopover (sg-tl-add-popover, so the
	 * editor panel's and appearance panel's own Escape/outside-click guards
	 * leave it alone), with its own sg-tl-icon-* layout classes for the
	 * search box and scrolling grid.
	 */
	private openIconPicker(anchor: Element, currentValue: string | undefined, onSelect: (value: string | undefined) => void): void {
		const existing = this.host.doc.querySelector('.sg-tl-add-popover');
		existing?.remove();

		const selectedId = resolveEventIcon(currentValue, undefined)?.id;

		const popover = this.host.doc.body.createDiv({ cls: 'sg-tl-add-popover sg-tl-icon-popover' });
		popover.createDiv({ cls: 'sg-tl-add-title', text: t('timeline.icon.title') });

		const searchInput = popover.createEl('input', {
			type: 'text',
			cls: 'sg-tl-icon-search',
			attr: { placeholder: t('timeline.icon.searchPlaceholder') },
		});

		const noneBtn = popover.createEl('button', {
			cls: 'sg-tl-icon-none-btn' + (selectedId === undefined ? ' is-selected' : ''),
			text: t('timeline.icon.none'),
		});

		const grid = popover.createDiv({ cls: 'sg-tl-icon-grid' });

		const close = () => {
			popover.remove();
			this.host.doc.removeEventListener('click', onDocClick, { capture: true });
			this.closeAddPopover = null;
		};

		const renderGrid = (query: string) => {
			grid.empty();
			const q = query.trim().toLowerCase();
			const matches = q
				? EVENT_ICONS.filter((icon) => icon.id.includes(q) || icon.keywords.some((k) => k.includes(q)))
				: EVENT_ICONS;
			for (const icon of matches) {
				const btn = grid.createEl('button', {
					cls: 'sg-tl-icon-btn' + (icon.id === selectedId ? ' is-selected' : ''),
					attr: { 'aria-label': icon.id, title: icon.id },
				});
				const glyph = makeSvg('svg', { viewBox: '0 0 256 256' }) as SVGSVGElement;
				glyph.appendChild(makeSvg('path', { d: icon.path, fill: 'currentColor' }));
				btn.appendChild(glyph);
				btn.addEventListener('click', () => {
					onSelect(phosphorIconValue(icon.id));
					close();
				});
			}
			if (matches.length === 0) {
				grid.createDiv({ cls: 'sg-tl-icon-empty', text: t('timeline.icon.noResults', { query }) });
			}
		};
		renderGrid('');

		noneBtn.addEventListener('click', () => {
			onSelect(undefined);
			close();
		});

		searchInput.addEventListener('input', () => renderGrid(searchInput.value));

		const onDocClick = (e: MouseEvent) => {
			if (!popover.contains(e.target as Node) && e.target !== anchor) close();
		};
		this.closeAddPopover = close;

		this.positionPopover(popover, anchor);
		window.setTimeout(() => {
			this.host.doc.addEventListener('click', onDocClick, { capture: true });
			if (!Platform.isMobile) searchInput.focus();
		}, 0);
	}

	/** Context menu's "Icon…" and the A5 panel's icon row share this: reads/writes eventDisplay.icon through the standard seam, then hands off to the generic picker above. `onAfterChange` lets the panel repaint its own preview swatch after a selection (the canvas repaints itself via scheduleAppearanceRepaint regardless). */
	private openEventIconPopover(anchor: Element, notePath: string, onAfterChange?: () => void): void {
		this.openIconPicker(anchor, this.data().eventDisplay[notePath]?.icon, (value) => {
			if (value) this.setEventIcon(notePath, value);
			else this.clearEventIcon(notePath);
			onAfterChange?.();
		});
	}

	/**
	 * Write (or clear) one Event sheet text field through the same two-home
	 * machinery as the date writes: entity-body's applyFields for the sheet
	 * body (infobox row or prose section, appended when missing) and
	 * processFrontMatter for the frontmatter key. Never rebuilds the sheet.
	 */
	private async writeSheetTextField(file: TFile, label: string, type: 'text' | 'textarea' | 'color', value: string): Promise<void> {
		const key = slugForLabel(label);
		const write: CharacterField = { id: `timeline-${key}`, label, type, value };
		await this.app.vault.process(file, (content) => {
			const { frontmatter, body } = splitFrontmatter(content);
			return frontmatter + renderBody(applyFields(parseBody(body), [write], 'event'));
		});
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (value.trim()) fm[key] = toYamlValue(type, value);
			else delete fm[key];
		});
	}

	private closeEventEditor(commit: boolean, opts?: { instant?: boolean }): void {
		if (!this.editorEl) return;
		if (commit) this.editorFlush?.();
		this.editorFlush = null;
		this.editorFile = null;
		if (this.editorKeydownHandler) {
			this.host.doc.removeEventListener('keydown', this.editorKeydownHandler);
			this.editorKeydownHandler = null;
		}
		const el = this.editorEl;
		this.editorEl = null;
		if (opts?.instant) {
			el.remove();
		} else {
			// Let the slide-out transition play before the node goes away.
			el.removeClass('is-open');
			window.setTimeout(() => el.remove(), 260);
		}
	}

	/**
	 * Open (or retarget) the event editor panel for one Event sheet. Reads the
	 * sheet through the entity-parse machinery to prefill fields; opens ONLY
	 * from the context menu — single tap/click stays A3's sidebar preview, and
	 * the panel stays on its event until closed or another Edit is invoked.
	 */
	private async openEventEditor(file: TFile): Promise<void> {
		const root = this.host.querySelector('.sg-tl-root');
		if (!root) return;

		// Another event already open: commit its pending edits, then swap
		// content into the same panel (the grid pattern).
		if (this.editorEl) {
			this.editorFlush?.();
			this.editorFlush = null;
		}

		let content: string;
		try {
			content = await this.app.vault.read(file);
		} catch (err) {
			new Notice(t('timeline.editor.readFailed', { msg: err instanceof Error ? err.message : '' }));
			return;
		}
		const parsed = parseEntityDocument(content, file.basename);
		const fieldValue = (label: string): string =>
			parsed.fields.find((f) => f.label.trim().toLowerCase() === label.toLowerCase())?.value ?? '';

		const wasOpen = !!this.editorEl;
		if (!this.editorEl) {
			this.editorEl = root.createDiv({ cls: 'sg-tl-editor' });
			window.requestAnimationFrame(() => this.editorEl?.addClass('is-open'));
		}
		if (wasOpen) this.editorEl.addClass('is-open');
		this.editorFile = file;
		const panel = this.editorEl;
		panel.empty();

		// Escape closes — with the grid panel's stacked-layer guards, so a menu,
		// modal, color popover, or date popover above the panel keeps its Escape.
		if (this.editorKeydownHandler) this.host.doc.removeEventListener('keydown', this.editorKeydownHandler);
		this.editorKeydownHandler = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			if (this.host.doc.querySelector('.modal-container, .menu, .sg-color-popover, .sg-tl-add-popover')) return;
			this.closeEventEditor(true);
		};
		this.host.doc.addEventListener('keydown', this.editorKeydownHandler);

		// ── Header: editable title + close ──────────────────────────────────
		const header = panel.createDiv({ cls: 'sg-tl-editor-header' });
		const titleInput = header.createEl('input', {
			cls: 'sg-tl-editor-title',
			type: 'text',
			attr: { placeholder: t('timeline.editor.titlePlaceholder'), 'aria-label': t('timeline.editor.titlePlaceholder') },
		});
		titleInput.value = file.basename;
		let titleCommitted = file.basename;
		const commitTitle = () => {
			const name = titleInput.value.trim();
			if (!name || name === titleCommitted) { titleInput.value = titleCommitted; return; }
			const oldPath = file.path;
			void (async () => {
				try {
					if (await renameEntitySheet(this.app, file, name) === 'taken') {
						titleInput.value = titleCommitted;
						new Notice(t('codex.notice.nameTaken', { name }));
						return;
					}
					// Keep the .timeline's per-note data (color, plotline, scene
					// links) attached to the renamed note.
					this.ctrlHost.mutate((d) => remapTimelinePath(d, oldPath, file.path));
					titleCommitted = name;
					titleInput.value = name;
					this.refresh();
				} catch (err) {
					titleInput.value = titleCommitted;
					new Notice(t('timeline.editor.renameFailed', { msg: err instanceof Error ? err.message : '' }));
				}
			})();
		};
		titleInput.addEventListener('blur', commitTitle);
		titleInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
		});

		const closeBtn = header.createEl('button', { cls: 'sg-panel-close', attr: { 'aria-label': t('timeline.editor.closeAria') }, text: '×' });
		closeBtn.addEventListener('click', () => this.closeEventEditor(true));

		const body = panel.createDiv({ cls: 'sg-tl-editor-body' });

		// ── Date block ───────────────────────────────────────────────────────
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		let startDate: StoryDate | null = typeof fm?.['date'] === 'string' ? parseStoryDate(fm['date']) : null;
		// Read the shape exactly as the canvas does (How Long included): a
		// leftover End Date on "A moment" is not an end, and "Lasts a while"
		// with none is an ongoing bar.
		const shape = classifyEntity('event', fm?.['date'], undefined, undefined, fm?.['end-date'], this.data().calendar, fm?.['how-long']);
		let endDate: StoryDate | null = shape.bucket === 'dated-event' ? shape.end ?? null : null;
		let ongoing = shape.bucket === 'dated-event' && !!shape.ongoing;
		// An era is a band: no badge to give an icon or a size.
		const isEra = isEraHowLong(fm?.['how-long']);

		// Forward-declared: the size row (built further down, once the
		// Appearance section exists) reads `endDate` to decide marker vs bar,
		// so every place below that can add/remove an end date calls this to
		// keep it in sync — an event can flip between the two shapes mid-edit.
		let renderSizeRow: () => void = () => {};
		// Same forward-declare, same call sites as renderSizeRow — the icon
		// row (B4) hides until the event has a start date too, since an
		// undated event sits on the Undated shelf with no marker/bar to paint
		// a glyph onto. It doesn't itself care about endDate (an icon paints
		// the same on a point or a bar), but rebuilding alongside the size
		// row costs nothing and keeps the two in lockstep.
		let renderIconRow: () => void = () => {};

		const dateSection = body.createDiv({ cls: 'sg-tl-editor-section' });
		const renderDateBlock = () => {
			dateSection.empty();

			const mkDateFields = (parent: HTMLElement, value: StoryDate | null): { year: HTMLInputElement; month: HTMLInputElement; day: HTMLInputElement } => {
				const fields = parent.createDiv({ cls: 'sg-tl-add-date-fields' });
				const year = fields.createEl('input', { type: 'number', cls: 'sg-tl-add-input sg-tl-add-input-narrow', attr: { placeholder: t('timeline.editor.year') } });
				const month = fields.createEl('input', { type: 'number', cls: 'sg-tl-add-input sg-tl-add-input-narrow', attr: { placeholder: t('timeline.editor.month') } });
				const day = fields.createEl('input', { type: 'number', cls: 'sg-tl-add-input sg-tl-add-input-narrow', attr: { placeholder: t('timeline.editor.day') } });
				if (value) {
					year.value = String(value.year);
					if (value.month != null) month.value = String(value.month);
					if (value.day != null) day.value = String(value.day);
				}
				return { year, month, day };
			};
			const readDate = (ins: { year: HTMLInputElement; month: HTMLInputElement; day: HTMLInputElement }): StoryDate | null => {
				const yearRaw = ins.year.value.trim();
				if (!yearRaw) return null;
				return {
					year: Number(yearRaw),
					month: ins.month.value ? Number(ins.month.value) : undefined,
					day: ins.day.value ? Number(ins.day.value) : undefined,
				};
			};
			// Commit only when focus leaves the whole 3-input group — tabbing
			// from Year to Month must not write a half-entered date.
			const onGroupBlur = (group: HTMLElement, commitFn: () => void) => {
				group.addEventListener('focusout', (e: FocusEvent) => {
					const next = asNode(e.relatedTarget);
					if (next && group.contains(next)) return;
					commitFn();
				});
			};

			const startLabel = dateSection.createDiv({ cls: 'sg-panel-label' });
			startLabel.createSpan({ text: t('timeline.editor.startDate') });
			const startWrap = dateSection.createDiv({ cls: 'sg-tl-editor-date-row' });
			const startIns = mkDateFields(startWrap, startDate);
			onGroupBlur(startWrap, () => {
				const next = readDate(startIns);
				if (!next) {
					// Emptying the year is not a removal — that's the explicit
					// "Remove date" action. Restore what's on the sheet.
					renderDateBlock();
					return;
				}
				if (startDate && storyDateToAbsoluteDay(this.data().calendar, next) === storyDateToAbsoluteDay(this.data().calendar, startDate)
					&& next.year === startDate.year && next.month === startDate.month && next.day === startDate.day) return;
				if (endDate && storyDateToAbsoluteDay(this.data().calendar, endDate) < storyDateToAbsoluteDay(this.data().calendar, next)) {
					new Notice(t('timeline.info.endBeforeStart'));
					renderDateBlock();
					return;
				}
				startDate = next;
				// Gaining a start date puts the event on the timeline for the
				// first time — that's when its size row becomes meaningful.
				void this.writeEventDate(file, next).then(() => { renderDateBlock(); renderSizeRow(); renderIconRow(); });
			});

			if (startDate) {
				// "Has an end" switch — reveals the end date row (A4's write path).
				const endToggleRow = dateSection.createDiv({ cls: 'sg-tl-editor-toggle-row' });
				const toggleLabel = endToggleRow.createEl('label', { cls: 'sg-tl-editor-toggle' });
				const toggle = toggleLabel.createEl('input', { type: 'checkbox' });
				toggle.checked = !!endDate;
				toggleLabel.createSpan({ text: t('timeline.editor.hasEnd') });

				const endWrap = dateSection.createDiv({ cls: 'sg-tl-editor-date-row' });
				endWrap.toggleClass('is-hidden', !endDate && !toggle.checked);
				let endIns = mkDateFields(endWrap, endDate);
				onGroupBlur(endWrap, () => {
					const next = readDate(endIns);
					if (!next) return; // nothing entered yet — the toggle stays armed
					if (!startDate) return;
					if (storyDateToAbsoluteDay(this.data().calendar, next) < storyDateToAbsoluteDay(this.data().calendar, startDate)) {
						new Notice(t('timeline.info.endBeforeStart'));
						endWrap.empty();
						endIns = mkDateFields(endWrap, endDate);
						return;
					}
					endDate = next;
					ongoing = false;
					// Adding an end date turns this event from a point into a bar —
					// the size row's slider (and which key it writes) must flip too.
					void this.writeEventEndDate(file, next).then(() => { renderDateBlock(); renderSizeRow(); renderIconRow(); });
				});

				toggle.addEventListener('change', () => {
					if (toggle.checked) {
						endWrap.removeClass('is-hidden');
						endIns.year.focus();
					} else if (endDate) {
						endDate = null;
						ongoing = false;
						// Removing it turns the bar back into a point — same flip, reverse direction.
						void this.clearEventEndDate(file).then(() => { renderDateBlock(); renderSizeRow(); renderIconRow(); });
					} else {
						endWrap.addClass('is-hidden');
					}
				});

				// Remove-date — the retired info card's last job lives here.
				const removeBtn = dateSection.createEl('button', { cls: 'sg-tl-editor-quiet-btn', text: t('timeline.info.removeDate') });
				removeBtn.addEventListener('click', () => {
					void (async () => {
						if (endDate) { endDate = null; await this.clearEventEndDate(file); }
						startDate = null;
						await this.clearEventDate(file);
						renderDateBlock();
						renderSizeRow();
						renderIconRow();
					})();
				});
			} else {
				dateSection.createDiv({ cls: 'sg-tl-editor-hint', text: t('timeline.editor.undatedHint') });
			}
		};
		renderDateBlock();

		// ── Synopsis: the sheet's "What Happened" field — or, on a clean-slate
		// event (which has no such field), its "Description" ─────────────────
		const hasField = (label: string) => parsed.fields.some((f) => f.label.trim().toLowerCase() === label.toLowerCase());
		const synField = !hasField('What Happened') && hasField('Description') ? 'Description' : 'What Happened';
		const synSection = body.createDiv({ cls: 'sg-tl-editor-section' });
		const synLabel = synSection.createDiv({ cls: 'sg-panel-label' });
		synLabel.createSpan({ text: synField === 'Description' ? t('timeline.editor.description') : t('timeline.editor.whatHappened') });
		const synWrapper = synSection.createDiv({ cls: 'sg-panel-textarea-wrapper' });
		const synToolbar = synWrapper.createDiv({ cls: 'sg-md-toolbar' });
		const synEditor = synWrapper.createDiv({
			cls: 'sg-panel-richtext',
			attr: { contenteditable: 'true', 'data-placeholder': t('timeline.editor.synopsisPlaceholder'), spellcheck: 'true' },
		});
		let synCommitted = fieldValue(synField);
		setRichText(synEditor, markdownToHtml(synCommitted));
		const updateSynPlaceholder = () => synEditor.toggleClass('sg-richtext--empty', synEditor.textContent?.trim() === '');
		updateSynPlaceholder();
		synEditor.addEventListener('input', updateSynPlaceholder);
		synEditor.addEventListener('paste', (e) => {
			e.preventDefault();
			const text = e.clipboardData?.getData('text/plain') ?? '';
			activeDocument.execCommand('insertText', false, text);
		});
		buildPanelRichToolbar(synToolbar, synEditor, updateSynPlaceholder);
		const commitSynopsis = () => {
			const md = htmlToMarkdown(synEditor.innerHTML);
			if (md === synCommitted) return;
			synCommitted = md;
			void this.writeSheetTextField(file, synField, 'textarea', md).catch((err) => {
				new Notice(t('timeline.editor.saveFailed', { msg: err instanceof Error ? err.message : '' }));
			});
		};
		// Commit when focus leaves the editor — but not into its own toolbar.
		synWrapper.addEventListener('focusout', (e: FocusEvent) => {
			const next = asNode(e.relatedTarget);
			if (next && synWrapper.contains(next)) return;
			commitSynopsis();
		});

		// Flush = what closing must not lose: an unblurred title or synopsis.
		// (Dates and chips commit discretely, on their own actions.)
		this.editorFlush = () => {
			commitSynopsis();
			commitTitle();
		};

		// ── Codex link chips: Location (single) + Key Participants (many) ────
		const projectRoot = this.ctrlHost.getProjectRoot();
		const openChipTarget = (target: string) => {
			const dest = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
			if (dest) this.previewInSidebar(dest.path);
		};
		const commitField = (label: string, value: string) =>
			this.writeSheetTextField(file, label, label === 'Location' ? 'text' : 'textarea', value).catch((err) => {
				new Notice(t('timeline.editor.saveFailed', { msg: err instanceof Error ? err.message : '' }));
			});

		const linksSection = body.createDiv({ cls: 'sg-tl-editor-section' });

		// Location — a single chip; picking a new one replaces it.
		let locationValue = fieldValue('Location');
		const locLabel = linksSection.createDiv({ cls: 'sg-panel-label' });
		locLabel.createSpan({ text: t('timeline.editor.location') });
		const locChips = linksSection.createDiv({ cls: 'sg-chip-container' });
		const renderLocation = () => {
			locChips.empty();
			const targets = parseWikilinks(locationValue);
			for (const target of targets) {
				const chip = locChips.createDiv({ cls: 'sg-chip sg-chip--entity sg-tl-editor-chip' });
				chip.createSpan({ text: target });
				chip.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).classList.contains('sg-chip-remove')) return;
					openChipTarget(target);
				});
				const x = chip.createEl('button', { cls: 'sg-chip-remove', text: '×', attr: { 'aria-label': t('timeline.editor.removeChipAria') } });
				x.addEventListener('click', (e) => {
					e.stopPropagation();
					locationValue = removeWikilink(locationValue, target);
					void commitField('Location', locationValue);
					renderLocation();
				});
			}
			if (targets.length === 0) {
				const addBtn = locChips.createEl('button', { cls: 'sg-panel-btn-small', text: t('timeline.editor.addLocation') });
				addBtn.addEventListener('click', () => {
					new EntityPickerModal(this.app, projectRoot, 'location', (picked: TFile) => {
						// Single Location: any previously linked place gives way.
						for (const old of parseWikilinks(locationValue)) locationValue = removeWikilink(locationValue, old);
						locationValue = addWikilink(locationValue, picked.basename);
						void commitField('Location', locationValue);
						renderLocation();
					}).open();
				});
			}
		};
		renderLocation();

		// Key Participants — multiple chips.
		let participantsValue = fieldValue('Key Participants');
		const partLabel = linksSection.createDiv({ cls: 'sg-panel-label' });
		partLabel.createSpan({ text: t('timeline.editor.participants') });
		const partChips = linksSection.createDiv({ cls: 'sg-chip-container' });
		const renderParticipants = () => {
			partChips.empty();
			for (const target of parseWikilinks(participantsValue)) {
				const chip = partChips.createDiv({ cls: 'sg-chip sg-chip--character sg-tl-editor-chip' });
				chip.createSpan({ text: target });
				chip.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).classList.contains('sg-chip-remove')) return;
					openChipTarget(target);
				});
				const x = chip.createEl('button', { cls: 'sg-chip-remove', text: '×', attr: { 'aria-label': t('timeline.editor.removeChipAria') } });
				x.addEventListener('click', (e) => {
					e.stopPropagation();
					participantsValue = removeWikilink(participantsValue, target);
					void commitField('Key Participants', participantsValue);
					renderParticipants();
				});
			}
			const addBtn = partChips.createEl('button', { cls: 'sg-panel-btn-small', text: t('timeline.editor.addParticipant') });
			addBtn.addEventListener('click', () => {
				new EntityPickerModal(this.app, projectRoot, 'character', (picked: TFile) => {
					participantsValue = addWikilink(participantsValue, picked.basename);
					void commitField('Key Participants', participantsValue);
					renderParticipants();
				}).open();
			});
		};
		renderParticipants();

		// Scene — one optional ChronoLink in the .timeline file.
		const sceneLabel = linksSection.createDiv({ cls: 'sg-panel-label' });
		sceneLabel.createSpan({ text: t('timeline.editor.scene') });
		const sceneChips = linksSection.createDiv({ cls: 'sg-chip-container' });
		const renderScene = () => {
			sceneChips.empty();
			const link = sceneLinkFor(this.data().links, file.path);
			if (link) {
				const name = link.scenePath.split('/').pop()?.replace(/\.md$/, '') ?? link.scenePath;
				const chip = sceneChips.createDiv({ cls: 'sg-chip sg-chip--entity sg-tl-editor-chip' });
				chip.createSpan({ text: name });
				chip.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).classList.contains('sg-chip-remove')) return;
					this.previewInSidebar(link.scenePath);
				});
				const x = chip.createEl('button', { cls: 'sg-chip-remove', text: '×', attr: { 'aria-label': t('timeline.editor.removeChipAria') } });
				x.addEventListener('click', (e) => {
					e.stopPropagation();
					this.ctrlHost.mutate((d) => ({ ...d, links: removeSceneLink(d.links, file.path) }));
					renderScene();
				});
			} else {
				const addBtn = sceneChips.createEl('button', { cls: 'sg-panel-btn-small', text: t('timeline.editor.addScene') });
				addBtn.addEventListener('click', () => {
					new EntityPickerModal(this.app, projectRoot, 'scene', (picked: TFile) => {
						this.ctrlHost.mutate((d) => ({
							...d,
							links: setSceneLink(d.links, { id: generateId(), scenePath: picked.path, targetNotePath: file.path }),
						}));
						renderScene();
					}).open();
				});
			}
		};
		renderScene();

		// ── Appearance: color swatch → existing picker, immediate save ───────
		const appearanceSection = body.createDiv({ cls: 'sg-tl-editor-section' });
		const colorLabel = appearanceSection.createDiv({ cls: 'sg-panel-label' });
		colorLabel.createSpan({ text: t('timeline.editor.color') });
		const colorRow = appearanceSection.createDiv({ cls: 'sg-tl-editor-color-row' });
		const swatch = colorRow.createEl('button', { cls: 'sg-tl-color-swatch', attr: { 'aria-label': t('timeline.editor.color') } });
		swatch.style.background = this.displayColor(file.path);
		swatch.addEventListener('click', () => {
			this.openEventColorPicker(swatch, file.path, (c) => { swatch.style.background = c; });
		});

		// Icon row (B4) — same hide-until-start-date rule as the size row
		// below (an undated event has no marker/bar to paint a glyph onto).
		// The swatch shows the RESOLVED icon (event override, else its
		// track's), matching how the color swatch shows displayColor()
		// rather than only an explicit per-event override.
		const iconContainer = appearanceSection.createDiv();
		renderIconRow = () => {
			iconContainer.empty();
			if (!startDate || isEra) return;
			iconContainer.createDiv({ cls: 'sg-panel-label' }).createSpan({ text: t('timeline.editor.icon') });
			const iconRow = iconContainer.createDiv({ cls: 'sg-tl-editor-color-row' });
			const iconBtn = iconRow.createEl('button', { cls: 'sg-tl-icon-swatch', attr: { 'aria-label': t('timeline.editor.icon') } });
			const paintIconBtn = () => {
				iconBtn.empty();
				const resolved = resolveEventIcon(this.data().eventDisplay[file.path]?.icon, this.resolvePlotline(file.path).icon);
				if (resolved) {
					const glyph = makeSvg('svg', { viewBox: '0 0 256 256' }) as SVGSVGElement;
					glyph.appendChild(makeSvg('path', { d: resolved.path, fill: 'currentColor' }));
					iconBtn.appendChild(glyph);
				}
			};
			paintIconBtn();
			iconBtn.addEventListener('click', () => {
				this.openEventIconPopover(iconBtn, file.path, paintIconBtn);
			});
		};
		renderIconRow();

		// Size row — same one-slider rule as the context menu popover's, and
		// the same sg-tl-appearance-* atoms as the Appearance panel's sliders. Rebuilt
		// (not just re-read) by renderSizeRow() so toggling the "Has an end"
		// switch above swaps marker-size for bar-thickness live.
		const sizeContainer = appearanceSection.createDiv();
		renderSizeRow = () => {
			sizeContainer.empty();
			// An undated event sits on the Undated shelf and has no marker on
			// the timeline at all, so a size slider there would move nothing —
			// the row appears the moment the event gets a start date.
			if (!startDate || isEra) return;
			sizeContainer.createDiv({ cls: 'sg-panel-label' }).createSpan({ text: t('timeline.editor.size') });
			// Ongoing is a bar only once the present is past its start — the same rule the painter uses (isDrawnOngoing).
			const present = this.presentDay();
			const isBar = !!endDate || (ongoing && present !== undefined && present > storyDateToAbsoluteDay(this.data().calendar, startDate));
			const key: 'markerSize' | 'barThickness' = isBar ? 'barThickness' : 'markerSize';
			const limit = APPEARANCE_LIMITS[key];
			const appearanceDefault = this.appearance()[key];
			const currentValue = (): number => this.data().eventDisplay[file.path]?.[key] ?? appearanceDefault;

			const row = sizeContainer.createDiv({ cls: 'sg-tl-appearance-row' });
			const labelRow = row.createDiv({ cls: 'sg-tl-appearance-label-row' });
			labelRow.createSpan({ cls: 'sg-tl-appearance-label', text: t(isBar ? 'timeline.size.bar' : 'timeline.size.marker') });
			const valueEl = labelRow.createSpan({ cls: 'sg-tl-appearance-value' });
			valueEl.setText(String(currentValue()));
			const slider = row.createEl('input', { cls: 'sg-tl-appearance-slider', type: 'range' });
			slider.min = String(limit.min);
			slider.max = String(limit.max);
			slider.step = String(limit.step);
			slider.value = String(currentValue());
			slider.addEventListener('input', () => {
				const value = Number(slider.value);
				valueEl.setText(String(value));
				this.setEventSize(file.path, key, value);
			});

			const resetBtn = sizeContainer.createEl('button', { cls: 'sg-tl-editor-quiet-btn', text: t('timeline.size.reset') });
			resetBtn.addEventListener('click', () => {
				this.clearEventSize(file.path, key);
				slider.value = String(appearanceDefault);
				valueEl.setText(String(appearanceDefault));
			});
		};
		renderSizeRow();

		// ── Footer: explicit navigation — never the default ─────────────────
		const footer = panel.createDiv({ cls: 'sg-tl-editor-footer' });
		const openBtn = footer.createEl('button', { cls: 'sg-tl-btn sg-tl-btn-labeled sg-tl-editor-open-sheet' });
		setPhosphorIcon(openBtn.createSpan(), 'file-text', '📄');
		openBtn.createSpan({ text: t('timeline.editor.openSheet') });
		openBtn.addEventListener('click', () => void openOrReveal(this.app, file));

		if (!Platform.isMobile) window.requestAnimationFrame(() => titleInput.focus());
	}

	/**
	 * Write (or clear) one Event sheet date field, keeping both homes in
	 * sync: the frontmatter key (what collectTimelineData reads) and the
	 * at-a-glance callout's row (entity-body.ts's applyFields — the same
	 * machinery the Edit-sheet save uses, and the same machinery that adds
	 * the row when an older sheet doesn't have one yet: applyRows'
	 * appendRow path inserts a new at-a-glance line rather than requiring
	 * the row to pre-exist), rather than only the frontmatter and letting
	 * the body row go stale.
	 */
	private async writeDateField(file: TFile, label: string, key: string, dateValue: string, howLong?: string): Promise<void> {
		const writes: Array<{ field: CharacterField; key: string }> = [
			{ field: { id: `timeline-${key}`, label, type: 'storydate', value: dateValue }, key },
		];
		// An End Date set or cleared here also answers the sheet's How Long, so
		// the sheet and the canvas agree ("A moment" would otherwise hide a new end).
		if (howLong) writes.push({ field: { id: 'timeline-how-long', label: 'How Long', type: 'select', value: howLong }, key: 'how-long' });
		await this.app.vault.process(file, (content) => {
			const { frontmatter, body } = splitFrontmatter(content);
			return frontmatter + renderBody(applyFields(parseBody(body), writes.map((w) => w.field), 'event'));
		});
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			for (const w of writes) {
				if (w.field.value) fm[w.key] = w.field.value;
				else delete fm[w.key];
			}
		});
	}

	private async updateEventDateField(file: TFile, dateValue: string): Promise<void> {
		return this.writeDateField(file, 'Date', 'date', dateValue);
	}

	private async updateEventEndDateField(file: TFile, dateValue: string): Promise<void> {
		// An era stays an era with or without an End Date (none = still going on).
		if (isEraHowLong(this.app.metadataCache.getFileCache(file)?.frontmatter?.['how-long'])) return this.writeDateField(file, 'End Date', 'end-date', dateValue);
		return this.writeDateField(file, 'End Date', 'end-date', dateValue, dateValue ? EVENT_HOW_LONG.lasting : EVENT_HOW_LONG.moment);
	}

	private async writeEventDate(file: TFile, date: StoryDate): Promise<void> {
		try {
			await this.updateEventDateField(file, serializeStoryDate(date));
			// The event switches shelf↔spine — its old selection key is stale.
			this.activeEventId = null;
			this.activeUndatedPath = null;
			this.refresh();
		} catch (err) {
			new Notice(`Plotverk: Could not set the date. ${err instanceof Error ? err.message : ''}`);
		}
	}

	private async clearEventDate(file: TFile): Promise<void> {
		try {
			await this.updateEventDateField(file, '');
			this.activeEventId = null;
			this.activeUndatedPath = null;
			this.refresh();
		} catch (err) {
			new Notice(`Plotverk: Could not remove the date. ${err instanceof Error ? err.message : ''}`);
		}
	}

	private async writeEventEndDate(file: TFile, date: StoryDate): Promise<void> {
		try {
			await this.updateEventEndDateField(file, serializeStoryDate(date));
			// The event switches point↔bar — its old selection key is stale.
			this.activeEventId = null;
			this.activeUndatedPath = null;
			this.refresh();
		} catch (err) {
			new Notice(`Plotverk: Could not set the end date. ${err instanceof Error ? err.message : ''}`);
		}
	}

	private async clearEventEndDate(file: TFile): Promise<void> {
		try {
			await this.updateEventEndDateField(file, '');
			this.activeEventId = null;
			this.activeUndatedPath = null;
			this.refresh();
		} catch (err) {
			new Notice(`Plotverk: Could not remove the end date. ${err instanceof Error ? err.message : ''}`);
		}
	}

	/**
	 * Mirrors the add-event popover's year/month/day row + Save/Cancel,
	 * reusing its styles. `onSave` does the actual write; returning `false`
	 * keeps the popover open (used to reject an end date before the start
	 * date instead of silently swapping or closing on a rejected entry).
	 */
	private openDatePopover(anchor: Element, title: string, onSave: (date: StoryDate) => boolean | void): void {
		const existing = this.host.doc.querySelector('.sg-tl-add-popover');
		existing?.remove();

		const popover = this.host.doc.body.createDiv({ cls: 'sg-tl-add-popover' });
		popover.createDiv({ cls: 'sg-tl-add-title', text: title });

		const dateRow = popover.createDiv({ cls: 'sg-tl-add-row sg-tl-add-date-row' });
		dateRow.createEl('label', { text: t('timeline.add.date') });
		const dateFields = dateRow.createDiv({ cls: 'sg-tl-add-date-fields' });
		const yearInput = dateFields.createEl('input', { type: 'number', cls: 'sg-tl-add-input sg-tl-add-input-narrow', attr: { placeholder: 'Year', 'aria-label': 'Year' } });
		const monthInput = dateFields.createEl('input', { type: 'number', cls: 'sg-tl-add-input sg-tl-add-input-narrow', attr: { placeholder: 'Month', 'aria-label': 'Month' } });
		const dayInput = dateFields.createEl('input', { type: 'number', cls: 'sg-tl-add-input sg-tl-add-input-narrow', attr: { placeholder: 'Day', 'aria-label': 'Day' } });

		const actions = popover.createDiv({ cls: 'sg-tl-add-actions' });
		const cancelBtn = actions.createEl('button', { cls: 'sg-tl-add-cancel', text: t('timeline.add.cancel') });
		const saveBtn = actions.createEl('button', { cls: 'sg-tl-add-create sg-tl-btn-primary', text: t('timeline.info.saveDate') });

		const onDocClick = (e: MouseEvent) => {
			if (!popover.contains(e.target as Node) && e.target !== anchor) close();
		};
		// Escape closes too — same stacked-layer guard as the event editor/
		// appearance panels, so a menu, modal, or color popover open on top of
		// this one keeps its own Escape instead of this one stealing it. (Not
		// checking for .sg-tl-add-popover here, unlike those — this popover
		// IS one, so that would always match itself and Escape would never fire.)
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			if (this.host.doc.querySelector('.modal-container, .menu, .sg-color-popover')) return;
			close();
		};
		const close = () => {
			popover.remove();
			this.host.doc.removeEventListener('click', onDocClick, { capture: true });
			this.host.doc.removeEventListener('keydown', onKeydown);
			this.closeAddPopover = null;
		};
		this.closeAddPopover = close;

		cancelBtn.addEventListener('click', close);
		saveBtn.addEventListener('click', () => {
			const yearRaw = yearInput.value.trim();
			if (!yearRaw) { new Notice('Plotverk: Enter a year to set a date.'); return; }
			const result = onSave({
				year: Number(yearRaw),
				month: monthInput.value ? Number(monthInput.value) : undefined,
				day: dayInput.value ? Number(dayInput.value) : undefined,
			});
			if (result !== false) close();
		});

		this.positionPopover(popover, anchor);
		yearInput.focus();

		window.setTimeout(() => {
			this.host.doc.addEventListener('click', onDocClick, { capture: true });
			this.host.doc.addEventListener('keydown', onKeydown);
		}, 0);
	}

	private openSetDatePopover(anchor: Element, file: TFile): void {
		this.openDatePopover(anchor, t('timeline.info.setDate'), (date) => {
			void this.writeEventDate(file, date);
		});
	}

	/**
	 * Same popover, writing the End Date field instead — refuses (Notice, no
	 * write, popover stays open) when the entered end lands before the
	 * event's own start date, matching the "never swap, never error" rule.
	 */
	private openSetEndDatePopover(anchor: Element, file: TFile, startDate: StoryDate): void {
		this.openDatePopover(anchor, t('timeline.info.setEndDateTitle'), (date) => {
			const cal = this.data().calendar;
			if (storyDateToAbsoluteDay(cal, date) < storyDateToAbsoluteDay(cal, startDate)) {
				new Notice(t('timeline.info.endBeforeStart'));
				return false;
			}
			void this.writeEventEndDate(file, date);
			return true;
		});
	}

	// ── Add event: the Codex's Event pop-up ──────────────────────────────────

	/**
	 * "Add event" (toolbar, empty state, double-click on the axis): the same
	 * Event pop-up the Codex opens — template or clean slate first — saving a
	 * real Event sheet into this project's Events folder. The clicked day comes
	 * in as the sheet's Date; the plotline choice sits in the pop-up's side
	 * column and is written to this timeline on save.
	 */
	private openAddEventSheet(prefill?: { plotlineId?: string; date?: StoryDate; era?: boolean }): void {
		this.closeAddPopover?.();
		const projectRoot = this.ctrlHost.getProjectRoot();
		let plotlineId = prefill?.plotlineId ?? '';
		// "Add era": the same Event pop-up, with the era's own clean slate and
		// guided fields and How Long already set to "An era". No plotline, and no
		// Event templates to pick from — an era has its own short one.
		const era = !!prefill?.era;
		const startValues: Record<string, string> = {};
		if (prefill?.date) startValues.Date = serializeStoryDate(prefill.date);
		if (era) startValues['How Long'] = EVENT_HOW_LONG.era;
		// Same list the Codex saves Event templates into — shared, so a template
		// saved here shows in this pop-up's picker straight away.
		const s = this.plugin.settings;
		const store = s.customKindFieldTemplates ?? (s.customKindFieldTemplates = {});
		const eventTemplates = store.event ?? (store.event = []);
		new EntityModal(
			this.app,
			'event',
			'',
			[],
			async (name, fields, aliases, start) => {
				let file: TFile;
				try {
					file = await createEntityFile(this.app, projectRoot, 'event', name, fields, aliases, start?.cleanSlate);
				} catch (err) {
					// Nothing back: the sheet editor stays open with the writer's work.
					new Notice(t('codex.notice.createFailed', { kind: 'event', msg: err instanceof Error ? err.message : '' }));
					return;
				}
				// The sheet exists. From here a hiccup is reported, never a reason to save again (a second copy).
				try {
					// Unsorted needs no entry; a chosen plotline is this timeline's to keep.
					if (plotlineId) {
						const path = file.path;
						this.ctrlHost.mutate((d) => ({
							...d,
							eventDisplay: { ...d.eventDisplay, [path]: { ...d.eventDisplay[path], plotlineId } },
						}));
					}
					new Notice(t('codex.notice.entityCreated', { singular: era ? ERA_SHEET.singular : getKindSpec('event').singular, basename: file.basename }));
					this.plugin.celebrateMilestone('first-sheet', t('codex.milestone.firstEntry'));
					if (this.svgEl) {
						this.refresh();
						// A dateless event has no day to pan to — it lands on the Undated
						// shelf. The metadataCache-driven refresh() that follows (400ms
						// debounce in timeline-view.ts, once Obsidian indexes the new
						// file) never moves the camera, so nothing undoes this pan.
						const date = parseStoryDate(fields.find((f) => f.label === 'Date' && f.type === 'storydate')?.value ?? '');
						if (date) this.panToDay(storyDateToAbsoluteDay(this.data().calendar, date));
					}
				} catch (err) {
					reportError(err);
				}
				return file;
			},
			{
				savedTemplates: era ? [] : eventTemplates,
				onSaveTemplate: era ? undefined : (tpl) => {
					runSafely((async () => {
						eventTemplates.push(tpl);
						await this.plugin.saveSettings();
						new Notice(t('codex.notice.templateSaved', { name: tpl.name }));
					})());
				},
				projectRoot,
				plugin: this.plugin,
				startValues: Object.keys(startValues).length > 0 ? startValues : undefined,
				variant: era ? { ...ERA_SHEET, word: t('timeline.era.kindWord') } : undefined,
				railExtra: (rail) => {
					// Only Unsorted means nothing to choose.
					const lanes = this.laneList();
					if (era || !SHOW_PLOTLINE_LANES || lanes.length < 2) return;
					const block = rail.createDiv({ cls: 'sg-sheet-rail-facts sg-tl-sheet-plotline' });
					block.createDiv({ cls: 'sg-sheet-rail-facts-title', text: t('timeline.add.plotline') });
					const select = block.createEl('select', { cls: 'sg-sheet-rail-select', attr: { 'aria-label': t('timeline.add.plotline') } });
					for (const p of lanes) select.createEl('option', { text: p.name, value: p.id });
					select.value = lanes.some((p) => p.id === plotlineId) ? plotlineId : '';
					select.addEventListener('change', () => { plotlineId = select.value; });
				},
			}
		).open();
	}

	private positionPopover(popover: HTMLElement, anchor: Element): void {
		const anchorRect = anchor.getBoundingClientRect();
		const popRect = popover.getBoundingClientRect();
		let left = anchorRect.left;
		let top = anchorRect.bottom + 6;
		left = Math.min(Math.max(8, left), window.innerWidth - popRect.width - 8);
		top = Math.min(Math.max(8, top), window.innerHeight - popRect.height - 8);
		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;
	}

	// ── Plotline manager ─────────────────────────────────────────────────────

	/**
	 * Removes the panel and its document keydown/outside-click listeners —
	 * mirrors closeAppearancePanel(). Called from the close button, Escape,
	 * outside-click, the toolbar toggle, the Appearance panel taking over the
	 * shared dock, and view teardown (buildSkeleton/unmount) — safe to call
	 * whether or not a panel is currently open.
	 */
	private closePlotlinePanel(): void {
		if (this.plotlineKeydownHandler) {
			this.host.doc.removeEventListener('keydown', this.plotlineKeydownHandler);
			this.plotlineKeydownHandler = null;
		}
		if (this.plotlineOutsideClickHandler) {
			this.host.doc.removeEventListener('click', this.plotlineOutsideClickHandler, { capture: true });
			this.plotlineOutsideClickHandler = null;
		}
		this.plotlinePanelEl?.remove();
		this.plotlinePanelEl = null;
	}

	private togglePlotlinePanel(): void {
		if (this.plotlinePanelEl) {
			this.closePlotlinePanel();
			return;
		}
		// Same right-side dock as the appearance panel — opening one closes
		// the other rather than literally stacking two panels in one slot.
		this.closeAppearancePanel();
		this.renderPlotlinePanel();
	}

	private renderPlotlinePanel(): void {
		// Re-render (e.g. after add/reorder/delete) swaps in fresh listeners
		// rather than leaking the old ones — closePlotlinePanel() is safe to
		// call whether or not a panel is currently open (mirrors
		// renderAppearancePanel()'s own closeAppearancePanel() call).
		this.closePlotlinePanel();
		const root = this.host.querySelector('.sg-tl-root') as HTMLElement;
		if (!root) return;
		const panel = root.createDiv({ cls: 'sg-tl-plotline-panel' });
		this.plotlinePanelEl = panel;

		const header = panel.createDiv({ cls: 'sg-tl-panel-header' });
		header.createDiv({ cls: 'sg-tl-panel-title', text: t('timeline.toolbar.plotlines') });
		const closeBtn = header.createEl('button', { cls: 'sg-tl-info-close', attr: { 'aria-label': t('timeline.plotlines.closeAria') } });
		setPhosphorIcon(closeBtn, 'x', '×');
		closeBtn.addEventListener('click', () => this.togglePlotlinePanel());

		// Escape closes — same stacked-layer guard as the event editor/
		// appearance panels, so a menu, modal, color popover, or add-event
		// popover above this panel keeps its own Escape instead of this one
		// stealing it.
		this.plotlineKeydownHandler = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			if (this.host.doc.querySelector('.modal-container, .menu, .sg-color-popover, .sg-tl-add-popover')) return;
			this.closePlotlinePanel();
		};
		this.host.doc.addEventListener('keydown', this.plotlineKeydownHandler);

		// Outside-click closes too — this panel (unlike the editor/appearance
		// panels) had no dismissal but its own × button. Mirrors the add-event/
		// date popovers' own capture-phase click + deferred attach (so the
		// click that opened this panel is never seen as a dismissal), but with
		// two extra exclusions those popovers don't need: the toolbar (else
		// clicking the Plotlines toggle button while open would close the
		// panel here and then reopen it via the button's own handler) and the
		// same overlay classes Escape skips above (a color/icon popover opened
		// from a row control lives outside this panel's DOM, and clicking it
		// must not dismiss the panel underneath it).
		const onPlotlineOutsideClick = (e: MouseEvent) => {
			if (panel.contains(e.target as Node)) return;
			if ((e.target as Element).closest('.sg-tl-toolbar, .modal-container, .menu, .sg-color-popover, .sg-tl-add-popover')) return;
			this.closePlotlinePanel();
		};
		this.plotlineOutsideClickHandler = onPlotlineOutsideClick;
		window.setTimeout(() => this.host.doc.addEventListener('click', onPlotlineOutsideClick, { capture: true }), 0);

		const list = panel.createDiv({ cls: 'sg-tl-plotline-list' });
		const plotlines = this.data().plotlines;
		plotlines.forEach((p, i) => {
			const row = list.createDiv({ cls: 'sg-tl-plotline-row' });

			const swatch = row.createEl('button', { cls: 'sg-tl-color-swatch', attr: { 'aria-label': 'Plotline color' } });
			swatch.style.background = p.color;
			swatch.addEventListener('click', () => {
				ColorPickerPopover.show(swatch, {
					currentColor: p.color,
					palettes: this.plugin.settings.colorPalettes,
					activePaletteId: this.plugin.settings.activeColorPaletteId,
					savedColors: this.plugin.settings.savedColors ?? [],
					onSaveColor: (c) => this.saveColor(c),
					onRemoveSaved: (c) => this.removeSavedColor(c),
					onPreview: (c) => { swatch.style.background = c; },
					onCommit: (c) => this.updatePlotline(p.id, { color: c }),
				});
			});

			// Track-default icon (B4): every event on this track shows this
			// glyph unless it has its own EventDisplay.icon override — see
			// resolveEventIcon() in event-icons.ts. Plain updatePlotline patch,
			// same as color/name/style/width above: `icon: undefined` (the
			// picker's "No icon") unsets it the same way width's absence
			// already works — the value is dropped when the file saves as
			// JSON, so there's no separate "clear" method needed here the way
			// eventDisplay's clearEventIcon is for the per-event override.
			const iconBtn = row.createEl('button', { cls: 'sg-tl-icon-swatch', attr: { 'aria-label': t('timeline.plotlines.iconAria') } });
			const paintTrackIcon = () => {
				iconBtn.empty();
				const resolved = resolveEventIcon(p.icon, undefined);
				if (resolved) {
					const glyph = makeSvg('svg', { viewBox: '0 0 256 256' }) as SVGSVGElement;
					glyph.appendChild(makeSvg('path', { d: resolved.path, fill: 'currentColor' }));
					iconBtn.appendChild(glyph);
				}
			};
			paintTrackIcon();
			iconBtn.addEventListener('click', () => {
				this.openIconPicker(iconBtn, p.icon, (value) => {
					this.updatePlotline(p.id, { icon: value });
					paintTrackIcon();
				});
			});

			const nameInput = row.createEl('input', { type: 'text', cls: 'sg-tl-plotline-name', value: p.name });
			nameInput.addEventListener('change', () => this.updatePlotline(p.id, { name: nameInput.value.trim() || p.name }));

			const styleSelect = row.createEl('select', { cls: 'sg-tl-plotline-style' });
			(['solid', 'dashed', 'dotted'] as LineStyle[]).forEach((style) => {
				const opt = styleSelect.createEl('option', { text: style, value: style });
				if (style === p.lineStyle) opt.selected = true;
			});
			styleSelect.addEventListener('change', () => this.updatePlotline(p.id, { lineStyle: styleSelect.value as LineStyle }));

			// Per-track thread thickness — paint only, bounds shared with
			// the Appearance panel's trackWidth slider so a track's own
			// override can never exceed what the global default allows.
			const widthLimit = APPEARANCE_LIMITS.trackWidth;
			const widthInput = row.createEl('input', {
				type: 'range',
				cls: 'sg-tl-plotline-width',
				attr: { 'aria-label': t('timeline.plotlines.widthAria') },
			});
			widthInput.min = String(widthLimit.min);
			widthInput.max = String(widthLimit.max);
			widthInput.step = String(widthLimit.step);
			const widthValue = p.width ?? this.appearance().trackWidth;
			widthInput.value = String(widthValue);
			widthInput.title = String(widthValue);
			widthInput.addEventListener('input', () => {
				widthInput.title = widthInput.value;
				this.updatePlotline(p.id, { width: Number(widthInput.value) });
			});

			const upBtn = row.createEl('button', { cls: 'sg-tl-plotline-reorder', attr: { 'aria-label': t('timeline.plotlines.moveUpAria') } });
			setPhosphorIcon(upBtn, 'caret-up', '▲');
			upBtn.disabled = i === 0;
			upBtn.addEventListener('click', () => this.movePlotline(p.id, -1));

			const downBtn = row.createEl('button', { cls: 'sg-tl-plotline-reorder', attr: { 'aria-label': t('timeline.plotlines.moveDownAria') } });
			setPhosphorIcon(downBtn, 'caret-down', '▼');
			downBtn.disabled = i === plotlines.length - 1;
			downBtn.addEventListener('click', () => this.movePlotline(p.id, 1));

			const delBtn = row.createEl('button', { cls: 'sg-tl-plotline-delete', attr: { 'aria-label': 'Delete plotline' } });
			setPhosphorIcon(delBtn, 'trash', '🗑');
			delBtn.addEventListener('click', () => this.deletePlotline(p.id));
		});

		const addBtn = panel.createEl('button', { cls: 'sg-tl-plotline-add sg-tl-btn-primary' });
		setPhosphorIcon(addBtn.createSpan(), 'plus', '+');
		addBtn.createSpan({ text: t('timeline.plotlines.add') });
		addBtn.addEventListener('click', () => {
			const palette = this.plugin.settings.colorPalettes.find((p) => p.id === this.plugin.settings.activeColorPaletteId)?.colors ?? ['#7c5fd3'];
			const color = palette[plotlines.length % palette.length] ?? '#7c5fd3';
			this.ctrlHost.mutate((d) => ({ ...d, plotlines: [...d.plotlines, createPlotline(`Plotline ${d.plotlines.length + 1}`, color)] }));
			this.renderPlotlinePanel();
			this.renderLanesAndNodes();
		});
	}

	// ── Main-line end caps ───────────────────────────────────────────────────

	/**
	 * A round stop at each end of the main line, a bit wider than the line, in
	 * its colour, with the year beside it in the year-label style — before the
	 * start, after the end. Lives in the camera's group and is counter-scaled
	 * like the badges, so it rides every drag/zoom frame and keeps its size.
	 * One cap when the line is a single day.
	 */
	private renderLineCaps(ends: LineEnds, appearance: TimelineAppearance, parent: SVGGElement): void {
		const group = makeSvg('g', { class: 'sg-tl-caps' }) as SVGGElement;
		parent.appendChild(group);
		const horizontal = this.orientation === 'horizontal';
		const r = appearance.spineWidth / 2 + 3;
		const cap = (day: number, label: string, side: -1 | 1): void => {
			// A gradient line: the start cap takes its first colour, the end cap its last.
			const color = appearance.spineColor ? solidFromColor(appearance.spineColor, side === 1 ? 'last' : 'first') : null;
			const along = this.timeAxisPos(day);
			const at = makeSvg('g', { class: 'sg-tl-cap', transform: horizontal ? `translate(${along},0)` : `translate(0,${along})` }) as SVGGElement;
			const k = makeSvg('g', {}) as SVGGElement;
			k.style.transform = counterScale(horizontal);
			at.appendChild(k);
			group.appendChild(at);
			const dot = makeSvg('circle', { class: 'sg-tl-cap-dot', cx: '0', cy: '0', r: String(r) }) as SVGCircleElement;
			if (color) dot.style.fill = color;
			k.appendChild(dot);
			const chip = makeSvg('g', { class: 'sg-tl-year-chip sg-tl-cap-chip' });
			k.appendChild(chip);
			const text = makeSvg('text', { class: 'sg-tl-year-chip-text', 'text-anchor': 'middle', x: '0', y: '4' }) as SVGTextElement;
			text.textContent = label;
			chip.appendChild(text);
			// A view drawn while hidden measures text as 0 — estimate instead.
			const measured = text.getComputedTextLength();
			const w = Math.max(44, (measured > 0 ? measured : label.length * 7) + 18);
			chip.insertBefore(makeSvg('rect', { class: 'sg-tl-year-chip-bg', x: String(-w / 2), y: '-10', width: String(w), height: '20', rx: '6' }), text);
			const off = r + 6 + (horizontal ? w / 2 : 10);
			chip.setAttribute('transform', horizontal ? `translate(${side * off},0)` : `translate(0,${side * off})`);
		};
		cap(ends.startDay, ends.startLabel, -1);
		if (ends.endDay !== ends.startDay) cap(ends.endDay, ends.endLabel, 1);
	}

	// ── Appearance panel ────────────────────────────────────────────────
	// Docks in the same right-side slot as the plotline panel (toggleAppearancePanel/
	// togglePlotlinePanel close whichever sibling is open, so the two panels
	// never stack). Every control writes straight through ctrlHost.mutate,
	// sparsely patching viewSettings.appearance, then asks for a repaint via
	// scheduleAppearanceRepaint() rather than refresh()/buildSkeleton() — those
	// would tear down this very panel mid-drag. renderLanesAndNodes()/
	// applyTransform() only ever touch the svg's own groups (laneGroup/
	// nodeGroup/axisGroup), which is what lets the A5 event editor's panel
	// survive a refresh() unmolested, and the same guarantee is what keeps
	// this panel (and the slider mid-drag) alive here.

	private closeAppearancePanel(): void {
		// A year still being typed (Escape, the close button) is saved, not lost:
		// leaving the box fires its change.
		const focused = this.host.doc.activeElement;
		if (focused?.instanceOf(HTMLInputElement) && this.appearancePanelEl?.contains(focused)) focused.blur();
		if (this.appearanceKeydownHandler) {
			this.host.doc.removeEventListener('keydown', this.appearanceKeydownHandler);
			this.appearanceKeydownHandler = null;
		}
		this.appearancePanelEl?.remove();
		this.appearancePanelEl = null;
		this.syncRangeControls = null;
	}

	private toggleAppearancePanel(): void {
		if (this.appearancePanelEl) {
			this.closeAppearancePanel();
			return;
		}
		// Same right-side dock as the plotline panel — close it rather than
		// literally stacking two panels in one slot.
		this.closePlotlinePanel();
		this.renderAppearancePanel();
	}

	private renderAppearancePanel(): void {
		// Re-render (e.g. after Reset) swaps in a fresh listener rather than
		// leaking the old one — closeAppearancePanel() is safe to call whether
		// or not a panel is currently open.
		this.closeAppearancePanel();
		const root = this.host.querySelector('.sg-tl-root') as HTMLElement;
		if (!root) return;
		const panel = root.createDiv({ cls: 'sg-tl-appearance-panel' });
		this.appearancePanelEl = panel;

		const header = panel.createDiv({ cls: 'sg-tl-panel-header' });
		header.createDiv({ cls: 'sg-tl-panel-title', text: t('timeline.appearance.title') });
		const closeBtn = header.createEl('button', { cls: 'sg-tl-info-close', attr: { 'aria-label': t('timeline.appearance.closeAria') } });
		setPhosphorIcon(closeBtn, 'x', '×');
		closeBtn.addEventListener('click', () => this.closeAppearancePanel());

		// Escape closes — same stacked-layer guard as the event editor panel,
		// so a menu, modal, color popover, or add-event popover above this
		// panel keeps its own Escape instead of this one stealing it.
		this.appearanceKeydownHandler = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			if (this.host.doc.querySelector('.modal-container, .menu, .sg-color-popover, .sg-tl-add-popover')) return;
			this.closeAppearancePanel();
		};
		this.host.doc.addEventListener('keydown', this.appearanceKeydownHandler);

		const body = panel.createDiv({ cls: 'sg-tl-appearance-body' });
		const appearance = this.appearance();
		this.renderRangeControls(body);

		const sliderRow = (key: keyof typeof APPEARANCE_LIMITS, labelKey: string): void => {
			const limit = APPEARANCE_LIMITS[key];
			const row = body.createDiv({ cls: 'sg-tl-appearance-row' });
			const labelRow = row.createDiv({ cls: 'sg-tl-appearance-label-row' });
			labelRow.createSpan({ cls: 'sg-tl-appearance-label', text: t(labelKey) });
			const valueEl = labelRow.createSpan({ cls: 'sg-tl-appearance-value' });
			valueEl.setText(String(appearance[key]));
			const slider = row.createEl('input', { cls: 'sg-tl-appearance-slider', type: 'range' });
			slider.min = String(limit.min);
			slider.max = String(limit.max);
			slider.step = String(limit.step);
			slider.value = String(appearance[key]);
			slider.addEventListener('input', () => {
				const value = Number(slider.value);
				valueEl.setText(String(value));
				this.setAppearance(key, value);
			});
		};

		sliderRow('spineWidth', 'timeline.appearance.spineWidth');
		if (SHOW_PLOTLINE_LANES) sliderRow('trackWidth', 'timeline.appearance.trackWidth');
		sliderRow('barThickness', 'timeline.appearance.barThickness');
		sliderRow('markerSize', 'timeline.appearance.markerSize');
		if (SHOW_PLOTLINE_LANES) sliderRow('spacing', 'timeline.appearance.spacing');

		const stitchesRow = body.createDiv({ cls: 'sg-tl-appearance-toggle-row' });
		const stitchesLabel = stitchesRow.createEl('label', { cls: 'sg-tl-editor-toggle' });
		const stitchesToggle = stitchesLabel.createEl('input', { type: 'checkbox' });
		stitchesToggle.checked = appearance.stitches;
		stitchesLabel.createSpan({ text: t('timeline.appearance.stitches') });
		stitchesToggle.addEventListener('change', () => this.setAppearance('stitches', stitchesToggle.checked));

		const selectRow = <T extends string>(
			labelKey: string,
			options: readonly (readonly [T, string])[],
			current: T,
			onChange: (value: T) => void,
		): void => {
			const row = body.createDiv({ cls: 'sg-tl-appearance-select-row' });
			row.createSpan({ cls: 'sg-tl-appearance-label', text: t(labelKey) });
			const select = row.createEl('select', { cls: 'sg-tl-appearance-select' });
			for (const [value, textKey] of options) {
				const opt = select.createEl('option', { text: t(textKey), value });
				if (value === current) opt.selected = true;
			}
			select.addEventListener('change', () => onChange(select.value as T));
		};

		selectRow<TimelineLabelMode>(
			'timeline.appearance.labels',
			[
				['room', 'timeline.appearance.labelsRoom'],
				['always', 'timeline.appearance.labelsAlways'],
				['hover', 'timeline.appearance.labelsHover'],
				['off', 'timeline.appearance.labelsOff'],
			],
			appearance.labelMode,
			(value) => this.setAppearance('labelMode', value),
		);

		selectRow<TimelineLabelDirection>(
			'timeline.appearance.labelDirection',
			[
				['readable', 'timeline.appearance.labelDirectionReadable'],
				['along-axis', 'timeline.appearance.labelDirectionAlongAxis'],
			],
			appearance.labelDirection,
			(value) => this.setAppearance('labelDirection', value),
		);

		selectRow<TimelineAxisUnit>(
			'timeline.appearance.axisUnit',
			[
				['auto', 'timeline.appearance.axisUnitAuto'],
				['year', 'timeline.appearance.axisUnitYear'],
				['month', 'timeline.appearance.axisUnitMonth'],
				['day', 'timeline.appearance.axisUnitDay'],
			],
			appearance.axisUnit,
			(value) => this.setAppearance('axisUnit', value),
		);

		const resetBtn = panel.createEl('button', { cls: 'sg-tl-appearance-reset' });
		resetBtn.setText(t('timeline.appearance.reset'));
		resetBtn.addEventListener('click', () => this.resetAppearance());
	}

	/**
	 * "Years shown", first in the Appearance panel: Automatic (first to last
	 * event) or From year … to year …, each with an era picker when the
	 * calendar has eras. A box commits on change (blur / Enter), never per
	 * keystroke — typing "1" on the way to "1200" must not save year 1, and
	 * saving runs the grow check, which never shrinks. Stored per timeline in
	 * viewSettings.range; Reset to defaults leaves it alone (it is a choice
	 * about the story's years, not a look).
	 */
	private renderRangeControls(body: HTMLElement): void {
		const cal = this.data().calendar;
		const eras = [...(cal.eras ?? [])].sort((a, b) => a.startYear - b.startYear);
		const section = body.createDiv({ cls: 'sg-tl-range' });
		const head = section.createDiv({ cls: 'sg-tl-appearance-row' });
		head.createSpan({ cls: 'sg-tl-appearance-label', text: t('timeline.range.label') });
		const mode = head.createEl('select', { cls: 'sg-tl-appearance-select sg-tl-range-mode' });
		mode.createEl('option', { text: t('timeline.range.auto'), value: 'auto' });
		mode.createEl('option', { text: t('timeline.range.custom'), value: 'custom' });
		const fields = section.createDiv({ cls: 'sg-tl-range-fields' });
		const error = section.createDiv({ cls: 'sg-tl-range-error', attr: { role: 'alert' } });
		section.createDiv({ cls: 'sg-tl-range-hint', text: t('timeline.range.hint') });

		const bound = (labelKey: string): { era: HTMLSelectElement | null; input: HTMLInputElement } => {
			const row = fields.createDiv({ cls: 'sg-tl-range-row' });
			row.createSpan({ cls: 'sg-tl-appearance-label sg-tl-range-row-label', text: t(labelKey) });
			let era: HTMLSelectElement | null = null;
			if (eras.length > 0) {
				era = row.createEl('select', { cls: 'sg-tl-appearance-select sg-tl-range-era', attr: { 'aria-label': t('timeline.range.era') } });
				for (const e of eras) era.createEl('option', { text: e.name, value: e.name });
			}
			const input = row.createEl('input', { cls: 'sg-tl-range-year', type: 'number', attr: { step: '1', 'aria-label': t(labelKey) } });
			return { era, input };
		};
		const from = bound('timeline.range.from');
		const to = bound('timeline.range.to');
		const show = (b: { era: HTMLSelectElement | null; input: HTMLInputElement }, absYear: number): void => {
			const date = yearAsStoryDate(cal, absYear);
			// Never overwrite a box the writer is typing in (a growth can land mid-typing).
			if (b.input === this.host.doc.activeElement) return;
			if (b.era) {
				// A year before the first era has no era to pick: offer that one choice.
				let none = b.era.querySelector('option[value=""]');
				if (!date.era && !none) none = b.era.insertBefore(createEl('option', { text: t('timeline.range.noEra'), value: '' }), b.era.firstChild);
				b.era.value = date.era ?? '';
			}
			b.input.value = String(date.year);
		};
		const setError = (msg: string | null): void => {
			error.setText(msg ?? '');
			error.toggleClass('is-visible', !!msg);
		};
		const sync = (): void => {
			const range = this.shownRange();
			mode.value = range ? 'custom' : 'auto';
			fields.toggleClass('is-hidden', !range);
			if (range) {
				show(from, range.startYear);
				show(to, range.endYear);
			}
			setError(null);
		};
		this.syncRangeControls = sync;
		sync();

		const save = (range: TimelineRange): void => {
			this.ctrlHost.mutate((d) => ({ ...d, viewSettings: { ...d.viewSettings, range } }));
			// Grows (and says so) if an event is outside, then shows the chosen years.
			this.checkShownRange();
			sync();
			this.centerOnEvents();
		};
		const commit = (): void => {
			const v = validateRangeInput(cal, { era: from.era?.value, year: from.input.value }, { era: to.era?.value, year: to.input.value });
			if (!v.ok) {
				setError(v.error === 'limit' ? t('timeline.range.error.limit', { limit: RANGE_YEAR_LIMIT }) : t(v.error === 'order' ? 'timeline.range.error.order' : 'timeline.range.error.number'));
				return;
			}
			setError(null);
			if (JSON.stringify(v.range) === JSON.stringify(this.data().viewSettings.range)) return;
			save(v.range);
		};
		for (const b of [from, to]) {
			b.input.addEventListener('change', commit);
			b.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') b.input.blur(); });
			b.era?.addEventListener('change', () => {
				// A year that does not belong to the picked era (e.g. 10 in an era
				// that starts in year 500 and keeps counting) would be saved under
				// its old era and the pick would seem not to stick — start the
				// picked era at its first year instead.
				const era = eras.find((e) => e.name === b.era!.value);
				const typed = Number(b.input.value);
				if (era && Number.isInteger(typed)) {
					const abs = era.resetsYearTo1 ? era.startYear + typed - 1 : typed;
					if (yearAsStoryDate(cal, abs).era !== era.name) b.input.value = String(era.resetsYearTo1 ? 1 : era.startYear);
				}
				commit();
			});
		}

		mode.addEventListener('change', () => {
			if (mode.value === 'auto') {
				this.ctrlHost.mutate((d) => {
					const { range: _range, ...rest } = d.viewSettings;
					return { ...d, viewSettings: rest };
				});
				sync();
				this.centerOnEvents();
				return;
			}
			// Start from what is drawn today: the first to the last event (an
			// ongoing bar counts to the story's present), or the years in view.
			const present = this.presentDay();
			const days = this.events.flatMap((evt) => [
				this.absoluteDay(evt),
				...(evt.end ? [storyDateToAbsoluteDay(cal, evt.end)] : []),
				...(this.isDrawnOngoing(evt, present) ? [present] : []),
			]).filter((d) => Number.isFinite(d));
			let startYear: number;
			let endYear: number;
			if (days.length > 0) {
				startYear = absoluteYearOfDay(cal, Math.min(...days));
				endYear = absoluteYearOfDay(cal, Math.max(...days));
			} else {
				const view = this.wrapEl ? this.visibleDayRange() : { start: 0, end: 0 };
				startYear = absoluteYearOfDay(cal, (view.start + view.end) / 2);
				endYear = startYear + 10;
			}
			const clampYear = (y: number): number => Math.max(-RANGE_YEAR_LIMIT, Math.min(RANGE_YEAR_LIMIT, y));
			save(rangeFromYears(cal, clampYear(startYear), clampYear(endYear)));
		});
	}

	/** Sparse-patches one appearance knob through the standard mutate seam, then repaints (throttled — see scheduleAppearanceRepaint). */
	private setAppearance<K extends keyof TimelineAppearance>(key: K, value: TimelineAppearance[K]): void {
		this.ctrlHost.mutate((d) => ({
			...d,
			viewSettings: { ...d.viewSettings, appearance: { ...d.viewSettings.appearance, [key]: value } },
		}));
		this.scheduleAppearanceRepaint();
	}

	/**
	 * Removes the whole `appearance` block from viewSettings so the file falls
	 * back through resolveAppearance()'s next layers (plugin-global default,
	 * then DEFAULT_TIMELINE_APPEARANCE) rather than writing the defaults back
	 * as an explicit override — a later change to the plugin-global default
	 * should still reach a "reset" file. Re-renders the panel so every control
	 * shows the value it resolved to, not the one it had a moment ago.
	 */
	private resetAppearance(): void {
		this.ctrlHost.mutate((d) => {
			const { appearance: _appearance, ...restViewSettings } = d.viewSettings;
			return { ...d, viewSettings: restViewSettings };
		});
		this.renderLanesAndNodes();
		this.applyTransform();
		this.renderAxisTicks();
		this.renderAppearancePanel();
	}

	/** Batches the many `input` events one slider drag fires into one repaint per animation frame — setAppearance() above still commits every value to ctrlHost.mutate synchronously, so no intermediate value is ever lost, only the (expensive) SVG rebuild is coalesced. Still rebuilds ticks every frame here (unlike scheduleRender's pan/zoom path) — axisUnit/labelDirection/labelMode changes flow through here too and expect immediate feedback, not a 150ms settle delay. */
	private scheduleAppearanceRepaint(): void {
		if (this.appearanceRenderScheduled) return;
		this.appearanceRenderScheduled = true;
		window.requestAnimationFrame(() => {
			this.appearanceRenderScheduled = false;
			this.renderLanesAndNodes();
			this.applyTransform();
			this.renderAxisTicks();
		});
	}

	/** Repaints via scheduleAppearanceRepaint (rAF-coalesced) rather than a bare renderLanesAndNodes() — the width slider fires many `input` events per drag, same as the B2 Appearance sliders, and this is the one scheduling helper for that. */
	private updatePlotline(id: string, patch: Partial<Plotline>): void {
		this.ctrlHost.mutate((d) => ({ ...d, plotlines: d.plotlines.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
		this.scheduleAppearanceRepaint();
	}

	private movePlotline(id: string, dir: -1 | 1): void {
		this.ctrlHost.mutate((d) => {
			const idx = d.plotlines.findIndex((p) => p.id === id);
			const target = idx + dir;
			if (idx < 0 || target < 0 || target >= d.plotlines.length) return d;
			const next = [...d.plotlines];
			[next[idx], next[target]] = [next[target], next[idx]];
			return { ...d, plotlines: next };
		});
		this.renderPlotlinePanel();
		this.renderLanesAndNodes();
	}

	private deletePlotline(id: string): void {
		this.ctrlHost.mutate((d) => ({
			...d,
			plotlines: d.plotlines.filter((p) => p.id !== id),
			eventDisplay: Object.fromEntries(
				Object.entries(d.eventDisplay).map(([path, disp]) => [path, disp.plotlineId === id ? { ...disp, plotlineId: undefined } : disp]),
			),
		}));
		this.renderPlotlinePanel();
		this.renderLanesAndNodes();
	}

	private saveColor(c: string): void {
		const saved = [...(this.plugin.settings.savedColors ?? [])];
		if (!saved.includes(c)) {
			this.plugin.settings.savedColors = [c, ...saved].slice(0, 32);
			void this.plugin.saveSettings();
		}
	}

	private removeSavedColor(c: string): void {
		this.plugin.settings.savedColors = (this.plugin.settings.savedColors ?? []).filter((x) => x !== c);
		void this.plugin.saveSettings();
	}
}
