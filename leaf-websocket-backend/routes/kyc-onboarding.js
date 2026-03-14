// routes/kyc-onboarding.js
// Rotas para KYC onboarding (CNH + Selfie)

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { logStructured, logError } = require('../utils/logger');
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'kyc-onboarding-routes' });
}
const kycService = require('../services/kyc-service');
const kycDriverStatusService = require('../services/kyc-driver-status-service');

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
router.post('/api/drivers/kyc/onboarding', upload.fields([
  { name: 'cnh', maxCount: 1 },
  { name: 'selfie', maxCount: 1 }
]), async (req, res) => {
  try {
    const { driverId } = req.body;
    const isDeviceFirst = req.is('application/json') || req.body?.onboardingMode === 'device_signature_v1';

    if (!driverId) {
      return res.status(400).json({
        error: 'driverId é obrigatório'
      });
    }

    // Device-first mode: comparação já calculada no app, backend só persiste + aplica regra
    if (isDeviceFirst) {
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
        if (firebaseConfig && firebaseConfig.getRealtimeDB) {
          const db = firebaseConfig.getRealtimeDB();
          await db.ref(`users/${driverId}`).update({
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

    const cnhFile = req.files.cnh[0];
    const selfieFile = req.files.selfie[0];

    logStructured('info', `🔐 Processando KYC onboarding para motorista ${driverId}`, { service: 'kyc-onboarding-routes' });

    // Inicializar serviço KYC se necessário
    if (!kycService.initialized) {
      await kycService.initialize();
    }

    // Processar KYC
    const result = await kycService.processOnboarding(
      driverId,
      cnhFile.path,
      selfieFile.path
    );

    // ✅ Processar bloqueio/liberação baseado no resultado
    let statusResult = null;
    try {
      statusResult = await kycDriverStatusService.processOnboardingResult(driverId, result);
      logStructured('info', 'Status do motorista atualizado após onboarding KYC', {
        service: 'kyc-onboarding-routes',
        driverId,
        approved: result.approved,
        blocked: statusResult?.blocked || false
      });
    } catch (statusError) {
      logError(statusError, 'Erro ao atualizar status do motorista (não bloqueia resposta)', {
        service: 'kyc-onboarding-routes',
        driverId
      });
      // Não bloquear resposta se falhar atualização de status
    }

    // Limpar arquivos temporários
    await Promise.all([
      fs.unlink(cnhFile.path).catch(() => {}),
      fs.unlink(selfieFile.path).catch(() => {})
    ]);

    // Retornar resultado
    res.json({
      success: true,
      data: {
        approved: result.approved,
        needsReview: result.needsReview,
        similarity: result.similarity,
        cnhData: result.cnhData,
        anchorImageUrl: result.anchorImageUrl,
        blocked: statusResult?.blocked || false,
        message: result.approved 
          ? 'KYC aprovado com sucesso! Sua conta foi liberada.' 
          : result.needsReview 
            ? 'KYC requer revisão manual. Sua conta foi bloqueada temporariamente.' 
            : 'KYC rejeitado. As imagens não correspondem. Sua conta foi bloqueada.'
      }
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
});

/**
 * POST /api/drivers/:driverId/kyc/reverify
 * Re-verificar identidade do motorista
 */
router.post('/api/drivers/:driverId/kyc/reverify', upload.single('selfie'), async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!req.file) {
      return res.status(400).json({
        error: 'Selfie é obrigatória'
      });
    }

    logStructured('info', `🔐 Re-verificando KYC para motorista ${driverId}`, { service: 'kyc-onboarding-routes' });

    // Inicializar serviço KYC se necessário
    if (!kycService.initialized) {
      await kycService.initialize();
    }

    // Re-verificar
    const result = await kycService.reverifyIdentity(driverId, req.file.path);

    // Limpar arquivo temporário
    await fs.unlink(req.file.path).catch(() => {});

    // Retornar resultado
    res.json({
      success: true,
      data: {
        approved: result.approved,
        similarity: result.similarity,
        message: result.approved 
          ? 'Identidade verificada com sucesso!' 
          : 'Identidade não verificada. As imagens não correspondem.'
      }
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
});

module.exports = router;
