const redisPool = require('../utils/redis-pool');
const firebaseConfig = require('../firebase-config');
const { logStructured } = require('../utils/logger');

const PROFILE_CACHE_TTL_SECONDS = 90;
const ELITE_MIN_RATING = 4.8;
const ELITE_RECOVERY_MIN_GOOD_RIDES = 10;
const ELITE_RECOVERY_MIN_RATING = 4.0;
const VEHICLE_CATALOG_PATH = process.env.VEHICLE_CATEGORY_CATALOG_PATH || 'vehicle_category_catalog';
const ENABLE_VEHICLE_CATALOG_POLICY = process.env.ENABLE_VEHICLE_CATALOG_POLICY === 'true';

function normalizeCategory(value) {
    if (!value) return null;
    const normalized = String(value).trim().toLowerCase();

    if (normalized.includes('elite') || normalized === 'premium') return 'elite';
    if (
        normalized.includes('plus') ||
        normalized.includes('standard') ||
        normalized.includes('econ') ||
        normalized === 'basic'
    ) {
        return 'plus';
    }

    return null;
}

function toBoolean(value, fallback = false) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return fallback;
}

class DriverEligibilityService {
    constructor() {
        this.redis = redisPool.getConnection();
        this.catalogCache = null;
        this.catalogLoadedAt = 0;
    }

    _buildCatalogKey({ brand, model, year }) {
        const normalizedBrand = (brand || '').trim().toLowerCase();
        const normalizedModel = (model || '').trim().toLowerCase();
        const normalizedYear = Number.parseInt(year, 10);
        if (!normalizedBrand || !normalizedModel || !Number.isFinite(normalizedYear)) {
            return null;
        }
        return `${normalizedBrand}|${normalizedModel}|${normalizedYear}`;
    }

    async _loadVehicleCatalog() {
        if (!ENABLE_VEHICLE_CATALOG_POLICY) {
            return null;
        }

        const now = Date.now();
        if (this.catalogCache && now - this.catalogLoadedAt < 60_000) {
            return this.catalogCache;
        }

        const db = firebaseConfig?.getRealtimeDB?.();
        if (!db) return null;

        const snapshot = await db.ref(VEHICLE_CATALOG_PATH).once('value');
        const rawCatalog = snapshot?.val() || {};
        this.catalogCache = rawCatalog;
        this.catalogLoadedAt = now;
        return rawCatalog;
    }

    async _resolveCategoryFromCatalog(vehicleData) {
        const catalog = await this._loadVehicleCatalog();
        if (!catalog) return null;

        const key = this._buildCatalogKey({
            brand: vehicleData?.brand || vehicleData?.vehicleMake || vehicleData?.make,
            model: vehicleData?.model || vehicleData?.vehicleModel,
            year: vehicleData?.year || vehicleData?.manufactureYear
        });
        if (!key) return null;

        const entry = catalog[key] || null;
        if (!entry) return null;

        if (entry.enabled === false) return null;
        if (entry.category) return normalizeCategory(entry.category);
        return null;
    }

    async _getProfileFromFirebase(driverId) {
        const db = firebaseConfig?.getRealtimeDB?.();
        if (!db) {
            return null;
        }

        const [userSnapshot, userVehiclesSnapshot] = await Promise.all([
            db.ref(`users/${driverId}`).once('value'),
            db.ref(`user_vehicles/${driverId}`).once('value')
        ]);

        const user = userSnapshot?.val() || {};
        const userVehicles = userVehiclesSnapshot?.val() || {};

        let activeUserVehicle = null;
        Object.keys(userVehicles).some((userVehicleId) => {
            const userVehicle = userVehicles[userVehicleId];
            if (!userVehicle) return false;

            if (userVehicle.isActive === true) {
                activeUserVehicle = { id: userVehicleId, ...userVehicle };
                return true;
            }
            return false;
        });

        let vehicle = null;
        if (activeUserVehicle?.vehicleId) {
            const vehicleSnapshot = await db.ref(`vehicles/${activeUserVehicle.vehicleId}`).once('value');
            if (vehicleSnapshot?.exists()) {
                vehicle = vehicleSnapshot.val();
            }
        }

        return {
            user,
            activeUserVehicle,
            vehicle
        };
    }

