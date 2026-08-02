const registerSocketAuthenticateHandler = require('../../../bootstrap/register-socket-authenticate-handler');

describe('registerSocketAuthenticateHandler session policy', () => {
    const originalEnv = {
        ALLOW_MULTIPLE_SESSIONS: process.env.ALLOW_MULTIPLE_SESSIONS,
        AUTH_SYNC_FCM: process.env.AUTH_SYNC_FCM,
        NODE_ENV: process.env.NODE_ENV
    };

    beforeEach(() => {
        delete process.env.ALLOW_MULTIPLE_SESSIONS;
        process.env.AUTH_SYNC_FCM = 'true';
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.ALLOW_MULTIPLE_SESSIONS = originalEnv.ALLOW_MULTIPLE_SESSIONS;
        process.env.AUTH_SYNC_FCM = originalEnv.AUTH_SYNC_FCM;
        process.env.NODE_ENV = originalEnv.NODE_ENV;
        jest.useRealTimers();
    });

    function buildHarness({ existingSocket = null, distributedSockets = [], redisOverrides = {} } = {}) {
        const listeners = {};
        const roomMembers = new Map();
        const registerRoomSocket = (room, roomSocket) => {
            if (!roomMembers.has(room)) {
                roomMembers.set(room, new Map());
            }
            roomMembers.get(room).set(roomSocket.id, roomSocket);
        };
        const socket = {
            id: 'new-socket',
            handshake: { auth: {}, headers: {}, query: {} },
            on: jest.fn((event, handler) => {
                listeners[event] = handler;
            }),
            emit: jest.fn(),
            disconnect: jest.fn(),
            join: jest.fn(async room => registerRoomSocket(room, socket))
        };
        for (const distributedSocket of distributedSockets) {
            registerRoomSocket('driver_user-1', distributedSocket);
            registerRoomSocket(distributedSocket.id, distributedSocket);
        }
        if (existingSocket) {
            registerRoomSocket('driver_user-1', existingSocket);
            registerRoomSocket(existingSocket.id, existingSocket);
        }
        const redis = {
            hget: jest.fn().mockResolvedValue(null),
            hset: jest.fn().mockResolvedValue(1),
            exists: jest.fn().mockResolvedValue(0),
            hgetall: jest.fn().mockResolvedValue({}),
            expire: jest.fn().mockResolvedValue(1),
            del: jest.fn().mockResolvedValue(1),
            set: jest.fn().mockResolvedValue('OK'),
            get: jest.fn().mockResolvedValue(null),
            eval: jest.fn().mockResolvedValue(1),
            ...redisOverrides
        };
        const io = {
            connectedUsers: new Map(existingSocket ? [['user-1', existingSocket]] : []),
            in: jest.fn(room => {
                const rooms = Array.isArray(room) ? room : [room];
                const sockets = new Map();
                for (const roomName of rooms) {
                    for (const roomSocket of roomMembers.get(roomName)?.values() || []) {
                        sockets.set(roomSocket.id, roomSocket);
                    }
                }
                return {
                    fetchSockets: jest.fn(async () => Array.from(sockets.values())),
                    disconnectSockets: jest.fn(() => {
                        for (const roomSocket of sockets.values()) {
                            roomSocket.disconnect?.();
                        }
                    })
                };
            }),
            to: jest.fn(room => ({
                emit: jest.fn((event, payload) => {
                    for (const roomSocket of roomMembers.get(room)?.values() || []) {
                        roomSocket.emit?.(event, payload);
                    }
                })
            }))
        };

        registerSocketAuthenticateHandler({
            socket,
            io,
            cluster: { worker: null },
            connectionMonitor: {
                registerConnection: jest.fn().mockResolvedValue(undefined),
                updateConnectionType: jest.fn().mockResolvedValue(undefined)
            },
            redisPool: {
                ensureConnection: jest.fn().mockResolvedValue(undefined),
                getConnection: jest.fn(() => redis)
            },
            fcmService: {
                isServiceAvailable: jest.fn(() => true),
                setRedis: jest.fn(),
                initialize: jest.fn().mockResolvedValue(undefined),
                saveUserFCMToken: jest.fn().mockResolvedValue(true),
                removeUserFCMToken: jest.fn().mockResolvedValue(true)
            },
            logStructured: jest.fn(),
            authDebugEnabled: false,
            releaseAdmissionSlotIfNeeded: jest.fn(),
            fingerprintToken: jest.fn(() => ''),
            acquireAuthVerifySlot: jest.fn().mockResolvedValue(() => {}),
            verifyFirebaseTokenCached: jest.fn()
        });

        return { listeners, socket, io, redis };
    }

    it('allows multiple passenger sessions without terminating the previous socket', async () => {
        const previousSocket = {
            id: 'previous-passenger-socket',
            emit: jest.fn(),
            disconnect: jest.fn()
        };
        const { listeners, io, socket } = buildHarness({ existingSocket: previousSocket });

        await listeners.authenticate({ uid: 'user-1', userType: 'customer' });

        expect(previousSocket.emit).not.toHaveBeenCalledWith(
            'sessionTerminated',
            expect.any(Object)
        );
        expect(previousSocket.disconnect).not.toHaveBeenCalled();
        expect(io.connectedUsers.get('user-1')).toBe(socket);
    });

    it('keeps single-session enforcement for drivers', async () => {
        jest.useFakeTimers();
        const previousSocket = {
            id: 'previous-driver-socket',
            emit: jest.fn(),
            disconnect: jest.fn()
        };
        const { listeners, io, socket, redis } = buildHarness({ existingSocket: previousSocket });

        await listeners.authenticate({ uid: 'user-1', userType: 'driver' });

        expect(previousSocket.emit).toHaveBeenCalledWith(
            'sessionTerminated',
            expect.objectContaining({
                code: 'SESSION_REPLACED',
                userId: 'user-1',
                userType: 'driver',
                newSocketId: 'new-socket',
                previousSocketId: 'previous-driver-socket'
            })
        );

        jest.advanceTimersByTime(251);

        expect(previousSocket.disconnect).toHaveBeenCalled();
        expect(io.connectedUsers.get('user-1')).toBe(socket);
        expect(socket.join).toHaveBeenCalledWith('session_user_user-1');
        expect(redis.set).toHaveBeenCalledWith(
            'session_lock:user-1',
            expect.stringContaining('new-socket:'),
            'PX',
            5000,
            'NX'
        );
        expect(redis.eval).toHaveBeenCalled();
    });

    it('replaces a driver session discovered through the distributed Socket.IO room', async () => {
        jest.useFakeTimers();
        const previousSocket = {
            id: 'socket-on-another-gateway',
            emit: jest.fn(),
            disconnect: jest.fn()
        };
        const { listeners, io, socket } = buildHarness({
            distributedSockets: [previousSocket]
        });

        await listeners.authenticate({ uid: 'user-1', userType: 'driver' });

        expect(io.in).toHaveBeenCalledWith(['driver_user-1', 'session_user_user-1']);
        expect(io.to).toHaveBeenCalledWith('socket-on-another-gateway');
        expect(previousSocket.emit).toHaveBeenCalledWith(
            'sessionTerminated',
            expect.objectContaining({
                code: 'SESSION_REPLACED',
                previousSocketId: 'socket-on-another-gateway',
                newSocketId: 'new-socket'
            })
        );

        jest.advanceTimersByTime(251);

        expect(previousSocket.disconnect).toHaveBeenCalledTimes(1);
        expect(socket.disconnect).not.toHaveBeenCalled();
        expect(io.connectedUsers.get('user-1')).toBe(socket);
    });

    it('hydrates driver online daily snapshot in the authenticated payload', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-25T12:30:00.000Z'));
        const startedAtMs = Date.parse('2026-06-25T12:00:00.000Z');
        const { listeners, socket } = buildHarness({
            redisOverrides: {
                hgetall: jest.fn(async (key) => {
                    if (key === 'driver:user-1') {
                        return {
                            isOnline: 'true',
                            status: 'AVAILABLE'
                        };
                    }
                    if (String(key).startsWith('driver_online_daily:')) {
                        return {
                            totalMs: String(15 * 60 * 1000),
                            sessionStartedAtMs: String(startedAtMs)
                        };
                    }
                    return {};
                })
            }
        });

        await listeners.authenticate({ uid: 'user-1', userType: 'driver' });

        expect(socket.emit).toHaveBeenCalledWith(
            'authenticated',
            expect.objectContaining({
                uid: 'user-1',
                userType: 'driver',
                isOnline: true,
                driverOnline: true,
                status: 'online',
                driverOnlineDaily: expect.objectContaining({
                    totalMs: 15 * 60 * 1000,
                    sessionStartedAtMs: startedAtMs,
                    effectiveMs: 45 * 60 * 1000
                })
            })
        );
    });

    it('closes a stale daily online session before hydrating an offline driver auth payload', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-25T12:30:00.000Z'));
        const startedAtMs = Date.parse('2026-06-25T12:00:00.000Z');
        const offlineAtMs = Date.parse('2026-06-25T12:05:00.000Z');
        let dailyHash = {
            totalMs: '0',
            sessionStartedAtMs: String(startedAtMs)
        };
        const redisOverrides = {
            hgetall: jest.fn(async (key) => {
                if (key === 'driver:user-1') {
                    return {
                        isOnline: 'false',
                        status: 'OFFLINE',
                        updatedAt: new Date(offlineAtMs).toISOString()
                    };
                }
                if (String(key).startsWith('driver_online_daily:')) {
                    return { ...dailyHash };
                }
                return {};
            }),
            hset: jest.fn(async (key, patch) => {
                if (String(key).startsWith('driver_online_daily:')) {
                    dailyHash = { ...dailyHash, ...patch };
                }
                return 1;
            })
        };
        const { listeners, socket } = buildHarness({ redisOverrides });

        await listeners.authenticate({ uid: 'user-1', userType: 'driver' });

        expect(redisOverrides.hset).toHaveBeenCalledWith(
            expect.stringMatching(/^driver_online_daily:/),
            expect.objectContaining({
                totalMs: String(5 * 60 * 1000),
                sessionStartedAtMs: '',
                closedReason: 'stale_heartbeat'
            })
        );
        expect(socket.emit).toHaveBeenCalledWith(
            'authenticated',
            expect.objectContaining({
                uid: 'user-1',
                userType: 'driver',
                isOnline: false,
                driverOnline: false,
                status: 'offline',
                driverOnlineDaily: expect.objectContaining({
                    totalMs: 5 * 60 * 1000,
                    sessionStartedAtMs: null,
                    effectiveMs: 5 * 60 * 1000,
                    limitReached: false
                })
            })
        );
    });
});
