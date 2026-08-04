#!/usr/bin/env node

const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');
const { materializePricingBaselines } = require('../services/pricing-baseline-materializer');
const RedisLeaderLease = require('../utils/redis-leader-lease');
const { buildWorkerConsumerName } = require('./worker-consumer-identity');

const DEFAULT_INTERVAL_MS = Number.parseInt(process.env.PRICING_BASELINE_WORKER_INTERVAL_MS || '300000', 10);

function getWorkerConfig(env = process.env, argv = process.argv.slice(2)) {
    const runOnce = argv.includes('--once') || String(env.PRICING_BASELINE_EXIT_AFTER_RUN || 'false') === 'true';

    return {
        enabled: String(env.ENABLE_PRICING_BASELINE_WORKER || 'false') === 'true',
        intervalMs: Math.max(
            15000,
            Number.parseInt(env.PRICING_BASELINE_WORKER_INTERVAL_MS || `${DEFAULT_INTERVAL_MS}`, 10) || DEFAULT_INTERVAL_MS
        ),
        runOnBoot: String(env.PRICING_BASELINE_WORKER_RUN_ON_BOOT || 'true') !== 'false',
        leaderKey: env.PRICING_BASELINE_WORKER_LEADER_KEY || 'leaf:runtime:pricing-baseline-worker:leader',
        leaderTtlMs: Math.max(
            3000,
            Number.parseInt(env.PRICING_BASELINE_WORKER_LEADER_TTL_MS || '60000', 10) || 60000
        ),
        leaderRenewIntervalMs: Math.max(
            500,
            Number.parseInt(env.PRICING_BASELINE_WORKER_LEADER_RENEW_INTERVAL_MS || '20000', 10) || 20000
        ),
        runOnce
    };
}

let intervalHandle = null;
let cycleInFlight = false;

async function runPricingBaselineCycle(reason = 'interval') {
    if (cycleInFlight) {
        logStructured('warn', 'Ciclo de pricing baseline ignorado por overlap', {
            service: 'pricing-baseline-worker',
            reason
        });
        return {
            success: false,
            skipped: true,
            reason: 'overlap'
        };
    }

    cycleInFlight = true;
    const startedAt = Date.now();

    try {
        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();
        const config = getWorkerConfig();
        const leaderLease = new RedisLeaderLease(redis, {
            key: config.leaderKey,
            ttlMs: config.leaderTtlMs,
            renewIntervalMs: config.leaderRenewIntervalMs,
            ownerId: buildWorkerConsumerName('pricing-baseline-worker'),
            logger: {
                warn: (message, details) => logStructured('warn', message, {
                    service: 'pricing-baseline-worker',
                    ...details
                })
            }
        });
        const isLeader = await leaderLease.acquire();

        if (!isLeader) {
            logStructured('info', 'Ciclo de pricing baseline ignorado; outra réplica está executando', {
                service: 'pricing-baseline-worker',
                reason
            });
            return {
                success: false,
                skipped: true,
                reason: 'not_leader'
            };
        }

        try {
            const summary = await materializePricingBaselines({
                redis,
                nowIso: new Date().toISOString()
            });

            logStructured('info', 'Ciclo de pricing baseline concluído', {
                service: 'pricing-baseline-worker',
                reason,
                processedCells: summary.processedCells,
                failedCells: summary.failedCells,
                candidateCells: summary.candidateCells
            });

            return {
                success: true,
                summary
            };
        } finally {
            await leaderLease.release();
        }
    } catch (error) {
        logError(error, 'Falha no ciclo de pricing baseline', {
            service: 'pricing-baseline-worker',
            reason
        });

        metrics.recordPricingBaselineMaterialization({
            success: false,
            durationSeconds: (Date.now() - startedAt) / 1000,
            candidateCells: 0,
            processedCells: 0,
            failedCells: 0
        });

        return {
            success: false,
            error
        };
    } finally {
        cycleInFlight = false;
    }
}

async function startPricingBaselineWorker() {
    const config = getWorkerConfig();

    if (!config.enabled && !config.runOnce) {
        logStructured('info', 'Pricing baseline worker desabilitado por flag', {
            service: 'pricing-baseline-worker'
        });
        return {
            started: false,
            reason: 'disabled'
        };
    }

    metrics.setActiveWorkers(1, 'pricing-baseline');

    if (config.runOnBoot || config.runOnce) {
        await runPricingBaselineCycle(config.runOnce ? 'manual_once' : 'boot');
    }

    if (config.runOnce) {
        metrics.setActiveWorkers(0, 'pricing-baseline');
        return {
            started: true,
            mode: 'once'
        };
    }

    intervalHandle = setInterval(() => {
        runPricingBaselineCycle('interval');
    }, config.intervalMs);

    if (typeof intervalHandle.unref === 'function') {
        intervalHandle.unref();
    }

    logStructured('info', 'Pricing baseline worker iniciado', {
        service: 'pricing-baseline-worker',
        intervalMs: config.intervalMs
    });

    return {
        started: true,
        mode: 'interval',
        intervalMs: config.intervalMs
    };
}

function stopPricingBaselineWorker() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
    metrics.setActiveWorkers(0, 'pricing-baseline');
}

if (require.main === module) {
    startPricingBaselineWorker()
        .then((result) => {
            if (result?.mode === 'once') {
                process.exit(0);
            }
        })
        .catch((error) => {
            logError(error, 'Erro fatal ao iniciar pricing baseline worker', {
                service: 'pricing-baseline-worker'
            });
            process.exit(1);
        });

    const shutdown = () => {
        stopPricingBaselineWorker();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

module.exports = {
    getWorkerConfig,
    runPricingBaselineCycle,
    startPricingBaselineWorker,
    stopPricingBaselineWorker
};
