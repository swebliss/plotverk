// Pure Prose Coach settings helpers — no Obsidian imports.
import { normalizeWord } from './tokenize';
import { isMetadataLine } from './mask';

/**
 * When the coach's marks show in the text:
 * - off: never.
 * - revising: only in a scene whose frontmatter `status` is written / revised / final.
 * - always: in every note.
 * A running sprint forces marks off whatever the mode, then restores.
 */
export type CoachMode = 'off' | 'revising' | 'always';

export const COACH_MODES: readonly CoachMode[] = ['off', 'revising', 'always'];

/** Scene statuses that count as "revising". */
export const REVISING_STATUSES: ReadonlySet<string> = new Set(['written', 'revised', 'final']);

/** The saved shape (`StorygridSettings.proseCoach`). Every field optional. */
export interface ProseCoachSettings {
	adverbs?: boolean;
	passive?: boolean;
	repetition?: boolean;
	/** Pro checks (src/prose/pro) — on unless switched off. */
	wordy?: boolean;
	crutch?: boolean;
	names?: boolean;
	rhythm?: boolean;
	dialogue?: boolean;
	mode?: CoachMode;
	/** "Never this word": normalizeWord keys, global across the vault. */
	neverWords?: string[];
	/** "Not here": scene path → dismissal keys `${kind}:${word}`. */
	dismissed?: Record<string, string[]>;
	/** Legacy: read once by migrateProseCoach, then deleted. */
	highlightsAlwaysOn?: boolean;
	/** Legacy: the old help-level switch; deleted by migrateProseCoach. */
	helpLevel?: string;
}

/** The mode in force, with the legacy flag read if a migration has not run yet. */
export function resolveCoachMode(s?: ProseCoachSettings): CoachMode {
	if (s?.mode && COACH_MODES.includes(s.mode)) return s.mode;
	return s?.highlightsAlwaysOn === true ? 'always' : 'off';
}

/** Whether a scene with this frontmatter `status` counts as "revising". */
export function isRevisingStatus(status: unknown): boolean {
	return typeof status === 'string' && REVISING_STATUSES.has(status.trim().toLowerCase());
}

/**
 * Whether a note counts as "revising" for the While revising mode.
 * Frontmatter `status` wins when it is set. Otherwise the scene metadata
 * lines decide (`*POV: … · Status: written*` — one note can hold several
 * scenes): every Status on them must be written / revised / final.
 * No status anywhere → not revising.
 */
export function noteIsRevising(frontmatterStatus: unknown, text: string): boolean {
	if (typeof frontmatterStatus === 'string' && frontmatterStatus.trim()) return isRevisingStatus(frontmatterStatus);
	const statuses: string[] = [];
	for (const line of text.split('\n')) {
		if (!isMetadataLine(line)) continue;
		const m = /status[ \t]*[*_]*[ \t]*:[ \t]*[*_]*[ \t]*([^·*_\r\n]+)/i.exec(line);
		if (m) statuses.push(m[1]);
	}
	return statuses.length > 0 && statuses.every(isRevisingStatus);
}

/**
 * One-time, idempotent clean-up of saved settings. Returns true when anything
 * changed (so the caller saves).
 * - `highlightsAlwaysOn: true` → `mode: 'always'`; anything else → `'off'`.
 * - drops `highlightsAlwaysOn` and `helpLevel`.
 * - `neverWords`: strings only, normalized, no blanks, no duplicates.
 * - `dismissed`: string arrays only, no duplicates, no empty scenes.
 */
export function migrateProseCoach(s: ProseCoachSettings): boolean {
	let changed = false;
	if (!s.mode || !COACH_MODES.includes(s.mode)) {
		s.mode = s.highlightsAlwaysOn === true ? 'always' : 'off';
		changed = true;
	}
	if ('highlightsAlwaysOn' in s) { delete s.highlightsAlwaysOn; changed = true; }
	if ('helpLevel' in s) { delete s.helpLevel; changed = true; }

	if (s.neverWords !== undefined) {
		const clean = cleanNeverWords(s.neverWords);
		if (!Array.isArray(s.neverWords) || clean.length !== s.neverWords.length || clean.some((w, i) => w !== s.neverWords![i])) {
			s.neverWords = clean;
			changed = true;
		}
	}
	if (s.dismissed !== undefined) {
		const clean = cleanDismissed(s.dismissed);
		if (JSON.stringify(clean) !== JSON.stringify(s.dismissed)) {
			s.dismissed = clean;
			changed = true;
		}
	}
	return changed;
}

function cleanNeverWords(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	for (const w of raw) {
		if (typeof w !== 'string') continue;
		const key = normalizeWord(w.trim());
		if (key && !out.includes(key)) out.push(key);
	}
	return out;
}

function cleanDismissed(raw: unknown): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const [path, keys] of Object.entries(raw as Record<string, unknown>)) {
		if (!Array.isArray(keys)) continue;
		const clean = [...new Set(keys.filter((k): k is string => typeof k === 'string' && k.includes(':')))];
		if (clean.length > 0) out[path] = clean;
	}
	return out;
}

/** "Never this word": adds the word to the global list. Returns true if it was new. */
export function addNeverWord(s: ProseCoachSettings, word: string): boolean {
	const key = normalizeWord(word.trim());
	if (!key) return false;
	const list = (s.neverWords ??= []);
	if (list.includes(key)) return false;
	list.push(key);
	return true;
}

/** Takes a word back off the "never" list. Returns true if it was there. */
export function removeNeverWord(s: ProseCoachSettings, word: string): boolean {
	const key = normalizeWord(word.trim());
	const list = s.neverWords;
	if (!list) return false;
	const i = list.indexOf(key);
	if (i === -1) return false;
	list.splice(i, 1);
	return true;
}

/** "Not here": hides `${kind}:${word}` in this one scene. Returns true if it was new. */
export function dismissInScene(s: ProseCoachSettings, scenePath: string, key: string): boolean {
	if (!scenePath || !key) return false;
	const map = (s.dismissed ??= {});
	const list = (map[scenePath] ??= []);
	if (list.includes(key)) return false;
	list.push(key);
	return true;
}

/** The "Not here" keys for one scene, as a set for scanAll. */
export function dismissedFor(s: ProseCoachSettings | undefined, scenePath: string): Set<string> {
	return new Set(s?.dismissed?.[scenePath] ?? []);
}

/** Drops "Not here" choices for a deleted scene (or every scene under a deleted folder). */
export function forgetDismissedPath(s: ProseCoachSettings, path: string): boolean {
	const map = s.dismissed;
	if (!map) return false;
	let changed = false;
	for (const p of Object.keys(map)) {
		if (p === path || p.startsWith(`${path}/`)) {
			delete map[p];
			changed = true;
		}
	}
	return changed;
}

/**
 * Keeps "Not here" choices attached to a scene when the scene — or a folder
 * above it — is renamed or moved. Returns true if anything moved.
 */
export function renameDismissedPaths(s: ProseCoachSettings, oldPath: string, newPath: string): boolean {
	const map = s.dismissed;
	if (!map || oldPath === newPath) return false;
	let changed = false;
	const oldPrefix = `${oldPath}/`;
	for (const path of Object.keys(map)) {
		let next: string | null = null;
		if (path === oldPath) next = newPath;
		else if (path.startsWith(oldPrefix)) next = `${newPath}/${path.slice(oldPrefix.length)}`;
		if (next === null) continue;
		const merged = [...new Set([...(map[next] ?? []), ...map[path]])];
		delete map[path];
		map[next] = merged;
		changed = true;
	}
	return changed;
}
