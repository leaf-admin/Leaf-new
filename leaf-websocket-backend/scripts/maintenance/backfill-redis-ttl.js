#!/usr/bin/env node
/**
 * One-off backfill: add TTLs to Redis keys written before TTLs existed.
 *
 * - booking:* in a terminal state (except EARLY_ENDED_REVIEW) -> RIDE_TERMINAL_BOOKING_TTL_SECONDS (72h)
 * - booking:* partial hashes without state (late payment/trace/telemetry writes) -> 72h
 * - booking:* still active -> 7-day safety cap (same as utils/booking-redis-ttl)
 * - QA/e2e/stress booking:* (ride_e2e*, qa_bypass*) -> 24h, whatever their state
 * - metrics:acceptance:*:notified -> 1h (same TTL as its sibling hash)
 *
 * Only keys with no TTL (TTL == -1) are touched; nothing is deleted directly.
 * Dry run by default. Run inside the backend container from /app:
 *   docker exec -i leaf-websocket node - [--apply] < scripts/maintenance/backfill-redis-ttl.js
 */
const path = require('path');

const appRoot = process.env.LEAF_APP_ROOT || process.cwd();
const redisPool = require(path.join(appRoot, 'utils/redis-pool'));
const RideStateManager = require(path.join(appRoot, 'services/ride-state-manager'));

const APPLY = process.argv.includes('--apply');
const TERMINAL_TTL_SECONDS = Number.parseInt(process.env.RIDE_TERMINAL_BOOKING_TTL_SECONDS || '259200', 10);
const TEST_BOOKING_TTL_SECONDS = 24 * 60 * 60;
const { resolveBookingSafetyTtlSeconds } = require(path.join(appRoot, 'utils/booking-redis-ttl'));
const ACCEPTANCE_NOTIFIED_TTL_SECONDS = 60 * 60;
const TEST_BOOKING_PATTERN = /^booking:(ride_e2e|qa_bypass)/;

async function scanAll(redis, pattern, onKeys) {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
    cursor = next;
    if (keys.length > 0) {
      await onKeys(keys);
    }
  } while (cursor !== '0');
}

async function main() {
  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const counts = { terminal: 0, stateless: 0, test: 0, acceptance: 0, reviewKept: 0, activeCapped: 0 };
  const plan = [];

  await scanAll(redis, 'booking:*', async (keys) => {
    const pipeline = redis.pipeline();
    keys.forEach((key) => {
      pipeline.ttl(key);
      pipeline.hget(key, 'state');
    });
    const results = await pipeline.exec();
    keys.forEach((key, index) => {
      const ttl = results[index * 2][1];
      const state = String(results[index * 2 + 1][1] || '').trim().toUpperCase();
      if (ttl !== -1) {
        return;
      }
      if (TEST_BOOKING_PATTERN.test(key)) {
        counts.test += 1;
        plan.push([key, TEST_BOOKING_TTL_SECONDS]);
      } else if (state === 'EARLY_ENDED_REVIEW') {
        counts.reviewKept += 1;
      } else if (RideStateManager.isTerminalStateValue(state)) {
        counts.terminal += 1;
        plan.push([key, TERMINAL_TTL_SECONDS]);
      } else if (!state) {
        counts.stateless += 1;
        plan.push([key, TERMINAL_TTL_SECONDS]);
      } else {
        counts.activeCapped += 1;
        plan.push([key, resolveBookingSafetyTtlSeconds()]);
      }
    });
  });

  await scanAll(redis, 'metrics:acceptance:*:notified', async (keys) => {
    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.ttl(key));
    const results = await pipeline.exec();
    keys.forEach((key, index) => {
      if (results[index][1] === -1) {
        counts.acceptance += 1;
        plan.push([key, ACCEPTANCE_NOTIFIED_TTL_SECONDS]);
      }
    });
  });

  if (APPLY) {
    for (let i = 0; i < plan.length; i += 500) {
      const pipeline = redis.pipeline();
      // NX (Redis >= 7): only keys still without TTL, so a TTL set meanwhile by the app wins.
      plan.slice(i, i + 500).forEach(([key, ttl]) => pipeline.expire(key, ttl, 'NX'));
      await pipeline.exec();
    }
  }

  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', ...counts, totalExpires: plan.length }));
  process.exit(0);
}

main().catch((error) => {
  console.error(`backfill-redis-ttl failed: ${error.message}`);
  process.exit(1);
});
