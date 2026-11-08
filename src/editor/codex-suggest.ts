import {
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	EditorPosition,
	Editor,
	TFile,
	prepareFuzzySearch,
} from 'obsidian';
import type { EntityInfo } from '../entities/entity-manager';
import { buildEntityWikilink } from '../refs/references';
import { scopeToBook } from '../refs/project-scope';
import { getKindSpec } from '../entities/entity-kinds';
import type StorygridPlugin from '../main';

/**
 * Typing @ in any markdown note opens a Codex entity picker.
 * Selecting an entry inserts [[Note|Name]] (or [[Note]] when the
 * note basename already matches the entity name).
 *
 * Works on desktop and Obsidian mobile — no custom CodeMirror decoration.
 */
export class CodexSuggest extends EditorSuggest<EntityInfo> {
	constructor(private readonly plugin: StorygridPlugin) {
		super(plugin.app);
	}

	// ─── Trigger ──────────────────────────────────────────────────────────────

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null,
	): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const before = line.slice(0, cursor.ch);

		const atIdx = before.lastIndexOf('@');
		if (atIdx === -1) return null;
		// Don't trigger on @@ (email addresses / other plugins)
		if (atIdx > 0 && before[atIdx - 1] === '@') return null;

		const query = before.slice(atIdx + 1);
		// Stop if query contains punctuation that clearly ends a name
		if (/[.,!?;:()\[\]{}"'`]/.test(query)) return null;

		return {
			start: { line: cursor.line, ch: atIdx },
			end: cursor,
			query,
		};
	}

	// ─── Suggestions ──────────────────────────────────────────────────────────

	getSuggestions(context: EditorSuggestContext): EntityInfo[] {
		// Only this note's own book or series — another project's characters are not suggestions.
		// A note outside every project still sees the whole vault.
		// Scope first, drop unstamped sheets after: a new sheet without an id yet must still find its own book.
		const all = scopeToBook(
			this.plugin.entityIndex.getAllEntities(),
			context.file?.path ?? '',
			(e) => ({ path: e.file.path, kind: e.kind }),
		).filter((e) => e.entityId !== null);

		const query = context.query.trim();
		if (!query) return all.slice(0, 20);

		const fuzzy = prepareFuzzySearch(query);
		const scored: Array<{ entity: EntityInfo; score: number }> = [];

		for (const entity of all) {
			let best = fuzzy(entity.name);

			// Also fuzzy-search frontmatter aliases
			const raw = this.app.metadataCache
				.getFileCache(entity.file)
				?.frontmatter?.['aliases'];
			const aliases: string[] = Array.isArray(raw)
				? raw.filter((a): a is string => typeof a === 'string')
				: typeof raw === 'string'
				  ? [raw]
				  : [];
			for (const alias of aliases) {
				const r = fuzzy(alias);
				if (r && (!best || r.score > best.score)) best = r;
			}

			if (best) scored.push({ entity, score: best.score });
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.map((s) => s.entity).slice(0, 30);
	}

	// ─── Rendering (3.2: kind badge handles disambiguation) ───────────────────

	renderSuggestion(entity: EntityInfo, el: HTMLElement): void {
		const spec = getKindSpec(entity.kind);
		el.addClass('sg-codex-suggest-item');

		// Kind avatar: first letter of the kind, colored per kind
		const avatar = el.createDiv({
			cls: `sg-codex-suggest-avatar sg-cs-kind--${entity.kind}`,
		});
		avatar.textContent = spec.singular[0].toUpperCase();

		const info = el.createDiv({ cls: 'sg-codex-suggest-info' });
		info.createDiv({ cls: 'sg-codex-suggest-name', text: entity.name });
		info.createDiv({ cls: 'sg-codex-suggest-kind', text: spec.singular });
	}

	// ─── Selection ────────────────────────────────────────────────────────────

	selectSuggestion(entity: EntityInfo, _evt: MouseEvent | KeyboardEvent): void {
		if (!this.context) return;
		const { editor, start, end } = this.context;
		editor.replaceRange(buildEntityWikilink(entity.file.path, entity.name), start, end);
	}
}
