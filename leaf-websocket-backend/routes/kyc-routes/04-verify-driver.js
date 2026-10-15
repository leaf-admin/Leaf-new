// Gerado a partir de routes/kyc-routes.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Verificação legada do motorista

const {
  requireFirebaseUser,
  requireFirebaseSelf,
  logError,
  bodyUserId,
  withoutSensitiveBiometricPayload,
  resolveRequestKycRuntime,
  getExpectedKycSessionPersistenceBinding,
  requiresCanonicalVerificationRoute,
  sendCanonicalRouteRequired,
  requireOperationalLegacyKycRoute,
} = require('./shared');

class KYCRoutesVerifyDriver {
  registerVerifyDriverRoutes() {
    this.router.post(
      '/verify-driver',
      requireFirebaseUser,
      requireOperationalLegacyKycRoute,
      this.upload.single('currentImage'),
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      let verificationWindowClaim = null;
      let retainVerificationWindow = false;
      let kycRuntime = null;
      try {
        const { userId, forceRecheck, cacheValidityHours } = req.body;
        
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendCanonicalRouteRequired(res);
        }
        const { policyService } = kycRuntime;

        const legacyChallengeId = req.body?.challengeId || null;
        const [approvalGate, firstAccessPolicy, implicitChallenge] = await Promise.all([
          policyService.requireApprovedKyc(userId),
          kycRuntime.namespace === 'sandbox'
            ? Promise.resolve({ required: false })
            : policyService.requiresFirstAccessLiveness(userId),
          legacyChallengeId
            ? Promise.resolve(null)
            : policyService.getStepUpChallenge(null, userId)
        ]);
        if (
          approvalGate?.code === 'KYC_REVERIFY_REQUIRED'
          || requiresCanonicalVerificationRoute({
            challenge: implicitChallenge,
            requirement: implicitChallenge?.requirement || null,
            firstAccessLivenessRequired:
              !legacyChallengeId && firstAccessPolicy?.required === true
          })
        ) {
          return sendCanonicalRouteRequired(res);
        }

        const legacyAwsSessionId = req.body?.deviceKyc?.aws?.sessionId
          || req.body?.deviceKyc?.awsSessionId
          || null;
        let boundSessionMetadata = null;
        if (legacyAwsSessionId) {
          boundSessionMetadata = await this.awsLivenessService.getSessionMetadata(legacyAwsSessionId);
          this.awsLivenessService.assertBoundSessionMetadata(boundSessionMetadata, {
            userId,
            ...getExpectedKycSessionPersistenceBinding(kycRuntime)
          });
          return sendCanonicalRouteRequired(res);
        }
        verificationWindowClaim = await kycRuntime.trustService.claimVerificationWindow(userId, {
          token: boundSessionMetadata?.verificationWindowToken || null,
          scope: 'legacy_verify_driver'
        });
        if (!verificationWindowClaim.acquired) {
          return res.status(409).json({
            success: false,
            error: 'Outra validacao de identidade ja esta em andamento',
            code: 'KYC_VERIFICATION_IN_PROGRESS'
          });
        }
        const [lockedApprovalGate, lockedFirstAccessPolicy, lockedActiveChallenge] = await Promise.all([
          policyService.requireApprovedKyc(userId),
          kycRuntime.namespace === 'sandbox'
            ? Promise.resolve({ required: false })
            : policyService.requiresFirstAccessLiveness(userId),
          policyService.getStepUpChallenge(null, userId)
        ]);
        if (
          lockedApprovalGate?.code === 'KYC_REVERIFY_REQUIRED'
          || requiresCanonicalVerificationRoute({
            challenge: lockedActiveChallenge,
            requirement: lockedActiveChallenge?.requirement || null,
            firstAccessLivenessRequired:
              !legacyChallengeId && lockedFirstAccessPolicy?.required === true
          })
        ) {
          return sendCanonicalRouteRequired(res);
        }
        retainVerificationWindow = Boolean(legacyAwsSessionId);

        // Device-first: app já envia resultado calculado localmente
        if (req.body && req.body.deviceKyc) {
          const challengeId = req.body.challengeId || null;
          let effectiveRequirement = req.body.requirement || null;
          if (challengeId) {
            const challenge = await policyService.getStepUpChallenge(challengeId, userId);
            if (!challenge) {
              return res.status(404).json({
                success: false,
                error: 'Challenge KYC não encontrado ou expirado',
                code: 'KYC_CHALLENGE_NOT_FOUND'
              });
            }
            effectiveRequirement = effectiveRequirement || challenge.requirement || 'VERIFY_REQUIRED';
            if (requiresCanonicalVerificationRoute({
              challenge,
              requirement: effectiveRequirement
            })) {
              return sendCanonicalRouteRequired(res);
            }
          }

          let verificationPayload = {
            ...req.body.deviceKyc,
            recoverBlocked:
              req.body.deviceKyc.recoverBlocked === true
              || Boolean(challengeId)
          };

          const awsSessionId = legacyAwsSessionId;
          if (awsSessionId) {
            try {
              const awsResult = await this.awsLivenessService.getSessionResult({
                sessionId: awsSessionId,
                userId,
                requireBoundMetadata: true
              });
              if (!awsResult.completed) {
                return res.status(202).json({
                  success: false,
                  code: 'KYC_AWS_LIVENESS_PENDING',
                  error: 'Sessão AWS de liveness ainda está em processamento',
                  provider: awsResult.provider,
                  sessionId: awsResult.sessionId,
                  status: awsResult.status
                });
              }
              retainVerificationWindow = false;
              verificationPayload = this.awsLivenessService.toDevicePayload(awsResult, verificationPayload);
            } catch (awsError) {
              const awsCode = awsError?.code || awsError?.name || 'KYC_AWS_LIVENESS_FAILED';
              const awsStatus = awsCode === 'AWS_LIVENESS_DISABLED'
                ? 503
                : (awsCode === 'ResourceNotFoundException' ? 404 : 400);
              return res.status(awsStatus).json({
                success: false,
                error: awsError.message,
                code: awsCode
              });
            }
          }

          if (
            effectiveRequirement === 'LIVENESS_REQUIRED'
            && !policyService.isLivenessSatisfied(verificationPayload)
          ) {
            return res.status(412).json({
              success: false,
              error: 'Liveness obrigatório para concluir esta verificação',
              code: 'KYC_LIVENESS_REQUIRED',
              requirement: effectiveRequirement
            });
          }

          const deviceResult = await this.kycService.acceptDeviceVerification(userId, verificationPayload);

          if (!deviceResult.success) {
            return res.status(400).json(deviceResult);
          }

          if (challengeId && !deviceResult.isMatch) {
            return res.status(403).json({
              success: false,
              error: 'Verificação facial não aprovada para este desafio',
              code: 'KYC_CHALLENGE_NOT_PASSED',
              userId,
              isMatch: false,
              similarityScore: deviceResult.similarityScore,
              confidence: deviceResult.confidence
            });
          }

          if (challengeId && deviceResult.isMatch) {
            const challengeResolution = await policyService.resolveStepUpChallenge({
              challengeId,
              driverId: userId,
              requirement: effectiveRequirement,
              verificationPayload: {
                ...withoutSensitiveBiometricPayload(verificationPayload),
                ...deviceResult
              }
            });

            if (!challengeResolution.success) {
              return res.status(400).json(challengeResolution);
            }
          }

          if (deviceResult.isMatch) {
            if (typeof policyService.recordVerificationSuccess === 'function') {
              await policyService.recordVerificationSuccess(userId, {
                source: challengeId ? 'stepup_challenge' : 'device_verify'
              });
            }
          }

          return res.json({
            success: true,
            userId,
            isMatch: deviceResult.isMatch,
            similarityScore: deviceResult.similarityScore,
            confidence: deviceResult.confidence,
            threshold: deviceResult.threshold,
            processingTime: deviceResult.processingTime,
            mode: deviceResult.mode,
            decision: deviceResult.decision || null,
            embeddingDimension: deviceResult.embeddingDimension || null,
            comparisonProvider: deviceResult.comparisonProvider || null,
            requirement: effectiveRequirement || 'VERIFY_REQUIRED',
            challengeId
          });
        }

        if (!req.file && !forceRecheck) {
          return res.status(400).json({
            success: false,
            error: 'Imagem atual é obrigatória'
          });
        }

        const result = await this.kycService.verifyDriver(
          userId,
          req.file ? req.file.buffer : null,
          {
            forceRecheck: forceRecheck === 'true' || forceRecheck === true,
            cacheValidityHours: cacheValidityHours ? parseInt(cacheValidityHours) : 24
          }
        );

        if (result.success) {
          if (result.isMatch) {
            if (typeof policyService.recordVerificationSuccess === 'function') {
              await policyService.recordVerificationSuccess(userId, {
                source: 'backend_verify'
              });
            }
          }

          res.json({
            success: true,
            userId: userId,
            isMatch: result.isMatch,
            similarityScore: result.similarityScore,
            confidence: result.confidence,
            threshold: result.threshold,
            processingTime: result.processingTime
          });
        } else {
          res.status(400).json(result);
        }

      } catch (error) {
        logError(error, 'Erro na verificação:', { service: 'kyc-routes-routes' });

        if ([
          'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
          'KYC_VERIFICATION_IN_PROGRESS'
        ].includes(error?.code)) {
          return res.status(409).json({
            success: false,
            error: error.message,
            code: error.code
          });
        }
        
        // Se o erro for por falta de CNH, retornar erro 400 com mensagem específica
        if (error.message && error.message.includes('CNH não encontrada')) {
          return res.status(400).json({
            success: false,
            error: error.message,
            details: 'CNH não encontrada no Firebase Storage'
          });
        }
        
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
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
  }
}

module.exports = KYCRoutesVerifyDriver;
