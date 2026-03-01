/**
 * RESPONSE HANDLER
 * 
 * Processa aceitações e rejeições de motoristas, integrando com:
 * - GradualRadiusExpander (parar busca)
 * - RideQueueManager (remover da fila)
 * - RideStateManager (atualizar estados)
 * - DriverNotificationDispatcher (cancelar timeouts)
 * - DriverLockManager (gerenciar locks)
 * 
 * Funcionalidades:
 * - acceptRide: Parar busca, atualizar estado, notificar customer, remover da fila
 * - rejectRide: Liberar lock, enviar próxima corrida, continuar busca
 */

const redisPool = require('../utils/redis-pool');
const GradualRadiusExpander = require('./gradual-radius-expander');
const RideStateManager = require('./ride-state-manager');
const rideQueueManager = require('./ride-queue-manager');
const driverLockManager = require('./driver-lock-manager');
const DriverNotificationDispatcher = require('./driver-notification-dispatcher');
const eventSourcing = require('./event-sourcing');
const { EVENT_TYPES } = require('./event-sourcing');
const { logger } = require('../utils/logger');
const FCMService = require('./fcm-service');

class ResponseHandler {
    constructor(io) {
        this.redis = redisPool.getConnection();
        this.io = io;
        this.expander = new GradualRadiusExpander(io);
        this.dispatcher = new DriverNotificationDispatcher(io);
        this.fcmService = new FCMService();
        this.rejectionTimers = new Map(); // ✅ Map para armazenar timers de rejeição: bookingId_driverId -> timeoutId
    }

