import {
	SAMPLE_FOLDER,
	base64ToArrayBuffer,
	buildSamplePlan,
	foldersFor,
	freshEntityIds,
	rebaseJsonPaths,
	rebasePath,
	type SampleData,
} from './sample-plan';
import {
	SAMPLE_BOOKS,
	SAMPLE_IMAGE_FILES,
	SAMPLE_SCENE_TREES,
	SAMPLE_SOURCE_ROOT,
	SAMPLE_TEXT_FILES,
} from './saltmarch-data';

const REAL: SampleData = {
	sourceRoot: SAMPLE_SOURCE_ROOT,
	textFiles: SAMPLE_TEXT_FILES,
	imageFiles: SAMPLE_IMAGE_FILES,
	sceneTrees: SAMPLE_SCENE_TREES,
	books: SAMPLE_BOOKS,
};

describe('rebasePath', () => {
	it('moves paths inside the folder', () => {
		expect(rebasePath('Saltmarch/Codex/Characters/Mara Ferrow.md', 'Saltmarch', 'Saltmarch (sample)'))
			.toBe('Saltmarch (sample)/Codex/Characters/Mara Ferrow.md');
	});
	it('leaves the bare name, look-alike folders and mid-string mentions alone', () => {
		expect(rebasePath('Saltmarch', 'Saltmarch', 'X')).toBe('Saltmarch');
		expect(rebasePath('Saltmarchy/a.md', 'Saltmarch', 'X')).toBe('Saltmarchy/a.md');
		expect(rebasePath('Other/Saltmarch/a.md', 'Saltmarch', 'X')).toBe('Other/Saltmarch/a.md');
		expect(rebasePath('He left Saltmarch/the bay', 'Saltmarch', 'X')).toBe('He left Saltmarch/the bay');
	});
});

describe('rebaseJsonPaths', () => {
	it('moves nested strings and object keys, keeps everything else', () => {
		const input = {
			name: 'Saltmarch',
			n: 3,
			flag: true,
			none: null,
			cards: [{ povCharacter: 'Saltmarch/C/M.md', tags: ['Saltmarch', 'x'] }],
			events: { 'Saltmarch/E/a.md': { date: 1 } },
		};
		expect(rebaseJsonPaths(input, 'Saltmarch', 'S2')).toEqual({
			name: 'Saltmarch',
			n: 3,
			flag: true,
			none: null,
			cards: [{ povCharacter: 'S2/C/M.md', tags: ['Saltmarch', 'x'] }],
			events: { 'S2/E/a.md': { date: 1 } },
		});
	});
	it('does not change its input', () => {
		const input = { a: ['Saltmarch/x.md'] };
		rebaseJsonPaths(input, 'Saltmarch', 'S2');
		expect(input).toEqual({ a: ['Saltmarch/x.md'] });
	});
});

describe('freshEntityIds', () => {
	it('swaps each packed id for one new id, the same everywhere it appears', () => {
		let n = 0;
		const out = freshEntityIds(['id: sg_demo00001\nsee sg_demo00002', 'again sg_demo00001; keep sg_abc and xsg_demo1'], () => `sg_new${++n}`);
		expect(out).toEqual(['id: sg_new1\nsee sg_new2', 'again sg_new1; keep sg_abc and xsg_demo1']);
	});
});

describe('foldersFor', () => {
	it('lists the root and every parent folder, parents first, no duplicates', () => {
		expect(foldersFor('R', ['R/a.md', 'R/A/B/c.md', 'R/A/d.md', 'Elsewhere/e.md'])).toEqual(['R', 'R/A', 'R/A/B']);
	});
});

describe('buildSamplePlan (small fixture)', () => {
	const data: SampleData = {
		sourceRoot: 'Old',
		textFiles: [
			['Book.storygrid', JSON.stringify({ name: 'Old', cards: [{ location: 'Old/Places/P.md' }] })],
			['Places/P.md', '# P\nLinks to [[Q]] — Old/text stays.'],
		],
		imageFiles: [['Images/Characters/Q/Q.jpg', 'AAEC']],
		sceneTrees: { '': [{ kind: 'doc', docPath: 'Old/Scenes/1.md', children: [] }] },
		books: [{ name: 'Book', gridRel: 'Book.storygrid' }],
	};
	const plan = buildSamplePlan(data, 'New (sample)');

	it('puts every file under the new folder and moves JSON paths only', () => {
		expect(plan.textFiles.map((f) => f.path)).toEqual(['New (sample)/Book.storygrid', 'New (sample)/Places/P.md']);
		expect(JSON.parse(plan.textFiles[0].content)).toEqual({ name: 'Old', cards: [{ location: 'New (sample)/Places/P.md' }] });
		expect(plan.textFiles[1].content).toBe('# P\nLinks to [[Q]] — Old/text stays.');
	});
	it('moves the scene order, series and books', () => {
		expect(plan.sceneTrees).toEqual({ 'New (sample)': [{ kind: 'doc', docPath: 'New (sample)/Scenes/1.md', children: [] }] });
		expect(plan.series).toEqual({ name: 'New (sample)', rootPath: 'New (sample)' });
		expect(plan.books).toEqual([{ name: 'Book', gridPath: 'New (sample)/Book.storygrid' }]);
	});
	it('lists the folders the files need', () => {
		expect(plan.folders).toEqual(['New (sample)', 'New (sample)/Places', 'New (sample)/Images', 'New (sample)/Images/Characters', 'New (sample)/Images/Characters/Q']
			.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)));
	});
});

