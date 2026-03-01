const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Configurações do teste
const CONFIG = {
  CONCURRENT_USERS: 50,
  DURATION_SECONDS: 60,
  RAMP_UP_SECONDS: 10,
  API_BASE_URL: 'https://api.leaf.app.br',
  DASHBOARD_URL: 'https://dashboard.leaf.app.br'
};

// Métricas do teste
let metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalResponseTime: 0,
  minResponseTime: Infinity,
  maxResponseTime: 0,
  errors: [],
  startTime: null,
  endTime: null
};

// Função para fazer login e obter token
async function login() {
  try {
    const loginResponse = await execAsync(`curl -s -X POST ${CONFIG.API_BASE_URL}/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"password"}'`);
    const loginData = JSON.parse(loginResponse.stdout);
    return loginData.token;
  } catch (error) {
    console.error('❌ Erro no login:', error.message);
    return null;
  }
}

// Função para fazer uma requisição autenticada
async function makeAuthenticatedRequest(token, endpoint) {
  const startTime = Date.now();
  try {
    const response = await execAsync(`curl -s -X GET ${CONFIG.API_BASE_URL}${endpoint} -H "Authorization: Bearer ${token}"`);
    const responseTime = Date.now() - startTime;
    
    metrics.totalRequests++;
    metrics.successfulRequests++;
    metrics.totalResponseTime += responseTime;
    metrics.minResponseTime = Math.min(metrics.minResponseTime, responseTime);
    metrics.maxResponseTime = Math.max(metrics.maxResponseTime, responseTime);
    
    return { success: true, responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    metrics.totalRequests++;
    metrics.failedRequests++;
    metrics.totalResponseTime += responseTime;
    metrics.errors.push({ endpoint, error: error.message, responseTime });
    
    return { success: false, responseTime };
  }
}

// Função para simular um usuário
async function simulateUser(userId) {
  const token = await login();
  if (!token) {
    console.log(`❌ Usuário ${userId}: Falha no login`);
    return;
  }

  const endpoints = [
    '/dashboard/overview',
    '/dashboard/vps/vultr',
    '/dashboard/redis',
    '/dashboard/websocket',
    '/dashboard/performance'
  ];

  console.log(`👤 Usuário ${userId}: Iniciado`);

  for (let i = 0; i < 10; i++) {
    for (const endpoint of endpoints) {
      const result = await makeAuthenticatedRequest(token, endpoint);
      if (result.success) {
        console.log(`✅ Usuário ${userId}: ${endpoint} (${result.responseTime}ms)`);
      } else {
        console.log(`❌ Usuário ${userId}: ${endpoint} falhou`);
      }
      
      // Aguardar entre requisições
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`👤 Usuário ${userId}: Concluído`);
}

// Função para executar teste de carga
async function runLoadTest() {
  console.log('🚀 Iniciando teste de carga com nova estrutura...\n');
  console.log(`📊 Configuração:`);
  console.log(`   Usuários simultâneos: ${CONFIG.CONCURRENT_USERS}`);
  console.log(`   Duração: ${CONFIG.DURATION_SECONDS} segundos`);
  console.log(`   Ramp-up: ${CONFIG.RAMP_UP_SECONDS} segundos`);
  console.log(`   API: ${CONFIG.API_BASE_URL}`);
  console.log(`   Dashboard: ${CONFIG.DASHBOARD_URL}\n`);

  metrics.startTime = Date.now();

  // Criar usuários simultâneos
  const userPromises = [];
  for (let i = 1; i <= CONFIG.CONCURRENT_USERS; i++) {
    const delay = (i - 1) * (CONFIG.RAMP_UP_SECONDS * 1000 / CONFIG.CONCURRENT_USERS);
    userPromises.push(
      new Promise(resolve => setTimeout(() => simulateUser(i).then(resolve), delay))
    );
  }

  // Aguardar todos os usuários
  await Promise.all(userPromises);

  metrics.endTime = Date.now();

  // Gerar relatório
  generateReport();
}

// Função para gerar relatório
function generateReport() {
  const duration = (metrics.endTime - metrics.startTime) / 1000;
  const avgResponseTime = metrics.totalResponseTime / metrics.totalRequests;
  const successRate = (metrics.successfulRequests / metrics.totalRequests) * 100;
  const requestsPerSecond = metrics.totalRequests / duration;

  console.log('\n📊 RELATÓRIO DO TESTE DE CARGA');
  console.log('================================');
  console.log(`⏱️  Duração total: ${duration.toFixed(2)} segundos`);
  console.log(`📈 Total de requisições: ${metrics.totalRequests}`);
  console.log(`✅ Requisições bem-sucedidas: ${metrics.successfulRequests}`);
  console.log(`❌ Requisições falharam: ${metrics.failedRequests}`);
  console.log(`📊 Taxa de sucesso: ${successRate.toFixed(2)}%`);
  console.log(`⚡ Requisições por segundo: ${requestsPerSecond.toFixed(2)}`);
  console.log(`⏱️  Tempo de resposta médio: ${avgResponseTime.toFixed(2)}ms`);
  console.log(`⏱️  Tempo de resposta mínimo: ${metrics.minResponseTime}ms`);
  console.log(`⏱️  Tempo de resposta máximo: ${metrics.maxResponseTime}ms`);

  if (metrics.errors.length > 0) {
    console.log('\n❌ Erros encontrados:');
    metrics.errors.slice(0, 10).forEach(error => {
      console.log(`   ${error.endpoint}: ${error.error}`);
    });
  }

  console.log('\n🎯 Teste de carga concluído!');
}

// Executar teste
runLoadTest().catch(console.error); 