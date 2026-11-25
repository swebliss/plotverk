import { aliasRename, applySwaps, rewriteAliasLinks, replayAliasEdits, AliasEdit } from './alias-follow';

const isGibbins = (linkpath: string) => /(^|\/)mr gibbins(\.md)?$/i.test(linkpath.trim());

// ── aliasRename ───────────────────────────────────────────────────────────────

describe('aliasRename — only a clear rename counts', () => {
	test('one alias changed in place', () => {
		expect(aliasRename(['Dad', 'Andreas'], ['Papa', 'Andreas'])).toEqual({ from: 'Dad', to: 'Papa' });
	});
	test('one removed and one added (order changed too)', () => {
		expect(aliasRename(['Dad', 'Andreas'], ['Andreas', 'Papa'])).toEqual({ from: 'Dad', to: 'Papa' });
	});
	test('only the letter case changed', () => {
		expect(aliasRename(['dad'], ['Dad'])).toEqual({ from: 'dad', to: 'Dad' });
	});
	test('only added → nothing', () => {
		expect(aliasRename(['Dad'], ['Dad', 'Papa'])).toBeNull();
	});
	test('only removed → nothing', () => {
		expect(aliasRename(['Dad', 'Papa'], ['Papa'])).toBeNull();
	});
	test('reordered → nothing', () => {
		expect(aliasRename(['Dad', 'Papa'], ['Papa', 'Dad'])).toBeNull();
	});
	test('several changed → nothing', () => {
		expect(aliasRename(['Dad', 'Andreas'], ['Papa', 'Andy'])).toBeNull();
	});
	test('blank and repeated entries are ignored', () => {
		expect(aliasRename(['Dad', ' ', 'Dad'], ['Papa', ''])).toEqual({ from: 'Dad', to: 'Papa' });
	});
	test('no aliases before or after → nothing', () => {
		expect(aliasRename([], [])).toBeNull();
	});
});

// ── rewriteAliasLinks ────────────────────────────────────────────────────────

describe('rewriteAliasLinks — what changes', () => {
	test('a link showing the old alias gets the new one', () => {
		const r = rewriteAliasLinks('Then [[Mr Gibbins|Dad]] smiled.', isGibbins, 'Dad', 'Papa');
		expect(r.text).toBe('Then [[Mr Gibbins|Papa]] smiled.');
		expect(r.edits).toHaveLength(1);
	});
	test('every matching link in the text', () => {
		const r = rewriteAliasLinks('[[Mr Gibbins|Dad]] and [[Mr Gibbins|Dad]].', isGibbins, 'Dad', 'Papa');
		expect(r.text).toBe('[[Mr Gibbins|Papa]] and [[Mr Gibbins|Papa]].');
		expect(r.edits).toHaveLength(2);
	});
	test('a path link and a heading link count too', () => {
		const r = rewriteAliasLinks('[[Codex/Characters/Mr Gibbins|Dad]] [[Mr Gibbins#Youth|Dad]]', isGibbins, 'Dad', 'Papa');
		expect(r.text).toBe('[[Codex/Characters/Mr Gibbins|Papa]] [[Mr Gibbins#Youth|Papa]]');
	});
	test('matching ignores letter case; a lowercase start stays lowercase', () => {
		const r = rewriteAliasLinks('"Hi [[Mr Gibbins|dad]]", said [[Mr Gibbins|Dad]].', isGibbins, 'Dad', 'Papa');
		expect(r.text).toBe('"Hi [[Mr Gibbins|papa]]", said [[Mr Gibbins|Papa]].');
	});
	test('the swaps say exactly where each word changed', () => {
		const text = 'Then [[Mr Gibbins|Dad]] smiled.';
		const r = rewriteAliasLinks(text, isGibbins, 'Dad', 'Papa');
		expect(r.changes).toEqual([{ start: 18, end: 21, word: 'Papa' }]);
		expect(applySwaps(text, r.changes)).toBe(r.text);
	});
	test('the escaped pipe inside a table is kept', () => {
		const r = rewriteAliasLinks('| [[Mr Gibbins\\|Dad]] |', isGibbins, 'Dad', 'Papa');
		expect(r.text).toBe('| [[Mr Gibbins\\|Papa]] |');
	});
});