    async resolveDriverProfile(driverId, fallbackDriverData = {}) {
        await redisPool.ensureConnection();
        const cacheKey = `driver_eligibility_profile:${driverId}`;
        const cached = await this.redis.hgetall(cacheKey);

        if (cached && cached.driverId) {
            return {
                driverId,
                driverApproved: toBoolean(cached.driverApproved, true),
                vehicleApproved: toBoolean(cached.vehicleApproved, true),
                vehicleCategory: normalizeCategory(cached.vehicleCategory || cached.carType || fallbackDriverData.carType),
                carType: cached.carType || fallbackDriverData.carType || null,
                acceptsPlusWithElite: toBoolean(cached.acceptsPlusWithElite, true),
                rating: Number.parseFloat(cached.rating || fallbackDriverData.rating || '5'),
                activeVehicleId: cached.activeVehicleId || null,
                vehiclePlate: cached.vehiclePlate || null
            };
        }

        const firebaseProfile = await this._getProfileFromFirebase(driverId);
        if (!firebaseProfile) {
            return {
                driverId,
                driverApproved: true,
                vehicleApproved: true,
                vehicleCategory: normalizeCategory(fallbackDriverData.carType),
                carType: fallbackDriverData.carType || null,
                acceptsPlusWithElite: true,
                rating: Number.parseFloat(fallbackDriverData.rating || '5'),
                activeVehicleId: null,
                vehiclePlate: fallbackDriverData.vehicleNumber || fallbackDriverData.vehiclePlate || null
            };
        }

        const { user, activeUserVehicle, vehicle } = firebaseProfile;

        const userApprovedFlag = user?.approved ?? user?.isApproved ?? user?.profileApproved ?? null;
        const userStatus = String(user?.status || '').toLowerCase();
        const driverApproved = userApprovedFlag === null ? (userStatus ? userStatus === 'approved' : true) : toBoolean(userApprovedFlag, false);

        const uvStatus = String(activeUserVehicle?.status || '').toLowerCase();
        const vehicleApproved = activeUserVehicle
            ? (toBoolean(activeUserVehicle?.approved, false) || uvStatus === 'approved' || uvStatus === 'active')
            : true;

        const catalogCategory = await this._resolveCategoryFromCatalog(vehicle);
        const carType =
            catalogCategory ||
            vehicle?.manualCategory ||
            vehicle?.carType ||
            vehicle?.category ||
            user?.carType ||
            fallbackDriverData.carType ||
            null;
        const vehicleCategory = normalizeCategory(carType);

        const acceptsPlusWithElite = toBoolean(
            user?.acceptPlusWithElite ??
            user?.acceptPlusRides ??
            user?.receivePlusRides ??
            user?.allowPlusRides,
            true
        );

        const rating = Number.parseFloat(
            fallbackDriverData.rating ??
            user?.rating ??
            '5'
        );

        const profile = {
            driverId,
            driverApproved,
            vehicleApproved,
            vehicleCategory,
            carType,
            acceptsPlusWithElite,
            rating: Number.isFinite(rating) ? rating : 5,
            activeVehicleId: activeUserVehicle?.vehicleId || null,
            vehiclePlate: vehicle?.plate || vehicle?.vehicleNumber || user?.carPlate || user?.vehicleNumber || null
        };

        await this.redis.hset(cacheKey, {
            driverId: profile.driverId,
            driverApproved: String(profile.driverApproved),
            vehicleApproved: String(profile.vehicleApproved),
            vehicleCategory: profile.vehicleCategory || '',
            carType: profile.carType || '',
            acceptsPlusWithElite: String(profile.acceptsPlusWithElite),
            rating: String(profile.rating),
            activeVehicleId: profile.activeVehicleId || '',
            vehiclePlate: profile.vehiclePlate || ''
        });
        await this.redis.expire(cacheKey, PROFILE_CACHE_TTL_SECONDS);

        return profile;
    }