describe('base64ToArrayBuffer', () => {
	it('decodes to the original bytes', () => {
		expect([...new Uint8Array(base64ToArrayBuffer('AAEC/w=='))]).toEqual([0, 1, 2, 255]);
	});
});

// ─── The real packed Saltmarch story ──────────────────────────────────────────
// These guard the promise that a loaded sample WORKS: every link it stores
// points at a file the load creates, and nothing still points at the old folder.

describe('the packed Saltmarch sample', () => {
	const plan = buildSamplePlan(REAL);
	const created = new Set([...plan.textFiles.map((f) => f.path), ...plan.imageFiles.map((f) => f.path)]);
	const baseNames = new Set([...created].map((p) => p.slice(p.lastIndexOf('/') + 1)));

	/** Every string and key in a JSON value. */
	const strings = (v: unknown, out: string[] = []): string[] => {
		if (typeof v === 'string') out.push(v);
		else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
		else if (v && typeof v === 'object') {
			for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out); }
		}
		return out;
	};

	it('loads into "Saltmarch (sample)" as a two-book series', () => {
		expect(plan.root).toBe(SAMPLE_FOLDER);
		expect(plan.books.map((b) => b.name)).toEqual(['Saltmarch', 'The Saltmarch Reckoning']);
		for (const b of plan.books) expect(created.has(b.gridPath)).toBe(true);
	});

	it('contains no backups or per-user data', () => {
		for (const p of created) {
			expect(p).not.toMatch(/pvbackup|\.storygrid-backups|\.storygrid-data\.json|\.bak\./i);
		}
	});

	it('every path stored in a grid or the timeline points at a file the load creates', () => {
		const jsonFiles = plan.textFiles.filter((f) => /\.(storygrid|timeline)$/.test(f.path));
		expect(jsonFiles.length).toBe(3);
		let checked = 0;
		for (const f of jsonFiles) {
			for (const s of strings(JSON.parse(f.content))) {
				expect(s.startsWith(SAMPLE_SOURCE_ROOT + '/')).toBe(false); // nothing left behind
				if (s.startsWith(SAMPLE_FOLDER + '/')) {
					checked++;
					if (!created.has(s)) throw new Error(`${f.path} points at a missing file: ${s}`);
				}
			}
		}
		expect(checked).toBeGreaterThan(100); // 84 + 24 grid links + the timeline's events
	});

	it('every scene in the Writers Panel order exists', () => {
		expect(Object.keys(plan.sceneTrees).sort()).toEqual([SAMPLE_FOLDER, `${SAMPLE_FOLDER}/The Saltmarch Reckoning`]);
		for (const tree of Object.values(plan.sceneTrees)) {
			const docs = strings(tree).filter((s) => s.endsWith('.md'));
			expect(docs.length).toBeGreaterThan(0);
			for (const d of docs) if (!created.has(d)) throw new Error(`Scene order points at a missing file: ${d}`);
		}
	});

	it('notes store no folder paths (they link by name), and every link and picture resolves inside the sample', () => {
		const notes = plan.textFiles.filter((f) => f.path.endsWith('.md'));
		expect(notes.length).toBeGreaterThan(70);
		for (const n of notes) {
			expect(n.content).not.toContain('[[' + SAMPLE_SOURCE_ROOT + '/');
			for (const m of n.content.matchAll(/(!?)\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
				const target = m[2].trim();
				const name = target.slice(target.lastIndexOf('/') + 1);
				const ok = m[1] ? baseNames.has(name) : baseNames.has(name + '.md') || baseNames.has(name);
				if (!ok) throw new Error(`${n.path} links to something not in the sample: [[${target}]]`);
			}
		}
	});

	it('ships 11 small JPEG portraits, one per sheet folder', () => {
		expect(plan.imageFiles.length).toBe(11);
		for (const img of plan.imageFiles) {
			const bytes = new Uint8Array(base64ToArrayBuffer(img.base64));
			expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
			expect(bytes.length).toBeLessThan(80_000);
			const m = img.path.match(/\/Images\/Characters\/([^/]+)\/([^/]+)\.jpg$/);
			expect(m && m[1] === m[2]).toBe(true);
			expect(created.has(`${SAMPLE_FOLDER}/Codex/Characters/${m![1]}.md`)).toBe(true);
		}
	});

	it('gives every sheet a brand-new id on each load, unique and consistent', () => {
		const ids = (p: typeof plan) => p.textFiles.flatMap((f) => [...f.content.matchAll(/storygrid-id:\s*"?([\w]+)/g)].map((m) => m[1]));
		const first = ids(plan);
		expect(first.length).toBeGreaterThan(50);
		expect(first.some((id) => id.startsWith('sg_demo'))).toBe(false);
		expect(new Set(first).size).toBe(first.length);
		// Sheet ids only — the grid's own id (sg_demo_saltmarch_grid) is not a sheet id and stays.
		for (const f of plan.textFiles) expect(f.content).not.toMatch(/\bsg_demo[0-9a-z]+\b/);
		const second = ids(buildSamplePlan(REAL));
		expect(second.filter((id) => first.includes(id))).toEqual([]);
	});

	it('does not change the story name, which only looks like the folder', () => {
		const book1 = plan.textFiles.find((f) => f.path === `${SAMPLE_FOLDER}/Saltmarch.storygrid`)!;
		expect(JSON.parse(book1.content).name).toBe('Saltmarch');
	});
});
