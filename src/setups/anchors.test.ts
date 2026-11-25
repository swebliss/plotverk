import { planAnchor, applyAnchorPlan, stripAnchors, findAnchors, newAnchorId, isPlotverkAnchor, anchorRangesInLine } from './anchors';

const ID = 'pv-abc123';
const make = () => ID;
const plant = (text: string, needle: string) => {
	const plan = planAnchor(text, text.indexOf(needle), make);
	return { plan, out: applyAnchorPlan(text, plan) };
};

describe('newAnchorId', () => {
	it('is pv- plus six base-36 characters', () => {
		for (let i = 0; i < 50; i++) expect(isPlotverkAnchor(newAnchorId())).toBe(true);
	});
	it('skips ids already taken', () => {
		const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
		let n = 0;
		const id = newAnchorId((x) => x === 'pv-aaaaaa', () => seq[n++ % seq.length]);
		expect(id).toBe('pv-ssssss');
	});
	it('a writer id is not a Plotverk tag', () => {
		expect(isPlotverkAnchor('my-block')).toBe(false);
		expect(isPlotverkAnchor('pv-ABC123')).toBe(false);
	});
});

describe('planAnchor', () => {
	it('puts the tag at the end of a one-line paragraph', () => {
		const { out } = plant('Intro.\n\nShe hid the key. Then she left.\n\nNext.', 'hid');
		expect(out).toBe(`Intro.\n\nShe hid the key. Then she left. ^${ID}\n\nNext.`);
	});

	it('goes to the last line of a paragraph that spans lines', () => {
		const { out } = plant('First line of it\nsecond line here\nthird.\n\nOther.', 'First');
		expect(out).toBe(`First line of it\nsecond line here\nthird. ^${ID}\n\nOther.`);
	});

	it('keeps Windows line endings intact', () => {
		const { out } = plant('One.\r\n\r\nShe hid it.\r\nStill her.\r\n\r\nEnd.', 'hid');
		expect(out).toBe(`One.\r\n\r\nShe hid it.\r\nStill her. ^${ID}\r\n\r\nEnd.`);
	});

	it('replaces trailing spaces so Obsidian sees the id', () => {
		const { out } = plant('She hid it.   \n\nNext.', 'hid');
		expect(out).toBe(`She hid it. ^${ID}\n\nNext.`);
	});

	it('works when the file has no final newline', () => {
		const { out } = plant('Only line', 'line');
		expect(out).toBe(`Only line ^${ID}`);
	});

	it('marks one list item, not the whole list', () => {
		const { out } = plant('- one\n- two hidden\n  more of two\n- three', 'hidden');
		expect(out).toBe(`- one\n- two hidden\n  more of two ^${ID}\n- three`);
	});

	it('marks a paragraph inside a quote or callout', () => {
		const { out } = plant('> [!note] Title\n> First para\n> goes on\n>\n> Second para', 'First');
		expect(out).toBe(`> [!note] Title\n> First para\n> goes on ^${ID}\n>\n> Second para`);
	});

	it('stops at a heading below the paragraph', () => {
		const { out } = plant('Text here\n## Heading', 'Text');
		expect(out).toBe(`Text here ^${ID}\n## Heading`);
	});

	it('reuses a Plotverk tag already there', () => {
		const plan = planAnchor('She hid it. ^pv-zzz999\n', 3, make);
		expect(plan).toEqual({ kind: 'reuse', id: 'pv-zzz999', line: 0 });
	});

	it("reuses the writer's own block id instead of adding a second", () => {
		const plan = planAnchor('A line\nmore ^my-block\n\nNext', 1, make);
		expect(plan).toEqual({ kind: 'reuse', id: 'my-block', line: 1 });
	});

	it('reuses a lone id line under the paragraph', () => {
		// The last item: the lone id under the list already names this place.
		const plan = planAnchor('- a\n- b\n^list-id\n', 5, make);
		expect(plan).toMatchObject({ kind: 'reuse', id: 'list-id' });
		// An earlier item gets a tag of its own (more precise than the whole list).
		expect(planAnchor('- a\n- b\n^list-id\n', 0, make)).toMatchObject({ kind: 'insert', from: 3 });
		expect(plan).toMatchObject({ kind: 'reuse', id: 'list-id' });
	});

	it('refuses frontmatter, code, headings, tables and blank lines', () => {
		const doc = '---\ntitle: x\n---\n# Head\n\n```\ncode line\n```\n| a | b |\n\nprose';
		expect(planAnchor(doc, doc.indexOf('title'), make)).toEqual({ kind: 'refuse', reason: 'frontmatter-or-code' });
		expect(planAnchor(doc, doc.indexOf('Head'), make)).toEqual({ kind: 'refuse', reason: 'heading' });
		expect(planAnchor(doc, doc.indexOf('code line'), make)).toEqual({ kind: 'refuse', reason: 'frontmatter-or-code' });
		expect(planAnchor(doc, doc.indexOf('| a'), make)).toEqual({ kind: 'refuse', reason: 'table' });
		expect(planAnchor(doc, doc.indexOf('\n\nprose') + 1, make)).toEqual({ kind: 'refuse', reason: 'empty' });
		expect(planAnchor(doc, doc.indexOf('prose'), make)).toMatchObject({ kind: 'insert' });
	});

	it('does not ask for an id when it reuses one', () => {
		const spy = jest.fn(() => ID);
		planAnchor('x ^pv-aaaaaa', 0, spy);
		expect(spy).not.toHaveBeenCalled();
	});
});

