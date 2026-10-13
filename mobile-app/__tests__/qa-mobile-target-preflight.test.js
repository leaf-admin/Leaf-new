const { validateTarget } = require('../scripts/qa/verify-real-qa-target.cjs');

const validQa = {
  env: {
    LEAF_ENV_FILE: '.env.qa.local',
    LEAF_QA_TARGET_API_ORIGIN: 'https://api.qa.example.test',
    LEAF_QA_TARGET_WS_ORIGIN: 'https://socket.qa.example.test',
    EXPO_PUBLIC_API_URL: 'https://api.qa.example.test',
    EXPO_PUBLIC_WS_URL: 'https://socket.qa.example.test',
    EXPO_PUBLIC_LEAF_LAUNCH_PROFILE: 'pilot_controlled',
  },
  appConfig: {
    extra: {
      apiUrl: 'https://api.qa.example.test',
      wsUrl: 'https://socket.qa.example.test',
      launchProfile: 'pilot_controlled',
      pilotControlled: true,
      e2eTest: false,
      enableTestUserTools: false,
      forcePaymentBypass: false,
    },
  },
};

describe('real QA target preflight', () => {
  it('accepts an explicitly allowlisted pilot-controlled QA target with bypasses off', () => {
    expect(validateTarget(validQa)).toEqual({ ok: true, blockers: [] });
  });

  it('blocks the production API and socket defaults even if listed as the expected target', () => {
    const production = {
      env: {
        ...validQa.env,
        LEAF_QA_TARGET_API_ORIGIN: 'https://api.leaf.app.br',
        LEAF_QA_TARGET_WS_ORIGIN: 'https://socket.leaf.app.br',
        EXPO_PUBLIC_API_URL: 'https://api.leaf.app.br',
        EXPO_PUBLIC_WS_URL: 'https://socket.leaf.app.br',
      },
      appConfig: {
        extra: {
          ...validQa.appConfig.extra,
          apiUrl: 'https://api.leaf.app.br',
          wsUrl: 'https://socket.leaf.app.br',
        },
      },
    };

    const result = validateTarget(production);
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('api_is_production_host');
    expect(result.blockers).toContain('socket_is_production_host');
  });

  it('blocks OTP, payment, and developer bypasses for real signup flows', () => {
    const config = {
      env: {
        ...validQa.env,
        EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW: 'true',
        EXPO_PUBLIC_BYPASS_PAYMENTS: '1',
      },
      appConfig: {
        extra: {
          ...validQa.appConfig.extra,
          e2eTest: true,
          enableTestUserTools: true,
          forcePaymentBypass: true,
        },
      },
    };

    const result = validateTarget(config);
    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'e2e_test_mode_must_be_off',
      'test_user_tools_must_be_off',
      'payment_bypass_must_be_off',
      'expo_public_enable_qa_otp_force_flow_must_be_off',
      'expo_public_bypass_payments_must_be_off',
    ]));
  });

  it('blocks missing explicit env files, targets, or pilot profile', () => {
    const config = {
      env: { ...validQa.env, LEAF_ENV_FILE: '', LEAF_QA_TARGET_API_ORIGIN: '' },
      appConfig: { extra: { ...validQa.appConfig.extra, launchProfile: 'full', pilotControlled: false } },
    };

    const result = validateTarget(config);
    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'explicit_qa_env_file_required',
      'qa_api_origin_allowlist_required',
      'pilot_controlled_launch_profile_required',
      'pilot_controlled_flag_required',
    ]));
  });
});
