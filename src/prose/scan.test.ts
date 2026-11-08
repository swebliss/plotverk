import { scanAll, resolveEngineFlags, dismissalKey } from './counts';
import { maskNonProse, isMetadataLine } from './mask';
import { tokenizeWords, normalizeWord, buildIgnoreSet } from './tokenize';
import { findRepetitionGroups } from './repetition';
import { findAdverbs } from './adverbs';

const ALL_ON = { adverbs: true, passive: true, repetition: true };

describe('tokenizeWords — Unicode', () => {
	test('keeps letters from any script inside one word', () => {
		expect(tokenizeWords('Sjöberg såg Åsa, Zoë och Ñoño.').map((t) => t.word)).toEqual([
			'sjöberg', 'såg', 'åsa', 'zoë', 'och', 'ñoño',
		]);
	});
	test('offsets round-trip on non-ASCII text', () => {
		const text = 'Fröken Ödla gick långsamt.';
		for (const t of tokenizeWords(text)) expect(text.slice(t.from, t.to).toLowerCase()).toBe(t.word);
	});
});

describe('normalizeWord / buildIgnoreSet', () => {
	test('possessives, curly apostrophes and case collapse to one key', () => {
		expect(normalizeWord("Ledger's")).toBe('ledger');
		expect(normalizeWord('ledger’s')).toBe('ledger');
		expect(normalizeWord('LEDGER')).toBe('ledger');
	});
	test('every word of every name and alias, plus the never list', () => {
		const set = buildIgnoreSet(['Mara Ferrow', 'Grandmother Tull', 'Nan'], ['Suddenly']);
		for (const w of ['mara', 'ferrow', 'grandmother', 'tull', 'nan', 'suddenly']) expect(set.has(w)).toBe(true);
	});
});

describe('maskNonProse', () => {
	test('keeps the same length and every line break', () => {
		const text = '---\nstatus: idea\n---\n# Title\nShe ran.\n`code` [[Target|Alias]] %%note%%\n';
		const masked = maskNonProse(text);
		expect(masked.length).toBe(text.length);
		expect(masked.split('\n').length).toBe(text.split('\n').length);
	});
	test('blanks frontmatter, headings, code, comments; keeps prose and a wikilink alias', () => {
		const text = [
			'---', 'location: harbour', 'status: idea', '---',
			'## The harbour scene',
			'She walked to the harbour.',
			'```', 'harbour harbour harbour', '```',
			'He saw [[Old Harbour|the harbour]] and `harbour`. %%harbour%%',
		].join('\n');
		const masked = maskNonProse(text);
		expect(masked).not.toMatch(/location|status|idea|scene|Old/);
		expect(masked).toContain('She walked to the harbour.');
		expect(masked).toContain('the harbour');
		// prose "harbour" ×2 (line 6 + alias) — the hidden ones are gone.
		expect((masked.match(/harbour/g) ?? []).length).toBe(2);
	});
	test('a wikilink without alias is blanked whole', () => {
		expect(maskNonProse('Ask [[Mara Ferrow]] now.').replace(/ +/g, ' ')).toBe('Ask now.');
	});
	test('CRLF frontmatter is recognised', () => {
		const masked = maskNonProse('---\r\nstatus: idea\r\n---\r\nText.');
		expect(masked).not.toContain('idea');
		expect(masked).toContain('Text.');
	});
	test('an unclosed fence runs to the end', () => {
		expect(maskNonProse('Prose.\n```\ncode words').trim()).toBe('Prose.');
	});
});

describe('isMetadataLine', () => {
	test('matches the Plotverk scene line in its real shapes', () => {
		expect(isMetadataLine('*POV: [[Mara Ferrow]] · Location: [[The Tidehouse]] · Status: written*')).toBe(true);
		expect(isMetadataLine('POV: Mara · Status: idea')).toBe(true);
		expect(isMetadataLine('Location: harbour · Status: idea')).toBe(true);
		expect(isMetadataLine('**POV:** Mara')).toBe(true);
	});
	test('leaves ordinary sentences alone', () => {
		expect(isMetadataLine('Status: she had none, and she knew it.')).toBe(false);
		expect(isMetadataLine('The location was wrong.')).toBe(false);
	});
});

describe('scanAll — the old "location / status / idea ×3" echo bug', () => {
	test('three scenes of metadata lines produce no echoes', () => {
		const scene = (n: number) =>
			`## Scene ${n}\n\n*POV: [[Mara]] · Location: [[Tidehouse]] · Status: idea*\n\n${["She dove at dawn.", "Rain came early.", "Nobody spoke."][n - 1]}\n`;
		const text = `---\nstatus: idea\nlocation: Tidehouse\n---\n${scene(1)}${scene(2)}${scene(3)}`;
		const { repetitionGroups, findings } = scanAll(text, ALL_ON);
		expect(repetitionGroups.map((g) => g.word)).toEqual([]);
		expect(findings.filter((f) => /location|status|idea/i.test(f.text))).toEqual([]);
	});
});

