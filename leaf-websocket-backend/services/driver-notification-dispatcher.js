/**
 * DRIVER NOTIFICATION DISPATCHER
 * 
 * Responsável por buscar motoristas, calcular scores e enviar notificações
 * via WebSocket com locks para prevenir duplicatas.
 * 
 * Algoritmo de Score:
 * - Distância: 40%
 * - Rating: 20%
 * - Acceptance Rate: 20%
 * - Response Time: 20%
 */

const redisPool = require('../utils/redis-pool');
const driverLockManager = require('./driver-lock-manager');
const eventSourcing = require('./event-sourcing');
const { EVENT_TYPES } = require('./event-sourcing');
const { logger, logStructured, logError } = require('../utils/logger');
const { performance } = require('perf_hooks');

class DriverNotificationDispatcher {
    constructor(io) {
        this.redis = redisPool.getConnection();
        this.io = io;
        this.timeoutHandlers = new Map(); // bookingId_driverId -> timeoutId

        // Configurações de score
        this.scoreWeights = {
            distance: 0.40,    // 40%
            rating: 0.20,      // 20%
            acceptanceRate: 0.20, // 20%
            responseTime: 0.20  // 20%
        };
    }

    /**
     * Buscar motoristas próximos e calcular scores
     * @param {Object} pickupLocation - { lat, lng }
     * @param {number} radius - Raio em km
     * @param {number} limit - Limite de motoristas
     * @param {string} bookingId - ID da corrida
     * @returns {Promise<Array>} Array de motoristas com scores ordenados
     */
    async findAndScoreDrivers(pickupLocation, radius, limit, bookingId) {
        try {
            logger.debug(`🔍 [Dispatcher] Buscando motoristas em ${radius}km para ${bookingId}`);

            const startTime = performance.now();

            // 1. Tentar buscar do cache geoespacial primeiro
            const geospatialCache = require('./geospatial-cache');
            const cachedDrivers = await geospatialCache.get(pickupLocation.lat, pickupLocation.lng, radius);

            let nearbyDrivers;
            if (cachedDrivers && cachedDrivers.length > 0) {
                // Usar cache (retornar em formato compatível com georadius)
                logger.debug(`✅ [Dispatcher] Cache HIT para ${bookingId} (raio: ${radius}km)`);
                nearbyDrivers = cachedDrivers.map(d => [d.driverId, d.distance, [d.coordinates.lng, d.coordinates.lat]]);
            } else {
                // Cache miss - buscar do Redis GEO
                nearbyDrivers = await this.redis.georadius(
                    'driver_locations',
                    pickupLocation.lng,
                    pickupLocation.lat,
                    radius,
                    'km',
                    'WITHCOORD',
                    'WITHDIST',
                    'COUNT',
                    100 // Buscar mais para filtrar e calcular scores
                );
            }

            if (!nearbyDrivers || nearbyDrivers.length === 0) {
                logger.warn(`⚠️ [Dispatcher] Nenhum motorista encontrado em ${radius}km para ${bookingId}`);
                // ✅ DEBUG: Verificar se há motoristas no Redis
                const allDrivers = await this.redis.zrange('driver_locations', 0, -1);
                logger.info(`🔍 [Dispatcher] DEBUG: Total de motoristas no Redis: ${allDrivers.length}`);
                if (allDrivers.length > 0) {
                    logger.info(`🔍 [Dispatcher] DEBUG: Motoristas no Redis: ${allDrivers.slice(0, 5).join(', ')}...`);
                }
                return [];
            }

            logger.info(`✅ [Dispatcher] Encontrados ${nearbyDrivers.length} motoristas em ${radius}km para ${bookingId}`);

            // 2. Filtrar motoristas já notificados para esta corrida
            const notifiedDriverIds = await this.redis.smembers(`ride_notifications:${bookingId}`);
            const notifiedSet = new Set(notifiedDriverIds);

            // 3. Buscar dados completos e calcular scores
            const scoredDrivers = [];

            for (const driver of nearbyDrivers) {
                const driverId = driver[0];
                const distance = parseFloat(driver[1]);
                const coordinates = {
                    lng: parseFloat(driver[2][0]),
                    lat: parseFloat(driver[2][1])
                };

                // Pular se já foi notificado
                if (notifiedSet.has(driverId)) {
                    continue;
                }

                // ✅ CORREÇÃO: Verificar se motorista tem lock (corrida em andamento)
                // Não verificar corrida ativa na tela aqui (pode receber múltiplas se rejeitar)
                const lockStatus = await driverLockManager.isDriverLocked(driverId);
                if (lockStatus.isLocked) {
                    continue; // Motorista ocupado com corrida em andamento
                }

                // Buscar dados do motorista para calcular score
                const driverData = await this.getDriverData(driverId);

                // ✅ Verificar status (aceitar 'AVAILABLE', 'available', 'online')
                const isAvailable = driverData &&
                    driverData.isOnline &&
                    (driverData.status === 'AVAILABLE' ||
                        driverData.status === 'available' ||
                        driverData.status === 'online' ||
                        !driverData.status); // Se não tem status, assumir disponível

                if (!isAvailable) {
                    logger.debug(`⚠️ [Dispatcher] Motorista ${driverId} não disponível: isOnline=${driverData?.isOnline}, status=${driverData?.status}`);
                    continue; // Motorista offline ou não disponível
                }

                // Calcular score completo
                const score = await this.calculateDriverScore(
                    driverId,
                    distance,
                    driverData,
                    bookingId
                );

                scoredDrivers.push({
                    driverId,
                    distance,
                    coordinates,
                    score,
                    rating: driverData.rating || 5.0,
                    acceptanceRate: driverData.acceptanceRate || 50.0,
                    responseTime: driverData.avgResponseTime || 5.0,
                    totalTrips: driverData.totalTrips || 0
                });
            }

            // 4. Ordenar por score (maior primeiro) e retornar top N
            const topDrivers = scoredDrivers
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            // 5. Armazenar no cache geoespacial (apenas se não veio do cache)
            if (!cachedDrivers || cachedDrivers.length === 0) {
                const driversForCache = topDrivers.map(d => ({
                    driverId: d.driverId,
                    distance: d.distance,
                    coordinates: d.coordinates,
                    score: d.score
                }));
                await geospatialCache.set(pickupLocation.lat, pickupLocation.lng, radius, driversForCache);
            }

            // 6. Registrar latência
            const latency = performance.now() - startTime;
            const metricsCollector = require('./metrics-collector');
            await metricsCollector.recordLatency('findAndScoreDrivers', latency);

            logger.info(`✅ [Dispatcher] ${topDrivers.length} motoristas encontrados e pontuados para ${bookingId} (${latency.toFixed(2)}ms)`);

            return topDrivers;
        } catch (error) {
            logger.error(`❌ Erro ao buscar e pontuar motoristas para ${bookingId}:`, error);
            return [];
        }
    }

