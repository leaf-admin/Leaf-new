const DEFAULT_DRIVER_RESPONSE_TIMEOUT_SECONDS = 20;

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDriverResponseTimeoutSeconds() {
    return parsePositiveInt(
        process.env.DISPATCH_DRIVER_RESPONSE_TIMEOUT_SECONDS,
        DEFAULT_DRIVER_RESPONSE_TIMEOUT_SECONDS
    );
}

module.exports = {
    DEFAULT_DRIVER_RESPONSE_TIMEOUT_SECONDS,
    getDriverResponseTimeoutSeconds
};
