// Pure passive-voice detector — no Obsidian imports.
import { ProseFinding } from './types';

/** Common irregular past participles that don't end in -ed/-en. */
export const IRREGULAR_PARTICIPLES: ReadonlySet<string> = new Set([
	'taken', 'given', 'seen', 'known', 'written', 'done', 'made', 'found', 'told', 'thought', 'shown', 'left',
	'felt', 'kept', 'held', 'brought', 'bought', 'caught', 'taught', 'sent', 'built', 'spent', 'lost', 'met',
	'paid', 'said', 'read', 'heard', 'stood', 'understood', 'born', 'torn', 'worn', 'chosen', 'spoken', 'stolen',
	'broken', 'frozen', 'driven', 'eaten', 'fallen', 'forgotten', 'hidden', 'ridden', 'risen', 'shaken', 'thrown',
	'woken', 'drawn', 'grown', 'blown', 'flown', 'sworn', 'sung', 'swum', 'begun', 'run', 'come', 'become',
	'gone', 'put', 'set', 'hit', 'cut', 'hurt',
]);

/**
 * Common -ed/-en words that follow a "be" verb but are adjectives/nouns, not
 * passive participles ("the door was open", "she was seven"). Heuristic —
 * precision over recall, so a few genuine passives may slip through unflagged
 * rather than spamming false positives on ordinary sentences.
 */
const PARTICIPLE_BLOCKLIST: ReadonlySet<string> = new Set([
	'red', 'bed', 'ten', 'even', 'open', 'often', 'olden', 'wooden', 'golden', 'sudden', 'ashen', 'barren',
	'brazen', 'chicken', 'garden', 'kitchen', 'heaven', 'leaden', 'linen', 'mitten', 'oven', 'oxen', 'queen',
	'screen', 'seven', 'keen', 'green',
]);

const BE_FORMS = ['has been', 'have been', 'had been', 'will be', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'get', 'gets', 'got', 'getting'];

// Longest-first so the alternation can't stop at a shorter alternative that
// happens to be a prefix of a longer participle before a proper \b check.
const IRREGULAR_ALT = [...IRREGULAR_PARTICIPLES].sort((a, b) => b.length - a.length).join('|');
const BE_ALT = [...BE_FORMS].sort((a, b) => b.length - a.length).join('|');

const PASSIVE_RE = new RegExp(
	`\\b(${BE_ALT})\\s+(\\w+ly\\s+)?(${IRREGULAR_ALT}|[a-z]+(?:ed|en))\\b`,
	'gi'
);

/** Finds passive-voice constructions in `text`, with offsets. */
export function findPassive(text: string): ProseFinding[] {
	const findings: ProseFinding[] = [];
	PASSIVE_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = PASSIVE_RE.exec(text))) {
		const participle = m[3].toLowerCase();
		if (participle.length < 4) continue;
		if (!IRREGULAR_PARTICIPLES.has(participle) && PARTICIPLE_BLOCKLIST.has(participle)) continue;
		const matchEnd = m.index + m[0].length;
		const hasByPhrase = /^\s+by\s+\w/i.test(text.slice(matchEnd, matchEnd + 20));
		const word = m[0].toLowerCase().replace(/\s+/g, ' ');
		findings.push({ kind: 'passive', from: m.index, to: matchEnd, text: m[0], word, hasByPhrase });
	}
	return findings;
}
