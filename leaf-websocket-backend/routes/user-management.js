const express = require('express');
const { authenticateJWT, requireRole } = require('../middleware/jwt-auth');
const {
  DashboardUserManagementError,
  updateUserOperationalStatus,
  requestDriverDocument
} = require('../services/dashboard-user-management-service');
const { logError } = require('../utils/logger');

const router = express.Router();
const DASHBOARD_OPERATION_ROLES = ['admin', 'super-admin', 'manager', 'support', 'development'];

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
  requireRole(DASHBOARD_OPERATION_ROLES),
  async (req, res) => {
    try {
      const result = await updateUserOperationalStatus(req.params.userId, req.body || {}, {
        operator: {
          id: req.user?.id || null,
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
  requireRole(DASHBOARD_OPERATION_ROLES),
  async (req, res) => {
    try {
      const result = await requestDriverDocument(
        req.params.driverId,
        req.params.documentType,
        req.body || {},
        {
          operator: {
            id: req.user?.id || null,
            email: req.user?.email || null,
            role: req.user?.role || null
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
