'use strict';

const {
  bindIdentityReverificationChallengeToOnlineGate,
  buildAuthorizedIdentityRetryOnlineGate,
  shouldBlockOnlineForIdentityReviewHold
} = require('../../../services/driver-online-authorized-identity-retry-gate');

const authorizationId = 'kyc_or_7ca95774293fbac5c34b886e1c6cc5c1';

function orphanGate(overrides = {}) {
  return {
    cleanRetryAuthorized: true,
    retrySessionResumeCandidate: false,
    retryAuthorizationId: authorizationId,
    retryAuthorizationKind: 'orphan_hold',
    ...overrides
  };
}

function canonicalIdentityState(overrides = {}) {
  return {
    challengeId: 'idrev_or_db769d6c3fd305e5b7',
    requirement: 'IDENTITY_REVERIFICATION',
    status: 'requested',
    attemptScope: `orphan_hold_retry_${authorizationId}`,
    ...overrides
  };
}

describe('driver online authorized identity retry gate', () => {
  test('lets a session-bound retry resume through an otherwise active review hold', () => {
    expect(shouldBlockOnlineForIdentityReviewHold({
      identityReviewHold: true,
      retrySessionResumeCandidate: true
    })).toBe(false);
    expect(shouldBlockOnlineForIdentityReviewHold({
      identityReviewHold: true,
      retrySessionResumeCandidate: false
    })).toBe(true);
  });

  test('projects the canonical retry challenge without approving dispatch', () => {
    const result = buildAuthorizedIdentityRetryOnlineGate({
      identityReviewGate: orphanGate(),
      identityState: canonicalIdentityState()
    });

    expect(result).toEqual({
      allowed: false,
      reason: 'Validacao facial necessaria para ficar online.',
      code: 'kycRequired',
      reasonCode: 'KYC_IDENTITY_RETRY_AUTHORIZED',
      requirement: 'IDENTITY_REVERIFICATION',
      challenge: {
        challengeId: 'idrev_or_db769d6c3fd305e5b7',
        requirement: 'IDENTITY_REVERIFICATION',
        source: 'driver_identity_retry',
        status: 'requested'
      }
    });
  });

  test('keeps a consumed retry session resumable while validation is active', () => {
    const result = buildAuthorizedIdentityRetryOnlineGate({
      identityReviewGate: orphanGate({
        cleanRetryAuthorized: false,
        retrySessionResumeCandidate: true
      }),
      identityState: canonicalIdentityState({ status: 'validating' })
    });

    expect(result).toEqual(expect.objectContaining({
      allowed: false,
      code: 'kycRequired',
      requirement: 'IDENTITY_REVERIFICATION',
      challenge: expect.objectContaining({
        status: 'validating'
      })
    }));
  });

  test.each([
    ['missing state', null],
    ['wrong challenge', canonicalIdentityState({ challengeId: 'kyc_ch_wrong' })],
    ['wrong requirement', canonicalIdentityState({ requirement: 'LIVENESS_REQUIRED' })],
    ['terminal state', canonicalIdentityState({ status: 'completed' })],
    ['wrong authorization scope', canonicalIdentityState({
      attemptScope: 'orphan_hold_retry_kyc_or_other'
    })]
  ])('fails closed when the durable binding is invalid: %s', (_label, identityState) => {
    const result = buildAuthorizedIdentityRetryOnlineGate({
      identityReviewGate: orphanGate(),
      identityState
    });

    expect(result).toEqual({
      allowed: false,
      reason: 'Precisamos liberar uma nova tentativa. Fale com o suporte.',
      code: 'KYC_IDENTITY_RETRY_BINDING_REQUIRED',
      requirement: 'IDENTITY_REVERIFICATION'
    });
  });

  test('does not affect drivers without a durable retry authorization', () => {
    expect(buildAuthorizedIdentityRetryOnlineGate({
      identityReviewGate: orphanGate({
        cleanRetryAuthorized: false,
        retrySessionResumeCandidate: false
      }),
      identityState: canonicalIdentityState()
    })).toBeNull();
  });

  test('binds a regular operational identity revalidation to its canonical challenge', () => {
    const result = bindIdentityReverificationChallengeToOnlineGate({
      onlineGate: {
        allowed: false,
        code: 'kycRequired',
        reasonCode: 'KYC_REVERIFY_REQUIRED',
        requirement: 'IDENTITY_REVERIFICATION'
      },
      identityState: {
        challengeId: 'idrev_regular_canonical',
        requirement: 'IDENTITY_REVERIFICATION',
        status: 'requested',
        source: 'driver_online_random_audit'
      }
    });

    expect(result).toEqual(expect.objectContaining({
      allowed: false,
      code: 'kycRequired',
      challenge: {
        challengeId: 'idrev_regular_canonical',
        requirement: 'IDENTITY_REVERIFICATION',
        source: 'driver_online_random_audit',
        status: 'requested'
      }
    }));
  });

  test('fails closed when a regular identity revalidation loses its challenge', () => {
    const result = bindIdentityReverificationChallengeToOnlineGate({
      onlineGate: {
        allowed: false,
        code: 'kycRequired',
        reasonCode: 'KYC_REVERIFY_REQUIRED',
        requirement: 'IDENTITY_REVERIFICATION'
      },
      identityState: null
    });

    expect(result).toEqual(expect.objectContaining({
      allowed: false,
      code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_REQUIRED',
      requirement: 'IDENTITY_REVERIFICATION'
    }));
    expect(result).not.toHaveProperty('challenge');
  });

  test('does not rewrite first-access liveness gates', () => {
    const onlineGate = {
      allowed: false,
      code: 'kycRequired',
      requirement: 'LIVENESS_REQUIRED'
    };
    expect(bindIdentityReverificationChallengeToOnlineGate({
      onlineGate,
      identityState: canonicalIdentityState()
    })).toBe(onlineGate);
  });
});
