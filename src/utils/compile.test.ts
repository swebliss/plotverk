import {
	stripFrontmatter,
	sceneBlocks,
	rebaseSceneHeadings,
	countWords,
	assembleManuscript,
	ManuscriptItem,
	removeComments,
	removeLinks,
	removeStrikethroughs,
	removeTags,
	tidyWhitespace,
	applyCompileSteps,
	defaultStepConfig,
	formatSceneTitle,
	expandEscapes,
	roundedWordCount,
	buildTitlePage,
	prepareItems,
	manuscriptWordTotal,
	WORKFLOW_PRESETS,
	getWorkflowPreset,
	workflowOptions,
	migrateLegacyWorkflow,
} from './compile';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function heading(depth: number, number: string, label: string): ManuscriptItem {
	return { kind: 'heading', depth, number, label };
}

function scene(depth: number, number: string, title: string, text: string): ManuscriptItem {
	return { kind: 'scene', depth, number, title, docPath: `Scenes/${title}.md`, text };
}

const TREE_ITEMS: ManuscriptItem[] = [
	heading(0, '1', 'Act I'),
	scene(1, '1.1', 'Opening Image', 'Mara hears the sea lie.'),
	scene(1, '1.2', 'The Captain', 'Iselde arrives at dawn.'),
	heading(0, '2', 'Act II'),
	scene(1, '2.1', 'The Wreck', 'The hull splits.'),
];

// ─── Basics ──────────────────────────────────────────────────────────────────

describe('stripFrontmatter', () => {
	test('removes a leading YAML block', () => {
		expect(stripFrontmatter('---\ntags: [a]\n---\nBody text.')).toBe('Body text.');
	});

	test('leaves documents without frontmatter alone', () => {
		expect(stripFrontmatter('# Title\n\nBody.')).toBe('# Title\n\nBody.');
	});

	test('keeps prose that opens with a --- thematic break', () => {
		const doc = '---\nThe sea lied again that morning.\n---\nMara did not answer.';
		expect(stripFrontmatter(doc)).toBe(doc);
	});

	test('removes a CRLF-terminated frontmatter block', () => {
		expect(stripFrontmatter('---\r\ntags: [a]\r\nstatus: draft\r\n---\r\nBody text.')).toBe('Body text.');
	});
});

describe('countWords', () => {
	test('counts prose words, not markdown punctuation', () => {
		expect(countWords('## Heading\n\nShe ran — *fast* — toward the **sea**.')).toBe(7);
	});

	test('empty text counts zero', () => {
		expect(countWords('')).toBe(0);
		expect(countWords('***')).toBe(0);
	});
});

// ─── Steps ───────────────────────────────────────────────────────────────────

describe('formatting steps', () => {
	test('removeComments strips markdown and html comments', () => {
		const text = 'Before %% hidden note %% mid <!-- todo --> after';
		expect(removeComments(text, { markdown: true, html: true })).toBe('Before  mid  after');
		expect(removeComments(text, { markdown: false, html: true })).toContain('%% hidden note %%');
		expect(removeComments(text, { markdown: true, html: false })).toContain('<!-- todo -->');
	});

	test('removeLinks unwraps wikilinks and external links', () => {
		expect(removeLinks('She met [[Iselde]] at [[Port Vance|the port]].', { wikilinks: true })).toBe(
			'She met Iselde at the port.'
		);
		expect(removeLinks('See [the map](https://x.test) now', { external: true })).toBe('See the map now');
		expect(removeLinks('An embed ![[image.png]] gone', { wikilinks: true })).toBe('An embed  gone');
	});

	test('removeStrikethroughs deletes struck text entirely', () => {
		expect(removeStrikethroughs('Keep ~~cut this~~ going')).toBe('Keep  going');
	});

	test('removeTags strips inline tags', () => {
		expect(removeTags('Draft #wip scene #act-1/beat')).toBe('Draft scene');
	});

	test('tidyWhitespace collapses blank-line runs and trailing spaces', () => {
		expect(tidyWhitespace('a  \n\n\n\nb')).toBe('a\n\nb');
	});

	test('applyCompileSteps runs scene-stage steps in order and respects options', () => {
		const steps = [
			defaultStepConfig('strip-frontmatter'),
			defaultStepConfig('remove-comments'),
			defaultStepConfig('remove-links'),
			defaultStepConfig('tidy-whitespace'),
		];
		const text = '---\ntitle: x\n---\nShe saw [[the ship]]. %% fix later %%\n\n\n\nEnd.';
		expect(applyCompileSteps(text, steps)).toBe('She saw the ship.\n\nEnd.');
	});

	test('steps pinned to the manuscript stage do not run in the scene stage', () => {
		const steps = [defaultStepConfig('remove-comments', 'manuscript')];
		expect(applyCompileSteps('Keep %% this %% here', steps, { stage: 'scene' })).toBe('Keep %% this %% here');
		expect(applyCompileSteps('Keep %% this %% here', steps, { stage: 'manuscript' })).toBe('Keep  here');
	});
});

