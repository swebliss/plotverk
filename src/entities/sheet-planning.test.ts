import { buildEntityDocument } from './entity-doc';
import { stripSheetPlanning } from './entity-parse';
import { CharacterField, CompileWorkflowSettings } from '../grid-data';
import {
	applyCompileSteps,
	addPlanningStep,
	assembleManuscript,
	defaultStepConfig,
	DEFAULT_MANUSCRIPT_OPTIONS,
	WORKFLOW_PRESETS,
	stripFrontmatter,
} from '../utils/compile';

const field = (label: string, value: string, type: CharacterField['type'] = 'text'): CharacterField => ({ id: label, label, value, type });

const STORY = 'The bell rang twice before anyone moved.\n\nMara counted under her breath.';
const NOTES = '## Notes\n\nRemember the bell.\nAnd the tide.';

/** A scene page exactly as "Create scene document" writes it. */
const sceneSheet = buildEntityDocument('scene', 'Eight Days', [
	field('Title', 'Eight Days'),
	field('POV Character', 'Mara'),
	field('Conflict', 'Pike sells the date'),
	field('Summary', 'Planning sequence. Wrenna offers the line.', 'textarea'),
	field('Notes', 'Remember the bell.\nAnd the tide.', 'textarea'),
]);

/** Blank-line runs collapsed, as the "Tidy whitespace" step does. */
const tidy = (s: string) => s.replace(/\n{3,}/g, '\n\n');
const strip = (doc: string) => tidy(stripFrontmatter(stripSheetPlanning(doc, 'Eight Days')));

describe('stripSheetPlanning — a sheet’s planning stays out of the book', () => {
	it('leaves out the title, the at-a-glance box and a stored section', () => {
		const out = strip(sceneSheet);
		expect(out).not.toContain('Eight Days');
		expect(out).not.toContain('Scene at a Glance');
		expect(out).not.toContain('Planning sequence');
	});

	it('always keeps the last section: story typed at the bottom lands inside it', () => {
		expect(strip(sceneSheet)).toBe(NOTES);
		expect(strip(sceneSheet.trimEnd() + '\n\n' + STORY + '\n')).toBe(NOTES + '\n\n' + STORY);
	});

	it('keeps the story after the sheet editor saved it into the last field', () => {
		// The editor reads a section up to the next heading, so the story became the Notes answer.
		const saved = buildEntityDocument('scene', 'Eight Days', [
			field('Title', 'Eight Days'),
			field('Summary', 'Planning sequence.', 'textarea'),
			field('Notes', 'Remember the bell.\n\n' + STORY, 'textarea'),
		]);
		expect(strip(saved)).toContain(STORY);
	});

	it('keeps the story after a field was added below it later', () => {
		// Story typed under Summary, saved into Summary; Notes filled in later and appended at the end.
		const later = buildEntityDocument('scene', 'Eight Days', [
			field('Title', 'Eight Days'),
			field('Summary', 'Plan.\n\n' + STORY, 'textarea'),
			field('Notes', 'Remember.', 'textarea'),
		]);
		expect(strip(later)).toContain(STORY);
	});

	it('keeps the writer’s own empty headings', () => {
		const doc = sceneSheet.trimEnd() + '\n\n## Part One\n\n## Chapter 1\n\n' + STORY + '\n';
		expect(strip(doc)).toBe('## Part One\n\n## Chapter 1\n\n' + STORY);
	});

	it('still leaves out an empty section of the sheet’s own', () => {
		const doc = sceneSheet.replace('## Summary\n\nPlanning sequence. Wrenna offers the line.', '## Summary\n\n_No content yet._');
		expect(strip(doc)).toBe(NOTES);
	});

	it('keeps story text typed below a stored answer, as typed', () => {
		const typed = 'The bell rang.  \n    An indented verse line.';
		const doc = sceneSheet.replace('Wrenna offers the line.\n', 'Wrenna offers the line.\n\n' + typed + '\n');
		expect(strip(doc)).toBe(typed + '\n\n' + NOTES);
	});

	it('keeps story text typed between the box and the first section', () => {
		const doc = sceneSheet.replace('## Summary', STORY + '\n\n## Summary');
		expect(strip(doc)).toBe(STORY + '\n\n' + NOTES);
	});

	it('keeps the writer’s own headings and what is under them, and then leaves out Notes', () => {
		const doc = sceneSheet.trimEnd() + '\n\n## The Bell\n\n' + STORY + '\n';
		expect(strip(doc)).toBe('## The Bell\n\n' + STORY);
	});

	it('keeps a section whole when it no longer matches its stored answer', () => {
		const doc = sceneSheet.replace('## Summary\n\nPlanning sequence. Wrenna offers the line.', '## Summary\n\nRewritten by hand in the note.');
		expect(strip(doc)).toBe('## Summary\n\nRewritten by hand in the note.\n\n' + NOTES);
	});

	it('keeps a first heading that is not the page’s own title — or when the file is unknown', () => {
		expect(strip(sceneSheet.replace('# Eight Days', '# Chapter One'))).toBe('# Chapter One\n\n' + NOTES);
		expect(tidy(stripFrontmatter(stripSheetPlanning(sceneSheet)))).toBe('# Eight Days\n\n' + NOTES);
	});

	it('leaves a plain writing page untouched', () => {
		const plain = '---\nstatus: idea\n---\n\n## Eight days to the vote\n\nPlanning sequence. Wrenna offers the line.\n\n## Notes\n\nKeep.\n';
		expect(stripSheetPlanning(plain, 'Eight Days')).toBe(plain);
		expect(stripSheetPlanning(STORY, 'Eight Days')).toBe(STORY);
	});

	describe('lists and tables', () => {
		const withBeats = (beats: string) => buildEntityDocument('scene', 'Eight Days', [
			field('Title', 'Eight Days'),
			field('Beats', beats, 'list'),
			field('Notes', 'Remember the bell.\nAnd the tide.', 'textarea'),
		]);

		it('leaves out exactly the stored rows', () => {
			expect(strip(withBeats('Bell rings\nPike leaves'))).toBe(NOTES);
		});

		it('keeps dash dialogue typed right below the list', () => {
			const doc = withBeats('Bell rings').replace('- Bell rings\n', '- Bell rings\n- Hej, sa hon.\n- Hej då.\n\nHon gick.\n');
			expect(strip(doc)).toBe('- Hej, sa hon.\n- Hej då.\n\nHon gick.\n\n' + NOTES);
		});

		it('keeps a list whose rows were edited by hand', () => {
			const doc = withBeats('Bell rings\nPike leaves').replace('- Pike leaves', '- Pike stays');
			expect(strip(doc)).toContain('- Pike stays');
			expect(strip(doc)).toContain('- Bell rings');
		});
	});

	it('reads properties the way Obsidian writes them (block text, Windows line endings)', () => {
		const doc = [
			'---', 'storygrid-type: scene', 'summary: |-', '  Planning sequence.', '  Second line.', 'notes: Keep me', '---',
			'', '# Eight Days', '', '## Summary', '', 'Planning sequence.', 'Second line.', '', STORY, '', '## Notes', '', 'Keep me', '',
		].join('\r\n');
		const out = strip(doc).replace(/\r\n/g, '\n');
		expect(out).toBe(STORY + '\n\n## Notes\n\nKeep me');
	});
});

