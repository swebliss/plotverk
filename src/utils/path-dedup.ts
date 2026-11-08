/**
 * Pure vault-path de-duplication — no Obsidian imports, fully unit-testable.
 *
 * Numbering is always derived from the ORIGINAL path, so repeated collisions
 * produce "img 2.png", "img 3.png" — never the compounding "img 2 3.png".
 * Extensionless names ("portrait") get the number appended at the end;
 * the old regex-only approach silently left those unchanged and looped forever.
 */

/** "img.png" + 3 → "img 3.png"; extensionless "portrait" + 3 → "portrait 3". */
export function numberedPathVariant(path: string, n: number): string {
	const ext = path.match(/(\.[^./\\]+)$/);
	if (!ext) return `${path} ${n}`;
	return `${path.slice(0, -ext[1].length)} ${n}${ext[1]}`;
}

/** First non-colliding variant of `path` per `exists`, capped so a pathological vault can't hang the UI. */
export function dedupePath(path: string, exists: (p: string) => boolean, cap = 1000): string {
	if (!exists(path)) return path;
	for (let n = 2; n <= cap; n++) {
		const candidate = numberedPathVariant(path, n);
		if (!exists(candidate)) return candidate;
	}
	// Cap exhausted (vault already holds `cap` numbered copies) — a timestamp suffix
	// is effectively unique without any further probing.
	return numberedPathVariant(path, Date.now());
}
