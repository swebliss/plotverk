import { linkWords, nameAfterCursor, orderByScore, orderWithoutQuery } from './suggest-order';

const e = (name: string, kind: string) => ({ name, kind });

describe('@ list order', () => {
	it('shows characters first, then the rest, each alphabetical, before anything is typed', () => {
		const out = orderWithoutQuery([e('Wharf Guild', 'faction'), e('Tobin', 'character'), e('Crane Yard', 'settlement'), e('Mara', 'character')]);
		expect(out.map((x) => x.name)).toEqual(['Mara', 'Tobin', 'Crane Yard', 'Wharf Guild']);
	});

	it('items come right after characters', () => {
		const out = orderWithoutQuery([e('Wharf Guild', 'faction'), e('Lantern', 'item'), e('Tobin', 'character')]);
		expect(out.map((x) => x.name)).toEqual(['Tobin', 'Lantern', 'Wharf Guild']);
	});

	it('finds a name already written after the @, any case, at a word edge', () => {
		const names = ['Halvard Crane', 'Halvard', 'Crane Yard'];
		expect(nameAfterCursor('Halvard Crane said no.', names)).toBe('Halvard Crane');
		expect(nameAfterCursor('halvard crane said', names)).toBe('halvard crane');
		expect(nameAfterCursor('Halvardson left', names)).toBeNull();
		expect(nameAfterCursor('', names)).toBeNull();
	});

	describe('the words the link shows', () => {
		const aliases = ['Dad', 'Andreas'];
		it('the name itself (any case) stays a bare name, so a rename in the Codex changes the text', () => {
			expect(linkWords('Mr Gibbins', 'Mr Gibbins', aliases, null)).toBe('Mr Gibbins');
			expect(linkWords('mr gibbins', 'Mr Gibbins', aliases, null)).toBe('Mr Gibbins');
			expect(linkWords('gib', 'Mr Gibbins', aliases, null)).toBe('Mr Gibbins');
			expect(linkWords('', 'Mr Gibbins', aliases, null)).toBe('Mr Gibbins');
		});
		it('an alias written in full keeps the writer\'s own word, never the name', () => {
			expect(linkWords('Dad', 'Mr Gibbins', aliases, 'Dad')).toBe('Dad');
			expect(linkWords('dad', 'Mr Gibbins', aliases, null)).toBe('dad');
		});
		it('a few letters that found him through an alias give that alias', () => {
			expect(linkWords('andr', 'Mr Gibbins', aliases, 'Andreas')).toBe('Andreas');
		});
	});

	it('puts a character ahead of an equally good match while typing', () => {
		const out = orderByScore([
			{ entity: e('Mara Docks', 'settlement'), score: -1 },
			{ entity: e('Mara Ferrow', 'character'), score: -1 },
		]);
		expect(out.map((x) => x.name)).toEqual(['Mara Ferrow', 'Mara Docks']);
	});

	it('a much better match still wins over a character', () => {
		const out = orderByScore([
			{ entity: e('Marsh', 'settlement'), score: -0.1 },
			{ entity: e('Mara Ferrow', 'character'), score: -3 },
		]);
		expect(out.map((x) => x.name)).toEqual(['Marsh', 'Mara Ferrow']);
	});
});
