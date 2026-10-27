// Gerado a partir de routes/dashboard.js (divisão mecânica, mesma ordem de registro).
// Dependências, estado e helpers compartilhados pelas rotas do painel.

const express = require('express');

const crypto = require('crypto');

const router = express.Router();

const path = require('path');

const multer = require('multer');

const admin = require('firebase-admin');

const jwt = require('jsonwebtoken');

const { logStructured, logError } = require('../../utils/logger');

const redisPool = require('../../utils/redis-pool');

const RedisScan = require('../../utils/redis-scan');

const kycDriverStatusService = require('../../services/kyc-driver-status-service');

const { getDashboardLiveData } = require('../../services/dashboard-live-data-service');

const {
  listUsers,
  getUserStats,
  getUserDetails,
  updateUserProfile
} = require('../../services/dashboard-user-service');

const supportTicketService = require('../../services/support-ticket-service');

const driverApplicationService = require('../../services/driver-application-service');

const driverSubscriptionService = require('../../services/driver-subscription-service');

const subscriptionStateService = require('../../services/subscription-state-service');

const modernMetricsService = require('../../services/modern-metrics-service');

const h3MapService = require('../../services/h3-map-service');

const h3VisualPolicyService = require('../../services/h3-visual-policy-service');

const financialReconciliationDashboardService = require('../../services/financial-reconciliation-dashboard-service');

const FinancialLedgerService = require('../../services/financial-ledger-service');

const auditService = require('../../services/audit-service');

const kycPolicyService = require('../../services/kyc-policy-service');

const kycFailedBiometricEvidenceService = require('../../services/kyc-failed-biometric-evidence-service');

const kycRuntimeScopeService = require('../../services/kyc-runtime-scope-service');

const canonicalDriverDocumentApprovalService = require('../../services/canonical-driver-document-approval-service');

const FirebaseStorageService = require('../../services/firebase-storage-service');

const CnhFaceBiometricService = require('../../services/cnh-face-biometric-service');

const backofficeCostGuardService = require('../../services/backoffice-cost-guard-service');

const {
  DashboardUserManagementError,
  updateUserOperationalStatus,
  assertDriverIdentityNotPermanentlyBlocked
} = require('../../services/dashboard-user-management-service');

const {
  recomputeDriverActivationStatus,
  runWithDocumentMutationLease,
  runWithCurrentDocumentBinding
} = require('../../services/driver-document-analysis-queue');

const {
  buildRecentRideActivities,
  isRideRevenuePendingFinalSnapshot,
  resolveRideDriverNetAmount,
  resolveRideOperationalFee,
  resolveRideRevenue
} = require('../../services/dashboard-ride-monitoring-service');

const { getPeakHours: getReportPeakHours } = require('../../services/dashboard/reportMetrics');

const os = require('os');

// ✅ Importar middlewares de autenticação
const { authenticateJWT, requireRole, requirePermission } = require('../../middleware/jwt-auth');

const { requireAdminMutationsEnabled } = require('../../middleware/admin-mutation-guard');

const { resolveJwtSecret } = require('../../utils/jwt-secret-resolver');

const { getAdminUser } = require('../../utils/admin-user-cache');

const { normalizeVehicleOcrPayload } = require('../../utils/vehicle-ocr-data');

const { resolveActiveTripForDriver } = require('../../utils/active-trip-index');

const {
  commitDriverOnlineProjection
} = require('../../services/driver-online-projection-service');

const driverDocumentStore = require('../../services/driver-document-store');

// Firebase integration
let firebaseConfig = null;

