// test-graphql-complete.js
// Teste completo do GraphQL integrado

const fetch = require('node-fetch').default;

const BASE_URL = 'http://localhost:3001';
const GRAPHQL_URL = `${BASE_URL}/graphql`;

// Queries de teste
const queries = {
  // Teste de introspection
  introspection: `
    query IntrospectionQuery {
      __schema {
        queryType {
          name
          fields {
            name
            description
          }
        }
        mutationType {
          name
          fields {
            name
          }
        }
        subscriptionType {
          name
          fields {
            name
          }
        }
      }
    }
  `,

  // Teste do Dashboard Resolver
  financialReport: `
    query FinancialReport($period: String!) {
      financialReport(period: $period) {
        period
        totalRevenue
        totalCosts
        profitMargin
        totalTrips
        averageFare
        costBreakdown {
          mapsApi
          infrastructure
          paymentProcessing
          serverCosts
          firebaseCosts
          redisCosts
          totalOperationalCosts
        }
        revenueBreakdown {
          rideFares
          commissions
          subscriptions
          marketing
          other
        }
        topRoutes {
          route
          frequency
          revenue
          averageFare
          distance
        }
        dailyMetrics {
          date
          trips
          revenue
          costs
          profit
        }
      }
    }
  `,

  // Teste do User Resolver
  users: `
    query Users($first: Int, $userType: UserType) {
      users(first: $first, userType: $userType) {
        edges {
          node {
            id
            name
            email
            phone
            userType
            status
            rating
            totalTrips
            createdAt
            updatedAt
          }
          cursor
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        totalCount
      }
    }
  `,

  // Teste do Driver Resolver
  nearbyDrivers: `
    query NearbyDrivers($location: LocationInput!, $radius: Float, $limit: Int) {
      nearbyDrivers(location: $location, radius: $radius, limit: $limit) {
        id
        name
        rating
        totalTrips
        isOnline
        vehicle {
          model
          brand
          color
          vehicleType
        }
        location {
          latitude
          longitude
          address
        }
      }
    }
  `,

  // Teste do Booking Resolver
  bookings: `
    query Bookings($first: Int, $status: BookingStatus) {
      bookings(first: $first, status: $status) {
        edges {
          node {
            id
            passenger {
              id
              name
            }
            driver {
              id
              name
            }
            pickup {
              latitude
              longitude
              address
            }
            destination {
              latitude
              longitude
              address
            }
            status
            fare
            distance
            duration
            createdAt
            updatedAt
          }
          cursor
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        totalCount
      }
    }
  `,

  // Teste de métricas operacionais
  operationalMetrics: `
    query OperationalMetrics($period: String!) {
      operationalMetrics(period: $period) {
        totalTrips
        completedTrips
        cancelledTrips
        averageTripDuration
        averageTripDistance
        peakHours
        busyAreas {
          area
          tripCount
          revenue
          averageFare
        }
      }
    }
  `,

  // Teste de métricas gerais
  metrics: `
    query Metrics($period: String!) {
      metrics(period: $period) {
        operational {
          totalTrips
          completedTrips
          cancelledTrips
          averageTripDuration
          averageTripDistance
        }
        financial {
          totalRevenue
          totalCosts
          netProfit
          profitMargin
          averageFare
          commissionRate
        }
        user {
          totalUsers
          activeUsers
          newUsers
          userRetention
          averageRating
        }
        driver {
          totalDrivers
          activeDrivers
          onlineDrivers
          averageDriverRating
          driverSatisfaction
        }
        system {
          uptime
          responseTime
          errorRate
          throughput
          cacheHitRate
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

// Função para testar endpoint REST
async function testRestEndpoint(endpoint) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`);
    const result = await response.json();
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Função principal de teste
async function runTests() {
  console.log('🧪 TESTANDO ESSA PORRA DE GRAPHQL!');
  console.log('===================================');
  console.log(`🔗 URL: ${GRAPHQL_URL}`);
  console.log(`📊 Base URL: ${BASE_URL}`);
  console.log('');

  let passedTests = 0;
  let totalTests = 0;

  // Teste 1: Health Check
  console.log('1️⃣ TESTANDO HEALTH CHECK...');
  totalTests++;
  const healthResult = await testRestEndpoint('/health');
  if (healthResult.success && healthResult.data.status === 'healthy') {
    console.log('✅ Health check: OK');
    console.log(`   📊 Status: ${healthResult.data.status}`);
    console.log(`   🔗 GraphQL: ${healthResult.data.graphql.enabled ? 'Ativo' : 'Inativo'}`);
    console.log(`   📈 Workers: ${healthResult.data.metrics.workers}`);
    passedTests++;
  } else {
    console.log('❌ Health check: FALHOU');
    console.log(`   Erro: ${healthResult.error}`);
  }
  console.log('');

  // Teste 2: Stats Endpoint
  console.log('2️⃣ TESTANDO STATS ENDPOINT...');
  totalTests++;
  const statsResult = await testRestEndpoint('/stats');
  if (statsResult.success && statsResult.data.graphql.status === 'active') {
    console.log('✅ Stats endpoint: OK');
    console.log(`   📊 GraphQL Status: ${statsResult.data.graphql.status}`);
    console.log(`   🔍 Queries: ${statsResult.data.graphql.queries}`);
    console.log(`   🔧 Mutations: ${statsResult.data.graphql.mutations}`);
    console.log(`   📡 Subscriptions: ${statsResult.data.graphql.subscriptions}`);
    passedTests++;
  } else {
    console.log('❌ Stats endpoint: FALHOU');
    console.log(`   Erro: ${statsResult.error}`);
  }
  console.log('');

  // Teste 3: Introspection
  console.log('3️⃣ TESTANDO INTROSPECTION...');
  totalTests++;
  const introspectionResult = await executeQuery(queries.introspection);
  if (introspectionResult.data && introspectionResult.data.__schema) {
    console.log('✅ Introspection: OK');
    console.log(`   📊 Queries: ${introspectionResult.data.__schema.queryType.fields.length}`);
    console.log(`   🔧 Mutations: ${introspectionResult.data.__schema.mutationType?.fields.length || 0}`);
    console.log(`   📡 Subscriptions: ${introspectionResult.data.__schema.subscriptionType?.fields.length || 0}`);
    passedTests++;
  } else {
    console.log('❌ Introspection: FALHOU');
    console.log(`   Erro: ${introspectionResult.errors?.[0]?.message || introspectionResult.error}`);
  }
  console.log('');

  // Teste 4: Financial Report
  console.log('4️⃣ TESTANDO FINANCIAL REPORT...');
  totalTests++;
  const financialResult = await executeQuery(queries.financialReport, { period: '30d' });
  if (financialResult.data && financialResult.data.financialReport) {
    console.log('✅ Financial Report: OK');
    console.log(`   📊 Período: ${financialResult.data.financialReport.period}`);
    console.log(`   💰 Receita: R$ ${financialResult.data.financialReport.totalRevenue.toFixed(2)}`);
    console.log(`   💸 Custos: R$ ${financialResult.data.financialReport.totalCosts.toFixed(2)}`);
    console.log(`   📈 Margem: ${financialResult.data.financialReport.profitMargin.toFixed(2)}%`);
    console.log(`   🚗 Corridas: ${financialResult.data.financialReport.totalTrips}`);
    passedTests++;
  } else {
    console.log('❌ Financial Report: FALHOU');
    console.log(`   Erro: ${financialResult.errors?.[0]?.message || financialResult.error}`);
  }
  console.log('');

  // Teste 5: Users Query
  console.log('5️⃣ TESTANDO USERS QUERY...');
  totalTests++;
  const usersResult = await executeQuery(queries.users, { first: 5 });
  if (usersResult.data && usersResult.data.users) {
    console.log('✅ Users Query: OK');
    console.log(`   👥 Usuários encontrados: ${usersResult.data.users.edges.length}`);
    console.log(`   📊 Total: ${usersResult.data.users.totalCount}`);
    console.log(`   📄 Paginação: ${usersResult.data.users.pageInfo.hasNextPage ? 'Tem próxima' : 'Última página'}`);
    passedTests++;
  } else {
    console.log('❌ Users Query: FALHOU');
    console.log(`   Erro: ${usersResult.errors?.[0]?.message || usersResult.error}`);
  }
  console.log('');

  // Teste 6: Nearby Drivers
  console.log('6️⃣ TESTANDO NEARBY DRIVERS...');
  totalTests++;
  const driversResult = await executeQuery(queries.nearbyDrivers, {
    location: {
      latitude: -23.5505,
      longitude: -46.6333,
      address: 'São Paulo, SP'
    },
    radius: 5000,
    limit: 5
  });
  if (driversResult.data && Array.isArray(driversResult.data.nearbyDrivers)) {
    console.log('✅ Nearby Drivers: OK');
    console.log(`   🚗 Motoristas encontrados: ${driversResult.data.nearbyDrivers.length}`);
    if (driversResult.data.nearbyDrivers.length > 0) {
      console.log(`   📍 Primeiro motorista: ${driversResult.data.nearbyDrivers[0].name}`);
      console.log(`   ⭐ Rating: ${driversResult.data.nearbyDrivers[0].rating}`);
    }
    passedTests++;
  } else {
    console.log('❌ Nearby Drivers: FALHOU');
    console.log(`   Erro: ${driversResult.errors?.[0]?.message || driversResult.error}`);
  }
  console.log('');

  // Teste 7: Bookings Query
  console.log('7️⃣ TESTANDO BOOKINGS QUERY...');
  totalTests++;
  const bookingsResult = await executeQuery(queries.bookings, { first: 5 });
  if (bookingsResult.data && bookingsResult.data.bookings) {
    console.log('✅ Bookings Query: OK');
    console.log(`   🚗 Corridas encontradas: ${bookingsResult.data.bookings.edges.length}`);
    console.log(`   📊 Total: ${bookingsResult.data.bookings.totalCount}`);
    console.log(`   📄 Paginação: ${bookingsResult.data.bookings.pageInfo.hasNextPage ? 'Tem próxima' : 'Última página'}`);
    passedTests++;
  } else {
    console.log('❌ Bookings Query: FALHOU');
    console.log(`   Erro: ${bookingsResult.errors?.[0]?.message || bookingsResult.error}`);
  }
  console.log('');

  // Teste 8: Operational Metrics
  console.log('8️⃣ TESTANDO OPERATIONAL METRICS...');
  totalTests++;
  const operationalResult = await executeQuery(queries.operationalMetrics, { period: '7d' });
  if (operationalResult.data && operationalResult.data.operationalMetrics) {
    console.log('✅ Operational Metrics: OK');
    console.log(`   🚗 Total de corridas: ${operationalResult.data.operationalMetrics.totalTrips}`);
    console.log(`   ✅ Corridas completas: ${operationalResult.data.operationalMetrics.completedTrips}`);
    console.log(`   ❌ Corridas canceladas: ${operationalResult.data.operationalMetrics.cancelledTrips}`);
    console.log(`   ⏱️ Duração média: ${operationalResult.data.operationalMetrics.averageTripDuration} min`);
    passedTests++;
  } else {
    console.log('❌ Operational Metrics: FALHOU');
    console.log(`   Erro: ${operationalResult.errors?.[0]?.message || operationalResult.error}`);
  }
  console.log('');

  // Teste 9: Metrics Gerais
  console.log('9️⃣ TESTANDO METRICS GERAIS...');
  totalTests++;
  const metricsResult = await executeQuery(queries.metrics, { period: '30d' });
  if (metricsResult.data && metricsResult.data.metrics) {
    console.log('✅ Metrics Gerais: OK');
    console.log(`   🚗 Operacional: ${metricsResult.data.metrics.operational.totalTrips} corridas`);
    console.log(`   💰 Financeiro: R$ ${metricsResult.data.metrics.financial.totalRevenue.toFixed(2)} receita`);
    console.log(`   👥 Usuários: ${metricsResult.data.metrics.user.totalUsers} total`);
    console.log(`   🚗 Motoristas: ${metricsResult.data.metrics.driver.totalDrivers} total`);
    console.log(`   ⚡ Sistema: ${metricsResult.data.metrics.system.uptime}% uptime`);
    passedTests++;
  } else {
    console.log('❌ Metrics Gerais: FALHOU');
    console.log(`   Erro: ${metricsResult.errors?.[0]?.message || metricsResult.error}`);
  }
  console.log('');

  // Teste 10: Performance Test
  console.log('🔟 TESTANDO PERFORMANCE...');
  totalTests++;
  const startTime = Date.now();
  const performanceResult = await executeQuery(queries.financialReport, { period: '7d' });
  const endTime = Date.now();
  const responseTime = endTime - startTime;
  
  if (performanceResult.data && performanceResult.data.financialReport) {
    console.log('✅ Performance Test: OK');
    console.log(`   ⚡ Tempo de resposta: ${responseTime}ms`);
    console.log(`   📊 Status: ${responseTime < 1000 ? 'Excelente' : responseTime < 2000 ? 'Bom' : 'Lento'}`);
    passedTests++;
  } else {
    console.log('❌ Performance Test: FALHOU');
    console.log(`   Erro: ${performanceResult.errors?.[0]?.message || performanceResult.error}`);
  }
  console.log('');

  // Resultado final
  console.log('📊 RESULTADO FINAL DOS TESTES');
  console.log('==============================');
  console.log(`✅ Testes passaram: ${passedTests}/${totalTests}`);
  console.log(`📈 Taxa de sucesso: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  
  if (passedTests === totalTests) {
    console.log('🎉 TODOS OS TESTES PASSARAM! GRAPHQL ESTÁ FUNCIONANDO PERFEITAMENTE!');
  } else if (passedTests >= totalTests * 0.8) {
    console.log('👍 MAIORIA DOS TESTES PASSOU! GRAPHQL ESTÁ FUNCIONANDO BEM!');
  } else {
    console.log('⚠️ ALGUNS TESTES FALHARAM! PRECISA VERIFICAR OS PROBLEMAS!');
  }
  
  console.log('');
  console.log('🔗 Endpoints disponíveis:');
  console.log(`   📊 Health: ${BASE_URL}/health`);
  console.log(`   📈 Stats: ${BASE_URL}/stats`);
  console.log(`   🔗 GraphQL: ${GRAPHQL_URL}`);
  console.log(`   🎮 Playground: ${GRAPHQL_URL}`);
}

// Executar testes
runTests().catch(error => {
  console.error('❌ Erro ao executar testes:', error);
});




