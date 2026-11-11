/**
 * Whether closing the sheet editor would throw work away. Pure, so the rule
 * is testable without a modal: the editor snapshots the form when it first
 * shows it, and asks before closing when anything differs from that snapshot.
 */

export interface SheetFormSnapshotInput {
	name: string;
	aliases: string[];
	fields: Array<{ label: string; type: string; value: string; category?: string }>;
	/** Relationship rows with a person picked but not yet added. */
	pendingRelations: Array<{ name: string; word: string; picked: boolean }>;
}

/** Everything the writer can change in the form, as one comparable string. */
export function sheetFormState(input: SheetFormSnapshotInput): string {
	return JSON.stringify({
		name: input.name,
		aliases: input.aliases,
		fields: input.fields.map((f) => [f.label, f.type, f.value, f.category ?? '']),
		pending: input.pendingRelations.map((p) => [p.name, p.word, p.picked]),
	});
}

export interface SheetWorkState {
	/** The writer typed or changed something in the form. */
	touched: boolean;
	/** Pictures imported while the editor was open. */
	uploadedCount: number;
	/** The form now, from `sheetFormState`. */
	stateNow: string;
	/** The form when it was first shown; null when the form has not been shown yet. */
	stateAtOpen: string | null;
}

/** True when closing now would lose something the writer did. */
export function hasUnsavedSheetWork(s: SheetWorkState): boolean {
	if (s.uploadedCount > 0) return true;
	if (s.stateAtOpen === null) return false;
	return s.touched || s.stateNow !== s.stateAtOpen;
}
