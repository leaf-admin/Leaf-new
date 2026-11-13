// Pendências do painel e marcação "em revisão por".
// Custo: o resumo vem do cache compartilhado (ops-pending-service). As
// marcações ficam só no Redis, sem Firestore.

const {
  DASHBOARD_KYC_REVIEW_ROLES,
  DASHBOARD_OPERATION_ROLES,
  admin,
  authenticateJWT,
  logError,
  normalizeId,
  redisPool,
  requireRole,
  router
} = require('./shared');
const { getPendingSummary, notifyPendingChanged } = require('../../services/ops-pending-service');

const REVIEW_CLAIMS_KEY = 'ops:review_claims:v1';
const REVIEW_CLAIM_TTL_MS = 15 * 60 * 1000;

function claimOwner(req) {
  return {
    adminId: String(req.user?.id || req.user?.userId || ''),
    name: String(req.user?.name || req.user?.displayName || req.user?.email || 'Admin'),
    email: req.user?.email || null
  };
}

async function readActiveClaims(redis, now = Date.now()) {
  const raw = await redis.hgetall(REVIEW_CLAIMS_KEY);
  const active = {};
  const expired = [];
  Object.entries(raw || {}).forEach(([driverId, value]) => {
    try {
      const claim = JSON.parse(value);
      if (Number(claim?.expiresAtMs) > now) active[driverId] = claim;
      else expired.push(driverId);
    } catch (_) {
      expired.push(driverId);
    }
  });
  if (expired.length > 0) await redis.hdel(REVIEW_CLAIMS_KEY, ...expired);
  return active;
}

router.get(
  '/api/admin/ops/pending-summary',
  authenticateJWT,
  requireRole(DASHBOARD_OPERATION_ROLES),
  async (req, res) => {
    try {
      const summary = await getPendingSummary({ firestore: admin.firestore() });
      return res.json({ success: true, summary });
    } catch (error) {
      logError(error, 'Erro ao montar pendências do painel', { service: 'dashboard-ops' });
      return res.status(503).json({ success: false, code: 'OPS_PENDING_UNAVAILABLE' });
    }
  }
);

router.get(
  '/api/admin/ops/review-claims',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    try {
      const claims = await readActiveClaims(redisPool.getConnection());
      return res.json({ success: true, claims });
    } catch (error) {
      logError(error, 'Erro ao ler marcações de revisão', { service: 'dashboard-ops' });
      return res.status(503).json({ success: false, code: 'OPS_REVIEW_CLAIMS_UNAVAILABLE' });
    }
  }
);

// Marca (ou renova) "em revisão por mim". Se outra pessoa já marcou e a marca
// não venceu, devolve 409 com quem está revisando, sem sobrescrever.
router.post(
  '/api/admin/ops/review-claims/:driverId',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    const driverId = normalizeId(req.params.driverId);
    if (!driverId) return res.status(400).json({ success: false, code: 'INVALID_DRIVER_ID' });
    try {
      const redis = redisPool.getConnection();
      const owner = claimOwner(req);
      const claims = await readActiveClaims(redis);
      const current = claims[driverId];
      const force = req.body?.force === true;
      if (current && current.adminId !== owner.adminId && !force) {
        return res.status(409).json({ success: false, code: 'REVIEW_ALREADY_CLAIMED', claim: current });
      }
      const now = Date.now();
      const claim = {
        ...owner,
        claimedAt: current?.adminId === owner.adminId ? current.claimedAt : new Date(now).toISOString(),
        expiresAtMs: now + REVIEW_CLAIM_TTL_MS
      };
      await redis.hset(REVIEW_CLAIMS_KEY, driverId, JSON.stringify(claim));
      if (!current || current.adminId !== owner.adminId) notifyPendingChanged('review_claim');
      return res.json({ success: true, claim });
    } catch (error) {
      logError(error, 'Erro ao marcar revisão', { service: 'dashboard-ops', driverId });
      return res.status(503).json({ success: false, code: 'OPS_REVIEW_CLAIMS_UNAVAILABLE' });
    }
  }
);

router.delete(
  '/api/admin/ops/review-claims/:driverId',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    const driverId = normalizeId(req.params.driverId);
    if (!driverId) return res.status(400).json({ success: false, code: 'INVALID_DRIVER_ID' });
    try {
      const redis = redisPool.getConnection();
      const claims = await readActiveClaims(redis);
      const current = claims[driverId];
      if (current && current.adminId === claimOwner(req).adminId) {
        await redis.hdel(REVIEW_CLAIMS_KEY, driverId);
        notifyPendingChanged('review_claim');
      }
      return res.json({ success: true });
    } catch (error) {
      logError(error, 'Erro ao liberar revisão', { service: 'dashboard-ops', driverId });
      return res.status(503).json({ success: false, code: 'OPS_REVIEW_CLAIMS_UNAVAILABLE' });
    }
  }
);

module.exports = { REVIEW_CLAIMS_KEY, readActiveClaims };
