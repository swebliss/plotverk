import { App, CachedMetadata, Notice, TAbstractFile, TFile } from 'obsidian';
import type StorygridPlugin from './main';
import { EntityKind } from './entities/entity-kinds';
import { parseEntityDocument } from './entities/entity-parse';
import { updateEntityRelationships } from './entities/entity-write';
import { CustomRelationshipType, RelationLine, fieldsToRelationSections, parseRelationLines, serializeRelationLine } from './utils/relations';
import { MirrorGender, applyMirrorEdit, genderFromFields, mirrorWord, planMirrorEdits, relabelForGender, sameRelationWord } from './utils/relation-mirror';
import { isSafetyNetPath } from './utils/safety-paths';

/**
 * Keeps relationships two-sided when a sheet changes OUTSIDE the sheet editor
 * (locked rule: everything is connected):
 *  - a Gender typed in Obsidian's Properties, in source mode or arriving by
 *    sync rewords the lines about that person on other sheets;
 *  - a deleted sheet takes the lines that mirror its own off the other sheets;
 *  - a deleted sheet that comes back (trash restore: same path or same
 *    `storygrid-id`) writes them back.
 * Started once the workspace layout is ready, so the start-up flood of create
 * events never reaches it. Its own writes to other sheets fire the same
 * events, which is harmless: they change neither a Gender nor a deletion.
 */

/** What the sync remembers about one Plotverk sheet — enough to act after it is deleted. */
interface SheetState {
	kind: EntityKind;
	gender: MirrorGender;
	id: string | null;
	lines: RelationLine[];
}

/** Every relationship line a field list states — prose lines and typed link fields alike. */
export function relationLinesOf(fields: Array<{ label: string; value: string; type: string; config?: { entityLink?: boolean } }>): RelationLine[] {
	return Object.values(fieldsToRelationSections(fields)).flatMap(parseRelationLines);
}

function readSheet(text: string, basename: string): SheetState | null {
	const parsed = parseEntityDocument(text, basename);
	if (!parsed.kind) return null;
	return { kind: parsed.kind, gender: genderFromFields(parsed.fields), id: parsed.entityId, lines: relationLinesOf(parsed.fields) };
}

/** The sheet whose lines are being mirrored. `exists` is false once it has been deleted. */
export interface MirrorOwner {
	path: string;
	basename: string;
	kind: EntityKind;
	gender: MirrorGender;
	exists: boolean;
	/** Lower-cased names other sheets' links may still use (an old title or file name). */
	oldNames?: string[];
	/** Only sheets under this folder are written to (the sheet editor's project). */
	projectRoot?: string | null;
	/** Paths never written to (other sheets deleted in the same go). */
	skip?: ReadonlySet<string>;
	/** Told about each line taken off another sheet: its path and the line as it stood. */
	onRemoved?: (sheetPath: string, line: string) => void;
}

/**
 * Which sheet one of the owner's lines lands on, and the word written there —
 * the one answer both the save and the sheet editor's preview use. `file` is
 * null when the link reaches no Plotverk sheet in the project (nothing to
 * write to); `word` is null when the sheet exists but nothing goes back on it.
 * `owner.path` may be empty for a sheet not saved yet.
 */
export function mirrorTarget(
	app: App,
	customTypes: readonly CustomRelationshipType[],
	owner: Pick<MirrorOwner, 'path' | 'kind' | 'gender' | 'projectRoot' | 'skip'>,
	rel: Pick<RelationLine, 'label' | 'target'>,
): { file: TFile | null; word: string | null } {
	const cache = app.metadataCache;
	const f = cache.getFirstLinkpathDest(rel.target, owner.path);
	const inProject = (file: TFile) => !owner.projectRoot || file.path.startsWith(`${owner.projectRoot}/`);
	if (!f || (owner.path && f.path === owner.path) || f.extension !== 'md' || !inProject(f) || owner.skip?.has(f.path)) {
		return { file: null, word: null };
	}
	const t: unknown = cache.getFileCache(f)?.frontmatter?.['storygrid-type'];
	const targetKind = typeof t === 'string' && t ? (t) : null;
	if (!targetKind) return { file: null, word: null };
	return { file: f, word: mirrorWord(rel.label, { customTypes, ownerKind: owner.kind, targetKind, ownerGender: owner.gender }) };
}

