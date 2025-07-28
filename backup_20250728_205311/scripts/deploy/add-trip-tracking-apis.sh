#!/bin/bash

echo "🔧 ADICIONANDO APIS DE TRIP TRACKING NA VPS"
echo "============================================="

# Conectar à VPS e adicionar APIs de tracking
ssh root@147.93.66.253 << 'EOF'
echo "🔧 Adicionando APIs de trip tracking..."

# Parar PM2
pm2 stop leaf-api

# Fazer backup do server atual
cd /opt/leaf-app
cp server-simple.js server-simple-backup.js

# Adicionar APIs de trip tracking ao server
cat > server-with-tracking.js << 'TRACKING_EOF'
// 🏠 LEAF APP - VERSÃO COM TRIP TRACKING
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

// 📍 API - Atualizar localização do usuário
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

// 🚗 API - Atualizar localização do motorista
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

// 🔍 API - Buscar motoristas próximos
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

// 🚕 API - Iniciar tracking de viagem
app.post('/api/start_trip_tracking', async (req, res) => {
    try {
        console.log('📝 Dados recebidos:', req.body);
        
        const { tripId, driverId, passengerId, initialLocation } = req.body;
        
        if (!tripId || !driverId || !passengerId || !initialLocation) {
            return res.status(400).json({ 
                error: 'Dados obrigatórios: tripId, driverId, passengerId, initialLocation',
                received: req.body 
            });
        }

        // Salvar dados da viagem no Redis
        const tripData = {
            tripId,
            driverId,
            passengerId,
            startLocation: initialLocation,
            startTime: Date.now(),
            status: 'active',
            currentLocation: initialLocation,
            path: [initialLocation]
        };

        await redisClient.set(`trip:${tripId}`, JSON.stringify(tripData));
        await redisClient.expire(`trip:${tripId}`, 86400); // 24 horas

        // Adicionar à lista de viagens ativas
        await redisClient.zAdd('active_trips', { score: Date.now(), value: tripId });

        res.json({ 
            success: true, 
            message: 'Tracking de viagem iniciado',
            data: { tripId, status: 'active' }
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar tracking:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error.message 
        });
    }
});

// 📍 API - Atualizar localização da viagem
app.post('/api/update_trip_location', async (req, res) => {
    try {
        console.log('📝 Dados recebidos:', req.body);
        
        const { tripId, latitude, longitude, timestamp } = req.body;
        
        if (!tripId || !latitude || !longitude) {
            return res.status(400).json({ 
                error: 'Dados obrigatórios: tripId, latitude, longitude',
                received: req.body 
            });
        }

        // Buscar dados da viagem
        const tripDataStr = await redisClient.get(`trip:${tripId}`);
        if (!tripDataStr) {
            return res.status(404).json({ error: 'Viagem não encontrada' });
        }

        const tripData = JSON.parse(tripDataStr);
        const newLocation = { lat: latitude, lng: longitude, timestamp: timestamp || Date.now() };

        // Atualizar localização atual e adicionar ao path
        tripData.currentLocation = newLocation;
        tripData.path.push(newLocation);

        // Salvar dados atualizados
        await redisClient.set(`trip:${tripId}`, JSON.stringify(tripData));

        res.json({ 
            success: true, 
            message: 'Localização da viagem atualizada',
            data: { tripId, currentLocation: newLocation }
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização da viagem:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error.message 
        });
    }
});

// ✅ API - Finalizar tracking de viagem
app.post('/api/end_trip_tracking', async (req, res) => {
    try {
        console.log('📝 Dados recebidos:', req.body);
        
        const { tripId, endLocation } = req.body;
        
        if (!tripId) {
            return res.status(400).json({ 
                error: 'Dados obrigatórios: tripId',
                received: req.body 
            });
        }

        // Buscar dados da viagem
        const tripDataStr = await redisClient.get(`trip:${tripId}`);
        if (!tripDataStr) {
            return res.status(404).json({ error: 'Viagem não encontrada' });
        }

        const tripData = JSON.parse(tripDataStr);
        
        // Finalizar viagem
        tripData.endLocation = endLocation || tripData.currentLocation;
        tripData.endTime = Date.now();
        tripData.status = 'completed';
        tripData.duration = tripData.endTime - tripData.startTime;

        // Salvar dados finais
        await redisClient.set(`trip:${tripId}`, JSON.stringify(tripData));
        await redisClient.expire(`trip:${tripId}`, 604800); // 7 dias

        // Remover da lista de viagens ativas
        await redisClient.zRem('active_trips', tripId);

        res.json({ 
            success: true, 
            message: 'Tracking de viagem finalizado',
            data: { tripId, status: 'completed', duration: tripData.duration }
        });
    } catch (error) {
        console.error('❌ Erro ao finalizar tracking:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error.message 
        });
    }
});

// 📋 API - Obter dados da viagem
app.get('/api/get_trip_data/:tripId', async (req, res) => {
    try {
        const { tripId } = req.params;
        
        if (!tripId) {
            return res.status(400).json({ error: 'tripId obrigatório' });
        }

        // Buscar dados da viagem
        const tripDataStr = await redisClient.get(`trip:${tripId}`);
        if (!tripDataStr) {
            return res.status(404).json({ error: 'Viagem não encontrada' });
        }

        const tripData = JSON.parse(tripDataStr);

        res.json({ 
            success: true, 
            tripData: tripData
        });
    } catch (error) {
        console.error('❌ Erro ao buscar dados da viagem:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error.message 
        });
    }
});

// 📊 API - Estatísticas
app.get('/api/stats', async (req, res) => {
    try {
        const activeDrivers = await redisClient.zCard('active_drivers');
        const activeTrips = await redisClient.zCard('active_trips');
        
        res.json({
            activeDrivers,
            activeTrips,
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
    console.log(`🚀 Leaf API (COM TRIP TRACKING) rodando na porta ${port}`);
    console.log(`📊 Health check: http://localhost:${port}/api/health`);
});

module.exports = app;
TRACKING_EOF

# Reiniciar PM2 com versão com tracking
pm2 delete leaf-api
pm2 start server-with-tracking.js --name leaf-api

# Verificar status
echo "📊 Status do PM2:"
pm2 status

# Testar Redis
echo "🔴 Testando Redis:"
redis-cli ping

echo "✅ APIs de trip tracking adicionadas!"
EOF

echo "🎯 APIs de trip tracking implementadas!"
echo "🧪 Teste agora: node test-mobile-integration.cjs" 