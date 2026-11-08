import { assembleFountain } from './fountain';
import { ManuscriptItem } from './compile';

function heading(depth: number, label: string): ManuscriptItem {
	return { kind: 'heading', depth, number: '', label };
}
function scene(text: string): ManuscriptItem {
	return { kind: 'scene', depth: 1, number: '', title: 'S', docPath: 'Scenes/S.md', text };
}

const FILM: ManuscriptItem[] = [
	heading(0, 'Act One'),
	scene('INT. SHIP - NIGHT\n\nMara listens to the hull.'),
	scene('EXT. DECK - NIGHT\n\nThe storm builds.'),
];

describe('assembleFountain', () => {
	test('emits a fountain title page and # sections from top-level dividers', () => {
		const out = assembleFountain('The Tide Thief', FILM, {
			includeHeadings: true,
			sceneSeparator: '',
			titlePage: 'fountain',
			author: 'Emma Berg',
			credit: 'Written by',
		});
		expect(out).toContain('Title: The Tide Thief');
		expect(out).toContain('Credit: Written by');
		expect(out).toContain('===');
		expect(out).toContain('# Act One');
		expect(out).toContain('INT. SHIP - NIGHT');
		expect(out).toContain('EXT. DECK - NIGHT');
	});

	test('title page can be suppressed', () => {
		const out = assembleFountain('T', FILM, { includeHeadings: true, sceneSeparator: '', titlePage: 'none' });
		expect(out).not.toContain('Title:');
		expect(out).toContain('# Act One');
	});

	test('teleplay act markers close each top-level section', () => {
		const items = [
			heading(0, 'Teaser'),
			scene('INT. DINER - DAY\n\nCold open.'),
			heading(0, 'Act One'),
			scene('INT. OFFICE - DAY\n\nThe pitch.'),
		];
		const out = assembleFountain('Pilot', items, {
			includeHeadings: true,
			sceneSeparator: '',
			titlePage: 'none',
			actMarkers: true,
		});
		expect(out).toContain('> END OF TEASER <');
		expect(out).toContain('> END OF ACT ONE <');
		// Teaser marker comes before the Act One section
		expect(out.indexOf('> END OF TEASER <')).toBeLessThan(out.indexOf('# Act One'));
	});

	test('no act markers when the flag is off', () => {
		const out = assembleFountain('P', FILM, { includeHeadings: true, sceneSeparator: '', actMarkers: false });
		expect(out).not.toContain('END OF');
	});

	test('nested dividers step down to ## sections', () => {
		const items = [heading(0, 'Act One'), heading(1, 'Sequence A'), scene('Action.')];
		const out = assembleFountain('T', items, { includeHeadings: true, sceneSeparator: '', titlePage: 'none' });
		expect(out).toContain('# Act One');
		expect(out).toContain('## Sequence A');
	});

	test('endMark is centered and upper-cased', () => {
		const out = assembleFountain('T', FILM, { includeHeadings: true, sceneSeparator: '', titlePage: 'none', endMark: 'Fade Out' });
		expect(out).toContain('> FADE OUT <');
	});
});