try {
  firebaseConfig = require('../../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'dashboard-routes' });
}

const legacyPromotionsRoutesEnabled =
  String(process.env.ENABLE_LEGACY_PROMOTIONS_ROUTES || 'false').toLowerCase() === 'true';

const legacyDashboardUsersMirrorEnabled =
  String(process.env.ENABLE_LEGACY_DASHBOARD_USERS_RTDB_MIRROR || 'false').toLowerCase() === 'true';

const DASHBOARD_OPERATION_ROLES = ['admin', 'super-admin', 'manager', 'support', 'development'];

const DASHBOARD_OPERATION_MUTATION_ROLES = ['admin', 'super-admin', 'manager', 'development'];

const DASHBOARD_SUPPORT_ROLES = ['admin', 'super-admin', 'manager', 'support', 'development'];

const DASHBOARD_FINANCIAL_ROLES = ['admin', 'super-admin', 'manager'];

const DASHBOARD_MONITORING_ROLES = ['admin', 'super-admin', 'manager', 'development'];

const DASHBOARD_KYC_REVIEW_ROLES = ['admin', 'super-admin', 'manager'];

const DASHBOARD_KYC_SANDBOX_PERMISSION = 'support:sandbox';

const DASHBOARD_KYC_SCOPES = new Set(['operational', 'sandbox']);

const DASHBOARD_DIRECT_UPLOAD_DOCUMENT_TYPES = new Set(['antecedentes_criminais']);

const DASHBOARD_REVIEWABLE_DOCUMENT_TYPES = new Set(['cnh', 'crlv', 'antecedentes_criminais']);

const DASHBOARD_DOCUMENT_PROVIDER_URL_KEYS = new Set([
  'fileUrl',
  'fileUrlExpiresAt',
  'url',
  'downloadUrl',
  'front',
  'back',
  'registration',
  'insurance'
]);

const KYC_PERMANENT_BLOCK_CONFIRMATION = 'CONFIRMAR FRAUDE E BLOQUEAR';

const LEGACY_DRIVER_APPLICATION_MUTATIONS_ENABLED = false;

const DASHBOARD_JWT_SECRET = resolveJwtSecret(['JWT_SECRET', 'ADMIN_JWT_SECRET'], {
  context: 'dashboard-routes'
});

let dashboardKycStorageService = null;

let dashboardKycCnhFaceService = null;

function getDashboardKycStorageService() {
  if (!dashboardKycStorageService) dashboardKycStorageService = new FirebaseStorageService();
  return dashboardKycStorageService;
}

function getDashboardKycCnhFaceService() {
  if (!dashboardKycCnhFaceService) dashboardKycCnhFaceService = new CnhFaceBiometricService();
  return dashboardKycCnhFaceService;
}

function getDashboardKycReviewer(req) {
  return {
    uid: req.user?.id || req.user?.userId || null,
    email: req.user?.email || null,
    role: req.user?.role || null
  };
}

function dashboardKycBoundaryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveRequestedDashboardKycScope(req) {
  const rawSignals = [
    req.get?.('X-Leaf-KYC-Scope'),
    req.query?.scope,
    req.query?.persistenceScope,
    req.body?.scope,
    req.body?.persistenceScope
  ].flatMap((value) => Array.isArray(value) ? value : [value]);
  const signals = rawSignals
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => String(value).trim().toLowerCase());

  if (signals.some((scope) => !DASHBOARD_KYC_SCOPES.has(scope))) {
    throw dashboardKycBoundaryError(
      'KYC_DASHBOARD_SCOPE_INVALID',
      'Escopo KYC do dashboard invalido.'
    );
  }
  const distinctScopes = [...new Set(signals)];
  if (distinctScopes.length > 1) {
    throw dashboardKycBoundaryError(
      'KYC_DASHBOARD_SCOPE_CONFLICT',
      'Os sinais de escopo KYC do dashboard sao divergentes.'
    );
  }
  return distinctScopes[0] || 'operational';
}

function canAccessDashboardKycSandbox(user = {}) {
  if (user.role === 'super-admin') return true;
  const permissions = Array.isArray(user.permissions)
    ? user.permissions.map((permission) => String(permission || '').trim().toLowerCase())
    : [];
  return permissions.includes('*') || permissions.includes(DASHBOARD_KYC_SANDBOX_PERMISSION);
}

async function resolveDashboardKycRuntime(req, driverId) {
  const requestedScope = resolveRequestedDashboardKycScope(req);
  const runtime = await kycRuntimeScopeService.resolveForUser({
    userId: String(driverId || '').trim()
  });
  const authoritativeScope = String(runtime?.scope?.namespace || '').trim().toLowerCase();
  if (!DASHBOARD_KYC_SCOPES.has(authoritativeScope)) {
    throw dashboardKycBoundaryError(
      'KYC_DASHBOARD_RUNTIME_UNAVAILABLE',
      'O runtime KYC autoritativo nao esta disponivel.'
    );
  }
  if (requestedScope === 'sandbox' && !canAccessDashboardKycSandbox(req.user)) {
    throw dashboardKycBoundaryError(
      'KYC_DASHBOARD_SANDBOX_ACCESS_DENIED',
      'O acesso ao KYC sandbox exige permissao especifica.'
    );
  }
  if (authoritativeScope !== requestedScope) {
    throw dashboardKycBoundaryError(
      'KYC_DASHBOARD_SCOPE_USER_MISMATCH',
      'O escopo KYC solicitado diverge da classificacao autoritativa do motorista.'
    );
  }
  if (
    authoritativeScope === 'sandbox' &&
    runtime?.scope?.financialContext?.testUserSandbox !== true
  ) {
    throw dashboardKycBoundaryError(
      'KYC_DASHBOARD_SANDBOX_USER_MISMATCH',
      'O motorista nao possui classificacao sandbox autoritativa.'
    );
  }
  if (!runtime.workflow || !runtime.evidence || !runtime.trust) {
    throw dashboardKycBoundaryError(
      'KYC_DASHBOARD_RUNTIME_UNAVAILABLE',
      'O runtime KYC autoritativo nao esta disponivel.'
    );
  }
  return runtime;
}

function isDashboardCnhMutationGuardError(error) {
  return [
    'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK',
    'KYC_IDENTITY_REVIEW_HOLD',
    'KYC_VERIFICATION_IN_PROGRESS',
    'KYC_VERIFICATION_LEASE_LOST',
    'KYC_IDENTITY_REVIEW_GUARD_UNAVAILABLE',
    'KYC_DASHBOARD_RUNTIME_UNAVAILABLE'
  ].includes(error?.code);
}

