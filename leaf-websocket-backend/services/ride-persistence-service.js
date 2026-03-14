const { logger } = require('../utils/logger');
const redisPool = require('../utils/redis-pool');
const firebaseConfig = require('../firebase-config');
const admin = require('firebase-admin');

/**
 * Serviço de Persistência de Corridas
 * 
 * Estratégia: Redis para tempo real + Firestore para persistência permanente
 * - Redis: Dados em tempo real (estados, localizações, cache)
 * - Firestore: Apenas começo e fim da corrida (snapshots)
 * 
 * Arquitetura preparada para escalabilidade:
 * - FASE 1: Redis Standalone (0-10k corridas/dia)
 * - FASE 2: Redis Replica (10k-50k corridas/dia) - apenas mudança de config
 * - FASE 3: Redis Cluster (50k+ corridas/dia) - apenas mudança de config
 */
class RidePersistenceService {
    constructor() {
        // Inicializar Firebase
        this.firestore = null;
        this.initializeFirestore();
        
        // Configuração de retry
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 segundo
        
        // Redis mode (preparado para escalabilidade)
        this.redisMode = process.env.REDIS_MODE || 'standalone'; // standalone, replica, cluster
        this.redis = redisPool.getConnection();
        
        logger.info(`🚀 Ride Persistence Service inicializado (Redis Mode: ${this.redisMode})`);
    }

    getFinalizationOutboxKey() {
        return 'rides:finalization_outbox';
    }
    
    /**
     * Inicializar Firestore
     */
    initializeFirestore() {
        try {
            this.firestore = firebaseConfig.getFirestore();
            if (this.firestore) {
                logger.info('✅ Firestore conectado para persistência de corridas');
            } else {
                logger.warn('⚠️ Firestore não disponível - persistência limitada');
            }
        } catch (error) {
            logger.error(`❌ Erro ao inicializar Firestore: ${error.message}`);
            this.firestore = null;
        }
    }
    
    /**
     * Retry logic genérico
     */
    async retryOperation(operation, operationName, maxRetries = this.maxRetries) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    const delay = this.retryDelay * attempt; // Backoff exponencial
                    logger.warn(`⚠️ [${operationName}] Tentativa ${attempt}/${maxRetries} falhou, tentando novamente em ${delay}ms: ${error.message}`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        logger.error(`❌ [${operationName}] Falhou após ${maxRetries} tentativas: ${lastError.message}`);
        throw lastError;
    }
    
