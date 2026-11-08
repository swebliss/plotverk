import { computeWindow, WindowInput } from './virtual-window';

const base: WindowInput = {
	scrollTop: 0,
	viewportH: 400,
	itemH: 40,
	count: 100,
	overscan: 0,
};

describe('computeWindow — empty & degenerate', () => {
	test('empty list → endIndex -1, no padding', () => {
		expect(computeWindow({ ...base, count: 0 })).toEqual({
			startIndex: 0,
			endIndex: -1,
			padTop: 0,
			padBottom: 0,
		});
	});

	test('zero item height → render everything (no divide-by-zero)', () => {
		const r = computeWindow({ ...base, itemH: 0 });
		expect(r).toEqual({ startIndex: 0, endIndex: 99, padTop: 0, padBottom: 0 });
	});

	test('negative item height → render everything', () => {
		const r = computeWindow({ ...base, itemH: -10 });
		expect(r).toEqual({ startIndex: 0, endIndex: 99, padTop: 0, padBottom: 0 });
	});
});

describe('computeWindow — single column', () => {
	test('top of list, no overscan → first slice only', () => {
		// viewport 400 / itemH 40 = rows 0..10 (lastVisibleRow = floor(400/40)=10)
		const r = computeWindow(base);
		expect(r.startIndex).toBe(0);
		expect(r.endIndex).toBe(10);
		expect(r.padTop).toBe(0);
		// rows 11..99 un-rendered below → 89 rows * 40
		expect(r.padBottom).toBe(89 * 40);
	});

	test('mid-scroll slice + spacers reconstruct full height', () => {
		// scrollTop 800 → firstVisibleRow 20, lastVisibleRow floor(1200/40)=30
		const r = computeWindow({ ...base, scrollTop: 800 });
		expect(r.startIndex).toBe(20);
		expect(r.endIndex).toBe(30);
		expect(r.padTop).toBe(20 * 40);
		expect(r.padBottom).toBe((99 - 30) * 40);
		// invariant: padTop + rendered-rows*itemH + padBottom === total height
		const renderedRows = r.endIndex - r.startIndex + 1;
		expect(r.padTop + renderedRows * 40 + r.padBottom).toBe(100 * 40);
	});

	test('overscan extends the slice both directions and clamps at edges', () => {
		const r = computeWindow({ ...base, scrollTop: 800, overscan: 3 });
		expect(r.startIndex).toBe(17); // 20 - 3
		expect(r.endIndex).toBe(33); // 30 + 3
	});

	test('overscan clamps to 0 at the top', () => {
		const r = computeWindow({ ...base, overscan: 5 });
		expect(r.startIndex).toBe(0);
		expect(r.padTop).toBe(0);
	});

	test('overscan clamps to last index at the bottom', () => {
		// scroll near the end
		const r = computeWindow({ ...base, scrollTop: 100 * 40 - 400, overscan: 5 });
		expect(r.endIndex).toBe(99);
		expect(r.padBottom).toBe(0);
	});

	test('negative scrollTop (overscroll bounce) clamps to top', () => {
		const r = computeWindow({ ...base, scrollTop: -120 });
		expect(r.startIndex).toBe(0);
		expect(r.padTop).toBe(0);
	});

	test('default overscan is 3 when omitted', () => {
		const r = computeWindow({ scrollTop: 800, viewportH: 400, itemH: 40, count: 100 });
		expect(r.startIndex).toBe(17);
		expect(r.endIndex).toBe(33);
	});
});

describe('computeWindow — multi-column grid', () => {
	test('columns group items per visual row', () => {
		// 100 items, 3 columns → 34 visual rows. itemH 40, viewport 400.
		// lastVisibleRow = floor(400/40)=10 → rows 0..10 → items 0..(11*3-1)=32
		const r = computeWindow({ ...base, columns: 3 });
		expect(r.startIndex).toBe(0);
		expect(r.endIndex).toBe(32);
		expect(r.padTop).toBe(0);
		const totalRows = Math.ceil(100 / 3); // 34
		expect(r.padBottom).toBe((totalRows - 1 - 10) * 40);
	});

	test('mid-scroll grid endIndex clamps to count-1 on the last partial row', () => {
		// 100 items / 3 cols = 34 rows (last row holds item 99 only).
		// scroll to the very bottom.
		const totalRows = Math.ceil(100 / 3);
		const r = computeWindow({ ...base, columns: 3, scrollTop: totalRows * 40 - 400, overscan: 2 });
		expect(r.endIndex).toBe(99);
		expect(r.padBottom).toBe(0);
	});

	test('grid spacers + rendered rows reconstruct full scroll height', () => {
		const columns = 4;
		const count = 250;
		const itemH = 60;
		const totalRows = Math.ceil(count / columns);
		const r = computeWindow({ scrollTop: 1500, viewportH: 500, itemH, count, columns, overscan: 2 });
		const renderedRows = Math.ceil((r.endIndex - r.startIndex + 1) / columns);
		expect(r.padTop + renderedRows * itemH + r.padBottom).toBe(totalRows * itemH);
	});
});
