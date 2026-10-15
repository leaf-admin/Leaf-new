// Gerado a partir de routes/kyc-routes.js (divisão mecânica, código idêntico, mesma ordem de registro).
// Âncora de dispositivo, step-up, encodings, estatísticas, status e handler de erro

const {
  multer,
  requireFirebaseUser,
  requireFirebaseSelf,
  logError,
  firebaseConfig,
  paramUserId,
  resolveRequestKycRuntime,
  sendSandboxLegacyRouteDisabled,
} = require('./shared');

class KYCRoutesAnchorsEncodingsStatus {
  registerAnchorsEncodingsAndStatusRoutes() {
    // Obter assinatura âncora device-first (fallback quando app não tiver cache local)
    this.router.get(
      '/device-anchor/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({ success: false, error: 'userId inválido' });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendSandboxLegacyRouteDisabled(res);
        }

        if (!firebaseConfig || !firebaseConfig.getFromRealtimeDB) {
          return res.status(503).json({ success: false, error: 'Firebase não configurado' });
        }

        const user = (await firebaseConfig.getFromRealtimeDB(`users/${userId}`)) || {};

        res.json({
          success: true,
          userId,
          anchorSignature: user.kycDeviceAnchorSignature || null,
          anchorAlgorithm: user.kycDeviceAnchorAlgorithm || null,
          anchorUpdatedAt: user.kycDeviceAnchorUpdatedAt || null
        });
      } catch (error) {
        logError(error, 'Erro ao buscar assinatura âncora device-first', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Consultar challenge KYC ativo (usado em step-up de saque)
    this.router.get(
      '/stepup-challenge/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;
        const challengeId = req.query.challengeId || null;

        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        const challenge = await kycRuntime.policyService.getStepUpChallenge(challengeId, userId);
        if (!challenge) {
          return res.status(404).json({
            success: false,
            error: 'Nenhum challenge KYC ativo',
            code: 'KYC_CHALLENGE_NOT_FOUND'
          });
        }

        return res.json({
          success: true,
          challenge
        });
      } catch (error) {
        logError(error, 'Erro ao buscar challenge KYC ativo', { service: 'kyc-routes-routes' });
        return res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Obter encoding facial
    this.router.get(
      '/encoding/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;
        
        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendSandboxLegacyRouteDisabled(res);
        }

        const encoding = await this.kycService.getFaceEncoding(userId);
        
        if (encoding.success) {
          res.json(encoding);
        } else {
          res.status(404).json(encoding);
        }

      } catch (error) {
        logError(error, 'Erro ao obter encoding:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Deletar encoding facial
    this.router.delete(
      '/encoding/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;

        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendSandboxLegacyRouteDisabled(res);
        }

        const result = await this.kycService.deleteFaceEncoding(userId);
        
        if (result.success) {
          res.json(result);
        } else {
          res.status(500).json(result);
        }

      } catch (error) {
        logError(error, 'Erro ao deletar encoding:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Estatísticas do serviço
    this.router.get('/stats', requireFirebaseUser, async (req, res) => {
      try {
        const authenticatedUserId = req?.authenticatedUser?.uid || req?.firebaseUser?.uid || null;
        if (authenticatedUserId) {
          const kycRuntime = await resolveRequestKycRuntime(req, authenticatedUserId);
          if (kycRuntime.namespace === 'sandbox') {
            return sendSandboxLegacyRouteDisabled(res);
          }
        }
        const stats = await this.kycService.getStats();
        res.json(stats);

      } catch (error) {
        logError(error, 'Erro ao obter estatísticas:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Health check
    this.router.get('/health', requireFirebaseUser, async (req, res) => {
      try {
        const authenticatedUserId = req?.authenticatedUser?.uid || req?.firebaseUser?.uid || null;
        if (authenticatedUserId) {
          const kycRuntime = await resolveRequestKycRuntime(req, authenticatedUserId);
          if (kycRuntime.namespace === 'sandbox') {
            return sendSandboxLegacyRouteDisabled(res);
          }
        }
        const health = await this.kycService.healthCheck();
        res.json(health);

      } catch (error) {
        res.status(500).json({
          status: 'unhealthy',
          timestamp: Date.now(),
          error: error.message
        });
      }
    });

    // Verificar se motorista tem verificação válida (sem processar)
    this.router.get(
      '/verification-status/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;
        const { maxAgeHours } = req.query;

        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        const maxAge = maxAgeHours ? parseInt(maxAgeHours) : 24;
        const [status, firstAccessPolicy, activeChallenge] = await Promise.all([
          kycRuntime.trustService.readCanonicalCompatibilityVerification(userId, maxAge),
          kycRuntime.namespace === 'sandbox'
            ? Promise.resolve({ required: false, reason: null })
            : kycRuntime.policyService.requiresFirstAccessLiveness(userId),
          kycRuntime.policyService.getStepUpChallenge(null, userId)
        ]);

        res.json({
          success: true,
          ...status,
          firstAccessLivenessRequired: Boolean(firstAccessPolicy?.required),
          firstAccessReason: firstAccessPolicy?.reason || null,
          activeStepUpChallenge: activeChallenge
            ? {
                challengeId: activeChallenge.challengeId,
                requirement: activeChallenge.requirement,
                expiresAt: activeChallenge.expiresAt,
                source: activeChallenge.source
              }
            : null
        });

      } catch (error) {
        logError(error, 'Erro ao verificar status:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Invalidar cache de verificação (usado quando há report de violação)
    this.router.post(
      '/invalidate-cache/:userId',
      requireFirebaseUser,
      requireFirebaseSelf(paramUserId),
      async (req, res) => {
      try {
        const { userId } = req.params;

        // Firebase UID não segue formato UUID - não bloquear por isso
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'userId inválido'
          });
        }

        const kycRuntime = await resolveRequestKycRuntime(req, userId);
        if (kycRuntime.namespace === 'sandbox') {
          return sendSandboxLegacyRouteDisabled(res);
        }

        const result = await this.kycService.invalidateVerificationCache(userId);
        res.json(result);

      } catch (error) {
        logError(error, 'Erro ao invalidar cache:', { service: 'kyc-routes-routes' });
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
      }
    );

    // Middleware de tratamento de erros
    this.router.use((error, req, res, next) => {
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: 'Arquivo muito grande. Máximo 5MB.'
          });
        }
      }
      
      logError(error, 'Erro não tratado:', { service: 'kyc-routes-routes' });
      res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
      });
    });
  }
}

module.exports = KYCRoutesAnchorsEncodingsStatus;
