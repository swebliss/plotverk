import { buildNamePatterns, countNameMentions } from './name-presence';

const cast = [
	{ path: 'C/Mara Ferrow.md', names: ['Mara Ferrow', 'Mara Ferrow'] },
	{ path: 'C/Tobin Ferrow.md', names: ['Tobin Ferrow'] },
	{ path: 'C/Bex Ferrow-Tull.md', names: ['Bex Ferrow-Tull'] },
	{ path: 'C/Grandmother Tull.md', names: ['Grandmother Tull'] },
	{ path: 'C/Captain Yorrin Pike.md', names: ['Captain Yorrin Pike'] },
	{ path: 'C/Halvard Crane.md', names: ['Halvard Crane', 'Old Hal'] },
];
const patterns = buildNamePatterns(cast);
const count = (text: string) => countNameMentions(text, patterns);

describe('countNameMentions', () => {
	test('a unique first name counts; a shared surname alone does not', () => {
		expect(count('Mara dived. Tobin waited. The Ferrow house was dark.')).toEqual({
			'C/Mara Ferrow.md': 1,
			'C/Tobin Ferrow.md': 1,
		});
	});

	test('a full name is one mention, not two', () => {
		expect(count('Mara Ferrow came up. Then Tobin Ferrow.')).toEqual({ 'C/Mara Ferrow.md': 1, 'C/Tobin Ferrow.md': 1 });
	});

	test('possessives, straight and curly', () => {
		expect(count("Mara's lamp. Mara’s hose. Pike’s boat.")).toEqual({ 'C/Mara Ferrow.md': 2, 'C/Captain Yorrin Pike.md': 1 });
	});

	test('a unique surname counts; a title never does', () => {
		expect(count('Pike laughed. The Captain said nothing. Yorrin left.')).toEqual({ 'C/Captain Yorrin Pike.md': 2 });
		expect(count('Grandmother waited.')).toEqual({});
		expect(count('Tull waited.')).toEqual({ 'C/Grandmother Tull.md': 1 });
	});

	test('a hyphenated name is one word: "Ferrow-Tull" is Bex, not Grandmother Tull', () => {
		expect(count('Bex Ferrow-Tull ran. Ferrow-Tull’s boots.')).toEqual({ 'C/Bex Ferrow-Tull.md': 2 });
	});

	test('whole words only, and a lowercase word is not a name', () => {
		expect(count('Marabou. Pikestaff. The crane lifted the hull.')).toEqual({});
		expect(count('Crane bought the charts.')).toEqual({ 'C/Halvard Crane.md': 1 });
	});

	test('aliases from the Codex sheet count', () => {
		expect(count('Old Hal grinned.')).toEqual({ 'C/Halvard Crane.md': 1 });
	});

	test('frontmatter, comments and code are skipped', () => {
		const text = ['---', 'pov: Mara', '---', '%% Mara note %%', '<!-- Mara -->', '`Mara`', '```', 'Mara', '```', 'Then Tobin.'].join('\n');
		expect(count(text)).toEqual({ 'C/Tobin Ferrow.md': 1 });
	});

	test('a beat heading inside a scene names who is in it', () => {
		expect(count('## Mara asks Pike about the date\n\nShort summary.')).toEqual({ 'C/Mara Ferrow.md': 1, 'C/Captain Yorrin Pike.md': 1 });
	});

	test('a link names its note once — the alias, folder and heading are not counted again', () => {
		expect(count('[[Mara Ferrow]] and [[C/Tobin Ferrow#Early|Tobin]].')).toEqual({ 'C/Mara Ferrow.md': 1, 'C/Tobin Ferrow.md': 1 });
		expect(count('![[Mara Ferrow.png]]')).toEqual({});
	});

	test('another Codex name wins: "Crane Yard" and "Roke’s Clinic" are places', () => {
		const p = buildNamePatterns(
			[{ path: 'Crane', names: ['Halvard Crane'] }, { path: 'Roke', names: ['Doctor Ansel Roke'] }],
			['Crane Yard', 'Roke’s Clinic', 'Crane']
		);
		expect(countNameMentions('They walked to Crane Yard. Roke’s Clinic was shut.', p)).toEqual({});
		expect(countNameMentions('Crane laughed. Roke’s hands shook.', p)).toEqual({ Crane: 1, Roke: 1 });
	});

	test('initials and articles never stand for a character', () => {
		const p = buildNamePatterns([{ path: 'Moss', names: ['A. J. Moss'] }, { path: 'Zorro', names: ['El Zorro'] }]);
		expect(countNameMentions('A boat came. J waved. El perro ladra.', p)).toEqual({});
		expect(countNameMentions('Moss smiled at Zorro.', p)).toEqual({ Moss: 1, Zorro: 1 });
	});

	test('a lowercase name or alias that is an ordinary word never matches lowercase prose', () => {
		const p = buildNamePatterns([{ path: 'H', names: ['bell hooks'] }, { path: 'B', names: ['Tam Reed', 'the boy'] }]);
		expect(countNameMentions('The bell rang. She hooks the line. A boy ran past, the boy.', p)).toEqual({});
	});

	test('a lowercase Codex name may start lowercase in prose; accents match either way', () => {
		const p = buildNamePatterns([{ path: 'D', names: ["d'Artagnan"] }, { path: 'Z', names: ['Zoë Hart'] }]);
		expect(countNameMentions("Then d'Artagnan drew.", p)).toEqual({ D: 1 });
		expect(countNameMentions('Zoë waited.', p)).toEqual({ Z: 1 });
	});

	test('no characters, no text → nothing', () => {
		expect(countNameMentions('Mara', [])).toEqual({});
		expect(count('')).toEqual({});
	});
});
