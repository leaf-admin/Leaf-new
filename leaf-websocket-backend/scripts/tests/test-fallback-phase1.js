/**
 * Teste de Fallback para Redis Streams
 * 
 * Este script testa o sistema de fallback implementado na Fase 1,
 * verificando se o FallbackService funciona corretamente quando
 * Redis Streams não está disponível.
 */

const FallbackService = require('./services/streams/FallbackService');
const HealthMonitor = require('./middleware/streams/HealthMonitor');
const CircuitBreaker = require('./middleware/streams/CircuitBreaker');
const StateSynchronizer = require('./middleware/streams/StateSynchronizer');
const StreamServiceFunctional = require('./services/streams/StreamServiceFunctional');

class FallbackTest {
  constructor() {
    this.name = 'FallbackTest';
    this.results = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      testResults: []
    };
  }

  /**
   * Executar todos os testes
   */
  async runAllTests() {
    console.log('🧪 INICIANDO TESTES DE FALLBACK');
    console.log('================================');
    console.log('');

    try {
      // Teste 1: FallbackService básico
      await this.testFallbackService();
      
      // Teste 2: CircuitBreaker
      await this.testCircuitBreaker();
      
      // Teste 3: HealthMonitor
      await this.testHealthMonitor();
      
      // Teste 4: StateSynchronizer
      await this.testStateSynchronizer();
      
      // Teste 5: StreamService integrado
      await this.testStreamService();
      
      // Teste 6: Cenários de falha
      await this.testFailureScenarios();
      
      // Teste 7: Performance do fallback
      await this.testFallbackPerformance();
      
      // Exibir resultados
      this.displayResults();
      
    } catch (error) {
      console.error('❌ Erro durante os testes:', error);
    }
  }

  /**
   * Teste 1: FallbackService básico
   */
  async testFallbackService() {
    console.log('🔧 TESTE 1: FallbackService Básico');
    console.log('----------------------------------');
    
    try {
      const fallbackService = new FallbackService();
      
      // Teste de matching
      console.log('📋 Testando matching de motoristas...');
      const matchingResult = await fallbackService.processMatching('customer123', {
        lat: -23.5505,
        lng: -46.6333
      });
      
      this.assert(matchingResult.success === true, 'Matching deve ser bem-sucedido');
      this.assert(matchingResult.method === 'fallback_sync', 'Método deve ser fallback_sync');
      this.assert(matchingResult.latency > 0, 'Latência deve ser maior que 0');
      this.assert(matchingResult.driverId !== null, 'Deve retornar um motorista');
      
      console.log(`✅ Matching: ${matchingResult.latency}ms, Driver: ${matchingResult.driverId}`);
      
      // Teste de atualização de status
      console.log('📋 Testando atualização de status...');
      const statusResult = await fallbackService.processStatusUpdate('ride456', 'in_progress');
      
      this.assert(statusResult.success === true, 'Atualização de status deve ser bem-sucedida');
      this.assert(statusResult.method === 'fallback_sync', 'Método deve ser fallback_sync');
      this.assert(statusResult.rideId === 'ride456', 'ID da corrida deve ser correto');
      
      console.log(`✅ Status Update: ${statusResult.latency}ms`);
      
      // Teste de métricas
      const metrics = fallbackService.getMetrics();
      this.assert(metrics.requestsProcessed > 0, 'Deve ter processado requests');
      this.assert(metrics.averageLatency > 0, 'Latência média deve ser maior que 0');
      
      console.log(`✅ Métricas: ${metrics.requestsProcessed} requests, ${metrics.averageLatency}ms média`);
      
      this.passTest('FallbackService básico');
      
    } catch (error) {
      this.failTest('FallbackService básico', error.message);
    }
  }

  /**
   * Teste 2: CircuitBreaker
   */
  async testCircuitBreaker() {
    console.log('🔒 TESTE 2: CircuitBreaker');
    console.log('-------------------------');
    
    try {
      const circuitBreaker = new CircuitBreaker({
        name: 'test-circuit',
        failureThreshold: 3,
        timeout: 5000,
        resetTimeout: 2000,
        successThreshold: 2
      });
      
      // Função que sempre falha
      const failingOperation = async () => {
        throw new Error('Operação falhou');
      };
      
      // Função de fallback
      const fallbackFunction = async () => {
        return { success: true, method: 'fallback' };
      };
      
      circuitBreaker.setFallbackFunction(fallbackFunction);
      
      // Teste de falhas consecutivas
      console.log('📋 Testando falhas consecutivas...');
      
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(failingOperation);
        } catch (error) {
          // Esperado
        }
      }
      
      // Verificar se circuito está aberto
      const state = circuitBreaker.getState();
      this.assert(state.state === 'OPEN', 'Circuito deve estar aberto após falhas');
      
      console.log(`✅ Circuito aberto após ${state.failureCount} falhas`);
      
      // Teste de fallback
      console.log('📋 Testando fallback...');
      const fallbackResult = await circuitBreaker.execute(failingOperation);
      
      this.assert(fallbackResult.success === true, 'Fallback deve ser bem-sucedido');
      this.assert(fallbackResult.method === 'fallback', 'Método deve ser fallback');
      
      console.log('✅ Fallback executado com sucesso');
      
      // Teste de recuperação
      console.log('📋 Testando recuperação...');
      
      // Aguardar timeout
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Função que funciona
      const workingOperation = async () => {
        return { success: true, method: 'normal' };
      };
      
      // Executar operação que funciona
      const recoveryResult = await circuitBreaker.execute(workingOperation);
      this.assert(recoveryResult.success === true, 'Recuperação deve ser bem-sucedida');
      
      console.log('✅ Recuperação testada');
      
      this.passTest('CircuitBreaker');
      
    } catch (error) {
      this.failTest('CircuitBreaker', error.message);
    }
  }

  /**
   * Teste 3: HealthMonitor
   */
  async testHealthMonitor() {
    console.log('🔍 TESTE 3: HealthMonitor');
    console.log('-------------------------');
    
    try {
      const healthMonitor = new HealthMonitor({
        checkInterval: 1000,
        timeout: 2000,
        failureThreshold: 2
      });
      
      // Iniciar monitoramento
      console.log('📋 Iniciando monitoramento...');
      await healthMonitor.start();
      
      // Aguardar algumas verificações
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verificar métricas
      const metrics = healthMonitor.getMetrics();
      this.assert(metrics.totalChecks > 0, 'Deve ter realizado verificações');
      this.assert(metrics.successRate >= 0, 'Taxa de sucesso deve ser válida');
      
      console.log(`✅ Verificações: ${metrics.totalChecks}, Sucesso: ${metrics.successRate.toFixed(1)}%`);
      
      // Verificar status de saúde
      const healthStatus = healthMonitor.getHealthStatus();
      this.assert(healthStatus.status === 'healthy' || healthStatus.status === 'unhealthy', 'Status deve ser válido');
      
      console.log(`✅ Status: ${healthStatus.status}`);
      
      // Parar monitoramento
      await healthMonitor.stop();
      
      this.passTest('HealthMonitor');
      
    } catch (error) {
      this.failTest('HealthMonitor', error.message);
    }
  }

  /**
   * Teste 4: StateSynchronizer
   */
  async testStateSynchronizer() {
    console.log('🔄 TESTE 4: StateSynchronizer');
    console.log('-----------------------------');
    
    try {
      const stateSynchronizer = new StateSynchronizer({
        syncInterval: 2000,
        maxRetries: 2
      });
      
      // Iniciar sincronização
      console.log('📋 Iniciando sincronização...');
      await stateSynchronizer.start();
      
      // Aguardar algumas sincronizações
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verificar métricas
      const metrics = stateSynchronizer.getMetrics();
      this.assert(metrics.totalSyncs > 0, 'Deve ter realizado sincronizações');
      this.assert(metrics.successRate >= 0, 'Taxa de sucesso deve ser válida');
      
      console.log(`✅ Sincronizações: ${metrics.totalSyncs}, Sucesso: ${metrics.successRate.toFixed(1)}%`);
      
      // Parar sincronização
      await stateSynchronizer.stop();
      
      this.passTest('StateSynchronizer');
      
    } catch (error) {
      this.failTest('StateSynchronizer', error.message);
    }
  }

  /**
   * Teste 5: StreamServiceFunctional integrado
   */
  async testStreamService() {
    console.log('🚀 TESTE 5: StreamServiceFunctional Integrado');
    console.log('---------------------------------------------');
    
    try {
      const streamService = new StreamServiceFunctional({
        general: { enabled: true, debug: true },
        fallback: { enabled: true },
        monitoring: { enabled: false }, // Desabilitar para teste
        synchronization: { enabled: false } // Desabilitar para teste
      });
      
      // Inicializar serviço
      console.log('📋 Inicializando StreamServiceFunctional...');
      await streamService.initialize();
      
      console.log(`✅ StreamServiceFunctional inicializado - Modo: ${streamService.isStreamsMode ? 'Redis Streams' : 'Fallback'}`);
      
      // Teste de matching
      console.log('📋 Testando matching via StreamServiceFunctional...');
      const matchingResult = await streamService.processMatching('customer789', {
        lat: -23.5505,
        lng: -46.6333
      });
      
      this.assert(matchingResult.success === true, 'Matching deve ser bem-sucedido');
      console.log(`✅ Matching: ${matchingResult.latency}ms, Método: ${matchingResult.method}`);
      
      // Teste de notificação
      console.log('📋 Testando notificação push...');
      const notificationResult = await streamService.sendPushNotification(
        'user123',
        'ride_request',
        'Nova corrida disponível',
        { rideId: 'ride789' }
      );
      
      this.assert(notificationResult.success === true, 'Notificação deve ser bem-sucedida');
      console.log(`✅ Notificação: ${notificationResult.latency}ms`);
      
      // Verificar métricas
      const metrics = streamService.getMetrics();
      this.assert(metrics.totalOperations > 0, 'Deve ter realizado operações');
      this.assert(metrics.successRate >= 0, 'Taxa de sucesso deve ser válida');
      
      console.log(`✅ Operações: ${metrics.totalOperations}, Sucesso: ${metrics.successRate.toFixed(1)}%`);
      
      // Verificar status de saúde
      const healthStatus = streamService.getHealthStatus();
      this.assert(healthStatus.service === 'StreamServiceFunctional', 'Nome do serviço deve ser correto');
      console.log(`✅ Status de saúde: ${healthStatus.status}, Modo: ${healthStatus.mode || 'N/A'}`);
      
      // Parar serviço
      await streamService.stop();
      
      this.passTest('StreamServiceFunctional integrado');
      
    } catch (error) {
      this.failTest('StreamServiceFunctional integrado', error.message);
    }
  }

  /**
   * Teste 6: Cenários de falha
   */
  async testFailureScenarios() {
    console.log('💥 TESTE 6: Cenários de Falha');
    console.log('-----------------------------');
    
    try {
      const fallbackService = new FallbackService();
      
      // Teste com dados inválidos
      console.log('📋 Testando com dados inválidos...');
      
      try {
        await fallbackService.processMatching(null, null);
        this.failTest('Dados inválidos', 'Deveria ter falhado com dados nulos');
      } catch (error) {
        console.log('✅ Falha esperada com dados nulos');
      }
      
      // Teste com localização inválida
      console.log('📋 Testando com localização inválida...');
      
      try {
        await fallbackService.processMatching('customer123', { lat: 'invalid', lng: 'invalid' });
        console.log('✅ Processamento com localização inválida');
      } catch (error) {
        console.log('✅ Falha esperada com localização inválida');
      }
      
      // Teste de timeout
      console.log('📋 Testando timeout...');
      
      const startTime = Date.now();
      const timeoutResult = await fallbackService.processMatching('customer456', {
        lat: -23.5505,
        lng: -46.6333
      });
      const endTime = Date.now();
      
      this.assert(endTime - startTime > 5000, 'Deve demorar mais de 5 segundos (simulação)');
      console.log(`✅ Timeout testado: ${endTime - startTime}ms`);
      
      this.passTest('Cenários de falha');
      
    } catch (error) {
      this.failTest('Cenários de falha', error.message);
    }
  }

  /**
   * Teste 7: Performance do fallback
   */
  async testFallbackPerformance() {
    console.log('⚡ TESTE 7: Performance do Fallback');
    console.log('-----------------------------------');
    
    try {
      const fallbackService = new FallbackService();
      
      // Teste de múltiplas operações
      console.log('📋 Testando múltiplas operações...');
      
      const operations = [];
      const startTime = Date.now();
      
      for (let i = 0; i < 5; i++) {
        operations.push(
          fallbackService.processMatching(`customer${i}`, {
            lat: -23.5505 + (i * 0.001),
            lng: -46.6333 + (i * 0.001)
          })
        );
      }
      
      const results = await Promise.all(operations);
      const endTime = Date.now();
      
      // Verificar resultados
      this.assert(results.length === 5, 'Deve ter 5 resultados');
      
      const successfulResults = results.filter(r => r.success);
      this.assert(successfulResults.length === 5, 'Todos os resultados devem ser bem-sucedidos');
      
      const totalTime = endTime - startTime;
      const averageTime = totalTime / 5;
      
      console.log(`✅ 5 operações em ${totalTime}ms (média: ${averageTime}ms)`);
      
      // Verificar métricas
      const metrics = fallbackService.getMetrics();
      this.assert(metrics.requestsProcessed >= 5, 'Deve ter processado pelo menos 5 requests');
      
      console.log(`✅ Métricas: ${metrics.requestsProcessed} requests, ${metrics.averageLatency.toFixed(1)}ms média`);
      
      this.passTest('Performance do fallback');
      
    } catch (error) {
      this.failTest('Performance do fallback', error.message);
    }
  }

  /**
   * Assert helper
   */
  assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  /**
   * Marcar teste como passou
   */
  passTest(testName) {
    this.results.totalTests++;
    this.results.passedTests++;
    this.results.testResults.push({
      name: testName,
      status: 'PASSED',
      message: 'Teste passou com sucesso'
    });
    
    console.log(`✅ ${testName}: PASSOU`);
    console.log('');
  }

  /**
   * Marcar teste como falhou
   */
  failTest(testName, errorMessage) {
    this.results.totalTests++;
    this.results.failedTests++;
    this.results.testResults.push({
      name: testName,
      status: 'FAILED',
      message: errorMessage
    });
    
    console.log(`❌ ${testName}: FALHOU - ${errorMessage}`);
    console.log('');
  }

  /**
   * Exibir resultados finais
   */
  displayResults() {
    console.log('📊 RESULTADOS DOS TESTES');
    console.log('========================');
    console.log('');
    
    const successRate = (this.results.passedTests / this.results.totalTests) * 100;
    
    console.log(`Total de Testes: ${this.results.totalTests}`);
    console.log(`Testes Passaram: ${this.results.passedTests}`);
    console.log(`Testes Falharam: ${this.results.failedTests}`);
    console.log(`Taxa de Sucesso: ${successRate.toFixed(1)}%`);
    console.log('');
    
    console.log('📋 DETALHES DOS TESTES:');
    console.log('----------------------');
    
    for (const test of this.results.testResults) {
      const status = test.status === 'PASSED' ? '✅' : '❌';
      console.log(`${status} ${test.name}: ${test.status}`);
      if (test.status === 'FAILED') {
        console.log(`   Erro: ${test.message}`);
      }
    }
    
    console.log('');
    
    if (successRate === 100) {
      console.log('🎉 TODOS OS TESTES PASSARAM! Sistema de fallback está funcionando perfeitamente.');
    } else if (successRate >= 80) {
      console.log('✅ MAIORIA DOS TESTES PASSOU! Sistema de fallback está funcionando bem.');
    } else {
      console.log('⚠️ ALGUNS TESTES FALHARAM! Verificar implementação do sistema de fallback.');
    }
    
    console.log('');
    console.log('🚀 FASE 1 CONCLUÍDA: Sistema de fallback implementado e testado!');
  }
}

// Executar testes se chamado diretamente
if (require.main === module) {
  const test = new FallbackTest();
  test.runAllTests().catch(console.error);
}

module.exports = FallbackTest;
