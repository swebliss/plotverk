import { createHash } from 'crypto';
import { applyTemplate, createEmptyGrid, GridData, sortByOrder, StorygridTemplate } from '../grid-data';
import { en } from '../i18n/locales/en';
import { es } from '../i18n/locales/es';
import { fr } from '../i18n/locales/fr';
import { SAMPLE_TEXT_FILES } from '../sample/saltmarch-data';
import { getTemplateById, guideColumnLabel, RECOMMENDED_TEMPLATE, STORY_TEMPLATES, templatePickerOrder } from './story-templates';

const stc = getTemplateById('save-the-cat')!;
const hintOf = (tpl: StorygridTemplate, label: string): string | undefined =>
	tpl.rows.find((r) => r.label === label)?.hint;

describe('Save the Cat: the owner’s approved beat guide (2026-11-15)', () => {
	it('keeps its nineteen rows, every one pinned below', () => {
		expect(stc.rows).toHaveLength(19);
	});

	it.each([
		['Opening Image', '0–1% · A snapshot of the main character’s life before the story changes it. Show who they are, where they are and what is wrong or missing, in one scene or image. The Final Image will mirror it, so the reader sees how far they have come.'],
		['Theme Stated', '~5% · A line from a supporting character that hints at the main character’s growth, especially the key truth they must learn by the end of the story. Also called the “life lesson.”'],
		['Setup', '1–10% · A view of the main character’s flawed daily life before the transformation. Introduce the supporting characters, their main goal, their resistance to change, and what they risk by refusing.'],
		['Catalyst', '~10% · A life-changing event that thrusts the main character into a new or unfamiliar world or mindset. It’s impossible to return to their old way of life.'],
		['Debate', '10–20% · A reaction phase where the main character weighs their next move, often framed as a central question like “Should I go?”, highlighting their hesitation to change.'],
		['Break Into 2', '~20% · The decisive turning point where the main character commits to the challenge, leaves their comfort zone, and enters a new world or mindset. It separates Act 1’s familiar routine from Act 2’s upside-down reality.'],
		['B Story', '~22% · The arrival of new “helper” characters, such as a mentor, love interest, rival, friend or family member, who will ultimately help the main character learn the story’s central lesson.'],
		['Fun and Games', '20–50% · A look at the main character navigating their new world, either thriving or struggling. Often called the “promise of the premise,” this section delivers the core hook that first drew readers to the story.'],
		['Midpoint', '~50% · The middle of the story, where the main character hits either a false victory (if they’ve been winning) or a false defeat (if they’ve been failing). A twist raises the stakes, pushing them toward real change.'],
		['Bad Guys Close In', '50–75% · Following a Midpoint false victory, things get steadily worse for the main character; following a false defeat, things seem to steadily improve instead. Either way, their deep-seated flaws (or internal enemies) are catching up with them.'],
		['All Is Lost', '~75% · The story’s lowest point, where a major setback collides with the main character’s internal flaws, driving them to rock bottom.'],
		['Dark Night of the Soul', '75–80% · A reflective pause where the main character processes everything so far, now worse off than at the start. It’s the darkest hour before dawn, moments away from finding the solution and grasping the life lesson.'],
		['Break Into 3', '~80% · The “aha!” moment when the main character realises what it takes to solve Act 2’s problems and, more importantly, to change themselves, bringing their character arc near completion.'],
		['Finale: Gathering the Team', '80–85% · The first step of the Finale. The main character puts the Break Into 3 plan together: they gather allies, make amends with people they hurt, and get the tools or skills they need. Show that they are no longer trying to do it alone.'],
		['Finale: Executing the Plan', '85–90% · The main character and their team carry out the plan, and at first it seems to work. Supporting characters may step up, take risks or make sacrifices. This shows how much the main character has grown and what the B Story gave them.'],
		['Finale: High Tower Surprise', '~90% · A twist the main character didn’t see coming: the plan fails, the villain is stronger than expected, or a hidden truth comes out. The old plan is gone, and the main character has to face the problem on their own.'],
		['Finale: Dig Deep Down', '90–95% · With no plan and no backup, the main character has to dig deep and find their courage. They finally trust the life lesson from Theme Stated and act on it. This is the moment that proves their change is real.'],
		['Finale: Execution of the New Plan', '95–99% · Acting on what they now believe, the main character finds a new way forward and wins in a way the person they were at the start never could. Enemies are defeated, flaws are overcome, and their world is left not only saved, but better than before.'],
		['Final Image', '99–100% · The opposite of the Opening Image. Show the main character’s life after the story, in one scene or image, so the reader sees how much they and their world have changed.'],
	])('%s carries the approved text', (label, hint) => {
		expect(hintOf(stc, label)).toBe(hint);
	});

	it('puts Theme Stated’s percent in the card title, not the text', () => {
		const out = applyTemplate(createEmptyGrid('STC'), stc, guideColumnLabel(stc));
		const row = out.rows.find((r) => r.label === 'Theme Stated')!;
		const card = out.cards.find((c) => c.rowId === row.id)!;
		expect(card.title).toBe('~5%');
		expect(card.synopsis.startsWith('A line from a supporting character')).toBe(true);
	});
});

