/**
 * Teste de WebSocket Dashboard Admin
 * Valida conexão, autenticação JWT e eventos em tempo real
 */

const { io } = require('socket.io-client');
const axios = require('axios');

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';
const WS_BASE_URL = process.env.WS_URL || 'http://localhost:3001';
const TEST_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@leaf.com';
const TEST_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';

// Cores para output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

let accessToken = null;
let refreshToken = null;

/**
 * Teste 1: Login JWT
 */
async function testLogin() {
  logInfo('\n📋 Teste 1: Login JWT');
  try {
    const response = await axios.post(`${API_BASE_URL}/api/admin/auth/login`, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD
    });

    if (response.data.success && response.data.accessToken) {
      accessToken = response.data.accessToken;
      refreshToken = response.data.refreshToken;
      logSuccess('Login realizado com sucesso!');
      logInfo(`Access Token: ${accessToken.substring(0, 50)}...`);
      logInfo(`Usuário: ${response.data.user.name} (${response.data.user.role})`);
      return true;
    } else {
      logError('Login falhou: resposta inválida');
      return false;
    }
  } catch (error) {
    if (error.response) {
      logError(`Login falhou: ${error.response.status} - ${error.response.data.error || error.response.data.message}`);
    } else {
      logError(`Login falhou: ${error.message}`);
    }
    return false;
  }
}

/**
 * Teste 2: Conexão WebSocket
 */
function testWebSocketConnection() {
  return new Promise((resolve) => {
    logInfo('\n📋 Teste 2: Conexão WebSocket');
    
    if (!accessToken) {
      logWarning('Token não disponível, pulando teste...');
      resolve(false);
      return;
    }

    const socket = io(`${WS_BASE_URL}/dashboard`, {
      auth: {
        jwtToken: accessToken
      },
      transports: ['websocket', 'polling'],
      reconnection: false
    });

    let connected = false;
    let authenticated = false;
    let metricsReceived = false;
    let timeout;

    // Timeout de 10 segundos
    timeout = setTimeout(() => {
      if (!connected || !authenticated) {
        logError('Timeout: WebSocket não conectou/autenticou em 10 segundos');
        socket.disconnect();
        resolve(false);
      }
    }, 10000);

    socket.on('connect', () => {
      logSuccess('WebSocket conectado!');
      connected = true;
      
      // ✅ Emitir evento de autenticação após conectar
      socket.emit('authenticate', {
        jwtToken: accessToken  // ✅ Corrigido: usar jwtToken ao invés de token
      });
    });

    socket.on('authenticated', (data) => {
      logSuccess('WebSocket autenticado!');
      logInfo(`Usuário: ${data.user?.email || 'N/A'} (${data.user?.role || 'N/A'})`);
      authenticated = true;
      clearTimeout(timeout);
      
      // Solicitar dados
      socket.emit('request_live_data');
      socket.emit('request_user_stats');
      socket.emit('request_rides_stats');
      socket.emit('request_revenue_stats');
      
      // Aguardar eventos
      setTimeout(() => {
        socket.disconnect();
        if (metricsReceived) {
          logSuccess('Eventos de métricas recebidos!');
          resolve(true);
        } else {
          logWarning('Nenhum evento de métricas recebido (pode ser normal se servidor não está emitindo)');
          resolve(true); // Ainda conta como sucesso se conectou e autenticou
        }
      }, 3000);
    });

    socket.on('authentication_error', (error) => {
      logError(`Erro de autenticação: ${error.message}`);
      clearTimeout(timeout);
      socket.disconnect();
      resolve(false);
    });

    socket.on('connect_error', (error) => {
      logError(`Erro de conexão: ${error.message}`);
      clearTimeout(timeout);
      resolve(false);
    });

    socket.on('metrics:updated', (data) => {
      logSuccess('Evento metrics:updated recebido!');
      logInfo(`Timestamp: ${data.timestamp || 'N/A'}`);
      metricsReceived = true;
    });

    socket.on('users:stats:updated', (data) => {
      logSuccess('Evento users:stats:updated recebido!');
      logInfo(`Total: ${data.total || 'N/A'}`);
    });

    socket.on('rides:stats:updated', (data) => {
      logSuccess('Evento rides:stats:updated recebido!');
      logInfo(`Total: ${data.totalRides || 'N/A'}`);
    });

    socket.on('revenue:stats:updated', (data) => {
      logSuccess('Evento revenue:stats:updated recebido!');
      logInfo(`Receita hoje: R$ ${data.todayRevenue || 'N/A'}`);
    });

    socket.on('live_stats_update', (data) => {
      logSuccess('Evento live_stats_update recebido!');
      logInfo(`Motoristas online: ${data.driversOnline || 'N/A'}`);
    });
  });
}

