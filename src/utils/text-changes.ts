// Pure — no Obsidian imports.
//
// Changes Plotverk made to the writer's text on her say-so (today: an alias
// renamed on a Codex sheet, followed into the links that show it). Each one is
// kept per project so the Activity history can show it with Undo / Redo — days
// later too. Stored in settings.dashboard.textChanges[projectRoot], mirrored
// into pvbackup/Project data.json, re-keyed when the project folder moves.

import type { AliasEdit } from '../refs/alias-follow';

/** The changed links in one note. */
export interface TextChangeFile {
	path: string;
	edits: AliasEdit[];
}

export interface TextChangeRecord {
	id: string;
	/** ISO time of the change. */
	at: string;
	kind: 'alias';
	/** The Codex sheet whose alias changed (its path then; `sheetId` finds it after a rename). */
	sheetPath: string;
	sheetId: string | null;
	sheetName: string;
	from: string;
	to: string;
	files: TextChangeFile[];
	/** 'applied' → the history row offers Undo; 'undone' → Redo. */
	state: 'applied' | 'undone';
}

/** Oldest records past this many per project are dropped (each holds only words and short snippets). */
export const MAX_TEXT_CHANGES = 200;

export function placesIn(record: TextChangeRecord): number {
	return record.files.reduce((n, f) => n + f.edits.length, 0);
}

/** A new record id (time + random, unique enough for one writer's history). */
export function newTextChangeId(now: Date = new Date()): string {
	return `tc-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Add a record to a project's list (newest last), keeping at most MAX_TEXT_CHANGES. Mutates `map`. */
export function addTextChange(map: Record<string, TextChangeRecord[]>, root: string, record: TextChangeRecord): void {
	const list = Array.isArray(map[root]) ? map[root] : (map[root] = []);
	list.push(record);
	if (list.length > MAX_TEXT_CHANGES) list.splice(0, list.length - MAX_TEXT_CHANGES);
}

/** The record with this id, wherever it is kept. */
export function findTextChange(
	map: Record<string, TextChangeRecord[]> | undefined,
	id: string,
): { root: string; record: TextChangeRecord } | null {
	for (const [root, list] of Object.entries(map ?? {})) {
		if (!Array.isArray(list)) continue;
		const record = list.find((r) => r?.id === id);
		if (record) return { root, record };
	}
	return null;
}

/** Merge two projects' lists on a move onto a folder that already has some: every record kept once, oldest first. */
export function mergeTextChanges(kept: TextChangeRecord[], moved: TextChangeRecord[]): TextChangeRecord[] {
	const seen = new Set<string>();
	const out: TextChangeRecord[] = [];
	for (const r of [...kept, ...moved]) {
		if (!r || seen.has(r.id)) continue;
		seen.add(r.id);
		out.push(r);
	}
	return out.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-MAX_TEXT_CHANGES);
}

/**
 * Point every path in the records through `map` (a rename or move). Mutates
 * the records; returns true when something changed. Damaged records are left
 * as they are.
 */
export function remapTextChangePaths(records: TextChangeRecord[], map: (p: string) => string): boolean {
	let changed = false;
	for (const r of records) {
		if (!r) continue;
		if (typeof r.sheetPath === 'string') {
			const next = map(r.sheetPath);
			if (next !== r.sheetPath) { r.sheetPath = next; changed = true; }
		}
		for (const f of Array.isArray(r.files) ? r.files : []) {
			if (!f || typeof f.path !== 'string') continue;
			const next = map(f.path);
			if (next !== f.path) { f.path = next; changed = true; }
		}
	}
	return changed;
}

function isEdit(e: unknown): e is AliasEdit {
	const x = e as Partial<AliasEdit> | null;
	return !!x && typeof x.before === 'string' && typeof x.after === 'string'
		&& typeof x.from === 'string' && typeof x.to === 'string';
}

/**
 * Records as they may come back from settings or a recovered data copy:
 * anything damaged is mended (bad file entries / edits dropped) or left out,
 * so nothing downstream ever throws on it. Returns new arrays.
 */
export function cleanTextChanges(raw: unknown): TextChangeRecord[] {
	if (!Array.isArray(raw)) return [];
	const out: TextChangeRecord[] = [];
	for (const r of raw as Array<Partial<TextChangeRecord> | null>) {
		if (!r || typeof r !== 'object') continue;
		if (typeof r.id !== 'string' || typeof r.at !== 'string' || typeof r.from !== 'string' || typeof r.to !== 'string') continue;
		if (r.state !== 'applied' && r.state !== 'undone') continue;
		if (!Array.isArray(r.files)) continue;
		const files: TextChangeFile[] = [];
		for (const f of r.files as unknown[]) {
			const file = f as Partial<TextChangeFile> | null;
			if (!file || typeof file.path !== 'string' || !Array.isArray(file.edits)) continue;
			const edits = file.edits.filter(isEdit);
			if (edits.length) files.push({ path: file.path, edits });
		}
		if (!files.length) continue;
		out.push({
			id: r.id, at: r.at, kind: 'alias',
			sheetPath: typeof r.sheetPath === 'string' ? r.sheetPath : '',
			sheetId: typeof r.sheetId === 'string' ? r.sheetId : null,
			sheetName: typeof r.sheetName === 'string' ? r.sheetName : '',
			from: r.from, to: r.to, files, state: r.state,
		});
	}
	return out;
}
