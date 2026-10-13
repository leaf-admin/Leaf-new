/**
 * Pendências de crédito de taxa de cancelamento.
 *
 * O cancelamento cobra a taxa do passageiro na hora; o crédito do motorista depende de um
 * evento que pode se perder (falha ao gravar no stream, worker parado, tentativas esgotadas).
 * O comando grava aqui o que precisa ser creditado antes de publicar o evento, e o
 * billing-worker só apaga a pendência depois de creditar. O que sobrar é reprocessado
 * pelo próprio worker, protegido pela mesma chave de idempotência do evento.
 */

const PENDING_HASH_KEY = 'billing:cancellation_credit_pending';
const DEFAULT_MIN_AGE_MS = 2 * 60 * 1000;
const MAX_AUTOMATIC_ATTEMPTS = 30;

function parseEntry(raw) {
    try {
        const entry = JSON.parse(raw);
        return entry && typeof entry === 'object' ? entry : null;
    } catch (error) {
        return null;
    }
}

async function recordPendingCancellationCredit(redis, entry = {}) {
    const bookingId = String(entry.bookingId || '').trim();
    const driverId = String(entry.driverId || '').trim();
    const cancellationFee = Number(entry.cancellationFee) || 0;
    if (!redis || !bookingId || !driverId || cancellationFee <= 0) {
        return false;
    }

    await redis.hset(
        PENDING_HASH_KEY,
        bookingId,
        JSON.stringify({
            bookingId,
            driverId,
            cancellationFee,
            financialContext: entry.financialContext || null,
            providerEnvironment: entry.providerEnvironment || null,
            createdAt: Date.now(),
            attempts: 0
        })
    );
    return true;
}

async function clearPendingCancellationCredit(redis, bookingId) {
    const normalizedBookingId = String(bookingId || '').trim();
    if (!redis || !normalizedBookingId) {
        return false;
    }
    await redis.hdel(PENDING_HASH_KEY, normalizedBookingId);
    return true;
}

async function listDuePendingCancellationCredits(redis, { minAgeMs = DEFAULT_MIN_AGE_MS, now = Date.now() } = {}) {
    if (!redis) {
        return [];
    }
    const all = (await redis.hgetall(PENDING_HASH_KEY)) || {};
    return Object.values(all)
        .map(parseEntry)
        .filter((entry) => entry && entry.bookingId && now - (Number(entry.createdAt) || 0) >= minAgeMs);
}

async function registerPendingAttempt(redis, entry, errorMessage = null) {
    if (!redis || !entry?.bookingId) {
        return null;
    }
    const next = {
        ...entry,
        attempts: (Number(entry.attempts) || 0) + 1,
        lastAttemptAt: Date.now(),
        lastError: errorMessage ? String(errorMessage).slice(0, 300) : null
    };
    await redis.hset(PENDING_HASH_KEY, entry.bookingId, JSON.stringify(next));
    return next;
}

module.exports = {
    PENDING_HASH_KEY,
    DEFAULT_MIN_AGE_MS,
    MAX_AUTOMATIC_ATTEMPTS,
    recordPendingCancellationCredit,
    clearPendingCancellationCredit,
    listDuePendingCancellationCredits,
    registerPendingAttempt
};
