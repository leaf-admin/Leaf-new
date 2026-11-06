const crypto = require('crypto');
const {
  retryAttemptScopeForCase,
  retryChallengeIdForCase,
  restoreChallengeIdForCase,
  isRetryBindingValid,
  getRetryBindingRestoreCandidate,
  restoreRetryBinding
} = require('../../../services/kyc-retry-binding-restore-service');

const CASE_ID = 'kyc_ir_0421154cbad154eb669b946976902e92';

function workflowWith(gate, { runWithVerificationWindow } = {}) {
  return {
    assertKycOperationAllowed: jest.fn(async () => gate),
    runWithVerificationWindow: runWithVerificationWindow
      || jest.fn(async (_driverId, _scope, callback) => callback())
  };
}

const authorizedGate = {
  cleanRetryAuthorized: true,
  retryAuthorizationKind: 'manual_review',
  retryAuthorizationId: CASE_ID
};

describe('kyc retry binding restore', () => {
  it('uses the same challenge id and attempt scope as the false-positive decision', () => {
    const expected = `idrev_review_${crypto.createHash('sha1').update(CASE_ID).digest('hex').slice(0, 18)}`;
    expect(retryChallengeIdForCase(CASE_ID)).toBe(expected);
    expect(retryAttemptScopeForCase(CASE_ID)).toBe(`manual_review_retry_${CASE_ID}`);
  });

  it('restores with a new challenge id, never the expired one of the decision', () => {
    const restored = restoreChallengeIdForCase(CASE_ID, 1793920000000);
    expect(restored).toMatch(/^idrev_restore_[0-9a-f]{18}$/);
    expect(restored).not.toBe(retryChallengeIdForCase(CASE_ID));
    expect(restoreChallengeIdForCase(CASE_ID, 1793920000001)).not.toBe(restored);
  });

  it('accepts only a requested/failed/validating record bound to the case scope', () => {
    const bound = {
      challengeId: retryChallengeIdForCase(CASE_ID),
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested',
      attemptScope: retryAttemptScopeForCase(CASE_ID)
    };
    expect(isRetryBindingValid(bound, CASE_ID)).toBe(true);
    expect(isRetryBindingValid(null, CASE_ID)).toBe(false);
    expect(isRetryBindingValid({ ...bound, status: 'approved' }, CASE_ID)).toBe(false);
    expect(isRetryBindingValid({ ...bound, attemptScope: 'manual_review_retry_other' }, CASE_ID)).toBe(false);
  });

  it('offers a restore when the authorized retry has no reverification record', async () => {
    const candidate = await getRetryBindingRestoreCandidate({
      workflow: workflowWith(authorizedGate),
      readIdentityReverification: jest.fn(async () => null),
      driverId: 'driver-1'
    });
    expect(candidate).toEqual({ available: true, caseId: CASE_ID, reverificationRecord: 'missing' });
  });

  it('offers nothing when the record is still bound or the retry is not authorized', async () => {
    const bound = {
      challengeId: retryChallengeIdForCase(CASE_ID),
      requirement: 'IDENTITY_REVERIFICATION',
      status: 'requested',
      attemptScope: retryAttemptScopeForCase(CASE_ID)
    };
    await expect(getRetryBindingRestoreCandidate({
      workflow: workflowWith(authorizedGate),
      readIdentityReverification: jest.fn(async () => bound),
      driverId: 'driver-1'
    })).resolves.toEqual({ available: false });
    await expect(getRetryBindingRestoreCandidate({
      workflow: workflowWith({ ...authorizedGate, cleanRetryAuthorized: false }),
      readIdentityReverification: jest.fn(async () => null),
      driverId: 'driver-1'
    })).resolves.toEqual({ available: false });
    await expect(getRetryBindingRestoreCandidate({
      workflow: workflowWith({ ...authorizedGate, retryAuthorizationKind: 'orphan_hold' }),
      readIdentityReverification: jest.fn(async () => null),
      driverId: 'driver-1'
    })).resolves.toEqual({ available: false });
    await expect(getRetryBindingRestoreCandidate({
      workflow: { assertKycOperationAllowed: jest.fn(async () => { throw new Error('blocked'); }) },
      readIdentityReverification: jest.fn(async () => null),
      driverId: 'driver-1'
    })).resolves.toEqual({ available: false });
  });

  it('rebuilds the record through the scoped gate inside the verification window', async () => {
    const workflow = workflowWith(authorizedGate);
    const applyGate = jest.fn(async () => ({ challengeId: retryChallengeIdForCase(CASE_ID) }));
    const runtime = { workflow };

    const result = await restoreRetryBinding({
      runtime,
      applyGate,
      readIdentityReverification: jest.fn(async () => null),
      driverId: 'driver-1',
      caseId: CASE_ID,
      reviewerContext: { uid: 'admin-1' },
      ticketId: 'TICKET-1',
      nowMs: 1793920000000
    });

    expect(workflow.runWithVerificationWindow).toHaveBeenCalledWith(
      'driver-1',
      `dashboard_retry_binding_restore_${CASE_ID}`,
      expect.any(Function)
    );
    expect(applyGate).toHaveBeenCalledWith(runtime, expect.objectContaining({
      driverId: 'driver-1',
      reporterId: 'admin-1',
      reporterType: 'admin',
      supportTicketId: 'TICKET-1',
      challengeId: restoreChallengeIdForCase(CASE_ID, 1793920000000),
      notify: true,
      payload: expect.objectContaining({ attemptScope: retryAttemptScopeForCase(CASE_ID) })
    }));
    expect(result).toEqual(expect.objectContaining({ caseId: CASE_ID, previousRecord: 'missing' }));
  });

  it('refuses to restore another case or a binding that is still valid', async () => {
    const applyGate = jest.fn();
    await expect(restoreRetryBinding({
      runtime: { workflow: workflowWith(authorizedGate) },
      applyGate,
      readIdentityReverification: jest.fn(async () => null),
      driverId: 'driver-1',
      caseId: 'kyc_ir_other',
      reviewerContext: { uid: 'admin-1' }
    })).rejects.toMatchObject({ code: 'KYC_RETRY_BINDING_RESTORE_CONFLICT' });
    expect(applyGate).not.toHaveBeenCalled();
  });
});
