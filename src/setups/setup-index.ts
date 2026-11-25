import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { AnchorMap, AnchorPlace, PlaceRank } from './anchor-map';

/**
 * Live index of where every setup tag sits, fed from Obsidian's metadata cache
 * (`blocks`), so finding a marked sentence never reads a file. Built lazily on
 * first use and patched from the vault events main.ts already listens to.
 * Block ids are matched without regard to case, as Obsidian's block links are.
 */
export class SetupIndex {
	readonly anchors = new AnchorMap();
	private built = false;

	constructor(private app: App, private skip: (path: string) => boolean = () => false) {}

	/** Index every note now (the cache may still be filling; `changed` events fill in the rest). */
	rebuild(): void {
		this.anchors.clear();
		for (const file of this.app.vault.getMarkdownFiles()) this.indexFile(file);
		this.built = true;
	}

	private ensureBuilt(): void {
		if (!this.built) this.rebuild();
	}

	private indexFile(file: TFile): void {
		if (file.extension !== 'md' || this.skip(file.path)) return;
		const blocks = this.app.metadataCache.getFileCache(file)?.blocks;
		const found: Array<{ id: string; line: number }> = [];
		if (blocks) {
			// Every block id, not only Plotverk's: marking a paragraph that already
			// ends in the writer's own `^my-id` reuses that id as the mark's place.
			for (const block of Object.values(blocks)) found.push({ id: block.id.toLowerCase(), line: block.position.end.line });
		}
		this.anchors.setNote(file.path, found);
	}

	handleChange(file: TFile): void {
		if (!this.built) return;
		this.indexFile(file);
	}

	handleDelete(file: TAbstractFile): void {
		if (!this.built) return;
		if (file instanceof TFolder) return void this.rebuild();
		this.anchors.removeNote(file.path);
	}

	handleRename(file: TAbstractFile, oldPath: string): void {
		if (!this.built) return;
		if (file instanceof TFolder) return void this.rebuild();
		this.anchors.renameNote(oldPath, file.path);
	}

	/**
	 * Where a marked paragraph is now, or null when it is gone. `rank` (the
	 * chapter of a note, null outside the book) picks between copies.
	 */
	placeOf(anchorId: string, rank?: PlaceRank): AnchorPlace | null {
		this.ensureBuilt();
		return this.anchors.placeOf(anchorId.toLowerCase(), rank);
	}

	/** Is this tag already used anywhere in the vault? */
	isTaken(anchorId: string): boolean {
		this.ensureBuilt();
		return this.anchors.has(anchorId.toLowerCase());
	}
}