function sendDashboardCnhMutationGuardError(res, error) {
  const permanentlyBlocked = error?.code === 'KYC_IDENTITY_FRAUD_PERMANENT_BLOCK';
  const reviewHold = error?.code === 'KYC_IDENTITY_REVIEW_HOLD';
  const verificationBusy = error?.code === 'KYC_VERIFICATION_IN_PROGRESS';
  const leaseLost = error?.code === 'KYC_VERIFICATION_LEASE_LOST';
  const statusCode = permanentlyBlocked || reviewHold
    ? 423
    : verificationBusy
      ? 409
      : 503;

  return res.status(statusCode).json({
    success: false,
    code: error?.code || 'KYC_IDENTITY_REVIEW_GUARD_UNAVAILABLE',
    message: permanentlyBlocked || reviewHold
      ? 'A CNH não pode ser alterada enquanto a identidade está bloqueada ou em análise.'
      : verificationBusy
        ? 'Outra validação de identidade está em andamento. Tente novamente depois.'
        : leaseLost
          ? 'Não foi possível concluir a alteração da CNH com segurança. Tente novamente.'
          : 'Não foi possível validar a alteração da CNH agora.'
  });
}

function createDashboardCnhMutationVerificationLease({
  kycRuntime,
  claim,
  res
}) {
  let released = false;
  let lost = false;
  let renewalInFlight = null;

  const renew = async () => {
    if (released || lost) return false;
    if (renewalInFlight) return renewalInFlight;
    renewalInFlight = Promise.resolve()
      .then(() => kycRuntime.trust.renewVerificationWindow(claim))
      .then((held) => {
        if (held !== true) lost = true;
        return held === true;
      })
      .catch(() => {
        lost = true;
        return false;
      })
      .finally(() => {
        renewalInFlight = null;
      });
    return renewalInFlight;
  };

  const timer = setInterval(() => {
    void renew();
  }, 10 * 1000);
  timer.unref?.();

  const release = async () => {
    if (released) return;
    released = true;
    clearInterval(timer);
    await kycRuntime.trust.releaseVerificationWindow(claim).catch(() => null);
  };
  res.once('finish', () => { void release(); });
  res.once('close', () => { void release(); });

  return {
    async assertHeld() {
      if (lost || !(await renew())) {
        const error = new Error('A janela segura para alteração da CNH foi perdida');
        error.code = 'KYC_VERIFICATION_LEASE_LOST';
        throw error;
      }
      return true;
    },
    release
  };
}

async function requireDashboardCnhMutationWindow(req, res, next) {
  const documentType = sanitizeDocumentType(req.params?.documentType);
  const driverId = String(req.params?.driverId || '').trim();
  let kycRuntime = null;
  let claim = null;
  let lease = null;
  try {
    kycRuntime = await resolveDashboardKycRuntime(req, driverId);
    req.dashboardDocumentKycRuntime = kycRuntime;
    if (documentType !== 'cnh') return next();
    if (
      typeof kycRuntime.trust.claimVerificationWindow !== 'function'
      || typeof kycRuntime.trust.renewVerificationWindow !== 'function'
      || typeof kycRuntime.trust.releaseVerificationWindow !== 'function'
    ) {
      throw dashboardKycBoundaryError(
        'KYC_DASHBOARD_RUNTIME_UNAVAILABLE',
        'A janela segura para alteração da CNH não está disponível.'
      );
    }

    claim = await kycRuntime.trust.claimVerificationWindow(driverId, {
      scope: 'dashboard_canonical_cnh_review'
    });
    if (!claim?.acquired) {
      return sendDashboardCnhMutationGuardError(res, {
        code: 'KYC_VERIFICATION_IN_PROGRESS'
      });
    }

    lease = createDashboardCnhMutationVerificationLease({
      kycRuntime,
      claim,
      res
    });
    req.dashboardCnhMutationGuard = {
      driverId,
      kycRuntime,
      lease
    };
    await lease.assertHeld();
    await kycRuntime.workflow.assertCnhUploadAllowed(driverId);
    await lease.assertHeld();
    return next();
  } catch (error) {
    if (!lease && claim?.acquired && kycRuntime?.trust) {
      await kycRuntime.trust.releaseVerificationWindow(claim).catch(() => null);
    }
    if (documentType === 'cnh') return sendDashboardCnhMutationGuardError(res, error);
    const denied = String(error?.code || '').includes('ACCESS_DENIED');
    const mismatch = String(error?.code || '').includes('MISMATCH') || String(error?.code || '').includes('CONFLICT');
    return res.status(denied ? 403 : mismatch ? 409 : 503).json({
      success: false,
      code: error?.code || 'KYC_DASHBOARD_RUNTIME_UNAVAILABLE',
      message: denied
        ? 'Você não tem permissão para acessar documentos do ambiente de testes.'
        : mismatch
          ? 'Este cadastro pertence a outro ambiente. Abra a fila correspondente e tente novamente.'
          : 'Não foi possível validar o ambiente deste cadastro agora.'
    });
  }
}

function restrictDashboardDirectDocumentUpload(req, res, next) {
  const documentType = sanitizeDocumentType(req.params?.documentType);
  if (DASHBOARD_DIRECT_UPLOAD_DOCUMENT_TYPES.has(documentType)) return next();
  return res.status(409).json({
    success: false,
    code: 'DRIVER_ACTIVATION_DOCUMENT_UPLOAD_DRIVER_REQUIRED',
    message: 'CNH e CRLV só podem ser enviados pelo próprio motorista no fluxo seguro de documentos do app.'
  });
}

