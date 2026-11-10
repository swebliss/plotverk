// Obsidian-coupled glue layer — thin adapter over the pure refs/ core.
// Builds and maintains two indexes:
//   1. MatchableEntity[] — entity names+aliases for the @ suggestor and on-demand scanner.
//   2. Bidirectional mention index — which notes link to which entities (via resolved wikilinks).
//
// Rule: nothing in src/refs/ imports Obsidian. This file is the boundary.

import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import type { MatchableEntity } from './references';
import type { EntityIndex } from '../entities/entity-index-store';
import { scopeToBook } from './project-scope';

export class ReferenceIndex {
    /** Entity file path → stable storygrid-id */
    private pathToId = new Map<string, string>();
    /** entityId → MatchableEntity (name + aliases), kept current for scanner / @ suggestor */
    private matchable = new Map<string, MatchableEntity>();
    /** notePath → Set of entityIds that note wikilinks to */
    private sceneMentions = new Map<string, Set<string>>();
    /** entityId → Set of notePaths that wikilink to this entity */
    private entityScenes = new Map<string, Set<string>>();

    constructor(
        private readonly app: App,
        private readonly entityIndex: EntityIndex,
    ) {}

    // ─── Public query API ────────────────────────────────────────────────────────

    /** Which entity IDs are wikilinked from a given note. */
    getSceneMentions(notePath: string): string[] {
        return [...(this.sceneMentions.get(notePath) ?? [])];
    }

    /** Which notes wikilink to a given entity ID. */
    getEntityScenes(entityId: string): string[] {
        return [...(this.entityScenes.get(entityId) ?? [])];
    }

    /** Return the entityId for a vault path, or null if not a known Codex entity. */
    getEntityIdForPath(path: string): string | null {
        return this.pathToId.get(path) ?? null;
    }

    /**
     * All currently indexed entities as MatchableEntity records.
     * Feed this to `findMentions()` for on-demand scanning or the @ EditorSuggest.
     * Only entities that have been stamped with a stable storygrid-id are included;
     * unstamped legacy files are skipped (stampMissingEntityIds in main.ts fills them in).
     */
    buildMatchableEntities(): MatchableEntity[] {
        return [...this.matchable.values()];
    }

