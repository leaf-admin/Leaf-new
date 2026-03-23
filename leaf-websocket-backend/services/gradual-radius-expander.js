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

// ✅ Compartilhar intervalos entre instâncias para permitir cancelamento global
const globalExpansionIntervals = new Map();
const ACTIVE_SEARCH_STATES = new Set(['PENDING', 'SEARCHING', 'EXPANDED', 'NOTIFIED', 'AWAITING_RESPONSE', 'REJECTED']);
const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';

const parsePositiveNumber = (value, fallback) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

class GradualRadiusExpander {
    constructor(io) {
        this.redis = redisPool.getConnection();
        this.io = io;
        this.expansionIntervals = globalExpansionIntervals; // Usar Map global
        this.dispatcher = new DriverNotificationDispatcher(this.redis, io); // Usar dispatcher com scoring

        // Configurações padrão
        const isTest = process.env.NODE_ENV === 'test';
        this.config = {
            // Defaults priorizam resposta rápida; todos podem ser ajustados por env.
            initialRadius: parsePositiveNumber(process.env.MATCH_INITIAL_RADIUS_KM, isTest ? 5.0 : 1.0),
            maxRadius: parsePositiveNumber(process.env.MATCH_MAX_RADIUS_KM, 30),
            expansionStep: parsePositiveNumber(process.env.MATCH_EXPANSION_STEP_KM, isTest ? 5.0 : 1.0),
            expansionInterval: parsePositiveNumber(process.env.MATCH_EXPANSION_INTERVAL_MS, isTest ? 1000 : 700),
            maxWaves: 60,
            searchStateTTL: 3600, // 1h
            driversPerWave: Number.parseInt(process.env.MATCH_DRIVERS_PER_WAVE || (isTest ? '1' : '12'), 10)
        };
    }

    /**
     * Parse seguro para JSON
     * @private
     */
    safeJSONParse(data, defaultValue = {}) {
        if (!data) return defaultValue;
        if (typeof data === 'object') return data;
        try {
            return JSON.parse(data);
        } catch (error) {
            return defaultValue;
        }
    }

    async getSearchDispatchability(bookingId, bookingData = null) {
        const booking = bookingData && Object.keys(bookingData).length > 0
            ? bookingData
            : await this.redis.hgetall(`booking:${bookingId}`);

        if (!booking || Object.keys(booking).length === 0) {
            return { ok: false, reason: 'BOOKING_NOT_FOUND' };
        }

        const state = await RideStateManager.getBookingState(this.redis, bookingId);
        const status = String(booking.status || '').toUpperCase();
        if (!state || !ACTIVE_SEARCH_STATES.has(state)) {
            return { ok: false, reason: 'STATE_NOT_SEARCHABLE', state, status, bookingData: booking };
        }

        if (status === 'SUPERSEDED' || status === 'CANCELED' || status === 'COMPLETED' || status === 'NO_DRIVERS_AVAILABLE') {
            return { ok: false, reason: 'BOOKING_STATUS_BLOCKED', state, status, bookingData: booking };
        }

        const customerId = booking.customerId;
        if (customerId) {
            const activeBookingId = await this.redis.get(`customer_active_booking:${customerId}`);
            if (activeBookingId && activeBookingId !== bookingId) {
                return {
                    ok: false,
                    reason: 'STALE_CUSTOMER_ACTIVE_BOOKING',
                    state,
                    status,
                    customerId,
                    activeBookingId,
                    bookingData: booking
                };
            }
        }

        return { ok: true, state, status, bookingData: booking };
    }