    /**
     * Buscar dados do motorista (rating, acceptance rate, etc)
     * @private
     */
    async getDriverData(driverId) {
        try {
            // Tentar buscar do cache Redis primeiro
            const cached = await this.redis.hgetall(`driver:${driverId}`);

            if (cached && cached.id) {
                // ✅ Normalizar status (aceitar 'online', 'available', 'AVAILABLE')
                const normalizedStatus = cached.status ?
                    (cached.status.toUpperCase() === 'ONLINE' || cached.status.toUpperCase() === 'AVAILABLE' ? 'AVAILABLE' : cached.status) :
                    'AVAILABLE';

                return {
                    id: cached.id,
                    isOnline: cached.isOnline === 'true' || cached.isOnline === true,
                    status: normalizedStatus,
                    rating: parseFloat(cached.rating || 5.0),
                    acceptanceRate: parseFloat(cached.acceptanceRate || 50.0),
                    avgResponseTime: parseFloat(cached.avgResponseTime || 5.0),
                    totalTrips: parseInt(cached.totalTrips || 0)
                };
            }

            // Se não estiver no cache, buscar do Firebase/DB e cachear
            // Por enquanto, retornar dados padrão
            // TODO: Integrar com DriverResolver ou Firebase
            return {
                id: driverId,
                isOnline: true,
                status: 'AVAILABLE',
                rating: 5.0,
                acceptanceRate: 50.0,
                avgResponseTime: 5.0,
                totalTrips: 0
            };
        } catch (error) {
            logger.error(`❌ Erro ao buscar dados do motorista ${driverId}:`, error);
            return null;
        }
    }

