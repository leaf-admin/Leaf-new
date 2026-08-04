const {
  isLaunchFeatureEnabled,
  buildLaunchFeatureDisabledPayload
} = require('../utils/pilot-launch-flags');
const { logStructured } = require('../utils/logger');

function buildAuditOperator(user = {}) {
  return {
    id: user.id || user.uid || null,
    email: user.email || null,
    role: user.role || null
  };
}

/**
 * Blocks optional dashboard mutations while the launch profile is read-only.
 * Authentication and role checks must run before this middleware.
 */
function requireAdminMutationsEnabled(req, res, next) {
  if (isLaunchFeatureEnabled('adminMutationsEnabled', true)) {
    return next();
  }

  logStructured('warn', 'Mutação administrativa bloqueada pelo perfil de lançamento', {
    service: 'admin-mutation-guard',
    operation: 'admin-mutation-guard',
    action: 'admin_mutation.blocked',
    entity: { type: 'dashboard_mutation', id: null },
    operator: buildAuditOperator(req.user || {}),
    path: req.originalUrl || req.url,
    method: req.method,
    adminUserId: req.user?.id || req.user?.uid || null,
    adminRole: req.user?.role || null
  });

  return res.status(503).json(
    buildLaunchFeatureDisabledPayload(
      'admin_mutations',
      'Mutações administrativas estão desativadas neste perfil de lançamento'
    )
  );
}

module.exports = { requireAdminMutationsEnabled };