    async hasEligibleDriversNearby(pickupLocation, radiusKm) {
        const parsedPickup = this.safeJSONParse(pickupLocation, null);
        const lat = Number(parsedPickup?.lat);
        const lng = Number(parsedPickup?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return false;
        }

        const nearby = await this.redis.georadius(
            ELIGIBLE_DRIVER_GEO_KEY,
            lng,
            lat,
            radiusKm,
            'km',
            'COUNT',
            1
        );
        return Array.isArray(nearby) && nearby.length > 0;
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

            const dispatchability = await this.getSearchDispatchability(bookingId);
            if (!dispatchability.ok) {
                logger.info(`ℹ️ [GradualExpander] Busca não iniciada para ${bookingId}: ${dispatchability.reason}`);
                return;
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

            // Se não há nenhum motorista elegível ativo na região de busca, encerra imediatamente.
            const hasEligibleDrivers = await this.hasEligibleDriversNearby(pickupLocation, this.config.maxRadius);
            if (!hasEligibleDrivers) {
                logger.info(`ℹ️ [GradualExpander] Corrida ${bookingId}: sem motoristas elegíveis ativos no raio ${this.config.maxRadius}km`);
                await this.handleMaxRadiusReached(bookingId, {
                    reason: 'NO_ELIGIBLE_DRIVERS_IN_REGION',
                    searchedRadius: this.config.maxRadius
                });
                return;
            }

            // Armazenar estado da busca
            await this.redis.hset(searchKey, {
                currentRadius: this.config.initialRadius,
                maxRadius: this.config.maxRadius,
                expansionInterval: this.config.expansionInterval,
                pickupLocation: typeof pickupLocation === 'string' ? pickupLocation : JSON.stringify(pickupLocation),
                createdAt: Date.now(),
                lastExpansion: Date.now(),
                state: 'SEARCHING'
            });
            await this.redis.expire(searchKey, 3600); // 1h de TTL de segurança

            // Primeira busca imediata (0.5km)
            await this.searchAndNotify(
                bookingId,
                pickupLocation,
                this.config.initialRadius,
                this.config.driversPerWave
            );

            // 🔍 LOG PARA DEPURAÇÃO
            // Note: `this.currentRadius` and `bookingData` are not class properties or available here.
            // Assuming the intent was to log the initial radius and max radius from config.
            logger.info(`🔄 [GradualExpander] Wave para ${bookingId}: Raio atual ${this.config.initialRadius}km / Max ${this.config.maxRadius}km`);

            // The following block seems to be from a different logic flow (e.g., a loop or a different method).
            // It's not directly applicable here as `this.currentRadius` is not a property and `bookingData` is not defined.
            // Also, `handleMaxRadiusReached` and `scheduleExpansion` are not called with these parameters in the original code.
            // If the intention was to add a check for max radius and then schedule the next expansion,
            // the existing `scheduleNextExpansion` call already handles that.
            // For now, I'm only adding the log as requested and omitting the structural changes that would break the current flow.

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

            logger.info(`🔍 Busca gradual iniciada para ${bookingId} (raio inicial: ${this.config.initialRadius}km, max: ${this.config.maxRadius}km)`);
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
            const bookingKey = `booking:${bookingId}`;
            const bookingData = await this.redis.hgetall(bookingKey);
            const dispatchability = await this.getSearchDispatchability(bookingId, bookingData);
            if (!dispatchability.ok) {
                logger.info(`ℹ️ [GradualExpander] Encerrando busca de ${bookingId} em searchAndNotify: ${dispatchability.reason}`);
                await this.stopSearch(bookingId);
                return { notified: 0, total: 0 };
            }
            const safeBookingData = dispatchability.bookingData;

            const scoredDrivers = await this.dispatcher.findAndScoreDrivers(
                pickupLocation,
                radius,
                limit,
                bookingId,
                {}
            );

            if (scoredDrivers.length === 0) {
                return { notified: 0, total: 0 };
            }

            logger.info(`✅ [GradualExpander] ${scoredDrivers.length} motoristas encontrados em ${radius}km para ${bookingId}`);

            // 2. Buscar dados completos da corrida
            // Parse seguro de JSON usando helper
            const parsedPickupLocation = this.safeJSONParse(safeBookingData.pickupLocation, pickupLocation);
            const parsedDestinationLocation = this.safeJSONParse(safeBookingData.destinationLocation, {});

            const bookingInfo = {
                bookingId,
                customerId: safeBookingData.customerId,
                pickupLocation: parsedPickupLocation,
                destinationLocation: parsedDestinationLocation,
                estimatedFare: parseFloat(safeBookingData.estimatedFare || 0),
                carType: safeBookingData.carType || null,
                paymentMethod: safeBookingData.paymentMethod || 'pix'
            };

            // 3. Notificar motoristas usando dispatcher (com locks e timeouts)
            const result = await this.dispatcher.notifyMultipleDrivers(
                scoredDrivers,
                bookingId,
                bookingInfo,
                limit
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
            logger.info(`🏁 [GradualExpander] Raio máximo (${maxRadius}km) atingido para ${bookingId}.`);
            this.expansionIntervals.delete(bookingId);
            this.handleMaxRadiusReached(bookingId);
            return;
        }

        logger.info(`📡 [GradualExpander] Agendada WAVE para ${bookingId}: próximo raio ${nextRadius}km em ${interval}ms`);

        // Agendar próxima expansão
        const expansionTimeout = setTimeout(async () => {
            try {
                // ✅ PROTEÇÃO CONTRA RACE CONDITION: Se a busca foi parada localmente, abortar
                if (!this.expansionIntervals.has(bookingId)) {
                    logger.debug(`🛑 [GradualExpander] Wave para ${bookingId} cancelada (não está no Map local)`);
                    return;
                }

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

                const dispatchability = await this.getSearchDispatchability(bookingId);
                if (!dispatchability.ok) {
                    logger.info(`🛑 [GradualExpander] Encerrando wave de ${bookingId}: ${dispatchability.reason}`);
                    await this.stopSearch(bookingId);
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

                // ✅ PROTEÇÃO PÓS-NOTIFY: Verificar novamente se não foi parado durante o await
                if (!this.expansionIntervals.has(bookingId)) {
                    logger.debug(`🛑 [GradualExpander] Wave para ${bookingId} descartada (parada durante busca)`);
                    return;
                }

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

                // Se nenhum motorista foi encontrado, expandir mais rápido (100ms em vez de 0 para evitar starvation)
                if (result.total === 0 && nextRadius < maxRadius) {
                    logger.debug(`⚡ [GradualExpander] Raio vazio em ${nextRadius}km, expandindo em 100ms`);
                    this.scheduleNextExpansion(
                        bookingId,
                        pickupLocation,
                        nextRadius + this.config.expansionStep,
                        maxRadius,
                        100, // 100ms
                        limit
                    );
                } else {
                    // Agendar próxima expansão normal
                    this.scheduleNextExpansion(
                        bookingId,
                        pickupLocation,
                        nextRadius + this.config.expansionStep,
                        maxRadius,
                        interval,
                        limit
                    );
                }

                // Próxima expansão já foi agendada por scheduleNextExpansion dentro dos blocos acima.
                // Não deletar daqui, pois deletaria a próxima wave agendada!
            } catch (error) {
                logger.error(`❌ Erro na expansão agendada para ${bookingId}:`, error);
                this.expansionIntervals.delete(bookingId);
            }
        }, interval); // ✅ FIX: Removido * 1000, interval já está em ms

        this.expansionIntervals.set(bookingId, expansionTimeout);

        logger.debug(`⏰ [GradualExpander] Próxima expansão agendada para ${bookingId} (raio: ${nextRadius}km em ${interval}ms)`);
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
                // 1. Liberar lock se for desta corrida
                const lockStatus = await driverLockManager.isDriverLocked(driverId);
                if (lockStatus.isLocked && lockStatus.bookingId === bookingId) {
                    await driverLockManager.releaseLock(driverId);
                    logger.debug(`🔓 [GradualExpander] Lock liberado para motorista ${driverId} (corrida cancelada)`);
                }

                // 2. Limpar corrida ativa na tela (sempre que a busca para)
                const activeNotificationKey = `driver_active_notification:${driverId}`;
                const activeBookingId = await this.redis.get(activeNotificationKey);
                if (activeBookingId === bookingId) {
                    await this.redis.del(activeNotificationKey);
                    logger.debug(`📱 [GradualExpander] Notificação limpa na tela do motorista ${driverId}`);
                }
            }

            // ✅ CORREÇÃO: Deletar a chave em vez de apenas marcar STOPPED para evitar vazamento
            const searchKey = `booking_search:${bookingId}`;
            await this.redis.del(searchKey);

            // Evitar crescimento infinito de chaves históricas de notificação.
            await this.redis.expire(`ride_notifications:${bookingId}`, 600);
            await this.redis.expire(`ride_excluded_drivers:${bookingId}`, 600);

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
    async handleMaxRadiusReached(bookingId, options = {}) {
        const reasonCode = options?.reason || 'NO_DRIVERS_AVAILABLE';
        const searchedRadius = Number.isFinite(Number(options?.searchedRadius))
            ? Number(options.searchedRadius)
            : this.config.maxRadius;
        const userMessage = reasonCode === 'NO_ELIGIBLE_DRIVERS_IN_REGION'
            ? 'Não há motoristas ativos na sua região neste momento'
            : 'Nenhum motorista disponível no momento';
        const bookingKey = `booking:${bookingId}`;
        const bookingData = await this.redis.hgetall(bookingKey);

        // Se corrida já foi aceita/cancelada durante a expansão, não emitir falha de busca.
        const currentState = await RideStateManager.getBookingState(this.redis, bookingId);
        const activeSearchStates = new Set([
            RideStateManager.STATES.PENDING,
            RideStateManager.STATES.SEARCHING,
            RideStateManager.STATES.EXPANDED,
            RideStateManager.STATES.NOTIFIED,
            RideStateManager.STATES.AWAITING_RESPONSE
        ]);

        if (!activeSearchStates.has(currentState)) {
            logger.info(`ℹ️ [GradualExpander] Raio máximo atingido para ${bookingId}, mas estado atual é ${currentState}. Ignorando noDriversFound.`);
            return;
        }

        const dispatchability = await this.getSearchDispatchability(bookingId, bookingData);
        if (!dispatchability.ok && dispatchability.reason === 'STALE_CUSTOMER_ACTIVE_BOOKING') {
            await this.stopSearch(bookingId);
            logger.info(`ℹ️ [GradualExpander] Corrida ${bookingId} já supersedida por ${dispatchability.activeBookingId}, encerrando sem notificar cliente.`);
            return;
        }

        // Notificar customer sobre busca expandida + finalização sem motoristas
        if (this.io && bookingData.customerId) {
            this.io.to(`customer_${bookingData.customerId}`).emit('rideSearchExpanded', {
                bookingId,
                message: 'Buscando motoristas em área expandida',
                currentRadius: this.config.maxRadius
            });

            this.io.to(`customer_${bookingData.customerId}`).emit('noDriversFound', {
                success: false,
                bookingId,
                message: userMessage,
                code: reasonCode,
                searchedRadius
            });
        }

        // Marcar estado final da busca e limpar recursos.
        try {
            await this.redis.hset(bookingKey, {
                noDriversFoundAt: new Date().toISOString(),
                noDriversFoundReason: reasonCode,
                status: 'NO_DRIVERS_AVAILABLE'
            });
            await RideStateManager.updateBookingState(
                this.redis,
                bookingId,
                RideStateManager.STATES.CANCELED,
                {
                    canceledBy: 'system',
                    reason: reasonCode,
                    cancelledAt: new Date().toISOString()
                }
            );

            if (bookingData.customerId) {
                const activeKey = `customer_active_booking:${bookingData.customerId}`;
                const activeBookingId = await this.redis.get(activeKey);
                if (activeBookingId === bookingId) {
                    await this.redis.del(activeKey);
                }
            }
        } catch (error) {
            logger.warn(`⚠️ [GradualExpander] Falha ao persistir metadata de noDriversFound para ${bookingId}: ${error.message}`);
        }

        try {
            const rideQueueManager = require('./ride-queue-manager');
            await rideQueueManager.dequeueRide(bookingId);
        } catch (queueError) {
            logger.warn(`⚠️ [GradualExpander] Falha ao remover corrida ${bookingId} da fila após noDriversFound: ${queueError.message}`);
        }

        await this.stopSearch(bookingId);
        logger.info(`📈 [GradualExpander] Busca encerrada para ${bookingId} com noDriversFound (${reasonCode})`);
    }
}

module.exports = GradualRadiusExpander;
