const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const redis = require('redis');

// Configuração Redis
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: process.env.REDIS_DB || 0
};

// Cliente Redis singleton
let redisClient = null;
let isConnected = false;

// Inicializar cliente Redis
const initializeRedis = async () => {
    if (redisClient && isConnected) {
        return redisClient;
    }

    try {
        redisClient = redis.createClient(REDIS_CONFIG);
        
        redisClient.on('connect', () => {
            console.log('✅ Redis conectado (API)');
            isConnected = true;
        });

        redisClient.on('error', (err) => {
            console.error('❌ Erro Redis (API):', err);
            isConnected = false;
        });

        await redisClient.connect();
        return redisClient;
    } catch (error) {
        console.error('❌ Erro ao conectar Redis (API):', error);
        return null;
    }
};

// Middleware de autenticação
const authenticateUser = async (req) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Token não fornecido');
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        return decodedToken;
    } catch (error) {
        throw new Error('Token inválido');
    }
};

// ===== ENDPOINTS DE LOCALIZAÇÃO =====

// API para atualizar localização do usuário
exports.update_user_location = onRequest(async (req, res) => {
    try {
        const { userId, latitude, longitude, timestamp } = req.body;
        
        if (!userId || !latitude || !longitude) {
            return res.status(400).json({ error: 'userId, latitude e longitude são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        // Salvar localização no Redis
        const locationKey = `locations:${userId}`;
        await client.hSet(locationKey, {
            lat: latitude.toString(),
            lng: longitude.toString(),
            timestamp: (timestamp || Date.now()).toString(),
            updated_at: Date.now().toString()
        });

        // Adicionar ao set de usuários online
        await client.sAdd('users:online', userId);

        // Salvar também no Firebase como fallback
        await admin.database().ref(`locations/${userId}`).set({
            lat: latitude,
            lng: longitude,
            timestamp: timestamp || Date.now(),
            updated_at: Date.now()
        });

        res.json({ 
            success: true, 
            message: 'Localização atualizada com sucesso',
            data: { userId, latitude, longitude, timestamp }
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para buscar motoristas próximos
exports.get_nearby_drivers = onRequest(async (req, res) => {
    try {
        const { latitude, longitude, radius = 5000 } = req.body;
        
        if (!latitude || !longitude) {
            return res.status(400).json({ error: 'latitude e longitude são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            // Fallback para Firebase
            return getNearbyDriversFromFirebase(latitude, longitude, radius, res);
        }

        // Buscar motoristas online no Redis
        const onlineDrivers = await client.sMembers('users:online');
        const drivers = [];

        for (const driverId of onlineDrivers) {
            const locationKey = `locations:${driverId}`;
            const location = await client.hGetAll(locationKey);
            
            if (location.lat && location.lng) {
                const distance = calculateDistance(
                    parseFloat(latitude), 
                    parseFloat(longitude), 
                    parseFloat(location.lat), 
                    parseFloat(location.lng)
                );

                if (distance <= radius) {
                    drivers.push({
                        uid: driverId,
                        coordinates: {
                            lat: parseFloat(location.lat),
                            lng: parseFloat(location.lng)
                        },
                        distance: Math.round(distance),
                        timestamp: parseInt(location.timestamp)
                    });
                }
            }
        }

        // Ordenar por distância
        drivers.sort((a, b) => a.distance - b.distance);

        res.json({ 
            success: true, 
            drivers: drivers,
            total: drivers.length,
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao buscar motoristas próximos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para obter localização de um usuário
exports.get_user_location = onRequest(async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        const client = await initializeRedis();
        if (!client) {
            // Fallback para Firebase
            return getUserLocationFromFirebase(userId, res);
        }

        const locationKey = `locations:${userId}`;
        const location = await client.hGetAll(locationKey);

        if (!location.lat || !location.lng) {
            return res.status(404).json({ error: 'Localização não encontrada' });
        }

        res.json({
            success: true,
            location: {
                uid: userId,
                latitude: parseFloat(location.lat),
                longitude: parseFloat(location.lng),
                timestamp: parseInt(location.timestamp),
                updated_at: parseInt(location.updated_at)
            },
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao obter localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ===== ENDPOINTS DE TRACKING =====

// API para iniciar tracking de viagem
exports.start_trip_tracking = onRequest(async (req, res) => {
    try {
        const { tripId, driverId, passengerId, initialLocation } = req.body;
        
        if (!tripId || !driverId || !passengerId || !initialLocation) {
            return res.status(400).json({ error: 'tripId, driverId, passengerId e initialLocation são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const tripKey = `trip:${tripId}`;
        const startTime = Date.now();

        // Salvar dados da viagem no Redis
        await client.hSet(tripKey, {
            tripId,
            driverId,
            passengerId,
            status: 'active',
            startTime: startTime.toString(),
            startLocation: JSON.stringify(initialLocation),
            currentLocation: JSON.stringify(initialLocation),
            updated_at: Date.now().toString()
        });

        // Adicionar à lista de viagens ativas
        await client.sAdd('active_trips', tripId);

        // Salvar também no Firebase como fallback
        await admin.database().ref(`trips/${tripId}`).set({
            tripId,
            driverId,
            passengerId,
            status: 'active',
            startTime,
            startLocation: initialLocation,
            currentLocation: initialLocation,
            updated_at: Date.now()
        });

        res.json({ 
            success: true, 
            message: 'Tracking iniciado com sucesso',
            data: { tripId, startTime }
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar tracking:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para atualizar localização da viagem
exports.update_trip_location = onRequest(async (req, res) => {
    try {
        const { tripId, latitude, longitude, timestamp } = req.body;
        
        if (!tripId || !latitude || !longitude) {
            return res.status(400).json({ error: 'tripId, latitude e longitude são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const tripKey = `trip:${tripId}`;
        const pathKey = `trip_path:${tripId}`;
        const location = { latitude: parseFloat(latitude), longitude: parseFloat(longitude) };

        // Atualizar localização atual da viagem
        await client.hSet(tripKey, {
            currentLocation: JSON.stringify(location),
            updated_at: Date.now().toString()
        });

        // Adicionar ao histórico de localizações
        await client.lPush(pathKey, JSON.stringify({
            ...location,
            timestamp: timestamp || Date.now()
        }));

        // Manter apenas os últimos 100 pontos
        await client.lTrim(pathKey, 0, 99);
        await client.expire(pathKey, 86400); // Expira em 24 horas

        // Salvar também no Firebase como fallback
        await admin.database().ref(`trips/${tripId}/currentLocation`).set(location);
        await admin.database().ref(`trips/${tripId}/updated_at`).set(Date.now());

        res.json({ 
            success: true, 
            message: 'Localização da viagem atualizada',
            data: { tripId, location, timestamp }
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização da viagem:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para finalizar tracking de viagem
exports.end_trip_tracking = onRequest(async (req, res) => {
    try {
        const { tripId, endLocation } = req.body;
        
        if (!tripId) {
            return res.status(400).json({ error: 'tripId é obrigatório' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const tripKey = `trip:${tripId}`;
        const endTime = Date.now();

        // Atualizar dados da viagem
        await client.hSet(tripKey, {
            status: 'completed',
            endTime: endTime.toString(),
            endLocation: JSON.stringify(endLocation || {}),
            updated_at: Date.now().toString()
        });

        // Remover da lista de viagens ativas
        await client.sRem('active_trips', tripId);

        // Adicionar à lista de viagens completadas
        await client.sAdd('completed_trips', tripId);

        // Salvar também no Firebase como fallback
        await admin.database().ref(`trips/${tripId}`).update({
            status: 'completed',
            endTime,
            endLocation: endLocation || {},
            updated_at: Date.now()
        });

        res.json({ 
            success: true, 
            message: 'Tracking finalizado com sucesso',
            data: { tripId, endTime }
        });
    } catch (error) {
        console.error('❌ Erro ao finalizar tracking:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para obter dados da viagem
exports.get_trip_data = onRequest(async (req, res) => {
    try {
        const { tripId } = req.params;
        
        if (!tripId) {
            return res.status(400).json({ error: 'tripId é obrigatório' });
        }

        const client = await initializeRedis();
        if (!client) {
            // Fallback para Firebase
            return getTripDataFromFirebase(tripId, res);
        }

        const tripKey = `trip:${tripId}`;
        const tripData = await client.hGetAll(tripKey);

        if (!tripData.tripId) {
            return res.status(404).json({ error: 'Viagem não encontrada' });
        }

        // Obter último ponto de tracking
        const pathKey = `trip_path:${tripId}`;
        const lastPoint = await client.lIndex(pathKey, 0);
        const lastPointData = lastPoint ? JSON.parse(lastPoint) : null;

        res.json({
            success: true,
            tripData: {
                tripId: tripData.tripId,
                driverId: tripData.driverId,
                passengerId: tripData.passengerId,
                status: tripData.status,
                startTime: parseInt(tripData.startTime),
                endTime: tripData.endTime ? parseInt(tripData.endTime) : null,
                startLocation: JSON.parse(tripData.startLocation),
                currentLocation: JSON.parse(tripData.currentLocation),
                endLocation: tripData.endLocation ? JSON.parse(tripData.endLocation) : null,
                updated_at: parseInt(tripData.updated_at)
            },
            lastPoint: lastPointData,
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao obter dados da viagem:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para cancelar tracking de viagem
exports.cancel_trip_tracking = onRequest(async (req, res) => {
    try {
        const { tripId } = req.body;
        
        if (!tripId) {
            return res.status(400).json({ error: 'tripId é obrigatório' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const tripKey = `trip:${tripId}`;
        const endTime = Date.now();

        // Atualizar dados da viagem
        await client.hSet(tripKey, {
            status: 'cancelled',
            endTime: endTime.toString(),
            updated_at: Date.now().toString()
        });

        // Remover da lista de viagens ativas
        await client.sRem('active_trips', tripId);

        // Adicionar à lista de viagens canceladas
        await client.sAdd('cancelled_trips', tripId);

        // Salvar também no Firebase como fallback
        await admin.database().ref(`trips/${tripId}`).update({
            status: 'cancelled',
            endTime,
            updated_at: Date.now()
        });

        res.json({ 
            success: true, 
            message: 'Tracking cancelado com sucesso',
            data: { tripId, endTime }
        });
    } catch (error) {
        console.error('❌ Erro ao cancelar tracking:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para obter histórico de tracking
exports.get_trip_history = onRequest(async (req, res) => {
    try {
        const { tripId } = req.params;
        const { limit = 50 } = req.query;
        
        if (!tripId) {
            return res.status(400).json({ error: 'tripId é obrigatório' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const pathKey = `trip_path:${tripId}`;
        const pathData = await client.lRange(pathKey, 0, limit - 1);
        
        const history = pathData.map(point => JSON.parse(point)).reverse(); // Mais recente primeiro

        res.json({
            success: true,
            history: history,
            total: history.length,
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao obter histórico da viagem:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para obter viagens ativas
exports.get_active_trips = onRequest(async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const activeTripIds = await client.sMembers('active_trips');
        const activeTrips = [];

        for (const tripId of activeTripIds) {
            const tripKey = `trip:${tripId}`;
            const tripData = await client.hGetAll(tripKey);
            
            if (tripData.driverId === userId || tripData.passengerId === userId) {
                activeTrips.push({
                    tripId: tripData.tripId,
                    driverId: tripData.driverId,
                    passengerId: tripData.passengerId,
                    status: tripData.status,
                    startTime: parseInt(tripData.startTime),
                    startLocation: JSON.parse(tripData.startLocation),
                    currentLocation: JSON.parse(tripData.currentLocation),
                    updated_at: parseInt(tripData.updated_at)
                });
            }
        }

        res.json({
            success: true,
            trips: activeTrips,
            total: activeTrips.length,
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao obter viagens ativas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para desinscrever de tracking
exports.unsubscribe_tracking = onRequest(async (req, res) => {
    try {
        const { tripId } = req.body;
        
        if (!tripId) {
            return res.status(400).json({ error: 'tripId é obrigatório' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        // Remover da lista de viagens ativas
        await client.sRem('active_trips', tripId);

        res.json({ 
            success: true, 
            message: 'Desinscrito de tracking com sucesso',
            data: { tripId }
        });
    } catch (error) {
        console.error('❌ Erro ao desinscrever de tracking:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ===== ENDPOINTS DE ESTATÍSTICAS =====

// API para obter estatísticas do Redis
exports.get_redis_stats = onRequest(async (req, res) => {
    try {
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const stats = {
            activeTrips: await client.sCard('active_trips'),
            completedTrips: await client.sCard('completed_trips'),
            cancelledTrips: await client.sCard('cancelled_trips'),
            onlineUsers: await client.sCard('users:online'),
            totalTrips: await client.sCard('active_trips') + await client.sCard('completed_trips') + await client.sCard('cancelled_trips'),
            redisConnected: true,
            timestamp: Date.now()
        };

        res.json({
            success: true,
            stats: stats,
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API de health check
exports.health = onRequest(async (req, res) => {
    try {
        const client = await initializeRedis();
        const redisStatus = client ? 'connected' : 'disconnected';

        res.json({
            success: true,
            status: 'healthy',
            redis: redisStatus,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('❌ Erro no health check:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ===== FUNÇÕES AUXILIARES =====

// Fallback para buscar motoristas próximos no Firebase
async function getNearbyDriversFromFirebase(lat, lng, radius, res) {
    try {
        const db = admin.database();
        const locationsRef = db.ref('locations');
        const snapshot = await locationsRef.once('value');
        const locations = snapshot.val();

        if (!locations) {
            return res.json({ success: true, drivers: [], total: 0, source: 'firebase' });
        }

        const drivers = [];
        Object.keys(locations).forEach(uid => {
            const location = locations[uid];
            if (location.lat && location.lng) {
                const distance = calculateDistance(lat, lng, location.lat, location.lng);
                if (distance <= radius) {
                    drivers.push({
                        uid,
                        coordinates: { lat: location.lat, lng: location.lng },
                        distance: Math.round(distance),
                        timestamp: location.timestamp
                    });
                }
            }
        });

        drivers.sort((a, b) => a.distance - b.distance);

        res.json({ 
            success: true, 
            drivers: drivers,
            total: drivers.length,
            source: 'firebase'
        });
    } catch (error) {
        console.error('❌ Erro no fallback Firebase:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
}

// Fallback para obter localização do Firebase
async function getUserLocationFromFirebase(uid, res) {
    try {
        const db = admin.database();
        const locationRef = db.ref(`locations/${uid}`);
        const snapshot = await locationRef.once('value');
        const location = snapshot.val();

        if (!location) {
            return res.status(404).json({ error: 'Localização não encontrada' });
        }

        res.json({
            success: true,
            location: {
                uid,
                latitude: location.lat,
                longitude: location.lng,
                timestamp: location.timestamp,
                updated_at: location.updated_at
            },
            source: 'firebase'
        });
    } catch (error) {
        console.error('❌ Erro no fallback Firebase:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
}

// Fallback para obter dados da viagem do Firebase
async function getTripDataFromFirebase(tripId, res) {
    try {
        const db = admin.database();
        const tripRef = db.ref(`trips/${tripId}`);
        const snapshot = await tripRef.once('value');
        const tripData = snapshot.val();

        if (!tripData) {
            return res.status(404).json({ error: 'Viagem não encontrada' });
        }

        res.json({
            success: true,
            tripData: tripData,
            source: 'firebase'
        });
    } catch (error) {
        console.error('❌ Erro no fallback Firebase:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
}

// Função para calcular distância entre dois pontos
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

module.exports = {
    update_user_location: exports.update_user_location,
    get_nearby_drivers: exports.get_nearby_drivers,
    get_user_location: exports.get_user_location,
    start_trip_tracking: exports.start_trip_tracking,
    update_trip_location: exports.update_trip_location,
    end_trip_tracking: exports.end_trip_tracking,
    get_trip_data: exports.get_trip_data,
    cancel_trip_tracking: exports.cancel_trip_tracking,
    get_trip_history: exports.get_trip_history,
    get_active_trips: exports.get_active_trips,
    unsubscribe_tracking: exports.unsubscribe_tracking,
    get_redis_stats: exports.get_redis_stats,
    health: exports.health
}; 