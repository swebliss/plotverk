import { MarkdownView } from 'obsidian';
import type StorygridPlugin from '../main';
import { VIEW_TYPE_OUTLINE, StorygridOutlineView } from '../outline-view';
import { findProjects } from '../entities/entity-manager';

/**
 * Left-clicking a wikilink to a Codex entity in the editor (reading mode or
 * live preview) opens the entity's read-only preview in the Writers Panel
 * instead of a main-pane tab — the whole point of the sidebar preview cards
 * is to never break the writer's place in the draft.
 *
 * Every guard below fails OPEN: at the first sign of doubt it returns without
 * touching the event, so Obsidian's native link handling (and the pre-existing
 * entity-link-interceptor.ts, which still converts an opened entity note into
 * a Codex view) runs exactly as it does today. Ctrl/Cmd/Shift/Alt-click,
 * middle-click, hover preview, and "Open as note" are never touched.
 */
export function registerCodexClickInterceptor(plugin: StorygridPlugin): void {
	plugin.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		if (plugin.settings.openCodexLinksInPanel === false) return;
		if (evt.defaultPrevented) return;
		if (evt.button !== 0 || evt.ctrlKey || evt.metaKey || evt.shiftKey || evt.altKey) return;

		const target = evt.target as HTMLElement;
		if (!target.closest('.markdown-source-view, .markdown-reading-view')) return;
		if (target.closest('.sg-outline-root, .sg-codex-root')) return;

		let linktext = '';

		const readingLink = target.closest('a.internal-link') as HTMLAnchorElement | null;
		if (readingLink) {
			linktext = readingLink.getAttribute('data-href') ?? readingLink.getAttribute('href') ?? '';
		} else if (target.closest('.cm-underline, .cm-hmd-internal-link')) {
			// Live preview has no data-href on the link span — recover the linktext
			// from the raw line text at the click position. This touches an
			// internal CodeMirror API (editor.cm), so it is wrapped entirely in a
			// try/catch: any failure here just falls through to Obsidian's own
			// click handling, same as if this interceptor didn't exist.
			try {
				const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
				const cm = (mdView?.editor as any)?.cm;
				const pos = cm?.posAtCoords?.({ x: evt.clientX, y: evt.clientY });
				if (pos == null) return;
				const line = cm.state.doc.lineAt(pos);
				const re = /\[\[([^\[\]]+)\]\]/g;
				let m: RegExpExecArray | null;
				while ((m = re.exec(line.text))) {
					const from = line.from + m.index;
					const to = from + m[0].length;
					if (pos >= from && pos <= to) {
						linktext = m[1].split('|')[0].split('#')[0].trim();
						break;
					}
				}
			} catch {
				return;
			}
		}
		if (!linktext) return;

		const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? '';
		const dest = plugin.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
		if (!dest) return; // unresolved link — keep native "create note" behavior

		const fm = plugin.app.metadataCache.getFileCache(dest)?.frontmatter;
		if (!fm?.['storygrid-type']) return; // not a Codex entity

		const projectRoot = findProjects(plugin.app)
			.map((p) => p.rootPath)
			.find((root) => dest.path.startsWith(root ? root + '/' : ''));
		if (projectRoot === undefined) return;

		// All guards passed — this is genuinely a plain click on a Codex entity
		// wikilink. Only now do we take over the event.
		evt.preventDefault();
		evt.stopPropagation();
		void (async () => {
			await plugin.openOutline();
			const leaf = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_OUTLINE)[0];
			if (leaf?.view instanceof StorygridOutlineView) {
				await leaf.view.showEntityPreview(projectRoot, dest.path);
			}
		})();
	}, true);
}
