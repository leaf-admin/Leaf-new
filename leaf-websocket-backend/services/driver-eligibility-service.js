const redisPool = require('../utils/redis-pool');
const firebaseConfig = require('../firebase-config');
const { logStructured } = require('../utils/logger');
const {
    normalizeOperationalCarType,
    resolveOperationalCarTypeLabel
} = require('../utils/operational-car-type');
const {
    buildDriverVehicleIdentity,
    resolveVehicleIdentitySource
} = require('../utils/driver-vehicle-identity');
const {
    DRIVER_ACTIVATION_STATES,
    resolveDriverActivationState
} = require('./driver-activation-state-service');

const PROFILE_CACHE_TTL_SECONDS = 90;
const PROFILE_CACHE_FALLBACK_TTL_SECONDS = Number.parseInt(
    process.env.DRIVER_ELIGIBILITY_FALLBACK_CACHE_TTL_SECONDS || '30',
    10
);
const ENABLE_FIREBASE_PROFILE_LOOKUP = process.env.ENABLE_DRIVER_ELIGIBILITY_FIREBASE !== 'false';
const FIREBASE_PROFILE_TIMEOUT_MS = Math.max(
    100,
    Number.parseInt(process.env.DRIVER_ELIGIBILITY_FIREBASE_TIMEOUT_MS || '300', 10)
);
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
        normalized.includes('moto') ||
        normalized.includes('motorcycle') ||
        normalized.includes('bike')
    ) {
        return 'moto';
    }
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

    async _resolveActivationGate(driverId) {
        try {
            return await resolveDriverActivationState({ driverId });
        } catch (error) {
            logStructured('error', 'DriverEligibility: falha ao resolver estado canonico de ativacao', {
                service: 'driver-eligibility-service',
                driverId,
                error: error?.message || String(error)
            });
            return {
                state: 'DRIVER_ACTIVATION_STATE_UNAVAILABLE',
                label: 'Status indisponivel',
                canGoOnline: false,
                canAttemptOnline: false,
                requiresLiveness: false,
                blockingReason: 'Nao foi possivel validar cadastro, documentos e KYC agora.'
            };
        }
    }

    _getActivationBlockCode(activationState = {}) {
        if (activationState.state === DRIVER_ACTIVATION_STATES.APPROVED_NEEDS_LIVENESS) {
            return 'KYC_LIVENESS_REQUIRED';
        }

        const checklist = activationState.checklist || {};
        const driverDocumentsReady =
            checklist.cnhEar === true &&
            checklist.inssOrMei === true &&
            checklist.backgroundCheckConsent === true;
        if (
            activationState.state === DRIVER_ACTIVATION_STATES.DRIVER_DOCS_IN_REVIEW &&
            driverDocumentsReady &&
            activationState.kyc?.pending === true &&
            activationState.kyc?.blocked !== true
        ) {
            return 'DRIVER_ACTIVATION_PRE_REGISTERED';
        }

        const state = String(activationState.state || 'DRIVER_ACTIVATION_BLOCKED')
            .trim()
            .toUpperCase();
        return state.startsWith('DRIVER_ACTIVATION_')
            ? state
            : `DRIVER_ACTIVATION_${state}`;
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
        if (!ENABLE_FIREBASE_PROFILE_LOOKUP) {
            return null;
        }

        const db = firebaseConfig?.getRealtimeDB?.();
        if (!db) {
            return null;
        }

        const timeoutPromise = (stage) => new Promise((_, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`driver_eligibility_firebase_timeout:${stage}:${FIREBASE_PROFILE_TIMEOUT_MS}ms`));
            }, FIREBASE_PROFILE_TIMEOUT_MS);
            timer.unref?.();
        });

        let userSnapshot;
        let userVehiclesSnapshot;
        try {
            [userSnapshot, userVehiclesSnapshot] = await Promise.race([
                Promise.all([
                    db.ref(`users/${driverId}`).once('value'),
                    db.ref(`user_vehicles/${driverId}`).once('value')
                ]),
                timeoutPromise('user_and_user_vehicles')
            ]);
        } catch (error) {
            logStructured('warn', 'DriverEligibility: timeout/falha ao consultar perfil base no Firebase (fallback local)', {
                service: 'driver-eligibility-service',
                driverId,
                stage: 'user_and_user_vehicles',
                timeoutMs: FIREBASE_PROFILE_TIMEOUT_MS,
                error: error.message
            });
            return null;
        }

        if (!userSnapshot?.exists?.() && !userVehiclesSnapshot?.exists?.()) {
            return null;
        }

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
            try {
                const vehicleSnapshot = await Promise.race([
                    db.ref(`vehicles/${activeUserVehicle.vehicleId}`).once('value'),
                    timeoutPromise('vehicle')
                ]);
                if (vehicleSnapshot?.exists()) {
                    vehicle = vehicleSnapshot.val();
                }
            } catch (error) {
                logStructured('warn', 'DriverEligibility: timeout/falha ao consultar veículo no Firebase (fallback local)', {
                    service: 'driver-eligibility-service',
                    driverId,
                    vehicleId: activeUserVehicle.vehicleId,
                    stage: 'vehicle',
                    timeoutMs: FIREBASE_PROFILE_TIMEOUT_MS,
                    error: error.message
                });
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
            const cachedProfile = {
                driverId,
                driverApproved: toBoolean(cached.driverApproved, false),
                vehicleApproved: toBoolean(cached.vehicleApproved, false),
                vehicleCategory: normalizeCategory(cached.vehicleCategory || cached.carType || fallbackDriverData.carType),
                carType: cached.carType || fallbackDriverData.carType || null,
                acceptsPlusWithElite: toBoolean(cached.acceptsPlusWithElite, true),
                rating: Number.parseFloat(cached.rating || fallbackDriverData.rating || '5'),
                activeVehicleId: cached.activeVehicleId || null,
                vehiclePlate: cached.vehiclePlate || null,
                vehicleMake: cached.vehicleMake || fallbackDriverData.vehicleMake || fallbackDriverData.carMake || null,
                vehicleModel: cached.vehicleModel || fallbackDriverData.vehicleModel || fallbackDriverData.carModel || null,
                vehicleColor: cached.vehicleColor || fallbackDriverData.vehicleColor || fallbackDriverData.carColor || null,
                vehicleIdentitySource: cached.vehicleIdentitySource || 'eligibility_cache_legacy',
                vehicleIdentityCanonical: toBoolean(cached.vehicleIdentityCanonical, false),
                assignmentConflict: false
            };
            const cachedIdentity = buildDriverVehicleIdentity(cachedProfile);
            return {
                ...cachedProfile,
                vehicleIdentityCanonical: cachedIdentity.canonical,
                vehicleIdentityComplete: cachedIdentity.complete
            };
        }

        const firebaseProfile = await this._getProfileFromFirebase(driverId);
        if (!firebaseProfile) {
            const fallbackProfile = {
                driverId,
                driverApproved: false,
                vehicleApproved: false,
                vehicleCategory: normalizeCategory(fallbackDriverData.carType),
                carType: fallbackDriverData.carType || null,
                acceptsPlusWithElite: true,
                rating: Number.parseFloat(fallbackDriverData.rating || '5'),
                activeVehicleId: null,
                vehiclePlate: fallbackDriverData.vehicleNumber || fallbackDriverData.vehiclePlate || null,
                vehicleMake: fallbackDriverData.vehicleMake || fallbackDriverData.carMake || null,
                vehicleModel: fallbackDriverData.vehicleModel || fallbackDriverData.carModel || null,
                vehicleColor: fallbackDriverData.vehicleColor || fallbackDriverData.carColor || null,
                vehicleIdentitySource: 'runtime_fallback',
                vehicleIdentityCanonical: false,
                assignmentConflict: false
            };
            fallbackProfile.vehicleIdentityComplete = buildDriverVehicleIdentity(fallbackProfile).complete;

            // Cache curto para evitar repetição de lookups lentos em ondas consecutivas.
            await this.redis.hset(cacheKey, {
                driverId: fallbackProfile.driverId,
                driverApproved: String(fallbackProfile.driverApproved),
                vehicleApproved: String(fallbackProfile.vehicleApproved),
                vehicleCategory: fallbackProfile.vehicleCategory || '',
                carType: fallbackProfile.carType || '',
                acceptsPlusWithElite: String(fallbackProfile.acceptsPlusWithElite),
                rating: String(fallbackProfile.rating),
                activeVehicleId: fallbackProfile.activeVehicleId || '',
                vehiclePlate: fallbackProfile.vehiclePlate || '',
                vehicleMake: fallbackProfile.vehicleMake || '',
                vehicleModel: fallbackProfile.vehicleModel || '',
                vehicleColor: fallbackProfile.vehicleColor || '',
                vehicleIdentitySource: fallbackProfile.vehicleIdentitySource,
                vehicleIdentityCanonical: String(fallbackProfile.vehicleIdentityCanonical),
                vehicleIdentityComplete: String(fallbackProfile.vehicleIdentityComplete),
                assignmentConflict: String(fallbackProfile.assignmentConflict === true)
            });
            await this.redis.expire(cacheKey, PROFILE_CACHE_FALLBACK_TTL_SECONDS);

            return fallbackProfile;
        }

        const { user, activeUserVehicle, vehicle } = firebaseProfile;

        const userApprovedFlag = user?.approved ?? user?.isApproved ?? user?.profileApproved ?? null;
        const userStatus = String(user?.status || '').toLowerCase();
        const driverApproved = userApprovedFlag === null ? userStatus === 'approved' : toBoolean(userApprovedFlag, false);

        const uvStatus = String(activeUserVehicle?.status || '').toLowerCase();
        const vehicleApproved = activeUserVehicle
            ? (toBoolean(activeUserVehicle?.approved, false) || uvStatus === 'approved' || uvStatus === 'active')
            : false;

        const catalogCategory = await this._resolveCategoryFromCatalog(vehicle);
        const rawCarType =
            catalogCategory ||
            vehicle?.manualCategory ||
            vehicle?.category ||
            vehicle?.carType ||
            user?.carType ||
            fallbackDriverData.carType ||
            null;
        const normalizedOperationalType = normalizeOperationalCarType(
            vehicle?.category ||
            vehicle?.manualCategory ||
            catalogCategory ||
            rawCarType
        );
        const vehicleCategory = normalizeCategory(normalizedOperationalType || rawCarType);
        const carType =
            resolveOperationalCarTypeLabel(normalizedOperationalType, null) ||
            rawCarType;

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
        const vehicleIdentitySource = resolveVehicleIdentitySource({
            vehicle,
            activeUserVehicle,
            user
        });

        const profile = {
            driverId,
            driverApproved,
            vehicleApproved,
            vehicleCategory,
            carType,
            acceptsPlusWithElite,
            rating: Number.isFinite(rating) ? rating : 5,
            activeVehicleId: activeUserVehicle?.vehicleId || null,
            vehiclePlate:
                vehicle?.plate ||
                vehicle?.vehicleNumber ||
                vehicle?.vehiclePlate ||
                activeUserVehicle?.plate ||
                activeUserVehicle?.vehicleNumber ||
                activeUserVehicle?.vehiclePlate ||
                user?.carPlate ||
                user?.vehicleNumber ||
                user?.vehiclePlate ||
                null,
            vehicleMake:
                vehicle?.make ||
                vehicle?.brand ||
                vehicle?.manufacturer ||
                activeUserVehicle?.make ||
                activeUserVehicle?.brand ||
                user?.vehicleMake ||
                user?.carMake ||
                null,
            vehicleModel:
                vehicle?.model ||
                vehicle?.vehicleModel ||
                vehicle?.carModel ||
                activeUserVehicle?.model ||
                activeUserVehicle?.vehicleModel ||
                user?.vehicleModel ||
                user?.carModel ||
                null,
            vehicleColor:
                vehicle?.color ||
                vehicle?.vehicleColor ||
                vehicle?.carColor ||
                activeUserVehicle?.color ||
                activeUserVehicle?.vehicleColor ||
                user?.vehicleColor ||
                user?.carColor ||
                null,
            vehicleIdentitySource,
            vehicleIdentityCanonical: ['crlv_pdf_ocr', 'qa_crlv_fixture', 'vehicles_catalog', 'user_vehicles'].includes(
                vehicleIdentitySource
            ),
            assignmentConflict: false
        };
        profile.vehicleIdentityComplete = buildDriverVehicleIdentity(profile).complete;

        await this.redis.hset(cacheKey, {
            driverId: profile.driverId,
            driverApproved: String(profile.driverApproved),
            vehicleApproved: String(profile.vehicleApproved),
            vehicleCategory: profile.vehicleCategory || '',
            carType: profile.carType || '',
            acceptsPlusWithElite: String(profile.acceptsPlusWithElite),
            rating: String(profile.rating),
            activeVehicleId: profile.activeVehicleId || '',
            vehiclePlate: profile.vehiclePlate || '',
            vehicleMake: profile.vehicleMake || '',
            vehicleModel: profile.vehicleModel || '',
            vehicleColor: profile.vehicleColor || '',
            vehicleIdentitySource: profile.vehicleIdentitySource,
            vehicleIdentityCanonical: String(profile.vehicleIdentityCanonical),
            vehicleIdentityComplete: String(profile.vehicleIdentityComplete),
            assignmentConflict: String(profile.assignmentConflict === true)
        });
        await this.redis.expire(cacheKey, PROFILE_CACHE_TTL_SECONDS);

        return profile;
    }

    async isDriverEligibleForRide(driverId, requestedCategory, fallbackDriverData = {}) {
        const activationState = await this._resolveActivationGate(driverId);
        if (!activationState?.canGoOnline) {
            return {
                eligible: false,
                code: this._getActivationBlockCode(activationState),
                activationState,
                profile: null
            };
        }

        const profile = await this.resolveDriverProfile(driverId, fallbackDriverData);
        const normalizedRequested = normalizeCategory(requestedCategory);
        const profileWithActivation = {
            ...profile,
            activationState
        };

        if (!profile.driverApproved) {
            return { eligible: false, code: 'DRIVER_NOT_APPROVED', profile: profileWithActivation };
        }

        if (!profile.vehicleApproved) {
            return { eligible: false, code: 'VEHICLE_NOT_APPROVED', profile: profileWithActivation };
        }

        if (!normalizedRequested) {
            return { eligible: true, code: 'NO_CATEGORY_REQUIRED', profile: profileWithActivation };
        }

        if (!profile.vehicleCategory) {
            return { eligible: false, code: 'UNKNOWN_VEHICLE_CATEGORY', profile: profileWithActivation };
        }

        if (normalizedRequested === 'plus') {
            if (profile.vehicleCategory === 'plus') {
                return { eligible: true, code: 'PLUS_MATCH', profile: profileWithActivation };
            }

            if (profile.vehicleCategory === 'elite' && profile.acceptsPlusWithElite) {
                return { eligible: true, code: 'ELITE_WITH_PLUS_OPT_IN', profile: profileWithActivation };
            }

            return { eligible: false, code: 'PLUS_NOT_ALLOWED', profile: profileWithActivation };
        }

        if (normalizedRequested === 'elite') {
            if (profile.vehicleCategory !== 'elite') {
                return { eligible: false, code: 'NOT_ELITE_VEHICLE', profile: profileWithActivation };
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
                        ...profileWithActivation,
                        eliteRecoveryProgress: recoveredRides
                    }
                };
            }

            return {
                eligible: true,
                code: rating >= ELITE_MIN_RATING ? 'ELITE_RATING_OK' : 'ELITE_RECOVERED',
                profile: {
                    ...profileWithActivation,
                    eliteRecoveryProgress: recoveredRides
                }
            };
        }

        if (normalizedRequested === 'moto') {
            if (profile.vehicleCategory !== 'moto') {
                return { eligible: false, code: 'NOT_MOTO_VEHICLE', profile: profileWithActivation };
            }

            return { eligible: true, code: 'MOTO_MATCH', profile: profileWithActivation };
        }

        return { eligible: false, code: 'UNSUPPORTED_CATEGORY', profile: profileWithActivation };
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
            driverApproved: String(profileData.driverApproved ?? false),
            vehicleApproved: String(profileData.vehicleApproved ?? false),
            vehicleCategory: normalizeCategory(profileData.vehicleCategory || profileData.carType) || '',
            carType: profileData.carType || '',
            acceptsPlusWithElite: String(profileData.acceptsPlusWithElite ?? true),
            rating: String(profileData.rating ?? 5),
            activeVehicleId: profileData.activeVehicleId || '',
            vehiclePlate: profileData.vehiclePlate || '',
            vehicleMake: profileData.vehicleMake || '',
            vehicleModel: profileData.vehicleModel || '',
            vehicleColor: profileData.vehicleColor || '',
            vehicleIdentitySource: profileData.vehicleIdentitySource || 'runtime_fallback',
            vehicleIdentityCanonical: String(profileData.vehicleIdentityCanonical === true),
            vehicleIdentityComplete: String(
                buildDriverVehicleIdentity(profileData).complete
            )
        });
        await this.redis.expire(cacheKey, PROFILE_CACHE_TTL_SECONDS);
    }
}

module.exports = new DriverEligibilityService();
module.exports.normalizeCategory = normalizeCategory;
