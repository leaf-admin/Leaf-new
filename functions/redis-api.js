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

// API 1: Salvar localização do usuário
exports.save_user_location = onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).send();
        return;
    }

    try {
        // Autenticar usuário
        const user = await authenticateUser(req);
        
        // Validar dados
        const { lat, lng, timestamp } = req.body;
        if (!lat || !lng) {
            return res.status(400).json({
                success: false,
                error: 'Latitude e longitude são obrigatórios'
            });
        }

        // Conectar Redis
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({
                success: false,
                error: 'Redis não disponível'
            });
        }

        // Salvar localização
        const locationData = {
            uid: user.uid,
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            timestamp: timestamp || Date.now(),
            updatedAt: new Date().toISOString()
        };

        await client.hSet(`user:location:${user.uid}`, locationData);
        await client.expire(`user:location:${user.uid}`, 1800); // 30 minutos TTL

        // Adicionar à lista de usuários online
        await client.sAdd('users:online', user.uid);

        console.log(`📍 Localização salva para usuário ${user.uid}`);

        res.json({
            success: true,
            message: 'Localização salva com sucesso',
            data: locationData
        });

    } catch (error) {
        console.error('❌ Erro ao salvar localização:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API 2: Obter localização do usuário
exports.get_user_location = onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).send();
        return;
    }

    try {
        // Autenticar usuário
        const user = await authenticateUser(req);
        
        // Conectar Redis
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({
                success: false,
                error: 'Redis não disponível'
            });
        }

        // Obter localização
        const locationData = await client.hGetAll(`user:location:${user.uid}`);
        
        if (!locationData || Object.keys(locationData).length === 0) {
            return res.json({
                success: true,
                data: null,
                message: 'Localização não encontrada'
            });
        }

        res.json({
            success: true,
            data: {
                lat: parseFloat(locationData.lat),
                lng: parseFloat(locationData.lng),
                timestamp: parseInt(locationData.timestamp),
                updatedAt: locationData.updatedAt
            }
        });

    } catch (error) {
        console.error('❌ Erro ao obter localização:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API 3: Buscar usuários próximos
exports.get_nearby_users = onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Methods', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).send();
        return;
    }

    try {
        // Autenticar usuário
        const user = await authenticateUser(req);
        
        // Validar parâmetros
        const { lat, lng, radius = 5, limit = 10, userType } = req.query;
        if (!lat || !lng) {
            return res.status(400).json({
                success: false,
                error: 'Latitude e longitude são obrigatórios'
            });
        }

        // Conectar Redis
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({
                success: false,
                error: 'Redis não disponível'
            });
        }

        // Buscar usuários próximos usando GEO
        try {
            const nearbyUsers = await client.geoRadius(
                'locations:geo',
                parseFloat(lng),
                parseFloat(lat),
                parseFloat(radius),
                'km',
                'WITHCOORD',
                'WITHDIST',
                'COUNT',
                parseInt(limit)
            );

            const users = [];
            for (const userData of nearbyUsers) {
                const [userId, coordinates, distance] = userData;
                
                // Filtrar por tipo de usuário se especificado
                if (userType) {
                    const userInfo = await client.hGetAll(`user:${userId}`);
                    if (userInfo.usertype !== userType) {
                        continue;
                    }
                }

                users.push({
                    uid: userId,
                    lat: coordinates[1],
                    lng: coordinates[0],
                    distance: parseFloat(distance)
                });
            }

            res.json({
                success: true,
                data: users,
                count: users.length
            });

        } catch (geoError) {
            // Fallback para busca sem GEO
            console.log('⚠️ Comandos GEO não disponíveis, usando fallback');
            
            const allUsers = await client.sMembers('users:online');
            const users = [];

            for (const userId of allUsers.slice(0, parseInt(limit))) {
                const locationData = await client.hGetAll(`user:location:${userId}`);
                
                if (locationData && locationData.lat && locationData.lng) {
                    const distance = calculateDistance(
                        parseFloat(lat), parseFloat(lng),
                        parseFloat(locationData.lat), parseFloat(locationData.lng)
                    );

                    if (distance <= parseFloat(radius)) {
                        users.push({
                            uid: userId,
                            lat: parseFloat(locationData.lat),
                            lng: parseFloat(locationData.lng),
                            distance: distance
                        });
                    }
                }
            }

            // Ordenar por distância
            users.sort((a, b) => a.distance - b.distance);

            res.json({
                success: true,
                data: users.slice(0, parseInt(limit)),
                count: users.length
            });
        }

    } catch (error) {
        console.error('❌ Erro ao buscar usuários próximos:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API 4: Iniciar tracking de viagem
exports.start_trip_tracking = onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).send();
        return;
    }

    try {
        // Autenticar usuário
        const user = await authenticateUser(req);
        
        // Validar dados
        const { tripId, driverId, passengerId, initialLocation } = req.body;
        if (!tripId || !driverId || !passengerId || !initialLocation) {
            return res.status(400).json({
                success: false,
                error: 'tripId, driverId, passengerId e initialLocation são obrigatórios'
            });
        }

        // Conectar Redis
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({
                success: false,
                error: 'Redis não disponível'
            });
        }

        // Iniciar tracking
        const tripData = {
            tripId,
            driverId,
            passengerId,
            status: 'active',
            startTime: Date.now(),
            startLocation: JSON.stringify(initialLocation),
            currentLocation: JSON.stringify(initialLocation),
            path: JSON.stringify([initialLocation]),
            updatedAt: new Date().toISOString()
        };

        await client.hSet(`trip:${tripId}`, tripData);
        await client.sAdd('active_trips', tripId);
        await client.expire(`trip:${tripId}`, 86400); // 24 horas TTL

        console.log(`🚗 Tracking iniciado para viagem ${tripId}`);

        res.json({
            success: true,
            message: 'Tracking iniciado com sucesso',
            data: { tripId, status: 'active' }
        });

    } catch (error) {
        console.error('❌ Erro ao iniciar tracking:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API 5: Atualizar localização da viagem
exports.update_trip_location = onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).send();
        return;
    }

    try {
        // Autenticar usuário
        const user = await authenticateUser(req);
        
        // Validar dados
        const { tripId, lat, lng, timestamp } = req.body;
        if (!tripId || !lat || !lng) {
            return res.status(400).json({
                success: false,
                error: 'tripId, lat e lng são obrigatórios'
            });
        }

        // Conectar Redis
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({
                success: false,
                error: 'Redis não disponível'
            });
        }

        // Atualizar localização
        const location = { lat: parseFloat(lat), lng: parseFloat(lng) };
        
        await client.hSet(`trip:${tripId}`, {
            currentLocation: JSON.stringify(location),
            updatedAt: new Date().toISOString()
        });

        // Adicionar ao histórico
        const pathKey = `trip_path:${tripId}`;
        await client.lPush(pathKey, JSON.stringify({
            ...location,
            timestamp: timestamp || Date.now()
        }));
        
        await client.lTrim(pathKey, 0, 99); // Manter apenas 100 pontos
        await client.expire(pathKey, 86400);

        console.log(`📍 Localização da viagem ${tripId} atualizada`);

        res.json({
            success: true,
            message: 'Localização atualizada com sucesso',
            data: { tripId, location }
        });

    } catch (error) {
        console.error('❌ Erro ao atualizar localização da viagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API 6: Finalizar tracking de viagem
exports.end_trip_tracking = onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).send();
        return;
    }

    try {
        // Autenticar usuário
        const user = await authenticateUser(req);
        
        // Validar dados
        const { tripId, endLocation } = req.body;
        if (!tripId) {
            return res.status(400).json({
                success: false,
                error: 'tripId é obrigatório'
            });
        }

        // Conectar Redis
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({
                success: false,
                error: 'Redis não disponível'
            });
        }

        // Finalizar tracking
        const endTime = Date.now();
        
        await client.hSet(`trip:${tripId}`, {
            status: 'completed',
            endTime: endTime.toString(),
            endLocation: JSON.stringify(endLocation || {}),
            updatedAt: new Date().toISOString()
        });

        await client.sRem('active_trips', tripId);
        await client.sAdd('completed_trips', tripId);

        console.log(`✅ Tracking finalizado para viagem ${tripId}`);

        res.json({
            success: true,
            message: 'Tracking finalizado com sucesso',
            data: { tripId, status: 'completed' }
        });

    } catch (error) {
        console.error('❌ Erro ao finalizar tracking:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API 7: Obter dados da viagem
exports.get_trip_data = onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).send();
        return;
    }

    try {
        // Autenticar usuário
        const user = await authenticateUser(req);
        
        // Validar parâmetros
        const { tripId } = req.query;
        if (!tripId) {
            return res.status(400).json({
                success: false,
                error: 'tripId é obrigatório'
            });
        }

        // Conectar Redis
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({
                success: false,
                error: 'Redis não disponível'
            });
        }

        // Obter dados da viagem
        const tripData = await client.hGetAll(`trip:${tripId}`);
        
        if (!tripData || Object.keys(tripData).length === 0) {
            return res.json({
                success: true,
                data: null,
                message: 'Viagem não encontrada'
            });
        }

        // Obter histórico de localizações
        const pathKey = `trip_path:${tripId}`;
        const pathData = await client.lRange(pathKey, 0, 49); // Últimos 50 pontos
        const path = pathData.map(point => JSON.parse(point)).reverse();

        const responseData = {
            tripId: tripData.tripId,
            driverId: tripData.driverId,
            passengerId: tripData.passengerId,
            status: tripData.status,
            startTime: parseInt(tripData.startTime),
            startLocation: JSON.parse(tripData.startLocation),
            currentLocation: JSON.parse(tripData.currentLocation),
            endLocation: tripData.endLocation ? JSON.parse(tripData.endLocation) : null,
            endTime: tripData.endTime ? parseInt(tripData.endTime) : null,
            path: path,
            updatedAt: tripData.updatedAt
        };

        res.json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('❌ Erro ao obter dados da viagem:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API 8: Estatísticas do Redis
exports.get_redis_stats = onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).send();
        return;
    }

    try {
        // Autenticar usuário
        const user = await authenticateUser(req);
        
        // Conectar Redis
        const client = await initializeRedis();
        if (!client) {
            return res.status(500).json({
                success: false,
                error: 'Redis não disponível'
            });
        }

        // Obter estatísticas
        const stats = await client.info();
        const activeTrips = await client.sCard('active_trips');
        const completedTrips = await client.sCard('completed_trips');
        const onlineUsers = await client.sCard('users:online');

        res.json({
            success: true,
            data: {
                redisInfo: stats,
                activeTrips,
                completedTrips,
                onlineUsers,
                isConnected
            }
        });

    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
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