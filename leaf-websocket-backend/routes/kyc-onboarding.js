// routes/kyc-onboarding.js
// Rotas para KYC onboarding (CNH + Selfie)

const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const fs = require('fs').promises;
const { logStructured, logError } = require('../utils/logger');
const { requireFirebaseUser, requireFirebaseSelf } = require('../middleware/firebase-user-auth');
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'kyc-onboarding-routes' });
}
const kycDriverStatusService = require('../services/kyc-driver-status-service');
const { evaluateDeviceVerificationTrust } = require('../services/kyc-biometric-production-policy');

// Configurar multer para upload de imagens
// ✅ CORREÇÃO: Aumentar limite de tamanho e adicionar timeout
const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB (aumentado de 10MB)
    files: 2 // CNH + Selfie
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não permitido. Use JPEG ou PNG.'));
    }
  }
});

/**
 * POST /api/drivers/kyc/onboarding
 * Processar onboarding KYC (CNH + Selfie)
 */
router.post(
  '/api/drivers/kyc/onboarding',
  requireFirebaseUser,
  upload.fields([
    { name: 'cnh', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
  ]),
  requireFirebaseSelf((req) => req.body?.driverId),
  async (req, res) => {
  try {
    const { driverId } = req.body;
    const isDeviceFirst = req.is('application/json') || req.body?.onboardingMode === 'device_signature_v1';

    if (!driverId) {
      return res.status(400).json({
        error: 'driverId é obrigatório'
      });
    }

    // This is a legacy, client-declared comparison. It is never an identity authority in production.
    if (isDeviceFirst) {
      const trustGate = evaluateDeviceVerificationTrust({
        mode: 'device_signature_v1',
        provider: 'device_signature_v1'
      });
      if (!trustGate.allowed) {
        return res.status(409).json({
          success: false,
          code: trustGate.code,
          error: 'Validação facial no dispositivo não pode aprovar cadastro neste ambiente.',
          message: 'Envie os documentos pelo fluxo de ativação e conclua a validação biométrica canônica.'
        });
      }

      const similarity = Number(req.body?.similarityScore || 0);
      const approveThreshold = Number(req.body?.approveThreshold || 0.5);
      const reviewThreshold = Number(req.body?.reviewThreshold || 0.4);
      const approved = similarity >= approveThreshold;
      const needsReview = !approved && similarity >= reviewThreshold;

      const result = {
        approved,
        needsReview,
        similarity,
        cnhData: { mode: 'device_signature_v1' },
        anchorImageUrl: null
      };

      // Persistir âncora do device para verificações futuras (assinatura, não imagem)
      try {
        if (firebaseConfig && firebaseConfig.updateRealtimeDB) {
          await firebaseConfig.updateRealtimeDB(`users/${driverId}`, {
            kycDeviceAnchorSignature: req.body?.selfieSignature || null,
            kycDeviceAnchorAlgorithm: req.body?.signatureAlgorithm || 'simhash-base64-v1',
            kycDeviceAnchorUpdatedAt: new Date().toISOString(),
            kycStatus: approved ? 'approved' : (needsReview ? 'pending_review' : 'rejected'),
            kycUpdatedAt: new Date().toISOString()
          });
        }
      } catch (persistError) {
        logError(persistError, 'Falha ao persistir assinatura âncora device-first', {
          service: 'kyc-onboarding-routes',
          driverId
        });
      }

      let statusResult = null;
      try {
        statusResult = await kycDriverStatusService.processOnboardingResult(driverId, result);
      } catch (statusError) {
        logError(statusError, 'Erro ao aplicar status no onboarding device-first', {
          service: 'kyc-onboarding-routes',
          driverId
        });
      }

      return res.json({
        success: true,
        data: {
          approved: result.approved,
          needsReview: result.needsReview,
          similarity: result.similarity,
          cnhData: result.cnhData,
          anchorImageUrl: null,
          blocked: statusResult?.blocked || false,
          mode: 'device_signature_v1',
          message: result.approved
            ? 'KYC aprovado no dispositivo. Conta liberada.'
            : result.needsReview
              ? 'KYC em revisão manual.'
              : 'KYC não aprovado no dispositivo.'
        }
      });
    }

    if (!req.files || !req.files.cnh || !req.files.selfie) {
      return res.status(400).json({
        error: 'CNH e Selfie são obrigatórias'
      });
    }

    await Promise.all([
      req.files.cnh?.[0]?.path ? fs.unlink(req.files.cnh[0].path).catch(() => {}) : Promise.resolve(),
      req.files.selfie?.[0]?.path ? fs.unlink(req.files.selfie[0].path).catch(() => {}) : Promise.resolve()
    ]);

    return res.status(410).json({
      success: false,
      error: 'KYC multipart legado desativado',
      message: 'Use o fluxo device-first ou /api/kyc com comparação biométrica server-side.'
    });
  } catch (error) {
    logError(error, '❌ Erro ao processar KYC onboarding:', { service: 'kyc-onboarding-routes' });

    // Limpar arquivos temporários em caso de erro
    if (req.files) {
      await Promise.all([
        req.files.cnh && req.files.cnh[0] ? fs.unlink(req.files.cnh[0].path).catch(() => {}) : Promise.resolve(),
        req.files.selfie && req.files.selfie[0] ? fs.unlink(req.files.selfie[0].path).catch(() => {}) : Promise.resolve()
      ]);
    }

    res.status(500).json({
      error: 'Erro ao processar KYC',
      message: error.message
    });
  }
  }
);

/**
 * POST /api/drivers/:driverId/kyc/reverify
 * Re-verificar identidade do motorista
 */
router.post(
  '/api/drivers/:driverId/kyc/reverify',
  requireFirebaseUser,
  requireFirebaseSelf((req) => req.params?.driverId),
  upload.single('selfie'),
  async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!req.file) {
      return res.status(400).json({
        error: 'Selfie é obrigatória'
      });
    }

    await fs.unlink(req.file.path).catch(() => {});

    return res.status(410).json({
      success: false,
      error: 'Reverificacao KYC legada desativada',
      message: 'Use o fluxo /api/kyc com AWS Liveness e comparação biométrica server-side.'
    });
  } catch (error) {
    logError(error, '❌ Erro ao re-verificar KYC:', { service: 'kyc-onboarding-routes' });

    // Limpar arquivo temporário em caso de erro
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    res.status(500).json({
      error: 'Erro ao re-verificar KYC',
      message: error.message
    });
  }
  }
);

module.exports = router;