async function assertDashboardCnhMutationWindowHeld(req, driverId) {
  const guard = req.dashboardCnhMutationGuard;
  if (
    !guard?.kycRuntime
    || !guard?.lease
    || guard.driverId !== String(driverId || '').trim()
  ) {
    throw dashboardKycBoundaryError(
      'KYC_IDENTITY_REVIEW_GUARD_UNAVAILABLE',
      'A proteção da alteração da CNH não está disponível.'
    );
  }
  await guard.lease.assertHeld();
  await guard.kycRuntime.workflow.assertCnhUploadAllowed(driverId);
  await guard.lease.assertHeld();
  return true;
}

function dashboardKycPersistenceContext(runtime) {
  return runtime?.persistenceContext || runtime?.scope?.financialContext || null;
}

function dashboardKycAuditEnvelope(runtime) {
  const financialContext = dashboardKycPersistenceContext(runtime);
  if (
    !financialContext ||
    !runtime?.scope?.namespace ||
    !(runtime.scope.financialContextId || financialContext.contextId)
  ) {
    throw dashboardKycBoundaryError(
      'KYC_DASHBOARD_RUNTIME_UNAVAILABLE',
      'O contexto de auditoria KYC não está disponível.'
    );
  }
  return {
    financialContext,
    financialNamespace: runtime.scope.namespace,
    financialContextId: runtime.scope.financialContextId || financialContext.contextId,
    providerEnvironment: financialContext.providerEnvironment,
    paymentProfileId: financialContext.paymentProfileId || null,
    testUserSandbox: financialContext.testUserSandbox === true
  };
}

function requireDashboardKycScopedPolicy(runtime) {
  const policy = runtime?.policyService || runtime?.policy || null;
  if (
    runtime?.capabilities?.challengePolicyMutations !== true ||
    !policy ||
    (
      typeof policy.applyIdentityReverificationGate !== 'function' &&
      typeof policy.getOrCreateStepUpChallenge !== 'function'
    )
  ) {
    throw dashboardKycBoundaryError(
      'KYC_DASHBOARD_SANDBOX_POLICY_UNAVAILABLE',
      'Esta acao permanece bloqueada no sandbox ate que a politica KYC tenha isolamento proprio.'
    );
  }
  if (
    runtime.scope.namespace === 'sandbox' &&
    (
      policy.scope?.namespace !== 'sandbox' ||
      policy.scope?.financialContextId !== runtime.scope.financialContextId
    )
  ) {
    throw dashboardKycBoundaryError(
      'KYC_DASHBOARD_SANDBOX_POLICY_SCOPE_MISMATCH',
      'A politica KYC nao pertence ao mesmo contexto sandbox do motorista.'
    );
  }
  return policy;
}

async function applyDashboardIdentityReverificationGate(runtime, input = {}) {
  const policy = requireDashboardKycScopedPolicy(runtime);
  if (typeof policy.applyIdentityReverificationGate === 'function') {
    return policy.applyIdentityReverificationGate(input);
  }

  const payload = input.payload && typeof input.payload === 'object'
    ? input.payload
    : {};
  return policy.getOrCreateStepUpChallenge({
    driverId: input.driverId,
    requirement: 'IDENTITY_REVERIFICATION',
    score: 100,
    signals: ['manual_identity_review'],
    source: payload.reasonCode || 'dashboard_identity_review',
    metadata: {
      reporterId: input.reporterId || null,
      reporterType: input.reporterType || null,
      supportTicketId: input.supportTicketId || null,
      publicReason: payload.publicReason || null,
      selectedOptions: Array.isArray(payload.selectedOptions) ? payload.selectedOptions : [],
      attemptScope: payload.attemptScope || null
    }
  });
}

function normalizeKycReviewReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 20 || reason.length > 1000) {
    const error = new Error('Informe uma justificativa de 20 a 1000 caracteres.');
    error.code = 'KYC_IDENTITY_REVIEW_REASON_REQUIRED';
    throw error;
  }
  return reason;
}

function statusForKycReviewError(error) {
  const code = String(error?.code || '');
  if (code.includes('NOT_FOUND')) return 404;
  if (code.includes('EXPIRED')) return 410;
  if (code.includes('ADMIN_REQUIRED') || code.includes('ACCESS_DENIED')) return 403;
  if (code.includes('PERMANENT_BLOCK')) return 423;
  if (code.includes('SCOPE_CONFLICT') || code.includes('USER_MISMATCH')) return 409;
  if (code.includes('ACTIVE_TRIP') || code.includes('DEFERRED_ACTIVE_TRIP')) return 409;
  if (code.includes('BINDING') || code.includes('CONFLICT') || code.includes('TRANSITION') || code.includes('UNDER_REVIEW')) return 409;
  if (code.includes('UNAVAILABLE') || code.includes('STORE_') || code.includes('POLICY_')) return 503;
  if (code.includes('INVALID') || code.includes('REQUIRED')) return 400;
  return 500;
}

