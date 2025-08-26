const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// MÓDULOS OTIMIZADOS
const redisPool = require('./utils/redis-pool');
const firebaseBatch = require('./utils/firebase-batch');
const { rideQueue } = require('./utils/async-queue');

// Criar aplicação Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Configuração da porta
const PORT = process.env.PORT || 3001;
const INSTANCE_ID = process.env.INSTANCE_ID || 'main';
const CLUSTER_MODE = process.env.CLUSTER_MODE === 'true';

// Middleware básico
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());

// Firebase integration
const firebaseConfig = require('./firebase-config');

// FCM integration
const FCMService = require('./services/fcm-service');

// Chat integration
const ChatService = require('./services/chat-service');

// Promo integration
const PromoService = require('./services/promo-service');

// Driver approval integration
const DriverApprovalService = require('./services/driver-approval-service');

// Sync integration
const SyncService = require('./services/sync-service');

// Metrics integration
const MetricsService = require('./services/metrics-service');

// Ride Service (OTIMIZADO)
const RideService = require('./services/ride-service');

// WAF Middleware
const wafMiddleware = require('./middleware/waf');
const { applyRateLimit } = require('./middleware/rateLimiter');
const HealthChecker = require('./utils/healthChecker');
const RedisTunnel = require('./utils/redisTunnel');

// Instanciar sistemas de monitoramento
const latencyMonitor = new LatencyMonitor();
const dockerMonitor = new DockerMonitor();
const smartSyncAlertSystem = new SmartSyncAlertSystem();
const healthChecker = new HealthChecker();
const redisTunnel = new RedisTunnel();

// Inicializar Firebase
firebaseConfig.initializeFirebase();

// Inicializar serviços
const fcmService = new FCMService();
const chatService = new ChatService();
const promoService = new PromoService();
const driverApprovalService = new DriverApprovalService();
const syncService = new SyncService();
const metricsService = new MetricsService();

// Inicializar Ride Service (OTIMIZADO)
const rideService = new RideService();

// Inicializar Ride Service com Socket.io
rideService.initialize(io);

// Função para buscar socket ativo do usuário
async function getSocketByUserId(userId) {
    try {
        // Buscar socket ativo do usuário
        const userSocket = await redis.get(`user_socket:${userId}`);
        if (userSocket) {
            const socketId = JSON.parse(userSocket);
            const socket = io.sockets.sockets.get(socketId);
            return socket;
        }
        return null;
    } catch (error) {
        console.error('Erro ao buscar socket do usuário:', error);
        return null;
    }
}

