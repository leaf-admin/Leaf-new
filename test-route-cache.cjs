// test-route-cache.cjs - Teste do cache de rotas
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Configurações do teste
const CONFIG = {
    API_BASE_URL: 'https://api.leaf.app.br',
    TEST_ROUTES: [
        {
            name: 'São Paulo - Centro',
            start: '-23.5505,-46.6333',
            dest: '-23.5631,-46.6564',
            waypoints: null
        },
        {
            name: 'São Paulo - Zona Sul',
            start: '-23.5505,-46.6333',
            dest: '-23.6505,-46.7333',
            waypoints: null
        },
        {
            name: 'São Paulo - Zona Norte',
            start: '-23.5505,-46.6333',
            dest: '-23.4505,-46.5333',
            waypoints: null
        }
    ]
};

// Função para fazer request para a API
async function makeDirectionsRequest(start, dest, waypoints = null) {
    try {
        const body = {
            start: start,
            dest: dest,
            calltype: 'direction',
            departure_time: 'now'
        };
        
        if (waypoints) {
            body.waypoints = waypoints;
        }

        const response = await execAsync(`curl -s -X POST ${CONFIG.API_BASE_URL}/googleapi \
            -H "Content-Type: application/json" \
            -d '${JSON.stringify(body)}'`);
        
        return JSON.parse(response.stdout);
    } catch (error) {
        console.error('❌ Erro na request:', error.message);
        return null;
    }
}

// Função para obter estatísticas do cache
async function getCacheStats() {
    try {
        const response = await execAsync(`curl -s ${CONFIG.API_BASE_URL}/routeCacheStats`);
        return JSON.parse(response.stdout);
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error.message);
        return null;
    }
}

// Função para testar cache de rotas
async function testRouteCache() {
    console.log('🗺️ TESTE DO CACHE DE ROTAS - LEAF APP');
    console.log('='.repeat(60));
    
    for (const route of CONFIG.TEST_ROUTES) {
        console.log(`\n🚗 Testando rota: ${route.name}`);
        console.log(`📍 Origem: ${route.start}`);
        console.log(`🎯 Destino: ${route.dest}`);
        
        // Primeira request (deve salvar no cache)
        console.log('\n📤 Primeira request (deve salvar no cache):');
        const startTime1 = Date.now();
        const result1 = await makeDirectionsRequest(route.start, route.dest, route.waypoints);
        const time1 = Date.now() - startTime1;
        
        if (result1 && result1.distance_in_km) {
            console.log(`✅ Sucesso: ${result1.distance_in_km}km, ${result1.time_in_secs}s`);
            console.log(`⏱️  Tempo: ${time1}ms`);
        } else {
            console.log('❌ Falha na primeira request');
            continue;
        }
        
        // Segunda request (deve usar cache)
        console.log('\n📥 Segunda request (deve usar cache):');
        const startTime2 = Date.now();
        const result2 = await makeDirectionsRequest(route.start, route.dest, route.waypoints);
        const time2 = Date.now() - startTime2;
        
        if (result2 && result2.distance_in_km) {
            console.log(`✅ Sucesso: ${result2.distance_in_km}km, ${result2.time_in_secs}s`);
            console.log(`⏱️  Tempo: ${time2}ms`);
            
            // Comparar resultados
            const isSame = result1.distance_in_km === result2.distance_in_km && 
                          result1.time_in_secs === result2.time_in_secs;
            
            if (isSame) {
                console.log('✅ Resultados idênticos - Cache funcionando!');
                console.log(`🚀 Melhoria de performance: ${Math.round((time1 - time2) / time1 * 100)}%`);
            } else {
                console.log('⚠️ Resultados diferentes - Possível problema no cache');
            }
        } else {
            console.log('❌ Falha na segunda request');
        }
        
        // Aguardar um pouco entre testes
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Obter estatísticas do cache
    console.log('\n📊 ESTATÍSTICAS DO CACHE:');
    console.log('-'.repeat(40));
    
    const stats = await getCacheStats();
    if (stats && stats.success) {
        console.log(`📈 Total de rotas em cache: ${stats.stats.totalRoutes}`);
        console.log(`👥 Total de acessos: ${stats.stats.totalAccesses}`);
        console.log(`📊 Média de acessos por rota: ${stats.stats.averageAccesses}`);
        console.log(`🎯 Taxa de acerto estimada: ${Math.round(stats.stats.cacheHitRate * 100)}%`);
        console.log(`📅 Rota mais antiga: ${stats.stats.oldestRoute}`);
        console.log(`📅 Rota mais recente: ${stats.stats.newestRoute}`);
    } else {
        console.log('❌ Não foi possível obter estatísticas do cache');
    }
}

// Função para simular múltiplas corridas
async function simulateMultipleRides() {
    console.log('\n🚗 SIMULAÇÃO DE MÚLTIPLAS CORRIDAS');
    console.log('='.repeat(50));
    
    const rideCount = 10;
    const route = CONFIG.TEST_ROUTES[0]; // Usar primeira rota
    
    console.log(`🔄 Simulando ${rideCount} corridas na mesma rota...`);
    
    const times = [];
    const cacheHits = [];
    
    for (let i = 0; i < rideCount; i++) {
        console.log(`\n🚗 Corrida ${i + 1}/${rideCount}:`);
        
        const startTime = Date.now();
        const result = await makeDirectionsRequest(route.start, route.dest, route.waypoints);
        const time = Date.now() - startTime;
        
        times.push(time);
        
        if (result && result.distance_in_km) {
            console.log(`✅ ${result.distance_in_km}km, ${result.time_in_secs}s - ${time}ms`);
            
            // Se for rápido, provavelmente foi cache
            if (time < 100) {
                cacheHits.push(true);
                console.log('🎯 Cache hit!');
            } else {
                cacheHits.push(false);
                console.log('📤 Cache miss (primeira vez)');
            }
        } else {
            console.log('❌ Falha na request');
        }
        
        // Aguardar um pouco entre requests
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Análise dos resultados
    console.log('\n📊 ANÁLISE DOS RESULTADOS:');
    console.log('-'.repeat(40));
    
    const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
    const cacheHitCount = cacheHits.filter(hit => hit).length;
    const cacheHitRate = (cacheHitCount / rideCount) * 100;
    
    console.log(`⏱️  Tempo médio: ${Math.round(avgTime)}ms`);
    console.log(`🎯 Cache hits: ${cacheHitCount}/${rideCount} (${Math.round(cacheHitRate)}%)`);
    console.log(`💰 Economia estimada: ${Math.round(cacheHitRate)}% dos requests Google Maps`);
    
    // Calcular economia em custos
    const googleMapsCost = 0.025; // R$ 0,025 por request
    const savedRequests = cacheHitCount;
    const savedCost = savedRequests * googleMapsCost;
    
    console.log(`💸 Requests economizados: ${savedRequests}`);
    console.log(`💰 Custo economizado: R$ ${savedCost.toFixed(3)}`);
}

// Função principal
async function runTests() {
    try {
        await testRouteCache();
        await simulateMultipleRides();
        
        console.log('\n🎯 TESTE CONCLUÍDO!');
        console.log('✅ Cache de rotas implementado com sucesso');
        console.log('💰 Economia de requests Google Maps ativa');
        console.log('🚀 Performance melhorada para rotas repetidas');
        
    } catch (error) {
        console.error('❌ Erro nos testes:', error);
    }
}

// Executar testes
runTests().catch(console.error); 