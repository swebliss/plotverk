import type StorygridPlugin from '../main';
import type { AliasOwner } from './alias-list';

function aliasesFrom(raw: unknown): string[] {
	const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
	return list.filter((a): a is string => typeof a === 'string').map((a) => a.trim()).filter(Boolean);
}

/**
 * Every Codex entry in the same book (or series) as the sheet, with its name
 * and aliases — what a new alias is checked against. `sheetPath` null = a new
 * sheet, placed by `projectRoot`. A book sees its series' entries and a series
 * sees its books'; a sheet outside every project sees the whole vault.
 */
export function aliasOwnersFor(plugin: StorygridPlugin, sheetPath: string | null, projectRoot?: string): AliasOwner[] {
	const index = plugin.entityIndex;
	if (!index) return [];
	const root = sheetPath ? (index.rootFor(sheetPath) ?? '') : (projectRoot ?? '');
	const related = (r: string) => root === '' || r === root
		|| r.startsWith(`${root}/`) || (r !== '' && root.startsWith(`${r}/`));
	const out: AliasOwner[] = [];
	for (const e of index.getAllEntities()) {
		if (!related(index.rootFor(e.file.path) ?? '')) continue;
		const fm = plugin.app.metadataCache.getFileCache(e.file)?.frontmatter;
		out.push({ path: e.file.path, name: e.name, aliases: aliasesFrom(fm?.aliases) });
	}
	return out;
}
