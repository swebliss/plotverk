/**
 * Pure half of "Load the sample story" (no Obsidian imports — unit-tested).
 *
 * The packed Saltmarch files (saltmarch-data.ts) still carry the folder they
 * were packed from: grids store `povCharacter` / `location` as full vault paths,
 * and the timeline keys its events by full path. Loading them into a different
 * folder means moving every one of those paths over. This module works out the
 * whole load — folders, files, scene order, series + books — before a single
 * file is written, so the Obsidian half only has to carry it out.
 */

import { generateEntityId } from '../grid-data';

/** The sample's folder name in the user's vault (top level). */
export const SAMPLE_FOLDER = 'Saltmarch (sample)';

/** What the packer hands over (see scripts/pack-sample.mjs). */
export interface SampleData {
	sourceRoot: string;
	textFiles: ReadonlyArray<readonly [string, string]>;
	imageFiles: ReadonlyArray<readonly [string, string]>;
	sceneTrees: Readonly<Record<string, unknown[]>>;
	books: ReadonlyArray<{ name: string; gridRel: string }>;
}

export interface SamplePlan {
	root: string;
	/** Every folder the files need, parents before children (the root first). */
	folders: string[];
	textFiles: Array<{ path: string; content: string }>;
	imageFiles: Array<{ path: string; base64: string }>;
	/** Writers Panel scene order, keyed by the full project folder path. */
	sceneTrees: Record<string, unknown[]>;
	series: { name: string; rootPath: string };
	/** In reading order; Book 1 first. */
	books: Array<{ name: string; gridPath: string }>;
}

/** The fixed Codex sheet ids the sample was packed with (`storygrid-id: sg_demo00008`). */
const PACKED_ENTITY_ID = /\bsg_demo[0-9a-z]+\b/g;

/**
 * Every packed sheet id swapped for a brand-new one, the same id wherever it appears.
 * Fixed ids would make a second load look like deleted sheets coming back (Plotverk then
 * rewrites their relationships) and would clash with any other copy of the story.
 */
export function freshEntityIds(texts: string[], makeId: () => string): string[] {
	const map = new Map<string, string>();
	return texts.map((t) => t.replace(PACKED_ENTITY_ID, (old) => {
		let id = map.get(old);
		if (!id) { id = makeId(); map.set(old, id); }
		return id;
	}));
}

/** Files whose content is JSON holding full vault paths. */
const JSON_PATH_FILES = /\.(storygrid|timeline)$/i;

/** `path` moved from folder `from` to folder `to`. Only whole leading folders move: "Saltmarch" alone (a name) and "Saltmarchy/x" stay as they are. */
export function rebasePath(path: string, from: string, to: string): string {
	return path.startsWith(from + '/') ? to + path.slice(from.length) : path;
}

/** Deep copy of `value` with every string AND object key that is a path under `from` moved to `to`. */
export function rebaseJsonPaths(value: unknown, from: string, to: string): unknown {
	if (typeof value === 'string') return rebasePath(value, from, to);
	if (Array.isArray(value)) return value.map((v) => rebaseJsonPaths(v, from, to));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[rebasePath(k, from, to)] = rebaseJsonPaths(v, from, to);
		}
		return out;
	}
	return value;
}

const join = (root: string, rel: string): string => (rel ? `${root}/${rel}` : root);

/** Every parent folder of `paths` that lies inside `root` (root included), parents first. */
export function foldersFor(root: string, paths: string[]): string[] {
	const set = new Set<string>([root]);
	for (const p of paths) {
		if (!p.startsWith(root + '/')) continue;
		const parts = p.slice(root.length + 1).split('/');
		parts.pop(); // the file itself
		let current = root;
		for (const part of parts) {
			current = `${current}/${part}`;
			set.add(current);
		}
	}
	return [...set].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/** The whole load, worked out in memory. Throws if a packed JSON file does not parse. */
export function buildSamplePlan(
	data: SampleData,
	root: string = SAMPLE_FOLDER,
	makeId: () => string = generateEntityId,
): SamplePlan {
	const from = data.sourceRoot;
	const contents = freshEntityIds(data.textFiles.map(([, c]) => c), makeId);
	const textFiles = data.textFiles.map(([rel], i) => {
		const content = contents[i];
		if (!JSON_PATH_FILES.test(rel)) return { path: join(root, rel), content };
		const moved = rebaseJsonPaths(JSON.parse(content), from, root);
		return { path: join(root, rel), content: JSON.stringify(moved, null, 2) };
	});
	const imageFiles = data.imageFiles.map(([rel, base64]) => ({ path: join(root, rel), base64 }));
	const sceneTrees: Record<string, unknown[]> = {};
	for (const [rel, tree] of Object.entries(data.sceneTrees)) {
		sceneTrees[join(root, rel)] = rebaseJsonPaths(tree, from, root) as unknown[];
	}
	const allPaths = [...textFiles.map((f) => f.path), ...imageFiles.map((f) => f.path)];
	return {
		root,
		folders: foldersFor(root, allPaths),
		textFiles,
		imageFiles,
		sceneTrees,
		series: { name: root, rootPath: root },
		books: data.books.map((b) => ({ name: b.name, gridPath: join(root, b.gridRel) })),
	};
}

/** Base64 → bytes, for writing a picture with `vault.createBinary`. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}
