/**
 * RADIUS EXPANSION MANAGER
 * 
 * Monitora corridas em SEARCHING há mais de 60 segundos
 * e expande o raio de busca de 3km para 5km se necessário.
 * 
 * Fluxo:
 * - Verifica corridas em SEARCHING periodicamente
 * - Se corrida está há > 60s sem motorista e raio = 3km:
 *   → Expande para 5km
 *   → Busca novos motoristas
 *   → Notifica novos motoristas encontrados
 */

const redisPool = require('../utils/redis-pool');
const RideStateManager = require('./ride-state-manager');
const GradualRadiusExpander = require('./gradual-radius-expander');
const DriverNotificationDispatcher = require('./driver-notification-dispatcher');
const eventSourcing = require('./event-sourcing');
const { EVENT_TYPES } = require('./event-sourcing');
const { logger } = require('../utils/logger');

class RadiusExpansionManager {
    constructor(io) {
        this.redis = redisPool.getConnection();
        this.io = io;
        this.intervalId = null;
        this.isRunning = false;
        
        // Configurações
        this.config = {
            // Intervalo para VERIFICAR se há corridas que precisam expandir (não é intervalo de notificação)
            checkInterval: 10000, // Verificar a cada 10 segundos
            
            // Tempo mínimo em SEARCHING antes de expandir para 5km
            expansionTimeout: 60, // 60 segundos em SEARCHING antes de expandir
            
            // Raio máximo inicial da busca gradual (0.5km → 3km)
            initialMaxRadius: 3, // km (raio máximo inicial)
            
            // Raio após expansão secundária (expansão única após 60s)
            expandedMaxRadius: 5, // km (raio após expansão)
            
            // Quantidade de motoristas para notificar após expansão (apenas UMA VEZ)
            // Nota: Apenas motoristas NOVOS serão notificados (já filtrado por ride_notifications)
            driversPerWave: 10 // Mais motoristas após expansão (área maior)
        };
        
        // Instâncias dos serviços
        this.expander = new GradualRadiusExpander(io);
        this.dispatcher = new DriverNotificationDispatcher(io);
    }

    /**
     * Iniciar monitoramento periódico
     * @returns {void}
     */
    start() {
        if (this.isRunning) {
            logger.warn('⚠️ [RadiusExpansionManager] Já está rodando');
            return;
        }

        this.isRunning = true;
        
        // Verificar corridas periodicamente
        this.intervalId = setInterval(async () => {
            await this.checkAndExpandRides();
        }, this.config.checkInterval);

        logger.info(`🚀 [RadiusExpansionManager] Monitoramento iniciado (verifica a cada ${this.config.checkInterval/1000}s)`);
        
        // Executar primeira verificação imediatamente
        this.checkAndExpandRides();
    }

    /**
     * Parar monitoramento
     * @returns {void}
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        logger.info('🛑 [RadiusExpansionManager] Monitoramento parado');
    }

    /**
     * Verificar corridas e expandir se necessário
     * @private
     */
    async checkAndExpandRides() {
        try {
            // Buscar todas as corridas em SEARCHING
            const searchingBookings = await this.findSearchingBookings();
            
            if (searchingBookings.length === 0) {
                return; // Nenhuma corrida para verificar
            }

            logger.debug(`🔍 [RadiusExpansionManager] Verificando ${searchingBookings.length} corrida(s) em SEARCHING`);

            for (const bookingId of searchingBookings) {
                await this.checkAndExpandBooking(bookingId);
            }
        } catch (error) {
            logger.error(`❌ [RadiusExpansionManager] Erro ao verificar corridas:`, error);
        }
    }