    /**
     * Calcular score do motorista
     * Score final = (distância × 0.4) + (rating × 0.2) + (acceptanceRate × 0.2) + (responseTime × 0.2)
     * @private
     */
    async calculateDriverScore(driverId, distance, driverData, bookingId) {
        try {
            // Normalizar distância (menor = melhor, escala 0-1)
            // Assumir que distância máxima é 5km (raio máximo)
            const normalizedDistance = Math.max(0, 1 - (distance / 5.0));

            // Normalizar rating (0-5 → 0-1)
            const normalizedRating = (driverData.rating || 5.0) / 5.0;

            // Normalizar acceptance rate (0-100 → 0-1)
            const normalizedAcceptanceRate = (driverData.acceptanceRate || 50.0) / 100.0;

            // Normalizar response time (menor = melhor, escala 0-1)
            // Assumir que tempo médio de resposta máximo é 30s
            const maxResponseTime = 30.0;
            const normalizedResponseTime = Math.max(0, 1 - ((driverData.avgResponseTime || 5.0) / maxResponseTime));

            // Calcular score ponderado
            const score = (
                normalizedDistance * this.scoreWeights.distance +
                normalizedRating * this.scoreWeights.rating +
                normalizedAcceptanceRate * this.scoreWeights.acceptanceRate +
                normalizedResponseTime * this.scoreWeights.responseTime
            ) * 100; // Escala 0-100

            logger.debug(`📊 [Dispatcher] Score calculado para driver ${driverId}: ${score.toFixed(2)} (dist: ${distance.toFixed(2)}km, rating: ${driverData.rating}, acceptance: ${driverData.acceptanceRate}%, response: ${driverData.avgResponseTime}s)`);

            return score;
        } catch (error) {
            logger.error(`❌ Erro ao calcular score para driver ${driverId}:`, error);
            // Retornar score baseado apenas em distância
            return Math.max(0, (1 - (distance / 5.0)) * 100);
        }
    }

