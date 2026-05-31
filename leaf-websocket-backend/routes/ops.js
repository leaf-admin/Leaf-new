const express = require('express');
const { authenticateSupport, requireSupportRoles } = require('../middleware/support-auth');
const safetyIncidentService = require('../services/safety-incident-service');
const passengerTrustService = require('../services/passenger-trust-service');
const operationalAreaPolicyService = require('../services/operational-area-policy-service');
const disputeReviewService = require('../services/dispute-review-service');
const opsOverviewService = require('../services/ops-overview-service');
const rideCostTelemetryService = require('../services/ride-cost-telemetry-service');
const rideCostAlertService = require('../services/ride-cost-alert-service');
const dailyEarningsReportService = require('../services/daily-earnings-report-service');
const backofficeCommandCenterService = require('../services/backoffice-command-center-service');
const backofficeCostGuardService = require('../services/backoffice-cost-guard-service');
const { logError } = require('../utils/logger');

const router = express.Router();
const OPS_ROLES = ['admin', 'manager', 'super-admin', 'support', 'development', 'viewer'];
const MUTATION_ROLES = ['admin', 'manager', 'super-admin', 'support', 'development'];

router.use(authenticateSupport, requireSupportRoles(OPS_ROLES));

function userCanBypassCommandCenterCache(user = {}) {
  const roleCandidates = [
    user.role,
    user.userType,
    user.usertype,
    ...(Array.isArray(user.roles) ? user.roles : [])
  ]
    .filter(Boolean)
    .map((role) => String(role).trim().toLowerCase());

  return roleCandidates.some((role) => MUTATION_ROLES.includes(role));
}

function buildFirestoreCostActionItem(costGuard = {}) {
  if (!['warning', 'danger', 'limit'].includes(costGuard.budgetStatus)) {
    return null;
  }

  return {
    id: 'firestore-read-budget',
    priority: costGuard.budgetStatus === 'limit' || costGuard.budgetStatus === 'danger' ? 'alta' : 'media',
    title: costGuard.budgetStatus === 'limit'
      ? 'Teto de leituras Firestore atingido'
      : 'Leituras Firestore em atenção',
    description: `${costGuard.budgetUsagePercent}% do orçamento diário estimado usado no backoffice.`,
    href: '/dashboard'
  };
}

router.get('/command-center', async (req, res) => {
  try {
    const requestedForceRefresh =
      req.query?.forceRefresh === 'true' || req.query?.force === 'true';
    const forceRefresh = requestedForceRefresh && userCanBypassCommandCenterCache(req.user);
    const snapshot = await backofficeCommandCenterService.getSnapshot({
      hours: req.query?.hours,
      period: req.query?.period,
      forceRefresh
    });

    const costGuard = await backofficeCostGuardService.recordEndpointReadEstimate('ops.commandCenter', {
      cacheStatus: snapshot.cache?.status || 'UNKNOWN'
    });
    const firestoreActionItem = buildFirestoreCostActionItem(costGuard);
    backofficeCostGuardService.setHeaders(res, costGuard);
    res.set('X-Leaf-Command-Center-Cache', snapshot.cache?.status || 'UNKNOWN');
    res.json({
      ...snapshot,
      actionItems: firestoreActionItem
        ? [firestoreActionItem, ...(snapshot.actionItems || [])].slice(0, 8)
        : snapshot.actionItems,
      costControls: {
        ...(snapshot.costControls || {}),
        firestoreReadGuard: costGuard
      }
    });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'command-center' });
    res.status(500).json({ success: false, error: 'Erro ao buscar command center operacional' });
  }
});

router.get('/overview', async (req, res) => {
  try {
    const { hours = 1, city = null, regionHash = null } = req.query;
    const overview = await opsOverviewService.getOverview({ hours, city, regionHash });
    res.json({ success: true, overview });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'overview' });
    res.status(500).json({ success: false, error: 'Erro ao buscar overview operacional' });
  }
});

router.get('/alerts', async (req, res) => {
  try {
    const { hours = 1, city = null, regionHash = null } = req.query;
    const alerts = await opsOverviewService.getAlerts({ hours, city, regionHash });
    res.json({ success: true, alerts });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'alerts' });
    res.status(500).json({ success: false, error: 'Erro ao buscar alertas operacionais' });
  }
});

