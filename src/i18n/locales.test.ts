/**
 * Locale invariants and t() behaviour.
 *
 * t() degrades silently by design: a key missing from the active locale falls back to
 * English, and a key missing from English falls back to the key string itself. So a typo
 * renders `taskList.menu.editText` on screen while the build stays green and no other test
 * notices. These are the guards for that.
 */
import * as fs from 'fs';
import * as path from 'path';
import { t, hasKey, getLocale } from './index';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { getCodexKindOrder, getKindSpec } from '../entities/entity-kinds';

const DICTS = { en, es, fr };
const TRANSLATIONS = ['es', 'fr'] as const;
const LOCALE_NAMES = ['en', 'es', 'fr'] as const;
const LOCALE_DIR = path.join(__dirname, 'locales');
const SRC_ROOT = path.join(__dirname, '..');

const placeholders = (s: string): string[] =>
	(s.match(/\{[^{}]+\}/g) ?? []).slice().sort();

describe('locale dictionaries', () => {
	it.each(LOCALE_NAMES)('%s is populated', (locale) => {
		expect(Object.keys(DICTS[locale]).length).toBeGreaterThan(800);
	});

	it.each(TRANSLATIONS)('%s defines exactly the English key set', (locale) => {
		const enKeys = Object.keys(en).sort();
		const otherKeys = Object.keys(DICTS[locale]).sort();
		expect(enKeys.filter((k) => !(k in DICTS[locale]))).toEqual([]); // missing
		expect(otherKeys.filter((k) => !(k in en))).toEqual([]); // orphaned
	});

	it.each(TRANSLATIONS)('%s keeps the same {placeholder} set as English', (locale) => {
		const mismatched = Object.keys(en)
			.filter((k) => k in DICTS[locale])
			.filter((k) => placeholders(DICTS[locale][k]).join() !== placeholders(en[k]).join())
			.map((k) => `${k}: en[${placeholders(en[k])}] vs ${locale}[${placeholders(DICTS[locale][k])}]`);
		expect(mismatched).toEqual([]);
	});

	it.each(LOCALE_NAMES)('%s has no value that is merely its own key', (locale) => {
		// Would make a defined key indistinguishable from a missing one to any caller
		// reasoning about fallbacks, and signals a copy-paste slip.
		expect(Object.keys(DICTS[locale]).filter((k) => DICTS[locale][k] === k)).toEqual([]);
	});

	// Importing a dict cannot reveal a duplicate key — the later entry silently wins — so
	// this one check has to read the source. The pattern deliberately ignores the value, so
	// it cannot be defeated by an unusual value shape (a trailing comment, say).
	it.each(LOCALE_NAMES)('%s source has no duplicate keys', (locale) => {
		const src = fs.readFileSync(path.join(LOCALE_DIR, `${locale}.ts`), 'utf8');
		const seen = new Set<string>();
		const dupes: string[] = [];
		const re = /^\s*'([^']+)'\s*:/gm;
		let m: RegExpExecArray | null;
		while ((m = re.exec(src))) {
			if (seen.has(m[1])) dupes.push(m[1]);
			else seen.add(m[1]);
		}
		expect(dupes).toEqual([]);
		// Cross-check the source scan against the imported dict: if these ever diverge, the
		// scan is missing entries and the duplicate check above is quietly weakened.
		expect(seen.size).toBe(Object.keys(DICTS[locale]).length);
	});
});

describe('keys referenced from source', () => {
	/** Every `t('literal')` / `i18n('literal')` key used in src/, excluding src/i18n. */
	function referencedKeys(): Map<string, string> {
		const out = new Map<string, string>();
		const walk = (dir: string): void => {
			for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
				const p = path.join(dir, e.name);
				if (e.isDirectory()) {
					// Skip this directory: its own comments quote key literals as examples.
					if (p !== __dirname) walk(p);
				} else if (
					e.name.endsWith('.ts') &&
					!e.name.endsWith('.d.ts') &&
					!e.name.endsWith('.test.ts') // fixtures/comments there aren't real call sites
				) {
					const src = fs.readFileSync(p, 'utf8');
					const re = /\b(?:t|i18n)\(\s*'([^']+)'/g;
					let m: RegExpExecArray | null;
					while ((m = re.exec(src))) {
						// A literal ending in '.' is a prefix concatenated with a variable
						// (e.g. t('taskList.priority.value.' + p)) — not a whole key.
						if (m[1].includes('.') && !m[1].endsWith('.') && !out.has(m[1])) out.set(m[1], p);
					}
				}
			}
		};
		walk(SRC_ROOT);
		return out;
	}

	it('finds a realistic number of call sites', () => {
		expect(referencedKeys().size).toBeGreaterThan(400);
	});

	it('are all defined in English', () => {
		const missing = [...referencedKeys()]
			.filter(([k]) => !(k in en))
			.map(([k, file]) => `${k} <- ${path.relative(SRC_ROOT, file)}`);
		expect(missing).toEqual([]);
	});
});

