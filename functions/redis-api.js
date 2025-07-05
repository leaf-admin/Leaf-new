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

// API para salvar localização do usuário
exports.saveUserLocation = onRequest(async (req, res) => {
    try {
        // Verificar autenticação
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Token não fornecido' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        const uid = decodedToken.uid;

        const { lat, lng, timestamp } = req.body;
        
        if (!lat || !lng) {
            return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        // Salvar localização no Redis
        const locationKey = `locations:${uid}`;
        await client.hSet(locationKey, {
            lat: lat.toString(),
            lng: lng.toString(),
            timestamp: timestamp || Date.now().toString(),
            updated_at: Date.now().toString()
        });

        // Adicionar ao set de usuários online
        await client.sAdd('users:online', uid);

        // Salvar também no Firebase como fallback
        await admin.database().ref(`locations/${uid}`).set({
            lat,
            lng,
            timestamp: timestamp || Date.now(),
            updated_at: Date.now()
        });

        res.json({ success: true, message: 'Localização salva com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao salvar localização:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para buscar motoristas próximos
exports.getNearbyDrivers = onRequest(async (req, res) => {
    try {
        const { lat, lng, radius = 5000, limit = 10 } = req.query;
        
        if (!lat || !lng) {
            return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
        }

        const client = await initializeRedis();
        if (!client) {
            // Fallback para Firebase
            return getNearbyDriversFromFirebase(lat, lng, radius, limit, res);
        }

        // Buscar motoristas online no Redis
        const onlineDrivers = await client.sMembers('users:online');
        const drivers = [];

        for (const driverId of onlineDrivers) {
            const locationKey = `locations:${driverId}`;
            const location = await client.hGetAll(locationKey);
            
            if (location.lat && location.lng) {
                const distance = calculateDistance(
                    parseFloat(lat), 
                    parseFloat(lng), 
                    parseFloat(location.lat), 
                    parseFloat(location.lng)
                );

                if (distance <= radius) {
                    drivers.push({
                        uid: driverId,
                        lat: parseFloat(location.lat),
                        lng: parseFloat(location.lng),
                        distance: Math.round(distance),
                        timestamp: parseInt(location.timestamp)
                    });
                }
            }
        }

        // Ordenar por distância e limitar resultados
        drivers.sort((a, b) => a.distance - b.distance);
        const limitedDrivers = drivers.slice(0, limit);

        res.json({ 
            success: true, 
            drivers: limitedDrivers,
            total: drivers.length,
            source: 'redis'
        });
    } catch (error) {
        console.error('❌ Erro ao buscar motoristas próximos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para obter localização de um usuário
exports.getUserLocation = onRequest(async (req, res) => {
    try {
        const { uid } = req.params;
        
        if (!uid) {
            return res.status(400).json({ error: 'UID é obrigatório' });
        }

        const client = await initializeRedis();
        if (!client) {
            // Fallback para Firebase
            return getUserLocationFromFirebase(uid, res);
        }

        const locationKey = `locations:${uid}`;
        const location = await client.hGetAll(locationKey);

        if (!location.lat || !location.lng) {
            return res.status(404).json({ error: 'Localização não encontrada' });
        }

        res.json({
            success: true,
            location: {
                uid,
                lat: parseFloat(location.lat),
                lng: parseFloat(location.lng),
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

// API para atualizar status do motorista
exports.updateDriverStatus = onRequest(async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Token não fornecido' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        const uid = decodedToken.uid;

        const { status, isOnline } = req.body;
        
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const statusKey = `driver:status:${uid}`;
        await client.hSet(statusKey, {
            status: status || 'available',
            isOnline: isOnline ? 'true' : 'false',
            updated_at: Date.now().toString()
        });

        // Atualizar sets de usuários online/offline
        if (isOnline) {
            await client.sAdd('users:online', uid);
            await client.sRem('users:offline', uid);
        } else {
            await client.sRem('users:online', uid);
            await client.sAdd('users:offline', uid);
        }

        // Salvar também no Firebase
        await admin.database().ref(`drivers/${uid}/status`).set({
            status: status || 'available',
            isOnline: isOnline || false,
            updated_at: Date.now()
        });

        res.json({ success: true, message: 'Status atualizado com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao atualizar status:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API para obter estatísticas do Redis
exports.getRedisStats = onRequest(async (req, res) => {
    try {
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({ error: 'Redis não disponível' });
        }

        const stats = await client.info();
        const onlineUsers = await client.sCard('users:online');
        const offlineUsers = await client.sCard('users:offline');

        res.json({
            success: true,
            stats: {
                online_users: onlineUsers,
                offline_users: offlineUsers,
                total_users: onlineUsers + offlineUsers,
                redis_info: stats
            }
        });
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Funções auxiliares para fallback do Firebase
async function getNearbyDriversFromFirebase(lat, lng, radius, limit, res) {
    try {
        const snapshot = await admin.database().ref('locations').once('value');
        const locations = snapshot.val();
        const drivers = [];

        if (locations) {
            Object.keys(locations).forEach(uid => {
                const location = locations[uid];
                if (location.lat && location.lng) {
                    const distance = calculateDistance(
                        parseFloat(lat),
                        parseFloat(lng),
                        location.lat,
                        location.lng
                    );

                    if (distance <= radius) {
                        drivers.push({
                            uid,
                            lat: location.lat,
                            lng: location.lng,
                            distance: Math.round(distance),
                            timestamp: location.timestamp
                        });
                    }
                }
            });
        }

        drivers.sort((a, b) => a.distance - b.distance);
        const limitedDrivers = drivers.slice(0, limit);

        res.json({
            success: true,
            drivers: limitedDrivers,
            total: drivers.length,
            source: 'firebase'
        });
    } catch (error) {
        console.error('❌ Erro no fallback Firebase:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
}

async function getUserLocationFromFirebase(uid, res) {
    try {
        const snapshot = await admin.database().ref(`locations/${uid}`).once('value');
        const location = snapshot.val();

        if (!location) {
            return res.status(404).json({ error: 'Localização não encontrada' });
        }

        res.json({
            success: true,
            location: {
                uid,
                lat: location.lat,
                lng: location.lng,
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

// Função para calcular distância entre dois pontos (fórmula de Haversine)
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
    saveUserLocation: exports.saveUserLocation,
    getNearbyDrivers: exports.getNearbyDrivers,
    getUserLocation: exports.getUserLocation,
    updateDriverStatus: exports.updateDriverStatus,
    getRedisStats: exports.getRedisStats
}; 