import { chapterNumbers, markChapter, summarizeSetup, chaptersQuiet, compareForBoard, stageProgress, realizedHere, setupsOnCard, PlaceLookups } from './book-order';
import { SetupMark } from './setup-marks';

const chapters = chapterNumbers(['Book/Scenes/One.md', 'Book/Scenes/Two.md', 'Book/Scenes/Three.md', 'Book/Scenes/Four.md']);
const lk: PlaceLookups = {
	anchorPath: (a) => ({ 'pv-aaaaaa': 'Book/Scenes/One.md', 'pv-bbbbbb': 'Book/Scenes/Three.md', 'pv-cccccc': 'Book/Scenes/Four.md', 'pv-dddddd': 'Book/Scenes/Two.md' } as Record<string, string>)[a] ?? null,
	cardScene: (g, c) => (g === 'g1' ? ({ c1: 'Book/Scenes/Two.md', c2: 'Book/Scenes/Four.md' } as Record<string, string>)[c] ?? null : null),
	entityScenes: (id) => (id === 'sg_event' ? ['Book/Scenes/Four.md', 'Book/Scenes/Two.md', 'Notes/x.md'] : []),
	chapterOf: (p) => chapters.get(p) ?? null,
};
const text = (stage: SetupMark['stage'], anchor: string): SetupMark => ({ stage, target: { kind: 'text', anchor }, quote: '' });
const card = (stage: SetupMark['stage'], cardId = 'c1', quote = 'The market'): SetupMark => ({ stage, target: { kind: 'card', gridId: 'g1', cardId }, quote });

describe('chapters', () => {
	it('numbers scenes from 1 in book order', () => {
		expect(chapters.get('Book/Scenes/Three.md')).toBe(3);
	});
	it('finds a mark through text, card or Codex sheet', () => {
		expect(markChapter(text('planted', 'pv-bbbbbb'), lk)).toBe(3);
		expect(markChapter({ stage: 'planted', target: { kind: 'card', gridId: 'g1', cardId: 'c1' }, quote: '' }, lk)).toBe(2);
		// An event: the first chapter that links to it.
		expect(markChapter({ stage: 'planted', target: { kind: 'entity', entityId: 'sg_event' }, quote: '' }, lk)).toBe(2);
		expect(markChapter(text('planted', 'pv-gone00'), lk)).toBeNull();
	});
});

describe('summarizeSetup', () => {
	it('uses the mark that put it in its stage', () => {
		const marks = [text('planted', 'pv-aaaaaa'), text('reminded', 'pv-bbbbbb'), text('reminded', 'pv-cccccc')];
		const s = summarizeSetup(marks, 'reminded', lk);
		expect(s).toEqual({ stageChapter: 4, plantedChapter: 1, lastChapter: 4, previousStage: 'planted', writtenYet: true, nextPlan: null });
		expect(summarizeSetup([text('planted', 'pv-aaaaaa'), text('paid-off', 'pv-cccccc')], 'paid-off', lk).previousStage).toBe('planted');
		expect(summarizeSetup(marks.concat(text('paid-off', 'pv-cccccc')), 'paid-off', lk).previousStage).toBe('reminded');
	});
	it('counts quiet chapters; never guesses an unplaced setup', () => {
		const s = summarizeSetup([text('planted', 'pv-aaaaaa')], 'planted', lk);
		expect(chaptersQuiet(s, 4)).toBe(3);
		expect(chaptersQuiet(summarizeSetup([], 'planted', lk), 4)).toBeNull();
	});
	it('sorts by chapter, unplaced last, then by name', () => {
		const mk = (name: string, ch: number | null) => ({ name, summary: { stageChapter: ch, plantedChapter: ch, lastChapter: ch, previousStage: null, writtenYet: true, nextPlan: null } });
		const list = [mk('b', null), mk('z', 2), mk('a', null), mk('y', 1)].sort(compareForBoard);
		expect(list.map((x) => x.name)).toEqual(['y', 'z', 'a', 'b']);
	});
});

