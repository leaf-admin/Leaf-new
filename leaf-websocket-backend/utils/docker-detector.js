/**
 * 🐳 Docker Environment Detector
 * 
 * Detecta se a aplicação está rodando dentro de um container Docker
 * e retorna configurações apropriadas para Redis e outros serviços.
 */

const fs = require('fs');
const { logger } = require('./logger');

class DockerDetector {
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
        const password = process.env.REDIS_PASSWORD || 'leaf_redis_2024';
        const db = process.env.REDIS_DB || '0';

        // Formato: redis://:password@host:port/db
        return `redis://:${password}@${host}:${port}/${db}`;
    }

    /**
     * Obtém configuração do Redis para ioredis
     * @returns {Object}
     */
    static getRedisConfig() {
        const parsed = this.parseRedisUrl();
        const host = this.getRedisHost();
        const port = parsed?.port || parseInt(process.env.REDIS_PORT || '6379');
        const password = parsed?.password || process.env.REDIS_PASSWORD || 'leaf_redis_2024';
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

    /**
     * Loga informações sobre o ambiente detectado
     */
    static logEnvironment() {
        const inDocker = this.isRunningInDocker();
        const redisHost = this.getRedisHost();
        const redisUrl = this.getRedisUrl();

        logger.info('🐳 Ambiente detectado:');
        logger.info(`   Docker: ${inDocker ? '✅ Sim' : '❌ Não'}`);
        logger.info(`   Redis Host: ${redisHost}`);
        logger.info(`   Redis URL: ${redisUrl.replace(/:[^:@]+@/, ':****@')}`); // Ocultar senha no log
    }
}

module.exports = DockerDetector;
