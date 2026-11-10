import { canUse, setEntitlementState, getEntitlementState, FEATURE_TIERS, type FeatureId } from './entitlements';
import { PUBLIC_BUILD } from '../build-flags';

describe('entitlements — v1 defaults', () => {
	test('every feature is on in the private build, and every Pro feature is off in the public release', () => {
		const allIds = Object.keys(FEATURE_TIERS) as FeatureId[];
		for (const id of allIds) {
			expect(canUse(id)).toBe(PUBLIC_BUILD ? FEATURE_TIERS[id] === 'free' : true);
		}
	});
});

describe('entitlements — server state', () => {
	afterEach(() => {
		// Restore v1 defaults so tests don't bleed into each other
		setEntitlementState({
			licenseKey: null,
			isValid: false,
			enabledFeatures: new Set(['ai-scan', 'ai-continuity', 'cloud-sync', 'cloud-backup', 'prose-coach']),
		});
	});

	test('canUse returns false for pro features when server says no valid license', () => {
		setEntitlementState({ licenseKey: 'bad-key', isValid: false, enabledFeatures: new Set() });
		expect(canUse('ai-scan')).toBe(false);
		expect(canUse('ai-continuity')).toBe(false);
		expect(canUse('cloud-sync')).toBe(false);
	});

	test('canUse returns true only for features the server explicitly enables', () => {
		setEntitlementState({
			licenseKey: 'valid-key',
			isValid: true,
			enabledFeatures: new Set<FeatureId>(['ai-scan']),
		});
		expect(canUse('ai-scan')).toBe(true);
		expect(canUse('ai-continuity')).toBe(false);
		expect(canUse('cloud-sync')).toBe(false);
	});

	test('getEntitlementState reflects the set state', () => {
		const state = { licenseKey: 'k', isValid: true, enabledFeatures: new Set<FeatureId>(['cloud-backup']) };
		setEntitlementState(state);
		expect(getEntitlementState().licenseKey).toBe('k');
		expect(getEntitlementState().isValid).toBe(true);
		expect(getEntitlementState().enabledFeatures.has('cloud-backup')).toBe(true);
	});

	test('prose-coach is a pro feature gated the same way as the others', () => {
		expect(FEATURE_TIERS['prose-coach']).toBe('pro');
		setEntitlementState({ licenseKey: null, isValid: false, enabledFeatures: new Set() });
		expect(canUse('prose-coach')).toBe(false);
		setEntitlementState({ licenseKey: 'k', isValid: true, enabledFeatures: new Set<FeatureId>(['prose-coach']) });
		expect(canUse('prose-coach')).toBe(true);
	});
});
