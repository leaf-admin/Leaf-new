const express = require('express');
const admin = require('firebase-admin');
const multer = require('multer');
const path = require('path');
const firebaseConfig = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');
const { metrics: runtimeMetrics } = require('../utils/prometheus-metrics');
const {
  driverDocumentAnalysisQueue,
  ALLOWED_DRIVER_DOCUMENT_TYPES,
  sanitizeDocumentType,
  recomputeDriverActivationStatus
} = require('../services/driver-document-analysis-queue');
const driverApplicationService = require('../services/driver-application-service');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const mimetype = String(file?.mimetype || '').toLowerCase();
    if (mimetype === 'application/pdf') {
      cb(null, true);
      return;
    }
    cb(new Error('Apenas PDFs são aceitos para ativação de motorista.'), false);
  }
});

const DRIVER_DOCUMENT_SIGNED_URL_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number.parseInt(process.env.DRIVER_DOCUMENT_SIGNED_URL_TTL_MS || `${24 * 60 * 60 * 1000}`, 10) || 24 * 60 * 60 * 1000
);

function ensureFirebaseInitialized() {
  if (Array.isArray(admin.apps) && admin.apps.length > 0) {
    return;
  }
  firebaseConfig.initializeFirebase();
}

function sanitizeFilename(fileName) {
  return String(fileName || 'documento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === '1' || normalized === 'true' || normalized === 'sim' || normalized === 'yes';
}

function createActivationStorageError(message, cause = null) {
  const error = new Error(message);
  error.code = 'DRIVER_ACTIVATION_STORAGE_UPLOAD_FAILED';
  if (cause) {
    error.cause = cause;
  }
  return error;
}

async function requireDriverAuth(req, res, next) {
  try {
    ensureFirebaseInitialized();

    const authHeader = String(req.headers.authorization || '').trim();
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticação ausente.'
      });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticação inválido.'
      });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const uid = String(decoded?.uid || '').trim();

    if (!uid) {
      return res.status(401).json({
        success: false,
        message: 'Token sem UID válido.'
      });
    }

    const db = firebaseConfig?.getRealtimeDB?.();
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Realtime Database indisponível.'
      });
    }

    const userSnapshot = await db.ref(`users/${uid}`).once('value');
    const userProfile = userSnapshot.val() || {};
    const userType = String(
      userProfile?.usertype ||
        userProfile?.userType ||
        userProfile?.profileSelection?.userType ||
        decoded?.usertype ||
        decoded?.userType ||
        ''
    )
      .trim()
      .toLowerCase();

    if (userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Endpoint disponível apenas para motoristas autenticados.'
      });
    }

    req.user = {
      uid,
      token,
      decoded,
      profile: userProfile,
      userType
    };

    return next();
  } catch (error) {
    logError(error, 'Falha na autenticação do motorista para ativação', {
      service: 'driver-activation-routes'
    });
    return res.status(401).json({
      success: false,
      message: 'Token inválido ou expirado.'
    });
  }
}

async function uploadActivationPdfToStorage({ driverId, documentType, file }) {
  if (!file?.buffer || !driverId || !documentType) {
    throw createActivationStorageError('Arquivo de ativação inválido para armazenamento.');
  }

  try {
    ensureFirebaseInitialized();

    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'leaf-reactnative.firebasestorage.app';
    const bucket = admin.storage().bucket(bucketName);
    const originalName = sanitizeFilename(file?.originalname || `${documentType}.pdf`);
    const extension = path.extname(originalName) || '.pdf';
    const objectPath = `driver-activation/${driverId}/${documentType}/${Date.now()}_${originalName.replace(extension, '')}${extension}`;

    const storageFile = bucket.file(objectPath);
    const signedUrlExpiresAt = new Date(Date.now() + DRIVER_DOCUMENT_SIGNED_URL_TTL_MS);
    await storageFile.save(file.buffer, {
      resumable: false,
      metadata: {
        contentType: 'application/pdf',
        metadata: {
          driverId: String(driverId),
          documentType: String(documentType),
          uploadedBy: String(driverId)
        }
      }
    });

    const [signedUrl] = await storageFile.getSignedUrl({
      action: 'read',
      expires: signedUrlExpiresAt
    });

    if (!String(signedUrl || '').trim()) {
      throw createActivationStorageError('Firebase Storage não retornou URL assinada para o documento.');
    }

    return {
      fileUrl: signedUrl,
      filePath: objectPath,
      fileUrlExpiresAt: signedUrlExpiresAt.toISOString()
    };
  } catch (error) {
    logStructured('warn', 'Falha ao enviar PDF de ativação para o Firebase Storage', {
      service: 'driver-activation-routes',
      driverId,
      documentType,
      error: error?.message || String(error)
    });

    throw createActivationStorageError(
      'Não foi possível armazenar o documento de ativação. Tente novamente.',
      error
    );
  }
}