/**
 * Write onto the other sheets what changed between two sets of the owner's
 * relationship lines — the one place both the sheet editor and the sync
 * write mirrored lines. Each sheet is edited through the entity write path
 * (Relationships section + its frontmatter key), one notice per sheet.
 */
export async function mirrorRelationChanges(
	app: App,
	customTypes: readonly CustomRelationshipType[],
	owner: MirrorOwner,
	before: readonly RelationLine[],
	after: readonly RelationLine[],
): Promise<void> {
	const cache = app.metadataCache;
	const files = new Map<string, TFile>();

	const edits = planMirrorEdits(before, after, (rel) => {
		const m = mirrorTarget(app, customTypes, owner, rel);
		if (!m.file || !m.word) return null;
		files.set(m.file.path, m.file);
		return { key: m.file.path, word: m.word };
	});

	const names = [owner.basename.toLowerCase(), ...(owner.oldNames ?? [])];
	for (const edit of edits) {
		const file = files.get(edit.key);
		if (!file || !(app.vault.getAbstractFileByPath(file.path) instanceof TFile)) continue;
		// A link on the other sheet points at the owner when it resolves to it, or —
		// unresolved, because it still uses an old name or the owner is deleted —
		// when it names it.
		const isOwner = (target: string): boolean => {
			const f = cache.getFirstLinkpathDest(target, file.path);
			if (f) return owner.exists && f.path === owner.path;
			return names.includes(target.trim().toLowerCase());
		};
		let added: string[] = [];
		let removed: string[] = [];
		let reported = false;
		try {
			// The link is the plain sheet name: every view (tree, map, Codex page)
			// matches relationship links by name, so that is what they all read.
			await updateEntityRelationships(app, file, (value, elsewhere) => {
				const onRemove = !reported && owner.onRemoved
					? (rel: RelationLine) => owner.onRemoved!(file.path, restorableLine(rel))
					: undefined;
				const r = applyMirrorEdit(value, { ownerName: owner.basename, isOwner, add: edit.add, remove: edit.remove, elsewhere, onRemove });
				if (!reported) { added = r.added; removed = r.removed; reported = true; }
				return r.text;
			});
			const parts = [...added.map((l) => `added “${l}”`), ...removed.map((l) => `removed “${l}”`)];
			if (parts.length) new Notice(`Plotverk: ${file.basename} — ${parts.join(', ')}.`);
		} catch (err) {
			new Notice(`Plotverk: could not update ${file.basename}. ${err instanceof Error ? err.message : ''}`);
		}
	}
}

/**
 * The line to put back on restore: the one that was there, word for word, when
 * it held only this link; out of a shared line, just this link with its note.
 */
