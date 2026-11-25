import { Editor, MarkdownView, Notice, TFile } from 'obsidian';
import type StorygridPlugin from '../main';
import { aliasRename, AliasRename, replayAliasEdits, rewriteAliasLinks, TextSwap } from './alias-follow';
import { AliasFollowModal } from '../modals/alias-follow-modal';
import {
	addTextChange, cleanTextChanges, findTextChange, newTextChangeId, placesIn, TextChangeFile, TextChangeRecord,
} from '../utils/text-changes';
import { isSafetyNetPath } from '../utils/safety-paths';
import { snapshotScene } from '../utils/scene-snapshots';
import { writeProjectMirror } from '../utils/project-data-store';
import { plotverkEvents } from '../utils/plotverk-events';
import { reportError, runSafely } from '../utils/report-error';
import { t } from '../i18n';

/** Aliases typed elsewhere (Properties panel, source mode, Sync) settle this long before they count as a rename. */
const SETTLE_MS = 4000;
/** An edit counts as the writer's own only if she typed or clicked in Obsidian this recently. */
const RECENT_INPUT_MS = 30000;
/** Edits seen this soon after start-up are files catching up (Sync, iCloud), never the writer typing. */
const STARTUP_QUIET_MS = 15000;

/** Event fired when a text change is recorded, undone or redone (the Activity history listens). */
export const TEXT_CHANGES_EVENT = 'storygrid:text-changes';

