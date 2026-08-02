/**
 * 🐳 Docker Environment Detector
 * 
 * Detecta se a aplicação está rodando dentro de um container Docker
 * e retorna configurações apropriadas para Redis e outros serviços.
 */

const fs = require('fs');
const { logger } = require('./logger');

class DockerDetector {
    static getRedisMode() {
        const explicitMode = String(process.env.REDIS_MODE || '').trim().toLowerCase();
        if (explicitMode && !['standalone', 'sentinel'].includes(explicitMode)) {
            throw new Error('REDIS_MODE deve ser standalone ou sentinel');
        }
        if (explicitMode) return explicitMode;
        return String(process.env.REDIS_SENTINELS || '').trim() ? 'sentinel' : 'standalone';
    }

    static parseRedisSentinels(value = process.env.REDIS_SENTINELS) {
        const rawEntries = String(value || '')
            .split(',')
            .map(entry => entry.trim())
            .filter(Boolean);
        const sentinels = rawEntries.map(entry => {
            const separator = entry.lastIndexOf(':');
            const host = separator > 0 ? entry.slice(0, separator).trim() : '';
            const portRaw = separator > 0 ? entry.slice(separator + 1).trim() : '';
            const port = /^\d+$/.test(portRaw) ? Number.parseInt(portRaw, 10) : Number.NaN;
            if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
                throw new Error(`REDIS_SENTINELS contém endpoint inválido: ${entry}`);
            }
            return { host, port };
        });
        const uniqueEndpoints = new Set(sentinels.map(({ host, port }) => `${host.toLowerCase()}:${port}`));
        if (sentinels.length < 3 || uniqueEndpoints.size !== sentinels.length || sentinels.length % 2 === 0) {
            throw new Error('REDIS_SENTINELS deve conter ao menos 3 endpoints distintos em quantidade ímpar');
        }
        return sentinels;
    }

    static getRedisSentinelConfig() {
        const name = String(process.env.REDIS_SENTINEL_MASTER_NAME || 'leaf-master').trim();
        if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
            throw new Error('REDIS_SENTINEL_MASTER_NAME inválido');
        }
        const password = process.env.REDIS_PASSWORD || undefined;
        const sentinelPassword = process.env.REDIS_SENTINEL_PASSWORD || undefined;
        if (process.env.NODE_ENV === 'production' && (!password || !sentinelPassword)) {
            throw new Error('Redis Sentinel em produção exige REDIS_PASSWORD e REDIS_SENTINEL_PASSWORD');
        }
        const db = Number.parseInt(process.env.REDIS_DB || '0', 10);
        if (!Number.isInteger(db) || db < 0) {
            throw new Error('REDIS_DB inválido');
        }

        const config = {
            sentinels: this.parseRedisSentinels(),
            name,
            role: 'master',
            username: process.env.REDIS_USERNAME || undefined,
            password,
            sentinelUsername: process.env.REDIS_SENTINEL_USERNAME || undefined,
            sentinelPassword,
            db
        };
        if (String(process.env.REDIS_USE_TLS || '').toLowerCase() === 'true') {
            config.tls = {
                rejectUnauthorized: String(process.env.REDIS_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false'
            };
        }
        if (String(process.env.REDIS_SENTINEL_USE_TLS || '').toLowerCase() === 'true') {
            config.sentinelTLS = {
                rejectUnauthorized: String(
                    process.env.REDIS_SENTINEL_TLS_REJECT_UNAUTHORIZED || 'true'
                ).toLowerCase() !== 'false'
            };
        }
        return config;
    }

    static parseRedisUrl() {
        if (!process.env.REDIS_URL) {
            return null;
        }

        try {
            const url = new URL(process.env.REDIS_URL);
            if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
                return null;
            }

            const dbFromPath = (url.pathname || '/0').replace('/', '') || '0';
            return {
                host: url.hostname || null,
                port: url.port ? parseInt(url.port, 10) : null,
                username: url.username ? decodeURIComponent(url.username) : null,
                password: url.password ? decodeURIComponent(url.password) : null,
                protocol: url.protocol.replace(':', ''),
                db: Number.isNaN(parseInt(dbFromPath, 10)) ? 0 : parseInt(dbFromPath, 10)
            };
        } catch (_error) {
            return null;
        }
    }
    /**
     * Verifica se está rodando dentro de um container Docker
     * @returns {boolean}
     */
    static isRunningInDocker() {
        // Método 1: Verificar se existe /.dockerenv
        if (fs.existsSync('/.dockerenv')) {
            return true;
        }

        // Método 2: Verificar cgroup (Linux)
        try {
            const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
            if (cgroup.includes('docker') || cgroup.includes('containerd')) {
                return true;
            }
        } catch (error) {
            // Arquivo não existe ou não pode ser lido
        }

        // Método 3: Verificar variável de ambiente
        if (process.env.DOCKER_CONTAINER === 'true' || process.env.IN_DOCKER === 'true') {
            return true;
        }

        return false;
    }

    /**
     * Obtém o host do Redis baseado no ambiente
     * @returns {string}
     */
    static getRedisHost() {
        // Se REDIS_HOST está definido explicitamente, usar
        if (process.env.REDIS_HOST) {
            return process.env.REDIS_HOST;
        }

        const parsed = this.parseRedisUrl();
        if (parsed?.host) {
            return parsed.host;
        }

        // Se está em Docker, usar o nome do serviço
        if (this.isRunningInDocker()) {
            return 'redis'; // Nome do serviço no docker-compose
        }

        // Caso contrário, usar localhost
        return 'localhost';
    }

    /**
     * Obtém a URL completa do Redis
     * @returns {string}
     */
    static getRedisUrl() {
        // Se REDIS_URL está definido explicitamente, usar
        if (process.env.REDIS_URL) {
            return process.env.REDIS_URL;
        }

        const host = this.getRedisHost();
        const port = process.env.REDIS_PORT || '6379';
        const password = process.env.REDIS_PASSWORD;
        const db = process.env.REDIS_DB || '0';

        if (String(password || '').trim()) {
            // Formato autenticado: redis://:password@host:port/db
            return `redis://:${password}@${host}:${port}/${db}`;
        }

        // Formato sem autenticação
        return `redis://${host}:${port}/${db}`;
    }

    /**
     * Obtém configuração do Redis para ioredis
     * @returns {Object}
     */
    static getRedisConfig() {
        if (this.getRedisMode() === 'sentinel') {
            return this.getRedisSentinelConfig();
        }
        const parsed = this.parseRedisUrl();
        const host = this.getRedisHost();
        const port = parsed?.port || parseInt(process.env.REDIS_PORT || '6379');
        const password = parsed?.password || process.env.REDIS_PASSWORD || undefined;
        const username = parsed?.username || process.env.REDIS_USERNAME || undefined;
        const db = Number.isInteger(parsed?.db) ? parsed.db : parseInt(process.env.REDIS_DB || '0');
        const protocol = parsed?.protocol || (String(process.env.REDIS_USE_TLS || '').toLowerCase() === 'true' ? 'rediss' : 'redis');
        const tlsEnabled = protocol === 'rediss' || String(process.env.REDIS_USE_TLS || '').toLowerCase() === 'true';
        const rejectUnauthorized = String(process.env.REDIS_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';

        const config = {
            host,
            port,
            username,
            password,
            db
        };

        if (tlsEnabled) {
            config.tls = {
                rejectUnauthorized
            };
        }

        return config;
    }

    static describeRedisConfig(config = this.getRedisConfig()) {
        if (Array.isArray(config.sentinels)) {
            return `sentinel:${config.name} via ${config.sentinels.map(item => `${item.host}:${item.port}`).join(',')}`;
        }
        return `standalone:${config.host}:${config.port}`;
    }

    /**
     * Loga informações sobre o ambiente detectado
     */
    static logEnvironment() {
        const inDocker = this.isRunningInDocker();
        const redisConfig = this.getRedisConfig();

        logger.info('🐳 Ambiente detectado:');
        logger.info(`   Docker: ${inDocker ? '✅ Sim' : '❌ Não'}`);
        logger.info(`   Redis Mode: ${this.getRedisMode()}`);
        logger.info(`   Redis Target: ${this.describeRedisConfig(redisConfig)}`);
    }
}

module.exports = DockerDetector;
