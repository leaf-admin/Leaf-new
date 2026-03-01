const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// MÓDULOS OTIMIZADOS
const redisPool = require('./utils/redis-pool');
const firebaseBatch = require('./utils/firebase-batch');
const { rideQueue } = require('./utils/async-queue');

// Criar aplicação Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Configuração da porta
const PORT = process.env.PORT || 3001;
const INSTANCE_ID = process.env.INSTANCE_ID || 'main';
const CLUSTER_MODE = process.env.CLUSTER_MODE === 'true';

// Middleware básico
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());

// Firebase integration
const firebaseConfig = require('./firebase-config');

// FCM integration
const FCMService = require('./services/fcm-service');

// Chat integration
const ChatService = require('./services/chat-service');

// Promo integration
const PromoService = require('./services/promo-service');

// Driver approval integration
const DriverApprovalService = require('./services/driver-approval-service');

// Payment integration
const PaymentService = require('./services/payment-service');

// Sync integration
const SyncService = require('./services/sync-service');

// Dashboard integration
const DashboardWebSocketService = require('./services/dashboard-websocket');

// Metrics integration
const MetricsService = require('./services/metrics-service');

// Ride Service (OTIMIZADO)
const RideService = require('./services/ride-service');

// WAF Middleware
const wafMiddleware = require('./middleware/waf');
const { applyRateLimit } = require('./middleware/rateLimiter');
const HealthChecker = require('./utils/healthChecker');
const RedisTunnel = require('./utils/redisTunnel');

// Monitoramento (OPCIONAL - não falha se não existir)
let latencyMonitor = null;
let dockerMonitor = null;
let smartSyncAlertSystem = null;

try {
    const LatencyMonitor = require('./metrics/latency-monitor');
    latencyMonitor = new LatencyMonitor();
} catch (error) {
    console.warn('⚠️ LatencyMonitor não disponível:', error.message);
}

try {
    const DockerMonitor = require('./monitoring/docker-monitor');
    dockerMonitor = new DockerMonitor();
} catch (error) {
    console.warn('⚠️ DockerMonitor não disponível:', error.message);
}

try {
    const SmartSyncAlertSystem = require('./monitoring/smart-sync-alert-system');
    smartSyncAlertSystem = new SmartSyncAlertSystem();
} catch (error) {
    console.warn('⚠️ SmartSyncAlertSystem não disponível:', error.message);
}

// Instanciar sistemas essenciais
const healthChecker = new HealthChecker();
const redisTunnel = new RedisTunnel();

// Inicializar Firebase
firebaseConfig.initializeFirebase();

// Inicializar serviços
const fcmService = new FCMService();
const chatService = new ChatService();
const promoService = new PromoService();
const driverApprovalService = new DriverApprovalService();
const paymentService = new PaymentService();
const syncService = new SyncService();
const metricsService = new MetricsService();

// Inicializar Ride Service (OTIMIZADO)
const rideService = new RideService();

// Inicializar Ride Service com Socket.io
rideService.initialize(io);

// Inicializar FCM Service
fcmService.initialize().then(() => {
    console.log('✅ FCM Service inicializado e funcionando');
}).catch(error => {
    console.error('❌ Erro ao inicializar FCM Service:', error);
});

// Inicializar Dashboard WebSocket Service
const dashboardWS = new DashboardWebSocketService(io);
console.log('🎯 Dashboard WebSocket Service inicializado');

// Função para buscar socket ativo do usuário
async function getSocketByUserId(userId) {
    try {
        // Buscar socket ativo do usuário
        const userSocket = await redisPool.getConnection().then(redis => 
            redis.get(`user_socket:${userId}`)
        );
        if (userSocket) {
            const socketId = JSON.parse(userSocket);
            const socket = io.sockets.sockets.get(socketId);
            return socket;
        }
        return null;
    } catch (error) {
        console.error('Erro ao buscar socket do usuário:', error);
        return null;
    }
}

// Redis constants
const GEO_KEY = 'driver_locations';
const STATUS_KEY = 'driver_status';

