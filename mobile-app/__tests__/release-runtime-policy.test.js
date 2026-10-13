const { validateProductionProfile, validateReviewProfile } = require('../scripts/qa/validate-release-runtime-policy.cjs');
const eas = require('../eas.json');

describe('controlled pilot release configuration', () => {
  const profile = () => JSON.parse(JSON.stringify(eas.build.production));

  it('accepts every configured public profile with the existing controlled-pilot policy', () => {
    for (const name of ['production', 'production-apk', 'release-test']) {
      expect(validateProductionProfile(name, eas.build[name])).toEqual([]);
      expect(eas.build[name].env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE).toBe('pilot_controlled');
      expect(eas.build[name].env.EXPO_PUBLIC_PILOT_CONTROLLED).toBe('true');
    }
    expect(validateReviewProfile('production-review', eas.build['production-review'])).toEqual([]);
  });

  it('retains compatibility with the previous restricted ride-flow profile', () => {
    const p = profile(); p.env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE = 'ride_flow_validation';
    expect(validateProductionProfile('production', p)).toEqual([]);
  });

  it('rejects a broad launch profile or a missing pilot flag', () => {
    const p = profile(); p.env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE = 'full';
    expect(validateProductionProfile('production', p)).not.toEqual([]);
    p.env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE = 'pilot_controlled'; delete p.env.EXPO_PUBLIC_PILOT_CONTROLLED;
    expect(validateProductionProfile('production', p)).not.toEqual([]);
  });

  it('continues rejecting every existing bypass and absent public guards', () => {
    for (const key of ['APP_REVIEW', 'EXPO_PUBLIC_APP_REVIEW', 'EXPO_PUBLIC_FORCE_PAYMENT_BYPASS', 'EXPO_PUBLIC_BYPASS_PAYMENTS', 'EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS', 'EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK', 'EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW', 'EXPO_PUBLIC_E2E_TEST', 'EXPO_PUBLIC_ALLOW_INSECURE_HTTP']) {
      const p = profile(); p.env[key] = 'true';
      expect(validateProductionProfile('production', p)).not.toEqual([]);
      delete p.env[key];
      expect(validateProductionProfile('production', p)).not.toEqual([]);
    }
  });

  it('continues rejecting non-HTTPS API and socket origins', () => {
    for (const key of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_WS_URL', 'EXPO_PUBLIC_SOCKET_URL']) {
      const p = profile(); p.env[key] = 'http://localhost:3001';
      expect(validateProductionProfile('production', p)).not.toEqual([]);
    }
  });
});
