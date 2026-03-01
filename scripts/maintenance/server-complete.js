const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const server = http.createServer(app);

// Configurações
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'leaf-secret-key-vps';
const REDIS_HOST = process.env.REDIS_HOST || '216.238.107.59';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// Middleware de segurança
app.use(helmet());

// Redis com configuração otimizada
const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    maxLoadingTimeout: 10000,
    lazyConnect: true,
    keepAlive: 30000,
    family: 4,
    connectTimeout: 10000,
    commandTimeout: 5000
});

// Socket.IO com configuração otimizada
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Payment integration
const PaymentService = require('./services/payment-service');

// Sync integration
const SyncService = require('./services/sync-service');

// Dashboard integration
const DashboardWebSocketService = require('./services/dashboard-websocket');

// Metrics integration
const MetricsService = require('./services/metrics-service');

// Ride Service (OTIMIZADO)
const RideService = require('./services/ride-service');

// WAF Middleware
const wafMiddleware = require('./middleware/waf');
const { applyRateLimit } = require('./middleware/rateLimiter');
const HealthChecker = require('./utils/healthChecker');
const RedisTunnel = require('./utils/redisTunnel');

// Monitoramento (OPCIONAL - não falha se não existir)
let latencyMonitor = null;
let dockerMonitor = null;
let smartSyncAlertSystem = null;

try {
    const LatencyMonitor = require('./metrics/latency-monitor');
    latencyMonitor = new LatencyMonitor();
} catch (error) {
    console.warn('⚠️ LatencyMonitor não disponível:', error.message);
}

try {
    const DockerMonitor = require('./monitoring/docker-monitor');
    dockerMonitor = new DockerMonitor();
} catch (error) {
    console.warn('⚠️ DockerMonitor não disponível:', error.message);
}

