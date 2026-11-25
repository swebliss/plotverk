import { App, TFile } from 'obsidian';
import { t } from '../i18n';
import { setPhosphorIcon } from '../utils/icons';
import { summarizeSetup } from './book-order';
import { DashFact, DashRow, dashboardSetups } from './dashboard-rows';
import type { SetupPlaces } from './setup-places';
import { readSetup } from './setup-store';
import { STAGE_ICON, stageWord } from './stage';

export interface DashSetupsHost {
	app: App;
	root: string;
	/** The book's setup sheets (Codex kind 'setup'). */
	sheets: Array<{ file: TFile; name: string }>;
	places: SetupPlaces;
	openSheet: (file: TFile) => void;
	openBoard: () => void;
}

/** Folded or open, as the writer left it (while Obsidian is open). */
let listOpen = false;
/** A scene note bigger than this has been written in (a bare one is only its properties). */
const WRITTEN_BYTES = 200;
/**
 * The bar's parts, left to right. Paid off comes first so the strongest part
 * grows from the left, like every other bar on the Dashboard, and sits right
 * under "2 of 5 paid off".
 */
const BAR_ORDER = ['paid-off', 'reminded', 'planted', 'planned'] as const;
type BarPart = (typeof BAR_ORDER)[number];
const BAR_WORDS: Record<BarPart, string> = {
	'paid-off': 'setups.dash.paid',
	reminded: 'setups.dash.reminded',
	planted: 'setups.dash.planted',
	planned: 'setups.dash.plannedOnly',
};
/** Planted but nothing written yet (only planned on cards or events) gets its own quiet part. */
const barPart = (s: { state: string; summary: { writtenYet: boolean; nextPlan: unknown } }): string =>
	s.state === 'planted' && !s.summary.writtenYet && s.summary.nextPlan ? 'planned' : s.state;

interface DashItem {
	file: TFile;
	name: string;
	state: ReturnType<typeof readSetup>['state'];
	later: boolean;
	summary: ReturnType<typeof summarizeSetup>;
}

/**
 * The Dashboard's Setups section (design v19), drawn into the section the
 * Dashboard made (title, icon, "i"): "2 of 5 paid off" over one slim bar in
 * three parts (paid off / reminded / planted) with the same parts in words
 * beneath ("2 paid off · 1 reminded · 2 planted"), one accent note when a
 * setup has gone quiet for 10+ chapters, then one line of actions ("Show all
 * setups" left, "Open the board" right) with the list folding out beneath it
 * (folded at first, remembered).
 */