router.post(
  '/api/drivers/me/activation/documents/:type',
  requireDriverAuth,
  (req, res, next) => {
    upload.single('pdf')(req, res, err => {
      if (!err) {
        return next();
      }

      return res.status(400).json({
        success: false,
        message: err?.message || 'Falha no upload do documento.'
      });
    });
  },
  async (req, res) => {
    try {
      const driverId = req.user.uid;
      const documentType = sanitizeDocumentType(req.params.type);

      if (!documentType) {
        return res.status(400).json({
          success: false,
          message: `Tipo de documento inválido. Tipos permitidos: ${ALLOWED_DRIVER_DOCUMENT_TYPES.join(', ')}`
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Arquivo PDF obrigatório no campo "pdf".'
        });
      }

      const db = firebaseConfig?.getRealtimeDB?.();
      if (!db) {
        return res.status(503).json({
          success: false,
          message: 'Realtime Database indisponível.'
        });
      }

      const nowIso = new Date().toISOString();
      const submissionId = `${nowIso.replace(/[^0-9]/g, '')}_${Math.random().toString(16).slice(2, 8)}`;

      const { fileUrl, filePath, fileUrlExpiresAt } = await uploadActivationPdfToStorage({
        driverId,
        documentType,
        file: req.file
      });

      if (!fileUrl || !filePath) {
        throw createActivationStorageError('Documento de ativação não foi armazenado corretamente.');
      }

      const metadata = {
        fileName: sanitizeFilename(req.file.originalname || `${documentType}.pdf`),
        fileType: 'application/pdf',
        fileSize: Number(req.file.size || 0),
        fileUrl,
        filePath,
        fileUrlExpiresAt,
        uploadedAt: nowIso,
        createdAt: nowIso
      };

      const activationDocPayload = {
        documentType,
        submissionId,
        status: 'in_review',
        reason: '',
        reviewedAt: null,
        updatedAt: nowIso,
        ...metadata
      };

      await db.ref().update({
        [`driver_activation/${driverId}/documents/${documentType}`]: activationDocPayload,
        [`driver_activation/${driverId}/documents_history/${submissionId}`]: activationDocPayload,
        [`driver_activation/${driverId}/updatedAt`]: nowIso,
        [`users/${driverId}/documents/${documentType}`]: {
          type: documentType,
          status: 'pending',
          analysisStatus: 'in_review',
          analysisReason: '',
          reviewedAt: null,
          updatedAt: nowIso,
          uploadedAt: nowIso,
          fileName: metadata.fileName,
          fileType: metadata.fileType,
          fileSize: metadata.fileSize,
          fileUrl,
          filePath,
          fileUrlExpiresAt,
          lastSubmissionId: submissionId
        }
      });
      try {
        await driverApplicationService.syncDriverApplication(driverId, {
          db,
          includeRatings: false
        });
      } catch (syncError) {
        logStructured('warn', 'Falha ao sincronizar espelho Firestore da ativação do motorista', {
          service: 'driver-activation-routes',
          driverId,
          documentType,
          error: syncError.message
        });
      }
      runtimeMetrics.recordRealtimeUpdate('driver_activation', 'doc_in_review');
      runtimeMetrics.recordRealtimeUpdate('doc_in_review', 'total');
      const aggregatedStatus = await recomputeDriverActivationStatus(driverId);

      const io = req.app.get('io') || req.app.locals?.io || null;
      if (io) {
        io.to(`driver_${driverId}`).emit('driverDocumentStatusUpdated', {
          driverId,
          documentType,
          submissionId,
          status: 'in_review',
          reason: '',
          updatedAt: nowIso,
          canGoOnline: Boolean(aggregatedStatus?.canGoOnline)
        });
      }

      driverDocumentAnalysisQueue.enqueue({
        driverId,
        documentType,
        submissionId,
        fileBuffer: req.file.buffer,
        io,
        ...metadata
      });

      logStructured('info', 'Documento de ativação enfileirado para análise assíncrona', {
        service: 'driver-activation-routes',
        driverId,
        documentType,
        submissionId,
        fileSize: metadata.fileSize
      });

      return res.status(202).json({
        success: true,
        message: 'Documento recebido e enviado para análise assíncrona.',
        data: {
          driverId,
          documentType,
          submissionId,
          status: 'in_review',
          updatedAt: nowIso,
          canGoOnline: Boolean(aggregatedStatus?.canGoOnline),
          retryAfterSec: 5
        }
      });
    } catch (error) {
      if (error?.code === 'DRIVER_ACTIVATION_STORAGE_UPLOAD_FAILED') {
        logStructured('warn', 'Upload de documento de ativação rejeitado antes de persistência', {
          service: 'driver-activation-routes',
          driverId: req.user?.uid || null,
          documentType: req.params?.type || null,
          error: error.message
        });

        return res.status(503).json({
          success: false,
          code: 'DRIVER_ACTIVATION_STORAGE_UPLOAD_FAILED',
          message: error.message,
          retryable: true
        });
      }

      logError(error, 'Erro ao enviar documento de ativação', {
        service: 'driver-activation-routes',
        driverId: req.user?.uid || null,
        documentType: req.params?.type || null
      });
      return res.status(500).json({
        success: false,
        message: `Erro ao processar documento: ${error.message}`
      });
    }
  }
);

