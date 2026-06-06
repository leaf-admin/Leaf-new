const express = require('express');
const admin = require('firebase-admin');
const runtimeConfigService = require('../services/runtime-config-service');
const driverOnlinePolicyService = require('../services/driver-online-policy-service');
const { authenticateSupport, requireSupportRoles } = require('../middleware/support-auth');
const { requireFirebaseUser } = require('../middleware/firebase-user-auth');
const { logError } = require('../utils/logger');

const router = express.Router();
const ADMIN_ROLES = ['admin', 'manager', 'super-admin', 'development'];

function extractBearerToken(req) {
  const header = String(req.headers?.authorization || '').trim();
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim();
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

async function resolveOptionalFirebaseActor(req) {
  const token = extractBearerToken(req);
  if (!token) return null;

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded?.uid) return null;
    return {
      uid: String(decoded.uid),
      id: String(decoded.uid),
      email: decoded.email || null,
      phoneNumber: decoded.phone_number || decoded.phoneNumber || null,
      userType: decoded.userType || decoded.usertype || null,
      authSource: 'firebase'
    };
  } catch (_error) {
    return null;
  }
}

function buildContextFromRequest(req, actor = null) {
  return {
    actor,
    uid: actor?.uid || null,
    userId: actor?.uid || req.query?.userId || null,
    phone: actor?.phoneNumber || req.query?.phone || null,
    phoneNumber: actor?.phoneNumber || req.query?.phoneNumber || null,
    appReview: req.query?.appReview === 'true' || req.headers['x-leaf-app-review'] === 'true'
  };
}

router.get('/app/runtime-config', async (req, res) => {
  try {
    const actor = await resolveOptionalFirebaseActor(req);
    const config = await runtimeConfigService.buildEffectiveConfig(
      buildContextFromRequest(req, actor),
      { forceRefresh: req.query?.forceRefresh === 'true' }
    );
    res.set('Cache-Control', `private, max-age=${config.cacheTtlSeconds || 60}`);
    res.json({
      success: true,
      config
    });
  } catch (error) {
    logError(error, 'Erro ao montar runtime config do app', {
      service: 'runtime-config-routes',
      operation: 'publicRuntimeConfig'
    });
    res.status(503).json({
      success: false,
      error: 'Runtime config indisponível',
      config: runtimeConfigService.buildBaseConfig()
    });
  }
});

router.get(
  '/admin/runtime-config',
  authenticateSupport,
  requireSupportRoles(ADMIN_ROLES),
  async (req, res) => {
    try {
      const context = buildContextFromRequest(req, req.user);
      if (req.query?.phone) context.phone = normalizeDigits(req.query.phone);
      const [config, overrides] = await Promise.all([
        runtimeConfigService.buildEffectiveConfig(context, {
          forceRefresh: req.query?.forceRefresh === 'true'
        }),
        runtimeConfigService.listOverrides({
          includeInactive: String(req.query?.includeInactive || 'true').toLowerCase() !== 'false'
        })
      ]);
      res.json({
        success: true,
        config,
        overrides: overrides.success ? overrides.overrides : [],
        overridesError: overrides.success ? null : overrides.error
      });
    } catch (error) {
      logError(error, 'Erro ao buscar runtime config admin', {
        service: 'runtime-config-routes',
        operation: 'adminRuntimeConfig'
      });
      res.status(500).json({ success: false, error: 'Erro ao buscar runtime config' });
    }
  }
);

router.post(
  '/admin/runtime-config/overrides',
  authenticateSupport,
  requireSupportRoles(ADMIN_ROLES),
  async (req, res) => {
    try {
      const result = await runtimeConfigService.upsertOverride(req.body || {}, req.user || {});
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      logError(error, 'Erro ao salvar runtime override', {
        service: 'runtime-config-routes',
        operation: 'upsertOverride'
      });
      res.status(500).json({ success: false, error: 'Erro ao salvar override' });
    }
  }
);

router.patch(
  '/admin/runtime-config/overrides/:overrideId/status',
  authenticateSupport,
  requireSupportRoles(ADMIN_ROLES),
  async (req, res) => {
    try {
      const result = await runtimeConfigService.updateOverrideStatus(
        req.params.overrideId,
        req.body?.status,
        req.user || {}
      );
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      logError(error, 'Erro ao atualizar status de runtime override', {
        service: 'runtime-config-routes',
        operation: 'updateOverrideStatus'
      });
      res.status(500).json({ success: false, error: 'Erro ao atualizar override' });
    }
  }
);

router.post(
  '/admin/runtime-config/overrides/:overrideId/rollback',
  authenticateSupport,
  requireSupportRoles(ADMIN_ROLES),
  async (req, res) => {
    try {
      const result = await runtimeConfigService.rollbackOverride(req.params.overrideId, req.user || {});
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      logError(error, 'Erro ao fazer rollback de runtime override', {
        service: 'runtime-config-routes',
        operation: 'rollbackOverride'
      });
      res.status(500).json({ success: false, error: 'Erro ao pausar override' });
    }
  }
);

router.get('/drivers/me/online-policy', requireFirebaseUser, async (req, res) => {
  try {
    const policy = await driverOnlinePolicyService.getPolicy(req.authenticatedUser.uid, {
      actor: req.authenticatedUser
    });
    res.status(policy.success ? 200 : 400).json(policy);
  } catch (error) {
    logError(error, 'Erro ao buscar política de motorista online', {
      service: 'runtime-config-routes',
      operation: 'driverOnlinePolicy'
    });
    res.status(500).json({
      success: false,
      canGoOnline: false,
      code: 'DRIVER_ONLINE_POLICY_ERROR',
      message: 'Não foi possível validar seu cadastro agora.'
    });
  }
});

router.post('/drivers/me/online-intent', requireFirebaseUser, async (req, res) => {
  try {
    const policy = await driverOnlinePolicyService.getPolicy(req.authenticatedUser.uid, {
      actor: req.authenticatedUser,
      intent: 'go_online',
      payload: req.body || {}
    });
    res.status(policy.success ? 200 : 400).json(policy);
  } catch (error) {
    logError(error, 'Erro ao avaliar tentativa de ficar online', {
      service: 'runtime-config-routes',
      operation: 'driverOnlineIntent'
    });
    res.status(500).json({
      success: false,
      canGoOnline: false,
      code: 'DRIVER_ONLINE_INTENT_ERROR',
      message: 'Não foi possível validar seu cadastro agora.'
    });
  }
});

module.exports = router;
