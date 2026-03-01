// driver-status-check.js
// Endpoint para verificar status completo do driver

const express = require('express');
const router = express.Router();
const redisPool = require('../utils/redis-pool');
const connectionMonitor = require('../services/connection-monitor');

// ✅ IMPORTANTE: Rotas específicas DEVEM vir ANTES das rotas dinâmicas
// Caso contrário, /locks/all será capturado por /:driverId

/**
 * Listar todos os locks ativos
 * GET /api/driver-status/locks/all
 */
router.get('/locks/all', async (req, res) => {
    try {
        const driverLockManager = require('../services/driver-lock-manager');
const { logStructured, logError } = require('../utils/logger');
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
        const redis = redisPool.getConnection();
        
        if (!io) {
            return res.status(500).json({ error: 'WebSocket server não disponível' });
        }
        
        // Buscar todos os drivers conectados
        const sockets = await io.fetchSockets();
        const driverSockets = sockets.filter(s => s.userType === 'driver' && s.userId);
        
        const results = [];
        
        for (const socket of driverSockets) {
            const driverId = socket.userId;
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
            message: `${clearedCount} lock(s) liberado(s) de ${driverSockets.length} driver(s) conectado(s)`,
            totalDrivers: driverSockets.length,
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

        // 1. Verificar se está conectado (via connection monitor)
        const stats = await connectionMonitor.getConsolidatedStats();
        const driverConnections = stats.byType.driver || 0;
        
        // 2. Verificar se está no Redis (online)
        const redis = redisPool.getConnection();
        const isOnlineInRedis = await redis.zscore('driver_locations', driverId) !== null;
        
        // 3. Verificar se está em algum room do Socket.IO
        let isInDriverRoom = false;
        let socketId = null;
        let isAuthenticated = false;
        
        // Buscar socket do driver
        const sockets = await io.fetchSockets();
        for (const socket of sockets) {
            if (socket.userId === driverId && socket.userType === 'driver') {
                socketId = socket.id;
                isAuthenticated = true;
                // Verificar se está no room de drivers
                const rooms = Array.from(socket.rooms || []);
                isInDriverRoom = rooms.includes('drivers_room') || rooms.includes(`driver_${driverId}`);
                break;
            }
        }
        
        // 4. Verificar status no Redis
        const driverStatus = await redis.hget(`driver:${driverId}:status`, 'status') || 'offline';
        const isOnlineStatus = driverStatus === 'online';
        
        // 5. Verificar se pode receber solicitações
        const canReceiveRequests = (
            isAuthenticated &&
            isInDriverRoom &&
            isOnlineStatus &&
            socketId !== null
        );
        
        // 6. Verificar última localização
        const locationData = await redis.zscore('driver_locations', driverId);
        let lastLocation = null;
        if (locationData) {
            const locationStr = await redis.hget(`driver:${driverId}:location`, 'data');
            if (locationStr) {
                try {
                    lastLocation = JSON.parse(locationStr);
                } catch (e) {
                    lastLocation = { error: 'Invalid location data' };
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
            status: driverStatus,
            lastLocation,
            timestamp: new Date().toISOString(),
            details: {
                totalDriverConnections: driverConnections,
                isOnlineInRedis,
                rooms: socketId ? Array.from(io.sockets.sockets.get(socketId)?.rooms || []) : []
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
        
        // Buscar socket do driver
        const sockets = await io.fetchSockets();
        let driverSocket = null;
        
        for (const socket of sockets) {
            if (socket.userId === driverId && socket.userType === 'driver') {
                driverSocket = socket;
                break;
            }
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



