import { countWords as statsWords } from '../utils/stats';
import { countWords as compileWords, applyCompileSteps, assembleManuscript, DEFAULT_MANUSCRIPT_OPTIONS, ManuscriptItem } from '../utils/compile';
import { maskNonProse } from '../prose/mask';

const scene = '---\npov: Mara\n---\nShe hid the key. ^pv-abc123\n\nThen she left.';

describe('setup tags never reach readers or counts', () => {
	it('are not words', () => {
		expect(statsWords('a b ^pv-abc123')).toBe(2);
		expect(compileWords('a b ^pv-abc123')).toBe(2);
		expect(statsWords('a b ^pv-abc123\nc')).toBe(3);
	});

	it('are not words in the middle of a line either, next to punctuation', () => {
		expect(statsWords('He said ^pv-abc123. Then')).toBe(3);
		expect(compileWords('He said ^pv-abc123, then')).toBe(3);
	});

	it('are stripped from exports in the middle of a line too', () => {
		expect(applyCompileSteps('He said ^pv-abc123 then left.', [], { stage: 'scene' })).toBe('He said then left.');
	});

	it('are stripped on export even with no steps chosen', () => {
		expect(applyCompileSteps(scene, [], { stage: 'scene' })).not.toContain('^pv-');
		expect(applyCompileSteps('x ^pv-abc123', [], { stage: 'manuscript' })).toBe('x');
	});

	it('never appear in an assembled manuscript', () => {
		const items: ManuscriptItem[] = [{ kind: 'scene', title: 'One', text: scene, number: '1', depth: 0, docPath: 'a.md' }];
		const md = assembleManuscript('Book', items, DEFAULT_MANUSCRIPT_OPTIONS);
		expect(md).toContain('She hid the key.');
		expect(md).not.toContain('^pv-');
	});

	it("also strip the writer's own block ids from exports, never footnotes", () => {
		expect(applyCompileSteps('x ^my-id', [], { stage: 'scene' })).toBe('x');
		const footnote = 'A note[^1].\n\n[^1]: Here.';
		expect(applyCompileSteps(footnote, [], { stage: 'scene' })).toBe(footnote);
	});

	it('are blanked for the Prose Coach without moving any offset', () => {
		const text = 'She hid it. ^pv-abc123\nNext line.';
		const masked = maskNonProse(text);
		expect(masked.length).toBe(text.length);
		expect(masked).not.toContain('pv-');
		expect(masked.indexOf('Next')).toBe(text.indexOf('Next'));
	});
});
