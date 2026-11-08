import { App, TFile, OpenViewState } from 'obsidian';

/**
 * Open a file in a new tab, or reveal the existing leaf if the file is
 * already open anywhere in the workspace (avoids duplicate tabs).
 */
export async function openOrReveal(app: App, file: TFile, options?: OpenViewState): Promise<void> {
	let existing: ReturnType<typeof app.workspace.getLeaf> | null = null;
	app.workspace.iterateAllLeaves((leaf) => {
		if (existing) return;
		// MarkdownView, canvas view, etc. all expose .view.file
		const view = leaf.view as { file?: TFile | null };
		if (view?.file?.path === file.path) existing = leaf;
	});
	if (existing) {
		app.workspace.revealLeaf(existing);
		return;
	}
	await app.workspace.getLeaf('tab').openFile(file, options);
}
