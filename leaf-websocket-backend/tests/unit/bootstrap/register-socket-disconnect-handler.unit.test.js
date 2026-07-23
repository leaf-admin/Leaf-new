jest.mock('../../../services/accepted-ride-recovery-service', () => ({
    resolveAcceptedBookingCandidatesForDriver: jest.fn().mockResolvedValue({ bookingIds: [] }),
    recoverAcceptedBooking: jest.fn().mockResolvedValue({ recovered: false, skipped: true })
}));

const registerSocketDisconnectHandler = require('../../../bootstrap/register-socket-disconnect-handler');

describe('registerSocketDisconnectHandler driver online time cleanup', () => {
    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it('closes the driver daily online session and persists offline status on disconnect', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-25T12:30:00.000Z'));
        const startedAtMs = Date.parse('2026-06-25T12:00:00.000Z');
        const dailyKeyPattern = /^driver_online_daily:/;
        const redis = {
            status: 'ready',
            connect: jest.fn().mockResolvedValue(undefined),
            hgetall: jest.fn(async (key) => {
                if (key === 'driver:driver_1') {
                    return {
                        lat: '-22.9',
                        lng: '-43.2',
                        heading: '0',
                        speed: '0'
                    };
                }
                if (dailyKeyPattern.test(String(key))) {
                    return {
                        totalMs: '0',
                        sessionStartedAtMs: String(startedAtMs)
                    };
                }
                return {};
            }),
            hset: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
            zrem: jest.fn().mockResolvedValue(1),
            srem: jest.fn().mockResolvedValue(1)
        };
        const socket = {
            id: 'socket_1',
            userId: 'driver_1',
            userType: 'driver',
            vehiclePlate: 'ABC1D23',
            vehicleLockLeaseToken: 'socket_1',
            on: jest.fn((event, handler) => {
                socket.handlers[event] = handler;
            }),
            handlers: {}
        };
        const io = {
            engine: { clientsCount: 1 },
            connectedUsers: new Map([['driver_1', socket]])
        };
        const saveDriverLocation = jest.fn().mockResolvedValue(undefined);
        const vehicleLockManager = {
            releaseLock: jest.fn().mockResolvedValue(false)
        };

        registerSocketDisconnectHandler({
            socket,
            io,
            websocketRateLimiter: {
                unregisterConnection: jest.fn().mockResolvedValue(undefined)
            },
            connectionMonitor: {
                unregisterConnection: jest.fn().mockResolvedValue(undefined)
            },
            vehicleLockManager,
            redisPool: {
                getConnection: jest.fn(() => redis)
            },
            saveDriverLocation,
            logStructured: jest.fn(),
            releaseAdmissionSlotIfNeeded: jest.fn()
        });

        await socket.handlers.disconnect('transport close');

        expect(saveDriverLocation).toHaveBeenCalledWith(
            'driver_1',
            -22.9,
            -43.2,
            0,
            0,
            Date.parse('2026-06-25T12:30:00.000Z'),
            false
        );
        expect(redis.hset).toHaveBeenCalledWith(
            expect.stringMatching(dailyKeyPattern),
            expect.objectContaining({
                totalMs: String(30 * 60 * 1000),
                sessionStartedAtMs: '',
                closedReason: 'stale_heartbeat'
            })
        );
        expect(redis.hset).toHaveBeenCalledWith(
            'driver:driver_1',
            expect.objectContaining({
                status: 'OFFLINE',
                isOnline: 'false',
                dispatchEligible: 'false',
                dispatchEligibilityCode: 'OFFLINE'
            })
        );
        expect(vehicleLockManager.releaseLock).toHaveBeenCalledWith('ABC1D23', 'driver_1', {
            leaseToken: 'socket_1'
        });
        expect(io.connectedUsers.has('driver_1')).toBe(false);
    });

    it('preserves the new lease and online state when an older socket disconnects', async () => {
        const previousGrace = process.env.DRIVER_DISCONNECT_GRACE_MS;
        process.env.DRIVER_DISCONNECT_GRACE_MS = '0';
        const redis = {
            hgetall: jest.fn().mockResolvedValue({ socketId: 'socket_new' }),
            del: jest.fn().mockResolvedValue(0),
            hset: jest.fn().mockResolvedValue(1),
            zrem: jest.fn().mockResolvedValue(1),
            srem: jest.fn().mockResolvedValue(1)
        };
        const socket = {
            id: 'socket_old',
            userId: 'driver_1',
            userType: 'driver',
            vehiclePlate: 'ABC1D23',
            vehicleLockLeaseToken: 'socket_old',
            on: jest.fn((event, handler) => {
                socket.handlers[event] = handler;
            }),
            handlers: {}
        };
        const newSocket = { id: 'socket_new' };
        const io = {
            engine: { clientsCount: 1 },
            connectedUsers: new Map([['driver_1', newSocket]])
        };
        const vehicleLockManager = {
            releaseLock: jest.fn().mockResolvedValue(false),
            getLockOwner: jest.fn().mockResolvedValue({
                driverId: 'driver_1',
                leaseToken: 'socket_new'
            })
        };
        const saveDriverLocation = jest.fn();

        registerSocketDisconnectHandler({
            socket,
            io,
            websocketRateLimiter: {
                unregisterConnection: jest.fn().mockResolvedValue(undefined)
            },
            connectionMonitor: {
                unregisterConnection: jest.fn().mockResolvedValue(undefined)
            },
            vehicleLockManager,
            redisPool: { getConnection: jest.fn(() => redis) },
            saveDriverLocation,
            logStructured: jest.fn(),
            releaseAdmissionSlotIfNeeded: jest.fn()
        });

        await socket.handlers.disconnect('transport close');

        expect(vehicleLockManager.releaseLock).toHaveBeenCalledWith('ABC1D23', 'driver_1', {
            leaseToken: 'socket_old'
        });
        expect(vehicleLockManager.getLockOwner).toHaveBeenCalledWith('ABC1D23');
        expect(saveDriverLocation).not.toHaveBeenCalled();
        expect(redis.hset).not.toHaveBeenCalledWith(
            'driver:driver_1',
            expect.objectContaining({ status: 'OFFLINE' })
        );
        expect(io.connectedUsers.get('driver_1')).toBe(newSocket);

        if (previousGrace === undefined) {
            delete process.env.DRIVER_DISCONNECT_GRACE_MS;
        } else {
            process.env.DRIVER_DISCONNECT_GRACE_MS = previousGrace;
        }
    });
});
