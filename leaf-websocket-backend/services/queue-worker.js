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

class QueueWorker {
    constructor(io) {
        this.redis = redisPool.getConnection();
        this.io = io;
        this.intervalId = null;
        this.isRunning = false;
        this.gradualExpander = new GradualRadiusExpander(io);
        
        // Configurações
        this.config = {
            // Intervalo entre processamentos (2-5 segundos conforme TODO)
            processingInterval: 3000, // 3 segundos (meio-termo)
            
            // Tamanho do batch por região
            batchSizePerRegion: 10, // Máximo de corridas processadas por região por iteração
            
            // Máximo de regiões processadas por iteração (para evitar sobrecarga)
            maxRegionsPerIteration: 50,
            
            // Timeout para operações Redis
            redisTimeout: 5000 // 5 segundos
        };
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
        this.processAllQueues();

        // Agendar processamento contínuo
        this.intervalId = setInterval(() => {
            this.processAllQueues();
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
    }

    /**
     * Processar todas as filas de todas as regiões
     * @returns {Promise<void>}
     */
    async processAllQueues() {
        try {
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
                try {
                    await this.processRegionQueue(regionHash);
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
    async processRegionQueue(regionHash) {
        try {
            // 1. Processar próximas corridas pendentes (batch)
            const processedBookings = await rideQueueManager.processNextRides(
                regionHash,
                this.config.batchSizePerRegion
            );

            if (processedBookings.length === 0) {
                return; // Nenhuma corrida para processar
            }

            logger.info(`✅ [QueueWorker] ${processedBookings.length} corrida(s) processada(s) da região ${regionHash}`);

            // 2. Para cada corrida processada, iniciar busca gradual
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
            // Buscar todas as chaves de filas pendentes
            // Padrão: ride_queue:{regionHash}:pending
            const queueKeys = await this.redis.keys('ride_queue:*:pending');

            if (!queueKeys || queueKeys.length === 0) {
                return [];
            }

            const regions = [];
            const regionSet = new Set(); // Para evitar duplicatas

            for (const key of queueKeys) {
                // Extrair regionHash da chave
                // Exemplo: ride_queue:75cmd:pending → 75cmd
                const match = key.match(/ride_queue:([^:]+):pending/);
                if (match && match[1]) {
                    const regionHash = match[1];
                    
                    // Verificar se há corridas pendentes nesta região
                    const count = await this.redis.zcard(key);
                    if (count > 0 && !regionSet.has(regionHash)) {
                        regionSet.add(regionHash);
                        regions.push(regionHash);
                    }
                }
            }

            return regions;
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


