import { isFromNewerPlotverk, isWholeGrid, isWholeTimeline, keepIfEmptied } from './write-guard';

describe('isFromNewerPlotverk', () => {
	it('treats every file written so far as ours', () => {
		expect(isFromNewerPlotverk(1)).toBe(false);
		expect(isFromNewerPlotverk(undefined)).toBe(false);
		expect(isFromNewerPlotverk('2')).toBe(false);
		expect(isFromNewerPlotverk(NaN)).toBe(false);
	});
	it('spots a file from a newer Plotverk', () => {
		expect(isFromNewerPlotverk(2)).toBe(true);
		expect(isFromNewerPlotverk(1.5)).toBe(true);
	});
});

describe('keepIfEmptied', () => {
	it('keeps the old text when a change would empty the page', () => {
		expect(keepIfEmptied('Chapter one', '')).toEqual({ text: 'Chapter one', kept: true });
		expect(keepIfEmptied('Chapter one', '  \n ')).toEqual({ text: 'Chapter one', kept: true });
	});
	it('lets every normal change through', () => {
		expect(keepIfEmptied('a', 'b')).toEqual({ text: 'b', kept: false });
		expect(keepIfEmptied('', '')).toEqual({ text: '', kept: false });
		expect(keepIfEmptied('  ', '')).toEqual({ text: '', kept: false });
		expect(keepIfEmptied('', 'new')).toEqual({ text: 'new', kept: false });
	});
});

describe('isWholeGrid', () => {
	it('accepts a real grid, even an empty one', () => {
		expect(isWholeGrid({ version: 1, rows: [], columns: [], cards: [] })).toBe(true);
	});
	it('refuses a grid that came out broken', () => {
		expect(isWholeGrid(null)).toBe(false);
		expect(isWholeGrid({ rows: [], columns: [] })).toBe(false);
		expect(isWholeGrid({ rows: [], columns: [], cards: {} })).toBe(false);
		expect(isWholeGrid([])).toBe(false);
	});
});

describe('isWholeTimeline', () => {
	const tl = { version: 1, name: 'T', calendar: {}, plotlines: [], eventDisplay: {}, loops: [], sceneDates: {}, links: [], viewSettings: {} };
	it('accepts a real timeline', () => {
		expect(isWholeTimeline(tl)).toBe(true);
	});
	it('accepts an older timeline that lacks the later parts', () => {
		expect(isWholeTimeline({ version: 1, name: 'Old', calendar: {}, plotlines: [] })).toBe(true);
	});
	it('refuses a timeline that came out broken', () => {
		expect(isWholeTimeline({ ...tl, plotlines: undefined })).toBe(false);
		expect(isWholeTimeline({ ...tl, calendar: null })).toBe(false);
		expect(isWholeTimeline(undefined)).toBe(false);
	});
});
