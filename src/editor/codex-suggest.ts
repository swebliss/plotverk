import {
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	EditorPosition,
	Editor,
	TFile,
	prepareFuzzySearch,
	renderMatches,
} from 'obsidian';
import type { SearchMatches } from 'obsidian';
import type { EntityInfo } from '../entities/entity-manager';
import { buildEntityWikilink } from '../refs/references';
import { scopeToBook } from '../refs/project-scope';
import { getKindSpec } from '../entities/entity-kinds';
import { SETUP_KIND } from '../setups/setup-store';
import { t } from '../i18n';
import { setPhosphorIcon } from '../utils/icons';
import { linkWords, nameAfterCursor, orderByScore, orderWithoutQuery } from './suggest-order';
import type StorygridPlugin from '../main';

/** One entry in the list. `name` and `kind` are what the ordering helpers sort on. */
interface EntryRow {
	type: 'entry';
	entity: EntityInfo;
	name: string;
	kind: string;
	/** Which letters of the name the typed text matched (null: nothing typed, or an alias matched). */
	matches: SearchMatches | null;
	/** The alias that matched instead of the name, with its matched letters. */
	alias: { text: string; matches: SearchMatches } | null;
	/** Group title shown above this row ("Characters"); only while nothing is typed. */
	heading: string | null;
	/** Show the kind at the row's right edge (off where a group title already says it). */
	showKind: boolean;
}

/** The single "nothing is called that" row. It links nothing; picking it only closes the list. */
interface EmptyRow {
	type: 'empty';
	query: string;
}

type SuggestRow = EntryRow | EmptyRow;

const MAX_ROWS = 30;

