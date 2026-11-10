import { plotverkEvents } from './utils/plotverk-events';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { onSettingsChanged } from './utils/obsidian-internals';
import type StorygridPlugin from './main';
import { RelGraphController } from './rel-graph-view';
import { StoryTreeController } from './story-tree-view';
import { setPhosphorIcon } from './utils/icons';
import { isSafetyNetPath } from './utils/safety-paths';
import { pickScopeRoot } from './utils/scope-pick';
import { findCodexScopes } from './entities/entity-manager';
import { t } from './i18n';

export const VIEW_TYPE_SOCIAL_MAPS = 'storygrid-social-maps-view';

export type SocialMapsTab = 'map' | 'tree';

/**
 * Merged Connections Map / Story Tree view. Both surfaces already read from
 * the same pure relations data layer (`utils/relations.ts` /
 * `utils/graph-data.ts`) — this is the shell that lets the user flip between
 * them without losing pan/zoom or reloading data twice. The heavy lifting
 * (SVG rendering, d3 force sim, tree layout) stays in `RelGraphController` /
 * `StoryTreeController`; this view owns only the tab bar, the shared
 * debounced vault listener, and which controller is currently mounted.
 */
export class SocialMapsView extends ItemView {
	plugin: StorygridPlugin;

	private activeTab: SocialMapsTab = 'tree';
	/** The project on screen (a book in series mode shows its whole series — the tabs report that back). */
	private scopeRoot = '';
	/** A project a button asked for ("View family tree"); null = follow the Dashboard's active project. */
	private explicitRoot: string | null = null;

	private mapCtrl!: RelGraphController;
	private treeCtrl!: StoryTreeController;
	private tabEls: Partial<Record<SocialMapsTab, HTMLElement>> = {};
	private bodyEl: HTMLElement | null = null;

