// PUBLIC RELEASE: only the two small span helpers the free Coach uses.
// The dialogue-detection engine itself is a Pro check and is not included.

export interface Span {
	from: number;
	to: number;
}

/** Sorts spans and joins the ones that overlap, so overlapsAny can search them. */
export function mergeSpans(spans: readonly Span[]): Span[] {
	const sorted = [...spans].filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
	const out: Span[] = [];
	for (const s of sorted) {
		const last = out[out.length - 1];
		if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
		else out.push({ from: s.from, to: s.to });
	}
	return out;
}

/** Whether [from, to) touches any of the spans (sorted, not overlapping — see mergeSpans). */
export function overlapsAny(spans: readonly Span[], from: number, to: number): boolean {
	let lo = 0;
	let hi = spans.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const s = spans[mid];
		if (s.to <= from) lo = mid + 1;
		else if (s.from >= to) hi = mid - 1;
		else return true;
	}
	return false;
}
