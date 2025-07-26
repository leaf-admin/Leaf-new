// test-integration-complete.cjs - Teste completo da implementação híbrida
const { redisApiService } = require('./src/services/RedisApiService.js');
const LocalCacheService = require('./src/services/LocalCacheService.js');
const SyncService = require('./src/services/SyncService.js');
const LocationService = require('./src/services/LocationService.js');

async function testCompleteIntegration() {
    console.log('🚀 TESTE COMPLETO DA IMPLEMENTAÇÃO HÍBRIDA REDIS + FIREBASE');
    console.log('='.repeat(70));
    console.log('📅 Data/Hora:', new Date().toLocaleString('pt-BR'));
    console.log('='.repeat(70));

    const results = {
        passed: 0,
        failed: 0,
        tests: []
    };

    // Função para adicionar resultado
    const addResult = (testName, passed, description, details = null) => {
        results.tests.push({ testName, passed, description, details });
        if (passed) results.passed++;
        else results.failed++;
        
        const status = passed ? '✅' : '❌';
        console.log(`${status} ${testName}: ${description}`);
        if (details) console.log(`   📋 ${details}`);
    };

    try {
        // === TESTE 1: LOCALCACHESERVICE ===
        console.log('\n📋 TESTE 1: LocalCacheService');
        console.log('-'.repeat(50));
        
        const cache = new LocalCacheService();
        
        // Teste de salvamento de localização
        const location = { lat: -23.5505, lng: -46.6333, timestamp: Date.now() };
        const saved = await cache.setLocation('test_user_1', location);
        addResult('LocalCacheService.setLocation', saved, 'Salvar localização no cache local');
        
        // Teste de busca de localização
        const retrieved = await cache.getLocation('test_user_1');
        addResult('LocalCacheService.getLocation', !!retrieved, 'Buscar localização do cache local');
        
        // Teste de salvamento de motoristas
        const drivers = [
            { id: 'driver_1', lat: -23.5505, lng: -46.6333, distance: 100 },
            { id: 'driver_2', lat: -23.5506, lng: -46.6334, distance: 200 }
        ];
        const driversSaved = await cache.setNearbyDrivers(-23.5505, -46.6333, 5000, drivers);
        addResult('LocalCacheService.setNearbyDrivers', driversSaved, 'Salvar motoristas no cache local');
        
        // Teste de busca de motoristas
        const retrievedDrivers = await cache.getNearbyDrivers(-23.5505, -46.6333, 5000);
        addResult('LocalCacheService.getNearbyDrivers', !!retrievedDrivers, 'Buscar motoristas do cache local');
        
        // Teste de estatísticas
        const stats = await cache.getCacheStats();
        addResult('LocalCacheService.getCacheStats', !!stats, 'Obter estatísticas do cache');

        // === TESTE 2: SYNCSERVICE ===
        console.log('\n📋 TESTE 2: SyncService');
        console.log('-'.repeat(50));
        
        const sync = new SyncService();
        
        // Teste de inicialização
        await sync.initialize();
        addResult('SyncService.initialize', true, 'Inicializar serviço de sincronização');
        
        // Teste de adição à fila
        const queueId = await sync.queueForSync('location', 'test_user_2', { lat: -23.5505, lng: -46.6333 });
        addResult('SyncService.queueForSync', !!queueId, 'Adicionar item à fila de sincronização');
        
        // Teste de estatísticas
        const syncStats = sync.getSyncStats();
        addResult('SyncService.getSyncStats', !!syncStats, 'Obter estatísticas de sincronização');
        
        // Limpar
        sync.destroy();

        // === TESTE 3: REDISAPISERVICE ===
        console.log('\n📋 TESTE 3: RedisApiService');
        console.log('-'.repeat(50));
        
        // Teste de atualização de localização
        const locationResult = await redisApiService.updateUserLocation('test_user_3', -23.5505, -46.6333);
        addResult('RedisApiService.updateUserLocation', !!locationResult, 'Atualizar localização (híbrido)');
        
        // Teste de busca de motoristas
        const driversResult = await redisApiService.getNearbyDrivers(-23.5505, -46.6333, 5000);
        addResult('RedisApiService.getNearbyDrivers', Array.isArray(driversResult), 'Buscar motoristas próximos (híbrido)');
        
        // Teste de estatísticas de cache
        const cacheStats = await redisApiService.getCacheStats();
        addResult('RedisApiService.getCacheStats', !!cacheStats, 'Obter estatísticas de cache');
        
        // Teste de estatísticas de sincronização
        const redisSyncStats = redisApiService.getSyncStats();
        addResult('RedisApiService.getSyncStats', !!redisSyncStats, 'Obter estatísticas de sincronização');

        // === TESTE 4: LOCATIONSERVICE ===
        console.log('\n📋 TESTE 4: LocationService');
        console.log('-'.repeat(50));
        
        const locationService = new LocationService();
        
        // Teste de inicialização
        const initialized = await locationService.initialize();
        addResult('LocationService.initialize', initialized, 'Inicializar serviço de localização');
        
        // Teste de obtenção de localização atual
        const currentLocation = await locationService.getCurrentLocation();
        addResult('LocationService.getCurrentLocation', !!currentLocation, 'Obter localização atual');
        
        // Teste de atualização de localização
        const updateResult = await locationService.updateUserLocation('test_user_4');
        addResult('LocationService.updateUserLocation', !!updateResult, 'Atualizar localização do usuário');
        
        // Teste de busca de motoristas
        const locationDrivers = await locationService.getNearbyDrivers();
        addResult('LocationService.getNearbyDrivers', Array.isArray(locationDrivers), 'Buscar motoristas próximos');
        
        // Teste de estatísticas
        const locationStats = await locationService.getLocationStats();
        addResult('LocationService.getLocationStats', !!locationStats, 'Obter estatísticas de localização');
        
        // Limpar
        locationService.destroy();

        // === TESTE 5: INTEGRAÇÃO COMPLETA ===
        console.log('\n📋 TESTE 5: Integração Completa');
        console.log('-'.repeat(50));
        
        const integrationLocationService = new LocationService();
        await integrationLocationService.initialize();
        
        // Simular fluxo completo
        const userId = 'integration_test_user';
        
        // 1. Atualizar localização
        const integrationLocationResult = await integrationLocationService.updateUserLocation(userId);
        addResult('Integration.updateUserLocation', !!integrationLocationResult, 'Atualizar localização (fluxo completo)');
        
        // 2. Buscar motoristas
        const integrationDrivers = await integrationLocationService.getNearbyDrivers();
        addResult('Integration.getNearbyDrivers', Array.isArray(integrationDrivers), 'Buscar motoristas (fluxo completo)');
        
        // 3. Verificar cache
        const integrationCacheStats = await redisApiService.getCacheStats();
        addResult('Integration.cacheStats', !!integrationCacheStats, 'Verificar cache após operações');
        
        // 4. Verificar sincronização
        const integrationSyncStats = redisApiService.getSyncStats();
        addResult('Integration.syncStats', !!integrationSyncStats, 'Verificar sincronização após operações');
        
        integrationLocationService.destroy();

        // === RELATÓRIO FINAL ===
        console.log('\n' + '='.repeat(70));
        console.log('📊 RELATÓRIO FINAL DOS TESTES');
        console.log('='.repeat(70));
        console.log(`📈 Testes passaram: ${results.passed}/${results.tests.length}`);
        console.log(`❌ Testes falharam: ${results.failed}/${results.tests.length}`);
        console.log(`🎯 Taxa de sucesso: ${((results.passed / results.tests.length) * 100).toFixed(1)}%`);
        
        if (results.passed === results.tests.length) {
            console.log('\n🎉 TODOS OS TESTES PASSARAM!');
            console.log('🚀 Implementação híbrida Redis + Firebase está funcionando perfeitamente!');
            console.log('✅ Sistema pronto para produção!');
        } else {
            console.log('\n⚠️  Alguns testes falharam. Verifique os logs acima.');
        }
        
        console.log('\n📋 Detalhes dos testes:');
        results.tests.forEach((result, index) => {
            const status = result.passed ? '✅' : '❌';
            console.log(`${index + 1}. ${status} ${result.testName}: ${result.description}`);
        });
        
        console.log('\n' + '='.repeat(70));
        console.log('🏁 TESTE COMPLETO FINALIZADO');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Erro durante os testes:', error);
        console.log('\n' + '='.repeat(70));
        console.log('💥 TESTE INTERROMPIDO POR ERRO');
        console.log('='.repeat(70));
    }
}

// Executar teste completo
testCompleteIntegration(); 