    /**
     * Salvar corrida no início (snapshot inicial no Firestore)
     * 
     * @param {Object} rideData - Dados da corrida
     * @param {string} rideData.rideId - ID da corrida
     * @param {string} rideData.bookingId - ID do booking (pode ser igual ao rideId)
     * @param {string} rideData.passengerId - ID do passageiro
     * @param {Object} rideData.pickupLocation - Localização de origem {lat, lng, address?}
     * @param {Object} rideData.destinationLocation - Localização de destino {lat, lng, address?}
     * @param {number} rideData.estimatedFare - Tarifa estimada
     * @param {string} rideData.paymentMethod - Método de pagamento
     * @param {string} rideData.paymentStatus - Status do pagamento
     * @param {string} rideData.status - Status da corrida (pending, accepted, etc)
     * @param {string} rideData.carType - Tipo de carro (opcional)
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async saveRide(rideData) {
        try {
            const {
                rideId,
                bookingId,
                passengerId,
                pickupLocation,
                destinationLocation,
                estimatedFare,
                paymentMethod,
                paymentStatus,
                status,
                carType
            } = rideData;
            
            if (!rideId || !passengerId || !pickupLocation) {
                return {
                    success: false,
                    error: 'Dados incompletos: rideId, passengerId e pickupLocation são obrigatórios'
                };
            }
            
            // 1. Salvar no Redis (tempo real) - já está sendo feito no server.js
            // Aqui apenas garantimos que está salvo
            const bookingKey = `booking:${bookingId || rideId}`;
            try {
                const redis = redisPool.getConnection();
                if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                    await redis.hset(bookingKey, {
                        bookingId: bookingId || rideId,
                        customerId: passengerId,
                        status: status || 'pending',
                        createdAt: Date.now(),
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (redisError) {
                logger.warn(`⚠️ Erro ao salvar no Redis (continuando): ${redisError.message}`);
            }
            
            // 2. Salvar snapshot inicial no Firestore (persistência permanente)
            if (!this.firestore) {
                logger.warn('⚠️ Firestore não disponível - corrida não persistida permanentemente');
                return {
                    success: false,
                    error: 'Firestore não disponível'
                };
            }
            
            const rideDoc = {
                rideId: rideId,
                bookingId: bookingId || rideId,
                passengerId: passengerId,
                driverId: null, // Será preenchido quando motorista aceitar
                status: status || 'pending',
                pickupLocation: {
                    lat: pickupLocation.lat,
                    lng: pickupLocation.lng,
                    address: pickupLocation.address || null
                },
                destinationLocation: destinationLocation ? {
                    lat: destinationLocation.lat,
                    lng: destinationLocation.lng,
                    address: destinationLocation.address || null
                } : null,
                estimatedFare: estimatedFare || 0,
                finalPrice: null, // Será preenchido na finalização
                netFare: null, // Será preenchido na finalização
                distance: null, // Será preenchido na finalização
                duration: null, // Será preenchido na finalização
                paymentMethod: paymentMethod || 'pix',
                paymentStatus: paymentStatus || 'pending_payment',
                carType: carType || null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                acceptedAt: null,
                startedAt: null,
                completedAt: null,
                cancelledAt: null,
                // Metadados
                source: 'websocket-backend',
                version: '1.0'
            };
            
            // Salvar com retry
            await this.retryOperation(
                async () => {
                    await this.firestore.collection('rides').doc(rideId).set(rideDoc, { merge: false });
                },
                'saveRide (Firestore)'
            );
            
            logger.info(`✅ Corrida ${rideId} salva no Firestore (snapshot inicial)`);
            
            return {
                success: true,
                rideId: rideId
            };
            
        } catch (error) {
            logger.error(`❌ Erro ao salvar corrida ${rideData?.rideId}: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Atualizar status da corrida (apenas no Redis - tempo real)
     * Firestore não é atualizado durante a corrida (economia de custos)
     * 
     * @param {string} rideId - ID da corrida
     * @param {string} status - Novo status
     * @param {Object} additionalData - Dados adicionais para atualizar
     * @returns {Promise<{success: boolean}>}
     */
    async updateRideStatus(rideId, status, additionalData = {}) {
        try {
            const redis = redisPool.getConnection();
            if (!redis || (redis.status !== 'ready' && redis.status !== 'connect')) {
                logger.warn('⚠️ Redis não disponível para atualizar status');
                return { success: false };
            }
            
            const bookingKey = `booking:${rideId}`;
            const updateData = {
                status: status,
                updatedAt: Date.now(),
                ...additionalData
            };
            
            await redis.hset(bookingKey, updateData);
            
            logger.debug(`✅ Status da corrida ${rideId} atualizado no Redis: ${status}`);
            
            return { success: true };
            
        } catch (error) {
            logger.error(`❌ Erro ao atualizar status da corrida ${rideId}: ${error.message}`);
            return { success: false };
        }
    }
    
