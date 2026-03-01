/**
 * DRIVER POOL MONITOR
 * 
 * Monitora motoristas disponíveis continuamente e envia próxima corrida automaticamente.
 * 
 * Funcionalidades:
 * - Monitora motoristas livres (sem notificação ativa, sem lock, online, available)
 * - Busca próxima corrida disponível para cada motorista livre
 * - Notifica motorista automaticamente quando há match
 * - Executa a cada 5 segundos (configurável)
 * 
 * Fluxo:
 * 1. Buscar motoristas disponíveis (online, available, sem lock, sem notificação ativa)
 * 2. Para cada motorista, buscar próxima corrida na região
 * 3. Verificar critérios (distância, exclusão, notificação prévia)
 * 4. Notificar motorista se houver match
 * 
 * Diferença do QueueWorker:
 * - QueueWorker: Monitora FILA DE CORRIDAS → Envia para motoristas
 * - DriverPoolMonitor: Monitora MOTORISTAS LIVRES → Busca corridas para eles
 */

const redisPool = require('../utils/redis-pool');
const driverLockManager = require('./driver-lock-manager');
const ResponseHandler = require('./response-handler');
const { logger } = require('../utils/logger');

class DriverPoolMonitor {
    constructor(io) {
        this.redis = redisPool.getConnection();
        this.io = io;
        this.intervalId = null;
        this.isRunning = false;
        this.responseHandler = new ResponseHandler(io);
        
        // Configurações
        this.config = {
            // Intervalo entre verificações (5 segundos)
            checkInterval: 5000,
            
            // Máximo de motoristas verificados por iteração (para evitar sobrecarga)
            maxDriversPerIteration: 100
        };
        
        // Cache de última verificação por motorista (evitar verificar muito frequentemente)
        this.lastCheckCache = new Map(); // driverId -> timestamp
        this.checkCooldown = 2000; // 2 segundos entre verificações do mesmo motorista
    }

    /**
     * Iniciar monitoramento
     * @returns {void}
     */
    start() {
        if (this.isRunning) {
            logger.warn('⚠️ [DriverPoolMonitor] Já está rodando');
            return;
        }

        this.isRunning = true;
        logger.info('🚀 [DriverPoolMonitor] Monitor iniciado');

        // Verificar imediatamente na primeira vez
        this.checkAvailableDrivers();

        // Agendar verificação contínua
        this.intervalId = setInterval(() => {
            this.checkAvailableDrivers();
        }, this.config.checkInterval);
    }