// Configurações
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Rota de health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        instanceId: INSTANCE_ID,
        clusterMode: CLUSTER_MODE,
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// Rota raiz
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        message: 'Leaf WebSocket Backend está rodando!',
        instanceId: INSTANCE_ID,
        clusterMode: CLUSTER_MODE,
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// Rota de métricas
app.get('/metrics', async (req, res) => {
    try {
        const metrics = await metricsService.getGeneralMetrics();
        res.json(metrics);
    } catch (error) {
        res.status(500).json({ 
            error: 'Erro ao obter métricas',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Rota de status do sistema
app.get('/status', async (req, res) => {
    try {
        const dockerReport = await dockerMonitor.getSystemReport();
        const syncReport = await smartSyncAlertSystem.getStatusReport();
        const realtimeMetrics = await latencyMonitor.getRealtimeMetrics();
        const dockerMetrics = await dockerMonitor.getMetrics();

        res.json({
            timestamp: new Date().toISOString(),
            container: dockerReport.container,
            redis: dockerReport.redis,
            system: dockerReport.system,
            host: dockerReport.host,
            alerts: [...dockerReport.alerts, ...syncReport.alerts],
            latency: realtimeMetrics,
            resources: dockerMetrics,
            container: dockerMetrics.container,
            redis: dockerMetrics.redis,
            system: dockerMetrics.system
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota para buscar motoristas próximos
app.get('/drivers/nearby', async (req, res) => {
    try {
        const { lat, lng, radius = 5000, limit = 10 } = req.query;
        
        if (!lat || !lng) {
            return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
        }

        const results = await redis.georadius(
            GEO_KEY,
            parseFloat(lng),
            parseFloat(lat),
            parseFloat(radius),
            'm',
            'WITHCOORD',
            'WITHDIST',
            'COUNT',
            limit
        );

        const drivers = results.map(result => ({
            userId: result[0],
            distance: Math.round(result[1]),
            coordinates: {
                lng: result[2][0],
                lat: result[2][1]
            }
        }));

        res.json({ drivers, count: drivers.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rota para obter status do motorista
app.get('/drivers/:uid/status', async (req, res) => {
    try {
        const { uid } = req.params;
        
        const driverInfo = await redis.hget(STATUS_KEY, uid);
        if (!driverInfo) {
            return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        const status = JSON.parse(driverInfo);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rotas para túnel Redis
app.get('/tunnel/status', (req, res) => {
    try {
        const status = redisTunnel.getStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/tunnel/start', async (req, res) => {
    try {
        await redisTunnel.startNgrokTunnel();
        
        // Aguardar um pouco para o túnel ser criado
        setTimeout(() => {
            const status = redisTunnel.getStatus();
            res.json({
                success: true,
                status,
                message: 'Túnel Redis iniciado com sucesso'
            });
        }, 2000);
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.post('/tunnel/stop', (req, res) => {
    try {
        redisTunnel.stopTunnel();
        
        res.json({
            success: true,
            message: 'Túnel Redis parado com sucesso'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.post('/tunnel/test', async (req, res) => {
    try {
        const result = await redisTunnel.testTunnel();
        res.json(result);
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Configurações do Socket.io
io.engine.upgradeTimeout = 10000; // 10 segundos
io.engine.allowUpgrades = true;
io.engine.connectTimeout = 45000; // 45 segundos para conexão

// Cliente Redis (OTIMIZADO - usando Redis Pool)
const redis = redisPool.getConnection(); // Usar Redis Pool otimizado

// Função para calcular distância entre dois pontos (fallback)
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371e3; // Raio da Terra em metros
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distância em metros
}

// Função para buscar motoristas próximos para uma reserva
async function findNearbyDriversForBooking(pickup, radius = 5000, limit = 10) {
    try {
        const { lat, lng } = pickup;
        
        // Verificar se há motoristas no Redis
        const totalDrivers = await redis.zcard(GEO_KEY);
        if (totalDrivers === 0) {
            console.log('⚠️ Nenhum motorista disponível no Redis');
            return [];
        }
        
        // Buscar motoristas próximos
        const results = await redis.georadius(
            GEO_KEY,
            lng,
            lat,
            radius,
            'm',
            'WITHCOORD',
            'WITHDIST',
            'COUNT',
            limit
        );

        return results.map(result => ({
            userId: result[0],
            distance: Math.round(result[1]),
            coordinates: {
                lng: result[2][0],
                lat: result[2][1]
            }
        }));
    } catch (error) {
        console.error('❌ Erro ao buscar motoristas próximos:', error);
        return [];
    }
}

// Gerenciar conexões Socket.io
io.on('connection', (socket) => {
    let userId = null;
    
    console.log('🔌 Cliente conectado:', socket.id);

    // Autenticação do usuário
    socket.on('auth', async (data) => {
        try {
            const { uid, token } = data;
            
            // Validar token JWT
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.uid !== uid) {
                socket.emit('auth_error', { message: 'Token inválido' });
                return;
            }

            userId = uid;
            socket.userId = uid;
            
            // Salvar socket do usuário no Redis
            await redis.setex(`user_socket:${uid}`, 3600, JSON.stringify(socket.id));
            
            // Entrar na sala do usuário
            socket.join(`user:${uid}`);
            
            socket.emit('auth_success', { 
                message: 'Autenticado com sucesso',
                uid: uid
            });
            
            console.log(`✅ Usuário ${uid} autenticado`);
            
        } catch (error) {
            console.error('❌ Erro na autenticação:', error);
            socket.emit('auth_error', { message: 'Erro na autenticação' });
        }
    });

    // Atualizar localização do usuário
    socket.on('updateLocation', async (data) => {
        try {
            const { lat, lng } = data;
            
            // 1. Salvar no Redis (primário - tempo real)
            await redis.geoadd(GEO_KEY, lng, lat, userId);
            
            await redis.hset(STATUS_KEY, userId, JSON.stringify({
                status: 'available',
                lastUpdate: Date.now(),
                lat,
                lng,
                isOnline: true
            }));
            
            // 2. Sincronizar com Firebase (assíncrono - background)
            try {
                await firebaseBatch.batchUpdate(`user_locations/${userId}`, {
                    lat,
                    lng,
                    lastUpdate: new Date().toISOString(),
                    isOnline: true
                });
            } catch (firebaseError) {
                console.warn('⚠️ Erro ao sincronizar com Firebase:', firebaseError.message);
                // Não falhar se Firebase estiver indisponível
            }
            
            socket.emit('locationUpdated', { success: true, lat, lng });
            
        } catch (err) {
            socket.emit('locationError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Buscar motoristas próximos
    socket.on('findNearbyDrivers', async (data) => {
        try {
            const { lat, lng, radius = 5000, limit = 10 } = data;
            
            // Verificar se há dados no Redis
            const totalDrivers = await redis.zcard(GEO_KEY);
            console.log(`📊 Total de motoristas no Redis: ${totalDrivers}`);
            
            if (totalDrivers === 0) {
                socket.emit('nearbyDrivers', { 
                    drivers: [], 
                    count: 0,
                    message: 'Nenhum motorista disponível'
                });
                return;
            }
            
            const results = await redis.georadius(
                GEO_KEY,
                lng,
                lat,
                radius,
                'm',
                'WITHCOORD',
                'WITHDIST',
                'COUNT',
                limit
            );
            
            const drivers = results.map(result => ({
                userId: result[0],
                distance: Math.round(result[1]),
                coordinates: {
                    lng: result[2][0],
                    lat: result[2][1]
                }
            }));
            
            socket.emit('nearbyDrivers', { 
                drivers, 
                count: drivers.length 
            });
            
        } catch (err) {
            console.error('❌ Erro ao buscar motoristas próximos:', err);
            socket.emit('nearbyDriversError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Atualizar status do motorista
    socket.on('updateDriverStatus', async (data) => {
        const { status, isOnline } = data;
        try {
            // Salvar apenas no Redis (sem sincronizar com Firebase)
            const prev = await redis.hget(STATUS_KEY, userId);
            let info = prev ? JSON.parse(prev) : {};
            info.status = status;
            info.isOnline = isOnline;
            info.lastUpdate = Date.now();
            await redis.hset(STATUS_KEY, userId, JSON.stringify(info));

            socket.emit('driverStatusUpdated', { success: true, status, isOnline });
        } catch (err) {
            socket.emit('driverStatusError', { success: false, error: err.message });
        }
    });

    // Estatísticas
    socket.on('getStats', async () => {
        try {
            const all = await redis.hgetall(STATUS_KEY);
            const total = Object.keys(all).length;
            let online = 0;
            let offline = 0;
            
            Object.values(all).forEach(value => {
                const info = JSON.parse(value);
                if (info.isOnline) online++;
                else offline++;
            });
            
            socket.emit('stats', {
                total_users: total,
                online_users: online,
                offline_users: offline,
                source: 'redis',
            });
        } catch (err) {
            socket.emit('stats', { error: err.message });
        }
    });

    // Criar reserva
    socket.on('createBooking', async (data) => {
        try {
            const { pickup, destination, userId, driverId } = data;
            
            console.log('📋 Dados da reserva:', data);
            
            // Salvar no Redis para acesso rápido
            await redis.hset('bookings:active', bookingId, JSON.stringify(bookingData));
            
            // Salvar no Firebase para persistência
            try {
                await firebaseBatch.batchCreate(`bookings`, [{
                    id: bookingId,
                    pickup,
                    destination,
                    userId,
                    driverId,
                    status: 'pending',
                    createdAt: new Date().toISOString()
                }]);
            } catch (firebaseError) {
                console.warn('⚠️ Erro ao salvar no Firebase:', firebaseError.message);
                // Não falhar se Firebase estiver indisponível
            }
            
            socket.emit('bookingCreated', { success: true, bookingId });
            
        } catch (err) {
            socket.emit('bookingError', { success: false, error: err.message });
        }
    });

    // Resposta do motorista
    socket.on('driverResponse', async (data) => {
        try {
            const { bookingId, response, driverId } = data;
            
            // Buscar dados da reserva
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('driverResponseError', { 
                    success: false, 
                    error: 'Reserva não encontrada' 
                });
                return;
            }
            
            const booking = JSON.parse(bookingData);
            const updatedBooking = {
                ...booking,
                driverResponse: response,
                driverId: driverId,
                responseTime: new Date().toISOString()
            };
            
            // Atualizar no Redis
            await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
            
            // Atualizar no Firebase
            try {
                await firebaseBatch.batchUpdate(`bookings/${bookingId}`, {
                    driverResponse: response,
                    driverId: driverId,
                    responseTime: new Date().toISOString()
                });
            } catch (firebaseError) {
                console.warn('⚠️ Erro ao atualizar no Firebase:', firebaseError.message);
            }
            
            socket.emit('driverResponseSuccess', { success: true, response });
            
        } catch (err) {
            socket.emit('driverResponseError', { success: false, error: err.message });
        }
    });

    // Iniciar viagem
    socket.on('startTrip', async (data) => {
        try {
            const { bookingId } = data;
            
            // Buscar dados da reserva
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('startTripError', { 
                    success: false, 
                    error: 'Reserva não encontrada' 
                });
                return;
            }
            
            const booking = JSON.parse(bookingData);
            const updatedBooking = {
                ...booking,
                status: 'in_progress',
                startTime: new Date().toISOString()
            };
            
            // Atualizar no Redis
            await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
            
            // Atualizar no Firebase
            try {
                await firebaseBatch.batchUpdate(`bookings/${bookingId}`, {
                    status: 'in_progress',
                    startTime: new Date().toISOString()
                });
            } catch (firebaseError) {
                console.warn('⚠️ Erro ao atualizar no Firebase:', firebaseError.message);
            }
            
            socket.emit('tripStarted', { success: true, bookingId });
            
        } catch (err) {
            socket.emit('startTripError', { success: false, error: err.message });
        }
    });

    // Atualizar localização do motorista durante a viagem
    socket.on('updateDriverLocation', async (data) => {
        try {
            const { bookingId, lat, lng } = data;
            
            // Verificar se a viagem está ativa
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('updateDriverLocationError', { 
                    success: false, 
                    error: 'Viagem não encontrada' 
                });
                return;
            }
            
            const driverLocation = {
                lat,
                lng,
                timestamp: new Date().toISOString(),
                bookingId
            };
            
            // Salvar no Redis
            await redis.hset('driver_locations', `${bookingId}_${driverId}`, JSON.stringify(driverLocation));
            
            // Salvar no Firebase
            try {
                await firebaseBatch.batchUpdate(`driver_locations/${bookingId}_${driverId}`, driverLocation);
            } catch (firebaseError) {
                console.warn('⚠️ Erro ao salvar no Firebase:', firebaseError.message);
            }
            
            socket.emit('driverLocationUpdated', { success: true, lat, lng });
            
        } catch (err) {
            socket.emit('updateDriverLocationError', { success: false, error: err.message });
        }
    });

    // Completar viagem
    socket.on('completeTrip', async (data) => {
        try {
            const { bookingId, finalLat, finalLng } = data;
            
            // Buscar dados da reserva
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('completeTripError', { 
                    success: false, 
                    error: 'Viagem não encontrada' 
                });
                return;
            }
            
            const booking = JSON.parse(bookingData);
            const updatedBooking = {
                ...booking,
                status: 'completed',
                endTime: new Date().toISOString(),
                finalLocation: { lat: finalLat, lng: finalLng }
            };
            
            // Atualizar no Redis
            await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
            
            // Atualizar no Firebase
            true
            // Atualizar no Firebase
            try {
                await firebaseBatch.batchUpdate(`bookings/${bookingId}`, {
                    status: 'completed',
                    endTime: new Date().toISOString(),
                    finalLocation: { lat: finalLat, lng: finalLng }
                });
            } catch (firebaseError) {
                console.warn('⚠️ Erro ao atualizar no Firebase:', firebaseError.message);
            }
            
            socket.emit('tripCompleted', { success: true, bookingId });
            
        } catch (err) {
            socket.emit('completeTripError', { success: false, error: err.message });
        }
    });

    // Confirmar pagamento
    socket.on('confirmPayment', async (data) => {
        try {
            const { bookingId, paymentMethod, amount } = data;
            
            // Buscar dados da reserva
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('confirmPaymentError', { 
                    success: false, 
                    error: 'Viagem não encontrada' 
                });
                return;
            }
            
            const booking = JSON.parse(bookingData);
            const updatedBooking = {
                ...booking,
                paymentStatus: 'confirmed',
                paymentMethod,
                amount,
                paymentTime: new Date().toISOString()
                paymentTime: new Date().toISOString()
            };
            
            // Atualizar no Redis
            await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
            
            // Atualizar no Firebase
            try {
                await firebaseBatch.batchUpdate(`bookings/${bookingId}`, {
                    paymentStatus: 'confirmed',
                    paymentMethod,
                    amount,
                    paymentTime: new Date().toISOString()
                });
            } catch (firebaseError) {
                console.warn('⚠️ Erro ao atualizar no Firebase:', firebaseError.message);
            }
            
            socket.emit('paymentConfirmed', { success: true, bookingId });
            
        } catch (err) {
            socket.emit('confirmPaymentError', { success: false, error: err.message });
        }
    });

    // Avaliar viagem
    socket.on('submitRating', async (data) => {
        try {
            const { tripId, rating, comment, userId, userType } = data;
            
            // Verificar se a viagem existe
            const bookingData = await redis.hget('bookings:active', tripId);
            if (!bookingData) {
                socket.emit('ratingSubmittedError', { 
                    success: false, 
                    error: 'Viagem não encontrada' 
                });
                return;
            }
            
            const ratingData = {
                id: `rating_${Date.now()}`,
                tripId,
                rating,
                comment,
                userId,
                userType,
                timestamp: new Date().toISOString()
            };
            
            // Salvar avaliação no Redis
            await redis.hset('ratings', ratingData.id, JSON.stringify(ratingData));
            
            // Adicionar à lista de avaliações da viagem
            await redis.sadd(`trip_ratings:${tripId}`, ratingId);
            
            // Adicionar à lista de avaliações do usuário
            await redis.sadd(`user_ratings:${userId}`, ratingId);
            
            // Salvar no Firebase
            try {
                await firebaseBatch.batchCreate('ratings', [ratingData]);
            } catch (firebaseError) {
                console.warn('⚠️ Erro ao salvar no Firebase:', firebaseError.message);
            }
            
            socket.emit('ratingSubmitted', { success: true, ratingId: ratingData.id });
            
        } catch (err) {
            socket.emit('ratingSubmittedError', { success: false, error: err.message });
        }
    });

    // Buscar avaliações de um usuário
    socket.on('getUserRatings', async (data) => {
        try {
            const { targetUserId, targetUserType } = data;
            
            // Buscar todas as avaliações do usuário alvo
            const userRatingIds = await redis.smembers(`user_ratings:${targetUserId}`);
            const userRatings = [];
            
            for (const ratingId of userRatingIds) {
                const ratingData = await redis.hget('ratings', ratingId);
                if (ratingData) {
                    const rating = JSON.parse(ratingData);
                    if (rating.userType !== targetUserType) { // Apenas avaliações recebidas
                        userRatings.push(rating);
                    }
                }
            }
            
            // Calcular média
            if (userRatings.length > 0) {
                const totalRating = userRatings.reduce((sum, r) => sum + r.rating, 0);
                const averageRating = totalRating / userRatings.length;
                
                // Atualizar média no perfil do usuário
                const userProfileKey = `user_profiles:${targetUserId}`;
                const userProfile = await redis.hget(userProfileKey, 'profile');
                
                if (userProfile) {
                    const profile = JSON.parse(userProfile);
                    profile.averageRating = averageRating;
                    profile.totalRatings = userRatings.length;
                    profile.lastRatingUpdate = new Date().toISOString();
                    
                    await redis.hset(userProfileKey, 'profile', JSON.stringify(profile));
                    
                    // Sincronizar com Firebase
                    try {
                        await firebaseBatch.batchUpdate(`user_profiles/${targetUserId}`, {
                            averageRating,
                            totalRatings: userRatings.length,
                            lastRatingUpdate: new Date().toISOString()
                        });
                    } catch (firebaseError) {
                        console.warn('⚠️ Erro ao sincronizar com Firebase:', firebaseError.message);
                    }
                }
                
                socket.emit('userRatings', { 
                    ratings: userRatings, 
                    averageRating: averageRating,
                    totalRatings: userRatings.length
                });
            } else {
                socket.emit('userRatings', { 
                    ratings: [], 
                    averageRating: 0,
                    totalRatings: 0
                });
            }
            
        } catch (err) {
            socket.emit('userRatingsError', { success: false, error: err.message });
        }
    });

    // Buscar avaliações de uma viagem
    socket.on('getTripRatings', async (data) => {
        try {
            const { tripId } = data;
            
            // Buscar IDs das avaliações da viagem
            const ratingIds = await redis.smembers(`trip_ratings:${tripId}`);
            const ratings = [];
            
            for (const ratingId of ratingIds) {
                const ratingData = await redis.hget('ratings', ratingId);
                if (ratingData) {
                    ratings.push(JSON.parse(ratingData));
                }
            }
            
            socket.emit('tripRatings', { ratings, count: ratings.length });
            
        } catch (err) {
            socket.emit('tripRatingsError', { success: false, error: err.message });
        }
    });

    // Verificar se usuário já avaliou
    socket.on('checkUserRating', async (data) => {
        try {
            const { tripId, userId, userType } = data;
            
            // Buscar IDs das avaliações da viagem
            const ratingIds = await redis.smembers(`trip_ratings:${tripId}`);
            let hasRated = false;
            let userRating = null;
            
            for (const ratingId of ratingIds) {
                const ratingData = await redis.hget('ratings', ratingId);
                if (ratingData) {
                    const rating = JSON.parse(ratingData);
                    if (rating.userId === userId && rating.userType === userType) {
                        hasRated = true;
                        userRating = rating;
                        break;
                    }
                }
            }
            
            socket.emit('userRatingStatus', { 
                hasRated, 
                rating: userRating 
            });
            
        } catch (err) {
            socket.emit('userRatingStatusError', { success: false, error: err.message });
        }
    });

    // Desconexão
    socket.on('disconnect', async () => {
        try {
            if (userId) {
                // Marcar usuário como offline
                const userInfo = await redis.hget(STATUS_KEY, userId);
                if (userInfo) {
                    const info = JSON.parse(userInfo);
                    info.isOnline = false;
                    info.lastUpdate = Date.now();
                    await redis.hset(STATUS_KEY, userId, JSON.stringify(info));
                }
                
                // Remover socket do usuário
                await redis.del(`user_socket:${userId}`);
                
                console.log(`🔌 Usuário ${userId} desconectado`);
            }
        } catch (error) {
            console.error('❌ Erro ao processar desconexão:', error);
        }
    });
});

// Inicializar sistemas de monitoramento
latencyMonitor.start();
dockerMonitor.start();
smartSyncAlertSystem.start();
healthChecker.start();

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor Leaf WebSocket rodando na porta ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    console.log(`📊 Instance ID: ${INSTANCE_ID}`);
    console.log(`🌐 Cluster Mode: ${CLUSTER_MODE}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 Recebido SIGTERM, encerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor encerrado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🔄 Recebido SIGINT, encerrando servidor...');
    server.close(() => {
        console.log('✅ Servidor encerrado');
        process.exit(0);
        console.log('✅ Servidor encerrado');
        process.exit(0);
    });
});