    /**
     * Verificar e expandir uma corrida específica
     * @param {string} bookingId - ID da corrida
     * @private
     */
    async checkAndExpandBooking(bookingId) {
        try {
            // 1. Verificar estado da corrida
            const state = await RideStateManager.getBookingState(this.redis, bookingId);
            if (state !== RideStateManager.STATES.SEARCHING) {
                return; // Corrida não está mais em busca
            }

            // 2. Buscar informações da busca
            const searchKey = `booking_search:${bookingId}`;
            const searchData = await this.redis.hgetall(searchKey);

            if (!searchData || Object.keys(searchData).length === 0) {
                return; // Dados de busca não encontrados
            }

            const currentRadius = parseFloat(searchData.currentRadius || 0);
            const createdAt = parseInt(searchData.createdAt || 0);
            const timeInSearch = (Date.now() - createdAt) / 1000; // segundos

            // 3. Verificar se precisa expandir para 5km
            if (currentRadius < this.config.initialMaxRadius) {
                return; // Ainda não chegou no raio máximo inicial (3km)
            }

            if (currentRadius >= this.config.expandedMaxRadius) {
                return; // Já foi expandido para 5km
            }

            // 4. Verificar se passou do timeout (60 segundos)
            if (timeInSearch < this.config.expansionTimeout) {
                return; // Ainda não passou 60 segundos
            }

            // 5. Verificar se já foi expandido antes
            if (searchData.expandedTo5km === 'true') {
                return; // Já foi expandido anteriormente
            }

            logger.info(`📈 [RadiusExpansionManager] Expandindo corrida ${bookingId} para 5km (tempo em busca: ${timeInSearch.toFixed(1)}s)`);

            // 6. Expandir para 5km
            await this.expandTo5km(bookingId, searchData);
        } catch (error) {
            logger.error(`❌ [RadiusExpansionManager] Erro ao verificar corrida ${bookingId}:`, error);
        }
    }

    /**
     * Expandir corrida para 5km e notificar novos motoristas
     * @param {string} bookingId - ID da corrida
     * @param {Object} searchData - Dados da busca atual
     * @private
     */
    async expandTo5km(bookingId, searchData) {
        try {
            // 1. Buscar dados da corrida
            const bookingKey = `booking:${bookingId}`;
            const bookingData = await this.redis.hgetall(bookingKey);

            if (!bookingData || Object.keys(bookingData).length === 0) {
                logger.warn(`⚠️ [RadiusExpansionManager] Dados da corrida ${bookingId} não encontrados`);
                return;
            }

            // Parse seguro de pickupLocation
            let pickupLocation = {};
            if (bookingData.pickupLocation) {
                try {
                    pickupLocation = typeof bookingData.pickupLocation === 'string'
                        ? JSON.parse(bookingData.pickupLocation)
                        : bookingData.pickupLocation;
                } catch (e) {
                    logger.warn(`⚠️ [RadiusExpansionManager] Erro ao parse pickupLocation para ${bookingId}:`, e);
                    return;
                }
            }
            
            if (!pickupLocation.lat || !pickupLocation.lng) {
                logger.warn(`⚠️ [RadiusExpansionManager] Localização de pickup inválida para ${bookingId}`);
                return;
            }

            // 2. Atualizar configuração do expander para 5km
            const searchKey = `booking_search:${bookingId}`;
            await this.redis.hset(searchKey, {
                currentRadius: this.config.expandedMaxRadius,
                expandedTo5km: 'true',
                expandedAt: Date.now(),
                lastExpansion: Date.now()
            });

            // FASE 10: Registrar expansão para 5km nas métricas
            const metricsCollector = require('./metrics-collector');
            await metricsCollector.recordRadiusExpansion(bookingId, this.config.expandedMaxRadius, Date.now());

            // 3. Buscar novos motoristas em 5km (área expandida)
            // IMPORTANTE: findAndScoreDrivers() já filtra motoristas já notificados
            // via ride_notifications:{bookingId}, então apenas NOVOS motoristas serão retornados
            const driversIn5km = await this.dispatcher.findAndScoreDrivers(
                pickupLocation,
                this.config.expandedMaxRadius,
                this.config.driversPerWave,
                bookingId
            );

            if (driversIn5km.length === 0) {
                logger.info(`⚠️ [RadiusExpansionManager] Nenhum motorista encontrado em 5km para ${bookingId}`);
                
                // Notificar customer sobre expansão mesmo sem motoristas
                if (this.io && bookingData.customerId) {
                    this.io.to(`customer_${bookingData.customerId}`).emit('rideSearchExpanded', {
                        bookingId,
                        message: 'Buscando motoristas em área expandida (5km)',
                        currentRadius: this.config.expandedMaxRadius,
                        driversFound: 0
                    });
                }

                // Registrar evento
                await eventSourcing.recordEvent(
                    EVENT_TYPES.RADIUS_EXPANDED_TO_5KM,
                    {
                        bookingId,
                        newRadius: this.config.expandedMaxRadius,
                        driversFound: 0
                    }
                );

                return;
            }

            // 4. Notificar novos motoristas encontrados
            const bookingInfo = {
                bookingId,
                customerId: bookingData.customerId,
                pickupLocation,
                destinationLocation: JSON.parse(bookingData.destinationLocation || '{}'),
                estimatedFare: parseFloat(bookingData.estimatedFare || 0),
                paymentMethod: bookingData.paymentMethod || 'pix'
            };

            const result = await this.dispatcher.notifyMultipleDrivers(
                driversIn5km,
                bookingId,
                bookingInfo
            );

            logger.info(`✅ [RadiusExpansionManager] ${result.notified} motorista(s) notificado(s) após expansão para 5km (${bookingId})`);

            // 5. Notificar customer sobre expansão
            if (this.io && bookingData.customerId) {
                this.io.to(`customer_${bookingData.customerId}`).emit('rideSearchExpanded', {
                    bookingId,
                    message: 'Buscando motoristas em área expandida (5km)',
                    currentRadius: this.config.expandedMaxRadius,
                    driversFound: result.notified
                });
            }

            // 6. Registrar evento
            await eventSourcing.recordEvent(
                EVENT_TYPES.RADIUS_EXPANDED_TO_5KM,
                {
                    bookingId,
                    newRadius: this.config.expandedMaxRadius,
                    driversFound: result.notified,
                    totalDrivers: driversIn5km.length
                }
            );
        } catch (error) {
            logger.error(`❌ [RadiusExpansionManager] Erro ao expandir corrida ${bookingId} para 5km:`, error);
        }
    }

