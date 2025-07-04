const axios = require('axios');

// Configuração
const BASE_URL = 'http://localhost:5001/your-project/us-central1';
const TEST_TOKEN = 'your-test-token'; // Substitua com token real
const CONCURRENT_REQUESTS = 10;
const TOTAL_REQUESTS = 1000;

// Headers padrão
const headers = {
    'Authorization': `Bearer ${TEST_TOKEN}`,
    'Content-Type': 'application/json'
};

// Métricas
let successCount = 0;
let errorCount = 0;
let totalTime = 0;
let responseTimes = [];

// Função para fazer requisição
async function makeRequest(requestId) {
    const startTime = Date.now();
    
    try {
        const locationData = {
            lat: -22.9068 + (Math.random() * 0.01),
            lng: -43.1729 + (Math.random() * 0.01),
            timestamp: Date.now()
        };

        const response = await axios.post(
            `${BASE_URL}/save_user_location`,
            locationData,
            { headers, timeout: 5000 }
        );

        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        responseTimes.push(responseTime);
        successCount++;
        
        if (requestId % 100 === 0) {
            console.log(`✅ Request ${requestId}: ${responseTime}ms`);
        }
        
        return { success: true, responseTime };
    } catch (error) {
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        responseTimes.push(responseTime);
        errorCount++;
        
        console.error(`❌ Request ${requestId} failed:`, error.message);
        return { success: false, responseTime, error: error.message };
    }
}

// Função para executar requisições em paralelo
async function runConcurrentRequests(startIndex, count) {
    const promises = [];
    
    for (let i = 0; i < count; i++) {
        const requestId = startIndex + i;
        promises.push(makeRequest(requestId));
    }
    
    return Promise.all(promises);
}