function respondKycReviewError(res, error) {
  return res.status(statusForKycReviewError(error)).json({
    success: false,
    code: error?.code || 'KYC_IDENTITY_REVIEW_ERROR',
    error: error?.message || 'Nao foi possivel concluir a revisao de identidade.'
  });
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function projectDashboardDocumentMetadata(value) {
  if (Array.isArray(value)) {
    return value.map((item) => projectDashboardDocumentMetadata(item));
  }
  if (!value || typeof value !== 'object') return value;

  return Object.entries(value).reduce((projection, [key, item]) => {
    if (!DASHBOARD_DOCUMENT_PROVIDER_URL_KEYS.has(key)) {
      projection[key] = projectDashboardDocumentMetadata(item);
    }
    return projection;
  }, {});
}

async function applyConfirmedIdentityFraudBlock({ driverId, enforcement, reviewer, reason }) {
  const projection = enforcement?.mirrorProjection || null;
  if (!projection?.users || !projection?.drivers) {
    const error = new Error('Projecao canonica do bloqueio permanente ausente.');
    error.code = 'KYC_IDENTITY_BLOCK_PROJECTION_INVALID';
    throw error;
  }

  await updateUserOperationalStatus(
    driverId,
    { status: 'blocked', reason },
    {
      operator: {
        id: reviewer.uid,
        email: reviewer.email,
        role: reviewer.role
      }
    }
  );

  const firestore = firebaseConfig?.getFirestore?.();
  const realtimeDb = firebaseConfig?.getRealtimeDB?.();
  if (!firestore || !realtimeDb) {
    const error = new Error('Firebase indisponivel para espelhar o bloqueio permanente.');
    error.code = 'KYC_IDENTITY_BLOCK_MIRROR_UNAVAILABLE';
    throw error;
  }

  await Promise.all([
    firestore.collection('users').doc(driverId).set(projection.users, { merge: true }),
    firestore.collection('drivers').doc(driverId).set(projection.drivers, { merge: true }),
    realtimeDb.ref(`users/${driverId}`).update(projection.users)
  ]);

  try {
    await redisPool.ensureConnection?.();
    const redis = redisPool.getConnection();
    if (redis && projection.redis) {
      await redis.hset(`driver:${driverId}`, projection.redis);
    }
  } catch (error) {
    logStructured('warn', 'Redis indisponivel ao espelhar bloqueio permanente KYC', {
      service: 'dashboard-routes',
      driverId,
      error: error?.message || String(error)
    });
  }
}

function emitDriverActivationUnlockedEvent(req, driverId, payload = {}) {
  const io = req?.app?.get?.('io') || req?.app?.locals?.io || null;
  if (!io || !driverId) return;
  const canGoOnline = payload?.canGoOnline === true;
  io.to(`driver_${driverId}`).emit('driverDocumentStatusUpdated', {
    driverId,
    documentType: 'activation_status',
    status: canGoOnline ? 'approved' : 'pending',
    updatedAt: new Date().toISOString(),
    canGoOnline,
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
    normalizedPath.includes('/reports') ||
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

    if (dashboardRouteHasMiddleware(layer, authenticateMapH3Access, 'authenticateMapH3Access')) {
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

function parseAuditDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
	      role: userData.role || 'viewer',
	      permissions: Array.isArray(userData.permissions) ? userData.permissions : []
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

function extractBearerToken(req) {
  const header = String(req.headers?.authorization || '').trim();
  if (!header.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return header.slice(7).trim();
}

async function authenticateMapH3Access(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token não fornecido'
      });
    }

    try {
      const decoded = jwt.verify(token, DASHBOARD_JWT_SECRET);
      const adminUser = await getAdminUser(decoded.userId, {
        source: 'dashboard-routes.map-h3-gate',
        maxAgeMs: 15 * 1000
      });

	    if (adminUser.exists && adminUser.data?.active !== false) {
	      const userData = adminUser.data || {};
	      const role = userData.role || 'viewer';

        if (!DASHBOARD_OPERATION_ROLES.includes(role)) {
          return res.status(403).json({
            success: false,
            error: 'Acesso negado'
          });
        }

        req.user = {
	        id: decoded.userId,
	        email: decoded.email || userData.email,
	        role,
	        permissions: Array.isArray(userData.permissions) ? userData.permissions : []
	      };
        req.mapH3AuthSource = 'dashboard';
        return next();
      }
    } catch (_dashboardTokenError) {
      // The mobile app uses Firebase ID tokens. If the token is not a dashboard
      // JWT, fall through to Firebase verification below.
    }

    const requestedSurface = String(req.query?.surface || 'dashboard').trim().toLowerCase();
    if (requestedSurface !== 'driver') {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado'
      });
    }

    try {
      firebaseConfig?.initializeFirebase?.();
    } catch (_firebaseInitError) {
      // initializeFirebase is idempotent and logs its own failures.
    }

    const decodedFirebaseToken = await admin.auth().verifyIdToken(token);
    const uid = String(decodedFirebaseToken?.uid || '').trim();
    if (!uid) {
      return res.status(401).json({
        success: false,
        error: 'Token sem UID válido'
      });
    }

    req.firebaseUser = decodedFirebaseToken;
    req.authenticatedUser = {
      uid,
      phoneNumber: decodedFirebaseToken.phone_number || decodedFirebaseToken.phoneNumber || null,
      userType: decodedFirebaseToken.userType || decodedFirebaseToken.usertype || null,
      authSource: 'firebase'
    };
    req.mapH3AuthSource = 'firebase';
    return next();
  } catch (error) {
    logError(error, 'Falha ao autenticar acesso ao mapa H3', {
      service: 'dashboard-routes',
      operation: 'authenticateMapH3Access'
    });
    return res.status(401).json({
      success: false,
      error: 'Token inválido ou expirado'
    });
  }
}

