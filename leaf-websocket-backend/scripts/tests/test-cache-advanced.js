// test-cache-advanced.js
// Teste completo do cache Redis avançado

const fetch = require('node-fetch').default;

const BASE_URL = 'http://localhost:3001';
const GRAPHQL_URL = `${BASE_URL}/graphql`;
const CACHE_URL = `${BASE_URL}/cache`;

// Queries de teste para cache
const queries = {
  financialReport: `
    query FinancialReport($period: String!) {
      financialReport(period: $period) {
        period
        totalRevenue
        totalCosts
        profitMargin
        totalTrips
        averageFare
      }
    }
  `,
  
  operationalMetrics: `
    query OperationalMetrics($period: String!) {
      operationalMetrics(period: $period) {
        totalTrips
        completedTrips
        cancelledTrips
        averageTripDuration
        averageTripDistance
      }
    }
  `,
  
  nearbyDrivers: `
    query NearbyDrivers($location: LocationInput!, $radius: Float) {
      nearbyDrivers(location: $location, radius: $radius) {
        id
        name
        rating
        isOnline
        vehicle {
          model
          brand
        }
      }
    }
  `,
  
  metrics: `
    query Metrics($period: String!) {
      metrics(period: $period) {
        operational {
          totalTrips
          completedTrips
        }
        financial {
          totalRevenue
          totalCosts
        }
      }
    }
  `
};

// Função para executar query GraphQL
async function executeQuery(query, variables = {}) {
  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables
      })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return { error: error.message };
  }
}