    /**
     * Parar monitoramento
     * @returns {void}
     */
    stop() {
        if (!this.isRunning) {
            logger.warn('⚠️ [DriverPoolMonitor] Não está rodando');
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        this.lastCheckCache.clear();
        logger.info('🛑 [DriverPoolMonitor] Monitor parado');
    }

    /**
     * Verificar motoristas disponíveis e enviar próxima corrida
     * @returns {Promise<void>}
     */
    async checkAvailableDrivers() {
        try {
            // 1. Buscar motoristas disponíveis
            const availableDrivers = await this.getAvailableDrivers();

            if (availableDrivers.length === 0) {
                logger.debug('📭 [DriverPoolMonitor] Nenhum motorista disponível encontrado');
                return;
            }

            logger.debug(`📊 [DriverPoolMonitor] ${availableDrivers.length} motorista(s) disponível(eis) encontrado(s)`);

            // 2. Limitar quantidade para evitar sobrecarga
            const driversToCheck = availableDrivers.slice(0, this.config.maxDriversPerIteration);

            // 3. Para cada motorista, buscar próxima corrida
            let notifiedCount = 0;
            for (const driverId of driversToCheck) {
                try {
                    // Verificar cooldown (evitar verificar mesmo motorista muito frequentemente)
                    const lastCheck = this.lastCheckCache.get(driverId);
                    const now = Date.now();
                    if (lastCheck && (now - lastCheck) < this.checkCooldown) {
                        continue; // Ainda em cooldown
                    }

                    const notified = await this.findAndNotifyNextRide(driverId);
                    if (notified) {
                        notifiedCount++;
                    }

                    // Atualizar cache
                    this.lastCheckCache.set(driverId, now);

                } catch (error) {
                    logger.error(`❌ [DriverPoolMonitor] Erro ao processar motorista ${driverId}:`, error);
                    // Continuar com próximo motorista
                }
            }

            if (notifiedCount > 0) {
                logger.info(`✅ [DriverPoolMonitor] ${notifiedCount} motorista(s) notificado(s) com próxima corrida`);
            }

            // Limpar cache antigo (evitar memory leak)
            this.cleanupCache();

        } catch (error) {
            logger.error(`❌ [DriverPoolMonitor] Erro geral na verificação:`, error);
        }
    }

    /**
     * Buscar motoristas disponíveis
     * @returns {Promise<Array<string>>} Array de driverIds
     */
    async getAvailableDrivers() {
        try {
            // 1. Buscar todos os motoristas no Redis GEO (online)
            const allDrivers = await this.redis.zrange('driver_locations', 0, -1);

            if (!allDrivers || allDrivers.length === 0) {
                return [];
            }

            // 2. Filtrar motoristas disponíveis
            const availableDrivers = [];

            for (const driverId of allDrivers) {
                try {
                    // Verificar se motorista está disponível
                    const isAvailable = await this.isDriverAvailable(driverId);
                    if (isAvailable) {
                        availableDrivers.push(driverId);
                    }
                } catch (error) {
                    logger.debug(`⚠️ [DriverPoolMonitor] Erro ao verificar disponibilidade de ${driverId}:`, error.message);
                    // Continuar com próximo motorista
                }
            }

            return availableDrivers;

        } catch (error) {
            logger.error(`❌ [DriverPoolMonitor] Erro ao buscar motoristas disponíveis:`, error);
            return [];
        }
    }

    /**
     * Verificar se motorista está disponível
     * @param {string} driverId - ID do motorista
     * @returns {Promise<boolean>}
     */
    async isDriverAvailable(driverId) {
        try {
            // ✅ 0. Verificar se motorista está bloqueado por KYC (PRIORIDADE)
            try {
                const kycDriverStatusService = require('./kyc-driver-status-service');
                const canWork = await kycDriverStatusService.canDriverWork(driverId);
                if (!canWork) {
                    logger.debug(`🚫 [DriverPoolMonitor] Motorista ${driverId} bloqueado por KYC`);
                    return false; // Motorista bloqueado por KYC
                }
            } catch (kycError) {
                // Se falhar verificação KYC, continuar com outras verificações (fail-open)
                logger.debug(`⚠️ [DriverPoolMonitor] Erro ao verificar KYC de ${driverId}:`, kycError.message);
            }

            // 1. Verificar se motorista tem lock (corrida em andamento)
            const lockStatus = await driverLockManager.isDriverLocked(driverId);
            if (lockStatus.isLocked) {
                return false; // Motorista ocupado com corrida em andamento
            }

            // 2. Verificar se motorista tem notificação ativa na tela
            const activeNotification = await this.redis.get(`driver_active_notification:${driverId}`);
            if (activeNotification) {
                return false; // Motorista já tem corrida na tela
            }

            // 3. Verificar status do motorista (online, available)
            const driverData = await this.redis.hgetall(`driver:${driverId}`);
            if (!driverData) {
                return false; // Dados do motorista não encontrados
            }

            const isOnline = driverData.isOnline === 'true' || driverData.isOnline === true;
            const status = driverData.status?.toLowerCase();

            if (!isOnline) {
                return false; // Motorista offline
            }

            // Status deve ser AVAILABLE, available, online, ou não ter status (assumir disponível)
            const isAvailable = !status || 
                                status === 'available' || 
                                status === 'online' ||
                                status === '';

            if (!isAvailable) {
                return false; // Motorista não disponível (ex: busy, offline, etc.)
            }

            return true; // Motorista disponível

        } catch (error) {
            logger.debug(`⚠️ [DriverPoolMonitor] Erro ao verificar disponibilidade de ${driverId}:`, error.message);
            return false;
        }
    }

    /**
     * Buscar e notificar próxima corrida para motorista
     * @param {string} driverId - ID do motorista
     * @returns {Promise<boolean>} true se notificou, false caso contrário
     */
    async findAndNotifyNextRide(driverId) {
        try {
            // Usar ResponseHandler.sendNextRideToDriver para buscar e notificar próxima corrida
            // (já tem toda a lógica de buscar pendentes, ativas, verificar critérios, notificar, etc.)
            const notificationData = await this.responseHandler.sendNextRideToDriver(driverId);

            if (!notificationData) {
                // Nenhuma corrida disponível para este motorista
                return false;
            }

            // sendNextRideToDriver já notificou o motorista
            logger.info(`✅ [DriverPoolMonitor] Motorista ${driverId} notificado com sucesso sobre corrida ${notificationData.bookingId}`);
            return true;

        } catch (error) {
            logger.error(`❌ [DriverPoolMonitor] Erro ao buscar próxima corrida para ${driverId}:`, error);
            return false;
        }
    }


    /**
     * Limpar cache antigo (evitar memory leak)
     * @returns {void}
     */
    cleanupCache() {
        const now = Date.now();
        const maxAge = this.checkCooldown * 10; // 10x o cooldown

        for (const [driverId, timestamp] of this.lastCheckCache.entries()) {
            if (now - timestamp > maxAge) {
                this.lastCheckCache.delete(driverId);
            }
        }
    }

    /**
     * Obter estatísticas do monitor
     * @returns {Promise<Object>}
     */
    async getStats() {
        try {
            const availableDrivers = await this.getAvailableDrivers();
            const cacheSize = this.lastCheckCache.size;

            return {
                isRunning: this.isRunning,
                availableDriversCount: availableDrivers.length,
                cacheSize: cacheSize,
                checkInterval: this.config.checkInterval,
                maxDriversPerIteration: this.config.maxDriversPerIteration,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error(`❌ [DriverPoolMonitor] Erro ao obter estatísticas:`, error);
            return {
                isRunning: this.isRunning,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = DriverPoolMonitor;

