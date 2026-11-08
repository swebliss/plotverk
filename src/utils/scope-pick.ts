/**
 * Which of the listed projects a view should show for the project the
 * Dashboard made active. In series mode the list holds whole series, while the
 * active project can be one book inside a series — so a book's folder maps to
 * the series folder around it. Order: the exact folder → the deepest project
 * folder containing it → the active series → the first project.
 */
export function pickScopeRoot(
	scopes: ReadonlyArray<{ rootPath: string }>,
	wanted: string,
	activeSeriesRoot?: string,
): string {
	if (scopes.some((s) => s.rootPath === wanted)) return wanted;
	const containing = scopes
		.filter((s) => s.rootPath !== '' && wanted.startsWith(s.rootPath + '/'))
		.sort((a, b) => b.rootPath.length - a.rootPath.length)[0];
	if (containing) return containing.rootPath;
	if (activeSeriesRoot !== undefined && scopes.some((s) => s.rootPath === activeSeriesRoot)) return activeSeriesRoot;
	return scopes[0]?.rootPath ?? '';
}
