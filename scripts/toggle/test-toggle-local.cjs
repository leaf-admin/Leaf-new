// test-toggle-local.cjs - Teste local do toggle beta
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const CONFIG = {
  apiUrl: 'https://api.leaf.app.br',
  testUserId: 'test_user_123',
  testRoutes: [
    {
      name: 'Teste Toggle Modo',
      method: 'POST',
      endpoint: '/user/mode',
      body: { userId: 'test_user_123', mode: 'driver' }
    },
    {
      name: 'Teste Carregar Perfil Passageiro',
      method: 'GET',
      endpoint: '/user/profile/passenger?userId=test_user_123'
    },
    {
      name: 'Teste Carregar Perfil Motorista',
      method: 'GET',
      endpoint: '/user/profile/driver?userId=test_user_123'
    },
    {
      name: 'Teste Verificar Permissões',
      method: 'GET',
      endpoint: '/user/permissions/test_user_123'
    },
    {
      name: 'Teste Cache Stats',
      method: 'GET',
      endpoint: '/user/cache/stats?userId=test_user_123'
    }
  ]
};

async function makeApiRequest(name, method, endpoint, body = null) {
  try {
    console.log(`\n🔍 Testando: ${name}`);
    console.log(`📍 Endpoint: ${method} ${endpoint}`);
    
    let curlCommand = `curl -s -X ${method} "${CONFIG.apiUrl}${endpoint}"`;
    
    if (body) {
      curlCommand += ` -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`;
    }
    
    curlCommand += ` -H "Authorization: Bearer test_token"`;
    
    console.log(`🔄 Executando: ${curlCommand}`);
    
    const { stdout, stderr } = await execAsync(curlCommand);
    
    if (stderr) {
      console.error(`❌ Erro: ${stderr}`);
      return { success: false, error: stderr };
    }
    
    const response = JSON.parse(stdout);
    
    if (response.success !== undefined) {
      console.log(`✅ Sucesso: ${response.success}`);
      if (response.message) {
        console.log(`📝 Mensagem: ${response.message}`);
      }
      if (response.data) {
        console.log(`📊 Dados: ${JSON.stringify(response.data, null, 2)}`);
      }
      if (response.profile) {
        console.log(`👤 Perfil: ${JSON.stringify(response.profile, null, 2)}`);
      }
      if (response.permissions) {
        console.log(`🔐 Permissões: ${JSON.stringify(response.permissions, null, 2)}`);
      }
      if (response.stats) {
        console.log(`📈 Stats: ${JSON.stringify(response.stats, null, 2)}`);
      }
    } else {
      console.log(`📄 Resposta: ${stdout}`);
    }
    
    return { success: true, response };
  } catch (error) {
    console.error(`❌ Erro no teste ${name}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function testToggleMode() {
  console.log('🔄 Testando alternância de modo...');
  
  // Teste 1: Alternar para motorista
  const result1 = await makeApiRequest(
    'Alternar para Motorista',
    'POST',
    '/user/mode',
    { userId: CONFIG.testUserId, mode: 'driver' }
  );
  
  if (!result1.success) {
    console.error('❌ Falha no teste de alternância para motorista');
    return false;
  }
  
  // Aguardar um pouco
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Teste 2: Alternar para passageiro
  const result2 = await makeApiRequest(
    'Alternar para Passageiro',
    'POST',
    '/user/mode',
    { userId: CONFIG.testUserId, mode: 'passenger' }
  );
  
  if (!result2.success) {
    console.error('❌ Falha no teste de alternância para passageiro');
    return false;
  }
  
  console.log('✅ Teste de alternância de modo concluído com sucesso');
  return true;
}

async function testProfileData() {
  console.log('\n📊 Testando carregamento de dados de perfil...');
  
  // Teste 1: Carregar dados de passageiro
  const result1 = await makeApiRequest(
    'Carregar Dados de Passageiro',
    'GET',
    '/user/profile/passenger?userId=test_user_123'
  );
  
  if (!result1.success) {
    console.error('❌ Falha no teste de carregamento de dados de passageiro');
    return false;
  }
  
  // Teste 2: Carregar dados de motorista
  const result2 = await makeApiRequest(
    'Carregar Dados de Motorista',
    'GET',
    '/user/profile/driver?userId=test_user_123'
  );
  
  if (!result2.success) {
    console.error('❌ Falha no teste de carregamento de dados de motorista');
    return false;
  }
  
  console.log('✅ Teste de carregamento de dados de perfil concluído com sucesso');
  return true;
}

async function testPermissions() {
  console.log('\n🔐 Testando verificação de permissões...');
  
  const result = await makeApiRequest(
    'Verificar Permissões',
    'GET',
    '/user/permissions/test_user_123'
  );
  
  if (!result.success) {
    console.error('❌ Falha no teste de verificação de permissões');
    return false;
  }
  
  console.log('✅ Teste de verificação de permissões concluído com sucesso');
  return true;
}

async function testCacheStats() {
  console.log('\n📈 Testando estatísticas de cache...');
  
  const result = await makeApiRequest(
    'Cache Stats',
    'GET',
    '/user/cache/stats?userId=test_user_123'
  );
  
  if (!result.success) {
    console.error('❌ Falha no teste de estatísticas de cache');
    return false;
  }
  
  console.log('✅ Teste de estatísticas de cache concluído com sucesso');
  return true;
}

async function testAllRoutes() {
  console.log('\n🚀 Testando todas as rotas do toggle beta...');
  
  const results = [];
  
  for (const route of CONFIG.testRoutes) {
    const result = await makeApiRequest(
      route.name,
      route.method,
      route.endpoint,
      route.body
    );
    results.push({ route: route.name, success: result.success });
    
    // Aguardar um pouco entre as requisições
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;
  
  console.log(`\n📊 Resultados dos Testes:`);
  console.log(`✅ Sucessos: ${successCount}/${totalCount}`);
  console.log(`❌ Falhas: ${totalCount - successCount}/${totalCount}`);
  
  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${result.route}`);
  });
  
  return successCount === totalCount;
}

