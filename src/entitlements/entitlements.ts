// Pure, Obsidian-free entitlement gate — no plugin imports (only the build flag), fully portable.
import { PUBLIC_BUILD } from '../build-flags';
// Every premium feature checks canUse(featureId) and nothing else.
// Today all features return true (v1 — payment not yet wired up).
// When payment is added: call setEntitlementState() with the server response,
// and canUse() will reflect it automatically. No feature code needs to change.

export type FeatureId =
	| 'ai-scan'        // AI-powered mention scanning across manuscript
	| 'ai-continuity'  // AI continuity checker (caught-the-wrong-John, dead-Fira)
	| 'cloud-sync'     // Cloud sync & cross-device backup
	| 'cloud-backup'   // Cloud backup only
	| 'prose-coach';   // Prose Style Coach — verb suggestions, rephrase tips, pacing notes

export type FeatureTier = 'free' | 'pro';

export const FEATURE_TIERS: Record<FeatureId, FeatureTier> = {
	'ai-scan': 'pro',
	'ai-continuity': 'pro',
	'cloud-sync': 'pro',
	'cloud-backup': 'pro',
	'prose-coach': 'pro',
};

// Shaped to be filled by a server validation response later.
// licenseKey: the raw key the user pasted into settings.
// isValid: server confirmed the key is current and not revoked.
// enabledFeatures: which pro features the server says this key unlocks.
export interface EntitlementState {
	licenseKey: string | null;
	isValid: boolean;
	enabledFeatures: Set<FeatureId>;
}

// v1 default: no key, not validated, but all features enabled locally.
// Replace this with a real server check when payment is wired up —
// change isValid to false and enabledFeatures to new Set() as the
// starting state, only filled from a successful server response.
const _v1AllEnabled = new Set<FeatureId>(['ai-scan', 'ai-continuity', 'cloud-sync', 'cloud-backup', 'prose-coach']);

let _state: EntitlementState = {
	licenseKey: null,
	isValid: false,
	// The public release starts (and stays) with no Pro features.
	enabledFeatures: PUBLIC_BUILD ? new Set<FeatureId>() : _v1AllEnabled,
};

/** Called at plugin load (from saved license key) and again when server responds. */
export function setEntitlementState(state: EntitlementState): void {
	_state = state;
}

/** Read the current state (e.g. to show pro badge in UI). */
export function getEntitlementState(): Readonly<EntitlementState> {
	return _state;
}

/**
 * The single gate every premium feature checks before running.
 * Free-tier features always return true.
 * Pro features return true when the entitlement state says they're enabled.
 */
export function canUse(featureId: FeatureId): boolean {
	if (FEATURE_TIERS[featureId] === 'free') return true;
	return _state.enabledFeatures.has(featureId);
}