    /**
     * Encontrar todas as corridas em estado SEARCHING
     * @returns {Promise<string[]>} Array de bookingIds
     * @private
     */
    async findSearchingBookings() {
        try {
            // ✅ CORRIGIDO: Usar SCAN ao invés de KEYS() (não bloqueante)
            const RedisScan = require('../utils/redis-scan');
            const searchKeys = await RedisScan.scanKeys(this.redis, 'booking_search:*');
            const searchingBookings = [];

            for (const key of searchKeys) {
                const searchData = await this.redis.hgetall(key);
                
                if (searchData && searchData.state === 'SEARCHING') {
                    // Extrair bookingId do key (booking_search:bookingId)
                    const bookingId = key.replace('booking_search:', '');
                    
                    // Verificar se booking ainda está em SEARCHING no state manager
                    const state = await RideStateManager.getBookingState(this.redis, bookingId);
                    if (state === RideStateManager.STATES.SEARCHING) {
                        searchingBookings.push(bookingId);
                    }
                }
            }

            return searchingBookings;
        } catch (error) {
            logger.error(`❌ [RadiusExpansionManager] Erro ao buscar corridas em SEARCHING:`, error);
            return [];
        }
    }

    /**
     * Forçar expansão manual de uma corrida (para testes)
     * @param {string} bookingId - ID da corrida
     * @returns {Promise<boolean>}
     */
    async forceExpandTo5km(bookingId) {
        try {
            const searchKey = `booking_search:${bookingId}`;
            const searchData = await this.redis.hgetall(searchKey);

            if (!searchData || Object.keys(searchData).length === 0) {
                logger.warn(`⚠️ [RadiusExpansionManager] Dados de busca não encontrados para ${bookingId}`);
                return false;
            }

            await this.expandTo5km(bookingId, searchData);
            return true;
        } catch (error) {
            logger.error(`❌ [RadiusExpansionManager] Erro ao forçar expansão de ${bookingId}:`, error);
            return false;
        }
    }
}

module.exports = RadiusExpansionManager;

