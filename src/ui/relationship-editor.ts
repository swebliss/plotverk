import { App } from 'obsidian';
import { getLocale } from '../i18n';
import type StorygridPlugin from '../main';
import { EntityKind, getCodexKindOrder } from '../entities/entity-kinds';
import { parseEntityDocument } from '../entities/entity-parse';
import {
	RelEntity,
	RelationLine,
	RelationshipType,
	buildCustomRegistry,
	buildRelationGraph,
	classifyRelation,
	fieldsToRelationSections,
	findHierarchyLoops,
	parseRelationLines,
	partitionRelationLines,
	removeRelationFromText,
	setRelationIntensity,
} from '../utils/relations';
import { relationSentence, relationSentenceParts, sentenceShapeFor, sentenceWord } from '../utils/relation-sentence';

/**
 * Structured display for a sheet's Relationships prose — prominent rows for the
 * main relationship words, a collapsed "Other relationships" group for the
 * rest, a 1–10 strength slider on reciprocal types (Rival/Enemy/Unrequited),
 * and an "Edit as text" escape hatch back to the raw lines.
 *
 * The raw textarea REMAINS the single source of truth: it stays in the DOM
 * (hidden), and every row edit is a targeted line edit written back through
 * `textarea.value` + a synthetic 'input' event — the same route the quick-add
 * row already uses — so field.value, auto-grow, onChange and the graph
 * pipeline keep working unchanged. Prose lines that aren't relations are never
 * touched or reordered.
 */

export interface RelationshipEditorOptions {
	app: App;
	/** Enables custom-type classification and the hierarchy loop guard. */
	plugin?: StorygridPlugin | null;
	/** Project root — required for the loop guard's project-wide edge scan. */
	projectRoot?: string | null;
	/** Current sheet's display name, read live (the name box may change). */
	getOwnerName: () => string;
	/** The kind of the sheet being edited — stands in for it until it has been saved once. */
	ownerKind: EntityKind;
	/** The hidden raw textarea — the single source of truth for the field. */
	textarea: HTMLTextAreaElement;
	/** The existing quick-add row, adopted into the editor's layout unchanged. */
	adderEl?: HTMLElement;
}

export interface RelationshipEditorHandle {
	/** Re-read the textarea and rebuild the rows. */
	refresh(): void;
	/** Redraw the rows after the sheet's name changed (the sentences name it), without the project-wide loop scan. */
	relabel(): void;
}

