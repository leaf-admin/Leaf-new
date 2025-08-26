const { logger } = require('../utils/logger');
const jwt = require('jsonwebtoken');
const redisPool = require('../utils/redis-pool');
const firebaseBatch = require('../utils/firebase-batch');
const { rideQueue } = require('../utils/async-queue');

class RideService {
    constructor() {
        this.database = null;
        this.activeRides = new Map();
        this.driverLocations = new Map();
        this.rideRequests = new Map();
        
        // Usar Redis Pool otimizado
        this.redis = redisPool.getConnection();
        
        // Tentar inicializar Firebase (sem falhar se não estiver disponível)
        this.initializeFirebase();
        
        logger.info('🚀 Ride Service inicializado com Redis Pool otimizado');
    }

    initializeFirebase() {
        try {
            const { getDatabase } = require('firebase-admin/database');
            this.database = getDatabase();
            logger.info('🔥 Firebase Database inicializado com sucesso');
        } catch (error) {
            logger.warn(`⚠️ Firebase não disponível ainda: ${error.message}`);
            this.database = null;
        }
    }

    initialize(io) {
        this.io = io;
        this.setupWebSocketEvents();
        
        // Configurar filas assíncronas
        this.setupAsyncQueues();
        
        logger.info('🚀 Ride Service inicializado com otimizações de performance');
    }

    setupAsyncQueues() {
        // Configurar eventos das filas
        rideQueue.on('taskCompleted', (item) => {
            logger.info(`✅ Tarefa de corrida concluída: ${item.id} em ${item.processingTime}ms`);
        });

        rideQueue.on('taskFailed', (item) => {
            logger.error(`❌ Tarefa de corrida falhou: ${item.id} - ${item.error}`);
        });
    }

