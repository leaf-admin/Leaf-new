const { logStructured, logError } = require('../utils/logger');
/**
 * KYCRetryService - Serviço de retry automático para verificação KYC
 * 
 * Este serviço implementa retry automático inteligente para verificação facial,
 * com delays exponenciais e análise de falhas.
 */

class KYCRetryService {
  constructor() {
    this.maxRetries = 3;
    this.retryDelays = [2000, 5000, 10000]; // 2s, 5s, 10s
    this.retryReasons = {
      LOW_CONFIDENCE: 'confidence_too_low',
      FACE_NOT_DETECTED: 'face_not_detected',
      NETWORK_ERROR: 'network_error',
      SERVER_ERROR: 'server_error',
      TIMEOUT: 'timeout',
      UNKNOWN: 'unknown'
    };
    
    this.retryStats = new Map(); // driverId -> stats
  }

  /**
   * Executar verificação KYC com retry automático
   */
  async verifyWithRetry(driverId, imageData, options = {}) {
    const startTime = Date.now();
    const attempt = 0;
    
    // Inicializar stats para este driver
    this.initializeDriverStats(driverId);
    
    try {
      const result = await this.executeVerificationWithRetry(
        driverId, 
        imageData, 
        attempt, 
        options
      );
      
      // Registrar sucesso
      this.recordSuccess(driverId, Date.now() - startTime, attempt);
      
      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalTime: Date.now() - startTime,
        stats: this.getDriverStats(driverId)
      };
      
    } catch (error) {
      // Registrar falha final
      this.recordFinalFailure(driverId, error, attempt, Date.now() - startTime);
      
      return {
        success: false,
        error: error.message,
        attempts: attempt + 1,
        totalTime: Date.now() - startTime,
        stats: this.getDriverStats(driverId),
        retryReason: this.categorizeError(error)
      };
    }
  }

  /**
   * Executar verificação com retry interno
   */
  async executeVerificationWithRetry(driverId, imageData, attempt, options) {
    try {
      // Importar serviço KYC dinamicamente
      const IntegratedKYCService = require('./IntegratedKYCService');
      
      const result = await IntegratedKYCService.verifyDriver(driverId, imageData);
      
      // Verificar se a confiança é suficiente
      if (result.confidence < (options.minConfidence || 0.75)) {
        throw new Error(`Confiança muito baixa: ${result.confidence}`);
      }
      
      return result;
      
    } catch (error) {
      const retryReason = this.categorizeError(error);
      
      // Verificar se deve tentar novamente
      if (attempt < this.maxRetries && this.shouldRetry(retryReason)) {
        logStructured('info', `🔄 [KYCRetry] Tentativa ${attempt + 1} falhou, tentando novamente em ${this.retryDelays[attempt]}ms...`);
        
        // Registrar tentativa
        this.recordRetryAttempt(driverId, attempt, retryReason, error.message);
        
        // Aguardar delay
        await this.delay(this.retryDelays[attempt]);
        
        // Tentar novamente
        return await this.executeVerificationWithRetry(
          driverId, 
          imageData, 
          attempt + 1, 
          options
        );
      }
      
      // Não deve tentar novamente ou esgotou tentativas
      throw error;
    }
  }

  /**
   * Categorizar erro para decisão de retry
   */
  categorizeError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('confidence') || message.includes('confiança')) {
      return this.retryReasons.LOW_CONFIDENCE;
    }
    
    if (message.includes('face') || message.includes('rosto')) {
      return this.retryReasons.FACE_NOT_DETECTED;
    }
    
    if (message.includes('network') || message.includes('conexão')) {
      return this.retryReasons.NETWORK_ERROR;
    }
    
    if (message.includes('timeout') || message.includes('tempo')) {
      return this.retryReasons.TIMEOUT;
    }
    
    if (message.includes('server') || message.includes('servidor')) {
      return this.retryReasons.SERVER_ERROR;
    }
    
    return this.retryReasons.UNKNOWN;
  }

  /**
   * Determinar se deve tentar novamente baseado no tipo de erro
   */
  shouldRetry(retryReason) {
    const retryableReasons = [
      this.retryReasons.LOW_CONFIDENCE,
      this.retryReasons.FACE_NOT_DETECTED,
      this.retryReasons.NETWORK_ERROR,
      this.retryReasons.TIMEOUT,
      this.retryReasons.SERVER_ERROR
    ];
    
    return retryableReasons.includes(retryReason);
  }

  /**
   * Inicializar estatísticas para um driver
   */
  initializeDriverStats(driverId) {
    if (!this.retryStats.has(driverId)) {
      this.retryStats.set(driverId, {
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        retryAttempts: 0,
        averageConfidence: 0,
        averageTime: 0,
        lastAttempt: null,
        retryReasons: {},
        totalTime: 0
      });
    }
  }

  /**
   * Registrar tentativa de retry
   */
  recordRetryAttempt(driverId, attempt, reason, errorMessage) {
    const stats = this.retryStats.get(driverId);
    stats.retryAttempts++;
    stats.totalAttempts++;
    
    if (!stats.retryReasons[reason]) {
      stats.retryReasons[reason] = 0;
    }
    stats.retryReasons[reason]++;
    
    stats.lastAttempt = {
      attempt: attempt + 1,
      reason,
      errorMessage,
      timestamp: new Date()
    };
  }

  /**
   * Registrar sucesso
   */
  recordSuccess(driverId, duration, attempts) {
    const stats = this.retryStats.get(driverId);
    stats.successfulAttempts++;
    stats.totalAttempts++;
    stats.totalTime += duration;
    stats.averageTime = stats.totalTime / stats.totalAttempts;
    
    stats.lastAttempt = {
      attempt: attempts + 1,
      success: true,
      duration,
      timestamp: new Date()
    };
  }

  /**
   * Registrar falha final
   */
  recordFinalFailure(driverId, error, attempts, duration) {
    const stats = this.retryStats.get(driverId);
    stats.failedAttempts++;
    stats.totalAttempts++;
    stats.totalTime += duration;
    stats.averageTime = stats.totalTime / stats.totalAttempts;
    
    stats.lastAttempt = {
      attempt: attempts + 1,
      success: false,
      error: error.message,
      duration,
      timestamp: new Date()
    };
  }

  /**
   * Obter estatísticas de um driver
   */
  getDriverStats(driverId) {
    return this.retryStats.get(driverId) || null;
  }

  /**
   * Obter estatísticas globais
   */
  getGlobalStats() {
    const globalStats = {
      totalDrivers: this.retryStats.size,
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      retryAttempts: 0,
      averageTime: 0,
      retryReasons: {}
    };

    for (const [driverId, stats] of this.retryStats) {
      globalStats.totalAttempts += stats.totalAttempts;
      globalStats.successfulAttempts += stats.successfulAttempts;
      globalStats.failedAttempts += stats.failedAttempts;
      globalStats.retryAttempts += stats.retryAttempts;
      globalStats.averageTime += stats.averageTime;

      // Agregar razões de retry
      for (const [reason, count] of Object.entries(stats.retryReasons)) {
        if (!globalStats.retryReasons[reason]) {
          globalStats.retryReasons[reason] = 0;
        }
        globalStats.retryReasons[reason] += count;
      }
    }

    if (globalStats.totalDrivers > 0) {
      globalStats.averageTime /= globalStats.totalDrivers;
    }

    return globalStats;
  }

  /**
   * Limpar estatísticas de um driver
   */
  clearDriverStats(driverId) {
    this.retryStats.delete(driverId);
  }

  /**
   * Limpar todas as estatísticas
   */
  clearAllStats() {
    this.retryStats.clear();
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Configurar parâmetros de retry
   */
  configureRetry(options) {
    if (options.maxRetries) {
      this.maxRetries = options.maxRetries;
    }
    
    if (options.retryDelays) {
      this.retryDelays = options.retryDelays;
    }
  }
}

module.exports = KYCRetryService;
