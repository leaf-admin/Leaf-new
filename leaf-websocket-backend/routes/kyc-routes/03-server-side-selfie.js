// Gerado a partir de routes/kyc-routes.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Verificação server-side pós-liveness

const {
  crypto,
  requireFirebaseUser,
  requireFirebaseSelf,
  logStructured,
  logError,
  bodyUserId,
  IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT,
  IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT_CODES,
  buildPublicCanonicalCompareResult,
  resolvePublicCanonicalConflictFailure,
  normalizeLivenessAttemptScope,
  sendIdentityReviewGateResponse,
  persistIdentityMismatchHold,
  resolveRequestKycRuntime,
  getExpectedKycSessionPersistenceBinding,
  createIdentityLeaseHeartbeat,
  sendLivenessAttemptRateLimit,
  isLivenessAttemptRateLimited,
} = require('./shared');

class KYCRoutesServerSideSelfie {
  registerServerSideSelfieRoutes() {
    this.router.post(
      '/verify-driver/server-side-selfie',
      requireFirebaseUser,
      this.upload.single('currentImage'),
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      let canonicalSessionClaim = null;
      let retainVerificationWindow = false;
      let leaseHeartbeat = null;
      let kycRuntime = null;
      try {
        const { userId, awsSessionId, forceRecheck } = req.body || {};
        let { challengeId, requirement } = req.body || {};

        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        if (!awsSessionId) {
          return res.status(400).json({
            success: false,
            error: 'Sessão AWS de liveness é obrigatória para esta verificação',
            code: 'KYC_AWS_LIVENESS_SESSION_REQUIRED'
          });
        }

        kycRuntime = await resolveRequestKycRuntime(req, userId);
        const {
          trustService,
          evidenceService,
          workflowService,
          policyService,
          scope: persistenceScope
        } = kycRuntime;

        if (kycRuntime.namespace === 'sandbox' && !this.usesAwsCanonicalFaceCompare()) {
          return res.status(503).json({
            success: false,
            error: 'A validacao de identidade esta temporariamente indisponivel. Tente novamente em alguns minutos.',
            code: 'KYC_CANONICAL_FACE_PROVIDER_UNAVAILABLE'
          });
        }

        let isIdentityReverificationRequest =
          requirement === 'IDENTITY_REVERIFICATION' ||
          String(challengeId || '').startsWith('idrev_');
        let effectiveRequirement = requirement || null;
        let stepUpChallenge = null;
        if (isIdentityReverificationRequest) {
          effectiveRequirement = 'IDENTITY_REVERIFICATION';
        } else if (challengeId) {
          stepUpChallenge = await policyService.getStepUpChallenge(challengeId, userId);
          if (!stepUpChallenge) {
            return res.status(404).json({
              success: false,
              error: 'Challenge KYC não encontrado ou expirado',
              code: 'KYC_CHALLENGE_NOT_FOUND'
            });
          }
          effectiveRequirement = stepUpChallenge.requirement || effectiveRequirement || 'VERIFY_REQUIRED';
        }

        const firstAccessPolicy = kycRuntime.namespace === 'sandbox'
          ? { required: false }
          : await policyService.requiresFirstAccessLiveness(userId);
        let firstAccessLivenessRequired = !challengeId && firstAccessPolicy.required === true;
        if (!effectiveRequirement && firstAccessLivenessRequired) {
          effectiveRequirement = 'LIVENESS_REQUIRED';
        }

        let boundSessionMetadata = null;
        let sessionMetadataCandidate = null;
        let sessionMetadataError = null;
        try {
          sessionMetadataCandidate = await this.awsLivenessService.getSessionMetadata(awsSessionId);
          const canonicalRetryAttemptScope = normalizeLivenessAttemptScope(
            sessionMetadataCandidate?.attemptScope || ''
          );
          if (
            canonicalRetryAttemptScope.startsWith('manual_review_retry_')
            || canonicalRetryAttemptScope.startsWith('orphan_hold_retry_')
          ) {
            const canonicalChallengeId = String(
              sessionMetadataCandidate?.challengeId || ''
            ).trim();
            const canonicalRequirement = String(
              sessionMetadataCandidate?.requirement || ''
            ).trim();
            if (
              !canonicalChallengeId.startsWith('idrev_')
              || canonicalRequirement !== 'IDENTITY_REVERIFICATION'
            ) {
              const bindingError = new Error('A sessao perdeu o vinculo canonico de revalidacao');
              bindingError.code = 'AWS_LIVENESS_SESSION_METADATA_INVALID';
              throw bindingError;
            }
            challengeId = canonicalChallengeId;
            requirement = canonicalRequirement;
            effectiveRequirement = canonicalRequirement;
            isIdentityReverificationRequest = true;
            firstAccessLivenessRequired = false;
            stepUpChallenge = null;
          }
          this.awsLivenessService.assertBoundSessionMetadata(sessionMetadataCandidate, {
            userId,
            expectedChallengeId: challengeId || null,
            expectedRequirement: effectiveRequirement || null,
            ...getExpectedKycSessionPersistenceBinding(kycRuntime)
          });
          boundSessionMetadata = sessionMetadataCandidate;
        } catch (error) {
          sessionMetadataError = error;
        }
        if (sessionMetadataError?.code === 'AWS_LIVENESS_SESSION_ABANDONED') {
          throw sessionMetadataError;
        }
        if ([
          'AWS_LIVENESS_SESSION_PERSISTENCE_SCOPE_MISMATCH',
          'AWS_LIVENESS_SESSION_FINANCIAL_CONTEXT_MISMATCH',
          'AWS_LIVENESS_SESSION_METADATA_INVALID'
        ].includes(sessionMetadataError?.code)) {
          throw sessionMetadataError;
        }

        const identityReviewGate = await workflowService
          .assertKycOperationAllowed(userId, {
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            awsSessionId
          });
        if (
          identityReviewGate.retryAuthorizationId
          && identityReviewGate.sessionBoundRetryAuthorized !== true
        ) {
          retainVerificationWindow = false;
          return res.status(409).json({
            success: false,
            error: 'Esta sessao nao corresponde a nova tentativa autorizada. Inicie uma nova validacao.',
            code: 'KYC_IDENTITY_RETRY_SESSION_BINDING_REQUIRED'
          });
        }
        if (identityReviewGate.identityReviewHold) {
          retainVerificationWindow = false;
          return sendIdentityReviewGateResponse(res, identityReviewGate);
        }

        canonicalSessionClaim = await trustService.claimCanonicalSession(
          userId,
          awsSessionId,
          {
            verificationWindowToken:
              sessionMetadataCandidate?.verificationWindowToken || null
          }
        );
        if (canonicalSessionClaim.verificationWindowClaim?.acquired) {
          retainVerificationWindow = true;
        }
        if (!canonicalSessionClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Esta sessao AWS ja esta sendo processada',
            code: 'KYC_CANONICAL_SESSION_BUSY'
          });
        }
        if (canonicalSessionClaim.consumed) {
          leaseHeartbeat = createIdentityLeaseHeartbeat(
            () => trustService.renewCanonicalSessionClaim(canonicalSessionClaim)
          );
          await leaseHeartbeat.assertHeld();
          const reconciledRejection = typeof trustService.restoreRejectedIdentityVerification === 'function'
            ? trustService.restoreRejectedIdentityVerification(
              userId,
              canonicalSessionClaim.sessionHash || null,
              canonicalSessionClaim.existingEvidence,
              {
                challengeId: challengeId || null,
                requirement: effectiveRequirement
              }
            )
            : null;
          if (reconciledRejection) {
            const reviewEvidenceCandidate = String(
              reconciledRejection.reviewEvidenceId || ''
            ).trim();
            const reviewEvidenceId = /^[A-Za-z0-9_-]{16,128}$/
              .test(reviewEvidenceCandidate)
              ? reviewEvidenceCandidate
              : null;
            await trustService.assertVerificationOutsideActiveTrip(userId);
            if (
              isIdentityReverificationRequest
              && kycRuntime.namespace === 'operational'
            ) {
              if (
                typeof policyService.reconcileRejectedIdentityReverificationMirror
                !== 'function'
              ) {
                const mirrorUnavailable = new Error(
                  'Espelho RTDB de rejeicao canonica indisponivel'
                );
                mirrorUnavailable.code = 'KYC_REVERIFY_STATE_UNAVAILABLE';
                throw mirrorUnavailable;
              }

              let identityMirrorResult = null;
              try {
                identityMirrorResult = await policyService
                  .reconcileRejectedIdentityReverificationMirror(userId, {
                    ...reconciledRejection,
                    attemptScope: sessionMetadataCandidate?.attemptScope || null,
                    canonicalRecordedAt:
                      canonicalSessionClaim.existingEvidence?.recordedAt || null
                  });
              } catch (policyError) {
                const mirrorUnavailable = new Error(
                  'Espelho RTDB de rejeicao canonica nao foi confirmado'
                );
                mirrorUnavailable.code = 'KYC_REVERIFY_STATE_UNAVAILABLE';
                mirrorUnavailable.cause = policyError;
                throw mirrorUnavailable;
              }
              if (identityMirrorResult?.recorded !== true) {
                const mirrorResultCode = String(
                  identityMirrorResult?.code || ''
                ).trim();
                if (identityMirrorResult?.stale === true) {
                  const mirrorConflict = new Error(
                    'Espelho RTDB de rejeicao canonica foi substituido'
                  );
                  mirrorConflict.code =
                    IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT_CODES
                      .has(mirrorResultCode)
                      ? mirrorResultCode
                      : IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT;
                  mirrorConflict.mirrorCode = mirrorResultCode || null;
                  throw mirrorConflict;
                }
                const mirrorUnconfirmed = new Error(
                  'Espelho RTDB de rejeicao canonica nao foi confirmado'
                );
                mirrorUnconfirmed.code = 'KYC_REVERIFY_STATE_UNAVAILABLE';
                mirrorUnconfirmed.mirrorCode = mirrorResultCode || null;
                throw mirrorUnconfirmed;
              }
              await leaseHeartbeat.assertHeld();
            }

            await workflowService.finalizeCleanRetryAuthorization({
              driverId: userId,
              attemptScope: sessionMetadataCandidate?.attemptScope || null,
              sessionId: awsSessionId,
              outcome: 'REJECTED',
              resultEvidenceId: reconciledRejection.evidenceId,
              reason: 'canonical_face_compare_rejection_reconciliation'
            });
            if (
              isIdentityReverificationRequest
              && kycRuntime.namespace !== 'operational'
            ) {
              try {
                const identityMirrorResult =
                  typeof policyService.recordIdentityReverificationResult === 'function'
                    ? await policyService.recordIdentityReverificationResult(userId, {
                      ...reconciledRejection,
                      reconciliationOnly: true
                    })
                    : null;
                if (identityMirrorResult?.recorded !== true) {
                  logStructured('warn', 'Espelho de rejeicao canonica nao foi atualizado', {
                    service: 'kyc-routes-routes',
                    userId,
                    challengeId: challengeId || null,
                    code: identityMirrorResult?.code || null
                  });
                }
              } catch (policyError) {
                logError(policyError, 'Falha no espelho de uma rejeicao canonica reconciliada', {
                  service: 'kyc-routes-routes',
                  userId,
                  challengeId: challengeId || null
                });
              }
            }
            await leaseHeartbeat.assertHeld();
            retainVerificationWindow = false;
            return res.status(403).json(buildPublicCanonicalCompareResult({}, {
              success: false,
              error: 'Não foi possível confirmar sua identidade.',
              code: 'KYC_CHALLENGE_NOT_PASSED',
              isMatch: false,
              reviewAvailable: Boolean(reviewEvidenceId),
              evidenceId: reviewEvidenceId,
              idempotentReconciliation: true
            }));
          }
          const reconciledVerification = typeof trustService.restoreApprovedIdentityVerification === 'function'
            ? trustService.restoreApprovedIdentityVerification(
              userId,
              canonicalSessionClaim.sessionHash || null,
              canonicalSessionClaim.existingEvidence,
              {
                challengeId: challengeId || null,
                requirement: effectiveRequirement
              }
            )
            : null;
          if (reconciledVerification) {
            await trustService.assertVerificationOutsideActiveTrip(userId);
            if (isIdentityReverificationRequest) {
              const identityResult = typeof policyService.recordIdentityReverificationResult === 'function'
                ? await policyService.recordIdentityReverificationResult(
                userId,
                {
                  ...reconciledVerification,
                  reconciliationOnly: true
                }
                )
                : { success: true, recorded: true };
              if (identityResult?.recorded !== true) {
                retainVerificationWindow = false;
                return res.status(409).json({
                  success: false,
                  error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
                  code: identityResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
                });
              }
            }
            const reconciliationSource = isIdentityReverificationRequest
              ? 'canonical_identity_reconciliation'
              : 'canonical_first_access_reconciliation';
            if (typeof policyService.recordVerificationSuccess === 'function') {
              await policyService.recordVerificationSuccess(userId, {
                source: reconciliationSource,
                markFirstAccess: firstAccessLivenessRequired,
                clearReverify: false
              });
            }
            await workflowService.finalizeCleanRetryAuthorization({
              driverId: userId,
              attemptScope: sessionMetadataCandidate?.attemptScope || null,
              sessionId: awsSessionId,
              outcome: 'SUCCEEDED',
              resultEvidenceId: canonicalSessionClaim.sessionHash || null,
              reason: reconciliationSource
            });
            await workflowService.clearResolvedMismatchHold(userId, {
              source: reconciliationSource
            });
            await leaseHeartbeat.assertHeld();
            retainVerificationWindow = false;
            return res.json(buildPublicCanonicalCompareResult(reconciledVerification, {
              idempotentReconciliation: true
            }));
          }
          retainVerificationWindow = false;
          return res.status(409).json({
            success: false,
            error: 'Sessao AWS ja consumida por uma evidencia canonica',
            code: 'KYC_AWS_SESSION_ALREADY_CONSUMED'
          });
        }
        if (sessionMetadataError) {
          retainVerificationWindow = false;
          throw sessionMetadataError;
        }
        retainVerificationWindow = true;
        leaseHeartbeat = createIdentityLeaseHeartbeat(
          () => trustService.renewCanonicalSessionClaim(canonicalSessionClaim)
        );
        await leaseHeartbeat.assertHeld();

        let livenessPayload = {
          mode: 'server_biometric_selfie_v1',
          provider: 'leaf_face_compare_service',
          awsSessionId,
          aws: {
            sessionId: awsSessionId,
            provider: this.awsLivenessService.getProviderName()
          }
        };

        let awsResult = null;
        try {
          awsResult = await this.awsLivenessService.getSessionResult({
            sessionId: awsSessionId,
            userId,
            requireBoundMetadata: true,
            expectedChallengeId: challengeId || null,
            expectedRequirement: effectiveRequirement || null,
            includeReferenceImage: true
          });
          if (!awsResult.completed) {
            return res.status(202).json({
              success: false,
              code: 'KYC_AWS_LIVENESS_PENDING',
              error: 'Sessão AWS de liveness ainda está em processamento',
              sessionId: awsResult.sessionId,
              status: awsResult.status
            });
          }
          livenessPayload = this.awsLivenessService.toDevicePayload(awsResult, livenessPayload);
          if (isLivenessAttemptRateLimited(awsResult)) {
            await workflowService.finalizeCleanRetryAuthorization({
              driverId: userId,
              attemptScope: sessionMetadataCandidate?.attemptScope || null,
              sessionId: awsSessionId,
              outcome: 'ABORTED',
              reason: 'aws_liveness_attempt_rate_limited'
            });
            retainVerificationWindow = false;
            return sendLivenessAttemptRateLimit(res, awsResult.attemptState);
          }
        } catch (awsError) {
          const awsCode = awsError?.code || awsError?.name || 'KYC_AWS_LIVENESS_FAILED';
          const awsStatus = awsCode === 'AWS_LIVENESS_DISABLED'
            ? 503
            : (awsCode === 'ResourceNotFoundException' ? 404 : 400);
          return res.status(awsStatus).json({
            success: false,
            error: awsStatus === 404
              ? 'A sessao de validacao foi encerrada. Inicie uma nova tentativa.'
              : 'Nao foi possivel confirmar a validacao agora. Tente novamente.',
            code: awsCode
          });
        }

        if (!policyService.isLivenessSatisfied(livenessPayload)) {
          await workflowService.finalizeCleanRetryAuthorization({
            driverId: userId,
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            sessionId: awsSessionId,
            outcome: 'ABORTED',
            reason: 'aws_liveness_not_satisfied'
          });
          retainVerificationWindow = false;
          return res.status(412).json({
            success: false,
            error: 'Liveness obrigatório para concluir esta verificação',
            code: 'KYC_LIVENESS_REQUIRED',
            requirement: effectiveRequirement || 'LIVENESS_REQUIRED'
          });
        }

        await trustService.assertVerificationOutsideActiveTrip(userId);

        const referenceImageAvailable = Buffer.isBuffer(awsResult?.referenceImageBuffer)
          && awsResult.referenceImageBuffer.length > 0;
        if (!referenceImageAvailable) {
          await leaseHeartbeat.assertHeld();
          const recovery = await this.awsLivenessService.grantReferenceImageRecoveryAttempt({
            userId,
            sessionId: awsSessionId,
            requirement: effectiveRequirement,
            attemptScope: awsResult?.attemptScope || awsResult?.attemptState?.attemptScope || null,
            persistenceNamespace: sessionMetadataCandidate?.persistenceNamespace || null,
            financialContextId: sessionMetadataCandidate?.financialContextId || null
          });
          await workflowService.finalizeCleanRetryAuthorization({
            driverId: userId,
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            sessionId: awsSessionId,
            outcome: 'ABORTED',
            reason: 'aws_reference_image_unavailable'
          });
          retainVerificationWindow = false;
          if (recovery.canRetry !== true) {
            return res.status(503).json({
              success: false,
              error: 'Não foi possível concluir esta validação agora. Tente novamente mais tarde.',
              code: 'KYC_AWS_REFERENCE_IMAGE_TEMPORARILY_UNAVAILABLE',
              retryable: false
            });
          }
          return res.status(422).json({
            success: false,
            error: 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.',
            code: 'KYC_AWS_REFERENCE_IMAGE_REQUIRED',
            retryable: true
          });
        }

        await leaseHeartbeat.assertHeld();

        let verificationResult;
        try {
          verificationResult = await this.verifyCanonicalFaceMatch(
            userId,
            awsResult,
            {
              recoverBlocked: true,
              skipStatusSideEffects: true,
              writeVerificationCache: false,
              forceRecheck: forceRecheck === 'true' || forceRecheck === true,
              requirement: effectiveRequirement,
              challengeId: challengeId || null,
              filename: 'aws-liveness-reference.jpg',
              contentType: 'image/jpeg'
            }
          );
        } catch (comparisonError) {
          if (comparisonError?.code !== 'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED') {
            throw comparisonError;
          }
          await leaseHeartbeat.assertHeld();
          const recovery = await this.awsLivenessService.grantReferenceImageRecoveryAttempt({
            userId,
            sessionId: awsSessionId,
            requirement: effectiveRequirement,
            attemptScope: awsResult?.attemptScope || awsResult?.attemptState?.attemptScope || null,
            persistenceNamespace: sessionMetadataCandidate?.persistenceNamespace || null,
            financialContextId: sessionMetadataCandidate?.financialContextId || null
          });
          await workflowService.finalizeCleanRetryAuthorization({
            driverId: userId,
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            sessionId: awsSessionId,
            outcome: 'ABORTED',
            reason: comparisonError.code || 'aws_reference_face_not_detected'
          });
          retainVerificationWindow = false;
          if (recovery.canRetry !== true) {
            return res.status(503).json({
              success: false,
              error: 'Não foi possível concluir esta validação agora. Tente novamente mais tarde.',
              code: 'KYC_AWS_REFERENCE_IMAGE_TEMPORARILY_UNAVAILABLE',
              retryable: false
            });
          }
          return res.status(422).json({
            success: false,
            error: 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.',
            code: comparisonError.code,
            retryable: true
          });
        }

        if (!verificationResult.success) {
          const status = verificationResult.code === 'BIOMETRIC_FACE_SERVICE_NOT_CONFIGURED'
            ? 503
            : (verificationResult.code === 'CNH_FACE_EMBEDDING_NOT_FOUND' ? 409 : 400);
          return res.status(status).json(buildPublicCanonicalCompareResult(
            verificationResult,
            {
              success: false,
              error: 'Não foi possível concluir a validação agora.',
              code: verificationResult.code || 'KYC_CANONICAL_COMPARE_FAILED',
              requirement: effectiveRequirement || 'LIVENESS_REQUIRED',
              challengeId: challengeId || null
            }
          ));
        }

        await leaseHeartbeat.assertHeld();
        await trustService.assertVerificationOutsideActiveTrip(userId);

        if (!verificationResult.isMatch) {
          const failureRecord = await trustService.recordCanonicalFailure(userId, {
            awsSessionId,
            sourcePath: 'server_side_aws_reference_compare',
            reason: isIdentityReverificationRequest
              ? 'identity_reverification_failed'
              : 'canonical_face_compare_failed',
            challengeId: challengeId || null,
            requirement: effectiveRequirement || null,
            decision: verificationResult.decision || null,
            similarityScore: verificationResult.similarityScore,
            referenceImageSha256: crypto
              .createHash('sha256')
              .update(awsResult.referenceImageBuffer)
              .digest('hex')
          });
          if (failureRecord?.idempotentReplay) {
            retainVerificationWindow = false;
            return res.status(409).json({
              success: false,
              error: 'Sessao AWS ja utilizada anteriormente',
              code: 'KYC_AWS_SESSION_ALREADY_CONSUMED'
            });
          }

          let reviewEvidence = null;
          let reviewEvidenceLinkedToTrust = false;
          try {
            reviewEvidence = await evidenceService.captureRejectedComparisonEvidence({
              driverId: userId,
              referenceImageBuffer: awsResult.referenceImageBuffer,
              liveness: verificationResult.liveness,
              comparison: verificationResult,
              cnh: verificationResult.reference
            });
            await trustService.linkReviewEvidenceToCanonicalFailure(userId, {
              failureEvidenceId: failureRecord?.evidenceId,
              reviewEvidenceId: reviewEvidence?.evidenceId
            });
            reviewEvidenceLinkedToTrust = true;
          } catch (evidenceError) {
            // A indisponibilidade da trilha de revisão jamais transforma uma
            // divergência canônica em aprovação. O hard-fail permanece ativo.
            logError(evidenceError, 'Falha ao reter evidencia privada de divergencia facial', {
              service: 'kyc-routes-routes',
              userId,
              code: evidenceError?.code || null
            });
          }
          const retryFinalization = await workflowService.finalizeCleanRetryAuthorization({
            driverId: userId,
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            sessionId: awsSessionId,
            outcome: 'REJECTED',
            resultEvidenceId: failureRecord?.evidenceId || null,
            reason: 'canonical_face_compare_rejected'
          });
          let mismatchHoldPersisted = false;
          if (!retryFinalization) {
            try {
              await persistIdentityMismatchHold(userId, {
                evidenceId: reviewEvidence?.evidenceId || null,
                decision: verificationResult.decision || 'reject',
                persistenceScope
              });
              mismatchHoldPersisted = true;
            } catch (holdError) {
              // O trust canônico já foi revogado acima; este espelho adicional
              // existe para impedir troca de CNH e novas chamadas pagas.
              logError(holdError, 'Falha ao persistir hold de divergencia facial', {
                service: 'kyc-routes-routes',
                userId,
                code: holdError?.code || null
              });
            }
          }
          if (reviewEvidence?.evidenceId && !reviewEvidenceLinkedToTrust && !mismatchHoldPersisted) {
            await evidenceService.deleteEvidence(reviewEvidence.evidenceId, {
              actorId: 'system:kyc_mismatch_binding_recovery',
              reason: 'review_evidence_binding_failed'
            }).catch((cleanupError) => {
              logError(cleanupError, 'Falha ao limpar evidencia sem binding recuperavel', {
                service: 'kyc-routes-routes',
                userId,
                code: cleanupError?.code || null
              });
            });
          }
          const reviewEvidenceTraceable = Boolean(
            reviewEvidence?.evidenceId
            && (reviewEvidenceLinkedToTrust || mismatchHoldPersisted)
          );
          if (isIdentityReverificationRequest) {
            const identityResult = typeof policyService.recordIdentityReverificationResult === 'function'
              ? await policyService.recordIdentityReverificationResult(userId, {
                ...verificationResult,
                requirement: effectiveRequirement,
                challengeId: challengeId || null
              })
              : { success: true, recorded: true };
            if (identityResult?.recorded !== true) {
              return res.status(409).json({
                success: false,
                error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
                code: identityResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
              });
            }
          }
          retainVerificationWindow = false;
          return res.status(403).json(buildPublicCanonicalCompareResult({}, {
            success: false,
            error: isIdentityReverificationRequest
              ? 'Não foi possível concluir a validação agora'
              : 'Verificação facial não aprovada para este desafio',
            code: 'KYC_CHALLENGE_NOT_PASSED',
            isMatch: false,
            reviewAvailable: reviewEvidenceTraceable,
            evidenceId: reviewEvidenceTraceable ? reviewEvidence.evidenceId : null
          }));
        }

        let canonicalRecord = null;
        if (verificationResult.isMatch) {
          try {
            canonicalRecord = await trustService.recordCanonicalSuccess(userId, {
              driverId: userId,
              sourcePath: 'server_side_aws_reference_compare',
              awsSessionId,
              livenessProvider: awsResult.provider,
              livenessStatus: awsResult.status,
              livenessPassed: awsResult.livenessPassed === true,
              livenessConfidence: awsResult.confidence,
              livenessThreshold: awsResult.confidenceThreshold,
              referenceImageSha256: crypto
                .createHash('sha256')
                .update(awsResult.referenceImageBuffer)
                .digest('hex'),
              isMatch: verificationResult.isMatch,
              needsReview: verificationResult.needsReview === true,
              similarityScore: verificationResult.similarityScore,
              threshold: verificationResult.threshold,
              reviewThreshold: verificationResult.reviewThreshold,
              decision: verificationResult.decision,
              provider: verificationResult.provider,
              comparisonProvider: verificationResult.comparisonProvider,
              embeddingDimension: verificationResult.embeddingDimension,
              reference: verificationResult.reference || null,
              currentModel: verificationResult.current?.model || null,
              verifiedAt: awsResult.completedAt
                || awsResult.sessionMetadata?.completedAt
                || awsResult.sessionMetadata?.createdAt
                || verificationResult.timestamp
                || new Date().toISOString(),
              challengeId: challengeId || null,
              challengeSource: stepUpChallenge?.source || (
                isIdentityReverificationRequest ? 'identity_reverification' : 'first_access'
              ),
              requirement: effectiveRequirement || null,
              randomAuditDay: stepUpChallenge?.metadata?.randomAuditDay || null,
              resolveStepUpChallenge: Boolean(challengeId && !isIdentityReverificationRequest)
            });
          } catch (canonicalError) {
            logError(canonicalError, 'Falha ao persistir evidencia canonica de identidade', {
              service: 'kyc-routes-routes',
              userId,
              challengeId
            });
            const canonicalConflict = new Set([
              'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
              'KYC_CANONICAL_EVIDENCE_HASH_CONFLICT',
              'KYC_CANONICAL_CHALLENGE_BINDING_INVALID',
              'KYC_CANONICAL_CHALLENGE_NOT_FOUND'
            ]).has(canonicalError.code);
            const publicFailure = resolvePublicCanonicalConflictFailure(
              canonicalError?.code,
              { stateUnavailable: !canonicalConflict }
            );
            return res.status(canonicalConflict ? 409 : 503).json(buildPublicCanonicalCompareResult({}, {
              success: false,
              error: publicFailure.error,
              code: canonicalError.code || 'KYC_CANONICAL_EVIDENCE_PERSIST_FAILED',
              retryable: publicFailure.retryable
            }));
          }
        }

        if (canonicalRecord?.idempotentReplay) {
          retainVerificationWindow = false;
          return res.status(409).json({
            success: false,
            error: 'Sessao AWS ja utilizada anteriormente',
            code: 'KYC_AWS_SESSION_ALREADY_CONSUMED'
          });
        }

        if (isIdentityReverificationRequest) {
          const identityResult = typeof policyService.recordIdentityReverificationResult === 'function'
            ? await policyService.recordIdentityReverificationResult(userId, {
              ...verificationResult,
              requirement: effectiveRequirement,
              challengeId: challengeId || null
            })
            : { success: true, recorded: true };
          if (identityResult?.recorded !== true) {
            return res.status(409).json({
              success: false,
              error: 'Esta revalidacao foi substituida por uma solicitacao mais recente',
              code: identityResult?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
            });
          }
        }

        if (verificationResult.isMatch) {
          if (typeof policyService.recordVerificationSuccess === 'function') {
            await policyService.recordVerificationSuccess(userId, {
              source: challengeId ? 'stepup_challenge' : 'server_side_selfie_verify',
              markFirstAccess: firstAccessLivenessRequired,
              clearReverify: false
            });
          }
          await workflowService.finalizeCleanRetryAuthorization({
            driverId: userId,
            attemptScope: sessionMetadataCandidate?.attemptScope || null,
            sessionId: awsSessionId,
            outcome: 'SUCCEEDED',
            resultEvidenceId: canonicalRecord?.evidenceId || null,
            reason: 'canonical_identity_match'
          });
          await workflowService.clearResolvedMismatchHold(userId, {
            source: 'server_side_aws_reference_compare'
          });
        }

        retainVerificationWindow = false;

        return res.json(buildPublicCanonicalCompareResult(verificationResult, {
          success: true,
          isMatch: verificationResult.isMatch,
          needsReview: verificationResult.needsReview || false,
          requirement: effectiveRequirement || 'LIVENESS_REQUIRED',
          challengeId: challengeId || null
        }));
      } catch (error) {
        logError(error, 'Erro na verificação server-side pós-liveness:', { service: 'kyc-routes-routes' });
        const conflictCodes = new Set([
          'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
          'KYC_VERIFICATION_LEASE_LOST',
          ...IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT_CODES,
          IDENTITY_REVERIFY_REJECTION_MIRROR_CONFLICT,
          'KYC_CANONICAL_EVIDENCE_HASH_CONFLICT',
          'KYC_CANONICAL_CHALLENGE_BINDING_INVALID',
          'KYC_CANONICAL_CHALLENGE_NOT_FOUND',
          'AWS_LIVENESS_SESSION_ABANDONED',
          'KYC_IDENTITY_REVIEW_HOLD',
          'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK'
        ]);
        const stateUnavailable = [
          'KYC_REVERIFY_STATE_UNAVAILABLE',
          'KYC_IDENTITY_REVIEW_STORE_UNAVAILABLE',
          'KYC_TRUST_STORE_UNAVAILABLE'
        ].includes(error?.code);
        const documentImageCodes = new Set([
          'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
          'KYC_CNH_PORTRAIT_LAYOUT_UNSUPPORTED',
          'KYC_CNH_PORTRAIT_EXTRACTION_FAILED'
        ]);
        const livenessImageCodes = new Set([
          'AWS_COMPARE_FACES_LIVENESS_FACE_BOUNDS_REQUIRED',
          'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED',
          'KYC_AWS_REFERENCE_IMAGE_REQUIRED'
        ]);
        const isDocumentImageFailure = documentImageCodes.has(error?.code);
        const isLivenessImageFailure = livenessImageCodes.has(error?.code);
        if (isDocumentImageFailure || isLivenessImageFailure) {
          retainVerificationWindow = false;
        }
        const identityPermanentlyBlocked = error?.code === 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK';
        const statusCode = identityPermanentlyBlocked
          ? 423
          : stateUnavailable
          ? 503
          : (conflictCodes.has(error?.code)
            ? 409
            : ((isDocumentImageFailure || isLivenessImageFailure) ? 422 : 500));
        const canonicalPublicFailure = resolvePublicCanonicalConflictFailure(error?.code, {
          stateUnavailable
        });
        const safeError = identityPermanentlyBlocked
          ? canonicalPublicFailure.error
          : isDocumentImageFailure
          ? 'Não conseguimos identificar a foto na CNH aprovada. Envie uma nova versão do documento.'
          : (isLivenessImageFailure
            ? 'Não conseguimos usar a imagem desta validação. Inicie uma nova tentativa.'
            : ((stateUnavailable || conflictCodes.has(error?.code))
              ? canonicalPublicFailure.error
              : 'Erro interno do servidor'));
        return res.status(statusCode).json(buildPublicCanonicalCompareResult({}, {
          success: false,
          error: safeError,
          code: error?.code || 'KYC_SERVER_SIDE_VERIFICATION_ERROR',
          ...((stateUnavailable || conflictCodes.has(error?.code))
            ? { retryable: canonicalPublicFailure.retryable }
            : {})
        }));
      } finally {
        leaseHeartbeat?.stop();
        await kycRuntime?.trustService
          .releaseCanonicalSessionClaim(canonicalSessionClaim, {
            releaseVerificationWindow: (
              canonicalSessionClaim?.consumed === true
              && canonicalSessionClaim?.acquired === true
            ) || !retainVerificationWindow
          })
          .catch(() => null);
      }
      }
    );
  }
}

module.exports = KYCRoutesServerSideSelfie;
