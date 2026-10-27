// Gerado a partir de routes/kyc-routes.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Middleware de inicialização, provider, prontidão e sessões AWS liveness

const {
  evaluateProductionReadiness,
  requireFirebaseUser,
  requireFirebaseSelf,
  logError,
  firebaseConfig,
  bodyUserId,
  queryUserId,
  resolvePublicAwsLivenessCredentialsFailure,
  normalizeLivenessAttemptScope,
  sendIdentityReviewGateResponse,
  resolveRequestKycRuntime,
  getKycSessionPersistenceBinding,
  getExpectedKycSessionPersistenceBinding,
  isIdentityReverificationRequest,
  resolveLivenessAttemptScope,
  assertPersistedRetrySessionResumable,
  buildResumedLivenessSessionResponse,
  buildPublicLivenessSessionResponse,
  sendLivenessAttemptRateLimit,
  isLivenessAttemptRateLimited,
} = require('./shared');
const userStore = require('../../services/user-store');

// Current identity reverification challenge on users/{uid}; null when unreadable.
async function readIdentityReverification(userId) {
  const firestore = userStore.resolveFirestore();
  if (!firestore) return null;
  return userStore.readUserField(firestore, userId, 'identityReverification').catch(() => null);
}

class KYCRoutesLiveness {
  registerLivenessRoutes() {
    // Middleware para verificar inicialização
    this.router.use(async (req, res, next) => {
      if (!this.kycService.initialized) {
        return res.status(503).json({
          success: false,
          error: 'KYC Service ainda não inicializado',
          retryAfter: 5
        });
      }
      next();
    });

    this.router.get('/liveness/provider', requireFirebaseUser, async (_req, res) => {
      try {
        const config = this.awsLivenessService.getConfigSummary();
        return res.json({
          success: true,
          provider: this.awsLivenessService.getProviderName(),
          config: {
            enabled: config.enabled === true,
            credentialsEnabled: config.credentialsEnabled === true,
            hasAssumeRoleArn: config.hasAssumeRoleArn === true
          }
        });
      } catch (error) {
        logError(error, 'Erro ao consultar provider de liveness', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          error: 'Erro interno do servidor'
        });
      }
    });

