import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type StorygridPlugin from './main';
import { setPhosphorIcon } from './utils/icons';
import { MODULES } from './modules';
import { t } from './i18n';
import { loadSampleStory } from './sample/load-sample';
import { SAMPLE_IMAGE_FILES } from './sample/saltmarch-data';

export const VIEW_TYPE_WELCOME = 'storygrid-welcome';

export class WelcomeView extends ItemView {
	private plugin: StorygridPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_WELCOME; }
	getDisplayText(): string { return t('guide.tabTitle'); }
	getIcon(): string { return 'layout-grid'; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass('sg-welcome');
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.contentEl;
		const scrollTop = el.scrollTop;
		el.empty();

		const wrap = el.createDiv({ cls: 'sg-welcome-wrap' });

		// ── Hero ──────────────────────────────────────────────────────────────
		const hero = wrap.createDiv({ cls: 'sg-welcome-hero' });
		const heroIconWrap = hero.createDiv({ cls: 'sg-welcome-hero-icon' });
		setIcon(heroIconWrap, 'layout-grid');

		hero.createEl('h1', { cls: 'sg-welcome-title', text: t('guide.hero.title') });
		hero.createEl('p', { cls: 'sg-welcome-tagline', text: t('guide.hero.tagline') });

		const ctaRow = hero.createDiv({ cls: 'sg-welcome-cta-row' });
		const startBtn = ctaRow.createEl('button', {
			cls: 'sg-welcome-btn sg-welcome-btn--primary',
			text: t('guide.hero.startCta'),
		});
		setIcon(startBtn.createSpan({ cls: 'sg-welcome-btn-icon' }), 'arrow-right');
		// Always ask "What do you create?" first; the chooser then opens novel-or-series itself.
		// Reopened later from the Guide, its footer reads "Keep my current setup", which
		// goes straight on to novel-or-series without touching the mode (Emma, 2026-11-06).
		startBtn.addEventListener('click', () => {
			this.plugin.startProjectAfterIntent = true;
			void this.plugin.openIntentChooser();
		});
		// The quieter second way in: see a finished two-book series before starting your own.
		// Deliberately NOT part of the start-project flow, so that stays one obvious path.
		const sampleBtn = ctaRow.createEl('button', { cls: 'sg-welcome-btn sg-welcome-btn--secondary' });
		// Three faces from the sample say "a real story with people in it" before the words do.
		const faces = sampleBtn.createSpan({ cls: 'sg-welcome-sample-faces', attr: { 'aria-hidden': 'true' } });
		for (const name of ['Mara Ferrow', 'Wrenna Sull', 'Halvard Crane']) {
			const img = SAMPLE_IMAGE_FILES.find(([path]) => path.endsWith(`/${name}.jpg`));
			if (img) faces.createEl('img', { attr: { src: `data:image/jpeg;base64,${img[1]}`, alt: '', draggable: 'false' } });
		}
		sampleBtn.createSpan({ text: t('guide.hero.sampleCta') });
		sampleBtn.addEventListener('click', () => void loadSampleStory(this.plugin));

		// ── Per-module cards ──────────────────────────────────────────────────
		// One card per module in the registry (single source of truth — see
		// modules.ts): what it is, who it's for, one first step, and a plain
		// on/off button. The Dashboard gets its own static card right after,
		// since it's the one surface every setup keeps (never gated).
		wrap.createEl('h2', { cls: 'sg-welcome-section-title', text: t('guide.modules.title') });
		wrap.createEl('p', { cls: 'sg-welcome-section-subtitle', text: t('guide.modules.subtitle') });

		const moduleGrid = wrap.createDiv({ cls: 'sg-welcome-modules' });

		const dashCard = moduleGrid.createDiv({ cls: 'sg-welcome-module-card sg-welcome-module-card--fixed' });
		const dashHeader = dashCard.createDiv({ cls: 'sg-welcome-module-header' });
		setPhosphorIcon(dashHeader.createDiv({ cls: 'sg-welcome-module-icon' }), 'sg-chart-bar', '◆');
		dashHeader.createEl('h3', { text: t('dashboard.tabTitle') });
		dashHeader.createSpan({ cls: 'sg-welcome-badge', text: t('guide.dashboard.badge') });
		dashCard.createEl('p', { cls: 'sg-welcome-module-desc', text: t('guide.dashboard.desc') });
		const dashOpenBtn = dashCard.createEl('button', { cls: 'sg-welcome-module-toggle', text: t('guide.dashboard.open') });
		dashOpenBtn.addEventListener('click', () => void this.plugin.openDashboard());

		for (const mod of MODULES) {
			const card = moduleGrid.createDiv({ cls: 'sg-welcome-module-card' });
			const header = card.createDiv({ cls: 'sg-welcome-module-header' });
			setPhosphorIcon(header.createDiv({ cls: 'sg-welcome-module-icon' }), mod.icon, '◆');
			header.createEl('h3', { text: t(mod.nameKey) });

			// One clean switch in the header (Emma, 2026-11-07) — replaces the orange
			// "On" badge plus a separate Turn on/off button. Same markup Obsidian's own
			// settings toggles use, so it looks native in every theme.
			const isOn = this.plugin.isModuleOn(mod.id);
			const toggle = header.createDiv({ cls: 'checkbox-container sg-welcome-module-switch' });
			toggle.toggleClass('is-enabled', isOn);
			toggle.setAttribute('role', 'switch');
			toggle.setAttribute('aria-checked', String(isOn));
			toggle.setAttribute('aria-label', isOn ? t('guide.moduleCard.turnOff') : t('guide.moduleCard.turnOn'));
			toggle.setAttribute('tabindex', '0');
			const flip = async () => {
				this.plugin.settings.enabledModules = {
					...this.plugin.settings.enabledModules,
					[mod.id]: !isOn,
				};
				await this.plugin.saveSettings();
				this.render();
			};
			toggle.addEventListener('click', () => void flip());
			toggle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void flip(); } });

			card.createEl('p', { cls: 'sg-welcome-module-desc', text: t(mod.descKey) });

			const whoFor = card.createDiv({ cls: 'sg-welcome-module-row' });
			whoFor.createEl('strong', { text: t('guide.moduleCard.whoForLabel') });
			whoFor.createSpan({ text: ' ' + t(mod.whoForKey) });

			const firstStep = card.createDiv({ cls: 'sg-welcome-module-row' });
			firstStep.createEl('strong', { text: t(mod.firstStepLabelKey ?? 'guide.moduleCard.firstStepLabel') });
			firstStep.createSpan({ text: ' ' + t(mod.firstStepKey) });
		}

		// ── Show me around ────────────────────────────────────────────────────
		const tour = wrap.createDiv({ cls: 'sg-welcome-tour' });
		tour.createEl('h3', { text: t('guide.showMeAround.title') });
		tour.createEl('p', { text: t('guide.showMeAround.desc') });
		const tourBtn = tour.createEl('button', { cls: 'sg-welcome-btn sg-welcome-btn--primary', text: t('guide.showMeAround.button') });
		tourBtn.addEventListener('click', () => void this.plugin.showMeAround());

		// ── Tips ──────────────────────────────────────────────────────────────
		wrap.createEl('h2', { cls: 'sg-welcome-section-title', text: t('guide.tips.title') });

		const tips = wrap.createDiv({ cls: 'sg-welcome-tips' });
		const tipData = [
			{ icon: 'mouse-pointer-2', title: t('guide.tips.rightClick.title'), body: t('guide.tips.rightClick.body') },
			{ icon: 'copy', title: t('guide.tips.copyStyle.title'), body: t('guide.tips.copyStyle.body') },
			{ icon: 'palette', title: t('guide.tips.palettes.title'), body: t('guide.tips.palettes.body') },
			{ icon: 'layers', title: t('guide.tips.series.title'), body: t('guide.tips.series.body') },
			{ icon: 'layout-template', title: t('guide.tips.templates.title'), body: t('guide.tips.templates.body') },
			{ icon: 'move-horizontal', title: t('guide.tips.resize.title'), body: t('guide.tips.resize.body') },
			{ icon: 'timer', title: t('guide.tips.sprint.title'), body: t('guide.tips.sprint.body') },
			{ icon: 'sidebar-open', title: t('guide.tips.ribbon.title'), body: t('guide.tips.ribbon.body') },
			{ icon: 'trending-up', title: t('guide.tips.progress.title'), body: t('guide.tips.progress.body') },
			{ icon: 'shield-check', title: t('guide.tips.backups.title'), body: t('guide.tips.backups.body') },
		];

		tipData.forEach((tip) => {
			const row = tips.createDiv({ cls: 'sg-welcome-tip' });
			const iconWrap = row.createDiv({ cls: 'sg-welcome-tip-icon' });
			setIcon(iconWrap, tip.icon);
			const text = row.createDiv({ cls: 'sg-welcome-tip-body' });
			text.createEl('strong', { text: tip.title });
			text.createEl('span', { text: ' — ' + tip.body });
		});

		// ── Footer ────────────────────────────────────────────────────────────
		const footer = wrap.createDiv({ cls: 'sg-welcome-footer' });

		const madeBy = footer.createEl('p', { cls: 'sg-welcome-footer-note' });
		madeBy.appendText(t('guide.footer.madeByPrefix'));
		const twitch = madeBy.createEl('a', {
			text: 'twitch.tv/swebliss',
			href: 'https://twitch.tv/swebliss',
		});
		twitch.setAttr('target', '_blank');
		twitch.setAttr('rel', 'noopener');
		madeBy.appendText(t('guide.footer.madeBySuffix'));

		footer.createEl('p', {
			text: t('guide.footer.reopen'),
		});

		el.scrollTop = scrollTop;
	}
}
