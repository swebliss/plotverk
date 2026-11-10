/**
 * Test stand-in for the `obsidian` module.
 *
 * The real package ships types only — its `package.json` has `"main": ""` — because
 * Obsidian injects the implementation at runtime and `esbuild.config.mjs` lists it as
 * `external`. Jest runs in plain Node, so any module that VALUE-imports from 'obsidian'
 * (rather than importing only types) is untestable without this shim.
 *
 * `src/i18n/index.ts` is the case that matters today: it imports `moment` to read the
 * user's locale, which made every module that imports `t()` unloadable in a test.
 *
 * Add to this only what a test actually needs, and keep it dumb — this is a stub, not a
 * reimplementation of Obsidian.
 */

/** Only `.locale()` is used, by `resolveLocale()` in `src/i18n/index.ts`. */
export const moment = {
	locale: (): string => 'en',
};

/**
 * Bare vault node classes, so code that checks `instanceof TFile` / `TFolder` can run
 * against the in-memory vault in `src/test/fake-vault.ts`.
 */
export class TAbstractFile {
	path = '';
	name = '';
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basename = '';
	extension = '';
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}
