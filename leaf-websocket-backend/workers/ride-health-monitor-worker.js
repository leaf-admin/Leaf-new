#!/usr/bin/env node

const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');
const { backfillRideHealthIndex, evaluateRideOperationsAlerts } = require('../services/ride-health-monitor');
const RedisLeaderLease = require('../utils/redis-leader-lease');
const { buildWorkerConsumerName } = require('./worker-consumer-identity');

const DEFAULT_INTERVAL_MS = Number.parseInt(process.env.RIDE_HEALTH_MONITOR_INTERVAL_MS || '60000', 10);

function getWorkerConfig(env = process.env, argv = process.argv.slice(2)) {
  const runOnce = argv.includes('--once') || String(env.RIDE_HEALTH_MONITOR_EXIT_AFTER_RUN || 'false') === 'true';
  const backfillOnBoot = argv.includes('--backfill') || String(env.RIDE_HEALTH_MONITOR_BACKFILL_ON_BOOT || 'false') === 'true';

  return {
    enabled: String(env.ENABLE_RIDE_HEALTH_MONITOR_WORKER || 'false') === 'true',
    intervalMs: Math.max(
      15000,
      Number.parseInt(env.RIDE_HEALTH_MONITOR_INTERVAL_MS || `${DEFAULT_INTERVAL_MS}`, 10) || DEFAULT_INTERVAL_MS
    ),
    runOnBoot: String(env.RIDE_HEALTH_MONITOR_RUN_ON_BOOT || 'true') !== 'false',
    backfillOnBoot,
    leaderKey: env.RIDE_HEALTH_MONITOR_WORKER_LEADER_KEY || 'leaf:runtime:ride-health-monitor-worker:leader',
    leaderTtlMs: Math.max(
      3000,
      Number.parseInt(env.RIDE_HEALTH_MONITOR_WORKER_LEADER_TTL_MS || '30000', 10) || 30000
    ),
    leaderRenewIntervalMs: Math.max(
      500,
      Number.parseInt(env.RIDE_HEALTH_MONITOR_WORKER_LEADER_RENEW_INTERVAL_MS || '10000', 10) || 10000
    ),
    runOnce
  };
}

let intervalHandle = null;
let cycleInFlight = false;

async function runRideHealthMonitorCycle(reason = 'interval') {
  if (cycleInFlight) {
    logStructured('warn', 'Ciclo de ride health ignorado por overlap', {
      service: 'ride-health-monitor-worker',
      reason
    });
    return {
      success: false,
      skipped: true,
      reason: 'overlap'
    };
  }

  cycleInFlight = true;

  try {
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const config = getWorkerConfig();
    const leaderLease = new RedisLeaderLease(redis, {
      key: config.leaderKey,
      ttlMs: config.leaderTtlMs,
      renewIntervalMs: config.leaderRenewIntervalMs,
      ownerId: buildWorkerConsumerName('ride-health-monitor-worker'),
      logger: {
        warn: (message, details) => logStructured('warn', message, {
          service: 'ride-health-monitor-worker',
          ...details
        })
      }
    });
    const isLeader = await leaderLease.acquire();

    if (!isLeader) {
      logStructured('info', 'Ciclo de ride health ignorado; outra réplica está executando', {
        service: 'ride-health-monitor-worker',
        reason
      });
      return {
        success: false,
        skipped: true,
        reason: 'not_leader'
      };
    }

    try {
      let backfill = null;

      if (config.backfillOnBoot && (reason === 'boot' || reason === 'manual_once')) {
        backfill = await backfillRideHealthIndex(redis, {
          nowIso: new Date().toISOString()
        });
      }

      const result = await evaluateRideOperationsAlerts(redis, {
        nowIso: new Date().toISOString()
      });

      logStructured('info', 'Ciclo de ride health concluído', {
        service: 'ride-health-monitor-worker',
        reason,
        reassignmentPending: result.snapshot.reassignmentPending.total,
        reassignmentPendingStuck: result.snapshot.reassignmentPending.stuck,
        earlyEndedReviewRecent: result.snapshot.earlyEndedReview.recent,
        backfill,
        alerts: result.alerts.length
      });

      return {
        success: true,
        backfill,
        ...result
      };
    } finally {
      await leaderLease.release();
    }
  } catch (error) {
    logError(error, 'Falha no ciclo de ride health', {
      service: 'ride-health-monitor-worker',
      reason
    });

    return {
      success: false,
      error
    };
  } finally {
    cycleInFlight = false;
  }
}

async function startRideHealthMonitorWorker() {
  const config = getWorkerConfig();

  if (!config.enabled && !config.runOnce) {
    logStructured('info', 'Ride health monitor worker desabilitado por flag', {
      service: 'ride-health-monitor-worker'
    });
    return {
      started: false,
      reason: 'disabled'
    };
  }

  metrics.setActiveWorkers(1, 'ride-health-monitor');

  if (config.runOnBoot || config.runOnce) {
    await runRideHealthMonitorCycle(config.runOnce ? 'manual_once' : 'boot');
  }

  if (config.runOnce) {
    metrics.setActiveWorkers(0, 'ride-health-monitor');
    return {
      started: true,
      mode: 'once'
    };
  }

  intervalHandle = setInterval(() => {
    runRideHealthMonitorCycle('interval');
  }, config.intervalMs);

  if (typeof intervalHandle.unref === 'function') {
    intervalHandle.unref();
  }

  logStructured('info', 'Ride health monitor worker iniciado', {
    service: 'ride-health-monitor-worker',
    intervalMs: config.intervalMs
  });

  return {
    started: true,
    mode: 'interval',
    intervalMs: config.intervalMs
  };
}

function stopRideHealthMonitorWorker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  metrics.setActiveWorkers(0, 'ride-health-monitor');
}

if (require.main === module) {
  startRideHealthMonitorWorker()
    .then((result) => {
      if (result?.mode === 'once') {
        process.exit(0);
      }
    })
    .catch((error) => {
      logError(error, 'Erro fatal ao iniciar ride health monitor worker', {
        service: 'ride-health-monitor-worker'
      });
      process.exit(1);
    });

  const shutdown = () => {
    stopRideHealthMonitorWorker();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  getWorkerConfig,
  runRideHealthMonitorCycle,
  startRideHealthMonitorWorker,
  stopRideHealthMonitorWorker
};
