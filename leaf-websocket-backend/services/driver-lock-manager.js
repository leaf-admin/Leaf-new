/**
 * DRIVER LOCK MANAGER
 * 
 * Gerencia locks distribuídos para prevenir que motoristas recebam
 * múltiplas corridas simultaneamente.
 * 
 * Usa Redis SET com NX (set if not exists) para garantir atomicidade.
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');
const RideStateManager = require('./ride-state-manager');

const TERMINAL_LOCK_STATE_CHECK_LUA = Array.from(RideStateManager.TERMINAL_STATE_ALIASES)
    .map((state) => `state == '${state}' or status == '${state}'`)
    .join(' or ');

class DriverLockManager {
    constructor() {
        this.redis = redisPool.getConnection();
        // ✅ Usar configuração centralizada de TTL
        const { getTTL } = require('../config/redis-ttl-config');
        this.defaultTTL = getTTL('DRIVER_LOCK', 'DEFAULT'); // 20 segundos (tempo para motorista responder)
    }

    /**
     * Adquirir lock para um motorista
     * @param {string} driverId - ID do motorista
     * @param {string} bookingId - ID da corrida que está sendo oferecida
     * @param {number} ttl - Time to live em segundos (padrão 20s)
     * @returns {Promise<boolean>} true se lock foi adquirido, false se motorista já está ocupado
     */
    async acquireLock(driverId, bookingId, ttl = this.defaultTTL) {
        try {
            const lockKey = `driver_lock:${driverId}`;
            
            // Tentar criar lock (SET com NX = only set if not exists)
            const result = await this.redis.set(
                lockKey,
                bookingId,
                'EX', ttl, // Expire após TTL segundos
                'NX' // Only set if not exists
            );

            if (result === 'OK') {
                logger.debug(`🔒 Lock adquirido para driver ${driverId} (booking: ${bookingId})`);
                return true;
            } else {
                // Lock já existe (motorista ocupado)
                const existingBooking = await this.redis.get(lockKey);
                logger.debug(`⚠️ Driver ${driverId} já está ocupado (booking: ${existingBooking})`);
                return false;
            }
        } catch (error) {
            logger.error(`❌ Erro ao adquirir lock para driver ${driverId}:`, error);
            // Em caso de erro, assumir que lock não foi adquirido (fail-safe)
            return false;
        }
    }

    /**
     * Liberar lock de um motorista
     * @param {string} driverId - ID do motorista
     * @param {string|null} expectedBookingId - owner esperado; evita apagar lock substituído
     * @returns {Promise<boolean>} true se lock foi liberado com sucesso
     */
    async releaseLock(driverId, expectedBookingId = null) {
        try {
            if (!expectedBookingId && process.env.NODE_ENV === 'production') {
                logger.error(`❌ Liberação não vinculada de driver_lock bloqueada em produção (${driverId})`);
                return false;
            }
            const lockKey = `driver_lock:${driverId}`;
            const result = await this.redis.eval(
                `local current = redis.call('GET', KEYS[1])
                if not current then return 0 end
                if ARGV[1] ~= '' and tostring(current) ~= tostring(ARGV[1]) then return -1 end
                return redis.call('DEL', KEYS[1])`,
                1,
                lockKey,
                expectedBookingId ? String(expectedBookingId) : ''
            );
            
            if (Number(result) > 0) {
                logger.debug(`🔓 Lock liberado para driver ${driverId}`);
                return true;
            } else if (Number(result) === -1) {
                logger.warn(`⚠️ Lock de ${driverId} não liberado: ownership mudou para outra corrida`);
                return false;
            } else {
                logger.debug(`⚠️ Lock não encontrado para driver ${driverId} (já estava liberado?)`);
                return false;
            }
        } catch (error) {
            logger.error(`❌ Erro ao liberar lock para driver ${driverId}:`, error);
            return false;
        }
    }

    /**
     * Verificar se motorista está com lock (ocupado)
     * @param {string} driverId - ID do motorista
     * @returns {Promise<{isLocked: boolean, bookingId: string|null}>}
     */
    async isDriverLocked(driverId) {
        try {
            const lockKey = `driver_lock:${driverId}`;
            const result = await this.redis.eval(
                `local current = redis.call('GET', KEYS[1])
                if not current then return {0, ''} end
                local bookingKey = 'booking:' .. tostring(current)
                local state = string.upper(tostring(redis.call('HGET', bookingKey, 'state') or ''))
                local status = string.upper(tostring(redis.call('HGET', bookingKey, 'status') or ''))
                local stale = (state == '' and status == '') or ${TERMINAL_LOCK_STATE_CHECK_LUA}
                if stale then
                    redis.call('DEL', KEYS[1])
                    return {2, current}
                end
                return {1, current}`,
                1,
                lockKey
            );
            const statusCode = Number(Array.isArray(result) ? result[0] : 0);
            const bookingId = Array.isArray(result) ? result[1] : null;

            if (statusCode === 0 || !bookingId) {
                return {
                    isLocked: false,
                    bookingId: null
                };
            }

            if (statusCode === 2) {
                logger.warn(`⚠️ Lock stale auto-liberado para driver ${driverId} (booking: ${bookingId})`);
                return {
                    isLocked: false,
                    bookingId: null,
                    recovered: true,
                    staleBookingId: bookingId
                };
            }

            return {
                isLocked: true,
                bookingId: String(bookingId)
            };
        } catch (error) {
            logger.error(`❌ Erro ao verificar lock do driver ${driverId}:`, error);
            // Em caso de erro, assumir que está locked (fail-safe)
            return {
                isLocked: true,
                bookingId: null
            };
        }
    }

    /**
     * Renovar TTL de um lock existente
     * Útil quando motorista está processando resposta
     * @param {string} driverId - ID do motorista
     * @param {number} ttl - Novo TTL em segundos
     * @param {string|null} expectedBookingId - owner esperado; evita renovar lock substituído
     * @returns {Promise<boolean>} true se TTL foi renovado
     */
    async renewLock(driverId, ttl = this.defaultTTL, expectedBookingId = null) {
        try {
            if (!expectedBookingId && process.env.NODE_ENV === 'production') {
                logger.error(`❌ Renovação não vinculada de driver_lock bloqueada em produção (${driverId})`);
                return false;
            }
            const lockKey = `driver_lock:${driverId}`;
            const result = await this.redis.eval(
                `local current = redis.call('GET', KEYS[1])
                if not current then return 0 end
                if ARGV[1] ~= '' and tostring(current) ~= tostring(ARGV[1]) then return -1 end
                return redis.call('EXPIRE', KEYS[1], ARGV[2])`,
                1,
                lockKey,
                expectedBookingId ? String(expectedBookingId) : '',
                String(ttl)
            );
            
            if (Number(result) === 1) {
                logger.debug(`⏰ TTL renovado para driver ${driverId} (${ttl}s)`);
                return true;
            } else if (Number(result) === -1) {
                logger.warn(`⚠️ Lock de ${driverId} não renovado: ownership mudou para outra corrida`);
                return false;
            } else {
                logger.debug(`⚠️ Lock não existe para driver ${driverId} (não pode renovar)`);
                return false;
            }
        } catch (error) {
            logger.error(`❌ Erro ao renovar lock para driver ${driverId}:`, error);
            return false;
        }
    }

    /**
     * Obter bookingId associado ao lock do motorista
     * @param {string} driverId - ID do motorista
     * @returns {Promise<string|null>} BookingId ou null se não houver lock
     */
    async getLockedBooking(driverId) {
        try {
            const lockKey = `driver_lock:${driverId}`;
            return await this.redis.get(lockKey);
        } catch (error) {
            logger.error(`❌ Erro ao obter booking do lock do driver ${driverId}:`, error);
            return null;
        }
    }

    /**
     * Liberar todos os locks expirados (limpeza)
     * Nota: Redis já faz isso automaticamente com EX, mas útil para auditoria
     * @returns {Promise<number>} Número de locks limpos
     */
    async cleanupExpiredLocks() {
        try {
            // Buscar todas as chaves de lock
            const lockKeys = await this.redis.keys('driver_lock:*');
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
                logger.info(`🧹 Limpeza: ${cleaned} locks expirados removidos`);
            }

            return cleaned;
        } catch (error) {
            logger.error(`❌ Erro ao limpar locks expirados:`, error);
            return 0;
        }
    }

    /**
     * Obter estatísticas dos locks
     * @returns {Promise<Object>} Estatísticas dos locks
     */
    async getLockStats() {
        try {
            const lockKeys = await this.redis.keys('driver_lock:*');
            const stats = {
                total: lockKeys.length,
                locks: []
            };

            for (const key of lockKeys) {
                const driverId = key.replace('driver_lock:', '');
                const bookingId = await this.redis.get(key);
                const ttl = await this.redis.ttl(key);

                stats.locks.push({
                    driverId,
                    bookingId,
                    expiresIn: ttl
                });
            }

            return stats;
        } catch (error) {
            logger.error(`❌ Erro ao obter estatísticas de locks:`, error);
            return {
                total: 0,
                locks: []
            };
        }
    }
}

// Singleton instance
const driverLockManager = new DriverLockManager();

module.exports = driverLockManager;
