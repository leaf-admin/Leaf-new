const driverEligibilityService = require('./driver-eligibility-service');

function toFiniteNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

async function reconcileDriverDispatchEligibility({
    redis,
    driverId,
    driverState = {},
    lat = null,
    lng = null,
    eligibleGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible'
}) {
    if (!redis || !driverId) {
        return {
            eligible: false,
            code: 'INVALID_INPUT',
            driverPatch: null,
            lat: null,
            lng: null
        };
    }

    const normalizedLat = toFiniteNumber(lat ?? driverState?.lat);
    const normalizedLng = toFiniteNumber(lng ?? driverState?.lng);
    const hasLocation = normalizedLat !== null && normalizedLng !== null;

    const eligibility = await driverEligibilityService.isDriverEligibleForRide(
        driverId,
        null,
        driverState || {}
    );

    const code = hasLocation
        ? (eligibility?.code || (eligibility?.eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE'))
        : 'AWAITING_LOCATION_SYNC';
    const eligible = Boolean(eligibility?.eligible) && hasLocation;
    const driverPatch = {
        dispatchEligible: eligible ? 'true' : 'false',
        dispatchEligibilityCode: code,
        dispatchEligibilityCheckedAt: new Date().toISOString()
    };

    const pipeline = redis.multi();
    pipeline.hset(`driver:${driverId}`, driverPatch);
    if (eligible) {
        pipeline.geoadd(eligibleGeoKey, normalizedLng, normalizedLat, driverId);
    } else {
        pipeline.zrem(eligibleGeoKey, driverId);
    }
    await pipeline.exec();

    return {
        eligible,
        code,
        driverPatch,
        lat: normalizedLat,
        lng: normalizedLng
    };
}

async function ensureDriverOnlineReady({
    redis,
    driverId,
    driverState = {},
    lat = null,
    lng = null,
    activeGeoKey = 'driver_locations',
    eligibleGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible',
    attempts = 3,
    sleepMs = async () => undefined
}) {
    if (!redis || !driverId) {
        return {
            ready: false,
            activeGeo: false,
            eligibleGeo: false,
            recovered: false,
            code: 'INVALID_INPUT'
        };
    }

    let recovered = false;
    let activeGeoScore = null;
    let eligibleGeoScore = null;
    let code = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        [activeGeoScore, eligibleGeoScore] = await Promise.all([
            redis.zscore(activeGeoKey, driverId),
            redis.zscore(eligibleGeoKey, driverId)
        ]);

        if (activeGeoScore !== null && eligibleGeoScore !== null) {
            return {
                ready: true,
                activeGeo: true,
                eligibleGeo: true,
                recovered,
                code: code || 'ELIGIBLE'
            };
        }

        if (activeGeoScore !== null && eligibleGeoScore === null) {
            const reconciliation = await reconcileDriverDispatchEligibility({
                redis,
                driverId,
                driverState,
                lat,
                lng,
                eligibleGeoKey
            });

            recovered = true;
            code = reconciliation?.code || code;

            [activeGeoScore, eligibleGeoScore] = await Promise.all([
                redis.zscore(activeGeoKey, driverId),
                redis.zscore(eligibleGeoKey, driverId)
            ]);

            if (activeGeoScore !== null && eligibleGeoScore !== null) {
                return {
                    ready: true,
                    activeGeo: true,
                    eligibleGeo: true,
                    recovered,
                    code: code || 'ELIGIBLE'
                };
            }
        }

        if (attempt < attempts - 1) {
            await sleepMs(90 * (attempt + 1));
        }
    }

    return {
        ready: false,
        activeGeo: activeGeoScore !== null,
        eligibleGeo: eligibleGeoScore !== null,
        recovered,
        code: code || (activeGeoScore === null ? 'LOCATION_NOT_INDEXED' : 'DISPATCH_NOT_READY')
    };
}

module.exports = {
    reconcileDriverDispatchEligibility,
    ensureDriverOnlineReady
};
