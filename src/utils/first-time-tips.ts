import type { StorygridSettings } from '../grid-data';

/**
 * Bring back every first-time tip, so Plotverk looks the way it does to a
 * brand-new writer: the welcome chooser, first-visit intro banners, coach
 * marks, milestone toasts and the starter to-dos.
 *
 * Only "already seen" bookkeeping changes. Real choices stay exactly as they
 * are — the setup answer (intent / writing style) and the modules it switched
 * on, palettes, sort orders, sizes, quick links — and nothing in the vault is
 * touched. Skipping the welcome chooser again keeps the current setup.
 */
export function resetFirstTimeTips(settings: StorygridSettings): void {
	settings.hasSeenWelcome = false;
	settings.coachMarksSeen = {};
	settings.milestonesSeen = {};
	settings.dismissedIntros = {};
	settings.taskOnboarding = true;
}