    /**
     * Processar aceitação de corrida pelo motorista
     * @param {string} driverId - ID do motorista
     * @param {string} bookingId - ID da corrida
     * @returns {Promise<{success: boolean, bookingId: string, driverId: string}>}
     */
    async handleAcceptRide(driverId, bookingId) {
        try {
            logger.info(`✅ [ResponseHandler] Motorista ${driverId} aceitou corrida ${bookingId}`);

            // ✅ CORREÇÃO: Adquirir lock quando motorista aceita (não verificar se já tem)
            // Verificar se motorista tem corrida ativa na tela para esta corrida
            const activeNotificationKey = `driver_active_notification:${driverId}`;
            const activeBookingId = await this.redis.get(activeNotificationKey);
            if (activeBookingId !== bookingId) {
                logger.warn(`⚠️ [ResponseHandler] Motorista ${driverId} não tem corrida ativa na tela para ${bookingId} (ativa: ${activeBookingId})`);
                return {
                    success: false,
                    error: 'Motorista não tem permissão para aceitar esta corrida'
                };
            }
            
            // ✅ ADICIONAR: Adquirir lock quando aceita (corrida em andamento)
            const lockAcquired = await driverLockManager.acquireLock(driverId, bookingId, 3600); // 1 hora
            if (!lockAcquired) {
                logger.warn(`⚠️ [ResponseHandler] Motorista ${driverId} já está ocupado (outra corrida em andamento)`);
                return {
                    success: false,
                    error: 'Motorista já está ocupado com outra corrida'
                };
            }
            
            // Limpar corrida ativa na tela
            await this.redis.del(activeNotificationKey);

            // 2. Verificar estado da corrida
            const currentState = await RideStateManager.getBookingState(this.redis, bookingId);
            
            // ✅ CORREÇÃO TC-008: Verificar se corrida já foi aceita por outro motorista (race condition)
            if (currentState === RideStateManager.STATES.ACCEPTED || 
                currentState === RideStateManager.STATES.MATCHED) {
                logger.warn(`⚠️ [ResponseHandler] Corrida ${bookingId} já foi aceita por outro motorista (state: ${currentState})`);
                // Liberar lock deste motorista
                await driverLockManager.releaseLock(driverId);
                return {
                    success: false,
                    error: 'Corrida já foi aceita por outro motorista'
                };
            }
            
            // ✅ ACEITAR estados NOTIFIED e SEARCHING (motorista pode aceitar se foi notificado)
            if (currentState !== RideStateManager.STATES.SEARCHING && 
                currentState !== RideStateManager.STATES.NOTIFIED &&
                currentState !== RideStateManager.STATES.AWAITING_RESPONSE) {
                logger.warn(`⚠️ [ResponseHandler] Corrida ${bookingId} não está disponível para aceitação (state: ${currentState})`);
                return {
                    success: false,
                    error: 'Corrida não está mais disponível para aceitação'
                };
            }
            
            logger.info(`✅ [ResponseHandler] Corrida ${bookingId} está em estado válido para aceitação: ${currentState}`);

            // 3. Parar busca gradual (cancelar expansões futuras)
            await this.expander.stopSearch(bookingId);

            // 4. Cancelar todos os timeouts de resposta dos outros motoristas
            this.dispatcher.clearAllTimeouts(bookingId);

            // 5. Atualizar estado da corrida: NOTIFIED/SEARCHING → MATCHED → ACCEPTED
            // Se estava em NOTIFIED, pular MATCHED e ir direto para ACCEPTED
            if (currentState === RideStateManager.STATES.NOTIFIED || 
                currentState === RideStateManager.STATES.AWAITING_RESPONSE) {
                logger.info(`📊 [ResponseHandler] Transição direta: ${currentState} → ACCEPTED`);
                await RideStateManager.updateBookingState(
                    this.redis,
                    bookingId,
                    RideStateManager.STATES.ACCEPTED
                );
            } else {
                // Se estava em SEARCHING, fazer transição completa
                await RideStateManager.updateBookingState(
                    this.redis,
                    bookingId,
                    RideStateManager.STATES.MATCHED
                );
                await RideStateManager.updateBookingState(
                    this.redis,
                    bookingId,
                    RideStateManager.STATES.ACCEPTED
                );
            }

            // 7. Buscar wooviAccountId do motorista e atualizar dados da corrida
            const bookingKey = `booking:${bookingId}`;
            
            // ✅ Buscar wooviAccountId do motorista
            let wooviAccountId = null;
            let wooviClientId = null;
            try {
                const DriverApprovalService = require('./driver-approval-service');
                const driverApprovalService = new DriverApprovalService();
                const accountData = await driverApprovalService.getDriverWooviAccountId(driverId);
                
                if (accountData) {
                    wooviAccountId = accountData.wooviAccountId;
                    wooviClientId = accountData.wooviClientId;
                    logger.info(`✅ [ResponseHandler] wooviAccountId encontrado para motorista ${driverId}: ${wooviAccountId}`);
                } else {
                    logger.warn(`⚠️ [ResponseHandler] wooviAccountId não encontrado para motorista ${driverId}`);
                }
            } catch (accountError) {
                logger.error(`❌ [ResponseHandler] Erro ao buscar wooviAccountId:`, accountError);
            }
            
            // Atualizar dados da corrida com driverId e wooviAccountId
            const bookingUpdateData = {
                driverId: driverId,
                acceptedAt: Date.now(),
                status: 'ACCEPTED'
            };
            
            // Adicionar wooviAccountId se encontrado
            if (wooviAccountId) {
                bookingUpdateData.driverWooviAccountId = wooviAccountId;
                bookingUpdateData.driverWooviClientId = wooviClientId || wooviAccountId;
            }
            
            await this.redis.hset(bookingKey, bookingUpdateData);

            // 8. Remover da fila regional
            const bookingData = await this.redis.hgetall(bookingKey);
            
            // ✅ Parsear pickupLocation e destinationLocation se forem strings JSON
            if (bookingData.pickupLocation && typeof bookingData.pickupLocation === 'string') {
                try {
                    bookingData.pickupLocation = JSON.parse(bookingData.pickupLocation);
                } catch (e) {
                    logger.warn(`⚠️ [ResponseHandler] Erro ao parsear pickupLocation:`, e.message);
                }
            }
            if (bookingData.destinationLocation && typeof bookingData.destinationLocation === 'string') {
                try {
                    bookingData.destinationLocation = JSON.parse(bookingData.destinationLocation);
                } catch (e) {
                    logger.warn(`⚠️ [ResponseHandler] Erro ao parsear destinationLocation:`, e.message);
                }
            }
            
            if (bookingData.pickupLocation) {
                const pickupLocation = typeof bookingData.pickupLocation === 'object' 
                    ? bookingData.pickupLocation 
                    : JSON.parse(bookingData.pickupLocation);
                const GeoHashUtils = require('../utils/geohash-utils');
                const regionHash = GeoHashUtils.getRegionHash(pickupLocation.lat, pickupLocation.lng, 5);
                await rideQueueManager.dequeueRide(bookingId, regionHash);
            }

            // 9. ✅ CANCELAR TODOS OS TIMERS DE REJEIÇÃO PARA ESTA CORRIDA
            // Se a corrida foi aceita, não precisamos mais aguardar reenvio para motoristas que rejeitaram
            for (const [timerKey, timeoutId] of this.rejectionTimers.entries()) {
                if (timerKey.startsWith(`${bookingId}_`)) {
                    clearTimeout(timeoutId);
                    this.rejectionTimers.delete(timerKey);
                    logger.debug(`🛑 [ResponseHandler] Timer de rejeição cancelado: ${timerKey}`);
                }
            }

            // 10. Liberar locks de outros motoristas que receberam notificação
            await this.releaseOtherDriversLocks(bookingId, driverId);

            // 11. Buscar customerId para notificação
            const customerId = bookingData.customerId;

            // 12. Buscar dados completos do motorista (Redis + GraphQL)
            let driverData = null;
            try {
                const driverKey = `driver:${driverId}`;
                const driverRedisData = await this.redis.hgetall(driverKey);
                
                // Buscar localização atual do motorista
                const driverLocation = await this.redis.geopos('driver_locations', driverId);
                
                // Se temos dados básicos no Redis, usar eles
                if (driverRedisData && driverRedisData.id) {
                    driverData = {
                        id: driverId,
                        name: driverRedisData.firstName && driverRedisData.lastName 
                            ? `${driverRedisData.firstName} ${driverRedisData.lastName}`
                            : driverRedisData.name || 'Motorista',
                        firstName: driverRedisData.firstName,
                        lastName: driverRedisData.lastName,
                        location: driverLocation && driverLocation.length > 0 ? {
                            lat: parseFloat(driverLocation[0][1]),
                            lng: parseFloat(driverLocation[0][0])
                        } : null,
                        vehicle: {
                            plate: driverRedisData.vehicleNumber || driverRedisData.plate || null,
                            brand: driverRedisData.vehicleBrand || driverRedisData.brand || null,
                            model: driverRedisData.vehicleModel || driverRedisData.model || null,
                            color: driverRedisData.vehicleColor || driverRedisData.color || null
                        },
                        rating: parseFloat(driverRedisData.rating || 5.0),
                        phone: driverRedisData.phone || null
                    };
                    
                    logger.info(`✅ [ResponseHandler] Dados do motorista ${driverId} obtidos do Redis`);
                }
                
                // Se não temos dados completos do veículo, buscar do GraphQL
                if (!driverData?.vehicle?.plate || !driverData?.vehicle?.brand || !driverData?.vehicle?.model) {
                    try {
                        const DriverResolver = require('../graphql/resolvers/DriverResolver');
                        const driverResolver = new DriverResolver();
                        await driverResolver.initialize();
                        
                        const graphqlDriver = await driverResolver.driver(null, { id: driverId }, {});
                        
                        if (graphqlDriver) {
                            // Mesclar dados do GraphQL com dados do Redis
                            if (!driverData) {
                                driverData = {
                                    id: driverId,
                                    name: graphqlDriver.name || 'Motorista',
                                    location: driverLocation && driverLocation.length > 0 ? {
                                        lat: parseFloat(driverLocation[0][1]),
                                        lng: parseFloat(driverLocation[0][0])
                                    } : null,
                                    vehicle: {},
                                    rating: graphqlDriver.rating || 5.0
                                };
                            }
                            
                            // Atualizar dados do veículo do GraphQL
                            if (graphqlDriver.vehicle) {
                                driverData.vehicle = {
                                    plate: graphqlDriver.vehicle.plate || driverData.vehicle?.plate || null,
                                    brand: graphqlDriver.vehicle.brand || driverData.vehicle?.brand || null,
                                    model: graphqlDriver.vehicle.model || driverData.vehicle?.model || null,
                                    color: graphqlDriver.vehicle.color || driverData.vehicle?.color || null
                                };
                            }
                            
                            // Atualizar nome se não tiver
                            if (!driverData.name || driverData.name === 'Motorista') {
                                driverData.name = graphqlDriver.name || driverData.name;
                            }
                            
                            logger.info(`✅ [ResponseHandler] Dados do veículo do motorista ${driverId} obtidos do GraphQL`);
                        }
                    } catch (graphqlError) {
                        logger.warn(`⚠️ [ResponseHandler] Erro ao buscar dados do GraphQL, usando dados do Redis:`, graphqlError.message);
                    }
                }
                
                // Se ainda não temos dados, criar estrutura mínima
                if (!driverData) {
                    driverData = {
                        id: driverId,
                        name: 'Motorista',
                        location: driverLocation && driverLocation.length > 0 ? {
                            lat: parseFloat(driverLocation[0][1]),
                            lng: parseFloat(driverLocation[0][0])
                        } : null,
                        vehicle: {},
                        rating: 5.0
                    };
                    logger.warn(`⚠️ [ResponseHandler] Dados mínimos do motorista ${driverId} criados`);
                }
            } catch (error) {
                logger.error(`❌ [ResponseHandler] Erro ao buscar dados do motorista:`, error);
                // Criar estrutura mínima em caso de erro
                driverData = {
                    id: driverId,
                    name: 'Motorista',
                    location: null,
                    vehicle: {},
                    rating: 5.0
                };
            }

            // 13. Calcular tempo estimado até pickup (se temos localização do motorista e pickup)
            let estimatedPickupTime = null;
            if (driverData?.location && driverData.location.lat && driverData.location.lng && bookingData.pickupLocation) {
                try {
                    const distanceKm = this.calculateDistance(
                        driverData.location.lat,
                        driverData.location.lng,
                        bookingData.pickupLocation.lat,
                        bookingData.pickupLocation.lng
                    ) / 1000; // Converter metros para km
                    
                    // Velocidade média: 35 km/h = ~0.583 km/min
                    const speedKmPerMin = 0.583;
                    estimatedPickupTime = Math.max(1, Math.round(distanceKm / speedKmPerMin));
                    
                    logger.info(`⏱️ [ResponseHandler] Tempo estimado calculado: ${estimatedPickupTime} minutos (distância: ${distanceKm.toFixed(2)}km)`);
                } catch (error) {
                    logger.warn(`⚠️ [ResponseHandler] Erro ao calcular tempo estimado:`, error.message);
                }
            }

            // 14. Preparar dados para notificação
            const notificationData = {
                success: true,
                bookingId,
                rideId: bookingId,
                driverId,
                driver: driverData, // ✅ Incluir dados completos do motorista
                estimatedPickupTime: estimatedPickupTime, // ✅ Incluir tempo estimado calculado
                message: 'Motorista aceitou sua corrida',
                timestamp: new Date().toISOString()
            };

            // 14.1. Formatar booking para o motorista (compatível com normalizeBookingData)
            let formattedBooking = null;
            try {
                // Parse dos dados do Redis se necessário
                const pickupLocation = bookingData.pickupLocation ? 
                    (typeof bookingData.pickupLocation === 'string' ? JSON.parse(bookingData.pickupLocation) : bookingData.pickupLocation) 
                    : null;
                const destinationLocation = bookingData.destinationLocation ? 
                    (typeof bookingData.destinationLocation === 'string' ? JSON.parse(bookingData.destinationLocation) : bookingData.destinationLocation) 
                    : null;

                formattedBooking = {
                    bookingId: bookingId,
                    rideId: bookingId,
                    customer: customerId,
                    customerId: customerId,
                    pickupLocation: pickupLocation ? {
                        add: pickupLocation.address || pickupLocation.add || 'Endereço não disponível',
                        lat: pickupLocation.lat || pickupLocation.latitude,
                        lng: pickupLocation.lng || pickupLocation.longitude
                    } : null,
                    destinationLocation: destinationLocation ? {
                        add: destinationLocation.address || destinationLocation.add || 'Endereço não disponível',
                        lat: destinationLocation.lat || destinationLocation.latitude,
                        lng: destinationLocation.lng || destinationLocation.longitude
                    } : null,
                    estimatedFare: parseFloat(bookingData.estimatedFare || bookingData.estimate || 0),
                    estimate: parseFloat(bookingData.estimatedFare || bookingData.estimate || 0),
                    distance: parseFloat(bookingData.distance || 0),
                    status: 'ACCEPTED',
                    driverId: driverId,
                    acceptedAt: bookingData.acceptedAt || Date.now()
                };
            } catch (bookingFormatError) {
                logger.error(`❌ [ResponseHandler] Erro ao formatar booking para motorista:`, bookingFormatError);
            }

            // 15. Notificar customer
            if (customerId && this.io) {
                this.io.to(`customer_${customerId}`).emit('rideAccepted', notificationData);
                logger.info(`📱 [ResponseHandler] rideAccepted enviado para customer ${customerId} com dados do motorista e tempo estimado: ${estimatedPickupTime || 'N/A'} minutos`);
            }

            // 15. Notificar driver (confirmação via WebSocket)
            if (this.io) {
                // ✅ Garantir que driverData não seja vazio
                if (!driverData || Object.keys(driverData).length === 0) {
                    logger.warn(`⚠️ [ResponseHandler] driverData vazio para motorista ${driverId}, criando estrutura mínima`);
                    driverData = {
                        id: driverId,
                        name: 'Motorista',
                        location: null,
                        vehicle: {},
                        rating: 5.0
                    };
                }

                const driverNotificationData = {
                    ...notificationData,
                    driver: driverData, // ✅ Garantir que driverData não está vazio
                    booking: formattedBooking, // ✅ Incluir booking formatado para o motorista
                    message: 'Corrida aceita com sucesso'
                };

                this.io.to(`driver_${driverId}`).emit('rideAccepted', driverNotificationData);
                logger.info(`📱 [ResponseHandler] rideAccepted enviado para driver ${driverId} com booking completo e driverData: ${driverData?.name || 'N/A'}`);
            }

            // 15.1. Enviar notificação interativa para o motorista (com botões de ação)
            try {
                // Buscar FCM token do motorista
                const driverFcmToken = await this.redis.hget(`driver:${driverId}`, 'fcmToken');
                
                if (driverFcmToken) {
                    // ✅ Garantir que pickupLocation está parseado
                    const pickupLocation = typeof bookingData.pickupLocation === 'object' 
                        ? bookingData.pickupLocation 
                        : (bookingData.pickupLocation ? JSON.parse(bookingData.pickupLocation) : null);
                    
                    const pickupAddress = pickupLocation?.address || pickupLocation?.add || bookingData.pickup?.add || 'Local de embarque';
                    const pickupLat = pickupLocation?.lat || pickupLocation?.latitude || bookingData.pickup?.lat;
                    const pickupLng = pickupLocation?.lng || pickupLocation?.longitude || bookingData.pickup?.lng;
                    
                    // ✅ Buscar nome do passageiro para incluir na notificação
                    let passengerName = 'o passageiro';
                    if (customerId) {
                        try {
                            // Tentar buscar do Redis primeiro
                            const customerKey = `user:${customerId}`;
                            const customerData = await this.redis.hgetall(customerKey);
                            
                            if (customerData && (customerData.firstName || customerData.name)) {
                                passengerName = customerData.firstName && customerData.lastName
                                    ? `${customerData.firstName} ${customerData.lastName}`
                                    : customerData.firstName || customerData.name || 'o passageiro';
                            } else {
                                // Tentar buscar do GraphQL
                                const UserResolver = require('../graphql/resolvers/UserResolver');
                                const userResolver = new UserResolver();
                                await userResolver.initialize();
                                
                                const graphqlUser = await userResolver.user(null, { id: customerId }, {});
                                if (graphqlUser && graphqlUser.name) {
                                    passengerName = graphqlUser.name;
                                }
                            }
                        } catch (nameError) {
                            logger.warn(`⚠️ [ResponseHandler] Erro ao buscar nome do passageiro:`, nameError.message);
                            // Usar nome padrão se falhar
                        }
                    }
                    
                    // Definir ações (botões) da notificação
                    const notificationActions = [
                        {
                            id: 'arrived_at_pickup',
                            title: 'Cheguei ao local',
                            icon: 'ic_check'
                        },
                        {
                            id: 'cancel_ride',
                            title: 'Cancelar',
                            icon: 'ic_close'
                        }
                    ];

                    // ✅ Notificação melhorada com nome do passageiro
                    await this.fcmService.sendInteractiveNotification(
                        driverFcmToken,
                        {
                            title: '🚗 Corrida aceita!',
                            body: `Dirija até o embarque de ${passengerName} em ${pickupAddress}`,
                            data: {
                                type: 'ride_accepted',
                                bookingId: bookingId,
                                driverId: driverId,
                                action: 'navigate_to_pickup',
                                pickupLat: pickupLat ? String(pickupLat) : undefined,
                                pickupLng: pickupLng ? String(pickupLng) : undefined,
                                pickupAddress: pickupAddress,
                                passengerName: passengerName,
                                hasActions: 'true'
                            },
                            channelId: 'driver_actions',
                            badge: 1
                        },
                        notificationActions,
                        'RIDE_ACCEPTED' // Categoria para iOS
                    );

                    logger.info(`📱 [ResponseHandler] Notificação interativa enviada para motorista ${driverId} com nome do passageiro: ${passengerName}`);
                } else {
                    logger.warn(`⚠️ [ResponseHandler] FCM token não encontrado para motorista ${driverId}. Verifique se o token foi salvo no Redis em driver:${driverId} -> fcmToken`);
                }
            } catch (fcmError) {
                logger.error(`❌ [ResponseHandler] Erro ao enviar notificação interativa:`, fcmError);
                // Não falhar o fluxo se a notificação falhar
            }

            // 15.2. ✅ Atualizar activeBookings com wooviAccountId (se disponível)
            if (this.io && this.io.activeBookings) {
                const activeBooking = this.io.activeBookings.get(bookingId);
                if (activeBooking) {
                    // Atualizar com dados do motorista e wooviAccountId
                    this.io.activeBookings.set(bookingId, {
                        ...activeBooking,
                        driverId: driverId,
                        driverWooviAccountId: wooviAccountId,
                        driverWooviClientId: wooviClientId,
                        status: 'ACCEPTED',
                        acceptedAt: Date.now()
                    });
                    logger.info(`✅ [ResponseHandler] activeBookings atualizado com wooviAccountId para ${bookingId}`);
                }
            }

            // 16. Registrar evento
            await eventSourcing.recordEvent(
                EVENT_TYPES.RIDE_ACCEPTED,
                {
                    bookingId,
                    driverId,
                    customerId,
                    acceptedAt: Date.now()
                }
            );

            logger.info(`✅ [ResponseHandler] Corrida ${bookingId} aceita com sucesso por ${driverId}`);

            return {
                success: true,
                bookingId,
                driverId,
                customerId
            };
        } catch (error) {
            logger.error(`❌ [ResponseHandler] Erro ao processar aceitação de ${driverId} para ${bookingId}:`, error);
            
            // Tentar liberar lock em caso de erro
            try {
                await driverLockManager.releaseLock(driverId);
            } catch (releaseError) {
                logger.error(`❌ [ResponseHandler] Erro ao liberar lock após falha:`, releaseError);
            }

            return {
                success: false,
                error: error.message || 'Erro ao processar aceitação'
            };
        }
    }

