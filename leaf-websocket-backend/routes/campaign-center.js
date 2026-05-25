const express = require('express');
const admin = require('firebase-admin');
const multer = require('multer');
const { authenticateJWT, requireRole } = require('../middleware/jwt-auth');
const campaignCenterService = require('../services/campaign-center-service');
const { logError, logStructured } = require('../utils/logger');
const {
  isLaunchFeatureEnabled,
  buildLaunchFeatureDisabledPayload
} = require('../utils/pilot-launch-flags');

const router = express.Router();
const ADMIN_ROLES = ['admin', 'super-admin', 'manager', 'development'];
const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (allowed.has(file.mimetype)) return cb(null, true);
    return cb(new Error('Use uma imagem JPG, PNG ou WebP'), false);
  }
});

function handleAssetUpload(req, res, next) {
  assetUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    const status = error instanceof multer.MulterError ? 400 : 400;
    return res.status(status).json({
      success: false,
      error: error.message || 'Falha ao processar imagem'
    });
  });
}

function buildAuditOperator(user = {}) {
  return {
    id: user.id || user.uid || null,
    email: user.email || null,
    role: user.role || null
  };
}

function requireCampaignCenterEnabled(req, res, next) {
  if (isLaunchFeatureEnabled('campaignCenterEnabled', true)) {
    return next();
  }

  return res.status(503).json(
    buildLaunchFeatureDisabledPayload(
      'campaign_center',
      'Campaign Center esta desativado neste perfil de lancamento'
    )
  );
}

function requireAdminMutationsEnabled(req, res, next) {
  if (isLaunchFeatureEnabled('adminMutationsEnabled', true)) {
    return next();
  }

  logStructured('warn', 'Mutacao admin de Campaign Center bloqueada por feature flag', {
    service: 'campaign-center',
    operation: 'admin-mutation-guard',
    action: 'campaign_center.admin_mutation.blocked',
    entity: { type: 'campaign_center', id: null },
    operator: buildAuditOperator(req.user || {}),
    path: req.originalUrl || req.url,
    adminUserId: req.user?.id || null,
    adminRole: req.user?.role || null
  });

  return res.status(503).json(
    buildLaunchFeatureDisabledPayload(
      'admin_mutations',
      'Mutacoes administrativas estao desativadas neste perfil de lancamento'
    )
  );
}

async function attachOptionalFirebaseUser(req, _res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = authHeader.slice('Bearer '.length);
    req.firebaseUser = await admin.auth().verifyIdToken(token);
  } catch (error) {
    logStructured('debug', 'Token Firebase opcional ignorado em Campaign Center', {
      service: 'campaign-center',
      operation: 'optional-firebase-auth',
      error: error.message
    });
  }
  return next();
}

function buildContextFromRequest(req) {
  const source = req.method === 'GET' ? req.query : req.body;
  return {
    userId: req.firebaseUser?.uid || null,
    role: source.role || source.userType || req.query.role || req.query.userType,
    surface: source.surface || req.query.surface,
    placement: source.placement || req.query.placement,
    platform: source.platform || req.query.platform,
    appVersion: source.appVersion || req.query.appVersion,
    city: source.city || req.query.city,
    completedTrips: source.completedTrips || req.query.completedTrips,
    limit: source.limit || req.query.limit
  };
}

router.use(requireCampaignCenterEnabled);

router.get('/campaigns', authenticateJWT, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const campaigns = await campaignCenterService.listCampaigns(req.query || {});
    const stats = await campaignCenterService.getStats(req.query || {});
    return res.json({ success: true, campaigns, stats });
  } catch (error) {
    logError(error, 'Erro ao listar campanhas in-app', {
      service: 'campaign-center',
      operation: 'list-campaigns'
    });
    return res.status(500).json({ success: false, error: 'Falha ao listar campanhas' });
  }
});

router.post(
  '/campaigns',
  authenticateJWT,
  requireRole(ADMIN_ROLES),
  requireAdminMutationsEnabled,
  async (req, res) => {
    try {
      const campaign = await campaignCenterService.createCampaign(req.body || {}, req.user || {});
      logStructured('info', 'Campanha in-app criada', {
        service: 'campaign-center',
        operation: 'create-campaign',
        action: 'campaign_center.campaign.create',
        entity: { type: 'campaign', id: campaign.id },
        operator: buildAuditOperator(req.user || {}),
        campaignId: campaign.id,
        adminUserId: req.user?.id || null
      });
      return res.status(201).json({ success: true, campaign });
    } catch (error) {
      logError(error, 'Erro ao criar campanha in-app', {
        service: 'campaign-center',
        operation: 'create-campaign'
      });
      return res.status(500).json({ success: false, error: 'Falha ao criar campanha' });
    }
  }
);

router.get('/campaigns/:campaignId', authenticateJWT, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const campaign = await campaignCenterService.getCampaign(req.params.campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campanha nao encontrada' });
    }
    return res.json({ success: true, campaign });
  } catch (error) {
    logError(error, 'Erro ao buscar campanha in-app', {
      service: 'campaign-center',
      operation: 'get-campaign',
      campaignId: req.params.campaignId
    });
    return res.status(500).json({ success: false, error: 'Falha ao buscar campanha' });
  }
});

