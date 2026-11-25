import { plotverkEvents } from './utils/plotverk-events';
import { movedRoot, onPathMove } from './utils/project-move';
import { ItemView, WorkspaceLeaf, ViewStateResult, TAbstractFile } from 'obsidian';
import type StorygridPlugin from './main';
import { setPhosphorIcon } from './utils/icons';
import { isSafetyNetPath } from './utils/safety-paths';
import { findFocusScopes, StoryProject } from './entities/entity-manager';
import { getCodexKindOrder, getKindSpec } from './entities/entity-kinds';
import { ensureDashboard } from './dashboard-view';
import {
	buildHistory, formatDayHeading, isoToLocalDay,
	DayBucket, TaskDoneEvent, WordsEvent, SprintEvent, EntityCreatedEvent, TextChangeEvent,
	EntityCreationRecord,
} from './utils/history';
import { cleanTextChanges, placesIn, TextChangeRecord } from './utils/text-changes';
import { notesWord, placesWord, TEXT_CHANGES_EVENT } from './refs/alias-follow-service';
import { reportError } from './utils/report-error';
import { getLocale, hasKey, t } from './i18n';

export const VIEW_TYPE_HISTORY = 'storygrid-history-view';

export class StorygridHistoryView extends ItemView {
	private plugin: StorygridPlugin;
	private projectRoot: string | null = null;
	private refreshTimer: number | null = null;
	private _needsRender = false;

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_HISTORY; }
	getDisplayText(): string { return t('history.tabTitle'); }
	getIcon(): string { return 'clock'; }

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	async onOpen(): Promise<void> {
		this.contentEl.addClass('sg-history-root');

		const scheduleRefresh = (file?: TAbstractFile) => {
			if (file && isSafetyNetPath(file.path)) return;
			if (this.app.workspace.getMostRecentLeaf() !== this.leaf) {
				this._needsRender = true;
				return;
			}
			if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
			this.refreshTimer = window.setTimeout(() => void this.render(), 1200);
		};
		this.registerEvent(this.app.vault.on('modify', scheduleRefresh));
		this.registerEvent(this.app.vault.on('create', scheduleRefresh));
		this.registerEvent(this.app.vault.on('delete', scheduleRefresh));
		this.registerEvent(this.app.vault.on('rename', scheduleRefresh));
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			if (leaf === this.leaf && this._needsRender) {
				this._needsRender = false;
				void this.render();
			}
		}));

		// Refresh when tasks complete (fired by task-list controller)
		const taskHandler = () => void this.render();
		plotverkEvents.addEventListener('storygrid:tasks-changed', taskHandler);
		this.register(() => plotverkEvents.removeEventListener('storygrid:tasks-changed', taskHandler));

		// A change to the text was recorded, undone or redone: its row and button follow.
		const textHandler = () => void this.render();
		plotverkEvents.addEventListener(TEXT_CHANGES_EVENT, textHandler);
		this.register(() => plotverkEvents.removeEventListener(TEXT_CHANGES_EVENT, textHandler));

		// Follow the globally active project
		const projectHandler = () => void this.render();
		plotverkEvents.addEventListener('storygrid:project-changed', projectHandler);
		this.register(() => plotverkEvents.removeEventListener('storygrid:project-changed', projectHandler));
		// The project's folder was renamed or moved: keep showing it at its new place.
		this.register(onPathMove((move) => {
			if (this.projectRoot !== null) this.projectRoot = movedRoot(this.projectRoot, move) ?? this.projectRoot;
		}));

		await this.render();
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer !== null) { window.clearTimeout(this.refreshTimer); this.refreshTimer = null; }
	}

	getState(): Record<string, unknown> { return { projectRoot: this.projectRoot }; }

	async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
		if (state && typeof state.projectRoot === 'string') this.projectRoot = state.projectRoot;
		await super.setState(state, result);
		await this.render();
	}

	async showProject(projectRoot: string): Promise<void> {
		this.projectRoot = projectRoot;
		await this.plugin.setActiveProjectRoot(projectRoot);
		await this.render();
	}

	// ── Data ─────────────────────────────────────────────────────────────────

	/**
	 * Text changes kept for this project, for a series it sits in (a series
	 * Codex sheet) and for books inside it (a series showing its books'). The
	 * vault-root key ('') matches only the vault-root project.
	 */
	private collectTextChanges(root: string): TextChangeRecord[] {
		const out: TextChangeRecord[] = [];
		const map = this.plugin.settings.dashboard?.textChanges ?? {};
		for (const [key, list] of Object.entries(map)) {
			const related = key === root
				|| (root !== '' && key.startsWith(`${root}/`))
				|| (key !== '' && root.startsWith(`${key}/`));
			if (related) out.push(...cleanTextChanges(list));
		}
		return out;
	}

	private collectEntityCreations(root: string): EntityCreationRecord[] {
		const records: EntityCreationRecord[] = [];
		for (const kind of getCodexKindOrder()) {
			for (const info of this.plugin.entityIndex.list(root, kind)) {
				records.push({
					kind,
					name: info.name,
					createdAt: new Date(info.file.stat.ctime).toISOString(),
				});
			}
		}
		return records;
	}

	// ── Render ────────────────────────────────────────────────────────────────

	private async render(): Promise<void> {
		const el = this.contentEl;
		el.empty();

		const projects = findFocusScopes(this.app, this.plugin.settings);
		if (projects.length === 0) {
			el.createDiv({ cls: 'sg-history-empty' }).createDiv({
				cls: 'sg-history-empty-text',
				text: t('history.noProject.text'),
			});
			return;
		}

		// One active project everywhere: the global choice always wins.
		const project: StoryProject =
			projects.find((p) => p.rootPath === this.plugin.settings.activeProjectRoot)
			?? projects.find((p) => p.rootPath === this.projectRoot)
			?? projects[0];
		this.projectRoot = project.rootPath;

		this.renderHeader(el, project);
		this.renderBody(el, project);
	}

	private renderHeader(el: HTMLElement, project: StoryProject): void {
		const header = el.createDiv({ cls: 'sg-history-header' });

		const titleWrap = header.createDiv({ cls: 'sg-history-title' });
		const eyebrow = titleWrap.createDiv({ cls: 'sg-history-eyebrow' });
		setPhosphorIcon(eyebrow.createSpan({ cls: 'sg-history-title-icon' }), 'clock', '◷');
		eyebrow.createSpan({ text: t('history.tabTitle') });
		titleWrap.createDiv({ cls: 'sg-history-project-name', text: project.name });
	}

	private renderBody(el: HTMLElement, project: StoryProject): void {
		const body = el.createDiv({ cls: 'sg-history-body' });

		const dash = ensureDashboard(this.plugin.settings);
		const todos = dash.todos[project.rootPath] ?? [];
		const typedWords = dash.typedWords[project.rootPath] ?? {};
		// Legacy records (pre-dating project-scoped history) have no projectRoot
		// and stay visible under every project rather than vanishing everywhere.
		const sprints = (this.plugin.settings.sprintHistory ?? [])
			.filter((s) => !s.projectRoot || s.projectRoot === project.rootPath);
		const entityCreations = this.collectEntityCreations(project.rootPath);

		const textChanges = this.collectTextChanges(project.rootPath);

		const buckets = buildHistory({ todos, typedWords, sprints, entityCreations, textChanges });

		if (buckets.length === 0) {
			const empty = body.createDiv({ cls: 'sg-history-empty' });
			setPhosphorIcon(empty.createDiv({ cls: 'sg-history-empty-icon' }), 'clock-countdown', '◷');
			empty.createDiv({ cls: 'sg-history-empty-text', text: t('history.empty.title') });
			empty.createDiv({
				cls: 'sg-history-empty-sub',
				text: t('history.empty.desc'),
			});
			return;
		}

		const todayDay = isoToLocalDay(new Date().toISOString());
		for (const bucket of buckets) this.renderDayBucket(body, bucket, todayDay);
	}

	private renderDayBucket(parent: HTMLElement, bucket: DayBucket, todayDay: string): void {
		const day = parent.createDiv({ cls: 'sg-history-day' });
		day.createDiv({ cls: 'sg-history-day-heading', text: formatDayHeading(bucket.day, todayDay, getLocale()) });

		const events = day.createDiv({ cls: 'sg-history-events' });

		const taskEvents   = bucket.events.filter((e): e is TaskDoneEvent      => e.type === 'task-done');
		const wordsEvents  = bucket.events.filter((e): e is WordsEvent         => e.type === 'words');
		const entityEvents = bucket.events.filter((e): e is EntityCreatedEvent => e.type === 'entity-created');
		const sprintEvents = bucket.events.filter((e): e is SprintEvent        => e.type === 'sprint');
		const textEvents   = bucket.events.filter((e): e is TextChangeEvent    => e.type === 'text-change');

		// Tasks
		if (taskEvents.length === 1) {
			this.renderEvent(events, 'check-circle', '✓', t('history.event.taskFinished', { text: taskEvents[0].text }));
		} else if (taskEvents.length > 1) {
			this.renderEvent(events, 'check-circle', '✓', t('history.event.tasksCompleted', { count: taskEvents.length }));
		}

		// Words
		for (const e of wordsEvents) {
			this.renderEvent(events, 'note-pencil', '✍', t('history.event.wordsWritten', { count: e.count.toLocaleString(getLocale()) }));
		}

		// Entities — grouped by kind
		const byKind = new Map<string, string[]>();
		for (const e of entityEvents) {
			if (!byKind.has(e.kind)) byKind.set(e.kind, []);
			byKind.get(e.kind)!.push(e.name);
		}
		for (const [kind, names] of byKind) {
			const single = names.length === 1;
			const base = single ? 'history.event.entityCreated' : 'history.event.entitiesCreated';
			// The kind registry already holds a presentable noun for every kind it knows —
			// the worldbuilding ones included — and formats a fallback for ids it has never
			// seen, so 'water-body' reads "water bodies" rather than "water-bodys".
			const spec = getKindSpec(kind);
			const vars: Record<string, string | number> = single
				? { kind: spec.singular.toLowerCase(), name: names[0] }
				: { count: names.length, kindPlural: spec.plural.toLowerCase() };
			// Some kinds also have a per-kind string, which is what lets Spanish and French
			// agree in gender and number. The rest use the generic template above, whose
			// noun stays English until the kind registry itself is localized.
			const perKind = base + '.' + kind;
			const text = hasKey(perKind) ? t(perKind, vars) : t(base, vars);
			this.renderEvent(events, 'book-open', '◆', text);
		}

		// Sprints
		if (sprintEvents.length === 1) {
			const s = sprintEvents[0];
			const text = s.completed
				? t('history.event.sprintSingle', { words: s.words.toLocaleString(getLocale()), minutes: s.minutes })
				: t('history.event.sprintSingleStopped', { words: s.words.toLocaleString(getLocale()), minutes: s.minutes });
			this.renderEvent(events, 'timer', '⏱', text);
		} else if (sprintEvents.length > 1) {
			const totalWords = sprintEvents.reduce((n, s) => n + s.words, 0);
			const totalMins  = sprintEvents.reduce((n, s) => n + s.minutes, 0);
			this.renderEvent(events, 'timer', '⏱', t('history.event.sprintsMultiple', { count: sprintEvents.length, words: totalWords.toLocaleString(getLocale()), minutes: totalMins }));
		}

		// Changes to the text (newest first), each with its own Undo / Redo
		for (const e of [...textEvents].reverse()) this.renderTextChange(events, e.record);
	}

	private renderEvent(parent: HTMLElement, icon: string, fallback: string, text: string): HTMLElement {
		const row = parent.createDiv({ cls: 'sg-history-event' });
		const iconEl = row.createDiv({ cls: 'sg-history-event-icon' });
		setPhosphorIcon(iconEl, icon, fallback);
		row.createDiv({ cls: 'sg-history-event-text', text });
		return row;
	}

	/** "Dad" → "Papa" in the text (14 places in 6 notes) · Undo — or, once undone, · Redo. */
	private renderTextChange(parent: HTMLElement, record: TextChangeRecord): void {
		const applied = record.state === 'applied';
		const vars = {
			from: record.from, to: record.to, name: record.sheetName,
			places: placesWord(placesIn(record)), notes: notesWord(record.files.length),
		};
		const row = this.renderEvent(parent, 'pencil', '✎',
			applied ? t('history.event.aliasChange', vars) : t('history.event.aliasChange.undone', vars));
		row.addClass('sg-history-event--text-change');
		if (!applied) row.addClass('is-undone');
		const btn = row.createEl('button', {
			cls: 'sg-history-event-action',
			text: applied ? t('aliasFollow.undo') : t('aliasFollow.redo'),
		});
		btn.setAttr('aria-label', applied ? t('history.event.aliasChange.undoAria', vars) : t('history.event.aliasChange.redoAria', vars));
		btn.addEventListener('click', () => {
			btn.disabled = true;
			this.plugin.aliasFollow.replay(record.id, applied ? 'undo' : 'redo')
				.catch(reportError)
				.finally(() => { btn.disabled = false; });
		});
	}
}
