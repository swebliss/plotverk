/**
 * Pure graph-data builder for the custom relationship graph view.
 * No Obsidian imports — fully unit-testable.
 *
 * The Obsidian-side caller is responsible for scoping: it passes only the
 * entities belonging to the active book or series, so this module never sees
 * (or mixes) entities from another project.
 */

import { EntityKind } from '../entities/entity-kinds';
import { RelEntity, buildRelationGraph, classifyRelation, getReciprocalType, RelationshipType, RELATIONSHIP_TYPE_OTHER } from './relations';

export type { RelationshipType } from './relations';

// ─── Public data types ────────────────────────────────────────────────────────

export interface GraphNode {
	path: string;
	name: string;
	kind: EntityKind;
	/** Portrait image path from frontmatter, or null when absent. */
	imagePath: string | null;
}

export interface GraphEdge {
	fromPath: string;
	toPath: string;
	/** Raw relation label, empty string for bare wikilinks. */
	label: string;
	/** Resolved type from the registry — drives color, weight, and legend entry. */
	relType: RelationshipType;
	/** The same relation viewed from the toPath end — used for perspective-aware hover coloring. */
	toRelType: RelationshipType;
	/** Bond strength 1–10 declared by the source sheet, when annotated. */
	intensity?: number;
	/** Timeline era declared by the source sheet, when annotated. */
	epoch?: string;
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

// ─── Input type ───────────────────────────────────────────────────────────────

/** RelEntity extended with an optional portrait path for node rendering. */
export interface GraphEntityInput extends RelEntity {
	imagePath?: string | null;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build typed graph nodes and edges from a pre-scoped entity list.
 *
 * Only entities that participate in at least one edge are included as nodes —
 * isolated entities (no connections) are silently dropped so the graph stays
 * meaningful.  Bare-wikilink edges get RELATIONSHIP_TYPE_OTHER with weight and
 * color treated as "unclassified" by the view.
 */
export function buildGraphData(
	entities: GraphEntityInput[],
	extraTypes: readonly RelationshipType[] = [],
): GraphData {
	const rawEdges = buildRelationGraph(entities, extraTypes);

	// Collect paths of connected entities only
	const connectedPaths = new Set<string>();
	for (const e of rawEdges) {
		connectedPaths.add(e.fromPath);
		connectedPaths.add(e.toPath);
	}

	const nodes: GraphNode[] = entities
		.filter((e) => connectedPaths.has(e.path))
		.map((e) => ({
			path: e.path,
			name: e.name,
			kind: e.kind,
			imagePath: e.imagePath ?? null,
		}));

	const edges: GraphEdge[] = rawEdges.map((e) => {
		const relType = classifyRelation(e.label, extraTypes);
		return {
			fromPath: e.fromPath,
			toPath: e.toPath,
			label: e.label,
			relType,
			toRelType: getReciprocalType(relType, extraTypes),
			...(e.intensity !== undefined ? { intensity: e.intensity } : {}),
			...(e.epoch ? { epoch: e.epoch } : {}),
		};
	});

	return { nodes, edges };
}

/**
 * True when two opposing directed edges describe the SAME mutual relationship —
 * A calls B "Spouse" and B calls A "Spouse". The map collapses these into one
 * clean line with the type word centered on it and no arrowheads, instead of
 * drawing the same fact twice.
 */
export function isCollapsibleMutualPair(
	aToB: { relType: RelationshipType } | undefined,
	bToA: { relType: RelationshipType } | undefined,
): boolean {
	if (!aToB || !bToA) return false;
	return aToB.relType.behavior === 'mutual' && aToB.relType.id === bToA.relType.id;
}

// ─── Legend helpers ───────────────────────────────────────────────────────────

/**
 * Return the unique RelationshipTypes actually used in a graph, sorted by
 * their position in the RELATIONSHIP_TYPES registry (stable order for the legend).
 * Unlabeled edges are excluded from the legend.
 */
export function legendEntries(data: GraphData): RelationshipType[] {
	const seen = new Map<string, RelationshipType>();
	for (const edge of data.edges) {
		if (edge.label === '') continue; // bare wikilinks don't get a legend entry
		if (!seen.has(edge.relType.id)) seen.set(edge.relType.id, edge.relType);
	}
	return [...seen.values()];
}

/**
 * Return the bare-wikilink (unlabeled) edge count for a graph — used by the
 * view to decide whether to show an "unspecified connection" note in the legend.
 */
export function bareEdgeCount(data: GraphData): number {
	return data.edges.filter((e) => e.label === '').length;
}

// ─── Perspective filter helpers ────────────────────────────────────────────────

/**
 * BFS out from `startPath` along edges treated as undirected (a connection
 * reaches both ways for "degrees of separation" purposes, same convention as
 * the hover-highlight neighbor lookup). Always includes the start node itself.
 * Cycle-safe via the `visited` set; a start path absent from the graph simply
 * yields a singleton set, which fades every real node — the correct result
 * for a stale/deleted anchor.
 */
export function nodesWithinDegrees(data: GraphData, startPath: string, degrees: number): Set<string> {
	const adjacency = new Map<string, Set<string>>();
	for (const edge of data.edges) {
		if (!adjacency.has(edge.fromPath)) adjacency.set(edge.fromPath, new Set());
		if (!adjacency.has(edge.toPath)) adjacency.set(edge.toPath, new Set());
		adjacency.get(edge.fromPath)!.add(edge.toPath);
		adjacency.get(edge.toPath)!.add(edge.fromPath);
	}

	const visited = new Set<string>([startPath]);
	let frontier = [startPath];
	for (let step = 0; step < degrees && frontier.length > 0; step++) {
		const next: string[] = [];
		for (const path of frontier) {
			for (const neighbor of adjacency.get(path) ?? []) {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					next.push(neighbor);
				}
			}
		}
		frontier = next;
	}
	return visited;
}

/**
 * Characters (or other entities) declaring a `member-of` edge into any of the
 * given group paths (factions/locations). Members only — callers that also
 * want the group nodes themselves visible add `groupPaths` to the result.
 */
export function membersOfGroups(data: GraphData, groupPaths: string[]): Set<string> {
	const groups = new Set(groupPaths);
	const members = new Set<string>();
	for (const edge of data.edges) {
		if (edge.relType.id === 'member-of' && groups.has(edge.toPath)) members.add(edge.fromPath);
	}
	return members;
}

export { RELATIONSHIP_TYPE_OTHER };