// Função principal de teste de carga
async function runLoadTest() {
    console.log('🚀 Iniciando Teste de Carga Redis');
    console.log('==================================');
    console.log(`Total de requisições: ${TOTAL_REQUESTS}`);
    console.log(`Requisições simultâneas: ${CONCURRENT_REQUESTS}`);
    console.log(`URL base: ${BASE_URL}`);
    console.log('');

    const startTime = Date.now();

    // Executar requisições em lotes
    for (let i = 0; i < TOTAL_REQUESTS; i += CONCURRENT_REQUESTS) {
        const batchSize = Math.min(CONCURRENT_REQUESTS, TOTAL_REQUESTS - i);
        await runConcurrentRequests(i, batchSize);
        
        // Pequena pausa entre lotes
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    const endTime = Date.now();
    totalTime = endTime - startTime;

    // Calcular estatísticas
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const minResponseTime = Math.min(...responseTimes);
    const maxResponseTime = Math.max(...responseTimes);
    const successRate = (successCount / TOTAL_REQUESTS) * 100;
    const requestsPerSecond = TOTAL_REQUESTS / (totalTime / 1000);

    // Exibir resultados
    console.log('\n📊 Resultados do Teste de Carga');
    console.log('================================');
    console.log(`⏱️  Tempo total: ${totalTime}ms`);
    console.log(`✅ Sucessos: ${successCount}`);
    console.log(`❌ Erros: ${errorCount}`);
    console.log(`📈 Taxa de sucesso: ${successRate.toFixed(2)}%`);
    console.log(`🚀 Requisições/segundo: ${requestsPerSecond.toFixed(2)}`);
    console.log('');
    console.log('📊 Latência:');
    console.log(`   Média: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`   Mínima: ${minResponseTime}ms`);
    console.log(`   Máxima: ${maxResponseTime}ms`);

    // Verificar critérios de sucesso
    console.log('\n🎯 Critérios de Sucesso:');
    console.log('========================');
    
    const criteria = {
        successRate: successRate >= 95,
        avgResponseTime: avgResponseTime <= 100,
        requestsPerSecond: requestsPerSecond >= 100,
        maxResponseTime: maxResponseTime <= 1000
    };

    console.log(`✅ Taxa de sucesso >= 95%: ${criteria.successRate ? 'PASSOU' : 'FALHOU'} (${successRate.toFixed(2)}%)`);
    console.log(`✅ Latência média <= 100ms: ${criteria.avgResponseTime ? 'PASSOU' : 'FALHOU'} (${avgResponseTime.toFixed(2)}ms)`);
    console.log(`✅ Throughput >= 100 req/s: ${criteria.requestsPerSecond ? 'PASSOU' : 'FALHOU'} (${requestsPerSecond.toFixed(2)} req/s)`);
    console.log(`✅ Latência máxima <= 1000ms: ${criteria.maxResponseTime ? 'PASSOU' : 'FALHOU'} (${maxResponseTime}ms)`);

    const allPassed = Object.values(criteria).every(c => c);
    console.log(`\n${allPassed ? '🎉 TODOS OS TESTES PASSARAM!' : '⚠️ ALGUNS TESTES FALHARAM'}`);

    return {
        success: allPassed,
        metrics: {
            totalTime,
            successCount,
            errorCount,
            successRate,
            requestsPerSecond,
            avgResponseTime,
            minResponseTime,
            maxResponseTime
        }
    };
}

// Teste de diferentes tipos de carga
async function runDifferentLoadTests() {
    console.log('🧪 Testes de Carga Variados');
    console.log('============================');

    const testConfigs = [
        { name: 'Baixa Carga', total: 100, concurrent: 5 },
        { name: 'Média Carga', total: 500, concurrent: 10 },
        { name: 'Alta Carga', total: 1000, concurrent: 20 },
        { name: 'Carga Extrema', total: 2000, concurrent: 50 }
    ];

    const results = [];

    for (const config of testConfigs) {
        console.log(`\n📊 Executando: ${config.name}`);
        console.log('='.repeat(30));
        
        // Atualizar configuração
        global.TOTAL_REQUESTS = config.total;
        global.CONCURRENT_REQUESTS = config.concurrent;
        
        // Resetar métricas
        successCount = 0;
        errorCount = 0;
        responseTimes = [];
        
        const result = await runLoadTest();
        results.push({
            config,
            result
        });
        
        // Pausa entre testes
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Resumo final
    console.log('\n📋 Resumo dos Testes');
    console.log('====================');
    
    results.forEach(({ config, result }) => {
        const { metrics } = result;
        console.log(`\n${config.name}:`);
        console.log(`  Sucessos: ${metrics.successCount}/${config.total} (${metrics.successRate.toFixed(1)}%)`);
        console.log(`  Latência: ${metrics.avgResponseTime.toFixed(1)}ms`);
        console.log(`  Throughput: ${metrics.requestsPerSecond.toFixed(1)} req/s`);
        console.log(`  Status: ${result.success ? '✅ PASSOU' : '❌ FALHOU'}`);
    });

    return results;
}

// Teste de stress específico para Redis
async function runRedisStressTest() {
    console.log('\n🔥 Teste de Stress Redis');
    console.log('========================');

    const stressTests = [
        {
            name: 'Múltiplas Localizações',
            endpoint: '/save_user_location',
            data: () => ({
                lat: -22.9068 + (Math.random() * 0.1),
                lng: -43.1729 + (Math.random() * 0.1),
                timestamp: Date.now()
            })
        },
        {
            name: 'Busca de Usuários Próximos',
            endpoint: '/get_nearby_users',
            method: 'GET',
            params: () => `?lat=${-22.9068 + Math.random() * 0.1}&lng=${-43.1729 + Math.random() * 0.1}&radius=5&limit=10`
        },
        {
            name: 'Tracking de Viagens',
            endpoint: '/start_trip_tracking',
            data: () => ({
                tripId: `stress-trip-${Date.now()}-${Math.random()}`,
                driverId: 'driver-stress',
                passengerId: 'passenger-stress',
                initialLocation: {
                    lat: -22.9068 + (Math.random() * 0.1),
                    lng: -43.1729 + (Math.random() * 0.1)
                }
            })
        }
    ];

    for (const test of stressTests) {
        console.log(`\n📊 Teste: ${test.name}`);
        console.log('-'.repeat(30));

        const startTime = Date.now();
        const requests = 100;
        const concurrent = 10;
        let success = 0;
        let errors = 0;

        for (let i = 0; i < requests; i += concurrent) {
            const batch = Math.min(concurrent, requests - i);
            const promises = [];

            for (let j = 0; j < batch; j++) {
                const config = {
                    method: test.method || 'POST',
                    url: `${BASE_URL}${test.endpoint}${test.params ? test.params() : ''}`,
                    headers,
                    timeout: 5000
                };

                if (test.data) {
                    config.data = test.data();
                }

                promises.push(
                    axios(config)
                        .then(() => success++)
                        .catch(() => errors++)
                );
            }

            await Promise.all(promises);
        }

        const endTime = Date.now();
        const totalTime = endTime - startTime;
        const successRate = (success / requests) * 100;
        const rps = requests / (totalTime / 1000);

        console.log(`✅ Sucessos: ${success}/${requests} (${successRate.toFixed(1)}%)`);
        console.log(`❌ Erros: ${errors}`);
        console.log(`⏱️  Tempo: ${totalTime}ms`);
        console.log(`🚀 RPS: ${rps.toFixed(1)}`);
        console.log(`Status: ${successRate >= 95 ? '✅ PASSOU' : '❌ FALHOU'}`);
    }
}

// Função principal
async function main() {
    try {
        // Verificar conectividade primeiro
        console.log('🔍 Verificando conectividade...');
        try {
            await axios.get(`${BASE_URL}/get_redis_stats`, { headers, timeout: 5000 });
            console.log('✅ Conectividade OK\n');
        } catch (error) {
            console.error('❌ Erro de conectividade:', error.message);
            console.log('Verifique se:');
            console.log('1. Redis está rodando (quick-start-redis.bat)');
            console.log('2. Firebase Functions está rodando');
            console.log('3. Token de autenticação é válido');
            return;
        }

        // Executar testes
        await runLoadTest();
        await runDifferentLoadTests();
        await runRedisStressTest();

        console.log('\n🎉 Todos os testes de carga concluídos!');
        
    } catch (error) {
        console.error('❌ Erro durante os testes:', error);
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    main();
}

module.exports = {
    runLoadTest,
    runDifferentLoadTests,
    runRedisStressTest,
    makeRequest
}; 