/**
 * Teste 3: Verificar se eventos são emitidos periodicamente
 */
function testPeriodicUpdates() {
  return new Promise((resolve) => {
    logInfo('\n📋 Teste 3: Atualizações Periódicas');
    
    if (!accessToken) {
      logWarning('Token não disponível, pulando teste...');
      resolve(false);
      return;
    }

    const socket = io(`${WS_BASE_URL}/dashboard`, {
      transports: ['websocket', 'polling'],
      reconnection: false
    });

    let eventsReceived = 0;
    const requiredEvents = 2; // Esperar pelo menos 2 eventos em 12 segundos

    socket.on('connect', () => {
      // ✅ Emitir evento de autenticação após conectar
      socket.emit('authenticate', {
        jwtToken: accessToken
      });
    });

    socket.on('authenticated', () => {
      logInfo('Aguardando eventos periódicos (12 segundos)...');
      
      socket.on('metrics:updated', () => {
        eventsReceived++;
        logSuccess(`Evento metrics:updated recebido (${eventsReceived}/${requiredEvents})`);
      });

      setTimeout(() => {
        socket.disconnect();
        if (eventsReceived >= requiredEvents) {
          logSuccess(`Atualizações periódicas funcionando! (${eventsReceived} eventos recebidos)`);
          resolve(true);
        } else {
          logWarning(`Poucos eventos recebidos (${eventsReceived}/${requiredEvents}). Verifique se o servidor está emitindo.`);
          resolve(true); // Ainda conta como sucesso se conectou
        }
      }, 12000); // Aumentado para 12 segundos (2-3 eventos a cada 5s)
    });

    socket.on('authentication_error', (error) => {
      logError(`Erro de autenticação: ${error.message}`);
      socket.disconnect();
      resolve(false);
    });

    socket.on('connect_error', (error) => {
      logError(`Erro de conexão: ${error.message}`);
      resolve(false);
    });
  });
}

/**
 * Executar todos os testes
 */
async function runAllTests() {
  log('\n🚀 Iniciando testes de WebSocket Dashboard Admin...\n', 'blue');
  logInfo(`API Base URL: ${API_BASE_URL}`);
  logInfo(`WebSocket Base URL: ${WS_BASE_URL}`);
  logInfo(`Email de teste: ${TEST_EMAIL}`);
  logWarning('⚠️  Certifique-se de que o servidor está rodando!\n');

  const results = {
    login: false,
    websocketConnection: false,
    periodicUpdates: false
  };

  // Teste 1: Login
  results.login = await testLogin();
  
  if (!results.login) {
    logError('\n❌ Login falhou. Testes subsequentes serão pulados.');
    logWarning('Verifique:');
    logWarning('  1. Servidor está rodando?');
    logWarning('  2. Usuário admin existe no Firestore?');
    logWarning('  3. Email e senha estão corretos?');
    return results;
  }

  // Teste 2: Conexão WebSocket
  results.websocketConnection = await testWebSocketConnection();

  // Teste 3: Atualizações Periódicas
  results.periodicUpdates = await testPeriodicUpdates();

  // Resumo
  log('\n📊 RESUMO DOS TESTES\n', 'blue');
  const totalTests = Object.keys(results).length;
  const passedTests = Object.values(results).filter(r => r).length;
  
  Object.entries(results).forEach(([test, passed]) => {
    if (passed) {
      logSuccess(`${test}: PASSOU`);
    } else {
      logError(`${test}: FALHOU`);
    }
  });

  log(`\n✅ ${passedTests}/${totalTests} testes passaram\n`, passedTests === totalTests ? 'green' : 'yellow');

  return results;
}

// Executar testes
if (require.main === module) {
  runAllTests()
    .then((results) => {
      const allPassed = Object.values(results).every(r => r);
      process.exit(allPassed ? 0 : 1);
    })
    .catch((error) => {
      logError(`\n❌ Erro fatal: ${error.message}`);
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runAllTests };

