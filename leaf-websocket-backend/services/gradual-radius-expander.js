/**
 * GRADUAL RADIUS EXPANDER
 * 
 * Implementa expansão gradual de raio para notificar motoristas
 * progressivamente, começando pelos mais próximos.
 * 
 * Fluxo:
 * T=0s: 0.5km → notificar 5 motoristas
 * T=5s: 1km → notificar próximos 5 (se nenhum aceitou)
 * T=10s: 1.5km → notificar próximos 5
 * ... até 3km
 */

const redisPool = require('../utils/redis-pool');
const RideStateManager = require('./ride-state-manager');
const eventSourcing = require('./event-sourcing');
const { EVENT_TYPES } = require('./event-sourcing');
const driverLockManager = require('./driver-lock-manager');
const DriverNotificationDispatcher = require('./driver-notification-dispatcher');
const { logger } = require('../utils/logger');

class GradualRadiusExpander {
    constructor(io) {
        this.redis = redisPool.getConnection();
        this.io = io;
        this.expansionIntervals = new Map(); // bookingId -> timeoutId
        this.dispatcher = new DriverNotificationDispatcher(io); // Usar dispatcher com scoring
        
        // Configurações de expansão
        this.config = {
            initialRadius: 0.5, // km
            maxRadius: 3, // km
            expansionStep: 0.5, // km
            expansionInterval: 5, // segundos
            driversPerWave: 5 // motoristas por wave
        };
    }

    /**
     * Iniciar busca gradual para uma corrida
     * @param {string} bookingId - ID da corrida
     * @param {Object} pickupLocation - { lat, lng }
     * @returns {Promise<void>}
     */
    async startGradualSearch(bookingId, pickupLocation) {
        try {
            // ✅ REFATORAÇÃO: Verificar se busca já está ativa (evitar duplicação)
            const searchKey = `booking_search:${bookingId}`;
            const existingSearch = await this.redis.hgetall(searchKey);
            
            if (existingSearch && existingSearch.state && existingSearch.state !== 'STOPPED') {
                logger.debug(`ℹ️ [GradualExpander] Busca já está ativa para ${bookingId} (state: ${existingSearch.state})`);
                return; // Busca já está rodando, não iniciar novamente
            }

            // Verificar se corrida ainda está válida
            const state = await RideStateManager.getBookingState(this.redis, bookingId);
            // ✅ PAUSAR: Se está em NOTIFIED, não iniciar busca (aguardar resposta)
            if (state === RideStateManager.STATES.NOTIFIED || state === RideStateManager.STATES.AWAITING_RESPONSE) {
                logger.debug(`⏸️ [GradualExpander] Corrida ${bookingId} está em NOTIFIED, pausando busca (aguardando resposta)`);
                return;
            }
            if (state !== RideStateManager.STATES.SEARCHING && state !== RideStateManager.STATES.PENDING && state !== RideStateManager.STATES.EXPANDED) {
                logger.warn(`⚠️ [GradualExpander] Corrida ${bookingId} não está em estado válido para busca (state: ${state})`);
                return;
            }

            // Armazenar estado da busca
            await this.redis.hset(searchKey, {
                currentRadius: this.config.initialRadius,
                maxRadius: this.config.maxRadius,
                expansionInterval: this.config.expansionInterval,
                pickupLocation: JSON.stringify(pickupLocation),
                createdAt: Date.now(),
                lastExpansion: Date.now(),
                state: 'SEARCHING'
            });

            // Primeira busca imediata (0.5km)
            await this.searchAndNotify(
                bookingId,
                pickupLocation,
                this.config.initialRadius,
                this.config.driversPerWave
            );

            // Agendar próxima expansão
            this.scheduleNextExpansion(
                bookingId,
                pickupLocation,
                this.config.initialRadius + this.config.expansionStep,
                this.config.maxRadius,
                this.config.expansionInterval,
                this.config.driversPerWave
            );

            // Registrar evento
            await eventSourcing.recordEvent(
                EVENT_TYPES.DRIVER_SEARCH_STARTED,
                {
                    bookingId,
                    initialRadius: this.config.initialRadius,
                    pickupLocation
                }
            );

            logger.info(`🔍 Busca gradual iniciada para ${bookingId} (raio inicial: ${this.config.initialRadius}km)`);
        } catch (error) {
            logger.error(`❌ Erro ao iniciar busca gradual para ${bookingId}:`, error);
            throw error;
        }
    }

