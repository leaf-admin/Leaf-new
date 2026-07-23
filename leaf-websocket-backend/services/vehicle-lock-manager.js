/**
 * VEHICLE LOCK MANAGER
 * 
 * Gerencia locks distribuídos para prevenir que múltiplos motoristas
 * usem o mesmo veículo simultaneamente.
 * 
 * Usa scripts Lua no Redis para manter aquisição, renovação e liberação atômicas.
 * 
 * FASE 1 - CRÍTICO: Previne fraude de múltiplos motoristas com mesmo carro
 * 
 * Chave: vehicle_lock:{plate}
 * Valor: driverId + token da sessão (socketId)
 * TTL: 180 segundos (recomendado)
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');

const LEASE_SEPARATOR = '::lease::';
const ACQUIRE_LEASE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local owner = ARGV[1]
local driver = ARGV[2]
local driver_prefix = ARGV[3]
local ttl = tonumber(ARGV[4])

if not current then
  redis.call('SET', KEYS[1], owner, 'EX', ttl)
  return {1, 'acquired'}
end

if current == owner then
  redis.call('EXPIRE', KEYS[1], ttl)
  return {1, 'renewed'}
end

if current == driver or string.sub(current, 1, string.len(driver_prefix)) == driver_prefix then
  redis.call('SET', KEYS[1], owner, 'EX', ttl)
  return {1, 'transferred'}
end

return {0, current}
`;

const RENEW_LEASE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return 0
`;

const RELEASE_LEASE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  return 1
end
if current == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function parseLeaseOwner(owner) {
    const rawOwner = String(owner || '');
    if (!rawOwner) {
        return null;
    }
    const separatorIndex = rawOwner.indexOf(LEASE_SEPARATOR);
    if (separatorIndex < 0) {
        return { driverId: rawOwner, leaseToken: null };
    }
    return {
        driverId: rawOwner.slice(0, separatorIndex),
        leaseToken: rawOwner.slice(separatorIndex + LEASE_SEPARATOR.length) || null
    };
}

function parseLeaseDriver(owner) {
    return parseLeaseOwner(owner)?.driverId || null;
}

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
     * @param {{leaseToken: string, ttl?: number}} options - Token exclusivo da sessão e TTL
     * @returns {Promise<{success: boolean, currentDriver?: string, error?: string}>}
     */
    async acquireLock(plate, driverId, options = {}) {
        try {
            const leaseToken = String(options?.leaseToken || '').trim();
            const ttl = Math.max(1, Number.parseInt(options?.ttl || this.defaultTTL, 10) || this.defaultTTL);
            if (!plate || !driverId || !leaseToken) {
                return {
                    success: false,
                    error: 'Dados inválidos para bloquear veículo por sessão.'
                };
            }

            // Normalizar placa (remover espaços, caracteres especiais, uppercase)
            const normalizedPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lockKey = `vehicle_lock:${normalizedPlate}`;
            
            const owner = `${driverId}${LEASE_SEPARATOR}${leaseToken}`;
            const driverPrefix = `${driverId}${LEASE_SEPARATOR}`;
            const result = await this.redis.eval(
                ACQUIRE_LEASE_SCRIPT,
                1,
                lockKey,
                owner,
                String(driverId),
                driverPrefix,
                String(ttl)
            );
            const acquired = Number(result?.[0]) === 1;
            const disposition = String(result?.[1] || '');

            if (acquired) {
                logger.info(`🔒 [VehicleLock] Lease ${disposition}: ${normalizedPlate} → driver ${driverId}`);
                return {
                    success: true,
                    leaseToken,
                    reused: disposition === 'renewed',
                    transferred: disposition === 'transferred'
                };
            }

            const currentDriver = parseLeaseDriver(result?.[1]);
            logger.warn(`⚠️ [VehicleLock] Veículo ${normalizedPlate} já está em uso por driver ${currentDriver}`);
            return {
                success: false,
                currentDriver,
                error: 'Este veículo já está sendo utilizado por outro motorista no momento.'
            };
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
     * @param {{leaseToken: string}} options - Token exclusivo da sessão dona do lease
     * @returns {Promise<boolean>} true se o lease desta sessão foi liberado ou já expirou
     */
    async releaseLock(plate, driverId, options = {}) {
        try {
            const leaseToken = String(options?.leaseToken || '').trim();
            if (!plate || !driverId || !leaseToken) {
                return false;
            }
            const normalizedPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lockKey = `vehicle_lock:${normalizedPlate}`;
            const owner = `${driverId}${LEASE_SEPARATOR}${leaseToken}`;
            const result = await this.redis.eval(RELEASE_LEASE_SCRIPT, 1, lockKey, owner);
            
            if (Number(result) === 1) {
                logger.info(`🔓 [VehicleLock] Lock liberado: ${normalizedPlate} (driver ${driverId})`);
                return true;
            }

            logger.warn(`⚠️ [VehicleLock] Sessão sem posse para liberar ${normalizedPlate} (driver ${driverId})`);
            return false;
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
            const owner = await this.redis.get(lockKey);
            
            return {
                isLocked: owner !== null,
                driverId: parseLeaseDriver(owner)
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
     * @param {{leaseToken: string, ttl?: number}} options - Token exclusivo da sessão e novo TTL
     * @returns {Promise<boolean>} true se TTL foi renovado
     */
    async renewLock(plate, driverId, options = {}) {
        try {
            const leaseToken = String(options?.leaseToken || '').trim();
            const ttl = Math.max(1, Number.parseInt(options?.ttl || this.defaultTTL, 10) || this.defaultTTL);
            if (!plate || !driverId || !leaseToken) {
                return false;
            }
            const normalizedPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lockKey = `vehicle_lock:${normalizedPlate}`;
            const owner = `${driverId}${LEASE_SEPARATOR}${leaseToken}`;
            const renewed = await this.redis.eval(
                RENEW_LEASE_SCRIPT,
                1,
                lockKey,
                owner,
                String(ttl)
            );
            if (Number(renewed) !== 1) {
                logger.warn(`⚠️ [VehicleLock] Sessão sem posse para renovar ${normalizedPlate} (driver ${driverId})`);
                return false;
            }
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
            return parseLeaseDriver(await this.redis.get(lockKey));
        } catch (error) {
            logger.error(`❌ [VehicleLock] Erro ao obter driver do lock do veículo ${plate}:`, error);
            return null;
        }
    }

    /**
     * Obter o dono completo do lease para distinguir uma sessão antiga da reconexão atual.
     * @param {string} plate - Placa do veículo
     * @returns {Promise<{driverId: string, leaseToken: string|null}|null>}
     */
    async getLockOwner(plate) {
        try {
            const normalizedPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lockKey = `vehicle_lock:${normalizedPlate}`;
            return parseLeaseOwner(await this.redis.get(lockKey));
        } catch (error) {
            logger.error(`❌ [VehicleLock] Erro ao obter dono do lease do veículo ${plate}:`, error);
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
                const driverId = parseLeaseDriver(await this.redis.get(key));
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
