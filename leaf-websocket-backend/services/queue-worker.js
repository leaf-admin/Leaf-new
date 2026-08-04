/**
 * QUEUE WORKER
 * 
 * Worker assíncrono que processa filas de corridas continuamente.
 * 
 * Funcionalidades:
 * - Processa corridas pendentes em todas as regiões
 * - Distribui corridas entre motoristas disponíveis
 * - Garante que mesmo motorista não recebe múltiplas corridas simultaneamente
 * - Executa a cada 2-5 segundos (configurável)
 * 
 * Fluxo:
 * 1. Buscar todas as regiões com corridas pendentes
 * 2. Para cada região, processar até N corridas (batch)
 * 3. Iniciar busca gradual para cada corrida processada
 * 4. Aguardar intervalo antes da próxima iteração
 */

const redisPool = require('../utils/redis-pool');
const rideQueueManager = require('./ride-queue-manager');
const GradualRadiusExpander = require('./gradual-radius-expander');
const RideStateManager = require('./ride-state-manager');
const eventSourcing = require('./event-sourcing');
const { EVENT_TYPES } = require('./event-sourcing');
const { logger } = require('../utils/logger');
const RedisLeaderLease = require('../utils/redis-leader-lease');
const { buildWorkerConsumerName } = require('../workers/worker-consumer-identity');

class QueueWorker {
    constructor(io, options = {}) {
        this.redis = redisPool.getConnection();
        this.io = io;
        this.intervalId = null;
        this.isRunning = false;
        this.cycleInFlight = null;
        this.gradualExpander = new GradualRadiusExpander(io);
        
        // Configurações
        this.config = {
            // Intervalo entre processamentos (2-5 segundos conforme TODO)
            processingInterval: Math.max(
                250,
                Number.parseInt(process.env.QUEUE_WORKER_INTERVAL_MS || '1000', 10) || 1000
            ),
            
            // Tamanho do batch por região
            batchSizePerRegion: Math.max(
                1,
                Number.parseInt(process.env.QUEUE_WORKER_BATCH_SIZE_PER_REGION || '10', 10) || 10
            ),
            
            // Máximo de regiões processadas por iteração (para evitar sobrecarga)
            maxRegionsPerIteration: Math.max(
                1,
                Number.parseInt(process.env.QUEUE_WORKER_MAX_REGIONS_PER_ITERATION || '50', 10) || 50
            ),
            
            // Timeout para operações Redis
            redisTimeout: 5000, // 5 segundos

            // Lease de liderança: apenas uma réplica processa filas por vez.
            leaderKey: process.env.QUEUE_WORKER_LEADER_KEY || 'leaf:runtime:queue-worker:leader',
            leaderTtlMs: Math.max(
                3000,
                Number.parseInt(process.env.QUEUE_WORKER_LEADER_TTL_MS || '15000', 10) || 15000
            ),
            leaderRenewIntervalMs: Math.max(
                500,
                Number.parseInt(process.env.QUEUE_WORKER_LEADER_RENEW_INTERVAL_MS || '5000', 10) || 5000
            )
        };

        this.leaderLease = options.leaderLease || new RedisLeaderLease(this.redis, {
            key: this.config.leaderKey,
            ttlMs: this.config.leaderTtlMs,
            renewIntervalMs: this.config.leaderRenewIntervalMs,
            ownerId: buildWorkerConsumerName('queue-worker'),
            logger
        });
    }

    async isBookingCurrentForCustomer(bookingId, bookingData) {
        if (!bookingData) return false;

        const status = String(bookingData.status || '').toUpperCase();
        if (RideStateManager.isTerminalStateValue(status)) {
            return false;
        }

        const customerId = bookingData.customerId;
        if (!customerId) {
            return true;
        }

        const activeBookingId = await this.redis.get(`customer_active_booking:${customerId}`);
        return !activeBookingId || activeBookingId === bookingId;
    }

    /**
     * Iniciar worker (processamento contínuo)
     * @returns {void}
     */
    start() {
        if (this.isRunning) {
            logger.warn('⚠️ [QueueWorker] Já está rodando');
            return;
        }

        this.isRunning = true;
        logger.info('🚀 [QueueWorker] Worker iniciado');

        // Processar imediatamente na primeira vez
        this.scheduleProcessingCycle();

        // Agendar processamento contínuo
        this.intervalId = setInterval(() => {
            this.scheduleProcessingCycle();
        }, this.config.processingInterval);
    }

