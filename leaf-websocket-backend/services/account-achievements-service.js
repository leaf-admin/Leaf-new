'use strict';

// Conquistas da conta (aprovadas por Izaak em 2026-10-29): marcos de uso e qualidade.
// Só exibição: nenhuma conquista concede desconto, crédito ou prioridade.
// O backend calcula; o app apenas mostra o que este serviço devolve.
const { resolveUserPersistenceScope } = require('./sandbox-persistence-context');
const ratingService = require('./rating-service');

const CACHE_TTL_SECONDS = 6 * 60 * 60;
const RIDES_READ_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const QUALITY_WINDOW_DAYS = 30;

const MILESTONES = Object.freeze({
  customer: [
    { id: 'trips_1', title: 'Primeira viagem', target: 1, metric: 'completedTrips' },
    { id: 'trips_10', title: '10 viagens', target: 10, metric: 'completedTrips' },
    { id: 'trips_50', title: '50 viagens', target: 50, metric: 'completedTrips' },
    { id: 'trips_100', title: '100 viagens', target: 100, metric: 'completedTrips' },
    { id: 'months_6', title: '6 meses na Leaf', target: 6, metric: 'monthsOnLeaf' },
    { id: 'months_12', title: '1 ano na Leaf', target: 12, metric: 'monthsOnLeaf' },
  ],
  driver: [
    { id: 'trips_1', title: 'Primeira corrida', target: 1, metric: 'completedTrips' },
    { id: 'trips_50', title: '50 corridas', target: 50, metric: 'completedTrips' },
    { id: 'trips_100', title: '100 corridas', target: 100, metric: 'completedTrips' },
    { id: 'trips_500', title: '500 corridas', target: 500, metric: 'completedTrips' },
    { id: 'months_6', title: '6 meses de parceria', target: 6, metric: 'monthsOnLeaf' },
    { id: 'months_12', title: '1 ano de parceria', target: 12, metric: 'monthsOnLeaf' },
  ],
});

const QUALITY = Object.freeze({
  customer: { minRating: 4.8, minRatings: 10, minTripsNoCancel: 1 },
  driver: { minRating: 4.9, minRatings: 20, minTripsNoCancel: 10 },
});

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase() === 'driver' ? 'driver' : 'customer';
}

function toMs(value) {
  if (!value) return NaN;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function wholeMonthsBetween(fromMs, toMsValue) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMsValue) || toMsValue < fromMs) return 0;
  return Math.floor((toMsValue - fromMs) / (30.44 * DAY_MS));
}

function isCompleted(status) {
  return ['COMPLETE', 'COMPLETED', 'PAID', 'FINISHED', 'EARLY_ENDED_BY_RIDER'].includes(String(status || '').toUpperCase());
}

function isCanceled(status) {
  const value = String(status || '').toUpperCase();
  return value.startsWith('CANCEL');
}

// Pure: turns raw ride records into the counters the rules use.
function summarizeRides(rides = [], { userId, role, now = Date.now() } = {}) {
  const windowStart = now - QUALITY_WINDOW_DAYS * DAY_MS;
  let completedTrips = 0;
  let completedInWindow = 0;
  let selfCancellationsInWindow = 0;
  let firstTripMs = NaN;
  for (const ride of rides) {
    const status = ride?.status || ride?.currentStatus;
    const at = toMs(ride?.completedAt || ride?.paidAt || ride?.canceledAt || ride?.cancelledAt || ride?.createdAt);
    if (isCompleted(status)) {
      completedTrips += 1;
      if (Number.isFinite(at) && at >= windowStart) completedInWindow += 1;
      if (Number.isFinite(at) && !(at >= firstTripMs)) firstTripMs = at;
      continue;
    }
    // Conta só o cancelamento feito pela própria pessoa depois do aceite.
    const canceledBy = String(ride?.canceledBy || ride?.cancelledById || '').trim();
    const accepted = Boolean(ride?.acceptedAt || ride?.driverId);
    if (isCanceled(status) && canceledBy === userId && accepted && Number.isFinite(at) && at >= windowStart) {
      selfCancellationsInWindow += 1;
    }
  }
  return { role, completedTrips, completedInWindow, selfCancellationsInWindow, firstTripMs };
}

