/**
 * CircuitBreaker - Implementação do padrão Circuit Breaker para proteção de serviços
 * 
 * O Circuit Breaker é um padrão de design que previne falhas em cascata
 * detectando falhas e "abrindo o circuito" para evitar chamadas desnecessárias
 * a serviços que estão falhando.
 * 
 * ESTADOS:
 * - CLOSED: Circuito fechado, operações normais
 * - OPEN: Circuito aberto, falhas detectadas, usando fallback
 * - HALF_OPEN: Circuito semi-aberto, testando recuperação
 * 
 * FUNCIONALIDADES:
 * - Detecção automática de falhas
 * - Fallback automático quando circuito está aberto
 * - Teste de recuperação em modo half-open
 * - Métricas detalhadas de falhas e sucessos
 */

const { metrics } = require('../../utils/prometheus-metrics');
const { logStructured, logError } = require('../../utils/logger');

class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'CircuitBreaker';
    
    // Configurações
    this.failureThreshold = options.failureThreshold || 5; // 5 falhas para abrir
    this.timeout = options.timeout || 60000; // 60 segundos para tentar recuperar
    this.resetTimeout = options.resetTimeout || 30000; // 30 segundos para reset
    this.successThreshold = options.successThreshold || 3; // 3 sucessos para fechar
    
    // Estado atual
    this.state = 'CLOSED';
      metrics.setCircuitBreakerState(this.name, 'CLOSED'); // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.nextAttemptTime = null;
    
    // Métricas
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      fallbackRequests: 0,
      circuitOpens: 0,
      circuitCloses: 0,
      stateChanges: 0,
      averageResponseTime: 0,
      lastStateChange: Date.now()
    };
    
    // Callbacks
    this.onStateChange = options.onStateChange || (() => {});
    this.onFailure = options.onFailure || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
    this.onFallback = options.onFallback || (() => {});
    
    // Fallback function
    this.fallbackFunction = options.fallbackFunction || null;
  }

  /**
   * Executar operação com proteção do circuit breaker
   * @param {Function} operation - Função a ser executada
   * @param {Array} args - Argumentos para a função
   * @returns {Promise<any>} Resultado da operação ou fallback
   */
  async execute(operation, ...args) {
    const startTime = Date.now();
    this.metrics.totalRequests++;

    // Verificar se deve usar fallback
    if (this.shouldUseFallback()) {
      return await this.executeFallback(...args);
    }

    try {
      // Executar operação
      const result = await operation(...args);
      
      // Sucesso
      await this.handleSuccess(Date.now() - startTime);
      return result;
      
    } catch (error) {
      // Falha
      await this.handleFailure(error, Date.now() - startTime);
      
      // Se circuito está aberto, usar fallback
      if (this.state === 'OPEN') {
        return await this.executeFallback(...args);
      }
      
      // Re-throw erro se circuito ainda está fechado
      throw error;
    }
  }

  /**
   * Verificar se deve usar fallback
   */
  shouldUseFallback() {
    const now = Date.now();
    
    switch (this.state) {
      case 'OPEN':
        // Se ainda não passou o tempo de timeout, usar fallback
        if (this.nextAttemptTime && now < this.nextAttemptTime) {
          return true;
        }
        // Se passou o timeout, tentar half-open
        this.state = 'HALF_OPEN';
      metrics.setCircuitBreakerState(this.name, 'HALF_OPEN');
        this.successCount = 0;
        this.notifyStateChange();
        return false;
        
      case 'HALF_OPEN':
        // Em half-open, tentar operação normal
        return false;
        
      case 'CLOSED':
      default:
        // Em closed, operação normal
        return false;
    }
  }

  /**
   * Lidar com sucesso
   */
  async handleSuccess(responseTime) {
    this.metrics.successfulRequests++;
    this.lastSuccessTime = Date.now();
    this.updateAverageResponseTime(responseTime);
    
    await this.onSuccess(responseTime);
    
    switch (this.state) {
      case 'HALF_OPEN':
        this.successCount++;
        // Se atingiu threshold de sucessos, fechar circuito
        if (this.successCount >= this.successThreshold) {
          this.closeCircuit();
        }
        break;
        
      case 'CLOSED':
        // Reset contador de falhas em caso de sucesso
        this.failureCount = 0;
        break;
    }
  }

  /**
   * Lidar com falha
   */
  async handleFailure(error, responseTime) {
    this.metrics.failedRequests++;
      metrics.recordCircuitBreakerFailure(this.name);
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.updateAverageResponseTime(responseTime);
    
    await this.onFailure(error, responseTime);
    
    switch (this.state) {
      case 'CLOSED':
        // Se atingiu threshold de falhas, abrir circuito
        if (this.failureCount >= this.failureThreshold) {
          this.openCircuit();
        }
        break;
        
      case 'HALF_OPEN':
        // Em half-open, qualquer falha volta para open
        this.openCircuit();
        break;
    }
  }

  /**
   * Abrir circuito
   */
  openCircuit() {
    if (this.state !== 'OPEN') {
      this.state = 'OPEN';
      metrics.setCircuitBreakerState(this.name, 'OPEN');
      this.metrics.circuitOpens++;
      this.nextAttemptTime = Date.now() + this.timeout;
      this.notifyStateChange();
      
      logStructured('warn', 'Circuito ABERTO', {
        service: 'circuit-breaker',
        operation: 'open',
        circuitName: this.name,
        failureCount: this.failureCount
      });
    }
  }

  /**
   * Fechar circuito
   */
  closeCircuit() {
    if (this.state !== 'CLOSED') {
      this.state = 'CLOSED';
      metrics.setCircuitBreakerState(this.name, 'CLOSED');
      this.metrics.circuitCloses++;
      this.failureCount = 0;
      this.successCount = 0;
      this.nextAttemptTime = null;
      this.notifyStateChange();
      
      logStructured('info', 'Circuito FECHADO - Recuperado', {
        service: 'circuit-breaker',
        operation: 'close',
        circuitName: this.name
      });
    }
  }

  /**
   * Executar fallback
   */
  async executeFallback(...args) {
    this.metrics.fallbackRequests++;
    
    if (!this.fallbackFunction) {
      throw new Error(`Circuit breaker ${this.name} está aberto e não há função de fallback`);
    }
    
    logStructured('info', 'Executando fallback', {
      service: 'circuit-breaker',
      operation: 'fallback',
      circuitName: this.name
    });
    
    try {
      const result = await this.fallbackFunction(...args);
      await this.onFallback(result);
      return result;
    } catch (error) {
      logError(error, 'Fallback também falhou', {
        service: 'circuit-breaker',
        operation: 'fallback',
        circuitName: this.name
      });
      throw error;
    }
  }

  /**
   * Notificar mudança de estado
   */
  notifyStateChange() {
    this.metrics.stateChanges++;
    this.metrics.lastStateChange = Date.now();
    this.onStateChange(this.state);
  }

  /**
   * Atualizar tempo médio de resposta
   */
  updateAverageResponseTime(responseTime) {
    const totalResponses = this.metrics.successfulRequests + this.metrics.failedRequests;
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (totalResponses - 1) + responseTime) / 
      totalResponses;
  }

  /**
   * Definir função de fallback
   */
  setFallbackFunction(fallbackFunction) {
    this.fallbackFunction = fallbackFunction;
    logStructured('info', 'Função de fallback definida', {
      service: 'circuit-breaker',
      operation: 'setFallback',
      circuitName: this.name
    });
  }

  /**
   * Reset manual do circuito
   */
  reset() {
    this.state = 'CLOSED';
      metrics.setCircuitBreakerState(this.name, 'CLOSED');
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.nextAttemptTime = null;
    this.notifyStateChange();
    
    logStructured('info', 'Circuito resetado manualmente', {
      service: 'circuit-breaker',
      operation: 'reset',
      circuitName: this.name
    });
  }

  /**
   * Obter estado atual
   */
  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime,
      timeUntilNextAttempt: this.nextAttemptTime ? 
        Math.max(0, this.nextAttemptTime - Date.now()) : 0
    };
  }

  /**
   * Obter métricas
   */
  getMetrics() {
    const successRate = this.metrics.totalRequests > 0 ? 
      (this.metrics.successfulRequests / this.metrics.totalRequests) * 100 : 0;
    
    const fallbackRate = this.metrics.totalRequests > 0 ? 
      (this.metrics.fallbackRequests / this.metrics.totalRequests) * 100 : 0;

    return {
      ...this.metrics,
      successRate,
      fallbackRate,
      currentState: this.state,
      isHealthy: this.state === 'CLOSED',
      uptime: Date.now() - this.metrics.lastStateChange
    };
  }

  /**
   * Obter status de saúde
   */
  getHealthStatus() {
    return {
      service: this.name,
      status: this.state === 'CLOSED' ? 'healthy' : 'degraded',
      state: this.state,
      metrics: this.getMetrics(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Verificar se está saudável
   */
  isHealthy() {
    return this.state === 'CLOSED';
  }

  /**
   * Obter tempo até próxima tentativa
   */
  getTimeUntilNextAttempt() {
    if (this.state === 'OPEN' && this.nextAttemptTime) {
      return Math.max(0, this.nextAttemptTime - Date.now());
    }
    return 0;
  }
}

module.exports = CircuitBreaker;