export async function renderDashboardSetups(sec: HTMLElement, host: DashSetupsHost): Promise<void> {
	if (host.sheets.length === 0) {
		const empty = sec.createDiv({ cls: 'sg-dash-setups-empty' });
		setPhosphorIcon(empty.createSpan({ cls: 'sg-dash-setups-empty-icon' }), 'plant', '•');
		empty.createEl('p', { text: t('setups.board.empty') });
		return;
	}
	const lookups = await host.places.lookups(host.root);
	if (!sec.isConnected) return;
	const items: DashItem[] = host.sheets.map(({ file, name }) => {
		const info = readSetup(host.app, file, name);
		return { file, name, state: info.state, later: info.later, summary: summarizeSetup(info.marks, info.state, lookups) };
	});
	// "Where you are writing now": the furthest chapter with text in it.
	let current: number | null = null;
	lookups.orderedPaths.forEach((path, i) => {
		const f = host.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile && f.stat.size > WRITTEN_BYTES) current = i + 1;
	});
	const data = dashboardSetups(items, current);
	const body = sec.createDiv({ cls: 'sg-dash-setups' });

	// ── "2 of 5 paid off" ──
	const sum = body.createDiv({ cls: 'sg-dash-setups-sum' });
	const main = sum.createDiv({ cls: 'sg-dash-setups-sum-main' });
	main.createEl('b', { cls: 'sg-dash-num', text: t('setups.dash.count', { paid: data.paid, total: data.total }) });
	main.createSpan({ cls: 'sg-dash-setups-sum-label', text: t('setups.dash.paidOff') });
	// Where every setup of this book stands (the same setups the count is "of"):
	// one slim bar in up to three parts, and under it the same parts in words.
	const inBook = data.rows.filter((r) => r.fact.kind !== 'later');
	const parts = BAR_ORDER
		.map((state) => ({ state, n: inBook.filter((r) => barPart(r.setup) === state).length }))
		.filter((x) => x.n > 0)
		.map((x) => ({ ...x, words: t(BAR_WORDS[x.state], { n: x.n }) }));
	if (parts.length) {
		const bar = sum.createDiv({
			cls: 'sg-dash-setups-bar',
			attr: { role: 'img', 'aria-label': parts.map((p) => p.words).join(', ') },
		});
		const legend = sum.createDiv({ cls: 'sg-dash-setups-legend', attr: { 'aria-hidden': 'true' } });
		for (const { state, n, words } of parts) {
			bar.createDiv({ cls: `sg-dash-setups-bar-part is-${state}` }).style.flexGrow = String(n);
			const item = legend.createSpan({ cls: `sg-dash-setups-legend-item is-${state}` });
			setPhosphorIcon(item.createSpan({ cls: 'sg-dash-setups-legend-icon' }), STAGE_ICON[state === 'planned' ? 'planted' : state], '•');
			item.createSpan({ text: words });
		}
	}

	// ── The one quiet setup (only while the list is folded) ──
	let nudgeEl: HTMLElement | null = null;
	if (data.nudge) {
		const n = data.nudge;
		nudgeEl = body.createEl('button', { cls: 'sg-dash-setups-nudge', attr: { type: 'button' } });
		setPhosphorIcon(nudgeEl.createSpan({ cls: 'sg-dash-setups-icon' }), 'bell-ringing', '•');
		const text = nudgeEl.createSpan({ cls: 'sg-dash-setups-nudge-text' });
		text.createEl('b', { text: n.setup.name });
		text.appendText(' ' + t('setups.dash.nudgeRest', { n: n.fact.kind === 'quiet' ? n.fact.chapters : 0 }));
		setPhosphorIcon(nudgeEl.createSpan({ cls: 'sg-dash-setups-nudge-go' }), 'caret-right', '›');
		nudgeEl.addEventListener('click', () => host.openSheet(n.setup.file));
	}

	// ── One line of actions: the fold on the left, the board on the right ──
	let open = listOpen;
	const actions = body.createDiv({ cls: 'sg-dash-setups-actions' });
	const fold = actions.createEl('button', { cls: 'sg-dash-setups-fold', attr: { type: 'button' } });
	const board = actions.createEl('button', { cls: 'sg-dash-setups-board', attr: { type: 'button' } });
	board.createSpan({ text: t('setups.dash.openBoard') });
	setPhosphorIcon(board.createSpan({ cls: 'sg-dash-setups-arrow' }), 'arrow-right', '→');
	board.addEventListener('click', () => host.openBoard());

	// ── The list folds out beneath, so the fold button never moves ──
	const list = body.createDiv({ cls: 'sg-dash-setups-list' });
	list.id = `sg-dash-setups-list-${Math.random().toString(36).slice(2, 8)}`;
	fold.setAttribute('aria-controls', list.id);
	for (const row of data.rows) renderRow(list, row, host);
	if (data.letGo > 0) list.createDiv({ cls: 'sg-dash-setups-rest', text: t('setups.dash.letGo', { n: data.letGo }) });
	const set = (o: boolean) => {
		open = o;
		list.toggle(o);
		body.toggleClass('is-open', o);
		nudgeEl?.toggle(!o);
		fold.setAttribute('aria-expanded', String(o));
		fold.empty();
		setPhosphorIcon(fold.createSpan({ cls: 'sg-dash-setups-caret' }), o ? 'caret-down' : 'caret-right', o ? '▾' : '▸');
		fold.createSpan({ text: o ? t('setups.dash.hide') : t('setups.dash.showAll') });
	};
	set(open);
	fold.addEventListener('click', () => {
		set(!open);
		listOpen = open;
	});
}

function renderRow(list: HTMLElement, row: DashRow<DashItem>, host: DashSetupsHost): void {
	const s = row.setup;
	// Only planned so far: say it is not written yet rather than "Planted".
	const fact = row.fact.kind === 'stage' && !s.summary.writtenYet && s.summary.nextPlan ? t('setups.plan.notWritten') : factText(row.fact, s.state);
	const el = list.createEl('button', {
		cls: 'sg-dash-setups-row',
		attr: { type: 'button', 'aria-label': t('setups.dash.rowAria', { name: s.name, fact }) },
	});
	if (s.state === 'paid-off') el.addClass('is-done');
	if (row.quiet) el.addClass('is-quiet');
	setPhosphorIcon(el.createSpan({ cls: 'sg-dash-setups-icon' }), STAGE_ICON[s.state], '•');
	el.createSpan({ cls: 'sg-dash-setups-name', text: s.name });
	el.createSpan({ cls: 'sg-dash-setups-fact', text: fact });
	el.addEventListener('click', () => host.openSheet(s.file));
}

function factText(fact: DashFact, state: DashItem['state']): string {
	switch (fact.kind) {
		case 'paid': return fact.chapter !== null ? t('setups.dash.paidIn', { n: fact.chapter }) : stageWord(state);
		case 'later': return t('setups.forLaterBook');
		case 'quiet':
			if (fact.chapters === 0) return t('setups.dash.lastHere');
			return fact.chapters === 1 ? t('setups.dash.lastAgoOne') : t('setups.dash.lastAgoOther', { n: fact.chapters });
		case 'stage': return stageWord(state);
	}
}