    /**
     * The entities a note may mention: the ones in its own book or series (the
     * same rule the @ picker uses). A note outside every project gets them all,
     * exactly like buildMatchableEntities().
     */
    buildMatchableEntitiesFor(notePath: string): MatchableEntity[] {
        // Scope first, drop unstamped sheets after, so a sheet without an id yet still finds its own book.
        const scoped = scopeToBook(
            this.entityIndex.getAllEntities(),
            notePath,
            (e) => ({ path: e.file.path, kind: e.kind }),
        );
        const out: MatchableEntity[] = [];
        for (const e of scoped) {
            const m = e.entityId ? this.matchable.get(e.entityId) : undefined;
            if (m) out.push(m);
        }
        return out;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────────

    /**
     * Full rebuild. Must be called AFTER entityIndex.rebuild() so the entity
     * set and their IDs are current. Called once at workspace-ready; also
     * re-called internally when a folder/grid rename forces full resync.
     */
    rebuild(): void {
        this.pathToId.clear();
        this.matchable.clear();
        this.sceneMentions.clear();
        this.entityScenes.clear();

        // Build entity side from the live entity index
        for (const entity of this.entityIndex.getAllEntities()) {
            if (!entity.entityId) continue;
            this.pathToId.set(entity.file.path, entity.entityId);
            this.matchable.set(
                entity.entityId,
                this.makeMatchable(entity.file, entity.entityId, entity.name),
            );
        }

        // Build mention side from Obsidian's already-resolved link graph
        const resolved = this.app.metadataCache.resolvedLinks;
        for (const [sourcePath, targets] of Object.entries(resolved)) {
            for (const targetPath of Object.keys(targets)) {
                const entityId = this.pathToId.get(targetPath);
                if (entityId) this.addLink(sourcePath, entityId);
            }
        }
    }

    // ─── Incremental handlers (call AFTER the matching entityIndex handler) ───────

    /**
     * File content or frontmatter changed. Refreshes:
     *   - The entity's matchable record if this is a known entity file (aliases may change).
     *   - The newly-stamped entity if storygrid-id just appeared in frontmatter.
     *   - Outgoing links for this file (prose wikilinks may have changed).
     */
    handleChange(file: TFile): void {
        if (file.extension !== 'md') return;

        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        const stampedId =
            typeof fm?.['storygrid-id'] === 'string' && fm['storygrid-id']
                ? fm['storygrid-id']
                : null;

        const existingId = this.pathToId.get(file.path);

        if (stampedId) {
            if (existingId && existingId !== stampedId) {
                // ID changed — shouldn't happen in practice (IDs are stable), but be safe
                this.matchable.delete(existingId);
                this.entityScenes.delete(existingId);
            }
            this.pathToId.set(file.path, stampedId);
            this.matchable.set(stampedId, this.makeMatchable(file, stampedId, file.basename));
        } else if (existingId) {
            // Was an entity, storygrid-id removed or file no longer an entity
            this.pathToId.delete(file.path);
            this.matchable.delete(existingId);
            this.entityScenes.delete(existingId);
            for (const mentions of this.sceneMentions.values()) mentions.delete(existingId);
        }

        // Prose links in this file may have changed regardless of entity status
        this.refreshLinks(file.path);
    }

    /** File renamed. Syncs path keys; triggers full rebuild on folder/grid renames. */
    handleRename(file: TAbstractFile, oldPath: string): void {
        if (file instanceof TFolder || this.isGrid(file.path) || this.isGrid(oldPath)) {
            // entityIndex triggered a full rebuild; sync our state
            this.rebuild();
            return;
        }
        if (!(file instanceof TFile)) return;

        // Entity file renamed: update pathToId, matchable notePath, and primary name
        const entityId = this.pathToId.get(oldPath);
        if (entityId) {
            this.pathToId.delete(oldPath);
            this.pathToId.set(file.path, entityId);
            const existing = this.matchable.get(entityId);
            if (existing) {
                // Replace primary name with new basename; keep aliases unchanged
                const aliases = existing.names.slice(1);
                this.matchable.set(entityId, {
                    ...existing,
                    notePath: file.path,
                    names: [file.basename, ...aliases],
                });
            }
        }

        // Source-file side: move scene-mentions entry to new path
        const mentions = this.sceneMentions.get(oldPath);
        if (mentions) {
            this.sceneMentions.delete(oldPath);
            this.sceneMentions.set(file.path, mentions);
            for (const eid of mentions) {
                const scenes = this.entityScenes.get(eid);
                if (scenes) {
                    scenes.delete(oldPath);
                    scenes.add(file.path);
                }
            }
        }

        // Obsidian updates resolvedLinks keys on rename; re-read outgoing links under new path
        this.refreshLinks(file.path);
    }

    /** File deleted. Cleans up both the entity side and the scene-mentions side. */
    handleDelete(file: TAbstractFile): void {
        if (file instanceof TFolder || this.isGrid(file.path)) {
            this.rebuild();
            return;
        }
        if (!(file instanceof TFile)) return;

        const entityId = this.pathToId.get(file.path);
        if (entityId) {
            this.pathToId.delete(file.path);
            this.matchable.delete(entityId);
            this.entityScenes.delete(entityId);
            for (const mentions of this.sceneMentions.values()) mentions.delete(entityId);
            return;
        }
        // Ordinary file deleted: remove its outgoing link entries
        this.removeLinks(file.path);
    }

    // ─── Internals ────────────────────────────────────────────────────────────────

    private makeMatchable(file: TFile, entityId: string, name: string): MatchableEntity {
        return {
            entityId,
            names: [name, ...this.readAliases(file)],
            notePath: file.path,
        };
    }

    /** Read `aliases` frontmatter as a string array (handles string | string[] | absent). */
    private readAliases(file: TFile): string[] {
        const raw: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.['aliases'];
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.filter((a): a is string => typeof a === 'string');
        if (typeof raw === 'string') return [raw];
        return [];
    }

    private addLink(sourcePath: string, entityId: string): void {
        let s = this.sceneMentions.get(sourcePath);
        if (!s) {
            s = new Set();
            this.sceneMentions.set(sourcePath, s);
        }
        s.add(entityId);

        let e = this.entityScenes.get(entityId);
        if (!e) {
            e = new Set();
            this.entityScenes.set(entityId, e);
        }
        e.add(sourcePath);
    }

    private removeLinks(sourcePath: string): void {
        const mentions = this.sceneMentions.get(sourcePath);
        if (!mentions) return;
        for (const entityId of mentions) this.entityScenes.get(entityId)?.delete(sourcePath);
        this.sceneMentions.delete(sourcePath);
    }

    private refreshLinks(sourcePath: string): void {
        this.removeLinks(sourcePath);
        const targets = this.app.metadataCache.resolvedLinks[sourcePath] ?? {};
        for (const targetPath of Object.keys(targets)) {
            const entityId = this.pathToId.get(targetPath);
            if (entityId) this.addLink(sourcePath, entityId);
        }
    }

    private isGrid(path: string): boolean {
        return path.endsWith('.storygrid');
    }
}
