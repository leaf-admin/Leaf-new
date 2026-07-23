// driver-status-check.js
// Endpoint para verificar status completo do driver

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const redisPool = require('../utils/redis-pool');
const connectionMonitor = require('../services/connection-monitor');
const { readDriverSocketPresence } = require('../services/driver-socket-presence-service');
const { logError, logSecurity } = require('../utils/logger');

const toPositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const DRIVER_STATUS_RATE_LIMIT_WINDOW_SEC = toPositiveInt(
    process.env.RATE_LIMIT_HTTP_DRIVER_STATUS_DEBUG_WINDOW_SECONDS,
    60
);
const DRIVER_STATUS_RATE_LIMIT_MAX = toPositiveInt(
    process.env.RATE_LIMIT_HTTP_DRIVER_STATUS_DEBUG,
    90
);
const DRIVER_STATUS_ACCESS_TOKEN = String(
    process.env.DRIVER_STATUS_DEBUG_TOKEN ||
    process.env.RUNTIME_ADMIN_TOKEN ||
    process.env.RESTART_TOKEN ||
    ''
).trim();
const DRIVER_STATUS_INCLUDE_CONNECTION_MONITOR =
    String(process.env.DRIVER_STATUS_INCLUDE_CONNECTION_MONITOR || 'false').toLowerCase() === 'true';
const DRIVER_STATUS_REQUIRE_LOCAL_SOCKET =
    String(process.env.DRIVER_STATUS_REQUIRE_LOCAL_SOCKET || 'true').toLowerCase() !== 'false';
const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';

const enforceDriverStatusAccess = (req, res, next) => {
    if (process.env.NODE_ENV !== 'production') {
        return next();
    }

    if (!DRIVER_STATUS_ACCESS_TOKEN) {
        return res.status(503).json({
            error: 'Token de debug de driver status nao configurado',
            hint: 'Configure DRIVER_STATUS_DEBUG_TOKEN ou RUNTIME_ADMIN_TOKEN'
        });
    }

    const providedToken =
        req.headers['x-driver-status-token'] ||
        req.headers['x-runtime-token'] ||
        req.query.token;

    if (providedToken !== DRIVER_STATUS_ACCESS_TOKEN) {
        logSecurity('warn', 'Acesso negado em /api/driver-status', {
            service: 'driver-status-check-routes',
            ip: req.ip,
            path: req.originalUrl
        });
        return res.status(401).json({ error: 'Nao autorizado' });
    }

    return next();
};

const driverStatusLimiter = rateLimit({
    windowMs: DRIVER_STATUS_RATE_LIMIT_WINDOW_SEC * 1000,
    max: DRIVER_STATUS_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Muitas consultas de driver status. Aguarde um momento.',
        retryAfter: DRIVER_STATUS_RATE_LIMIT_WINDOW_SEC
    },
    handler: (req, res) => {
        logSecurity('warn', 'Rate limit excedido em /api/driver-status', {
            service: 'driver-status-check-routes',
            ip: req.ip,
            path: req.originalUrl
        });
        res.status(429).json({
            error: 'Muitas consultas de driver status. Aguarde um momento.',
            retryAfter: DRIVER_STATUS_RATE_LIMIT_WINDOW_SEC
        });
    }
});

const isDriverSocket = (socket, driverId) => {
    if (!socket) return false;
    return socket.userId === driverId && socket.userType === 'driver';
};

const getSocketRooms = (socket) => Array.from(socket?.rooms || []);

const resolveDriverSocketFast = (io, driverId) => {
    // Fast-path principal: mapa em memória de usuários conectados.
    const cachedSocket = io?.connectedUsers?.get?.(driverId);
    if (isDriverSocket(cachedSocket, driverId)) {
        return cachedSocket;
    }

    // Fast-path secundário: lookup direto por id no mapa nativo do Socket.IO.
    if (cachedSocket?.id) {
        const liveSocket = io?.sockets?.sockets?.get?.(cachedSocket.id);
        if (isDriverSocket(liveSocket, driverId)) {
            return liveSocket;
        }
    }

    return null;
};

