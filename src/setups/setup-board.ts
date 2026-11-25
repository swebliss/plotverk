import { TFile } from 'obsidian';
import { t } from '../i18n';
import { setPhosphorIcon } from '../utils/icons';
import { SetupSummary, compareForBoard } from './book-order';
import { SetupStage, SetupState } from './setup-marks';
import { STAGE_ICON, planLine, stageLine, stageWord } from './stage';

/** One card's worth of a setup. */
export interface BoardSetup {
	file: TFile;
	name: string;
	description: string;
	state: SetupState;
	later: boolean;
	summary: SetupSummary;
	/** Moved to this column during this session: the stage it came from (not shown on the card). */
	movedFrom: SetupStage | null;
	/** Show the short slide into the column (once, the first time the board shows the move). */
	arriving: boolean;
}

export interface BoardHost {
	setups: BoardSetup[];
	isPhone: boolean;
	openSheet: (file: TFile) => void;
	/** Set while searching: shown instead of the "nothing planted yet" help when no setup matches. */
	noMatchText?: string;
}

const COLUMNS: SetupStage[] = ['planted', 'reminded', 'paid-off'];

/** The phone shows one stage at a time; remembered while Obsidian is open. */
let phoneTab: SetupStage = 'planted';
let letGoOpen = false;

/**
 * The Setups board (design v19): three columns without boxes — Planted,
 * Reminded, Paid off — and the let-go setups folded underneath. Cards are
 * NOT draggable: a card changes column only when a reminder or payoff is
 * marked in the text. A card that just moved slides in once, without words.
 * Clicking a card opens its sheet.
 */
export function renderSetupBoard(parent: HTMLElement, host: BoardHost): void {
	const board = parent.createDiv({ cls: 'sg-setup-board' });
	if (host.isPhone) board.addClass('is-phone');

	if (host.setups.length === 0) {
		const empty = board.createDiv({ cls: 'sg-setup-board-empty' });
		if (host.noMatchText) {
			empty.createEl('p', { text: host.noMatchText });
			return;
		}
		setPhosphorIcon(empty.createDiv({ cls: 'sg-setup-board-empty-icon' }), 'plant', '🌱');
		empty.createEl('p', { text: t('setups.board.empty') });
		return;
	}

	const byStage = new Map<SetupState, BoardSetup[]>();
	for (const s of host.setups) {
		const list = byStage.get(s.state) ?? [];
		list.push(s);
		byStage.set(s.state, list);
	}
	for (const list of byStage.values()) list.sort(compareForBoard);

	// The phone: three underlined words with counts; the one shown is underlined.
	if (host.isPhone) {
		// A setup that just moved: show its new column first.
		const arrived = host.setups.find((s) => s.arriving && s.state !== 'let-go');
		if (arrived) phoneTab = arrived.state as SetupStage;
		const tabs = board.createDiv({ cls: 'sg-setup-board-tabs', attr: { role: 'tablist', 'aria-label': t('setups.board.columnsAria') } });
		for (const stage of COLUMNS) {
			const tab = tabs.createEl('button', {
				cls: 'sg-setup-board-tab',
				attr: { type: 'button', role: 'tab', 'aria-selected': String(stage === phoneTab) },
			});
			tab.createSpan({ text: stageWord(stage) });
			tab.createSpan({ cls: 'sg-setup-board-tab-count', text: String(byStage.get(stage)?.length ?? 0) });
			tab.addEventListener('click', () => {
				phoneTab = stage;
				board.remove();
				renderSetupBoard(parent, host);
			});
		}
	}

	const cols = board.createDiv({ cls: 'sg-setup-board-cols', attr: { role: 'group', 'aria-label': t('setups.board.columnsAria') } });
	for (const stage of COLUMNS) {
		if (host.isPhone && stage !== phoneTab) continue;
		const list = byStage.get(stage) ?? [];
		const col = cols.createDiv({ cls: 'sg-setup-board-col', attr: { 'data-stage': stage } });
		if (stage === 'paid-off') col.addClass('is-done');
		if (!host.isPhone) {
			const head = col.createDiv({ cls: 'sg-setup-board-col-head' });
			setPhosphorIcon(head.createSpan({ cls: 'sg-setup-stage-icon' }), STAGE_ICON[stage], '•');
			head.createSpan({ cls: 'sg-setup-board-col-word', text: stageWord(stage) });
			head.createSpan({ cls: 'sg-setup-board-col-count', text: String(list.length) });
		}
		if (list.length === 0) col.createDiv({ cls: 'sg-setup-board-col-empty', text: t('setups.board.emptyColumn') });
		for (const s of list) renderCard(col, s, host);
	}

	// Let go: folded under the board, never deleted, picked up again from the sheet.
	const letGo = byStage.get('let-go') ?? [];
	if (letGo.length > 0) {
		const fold = board.createEl('button', {
			cls: 'sg-setup-board-fold',
			attr: { type: 'button', 'aria-expanded': String(letGoOpen) },
		});
		setPhosphorIcon(fold.createSpan({ cls: 'sg-setup-stage-icon' }), STAGE_ICON['let-go'], '•');
		fold.createSpan({ cls: 'sg-setup-board-fold-word', text: stageWord('let-go') });
		fold.createSpan({ cls: 'sg-setup-board-col-count', text: String(letGo.length) });
		setPhosphorIcon(fold.createSpan({ cls: 'sg-setup-board-fold-caret' }), letGoOpen ? 'caret-down' : 'caret-right', '›');
		const shelf = board.createDiv({ cls: 'sg-setup-board-letgo' });
		shelf.toggle(letGoOpen);
		for (const s of letGo) renderCard(shelf, s, host);
		fold.addEventListener('click', () => {
			letGoOpen = !letGoOpen;
			board.remove();
			renderSetupBoard(parent, host);
		});
	}
}

