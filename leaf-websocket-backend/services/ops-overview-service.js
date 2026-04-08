const redisPool = require('../utils/redis-pool');
const metricsCollector = require('./metrics-collector');
const rideHealthMonitor = require('./ride-health-monitor');
const safetyIncidentService = require('./safety-incident-service');
const supportQueueService = require('./support-queue-service');
const disputeReviewService = require('./dispute-review-service');
const operationalAreaPolicyService = require('./operational-area-policy-service');

class OpsOverviewService {
  constructor({
    redis = redisPool,
    metrics = metricsCollector,
    rideHealth = rideHealthMonitor,
    incidents = safetyIncidentService,
    supportQueue = supportQueueService,
    disputes = disputeReviewService,
    policies = operationalAreaPolicyService
  } = {}) {
    this.redisPool = redis;
    this.metricsCollector = metrics;
    this.rideHealthMonitor = rideHealth;
    this.safetyIncidentService = incidents;
    this.supportQueueService = supportQueue;
    this.disputeReviewService = disputes;
    this.operationalAreaPolicyService = policies;
  }

  getRedis() {
    return this.redisPool?.getConnection ? this.redisPool.getConnection() : null;
  }

  async getOverview({ hours = 1, city = null, regionHash = null } = {}) {
    const redis = this.getRedis();
    const [
      metrics,
      rideHealth,
      incidents,
      supportQueue,
      disputes,
      activePolicies
    ] = await Promise.all([
      this.metricsCollector.getAllMetrics(Number.parseInt(hours, 10) || 1),
      this.rideHealthMonitor.getRideOperationsSnapshot(redis, {}),
      this.safetyIncidentService.getOpenSummary({ city, regionHash }),
      this.supportQueueService.getQueueSummary({ autoEscalate: true }),
      this.disputeReviewService.getSummary(),
      this.operationalAreaPolicyService.listPolicies({ city, regionHash, activeOnly: true })
    ]);

    return {
      timestamp: new Date().toISOString(),
      scope: {
        hours: Number.parseInt(hours, 10) || 1,
        city: city || null,
        regionHash: regionHash || null
      },
      metrics,
      rideHealth,
      incidents,
      supportQueue: {
        totalOpenTickets: supportQueue.totalOpenTickets,
        backlogByPriority: supportQueue.backlogByPriority,
        overdueAckCount: supportQueue.overdueAckCount,
        overdueFirstResponseCount: supportQueue.overdueFirstResponseCount,
        ticketsWithoutOwner: supportQueue.ticketsWithoutOwner,
        criticalBacklogCount: supportQueue.criticalBacklogCount,
        medianFirstResponseMinutes: supportQueue.medianFirstResponseMinutes
      },
      disputes: {
        openCount: disputes.openCount,
        byStatus: disputes.byStatus
      },
      activePolicies
    };
  }

  async getAlerts({ hours = 1, city = null, regionHash = null } = {}) {
    const overview = await this.getOverview({ hours, city, regionHash });
    const alerts = [];

    const rideHealthAlerts = [];
    const reassignmentAlert = this.rideHealthMonitor.buildReassignmentAlert(overview.rideHealth);
    const reviewAlert = this.rideHealthMonitor.buildReviewAlert(overview.rideHealth);
    if (reassignmentAlert) rideHealthAlerts.push(reassignmentAlert);
    if (reviewAlert) rideHealthAlerts.push(reviewAlert);
    alerts.push(...rideHealthAlerts);

    if (overview.supportQueue.overdueAckCount > 0) {
      alerts.push({
        severity: 'critical',
        metric: 'support_backlog_n1',
        value: overview.supportQueue.overdueAckCount,
        threshold: 0,
        message: `${overview.supportQueue.overdueAckCount} ticket(s) com SLA de ack vencido.`
      });
    }

    if (overview.supportQueue.overdueFirstResponseCount > 0) {
      alerts.push({
        severity: 'warning',
        metric: 'support_first_response_breach',
        value: overview.supportQueue.overdueFirstResponseCount,
        threshold: 0,
        message: `${overview.supportQueue.overdueFirstResponseCount} ticket(s) com SLA de primeira resposta vencido.`
      });
    }

    if (overview.incidents.openCount > 0) {
      alerts.push({
        severity: overview.incidents.bySeverity.critical > 0 ? 'critical' : 'warning',
        metric: 'incident_open_count',
        value: overview.incidents.openCount,
        threshold: 0,
        message: `${overview.incidents.openCount} incidente(s) operacional(is) aberto(s).`
      });
    }

    if (overview.disputes.openCount > 0) {
      alerts.push({
        severity: 'warning',
        metric: 'payment_refund_open',
        value: overview.disputes.openCount,
        threshold: 0,
        message: `${overview.disputes.openCount} disputa(s) financeira(s) aberta(s).`
      });
    }

    return {
      timestamp: overview.timestamp,
      scope: overview.scope,
      alerts
    };
  }
}

const opsOverviewService = new OpsOverviewService();
module.exports = opsOverviewService;
module.exports.OpsOverviewService = OpsOverviewService;
