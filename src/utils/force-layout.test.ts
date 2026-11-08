import {
	createSimulation,
	tickSimulation,
	isSettled,
	settleSimulation,
	nodeDist,
	ForceEdge,
} from './force-layout';

const edge = (sourceId: string, targetId: string, strength = 1): ForceEdge => ({
	sourceId,
	targetId,
	strength,
});

describe('createSimulation', () => {
	test('creates one ForceNode per id', () => {
		const sim = createSimulation(['a', 'b', 'c'], []);
		expect(sim.nodes).toHaveLength(3);
		expect(sim.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
	});

	test('initial alpha is 1', () => {
		expect(createSimulation(['a'], []).alpha).toBe(1);
	});

	test('all initial velocities are zero', () => {
		const sim = createSimulation(['a', 'b'], []);
		for (const n of sim.nodes) {
			expect(n.vx).toBe(0);
			expect(n.vy).toBe(0);
		}
	});

	test('positions are deterministic: same ids → same starting layout', () => {
		const sim1 = createSimulation(['x', 'y', 'z'], []);
		const sim2 = createSimulation(['z', 'y', 'x'], []); // different insertion order
		const pos1 = Object.fromEntries(sim1.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
		const pos2 = Object.fromEntries(sim2.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
		expect(pos1).toEqual(pos2);
	});

	test('no two nodes start at exactly the same position', () => {
		const sim = createSimulation(['a', 'b', 'c', 'd', 'e'], []);
		const coords = sim.nodes.map((n) => `${n.x.toFixed(3)},${n.y.toFixed(3)}`);
		expect(new Set(coords).size).toBe(5);
	});

	test('single node is placed at a finite position', () => {
		const sim = createSimulation(['only'], []);
		expect(isFinite(sim.nodes[0].x)).toBe(true);
		expect(isFinite(sim.nodes[0].y)).toBe(true);
	});
});

describe('tickSimulation', () => {
	test('alpha decreases each tick', () => {
		const sim = createSimulation(['a', 'b'], [edge('a', 'b')]);
		tickSimulation(sim);
		expect(sim.alpha).toBeLessThan(1);
	});

	test('nodes move after ticking (repulsion)', () => {
		const sim = createSimulation(['a', 'b'], []);
		const ax0 = sim.nodes[0].x;
		const ay0 = sim.nodes[0].y;
		tickSimulation(sim, 5);
		const moved = sim.nodes[0].x !== ax0 || sim.nodes[0].y !== ay0;
		expect(moved).toBe(true);
	});

	test('pinned node does not move', () => {
		const sim = createSimulation(['fixed', 'free'], [edge('fixed', 'free')]);
		sim.nodes[0].pinned = true;
		const x0 = sim.nodes[0].x;
		const y0 = sim.nodes[0].y;
		tickSimulation(sim, 50);
		expect(sim.nodes[0].x).toBe(x0);
		expect(sim.nodes[0].y).toBe(y0);
	});

	test('ticking a settled simulation does not change alpha below 0', () => {
		const sim = createSimulation(['a', 'b'], []);
		settleSimulation(sim);
		expect(sim.alpha).toBe(0);
		tickSimulation(sim, 10);
		expect(sim.alpha).toBe(0);
	});

	test('multi-count tick is equivalent to calling tick N times', () => {
		const makeBase = () => createSimulation(['p', 'q'], [edge('p', 'q')]);
		const sA = makeBase();
		const sB = makeBase();
		tickSimulation(sA, 20);
		for (let i = 0; i < 20; i++) tickSimulation(sB);
		const xa = sA.nodes[0].x;
		const xb = sB.nodes[0].x;
		expect(xa).toBeCloseTo(xb, 8);
	});
});

describe('isSettled / settleSimulation', () => {
	test('isSettled is false at start', () => {
		expect(isSettled(createSimulation(['a', 'b'], []))).toBe(false);
	});

	test('isSettled is true after settleSimulation', () => {
		const sim = createSimulation(['a', 'b'], []);
		settleSimulation(sim);
		expect(isSettled(sim)).toBe(true);
	});

	test('settle completes in a reasonable number of ticks (≤ 300)', () => {
		const sim = createSimulation(['a', 'b', 'c', 'd'], [
			edge('a', 'b'),
			edge('b', 'c'),
		]);
		let ticks = 0;
		while (!isSettled(sim)) { tickSimulation(sim); ticks++; }
		expect(ticks).toBeLessThanOrEqual(300);
	});
});

describe('force behavior', () => {
	test('connected pair ends up closer than unconnected pair after settling', () => {
		// Three nodes: A–B connected, C isolated.
		// Place them so A and C start equidistant from B.
		const sim = createSimulation(['a', 'b', 'c'], [edge('a', 'b', 1)]);
		// Override initial positions for a controlled test
		const [a, b, c] = sim.nodes;
		a.x = -200; a.y = 0;
		b.x = 0;    b.y = 0;
		c.x = 200;  c.y = 0;
		settleSimulation(sim);
		const distAB = nodeDist(a, b);
		const distBC = nodeDist(b, c);
		expect(distAB).toBeLessThan(distBC);
	});

	test('repulsion pushes two unconnected nodes apart', () => {
		const sim = createSimulation(['a', 'b'], []);
		// Start them very close
		sim.nodes[0].x = 1;  sim.nodes[0].y = 0;
		sim.nodes[1].x = -1; sim.nodes[1].y = 0;
		const initialDist = nodeDist(sim.nodes[0], sim.nodes[1]);
		tickSimulation(sim, 30);
		expect(nodeDist(sim.nodes[0], sim.nodes[1])).toBeGreaterThan(initialDist);
	});

	test('heavier edge (strength 1) pulls nodes tighter than light edge (strength 0.3)', () => {
		const makeGraph = (strength: number) => {
			const sim = createSimulation(['a', 'b'], [edge('a', 'b', strength)]);
			sim.nodes[0].x = -300; sim.nodes[0].y = 0;
			sim.nodes[1].x =  300; sim.nodes[1].y = 0;
			settleSimulation(sim);
			return nodeDist(sim.nodes[0], sim.nodes[1]);
		};
		expect(makeGraph(1)).toBeLessThan(makeGraph(0.3));
	});

	test('centering keeps settled graph near origin (no drift)', () => {
		const ids = ['a', 'b', 'c', 'd', 'e'];
		const sim = createSimulation(ids, [
			edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'e'),
		]);
		settleSimulation(sim);
		const cx = sim.nodes.reduce((s, n) => s + n.x, 0) / ids.length;
		const cy = sim.nodes.reduce((s, n) => s + n.y, 0) / ids.length;
		// centroid should be reasonably near origin
		expect(Math.abs(cx)).toBeLessThan(150);
		expect(Math.abs(cy)).toBeLessThan(150);
	});
});

describe('nodeDist', () => {
	test('returns 0 for same position', () => {
		const a = { id: 'a', x: 5, y: 5, vx: 0, vy: 0 };
		expect(nodeDist(a, a)).toBe(0);
	});

	test('returns correct Euclidean distance', () => {
		const a = { id: 'a', x: 0, y: 0, vx: 0, vy: 0 };
		const b = { id: 'b', x: 3, y: 4, vx: 0, vy: 0 };
		expect(nodeDist(a, b)).toBeCloseTo(5, 5);
	});
});