router.get('/ride-cost-telemetry', async (req, res) => {
  try {
    const limit = Math.max(
      1,
      Math.min(50, Number.parseInt(req.query?.limit || '10', 10) || 10)
    );
    const reports = await rideCostTelemetryService.getRecentReports(limit);
    return res.json({
      success: true,
      count: reports.length,
      reports
    });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'listRideCostTelemetry' });
    return res.status(500).json({ success: false, error: 'Erro ao listar telemetria de custo' });
  }
});

router.get('/ride-cost-telemetry/summary', async (req, res) => {
  try {
    const summary = await rideCostAlertService.collectRecentCostSummary();
    return res.json({
      success: true,
      summary
    });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'rideCostTelemetrySummary' });
    return res.status(500).json({ success: false, error: 'Erro ao resumir telemetria de custo' });
  }
});

router.get('/ride-cost-telemetry/:bookingId', async (req, res) => {
  try {
    const bookingId = String(req.params?.bookingId || '').trim();
    if (!bookingId) {
      return res.status(400).json({ success: false, error: 'bookingId é obrigatório' });
    }

    const report = await rideCostTelemetryService.getReport(bookingId);
    if (!report) {
      return res.status(404).json({
        success: false,
        bookingId,
        found: false
      });
    }

    return res.json({
      success: true,
      bookingId,
      report
    });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'getRideCostTelemetry' });
    return res.status(500).json({ success: false, error: 'Erro ao buscar telemetria da corrida' });
  }
});

router.get('/daily-earnings-report', async (req, res) => {
  try {
    const dateKey = String(req.query?.date || '').trim() || undefined;
    const summary = await dailyEarningsReportService.getDailySummary(dateKey);
    return res.json({
      success: true,
      summary
    });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'dailyEarningsReportSummary' });
    return res.status(500).json({ success: false, error: 'Erro ao buscar relatorio diario de earnings' });
  }
});

router.post('/daily-earnings-report/send', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const dateKey = String(req.body?.date || req.query?.date || '').trim() || undefined;
    const force = req.body?.force === true || req.query?.force === 'true';
    const result = await dailyEarningsReportService.sendDailyReport(dateKey, { force });
    return res.json({
      success: true,
      result
    });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'sendDailyEarningsReport' });
    return res.status(500).json({ success: false, error: 'Erro ao enviar relatorio diario de earnings' });
  }
});

router.get('/incidents', async (req, res) => {
  try {
    const incidents = await safetyIncidentService.listIncidents(req.query);
    res.json({ success: true, incidents });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'listIncidents' });
    res.status(500).json({ success: false, error: 'Erro ao listar incidentes' });
  }
});

router.get('/incidents/:incidentId', async (req, res) => {
  try {
    const incident = await safetyIncidentService.getIncident(req.params.incidentId);
    if (!incident) {
      return res.status(404).json({ success: false, error: 'Incidente não encontrado' });
    }
    return res.json({ success: true, incident });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'getIncident' });
    return res.status(500).json({ success: false, error: 'Erro ao buscar incidente' });
  }
});

router.post('/incidents/:incidentId/ack', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const incident = await safetyIncidentService.ackIncident(req.params.incidentId, {
      actorId: req.user?.uid || req.user?.id || 'ops',
      assignedTo: req.body?.assignedTo || null,
      note: req.body?.note || null
    });
    res.json({ success: true, incident });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'ackIncident' });
    res.status(500).json({ success: false, error: error.message || 'Erro ao reconhecer incidente' });
  }
});

router.post('/incidents/:incidentId/resolve', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const incident = await safetyIncidentService.resolveIncident(req.params.incidentId, {
      actorId: req.user?.uid || req.user?.id || 'ops',
      resolutionCode: req.body?.resolutionCode || null,
      note: req.body?.note || null,
      close: req.body?.close === true
    });
    res.json({ success: true, incident });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'resolveIncident' });
    res.status(500).json({ success: false, error: error.message || 'Erro ao resolver incidente' });
  }
});

router.get('/passengers/:userId/trust', async (req, res) => {
  try {
    const profile = await passengerTrustService.getProfile(req.params.userId);
    res.json({ success: true, profile });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'getPassengerTrust' });
    res.status(500).json({ success: false, error: 'Erro ao buscar perfil de trust' });
  }
});

