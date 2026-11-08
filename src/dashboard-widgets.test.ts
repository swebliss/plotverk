import { resolveWidgetLayout, DASHBOARD_WIDGETS, getWidgetDef, computePresenceNotes, ScenePresenceInput } from './dashboard-widgets';
import { DashboardWidgetConfig } from './grid-data';

describe('DASHBOARD_WIDGETS registry', () => {
	test('ids are unique', () => {
		const ids = DASHBOARD_WIDGETS.map((w) => w.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('getWidgetDef resolves known ids and rejects unknown', () => {
		expect(getWidgetDef('goals')?.slot).toBe('left');
		expect(getWidgetDef('nope')).toBeUndefined();
	});
});

describe('resolveWidgetLayout — visibility', () => {
	test('undefined config → everything default-visible', () => {
		const { isVisible } = resolveWidgetLayout(undefined);
		for (const w of DASHBOARD_WIDGETS) expect(isVisible(w.id)).toBe(w.defaultVisible);
	});

	test('hidden list switches a widget off', () => {
		const { isVisible } = resolveWidgetLayout({ hidden: ['balance'], order: { left: [], right: [] } });
		expect(isVisible('balance')).toBe(false);
		expect(isVisible('goals')).toBe(true);
	});

	test('unknown id defaults to visible', () => {
		const { isVisible } = resolveWidgetLayout(undefined);
		expect(isVisible('future-widget')).toBe(true);
	});
});

describe('resolveWidgetLayout — column order', () => {
	test('undefined config → registry order per slot', () => {
		const { columnOrder } = resolveWidgetLayout(undefined);
		expect(columnOrder('left')).toEqual(['goals', 'activity', 'balance', 'quiet']);
		expect(columnOrder('right')).toEqual(['todos', 'statuses', 'habits', 'pace']);
	});

	test('saved order is respected', () => {
		const config: DashboardWidgetConfig = { hidden: [], order: { left: ['balance', 'goals', 'activity'], right: [] } };
		expect(resolveWidgetLayout(config).columnOrder('left')).toEqual(['balance', 'goals', 'activity', 'quiet']);
	});

	test('a registry widget missing from saved order is appended (not dropped)', () => {
		// 'activity' omitted from saved order — should reappear at the end.
		const config: DashboardWidgetConfig = { hidden: [], order: { left: ['balance', 'goals'], right: [] } };
		expect(resolveWidgetLayout(config).columnOrder('left')).toEqual(['balance', 'goals', 'activity', 'quiet']);
	});

	test('stale/unknown ids in saved order are pruned', () => {
		const config: DashboardWidgetConfig = { hidden: [], order: { left: ['ghost', 'balance', 'goals', 'activity'], right: [] } };
		expect(resolveWidgetLayout(config).columnOrder('left')).toEqual(['balance', 'goals', 'activity', 'quiet']);
	});

	test('a column widget can be placed in the other column (cross-column drag)', () => {
		// 'todos' defaults to 'right' but here it is saved into 'left'.
		const config: DashboardWidgetConfig = { hidden: [], order: { left: ['todos', 'goals', 'activity', 'balance'], right: [] } };
		const layout = resolveWidgetLayout(config);
		expect(layout.columnOrder('left')).toEqual(['todos', 'goals', 'activity', 'balance', 'quiet']);
		// Having moved out of right, only the unplaced 'statuses' (and later widgets) remain there.
		expect(layout.columnOrder('right')).toEqual(['statuses', 'habits', 'pace']);
	});

	test('an id present in both columns renders once (left wins)', () => {
		const config: DashboardWidgetConfig = { hidden: [], order: { left: ['balance'], right: ['balance', 'todos'] } };
		const layout = resolveWidgetLayout(config);
		expect(layout.columnOrder('left')).toContain('balance');
		expect(layout.columnOrder('right')).not.toContain('balance');
		expect(layout.columnOrder('right')).toEqual(['todos', 'statuses', 'habits', 'pace']);
	});

	test('hidden widgets stay in column order (edit panel needs them)', () => {
		const config: DashboardWidgetConfig = { hidden: ['goals'], order: { left: [], right: [] } };
		expect(resolveWidgetLayout(config).columnOrder('left')).toEqual(['goals', 'activity', 'balance', 'quiet']);
	});
});

describe('computePresenceNotes', () => {
	const chars = [{ path: 'Characters/Mara.md', name: 'Mara' }, { path: 'Characters/Theo.md', name: 'Theo' }];

	function scenes(rows: Array<[number, number]>): ScenePresenceInput[] {
		return rows.map(([mara, theo], i) => ({
			path: `Scenes/s${i}.md`,
			links: { 'Characters/Mara.md': mara, 'Characters/Theo.md': theo },
		}));
	}

	test('flags a regular absent from the trailing scenes', () => {
		// Mara: in the first 4 scenes, absent from the last 4. Theo: present throughout.
		const s = scenes([[2, 1], [1, 1], [1, 1], [1, 1], [0, 1], [0, 1], [0, 1], [0, 1]]);
		const notes = computePresenceNotes(s, chars);
		const maraNote = notes.find((n) => n.characterPath === 'Characters/Mara.md');
		expect(maraNote?.kind).toBe('absent-streak');
		expect(maraNote?.streak).toBe(4);
		expect(maraNote?.usualGap).toBe(0);
		expect(maraNote?.message).toContain('Mara');
		expect(maraNote?.message).toContain('4 scenes');
	});

	test('does not flag a streak shorter than the threshold', () => {
		const s = scenes([[2, 1], [1, 1], [1, 1], [1, 1], [0, 1], [0, 1]]); // Mara absent only 2 trailing scenes
		const notes = computePresenceNotes(s, chars);
		expect(notes.find((n) => n.characterPath === 'Characters/Mara.md')).toBeUndefined();
	});

	test('someone in fewer than 4 scenes is not a regular yet', () => {
		// Mara: in 3 scenes, then gone for 6 — no rhythm to break yet.
		const s = scenes([[1, 5], [1, 5], [1, 5], [0, 5], [0, 5], [0, 5], [0, 5], [0, 5], [0, 5]]);
		expect(computePresenceNotes(s, chars).find((n) => n.characterPath === 'Characters/Mara.md')).toBeUndefined();
		expect(computePresenceNotes(s, chars, { minScenes: 3 }).find((n) => n.characterPath === 'Characters/Mara.md')?.streak).toBe(6);
	});

	test('someone who turns up rarely while in the story is not a regular', () => {
		// Mara: 4 scenes spread over 16 (1 in 4) — a passing face, not a regular.
		const row = (i: number): [number, number] => [[0, 5, 10, 15].includes(i) ? 1 : 0, 1];
		const s = scenes(Array.from({ length: 30 }, (_, i) => row(i)));
		expect(computePresenceNotes(s, chars)).toEqual([]);
	});

	test('a gap no longer than their usual gaps is not flagged', () => {
		// Mara turns up every 3rd scene (usual gap 2): 3 missing is not 2x that, 6 is.
		const on = [0, 3, 6, 9, 12];
		const s = scenes(Array.from({ length: 16 }, (_, i) => [on.includes(i) ? 1 : 0, 1] as [number, number]));
		expect(computePresenceNotes(s, chars)).toEqual([]);
		const longer = scenes(Array.from({ length: 19 }, (_, i) => [on.includes(i) ? 1 : 0, 1] as [number, number]));
		expect(computePresenceNotes(longer, chars)[0]).toMatchObject({ characterPath: 'Characters/Mara.md', streak: 6, usualGap: 2 });
	});

	test('the most surprising gap comes first, not the longest', () => {
		const cast = [
			{ path: 'A', name: 'Ada' }, // every scene, then gone 4: 4 ÷ 1 = 4
			{ path: 'B', name: 'Bo' }, // every other scene, then gone 7: 7 ÷ 1 = 7
			{ path: 'C', name: 'Cy' }, // every 3rd scene, then gone 9: 9 ÷ 2 = 4.5
		];
		const sc: ScenePresenceInput[] = Array.from({ length: 20 }, (_, i) => ({
			path: `s${i}`,
			links: {
				A: i < 16 ? 1 : 0,
				B: i < 13 && i % 2 === 0 ? 1 : 0,
				C: i <= 10 && i % 3 === 1 ? 1 : 0,
			},
		}));
		expect(computePresenceNotes(sc, cast).map((n) => n.characterName)).toEqual(['Bo', 'Cy', 'Ada']);
	});

	test('a series with ~200 characters: minor characters never appear, the regular who vanished does', () => {
		const S = 120;
		const cast: Array<{ path: string; name: string }> = [];
		const links: Array<Record<string, number>> = Array.from({ length: S }, () => ({}));
		const put = (path: string, at: number[]) => { for (const i of at) links[i][path] = 1; };
		// Five leads, in most scenes throughout.
		for (let r = 0; r < 5; r++) {
			cast.push({ path: `lead${r}`, name: `Lead ${r}` });
			put(`lead${r}`, Array.from({ length: S }, (_, i) => i).filter((i) => (i + r) % 3 !== 0));
		}
		// One regular, every 3rd scene (usual gap 2), missing for the last 14.
		cast.push({ path: 'lost', name: 'Lost Regular' });
		put('lost', Array.from({ length: S - 12 }, (_, i) => i).filter((i) => i % 3 === 0 && i <= S - 13));
		// 190 minor characters: one-offs, twice-seen, and a few passing faces across the series.
		for (let m = 0; m < 190; m++) {
			cast.push({ path: `minor${m}`, name: `Minor ${m}` });
			const start = (m * 7) % (S - 30);
			if (m % 3 === 0) put(`minor${m}`, [start]);
			else if (m % 3 === 1) put(`minor${m}`, [start, start + 2]);
			else put(`minor${m}`, [start, start + 6, start + 14, start + 25]); // 4 scenes, but 1 in 6.5
		}
		// 10 subplot characters: 5 scenes in a row somewhere early, never seen again.
		for (let k = 0; k < 10; k++) {
			cast.push({ path: `subplot${k}`, name: `Subplot ${k}` });
			put(`subplot${k}`, [0, 1, 2, 3, 4].map((d) => k * 6 + d));
		}
		const sc: ScenePresenceInput[] = links.map((l, i) => ({ path: `s${i}`, links: l }));
		const absent = computePresenceNotes(sc, cast).filter((n) => n.kind === 'absent-streak');
		expect(cast.length).toBeGreaterThanOrEqual(200);
		expect(absent.map((n) => n.characterPath)).toEqual(['lost']);
		expect(absent[0].streak).toBe(14);
	});

	test('someone gone for more than twice their time in the story has left it', () => {
		// Mara: a 5-scene subplot (usual gap 0), then gone. Theo: every scene.
		const run = (len: number) => scenes(Array.from({ length: len }, (_, i) => [i < 5 ? 1 : 0, 1] as [number, number]));
		expect(computePresenceNotes(run(15), chars)[0]).toMatchObject({ characterPath: 'Characters/Mara.md', streak: 10 });
		expect(computePresenceNotes(run(16), chars)).toEqual([]); // 11 > 2 × 5
	});

	test('does not flag a character absent for the whole manuscript (never present to begin with)', () => {
		const s = scenes([[0, 5], [0, 5], [0, 5], [0, 5]]);
		const notes = computePresenceNotes(s, chars);
		expect(notes.find((n) => n.characterPath === 'Characters/Mara.md')).toBeUndefined();
	});

	test('flags a minor character spiking in a single scene', () => {
		// Mara is the steady major presence; Theo is a light background character
		// (1 link per scene) until scene 4, where he suddenly dominates.
		const s = scenes([[5, 1], [5, 1], [5, 1], [5, 10]]);
		const notes = computePresenceNotes(s, chars);
		const theoNote = notes.find((n) => n.characterPath === 'Characters/Theo.md');
		expect(theoNote?.kind).toBe('minor-spike');
		expect(theoNote?.sceneIndex).toBe(3);
	});

	test('empty scenes or characters yields no notes', () => {
		expect(computePresenceNotes([], chars)).toEqual([]);
		expect(computePresenceNotes(scenes([[1, 1]]), [])).toEqual([]);
	});

	test('a single scene never produces an absence streak', () => {
		expect(computePresenceNotes(scenes([[0, 1]]), chars)).toEqual([]);
	});

	test('caps output at 3 notes even when more characters qualify', () => {
		const manyChars = Array.from({ length: 5 }, (_, i) => ({ path: `Characters/c${i}.md`, name: `Char${i}` }));
		// Every character: present in the first 4 scenes, absent from the last 4 —
		// all 5 qualify for an absent-streak note.
		const manyScenes: ScenePresenceInput[] = [0, 1, 2, 3, 4, 5, 6, 7].map((sceneIdx) => ({
			path: `Scenes/s${sceneIdx}.md`,
			links: Object.fromEntries(manyChars.map((c) => [c.path, sceneIdx < 4 ? 2 : 0])),
		}));
		const notes = computePresenceNotes(manyScenes, manyChars);
		expect(notes.length).toBe(3);
	});
});