router.patch(
  '/campaigns/:campaignId',
  authenticateJWT,
  requireRole(ADMIN_ROLES),
  requireAdminMutationsEnabled,
  async (req, res) => {
    try {
      const campaign = await campaignCenterService.updateCampaign(
        req.params.campaignId,
        req.body || {},
        req.user || {}
      );
      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Campanha nao encontrada' });
      }
      logStructured('info', 'Campanha in-app atualizada', {
        service: 'campaign-center',
        operation: 'update-campaign',
        action: 'campaign_center.campaign.update',
        entity: { type: 'campaign', id: campaign.id },
        operator: buildAuditOperator(req.user || {}),
        campaignId: campaign.id,
        adminUserId: req.user?.id || null
      });
      return res.json({ success: true, campaign });
    } catch (error) {
      logError(error, 'Erro ao atualizar campanha in-app', {
        service: 'campaign-center',
        operation: 'update-campaign',
        campaignId: req.params.campaignId
      });
      return res.status(500).json({ success: false, error: 'Falha ao atualizar campanha' });
    }
  }
);

router.post(
  '/campaigns/:campaignId/preview-eligibility',
  authenticateJWT,
  requireRole(ADMIN_ROLES),
  async (req, res) => {
    try {
      const campaign = await campaignCenterService.getCampaign(req.params.campaignId);
      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Campanha nao encontrada' });
      }

      const result = await campaignCenterService.resolveEligibleCampaigns({
        ...(req.body || {}),
        limit: 10
      });
      return res.json({
        success: true,
        eligible: result.campaigns.some((item) => item.id === campaign.id),
        campaigns: result.campaigns,
        evaluatedAt: result.evaluatedAt
      });
    } catch (error) {
      logError(error, 'Erro no preview de elegibilidade in-app', {
        service: 'campaign-center',
        operation: 'preview-eligibility',
        campaignId: req.params.campaignId
      });
      return res.status(500).json({ success: false, error: 'Falha ao simular elegibilidade' });
    }
  }
);

router.get('/stats', authenticateJWT, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const stats = await campaignCenterService.getStats(req.query || {});
    return res.json({ success: true, stats });
  } catch (error) {
    logError(error, 'Erro ao consolidar stats de campanhas', {
      service: 'campaign-center',
      operation: 'stats'
    });
    return res.status(500).json({ success: false, error: 'Falha ao carregar estatisticas' });
  }
});

router.get('/commercial-report', authenticateJWT, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const report = await campaignCenterService.getCommercialReport(req.query || {});
    return res.json({ success: true, report });
  } catch (error) {
    logError(error, 'Erro ao gerar relatório comercial de campanhas', {
      service: 'campaign-center',
      operation: 'commercial-report'
    });
    return res.status(500).json({ success: false, error: 'Falha ao carregar relatório comercial' });
  }
});

router.get('/slots', authenticateJWT, requireRole(ADMIN_ROLES), async (_req, res) => {
  try {
    return res.json({
      success: true,
      slots: campaignCenterService.getSlotDefinitions()
    });
  } catch (error) {
    logError(error, 'Erro ao listar slots de campanhas', {
      service: 'campaign-center',
      operation: 'slots'
    });
    return res.status(500).json({ success: false, error: 'Falha ao carregar slots' });
  }
});

router.post(
  '/assets',
  authenticateJWT,
  requireRole(ADMIN_ROLES),
  requireAdminMutationsEnabled,
  handleAssetUpload,
  async (req, res) => {
    try {
      const asset = await campaignCenterService.uploadAsset(req.file, req.user || {});
      logStructured('info', 'Asset de campanha enviado', {
        service: 'campaign-center',
        operation: 'upload-asset',
        action: 'campaign_center.asset.upload',
        entity: { type: 'campaign_asset', id: asset.id },
        operator: buildAuditOperator(req.user || {}),
        filePath: asset.filePath,
        fileSize: asset.fileSize,
        contentType: asset.contentType
      });
      return res.status(201).json({ success: true, asset });
    } catch (error) {
      logError(error, 'Erro ao enviar asset de campanha', {
        service: 'campaign-center',
        operation: 'upload-asset'
      });
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Falha ao enviar imagem'
      });
    }
  }
);

router.get('/eligible', attachOptionalFirebaseUser, async (req, res) => {
  try {
    const result = await campaignCenterService.resolveEligibleCampaigns(buildContextFromRequest(req));
    return res.json({ success: true, ...result });
  } catch (error) {
    logError(error, 'Erro ao resolver campanhas elegiveis', {
      service: 'campaign-center',
      operation: 'eligible'
    });
    return res.status(500).json({ success: false, campaigns: [], error: 'Falha ao carregar campanhas' });
  }
});

router.post('/events', attachOptionalFirebaseUser, async (req, res) => {
  try {
    const event = await campaignCenterService.recordEvent({
      ...(req.body || {}),
      userId: req.firebaseUser?.uid || null
    });
    return res.status(201).json({ success: true, event });
  } catch (error) {
    logError(error, 'Erro ao registrar evento de campanha', {
      service: 'campaign-center',
      operation: 'record-event'
    });
    return res.status(400).json({ success: false, error: error.message || 'Falha ao registrar evento' });
  }
});

router.post('/events/batch', attachOptionalFirebaseUser, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const saved = [];
    for (const event of events.slice(0, 50)) {
      saved.push(await campaignCenterService.recordEvent({
        ...event,
        userId: req.firebaseUser?.uid || null
      }));
    }
    return res.status(201).json({ success: true, events: saved });
  } catch (error) {
    logError(error, 'Erro ao registrar lote de eventos de campanha', {
      service: 'campaign-center',
      operation: 'record-event-batch'
    });
    return res.status(400).json({ success: false, error: error.message || 'Falha ao registrar eventos' });
  }
});

module.exports = router;
