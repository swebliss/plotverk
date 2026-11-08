// PUBLIC RELEASE stand-in for the Pro prose checks.
// The real engines run on Plotverk's server (later) and are not part of this
// repository. Every function here keeps the same shape and finds nothing, so
// the free Coach works exactly as before. canUse('prose-coach') is false in
// the public build, so none of this is even called.
import { ProseFinding } from '../types';
import { PaceCounts } from './pace';

export type ProseLanguage = 'en' | 'es' | 'fr' | 'other';

export interface ProFlags {
	wordy: boolean;
	crutch: boolean;
	names: boolean;
	rhythm: boolean;
	dialogue: boolean;
}

// Same defaults as the real one (on unless switched off), so saved switches read the same.
export function resolveProFlags(s?: { wordy?: boolean; crutch?: boolean; names?: boolean; rhythm?: boolean; dialogue?: boolean }): ProFlags {
	return {
		wordy: s?.wordy !== false,
		crutch: s?.crutch !== false,
		names: s?.names !== false,
		rhythm: s?.rhythm !== false,
		dialogue: s?.dialogue !== false,
	};
}

export function anyProFlag(f: ProFlags): boolean {
	return f.wordy || f.crutch || f.names || f.rhythm || f.dialogue;
}

export interface ProScanOptions {
	ignore?: ReadonlySet<string>;
	neverPhrases?: ReadonlySet<string>;
	dismissed?: ReadonlySet<string>;
	names?: readonly string[];
}

export interface ProCounts {
	wordy: number;
	crutch: number;
	names: number;
	rhythm: number;
}

export interface ProScanResult {
	findings: ProseFinding[];
	counts: ProCounts;
	language: ProseLanguage;
	claimed: string[];
	phraseSpans: Array<{ from: number; to: number }>;
	pace: PaceCounts | null;
}

export function proTotal(c: ProCounts): number {
	return c.wordy + c.crutch + c.names + c.rhythm;
}

export function scanPro(_text: string, _flags: ProFlags, _opts: ProScanOptions = {}): ProScanResult {
	return {
		findings: [],
		counts: { wordy: 0, crutch: 0, names: 0, rhythm: 0 },
		language: 'other',
		claimed: [],
		phraseSpans: [],
		pace: null,
	};
}
