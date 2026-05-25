const redisPool = require('../utils/redis-pool');

const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';

function normalizeFiniteNumber(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFiniteInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function buildApproxSnapshotCacheKey({
    regionHash = '*',
    radiusKm = 5,
    limit = 12
} = {}) {
    const normalizedRadius = normalizeFiniteNumber(radiusKm, 5);
    const normalizedLimit = normalizeFiniteInt(limit, 12);
    return `driver_availability_snapshot:${String(regionHash || '*').trim() || '*'}:${normalizedRadius}:${normalizedLimit}`;
}

async function readCachedSnapshot(redis, key) {
    const raw = await redis.get(key).catch(() => null);
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (_error) {
        return null;
    }
}

async function countNearbyEligibleDriversApprox(pickupLocation, {
    regionHash = '*',
    radiusKm = Number.parseFloat(process.env.OPERATIONS_POLICY_RADIUS_KM || '5'),
    limit = Number.parseInt(process.env.OPERATIONS_POLICY_DRIVER_LIMIT || '12', 10),
    cacheTtlSec = Number.parseInt(process.env.OPERATIONS_POLICY_SNAPSHOT_CACHE_TTL_SEC || '2', 10),
    eligibleGeoKey = ELIGIBLE_DRIVER_GEO_KEY
} = {}) {
    const redis = redisPool.getConnection();
    await redisPool.ensureConnection();

    const latitude = normalizeFiniteNumber(pickupLocation?.lat, null);
    const longitude = normalizeFiniteNumber(pickupLocation?.lng, null);
    if (latitude === null || longitude === null) {
        return {
            success: false,
            availableDrivers: 0,
            source: 'invalid_input'
        };
    }

    const safeLimit = Math.max(1, normalizeFiniteInt(limit, 12));
    const safeRadiusKm = Math.max(0.5, normalizeFiniteNumber(radiusKm, 5));
    const cacheKey = buildApproxSnapshotCacheKey({
        regionHash,
        radiusKm: safeRadiusKm,
        limit: safeLimit
    });

    const cached = await readCachedSnapshot(redis, cacheKey);
    if (cached && Number.isFinite(Number(cached.availableDrivers))) {
        return {
            success: true,
            availableDrivers: Number(cached.availableDrivers),
            source: 'cache',
            regionHash,
            radiusKm: safeRadiusKm
        };
    }

    const nearbyDrivers = await redis.georadius(
        eligibleGeoKey,
        longitude,
        latitude,
        safeRadiusKm,
        'km',
        'COUNT',
        safeLimit
    ).catch(() => []);

    const availableDrivers = Array.isArray(nearbyDrivers) ? nearbyDrivers.length : 0;
    await redis.setex(cacheKey, Math.max(1, cacheTtlSec), JSON.stringify({
        availableDrivers,
        regionHash,
        radiusKm: safeRadiusKm,
        computedAt: new Date().toISOString()
    })).catch(() => null);

    return {
        success: true,
        availableDrivers,
        source: 'geo_count',
        regionHash,
        radiusKm: safeRadiusKm
    };
}

module.exports = {
    buildApproxSnapshotCacheKey,
    countNearbyEligibleDriversApprox
};