describe('prepend-title step', () => {
	test('formatSceneTitle expands $1, $2, and $3{} tokens', () => {
		expect(formatSceneTitle('$1', 'Opening', '1.1', 1)).toBe('Opening');
		expect(formatSceneTitle('$2 — $1', 'Opening', '2.3', 1)).toBe('2.3 — Opening');
		expect(formatSceneTitle('$3{#} $1', 'Opening', '1', 0)).toBe('# Opening');
		expect(formatSceneTitle('$3{#} $1', 'Nested', '1.1.1', 2)).toBe('### Nested');
	});

	test('titles are inserted literally — `$&`, `$$`, `$\'` and `$`` are not replacement patterns', () => {
		expect(formatSceneTitle('$1', 'Cash $& Carry', '1', 0)).toBe('Cash $& Carry');
		expect(formatSceneTitle('$2 $1', 'Tom $$ Jerry', '1', 0)).toBe('1 Tom $$ Jerry');
		expect(formatSceneTitle('[$1]', "a $' b $` c", '1', 0)).toBe("[a $' b $` c]");
		// A title that itself contains a token is not expanded a second time.
		expect(formatSceneTitle('$2: $1', 'Chapter $2', '4', 0)).toBe('4: Chapter $2');
	});

	test('expandEscapes turns stored \\n into real newlines', () => {
		expect(expandEscapes('a\\n\\nb')).toBe('a\n\nb');
	});

	test('prepends the rendered title with its separator', () => {
		const step = defaultStepConfig('prepend-title');
		step.options['format'] = '$3{#} $1';
		const out = applyCompileSteps('Body.', [step], { stage: 'scene', title: 'Opening', number: '1', depth: 1 });
		expect(out).toBe('## Opening\n\nBody.');
	});

	test('does nothing when the scene has no title', () => {
		const out = applyCompileSteps('Body.', [defaultStepConfig('prepend-title')], { stage: 'scene', title: '' });
		expect(out).toBe('Body.');
	});
});

describe('add-frontmatter step', () => {
	test('adds a YAML block to the manuscript', () => {
		const step = defaultStepConfig('add-frontmatter', 'manuscript');
		step.options['yaml'] = 'status: compiled';
		const out = applyCompileSteps('# Book\n\nText.', [step], { stage: 'manuscript' });
		expect(out).toBe('---\nstatus: compiled\n---\n\n# Book\n\nText.');
	});
});

// ─── Title pages ─────────────────────────────────────────────────────────────

