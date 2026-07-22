'use strict';

const paymentRuntimeProfileService = require('./payment-runtime-profile-service');
const {
  sealFinancialContext,
  resolveFinancialContext,
  validateFinancialContext,
  hasSandboxSignal
} = require('./financial-runtime-context');

const PERSISTENCE_COLLECTIONS = Object.freeze({
  operational: Object.freeze({
    chatMessages: 'chat_messages',
    supportTickets: 'support_tickets',
    receipts: 'receipts',
    rides: 'rides',
    bookings: 'bookings',
    ratings: 'ratings',
    tripRatings: 'trip_ratings',
    ratingTripIndex: 'rating_trip_index',
    userRatings: 'user_ratings',
    incidents: 'ops_incidents',
    tripLocationChunks: 'trip_location_chunks',
    tripLocationSummaries: 'trip_location_summaries',
    auditLogs: 'audit_logs',
    kycFailedBiometricEvidence: 'kyc_failed_biometric_evidence',
    kycIdentityReviewCases: 'kyc_identity_review_cases',
    driverIdentityEnforcement: 'driver_identity_enforcement',
    kycIdentityRetryAuthorizations: 'kyc_identity_retry_authorizations',
    kycIdentityReviewAudit: 'kyc_identity_review_audit',
    driverIdentityTrust: 'driver_identity_trust',
    kycStepUpChallenges: 'kyc_stepup_challenges'
  }),
  sandbox: Object.freeze({
    chatMessages: 'sandbox_chat_messages',
    supportTickets: 'sandbox_support_tickets',
    receipts: 'sandbox_receipts',
    rides: 'sandbox_rides',
    bookings: 'sandbox_bookings',
    ratings: 'sandbox_ratings',
    tripRatings: 'sandbox_trip_ratings',
    ratingTripIndex: 'sandbox_rating_trip_index',
    userRatings: 'sandbox_user_ratings',
    incidents: 'sandbox_ops_incidents',
    tripLocationChunks: 'sandbox_trip_location_chunks',
    tripLocationSummaries: 'sandbox_trip_location_summaries',
    auditLogs: 'sandbox_audit_logs',
    kycFailedBiometricEvidence: 'sandbox_kyc_failed_biometric_evidence',
    kycIdentityReviewCases: 'sandbox_kyc_identity_review_cases',
    driverIdentityEnforcement: 'sandbox_driver_identity_enforcement',
    kycIdentityRetryAuthorizations: 'sandbox_kyc_identity_retry_authorizations',
    kycIdentityReviewAudit: 'sandbox_kyc_identity_review_audit',
    driverIdentityTrust: 'sandbox_driver_identity_trust',
    kycStepUpChallenges: 'sandbox_kyc_stepup_challenges'
  })
});

const KYC_PERSISTENCE_RESOURCES = Object.freeze({
  operational: Object.freeze({
    failedBiometricEvidenceStoragePrefix: 'restricted/kyc-failed-biometric-evidence/v1',
    identityTrustEvidenceCollection: 'evidence',
    identityTrustStateCachePrefix: 'kyc:identity-trust:state:',
    identityTrustRandomAuditPrefix: 'kyc:identity-trust:random-audit:',
    identityTrustCanonicalSessionClaimPrefix: 'kyc:identity-trust:session-claim:',
    identityTrustCompatibilityVerificationPrefix: 'kyc_verification:',
    identityTrustDriverHashPrefix: 'driver:',
    identityTrustStepUpChallengePrefix: 'kyc:stepup:challenge:',
    identityTrustStepUpActivePrefix: 'kyc:stepup:active:',
    identityTrustStepUpCreateLockPrefix: 'kyc:stepup:create-lock:'
  }),
  sandbox: Object.freeze({
    failedBiometricEvidenceStoragePrefix: 'restricted/sandbox/kyc-failed-biometric-evidence/v1',
    identityTrustEvidenceCollection: 'evidence',
    identityTrustStateCachePrefix: 'sandbox:kyc:identity-trust:state:',
    identityTrustRandomAuditPrefix: 'sandbox:kyc:identity-trust:random-audit:',
    identityTrustCanonicalSessionClaimPrefix: 'sandbox:kyc:identity-trust:session-claim:',
    identityTrustCompatibilityVerificationPrefix: 'sandbox:kyc_verification:',
    identityTrustDriverHashPrefix: 'sandbox:driver:',
    identityTrustStepUpChallengePrefix: 'sandbox:kyc:stepup:challenge:',
    identityTrustStepUpActivePrefix: 'sandbox:kyc:stepup:active:',
    identityTrustStepUpCreateLockPrefix: 'sandbox:kyc:stepup:create-lock:'
  })
});