export function mountRelationshipEditor(
	host: HTMLElement,
	opts: RelationshipEditorOptions,
): RelationshipEditorHandle {
	const { textarea: ta } = opts;
	const extraTypes: RelationshipType[] = buildCustomRegistry(
		opts.plugin?.settings.customRelationshipTypes ?? [],
	);

	const root = host.createDiv({ cls: 'sg-rel-editor' });
	const mainEl = root.createDiv({ cls: 'sg-rel-main' });
	const otherEl = root.createDiv({ cls: 'sg-rel-other' });
	// The adder and the raw toggle live BELOW the rows, in plan order:
	// main rows → other group → add row → "Edit as text".
	if (opts.adderEl) root.appendChild(opts.adderEl);
	const rawToggle = root.createEl('button', { cls: 'sg-rel-raw-toggle', text: 'Edit as text' });
	const loopEl = root.createDiv({ cls: 'sg-rel-loop-warning' });
	loopEl.hide();

	// The textarea moves inside the editor so "Edit as text" reveals it in
	// place; hidden by default in favor of the structured rows.
	root.insertBefore(ta, root.firstChild);
	ta.addClass('sg-rel-raw-ta');

	let otherExpanded = false;
	let rawMode = false;
	let loopGen = 0;

	rawToggle.addEventListener('click', () => {
		rawMode = !rawMode;
		rawToggle.setText(rawMode ? 'Done' : 'Edit as text');
		root.toggleClass('is-raw', rawMode);
		if (!rawMode) render(); // leaving raw mode — rebuild rows from edited text
		else ta.focus();
	});

	/** Write mutated section text back through the textarea's own event flow. */
	const commit = (text: string): void => {
		ta.value = text;
		ta.dispatchEvent(new Event('input'));
	};

	const renderRow = (parent: HTMLElement, rel: RelationLine): void => {
		const row = parent.createDiv({ cls: 'sg-rel-row' });
		const addLink = (into: HTMLElement): void => {
			const link = into.createEl('a', { cls: 'internal-link sg-rel-row-name', text: rel.target });
			// The editor renders inside a modal — navigating away underneath it
			// would be disorienting, so the link is inert here (it still reads as
			// the same wikilink chip used everywhere else).
			link.addEventListener('click', (e) => e.preventDefault());
		};
		// A word Plotverk knows reads as a sentence — "Tobin Ferrow is Konrad's
		// child" for `Child: [[Tobin Ferrow]]` — so its direction is never in
		// doubt. A word whose direction isn't certain (unknown, or the writer's
		// own type) keeps "Word: Name": guessing could state the opposite.
		let described = `${rel.label || 'link'} ${rel.target}`;
		if (rel.label.trim()) {
			const target = opts.app.metadataCache.getFirstLinkpathDest(rel.target, '');
			const kind: unknown = target ? opts.app.metadataCache.getFileCache(target)?.frontmatter?.['storygrid-type'] : null;
			const shape = sentenceShapeFor(rel.label, {
				customTypes: opts.plugin?.settings.customRelationshipTypes ?? [],
				ownerKind: opts.ownerKind,
				targetKind: typeof kind === 'string' ? kind as EntityKind : null,
			});
			const sentence = row.createSpan({ cls: 'sg-rel-row-sentence' });
			const sentenceOpts = { isCharacter: opts.ownerKind === 'character', otherName: rel.target, shape };
			for (const part of relationSentenceParts(opts.getOwnerName(), rel.label, getLocale(), sentenceOpts)) {
				if (part.type === 'other') addLink(sentence);
				else sentence.appendText(part.type === 'word' ? sentenceWord(rel.label, shape) : part.text);
			}
			described = relationSentence(rel.target, opts.getOwnerName(), rel.label, getLocale(), sentenceOpts);
		} else {
			row.createSpan({ cls: 'sg-rel-row-label', text: rel.label || 'Link' });
			addLink(row);
		}

		if (classifyRelation(rel.label, extraTypes).behavior === 'reciprocal') {
			const slider = row.createEl('input', { cls: 'sg-rel-intensity', type: 'range' });
			slider.min = '1';
			slider.max = '10';
			slider.value = String(rel.intensity ?? 5);
			const val = row.createSpan({
				cls: 'sg-rel-intensity-val',
				text: rel.intensity !== undefined ? String(rel.intensity) : '–',
			});
			// Live number while dragging; the text write happens once on release
			// so the row isn't rebuilt mid-drag (which would break the drag).
			slider.addEventListener('input', () => val.setText(slider.value));
			slider.addEventListener('change', () => {
				commit(setRelationIntensity(ta.value, rel, Number(slider.value)));
			});
		}

		const remove = row.createEl('button', {
			cls: 'sg-rel-row-remove',
			text: '✕',
			attr: { 'aria-label': `Remove “${described}”` },
		});
		remove.addEventListener('click', () => {
			commit(removeRelationFromText(ta.value, rel));
		});
	};

	function render(scanLoops = true): void {
		const { main, other } = partitionRelationLines(parseRelationLines(ta.value));
		mainEl.empty();
		otherEl.empty();
		for (const rel of main) renderRow(mainEl, rel);

		if (other.length > 0) {
			const toggle = otherEl.createEl('button', { cls: 'sg-rel-other-toggle' });
			toggle.createSpan({ cls: 'sg-rel-other-chevron', text: otherExpanded ? '▾' : '▸' });
			toggle.createSpan({ text: `Other relationships (${other.length})` });
			const body = otherEl.createDiv({ cls: 'sg-rel-other-body' });
			if (!otherExpanded) body.hide();
			toggle.addEventListener('click', () => {
				otherExpanded = !otherExpanded;
				render();
			});
			for (const rel of other) renderRow(body, rel);
		}
		if (scanLoops) void checkLoops(main, other);
	}

	/**
	 * Project-wide contradiction scan: rebuild the relation graph with THIS
	 * sheet's live (unsaved) text standing in for its on-disk version, then ask
	 * findHierarchyLoops whether the owner now sits inside a cycle. Runs only
	 * when the sheet actually declares a genealogy/rank relation.
	 */
	async function checkLoops(main: RelationLine[], other: RelationLine[]): Promise<void> {
		const plugin = opts.plugin;
		const projectRoot = opts.projectRoot;
		const hierarchyRels = [...main, ...other].filter((rel) => {
			const rt = classifyRelation(rel.label, extraTypes);
			return rt.behavior === 'hierarchy' || rt.category === 'parent' || rt.category === 'child';
		});
		if (!plugin || !projectRoot || hierarchyRels.length === 0) {
			loopEl.hide();
			return;
		}
		const gen = ++loopGen;
		const ownerName = opts.getOwnerName().trim();
		if (!ownerName) {
			loopEl.hide();
			return;
		}

		const jobs: Array<Promise<RelEntity | null>> = [];
		for (const kind of getCodexKindOrder()) {
			for (const info of plugin.entityIndex.list(projectRoot, kind)) {
				jobs.push(
					opts.app.vault.cachedRead(info.file).then((text) => {
						const parsed = parseEntityDocument(text, info.file.basename);
						return { path: info.file.path, name: info.file.basename, kind, sections: fieldsToRelationSections(parsed.fields) };
					}).catch(() => null),
				);
			}
		}
		const loaded = (await Promise.all(jobs)).filter((e): e is RelEntity => e !== null);
		if (gen !== loopGen) return; // a newer edit superseded this scan

		// Swap in the live editor text for this sheet so the not-yet-saved
		// relation participates in the scan.
		const existing = loaded.find((e) => e.name === ownerName);
		const entities = loaded.filter((e) => e.name !== ownerName);
		entities.push({
			path: existing?.path ?? '__editing__',
			name: ownerName,
			kind: existing?.kind ?? opts.ownerKind,
			sections: { Relationships: ta.value },
		});

		const edges = buildRelationGraph(entities, extraTypes);
		const ownPath = existing?.path ?? '__editing__';
		const loop = findHierarchyLoops(edges, extraTypes).find((cycle) => cycle.includes(ownPath));
		if (!loop) {
			loopEl.hide();
			return;
		}
		const family = hierarchyRels.some((rel) => {
			const rt = classifyRelation(rel.label, extraTypes);
			return rt.category === 'parent' || rt.category === 'child';
		});
		loopEl.empty();
		loopEl.createSpan({ cls: 'sg-rel-loop-warning-title', text: 'Logical contradiction detected. ' });
		loopEl.createSpan({
			cls: 'sg-rel-loop-warning-detail',
			text: `This would make ${ownerName} their own ${family ? 'ancestor' : 'commander'}.`,
		});
		loopEl.show();
	}

	// Every mutation (rows, quick-add, raw typing) funnels through the
	// textarea's 'input' event, so one listener keeps the rows in sync. While
	// typing raw text the rows are hidden — skip the rebuild until "Done".
	ta.addEventListener('input', () => {
		if (!rawMode) render();
	});

	render();
	return { refresh: () => render(), relabel: () => { if (!rawMode) render(false); } };
}
