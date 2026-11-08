/**
 * Lightweight force-directed layout engine.  No external dependencies, fully
 * unit-testable, deterministic initial placement via a seeded LCG so the
 * same entity set always starts from the same configuration.
 *
 * Usage:
 *   const sim = createSimulation(nodeIds, edges);
 *   while (!isSettled(sim)) tickSimulation(sim);
 *   // sim.nodes now carry final x/y
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ForceNode {
	/** Vault path — stable identity across ticks. */
	id: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** When true this node ignores all force updates (user dragged it). */
	pinned?: boolean;
}

export interface ForceEdge {
	sourceId: string;
	targetId: string;
	/**
	 * Spring strength in [0, 1].  Callers derive this from relType.weight:
	 *   strength = relType.weight / MAX_WEIGHT   (e.g. weight 3 → 1.0)
	 * Stronger edges pull nodes closer together and result in shorter rest lengths.
	 */
	strength: number;
}

export interface ForceOptions {
	/** Coulomb-like repulsion constant.  Higher = nodes spread further apart. Default 9000. */
	repulsion?: number;
	/** Base spring stiffness factor.  Default 0.06. */
	springStrength?: number;
	/** Rest length for a strength-1 spring (px).  Default 180. */
	springLength?: number;
	/** Centering pull toward origin — prevents the graph drifting off-canvas.  Default 0.003. */
	centering?: number;
	/** Velocity decay per tick [0–1].  Lower = more damping.  Default 0.82. */
	damping?: number;
}

export interface ForceSimulation {
	nodes: ForceNode[];
	edges: ForceEdge[];
	/** Cooling factor in [0, 1].  Starts at 1; decrements by ALPHA_DECAY each tick.
	 *  Forces are scaled by alpha so the system settles as it cools. */
	alpha: number;
	opts: Required<ForceOptions>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** How much alpha drops per tick.  At 0.005 the simulation cools in ~200 ticks. */
const ALPHA_DECAY = 0.005;
const ALPHA_MIN = 0;

const DEFAULT_OPTS: Required<ForceOptions> = {
	repulsion: 9000,
	springStrength: 0.06,
	springLength: 180,
	centering: 0.003,
	damping: 0.82,
};

// ─── Deterministic PRNG (LCG) ─────────────────────────────────────────────────

function hashStr(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function lcg(seed: number): () => number {
	let s = (seed | 0) || 1;
	return () => {
		s = (Math.imul(1664525, s) + 1013904223) | 0;
		return (s >>> 0) / 4294967296;
	};
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new simulation with deterministic initial node positions arranged
 * in a jittered ring.  Same node ids in any order → same starting layout.
 */
export function createSimulation(
	nodeIds: string[],
	edges: ForceEdge[],
	opts: ForceOptions = {},
): ForceSimulation {
	const mergedOpts: Required<ForceOptions> = { ...DEFAULT_OPTS, ...opts };

	// Seed from sorted ids so insertion order doesn't matter
	const seed = nodeIds.slice().sort().reduce((acc, id) => acc ^ hashStr(id), 0x811c9dc5);
	const rng = lcg(seed);

	const radius = Math.max(160, Math.sqrt(nodeIds.length) * 110);
	// Sort for position assignment so input order doesn't affect layout
	const sortedIds = nodeIds.slice().sort();
	const posForId = new Map<string, { x: number; y: number }>();
	for (let i = 0; i < sortedIds.length; i++) {
		const angle = (2 * Math.PI * i) / Math.max(1, sortedIds.length) + rng() * 0.4 - 0.2;
		const r = radius * (0.75 + rng() * 0.5);
		posForId.set(sortedIds[i], { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
	}
	const nodes: ForceNode[] = nodeIds.map((id) => {
		const pos = posForId.get(id)!;
		return { id, x: pos.x, y: pos.y, vx: 0, vy: 0 };
	});

	return { nodes, edges, alpha: 1, opts: mergedOpts };
}

/**
 * Advance the simulation by `count` ticks (default 1).
 * Mutates `sim.nodes[*].{x,y,vx,vy}` and decrements `sim.alpha`.
 */
export function tickSimulation(sim: ForceSimulation, count = 1): void {
	for (let t = 0; t < count; t++) {
		if (sim.alpha <= ALPHA_MIN) break;
		_tick(sim);
	}
}

/** True when the simulation has fully cooled and further ticking is a no-op. */
export function isSettled(sim: ForceSimulation): boolean {
	return sim.alpha <= ALPHA_MIN;
}

// ─── Internal tick ────────────────────────────────────────────────────────────

function _tick(sim: ForceSimulation): void {
	const { nodes, edges, alpha, opts } = sim;
	const { repulsion, springStrength, springLength, centering, damping } = opts;

	const byId = new Map<string, ForceNode>();
	for (const n of nodes) byId.set(n.id, n);

	// ── Repulsion: all pairs ────────────────────────────────────────────────
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			const a = nodes[i];
			const b = nodes[j];
			const dx = b.x - a.x || 0.01; // avoid 0-division
			const dy = b.y - a.y || 0.01;
			const distSq = Math.max(dx * dx + dy * dy, 1);
			const dist = Math.sqrt(distSq);
			const force = (repulsion * alpha) / distSq;
			const fx = (force * dx) / dist;
			const fy = (force * dy) / dist;
			if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
			if (!b.pinned) { b.vx += fx; b.vy += fy; }
		}
	}

	// ── Spring attraction along edges ───────────────────────────────────────
	for (const edge of edges) {
		const a = byId.get(edge.sourceId);
		const b = byId.get(edge.targetId);
		if (!a || !b) continue;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const dist = Math.sqrt(dx * dx + dy * dy) || 1;
		// Rest length shortens with strength: heavy relationships pull nodes tighter
		const restLen = springLength * (1 - edge.strength * 0.35);
		const stretch = dist - restLen;
		const force = springStrength * edge.strength * stretch * alpha;
		const fx = (force * dx) / dist;
		const fy = (force * dy) / dist;
		if (!a.pinned) { a.vx += fx; a.vy += fy; }
		if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
	}

	// ── Centering: gentle pull toward origin ────────────────────────────────
	for (const n of nodes) {
		if (!n.pinned) {
			n.vx -= n.x * centering * alpha;
			n.vy -= n.y * centering * alpha;
		}
	}

	// ── Integrate + dampen ──────────────────────────────────────────────────
	for (const n of nodes) {
		if (n.pinned) continue;
		n.vx *= damping;
		n.vy *= damping;
		n.x += n.vx;
		n.y += n.vy;
	}

	sim.alpha = Math.max(ALPHA_MIN, sim.alpha - ALPHA_DECAY);
}

// ─── Helpers for the graph view ───────────────────────────────────────────────

/**
 * Run the simulation to completion in one blocking call.
 * Only use this for off-screen pre-computation (e.g. initial layout before
 * the view opens).  The live graph view should tick per animation frame instead.
 */
export function settleSimulation(sim: ForceSimulation): void {
	while (!isSettled(sim)) _tick(sim);
}

/**
 * Distance between two nodes (Euclidean, px).
 * Convenience for tests and the view's hit-testing.
 */
export function nodeDist(a: ForceNode, b: ForceNode): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return Math.sqrt(dx * dx + dy * dy);
}
