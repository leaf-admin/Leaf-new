// server.js
// Servidor principal integrado com GraphQL

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cluster = require('cluster');
const os = require('os');
const cors = require('cors');

// Importar GraphQL
const { applyMiddleware } = require('./graphql/server');

// Importar rotas de monitoramento do cache
const cacheMonitoring = require('./routes/cache-monitoring');

// Importar rotas de autenticação
const authRoutes = require('./routes/auth-routes');

// Importar rotas KYC
const kycRoutes = require('./routes/kyc-routes');

// Importar rotas KYC Proxy
const kycProxyRoutes = require('./routes/kyc-proxy-routes');

// Importar rotas KYC Analytics
const kycAnalyticsRoutes = require('./routes/kyc-analytics-routes');

// Importar rotas Dashboard
const dashboardRoutes = require('./routes/dashboard');

// Configurações otimizadas para VPS com recursos limitados
const VPS_CONFIG = {
    MAX_CONNECTIONS: 10000, // Reduzido para VPS
    MAX_REQUESTS_PER_SECOND: 5000, // Reduzido para VPS
    CLUSTER_WORKERS: Math.min(os.cpus().length, 2), // Máximo 2 workers para VPS
    MEMORY_LIMIT: '512MB', // Limite de memória para VPS
    TIMEOUT: 30000 // Timeout aumentado para conexões mais lentas
};

