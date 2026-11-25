import { Notice } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { t } from '../i18n';
import { keepIfEmptied } from './write-guard';

/**
 * `vault.process`, except a change can never leave a page that had text empty:
 * the old text stays and the writer is told. Every normal change goes through
 * exactly as before. Returns true when the old text was kept (the change was NOT written),
 * so a caller can skip follow-up steps that assumed it was.
 */
export async function processKeepingText(app: App, file: TFile, change: (content: string) => string): Promise<boolean> {
	let kept = false;
	await app.vault.process(file, (content) => {
		const r = keepIfEmptied(content, change(content));
		kept = r.kept;
		return r.text;
	});
	if (kept) {
		console.warn(`Plotverk: kept the text of ${file.path}; a change would have left it empty`);
		new Notice(t('safety.keptFullPage', { name: file.basename }), 15000);
	}
	return kept;
}
