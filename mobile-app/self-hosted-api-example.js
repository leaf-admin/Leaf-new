// 🏠 SELF-HOSTED API EXAMPLE - LEAF APP
// Este é um exemplo de como seria a API rodando em VPS

const express = require('express');
const redis = require('redis');
const WebSocket = require('ws');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 1000, // máximo 1000 requests por IP
    message: 'Muitas requisições, tente novamente em 15 minutos'
});
app.use(limiter);

// Redis Client
const redisClient = redis.createClient({
    host: 'localhost',
    port: 6379,
    password: process.env.REDIS_PASSWORD || null,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3
});

redisClient.on('connect', () => {
    console.log('✅ Redis conectado (Self-Hosted)');
});

redisClient.on('error', (err) => {
    console.error('❌ Erro Redis:', err);
});

// WebSocket Server
const wss = new WebSocket.Server({ port: 3001 });

wss.on('connection', (ws) => {
    console.log('🔗 Nova conexão WebSocket');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Mensagem recebida:', data);
            
            // Broadcast para todos os clientes
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 Conexão WebSocket fechada');
    });
});

// ===== APIs REDIS =====

// Health Check
app.post('/api/health', async (req, res) => {
    try {
        const status = await redisClient.ping();
        res.json({
            success: true,
            status: 'healthy',
            redis: status === 'PONG' ? 'connected' : 'disconnected',
            timestamp: Date.now(),
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro no health check:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Redis Stats
app.post('/api/get_redis_stats', async (req, res) => {
    try {
        const stats = {
            activeTrips: await redisClient.scard('active_trips'),
            completedTrips: await redisClient.scard('completed_trips'),
            cancelledTrips: await redisClient.scard('cancelled_trips'),
            onlineUsers: await redisClient.scard('users:online'),
            totalTrips: await redisClient.scard('active_trips') + await redisClient.scard('completed_trips') + await redisClient.scard('cancelled_trips'),
            redisConnected: true,
            timestamp: Date.now(),
            source: 'self-hosted'
        };

        res.json({
            success: true,
            stats: stats,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Update User Location
app.post('/api/update_user_location', async (req, res) => {
    try {
        const { userId, latitude, longitude, timestamp } = req.body;
        
        if (!userId || !latitude || !longitude) {
            return res.status(400).json({ error: 'userId, latitude e longitude são obrigatórios' });
        }

        // Salvar localização no Redis
        await redisClient.geoAdd('user_locations', {
            longitude: parseFloat(longitude),
            latitude: parseFloat(latitude),
            member: userId
        });
        
        await redisClient.hSet(`locations:${userId}`, {
            lat: latitude.toString(),
            lng: longitude.toString(),
            timestamp: (timestamp || Date.now()).toString(),
            updated_at: Date.now().toString()
        });

        await redisClient.sAdd('users:online', userId);

        res.json({
            success: true,
            message: 'Localização atualizada com sucesso',
            userId: userId,
            coordinates: { lat: latitude, lng: longitude },
            timestamp: timestamp || Date.now(),
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Get Nearby Drivers
app.post('/api/get_nearby_drivers', async (req, res) => {
    try {
        const { latitude, longitude, radius = 5 } = req.body;
        
        if (!latitude || !longitude) {
            return res.status(400).json({ error: 'latitude e longitude são obrigatórios' });
        }

        // Buscar usuários próximos usando GEORADIUS
        const nearbyUsers = await redisClient.geoRadius('user_locations', {
            longitude: parseFloat(longitude),
            latitude: parseFloat(latitude),
            radius: radius,
            unit: 'km'
        });

        const drivers = [];
        for (const userId of nearbyUsers) {
            const locationData = await redisClient.hGetAll(`locations:${userId}`);
            if (locationData.lat && locationData.lng) {
                const distance = calculateDistance(
                    latitude, longitude,
                    parseFloat(locationData.lat), parseFloat(locationData.lng)
                );
                
                drivers.push({
                    uid: userId,
                    coordinates: { 
                        lat: parseFloat(locationData.lat), 
                        lng: parseFloat(locationData.lng) 
                    },
                    distance: Math.round(distance),
                    timestamp: parseInt(locationData.timestamp)
                });
            }
        }

        drivers.sort((a, b) => a.distance - b.distance);

        res.json({
            success: true,
            drivers: drivers,
            total: drivers.length,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao buscar motoristas próximos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Start Trip Tracking
app.post('/api/start_trip_tracking', async (req, res) => {
    try {
        const { tripId, driverId, passengerId, initialLocation } = req.body;
        
        if (!tripId || !driverId || !passengerId || !initialLocation) {
            return res.status(400).json({ error: 'tripId, driverId, passengerId e initialLocation são obrigatórios' });
        }

        const tripData = {
            tripId,
            driverId,
            passengerId,
            startTime: Date.now(),
            startLocation: initialLocation,
            status: 'active',
            updates: []
        };

        await redisClient.hSet(`trip:${tripId}`, tripData);
        await redisClient.sAdd('active_trips', tripId);

        res.json({
            success: true,
            tripId: tripId,
            status: 'active',
            startTime: tripData.startTime,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar tracking:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Update Trip Location
app.post('/api/update_trip_location', async (req, res) => {
    try {
        const { tripId, latitude, longitude, timestamp = Date.now() } = req.body;
        
        if (!tripId || !latitude || !longitude) {
            return res.status(400).json({ error: 'tripId, latitude e longitude são obrigatórios' });
        }

        const locationUpdate = {
            lat: latitude,
            lng: longitude,
            timestamp: timestamp
        };

        await redisClient.lPush(`trip_path:${tripId}`, JSON.stringify(locationUpdate));
        await redisClient.hSet(`trip:${tripId}`, {
            currentLocation: JSON.stringify(locationUpdate),
            lastUpdate: timestamp
        });

        res.json({
            success: true,
            tripId: tripId,
            location: locationUpdate,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização da viagem:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// End Trip Tracking
app.post('/api/end_trip_tracking', async (req, res) => {
    try {
        const { tripId, endLocation } = req.body;
        
        if (!tripId || !endLocation) {
            return res.status(400).json({ error: 'tripId e endLocation são obrigatórios' });
        }

        const tripData = await redisClient.hGetAll(`trip:${tripId}`);
        
        if (!tripData.tripId) {
            return res.status(404).json({ error: 'Viagem não encontrada' });
        }

        const updatedTripData = {
            ...tripData,
            endTime: Date.now(),
            endLocation: endLocation,
            status: 'completed',
            duration: Date.now() - parseInt(tripData.startTime)
        };

        await redisClient.hSet(`trip:${tripId}`, updatedTripData);
        await redisClient.sRem('active_trips', tripId);
        await redisClient.sAdd('completed_trips', tripId);

        res.json({
            success: true,
            tripId: tripId,
            status: 'completed',
            endTime: updatedTripData.endTime,
            duration: updatedTripData.duration,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao finalizar tracking:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Get Trip Data
app.post('/api/get_trip_data', async (req, res) => {
    try {
        const { tripId } = req.body;
        
        if (!tripId) {
            return res.status(400).json({ error: 'tripId é obrigatório' });
        }

        const tripData = await redisClient.hGetAll(`trip:${tripId}`);
        
        if (!tripData.tripId) {
            return res.status(404).json({ error: 'Viagem não encontrada' });
        }

        const pathData = await redisClient.lRange(`trip_path:${tripId}`, 0, -1);
        const path = pathData.map(point => JSON.parse(point));

        res.json({
            success: true,
            tripData: tripData,
            path: path,
            source: 'self-hosted'
        });
    } catch (error) {
        console.error('❌ Erro ao obter dados da viagem:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Função auxiliar para calcular distância
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Iniciar servidor
app.listen(port, () => {
    console.log(`🚀 API Self-Hosted rodando na porta ${port}`);
    console.log(`🔗 WebSocket rodando na porta 3001`);
    console.log(`📊 Health check: http://localhost:${port}/api/health`);
});

module.exports = app; 