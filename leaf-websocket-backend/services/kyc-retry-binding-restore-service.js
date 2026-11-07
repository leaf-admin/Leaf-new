'use strict';

// Restores the reverification record of a false-positive retry that support
// already authorized. Some authorizations kept that record only in RTDB
// (users/{id}/identityReverification) and lost it when KYC moved to Firestore
// (#461): the driver then hits KYC_IDENTITY_RETRY_BINDING_REQUIRED forever.
// This rebuilds what the dashboard decision writes (same attempt scope, a new
// challenge id), so the authorized retry becomes usable again.
const crypto = require('crypto');

const MANUAL_REVIEW_RETRY_SCOPE_PREFIX = 'manual_review_retry_';
const BOUND_STATUSES = new Set(['requested', 'failed', 'validating']);

function retryAttemptScopeForCase(caseId) {
  return `${MANUAL_REVIEW_RETRY_SCOPE_PREFIX}${String(caseId || '').trim()}`.toLowerCase();
}

// Same formula as the FALSE_POSITIVE decision route.
function retryChallengeIdForCase(caseId) {
  return `idrev_review_${crypto.createHash('sha1').update(String(caseId)).digest('hex').slice(0, 18)}`;
}

// The decision's challenge (fixed id per case) expires after 20 min and stays
// in Firestore, so creating it again fails with ALREADY_EXISTS. A restore uses
// a new id; the retry only checks the idrev_ prefix and the attempt scope.
function restoreChallengeIdForCase(caseId, nowMs = Date.now()) {
  const digest = crypto.createHash('sha1').update(`${caseId}:restore:${nowMs}`).digest('hex').slice(0, 18);
  return `idrev_restore_${digest}`;
}

function isRetryBindingValid(identityState, caseId) {
  if (!identityState || typeof identityState !== 'object') return false;
  const challengeId = String(identityState.challengeId || '').trim();
  const requirement = String(identityState.requirement || '').trim();
  const status = String(identityState.status || '').trim().toLowerCase();
  const attemptScope = String(identityState.attemptScope || '').trim().toLowerCase();
  return challengeId.startsWith('idrev_')
    && requirement === 'IDENTITY_REVERIFICATION'
    && BOUND_STATUSES.has(status)
    && attemptScope === retryAttemptScopeForCase(caseId);
}

function describeRecord(identityState) {
  if (!identityState || typeof identityState !== 'object') return 'missing';
  return String(identityState.status || 'present').trim().toLowerCase() || 'present';
}

// Where the retry binding lives depends on the KYC scope: the operational
// policy writes users/{id}.identityReverification; the sandbox policy keeps a
// pending step-up challenge (with the attempt scope) and never touches users.
async function readRetryIdentityState({ runtime, readIdentityReverification, driverId }) {
  if (runtime?.namespace === 'sandbox') {
    const policy = runtime.policy || runtime.policyService || null;
    if (!policy || typeof policy.getStepUpChallenge !== 'function') return null;
    const challenge = await Promise.resolve(policy.getStepUpChallenge(null, driverId)).catch(() => null);
    if (!challenge) return null;
    return {
      challengeId: challenge.challengeId,
      requirement: challenge.requirement,
      status: challenge.status === 'pending' ? 'requested' : challenge.status,
      attemptScope: challenge.metadata?.attemptScope || null
    };
  }
  return readIdentityReverification(driverId);
}

async function getRetryBindingRestoreCandidate({ runtime = null, workflow = runtime?.workflow, readIdentityReverification, driverId }) {
  let gate;
  try {
    gate = await workflow.assertKycOperationAllowed(driverId);
  } catch (_error) {
    // Permanently blocked or unreadable: nothing to restore from here.
    return { available: false };
  }
  const caseId = String(gate?.retryAuthorizationId || '').trim();
  if (gate?.cleanRetryAuthorized !== true || gate?.retryAuthorizationKind !== 'manual_review' || !caseId) {
    return { available: false };
  }
  const identityState = await readRetryIdentityState({ runtime, readIdentityReverification, driverId });
  if (isRetryBindingValid(identityState, caseId)) {
    return { available: false };
  }
  return {
    available: true,
    caseId,
    reverificationRecord: describeRecord(identityState)
  };
}

async function restoreRetryBinding({
  runtime,
  applyGate,
  readIdentityReverification,
  driverId,
  caseId,
  reviewerContext,
  ticketId = null,
  nowMs = Date.now()
}) {
  const candidate = await getRetryBindingRestoreCandidate({
    runtime,
    readIdentityReverification,
    driverId
  });
  if (!candidate.available || candidate.caseId !== String(caseId || '').trim()) {
    const error = new Error('Nao ha nova tentativa autorizada sem vinculo para este caso.');
    error.code = 'KYC_RETRY_BINDING_RESTORE_CONFLICT';
    throw error;
  }
  let challenge = null;
  await runtime.workflow.runWithVerificationWindow(
    driverId,
    `dashboard_retry_binding_restore_${candidate.caseId}`,
    async () => {
      challenge = await applyGate(runtime, {
        driverId,
        reporterId: reviewerContext?.uid || null,
        reporterType: 'admin',
        supportTicketId: ticketId || null,
        challengeId: restoreChallengeIdForCase(candidate.caseId, nowMs),
        payload: {
          reasonCode: 'kyc_identity_false_positive_retry_authorized',
          publicReason: 'Uma nova validacao de identidade foi autorizada pelo suporte.',
          selectedOptions: ['false_positive_review', 'retry_binding_restored'],
          attemptScope: retryAttemptScopeForCase(candidate.caseId)
        },
        notify: true
      });
    }
  );
  return { caseId: candidate.caseId, previousRecord: candidate.reverificationRecord, challenge };
}

module.exports = {
  retryAttemptScopeForCase,
  retryChallengeIdForCase,
  restoreChallengeIdForCase,
  isRetryBindingValid,
  readRetryIdentityState,
  getRetryBindingRestoreCandidate,
  restoreRetryBinding
};
