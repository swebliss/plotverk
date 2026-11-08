import * as fs from 'fs';
import * as nodePath from 'path';
import { FakeVault, fakeApp } from './fake-vault';
import { listGridBackups, restoreNewestValidBackup, writeGridBackup } from '../utils/grid-backup';
import { listSceneSnapshots, writeSceneSnapshot } from '../utils/scene-snapshots';
import { syncProjectMirrors } from '../utils/project-data-store';
import { OLD_SAFETY_FOLDER_NAME, SAFETY_FOLDER_NAME, isSafetyNetPath } from '../utils/safety-paths';
import { migrateSafetyFolders } from '../utils/safety-folder';
import { DashboardSettings } from '../grid-data';

/**
 * Smoke test of the safety nets against COPIES of real vaults. Skipped unless
 * SMOKE_VAULTS_DIR names a folder whose sub-folders are vault copies — never
 * point it at a live vault: results are written back to disk for inspection.
 *
 *   SMOKE_VAULTS_DIR=<copies> npx jest vault-smoke
 */
const DIR = process.env.SMOKE_VAULTS_DIR;
const vaults = DIR ? fs.readdirSync(DIR).filter((n) => fs.statSync(nodePath.join(DIR, n)).isDirectory()) : [];

(DIR ? describe : describe.skip)('safety nets on vault copies', () => {
	it.each(vaults.length ? vaults : ['none'])('%s', async (name) => {
		const root = nodePath.join(DIR!, name);
		const v = FakeVault.fromDisk(root);
		const app = fakeApp(v);
		const before = new Map(v.files);
		// Files inside an older safety folder (Plotverk/, or other-case pvbackup/, carrying our note): the startup merge may move or trash these.
		const oldSafetyDirs = [...v.folders].filter((d) => {
			const n = d.split('/').pop()!;
			return (n === OLD_SAFETY_FOLDER_NAME || (n !== SAFETY_FOLDER_NAME && n.toLowerCase() === SAFETY_FOLDER_NAME))
				&& v.files.has(`${d}/What is this folder.md`);
		});
		const inOldSafety = (p: string) => oldSafetyDirs.some((d) => p.startsWith(`${d}/`));
		await migrateSafetyFolders(app);

		let dash = { goals: {}, todos: {}, typedWords: {} } as unknown as DashboardSettings;
		const dataJson = nodePath.join(root, '.obsidian/plugins/plotverk/data.json');
		if (fs.existsSync(dataJson)) dash = JSON.parse(fs.readFileSync(dataJson, 'utf8')).dashboard ?? dash;
		for (const k of ['goals', 'todos', 'typedWords'] as const) (dash as unknown as Record<string, object>)[k] ??= {};

		const grids = v.getFiles().filter((f) => f.extension === 'storygrid');
		const roots = [...new Set(grids.map((g) => g.path.slice(0, Math.max(0, g.path.lastIndexOf('/')))))];
		await syncProjectMirrors(app, dash, roots);

		const report: string[] = [];
		for (const g of grids) {
			const legacyBefore = (await listGridBackups(app, g.path)).filter((b) => b.legacy).length;
			await writeGridBackup(app, g.path, v.files.get(g.path)!);
			const list = await listGridBackups(app, g.path);
			expect(list.filter((b) => !b.legacy).length).toBeGreaterThanOrEqual(1);
			expect(list.filter((b) => b.legacy)).toHaveLength(legacyBefore);
			expect(await restoreNewestValidBackup(app, g.path)).not.toBeNull();
			report.push(`grid ${g.path}: 1 new + ${legacyBefore} old backups`);
		}

		const scenes = v.getMarkdownFiles().filter((f) => /(?:^|\/)Scenes\//.test(f.path));
		let snapped = 0;
		for (const s of scenes) {
			if (await writeSceneSnapshot(app, s.path, v.files.get(s.path)!, 'manual')) snapped++;
			expect((await listSceneSnapshots(app, s.path)).length).toBeGreaterThan(0);
		}
		report.push(`${snapped}/${scenes.length} scenes snapshotted`);

		// Only safety-folder paths were written; no file was hard-deleted (only emptied old folders);
		// the trash only took files from old safety folders; every other old file is byte-identical.
		expect(v.written.filter((p) => !isSafetyNetPath(p))).toEqual([]);
		expect(v.deleted.filter((p) => before.has(p))).toEqual([]);
		expect(v.trashed.filter((p) => !inOldSafety(p) && !isSafetyNetPath(p))).toEqual([]);
		for (const [p, content] of before) if (!inOldSafety(p)) expect(v.files.get(p)).toBe(content);
		// Every old-safety-folder file except the old note survived: moved into pvbackup, or trashed (recoverable) as the older copy.
		const movedTo = (p: string) => {
			const d = oldSafetyDirs.find((dir) => p.startsWith(`${dir}/`))!;
			const parent = d.includes('/') ? d.slice(0, d.lastIndexOf('/') + 1) : '';
			return `${parent}${SAFETY_FOLDER_NAME}${p.slice(d.length)}`;
		};
		for (const [p, content] of before) {
			if (!inOldSafety(p) || p.endsWith('What is this folder.md')) continue;
			const kept = v.files.has(p) || v.trashed.includes(p) || v.files.get(movedTo(p)) === content;
			expect(kept ? 'kept' : `lost: ${p}`).toBe('kept');
		}
		// No old safety folder is left holding only our own files.
		expect(oldSafetyDirs.filter((d) => v.folders.has(d) && ![...v.files.keys()].some((p) => p.startsWith(`${d}/`)))).toEqual([]);
		report.push(`merged ${oldSafetyDirs.length} old safety folder(s); ${v.trashed.length} older duplicate(s) to trash`);
		// No new grid or scene-like file appeared: projects and word counts are unchanged.
		expect(v.getFiles().filter((f) => f.extension === 'storygrid')).toHaveLength(grids.length);
		expect(v.written.filter((p) => p.endsWith('.md') && !/\/?(Book order|What is this folder)\.md$/.test(p))).toEqual([]);

		report.push(`written: ${new Set(v.written).size} files, all inside pvbackup/ safety folders`);
		v.flushTo(root);
		console.log(`${name}\n  ${report.join('\n  ')}`);
	});
});
