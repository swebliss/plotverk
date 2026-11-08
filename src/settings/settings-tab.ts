import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type StorygridPlugin from '../main';
import { getAllTemplates } from '../templates/story-templates';
import { generateId, CardStatus, QuickLinkKey, QuickLinkPlacement } from '../grid-data';
import { GRADIENT_NAMES } from '../ui/color-picker-popover';
import { setPhosphorIcon, WRITERS_PANEL_ICON, CODEX_ICON } from '../utils/icons';
import { canUse, getEntitlementState, setEntitlementState, type FeatureId } from '../entitlements/entitlements';
import { MODULES, writersPanelTabDefault, type WritersPanelTab } from '../modules';
import { findProjects } from '../entities/entity-manager';
import { imagesFolderNameProblem, renameImagesFolders } from '../entities/sheet-images';
import { t } from '../i18n';
import { PUBLIC_BUILD } from '../build-flags';
import { TemplateBuilderModal } from '../modals/template-builder-modal';
import { mountRelTypeWizard, renderLineStylePicker } from '../ui/rel-type-wizard';
import { debounce } from '../utils/debounce';

type SettingsSection = 'general' | 'plot-grid' | 'world-codex' | 'writing' | 'views' | 'pro';

const ALL_SECTIONS: Array<{ id: SettingsSection; labelKey: string; icon: string; fallback: string }> = [
	{ id: 'general',     labelKey: 'settings.nav.general',     icon: 'gear',         fallback: '⚙' },
	{ id: 'plot-grid',   labelKey: 'settings.nav.plotGrid',    icon: 'squares-four', fallback: '⊞' },
	{ id: 'world-codex', labelKey: 'settings.nav.codex',       icon: 'book-open',    fallback: '📖' },
	{ id: 'writing',     labelKey: 'settings.nav.writing',     icon: 'pen-nib',      fallback: '✍' },
	{ id: 'views',       labelKey: 'settings.nav.views',       icon: 'list-tree',    fallback: '🌳' },
	{ id: 'pro',         labelKey: 'settings.nav.pro',         icon: 'star',         fallback: '★' },
];
// The public release has no Pro to unlock yet: no Pro page and no licence-key box.
const SECTIONS = ALL_SECTIONS.filter((s) => !(PUBLIC_BUILD && s.id === 'pro'));

const WORD_GOAL_FIELDS: Array<{ key: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'total'; labelKey: string; placeholderKey: string }> = [
	{ key: 'daily',   labelKey: 'settings.tasksGoals.goal.daily',   placeholderKey: 'settings.tasksGoals.goal.daily.ph' },
	{ key: 'weekly',  labelKey: 'settings.tasksGoals.goal.weekly',  placeholderKey: 'settings.tasksGoals.goal.weekly.ph' },
	{ key: 'monthly', labelKey: 'settings.tasksGoals.goal.monthly', placeholderKey: 'settings.tasksGoals.goal.monthly.ph' },
	{ key: 'yearly',  labelKey: 'settings.tasksGoals.goal.yearly',  placeholderKey: 'settings.tasksGoals.goal.yearly.ph' },
	{ key: 'total',   labelKey: 'settings.tasksGoals.goal.total',   placeholderKey: 'settings.tasksGoals.goal.total.ph' },
];

export class StorygridSettingsTab extends PluginSettingTab {
	private plugin: StorygridPlugin;
	private activeSection: SettingsSection = 'general';
	private collapsedSections = new Set<string>();
	private initializedSections = new Set<string>();
	private sectionIndex = 0;
	// Text-field settings save on every keystroke; debounce so typing doesn't
	// hit disk (and Sync) on every character.
	private debouncedSaveSettings = debounce(() => { void this.plugin.saveSettings(); }, 600);
	private debouncedSaveData = debounce(() => { void this.plugin.saveData(this.plugin.settings); }, 600);

	constructor(app: App, plugin: StorygridPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('sg-settings');

		// ── Section nav — slim segmented control ──────────────────────────────
		const nav = containerEl.createDiv({ cls: 'sg-settings-nav' });
		for (const s of SECTIONS) {
			const btn = nav.createEl('button', { cls: 'sg-settings-nav-btn' });
			if (s.id === this.activeSection) btn.addClass('is-active');
			const ic = btn.createSpan({ cls: 'sg-settings-nav-icon' });
			setPhosphorIcon(ic, s.icon, s.fallback);
			btn.createSpan({ text: t(s.labelKey) });
			btn.addEventListener('click', () => {
				this.activeSection = s.id;
				this.display();
			});
		}

		const body = containerEl.createDiv({ cls: 'sg-settings-body' });
		this.sectionIndex = 0;
		switch (this.activeSection) {
			case 'general':     this.renderGeneral(body);    break;
			case 'pro':         this.renderPro(body);       break;
			case 'plot-grid':   this.renderPlotGrid(body);   break;
			case 'world-codex': this.renderWorldCodex(body); break;
			case 'writing':     this.renderWriting(body);    break;
			case 'views':       this.renderViews(body);      break;
		}
	}

	/**
	 * Collapsible section with a thin chevron header and no border.
	 * Returns the body element so callers can append Settings into it.
	 */
	private section(parent: HTMLElement, title: string, desc?: string, opts?: { collapsible?: boolean; startCollapsed?: boolean }): HTMLElement {
		const collapsible = opts?.collapsible !== false;
		const key = `${this.activeSection}:${title.toLowerCase().replace(/\s+/g, '-')}`;
		const index = this.sectionIndex++;

		// First time we see this section: default all but the first to collapsed
		// (a section can ask to start folded even when it is first — "Modules").
		if (collapsible && !this.initializedSections.has(key)) {
			if (index > 0 || opts?.startCollapsed) this.collapsedSections.add(key);
			this.initializedSections.add(key);
		}
		const isCollapsed = collapsible && this.collapsedSections.has(key);

		const sec = parent.createDiv({ cls: 'sg-settings-section' });
		if (isCollapsed) sec.addClass('is-collapsed');
		if (!collapsible) sec.addClass('is-static');

		const hdr = collapsible
			? sec.createEl('button', { cls: 'sg-settings-section-hdr', attr: { type: 'button' } })
			: sec.createDiv({ cls: 'sg-settings-section-hdr' });
		if (collapsible) {
			hdr.createSpan({ cls: 'sg-settings-section-chevron', text: '▾' });
		}
		hdr.createSpan({ cls: 'sg-settings-section-title', text: title });

		if (collapsible) {
			hdr.addEventListener('click', () => {
				if (this.collapsedSections.has(key)) {
					this.collapsedSections.delete(key);
					sec.removeClass('is-collapsed');
				} else {
					this.collapsedSections.add(key);
					sec.addClass('is-collapsed');
				}
			});
		}

		const collapseWrap = sec.createDiv({ cls: 'sg-settings-section-collapse' });
		const body = collapseWrap.createDiv({ cls: 'sg-settings-section-body' });
		if (desc) body.createEl('p', { text: desc, cls: 'sg-settings-desc' });
		return body;
	}

