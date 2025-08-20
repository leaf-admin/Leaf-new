const fetch = require('node-fetch');
const Redis = require('ioredis');

// Configuração
const BASE_URL = 'http://localhost:3001';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Cliente Redis para verificações
const redis = new Redis(REDIS_URL);

// Cores para console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
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
  log(`ℹ️ ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️ ${message}`, 'yellow');
}

// Funções de teste
async function testHealthEndpoint() {
  logInfo('\n🔍 Testando endpoint /health...');
  
  try {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();
    
    if (response.ok && data.status === 'healthy') {
      logSuccess('Health check funcionando');
      return true;
    } else {
      logError(`Health check falhou: ${JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    logError(`Erro no health check: ${error.message}`);
    return false;
  }
}

async function testMetricsEndpoint() {
  logInfo('\n📊 Testando endpoint /metrics...');
  
  try {
    const response = await fetch(`${BASE_URL}/metrics`);
    const data = await response.json();
    
    if (response.ok && data.timestamp) {
      logSuccess('Métricas gerais funcionando');
      
      // Verificar estrutura das métricas
      const requiredFields = ['userStats', 'financialStats', 'performanceStats', 'approvalStats', 'system'];
      const missingFields = requiredFields.filter(field => !data[field]);
      
      if (missingFields.length === 0) {
        logSuccess('Estrutura das métricas está correta');
      } else {
        logWarning(`Campos faltando: ${missingFields.join(', ')}`);
      }
      
      return true;
    } else {
      logError(`Métricas falharam: ${JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    logError(`Erro nas métricas: ${error.message}`);
    return false;
  }
}

async function testUserStatsEndpoint() {
  logInfo('\n👥 Testando endpoint /stats/users...');
  
  try {
    const response = await fetch(`${BASE_URL}/stats/users`);
    const data = await response.json();
    
    if (response.ok && data.stats) {
      logSuccess('Estatísticas de usuários funcionando');
      
      // Verificar estrutura
      const requiredFields = ['totalUsers', 'totalCustomers', 'totalDrivers', 'onlineUsers'];
      const missingFields = requiredFields.filter(field => !(field in data.stats));
      
      if (missingFields.length === 0) {
        logSuccess('Estrutura das estatísticas de usuários está correta');
      } else {
        logWarning(`Campos faltando: ${missingFields.join(', ')}`);
      }
      
      return true;
    } else {
      logError(`Estatísticas de usuários falharam: ${JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    logError(`Erro nas estatísticas de usuários: ${error.message}`);
    return false;
  }
}

async function testFinancialStatsEndpoint() {
  logInfo('\n💰 Testando endpoint /stats/financial...');
  
  try {
    const response = await fetch(`${BASE_URL}/stats/financial`);
    const data = await response.json();
    
    if (response.ok && data.financial) {
      logSuccess('Estatísticas financeiras funcionando');
      
      // Verificar estrutura
      const requiredFields = ['totalRevenue', 'totalTrips', 'profitMargin'];
      const missingFields = requiredFields.filter(field => !(field in data.financial));
      
      if (missingFields.length === 0) {
        logSuccess('Estrutura das estatísticas financeiras está correta');
      } else {
        logWarning(`Campos faltando: ${missingFields.join(', ')}`);
      }
      
      return true;
    } else {
      logError(`Estatísticas financeiras falharam: ${JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    logError(`Erro nas estatísticas financeiras: ${error.message}`);
    return false;
  }
}

async function testRealTimeMetricsEndpoint() {
  logInfo('\n⚡ Testando endpoint /metrics/realtime...');
  
  try {
    const response = await fetch(`${BASE_URL}/metrics/realtime`);
    const data = await response.json();
    
    if (response.ok && data.timestamp) {
      logSuccess('Métricas em tempo real funcionando');
      
      // Verificar estrutura
      const requiredFields = ['activeUsers', 'activeTrips', 'systemLoad'];
      const missingFields = requiredFields.filter(field => !data[field]);
      
      if (missingFields.length === 0) {
        logSuccess('Estrutura das métricas em tempo real está correta');
      } else {
        logWarning(`Campos faltando: ${missingFields.join(', ')}`);
      }
      
      return true;
    } else {
      logError(`Métricas em tempo real falharam: ${JSON.stringify(data)}`);
      return false;
    }
  } catch (error) {
    logError(`Erro nas métricas em tempo real: ${error.message}`);
    return false;
  }
}

async function testDriverApprovalEndpoints() {
  logInfo('\n🚗 Testando endpoints de aprovação de motoristas...');
  
  try {
    // Testar busca de aprovações
    const approvalsResponse = await fetch(`${BASE_URL}/driver-approvals?status=pending&page=0&limit=10`);
    const approvalsData = await approvalsResponse.json();
    
    if (approvalsResponse.ok && approvalsData.result) {
      logSuccess('Busca de aprovações funcionando');
    } else {
      logWarning(`Busca de aprovações retornou: ${JSON.stringify(approvalsData)}`);
    }
    
    // Testar estatísticas de aprovação
    const statsResponse = await fetch(`${BASE_URL}/driver-approval-stats`);
    const statsData = await statsResponse.json();
    
    if (statsResponse.ok && statsData.stats) {
      logSuccess('Estatísticas de aprovação funcionando');
    } else {
      logWarning(`Estatísticas de aprovação retornaram: ${JSON.stringify(statsData)}`);
    }
    
    return true;
  } catch (error) {
    logError(`Erro nos endpoints de aprovação: ${error.message}`);
    return false;
  }
}

async function testRedisConnection() {
  logInfo('\n🔗 Testando conexão com Redis...');
  
  try {
    await redis.ping();
    logSuccess('Conexão com Redis funcionando');
    
    // Verificar chaves de métricas
    const metricKeys = await redis.keys('metrics:*');
    logInfo(`Chaves de métricas encontradas: ${metricKeys.length}`);
    
    if (metricKeys.length > 0) {
      logSuccess('Cache de métricas está funcionando');
    } else {
      logWarning('Nenhuma chave de métricas encontrada (pode ser normal no início)');
    }
    
    return true;
  } catch (error) {
    logError(`Erro na conexão com Redis: ${error.message}`);
    return false;
  }
}

async function testPerformance() {
  logInfo('\n⚡ Testando performance dos endpoints...');
  
  const endpoints = [
    '/health',
    '/metrics',
    '/stats/users',
    '/stats/financial',
    '/metrics/realtime'
  ];
  
  const results = {};
  
  for (const endpoint of endpoints) {
    try {
      const startTime = Date.now();
      const response = await fetch(`${BASE_URL}${endpoint}`);
      const endTime = Date.now();
      
      const duration = endTime - startTime;
      results[endpoint] = {
        success: response.ok,
        duration,
        status: response.status
      };
      
      if (response.ok) {
        logSuccess(`${endpoint}: ${duration}ms`);
      } else {
        logWarning(`${endpoint}: ${duration}ms (status: ${response.status})`);
      }
    } catch (error) {
      logError(`${endpoint}: Erro - ${error.message}`);
      results[endpoint] = { success: false, error: error.message };
    }
  }
  
  return results;
}

async function testDataConsistency() {
  logInfo('\n🔍 Testando consistência dos dados...');
  
  try {
    // Buscar métricas gerais
    const generalResponse = await fetch(`${BASE_URL}/metrics`);
    const generalData = await generalResponse.json();
    
    // Buscar estatísticas específicas
    const usersResponse = await fetch(`${BASE_URL}/stats/users`);
    const usersData = await usersResponse.json();
    
    const financialResponse = await fetch(`${BASE_URL}/stats/financial`);
    const financialData = await financialResponse.json();
    
    // Verificar consistência
    let consistencyIssues = [];
    
    if (generalData.userStats.totalUsers !== usersData.stats.totalUsers) {
      consistencyIssues.push('Total de usuários inconsistente');
    }
    
    if (generalData.financialStats.totalRevenue !== financialData.financial.totalRevenue) {
      consistencyIssues.push('Receita total inconsistente');
    }
    
    if (consistencyIssues.length === 0) {
      logSuccess('Dados consistentes entre endpoints');
      return true;
    } else {
      logWarning(`Problemas de consistência: ${consistencyIssues.join(', ')}`);
      return false;
    }
  } catch (error) {
    logError(`Erro ao testar consistência: ${error.message}`);
    return false;
  }
}

// Função principal de teste
async function runAllTests() {
  log('\n🚀 INICIANDO TESTES COMPLETOS DO SISTEMA DE MÉTRICAS', 'bright');
  log('=' .repeat(60), 'cyan');
  
  const startTime = Date.now();
  const results = {};
  
  try {
    // Testes básicos
    results.health = await testHealthEndpoint();
    results.redis = await testRedisConnection();
    
    // Testes de métricas
    results.metrics = await testMetricsEndpoint();
    results.userStats = await testUserStatsEndpoint();
    results.financialStats = await testFinancialStatsEndpoint();
    results.realTime = await testRealTimeMetricsEndpoint();
    
    // Testes de aprovação
    results.driverApproval = await testDriverApprovalEndpoints();
    
    // Testes de performance
    results.performance = await testPerformance();
    
    // Testes de consistência
    results.consistency = await testDataConsistency();
    
  } catch (error) {
    logError(`Erro durante os testes: ${error.message}`);
  }
  
  const endTime = Date.now();
  const totalDuration = endTime - startTime;
  
  // Resumo dos resultados
  log('\n📊 RESUMO DOS TESTES', 'bright');
  log('=' .repeat(40), 'cyan');
  
  const testNames = {
    health: 'Health Check',
    redis: 'Conexão Redis',
    metrics: 'Métricas Gerais',
    userStats: 'Estatísticas de Usuários',
    financialStats: 'Estatísticas Financeiras',
    realTime: 'Métricas Tempo Real',
    driverApproval: 'Aprovação de Motoristas',
    performance: 'Performance',
    consistency: 'Consistência de Dados'
  };
  
  let passedTests = 0;
  let totalTests = 0;
  
  for (const [testKey, testName] of Object.entries(testNames)) {
    const result = results[testKey];
    totalTests++;
    
    if (result === true || (result && result.success !== false)) {
      logSuccess(`${testName}: PASSOU`);
      passedTests++;
    } else {
      logError(`${testName}: FALHOU`);
    }
  }
  
  log('\n' + '=' .repeat(40), 'cyan');
  log(`🎯 RESULTADO: ${passedTests}/${totalTests} testes passaram`, passedTests === totalTests ? 'green' : 'yellow');
  log(`⏱️ Tempo total: ${totalDuration}ms`, 'blue');
  
  if (passedTests === totalTests) {
    log('\n🎉 SISTEMA DE MÉTRICAS FUNCIONANDO PERFEITAMENTE!', 'bright');
  } else {
    log('\n⚠️ ALGUNS TESTES FALHARAM - VERIFICAR IMPLEMENTAÇÃO', 'yellow');
  }
  
  return results;
}

// Executar testes se chamado diretamente
if (require.main === module) {
  runAllTests()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logError(`Erro fatal: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  runAllTests,
  testHealthEndpoint,
  testMetricsEndpoint,
  testUserStatsEndpoint,
  testFinancialStatsEndpoint,
  testRealTimeMetricsEndpoint,
  testDriverApprovalEndpoints,
  testRedisConnection,
  testPerformance,
  testDataConsistency
};