    /**
     * Notificar motorista via WebSocket com lock
     * @param {string} driverId - ID do motorista
     * @param {string} bookingId - ID da corrida
     * @param {Object} bookingData - Dados completos da corrida
     * @returns {Promise<boolean>} true se notificado com sucesso
     */
    async notifyDriver(driverId, bookingId, bookingData) {
        try {
            // ✅ CORREÇÃO: Lock removido - motorista pode receber múltiplas corridas sequenciais
            // Lock será adquirido apenas quando motorista aceita corrida

            // 1. Verificar se motorista já tem corrida ativa na tela
            const activeNotificationKey = `driver_active_notification:${driverId}`;
            const activeBookingId = await this.redis.get(activeNotificationKey);
            if (activeBookingId && activeBookingId !== bookingId) {
                logger.debug(`⚠️ [Dispatcher] Driver ${driverId} já tem corrida ativa na tela (${activeBookingId}), aguardando resposta`);
                return false;
            }

            // ✅ CORREÇÃO: Verificar exclusão PRIMEIRO (se rejeitou, não pode receber)
            // Se motorista está excluído, não pode receber esta corrida
            const isExcluded = await this.redis.sismember(`ride_excluded_drivers:${bookingId}`, driverId);
            if (isExcluded) {
                logger.info(`🚫 [Dispatcher] Driver ${driverId} está excluído para ${bookingId} (cancelou/rejeitou anteriormente)`);
                return false;
            }

            // ✅ CORREÇÃO: Se já foi notificado para ESTA corrida, não notificar novamente
            // Mas pode receber OUTRAS corridas normalmente
            const alreadyNotified = await this.redis.sismember(`ride_notifications:${bookingId}`, driverId);
            if (alreadyNotified) {
                logger.debug(`⚠️ [Dispatcher] Driver ${driverId} já foi notificado para ${bookingId} (não notificar novamente)`);
                return false;
            }

            // ✅ NOVO: Verificar se motorista tem lock (corrida em andamento)
            const lockStatus = await driverLockManager.isDriverLocked(driverId);
            if (lockStatus.isLocked) {
                logger.debug(`⚠️ [Dispatcher] Driver ${driverId} está ocupado com corrida em andamento (${lockStatus.bookingId})`);
                return false;
            }

            // 3. Preparar dados da notificação
            const notificationData = {
                rideId: bookingId,
                bookingId: bookingId,
                customerId: bookingData.customerId,
                pickupLocation: bookingData.pickupLocation,
                destinationLocation: bookingData.destinationLocation,
                estimatedFare: bookingData.estimatedFare,
                paymentMethod: bookingData.paymentMethod || 'pix',
                timeout: 20, // ✅ REFATORAÇÃO: Alinhado com lock TTL (20s)
                timestamp: new Date().toISOString()
            };

            // 4. ✅ VERIFICAR CONEXÃO: Verificar se motorista está conectado antes de enviar
            const driverRoom = `driver_${driverId}`;
            const socketsInRoom = await this.io.in(driverRoom).fetchSockets();

            if (socketsInRoom.length === 0) {
                logger.warn(`⚠️ [Dispatcher] Driver ${driverId} não está conectado (nenhum socket na room ${driverRoom})`);
                return false;
            }

            logger.info(`✅ [Dispatcher] Driver ${driverId} está conectado (${socketsInRoom.length} socket(s) na room ${driverRoom})`);

            // 5. ✅ CORREÇÃO: Estado permanece SEARCHING (não muda para NOTIFIED)
            // Apenas registrar metadata sobre qual motorista foi notificado
            const RideStateManager = require('./ride-state-manager');
            const currentState = await RideStateManager.getBookingState(this.redis, bookingId);

            // ✅ Estado sempre permanece SEARCHING enquanto busca motoristas
            // Apenas registrar metadata (notifiedDriverId, notifiedAt) sem mudar estado
            if (currentState === RideStateManager.STATES.SEARCHING || currentState === RideStateManager.STATES.EXPANDED) {
                // Registrar metadata sem mudar estado
                await this.redis.hset(`booking:${bookingId}`, {
                    notifiedDriverId: driverId,
                    notifiedAt: new Date().toISOString()
                });
                logger.info(`📊 [Dispatcher] Motorista ${driverId} notificado para ${bookingId} (estado permanece SEARCHING)`);
            } else {
                logger.debug(`ℹ️ [Dispatcher] Estado atual é ${currentState}, não registrando notificação`);
            }

            // 6. Enviar notificação via WebSocket
            // Usar room específico do motorista (driver_${driverId})
            this.io.to(driverRoom).emit('newRideRequest', notificationData);

            logger.info(`📤 [Dispatcher] Evento 'newRideRequest' enviado para room ${driverRoom}`, {
                bookingId,
                driverId,
                socketsInRoom: socketsInRoom.length,
                notificationData: {
                    bookingId: notificationData.bookingId,
                    estimatedFare: notificationData.estimatedFare,
                    timeout: notificationData.timeout
                }
            });

            // 7. Registrar como notificado
            await this.redis.sadd(`ride_notifications:${bookingId}`, driverId);

            // ✅ NOVO: Registrar corrida ativa na tela do motorista (TTL: 20s - tempo para responder)
            await this.redis.setex(activeNotificationKey, 20, bookingId);

            // 6. ✅ REFATORAÇÃO: Agendar timeout de resposta (20 segundos)
            this.scheduleDriverTimeout(driverId, bookingId, 20);

            // 7. Registrar evento
            await eventSourcing.recordEvent(
                EVENT_TYPES.DRIVER_NOTIFIED,
                {
                    bookingId,
                    driverId,
                    pickupLocation: bookingData.pickupLocation,
                    score: bookingData.score || 0
                }
            );

            // FASE 10: Registrar notificação para métricas
            const metricsCollector = require('./metrics-collector');
            await metricsCollector.recordDriverNotification(bookingId, driverId, Date.now());

            logger.info(`📱 [Dispatcher] Notificação enviada para driver ${driverId} (booking: ${bookingId})`);

            return true;
        } catch (error) {
            logger.error(`❌ Erro ao notificar driver ${driverId}:`, error);
            // Limpar corrida ativa na tela em caso de erro
            try {
                await this.redis.del(`driver_active_notification:${driverId}`);
            } catch (cleanupError) {
                logger.error(`❌ Erro ao limpar corrida ativa após falha de notificação:`, cleanupError);
            }
            return false;
        }
    }

