/**
 * Error reporting to Sentry.
 *
 * Off unless SENTRY_DSN is set; @sentry/node is only loaded then. Errors only
 * (no performance tracing) and Sentry's own OpenTelemetry setup is skipped,
 * because the backend already runs its own. Every event goes through the log
 * redaction plus a PII mask (CPF, e-mail, phone) before leaving the process.
 */
const path = require('path');
const { redactSensitiveValue } = require('./log-redaction');

const SERVICE_NAME = path.basename(process.argv[1] || 'node', '.js');
const THROTTLE_WINDOW_MS = 60 * 1000;
const THROTTLE_MAX_KEYS = 500;

const PII_PATTERNS = [
    [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
    // Only unambiguous phone formats (E.164 +55… or "(DD) 9xxxx-xxxx"), so plain
    // timestamps and amounts in messages stay readable.
    [/\+55\s?\d{2}\s?9?\d{4}-?\d{4}\b/g, '[PHONE]'],
    [/\(\d{2}\)\s?9?\d{4}-?\d{4}\b/g, '[PHONE]']
];

let sentryClient = null;
let initialized = false;
const lastSentAtByKey = new Map();

function maskPii(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
        return PII_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
    }
    if (!value || typeof value !== 'object' || seen.has(value)) {
        return value;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => maskPii(item, seen));
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskPii(item, seen)]));
}

function scrubEvent(event) {
    return maskPii(redactSensitiveValue(event));
}

function initSentry() {
    if (initialized) {
        return sentryClient;
    }
    initialized = true;

    const dsn = String(process.env.SENTRY_DSN || '').trim();
    if (!dsn) {
        return null;
    }

    try {
        sentryClient = require('@sentry/node');
    } catch (error) {
        return null;
    }

    sentryClient.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
        release: process.env.GIT_SHA && process.env.GIT_SHA !== 'unknown' ? process.env.GIT_SHA : undefined,
        serverName: SERVICE_NAME,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        skipOpenTelemetrySetup: true,
        beforeSend: scrubEvent,
        beforeBreadcrumb: (breadcrumb) => maskPii(redactSensitiveValue(breadcrumb))
    });
    sentryClient.setTag('service', SERVICE_NAME);
    return sentryClient;
}

/** Same error message from the same service at most once per window (protects the quota). */
function shouldSend(key, now = Date.now()) {
    const lastSentAt = lastSentAtByKey.get(key);
    if (lastSentAt && now - lastSentAt < THROTTLE_WINDOW_MS) {
        return false;
    }
    if (lastSentAtByKey.size >= THROTTLE_MAX_KEYS) {
        lastSentAtByKey.clear();
    }
    lastSentAtByKey.set(key, now);
    return true;
}

/** Forwards one error-level winston entry. */
function captureLogEntry(info = {}) {
    const client = initSentry();
    if (!client) {
        return false;
    }

    const message = String(info.message || 'error');
    if (!shouldSend(message)) {
        return false;
    }

    const { level, message: _message, timestamp, stack, error, ...context } = info;
    const errorValue = error instanceof Error ? error : null;
    // Muitos logs passam só error.message: sem isso o Sentry recebe a mensagem sem a causa.
    if (!errorValue && error !== undefined && error !== null) {
        context.error = error;
    }
    client.withScope((scope) => {
        if (info.service) scope.setTag('component', String(info.service));
        if (info.traceId) scope.setTag('traceId', String(info.traceId));
        scope.setExtras(context);
        if (errorValue) {
            client.captureException(errorValue);
        } else if (stack) {
            const synthetic = new Error(message);
            synthetic.stack = String(stack);
            client.captureException(synthetic);
        } else {
            client.captureMessage(message, 'error');
        }
    });
    return true;
}

module.exports = {
    captureLogEntry,
    initSentry,
    maskPii,
    scrubEvent,
    shouldSend
};
