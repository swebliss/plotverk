import { crowdedLabelIds, labelBox } from './timeline-layout';

describe('labelBox', () => {
	it('centers horizontal labels on the anchor, above or below it', () => {
		const above = labelBox({ x: 100, y: 50 }, 'abcde', 10, 'centered-above');
		expect(above).toEqual({ x: 85, y: 40, width: 30, height: 10 });
		const below = labelBox({ x: 100, y: 50 }, 'abcde', 10, 'centered-below');
		expect(below.y).toBe(50);
	});
	it('grows sideways for beside labels', () => {
		expect(labelBox({ x: 100, y: 50 }, 'abcde', 10, 'beside-left').x).toBe(70);
		expect(labelBox({ x: 100, y: 50 }, 'abcde', 10, 'beside-right').x).toBe(100);
	});
	it('runs along the axis for rotated labels', () => {
		const r = labelBox({ x: 100, y: 50 }, 'abcde', 10, 'rotated-right');
		expect(r).toEqual({ x: 100, y: 35, width: 10, height: 30 });
	});
});

describe('crowdedLabelIds', () => {
	const box = (x: number) => ({ x, y: 0, width: 10, height: 10 });

	it('hides nothing when everything has room', () => {
		expect(crowdedLabelIds([{ id: 'a', box: box(0) }, { id: 'b', box: box(20) }], 2).size).toBe(0);
	});
	it('keeps the earlier label and hides the one that would overlap it', () => {
		const hidden = crowdedLabelIds([{ id: 'a', box: box(0) }, { id: 'b', box: box(5) }], 2);
		expect([...hidden]).toEqual(['b']);
	});
	it('counts the gap as part of the overlap', () => {
		expect(crowdedLabelIds([{ id: 'a', box: box(0) }, { id: 'b', box: box(11) }], 2).has('b')).toBe(true);
	});
	it('a hidden label does not block a later one (every Nth survives)', () => {
		const hidden = crowdedLabelIds(
			[{ id: 'a', box: box(0) }, { id: 'b', box: box(6) }, { id: 'c', box: box(13) }],
			2,
		);
		expect([...hidden]).toEqual(['b']);
	});
	it('labels on different rows never clash', () => {
		const hidden = crowdedLabelIds(
			[{ id: 'a', box: box(0) }, { id: 'b', box: { x: 0, y: 30, width: 10, height: 10 } }],
			2,
		);
		expect(hidden.size).toBe(0);
	});
	it('never lets a label cover an obstacle (a badge), and never hides the obstacle itself', () => {
		const badge = { x: 30, y: 0, width: 10, height: 10 };
		const hidden = crowdedLabelIds([{ id: 'a', box: box(0) }, { id: 'b', box: box(28) }], 2, [badge]);
		expect([...hidden]).toEqual(['b']);
	});
});
