import { buildDocx, buildDocxBody, runsForText, surnameOf } from './docx';
import { ManuscriptItem } from './compile';

function heading(depth: number, label: string): ManuscriptItem {
	return { kind: 'heading', depth, number: '', label };
}
function scene(text: string): ManuscriptItem {
	return { kind: 'scene', depth: 1, number: '', title: 'S', docPath: 'Scenes/S.md', text };
}

const NOVEL: ManuscriptItem[] = [
	heading(0, 'Chapter One'),
	scene('The sea lied to Mara.'),
	scene('Iselde waited at dawn.'),
	heading(0, 'Chapter Two'),
	scene('The hull split.'),
];

const NOVEL_OPTS = {
	includeHeadings: true,
	sceneSeparator: '#',
	titlePage: 'novel' as const,
	author: 'Emma Berg',
	contact: '123 Harbor Rd\nemma@x.test',
	endMark: 'THE END',
};

describe('surnameOf', () => {
	test('takes the last name token', () => {
		expect(surnameOf('Emma Berg')).toBe('Berg');
		expect(surnameOf('Ana Maria de Souza')).toBe('Souza');
		expect(surnameOf('')).toBe('');
	});
});

describe('runsForText', () => {
	test('wraps bold and italic in the right run properties', () => {
		const out = runsForText('a **b** c *d* e');
		expect(out).toContain('<w:b/>');
		expect(out).toContain('<w:i/>');
		expect(out).toContain('<w:t xml:space="preserve">b</w:t>');
	});

	test('italics can render as underline', () => {
		const out = runsForText('*whisper*', { underlineItalics: true });
		expect(out).toContain('<w:u w:val="single"/>');
		expect(out).not.toContain('<w:i/>');
	});

	test('escapes XML-special characters', () => {
		expect(runsForText('Tom & <Jerry>')).toContain('Tom &amp; &lt;Jerry&gt;');
	});

	test('turns newlines into breaks', () => {
		expect(runsForText('line one\nline two')).toContain('<w:br/>');
	});
});

describe('buildDocxBody', () => {
	const body = buildDocxBody('The Tide Thief', NOVEL, NOVEL_OPTS, 'Emma Berg');

	test('includes a Shunn title page with rounded word count and byline', () => {
		expect(body).toContain('About');
		expect(body).toContain('words');
		expect(body).toContain('by Emma Berg');
		expect(body).toContain('123 Harbor Rd');
	});

	test('chapters use Heading1 and page-break between them', () => {
		expect(body).toContain('<w:pStyle w:val="Heading1"/>');
		expect(body).toContain('Chapter One');
		expect(body).toContain('Chapter Two');
		expect(body).toContain('w:type="page"');
	});

	test('scene break separator is centred between adjacent scenes', () => {
		expect(body).toContain('<w:jc w:val="center"/>');
		expect(body).toContain('<w:t>#</w:t>');
	});

	test('body prose paragraphs carry a first-line indent', () => {
		expect(body).toContain('<w:ind w:firstLine="720"/>');
	});

	test('section properties set 1" margins and a title page header', () => {
		expect(body).toContain('w:left="1440"');
		expect(body).toContain('<w:titlePg/>');
		expect(body).toContain('<w:headerReference');
	});

	test('THE END lands centred at the foot', () => {
		expect(body).toContain('THE END');
	});
});

describe('buildDocx (package)', () => {
	const bytes = buildDocx('The Tide Thief', NOVEL, NOVEL_OPTS, 'Emma Berg');

	test('produces a non-empty ZIP starting with the PK signature', () => {
		expect(bytes.length).toBeGreaterThan(500);
		expect(bytes[0]).toBe(0x50); // 'P'
		expect(bytes[1]).toBe(0x4b); // 'K'
	});

	test('contains the required OOXML part names', () => {
		const text = new TextDecoder().decode(bytes);
		for (const part of [
			'[Content_Types].xml',
			'word/document.xml',
			'word/styles.xml',
			'word/header2.xml',
			'word/_rels/document.xml.rels',
		]) {
			expect(text).toContain(part);
		}
	});

	test('running header carries the surname and upper-cased title', () => {
		const text = new TextDecoder().decode(bytes);
		expect(text).toContain('Berg / THE TIDE THIEF');
		expect(text).toContain('PAGE');
	});

	test('styles declare Times New Roman and double spacing', () => {
		const text = new TextDecoder().decode(bytes);
		expect(text).toContain('Times New Roman');
		expect(text).toContain('w:line="480"');
	});
});

