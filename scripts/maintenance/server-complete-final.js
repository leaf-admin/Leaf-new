const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
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
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Configuração da porta
const PORT = process.env.PORT || 3001;
const INSTANCE_ID = process.env.INSTANCE_ID || 'main';
const CLUSTER_MODE = process.env.CLUSTER_MODE === 'true';
const JWT_SECRET = process.env.JWT_SECRET || 'leaf-secret-key-vps';

// Middleware básico
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(helmet());

// Firebase integration
const firebaseConfig = require('./firebase-config');

// SERVIÇOS INTEGRADOS
const FCMService = require('./services/fcm-service');
const ChatService = require('./services/chat-service');
const PromoService = require('./services/promo-service');
const DriverApprovalService = require('./services/driver-approval-service');
const PaymentService = require('./services/payment-service');
const SyncService = require('./services/sync-service');
const MetricsService = require('./services/metrics-service');
const RideService = require('./services/ride-service');

// MIDDLEWARE E UTILS
const wafMiddleware = require('./middleware/waf');
const { applyRateLimit } = require('./middleware/rateLimiter');
const HealthChecker = require('./utils/healthChecker');
const RedisTunnel = require('./utils/redisTunnel');

// MONITORAMENTO (OPCIONAL)
let LatencyMonitor, DockerMonitor, SmartSyncAlertSystem;
let latencyMonitor = null;
let dockerMonitor = null;
let smartSyncAlertSystem = null;

try {
    LatencyMonitor = require('./metrics/latency-monitor');
    latencyMonitor = new LatencyMonitor();
} catch (error) {
    console.warn('⚠️ LatencyMonitor não disponível:', error.message);
}

try {
    DockerMonitor = require('./monitoring/docker-monitor');
    dockerMonitor = new DockerMonitor();
} catch (error) {
    console.warn('⚠️ DockerMonitor não disponível:', error.message);
}

try {
    SmartSyncAlertSystem = require('./monitoring/smart-sync-alert-system');
    smartSyncAlertSystem = new SmartSyncAlertSystem();
} catch (error) {
    console.warn('⚠️ SmartSyncAlertSystem não disponível:', error.message);
}

// Instanciar sistemas essenciais
const healthChecker = new HealthChecker();
const redisTunnel = new RedisTunnel();

// Inicializar Firebase
firebaseConfig.initializeFirebase();

// Inicializar serviços
const fcmService = new FCMService();
const chatService = new ChatService();
const promoService = new PromoService();
const driverApprovalService = new DriverApprovalService();
const paymentService = new PaymentService();
const syncService = new SyncService();
const metricsService = new MetricsService();
const rideService = new RideService();

// Inicializar serviços com Socket.io
rideService.initialize(io);
chatService.initialize(io);
promoService.initialize(io);
driverApprovalService.initialize(io);
paymentService.initialize(io);
syncService.initialize(io);
metricsService.initialize(io);

// Inicializar FCM Service
fcmService.initialize().then(() => {
    console.log('✅ FCM Service inicializado');
}).catch(error => {
    console.error('❌ Erro ao inicializar FCM Service:', error);
});

// Middleware de autenticação JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Token de acesso necessário' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido' });
        }
        req.user = user;
        next();
    });
};

// ===== ROTAS API =====