describe('every built-in template teaches each beat', () => {
	const hinted = STORY_TEMPLATES.filter((tpl) => tpl.rows.some((r) => r.hint));

	it('covers every template except the blank grid', () => {
		expect(hinted.map((tpl) => tpl.id).sort()).toEqual(
			STORY_TEMPLATES.filter((tpl) => tpl.id !== 'clean-start').map((tpl) => tpl.id).sort()
		);
	});

	it.each(hinted.map((tpl) => [tpl.id, tpl] as const))('%s: every row has a "PCT · text" hint', (_id, tpl) => {
		for (const row of tpl.rows) {
			expect(row.hint).toMatch(/^[^·]+\S · \S.+$/);
			const sep = row.hint!.indexOf(' · ');
			expect(row.hint!.slice(0, sep).trim()).not.toBe('');
		}
	});

	it.each(hinted.filter((tpl) => tpl.id !== 'save-the-cat').map((tpl) => [tpl.id, tpl] as const))(
		'%s: each hint is a short teaching paragraph (2–3 sentences, about 25–55 words)',
		(_id, tpl) => {
			for (const row of tpl.rows) {
				const text = row.hint!.slice(row.hint!.indexOf(' · ') + 3);
				const words = text.split(/\s+/).length;
				const sentences = text.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length;
				expect({ row: row.label, words: words >= 25 && words <= 55 }).toEqual({ row: row.label, words: true });
				expect({ row: row.label, sentences: sentences >= 2 && sentences <= 3 }).toEqual({ row: row.label, sentences: true });
				expect(text).not.toMatch(/['"]/); // typographic apostrophes and quotes only
			}
		}
	);
});

describe('the guide column is named after its template', () => {
	const labelsOf = (g: GridData) => sortByOrder(g.columns).map((c) => c.label);

	it('Save the Cat → "Save the Cat beat guide"', () => {
		expect(guideColumnLabel(stc)).toBe('Save the Cat beat guide');
		const out = applyTemplate(createEmptyGrid('STC'), stc, guideColumnLabel(stc));
		expect(labelsOf(out)[0]).toBe('Save the Cat beat guide');
		expect(out.cards.every((c) => c.guide && c.colId === sortByOrder(out.columns)[0].id)).toBe(true);
	});

	it('a template without a short name uses its own name', () => {
		const hj = getTemplateById('heros-journey')!;
		expect(guideColumnLabel(hj)).toBe(`${hj.name} beat guide`);
	});

	it('the default template (name too long for the column) gets the plain "Beat guide"', () => {
		const def = getTemplateById('default-storygrid')!;
		expect(def.name).toBe('Main Plot and Subplots');
		expect(guideColumnLabel(def)).toBe('Beat guide');
		const out = applyTemplate(createEmptyGrid('Def'), def, guideColumnLabel(def));
		expect(labelsOf(out)[0]).toBe('Beat guide');
	});

	it('Seven-Point Story Structure → "Seven-Point beat guide"', () => {
		expect(guideColumnLabel(getTemplateById('seven-point-story-structure')!)).toBe('Seven-Point beat guide');
	});

	it('the other short names, word for word', () => {
		expect(guideColumnLabel(getTemplateById('romancing-the-beat')!)).toBe('Romance beat guide');
		expect(guideColumnLabel(getTemplateById('horror-beatsheet')!)).toBe('Horror beat guide');
	});

	it('a custom (saved) template gets its own name', () => {
		const custom: StorygridTemplate = {
			id: 'custom-1', name: 'My Mystery Layout', description: '',
			rows: [{ label: 'Clue', color: undefined, hint: '~10% · Plant it.' }],
			columns: [{ label: 'Detective', color: undefined }],
		};
		const out = applyTemplate(createEmptyGrid('Mine'), custom, guideColumnLabel(custom));
		expect(labelsOf(out)).toEqual(['My Mystery Layout beat guide', 'Detective']);
	});

	it('falls back to the plain "Beat guide" when there is no name', () => {
		expect(guideColumnLabel({ name: '' })).toBe('Beat guide');
		expect(guideColumnLabel({ name: '   ' })).toBe('Beat guide');
	});

	it('defines the named header and the short names in every language', () => {
		for (const dict of [en, es, fr]) {
			expect(dict['grid.guide.headerNamed']).toContain('{name}');
			expect(dict['grid.guide.header']).toBeTruthy();
			for (const k of ['saveTheCat', 'romancingTheBeat', 'horrorBeatsheet', 'sevenPointStoryStructure']) {
				expect(dict[`templates.${k}.guideName`]).toBeTruthy();
			}
		}
		expect(en['grid.guide.headerNamed']).toBe('{name} beat guide');
	});
});

describe('the Saltmarch sample carries the approved Save the Cat guide', () => {
	const grids = SAMPLE_TEXT_FILES.filter(([p]) => p.endsWith('.storygrid')).map(
		([p, text]) => [p, JSON.parse(text) as GridData] as const
	);

	// Fingerprint of everything EXCEPT the guide cards' title/synopsis and the guide column's
	// label, taken before the 2026-11-15 text update. If the sample is deliberately re-packed,
	// update these. Saltmarch.storygrid re-taken after its first row label lost the leftover
	// test text ("Save The cat Opening Image" → "Opening Image"), its only change.
	const NON_GUIDE_FINGERPRINT: Record<string, string> = {
		'Saltmarch.storygrid': 'b356028d415558cb30d345408cd60279e776cb707e7a32d362626108212cabec',
		'The Saltmarch Reckoning/The Saltmarch Reckoning.storygrid': 'fed2382c921191f2fe3b493f40ccae28efb3e6dac17bce7bd9bd336916341ba3',
	};

	it.each(grids)('%s: every row carries exactly the template’s beat name (no leftover test text)', (_p, g) => {
		expect(sortByOrder(g.rows).map((r) => r.label)).toEqual(stc.rows.map((r) => r.label));
	});

	it('has both grids', () => {
		expect(grids.map(([p]) => p).sort()).toEqual(Object.keys(NON_GUIDE_FINGERPRINT).sort());
	});

	it.each(grids)('%s: guide cards match the template, row by row, under "Save the Cat beat guide"', (_p, g) => {
		const rows = sortByOrder(g.rows);
		expect(rows).toHaveLength(stc.rows.length);
		const guides = g.cards.filter((c) => c.guide);
		expect(guides).toHaveLength(stc.rows.length);
		rows.forEach((row, i) => {
			const card = guides.find((c) => c.rowId === row.id)!;
			expect(`${card.title} · ${card.synopsis}`).toBe(stc.rows[i].hint);
		});
		const guideCols = new Set(guides.map((c) => c.colId));
		expect(guideCols.size).toBe(1);
		expect(g.columns.find((c) => guideCols.has(c.id))!.label).toBe('Save the Cat beat guide');
	});

	it.each(grids)('%s: nothing else in the grid changed', (p, g) => {
		const guideCols = new Set(g.cards.filter((c) => c.guide).map((c) => c.colId));
		const masked = JSON.stringify({
			...g,
			columns: g.columns.map((c) => (guideCols.has(c.id) ? { ...c, label: '' } : c)),
			cards: g.cards.map((c) => (c.guide ? { ...c, title: '', synopsis: '' } : c)),
		});
		expect(createHash('sha256').update(masked).digest('hex')).toBe(NON_GUIDE_FINGERPRINT[p]);
	});
});

describe('the New grid picker: Save the Cat right next to the blank grid, recommended', () => {
	test('blank grid first, Save the Cat second, every other template after in its usual order', () => {
		const ids = templatePickerOrder(STORY_TEMPLATES).map((tpl) => tpl.id);
		expect(ids.slice(0, 2)).toEqual(['clean-start', 'save-the-cat']);
		expect(ids.slice(2)).toEqual(STORY_TEMPLATES.map((tpl) => tpl.id).filter((id) => id !== 'clean-start' && id !== 'save-the-cat'));
		expect(RECOMMENDED_TEMPLATE).toBe('save-the-cat');
	});
	test('the built-in list itself is unchanged (other places read it in order)', () => {
		expect(STORY_TEMPLATES[0].id).toBe('clean-start');
	});
});
