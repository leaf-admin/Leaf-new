const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const cors = require('cors');
require('dotenv').config();

// Firebase integration
const firebaseConfig = require('./firebase-config');

// Inicializar Firebase
firebaseConfig.initializeFirebase();

// Configurações
const PORT = process.env.PORT || 3001;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Inicializar Express
const app = express();
app.use(cors());
app.use(express.json());

// Criar servidor HTTP
const server = http.createServer(app);

// Configurar Socket.io
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// Cliente Redis (ioredis)
const redis = new Redis({
    host: 'localhost', // Docker Desktop expõe para localhost
    port: 6379,
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
    console.log('🔌 Cliente conectado:', socket.id);

    // Autenticação
    socket.on('authenticate', (data) => {
        userId = data.uid;
        socket.data.userId = userId;
        socket.emit('authenticated', { success: true, uid: userId });
        console.log('🔐 Usuário autenticado:', userId);
    });

    // Atualizar localização
    socket.on('updateLocation', async (data) => {
        if (!userId) return;
        const { lat, lng } = data;
        try {
            // Salvar apenas no Redis (sem sincronizar com Firebase)
            await redis.geoadd(GEO_KEY, lng, lat, userId);
            await redis.hset(STATUS_KEY, userId, JSON.stringify({
                status: 'available',
                lastUpdate: Date.now(),
                lat,
                lng,
            }));

            socket.emit('locationUpdated', { success: true, lat, lng });
        } catch (err) {
            socket.emit('locationUpdated', { success: false, error: err.message });
        }
    });

    // Buscar motoristas próximos
    socket.on('findNearbyDrivers', async (data) => {
        const { lat, lng, radius = 5000, limit = 10 } = data;
        try {
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
            const drivers = results.map(([uid, distance, [lng, lat]]) => ({
                uid,
                distance: parseFloat(distance),
                lat: parseFloat(lat),
                lng: parseFloat(lng),
            }));
            socket.emit('nearbyDrivers', { drivers });
        } catch (err) {
            socket.emit('nearbyDrivers', { drivers: [], error: err.message });
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
        const { tripId, tripData } = data;
        
        try {
            console.log('📊 Obtendo dados do Redis...');
            // Obter dados do Redis
            const driverInfo = await redis.hget(STATUS_KEY, userId);
            const driverData = driverInfo ? JSON.parse(driverInfo) : {};
            console.log('📊 Dados do motorista:', driverData);
            
            // Dados consolidados da viagem
            const consolidatedTripData = {
                tripId,
                driverId: userId,
                startTime: tripData.startTime,
                endTime: Date.now(),
                startLocation: tripData.startLocation,
                endLocation: tripData.endLocation,
                distance: tripData.distance,
                fare: tripData.fare,
                status: 'completed',
                completedAt: new Date().toISOString(),
                driverLocation: {
                    lat: driverData.lat,
                    lng: driverData.lng
                }
            };
            console.log('📊 Dados consolidados:', consolidatedTripData);

            // Sincronizar apenas dados consolidados com Firebase
            console.log('🔥 Sincronizando com Firebase...');
            try {
                await firebaseConfig.syncTripData(tripId, consolidatedTripData);
                console.log('✅ Dados de viagem consolidados sincronizados com Firebase');
                socket.emit('tripFinished', { success: true, tripId });
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
        if (!userId) return;
        const { tripId, reason } = data;
        
        try {
            const cancelData = {
                tripId,
                driverId: userId,
                status: 'cancelled',
                cancelledAt: new Date().toISOString(),
                reason: reason || 'driver_cancelled'
            };

            // Sincronizar apenas dados consolidados
            try {
                await firebaseConfig.syncTripData(tripId, cancelData);
                console.log('✅ Dados de cancelamento sincronizados com Firebase');
                socket.emit('tripCancelled', { success: true, tripId });
            } catch (firebaseError) {
                console.error('❌ Erro ao sincronizar cancelamento:', firebaseError.message);
                socket.emit('tripCancelled', { success: false, error: firebaseError.message });
            }

        } catch (err) {
            socket.emit('tripCancelled', { success: false, error: err.message });
        }
    });

    // Desconexão
    socket.on('disconnect', () => {
        console.log('🔌 Cliente desconectado:', socket.id, userId);
    });
});

// Inicializar servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor WebSocket rodando na porta ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log('✅ Pronto para receber conexões!');
});