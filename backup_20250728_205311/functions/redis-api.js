const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const redis = require('redis');

// Configuração Redis Cloud
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || null,
    db: process.env.REDIS_DB || 0,
    // Configuração TLS para Redis Cloud
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    // Configurações de timeout
    connectTimeout: 10000,
    commandTimeout: 5000,
    // Configurações de retry
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3
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
        console.log('🔗 Tentando conectar ao Redis...');
        console.log('📍 Host:', REDIS_CONFIG.host);
        console.log('🔌 Porta:', REDIS_CONFIG.port);
        console.log('🔐 TLS:', REDIS_CONFIG.tls ? 'Habilitado' : 'Desabilitado');
        
        redisClient = redis.createClient(REDIS_CONFIG);
        
        redisClient.on('connect', () => {
            console.log('✅ Redis conectado (API)');
            isConnected = true;
        });

        redisClient.on('ready', () => {
            console.log('🚀 Redis pronto para uso');
        });

        redisClient.on('error', (err) => {
            console.error('❌ Erro Redis (API):', err);
            isConnected = false;
        });

        redisClient.on('end', () => {
            console.log('🔌 Conexão Redis encerrada');
            isConnected = false;
        });

        await redisClient.connect();
        return redisClient;
    } catch (error) {
        console.error('❌ Erro ao conectar Redis (API):', error);
        console.error('🔍 Detalhes do erro:', {
            message: error.message,
            code: error.code,
            syscall: error.syscall,
            address: error.address,
            port: error.port
        });
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

// Configuração CORS
const corsConfig = {
    cors: true,
    maxInstances: 10,
    minInstances: 0,
    region: 'us-central1',
    invoker: 'public'
};

// ===== ENDPOINTS DE LOCALIZAÇÃO =====

// API para atualizar localização do usuário
exports.update_user_location = onRequest(corsConfig, async (req, res) => {
    try {
        const { userId, latitude, longitude, timestamp } = req.body;
        
        if (!userId || !latitude || !longitude) {
            return res.status(400).json({ error: 'userId, latitude e longitude são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        // Salvar localização no Redis com GEOADD (Geospatial)
        const locationKey = `locations:${userId}`;
        
        // 1. Adicionar ao set geospatial para queries de proximidade
        await client.geoAdd('user_locations', {
            longitude: parseFloat(longitude),
            latitude: parseFloat(latitude),
            member: userId
        });
        
        // 2. Salvar dados detalhados no hash
        await client.hSet(locationKey, {
            lat: latitude.toString(),
            lng: longitude.toString(),
            timestamp: (timestamp || Date.now()).toString(),
            updated_at: Date.now().toString()
        });

        // 3. Adicionar ao set de usuários online
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
            userId: userId,
            coordinates: { lat: latitude, lng: longitude },
            timestamp: timestamp || Date.now(),
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para buscar motoristas próximos
exports.get_nearby_drivers = onRequest(corsConfig, async (req, res) => {
    try {
        const { latitude, longitude, radius = 5 } = req.body;
        
        if (!latitude || !longitude) {
            return res.status(400).json({ error: 'latitude e longitude são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            console.log('⚠️ Redis não disponível, usando Firebase fallback');
            return getNearbyDriversFromFirebase(latitude, longitude, radius, res);
        }

        // Buscar usuários próximos usando GEORADIUS
        const nearbyUsers = await client.geoRadius('user_locations', {
            longitude: parseFloat(longitude),
            latitude: parseFloat(latitude),
            radius: radius,
            unit: 'km'
        });

        const drivers = [];
        for (const userId of nearbyUsers) {
            const locationData = await client.hGetAll(`locations:${userId}`);
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
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao buscar motoristas próximos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para obter localização do usuário
exports.get_user_location = onRequest(corsConfig, async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        const client = await initializeRedis();
        if (!client) {
            console.log('⚠️ Redis não disponível, usando Firebase fallback');
            return getUserLocationFromFirebase(userId, res);
        }

        const locationData = await client.hGetAll(`locations:${userId}`);
        
        if (!locationData.lat || !locationData.lng) {
            return res.status(404).json({ error: 'Localização não encontrada' });
        }

        res.json({
            success: true,
            userId: userId,
            coordinates: { 
                lat: parseFloat(locationData.lat), 
                lng: parseFloat(locationData.lng) 
            },
            timestamp: parseInt(locationData.timestamp),
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao obter localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ===== ENDPOINTS DE TRACKING =====

// API para iniciar tracking de viagem
exports.start_trip_tracking = onRequest(corsConfig, async (req, res) => {
    try {
        const { tripId, driverId, passengerId, initialLocation } = req.body;
        
        if (!tripId || !driverId || !passengerId || !initialLocation) {
            return res.status(400).json({ error: 'tripId, driverId, passengerId e initialLocation são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
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

        // Salvar dados da viagem
        await client.hSet(`trip:${tripId}`, tripData);
        
        // Adicionar à lista de viagens ativas
        await client.sAdd('active_trips', tripId);

        // Salvar também no Firebase como fallback
        await admin.database().ref(`trips/${tripId}`).set(tripData);

        res.json({
            success: true,
            tripId: tripId,
            status: 'active',
            startTime: tripData.startTime,
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar tracking:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para atualizar localização da viagem
exports.update_trip_location = onRequest(corsConfig, async (req, res) => {
    try {
        const { tripId, latitude, longitude, timestamp = Date.now() } = req.body;
        
        if (!tripId || !latitude || !longitude) {
            return res.status(400).json({ error: 'tripId, latitude e longitude são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const locationUpdate = {
            lat: latitude,
            lng: longitude,
            timestamp: timestamp
        };

        // Adicionar à lista de atualizações da viagem
        await client.lPush(`trip_path:${tripId}`, JSON.stringify(locationUpdate));
        
        // Atualizar localização atual da viagem
        await client.hSet(`trip:${tripId}`, {
            currentLocation: JSON.stringify(locationUpdate),
            lastUpdate: timestamp
        });

        res.json({
            success: true,
            tripId: tripId,
            location: locationUpdate,
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao atualizar localização da viagem:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para finalizar tracking de viagem
exports.end_trip_tracking = onRequest(corsConfig, async (req, res) => {
    try {
        const { tripId, endLocation } = req.body;
        
        if (!tripId || !endLocation) {
            return res.status(400).json({ error: 'tripId e endLocation são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const tripData = await client.hGetAll(`trip:${tripId}`);
        
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

        // Atualizar dados da viagem
        await client.hSet(`trip:${tripId}`, updatedTripData);
        
        // Mover de ativa para finalizada
        await client.sRem('active_trips', tripId);
        await client.sAdd('completed_trips', tripId);

        // Salvar também no Firebase como fallback
        await admin.database().ref(`trips/${tripId}`).set(updatedTripData);

        res.json({
            success: true,
            tripId: tripId,
            status: 'completed',
            endTime: updatedTripData.endTime,
            duration: updatedTripData.duration,
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao finalizar tracking:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para obter dados da viagem
exports.get_trip_data = onRequest(corsConfig, async (req, res) => {
    try {
        const { tripId } = req.body;
        
        if (!tripId) {
            return res.status(400).json({ error: 'tripId é obrigatório' });
        }

        const client = await initializeRedis();
        if (!client) {
            console.log('⚠️ Redis não disponível, usando Firebase fallback');
            return getTripDataFromFirebase(tripId, res);
        }

        const tripData = await client.hGetAll(`trip:${tripId}`);
        
        if (!tripData.tripId) {
            return res.status(404).json({ error: 'Viagem não encontrada' });
        }

        // Obter histórico de localizações
        const pathData = await client.lRange(`trip_path:${tripId}`, 0, -1);
        const path = pathData.map(point => JSON.parse(point));

        res.json({
            success: true,
            tripData: tripData,
            path: path,
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao obter dados da viagem:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para cancelar tracking de viagem
exports.cancel_trip_tracking = onRequest(corsConfig, async (req, res) => {
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
exports.get_trip_history = onRequest(corsConfig, async (req, res) => {
    try {
        const { tripId } = req.body;
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
exports.get_active_trips = onRequest(corsConfig, async (req, res) => {
    try {
        const { userId } = req.body;
        
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
exports.unsubscribe_tracking = onRequest(corsConfig, async (req, res) => {
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
exports.get_redis_stats = onRequest(corsConfig, async (req, res) => {
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
exports.health = onRequest(corsConfig, async (req, res) => {
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

// ===== ENDPOINT DE SINCRONIZAÇÃO FIREBASE =====

// API para sincronização com Firebase (backup)
exports.firebase_sync = onRequest(corsConfig, async (req, res) => {
    try {
        const { type, userId, data, timestamp } = req.body;
        
        if (!type || !userId || !data) {
            return res.status(400).json({ error: 'type, userId e data são obrigatórios' });
        }

        const db = admin.database();
        
        switch (type) {
            case 'location':
                await db.ref(`locations/${userId}`).set({
                    lat: data.lat,
                    lng: data.lng,
                    timestamp: timestamp || Date.now(),
                    updated_at: Date.now()
                });
                break;
                
            case 'trip':
                await db.ref(`trips/${data.tripId}`).set({
                    ...data,
                    timestamp: timestamp || Date.now(),
                    updated_at: Date.now()
                });
                break;
                
            case 'driver_status':
                await db.ref(`driver_status/${userId}`).set({
                    status: data.status,
                    timestamp: timestamp || Date.now(),
                    updated_at: Date.now()
                });
                break;
                
            default:
                return res.status(400).json({ error: 'Tipo de sincronização inválido' });
        }

        console.log(`🔥 Firebase sync: ${type} para ${userId}`);
        
        res.json({ 
            success: true, 
            message: 'Dados sincronizados com Firebase',
            type,
            userId,
            timestamp
        });
        
    } catch (error) {
        console.error('❌ Erro na sincronização Firebase:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

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
    firebase_sync: exports.firebase_sync,
    health: exports.health
}; 