function restorableLine(rel: RelationLine): string {
	const raw = (rel.raw ?? '').trim();
	return (raw.match(/\[\[/g) ?? []).length === 1 ? raw : serializeRelationLine(rel);
}

/** Wait this long after a Gender stops changing before rewording other sheets (typing "Female" passes through "Fe…"). */
const GENDER_SETTLE_MS = 2000;
/** Deletes arriving together (a folder, a sync) are handled as one batch. */
const DELETE_SETTLE_MS = 800;
/** Deleted sheets remembered for a restore, newest first. */
const MAX_DELETED_RECORDS = 200;

export class RelationSync {
	private sheets = new Map<string, SheetState>();
	private genderTimers = new Map<string, number>();
	private created = new Set<string>();
	private deleting: Array<{ path: string; basename: string; state: SheetState }> = [];
	private deleteTimer: number | null = null;

	constructor(private plugin: StorygridPlugin) {}

	private get app(): App {
		return this.plugin.app;
	}

	private get customTypes(): readonly CustomRelationshipType[] {
		return this.plugin.settings.customRelationshipTypes ?? [];
	}

	/** Call once, from `onLayoutReady`. */
	start(): void {
		const p = this.plugin;
		p.registerEvent(this.app.metadataCache.on('changed', (f, data, cache) => this.onChanged(f, data, cache)));
		p.registerEvent(this.app.vault.on('create', (f) => {
			if (f instanceof TFile && f.extension === 'md' && !isSafetyNetPath(f.path)) this.created.add(f.path);
		}));
		p.registerEvent(this.app.vault.on('delete', (f) => this.onDelete(f)));
		p.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
			const s = this.sheets.get(oldPath);
			if (s) {
				this.sheets.delete(oldPath);
				this.sheets.set(f.path, s);
			}
			// A Gender change waiting to settle follows the file (the Codex renames right after a save).
			const timer = this.genderTimers.get(oldPath);
			if (timer !== undefined) {
				window.clearTimeout(timer);
				this.genderTimers.delete(oldPath);
				this.scheduleGender(f.path);
			}
		}));
		p.register(() => {
			for (const t of this.genderTimers.values()) window.clearTimeout(t);
			if (this.deleteTimer !== null) window.clearTimeout(this.deleteTimer);
		});
		void this.seed();
	}

	/** Learn every Plotverk sheet once, so a later delete or Gender change has a "before". */
	private async seed(): Promise<void> {
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (isSafetyNetPath(f.path) || this.sheets.has(f.path)) continue;
			if (!this.app.metadataCache.getFileCache(f)?.frontmatter?.['storygrid-type']) continue;
			try {
				const text = await this.app.vault.cachedRead(f);
				const state = readSheet(text, f.basename);
				// An edit that arrived while this read was in flight is newer — keep it.
				if (state && !this.sheets.has(f.path)) this.sheets.set(f.path, state);
			} catch {
				// Unreadable now; the next change event will teach us this sheet.
			}
		}
	}

	private onChanged(f: TFile, data: string, cache: CachedMetadata): void {
		if (f.extension !== 'md' || isSafetyNetPath(f.path)) return;
		const prev = this.sheets.get(f.path);
		const next = cache.frontmatter?.['storygrid-type'] ? readSheet(data, f.basename) : null;
		if (!next) {
			this.sheets.delete(f.path);
			this.created.delete(f.path);
			return;
		}
		this.sheets.set(f.path, next);
		if (this.created.delete(f.path)) {
			void this.healRestored(f, next);
			return;
		}
		// Clearing the Gender (unknown) rewords nothing, the same as in the sheet editor.
		if (prev && next.gender !== null && next.gender !== prev.gender) this.scheduleGender(f.path);
	}

	private scheduleGender(path: string): void {
		const old = this.genderTimers.get(path);
		if (old !== undefined) window.clearTimeout(old);
		this.genderTimers.set(path, window.setTimeout(() => {
			this.genderTimers.delete(path);
			void this.rewordForGender(path);
		}, GENDER_SETTLE_MS));
	}

	/** Reword the lines on other characters' sheets that describe this person. */
	private async rewordForGender(path: string): Promise<void> {
		const state = this.sheets.get(path);
		const person = this.app.vault.getAbstractFileByPath(path);
		if (!state || state.gender === null || state.kind !== 'character' || !(person instanceof TFile)) return;
		const gender = state.gender;
		const cache = this.app.metadataCache;
		for (const [src, dests] of Object.entries(cache.resolvedLinks)) {
			if (src === path || !dests[path] || this.sheets.get(src)?.kind !== 'character') continue;
			const file = this.app.vault.getAbstractFileByPath(src);
			if (!(file instanceof TFile)) continue;
			const isPerson = (t: string) => cache.getFirstLinkpathDest(t, src)?.path === path;
			let changed: string[] = [];
			let reported = false;
			try {
				await updateEntityRelationships(this.app, file, (value) => {
					const r = relabelForGender(value, isPerson, gender);
					if (!reported) { changed = r.changed; reported = true; }
					return r.text;
				});
				if (changed.length) new Notice(`Plotverk: ${file.basename} — ${changed.join(', ')}.`);
			} catch (err) {
				new Notice(`Plotverk: could not update ${file.basename}. ${err instanceof Error ? err.message : ''}`);
			}
		}
	}

	private onDelete(f: TAbstractFile): void {
		if (!(f instanceof TFile) || f.extension !== 'md' || isSafetyNetPath(f.path)) return;
		const state = this.sheets.get(f.path);
		this.sheets.delete(f.path);
		this.created.delete(f.path);
		const timer = this.genderTimers.get(f.path);
		if (timer !== undefined) { window.clearTimeout(timer); this.genderTimers.delete(f.path); }
		if (!state) return;
		this.deleting.push({ path: f.path, basename: f.basename, state });
		if (this.deleteTimer !== null) window.clearTimeout(this.deleteTimer);
		this.deleteTimer = window.setTimeout(() => {
			this.deleteTimer = null;
			void this.processDeletes();
		}, DELETE_SETTLE_MS);
	}

	/**
	 * Take the deleted sheets' mirrored lines off the sheets that remain, and
	 * remember exactly what was taken (word for word, notes included) so a
	 * restore puts back the same lines.
	 */
	private async processDeletes(): Promise<void> {
		const batch = this.deleting.splice(0);
		if (batch.length === 0) return;
		const gone = new Set(batch.map((b) => b.path));
		const records = this.plugin.settings.relationDeletedSheets ?? [];
		for (const b of batch) {
			const removed: Array<{ sheet: string; line: string }> = [];
			if (b.state.lines.length > 0) {
				await mirrorRelationChanges(this.app, this.customTypes, {
					path: b.path, basename: b.basename, kind: b.state.kind, gender: b.state.gender, exists: false, skip: gone,
					onRemoved: (sheet, line) => removed.push({ sheet, line }),
				}, b.state.lines, []);
			}
			const kept = records.filter((r) => r.path !== b.path && (!b.state.id || r.id !== b.state.id));
			kept.unshift({ path: b.path, ...(b.state.id ? { id: b.state.id } : {}), at: Date.now(), ...(removed.length ? { removed } : {}) });
			records.splice(0, records.length, ...kept.slice(0, MAX_DELETED_RECORDS));
		}
		this.plugin.settings.relationDeletedSheets = records;
		await this.plugin.saveSettingsQuiet();
	}

	/**
	 * A sheet came back from the trash. It is the same sheet when its
	 * `storygrid-id` matches, or — for a sheet with no id — when it is back at
	 * the same path; a different sheet that merely reuses an old path is not.
	 * Back at the same path, the lines the delete took off other sheets go back
	 * word for word; then its own lines are mirrored again for anything missing.
	 */
	private async healRestored(f: TFile, state: SheetState): Promise<void> {
		const records = this.plugin.settings.relationDeletedSheets ?? [];
		const idx = records.findIndex((r) =>
			state.id && r.id ? r.id === state.id : r.path === f.path);
		if (idx < 0) return;
		const [record] = records.splice(idx, 1);
		this.plugin.settings.relationDeletedSheets = records;
		await this.plugin.saveSettingsQuiet();

		// The remembered lines name the sheet as it was: only valid where the sheet is back under that name.
		if (record.path === f.path) {
			const cache = this.app.metadataCache;
			for (const { sheet, line } of record.removed ?? []) {
				const file = this.app.vault.getAbstractFileByPath(sheet);
				if (!(file instanceof TFile) || file.path === f.path) continue;
				const [rel] = parseRelationLines(line);
				if (!rel) continue;
				const isOwner = (t: string) => cache.getFirstLinkpathDest(t, file.path)?.path === f.path;
				const states = (r: RelationLine) => isOwner(r.target) && sameRelationWord(r.label, rel.label);
				let restored = false;
				let first = true;
				try {
					await updateEntityRelationships(this.app, file, (value, elsewhere) => {
						if (parseRelationLines(value).some(states) || elsewhere.some(states)) return value;
						if (first) { restored = true; first = false; }
						const eol = value.includes('\r\n') ? '\r\n' : '\n';
						const trimmed = value.replace(/\s+$/, '');
						return trimmed ? `${trimmed}${eol}${line}` : line;
					});
					if (restored) new Notice(`Plotverk: ${file.basename} — put back “${line}”.`);
				} catch (err) {
					new Notice(`Plotverk: could not update ${file.basename}. ${err instanceof Error ? err.message : ''}`);
				}
			}
		}
		if (state.lines.length === 0) return;
		await mirrorRelationChanges(this.app, this.customTypes, {
			path: f.path, basename: f.basename, kind: state.kind, gender: state.gender, exists: true,
		}, [], state.lines);
	}
}