    async isDriverEligibleForRide(driverId, requestedCategory, fallbackDriverData = {}) {
        const profile = await this.resolveDriverProfile(driverId, fallbackDriverData);
        const normalizedRequested = normalizeCategory(requestedCategory);

        if (!profile.driverApproved) {
            return { eligible: false, code: 'DRIVER_NOT_APPROVED', profile };
        }

        if (!profile.vehicleApproved) {
            return { eligible: false, code: 'VEHICLE_NOT_APPROVED', profile };
        }

        if (!normalizedRequested) {
            return { eligible: true, code: 'NO_CATEGORY_REQUIRED', profile };
        }

        if (!profile.vehicleCategory) {
            return { eligible: false, code: 'UNKNOWN_VEHICLE_CATEGORY', profile };
        }

        if (normalizedRequested === 'plus') {
            if (profile.vehicleCategory === 'plus') {
                return { eligible: true, code: 'PLUS_MATCH', profile };
            }

            if (profile.vehicleCategory === 'elite' && profile.acceptsPlusWithElite) {
                return { eligible: true, code: 'ELITE_WITH_PLUS_OPT_IN', profile };
            }

            return { eligible: false, code: 'PLUS_NOT_ALLOWED', profile };
        }

        if (normalizedRequested === 'elite') {
            if (profile.vehicleCategory !== 'elite') {
                return { eligible: false, code: 'NOT_ELITE_VEHICLE', profile };
            }

            const recoveryRaw = await this.redis.hgetall(`driver_elite_recovery:${driverId}`);
            const recoveredRides = Number.parseInt(recoveryRaw?.goodPlusRides || '0', 10) || 0;
            const rating = Number.parseFloat(profile.rating || '5') || 5;
            const eliteUnlocked = rating >= ELITE_MIN_RATING || recoveredRides >= ELITE_RECOVERY_MIN_GOOD_RIDES;

            if (!eliteUnlocked) {
                return {
                    eligible: false,
                    code: 'ELITE_RATING_BLOCKED',
                    profile: {
                        ...profile,
                        eliteRecoveryProgress: recoveredRides
                    }
                };
            }

            return {
                eligible: true,
                code: rating >= ELITE_MIN_RATING ? 'ELITE_RATING_OK' : 'ELITE_RECOVERED',
                profile: {
                    ...profile,
                    eliteRecoveryProgress: recoveredRides
                }
            };
        }

        return { eligible: false, code: 'UNSUPPORTED_CATEGORY', profile };
    }

    async recordEliteRecoveryRide(driverId, rideCategory, ratingValue) {
        const normalizedRideCategory = normalizeCategory(rideCategory);
        const numericRating = Number.parseFloat(ratingValue);

        if (normalizedRideCategory !== 'plus' || !Number.isFinite(numericRating) || numericRating < ELITE_RECOVERY_MIN_RATING) {
            return { updated: false, reason: 'not_eligible_for_recovery' };
        }

        const profile = await this.resolveDriverProfile(driverId);
        if (profile.vehicleCategory !== 'elite') {
            return { updated: false, reason: 'driver_not_elite_capable' };
        }

        const recoveryKey = `driver_elite_recovery:${driverId}`;
        const goodPlusRides = await this.redis.hincrby(recoveryKey, 'goodPlusRides', 1);
        await this.redis.hset(recoveryKey, {
            lastRideAt: new Date().toISOString(),
            lastRideRating: String(numericRating)
        });

        logStructured('info', 'Progresso de recuperação Elite atualizado', {
            driverId,
            goodPlusRides
        });

        return { updated: true, goodPlusRides };
    }

    async primeProfileCacheFromOnlineStatus(driverId, profileData = {}) {
        if (!driverId) return;

        const cacheKey = `driver_eligibility_profile:${driverId}`;
        await this.redis.hset(cacheKey, {
            driverId,
            driverApproved: String(profileData.driverApproved ?? true),
            vehicleApproved: String(profileData.vehicleApproved ?? true),
            vehicleCategory: normalizeCategory(profileData.vehicleCategory || profileData.carType) || '',
            carType: profileData.carType || '',
            acceptsPlusWithElite: String(profileData.acceptsPlusWithElite ?? true),
            rating: String(profileData.rating ?? 5),
            activeVehicleId: profileData.activeVehicleId || '',
            vehiclePlate: profileData.vehiclePlate || ''
        });
        await this.redis.expire(cacheKey, PROFILE_CACHE_TTL_SECONDS);
    }
}

module.exports = new DriverEligibilityService();
module.exports.normalizeCategory = normalizeCategory;
