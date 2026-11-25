import { App, TFile } from 'obsidian';
import { generateEntityId } from '../grid-data';
import type { EntityInfo } from '../entities/entity-manager';
import {
	SetupMark, SetupState, StoredMarkLine, addMark, isLetGo, marksOf, paysOffLater,
	isPlanned, readLinkedIds, readMarkLines, removeMark, removePlanMarks, setupState, writeMarkLines,
} from './setup-marks';

/**
 * Reading and writing a setup sheet's own bookkeeping. Every write goes
 * through `processFrontMatter`, which touches only the properties block, so
 * the writer's description and notes are never rewritten; and only the
 * setup keys (SETUP_FRONTMATTER_KEYS) are ever changed here.
 */

export const SETUP_KIND = 'setup';

export interface SetupInfo {
	file: TFile;
	name: string;
	entityId: string | null;
	state: SetupState;
	marks: SetupMark[];
	linkedIds: string[];
	/** Pays off in a later book (not counted in "2 of 5 paid off"). */
	later: boolean;
}

/** A setup sheet's state, straight from the metadata cache (no file read). */
export function readSetup(app: App, file: TFile, name = file.basename): SetupInfo {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	const marks = marksOf(readMarkLines(fm['storygrid-marks']));
	const letGo = isLetGo(fm['storygrid-let-go']);
	const id = typeof fm['storygrid-id'] === 'string' && fm['storygrid-id'] ? fm['storygrid-id'] : null;
	return {
		file,
		name,
		entityId: id,
		state: setupState(marks, letGo),
		marks,
		linkedIds: readLinkedIds(fm['storygrid-linked-ids']),
		later: paysOffLater(fm['storygrid-pays-off']),
	};
}

/** Every setup sheet in the project (series roots see their books' setups too). */
export function listSetups(app: App, entities: readonly EntityInfo[]): SetupInfo[] {
	return entities.filter((e) => e.kind === SETUP_KIND).map((e) => readSetup(app, e.file, e.name));
}

async function editSetupFrontmatter(app: App, file: TFile, edit: (fm: Record<string, unknown>) => void): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => edit(fm));
}

function setList(fm: Record<string, unknown>, key: string, list: unknown[]): void {
	if (list.length) fm[key] = list;
	else delete fm[key];
}

/** Add (or re-stage) a mark. Unreadable lines already there are kept as they are. */
export async function addSetupMark(app: App, file: TFile, mark: SetupMark): Promise<void> {
	await editSetupFrontmatter(app, file, (fm) => {
		const lines: StoredMarkLine[] = addMark(readMarkLines(fm['storygrid-marks']), mark);
		setList(fm, 'storygrid-marks', writeMarkLines(lines));
		// Marking a payoff or reminder IN THE TEXT brings a let-go setup back to
		// life; a plan on a card or event never moves the setup.
		if (mark.stage !== 'planted' && !isPlanned(mark)) delete fm['storygrid-let-go'];
	});
}

export async function removeSetupMark(app: App, file: TFile, mark: SetupMark): Promise<void> {
	await editSetupFrontmatter(app, file, (fm) => {
		setList(fm, 'storygrid-marks', writeMarkLines(removeMark(readMarkLines(fm['storygrid-marks']), mark)));
	});
}

/** Take a plan off a card or event (all its copies); the text is never touched. */
export async function removeSetupPlan(app: App, file: TFile, plan: SetupMark): Promise<void> {
	await editSetupFrontmatter(app, file, (fm) => {
		setList(fm, 'storygrid-marks', writeMarkLines(removePlanMarks(readMarkLines(fm['storygrid-marks']), plan)));
	});
}

export async function setLetGo(app: App, file: TFile, letGo: boolean): Promise<void> {
	await editSetupFrontmatter(app, file, (fm) => {
		if (letGo) fm['storygrid-let-go'] = true;
		else delete fm['storygrid-let-go'];
	});
}

export async function setPaysOffLater(app: App, file: TFile, later: boolean): Promise<void> {
	await editSetupFrontmatter(app, file, (fm) => {
		if (later) fm['storygrid-pays-off'] = 'later-book';
		else delete fm['storygrid-pays-off'];
	});
}

export async function addLinkedId(app: App, file: TFile, id: string): Promise<void> {
	await editSetupFrontmatter(app, file, (fm) => {
		const ids = readLinkedIds(fm['storygrid-linked-ids']);
		if (!ids.includes(id)) ids.push(id);
		setList(fm, 'storygrid-linked-ids', ids);
	});
}

export async function removeLinkedId(app: App, file: TFile, id: string): Promise<void> {
	await editSetupFrontmatter(app, file, (fm) => {
		setList(fm, 'storygrid-linked-ids', readLinkedIds(fm['storygrid-linked-ids']).filter((x) => x !== id));
	});
}

/**
 * The Codex entry's permanent id, stamping one first if the sheet has none
 * yet (sheets made outside Plotverk get theirs at startup, but a link made
 * before then must not wait).
 */
export async function ensureEntityId(app: App, file: TFile): Promise<string> {
	const existing: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.['storygrid-id'];
	if (typeof existing === 'string' && existing) return existing;
	let id = '';
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		const now = fm['storygrid-id'];
		if (typeof now === 'string' && now) id = now;
		else {
			id = generateEntityId();
			fm['storygrid-id'] = id;
		}
	});
	return id;
}

/** The Codex entry with this permanent id, if it still exists. */
export function entityById(entities: readonly EntityInfo[], id: string): EntityInfo | null {
	return entities.find((e) => e.entityId === id) ?? null;
}

/** A freshly planted setup: its first mark, linked entries and book in one write. */
export async function initSetup(
	app: App,
	file: TFile,
	init: { mark: SetupMark | null; linkedIds: readonly string[]; later: boolean },
): Promise<void> {
	if (!init.mark && init.linkedIds.length === 0 && !init.later) return;
	await editSetupFrontmatter(app, file, (fm) => {
		if (init.mark) setList(fm, 'storygrid-marks', writeMarkLines(addMark(readMarkLines(fm['storygrid-marks']), init.mark)));
		if (init.linkedIds.length) setList(fm, 'storygrid-linked-ids', [...new Set(init.linkedIds)]);
		if (init.later) fm['storygrid-pays-off'] = 'later-book';
	});
}

/** The setup's one-line description, from the sheet's properties (no file read). */
export function setupDescription(app: App, file: TFile): string {
	const value: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.['description'];
	return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}
