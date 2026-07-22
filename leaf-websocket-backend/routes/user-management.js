const express = require('express');
const crypto = require('crypto');
const { authenticateJWT, requireRole } = require('../middleware/jwt-auth');
const {
  DashboardUserManagementError,
  updateUserOperationalStatus,
  requestDriverDocument
} = require('../services/dashboard-user-management-service');
const { logError } = require('../utils/logger');
const auditService = require('../services/audit-service');
const kycRuntimeScopeService = require('../services/kyc-runtime-scope-service');

const router = express.Router();
const DASHBOARD_OPERATION_ROLES = ['admin', 'super-admin', 'manager', 'support', 'development'];
const DASHBOARD_OPERATION_MUTATION_ROLES = ['admin', 'super-admin', 'manager', 'development'];
const DASHBOARD_KYC_REVIEW_ROLES = ['admin', 'super-admin', 'manager'];
const DASHBOARD_KYC_SANDBOX_PERMISSION = 'support:sandbox';

function requestedKycScope(req) {
  const signals = [
    req.get?.('X-Leaf-KYC-Scope'),
    req.query?.scope,
    req.body?.scope
  ].filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => String(value).trim().toLowerCase());
  if (signals.some((scope) => !['operational', 'sandbox'].includes(scope)) || new Set(signals).size > 1) {
    throw new DashboardUserManagementError('Escopo KYC invalido', 400, 'KYC_DASHBOARD_SCOPE_INVALID');
  }
  return signals[0] || 'operational';
}

function canAccessKycSandbox(user = {}) {
  if (user.role === 'super-admin') return true;
  const permissions = Array.isArray(user.permissions)
    ? user.permissions.map((permission) => String(permission || '').trim().toLowerCase())
    : [];
  return permissions.includes('*') || permissions.includes(DASHBOARD_KYC_SANDBOX_PERMISSION);
}

async function resolveDocumentRequestRuntime(req, driverId) {
  const requestedScope = requestedKycScope(req);
  if (requestedScope === 'sandbox' && !canAccessKycSandbox(req.user)) {
    throw new DashboardUserManagementError(
      'Acesso ao ambiente sandbox negado',
      403,
      'KYC_DASHBOARD_SANDBOX_ACCESS_DENIED'
    );
  }
  const runtime = await kycRuntimeScopeService.resolveForUser({ userId: driverId });
  if (runtime?.scope?.namespace !== requestedScope) {
    throw new DashboardUserManagementError(
      'O cadastro pertence a outro ambiente',
      409,
      'KYC_DASHBOARD_SCOPE_USER_MISMATCH'
    );
  }
  if (!runtime.scope.financialContext || !runtime.scope.financialContextId) {
    throw new DashboardUserManagementError(
      'Contexto KYC indisponivel',
      503,
      'KYC_DASHBOARD_RUNTIME_UNAVAILABLE'
    );
  }
  return runtime;
}

function documentRequestAuditEnvelope(runtime) {
  const scope = runtime.scope;
  return {
    financialContext: scope.financialContext,
    financialNamespace: scope.namespace,
    financialContextId: scope.financialContextId,
    providerEnvironment: scope.financialContext.providerEnvironment,
    paymentProfileId: scope.financialContext.paymentProfileId || null,
    testUserSandbox: scope.financialContext.testUserSandbox === true
  };
}

function handleDashboardUserManagementError(error, res, context = {}) {
  if (error instanceof DashboardUserManagementError) {
    return res.status(error.statusCode || 400).json({
      success: false,
      code: error.code,
      error: error.message
    });
  }

  logError(error, 'Erro em rota de gestao operacional de usuarios', {
    service: 'user-management-routes',
    ...context
  });
  return res.status(500).json({
    success: false,
    error: 'Erro interno do servidor'
  });
}

router.post(
  '/api/users/:userId/status',
  authenticateJWT,
  requireRole(DASHBOARD_OPERATION_MUTATION_ROLES),
  async (req, res) => {
    try {
      const result = await updateUserOperationalStatus(req.params.userId, req.body || {}, {
        operator: {
          id: req.user?.id || req.user?.userId || null,
          email: req.user?.email || null,
          role: req.user?.role || null
        }
      });
      return res.json(result);
    } catch (error) {
      return handleDashboardUserManagementError(error, res, {
        operation: 'updateUserOperationalStatus',
        userId: req.params.userId
      });
    }
  }
);

router.post(
  '/api/drivers/:driverId/documents/:documentType/request',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    try {
      const runtime = await resolveDocumentRequestRuntime(req, req.params.driverId);
      const auditEnvelope = documentRequestAuditEnvelope(runtime);
      const auditMutationId = `document_request_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
      const auditIntent = await auditService.requireEvent({
        userId: req.user?.id || req.user?.userId || req.user?.email,
        action: 'dashboard.driver.document.request_intent',
        resource: 'driver_document',
        severity: 'WARNING',
        details: {
          mutationId: auditMutationId,
          targetDriverId: req.params.driverId,
          documentType: req.params.documentType,
          operatorEmail: req.user?.email || null,
          operatorRole: req.user?.role || null
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'] || 'unknown',
        success: true,
        ...auditEnvelope
      });
      const result = await requestDriverDocument(
        req.params.driverId,
        req.params.documentType,
        req.body || {},
        {
          operator: {
            id: req.user?.id || req.user?.userId || null,
            email: req.user?.email || null,
            role: req.user?.role || null
          },
          auditIntentId: auditIntent.logId,
          auditMutationId,
          auditEnvelope,
          auditMetadata: {
            ip: req.ip,
            userAgent: req.headers['user-agent'] || 'unknown'
          }
        }
      );
      return res.json(result);
    } catch (error) {
      return handleDashboardUserManagementError(error, res, {
        operation: 'requestDriverDocument',
        driverId: req.params.driverId,
        documentType: req.params.documentType
      });
    }
  }
);

module.exports = router;
