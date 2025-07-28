#!/bin/bash

echo "🔧 CORRIGINDO PROBLEMAS DA API"
echo "==============================="

# Conectar à VPS e corrigir problemas
ssh root@147.93.66.253 << 'EOF'
echo "🔧 Corrigindo problemas da API..."

# Parar PM2
pm2 stop leaf-api

# Criar novo server.js corrigido
cd /opt/leaf-app
cat > server.js << 'SERVER_EOF'
// 🏠 LEAF APP - SELF-HOSTED API
const express = require('express');
const redis = require('redis');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const wsPort = process.env.WS_PORT || 3001;

// 🔒 Configurações de segurança
app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));

// 🚦 Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: 'Muitas requisições, tente novamente mais tarde.'
});
app.use(limiter);

// 📊 Middleware de logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// 🔴 Redis Client
const redisClient = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379
    },
    password: null,
    database: parseInt(process.env.REDIS_DB) || 0
});

redisClient.on('error', (err) => {
    console.error('🔴 Redis Error:', err);
});

redisClient.on('connect', () => {
    console.log('🔴 Redis conectado com sucesso!');
});

// 🔗 Conectar Redis
(async () => {
    await redisClient.connect();
})();

// 🏠 Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        redis: redisClient.isReady ? 'connected' : 'disconnected'
    });
});

// 📍 API - Atualizar localização do usuário
app.post('/api/update_user_location', async (req, res) => {
    try {
        const { userId, lat, lng, timestamp } = req.body;
        
        if (!userId || !lat || !lng) {
            return res.status(400).json({ error: 'Dados obrigatórios: userId, lat, lng' });
        }

        const locationData = {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            timestamp: timestamp || Date.now()
        };

        await redisClient.hSet(`user:${userId}:location`, 'lat', locationData.lat, 'lng', locationData.lng, 'timestamp', locationData.timestamp);
        await redisClient.expire(`user:${userId}:location`, 3600); // 1 hora

        res.json({ success: true, message: 'Localização atualizada' });
    } catch (error) {
        console.error('Erro ao atualizar localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// 🚗 API - Atualizar localização do motorista
app.post('/api/update_driver_location', async (req, res) => {
    try {
        const { driverId, lat, lng, status, timestamp } = req.body;
        
        if (!driverId || !lat || !lng) {
            return res.status(400).json({ error: 'Dados obrigatórios: driverId, lat, lng' });
        }

        const locationData = {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            status: status || 'available',
            timestamp: timestamp || Date.now()
        };

        await redisClient.hSet(`driver:${driverId}:location`, 'lat', locationData.lat, 'lng', locationData.lng, 'status', locationData.status, 'timestamp', locationData.timestamp);
        await redisClient.expire(`driver:${driverId}:location`, 3600); // 1 hora

        // Adicionar à lista de motoristas ativos
        await redisClient.zAdd('active_drivers', {
            score: Date.now(),
            value: driverId
        });

        res.json({ success: true, message: 'Localização do motorista atualizada' });
    } catch (error) {
        console.error('Erro ao atualizar localização do motorista:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// 🔍 API - Buscar motoristas próximos
app.get('/api/nearby_drivers', async (req, res) => {
    try {
        const { lat, lng, radius = 5 } = req.query;
        
        if (!lat || !lng) {
            return res.status(400).json({ error: 'Parâmetros obrigatórios: lat, lng' });
        }

        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const searchRadius = parseFloat(radius);

        // Buscar motoristas ativos
        const activeDrivers = await redisClient.zRange('active_drivers', 0, -1);
        const nearbyDrivers = [];

        for (const driverId of activeDrivers) {
            const driverLocation = await redisClient.hGetAll(`driver:${driverId}:location`);
            
            if (driverLocation.lat && driverLocation.lng) {
                const distance = calculateDistance(
                    userLat, userLng,
                    parseFloat(driverLocation.lat), parseFloat(driverLocation.lng)
                );

                if (distance <= searchRadius) {
                    nearbyDrivers.push({
                        driverId,
                        lat: parseFloat(driverLocation.lat),
                        lng: parseFloat(driverLocation.lng),
                        status: driverLocation.status || 'available',
                        distance: distance.toFixed(2)
                    });
                }
            }
        }

        // Ordenar por distância
        nearbyDrivers.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

        res.json({
            success: true,
            drivers: nearbyDrivers,
            count: nearbyDrivers.length
        });
    } catch (error) {
        console.error('Erro ao buscar motoristas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// 📊 API - Estatísticas
app.get('/api/stats', async (req, res) => {
    try {
        const activeDrivers = await redisClient.zCard('active_drivers');
        const redisInfo = await redisClient.info();
        
        res.json({
            activeDrivers,
            redisInfo: redisInfo.split('\n').slice(0, 10), // Primeiras 10 linhas
            uptime: process.uptime(),
            memory: process.memoryUsage()
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// 🧮 Função para calcular distância (Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 🖥️ Iniciar servidor HTTP
app.listen(port, () => {
    console.log(`🚀 Leaf API rodando na porta ${port}`);
    console.log(`📊 Health check: http://localhost:${port}/api/health`);
});

// 🔌 WebSocket Server
const wss = new WebSocket.Server({ port: wsPort });

wss.on('connection', (ws, req) => {
    console.log('🔌 Nova conexão WebSocket:', req.socket.remoteAddress);
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            // Processar mensagens WebSocket
            if (data.type === 'location_update') {
                // Broadcast para outros clientes
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            }
        } catch (error) {
            console.error('Erro ao processar mensagem WebSocket:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 Conexão WebSocket fechada');
    });
});

console.log(`🔌 WebSocket rodando na porta ${wsPort}`);

// 🛑 Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 Recebido SIGTERM, fechando...');
    await redisClient.quit();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Recebido SIGINT, fechando...');
    await redisClient.quit();
    process.exit(0);
});

module.exports = app;
SERVER_EOF

# Reiniciar PM2
pm2 start leaf-api

# Verificar status
echo "📊 Status do PM2:"
pm2 status

# Testar Redis
echo "🔴 Testando Redis:"
redis-cli ping

echo "✅ Correção concluída!"
EOF

echo "🎯 Correção aplicada com sucesso!"
echo "🧪 Execute novamente: node test-self-hosted-api.cjs" 