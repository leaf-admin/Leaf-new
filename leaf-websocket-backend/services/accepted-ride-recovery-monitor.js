const redisPool = require('../utils/redis-pool');
const {
    normalizeBoolean,
    parseTimestamp,
    isAcceptedBooking,
    hasTripStarted,
    recoverAcceptedBooking
} = require('./accepted-ride-recovery-service');
const { setActiveTripForDriver } = require('../utils/active-trip-index');
const { getTTL } = require('../config/redis-ttl-config');
const { logStructured } = require('../utils/logger');

class AcceptedRideRecoveryMonitor {
    constructor(io, config = {}) {
        this.io = io;
        this.redis = redisPool.getConnection();
        this.intervalId = null;
        this.isRunning = false;
        this.config = {
            checkIntervalMs: Math.max(5000, Number.parseInt(
                config.checkIntervalMs || process.env.ACCEPTED_RIDE_RECOVERY_INTERVAL_MS || '15000',
                10
            )),
            acceptedGraceMs: Math.max(10000, Number.parseInt(
                config.acceptedGraceMs || process.env.ACCEPTED_RIDE_RECOVERY_GRACE_MS || '45000',
                10
            )),
            maxBookingsPerPass: Math.max(1, Number.parseInt(
                config.maxBookingsPerPass || process.env.ACCEPTED_RIDE_RECOVERY_MAX_BOOKINGS || '300',
                10
            )),
            driverLivenessGraceMs: Math.max(15000, Number.parseInt(
                config.driverLivenessGraceMs ||
                process.env.ACCEPTED_RIDE_RECOVERY_DRIVER_LIVENESS_MS ||
                String(getTTL('HEARTBEAT', 'DRIVER') * 1000 + 15000),
                10
            ))
        };
    }

    start() {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        logStructured('info', 'AcceptedRideRecoveryMonitor iniciado', {
            service: 'accepted-ride-recovery-monitor',
            checkIntervalMs: this.config.checkIntervalMs,
            acceptedGraceMs: this.config.acceptedGraceMs,
            maxBookingsPerPass: this.config.maxBookingsPerPass,
            driverLivenessGraceMs: this.config.driverLivenessGraceMs
        });

        this.reconcile().catch((error) => {
            logStructured('error', 'Erro na primeira execução do AcceptedRideRecoveryMonitor', {
                service: 'accepted-ride-recovery-monitor',
                error: error.message
            });
        });

        this.intervalId = setInterval(() => {
            this.reconcile().catch((error) => {
                logStructured('error', 'Erro na execução periódica do AcceptedRideRecoveryMonitor', {
                    service: 'accepted-ride-recovery-monitor',
                    error: error.message
                });
            });
        }, this.config.checkIntervalMs);
    }

    stop() {
        if (!this.isRunning) {
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        logStructured('info', 'AcceptedRideRecoveryMonitor parado', {
            service: 'accepted-ride-recovery-monitor'
        });
    }

    isDriverConnected(driverId) {
        if (!driverId || !this.io?.connectedUsers) {
            return false;
        }

        const socket = this.io.connectedUsers.get(String(driverId));
        return Boolean(socket && socket.connected && socket.userType === 'driver');
    }

    parseDriverLastSeenMs(driverData) {
        if (!driverData || typeof driverData !== 'object') {
            return null;
        }

        return (
            parseTimestamp(driverData.lastSeen) ||
            parseTimestamp(driverData.lastUpdate) ||
            parseTimestamp(driverData.timestamp)
        );
    }

    async reconcile() {
        await redisPool.ensureConnection();
        const redis = this.redis;

        const bookingIds = await redis.hkeys('bookings:active');
        if (!bookingIds || bookingIds.length === 0) {
            return;
        }

        const now = Date.now();
        const stats = {
            scanned: 0,
            recovered: 0,
            healedActiveTripIndex: 0,
            cleanedOrphanedActiveHash: 0,
            skippedGrace: 0
        };

        for (const bookingId of bookingIds.slice(0, this.config.maxBookingsPerPass)) {
            stats.scanned += 1;
            const bookingKey = `booking:${bookingId}`;
            const bookingData = await redis.hgetall(bookingKey);

            if (!bookingData || Object.keys(bookingData).length === 0) {
                await redis.hdel('bookings:active', bookingId);
                stats.cleanedOrphanedActiveHash += 1;
                continue;
            }

            if (!isAcceptedBooking(bookingData) || hasTripStarted(bookingData)) {
                continue;
            }

            const acceptedAtMs = parseTimestamp(bookingData.acceptedAt) || parseTimestamp(bookingData.updatedAt);
            if (acceptedAtMs && now - acceptedAtMs < this.config.acceptedGraceMs) {
                stats.skippedGrace += 1;
                continue;
            }

            const driverId = String(bookingData.driverId || '');
            if (!driverId) {
                const recoveredWithoutDriver = await recoverAcceptedBooking({
                    redis,
                    io: this.io,
                    bookingId,
                    reason: 'accepted_without_driver_assignment',
                    source: 'accepted_recovery_monitor'
                });
                if (recoveredWithoutDriver.recovered) {
                    stats.recovered += 1;
                }
                continue;
            }

            const [driverData, activeTripId] = await Promise.all([
                redis.hgetall(`driver:${driverId}`),
                redis.get(`active_trip_by_driver:${driverId}`)
            ]);

            const driverConnected = this.isDriverConnected(driverId);
            const driverExists = Boolean(driverData && Object.keys(driverData).length > 0);
            const driverOnline = driverExists && normalizeBoolean(driverData.isOnline);
            const activeTripMatches = Boolean(activeTripId && String(activeTripId) === String(bookingId));

            if (driverConnected && !activeTripMatches) {
                await setActiveTripForDriver(redis, driverId, bookingId, bookingData.customerId || null);
                stats.healedActiveTripIndex += 1;
                continue;
            }

            const lastSeenMs = this.parseDriverLastSeenMs(driverData);
            const staleLiveness = !lastSeenMs || (now - lastSeenMs > this.config.driverLivenessGraceMs);

            const shouldRecover =
                !driverConnected &&
                (
                    !driverExists ||
                    !driverOnline ||
                    !activeTripMatches ||
                    staleLiveness
                );

            if (!shouldRecover) {
                continue;
            }

            const reason = !driverExists
                ? 'accepted_driver_hash_missing'
                : !driverOnline
                    ? 'accepted_driver_offline'
                    : !activeTripMatches
                        ? 'accepted_driver_active_trip_mismatch'
                        : 'accepted_driver_stale_liveness';

            const recoveryResult = await recoverAcceptedBooking({
                redis,
                io: this.io,
                bookingId,
                expectedDriverId: driverId,
                reason,
                source: 'accepted_recovery_monitor'
            });

            if (recoveryResult.recovered) {
                stats.recovered += 1;
            }
        }

        if (
            stats.recovered > 0 ||
            stats.healedActiveTripIndex > 0 ||
            stats.cleanedOrphanedActiveHash > 0
        ) {
            logStructured('info', 'AcceptedRideRecoveryMonitor aplicou reconciliação', {
                service: 'accepted-ride-recovery-monitor',
                ...stats
            });
        }
    }
}

module.exports = AcceptedRideRecoveryMonitor;