class SandboxPersistenceContextError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SandboxPersistenceContextError';
    this.code = code;
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEnvironment(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return null;
  if (normalized === 'sandbox' || normalized === 'production') return normalized;
  return normalized;
}

function normalizeBoolean(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function throwContextError(result) {
  throw new SandboxPersistenceContextError(
    result?.code || 'PERSISTENCE_CONTEXT_INVALID',
    result?.error || 'Contexto de persistência inválido'
  );
}

function assertEnvelopeMatchesContext(input = {}, financialContext) {
  const source = input && typeof input === 'object' ? input : {};
  const namespaceSignals = [source.financialNamespace, source.namespace]
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean);
  if (namespaceSignals.some((namespace) => !['operational', 'sandbox'].includes(namespace))) {
    throw new SandboxPersistenceContextError(
      'PERSISTENCE_NAMESPACE_INVALID',
      'Namespace de persistência inválido'
    );
  }
  if (namespaceSignals.some((namespace) => namespace !== financialContext.namespace)) {
    throw new SandboxPersistenceContextError(
      'PERSISTENCE_NAMESPACE_MISMATCH',
      'Namespace de persistência diverge do contexto financeiro'
    );
  }

  const contextIdSignal = normalizeText(source.financialContextId);
  if (contextIdSignal && contextIdSignal !== financialContext.contextId) {
    throw new SandboxPersistenceContextError(
      'PERSISTENCE_CONTEXT_ID_MISMATCH',
      'Identificador do contexto de persistência diverge da corrida'
    );
  }

  const environmentSignals = [
    source.providerEnvironment,
    source.paymentProviderEnvironment,
    source.environment
  ].map(normalizeEnvironment).filter(Boolean);
  if (environmentSignals.some((environment) => environment !== financialContext.providerEnvironment)) {
    throw new SandboxPersistenceContextError(
      'PERSISTENCE_ENVIRONMENT_MISMATCH',
      'Ambiente do provedor diverge do contexto financeiro'
    );
  }

  const profileIdSignal = normalizeText(source.paymentProfileId);
  if (
    profileIdSignal &&
    financialContext.paymentProfileId &&
    profileIdSignal !== financialContext.paymentProfileId
  ) {
    throw new SandboxPersistenceContextError(
      'PERSISTENCE_PROFILE_MISMATCH',
      'Perfil de pagamento diverge do contexto financeiro'
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(source, 'testUserSandbox') &&
    normalizeBoolean(source.testUserSandbox) !== financialContext.testUserSandbox
  ) {
    throw new SandboxPersistenceContextError(
      'PERSISTENCE_TEST_USER_CLASSIFICATION_MISMATCH',
      'Classificação de usuário sandbox diverge do contexto financeiro'
    );
  }
}

function buildScope(financialContext, { source = 'financial_context', explicitSandboxAccess = false } = {}) {
  const namespace = financialContext?.namespace || 'sandbox';
  return Object.freeze({
    namespace,
    classification: financialContext?.classification || 'sandbox_explicit_access',
    financialContext: financialContext || null,
    financialContextId: financialContext?.contextId || null,
    explicitSandboxAccess,
    source,
    collections: PERSISTENCE_COLLECTIONS[namespace],
    kycResources: KYC_PERSISTENCE_RESOURCES[namespace]
  });
}

function resolvePersistenceScope(input = {}, {
  allowLegacyOperational = true,
  allowExplicitSandboxAccess = false
} = {}) {
  if (input?.explicitSandboxAccess === true) {
    if (!allowExplicitSandboxAccess || input.namespace !== 'sandbox') {
      throw new SandboxPersistenceContextError(
        'SANDBOX_PERSISTENCE_ACCESS_DENIED',
        'Acesso explícito ao namespace sandbox não autorizado'
      );
    }
    return buildScope(null, {
      source: normalizeText(input.source) || 'explicit_sandbox_access',
      explicitSandboxAccess: true
    });
  }

  const resolved = resolveFinancialContext(input, { allowLegacyOperational });
  if (!resolved.ok) throwContextError(resolved);
  assertEnvelopeMatchesContext(input, resolved.context);
  return buildScope(resolved.context, {
    source: resolved.legacy === true ? 'legacy_operational' : 'financial_context'
  });
}

function resolveRidePersistenceScope(ride = {}) {
  return resolvePersistenceScope(ride, { allowLegacyOperational: true });
}

async function resolveUserPersistenceScope({
  userId,
  phone = null,
  actor = null,
  appReview = false
} = {}) {
  const normalizedUserId = normalizeText(userId || actor?.uid || actor?.id);
  if (!normalizedUserId) {
    throw new SandboxPersistenceContextError(
      'PERSISTENCE_USER_REQUIRED',
      'Usuário obrigatório para classificar a persistência'
    );
  }

  const profile = await paymentRuntimeProfileService.resolveProfile({
    userId: normalizedUserId,
    passengerId: normalizedUserId,
    uid: normalizedUserId,
    phone,
    actor,
    appReview
  });
  if (profile?.classificationUnavailable === true) {
    throw new SandboxPersistenceContextError(
      'PERSISTENCE_USER_CLASSIFICATION_UNAVAILABLE',
      'Não foi possível classificar o ambiente de persistência do usuário'
    );
  }
  const financialContext = sealFinancialContext({
    providerEnvironment: profile.environment,
    paymentProfileId: profile.profileId,
    paymentProfileSource: profile.source,
    testUserSandbox: profile.testUserSandbox === true
  });

  return buildScope(financialContext, { source: 'payment_runtime_profile' });
}

async function assertRideParticipantsSharePersistenceScope(scopeInput, {
  passengerId,
  driverId,
  requireBoth = true
} = {}) {
  const rideScope = resolvePersistenceScope(scopeInput, { allowLegacyOperational: true });
  const participants = [
    normalizeText(passengerId),
    normalizeText(driverId)
  ].filter(Boolean);
  if (rideScope.namespace === 'sandbox' && requireBoth && new Set(participants).size < 2) {
    throw new SandboxPersistenceContextError(
      'SANDBOX_RIDE_PARTICIPANTS_INCOMPLETE',
      'Corrida sandbox sem os dois participantes identificados'
    );
  }

  for (const userId of new Set(participants)) {
    await assertUserSharesPersistenceScope(rideScope, { userId });
  }
  return rideScope;
}

async function assertUserSharesPersistenceScope(scopeInput, {
  userId,
  phone = null,
  actor = null,
  appReview = false
} = {}) {
  const rideScope = resolvePersistenceScope(scopeInput, { allowLegacyOperational: true });
  const userScope = await resolveUserPersistenceScope({
    userId,
    phone,
    actor,
    appReview
  });
  const hasSandboxParticipant = rideScope.namespace === 'sandbox' || userScope.namespace === 'sandbox';

  if (
    hasSandboxParticipant &&
    (
      rideScope.namespace !== userScope.namespace ||
      !rideScope.financialContextId ||
      rideScope.financialContextId !== userScope.financialContextId
    )
  ) {
    throw new SandboxPersistenceContextError(
      'SANDBOX_PARTICIPANT_CONTEXT_MISMATCH',
      'Participante e corrida não compartilham o mesmo contexto sandbox'
    );
  }

  return rideScope;
}

function createExplicitSandboxAccessScope({ authorized = false, source = 'support_dashboard' } = {}) {
  if (authorized !== true) {
    throw new SandboxPersistenceContextError(
      'SANDBOX_PERSISTENCE_ACCESS_DENIED',
      'Acesso ao namespace sandbox não autorizado'
    );
  }
  return buildScope(null, { source, explicitSandboxAccess: true });
}

function assertStoredRecordMatchesScope(record = {}, scopeInput = {}) {
  const scope = resolvePersistenceScope(scopeInput, {
    allowLegacyOperational: true,
    allowExplicitSandboxAccess: true
  });
  const recordHasSandboxSignal = hasSandboxSignal(record);
  const recordContextResult = validateFinancialContext(record?.financialContext || record);
  if (recordContextResult.ok) {
    assertEnvelopeMatchesContext(record, recordContextResult.context);
  }

  if (scope.namespace === 'sandbox') {
    if (!recordContextResult.ok || recordContextResult.context.namespace !== 'sandbox') {
      throw new SandboxPersistenceContextError(
        'SANDBOX_RECORD_CONTEXT_INVALID',
        'Registro sandbox sem contexto financeiro válido'
      );
    }
    if (
      scope.financialContextId &&
      scope.financialContextId !== recordContextResult.context.contextId
    ) {
      throw new SandboxPersistenceContextError(
        'SANDBOX_RECORD_CONTEXT_MISMATCH',
        'Registro sandbox pertence a outro contexto financeiro'
      );
    }
    return recordContextResult.context;
  }

  if (recordHasSandboxSignal || (recordContextResult.ok && recordContextResult.context.namespace === 'sandbox')) {
    throw new SandboxPersistenceContextError(
      'SANDBOX_RECORD_OPERATIONAL_ACCESS_DENIED',
      'Registro sandbox não pode ser acessado pelo namespace operacional'
    );
  }

  return recordContextResult.ok ? recordContextResult.context : null;
}

function resolveKycPersistenceScope(input = {}, options = {}) {
  return resolvePersistenceScope(input, {
    allowLegacyOperational: options.allowLegacyOperational !== false,
    allowExplicitSandboxAccess: options.allowExplicitSandboxAccess === true
  });
}

function buildScopedPersistenceEnvelope(scopeInput = {}, { record = null } = {}) {
  const scope = resolveKycPersistenceScope(scopeInput, {
    allowLegacyOperational: true,
    allowExplicitSandboxAccess: true
  });
  let financialContext = scope.financialContext;

  if (record) {
    const recordFinancialContext = assertStoredRecordMatchesScope(record, scope);
    if (!financialContext) financialContext = recordFinancialContext;
  }
  if (!financialContext) {
    throw new SandboxPersistenceContextError(
      'SANDBOX_PERSISTENCE_CONTEXT_REQUIRED',
      'Gravacao sandbox exige contexto financeiro selado'
    );
  }

  return Object.freeze({
    financialContext,
    financialNamespace: financialContext.namespace,
    financialContextId: financialContext.contextId,
    providerEnvironment: financialContext.providerEnvironment,
    paymentProfileId: financialContext.paymentProfileId || null,
    testUserSandbox: financialContext.testUserSandbox === true
  });
}

function assertScopedResourceName({ scopeInput = {}, actual, expected, resource }) {
  const scope = resolveKycPersistenceScope(scopeInput, {
    allowLegacyOperational: true,
    allowExplicitSandboxAccess: true
  });
  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);
  if (!normalizedActual || normalizedActual !== normalizedExpected) {
    throw new SandboxPersistenceContextError(
      'KYC_PERSISTENCE_RESOURCE_MISMATCH',
      `${resource || 'Recurso KYC'} diverge do namespace ${scope.namespace}`
    );
  }
  return normalizedActual;
}

module.exports = {
  PERSISTENCE_COLLECTIONS,
  KYC_PERSISTENCE_RESOURCES,
  SandboxPersistenceContextError,
  resolvePersistenceScope,
  resolveRidePersistenceScope,
  resolveUserPersistenceScope,
  assertUserSharesPersistenceScope,
  assertRideParticipantsSharePersistenceScope,
  createExplicitSandboxAccessScope,
  assertStoredRecordMatchesScope,
  resolveKycPersistenceScope,
  buildScopedPersistenceEnvelope,
  assertScopedResourceName
};