    /**
     * Buscar e notificar motoristas em um raio específico
     * Usa DriverNotificationDispatcher com algoritmo de score
     * @param {string} bookingId - ID da corrida
     * @param {Object} pickupLocation - { lat, lng }
     * @param {number} radius - Raio em km
     * @param {number} limit - Limite de motoristas para notificar
     * @returns {Promise<{notified: number, total: number}>}
     */
    async searchAndNotify(bookingId, pickupLocation, radius, limit) {
        try {
            logger.debug(`🔍 [GradualExpander] Buscando motoristas em ${radius}km para ${bookingId}`);

            // 1. Buscar motoristas e calcular scores usando dispatcher
            const scoredDrivers = await this.dispatcher.findAndScoreDrivers(
                pickupLocation,
                radius,
                limit,
                bookingId
            );

            if (scoredDrivers.length === 0) {
                logger.warn(`⚠️ [GradualExpander] Nenhum motorista encontrado em ${radius}km para ${bookingId}`);
                // ✅ DEBUG: Verificar motoristas no Redis
                const allDrivers = await this.redis.zrange('driver_locations', 0, -1);
                logger.info(`🔍 [GradualExpander] DEBUG: Total de motoristas no Redis: ${allDrivers.length}`);
                return { notified: 0, total: 0 };
            }
            
            logger.info(`✅ [GradualExpander] ${scoredDrivers.length} motoristas encontrados em ${radius}km para ${bookingId}`);

            // 2. Buscar dados completos da corrida
            const bookingKey = `booking:${bookingId}`;
            const bookingData = await this.redis.hgetall(bookingKey);
            
            // Parse seguro de JSON (pode já ser objeto)
            let parsedPickupLocation = pickupLocation;
            if (bookingData.pickupLocation) {
                try {
                    parsedPickupLocation = typeof bookingData.pickupLocation === 'string' 
                        ? JSON.parse(bookingData.pickupLocation) 
                        : bookingData.pickupLocation;
                } catch (e) {
                    // Se falhar, usar pickupLocation passado como parâmetro
                    parsedPickupLocation = pickupLocation;
                }
            }
            
            let parsedDestinationLocation = {};
            if (bookingData.destinationLocation) {
                try {
                    parsedDestinationLocation = typeof bookingData.destinationLocation === 'string'
                        ? JSON.parse(bookingData.destinationLocation)
                        : bookingData.destinationLocation;
                } catch (e) {
                    parsedDestinationLocation = {};
                }
            }
            
            const bookingInfo = {
                bookingId,
                customerId: bookingData.customerId,
                pickupLocation: parsedPickupLocation,
                destinationLocation: parsedDestinationLocation,
                estimatedFare: parseFloat(bookingData.estimatedFare || 0),
                paymentMethod: bookingData.paymentMethod || 'pix'
            };

            // 3. Notificar motoristas usando dispatcher (com locks e timeouts)
            const result = await this.dispatcher.notifyMultipleDrivers(
                scoredDrivers,
                bookingId,
                bookingInfo
            );

            logger.info(`✅ [GradualExpander] ${result.notified}/${scoredDrivers.length} motoristas notificados em ${radius}km`);

            return { notified: result.notified, total: scoredDrivers.length };
        } catch (error) {
            logger.error(`❌ Erro ao buscar e notificar motoristas para ${bookingId}:`, error);
            return { notified: 0, total: 0 };
        }
    }

