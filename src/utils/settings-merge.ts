/**
 * Pure settings merge — no Obsidian imports, fully unit-testable.
 *
 * Lays saved data over the shipped defaults all the way down, so a nested
 * default added in a later version (a new statusColors entry, say) reaches
 * vaults whose data.json was written before it existed — the old shallow
 * Object.assign took each nested group whole from the saved side.
 *
 * Arrays are deliberately NOT merged: a palette the user deleted must stay
 * deleted, and index-merging sidebarGoalWindows would resurrect a window they
 * turned off. Everything in the result is a fresh copy, so editing a palette
 * on a fresh install can never mutate the DEFAULT_SETTINGS constant.
 */

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
	if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
	const proto: unknown = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

function clone<T>(v: T): T {
	if (Array.isArray(v)) return (v as unknown[]).map((x) => clone(x)) as unknown as T;
	if (!isPlainObject(v)) return v;
	const out: Plain = {};
	for (const key of Object.keys(v)) out[key] = clone(v[key]);
	return out as unknown as T;
}

// JSON.parse can hand back an own "__proto__" key; assigning it would swap the prototype.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** `saved` is whatever loadData() returned — a parsed data.json, or null when there is none. */
export function mergeSettings<T extends object>(defaults: T, saved: unknown): T {
	const out = clone(defaults) as unknown as Plain;
	if (!isPlainObject(saved)) return out as unknown as T;
	for (const key of Object.keys(saved)) {
		if (UNSAFE_KEYS.has(key)) continue;
		const s = saved[key];
		if (s === undefined) continue;
		const d = out[key];
		out[key] = isPlainObject(d) && isPlainObject(s) ? mergeSettings(d, s) : clone(s);
	}
	return out as unknown as T;
}