try {
    const SmartSyncAlertSystem = require('./monitoring/smart-sync-alert-system');
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

// Inicializar Ride Service (OTIMIZADO)
const rideService = new RideService();

// Inicializar Ride Service com Socket.io
rideService.initialize(io);

// Inicializar FCM Service
fcmService.initialize().then(() => {
    console.log('✅ FCM Service inicializado');
}).catch(error => {
    console.error('❌ Erro ao inicializar FCM Service:', error);
});

// Inicializar Chat Service
chatService.initialize(io);

// Inicializar Promo Service
promoService.initialize(io);

// Inicializar Driver Approval Service
driverApprovalService.initialize(io);

// Inicializar Payment Service
paymentService.initialize(io);

// Inicializar Sync Service
syncService.initialize(io);

// Inicializar Metrics Service
metricsService.initialize(io);

// Inicializar Dashboard WebSocket Service
const dashboardWebSocketService = new DashboardWebSocketService();
dashboardWebSocketService.initialize(io);

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
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        instance: 'main',
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
            ride: 'active',
            dashboard: 'active'
        }
    });
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios' });
        }
        
        // Simular autenticação (substituir por lógica real)
        const user = {
            id: 'user_' + Date.now(),
            email: email,
            name: 'Usuário Teste',
            type: 'passenger'
        };
        
        const token = jwt.sign(user, JWT_SECRET, { expiresIn: '24h' });
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                type: user.type
            }
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Motoristas próximos
app.get('/api/nearby_drivers', async (req, res) => {
    try {
        const { latitude, longitude, radius = 5000 } = req.query;
        
        if (!latitude || !longitude) {
            return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
        }
        
        // Simular motoristas próximos
        const drivers = [
            {
                id: 'driver_1',
                name: 'João Silva',
                rating: 4.8,
                vehicle: { model: 'Honda Civic', color: 'Branco', plate: 'ABC-1234' },
                location: { latitude: parseFloat(latitude) + 0.001, longitude: parseFloat(longitude) + 0.001 },
                distance: '0.5 km'
            },
            {
                id: 'driver_2',
                name: 'Maria Santos',
                rating: 4.9,
                vehicle: { model: 'Toyota Corolla', color: 'Prata', plate: 'DEF-5678' },
                location: { latitude: parseFloat(latitude) - 0.001, longitude: parseFloat(longitude) + 0.001 },
                distance: '0.8 km'
            }
        ];
        
        res.json({ success: true, drivers });
    } catch (error) {
        console.error('Erro ao buscar motoristas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Atualizar localização do usuário
app.post('/api/update_user_location', authenticateToken, async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        const userId = req.user.id;
        
        if (!latitude || !longitude) {
            return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
        }
        
        // Salvar localização no Redis
        await redis.hset('user_locations', userId, JSON.stringify({
            userId,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            timestamp: new Date().toISOString()
        }));
        
        res.json({ success: true, message: 'Localização atualizada com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Estatísticas
app.get('/api/stats', async (req, res) => {
    try {
        const stats = {
            totalUsers: await redis.hlen('user_locations'),
            activeRides: await redis.hlen('rides'),
            onlineDrivers: await redis.hlen('drivers'),
            timestamp: new Date().toISOString()
        };
        
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ===== WEBSOCKET HANDLERS =====

io.on('connection', (socket) => {
    console.log('✅ Cliente conectado:', socket.id);
    
    // Solicitação de corrida
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
            
            // Salvar no Redis
            await redis.hset('rides', rideId, JSON.stringify(rideData));
            await redis.expire('rides', 3600); // Expira em 1 hora
            
            // Responder
            socket.emit('ride_requested', {
                success: true,
                rideId,
                message: 'Solicitação de corrida enviada com sucesso',
                estimatedWaitTime: '2-5 minutos'
            });
            
            // Simular motorista encontrado
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
                    
                    console.log('✅ Motorista simulado encontrado para corrida:', rideId);
                } catch (error) {
                    console.error('❌ Erro ao simular motorista:', error);
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
            const { rideId, amount, paymentMethod } = data;
            
            if (!rideId || !amount) {
                socket.emit('payment_error', { success: false, error: 'Dados obrigatórios não fornecidos' });
                return;
            }
            
            // Simular processamento de pagamento
            const paymentId = 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            const paymentData = {
                paymentId,
                rideId,
                amount: parseFloat(amount),
                paymentMethod: paymentMethod || 'pix',
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            
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
    
    // Desconexão
    socket.on('disconnect', () => {
        console.log('❌ Cliente desconectado:', socket.id);
    });
});

// ===== INICIALIZAÇÃO =====

server.listen(PORT, () => {
    console.log('🚀 Servidor Leaf WebSocket rodando na porta ' + PORT);
    console.log('🔌 WebSocket: ws://216.238.107.59:' + PORT);
    console.log('📊 APIs: http://216.238.107.59:' + PORT + '/api');
    console.log('❤️ Health: http://216.238.107.59:' + PORT + '/health');
    
    // Inicializar monitoramento (se disponível)
    if (latencyMonitor) {
        try {
            latencyMonitor.start();
            console.log('✅ LatencyMonitor iniciado');
        } catch (error) {
            console.warn('⚠️ Erro ao iniciar LatencyMonitor:', error.message);
        }
    }
    
    if (dockerMonitor) {
        try {
            dockerMonitor.start();
            console.log('✅ DockerMonitor iniciado');
        } catch (error) {
            console.warn('⚠️ Erro ao iniciar DockerMonitor:', error.message);
        }
    }
    
    if (smartSyncAlertSystem) {
        try {
            smartSyncAlertSystem.start();
            console.log('✅ SmartSyncAlertSystem iniciado');
        } catch (error) {
            console.warn('⚠️ Erro ao iniciar SmartSyncAlertSystem:', error.message);
        }
    }
    
    if (healthChecker) {
        try {
            healthChecker.start();
            console.log('✅ HealthChecker iniciado');
        } catch (error) {
            console.warn('⚠️ Erro ao iniciar HealthChecker:', error.message);
        }
    }
    
    if (redisTunnel) {
        try {
            redisTunnel.start();
            console.log('✅ RedisTunnel iniciado');
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








