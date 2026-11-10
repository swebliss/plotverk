import { Notice } from 'obsidian';
import { t } from '../i18n';

/**
 * For work nobody can await (event handlers, callbacks): log the error and tell
 * the writer with a short notice, instead of failing silently.
 */
export function reportError(err: unknown): void {
	console.error('Plotverk:', err);
	const msg = err instanceof Error ? err.message : String(err);
	new Notice(t('common.error.somethingFailed', { msg }));
}

/** Start a promise from a place that cannot await it; failures reach the writer. */
export function runSafely(promise: Promise<unknown>): void {
	promise.catch(reportError);
}
