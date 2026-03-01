/**
 * VEHICLE LOCK MANAGER
 * 
 * Gerencia locks distribuídos para prevenir que múltiplos motoristas
 * usem o mesmo veículo simultaneamente.
 * 
 * Usa Redis SET com NX (set if not exists) para garantir atomicidade.
 * 
 * FASE 1 - CRÍTICO: Previne fraude de múltiplos motoristas com mesmo carro
 * 
 * Chave: vehicle_lock:{plate}
 * Valor: driverId
 * TTL: 180 segundos (recomendado)
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');

class VehicleLockManager {
    constructor() {
        this.redis = redisPool.getConnection();
        // TTL padrão: 180 segundos (3 minutos)
        // Protege contra crash de app, queda de internet, etc.
        this.defaultTTL = 180;
    }

    /**
     * Adquirir lock para um veículo
     * @param {string} plate - Placa do veículo (normalizada, sem espaços)
     * @param {string} driverId - ID do motorista
     * @param {number} ttl - Time to live em segundos (padrão 180s)
     * @returns {Promise<{success: boolean, currentDriver?: string, error?: string}>}
     */
    async acquireLock(plate, driverId, ttl = this.defaultTTL) {
        try {
            // Normalizar placa (remover espaços, caracteres especiais, uppercase)
            const normalizedPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lockKey = `vehicle_lock:${normalizedPlate}`;
            
            // Tentar criar lock (SET com NX = only set if not exists)
            // EX = expire após TTL segundos
            const result = await this.redis.set(
                lockKey,
                driverId,
                'EX', ttl, // Expire após TTL segundos
                'NX' // Only set if not exists
            );

            if (result === 'OK') {
                logger.info(`🔒 [VehicleLock] Lock adquirido: ${normalizedPlate} → driver ${driverId}`);
                return {
                    success: true
                };
            } else {
                // Lock já existe (veículo em uso)
                const currentDriver = await this.redis.get(lockKey);
                logger.warn(`⚠️ [VehicleLock] Veículo ${normalizedPlate} já está em uso por driver ${currentDriver}`);
                return {
                    success: false,
                    currentDriver: currentDriver,
                    error: `Este veículo já está sendo utilizado por outro motorista no momento.`
                };
            }
        } catch (error) {
            logger.error(`❌ [VehicleLock] Erro ao adquirir lock para veículo ${plate}:`, error);
            // Em caso de erro, assumir que lock não foi adquirido (fail-safe)
            return {
                success: false,
                error: 'Erro ao verificar disponibilidade do veículo. Tente novamente.'
            };
        }
    }

    /**
     * Liberar lock de um veículo
     * IMPORTANTE: Só libera se o lock pertence ao driverId informado
     * Isso evita que um motorista derrube o lock de outro
     * @param {string} plate - Placa do veículo
     * @param {string} driverId - ID do motorista (deve ser o dono do lock)
     * @returns {Promise<boolean>} true se lock foi liberado com sucesso
     */
    async releaseLock(plate, driverId) {
        try {
            const normalizedPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lockKey = `vehicle_lock:${normalizedPlate}`;
            
            // Verificar se o lock pertence a este motorista
            const currentDriver = await this.redis.get(lockKey);
            
            if (!currentDriver) {
                logger.debug(`⚠️ [VehicleLock] Lock não encontrado para ${normalizedPlate} (já estava liberado?)`);
                return true; // Já está liberado, considerar sucesso
            }
            
            if (currentDriver !== driverId) {
                logger.warn(`⚠️ [VehicleLock] Tentativa de liberar lock de outro motorista: ${normalizedPlate} (dono: ${currentDriver}, tentativa: ${driverId})`);
                return false; // Não pode liberar lock de outro motorista
            }
            
            // Liberar lock
            const result = await this.redis.del(lockKey);
            
            if (result > 0) {
                logger.info(`🔓 [VehicleLock] Lock liberado: ${normalizedPlate} (driver ${driverId})`);
                return true;
            } else {
                logger.debug(`⚠️ [VehicleLock] Lock não encontrado para ${normalizedPlate}`);
                return false;
            }
        } catch (error) {
            logger.error(`❌ [VehicleLock] Erro ao liberar lock para veículo ${plate}:`, error);
            return false;
        }
    }

    /**
     * Verificar se veículo está com lock (em uso)
     * @param {string} plate - Placa do veículo
     * @returns {Promise<{isLocked: boolean, driverId: string|null}>}
     */
    async isVehicleLocked(plate) {
        try {
            const normalizedPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lockKey = `vehicle_lock:${normalizedPlate}`;
            const driverId = await this.redis.get(lockKey);
            
            return {
                isLocked: driverId !== null,
                driverId: driverId
            };
        } catch (error) {
            logger.error(`❌ [VehicleLock] Erro ao verificar lock do veículo ${plate}:`, error);
            // Em caso de erro, assumir que está locked (fail-safe)
            return {
                isLocked: true,
                driverId: null
            };
        }
    }

    /**
     * Renovar TTL de um lock existente (HEARTBEAT)
     * OBRIGATÓRIO: Deve ser chamado a cada 30-60 segundos enquanto motorista está online
     * Isso resolve: app crash, queda de internet, kill de processo, celular desligado
     * @param {string} plate - Placa do veículo
     * @param {string} driverId - ID do motorista (deve ser o dono do lock)
     * @param {number} ttl - Novo TTL em segundos (padrão 180s)
     * @returns {Promise<boolean>} true se TTL foi renovado
     */
    async renewLock(plate, driverId, ttl = this.defaultTTL) {
        try {
            const normalizedPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lockKey = `vehicle_lock:${normalizedPlate}`;
            
            // Verificar se o lock existe e pertence a este motorista
            const currentDriver = await this.redis.get(lockKey);
            
            if (!currentDriver) {
                logger.debug(`⚠️ [VehicleLock] Lock não existe para ${normalizedPlate} (não pode renovar)`);
                return false;
            }
            
            if (currentDriver !== driverId) {
                logger.warn(`⚠️ [VehicleLock] Tentativa de renovar lock de outro motorista: ${normalizedPlate} (dono: ${currentDriver}, tentativa: ${driverId})`);
                return false;
            }
            
            // Renovar TTL
            await this.redis.expire(lockKey, ttl);
            logger.debug(`⏰ [VehicleLock] TTL renovado: ${normalizedPlate} (${ttl}s)`);
            return true;
        } catch (error) {
            logger.error(`❌ [VehicleLock] Erro ao renovar lock para veículo ${plate}:`, error);
            return false;
        }
    }

    /**
     * Obter driverId que está usando o veículo
     * @param {string} plate - Placa do veículo
     * @returns {Promise<string|null>} DriverId ou null se não houver lock
     */
    async getLockedDriver(plate) {
        try {
            const normalizedPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lockKey = `vehicle_lock:${normalizedPlate}`;
            return await this.redis.get(lockKey);
        } catch (error) {
            logger.error(`❌ [VehicleLock] Erro ao obter driver do lock do veículo ${plate}:`, error);
            return null;
        }
    }

    /**
     * Obter TTL restante do lock
     * @param {string} plate - Placa do veículo
     * @returns {Promise<number>} TTL em segundos (-1 se não existe, -2 se não tem expiração)
     */
    async getLockTTL(plate) {
        try {
            const normalizedPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lockKey = `vehicle_lock:${normalizedPlate}`;
            return await this.redis.ttl(lockKey);
        } catch (error) {
            logger.error(`❌ [VehicleLock] Erro ao obter TTL do lock do veículo ${plate}:`, error);
            return -1;
        }
    }

    /**
     * Liberar todos os locks expirados (limpeza)
     * Nota: Redis já faz isso automaticamente com EX, mas útil para auditoria
     * @returns {Promise<number>} Número de locks limpos
     */
    async cleanupExpiredLocks() {
        try {
            // Buscar todas as chaves de lock de veículo
            const lockKeys = await this.redis.keys('vehicle_lock:*');
            let cleaned = 0;

            for (const key of lockKeys) {
                const ttl = await this.redis.ttl(key);
                if (ttl < 0) {
                    // TTL negativo significa que chave não tem expiração ou não existe
                    // (não deveria acontecer, mas limpar por segurança)
                    await this.redis.del(key);
                    cleaned++;
                }
            }

            if (cleaned > 0) {
                logger.info(`🧹 [VehicleLock] Limpeza: ${cleaned} locks expirados removidos`);
            }

            return cleaned;
        } catch (error) {
            logger.error(`❌ [VehicleLock] Erro ao limpar locks expirados:`, error);
            return 0;
        }
    }

    /**
     * Obter estatísticas dos locks
     * @returns {Promise<Object>} Estatísticas dos locks
     */
    async getLockStats() {
        try {
            const lockKeys = await this.redis.keys('vehicle_lock:*');
            const stats = {
                total: lockKeys.length,
                locks: []
            };

            for (const key of lockKeys) {
                const plate = key.replace('vehicle_lock:', '');
                const driverId = await this.redis.get(key);
                const ttl = await this.redis.ttl(key);

                stats.locks.push({
                    plate,
                    driverId,
                    expiresIn: ttl
                });
            }

            return stats;
        } catch (error) {
            logger.error(`❌ [VehicleLock] Erro ao obter estatísticas de locks:`, error);
            return {
                total: 0,
                locks: []
            };
        }
    }
}

// Singleton instance
const vehicleLockManager = new VehicleLockManager();

module.exports = vehicleLockManager;