// Pure: the approved rules. Returns earned and next badges with progress.
function computeAchievements(stats = {}, { role, memberSinceMs, now = Date.now() } = {}) {
  const safeRole = normalizeRole(role || stats.role);
  const monthsOnLeaf = wholeMonthsBetween(memberSinceMs, now);
  const values = { completedTrips: Number(stats.completedTrips) || 0, monthsOnLeaf };
  const milestones = MILESTONES[safeRole].map((rule) => {
    const current = values[rule.metric];
    return {
      id: rule.id,
      kind: 'milestone',
      title: rule.title,
      earned: current >= rule.target,
      progress: { current: Math.min(current, rule.target), target: rule.target },
    };
  });

  const quality = QUALITY[safeRole];
  const ratingAverage = Number(stats.ratingAverage) || 0;
  const ratingCount = Number(stats.ratingCount) || 0;
  const ratingTitle = safeRole === 'driver' ? 'Nota de ouro' : 'Passageiro 5 estrelas';
  const qualityBadges = [
    {
      id: 'rating_high',
      kind: 'quality',
      title: ratingTitle,
      description: `Nota média ${String(quality.minRating).replace('.', ',')} ou mais em ${quality.minRatings} avaliações`,
      earned: ratingCount >= quality.minRatings && ratingAverage >= quality.minRating,
      progress: { current: Math.min(ratingCount, quality.minRatings), target: quality.minRatings },
    },
    {
      id: 'no_cancel_30d',
      kind: 'quality',
      title: 'Sem cancelamentos',
      description: safeRole === 'driver'
        ? `Nenhum cancelamento em 30 dias, com ${quality.minTripsNoCancel} corridas ou mais`
        : 'Nenhum cancelamento depois do aceite em 30 dias',
      earned: (Number(stats.selfCancellationsInWindow) || 0) === 0 &&
        (Number(stats.completedInWindow) || 0) >= quality.minTripsNoCancel,
      progress: {
        current: Math.min(Number(stats.completedInWindow) || 0, quality.minTripsNoCancel),
        target: quality.minTripsNoCancel,
      },
    },
  ];

  const all = [...milestones, ...qualityBadges];
  return {
    role: safeRole,
    earnedCount: all.filter((badge) => badge.earned).length,
    totalCount: all.length,
    badges: all,
  };
}

async function loadRides(firestore, scope, { userId, role }) {
  const field = role === 'driver' ? 'driverId' : 'customerId';
  const snapshot = await firestore
    .collection(scope.collections.rides)
    .where(field, '==', userId)
    .limit(RIDES_READ_LIMIT)
    .get();
  return snapshot.docs.map((doc) => doc.data() || {});
}

async function getAccountAchievements({ userId, role, memberSince, firestore, redis = null, now = Date.now() }) {
  const safeRole = normalizeRole(role);
  const cacheKey = `account_achievements:v1:${userId}:${safeRole}`;
  if (redis) {
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      try { return JSON.parse(cached); } catch (_error) { /* recompute */ }
    }
  }
  const scope = await resolveUserPersistenceScope({ userId });
  const rides = await loadRides(firestore, scope, { userId, role: safeRole });
  const rideStats = summarizeRides(rides, { userId, role: safeRole, now });
  const ratings = await ratingService.getUserRatings(userId, scope).catch(() => null);
  const memberSinceMs = Number.isFinite(toMs(memberSince)) ? toMs(memberSince) : rideStats.firstTripMs;
  const result = {
    ...computeAchievements({
      ...rideStats,
      ratingAverage: ratings?.success ? ratings.averageRating : 0,
      ratingCount: ratings?.success ? ratings.totalRatings : 0,
    }, { role: safeRole, memberSinceMs, now }),
    computedAt: new Date(now).toISOString(),
  };
  if (redis) {
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => {});
  }
  return result;
}

module.exports = {
  MILESTONES,
  QUALITY,
  summarizeRides,
  computeAchievements,
  getAccountAchievements,
};
