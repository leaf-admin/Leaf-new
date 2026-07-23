const DEFAULT_DRIVER_RESPONSE_TIMEOUT_SECONDS = 20;
const DEFAULT_SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS = 6 * 60 * 60;
const DEFAULT_DRIVER_SEARCH_INITIAL_RADIUS_KM = 2.5;
const DEFAULT_DRIVER_SEARCH_MAX_RADIUS_KM = 5;
const DEFAULT_DRIVER_SEARCH_EXPANSION_STEP_KM = 2.5;
const DEFAULT_DRIVER_SEARCH_DRIVERS_PER_WAVE = 12;

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthyEnv(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function safeJsonParse(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_error) {
        return fallback;
    }
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function hasSandboxOrSmokeMarker(payload = {}) {
    const paymentData = safeJsonParse(payload.paymentData, payload.paymentData || {});
    const providerEnvironment = normalizeText(
        payload.providerEnvironment ||
        payload.paymentProviderEnvironment ||
        payload.paymentEnvironment ||
        paymentData?.providerEnvironment ||
        paymentData?.paymentProviderEnvironment
    );
    const profileId = normalizeText(
        payload.paymentProfileId ||
        payload.paymentRuntimeProfileId ||
        paymentData?.paymentProfileId
    );
    const rideMode = normalizeText(
        payload.rideMode ||
        payload.testMode ||
        payload.qaMode ||
        paymentData?.rideMode ||
        paymentData?.testMode ||
        paymentData?.qaMode
    );

    return providerEnvironment === 'sandbox' ||
        profileId.includes('sandbox') ||
        rideMode.includes('smoke') ||
        rideMode.includes('sandbox') ||
        payload.isSmokeTest === true ||
        payload.smokeTest === true ||
        paymentData?.isSmokeTest === true ||
        paymentData?.smokeTest === true;
}

function getSmokeDriverResponseTimeoutSeconds() {
    return parsePositiveInt(
        process.env.SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS ||
        process.env.REAL_SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS ||
        process.env.SANDBOX_DRIVER_RESPONSE_TIMEOUT_SECONDS ||
        process.env.DISPATCH_SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS,
        DEFAULT_SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS
    );
}

function shouldUseSmokeDriverResponseTimeout(payload = {}) {
    return isTruthyEnv(process.env.REAL_SMOKE_DISABLE_TTLS) ||
        isTruthyEnv(process.env.REAL_SMOKE_LONG_TTLS) ||
        isTruthyEnv(process.env.ALLOW_SANDBOX_DRIVER_RESPONSE_TIMEOUT_EXTENSION) ||
        hasSandboxOrSmokeMarker(payload);
}

function getDriverResponseTimeoutSeconds(payload = {}) {
    if (shouldUseSmokeDriverResponseTimeout(payload)) {
        return getSmokeDriverResponseTimeoutSeconds();
    }

    return parsePositiveInt(
        process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS,
        DEFAULT_DRIVER_RESPONSE_TIMEOUT_SECONDS
    );
}

function getDriverSearchInitialRadiusKm() {
    return parsePositiveNumber(
        process.env.MATCH_INITIAL_RADIUS_KM,
        DEFAULT_DRIVER_SEARCH_INITIAL_RADIUS_KM
    );
}

function getDriverSearchMaxRadiusKm() {
    return parsePositiveNumber(
        process.env.MATCH_MAX_RADIUS_KM,
        DEFAULT_DRIVER_SEARCH_MAX_RADIUS_KM
    );
}

function getDriverSearchExpansionStepKm() {
    return parsePositiveNumber(
        process.env.MATCH_EXPANSION_STEP_KM,
        DEFAULT_DRIVER_SEARCH_EXPANSION_STEP_KM
    );
}

function getDriverSearchDriversPerWave() {
    return parsePositiveInt(
        process.env.MATCH_DRIVERS_PER_WAVE,
        DEFAULT_DRIVER_SEARCH_DRIVERS_PER_WAVE
    );
}

function getPaymentAvailabilityRadiusKm() {
    return parsePositiveNumber(
        process.env.PAYMENT_AVAILABILITY_RADIUS_KM,
        getDriverSearchMaxRadiusKm()
    );
}

function getPaymentAvailabilityLimit() {
    return parsePositiveInt(
        process.env.PAYMENT_AVAILABILITY_LIMIT,
        getDriverSearchDriversPerWave()
    );
}

function getOperationsPolicyRadiusKm() {
    return parsePositiveNumber(
        process.env.OPERATIONS_POLICY_RADIUS_KM,
        getDriverSearchMaxRadiusKm()
    );
}

function getOperationsPolicyDriverLimit() {
    return parsePositiveInt(
        process.env.OPERATIONS_POLICY_DRIVER_LIMIT,
        getDriverSearchDriversPerWave()
    );
}

module.exports = {
    DEFAULT_DRIVER_RESPONSE_TIMEOUT_SECONDS,
    DEFAULT_SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS,
    DEFAULT_DRIVER_SEARCH_INITIAL_RADIUS_KM,
    DEFAULT_DRIVER_SEARCH_MAX_RADIUS_KM,
    DEFAULT_DRIVER_SEARCH_EXPANSION_STEP_KM,
    DEFAULT_DRIVER_SEARCH_DRIVERS_PER_WAVE,
    getSmokeDriverResponseTimeoutSeconds,
    shouldUseSmokeDriverResponseTimeout,
    getDriverResponseTimeoutSeconds,
    getDriverSearchInitialRadiusKm,
    getDriverSearchMaxRadiusKm,
    getDriverSearchExpansionStepKm,
    getDriverSearchDriversPerWave,
    getPaymentAvailabilityRadiusKm,
    getPaymentAvailabilityLimit,
    getOperationsPolicyRadiusKm,
    getOperationsPolicyDriverLimit
};