    setupWebSocketEvents() {
        this.io.on('connection', (socket) => {
            logger.info(`🔌 Nova conexão WebSocket: ${socket.id}`);

            // Autenticação do motorista (ULTRA OTIMIZADA + JWT)
            socket.on('authenticate', async (data) => {
                try {
                    const { uid, token } = data;
                    if (!uid) {
                        socket.emit('error', { message: 'UID é obrigatório' });
                        return;
                    }

                    // 1. VERIFICAR JWT TOKEN PRIMEIRO (MUITO MAIS RÁPIDO)
                    if (token) {
                        try {
                            const decoded = await this.verifyJWT(token);
                            if (decoded && decoded.uid === uid) {
                                // 2. AUTENTICAÇÃO VIA JWT (INSTANTÂNEA)
                                socket.driverId = uid;
                                socket.join(`driver_${uid}`);
                                socket.emit('authenticated', { 
                                    message: 'Motorista autenticado via JWT (INSTANTÂNEO)', 
                                    driverId: uid, 
                                    method: 'jwt' 
                                });
                                
                                // Sincronizar dados em background
                                setImmediate(async () => {
                                    await this.syncDriverData(uid, decoded);
                                });
                                return;
                            }
                        } catch (jwtError) {
                            logger.warn(`⚠️ JWT inválido: ${jwtError.message}`);
                        }
                    }

                    // 3. FALLBACK: VERIFICAR CACHE REDIS (MUITO RÁPIDO)
                    try {
                        const cachedDriver = await this.redis.get(`driver:${uid}`);
                        if (cachedDriver) {
                            const driverData = JSON.parse(cachedDriver);
                            socket.driverId = uid;
                            socket.join(`driver_${uid}`);
                            socket.emit('authenticated', { 
                                message: 'Motorista autenticado via cache Redis (RÁPIDO)', 
                                driverId: uid, 
                                method: 'redis_cache' 
                            });
                            
                            // Atualizar cache em background
                            setImmediate(async () => {
                                await this.updateDriverCache(uid);
                            });
                            return;
                        }
                    } catch (redisError) {
                        logger.warn(`⚠️ Erro no cache Redis: ${redisError.message}`);
                    }

                    // 4. FALLBACK FINAL: VERIFICAR FIREBASE (MAIS LENTO)
                    if (this.database) {
                        try {
                            const driverRef = this.database.ref(`drivers/${uid}`);
                            const snapshot = await driverRef.once('value');
                            
                            if (snapshot.exists()) {
                                const driverData = snapshot.val();
                                socket.driverId = uid;
                                socket.join(`driver_${uid}`);
                                
                                // Atualizar cache Redis para próximas consultas
                                await this.redis.setex(`driver:${uid}`, 300, JSON.stringify(driverData));
                                
                                socket.emit('authenticated', { 
                                    message: 'Motorista autenticado via Firebase (LENTO)', 
                                    driverId: uid, 
                                    method: 'firebase' 
                                });
                            } else {
                                socket.emit('error', { message: 'Motorista não encontrado' });
                            }
                        } catch (firebaseError) {
                            logger.error(`❌ Erro na autenticação Firebase: ${firebaseError.message}`);
                            socket.emit('error', { message: 'Erro na autenticação' });
                        }
                    } else {
                        socket.emit('error', { message: 'Firebase não disponível' });
                    }
                } catch (error) {
                    logger.error(`❌ Erro na autenticação: ${error.message}`);
                    socket.emit('error', { message: 'Erro interno na autenticação' });
                }
            });

            // Atualização de localização (OTIMIZADA)
            socket.on('updateLocation', async (data) => {
                try {
                    const { lat, lng } = data;
                    if (!socket.driverId) {
                        socket.emit('error', { message: 'Motorista não autenticado' });
                        return;
                    }

                    // 1. ATUALIZAR CACHE REDIS IMEDIATAMENTE (INSTANTÂNEO)
                    const locationData = {
                        lat: parseFloat(lat),
                        lng: parseFloat(lng),
                        timestamp: Date.now(),
                        isOnline: true
                    };
                    
                    await this.redis.setex(`driver_location:${socket.driverId}`, 300, JSON.stringify(locationData));
                    this.driverLocations.set(socket.driverId, { lat, lng, timestamp: Date.now() });
                    
                    socket.emit('locationUpdated', { 
                        message: 'Localização atualizada', 
                        location: { lat, lng } 
                    });

                    // 2. SINCRONIZAR FIREBASE EM BACKGROUND (ASSÍNCRONO)
                    if (this.database) {
                        setImmediate(async () => {
                            try {
                                const driverRef = this.database.ref(`drivers/${socket.driverId}/location`);
                                await driverRef.set(locationData);
                            } catch (error) {
                                logger.error(`❌ Erro ao sincronizar localização: ${error.message}`);
                            }
                        });
                    }
                } catch (error) {
                    logger.error(`❌ Erro ao atualizar localização: ${error.message}`);
                    socket.emit('error', { message: 'Erro ao atualizar localização' });
                }
            });

            // Atualização de status (OTIMIZADA)
            socket.on('updateDriverStatus', async (data) => {
                try {
                    const { status } = data;
                    if (!socket.driverId) {
                        socket.emit('error', { message: 'Motorista não autenticado' });
                        return;
                    }

                    // 1. ATUALIZAR CACHE REDIS IMEDIATAMENTE
                    const statusData = {
                        status,
                        timestamp: Date.now(),
                        isOnline: status === 'online'
                    };
                    
                    await this.redis.setex(`driver_status:${socket.driverId}`, 300, JSON.stringify(statusData));
                    
                    socket.emit('driverStatusUpdated', { 
                        message: 'Status atualizado', 
                        status 
                    });

                    // 2. SINCRONIZAR FIREBASE EM BACKGROUND
                    if (this.database) {
                        setImmediate(async () => {
                            try {
                                const driverRef = this.database.ref(`drivers/${socket.driverId}/status`);
                                await driverRef.set(statusData);
                            } catch (error) {
                                logger.error(`❌ Erro ao sincronizar status: ${error.message}`);
                            }
                        });
                    }
                } catch (error) {
                    logger.error(`❌ Erro ao atualizar status: ${error.message}`);
                    socket.emit('error', { message: 'Erro ao atualizar status' });
                }
            });

            // Solicitação de corrida (OTIMIZADA)
            socket.on('createRideRequest', async (data) => {
                try {
                    const { pickup, destination, passengerId, estimatedPrice } = data;
                    
                    // 1. CRIAR SOLICITAÇÃO NO CACHE REDIS (INSTANTÂNEO)
                    const rideRequest = {
                        id: `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        pickup,
                        destination,
                        passengerId,
                        estimatedPrice,
                        status: 'NEW',
                        createdAt: Date.now()
                    };
                    
                    await this.redis.setex(`ride_request:${rideRequest.id}`, 300, JSON.stringify(rideRequest));
                    this.rideRequests.set(rideRequest.id, rideRequest);
                    
                    socket.emit('rideRequestCreated', { 
                        message: 'Solicitação de corrida criada', 
                        rideId: rideRequest.id 
                    });

                    // 2. NOTIFICAR MOTORISTAS PRÓXIMOS (ASSÍNCRONO)
                    setImmediate(async () => {
                        await this.notifyNearbyDrivers(rideRequest);
                    });

                    // 3. SINCRONIZAR FIREBASE EM BACKGROUND
                    if (this.database) {
                        setImmediate(async () => {
                            try {
                                const rideRef = this.database.ref(`bookings/${rideRequest.id}`);
                                await rideRef.set(rideRequest);
                            } catch (error) {
                                logger.error(`❌ Erro ao sincronizar corrida: ${error.message}`);
                            }
                        });
                    }
                } catch (error) {
                    logger.error(`❌ Erro ao criar solicitação: ${error.message}`);
                    socket.emit('error', { message: 'Erro ao criar solicitação' });
                }
            });

            // Aceitar corrida (OTIMIZADA)
            socket.on('acceptRide', async (data) => {
                try {
                    const { rideId } = data;
                    if (!socket.driverId) {
                        socket.emit('error', { message: 'Motorista não autenticado' });
                        return;
                    }

                    // 1. ATUALIZAR CACHE REDIS IMEDIATAMENTE
                    const rideRequest = this.rideRequests.get(rideId);
                    if (rideRequest) {
                        rideRequest.status = 'ACCEPTED';
                        rideRequest.driverId = socket.driverId;
                        rideRequest.acceptedAt = Date.now();
                        
                        await this.redis.setex(`ride_request:${rideId}`, 300, JSON.stringify(rideRequest));
                        
                        socket.emit('rideAccepted', { 
                            message: 'Corrida aceita com sucesso', 
                            rideId 
                        });
                    }

                    // 2. SINCRONIZAR FIREBASE EM BACKGROUND
                    if (this.database) {
                        setImmediate(async () => {
                            try {
                                const rideRef = this.database.ref(`bookings/${rideId}`);
                                await rideRef.update({
                                    status: 'ACCEPTED',
                                    driverId: socket.driverId,
                                    acceptedAt: Date.now()
                                });
                            } catch (error) {
                                logger.error(`❌ Erro ao sincronizar aceitação: ${error.message}`);
                            }
                        });
                    }
                } catch (error) {
                    logger.error(`❌ Erro ao aceitar corrida: ${error.message}`);
                    socket.emit('error', { message: 'Erro ao aceitar corrida' });
                }
            });

            // Iniciar viagem (OTIMIZADA)
            socket.on('startTrip', async (data) => {
                try {
                    const { rideId } = data;
                    if (!socket.driverId) {
                        socket.emit('error', { message: 'Motorista não autenticado' });
                        return;
                    }

                    // 1. ATUALIZAR CACHE REDIS IMEDIATAMENTE
                    const rideRequest = this.rideRequests.get(rideId);
                    if (rideRequest) {
                        rideRequest.status = 'IN_PROGRESS';
                        rideRequest.startedAt = Date.now();
                        
                        await this.redis.setex(`ride_request:${rideId}`, 300, JSON.stringify(rideRequest));
                        
                        socket.emit('tripStarted', { 
                            message: 'Viagem iniciada', 
                            rideId 
                        });
                    }

                    // 2. SINCRONIZAR FIREBASE EM BACKGROUND
                    if (this.database) {
                        setImmediate(async () => {
                            try {
                                const rideRef = this.database.ref(`bookings/${rideId}`);
                                await rideRef.ref.update({
                                    status: 'IN_PROGRESS',
                                    startedAt: Date.now()
                                });
                            } catch (error) {
                                logger.error(`❌ Erro ao sincronizar início: ${error.message}`);
                            }
                        });
                    }
                } catch (error) {
                    logger.error(`❌ Erro ao iniciar viagem: ${error.message}`);
                    socket.emit('error', { message: 'Erro ao iniciar viagem' });
                }
            });

            // Finalizar viagem (OTIMIZADA)
            socket.on('finishTrip', async (data) => {
                try {
                    const { rideId, finalPrice } = data;
                    if (!socket.driverId) {
                        socket.emit('error', { message: 'Motorista não autenticado' });
                        return;
                    }

                    // 1. ATUALIZAR CACHE REDIS IMEDIATAMENTE
                    const rideRequest = this.rideRequests.get(rideId);
                    if (rideRequest) {
                        rideRequest.status = 'COMPLETED';
                        rideRequest.finalPrice = finalPrice;
                        rideRequest.completedAt = Date.now();
                        
                        await this.redis.setex(`ride_request:${rideId}`, 300, JSON.stringify(rideRequest));
                        
                        socket.emit('tripFinished', { 
                            message: 'Viagem finalizada', 
                            rideId,
                            finalPrice 
                        });
                    }

                    // 2. SINCRONIZAR FIREBASE EM BACKGROUND
                    if (this.database) {
                        setImmediate(async () => {
                            try {
                                const rideRef = this.database.ref(`bookings/${rideId}`);
                                await rideRef.update({
                                    status: 'COMPLETED',
                                    finalPrice,
                                    completedAt: Date.now()
                                });
                            } catch (error) {
                                logger.error(`❌ Erro ao sincronizar finalização: ${error.message}`);
                            }
                        });
                    }
                } catch (error) {
                    logger.error(`❌ Erro ao finalizar viagem: ${error.message}`);
                    socket.emit('error', { message: 'Erro ao finalizar viagem' });
                }
            });

            // Desconexão
            socket.on('disconnect', () => {
                logger.info(`🔌 Motorista desconectado: ${socket.driverId}`);
                if (socket.driverId) {
                    this.driverLocations.delete(socket.driverId);
                }
            });
        });
    }

    // Método para verificar JWT
    async verifyJWT(token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            return decoded;
        } catch (error) {
            logger.error(`❌ Erro na verificação JWT: ${error.message}`);
            return null;
        }
    }

    // Método para notificar motoristas próximos
    async notifyNearbyDrivers(bookingData) {
        try {
            const { pickup, id } = bookingData;
            const nearbyDrivers = [];

            // Buscar motoristas próximos no cache Redis
            this.driverLocations.forEach((location, driverId) => {
                if (location.isOnline && location.status === 'available') {
                    const distance = this.calculateDistance(
                        pickup.lat, 
                        pickup.lng, 
                        location.lat, 
                        location.lng
                    );
                    
                    if (distance <= 5) { // 5km de raio
                        nearbyDrivers.push({
                            driverId,
                            distance,
                            rating: location.rating || 4.5,
                            responseTime: location.avgResponseTime || 30
                        });
                    }
                }
            });

            // Ordenar por score (distância + rating + tempo de resposta)
            nearbyDrivers.sort((a, b) => {
                const scoreA = (1 / a.distance) * a.rating * (1 / a.responseTime);
                const scoreB = (1 / b.distance) * b.rating * (1 / b.responseTime);
                return scoreB - scoreA;
            });

            // Notificar apenas os top 3 motoristas
            const topDrivers = nearbyDrivers.slice(0, 3);
            
            topDrivers.forEach(driver => {
                this.io.to(`driver_${driver.driverId}`).emit('newRideRequest', {
                    rideId: id,
                    pickup,
                    estimatedPrice: bookingData.estimatedPrice,
                    distance: driver.distance
                });
            });

            // Cache da notificação
            await this.redis.setex(`ride_request:${id}`, 300, JSON.stringify({
                ...bookingData,
                nearbyDrivers: topDrivers.length,
                timestamp: Date.now()
            }));

            logger.info(`📢 ${topDrivers.length} motoristas notificados para corrida ${id}`);
            
        } catch (error) {
            logger.error(`❌ Erro ao notificar motoristas: ${error.message}`);
        }
    }

    // Método para calcular distância
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Raio da Terra em km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Método para sincronizar dados do motorista
    async syncDriverData(uid, decoded) {
        try {
            if (!this.database) {
                logger.warn(`⚠️ Firebase não disponível para sincronizar dados do motorista ${uid}`);
                return;
            }

            const driverRef = this.database.ref(`drivers/${uid}`);
            const snapshot = await driverRef.once('value');
            
            if (snapshot.exists()) {
                const driverData = snapshot.val();
                
                // Atualizar cache Redis
                await this.redis.setex(`driver:${uid}`, 300, JSON.stringify(driverData));
                
                // Atualizar localização se disponível
                if (driverData.location) {
                    this.driverLocations.set(uid, {
                        ...driverData.location,
                        isOnline: true,
                        status: 'available'
                    });
                }
            }
            
            logger.info(`🔄 Dados do motorista ${uid} sincronizados em background`);
        } catch (error) {
            logger.error(`❌ Erro na sincronização: ${error.message}`);
        }
    }

    // Método para atualizar cache do motorista
    async updateDriverCache(uid) {
        try {
            if (!this.database) {
                logger.warn(`⚠️ Firebase não disponível para atualizar cache do motorista ${uid}`);
                return;
            }

            const driverRef = this.database.ref(`drivers/${uid}`);
            const snapshot = await driverRef.once('value');
            
            if (snapshot.exists()) {
                const driverData = snapshot.val();
                await this.redis.setex(`driver:${uid}`, 300, JSON.stringify(driverData));
            }
        } catch (error) {
            logger.error(`❌ Erro ao atualizar cache: ${error.message}`);
        }
    }

    // Método para obter estatísticas
    getStats() {
        return {
            activeRides: this.activeRides.size,
            driverLocations: this.driverLocations.size,
            rideRequests: this.rideRequests.size,
            totalConnections: this.io ? this.io.engine.clientsCount : 0,
            redisPool: redisPool.getPoolStats(),
            firebaseBatch: firebaseBatch.getPerformanceStats(),
            rideQueue: rideQueue.getStats(),
            firebaseAvailable: this.database !== null
        };
    }
}

module.exports = RideService;
