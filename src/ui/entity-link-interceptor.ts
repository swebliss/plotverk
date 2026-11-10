import { MarkdownView } from 'obsidian';
import type StorygridPlugin from '../main';
import { VIEW_TYPE_CODEX, StorygridCodexView } from '../codex-view';
import { findProjects } from '../entities/entity-manager';

/**
 * When any Codex entity file (storygrid-type frontmatter) opens in a plain
 * markdown leaf, convert that leaf to the Codex detail view instead.
 *
 * Uses the public `file-open` workspace event — no monkey-patching, no DOM
 * hacks. Works in every editor mode (reading, live preview, source, file
 * explorer click). Trade-off: brief flash of the raw note before redirect.
 *
 * To open the raw note intentionally, use "Open as note" in the ⋯ menu on
 * the Codex detail page.
 */
export function registerEntityLinkInterceptor(plugin: StorygridPlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on('file-open', (file) => {
			if (!file) return;

			// Only intercept Codex entity files
			const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm?.['storygrid-type']) return;

			// Only act when it opened in a plain markdown leaf
			const activeLeaf = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
			if (!activeLeaf) return;

			// Only act inside a known Storygrid project
			const projectRoot = findProjects(plugin.app)
				.map((p) => p.rootPath)
				.find((root) => file.path.startsWith(root ? root + '/' : ''));
			if (projectRoot === undefined) return;

			void (async () => {
				// Convert the markdown leaf to a Codex view in-place (no new tab)
				await activeLeaf.setViewState({ type: VIEW_TYPE_CODEX, active: true });
				void plugin.app.workspace.revealLeaf(activeLeaf);
				const view = activeLeaf.view as StorygridCodexView;

				await view.showProject(projectRoot);
				await view.openEntityDetail(file.path);
			})();
		})
	);
}
