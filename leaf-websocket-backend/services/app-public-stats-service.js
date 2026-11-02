'use strict';

// Public app numbers, counted only from real (operational) data since the
// pilot opened to the public on 2026-11-02. Test rides live in the sandbox
// collections and older operational rows are test data, so neither counts.
// The result is cached because the endpoint is public.

const admin = require('firebase-admin');

const DEFAULT_SINCE_ISO = '2026-11-02T00:00:00-03:00';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RECEIPTS_SCANNED = 20000;

let cache = null;

function resolveSinceMs(env = process.env) {
  const parsed = Date.parse(env.APP_PUBLIC_STATS_SINCE || DEFAULT_SINCE_ISO);
  return Number.isFinite(parsed) ? parsed : Date.parse(DEFAULT_SINCE_ISO);
}

async function computeStats(firestore, sinceMs) {
  const since = admin.firestore.Timestamp.fromMillis(sinceMs);
  const receipts = await firestore.collection('receipts')
    .where('historyIndex.listedAt', '>=', since)
    .select('historyIndex.customerId', 'historyIndex.driverId')
    .limit(MAX_RECEIPTS_SCANNED)
    .get();
  const users = new Set();
  for (const doc of receipts.docs) {
    const customerId = doc.get('historyIndex.customerId');
    const driverId = doc.get('historyIndex.driverId');
    if (customerId) users.add(`c:${customerId}`);
    if (driverId) users.add(`d:${driverId}`);
  }
  // Ratings passengers gave after their rides (createdAt is an ISO string).
  const ratings = await firestore.collection('ratings')
    .where('createdAt', '>=', new Date(sinceMs).toISOString())
    .select('rating', 'reviewerType')
    .get();
  const scores = ratings.docs
    .filter((doc) => doc.get('reviewerType') === 'passenger')
    .map((doc) => Number(doc.get('rating')))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 5);
  const averageRating = scores.length
    ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10
    : null;
  return {
    activeUsers: users.size,
    totalTrips: receipts.size,
    averageRating,
    ratingsCount: scores.length,
    since: new Date(sinceMs).toISOString()
  };
}

async function getAppPublicStats({ firestore, nowMs = Date.now(), env = process.env } = {}) {
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.stats;
  const stats = { ...(await computeStats(firestore, resolveSinceMs(env))), updatedAt: new Date(nowMs).toISOString() };
  cache = { stats, at: nowMs };
  return stats;
}

function resetAppPublicStatsCache() {
  cache = null;
}

module.exports = { getAppPublicStats, resetAppPublicStatsCache, DEFAULT_SINCE_ISO, CACHE_TTL_MS };