describe('the "Remove planning" export step', () => {
	const withStory = sceneSheet.replace('## Notes', STORY + '\n\n## The End\n\nIt ended.\n\n## Notes').replace(/## Notes[\s\S]*$/, '');

	it('is in the default steps and every built-in workflow', () => {
		expect(DEFAULT_MANUSCRIPT_OPTIONS.steps?.some((s) => s.id === 'remove-planning')).toBe(true);
		for (const p of WORKFLOW_PRESETS) expect(p.build().steps.some((s) => s.id === 'remove-planning')).toBe(true);
	});

	it('runs first, wherever it sits in the list', () => {
		const steps = [defaultStepConfig('remove-links'), defaultStepConfig('strip-frontmatter'), defaultStepConfig('remove-planning')];
		const out = applyCompileSteps(withStory, steps, { stage: 'scene', title: 'Eight Days' });
		expect(out).not.toContain('Scene at a Glance');
		expect(out).not.toContain('Planning sequence');
		expect(out).toContain(STORY);
	});

	it('takes nothing out when the writer removed the step', () => {
		const out = applyCompileSteps(withStory, [defaultStepConfig('strip-frontmatter')], { stage: 'scene', title: 'Eight Days' });
		expect(out).toContain('Scene at a Glance');
		expect(out).toContain(STORY);
	});

	it('gives the manuscript the story, not the planning', () => {
		const md = assembleManuscript('Saltmarch', [
			{ kind: 'scene', depth: 0, number: '1', title: 'Eight Days', docPath: 'Scenes/Eight Days.md', text: sceneSheet.trimEnd() + '\n\n' + STORY + '\n' },
		]);
		expect(md).toBe('# Saltmarch\n\n' + NOTES + '\n\n' + STORY + '\n');
	});

	it('is added once to workflows saved before it existed', () => {
		const wf = { steps: [defaultStepConfig('strip-frontmatter')] } as CompileWorkflowSettings;
		const done = { steps: [defaultStepConfig('remove-planning')] } as CompileWorkflowSettings;
		expect(addPlanningStep([wf, done])).toBe(true);
		expect(wf.steps.map((s) => s.id)).toEqual(['remove-planning', 'strip-frontmatter']);
		expect(done.steps).toHaveLength(1);
		expect(addPlanningStep([wf, done])).toBe(false);
	});
});
