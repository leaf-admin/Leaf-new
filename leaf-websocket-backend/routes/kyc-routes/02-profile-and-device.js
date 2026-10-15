// Gerado a partir de routes/kyc-routes.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Upload de perfil e verificação device-first

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
  sendSandboxLegacyRouteDisabled,
  requireOperationalLegacyKycRoute,
  sendLivenessAttemptRateLimit,
  isLivenessAttemptRateLimited,
} = require('./shared');

class KYCRoutesProfileAndDevice {
  registerProfileAndDeviceRoutes() {
    // Upload de imagem de perfil
    this.router.post(
      '/upload-profile',
      requireFirebaseUser,
      requireOperationalLegacyKycRoute,
      this.upload.single('image'),
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      try {
        const { userId } = req.body;
        
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendSandboxLegacyRouteDisabled(res);
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'Imagem é obrigatória'
          });
        }

        const result = await this.kycService.preprocessProfileImage(
          userId,
          req.file.buffer
        );

        if (result.success) {
          res.json({
            success: true,
            userId: userId,
            message: 'Imagem de perfil processada com sucesso',
            encodingSaved: true,
            confidence: result.confidence
          });
        } else {
          res.status(400).json(result);
        }

      } catch (error) {
        logError(error, 'Erro no upload de perfil:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Verificação facial
    this.router.post(
      '/verify-driver/device',
      requireFirebaseUser,
      requireFirebaseSelf(bodyUserId),
      async (req, res) => {
      let verificationWindowClaim = null;
      let retainVerificationWindow = false;
      let kycRuntime = null;
      try {
        const { userId, deviceKyc, challengeId, requirement } = req.body || {};

        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        if (!deviceKyc || typeof deviceKyc !== 'object') {
          return res.status(400).json({
            success: false,
            error: 'deviceKyc é obrigatório'
          });
        }

        kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendCanonicalRouteRequired(res);
        }
        const { policyService } = kycRuntime;

        const approvalGate = await policyService.requireApprovedKyc(userId);
        const implicitChallenge = !challengeId
          ? await policyService.getStepUpChallenge(null, userId)
          : null;
        if (
          approvalGate?.code === 'KYC_REVERIFY_REQUIRED'
          || requiresCanonicalVerificationRoute({
            challenge: implicitChallenge,
            requirement: implicitChallenge?.requirement || null
          })
        ) {
          return sendCanonicalRouteRequired(res);
        }

        let challenge = null;
        let effectiveRequirement = requirement || null;
        if (challengeId) {
          challenge = await policyService.getStepUpChallenge(challengeId, userId);
          if (!challenge) {
            return res.status(404).json({
              success: false,
              error: 'Challenge KYC não encontrado ou expirado',
              code: 'KYC_CHALLENGE_NOT_FOUND'
            });
          }
          effectiveRequirement = effectiveRequirement || challenge.requirement || 'VERIFY_REQUIRED';
        }

        const firstAccessPolicy = kycRuntime.namespace === 'sandbox'
          ? { required: false }
          : await policyService.requiresFirstAccessLiveness(userId);
        const firstAccessLivenessRequired = !challengeId && firstAccessPolicy.required === true;
        if (!effectiveRequirement && firstAccessLivenessRequired) {
          effectiveRequirement = 'LIVENESS_REQUIRED';
        }

        let verificationPayload = {
          ...deviceKyc,
          recoverBlocked:
            deviceKyc.recoverBlocked === true
            || Boolean(challengeId)
            || firstAccessLivenessRequired
        };

        const awsSessionId = deviceKyc?.aws?.sessionId || deviceKyc?.awsSessionId || null;
        let boundSessionMetadata = null;
        if (awsSessionId) {
          boundSessionMetadata = await this.awsLivenessService.getSessionMetadata(awsSessionId);
          this.awsLivenessService.assertBoundSessionMetadata(boundSessionMetadata, {
            userId,
            ...getExpectedKycSessionPersistenceBinding(kycRuntime)
          });
        }
        if (requiresCanonicalVerificationRoute({
          awsSessionId,
          challenge,
          requirement: effectiveRequirement,
          firstAccessLivenessRequired
        })) {
          return sendCanonicalRouteRequired(res);
        }
        verificationWindowClaim = await kycRuntime.trustService.claimVerificationWindow(userId, {
          token: boundSessionMetadata?.verificationWindowToken || null,
          scope: 'legacy_device_verify'
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
              !challengeId && lockedFirstAccessPolicy?.required === true
          })
        ) {
          return sendCanonicalRouteRequired(res);
        }
        retainVerificationWindow = Boolean(awsSessionId);
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
            if (isLivenessAttemptRateLimited(awsResult)) {
              return sendLivenessAttemptRateLimit(res, awsResult.attemptState);
            }
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

        if ((challengeId || firstAccessLivenessRequired) && !deviceResult.isMatch) {
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
          challengeId: challengeId || null
        });
      } catch (error) {
        logError(error, 'Erro na verificação device-first:', { service: 'kyc-routes-routes' });
        const conflict = [
          'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP',
          'KYC_VERIFICATION_IN_PROGRESS'
        ].includes(error?.code);
        return res.status(conflict ? 409 : 500).json({
          success: false,
          error: conflict ? error.message : 'Erro interno do servidor',
          code: error?.code || 'KYC_DEVICE_VERIFICATION_ERROR',
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

module.exports = KYCRoutesProfileAndDevice;
