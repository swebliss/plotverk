import { isPortraitKind, portraitCardText, PORTRAIT_KINDS } from './portrait-kinds';
import { CODEX_GROUPS } from './worldbuilding-kinds';

describe('isPortraitKind', () => {
	it('is true for characters, living creatures and every group kind', () => {
		for (const k of ['character', 'species', 'monster', 'faction', 'bloodline', 'government', 'military', 'social-class']) {
			expect(isPortraitKind(k)).toBe(true);
		}
	});

	it('leaves wildlife (plants too), illness, places and custom kinds as normal tiles', () => {
		for (const k of ['wildlife', 'illness', 'location', 'region', 'settlement', 'item', 'system', 'scene', 'event', 'my-custom-kind']) {
			expect(isPortraitKind(k)).toBe(false);
		}
	});

	it('covers the whole Groups & Factions group', () => {
		const groups = CODEX_GROUPS.find((g) => g.id === 'groups');
		expect(groups).toBeDefined();
		for (const k of groups?.kinds ?? []) expect(isPortraitKind(k)).toBe(true);
	});

	it('only names kinds that exist in the Codex', () => {
		const known = new Set(CODEX_GROUPS.flatMap((g) => g.kinds));
		for (const k of PORTRAIT_KINDS) expect(known.has(k)).toBe(true);
	});
});

describe('portraitCardText', () => {
	it('uses Type as the subtitle and the other facts as rows', () => {
		const out = portraitCardText('Shade Wolf', [
			{ key: 'Type', value: 'Predator' },
			{ key: 'Habitat', value: 'Ashwood' },
			{ key: 'Threat Level', value: 'Deadly' },
		]);
		expect(out.subtitle).toBe('Predator');
		expect(out.rows).toEqual([
			{ key: 'Habitat', value: 'Ashwood' },
			{ key: 'Threat Level', value: 'Deadly' },
		]);
	});

	it('uses a government Form or a class Rank as the subtitle, any capitals', () => {
		expect(portraitCardText('The Crown', [{ key: 'Form', value: 'Monarchy' }]).subtitle).toBe('Monarchy');
		expect(portraitCardText('Serfs', [{ key: 'rank', value: 'Bottom' }]).subtitle).toBe('Bottom');
		expect(portraitCardText('Orcs', [{ key: 'type', value: 'Brute' }]).rows).toEqual([]);
	});

	it('leaves religion as a normal tile (not in the creatures or groups lists)', () => {
		expect(isPortraitKind('religion')).toBe(false);
	});

	it('has no subtitle without a Type fact', () => {
		const out = portraitCardText('Elves', [{ key: 'Homeland', value: 'The Vale' }]);
		expect(out.subtitle).toBe('');
		expect(out.rows).toEqual([{ key: 'Homeland', value: 'The Vale' }]);
	});

	it('drops facts that only repeat the name, and blank values', () => {
		const out = portraitCardText('House Varn', [
			{ key: 'Family Name', value: 'house varn' },
			{ key: 'Seat', value: '  ' },
			{ key: 'Status', value: 'Exiled' },
		]);
		expect(out.rows).toEqual([{ key: 'Status', value: 'Exiled' }]);
	});

	it('shows nothing for an entry with no facts', () => {
		expect(portraitCardText('Empty', [])).toEqual({ subtitle: '', rows: [] });
	});
});