authenticateMapH3Access._dashboardAutoMiddleware = 'authenticateMapH3Access';

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

function isSafeFirebasePathSegment(value) {
  const normalized = String(value || '').trim();
  return Boolean(normalized) &&
    normalized.length <= 128 &&
    !/[.#$\[\]\/\u0000-\u001f\u007f]/.test(normalized);
}

function isSafeStorageObjectPath(value) {
  const normalized = String(value || '').trim();
  return Boolean(normalized) &&
    !normalized.startsWith('/') &&
    !normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}

function isCanonicalDashboardDocumentPath(driverId, documentType, filePath) {
  const expectedPrefix = documentType === 'antecedentes_criminais'
    ? `documents/${driverId}/${documentType}/`
    : `driver-activation/${driverId}/${documentType}/`;
  return isSafeStorageObjectPath(filePath) && String(filePath).startsWith(expectedPrefix);
}

function normalizeDashboardDocumentContentType(value) {
  const normalized = String(value || '').trim().toLowerCase().split(';')[0];
  if (normalized === 'application/pdf') return normalized;
  if (/^image\/(?:jpeg|png|webp|heic|heif)$/.test(normalized)) return normalized;
  return 'application/octet-stream';
}

function statusForDashboardDocumentContentError(error) {
  const code = String(error?.code || '');
  if (code === 'DRIVER_DOCUMENT_NOT_FOUND' || code === 'FIREBASE_STORAGE_OBJECT_NOT_FOUND') return 404;
  if (code.includes('ACCESS_DENIED')) return 403;
  if (
    code.includes('BINDING') ||
    code.includes('INTEGRITY') ||
    code.includes('REUPLOAD') ||
    code.includes('GENERATION_MISMATCH') ||
    code.includes('MISMATCH') ||
    code.includes('CONFLICT')
  ) return 409;
  if (code.includes('INVALID')) return 400;
  return 503;
}

function sendDashboardDocumentContentError(res, error) {
  const status = statusForDashboardDocumentContentError(error);
  const messages = {
    400: 'Não foi possível identificar o documento solicitado.',
    403: 'Você não tem permissão para abrir este documento.',
    404: 'O documento solicitado não foi encontrado.',
    409: 'Este documento precisa ser reenviado antes de ser visualizado.',
    503: 'Não foi possível abrir o documento agora. Tente novamente.'
  };
  return res.status(status).json({
    success: false,
    code: error?.code || 'DRIVER_DOCUMENT_CONTENT_UNAVAILABLE',
    message: messages[status]
  });
}

function dashboardActivationDocumentReviewError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizedDocumentBindingValue(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function assertMatchingDocumentBinding(expected = {}, actual = {}) {
  const fields = ['submissionId', 'filePath', 'documentSha256', 'storageGeneration'];
  const mismatch = fields.some((field) => (
    !normalizedDocumentBindingValue(expected[field])
    || normalizedDocumentBindingValue(expected[field])
      !== normalizedDocumentBindingValue(actual[field])
  ));
  if (mismatch) {
    throw dashboardActivationDocumentReviewError(
      'DRIVER_ACTIVATION_DOCUMENT_BINDING_MISMATCH',
      'O documento mudou desde que esta revisão foi aberta. Recarregue a tela antes de continuar.'
    );
  }
}

async function assertCurrentCrlvReviewBinding({ firestore, driverId, document, action }) {
  const submissionId = normalizedDocumentBindingValue(
    document?.lastSubmissionId || document?.submissionId
  );
  const expectedBinding = {
    submissionId,
    filePath: document?.filePath,
    documentSha256: document?.documentSha256,
    storageGeneration: document?.storageGeneration
  };
  if (!submissionId) {
    throw dashboardActivationDocumentReviewError(
      'DRIVER_ACTIVATION_DOCUMENT_REUPLOAD_REQUIRED',
      'Este CRLV não possui vínculo seguro. Solicite um novo envio pelo app antes da revisão.'
    );
  }

  const {
    userDocument: currentDocument,
    activationDocument,
    historyDocument
  } = await driverDocumentStore.readDocumentBinding(firestore, { driverId, documentType: 'crlv', submissionId });
  if (![currentDocument, activationDocument, historyDocument].every(value => Object.keys(value).length > 0)) {
    throw dashboardActivationDocumentReviewError(
      'DRIVER_ACTIVATION_DOCUMENT_REUPLOAD_REQUIRED',
      'O vínculo atual do CRLV não está completo. Solicite um novo envio pelo app.'
    );
  }

  assertMatchingDocumentBinding(expectedBinding, {
    submissionId: currentDocument.lastSubmissionId || currentDocument.submissionId,
    filePath: currentDocument.filePath,
    documentSha256: currentDocument.documentSha256,
    storageGeneration: currentDocument.storageGeneration
  });
  assertMatchingDocumentBinding(expectedBinding, {
    submissionId: historyDocument.submissionId,
    filePath: historyDocument.filePath,
    documentSha256: historyDocument.documentSha256,
    storageGeneration: historyDocument.storageGeneration
  });
  assertMatchingDocumentBinding(expectedBinding, {
    submissionId: activationDocument.submissionId || historyDocument.submissionId,
    filePath: activationDocument.filePath,
    documentSha256: activationDocument.documentSha256,
    storageGeneration: activationDocument.storageGeneration
  });

  if (
    action === 'approve'
    && (
      String(currentDocument.analysisStatus || '').toLowerCase() !== 'approved'
      || String(activationDocument.status || '').toLowerCase() !== 'approved'
      || String(historyDocument.status || '').toLowerCase() !== 'approved'
    )
  ) {
    throw dashboardActivationDocumentReviewError(
      'DRIVER_ACTIVATION_DOCUMENT_ANALYSIS_NOT_APPROVED',
      'O CRLV ainda não concluiu a análise segura. Aguarde ou solicite um novo envio.'
    );
  }

  return expectedBinding;
}

function normalizeManualApprovalEvidence(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return { ref: item };
        if (item && typeof item === 'object') return item;
        return null;
      })
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return [{ ref: value.trim() }];
  }

  if (value && typeof value === 'object') {
    return [value];
  }

  return [];
}