    /**
     * Agendar próxima expansão de raio
     * ✅ REFATORAÇÃO: Simplificado - apenas uma verificação de estado por ciclo
     * @private
     */
    scheduleNextExpansion(bookingId, pickupLocation, nextRadius, maxRadius, interval, limit) {
        // Cancelar expansão anterior se existir
        const existingTimeout = this.expansionIntervals.get(bookingId);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Verificar se atingiu raio máximo
        if (nextRadius > maxRadius) {
            logger.info(`🏁 [GradualExpander] Raio máximo (${maxRadius}km) atingido para ${bookingId}`);
            this.handleMaxRadiusReached(bookingId);
            return;
        }

        // Agendar próxima expansão
        const expansionTimeout = setTimeout(async () => {
            try {
                // ✅ CORREÇÃO: Estado sempre é SEARCHING enquanto busca motoristas
                const state = await RideStateManager.getBookingState(this.redis, bookingId);
                
                // Se estado é SEARCHING ou EXPANDED, continuar expansão normalmente
                if (state === RideStateManager.STATES.SEARCHING || state === RideStateManager.STATES.EXPANDED) {
                    // Continuar normalmente - buscar e notificar no novo raio
                } else {
                    // Corrida já foi aceita ou cancelada
                    logger.debug(`🛑 [GradualExpander] Busca parada para ${bookingId} (state: ${state})`);
                    this.expansionIntervals.delete(bookingId);
                    return;
                }

                // Buscar e notificar no novo raio
                const result = await this.searchAndNotify(
                    bookingId,
                    pickupLocation,
                    nextRadius,
                    limit
                );

                // Atualizar estado
                const searchKey = `booking_search:${bookingId}`;
                await this.redis.hset(searchKey, {
                    currentRadius: nextRadius,
                    lastExpansion: Date.now()
                });

                // FASE 10: Registrar expansão para métricas
                const metricsCollector = require('./metrics-collector');
                await metricsCollector.recordRadiusExpansion(bookingId, nextRadius, Date.now());

                // Registrar evento
                await eventSourcing.recordEvent(
                    EVENT_TYPES.RADIUS_EXPANDED,
                    {
                        bookingId,
                        newRadius: nextRadius,
                        notified: result.notified,
                        total: result.total
                    }
                );

                // Se nenhum motorista foi encontrado, expandir mais rápido
                if (result.total === 0 && nextRadius < maxRadius) {
                    logger.debug(`⚡ [GradualExpander] Raio vazio em ${nextRadius}km, expandindo imediatamente`);
                    // Expandir imediatamente para próximo raio
                    this.scheduleNextExpansion(
                        bookingId,
                        pickupLocation,
                        nextRadius + 0.5,
                        maxRadius,
                        0, // Imediato
                        limit
                    );
                } else {
                    // Agendar próxima expansão normal
                    this.scheduleNextExpansion(
                        bookingId,
                        pickupLocation,
                        nextRadius + 0.5,
                        maxRadius,
                        interval,
                        limit
                    );
                }

                this.expansionIntervals.delete(bookingId);
            } catch (error) {
                logger.error(`❌ Erro na expansão agendada para ${bookingId}:`, error);
                this.expansionIntervals.delete(bookingId);
            }
        }, interval * 1000);

        this.expansionIntervals.set(bookingId, expansionTimeout);
        
        logger.debug(`⏰ [GradualExpander] Próxima expansão agendada para ${bookingId} (raio: ${nextRadius}km em ${interval}s)`);
    }

    // ✅ REFATORAÇÃO: Método scheduleResumeCheck removido
    // Retomada de busca agora é gerenciada apenas por scheduleNextExpansion
    // Dispatcher é responsável por atualizar estado para SEARCHING após timeout

    /**
     * Parar busca e limpar timeouts
     * @param {string} bookingId - ID da corrida
     * @returns {Promise<void>}
     */
    async stopSearch(bookingId) {
        try {
            // Cancelar expansões agendadas
            const timeout = this.expansionIntervals.get(bookingId);
            if (timeout) {
                clearTimeout(timeout);
                this.expansionIntervals.delete(bookingId);
            }

            // Limpar todos os timeouts de resposta dos motoristas
            this.dispatcher.clearAllTimeouts(bookingId);

            // ✅ CORREÇÃO TC-006: Liberar todos os locks dos motoristas notificados
            const driverLockManager = require('./driver-lock-manager');
            const notifiedDrivers = await this.redis.smembers(`ride_notifications:${bookingId}`);
            
            for (const driverId of notifiedDrivers) {
                const lockStatus = await driverLockManager.isDriverLocked(driverId);
                if (lockStatus.isLocked && lockStatus.bookingId === bookingId) {
                    await driverLockManager.releaseLock(driverId);
                    logger.debug(`🔓 [GradualExpander] Lock liberado para motorista ${driverId} (corrida cancelada)`);
                }
            }

            // Atualizar estado da busca
            const searchKey = `booking_search:${bookingId}`;
            await this.redis.hset(searchKey, {
                state: 'STOPPED',
                stoppedAt: Date.now()
            });

            // Registrar evento
            await eventSourcing.recordEvent(
                EVENT_TYPES.DRIVER_SEARCH_STOPPED,
                { bookingId }
            );

            logger.info(`🛑 [GradualExpander] Busca parada para ${bookingId}`);
        } catch (error) {
            logger.error(`❌ Erro ao parar busca para ${bookingId}:`, error);
        }
    }


    /**
     * Handler quando raio máximo é atingido
     * @private
     */
    async handleMaxRadiusReached(bookingId) {
        const bookingKey = `booking:${bookingId}`;
        const bookingData = await this.redis.hgetall(bookingKey);
        
        // Notificar customer sobre busca expandida
        if (this.io && bookingData.customerId) {
            this.io.to(`customer_${bookingData.customerId}`).emit('rideSearchExpanded', {
                bookingId,
                message: 'Buscando motoristas em área expandida',
                currentRadius: this.config.maxRadius
            });
        }

        logger.info(`📈 [GradualExpander] Raio máximo atingido para ${bookingId}, notificando customer`);
    }
}

module.exports = GradualRadiusExpander;

