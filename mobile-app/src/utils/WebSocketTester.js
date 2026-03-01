import Logger from './Logger';
import webSocketManager from '../services/WebSocketManager'; import WebSocketConfig from '../config/WebSocketConfig';
import { testServerConnection, discoverLocalIP } from './NetworkUtils';


class WebSocketTester {
  constructor() {
    this.testResults = [];
    this.isRunning = false;
  }

  // Executar todos os testes
  async runAllTests() {
    if (this.isRunning) {
      Logger.log('Teste já está em execução');
      return;
    }

    this.isRunning = true;
    this.testResults = [];

    Logger.log('🧪 Iniciando testes do WebSocket...');

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
      Logger.error('❌ Erro durante os testes:', error);
      this.addTestResult('ERRO_GERAL', false, error.message);
    } finally {
      this.isRunning = false;
      this.printResults();
    }
  }

  // Teste 1: Validar configuração
  async testConfiguration() {
    Logger.log('📋 Testando configuração...');

    const config = WebSocketConfig.validateConfig();

    if (!config.isValid) {
      config.issues.forEach(issue => {
        Logger.warn(issue);
      });
    }

    this.addTestResult('CONFIGURACAO', config.isValid, config.issues.join(', ') || 'OK');
  }

  // Teste 2: Testar conectividade HTTP
  async testHttpConnectivity() {
    Logger.log('🌐 Testando conectividade HTTP...');

    const url = WebSocketConfig.getWebSocketURL();
    const isConnected = await testServerConnection(url, 5000);

    this.addTestResult('HTTP_CONNECTIVITY', isConnected, isConnected ? 'Conectado' : 'Falha na conexão');
  }

  // Teste 3: Testar conexão WebSocket
  async testWebSocketConnection() {
    Logger.log('🔌 Testando conexão WebSocket...');

    try {
      await webSocketManager.connect();

      // Aguardar um pouco para a conexão se estabelecer
      await new Promise(resolve => setTimeout(resolve, 2000));

      const isConnected = webSocketManager.isConnected();
      this.addTestResult('WEBSOCKET_CONNECTION', isConnected, isConnected ? 'Conectado' : 'Falha na conexão');

    } catch (error) {
      this.addTestResult('WEBSOCKET_CONNECTION', false, error.message);
    }
  }

  // Teste 4: Testar autenticação
  async testAuthentication() {
    Logger.log('🔐 Testando autenticação...');

    if (!webSocketManager.isConnected()) {
      this.addTestResult('AUTHENTICATION', false, 'WebSocket não conectado');
      return;
    }

    const success = webSocketManager.authenticate('test-user', 'driver');

    // Aguardar autenticação
    await new Promise(resolve => setTimeout(resolve, 1000));

    const isAuthenticated = success !== false;
    this.addTestResult('AUTHENTICATION', isAuthenticated, isAuthenticated ? 'Autenticado' : 'Falha na autenticação');
  }

  // Teste 5: Testar envio de localização
  async testLocationUpdate() {
    Logger.log('📍 Testando envio de localização...');

    const success = webSocketManager.updateDriverLocation('test-user', -23.5505, -46.6333);
    this.addTestResult('LOCATION_UPDATE', success, success ? 'Enviado' : 'Falha no envio');
  }

  // Teste 6: Testar busca de motoristas
  async testDriverSearch() {
    Logger.log('🚗 Testando busca de motoristas...');

    if (!webSocketManager.isConnected()) {
      this.addTestResult('DRIVER_SEARCH', false, 'WebSocket não conectado');
      return;
    }

    const success = webSocketManager.emitToServer('findNearbyDrivers', { lat: -23.5505, lng: -46.6333, radius: 5000, limit: 5 });
    this.addTestResult('DRIVER_SEARCH', success, success ? 'Busca iniciada' : 'Falha na busca');
  }

  // Teste 7: Testar ping
  async testPing() {
    Logger.log('🏓 Testando ping...');

    if (!webSocketManager.isConnected()) {
      this.addTestResult('PING', false, 'WebSocket não conectado');
      return;
    }

    const success = webSocketManager.emitToServer('ping', { test: true });
    this.addTestResult('PING', success, success ? 'Ping enviado' : 'Falha no ping');
  }

  // Teste 8: Testar desconexão
  async testDisconnection() {
    Logger.log('🔌 Testando desconexão...');

    webSocketManager.disconnect();

    // Aguardar desconexão
    await new Promise(resolve => setTimeout(resolve, 1000));

    const isDisconnected = !webSocketManager.isConnected();
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
    Logger.log('\n📊 RESULTADOS DOS TESTES:');
    Logger.log('='.repeat(50));

    let passed = 0;
    let failed = 0;

    this.testResults.forEach(result => {
      const status = result.success ? '✅' : '❌';
      const statusText = result.success ? 'PASSOU' : 'FALHOU';

      Logger.log(`${status} ${result.test}: ${statusText}`);
      Logger.log(`   ${result.message}`);
      Logger.log('');

      if (result.success) {
        passed++;
      } else {
        failed++;
      }
    });

    Logger.log('='.repeat(50));
    Logger.log(`📈 Total: ${this.testResults.length} | ✅ Passou: ${passed} | ❌ Falhou: ${failed}`);

    if (failed === 0) {
      Logger.log('🎉 Todos os testes passaram! WebSocket está funcionando corretamente.');
    } else {
      Logger.log('⚠️ Alguns testes falharam. Verifique a configuração.');
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
    Logger.log('🔍 Descobrindo IP automaticamente...');

    const ip = await discoverLocalIP(3001);

    if (ip) {
      Logger.log(`✅ IP descoberto: ${ip}`);
      Logger.log(`📝 Atualize WebSocketConfig.js com: http://${ip}:3001`);
    } else {
      Logger.log('❌ Não foi possível descobrir o IP automaticamente');
      Logger.log('📝 Configure manualmente o IP em WebSocketConfig.js');
    }

    return ip;
  }

  // Teste rápido de conectividade
  async quickTest() {
    Logger.log('⚡ Teste rápido de conectividade...');

    const url = WebSocketConfig.getWebSocketURL();
    const isConnected = await testServerConnection(url, 3000);

    if (isConnected) {
      Logger.log('✅ Backend acessível');
      return true;
    } else {
      Logger.log('❌ Backend não acessível');
      Logger.log('💡 Verifique se o backend está rodando na porta 3001');
      return false;
    }
  }
}

// Instância singleton
const webSocketTester = new WebSocketTester();

export default webSocketTester; 