	private refreshTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: StorygridPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_SOCIAL_MAPS; }
	getDisplayText(): string { return 'Social Maps'; }
	getIcon(): string { return 'sg-graph'; }

	getState(): Record<string, unknown> {
		// No project saved: a restored tab follows the Dashboard's active project.
		return {
			activeTab: this.activeTab,
			map: this.mapCtrl?.getState() ?? {},
			tree: this.treeCtrl?.getState() ?? {},
		};
	}

	async setState(state: Record<string, unknown>): Promise<void> {
		// Only a fresh open from a button carries a project; an old saved layout's scopeRoot is stale and ignored.
		this.explicitRoot = state.explicitScope === true && typeof state.scopeRoot === 'string' ? state.scopeRoot : null;
		if (state.activeTab === 'map' || state.activeTab === 'tree') this.activeTab = state.activeTab;
		if (state.map && typeof state.map === 'object') this.mapCtrl.setState(state.map as Record<string, unknown>);
		if (state.tree && typeof state.tree === 'object') this.treeCtrl.setState(state.tree as Record<string, unknown>);
		this.tabEls.map?.classList.toggle('is-active', this.activeTab === 'map');
		this.tabEls.tree?.classList.toggle('is-active', this.activeTab === 'tree');
		// A restored or freshly opened tab isn't a choice the writer made here, so it isn't remembered.
		this.remount(false);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		const root = this.contentEl.createDiv({ cls: 'sg-sm-root' });
		this.buildTabs(root);
		this.bodyEl = root.createDiv({ cls: 'sg-sm-body' });

		this.mapCtrl = new RelGraphController(this.plugin, this.bodyEl, () => this.scopeRoot, (r) => { this.scopeRoot = r; });
		this.treeCtrl = new StoryTreeController(this.plugin, this.bodyEl, () => this.scopeRoot, (r) => { this.scopeRoot = r; });

		// One shared, debounced listener for both tabs — only the currently
		// mounted controller refreshes; the other catches up next time it mounts.
		this.registerEvent(this.app.metadataCache.on('changed', (f) => this.scheduleRefresh(f.path)));
		this.registerEvent(this.app.vault.on('create', (f) => this.scheduleRefresh(f.path)));
		this.registerEvent(this.app.vault.on('delete', (f) => this.scheduleRefresh(f.path)));
		this.registerEvent(this.app.vault.on('rename', (f, oldPath) => this.scheduleRefresh(f.path, oldPath)));

		// The Dashboard is the one place that changes the project: follow it in both tabs.
		const onProjectChanged = () => { if (this.setRequestedRoot(null)) this.remount(false); };
		plotverkEvents.addEventListener('storygrid:project-changed', onProjectChanged);
		this.register(() => plotverkEvents.removeEventListener('storygrid:project-changed', onProjectChanged));
		// Series mode on/off changes which projects exist (series vs books) without a project change.
		// A custom event name, so it goes through the typed helper in utils/obsidian-internals.
		this.registerEvent(onSettingsChanged(this.app.workspace, () => {
			if (this.setRequestedRoot(this.explicitRoot)) this.remount(false);
		}));
	}

	async onClose(): Promise<void> {
		this.mapCtrl?.unmount();
		this.treeCtrl?.unmount();
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
	}

	/** Called when `plugin.openSocialMaps()` reuses an already-open leaf instead of creating one. */
	switchTo(tab: SocialMapsTab, scopeRoot?: string): void {
		// No root given ("Open Social Maps") = follow the Dashboard again, even after a button's project.
		const scopeChanged = this.setRequestedRoot(scopeRoot ?? null);
		if (tab !== this.activeTab) {
			this.activeTab = tab;
			this.tabEls.map?.classList.toggle('is-active', tab === 'map');
			this.tabEls.tree?.classList.toggle('is-active', tab === 'tree');
			this.remount();
		} else if (scopeChanged) {
			this.remount();
		}
	}

	/** Codex "View family tree" / "View faction tree": the Story Tree tab with the given tree state (one bloodline or one faction). */
	showStoryTree(treeState: Record<string, unknown>, scopeRoot: string): void {
		this.setRequestedRoot(scopeRoot);
		this.treeCtrl.setState(treeState);
		this.activeTab = 'tree';
		this.tabEls.map?.classList.toggle('is-active', false);
		this.tabEls.tree?.classList.toggle('is-active', true);
		this.remount();
	}

	// ── Tabs ──────────────────────────────────────────────────────────────────

	private buildTabs(parent: HTMLElement): void {
		const ctrl = parent.createDiv({ cls: 'sg-flat-tabs' });
		ctrl.setAttribute('role', 'tablist');
		// Tree first: the calmer view is the one people meet first.
		const TABS: Array<{ id: SocialMapsTab; label: string; icon: string; fallback: string }> = [
			{ id: 'tree', label: t('socialMaps.tab.tree'), icon: 'list-tree', fallback: '◆' },
			{ id: 'map', label: t('socialMaps.tab.map'), icon: 'sg-graph', fallback: '⬡' },
		];
		const opts: HTMLElement[] = [];
		for (const tab of TABS) {
			const isActive = this.activeTab === tab.id;
			const opt = ctrl.createDiv({ cls: 'sg-flat-tab' + (isActive ? ' is-active' : '') });
			opt.setAttribute('role', 'tab');
			opt.setAttribute('aria-selected', isActive ? 'true' : 'false');
			opt.setAttribute('tabindex', isActive ? '0' : '-1');
			const ic = opt.createSpan({ cls: 'sg-flat-tab-icon' });
			setPhosphorIcon(ic, tab.icon, tab.fallback);
			opt.createSpan({ text: tab.label });
			opt.addEventListener('click', () => this.switchTab(tab.id));
			this.tabEls[tab.id] = opt;
			opts.push(opt);
		}

		ctrl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
			const current = TABS.findIndex((tab) => tab.id === this.activeTab);
			if (current === -1) return;
			const next = e.key === 'ArrowRight'
				? (current + 1) % TABS.length
				: (current - 1 + TABS.length) % TABS.length;
			e.preventDefault();
			opts[next].focus();
			this.switchTab(TABS[next].id);
		});
	}

	private switchTab(tab: SocialMapsTab): void {
		if (this.activeTab === tab) return;
		this.activeTab = tab;
		this.tabEls.map?.classList.toggle('is-active', tab === 'map');
		this.tabEls.map?.setAttribute('aria-selected', tab === 'map' ? 'true' : 'false');
		this.tabEls.map?.setAttribute('tabindex', tab === 'map' ? '0' : '-1');
		this.tabEls.tree?.classList.toggle('is-active', tab === 'tree');
		this.tabEls.tree?.setAttribute('aria-selected', tab === 'tree' ? 'true' : 'false');
		this.tabEls.tree?.setAttribute('tabindex', tab === 'tree' ? '0' : '-1');
		this.remount();
	}

	/** Full re-render on tab/scope switch — empty the body, unmount the old controller, mount the new one. */
	private remount(remember = true): void {
		if (!this.bodyEl) return;
		this.mapCtrl.unmount();
		this.treeCtrl.unmount();
		this.bodyEl.empty();
		// The tab being mounted turns this into the project it shows (see the scope setter in onOpen).
		this.scopeRoot = this.explicitRoot ?? this.plugin.resolveActiveRoot();
		(this.activeTab === 'map' ? this.mapCtrl : this.treeCtrl).mount();
		// Remember the tab so the next "Open Social Maps" continues where the writer left off.
		if (remember && this.plugin.settings.socialMapsLastTab !== this.activeTab) {
			this.plugin.settings.socialMapsLastTab = this.activeTab;
			void this.plugin.saveSettingsQuiet();
		}
	}

	/**
	 * Point both tabs at `root` (null = the Dashboard's active project). True
	 * when that is another project than the one on screen — both tabs then
	 * forget their old focus. Draws nothing; the caller remounts.
	 */
	private setRequestedRoot(root: string | null): boolean {
		this.explicitRoot = root;
		const requested = root ?? this.plugin.resolveActiveRoot();
		const next = pickScopeRoot(findCodexScopes(this.app, this.plugin.settings), requested, this.plugin.activeSeriesRoot());
		if (next === this.scopeRoot) return false;
		this.mapCtrl.resetScope();
		this.treeCtrl.resetScope();
		return true;
	}

	// ── Shared vault listener ────────────────────────────────────────────────

	private touchesScope(path: string): boolean {
		if (isSafetyNetPath(path)) return false;
		if (!this.scopeRoot) return true;
		return (
			path === this.scopeRoot ||
			path.startsWith(this.scopeRoot + '/') ||
			this.scopeRoot.startsWith(path + '/') ||
			path.endsWith('.storygrid')
		);
	}

	private scheduleRefresh(...paths: string[]): void {
		if (paths.length > 0 && !paths.some((p) => this.touchesScope(p))) return;
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			(this.activeTab === 'map' ? this.mapCtrl : this.treeCtrl).refresh();
		}, 600);
	}
}
