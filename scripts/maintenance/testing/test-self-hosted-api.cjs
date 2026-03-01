// 🧪 TESTE SELF-HOSTED API - LEAF APP
const axios = require('axios');

const BASE_URL = 'http://147.93.66.253:3000';

// 🎨 Cores para output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const log = (message, color = 'reset') => {
  console.log(`${colors[color]}${message}${colors.reset}`);
};

// 🧪 Teste 1: Health Check
async function testHealthCheck() {
  log('\n🏥 Testando Health Check...', 'blue');
  try {
    const response = await axios.get(`${BASE_URL}/api/health`);
    log('✅ Health Check OK', 'green');
    log(`📊 Status: ${response.data.status}`, 'green');
    log(`⏰ Uptime: ${response.data.uptime.toFixed(2)}s`, 'green');
    log(`🔴 Redis: ${response.data.redis}`, 'green');
    return true;
  } catch (error) {
    log('❌ Health Check FALHOU', 'red');
    log(`Erro: ${error.message}`, 'red');
    return false;
  }
}

// 🧪 Teste 2: Stats
async function testStats() {
  log('\n📊 Testando Stats...', 'blue');
  try {
    const response = await axios.get(`${BASE_URL}/api/stats`);
    log('✅ Stats OK', 'green');
    log(`🚗 Motoristas ativos: ${response.data.activeDrivers}`, 'green');
    log(`⏰ Uptime: ${response.data.uptime.toFixed(2)}s`, 'green');
    return true;
  } catch (error) {
    log('❌ Stats FALHOU', 'red');
    log(`Erro: ${error.message}`, 'red');
    return false;
  }
}

// 🧪 Teste 3: Atualizar localização do usuário
async function testUpdateUserLocation() {
  log('\n📍 Testando Update User Location...', 'blue');
  try {
    const userData = {
      userId: 'test_user_123',
      lat: -23.5505,
      lng: -46.6333,
      timestamp: Date.now()
    };
    
    const response = await axios.post(`${BASE_URL}/api/update_user_location`, userData);
    log('✅ Update User Location OK', 'green');
    log(`📝 Mensagem: ${response.data.message}`, 'green');
    return true;
  } catch (error) {
    log('❌ Update User Location FALHOU', 'red');
    log(`Erro: ${error.message}`, 'red');
    return false;
  }
}

// 🧪 Teste 4: Atualizar localização do motorista
async function testUpdateDriverLocation() {
  log('\n🚗 Testando Update Driver Location...', 'blue');
  try {
    const driverData = {
      driverId: 'test_driver_456',
      lat: -23.5505,
      lng: -46.6333,
      status: 'available',
      timestamp: Date.now()
    };
    
    const response = await axios.post(`${BASE_URL}/api/update_driver_location`, driverData);
    log('✅ Update Driver Location OK', 'green');
    log(`📝 Mensagem: ${response.data.message}`, 'green');
    return true;
  } catch (error) {
    log('❌ Update Driver Location FALHOU', 'red');
    log(`Erro: ${error.message}`, 'red');
    return false;
  }
}

// 🧪 Teste 5: Buscar motoristas próximos
async function testNearbyDrivers() {
  log('\n🔍 Testando Nearby Drivers...', 'blue');
  try {
    const params = {
      lat: -23.5505,
      lng: -46.6333,
      radius: 5
    };
    
    const response = await axios.get(`${BASE_URL}/api/nearby_drivers`, { params });
    log('✅ Nearby Drivers OK', 'green');
    log(`🚗 Motoristas encontrados: ${response.data.count}`, 'green');
    log(`📊 Sucesso: ${response.data.success}`, 'green');
    return true;
  } catch (error) {
    log('❌ Nearby Drivers FALHOU', 'red');
    log(`Erro: ${error.message}`, 'red');
    return false;
  }
}

// 🧪 Teste 6: Teste de performance
async function testPerformance() {
  log('\n⚡ Testando Performance...', 'blue');
  try {
    const startTime = Date.now();
    
    // Fazer 10 requisições simultâneas
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(axios.get(`${BASE_URL}/api/health`));
    }
    
    await Promise.all(promises);
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    log('✅ Performance OK', 'green');
    log(`⏱️ Tempo total: ${duration}ms`, 'green');
    log(`📊 Média por requisição: ${(duration / 10).toFixed(2)}ms`, 'green');
    return true;
  } catch (error) {
    log('❌ Performance FALHOU', 'red');
    log(`Erro: ${error.message}`, 'red');
    return false;
  }
}

// 🧪 Teste 7: Teste de erro
async function testErrorHandling() {
  log('\n🚨 Testando Error Handling...', 'blue');
  try {
    // Tentar acessar endpoint inexistente
    await axios.get(`${BASE_URL}/api/invalid_endpoint`);
    log('❌ Error Handling FALHOU - deveria retornar erro', 'red');
    return false;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      log('✅ Error Handling OK - 404 retornado corretamente', 'green');
      return true;
    } else {
      log('❌ Error Handling FALHOU - erro inesperado', 'red');
      log(`Erro: ${error.message}`, 'red');
      return false;
    }
  }
}

// 🎯 Função principal
async function runAllTests() {
  log('\n🚀 INICIANDO TESTES DA SELF-HOSTED API', 'bold');
  log('=====================================', 'bold');
  
  const tests = [
    { name: 'Health Check', fn: testHealthCheck },
    { name: 'Stats', fn: testStats },
    { name: 'Update User Location', fn: testUpdateUserLocation },
    { name: 'Update Driver Location', fn: testUpdateDriverLocation },
    { name: 'Nearby Drivers', fn: testNearbyDrivers },
    { name: 'Performance', fn: testPerformance },
    { name: 'Error Handling', fn: testErrorHandling }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    log(`\n🧪 Executando: ${test.name}`, 'yellow');
    const result = await test.fn();
    
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }
  
  // 📊 Resultado final
  log('\n🎯 RESULTADO DOS TESTES', 'bold');
  log('======================', 'bold');
  log(`✅ Passou: ${passed}`, 'green');
  log(`❌ Falhou: ${failed}`, 'red');
  log(`📊 Total: ${tests.length}`, 'blue');
  
  if (failed === 0) {
    log('\n🎉 TODOS OS TESTES PASSARAM!', 'bold');
    log('🚀 Self-Hosted API está funcionando perfeitamente!', 'green');
  } else {
    log('\n⚠️ ALGUNS TESTES FALHARAM', 'bold');
    log('🔧 Verifique os logs acima para mais detalhes', 'yellow');
  }
  
  return failed === 0;
}

// 🚀 Executar testes
if (require.main === module) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    log(`\n💥 Erro fatal: ${error.message}`, 'red');
    process.exit(1);
  });
}

module.exports = {
  runAllTests,
  testHealthCheck,
  testStats,
  testUpdateUserLocation,
  testUpdateDriverLocation,
  testNearbyDrivers,
  testPerformance,
  testErrorHandling
}; 