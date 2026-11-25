import { cardMarkerStages, markerLabel, linesKey, MarkerWords } from './card-marker';
import { SetupStage } from './setup-marks';

const line = (stage: SetupStage, name: string, written = false) => ({ stage, written, setup: { name } });
const words: MarkerWords = {
	planned: { planted: 'Plant planned', reminded: 'Reminder planned', 'paid-off': 'Payoff planned' },
	written: { planted: 'Planted', reminded: 'Reminded', 'paid-off': 'Paid off' },
};

describe('cardMarkerStages', () => {
	it('gives nothing for a card without plans', () => {
		expect(cardMarkerStages([])).toEqual([]);
	});
	it('shows one icon per stage, Plant → Remind → Pay off, however many setups', () => {
		const stages = cardMarkerStages([line('paid-off', 'Debt'), line('planted', 'Sword'), line('planted', 'Letter')]);
		expect(stages.map((s) => s.stage)).toEqual(['planted', 'paid-off']);
		expect(stages[0].planned).toEqual(['Sword', 'Letter']);
	});
	it('fills a stage only when every step of it is written in the scene', () => {
		const stages = cardMarkerStages([line('planted', 'Sword', true), line('planted', 'Letter'), line('reminded', 'Debt', true)]);
		expect(stages.find((s) => s.stage === 'planted')?.written).toBe(false);
		expect(stages.find((s) => s.stage === 'reminded')?.written).toBe(true);
		expect(stages[0].writtenNames).toEqual(['Sword']);
		expect(stages[0].planned).toEqual(['Letter']);
	});
});

describe('markerLabel', () => {
	it('names every setup, what is still planned first', () => {
		const stages = cardMarkerStages([line('planted', 'Sword', true), line('planted', 'Letter'), line('paid-off', 'Debt')]);
		expect(markerLabel(stages, words)).toBe('Plant planned: Letter · Planted: Sword · Payoff planned: Debt');
	});
	it('is empty for no plans', () => {
		expect(markerLabel([], words)).toBe('');
	});
});

describe('linesKey', () => {
	const id = (s: { name: string }) => `Codex/${s.name}.md`;
	it('is the same for the same plans and changes when one is written, renamed or removed', () => {
		const a = new Map([['c1', [line('planted', 'Sword')]]]);
		expect(linesKey(a, id)).toBe(linesKey(new Map([['c1', [line('planted', 'Sword')]]]), id));
		expect(linesKey(a, id)).not.toBe(linesKey(new Map([['c1', [line('planted', 'Sword', true)]]]), id));
		expect(linesKey(a, id)).not.toBe(linesKey(new Map([['c1', [line('planted', 'Blade')]]]), id));
		expect(linesKey(a, id)).not.toBe(linesKey(new Map(), id));
	});
	it('does not depend on the order cards were read in', () => {
		const one = new Map([['c1', [line('planted', 'Sword')]], ['c2', [line('reminded', 'Debt')]]]);
		const two = new Map([['c2', [line('reminded', 'Debt')]], ['c1', [line('planted', 'Sword')]]]);
		expect(linesKey(one, id)).toBe(linesKey(two, id));
	});
});