describe('dynamically composed keys', () => {
	// Composed at runtime from a variable, so the source scan above cannot see them.

	describe('entity-created Activity lines (history-view.ts)', () => {
		const BASES = ['history.event.entityCreated', 'history.event.entitiesCreated'];

		// Kinds given their own string so Spanish/French can agree in gender and number.
		// Everything else uses the generic template, whose noun comes from the kind
		// registry — see the comment in history-view.ts.
		const LOCALIZED = ['character', 'location', 'scene', 'faction', 'system', 'item', 'research', 'event'];

		it.each(LOCALE_NAMES)('%s defines the generic fallback every unlisted kind needs', (locale) => {
			expect(BASES.filter((b) => !(b in DICTS[locale]))).toEqual([]);
		});

		it.each(LOCALE_NAMES)('%s defines both strings for every kind claimed as localized', (locale) => {
			const missing = LOCALIZED.flatMap((kind) =>
				BASES.map((b) => `${b}.${kind}`).filter((key) => !(key in DICTS[locale]))
			);
			expect(missing).toEqual([]);
		});

		// Guards the mistake this file previously made: asserting coverage for kinds that
		// the Codex had already retired, which passed while saying nothing useful.
		// `location`, `scene`, `system` and `research` are deliberately absent from
		// getCodexKindOrder() but keep their strings, so they are excluded here rather than
		// treated as dead.
		it('claims no kind that the registry cannot actually produce', () => {
			const RETIRED = ['location', 'scene', 'system', 'research'];
			const reachable = new Set(getCodexKindOrder().map(String));
			const unreachable = LOCALIZED.filter((k) => !reachable.has(k) && !RETIRED.includes(k));
			expect(unreachable).toEqual([]);
		});

		// Documents the real coverage rather than asserting a number: any kind without its
		// own string must still render through the generic template.
		it('leaves every remaining reachable kind to the generic template', () => {
			const uncovered = getCodexKindOrder()
				.map(String)
				.filter((kind) => !BASES.every((b) => `${b}.${kind}` in en));
			for (const kind of uncovered) {
				expect(hasKey('history.event.entityCreated')).toBe(true);
				expect(hasKey(`history.event.entityCreated.${kind}`)).toBe(false);
			}
		});
	});

	// entity-manager.ts's localizedDefaultName() composes t('entity.default.' + kind),
	// guarded by hasKey() so an uncovered kind falls back to the registry's English
	// defaultName. Only these three are covered today; the point of the test is that
	// whatever IS covered is covered in all three locales — a kind translated in Spanish
	// but not French would name the same blank entity differently per language, which is
	// the divergence this indirection exists to prevent.
	describe('blank-name fallbacks (entity-manager.ts)', () => {
		const COVERED = ['scene', 'character', 'location'];

		it.each(LOCALE_NAMES)('%s defines every kind claimed as covered', (locale) => {
			const missing = COVERED.filter((k) => !(`entity.default.${k}` in DICTS[locale]));
			expect(missing).toEqual([]);
		});

		it('claims no kind the registry does not define', () => {
			// A key for a kind that getKindSpec() cannot resolve would be dead weight.
			const unknown = COVERED.filter((k) => {
				try { return !getKindSpec(k as never); } catch { return true; }
			});
			expect(unknown).toEqual([]);
		});

		it('leaves uncovered kinds to fall through to the registry', () => {
			// Documents the fallback rather than asserting a count: hasKey() must be false
			// for a kind with no string, or localizedDefaultName() would return the key.
			expect(hasKey('entity.default.scene')).toBe(true);
			expect(hasKey('entity.default.water-body')).toBe(false);
		});
	});

	// task-list.ts composes t('taskList.priority.value.' + todo.priority). 'normal' is
	// filtered out before the lookup, so only these two are reachable.
	it.each(LOCALE_NAMES)('%s defines every reachable task priority value', (locale) => {
		expect(['low', 'high'].filter((p) => !(`taskList.priority.value.${p}` in DICTS[locale]))).toEqual([]);
	});
});

