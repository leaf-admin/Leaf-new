const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const { logStructured, logError } = require('../utils/logger');
const redisPool = require('../utils/redis-pool');
const RedisScan = require('../utils/redis-scan');
const kycDriverStatusService = require('../services/kyc-driver-status-service');
const { getDashboardLiveData } = require('../services/dashboard-live-data-service');
const {
  listUsers,
  getUserStats,
  getUserDetails,
  updateUserProfile
} = require('../services/dashboard-user-service');
const supportTicketService = require('../services/support-ticket-service');
const driverApplicationService = require('../services/driver-application-service');
const driverSubscriptionService = require('../services/driver-subscription-service');
const subscriptionStateService = require('../services/subscription-state-service');
const modernMetricsService = require('../services/modern-metrics-service');
const h3MapService = require('../services/h3-map-service');
const { resolveDriverReactivationState } = require('../services/dashboard-user-management-service');
const {
  recomputeDriverActivationStatus
} = require('../services/driver-document-analysis-queue');
const { buildRecentRideActivities } = require('../services/dashboard-ride-monitoring-service');
const os = require('os');

// ✅ Importar middlewares de autenticação
const { authenticateJWT, requireRole, requirePermission } = require('../middleware/jwt-auth');
const { resolveJwtSecret } = require('../utils/jwt-secret-resolver');
const { getAdminUser } = require('../utils/admin-user-cache');

// Firebase integration
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'dashboard-routes' });
}

const legacyPromotionsRoutesEnabled =
  String(process.env.ENABLE_LEGACY_PROMOTIONS_ROUTES || 'false').toLowerCase() === 'true';
const legacyDashboardUsersMirrorEnabled =
  String(process.env.ENABLE_LEGACY_DASHBOARD_USERS_RTDB_MIRROR || 'false').toLowerCase() === 'true';
const DASHBOARD_OPERATION_ROLES = ['admin', 'super-admin', 'manager', 'support', 'development'];
const DASHBOARD_SUPPORT_ROLES = ['admin', 'super-admin', 'manager', 'support', 'development'];
const DASHBOARD_FINANCIAL_ROLES = ['admin', 'super-admin', 'manager'];
const DASHBOARD_MONITORING_ROLES = ['admin', 'super-admin', 'manager', 'development'];
const DASHBOARD_JWT_SECRET = resolveJwtSecret(['JWT_SECRET', 'ADMIN_JWT_SECRET'], {
  context: 'dashboard-routes'
});

function emitDriverActivationUnlockedEvent(req, driverId, payload = {}) {
  const io = req?.app?.get?.('io') || req?.app?.locals?.io || null;
  if (!io || !driverId) return;
  io.to(`driver_${driverId}`).emit('driverDocumentStatusUpdated', {
    driverId,
    documentType: 'activation_status',
    status: 'approved',
    updatedAt: new Date().toISOString(),
    canGoOnline: true,
    ...payload
  });
}

function createRouteMiddlewareLayer(handle, name) {
  // Express route stacks use internal Layer instances. Creating the same shape
  // lets us harden legacy route declarations without rewriting thousands of
  // lines of dashboard handlers in one risky pass.
  const Layer = require('express/lib/router/layer');
  const layer = new Layer('/', {}, handle);
  layer.method = undefined;
  layer.name = name || handle.name || '<anonymous>';
  return layer;
}

function getDashboardRoutePath(layer) {
  const pathValue = layer?.route?.path;
  return typeof pathValue === 'string' ? pathValue : '';
}

function getDashboardRouteMethods(layer) {
  return Object.entries(layer?.route?.methods || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([method]) => String(method).toUpperCase());
}

function dashboardRouteHasMiddleware(layer, handleRef, name) {
  return (layer?.route?.stack || []).some((stackLayer) => (
    stackLayer.handle === handleRef ||
    stackLayer.handle?._dashboardAutoMiddleware === name ||
    stackLayer.name === name ||
    stackLayer.handle?.name === name
  ));
}

function resolveDashboardHardeningRoles(methods, routePath) {
  const normalizedPath = String(routePath || '').toLowerCase();
  const hasMutation = methods.some((method) => !['GET', 'HEAD', 'OPTIONS'].includes(method));

  if (normalizedPath.includes('/support')) {
    return DASHBOARD_SUPPORT_ROLES;
  }

  if (
    normalizedPath.includes('/subscriptions') ||
    normalizedPath.includes('/promotions') ||
    normalizedPath.includes('/revenue') ||
    normalizedPath.includes('/financial') ||
    normalizedPath.includes('/costs')
  ) {
    return DASHBOARD_FINANCIAL_ROLES;
  }

  if (
    normalizedPath.includes('/monitoring') ||
    normalizedPath.includes('/system/status') ||
    normalizedPath.includes('/metrics/services')
  ) {
    return DASHBOARD_MONITORING_ROLES;
  }

  if (hasMutation) {
    return DASHBOARD_OPERATION_ROLES;
  }

  return DASHBOARD_OPERATION_ROLES;
}

function hardenDashboardApiRoutes() {
  let hardenedRoutes = 0;

  for (const layer of router.stack || []) {
    if (!layer?.route) continue;

    const routePath = getDashboardRoutePath(layer);
    if (!routePath.startsWith('/api/')) continue;

    if (dashboardRouteHasMiddleware(layer, authenticateJWT, 'authenticateJWT')) {
      continue;
    }

    if (dashboardRouteHasMiddleware(layer, authenticateLegacyDashboardSupportJWTOrSkip, 'authenticateLegacyDashboardSupportJWTOrSkip')) {
      continue;
    }

    const methods = getDashboardRouteMethods(layer);
    const roles = resolveDashboardHardeningRoles(methods, routePath);
    const roleMiddleware = requireRole(roles);
    roleMiddleware._dashboardAutoMiddleware = 'dashboardAutoRequireRole';

    layer.route.stack.unshift(
      createRouteMiddlewareLayer(roleMiddleware, 'dashboardAutoRequireRole')
    );
    layer.route.stack.unshift(
      createRouteMiddlewareLayer(authenticateJWT, 'authenticateJWT')
    );
    hardenedRoutes += 1;
  }

  logStructured('info', 'Dashboard API routes hardening aplicado', {
    service: 'dashboard-routes',
    hardenedRoutes
  });
}

function rejectDashboardMockEndpointInProduction(req, res, routeName) {
  const productionRuntime = [
    process.env.NODE_ENV,
    process.env.APP_ENV,
    process.env.LEAF_ENV,
    process.env.ENVIRONMENT
  ].some((value) => ['production', 'prod'].includes(String(value || '').toLowerCase()));
  const mockEndpointsEnabled =
    String(process.env.ENABLE_DASHBOARD_MOCK_ENDPOINTS || 'false').toLowerCase() === 'true';

  if (!productionRuntime || mockEndpointsEnabled) {
    return false;
  }

  res.status(410).json({
    success: false,
    error: 'Endpoint mock desabilitado em produção',
    routeName
  });
  return true;
}

const adminDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Formato inválido. Envie PDF ou imagem.'));
  }
});

async function authenticateLegacyDashboardSupportJWTOrSkip(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '').trim();
    if (!token) {
      return next('route');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, DASHBOARD_JWT_SECRET);
    } catch {
      return next('route');
    }

    const adminUser = await getAdminUser(decoded.userId, {
      source: 'dashboard-routes.support-legacy-gate',
      maxAgeMs: 15 * 1000
    });

    if (!adminUser.exists || adminUser.data?.active === false) {
      return res.status(403).json({
        success: false,
        error: 'Usuário não encontrado ou inativo'
      });
    }

    const userData = adminUser.data || {};
    req.user = {
      id: decoded.userId,
      email: decoded.email || userData.email,
      role: decoded.role || userData.role || 'viewer',
      permissions: decoded.permissions || userData.permissions || []
    };

    return next();
  } catch (error) {
    logError(error, 'Erro ao validar JWT legado de suporte do dashboard', {
      service: 'dashboard-routes',
      operation: 'authenticateLegacyDashboardSupportJWTOrSkip'
    });
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
}

function parseRatingValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeId(value) {
  return String(value || '').trim();
}

function flattenTripRatings(tripRatingsRaw = {}) {
  const flattened = [];
  if (!tripRatingsRaw || typeof tripRatingsRaw !== 'object') {
    return flattened;
  }

  for (const [tripId, tripNode] of Object.entries(tripRatingsRaw)) {
    if (!tripNode || typeof tripNode !== 'object') continue;

    // Formato 1: trip_ratings/{tripId}/{ratingId}
    for (const [ratingId, ratingData] of Object.entries(tripNode)) {
      if (!ratingData || typeof ratingData !== 'object') continue;
      if (parseRatingValue(ratingData.rating) == null) continue;
      flattened.push({
        id: ratingData.id || ratingId,
        tripId: ratingData.tripId || tripId,
        ...ratingData
      });
    }
  }

  return flattened;
}

function computeAverageRatingForUser(userId, userType, bookingArray = [], tripRatings = []) {
  const safeUserId = normalizeId(userId);
  if (!safeUserId) return 0;

  // Fonte principal: trip_ratings (mais confiável e recente).
  const tripRatingsForUser = tripRatings
    .filter((rating) => normalizeId(rating.targetUserId || rating.targetUser || rating.target_uid) === safeUserId)
    .map((rating) => parseRatingValue(rating.rating))
    .filter((value) => value != null);

  if (tripRatingsForUser.length > 0) {
    return tripRatingsForUser.reduce((sum, value) => sum + value, 0) / tripRatingsForUser.length;
  }

  // Fallback legado: campos no booking.
  if (userType === 'driver') {
    const legacyRatings = bookingArray
      .filter((booking) => normalizeId(booking.driver || booking.driverId || booking.driver_id) === safeUserId)
      .map((booking) => parseRatingValue(booking.rating))
      .filter((value) => value != null);

    if (legacyRatings.length > 0) {
      return legacyRatings.reduce((sum, value) => sum + value, 0) / legacyRatings.length;
    }
  }

  if (userType === 'customer') {
    const legacyRatings = bookingArray
      .filter((booking) => normalizeId(booking.customer || booking.customerId || booking.customer_id) === safeUserId)
      .map((booking) => parseRatingValue(booking.driver_rating))
      .filter((value) => value != null);

    if (legacyRatings.length > 0) {
      return legacyRatings.reduce((sum, value) => sum + value, 0) / legacyRatings.length;
    }
  }

  return 0;
}

function normalizeBirthDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const ddmmyyyy = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm}-${dd}`;
  }

  const yyyymmdd = raw.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (yyyymmdd) {
    const [, yyyy, mm, dd] = yyyymmdd;
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeSupportDashboardTicket(ticket = {}) {
  return {
    id: ticket.id,
    type: ticket.type || ticket.metadata?.type || 'ticket',
    title: ticket.title || ticket.subject || 'Ticket de suporte',
    description: ticket.description || '',
    userId: ticket.userId || '',
    userType: ticket.userType || 'customer',
    status: ticket.status || 'open',
    priority: ticket.priority || 'N3',
    category: ticket.category || 'general',
    location: ticket.location || null,
    createdAt: ticket.createdAt || new Date().toISOString(),
    updatedAt: ticket.updatedAt || ticket.createdAt || new Date().toISOString(),
    assignedTo: ticket.assignedTo || ticket.assignedAgent || null,
    resolution: ticket.resolution || null,
    bookingId: ticket.bookingId || ticket.metadata?.bookingId || null,
    rating: ticket.rating || null,
    escalationLevel: ticket.escalationLevel || 1,
    source: ticket.source || 'firestore',
    user: ticket.user || (
      ticket.userInfo && typeof ticket.userInfo === 'object'
        ? {
            name: ticket.userInfo.name || '',
            email: ticket.userInfo.email || '',
            phone: ticket.userInfo.phone || ticket.userInfo.mobile || ''
          }
        : null
    )
  };
}

function normalizeMotherName(value) {
  const name = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return name || null;
}

function normalizeGenderCode(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

  if (!normalized) return null;
  if (['F', 'FEMININO', 'FEMALE', 'MULHER'].includes(normalized)) return 'F';
  if (['M', 'MASCULINO', 'MALE', 'HOMEM'].includes(normalized)) return 'M';
  if (['X', 'OUTRO', 'OTHER', 'N', 'NB', 'NAO BINARIO', 'NAO-BINARIO', 'NON BINARY'].includes(normalized)) {
    return 'X';
  }
  return null;
}

function genderCodeToLabel(code) {
  if (code === 'F') return 'Feminino';
  if (code === 'M') return 'Masculino';
  if (code === 'X') return 'Outro';
  return null;
}

function resolveDriverIdentityData(userData = {}, documents = {}) {
  const cnhExtracted = documents?.cnh?.extractedData || {};
  const cnhIdentity = documents?.cnh?.extractedIdentity || {};

  const birthDate = normalizeBirthDate(
    userData?.birthDate ||
      userData?.dateOfBirth ||
      userData?.dob ||
      userData?.dataNascimento ||
      cnhExtracted?.dataNascimento ||
      cnhExtracted?.birthDate ||
      cnhExtracted?.dateOfBirth ||
      cnhIdentity?.birthDate ||
      null
  );

  const motherName = normalizeMotherName(
    userData?.motherName ||
      userData?.nomeMae ||
      userData?.nomeDaMae ||
      cnhExtracted?.nomeMae ||
      cnhExtracted?.nome_da_mae ||
      cnhExtracted?.nomeDaMae ||
      cnhExtracted?.mae ||
      cnhExtracted?.motherName ||
      cnhExtracted?.filiacaoMae ||
      cnhExtracted?.filiacao?.mae ||
      cnhIdentity?.motherName ||
      null
  );

  const gender = normalizeGenderCode(
    userData?.gender ||
      userData?.genero ||
      cnhExtracted?.genero ||
      cnhExtracted?.sexo ||
      cnhExtracted?.gender ||
      cnhExtracted?.sex ||
      cnhIdentity?.gender ||
      null
  );

  return {
    birthDate,
    motherName,
    gender,
    genderLabel: genderCodeToLabel(gender)
  };
}

// 📊 DASHBOARD APIs
// Estas APIs serão implementadas para fornecer dados para o dashboard

// 👥 User Management - DADOS REAIS (Firebase + Redis)
router.get('/api/users/stats', async (req, res) => {
  try {
    const redis = redisPool.getConnection();
    const stats = await getUserStats(redis, req.query || {});
    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats de usuários:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 👥 Enhanced User Management - GESTÃO AVANÇADA
router.get('/api/users', async (req, res) => {
  try {
    const response = await listUsers(req.query || {});
    res.json(response);
  } catch (error) {
    logError(error, 'Erro ao buscar usuários:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/api/users/:userId', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const user = await getUserDetails(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    return res.json(user);
  } catch (error) {
    logError(error, 'Erro ao buscar detalhes do usuário', { service: 'dashboard-routes' });
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 👤 Atualizar dados cadastrais de usuário via dashboard (admin)
router.patch('/api/users/:userId', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { userId } = req.params;
    const safeUserId = normalizeId(userId);
    if (!safeUserId) {
      return res.status(400).json({ error: 'userId inválido' });
    }
    const legacyDb = firebaseConfig?.getRealtimeDB ? firebaseConfig.getRealtimeDB() : null;
    const updatedUser = await updateUserProfile(safeUserId, req.body || {}, {
      mirrorToLegacyRtdb: legacyDashboardUsersMirrorEnabled,
      legacyDb
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (updatedUser.skipped) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualização' });
    }

    return res.json({
      success: true,
      message: 'Dados cadastrais atualizados com sucesso',
      user: {
        id: safeUserId,
        firstName: updatedUser.raw?.firstName || '',
        lastName: updatedUser.raw?.lastName || '',
        email: updatedUser.email || '',
        mobile: updatedUser.mobile || '',
        city: updatedUser.city || '',
        state: updatedUser.state || '',
        approved: Boolean(updatedUser.approved),
        updatedAt: updatedUser.raw?.updatedAt || null
      }
    });
  } catch (error) {
    logError(error, 'Erro ao atualizar dados cadastrais de usuário', { service: 'dashboard-routes' });
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🚗 Driver Applications - SISTEMA COMPLETO DE APROVAÇÃO
router.get('/api/drivers/applications', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const response = await driverApplicationService.listApplications(req.query || {});
    res.json(response);
  } catch (error) {
    logError(error, 'Erro ao buscar aplicações:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📋 Aprovar/Rejeitar Documento Específico - NOVO SISTEMA
// ✅ Protegido com autenticação JWT e permissão de admin
router.post('/api/drivers/:driverId/documents/:documentType/review', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { driverId, documentType } = req.params;
    const { action, rejectionReason } = req.body; // action: 'approve' | 'reject'
    const reviewedBy = req.user.id; // ✅ ID do admin logado
    const normalizedDocumentType = sanitizeDocumentType(documentType);

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Ação inválida. Use "approve" ou "reject".'
      });
    }

    if (action === 'reject' && !rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'Motivo da rejeição é obrigatório.'
      });
    }

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o documento existe
        const documentRef = db.ref(`users/${driverId}/documents/${normalizedDocumentType}`);
        const documentSnapshot = await documentRef.once('value');

        if (!documentSnapshot.exists()) {
          return res.status(404).json({
            success: false,
            message: 'Documento não encontrado.'
          });
        }

        const existingDocument = documentSnapshot.val() || {};
        const nextStatus = action === 'approve' ? 'approved' : 'rejected';
        const reviewAtIso = new Date().toISOString();

        // ✅ Atualizar status do documento no Firebase Realtime Database
        const reviewData = {
          status: nextStatus,
          reviewedAt: reviewAtIso,
          reviewedBy: reviewedBy, // ✅ ID do admin logado
          reviewedByEmail: req.user.email, // ✅ Email do admin para auditoria
          updatedAt: reviewAtIso
        };

        if (action === 'reject') {
          reviewData.rejectionReason = rejectionReason;
        }

        // ✅ Salvar alteração no Firebase Realtime Database
        await documentRef.update(reviewData);

        // Índice denormalizado para consultas rápidas por tipo/status.
        const statusIndexPath = `driver_documents_index/${normalizedDocumentType}`;
        const statusBuckets = ['pending', 'approved', 'rejected'];
        const indexUpdates = {};
        statusBuckets.forEach((bucket) => {
          indexUpdates[`${statusIndexPath}/${bucket}/${driverId}`] = null;
        });
        indexUpdates[`${statusIndexPath}/${nextStatus}/${driverId}`] = {
          driverId,
          documentType: normalizedDocumentType,
          status: nextStatus,
          uploadedAt: existingDocument.uploadedAt || null,
          reviewedAt: reviewAtIso,
          updatedAt: reviewAtIso,
          fileName: existingDocument.fileName || null,
          fileType: existingDocument.fileType || null
        };
        await db.ref().update(indexUpdates);
        await adjustDocumentIndexCounters(
          db,
          normalizedDocumentType,
          existingDocument.status || null,
          nextStatus
        );

        // ✅ Atualizar também o status geral do motorista se todos os documentos estiverem aprovados
        if (action === 'approve') {
          const allDocsSnapshot = await db.ref(`users/${driverId}/documents`).once('value');
          const allDocs = allDocsSnapshot.val() || {};
          const allApproved = Object.values(allDocs).every(doc => doc.status === 'approved');

          if (allApproved) {
            await db.ref(`users/${driverId}`).update({
              approved: true,
              approvedAt: new Date().toISOString(),
              approvedBy: reviewedBy
            });
          }
        }

        try {
          await driverApplicationService.syncDriverApplication(driverId, {
            db,
            includeRatings: false
          });
        } catch (syncError) {
          logStructured('warn', 'Falha ao sincronizar espelho Firestore da aplicação do motorista', {
            service: 'dashboard-routes',
            driverId,
            error: syncError.message
          });
        }

        logStructured('info', `✅ Documento ${normalizedDocumentType} do motorista ${driverId} ${action === 'approve' ? 'aprovado' : 'rejeitado'} por ${req.user.email} (${reviewedBy})`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: `Documento ${action === 'approve' ? 'aprovado' : 'rejeitado'} com sucesso!`,
          data: {
            driverId,
            documentType: normalizedDocumentType,
            action,
            reviewedAt: reviewData.reviewedAt
          }
        });
      } else {
        throw new Error('Firebase não configurado');
      }
    } catch (error) {
      logError(error, '❌ Erro ao revisar documento:', { service: 'dashboard-routes' });
      res.status(500).json({
        success: false,
        message: `Erro ao ${action === 'approve' ? 'aprovar' : 'rejeitar'} documento: ${error.message}`
      });
    }
  } catch (error) {
    logError(error, '❌ Erro na API de review de documento:', { service: 'dashboard-routes' });
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor.'
    });
  }
});

// 📋 Buscar Documentos de um Motorista Específico - NOVA API
// ✅ Protegido com autenticação JWT e permissão de admin
router.get('/api/drivers/:driverId/documents', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    const application = await driverApplicationService.getDriverApplication(driverId, {
      refresh: true,
      includeRatings: true
    });
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Motorista não encontrado.'
      });
    }

    res.json({
      success: true,
      data: {
        driverId,
        driver: application.driver,
        ratingInsights: application.ratingInsights || {
          averageRating: null,
          totalRatings: 0,
          latestNegativeReviews: []
        },
        kyc: application.kyc || {},
        documents: application.documents || {},
        totalDocuments: application.totalDocuments || 0,
        vehicleConfig: application.vehicleConfig || {
          vehicles: []
        }
      }
    });
  } catch (error) {
    logError(error, '❌ Erro na API de documentos:', { service: 'dashboard-routes' });
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor.'
    });
  }
});

function sanitizeDocumentType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '_')
    .replace(/_+/g, '_');
}

function sanitizeFilename(value) {
  return String(value || 'documento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');
}

const REVIEWABLE_DOCUMENT_TYPES = ['cnh', 'crlv', 'antecedentes_criminais', 'mei'];
const REVIEWABLE_DOCUMENT_STATUSES = ['pending', 'approved', 'rejected'];
const REVIEWABLE_DOCUMENT_SORT_FIELDS = ['uploadedAt', 'updatedAt', 'reviewedAt'];

function normalizeQueueStatus(value) {
  const normalized = String(value || 'pending').trim().toLowerCase();
  if (normalized === 'all') return 'all';
  return REVIEWABLE_DOCUMENT_STATUSES.includes(normalized) ? normalized : 'pending';
}

function normalizeQueueSortField(value) {
  const normalized = String(value || 'uploadedAt').trim();
  return REVIEWABLE_DOCUMENT_SORT_FIELDS.includes(normalized) ? normalized : 'uploadedAt';
}

function normalizeQueueSortOrder(value) {
  const normalized = String(value || 'desc').trim().toLowerCase();
  return normalized === 'asc' ? 'asc' : 'desc';
}

function parseTimestampValue(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeIndexStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return REVIEWABLE_DOCUMENT_STATUSES.includes(normalized) ? normalized : null;
}

async function adjustDocumentIndexCounters(db, documentType, previousStatus, nextStatus) {
  const safeDocumentType = sanitizeDocumentType(documentType);
  if (!safeDocumentType) return;

  const fromStatus = normalizeIndexStatus(previousStatus);
  const toStatus = normalizeIndexStatus(nextStatus);

  if (!fromStatus && !toStatus) return;
  if (fromStatus === toStatus) return;

  const deltas = {};
  if (fromStatus) deltas[fromStatus] = (deltas[fromStatus] || 0) - 1;
  if (toStatus) deltas[toStatus] = (deltas[toStatus] || 0) + 1;

  await Promise.all(
    Object.entries(deltas).map(([status, delta]) =>
      db.ref(`driver_documents_index_stats/${safeDocumentType}/${status}`).transaction((current) => {
        const currentNumber = Number.parseInt(current, 10);
        const safeCurrent = Number.isFinite(currentNumber) ? currentNumber : 0;
        const nextValue = safeCurrent + delta;
        return nextValue > 0 ? nextValue : 0;
      })
    )
  );
}

// 📚 Fila de revisão de documentos usando índice denormalizado
router.get(
  '/api/drivers/documents/review-queue',
  authenticateJWT,
  requireRole(DASHBOARD_OPERATION_ROLES),
  async (req, res) => {
    try {
      const data = await driverApplicationService.listReviewQueue(req.query || {});
      return res.json({
        success: true,
        data
      });
    } catch (error) {
      logError(error, 'Erro ao buscar fila de revisão de documentos', { service: 'dashboard-routes' });
      return res.status(500).json({
        success: false,
        message: `Erro ao buscar fila de revisão: ${error.message}`
      });
    }
  }
);

// 📎 Upload de documento pelo dashboard (ex.: certidão de antecedentes)
router.post(
  '/api/drivers/:driverId/documents/:documentType/upload',
  authenticateJWT,
  requireRole(DASHBOARD_OPERATION_ROLES),
  (req, res, next) => {
    adminDocumentUpload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || 'Falha ao receber arquivo'
        });
      }
      return next();
    });
  },
  async (req, res) => {
    try {
      const { driverId } = req.params;
      const documentType = sanitizeDocumentType(req.params.documentType);

      if (!driverId || !documentType) {
        return res.status(400).json({
          success: false,
          message: 'driverId e documentType são obrigatórios.'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Arquivo é obrigatório.'
        });
      }

      if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
        return res.status(503).json({
          success: false,
          message: 'Firebase não configurado.'
        });
      }

      const db = firebaseConfig.getRealtimeDB();
      const userSnapshot = await db.ref(`users/${driverId}`).once('value');
      if (!userSnapshot.exists()) {
        return res.status(404).json({
          success: false,
          message: 'Motorista não encontrado.'
        });
      }

      const requestedMime = String(req.file.mimetype || '').toLowerCase();
      if (documentType === 'antecedentes_criminais' && requestedMime !== 'application/pdf') {
        return res.status(400).json({
          success: false,
          message: 'A certidão de antecedentes deve ser enviada em PDF.'
        });
      }

      const nowIso = new Date().toISOString();
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'leaf-reactnative.firebasestorage.app';
      const bucket = admin.storage().bucket(bucketName);
      const fileName = sanitizeFilename(req.file.originalname || `${documentType}.pdf`);
      const extension = path.extname(fileName) || (requestedMime === 'application/pdf' ? '.pdf' : '');
      const objectPath = `documents/${driverId}/${documentType}/${Date.now()}_${fileName.replace(extension, '')}${extension}`;
      const storageFile = bucket.file(objectPath);

      await storageFile.save(req.file.buffer, {
        resumable: false,
        metadata: {
          contentType: req.file.mimetype,
          metadata: {
            uploadedBy: String(req.user?.id || ''),
            uploadedByEmail: String(req.user?.email || ''),
            documentType,
            driverId
          }
        }
      });

      const [signedUrl] = await storageFile.getSignedUrl({
        action: 'read',
        expires: '2035-01-01'
      });

      const documentPayload = {
        type: documentType,
        status: 'pending',
        fileUrl: signedUrl,
        filePath: objectPath,
        fileType: req.file.mimetype,
        fileName,
        fileSize: Number(req.file.size || 0),
        uploadedAt: nowIso,
        uploadedBy: String(req.user?.id || ''),
        uploadedByEmail: String(req.user?.email || ''),
        updatedAt: nowIso
      };

      const documentPath = `users/${driverId}/documents/${documentType}`;
      const previousDocumentSnapshot = await db.ref(documentPath).once('value');
      const previousDocument = previousDocumentSnapshot.val() || {};
      const previousStatus = previousDocument?.status || null;
      const statusIndexPath = `driver_documents_index/${documentType}`;
      const indexPayload = {
        driverId,
        documentType,
        status: 'pending',
        uploadedAt: nowIso,
        reviewedAt: null,
        updatedAt: nowIso,
        fileName,
        fileType: req.file.mimetype
      };

      await db.ref().update({
        [documentPath]: documentPayload,
        [`${statusIndexPath}/pending/${driverId}`]: indexPayload,
        [`${statusIndexPath}/approved/${driverId}`]: null,
        [`${statusIndexPath}/rejected/${driverId}`]: null
      });
      await adjustDocumentIndexCounters(db, documentType, previousStatus, 'pending');

      try {
        await driverApplicationService.syncDriverApplication(driverId, {
          db,
          includeRatings: false
        });
      } catch (syncError) {
        logStructured('warn', 'Falha ao sincronizar espelho Firestore após upload de documento no dashboard', {
          service: 'dashboard-routes',
          driverId,
          documentType,
          error: syncError.message
        });
      }

      logStructured('info', 'Documento enviado via dashboard', {
        service: 'dashboard-routes',
        driverId,
        documentType,
        uploadedBy: req.user?.email || req.user?.id || 'admin',
        fileSize: documentPayload.fileSize
      });

      return res.json({
        success: true,
        message: 'Documento enviado com sucesso.',
        data: {
          driverId,
          documentType,
          fileUrl: signedUrl,
          status: 'pending'
        }
      });
    } catch (error) {
      logError(error, 'Erro ao fazer upload de documento no dashboard', { service: 'dashboard-routes' });
      return res.status(500).json({
        success: false,
        message: `Erro ao enviar documento: ${error.message}`
      });
    }
  }
);

// 🚗 Atualizar configuração manual de veículo/categoria do motorista
// ✅ Protegido com autenticação JWT e permissão de admin
router.post('/api/drivers/:driverId/vehicle/config', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    const {
      userVehicleId,
      setActive = true,
      category,
      vehicleStatus,
      acceptPlusWithElite
    } = req.body || {};

    if (!userVehicleId) {
      return res.status(400).json({
        success: false,
        message: 'userVehicleId é obrigatório.'
      });
    }

    const normalizedCategory = category ? String(category).trim().toLowerCase() : null;
    if (normalizedCategory && !['plus', 'elite', 'moto'].includes(normalizedCategory)) {
      return res.status(400).json({
        success: false,
        message: 'Categoria inválida. Use plus, elite ou moto.'
      });
    }

    if (vehicleStatus && !['approved', 'pending', 'rejected', 'active', 'inactive'].includes(String(vehicleStatus).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'vehicleStatus inválido.'
      });
    }

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(503).json({
        success: false,
        message: 'Firebase não configurado.'
      });
    }

    const db = firebaseConfig.getRealtimeDB();
    const userRef = db.ref(`users/${driverId}`);
    const userSnapshot = await userRef.once('value');
    if (!userSnapshot.exists()) {
      return res.status(404).json({ success: false, message: 'Motorista não encontrado.' });
    }

    const userVehiclesRef = db.ref(`user_vehicles/${driverId}`);
    const userVehiclesSnapshot = await userVehiclesRef.once('value');
    const userVehicles = userVehiclesSnapshot.val() || {};
    const selected = userVehicles[userVehicleId];

    if (!selected) {
      return res.status(404).json({
        success: false,
        message: 'Veículo do motorista não encontrado.'
      });
    }

    const selectedVehicleId = selected.vehicleId || null;
    const nowIso = new Date().toISOString();
    if (setActive !== false && !selectedVehicleId) {
      return res.status(400).json({
        success: false,
        message: 'Não é possível ativar vínculo sem vehicleId associado.'
      });
    }

    const releaseVehicleLockForDriver = async (vehicleId) => {
      if (!vehicleId) return;
      const lockRef = db.ref(`vehicle_active_assignment/${vehicleId}`);
      await lockRef.transaction((current) => {
        if (!current) return current;
        const currentUserId = String(current.userId || current.driverId || '');
        if (currentUserId !== String(driverId)) return current;
        return null;
      });
    };

    const acquireVehicleLockForDriver = async (vehicleId) => {
      if (!vehicleId) return { ok: false, conflict: null };
      const lockRef = db.ref(`vehicle_active_assignment/${vehicleId}`);
      const lockPayload = {
        userId: driverId,
        driverId,
        vehicleId,
        userVehicleId,
        source: 'dashboard_admin',
        assignedAt: nowIso,
        updatedAt: nowIso
      };

      const tx = await lockRef.transaction((current) => {
        if (!current) return lockPayload;
        const currentUserId = String(current.userId || current.driverId || '');
        if (currentUserId === String(driverId)) {
          return {
            ...current,
            ...lockPayload,
            assignedAt: current.assignedAt || nowIso
          };
        }
        return;
      });

      if (!tx.committed) {
        return {
          ok: false,
          conflict: tx?.snapshot?.val() || null
        };
      }

      return {
        ok: true,
        conflict: null
      };
    };

    const lockAffectedVehicleIds = new Set();
    const currentlyActiveVehicleIds = [...new Set(
      Object.values(userVehicles)
        .filter((item) => item?.isActive === true && item?.vehicleId)
        .map((item) => String(item.vehicleId))
    )];

    for (const activeVehicleId of currentlyActiveVehicleIds) {
      if (setActive !== false && selectedVehicleId && String(activeVehicleId) === String(selectedVehicleId)) {
        continue;
      }
      lockAffectedVehicleIds.add(String(activeVehicleId));
      await releaseVehicleLockForDriver(String(activeVehicleId));
    }

    if (selectedVehicleId) {
      lockAffectedVehicleIds.add(String(selectedVehicleId));
      if (setActive !== false) {
        const acquireResult = await acquireVehicleLockForDriver(String(selectedVehicleId));
        if (!acquireResult.ok) {
          const conflictUserId = acquireResult?.conflict?.userId || acquireResult?.conflict?.driverId || null;
          return res.status(409).json({
            success: false,
            code: 'VEHICLE_ALREADY_ACTIVE',
            message: conflictUserId
              ? `Este veículo já está ativo no perfil ${conflictUserId}.`
              : 'Este veículo já está ativo em outro perfil.',
            data: {
              vehicleId: selectedVehicleId,
              conflict: acquireResult?.conflict || null
            }
          });
        }
      } else {
        await releaseVehicleLockForDriver(String(selectedVehicleId));
      }
    }

    const updates = {};
    Object.keys(userVehicles).forEach((id) => {
      updates[`user_vehicles/${driverId}/${id}/isActive`] = false;
      updates[`user_vehicles/${driverId}/${id}/updatedAt`] = nowIso;
    });

    updates[`user_vehicles/${driverId}/${userVehicleId}/isActive`] = setActive !== false;
    updates[`user_vehicles/${driverId}/${userVehicleId}/updatedAt`] = nowIso;
    updates[`users/${driverId}/activeVehicleId`] = setActive !== false ? (selectedVehicleId || '') : '';
    updates[`users/${driverId}/updatedAt`] = nowIso;

    if (vehicleStatus) {
      const nextStatus = String(vehicleStatus).toLowerCase();
      updates[`user_vehicles/${driverId}/${userVehicleId}/status`] = nextStatus;
      updates[`user_vehicles/${driverId}/${userVehicleId}/approved`] = ['approved', 'active'].includes(nextStatus);
      updates[`user_vehicles/${driverId}/${userVehicleId}/reviewedAt`] = nowIso;
      updates[`user_vehicles/${driverId}/${userVehicleId}/reviewedBy`] = req.user.id;
    }

    if (normalizedCategory) {
      const categoryLabel = normalizedCategory === 'elite'
        ? 'Leaf Elite'
        : normalizedCategory === 'moto'
          ? 'Leaf Moto'
          : 'Leaf Plus';
      if (selected.vehicleId) {
        updates[`vehicles/${selected.vehicleId}/manualCategory`] = normalizedCategory;
        updates[`vehicles/${selected.vehicleId}/carType`] = categoryLabel;
        updates[`vehicles/${selected.vehicleId}/category`] = normalizedCategory;
        updates[`vehicles/${selected.vehicleId}/updatedAt`] = nowIso;
      }
      updates[`users/${driverId}/carType`] = categoryLabel;
      updates[`users/${driverId}/updatedAt`] = nowIso;
    }

    if (typeof acceptPlusWithElite === 'boolean') {
      updates[`users/${driverId}/acceptPlusWithElite`] = acceptPlusWithElite;
      updates[`users/${driverId}/updatedAt`] = nowIso;
    }

    const lockIds = [...lockAffectedVehicleIds];
    for (const lockVehicleId of lockIds) {
      const assignmentSnapshot = await db.ref(`vehicle_active_assignment/${lockVehicleId}`).once('value');
      const assignment = assignmentSnapshot.val() || null;
      const assignedUserId = assignment ? (assignment.userId || assignment.driverId || null) : null;
      updates[`vehicles/${lockVehicleId}/activeDriverId`] = assignedUserId;
      updates[`vehicles/${lockVehicleId}/activeUserVehicleId`] = assignment?.userVehicleId || null;
      updates[`vehicles/${lockVehicleId}/isInUseByDriver`] = Boolean(assignedUserId);
      updates[`vehicles/${lockVehicleId}/updatedAt`] = nowIso;
    }

    await db.ref().update(updates);

    // Melhor esforço: atualizar cache Redis de elegibilidade para refletir mudança imediatamente.
    try {
      const redis = redisPool.getConnection();
      await redisPool.ensureConnection();
      const userData = (await userRef.once('value')).val() || {};
      const selectedVehicleSnapshot = selected.vehicleId ? await db.ref(`vehicles/${selected.vehicleId}`).once('value') : null;
      const selectedVehicleData = selectedVehicleSnapshot?.val() || {};
      const plate = selectedVehicleData.plate || selectedVehicleData.vehicleNumber || userData.vehicleNumber || userData.carPlate || '';
      const resolvedCategory = normalizedCategory ||
        selectedVehicleData.manualCategory ||
        selectedVehicleData.category ||
        (
          String(userData.carType || '').toLowerCase().includes('elite')
            ? 'elite'
            : String(userData.carType || '').toLowerCase().includes('moto')
              ? 'moto'
              : 'plus'
        );

      await redis.hset(`driver:${driverId}`, {
        carType: resolvedCategory === 'elite' ? 'Leaf Elite' : resolvedCategory === 'moto' ? 'Leaf Moto' : 'Leaf Plus',
        vehicleCategory: resolvedCategory,
        vehicleNumber: plate,
        acceptsPlusWithElite: String(userData.acceptPlusWithElite === true || acceptPlusWithElite === true),
        activeVehicleId: setActive !== false ? (selected.vehicleId || '') : '',
        driverApproved: String(userData.approved === true),
        vehicleApproved: String((selected.status || '') === 'approved' || selected.approved === true),
        lastVehicleConfigUpdate: nowIso
      });
      await redis.del(`driver_eligibility_profile:${driverId}`);
    } catch (redisSyncError) {
      logStructured('warn', 'Falha ao sincronizar configuração de veículo no Redis', {
        service: 'dashboard-routes',
        driverId,
        error: redisSyncError.message
      });
    }

    res.json({
      success: true,
      message: 'Configuração do veículo atualizada com sucesso.',
      data: {
        driverId,
        userVehicleId,
        category: normalizedCategory || null,
        setActive: setActive !== false,
        vehicleStatus: vehicleStatus || null,
        acceptPlusWithElite: typeof acceptPlusWithElite === 'boolean' ? acceptPlusWithElite : null
      }
    });
  } catch (error) {
    logError(error, 'Erro ao atualizar configuração de veículo do motorista', { service: 'dashboard-routes' });
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor.'
    });
  }
});

// 🚗 Aprovar Aplicação de Motorista
// ✅ Protegido com autenticação JWT e permissão de admin
router.post('/api/drivers/applications/:id/approve', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const adminId = req.user.id; // ✅ ID do admin logado

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o usuário existe
        const userSnapshot = await db.ref(`users/${id}`).once('value');
        if (!userSnapshot.exists()) {
          return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        const user = userSnapshot.val();
        if (user.usertype !== 'driver') {
          return res.status(400).json({ error: 'Usuário não é um motorista' });
        }

        // ✅ Atualizar status de aprovação no Firebase Realtime Database
        const updates = {
          approved: true,
          approvedAt: new Date().toISOString(),
          approvedBy: adminId,
          approvedByEmail: req.user.email, // ✅ Email do admin para auditoria
          adminNotes: notes || '',
          status: 'approved',
          kycStatus: 'approved',
          kycBlocked: false,
          kycUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        // ✅ Salvar no Firebase Realtime Database
        await db.ref(`users/${id}`).update(updates);

        // ✅ Atualizar também todos os documentos para aprovados
        const documentsSnapshot = await db.ref(`users/${id}/documents`).once('value');
        const documents = documentsSnapshot.val() || {};
        const documentUpdates = {};
        const counterTransitions = [];
        const reviewedAtIso = new Date().toISOString();
        Object.keys(documents).forEach(docType => {
          const normalizedDocType = sanitizeDocumentType(docType);
          if (!normalizedDocType) return;
          const existingDoc = documents[docType] || {};
          const previousStatus = existingDoc.status || null;
          documentUpdates[`users/${id}/documents/${normalizedDocType}/status`] = 'approved';
          documentUpdates[`users/${id}/documents/${normalizedDocType}/reviewedAt`] = reviewedAtIso;
          documentUpdates[`users/${id}/documents/${normalizedDocType}/reviewedBy`] = adminId;
          documentUpdates[`users/${id}/documents/${normalizedDocType}/updatedAt`] = reviewedAtIso;
          documentUpdates[`users/${id}/documents/${normalizedDocType}/rejectionReason`] = null;
          documentUpdates[`driver_documents_index/${normalizedDocType}/pending/${id}`] = null;
          documentUpdates[`driver_documents_index/${normalizedDocType}/rejected/${id}`] = null;
          documentUpdates[`driver_documents_index/${normalizedDocType}/approved/${id}`] = {
            driverId: id,
            documentType: normalizedDocType,
            status: 'approved',
            uploadedAt: existingDoc.uploadedAt || null,
            reviewedAt: reviewedAtIso,
            updatedAt: reviewedAtIso,
            fileName: existingDoc.fileName || null,
            fileType: existingDoc.fileType || null
          };
          counterTransitions.push({ documentType: normalizedDocType, previousStatus, nextStatus: 'approved' });
        });
        if (Object.keys(documentUpdates).length > 0) {
          await db.ref().update(documentUpdates);
          if (counterTransitions.length > 0) {
            await Promise.all(
              counterTransitions.map((entry) =>
                adjustDocumentIndexCounters(db, entry.documentType, entry.previousStatus, entry.nextStatus)
              )
            );
          }
        }

        const activationUpdatedAt = new Date().toISOString();
        await Promise.all([
          db.ref(`users/${id}/driverActivationConsent`).update({
            backgroundCheck: true,
            updatedAt: activationUpdatedAt
          }),
          db.ref(`driver_activation/${id}/consent/backgroundCheck`).update({
            accepted: true,
            acceptedAt: activationUpdatedAt,
            updatedAt: activationUpdatedAt
          })
        ]);

        try {
          await recomputeDriverActivationStatus(id);
        } catch (recomputeError) {
          logStructured('warn', 'Falha ao recomputar ativação após aprovação de aplicação', {
            service: 'dashboard-routes',
            driverId: id,
            error: recomputeError?.message || String(recomputeError)
          });
        }

        emitDriverActivationUnlockedEvent(req, id, {
          activationState: 'ACTIVE'
        });

        // Melhor esforço: liberar bloqueio KYC para refletir aprovação manual.
        try {
          await kycDriverStatusService.unblockDriver(id, {
            confidence: 1,
            similarityScore: 1
          });
        } catch (kycUnblockError) {
          logStructured('warn', 'Falha ao liberar bloqueio KYC após aprovação manual', {
            service: 'dashboard-routes',
            driverId: id,
            error: kycUnblockError.message
          });
        }

        try {
          await driverApplicationService.syncDriverApplication(id, {
            db,
            includeRatings: false
          });
        } catch (syncError) {
          logStructured('warn', 'Falha ao sincronizar espelho Firestore após aprovação de motorista', {
            service: 'dashboard-routes',
            driverId: id,
            error: syncError.message
          });
        }

        logStructured('info', `✅ Aplicação aprovada: ${id} por ${req.user.email} (${adminId})`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Aplicação aprovada com sucesso',
          data: { driverId: id, approvedAt: updates.approvedAt }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao aprovar no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar aprovação' });
    }
  } catch (error) {
    logError(error, 'Erro ao aprovar aplicação:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🚗 Rejeitar Aplicação de Motorista
// ✅ Protegido com autenticação JWT e permissão de admin
router.post('/api/drivers/applications/:id/reject', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, rejectionReasons } = req.body;
    const adminId = req.user.id; // ✅ ID do admin logado

    if (!rejectionReasons) {
      return res.status(400).json({ error: 'Motivo da rejeição é obrigatório' });
    }

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o usuário existe
        const userSnapshot = await db.ref(`users/${id}`).once('value');
        if (!userSnapshot.exists()) {
          return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        const user = userSnapshot.val();
        if (user.usertype !== 'driver') {
          return res.status(400).json({ error: 'Usuário não é um motorista' });
        }

        // ✅ Atualizar status de rejeição no Firebase Realtime Database
        const updates = {
          approved: false,
          rejectedAt: new Date().toISOString(),
          rejectedBy: adminId,
          rejectedByEmail: req.user.email, // ✅ Email do admin para auditoria
          rejectionReasons: rejectionReasons,
          adminNotes: notes || '',
          status: 'rejected',
          kycStatus: 'rejected',
          kycBlocked: true,
          kycUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        // ✅ Salvar no Firebase Realtime Database
        await db.ref(`users/${id}`).update(updates);

        // ✅ Atualizar também todos os documentos para rejeitados
        const documentsSnapshot = await db.ref(`users/${id}/documents`).once('value');
        const documents = documentsSnapshot.val() || {};
        const documentUpdates = {};
        const counterTransitions = [];
        const reviewedAtIso = new Date().toISOString();
        Object.keys(documents).forEach(docType => {
          const normalizedDocType = sanitizeDocumentType(docType);
          if (!normalizedDocType) return;
          const existingDoc = documents[docType] || {};
          const previousStatus = existingDoc.status || null;
          documentUpdates[`users/${id}/documents/${normalizedDocType}/status`] = 'rejected';
          documentUpdates[`users/${id}/documents/${normalizedDocType}/reviewedAt`] = reviewedAtIso;
          documentUpdates[`users/${id}/documents/${normalizedDocType}/reviewedBy`] = adminId;
          documentUpdates[`users/${id}/documents/${normalizedDocType}/updatedAt`] = reviewedAtIso;
          documentUpdates[`users/${id}/documents/${normalizedDocType}/rejectionReason`] = rejectionReasons?.join(', ') || 'Aplicação rejeitada';
          documentUpdates[`driver_documents_index/${normalizedDocType}/pending/${id}`] = null;
          documentUpdates[`driver_documents_index/${normalizedDocType}/approved/${id}`] = null;
          documentUpdates[`driver_documents_index/${normalizedDocType}/rejected/${id}`] = {
            driverId: id,
            documentType: normalizedDocType,
            status: 'rejected',
            uploadedAt: existingDoc.uploadedAt || null,
            reviewedAt: reviewedAtIso,
            updatedAt: reviewedAtIso,
            fileName: existingDoc.fileName || null,
            fileType: existingDoc.fileType || null
          };
          counterTransitions.push({ documentType: normalizedDocType, previousStatus, nextStatus: 'rejected' });
        });
        if (Object.keys(documentUpdates).length > 0) {
          await db.ref().update(documentUpdates);
          if (counterTransitions.length > 0) {
            await Promise.all(
              counterTransitions.map((entry) =>
                adjustDocumentIndexCounters(db, entry.documentType, entry.previousStatus, entry.nextStatus)
              )
            );
          }
        }

        // Melhor esforço: bloquear também no pipeline KYC para impedir operação.
        try {
          await kycDriverStatusService.blockDriver(
            id,
            `Aprovação manual rejeitada: ${Array.isArray(rejectionReasons) ? rejectionReasons.join(', ') : rejectionReasons}`,
            { verificationAttempts: 0 }
          );
        } catch (kycBlockError) {
          logStructured('warn', 'Falha ao bloquear motorista no serviço KYC após rejeição manual', {
            service: 'dashboard-routes',
            driverId: id,
            error: kycBlockError.message
          });
        }

        try {
          await driverApplicationService.syncDriverApplication(id, {
            db,
            includeRatings: false
          });
        } catch (syncError) {
          logStructured('warn', 'Falha ao sincronizar espelho Firestore após rejeição de motorista', {
            service: 'dashboard-routes',
            driverId: id,
            error: syncError.message
          });
        }

        logStructured('info', `❌ Aplicação rejeitada: ${id} por ${req.user.email} (${adminId})`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Aplicação rejeitada',
          data: { driverId: id, rejectedAt: updates.rejectedAt }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao rejeitar no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar rejeição' });
    }
  } catch (error) {
    logError(error, 'Erro ao rejeitar aplicação:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 Financial Metrics - DADOS REAIS (Firebase)
router.get('/api/metrics/financial', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const { period } = req.query;

    let metrics = {
      revenue: {
        total: 0,
        rides: 0,
        subscriptions: 0,
        marketing: 0,
        growth: 0
      },
      costs: {
        total: 0,
        infrastructure: 0,
        apis: 0,
        growth: 0
      },
      profit: {
        gross: 0,
        margin: 0,
        growth: 0
      },
      rides: {
        total: 0,
        completed: 0,
        cancelled: 0,
        avgFare: 0,
        growth: 0
      }
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar corridas do Firebase
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};

        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        // Filtrar por período se especificado
        let filteredBookings = bookingArray;
        if (period) {
          const today = new Date();
          let startDate = new Date();

          switch (period) {
            case 'today':
              startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
              break;
            case 'week':
              startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
              break;
            case 'month':
              startDate = new Date(today.getFullYear(), today.getMonth(), 1);
              break;
          }

          filteredBookings = bookingArray.filter(booking => {
            const tripDate = new Date(booking.tripdate || 0);
            return tripDate >= startDate;
          });
        }

        // Calcular métricas reais
        const completedBookings = filteredBookings.filter(b => b.status === 'COMPLETE' || b.status === 'PAID');
        const cancelledBookings = filteredBookings.filter(b => b.status === 'CANCELLED');

        const totalRevenue = completedBookings.reduce((sum, booking) => {
          return sum + parseFloat(booking.customer_paid || booking.total_fare || 0);
        }, 0);

        const convenienceFees = completedBookings.reduce((sum, booking) => {
          return sum + parseFloat(booking.convenience_fees || 0);
        }, 0);

        const totalFares = completedBookings.reduce((sum, booking) => {
          return sum + parseFloat(booking.driver_share || 0);
        }, 0);

        metrics = {
          revenue: {
            total: totalRevenue,
            rides: totalFares,
            subscriptions: 0, // TODO: Implementar sistema de assinaturas
            marketing: 0, // TODO: Implementar receita de marketing
            growth: 0 // TODO: Calcular crescimento
          },
          costs: {
            total: convenienceFees * 0.3, // Estimativa: 30% da taxa de conveniência são custos
            infrastructure: convenienceFees * 0.15,
            apis: convenienceFees * 0.10,
            growth: 0
          },
          profit: {
            gross: totalRevenue - (convenienceFees * 0.3),
            margin: totalRevenue > 0 ? (((totalRevenue - (convenienceFees * 0.3)) / totalRevenue) * 100).toFixed(1) : 0,
            growth: 0
          },
          rides: {
            total: filteredBookings.length,
            completed: completedBookings.length,
            cancelled: cancelledBookings.length,
            avgFare: completedBookings.length > 0 ? (totalRevenue / completedBookings.length).toFixed(2) : 0,
            growth: 0
          }
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar dados financeiros do Firebase:', error.message, { service: 'dashboard-routes' });
    }

    res.json(metrics);
  } catch (error) {
    logError(error, 'Erro ao buscar métricas financeiras:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💰 Advanced Financial Metrics - CUSTOS OPERACIONAIS REAIS
router.get('/api/metrics/financial/advanced', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    let metrics = {
      operationalCosts: {
        totalPerRide: 0,
        apiCosts: 0,
        serverCosts: 0,
        paymentProcessing: 0,
        breakdown: []
      },
      revenueAnalysis: {
        grossRevenue: 0,
        netRevenue: 0,
        commissionRevenue: 0,
        subscriptionRevenue: 0,
        marginPercent: 0
      },
      profitAnalysis: {
        grossProfit: 0,
        netProfit: 0,
        profitPerRide: 0,
        profitMargin: 0
      },
      costBreakdown: {
        infrastructure: 0,
        apis: {
          googleMaps: 0,
          firebase: 0,
          payment: 0
        },
        operations: 0,
        marketing: 0
      }
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar corridas do período
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};
        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        // Filtrar por período
        const today = new Date();
        let startDate = new Date();

        switch (period) {
          case 'today':
            startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            break;
          case 'week':
            startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
          case 'year':
            startDate = new Date(today.getFullYear(), 0, 1);
            break;
        }

        const filteredBookings = bookingArray.filter(booking => {
          const tripDate = new Date(booking.tripdate || 0);
          return tripDate >= startDate;
        });

        const completedBookings = filteredBookings.filter(b =>
          b.status === 'COMPLETE' || b.status === 'PAID'
        );

        if (completedBookings.length > 0) {
          // Calcular receitas reais
          const grossRevenue = completedBookings.reduce((sum, booking) => {
            return sum + parseFloat(booking.customer_paid || booking.total_fare || 0);
          }, 0);

          const commissionRevenue = completedBookings.reduce((sum, booking) => {
            return sum + parseFloat(booking.convenience_fees || 0);
          }, 0);

          const driverPayouts = completedBookings.reduce((sum, booking) => {
            return sum + parseFloat(booking.driver_share || 0);
          }, 0);

          // Calcular custos operacionais reais por corrida
          const totalRides = completedBookings.length;

          // Custos estimados baseados na realidade do mercado
          const apiCostsPerRide = {
            googleMaps: 0.005, // $0.005 por request de direção
            firebase: 0.002,   // $0.002 por operação
            payment: grossRevenue * 0.029, // 2.9% taxa de pagamento
          };

          const serverCostsPerRide = 50 / Math.max(totalRides, 1); // $50/mês dividido pelas corridas

          const totalApiCosts = totalRides * (apiCostsPerRide.googleMaps + apiCostsPerRide.firebase);
          const totalServerCosts = totalRides * serverCostsPerRide;
          const totalPaymentCosts = apiCostsPerRide.payment;

          const totalOperationalCosts = totalApiCosts + totalServerCosts + totalPaymentCosts;

          metrics = {
            operationalCosts: {
              totalPerRide: (totalOperationalCosts / Math.max(totalRides, 1)).toFixed(4),
              apiCosts: totalApiCosts.toFixed(2),
              serverCosts: totalServerCosts.toFixed(2),
              paymentProcessing: totalPaymentCosts.toFixed(2),
              breakdown: [
                { name: 'Google Maps API', cost: (totalRides * apiCostsPerRide.googleMaps).toFixed(4) },
                { name: 'Firebase', cost: (totalRides * apiCostsPerRide.firebase).toFixed(4) },
                { name: 'Servidor VPS', cost: totalServerCosts.toFixed(2) },
                { name: 'Processamento Pagamento', cost: totalPaymentCosts.toFixed(2) }
              ]
            },
            revenueAnalysis: {
              grossRevenue: grossRevenue.toFixed(2),
              netRevenue: (grossRevenue - driverPayouts).toFixed(2),
              commissionRevenue: commissionRevenue.toFixed(2),
              subscriptionRevenue: 0, // TODO: Implementar sistema de assinaturas
              marginPercent: grossRevenue > 0 ? (((grossRevenue - driverPayouts) / grossRevenue) * 100).toFixed(1) : 0
            },
            profitAnalysis: {
              grossProfit: (grossRevenue - driverPayouts).toFixed(2),
              netProfit: (grossRevenue - driverPayouts - totalOperationalCosts).toFixed(2),
              profitPerRide: ((grossRevenue - driverPayouts - totalOperationalCosts) / Math.max(totalRides, 1)).toFixed(2),
              profitMargin: grossRevenue > 0 ? (((grossRevenue - driverPayouts - totalOperationalCosts) / grossRevenue) * 100).toFixed(1) : 0
            },
            costBreakdown: {
              infrastructure: totalServerCosts.toFixed(2),
              apis: {
                googleMaps: (totalRides * apiCostsPerRide.googleMaps).toFixed(4),
                firebase: (totalRides * apiCostsPerRide.firebase).toFixed(4),
                payment: totalPaymentCosts.toFixed(2)
              },
              operations: (totalOperationalCosts * 0.1).toFixed(2), // 10% para operações
              marketing: (commissionRevenue * 0.05).toFixed(2) // 5% da comissão para marketing
            }
          };
        }
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao calcular métricas financeiras avançadas:', error.message, { service: 'dashboard-routes' });
    }

    res.json(metrics);
  } catch (error) {
    logError(error, 'Erro ao buscar métricas financeiras avançadas:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🚗 Booking Analytics - ANÁLISE COMPLETA DE CORRIDAS
router.get('/api/analytics/bookings', async (req, res) => {
  try {
    const { period = 'month', status } = req.query;

    let analytics = {
      summary: {
        total: 0,
        completed: 0,
        cancelled: 0,
        ongoing: 0,
        completionRate: 0,
        cancellationRate: 0
      },
      performance: {
        averageWaitTime: 0,
        averageTripTime: 0,
        averageDistance: 0,
        averageRating: 0,
        peakHours: []
      },
      trends: {
        daily: [],
        hourly: [],
        weekday: []
      },
      cancellationAnalysis: {
        byReason: [],
        byTimeOfDay: [],
        customerCancellations: 0,
        driverCancellations: 0
      }
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar corridas
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};
        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        // Filtrar por período
        const today = new Date();
        let startDate = new Date();

        switch (period) {
          case 'today':
            startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            break;
          case 'week':
            startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
          case 'year':
            startDate = new Date(today.getFullYear(), 0, 1);
            break;
        }

        let filteredBookings = bookingArray.filter(booking => {
          const tripDate = new Date(booking.tripdate || 0);
          return tripDate >= startDate;
        });

        // Filtrar por status se especificado
        if (status) {
          filteredBookings = filteredBookings.filter(b => b.status === status);
        }

        // Calcular estatísticas básicas
        const completed = filteredBookings.filter(b => b.status === 'COMPLETE' || b.status === 'PAID');
        const cancelled = filteredBookings.filter(b => b.status === 'CANCELLED');
        const ongoing = filteredBookings.filter(b => ['NEW', 'ACCEPTED', 'STARTED'].includes(b.status));

        analytics.summary = {
          total: filteredBookings.length,
          completed: completed.length,
          cancelled: cancelled.length,
          ongoing: ongoing.length,
          completionRate: filteredBookings.length > 0 ? ((completed.length / filteredBookings.length) * 100).toFixed(1) : 0,
          cancellationRate: filteredBookings.length > 0 ? ((cancelled.length / filteredBookings.length) * 100).toFixed(1) : 0
        };

        // Calcular performance (apenas corridas completas)
        if (completed.length > 0) {
          const totalDistance = completed.reduce((sum, booking) => {
            return sum + parseFloat(booking.distance || 0);
          }, 0);
          const avgWaitMinutes = calculateAverageWaitTime(completed);
          const avgTripMinutes = calculateAverageTripTime(completed);
          const ratedBookings = completed.filter((booking) => Number.isFinite(Number.parseFloat(booking.rating)));
          const totalRating = ratedBookings.reduce((sum, booking) => {
            return sum + Number.parseFloat(booking.rating || 0);
          }, 0);

          analytics.performance = {
            averageWaitTime: Number(avgWaitMinutes.toFixed(1)),
            averageTripTime: Number(avgTripMinutes.toFixed(1)),
            averageDistance: completed.length > 0 ? (totalDistance / completed.length).toFixed(2) : 0,
            averageRating: ratedBookings.length > 0 ? (totalRating / ratedBookings.length).toFixed(1) : 0,
            peakHours: getPeakHours(completed)
          };
        }

        // Análise de tendências diárias (últimos 7 dias)
        const dailyTrends = [];
        for (let i = 6; i >= 0; i--) {
          const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
          const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

          const dayBookings = bookingArray.filter(booking => {
            const tripDate = new Date(booking.tripdate || 0);
            return tripDate >= dayStart && tripDate < dayEnd;
          });

          dailyTrends.push({
            date: date.toISOString().split('T')[0],
            total: dayBookings.length,
            completed: dayBookings.filter(b => b.status === 'COMPLETE' || b.status === 'PAID').length,
            cancelled: dayBookings.filter(b => b.status === 'CANCELLED').length
          });
        }
        analytics.trends.daily = dailyTrends;

        // Análise de cancelamentos
        const cancelReasons = {};
        cancelled.forEach(booking => {
          const reason = booking.reason || 'Não especificado';
          cancelReasons[reason] = (cancelReasons[reason] || 0) + 1;
        });

        analytics.cancellationAnalysis = {
          byReason: Object.keys(cancelReasons).map(reason => ({
            reason,
            count: cancelReasons[reason],
            percentage: ((cancelReasons[reason] / Math.max(cancelled.length, 1)) * 100).toFixed(1)
          })),
          byTimeOfDay: getHourlyTripDistribution(cancelled).filter(({ trips }) => trips > 0),
          customerCancellations: cancelled.filter(b => b.cancelled_by === 'customer').length,
          driverCancellations: cancelled.filter(b => b.cancelled_by === 'driver').length
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao calcular analytics de corridas:', error.message, { service: 'dashboard-routes' });
    }

    res.json(analytics);
  } catch (error) {
    logError(error, 'Erro ao buscar analytics de corridas:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/api/metrics/services', authenticateJWT, requireRole(DASHBOARD_MONITORING_ROLES), async (req, res) => {
  try {
    let metrics = {
      websocket: {
        connections: 0,
        messagesPerSec: 0,
        latency: 0,
        uptime: 0
      },
      redis: {
        operations: 0,
        hitRate: 0,
        memory: 0,
        connections: 0
      },
      firebase: {
        reads: 0,
        writes: 0,
        functions: 0,
        storage: 0
      },
      vultr: {
        cpu: 0,
        memory: 0,
        disk: 0,
        network: 0
      }
    };

    try {
      // Dados reais do Redis
      const redis = redisPool.getConnection();

      // Informações reais do Redis
      const redisInfo = await redis.info();
      const dbSize = await redis.dbsize();
      const redisPingStart = Date.now();
      await redis.ping();
      const redisPingMs = Date.now() - redisPingStart;

      // Parse das informações do Redis
      const memoryUsedMb = extractRedisMemoryInMb(redisInfo);
      const totalCommandsProcessed = extractRedisStatValue(redisInfo, 'total_commands_processed');
      const keyspaceHits = extractRedisStatValue(redisInfo, 'keyspace_hits');
      const keyspaceMisses = extractRedisStatValue(redisInfo, 'keyspace_misses');
      const totalLookups = keyspaceHits + keyspaceMisses;
      const hitRate = totalLookups > 0 ? (keyspaceHits / totalLookups) * 100 : 0;

      metrics.redis = {
        operations: totalCommandsProcessed || dbSize,
        hitRate: Number(hitRate.toFixed(2)),
        memory: Number(memoryUsedMb.toFixed(2)),
        connections: extractRedisConnections(redisInfo)
      };

      // Dados reais do WebSocket (via global se disponível)
      if (global.io && global.io.engine) {
        metrics.websocket = {
          connections: global.io.engine.clientsCount || 0,
          messagesPerSec: 0, // Sem contador dedicado ainda
          latency: redisPingMs,
          uptime: 100
        };
      }

      // Dados do sistema (básicos)
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const cpuLoad = os.loadavg()[0];
      const cores = Math.max(os.cpus().length, 1);

      metrics.vultr = {
        cpu: Math.min(100, (cpuLoad / cores) * 100),
        memory: ((totalMem - freeMem) / totalMem) * 100,
        disk: 0,
        network: 0
      };

    } catch (error) {
      logStructured('warn', '⚠️ Erro ao obter métricas reais:', error.message, { service: 'dashboard-routes' });
      // Manter zeros em caso de erro
    }

    res.json(metrics);
  } catch (error) {
    logError(error, 'Erro ao buscar métricas de serviços:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💳 Subscriptions
router.get('/api/subscriptions', async (req, res) => {
  try {
    if (rejectDashboardMockEndpointInProduction(req, res, 'subscriptions_mock')) {
      return;
    }

    const subscriptions = [
      {
        id: 'sub1',
        driver: {
          name: 'João Silva',
          email: 'joao@email.com',
          vehicle: { model: 'Honda Civic', plate: 'ABC-1234' }
        },
        plan: {
          name: 'Plano Semanal Premium',
          price: 49.90,
          duration: 'weekly'
        },
        status: 'active',
        startDate: '2024-01-01',
        endDate: '2024-01-08',
        totalPaid: 199.60,
        autoRenewal: true
      }
    ];

    res.json(subscriptions);
  } catch (error) {
    logError(error, 'Erro ao buscar assinaturas:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/api/subscriptions/stats', async (req, res) => {
  try {
    if (rejectDashboardMockEndpointInProduction(req, res, 'subscriptions_stats_mock')) {
      return;
    }

    const stats = {
      total: 234,
      active: 187,
      expired: 23,
      cancelled: 15,
      pending: 7,
      suspended: 2,
      revenue: {
        total: 28450.30,
        weekly: 18200.50,
        monthly: 10249.80,
        growth: 12.5
      },
      churnRate: 8.2,
      renewalRate: 84.5,
      avgLifetime: 3.8
    };

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats de assinaturas:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🗺️ Live Map Data
router.get('/api/drivers/active', async (req, res) => {
  try {
    const drivers = [
      {
        id: 'driver1',
        name: 'João Silva',
        lat: -23.5505,
        lng: -46.6333,
        status: 'available',
        vehicle: { model: 'Honda Civic', plate: 'ABC-1234' },
        rating: 4.8,
        tripsToday: 12
      }
    ];

    res.json(drivers);
  } catch (error) {
    logError(error, 'Erro ao buscar motoristas ativos:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/api/passengers/active', async (req, res) => {
  try {
    const passengers = [
      {
        id: 'passenger1',
        name: 'Carlos Oliveira',
        lat: -23.5405,
        lng: -46.6405,
        status: 'waiting',
        waitingTime: 3
      }
    ];

    res.json(passengers);
  } catch (error) {
    logError(error, 'Erro ao buscar passageiros ativos:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/api/trips/active', async (req, res) => {
  try {
    const trips = [
      {
        id: 'trip1',
        driverId: 'driver1',
        passengerId: 'passenger1',
        pickup: { lat: -23.5405, lng: -46.6405, address: 'Av. Paulista, 1000' },
        destination: { lat: -23.5705, lng: -46.6505, address: 'Shopping Ibirapuera' },
        status: 'in_progress',
        estimatedTime: 15,
        distance: 8.5,
        fare: 25.50
      }
    ];

    res.json(trips);
  } catch (error) {
    logError(error, 'Erro ao buscar corridas ativas:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/api/live/stats', async (req, res) => {
  try {
    let stats = {
      driversOnline: 0,
      driversAvailable: 0,
      passengerWaiting: 0,
      activeTrips: 0,
      avgWaitTime: 0,
      avgTripTime: 0
    };

    try {
      const redis = redisPool.getConnection();

      // Dados reais do Redis
      const totalDrivers = await redis.zcard('driver_locations') || 0;
      const onlineUsers = await redis.scard('online_users') || 0;
      const activeBookings = await RedisScan.countKeys(redis, 'bookings:*');
      const availableDrivers = await redis.scard('available_drivers') || Math.floor(totalDrivers * 0.6);
      const sampledBookingKeys = await sampleRedisKeys(redis, 'bookings:*', 120);
      const sampledBookings = await loadBookingHashes(redis, sampledBookingKeys);
      const avgWaitTime = calculateAverageWaitTime(sampledBookings);
      const avgTripTime = calculateAverageTripTime(sampledBookings);

      stats = {
        driversOnline: totalDrivers,
        driversAvailable: availableDrivers,
        passengerWaiting: Math.max(0, onlineUsers - totalDrivers), // Passageiros sem motorista
        activeTrips: activeBookings,
        avgWaitTime: Number(avgWaitTime.toFixed(1)),
        avgTripTime: Number(avgTripTime.toFixed(1))
      };

    } catch (redisError) {
      logStructured('warn', '⚠️ Redis não disponível para stats ao vivo:', redisError.message, { service: 'dashboard-routes' });
      // stats permanece zerado
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats em tempo real:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔐 Authentication - Removido: Usar apenas Firebase Auth no frontend
// O dashboard agora usa Firebase Authentication diretamente
// Não há mais autenticação hardcoded por questões de segurança

// 📊 Dashboard Stats Endpoints
// Endpoints específicos para o dashboard frontend

// 🚗 Rides Stats
router.get('/api/rides/stats', async (req, res) => {
  try {
    const { period = 'today', startDate, endDate } = req.query || {};

    try {
      const stats = await modernMetricsService.getRidesStats({ period, startDate, endDate });
      return res.json(stats);
    } catch (modernError) {
      logStructured('warn', 'Fallback RTDB em /api/rides/stats', {
        service: 'dashboard-routes',
        reason: modernError.message
      });
    }

    let stats = {
      totalRides: 0,
      activeRides: 0,
      completedToday: 0,
      averageValue: 0,
      growthRate: 0
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};
        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const completedToday = bookingArray.filter(b => {
          const tripDate = new Date(b.tripdate || 0);
          return tripDate >= today && (b.status === 'COMPLETE' || b.status === 'PAID');
        });

        const activeRides = bookingArray.filter(b =>
          b.status === 'ACCEPTED' || b.status === 'IN_PROGRESS'
        );

        const completedRides = bookingArray.filter(b =>
          b.status === 'COMPLETE' || b.status === 'PAID'
        );

        const totalValue = completedRides.reduce((sum, b) =>
          sum + parseFloat(b.customer_paid || b.fare || 0), 0
        );

        stats = {
          totalRides: bookingArray.length,
          activeRides: activeRides.length,
          completedToday: completedToday.length,
          averageValue: completedRides.length > 0 ? totalValue / completedRides.length : 0,
          growthRate: 0 // Calcular se necessário
        };
      }
    } catch (error) {
      logError(error, 'Erro ao buscar stats de corridas:', { service: 'dashboard-routes' });
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats de corridas:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💰 Revenue Stats
router.get('/api/revenue/stats', async (req, res) => {
  try {
    let stats = {
      todayRevenue: 0,
      monthlyRevenue: 0,
      averageTicket: 0,
      growthRate: 0
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};
        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const thisMonth = new Date();
        thisMonth.setDate(1);
        thisMonth.setHours(0, 0, 0, 0);

        const completedToday = bookingArray.filter(b => {
          const tripDate = new Date(b.tripdate || 0);
          return tripDate >= today && (b.status === 'COMPLETE' || b.status === 'PAID');
        });

        const completedThisMonth = bookingArray.filter(b => {
          const tripDate = new Date(b.tripdate || 0);
          return tripDate >= thisMonth && (b.status === 'COMPLETE' || b.status === 'PAID');
        });

        const todayRevenue = completedToday.reduce((sum, b) =>
          sum + parseFloat(b.customer_paid || b.fare || 0), 0
        );

        const monthlyRevenue = completedThisMonth.reduce((sum, b) =>
          sum + parseFloat(b.customer_paid || b.fare || 0), 0
        );

        stats = {
          todayRevenue,
          monthlyRevenue,
          averageTicket: completedThisMonth.length > 0 ? monthlyRevenue / completedThisMonth.length : 0,
          growthRate: 0
        };
      }
    } catch (error) {
      logError(error, 'Erro ao buscar stats de receita:', { service: 'dashboard-routes' });
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats de receita:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📈 Conversion Stats
router.get('/api/conversion/stats', async (req, res) => {
  try {
    const stats = {
      conversionRate: 0,
      completionRate: 0,
      growthRate: 0
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};
        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        const total = bookingArray.length;
        const completed = bookingArray.filter(b =>
          b.status === 'COMPLETE' || b.status === 'PAID'
        ).length;
        const cancelled = bookingArray.filter(b =>
          b.status === 'CANCELLED'
        ).length;

        stats.conversionRate = total > 0 ? (completed / total) * 100 : 0;
        stats.completionRate = total > 0 ? ((total - cancelled) / total) * 100 : 0;
        stats.growthRate = 0;
      }
    } catch (error) {
      logError(error, 'Erro ao buscar stats de conversão:', { service: 'dashboard-routes' });
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats de conversão:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔍 KYC Analytics Stats
router.get('/api/kyc-analytics/stats', async (req, res) => {
  try {
    let stats = {
      approved: 0,
      pending: 0,
      rejected: 0,
      successRate: 0
    };

    try {
      // Usar Realtime Database onde os dados de drivers estão
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();
        const usersSnapshot = await db.ref('users').orderByChild('usertype').equalTo('driver').once('value');
        const drivers = usersSnapshot.val() || {};

        let approved = 0;
        let pending = 0;
        let rejected = 0;

        Object.keys(drivers).forEach(driverId => {
          const driver = drivers[driverId];
          // Verificar status de aprovação
          if (driver.approved === true || driver.approval_status === 'approved') {
            approved++;
          } else if (driver.approval_status === 'pending' || (!driver.approved && !driver.approval_status)) {
            pending++;
          } else if (driver.approval_status === 'rejected') {
            rejected++;
          }
        });

        const total = approved + pending + rejected;
        stats = {
          approved,
          pending,
          rejected,
          successRate: total > 0 ? (approved / total) * 100 : 0
        };
      }
    } catch (error) {
      logError(error, 'Erro ao buscar stats de KYC:', { service: 'dashboard-routes' });
    }

    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats de KYC:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ⚙️ System Status
router.get('/api/system/status', async (req, res) => {
  try {
    const redis = redisPool.getConnection();

    let services = [
      {
        service: 'Redis',
        status: 'online',
        uptime: 0,
        latency: 0
      },
      {
        service: 'Firebase',
        status: 'online',
        uptime: 0,
        latency: 0
      },
      {
        service: 'WebSocket',
        status: 'online',
        uptime: 0,
        latency: 0
      }
    ];

    try {
      // Testar Redis
      const redisStart = Date.now();
      await redis.ping();
      const redisLatency = Date.now() - redisStart;
      services[0].latency = redisLatency;
      services[0].status = 'online';
    } catch (error) {
      services[0].status = 'offline';
    }

    try {
      // Testar Firebase
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();
        const firebaseStart = Date.now();
        await db.ref('.info/connected').once('value');
        const firebaseLatency = Date.now() - firebaseStart;
        services[1].latency = firebaseLatency;
        services[1].status = 'online';
      }
    } catch (error) {
      services[1].status = 'offline';
    }

    res.json(services);
  } catch (error) {
    logError(error, 'Erro ao buscar status do sistema:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📋 Recent Activity
router.get('/api/activity/recent', async (req, res) => {
  try {
    let activities = [];

    try {
      if (firebaseConfig && firebaseConfig.getFirestore) {
        const firestore = firebaseConfig.getFirestore();
        const modernSnapshot = await firestore
          .collection('rides')
          .orderBy('createdAt', 'desc')
          .limit(20)
          .get();

        const modernRides = modernSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        activities = buildRecentRideActivities(modernRides, 10);
      }

      if (activities.length === 0 && firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};
        const bookingArray = Object.keys(bookings).map(key => ({ id: key, ...bookings[key] }));

        activities = buildRecentRideActivities(bookingArray, 10);
      }
    } catch (error) {
      logError(error, 'Erro ao buscar atividades recentes:', { service: 'dashboard-routes' });
    }

    res.json(activities);
  } catch (error) {
    logError(error, 'Erro ao buscar atividades recentes:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🆘 Support Tickets - SISTEMA DE GESTÃO DE SUPORTE
router.get('/api/support/tickets', authenticateLegacyDashboardSupportJWTOrSkip, requireRole(DASHBOARD_SUPPORT_ROLES), async (req, res) => {
  try {
    const {
      type, // 'sos' ou 'complain'
      status,
      priority,
      dateRange,
      assignedTo,
      page = 1,
      limit = 20
    } = req.query;

    let tickets = [];
    let totalCount = 0;

    try {
      const modernCategory =
        type && !['all', 'sos', 'complain'].includes(String(type).toLowerCase())
          ? String(type).toLowerCase()
          : null;
      const modernResult = await supportTicketService.listTickets({
        status: status && status !== 'all' ? status : null,
        priority: priority && priority !== 'all' ? priority : null,
        category: modernCategory,
        agent: assignedTo || null,
        limit: 10000,
        offset: 0,
        isAgent: true
      });

      tickets = modernResult.tickets.map((ticket) => normalizeSupportDashboardTicket(ticket));
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar support tickets modernos:', error.message, {
        service: 'dashboard-routes'
      });
    }

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar tickets SOS
        let sosTickets = [];
        if (!type || type === 'sos') {
          const sosSnapshot = await db.ref('sos').once('value');
          const sosData = sosSnapshot.val() || {};

          sosTickets = Object.keys(sosData).map(sosId => ({
            id: sosId,
            type: 'sos',
            title: 'Chamada de Emergência',
            description: sosData[sosId].description || 'Chamada SOS realizada',
            userId: sosData[sosId].uid || '',
            userType: sosData[sosId].userType || 'customer',
            status: sosData[sosId].status || 'open',
            priority: 'high', // SOS sempre alta prioridade
            location: {
              lat: sosData[sosId].lat || 0,
              lng: sosData[sosId].lng || 0,
              address: sosData[sosId].location || 'Localização não disponível'
            },
            createdAt: sosData[sosId].timestamp ? new Date(sosData[sosId].timestamp).toISOString() : new Date().toISOString(),
            updatedAt: sosData[sosId].updatedAt || sosData[sosId].timestamp,
            assignedTo: sosData[sosId].assignedTo || null,
            resolution: sosData[sosId].resolution || null,
            bookingId: sosData[sosId].bookingId || null
          }));
        }

        // Buscar tickets de reclamação
        let complainTickets = [];
        if (!type || type === 'complain') {
          const complainSnapshot = await db.ref('complain').once('value');
          const complainData = complainSnapshot.val() || {};

          complainTickets = Object.keys(complainData).map(complainId => ({
            id: complainId,
            type: 'complain',
            title: complainData[complainId].subject || 'Reclamação',
            description: complainData[complainId].description || '',
            userId: complainData[complainId].uid || '',
            userType: complainData[complainId].userType || 'customer',
            status: complainData[complainId].status || 'open',
            priority: complainData[complainId].priority || 'medium',
            category: complainData[complainId].category || 'general',
            createdAt: complainData[complainId].timestamp ? new Date(complainData[complainId].timestamp).toISOString() : new Date().toISOString(),
            updatedAt: complainData[complainId].updatedAt || complainData[complainId].timestamp,
            assignedTo: complainData[complainId].assignedTo || null,
            resolution: complainData[complainId].resolution || null,
            bookingId: complainData[complainId].bookingId || null,
            rating: complainData[complainId].rating || null
          }));
        }

        // Combinar tickets
        tickets = [...tickets, ...sosTickets, ...complainTickets];

        // Buscar informações dos usuários para enriquecer os dados legados que ainda não têm user preenchido
        if (tickets.length > 0) {
          const usersSnapshot = await db.ref('users').once('value');
          const users = usersSnapshot.val() || {};

          tickets = tickets.map(ticket => {
            if (ticket.user) {
              return ticket;
            }
            const user = users[ticket.userId];
            return {
              ...ticket,
              user: user ? {
                name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                email: user.email || '',
                phone: user.mobile || ''
              } : null
            };
          });
        }

        // Aplicar filtros
        if (status && status !== 'all') {
          tickets = tickets.filter(ticket => ticket.status === status);
        }

        if (priority && priority !== 'all') {
          tickets = tickets.filter(ticket => ticket.priority === priority);
        }

        if (assignedTo) {
          tickets = tickets.filter(ticket => ticket.assignedTo === assignedTo);
        }

        if (dateRange) {
          const [startDate, endDate] = dateRange.split(',');
          if (startDate && endDate) {
            tickets = tickets.filter(ticket => {
              const createdDate = new Date(ticket.createdAt);
              return createdDate >= new Date(startDate) && createdDate <= new Date(endDate);
            });
          }
        }

        // Ordenar por data (mais recentes primeiro)
        tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        totalCount = tickets.length;

        // Aplicar paginação
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        tickets = tickets.slice(startIndex, endIndex);
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar tickets do Firebase:', error.message, { service: 'dashboard-routes' });
    }

    if (status && status !== 'all') {
      tickets = tickets.filter(ticket => ticket.status === status);
    }

    if (priority && priority !== 'all') {
      tickets = tickets.filter(ticket => ticket.priority === priority);
    }

    if (assignedTo) {
      tickets = tickets.filter(ticket => ticket.assignedTo === assignedTo);
    }

    if (dateRange) {
      const [startDate, endDate] = dateRange.split(',');
      if (startDate && endDate) {
        tickets = tickets.filter(ticket => {
          const createdDate = new Date(ticket.createdAt);
          return createdDate >= new Date(startDate) && createdDate <= new Date(endDate);
        });
      }
    }

    tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    totalCount = tickets.length;

    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedTickets = tickets.slice(startIndex, endIndex);

    res.json({
      tickets: paginatedTickets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      },
      summary: {
        total: totalCount,
        open: tickets.filter(t => t.status === 'open').length,
        in_progress: tickets.filter(t => t.status === 'in_progress').length,
        resolved: tickets.filter(t => t.status === 'resolved').length,
        closed: tickets.filter(t => t.status === 'closed').length,
        sos: tickets.filter(t => t.type === 'sos').length,
        complain: tickets.filter(t => t.type === 'complain').length
      }
    });
  } catch (error) {
    logError(error, 'Erro ao buscar tickets:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🆘 Atualizar Status do Ticket
router.patch('/api/support/tickets/:id', authenticateJWT, requireRole(DASHBOARD_SUPPORT_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, assignedTo, resolution, notes, adminId = 'admin1' } = req.body;

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se é SOS ou Complain
        let ticketRef = null;
        let ticketType = null;

        // Tentar encontrar em SOS
        const sosSnapshot = await db.ref(`sos/${id}`).once('value');
        if (sosSnapshot.exists()) {
          ticketRef = db.ref(`sos/${id}`);
          ticketType = 'sos';
        } else {
          // Tentar encontrar em Complain
          const complainSnapshot = await db.ref(`complain/${id}`).once('value');
          if (complainSnapshot.exists()) {
            ticketRef = db.ref(`complain/${id}`);
            ticketType = 'complain';
          }
        }

        if (!ticketRef) {
          return res.status(404).json({ error: 'Ticket não encontrado' });
        }

        // Preparar atualizações
        const updates = {
          updatedAt: new Date().toISOString(),
          updatedBy: adminId
        };

        if (status) updates.status = status;
        if (assignedTo) updates.assignedTo = assignedTo;
        if (resolution) updates.resolution = resolution;
        if (notes) updates.adminNotes = notes;

        // Atualizar no Firebase
        await ticketRef.update(updates);

        logStructured('info', `📞 Ticket ${ticketType.toUpperCase()} atualizado: ${id} por ${adminId}`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Ticket atualizado com sucesso',
          data: {
            ticketId: id,
            type: ticketType,
            updatedAt: updates.updatedAt
          }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao atualizar ticket no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar atualização' });
    }
  } catch (error) {
    logError(error, 'Erro ao atualizar ticket:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🆘 Obter Detalhes de Ticket Específico
router.get('/api/support/tickets/:id', authenticateLegacyDashboardSupportJWTOrSkip, requireRole(DASHBOARD_SUPPORT_ROLES), async (req, res) => {
  try {
    const { id } = req.params;

    try {
      const modernTicket = await supportTicketService.getTicket(id);
      if (modernTicket) {
        return res.json(normalizeSupportDashboardTicket(modernTicket));
      }

      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        let ticket = null;
        let ticketType = null;

        // Tentar encontrar em SOS
        const sosSnapshot = await db.ref(`sos/${id}`).once('value');
        if (sosSnapshot.exists()) {
          const sosData = sosSnapshot.val();
          ticketType = 'sos';
          ticket = {
            id,
            type: 'sos',
            title: 'Chamada de Emergência',
            description: sosData.description || 'Chamada SOS realizada',
            userId: sosData.uid || '',
            userType: sosData.userType || 'customer',
            status: sosData.status || 'open',
            priority: 'high',
            location: {
              lat: sosData.lat || 0,
              lng: sosData.lng || 0,
              address: sosData.location || 'Localização não disponível'
            },
            createdAt: sosData.timestamp ? new Date(sosData.timestamp).toISOString() : null,
            updatedAt: sosData.updatedAt || sosData.timestamp,
            assignedTo: sosData.assignedTo || null,
            resolution: sosData.resolution || null,
            bookingId: sosData.bookingId || null,
            adminNotes: sosData.adminNotes || '',
            emergencyContact: sosData.emergencyContact || null
          };
        } else {
          // Tentar encontrar em Complain
          const complainSnapshot = await db.ref(`complain/${id}`).once('value');
          if (complainSnapshot.exists()) {
            const complainData = complainSnapshot.val();
            ticketType = 'complain';
            ticket = {
              id,
              type: 'complain',
              title: complainData.subject || 'Reclamação',
              description: complainData.description || '',
              userId: complainData.uid || '',
              userType: complainData.userType || 'customer',
              status: complainData.status || 'open',
              priority: complainData.priority || 'medium',
              category: complainData.category || 'general',
              createdAt: complainData.timestamp ? new Date(complainData.timestamp).toISOString() : null,
              updatedAt: complainData.updatedAt || complainData.timestamp,
              assignedTo: complainData.assignedTo || null,
              resolution: complainData.resolution || null,
              bookingId: complainData.bookingId || null,
              rating: complainData.rating || null,
              adminNotes: complainData.adminNotes || '',
              attachments: complainData.attachments || []
            };
          }
        }

        if (!ticket) {
          return res.status(404).json({ error: 'Ticket não encontrado' });
        }

        // Buscar informações do usuário
        if (ticket.userId) {
          const userSnapshot = await db.ref(`users/${ticket.userId}`).once('value');
          if (userSnapshot.exists()) {
            const user = userSnapshot.val();
            ticket.user = {
              name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
              email: user.email || '',
              phone: user.mobile || '',
              profileImage: user.profileImage || ''
            };
          }
        }

        // Buscar informações da corrida se houver
        if (ticket.bookingId) {
          const bookingSnapshot = await db.ref(`bookings/${ticket.bookingId}`).once('value');
          if (bookingSnapshot.exists()) {
            const booking = bookingSnapshot.val();
            ticket.booking = {
              id: ticket.bookingId,
              status: booking.status,
              pickup: booking.pickup,
              drop: booking.drop,
              tripdate: booking.tripdate,
              driver: booking.driver,
              customer: booking.customer
            };
          }
        }

        res.json(ticket);
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao buscar ticket no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao buscar dados' });
    }
  } catch (error) {
    logError(error, 'Erro ao buscar detalhes do ticket:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🗺️ Real-Time Map - SISTEMA DE MAPA EM TEMPO REAL
router.get('/api/map/locations', async (req, res) => {
  try {
    const {
      type, // 'all', 'drivers', 'passengers'
      status, // 'online', 'available', 'busy'
      bounds // 'lat1,lng1,lat2,lng2' para filtrar por área
    } = req.query;

    const liveData = await getDashboardLiveData(redisPool.getConnection());
    let locations = {
      drivers: Array.isArray(liveData.drivers) ? [...liveData.drivers] : [],
      passengers: [],
      activeBookings: Array.isArray(liveData.trips) ? [...liveData.trips] : []
    };

    if (status && status !== 'all') {
      locations.drivers = locations.drivers.filter((driver) => driver.status === status);
    }

    if (type === 'drivers') {
      locations.passengers = [];
      locations.activeBookings = [];
    } else if (type === 'passengers') {
      locations.drivers = [];
    }

    if (bounds) {
      const [lat1, lng1, lat2, lng2] = String(bounds).split(',').map(parseFloat);
      const minLat = Math.min(lat1, lat2);
      const maxLat = Math.max(lat1, lat2);
      const minLng = Math.min(lng1, lng2);
      const maxLng = Math.max(lng1, lng2);

      const inBounds = (point) => {
        const lat = Number(point?.location?.lat);
        const lng = Number(point?.location?.lng);
        return Number.isFinite(lat)
          && Number.isFinite(lng)
          && lat >= minLat
          && lat <= maxLat
          && lng >= minLng
          && lng <= maxLng;
      };

      locations.drivers = locations.drivers.filter(inBounds);
      locations.passengers = locations.passengers.filter(inBounds);
    }

    const driverCoordinates = locations.drivers
      .map((driver) => ({
        lat: Number(driver?.location?.lat),
        lng: Number(driver?.location?.lng)
      }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    let driverDensityPerKm2 = null;
    if (driverCoordinates.length >= 2) {
      const lats = driverCoordinates.map((point) => point.lat);
      const lngs = driverCoordinates.map((point) => point.lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const avgLat = (minLat + maxLat) / 2;

      const latKm = Math.max((maxLat - minLat) * 111.32, 0.001);
      const lngKm = Math.max((maxLng - minLng) * 111.32 * Math.cos((avgLat * Math.PI) / 180), 0.001);
      const areaKm2 = latKm * lngKm;
      if (Number.isFinite(areaKm2) && areaKm2 > 0) {
        driverDensityPerKm2 = locations.drivers.length / areaKm2;
      }
    }

    const passengerDriverRatio = locations.drivers.length > 0
      ? locations.passengers.length / locations.drivers.length
      : null;

    res.json({
      locations,
      summary: {
        totalDrivers: locations.drivers.length,
        availableDrivers: locations.drivers.filter(d => d.status === 'available').length,
        busyDrivers: locations.drivers.filter(d => d.status === 'busy').length,
        activePassengers: locations.passengers.length,
        activeBookings: locations.activeBookings.length,
        passengerDriverRatio,
        driverDensityPerKm2
      },
      lastUpdate: new Date().toISOString()
    });
  } catch (error) {
    logError(error, 'Erro ao buscar localizações:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/api/map/h3-cells', async (req, res) => {
  try {
    const redis = redisPool.getConnection();
    const includeEmpty = h3MapService.helpers.parseBoolean(req.query.includeEmpty, false);
    const includeBoundary = h3MapService.helpers.parseBoolean(req.query.includeBoundary, true);
    const payload = await h3MapService.getCells({
      redis,
      bbox: req.query.bbox,
      zoom: req.query.zoom,
      surface: String(req.query.surface || 'dashboard').trim().toLowerCase(),
      mode: String(req.query.mode || 'supply_demand').trim().toLowerCase(),
      includeEmpty,
      includeBoundary
    });

    res.json(payload);
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    logError(error, 'Erro ao montar mapa H3', {
      service: 'dashboard-routes',
      operation: 'getMapH3Cells',
      statusCode
    });

    res.status(statusCode).json({
      error: error?.message || 'Erro interno ao montar mapa H3',
      ...(error?.details ? { details: error.details } : {})
    });
  }
});

// 🗺️ Heat Map Data - Dados para Mapa de Calor
router.get('/api/map/heatmap', async (req, res) => {
  try {
    const {
      type = 'trips', // 'trips', 'pickups', 'drops'
      period = '24h' // '1h', '24h', '7d', '30d'
    } = req.query;

    let heatmapData = [];

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Calcular período
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '1h':
            startDate.setHours(now.getHours() - 1);
            break;
          case '24h':
            startDate.setDate(now.getDate() - 1);
            break;
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
        }

        // Buscar bookings do período
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};

        Object.keys(bookings).forEach(bookingId => {
          const booking = bookings[bookingId];
          const tripDate = new Date(booking.tripdate);

          // Filtrar por período
          if (tripDate < startDate) return;

          // Apenas corridas completadas para heatmap
          if (booking.status !== 'COMPLETE' && booking.status !== 'PAID') return;

          if (type === 'trips' || type === 'pickups') {
            // Pontos de pickup
            if (booking.pickup?.lat && booking.pickup?.lng) {
              heatmapData.push({
                lat: parseFloat(booking.pickup.lat),
                lng: parseFloat(booking.pickup.lng),
                weight: 1,
                type: 'pickup',
                address: booking.pickup.add || '',
                timestamp: booking.tripdate
              });
            }
          }

          if (type === 'trips' || type === 'drops') {
            // Pontos de drop
            if (booking.drop?.lat && booking.drop?.lng) {
              heatmapData.push({
                lat: parseFloat(booking.drop.lat),
                lng: parseFloat(booking.drop.lng),
                weight: 1,
                type: 'drop',
                address: booking.drop.add || '',
                timestamp: booking.tripdate
              });
            }
          }
        });

        // Agrupar pontos próximos para melhor visualização
        const groupedData = [];
        const tolerance = 0.001; // ~100m

        heatmapData.forEach(point => {
          const existing = groupedData.find(group =>
            Math.abs(group.lat - point.lat) < tolerance &&
            Math.abs(group.lng - point.lng) < tolerance &&
            group.type === point.type
          );

          if (existing) {
            existing.weight += 1;
            existing.count += 1;
          } else {
            groupedData.push({
              ...point,
              count: 1
            });
          }
        });

        heatmapData = groupedData;
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar dados do heatmap:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      heatmapData,
      summary: {
        totalPoints: heatmapData.length,
        period,
        type,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logError(error, 'Erro ao gerar heatmap:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🗺️ Trip Route Tracking - Rastreamento de Rota da Corrida
router.get('/api/map/trip/:bookingId/route', async (req, res) => {
  try {
    const { bookingId } = req.params;

    let routeData = null;

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar dados da corrida
        const bookingSnapshot = await db.ref(`bookings/${bookingId}`).once('value');
        if (!bookingSnapshot.exists()) {
          return res.status(404).json({ error: 'Corrida não encontrada' });
        }

        const booking = bookingSnapshot.val();

        // Buscar tracking da rota se disponível
        const trackingSnapshot = await db.ref(`tracking/${bookingId}`).once('value');
        const trackingData = trackingSnapshot.val() || {};

        // Buscar localização atual do motorista
        const driverLocationSnapshot = await db.ref(`locations/${booking.driver}`).once('value');
        const driverLocation = driverLocationSnapshot.val();

        routeData = {
          bookingId,
          status: booking.status,
          pickup: {
            address: booking.pickup?.add || '',
            lat: parseFloat(booking.pickup?.lat || 0),
            lng: parseFloat(booking.pickup?.lng || 0)
          },
          destination: {
            address: booking.drop?.add || '',
            lat: parseFloat(booking.drop?.lat || 0),
            lng: parseFloat(booking.drop?.lng || 0)
          },
          currentLocation: driverLocation ? {
            lat: parseFloat(driverLocation.lat),
            lng: parseFloat(driverLocation.lng),
            heading: parseFloat(driverLocation.heading || 0),
            speed: parseFloat(driverLocation.speed || 0),
            lastUpdate: driverLocation.timestamp ? new Date(driverLocation.timestamp).toISOString() : null
          } : null,
          route: Object.keys(trackingData).map(timestamp => ({
            lat: parseFloat(trackingData[timestamp].lat),
            lng: parseFloat(trackingData[timestamp].lng),
            timestamp: new Date(parseInt(timestamp)).toISOString(),
            speed: parseFloat(trackingData[timestamp].speed || 0)
          })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
          estimatedFare: parseFloat(booking.estimate || 0),
          distance: booking.distance || '',
          duration: booking.duration || '',
          startTime: booking.trip_start_time ? new Date(booking.trip_start_time).toISOString() : null,
          endTime: booking.trip_end_time ? new Date(booking.trip_end_time).toISOString() : null
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar rota da corrida:', error.message, { service: 'dashboard-routes' });
    }

    if (!routeData) {
      return res.status(404).json({ error: 'Dados da rota não encontrados' });
    }

    res.json(routeData);
  } catch (error) {
    logError(error, 'Erro ao buscar rota da corrida:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 Advanced Reports - SISTEMA DE RELATÓRIOS AVANÇADOS
router.get('/api/reports/comprehensive', async (req, res) => {
  try {
    const {
      reportType = 'financial', // 'financial', 'operational', 'users', 'trips'
      period = '30d', // '7d', '30d', '90d', '1y'
      format = 'json', // 'json', 'csv'
      filters = {} // filtros específicos
    } = req.query;

    let reportData = {};

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Calcular período
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
          case '1y':
            startDate.setFullYear(now.getFullYear() - 1);
            break;
        }

        // Buscar dados base
        const [bookingsSnapshot, usersSnapshot, carsSnapshot] = await Promise.all([
          db.ref('bookings').once('value'),
          db.ref('users').once('value'),
          db.ref('cars').once('value')
        ]);

        const bookings = bookingsSnapshot.val() || {};
        const users = usersSnapshot.val() || {};
        const cars = carsSnapshot.val() || {};

        // Filtrar bookings por período
        const periodBookings = Object.keys(bookings).filter(bookingId => {
          const booking = bookings[bookingId];
          const tripDate = new Date(booking.tripdate);
          return tripDate >= startDate && tripDate <= now;
        }).map(id => ({ id, ...bookings[id] }));

        // Relatório Financeiro
        if (reportType === 'financial') {
          const completedBookings = periodBookings.filter(b =>
            b.status === 'COMPLETE' || b.status === 'PAID'
          );

          const totalFares = completedBookings.reduce((sum, b) =>
            sum + parseFloat(b.estimate || 0), 0
          );

          const convenienceFees = completedBookings.reduce((sum, b) =>
            sum + (parseFloat(b.estimate || 0) * 0.15), 0 // 15% de taxa
          );

          const driverEarnings = completedBookings.reduce((sum, b) =>
            sum + parseFloat(b.driver_share || b.estimate * 0.85 || 0), 0
          );

          // Agrupar por dia
          const dailyRevenue = {};
          completedBookings.forEach(booking => {
            const date = new Date(booking.tripdate).toISOString().split('T')[0];
            if (!dailyRevenue[date]) {
              dailyRevenue[date] = {
                totalFares: 0,
                convenienceFees: 0,
                trips: 0
              };
            }
            dailyRevenue[date].totalFares += parseFloat(booking.estimate || 0);
            dailyRevenue[date].convenienceFees += parseFloat(booking.estimate || 0) * 0.15;
            dailyRevenue[date].trips += 1;
          });

          reportData = {
            summary: {
              period: `${startDate.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
              totalBookings: periodBookings.length,
              completedBookings: completedBookings.length,
              totalRevenue: totalFares.toFixed(2),
              convenienceFees: convenienceFees.toFixed(2),
              driverEarnings: driverEarnings.toFixed(2),
              averageOrderValue: completedBookings.length > 0 ?
                (totalFares / completedBookings.length).toFixed(2) : '0.00'
            },
            dailyBreakdown: Object.keys(dailyRevenue).map(date => ({
              date,
              ...dailyRevenue[date],
              totalFares: dailyRevenue[date].totalFares.toFixed(2),
              convenienceFees: dailyRevenue[date].convenienceFees.toFixed(2)
            })).sort((a, b) => new Date(a.date) - new Date(b.date)),
            topDrivers: getTopDriversByEarnings(completedBookings, users, 10),
            paymentMethods: getPaymentMethodsBreakdown(completedBookings)
          };
        }

        // Relatório Operacional
        else if (reportType === 'operational') {
          const totalTrips = periodBookings.length;
          const completedTrips = periodBookings.filter(b =>
            b.status === 'COMPLETE' || b.status === 'PAID'
          ).length;
          const cancelledTrips = periodBookings.filter(b =>
            b.status === 'CANCELLED'
          ).length;

          // Análise de cancelamentos
          const cancellationReasons = {};
          periodBookings.filter(b => b.status === 'CANCELLED').forEach(booking => {
            const reason = booking.reason || 'Unknown';
            cancellationReasons[reason] = (cancellationReasons[reason] || 0) + 1;
          });

          // Análise de tempos
          const avgWaitTime = calculateAverageWaitTime(completedBookings);
          const avgTripTime = calculateAverageTripTime(completedBookings);

          reportData = {
            summary: {
              period: `${startDate.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
              totalTrips,
              completedTrips,
              cancelledTrips,
              completionRate: totalTrips > 0 ? ((completedTrips / totalTrips) * 100).toFixed(2) + '%' : '0%',
              cancellationRate: totalTrips > 0 ? ((cancelledTrips / totalTrips) * 100).toFixed(2) + '%' : '0%',
              avgWaitTime: avgWaitTime + ' min',
              avgTripTime: avgTripTime + ' min'
            },
            cancellationAnalysis: Object.keys(cancellationReasons).map(reason => ({
              reason,
              count: cancellationReasons[reason],
              percentage: ((cancellationReasons[reason] / cancelledTrips) * 100).toFixed(2) + '%'
            })).sort((a, b) => b.count - a.count),
            hourlyDistribution: getHourlyTripDistribution(periodBookings),
            cityAnalysis: getCityAnalysis(periodBookings, users)
          };
        }

        // Relatório de Usuários
        else if (reportType === 'users') {
          const periodUsers = Object.keys(users).filter(userId => {
            const user = users[userId];
            if (!user.createdAt) return false;
            const createdDate = new Date(user.createdAt);
            return createdDate >= startDate && createdDate <= now;
          }).map(id => ({ id, ...users[id] }));

          const newDrivers = periodUsers.filter(u => u.usertype === 'driver');
          const newCustomers = periodUsers.filter(u => u.usertype === 'customer');

          reportData = {
            summary: {
              period: `${startDate.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
              newUsers: periodUsers.length,
              newDrivers: newDrivers.length,
              newCustomers: newCustomers.length,
              approvedDrivers: newDrivers.filter(d => d.approved === true).length,
              pendingDrivers: newDrivers.filter(d => d.approved !== true && d.approved !== false).length
            },
            userGrowth: getUserGrowthTrend(periodUsers, startDate, now),
            topReferrers: getTopReferrers(periodUsers),
            geographicDistribution: getGeographicDistribution(periodUsers)
          };
        }

        // Relatório de Corridas
        else if (reportType === 'trips') {
          reportData = {
            summary: {
              period: `${startDate.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
              totalTrips: periodBookings.length,
              completedTrips: periodBookings.filter(b => b.status === 'COMPLETE' || b.status === 'PAID').length,
              averageDistance: getAverageDistance(periodBookings),
              averageRating: getAverageRating(periodBookings),
              peakHours: getPeakHours(periodBookings)
            },
            tripAnalysis: getTripAnalysis(periodBookings),
            routeAnalysis: getRouteAnalysis(periodBookings),
            vehicleTypeAnalysis: getVehicleTypeAnalysis(periodBookings, cars)
          };
        }
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar relatório:', error.message, { service: 'dashboard-routes' });
    }

    // Se format for CSV, converter para CSV
    if (format === 'csv') {
      const csv = convertToCSV(reportData, reportType);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="report_${reportType}_${period}.csv"`);
      return res.send(csv);
    }

    res.json({
      reportType,
      period,
      generatedAt: new Date().toISOString(),
      data: reportData
    });
  } catch (error) {
    logError(error, 'Erro ao gerar relatório:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 Export Report Data
router.get('/api/reports/export/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { format = 'pdf' } = req.query; // 'pdf', 'excel', 'csv'

    // TODO: Implementar exportação para diferentes formatos
    // Por enquanto, retornar CSV básico

    res.json({
      message: 'Funcionalidade de exportação em desenvolvimento',
      reportId,
      format,
      availableFormats: ['csv', 'json']
    });
  } catch (error) {
    logError(error, 'Erro ao exportar relatório:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Funções auxiliares para relatórios
function getTopDriversByEarnings(bookings, users, limit = 10) {
  const driverEarnings = {};

  bookings.forEach(booking => {
    const driverId = booking.driver;
    if (!driverId) return;

    if (!driverEarnings[driverId]) {
      driverEarnings[driverId] = {
        driverId,
        name: users[driverId] ? `${users[driverId].firstName || ''} ${users[driverId].lastName || ''}`.trim() : 'Unknown',
        totalEarnings: 0,
        totalTrips: 0
      };
    }

    driverEarnings[driverId].totalEarnings += parseFloat(booking.driver_share || booking.estimate * 0.85 || 0);
    driverEarnings[driverId].totalTrips += 1;
  });

  return Object.values(driverEarnings)
    .sort((a, b) => b.totalEarnings - a.totalEarnings)
    .slice(0, limit)
    .map(driver => ({
      ...driver,
      totalEarnings: driver.totalEarnings.toFixed(2),
      avgEarningsPerTrip: (driver.totalEarnings / driver.totalTrips).toFixed(2)
    }));
}

function getPaymentMethodsBreakdown(bookings) {
  const methods = {};

  bookings.forEach(booking => {
    const method = booking.payment_mode || 'Unknown';
    methods[method] = (methods[method] || 0) + 1;
  });

  return Object.keys(methods).map(method => ({
    method,
    count: methods[method],
    percentage: ((methods[method] / bookings.length) * 100).toFixed(2) + '%'
  }));
}

function calculateAverageWaitTime(bookings) {
  if (!Array.isArray(bookings) || bookings.length === 0) {
    return 0;
  }

  const waitMinutes = bookings
    .map((booking) => {
      const requestedAt = pickFirstTimestamp(booking, [
        'requestedAt', 'requestTime', 'createdAt', 'tripdate'
      ]);
      const acceptedAt = pickFirstTimestamp(booking, [
        'acceptedAt', 'acceptTime', 'driverAcceptedAt', 'tripstart'
      ]);
      return diffMinutes(requestedAt, acceptedAt, 240);
    })
    .filter((value) => Number.isFinite(value));

  if (waitMinutes.length === 0) {
    return 0;
  }

  return waitMinutes.reduce((sum, value) => sum + value, 0) / waitMinutes.length;
}

function calculateAverageTripTime(bookings) {
  if (!Array.isArray(bookings) || bookings.length === 0) {
    return 0;
  }

  const tripMinutes = bookings
    .map((booking) => {
      const tripStart = pickFirstTimestamp(booking, [
        'tripstart', 'startTripAt', 'startedAt', 'acceptedAt'
      ]);
      const tripEnd = pickFirstTimestamp(booking, [
        'tripend', 'completeTripAt', 'completedAt', 'finishedAt', 'updatedAt'
      ]);
      return diffMinutes(tripStart, tripEnd, 480);
    })
    .filter((value) => Number.isFinite(value));

  if (tripMinutes.length === 0) {
    return 0;
  }

  return tripMinutes.reduce((sum, value) => sum + value, 0) / tripMinutes.length;
}

function getPeakHours(bookings, topN = 3) {
  if (!Array.isArray(bookings) || bookings.length === 0) {
    return [];
  }

  return getHourlyTripDistribution(bookings)
    .filter(({ trips }) => trips > 0)
    .sort((a, b) => b.trips - a.trips)
    .slice(0, topN);
}

function normalizeTimestamp(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return null;
  }

  if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
    return rawValue;
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    const normalizedMs = rawValue < 1e12 ? rawValue * 1000 : rawValue;
    const date = new Date(normalizedMs);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const asString = String(rawValue).trim();
  if (!asString) {
    return null;
  }

  if (/^\d+$/.test(asString)) {
    const parsedNumber = Number.parseInt(asString, 10);
    if (Number.isFinite(parsedNumber)) {
      const normalizedMs = parsedNumber < 1e12 ? parsedNumber * 1000 : parsedNumber;
      const date = new Date(normalizedMs);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pickFirstTimestamp(source, fieldNames) {
  if (!source || typeof source !== 'object') {
    return null;
  }

  for (const fieldName of fieldNames) {
    const parsed = normalizeTimestamp(source[fieldName]);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function diffMinutes(start, end, maxMinutes = 480) {
  if (!start || !end) {
    return null;
  }

  const deltaMs = end.getTime() - start.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return null;
  }

  const minutes = deltaMs / (1000 * 60);
  if (minutes > maxMinutes) {
    return null;
  }

  return minutes;
}

async function sampleRedisKeys(redis, pattern, limit = 100, scanCount = 100) {
  const keys = [];
  let cursor = '0';

  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', scanCount);
    cursor = nextCursor;

    for (const key of batch) {
      keys.push(key);
      if (keys.length >= limit) {
        return keys;
      }
    }
  } while (cursor !== '0');

  return keys;
}

async function loadBookingHashes(redis, keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return [];
  }

  const pipeline = redis.pipeline();
  keys.forEach((key) => pipeline.hgetall(key));
  const results = await pipeline.exec();

  return results
    .map(([error, hash]) => (error ? null : hash))
    .filter((hash) => hash && Object.keys(hash).length > 0);
}

function getHourlyTripDistribution(bookings) {
  const hourly = new Array(24).fill(0);

  bookings.forEach(booking => {
    const hour = new Date(booking.tripdate).getHours();
    hourly[hour] += 1;
  });

  return hourly.map((count, hour) => ({
    hour: `${hour}:00`,
    trips: count
  }));
}

function getCityAnalysis(bookings, users) {
  const cities = {};

  bookings.forEach(booking => {
    const customer = users[booking.customer];
    const city = customer?.city || 'Unknown';

    if (!cities[city]) {
      cities[city] = { trips: 0, revenue: 0 };
    }

    cities[city].trips += 1;
    cities[city].revenue += parseFloat(booking.estimate || 0);
  });

  return Object.keys(cities).map(city => ({
    city,
    trips: cities[city].trips,
    revenue: cities[city].revenue.toFixed(2)
  })).sort((a, b) => b.trips - a.trips);
}

function getUserGrowthTrend(users, startDate, endDate) {
  const daily = {};

  users.forEach(user => {
    const date = new Date(user.createdAt).toISOString().split('T')[0];
    if (!daily[date]) {
      daily[date] = { drivers: 0, customers: 0 };
    }

    if (user.usertype === 'driver') {
      daily[date].drivers += 1;
    } else {
      daily[date].customers += 1;
    }
  });

  return Object.keys(daily).sort().map(date => ({
    date,
    ...daily[date],
    total: daily[date].drivers + daily[date].customers
  }));
}

function getTopReferrers(users) {
  const referrers = {};

  users.forEach(user => {
    const referrer = user.referredBy || 'Direct';
    referrers[referrer] = (referrers[referrer] || 0) + 1;
  });

  return Object.keys(referrers).map(referrer => ({
    referrer,
    count: referrers[referrer]
  })).sort((a, b) => b.count - a.count).slice(0, 10);
}

function getGeographicDistribution(users) {
  const locations = {};

  users.forEach(user => {
    const location = user.city || 'Unknown';
    locations[location] = (locations[location] || 0) + 1;
  });

  return Object.keys(locations).map(location => ({
    location,
    count: locations[location]
  })).sort((a, b) => b.count - a.count);
}

function getTripAnalysis(bookings) {
  const analysis = {
    byStatus: {},
    byTime: { morning: 0, afternoon: 0, evening: 0, night: 0 }
  };

  bookings.forEach(booking => {
    // Status analysis
    const status = booking.status || 'Unknown';
    analysis.byStatus[status] = (analysis.byStatus[status] || 0) + 1;

    // Time analysis
    const hour = new Date(booking.tripdate).getHours();
    if (hour >= 6 && hour < 12) analysis.byTime.morning += 1;
    else if (hour >= 12 && hour < 18) analysis.byTime.afternoon += 1;
    else if (hour >= 18 && hour < 24) analysis.byTime.evening += 1;
    else analysis.byTime.night += 1;
  });

  return analysis;
}

function getRouteAnalysis(bookings) {
  const routes = {};

  bookings.forEach(booking => {
    const pickup = booking.pickup?.add || 'Unknown';
    const drop = booking.drop?.add || 'Unknown';
    const route = `${pickup} → ${drop}`;

    routes[route] = (routes[route] || 0) + 1;
  });

  return Object.keys(routes).map(route => ({
    route,
    count: routes[route]
  })).sort((a, b) => b.count - a.count).slice(0, 20);
}

function getVehicleTypeAnalysis(bookings, cars) {
  const types = {};

  bookings.forEach(booking => {
    const driverCar = Object.values(cars).find(car => car.driver === booking.driver);
    const type = driverCar?.carType || 'Unknown';

    types[type] = (types[type] || 0) + 1;
  });

  return Object.keys(types).map(type => ({
    type,
    count: types[type]
  })).sort((a, b) => b.count - a.count);
}

function getAverageDistance(bookings) {
  const distances = bookings.filter(b => b.distance).map(b => parseFloat(b.distance));
  if (distances.length === 0) return '0 km';

  const avg = distances.reduce((sum, d) => sum + d, 0) / distances.length;
  return avg.toFixed(2) + ' km';
}

function getAverageRating(bookings) {
  const ratings = bookings.filter(b => b.rating).map(b => parseFloat(b.rating));
  if (ratings.length === 0) return '0.0';

  const avg = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
  return avg.toFixed(1);
}

function getPeakHours(bookings) {
  const hourly = new Array(24).fill(0);

  bookings.forEach(booking => {
    const hour = new Date(booking.tripdate).getHours();
    hourly[hour] += 1;
  });

  const maxTrips = Math.max(...hourly);
  const peakHours = hourly.map((trips, hour) => ({ hour, trips }))
    .filter(h => h.trips === maxTrips)
    .map(h => `${h.hour}:00`);

  return peakHours;
}

function convertToCSV(data, reportType) {
  // Simplified CSV conversion
  let csv = `Report Type: ${reportType}\n`;
  csv += `Generated At: ${new Date().toISOString()}\n\n`;

  if (data.summary) {
    csv += 'SUMMARY\n';
    Object.keys(data.summary).forEach(key => {
      csv += `${key},${data.summary[key]}\n`;
    });
    csv += '\n';
  }

  return csv;
}

// 💳 Subscription Management - MODELO DIÁRIO (cobrança no saque)
router.get('/api/subscriptions/drivers', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const {
      status, // 'active', 'pending', 'blocked', ...
      paymentStatus, // 'paid', 'overdue', 'blocked'
      page = 1,
      limit = 20
    } = req.query;

    try {
      const data = await driverSubscriptionService.listDriverSubscriptions({
        status,
        paymentStatus,
        page,
        limit
      });
      return res.json(data);
    } catch (modernError) {
      logStructured('warn', 'Fallback RTDB em /api/subscriptions/drivers', {
        service: 'dashboard-routes',
        reason: modernError.message
      });
    }

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(503).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();
    const [usersSnapshot, subscriptionsSnapshot] = await Promise.all([
      db.ref('users').orderByChild('usertype').equalTo('driver').once('value'),
      db.ref('subscriptions').once('value')
    ]);

    const users = usersSnapshot.val() || {};
    const subscriptionsData = subscriptionsSnapshot.val() || {};
    const now = new Date();

    const plusDefaultDailyCents = Number.parseInt(process.env.SUBSCRIPTION_PLUS_DAILY_CENTS || '990', 10);
    const eliteDefaultDailyCents = Number.parseInt(process.env.SUBSCRIPTION_ELITE_DAILY_CENTS || '0', 10);

    let rows = Object.keys(users).map((driverId) => {
      const driver = users[driverId] || {};
      const subscription = subscriptionsData[driverId] || {};

      const planType = String(subscription.planType || driver.planType || 'plus').toLowerCase() === 'elite'
        ? 'elite'
        : 'plus';
      const fallbackDailyCents = planType === 'elite' ? eliteDefaultDailyCents : plusDefaultDailyCents;
      const dailyFeeCents = Math.max(
        0,
        Number(subscription.dailyFeeCents ?? subscription.dailyFeeOverrideCents ?? fallbackDailyCents) || 0
      );
      const weeklyFeeCents = Math.max(
        0,
        Number(subscription.weeklyFeeCents || dailyFeeCents * 7) || 0
      );
      const pendingFeeCents = Math.max(
        0,
        Number(subscription.pendingFeeCents || driver.subscription_pending_fee_cents || 0) || 0
      );

      const subscriptionStatus = String(
        subscription.status ||
        driver.subscriptionStatus ||
        (driver.approved ? 'active' : 'pending')
      ).toLowerCase();

      const billingStatus = String(
        subscription.billingStatus ||
        driver.billing_status ||
        (pendingFeeCents > 0 ? 'overdue' : 'active')
      ).toLowerCase();

      const hardBlocked = ['blocked', 'cancelled', 'suspended'].includes(subscriptionStatus) || billingStatus === 'suspended';
      const isOverdue = pendingFeeCents > 0 && !hardBlocked;
      const currentPaymentStatus = hardBlocked ? 'blocked' : (isOverdue ? 'overdue' : 'paid');

      const freeTrialEnd = driver.free_trial_end ? new Date(driver.free_trial_end) : null;
      const freeMonthsEnd = driver.free_months_end ? new Date(driver.free_months_end) : null;
      const promotionFreeEnd = driver.promotion_free_end ? new Date(driver.promotion_free_end) : null;
      const feeExemptUntil = subscription.feeExemptUntil ? new Date(subscription.feeExemptUntil) : null;
      const freeEnds = [freeTrialEnd, freeMonthsEnd, promotionFreeEnd, feeExemptUntil].filter(
        (date) => date && !Number.isNaN(date.getTime()) && date > now
      );
      const latestFreeEnd = freeEnds.length > 0
        ? new Date(Math.max(...freeEnds.map((date) => date.getTime())))
        : null;
      const isFree = subscription.isFeeExempt === true || latestFreeEnd !== null;

      const appliedDailyFeeCents = isFree ? 0 : dailyFeeCents;

      return {
        driverId,
        driver: {
          id: driverId,
          name: `${driver.firstName || ''} ${driver.lastName || ''}`.trim(),
          email: driver.email || '',
          phone: driver.mobile || '',
          approved: driver.approved || false,
          joinDate: driver.createdAt ? new Date(driver.createdAt).toISOString() : null
        },
        subscription: {
          planType,
          status: subscriptionStatus,
          billingStatus,
          waveId: subscription.waveId || driver.subscription_wave_id || null,
          collectionMode: String(subscription.collectionMode || driver.subscription_collection_mode || 'withdrawal').toLowerCase(),
          dailyFeeCents: appliedDailyFeeCents,
          dailyFee: Number((appliedDailyFeeCents / 100).toFixed(2)),
          weeklyFeeCents,
          weeklyFee: Number((weeklyFeeCents / 100).toFixed(2)),
          pendingFeeCents,
          pendingFee: Number((pendingFeeCents / 100).toFixed(2)),
          isFree,
          freeUntil: latestFreeEnd ? latestFreeEnd.toISOString() : null
        },
        currentPeriod: {
          paymentStatus: currentPaymentStatus,
          amount: Number((appliedDailyFeeCents / 100).toFixed(2)),
          amountCents: appliedDailyFeeCents,
          dueDate: null,
          daysOverdue: 0
        },
        financials: {
          totalPaid: '0.00',
          totalDue: Number((pendingFeeCents / 100).toFixed(2)).toFixed(2),
          outstandingBalance: Number((pendingFeeCents / 100).toFixed(2)).toFixed(2),
          paymentsCount: 0
        },
        lastPayment: null
      };
    });

    if (status && status !== 'all') {
      rows = rows.filter((row) => row.subscription.status === String(status).toLowerCase());
    }

    if (paymentStatus && paymentStatus !== 'all') {
      rows = rows.filter((row) => row.currentPeriod.paymentStatus === String(paymentStatus).toLowerCase());
    }

    rows.sort((a, b) => {
      const order = { blocked: 0, overdue: 1, pending: 2, paid: 3 };
      return (order[a.currentPeriod.paymentStatus] ?? 99) - (order[b.currentPeriod.paymentStatus] ?? 99);
    });

    const totalCount = rows.length;
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 20, 500));
    const startIndex = (safePage - 1) * safeLimit;
    const endIndex = startIndex + safeLimit;
    const paginated = rows.slice(startIndex, endIndex);

    return res.json({
      subscriptions: paginated,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: totalCount,
        pages: Math.ceil(totalCount / safeLimit)
      },
      summary: {
        total: totalCount,
        active: rows.filter((row) => row.subscription.status === 'active').length,
        pending: rows.filter((row) => row.subscription.status === 'pending').length,
        overdue: rows.filter((row) => row.currentPeriod.paymentStatus === 'overdue').length,
        totalRevenue: rows.reduce((sum, row) => sum + parseFloat(row.financials.totalPaid || 0), 0).toFixed(2),
        outstandingAmount: rows.reduce((sum, row) => sum + parseFloat(row.financials.outstandingBalance || 0), 0).toFixed(2)
      }
    });
  } catch (error) {
    logError(error, 'Erro ao buscar assinaturas:', { service: 'dashboard-routes' });
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💳 Process Subscription Payment
router.post('/api/subscriptions/payments', async (req, res) => {
  try {
    const { driverId, amount, paymentMethod, weekStart, adminId = 'admin1' } = req.body;

    if (!driverId || !amount) {
      return res.status(400).json({ error: 'Driver ID e amount são obrigatórios' });
    }

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o motorista existe
        const driverSnapshot = await db.ref(`users/${driverId}`).once('value');
        if (!driverSnapshot.exists()) {
          return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        const driver = driverSnapshot.val();
        if (driver.usertype !== 'driver') {
          return res.status(400).json({ error: 'Usuário não é um motorista' });
        }

        // Criar registro de pagamento
        const paymentId = Date.now().toString();
        const weekStartDate = weekStart ? new Date(weekStart) : getWeekStart(new Date());

        const payment = {
          paymentId,
          driverId,
          type: 'subscription',
          amount: parseFloat(amount),
          paymentMethod: paymentMethod || 'manual',
          weekStart: weekStartDate.toISOString(),
          weekEnd: new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'paid',
          processedBy: adminId,
          timestamp: new Date().toISOString(),
          driverName: `${driver.firstName || ''} ${driver.lastName || ''}`.trim()
        };

        // Salvar pagamento
        await db.ref(`payments/${paymentId}`).set(payment);

        const subscriptionWrite = await subscriptionStateService.runTransaction(driverId, (state) => ({
          ...state,
          driverId,
          weeklyFee: parseFloat(amount),
          startDate: state.startDate || driver.createdAt || new Date().toISOString(),
          status: 'active',
          billingStatus: 'active',
          lastPayment: payment.timestamp,
          updatedBy: adminId,
          updatedAt: payment.timestamp
        }), { db });
        if (!subscriptionWrite.success) {
          throw new Error(subscriptionWrite.error || 'Falha ao atualizar assinatura após pagamento');
        }

        logStructured('info', `💳 Pagamento de assinatura processado: ${driverId} - R$ ${amount}`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Pagamento processado com sucesso',
          data: {
            paymentId,
            driverId,
            amount: parseFloat(amount),
            weekStart: weekStartDate.toISOString(),
            processedAt: payment.timestamp
          }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao processar pagamento no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar pagamento' });
    }
  } catch (error) {
    logError(error, 'Erro ao processar pagamento:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💳 Update Subscription Settings
router.patch('/api/subscriptions/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { weeklyFee, status, notes, adminId = 'admin1' } = req.body;

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o motorista existe
        const driverSnapshot = await db.ref(`users/${driverId}`).once('value');
        if (!driverSnapshot.exists()) {
          return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        const driver = driverSnapshot.val();
        if (driver.usertype !== 'driver') {
          return res.status(400).json({ error: 'Usuário não é um motorista' });
        }

        // Preparar atualizações
        const updates = {
          updatedAt: new Date().toISOString(),
          updatedBy: adminId
        };

        if (weeklyFee !== undefined) updates.weeklyFee = parseFloat(weeklyFee);
        if (status) updates.status = status;
        if (notes) updates.adminNotes = notes;

        const subscriptionWrite = await subscriptionStateService.runTransaction(driverId, (state) => ({
          ...state,
          driverId,
          weeklyFee: weeklyFee !== undefined ? parseFloat(weeklyFee || 0) : state.weeklyFee,
          startDate: state.startDate || driver.createdAt || new Date().toISOString(),
          status: status || state.status || 'active',
          adminNotes: notes !== undefined ? notes : state.adminNotes,
          createdBy: state.createdBy || adminId,
          createdAt: state.createdAt || new Date().toISOString(),
          ...updates
        }), { db });
        if (!subscriptionWrite.success) {
          throw new Error(subscriptionWrite.error || 'Falha ao atualizar assinatura');
        }

        logStructured('info', `💳 Assinatura atualizada: ${driverId} por ${adminId}`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Assinatura atualizada com sucesso',
          data: {
            driverId,
            updatedAt: updates.updatedAt
          }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao atualizar assinatura no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar atualização' });
    }
  } catch (error) {
    logError(error, 'Erro ao atualizar assinatura:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💳 Subscription Analytics
router.get('/api/subscriptions/analytics', async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    let analytics = {
      revenue: {},
      subscribers: {},
      trends: {}
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Calcular período
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
        }

        // Buscar pagamentos do período
        const paymentsSnapshot = await db.ref('payments').once('value');
        const payments = paymentsSnapshot.val() || {};

        const subscriptionPayments = Object.values(payments).filter(payment =>
          payment.type === 'subscription' &&
          new Date(payment.timestamp) >= startDate &&
          payment.status === 'paid'
        );

        // Análise de receita
        const totalRevenue = subscriptionPayments.reduce((sum, payment) =>
          sum + parseFloat(payment.amount || 0), 0
        );

        const weeklyBreakdown = {};
        subscriptionPayments.forEach(payment => {
          const weekStart = getWeekStart(new Date(payment.weekStart)).toISOString().split('T')[0];
          if (!weeklyBreakdown[weekStart]) {
            weeklyBreakdown[weekStart] = { amount: 0, count: 0 };
          }
          weeklyBreakdown[weekStart].amount += parseFloat(payment.amount || 0);
          weeklyBreakdown[weekStart].count += 1;
        });

        // Buscar motoristas ativos
        const usersSnapshot = await db.ref('users').orderByChild('usertype').equalTo('driver').once('value');
        const drivers = usersSnapshot.val() || {};

        const activeDrivers = Object.values(drivers).filter(driver => driver.approved === true);
        const totalDrivers = Object.values(drivers).length;

        analytics = {
          revenue: {
            total: totalRevenue.toFixed(2),
            average: subscriptionPayments.length > 0 ?
              (totalRevenue / subscriptionPayments.length).toFixed(2) : '0.00',
            weeklyBreakdown: Object.keys(weeklyBreakdown).sort().map(week => ({
              week,
              amount: weeklyBreakdown[week].amount.toFixed(2),
              subscribers: weeklyBreakdown[week].count
            }))
          },
          subscribers: {
            total: totalDrivers,
            active: activeDrivers.length,
            paying: subscriptionPayments.length,
            conversionRate: totalDrivers > 0 ?
              ((subscriptionPayments.length / totalDrivers) * 100).toFixed(2) + '%' : '0%'
          },
          trends: {
            period,
            growthRate: calculateGrowthRate(weeklyBreakdown),
            averageRevenuePerUser: activeDrivers.length > 0 ?
              (totalRevenue / activeDrivers.length).toFixed(2) : '0.00',
            paymentFrequency: calculatePaymentFrequency(subscriptionPayments)
          }
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar analytics de assinaturas:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      generatedAt: new Date().toISOString(),
      analytics
    });
  } catch (error) {
    logError(error, 'Erro ao gerar analytics de assinaturas:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Funções auxiliares para assinaturas
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Ajustar para segunda-feira
  return new Date(d.setDate(diff));
}

function calculateGrowthRate(weeklyData) {
  const weeks = Object.keys(weeklyData).sort();
  if (weeks.length < 2) return '0%';

  const firstWeek = weeklyData[weeks[0]].amount;
  const lastWeek = weeklyData[weeks[weeks.length - 1]].amount;

  if (firstWeek === 0) return '0%';

  const growth = ((lastWeek - firstWeek) / firstWeek) * 100;
  return growth.toFixed(2) + '%';
}

function calculatePaymentFrequency(payments) {
  const driverPayments = {};

  payments.forEach(payment => {
    const driverId = payment.driverId;
    if (!driverPayments[driverId]) {
      driverPayments[driverId] = 0;
    }
    driverPayments[driverId] += 1;
  });

  const frequencies = Object.values(driverPayments);
  const average = frequencies.length > 0 ?
    frequencies.reduce((sum, freq) => sum + freq, 0) / frequencies.length : 0;

  return average.toFixed(1) + ' pagamentos/período';
}

if (legacyPromotionsRoutesEnabled) {
// 🎁 Promotion Management - SISTEMA DE PROMOÇÕES POR PERFIL
router.get('/api/legacy/promotions', async (req, res) => {
  if (!legacyPromotionsRoutesEnabled) {
    return res.status(410).json({
      error: 'Rotas legadas de promoções desativadas',
      code: 'LEGACY_PROMOTIONS_DISABLED'
    });
  }

  try {
    const {
      status, // 'active', 'expired', 'scheduled', 'paused'
      target, // 'drivers', 'customers', 'all'
      type, // 'percentage', 'fixed', 'free_rides', 'subscription_discount'
      page = 1,
      limit = 20
    } = req.query;

    let promotions = [];
    let totalCount = 0;

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar promoções
        const promosSnapshot = await db.ref('promos').once('value');
        const promosData = promosSnapshot.val() || {};

        // Buscar usos das promoções
        const promoUsageSnapshot = await db.ref('promoUsage').once('value');
        const promoUsage = promoUsageSnapshot.val() || {};

        const now = new Date();

        promotions = Object.keys(promosData).map(promoId => {
          const promo = promosData[promoId];

          // Determinar status baseado nas datas
          let currentStatus = 'active';
          const startDate = new Date(promo.startDate || promo.createdAt);
          const endDate = new Date(promo.endDate);

          if (now < startDate) {
            currentStatus = 'scheduled';
          } else if (now > endDate) {
            currentStatus = 'expired';
          } else if (promo.status === 'paused' || promo.active === false) {
            currentStatus = 'paused';
          }

          // Calcular usos da promoção
          const usages = Object.values(promoUsage).filter(usage =>
            usage.promoId === promoId || usage.promoCode === promo.promoCode
          );

          const totalUses = usages.length;
          const uniqueUsers = new Set(usages.map(u => u.userId)).size;
          const totalSavings = usages.reduce((sum, usage) =>
            sum + parseFloat(usage.discountAmount || 0), 0
          );

          // Analisar target de usuários
          let targetAudience = promo.target || 'all';
          if (promo.userType) {
            targetAudience = promo.userType === 'driver' ? 'drivers' : 'customers';
          }

          const promotion = {
            id: promoId,
            name: promo.promoName || promo.title || 'Promoção sem nome',
            code: promo.promoCode || promo.code,
            description: promo.description || '',
            type: promo.type || (promo.percentage ? 'percentage' : 'fixed'),
            target: targetAudience,
            status: currentStatus,
            details: {
              discountType: promo.type || 'percentage',
              discountValue: parseFloat(promo.discount || promo.percentage || promo.value || 0),
              minimumAmount: parseFloat(promo.minAmount || 0),
              maximumDiscount: parseFloat(promo.maxDiscount || 0),
              freeRides: parseInt(promo.freeRides || 0),
              subscriptionMonths: parseInt(promo.subscriptionMonths || 0)
            },
            dates: {
              startDate: promo.startDate || promo.createdAt,
              endDate: promo.endDate,
              createdAt: promo.createdAt || new Date().toISOString()
            },
            limits: {
              maxUses: parseInt(promo.maxUses || promo.usageLimit || 0),
              maxUsesPerUser: parseInt(promo.maxUsesPerUser || promo.userLimit || 1),
              currentUses: totalUses,
              remainingUses: Math.max(0, (parseInt(promo.maxUses || 0) - totalUses))
            },
            targeting: {
              cities: promo.cities ? promo.cities.split(',').map(c => c.trim()) : [],
              newUsersOnly: promo.newUsersOnly || false,
              firstRideOnly: promo.firstRideOnly || false,
              specificUsers: promo.specificUsers || [],
              minTripCount: parseInt(promo.minTripCount || 0)
            },
            analytics: {
              totalUses,
              uniqueUsers,
              totalSavings: totalSavings.toFixed(2),
              conversionRate: promo.maxUses > 0 ?
                ((totalUses / promo.maxUses) * 100).toFixed(2) + '%' : '0%',
              avgSavingsPerUse: totalUses > 0 ?
                (totalSavings / totalUses).toFixed(2) : '0.00'
            },
            creator: {
              createdBy: promo.createdBy || 'admin',
              lastModified: promo.lastModified || promo.createdAt,
              modifiedBy: promo.modifiedBy || promo.createdBy
            }
          };

          return promotion;
        });

        // Aplicar filtros
        if (status && status !== 'all') {
          promotions = promotions.filter(promo => promo.status === status);
        }

        if (target && target !== 'all') {
          promotions = promotions.filter(promo => promo.target === target);
        }

        if (type && type !== 'all') {
          promotions = promotions.filter(promo => promo.type === type);
        }

        // Ordenar por data de criação (mais recentes primeiro)
        promotions.sort((a, b) => new Date(b.dates.createdAt) - new Date(a.dates.createdAt));

        totalCount = promotions.length;

        // Aplicar paginação
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        promotions = promotions.slice(startIndex, endIndex);
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar promoções do Firebase:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      promotions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      },
      summary: {
        total: totalCount,
        active: promotions.filter(p => p.status === 'active').length,
        scheduled: promotions.filter(p => p.status === 'scheduled').length,
        expired: promotions.filter(p => p.status === 'expired').length,
        paused: promotions.filter(p => p.status === 'paused').length,
        totalSavings: promotions.reduce((sum, p) =>
          sum + parseFloat(p.analytics.totalSavings), 0
        ).toFixed(2),
        totalUses: promotions.reduce((sum, p) => sum + p.analytics.totalUses, 0)
      }
    });
  } catch (error) {
    logError(error, 'Erro ao buscar promoções:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🎁 Create New Promotion
router.post('/api/legacy/promotions', async (req, res) => {
  if (!legacyPromotionsRoutesEnabled) {
    return res.status(410).json({
      error: 'Rotas legadas de promoções desativadas',
      code: 'LEGACY_PROMOTIONS_DISABLED'
    });
  }

  try {
    const {
      name,
      code,
      description,
      type, // 'percentage', 'fixed', 'free_rides', 'subscription_discount'
      target, // 'drivers', 'customers', 'all'
      discountValue,
      minimumAmount,
      maximumDiscount,
      startDate,
      endDate,
      maxUses,
      maxUsesPerUser,
      targetingRules,
      adminId = 'admin1'
    } = req.body;

    if (!name || !code || !type || !discountValue || !endDate) {
      return res.status(400).json({
        error: 'Nome, código, tipo, valor do desconto e data final são obrigatórios'
      });
    }

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o código já existe
        const existingPromoSnapshot = await db.ref('promos')
          .orderByChild('promoCode')
          .equalTo(code)
          .once('value');

        if (existingPromoSnapshot.exists()) {
          return res.status(400).json({ error: 'Código promocional já existe' });
        }

        // Criar nova promoção
        const promoId = Date.now().toString();
        const now = new Date().toISOString();

        const promotion = {
          promoId,
          promoName: name,
          promoCode: code.toUpperCase(),
          description,
          type,
          target,
          discount: parseFloat(discountValue),
          percentage: type === 'percentage' ? parseFloat(discountValue) : null,
          value: type === 'fixed' ? parseFloat(discountValue) : null,
          freeRides: type === 'free_rides' ? parseInt(discountValue) : null,
          subscriptionMonths: type === 'subscription_discount' ? parseInt(discountValue) : null,
          minAmount: parseFloat(minimumAmount || 0),
          maxDiscount: parseFloat(maximumDiscount || 0),
          startDate: startDate || now,
          endDate,
          maxUses: parseInt(maxUses || 0),
          maxUsesPerUser: parseInt(maxUsesPerUser || 1),
          userType: target === 'drivers' ? 'driver' : (target === 'customers' ? 'customer' : null),
          status: 'active',
          active: true,
          createdAt: now,
          createdBy: adminId,
          lastModified: now,
          modifiedBy: adminId,
          // Regras de targeting
          ...(targetingRules?.cities && { cities: targetingRules.cities.join(',') }),
          ...(targetingRules?.newUsersOnly && { newUsersOnly: true }),
          ...(targetingRules?.firstRideOnly && { firstRideOnly: true }),
          ...(targetingRules?.minTripCount && { minTripCount: parseInt(targetingRules.minTripCount) })
        };

        // Salvar promoção
        await db.ref(`promos/${promoId}`).set(promotion);

        logStructured('info', `🎁 Nova promoção criada: ${code} por ${adminId}`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Promoção criada com sucesso',
          data: {
            promoId,
            code: promotion.promoCode,
            name: promotion.promoName,
            createdAt: promotion.createdAt
          }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao criar promoção no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar promoção' });
    }
  } catch (error) {
    logError(error, 'Erro ao criar promoção:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🎁 Update Promotion
router.patch('/api/legacy/promotions/:promoId', async (req, res) => {
  if (!legacyPromotionsRoutesEnabled) {
    return res.status(410).json({
      error: 'Rotas legadas de promoções desativadas',
      code: 'LEGACY_PROMOTIONS_DISABLED'
    });
  }

  try {
    const { promoId } = req.params;
    const {
      status,
      endDate,
      maxUses,
      description,
      adminId = 'admin1'
    } = req.body;

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se a promoção existe
        const promoSnapshot = await db.ref(`promos/${promoId}`).once('value');
        if (!promoSnapshot.exists()) {
          return res.status(404).json({ error: 'Promoção não encontrada' });
        }

        // Preparar atualizações
        const updates = {
          lastModified: new Date().toISOString(),
          modifiedBy: adminId
        };

        if (status) {
          updates.status = status;
          updates.active = status === 'active';
        }
        if (endDate) updates.endDate = endDate;
        if (maxUses !== undefined) updates.maxUses = parseInt(maxUses);
        if (description) updates.description = description;

        // Atualizar promoção
        await db.ref(`promos/${promoId}`).update(updates);

        logStructured('info', `🎁 Promoção atualizada: ${promoId} por ${adminId}`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Promoção atualizada com sucesso',
          data: {
            promoId,
            updatedAt: updates.lastModified
          }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao atualizar promoção no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar atualização' });
    }
  } catch (error) {
    logError(error, 'Erro ao atualizar promoção:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🎁 Promotion Analytics
router.get('/api/legacy/promotions/analytics', async (req, res) => {
  if (!legacyPromotionsRoutesEnabled) {
    return res.status(410).json({
      error: 'Rotas legadas de promoções desativadas',
      code: 'LEGACY_PROMOTIONS_DISABLED'
    });
  }

  try {
    const { period = '30d', promoId } = req.query;

    let analytics = {
      overview: {},
      performance: {},
      usage: {}
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Calcular período
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
        }

        // Buscar usos das promoções
        const promoUsageSnapshot = await db.ref('promoUsage').once('value');
        const allUsage = promoUsageSnapshot.val() || {};

        // Filtrar por período e promoção específica se fornecida
        const periodUsage = Object.values(allUsage).filter(usage => {
          const usageDate = new Date(usage.timestamp || usage.usedAt);
          const inPeriod = usageDate >= startDate && usageDate <= now;
          const matchesPromo = !promoId || usage.promoId === promoId;
          return inPeriod && matchesPromo;
        });

        // Buscar promoções ativas
        const promosSnapshot = await db.ref('promos').once('value');
        const promos = promosSnapshot.val() || {};

        const activePromos = Object.values(promos).filter(promo => {
          const endDate = new Date(promo.endDate);
          return endDate > now && promo.active !== false;
        });

        // Calcular métricas gerais
        const totalSavings = periodUsage.reduce((sum, usage) =>
          sum + parseFloat(usage.discountAmount || 0), 0
        );

        const uniqueUsers = new Set(periodUsage.map(u => u.userId)).size;
        const totalUses = periodUsage.length;

        // Analisar por tipo de usuário
        const driverUsage = periodUsage.filter(u => u.userType === 'driver');
        const customerUsage = periodUsage.filter(u => u.userType === 'customer');

        // Analisar por tipo de promoção
        const promoTypeAnalysis = {};
        periodUsage.forEach(usage => {
          const promo = promos[usage.promoId];
          const type = promo?.type || 'unknown';

          if (!promoTypeAnalysis[type]) {
            promoTypeAnalysis[type] = { uses: 0, savings: 0, users: new Set() };
          }

          promoTypeAnalysis[type].uses += 1;
          promoTypeAnalysis[type].savings += parseFloat(usage.discountAmount || 0);
          promoTypeAnalysis[type].users.add(usage.userId);
        });

        // Top promoções por uso
        const promoPerformance = {};
        periodUsage.forEach(usage => {
          const promoId = usage.promoId;
          if (!promoPerformance[promoId]) {
            const promo = promos[promoId];
            promoPerformance[promoId] = {
              promoId,
              name: promo?.promoName || 'Unknown',
              code: promo?.promoCode || 'Unknown',
              uses: 0,
              savings: 0,
              users: new Set()
            };
          }

          promoPerformance[promoId].uses += 1;
          promoPerformance[promoId].savings += parseFloat(usage.discountAmount || 0);
          promoPerformance[promoId].users.add(usage.userId);
        });

        const topPromos = Object.values(promoPerformance)
          .map(promo => ({
            ...promo,
            uniqueUsers: promo.users.size,
            avgSavingsPerUse: promo.uses > 0 ? (promo.savings / promo.uses).toFixed(2) : '0.00',
            savings: promo.savings.toFixed(2)
          }))
          .sort((a, b) => b.uses - a.uses)
          .slice(0, 10);

        analytics = {
          overview: {
            period,
            totalActivePromos: activePromos.length,
            totalUses,
            uniqueUsers,
            totalSavings: totalSavings.toFixed(2),
            avgSavingsPerUse: totalUses > 0 ? (totalSavings / totalUses).toFixed(2) : '0.00',
            conversionRate: uniqueUsers > 0 ? ((totalUses / uniqueUsers)).toFixed(2) : '0.00'
          },
          performance: {
            topPromos,
            byUserType: {
              drivers: {
                uses: driverUsage.length,
                savings: driverUsage.reduce((sum, u) => sum + parseFloat(u.discountAmount || 0), 0).toFixed(2),
                uniqueUsers: new Set(driverUsage.map(u => u.userId)).size
              },
              customers: {
                uses: customerUsage.length,
                savings: customerUsage.reduce((sum, u) => sum + parseFloat(u.discountAmount || 0), 0).toFixed(2),
                uniqueUsers: new Set(customerUsage.map(u => u.userId)).size
              }
            },
            byType: Object.keys(promoTypeAnalysis).map(type => ({
              type,
              uses: promoTypeAnalysis[type].uses,
              savings: promoTypeAnalysis[type].savings.toFixed(2),
              uniqueUsers: promoTypeAnalysis[type].users.size
            }))
          },
          usage: {
            dailyUsage: getDailyUsageBreakdown(periodUsage, startDate, now),
            peakUsageDays: getPeakUsageDays(periodUsage),
            retentionRate: calculatePromoRetentionRate(periodUsage)
          }
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar analytics de promoções:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      promoId: promoId || 'all',
      generatedAt: new Date().toISOString(),
      analytics
    });
  } catch (error) {
    logError(error, 'Erro ao gerar analytics de promoções:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
}

// Funções auxiliares para promoções
function getDailyUsageBreakdown(usage, startDate, endDate) {
  const daily = {};
  const currentDate = new Date(startDate);

  // Inicializar todos os dias com 0
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    daily[dateStr] = { uses: 0, savings: 0 };
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Adicionar dados reais
  usage.forEach(use => {
    const dateStr = new Date(use.timestamp || use.usedAt).toISOString().split('T')[0];
    if (daily[dateStr]) {
      daily[dateStr].uses += 1;
      daily[dateStr].savings += parseFloat(use.discountAmount || 0);
    }
  });

  return Object.keys(daily).sort().map(date => ({
    date,
    uses: daily[date].uses,
    savings: daily[date].savings.toFixed(2)
  }));
}

function getPeakUsageDays(usage) {
  const dayOfWeek = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const weeklyUsage = new Array(7).fill(0);

  usage.forEach(use => {
    const day = new Date(use.timestamp || use.usedAt).getDay();
    weeklyUsage[day] += 1;
  });

  return weeklyUsage.map((count, index) => ({
    day: dayOfWeek[index],
    uses: count
  })).sort((a, b) => b.uses - a.uses);
}

function calculatePromoRetentionRate(usage) {
  const userUsage = {};

  usage.forEach(use => {
    const userId = use.userId;
    if (!userUsage[userId]) {
      userUsage[userId] = 0;
    }
    userUsage[userId] += 1;
  });

  const totalUsers = Object.keys(userUsage).length;
  const repeatUsers = Object.values(userUsage).filter(count => count > 1).length;

  return totalUsers > 0 ? ((repeatUsers / totalUsers) * 100).toFixed(2) + '%' : '0%';
}

// 💲 Operational Costs Tracking - TRACKING DE CUSTOS OPERACIONAIS POR CORRIDA
router.get('/api/costs/per-trip', async (req, res) => {
  try {
    const {
      period = '30d',
      tripId,
      detailed = false
    } = req.query;

    let costsData = {
      summary: {},
      trips: [],
      breakdown: {}
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Calcular período
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
        }

        // Buscar corridas do período
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};

        // Filtrar corridas por período e status
        let tripIds = Object.keys(bookings);
        if (tripId) {
          tripIds = [tripId];
        } else {
          tripIds = tripIds.filter(id => {
            const booking = bookings[id];
            const tripDate = new Date(booking.tripdate);
            return tripDate >= startDate &&
              (booking.status === 'COMPLETE' || booking.status === 'PAID');
          });
        }

        const tripsWithCosts = tripIds.map(id => {
          const booking = bookings[id];
          const distance = parseFloat(booking.distance || 0);
          const duration = parseFloat(booking.duration || 0);
          const fare = parseFloat(booking.estimate || 0);

          // Custos por corrida (estimativas baseadas em dados reais do mercado)
          const costs = calculateTripCosts(booking, distance, duration);

          return {
            tripId: id,
            basic: {
              date: booking.tripdate,
              distance: distance.toFixed(2) + ' km',
              duration: duration.toFixed(0) + ' min',
              fare: fare.toFixed(2),
              status: booking.status
            },
            costs: {
              // APIs Google
              mapsApi: costs.mapsApi,
              geocoding: costs.geocoding,
              directionsApi: costs.directionsApi,
              placesApi: costs.placesApi,

              // Infraestrutura
              serverCosts: costs.serverCosts,
              firebaseCosts: costs.firebaseCosts,
              redisCosts: costs.redisCosts,

              // Processamento
              paymentProcessing: costs.paymentProcessing,

              // Comunicação
              fcmNotifications: costs.fcmNotifications,
              smsNotifications: costs.smsNotifications,

              // Total
              totalApiCosts: costs.totalApiCosts,
              totalInfraCosts: costs.totalInfraCosts,
              totalCommCosts: costs.totalCommCosts,
              totalOperationalCosts: costs.totalOperationalCosts
            },
            profitability: {
              grossRevenue: fare.toFixed(2),
              operationalCosts: costs.totalOperationalCosts.toFixed(4),
              netRevenue: (fare - costs.totalOperationalCosts).toFixed(2),
              profitMargin: fare > 0 ? (((fare - costs.totalOperationalCosts) / fare) * 100).toFixed(2) + '%' : '0%',
              costPerKm: distance > 0 ? (costs.totalOperationalCosts / distance).toFixed(4) : '0.0000',
              costPerMinute: duration > 0 ? (costs.totalOperationalCosts / duration).toFixed(4) : '0.0000'
            }
          };
        });

        // Calcular resumo agregado
        const totalTrips = tripsWithCosts.length;
        const totalRevenue = tripsWithCosts.reduce((sum, trip) =>
          sum + parseFloat(trip.basic.fare), 0
        );
        const totalOperationalCosts = tripsWithCosts.reduce((sum, trip) =>
          sum + trip.costs.totalOperationalCosts, 0
        );
        const totalDistance = tripsWithCosts.reduce((sum, trip) =>
          sum + parseFloat(trip.basic.distance), 0
        );
        const totalDuration = tripsWithCosts.reduce((sum, trip) =>
          sum + parseFloat(trip.basic.duration), 0
        );

        // Breakdown por categoria de custo
        const costBreakdown = {
          apiCosts: {
            total: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.totalApiCosts, 0),
            maps: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.mapsApi, 0),
            geocoding: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.geocoding, 0),
            directions: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.directionsApi, 0),
            places: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.placesApi, 0)
          },
          infraCosts: {
            total: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.totalInfraCosts, 0),
            server: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.serverCosts, 0),
            firebase: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.firebaseCosts, 0),
            redis: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.redisCosts, 0)
          },
          processingCosts: {
            payment: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.paymentProcessing, 0)
          },
          communicationCosts: {
            total: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.totalCommCosts, 0),
            fcm: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.fcmNotifications, 0),
            sms: tripsWithCosts.reduce((sum, trip) => sum + trip.costs.smsNotifications, 0)
          }
        };

        costsData = {
          summary: {
            period,
            totalTrips,
            totalRevenue: totalRevenue.toFixed(2),
            totalOperationalCosts: totalOperationalCosts.toFixed(4),
            totalNetRevenue: (totalRevenue - totalOperationalCosts).toFixed(2),
            avgCostPerTrip: totalTrips > 0 ? (totalOperationalCosts / totalTrips).toFixed(4) : '0.0000',
            avgRevenuePerTrip: totalTrips > 0 ? (totalRevenue / totalTrips).toFixed(2) : '0.00',
            avgProfitMargin: totalRevenue > 0 ? (((totalRevenue - totalOperationalCosts) / totalRevenue) * 100).toFixed(2) + '%' : '0%',
            avgCostPerKm: totalDistance > 0 ? (totalOperationalCosts / totalDistance).toFixed(4) : '0.0000',
            avgCostPerMinute: totalDuration > 0 ? (totalOperationalCosts / totalDuration).toFixed(4) : '0.0000'
          },
          breakdown: {
            ...costBreakdown,
            percentages: {
              apiCosts: totalOperationalCosts > 0 ? ((costBreakdown.apiCosts.total / totalOperationalCosts) * 100).toFixed(1) + '%' : '0%',
              infraCosts: totalOperationalCosts > 0 ? ((costBreakdown.infraCosts.total / totalOperationalCosts) * 100).toFixed(1) + '%' : '0%',
              processingCosts: totalOperationalCosts > 0 ? ((costBreakdown.processingCosts.payment / totalOperationalCosts) * 100).toFixed(1) + '%' : '0%',
              communicationCosts: totalOperationalCosts > 0 ? ((costBreakdown.communicationCosts.total / totalOperationalCosts) * 100).toFixed(1) + '%' : '0%'
            }
          },
          trips: detailed === 'true' ? tripsWithCosts : tripsWithCosts.slice(0, 10)
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao calcular custos operacionais:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      tripId: tripId || 'all',
      detailed: detailed === 'true',
      generatedAt: new Date().toISOString(),
      data: costsData
    });
  } catch (error) {
    logError(error, 'Erro ao buscar custos operacionais:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💲 Cost Optimization Insights
router.get('/api/costs/insights', async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    let insights = {
      trends: {},
      optimization: {},
      recommendations: []
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar dados históricos para análise de tendências
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
        }

        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};

        const completedTrips = Object.keys(bookings)
          .filter(id => {
            const booking = bookings[id];
            const tripDate = new Date(booking.tripdate);
            return tripDate >= startDate &&
              (booking.status === 'COMPLETE' || booking.status === 'PAID');
          })
          .map(id => ({
            id,
            ...bookings[id],
            costs: calculateTripCosts(bookings[id],
              parseFloat(bookings[id].distance || 0),
              parseFloat(bookings[id].duration || 0)
            )
          }));

        // Análise de tendências
        const dailyCosts = {};
        completedTrips.forEach(trip => {
          const date = new Date(trip.tripdate).toISOString().split('T')[0];
          if (!dailyCosts[date]) {
            dailyCosts[date] = { trips: 0, totalCosts: 0, totalRevenue: 0 };
          }
          dailyCosts[date].trips += 1;
          dailyCosts[date].totalCosts += trip.costs.totalOperationalCosts;
          dailyCosts[date].totalRevenue += parseFloat(trip.estimate || 0);
        });

        // Identificar otimizações
        const highCostTrips = completedTrips
          .filter(trip => trip.costs.totalOperationalCosts > 0.50) // Corridas com custo > R$ 0.50
          .sort((a, b) => b.costs.totalOperationalCosts - a.costs.totalOperationalCosts)
          .slice(0, 10);

        const costByDistance = completedTrips
          .filter(trip => parseFloat(trip.distance || 0) > 0)
          .map(trip => ({
            distance: parseFloat(trip.distance),
            costPerKm: trip.costs.totalOperationalCosts / parseFloat(trip.distance),
            id: trip.id
          }))
          .sort((a, b) => b.costPerKm - a.costPerKm);

        // Gerar recomendações
        const recommendations = [];

        if (highCostTrips.length > 0) {
          recommendations.push({
            type: 'cost_reduction',
            priority: 'high',
            title: 'Otimizar corridas de alto custo',
            description: `${highCostTrips.length} corridas com custo operacional acima de R$ 0.50`,
            impact: 'Redução potencial de 15-25% nos custos',
            action: 'Revisar rotas e otimizar chamadas de API'
          });
        }

        if (costByDistance.length > 0 && costByDistance[0].costPerKm > 0.08) {
          recommendations.push({
            type: 'efficiency',
            priority: 'medium',
            title: 'Melhorar eficiência por quilômetro',
            description: `Custo médio por km está em R$ ${costByDistance[0].costPerKm.toFixed(4)}`,
            impact: 'Economia de R$ 0.01-0.03 por km',
            action: 'Implementar cache de rotas e geocoding'
          });
        }

        const avgApiCostPerTrip = completedTrips.length > 0 ?
          completedTrips.reduce((sum, trip) => sum + trip.costs.totalApiCosts, 0) / completedTrips.length : 0;

        if (avgApiCostPerTrip > 0.15) {
          recommendations.push({
            type: 'api_optimization',
            priority: 'high',
            title: 'Reduzir custos de APIs',
            description: `Custo médio de APIs por corrida: R$ ${avgApiCostPerTrip.toFixed(4)}`,
            impact: 'Redução de 20-40% nos custos de API',
            action: 'Implementar cache inteligente e otimizar consultas'
          });
        }

        insights = {
          trends: {
            dailyCosts: Object.keys(dailyCosts).sort().map(date => ({
              date,
              trips: dailyCosts[date].trips,
              avgCostPerTrip: dailyCosts[date].trips > 0 ?
                (dailyCosts[date].totalCosts / dailyCosts[date].trips).toFixed(4) : '0.0000',
              totalCosts: dailyCosts[date].totalCosts.toFixed(4),
              totalRevenue: dailyCosts[date].totalRevenue.toFixed(2),
              profitMargin: dailyCosts[date].totalRevenue > 0 ?
                (((dailyCosts[date].totalRevenue - dailyCosts[date].totalCosts) / dailyCosts[date].totalRevenue) * 100).toFixed(2) + '%' : '0%'
            })),
            costTrend: calculateCostTrend(dailyCosts),
            avgCostPerTrip: completedTrips.length > 0 ?
              (completedTrips.reduce((sum, trip) => sum + trip.costs.totalOperationalCosts, 0) / completedTrips.length).toFixed(4) : '0.0000'
          },
          optimization: {
            highCostTrips: highCostTrips.map(trip => ({
              tripId: trip.id,
              date: trip.tripdate,
              distance: trip.distance,
              operationalCost: trip.costs.totalOperationalCosts.toFixed(4),
              costPerKm: parseFloat(trip.distance) > 0 ?
                (trip.costs.totalOperationalCosts / parseFloat(trip.distance)).toFixed(4) : '0.0000',
              mainCostDriver: identifyMainCostDriver(trip.costs)
            })),
            costEfficiencyByDistance: costByDistance.slice(0, 5),
            potentialSavings: calculatePotentialSavings(completedTrips)
          },
          recommendations
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar insights de custos:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      generatedAt: new Date().toISOString(),
      insights
    });
  } catch (error) {
    logError(error, 'Erro ao gerar insights de custos:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Funções auxiliares para cálculos de custos
function calculateTripCosts(booking, distance, duration) {
  // Custos baseados em tarifas reais do mercado (valores em reais)

  // APIs Google (por requisição)
  const mapsApiCost = 0.0020; // R$ 0.002 por request
  const geocodingCost = 0.0050; // R$ 0.005 por geocoding
  const directionsCost = 0.0050; // R$ 0.005 por direction
  const placesCost = 0.0017; // R$ 0.0017 por place search

  // Infraestrutura (por corrida)
  const serverCost = 0.0030; // R$ 0.003 por processamento
  const firebaseCost = 0.0015; // R$ 0.0015 por operações DB
  const redisCost = 0.0005; // R$ 0.0005 por cache operations

  // Processamento de pagamento (% da transação)
  const paymentProcessingRate = 0.039; // 3.9% + R$ 0.39
  const paymentFixedFee = 0.39;
  const fare = parseFloat(booking.estimate || 0);
  const paymentCost = (fare * paymentProcessingRate) + paymentFixedFee;

  // Comunicação
  const fcmCost = 0.0000; // FCM é gratuito até certo limite
  const smsCost = 0.10; // R$ 0.10 por SMS (se usado)

  // Calcular custos por corrida
  const costs = {
    // APIs (chamadas típicas por corrida)
    mapsApi: mapsApiCost * 2, // 2 chamadas por corrida
    geocoding: geocodingCost * 2, // origem e destino
    directionsApi: directionsCost * 1, // 1 rota
    placesApi: placesCost * 1, // busca de lugares

    // Infraestrutura
    serverCosts: serverCost,
    firebaseCosts: firebaseCost * 3, // 3 operações médias
    redisCosts: redisCost * 2, // 2 operações cache

    // Processamento
    paymentProcessing: fare > 0 ? paymentCost : 0,

    // Comunicação
    fcmNotifications: fcmCost * 4, // 4 notificações por corrida
    smsNotifications: booking.smsUsed ? smsCost : 0
  };

  // Totais por categoria
  costs.totalApiCosts = costs.mapsApi + costs.geocoding + costs.directionsApi + costs.placesApi;
  costs.totalInfraCosts = costs.serverCosts + costs.firebaseCosts + costs.redisCosts;
  costs.totalCommCosts = costs.fcmNotifications + costs.smsNotifications;
  costs.totalOperationalCosts = costs.totalApiCosts + costs.totalInfraCosts + costs.paymentProcessing + costs.totalCommCosts;

  return costs;
}

function calculateCostTrend(dailyCosts) {
  const dates = Object.keys(dailyCosts).sort();
  if (dates.length < 2) return '0%';

  const firstDayCost = dailyCosts[dates[0]].totalCosts / dailyCosts[dates[0]].trips;
  const lastDayCost = dailyCosts[dates[dates.length - 1]].totalCosts / dailyCosts[dates[dates.length - 1]].trips;

  if (firstDayCost === 0) return '0%';

  const trend = ((lastDayCost - firstDayCost) / firstDayCost) * 100;
  return trend > 0 ? `+${trend.toFixed(2)}%` : `${trend.toFixed(2)}%`;
}

function identifyMainCostDriver(costs) {
  const costCategories = {
    'APIs': costs.totalApiCosts,
    'Infraestrutura': costs.totalInfraCosts,
    'Pagamento': costs.paymentProcessing,
    'Comunicação': costs.totalCommCosts
  };

  let maxCategory = 'APIs';
  let maxCost = costCategories.APIs;

  Object.keys(costCategories).forEach(category => {
    if (costCategories[category] > maxCost) {
      maxCategory = category;
      maxCost = costCategories[category];
    }
  });

  return maxCategory;
}

function calculatePotentialSavings(trips) {
  const totalCosts = trips.reduce((sum, trip) => sum + trip.costs.totalOperationalCosts, 0);

  // Estimativas de economia por otimização
  const savings = {
    apiCaching: totalCosts * 0.25, // 25% economia com cache
    routeOptimization: totalCosts * 0.15, // 15% com otimização de rotas
    batchProcessing: totalCosts * 0.10, // 10% com batch de operações
    total: totalCosts * 0.50 // 50% economia total possível
  };

  return {
    current: totalCosts.toFixed(4),
    apiCaching: savings.apiCaching.toFixed(4),
    routeOptimization: savings.routeOptimization.toFixed(4),
    batchProcessing: savings.batchProcessing.toFixed(4),
    totalPotential: savings.total.toFixed(4),
    savingsPercentage: '50%'
  };
}

// 🔧 Service Monitoring - MONITORAMENTO INDIVIDUAL DE SERVIÇOS
router.get('/api/monitoring/services', authenticateJWT, requireRole(DASHBOARD_MONITORING_ROLES), async (req, res) => {
  try {
    const { service, timeframe = '1h' } = req.query;

    let monitoring = {
      overview: {},
      services: {},
      alerts: []
    };

    // Monitorar Redis
    const redisStatus = await monitorRedisService();

    // Monitorar Firebase
    const firebaseStatus = await monitorFirebaseService();

    // Monitorar APIs Google
    const googleApisStatus = await monitorGoogleApis();

    // Monitorar Sistema
    const systemStatus = await monitorSystemResources();

    // Monitorar WebSocket
    const websocketStatus = await monitorWebSocketConnections();

    monitoring = {
      overview: {
        timestamp: new Date().toISOString(),
        overallStatus: calculateOverallStatus([
          redisStatus, firebaseStatus, googleApisStatus,
          systemStatus, websocketStatus
        ]),
        servicesUp: countServicesUp([
          redisStatus, firebaseStatus, googleApisStatus,
          systemStatus, websocketStatus
        ]),
        totalServices: 5,
        alertsCount: 0
      },
      services: {
        redis: redisStatus,
        firebase: firebaseStatus,
        googleApis: googleApisStatus,
        system: systemStatus,
        websocket: websocketStatus
      },
      alerts: generateServiceAlerts([
        redisStatus, firebaseStatus, googleApisStatus,
        systemStatus, websocketStatus
      ])
    };

    // Filtrar por serviço específico se solicitado
    if (service) {
      const serviceData = monitoring.services[service];
      if (serviceData) {
        res.json({
          service,
          timeframe,
          generatedAt: new Date().toISOString(),
          data: serviceData,
          alerts: monitoring.alerts.filter(alert => alert.service === service)
        });
      } else {
        res.status(404).json({ error: 'Serviço não encontrado' });
      }
    } else {
      res.json({
        timeframe,
        generatedAt: new Date().toISOString(),
        monitoring
      });
    }
  } catch (error) {
    logError(error, 'Erro ao monitorar serviços:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🔧 Service Health Check
router.get('/api/monitoring/health', authenticateJWT, requireRole(DASHBOARD_MONITORING_ROLES), async (req, res) => {
  try {
    const healthChecks = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      checks: {}
    };

    // Health check rápido para cada serviço
    try {
      // Redis health check
      const redisClient = redisPool.getConnection();
      await redisClient.ping();
      healthChecks.checks.redis = { status: 'healthy', responseTime: Date.now() };
    } catch (error) {
      healthChecks.checks.redis = { status: 'unhealthy', error: error.message };
      healthChecks.status = 'degraded';
    }

    // Firebase health check
    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();
        const startTime = Date.now();
        await db.ref('.info/connected').once('value');
        healthChecks.checks.firebase = {
          status: 'healthy',
          responseTime: Date.now() - startTime + 'ms'
        };
      } else {
        healthChecks.checks.firebase = { status: 'unavailable' };
      }
    } catch (error) {
      healthChecks.checks.firebase = { status: 'unhealthy', error: error.message };
      healthChecks.status = 'degraded';
    }

    // Sistema health check
    const os = require('os');
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;

    healthChecks.checks.system = {
      status: memoryUsage < 85 ? 'healthy' : 'warning',
      memory: {
        usage: memoryUsage.toFixed(2) + '%',
        free: (freeMem / 1024 / 1024 / 1024).toFixed(2) + 'GB',
        total: (totalMem / 1024 / 1024 / 1024).toFixed(2) + 'GB'
      },
      cpu: {
        loadAvg: os.loadavg().map(load => load.toFixed(2))
      }
    };

    if (memoryUsage > 85) {
      healthChecks.status = 'warning';
    }

    // WebSocket health check
    const websocketConnections = global.io ? global.io.engine.clientsCount : 0;
    healthChecks.checks.websocket = {
      status: 'healthy',
      connections: websocketConnections,
      maxConnections: 1000
    };

    res.json(healthChecks);
  } catch (error) {
    logError(error, 'Erro no health check:', { service: 'dashboard-routes' });
    res.status(500).json({
      timestamp: new Date().toISOString(),
      status: 'unhealthy',
      error: error.message
    });
  }
});

// 🔧 Service Performance Metrics
router.get('/api/monitoring/performance', authenticateJWT, requireRole(DASHBOARD_MONITORING_ROLES), async (req, res) => {
  try {
    const { period = '1h' } = req.query;

    let performance = {
      summary: {},
      metrics: {},
      trends: []
    };

    // Calcular período
    const now = new Date();
    let startDate = new Date();

    switch (period) {
      case '1h':
        startDate.setHours(now.getHours() - 1);
        break;
      case '24h':
        startDate.setDate(now.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
    }

    // Métricas de performance (simuladas - em produção viriam de monitoramento real)
    const performanceData = await collectPerformanceMetrics(startDate, now);

    performance = {
      summary: {
        period,
        avgResponseTime: performanceData.avgResponseTime,
        totalRequests: performanceData.totalRequests,
        errorRate: performanceData.errorRate,
        uptime: performanceData.uptime
      },
      metrics: {
        redis: {
          avgResponseTime: '2.3ms',
          operationsPerSecond: 1250,
          memoryUsage: '45.2MB',
          hitRate: '94.5%',
          connections: 12
        },
        firebase: {
          avgResponseTime: '89ms',
          readsPerMinute: 156,
          writesPerMinute: 34,
          bandwidth: '2.1MB/min',
          concurrentConnections: 23
        },
        googleApis: {
          mapsApi: {
            avgResponseTime: '145ms',
            requestsPerDay: 1234,
            quotaUsed: '12.3%',
            errorRate: '0.02%'
          },
          geocoding: {
            avgResponseTime: '98ms',
            requestsPerDay: 567,
            quotaUsed: '5.67%',
            errorRate: '0.01%'
          }
        },
        system: {
          cpu: {
            usage: '23.4%',
            loadAvg: [0.45, 0.52, 0.48]
          },
          memory: {
            usage: '67.8%',
            available: '2.1GB'
          },
          disk: {
            usage: '34.2%',
            iops: 145
          },
          network: {
            bytesIn: '1.2MB/min',
            bytesOut: '2.8MB/min'
          }
        }
      },
      trends: generatePerformanceTrends(period)
    };

    res.json({
      period,
      generatedAt: new Date().toISOString(),
      performance
    });
  } catch (error) {
    logError(error, 'Erro ao buscar métricas de performance:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Funções auxiliares para monitoramento
async function monitorRedisService() {
  try {
    const redisClient = redisPool.getConnection();
    const startTime = Date.now();
    const info = await redisClient.info();
    const ping = await redisClient.ping();
    const responseTime = Date.now() - startTime;

    return {
      name: 'Redis',
      status: ping === 'PONG' ? 'healthy' : 'unhealthy',
      responseTime: responseTime + 'ms',
      version: extractRedisVersion(info),
      connections: extractRedisConnections(info),
      memory: extractRedisMemory(info),
      uptime: extractRedisUptime(info),
      lastCheck: new Date().toISOString()
    };
  } catch (error) {
    return {
      name: 'Redis',
      status: 'unhealthy',
      error: error.message,
      lastCheck: new Date().toISOString()
    };
  }
}

async function monitorFirebaseService() {
  try {
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return {
        name: 'Firebase',
        status: 'unavailable',
        error: 'Firebase não configurado',
        lastCheck: new Date().toISOString()
      };
    }

    const db = firebaseConfig.getRealtimeDB();
    const startTime = Date.now();

    // Teste de conexão simples
    await db.ref('.info/connected').once('value');
    const responseTime = Date.now() - startTime;

    return {
      name: 'Firebase Realtime Database',
      status: 'healthy',
      responseTime: responseTime + 'ms',
      region: 'us-central1',
      lastCheck: new Date().toISOString()
    };
  } catch (error) {
    return {
      name: 'Firebase',
      status: 'unhealthy',
      error: error.message,
      lastCheck: new Date().toISOString()
    };
  }
}

async function monitorGoogleApis() {
  // Simulação de monitoramento das APIs Google
  // Em produção, isso faria verificações reais das quotas e status
  return {
    name: 'Google APIs',
    status: 'healthy',
    apis: {
      maps: { status: 'healthy', quota: '12.3%', requests24h: 1234 },
      geocoding: { status: 'healthy', quota: '5.67%', requests24h: 567 },
      directions: { status: 'healthy', quota: '8.9%', requests24h: 890 },
      places: { status: 'healthy', quota: '3.4%', requests24h: 234 }
    },
    lastCheck: new Date().toISOString()
  };
}

async function monitorSystemResources() {
  const os = require('os');

  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;
  const cpuLoad = os.loadavg()[0];

  let status = 'healthy';
  if (memoryUsage > 85 || cpuLoad > 2.0) {
    status = 'warning';
  }
  if (memoryUsage > 95 || cpuLoad > 4.0) {
    status = 'critical';
  }

  return {
    name: 'System Resources',
    status,
    memory: {
      usage: memoryUsage.toFixed(2) + '%',
      free: (freeMem / 1024 / 1024 / 1024).toFixed(2) + 'GB',
      total: (totalMem / 1024 / 1024 / 1024).toFixed(2) + 'GB'
    },
    cpu: {
      loadAvg: os.loadavg().map(load => load.toFixed(2)),
      cores: os.cpus().length
    },
    uptime: formatUptime(os.uptime()),
    platform: os.platform(),
    lastCheck: new Date().toISOString()
  };
}

async function monitorWebSocketConnections() {
  const connections = global.io ? global.io.engine.clientsCount : 0;
  const maxConnections = 1000;
  const usage = (connections / maxConnections) * 100;

  let status = 'healthy';
  if (usage > 80) status = 'warning';
  if (usage > 95) status = 'critical';

  return {
    name: 'WebSocket Connections',
    status,
    connections: {
      current: connections,
      max: maxConnections,
      usage: usage.toFixed(1) + '%'
    },
    lastCheck: new Date().toISOString()
  };
}

function calculateOverallStatus(services) {
  const statuses = services.map(service => service.status);

  if (statuses.some(status => status === 'unhealthy' || status === 'critical')) {
    return 'unhealthy';
  }
  if (statuses.some(status => status === 'warning' || status === 'degraded')) {
    return 'warning';
  }
  return 'healthy';
}

function countServicesUp(services) {
  return services.filter(service =>
    service.status === 'healthy' || service.status === 'warning'
  ).length;
}

function generateServiceAlerts(services) {
  const alerts = [];
  const generatedAt = new Date().toISOString();

  services.forEach(service => {
    if (service.status === 'unhealthy' || service.status === 'critical') {
      const normalizedService = service.name.toLowerCase().replace(/\s+/g, '_');
      alerts.push({
        id: `${normalizedService}-${generatedAt}`,
        service: normalizedService,
        severity: service.status === 'critical' ? 'critical' : 'warning',
        message: `${service.name} is ${service.status}`,
        details: service.error || 'Service health check failed',
        timestamp: generatedAt
      });
    }
  });

  return alerts;
}

async function collectPerformanceMetrics(startDate, endDate) {
  const totalMinutes = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
  const redis = redisPool.getConnection();
  let avgResponseTimeMs = 0;

  try {
    const pingStart = Date.now();
    await redis.ping();
    avgResponseTimeMs = Date.now() - pingStart;
  } catch (error) {
    avgResponseTimeMs = 0;
  }

  const currentConnections = global.io?.engine?.clientsCount || 0;
  const estimatedRequests = Math.max(totalMinutes, totalMinutes * Math.max(1, currentConnections));
  const cpuLoad = os.loadavg()[0];
  const cpuCores = Math.max(os.cpus().length, 1);
  const normalizedCpu = Math.min(1, cpuLoad / cpuCores);
  const estimatedErrorRate = Number((normalizedCpu * 0.5).toFixed(3));

  const processUptimePercent = Math.min(100, Math.max(0, (process.uptime() / (process.uptime() + 60)) * 100));
  return {
    avgResponseTime: `${avgResponseTimeMs}ms`,
    totalRequests: estimatedRequests,
    errorRate: `${estimatedErrorRate}%`,
    uptime: `${processUptimePercent.toFixed(2)}%`
  };
}

function generatePerformanceTrends(period) {
  const trends = [];
  const now = new Date();
  const currentConnections = global.io?.engine?.clientsCount || 0;
  const load = os.loadavg()[0];
  const cores = Math.max(os.cpus().length, 1);
  const normalizedCpu = Math.min(1, load / cores);
  const baseResponseTime = Math.max(20, Math.round(40 + normalizedCpu * 140));
  const baseRequestsPerMinute = Math.max(1, currentConnections * 2);
  const baseErrorRate = Number((normalizedCpu * 0.5).toFixed(3));

  for (let i = 0; i < 10; i++) {
    const time = new Date(now - i * 360000); // 6 minutos atrás
    const trendFactor = (9 - i) / 9;
    trends.unshift({
      timestamp: time.toISOString(),
      responseTime: Math.round(baseResponseTime * (0.9 + (trendFactor * 0.2))),
      requestsPerMinute: Math.round(baseRequestsPerMinute * (0.8 + (trendFactor * 0.4))),
      errorRate: Number((baseErrorRate * (0.8 + (trendFactor * 0.4))).toFixed(3))
    });
  }

  return trends;
}

// Funções auxiliares para parsear info do Redis
function extractRedisStatValue(info, field) {
  const regex = new RegExp(`${field}:(\\d+)`);
  const match = info.match(regex);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function extractRedisVersion(info) {
  const match = info.match(/redis_version:([^\r\n]+)/);
  return match ? match[1] : 'unknown';
}

function extractRedisConnections(info) {
  const match = info.match(/connected_clients:(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function extractRedisMemory(info) {
  const match = info.match(/used_memory_human:([^\r\n]+)/);
  return match ? match[1] : 'unknown';
}

function extractRedisMemoryInMb(info) {
  const usedMemoryBytes = extractRedisStatValue(info, 'used_memory');
  return usedMemoryBytes > 0 ? usedMemoryBytes / (1024 * 1024) : 0;
}

function extractRedisUptime(info) {
  const match = info.match(/uptime_in_seconds:(\d+)/);
  if (match) {
    const seconds = parseInt(match[1]);
    return formatUptime(seconds);
  }
  return 'unknown';
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

// 📊 Growth Analytics - ANALYTICS DE CRESCIMENTO COM PERCENTUAIS E TENDÊNCIAS
router.get('/api/analytics/growth', async (req, res) => {
  try {
    const {
      period = '30d', // '7d', '30d', '90d', '1y'
      metric = 'all' // 'users', 'revenue', 'trips', 'drivers', 'all'
    } = req.query;

    let growthAnalytics = {
      summary: {},
      growth: {},
      trends: {},
      forecasts: {}
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Calcular períodos
        const now = new Date();
        let startDate = new Date();
        let compareStartDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            compareStartDate.setDate(now.getDate() - 14);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            compareStartDate.setDate(now.getDate() - 60);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            compareStartDate.setDate(now.getDate() - 180);
            break;
          case '1y':
            startDate.setFullYear(now.getFullYear() - 1);
            compareStartDate.setFullYear(now.getFullYear() - 2);
            break;
        }

        // Buscar dados
        const [usersSnapshot, bookingsSnapshot] = await Promise.all([
          db.ref('users').once('value'),
          db.ref('bookings').once('value')
        ]);

        const users = usersSnapshot.val() || {};
        const bookings = bookingsSnapshot.val() || {};

        // Análise de crescimento de usuários
        const userGrowth = analyzeUserGrowth(users, startDate, now, compareStartDate);

        // Análise de crescimento de receita
        const revenueGrowth = analyzeRevenueGrowth(bookings, startDate, now, compareStartDate);

        // Análise de crescimento de corridas
        const tripGrowth = analyzeTripGrowth(bookings, startDate, now, compareStartDate);

        // Análise de crescimento de motoristas
        const driverGrowth = analyzeDriverGrowth(users, startDate, now, compareStartDate);

        // Tendências por período
        const trends = generateGrowthTrends(users, bookings, startDate, now, period);

        // Previsões
        const forecasts = generateGrowthForecasts(trends, period);

        growthAnalytics = {
          summary: {
            period,
            totalUsers: Object.keys(users).length,
            totalDrivers: Object.values(users).filter(u => u.usertype === 'driver').length,
            totalCustomers: Object.values(users).filter(u => u.usertype === 'customer').length,
            totalTrips: Object.keys(bookings).length,
            totalRevenue: Object.values(bookings)
              .filter(b => b.status === 'COMPLETE' || b.status === 'PAID')
              .reduce((sum, b) => sum + parseFloat(b.estimate || 0), 0).toFixed(2),
            generatedAt: new Date().toISOString()
          },
          growth: {
            users: userGrowth,
            revenue: revenueGrowth,
            trips: tripGrowth,
            drivers: driverGrowth
          },
          trends,
          forecasts
        };

        // Filtrar por métrica específica se solicitado
        if (metric !== 'all') {
          const filteredGrowth = {};
          filteredGrowth[metric] = growthAnalytics.growth[metric];
          growthAnalytics.growth = filteredGrowth;
        }
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar analytics de crescimento:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      metric,
      generatedAt: new Date().toISOString(),
      analytics: growthAnalytics
    });
  } catch (error) {
    logError(error, 'Erro ao gerar analytics de crescimento:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 Growth Insights & Recommendations
router.get('/api/analytics/growth/insights', async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    let insights = {
      keyInsights: [],
      recommendations: [],
      alerts: [],
      opportunities: []
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
        }

        const [usersSnapshot, bookingsSnapshot] = await Promise.all([
          db.ref('users').once('value'),
          db.ref('bookings').once('value')
        ]);

        const users = usersSnapshot.val() || {};
        const bookings = bookingsSnapshot.val() || {};

        // Análise de insights
        insights = generateGrowthInsights(users, bookings, startDate, now, period);
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar insights de crescimento:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      generatedAt: new Date().toISOString(),
      insights
    });
  } catch (error) {
    logError(error, 'Erro ao gerar insights de crescimento:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 Growth Cohort Analysis
router.get('/api/analytics/growth/cohorts', async (req, res) => {
  try {
    const {
      cohortType = 'monthly', // 'weekly', 'monthly'
      metric = 'retention' // 'retention', 'revenue'
    } = req.query;

    let cohortAnalysis = {
      cohorts: [],
      summary: {},
      insights: []
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        const [usersSnapshot, bookingsSnapshot] = await Promise.all([
          db.ref('users').once('value'),
          db.ref('bookings').once('value')
        ]);

        const users = usersSnapshot.val() || {};
        const bookings = bookingsSnapshot.val() || {};

        cohortAnalysis = generateCohortAnalysis(users, bookings, cohortType, metric);
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar análise de coorte:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      cohortType,
      metric,
      generatedAt: new Date().toISOString(),
      analysis: cohortAnalysis
    });
  } catch (error) {
    logError(error, 'Erro ao gerar análise de coorte:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Funções auxiliares para analytics de crescimento
function analyzeUserGrowth(users, startDate, endDate, compareStartDate) {
  const currentPeriodUsers = Object.values(users).filter(user => {
    if (!user.createdAt) return false;
    const createdDate = new Date(user.createdAt);
    return createdDate >= startDate && createdDate <= endDate;
  });

  const previousPeriodUsers = Object.values(users).filter(user => {
    if (!user.createdAt) return false;
    const createdDate = new Date(user.createdAt);
    return createdDate >= compareStartDate && createdDate < startDate;
  });

  const currentCount = currentPeriodUsers.length;
  const previousCount = previousPeriodUsers.length;
  const growthRate = previousCount > 0 ?
    ((currentCount - previousCount) / previousCount * 100).toFixed(2) : '0.00';

  return {
    current: currentCount,
    previous: previousCount,
    growthRate: growthRate + '%',
    trend: parseFloat(growthRate) > 0 ? 'up' : parseFloat(growthRate) < 0 ? 'down' : 'stable',
    daily: generateDailyGrowth(currentPeriodUsers, startDate, endDate),
    byType: {
      customers: currentPeriodUsers.filter(u => u.usertype === 'customer').length,
      drivers: currentPeriodUsers.filter(u => u.usertype === 'driver').length
    }
  };
}

function analyzeRevenueGrowth(bookings, startDate, endDate, compareStartDate) {
  const currentPeriodBookings = Object.values(bookings).filter(booking => {
    if (!booking.tripdate) return false;
    const tripDate = new Date(booking.tripdate);
    return tripDate >= startDate && tripDate <= endDate &&
      (booking.status === 'COMPLETE' || booking.status === 'PAID');
  });

  const previousPeriodBookings = Object.values(bookings).filter(booking => {
    if (!booking.tripdate) return false;
    const tripDate = new Date(booking.tripdate);
    return tripDate >= compareStartDate && tripDate < startDate &&
      (booking.status === 'COMPLETE' || booking.status === 'PAID');
  });

  const currentRevenue = currentPeriodBookings.reduce((sum, b) =>
    sum + parseFloat(b.estimate || 0), 0
  );
  const previousRevenue = previousPeriodBookings.reduce((sum, b) =>
    sum + parseFloat(b.estimate || 0), 0
  );

  const growthRate = previousRevenue > 0 ?
    ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(2) : '0.00';

  return {
    current: currentRevenue.toFixed(2),
    previous: previousRevenue.toFixed(2),
    growthRate: growthRate + '%',
    trend: parseFloat(growthRate) > 0 ? 'up' : parseFloat(growthRate) < 0 ? 'down' : 'stable',
    avgRevenuePerTrip: currentPeriodBookings.length > 0 ?
      (currentRevenue / currentPeriodBookings.length).toFixed(2) : '0.00',
    daily: generateDailyRevenueGrowth(currentPeriodBookings, startDate, endDate)
  };
}

function analyzeTripGrowth(bookings, startDate, endDate, compareStartDate) {
  const currentPeriodTrips = Object.values(bookings).filter(booking => {
    if (!booking.tripdate) return false;
    const tripDate = new Date(booking.tripdate);
    return tripDate >= startDate && tripDate <= endDate;
  });

  const previousPeriodTrips = Object.values(bookings).filter(booking => {
    if (!booking.tripdate) return false;
    const tripDate = new Date(booking.tripdate);
    return tripDate >= compareStartDate && tripDate < startDate;
  });

  const currentCount = currentPeriodTrips.length;
  const previousCount = previousPeriodTrips.length;
  const growthRate = previousCount > 0 ?
    ((currentCount - previousCount) / previousCount * 100).toFixed(2) : '0.00';

  const completedTrips = currentPeriodTrips.filter(t =>
    t.status === 'COMPLETE' || t.status === 'PAID'
  ).length;

  return {
    current: currentCount,
    previous: previousCount,
    growthRate: growthRate + '%',
    trend: parseFloat(growthRate) > 0 ? 'up' : parseFloat(growthRate) < 0 ? 'down' : 'stable',
    completionRate: currentCount > 0 ?
      ((completedTrips / currentCount) * 100).toFixed(2) + '%' : '0%',
    daily: generateDailyTripGrowth(currentPeriodTrips, startDate, endDate)
  };
}

function analyzeDriverGrowth(users, startDate, endDate, compareStartDate) {
  const drivers = Object.values(users).filter(u => u.usertype === 'driver');

  const currentPeriodDrivers = drivers.filter(driver => {
    if (!driver.createdAt) return false;
    const createdDate = new Date(driver.createdAt);
    return createdDate >= startDate && createdDate <= endDate;
  });

  const previousPeriodDrivers = drivers.filter(driver => {
    if (!driver.createdAt) return false;
    const createdDate = new Date(driver.createdAt);
    return createdDate >= compareStartDate && createdDate < startDate;
  });

  const currentCount = currentPeriodDrivers.length;
  const previousCount = previousPeriodDrivers.length;
  const growthRate = previousCount > 0 ?
    ((currentCount - previousCount) / previousCount * 100).toFixed(2) : '0.00';

  const approvedDrivers = currentPeriodDrivers.filter(d => d.approved === true).length;

  return {
    current: currentCount,
    previous: previousCount,
    growthRate: growthRate + '%',
    trend: parseFloat(growthRate) > 0 ? 'up' : parseFloat(growthRate) < 0 ? 'down' : 'stable',
    approvalRate: currentCount > 0 ?
      ((approvedDrivers / currentCount) * 100).toFixed(2) + '%' : '0%',
    totalActive: drivers.filter(d => d.approved === true).length
  };
}

function generateDailyGrowth(items, startDate, endDate) {
  const daily = {};
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    daily[dateStr] = 0;
    currentDate.setDate(currentDate.getDate() + 1);
  }

  items.forEach(item => {
    if (item.createdAt) {
      const dateStr = new Date(item.createdAt).toISOString().split('T')[0];
      if (daily.hasOwnProperty(dateStr)) {
        daily[dateStr] += 1;
      }
    }
  });

  return Object.keys(daily).sort().map(date => ({
    date,
    count: daily[date]
  }));
}

function generateDailyRevenueGrowth(bookings, startDate, endDate) {
  const daily = {};
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    daily[dateStr] = 0;
    currentDate.setDate(currentDate.getDate() + 1);
  }

  bookings.forEach(booking => {
    if (booking.tripdate) {
      const dateStr = new Date(booking.tripdate).toISOString().split('T')[0];
      if (daily.hasOwnProperty(dateStr)) {
        daily[dateStr] += parseFloat(booking.estimate || 0);
      }
    }
  });

  return Object.keys(daily).sort().map(date => ({
    date,
    revenue: daily[date].toFixed(2)
  }));
}

function generateDailyTripGrowth(bookings, startDate, endDate) {
  const daily = {};
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    daily[dateStr] = 0;
    currentDate.setDate(currentDate.getDate() + 1);
  }

  bookings.forEach(booking => {
    if (booking.tripdate) {
      const dateStr = new Date(booking.tripdate).toISOString().split('T')[0];
      if (daily.hasOwnProperty(dateStr)) {
        daily[dateStr] += 1;
      }
    }
  });

  return Object.keys(daily).sort().map(date => ({
    date,
    trips: daily[date]
  }));
}

function generateGrowthTrends(users, bookings, startDate, endDate, period) {
  return {
    userAcquisition: {
      rate: 'steady',
      pattern: 'weekday_peak',
      seasonality: 'moderate'
    },
    revenueGrowth: {
      rate: 'accelerating',
      pattern: 'weekend_peak',
      volatility: 'low'
    },
    marketPenetration: {
      saturation: '15%',
      potential: 'high',
      competition: 'moderate'
    }
  };
}

function generateGrowthForecasts(trends, period) {
  // Simplified forecasting - in production would use ML models
  return {
    nextPeriod: {
      users: '+25%',
      revenue: '+30%',
      trips: '+22%',
      confidence: '85%'
    },
    yearEnd: {
      users: '+150%',
      revenue: '+180%',
      trips: '+160%',
      confidence: '70%'
    }
  };
}

function generateGrowthInsights(users, bookings, startDate, endDate, period) {
  const insights = {
    keyInsights: [
      {
        type: 'user_growth',
        title: 'Crescimento acelerado de usuários',
        description: 'Taxa de crescimento 35% superior ao período anterior',
        impact: 'positive',
        confidence: 'high'
      },
      {
        type: 'revenue_trend',
        title: 'Receita por usuário aumentando',
        description: 'ARPU cresceu 12% comparado ao período anterior',
        impact: 'positive',
        confidence: 'medium'
      }
    ],
    recommendations: [
      {
        priority: 'high',
        category: 'marketing',
        title: 'Intensificar aquisição de motoristas',
        description: 'Demanda de passageiros está 20% acima da oferta de motoristas',
        expectedImpact: '+15% receita mensal',
        timeframe: '30 dias'
      },
      {
        priority: 'medium',
        category: 'retention',
        title: 'Programa de fidelidade para usuários ativos',
        description: 'Implementar sistema de recompensas para aumentar retenção',
        expectedImpact: '+8% retenção',
        timeframe: '60 dias'
      }
    ],
    alerts: [
      {
        severity: 'warning',
        type: 'churn_rate',
        message: 'Taxa de cancelamento de motoristas aumentou 5%',
        action: 'Investigar causas e implementar melhorias'
      }
    ],
    opportunities: [
      {
        type: 'expansion',
        title: 'Nova região metropolitana',
        description: 'Região X mostra alta demanda orgânica',
        potential: 'R$ 50k/mês adicional',
        investment: 'R$ 20k setup'
      }
    ]
  };

  return insights;
}

function generateCohortAnalysis(users, bookings, cohortType, metric) {
  // Simplified cohort analysis - in production would be more sophisticated
  return {
    cohorts: [
      {
        period: '2025-01',
        size: 120,
        week1: '85%',
        week2: '72%',
        week4: '58%',
        week8: '45%'
      }
    ],
    summary: {
      avgRetention: {
        week1: '82%',
        month1: '55%',
        month3: '35%'
      }
    },
    insights: [
      'Retenção na primeira semana está acima da média do setor',
      'Oportunidade de melhoria na retenção de longo prazo'
    ]
  };
}

// ==================== 🎁 GESTÃO DE PROMOÇÕES ====================

const promotionService = require('../services/promotion-service');
const { logger } = require('../utils/logger');

/**
 * Criar nova promoção
 * POST /api/promotions
 */
router.post('/api/promotions', async (req, res) => {
  try {
    const {
      name,
      description,
      type,
      benefit,
      eligibility,
      startDate,
      endDate,
      maxRedemptions,
      createdBy = 'admin'
    } = req.body;

    // Validação básica
    if (!name || !type || !benefit || !eligibility) {
      return res.status(400).json({
        error: 'Dados obrigatórios faltando',
        required: ['name', 'type', 'benefit', 'eligibility']
      });
    }

    const result = await promotionService.createPromotion({
      name,
      description,
      type,
      benefit,
      eligibility,
      startDate,
      endDate,
      maxRedemptions,
      createdBy
    });

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logger.error('❌ Erro ao criar promoção:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Listar todas as promoções
 * GET /api/promotions
 */
router.get('/api/promotions', async (req, res) => {
  try {
    const { status, type } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (type) filters.type = type;

    const result = await promotionService.listPromotions(filters);

    res.json(result);

  } catch (error) {
    logger.error('❌ Erro ao listar promoções:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Obter detalhes de uma promoção específica
 * GET /api/promotions/:promotionId
 */
router.get('/api/promotions/:promotionId', async (req, res, next) => {
  try {
    const { promotionId } = req.params;
    if (promotionId === 'stats') {
      return next('route');
    }
    const result = await promotionService.getPromotionById(promotionId);
    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Promoção não encontrada' });
    }

    res.json(result);

  } catch (error) {
    logger.error('❌ Erro ao buscar promoção:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Atualizar promoção
 * PATCH /api/promotions/:promotionId
 */
router.patch('/api/promotions/:promotionId', async (req, res) => {
  try {
    const { promotionId } = req.params;
    const updates = req.body;
    const result = await promotionService.updatePromotion(promotionId, updates);
    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Promoção não encontrada' });
    }

    logger.info(`✅ Promoção atualizada: ${promotionId}`);
    res.json({
      success: true,
      message: result.message || 'Promoção atualizada com sucesso',
      promotion: result.promotion
    });

  } catch (error) {
    logger.error('❌ Erro ao atualizar promoção:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Verificar elegibilidade de um motorista para uma promoção
 * GET /api/promotions/:promotionId/check-eligibility/:driverId
 */
router.get('/api/promotions/:promotionId/check-eligibility/:driverId', async (req, res) => {
  try {
    const { promotionId, driverId } = req.params;

    const result = await promotionService.checkEligibility(driverId, promotionId);

    res.json(result);

  } catch (error) {
    logger.error('❌ Erro ao verificar elegibilidade:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Aplicar promoção a um motorista (manual via dashboard)
 * POST /api/promotions/:promotionId/apply/:driverId
 */
router.post('/api/promotions/:promotionId/apply/:driverId', async (req, res) => {
  try {
    const { promotionId, driverId } = req.params;

    const result = await promotionService.applyPromotion(driverId, promotionId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    logger.error('❌ Erro ao aplicar promoção:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Verificar e aplicar promoções elegíveis para um motorista
 * POST /api/promotions/check-driver/:driverId
 */
router.post('/api/promotions/check-driver/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;

    const result = await promotionService.checkAndApplyEligiblePromotions(driverId);

    res.json(result);

  } catch (error) {
    logger.error('❌ Erro ao verificar promoções do motorista:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Estatísticas de promoções
 * GET /api/promotions/stats
 */
router.get('/api/promotions/stats', async (req, res) => {
  try {
    const result = await promotionService.getStats();
    res.json(result);

  } catch (error) {
    logger.error('❌ Erro ao buscar estatísticas de promoções:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// ==================== GESTÃO COMPLETA DE MOTORISTAS ====================

/**
 * Lista completa de motoristas com todas as informações de negócio
 * GET /api/drivers/complete
 * Query params: status, planType, approvalStatus, search, page, limit
 */
router.get('/api/drivers/complete', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const {
      status, // 'active', 'pending', 'suspended', 'expired'
      planType, // 'plus', 'elite', 'none'
      approvalStatus, // 'approved', 'pending', 'rejected'
      search,
      page = 1,
      limit = 50
    } = req.query;

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();
    const promotionService = require('../services/promotion-service');

    // Buscar todos os motoristas
    const usersSnapshot = await db.ref('users').orderByChild('usertype').equalTo('driver').once('value');
    const users = usersSnapshot.val() || {};

    // Buscar veículos
    const carsSnapshot = await db.ref('cars').once('value');
    const cars = carsSnapshot.val() || {};

    // Buscar corridas para estatísticas
    const bookingsSnapshot = await db.ref('bookings').once('value');
    const bookings = bookingsSnapshot.val() || {};

    const now = new Date();
    const drivers = [];

    for (const driverId of Object.keys(users)) {
      const driver = users[driverId];

      // Buscar veículo do motorista
      const driverCar = Object.values(cars).find(car => car.driver === driverId);

      // Calcular estatísticas de corridas
      const driverBookings = Object.values(bookings).filter(b => b.driver === driverId);
      const completedBookings = driverBookings.filter(b => b.status === 'COMPLETED');
      const totalEarnings = completedBookings.reduce((sum, b) => sum + parseFloat(b.fare || 0), 0);

      // Determinar plano
      let driverPlanType = 'none';
      let planName = 'Sem Plano';
      let weeklyFee = 0;

      if (driver.planType === 'elite') {
        driverPlanType = 'elite';
        planName = 'Leaf Elite';
        weeklyFee = 99.90;
      } else if (driver.planType === 'plus') {
        driverPlanType = 'plus';
        planName = 'Leaf Plus';
        weeklyFee = 49.90;
      }

      // Calcular período grátis
      const freeTrialEnd = driver.free_trial_end ? new Date(driver.free_trial_end) : null;
      const freeMonthsEnd = driver.free_months_end ? new Date(driver.free_months_end) : null;
      const promotionFreeEnd = driver.promotion_free_end ? new Date(driver.promotion_free_end) : null;

      let latestFreeEnd = null;
      let isFree = false;
      let freeReason = null;

      if (freeTrialEnd && freeTrialEnd > now) {
        latestFreeEnd = freeTrialEnd;
        isFree = true;
        freeReason = 'Free Trial';
      }
      if (freeMonthsEnd && freeMonthsEnd > now) {
        if (!latestFreeEnd || freeMonthsEnd > latestFreeEnd) {
          latestFreeEnd = freeMonthsEnd;
          isFree = true;
          freeReason = 'Meses Grátis (Indicação)';
        }
      }
      if (promotionFreeEnd && promotionFreeEnd > now) {
        if (!latestFreeEnd || promotionFreeEnd > latestFreeEnd) {
          latestFreeEnd = promotionFreeEnd;
          isFree = true;
          freeReason = 'Promoção Ativa';
        }
      }

      // Calcular próxima renovação
      let nextRenewal = null;
      let subscriptionStatus = 'none';
      let daysUntilRenewal = null;

      if (driverPlanType !== 'none') {
        if (isFree && latestFreeEnd) {
          nextRenewal = latestFreeEnd;
          subscriptionStatus = 'free';
          daysUntilRenewal = Math.ceil((latestFreeEnd - now) / (1000 * 60 * 60 * 24));
        } else {
          // Calcular próxima segunda-feira + 2 dias (quarta-feira)
          const currentDay = now.getDay();
          const daysUntilMonday = currentDay === 0 ? 1 : (8 - currentDay) % 7;
          const nextMonday = new Date(now);
          nextMonday.setDate(now.getDate() + daysUntilMonday);
          nextMonday.setHours(0, 0, 0, 0);

          nextRenewal = new Date(nextMonday);
          nextRenewal.setDate(nextMonday.getDate() + 2); // Quarta-feira

          daysUntilRenewal = Math.ceil((nextRenewal - now) / (1000 * 60 * 60 * 24));

          // Verificar status da assinatura
          const billingStatus = driver.billing_status || 'active';
          if (billingStatus === 'overdue') {
            subscriptionStatus = 'overdue';
          } else if (billingStatus === 'suspended') {
            subscriptionStatus = 'suspended';
          } else {
            subscriptionStatus = 'active';
          }
        }
      }

      // Status de aprovação
      const approvalStatus = driver.approved ? 'approved' : (driver.licenseImage ? 'pending' : 'not_submitted');

      // Status geral do motorista
      let driverStatus = 'active';
      if (!driver.approved) {
        driverStatus = 'pending';
      } else if (driver.suspended) {
        driverStatus = 'suspended';
      } else if (subscriptionStatus === 'suspended') {
        driverStatus = 'suspended';
      }

      const driverData = {
        id: driverId,
        // Informações básicas
        name: `${driver.firstName || ''} ${driver.lastName || ''}`.trim(),
        email: driver.email || '',
        phone: driver.mobile || '',
        profileImage: driver.profile_image || '',
        registrationDate: driver.createdAt ? new Date(driver.createdAt).toISOString() : null,
        lastActivity: driver.lastLogin ? new Date(driver.lastLogin).toISOString() : null,

        // Status de aprovação
        approvalStatus,
        approved: driver.approved || false,
        kycStatus: driver.kyc_status || 'pending',
        documents: {
          license: driver.licenseImage ? 'uploaded' : 'missing',
          vehicle: driverCar ? 'uploaded' : 'missing',
          verified: driver.approved || false
        },

        // Plano e assinatura
        plan: {
          type: driverPlanType,
          name: planName,
          weeklyFee,
          status: subscriptionStatus,
          isFree,
          freeReason,
          freeUntil: latestFreeEnd ? latestFreeEnd.toISOString() : null,
          nextRenewal: nextRenewal ? nextRenewal.toISOString() : null,
          daysUntilRenewal
        },

        // Veículo
        vehicle: driverCar ? {
          make: driverCar.carMake || '',
          model: driverCar.carModel || '',
          plate: driverCar.carNumber || '',
          color: driverCar.carColor || '',
          type: driverCar.carType || '',
          year: driverCar.carYear || ''
        } : null,

        // Estatísticas
        stats: {
          totalTrips: driverBookings.length,
          completedTrips: completedBookings.length,
          totalEarnings: totalEarnings.toFixed(2),
          averageRating: parseFloat(driver.driverRating || 0).toFixed(1),
          walletBalance: parseFloat(driver.walletBalance || 0).toFixed(2)
        },

        // Status online
        online: {
          isOnline: driver.driverActiveStatus || false,
          lastSeen: driver.lastLocationUpdate ? new Date(driver.lastLocationUpdate).toISOString() : null
        },

        // Status geral
        status: driverStatus,
        suspended: driver.suspended || false
      };

      // Aplicar filtros
      if (status && status !== 'all' && driverData.status !== status) continue;
      if (planType && planType !== 'all' && driverData.plan.type !== planType) continue;
      if (approvalStatus && approvalStatus !== 'all' && driverData.approvalStatus !== approvalStatus) continue;
      if (search) {
        const searchLower = search.toLowerCase();
        if (
          !driverData.name.toLowerCase().includes(searchLower) &&
          !driverData.email.toLowerCase().includes(searchLower) &&
          !driverData.phone.includes(search) &&
          !driverId.toLowerCase().includes(searchLower)
        ) continue;
      }

      drivers.push(driverData);
    }

    // Ordenar por data de registro (mais recente primeiro)
    drivers.sort((a, b) => {
      const dateA = a.registrationDate ? new Date(a.registrationDate) : new Date(0);
      const dateB = b.registrationDate ? new Date(b.registrationDate) : new Date(0);
      return dateB - dateA;
    });

    // Paginação
    const total = drivers.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedDrivers = drivers.slice(startIndex, endIndex);

    res.json({
      success: true,
      drivers: paginatedDrivers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('❌ Erro ao buscar lista completa de motoristas:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Detalhes completos de um motorista específico
 * GET /api/drivers/:driverId/complete
 */
router.get('/api/drivers/:driverId/complete', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();

    // Buscar motorista
    const driverSnapshot = await db.ref(`users/${driverId}`).once('value');
    const driver = driverSnapshot.val();

    if (!driver || driver.usertype !== 'driver') {
      return res.status(404).json({ error: 'Motorista não encontrado' });
    }

    // Buscar veículo
    const carsSnapshot = await db.ref('cars').once('value');
    const cars = carsSnapshot.val() || {};
    const driverCar = Object.values(cars).find(car => car.driver === driverId);

    // Buscar corridas
    const bookingsSnapshot = await db.ref('bookings').orderByChild('driver').equalTo(driverId).once('value');
    const bookings = bookingsSnapshot.val() || {};

    // Buscar histórico de pagamentos de assinatura
    const paymentsSnapshot = await db.ref('payments').orderByChild('driverId').equalTo(driverId).once('value');
    const payments = paymentsSnapshot.val() || {};

    // Calcular todas as informações
    const now = new Date();

    // Determinar plano
    let planType = 'none';
    let planName = 'Sem Plano';
    let weeklyFee = 0;

    if (driver.planType === 'elite') {
      planType = 'elite';
      planName = 'Leaf Elite';
      weeklyFee = 99.90;
    } else if (driver.planType === 'plus') {
      planType = 'plus';
      planName = 'Leaf Plus';
      weeklyFee = 49.90;
    }

    // Calcular período grátis
    const freeTrialEnd = driver.free_trial_end ? new Date(driver.free_trial_end) : null;
    const freeMonthsEnd = driver.free_months_end ? new Date(driver.free_months_end) : null;
    const promotionFreeEnd = driver.promotion_free_end ? new Date(driver.promotion_free_end) : null;

    let latestFreeEnd = null;
    let isFree = false;
    let freeReason = null;

    if (freeTrialEnd && freeTrialEnd > now) {
      latestFreeEnd = freeTrialEnd;
      isFree = true;
      freeReason = 'Free Trial';
    }
    if (freeMonthsEnd && freeMonthsEnd > now) {
      if (!latestFreeEnd || freeMonthsEnd > latestFreeEnd) {
        latestFreeEnd = freeMonthsEnd;
        isFree = true;
        freeReason = 'Meses Grátis (Indicação)';
      }
    }
    if (promotionFreeEnd && promotionFreeEnd > now) {
      if (!latestFreeEnd || promotionFreeEnd > latestFreeEnd) {
        latestFreeEnd = promotionFreeEnd;
        isFree = true;
        freeReason = 'Promoção Ativa';
      }
    }

    // Calcular próxima renovação
    let nextRenewal = null;
    let subscriptionStatus = 'none';
    let daysUntilRenewal = null;

    if (planType !== 'none') {
      if (isFree && latestFreeEnd) {
        nextRenewal = latestFreeEnd;
        subscriptionStatus = 'free';
        daysUntilRenewal = Math.ceil((latestFreeEnd - now) / (1000 * 60 * 60 * 24));
      } else {
        const currentDay = now.getDay();
        const daysUntilMonday = currentDay === 0 ? 1 : (8 - currentDay) % 7;
        const nextMonday = new Date(now);
        nextMonday.setDate(now.getDate() + daysUntilMonday);
        nextMonday.setHours(0, 0, 0, 0);

        nextRenewal = new Date(nextMonday);
        nextRenewal.setDate(nextMonday.getDate() + 2);

        daysUntilRenewal = Math.ceil((nextRenewal - now) / (1000 * 60 * 60 * 24));

        const billingStatus = driver.billing_status || 'active';
        if (billingStatus === 'overdue') {
          subscriptionStatus = 'overdue';
        } else if (billingStatus === 'suspended') {
          subscriptionStatus = 'suspended';
        } else {
          subscriptionStatus = 'active';
        }
      }
    }

    // Calcular estatísticas
    const driverBookings = Object.values(bookings);
    const completedBookings = driverBookings.filter(b => b.status === 'COMPLETED');
    const totalEarnings = completedBookings.reduce((sum, b) => sum + parseFloat(b.fare || 0), 0);

    // Histórico de pagamentos
    const subscriptionPayments = Object.values(payments)
      .filter(p => p.type === 'subscription')
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    const driverData = {
      id: driverId,
      // Informações básicas
      name: `${driver.firstName || ''} ${driver.lastName || ''}`.trim(),
      email: driver.email || '',
      phone: driver.mobile || '',
      profileImage: driver.profile_image || '',
      registrationDate: driver.createdAt ? new Date(driver.createdAt).toISOString() : null,
      lastActivity: driver.lastLogin ? new Date(driver.lastLogin).toISOString() : null,

      // Status de aprovação
      approvalStatus: driver.approved ? 'approved' : (driver.licenseImage ? 'pending' : 'not_submitted'),
      approved: driver.approved || false,
      approvedAt: driver.approvedAt || null,
      kycStatus: driver.kyc_status || 'pending',
      documents: {
        license: driver.licenseImage ? 'uploaded' : 'missing',
        licenseImage: driver.licenseImage || null,
        vehicle: driverCar ? 'uploaded' : 'missing',
        verified: driver.approved || false
      },

      // Plano e assinatura
      plan: {
        type: planType,
        name: planName,
        weeklyFee,
        status: subscriptionStatus,
        isFree,
        freeReason,
        freeUntil: latestFreeEnd ? latestFreeEnd.toISOString() : null,
        nextRenewal: nextRenewal ? nextRenewal.toISOString() : null,
        daysUntilRenewal,
        billingStatus: driver.billing_status || 'active'
      },

      // Veículo
      vehicle: driverCar ? {
        make: driverCar.carMake || '',
        model: driverCar.carModel || '',
        plate: driverCar.carNumber || '',
        color: driverCar.carColor || '',
        type: driverCar.carType || '',
        year: driverCar.carYear || '',
        image: driverCar.carImage || null
      } : null,

      // Estatísticas
      stats: {
        totalTrips: driverBookings.length,
        completedTrips: completedBookings.length,
        cancelledTrips: driverBookings.filter(b => b.status === 'CANCELED').length,
        totalEarnings: totalEarnings.toFixed(2),
        averageRating: parseFloat(driver.driverRating || 0).toFixed(1),
        walletBalance: parseFloat(driver.walletBalance || 0).toFixed(2),
        totalWithdrawals: 0 // TODO: calcular de histórico de saques
      },

      // Histórico de pagamentos
      paymentHistory: subscriptionPayments.map(p => ({
        id: p.id || '',
        amount: parseFloat(p.amount || 0).toFixed(2),
        status: p.status || 'pending',
        weekStart: p.weekStart || null,
        timestamp: p.timestamp || null,
        method: p.method || 'unknown'
      })),

      // Status online
      online: {
        isOnline: driver.driverActiveStatus || false,
        lastSeen: driver.lastLocationUpdate ? new Date(driver.lastLocationUpdate).toISOString() : null
      },

      // Status geral
      status: driver.suspended ? 'suspended' : (driver.approved ? 'active' : 'pending'),
      suspended: driver.suspended || false,
      suspendedAt: driver.suspendedAt || null,
      suspendReason: driver.suspendReason || null,
      suspendedUntil: driver.suspendedUntil || null
    };

    res.json({
      success: true,
      driver: driverData
    });

  } catch (error) {
    logger.error(`❌ Erro ao buscar detalhes do motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Atualizar plano do motorista
 * PATCH /api/drivers/:driverId/plan
 * Body: { planType: 'plus' | 'elite' | 'none' }
 */
router.patch('/api/drivers/:driverId/plan', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    const { planType } = req.body;

    if (!['plus', 'elite', 'none'].includes(planType)) {
      return res.status(400).json({ error: 'Tipo de plano inválido' });
    }

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();

    // Atualizar plano
    await db.ref(`users/${driverId}/planType`).set(planType);

    logger.info(`✅ Plano do motorista ${driverId} atualizado para ${planType}`);

    res.json({
      success: true,
      message: `Plano atualizado para ${planType}`,
      driverId,
      planType
    });

  } catch (error) {
    logger.error(`❌ Erro ao atualizar plano do motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Atualizar status de assinatura
 * PATCH /api/drivers/:driverId/subscription
 * Body: { status: 'active' | 'suspended' | 'cancelled', billing_status: 'active' | 'overdue' | 'suspended' }
 */
router.patch('/api/drivers/:driverId/subscription', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    const {
      status,
      billing_status,
      adminId = 'admin1',
      notes,
      planType,
      waveId,
      dailyFeeCents,
      dailyFeeOverrideCents,
      isFeeExempt,
      feeExemptUntil,
      collectionMode
    } = req.body || {};

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();
    const nowIso = new Date().toISOString();

    const subscriptionPatch = {};
    if (status) {
      subscriptionPatch.status = status;
    }
    if (billing_status) {
      subscriptionPatch.billingStatus = billing_status;
    }

    if (planType) {
      if (!['plus', 'elite', 'none'].includes(String(planType).toLowerCase())) {
        return res.status(400).json({ error: 'planType inválido (use plus, elite ou none)' });
      }
      subscriptionPatch.planType = String(planType).toLowerCase();
    }

    if (waveId !== undefined) {
      const normalizedWave = String(waveId || '').trim();
      subscriptionPatch.waveId = normalizedWave || null;
    }

    const requestedDailyFeeCents = dailyFeeOverrideCents !== undefined
      ? dailyFeeOverrideCents
      : dailyFeeCents;
    if (requestedDailyFeeCents !== undefined) {
      const parsedDailyFee = Number.parseInt(requestedDailyFeeCents, 10);
      if (!Number.isFinite(parsedDailyFee) || parsedDailyFee < 0) {
        return res.status(400).json({ error: 'dailyFeeCents inválido' });
      }
      subscriptionPatch.dailyFeeOverrideCents = parsedDailyFee;
      subscriptionPatch.dailyFeeCents = parsedDailyFee;
    }

    if (isFeeExempt !== undefined) {
      const parsedExempt = isFeeExempt === true || String(isFeeExempt).toLowerCase() === 'true';
      subscriptionPatch.isFeeExempt = parsedExempt;
    }

    if (feeExemptUntil !== undefined) {
      if (feeExemptUntil === null || String(feeExemptUntil).trim() === '') {
        subscriptionPatch.feeExemptUntil = null;
      } else {
        const parsedDate = new Date(feeExemptUntil);
        if (Number.isNaN(parsedDate.getTime())) {
          return res.status(400).json({ error: 'feeExemptUntil inválido (use ISO8601)' });
        }
        subscriptionPatch.feeExemptUntil = parsedDate.toISOString();
      }
    }

    if (collectionMode !== undefined) {
      const normalizedMode = String(collectionMode || '').toLowerCase();
      if (!['withdrawal', 'balance'].includes(normalizedMode)) {
        return res.status(400).json({ error: 'collectionMode inválido (use withdrawal ou balance)' });
      }
      subscriptionPatch.collectionMode = normalizedMode;
    }

    if (notes !== undefined) {
      subscriptionPatch.adminNotes = String(notes || '').trim();
    }

    subscriptionPatch.updatedAt = nowIso;
    subscriptionPatch.updatedBy = adminId;

    if (Object.keys(subscriptionPatch).length === 2) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar assinatura' });
    }

    const subscriptionWrite = await subscriptionStateService.runTransaction(driverId, (state) => ({
      ...state,
      ...subscriptionPatch
    }), { db });
    if (!subscriptionWrite.success) {
      throw new Error(subscriptionWrite.error || 'Falha ao atualizar assinatura');
    }

    logger.info(`✅ Status de assinatura do motorista ${driverId} atualizado`);

    res.json({
      success: true,
      message: 'Status de assinatura atualizado',
      driverId,
      status,
      billing_status,
      applied: {
        planType: planType || undefined,
        waveId: waveId !== undefined ? (String(waveId || '').trim() || null) : undefined,
        dailyFeeOverrideCents: requestedDailyFeeCents !== undefined ? Number.parseInt(requestedDailyFeeCents, 10) : undefined,
        isFeeExempt: isFeeExempt !== undefined
          ? (isFeeExempt === true || String(isFeeExempt).toLowerCase() === 'true')
          : undefined,
        feeExemptUntil: feeExemptUntil !== undefined
          ? (feeExemptUntil ? new Date(feeExemptUntil).toISOString() : null)
          : undefined,
        collectionMode: collectionMode !== undefined ? String(collectionMode).toLowerCase() : undefined
      }
    });

  } catch (error) {
    logger.error(`❌ Erro ao atualizar status de assinatura do motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Estender período grátis do motorista
 * POST /api/drivers/:driverId/extend-free
 * Body: { type: 'trial' | 'months' | 'promotion', days: number, reason: string }
 */
router.post('/api/drivers/:driverId/extend-free', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    const { type, days, reason } = req.body;

    if (!['trial', 'months', 'promotion'].includes(type)) {
      return res.status(400).json({ error: 'Tipo de período grátis inválido' });
    }

    if (!days || days <= 0) {
      return res.status(400).json({ error: 'Número de dias inválido' });
    }

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();

    const now = new Date();
    const newEndDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    let fieldName = '';
    if (type === 'trial') fieldName = 'free_trial_end';
    else if (type === 'months') fieldName = 'free_months_end';
    else if (type === 'promotion') fieldName = 'promotion_free_end';

    await db.ref(`users/${driverId}/${fieldName}`).set(newEndDate.toISOString());

    logger.info(`✅ Período grátis do motorista ${driverId} estendido: ${type} até ${newEndDate.toISOString()}`);

    res.json({
      success: true,
      message: `Período grátis estendido até ${newEndDate.toISOString().split('T')[0]}`,
      driverId,
      type,
      freeUntil: newEndDate.toISOString(),
      reason: reason || 'Extensão manual via dashboard'
    });

  } catch (error) {
    logger.error(`❌ Erro ao estender período grátis do motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Aprovar motorista
 * POST /api/drivers/:driverId/approve
 */
router.post('/api/drivers/:driverId/approve', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();
    const nowIso = new Date().toISOString();

    await db.ref(`users/${driverId}`).update({
      approved: true,
      approvedAt: nowIso,
      kyc_status: 'approved',
      kycStatus: 'approved',
      status: 'approved',
      updatedAt: nowIso
    });

    await Promise.all([
      db.ref(`users/${driverId}/driverActivationConsent`).update({
        backgroundCheck: true,
        updatedAt: nowIso
      }),
      db.ref(`driver_activation/${driverId}/consent/backgroundCheck`).update({
        accepted: true,
        acceptedAt: nowIso,
        updatedAt: nowIso
      })
    ]);

    try {
      await recomputeDriverActivationStatus(driverId);
    } catch (recomputeError) {
      logStructured('warn', 'Falha ao recomputar ativação após aprovação rápida', {
        service: 'dashboard-routes',
        driverId,
        error: recomputeError?.message || String(recomputeError)
      });
    }

    emitDriverActivationUnlockedEvent(req, driverId, {
      activationState: 'ACTIVE'
    });

    // Verificar e aplicar promoções elegíveis
    const promotionService = require('../services/promotion-service');
    await promotionService.checkAndApplyEligiblePromotions(driverId);

    logger.info(`✅ Motorista ${driverId} aprovado`);

    res.json({
      success: true,
      message: 'Motorista aprovado com sucesso',
      driverId
    });

  } catch (error) {
    logger.error(`❌ Erro ao aprovar motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Suspender motorista
 * POST /api/drivers/:driverId/suspend
 * Body: { reason: string, duration?: number }
 */
router.post('/api/drivers/:driverId/suspend', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    const { reason, duration } = req.body;

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();

    const suspendData = {
      suspended: true,
      accountSuspended: true,
      operationalBlocked: true,
      status: 'suspended',
      accountStatus: 'suspended',
      suspendedAt: new Date().toISOString(),
      suspendReason: reason || 'Suspensão manual via dashboard',
      updatedAt: new Date().toISOString()
    };

    if (duration) {
      const suspendUntil = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
      suspendData.suspendedUntil = suspendUntil.toISOString();
    }

    await db.ref(`users/${driverId}`).update(suspendData);

    logger.info(`✅ Motorista ${driverId} suspenso: ${reason}`);

    res.json({
      success: true,
      message: 'Motorista suspenso com sucesso',
      driverId,
      ...suspendData
    });

  } catch (error) {
    logger.error(`❌ Erro ao suspender motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Reativar motorista suspenso
 * POST /api/drivers/:driverId/unsuspend
 */
router.post('/api/drivers/:driverId/unsuspend', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();

    const driverSnapshot = await db.ref(`users/${driverId}`).once('value');
    const driverData = driverSnapshot.val() || {};
    const reactivationState = resolveDriverReactivationState(driverData);

    await db.ref(`users/${driverId}`).update({
      suspended: false,
      accountSuspended: false,
      operationalBlocked: false,
      status: reactivationState.status,
      accountStatus: reactivationState.accountStatus,
      suspendReason: null,
      suspendedUntil: null,
      unsuspendedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    logger.info(`✅ Motorista ${driverId} reativado`);

    res.json({
      success: true,
      message: 'Motorista reativado com sucesso',
      driverId
    });

  } catch (error) {
    logger.error(`❌ Erro ao reativar motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

hardenDashboardApiRoutes();

module.exports = router;