// WebSocket connection handler
io.on('connection', async (socket) => {
    console.log(`🔌 Nova conexão WebSocket: ${socket.id}`);
    
    let userId = null;
    let userType = null;

    // Evento: Autenticar usuário
    socket.on('authenticate', async (data) => {
        try {
            const { token, userType: type } = data;
            
            // Aqui você implementaria a validação do token JWT
            // Por enquanto, vamos simular uma autenticação simples
            userId = `user_${Date.now()}`;
            userType = type || 'passenger';
            
            console.log(`✅ Usuário autenticado: ${userId} (${userType})`);
            socket.emit('authenticated', { success: true, userId, userType });
            
        } catch (error) {
            console.error('❌ Erro na autenticação:', error);
            socket.emit('authenticationError', { success: false, error: error.message });
        }
    });

    // Evento: Atualizar localização
    socket.on('updateLocation', async (data) => {
        try {
            const { lat, lng } = data;
            
            if (!userId) {
                socket.emit('locationError', { success: false, error: 'Usuário não autenticado' });
                return;
            }

            // Obter conexão Redis do pool
            const redis = await redisPool.getConnection();
            
            // 1. Salvar no Redis (primário - tempo real)
            await redis.geoadd(GEO_KEY, lng, lat, userId);
            
            await redis.hset(STATUS_KEY, userId, JSON.stringify({
                status: 'available',
                lastUpdate: Date.now(),
                lat,
                lng,
                isOnline: true
            }));
            
            // 2. Sincronizar com Firebase (assíncrono - background)
            try {
                await firebaseBatch.batchUpdate(`user_locations/${userId}`, {
                    lat,
                    lng,
                    lastUpdate: new Date().toISOString(),
                    isOnline: true
                });
            } catch (firebaseError) {
                console.warn('⚠️ Erro ao sincronizar com Firebase:', firebaseError.message);
                // Não falhar se Firebase estiver indisponível
            }
            
            socket.emit('locationUpdated', { success: true, lat, lng });
            
        } catch (err) {
            socket.emit('locationError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Buscar motoristas próximos
    socket.on('findNearbyDrivers', async (data) => {
        try {
            const { lat, lng, radius = 5000, limit = 10 } = data;
            
            // Obter conexão Redis do pool
            const redis = await redisPool.getConnection();
            
            // Verificar se há dados no Redis
            const totalDrivers = await redis.zcard(GEO_KEY);
            console.log(`📊 Total de motoristas no Redis: ${totalDrivers}`);
            
            if (totalDrivers === 0) {
                socket.emit('nearbyDrivers', { 
                    drivers: [], 
                    count: 0,
                    message: 'Nenhum motorista disponível'
                });
                return;
            }
            
            const results = await redis.georadius(
                GEO_KEY,
                lng,
                lat,
                radius,
                'm',
                'WITHCOORD',
                'WITHDIST',
                'COUNT',
                limit
            );
            
            const drivers = results.map(result => ({
                userId: result[0],
                distance: Math.round(result[1]),
                coordinates: {
                    lng: result[2][0],
                    lat: result[2][1]
                }
            }));
            
            socket.emit('nearbyDrivers', { 
                drivers, 
                count: drivers.length 
            });
            
        } catch (err) {
            console.error('❌ Erro ao buscar motoristas próximos:', err);
            socket.emit('nearbyDriversError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Atualizar status do motorista
    socket.on('updateDriverStatus', async (data) => {
        const { status, isOnline } = data;
        try {
            // Obter conexão Redis do pool
            const redis = await redisPool.getConnection();
            
            // Salvar apenas no Redis (sem sincronizar com Firebase)
            const prev = await redis.hget(STATUS_KEY, userId);
            let info = prev ? JSON.parse(prev) : {};
            info.status = status;
            info.isOnline = isOnline;
            info.lastUpdate = Date.now();
            await redis.hset(STATUS_KEY, userId, JSON.stringify(info));

            socket.emit('driverStatusUpdated', { success: true, status, isOnline });
        } catch (err) {
            console.error('❌ Erro ao atualizar status do motorista:', err);
            socket.emit('driverStatusError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Criar reserva
    socket.on('createBooking', async (data) => {
        try {
            const { pickup, destination, passengerId, passengerInfo } = data;
            
            if (!userId) {
                socket.emit('bookingError', { success: false, error: 'Usuário não autenticado' });
                return;
            }

            // Gerar ID único para a reserva
            const bookingId = `booking_${Date.now()}_${userId}`;
            
            const bookingData = {
                id: bookingId,
                passengerId: userId,
                passengerInfo,
                pickup,
                destination,
                status: 'pending',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Salvar no Redis
            const redis = await redisPool.getConnection();
            await redis.hset(`bookings:${bookingId}`, 'data', JSON.stringify(bookingData));
            
            // Salvar no Firebase (assíncrono)
            try {
                await firebaseBatch.batchCreate(`bookings/${bookingId}`, bookingData);
            } catch (firebaseError) {
                console.warn('⚠️ Erro ao salvar no Firebase:', firebaseError.message);
            }

            socket.emit('bookingCreated', { 
                success: true, 
                bookingId, 
                booking: bookingData 
            });

            // Enviar notificação FCM se disponível
            if (fcmService.isServiceAvailable()) {
                try {
                    await fcmService.sendNotificationToUsers([userId], {
                        title: 'Reserva Criada',
                        body: `Sua reserva foi criada com sucesso!`,
                        data: { type: 'booking_created', bookingId }
                    });
                } catch (fcmError) {
                    console.warn('⚠️ Erro ao enviar notificação FCM:', fcmError.message);
                }
            }

        } catch (err) {
            console.error('❌ Erro ao criar reserva:', err);
            socket.emit('bookingError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Obter estatísticas
    socket.on('getStats', async () => {
        try {
            const redis = await redisPool.getConnection();
            
            const totalDrivers = await redis.zcard(GEO_KEY);
            const totalBookings = await redis.keys('bookings:*').then(keys => keys.length);
            const onlineUsers = await redis.scard('online_users');
            
            const stats = {
                totalDrivers,
                totalBookings,
                onlineUsers,
                redisPoolStatus: redisPool.getStatus(),
                firebaseStatus: firebaseBatch.isReady() ? 'online' : 'offline',
                fcmStatus: fcmService.isServiceAvailable() ? 'online' : 'offline',
                timestamp: new Date().toISOString()
            };
            
            socket.emit('stats', { success: true, stats });
            
        } catch (err) {
            console.error('❌ Erro ao obter estatísticas:', err);
            socket.emit('statsError', { 
                success: false, 
                error: err.message 
            });
        }
    });

    // Salvar token FCM
    socket.on('saveFCMToken', async (data) => {
        try {
            const { fcmToken, deviceInfo } = data;
            
            if (fcmService.isServiceAvailable()) {
                await fcmService.saveUserFCMToken(userId, userType, fcmToken, deviceInfo);
                console.log(`✅ Token FCM salvo para usuário ${userId}`);
            } else {
                console.warn('⚠️ FCM Service não disponível');
            }
            
        } catch (error) {
            console.error('❌ Erro ao salvar token FCM:', error);
        }
    });

    // ===== HANDLERS DE CORRIDA =====
    
    // Handler para solicitação de corrida
    socket.on('request_ride', async (data) => {
        try {
            console.log('🚗 Solicitação de corrida recebida:', data);
            
            const { passengerId, pickupLocation, destinationLocation, rideType, estimatedFare, paymentMethod } = data;
            
            // Validar dados obrigatórios
            if (!passengerId || !pickupLocation || !destinationLocation) {
                socket.emit('ride_error', { 
                    success: false, 
                    error: 'Dados obrigatórios não fornecidos' 
                });
                return;
            }
            
            // Criar ID único para a corrida
            const rideId = `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Salvar dados da corrida no Redis
            const redis = await redisPool.getConnection();
            const rideData = {
                rideId,
                passengerId,
                pickupLocation,
                destinationLocation,
                rideType: rideType || 'standard',
                estimatedFare: estimatedFare || 0,
                paymentMethod: paymentMethod || 'pix',
                status: 'requested',
                createdAt: new Date().toISOString(),
                timestamp: Date.now()
            };
            
            await redis.hset('rides', rideId, JSON.stringify(rideData));
            await redis.expire('rides', 3600); // Expira em 1 hora
            
            // Emitir confirmação para o passageiro
            socket.emit('ride_requested', {
                success: true,
                rideId,
                message: 'Solicitação de corrida enviada com sucesso',
                estimatedWaitTime: '2-5 minutos'
            });
            
            // Simular busca por motorista (em produção, isso seria mais complexo)
            setTimeout(async () => {
                try {
                    // Simular motorista encontrado
                    const driverId = `driver_${Math.random().toString(36).substr(2, 9)}`;
                    const driverData = {
                        driverId,
                        name: 'João Silva',
                        rating: 4.8,
                        vehicle: {
                            model: 'Honda Civic',
                            color: 'Branco',
                            plate: 'ABC-1234'
                        },
                        location: {
                            latitude: pickupLocation.latitude + (Math.random() - 0.5) * 0.01,
                            longitude: pickupLocation.longitude + (Math.random() - 0.5) * 0.01
                        },
                        estimatedArrival: '3-5 minutos',
                        fare: estimatedFare
                    };
                    
                    // Salvar dados do motorista
                    await redis.hset('drivers', driverId, JSON.stringify(driverData));
                    
                    // Emitir motorista encontrado
                    socket.emit('driver_found', {
                        success: true,
                        rideId,
                        driver: driverData,
                        message: 'Motorista encontrado!'
                    });
                    
                    console.log('✅ Motorista simulado encontrado para corrida:', rideId);
                    
                } catch (error) {
                    console.error('❌ Erro ao simular motorista:', error);
                }
            }, 3000); // 3 segundos de simulação
            
            console.log('✅ Solicitação de corrida processada:', rideId);
            
        } catch (error) {
            console.error('❌ Erro ao processar solicitação de corrida:', error);
            socket.emit('ride_error', { 
                success: false, 
                error: 'Erro interno do servidor' 
            });
        }
    });
    
    // Handler para processamento de pagamento
    socket.on('processPayment', async (data) => {
        try {
            console.log('💳 Processamento de pagamento recebido:', data);
            
            const { rideId, amount, paymentMethod, passengerId } = data;
            
            if (!rideId || !amount || !paymentMethod) {
                socket.emit('payment_error', { 
                    success: false, 
                    error: 'Dados de pagamento inválidos' 
                });
                return;
            }
            
            // Simular processamento de pagamento
            const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const paymentData = {
                paymentId,
                rideId,
                amount,
                paymentMethod,
                passengerId,
                status: 'processing',
                createdAt: new Date().toISOString()
            };
            
            // Salvar no Redis
            const redis = await redisPool.getConnection();
            await redis.hset('payments', paymentId, JSON.stringify(paymentData));
            
            // Simular confirmação de pagamento
            setTimeout(() => {
                socket.emit('confirmPayment', {
                    success: true,
                    paymentId,
                    rideId,
                    amount,
                    status: 'confirmed',
                    message: 'Pagamento processado com sucesso'
                });
                
                console.log('✅ Pagamento simulado confirmado:', paymentId);
            }, 2000);
            
            console.log('✅ Processamento de pagamento iniciado:', paymentId);
            
        } catch (error) {
            console.error('❌ Erro ao processar pagamento:', error);
            socket.emit('payment_error', { 
                success: false, 
                error: 'Erro ao processar pagamento' 
            });
        }
    });
    
    // Handler para confirmação de pagamento
    socket.on('confirmPayment', async (data) => {
        try {
            console.log('✅ Confirmação de pagamento recebida:', data);
            
            const { paymentId, rideId } = data;
            
            if (!paymentId || !rideId) {
                socket.emit('payment_error', { 
                    success: false, 
                    error: 'IDs de pagamento/corrida inválidos' 
                });
                return;
            }
            
            // Atualizar status do pagamento
            const redis = await redisPool.getConnection();
            const paymentData = await redis.hget('payments', paymentId);
            
            if (paymentData) {
                const payment = JSON.parse(paymentData);
                payment.status = 'confirmed';
                payment.confirmedAt = new Date().toISOString();
                
                await redis.hset('payments', paymentId, JSON.stringify(payment));
                
                // Atualizar status da corrida
                const rideData = await redis.hget('rides', rideId);
                if (rideData) {
                    const ride = JSON.parse(rideData);
                    ride.status = 'confirmed';
                    ride.paymentConfirmed = true;
                    ride.paymentId = paymentId;
                    
                    await redis.hset('rides', rideId, JSON.stringify(ride));
                }
                
                socket.emit('payment_confirmed', {
                    success: true,
                    paymentId,
                    rideId,
                    message: 'Pagamento confirmado com sucesso'
                });
                
                console.log('✅ Pagamento confirmado:', paymentId);
            } else {
                socket.emit('payment_error', { 
                    success: false, 
                    error: 'Pagamento não encontrado' 
                });
            }
            
        } catch (error) {
            console.error('❌ Erro ao confirmar pagamento:', error);
            socket.emit('payment_error', { 
                success: false, 
                error: 'Erro ao confirmar pagamento' 
            });
        }
    });
    
    // Handler para criação de reserva
    socket.on('createBooking', async (data) => {
        try {
            console.log('📅 Criação de reserva recebida:', data);
            
            const { rideId, driverId, passengerId } = data;
            
            if (!rideId || !driverId || !passengerId) {
                socket.emit('booking_error', { 
                    success: false, 
                    error: 'Dados de reserva inválidos' 
                });
                return;
            }
            
            // Criar reserva
            const bookingId = `book_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const bookingData = {
                bookingId,
                rideId,
                driverId,
                passengerId,
                status: 'active',
                createdAt: new Date().toISOString()
            };
            
            // Salvar no Redis
            const redis = await redisPool.getConnection();
            await redis.hset('bookings', bookingId, JSON.stringify(bookingData));
            
            socket.emit('booking_created', {
                success: true,
                bookingId,
                rideId,
                driverId,
                message: 'Reserva criada com sucesso'
            });
            
            console.log('✅ Reserva criada:', bookingId);
            
        } catch (error) {
            console.error('❌ Erro ao criar reserva:', error);
            socket.emit('booking_error', { 
                success: false, 
                error: 'Erro ao criar reserva' 
            });
        }
    });
    
    // Handler para resposta do motorista
    socket.on('driverResponse', async (data) => {
        try {
            console.log('👨‍💼 Resposta do motorista recebida:', data);
            
            const { rideId, driverId, response, message } = data;
            
            if (!rideId || !driverId || !response) {
                socket.emit('driver_response_error', { 
                    success: false, 
                    error: 'Dados de resposta inválidos' 
                });
                return;
            }
            
            // Atualizar status da corrida
            const redis = await redisPool.getConnection();
            const rideData = await redis.hget('rides', rideId);
            
            if (rideData) {
                const ride = JSON.parse(rideData);
                ride.driverResponse = response;
                ride.driverMessage = message || '';
                ride.status = response === 'accepted' ? 'accepted' : 'rejected';
                
                await redis.hset('rides', rideId, JSON.stringify(ride));
                
                socket.emit('driver_response_received', {
                    success: true,
                    rideId,
                    driverId,
                    response,
                    message: 'Resposta do motorista processada'
                });
                
                console.log('✅ Resposta do motorista processada:', rideId);
            } else {
                socket.emit('driver_response_error', { 
                    success: false, 
                    error: 'Corrida não encontrada' 
                });
            }
            
        } catch (error) {
            console.error('❌ Erro ao processar resposta do motorista:', error);
            socket.emit('driver_response_error', { 
                success: false, 
                error: 'Erro ao processar resposta' 
            });
        }
    });
    
    // Handler para início da viagem
    socket.on('startTrip', async (data) => {
        try {
            console.log('🚀 Início da viagem recebido:', data);
            
            const { rideId, driverId } = data;
            
            if (!rideId || !driverId) {
                socket.emit('trip_error', { 
                    success: false, 
                    error: 'Dados de viagem inválidos' 
                });
                return;
            }
            
            // Atualizar status da corrida
            const redis = await redisPool.getConnection();
            const rideData = await redis.hget('rides', rideId);
            
            if (rideData) {
                const ride = JSON.parse(rideData);
                ride.status = 'in_progress';
                ride.startedAt = new Date().toISOString();
                ride.driverId = driverId;
                
                await redis.hset('rides', rideId, JSON.stringify(ride));
                
                socket.emit('trip_started', {
                    success: true,
                    rideId,
                    driverId,
                    message: 'Viagem iniciada com sucesso'
                });
                
                console.log('✅ Viagem iniciada:', rideId);
            } else {
                socket.emit('trip_error', { 
                    success: false, 
                    error: 'Corrida não encontrada' 
                });
            }
            
        } catch (error) {
            console.error('❌ Erro ao iniciar viagem:', error);
            socket.emit('trip_error', { 
                success: false, 
                error: 'Erro ao iniciar viagem' 
            });
        }
    });
    
    // Handler para atualização de localização do motorista
    socket.on('updateDriverLocation', async (data) => {
        try {
            const { driverId, latitude, longitude } = data;
            
            if (!driverId || !latitude || !longitude) {
                socket.emit('location_error', { 
                    success: false, 
                    error: 'Dados de localização inválidos' 
                });
                return;
            }
            
            // Atualizar localização do motorista
            const redis = await redisPool.getConnection();
            const driverData = await redis.hget('drivers', driverId);
            
            if (driverData) {
                const driver = JSON.parse(driverData);
                driver.location = { latitude, longitude };
                driver.lastUpdate = new Date().toISOString();
                
                await redis.hset('drivers', driverId, JSON.stringify(driver));
                
                socket.emit('location_updated', {
                    success: true,
                    driverId,
                    location: { latitude, longitude }
                });
                
                console.log('✅ Localização do motorista atualizada:', driverId);
            }
            
        } catch (error) {
            console.error('❌ Erro ao atualizar localização:', error);
            socket.emit('location_error', { 
                success: false, 
                error: 'Erro ao atualizar localização' 
            });
        }
    });
    
    // Handler para conclusão da viagem
    socket.on('completeTrip', async (data) => {
        try {
            console.log('🏁 Conclusão da viagem recebida:', data);
            
            const { rideId, driverId, finalFare, rating } = data;
            
            if (!rideId || !driverId) {
                socket.emit('trip_error', { 
                    success: false, 
                    error: 'Dados de conclusão inválidos' 
                });
                return;
            }
            
            // Atualizar status da corrida
            const redis = await redisPool.getConnection();
            const rideData = await redis.hget('rides', rideId);
            
            if (rideData) {
                const ride = JSON.parse(rideData);
                ride.status = 'completed';
                ride.completedAt = new Date().toISOString();
                ride.finalFare = finalFare || ride.estimatedFare;
                ride.rating = rating || null;
                
                await redis.hset('rides', rideId, JSON.stringify(ride));
                
                socket.emit('trip_completed', {
                    success: true,
                    rideId,
                    driverId,
                    finalFare: ride.finalFare,
                    message: 'Viagem concluída com sucesso'
                });
                
                console.log('✅ Viagem concluída:', rideId);
            } else {
                socket.emit('trip_error', { 
                    success: false, 
                    error: 'Corrida não encontrada' 
                });
            }
            
        } catch (error) {
            console.error('❌ Erro ao concluir viagem:', error);
            socket.emit('trip_error', { 
                success: false, 
                error: 'Erro ao concluir viagem' 
            });
        }
    });
    
    // Handler para envio de avaliação
    socket.on('submitRating', async (data) => {
        try {
            console.log('⭐ Avaliação recebida:', data);
            
            const { rideId, rating, comment, userId } = data;
            
            if (!rideId || !rating || !userId) {
                socket.emit('rating_error', { 
                    success: false, 
                    error: 'Dados de avaliação inválidos' 
                });
                return;
            }
            
            // Salvar avaliação
            const ratingId = `rating_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const ratingData = {
                ratingId,
                rideId,
                userId,
                rating,
                comment: comment || '',
                createdAt: new Date().toISOString()
            };
            
            // Salvar no Redis
            const redis = await redisPool.getConnection();
            await redis.hset('ratings', ratingId, JSON.stringify(ratingData));
            
            socket.emit('rating_submitted', {
                success: true,
                ratingId,
                rideId,
                rating,
                message: 'Avaliação enviada com sucesso'
            });
            
            console.log('✅ Avaliação enviada:', ratingId);
            
        } catch (error) {
            console.error('❌ Erro ao enviar avaliação:', error);
            socket.emit('rating_error', { 
                success: false, 
                error: 'Erro ao enviar avaliação' 
            });
        }
    });
    
    // ===== HANDLERS DE CHAT =====
    
    // Handler para criação de chat
    socket.on('create_chat', async (data) => {
        try {
            console.log('💬 Criação de chat recebida:', data);
            
            const { rideId, participants } = data;
            
            if (!rideId || !participants || !Array.isArray(participants)) {
                socket.emit('chat_error', { 
                    success: false, 
                    error: 'Dados de chat inválidos' 
                });
                return;
            }
            
            // Criar chat
            const chatId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const chatData = {
                chatId,
                rideId,
                participants,
                createdAt: new Date().toISOString(),
                lastMessage: null
            };
            
            // Salvar no Redis
            const redis = await redisPool.getConnection();
            await redis.hset('chats', chatId, JSON.stringify(chatData));
            
            socket.emit('chat_created', {
                success: true,
                chatId,
                rideId,
                participants,
                message: 'Chat criado com sucesso'
            });
            
            console.log('✅ Chat criado:', chatId);
            
        } catch (error) {
            console.error('❌ Erro ao criar chat:', error);
            socket.emit('chat_error', { 
                success: false, 
                error: 'Erro ao criar chat' 
            });
        }
    });
    
    // Handler para envio de mensagem
    socket.on('send_message', async (data) => {
        try {
            console.log('📨 Mensagem recebida:', data);
            
            const { chatId, message, senderId, senderName } = data;
            
            if (!chatId || !message || !senderId) {
                socket.emit('message_error', { 
                    success: false, 
                    error: 'Dados de mensagem inválidos' 
                });
                return;
            }
            
            // Criar mensagem
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const messageData = {
                messageId,
                chatId,
                senderId,
                senderName: senderName || 'Usuário',
                message,
                timestamp: Date.now(),
                createdAt: new Date().toISOString(),
                read: false
            };
            
            // Salvar no Redis
            const redis = await redisPool.getConnection();
            await redis.hset('messages', messageId, JSON.stringify(messageData));
            
            // Atualizar último mensagem do chat
            await redis.hset('chats', chatId, 'lastMessage', JSON.stringify(messageData));
            
            socket.emit('message_sent', {
                success: true,
                messageId,
                chatId,
                message,
                message: 'Mensagem enviada com sucesso'
            });
            
            console.log('✅ Mensagem enviada:', messageId);
            
        } catch (error) {
            console.error('❌ Erro ao enviar mensagem:', error);
            socket.emit('message_error', { 
                success: false, 
                error: 'Erro ao enviar mensagem' 
            });
        }
    });
    
    // Handler para carregar mensagens
    socket.on('load_messages', async (data) => {
        try {
            console.log('📚 Carregamento de mensagens recebido:', data);
            
            const { chatId, limit = 50, offset = 0 } = data;
            
            if (!chatId) {
                socket.emit('messages_error', { 
                    success: false, 
                    error: 'ID do chat inválido' 
                });
                return;
            }
            
            // Buscar mensagens
            const redis = await redisPool.getConnection();
            const messages = await redis.hgetall('messages');
            
            // Filtrar mensagens do chat e ordenar por timestamp
            const chatMessages = Object.values(messages)
                .map(msg => JSON.parse(msg))
                .filter(msg => msg.chatId === chatId)
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(offset, offset + limit);
            
            socket.emit('messages_loaded', {
                success: true,
                chatId,
                messages: chatMessages,
                total: chatMessages.length
            });
            
            console.log('✅ Mensagens carregadas:', chatMessages.length);
            
        } catch (error) {
            console.error('❌ Erro ao carregar mensagens:', error);
            socket.emit('messages_error', { 
                success: false, 
                error: 'Erro ao carregar mensagens' 
            });
        }
    });
    
    // Handler para marcar mensagens como lidas
    socket.on('mark_messages_read', async (data) => {
        try {
            console.log('👁️ Marcar mensagens como lidas recebido:', data);
            
            const { chatId, messageIds, userId } = data;
            
            if (!chatId || !messageIds || !Array.isArray(messageIds)) {
                socket.emit('read_error', { 
                    success: false, 
                    error: 'Dados de leitura inválidos' 
                });
                return;
            }
            
            // Marcar mensagens como lidas
            const redis = await redisPool.getConnection();
            for (const messageId of messageIds) {
                const messageData = await redis.hget('messages', messageId);
                if (messageData) {
                    const message = JSON.parse(messageData);
                    message.read = true;
                    message.readBy = userId;
                    message.readAt = new Date().toISOString();
                    
                    await redis.hset('messages', messageId, JSON.stringify(message));
                }
            }
            
            socket.emit('messages_marked_read', {
                success: true,
                chatId,
                messageIds,
                message: 'Mensagens marcadas como lidas'
            });
            
            console.log('✅ Mensagens marcadas como lidas:', messageIds.length);
            
        } catch (error) {
            console.error('❌ Erro ao marcar mensagens como lidas:', error);
            socket.emit('read_error', { 
                success: false, 
                error: 'Erro ao marcar mensagens como lidas' 
            });
        }
    });
    
    // Handler para status de digitação
    socket.on('setTypingStatus', async (data) => {
        try {
            const { chatId, userId, isTyping } = data;
            
            if (!chatId || !userId) {
                socket.emit('typing_error', { 
                    success: false, 
                    error: 'Dados de digitação inválidos' 
                });
                return;
            }
            
            // Emitir status de digitação para outros usuários do chat
            socket.to(chatId).emit('typing_status', {
                chatId,
                userId,
                isTyping,
                timestamp: Date.now()
            });
            
            console.log('✅ Status de digitação atualizado:', { chatId, userId, isTyping });
            
        } catch (error) {
            console.error('❌ Erro ao atualizar status de digitação:', error);
            socket.emit('typing_error', { 
                success: false, 
                error: 'Erro ao atualizar status de digitação' 
            });
        }
    });
    
    // Handler para obter chats do usuário
    socket.on('get_user_chats', async (data) => {
        try {
            console.log('💬 Obter chats do usuário recebido:', data);
            
            const { userId } = data;
            
            if (!userId) {
                socket.emit('chats_error', { 
                    success: false, 
                    error: 'ID do usuário inválido' 
                });
                return;
            }
            
            // Buscar chats do usuário
            const redis = await redisPool.getConnection();
            const chats = await redis.hgetall('chats');
            
            // Filtrar chats do usuário
            const userChats = Object.values(chats)
                .map(chat => JSON.parse(chat))
                .filter(chat => chat.participants.includes(userId));
            
            socket.emit('user_chats_loaded', {
                success: true,
                userId,
                chats: userChats,
                total: userChats.length
            });
            
            console.log('✅ Chats do usuário carregados:', userChats.length);
            
        } catch (error) {
            console.error('❌ Erro ao carregar chats do usuário:', error);
            socket.emit('chats_error', { 
                success: false, 
                error: 'Erro ao carregar chats' 
            });
        }
    });
    
    // ===== HANDLERS DE PROMOÇÕES =====
    
    // Handler para obter promoções
    socket.on('get_promos', async (data) => {
        try {
            console.log('🎁 Obter promoções recebido:', data);
            
            const { userId, limit = 10 } = data;
            
            // Buscar promoções ativas
            const redis = await redisPool.getConnection();
            const promos = await redis.hgetall('promos');
            
            // Filtrar promoções ativas
            const activePromos = Object.values(promos)
                .map(promo => JSON.parse(promo))
                .filter(promo => promo.isActive && new Date(promo.expiresAt) > new Date())
                .slice(0, limit);
            
            socket.emit('promos_loaded', {
                success: true,
                userId,
                promos: activePromos,
                total: activePromos.length
            });
            
            console.log('✅ Promoções carregadas:', activePromos.length);
            
        } catch (error) {
            console.error('❌ Erro ao carregar promoções:', error);
            socket.emit('promos_error', { 
                success: false, 
                error: 'Erro ao carregar promoções' 
            });
        }
    });
    
    // Handler para obter promoções do usuário
    socket.on('getUserPromos', async (data) => {
        try {
            console.log('🎁 Obter promoções do usuário recebido:', data);
            
            const { userId } = data;
            
            if (!userId) {
                socket.emit('user_promos_error', { 
                    success: false, 
                    error: 'ID do usuário inválido' 
                });
                return;
            }
            
            // Buscar promoções do usuário
            const redis = await redisPool.getConnection();
            const userPromos = await redis.hgetall(`user_promos:${userId}`);
            
            const promos = Object.values(userPromos)
                .map(promo => JSON.parse(promo))
                .filter(promo => promo.isActive);
            
            socket.emit('user_promos_loaded', {
                success: true,
                userId,
                promos,
                total: promos.length
            });
            
            console.log('✅ Promoções do usuário carregadas:', promos.length);
            
        } catch (error) {
            console.error('❌ Erro ao carregar promoções do usuário:', error);
            socket.emit('user_promos_error', { 
                success: false, 
                error: 'Erro ao carregar promoções do usuário' 
            });
        }
    });
    
    // Handler para validar código de promoção
    socket.on('validate_promo_code', async (data) => {
        try {
            console.log('🔍 Validação de código de promoção recebida:', data);
            
            const { code, userId } = data;
            
            if (!code || !userId) {
                socket.emit('promo_validation_error', { 
                    success: false, 
                    error: 'Código ou ID do usuário inválido' 
                });
                return;
            }
            
            // Buscar promoção por código
            const redis = await redisPool.getConnection();
            const promos = await redis.hgetall('promos');
            
            const promo = Object.values(promos)
                .map(p => JSON.parse(p))
                .find(p => p.code === code && p.isActive);
            
            if (promo) {
                // Verificar se o usuário já usou esta promoção
                const userPromo = await redis.hget(`user_promos:${userId}`, promo.promoId);
                
                if (userPromo) {
                    socket.emit('promo_validation_error', { 
                        success: false, 
                        error: 'Você já usou esta promoção' 
                    });
                    return;
                }
                
                socket.emit('promo_validated', {
                    success: true,
                    promo,
                    message: 'Código de promoção válido'
                });
                
                console.log('✅ Código de promoção validado:', code);
            } else {
                socket.emit('promo_validation_error', { 
                    success: false, 
                    error: 'Código de promoção inválido ou expirado' 
                });
            }
            
        } catch (error) {
            console.error('❌ Erro ao validar código de promoção:', error);
            socket.emit('promo_validation_error', { 
                success: false, 
                error: 'Erro ao validar código de promoção' 
            });
        }
    });
    
    // Handler para aplicar promoção
    socket.on('apply_promo', async (data) => {
        try {
            console.log('🎁 Aplicar promoção recebida:', data);
            
            const { promoId, userId, rideId } = data;
            
            if (!promoId || !userId || !rideId) {
                socket.emit('promo_apply_error', { 
                    success: false, 
                    error: 'Dados de promoção inválidos' 
                });
                return;
            }
            
            // Buscar promoção
            const redis = await redisPool.getConnection();
            const promoData = await redis.hget('promos', promoId);
            
            if (promoData) {
                const promo = JSON.parse(promoData);
                
                // Verificar se o usuário já usou esta promoção
                const userPromo = await redis.hget(`user_promos:${userId}`, promoId);
                
                if (userPromo) {
                    socket.emit('promo_apply_error', { 
                        success: false, 
                        error: 'Você já usou esta promoção' 
                    });
                    return;
                }
                
                // Aplicar promoção
                const userPromoData = {
                    promoId,
                    userId,
                    rideId,
                    appliedAt: new Date().toISOString(),
                    isActive: true
                };
                
                await redis.hset(`user_promos:${userId}`, promoId, JSON.stringify(userPromoData));
                
                socket.emit('promo_applied', {
                    success: true,
                    promoId,
                    userId,
                    rideId,
                    discount: promo.discount,
                    message: 'Promoção aplicada com sucesso'
                });
                
                console.log('✅ Promoção aplicada:', promoId);
            } else {
                socket.emit('promo_apply_error', { 
                    success: false, 
                    error: 'Promoção não encontrada' 
                });
            }
            
        } catch (error) {
            console.error('❌ Erro ao aplicar promoção:', error);
            socket.emit('promo_apply_error', { 
                success: false, 
                error: 'Erro ao aplicar promoção' 
            });
        }
    });
    
    // Handler para obter promoção por código
    socket.on('get_promo_by_code', async (data) => {
        try {
            console.log('🔍 Obter promoção por código recebida:', data);
            
            const { code } = data;
            
            if (!code) {
                socket.emit('promo_code_error', { 
                    success: false, 
                    error: 'Código inválido' 
                });
                return;
            }
            
            // Buscar promoção por código
            const redis = await redisPool.getConnection();
            const promos = await redis.hgetall('promos');
            
            const promo = Object.values(promos)
                .map(p => JSON.parse(p))
                .find(p => p.code === code && p.isActive);
            
            if (promo) {
                socket.emit('promo_code_loaded', {
                    success: true,
                    promo,
                    message: 'Promoção encontrada'
                });
                
                console.log('✅ Promoção encontrada por código:', code);
            } else {
                socket.emit('promo_code_error', { 
                    success: false, 
                    error: 'Promoção não encontrada' 
                });
            }
            
        } catch (error) {
            console.error('❌ Erro ao buscar promoção por código:', error);
            socket.emit('promo_code_error', { 
                success: false, 
                error: 'Erro ao buscar promoção' 
            });
        }
    });
    
    // ===== HANDLERS DE AVALIAÇÕES =====
    
    // Handler para obter avaliações do usuário
    socket.on('getUserRatings', async (data) => {
        try {
            console.log('⭐ Obter avaliações do usuário recebido:', data);
            
            const { userId, limit = 20 } = data;
            
            if (!userId) {
                socket.emit('ratings_error', { 
                    success: false, 
                    error: 'ID do usuário inválido' 
                });
                return;
            }
            
            // Buscar avaliações do usuário
            const redis = await redisPool.getConnection();
            const ratings = await redis.hgetall('ratings');
            
            const userRatings = Object.values(ratings)
                .map(rating => JSON.parse(rating))
                .filter(rating => rating.userId === userId)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, limit);
            
            socket.emit('user_ratings_loaded', {
                success: true,
                userId,
                ratings: userRatings,
                total: userRatings.length
            });
            
            console.log('✅ Avaliações do usuário carregadas:', userRatings.length);
            
        } catch (error) {
            console.error('❌ Erro ao carregar avaliações do usuário:', error);
            socket.emit('ratings_error', { 
                success: false, 
                error: 'Erro ao carregar avaliações' 
            });
        }
    });
    
    // Handler para obter avaliações da viagem
    socket.on('getTripRatings', async (data) => {
        try {
            console.log('⭐ Obter avaliações da viagem recebido:', data);
            
            const { rideId, limit = 20 } = data;
            
            if (!rideId) {
                socket.emit('trip_ratings_error', { 
                    success: false, 
                    error: 'ID da viagem inválido' 
                });
                return;
            }
            
            // Buscar avaliações da viagem
            const redis = await redisPool.getConnection();
            const ratings = await redis.hgetall('ratings');
            
            const tripRatings = Object.values(ratings)
                .map(rating => JSON.parse(rating))
                .filter(rating => rating.rideId === rideId)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, limit);
            
            socket.emit('trip_ratings_loaded', {
                success: true,
                rideId,
                ratings: tripRatings,
                total: tripRatings.length
            });
            
            console.log('✅ Avaliações da viagem carregadas:', tripRatings.length);
            
        } catch (error) {
            console.error('❌ Erro ao carregar avaliações da viagem:', error);
            socket.emit('trip_ratings_error', { 
                success: false, 
                error: 'Erro ao carregar avaliações da viagem' 
            });
        }
    });
    
    // Handler para verificar avaliação do usuário
    socket.on('checkUserRating', async (data) => {
        try {
            console.log('🔍 Verificar avaliação do usuário recebido:', data);
            
            const { userId, rideId } = data;
            
            if (!userId || !rideId) {
                socket.emit('rating_check_error', { 
                    success: false, 
                    error: 'Dados de verificação inválidos' 
                });
                return;
            }
            
            // Buscar avaliação específica
            const redis = await redisPool.getConnection();
            const ratings = await redis.hgetall('ratings');
            
            const userRating = Object.values(ratings)
                .map(rating => JSON.parse(rating))
                .find(rating => rating.userId === userId && rating.rideId === rideId);
            
            socket.emit('user_rating_checked', {
                success: true,
                userId,
                rideId,
                hasRated: !!userRating,
                rating: userRating || null
            });
            
            console.log('✅ Avaliação do usuário verificada:', { userId, rideId, hasRated: !!userRating });
            
        } catch (error) {
            console.error('❌ Erro ao verificar avaliação do usuário:', error);
            socket.emit('rating_check_error', { 
                success: false, 
                error: 'Erro ao verificar avaliação' 
            });
        }
    });

    // Desconexão
    socket.on('disconnect', async () => {
        console.log(`🔌 Desconexão WebSocket: ${socket.id}`);
        
        if (userId) {
            try {
                // Marcar usuário como offline
                const redis = await redisPool.getConnection();
                await redis.srem('online_users', userId);
                
                // Atualizar status
                const currentStatus = await redis.hget(STATUS_KEY, userId);
                if (currentStatus) {
                    const statusData = JSON.parse(currentStatus);
                    statusData.isOnline = false;
                    statusData.lastUpdate = Date.now();
                    await redis.hset(STATUS_KEY, userId, JSON.stringify(statusData));
                }
                
                console.log(`✅ Usuário ${userId} marcado como offline`);
            } catch (error) {
                console.error('❌ Erro ao marcar usuário como offline:', error);
            }
        }
    });
});

// Dashboard Routes
const dashboardRoutes = require('./routes/dashboard');
app.use('/', dashboardRoutes);

// Driver approval routes
const driverRoutes = require('./routes/drivers');
app.use('/', driverRoutes);

// Auth routes
const { router: authRoutes } = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Support routes
const supportRoutes = require('./routes/support');
app.use('/api/support', supportRoutes);

// Admin users routes
const adminUsersRoutes = require('./routes/admin-users');
app.use('/api/admin', adminUsersRoutes);

// Wait list routes
const waitListRoutes = require('./routes/waitlist');
app.use('/api', waitListRoutes);

// Woovi routes
const wooviRoutes = require('./routes/woovi');
app.use('/api', wooviRoutes);

// Woovi Driver routes
const wooviDriverRoutes = require('./routes/woovi-driver');
app.use('/api', wooviDriverRoutes);

// Driver Approval routes
const driverApprovalRoutes = require('./routes/driver-approval');
app.use('/api', driverApprovalRoutes);

// Payment routes
const paymentRoutes = require('./routes/payment');
app.use('/api/payment', paymentRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        instance: INSTANCE_ID,
        clusterMode: CLUSTER_MODE,
        redisPool: redisPool.getPoolStats(),
        firebase: firebaseBatch.isReady() ? 'online' : 'offline',
        fcm: fcmService.isServiceAvailable() ? 'online' : 'offline'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Leaf WebSocket Backend - Versão Simplificada',
        version: '2.0.0',
        instance: INSTANCE_ID,
        timestamp: new Date().toISOString(),
        status: 'running'
    });
});

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`🚀 Leaf WebSocket Backend rodando na porta ${PORT}`);
    console.log(`📊 Instance ID: ${INSTANCE_ID}`);
    console.log(`🔄 Cluster Mode: ${CLUSTER_MODE}`);
    console.log(`🔗 Redis Pool: ${JSON.stringify(redisPool.getPoolStats())}`);
    console.log(`🔥 Firebase Batch: ${firebaseBatch.isReady() ? 'online' : 'offline'}`);
    console.log(`📱 FCM Service: ${fcmService.isServiceAvailable() ? 'online' : 'offline'}`);
    
    // Inicializar sistemas de monitoramento se disponíveis
    if (latencyMonitor) {
        latencyMonitor.start();
        console.log('📊 LatencyMonitor iniciado');
    }
    
    if (dockerMonitor) {
        dockerMonitor.start();
        console.log('🐳 DockerMonitor iniciado');
    }
    
    if (smartSyncAlertSystem) {
        smartSyncAlertSystem.start();
        console.log('🔄 SmartSyncAlertSystem iniciado');
    }
    
    if (healthChecker) {
        healthChecker.start();
        console.log('❤️ HealthChecker iniciado');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Recebido SIGTERM, iniciando shutdown graceful...');
    server.close(() => {
        console.log('✅ Servidor fechado');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Recebido SIGINT, iniciando shutdown graceful...');
    server.close(() => {
        console.log('✅ Servidor fechado');
        process.exit(0);
    });
});

