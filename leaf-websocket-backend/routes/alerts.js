/**
 * 🚨 Alert Routes
 *
 * Rotas para gerenciar e visualizar alertas
 */

const express = require('express');
const router = express.Router();
const alertService = require('../services/alert-service');
const { logStructured, logError } = require('../utils/logger');
const { authenticateSupport, requireSupportRoles } = require('../middleware/support-auth');

const ALERT_READ_ROLES = ['admin', 'manager', 'super-admin', 'viewer', 'development'];
const ALERT_WRITE_ROLES = ['admin', 'manager', 'super-admin', 'development'];

function isAlertWebhookAuthorized(req) {
  const expectedSecret = process.env.ALERT_WEBHOOK_SECRET || process.env.OBSERVABILITY_WEBHOOK_SECRET || '';
  if (!expectedSecret) return true;
  const providedSecret =
    req.get('x-leaf-alert-secret') ||
    req.query.secret ||
    req.body?.secret ||
    '';
  return providedSecret === expectedSecret;
}

function normalizePrometheusAlert(rawAlert = {}, defaultStatus = 'firing') {
  const labels = rawAlert.labels || {};
  const annotations = rawAlert.annotations || {};
  const status = rawAlert.status || defaultStatus;
  const alertName = labels.alertname || labels.alert || 'prometheus_alert';
  const service = labels.service || labels.job || 'leaf-backend';
  const severity = String(labels.severity || 'warning').toLowerCase() === 'critical'
    ? 'critical'
    : 'warning';
  const description =
    annotations.description ||
    annotations.message ||
    annotations.summary ||
    `${alertName} ${status}`;

  return {
    severity,
    metric: alertName,
    service,
    value: annotations.value || labels.value || status,
    threshold: annotations.threshold || labels.threshold || '-',
    unit: '',
    message: status === 'resolved'
      ? `RESOLVIDO: ${description}`
      : description,
    source: 'prometheus-alertmanager',
    fingerprint: rawAlert.fingerprint || null,
    startsAt: rawAlert.startsAt || null,
    endsAt: rawAlert.endsAt || null
  };
}

/**
 * POST /webhook/prometheus
 * Entrada para Alertmanager/Grafana encaminharem alertas para o alertService.
 *
 * Segurança:
 * - Em produção, configure ALERT_WEBHOOK_SECRET e envie o mesmo valor em
 *   x-leaf-alert-secret ou no query param ?secret=...
 * - Em ambiente local sem secret, a rota fica aberta apenas para facilitar
 *   Alertmanager em rede Docker local.
 */
router.post('/webhook/prometheus', async (req, res) => {
  if (!isAlertWebhookAuthorized(req)) {
    return res.status(401).json({
      success: false,
      error: 'Webhook de alerta não autorizado'
    });
  }

  try {
    const sendResolved = process.env.ALERT_WEBHOOK_SEND_RESOLVED === 'true';
    const incomingAlerts = Array.isArray(req.body?.alerts)
      ? req.body.alerts
      : [req.body].filter(Boolean);
    const defaultStatus = req.body?.status || 'firing';
    const alerts = incomingAlerts
      .map((item) => normalizePrometheusAlert(item, defaultStatus))
      .filter((item) => sendResolved || !String(item.message || '').startsWith('RESOLVIDO:'));

    await Promise.all(alerts.map((alert) => alertService.sendAlert(alert)));

    logStructured('info', 'Webhook de alertas processado', {
      service: 'alerts-routes',
      operation: 'prometheus-webhook',
      received: incomingAlerts.length,
      sent: alerts.length
    });

    return res.json({
      success: true,
      received: incomingAlerts.length,
      sent: alerts.length
    });
  } catch (error) {
    logError(error, 'Erro ao processar webhook de alertas', {
      service: 'alerts-routes',
      operation: 'prometheus-webhook'
    });
    return res.status(500).json({
      success: false,
      error: 'Erro ao processar webhook de alertas'
    });
  }
});

router.use(authenticateSupport, requireSupportRoles(ALERT_READ_ROLES));

/**
 * GET /
 * Listar alertas recentes
 */
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const severity = req.query.severity; // 'warning' | 'critical'

    let alerts = alertService.getAlertHistory(limit);

    // Filtrar por severidade se especificado
    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }

    res.json({
      success: true,
      count: alerts.length,
      alerts: alerts
    });
  } catch (error) {
    logError(error, 'Erro ao listar alertas', {
      service: 'alerts-routes',
      operation: 'list'
    });
    res.status(500).json({
      success: false,
      error: 'Erro ao listar alertas'
    });
  }
});

/**
 * GET /stats
 * Obter estatísticas de alertas
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = alertService.getAlertStats();

    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    logError(error, 'Erro ao obter estatísticas de alertas', {
      service: 'alerts-routes',
      operation: 'stats'
    });
    res.status(500).json({
      success: false,
      error: 'Erro ao obter estatísticas'
    });
  }
});

/**
 * POST /test
 * Testar envio de alerta (para desenvolvimento)
 */
router.post('/test', async (req, res) => {
  const requireWriteRole = requireSupportRoles(ALERT_WRITE_ROLES);
  return requireWriteRole(req, res, async () => {
    try {
      const {
        severity = 'warning',
        metric = 'test_metric',
        service = 'test-service',
        message,
        value = 100,
        threshold = 80,
        unit = '%'
      } = req.body;

      await alertService.sendAlert({
        severity,
        metric,
        value,
        threshold,
        unit,
        message: message || `Teste de alerta ${severity}`,
        service
      });

      res.json({
        success: true,
        message: 'Alerta de teste enviado'
      });
    } catch (error) {
      logError(error, 'Erro ao enviar alerta de teste', {
        service: 'alerts-routes',
        operation: 'test'
      });
      res.status(500).json({
        success: false,
        error: 'Erro ao enviar alerta de teste'
      });
    }
  });
});

module.exports = router;