const MEI_DOCUMENTS_ENABLED =
  String(process.env.ENABLE_DRIVER_MEI_DOCUMENTS || 'false').toLowerCase() === 'true';

const REVIEWABLE_DOCUMENT_TYPES = [
  'cnh',
  'crlv',
  'antecedentes_criminais',
  ...(MEI_DOCUMENTS_ENABLED ? ['mei'] : [])
];

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

async function adjustDocumentIndexCounters(firestore, documentType, previousStatus, nextStatus) {
  const safeDocumentType = sanitizeDocumentType(documentType);
  if (!safeDocumentType) return;

  const fromStatus = normalizeIndexStatus(previousStatus);
  const toStatus = normalizeIndexStatus(nextStatus);

  if (!fromStatus && !toStatus) return;
  if (fromStatus === toStatus) return;

  const deltas = {};
  if (fromStatus) deltas[fromStatus] = (deltas[fromStatus] || 0) - 1;
  if (toStatus) deltas[toStatus] = (deltas[toStatus] || 0) + 1;

  await driverDocumentStore.adjustStats(firestore, safeDocumentType, deltas);
}

// Firestore for the driver document repository (dashboard document routes).
function getDocumentFirestore() {
  const firestore = firebaseConfig?.getFirestore?.();
  if (!firestore) {
    const error = new Error('Armazenamento de documentos indisponível.');
    error.code = 'DRIVER_DOCUMENT_STORE_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
  return firestore;
}

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

    driverEarnings[driverId].totalEarnings += resolveRideDriverNetAmount(booking);
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
    cities[city].revenue += resolveRideRevenue(booking);
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
  return getReportPeakHours(bookings);
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
  const fare = resolveRideRevenue(booking);
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
    sum + resolveRideRevenue(b), 0
  );
  const previousRevenue = previousPeriodBookings.reduce((sum, b) =>
    sum + resolveRideRevenue(b), 0
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
        daily[dateStr] += resolveRideRevenue(booking);
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

const promotionService = require('../../services/promotion-service');

const { logger } = require('../../utils/logger');

module.exports = {
  CnhFaceBiometricService,
  DASHBOARD_DIRECT_UPLOAD_DOCUMENT_TYPES,
  DASHBOARD_DOCUMENT_PROVIDER_URL_KEYS,
  DASHBOARD_FINANCIAL_ROLES,
  DASHBOARD_JWT_SECRET,
  DASHBOARD_KYC_REVIEW_ROLES,
  DASHBOARD_KYC_SANDBOX_PERMISSION,
  DASHBOARD_KYC_SCOPES,
  DASHBOARD_MONITORING_ROLES,
  DASHBOARD_OPERATION_MUTATION_ROLES,
  DASHBOARD_OPERATION_ROLES,
  DASHBOARD_REVIEWABLE_DOCUMENT_TYPES,
  DASHBOARD_SUPPORT_ROLES,
  DashboardUserManagementError,
  FinancialLedgerService,
  FirebaseStorageService,
  KYC_PERMANENT_BLOCK_CONFIRMATION,
  LEGACY_DRIVER_APPLICATION_MUTATIONS_ENABLED,
  MEI_DOCUMENTS_ENABLED,
  REVIEWABLE_DOCUMENT_SORT_FIELDS,
  REVIEWABLE_DOCUMENT_STATUSES,
  REVIEWABLE_DOCUMENT_TYPES,
  RedisScan,
  adjustDocumentIndexCounters,
  getDocumentFirestore,
  driverDocumentStore,
  admin,
  adminDocumentUpload,
  analyzeDriverGrowth,
  analyzeRevenueGrowth,
  analyzeTripGrowth,
  analyzeUserGrowth,
  applyConfirmedIdentityFraudBlock,
  applyDashboardIdentityReverificationGate,
  assertCurrentCrlvReviewBinding,
  assertDashboardCnhMutationWindowHeld,
  assertDriverIdentityNotPermanentlyBlocked,
  assertMatchingDocumentBinding,
  auditService,
  authenticateJWT,
  authenticateLegacyDashboardSupportJWTOrSkip,
  authenticateMapH3Access,
  backofficeCostGuardService,
  buildRecentRideActivities,
  calculateAverageTripTime,
  calculateAverageWaitTime,
  calculateCostTrend,
  calculateGrowthRate,
  calculateOverallStatus,
  calculatePaymentFrequency,
  calculatePotentialSavings,
  calculatePromoRetentionRate,
  calculateTripCosts,
  canAccessDashboardKycSandbox,
  canonicalDriverDocumentApprovalService,
  collectPerformanceMetrics,
  commitDriverOnlineProjection,
  computeAverageRatingForUser,
  convertToCSV,
  countServicesUp,
  createDashboardCnhMutationVerificationLease,
  createRouteMiddlewareLayer,
  crypto,
  dashboardActivationDocumentReviewError,
  dashboardKycAuditEnvelope,
  dashboardKycBoundaryError,
  dashboardKycCnhFaceService,
  dashboardKycPersistenceContext,
  dashboardKycStorageService,
  dashboardRouteHasMiddleware,
  diffMinutes,
  driverApplicationService,
  driverSubscriptionService,
  emitDriverActivationUnlockedEvent,
  express,
  extractBearerToken,
  extractRedisConnections,
  extractRedisMemory,
  extractRedisMemoryInMb,
  extractRedisStatValue,
  extractRedisUptime,
  extractRedisVersion,
  financialReconciliationDashboardService,
  firebaseConfig,
  flattenTripRatings,
  formatUptime,
  genderCodeToLabel,
  generateCohortAnalysis,
  generateDailyGrowth,
  generateDailyRevenueGrowth,
  generateDailyTripGrowth,
  generateGrowthForecasts,
  generateGrowthInsights,
  generateGrowthTrends,
  generatePerformanceTrends,
  generateServiceAlerts,
  getAdminUser,
  getAverageDistance,
  getAverageRating,
  getCityAnalysis,
  getDailyUsageBreakdown,
  getDashboardKycCnhFaceService,
  getDashboardKycReviewer,
  getDashboardKycStorageService,
  getDashboardLiveData,
  getDashboardRouteMethods,
  getDashboardRoutePath,
  getGeographicDistribution,
  getHourlyTripDistribution,
  getPaymentMethodsBreakdown,
  getPeakHours,
  getPeakUsageDays,
  getReportPeakHours,
  getRouteAnalysis,
  getTopDriversByEarnings,
  getTopReferrers,
  getTripAnalysis,
  getUserDetails,
  getUserGrowthTrend,
  getUserStats,
  getVehicleTypeAnalysis,
  getWeekStart,
  h3MapService,
  h3VisualPolicyService,
  hardenDashboardApiRoutes,
  identifyMainCostDriver,
  isCanonicalDashboardDocumentPath,
  isDashboardCnhMutationGuardError,
  isRideRevenuePendingFinalSnapshot,
  isSafeFirebasePathSegment,
  isSafeStorageObjectPath,
  jwt,
  kycDriverStatusService,
  kycFailedBiometricEvidenceService,
  kycPolicyService,
  kycRuntimeScopeService,
  legacyDashboardUsersMirrorEnabled,
  legacyPromotionsRoutesEnabled,
  listUsers,
  loadBookingHashes,
  logError,
  logStructured,
  logger,
  modernMetricsService,
  monitorFirebaseService,
  monitorGoogleApis,
  monitorRedisService,
  monitorSystemResources,
  monitorWebSocketConnections,
  multer,
  normalizeBirthDate,
  normalizeDashboardDocumentContentType,
  normalizeGenderCode,
  normalizeId,
  normalizeIndexStatus,
  normalizeKycReviewReason,
  normalizeManualApprovalEvidence,
  normalizeMotherName,
  normalizeQueueSortField,
  normalizeQueueSortOrder,
  normalizeQueueStatus,
  normalizeSupportDashboardTicket,
  normalizeTimestamp,
  normalizeVehicleOcrPayload,
  normalizedDocumentBindingValue,
  os,
  parseAuditDate,
  parseRatingValue,
  parseTimestampValue,
  path,
  pickFirstTimestamp,
  projectDashboardDocumentMetadata,
  promotionService,
  recomputeDriverActivationStatus,
  redisPool,
  rejectDashboardMockEndpointInProduction,
  requireAdminMutationsEnabled,
  requireDashboardCnhMutationWindow,
  requireDashboardKycScopedPolicy,
  requirePermission,
  requireRole,
  resolveActiveTripForDriver,
  resolveDashboardHardeningRoles,
  resolveDashboardKycRuntime,
  resolveDriverIdentityData,
  resolveJwtSecret,
  resolveRequestedDashboardKycScope,
  resolveRideDriverNetAmount,
  resolveRideOperationalFee,
  resolveRideRevenue,
  respondKycReviewError,
  restrictDashboardDirectDocumentUpload,
  router,
  runWithCurrentDocumentBinding,
  runWithDocumentMutationLease,
  sampleRedisKeys,
  sanitizeDocumentType,
  sanitizeFilename,
  sendDashboardCnhMutationGuardError,
  sendDashboardDocumentContentError,
  sha256Buffer,
  statusForDashboardDocumentContentError,
  statusForKycReviewError,
  subscriptionStateService,
  supportTicketService,
  updateUserOperationalStatus,
  updateUserProfile
};