describe('headings inside a scene (Saltmarch beat lines)', () => {
	// A scene like Saltmarch's "04 Crane Makes an Offer": beat headings with a
	// short summary under each, plus one heading glued to its prose.
	const SUMMARY = [
		heading(0, 'Chapter Four'),
		scene(
			'## The lease proposal, first heard of\n\nCrane’s move: lease the deep marsh.\n\n' +
				'## Tobin defends the Council\nHe argues the lease is prudent.\n\n### A smaller beat\n\nShort.'
		),
		scene('The next scene.'),
	];
	const body = buildDocxBody('Saltmarch', SUMMARY, NOVEL_OPTS, 'Emma Berg');

	test('no literal "##" reaches Word', () => {
		expect(body).not.toMatch(/#{2,}/);
	});

	test('beat lines become Word headings below the chapter heading', () => {
		expect(body).toMatch(
			/<w:pStyle w:val="Heading3"\/><w:keepNext\/><\/w:pPr><w:r><w:t xml:space="preserve">The lease proposal, first heard of<\/w:t>/
		);
		expect(body).toContain('>Tobin defends the Council<');
		// One step deeper than the scene's shallowest heading.
		expect(body).toMatch(/Heading4"\/><w:keepNext\/><\/w:pPr><w:r><w:t xml:space="preserve">A smaller beat</);
	});

	test('a heading glued to its prose still splits into heading + indented paragraph', () => {
		expect(body).toMatch(
			/Tobin defends the Council<\/w:t><\/w:r><\/w:p><w:p><w:pPr><w:ind w:firstLine="720"\/><\/w:pPr><w:r><w:t xml:space="preserve">He argues/
		);
	});

	test('a writer\'s "# Beat" is re-based to Heading3 — never outranks the chapter', () => {
		const b = buildDocxBody('X', [heading(0, 'One'), scene('# Big beat\n\nText.')], NOVEL_OPTS, '');
		expect(b).toMatch(/Heading3"\/><w:keepNext\/><\/w:pPr><w:r><w:t xml:space="preserve">Big beat</);
		expect(b.match(/Heading1/g)?.length).toBe(1); // only the chapter itself
	});

	test('the "#" scene separator stays a centred paragraph, not a heading', () => {
		expect(body).toContain('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>#</w:t></w:r></w:p>');
		const lone = buildDocxBody('X', [scene('Before.\n\n#\n\nAfter.')], { ...NOVEL_OPTS, titlePage: 'none' as const }, '');
		expect(lone).not.toContain('Heading3');
		expect(lone).toContain('<w:t xml:space="preserve">#</w:t>');
	});

	test('#tags and "#" with no text are left as prose', () => {
		const b = buildDocxBody('X', [scene('#draft note\n\n## \n\nText.')], { ...NOVEL_OPTS, titlePage: 'none' as const }, '');
		expect(b).not.toContain('Heading3');
		expect(b).toContain('#draft note');
	});

	test('styles.xml declares Heading3–6', () => {
		const text = new TextDecoder().decode(buildDocx('Saltmarch', SUMMARY, NOVEL_OPTS, 'Emma Berg'));
		for (const n of [3, 4, 5, 6]) expect(text).toContain(`w:styleId="Heading${n}"`);
	});
});

describe('review fixes', () => {
	const PLAIN = { ...NOVEL_OPTS, titlePage: 'none' as const };

	test('Windows line endings: beat lines still become headings', () => {
		const b = buildDocxBody('X', [scene('## Beat\r\n\r\nText.')], PLAIN, '');
		expect(b).toMatch(/Heading3"\/><w:keepNext\/><\/w:pPr><w:r><w:t xml:space="preserve">Beat</);
		expect(b).not.toContain('\r');
	});

	test('scene titles get the same level in every scene', () => {
		const b = buildDocxBody('X', [scene('### Title A\n\nText.'), scene('### Title B\n\n# Beat\n\nText.')], PLAIN, '');
		expect(b).toMatch(/Heading5"\/><w:keepNext\/><\/w:pPr><w:r><w:t xml:space="preserve">Title A</);
		expect(b).toMatch(/Heading5"\/><w:keepNext\/><\/w:pPr><w:r><w:t xml:space="preserve">Title B</);
		expect(b).toMatch(/Heading3"\/><w:keepNext\/><\/w:pPr><w:r><w:t xml:space="preserve">Beat</);
	});

	test('a "#" line inside a code fence stays text', () => {
		const b = buildDocxBody('X', [scene('```\n# not a heading\n```')], PLAIN, '');
		expect(b).not.toContain('Heading3');
		expect(b).toContain('# not a heading');
	});
});

describe('re-check fix: a lone "~~~" is a section break, not a code block', () => {
	test('headings after an unclosed "~~~" still become headings', () => {
		const b = buildDocxBody('X', [scene('Text.\n\n~~~\n\n## Beat\n\nMore.')], { ...NOVEL_OPTS, titlePage: 'none' as const }, '');
		expect(b).toMatch(/Heading3"\/><w:keepNext\/><\/w:pPr><w:r><w:t xml:space="preserve">Beat</);
	});
});