describe('title pages', () => {
	test('roundedWordCount quotes industry-style round numbers', () => {
		expect(roundedWordCount(437)).toBe(400);
		expect(roundedWordCount(12260)).toBe(12500);
		expect(roundedWordCount(81400)).toBe(81000);
	});

	test('novel title page follows standard manuscript format', () => {
		const page = buildTitlePage('novel', 'The Tide Thief', { author: 'Emma Berg', contact: 'emma@x.test' }, 81400);
		expect(page).toContain('Emma Berg');
		expect(page).toContain('emma@x.test');
		expect(page).toContain('About 81,000 words');
		expect(page).toContain('# The Tide Thief');
		expect(page).toContain('by Emma Berg');
	});

	test('fountain title page emits screenplay keys with a custom credit', () => {
		const page = buildTitlePage('fountain', 'The Tide Thief', { author: 'Emma Berg', contact: '555-0100', credit: 'A play by' }, 0);
		expect(page).toContain('Title: The Tide Thief');
		expect(page).toContain('Credit: A play by');
		expect(page).toContain('Author: Emma Berg');
		expect(page).toContain('Contact: 555-0100');
		expect(page).toContain('===');
	});
});

// ─── Assembly ────────────────────────────────────────────────────────────────

describe('assembleManuscript (tree items)', () => {
	test('dividers become depth-levelled headings; adjacent scenes get separators', () => {
		const md = assembleManuscript('The Tide Thief', TREE_ITEMS);
		expect(md).toBe(
			[
				'# The Tide Thief',
				'',
				'## Act I',
				'',
				'Mara hears the sea lie.',
				'',
				'***',
				'',
				'Iselde arrives at dawn.',
				'',
				'## Act II',
				'',
				'The hull splits.',
				'',
			].join('\n')
		);
	});

	test('nested dividers step down heading levels', () => {
		const items = [heading(0, '1', 'Act I'), heading(1, '1.1', 'The Storm'), scene(2, '1.1.1', 'S', 'Text.')];
		const md = assembleManuscript('T', items);
		expect(md).toContain('## Act I');
		expect(md).toContain('### The Storm');
	});

	test('headings can be switched off; empty scenes are dropped', () => {
		const items = [...TREE_ITEMS, scene(0, '3', 'Empty', '   ')];
		const md = assembleManuscript('T', items, { includeHeadings: false, sceneSeparator: '', steps: [defaultStepConfig('tidy-whitespace')] });
		expect(md).not.toContain('## Act');
		expect(md).toContain('The hull splits.');
	});

	test('manuscript-stage steps run over the assembled output', () => {
		const fm = defaultStepConfig('add-frontmatter', 'manuscript');
		fm.options['yaml'] = 'compiled: true';
		const md = assembleManuscript('T', TREE_ITEMS, { includeHeadings: true, sceneSeparator: '***', steps: [fm] });
		expect(md.startsWith('---\ncompiled: true\n---')).toBe(true);
	});

	test('endMark lands after the last scene', () => {
		const md = assembleManuscript('T', TREE_ITEMS, { includeHeadings: true, sceneSeparator: '#', endMark: 'THE END' });
		expect(md.trimEnd().endsWith('THE END')).toBe(true);
	});

	test('manuscriptWordTotal counts prepared scene words only', () => {
		expect(manuscriptWordTotal(prepareItems(TREE_ITEMS, []))).toBe(
			countWords('Mara hears the sea lie.') + countWords('Iselde arrives at dawn.') + countWords('The hull splits.')
		);
	});
});

// ─── Presets & workflows ─────────────────────────────────────────────────────

