import { markdownToHtml, htmlToMarkdown } from './rich-text';

describe('markdownToHtml', () => {
	test('plain line', () => {
		expect(markdownToHtml('Hello')).toBe('<div>Hello</div>');
	});
	test('bold and italic', () => {
		expect(markdownToHtml('**bold** and _italic_')).toBe('<div><strong>bold</strong> and <em>italic</em></div>');
	});
	test('h1 / h2', () => {
		expect(markdownToHtml('# Title')).toBe('<h1>Title</h1>');
		expect(markdownToHtml('## Sub')).toBe('<h2>Sub</h2>');
	});
	test('consecutive bullets collapse into one list', () => {
		expect(markdownToHtml('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
	});
	test('empty line becomes a br-filled div', () => {
		expect(markdownToHtml('a\n\nb')).toBe('<div>a</div><div><br></div><div>b</div>');
	});
	test('escapes html-special characters', () => {
		expect(markdownToHtml('a < b & c > d')).toBe('<div>a &lt; b &amp; c &gt; d</div>');
	});
	test('inline formatting inside a heading', () => {
		expect(markdownToHtml('# A **B**')).toBe('<h1>A <strong>B</strong></h1>');
	});
	test('empty input yields one editable blank line', () => {
		expect(markdownToHtml('')).toBe('<div><br></div>');
	});
});

describe('htmlToMarkdown', () => {
	test('bare text', () => {
		expect(htmlToMarkdown('Hello')).toBe('Hello');
	});
	test('div per line', () => {
		expect(htmlToMarkdown('<div>a</div><div>b</div>')).toBe('a\nb');
	});
	test('bare first line then div (Chrome shape)', () => {
		expect(htmlToMarkdown('Hello<div>World</div>')).toBe('Hello\nWorld');
	});
	test('strong/b and em/i both map', () => {
		expect(htmlToMarkdown('<b>x</b> <i>y</i>')).toBe('**x** _y_');
		expect(htmlToMarkdown('<strong>x</strong> <em>y</em>')).toBe('**x** _y_');
	});
	test('br inside a block is a newline', () => {
		expect(htmlToMarkdown('<div>a<br>b</div>')).toBe('a\nb');
	});
	test('trailing br filler is not a newline', () => {
		expect(htmlToMarkdown('<div>a<br></div>')).toBe('a');
	});
	test('empty div (br filler) makes a blank line', () => {
		expect(htmlToMarkdown('<div>a</div><div><br></div><div>b</div>')).toBe('a\n\nb');
	});
	test('headings and list items get prefixes', () => {
		expect(htmlToMarkdown('<h1>T</h1>')).toBe('# T');
		expect(htmlToMarkdown('<h2>S</h2>')).toBe('## S');
		expect(htmlToMarkdown('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b');
	});
	test('decodes entities', () => {
		expect(htmlToMarkdown('<div>a &lt; b &amp; c &nbsp;end</div>')).toBe('a < b & c  end');
	});
	test('strips unknown tags but keeps their text', () => {
		expect(htmlToMarkdown('<div><span style="x">hi</span></div>')).toBe('hi');
	});
});

describe('round-trip markdown → html → markdown is lossless', () => {
	const corpus = [
		'Hello',
		'**bold** and _italic_',
		'# Heading 1',
		'## Heading 2',
		'- one\n- two\n- three',
		'para 1\n\npara 2',
		'mix **bold** in _text_ here',
		'a < b & c > d',
		'# Title\n\nBody with **word**\n\n- alpha\n- beta',
		'line with "quotes" and \'apostrophes\'',
		'',
	];
	for (const md of corpus) {
		test(JSON.stringify(md), () => {
			expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
		});
	}
});
