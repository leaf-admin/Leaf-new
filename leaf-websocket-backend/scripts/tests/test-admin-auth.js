/**
 * Teste de Autenticação JWT Admin
 * Valida os endpoints de autenticação do Dashboard Admin
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';
const TEST_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@leaf.com';
const TEST_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';

let accessToken = null;
let refreshToken = null;

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

async function testLogin() {
  logInfo('\n📋 Teste 1: Login');
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
      logInfo(`Refresh Token: ${refreshToken.substring(0, 50)}...`);
      logInfo(`Usuário: ${response.data.user.name} (${response.data.user.role})`);
      logInfo(`Permissões: ${response.data.user.permissions.length} permissões`);
      return true;
    } else {
      logError('Login falhou: resposta inválida');
      console.log('Resposta:', response.data);
      return false;
    }
  } catch (error) {
    if (error.response) {
      logError(`Login falhou: ${error.response.status} - ${error.response.data.error || error.response.data.message}`);
      console.log('Detalhes:', error.response.data);
    } else {
      logError(`Login falhou: ${error.message}`);
    }
    return false;
  }
}

async function testVerifyToken() {
  logInfo('\n📋 Teste 2: Verificar Token');
  
  if (!accessToken) {
    logWarning('Token não disponível, pulando teste...');
    return false;
  }

  try {
    const response = await axios.get(`${API_BASE_URL}/api/admin/auth/verify`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (response.data.success && response.data.user) {
      logSuccess('Token verificado com sucesso!');
      logInfo(`Usuário: ${response.data.user.name} (${response.data.user.role})`);
      logInfo(`Email: ${response.data.user.email}`);
      return true;
    } else {
      logError('Verificação falhou: resposta inválida');
      console.log('Resposta:', response.data);
      return false;
    }
  } catch (error) {
    if (error.response) {
      logError(`Verificação falhou: ${error.response.status} - ${error.response.data.error || error.response.data.message}`);
    } else {
      logError(`Verificação falhou: ${error.message}`);
    }
    return false;
  }
}

async function testRefreshToken() {
  logInfo('\n📋 Teste 3: Refresh Token');
  
  if (!refreshToken) {
    logWarning('Refresh token não disponível, pulando teste...');
    return false;
  }

  try {
    const response = await axios.post(`${API_BASE_URL}/api/admin/auth/refresh`, {
      refreshToken: refreshToken
    });

    if (response.data.success && response.data.accessToken) {
      const oldToken = accessToken;
      accessToken = response.data.accessToken;
      logSuccess('Token renovado com sucesso!');
      logInfo(`Novo Access Token: ${accessToken.substring(0, 50)}...`);
      logInfo(`Token anterior: ${oldToken.substring(0, 50)}...`);
      return true;
    } else {
      logError('Refresh falhou: resposta inválida');
      console.log('Resposta:', response.data);
      return false;
    }
  } catch (error) {
    if (error.response) {
      logError(`Refresh falhou: ${error.response.status} - ${error.response.data.error || error.response.data.message}`);
    } else {
      logError(`Refresh falhou: ${error.message}`);
    }
    return false;
  }
}

async function testLogout() {
  logInfo('\n📋 Teste 4: Logout');
  
  if (!accessToken) {
    logWarning('Token não disponível, pulando teste...');
    return false;
  }

  try {
    const response = await axios.post(`${API_BASE_URL}/api/admin/auth/logout`, {}, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (response.data.success) {
      logSuccess('Logout realizado com sucesso!');
      accessToken = null;
      refreshToken = null;
      return true;
    } else {
      logError('Logout falhou: resposta inválida');
      console.log('Resposta:', response.data);
      return false;
    }
  } catch (error) {
    if (error.response) {
      logError(`Logout falhou: ${error.response.status} - ${error.response.data.error || error.response.data.message}`);
    } else {
      logError(`Logout falhou: ${error.message}`);
    }
    return false;
  }
}

async function testInvalidCredentials() {
  logInfo('\n📋 Teste 5: Credenciais Inválidas');
  
  try {
    await axios.post(`${API_BASE_URL}/api/admin/auth/login`, {
      email: 'invalid@email.com',
      password: 'wrongpassword'
    });
    
    logError('Login com credenciais inválidas deveria ter falhado!');
    return false;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      logSuccess('Credenciais inválidas rejeitadas corretamente!');
      return true;
    } else {
      logError(`Erro inesperado: ${error.message}`);
      return false;
    }
  }
}

async function testInvalidToken() {
  logInfo('\n📋 Teste 6: Token Inválido');
  
  try {
    await axios.get(`${API_BASE_URL}/api/admin/auth/verify`, {
      headers: {
        'Authorization': 'Bearer invalid-token-12345'
      }
    });
    
    logError('Token inválido deveria ter sido rejeitado!');
    return false;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      logSuccess('Token inválido rejeitado corretamente!');
      return true;
    } else {
      logError(`Erro inesperado: ${error.message}`);
      return false;
    }
  }
}

async function runAllTests() {
  log('\n🚀 Iniciando testes de autenticação JWT Admin...\n', 'blue');
  logInfo(`API Base URL: ${API_BASE_URL}`);
  logInfo(`Email de teste: ${TEST_EMAIL}`);
  logWarning('⚠️  Certifique-se de que o servidor está rodando e há um usuário admin no Firestore!\n');

  const results = {
    login: false,
    verify: false,
    refresh: false,
    logout: false,
    invalidCredentials: false,
    invalidToken: false
  };

  // Teste 1: Login
  results.login = await testLogin();
  
  if (!results.login) {
    logError('\n❌ Login falhou. Testes subsequentes serão pulados.');
    logWarning('Verifique:');
    logWarning('  1. Servidor está rodando?');
    logWarning('  2. Usuário admin existe no Firestore (collection: adminUsers)?');
    logWarning('  3. Email e senha estão corretos?');
    logWarning('  4. passwordHash está configurado no Firestore?');
    return results;
  }

  // Teste 2: Verificar Token
  results.verify = await testVerifyToken();

  // Teste 3: Refresh Token
  results.refresh = await testRefreshToken();

  // Teste 4: Logout
  results.logout = await testLogout();

  // Teste 5: Credenciais Inválidas
  results.invalidCredentials = await testInvalidCredentials();

  // Teste 6: Token Inválido
  results.invalidToken = await testInvalidToken();

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



