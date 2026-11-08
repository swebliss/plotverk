import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type StorygridPlugin from './main';
import { MODULES, type IntentId, type WritingStyle } from './modules';
import { t } from './i18n';
import { setPhosphorIcon } from './utils/icons';

export const VIEW_TYPE_INTENT = 'storygrid-intent';

interface IntentOption {
	id: IntentId;
	icon: string;
	fallback: string;
	titleKey: string;
	subtitleKey: string;
}

const OPTIONS: IntentOption[] = [
	{
		id: 'journalist',
		icon: 'newspaper',
		fallback: '📰',
		titleKey: 'intent.journalist.title',
		subtitleKey: 'intent.journalist.subtitle',
	},
	{
		id: 'novelist',
		icon: 'feather',
		fallback: '✎',
		titleKey: 'intent.novelist.title',
		subtitleKey: 'intent.novelist.subtitle',
	},
	{
		id: 'scriptwriter',
		icon: 'scroll-text',
		fallback: '📜',
		titleKey: 'intent.scriptwriter.title',
		subtitleKey: 'intent.scriptwriter.subtitle',
	},
	{
		id: 'worldbuilder',
		icon: 'globe',
		fallback: '◍',
		titleKey: 'intent.worldbuilder.title',
		subtitleKey: 'intent.worldbuilder.subtitle',
	},
	{
		id: 'creator',
		icon: 'layout-grid',
		fallback: '▦',
		titleKey: 'intent.creator.title',
		subtitleKey: 'intent.creator.subtitle',
	},
	{
		id: 'everything',
		icon: 'sparkles',
		fallback: '✦',
		titleKey: 'intent.everything.title',
		subtitleKey: 'intent.everything.subtitle',
	},
];

interface StyleOption {
	/** null = "Not sure yet": the novelist defaults, no style chosen. */
	id: WritingStyle | null;
	icon: string;
	fallback: string;
	titleKey: string;
	subtitleKey: string;
	exampleKey: string;
}

const STYLE_OPTIONS: StyleOption[] = [
	{
		id: 'plotter',
		icon: 'map',
		fallback: '🗺',
		titleKey: 'intent.style.plotter.title',
		subtitleKey: 'intent.style.plotter.subtitle',
		exampleKey: 'intent.style.plotter.example',
	},
	{
		id: 'pantser',
		icon: 'wind',
		fallback: '💨',
		titleKey: 'intent.style.pantser.title',
		subtitleKey: 'intent.style.pantser.subtitle',
		exampleKey: 'intent.style.pantser.example',
	},
	{
		id: 'plantser',
		icon: 'signpost',
		fallback: '🌱',
		titleKey: 'intent.style.plantser.title',
		subtitleKey: 'intent.style.plantser.subtitle',
		exampleKey: 'intent.style.plantser.example',
	},
	{
		id: null,
		icon: 'circle-help',
		fallback: '?',
		titleKey: 'intent.style.notSure.title',
		subtitleKey: 'intent.style.notSure.subtitle',
		exampleKey: 'intent.style.notSure.example',
	},
];

/**
 * First-launch chooser, two steps: "What do you create?" (profession cards,
 * plus "Skip for now"), and for Novel Writers a follow-up "How do you write?"
 * (Plotter / Pantser / Plantser / Not sure yet, each saying where the writer
 * will start). The answers set settings.intent +
 * settings.writingStyle, which supply per-module defaults — see modules.ts.
 */