    this.router.get('/biometrics/readiness', requireFirebaseUser, async (_req, res) => {
      try {
        const readiness = evaluateProductionReadiness(process.env);
        const ready = readiness.ok === true
          && readiness.enabled === true
          && readiness.policy?.productionRuntime === true
          && readiness.policy?.productionBiometricsEnabled === true
          && readiness.policy?.strictProductionMode === true;
        return res.status(ready ? 200 : 503).json({
          success: ready,
          ready,
          code: ready ? 'KYC_BIOMETRICS_READY' : 'KYC_BIOMETRICS_NOT_READY'
        });
      } catch (error) {
        logError(error, 'Erro ao consultar prontidão biométrica', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          ready: false,
          code: 'KYC_BIOMETRICS_READINESS_UNAVAILABLE',
          error: 'Erro interno do servidor'
        });
      }
    });

    this.router.post(
      '/liveness/aws/session',
      requireFirebaseUser,
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      let verificationWindowClaim = null;
      let retainVerificationWindow = false;
      let cleanRetryAuthorizationClaim = null;
      let cleanRetrySessionCreated = false;
      let kycRuntime = null;
      try {
        const { userId, challengeId, requirement } = req.body || {};
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório',
            code: 'KYC_AWS_LIVENESS_USER_REQUIRED'
          });
        }

        kycRuntime = await resolveRequestKycRuntime(req, userId);
        const {
          trustService,
          workflowService,
          policyService
        } = kycRuntime;

        const identityReviewGate = await workflowService
          .assertKycOperationAllowed(userId);
        if (
          identityReviewGate.identityReviewHold
          && identityReviewGate.retrySessionResumeCandidate !== true
        ) {
          return sendIdentityReviewGateResponse(res, identityReviewGate);
        }

        let effectiveChallengeId = typeof challengeId === 'string' && challengeId.trim()
          ? challengeId.trim()
          : null;
        let challenge = null;
        let authorizedAttemptScope = null;
        let identityChallengeAlreadyValidating = false;
        let canonicalRetryIdentityState = null;
        let effectiveRequirement = typeof requirement === 'string' && requirement.trim()
          ? requirement.trim()
          : null;

        if (
          kycRuntime.namespace === 'operational'
          && (
            identityReviewGate.cleanRetryAuthorized === true
            || (
              identityReviewGate.retrySessionResumeCandidate === true
              && !isIdentityReverificationRequest({
                challengeId: effectiveChallengeId,
                requirement: effectiveRequirement
              })
            )
          )
        ) {
          const retryAuthorizationId = String(
            identityReviewGate.retryAuthorizationId || ''
          ).trim().toLowerCase();
          const retryScopePrefix = identityReviewGate.retryAuthorizationKind === 'manual_review'
            ? 'manual_review_retry_'
            : (identityReviewGate.retryAuthorizationKind === 'orphan_hold'
              ? 'orphan_hold_retry_'
              : '');
          const identityState = await readIdentityReverification(userId);
          canonicalRetryIdentityState = identityState;
          const canonicalChallengeId = String(identityState?.challengeId || '').trim();
          const canonicalRequirement = String(identityState?.requirement || '').trim();
          const canonicalStatus = String(identityState?.status || '').trim().toLowerCase();
          const canonicalAttemptScope = normalizeLivenessAttemptScope(
            identityState?.attemptScope || ''
          );
          const expectedAttemptScope = retryScopePrefix && retryAuthorizationId
            ? `${retryScopePrefix}${retryAuthorizationId}`
            : '';
          const canonicalBindingValid = Boolean(
            canonicalChallengeId.startsWith('idrev_')
            && canonicalRequirement === 'IDENTITY_REVERIFICATION'
            && ['requested', 'failed', 'validating'].includes(canonicalStatus)
            && expectedAttemptScope
            && canonicalAttemptScope === expectedAttemptScope
          );
          if (!canonicalBindingValid) {
            const error = new Error('A nova tentativa perdeu o vinculo de autorizacao');
            error.code = 'KYC_IDENTITY_RETRY_BINDING_REQUIRED';
            throw error;
          }
          effectiveChallengeId = canonicalChallengeId;
          effectiveRequirement = canonicalRequirement;
        }
        const isIdentityReverification = isIdentityReverificationRequest({
          challengeId: effectiveChallengeId,
          requirement: effectiveRequirement
        });

        if (effectiveChallengeId && !isIdentityReverification) {
          challenge = await policyService.getStepUpChallenge(effectiveChallengeId, userId);
          if (!challenge) {
            return res.status(404).json({
              success: false,
              error: 'Challenge KYC não encontrado ou expirado',
              code: 'KYC_CHALLENGE_NOT_FOUND'
            });
          }
          effectiveRequirement = challenge.requirement || effectiveRequirement || 'VERIFY_REQUIRED';
        } else if (isIdentityReverification) {
          const identityState = kycRuntime.namespace === 'sandbox'
            ? await policyService.getStepUpChallenge(effectiveChallengeId, userId)
            : (canonicalRetryIdentityState || await readIdentityReverification(userId));
          identityChallengeAlreadyValidating = identityState?.status === 'validating';
          const identityChallengeIsActive = Boolean(
            effectiveChallengeId
            && (identityState?.challengeId || null) === effectiveChallengeId
            && identityState?.requirement === 'IDENTITY_REVERIFICATION'
            && (
              (
                kycRuntime.namespace === 'sandbox'
                  ? identityState?.status === 'pending'
                  : ['requested', 'failed'].includes(identityState?.status)
              )
              || identityChallengeAlreadyValidating
            )
          );
          if (!identityChallengeIsActive) {
            return res.status(404).json({
              success: false,
              error: 'Revalidacao de identidade nao encontrada ou ja concluida',
              code: 'KYC_IDENTITY_REVERIFICATION_NOT_ACTIVE'
            });
          }
          const candidateAttemptScope = normalizeLivenessAttemptScope(
            identityState?.attemptScope || identityState?.metadata?.attemptScope || ''
          );
          authorizedAttemptScope = (
            candidateAttemptScope.startsWith('manual_review_retry_')
            || candidateAttemptScope.startsWith('orphan_hold_retry_')
          )
            ? candidateAttemptScope
            : null;
          effectiveRequirement = 'IDENTITY_REVERIFICATION';
        } else {
          const firstAccessPolicy = kycRuntime.namespace === 'sandbox'
            ? { required: false }
            : await policyService.requiresFirstAccessLiveness(userId)
              .catch(() => ({ required: false }));
          if (firstAccessPolicy?.required === true) {
            effectiveRequirement = 'LIVENESS_REQUIRED';
          } else {
            return res.status(409).json({
              success: false,
              error: 'Nenhuma validacao de liveness esta pendente para esta conta',
              code: 'KYC_LIVENESS_NOT_REQUIRED'
            });
          }
        }

        const attemptScope = resolveLivenessAttemptScope({
          challenge,
          challengeId: effectiveChallengeId,
          requirement: effectiveRequirement,
          authorizedAttemptScope
        });
        const requiresDurableRetryAuthorization = (
          attemptScope.startsWith('manual_review_retry_')
          || attemptScope.startsWith('orphan_hold_retry_')
          || identityReviewGate.cleanRetryAuthorized === true
        );
        if (
          identityReviewGate.cleanRetryAuthorized === true
          && !(
            attemptScope.startsWith('manual_review_retry_')
            || attemptScope.startsWith('orphan_hold_retry_')
          )
        ) {
          const error = new Error('A nova tentativa perdeu o vinculo de autorizacao');
          error.code = 'KYC_IDENTITY_RETRY_BINDING_REQUIRED';
          throw error;
        }

        if (
          identityReviewGate.retrySessionResumeCandidate === true
          && !requiresDurableRetryAuthorization
        ) {
          const error = new Error('A retomada perdeu o vinculo de autorizacao');
          error.code = 'KYC_IDENTITY_RETRY_BINDING_REQUIRED';
          throw error;
        }
        if (typeof this.awsLivenessService.getAttemptState !== 'function') {
          const error = new Error('Estado duravel da tentativa indisponivel');
          error.code = 'KYC_IDENTITY_RETRY_RESUME_STATE_UNAVAILABLE';
          throw error;
        }
        const attemptState = await this.awsLivenessService.getAttemptState({
          userId,
          requirement: effectiveRequirement,
          attemptScope,
          ...getKycSessionPersistenceBinding(kycRuntime)
        });
        const persistedSessionId = typeof attemptState?.lastSessionId === 'string'
          ? attemptState.lastSessionId.trim()
          : '';
        const terminalSessionCodes = new Set([
          'KYC_IDENTITY_RETRY_RESUME_SESSION_TERMINAL',
          'AWS_LIVENESS_SESSION_ABANDONED',
          'AWS_LIVENESS_SESSION_EXPIRED'
        ]);
        let persistedSessionIsTerminal = false;

        if (persistedSessionId) {
          let sessionMetadata = null;
          try {
            sessionMetadata = await this.awsLivenessService
              .getSessionMetadata(persistedSessionId);
          } catch (metadataError) {
            if (
              !requiresDurableRetryAuthorization
              && terminalSessionCodes.has(metadataError?.code)
            ) {
              persistedSessionIsTerminal = true;
            } else {
              throw metadataError;
            }
          }
          if (
            !sessionMetadata
            && !persistedSessionIsTerminal
            && typeof this.awsLivenessService.recoverCommittedSession === 'function'
          ) {
            verificationWindowClaim = await trustService.claimVerificationWindow(userId, {
              scope: 'aws_liveness_session_recovery'
            });
            if (!verificationWindowClaim.acquired) {
              return res.status(409).json({
                success: false,
                error: 'Outra validacao de identidade ja esta em andamento',
                code: 'KYC_VERIFICATION_IN_PROGRESS'
              });
            }
            let recovered = await this.awsLivenessService.recoverCommittedSession({
              userId,
              challengeId: effectiveChallengeId,
              requirement: effectiveRequirement,
              attemptScope,
              verificationWindowToken: verificationWindowClaim.token,
              ...getKycSessionPersistenceBinding(kycRuntime)
            });
            if (
              !recovered
              && typeof this.awsLivenessService.recoverExpiredSessionMetadata === 'function'
            ) {
              recovered = await this.awsLivenessService.recoverExpiredSessionMetadata({
                userId,
                sessionId: persistedSessionId,
                challengeId: effectiveChallengeId,
                requirement: effectiveRequirement,
                attemptScope,
                ...getKycSessionPersistenceBinding(kycRuntime)
              });
            }
            if (recovered?.sessionId !== persistedSessionId) {
              const error = new Error('A sessao paga nao pode ser retomada com seguranca');
              error.code = 'KYC_IDENTITY_RETRY_RESUME_SESSION_NOT_FOUND';
              error.providerDispatched = true;
              throw error;
            }
            sessionMetadata = recovered.sessionMetadata;
          }

          let resumableSession = null;
          if (sessionMetadata && !persistedSessionIsTerminal) {
            try {
              this.awsLivenessService.assertBoundSessionMetadata(sessionMetadata, {
                userId,
                expectedChallengeId: effectiveChallengeId,
                expectedRequirement: effectiveRequirement,
                ...getExpectedKycSessionPersistenceBinding(kycRuntime)
              });
              resumableSession = assertPersistedRetrySessionResumable({
                userId,
                challengeId: effectiveChallengeId,
                requirement: effectiveRequirement,
                attemptScope,
                attemptState,
                sessionMetadata
              });
            } catch (resumeError) {
              if (
                !requiresDurableRetryAuthorization
                && terminalSessionCodes.has(resumeError?.code)
              ) {
                persistedSessionIsTerminal = true;
              } else {
                throw resumeError;
              }
            }
          }

          if (resumableSession) {
            if (!verificationWindowClaim) {
              verificationWindowClaim = await trustService.claimVerificationWindow(userId, {
                token: resumableSession.verificationWindowToken,
                scope: 'aws_liveness_session_resume'
              });
              if (!verificationWindowClaim.acquired) {
                return res.status(409).json({
                  success: false,
                  error: 'Outra validacao de identidade ja esta em andamento',
                  code: 'KYC_VERIFICATION_IN_PROGRESS'
                });
              }
            }
            retainVerificationWindow = true;
            if (requiresDurableRetryAuthorization) {
              await workflowService.resumeCleanRetryAuthorization(
                userId,
                attemptScope,
                resumableSession.sessionId
              );
            }
            return res.status(200).json(buildResumedLivenessSessionResponse({
              provider: this.awsLivenessService.getProviderName(),
              sessionId: resumableSession.sessionId,
              sessionMetadata,
              config: this.awsLivenessService.getConfigSummary()
            }));
          }
        }

        if (verificationWindowClaim && persistedSessionIsTerminal) {
          await trustService.releaseVerificationWindow(verificationWindowClaim);
          verificationWindowClaim = null;
        }

        if (
          identityReviewGate.retrySessionResumeCandidate === true
          || (identityChallengeAlreadyValidating && !persistedSessionIsTerminal)
        ) {
          const error = new Error('A sessao anterior nao foi encontrada para retomada');
          error.code = 'KYC_IDENTITY_RETRY_RESUME_SESSION_NOT_FOUND';
          throw error;
        }

        verificationWindowClaim = await trustService.claimVerificationWindow(userId, {
          scope: 'aws_liveness_session'
        });
        if (!verificationWindowClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Outra validacao de identidade ja esta em andamento',
            code: 'KYC_VERIFICATION_IN_PROGRESS'
          });
        }

        cleanRetryAuthorizationClaim = await workflowService
          .claimCleanRetryAuthorization(userId, attemptScope);
        if (requiresDurableRetryAuthorization && !cleanRetryAuthorizationClaim) {
          const error = new Error('A autorizacao desta nova tentativa nao esta disponivel');
          error.code = 'KYC_IDENTITY_RETRY_AUTHORIZATION_REQUIRED';
          throw error;
        }

        if (isIdentityReverification) {
          const startedResult = typeof policyService.recordIdentityReverificationStarted === 'function'
            ? await policyService.recordIdentityReverificationStarted(userId, {
              challengeId: effectiveChallengeId,
              requirement: 'IDENTITY_REVERIFICATION'
            })
            : { success: true, recorded: true };
          if (startedResult?.recorded !== true) {
            const error = new Error(
              'Esta revalidacao foi substituida por uma solicitacao mais recente'
            );
            error.code = startedResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE';
            throw error;
          }
        }

        const session = await this.awsLivenessService.createSession({
          userId,
          challengeId: effectiveChallengeId,
          requirement: effectiveRequirement,
          attemptScope,
          verificationWindowToken: verificationWindowClaim.token,
          ...getKycSessionPersistenceBinding(kycRuntime)
        });
        cleanRetrySessionCreated = true;
        if (cleanRetryAuthorizationClaim) {
          await workflowService.consumeCleanRetryAuthorization(
            cleanRetryAuthorizationClaim,
            session.sessionId
          );
        }
        retainVerificationWindow = true;

        const publicSessionConfig = this.awsLivenessService.getConfigSummary();
        return res.status(201).json(buildPublicLivenessSessionResponse({
          ...session,
          provider: this.awsLivenessService.getProviderName(),
          region: publicSessionConfig.region
        }));
      } catch (error) {
        if (
          cleanRetryAuthorizationClaim
          && !cleanRetrySessionCreated
          && error?.providerDispatched !== true
        ) {
          await kycRuntime.workflowService.releaseCleanRetryAuthorization(
            cleanRetryAuthorizationClaim,
            { reason: error?.code || 'session_creation_failed_before_provider_dispatch' }
          ).catch((releaseError) => {
            logError(releaseError, 'Falha ao liberar autorizacao de retry nao despachada', {
              service: 'kyc-routes-routes',
              userId: req.body?.userId,
              caseId: cleanRetryAuthorizationClaim.caseId
            });
          });
        }
        const isDisabled = error?.code === 'AWS_LIVENESS_DISABLED';
        const attemptsExhausted = [
          'KYC_AWS_LIVENESS_ATTEMPTS_EXHAUSTED',
          'KYC_AWS_USER_DAILY_SESSION_LIMIT_EXHAUSTED'
        ].includes(error?.code);
        const activeTripDeferred = error?.code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
        const verificationBusy = error?.code === 'KYC_VERIFICATION_IN_PROGRESS';
        const admissionCapacityExhausted =
          error?.code === 'KYC_AWS_ADMISSION_CAPACITY_EXHAUSTED';
        const retryResumeUnavailable = String(error?.code || '')
          .startsWith('KYC_IDENTITY_RETRY_RESUME_')
          || [
            'KYC_IDENTITY_REVIEW_RETRY_RESUME_NOT_AVAILABLE',
            'KYC_IDENTITY_REVIEW_RETRY_SESSION_BINDING_INVALID',
            'KYC_IDENTITY_REVIEW_RETRY_ENFORCEMENT_INVALID',
            'AWS_LIVENESS_SESSION_METADATA_REQUIRED',
            'AWS_LIVENESS_SESSION_METADATA_INVALID',
            'AWS_LIVENESS_SESSION_EXPIRED',
            'AWS_LIVENESS_SESSION_ABANDONED',
            'AWS_LIVENESS_SESSION_USER_MISMATCH',
            'AWS_LIVENESS_SESSION_PROVIDER_MISMATCH',
            'AWS_LIVENESS_SESSION_ATTEMPT_SCOPE_INVALID',
            'AWS_LIVENESS_SESSION_CHALLENGE_MISMATCH',
            'AWS_LIVENESS_SESSION_REQUIREMENT_MISMATCH',
            'AWS_LIVENESS_SESSION_PERSISTENCE_SCOPE_MISMATCH',
            'AWS_LIVENESS_SESSION_FINANCIAL_CONTEXT_MISMATCH'
          ].includes(error?.code);
        const stateUnavailable = [
          'KYC_REVERIFY_STATE_UNAVAILABLE',
          'KYC_IDENTITY_REVIEW_STORE_UNAVAILABLE',
          'KYC_TRUST_STORE_UNAVAILABLE',
          'PERSISTENCE_USER_CLASSIFICATION_UNAVAILABLE',
          'KYC_RUNTIME_SERVICE_UNAVAILABLE',
          'KYC_RUNTIME_SERVICE_SCOPE_MISMATCH',
          'KYC_RUNTIME_SANDBOX_CONTEXT_REQUIRED',
          'KYC_AWS_LIVENESS_PERSISTENCE_BINDING_REQUIRED',
          'KYC_AWS_LIVENESS_COMMITTED_SESSION_RECOVERY_REQUIRED',
          'KYC_AWS_LIVENESS_RECOVERY_BINDING_REQUIRED',
          'KYC_AWS_LIVENESS_RECOVERY_BINDING_MISMATCH',
          'KYC_AWS_LIVENESS_RECOVERY_BINDING_COMMIT_FAILED',
          'KYC_AWS_LIVENESS_RECOVERY_EXPIRED',
          'KYC_AWS_LIVENESS_RECOVERY_STATE_UNAVAILABLE',
          'KYC_AWS_LIVENESS_EXPIRED_PROOF_BINDING_MISMATCH',
          'KYC_AWS_LIVENESS_EXPIRED_PROOF_NOT_TERMINAL',
          'KYC_AWS_LIVENESS_EXPIRED_PROOF_UNAVAILABLE',
          'KYC_AWS_LIVENESS_PERSISTENCE_BINDING_MISMATCH',
          'KYC_AWS_LIVENESS_METADATA_BINDING_COMMIT_FAILED',
          'KYC_AWS_COST_GUARD_REQUIRED',
          'KYC_AWS_COST_GUARD_UNAVAILABLE',
          'KYC_AWS_COST_OPERATION_NOT_FOUND',
          'KYC_AWS_COST_OPERATION_MISMATCH',
          'KYC_AWS_COST_OPERATION_STATE_INVALID',
          'KYC_AWS_ADMISSION_CONTROL_REQUIRED',
          'KYC_AWS_ADMISSION_CONTROL_UNAVAILABLE',
          'KYC_IDENTITY_RETRY_BINDING_REQUIRED',
          'KYC_IDENTITY_RETRY_AUTHORIZATION_REQUIRED'
        ].includes(error?.code)
          || String(error?.code || '').startsWith('PERSISTENCE_');
        const identityPermanentlyBlocked = error?.code === 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK';
        const challengeStale =
          error?.code === 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE';
        if (attemptsExhausted) {
          logError(error, 'Limite temporario de sessoes AWS liveness atingido', {
            service: 'kyc-routes-routes',
            userId: req.body?.userId || null
          });
          return sendLivenessAttemptRateLimit(res, error);
        }
        const statusCode = identityPermanentlyBlocked
          ? 423
          : ((activeTripDeferred || verificationBusy || retryResumeUnavailable || challengeStale)
            ? 409
            : ((isDisabled || stateUnavailable || admissionCapacityExhausted) ? 503 : 500));
        logError(error, 'Erro ao criar sessão AWS liveness', { service: 'kyc-routes-routes' });
        const publicError = identityPermanentlyBlocked
          ? 'Esta conta nao pode usar o modo motorista.'
          : challengeStale
            ? 'Sua solicitacao de validacao foi atualizada. Tente novamente.'
          : retryResumeUnavailable
            ? 'Sua sessao anterior nao esta mais disponivel. Fale com o suporte para liberar uma nova tentativa.'
            : admissionCapacityExhausted
              ? 'A capacidade de validacao esta temporariamente ocupada. Tente novamente em instantes.'
            : stateUnavailable
              ? 'Nao foi possivel preparar a validacao com seguranca agora. Tente novamente em alguns minutos.'
              : (activeTripDeferred
                ? 'A validacao deve ser feita fora de uma corrida.'
                : (verificationBusy
                  ? 'Outra validacao de identidade ja esta em andamento.'
                  : 'Nao foi possivel preparar a validacao agora. Tente novamente.'));
        return res.status(statusCode).json({
          success: false,
          error: publicError,
          code: error.code || 'KYC_AWS_LIVENESS_SESSION_ERROR',
          ...(admissionCapacityExhausted && error?.retryAfterSeconds
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {})
        });
      } finally {
        if (verificationWindowClaim?.acquired && !retainVerificationWindow) {
          await kycRuntime?.trustService
            .releaseVerificationWindow(verificationWindowClaim)
            .catch(() => null);
        }
      }
      }
    );

    this.router.post(
      '/liveness/aws/session/:sessionId/abandon',
      requireFirebaseUser,
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      try {
        const sessionId = typeof req.params.sessionId === 'string'
          ? req.params.sessionId.trim()
          : '';
        const userId = typeof req.body?.userId === 'string'
          ? req.body.userId.trim()
          : '';
        if (!sessionId) {
          return res.status(400).json({
            success: false,
            error: 'A sessao de validacao e obrigatoria',
            code: 'AWS_LIVENESS_SESSION_ID_REQUIRED'
          });
        }
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId e obrigatorio',
            code: 'KYC_AWS_LIVENESS_USER_REQUIRED'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        await kycRuntime.trustService.assertVerificationOutsideActiveTrip(userId);
        const sessionMetadata = await this.awsLivenessService.getSessionMetadata(sessionId);
        this.awsLivenessService.assertBoundSessionMetadata(sessionMetadata, {
          userId,
          ...getExpectedKycSessionPersistenceBinding(kycRuntime),
          allowAbandoned: true,
          allowExpired: true
        });
        const result = await this.awsLivenessService.abandonSession({
          sessionId,
          userId
        });
        await kycRuntime.workflowService.finalizeCleanRetryAuthorization({
          driverId: userId,
          attemptScope: sessionMetadata?.attemptScope || null,
          sessionId,
          outcome: 'ABORTED',
          reason: 'user_abandoned_liveness_session'
        });

        return res.json({
          success: true,
          abandoned: true,
          sessionId: result.sessionId
        });
      } catch (error) {
        const code = error?.code || error?.name || 'KYC_AWS_LIVENESS_ABANDON_ERROR';
        const clientErrorCodes = new Set([
          'AWS_LIVENESS_SESSION_ID_REQUIRED',
          'KYC_AWS_LIVENESS_USER_REQUIRED'
        ]);
        const conflictCodes = new Set([
          'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
          'KYC_AWS_LIVENESS_RESUME_REQUIRED',
          'KYC_AWS_LIVENESS_ABANDON_WINDOW_BINDING_REQUIRED'
        ]);
        const transientProviderCodes = new Set([
          'ThrottlingException',
          'ServiceUnavailableException',
          'InternalServerError',
          'InternalServerErrorException',
          'ProvisionedThroughputExceededException',
          'RequestTimeout',
          'TimeoutError'
        ]);
        let statusCode = 500;
        if (clientErrorCodes.has(code)) statusCode = 400;
        if (code === 'AWS_LIVENESS_SESSION_USER_MISMATCH') statusCode = 403;
        if (code === 'AWS_LIVENESS_SESSION_METADATA_REQUIRED') statusCode = 404;
        if (conflictCodes.has(code)) statusCode = 409;
        if (code === 'AWS_LIVENESS_DISABLED') statusCode = 503;
        if (transientProviderCodes.has(code)) statusCode = 503;
        if ([
          'KYC_AWS_ADMISSION_CAPACITY_EXHAUSTED',
          'KYC_AWS_ADMISSION_CONTROL_REQUIRED',
          'KYC_AWS_ADMISSION_CONTROL_UNAVAILABLE'
        ].includes(code)) statusCode = 503;

        logError(error, 'Erro ao encerrar sessao AWS liveness', {
          service: 'kyc-routes-routes',
          userId: req.body?.userId || null,
          sessionId: req.params?.sessionId || null
        });
        return res.status(statusCode).json({
          success: false,
          error: error.message,
          code,
          ...(code === 'KYC_AWS_ADMISSION_CAPACITY_EXHAUSTED' && error?.retryAfterSeconds
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
          ...(code === 'KYC_AWS_LIVENESS_RESUME_REQUIRED'
            ? {
              completed: true,
              livenessPassed: true,
              sessionId: error.result?.sessionId || req.params?.sessionId || null
            }
            : {})
        });
      }
      }
    );

    this.router.get(
      '/liveness/aws/session/:sessionId',
      requireFirebaseUser,
      requireFirebaseSelf(queryUserId),
      async (req, res) => {
      let verificationWindowClaim = null;
      let retainVerificationWindow = false;
      let kycRuntime = null;
      try {
        const { sessionId } = req.params;
        const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
        kycRuntime = await resolveRequestKycRuntime(req, userId);
        const sessionMetadata = await this.awsLivenessService.getSessionMetadata(sessionId);
        this.awsLivenessService.assertBoundSessionMetadata(sessionMetadata, {
          userId,
          ...getExpectedKycSessionPersistenceBinding(kycRuntime)
        });
        verificationWindowClaim = await kycRuntime.trustService.claimVerificationWindow(userId, {
          token: sessionMetadata.verificationWindowToken || null,
          scope: 'aws_liveness_poll'
        });
        if (!verificationWindowClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Outra validacao de identidade ja esta em andamento',
            code: 'KYC_VERIFICATION_IN_PROGRESS'
          });
        }
        retainVerificationWindow = true;
        const result = await this.awsLivenessService.getSessionResult({
          sessionId,
          userId,
          requireBoundMetadata: true
        });
        if (result?.completed === true && result?.livenessPassed !== true) {
          retainVerificationWindow = false;
        }
        if (isLivenessAttemptRateLimited(result)) {
          return sendLivenessAttemptRateLimit(res, result.attemptState);
        }

        return res.json(buildPublicLivenessSessionResponse({
          ...result,
          provider: this.awsLivenessService.getProviderName(),
          region: this.awsLivenessService.getConfigSummary().region,
          challengeType: sessionMetadata.challengeType || null,
          expiresAt: sessionMetadata.expiresAt || null
        }));
      } catch (error) {
        const code = error?.code || error?.name || 'KYC_AWS_LIVENESS_RESULT_ERROR';
        let statusCode = 500;
        if (code === 'AWS_LIVENESS_DISABLED') statusCode = 503;
        if (code === 'AWS_LIVENESS_SESSION_ID_REQUIRED') statusCode = 400;
        if (code === 'AWS_LIVENESS_SESSION_USER_MISMATCH') statusCode = 403;
        if (code === 'AWS_LIVENESS_SESSION_ABANDONED') statusCode = 409;
        if (code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP') statusCode = 409;
        if ([
          'KYC_AWS_ADMISSION_CAPACITY_EXHAUSTED',
          'KYC_AWS_ADMISSION_CONTROL_REQUIRED',
          'KYC_AWS_ADMISSION_CONTROL_UNAVAILABLE'
        ].includes(code)) statusCode = 503;
        if (code === 'ResourceNotFoundException' || code === 'SessionNotFoundException') statusCode = 404;
        if (code === 'ValidationException') statusCode = 400;

        logError(error, 'Erro ao consultar resultado AWS liveness', { service: 'kyc-routes-routes' });
        const publicError = code === 'AWS_LIVENESS_SESSION_ABANDONED'
          ? 'Esta sessao foi encerrada. Inicie uma nova validacao.'
          : (code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP'
            ? 'A validacao deve ser feita fora de uma corrida.'
            : ((code === 'ResourceNotFoundException' || code === 'SessionNotFoundException')
              ? 'Esta sessao expirou. Inicie uma nova validacao.'
              : 'Nao foi possivel confirmar a validacao agora. Tente novamente.'));
        return res.status(statusCode).json({
          success: false,
          error: publicError,
          code,
          ...(code === 'KYC_AWS_ADMISSION_CAPACITY_EXHAUSTED' && error?.retryAfterSeconds
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {})
        });
      } finally {
        if (verificationWindowClaim?.acquired && !retainVerificationWindow) {
          await kycRuntime?.trustService
            .releaseVerificationWindow(verificationWindowClaim)
            .catch(() => null);
        }
      }
      }
    );

    this.router.get(
      '/liveness/aws/credentials',
      requireFirebaseUser,
      requireFirebaseSelf(queryUserId),
      async (req, res) => {
      try {
        const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
        const sessionId = typeof req.query.sessionId === 'string'
          ? req.query.sessionId.trim()
          : '';
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório',
            code: 'KYC_AWS_LIVENESS_USER_REQUIRED'
          });
        }
        if (!sessionId) {
          return res.status(400).json({
            success: false,
            error: 'A sessão de validação é obrigatória',
            code: 'AWS_LIVENESS_CREDENTIALS_SESSION_BINDING_REQUIRED'
          });
        }
        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        await kycRuntime.trustService.assertVerificationOutsideActiveTrip(userId);
        const sessionMetadata = await this.awsLivenessService.getSessionMetadata(sessionId);
        this.awsLivenessService.assertBoundSessionMetadata(sessionMetadata, {
          userId,
          ...getExpectedKycSessionPersistenceBinding(kycRuntime)
        });
        const credentialsResult = await this.awsLivenessService.issueTemporaryCredentials({
          userId,
          sessionId
        });

        return res.json({
          success: true,
          provider: credentialsResult.provider,
          region: credentialsResult.region,
          source: credentialsResult.source,
          credentials: credentialsResult.credentials
        });
      } catch (error) {
        const code = error?.code || error?.name || 'KYC_AWS_LIVENESS_CREDENTIALS_ERROR';
        let statusCode = 500;
        if (code === 'AWS_LIVENESS_DISABLED' || code === 'AWS_LIVENESS_CREDENTIALS_DISABLED') statusCode = 503;
        if (code === 'AWS_LIVENESS_ASSUME_ROLE_MISSING') statusCode = 503;
        if (code === 'AWS_LIVENESS_CREDENTIALS_SESSION_BINDING_REQUIRED') statusCode = 400;
        if (code === 'AWS_LIVENESS_SESSION_METADATA_REQUIRED') statusCode = 404;
        if (code === 'AWS_LIVENESS_SESSION_EXPIRED') statusCode = 410;
        if (code === 'AWS_LIVENESS_SESSION_USER_MISMATCH') statusCode = 403;
        if (code === 'AWS_LIVENESS_SESSION_ABANDONED') statusCode = 409;
        if (code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP') statusCode = 409;
        if (code === 'AccessDenied' || code === 'AccessDeniedException') statusCode = 403;
        if (code === 'ValidationError' || code === 'ValidationException') statusCode = 400;

        logError(error, 'Erro ao emitir credenciais AWS liveness', { service: 'kyc-routes-routes' });
        const publicFailure = resolvePublicAwsLivenessCredentialsFailure(code);
        return res.status(statusCode).json({
          success: false,
          error: publicFailure.error,
          code,
          retryable: publicFailure.retryable
        });
      }
      }
    );
  }
}

module.exports = KYCRoutesLiveness;
