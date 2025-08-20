const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Firebase integration
const firebaseConfig = require('./firebase-config');

// FCM integration
const FCMService = require('./services/fcm-service');

// Chat integration
const ChatService = require('./services/chat-service');

// Importar sistemas de monitoramento
const LatencyMonitor = require('./metrics/latency-monitor');
const DockerMonitor = require('./monitoring/docker-monitor');
const SmartSyncAlertSystem = require('./monitoring/smart-sync-alert-system');

// Importar logging e segurança
const { logger, logWebSocket, logRedis, logSecurity, logPerformance } = require('./utils/logger');
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

// Inicializar FCM Service
let fcmService = null;
try {
    fcmService = new FCMService();
    fcmService.initialize();
    console.log('✅ FCM Service inicializado');
} catch (error) {
    console.error('❌ Erro ao inicializar FCM Service:', error);
}

// Inicializar Chat Service
let chatService = null;
try {
    chatService = new ChatService();
    chatService.initialize();
    console.log('✅ Chat Service inicializado');
} catch (error) {
    console.error('❌ Erro ao inicializar Chat Service:', error);
}

// Função para obter socket por userId
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
        console.error('Erro ao buscar socket por userId:', error);
        return null;
    }
}

// Configurações
const PORT = process.env.PORT || 3001;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Inicializar Express
const app = express();

// Middleware de segurança
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000', 
    'http://localhost:8081',
    'https://dashboard.leaf.app.br',
    'https://api.leaf.app.br'
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de logging
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logPerformance('HTTP Request', duration, {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 100)
    });
  });
  
  next();
});

// Middleware de WAF e Rate Limiting
app.use(wafMiddleware);
app.use(applyRateLimit);

