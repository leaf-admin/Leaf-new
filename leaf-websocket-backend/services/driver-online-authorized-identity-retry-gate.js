'use strict';

const ACTIVE_IDENTITY_RETRY_STATUSES = new Set([
  'pending',
  'requested',
  'failed',
  'validating'
]);

function normalizedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function expectedAttemptScope(identityReviewGate = {}) {
  const authorizationId = normalizedString(
    identityReviewGate.retryAuthorizationId
  ).toLowerCase();
  const kind = normalizedString(
    identityReviewGate.retryAuthorizationKind
  ).toLowerCase();

  if (!authorizationId) return '';
  if (kind === 'manual_review') {
    return `manual_review_retry_${authorizationId}`;
  }
  if (kind === 'orphan_hold') {
    return `orphan_hold_retry_${authorizationId}`;
  }
  return '';
}

function shouldBlockOnlineForIdentityReviewHold(identityReviewGate = {}) {
  return identityReviewGate.identityReviewHold === true
    && identityReviewGate.retrySessionResumeCandidate !== true;
}

function bindIdentityReverificationChallengeToOnlineGate({
  onlineGate = null,
  identityState = null
} = {}) {
  if (
    !onlineGate
    || onlineGate.allowed !== false
    || onlineGate.requirement !== 'IDENTITY_REVERIFICATION'
  ) {
    return onlineGate;
  }

  if (normalizedString(onlineGate?.challenge?.challengeId)) {
    return onlineGate;
  }

  const challengeId = normalizedString(identityState?.challengeId);
  const requirement = normalizedString(identityState?.requirement).toUpperCase();
  const status = normalizedString(identityState?.status).toLowerCase();
  const bindingValid = Boolean(
    challengeId
    && requirement === 'IDENTITY_REVERIFICATION'
    && ACTIVE_IDENTITY_RETRY_STATUSES.has(status)
  );

  if (!bindingValid) {
    return {
      ...onlineGate,
      reason: 'Nao foi possivel preparar a validacao agora. Tente novamente em alguns minutos.',
      code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_REQUIRED',
      reasonCode: 'KYC_IDENTITY_REVERIFY_CHALLENGE_REQUIRED'
    };
  }

  return {
    ...onlineGate,
    challenge: {
      challengeId,
      requirement: 'IDENTITY_REVERIFICATION',
      source: normalizedString(identityState?.source) || 'identity_reverification',
      status
    }
  };
}

function buildAuthorizedIdentityRetryOnlineGate({
  identityReviewGate = {},
  identityState = null
} = {}) {
  const retryAuthorized = identityReviewGate.cleanRetryAuthorized === true
    || identityReviewGate.retrySessionResumeCandidate === true;
  if (!retryAuthorized) return null;

  const challengeId = normalizedString(identityState?.challengeId);
  const requirement = normalizedString(identityState?.requirement).toUpperCase();
  const status = normalizedString(identityState?.status).toLowerCase();
  const attemptScope = normalizedString(identityState?.attemptScope).toLowerCase();
  const requiredAttemptScope = expectedAttemptScope(identityReviewGate);
  const bindingValid = challengeId.startsWith('idrev_')
    && requirement === 'IDENTITY_REVERIFICATION'
    && ACTIVE_IDENTITY_RETRY_STATUSES.has(status)
    && Boolean(requiredAttemptScope)
    && attemptScope === requiredAttemptScope;

  if (!bindingValid) {
    return {
      allowed: false,
      reason: 'Precisamos liberar uma nova tentativa. Fale com o suporte.',
      code: 'KYC_IDENTITY_RETRY_BINDING_REQUIRED',
      requirement: 'IDENTITY_REVERIFICATION'
    };
  }

  return {
    allowed: false,
    reason: 'Validacao facial necessaria para ficar online.',
    code: 'kycRequired',
    reasonCode: 'KYC_IDENTITY_RETRY_AUTHORIZED',
    requirement: 'IDENTITY_REVERIFICATION',
    challenge: {
      challengeId,
      requirement: 'IDENTITY_REVERIFICATION',
      source: 'driver_identity_retry',
      status
    }
  };
}

module.exports = {
  bindIdentityReverificationChallengeToOnlineGate,
  buildAuthorizedIdentityRetryOnlineGate,
  shouldBlockOnlineForIdentityReviewHold
};