// Função para testar endpoint de cache
async function testCacheEndpoint(endpoint) {
  try {
    const response = await fetch(`${CACHE_URL}${endpoint}`);
    const result = await response.json();
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Função para medir tempo de resposta
async function measureResponseTime(queryFunction) {
  const startTime = Date.now();
  const result = await queryFunction();
  const endTime = Date.now();
  return {
    result,
    responseTime: endTime - startTime
  };
}

// Função principal de teste
async function runCacheTests() {
  console.log('🧪 TESTANDO CACHE REDIS AVANÇADO!');
  console.log('==================================');
  console.log(`🔗 GraphQL URL: ${GRAPHQL_URL}`);
  console.log(`📊 Cache URL: ${CACHE_URL}`);
  console.log('');

  let passedTests = 0;
  let totalTests = 0;

  // Teste 1: Health Check do Cache
  console.log('1️⃣ TESTANDO HEALTH CHECK DO CACHE...');
  totalTests++;
  const healthResult = await testCacheEndpoint('/health');
  if (healthResult.success && healthResult.data.data.status === 'healthy') {
    console.log('✅ Cache Health Check: OK');
    console.log(`   📊 Status: ${healthResult.data.data.status}`);
    console.log(`   ⚡ Latência: ${healthResult.data.data.latency}ms`);
    console.log(`   🔧 Read/Write: ${healthResult.data.data.readWrite ? 'OK' : 'FALHOU'}`);
    passedTests++;
  } else {
    console.log('❌ Cache Health Check: FALHOU');
    console.log(`   Erro: ${healthResult.error}`);
  }
  console.log('');

  // Teste 2: Estatísticas do Cache
  console.log('2️⃣ TESTANDO ESTATÍSTICAS DO CACHE...');
  totalTests++;
  const statsResult = await testCacheEndpoint('/stats');
  if (statsResult.success && statsResult.data.data) {
    console.log('✅ Cache Stats: OK');
    console.log(`   📊 Total de chaves: ${statsResult.data.data.totalKeys}`);
    console.log(`   💾 Uso de memória: ${(statsResult.data.data.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   📈 Por tipo:`);
    Object.entries(statsResult.data.data.byType).forEach(([type, count]) => {
      console.log(`      - ${type}: ${count} chaves`);
    });
    passedTests++;
  } else {
    console.log('❌ Cache Stats: FALHOU');
    console.log(`   Erro: ${statsResult.error}`);
  }
  console.log('');

  // Teste 3: Cache HIT - Financial Report
  console.log('3️⃣ TESTANDO CACHE HIT - FINANCIAL REPORT...');
  totalTests++;
  
  // Primeira execução (deve ser cache MISS)
  console.log('   📊 Primeira execução (Cache MISS)...');
  const firstExecution = await measureResponseTime(() => 
    executeQuery(queries.financialReport, { period: '30d' })
  );
  
  if (firstExecution.result.data && firstExecution.result.data.financialReport) {
    console.log(`   ✅ Primeira execução: ${firstExecution.responseTime}ms`);
    
    // Segunda execução (deve ser cache HIT)
    console.log('   📊 Segunda execução (Cache HIT)...');
    const secondExecution = await measureResponseTime(() => 
      executeQuery(queries.financialReport, { period: '30d' })
    );
    
    if (secondExecution.result.data && secondExecution.result.data.financialReport) {
      console.log(`   ✅ Segunda execução: ${secondExecution.responseTime}ms`);
      
      const improvement = ((firstExecution.responseTime - secondExecution.responseTime) / firstExecution.responseTime * 100).toFixed(1);
      console.log(`   🚀 Melhoria: ${improvement}% mais rápido`);
      
      if (secondExecution.responseTime < firstExecution.responseTime) {
        console.log('   ✅ Cache HIT funcionando!');
        passedTests++;
      } else {
        console.log('   ⚠️ Cache pode não estar funcionando corretamente');
      }
    } else {
      console.log('   ❌ Segunda execução falhou');
    }
  } else {
    console.log('   ❌ Primeira execução falhou');
  }
  console.log('');

  // Teste 4: Cache HIT - Operational Metrics
  console.log('4️⃣ TESTANDO CACHE HIT - OPERATIONAL METRICS...');
  totalTests++;
  
  const firstOps = await measureResponseTime(() => 
    executeQuery(queries.operationalMetrics, { period: '7d' })
  );
  
  if (firstOps.result.data && firstOps.result.data.operationalMetrics) {
    console.log(`   ✅ Primeira execução: ${firstOps.responseTime}ms`);
    
    const secondOps = await measureResponseTime(() => 
      executeQuery(queries.operationalMetrics, { period: '7d' })
    );
    
    if (secondOps.result.data && secondOps.result.data.operationalMetrics) {
      console.log(`   ✅ Segunda execução: ${secondOps.responseTime}ms`);
      
      const improvement = ((firstOps.responseTime - secondOps.responseTime) / firstOps.responseTime * 100).toFixed(1);
      console.log(`   🚀 Melhoria: ${improvement}% mais rápido`);
      
      if (secondOps.responseTime < firstOps.responseTime) {
        console.log('   ✅ Cache HIT funcionando!');
        passedTests++;
      } else {
        console.log('   ⚠️ Cache pode não estar funcionando corretamente');
      }
    } else {
      console.log('   ❌ Segunda execução falhou');
    }
  } else {
    console.log('   ❌ Primeira execução falhou');
  }
  console.log('');

  // Teste 5: Cache Espacial - Nearby Drivers
  console.log('5️⃣ TESTANDO CACHE ESPACIAL - NEARBY DRIVERS...');
  totalTests++;
  
  const location = {
    latitude: -23.5505,
    longitude: -46.6333,
    address: 'São Paulo, SP'
  };
  
  const firstGeo = await measureResponseTime(() => 
    executeQuery(queries.nearbyDrivers, { location, radius: 5000 })
  );
  
  if (firstGeo.result.data && Array.isArray(firstGeo.result.data.nearbyDrivers)) {
    console.log(`   ✅ Primeira execução: ${firstGeo.responseTime}ms`);
    
    const secondGeo = await measureResponseTime(() => 
      executeQuery(queries.nearbyDrivers, { location, radius: 5000 })
    );
    
    if (secondGeo.result.data && Array.isArray(secondGeo.result.data.nearbyDrivers)) {
      console.log(`   ✅ Segunda execução: ${secondGeo.responseTime}ms`);
      
      const improvement = ((firstGeo.responseTime - secondGeo.responseTime) / firstGeo.responseTime * 100).toFixed(1);
      console.log(`   🚀 Melhoria: ${improvement}% mais rápido`);
      
      if (secondGeo.responseTime < firstGeo.responseTime) {
        console.log('   ✅ Cache espacial funcionando!');
        passedTests++;
      } else {
        console.log('   ⚠️ Cache espacial pode não estar funcionando');
      }
    } else {
      console.log('   ❌ Segunda execução falhou');
    }
  } else {
    console.log('   ❌ Primeira execução falhou');
  }
  console.log('');

  // Teste 6: Invalidação de Cache
  console.log('6️⃣ TESTANDO INVALIDAÇÃO DE CACHE...');
  totalTests++;
  
  try {
    const invalidateResponse = await fetch(`${CACHE_URL}/invalidate/financialReport`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ context: {} })
    });
    
    const invalidateResult = await invalidateResponse.json();
    
    if (invalidateResult.success) {
      console.log('✅ Invalidação de cache: OK');
      console.log(`   🗑️ Chaves invalidadas: ${invalidateResult.data.invalidatedKeys}`);
      console.log(`   📊 Tipo: ${invalidateResult.data.queryType}`);
      passedTests++;
    } else {
      console.log('❌ Invalidação de cache: FALHOU');
      console.log(`   Erro: ${invalidateResult.error}`);
    }
  } catch (error) {
    console.log('❌ Invalidação de cache: FALHOU');
    console.log(`   Erro: ${error.message}`);
  }
  console.log('');

  // Teste 7: Performance com Cache
  console.log('7️⃣ TESTANDO PERFORMANCE COM CACHE...');
  totalTests++;
  
  const performanceStart = Date.now();
  const promises = [];
  
  // Executar 10 queries em paralelo
  for (let i = 0; i < 10; i++) {
    promises.push(executeQuery(queries.metrics, { period: '30d' }));
  }
  
  const results = await Promise.all(promises);
  const performanceEnd = Date.now();
  const totalTime = performanceEnd - performanceStart;
  
  const successCount = results.filter(r => r.data && r.data.metrics).length;
  const avgTime = totalTime / results.length;
  
  console.log(`✅ Performance com cache: OK`);
  console.log(`   📊 Queries executadas: ${results.length}`);
  console.log(`   ✅ Sucessos: ${successCount}`);
  console.log(`   ⏱️ Tempo total: ${totalTime}ms`);
  console.log(`   ⚡ Tempo médio: ${avgTime.toFixed(2)}ms`);
  console.log(`   🚀 Throughput: ${(results.length / (totalTime / 1000)).toFixed(2)} queries/s`);
  
  if (successCount === results.length && avgTime < 1000) {
    console.log('   ✅ Performance excelente!');
    passedTests++;
  } else {
    console.log('   ⚠️ Performance pode ser melhorada');
  }
  console.log('');

  // Resultado final
  console.log('📊 RESULTADO FINAL DOS TESTES DE CACHE');
  console.log('======================================');
  console.log(`✅ Testes passaram: ${passedTests}/${totalTests}`);
  console.log(`📈 Taxa de sucesso: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  
  if (passedTests === totalTests) {
    console.log('🎉 TODOS OS TESTES DE CACHE PASSARAM! CACHE REDIS AVANÇADO ESTÁ FUNCIONANDO PERFEITAMENTE!');
  } else if (passedTests >= totalTests * 0.8) {
    console.log('👍 MAIORIA DOS TESTES PASSOU! CACHE REDIS AVANÇADO ESTÁ FUNCIONANDO BEM!');
  } else {
    console.log('⚠️ ALGUNS TESTES FALHARAM! PRECISA VERIFICAR OS PROBLEMAS DO CACHE!');
  }
  
  console.log('');
  console.log('🔗 Endpoints de cache disponíveis:');
  console.log(`   📊 Health: ${CACHE_URL}/health`);
  console.log(`   📈 Stats: ${CACHE_URL}/stats`);
  console.log(`   🗑️ Invalidate: ${CACHE_URL}/invalidate/:queryType`);
  console.log(`   👤 Invalidate User: ${CACHE_URL}/invalidate-user/:userId`);
  console.log(`   🧹 Clear All: ${CACHE_URL}/clear`);
}

// Executar testes
runCacheTests().catch(error => {
  console.error('❌ Erro ao executar testes de cache:', error);
});