describe('scanAll — ignore set (Codex names + aliases + never list)', () => {
	test('a Codex name repeated many times is never an echo', () => {
		const text = 'Tamsin ran. Tamsin stopped. Tamsin’s hands shook. Tamsin laughed.';
		expect(scanAll(text, ALL_ON).repetitionGroups.map((g) => g.word)).toEqual(['tamsin']);
		const ignore = buildIgnoreSet(['Tamsin Vale']);
		expect(scanAll(text, ALL_ON, { ignore }).repetitionGroups).toEqual([]);
	});
	test('a name ending in -ly is not an adverb when it is in the Codex', () => {
		expect(findAdverbs('Kimberly smiled.').map((f) => f.word)).toEqual(['kimberly']);
		expect(scanAll('Kimberly smiled.', ALL_ON, { ignore: buildIgnoreSet(['Kimberly']) }).findings).toEqual([]);
	});
	test('a "never" word is skipped for every kind', () => {
		const ignore = buildIgnoreSet([], ['slowly']);
		expect(scanAll('She walked slowly, slowly, slowly home.', ALL_ON, { ignore }).findings).toEqual([]);
	});
});

describe('scanAll — "Not here" dismissals', () => {
	test('a dismissed key hides only that kind + word', () => {
		const text = 'She walked slowly and spoke quietly.';
		const dismissed = new Set([dismissalKey('adverb', 'slowly')]);
		expect(scanAll(text, ALL_ON, { dismissed }).findings.map((f) => f.word)).toEqual(['quietly']);
	});
	test('a dismissed repetition word removes its whole group', () => {
		const text = 'The cold wind bit at her cold hands in the cold night.';
		const dismissed = new Set([dismissalKey('repetition', 'cold')]);
		const r = scanAll(text, ALL_ON, { dismissed });
		expect(r.repetitionGroups).toEqual([]);
		expect(r.counts.repetition).toBe(0);
	});
});

describe('findRepetitionGroups', () => {
	test('one group with count, window in running words, and every range', () => {
		const text = 'She opened the ledger. The ledger was older than the yard, and the ledger did not lie.';
		const [g] = findRepetitionGroups(text);
		expect(g.word).toBe('ledger');
		expect(g.count).toBe(3);
		// "ledger" is word 4; the third "ledger" is word 14 → 11 words first to last.
		expect(g.window).toBe(11);
		expect(g.ranges.map((r) => text.slice(r.from, r.to))).toEqual(['ledger', 'ledger', 'ledger']);
		expect(text.slice(g.from, g.to).startsWith('ledger')).toBe(true);
	});
	test('two clusters far apart become two groups; a lone far use is in neither', () => {
		const filler = (n: number) => Array.from({ length: n }, (_, i) => `w${'x'.repeat(i % 5)}`).join(' ');
		const text = `cold cold cold ${filler(150)} cold ${filler(150)} cold cold cold`;
		const groups = findRepetitionGroups(text);
		expect(groups.filter((g) => g.word === 'cold').map((g) => g.count)).toEqual([3, 3]);
	});
	test('the window counts every word, stopwords included', () => {
		// 3 uses spread over 120 running words: outside a 100-word window.
		const filler = Array.from({ length: 58 }, () => 'the').join(' ');
		expect(findRepetitionGroups(`cold ${filler} cold ${filler} cold`)).toEqual([]);
	});
	test('counts "ledger" and "ledger\'s" as the same word', () => {
		const groups = findRepetitionGroups("The ledger. The ledger's spine. A ledger again.");
		expect(groups.map((g) => [g.word, g.count])).toEqual([['ledger', 3]]);
	});
});

describe('passive is off by default', () => {
	test('resolveEngineFlags: adverbs + repetition on, passive off, unless saved otherwise', () => {
		expect(resolveEngineFlags(undefined)).toEqual({ adverbs: true, passive: false, repetition: true });
		expect(resolveEngineFlags({ passive: true, adverbs: false })).toEqual({ adverbs: false, passive: true, repetition: true });
	});
	test('with default flags, a passive sentence is not flagged', () => {
		const r = scanAll('The door was opened by her.', resolveEngineFlags({}));
		expect(r.counts.passive).toBe(0);
	});
});

describe('scanAll — offsets point into the original text', () => {
	test('findings slice back to their own text, after frontmatter', () => {
		const text = '---\ntitle: x\n---\nShe walked slowly. Cold, cold, cold.';
		const r = scanAll(text, ALL_ON);
		expect(r.findings.length).toBeGreaterThan(0);
		for (const f of r.findings) expect(text.slice(f.from, f.to)).toBe(f.text);
		// sorted, which RangeSetBuilder needs
		for (let i = 1; i < r.findings.length; i++) expect(r.findings[i].from).toBeGreaterThanOrEqual(r.findings[i - 1].from);
	});
});
