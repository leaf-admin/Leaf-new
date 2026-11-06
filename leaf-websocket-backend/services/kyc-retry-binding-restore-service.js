'use strict';

// Restores the reverification record of a false-positive retry that support
// already authorized. Some authorizations kept that record only in RTDB
// (users/{id}/identityReverification) and lost it when KYC moved to Firestore
// (#461): the driver then hits KYC_IDENTITY_RETRY_BINDING_REQUIRED forever.
// This rebuilds exactly what the dashboard decision writes (same challenge id
// and attempt scope), so the authorized retry becomes usable again.
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

async function getRetryBindingRestoreCandidate({ workflow, readIdentityReverification, driverId }) {
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
  const identityState = await readIdentityReverification(driverId);
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
  ticketId = null
}) {
  const candidate = await getRetryBindingRestoreCandidate({
    workflow: runtime.workflow,
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
        challengeId: retryChallengeIdForCase(candidate.caseId),
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
  isRetryBindingValid,
  getRetryBindingRestoreCandidate,
  restoreRetryBinding
};