describe('stripAnchors', () => {
	it('removes Plotverk tags only', () => {
		expect(stripAnchors('She hid it. ^pv-abc123\nOwn ^my-id\n')).toBe('She hid it.\nOwn ^my-id\n');
	});
	it('removes every block id when asked', () => {
		expect(stripAnchors('A ^pv-abc123\nB ^my-id\n- x\n^list\nC', { all: true })).toBe('A\nB\n- x\nC');
	});
	it('leaves code and frontmatter alone', () => {
		const doc = '---\nk: v ^pv-abc123\n---\n```\nx ^pv-abc123\n```\nreal ^pv-abc123';
		expect(stripAnchors(doc)).toBe('---\nk: v ^pv-abc123\n---\n```\nx ^pv-abc123\n```\nreal');
	});
	it('never touches footnotes or maths', () => {
		const t = 'A note[^1] and x^2.\n[^1]: The note.';
		expect(stripAnchors(t, { all: true })).toBe(t);
	});
	it('keeps CRLF', () => {
		expect(stripAnchors('a ^pv-abc123\r\nb')).toBe('a\r\nb');
	});
	it('removes a Plotverk tag stuck in the middle of a line, in both modes', () => {
		const t = 'He said ^pv-abc123 then left.\n^pv-zzz999 Start.';
		expect(stripAnchors(t)).toBe('He said then left.\nStart.');
		expect(stripAnchors(t, { all: true })).toBe('He said then left.\nStart.');
		expect(stripAnchors('Two ^pv-abc123 tags ^pv-zzz999')).toBe('Two tags');
	});
	it('leaves mid-line tags in inline code, code blocks, frontmatter and footnotes alone', () => {
		const t = '---\nk: a ^pv-abc123 b\n---\nUse `x ^pv-abc123 y` here.\n```\na ^pv-abc123 b\n```\nNote[^pv-abc123] ok.';
		expect(stripAnchors(t)).toBe(t);
	});
	it("keeps the writer's own ids in the middle of a line (only line ends are ids)", () => {
		expect(stripAnchors('A ^my-id b', { all: true })).toBe('A ^my-id b');
		expect(stripAnchors('Not ^pv-abc1234 ours')).toBe('Not ^pv-abc1234 ours');
	});
});

describe('findAnchors / anchorRangesInLine', () => {
	it('lists tags with their line', () => {
		expect(findAnchors('x\nShe ^pv-abc123\n```\ny ^pv-zzz999\n```')).toEqual([{ id: 'pv-abc123', line: 1 }]);
	});
	it('gives the hidden range, space included', () => {
		expect(anchorRangesInLine('She hid it. ^pv-abc123')).toEqual([[11, 22]]);
		expect(anchorRangesInLine('No tag ^mine')).toEqual([]);
	});
	it('also gives mid-line tags (pasted copies), never ones in inline code', () => {
		expect(anchorRangesInLine('He said ^pv-abc123 then. ^pv-zzz999')).toEqual([[7, 18], [24, 35]]);
		expect(anchorRangesInLine('Use `^pv-abc123` x')).toEqual([]);
	});
	it('never gives overlapping ranges (two tags side by side)', () => {
		expect(anchorRangesInLine('^pv-aaaaaa ^pv-bbbbbb')).toEqual([[0, 21]]);
		expect(anchorRangesInLine('x ^pv-aaaaaa ^pv-bbbbbb y')).toEqual([[1, 23]]);
	});
});
