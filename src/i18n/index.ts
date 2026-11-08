import { moment } from 'obsidian';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';

export type LocaleDict = Record<string, string>;

const LOCALES: Record<string, LocaleDict> = { en, es, fr };

function resolveLocale(): string {
	const raw = (moment.locale() || 'en').toLowerCase();
	const base = raw.split('-')[0];
	return LOCALES[base] ? base : 'en';
}

let activeLocale = resolveLocale();

export function refreshLocale(): void {
	activeLocale = resolveLocale();
}

export function getLocale(): string {
	return activeLocale;
}

/**
 * True when the key resolves to a real entry in the active locale or in English.
 *
 * Needed because t() cannot report a miss: it returns the key string itself when a key
 * is absent, so `t(k) === k` is only a proxy for "missing" and quietly becomes wrong
 * the day a translation legitimately equals its own key.
 */
export function hasKey(key: string): boolean {
	const dict = LOCALES[activeLocale] ?? en;
	return dict[key] !== undefined || en[key] !== undefined;
}

export function t(key: string, vars?: Record<string, string | number>): string {
	const dict = LOCALES[activeLocale] ?? en;
	const str = dict[key] ?? en[key] ?? key;
	if (!vars) return str;
	// Substitute in ONE pass. Substituting each var in turn would re-scan text that a
	// previous var already inserted, and most of these values are the writer's own words —
	// an entity called "The {parent} Vault" would have its own name overwritten by the
	// value of {parent}. A placeholder with no matching var is left in place, as before.
	return str.replace(/\{([^{}]+)\}/g, (whole, name: string) =>
		Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
	);
}
