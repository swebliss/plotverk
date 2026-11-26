import { placeInfoBox } from './info-popover';

const screen = { left: 8, top: 52, right: 382, bottom: 770 }; // a phone: notch at the top, home bar at the bottom
const at = (left: number, top: number) => ({ left, top, right: left + 16, bottom: top + 16 });

describe('placeInfoBox', () => {
	it('sits under the "i" when it fits, starting just left of it', () => {
		const p = placeInfoBox(at(100, 200), { width: 200, height: 180 }, screen);
		expect(p.above).toBe(false);
		expect(p.top).toBe(224);
		expect(p.left).toBe(86);
		expect(p.arrowLeft).toBe(22);
		expect(p.maxHeight).toBe(770 - 216 - 8);
	});

	it('goes above when there is more room there and it does not fit below', () => {
		const p = placeInfoBox(at(100, 700), { width: 300, height: 180 }, screen);
		expect(p.above).toBe(true);
		expect(p.top).toBe(700 - 8 - 180);
	});

	it('stays below and lets the text scroll when neither side has room for all of it', () => {
		const p = placeInfoBox(at(100, 300), { width: 300, height: 900 }, screen);
		expect(p.above).toBe(false); // 446px below beats 240px above
		expect(p.top).toBe(324);
		expect(p.maxHeight).toBe(446);
	});

	it('slides left to stay inside the right edge, the arrow still pointing at the "i"', () => {
		const p = placeInfoBox(at(350, 200), { width: 300, height: 100 }, screen);
		expect(p.left).toBe(382 - 300);
		expect(p.arrowLeft).toBe(358 - 82);
	});

	it('never starts left of the safe area, and keeps the arrow off the corners', () => {
		const p = placeInfoBox(at(0, 200), { width: 300, height: 100 }, screen);
		expect(p.left).toBe(8);
		expect(p.arrowLeft).toBe(14);
	});

	it('never leaves the notch or the home bar', () => {
		const below = placeInfoBox(at(100, 200), { width: 300, height: 100 }, screen);
		expect(below.top).toBeGreaterThanOrEqual(screen.top);
		const above = placeInfoBox(at(100, 740), { width: 300, height: 600 }, screen);
		expect(above.top).toBeGreaterThanOrEqual(screen.top);
		expect(above.top + Math.min(600, above.maxHeight)).toBeLessThanOrEqual(740);
	});
});
