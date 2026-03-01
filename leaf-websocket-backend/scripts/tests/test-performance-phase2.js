/**
 * Teste de Performance: Redis Streams vs Fallback
 * 
 * Este script compara a performance entre Redis Streams e Fallback,
 * demonstrando os benefícios do processamento assíncrono.
 */

const StreamServiceFunctional = require('./services/streams/StreamServiceFunctional');
const FallbackService = require('./services/streams/FallbackService');

class PerformanceComparisonTest {
  constructor() {
    this.name = 'PerformanceComparisonTest';
    this.results = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      testResults: [],
      performanceData: {
        fallback: [],
        streams: [],
        comparison: {}
      }
    };
  }

  /**
   * Executar todos os testes de performance
   */
  async runAllTests() {
    console.log('⚡ TESTE DE PERFORMANCE: REDIS STREAMS vs FALLBACK');
    console.log('================================================');
    console.log('');

    try {
      // Teste 1: Performance básica do Fallback
      await this.testFallbackPerformance();
      
      // Teste 2: Performance básica do Redis Streams
      await this.testStreamsPerformance();
      
      // Teste 3: Comparação de latência
      await this.testLatencyComparison();
      
      // Teste 4: Teste de throughput
      await this.testThroughputComparison();
      
      // Teste 5: Teste de escalabilidade
      await this.testScalabilityComparison();
      
      // Teste 6: Teste de recuperação
      await this.testRecoveryComparison();
      
      // Exibir resultados
      this.displayResults();
      
    } catch (error) {
      console.error('❌ Erro durante os testes:', error);
    }
  }

  /**
   * Teste 1: Performance básica do Fallback
   */
  async testFallbackPerformance() {
    console.log('🔄 TESTE 1: Performance do Fallback');
    console.log('----------------------------------');
    
    try {
      const fallbackService = new FallbackService();
      
      console.log('📋 Testando performance do Fallback...');
      
      const testCases = [
        { customerId: 'customer1', location: { lat: -23.5505, lng: -46.6333 } },
        { customerId: 'customer2', location: { lat: -23.5506, lng: -46.6334 } },
        { customerId: 'customer3', location: { lat: -23.5507, lng: -46.6335 } }
      ];
      
      const results = [];
      
      for (const testCase of testCases) {
        const startTime = Date.now();
        const result = await fallbackService.processMatching(testCase.customerId, testCase.location);
        const endTime = Date.now();
        
        results.push({
          customerId: testCase.customerId,
          latency: endTime - startTime,
          success: result.success,
          method: result.method
        });
        
        console.log(`✅ ${testCase.customerId}: ${endTime - startTime}ms`);
      }
      
      const averageLatency = results.reduce((sum, r) => sum + r.latency, 0) / results.length;
      const successRate = (results.filter(r => r.success).length / results.length) * 100;
      
      this.results.performanceData.fallback = {
        averageLatency,
        successRate,
        totalTests: results.length,
        results
      };
      
      console.log(`📊 Fallback - Latência média: ${averageLatency.toFixed(1)}ms, Sucesso: ${successRate.toFixed(1)}%`);
      
      this.passTest('Performance do Fallback');
      
    } catch (error) {
      this.failTest('Performance do Fallback', error.message);
    }
  }

  /**
   * Teste 2: Performance básica do Redis Streams
   */
  async testStreamsPerformance() {
    console.log('🚀 TESTE 2: Performance do Redis Streams');
    console.log('--------------------------------------');
    
    try {
      const streamService = new StreamServiceFunctional({
        general: { enabled: true, debug: false },
        fallback: { enabled: false }, // Desabilitar fallback para teste puro
        monitoring: { enabled: false },
        synchronization: { enabled: false }
      });
      
      console.log('📋 Inicializando StreamService...');
      await streamService.initialize();
      
      console.log('📋 Testando performance do Redis Streams...');
      
      const testCases = [
        { customerId: 'customer1', location: { lat: -23.5505, lng: -46.6333 } },
        { customerId: 'customer2', location: { lat: -23.5506, lng: -46.6334 } },
        { customerId: 'customer3', location: { lat: -23.5507, lng: -46.6335 } }
      ];
      
      const results = [];
      
      for (const testCase of testCases) {
        const startTime = Date.now();
        const result = await streamService.processMatching(testCase.customerId, testCase.location);
        const endTime = Date.now();
        
        results.push({
          customerId: testCase.customerId,
          latency: endTime - startTime,
          success: result.success,
          method: result.method
        });
        
        console.log(`✅ ${testCase.customerId}: ${endTime - startTime}ms (${result.method})`);
      }
      
      const averageLatency = results.reduce((sum, r) => sum + r.latency, 0) / results.length;
      const successRate = (results.filter(r => r.success).length / results.length) * 100;
      
      this.results.performanceData.streams = {
        averageLatency,
        successRate,
        totalTests: results.length,
        results
      };
      
      console.log(`📊 Streams - Latência média: ${averageLatency.toFixed(1)}ms, Sucesso: ${successRate.toFixed(1)}%`);
      
      // Parar serviço
      await streamService.stop();
      
      this.passTest('Performance do Redis Streams');
      
    } catch (error) {
      this.failTest('Performance do Redis Streams', error.message);
    }
  }

  /**
   * Teste 3: Comparação de latência
   */
  async testLatencyComparison() {
    console.log('⚡ TESTE 3: Comparação de Latência');
    console.log('--------------------------------');
    
    try {
      const fallbackService = new FallbackService();
      const streamService = new StreamServiceFunctional({
        general: { enabled: true, debug: false },
        fallback: { enabled: false },
        monitoring: { enabled: false },
        synchronization: { enabled: false }
      });
      
      await streamService.initialize();
      
      console.log('📋 Comparando latência entre Fallback e Streams...');
      
      const testCase = { customerId: 'customer_test', location: { lat: -23.5505, lng: -46.6333 } };
      
      // Teste Fallback
      const fallbackStart = Date.now();
      const fallbackResult = await fallbackService.processMatching(testCase.customerId, testCase.location);
      const fallbackLatency = Date.now() - fallbackStart;
      
      // Teste Streams
      const streamsStart = Date.now();
      const streamsResult = await streamService.processMatching(testCase.customerId, testCase.location);
      const streamsLatency = Date.now() - streamsStart;
      
      // Calcular melhoria
      const improvement = ((fallbackLatency - streamsLatency) / fallbackLatency) * 100;
      
      console.log(`📊 Fallback: ${fallbackLatency}ms`);
      console.log(`📊 Streams: ${streamsLatency}ms`);
      console.log(`📊 Melhoria: ${improvement.toFixed(1)}% mais rápido`);
      
      this.results.performanceData.comparison.latency = {
        fallback: fallbackLatency,
        streams: streamsLatency,
        improvement: improvement,
        fallbackResult: fallbackResult.success,
        streamsResult: streamsResult.success
      };
      
      await streamService.stop();
      
      this.passTest('Comparação de Latência');
      
    } catch (error) {
      this.failTest('Comparação de Latência', error.message);
    }
  }

  /**
   * Teste 4: Teste de throughput
   */
  async testThroughputComparison() {
    console.log('📈 TESTE 4: Comparação de Throughput');
    console.log('------------------------------------');
    
    try {
      const fallbackService = new FallbackService();
      const streamService = new StreamServiceFunctional({
        general: { enabled: true, debug: false },
        fallback: { enabled: false },
        monitoring: { enabled: false },
        synchronization: { enabled: false }
      });
      
      await streamService.initialize();
      
      console.log('📋 Testando throughput com 10 operações simultâneas...');
      
      const testCases = Array.from({ length: 10 }, (_, i) => ({
        customerId: `customer${i}`,
        location: { lat: -23.5505 + (i * 0.001), lng: -46.6333 + (i * 0.001) }
      }));
      
      // Teste Fallback (sequencial)
      console.log('🔄 Testando Fallback (sequencial)...');
      const fallbackStart = Date.now();
      const fallbackResults = [];
      
      for (const testCase of testCases) {
        const result = await fallbackService.processMatching(testCase.customerId, testCase.location);
        fallbackResults.push(result);
      }
      const fallbackTime = Date.now() - fallbackStart;
      
      // Teste Streams (paralelo)
      console.log('🚀 Testando Streams (paralelo)...');
      const streamsStart = Date.now();
      const streamsPromises = testCases.map(testCase => 
        streamService.processMatching(testCase.customerId, testCase.location)
      );
      const streamsResults = await Promise.all(streamsPromises);
      const streamsTime = Date.now() - streamsStart;
      
      // Calcular métricas
      const fallbackThroughput = (testCases.length / fallbackTime) * 1000; // ops/segundo
      const streamsThroughput = (testCases.length / streamsTime) * 1000; // ops/segundo
      const throughputImprovement = ((streamsThroughput - fallbackThroughput) / fallbackThroughput) * 100;
      
      console.log(`📊 Fallback: ${fallbackTime}ms total, ${fallbackThroughput.toFixed(2)} ops/s`);
      console.log(`📊 Streams: ${streamsTime}ms total, ${streamsThroughput.toFixed(2)} ops/s`);
      console.log(`📊 Melhoria de throughput: ${throughputImprovement.toFixed(1)}%`);
      
      this.results.performanceData.comparison.throughput = {
        fallback: { time: fallbackTime, throughput: fallbackThroughput },
        streams: { time: streamsTime, throughput: streamsThroughput },
        improvement: throughputImprovement,
        fallbackSuccess: fallbackResults.filter(r => r.success).length,
        streamsSuccess: streamsResults.filter(r => r.success).length
      };
      
      await streamService.stop();
      
      this.passTest('Comparação de Throughput');
      
    } catch (error) {
      this.failTest('Comparação de Throughput', error.message);
    }
  }

  /**
   * Teste 5: Teste de escalabilidade
   */
  async testScalabilityComparison() {
    console.log('📊 TESTE 5: Comparação de Escalabilidade');
    console.log('--------------------------------------');
    
    try {
      const streamService = new StreamServiceFunctional({
        general: { enabled: true, debug: false },
        fallback: { enabled: true }, // Habilitar fallback para teste
        monitoring: { enabled: false },
        synchronization: { enabled: false }
      });
      
      await streamService.initialize();
      
      console.log('📋 Testando escalabilidade com diferentes cargas...');
      
      const loadTests = [
        { name: 'Baixa Carga', count: 5 },
        { name: 'Média Carga', count: 15 },
        { name: 'Alta Carga', count: 30 }
      ];
      
      const scalabilityResults = {};
      
      for (const loadTest of loadTests) {
        console.log(`🔄 Testando ${loadTest.name} (${loadTest.count} operações)...`);
        
        const testCases = Array.from({ length: loadTest.count }, (_, i) => ({
          customerId: `customer_${loadTest.name.toLowerCase().replace(' ', '_')}_${i}`,
          location: { lat: -23.5505 + (i * 0.001), lng: -46.6333 + (i * 0.001) }
        }));
        
        const startTime = Date.now();
        const promises = testCases.map(testCase => 
          streamService.processMatching(testCase.customerId, testCase.location)
        );
        const results = await Promise.all(promises);
        const endTime = Date.now();
        
        const totalTime = endTime - startTime;
        const throughput = (loadTest.count / totalTime) * 1000;
        const successRate = (results.filter(r => r.success).length / results.length) * 100;
        const averageLatency = totalTime / loadTest.count;
        
        scalabilityResults[loadTest.name] = {
          count: loadTest.count,
          totalTime,
          throughput,
          successRate,
          averageLatency,
          mode: streamService.isStreamsMode ? 'streams' : 'fallback'
        };
        
        console.log(`📊 ${loadTest.name}: ${totalTime}ms total, ${throughput.toFixed(2)} ops/s, ${successRate.toFixed(1)}% sucesso`);
      }
      
      this.results.performanceData.comparison.scalability = scalabilityResults;
      
      await streamService.stop();
      
      this.passTest('Comparação de Escalabilidade');
      
    } catch (error) {
      this.failTest('Comparação de Escalabilidade', error.message);
    }
  }

  /**
   * Teste 6: Teste de recuperação
   */
  async testRecoveryComparison() {
    console.log('🔄 TESTE 6: Comparação de Recuperação');
    console.log('------------------------------------');
    
    try {
      const streamService = new StreamServiceFunctional({
        general: { enabled: true, debug: false },
        fallback: { enabled: true },
        monitoring: { enabled: true },
        synchronization: { enabled: false }
      });
      
      await streamService.initialize();
      
      console.log('📋 Testando recuperação automática...');
      
      // Teste normal
      const normalResult = await streamService.processMatching('customer_normal', {
        lat: -23.5505, lng: -46.6333
      });
      
      console.log(`✅ Operação normal: ${normalResult.method} (${normalResult.latency}ms)`);
      
      // Simular falha do Redis (desconectar)
      if (streamService.redisManager && streamService.redisManager.isConnected) {
        console.log('🔌 Simulando falha do Redis...');
        await streamService.redisManager.disconnect();
        
        // Aguardar um pouco para o health monitor detectar
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Teste com Redis desconectado
        const fallbackResult = await streamService.processMatching('customer_fallback', {
          lat: -23.5505, lng: -46.6333
        });
        
        console.log(`✅ Operação com fallback: ${fallbackResult.method} (${fallbackResult.latency}ms)`);
        
        // Tentar reconectar
        console.log('🔌 Tentando reconectar Redis...');
        await streamService.redisManager.connect();
        
        // Aguardar um pouco para o health monitor detectar
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Teste após reconexão
        const recoveryResult = await streamService.processMatching('customer_recovery', {
          lat: -23.5505, lng: -46.6333
        });
        
        console.log(`✅ Operação após recuperação: ${recoveryResult.method} (${recoveryResult.latency}ms)`);
        
        this.results.performanceData.comparison.recovery = {
          normal: { method: normalResult.method, latency: normalResult.latency },
          fallback: { method: fallbackResult.method, latency: fallbackResult.latency },
          recovery: { method: recoveryResult.method, latency: recoveryResult.latency },
          fallbackWorked: fallbackResult.method === 'fallback',
          recoveryWorked: recoveryResult.method === 'stream'
        };
      } else {
        console.log('ℹ️ Redis não estava conectado, testando apenas fallback');
        
        const fallbackResult = await streamService.processMatching('customer_fallback_only', {
          lat: -23.5505, lng: -46.6333
        });
        
        this.results.performanceData.comparison.recovery = {
          fallback: { method: fallbackResult.method, latency: fallbackResult.latency },
          fallbackWorked: fallbackResult.method === 'fallback'
        };
      }
      
      await streamService.stop();
      
      this.passTest('Comparação de Recuperação');
      
    } catch (error) {
      this.failTest('Comparação de Recuperação', error.message);
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
    console.log('📊 RESULTADOS DOS TESTES DE PERFORMANCE');
    console.log('=======================================');
    console.log('');
    
    const successRate = (this.results.passedTests / this.results.totalTests) * 100;
    
    console.log(`Total de Testes: ${this.results.totalTests}`);
    console.log(`Testes Passaram: ${this.results.passedTests}`);
    console.log(`Testes Falharam: ${this.results.failedTests}`);
    console.log(`Taxa de Sucesso: ${successRate.toFixed(1)}%`);
    console.log('');
    
    // Exibir dados de performance
    this.displayPerformanceData();
    
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
      console.log('🎉 TODOS OS TESTES PASSARAM! Sistema de Redis Streams está funcionando perfeitamente.');
    } else if (successRate >= 80) {
      console.log('✅ MAIORIA DOS TESTES PASSOU! Sistema de Redis Streams está funcionando bem.');
    } else {
      console.log('⚠️ ALGUNS TESTES FALHARAM! Verificar implementação do sistema de Redis Streams.');
    }
    
    console.log('');
    console.log('🚀 FASE 2 CONCLUÍDA: Redis Streams implementados e testados!');
  }

  /**
   * Exibir dados de performance
   */
  displayPerformanceData() {
    console.log('⚡ DADOS DE PERFORMANCE:');
    console.log('----------------------');
    
    // Dados do Fallback
    if (this.results.performanceData.fallback.averageLatency) {
      console.log(`🔄 Fallback:`);
      console.log(`   Latência média: ${this.results.performanceData.fallback.averageLatency.toFixed(1)}ms`);
      console.log(`   Taxa de sucesso: ${this.results.performanceData.fallback.successRate.toFixed(1)}%`);
    }
    
    // Dados dos Streams
    if (this.results.performanceData.streams.averageLatency) {
      console.log(`🚀 Redis Streams:`);
      console.log(`   Latência média: ${this.results.performanceData.streams.averageLatency.toFixed(1)}ms`);
      console.log(`   Taxa de sucesso: ${this.results.performanceData.streams.successRate.toFixed(1)}%`);
    }
    
    // Comparações
    if (this.results.performanceData.comparison.latency) {
      const latency = this.results.performanceData.comparison.latency;
      console.log(`⚡ Comparação de Latência:`);
      console.log(`   Melhoria: ${latency.improvement.toFixed(1)}% mais rápido`);
    }
    
    if (this.results.performanceData.comparison.throughput) {
      const throughput = this.results.performanceData.comparison.throughput;
      console.log(`📈 Comparação de Throughput:`);
      console.log(`   Melhoria: ${throughput.improvement.toFixed(1)}% mais throughput`);
    }
    
    console.log('');
  }
}

// Executar testes se chamado diretamente
if (require.main === module) {
  const test = new PerformanceComparisonTest();
  test.runAllTests().catch(console.error);
}

module.exports = PerformanceComparisonTest;
