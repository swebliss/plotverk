import type { GridRow, SceneCard, StorygridTemplate } from '../grid-data';
import { beatGuideFor, beatGuideFromGrid, beatWhere, findTemplate, guideColumnIds, isBookPosition } from './beat-guide';
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

describe('beatGuideFromGrid', () => {
	const rows = [
		{ id: 'r2', label: 'End', order: 1 },
		{ id: 'r1', label: 'Start', order: 0 },
	] as GridRow[];
	const card = (over: Partial<SceneCard>): SceneCard => ({ id: 'c', rowId: 'r1', colId: 'g', title: '', ...over } as SceneCard);

	it('reads the rows in order with each guide card’s title as where it falls', () => {
		const cards = [card({ rowId: 'r1', title: ' ~4% ', guide: true }), card({ rowId: 'r2', colId: 'hero', title: 'Not a guide' })];
		expect(beatGuideFromGrid(rows, cards)).toEqual({
			name: '',
			beats: [{ where: '~4%', label: 'Start' }, { where: '', label: 'End' }],
		});
	});

	it('gives nothing when the grid has no guide cards', () => {
		expect(beatGuideFromGrid(rows, [card({})])).toBeNull();
		expect(beatGuideFromGrid(rows, [])).toBeNull();
	});
});

describe('guideColumnIds', () => {
	it('finds the columns holding guide cards', () => {
		const cards = [
			{ id: 'a', rowId: 'r', colId: 'g', guide: true },
			{ id: 'b', rowId: 'r', colId: 'hero' },
		] as SceneCard[];
		expect([...guideColumnIds(cards)]).toEqual(['g']);
		expect(guideColumnIds([]).size).toBe(0);
	});
});

describe('isBookPosition', () => {
	it('is true for a place in the book', () => {
		for (const s of ['~10%', '0–1%', '99–100%', '10 – 20 %', '~4 %']) expect(isBookPosition(s)).toBe(true);
	});

	it('is false for other titles', () => {
		for (const s of ['', 'Catalyst', '%', 'Act one']) expect(isBookPosition(s)).toBe(false);
		expect(isBookPosition(undefined)).toBe(false);
		expect(isBookPosition(10)).toBe(false);
	});
});