	/**
	 * Which tabs the Writers Panel shows — nested under its switch in "Customise
	 * your plugin". The mode picked the starting positions (writersPanelTabDefault);
	 * a flip here always wins. Progress stays if everything is off.
	 */
	private renderWritersPanelTabs(host: HTMLElement): void {
		const nest = host.createDiv({ cls: 'sg-tab-list' });
		nest.createEl('p', { cls: 'sg-tab-list-desc', text: t('settings.views.writersPanel.tabs.desc') });
		const tabRows: { id: WritersPanelTab; icon: string }[] = [
			{ id: 'writing', icon: WRITERS_PANEL_ICON },
			{ id: 'world', icon: CODEX_ICON },
			{ id: 'coach', icon: 'sparkles' },
			{ id: 'dashboard', icon: 'check-square' },
		];
		for (const row of tabRows) {
			const s = new Setting(nest)
				.setName(t(`settings.views.writersPanel.tab.${row.id}.name`))
				.setDesc(t(`settings.views.writersPanel.tab.${row.id}.desc`))
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.settings.writersPanelTabs?.[row.id] ?? writersPanelTabDefault(row.id, this.plugin.settings.intent))
						.onChange(async (v) => {
							this.plugin.settings.writersPanelTabs = { ...this.plugin.settings.writersPanelTabs, [row.id]: v };
							await this.plugin.saveSettings();
						}),
				);
			s.settingEl.addClass('sg-tab-row');
			const ic = createSpan({ cls: 'sg-feature-row-icon' });
			setPhosphorIcon(ic, row.icon, '◆');
			s.nameEl.prepend(ic);
		}
	}

	// ── General ──────────────────────────────────────────────────────────────
	// Story structure → Startup & identity → Series mode → Quick-links

	private renderGeneral(parent: HTMLElement): void {
		// Modules — the main-feature switches. Positions start from the first-launch
		// answers (profession + writing style); an explicit flip here always wins.
		// Nothing is ever deleted. Folds like every other section and starts folded,
		// so the first settings page opens calm (Emma, 2026-11-06).
		const featureSec = this.section(parent, t('settings.general.customizePlugin.title'),
			t('settings.general.customizePlugin.desc'),
			{ startCollapsed: true });

		const featureToggle = (host: HTMLElement, mod: (typeof MODULES)[number], big: boolean) => {
			const s = new Setting(host)
				.setName(t(mod.nameKey))
				.setDesc(t(mod.descKey))
				.addToggle((tg) =>
					tg
						.setValue(this.plugin.isModuleOn(mod.id))
						.onChange(async (v) => {
							this.plugin.settings.enabledModules = {
								...this.plugin.settings.enabledModules,
								[mod.id]: v,
							};
							await this.plugin.saveSettings();
						})
				);
			if (big) {
				s.settingEl.addClass('sg-feature-row');
				const ic = createSpan({ cls: 'sg-feature-row-icon' });
				setPhosphorIcon(ic, mod.icon, '◆');
				s.nameEl.prepend(ic);
			}
			return s;
		};

		const mainWrap = featureSec.createDiv({ cls: 'sg-feature-list' });
		for (const mod of MODULES.filter((m) => m.mainFeature)) {
			featureToggle(mainWrap, mod, true);
			// The Writers Panel's four tabs sit right under its own switch (Emma, 2026-11-06).
			if (mod.id === 'writersPanel') this.renderWritersPanelTabs(mainWrap);
		}

		new Setting(featureSec)
			.setName(t('settings.general.notSure.name'))
			.setDesc(t('settings.general.notSure.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.general.notSure.button')).onClick(() => void this.plugin.openIntentChooser())
			);

		const moreSec = this.section(parent, t('settings.general.moreTools.title'));
		for (const mod of MODULES.filter((m) => !m.mainFeature)) featureToggle(moreSec, mod, false);

		// Startup & identity
		const startSec = this.section(parent, t('settings.general.startupIdentity.title'));

		new Setting(startSec)
			.setName(t('settings.general.openDashboard.name'))
			.setDesc(t('settings.general.openDashboard.desc'))
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.openDashboardOnStartup ?? false)
					.onChange(async (v) => {
						this.plugin.settings.openDashboardOnStartup = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(startSec)
			.setName(t('settings.general.tipsAgain.name'))
			.setDesc(t('settings.general.tipsAgain.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.general.tipsAgain.button')).onClick(() => void this.plugin.showTipsAgain())
			);

		new Setting(startSec)
			.setName(t('settings.general.authorName.name'))
			.setDesc(t('settings.general.authorName.desc'))
			.addText((text) =>
				text
					.setPlaceholder(t('settings.general.authorName.placeholder'))
					.setValue(this.plugin.settings.authorName ?? '')
					.onChange((v) => {
						this.plugin.settings.authorName = v;
						this.debouncedSaveData();
					})
			);

		// Series mode
		const seriesSec = this.section(parent, t('settings.general.seriesMode.title'),
			t('settings.general.seriesMode.titleDesc'));

		new Setting(seriesSec)
			.setName(t('settings.general.seriesMode.name'))
			.setDesc(t('settings.general.seriesMode.desc'))
			.setTooltip(t('settings.general.seriesMode.tooltip'))
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.isSeriesMode ?? false)
					.onChange(async (v) => {
						this.plugin.settings.isSeriesMode = v;
						await this.plugin.saveSettings();
					})
			);

		this.renderSeriesManager(seriesSec);

		// Quick-links — icon visibility and placement
		const qlSec = this.section(parent, t('settings.general.quickLinks.title'),
			t('settings.general.quickLinks.desc'));

		const setOn = async (key: QuickLinkKey, val: boolean) => {
			this.plugin.settings.writersPanelActions = {
				...this.plugin.settings.writersPanelActions,
				[key]: val,
			};
			await this.plugin.saveSettings();
		};
		const setPlacement = async (key: QuickLinkKey, val: QuickLinkPlacement) => {
			this.plugin.settings.quickLinkPlacement = {
				...this.plugin.settings.quickLinkPlacement,
				[key]: val,
			};
			await this.plugin.saveSettings();
		};

		// Two genuinely different places, picked one at a time (Emma, 2026-09-06):
		// INSIDE the Writers Panel's own header row, or ABOVE it in Obsidian's
		// sidebar tab strip beside the Writers Panel tab. 'Both' exists, but only
		// as a deliberate choice made here — never a default, and never something
		// a writing mode turns on. The default is always 'Inside the panel', so a
		// fresh install shows the Writers Panel tab alone up top.
		const PLACEMENTS: Array<{ id: QuickLinkPlacement; labelKey: string }> = [
			{ id: 'top', labelKey: 'settings.general.quickLinks.placementTop' },
			{ id: 'panel', labelKey: 'settings.general.quickLinks.placementPanel' },
			{ id: 'both', labelKey: 'settings.general.quickLinks.placementBoth' },
		];

		const linkRow = (key: QuickLinkKey, labelKey: string, icon: string, fallback: string) => {
			const row = qlSec.createDiv({ cls: 'sg-ql-row' });
			const name = row.createDiv({ cls: 'sg-ql-row-name' });
			const ic = name.createSpan({ cls: 'sg-ql-chip-icon' });
			setPhosphorIcon(ic, icon, fallback);
			name.createSpan({ text: t(labelKey) });

			// Radio dots — one place at a time, visibly exclusive. Default 'panel'
			// must match quickLinkVisible() in main.ts, or this would claim a
			// shortcut sits in the tab strip when it does not.
			const seg = row.createDiv({ cls: 'sg-ql-seg', attr: { role: 'radiogroup', 'aria-label': t(labelKey) } });
			const current = (): QuickLinkPlacement => this.plugin.settings.quickLinkPlacement?.[key] ?? 'panel';
			const radios: HTMLButtonElement[] = [];
			for (const p of PLACEMENTS) {
				const b = seg.createEl('button', { cls: 'sg-ql-seg-btn sg-ql-radio', attr: { role: 'radio' } });
				b.createSpan({ cls: 'sg-ql-radio-dot' });
				b.createSpan({ text: t(p.labelKey) });
				const mark = () => {
					const on = current() === p.id;
					b.toggleClass('is-active', on);
					b.setAttribute('aria-checked', String(on));
				};
				mark();
				b.addEventListener('click', async () => {
					await setPlacement(key, p.id);
					radios.forEach((x) => {
						const on = x === b;
						x.toggleClass('is-active', on);
						x.setAttribute('aria-checked', String(on));
					});
				});
				radios.push(b);
			}

			// The on/off switch — a real toggle, unmistakable at a glance.
			const toggleHost = row.createDiv({ cls: 'sg-ql-row-toggle' });
			const dummy = new Setting(toggleHost).addToggle((tg) =>
				tg.setValue(this.plugin.quickLinkOn(key)).onChange(async (v) => {
					await setOn(key, v);
					row.toggleClass('is-off', !v);
					seg.toggleClass('sg-ql-seg--disabled', !v);
				})
			);
			dummy.settingEl.addClass('sg-ql-toggle-only');
			if (!this.plugin.quickLinkOn(key)) {
				row.addClass('is-off');
				seg.addClass('sg-ql-seg--disabled');
			}
		};

		linkRow('codex', 'settings.general.quickLinks.codex', 'book-open', '◎');
		linkRow('grid', 'settings.general.quickLinks.plotGrid', 'squares-four', '⊞');
		linkRow('dashboard', 'settings.general.quickLinks.dashboard', 'gauge', '▦');
		linkRow('connectionsMap', 'settings.general.quickLinks.connectionsMap', 'graph', '⬡');
		linkRow('timeline', 'settings.general.quickLinks.timeline', 'git-commit', '📅');

	}

	// ── Projects table ────────────────────────────────────────────────────────
	// Every project is auto-discovered from the vault via findProjects() — it's
	// always accurate, unlike the old book-registry form which required manually
	// re-registering a grid every time. Assigning a project to a series just
	// writes/updates its bookRegistry entry; the vault scan stays the source of
	// truth for what projects exist at all.

	private renderSeriesManager(parent: HTMLElement): void {
		// Always read/write through this.plugin.settings directly in all handlers —
		// no local copies that could go stale between render time and click time.
		if (!this.plugin.settings.seriesRegistry) this.plugin.settings.seriesRegistry = {};
		if (!this.plugin.settings.bookRegistry) this.plugin.settings.bookRegistry = {};

		const projects = findProjects(this.app);
		const seriesEntries = Object.entries(this.plugin.settings.seriesRegistry);

		const table = parent.createDiv({ cls: 'sg-projects-table' });

		const headRow = table.createDiv({ cls: 'sg-projects-table-row sg-projects-table-head' });
		headRow.createDiv({ cls: 'sg-projects-table-cell', text: t('settings.projects.colProject') });
		headRow.createDiv({ cls: 'sg-projects-table-cell', text: t('settings.projects.colSeries') });

		for (const project of projects) {
			const row = table.createDiv({ cls: 'sg-projects-table-row' });

			const nameCell = row.createDiv({ cls: 'sg-projects-table-cell' });
			nameCell.createDiv({ cls: 'sg-projects-table-name', text: project.name });
			nameCell.createDiv({ cls: 'sg-projects-table-path', text: project.rootPath || '/' });

			const gridPaths = new Set(project.gridFiles.map((f) => f.path));
			const existingEntry = Object.entries(this.plugin.settings.bookRegistry ?? {})
				.find(([, bk]) => gridPaths.has(bk.gridPath));
			const [existingBid, existingBook] = existingEntry ?? [undefined, undefined];

			const seriesCell = row.createDiv({ cls: 'sg-projects-table-cell' });
			const sel = seriesCell.createEl('select', { cls: 'sg-projects-table-select' });
			const noneOpt = sel.createEl('option', { text: t('settings.projects.standalone') });
			noneOpt.value = '';
			for (const [sid, sr] of seriesEntries) {
				const opt = sel.createEl('option', { text: sr.name });
				opt.value = sid;
			}
			sel.value = existingBook?.seriesId ?? '';

			sel.addEventListener('change', async () => {
				const newSid = sel.value;
				if (!newSid) {
					if (existingBid) {
						delete this.plugin.settings.bookRegistry![existingBid];
						if (this.plugin.settings.activeBookId === existingBid) {
							delete this.plugin.settings.activeBookId;
						}
					}
				} else {
					const gridPath = project.gridFiles[0]?.path;
					if (!gridPath) return;
					if (existingBid) {
						this.plugin.settings.bookRegistry![existingBid].seriesId = newSid;
					} else {
						const bid = 'book_' + generateId().slice(0, 8);
						this.plugin.settings.bookRegistry![bid] = { name: project.name, seriesId: newSid, gridPath };
					}
				}
				await this.plugin.saveSettings();
				this.display();
			});
		}

		if (projects.length === 0) {
			table.createDiv({ cls: 'sg-projects-table-empty', text: t('settings.projects.empty') });
		}

		// Series management: delete a series (and un-assign its books) below the table.
		if (seriesEntries.length > 0) {
			const seriesList = parent.createDiv({ cls: 'sg-projects-series-list' });
			for (const [sid, sr] of seriesEntries) {
				const chip = seriesList.createDiv({ cls: 'sg-projects-series-chip' });
				chip.createSpan({ text: sr.name });
				const del = chip.createEl('button', { cls: 'sg-series-mgr-del', text: '✕' });
				del.setAttribute('aria-label', t('settings.projects.deleteSeriesAria', { name: sr.name }));
				del.addEventListener('click', async () => {
					delete this.plugin.settings.seriesRegistry![sid];
					for (const [bid, bk] of Object.entries(this.plugin.settings.bookRegistry ?? {})) {
						if (bk.seriesId === sid) delete this.plugin.settings.bookRegistry![bid];
					}
					if (this.plugin.settings.activeSeriesId === sid) {
						delete this.plugin.settings.activeSeriesId;
						delete this.plugin.settings.activeBookId;
					}
					await this.plugin.saveSettings();
					this.display();
				});
			}
		}

		// Add new series form
		const addSeriesRow = parent.createDiv({ cls: 'sg-series-mgr-add sg-series-mgr-new-series' });
		const newSeriesName = addSeriesRow.createEl('input', {
			type: 'text', cls: 'sg-series-mgr-input', placeholder: t('settings.projects.newSeriesName.placeholder'),
		});
		const newSeriesRoot = addSeriesRow.createEl('input', {
			type: 'text', cls: 'sg-series-mgr-input', placeholder: t('settings.projects.newSeriesRoot.placeholder'),
		});
		const addSeriesBtn = addSeriesRow.createEl('button', { cls: 'sg-series-mgr-btn', text: t('settings.projects.addSeries.button') });
		const newSeriesNameErr = parent.createDiv({ cls: 'sg-series-mgr-err-msg', attr: { 'aria-live': 'polite' } });
		newSeriesNameErr.style.display = 'none';
		newSeriesNameErr.style.color = 'var(--text-error)';
		newSeriesNameErr.style.fontSize = '12px';
		newSeriesNameErr.style.marginTop = '4px';
		addSeriesBtn.addEventListener('click', async () => {
			const name = newSeriesName.value.trim();
			const rootPath = newSeriesRoot.value.trim();
			if (!name) {
				newSeriesName.addClass('sg-series-mgr-err');
				newSeriesNameErr.setText('Enter a series name');
				newSeriesNameErr.style.display = '';
				return;
			}
			newSeriesName.removeClass('sg-series-mgr-err');
			newSeriesNameErr.style.display = 'none';
			if (!rootPath) {
				newSeriesRoot.addClass('sg-series-mgr-err');
				newSeriesNameErr.setText('Enter a folder path');
				newSeriesNameErr.style.display = '';
				return;
			}
			newSeriesRoot.removeClass('sg-series-mgr-err');
			newSeriesNameErr.style.display = 'none';
			const sid = 'series_' + generateId().slice(0, 8);
			this.plugin.settings.seriesRegistry![sid] = { name, rootPath };
			this.plugin.settings.activeSeriesId = sid;
			await this.plugin.saveSettings();
			this.display();
		});
	}

	// ── Plot Grid ─────────────────────────────────────────────────────────────
	// New grids → Cards → Grid & cards → Scene status → Color palettes → Custom grid templates

	private renderPlotGrid(parent: HTMLElement): void {
		const newGridSec = this.section(parent, t('settings.plotGrid.newGrids.title'),
			t('settings.plotGrid.newGrids.desc'));

		const templates = getAllTemplates();
		const templateOptions: Record<string, string> = {};
		templates.forEach((tpl) => { templateOptions[tpl.id] = tpl.name; });

		new Setting(newGridSec)
			.setName(t('settings.plotGrid.defaultTemplate.name'))
			.setDesc(t('settings.plotGrid.defaultTemplate.desc'))
			.addDropdown((dd) =>
				dd
					.addOptions(templateOptions)
					.setValue(this.plugin.settings.defaultTemplateId)
					.onChange(async (value) => {
						this.plugin.settings.defaultTemplateId = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(newGridSec)
			.setName(t('settings.plotGrid.defaultFolder.name'))
			.setDesc(t('settings.plotGrid.defaultFolder.desc'))
			.addText((text) =>
				text
					.setPlaceholder(t('settings.plotGrid.defaultFolder.placeholder'))
					.setValue(this.plugin.settings.gridFolder)
					.onChange((value) => {
						this.plugin.settings.gridFolder = value.trim();
						this.debouncedSaveSettings();
					})
			);

		const cardSec = this.section(parent, t('settings.plotGrid.cards.title'));

		new Setting(cardSec)
			.setName(t('settings.plotGrid.previewLines.name'))
			.setDesc(t('settings.plotGrid.previewLines.desc'))
			.addSlider((sl) =>
				sl
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.showFirstLinesCount)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.showFirstLinesCount = value;
						await this.plugin.saveSettings();
					})
			);

		const gridCardsSec = this.section(parent, t('settings.plotGrid.gridCards.title'));

		new Setting(gridCardsSec)
			.setName(t('settings.plotGrid.cornerStyle.name'))
			.setDesc(t('settings.plotGrid.cornerStyle.desc'))
			.addDropdown((dd) =>
				dd
					.addOptions({ rounded: t('settings.plotGrid.cornerStyle.rounded'), square: t('settings.plotGrid.cornerStyle.square') })
					.setValue(this.plugin.settings.cardBorderRadius)
					.onChange(async (v) => {
						this.plugin.settings.cardBorderRadius = v as 'rounded' | 'square';
						await this.plugin.saveSettings();
					})
			);

		new Setting(gridCardsSec)
			.setName(t('settings.plotGrid.showGridTitle.name'))
			.setDesc(t('settings.plotGrid.showGridTitle.desc'))
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.showGridTitle ?? true)
					.onChange(async (v) => {
						this.plugin.settings.showGridTitle = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(gridCardsSec)
			.setName(t('settings.plotGrid.fieldHelp.name'))
			.setDesc(t('settings.plotGrid.fieldHelp.desc'))
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.cardEditorHoverHelp ?? true)
					.onChange(async (v) => {
						this.plugin.settings.cardEditorHoverHelp = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(gridCardsSec)
			.setName(t('settings.plotGrid.confirmCardDelete.name'))
			.setDesc(t('settings.plotGrid.confirmCardDelete.desc'))
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.confirmCardDelete !== false)
					.onChange(async (v) => {
						this.plugin.settings.confirmCardDelete = v;
						await this.plugin.saveSettings();
					})
			);

		const statusSec = this.section(parent, t('settings.plotGrid.sceneStatus.title'),
			t('settings.plotGrid.sceneStatus.desc'));

		new Setting(statusSec)
			.setName(t('settings.plotGrid.statusFrame.name'))
			.setDesc(t('settings.plotGrid.statusFrame.desc'))
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.statusFrameEnabled)
					.onChange(async (v) => {
						this.plugin.settings.statusFrameEnabled = v;
						await this.plugin.saveSettings();
					})
			);

		const STATUS_LABEL_KEYS: Record<CardStatus, string> = {
			idea: 'settings.plotGrid.status.idea',
			outline: 'settings.plotGrid.status.outline',
			draft: 'settings.plotGrid.status.draft',
			written: 'settings.plotGrid.status.written',
			revised: 'settings.plotGrid.status.revised',
			final: 'settings.plotGrid.status.final',
		};
		const swStrip = statusSec.createDiv({ cls: 'sg-status-swatches' });
		for (const [status, labelKey] of Object.entries(STATUS_LABEL_KEYS)) {
			const item = swStrip.createDiv({ cls: 'sg-status-swatch-item' });
			const input = item.createEl('input', {
				type: 'color', cls: 'sg-status-swatch-input',
				attr: { 'aria-label': `${t(labelKey)} status color` },
			});
			input.value = this.plugin.settings.statusColors[status as CardStatus];
			input.addEventListener('input', async () => {
				this.plugin.settings.statusColors[status as CardStatus] = input.value;
				await this.plugin.saveSettings();
			});
			item.createSpan({ cls: 'sg-status-swatch-label', text: t(labelKey) });
		}

		const palSec = this.section(parent, t('settings.plotGrid.colorPalettes.title'),
			t('settings.plotGrid.colorPalettes.desc'));

		const paletteOptions: Record<string, string> = {};
		this.plugin.settings.colorPalettes.forEach((p) => {
			paletteOptions[p.id] = p.name;
		});

		new Setting(palSec)
			.setName(t('settings.plotGrid.activePalette.name'))
			.addDropdown((dd) =>
				dd
					.addOptions(paletteOptions)
					.setValue(this.plugin.settings.activeColorPaletteId)
					.onChange(async (value) => {
						this.plugin.settings.activeColorPaletteId = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		const activePalette = this.plugin.settings.colorPalettes.find(
			(p) => p.id === this.plugin.settings.activeColorPaletteId
		);
		if (activePalette) {
			const swatchRow = palSec.createDiv({ cls: 'sg-swatch-row' });
			activePalette.colors.forEach((color) => {
				const swatch = swatchRow.createDiv({ cls: 'sg-swatch-preview' });
				if (color.includes('gradient(')) {
					swatch.style.backgroundImage = color;
				} else {
					swatch.style.backgroundColor = color;
				}
				swatch.title = GRADIENT_NAMES[color] || color;
			});
		}

		const gridTplSec = this.section(parent, t('settings.plotGrid.customTemplates.title'),
			t('settings.plotGrid.customTemplates.desc'));

		this.plugin.settings.customTemplates.forEach((template) => {
			new Setting(gridTplSec)
				.setName(template.name)
				.setDesc(t('settings.plotGrid.customTemplates.rowsCols', {
					rows: template.rows.length,
					rowsS: template.rows.length !== 1 ? 's' : '',
					cols: template.columns.length,
					colsS: template.columns.length !== 1 ? 's' : '',
				}))
				.addButton((btn) => btn
					.setButtonText(t('common.delete'))
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.customTemplates =
							this.plugin.settings.customTemplates.filter((tpl) => tpl.id !== template.id);
						await this.plugin.saveSettings();
						this.display();
					}));
		});

		this.renderAddCustomTemplateForm(gridTplSec);
	}

	// ── Codex ───────────────────────────────────────────────────────────
	// Codex sheets → Custom Templates (entity field templates)

	private renderWorldCodex(parent: HTMLElement): void {
		const codexSec = this.section(parent, t('settings.codex.sheets.title'),
			t('settings.codex.sheets.desc'));

		new Setting(codexSec)
			.setName(t('settings.codex.askStartMode.name'))
			.setDesc(t('settings.codex.askStartMode.desc'))
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.entityAskStartMode ?? true)
					.onChange(async (v) => {
						this.plugin.settings.entityAskStartMode = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(codexSec)
			.setName(t('settings.codex.polishedStyling.name'))
			.setDesc(t('settings.codex.polishedStyling.desc'))
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.codexSheetStyling ?? true)
					.onChange(async (v) => {
						this.plugin.settings.codexSheetStyling = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(codexSec)
			.setName(t('settings.codex.infoboxPosition.name'))
			.setDesc(t('settings.codex.infoboxPosition.desc'))
			.setTooltip(t('settings.codex.infoboxPosition.tooltip'))
			.addDropdown((dd) =>
				dd
					.addOptions({
						right: t('settings.codex.infoboxPosition.right'),
						left: t('settings.codex.infoboxPosition.left'),
						top: t('settings.codex.infoboxPosition.top'),
					})
					.setValue(this.plugin.settings.codexInfoboxPosition ?? 'right')
					.onChange(async (v) => {
						this.plugin.settings.codexInfoboxPosition = v as 'right' | 'left' | 'top';
						await this.plugin.saveSettings();
					})
			);

		// Where pictures added to a sheet are saved. The folder name only
		// matters for "A folder per sheet", so it hides under the other choice.
		let folderNameSetting: Setting | null = null;
		new Setting(codexSec)
			.setName(t('settings.codex.imageLocation.name'))
			.setDesc(t('settings.codex.imageLocation.desc'))
			.addDropdown((dd) =>
				dd
					.addOptions({
						'per-sheet': t('settings.codex.imageLocation.perSheet'),
						obsidian: t('settings.codex.imageLocation.obsidian'),
					})
					.setValue(this.plugin.settings.codexImageLocation ?? 'per-sheet')
					.onChange(async (v) => {
						this.plugin.settings.codexImageLocation = v === 'obsidian' ? 'obsidian' : 'per-sheet';
						await this.plugin.saveSettings();
						folderNameSetting?.settingEl.toggle(v !== 'obsidian');
					})
			);
		folderNameSetting = new Setting(codexSec)
			.setName(t('settings.codex.imagesFolder.name'))
			.setDesc(t('settings.codex.imagesFolder.desc'))
			.addText((tx) => {
				tx.setPlaceholder('Images').setValue(this.plugin.settings.codexImagesFolderName ?? 'Images');
				// Saved when she leaves the box (not on every key), and every
				// project's existing Images folder is renamed to match, so no
				// sheet loses its pictures.
				tx.inputEl.addEventListener('change', async () => {
					const before = this.plugin.settings.codexImagesFolderName ?? 'Images';
					const next = tx.getValue().trim() || 'Images';
					if (next === before) return;
					if (imagesFolderNameProblem(next)) {
						new Notice(t('settings.codex.imagesFolder.taken', { name: next }));
						tx.setValue(before);
						return;
					}
					const roots = [
						...findProjects(this.app).map((p) => p.rootPath),
						...Object.values(this.plugin.settings.seriesRegistry ?? {}).map((s) => s.rootPath),
					];
					// All or nothing: if any project cannot follow, the old name stays.
					try {
						const { blocked } = await renameImagesFolders(this.app, roots, before, next);
						if (blocked.length > 0) {
							new Notice(t('settings.codex.imagesFolder.skipped', { paths: blocked.join(', ') }));
							tx.setValue(before);
							return;
						}
					} catch (err) {
						new Notice(t('codex.images.notice.actionFailed', { msg: err instanceof Error ? err.message : '' }));
						tx.setValue(before);
						return;
					}
					this.plugin.settings.codexImagesFolderName = next;
					await this.plugin.saveSettings();
				});
			});
		folderNameSetting.settingEl.toggle((this.plugin.settings.codexImageLocation ?? 'per-sheet') !== 'obsidian');

		// Entity field templates — one block per worldbuilding kind
		const templateSections: Array<{
			labelKey: string;
			key: 'characterFieldTemplates' | 'sceneFieldTemplates' | 'locationFieldTemplates' | 'factionFieldTemplates' | 'systemFieldTemplates' | 'itemFieldTemplates' | 'researchFieldTemplates';
		}> = [
			{ labelKey: 'settings.codex.kinds.character', key: 'characterFieldTemplates' },
			{ labelKey: 'settings.codex.kinds.scene',     key: 'sceneFieldTemplates' },
			{ labelKey: 'settings.codex.kinds.location',  key: 'locationFieldTemplates' },
			{ labelKey: 'settings.codex.kinds.faction',   key: 'factionFieldTemplates' },
			{ labelKey: 'settings.codex.kinds.system',    key: 'systemFieldTemplates' },
			{ labelKey: 'settings.codex.kinds.item',      key: 'itemFieldTemplates' },
			{ labelKey: 'settings.codex.kinds.research',  key: 'researchFieldTemplates' },
		];

		for (const section of templateSections) {
			const templates = this.plugin.settings[section.key] ?? [];
			// Only show sections that have saved templates, except Character which
			// always shows so users can discover the feature.
			if (templates.length === 0 && section.key !== 'characterFieldTemplates') continue;

			const kindLabel = t(section.labelKey);
			const kindLower = kindLabel.toLowerCase();
			const sec = this.section(parent, t('settings.codex.fieldTemplates.title', { kind: kindLabel }),
				t('settings.codex.fieldTemplates.desc', { kindLower }));

			if (templates.length === 0) {
				sec.createEl('p', {
					text: t('settings.codex.fieldTemplates.empty', { kindLower }),
					cls: 'sg-settings-desc',
				});
			} else {
				templates.forEach((template) => {
					new Setting(sec)
						.setName(template.name)
						.setDesc(t('settings.codex.fieldTemplates.fieldCount', {
							count: template.fields.length,
							plural: template.fields.length !== 1 ? 's' : '',
							list: template.fields.map((f) => f.label).join(', '),
						}))
						.addButton((btn) => btn
							.setButtonText(t('settings.codex.fieldTemplates.edit'))
							.onClick(() => {
								new TemplateBuilderModal(this.app, kindLabel, template, async (updated) => {
									const list = this.plugin.settings[section.key];
									const idx = list.findIndex((tpl) => tpl.id === updated.id);
									if (idx >= 0) list[idx] = updated;
									await this.plugin.saveSettings();
									this.display();
								}).open();
							}))
						.addButton((btn) => btn
							.setButtonText(t('common.delete'))
							.setWarning()
							.onClick(async () => {
								this.plugin.settings[section.key] =
									this.plugin.settings[section.key].filter((tpl) => tpl.id !== template.id);
								await this.plugin.saveSettings();
								this.display();
							}));
				});
			}

			const newBtnRow = new Setting(sec).setName('');
			newBtnRow.settingEl.addClass('sg-settings-new-template-row');
			newBtnRow.addButton((btn) => btn
				.setButtonText('+ ' + t('settings.codex.fieldTemplates.new'))
				.onClick(() => {
					new TemplateBuilderModal(this.app, kindLabel, null, async (created) => {
						const list = this.plugin.settings[section.key] ?? [];
						this.plugin.settings[section.key] = [...list, created];
						await this.plugin.saveSettings();
						this.display();
					}).open();
				}));
		}
	}

	// Moved to the "Views" tab (Step 11) — anything that configures a map/tree
	// view lives together with Story Tree settings now, instead of being buried
	// here under Codex.
	private renderRelationshipTypes(parent: HTMLElement): void {
		const sec = this.section(parent, t('settings.relTypes.title'),
			t('settings.relTypes.desc'));

		const types = this.plugin.settings.customRelationshipTypes ?? [];

		if (types.length === 0) {
			sec.createEl('p', {
				text: t('settings.relTypes.empty'),
				cls: 'sg-settings-desc',
			});
		}

		// Reciprocal dropdown choices: symmetric, one-way, or any other named type.
		const reciprocalOptions = (selfId: string): Record<string, string> => {
			const opts: Record<string, string> = {
				self: t('settings.relTypes.symmetric'),
				none: t('settings.relTypes.oneWay'),
			};
			for (const tp of types) {
				if (tp.id !== selfId && tp.label.trim()) opts[tp.id] = t('settings.relTypes.opposite', { label: tp.label });
			}
			return opts;
		};

		types.forEach((type) => {
			const row = new Setting(sec);
			row.addText((txt) => txt
				.setPlaceholder(t('settings.relTypes.namePlaceholder'))
				.setValue(type.label)
				.onChange((v) => {
					type.label = v;
					this.debouncedSaveSettings();
				}));
			row.addColorPicker((cp) => cp
				.setValue(type.color)
				.onChange(async (v) => {
					type.color = v;
					await this.plugin.saveSettings();
				}));
			row.addDropdown((dd) => dd
				.addOptions(reciprocalOptions(type.id))
				.setValue(type.reciprocal)
				.onChange(async (v) => {
					type.reciprocal = v;
					// Keep pairs mutual — if paired to another type, point it back here.
					if (v !== 'self' && v !== 'none') {
						const other = types.find((tp) => tp.id === v);
						if (other) other.reciprocal = type.id;
					}
					await this.plugin.saveSettings();
					this.display();
				}));
			row.addExtraButton((btn) => btn
				.setIcon('trash')
				.setTooltip(t('settings.relTypes.deleteTooltip'))
				.onClick(async () => {
					this.plugin.settings.customRelationshipTypes = types.filter((tp) => tp.id !== type.id);
					// Clear dangling reciprocal references to the deleted type.
					for (const tp of this.plugin.settings.customRelationshipTypes) {
						if (tp.reciprocal === type.id) tp.reciprocal = 'self';
					}
					await this.plugin.saveSettings();
					this.display();
				}));

			const styleWrap = sec.createDiv({ cls: 'sg-rtw-row-styles' });
			renderLineStylePicker(styleWrap, type.lineStyle ?? 'solid', type.color, async (style) => {
				type.lineStyle = style;
				await this.plugin.saveSettings();
			});
		});

		const wizardBtnRow = new Setting(sec)
			.addButton((btn) => btn
				.setButtonText(t('settings.relTypes.createButton'))
				.setCta()
				.onClick(() => {
					wizardBtnRow.settingEl.style.display = 'none';
					wizardHost.style.display = '';
					mountRelTypeWizard(wizardHost, this.plugin, {
						onCreated: () => this.display(),
						onCancel: () => this.display(),
					});
				}));
		const wizardHost = sec.createDiv({ cls: 'sg-rtw-host' });
		wizardHost.style.display = 'none';
	}

	// ── Writing ───────────────────────────────────────────────────────────────
	// Writing goals (+ Progress-tab visibility, consolidated) → Sprints →
	// Task settings → Typewriter (Focus merged in here, Step 11)

	private renderWriting(parent: HTMLElement): void {
		const goalSec = this.section(parent, t('settings.tasksGoals.writingGoals.title'),
			t('settings.tasksGoals.writingGoals.desc'));

		const goals = (this.plugin.settings.wordGoals ??= {});
		const goalWins = new Set(this.plugin.settings.sidebarGoalWindows ?? ['daily', 'weekly']);
		const toggleGoalWindow = async (win: 'daily' | 'weekly' | 'monthly', on: boolean) => {
			on ? goalWins.add(win) : goalWins.delete(win);
			this.plugin.settings.sidebarGoalWindows = ['daily', 'weekly', 'monthly'].filter((w) =>
				goalWins.has(w as 'daily' | 'weekly' | 'monthly')
			) as Array<'daily' | 'weekly' | 'monthly'>;
			await this.plugin.saveSettings();
		};

		for (const { key, labelKey, placeholderKey } of WORD_GOAL_FIELDS) {
			const row = new Setting(goalSec)
				.setName(t(labelKey))
				.addText((text) => {
					text.inputEl.type = 'number';
					text.inputEl.min = '0';
					text
						.setPlaceholder(t(placeholderKey))
						.setValue(goals[key] ? String(goals[key]) : '')
						.onChange((v) => {
							const n = Math.max(0, parseInt(v, 10) || 0);
							if (n > 0) goals[key] = n;
							else delete goals[key];
							this.debouncedSaveData();
						});
				});
			// Only daily/weekly/monthly have a Progress-tab bar to show/hide —
			// yearly and whole-manuscript goals only ever show on the Dashboard.
			if (key === 'daily' || key === 'weekly' || key === 'monthly') {
				row.setDesc(t('settings.tasksGoals.showOnProgress.desc'));
				row.setTooltip(t('settings.tasksGoals.showOnProgress.tooltip'));
				row.addToggle((tg) =>
					tg.setValue(goalWins.has(key)).onChange((v) => void toggleGoalWindow(key, v))
				);
			}
		}

		new Setting(goalSec)
			.setName(t('settings.tasksGoals.pasteThreshold.name'))
			.setDesc(t('settings.tasksGoals.pasteThreshold.desc'))
			.addSlider((s) =>
				s
					.setLimits(20, 300, 10)
					.setValue(this.plugin.settings.pasteWordThreshold ?? 80)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.pasteWordThreshold = v;
						await this.plugin.saveData(this.plugin.settings);
					}),
			);

		const sprintSec = this.section(parent, t('settings.tasksGoals.sprints.title'),
			t('settings.tasksGoals.sprints.desc'));

		new Setting(sprintSec)
			.setName(t('settings.tasksGoals.sprintLength.name'))
			.setDesc(t('settings.tasksGoals.sprintLength.desc'))
			.addSlider((sl) =>
				sl
					.setLimits(5, 60, 5)
					.setValue(this.plugin.settings.sprintDefaultMinutes ?? 25)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.sprintDefaultMinutes = v;
						await this.plugin.saveData(this.plugin.settings);
					})
			);

		new Setting(sprintSec)
			.setName(t('settings.tasksGoals.sprintGoalDaily.name'))
			.setDesc(t('settings.tasksGoals.sprintGoalDaily.desc'))
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
				text
					.setPlaceholder(t('settings.tasksGoals.sprintGoalDaily.ph'))
					.setValue(this.plugin.settings.sprintGoalDaily ? String(this.plugin.settings.sprintGoalDaily) : '')
					.onChange((v) => {
						this.plugin.settings.sprintGoalDaily = Math.max(0, parseInt(v, 10) || 0);
						this.debouncedSaveData();
					});
			});

		new Setting(sprintSec)
			.setName(t('settings.tasksGoals.sprintGoalWeekly.name'))
			.setDesc(t('settings.tasksGoals.sprintGoalWeekly.desc'))
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
				text
					.setPlaceholder(t('settings.tasksGoals.sprintGoalWeekly.ph'))
					.setValue(this.plugin.settings.sprintGoalWeekly ? String(this.plugin.settings.sprintGoalWeekly) : '')
					.onChange((v) => {
						this.plugin.settings.sprintGoalWeekly = Math.max(0, parseInt(v, 10) || 0);
						this.debouncedSaveData();
					});
			});

		new Setting(sprintSec)
			.setName(t('settings.tasksGoals.timerDisplay.name'))
			.setDesc(t('settings.tasksGoals.timerDisplay.desc'))
			.setTooltip(t('settings.tasksGoals.timerDisplay.tooltip'))
			.addDropdown((dd) =>
				dd
					.addOptions({
						digital: t('settings.tasksGoals.timerDisplay.digital'),
						bar: t('settings.tasksGoals.timerDisplay.bar'),
						ring: t('settings.tasksGoals.timerDisplay.ring'),
					})
					.setValue(this.plugin.settings.sprintTimerStyle ?? 'digital')
					.onChange(async (v) => {
						this.plugin.settings.sprintTimerStyle = v as 'digital' | 'bar' | 'ring';
						await this.plugin.saveData(this.plugin.settings);
					})
			);

		new Setting(sprintSec)
			.setName(t('settings.tasksGoals.sprintSound.name'))
			.setDesc(t('settings.tasksGoals.sprintSound.desc'))
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.sprintSound !== false)
					.onChange(async (v) => {
						this.plugin.settings.sprintSound = v;
						await this.plugin.saveData(this.plugin.settings);
					})
			);

		const stats = this.plugin.getSprintStats();
		const statRow = sprintSec.createDiv({ cls: 'sg-settings-sprint-stats' });
		const statChip = (value: string, label: string) => {
			const chip = statRow.createDiv({ cls: 'sg-settings-sprint-chip' });
			chip.createDiv({ cls: 'sg-settings-sprint-value', text: value });
			chip.createDiv({ cls: 'sg-settings-sprint-label', text: label });
		};
		statChip(String(stats.today), t('settings.tasksGoals.sprintStats.today'));
		statChip(String(stats.total), t('settings.tasksGoals.sprintStats.total'));
		statChip(stats.totalWords.toLocaleString(), t('settings.tasksGoals.sprintStats.words'));

		if (stats.total > 0) {
			new Setting(sprintSec)
				.setName(t('settings.tasksGoals.clearHistory.name'))
				.setDesc(t('settings.tasksGoals.clearHistory.desc'))
				.addButton((btn) => btn
					.setButtonText(t('settings.tasksGoals.clearHistory.button'))
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.sprintHistory = [];
						await this.plugin.saveData(this.plugin.settings);
						this.display();
					}));
		}

		const taskSec = this.section(parent, t('settings.tasksGoals.taskSettings.title'),
			t('settings.tasksGoals.taskSettings.desc'));

		new Setting(taskSec)
			.setName(t('settings.tasksGoals.starterTasks.name'))
			.setDesc(t('settings.tasksGoals.starterTasks.desc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.taskOnboarding !== false)
					.onChange(async (v) => {
						this.plugin.settings.taskOnboarding = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(taskSec)
			.setName(t('settings.tasksGoals.showCompleted.name'))
			.setDesc(t('settings.tasksGoals.showCompleted.desc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.taskShowCompleted !== false)
					.onChange(async (v) => {
						this.plugin.settings.taskShowCompleted = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(taskSec)
			.setName(t('settings.tasksGoals.defaultSort.name'))
			.setDesc(t('settings.tasksGoals.defaultSort.desc'))
			.setTooltip(t('settings.tasksGoals.defaultSort.tooltip'))
			.addDropdown((dd) =>
				dd
					.addOptions({
						urgency: t('settings.tasksGoals.defaultSort.urgency'),
						manual: t('settings.tasksGoals.defaultSort.manual'),
					})
					.setValue(this.plugin.settings.taskDefaultSort ?? 'urgency')
					.onChange(async (v) => {
						this.plugin.settings.taskDefaultSort = v as 'urgency' | 'manual';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(taskSec)
			.setName(t('settings.tasksGoals.subtaskRollup.name'))
			.setDesc(t('settings.tasksGoals.subtaskRollup.desc'))
			.setTooltip(t('settings.tasksGoals.subtaskRollup.tooltip'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.taskSubtaskRollup !== false)
					.onChange(async (v) => {
						this.plugin.settings.taskSubtaskRollup = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(taskSec)
			.setName(t('settings.tasksGoals.showCompletionDate.name'))
			.setDesc(t('settings.tasksGoals.showCompletionDate.desc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.taskShowCompletedDate === true)
					.onChange(async (v) => {
						this.plugin.settings.taskShowCompletedDate = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(taskSec)
			.setName(t('settings.tasksGoals.sidebarMaxOpen.name'))
			.setDesc(t('settings.tasksGoals.sidebarMaxOpen.desc'))
			.addSlider((s) =>
				s
					.setLimits(3, 20, 1)
					.setValue(this.plugin.settings.taskSidebarMaxOpen ?? 5)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.taskSidebarMaxOpen = v;
						await this.plugin.saveSettings();
					}),
			);

		// Typewriter mode (Focus tab merged in here, Step 11 — it only ever held
		// these 5 settings and didn't earn a whole tab of its own).
		const twSec = this.section(parent, t('settings.focus.typewriter.title'),
			t('settings.focus.typewriter.titleDesc'));

		new Setting(twSec)
			.setName(t('settings.focus.typewriterMode.name'))
			.setDesc(t('settings.focus.typewriterMode.desc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.typewriterMode).onChange(async (v) => {
					this.plugin.settings.typewriterMode = v;
					await this.plugin.saveSettings();
					this.plugin.refreshTypewriterMode();
				})
			);

		new Setting(twSec)
			.setName(t('settings.focus.linePosition.name'))
			.setDesc(t('settings.focus.linePosition.desc'))
			.addSlider((sl) =>
				sl
					.setLimits(10, 90, 5)
					.setValue(this.plugin.settings.typewriterLinePosition ?? 35)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.typewriterLinePosition = v;
						await this.plugin.saveData(this.plugin.settings);
						this.plugin.refreshTypewriterMode();
					})
			);

		new Setting(twSec)
			.setName(t('settings.focus.dimming.name'))
			.setDesc(t('settings.focus.dimming.desc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.typewriterDimming).onChange(async (v) => {
					this.plugin.settings.typewriterDimming = v;
					await this.plugin.saveSettings();
					this.plugin.refreshTypewriterMode();
				})
			);

		new Setting(twSec)
			.setName(t('settings.focus.solidRows.name'))
			.setDesc(t('settings.focus.solidRows.desc'))
			.addSlider((sl) =>
				sl
					.setLimits(1, 7, 1)
					.setValue(this.plugin.settings.typewriterSolidRows ?? 1)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.typewriterSolidRows = v;
						await this.plugin.saveData(this.plugin.settings);
						this.plugin.refreshTypewriterMode();
					})
			);

		new Setting(twSec)
			.setName(t('settings.focus.dimStrength.name'))
			.setDesc(t('settings.focus.dimStrength.desc'))
			.addSlider((sl) =>
				sl
					.setLimits(10, 90, 5)
					.setValue(this.plugin.settings.typewriterDimStrength ?? 60)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.typewriterDimStrength = v;
						await this.plugin.saveData(this.plugin.settings);
						this.plugin.refreshTypewriterMode();
					})
			);
	}

	// ── Views ─────────────────────────────────────────────────────────────────
	// Anything that configures a map/tree view lives together here (Step 11):
	// Story Tree defaults (was under Tasks & Goals) + Relationship types
	// (was under Codex).

	private renderViews(parent: HTMLElement): void {
		const writersPanelSec = this.section(parent, t('settings.views.writersPanel.title'));

		new Setting(writersPanelSec)
			.setName(t('settings.views.writersPanel.codexLinks.name'))
			.setDesc(t('settings.views.writersPanel.codexLinks.desc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.openCodexLinksInPanel !== false)
					.onChange(async (v) => {
						this.plugin.settings.openCodexLinksInPanel = v;
						await this.plugin.saveSettings();
					}),
			);

		const storyTreeSec = this.section(parent, t('settings.views.storyTree.title'),
			t('settings.views.storyTree.desc'));

		new Setting(storyTreeSec)
			.setName(t('settings.views.storyTree.defaultView.name'))
			.setDesc(t('settings.views.storyTree.defaultView.desc'))
			.setTooltip(t('settings.views.storyTree.defaultView.tooltip'))
			.addDropdown((dd) =>
				dd
					.addOptions({
						family: t('settings.views.storyTree.defaultView.family'),
						faction: t('settings.views.storyTree.defaultView.faction'),
					})
					.setValue(this.plugin.settings.storyTreeDefaultMode ?? 'family')
					.onChange(async (v) => {
						this.plugin.settings.storyTreeDefaultMode = v as 'family' | 'faction';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(storyTreeSec)
			.setName(t('settings.views.storyTree.includePartners.name'))
			.setDesc(t('settings.views.storyTree.includePartners.desc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.storyTreeIncludePartners !== false)
					.onChange(async (v) => {
						this.plugin.settings.storyTreeIncludePartners = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(storyTreeSec)
			.setName(t('settings.views.storyTree.showPortraits.name'))
			.setDesc(t('settings.views.storyTree.showPortraits.desc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.storyTreeShowPortraits !== false)
					.onChange(async (v) => {
						this.plugin.settings.storyTreeShowPortraits = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(storyTreeSec)
			.setName(t('settings.views.storyTree.nodeStyle.name'))
			.setDesc(t('settings.views.storyTree.nodeStyle.desc'))
			.addDropdown((dd) =>
				dd
					.addOptions({
						card: t('settings.views.storyTree.nodeStyle.card'),
						dots: t('settings.views.storyTree.nodeStyle.dots'),
					})
					.setValue(this.plugin.settings.storyTreeNodeStyle ?? 'card')
					.onChange(async (v) => {
						this.plugin.settings.storyTreeNodeStyle = v as 'card' | 'dots';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(storyTreeSec)
			.setName(t('settings.views.storyTree.relationInfo.name'))
			.setDesc(t('settings.views.storyTree.relationInfo.desc'))
			.addDropdown((dd) =>
				dd
					.addOptions({
						off: t('settings.views.storyTree.relationInfo.off'),
						hover: t('settings.views.storyTree.relationInfo.hover'),
						always: t('settings.views.storyTree.relationInfo.always'),
					})
					.setValue(this.plugin.settings.storyTreeEdgeLabelMode ?? 'hover')
					.onChange(async (v) => {
						this.plugin.settings.storyTreeEdgeLabelMode = v as 'off' | 'hover' | 'always';
						await this.plugin.saveSettings();
					}),
			);

		const socialMapsSec = this.section(parent, t('settings.views.socialMaps.title'),
			t('settings.views.socialMaps.desc'));

		new Setting(socialMapsSec)
			.setName(t('settings.views.socialMaps.nodeDisplay.name'))
			.setDesc(t('settings.views.socialMaps.nodeDisplay.desc'))
			.addDropdown((dd) =>
				dd
					.addOptions({
						dot: t('settings.views.socialMaps.nodeDisplay.dot'),
						portrait: t('settings.views.socialMaps.nodeDisplay.portrait'),
					})
					.setValue(this.plugin.settings.connMapNodeDisplay ?? 'dot')
					.onChange(async (v) => {
						this.plugin.settings.connMapNodeDisplay = v as 'dot' | 'portrait';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(socialMapsSec)
			.setName(t('settings.views.socialMaps.scaleBySize.name'))
			.setDesc(t('settings.views.socialMaps.scaleBySize.desc'))
			.addToggle((tg) =>
				tg.setValue(this.plugin.settings.connMapScaleBySize !== false)
					.onChange(async (v) => {
						this.plugin.settings.connMapScaleBySize = v;
						await this.plugin.saveSettings();
					}),
			);

		this.renderRelationshipTypes(parent);
	}

	// ── Custom grid template form ─────────────────────────────────────────────

	private renderAddCustomTemplateForm(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv({ cls: 'sg-custom-template-form' });

		let expanded = false;
		let templateName = '';
		let rowLabels: string[] = [t('settings.customTemplateForm.rows.defaultLabel')];
		let colLabels: string[] = [
			t('settings.customTemplateForm.cols.default1'),
			t('settings.customTemplateForm.cols.default2'),
			t('settings.customTemplateForm.cols.default3'),
		];

		const addBtn = wrapper.createEl('button', {
			cls: 'sg-character-add-field',
			text: t('settings.customTemplateForm.addButton'),
		});

		const formEl = wrapper.createDiv({ cls: 'sg-custom-template-form-body' });
		formEl.style.display = 'none';

		const refresh = () => {
			formEl.empty();

			// Template name
			new Setting(formEl)
				.setName(t('settings.customTemplateForm.name.name'))
				.addText((tf) => tf
					.setPlaceholder(t('settings.customTemplateForm.name.placeholder'))
					.setValue(templateName)
					.onChange((v) => { templateName = v; })
				);

			// Rows
			formEl.createEl('p', { text: t('settings.customTemplateForm.rows.label'), cls: 'sg-modal-label' });
			rowLabels.forEach((label, i) => {
				const row = formEl.createDiv({ cls: 'sg-custom-template-row' });
				const input = row.createEl('input', {
					type: 'text', value: label, cls: 'sg-character-field-label',
					attr: { 'aria-label': `Row ${i + 1} label` },
				});
				input.style.flex = '1';
				input.addEventListener('input', () => { rowLabels[i] = input.value; });
				const del = row.createEl('button', { text: '✕', cls: 'sg-character-field-delete' });
				del.addEventListener('click', () => { rowLabels.splice(i, 1); refresh(); });
			});
			formEl.createEl('button', { text: t('settings.customTemplateForm.rows.addRow'), cls: 'sg-character-add-field' })
				.addEventListener('click', () => { rowLabels.push(t('settings.customTemplateForm.rows.newRowDefault')); refresh(); });

			// Columns
			formEl.createEl('p', { text: t('settings.customTemplateForm.cols.label'), cls: 'sg-modal-label' });
			colLabels.forEach((label, i) => {
				const row = formEl.createDiv({ cls: 'sg-custom-template-row' });
				const input = row.createEl('input', {
					type: 'text', value: label, cls: 'sg-character-field-label',
					attr: { 'aria-label': `Column ${i + 1} label` },
				});
				input.style.flex = '1';
				input.addEventListener('input', () => { colLabels[i] = input.value; });
				const del = row.createEl('button', { text: '✕', cls: 'sg-character-field-delete' });
				del.addEventListener('click', () => { colLabels.splice(i, 1); refresh(); });
			});
			formEl.createEl('button', { text: t('settings.customTemplateForm.cols.addCol'), cls: 'sg-character-add-field' })
				.addEventListener('click', () => { colLabels.push(t('settings.customTemplateForm.cols.newColDefault')); refresh(); });

			// Save / Cancel
			const actions = formEl.createDiv({ cls: 'sg-modal-actions' });
			actions.style.marginTop = '12px';

			const saveBtn = actions.createEl('button', { cls: 'sg-modal-btn sg-modal-btn-primary', text: t('settings.customTemplateForm.save') });
			saveBtn.addEventListener('click', async () => {
				const name = templateName.trim() || t('settings.customTemplateForm.defaultName');
				this.plugin.settings.customTemplates.push({
					id: generateId(),
					name,
					description: t('settings.customTemplateForm.description', { rows: rowLabels.length, cols: colLabels.length }),
					rows: rowLabels.filter(Boolean).map((label) => ({ label })),
					columns: colLabels.filter(Boolean).map((label) => ({ label })),
				});
				await this.plugin.saveSettings();
				this.display();
			});

			const cancelBtn = actions.createEl('button', { cls: 'sg-modal-btn', text: t('settings.customTemplateForm.cancel') });
			cancelBtn.addEventListener('click', () => {
				expanded = false;
				formEl.style.display = 'none';
				addBtn.style.display = '';
			});
		};

		addBtn.addEventListener('click', () => {
			expanded = !expanded;
			formEl.style.display = expanded ? 'block' : 'none';
			addBtn.style.display = expanded ? 'none' : '';
			if (expanded) refresh();
		});
	}

	private renderPro(parent: HTMLElement): void {
		const state = getEntitlementState();

		// ── Status banner ────────────────────────────────────────────────────
		const banner = parent.createDiv({ cls: 'sg-pro-banner' });
		banner.createSpan({ cls: 'sg-pro-status-dot sg-pro-status-dot--active', text: '●' });
		banner.createSpan({
			cls: 'sg-pro-status-text',
			text: t('settings.pro.banner'),
		});

		// ── License key ───────────────────────────────────────────────────────
		const keySec = this.section(parent, t('settings.pro.licenseKey.title'), undefined, { collapsible: false });
		new Setting(keySec)
			.setName(t('settings.pro.licenseKey.name'))
			.setDesc(t('settings.pro.licenseKey.desc'))
			.addText((text) => {
				text
					.setPlaceholder('SG-XXXX-XXXX-XXXX')
					.setValue(state.licenseKey ?? '')
					.onChange((value) => {
						this.plugin.settings.licenseKey = value.trim() || undefined;
						this.debouncedSaveSettings();
						// Keep the runtime gate honest with what's on disk — this is
						// the hook point for server validation once payment is wired up.
						const cur = getEntitlementState();
						setEntitlementState({
							...cur,
							licenseKey: this.plugin.settings.licenseKey ?? null,
							enabledFeatures: new Set(cur.enabledFeatures),
						});
					});
				text.inputEl.type = 'password';
			});

		// ── Feature list ──────────────────────────────────────────────────────
		const featureSec = this.section(parent, t('settings.pro.features.title'), undefined, { collapsible: false });

		// Honest mode: list only Pro features that actually exist today.
		const SHIPPED_PRO_FEATURES: Array<{ id: FeatureId; nameKey: string; descKey: string }> = [
			{ id: 'prose-coach', nameKey: 'settings.pro.features.proseCoach.name', descKey: 'settings.pro.features.proseCoach.desc' },
		];

		for (const { id, nameKey, descKey } of SHIPPED_PRO_FEATURES) {
			const active = canUse(id);
			new Setting(featureSec)
				.setName(t(nameKey))
				.setDesc(t(descKey))
				.addExtraButton((btn) => {
					btn.setIcon(active ? 'check-circle' : 'lock');
					btn.setTooltip(active ? t('settings.pro.features.active') : t('settings.pro.features.requiresPro'));
					btn.extraSettingsEl.addClass(active ? 'sg-pro-feature-active' : 'sg-pro-feature-locked');
					btn.extraSettingsEl.style.cursor = 'default';
				});
		}
	}
}