router.use(enforceDriverStatusAccess);
router.use(driverStatusLimiter);

// ✅ IMPORTANTE: Rotas específicas DEVEM vir ANTES das rotas dinâmicas
// Caso contrário, /locks/all será capturado por /:driverId

/**
 * Listar todos os locks ativos
 * GET /api/driver-status/locks/all
 */
router.get('/locks/all', async (req, res) => {
    try {
        const driverLockManager = require('../services/driver-lock-manager');
        const stats = await driverLockManager.getLockStats();
        
        return res.json({
            success: true,
            total: stats.total,
            locks: stats.locks
        });
    } catch (error) {
        logError(error, '❌ Erro ao listar locks:', { service: 'driver-status-check-routes' });
        res.status(500).json({ error: 'Erro ao listar locks' });
    }
});

/**
 * Limpar locks de todos os drivers conectados
 * POST /api/driver-status/clear-all-locks
 */
router.post('/clear-all-locks', async (req, res) => {
    try {
        const io = req.app.get('io');
        const driverLockManager = require('../services/driver-lock-manager');
        
        if (!io) {
            return res.status(500).json({ error: 'WebSocket server não disponível' });
        }
        
        const localConnectedUsers = io?.connectedUsers instanceof Map
            ? Array.from(io.connectedUsers.values())
            : [];
        const localDriverSockets = localConnectedUsers.filter((socket) => socket?.userType === 'driver' && socket?.userId);
        const uniqueDriverIds = [...new Set(localDriverSockets.map((socket) => socket.userId).filter(Boolean))];
        
        const results = [];
        
        for (const driverId of uniqueDriverIds) {
            const lockStatus = await driverLockManager.isDriverLocked(driverId);
            
            if (lockStatus.isLocked) {
                await driverLockManager.releaseLock(driverId);
                results.push({
                    driverId,
                    wasLocked: true,
                    bookingId: lockStatus.bookingId,
                    action: 'liberado'
                });
            } else {
                results.push({
                    driverId,
                    wasLocked: false,
                    bookingId: null,
                    action: 'sem lock'
                });
            }
        }
        
        const lockedCount = results.filter(r => r.wasLocked).length;
        const clearedCount = results.filter(r => r.action === 'liberado').length;
        
        return res.json({
            success: true,
            message: `${clearedCount} lock(s) liberado(s) de ${uniqueDriverIds.length} driver(s) conectado(s)`,
            totalDrivers: uniqueDriverIds.length,
            lockedDrivers: lockedCount,
            clearedLocks: clearedCount,
            results
        });
    } catch (error) {
        logError(error, '❌ Erro ao limpar locks:', { service: 'driver-status-check-routes' });
        res.status(500).json({ error: 'Erro ao limpar locks' });
    }
});

/**
 * Verificar status completo do driver
 * GET /api/driver-status/:driverId
 */
