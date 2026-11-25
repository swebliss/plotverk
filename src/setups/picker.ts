// Pure — no Obsidian imports.
import { SetupState, isOpenState } from './setup-marks';

export interface PickableSetup {
	path: string;
	name: string;
	state: SetupState;
	linkedIds: readonly string[];
	/** One faint line under the name (its description), may be empty. */
	description: string;
	later: boolean;
	/** Where it stands in the book ("Planted in Chapter 3 · open for 9 chapters"), may be empty. */
	where?: string;
}

export interface PickRow<T extends PickableSetup = PickableSetup> {
	setup: T;
	/** Name of a linked entry that is in the current scene — the reason it comes first. */
	inSceneName: string | null;
}

/**
 * The Remind / Pay off list: only setups still open, narrowed by what the
 * writer typed (any part of the name, any case). A setup linked to someone or
 * something already in this scene comes first, with the reason shown in grey
 * ("Kael is in this scene") — a suggestion, never a decision. The rest keep
 * alphabetical order so the list never jumps around between visits.
 */
export function pickRows<T extends PickableSetup>(
	setups: readonly T[],
	query: string,
	inScene: ReadonlyMap<string, string>,
): PickRow<T>[] {
	const q = query.trim().toLocaleLowerCase();
	const rows = setups
		.filter((s) => isOpenState(s.state))
		.filter((s) => !q || s.name.toLocaleLowerCase().includes(q))
		.map((setup) => {
			const hit = setup.linkedIds.find((id) => inScene.has(id));
			return { setup, inSceneName: hit ? inScene.get(hit) ?? null : null };
		});
	return rows.sort((a, b) => {
		if (!!a.inSceneName !== !!b.inSceneName) return a.inSceneName ? -1 : 1;
		return a.setup.name.localeCompare(b.setup.name);
	});
}

/** `[[Target]]`, `[[Target|shown]]`, `[[Target#heading]]` → link targets, in order, no doubles. */
export function wikilinkTargets(text: string): string[] {
	const out: string[] = [];
	const re = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const target = m[1].trim();
		if (target && !out.includes(target)) out.push(target);
	}
	return out;
}

/**
 * The name a selected sentence starts with in the plant window: the sentence
 * itself as plain text (links shown as their words, tags and markdown marks
 * dropped), on one line, kept to a sensible length. Always editable.
 */
export function nameFromSelection(text: string, max = 120): string {
	const plain = text
		.replace(/\^[A-Za-z0-9-]+\s*$/gm, '')
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
		.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => inner.split('#')[0].split('/').pop() ?? inner)
		.replace(/[*_~=`]+/g, '')
		.replace(/^[\s>#-]+/gm, '')
		.replace(/\s+/g, ' ')
		.trim();
	return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain;
}

/**
 * Drafts kept when the writer presses Esc or ×: choosing the same action on
 * the same words again brings back exactly what she typed. Keyed by note and
 * selected words, so a different sentence starts fresh.
 */
export class DraftStore<T> {
	private drafts = new Map<string, T>();
	private static readonly MAX = 30;

	static key(kind: string, place: string, words: string): string {
		return `${kind}\u0000${place}\u0000${words}`;
	}

	get(key: string): T | undefined {
		return this.drafts.get(key);
	}

	set(key: string, draft: T): void {
		this.drafts.delete(key);
		this.drafts.set(key, draft);
		// Only the latest few: a long session must not keep every closed window.
		while (this.drafts.size > DraftStore.MAX) {
			const oldest = this.drafts.keys().next().value;
			if (oldest === undefined) break;
			this.drafts.delete(oldest);
		}
	}

	delete(key: string): void {
		this.drafts.delete(key);
	}
}

/**
 * Where the marked words are now: the writer may have typed above them while
 * the window was open. Finds `words` nearest to where they were; null when
 * they are no longer there (changed or deleted) — then nothing is marked,
 * since whatever paragraph sits at the old offset now is not the one chosen.
 */
export function relocate(doc: string, words: string, oldFrom: number): number | null {
	if (!words) return Math.max(0, Math.min(oldFrom, doc.length));
	let best = -1;
	let bestDist = Infinity;
	let at = doc.indexOf(words);
	while (at !== -1) {
		const dist = Math.abs(at - oldFrom);
		if (dist < bestDist) {
			best = at;
			bestDist = dist;
		}
		at = doc.indexOf(words, at + 1);
	}
	return best !== -1 ? best : null;
}
