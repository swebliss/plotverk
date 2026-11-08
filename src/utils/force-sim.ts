/**
 * D3-force wrapper for the Connections Map.
 *
 * Keeps d3-force internals out of rel-graph-view.ts and provides a clean seam
 * for swapping to a Canvas renderer later (Step 6).
 */

import {
	forceSimulation,
	forceManyBody,
	forceLink,
	forceCenter,
	forceCollide,
	SimulationNodeDatum,
	SimulationLinkDatum,
} from 'd3-force';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A node in the simulation — d3 mutates x/y/vx/vy in-place. */
export interface SimNode extends SimulationNodeDatum {
	id: string;
}

export interface SimLinkInput {
	source: string;
	target: string;
	/** Spring strength 0–1 (0 = loose / long, 1 = tight / short). */
	strength: number;
	/** Relationship word this link came from — the key the pull multiplier is looked up by. */
	key?: string;
	/** Per-relationship pull multiplier. 1 = the relationship's natural pull; >1 tighter, <1 looser. */
	pull?: number;
}

export interface SimSeedOptions {
	/** Prior tick positions, keyed by node id — reused instead of the fresh ring layout so a data refresh doesn't visibly reshuffle the graph. */
	seedPositions?: Map<string, { x: number; y: number }>;
	/** Force-tuning overrides — merged over {@link DEFAULT_FORCE_SETTINGS}. */
	forces?: Partial<ForceSettings>;
}

/**
 * User-tunable force knobs — the same 4 concepts as Obsidian's own graph view
 * (Center/Repel/Link force, Link distance), plus 2 that are specific to this
 * map: distance/strength here already vary per-edge by relationship weight
 * (a Parent/Child bond pulls tighter than a Rival one), and *Variation* is how
 * much that per-edge spread applies — 0 flattens every edge to the same base
 * value, 1 is today's full spread.
 */
export interface ForceSettings {
	/** How hard nodes get pulled toward the center (0–1). */
	centerForce: number;
	/** How hard nodes push each other apart (0–20). */
	repelForce: number;
	/** Global multiplier on link spring strength (0–1). */
	linkForce: number;
	/** Global multiplier on link target distance (0.5–2). */
	linkDistance: number;
	/** How much relationship weight spreads target distance apart (0–1). */
	distanceVariation: number;
	/** How much relationship weight spreads spring strength apart (0–1). */
	strengthVariation: number;
}

export const DEFAULT_FORCE_SETTINGS: ForceSettings = {
	centerForce: 0.15,
	repelForce: 6,
	linkForce: 1,
	linkDistance: 0.6,
	distanceVariation: 0.3,
	strengthVariation: 1,
};

/** Repel-force slider units (0–20, Obsidian-style) scaled to a useful d3 charge-strength range. */
const REPEL_SCALE = 38;

// Internal d3 link shape after id resolution
interface D3Link extends SimulationLinkDatum<SimNode> {
	strength: number;
	key: string;
	pull: number;
	/**
	 * `1 / min(degree(source), degree(target))` — d3-force's own default link
	 * weighting, restored. Without it every link pulls at full stiffness, so a
	 * heavily-connected character is held by a dozen full-strength springs and
	 * snaps back hard when dragged. A character with a single tie has
	 * `min(degree) = 1`, so their tether keeps full strength and they still
	 * can't drift off — only the dense middle of the graph relaxes.
	 */
	degreeScale: number;
}

// ── Simulation class ──────────────────────────────────────────────────────────

export class GraphSimulation {
	private _sim: ReturnType<typeof forceSimulation<SimNode>>;
	private _byId: Map<string, SimNode>;
	private _forces: ForceSettings;
	private _d3Links: D3Link[];
	private _linkForceObj: ReturnType<typeof forceLink<SimNode, D3Link>>;
	private _chargeForceObj: ReturnType<typeof forceManyBody<SimNode>>;
	private _centerForceObj: ReturnType<typeof forceCenter<SimNode>>;

