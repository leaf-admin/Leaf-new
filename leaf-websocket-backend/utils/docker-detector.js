/**
 * 🐳 Docker Environment Detector
 * 
 * Detecta se a aplicação está rodando dentro de um container Docker
 * e retorna configurações apropriadas para Redis e outros serviços.
 */

const fs = require('fs');
const { logger } = require('./logger');

class DockerDetector {
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
        const host = this.getRedisHost();
        const port = parseInt(process.env.REDIS_PORT || '6379');
        const password = process.env.REDIS_PASSWORD || 'leaf_redis_2024';
        const db = parseInt(process.env.REDIS_DB || '0');

        return {
            host,
            port,
            password,
            db
        };
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