router.post('/passengers/:userId/watchlist', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const profile = await passengerTrustService.watchlistPassenger(req.params.userId, {
      operatorId: req.user?.uid || req.user?.id || 'ops',
      reasonCode: req.body?.reasonCode || 'manual_watchlist',
      evidenceRefs: req.body?.evidenceRefs || [],
      notes: req.body?.notes || null
    });
    res.json({ success: true, profile });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'watchlistPassenger' });
    res.status(500).json({ success: false, error: 'Erro ao colocar passageiro em watchlist' });
  }
});

router.post('/passengers/:userId/block', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const profile = await passengerTrustService.blockPassenger(req.params.userId, {
      operatorId: req.user?.uid || req.user?.id || 'ops',
      reasonCode: req.body?.reasonCode || 'manual_block',
      evidenceRefs: req.body?.evidenceRefs || [],
      notes: req.body?.notes || null,
      expiresAt: req.body?.expiresAt || null,
      soft: req.body?.soft === true
    });
    res.json({ success: true, profile });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'blockPassenger' });
    res.status(500).json({ success: false, error: 'Erro ao bloquear passageiro' });
  }
});

router.post('/passengers/:userId/unblock', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const profile = await passengerTrustService.unblockPassenger(req.params.userId, {
      operatorId: req.user?.uid || req.user?.id || 'ops',
      reasonCode: req.body?.reasonCode || 'manual_unblock',
      evidenceRefs: req.body?.evidenceRefs || [],
      notes: req.body?.notes || null
    });
    res.json({ success: true, profile });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'unblockPassenger' });
    res.status(500).json({ success: false, error: 'Erro ao desbloquear passageiro' });
  }
});

router.get('/areas/policies', async (req, res) => {
  try {
    const policies = await operationalAreaPolicyService.listPolicies(req.query);
    res.json({ success: true, policies });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'listPolicies' });
    res.status(500).json({ success: false, error: 'Erro ao listar políticas operacionais' });
  }
});

router.post('/areas/policies', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const policy = await operationalAreaPolicyService.createPolicy({
      ...req.body,
      actorId: req.user?.uid || req.user?.id || 'ops'
    });
    res.status(201).json({ success: true, policy });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'createPolicy' });
    res.status(500).json({ success: false, error: error.message || 'Erro ao criar política operacional' });
  }
});

router.post('/areas/policies/:policyId/activate', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const policy = await operationalAreaPolicyService.activatePolicy(req.params.policyId, {
      actorId: req.user?.uid || req.user?.id || 'ops'
    });
    res.json({ success: true, policy });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'activatePolicy' });
    res.status(500).json({ success: false, error: error.message || 'Erro ao ativar política operacional' });
  }
});

router.post('/areas/policies/:policyId/deactivate', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const policy = await operationalAreaPolicyService.deactivatePolicy(req.params.policyId, {
      actorId: req.user?.uid || req.user?.id || 'ops'
    });
    res.json({ success: true, policy });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'deactivatePolicy' });
    res.status(500).json({ success: false, error: error.message || 'Erro ao desativar política operacional' });
  }
});

router.get('/disputes', async (req, res) => {
  try {
    const disputes = await disputeReviewService.listDisputes(req.query);
    res.json({ success: true, disputes });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'listDisputes' });
    res.status(500).json({ success: false, error: 'Erro ao listar disputas' });
  }
});

router.post('/disputes', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const dispute = await disputeReviewService.createDispute(req.body);
    res.status(201).json({ success: true, dispute });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'createDispute' });
    res.status(500).json({ success: false, error: error.message || 'Erro ao criar disputa' });
  }
});

router.post('/disputes/:disputeId/decision', requireSupportRoles(MUTATION_ROLES), async (req, res) => {
  try {
    const dispute = await disputeReviewService.decideDispute(req.params.disputeId, {
      ...req.body,
      actorId: req.user?.uid || req.user?.id || 'ops'
    });
    res.json({ success: true, dispute });
  } catch (error) {
    logError(error, { service: 'ops-routes', operation: 'decideDispute' });
    res.status(500).json({ success: false, error: error.message || 'Erro ao decidir disputa' });
  }
});

module.exports = router;
