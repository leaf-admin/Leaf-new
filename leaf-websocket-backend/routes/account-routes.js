const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { logger } = require('../utils/logger');

const DEFAULT_DELETION_REASON = 'user_requested_mobile_app';
const legacyDeleteDataRoutesEnabled =
  String(process.env.ENABLE_LEGACY_ACCOUNT_DELETE_ROUTES || 'false').toLowerCase() === 'true';

// Middleware de autenticação Firebase
const requireFirebase = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Token de autorização não fornecido'
      });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    req.userToken = token;
    next();
  } catch (error) {
    logger.error('Erro na autenticação Firebase:', error);
    return res.status(401).json({
      success: false,
      error: 'Token inválido ou expirado'
    });
  }
};

const normalizePhone = (phone) => String(phone || '').replace(/\D/g, '');

async function processAccountDeletion(req, res, options = {}) {
  const { allowParamUserId = false } = options;

  try {
    const authenticatedUserId = req.user.uid;
    const requestedUserId = String(req.params.userId || authenticatedUserId).trim();

    if (allowParamUserId && requestedUserId && requestedUserId !== authenticatedUserId) {
      return res.status(403).json({
        success: false,
        message: 'Você só pode excluir a sua própria conta.'
      });
    }

    const userId = authenticatedUserId;

    const {
      reason,
      additionalInfo,
      phone,
      password,
      source
    } = req.body || {};

    const deletionReason = String(reason || DEFAULT_DELETION_REASON).trim() || DEFAULT_DELETION_REASON;

    const userDoc = await admin.firestore().collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado.'
      });
    }

    const userData = userDoc.data() || {};

    // Torna o endpoint compatível com autenticação por OTP (sem senha no app).
    // Se telefone for enviado, validamos contra o cadastro para evitar erro de identificação.
    const normalizedPhone = normalizePhone(phone);
    const registeredPhone = normalizePhone(
      userData.phone || userData.phoneNumber || req.user.phone_number || ''
    );

    if (normalizedPhone && registeredPhone && normalizedPhone !== registeredPhone) {
      logger.warn(
        `Tentativa de exclusão com telefone divergente - UserId: ${userId}, informado: ${normalizedPhone}, cadastrado: ${registeredPhone}`
      );
      return res.status(400).json({
        success: false,
        message: 'Número de telefone não corresponde à sua conta.'
      });
    }

    if (userData.status === 'deletion_pending') {
      return res.json({
        success: true,
        message: 'Sua conta já está marcada para exclusão.',
        deletionRequested: true
      });
    }

    const deletionLog = {
      userId,
      reason: deletionReason,
      additionalInfo: additionalInfo || '',
      phone: normalizedPhone || registeredPhone || null,
      passwordProvided: Boolean(password),
      source: source || 'mobile-app',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userEmail: userData.email || null,
      userName: userData.name || userData.fullName || null
    };

    await admin.firestore().collection('account_deletions').add(deletionLog);
    logger.info(`Registro de exclusão de conta criado - UserId: ${userId}, Motivo: ${deletionReason}`);

    try {
      await admin.auth().updateUser(userId, {
        disabled: true
      });

      await admin.firestore().collection('users').doc(userId).update({
        status: 'deletion_pending',
        deletionRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletionReason,
        deletionSource: source || 'mobile-app',
        deletionAdditionalInfo: additionalInfo || ''
      });

      logger.info(`Conta marcada para exclusão - UserId: ${userId}`);

      return res.json({
        success: true,
        message: 'Sua conta foi marcada para exclusão com sucesso. Seus dados serão removidos conforme a política de retenção aplicável.',
        deletionRequested: true
      });
    } catch (deleteError) {
      logger.error(`Erro ao excluir conta do usuário ${userId}:`, deleteError);

      try {
        await admin.firestore().collection('users').doc(userId).update({
          status: userData.status || 'active'
        });
      } catch (revertError) {
        logger.error(`Erro ao reverter status da conta ${userId}:`, revertError);
      }

      return res.status(500).json({
        success: false,
        message: 'Erro ao processar exclusão da conta. Tente novamente ou entre em contato com o suporte.'
      });
    }
  } catch (error) {
    logger.error('Erro ao excluir conta:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno ao processar exclusão da conta.'
    });
  }
}

/**
 * POST /api/account/delete
 * Exclui conta do usuário autenticado
 */
router.post('/api/account/delete', requireFirebase, async (req, res) => {
  await processAccountDeletion(req, res, { allowParamUserId: false });
});

/**
 * DELETE /api/privacy/delete-data/:userId
 * Rota legada para compatibilidade com versões antigas do app
 */
if (legacyDeleteDataRoutesEnabled) {
  router.delete('/api/privacy/delete-data/:userId', requireFirebase, async (req, res) => {
    await processAccountDeletion(req, res, { allowParamUserId: true });
  });

  /**
   * POST /api/privacy/delete-data/:userId
   * Compatibilidade adicional para clientes que não enviam DELETE
   */
  router.post('/api/privacy/delete-data/:userId', requireFirebase, async (req, res) => {
    await processAccountDeletion(req, res, { allowParamUserId: true });
  });
}

module.exports = router;