let explainOpen = false;
let explainSeq = 0;

/**
 * The small "i" beside the Setups title, and the explanation for new writers
 * it opens underneath: what a setup is, the three stages with an example, why
 * it matters in a book, and how to mark one. A toggle (works on a phone, no
 * hover there); stays open across redraws while Obsidian is open.
 */
export function renderSetupsExplainer(titleEl: HTMLElement, parent: HTMLElement): void {
	const panel = parent.createDiv({ cls: 'sg-setup-explain' });
	panel.id = `sg-setup-explain-${++explainSeq}`;
	panel.toggle(explainOpen);
	panel.createEl('p', { cls: 'sg-setup-explain-intro', text: t('setups.info.intro') });
	const stages = panel.createDiv({ cls: 'sg-setup-explain-stages' });
	const rows: [SetupStage, string][] = [
		['planted', 'setups.info.planted'],
		['reminded', 'setups.info.reminded'],
		['paid-off', 'setups.info.paidOff'],
	];
	for (const [stage, key] of rows) {
		const row = stages.createDiv({ cls: 'sg-setup-explain-stage', attr: { 'data-stage': stage } });
		setPhosphorIcon(row.createSpan({ cls: 'sg-setup-stage-icon' }), STAGE_ICON[stage], '•');
		const text = row.createSpan({ cls: 'sg-setup-explain-stage-text' });
		text.createEl('b', { text: stageWord(stage) });
		text.appendText(' — ' + t(key));
	}
	panel.createEl('p', { cls: 'sg-setup-explain-why', text: t('setups.info.why') });
	panel.createEl('p', { cls: 'sg-setup-explain-how', text: t('setups.info.how') });

	titleEl.addClass('has-setup-info');
	const info = titleEl.createEl('button', {
		cls: 'sg-setup-info',
		attr: { type: 'button', 'aria-label': t('setups.info.aria'), 'aria-expanded': String(explainOpen), 'aria-controls': panel.id },
	});
	setPhosphorIcon(info, 'info', 'i');
	info.addEventListener('click', (e) => {
		e.stopPropagation();
		explainOpen = !explainOpen;
		panel.toggle(explainOpen);
		info.setAttribute('aria-expanded', String(explainOpen));
	});
}

function renderCard(parent: HTMLElement, s: BoardSetup, host: BoardHost): void {
	const card = parent.createDiv({ cls: 'sg-setup-card', attr: { role: 'button', tabindex: '0', 'aria-label': s.name } });
	if (s.state === 'paid-off' || s.state === 'let-go') card.addClass('is-done');
	const stage = card.createDiv({ cls: 'sg-setup-card-stage' });
	setPhosphorIcon(stage.createSpan({ cls: 'sg-setup-stage-icon' }), STAGE_ICON[s.state], '•');
	const text = stage.createSpan({ cls: 'sg-setup-card-stage-text' });
	const plan = s.state === 'planted' || s.state === 'reminded' ? s.summary.nextPlan : null;
	if (!s.summary.writtenYet && plan) {
		// Only planned so far (on a grid card or timeline event): say so, no stage word in bold.
		card.addClass('is-planned');
		text.appendText(planLine(plan, true));
	} else {
		const line = stageLine(s.state, s.summary.stageChapter, true);
		// The stage word in bold, the rest plain: "**Reminded** in Chapter 14".
		const word = stageWord(s.state);
		text.createEl('b', { text: word });
		if (line.length > word.length) text.appendText(line.slice(word.length));
		// The next planned step, quiet: "· Payoff planned for Chapter 12".
		if (plan) stage.createSpan({ cls: 'sg-setup-card-plan', text: ' · ' + planLine(plan, true) });
	}
	card.createDiv({ cls: 'sg-setup-card-name', text: s.name });
	if (s.description) card.createDiv({ cls: 'sg-setup-card-what', text: s.description });
	// Still open, but meant for a later book: its own quiet line at the card's
	// foot (books icon + words), so the stage line above stays clean.
	if (s.later && (s.state === 'planted' || s.state === 'reminded')) {
		const later = card.createDiv({ cls: 'sg-setup-card-later' });
		setPhosphorIcon(later.createSpan({ cls: 'sg-setup-card-later-icon' }), 'books', '•');
		later.createSpan({ cls: 'sg-setup-card-later-text', text: t('setups.forLaterBook') });
	}
	// A card that just changed column slides in once, without words.
	if (s.arriving && s.state !== 'let-go') {
		card.addClass('is-arriving');
		card.win.requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
	}
	const open = () => host.openSheet(s.file);
	card.addEventListener('click', open);
	card.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			open();
		}
	});
}