describe('rewriteAliasLinks — what never changes', () => {
	test('plain unlinked words', () => {
		const r = rewriteAliasLinks('Dad came home. [[Mr Gibbins|Dad]]', isGibbins, 'Dad', 'Papa');
		expect(r.text).toBe('Dad came home. [[Mr Gibbins|Papa]]');
	});
	test('a link to another sheet with the same word', () => {
		const r = rewriteAliasLinks('[[Mr Hobbs|Dad]]', isGibbins, 'Dad', 'Papa');
		expect(r.text).toBe('[[Mr Hobbs|Dad]]');
		expect(r.edits).toHaveLength(0);
	});
	test('a bare link (the name follows renames by itself)', () => {
		expect(rewriteAliasLinks('[[Mr Gibbins]]', isGibbins, 'Mr Gibbins', 'X').text).toBe('[[Mr Gibbins]]');
	});
	test('a link showing another word', () => {
		expect(rewriteAliasLinks('[[Mr Gibbins|Daddy]]', isGibbins, 'Dad', 'Papa').text).toBe('[[Mr Gibbins|Daddy]]');
	});
	test('embeds', () => {
		expect(rewriteAliasLinks('![[Mr Gibbins|Dad]]', isGibbins, 'Dad', 'Papa').text).toBe('![[Mr Gibbins|Dad]]');
	});
	test('frontmatter, fenced code and inline code', () => {
		const text = '---\nwho: "[[Mr Gibbins|Dad]]"\n---\n```\n[[Mr Gibbins|Dad]]\n```\n`[[Mr Gibbins|Dad]]` [[Mr Gibbins|Dad]]';
		const r = rewriteAliasLinks(text, isGibbins, 'Dad', 'Papa');
		expect(r.text).toBe(text.replace(/\|Dad\]\]$/, '|Papa]]'));
		expect(r.edits).toHaveLength(1);
	});
	test('code that the simple rules missed: indented, unclosed and longer-closed fences, double backticks, comments', () => {
		const cases = [
			'- item\n  ```\n  [[Mr Gibbins|Dad]]\n  ```\n',
			'```\n[[Mr Gibbins|Dad]]\nno closing fence',
			'````\n[[Mr Gibbins|Dad]]\n`````\n',
			'> ```\n> [[Mr Gibbins|Dad]]\n> ```\n',
			'Some `` code [[Mr Gibbins|Dad]] `` here',
			'%% note to self [[Mr Gibbins|Dad]] %%',
			'%%\n[[Mr Gibbins|Dad]]\n%%',
		];
		for (const text of cases) expect(rewriteAliasLinks(text, isGibbins, 'Dad', 'Papa').text).toBe(text);
	});
	test('a short fence inside a longer one does not end it', () => {
		const text = '````\n```\n[[Mr Gibbins|Dad]]\n````\n[[Mr Gibbins|Dad]]';
		expect(rewriteAliasLinks(text, isGibbins, 'Dad', 'Papa').text).toBe(text.replace(/Dad\]\]$/, 'Papa]]'));
	});
	test('frontmatter behind an invisible byte-order mark is still skipped', () => {
		const text = '﻿---\nfather: "[[Mr Gibbins|Dad]]"\n---\nBody';
		expect(rewriteAliasLinks(text, isGibbins, 'Dad', 'Papa').edits).toHaveLength(0);
	});
	test('a single backtick pair still counts as code; a lone backtick does not hide the rest', () => {
		expect(rewriteAliasLinks('`[[Mr Gibbins|Dad]]`', isGibbins, 'Dad', 'Papa').edits).toHaveLength(0);
		expect(rewriteAliasLinks('It is 5` tall. [[Mr Gibbins|Dad]]', isGibbins, 'Dad', 'Papa').edits).toHaveLength(1);
	});
	test('nothing to change → same text, no edits', () => {
		const r = rewriteAliasLinks('Nothing here.', isGibbins, 'Dad', 'Papa');
		expect(r.text).toBe('Nothing here.');
		expect(r.edits).toEqual([]);
	});
	test('a blank old or new word changes nothing', () => {
		expect(rewriteAliasLinks('[[Mr Gibbins|Dad]]', isGibbins, 'Dad', '  ').edits).toHaveLength(0);
		expect(rewriteAliasLinks('[[Mr Gibbins|Dad]]', isGibbins, '', 'Papa').edits).toHaveLength(0);
	});
});

// ── replayAliasEdits (Undo / Redo) ───────────────────────────────────────────

