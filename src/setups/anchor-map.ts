// Pure — no Obsidian imports.

/** A note's place in the book (its chapter), or null when it is not in the book. */
export type PlaceRank = (path: string) => number | null;

export interface AnchorPlace {
	path: string;
	/** 0-based line of the paragraph end that carries the tag. */
	line: number;
}

/**
 * Where every Plotverk tag (`^pv-…`) is right now: tag → the notes holding it.
 * Fed from Obsidian's metadata cache, one note at a time, so a rename, a folder
 * move, a move made while Obsidian was closed, or a paragraph cut into another
 * scene is simply picked up the next time that note is indexed.
 *
 * A tag found in two notes (a paragraph copied by hand outside Plotverk) keeps
 * both places; `placeOf` picks one steadily (the hint or the copy in the book
 * order first, then the alphabetically first path) so the same mark never
 * jumps around. Writers' own block ids are kept too: a mark may reuse one.
 */
export class AnchorMap {
	private byAnchor = new Map<string, Map<string, number>>();
	private byPath = new Map<string, string[]>();

	/** Replace what one note holds. `found` = its Plotverk tags with their lines. */
	setNote(path: string, found: ReadonlyArray<{ id: string; line: number }>): void {
		this.removeNote(path);
		if (found.length === 0) return;
		const ids: string[] = [];
		for (const { id, line } of found) {
			let places = this.byAnchor.get(id);
			if (!places) {
				places = new Map();
				this.byAnchor.set(id, places);
			}
			places.set(path, line);
			ids.push(id);
		}
		this.byPath.set(path, ids);
	}

	removeNote(path: string): void {
		const ids = this.byPath.get(path);
		if (!ids) return;
		for (const id of ids) {
			const places = this.byAnchor.get(id);
			places?.delete(path);
			if (places && places.size === 0) this.byAnchor.delete(id);
		}
		this.byPath.delete(path);
	}

	renameNote(oldPath: string, newPath: string): void {
		const ids = this.byPath.get(oldPath);
		if (!ids) return;
		this.byPath.delete(oldPath);
		this.byPath.set(newPath, ids);
		for (const id of ids) {
			const places = this.byAnchor.get(id);
			if (!places) continue;
			const line = places.get(oldPath);
			places.delete(oldPath);
			if (line !== undefined) places.set(newPath, line);
		}
	}

	clear(): void {
		this.byAnchor.clear();
		this.byPath.clear();
	}

	/** Every place a tag is found, sorted by path. */
	placesOf(id: string): AnchorPlace[] {
		const places = this.byAnchor.get(id);
		if (!places) return [];
		return [...places].map(([path, line]) => ({ path, line })).sort((a, b) => a.path.localeCompare(b.path));
	}

	/**
	 * The one place a mark points at, or null when the paragraph is gone.
	 * With copies in several notes: the hinted note, else (given a `rank`, the
	 * chapter of a note) a note in the book order, earliest chapter first, else
	 * the alphabetically first path.
	 */
	placeOf(id: string, prefer?: string | PlaceRank): AnchorPlace | null {
		const all = this.placesOf(id);
		if (all.length <= 1 || prefer === undefined) return all[0] ?? null;
		if (typeof prefer === 'string') return all.find((p) => p.path === prefer) ?? all[0];
		let best: { place: AnchorPlace; rank: number } | null = null;
		for (const place of all) {
			const rank = prefer(place.path);
			if (rank !== null && (!best || rank < best.rank)) best = { place, rank };
		}
		return best?.place ?? all[0];
	}

	/** Is `id` used anywhere (so a new tag never repeats one)? */
	has(id: string): boolean {
		return this.byAnchor.has(id);
	}
}
