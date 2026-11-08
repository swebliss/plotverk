import { Notice } from 'obsidian';
import type StorygridPlugin from '../main';
import { t } from '../i18n';

/**
 * Write mode — a simple on/off toggle, exactly like typewriter mode: turns
 * typewriter on and collapses both sidebars; toggling it off restores
 * whatever typewriter state was active before, and re-expands the sidebars.
 * Plan/Review modes were removed (Onboarding v2, Step 9) — Write is the only
 * mode left, so there's nothing left to switch between.
 */
export async function toggleWriteMode(plugin: StorygridPlugin): Promise<void> {
	const app = plugin.app;
	const settings = plugin.settings;

	if (settings.writingMode === 'write') {
		// Restore typewriter state from before the mode was entered
		if (settings._preModeTypewriter !== undefined) {
			settings.typewriterMode = settings._preModeTypewriter;
			plugin.refreshTypewriterMode();
			settings._preModeTypewriter = undefined;
		}
		try { app.workspace.leftSplit?.expand(); } catch { /* mobile */ }
		try { app.workspace.rightSplit?.expand(); } catch { /* mobile */ }

		settings.writingMode = null;
		document.body.classList.remove('sg-mode-write');
		await plugin.saveData(settings);
		plugin.refreshModeChip();
		new Notice(t('writeMode.notice.off'));
		return;
	}

	// Snapshot the user's typewriter preference so it can be restored on exit
	settings._preModeTypewriter = settings.typewriterMode;
	settings.writingMode = 'write';
	document.body.classList.add('sg-mode-write');

	if (!settings.typewriterMode) {
		settings.typewriterMode = true;
		plugin.refreshTypewriterMode();
	}
	// Collapse sidebars — guarded for mobile (drawers, no collapse())
	try { app.workspace.leftSplit?.collapse(); } catch { /* mobile */ }
	try { app.workspace.rightSplit?.collapse(); } catch { /* mobile */ }

	await plugin.saveData(settings);
	plugin.refreshModeChip();
	new Notice(t('writeMode.notice.on'));
}