// Rota de teste para verificar se o servidor está rodando
app.get('/', (req, res) => {
    logger.info('Health check realizado', {
        ip: req.ip,
        userAgent: req.headers['user-agent']
    });
    
    res.json({ 
        status: 'running', 
        message: 'Leaf WebSocket Backend está rodando!',
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// Rota de health check
app.get('/health', (req, res) => {
    logger.info('Health check detalhado realizado', {
        ip: req.ip,
        timestamp: new Date().toISOString()
    });
    
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString() 
    });
});

// Rota de health check detalhado
app.get('/health/detailed', async (req, res) => {
    try {
        const status = healthChecker.getStatus();
        const summary = healthChecker.getSummary();
        
        res.json({
            summary,
            details: status,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Erro ao obter health check detalhado', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
        res.status(500).json({
            error: 'Erro interno do servidor',
            timestamp: new Date().toISOString()
        });
    }
});

// Rota para executar health checks manualmente
app.post('/health/run', async (req, res) => {
    try {
        const result = await healthChecker.runAllChecks();
        const status = healthChecker.getStatus();
        const summary = healthChecker.getSummary();
        
        res.json({
            success: result,
            summary,
            details: status,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Erro ao executar health checks', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
        res.status(500).json({
            error: 'Erro interno do servidor',
            timestamp: new Date().toISOString()
        });
    }
});

// Rotas para túnel Redis
app.get('/tunnel/status', (req, res) => {
    try {
        const status = redisTunnel.getStatus();
        res.json(status);
    } catch (error) {
        logger.error('Erro ao obter status do túnel', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
        res.status(500).json({
            error: 'Erro interno do servidor',
            timestamp: new Date().toISOString()
        });
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
                message: 'Túnel Redis iniciado'
            });
        }, 3000);
        
    } catch (error) {
        logger.error('Erro ao iniciar túnel Redis', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
        res.status(500).json({
            error: 'Erro interno do servidor',
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/tunnel/stop', (req, res) => {
    try {
        redisTunnel.stopTunnel();
        
        res.json({
            success: true,
            message: 'Túnel Redis parado'
        });
        
    } catch (error) {
        logger.error('Erro ao parar túnel Redis', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
        res.status(500).json({
            error: 'Erro interno do servidor',
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/tunnel/test', async (req, res) => {
    try {
        const result = await redisTunnel.testTunnel();
        res.json(result);
        
    } catch (error) {
        logger.error('Erro ao testar túnel Redis', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
        res.status(500).json({
            error: 'Erro interno do servidor',
            timestamp: new Date().toISOString()
        });
    }
});

// Rota de métricas e monitoramento
app.get('/metrics', async (req, res) => {
    try {
        const latencyReport = await latencyMonitor.getLatencyReport();
        const dockerReport = dockerMonitor.getFullReport();
        const syncReport = smartSyncAlertSystem.getAlertsReport();
        
        res.json({
            timestamp: new Date().toISOString(),
            container: dockerReport.container,
            redis: dockerReport.redis,
            system: dockerReport.system,
            host: dockerReport.host,
            alerts: [...dockerReport.alerts, ...syncReport.alerts],
            summary: {
                status: dockerReport.summary.status,
                totalAlerts: dockerReport.summary.totalAlerts + syncReport.activeAlerts,
                criticalAlerts: dockerReport.summary.criticalAlerts,
                errorAlerts: dockerReport.summary.errorAlerts,
                warningAlerts: dockerReport.summary.warningAlerts,
                uptime: dockerReport.container.uptime,
                activeConnections: syncReport.activeConnections,
                monitoringActive: true
            }
        });
    } catch (error) {
        console.error('❌ Erro ao obter métricas:', error);
        res.status(500).json({ error: error.message });
    }
});

// Simulação de dados de usuários
let simulatedCustomers = 150;
let simulatedDrivers = 45;
let simulatedCustomersOnline = 54;
let simulatedDriversOnline = 11;

// Simulação de dados financeiros
let simulatedFinancialData = {
  totalRevenue: 15420.50,
  totalCosts: 8234.75,
  totalProfit: 7185.75,
  totalTrips: 342,
  averageTripValue: 45.09,
  todayRevenue: 1245.80,
  todayTrips: 28,
  todayProfit: 567.30,
  monthlyRevenue: 15420.50,
  monthlyTrips: 342,
  monthlyProfit: 7185.75
};

// Atualiza os dados simulados a cada 5 segundos
setInterval(() => {
  simulatedCustomers = Math.floor(Math.random() * 100) + 100; // 100-199
  simulatedDrivers = Math.floor(Math.random() * 30) + 30;     // 30-59
  simulatedCustomersOnline = Math.floor(Math.random() * 50) + 10; // 10-59
  simulatedDriversOnline = Math.floor(Math.random() * 20) + 5;   // 5-24
  
  // Atualizar dados financeiros simulados
  const revenueVariation = (Math.random() - 0.5) * 200; // ±100
  const tripsVariation = Math.floor((Math.random() - 0.5) * 10); // ±5
  
  simulatedFinancialData.totalRevenue += revenueVariation;
  simulatedFinancialData.totalTrips += tripsVariation;
  simulatedFinancialData.totalCosts = simulatedFinancialData.totalRevenue * 0.534; // 53.4% de custos
  simulatedFinancialData.totalProfit = simulatedFinancialData.totalRevenue - simulatedFinancialData.totalCosts;
  simulatedFinancialData.averageTripValue = simulatedFinancialData.totalRevenue / simulatedFinancialData.totalTrips;
  
  // Dados de hoje (simulação)
  simulatedFinancialData.todayRevenue = Math.floor(Math.random() * 500) + 1000; // 1000-1500
  simulatedFinancialData.todayTrips = Math.floor(Math.random() * 20) + 20; // 20-40
  simulatedFinancialData.todayProfit = simulatedFinancialData.todayRevenue * 0.466; // 46.6% de lucro
  
  // Dados mensais
  simulatedFinancialData.monthlyRevenue = simulatedFinancialData.totalRevenue;
  simulatedFinancialData.monthlyTrips = simulatedFinancialData.totalTrips;
  simulatedFinancialData.monthlyProfit = simulatedFinancialData.totalProfit;
}, 5000);

// Cache para estatísticas do Redis (evitar chamadas repetitivas)
let redisStatsCache = {
    totalUsers: 0,
    onlineUsers: 0,
    lastUpdate: 0
};

// Nova rota para obter estatísticas de customers e drivers
app.get('/stats/users', async (req, res) => {
    try {
        const now = Date.now();
        
        // Usar cache se a última atualização foi há menos de 10 segundos
        if (now - redisStatsCache.lastUpdate < 10000) {
            res.json({
                timestamp: new Date().toISOString(),
                stats: {
                    totalCustomers: simulatedCustomers,
                    customersOnline: simulatedCustomersOnline,
                    totalDrivers: simulatedDrivers,
                    driversOnline: simulatedDriversOnline,
                    totalUsers: redisStatsCache.totalUsers,
                    onlineUsers: redisStatsCache.onlineUsers,
                },
            });
            return;
        }

        // Chamar a função Firebase para obter estatísticas reais do Redis
        const firebaseFunctionUrl = 'http://127.0.0.1:5001/leaf-reactnative/us-central1/get_redis_stats';
        const firebaseResponse = await fetch(firebaseFunctionUrl);
        const firebaseData = await firebaseResponse.json();

        // Atualizar cache
        redisStatsCache = {
            totalUsers: firebaseData.totalUsers || 0,
            onlineUsers: firebaseData.onlineUsers || 0,
            lastUpdate: now
        };

        res.json({
            timestamp: new Date().toISOString(),
            stats: {
                totalCustomers: simulatedCustomers,
                customersOnline: simulatedCustomersOnline,
                totalDrivers: simulatedDrivers,
                driversOnline: simulatedDriversOnline,
                totalUsers: redisStatsCache.totalUsers,
                onlineUsers: redisStatsCache.onlineUsers,
            },
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas de usuários:', error);
        // Em caso de erro, usar dados do cache ou valores padrão
        res.json({
            timestamp: new Date().toISOString(),
            stats: {
                totalCustomers: simulatedCustomers,
                customersOnline: simulatedCustomersOnline,
                totalDrivers: simulatedDrivers,
                driversOnline: simulatedDriversOnline,
                totalUsers: redisStatsCache.totalUsers,
                onlineUsers: redisStatsCache.onlineUsers,
            },
        });
    }
});

// Nova rota para métricas financeiras
app.get('/stats/financial', async (req, res) => {
    try {
        res.json({
            timestamp: new Date().toISOString(),
            financial: {
                // Métricas Gerais
                totalRevenue: simulatedFinancialData.totalRevenue,
                totalCosts: simulatedFinancialData.totalCosts,
                totalProfit: simulatedFinancialData.totalProfit,
                totalTrips: simulatedFinancialData.totalTrips,
                averageTripValue: simulatedFinancialData.averageTripValue,
                
                // Métricas de Hoje
                todayRevenue: simulatedFinancialData.todayRevenue,
                todayTrips: simulatedFinancialData.todayTrips,
                todayProfit: simulatedFinancialData.todayProfit,
                todayAverageTrip: simulatedFinancialData.todayRevenue / simulatedFinancialData.todayTrips,
                
                // Métricas Mensais
                monthlyRevenue: simulatedFinancialData.monthlyRevenue,
                monthlyTrips: simulatedFinancialData.monthlyTrips,
                monthlyProfit: simulatedFinancialData.monthlyProfit,
                monthlyAverageTrip: simulatedFinancialData.monthlyRevenue / simulatedFinancialData.monthlyTrips,
                
                // Percentuais
                profitMargin: ((simulatedFinancialData.totalProfit / simulatedFinancialData.totalRevenue) * 100).toFixed(2),
                costPercentage: ((simulatedFinancialData.totalCosts / simulatedFinancialData.totalRevenue) * 100).toFixed(2),
                
                // Crescimento (simulado)
                revenueGrowth: '+12.5%',
                profitGrowth: '+8.3%',
                tripsGrowth: '+15.2%'
            },
        });
    } catch (error) {
        console.error('Erro ao buscar métricas financeiras:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas financeiras' });
    }
});

// Rota de métricas em tempo real
app.get('/metrics/realtime', (req, res) => {
    try {
        const realtimeMetrics = latencyMonitor.getRealTimeMetrics();
        const dockerMetrics = dockerMonitor.metrics;
        
        res.json({
            timestamp: new Date().toISOString(),
            latency: realtimeMetrics,
            resources: dockerMetrics,
            container: dockerMetrics.container,
            redis: dockerMetrics.redis,
            system: dockerMetrics.system
        });
    } catch (error) {
        console.error('❌ Erro ao obter métricas em tempo real:', error);
        res.status(500).json({ error: error.message });
    }
});

// API para buscar motoristas próximos (do Redis)
app.get('/api/drivers/nearby', async (req, res) => {
    try {
        const { lat, lng, radius = 5000, limit = 10 } = req.query;
        
        if (!lat || !lng) {
            return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
        }

        const results = await redis.georadius(
            GEO_KEY,
            parseFloat(lng),
            parseFloat(lat),
            parseInt(radius),
            'm',
            'WITHDIST',
            'WITHCOORD',
            'COUNT',
            parseInt(limit)
        );

        const drivers = results.map(([uid, distance, [lng, lat]]) => ({
            uid,
            distance: parseFloat(distance),
            lat: parseFloat(lat),
            lng: parseFloat(lng),
        }));

        res.json({ drivers, count: drivers.length });
        
    } catch (error) {
        console.error('❌ Erro ao buscar motoristas próximos:', error);
        res.status(500).json({ error: error.message });
    }
});

// API para obter localização de um motorista específico
app.get('/api/drivers/:uid/location', async (req, res) => {
    try {
        const { uid } = req.params;
        
        const driverInfo = await redis.hget(STATUS_KEY, uid);
        if (!driverInfo) {
            return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        const driverData = JSON.parse(driverInfo);
        res.json({
            uid,
            lat: driverData.lat,
            lng: driverData.lng,
            status: driverData.status,
            lastUpdate: driverData.lastUpdate
        });
        
    } catch (error) {
        console.error('❌ Erro ao obter localização:', error);
        res.status(500).json({ error: error.message });
    }
});

const wooviWebhook = require('./routes/wooviWebhook');
app.use('/api', wooviWebhook);

// Importar rotas de autenticação
const { router: authRoutes } = require('./routes/auth')

// Importar rotas do dashboard
const dashboardRoutes = require('./routes/dashboard')

// Importar rotas de usuário
const userRoutes = require('./routes/user')

// Adicionar rotas de autenticação
app.use('/auth', authRoutes)

// Adicionar rotas do dashboard
app.use('/dashboard', dashboardRoutes)

// Adicionar rotas de usuário
app.use('/user', userRoutes)

// Criar servidor HTTP
const server = http.createServer(app);

// Configurar Socket.io com otimizações para alta concorrência
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    // Otimizações para alta concorrência
    maxHttpBufferSize: 1e6, // 1MB
    pingTimeout: 60000, // 60 segundos
    pingInterval: 25000, // 25 segundos
    upgradeTimeout: 10000, // 10 segundos
    allowUpgrades: true,
    // Configurações de concorrência
    connectTimeout: 45000, // 45 segundos para conexão
    // Pool de conexões
    transports: ['websocket', 'polling'],
    // Rate limiting
    allowRequest: (req, callback) => {
        // Permitir todas as conexões (pode ser ajustado para rate limiting)
        callback(null, true);
    }
});

// Cliente Redis (ioredis) com otimizações para alta concorrência
const redis = new Redis({
    host: 'localhost', // Docker Desktop expõe para localhost
    port: 6379,
    // Otimizações para alta concorrência
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableReadyCheck: true,
    maxLoadingTimeout: 10000,
    // Pool de conexões
    lazyConnect: true,
    // Timeouts
    connectTimeout: 10000,
    commandTimeout: 5000,
    // Configurações de performance
    keepAlive: 30000,
    family: 4,
    // Configurações de concorrência
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    // Configurações de memória
    maxLoadingTimeout: 10000,
    // Configurações de rede
    connectTimeout: 10000,
    commandTimeout: 5000,
    // Configurações de pool
    lazyConnect: true,
    // Configurações de keep-alive
    keepAlive: 30000,
    family: 4
});

// Eventos do Redis com logging
redis.on('connect', () => {
    logRedis('info', 'Conectado ao Redis com sucesso', {
        host: 'localhost',
        port: 6379,
        timestamp: new Date().toISOString()
    });
    console.log('✅ Conectado ao Redis');
});

redis.on('error', (err) => {
    logRedis('error', 'Erro na conexão com Redis', {
        error: err.message,
        host: 'localhost',
        port: 6379,
        timestamp: new Date().toISOString()
    });
    console.error('❌ Erro na conexão com Redis:', err);
});

redis.on('ready', () => {
    logRedis('info', 'Redis pronto para uso', {
        timestamp: new Date().toISOString()
    });
});

redis.on('close', () => {
    logRedis('warn', 'Conexão com Redis fechada', {
        timestamp: new Date().toISOString()
    });
});

const GEO_KEY = 'drivers:geo';
const STATUS_KEY = 'drivers:status';

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
            'WITHDIST',
            'WITHCOORD',
            'COUNT',
            limit
        );
        
        console.log(`🔍 Motoristas encontrados para reserva: ${results.length}`);
        
        const drivers = results.map(([uid, distance, [lng, lat]]) => ({
            uid,
            distance: parseFloat(distance),
            lat: parseFloat(lat),
            lng: parseFloat(lng),
        }));
        
        return drivers;
    } catch (error) {
        console.error('❌ Erro ao buscar motoristas para reserva:', error.message);
        return [];
    }
}

// Função para notificar motoristas sobre nova reserva
function notifyDriversAboutBooking(bookingId, bookingData, drivers) {
    try {
        console.log(`📢 Notificando ${drivers.length} motoristas sobre reserva ${bookingId}`);
        
        drivers.forEach(driver => {
            // Emitir evento para cada motorista
            io.to(`driver_${driver.uid}`).emit('newBookingAvailable', {
                bookingId: bookingId,
                booking: bookingData,
                distance: driver.distance,
                pickup: bookingData.pickup,
                drop: bookingData.drop,
                estimate: bookingData.estimate
            });
        });
        
        console.log('✅ Motoristas notificados sobre nova reserva');
    } catch (error) {
        console.error('❌ Erro ao notificar motoristas:', error.message);
    }
}

// Gerenciar conexões Socket.io
io.on('connection', (socket) => {
    let userId = null;
    
    logWebSocket('info', 'Cliente conectado', {
        socketId: socket.id,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        timestamp: new Date().toISOString()
    });
    
    console.log('🔌 Cliente conectado:', socket.id);

    // Autenticação
    socket.on('authenticate', (data) => {
        userId = data.uid;
        socket.data.userId = userId;
        
        // Adicionar usuário a rooms específicas para comunicação direta
        const userType = data.userType || 'passenger'; // 'passenger' ou 'driver'
        
        if (userType === 'driver') {
            socket.join(`driver_${userId}`);
            console.log(`🚗 Motorista ${userId} entrou na room driver_${userId}`);
        } else {
            socket.join(`passenger_${userId}`);
            console.log(`👤 Passageiro ${userId} entrou na room passenger_${userId}`);
        }
        
        socket.emit('authenticated', { success: true, uid: userId, userType: userType });
        
        logWebSocket('info', 'Usuário autenticado', {
            socketId: socket.id,
            userId: userId,
            userType: userType,
            ip: socket.handshake.address,
            timestamp: new Date().toISOString()
        });
        
        console.log('🔐 Usuário autenticado:', userId, 'Tipo:', userType);
    });

    // Atualizar localização
    socket.on('updateLocation', async (data) => {
        if (!userId) return;
        const { lat, lng } = data;
        
        logWebSocket('info', 'Atualização de localização iniciada', {
            socketId: socket.id,
            userId: userId,
            lat: lat,
            lng: lng,
            timestamp: new Date().toISOString()
        });
        
        // Monitorar latência da operação
        const operationId = latencyMonitor.startOperation('updateLocation', userId);
        
        try {
            // 1. Salvar no Redis (primário - tempo real)
            await latencyMonitor.monitorRedisLatency('geoadd', () => 
                redis.geoadd(GEO_KEY, lng, lat, userId)
            );
            
            await latencyMonitor.monitorRedisLatency('hset', () => 
                redis.hset(STATUS_KEY, userId, JSON.stringify({
                    status: 'available',
                    lastUpdate: Date.now(),
                    lat,
                    lng,
                }))
            );

            // 2. Sincronizar com Realtime Database (backup/compatibilidade)
            try {
                await latencyMonitor.monitorFirebaseLatency('syncToRealtimeDB', () =>
                    firebaseConfig.syncToRealtimeDB(`locations/${userId}`, {
                        lat,
                        lng,
                        lastUpdate: Date.now(),
                        status: 'available'
                    })
                );
                console.log(`✅ Localização sincronizada com Realtime DB: ${userId}`);
            } catch (firebaseError) {
                console.error(`❌ Erro ao sincronizar com Realtime DB: ${firebaseError.message}`);
                smartSyncAlertSystem.recordSyncFailure('firebase', 'updateLocation', firebaseError, {
                    operation: 'syncToRealtimeDB',
                    path: `locations/${userId}`,
                    data: { lat, lng, lastUpdate: Date.now(), status: 'available' }
                });
            }

            latencyMonitor.endOperation(operationId, true);
            socket.emit('locationUpdated', { success: true, lat, lng });
        } catch (err) {
            latencyMonitor.endOperation(operationId, false, err.message);
            smartSyncAlertSystem.recordSyncFailure('redis', 'updateLocation', err, {
                operation: 'geoadd',
                key: GEO_KEY,
                value: { lng, lat, member: userId }
            });
            socket.emit('locationUpdated', { success: false, error: err.message });
        }
    });

    // Buscar motoristas próximos
    socket.on('findNearbyDrivers', async (data) => {
        console.log('🔍 Recebido findNearbyDrivers:', data);
        const { lat, lng, radius = 5000, limit = 10 } = data;
        
        // Monitorar latência da operação
        const operationId = latencyMonitor.startOperation('findNearbyDrivers', userId);
        
        try {
            console.log(`🔍 Buscando motoristas próximos: lat=${lat}, lng=${lng}, radius=${radius}, limit=${limit}`);
            
            // Verificar se há dados no Redis
            const totalDrivers = await latencyMonitor.monitorRedisLatency('zcard', () =>
                redis.zcard(GEO_KEY)
            );
            console.log(`📊 Total de motoristas no Redis: ${totalDrivers}`);
            
            if (totalDrivers === 0) {
                console.log('⚠️ Nenhum motorista encontrado no Redis');
                latencyMonitor.endOperation(operationId, true);
                socket.emit('nearbyDrivers', { 
                    success: true, 
                    drivers: [], 
                    message: 'Nenhum motorista disponível' 
                });
                return;
            }
            
            const results = await latencyMonitor.monitorRedisLatency('georadius', () =>
                redis.georadius(
                    GEO_KEY,
                    lng,
                    lat,
                    radius,
                    'm',
                    'WITHDIST',
                    'WITHCOORD',
                    'COUNT',
                    limit
                )
            );
            
            console.log(`🔍 Resultados brutos do Redis:`, results);
            
            const drivers = results.map(([uid, distance, [lng, lat]]) => ({
                uid,
                distance: parseFloat(distance),
                lat: parseFloat(lat),
                lng: parseFloat(lng),
            }));
            
            console.log(`✅ Motoristas encontrados: ${drivers.length}`);
            
            latencyMonitor.endOperation(operationId, true);
            socket.emit('nearbyDrivers', { 
                success: true, 
                drivers,
                total: drivers.length,
                searchRadius: radius
            });
            
        } catch (err) {
            console.error('❌ Erro ao buscar motoristas próximos:', err);
            latencyMonitor.endOperation(operationId, false, err.message);
            smartSyncAlertSystem.recordSyncFailure('redis', 'findNearbyDrivers', err, {
                operation: 'georadius',
                key: GEO_KEY,
                value: { lng, lat, radius, limit }
            });
            socket.emit('nearbyDrivers', { 
                success: false, 
                drivers: [], 
                error: err.message 
            });
        }
    });

    // Atualizar status do motorista
    socket.on('updateDriverStatus', async (data) => {
        if (!userId) return;
        const { status = 'available', isOnline = true } = data;
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
            socket.emit('driverStatusUpdated', { success: false, error: err.message });
        }
    });

    // Estatísticas
    socket.on('getStats', async () => {
        try {
            const all = await redis.hgetall(STATUS_KEY);
            const total = Object.keys(all).length;
            let online = 0;
            let offline = 0;
            Object.values(all).forEach((v) => {
                try {
                    const info = JSON.parse(v);
                    if (info.isOnline) online++;
                    else offline++;
                } catch {}
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

    // Ping
    socket.on('ping', (data) => {
        socket.emit('pong', { ...data, pong: true, ts: Date.now() });
    });

    // Finalizar corrida - sincronizar dados consolidados com Firebase
    socket.on('finishTrip', async (data) => {
        console.log('🏁 Recebido finishTrip:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }
        
        // Extrair dados com valores padrão para evitar erros
        const { 
            tripId, 
            driverId = userId,
            status = 'completed',
            distance = 0,
            fare = 0,
            startTime = Date.now() - 3600000, // 1 hora atrás como padrão
            endTime = Date.now(),
            startLocation = { lat: 0, lng: 0 },
            endLocation = { lat: 0, lng: 0 }
        } = data;
        
        try {
            console.log('📊 Obtendo dados do Redis...');
            // Obter dados do Redis
            const driverInfo = await redis.hget(STATUS_KEY, userId);
            const driverData = driverInfo ? JSON.parse(driverInfo) : {};
            console.log('📊 Dados do motorista:', driverData);
            
            // Dados consolidados da viagem com validação
            const consolidatedTripData = {
                tripId: tripId || `trip_${Date.now()}`,
                driverId: driverId,
                startTime: startTime,
                endTime: endTime,
                startLocation: startLocation,
                endLocation: endLocation,
                distance: distance,
                fare: fare,
                status: status,
                completedAt: new Date().toISOString(),
                driverLocation: {
                    lat: driverData.lat || 0,
                    lng: driverData.lng || 0
                }
            };
            console.log('📊 Dados consolidados:', consolidatedTripData);

            // Sincronizar apenas dados consolidados com Firebase
            console.log('🔥 Sincronizando com Firebase...');
            try {
                await firebaseConfig.syncTripData(consolidatedTripData.tripId, consolidatedTripData);
                console.log('✅ Dados de viagem consolidados sincronizados com Firebase');
                socket.emit('tripFinished', { success: true, tripId: consolidatedTripData.tripId });
            } catch (firebaseError) {
                console.error('❌ Erro ao sincronizar viagem com Firebase:', firebaseError.message);
                console.error('❌ Stack trace:', firebaseError.stack);
                socket.emit('tripFinished', { success: false, error: firebaseError.message });
            }

        } catch (err) {
            console.error('❌ Erro geral no finishTrip:', err.message);
            console.error('❌ Stack trace:', err.stack);
            socket.emit('tripFinished', { success: false, error: err.message });
        }
    });

    // Cancelar corrida - sincronizar dados consolidados
    socket.on('cancelTrip', async (data) => {
        console.log('❌ Recebido cancelTrip:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }
        
        // Extrair dados com valores padrão para evitar erros
        const { 
            tripId, 
            driverId = userId,
            reason = 'driver_unavailable'
        } = data;
        
        try {
            const cancelData = {
                tripId: tripId || `cancel_trip_${Date.now()}`,
                driverId: driverId,
                status: 'cancelled',
                cancelledAt: new Date().toISOString(),
                reason: reason
            };

            console.log('📊 Dados de cancelamento:', cancelData);

            // Sincronizar apenas dados consolidados
            try {
                await firebaseConfig.syncTripData(cancelData.tripId, cancelData);
                console.log('✅ Dados de cancelamento sincronizados com Firebase');
                socket.emit('tripCancelled', { success: true, tripId: cancelData.tripId });
            } catch (firebaseError) {
                console.error('❌ Erro ao sincronizar cancelamento:', firebaseError.message);
                socket.emit('tripCancelled', { success: false, error: firebaseError.message });
            }

        } catch (err) {
            console.error('❌ Erro geral no cancelTrip:', err.message);
            socket.emit('tripCancelled', { success: false, error: err.message });
        }
    });

    // ===== NOVOS EVENTOS DE VIAGEM =====

    // Criar reserva - sistema de booking
    socket.on('createBooking', async (data) => {
        console.log('📋 Recebido createBooking:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { 
            pickup, 
            drop, 
            carType, 
            estimate, 
            customerId = userId 
        } = data;

        try {
            // Gerar ID único para a reserva
            const bookingId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Dados da reserva
            const bookingData = {
                id: bookingId,
                customerId: customerId,
                pickup: pickup,
                drop: drop,
                carType: carType,
                estimate: estimate,
                status: 'NEW',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            console.log('📋 Dados da reserva:', bookingData);

            // Salvar no Redis para acesso rápido
            await redis.hset('bookings:active', bookingId, JSON.stringify(bookingData));
            
            // Salvar no Firebase para persistência
            try {
                await firebaseConfig.syncToRealtimeDB(`bookings/${bookingId}`, bookingData);
                console.log('✅ Reserva salva no Firebase');
            } catch (firebaseError) {
                console.error('❌ Erro ao salvar no Firebase:', firebaseError.message);
            }

            // Adicionar cliente à room da reserva para receber atualizações
            socket.join(`passenger_${bookingId}`);
            
            // Notificar cliente sobre criação da reserva
            socket.emit('bookingCreated', { 
                success: true, 
                bookingId: bookingId,
                booking: bookingData
            });

            // Buscar motoristas próximos automaticamente
            console.log('🔍 Buscando motoristas próximos para nova reserva...');
            const nearbyDrivers = await findNearbyDriversForBooking(pickup, 5000, 10);
            
            if (nearbyDrivers.length > 0) {
                // Notificar motoristas sobre nova reserva
                notifyDriversAboutBooking(bookingId, bookingData, nearbyDrivers);
                
                // Notificar cliente sobre motoristas encontrados
                socket.emit('driversFound', { 
                    success: true, 
                    drivers: nearbyDrivers,
                    bookingId: bookingId
                });
            } else {
                // Notificar cliente que não há motoristas
                socket.emit('noDriversFound', { 
                    success: false, 
                    message: 'Nenhum motorista disponível no momento',
                    bookingId: bookingId
                });
            }

        } catch (err) {
            console.error('❌ Erro ao criar reserva:', err.message);
            socket.emit('bookingCreated', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Motorista responde à reserva (aceita/rejeita)
    socket.on('driverResponse', async (data) => {
        console.log('🚗 Recebido driverResponse:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { 
            bookingId, 
            driverId = userId, 
            accepted, 
            reason = null 
        } = data;

        try {
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
            console.log('📋 Dados da reserva:', booking);

            if (accepted) {
                // Motorista aceitou a corrida
                const updatedBooking = {
                    ...booking,
                    driverId: driverId,
                    status: 'ACCEPTED',
                    acceptedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                // Atualizar no Redis
                await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
                
                // Atualizar no Firebase
                try {
                    await firebaseConfig.syncToRealtimeDB(`bookings/${bookingId}`, updatedBooking);
                    console.log('✅ Reserva atualizada no Firebase');
                } catch (firebaseError) {
                    console.error('❌ Erro ao atualizar no Firebase:', firebaseError.message);
                }

                // Notificar motorista sobre aceitação
                socket.emit('rideAccepted', { 
                    success: true, 
                    bookingId: bookingId,
                    booking: updatedBooking
                });

                // Notificar passageiro sobre aceitação (via room)
                io.to(`passenger_${bookingId}`).emit('driverAccepted', { 
                    bookingId: bookingId,
                    driverId: driverId,
                    driver: {
                        id: driverId,
                        name: 'Motorista', // TODO: Buscar dados do motorista
                        rating: 4.8,
                        car: updatedBooking.carType
                    }
                });

                console.log('✅ Motorista aceitou a corrida:', bookingId);

            } else {
                // Motorista rejeitou a corrida
                const updatedBooking = {
                    ...booking,
                    rejectedDrivers: [...(booking.rejectedDrivers || []), driverId],
                    updatedAt: new Date().toISOString()
                };

                // Atualizar no Redis
                await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
                
                // Atualizar no Firebase
                try {
                    await firebaseConfig.syncToRealtimeDB(`bookings/${bookingId}`, updatedBooking);
                    console.log('✅ Reserva atualizada no Firebase');
                } catch (firebaseError) {
                    console.error('❌ Erro ao atualizar no Firebase:', firebaseError.message);
                }

                // Notificar motorista sobre rejeição
                socket.emit('rideRejected', { 
                    success: true, 
                    bookingId: bookingId,
                    reason: reason
                });

                console.log('❌ Motorista rejeitou a corrida:', bookingId, 'Razão:', reason);
            }

        } catch (err) {
            console.error('❌ Erro ao processar resposta do motorista:', err.message);
            socket.emit('driverResponseError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Iniciar viagem
    socket.on('startTrip', async (data) => {
        console.log('🚀 Recebido startTrip:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { 
            bookingId, 
            driverId = userId,
            startLocation 
        } = data;

        try {
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
            console.log('📋 Dados da reserva para iniciar:', booking);

            // Verificar se o motorista pode iniciar a viagem
            if (booking.status !== 'ACCEPTED' || booking.driverId !== driverId) {
                socket.emit('startTripError', { 
                    success: false, 
                    error: 'Reserva não pode ser iniciada' 
                });
                return;
            }

            // Atualizar status da reserva
            const updatedBooking = {
                ...booking,
                status: 'STARTED',
                startedAt: new Date().toISOString(),
                startLocation: startLocation,
                updatedAt: new Date().toISOString()
            };

            // Atualizar no Redis
            await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
            
            // Atualizar no Firebase
            try {
                await firebaseConfig.syncToRealtimeDB(`bookings/${bookingId}`, updatedBooking);
                console.log('✅ Viagem iniciada no Firebase');
            } catch (firebaseError) {
                console.error('❌ Erro ao atualizar no Firebase:', firebaseError.message);
            }

            // Notificar motorista sobre início da viagem
            socket.emit('tripStarted', { 
                success: true, 
                bookingId: bookingId,
                booking: updatedBooking
            });

            // Notificar passageiro sobre início da viagem
            io.to(`passenger_${bookingId}`).emit('tripStarted', { 
                bookingId: bookingId,
                driverId: driverId,
                startTime: updatedBooking.startedAt,
                startLocation: startLocation
            });

            console.log('✅ Viagem iniciada:', bookingId);

        } catch (err) {
            console.error('❌ Erro ao iniciar viagem:', err.message);
            socket.emit('startTripError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Atualizar localização do motorista durante viagem
    socket.on('updateDriverLocation', async (data) => {
        console.log('📍 Recebido updateDriverLocation:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { 
            bookingId, 
            driverId = userId,
            lat, 
            lng,
            heading = 0,
            speed = 0
        } = data;

        try {
            // Verificar se a viagem está ativa
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('updateDriverLocationError', { 
                    success: false, 
                    error: 'Reserva não encontrada' 
                });
                return;
            }

            const booking = JSON.parse(bookingData);
            if (booking.status !== 'STARTED') {
                socket.emit('updateDriverLocationError', { 
                    success: false, 
                    error: 'Viagem não está em andamento' 
                });
                return;
            }

            // Salvar localização atual do motorista
            const driverLocation = {
                lat: lat,
                lng: lng,
                heading: heading,
                speed: speed,
                timestamp: new Date().toISOString()
            };

            // Salvar no Redis
            await redis.hset('driver_locations', `${bookingId}_${driverId}`, JSON.stringify(driverLocation));
            
            // Salvar no Firebase
            try {
                await firebaseConfig.syncToRealtimeDB(`driver_locations/${bookingId}_${driverId}`, driverLocation);
            } catch (firebaseError) {
                console.error('❌ Erro ao salvar localização no Firebase:', firebaseError.message);
            }

            // Notificar motorista sobre atualização
            socket.emit('driverLocationUpdated', { 
                success: true, 
                location: driverLocation
            });

            // Notificar passageiro sobre localização do motorista
            io.to(`passenger_${bookingId}`).emit('driverLocation', { 
                bookingId: bookingId,
                driverId: driverId,
                location: driverLocation
            });

            console.log('✅ Localização do motorista atualizada:', bookingId);

        } catch (err) {
            console.error('❌ Erro ao atualizar localização do motorista:', err.message);
            socket.emit('updateDriverLocationError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Finalizar viagem
    socket.on('completeTrip', async (data) => {
        console.log('🏁 Recebido completeTrip:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { 
            bookingId, 
            driverId = userId,
            endLocation,
            distance,
            fare,
            endTime = new Date().toISOString()
        } = data;

        try {
            // Buscar dados da reserva
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('completeTripError', { 
                    success: false, 
                    error: 'Reserva não encontrada' 
                });
                return;
            }

            const booking = JSON.parse(bookingData);
            console.log('📋 Dados da reserva para finalizar:', booking);

            // Verificar se a viagem pode ser finalizada
            if (booking.status !== 'STARTED') {
                socket.emit('completeTripError', { 
                    success: false, 
                    error: 'Viagem não está em andamento' 
                });
                return;
            }

            // Atualizar status da reserva
            const updatedBooking = {
                ...booking,
                status: 'COMPLETED',
                completedAt: new Date().toISOString(),
                endLocation: endLocation,
                distance: distance,
                fare: fare,
                endTime: endTime,
                updatedAt: new Date().toISOString()
            };

            // Atualizar no Redis
            await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
            
            // Atualizar no Firebase
            try {
                await firebaseConfig.syncToRealtimeDB(`bookings/${bookingId}`, updatedBooking);
                console.log('✅ Viagem finalizada no Firebase');
            } catch (firebaseError) {
                console.error('❌ Erro ao atualizar no Firebase:', firebaseError.message);
            }

            // Notificar motorista sobre finalização
            socket.emit('tripCompleted', { 
                success: true, 
                bookingId: bookingId,
                booking: updatedBooking
            });

            // Notificar passageiro sobre finalização
            io.to(`passenger_${bookingId}`).emit('tripCompleted', { 
                bookingId: bookingId,
                driverId: driverId,
                endTime: endTime,
                distance: distance,
                fare: fare
            });

            console.log('✅ Viagem finalizada:', bookingId);

        } catch (err) {
            console.error('❌ Erro ao finalizar viagem:', err.message);
            socket.emit('completeTripError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Confirmar pagamento
    socket.on('confirmPayment', async (data) => {
        console.log('💳 Recebido confirmPayment:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { 
            bookingId, 
            customerId = userId,
            paymentMethod,
            paymentId,
            amount
        } = data;

        try {
            // Buscar dados da reserva
            const bookingData = await redis.hget('bookings:active', bookingId);
            if (!bookingData) {
                socket.emit('confirmPaymentError', { 
                    success: false, 
                    error: 'Reserva não encontrada' 
                });
                return;
            }

            const booking = JSON.parse(bookingData);
            console.log('📋 Dados da reserva para confirmar pagamento:', booking);

            // Verificar se a viagem foi finalizada
            if (booking.status !== 'COMPLETED') {
                socket.emit('confirmPaymentError', { 
                    success: false, 
                    error: 'Viagem não foi finalizada' 
                });
                return;
            }

            // Atualizar status da reserva com pagamento
            const updatedBooking = {
                ...booking,
                status: 'PAID',
                paymentConfirmedAt: new Date().toISOString(),
                paymentMethod: paymentMethod,
                paymentId: paymentId,
                amount: amount,
                updatedAt: new Date().toISOString()
            };

            // Atualizar no Redis
            await redis.hset('bookings:active', bookingId, JSON.stringify(updatedBooking));
            
            // Atualizar no Firebase
            try {
                await firebaseConfig.syncToRealtimeDB(`bookings/${bookingId}`, updatedBooking);
                console.log('✅ Pagamento confirmado no Firebase');
            } catch (firebaseError) {
                console.error('❌ Erro ao atualizar no Firebase:', firebaseError.message);
            }

            // Notificar cliente sobre confirmação de pagamento
            socket.emit('paymentConfirmed', { 
                success: true, 
                bookingId: bookingId,
                payment: {
                    method: paymentMethod,
                    id: paymentId,
                    amount: amount,
                    confirmedAt: updatedBooking.paymentConfirmedAt
                }
            });

            // Notificar motorista sobre pagamento confirmado
            io.to(`driver_${booking.driverId}`).emit('paymentConfirmed', { 
                bookingId: bookingId,
                payment: {
                    method: paymentMethod,
                    id: paymentId,
                    amount: amount,
                    confirmedAt: updatedBooking.paymentConfirmedAt
                }
            });

            console.log('✅ Pagamento confirmado:', bookingId);

        } catch (err) {
            console.error('❌ Erro ao confirmar pagamento:', err.message);
            socket.emit('confirmPaymentError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Submeter avaliação
    socket.on('submitRating', async (data) => {
        console.log('⭐ Recebido submitRating:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { 
            tripId,
            rating,
            selectedOptions,
            comment,
            suggestion,
            userType,
            timestamp
        } = data;

        try {
            // Validar dados da avaliação
            if (!tripId || !rating || rating < 1 || rating > 5) {
                socket.emit('ratingSubmittedError', { 
                    success: false, 
                    error: 'Dados da avaliação inválidos' 
                });
                return;
            }

            // Verificar se a viagem existe
            const bookingData = await redis.hget('bookings:active', tripId);
            if (!bookingData) {
                socket.emit('ratingSubmittedError', { 
                    success: false, 
                    error: 'Viagem não encontrada' 
                });
                return;
            }

            const booking = JSON.parse(bookingData);
            console.log('📋 Dados da viagem para avaliação:', booking);

            // Criar objeto da avaliação
            const ratingData = {
                id: `rating_${Date.now()}_${userId}`,
                tripId: tripId,
                userId: userId,
                userType: userType, // 'passenger' ou 'driver'
                rating: rating,
                selectedOptions: selectedOptions || [],
                comment: comment || '',
                suggestion: suggestion || '',
                timestamp: timestamp || new Date().toISOString(),
                createdAt: new Date().toISOString()
            };

            // Salvar avaliação no Redis
            await redis.hset('ratings', ratingData.id, JSON.stringify(ratingData));
            
            // Adicionar à lista de avaliações da viagem
            await redis.sadd(`trip_ratings:${tripId}`, ratingData.id);
            
            // Adicionar à lista de avaliações do usuário
            await redis.sadd(`user_ratings:${userId}`, ratingData.id);

            // Salvar no Firebase
            try {
                await firebaseConfig.syncToRealtimeDB(`ratings/${ratingData.id}`, ratingData);
                console.log('✅ Avaliação salva no Firebase');
            } catch (firebaseError) {
                console.error('❌ Erro ao salvar avaliação no Firebase:', firebaseError.message);
            }

            // Calcular nova média de avaliação para o usuário avaliado
            let targetUserId;
            let targetUserType;
            
            if (userType === 'passenger') {
                // Passageiro avaliando motorista
                targetUserId = booking.driverId;
                targetUserType = 'driver';
            } else {
                // Motorista avaliando passageiro
                targetUserId = booking.customerId;
                targetUserType = 'passenger';
            }

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

            // Calcular nova média
            if (userRatings.length > 0) {
                const totalRating = userRatings.reduce((sum, r) => sum + r.rating, 0);
                const averageRating = totalRating / userRatings.length;
                
                // Atualizar média no perfil do usuário
                const userProfileKey = `user_profiles:${targetUserId}`;
                const userProfile = await redis.hget(userProfileKey, 'profile');
                
                if (userProfile) {
                    const profile = JSON.parse(userProfile);
                    profile.averageRating = Math.round(averageRating * 10) / 10;
                    profile.totalRatings = userRatings.length;
                    profile.lastRatingUpdate = new Date().toISOString();
                    
                    await redis.hset(userProfileKey, 'profile', JSON.stringify(profile));
                    
                    // Sincronizar com Firebase
                    try {
                        await firebaseConfig.syncToRealtimeDB(`user_profiles/${targetUserId}`, profile);
                    } catch (firebaseError) {
                        console.error('❌ Erro ao atualizar perfil no Firebase:', firebaseError.message);
                    }
                }
            }

            // Notificar usuário sobre envio da avaliação
            socket.emit('ratingSubmitted', { 
                success: true, 
                ratingId: ratingData.id,
                message: 'Avaliação enviada com sucesso'
            });

            // Notificar usuário avaliado sobre nova avaliação
            if (targetUserId) {
                io.to(`${targetUserType}_${targetUserId}`).emit('ratingReceived', { 
                    rating: rating,
                    comment: comment || '',
                    suggestion: suggestion || '',
                    fromUserType: userType,
                    tripId: tripId,
                    timestamp: ratingData.timestamp
                });
            }

            console.log('✅ Avaliação enviada com sucesso:', ratingData.id);

        } catch (err) {
            console.error('❌ Erro ao submeter avaliação:', err.message);
            socket.emit('ratingSubmittedError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Buscar avaliações de uma viagem
    socket.on('getTripRatings', async (data) => {
        console.log('🔍 Recebido getTripRatings:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { tripId } = data;

        try {
            // Buscar IDs das avaliações da viagem
            const ratingIds = await redis.smembers(`trip_ratings:${tripId}`);
            const ratings = [];
            
            for (const ratingId of ratingIds) {
                const ratingData = await redis.hget('ratings', ratingId);
                if (ratingData) {
                    ratings.push(JSON.parse(ratingData));
                }
            }

            // Ordenar por timestamp (mais recentes primeiro)
            ratings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            socket.emit('tripRatings', { 
                success: true, 
                tripId: tripId,
                ratings: ratings,
                total: ratings.length
            });

            console.log(`✅ Avaliações da viagem ${tripId} enviadas:`, ratings.length);

        } catch (err) {
            console.error('❌ Erro ao buscar avaliações da viagem:', err.message);
            socket.emit('getTripRatingsError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Buscar avaliações de um usuário
    socket.on('getUserRatings', async (data) => {
        console.log('🔍 Recebido getUserRatings:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { targetUserId, userType } = data;

        try {
            // Buscar IDs das avaliações do usuário
            const ratingIds = await redis.smembers(`user_ratings:${targetUserId}`);
            const ratings = [];
            
            for (const ratingId of ratingIds) {
                const ratingData = await redis.hget('ratings', ratingId);
                if (ratingData) {
                    const rating = JSON.parse(ratingData);
                    // Filtrar apenas avaliações recebidas (não enviadas pelo próprio usuário)
                    if (rating.userType !== userType) {
                        ratings.push(rating);
                    }
                }
            }

            // Ordenar por timestamp (mais recentes primeiro)
            ratings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            // Calcular estatísticas
            const totalRatings = ratings.length;
            const averageRating = totalRatings > 0 
                ? Math.round((ratings.reduce((sum, r) => sum + r.rating, 0) / totalRatings) * 10) / 10
                : 0;
            
            const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            ratings.forEach(r => {
                ratingDistribution[r.rating] = (ratingDistribution[r.rating] || 0) + 1;
            });

            socket.emit('userRatings', { 
                success: true, 
                userId: targetUserId,
                userType: userType,
                ratings: ratings,
                total: totalRatings,
                average: averageRating,
                distribution: ratingDistribution
            });

            console.log(`✅ Avaliações do usuário ${targetUserId} enviadas:`, totalRatings);

        } catch (err) {
            console.error('❌ Erro ao buscar avaliações do usuário:', err.message);
            socket.emit('getUserRatingsError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Verificar se usuário já avaliou uma viagem
    socket.on('hasUserRatedTrip', async (data) => {
        console.log('🔍 Recebido hasUserRatedTrip:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { tripId, userType } = data;

        try {
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

            socket.emit('userRatedTrip', { 
                success: true, 
                tripId: tripId,
                hasRated: hasRated,
                rating: userRating
            });

            console.log(`✅ Verificação de avaliação para viagem ${tripId}:`, hasRated);

        } catch (err) {
            console.error('❌ Erro ao verificar se usuário já avaliou:', err.message);
            socket.emit('hasUserRatedTripError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // ===== EVENTOS DE CHAT =====
    
    // Criar ou buscar chat
    socket.on('create_chat', async (data) => {
        console.log('💬 Recebido create_chat:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { tripId, driverId, passengerId } = data;

        try {
            if (!chatService) {
                throw new Error('Chat Service não disponível');
            }

            const chatResult = await chatService.createChat({
                tripId,
                driverId,
                passengerId
            });

            socket.emit('chat_created', { 
                success: true, 
                chat: chatResult 
            });

            console.log(`✅ Chat criado/buscado:`, chatResult.chatId);

        } catch (err) {
            console.error('❌ Erro ao criar/buscar chat:', err.message);
            socket.emit('chat_created_error', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Enviar mensagem
    socket.on('send_message', async (data) => {
        console.log('💬 Recebido send_message:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { chatId, text, timestamp } = data;

        try {
            if (!chatService) {
                throw new Error('Chat Service não disponível');
            }

            const result = await chatService.sendMessage({
                chatId,
                text,
                userId,
                timestamp
            });

            // Enviar para todos os usuários do chat
            const otherUsers = result.otherUsers;
            for (const otherUserId of otherUsers) {
                const otherSocket = await getSocketByUserId(otherUserId);
                if (otherSocket) {
                    otherSocket.emit('new_message', {
                        chatId,
                        message: result.message
                    });
                }
            }

            // Confirmar envio para o remetente
            socket.emit('message_sent', { 
                success: true, 
                message: result.message 
            });

            console.log(`✅ Mensagem enviada no chat ${chatId}:`, result.message._id);

        } catch (err) {
            console.error('❌ Erro ao enviar mensagem:', err.message);
            socket.emit('message_sent_error', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Carregar mensagens do chat
    socket.on('load_messages', async (data) => {
        console.log('💬 Recebido load_messages:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { chatId, page = 0, limit = 20 } = data;

        try {
            if (!chatService) {
                throw new Error('Chat Service não disponível');
            }

            const messages = await chatService.loadChatMessages(chatId, page, limit);

            socket.emit('messages_loaded', { 
                success: true, 
                chatId,
                messages,
                page,
                hasMore: messages.length === limit
            });

            console.log(`✅ Mensagens carregadas do chat ${chatId}:`, messages.length);

        } catch (err) {
            console.error('❌ Erro ao carregar mensagens:', err.message);
            socket.emit('messages_loaded_error', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Marcar mensagens como lidas
    socket.on('mark_messages_read', async (data) => {
        console.log('💬 Recebido mark_messages_read:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { chatId, messageIds } = data;

        try {
            if (!chatService) {
                throw new Error('Chat Service não disponível');
            }

            await chatService.markMessagesAsRead(chatId, userId, messageIds);

            socket.emit('messages_marked_read', { 
                success: true, 
                chatId,
                messageIds 
            });

            console.log(`✅ Mensagens marcadas como lidas no chat ${chatId}`);

        } catch (err) {
            console.error('❌ Erro ao marcar mensagens como lidas:', err.message);
            socket.emit('messages_marked_read_error', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Indicador de digitação
    socket.on('typing_start', async (data) => {
        console.log('💬 Recebido typing_start:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { chatId } = data;

        try {
            if (!chatService) {
                throw new Error('Chat Service não disponível');
            }

            await chatService.setTypingStatus(chatId, userId, true);

            // Notificar outros usuários do chat
            const chat = await chatService.getChat(chatId);
            if (chat) {
                const otherUsers = [chat.driverId, chat.passengerId].filter(id => id !== userId);
                
                for (const otherUserId of otherUsers) {
                    const otherSocket = await getSocketByUserId(otherUserId);
                    if (otherSocket) {
                        otherSocket.emit('user_typing', {
                            chatId,
                            userId,
                            isTyping: true
                        });
                    }
                }
            }

        } catch (err) {
            console.error('❌ Erro ao definir status de digitação:', err.message);
        }
    });

    socket.on('typing_stop', async (data) => {
        console.log('💬 Recebido typing_stop:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { chatId } = data;

        try {
            if (!chatService) {
                throw new Error('Chat Service não disponível');
            }

            await chatService.setTypingStatus(chatId, userId, false);

            // Notificar outros usuários do chat
            const chat = await chatService.getChat(chatId);
            if (chat) {
                const otherUsers = [chat.driverId, chat.passengerId].filter(id => id !== userId);
                
                for (const otherUserId of otherUsers) {
                    const otherSocket = await getSocketByUserId(otherUserId);
                    if (otherSocket) {
                        otherSocket.emit('user_typing', {
                            chatId,
                            userId,
                            isTyping: false
                        });
                    }
                }
            }

        } catch (err) {
            console.error('❌ Erro ao parar status de digitação:', err.message);
        }
    });

    // Buscar chats do usuário
    socket.on('get_user_chats', async (data) => {
        console.log('💬 Recebido get_user_chats:', data);
        if (!userId) {
            console.log('❌ Usuário não autenticado');
            return;
        }

        const { limit = 20 } = data;

        try {
            if (!chatService) {
                throw new Error('Chat Service não disponível');
            }

            const chats = await chatService.getUserChats(userId, limit);

            socket.emit('user_chats_loaded', { 
                success: true, 
                chats 
            });

            console.log(`✅ Chats do usuário ${userId} carregados:`, chats.length);

        } catch (err) {
            console.error('❌ Erro ao carregar chats do usuário:', err.message);
            socket.emit('user_chats_loaded_error', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Desconexão
    socket.on('disconnect', () => {
        logWebSocket('info', 'Cliente desconectado', {
            socketId: socket.id,
            userId: userId,
            ip: socket.handshake.address,
            timestamp: new Date().toISOString()
        });
        
        console.log('🔌 Cliente desconectado:', socket.id, userId);
    });
});

// Inicializar servidor
server.listen(PORT, () => {
    logger.info('Servidor WebSocket iniciado com sucesso', {
        port: PORT,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
    
    // Iniciar health checks periódicos
    healthChecker.startPeriodicChecks();
    
    console.log(`🚀 Servidor WebSocket rodando na porta ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log('✅ Pronto para receber conexões!');
    console.log('🏥 Health checks iniciados automaticamente');
});