    /**
     * Salvar dados finais da corrida (snapshot final no Firestore)
     * 
     * @param {string} rideId - ID da corrida
     * @param {Object} finalData - Dados finais
     * @param {number} finalData.fare - Tarifa final
     * @param {number} finalData.netFare - Tarifa líquida (após taxas)
     * @param {number} finalData.distance - Distância percorrida (km)
     * @param {number} finalData.duration - Duração da viagem (minutos)
     * @param {Object} finalData.endLocation - Localização final {lat, lng}
     * @param {number} finalData.driverEarnings - Ganhos do motorista
     * @param {Object} finalData.financialBreakdown - Detalhamento financeiro
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async saveFinalRideData(rideId, finalData) {
        try {
            if (!rideId) {
                return {
                    success: false,
                    error: 'rideId é obrigatório'
                };
            }
            
            // 1. Atualizar Redis com dados finais
            try {
                const redis = redisPool.getConnection();
                if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
                    const bookingKey = `booking:${rideId}`;
                    await redis.hset(bookingKey, {
                        status: 'completed',
                        finalPrice: finalData.fare || null,
                        netFare: finalData.netFare || null,
                        distance: finalData.distance || null,
                        duration: finalData.duration || null,
                        completedAt: Date.now()
                    });
                }
            } catch (redisError) {
                logger.warn(`⚠️ Erro ao atualizar Redis (continuando): ${redisError.message}`);
            }
            
            // 2. Salvar snapshot final no Firestore
            if (!this.firestore) {
                logger.warn('⚠️ Firestore não disponível - dados finais não persistidos');
                return {
                    success: false,
                    error: 'Firestore não disponível'
                };
            }
            
            const updateData = {
                status: 'completed',
                finalPrice: finalData.fare || null,
                netFare: finalData.netFare || null,
                distance: finalData.distance || null,
                duration: finalData.duration || null,
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                driverEarnings: finalData.driverEarnings || null,
                financialBreakdown: finalData.financialBreakdown || null
            };
            
            // Adicionar endLocation se fornecido
            if (finalData.endLocation) {
                updateData.endLocation = {
                    lat: finalData.endLocation.lat,
                    lng: finalData.endLocation.lng,
                    address: finalData.endLocation.address || null
                };
            }
            
            // Atualizar com retry
            await this.retryOperation(
                async () => {
                    await this.firestore.collection('rides').doc(rideId).update(updateData);
                },
                'saveFinalRideData (Firestore)'
            );
            
            logger.info(`✅ Dados finais da corrida ${rideId} salvos no Firestore`);
            
            return {
                success: true,
                rideId: rideId
            };
            
        } catch (error) {
            logger.error(`❌ Erro ao salvar dados finais da corrida ${rideId}: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async queueFinalizationOutbox(rideId, finalData, errorMessage = 'unknown_error') {
        try {
            const redis = redisPool.getConnection();
            if (!redis || (redis.status !== 'ready' && redis.status !== 'connect')) {
                return { success: false, error: 'Redis indisponivel para outbox' };
            }

            const outboxKey = this.getFinalizationOutboxKey();
            const now = Date.now();
            const payload = {
                rideId,
                finalData,
                attempts: 0,
                status: 'pending',
                createdAt: now,
                updatedAt: now,
                nextRetryAt: now + 5000,
                lastError: errorMessage
            };

            await redis.hset(outboxKey, rideId, JSON.stringify(payload));
            logger.warn(`⚠️ Finalizacao da corrida ${rideId} enviada para outbox`);
            return { success: true };
        } catch (error) {
            logger.error(`❌ Erro ao enfileirar outbox da corrida ${rideId}: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async persistFinalRideDataWithOutbox(rideId, finalData) {
        const saveResult = await this.saveFinalRideData(rideId, finalData);
        if (saveResult.success) {
            return { success: true, persisted: true, deferred: false };
        }

        const queueResult = await this.queueFinalizationOutbox(
            rideId,
            finalData,
            saveResult.error || 'save_final_failed'
        );

        if (queueResult.success) {
            return { success: true, persisted: false, deferred: true };
        }

        return {
            success: false,
            persisted: false,
            deferred: false,
            error: queueResult.error || saveResult.error || 'persist_and_outbox_failed'
        };
    }

    async processFinalizationOutboxBatch(limit = 20) {
        try {
            const redis = redisPool.getConnection();
            if (!redis || (redis.status !== 'ready' && redis.status !== 'connect')) {
                return { processed: 0, retried: 0, failed: 0 };
            }

            const outboxKey = this.getFinalizationOutboxKey();
            const items = await redis.hgetall(outboxKey);
            const now = Date.now();
            let processed = 0;
            let retried = 0;
            let failed = 0;
            let scanned = 0;

            for (const [rideId, raw] of Object.entries(items || {})) {
                if (scanned >= limit) break;
                scanned += 1;

                let payload;
                try {
                    payload = JSON.parse(raw);
                } catch (parseError) {
                    await redis.hdel(outboxKey, rideId);
                    failed += 1;
                    continue;
                }

                if (!payload || payload.status === 'completed') {
                    await redis.hdel(outboxKey, rideId);
                    continue;
                }

                if (payload.nextRetryAt && payload.nextRetryAt > now) {
                    continue;
                }

                const result = await this.saveFinalRideData(rideId, payload.finalData || {});
                if (result.success) {
                    await redis.hdel(outboxKey, rideId);
                    processed += 1;
                    continue;
                }

                const attempts = (payload.attempts || 0) + 1;
                if (attempts >= 10) {
                    payload.status = 'failed';
                    payload.attempts = attempts;
                    payload.updatedAt = now;
                    payload.lastError = result.error || 'retry_failed';
                    await redis.hset(outboxKey, rideId, JSON.stringify(payload));
                    failed += 1;
                    continue;
                }

                payload.attempts = attempts;
                payload.updatedAt = now;
                payload.lastError = result.error || 'retry_failed';
                payload.nextRetryAt = now + Math.min(60000, 2000 * attempts);
                await redis.hset(outboxKey, rideId, JSON.stringify(payload));
                retried += 1;
            }

            return { processed, retried, failed };
        } catch (error) {
            logger.error(`❌ Erro ao processar outbox de finalizacao: ${error.message}`);
            return { processed: 0, retried: 0, failed: 0, error: error.message };
        }
    }
    
    /**
     * Atualizar motorista da corrida (quando aceita)
     * Atualiza apenas no Firestore (snapshot)
     * 
     * @param {string} rideId - ID da corrida
     * @param {string} driverId - ID do motorista
     * @returns {Promise<{success: boolean}>}
     */
    async updateRideDriver(rideId, driverId) {
        try {
            if (!this.firestore) {
                return { success: false };
            }
            
            await this.retryOperation(
                async () => {
                    await this.firestore.collection('rides').doc(rideId).update({
                        driverId: driverId,
                        status: 'accepted',
                        acceptedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                },
                'updateRideDriver (Firestore)'
            );
            
            logger.info(`✅ Motorista ${driverId} associado à corrida ${rideId} no Firestore`);
            
            return { success: true };
            
        } catch (error) {
            logger.error(`❌ Erro ao atualizar motorista da corrida ${rideId}: ${error.message}`);
            return { success: false };
        }
    }
    
    /**
     * Marcar corrida como iniciada
     * 
     * @param {string} rideId - ID da corrida
     * @returns {Promise<{success: boolean}>}
     */
    async markRideStarted(rideId) {
        try {
            if (!this.firestore) {
                return { success: false };
            }
            
            await this.retryOperation(
                async () => {
                    await this.firestore.collection('rides').doc(rideId).update({
                        status: 'in_progress',
                        startedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                },
                'markRideStarted (Firestore)'
            );
            
            logger.info(`✅ Corrida ${rideId} marcada como iniciada no Firestore`);
            
            return { success: true };
            
        } catch (error) {
            logger.error(`❌ Erro ao marcar corrida como iniciada ${rideId}: ${error.message}`);
            return { success: false };
        }
    }
    
    /**
     * Marcar corrida como cancelada
     * 
     * @param {string} rideId - ID da corrida
     * @param {string} reason - Motivo do cancelamento (opcional)
     * @returns {Promise<{success: boolean}>}
     */
    async markRideCancelled(rideId, reason = null) {
        try {
            if (!this.firestore) {
                return { success: false };
            }
            
            const updateData = {
                status: 'cancelled',
                cancelledAt: admin.firestore.FieldValue.serverTimestamp()
            };
            
            if (reason) {
                updateData.cancellationReason = reason;
            }
            
            await this.retryOperation(
                async () => {
                    await this.firestore.collection('rides').doc(rideId).update(updateData);
                },
                'markRideCancelled (Firestore)'
            );
            
            logger.info(`✅ Corrida ${rideId} marcada como cancelada no Firestore`);
            
            return { success: true };
            
        } catch (error) {
            logger.error(`❌ Erro ao marcar corrida como cancelada ${rideId}: ${error.message}`);
            return { success: false };
        }
    }
    
    /**
     * Buscar corrida do Firestore
     * 
     * @param {string} rideId - ID da corrida
     * @returns {Promise<Object|null>}
     */
    async getRide(rideId) {
        try {
            if (!this.firestore) {
                return null;
            }
            
            const doc = await this.firestore.collection('rides').doc(rideId).get();
            
            if (doc.exists) {
                return doc.data();
            }
            
            return null;
            
        } catch (error) {
            logger.error(`❌ Erro ao buscar corrida ${rideId}: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Verificar se Firestore está disponível
     * 
     * @returns {boolean}
     */
    isFirestoreAvailable() {
        return this.firestore !== null;
    }
}

// Exportar instância singleton
const ridePersistenceService = new RidePersistenceService();

module.exports = ridePersistenceService;