function cleanAliases(raw: unknown): string[] {
	const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
	return [...new Set(list.filter((a): a is string => typeof a === 'string').map((a) => a.trim()).filter(Boolean))];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function placesWord(n: number): string {
	return n === 1 ? t('aliasFollow.places.one') : t('aliasFollow.places', { count: n });
}

export function notesWord(n: number): string {
	return n === 1 ? t('aliasFollow.notes.one') : t('aliasFollow.notes', { count: n });
}

interface FoundFile {
	file: TFile;
	count: number;
}

/**
 * "An alias changed in the Codex changes in the text." Watches every Codex
 * sheet's `aliases`; when one is clearly renamed (Dad → Papa) — in the sheet
 * form, the Properties panel or on another device — it counts the links to
 * that sheet showing the old word and, if there are any, asks before changing
 * them. Each change is snapshotted first, recorded for the Activity history
 * and can be undone / redone from there (only those links, never whole files).
 */
export class AliasFollow {
	/** Sheet path → its aliases as last seen. */
	private known = new Map<string, string[]>();
	/** Sheet path → the aliases before a burst of edits, while it settles. */
	private settling = new Map<string, { baseline: string[]; timer: number }>();
	/** `path|from|to` being counted or asked about right now (one question per edit). */
	private asking = new Set<string>();
	/** Record ids being undone / redone right now (the notice and Activity can't both run one). */
	private replaying = new Set<string>();
	/** When the sheets were first read (start-up). */
	private seededAt = 0;

	/** When the writer last typed or clicked in Obsidian's main window. */
	private lastInputAt = 0;

	constructor(private readonly plugin: StorygridPlugin) {
		const mark = () => { this.lastInputAt = Date.now(); };
		plugin.registerDomEvent(window, 'keydown', mark, { capture: true });
		plugin.registerDomEvent(window, 'pointerdown', mark, { capture: true });
	}

	private get app() {
		return this.plugin.app;
	}

	// ── Watching the sheets ────────────────────────────────────────────────────

	private sheetAliases(file: TFile): string[] | null {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm || !fm['storygrid-type']) return null;
		return cleanAliases(fm.aliases);
	}

	/** Remember every sheet's aliases as they are now (layout ready), and mend any damaged records. */
	seed(): void {
		this.seededAt = Date.now();
		const map = this.plugin.settings.dashboard?.textChanges;
		if (map) for (const key of Object.keys(map)) map[key] = cleanTextChanges(map[key]);
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (isSafetyNetPath(file.path)) continue;
			const aliases = this.sheetAliases(file);
			if (aliases) this.known.set(file.path, aliases);
		}
	}

	/** A note's metadata changed: a sheet whose aliases changed starts settling. */
	handleChange(file: TFile): void {
		if (isSafetyNetPath(file.path)) return;
		const now = this.sheetAliases(file);
		if (!now) {
			this.forget(file.path);
			return;
		}
		const prev = this.known.get(file.path);
		this.known.set(file.path, now);
		// Not seen before (just created, or before the first seed): nothing to compare with.
		if (prev === undefined) return;
		// Only an edit made here, on the sheet in front of the writer (Properties
		// panel, source mode), asks. A change arriving by Sync from another device
		// was already asked about there — asking again could rewrite this device's
		// not-yet-synced copies of the scenes.
		// An idle computer left on the sheet (window in the background, nobody
		// typing) is not "here" either.
		const local = this.seededAt > 0 && Date.now() - this.seededAt > STARTUP_QUIET_MS
			&& this.app.workspace.getActiveFile()?.path === file.path
			&& activeDocument.hasFocus()
			&& Date.now() - this.lastInputAt < RECENT_INPUT_MS;
		if (!local && !this.settling.has(file.path)) return;
		const pending = this.settling.get(file.path);
		if (!pending && sameList(prev, now)) return;
		const baseline = pending?.baseline ?? prev;
		if (pending) window.clearTimeout(pending.timer);
		const timer = window.setTimeout(() => {
			this.settling.delete(file.path);
			const rename = aliasRename(baseline, this.known.get(file.path) ?? []);
			if (rename) runSafely(this.offer(file, rename));
		}, SETTLE_MS);
		this.settling.set(file.path, { baseline, timer });
	}

	handleRename(file: TFile, oldPath: string): void {
		const aliases = this.known.get(oldPath);
		if (aliases) {
			this.known.delete(oldPath);
			this.known.set(file.path, aliases);
		}
		const pending = this.settling.get(oldPath);
		if (pending) {
			this.settling.delete(oldPath);
			this.settling.set(file.path, pending);
		}
	}

	forget(path: string): void {
		this.known.delete(path);
		const pending = this.settling.get(path);
		if (pending) window.clearTimeout(pending.timer);
		this.settling.delete(path);
	}

	/** Stop every waiting timer (plugin unload). */
	dispose(): void {
		for (const p of this.settling.values()) window.clearTimeout(p.timer);
		this.settling.clear();
	}

	/**
	 * The sheet form saved this sheet with these aliases (`before` = on disk
	 * just before the save). Asked a moment later, once the form has closed,
	 * so the question never stacks on top of it.
	 */
	sheetSaved(file: TFile, before: readonly string[], after: readonly string[]): void {
		const pending = this.settling.get(file.path);
		if (pending) window.clearTimeout(pending.timer);
		this.settling.delete(file.path);
		this.known.set(file.path, cleanAliases([...after]));
		const rename = aliasRename(before, after);
		if (!rename) return;
		window.setTimeout(() => runSafely(this.offer(file, rename)), 350);
	}

	// ── Asking ─────────────────────────────────────────────────────────────────

	private sheetName(file: TFile): string {
		return this.plugin.entityIndex.getAllEntities().find((e) => e.file.path === file.path)?.name || file.basename;
	}

	/** Count the places and, when there are any, ask. Never silent, never without asking. */
	async offer(sheet: TFile, rename: AliasRename): Promise<void> {
		// An alias renamed to the sheet's own name would freeze the name into the
		// links (a later rename in the Codex would no longer reach them): left alone.
		const name = this.sheetName(sheet).toLocaleLowerCase();
		const to = rename.to.toLocaleLowerCase();
		if (to === name || to === sheet.basename.toLocaleLowerCase()) return;

		const key = `${sheet.path}|${rename.from}|${rename.to}`;
		if (this.asking.has(key)) return;
		this.asking.add(key);
		let opened = false;
		try {
			const found = await this.findPlaces(sheet, rename);
			const places = found.reduce((n, f) => n + f.count, 0);
			if (!places) return;
			new AliasFollowModal(
				this.app,
				t('aliasFollow.ask', { from: rename.from, to: rename.to, places: placesWord(places), notes: notesWord(found.length) }),
				t('aliasFollow.ask.detail', { name: this.sheetName(sheet) }),
				() => runSafely(this.apply(sheet, rename)),
				() => this.asking.delete(key),
			).open();
			opened = true;
		} finally {
			if (!opened) this.asking.delete(key);
		}
	}

	/** The project the sheet belongs to ('' = the vault root). */
	private rootOf(sheet: TFile | string): string {
		return this.plugin.entityIndex.rootFor(typeof sheet === 'string' ? sheet : sheet.path) ?? '';
	}

	/** Notes in the sheet's project that link to it, with how many links show the old word. */
	private async findPlaces(sheet: TFile, rename: AliasRename): Promise<FoundFile[]> {
		const root = this.rootOf(sheet);
		const out: FoundFile[] = [];
		for (const [src, dests] of Object.entries(this.app.metadataCache.resolvedLinks)) {
			if (!dests || !dests[sheet.path]) continue;
			if (isSafetyNetPath(src) || (root && !src.startsWith(`${root}/`))) continue;
			const file = this.app.vault.getAbstractFileByPath(src);
			if (!(file instanceof TFile) || file.extension !== 'md') continue;
			const text = await this.currentText(file);
			const { edits } = rewriteAliasLinks(text, this.targetIs(sheet.path, src), rename.from, rename.to);
			if (edits.length) out.push({ file, count: edits.length });
		}
		return out;
	}

	/** "Does this link (written in `sourcePath`) point at the sheet?" — Obsidian's own link resolution. */
	private targetIs(sheetPath: string, sourcePath: string): (linkpath: string) => boolean {
		return (linkpath) => this.app.metadataCache.getFirstLinkpathDest(linkpath.trim(), sourcePath)?.path === sheetPath;
	}

	// ── Changing the text ──────────────────────────────────────────────────────

	/** The note's open editor in editing mode, if any (changes there keep the cursor and Obsidian's undo). */
	private openEditor(path: string): Editor | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === path && view.getMode() === 'source') return view.editor;
		}
		return null;
	}

	private async currentText(file: TFile): Promise<string> {
		return this.openEditor(file.path)?.getValue() ?? this.app.vault.read(file);
	}

	/**
	 * Work out the change on the note's text as it is right now and make it:
	 * through the open editor when the note is open (word by word), otherwise
	 * with one atomic `vault.process`.
	 */
	private async change<R extends { text: string; changes: TextSwap[] }>(file: TFile, plan: (text: string) => R): Promise<R> {
		const editor = this.openEditor(file.path);
		if (editor) {
			const res = plan(editor.getValue());
			if (res.changes.length) {
				editor.transaction({
					changes: res.changes.map((c) => ({ from: editor.offsetToPos(c.start), to: editor.offsetToPos(c.end), text: c.word })),
				});
			}
			return res;
		}
		let res: R | null = null;
		await this.app.vault.process(file, (data) => {
			res = plan(data);
			return res.text;
		});
		return res!;
	}

	/**
	 * Snapshot the note as it is now (the last-resort way back: right-click →
	 * Snapshots). False when no safety copy could be written: the note is then
	 * left exactly as it is.
	 */
	private async snapshot(file: TFile): Promise<boolean> {
		return (await snapshotScene(this.app, file.path, await this.currentText(file), 'pre-change')) !== 'failed';
	}

	private dashboard() {
		const settings = this.plugin.settings;
		settings.dashboard ??= { goals: {}, todos: {}, typedWords: {}, streaks: {} };
		return settings.dashboard;
	}

	private async saveRecords(root: string): Promise<void> {
		await this.plugin.saveSettingsQuiet();
		// A sheet outside every project has no project folder to keep a copy in.
		if (root) void writeProjectMirror(this.app, root, this.dashboard());
		plotverkEvents.dispatchEvent(new CustomEvent(TEXT_CHANGES_EVENT));
	}

	/** "Change them": snapshot, change, record, and say so with an Undo button. */
	private async apply(sheet: TFile, rename: AliasRename): Promise<void> {
		// The alias may have changed again while the question was open: an old answer never writes an old word.
		const now = this.sheetAliases(sheet) ?? [];
		if (!now.includes(rename.to) || now.includes(rename.from)) {
			new Notice(t('aliasFollow.notice.stale'));
			return;
		}
		const found = await this.findPlaces(sheet, rename);
		const files: TextChangeFile[] = [];
		let failed = 0;
		for (const { file } of found) {
			try {
				if (!(await this.snapshot(file))) { failed++; continue; }
				const res = await this.change(file, (text) => rewriteAliasLinks(text, this.targetIs(sheet.path, file.path), rename.from, rename.to));
				if (res.edits.length) files.push({ path: file.path, edits: res.edits });
			} catch (err) {
				failed++;
				reportError(err);
			}
		}
		if (failed) new Notice(t('aliasFollow.notice.someFailed', { notes: notesWord(failed) }));
		if (!files.length) return;

		const fm = this.app.metadataCache.getFileCache(sheet)?.frontmatter;
		const record: TextChangeRecord = {
			id: newTextChangeId(),
			at: new Date().toISOString(),
			kind: 'alias',
			sheetPath: sheet.path,
			sheetId: typeof fm?.['storygrid-id'] === 'string' ? fm['storygrid-id'] : null,
			sheetName: this.sheetName(sheet),
			from: rename.from,
			to: rename.to,
			files,
			state: 'applied',
		};
		const root = this.rootOf(sheet);
		addTextChange(this.dashboard().textChanges ??= {}, root, record);
		await this.saveRecords(root);
		this.notice(t('aliasFollow.notice.done', { from: rename.from, to: rename.to, places: placesWord(placesIn(record)) }), record.id, 'undo');
	}

	/** The sheet a record is about, wherever it is now. */
	private sheetOf(record: TextChangeRecord): TFile | null {
		if (record.sheetId) {
			const hit = this.plugin.entityIndex.getAllEntities().find((e) => e.entityId === record.sheetId);
			if (hit) return hit.file;
		}
		const file = this.app.vault.getAbstractFileByPath(record.sheetPath);
		return file instanceof TFile ? file : null;
	}

	/**
	 * Undo (Papa → Dad) or redo (Dad → Papa) a recorded change on just the links
	 * it changed that still read the same, with the same text around them.
	 * Links edited since are left alone and counted.
	 */
	async replay(id: string, direction: 'undo' | 'redo'): Promise<void> {
		if (this.replaying.has(id)) return;
		this.replaying.add(id);
		try {
			await this.replayOnce(id, direction);
		} finally {
			this.replaying.delete(id);
		}
	}

	private async replayOnce(id: string, direction: 'undo' | 'redo'): Promise<void> {
		const hit = findTextChange(this.dashboard().textChanges, id);
		if (!hit) return;
		const { record, root } = hit;
		if ((direction === 'undo') !== (record.state === 'applied')) return;
		// Only well-formed file entries are replayed (a damaged copy never throws half-way).
		const clean = cleanTextChanges([record])[0];
		if (!clean) {
			new Notice(t('aliasFollow.notice.nothing'));
			return;
		}
		const sheet = this.sheetOf(record);
		const gone = (record.sheetPath.split('/').pop() ?? '').replace(/\.md$/i, '').toLocaleLowerCase();
		let done = 0;
		let left = 0;
		let failed = 0;
		for (const f of clean.files) {
			const file = this.app.vault.getAbstractFileByPath(f.path);
			if (!(file instanceof TFile)) {
				left += f.edits.length;
				continue;
			}
			// The sheet itself was deleted: links still name it by its file name.
			const isTarget = sheet
				? this.targetIs(sheet.path, file.path)
				: (lp: string) => (lp.trim().split('/').pop() ?? '').replace(/\.md$/i, '').toLocaleLowerCase() === gone;
			try {
				if (!(await this.snapshot(file))) {
					failed++;
					left += f.edits.length;
					continue;
				}
				const res = await this.change(file, (text) => replayAliasEdits(text, isTarget, f.edits, direction));
				done += res.done;
				left += res.left;
			} catch (err) {
				left += f.edits.length;
				reportError(err);
			}
		}
		if (failed) new Notice(t('aliasFollow.notice.someFailed', { notes: notesWord(failed) }));
		if (!done) {
			if (!failed) new Notice(t('aliasFollow.notice.nothing'));
			return;
		}
		record.state = direction === 'undo' ? 'undone' : 'applied';
		await this.saveRecords(root);
		const message = direction === 'undo'
			? t('aliasFollow.notice.undone', { from: record.from, places: placesWord(done) })
			: t('aliasFollow.notice.redone', { to: record.to, places: placesWord(done) });
		const leftLine = left === 0 ? '' : ' ' + (left === 1 ? t('aliasFollow.notice.left.one') : t('aliasFollow.notice.left', { count: left }));
		this.notice(message + leftLine, record.id, direction === 'undo' ? 'redo' : 'undo');
	}

	private notice(message: string, id: string, next: 'undo' | 'redo'): void {
		const fragment = createFragment();
		fragment.createSpan({ text: message });
		const btn = fragment.createEl('button', {
			cls: 'sg-setup-notice-open sg-alias-follow-notice-btn',
			text: next === 'undo' ? t('aliasFollow.undo') : t('aliasFollow.redo'),
		});
		const notice = new Notice(fragment, 10000);
		btn.addEventListener('click', () => {
			notice.hide();
			this.replay(id, next).catch(reportError);
		});
	}
}
