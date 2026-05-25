#!/usr/bin/env node

const redisPool = require('../../utils/redis-pool');
const { logStructured, logError } = require('../../utils/logger');
const { backfillRideHealthIndex, getRideOperationsSnapshot } = require('../../services/ride-health-monitor');

async function main() {
  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const nowIso = new Date().toISOString();

  const backfill = await backfillRideHealthIndex(redis, {
    nowIso,
    scanCount: Number.parseInt(process.env.RIDE_HEALTH_BACKFILL_SCAN_COUNT || '250', 10),
    maxKeys: Number.parseInt(process.env.RIDE_HEALTH_BACKFILL_MAX_KEYS || '10000', 10)
  });

  const snapshot = await getRideOperationsSnapshot(redis, { nowIso });
  const summary = {
    nowIso,
    backfill,
    snapshot
  };

  logStructured('info', 'Ride health backfill concluído', {
    service: 'ride-health-backfill-script',
    scannedKeys: backfill.scannedKeys,
    reassignmentPending: backfill.reassignmentPending,
    earlyEndedReview: backfill.earlyEndedReview
  });

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  logError(error, {
    service: 'ride-health-backfill-script'
  });
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