describe('workflow presets', () => {
	test('all six presets build valid workflows with unique ids', () => {
		const ids = new Set<string>();
		for (const preset of WORKFLOW_PRESETS) {
			const wf = preset.build();
			expect(wf.name.length).toBeGreaterThan(0);
			expect(['md', 'fountain', 'docx', 'epub']).toContain(wf.output);
			expect(wf.steps.length).toBeGreaterThan(0);
			ids.add(wf.id);
		}
		expect(ids.size).toBe(WORKFLOW_PRESETS.length);
	});

	test('novel presets carry the standard-manuscript markers', () => {
		for (const id of ['novel-docx', 'novel-md']) {
			const wf = getWorkflowPreset(id)!.build();
			expect(wf.sceneSeparator).toBe('#');
			expect(wf.titlePage).toBe('novel');
			expect(wf.endMark).toBe('THE END');
		}
	});

	test('script presets are fountain with the right credits', () => {
		expect(getWorkflowPreset('film-fountain')!.build().credit).toBe('Written by');
		expect(getWorkflowPreset('tv-fountain')!.build().actMarkers).toBe(true);
		expect(getWorkflowPreset('play-fountain')!.build().credit).toBe('A play by');
	});

	test('novel preset assembles a submission-ready manuscript end to end', () => {
		const wf = getWorkflowPreset('novel-md')!.build();
		const opts = { ...workflowOptions(wf), author: 'Emma Berg' };
		const items = [
			heading(0, '1', 'Chapter One'),
			scene(1, '1.1', 'Opening', '---\nstatus: draft\n---\nThe sea lied to [[Mara]].'),
			scene(1, '1.2', 'The Captain', 'He waited. %% rework %%'),
		];
		const md = assembleManuscript('The Tide Thief', items, opts);
		expect(md).toContain('# The Tide Thief');
		expect(md).toContain('by Emma Berg');
		expect(md).not.toContain('status: draft');
		expect(md).not.toContain('[[');
		expect(md).not.toContain('%%');
		expect(md).toContain('## Chapter One');
		expect(md.trimEnd().endsWith('THE END')).toBe(true);
		// Scene break between adjacent scenes uses the centred "#"
		expect(md).toContain('\n#\n');
	});
});

describe('migrateLegacyWorkflow', () => {
	test('maps the old single-workflow shape onto a named workflow', () => {
		const wf = migrateLegacyWorkflow({
			preset: 'novel',
			includeBeatHeadings: true,
			includeSceneTitles: false,
			sceneSeparator: '#',
			steps: [{ id: 'strip-frontmatter', options: {} }],
			titlePage: 'novel',
			author: 'Emma',
			contact: '',
			endMark: 'THE END',
		});
		expect(wf.name).toBe('My workflow');
		expect(wf.output).toBe('md');
		expect(wf.includeHeadings).toBe(true);
		expect(wf.steps[0].stage).toBe('scene');
		expect(wf.author).toBe('Emma');
	});

	test('screenplay preset migrates to fountain output', () => {
		expect(migrateLegacyWorkflow({ preset: 'screenplay' }).output).toBe('fountain');
	});

	test('old "Scene titles" toggle becomes a prepend-title step', () => {
		const wf = migrateLegacyWorkflow({ includeSceneTitles: true, steps: [] });
		expect(wf.steps[0].id).toBe('prepend-title');
		expect(wf.steps[0].options['format']).toBe('### $1');
	});

	test('handles null/garbage input with safe defaults', () => {
		const wf = migrateLegacyWorkflow(null);
		expect(wf.output).toBe('md');
		expect(wf.sceneSeparator).toBe('***');
		expect(wf.steps.some((s) => s.id === 'strip-frontmatter')).toBe(true);
	});
});

describe('sceneBlocks / rebaseSceneHeadings', () => {

	test('splits headings from prose, even without a blank line', () => {
		expect(sceneBlocks('## Beat\nText one.\nText two.\n\nPara.')).toEqual([
			{ kind: 'heading', level: 2, text: 'Beat' },
			{ kind: 'para', text: 'Text one.\nText two.' },
			{ kind: 'para', text: 'Para.' },
		]);
	});

	test('drops an optional closing hash run', () => {
		expect(sceneBlocks('### Beat ###')).toEqual([{ kind: 'heading', level: 3, text: 'Beat' }]);
	});

	test('a lone "#", "#tag" and "####### seven" are prose', () => {
		expect(sceneBlocks('#\n\n#tag\n\n####### seven').every((b) => b.kind === 'para')).toBe(true);
	});

	test('rebase keeps relative steps and caps at 6', () => {
		expect(rebaseSceneHeadings('# A\n\n## B\n\n###### F', 3)).toBe('### A\n\n#### B\n\n###### F');
		expect(rebaseSceneHeadings('No headings here.', 3)).toBe('No headings here.');
	});
});
