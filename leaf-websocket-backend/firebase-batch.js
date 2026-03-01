const { logger } = require('./logger');

class FirebaseBatch {
    constructor() {
        this.database = null;
        this.batchSize = 500; // Firebase limita a 500 operações por batch
        this.retryAttempts = 3;
        this.retryDelay = 1000; // 1 segundo
        this.initialized = false;
    }

    // Inicializar Firebase quando disponível
    initialize() {
        try {
            if (this.initialized) return true;
            
            // Tentar obter Firebase Admin SDK
            const { getDatabase } = require('firebase-admin/database');
            this.database = getDatabase();
            this.initialized = true;
            
            logger.info('🔥 Firebase Batch inicializado com sucesso');
            return true;
            
        } catch (error) {
            logger.warn(`⚠️ Firebase não disponível ainda: ${error.message}`);
            return false;
        }
    }

    // Verificar se está inicializado
    isReady() {
        return this.initialized && this.database !== null;
    }

    // Método para obter estatísticas de performance
    getPerformanceStats() {
        return {
            batchSize: this.batchSize,
            retryAttempts: this.retryAttempts,
            retryDelay: this.retryDelay,
            initialized: this.initialized,
            ready: this.isReady()
        };
    }

    // Método para configurar parâmetros de performance
    setPerformanceConfig(config) {
        if (config.batchSize) this.batchSize = Math.min(config.batchSize, 500);
        if (config.retryAttempts) this.retryAttempts = config.retryAttempts;
        if (config.retryDelay) this.retryDelay = config.retryDelay;
        
        logger.info(`⚙️ Configuração de performance atualizada: ${JSON.stringify(this.getPerformanceStats())}`);
    }

    // Health check do módulo
    async healthCheck() {
        try {
            const isReady = this.isReady();
            
            return {
                status: isReady ? 'healthy' : 'waiting',
                initialized: this.initialized,
                ready: isReady,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = new FirebaseBatch();