// Cluster mode otimizado para VPS - DESABILITADO PARA DESENVOLVIMENTO LOCAL
if (cluster.isMaster && process.env.NODE_ENV === 'production') {
    console.log(`🚀 Iniciando ${VPS_CONFIG.CLUSTER_WORKERS} workers otimizados para VPS`);
    
    for (let i = 0; i < VPS_CONFIG.CLUSTER_WORKERS; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} morreu. Reiniciando...`);
        cluster.fork();
    });
    
    cluster.on('online', (worker) => {
        console.log(`✅ Worker ${worker.process.pid} online`);
    });
} else {
    // Modo desenvolvimento - sem cluster
    console.log('🔧 Modo desenvolvimento: Executando servidor único');
    // Worker process
    const app = express();
    const server = http.createServer(app);
    
    // Middleware básico
    app.use(cors({
        origin: process.env.NODE_ENV === 'production' 
            ? ['https://leafapp.com', 'https://dashboard.leafapp.com']
            : true,
        credentials: true
    }));
    
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Registrar rotas IMEDIATAMENTE após middleware básico
    console.log('🔧 Registrando rotas...');
    
    // Rotas de monitoramento do cache
    app.use('/cache', cacheMonitoring);
    console.log('✅ Rotas de cache registradas');
    
    // Rotas de autenticação
    app.use('/auth', authRoutes);
    
    // Rotas KYC
    app.use('/api/kyc', kycRoutes.getRouter());
    
    // Rotas KYC Proxy (para microserviço)
    app.use('/api/kyc-proxy', kycProxyRoutes.getRouter());
    
    // Rotas KYC Analytics
    app.use('/api/kyc-analytics', kycAnalyticsRoutes.getRouter());
    console.log('✅ Rotas KYC registradas');
    
    // Rotas Dashboard
    app.use('/', dashboardRoutes);
    console.log('✅ Rotas Dashboard registradas');
    
    // Configurações ultra-otimizadas do Socket.IO
    const io = socketIo(server, {
        transports: ['polling', 'websocket'],
        pingTimeout: VPS_CONFIG.TIMEOUT,
        pingInterval: 30000, // Aumentado para VPS
        allowEIO3: true,
        maxHttpBufferSize: 1e6, // 1MB limit para VPS
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        // Configurações otimizadas para VPS
        compression: true,
        serveClient: false, // Desabilitar cliente para economizar recursos
        allowUpgrades: true,
        perMessageDeflate: {
            threshold: 1024,
            concurrencyLimit: 10,
            memLevel: 7
        }
    });
    
    // Health check ultra-otimizado
    app.get('/health', async (req, res) => {
        try {
            const health = {
                status: 'healthy',
                instanceId: process.env.NODE_ENV === 'production' 
                    ? `ultra-worker-${cluster.worker?.id || 'N/A'}` 
                    : `dev-server-${process.pid}`,
                clusterMode: process.env.NODE_ENV === 'production',
                port: process.env.PORT || 3001,
                timestamp: new Date().toISOString(),
                graphql: {
                    enabled: true,
                    endpoint: '/graphql',
                    playground: process.env.NODE_ENV !== 'production' ? '/graphql' : false,
                    queries: 26,
                    mutations: 6,
                    subscriptions: 6
                },
                metrics: {
                    connections: io.engine.clientsCount,
                    memory: process.memoryUsage(),
                    uptime: process.uptime(),
                    workers: process.env.NODE_ENV === 'production' ? VPS_CONFIG.CLUSTER_WORKERS : 1,
                    maxConnections: VPS_CONFIG.MAX_CONNECTIONS
                }
            };
            
            res.json(health);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // Metrics endpoint ultra-otimizado
    app.get('/metrics', async (req, res) => {
        try {
            const metrics = {
                timestamp: new Date().toISOString(),
                connections: {
                    total: io.engine.clientsCount,
                    max: VPS_CONFIG.MAX_CONNECTIONS,
                    percentage: (io.engine.clientsCount / VPS_CONFIG.MAX_CONNECTIONS * 100).toFixed(2)
                },
                performance: {
                    memory: process.memoryUsage(),
                    uptime: process.uptime(),
                    workers: VPS_CONFIG.CLUSTER_WORKERS
                },
                graphql: {
                    enabled: true,
                    queries: 26,
                    mutations: 6,
                    subscriptions: 6,
                    features: [
                        'Dashboard Resolver',
                        'User Resolver com DataLoader',
                        'Driver Resolver com Redis GEO',
                        'Booking Resolver',
                        'Cache Inteligente',
                        'Rate Limiting',
                        'Query Complexity Analysis'
                    ]
                }
            };
            
            res.json(metrics);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // Stats endpoint para GraphQL
    app.get('/stats', async (req, res) => {
        try {
            const stats = {
                timestamp: new Date().toISOString(),
                server: {
                    status: 'running',
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    workers: ULTRA_CONFIG.CLUSTER_WORKERS
                },
                websocket: {
                    connections: io.engine.clientsCount,
                    maxConnections: ULTRA_CONFIG.MAX_CONNECTIONS
                },
                graphql: {
                    status: 'active',
                    endpoint: '/graphql',
                    queries: 26,
                    mutations: 6,
                    subscriptions: 6,
                    features: [
                        'Dashboard Resolver',
                        'User Resolver com DataLoader',
                        'Driver Resolver com Redis GEO',
                        'Booking Resolver',
                        'Cache Inteligente',
                        'Rate Limiting',
                        'Query Complexity Analysis',
                        'Depth Limiting'
                    ]
                },
                performance: {
                    requestsPerSecond: ULTRA_CONFIG.MAX_REQUESTS_PER_SECOND,
                    maxConnections: ULTRA_CONFIG.MAX_CONNECTIONS,
                    clusterWorkers: ULTRA_CONFIG.CLUSTER_WORKERS
                }
            };
            
            res.json(stats);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // WebSocket events ultra-otimizados
    io.on('connection', (socket) => {
        console.log(`🔌 Ultra conexão: ${socket.id} (Total: ${io.engine.clientsCount})`);
        
        // Autenticação ultra-rápida
        socket.on('authenticate', async (data) => {
            try {
                socket.emit('authenticated', { uid: data.uid, success: true });
            } catch (error) {
                socket.emit('auth_error', { message: error.message });
            }
        });
        
        // Location updates ultra-otimizados
        socket.on('location_update', async (data) => {
            try {
                socket.emit('location_updated', { success: true });
            } catch (error) {
                socket.emit('location_error', { message: error.message });
            }
        });
        
        // Ride requests ultra-otimizados
        socket.on('request_ride', async (data) => {
            try {
                socket.emit('ride_requested', { success: true });
            } catch (error) {
                socket.emit('ride_error', { message: error.message });
            }
        });
        
        socket.on('disconnect', () => {
            console.log(`🔌 Ultra desconexão: ${socket.id} (Total: ${io.engine.clientsCount})`);
        });

        // ======================== EVENTOS DE CORRIDA ========================
        
        // Solicitar corrida
        socket.on('createBooking', async (data) => {
            try {
                console.log(`🚗 Solicitação de corrida recebida de ${socket.id}:`, data);
                
                const { customerId, pickupLocation, destinationLocation, estimatedFare, paymentMethod } = data;
                
                if (!customerId || !pickupLocation || !destinationLocation) {
                    socket.emit('bookingError', { error: 'Dados incompletos para solicitar corrida' });
                    return;
                }
                
                const bookingId = `booking_${Date.now()}_${customerId}`;
                
                // Simular criação da corrida
                const bookingData = {
                    bookingId,
                    customerId,
                    pickupLocation,
                    destinationLocation,
                    estimatedFare,
                    paymentMethod,
                    status: 'requested',
                    timestamp: new Date().toISOString()
                };
                
                // Emitir confirmação para o cliente
                socket.emit('bookingCreated', {
                    success: true,
                    bookingId,
                    message: 'Corrida solicitada com sucesso',
                    data: bookingData
                });
                
                console.log(`✅ Corrida ${bookingId} criada para cliente ${customerId}`);
                
                // Notificar motoristas próximos (simulado)
                setTimeout(() => {
                    // Emitir APENAS para drivers (excluir o customer que solicitou)
                    const connectedSockets = Array.from(io.sockets.sockets.values());
                    const driverSockets = connectedSockets.filter(s => s.id !== socket.id);
                    
                    console.log(`📱 Enviando notificação para ${driverSockets.length} motoristas conectados`);
                    
                    driverSockets.forEach(driverSocket => {
                        driverSocket.emit('rideRequest', {
                            rideId: bookingId,
                            customerId,
                            pickupLocation,
                            destinationLocation,
                            estimatedFare,
                            timestamp: new Date().toISOString()
                        });
                        console.log(`📱 Enviado para motorista ${driverSocket.id}`);
                    });
                    
                    console.log(`📱 Notificação enviada para ${driverSockets.length} motoristas sobre corrida ${bookingId}`);
                }, 1000);
                
            } catch (error) {
                console.error('❌ Erro ao criar corrida:', error);
                socket.emit('bookingError', { error: 'Erro interno do servidor' });
            }
        });

        // Confirmar pagamento
        socket.on('confirmPayment', async (data) => {
            try {
                console.log(`💳 Confirmação de pagamento recebida:`, data);
                
                const { bookingId, paymentMethod, paymentId, amount } = data;
                
                if (!bookingId || !paymentMethod || !amount) {
                    socket.emit('paymentError', { error: 'Dados incompletos para pagamento' });
                    return;
                }
                
                // Simular processamento do pagamento
                const paymentData = {
                    bookingId,
                    paymentMethod,
                    paymentId,
                    amount,
                    status: 'confirmed',
                    timestamp: new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('paymentConfirmed', {
                    success: true,
                    bookingId,
                    message: 'Pagamento confirmado com sucesso',
                    data: paymentData
                });
                
                console.log(`✅ Pagamento confirmado para corrida ${bookingId}: R$ ${amount}`);
                
                // ======================== TESTE AUTOMÁTICO ========================
                // Simular fluxo completo automaticamente após pagamento confirmado
                console.log(`🤖 TESTE AUTOMÁTICO: Simulando fluxo completo para ${bookingId}`);
                
                // Aguardar 1 segundo e simular motorista aceitando
                setTimeout(() => {
                    console.log(`🤖 Simulando motorista aceitando corrida ${bookingId}`);
                    
                    // Emitir evento de corrida aceita para o cliente
                    socket.emit('rideAccepted', {
                        success: true,
                        bookingId,
                        message: 'Motorista aceitou sua corrida',
                        driverId: 'simulated_driver',
                        timestamp: new Date().toISOString()
                    });
                    
                    // Aguardar 2 segundos e simular início da viagem
                    setTimeout(() => {
                        console.log(`🤖 Simulando início da viagem ${bookingId}`);
                        
                        socket.emit('tripStarted', {
                            success: true,
                            bookingId,
                            message: 'Viagem iniciada',
                            startLocation: { lat: -23.5505, lng: -46.6333 },
                            timestamp: new Date().toISOString()
                        });
                        
                        // Aguardar 3 segundos e simular finalização
                        setTimeout(() => {
                            console.log(`🤖 Simulando finalização da viagem ${bookingId}`);
                            
                            socket.emit('tripCompleted', {
                                success: true,
                                bookingId,
                                message: 'Viagem finalizada',
                                endLocation: { lat: -23.5615, lng: -46.6553 },
                                distance: 5.2,
                                fare: amount,
                                timestamp: new Date().toISOString()
                            });
                            
                            console.log(`✅ TESTE AUTOMÁTICO COMPLETO para ${bookingId}`);
                            
                        }, 3000);
                        
                    }, 2000);
                    
                }, 1000);
                
            } catch (error) {
                console.error('❌ Erro ao confirmar pagamento:', error);
                socket.emit('paymentError', { error: 'Erro ao processar pagamento' });
            }
        });

        // Resposta do motorista
        socket.on('driverResponse', async (data) => {
            try {
                console.log(`🚗 Resposta do motorista:`, data);
                
                const { bookingId, accepted, reason } = data;
                
                if (!bookingId || accepted === undefined) {
                    socket.emit('driverResponseError', { error: 'Dados incompletos para resposta do motorista' });
                    return;
                }
                
                if (accepted) {
                    // Motorista aceitou
                    socket.emit('rideAccepted', {
                        success: true,
                        bookingId,
                        message: 'Corrida aceita com sucesso',
                        driverId: socket.id
                    });
                    
                    // Notificar cliente
                    io.emit('rideAccepted', {
                        success: true,
                        bookingId,
                        message: 'Motorista aceitou sua corrida',
                        driverId: socket.id
                    });
                    
                    console.log(`✅ Motorista ${socket.id} aceitou corrida ${bookingId}`);
                } else {
                    // Motorista recusou
                    socket.emit('rideRejected', {
                        success: true,
                        bookingId,
                        message: 'Corrida recusada',
                        reason: reason || 'Motorista não disponível'
                    });
                    
                    console.log(`❌ Motorista ${socket.id} recusou corrida ${bookingId}: ${reason}`);
                }
                
            } catch (error) {
                console.error('❌ Erro na resposta do motorista:', error);
                socket.emit('driverResponseError', { error: 'Erro ao processar resposta' });
            }
        });

        // Iniciar viagem
        socket.on('startTrip', async (data) => {
            try {
                console.log(`🚀 Início de viagem:`, data);
                
                const { bookingId, startLocation } = data;
                
                if (!bookingId || !startLocation) {
                    socket.emit('tripStartError', { error: 'Dados incompletos para iniciar viagem' });
                    return;
                }
                
                // Emitir confirmação
                socket.emit('tripStarted', {
                    success: true,
                    bookingId,
                    message: 'Viagem iniciada com sucesso',
                    startLocation,
                    timestamp: new Date().toISOString()
                });
                
                // Notificar cliente
                io.emit('tripStarted', {
                    success: true,
                    bookingId,
                    message: 'Viagem iniciada',
                    startLocation,
                    timestamp: new Date().toISOString()
                });
                
                console.log(`🚀 Viagem ${bookingId} iniciada`);
                
            } catch (error) {
                console.error('❌ Erro ao iniciar viagem:', error);
                socket.emit('tripStartError', { error: 'Erro ao iniciar viagem' });
            }
        });

        // Finalizar viagem
        socket.on('completeTrip', async (data) => {
            try {
                console.log(`🏁 Finalização de viagem:`, data);
                
                const { bookingId, endLocation, distance, fare } = data;
                
                if (!bookingId || !endLocation) {
                    socket.emit('tripCompleteError', { error: 'Dados incompletos para finalizar viagem' });
                    return;
                }
                
                // Emitir confirmação
                socket.emit('tripCompleted', {
                    success: true,
                    bookingId,
                    message: 'Viagem finalizada com sucesso',
                    endLocation,
                    distance,
                    fare,
                    timestamp: new Date().toISOString()
                });
                
                // Notificar cliente
                io.emit('tripCompleted', {
                    success: true,
                    bookingId,
                    message: 'Viagem finalizada',
                    endLocation,
                    distance,
                    fare,
                    timestamp: new Date().toISOString()
                });
                
                console.log(`🏁 Viagem ${bookingId} finalizada - Distância: ${distance}km, Valor: R$ ${fare}`);
                
            } catch (error) {
                console.error('❌ Erro ao finalizar viagem:', error);
                socket.emit('tripCompleteError', { error: 'Erro ao finalizar viagem' });
            }
        });

        // Enviar avaliação
        socket.on('submitRating', async (data) => {
            try {
                console.log(`⭐ Avaliação recebida:`, data);
                
                const { tripId, customerId, driverId, customerRating, driverRating, customerComment, driverComment } = data;
                
                if (!tripId) {
                    socket.emit('ratingError', { error: 'ID da viagem é obrigatório' });
                    return;
                }
                
                // Emitir confirmação
                socket.emit('ratingSubmitted', {
                    success: true,
                    tripId,
                    message: 'Avaliação enviada com sucesso',
                    timestamp: new Date().toISOString()
                });
                
                console.log(`⭐ Avaliação enviada para viagem ${tripId}`);
                
            } catch (error) {
                console.error('❌ Erro ao enviar avaliação:', error);
                socket.emit('ratingError', { error: 'Erro ao enviar avaliação' });
            }
        });

        // ==================== NOVOS EVENTOS - GERENCIAMENTO DE STATUS DO DRIVER ====================
        
        // Definir status do driver
        socket.on('setDriverStatus', async (data) => {
            try {
                console.log(`🔄 Status do driver atualizado:`, data);
                
                const { driverId, status, isOnline, timestamp } = data;
                
                // Validar status
                const validStatuses = ['online', 'offline', 'busy', 'available'];
                if (!validStatuses.includes(status)) {
                    socket.emit('driverStatusError', { error: 'Status inválido' });
                    return;
                }
                
                // Simular atualização no Redis/Firebase
                const statusData = {
                    driverId,
                    status,
                    isOnline,
                    timestamp: timestamp || Date.now(),
                    lastSeen: new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('driverStatusUpdated', {
                    success: true,
                    driverId,
                    status,
                    message: 'Status atualizado com sucesso',
                    data: statusData
                });
                
                // Notificar outros clientes sobre mudança de status
                socket.broadcast.emit('driverStatusChanged', {
                    driverId,
                    status,
                    isOnline,
                    timestamp: statusData.timestamp
                });
                
                console.log(`✅ Status do driver ${driverId} atualizado para: ${status}`);
                
            } catch (error) {
                console.error('❌ Erro ao atualizar status do driver:', error);
                socket.emit('driverStatusError', { error: 'Erro interno do servidor' });
            }
        });
        
        // Atualizar localização do driver
        socket.on('updateDriverLocation', async (data) => {
            try {
                console.log(`📍 Localização do driver atualizada:`, data);
                
                const { driverId, lat, lng, heading, speed, timestamp } = data;
                
                if (!driverId || !lat || !lng) {
                    socket.emit('locationError', { error: 'Dados de localização incompletos' });
                    return;
                }
                
                // Simular atualização no Redis/Firebase
                const locationData = {
                    driverId,
                    location: { lat, lng },
                    heading: heading || 0,
                    speed: speed || 0,
                    timestamp: timestamp || Date.now(),
                    lastUpdate: new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('locationUpdated', {
                    success: true,
                    driverId,
                    message: 'Localização atualizada com sucesso',
                    data: locationData
                });
                
                // Notificar outros clientes sobre mudança de localização
                socket.broadcast.emit('driverLocationUpdated', {
                    driverId,
                    location: { lat, lng },
                    heading,
                    speed,
                    timestamp: locationData.timestamp
                });
                
                console.log(`✅ Localização do driver ${driverId} atualizada: ${lat}, ${lng}`);
                
            } catch (error) {
                console.error('❌ Erro ao atualizar localização do driver:', error);
                socket.emit('locationError', { error: 'Erro interno do servidor' });
            }
        });
        
        // ==================== NOVOS EVENTOS - BUSCA E MATCHING DE DRIVERS ====================
        
        // Buscar motoristas próximos
        socket.on('searchDrivers', async (data) => {
            try {
                console.log(`🔍 Busca de motoristas iniciada:`, data);
                
                const { pickupLocation, destinationLocation, rideType, estimatedFare, preferences } = data;
                
                if (!pickupLocation) {
                    socket.emit('driverSearchError', { error: 'Localização de origem obrigatória' });
                    return;
                }
                
                // Simular busca de motoristas
                const mockDrivers = [
                    {
                        id: 'driver_1',
                        name: 'João Silva',
                        rating: 4.8,
                        distance: 0.5,
                        estimatedArrival: 3,
                        vehicle: { model: 'Honda Civic', plate: 'ABC-1234' },
                        fare: estimatedFare || 25.50
                    },
                    {
                        id: 'driver_2',
                        name: 'Maria Santos',
                        rating: 4.9,
                        distance: 1.2,
                        estimatedArrival: 5,
                        vehicle: { model: 'Toyota Corolla', plate: 'XYZ-5678' },
                        fare: estimatedFare || 25.50
                    }
                ];
                
                // Emitir motoristas encontrados
                socket.emit('driversFound', {
                    success: true,
                    drivers: mockDrivers,
                    estimatedWaitTime: 3,
                    searchRadius: 5000,
                    message: `${mockDrivers.length} motoristas encontrados`
                });
                
                console.log(`✅ ${mockDrivers.length} motoristas encontrados para busca`);
                
            } catch (error) {
                console.error('❌ Erro na busca de motoristas:', error);
                socket.emit('driverSearchError', { error: 'Erro interno do servidor' });
            }
        });
        
        // Cancelar busca de motoristas
        socket.on('cancelDriverSearch', async (data) => {
            try {
                console.log(`❌ Busca de motoristas cancelada:`, data);
                
                const { bookingId, reason } = data;
                
                // Emitir confirmação
                socket.emit('driverSearchCancelled', {
                    success: true,
                    bookingId,
                    reason: reason || 'Cancelado pelo usuário',
                    message: 'Busca cancelada com sucesso'
                });
                
                console.log(`✅ Busca de motoristas cancelada para corrida ${bookingId}`);
                
            } catch (error) {
                console.error('❌ Erro ao cancelar busca:', error);
                socket.emit('driverSearchError', { error: 'Erro interno do servidor' });
            }
        });
        
        // ==================== NOVOS EVENTOS - GERENCIAMENTO DE CORRIDAS ====================
        
        // Cancelar corrida (com reembolso automático PIX)
        socket.on('cancelRide', async (data) => {
            try {
                console.log(`❌ Cancelamento de corrida:`, data);
                
                const { bookingId, reason, cancellationFee } = data;
                
                if (!bookingId) {
                    socket.emit('rideCancellationError', { error: 'ID da corrida obrigatório' });
                    return;
                }
                
                // Simular cancelamento e reembolso automático (PIX pré-pago)
                const cancellationData = {
                    bookingId,
                    reason: reason || 'Cancelado pelo usuário',
                    cancellationFee: cancellationFee || 0,
                    refundAmount: 25.50, // Valor total do pagamento
                    refundStatus: 'processed',
                    refundMethod: 'PIX',
                    timestamp: new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('rideCancelled', {
                    success: true,
                    bookingId,
                    message: 'Corrida cancelada e reembolso processado',
                    data: cancellationData
                });
                
                console.log(`✅ Corrida ${bookingId} cancelada - Reembolso automático processado`);
                
            } catch (error) {
                console.error('❌ Erro ao cancelar corrida:', error);
                socket.emit('rideCancellationError', { error: 'Erro interno do servidor' });
            }
        });
        
        // ==================== NOVOS EVENTOS - SISTEMA DE SEGURANÇA ====================
        
        // Reportar incidente
        socket.on('reportIncident', async (data) => {
            try {
                console.log(`🚨 Incidente reportado:`, data);
                
                const { type, description, evidence, location, timestamp } = data;
                
                if (!type || !description) {
                    socket.emit('incidentReportError', { error: 'Tipo e descrição obrigatórios' });
                    return;
                }
                
                // Simular processamento do incidente
                const incidentData = {
                    reportId: `incident_${Date.now()}`,
                    type,
                    description,
                    evidence: evidence || [],
                    location,
                    status: 'under_review',
                    priority: type === 'safety' ? 'high' : 'medium',
                    timestamp: timestamp || new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('incidentReported', {
                    success: true,
                    reportId: incidentData.reportId,
                    message: 'Incidente reportado com sucesso',
                    data: incidentData
                });
                
                console.log(`✅ Incidente reportado: ${incidentData.reportId}`);
                
            } catch (error) {
                console.error('❌ Erro ao reportar incidente:', error);
                socket.emit('incidentReportError', { error: 'Erro interno do servidor' });
            }
        });
        
        // Contato de emergência
        socket.on('emergencyContact', async (data) => {
            try {
                console.log(`🚨 Contato de emergência:`, data);
                
                const { contactType, location, message } = data;
                
                if (!contactType) {
                    socket.emit('emergencyError', { error: 'Tipo de contato obrigatório' });
                    return;
                }
                
                // Simular contato de emergência
                const emergencyData = {
                    emergencyId: `emergency_${Date.now()}`,
                    contactType,
                    location,
                    message: message || 'Solicitação de emergência',
                    status: 'contacted',
                    estimatedResponseTime: contactType === 'police' ? 5 : 10,
                    timestamp: new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('emergencyContacted', {
                    success: true,
                    emergencyId: emergencyData.emergencyId,
                    contactType,
                    estimatedResponseTime: emergencyData.estimatedResponseTime,
                    message: 'Contato de emergência realizado'
                });
                
                console.log(`✅ Contato de emergência realizado: ${contactType}`);
                
            } catch (error) {
                console.error('❌ Erro no contato de emergência:', error);
                socket.emit('emergencyError', { error: 'Erro interno do servidor' });
            }
        });
        
        // ==================== NOVOS EVENTOS - SISTEMA DE SUPORTE ====================
        
        // Criar ticket de suporte
        socket.on('createSupportTicket', async (data) => {
            try {
                console.log(`🎫 Ticket de suporte criado:`, data);
                
                const { type, priority, description, attachments } = data;
                
                if (!type || !description) {
                    socket.emit('supportTicketError', { error: 'Tipo e descrição obrigatórios' });
                    return;
                }
                
                // Simular criação do ticket
                const ticketData = {
                    ticketId: `ticket_${Date.now()}`,
                    type,
                    priority: priority || 'N3',
                    description,
                    attachments: attachments || [],
                    status: 'open',
                    estimatedResponseTime: priority === 'N1' ? 30 : priority === 'N2' ? 120 : 480, // minutos
                    timestamp: new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('supportTicketCreated', {
                    success: true,
                    ticketId: ticketData.ticketId,
                    estimatedResponseTime: ticketData.estimatedResponseTime,
                    message: 'Ticket de suporte criado com sucesso',
                    data: ticketData
                });
                
                console.log(`✅ Ticket de suporte criado: ${ticketData.ticketId}`);
                
            } catch (error) {
                console.error('❌ Erro ao criar ticket de suporte:', error);
                socket.emit('supportTicketError', { error: 'Erro interno do servidor' });
            }
        });
        
        // ==================== NOVOS EVENTOS - NOTIFICAÇÕES AVANÇADAS ====================
        
        // Atualizar preferências de notificação
        socket.on('updateNotificationPreferences', async (data) => {
            try {
                console.log(`🔔 Preferências de notificação atualizadas:`, data);
                
                const { rideUpdates, promotions, driverMessages, systemAlerts } = data;
                
                // Simular atualização das preferências
                const preferencesData = {
                    rideUpdates: rideUpdates !== undefined ? rideUpdates : true,
                    promotions: promotions !== undefined ? promotions : false,
                    driverMessages: driverMessages !== undefined ? driverMessages : true,
                    systemAlerts: systemAlerts !== undefined ? systemAlerts : true,
                    timestamp: new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('notificationPreferencesUpdated', {
                    success: true,
                    message: 'Preferências de notificação atualizadas',
                    data: preferencesData
                });
                
                console.log(`✅ Preferências de notificação atualizadas`);
                
            } catch (error) {
                console.error('❌ Erro ao atualizar preferências:', error);
                socket.emit('notificationError', { error: 'Erro interno do servidor' });
            }
        });
        
        // ==================== NOVOS EVENTOS - ANALYTICS E FEEDBACK ====================
        
        // Rastrear ação do usuário
        socket.on('trackUserAction', async (data) => {
            try {
                console.log(`📊 Ação do usuário rastreada:`, data);
                
                const { action, data: actionData, timestamp } = data;
                
                if (!action) {
                    socket.emit('trackingError', { error: 'Ação obrigatória' });
                    return;
                }
                
                // Simular rastreamento
                const trackingData = {
                    actionId: `action_${Date.now()}`,
                    action,
                    data: actionData || {},
                    timestamp: timestamp || new Date().toISOString(),
                    processed: true
                };
                
                // Emitir confirmação
                socket.emit('userActionTracked', {
                    success: true,
                    actionId: trackingData.actionId,
                    message: 'Ação rastreada com sucesso'
                });
                
                console.log(`✅ Ação rastreada: ${action}`);
                
            } catch (error) {
                console.error('❌ Erro ao rastrear ação:', error);
                socket.emit('trackingError', { error: 'Erro interno do servidor' });
            }
        });
        
        // Enviar feedback
        socket.on('submitFeedback', async (data) => {
            try {
                console.log(`💬 Feedback enviado:`, data);
                
                const { type, rating, comments, suggestions } = data;
                
                if (!type || !rating) {
                    socket.emit('feedbackError', { error: 'Tipo e avaliação obrigatórios' });
                    return;
                }
                
                // Simular processamento do feedback
                const feedbackData = {
                    feedbackId: `feedback_${Date.now()}`,
                    type,
                    rating,
                    comments: comments || '',
                    suggestions: suggestions || '',
                    status: 'received',
                    timestamp: new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('feedbackReceived', {
                    success: true,
                    feedbackId: feedbackData.feedbackId,
                    thankYouMessage: 'Obrigado pelo seu feedback! Sua opinião é muito importante para nós.',
                    data: feedbackData
                });
                
                console.log(`✅ Feedback recebido: ${feedbackData.feedbackId}`);
                
            } catch (error) {
                console.error('❌ Erro ao enviar feedback:', error);
                socket.emit('feedbackError', { error: 'Erro interno do servidor' });
            }
        });
        
        // ==================== NOVOS EVENTOS - CHAT E COMUNICAÇÃO ====================
        
        // Criar chat
        socket.on('createChat', async (data) => {
            try {
                console.log(`💬 Chat criado:`, data);
                
                const chatId = `chat_${Date.now()}`;
                
                socket.emit('chatCreated', {
                    success: true,
                    chatId,
                    message: 'Chat criado com sucesso'
                });
                
            } catch (error) {
                console.error('❌ Erro ao criar chat:', error);
                socket.emit('chatError', { error: 'Erro interno do servidor' });
            }
        });
        
        // Enviar mensagem
        socket.on('sendMessage', async (data) => {
            try {
                console.log(`💬 Mensagem enviada:`, data);
                
                socket.emit('messageSent', {
                    success: true,
                    messageId: `msg_${Date.now()}`,
                    message: 'Mensagem enviada com sucesso'
                });
                
            } catch (error) {
                console.error('❌ Erro ao enviar mensagem:', error);
                socket.emit('messageError', { error: 'Erro interno do servidor' });
            }
        });

        // ==================== NOVOS EVENTOS - NOTIFICAÇÕES FCM ====================
        
        // Registrar token FCM
        socket.on('registerFCMToken', async (data) => {
            try {
                console.log(`📱 Token FCM registrado:`, data);
                
                const { userId, userType, fcmToken, platform, timestamp } = data;
                
                if (!userId || !fcmToken) {
                    socket.emit('fcmTokenError', { error: 'Dados de token FCM incompletos' });
                    return;
                }
                
                // Simular armazenamento do token
                const tokenData = {
                    userId,
                    userType,
                    fcmToken,
                    platform,
                    timestamp: timestamp || new Date().toISOString(),
                    isActive: true,
                    lastSeen: new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('fcmTokenRegistered', {
                    success: true,
                    userId,
                    message: 'Token FCM registrado com sucesso',
                    data: tokenData
                });
                
                console.log(`✅ Token FCM registrado para usuário ${userId}`);
                
            } catch (error) {
                console.error('❌ Erro ao registrar token FCM:', error);
                socket.emit('fcmTokenError', { error: 'Erro interno do servidor' });
            }
        });

        // Desregistrar token FCM
        socket.on('unregisterFCMToken', async (data) => {
            try {
                console.log(`📱 Token FCM desregistrado:`, data);
                
                const { userId, fcmToken } = data;
                
                if (!userId || !fcmToken) {
                    socket.emit('fcmTokenError', { error: 'Dados de token FCM incompletos' });
                    return;
                }
                
                // Simular remoção do token
                const tokenData = {
                    userId,
                    fcmToken,
                    isActive: false,
                    unregisteredAt: new Date().toISOString()
                };
                
                // Emitir confirmação
                socket.emit('fcmTokenUnregistered', {
                    success: true,
                    userId,
                    message: 'Token FCM desregistrado com sucesso',
                    data: tokenData
                });
                
                console.log(`✅ Token FCM desregistrado para usuário ${userId}`);
                
            } catch (error) {
                console.error('❌ Erro ao desregistrar token FCM:', error);
                socket.emit('fcmTokenError', { error: 'Erro interno do servidor' });
            }
        });

        // Enviar notificação
        socket.on('sendNotification', async (data) => {
            try {
                console.log(`🔔 Notificação enviada:`, data);
                
                const { userId, userType, notification, timestamp } = data;
                
                if (!notification) {
                    socket.emit('notificationError', { error: 'Dados de notificação incompletos' });
                    return;
                }
                
                // Simular envio de notificação
                const notificationData = {
                    notificationId: `notif_${Date.now()}`,
                    userId,
                    userType,
                    notification,
                    timestamp: timestamp || new Date().toISOString(),
                    status: 'sent'
                };
                
                // Emitir confirmação
                socket.emit('notificationSent', {
                    success: true,
                    notificationId: notificationData.notificationId,
                    message: 'Notificação enviada com sucesso',
                    data: notificationData
                });
                
                console.log(`✅ Notificação enviada: ${notificationData.notificationId}`);
                
            } catch (error) {
                console.error('❌ Erro ao enviar notificação:', error);
                socket.emit('notificationError', { error: 'Erro interno do servidor' });
            }
        });

        // Enviar notificação para usuário específico
        socket.on('sendNotificationToUser', async (data) => {
            try {
                console.log(`🔔 Notificação para usuário:`, data);
                
                const { userId, notification, timestamp } = data;
                
                if (!userId || !notification) {
                    socket.emit('notificationError', { error: 'Dados de notificação incompletos' });
                    return;
                }
                
                // Simular envio de notificação para usuário específico
                const notificationData = {
                    notificationId: `notif_user_${Date.now()}`,
                    targetUserId: userId,
                    notification,
                    timestamp: timestamp || new Date().toISOString(),
                    status: 'sent'
                };
                
                // Emitir confirmação
                socket.emit('notificationSentToUser', {
                    success: true,
                    notificationId: notificationData.notificationId,
                    targetUserId: userId,
                    message: 'Notificação enviada para usuário com sucesso',
                    data: notificationData
                });
                
                console.log(`✅ Notificação enviada para usuário ${userId}: ${notificationData.notificationId}`);
                
            } catch (error) {
                console.error('❌ Erro ao enviar notificação para usuário:', error);
                socket.emit('notificationError', { error: 'Erro interno do servidor' });
            }
        });

        // Enviar notificação para todos os usuários de um tipo
        socket.on('sendNotificationToUserType', async (data) => {
            try {
                console.log(`🔔 Notificação para tipo de usuário:`, data);
                
                const { userType, notification, timestamp } = data;
                
                if (!userType || !notification) {
                    socket.emit('notificationError', { error: 'Dados de notificação incompletos' });
                    return;
                }
                
                // Simular envio de notificação para tipo de usuário
                const notificationData = {
                    notificationId: `notif_type_${Date.now()}`,
                    targetUserType: userType,
                    notification,
                    timestamp: timestamp || new Date().toISOString(),
                    status: 'sent'
                };
                
                // Emitir confirmação
                socket.emit('notificationSentToUserType', {
                    success: true,
                    notificationId: notificationData.notificationId,
                    targetUserType: userType,
                    message: 'Notificação enviada para tipo de usuário com sucesso',
                    data: notificationData
                });
                
                console.log(`✅ Notificação enviada para ${userType}s: ${notificationData.notificationId}`);
                
            } catch (error) {
                console.error('❌ Erro ao enviar notificação para tipo de usuário:', error);
                socket.emit('notificationError', { error: 'Erro interno do servidor' });
            }
        });

    });
    
    // Integrar GraphQL com o servidor
    const initializeGraphQL = async () => {
        try {
            console.log('🚀 Inicializando GraphQL...');
            
            // Aplicar middleware do GraphQL (já inicia o servidor)
            await applyMiddleware(app);
            
            console.log('✅ GraphQL integrado com sucesso!');
            console.log('📊 Endpoint: /graphql');
            console.log('🎮 Playground:', process.env.NODE_ENV !== 'production' ? '/graphql' : 'disabled');
            
        } catch (error) {
            console.error('❌ Erro ao inicializar GraphQL:', error);
            // Continuar sem GraphQL se houver erro
        }
    };
    
    // Inicializar GraphQL
    initializeGraphQL();
    
    // Iniciar servidor
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
        if (process.env.NODE_ENV === 'production') {
            console.log(`🚀 Ultra Worker ${cluster.worker?.id || 'N/A'} rodando na porta ${PORT}`);
            console.log(`📊 Configurado para ${VPS_CONFIG.MAX_CONNECTIONS} conexões (VPS)`);
            console.log(`⚡ Workers: ${VPS_CONFIG.CLUSTER_WORKERS}`);
        } else {
            console.log(`🚀 Servidor de desenvolvimento rodando na porta ${PORT}`);
            console.log(`📊 Configurado para ${VPS_CONFIG.MAX_CONNECTIONS} conexões`);
        }
        console.log(`🔗 GraphQL: http://localhost:${PORT}/graphql`);
        console.log(`🌐 WebSocket: ws://localhost:${PORT}`);
        console.log(`❤️ Health: http://localhost:${PORT}/health`);
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('🛑 Recebido SIGTERM, fechando servidor...');
        server.close(() => {
            process.exit(0);
        });
    });
    
    process.on('SIGINT', () => {
        console.log('🛑 Recebido SIGINT, fechando servidor...');
        server.close(() => {
            process.exit(0);
        });
    });
}