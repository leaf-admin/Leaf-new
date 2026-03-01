/**
 * DEMAND NOTIFICATION SERVICE
 * 
 * Serviço para notificar motoristas offline sobre alta demanda em suas regiões
 * Incentiva motoristas a ficarem online quando há muitas corridas disponíveis
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');

class DemandNotificationService {
    constructor(io) {
        this.io = io;
        this.redis = redisPool.getConnection();
        this.notificationCooldown = new Map(); // Evitar spam de notificações
    }

    /**
     * Notificar motoristas offline próximos sobre alta demanda
     * @param {Object} pickupLocation - { lat, lng }
     * @param {string} demandLevel - 'high', 'medium', 'low'
     * @param {number} radius - Raio em km (padrão: 2km)
     * @returns {Promise<number>} Número de motoristas notificados
     */
    async notifyOfflineDriversNearDemand(pickupLocation, demandLevel = 'high', radius = 2) {
        try {
            // Garantir conexão Redis
            if (!this.redis.isOpen) {
                await this.redis.connect();
            }

            logger.info(`📢 [DemandNotification] Buscando motoristas offline próximos (raio: ${radius}km, demanda: ${demandLevel})`);

            // 1. Buscar motoristas offline próximos no Redis GEO
            const nearbyOfflineDrivers = await this.redis.georadius(
                'driver_offline_locations',
                pickupLocation.lng,
                pickupLocation.lat,
                radius,
                'km',
                'WITHCOORD',
                'WITHDIST',
                'COUNT',
                50 // Máximo 50 motoristas por notificação
            );

            if (!nearbyOfflineDrivers || nearbyOfflineDrivers.length === 0) {
                logger.debug(`⚠️ [DemandNotification] Nenhum motorista offline próximo encontrado`);
                return 0;
            }

            logger.info(`✅ [DemandNotification] ${nearbyOfflineDrivers.length} motoristas offline encontrados próximos`);

            // 2. Preparar mensagem baseada no nível de demanda
            const messages = {
                high: {
                    title: '🔥 Alta Demanda na Sua Região!',
                    message: 'Muitas corridas disponíveis próximas a você. Fique online para receber solicitações!',
                    priority: 'high'
                },
                medium: {
                    title: '📈 Demanda Moderada',
                    message: 'Há corridas disponíveis na sua região. Considere ficar online!',
                    priority: 'medium'
                },
                low: {
                    title: '📍 Corridas Disponíveis',
                    message: 'Algumas corridas disponíveis próximas a você.',
                    priority: 'low'
                }
            };

            const notification = messages[demandLevel] || messages.medium;

            // 3. Notificar cada motorista offline (com cooldown para evitar spam)
            let notifiedCount = 0;
            const now = Date.now();
            const COOLDOWN_TIME = 300000; // 5 minutos entre notificações

            for (const driver of nearbyOfflineDrivers) {
                const driverId = driver[0];
                const distance = parseFloat(driver[1]);
                const coordinates = {
                    lng: parseFloat(driver[2][0]),
                    lat: parseFloat(driver[2][1])
                };

                // Verificar cooldown
                const lastNotification = this.notificationCooldown.get(driverId);
                if (lastNotification && (now - lastNotification) < COOLDOWN_TIME) {
                    continue; // Ainda em cooldown
                }

                // Verificar se motorista ainda está offline
                const driverData = await this.redis.hgetall(`driver:${driverId}`);
                if (driverData && driverData.isOnline === 'true') {
                    continue; // Motorista já está online, não precisa notificar
                }

                // Enviar notificação via WebSocket (se conectado) ou Push Notification
                try {
                    // Tentar WebSocket primeiro (mais rápido)
                    const driverSocket = this.io.sockets.sockets.get(
                        Array.from(this.io.sockets.sockets.values())
                            .find(s => s.userId === driverId && s.userType === 'driver')?.id
                    );

                    if (driverSocket) {
                        driverSocket.emit('demandAlert', {
                            type: 'demand_alert',
                            ...notification,
                            location: pickupLocation,
                            distance: Math.round(distance * 1000), // em metros
                            coordinates,
                            timestamp: now
                        });
                    } else {
                        // Se não conectado, enviar push notification (implementar depois)
                        // await this.sendPushNotification(driverId, notification);
                        logger.debug(`📱 [DemandNotification] Motorista ${driverId} não conectado - push notification pendente`);
                    }

                    // Registrar notificação (cooldown)
                    this.notificationCooldown.set(driverId, now);
                    notifiedCount++;

                } catch (error) {
                    logger.error(`❌ [DemandNotification] Erro ao notificar motorista ${driverId}:`, error);
                }
            }

            logger.info(`📢 [DemandNotification] ${notifiedCount} motoristas offline notificados sobre demanda ${demandLevel}`);

            return notifiedCount;

        } catch (error) {
            logger.error(`❌ [DemandNotification] Erro ao notificar motoristas offline:`, error);
            return 0;
        }
    }

    /**
     * Verificar demanda em uma região e notificar motoristas offline se necessário
     * @param {Object} pickupLocation - { lat, lng }
     * @param {number} pendingRidesCount - Número de corridas pendentes na região
     * @returns {Promise<void>}
     */
    async checkAndNotifyDemand(pickupLocation, pendingRidesCount) {
        try {
            // Determinar nível de demanda baseado no número de corridas pendentes
            let demandLevel = 'low';
            if (pendingRidesCount >= 10) {
                demandLevel = 'high';
            } else if (pendingRidesCount >= 5) {
                demandLevel = 'medium';
            }

            // Só notificar se houver demanda significativa
            if (demandLevel === 'low' && pendingRidesCount < 3) {
                return; // Demanda muito baixa, não notificar
            }

            // Notificar motoristas offline próximos
            await this.notifyOfflineDriversNearDemand(pickupLocation, demandLevel, 2);

        } catch (error) {
            logger.error(`❌ [DemandNotification] Erro ao verificar demanda:`, error);
        }
    }

    /**
     * Limpar cooldowns antigos (evitar memory leak)
     */
    cleanupCooldowns() {
        const now = Date.now();
        const COOLDOWN_TIME = 300000; // 5 minutos

        for (const [driverId, timestamp] of this.notificationCooldown.entries()) {
            if (now - timestamp > COOLDOWN_TIME * 2) {
                this.notificationCooldown.delete(driverId);
            }
        }
    }
}

module.exports = DemandNotificationService;