/** What may sit right before an "@" that starts a word (or nothing: the start of the line). */
const WORD_START = /[\s([{"'“‘«—–-]/;

/**
 * Typing @ in any markdown note opens a Codex entity picker.
 * Selecting an entry inserts [[Note|Name]] (or [[Note]] when the
 * note basename already matches the entity name).
 *
 * Works on desktop and Obsidian mobile — no custom CodeMirror decoration.
 */
export class CodexSuggest extends EditorSuggest<SuggestRow> {
	/** What the search line at the top of the list should say for the rows being drawn. */
	private shownQuery = '';

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
		if (/[.,!?;:()[\]{}"'`]/.test(query)) return null;

		// "@" typed in front of a name already written: that entry first, and
		// picking it turns the written name into the link.
		if (!query) {
			const names = this.candidates(_file?.path ?? '').flatMap((e) => [e.name, ...this.aliasesOf(e)]);
			const written = nameAfterCursor(line.slice(cursor.ch), names);
			if (written) {
				return {
					start: { line: cursor.line, ch: atIdx },
					end: { line: cursor.line, ch: cursor.ch + written.length },
					query: written,
				};
			}
		}

		return {
			start: { line: cursor.line, ch: atIdx },
			end: cursor,
			query,
		};
	}

	// ─── Suggestions ──────────────────────────────────────────────────────────

	getSuggestions(context: EditorSuggestContext): SuggestRow[] {
		// Only this note's own book or series — another project's characters are not suggestions.
		// A note outside every project still sees the whole vault.
		// Scope first, drop unstamped sheets after: a new sheet without an id yet must still find its own book.
		// Setups are not names to mention: their names are sentences.
		const all = this.candidates(context.file?.path ?? '');

		const query = context.query.trim();
		this.shownQuery = query;
		// Nothing typed yet: characters, then items, then the rest.
		if (!query) return this.grouped(orderWithoutQuery(all).slice(0, MAX_ROWS));

		const fuzzy = prepareFuzzySearch(query);
		const scored: Array<{ entity: EntryRow; score: number }> = [];

		for (const entity of all) {
			const onName = fuzzy(entity.name);
			let best = onName;
			let alias: EntryRow['alias'] = null;

			// Also fuzzy-search frontmatter aliases
			for (const text of this.aliasesOf(entity)) {
				const r = fuzzy(text);
				if (r && (!best || r.score > best.score)) {
					best = r;
					alias = { text, matches: r.matches };
				}
			}

			if (!best) continue;
			scored.push({
				entity: {
					type: 'entry',
					entity,
					name: entity.name,
					kind: entity.kind,
					matches: alias ? null : (onName?.matches ?? null),
					alias,
					heading: null,
					showKind: true,
				},
				score: best.score,
			});
		}

		if (scored.length) return orderByScore(scored).slice(0, MAX_ROWS);

		// Nothing matches. Say so while she is still looking for a name: one word, typed after an
		// "@" that starts a word. Inside an e-mail address, or once she has written on, the list
		// just goes away as it always did.
		const line = context.editor.getLine(context.start.line);
		const beforeAt = context.start.ch > 0 ? line.charAt(context.start.ch - 1) : '';
		const startsWord = !beforeAt || WORD_START.test(beforeAt);
		return startsWord && !/\s/.test(query) ? [{ type: 'empty', query }] : [];
	}

	/** The no-typing list: a title above each group when there is more than one group. */
	private grouped(entities: EntityInfo[]): EntryRow[] {
		const groupOf = (kind: string) => (kind === 'character' || kind === 'item' ? kind : 'other');
		const several = new Set(entities.map((e) => groupOf(e.kind))).size > 1;
		let last = '';
		return entities.map((entity): EntryRow => {
			const group = groupOf(entity.kind);
			const first = group !== last;
			last = group;
			const title = group === 'other' ? t('editor.codexSuggest.others') : getKindSpec(entity.kind).plural;
			return {
				type: 'entry',
				entity,
				name: entity.name,
				kind: entity.kind,
				matches: null,
				alias: null,
				heading: several && first ? title : null,
				showKind: group === 'other' || !several,
			};
		});
	}

	/** The entries @ can offer for a note: its own book or series, stamped sheets, no setups. */
	private candidates(notePath: string): EntityInfo[] {
		return scopeToBook(
			this.plugin.entityIndex.getAllEntities(),
			notePath,
			(e) => ({ path: e.file.path, kind: e.kind }),
		).filter((e) => e.entityId !== null && e.kind !== SETUP_KIND);
	}

	private aliasesOf(entity: EntityInfo): string[] {
		const raw: unknown = this.app.metadataCache.getFileCache(entity.file)?.frontmatter?.['aliases'];
		return Array.isArray(raw)
			? raw.filter((a): a is string => typeof a === 'string')
			: typeof raw === 'string'
			  ? [raw]
			  : [];
	}

	// ─── Rendering ────────────────────────────────────────────────────────────

	renderSuggestion(row: SuggestRow, el: HTMLElement): void {
		this.syncSearchLine(el);

		if (row.type === 'empty') {
			el.addClass('sg-codex-suggest-empty');
			el.setText(t('editor.codexSuggest.noMatch', { query: row.query }));
			return;
		}

		const { entity } = row;
		const spec = getKindSpec(entity.kind);
		el.addClass('sg-codex-suggest-item');

		// Group title: a plain element placed before the row, not a row itself, so the
		// arrow keys and Enter never land on it (Obsidian keeps its own list of rows).
		if (row.heading) {
			if (el.parentElement) {
				const heading = el.parentElement.createDiv({ cls: 'sg-codex-suggest-heading', text: row.heading });
				heading.addEventListener('mousedown', (e) => e.preventDefault());
				el.before(heading);
			} else {
				el.addClass('sg-codex-suggest-item--group-start');
			}
		}

		// The entry's own picture when it has one, else its kind icon. People are round, the rest square.
		const avatar = el.createDiv({ cls: 'sg-codex-suggest-avatar' });
		if (entity.kind === 'character') avatar.addClass('is-person');
		const image = entity.imagePath ? this.app.vault.getAbstractFileByPath(entity.imagePath) : null;
		if (image instanceof TFile) {
			avatar.createEl('img', { attr: { src: this.app.vault.getResourcePath(image), alt: '', loading: 'lazy' } });
		} else {
			setPhosphorIcon(avatar, spec.icon, spec.fallbackIcon);
		}

		const name = el.createDiv({ cls: 'sg-codex-suggest-name' });
		renderMatches(name.createSpan(), row.name, row.matches);
		if (row.alias) {
			// Found by another name: show that name too, or the match looks like a mistake.
			renderMatches(name.createSpan({ cls: 'sg-codex-suggest-alias' }), row.alias.text, row.alias.matches);
		}

		if (row.showKind) el.createDiv({ cls: 'sg-codex-suggest-kind', text: spec.singular });
	}

	/**
	 * The search line at the top of the list: what she has typed, or how to search.
	 * There is no real search box on purpose: typing stays in the sentence. The line
	 * sits in the popup above the scrolling rows, and is reached from a row being
	 * drawn, so it needs nothing from Obsidian beyond the popup's own markup.
	 */
	private syncSearchLine(rowEl: HTMLElement): void {
		const popup = rowEl.closest<HTMLElement>('.suggestion-container');
		if (!popup) return;
		popup.addClass('sg-codex-suggest');

		let line = popup.querySelector<HTMLElement>(':scope > .sg-codex-suggest-search');
		if (!line) {
			line = popup.createDiv({ cls: 'sg-codex-suggest-search' });
			setPhosphorIcon(line.createSpan({ cls: 'sg-codex-suggest-search-icon' }), 'magnifying-glass');
			line.createSpan({ cls: 'sg-codex-suggest-search-text' });
			// A click here must not take the cursor out of the sentence.
			line.addEventListener('mousedown', (e) => e.preventDefault());
			popup.prepend(line);
		}

		const typed = this.shownQuery;
		if (line.dataset.query === typed) return;
		line.dataset.query = typed;
		line.toggleClass('is-typed', typed !== '');
		line.querySelector('.sg-codex-suggest-search-text')?.setText(typed || t('editor.codexSuggest.typeToSearch'));
	}

	// ─── Selection ────────────────────────────────────────────────────────────

	selectSuggestion(row: SuggestRow, _evt: MouseEvent | KeyboardEvent): void {
		if (row.type === 'empty') {
			this.close();
			return;
		}
		if (!this.context) return;
		const { editor, start, end } = this.context;
		// What the writer wrote after the "@" (typed, or already in the sentence).
		const written = editor.getRange(start, end).slice(1);
		const shown = linkWords(written, row.entity.name, this.aliasesOf(row.entity), row.alias?.text ?? null);
		editor.replaceRange(buildEntityWikilink(row.entity.file.path, shown), start, end);
	}
}