	constructor(nodeIds: string[], links: SimLinkInput[], opts: SimSeedOptions = {}) {
		const n = nodeIds.length;
		const ringR = Math.max(80, Math.sqrt(n) * 70);

		// Sort for deterministic ring placement regardless of insertion order
		const sorted = [...nodeIds].sort();
		const idxOf = new Map(sorted.map((id, i) => [id, i]));
		const seeds = opts.seedPositions;

		const nodes: SimNode[] = nodeIds.map((id) => {
			const seed = seeds?.get(id);
			if (seed) return { id, x: seed.x, y: seed.y };
			const i = idxOf.get(id) ?? 0;
			const angle = (2 * Math.PI * i) / Math.max(1, n);
			return { id, x: Math.cos(angle) * ringR, y: Math.sin(angle) * ringR };
		});

		this._byId = new Map(nodes.map((node) => [node.id, node]));

		const degree = new Map<string, number>();
		for (const l of links) {
			degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
			degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
		}

		this._d3Links = links.map((l) => ({
			...l,
			key: l.key ?? '',
			pull: l.pull ?? 1,
			degreeScale: 1 / Math.max(1, Math.min(degree.get(l.source) ?? 1, degree.get(l.target) ?? 1)),
		} as D3Link));

		this._forces = { ...DEFAULT_FORCE_SETTINGS, ...opts.forces };
		const f = this._forces;

		this._linkForceObj = forceLink<SimNode, D3Link>(this._d3Links).id((node) => node.id);
		this._applyLinkAccessors();
		this._chargeForceObj = forceManyBody<SimNode>().strength(-f.repelForce * REPEL_SCALE).distanceMax(600);
		this._centerForceObj = forceCenter<SimNode>(0, 0).strength(f.centerForce);

		this._sim = forceSimulation<SimNode>(nodes)
			.force('charge', this._chargeForceObj)
			.force('link', this._linkForceObj)
			.force('center', this._centerForceObj)
			.force('collide', forceCollide<SimNode>(20).strength(0.8))
			.alphaDecay(0.022)    // settles rather than drifting on — prolonged motion reads as "still bouncing"
			.velocityDecay(0.45)  // friction. d3's own default; the old 0.25 let nodes keep momentum and overshoot
			.stop();              // don't auto-start; caller controls timing
	}

	/**
	 * (Re-)install the link distance/strength accessors. Kept in one place so
	 * the formulas can't drift between construction, {@link updateForces} and
	 * {@link updateLinkPulls} — d3 caches these per link, so re-calling the
	 * setters is also what makes it re-read mutated link data.
	 */
	private _applyLinkAccessors(): void {
		const f = this._forces;
		this._linkForceObj
			.distance((l) => ((100 + (1 - l.strength) * 100 * f.distanceVariation) * f.linkDistance) / l.pull)
			// Clamped: d3 link strengths above 1 overshoot their target and oscillate.
			.strength((l) => Math.min(1, (0.1 + l.strength * 0.4 * f.strengthVariation) * f.linkForce * l.pull * l.degreeScale));
	}

	/** Apply new force settings to the live simulation and gently reheat it so the graph re-settles instead of jumping. */
	updateForces(forces: Partial<ForceSettings>): void {
		this._forces = { ...this._forces, ...forces };
		const f = this._forces;
		this._chargeForceObj.strength(-f.repelForce * REPEL_SCALE);
		this._centerForceObj.strength(f.centerForce);
		this._applyLinkAccessors();
		this._sim.alpha(0.5).restart();
	}

	/**
	 * Re-read each link's pull multiplier and re-settle — for the relationship
	 * weight sliders. Deliberately mutates the existing links instead of
	 * rebuilding the simulation: nodes keep their positions (no reshuffle) and
	 * the caller doesn't have to re-render any DOM.
	 */
	updateLinkPulls(pullFor: (key: string) => number): void {
		for (const l of this._d3Links) l.pull = pullFor(l.key);
		this._applyLinkAccessors();
		this._sim.alpha(0.3).restart();
	}

	/** Register a function called on every tick — use to sync SVG positions. */
	onTick(fn: () => void): this {
		this._sim.on('tick', fn);
		return this;
	}

	/** Run n ticks synchronously so nodes spread before the first SVG render. */
	warmUp(ticks = 80): this {
		this._sim.tick(ticks);
		return this;
	}

	/** Start the live animation timer. */
	start(): this {
		this._sim.restart();
		return this;
	}

	/** Get one node by id (position updated in-place each tick). */
	getNode(id: string): SimNode | undefined {
		return this._byId.get(id);
	}

	/** All nodes — live reference, positions mutated in-place. */
	nodes(): SimNode[] {
		return this._sim.nodes();
	}

	/** Fix a node at (x, y) — call repeatedly during pointer drag. */
	pinNode(id: string, x: number, y: number): void {
		const node = this._byId.get(id);
		if (node) { node.fx = x; node.fy = y; }
	}

	/** Release a pinned node back into the simulation. */
	releaseNode(id: string): void {
		const node = this._byId.get(id);
		if (node) { node.fx = null; node.fy = null; }
	}

	/**
	 * Reheat so the whole graph ripples in response to a drag.
	 * Call on drag-start; pair with coolDown() on drag-end.
	 */
	reheat(): void {
		// Gentle. At the old 0.3 the whole graph stayed energetic for the entire
		// drag, so releasing a node launched it back instead of letting it settle.
		this._sim.alphaTarget(0.1).restart();
	}

	/** Let the simulation cool naturally (call on drag-end). */
	coolDown(): void {
		this._sim.alphaTarget(0);
	}

	/** Stop the internal timer. Always call in onClose to prevent leaks. */
	stop(): void {
		this._sim.stop();
	}
}