router.get('/:driverId', async (req, res) => {
    try {
        const { driverId } = req.params;
        const io = req.app.get('io'); // Socket.IO instance
        
        if (!io) {
            return res.status(500).json({ error: 'WebSocket server não disponível' });
        }

        // 1. Verificar total de conexões (opcional - caminho pesado).
        let driverConnections = null;
        if (DRIVER_STATUS_INCLUDE_CONNECTION_MONITOR) {
            try {
                const stats = await connectionMonitor.getConsolidatedStats();
                driverConnections = stats?.byType?.driver || 0;
            } catch (statsError) {
                driverConnections = null;
            }
        }
        
        // 2. Verificar se está no Redis (online)
        const redis = redisPool.getConnection();
        const isOnlineInRedis = await redis.zscore('driver_locations', driverId) !== null;
        const isEligibleInGeo = await redis.zscore(ELIGIBLE_DRIVER_GEO_KEY, driverId) !== null;
        
        // 3. Verificar se está em algum room do Socket.IO
        let isInDriverRoom = false;
        let socketId = null;
        let isAuthenticated = false;
        let driverSocket = resolveDriverSocketFast(io, driverId);
        let distributedPresence = null;

        // Fallback somente quando fast-path não encontrar conexão (caminho custoso).
        if (!driverSocket) {
            const sockets = await io.fetchSockets();
            driverSocket = sockets.find((socket) => isDriverSocket(socket, driverId)) || null;
        }

        if (driverSocket) {
            socketId = driverSocket.id || null;
            isAuthenticated = true;
            const rooms = getSocketRooms(driverSocket);
            isInDriverRoom = rooms.includes('drivers_room') || rooms.includes(`driver_${driverId}`);
        } else {
            const presence = await readDriverSocketPresence(redis, driverId);
            if (presence.reachable) {
                distributedPresence = presence;
                socketId = presence.socketId || null;
                isAuthenticated = true;
                isInDriverRoom = true;
            }
        }
        
        // 4. Verificar status no Redis (modelo atual: hash driver:{id})
        const driverHash = await redis.hgetall(`driver:${driverId}`);
        const legacyDriverStatus = await redis.hget(`driver:${driverId}:status`, 'status');
        const normalizedStatus = String(
            driverHash?.status || legacyDriverStatus || 'offline'
        ).toLowerCase();
        const isOnlineFlag = driverHash?.isOnline === 'true' || driverHash?.isOnline === true;
        const isOnlineStatus = isOnlineFlag || normalizedStatus === 'online' || normalizedStatus === 'available';
        
        // 5. Verificar se pode receber solicitações
        const isDispatchEligible = driverHash?.dispatchEligible !== 'false';
        const canReceiveRequestsByRedis = (
            isOnlineStatus &&
            isOnlineInRedis &&
            isDispatchEligible &&
            isEligibleInGeo
        );
        const canReceiveRequestsBySocket = (
            isAuthenticated &&
            isInDriverRoom &&
            socketId !== null &&
            isOnlineStatus &&
            isDispatchEligible
        );
        const canReceiveRequests = DRIVER_STATUS_REQUIRE_LOCAL_SOCKET
            ? canReceiveRequestsBySocket
            : (canReceiveRequestsByRedis || canReceiveRequestsBySocket);

        // 6. Verificar última localização
        let lastLocation = null;
        if (driverHash && driverHash.lat && driverHash.lng) {
            lastLocation = {
                lat: Number.parseFloat(driverHash.lat),
                lng: Number.parseFloat(driverHash.lng),
                heading: Number.parseFloat(driverHash.heading || 0),
                speed: Number.parseFloat(driverHash.speed || 0),
                timestamp: driverHash.lastSeen || driverHash.timestamp || null
            };
        } else if (isOnlineInRedis) {
            const locationStr = await redis.hget(`driver:${driverId}:location`, 'data');
            if (locationStr) {
                try {
                    lastLocation = JSON.parse(locationStr);
                } catch (e) {
                    lastLocation = { error: 'Invalid legacy location data' };
                }
            }
        }

        const status = {
            driverId,
            connected: socketId !== null,
            authenticated: isAuthenticated,
            online: isOnlineStatus,
            inDriverRoom: isInDriverRoom,
            canReceiveRequests,
            socketId,
            status: normalizedStatus,
            lastLocation,
            timestamp: new Date().toISOString(),
            details: {
                totalDriverConnections: driverConnections,
                isOnlineInRedis,
                isEligibleInGeo,
                dispatchEligible: driverHash?.dispatchEligible || null,
                dispatchEligibilityCode: driverHash?.dispatchEligibilityCode || null,
                canReceiveRequestsByRedis,
                canReceiveRequestsBySocket,
                distributedPresence: distributedPresence
                    ? {
                        socketId: distributedPresence.socketId,
                        workerId: distributedPresence.workerId,
                        updatedAt: distributedPresence.updatedAt,
                        ageMs: distributedPresence.ageMs
                    }
                    : null,
                rooms: driverSocket ? getSocketRooms(driverSocket) : (distributedPresence?.rooms || [])
            }
        };
        
        res.json(status);
    } catch (error) {
        logError(error, '❌ Erro ao verificar status do driver:', { service: 'driver-status-check-routes' });
        res.status(500).json({ 
            error: error.message,
            driverId: req.params.driverId
        });
    }
});

