import webSocketService from '../services/WebSocketService';
import WebSocketConfig from '../config/WebSocketConfig';
import { testServerConnection, discoverLocalIP } from './NetworkUtils';

class WebSocketTester {
  constructor() {
    this.testResults = [];
    this.isRunning = false;
  }

  // Executar todos os testes
  async runAllTests() {
    if (this.isRunning) {
      console.log('Teste já está em execução');
      return;
    }

    this.isRunning = true;
    this.testResults = [];

    console.log('🧪 Iniciando testes do WebSocket...');

    try {
      // Teste 1: Validar configuração
      await this.testConfiguration();

      // Teste 2: Testar conectividade HTTP
      await this.testHttpConnectivity();

      // Teste 3: Testar conexão WebSocket
      await this.testWebSocketConnection();

      // Teste 4: Testar autenticação
      await this.testAuthentication();

      // Teste 5: Testar envio de localização
      await this.testLocationUpdate();

      // Teste 6: Testar busca de motoristas
      await this.testDriverSearch();

      // Teste 7: Testar ping
      await this.testPing();

      // Teste 8: Testar desconexão
      await this.testDisconnection();

    } catch (error) {
      console.error('❌ Erro durante os testes:', error);
      this.addTestResult('ERRO_GERAL', false, error.message);
    } finally {
      this.isRunning = false;
      this.printResults();
    }
  }

  // Teste 1: Validar configuração
  async testConfiguration() {
    console.log('📋 Testando configuração...');
    
    const config = WebSocketConfig.validateConfig();
    
    if (!config.isValid) {
      config.issues.forEach(issue => {
        console.warn(issue);
      });
    }

    this.addTestResult('CONFIGURACAO', config.isValid, config.issues.join(', ') || 'OK');
  }

  // Teste 2: Testar conectividade HTTP
  async testHttpConnectivity() {
    console.log('🌐 Testando conectividade HTTP...');
    
    const url = WebSocketConfig.getWebSocketURL();
    const isConnected = await testServerConnection(url, 5000);
    
    this.addTestResult('HTTP_CONNECTIVITY', isConnected, isConnected ? 'Conectado' : 'Falha na conexão');
  }

  // Teste 3: Testar conexão WebSocket
  async testWebSocketConnection() {
    console.log('🔌 Testando conexão WebSocket...');
    
    try {
      await webSocketService.connect('test-user');
      
      // Aguardar um pouco para a conexão se estabelecer
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const isConnected = webSocketService.isSocketConnected();
      this.addTestResult('WEBSOCKET_CONNECTION', isConnected, isConnected ? 'Conectado' : 'Falha na conexão');
      
    } catch (error) {
      this.addTestResult('WEBSOCKET_CONNECTION', false, error.message);
    }
  }

  // Teste 4: Testar autenticação
  async testAuthentication() {
    console.log('🔐 Testando autenticação...');
    
    if (!webSocketService.isSocketConnected()) {
      this.addTestResult('AUTHENTICATION', false, 'WebSocket não conectado');
      return;
    }

    const success = webSocketService.authenticate('test-user');
    
    // Aguardar autenticação
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const isAuthenticated = webSocketService.isUserAuthenticated();
    this.addTestResult('AUTHENTICATION', isAuthenticated, isAuthenticated ? 'Autenticado' : 'Falha na autenticação');
  }

  // Teste 5: Testar envio de localização
  async testLocationUpdate() {
    console.log('📍 Testando envio de localização...');
    
    if (!webSocketService.isUserAuthenticated()) {
      this.addTestResult('LOCATION_UPDATE', false, 'Usuário não autenticado');
      return;
    }

    const success = webSocketService.updateLocation(-23.5505, -46.6333, 'test');
    this.addTestResult('LOCATION_UPDATE', success, success ? 'Enviado' : 'Falha no envio');
  }

  // Teste 6: Testar busca de motoristas
  async testDriverSearch() {
    console.log('🚗 Testando busca de motoristas...');
    
    if (!webSocketService.isSocketConnected()) {
      this.addTestResult('DRIVER_SEARCH', false, 'WebSocket não conectado');
      return;
    }

    const success = webSocketService.findNearbyDrivers(-23.5505, -46.6333, 5000, 5);
    this.addTestResult('DRIVER_SEARCH', success, success ? 'Busca iniciada' : 'Falha na busca');
  }

  // Teste 7: Testar ping
  async testPing() {
    console.log('🏓 Testando ping...');
    
    if (!webSocketService.isSocketConnected()) {
      this.addTestResult('PING', false, 'WebSocket não conectado');
      return;
    }

    const success = webSocketService.ping({ test: true });
    this.addTestResult('PING', success, success ? 'Ping enviado' : 'Falha no ping');
  }

  // Teste 8: Testar desconexão
  async testDisconnection() {
    console.log('🔌 Testando desconexão...');
    
    webSocketService.disconnect();
    
    // Aguardar desconexão
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const isDisconnected = !webSocketService.isSocketConnected();
    this.addTestResult('DISCONNECTION', isDisconnected, isDisconnected ? 'Desconectado' : 'Falha na desconexão');
  }

  // Adicionar resultado de teste
  addTestResult(testName, success, message) {
    this.testResults.push({
      test: testName,
      success,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  // Imprimir resultados
  printResults() {
    console.log('\n📊 RESULTADOS DOS TESTES:');
    console.log('=' .repeat(50));
    
    let passed = 0;
    let failed = 0;
    
    this.testResults.forEach(result => {
      const status = result.success ? '✅' : '❌';
      const statusText = result.success ? 'PASSOU' : 'FALHOU';
      
      console.log(`${status} ${result.test}: ${statusText}`);
      console.log(`   ${result.message}`);
      console.log('');
      
      if (result.success) {
        passed++;
      } else {
        failed++;
      }
    });
    
    console.log('=' .repeat(50));
    console.log(`📈 Total: ${this.testResults.length} | ✅ Passou: ${passed} | ❌ Falhou: ${failed}`);
    
    if (failed === 0) {
      console.log('🎉 Todos os testes passaram! WebSocket está funcionando corretamente.');
    } else {
      console.log('⚠️ Alguns testes falharam. Verifique a configuração.');
    }
  }

  // Obter resultados
  getResults() {
    return this.testResults;
  }

  // Verificar se todos os testes passaram
  allTestsPassed() {
    return this.testResults.every(result => result.success);
  }

  // Descobrir IP automaticamente
  async discoverIP() {
    console.log('🔍 Descobrindo IP automaticamente...');
    
    const ip = await discoverLocalIP(3001);
    
    if (ip) {
      console.log(`✅ IP descoberto: ${ip}`);
      console.log(`📝 Atualize WebSocketConfig.js com: http://${ip}:3001`);
    } else {
      console.log('❌ Não foi possível descobrir o IP automaticamente');
      console.log('📝 Configure manualmente o IP em WebSocketConfig');
    }
    
    return ip;
  }

  // Teste rápido de conectividade
  async quickTest() {
    console.log('⚡ Teste rápido de conectividade...');
    
    const url = WebSocketConfig.getWebSocketURL();
    const isConnected = await testServerConnection(url, 3000);
    
    if (isConnected) {
      console.log('✅ Backend acessível');
      return true;
    } else {
      console.log('❌ Backend não acessível');
      console.log('💡 Verifique se o backend está rodando na porta 3001');
      return false;
    }
  }
}

// Instância singleton
const webSocketTester = new WebSocketTester();

export default webSocketTester; 