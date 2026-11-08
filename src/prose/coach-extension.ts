import { Extension, RangeSetBuilder, StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from '@codemirror/view';
import { ProseFinding, RepetitionGroup } from './types';
import { CoachScanContext, scanCoach } from './coach-scan';
import { markRanges, findingForMark } from './mark-ranges';

export type { CoachScanContext } from './coach-scan';

/**
 * Prose Coach — marks in the text.
 *
 * Rules (locked, see the coach redesign plan):
 * - one mark class for every kind (`sg-prose-mark`); the kind is told on hover;
 * - marks never flicker: after an edit the old marks just move with the text,
 *   and the note is re-read ~600 ms after the last keystroke;
 * - never a mark on the line the cursor is on;
 * - whether marks show at all (Off / While revising / Always, sprint) is the
 *   host's call, asked per editor through `contextFor`.
 *
 * The whole note is scanned, not just the visible part, so frontmatter, the
 * scene metadata line and repeated words far apart are judged correctly.
 */

export interface CoachExtensionHost {
	/** null → no marks in this editor (mode off, not revising, sprint running, not a scene…). */
	contextFor(view: EditorView): CoachScanContext | null;
	/** Opens the explain card for a mark. `viaTap` = touch / click rather than hover. */
	showCard(view: EditorView, finding: ProseFinding, group: RepetitionGroup | undefined, anchor: DOMRect, viaTap: boolean): void;
	/** Mouse left a mark: the host closes the card unless the pointer moved onto it. */
	leaveMark(): void;
	isMobile(): boolean;
}

interface CoachHit {
	finding: ProseFinding;
	group: RepetitionGroup | undefined;
	rect: DOMRect;
}

/** Dispatch to an editor to re-read its note now (settings, mode, sprint or Codex changed). */
export const coachRefreshEffect = StateEffect.define<null>();

/** Scans above this size are skipped — a whole novel in one note would make every pause stutter. */
const MAX_SCAN_CHARS = 400_000;
const REBUILD_MS = 600;
const HOVER_MS = 350;
const markDeco = Decoration.mark({ class: 'sg-prose-mark' });
/** A sentence-rhythm run: same amber, drawn as an underline so a whole paragraph never glows. */
const runDeco = Decoration.mark({ class: 'sg-prose-mark sg-prose-mark--run' });

/** The mark under the pointer: a word mark wins over the rhythm run underlining it. */
function markUnder(target: EventTarget | null): HTMLElement | null {
	const el = target as HTMLElement | null;
	return (el?.closest?.('.sg-prose-mark:not(.sg-prose-mark--run)') ?? el?.closest?.('.sg-prose-mark--run') ?? null) as HTMLElement | null;
}

export function coachHighlights(host: CoachExtensionHost): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet = Decoration.none;
			findings: ProseFinding[] = [];
			groups: RepetitionGroup[] = [];
			private timer: number | null = null;
			private hoverTimer: number | null = null;
			private cursorLine = -1;
			/** Mobile: the mark under a finger at touch-down, opened on the tap that follows. */
			pendingTap: { at: number; hit: CoachHit } | null = null;

			constructor(readonly view: EditorView) {
				this.scan();
			}

			update(u: ViewUpdate) {
				const refresh = u.transactions.some((tr) => tr.effects.some((e) => e.is(coachRefreshEffect)));
				if (refresh) {
					this.clearTimer();
					this.scan();
					return;
				}
				if (u.docChanged) {
					// Move the existing marks with the text; drop any the edit swallowed.
					this.findings = this.findings
						.map((f) => ({ ...f, from: u.changes.mapPos(f.from, 1), to: u.changes.mapPos(f.to, -1) }))
						.filter((f) => f.to > f.from);
					this.groups = this.groups.map((g) => ({
						...g,
						from: u.changes.mapPos(g.from, 1),
						to: u.changes.mapPos(g.to, -1),
						ranges: g.ranges.map((r) => ({ from: u.changes.mapPos(r.from, 1), to: u.changes.mapPos(r.to, -1) })),
					}));
					this.decorate();
					this.schedule();
					return;
				}
				if (u.selectionSet && this.findings.length > 0) {
					const line = this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
					if (line !== this.cursorLine) this.decorate();
				}
			}

			private scan() {
				const ctx = host.contextFor(this.view);
				const doc = this.view.state.doc;
				if (!ctx || doc.length > MAX_SCAN_CHARS) {
					this.findings = [];
					this.groups = [];
				} else {
					const r = scanCoach(doc.toString(), ctx);
					this.findings = r.findings;
					this.groups = r.repetitionGroups;
				}
				this.decorate();
			}

			private decorate() {
				const state = this.view.state;
				const line = state.doc.lineAt(state.selection.main.head);
				this.cursorLine = line.number;
				const builder = new RangeSetBuilder<Decoration>();
				for (const r of markRanges(this.findings, { from: line.from, to: line.to })) {
					builder.add(r.from, r.to, r.run ? runDeco : markDeco);
				}
				this.decorations = builder.finish();
			}

			private schedule() {
				this.clearTimer();
				this.timer = window.setTimeout(() => {
					this.timer = null;
					// Re-read through a transaction so CodeMirror picks up the new decorations.
					this.view.dispatch({ effects: coachRefreshEffect.of(null) });
				}, REBUILD_MS);
			}

			private clearTimer() {
				if (this.timer !== null) window.clearTimeout(this.timer);
				this.timer = null;
			}

			clearHover() {
				if (this.hoverTimer !== null) window.clearTimeout(this.hoverTimer);
				this.hoverTimer = null;
			}

			hoverMark(mark: HTMLElement) {
				this.clearHover();
				this.hoverTimer = window.setTimeout(() => {
					this.hoverTimer = null;
					const hit = mark.isConnected ? this.hitAt(mark) : null;
					if (hit) host.showCard(this.view, hit.finding, hit.group, hit.rect, false);
				}, HOVER_MS);
			}

			/** The finding a mark element shows, read while the element is still in the editor. */
			hitAt(mark: HTMLElement): CoachHit | null {
				let pos: number;
				try {
					pos = this.view.posAtDOM(mark, 0);
				} catch {
					return null;
				}
				const finding = findingForMark(this.findings, pos + 0.5, mark.classList.contains('sg-prose-mark--run'));
				if (!finding) return null;
				const group = finding.kind === 'repetition'
					? this.groups.find((g) => g.word === finding.word && g.ranges.some((r) => r.from === finding.from))
					: undefined;
				return { finding, group, rect: mark.getBoundingClientRect() };
			}

			destroy() {
				this.clearTimer();
				this.clearHover();
			}
		},
		{
			decorations: (v) => v.decorations,
			eventHandlers: {
				mouseover(e: MouseEvent) {
					if (host.isMobile()) return;
					const mark = markUnder(e.target);
					if (mark) this.hoverMark(mark);
				},
				mouseout(e: MouseEvent) {
					if (host.isMobile()) return;
					const from = (e.target as HTMLElement | null)?.closest?.('.sg-prose-mark');
					const to = (e.relatedTarget as HTMLElement | null)?.closest?.('.sg-prose-mark');
					if (from && from !== to) {
						this.clearHover();
						host.leaveMark();
					}
				},
				// A tap moves the cursor onto that line, which takes the mark away before
				// the click arrives — so the mark is read at touch-down, opened on the tap.
				pointerdown(e: PointerEvent) {
					if (!host.isMobile()) return;
					const mark = markUnder(e.target);
					const hit = mark ? this.hitAt(mark) : null;
					this.pendingTap = hit ? { at: Date.now(), hit } : null;
				},
				click() {
					const tap = this.pendingTap;
					this.pendingTap = null;
					if (!tap || Date.now() - tap.at > 800) return;
					host.showCard(this.view, tap.hit.finding, tap.hit.group, tap.hit.rect, true);
				},
			},
		}
	);
	return plugin;
}

/** Dispatches a `storygrid:coach-doc-changed` CustomEvent ~debounceMs after the
 *  last edit, so the Coach tab can re-read the scene. Always registered — the
 *  tab works whether or not marks are showing in the text. */
export function coachChangeNotifier(debounceMs = REBUILD_MS): Extension {
	let timer: number | null = null;
	return EditorView.updateListener.of((u: ViewUpdate) => {
		if (!u.docChanged) return;
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = null;
			document.dispatchEvent(new CustomEvent('storygrid:coach-doc-changed'));
		}, debounceMs);
	});
}