/**
 * Enviar solicitação de teste para o driver
 * POST /api/driver-status/:driverId/test-request
 */
router.post('/:driverId/test-request', async (req, res) => {
    try {
        const { driverId } = req.params;
        const io = req.app.get('io');
        
        if (!io) {
            return res.status(500).json({ error: 'WebSocket server não disponível' });
        }
        
        // Buscar socket do driver com fast-path local antes de fallback custoso.
        let driverSocket = resolveDriverSocketFast(io, driverId);
        if (!driverSocket) {
            const sockets = await io.fetchSockets();
            driverSocket = sockets.find((socket) => isDriverSocket(socket, driverId)) || null;
        }
        
        if (!driverSocket) {
            return res.status(404).json({ 
                error: 'Driver não conectado',
                driverId,
                connected: false
            });
        }
        
        // Criar solicitação de teste
        const testRequest = {
            rideId: `test_${Date.now()}`,
            bookingId: `test_${Date.now()}`,
            customerId: 'test-customer',
            pickupLocation: {
                lat: -22.9208,
                lng: -43.4060,
                address: 'Local de Teste - Pickup'
            },
            destinationLocation: {
                lat: -22.9100,
                lng: -43.4000,
                address: 'Local de Teste - Destino'
            },
            estimatedFare: 25.50,
            paymentMethod: 'pix',
            timeout: 15,
            timestamp: new Date().toISOString(),
            isTest: true
        };
        
        // Enviar para o driver
        driverSocket.emit('newRideRequest', testRequest);
        
        res.json({
            success: true,
            message: 'Solicitação de teste enviada',
            driverId,
            socketId: driverSocket.id,
            request: testRequest
        });
    } catch (error) {
        logError(error, '❌ Erro ao enviar solicitação de teste:', { service: 'driver-status-check-routes' });
        res.status(500).json({ error: error.message });
    }
});

// ✅ Endpoint para verificar e limpar lock de um motorista
router.post('/:driverId/clear-lock', async (req, res) => {
    try {
        const { driverId } = req.params;
        
        if (!driverId) {
            return res.status(400).json({ error: 'driverId é obrigatório' });
        }
        
        const driverLockManager = require('../services/driver-lock-manager');
        
        // Verificar lock atual
        const lockStatus = await driverLockManager.isDriverLocked(driverId);
        
        // Liberar lock se existir
        if (lockStatus.isLocked) {
            await driverLockManager.releaseLock(driverId);
            return res.json({
                success: true,
                message: `Lock liberado para driver ${driverId}`,
                previousLock: {
                    bookingId: lockStatus.bookingId,
                    wasLocked: true
                }
            });
        } else {
            return res.json({
                success: true,
                message: `Driver ${driverId} não estava com lock`,
                previousLock: {
                    bookingId: null,
                    wasLocked: false
                }
            });
        }
    } catch (error) {
        logError(error, '❌ Erro ao limpar lock:', { service: 'driver-status-check-routes' });
        res.status(500).json({ error: 'Erro ao limpar lock' });
    }
});

// ✅ Endpoint para verificar lock de um motorista
router.get('/:driverId/lock', async (req, res) => {
    try {
        const { driverId } = req.params;
        
        if (!driverId) {
            return res.status(400).json({ error: 'driverId é obrigatório' });
        }
        
        const driverLockManager = require('../services/driver-lock-manager');
        const lockStatus = await driverLockManager.isDriverLocked(driverId);
        
        // Buscar TTL do lock se existir
        let ttl = null;
        if (lockStatus.isLocked) {
            const redis = require('../utils/redis-pool').getConnection();
            const lockKey = `driver_lock:${driverId}`;
            ttl = await redis.ttl(lockKey);
        }
        
        return res.json({
            driverId,
            isLocked: lockStatus.isLocked,
            bookingId: lockStatus.bookingId,
            expiresIn: ttl !== null ? ttl : null
        });
    } catch (error) {
        logError(error, '❌ Erro ao verificar lock:', { service: 'driver-status-check-routes' });
        res.status(500).json({ error: 'Erro ao verificar lock' });
    }
});

module.exports = router;