export class IntentView extends ItemView {
	private plugin: StorygridPlugin;
	private step: 'intent' | 'style' = 'intent';

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_INTENT; }
	getDisplayText(): string { return t('intent.tabTitle'); }
	getIcon(): string { return 'layout-grid'; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass('sg-intent');
		this.render();
	}

	async onClose(): Promise<void> {
		// Closed without answering: a later "Switch setup" must not start a project.
		this.plugin.startProjectAfterIntent = false;
		this.contentEl.empty();
	}

	private render(): void {
		if (this.step === 'style') this.renderStyleStep();
		else this.renderIntentStep();
	}

	private renderIntentStep(): void {
		const el = this.contentEl;
		el.empty();

		const wrap = el.createDiv({ cls: 'sg-intent-wrap' });

		const hero = wrap.createDiv({ cls: 'sg-intent-hero' });
		hero.createEl('h1', { cls: 'sg-intent-title', text: t('intent.step1.title') });
		hero.createEl('p', {
			cls: 'sg-intent-tagline',
			text: t('intent.step1.tagline'),
		});

		const grid = wrap.createDiv({ cls: 'sg-intent-grid' });

		OPTIONS.forEach((opt, i) => {
			const card = grid.createEl('button', { cls: 'sg-intent-card' });
			card.setAttribute('tabindex', i === 0 ? '0' : '-1');

			const iconWrap = card.createDiv({ cls: 'sg-intent-card-icon' });
			setIcon(iconWrap, opt.icon);
			if (!iconWrap.querySelector('svg')) iconWrap.textContent = opt.fallback;

			card.createEl('h3', { cls: 'sg-intent-card-title', text: t(opt.titleKey) });
			card.createEl('p', { cls: 'sg-intent-card-subtitle', text: t(opt.subtitleKey) });

			const included = MODULES.filter((m) => m.defaultForIntent[opt.id]);
			const chipWrap = card.createDiv({ cls: 'sg-intent-card-chips' });
			chipWrap.createSpan({
				cls: 'sg-intent-chips-label',
				text: included.length ? t('intent.chip.includes') : t('intent.chip.dashboardOnly'),
			});
			if (included.length) {
				const list = chipWrap.createDiv({ cls: 'sg-intent-chip-list' });
				included.forEach((m) => {
					const chip = list.createSpan({ cls: 'sg-intent-chip' });
					const ic = chip.createSpan({ cls: 'sg-intent-chip-icon' });
					setPhosphorIcon(ic, m.icon); // same icon pack as the module cards (Lucide had no match for some names)
					chip.createSpan({ text: t(m.nameKey) });
				});
			}

			card.addEventListener('click', () => {
				if (opt.id === 'novelist') {
					this.step = 'style';
					this.render();
				} else {
					void this.choose(opt.id, null);
				}
			});
			card.addEventListener('keydown', (e) => this.handleCardKeydown(e, i));
		});

		const footer = wrap.createDiv({ cls: 'sg-intent-footer' });
		// Reopened via "Switch setup…", the same button only closes the tab — say so.
		const skip = footer.createEl('button', {
			cls: 'sg-intent-back',
			text: this.plugin.settings.hasSeenWelcome ? t('intent.keepSetup') : t('intent.skip'),
		});
		skip.addEventListener('click', () => void this.skip());
		// The hint describes what a first-run skip does; reopened via
		// "Switch setup…", Skip changes nothing, so the hint would be wrong.
		if (!this.plugin.settings.hasSeenWelcome) {
			footer.createEl('p', {
				cls: 'sg-intent-footer-hint',
				text: t('intent.step1.footer'),
			});
		}
		footer.createEl('p', {
			cls: 'sg-intent-footer-hint',
			text: t('intent.step1.settingsHint'),
		});
	}

	private renderStyleStep(): void {
		const el = this.contentEl;
		el.empty();

		const wrap = el.createDiv({ cls: 'sg-intent-wrap' });

		const hero = wrap.createDiv({ cls: 'sg-intent-hero' });
		hero.createEl('h1', { cls: 'sg-intent-title', text: t('intent.step2.title') });
		hero.createEl('p', {
			cls: 'sg-intent-tagline',
			text: t('intent.step2.tagline'),
		});

		const grid = wrap.createDiv({ cls: 'sg-intent-grid sg-intent-grid--styles' });

		STYLE_OPTIONS.forEach((opt, i) => {
			const card = grid.createEl('button', { cls: 'sg-intent-card' });
			card.setAttribute('tabindex', i === 0 ? '0' : '-1');

			const iconWrap = card.createDiv({ cls: 'sg-intent-card-icon' });
			setIcon(iconWrap, opt.icon);
			if (!iconWrap.querySelector('svg')) iconWrap.textContent = opt.fallback;

			card.createEl('h3', { cls: 'sg-intent-card-title', text: t(opt.titleKey) });
			card.createEl('p', { cls: 'sg-intent-card-subtitle', text: t(opt.subtitleKey) });
			card.createEl('p', { cls: 'sg-intent-card-example', text: t(opt.exampleKey) });

			card.addEventListener('click', () => void this.choose('novelist', opt.id));
			card.addEventListener('keydown', (e) => this.handleCardKeydown(e, i));
		});

		const footer = wrap.createDiv({ cls: 'sg-intent-footer' });
		const back = footer.createEl('button', { cls: 'sg-intent-back', text: t('intent.step2.back') });
		back.addEventListener('click', () => {
			this.step = 'intent';
			this.render();
		});
	}

	/** Left/Right/Up/Down moves focus between cards — Tab order stays natural too. */
	private handleCardKeydown(e: KeyboardEvent, i: number): void {
		let delta = 0;
		if (e.key === 'ArrowRight' || e.key === 'ArrowDown') delta = 1;
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') delta = -1;
		else return;

		const cards = Array.from(this.contentEl.querySelectorAll<HTMLElement>('.sg-intent-card'));
		const next = (i + delta + cards.length) % cards.length;
		e.preventDefault();
		cards[i].setAttribute('tabindex', '-1');
		cards[next].setAttribute('tabindex', '0');
		cards[next].focus();
	}

	/**
	 * "Skip for now". On the very first run: never show the chooser again, keep
	 * every module on (intent stays unset, which isModuleEnabled reads as "show
	 * everything") and open the Guide so the writer has somewhere to start.
	 * Reopened later via "Switch setup…": just close, changing nothing.
	 */
	private async skip(): Promise<void> {
		const firstRun = !this.plugin.settings.hasSeenWelcome;
		if (firstRun) {
			this.plugin.settings.hasSeenWelcome = true;
			await this.plugin.saveSettings();
		}
		const startProject = this.takeStartProject();
		this.leaf.detach();
		if (startProject) await this.plugin.createNewGrid();
		else if (firstRun) await this.plugin.openWelcome();
	}

	private async choose(intent: IntentId, style: WritingStyle | null): Promise<void> {
		this.plugin.settings.intent = intent;
		this.plugin.settings.writingStyle = style;
		this.plugin.settings.hasSeenWelcome = true;
		await this.plugin.saveSettings();
		const startProject = this.takeStartProject();
		this.leaf.detach();
		if (startProject) await this.plugin.createNewGrid();
		else await this.plugin.landForIntent(intent);
	}

	/** True once if the Welcome page's "Start your first project" opened this chooser (then: novel or series next). */
	private takeStartProject(): boolean {
		const start = this.plugin.startProjectAfterIntent;
		this.plugin.startProjectAfterIntent = false;
		return start;
	}
}
