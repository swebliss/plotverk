/**
 * The loaded views of one type — never a tab Obsidian is still holding back.
 *
 * Since Obsidian 1.7, a tab that hasn't been shown since startup is "deferred":
 * `getLeavesOfType()` still returns its leaf, but `leaf.view` is a placeholder,
 * not our view class. Calling one of our methods on it throws — which once made
 * every sprint button silently do nothing after a restart with the Dashboard
 * open in a background tab. A deferred tab builds itself fresh when shown, so
 * skipping it loses nothing.
 *
 * No Obsidian imports, so it is unit-testable.
 */
export function liveViews<T>(
	workspace: { getLeavesOfType(type: string): Array<{ view: unknown }> },
	type: string,
	viewClass: abstract new (...args: never[]) => T
): T[] {
	const out: T[] = [];
	for (const leaf of workspace.getLeavesOfType(type)) {
		if (leaf.view instanceof viewClass) out.push(leaf.view);
	}
	return out;
}

/**
 * The view inside one leaf, loaded first if Obsidian is still holding it back.
 *
 * For click paths that must act on an existing tab (open the Writers Panel on
 * its Export tab, point the Dashboard at a project): `loadIfDeferred()` turns
 * the placeholder into our real view, and the `instanceof` check guarantees we
 * never call one of our methods on anything else. Null = no usable view; the
 * caller then sets the leaf's view state instead, which always works.
 */
export async function loadedView<T>(
	leaf: { view: unknown; loadIfDeferred?: () => Promise<void> } | null | undefined,
	viewClass: abstract new (...args: never[]) => T
): Promise<T | null> {
	if (!leaf) return null;
	await leaf.loadIfDeferred?.();
	return leaf.view instanceof viewClass ? leaf.view : null;
}

/**
 * A string value from a leaf's saved view state — readable whether or not the
 * tab is deferred (the placeholder view has none of our state, the leaf does).
 */
export function leafStateString(
	leaf: { getViewState(): { state?: Record<string, unknown> } },
	key: string
): string | null {
	const value = leaf.getViewState().state?.[key];
	return typeof value === 'string' ? value : null;
}