describe('layout-sensitive strings', () => {
	// Plot Grid toolbar chips sit side by side in one bar. `.sg-toolbar` is
	// `flex-wrap: wrap` and each button is `white-space: nowrap`, so an over-long label
	// widens its button and eventually pushes the right-hand group onto a second row —
	// nothing is clipped, but the bar doubles in height and stops reading as one strip.
	// The cap is on characters, not pixels, since a unit test has no layout to measure;
	// it is deliberately tight enough that "Tableau de bord" (15) has to be shortened.
	const TOOLBAR_LABELS = [
		'grid.toolbar.row', 'grid.toolbar.column', 'grid.toolbar.new', 'grid.toolbar.connections',
		'grid.toolbar.dashboard', 'grid.toolbar.codex', 'grid.toolbar.export',
	];
	const TOOLBAR_MAX = 14;

	it.each(LOCALE_NAMES)('%s keeps every toolbar label short enough for the bar', (locale) => {
		const tooLong = TOOLBAR_LABELS
			.filter((k) => (DICTS[locale][k] ?? '').length > TOOLBAR_MAX)
			.map((k) => `${k}: "${DICTS[locale][k]}" (${DICTS[locale][k].length} > ${TOOLBAR_MAX})`);
		expect(tooLong).toEqual([]);
	});

	// The "+ Add …" chips in the card editor rely on the leading plus to read as buttons;
	// a translator dropping it changes the UI without changing any code.
	const ADD_CHIPS = [
		'grid.panel.addEvent', 'grid.panel.addCharacter', 'grid.panel.addPlace',
		'grid.panel.addFaction', 'grid.panel.addSystem', 'grid.panel.addItem',
		'grid.panel.addResearch',
	];

	it.each(LOCALE_NAMES)('%s keeps the leading "+ " on every add chip', (locale) => {
		const missingPlus = ADD_CHIPS.filter((k) => !(DICTS[locale][k] ?? '').startsWith('+ '));
		expect(missingPlus).toEqual([]);
	});

	// The card editor's status dropdown deliberately renders the Dashboard's status
	// strings rather than a second set of its own (see grid-view.ts). Deleting these as
	// "dashboard-only" would silently blank the dropdown, so the coupling is asserted here.
	it.each(LOCALE_NAMES)('%s defines the six card statuses the Plot Grid shares with the Dashboard', (locale) => {
		const statuses = ['idea', 'outline', 'draft', 'written', 'revised', 'final'];
		expect(statuses.filter((s) => !(`dashboard.status.${s}` in DICTS[locale]))).toEqual([]);
	});
});

describe('t()', () => {
	it('resolves a known key', () => {
		expect(t('common.delete')).toBe('Delete');
	});

	it('returns the key itself when nothing defines it', () => {
		expect(t('no.such.key.exists')).toBe('no.such.key.exists');
	});

	it('substitutes every placeholder', () => {
		expect(t('history.event.wordsWritten', { count: 1200 })).toBe('1200 words written');
	});

	it('leaves a placeholder alone when no var supplies it', () => {
		expect(t('history.event.wordsWritten')).toBe('{count} words written');
		expect(t('history.event.wordsWritten', { other: 1 })).toBe('{count} words written');
	});

	it('does not re-substitute text that a value inserted', () => {
		// The writer's own words reach t() as vars. A value containing what looks like
		// another placeholder must survive verbatim — substituting vars one pass at a time
		// would overwrite it with the later var's value.
		expect(t('codex.notice.movedUnderParent', { name: 'The {parent} Vault', parent: 'Skyrim' }))
			.toBe('The {parent} Vault is now part of Skyrim');
	});

	it('substitutes a value that itself looks like the same placeholder', () => {
		expect(t('history.event.taskFinished', { text: '{text}' })).toBe('Finished "{text}"');
	});
});

describe('hasKey()', () => {
	it('is true for a defined key and false for a missing one', () => {
		expect(hasKey('common.delete')).toBe(true);
		expect(hasKey('no.such.key.exists')).toBe(false);
	});

	it('agrees with the active dictionary', () => {
		expect(getLocale()).toBe('en');
		expect(hasKey('history.event.entityCreated.character')).toBe(true);
		expect(hasKey('history.event.entityCreated.water-body')).toBe(false);
	});
});
