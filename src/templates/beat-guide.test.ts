import type { StorygridTemplate } from '../grid-data';
import { beatGuideFor, beatWhere, findTemplate } from './beat-guide';
import { getTemplateById } from './story-templates';

const custom = (over: Partial<StorygridTemplate>): StorygridTemplate => ({
	id: 'custom-1',
	name: 'My layout',
	description: '',
	rows: [{ label: 'Start' }, { label: 'End' }],
	columns: [{ label: 'Hero' }],
	...over,
} as StorygridTemplate);

describe('findTemplate', () => {
	it('finds a built-in template by id', () => {
		expect(findTemplate('save-the-cat', [])?.id).toBe('save-the-cat');
	});

	it('falls back to the writer’s saved templates', () => {
		const mine = custom({});
		expect(findTemplate('custom-1', [mine])).toBe(mine);
	});

	it('prefers the built-in template when a saved one has the same id', () => {
		const clash = custom({ id: 'save-the-cat', name: 'Imposter' });
		expect(findTemplate('save-the-cat', [clash])).toBe(getTemplateById('save-the-cat'));
	});

	it('finds nothing for no id, an unknown id, or a broken saved list', () => {
		expect(findTemplate(undefined, [])).toBeUndefined();
		expect(findTemplate('', [])).toBeUndefined();
		expect(findTemplate('gone', [custom({})])).toBeUndefined();
		expect(findTemplate('custom-1', undefined)).toBeUndefined();
		expect(findTemplate('custom-1', 'junk' as unknown as StorygridTemplate[])).toBeUndefined();
	});
});

describe('beatWhere', () => {
	it('takes the text before " · "', () => {
		expect(beatWhere('~10% · A life-changing event')).toBe('~10%');
		expect(beatWhere('0–1% · A snapshot')).toBe('0–1%');
	});

	it('is empty when there is no "where" part', () => {
		expect(beatWhere('Just guide text')).toBe('');
		expect(beatWhere(' · starts with the separator')).toBe('');
		expect(beatWhere(undefined)).toBe('');
		expect(beatWhere(42)).toBe('');
	});
});

describe('beatGuideFor', () => {
	it('lists every Save the Cat beat in order, with where it falls', () => {
		const guide = beatGuideFor('save-the-cat', [])!;
		const tpl = getTemplateById('save-the-cat')!;
		expect(guide.name).toBe(tpl.name);
		expect(guide.beats).toHaveLength(tpl.rows.length);
		expect(guide.beats[0]).toEqual({ where: '0–1%', label: 'Opening Image' });
		expect(guide.beats[3]).toEqual({ where: '~10%', label: 'Catalyst' });
		expect(guide.beats[guide.beats.length - 1]).toEqual({ where: '99–100%', label: 'Final Image' });
	});

	it('gives every built-in template with guide text a guide', () => {
		expect(beatGuideFor('default-storygrid', [])?.beats.length).toBeGreaterThan(0);
	});

	it('gives nothing for the blank grid, no template, or an unknown one', () => {
		expect(beatGuideFor('clean-start', [])).toBeNull();
		expect(beatGuideFor(undefined, [])).toBeNull();
		expect(beatGuideFor('gone', [])).toBeNull();
	});

	it('gives nothing for a saved template without guide text', () => {
		expect(beatGuideFor('custom-1', [custom({})])).toBeNull();
		expect(beatGuideFor('custom-1', [custom({ rows: [{ label: 'A', hint: '   ' }] as StorygridTemplate['rows'] })])).toBeNull();
	});

	it('uses a saved template’s guide text, keeping beats without it', () => {
		const mine = custom({ rows: [{ label: 'Start', hint: '0% · Open' }, { label: 'End' }] as StorygridTemplate['rows'] });
		expect(beatGuideFor('custom-1', [mine])).toEqual({
			name: 'My layout',
			beats: [{ where: '0%', label: 'Start' }, { where: '', label: 'End' }],
		});
	});

	it('survives a hand-edited saved template with broken rows', () => {
		const broken = custom({ name: undefined as unknown as string, rows: [null, { label: 7, hint: 'x · y' }] as unknown as StorygridTemplate['rows'] });
		expect(beatGuideFor('custom-1', [broken])).toEqual({ name: '', beats: [{ where: '', label: '' }, { where: 'x', label: '' }] });
		expect(beatGuideFor('custom-1', [custom({ rows: 'junk' as unknown as StorygridTemplate['rows'] })])).toBeNull();
	});
});