router.post('/api/drivers/me/activation/consent/background-check', requireDriverAuth, async (req, res) => {
  try {
    const driverId = req.user.uid;
    const accepted = parseBoolean(req.body?.accepted, true);
    const io = req.app.get('io') || req.app.locals?.io || null;

    const snapshot = await driverDocumentAnalysisQueue.setConsentBackgroundCheck({
      driverId,
      accepted,
      io
    });

    return res.json({
      success: true,
      message: accepted
        ? 'Consentimento registrado com sucesso.'
        : 'Consentimento removido com sucesso.',
      data: snapshot
    });
  } catch (error) {
    logError(error, 'Erro ao registrar consentimento de antecedentes', {
      service: 'driver-activation-routes',
      driverId: req.user?.uid || null
    });

    return res.status(500).json({
      success: false,
      message: `Erro ao atualizar consentimento: ${error.message}`
    });
  }
});

router.get('/api/drivers/me/activation/status', requireDriverAuth, async (req, res) => {
  try {
    const driverId = req.user.uid;
    const snapshot = await driverDocumentAnalysisQueue.getActivationSnapshot(driverId);

    return res.json({
      success: true,
      data: snapshot
    });
  } catch (error) {
    logError(error, 'Erro ao buscar status de ativação do motorista', {
      service: 'driver-activation-routes',
      driverId: req.user?.uid || null
    });

    return res.status(500).json({
      success: false,
      message: `Erro ao obter status de ativação: ${error.message}`
    });
  }
});

router.get('/api/drivers/me/activation/documents', requireDriverAuth, async (req, res) => {
  try {
    const driverId = req.user.uid;
    const [statusSnapshot, history] = await Promise.all([
      driverDocumentAnalysisQueue.getActivationSnapshot(driverId),
      driverDocumentAnalysisQueue.listActivationDocuments(driverId)
    ]);

    return res.json({
      success: true,
      data: {
        documents: statusSnapshot?.documents || {},
        history,
        summary: statusSnapshot?.summary || {
          inReview: 0,
          approved: 0,
          failed: 0,
          pending: 0
        },
        updatedAt: statusSnapshot?.updatedAt || null
      }
    });
  } catch (error) {
    logError(error, 'Erro ao listar documentos de ativação do motorista', {
      service: 'driver-activation-routes',
      driverId: req.user?.uid || null
    });

    return res.status(500).json({
      success: false,
      message: `Erro ao listar documentos de ativação: ${error.message}`
    });
  }
});

module.exports = router;