    /**
     * Processar rejeição de corrida pelo motorista
     * @param {string} driverId - ID do motorista
     * @param {string} bookingId - ID da corrida
     * @param {string} reason - Motivo da rejeição (opcional)
     * @returns {Promise<{success: boolean, nextRide?: Object}>}
     */
    async handleRejectRide(driverId, bookingId, reason = 'Motorista indisponível') {
        try {
            logger.info(`❌ [ResponseHandler] Motorista ${driverId} rejeitou corrida ${bookingId}: ${reason}`);

            // ✅ CORREÇÃO: Não há lock para liberar (lock apenas quando aceita)
            // Limpar corrida ativa na tela do motorista
            const activeNotificationKey = `driver_active_notification:${driverId}`;
            await this.redis.del(activeNotificationKey);

            // 2. Cancelar timeout de resposta deste motorista
            this.dispatcher.cancelDriverTimeout(driverId, bookingId);
            
            // ✅ NOVO: Adicionar motorista à lista de exclusão permanente para esta corrida
            await this.redis.sadd(`ride_excluded_drivers:${bookingId}`, driverId);
            await this.redis.expire(`ride_excluded_drivers:${bookingId}`, 3600); // Expirar após 1 hora
            logger.info(`🚫 [ResponseHandler] Motorista ${driverId} adicionado à lista de exclusão para ${bookingId} (rejeitou)`);

            // 3. Registrar evento
            await eventSourcing.recordEvent(
                EVENT_TYPES.RIDE_REJECTED,
                {
                    bookingId,
                    driverId,
                    reason,
                    rejectedAt: Date.now()
                }
            );

            // 4. Notificar driver sobre rejeição (confirmação)
            if (this.io) {
                this.io.to(`driver_${driverId}`).emit('rideRejected', {
                    success: true,
                    bookingId,
                    message: 'Corrida rejeitada com sucesso',
                    reason
                });
            }

            // ✅ CORREÇÃO: Não há lock para verificar (lock apenas quando aceita)
            // Pequeno delay para garantir processamento assíncrono
            await new Promise(resolve => setTimeout(resolve, 50));

            // ✅ CORREÇÃO TC-003: Log antes de buscar próxima corrida para diagnóstico
            logger.info(`🔍 [ResponseHandler] Buscando próxima corrida para ${driverId} após rejeição de ${bookingId}`);
            
            // ✅ CORREÇÃO TC-003: Pequeno delay para garantir que qualquer processamento assíncrono seja concluído
            // Isso garante que corridas que foram processadas recentemente estejam na fila ativa
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // 5. Buscar próxima corrida da fila para o motorista
            const nextRide = await this.sendNextRideToDriver(driverId);

            // 6. ✅ CORREÇÃO: Estado sempre permanece SEARCHING (não muda)
            // Apenas registrar metadata da rejeição
            const currentState = await RideStateManager.getBookingState(this.redis, bookingId);
            if (currentState === RideStateManager.STATES.SEARCHING || 
                currentState === RideStateManager.STATES.EXPANDED) {
                // ✅ Estado permanece SEARCHING, apenas registrar metadata
                await this.redis.hset(`booking:${bookingId}`, {
                    rejectedBy: driverId,
                    rejectedAt: new Date().toISOString()
                });
                logger.info(`🔍 [ResponseHandler] Motorista ${driverId} rejeitou ${bookingId} (estado permanece SEARCHING, busca continua)`);
            } else {
                // Estado já mudou (corrida aceita, cancelada, etc.)
                logger.debug(`ℹ️ [ResponseHandler] Rejeição de ${driverId} para ${bookingId}, mas estado já é ${currentState}`);
            }
            
            // 7. ✅ AGENDAR REMOÇÃO DA LISTA DE NOTIFICADOS APÓS 30 SEGUNDOS
            // Se nenhum outro motorista aceitar em 30s, o motorista que rejeitou pode receber novamente
            const timerKey = `${bookingId}_${driverId}`;
            
            // Cancelar timer anterior se existir
            const existingTimer = this.rejectionTimers.get(timerKey);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }
            
            // Agendar remoção da lista de notificados após 30 segundos
            const timeoutId = setTimeout(async () => {
                try {
                    // Verificar se a corrida ainda está em busca (não foi aceita por outro motorista)
                    const currentState = await RideStateManager.getBookingState(this.redis, bookingId);
                    if (currentState === RideStateManager.STATES.SEARCHING || 
                        currentState === RideStateManager.STATES.NOTIFIED ||
                        currentState === RideStateManager.STATES.AWAITING_RESPONSE ||
                        currentState === RideStateManager.STATES.EXPANDED) {
                        
                        // Remover motorista da lista de notificados para que possa receber novamente
                        await this.redis.srem(`ride_notifications:${bookingId}`, driverId);
                        logger.info(`🔄 [ResponseHandler] Motorista ${driverId} removido da lista de notificados para ${bookingId} (pode receber novamente após 30s)`);
                        
                        // Remover timer do Map
                        this.rejectionTimers.delete(timerKey);
                    } else {
                        // Corrida foi aceita ou cancelada, apenas limpar timer
                        logger.debug(`ℹ️ [ResponseHandler] Corrida ${bookingId} não está mais em busca, não removendo ${driverId} da lista`);
                        this.rejectionTimers.delete(timerKey);
                    }
                } catch (error) {
                    logger.error(`❌ [ResponseHandler] Erro ao remover motorista da lista de notificados:`, error);
                    this.rejectionTimers.delete(timerKey);
                }
            }, 30000); // 30 segundos
            
            this.rejectionTimers.set(timerKey, timeoutId);
            logger.info(`⏰ [ResponseHandler] Timer de 30s agendado para ${driverId} poder receber ${bookingId} novamente`);

            logger.info(`✅ [ResponseHandler] Rejeição processada para ${driverId}, próxima corrida: ${nextRide ? 'encontrada' : 'nenhuma'}`);

            return {
                success: true,
                bookingId,
                driverId,
                reason,
                nextRide: nextRide || null
            };
        } catch (error) {
            logger.error(`❌ [ResponseHandler] Erro ao processar rejeição de ${driverId} para ${bookingId}:`, error);
            
            // Tentar liberar lock mesmo em caso de erro
            try {
                await driverLockManager.releaseLock(driverId);
            } catch (releaseError) {
                logger.error(`❌ [ResponseHandler] Erro ao liberar lock após falha:`, releaseError);
            }

            return {
                success: false,
                error: error.message || 'Erro ao processar rejeição'
            };
        }
    }

    /**
     * Enviar próxima corrida da fila para o motorista
     * @param {string} driverId - ID do motorista
     * @returns {Promise<Object|null>} Próxima corrida ou null
     */
    async sendNextRideToDriver(driverId) {
        try {
            // 1. Buscar localização do motorista
            const driverLocation = await this.redis.geopos('driver_locations', driverId);
            if (!driverLocation || driverLocation.length === 0) {
                logger.debug(`⚠️ [ResponseHandler] Localização do motorista ${driverId} não encontrada`);
                return null;
            }

            const [lng, lat] = driverLocation[0];
            const pickupLocation = { lat, lng };

            // 2. Buscar região do motorista
            const GeoHashUtils = require('../utils/geohash-utils');
            const regionHash = GeoHashUtils.getRegionHash(lat, lng, 5);

            // ✅ CORREÇÃO: Processar corridas pendentes PRIMEIRO para garantir que segunda corrida do teste seja processada
            logger.debug(`🔍 [ResponseHandler] Buscando próxima corrida para ${driverId} na região ${regionHash}`);
            
            const pendingQueueKey = `ride_queue:${regionHash}:pending`;
            let nextBookings = [];
            
            // Se há corridas pendentes, processar antes de buscar na fila ativa
            const pendingCount = await this.redis.zcard(pendingQueueKey);
            
            if (pendingCount > 0) {
                // Processar corridas pendentes (pode processar múltiplas)
                const processedPending = await rideQueueManager.processNextRides(regionHash, Math.min(pendingCount, 10));
                if (processedPending.length > 0) {
                    // Verificar se alguma das corridas processadas está dentro do raio
                    for (const bookingId of processedPending) {
                        const bookingKey = `booking:${bookingId}`;
                        const bookingData = await this.redis.hgetall(bookingKey);
                        
                        if (!bookingData || !bookingData.pickupLocation) {
                            continue;
                        }
                        
                        try {
                            const pickupLocation = JSON.parse(bookingData.pickupLocation);
                            if (pickupLocation && pickupLocation.lat && pickupLocation.lng) {
                                const distance = this.calculateDistance(
                                    lat,
                                    lng,
                                    pickupLocation.lat,
                                    pickupLocation.lng
                                ) / 1000; // Converter para km
                                
                                // Verificar se está dentro do raio máximo (5km)
                                if (distance > 5) {
                                    continue; // Pular esta corrida
                                }
                                
                                // ✅ Verificar se motorista pode receber esta corrida
                                const [alreadyNotified, isExcluded] = await Promise.all([
                                    this.redis.sismember(`ride_notifications:${bookingId}`, driverId),
                                    this.redis.sismember(`ride_excluded_drivers:${bookingId}`, driverId)
                                ]);
                                
                                // ✅ CORREÇÃO: Motorista pode receber se não está excluído E não foi notificado ainda
                                if (isExcluded) {
                                    logger.debug(`🚫 [ResponseHandler] Motorista ${driverId} está excluído da corrida pendente ${bookingId} (rejeitou anteriormente) - buscar próxima`);
                                    continue; // Buscar próxima corrida
                                }
                                
                                if (alreadyNotified) {
                                    logger.debug(`⚠️ [ResponseHandler] Motorista ${driverId} já foi notificado para corrida pendente ${bookingId} - buscar próxima`);
                                    continue; // Buscar próxima corrida (não a mesma)
                                }
                                
                                // ✅ Motorista pode receber esta corrida
                                nextBookings = [bookingId];
                                logger.info(`✅ [ResponseHandler] Corrida pendente ${bookingId} processada e encontrada para ${driverId} - dentro do raio`);
                                break;
                            }
                        } catch (e) {
                            continue;
                        }
                    }
                }
            }
            
            // 1. Se não encontrou em pendentes, buscar na fila ativa (corridas já em SEARCHING)
            // ✅ CORREÇÃO: Não importa o timestamp - corrida fica disponível até ser aceita ou cancelada
            // Verificar TODAS as corridas em SEARCHING, independente de quando foram criadas
            if (nextBookings.length === 0) {
                const activeQueueKey = `ride_queue:${regionHash}:active`;
                const activeBookings = await this.redis.hkeys(activeQueueKey);
                
                if (activeBookings && activeBookings.length > 0) {
                    // Verificar estados em batch
                    const RideStateManager = require('./ride-state-manager');
                    const stateChecks = activeBookings.map((bookingId) =>
                        RideStateManager.getBookingState(this.redis, bookingId).then(state => ({ bookingId, state }))
                    );
                    const stateResults = await Promise.all(stateChecks);
                    
                // Filtrar apenas corridas em SEARCHING/EXPANDED (disponíveis)
                const availableBookings = stateResults
                    .filter(({ state }) => state === RideStateManager.STATES.SEARCHING || state === RideStateManager.STATES.EXPANDED)
                    .map(({ bookingId }) => bookingId);
                
                logger.debug(`🔍 [ResponseHandler] ${availableBookings.length} corridas disponíveis (SEARCHING/EXPANDED) na fila ativa para ${driverId}`);
                
                // ✅ CORREÇÃO: Ordenar por timestamp de criação (mais antigas primeiro) para priorizar ordem cronológica
                // Isso garante que motorista receba corridas na ordem que foram criadas
                const bookingsWithTimestamp = [];
                for (const bookingId of availableBookings) {
                    const bookingKey = `booking:${bookingId}`;
                    const bookingData = await this.redis.hgetall(bookingKey);
                    if (bookingData) {
                        const timestamp = bookingData.createdAt || bookingData.activatedAt || '0';
                        bookingsWithTimestamp.push({ bookingId, timestamp });
                    } else {
                        bookingsWithTimestamp.push({ bookingId, timestamp: '0' });
                    }
                }
                
                // Ordenar por timestamp (mais antigas primeiro - ordem cronológica)
                bookingsWithTimestamp.sort((a, b) => {
                    const timeA = new Date(a.timestamp).getTime() || 0;
                    const timeB = new Date(b.timestamp).getTime() || 0;
                    return timeA - timeB; // Mais antigas primeiro
                });
                
                logger.debug(`🔍 [ResponseHandler] ${bookingsWithTimestamp.length} corridas disponíveis ordenadas por timestamp (mais antigas primeiro)`);
                
                // Verificar cada corrida disponível (ordem cronológica)
                for (const { bookingId } of bookingsWithTimestamp) {
                        // Buscar dados da corrida para verificar distância
                        const bookingKey = `booking:${bookingId}`;
                        const bookingData = await this.redis.hgetall(bookingKey);
                        
                        if (!bookingData || !bookingData.pickupLocation) {
                            continue; // Pular se não tem dados
                        }
                        
                        // ✅ Verificar se corrida está dentro do raio do motorista (5km máximo)
                        let pickupLocation;
                        try {
                            pickupLocation = JSON.parse(bookingData.pickupLocation);
                        } catch (e) {
                            continue; // Pular se não consegue parsear
                        }
                        
                        if (pickupLocation && pickupLocation.lat && pickupLocation.lng) {
                            const distance = this.calculateDistance(
                                lat,
                                lng,
                                pickupLocation.lat,
                                pickupLocation.lng
                            ) / 1000; // Converter para km
                            
                            // Verificar se está dentro do raio máximo (5km)
                            if (distance > 5) {
                                logger.debug(`⚠️ [ResponseHandler] Corrida ${bookingId} fora do raio (${distance.toFixed(2)}km > 5km) para ${driverId}`);
                                continue; // Pular esta corrida, buscar próxima
                            }
                        }
                        
                        // ✅ Verificar se motorista pode receber esta corrida
                            const [alreadyNotified, isExcluded] = await Promise.all([
                                this.redis.sismember(`ride_notifications:${bookingId}`, driverId),
                                this.redis.sismember(`ride_excluded_drivers:${bookingId}`, driverId)
                            ]);
                            
                        // ✅ CORREÇÃO: Motorista pode receber corrida se:
                        // 1. Não está excluído (não rejeitou esta corrida)
                        // 2. Se já foi notificado, verificar se tem notificação ativa na tela
                        //    - Se não tem notificação ativa, pode receber novamente (busca gradual pode ter notificado antes)
                        if (isExcluded) {
                            logger.debug(`🚫 [ResponseHandler] Motorista ${driverId} está excluído da corrida ${bookingId} (rejeitou anteriormente) - buscar próxima`);
                            continue; // Buscar próxima corrida
                        }
                        
                        // ✅ CORREÇÃO: Se já foi notificado, verificar se tem notificação ativa na tela
                        // Se não tem notificação ativa, pode receber novamente (busca gradual pode ter notificado antes da rejeição)
                        if (alreadyNotified) {
                            const activeNotificationKey = `driver_active_notification:${driverId}`;
                            const activeBookingId = await this.redis.get(activeNotificationKey);
                            
                            // Se não tem notificação ativa na tela, pode receber novamente
                            if (!activeBookingId || activeBookingId !== bookingId) {
                                logger.debug(`⚠️ [ResponseHandler] Motorista ${driverId} já foi notificado para ${bookingId}, mas não tem notificação ativa - pode receber novamente`);
                                // Continuar para permitir re-notificação
                            } else {
                                logger.debug(`⚠️ [ResponseHandler] Motorista ${driverId} já tem ${bookingId} na tela - buscar próxima corrida`);
                                continue; // Buscar próxima corrida (não a mesma que está na tela)
                            }
                        }
                        
                        // ✅ Motorista pode receber esta corrida
                        nextBookings = [bookingId];
                        logger.info(`✅ [ResponseHandler] Corrida ${bookingId} encontrada na fila ativa (SEARCHING) para ${driverId} - dentro do raio`);
                                break;
                    }
                }
            }
            
            if (!nextBookings || nextBookings.length === 0) {
                logger.warn(`⚠️ [ResponseHandler] Nenhuma corrida disponível na região ${regionHash} para ${driverId} (nem pendente nem ativa em SEARCHING)`);
                return null;
            }
            
            logger.info(`✅ [ResponseHandler] Corrida ${nextBookings[0]} encontrada para ${driverId}`);

            const bookingId = nextBookings[0];
            
            // 4. Buscar dados da corrida
            const bookingKey = `booking:${bookingId}`;
            const bookingData = await this.redis.hgetall(bookingKey);

            if (!bookingData || Object.keys(bookingData).length === 0) {
                logger.warn(`⚠️ [ResponseHandler] Dados da corrida ${bookingId} não encontrados`);
                return null;
            }

            // 5. Verificar se motorista já foi notificado para esta corrida
            const alreadyNotified = await this.redis.sismember(`ride_notifications:${bookingId}`, driverId);
            if (alreadyNotified) {
                logger.debug(`⚠️ [ResponseHandler] Motorista ${driverId} já foi notificado para ${bookingId}`);
                // Buscar próxima (recursivo)
                return await this.sendNextRideToDriver(driverId);
            }
            
            // ✅ NOVO: Verificar se motorista está excluído (cancelou/rejeitou esta corrida)
            const isExcluded = await this.redis.sismember(`ride_excluded_drivers:${bookingId}`, driverId);
            if (isExcluded) {
                logger.info(`🚫 [ResponseHandler] Motorista ${driverId} está excluído para ${bookingId} (cancelou/rejeitou anteriormente)`);
                // Buscar próxima (recursivo)
                return await this.sendNextRideToDriver(driverId);
            }

            // 6. Preparar dados da notificação
            const notificationData = {
                rideId: bookingId,
                bookingId,
                customerId: bookingData.customerId,
                pickupLocation: JSON.parse(bookingData.pickupLocation || '{}'),
                destinationLocation: JSON.parse(bookingData.destinationLocation || '{}'),
                estimatedFare: parseFloat(bookingData.estimatedFare || 0),
                paymentMethod: bookingData.paymentMethod || 'pix',
                timeout: 20, // ✅ REFATORAÇÃO: Alinhado com lock TTL (20s)
                timestamp: new Date().toISOString()
            };

            // ✅ CORREÇÃO TC-003: Verificar se busca já está ativa
            const RideStateManager = require('./ride-state-manager');
            const currentState = await RideStateManager.getBookingState(this.redis, bookingId);
            const parsedPickupLocation = JSON.parse(bookingData.pickupLocation || '{}');
            const searchKey = `booking_search:${bookingId}`;
            const existingSearch = await this.redis.hgetall(searchKey);
            const searchAlreadyActive = existingSearch && existingSearch.state && existingSearch.state !== 'STOPPED';
            
            if (parsedPickupLocation && parsedPickupLocation.lat && parsedPickupLocation.lng) {
                try {
                    // Se busca não está ativa e estado é válido, iniciar busca gradual
                    if (!searchAlreadyActive && (currentState === RideStateManager.STATES.SEARCHING || currentState === RideStateManager.STATES.PENDING)) {
                        await this.expander.startGradualSearch(bookingId, parsedPickupLocation);
                        logger.info(`🔍 [ResponseHandler] Busca gradual iniciada automaticamente para ${bookingId} (próxima corrida de ${driverId})`);
                    } else if (searchAlreadyActive) {
                        logger.info(`ℹ️ [ResponseHandler] Busca gradual já está ativa para ${bookingId}, notificando motorista diretamente`);
                    } else {
                        logger.debug(`ℹ️ [ResponseHandler] Estado inválido para iniciar busca gradual: ${currentState}`);
                    }
                } catch (error) {
                    logger.warn(`⚠️ [ResponseHandler] Erro ao verificar/iniciar busca gradual para ${bookingId}:`, error);
                    // Continuar mesmo se falhar
                }
            }

            // 8. Notificar motorista via dispatcher
            // ✅ CORREÇÃO TC-003: Sempre tentar notificar diretamente, especialmente se busca já está ativa
            // Se busca já está ativa, a busca gradual pode não notificar este motorista novamente
            
            // ✅ CORREÇÃO: Verificar condições antes de notificar (sem verificar lock)
            const alreadyNotifiedCheck = await this.redis.sismember(`ride_notifications:${bookingId}`, driverId);
            const isExcludedCheck = await this.redis.sismember(`ride_excluded_drivers:${bookingId}`, driverId);
            const activeNotificationKey = `driver_active_notification:${driverId}`;
            const activeBookingId = await this.redis.get(activeNotificationKey);
            
            logger.info(`🔍 [ResponseHandler] Verificações antes de notificar ${driverId} para ${bookingId}:`, {
                alreadyNotified: alreadyNotifiedCheck === 1,
                isExcluded: isExcludedCheck === 1,
                activeBookingId: activeBookingId,
                searchActive: searchAlreadyActive,
                currentState
            });
            
            const notified = await this.dispatcher.notifyDriver(
                driverId,
                bookingId,
                {
                    bookingId,
                    customerId: bookingData.customerId,
                    pickupLocation: parsedPickupLocation,
                    destinationLocation: JSON.parse(bookingData.destinationLocation || '{}'),
                    estimatedFare: parseFloat(bookingData.estimatedFare || 0),
                    paymentMethod: bookingData.paymentMethod || 'pix'
                }
            );

            if (notified) {
                logger.info(`📱 [ResponseHandler] Próxima corrida ${bookingId} enviada diretamente para motorista ${driverId}`);
                return notificationData;
            } else {
                // ✅ CORREÇÃO TC-003: Se notificação direta falhou, verificar por quê
                logger.warn(`⚠️ [ResponseHandler] Notificação direta falhou para ${driverId} (booking: ${bookingId})`);
                
                // Se busca já está ativa, aguardar um pouco para ver se busca gradual notifica
                if (searchAlreadyActive) {
                    logger.info(`ℹ️ [ResponseHandler] Busca gradual já está ativa para ${bookingId}, motorista pode ser notificado na próxima expansão`);
                } else {
                    logger.warn(`⚠️ [ResponseHandler] Busca gradual não está ativa e notificação direta falhou - motorista pode não receber corrida`);
                }
                
                // Retornar notificationData mesmo se notificação direta falhou, pois busca gradual pode notificar
                return notificationData;
            }
        } catch (error) {
            logger.error(`❌ [ResponseHandler] Erro ao enviar próxima corrida para ${driverId}:`, error);
            return null;
        }
    }

    /**
     * Liberar locks de outros motoristas que receberam notificação
     * (exceto o motorista que aceitou)
     * @param {string} bookingId - ID da corrida
     * @param {string} acceptedDriverId - ID do motorista que aceitou
     * @private
     */
    async releaseOtherDriversLocks(bookingId, acceptedDriverId) {
        try {
            // Buscar todos os motoristas notificados
            const notifiedDrivers = await this.redis.smembers(`ride_notifications:${bookingId}`);
            
            for (const driverId of notifiedDrivers) {
                if (driverId !== acceptedDriverId) {
                    // Verificar se tem lock para esta corrida
                    const lockStatus = await driverLockManager.isDriverLocked(driverId);
                    if (lockStatus.isLocked && lockStatus.bookingId === bookingId) {
                        // Liberar lock
                        await driverLockManager.releaseLock(driverId);
                        // Cancelar timeout
                        this.dispatcher.cancelDriverTimeout(driverId, bookingId);
                        logger.debug(`🔓 [ResponseHandler] Lock liberado para motorista ${driverId} (corrida aceita por outro)`);
                    }
                }
            }
        } catch (error) {
            logger.error(`❌ [ResponseHandler] Erro ao liberar locks de outros motoristas:`, error);
        }
    }

    /**
     * Calcular distância entre duas coordenadas (fórmula de Haversine)
     * @param {number} lat1 - Latitude do ponto 1
     * @param {number} lng1 - Longitude do ponto 1
     * @param {number} lat2 - Latitude do ponto 2
     * @param {number} lng2 - Longitude do ponto 2
     * @returns {number} Distância em metros
     */
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // Raio da Terra em metros
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // Retorna em metros
    }
}

module.exports = ResponseHandler;