describe('replayAliasEdits — undo and redo', () => {
	const original = 'Dad came in.\n"Hi [[Mr Gibbins|dad]]," I said. [[Mr Gibbins|Dad]] nodded, and [[Mr Gibbins|Dad]] sat.\n';

	test('apply → undo → redo is byte-exact when nothing else changed', () => {
		const applied = rewriteAliasLinks(original, isGibbins, 'Dad', 'Papa');
		const undone = replayAliasEdits(applied.text, isGibbins, applied.edits, 'undo');
		expect(undone.text).toBe(original);
		expect(undone.done).toBe(3);
		expect(undone.left).toBe(0);
		const redone = replayAliasEdits(undone.text, isGibbins, applied.edits, 'redo');
		expect(redone.text).toBe(applied.text);
		expect(redone.done).toBe(3);
	});

	test('two changed links side by side still find each other', () => {
		const text = '[[Mr Gibbins|Dad]][[Mr Gibbins|Dad]]';
		const applied = rewriteAliasLinks(text, isGibbins, 'Dad', 'Papa');
		expect(replayAliasEdits(applied.text, isGibbins, applied.edits, 'undo').text).toBe(text);
	});

	test('writing elsewhere in the scene does not stop undo', () => {
		const applied = rewriteAliasLinks(original, isGibbins, 'Dad', 'Papa');
		const later = 'A whole new opening paragraph.\n\n' + applied.text + '\nAnd a new ending.\n';
		const undone = replayAliasEdits(later, isGibbins, applied.edits, 'undo');
		expect(undone.text).toBe('A whole new opening paragraph.\n\n' + original + '\nAnd a new ending.\n');
		expect(undone.done).toBe(3);
	});

	test('a link the writer edited since is left alone and counted', () => {
		const applied = rewriteAliasLinks(original, isGibbins, 'Dad', 'Papa');
		const edited = applied.text.replace('[[Mr Gibbins|Papa]] nodded', '[[Mr Gibbins|Father]] nodded');
		const undone = replayAliasEdits(edited, isGibbins, applied.edits, 'undo');
		expect(undone.done).toBe(2);
		expect(undone.left).toBe(1);
		expect(undone.text).toContain('[[Mr Gibbins|Father]] nodded');
		expect(undone.text).toContain('[[Mr Gibbins|Dad]] sat');
	});

	test('a "Papa" link the writer wrote herself is never changed back', () => {
		const applied = rewriteAliasLinks('[[Mr Gibbins|Dad]] left.', isGibbins, 'Dad', 'Papa');
		const later = applied.text + '\nMuch later, [[Mr Gibbins|Papa]] returned.';
		const undone = replayAliasEdits(later, isGibbins, applied.edits, 'undo');
		expect(undone.text).toBe('[[Mr Gibbins|Dad]] left.\nMuch later, [[Mr Gibbins|Papa]] returned.');
		expect(undone.done).toBe(1);
	});

	test('the sheet renamed in between: the link still counts', () => {
		const applied = rewriteAliasLinks('[[Mr Gibbins|Dad]] left.', isGibbins, 'Dad', 'Papa');
		const renamed = applied.text.replace('Mr Gibbins', 'Mr Gibson');
		const isGibson = (p: string) => p.trim().toLowerCase() === 'mr gibson';
		expect(replayAliasEdits(renamed, isGibson, applied.edits, 'undo').text).toBe('[[Mr Gibson|Dad]] left.');
	});

	test('look-alike links: when the text has more of them than were changed, none is touched', () => {
		const applied = rewriteAliasLinks('- [[Mr Gibbins|Dad]]\n', isGibbins, 'Dad', 'Papa');
		const later = '- [[Mr Gibbins|Papa]]\n' + applied.text;
		const undone = replayAliasEdits(later, isGibbins, applied.edits, 'undo');
		expect(undone.text).toBe(later);
		expect(undone.done).toBe(0);
		expect(undone.left).toBe(1);
	});

	test('look-alike links all changed by Plotverk all come back', () => {
		const text = '"Thanks, [[Mr Gibbins|Dad]]."\n"Thanks, [[Mr Gibbins|Dad]]."\n';
		const applied = rewriteAliasLinks(text, isGibbins, 'Dad', 'Papa');
		expect(replayAliasEdits(applied.text, isGibbins, applied.edits, 'undo').text).toBe(text);
	});

	test('Windows line endings do not hide a link from undo', () => {
		const crlf = 'He said [[Mr Gibbins|Dad]].\r\nNext line.\r\n';
		const applied = rewriteAliasLinks(crlf, isGibbins, 'Dad', 'Papa');
		const lf = applied.text.replace(/\r\n/g, '\n');
		const undone = replayAliasEdits(lf, isGibbins, applied.edits, 'undo');
		expect(undone.text).toBe('He said [[Mr Gibbins|Dad]].\nNext line.\n');
		expect(replayAliasEdits(applied.text, isGibbins, applied.edits, 'undo').text).toBe(crlf);
	});

	test('undo on text with nothing left to find changes nothing', () => {
		const edits: AliasEdit[] = [{ before: 'x ', after: ' y', from: 'Dad', to: 'Papa' }];
		const r = replayAliasEdits('Nothing.', isGibbins, edits, 'undo');
		expect(r).toMatchObject({ text: 'Nothing.', done: 0, left: 1, changes: [] });
	});
});
