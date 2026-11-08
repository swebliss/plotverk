import { chaptersFromItems, mdToXhtml } from './epub';
import { ManuscriptItem } from './compile';

function heading(depth: number, label: string): ManuscriptItem {
	return { kind: 'heading', depth, number: '', label };
}
function scene(text: string): ManuscriptItem {
	return { kind: 'scene', depth: 1, number: '', title: 'S', docPath: 'Scenes/S.md', text };
}

describe('mdToXhtml headings', () => {
	test('every level 1–6 becomes a real heading', () => {
		const html = mdToXhtml('# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f');
		for (const [n, t] of [[1, 'a'], [2, 'b'], [3, 'c'], [4, 'd'], [5, 'e'], [6, 'f']] as const) {
			expect(html).toContain(`<h${n}>${t}</h${n}>`);
		}
		expect(html).not.toContain('#');
	});

	test('a heading glued to its prose splits into heading + paragraph', () => {
		expect(mdToXhtml('## Beat\nThe text.')).toBe('<h2>Beat</h2>\n<p>The text.</p>');
	});

	test('separators still render as breaks, not headings', () => {
		expect(mdToXhtml('#')).toBe('<p class="scene-break">#</p>');
		expect(mdToXhtml('***')).toBe('<hr/>');
	});
});

describe('chaptersFromItems in-scene headings', () => {
	test('scene headings are re-based to level 3 under the chapter', () => {
		const ch = chaptersFromItems(
			[heading(0, 'One'), scene('# Beat\n\nText.\n\n## Smaller\n\nMore.')],
			{ includeHeadings: true, sceneSeparator: '***' }
		);
		expect(ch).toHaveLength(1);
		expect(ch[0].markdown).toContain('### Beat');
		expect(ch[0].markdown).toContain('#### Smaller');
	});
});

describe('review fixes', () => {
	test('Windows line endings: "## Beat\r" is still a heading', () => {
		expect(mdToXhtml('Intro\r\n\r\n## Beat\r\n\r\nText')).toBe('<p>Intro</p>\n<h2>Beat</h2>\n<p>Text</p>');
	});

	test('beats sit below the deepest nested divider, never tie with it', () => {
		const ch = chaptersFromItems(
			[heading(0, 'One'), heading(1, 'Part'), heading(2, 'Section'), scene('# Beat\n\nText.')],
			{ includeHeadings: true, sceneSeparator: '***' }
		);
		expect(ch[0].markdown).toContain('### Part');
		expect(ch[0].markdown).toContain('#### Section');
		expect(ch[0].markdown).toContain('##### Beat');
	});

	test('one level map for the whole book: a "### Title" lands on the same level in every scene', () => {
		const ch = chaptersFromItems(
			[heading(0, 'One'), scene('### Title A\n\nText.'), scene('### Title B\n\n# Beat\n\nText.')],
			{ includeHeadings: true, sceneSeparator: '***' }
		);
		expect(ch[0].markdown).toContain('##### Title A');
		expect(ch[0].markdown).toContain('##### Title B');
		expect(ch[0].markdown).toContain('### Beat');
	});
});

describe('re-check fix: "~~~" separators and fences', () => {
	test('a "~~~" scene separator never hides the next scene\'s headings', () => {
		const ch = chaptersFromItems(
			[heading(0, 'One'), scene('## A\n\nText.'), scene('## B\n\nText.'), scene('## C\n\nText.')],
			{ includeHeadings: true, sceneSeparator: '~~~' }
		);
		const html = mdToXhtml(ch[0].markdown);
		for (const t of ['A', 'B', 'C']) expect(html).toContain(`<h3>${t}</h3>`);
		expect(html).not.toMatch(/<p>#/);
	});

	test('a heading-looking line inside a closed fence prints as text, without the escape', () => {
		const ch = chaptersFromItems([heading(0, 'One'), scene('```\n# not a heading\n```\n\n## Real')], {
			includeHeadings: true,
			sceneSeparator: '***',
		});
		const html = mdToXhtml(ch[0].markdown);
		expect(html).toContain('# not a heading');
		expect(html).not.toContain('\\#');
		expect(html).not.toContain('<h3>not a heading</h3>');
		expect(html).toContain('<h3>Real</h3>');
	});
});
