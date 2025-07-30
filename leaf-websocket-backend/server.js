const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Firebase integration
const firebaseConfig = require('./firebase-config');

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
        socket.emit('authenticated', { success: true, uid: userId });
        
        logWebSocket('info', 'Usuário autenticado', {
            socketId: socket.id,
            userId: userId,
            ip: socket.handshake.address,
            timestamp: new Date().toISOString()
        });
        
        console.log('🔐 Usuário autenticado:', userId);
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