    /**
     * Parar worker
     * @returns {void}
     */
    stop() {
        if (!this.isRunning) {
            logger.warn('⚠️ [QueueWorker] Não está rodando');
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        logger.info('🛑 [QueueWorker] Worker parado');
        return this.leaderLease.release();
    }

    scheduleProcessingCycle() {
        if (!this.isRunning || this.cycleInFlight) {
            return this.cycleInFlight;
        }

        this.cycleInFlight = this.runProcessingCycle()
            .catch((error) => {
                logger.error('❌ [QueueWorker] Erro no ciclo protegido de processamento:', error);
            })
            .finally(() => {
                this.cycleInFlight = null;
            });

        return this.cycleInFlight;
    }

    async runProcessingCycle() {
        const isLeader = this.leaderLease.isHeld()
            ? await this.leaderLease.assertHeld()
            : await this.leaderLease.acquire();

        if (!isLeader) {
            logger.debug('⏭️ [QueueWorker] Ciclo ignorado; outra réplica possui a liderança');
            return;
        }

        await this.processAllQueues({
            leadershipGuard: () => this.leaderLease.assertHeld()
        });
    }

    /**
     * Processar todas as filas de todas as regiões
     * @returns {Promise<void>}
     */
    async processAllQueues(options = {}) {
        const { leadershipGuard = null } = options;
        try {
            if (leadershipGuard && !await leadershipGuard()) {
                logger.warn('⚠️ [QueueWorker] Liderança perdida antes do processamento; ciclo interrompido');
                return;
            }

            // 1. Buscar todas as regiões com corridas pendentes
            const regions = await this.getActiveRegions();

            if (regions.length === 0) {
                logger.debug('📭 [QueueWorker] Nenhuma região com corridas pendentes');
                return;
            }

            logger.debug(`📊 [QueueWorker] Processando ${regions.length} região(ões) com corridas pendentes`);

            // 2. Processar cada região (limitado para evitar sobrecarga)
            const regionsToProcess = regions.slice(0, this.config.maxRegionsPerIteration);
            
            for (const regionHash of regionsToProcess) {
                if (leadershipGuard && !await leadershipGuard()) {
                    logger.warn('⚠️ [QueueWorker] Liderança perdida entre regiões; ciclo interrompido');
                    break;
                }

                try {
                    await this.processRegionQueue(regionHash, { leadershipGuard });
                } catch (error) {
                    logger.error(`❌ [QueueWorker] Erro ao processar região ${regionHash}:`, error);
                    // Continuar com próxima região
                }
            }

        } catch (error) {
            logger.error(`❌ [QueueWorker] Erro geral no processamento:`, error);
        }
    }

    /**
     * Processar fila de uma região específica
     * @param {string} regionHash - Hash da região
     * @returns {Promise<void>}
     */
    async processRegionQueue(regionHash, options = {}) {
        const { leadershipGuard = null } = options;
        try {
            if (leadershipGuard && !await leadershipGuard()) {
                logger.warn(`⚠️ [QueueWorker] Liderança perdida antes da região ${regionHash}; região ignorada`);
                return;
            }

            // 1. Processar próximas corridas pendentes (batch)
            const processedBookings = await rideQueueManager.processNextRides(
                regionHash,
                this.config.batchSizePerRegion
            );

            if (processedBookings.length === 0) {
                return; // Nenhuma corrida para processar
            }

            logger.info(`✅ [QueueWorker] ${processedBookings.length} corrida(s) processada(s) da região ${regionHash}`);

            // 2. Para cada corrida já reivindicada neste batch, iniciar busca gradual.
            // Mesmo que o lease seja perdido após processNextRides(), o batch deve ser
            // drenado para não deixar corridas já movidas para a fila ativa sem busca.
            for (const bookingId of processedBookings) {
                try {
                    // Verificar se corrida ainda está em SEARCHING (não foi cancelada ou aceita)
                    const currentState = await RideStateManager.getBookingState(this.redis, bookingId);
                    
                    // ✅ CORREÇÃO: Estado sempre é SEARCHING enquanto busca motoristas
                    // Não precisa verificar NOTIFIED (estado não existe mais)
                    
                    // ✅ Aceitar também PENDING para garantir que corridas recém-criadas sejam processadas
                    if (currentState !== RideStateManager.STATES.SEARCHING && 
                        currentState !== RideStateManager.STATES.EXPANDED &&
                        currentState !== RideStateManager.STATES.PENDING) {
                        logger.debug(`⚠️ [QueueWorker] Corrida ${bookingId} não está em estado processável (state: ${currentState}), pulando`);
                        continue;
                    }
                    
                    // ✅ Se está em PENDING, transicionar para SEARCHING antes de processar
                    if (currentState === RideStateManager.STATES.PENDING) {
                        await RideStateManager.updateBookingState(this.redis, bookingId, RideStateManager.STATES.SEARCHING);
                        logger.debug(`🔄 [QueueWorker] Corrida ${bookingId} transicionada de PENDING para SEARCHING`);
                    }

                    // Buscar dados da corrida para obter pickupLocation
                    const bookingKey = `booking:${bookingId}`;
                    const bookingData = await this.redis.hgetall(bookingKey);

                    if (!bookingData || !bookingData.pickupLocation) {
                        logger.warn(`⚠️ [QueueWorker] Dados incompletos para corrida ${bookingId}`);
                        continue;
                    }

                    const isCurrentForCustomer = await this.isBookingCurrentForCustomer(bookingId, bookingData);
                    if (!isCurrentForCustomer) {
                        logger.info(`⏭️ [QueueWorker] Corrida stale ignorada e removida da fila: ${bookingId}`);
                        await rideQueueManager.dequeueRide(bookingId, regionHash);
                        continue;
                    }

                    // Parse seguro de pickupLocation
                    let pickupLocation = {};
                    try {
                        pickupLocation = typeof bookingData.pickupLocation === 'string'
                            ? JSON.parse(bookingData.pickupLocation)
                            : bookingData.pickupLocation;
                    } catch (e) {
                        logger.warn(`⚠️ [QueueWorker] Erro ao parse pickupLocation para ${bookingId}:`, e);
                        continue;
                    }

                    // Verificar se busca já foi iniciada (evitar duplicatas)
                    const searchKey = `booking_search:${bookingId}`;
                    const searchData = await this.redis.hgetall(searchKey);

                    if (searchData && searchData.state === 'SEARCHING') {
                        logger.debug(`🔍 [QueueWorker] Busca já iniciada para ${bookingId}, pulando`);
                        continue;
                    }

                    // Iniciar busca gradual
                    logger.info(`🚀 [QueueWorker] Iniciando busca gradual para ${bookingId} em (${pickupLocation.lat}, ${pickupLocation.lng})`);
                    await this.gradualExpander.startGradualSearch(bookingId, pickupLocation);
                    logger.info(`✅ [QueueWorker] Busca gradual iniciada para ${bookingId}`);

                } catch (error) {
                    logger.error(`❌ [QueueWorker] Erro ao iniciar busca para ${bookingId}:`, error);
                    // Continuar com próxima corrida
                }
            }

            // 3. Registrar evento
            await eventSourcing.recordEvent(EVENT_TYPES.QUEUE_PROCESSED, {
                regionHash,
                processedCount: processedBookings.length,
                timestamp: Date.now()
            });

        } catch (error) {
            logger.error(`❌ [QueueWorker] Erro ao processar fila da região ${regionHash}:`, error);
            throw error;
        }
    }

    /**
     * Buscar todas as regiões com corridas pendentes
     * @returns {Promise<Array<string>>} Array de regionHash
     */
    async getActiveRegions() {
        try {
            // Hotfix de performance: reutiliza índice/cache do manager para evitar SCAN redundante em loop.
            return await rideQueueManager.getActiveRegions();
        } catch (error) {
            logger.error(`❌ [QueueWorker] Erro ao buscar regiões ativas:`, error);
            return [];
        }
    }

    /**
     * Obter estatísticas do worker
     * @returns {Promise<Object>} Estatísticas
     */
    async getStats() {
        try {
            const regions = await this.getActiveRegions();
            
            let totalPending = 0;
            const regionStats = [];

            for (const regionHash of regions) {
                const pendingQueueKey = `ride_queue:${regionHash}:pending`;
                const activeQueueKey = `ride_queue:${regionHash}:active`;
                
                const pendingCount = await this.redis.zcard(pendingQueueKey);
                const activeCount = await this.redis.hlen(activeQueueKey);
                
                totalPending += pendingCount;
                
                regionStats.push({
                    regionHash,
                    pending: pendingCount,
                    active: activeCount
                });
            }

            return {
                isRunning: this.isRunning,
                processingInterval: this.config.processingInterval,
                totalRegions: regions.length,
                totalPendingRides: totalPending,
                regions: regionStats
            };
        } catch (error) {
            logger.error(`❌ [QueueWorker] Erro ao obter estatísticas:`, error);
            return {
                isRunning: this.isRunning,
                error: error.message
            };
        }
    }
}

module.exports = QueueWorker;