// Health check
app.get('/health', async (req, res) => {
    try {
        const redis = await redisPool.getConnection();
        await redis.ping();
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            instance: INSTANCE_ID,
            message: 'Leaf WebSocket Backend - Versão Completa',
            redis: 'connected',
            websocket: 'active',
            services: {
                fcm: 'active',
                chat: 'active',
                promo: 'active',
                driverApproval: 'active',
                payment: 'active',
                sync: 'active',
                metrics: 'active',
                ride: 'active'
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Login/Autenticação
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password, uid } = req.body;
        
        if (!email && !uid) {
            return res.status(400).json({ error: 'Email ou UID são obrigatórios' });
        }
        
        // Simular autenticação (substituir por lógica real)
        const user = {
            id: uid || 'user_' + Date.now(),
            email: email || 'user@leaf.app',
            name: 'Usuário Leaf',
            type: 'passenger'
        };
        
        const token = jwt.sign(user, JWT_SECRET, { expiresIn: '24h' });
        
        res.json({
            success: true,
            token,
            user
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Atualizar localização do usuário
app.post('/api/update_user_location', authenticateToken, async (req, res) => {
    try {
        const { latitude, longitude, heading, speed } = req.body;
        const userId = req.user.id;
        
        if (!latitude || !longitude) {
            return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
        }
        
        const redis = await redisPool.getConnection();
        const locationData = {
            userId,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            heading: parseFloat(heading) || 0,
            speed: parseFloat(speed) || 0,
            timestamp: new Date().toISOString(),
            updatedAt: Date.now()
        };
        
        await redis.hset('user_locations', userId, JSON.stringify(locationData));
        await redis.expire('user_locations', 3600); // Expira em 1 hora
        
        // Emitir via WebSocket para clients conectados
        io.emit('locationUpdated', locationData);
        
        res.json({ success: true, message: 'Localização atualizada com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Atualizar localização do motorista
app.post('/api/update_driver_location', authenticateToken, async (req, res) => {
    try {
        const { latitude, longitude, heading, speed, status } = req.body;
        const driverId = req.user.id;
        
        if (!latitude || !longitude) {
            return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
        }
        
        const redis = await redisPool.getConnection();
        const locationData = {
            driverId,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            heading: parseFloat(heading) || 0,
            speed: parseFloat(speed) || 0,
            status: status || 'available',
            timestamp: new Date().toISOString(),
            updatedAt: Date.now()
        };
        
        await redis.hset('driver_locations', driverId, JSON.stringify(locationData));
        await redis.expire('driver_locations', 3600);
        
        // Emitir atualização de status do motorista
        io.emit('driverStatusUpdated', locationData);
        
        res.json({ success: true, message: 'Localização do motorista atualizada' });
    } catch (error) {
        console.error('Erro ao atualizar localização do motorista:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Buscar motoristas próximos
app.get('/api/nearby_drivers', async (req, res) => {
    try {
        const { latitude, longitude, radius = 5000 } = req.query;
        
        if (!latitude || !longitude) {
            return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
        }
        
        const redis = await redisPool.getConnection();
        const driversData = await redis.hgetall('driver_locations');
        
        const nearbyDrivers = [];
        const userLat = parseFloat(latitude);
        const userLng = parseFloat(longitude);
        const maxRadius = parseFloat(radius);
        
        for (const [driverId, driverDataStr] of Object.entries(driversData)) {
            try {
                const driverData = JSON.parse(driverDataStr);
                
                // Calcular distância usando fórmula de Haversine (aproximada)
                const driverLat = parseFloat(driverData.latitude);
                const driverLng = parseFloat(driverData.longitude);
                
                const distance = getDistance(userLat, userLng, driverLat, driverLng);
                
                if (distance <= maxRadius && driverData.status === 'available') {
                    nearbyDrivers.push({
                        id: driverId,
                        name: `Motorista ${driverId.slice(-4)}`,
                        rating: 4.5 + Math.random() * 0.5, // Rating simulado
                        vehicle: {
                            model: 'Honda Civic',
                            color: 'Branco',
                            plate: 'ABC-' + Math.floor(Math.random() * 9999)
                        },
                        location: {
                            latitude: driverLat,
                            longitude: driverLng
                        },
                        distance: Math.round(distance),
                        estimatedArrival: Math.ceil(distance / 500) + ' min'
                    });
                }
            } catch (error) {
                console.error('Erro ao processar dados do motorista:', error);
            }
        }
        
        res.json({ 
            success: true, 
            drivers: nearbyDrivers.slice(0, 10), // Máximo 10 motoristas
            total: nearbyDrivers.length
        });
    } catch (error) {
        console.error('Erro ao buscar motoristas próximos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Estatísticas
app.get('/api/stats', async (req, res) => {
    try {
        const redis = await redisPool.getConnection();
        
        const stats = {
            totalUsers: await redis.hlen('user_locations'),
            activeDrivers: await redis.hlen('driver_locations'),
            activeRides: await redis.hlen('rides'),
            pendingPayments: await redis.hlen('payments'),
            timestamp: new Date().toISOString(),
            instance: INSTANCE_ID
        };
        
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ===== WEBSOCKET HANDLERS =====

// Map para armazenar sockets autenticados
const authenticatedSockets = new Map();

io.on('connection', (socket) => {
    console.log('✅ Cliente conectado:', socket.id);
    
    // Autenticação
    socket.on('authenticate', async (data) => {
        try {
            const { uid, platform } = data;
            
            if (!uid) {
                socket.emit('auth_error', { success: false, error: 'UID é obrigatório' });
                return;
            }
            
            // Armazenar socket autenticado
            authenticatedSockets.set(uid, socket.id);
            socket.userId = uid;
            socket.platform = platform || 'unknown';
            
            // Salvar no Redis
            const redis = await redisPool.getConnection();
            await redis.hset('user_sockets', uid, JSON.stringify({
                socketId: socket.id,
                platform,
                connectedAt: new Date().toISOString()
            }));
            
            socket.emit('authenticated', {
                success: true,
                userId: uid,
                socketId: socket.id,
                message: 'Autenticado com sucesso'
            });
            
            console.log(`🔐 Usuário autenticado: ${uid} (${socket.id})`);
        } catch (error) {
            console.error('❌ Erro na autenticação:', error);
            socket.emit('auth_error', { success: false, error: 'Erro interno' });
        }
    });
    
    // Atualizar localização via WebSocket
    socket.on('updateUserLocation', async (data) => {
        try {
            if (!socket.userId) {
                socket.emit('location_error', { success: false, error: 'Não autenticado' });
                return;
            }
            
            const { latitude, longitude, heading, speed } = data;
            
            if (!latitude || !longitude) {
                socket.emit('location_error', { success: false, error: 'Coordenadas inválidas' });
                return;
            }
            
            const redis = await redisPool.getConnection();
            const locationData = {
                userId: socket.userId,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                heading: parseFloat(heading) || 0,
                speed: parseFloat(speed) || 0,
                timestamp: new Date().toISOString(),
                updatedAt: Date.now()
            };
            
            await redis.hset('user_locations', socket.userId, JSON.stringify(locationData));
            
            socket.emit('locationUpdated', {
                success: true,
                location: locationData
            });
            
            // Broadcast para outros clients se necessário
            socket.broadcast.emit('userLocationUpdate', locationData);
        } catch (error) {
            console.error('❌ Erro ao atualizar localização via WebSocket:', error);
            socket.emit('location_error', { success: false, error: 'Erro interno' });
        }
    });
    
    // Buscar motoristas próximos via WebSocket
    socket.on('getNearbyDrivers', async (data) => {
        try {
            const { latitude, longitude, radius = 5000 } = data;
            
            if (!latitude || !longitude) {
                socket.emit('nearby_drivers_error', { success: false, error: 'Coordenadas inválidas' });
                return;
            }
            
            const redis = await redisPool.getConnection();
            const driversData = await redis.hgetall('driver_locations');
            
            const nearbyDrivers = [];
            const userLat = parseFloat(latitude);
            const userLng = parseFloat(longitude);
            
            for (const [driverId, driverDataStr] of Object.entries(driversData)) {
                try {
                    const driverData = JSON.parse(driverDataStr);
                    const distance = getDistance(userLat, userLng, driverData.latitude, driverData.longitude);
                    
                    if (distance <= radius && driverData.status === 'available') {
                        nearbyDrivers.push({
                            id: driverId,
                            location: {
                                latitude: driverData.latitude,
                                longitude: driverData.longitude
                            },
                            distance: Math.round(distance),
                            heading: driverData.heading || 0
                        });
                    }
                } catch (err) {
                    console.error('Erro ao processar motorista:', err);
                }
            }
            
            socket.emit('nearbyDrivers', {
                success: true,
                drivers: nearbyDrivers,
                count: nearbyDrivers.length
            });
        } catch (error) {
            console.error('❌ Erro ao buscar motoristas próximos:', error);
            socket.emit('nearby_drivers_error', { success: false, error: 'Erro interno' });
        }
    });
    
    // Solicitar corrida
    socket.on('request_ride', async (data) => {
        console.log('🚗 Solicitação de corrida recebida:', data);
        
        try {
            const { passengerId, pickupLocation, destinationLocation, rideType, estimatedFare, paymentMethod } = data;
            
            if (!passengerId || !pickupLocation || !destinationLocation) {
                socket.emit('ride_error', { success: false, error: 'Dados obrigatórios não fornecidos' });
                return;
            }
            
            const rideId = 'ride_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            const rideData = {
                rideId,
                passengerId,
                pickupLocation,
                destinationLocation,
                rideType: rideType || 'standard',
                estimatedFare: estimatedFare || 0,
                paymentMethod: paymentMethod || 'pix',
                status: 'requested',
                createdAt: new Date().toISOString(),
                timestamp: Date.now()
            };
            
            const redis = await redisPool.getConnection();
            await redis.hset('rides', rideId, JSON.stringify(rideData));
            await redis.expire('rides', 3600);
            
            socket.emit('ride_requested', {
                success: true,
                rideId,
                message: 'Solicitação de corrida enviada com sucesso',
                estimatedWaitTime: '2-5 minutos'
            });
            
            // Simular busca de motorista
            setTimeout(async () => {
                try {
                    const driverId = 'driver_' + Math.random().toString(36).substr(2, 9);
                    const driverData = {
                        driverId,
                        name: 'João Silva',
                        rating: 4.8,
                        vehicle: { 
                            model: 'Honda Civic', 
                            color: 'Branco', 
                            plate: 'ABC-1234' 
                        },
                        location: {
                            latitude: pickupLocation.latitude + (Math.random() - 0.5) * 0.01,
                            longitude: pickupLocation.longitude + (Math.random() - 0.5) * 0.01
                        },
                        estimatedArrival: '3-5 minutos',
                        fare: estimatedFare
                    };
                    
                    await redis.hset('drivers', driverId, JSON.stringify(driverData));
                    
                    socket.emit('driver_found', {
                        success: true,
                        rideId,
                        driver: driverData,
                        message: 'Motorista encontrado!'
                    });
                    
                    console.log('✅ Motorista encontrado para corrida:', rideId);
                } catch (error) {
                    console.error('❌ Erro ao buscar motorista:', error);
                }
            }, 3000);
            
            console.log('✅ Solicitação de corrida processada:', rideId);
        } catch (error) {
            console.error('❌ Erro ao processar solicitação de corrida:', error);
            socket.emit('ride_error', { success: false, error: 'Erro interno do servidor' });
        }
    });
    
    // Processar pagamento
    socket.on('processPayment', async (data) => {
        console.log('💳 Processando pagamento:', data);
        
        try {
            const { rideId, amount, paymentMethod, userId } = data;
            
            if (!rideId || !amount) {
                socket.emit('payment_error', { success: false, error: 'Dados obrigatórios não fornecidos' });
                return;
            }
            
            const paymentId = 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            const paymentData = {
                paymentId,
                rideId,
                userId: userId || socket.userId,
                amount: parseFloat(amount),
                paymentMethod: paymentMethod || 'pix',
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            
            const redis = await redisPool.getConnection();
            await redis.hset('payments', paymentId, JSON.stringify(paymentData));
            
            socket.emit('payment_processed', {
                success: true,
                paymentId,
                status: 'pending',
                message: 'Pagamento processado com sucesso'
            });
            
            console.log('✅ Pagamento processado:', paymentId);
        } catch (error) {
            console.error('❌ Erro ao processar pagamento:', error);
            socket.emit('payment_error', { success: false, error: 'Erro interno do servidor' });
        }
    });
    
    // Confirmar pagamento
    socket.on('confirmPayment', async (data) => {
        console.log('✅ Confirmando pagamento:', data);
        
        try {
            const { paymentId, status } = data;
            
            if (!paymentId) {
                socket.emit('payment_error', { success: false, error: 'ID do pagamento é obrigatório' });
                return;
            }
            
            const redis = await redisPool.getConnection();
            const paymentData = await redis.hget('payments', paymentId);
            
            if (!paymentData) {
                socket.emit('payment_error', { success: false, error: 'Pagamento não encontrado' });
                return;
            }
            
            const payment = JSON.parse(paymentData);
            payment.status = status || 'confirmed';
            payment.confirmedAt = new Date().toISOString();
            
            await redis.hset('payments', paymentId, JSON.stringify(payment));
            
            socket.emit('payment_confirmed', {
                success: true,
                paymentId,
                status: payment.status,
                message: 'Pagamento confirmado com sucesso'
            });
            
            console.log('✅ Pagamento confirmado:', paymentId);
        } catch (error) {
            console.error('❌ Erro ao confirmar pagamento:', error);
            socket.emit('payment_error', { success: false, error: 'Erro interno do servidor' });
        }
    });
    
    // Sistema de chat
    socket.on('create_chat', async (data) => {
        try {
            const { rideId, participants } = data;
            
            if (!rideId || !participants || participants.length < 2) {
                socket.emit('chat_error', { success: false, error: 'Dados inválidos para criar chat' });
                return;
            }
            
            const chatId = 'chat_' + rideId;
            const chatData = {
                chatId,
                rideId,
                participants,
                createdAt: new Date().toISOString(),
                lastActivity: new Date().toISOString()
            };
            
            const redis = await redisPool.getConnection();
            await redis.hset('chats', chatId, JSON.stringify(chatData));
            
            // Adicionar participantes aos rooms
            participants.forEach(participantId => {
                const participantSocket = authenticatedSockets.get(participantId);
                if (participantSocket) {
                    const pSocket = io.sockets.sockets.get(participantSocket);
                    if (pSocket) {
                        pSocket.join(chatId);
                    }
                }
            });
            
            socket.emit('chat_created', {
                success: true,
                chatId,
                message: 'Chat criado com sucesso'
            });
            
            console.log('✅ Chat criado:', chatId);
        } catch (error) {
            console.error('❌ Erro ao criar chat:', error);
            socket.emit('chat_error', { success: false, error: 'Erro interno' });
        }
    });
    
    socket.on('send_message', async (data) => {
        try {
            const { chatId, message, senderId } = data;
            
            if (!chatId || !message || !senderId) {
                socket.emit('message_error', { success: false, error: 'Dados inválidos' });
                return;
            }
            
            const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const messageData = {
                messageId,
                chatId,
                senderId,
                message,
                timestamp: new Date().toISOString(),
                read: false
            };
            
            const redis = await redisPool.getConnection();
            await redis.lpush(`chat_messages:${chatId}`, JSON.stringify(messageData));
            await redis.expire(`chat_messages:${chatId}`, 86400 * 7); // 7 dias
            
            // Enviar para todos no chat
            io.to(chatId).emit('new_message', {
                success: true,
                message: messageData
            });
            
            console.log('✅ Mensagem enviada:', messageId);
        } catch (error) {
            console.error('❌ Erro ao enviar mensagem:', error);
            socket.emit('message_error', { success: false, error: 'Erro interno' });
        }
    });
    
    // Desconexão
    socket.on('disconnect', () => {
        console.log('❌ Cliente desconectado:', socket.id);
        
        if (socket.userId) {
            authenticatedSockets.delete(socket.userId);
            
            // Remover do Redis
            redisPool.getConnection().then(redis => {
                redis.hdel('user_sockets', socket.userId);
            }).catch(error => {
                console.error('Erro ao limpar socket do Redis:', error);
            });
        }
    });
});

// ===== FUNÇÕES AUXILIARES =====

// Calcular distância entre duas coordenadas (fórmula de Haversine)
function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Raio da Terra em metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// ===== INICIALIZAÇÃO DO SERVIDOR =====

server.listen(PORT, () => {
    console.log(`🚀 Servidor Leaf WebSocket rodando na porta ${PORT}`);
    console.log(`🔌 WebSocket: ws://216.238.107.59:${PORT}`);
    console.log(`📊 APIs: http://216.238.107.59:${PORT}/api`);
    console.log(`❤️ Health: http://216.238.107.59:${PORT}/health`);
    console.log(`🏷️ Instance: ${INSTANCE_ID}`);
    
    // Inicializar monitoramento (se disponível)
    if (latencyMonitor) {
        try {
            if (typeof latencyMonitor.start === 'function') {
                latencyMonitor.start();
                console.log('✅ LatencyMonitor iniciado');
            }
        } catch (error) {
            console.warn('⚠️ Erro ao iniciar LatencyMonitor:', error.message);
        }
    }
    
    if (dockerMonitor) {
        try {
            if (typeof dockerMonitor.start === 'function') {
                dockerMonitor.start();
                console.log('✅ DockerMonitor iniciado');
            }
        } catch (error) {
            console.warn('⚠️ Erro ao iniciar DockerMonitor:', error.message);
        }
    }
    
    if (smartSyncAlertSystem) {
        try {
            if (typeof smartSyncAlertSystem.start === 'function') {
                smartSyncAlertSystem.start();
                console.log('✅ SmartSyncAlertSystem iniciado');
            }
        } catch (error) {
            console.warn('⚠️ Erro ao iniciar SmartSyncAlertSystem:', error.message);
        }
    }
    
    if (healthChecker) {
        try {
            if (typeof healthChecker.start === 'function') {
                healthChecker.start();
                console.log('✅ HealthChecker iniciado');
            }
        } catch (error) {
            console.warn('⚠️ Erro ao iniciar HealthChecker:', error.message);
        }
    }
    
    if (redisTunnel) {
        try {
            if (typeof redisTunnel.start === 'function') {
                redisTunnel.start();
                console.log('✅ RedisTunnel iniciado');
            }
        } catch (error) {
            console.warn('⚠️ Erro ao iniciar RedisTunnel:', error.message);
        }
    }
});

// Tratamento de erros
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada:', reason);
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
    });
});








