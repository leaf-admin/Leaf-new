/**
 * RIDE QUEUE MANAGER
 * 
 * Gerencia filas de corridas por região usando Redis
 * Implementa processamento em batch e distribuição sequencial
 */

const redisPool = require('../utils/redis-pool');
const GeoHashUtils = require('../utils/geohash-utils');
const RideStateManager = require('./ride-state-manager');
const eventSourcing = require('./event-sourcing');
const { logger } = require('../utils/logger');
const { getVisibleBookingKey, BOOKING_VISIBILITY_TTL_SEC } = require('./booking-visibility-service');

function serializeJSONField(value, fallback = {}) {
    if (typeof value === 'string') {
        return value;
    }
    return JSON.stringify(value || fallback);
}

function buildSerializedBookingSnapshot(bookingData, regionHash, timestamp) {
    const initialState = bookingData.state || RideStateManager.STATES.PENDING;
    const initialStatus = bookingData.status || (
        initialState === RideStateManager.STATES.AWAITING_PAYMENT ? 'AWAITING_PAYMENT' : 'REQUESTED'
    );

    return {
        bookingId: bookingData.bookingId,
        customerId: bookingData.customerId,
        pickupLocation: JSON.stringify(bookingData.pickupLocation),
        destinationLocation: JSON.stringify(bookingData.destinationLocation || {}),
        estimatedFare: String(bookingData.estimatedFare || 0),
        grossEstimatedFare: String(bookingData.grossEstimatedFare || bookingData.estimatedFare || 0),
        passengerPayableFare: String(bookingData.passengerPayableFare || bookingData.estimatedFare || 0),
        passengerDiscountAmount: String(bookingData.passengerDiscountAmount || 0),
        passengerDiscountBenefit: serializeJSONField(bookingData.passengerDiscountBenefit, null),
        passengerDiscountUsage: serializeJSONField(bookingData.passengerDiscountUsage, null),
        estimatedOperationalFee: String(bookingData.estimatedOperationalFee || 0),
        estimatedPaymentIntermediationFee: String(bookingData.estimatedPaymentIntermediationFee || 0),
        estimatedTotalFees: String(bookingData.estimatedTotalFees || 0),
        estimatedDriverNetAmount: String(bookingData.estimatedDriverNetAmount || 0),
        routeDistanceKm: String(bookingData.routeDistanceKm || 0),
        routeDurationSecs: String(bookingData.routeDurationSecs || 0),
        tollFee: String(bookingData.tollFee || 0),
        fareSource: bookingData.fareSource || '',
        pricingPayload: serializeJSONField(bookingData.pricingPayload),
        preferences: serializeJSONField(bookingData.preferences),
        femaleDriverOnly: bookingData.femaleDriverOnly ? 'true' : 'false',
        operationalState: bookingData.operationalState || '',
        scorePressao: String(bookingData.scorePressao || 0),
        scoreExcecao: String(bookingData.scoreExcecao || 0),
        carType: bookingData.carType || '',
        paymentMethod: bookingData.paymentMethod || 'pix',
        paymentStatus: bookingData.paymentStatus || 'pending_payment',
        paymentChargeId: bookingData.paymentChargeId || '',
        paymentReferenceRideId: bookingData.paymentReferenceRideId || '',
        paymentAmountInCents: String(bookingData.paymentAmountInCents || ''),
        paymentGrossAmountInCents: String(bookingData.paymentGrossAmountInCents || ''),
        paymentQuoteSessionId: bookingData.paymentQuoteSessionId || '',
        paymentQuoteLockId: bookingData.paymentQuoteLockId || '',
        paymentConfirmedAt: bookingData.paymentConfirmedAt || '',
        pricingSnapshotLocked: bookingData.pricingSnapshotLocked ? 'true' : 'false',
        pricingSnapshotLockedAt: bookingData.pricingSnapshotLockedAt || '',
        region: regionHash,
        state: initialState,
        status: initialStatus,
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

function deferRideQueuedEvent({ bookingId, customerId, regionHash, pickupLocation }) {
    setImmediate(() => {
        const { EVENT_TYPES } = require('./event-sourcing');
        eventSourcing
            .recordEvent(EVENT_TYPES.RIDE_QUEUED, {
                bookingId,
                customerId,
                region: regionHash,
                pickupLocation
            })
            .catch((error) => {
                logger.warn(`⚠️ Falha ao registrar evento assíncrono ride.queued para ${bookingId}: ${error.message}`);
            });
    });
}

class RideQueueManager {
    constructor() {
        this.redis = redisPool.getConnection();
        this.defaultBatchSize = 10;
        this.activeRegionsSetKey = process.env.RIDE_QUEUE_ACTIVE_REGIONS_SET_KEY || 'ride_queue:regions';
        this.activeRegionsCacheTtlMs = Math.max(
            250,
            Number.parseInt(process.env.RIDE_QUEUE_ACTIVE_REGIONS_CACHE_TTL_MS || '2000', 10) || 2000
        );
        this.activeRegionsCache = {
            regions: [],
            expiresAt: 0
        };
    }

    /**
     * Adicionar corrida à fila da região
     * @param {Object} bookingData - Dados da corrida
     * @param {string} bookingData.bookingId - ID da corrida
     * @param {string} bookingData.customerId - ID do cliente
     * @param {Object} bookingData.pickupLocation - { lat, lng }
     * @param {Object} bookingData.destinationLocation - { lat, lng }
     * @param {number} bookingData.estimatedFare - Tarifa estimada
     * @param {string} bookingData.paymentMethod - Método de pagamento
     * @returns {Promise<{success: boolean, regionHash: string, bookingId: string}>}
     */
    async enqueueRide(bookingData, options = {}) {
        try {
            const { bookingId, pickupLocation } = bookingData;
            const { deferEventSourcing = false } = options || {};

            // Obter região (GeoHash)
            const regionHash = GeoHashUtils.getRegionHashFromLocation(pickupLocation);
            const bookingKey = `booking:${bookingId}`;
            const visibleKey = getVisibleBookingKey(bookingId);
            const pendingQueueKey = `ride_queue:${regionHash}:pending`;
            const timestamp = new Date().toISOString();
            const serializedSnapshot = buildSerializedBookingSnapshot(bookingData, regionHash, timestamp);
            const shouldQueueForDispatch = serializedSnapshot.state !== RideStateManager.STATES.AWAITING_PAYMENT;

            // Escreve snapshot primário + visível em batch. A fila de dispatch só recebe corrida paga.
            if (typeof this.redis.pipeline === 'function') {
                const pipeline = this.redis.pipeline();
                pipeline.hset(bookingKey, serializedSnapshot);
                pipeline.hset(visibleKey, {
                    ...serializedSnapshot,
                    visibilityUpdatedAt: timestamp
                });
                pipeline.expire(visibleKey, BOOKING_VISIBILITY_TTL_SEC);
                if (shouldQueueForDispatch) {
                    pipeline.zadd(
                        pendingQueueKey,
                        Date.now(),
                        bookingId
                    );
                    pipeline.sadd(this.activeRegionsSetKey, regionHash);
                }
                await pipeline.exec();
            } else {
                await this.redis.hset(bookingKey, serializedSnapshot);
                await this.redis.hset(visibleKey, {
                    ...serializedSnapshot,
                    visibilityUpdatedAt: timestamp
                });
                await Promise.resolve(this.redis.expire(visibleKey, BOOKING_VISIBILITY_TTL_SEC)).catch(() => null);
                if (shouldQueueForDispatch) {
                    await this.redis.zadd(
                        pendingQueueKey,
                        Date.now(),
                        bookingId
                    );
                    await this.redis.sadd(this.activeRegionsSetKey, regionHash);
                }
            }
            if (shouldQueueForDispatch) {
                this.invalidateActiveRegionsCache();
            }

            if (deferEventSourcing) {
                deferRideQueuedEvent({
                    bookingId,
                    customerId: bookingData.customerId,
                    regionHash,
                    pickupLocation
                });
            } else {
                const { EVENT_TYPES } = require('./event-sourcing');
                await eventSourcing.recordEvent(EVENT_TYPES.RIDE_QUEUED, {
                    bookingId,
                    customerId: bookingData.customerId,
                    region: regionHash,
                    pickupLocation
                });
            }

            logger.info(
                shouldQueueForDispatch
                    ? `✅ Corrida ${bookingId} adicionada à fila da região ${regionHash}`
                    : `⏸️ Corrida ${bookingId} criada aguardando pagamento; dispatch não enfileirado`
            );

            return {
                success: true,
                regionHash,
                bookingId
            };
        } catch (error) {
            logger.error(`❌ Erro ao adicionar corrida à fila:`, error);
            throw error;
        }
    }

    /**
     * Remover corrida da fila
     * @param {string} bookingId - ID da corrida
     * @param {string} regionHash - Hash da região (opcional, será buscado se não fornecido)
     * @returns {Promise<boolean>} true se foi removida com sucesso
     */
    async dequeueRide(bookingId, regionHash = null) {
        try {
            // Se região não fornecida, buscar do booking
            if (!regionHash) {
                const bookingKey = `booking:${bookingId}`;
                regionHash = await this.redis.hget(bookingKey, 'region');
                
                if (!regionHash) {
                    logger.warn(`⚠️ Região não encontrada para booking ${bookingId}, removendo de todas as filas`);
                    // Tentar remover de todas as regiões possíveis
                    return await this.dequeueRideFromAllRegions(bookingId);
                }
            }

            // Remover de fila pendente
            const pendingQueueKey = `ride_queue:${regionHash}:pending`;
            await this.redis.zrem(pendingQueueKey, bookingId);

            // Remover de fila ativa
            const activeQueueKey = `ride_queue:${regionHash}:active`;
            await this.redis.hdel(activeQueueKey, bookingId);
            await this.refreshRegionActivity(regionHash);

            logger.debug(`🗑️ Corrida ${bookingId} removida da fila da região ${regionHash}`);

            return true;
        } catch (error) {
            logger.error(`❌ Erro ao remover corrida da fila:`, error);
            return false;
        }
    }

    /**
     * Remover corrida de todas as filas (fallback)
     * @private
     */
    async dequeueRideFromAllRegions(bookingId) {
        try {
            // ✅ CORRIGIDO: Usar SCAN ao invés de KEYS() (não bloqueante)
            const RedisScan = require('../utils/redis-scan');
            const affectedRegions = new Set();
            
            // Buscar todas as chaves de fila
            const queueKeys = await RedisScan.scanKeys(this.redis, 'ride_queue:*:pending');
            let removed = false;

            for (const key of queueKeys) {
                const pendingMatch = key.match(/ride_queue:(.+):pending/);
                if (pendingMatch && pendingMatch[1]) {
                    affectedRegions.add(pendingMatch[1]);
                }
                const result = await this.redis.zrem(key, bookingId);
                if (result > 0) {
                    removed = true;
                    logger.debug(`🗑️ Corrida ${bookingId} removida de ${key}`);
                }
            }

            // Remover também de filas ativas
            const activeKeys = await RedisScan.scanKeys(this.redis, 'ride_queue:*:active');
            for (const key of activeKeys) {
                const activeMatch = key.match(/ride_queue:(.+):active/);
                if (activeMatch && activeMatch[1]) {
                    affectedRegions.add(activeMatch[1]);
                }
                await this.redis.hdel(key, bookingId);
            }

            for (const regionHash of affectedRegions) {
                await this.refreshRegionActivity(regionHash);
            }

            return removed;
        } catch (error) {
            logger.error(`❌ Erro ao remover corrida de todas as filas:`, error);
            return false;
        }
    }

    /**
     * Buscar próximas N corridas pendentes de uma região
     * @param {string} regionHash - Hash da região
     * @param {number} limit - Limite de corridas (padrão 10)
     * @returns {Promise<Array<string>>} Array de bookingIds (ordenado por timestamp)
     */
    async getPendingRides(regionHash, limit = this.defaultBatchSize) {
        try {
            const pendingQueueKey = `ride_queue:${regionHash}:pending`;
            
            // Buscar próximas N corridas (menor timestamp = mais antiga = maior prioridade)
            const bookingIds = await this.redis.zrange(
                pendingQueueKey,
                0,
                limit - 1 // zrange é inclusivo
            );

            return bookingIds || [];
        } catch (error) {
            logger.error(`❌ Erro ao buscar corridas pendentes da região ${regionHash}:`, error);
            return [];
        }
    }

    /**
     * Processar próximas corridas pendentes (mover para ativa e iniciar busca)
     * @param {string} regionHash - Hash da região
     * @param {number} batchSize - Tamanho do batch (padrão 10)
     * @returns {Promise<Array<string>>} Array de bookingIds processados
     */
    async processNextRides(regionHash, batchSize = this.defaultBatchSize) {
        try {
            // Buscar corridas pendentes
            const pendingRides = await this.getPendingRides(regionHash, batchSize);

            if (pendingRides.length === 0) {
                await this.refreshRegionActivity(regionHash);
                logger.debug(`📭 Nenhuma corrida pendente na região ${regionHash}`);
                return [];
            }

            const processedRides = [];

            for (const bookingId of pendingRides) {
                try {
                    // Verificar estado da corrida
                    const currentState = await RideStateManager.getBookingState(
                        this.redis,
                        bookingId
                    );

                    // Aceitar PENDING ou SEARCHING (SEARCHING pode estar na fila se foi criado antes do worker processar)
                    if (currentState !== RideStateManager.STATES.PENDING && 
                        currentState !== RideStateManager.STATES.SEARCHING) {
                        // Corrida já foi processada ou cancelada, remover da fila
                        await this.dequeueRide(bookingId, regionHash);
                        continue;
                    }
                    
                    // Se já está em SEARCHING, apenas mover para ativa (não precisa atualizar estado novamente)
                    if (currentState === RideStateManager.STATES.SEARCHING) {
                        await this.moveToActive(bookingId, regionHash);
                        processedRides.push(bookingId);
                        logger.debug(`🔄 Corrida ${bookingId} já em SEARCHING, movida para busca ativa`);
                        continue;
                    }

                    // Mover de pendente para ativa
                    await this.moveToActive(bookingId, regionHash);

                    // Atualizar estado para SEARCHING
                    await RideStateManager.updateBookingState(
                        this.redis,
                        bookingId,
                        RideStateManager.STATES.SEARCHING
                    );

                    processedRides.push(bookingId);

                    logger.debug(`🔄 Corrida ${bookingId} movida para busca ativa`);
                } catch (error) {
                    logger.error(`❌ Erro ao processar corrida ${bookingId}:`, error);
                    // Continuar com próxima corrida
                }
            }

            logger.info(`✅ ${processedRides.length} corridas processadas da região ${regionHash}`);
            await this.refreshRegionActivity(regionHash);

            return processedRides;
        } catch (error) {
            logger.error(`❌ Erro ao processar próximas corridas da região ${regionHash}:`, error);
            return [];
        }
    }

    /**
     * Mover corrida de pendente para ativa
     * @private
     */
    async moveToActive(bookingId, regionHash) {
        const pendingQueueKey = `ride_queue:${regionHash}:pending`;
        const activeQueueKey = `ride_queue:${regionHash}:active`;

        // Obter dados da corrida
        const bookingKey = `booking:${bookingId}`;
        const bookingData = await this.redis.hgetall(bookingKey);

        // Adicionar à fila ativa (Hash)
        await this.redis.hset(activeQueueKey, bookingId, JSON.stringify({
            ...bookingData,
            activatedAt: new Date().toISOString()
        }));

        // Remover da fila pendente
        await this.redis.zrem(pendingQueueKey, bookingId);

        // Registrar evento
        const { EVENT_TYPES } = require('./event-sourcing');
        await eventSourcing.recordEvent(EVENT_TYPES.RIDE_DEQUEUED, {
            bookingId,
            region: regionHash
        });
    }

    /**
     * Obter estatísticas da fila de uma região
     * @param {string} regionHash - Hash da região
     * @returns {Promise<Object>} Estatísticas da fila
     */
    async getQueueStats(regionHash) {
        try {
            const pendingQueueKey = `ride_queue:${regionHash}:pending`;
            const activeQueueKey = `ride_queue:${regionHash}:active`;

            const pendingCount = await this.redis.zcard(pendingQueueKey);
            const activeCount = await this.redis.hlen(activeQueueKey);

            return {
                region: regionHash,
                pending: pendingCount,
                active: activeCount,
                total: pendingCount + activeCount
            };
        } catch (error) {
            logger.error(`❌ Erro ao obter estatísticas da fila ${regionHash}:`, error);
            return {
                region: regionHash,
                pending: 0,
                active: 0,
                total: 0
            };
        }
    }

    invalidateActiveRegionsCache() {
        this.activeRegionsCache = {
            regions: [],
            expiresAt: 0
        };
    }

    async refreshRegionActivity(regionHash) {
        if (!regionHash) {
            return;
        }

        try {
            const pendingQueueKey = `ride_queue:${regionHash}:pending`;
            const pendingCount = await this.redis.zcard(pendingQueueKey);

            if (pendingCount > 0) {
                await this.redis.sadd(this.activeRegionsSetKey, regionHash);
            } else {
                await this.redis.srem(this.activeRegionsSetKey, regionHash);
            }

            this.invalidateActiveRegionsCache();
        } catch (error) {
            logger.warn(`⚠️ Erro ao atualizar índice de região ${regionHash}: ${error.message}`);
        }
    }

    /**
     * Obter todas as regiões com corridas pendentes
     * @returns {Promise<Array<string>>} Array de regionHashes
     */
    async getActiveRegions() {
        try {
            const now = Date.now();
            if (this.activeRegionsCache.expiresAt > now) {
                return [...this.activeRegionsCache.regions];
            }

            let regions = await this.redis.smembers(this.activeRegionsSetKey);

            if (!regions || regions.length === 0) {
                const RedisScan = require('../utils/redis-scan');
                const queueKeys = await RedisScan.scanKeys(this.redis, 'ride_queue:*:pending');
                const scannedRegions = new Set();

                for (const key of queueKeys) {
                    // Extrair regionHash do padrão: ride_queue:{regionHash}:pending
                    const match = key.match(/ride_queue:(.+):pending/);
                    if (match && match[1]) {
                        scannedRegions.add(match[1]);
                    }
                }

                regions = Array.from(scannedRegions);
                if (regions.length > 0) {
                    await this.redis.sadd(this.activeRegionsSetKey, ...regions);
                }
            }

            this.activeRegionsCache = {
                regions: Array.isArray(regions) ? regions : [],
                expiresAt: now + this.activeRegionsCacheTtlMs
            };

            return [...this.activeRegionsCache.regions];
        } catch (error) {
            logger.error(`❌ Erro ao obter regiões ativas:`, error);
            return [];
        }
    }

    /**
     * Obter dados completos de uma corrida
     * @param {string} bookingId - ID da corrida
     * @returns {Promise<Object|null>} Dados da corrida ou null se não encontrado
     */
    async getBookingData(bookingId) {
        try {
            const bookingKey = `booking:${bookingId}`;
            const data = await this.redis.hgetall(bookingKey);

            if (!data || Object.keys(data).length === 0) {
                return null;
            }

            // Parsear campos JSON se existirem
            const parsed = {};
            for (const [key, value] of Object.entries(data)) {
                try {
                    // Tentar fazer parse de JSON
                    parsed[key] = JSON.parse(value);
                } catch {
                    // Se não for JSON, usar valor como string
                    parsed[key] = value;
                }
            }

            return parsed;
        } catch (error) {
            logger.error(`❌ Erro ao obter dados da corrida ${bookingId}:`, error);
            return null;
        }
    }
}

// Singleton instance
const rideQueueManager = new RideQueueManager();

module.exports = rideQueueManager;