async function runToggleLocalTest() {
  console.log('🎯 INICIANDO TESTE LOCAL DO TOGGLE BETA');
  console.log('=' .repeat(50));
  
  const startTime = Date.now();
  
  try {
    // Teste de conectividade
    console.log('\n🔍 Verificando conectividade com a API...');
    const connectivityTest = await makeApiRequest(
      'Health Check',
      'GET',
      '/'
    );
    
    if (!connectivityTest.success) {
      console.error('❌ Não foi possível conectar à API');
      return false;
    }
    
    console.log('✅ Conectividade OK');
    
    // Executar todos os testes
    const toggleResult = await testToggleMode();
    const profileResult = await testProfileData();
    const permissionsResult = await testPermissions();
    const cacheResult = await testCacheStats();
    const allRoutesResult = await testAllRoutes();
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log('\n' + '=' .repeat(50));
    console.log('📊 RESUMO DOS TESTES');
    console.log('=' .repeat(50));
    console.log(`⏱️  Duração total: ${duration}ms`);
    console.log(`🔄 Toggle Mode: ${toggleResult ? '✅' : '❌'}`);
    console.log(`📊 Profile Data: ${profileResult ? '✅' : '❌'}`);
    console.log(`🔐 Permissions: ${permissionsResult ? '✅' : '❌'}`);
    console.log(`📈 Cache Stats: ${cacheResult ? '✅' : '❌'}`);
    console.log(`🚀 All Routes: ${allRoutesResult ? '✅' : '❌'}`);
    
    const allSuccess = toggleResult && profileResult && permissionsResult && cacheResult && allRoutesResult;
    
    if (allSuccess) {
      console.log('\n🎉 TODOS OS TESTES PASSARAM!');
      console.log('✅ O toggle beta está funcionando corretamente');
      console.log('\n📱 PRÓXIMO PASSO: Testar no dispositivo real');
      console.log('1. Instalar Expo Go no dispositivo');
      console.log('2. Escanear QR code do servidor Expo');
      console.log('3. Testar toggle no app');
    } else {
      console.log('\n⚠️  ALGUNS TESTES FALHARAM');
      console.log('❌ Há problemas no toggle beta que precisam ser corrigidos');
    }
    
    return allSuccess;
    
  } catch (error) {
    console.error('❌ Erro durante os testes:', error);
    return false;
  }
}

// Executar teste
if (require.main === module) {
  runToggleLocalTest().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { runToggleLocalTest }; 