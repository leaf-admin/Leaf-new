/**
 * Utilitário para substituir KEYS() por SCAN (não bloqueante)
 * 
 * Redis KEYS() é bloqueante e pode travar o servidor.
 * SCAN itera de forma não bloqueante, permitindo outras operações.
 * 
 * Arquitetura:
 * - Redis: dados voláteis com TTL curto (minutos)
 * - Firestore: dados finais e persistentes apenas
 */

const { logger } = require('./logger');

const DEFAULT_SCAN_COUNT = (() => {
    const parsed = Number.parseInt(process.env.REDIS_SCAN_COUNT || '1000', 10);
    if (!Number.isFinite(parsed)) {
        return 1000;
    }

    return Math.min(Math.max(parsed, 100), 50000);
})();

function normalizeScanCount(count) {
    const parsed = Number.parseInt(count, 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_SCAN_COUNT;
    }

    return Math.min(Math.max(parsed, 1), 50000);
}

function normalizeMaxKeys(maxKeys) {
    if (maxKeys === null || maxKeys === undefined) {
        return null;
    }

    const parsed = Number.parseInt(maxKeys, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

class RedisScan {
    /**
     * Escanear todas as chaves que correspondem a um padrão
     * @param {Redis} redis - Instância do Redis
     * @param {string} pattern - Padrão de busca (ex: 'driver:*', 'booking:*')
     * @param {number} count - Número de chaves por iteração (padrão 100)
     * @returns {Promise<string[]>} Array de chaves encontradas
     */
    static async scanKeys(redis, pattern, count = DEFAULT_SCAN_COUNT, maxKeys = null) {
        try {
            const keys = [];
            let cursor = '0';
            const scanCount = normalizeScanCount(count);
            const maxResults = normalizeMaxKeys(maxKeys);

            do {
                const result = await redis.scan(
                    cursor,
                    'MATCH', pattern,
                    'COUNT', scanCount
                );
                
                cursor = result[0];
                keys.push(...result[1]);

                if (maxResults !== null && keys.length >= maxResults) {
                    return keys.slice(0, maxResults);
                }
            } while (cursor !== '0');

            return keys;
        } catch (error) {
            logger.error(`❌ [RedisScan] Erro ao escanear chaves com padrão ${pattern}:`, error);
            throw error;
        }
    }

    /**
     * Contar chaves que correspondem a um padrão (sem buscar todas)
     * @param {Redis} redis - Instância do Redis
     * @param {string} pattern - Padrão de busca
     * @param {number} count - Número de chaves por iteração
     * @returns {Promise<number>} Número de chaves encontradas
     */
    static async countKeys(redis, pattern, count = DEFAULT_SCAN_COUNT) {
        try {
            let totalCount = 0;
            let cursor = '0';
            const scanCount = normalizeScanCount(count);

            do {
                const result = await redis.scan(
                    cursor,
                    'MATCH', pattern,
                    'COUNT', scanCount
                );
                
                cursor = result[0];
                totalCount += result[1].length;
            } while (cursor !== '0');

            return totalCount;
        } catch (error) {
            logger.error(`❌ [RedisScan] Erro ao contar chaves com padrão ${pattern}:`, error);
            throw error;
        }
    }

    /**
     * Escanear e processar chaves em lotes (para grandes volumes)
     * @param {Redis} redis - Instância do Redis
     * @param {string} pattern - Padrão de busca
     * @param {Function} processor - Função para processar cada lote
     * @param {number} batchSize - Tamanho do lote (padrão 100)
     * @returns {Promise<void>}
     */
    static async scanAndProcess(redis, pattern, processor, batchSize = DEFAULT_SCAN_COUNT) {
        try {
            let cursor = '0';
            let batch = [];
            const normalizedBatchSize = normalizeScanCount(batchSize);

            do {
                const result = await redis.scan(
                    cursor,
                    'MATCH', pattern,
                    'COUNT', normalizedBatchSize
                );
                
                cursor = result[0];
                batch.push(...result[1]);

                // Processar quando lote estiver cheio
                if (batch.length >= normalizedBatchSize) {
                    await processor(batch);
                    batch = [];
                }
            } while (cursor !== '0');

            // Processar lote restante
            if (batch.length > 0) {
                await processor(batch);
            }
        } catch (error) {
            logger.error(`❌ [RedisScan] Erro ao escanear e processar chaves com padrão ${pattern}:`, error);
            throw error;
        }
    }

    /**
     * Escanear chaves e retornar apenas IDs (remove prefixo)
     * @param {Redis} redis - Instância do Redis
     * @param {string} pattern - Padrão de busca (ex: 'driver:*')
     * @param {string} prefix - Prefixo a remover (ex: 'driver:')
     * @returns {Promise<string[]>} Array de IDs
     */
    static async scanIds(redis, pattern, prefix, count = DEFAULT_SCAN_COUNT, maxKeys = null) {
        try {
            const keys = await this.scanKeys(redis, pattern, count, maxKeys);
            return keys.map(key => key.replace(prefix, ''));
        } catch (error) {
            logger.error(`❌ [RedisScan] Erro ao escanear IDs com padrão ${pattern}:`, error);
            throw error;
        }
    }

    /**
     * Verificar se existem chaves que correspondem a um padrão (sem buscar todas)
     * @param {Redis} redis - Instância do Redis
     * @param {string} pattern - Padrão de busca
     * @returns {Promise<boolean>} True se existir pelo menos uma chave
     */
    static async hasKeys(redis, pattern) {
        try {
            const result = await redis.scan('0', 'MATCH', pattern, 'COUNT', 1);
            return result[1].length > 0;
        } catch (error) {
            logger.error(`❌ [RedisScan] Erro ao verificar existência de chaves com padrão ${pattern}:`, error);
            return false;
        }
    }
}

module.exports = RedisScan;
