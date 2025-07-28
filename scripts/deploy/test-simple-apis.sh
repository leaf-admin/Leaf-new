#!/bin/bash

echo "🧪 TESTANDO VERSÕES SIMPLIFICADAS DAS APIS"
echo "============================================"

# Conectar à VPS e testar APIs simplificadas
ssh root@147.93.66.253 << 'EOF'
echo "🧪 Testando APIs simplificadas..."

# Parar PM2
pm2 stop leaf-api

# Criar versão simplificada do server.js
cd /opt/leaf-app
cat > server-simple.js << 'SIMPLE_EOF'
// 🏠 LEAF APP - VERSÃO SIMPLIFICADA PARA TESTES
const express = require('express');
const redis = require('redis');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// 🔒 Configurações básicas
app.use(cors());
app.use(express.json());

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
    password: null
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
        redis: redisClient.isReady ? 'connected' : 'disconnected'
    });
});

// 📍 API - Atualizar localização do usuário (SIMPLIFICADA)
app.post('/api/update_user_location', async (req, res) => {
    try {
        console.log('📝 Dados recebidos:', req.body);
        
        const { userId, lat, lng } = req.body;
        
        if (!userId || !lat || !lng) {
            return res.status(400).json({ 
                error: 'Dados obrigatórios: userId, lat, lng',
                received: req.body 
            });
        }

        // Teste simples - apenas salvar no Redis
        const key = `user:${userId}:location`;
        await redisClient.set(key, JSON.stringify({ lat, lng, timestamp: Date.now() }));
        await redisClient.expire(key, 3600);

        res.json({ 
            success: true, 
            message: 'Localização atualizada',
            data: { userId, lat, lng }
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error.message 
        });
    }
});

// 🚗 API - Atualizar localização do motorista (SIMPLIFICADA)
app.post('/api/update_driver_location', async (req, res) => {
    try {
        console.log('📝 Dados recebidos:', req.body);
        
        const { driverId, lat, lng, status } = req.body;
        
        if (!driverId || !lat || !lng) {
            return res.status(400).json({ 
                error: 'Dados obrigatórios: driverId, lat, lng',
                received: req.body 
            });
        }

        // Teste simples - apenas salvar no Redis
        const key = `driver:${driverId}:location`;
        await redisClient.set(key, JSON.stringify({ 
            lat, lng, status: status || 'available', timestamp: Date.now() 
        }));
        await redisClient.expire(key, 3600);

        // Adicionar à lista de motoristas ativos
        await redisClient.zAdd('active_drivers', { score: Date.now(), value: driverId });

        res.json({ 
            success: true, 
            message: 'Localização do motorista atualizada',
            data: { driverId, lat, lng, status: status || 'available' }
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização do motorista:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error.message 
        });
    }
});

// 🔍 API - Buscar motoristas próximos (SIMPLIFICADA)
app.get('/api/nearby_drivers', async (req, res) => {
    try {
        const { lat, lng, radius = 5 } = req.query;
        
        if (!lat || !lng) {
            return res.status(400).json({ error: 'Parâmetros obrigatórios: lat, lng' });
        }

        // Buscar motoristas ativos
        const activeDrivers = await redisClient.zRange('active_drivers', 0, -1);
        const nearbyDrivers = [];

        for (const driverId of activeDrivers) {
            const driverData = await redisClient.get(`driver:${driverId}:location`);
            if (driverData) {
                const driver = JSON.parse(driverData);
                nearbyDrivers.push({
                    driverId,
                    lat: driver.lat,
                    lng: driver.lng,
                    status: driver.status || 'available',
                    distance: '0.5' // Simulado
                });
            }
        }

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
        
        res.json({
            activeDrivers,
            uptime: process.uptime(),
            memory: process.memoryUsage()
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// 🖥️ Iniciar servidor HTTP
app.listen(port, () => {
    console.log(`🚀 Leaf API (SIMPLIFICADA) rodando na porta ${port}`);
    console.log(`📊 Health check: http://localhost:${port}/api/health`);
});

module.exports = app;
SIMPLE_EOF

# Reiniciar PM2 com versão simplificada
pm2 delete leaf-api
pm2 start server-simple.js --name leaf-api

# Verificar status
echo "📊 Status do PM2:"
pm2 status

# Testar Redis
echo "🔴 Testando Redis:"
redis-cli ping

echo "✅ Versão simplificada iniciada!"
EOF

echo "🎯 Versão simplificada aplicada!"
echo "🧪 Teste agora: curl -X POST http://147.93.66.253:3000/api/update_user_location -H \"Content-Type: application/json\" -d '{\"userId\":\"test\",\"lat\":-23.5505,\"lng\":-46.6333}'" 