describe('planned vs written', () => {
	it('splits each stage into planned places (cards, events) and written places (text)', () => {
		const p = stageProgress([text('planted', 'pv-aaaaaa'), card('paid-off'), card('planted')]);
		expect(p.planted.written).toHaveLength(1);
		expect(p.planted.planned).toHaveLength(1);
		expect(p.planted.realized).toBe(true);
		expect(p['paid-off'].planned).toHaveLength(1);
		expect(p['paid-off'].realized).toBe(false);
		expect(p.reminded).toEqual({ planned: [], written: [], realized: false });
		const ev: SetupMark = { stage: 'reminded', target: { kind: 'entity', entityId: 'sg_event' }, quote: 'The duel' };
		expect(stageProgress([ev]).reminded.planned).toEqual([ev]);
	});
	it('a plan is realized here when its stage is written in the scene the card links to', () => {
		const plan = card('paid-off');
		expect(realizedHere(plan, [plan, text('paid-off', 'pv-dddddd')], lk)).toBe(true);
		// Written, but in another scene.
		expect(realizedHere(plan, [plan, text('paid-off', 'pv-cccccc')], lk)).toBe(false);
		// The right scene, another stage.
		expect(realizedHere(plan, [plan, text('reminded', 'pv-dddddd')], lk)).toBe(false);
		// A card with no scene is never realized here.
		expect(realizedHere(card('paid-off', 'c9'), [text('paid-off', 'pv-dddddd')], lk)).toBe(false);
		// A written mark is not a plan.
		expect(realizedHere(text('paid-off', 'pv-dddddd'), [text('paid-off', 'pv-dddddd')], lk)).toBe(false);
	});
	it('chapters come from the text; the next plan is the nearest stage not written yet', () => {
		const s = summarizeSetup([text('planted', 'pv-aaaaaa'), card('paid-off', 'c2', 'The duel')], 'planted', lk);
		expect(s).toMatchObject({ stageChapter: 1, plantedChapter: 1, lastChapter: 1, writtenYet: true });
		expect(s.nextPlan).toEqual({ stage: 'paid-off', chapter: 4, label: 'The duel' });
		const near = summarizeSetup([text('planted', 'pv-aaaaaa'), card('reminded'), card('paid-off', 'c2')], 'planted', lk);
		expect(near.nextPlan?.stage).toBe('reminded');
		// A reminder already written: the next plan is the payoff, even with a reminder plan left over.
		const on = summarizeSetup([text('planted', 'pv-aaaaaa'), text('reminded', 'pv-bbbbbb'), card('reminded'), card('paid-off', 'c2')], 'reminded', lk);
		expect(on.nextPlan?.stage).toBe('paid-off');
		expect(on.lastChapter).toBe(3);
	});
	it('a setup with only plans: nothing written, the plant plan comes first', () => {
		const s = summarizeSetup([card('paid-off', 'c2'), card('planted')], 'planted', lk);
		expect(s).toMatchObject({ stageChapter: null, plantedChapter: null, lastChapter: null, writtenYet: false });
		expect(s.nextPlan).toEqual({ stage: 'planted', chapter: 2, label: 'The market' });
		expect(chaptersQuiet(s, 4)).toBeNull();
	});
	it('picks the earliest placed plan of a stage; none once paid off or let go', () => {
		const s = summarizeSetup([text('planted', 'pv-aaaaaa'), card('paid-off', 'c9', 'Nowhere yet'), card('paid-off', 'c2', 'The duel')], 'planted', lk);
		expect(s.nextPlan).toEqual({ stage: 'paid-off', chapter: 4, label: 'The duel' });
		const unplaced = summarizeSetup([text('planted', 'pv-aaaaaa'), card('paid-off', 'c9', 'Nowhere yet')], 'planted', lk);
		expect(unplaced.nextPlan).toEqual({ stage: 'paid-off', chapter: null, label: 'Nowhere yet' });
		expect(summarizeSetup([text('paid-off', 'pv-cccccc'), card('paid-off', 'c2')], 'paid-off', lk).nextPlan).toBeNull();
		expect(summarizeSetup([text('planted', 'pv-aaaaaa'), card('paid-off', 'c2')], 'let-go', lk).nextPlan).toBeNull();
	});
});

describe('setups on a card', () => {
	const a = { name: 'The sword', marks: [card('planted'), text('planted', 'pv-dddddd'), card('paid-off', 'c2')] };
	const b = { name: 'The letter', marks: [card('paid-off'), text('planted', 'pv-aaaaaa')] };
	const c = { name: 'Elsewhere', marks: [text('reminded', 'pv-dddddd')] };
	it('lists every plan on the card: stage order, then name; written when realized in its scene', () => {
		const lines = setupsOnCard([a, b, c], 'g1', 'c1', lk);
		expect(lines.map((l) => [l.setup.name, l.stage, l.written])).toEqual([
			['The sword', 'planted', true],
			['The letter', 'paid-off', false],
		]);
		expect(setupsOnCard([a, b, c], 'g1', 'c2', lk).map((l) => l.setup.name)).toEqual(['The sword']);
		expect(setupsOnCard([a, b, c], 'g2', 'c1', lk)).toEqual([]);
	});
});