    /**
     * Notificar múltiplos motoristas
     * @param {Array} drivers - Array de motoristas com scores
     * @param {string} bookingId - ID da corrida
     * @param {Object} bookingData - Dados completos da corrida
     * @returns {Promise<{notified: number, failed: number}>}
     */
    async notifyMultipleDrivers(drivers, bookingId, bookingData) {
        let notified = 0;
        let failed = 0;
        const notificationLog = [];

        logStructured('info', 'Iniciando notificações para motoristas', {
            service: 'driver-notification-dispatcher',
            bookingId,
            totalDrivers: drivers.length,
            pickupLocation: bookingData.pickupLocation,
            estimatedFare: bookingData.estimatedFare
        });

        for (let i = 0; i < drivers.length; i++) {
            const driver = drivers[i];
            const driverNumber = i + 1;

            logStructured('debug', `Notificando motorista ${driverNumber}/${drivers.length}`, {
                service: 'driver-notification-dispatcher',
                driverId: driver.driverId,
                bookingId,
                distance: driver.distance,
                score: driver.score
            });

            const startTime = Date.now();
            const result = await this.notifyDriver(
                driver.driverId,
                bookingId,
                {
                    ...bookingData,
                    score: driver.score
                }
            );
            const duration = Date.now() - startTime;

            if (result) {
                notified++;
                logStructured('debug', 'Notificação enviada com sucesso', {
                    service: 'driver-notification-dispatcher',
                    driverId: driver.driverId,
                    bookingId,
                    duration
                });
                notificationLog.push({
                    driverId: driver.driverId,
                    status: 'success',
                    distance: driver.distance,
                    score: driver.score,
                    duration
                });
            } else {
                failed++;
                logStructured('warn', 'Falha ao enviar notificação', {
                    service: 'driver-notification-dispatcher',
                    driverId: driver.driverId,
                    bookingId,
                    duration
                });
                notificationLog.push({
                    driverId: driver.driverId,
                    status: 'failed',
                    distance: driver.distance,
                    score: driver.score,
                    duration
                });
            }

            // Pequeno delay entre notificações para evitar picos
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        logStructured('info', `Resumo de notificações: ${notified}/${drivers.length} sucessos, ${failed}/${drivers.length} falhas`, {
            service: 'driver-notification-dispatcher',
            bookingId,
            totalDrivers: drivers.length,
            notified,
            failed,
            notificationLog
        });

        logStructured('info', `${notified}/${drivers.length} motoristas notificados para ${bookingId} (${failed} falhas)`, {
            bookingId,
            totalDrivers: drivers.length,
            notified,
            failed,
            notificationLog
        });

        return { notified, failed, notificationLog };
    }

    /**
     * Agendar timeout de resposta do motorista
     * @private
     */
    scheduleDriverTimeout(driverId, bookingId, timeoutSeconds) {
        const timeoutKey = `${bookingId}_${driverId}`;

        // Cancelar timeout anterior se existir
        const existingTimeout = this.timeoutHandlers.get(timeoutKey);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // ✅ REFATORAÇÃO: Alinhar timeout com lock TTL (20s)
        // Usar 20s para garantir que timeout ocorra quando lock expirar
        const alignedTimeout = 20; // segundos (igual ao lock TTL)

        // Agendar novo timeout
        const timeoutId = setTimeout(async () => {
            try {
                const RideStateManager = require('./ride-state-manager');
                const currentState = await RideStateManager.getBookingState(this.redis, bookingId);

                // ✅ CORREÇÃO: Estado sempre permanece SEARCHING, apenas limpar corrida ativa na tela
                // Verificar se corrida ainda está buscando (não foi aceita ou cancelada)
                if (currentState === RideStateManager.STATES.SEARCHING ||
                    currentState === RideStateManager.STATES.EXPANDED) {

                    // ✅ Limpar corrida ativa na tela do motorista (timeout)
                    await this.redis.del(`driver_active_notification:${driverId}`);

                    // ✅ Estado permanece SEARCHING (não muda)
                    // Apenas registrar metadata do timeout
                    await this.redis.hset(`booking:${bookingId}`, {
                        timeoutDriverId: driverId,
                        timeoutAt: new Date().toISOString()
                    });
                    logger.info(`⏰ [Dispatcher] Timeout de resposta para driver ${driverId} (booking: ${bookingId}, estado permanece SEARCHING)`);

                    // Registrar evento
                    await eventSourcing.recordEvent(
                        EVENT_TYPES.DRIVER_TIMEOUT,
                        {
                            bookingId,
                            driverId,
                            timeoutAt: new Date().toISOString()
                        }
                    );
                } else {
                    // Estado já mudou (corrida aceita, cancelada, etc.)
                    logger.debug(`ℹ️ [Dispatcher] Timeout para driver ${driverId} (booking: ${bookingId}), mas estado já é ${currentState}`);
                }
            } catch (error) {
                logger.error(`❌ Erro ao processar timeout para driver ${driverId}:`, error);
            } finally {
                this.timeoutHandlers.delete(timeoutKey);
            }
        }, alignedTimeout * 1000);

        this.timeoutHandlers.set(timeoutKey, timeoutId);
    }

    /**
     * Cancelar timeout de resposta (quando motorista responde)
     * @param {string} driverId - ID do motorista
     * @param {string} bookingId - ID da corrida
     */
    cancelDriverTimeout(driverId, bookingId) {
        const timeoutKey = `${bookingId}_${driverId}`;
        const timeoutId = this.timeoutHandlers.get(timeoutKey);

        if (timeoutId) {
            clearTimeout(timeoutId);
            this.timeoutHandlers.delete(timeoutKey);
            logger.debug(`✅ [Dispatcher] Timeout cancelado para driver ${driverId} (booking: ${bookingId})`);
        }
    }

    /**
     * Limpar todos os timeouts de uma corrida
     * @param {string} bookingId - ID da corrida
     */
    clearAllTimeouts(bookingId) {
        let cleared = 0;

        for (const [key, timeoutId] of this.timeoutHandlers.entries()) {
            if (key.startsWith(`${bookingId}_`)) {
                clearTimeout(timeoutId);
                this.timeoutHandlers.delete(key);
                cleared++;
            }
        }

        if (cleared > 0) {
            logger.debug(`🧹 [Dispatcher] ${cleared} timeouts cancelados para booking ${bookingId}`);
        }
    }
}

module.exports = DriverNotificationDispatcher;

