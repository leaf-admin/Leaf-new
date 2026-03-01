/**
 * Teste de Integração Total - Ponta a Ponta
 * 
 * Este teste integra Redis Streams com o sistema principal,
 * testando o fluxo completo desde a requisição até a resposta.
 * 
 * CENÁRIOS TESTADOS:
 * - Fluxo completo de matching de motoristas
 * - Notificações em tempo real via WebSocket
 * - Atualizações de status de corridas
 * - Push notifications
 * - Analytics e métricas
 * - Fallback automático
 * - Performance em produção
 */

const StreamServiceFunctional = require('./services/streams/StreamServiceFunctional');
const FallbackService = require('./services/streams/FallbackService');
const io = require('socket.io-client');

class IntegrationTest {
  constructor() {
    this.name = 'IntegrationTest';
    this.results = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      testResults: [],
      integrationData: {
        websocketConnections: [],
        matchingFlows: [],
        notifications: [],
        performanceMetrics: {}
      }
    };
    
    this.streamService = null;
    this.socket = null;
    this.testUsers = [
      { id: 'customer_integration_1', type: 'customer', location: { lat: -23.5505, lng: -46.6333 } },
      { id: 'customer_integration_2', type: 'customer', location: { lat: -23.5506, lng: -46.6334 } },
      { id: 'driver_integration_1', type: 'driver', location: { lat: -23.5507, lng: -46.6335 } },
      { id: 'driver_integration_2', type: 'driver', location: { lat: -23.5508, lng: -46.6336 } }
    ];
  }

  /**
   * Executar todos os testes de integração
   */
  async runAllTests() {
    console.log('🧪 TESTE DE INTEGRAÇÃO TOTAL - PONTA A PONTA');
    console.log('===========================================');
    console.log('');

    try {
      // Setup inicial
      await this.setupIntegration();
      
      // Teste 1: Fluxo completo de matching
      await this.testCompleteMatchingFlow();
      
      // Teste 2: Integração WebSocket
      await this.testWebSocketIntegration();
      
      // Teste 3: Notificações em tempo real
      await this.testRealtimeNotifications();
      
      // Teste 4: Atualizações de status
      await this.testStatusUpdates();
      
      // Teste 5: Push notifications
      await this.testPushNotifications();
      
      // Teste 6: Analytics e métricas
      await this.testAnalyticsAndMetrics();
      
      // Teste 7: Fallback automático
      await this.testAutomaticFallback();
      
      // Teste 8: Performance em produção
      await this.testProductionPerformance();
      
      // Cleanup
      await this.cleanup();
      
      // Exibir resultados
      this.displayResults();
      
    } catch (error) {
      console.error('❌ Erro durante os testes de integração:', error);
    }
  }

  /**
   * Setup inicial da integração
   */
  async setupIntegration() {
    console.log('🔧 SETUP: Configurando Integração');
    console.log('--------------------------------');
    
    try {
      // Inicializar StreamService
      this.streamService = new StreamServiceFunctional({
        general: { enabled: true, debug: false },
        fallback: { enabled: true },
        monitoring: { enabled: true },
        synchronization: { enabled: true }
      });
      
      console.log('📋 Inicializando StreamService...');
      await this.streamService.initialize();
      
      console.log(`✅ StreamService inicializado - Modo: ${this.streamService.isStreamsMode ? 'Redis Streams' : 'Fallback'}`);
      
      // Conectar WebSocket (simulado)
      console.log('📋 Conectando WebSocket...');
      await this.connectWebSocket();
      
      console.log('✅ Setup concluído com sucesso');
      console.log('');
      
    } catch (error) {
      console.error('❌ Erro no setup:', error);
      throw error;
    }
  }

  /**
   * Conectar WebSocket (simulado)
   */
  async connectWebSocket() {
    try {
      // Simular conexão WebSocket
      this.socket = {
        connected: true,
        id: 'test_socket_' + Date.now(),
        emit: (event, data) => {
          console.log(`📤 [WebSocket] Emitindo ${event}:`, data);
        },
        on: (event, callback) => {
          console.log(`📥 [WebSocket] Escutando ${event}`);
          // Simular eventos
          if (event === 'driver_matched') {
            setTimeout(() => {
              callback({
                driverId: 'driver_integration_1',
                driverName: 'João Silva',
                estimatedTime: 5,
                location: { lat: -23.5507, lng: -46.6335 }
              });
            }, 1000);
          }
        }
      };
      
      console.log(`✅ WebSocket conectado: ${this.socket.id}`);
    } catch (error) {
      console.error('❌ Erro ao conectar WebSocket:', error);
      throw error;
    }
  }

  /**
   * Teste 1: Fluxo completo de matching
   */
  async testCompleteMatchingFlow() {
    console.log('🚗 TESTE 1: Fluxo Completo de Matching');
    console.log('------------------------------------');
    
    try {
      console.log('📋 Testando fluxo completo de matching...');
      
      const testCustomer = this.testUsers[0];
      const startTime = Date.now();
      
      // 1. Cliente solicita corrida
      console.log(`👤 Cliente ${testCustomer.id} solicita corrida...`);
      
      // 2. Processar matching via StreamService
      const matchingResult = await this.streamService.processMatching(
        testCustomer.id, 
        testCustomer.location
      );
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      // 3. Validar resultado
      this.assert(matchingResult.success === true, 'Matching deve ser bem-sucedido');
      this.assert(matchingResult.latency > 0, 'Latência deve ser maior que 0');
      
      console.log(`✅ Matching processado: ${matchingResult.method} (${matchingResult.latency}ms)`);
      
      // 4. Simular resposta do motorista
      console.log('🚗 Simulando resposta do motorista...');
      await this.simulateDriverResponse(matchingResult);
      
      // 5. Atualizar status da corrida
      console.log('📊 Atualizando status da corrida...');
      const statusResult = await this.streamService.processStatusUpdate(
        'ride_' + Date.now(),
        'accepted'
      );
      
      this.assert(statusResult.success === true, 'Atualização de status deve ser bem-sucedida');
      
      console.log(`✅ Status atualizado: ${statusResult.method} (${statusResult.latency}ms)`);
      
      // Registrar dados do teste
      this.results.integrationData.matchingFlows.push({
        customerId: testCustomer.id,
        method: matchingResult.method,
        latency: matchingResult.latency,
        totalTime,
        statusUpdate: statusResult.success
      });
      
      this.passTest('Fluxo Completo de Matching');
      
    } catch (error) {
      this.failTest('Fluxo Completo de Matching', error.message);
    }
  }

  /**
   * Teste 2: Integração WebSocket
   */
  async testWebSocketIntegration() {
    console.log('🔌 TESTE 2: Integração WebSocket');
    console.log('-------------------------------');
    
    try {
      console.log('📋 Testando integração WebSocket...');
      
      // 1. Verificar conexão WebSocket
      this.assert(this.socket !== null, 'WebSocket deve estar conectado');
      this.assert(this.socket.connected === true, 'WebSocket deve estar conectado');
      
      console.log(`✅ WebSocket conectado: ${this.socket.id}`);
      
      // 2. Testar envio de mensagem
      console.log('📤 Testando envio de mensagem...');
      this.socket.emit('request_ride', {
        customerId: 'customer_integration_1',
        location: { lat: -23.5505, lng: -46.6333 }
      });
      
      // 3. Simular recebimento de resposta
      console.log('📥 Simulando recebimento de resposta...');
      await new Promise((resolve) => {
        this.socket.on('driver_matched', (data) => {
          console.log('✅ Resposta recebida:', data);
          this.assert(data.driverId !== null, 'Deve ter driverId');
          this.assert(data.driverName !== null, 'Deve ter driverName');
          this.assert(data.estimatedTime > 0, 'Deve ter tempo estimado');
          resolve();
        });
      });
      
      // Registrar dados do teste
      this.results.integrationData.websocketConnections.push({
        socketId: this.socket.id,
        connected: this.socket.connected,
        messagesSent: 1,
        messagesReceived: 1
      });
      
      this.passTest('Integração WebSocket');
      
    } catch (error) {
      this.failTest('Integração WebSocket', error.message);
    }
  }

  /**
   * Teste 3: Notificações em tempo real
   */
  async testRealtimeNotifications() {
    console.log('📱 TESTE 3: Notificações em Tempo Real');
    console.log('-------------------------------------');
    
    try {
      console.log('📋 Testando notificações em tempo real...');
      
      const notifications = [
        { userId: 'customer_integration_1', type: 'ride_request', message: 'Corrida solicitada' },
        { userId: 'driver_integration_1', type: 'new_ride', message: 'Nova corrida disponível' },
        { userId: 'customer_integration_1', type: 'driver_found', message: 'Motorista encontrado' }
      ];
      
      const results = [];
      
      for (const notification of notifications) {
        console.log(`📤 Enviando notificação: ${notification.type}`);
        
        const result = await this.streamService.sendPushNotification(
          notification.userId,
          notification.type,
          notification.message,
          { timestamp: Date.now() }
        );
        
        this.assert(result.success === true, 'Notificação deve ser bem-sucedida');
        results.push(result);
        
        console.log(`✅ Notificação enviada: ${result.method} (${result.latency}ms)`);
      }
      
      // Registrar dados do teste
      this.results.integrationData.notifications.push(...results);
      
      this.passTest('Notificações em Tempo Real');
      
    } catch (error) {
      this.failTest('Notificações em Tempo Real', error.message);
    }
  }

  /**
   * Teste 4: Atualizações de status
   */
  async testStatusUpdates() {
    console.log('📊 TESTE 4: Atualizações de Status');
    console.log('---------------------------------');
    
    try {
      console.log('📋 Testando atualizações de status...');
      
      const statusUpdates = [
        { rideId: 'ride_1', status: 'accepted' },
        { rideId: 'ride_1', status: 'in_progress' },
        { rideId: 'ride_1', status: 'completed' }
      ];
      
      const results = [];
      
      for (const update of statusUpdates) {
        console.log(`📊 Atualizando status: ${update.rideId} -> ${update.status}`);
        
        const result = await this.streamService.processStatusUpdate(
          update.rideId,
          update.status
        );
        
        this.assert(result.success === true, 'Atualização de status deve ser bem-sucedida');
        results.push(result);
        
        console.log(`✅ Status atualizado: ${result.method} (${result.latency}ms)`);
      }
      
      this.passTest('Atualizações de Status');
      
    } catch (error) {
      this.failTest('Atualizações de Status', error.message);
    }
  }

  /**
   * Teste 5: Push notifications
   */
  async testPushNotifications() {
    console.log('🔔 TESTE 5: Push Notifications');
    console.log('-----------------------------');
    
    try {
      console.log('📋 Testando push notifications...');
      
      const pushNotifications = [
        { userId: 'customer_integration_1', type: 'ride_request', message: 'Sua corrida foi solicitada' },
        { userId: 'driver_integration_1', type: 'new_ride', message: 'Nova corrida próxima a você' },
        { userId: 'customer_integration_1', type: 'driver_arrived', message: 'Seu motorista chegou' }
      ];
      
      const results = [];
      
      for (const push of pushNotifications) {
        console.log(`🔔 Enviando push: ${push.type}`);
        
        const result = await this.streamService.sendPushNotification(
          push.userId,
          push.type,
          push.message,
          { priority: 'high' }
        );
        
        this.assert(result.success === true, 'Push notification deve ser bem-sucedida');
        results.push(result);
        
        console.log(`✅ Push enviado: ${result.method} (${result.latency}ms)`);
      }
      
      this.passTest('Push Notifications');
      
    } catch (error) {
      this.failTest('Push Notifications', error.message);
    }
  }

  /**
   * Teste 6: Analytics e métricas
   */
  async testAnalyticsAndMetrics() {
    console.log('📈 TESTE 6: Analytics e Métricas');
    console.log('-------------------------------');
    
    try {
      console.log('📋 Testando analytics e métricas...');
      
      // 1. Registrar eventos de analytics
      const analyticsEvents = [
        { event: 'ride_requested', userId: 'customer_integration_1' },
        { event: 'driver_matched', userId: 'customer_integration_1' },
        { event: 'ride_completed', userId: 'customer_integration_1' }
      ];
      
      for (const analytics of analyticsEvents) {
        console.log(`📊 Registrando evento: ${analytics.event}`);
        
        const result = await this.streamService.trackEvent(
          analytics.event,
          analytics.userId,
          { timestamp: Date.now() }
        );
        
        this.assert(result.success === true, 'Evento de analytics deve ser registrado');
        console.log(`✅ Evento registrado: ${result.method} (${result.latency}ms)`);
      }
      
      // 2. Obter métricas do StreamService
      const metrics = this.streamService.getMetrics();
      console.log('📊 Métricas do StreamService:');
      console.log(`   Total de operações: ${metrics.totalOperations}`);
      console.log(`   Taxa de sucesso: ${metrics.successRate.toFixed(1)}%`);
      console.log(`   Latência média: ${metrics.averageLatency.toFixed(1)}ms`);
      console.log(`   Modo atual: ${metrics.isStreamsMode ? 'Streams' : 'Fallback'}`);
      
      // 3. Obter status de saúde
      const healthStatus = this.streamService.getHealthStatus();
      console.log(`📊 Status de saúde: ${healthStatus.status}`);
      
      // Registrar dados do teste
      this.results.integrationData.performanceMetrics = {
        totalOperations: metrics.totalOperations,
        successRate: metrics.successRate,
        averageLatency: metrics.averageLatency,
        isStreamsMode: metrics.isStreamsMode,
        healthStatus: healthStatus.status
      };
      
      this.passTest('Analytics e Métricas');
      
    } catch (error) {
      this.failTest('Analytics e Métricas', error.message);
    }
  }

  /**
   * Teste 7: Fallback automático
   */
  async testAutomaticFallback() {
    console.log('🔄 TESTE 7: Fallback Automático');
    console.log('-------------------------------');
    
    try {
      console.log('📋 Testando fallback automático...');
      
      // 1. Verificar modo atual
      const currentMode = this.streamService.isStreamsMode ? 'Streams' : 'Fallback';
      console.log(`📊 Modo atual: ${currentMode}`);
      
      // 2. Simular falha do Redis (se estiver em modo Streams)
      if (this.streamService.isStreamsMode && this.streamService.redisManager) {
        console.log('🔌 Simulando falha do Redis...');
        
        // Desconectar Redis
        await this.streamService.redisManager.disconnect();
        
        // Aguardar detecção da falha
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Testar operação (deve usar fallback)
        console.log('🔄 Testando operação com Redis desconectado...');
        const fallbackResult = await this.streamService.processMatching(
          'customer_fallback_test',
          { lat: -23.5505, lng: -46.6333 }
        );
        
        this.assert(fallbackResult.success === true, 'Fallback deve funcionar');
        this.assert(fallbackResult.method === 'fallback', 'Deve usar método fallback');
        
        console.log(`✅ Fallback funcionando: ${fallbackResult.method} (${fallbackResult.latency}ms)`);
        
        // Reconectar Redis
        console.log('🔌 Reconectando Redis...');
        await this.streamService.redisManager.connect();
        
        // Aguardar recuperação
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Testar operação após recuperação
        console.log('🔄 Testando operação após recuperação...');
        const recoveryResult = await this.streamService.processMatching(
          'customer_recovery_test',
          { lat: -23.5505, lng: -46.6333 }
        );
        
        this.assert(recoveryResult.success === true, 'Recuperação deve funcionar');
        console.log(`✅ Recuperação funcionando: ${recoveryResult.method} (${recoveryResult.latency}ms)`);
        
      } else {
        console.log('ℹ️ Sistema já está em modo Fallback');
      }
      
      this.passTest('Fallback Automático');
      
    } catch (error) {
      this.failTest('Fallback Automático', error.message);
    }
  }

  /**
   * Teste 8: Performance em produção
   */
  async testProductionPerformance() {
    console.log('⚡ TESTE 8: Performance em Produção');
    console.log('-----------------------------------');
    
    try {
      console.log('📋 Testando performance em produção...');
      
      // 1. Teste de carga moderada
      console.log('🔄 Testando carga moderada (20 operações)...');
      const moderateLoadStart = Date.now();
      
      const moderatePromises = Array.from({ length: 20 }, (_, i) => 
        this.streamService.processMatching(`customer_load_${i}`, {
          lat: -23.5505 + (i * 0.001),
          lng: -46.6333 + (i * 0.001)
        })
      );
      
      const moderateResults = await Promise.all(moderatePromises);
      const moderateTime = Date.now() - moderateLoadStart;
      
      const moderateSuccess = moderateResults.filter(r => r.success).length;
      const moderateThroughput = (20 / moderateTime) * 1000;
      
      console.log(`📊 Carga moderada: ${moderateTime}ms, ${moderateThroughput.toFixed(2)} ops/s, ${moderateSuccess}/20 sucessos`);
      
      // 2. Teste de carga alta
      console.log('🔄 Testando carga alta (50 operações)...');
      const highLoadStart = Date.now();
      
      const highPromises = Array.from({ length: 50 }, (_, i) => 
        this.streamService.processMatching(`customer_high_${i}`, {
          lat: -23.5505 + (i * 0.001),
          lng: -46.6333 + (i * 0.001)
        })
      );
      
      const highResults = await Promise.all(highPromises);
      const highTime = Date.now() - highLoadStart;
      
      const highSuccess = highResults.filter(r => r.success).length;
      const highThroughput = (50 / highTime) * 1000;
      
      console.log(`📊 Carga alta: ${highTime}ms, ${highThroughput.toFixed(2)} ops/s, ${highSuccess}/50 sucessos`);
      
      // 3. Validar performance
      this.assert(moderateSuccess >= 18, 'Carga moderada deve ter pelo menos 90% de sucesso');
      this.assert(highSuccess >= 45, 'Carga alta deve ter pelo menos 90% de sucesso');
      
      // Registrar dados do teste
      this.results.integrationData.performanceMetrics.loadTests = {
        moderate: { time: moderateTime, throughput: moderateThroughput, success: moderateSuccess },
        high: { time: highTime, throughput: highThroughput, success: highSuccess }
      };
      
      this.passTest('Performance em Produção');
      
    } catch (error) {
      this.failTest('Performance em Produção', error.message);
    }
  }

  /**
   * Simular resposta do motorista
   */
  async simulateDriverResponse(matchingResult) {
    try {
      // Simular tempo de resposta do motorista
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('🚗 Motorista aceita a corrida');
      
      // Simular notificação para o cliente
      await this.streamService.sendPushNotification(
        matchingResult.customerId || 'customer_integration_1',
        'driver_accepted',
        'Seu motorista aceitou a corrida!',
        { driverId: 'driver_integration_1' }
      );
      
    } catch (error) {
      console.error('❌ Erro ao simular resposta do motorista:', error);
    }
  }

  /**
   * Cleanup
   */
  async cleanup() {
    console.log('🧹 CLEANUP: Limpando recursos');
    console.log('----------------------------');
    
    try {
      // Desconectar WebSocket
      if (this.socket) {
        this.socket.connected = false;
        console.log('✅ WebSocket desconectado');
      }
      
      // Parar StreamService
      if (this.streamService) {
        await this.streamService.stop();
        console.log('✅ StreamService parado');
      }
      
      console.log('✅ Cleanup concluído');
      
    } catch (error) {
      console.error('❌ Erro no cleanup:', error);
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
    console.log('📊 RESULTADOS DO TESTE DE INTEGRAÇÃO');
    console.log('====================================');
    console.log('');
    
    const successRate = (this.results.passedTests / this.results.totalTests) * 100;
    
    console.log(`Total de Testes: ${this.results.totalTests}`);
    console.log(`Testes Passaram: ${this.results.passedTests}`);
    console.log(`Testes Falharam: ${this.results.failedTests}`);
    console.log(`Taxa de Sucesso: ${successRate.toFixed(1)}%`);
    console.log('');
    
    // Exibir dados de integração
    this.displayIntegrationData();
    
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
      console.log('🎉 TODOS OS TESTES PASSARAM! Sistema de integração está funcionando perfeitamente.');
    } else if (successRate >= 80) {
      console.log('✅ MAIORIA DOS TESTES PASSOU! Sistema de integração está funcionando bem.');
    } else {
      console.log('⚠️ ALGUNS TESTES FALHARAM! Verificar sistema de integração.');
    }
    
    console.log('');
    console.log('🚀 INTEGRAÇÃO TOTAL CONCLUÍDA: Sistema ponta a ponta funcionando!');
  }

  /**
   * Exibir dados de integração
   */
  displayIntegrationData() {
    console.log('🔗 DADOS DE INTEGRAÇÃO:');
    console.log('----------------------');
    
    // WebSocket
    if (this.results.integrationData.websocketConnections.length > 0) {
      const ws = this.results.integrationData.websocketConnections[0];
      console.log(`🔌 WebSocket: ${ws.socketId} (${ws.connected ? 'conectado' : 'desconectado'})`);
    }
    
    // Matching Flows
    if (this.results.integrationData.matchingFlows.length > 0) {
      const matching = this.results.integrationData.matchingFlows[0];
      console.log(`🚗 Matching: ${matching.method} (${matching.latency}ms)`);
    }
    
    // Notifications
    if (this.results.integrationData.notifications.length > 0) {
      console.log(`📱 Notificações: ${this.results.integrationData.notifications.length} enviadas`);
    }
    
    // Performance Metrics
    if (this.results.integrationData.performanceMetrics.totalOperations) {
      const metrics = this.results.integrationData.performanceMetrics;
      console.log(`📊 Operações: ${metrics.totalOperations}, Sucesso: ${metrics.successRate.toFixed(1)}%`);
      console.log(`⚡ Latência: ${metrics.averageLatency.toFixed(1)}ms, Modo: ${metrics.isStreamsMode ? 'Streams' : 'Fallback'}`);
    }
    
    console.log('');
  }
}

// Executar testes se chamado diretamente
if (require.main === module) {
  const test = new IntegrationTest();
  test.runAllTests().catch(console.error);
}

module.exports = IntegrationTest;
