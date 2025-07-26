// test-simple.cjs - Teste simples da implementação híbrida
async function runTests() {
    console.log('🚀 TESTE SIMPLES DA IMPLEMENTAÇÃO HÍBRIDA REDIS + FIREBASE');
    console.log('='.repeat(60));

    // Teste 1: LocalCacheService
    console.log('\n📋 TESTE 1: LocalCacheService');
    try {
        const LocalCacheService = require('./src/services/LocalCacheService.js');
        const cache = new LocalCacheService();
        
        // Teste básico
        const location = { lat: -23.5505, lng: -46.6333, timestamp: Date.now() };
        const saved = await cache.setLocation('test_user', location);
        console.log('✅ LocalCacheService.setLocation:', saved);
        
        const retrieved = await cache.getLocation('test_user');
        console.log('✅ LocalCacheService.getLocation:', !!retrieved);
        
    } catch (error) {
        console.error('❌ Erro no LocalCacheService:', error.message);
    }

    // Teste 2: SyncService
    console.log('\n📋 TESTE 2: SyncService');
    try {
        const SyncService = require('./src/services/SyncService.js');
        const sync = new SyncService();
        
        await sync.initialize();
        console.log('✅ SyncService.initialize: OK');
        
        const queueId = await sync.queueForSync('location', 'test_user', { lat: -23.5505, lng: -46.6333 });
        console.log('✅ SyncService.queueForSync:', !!queueId);
        
        sync.destroy();
        
    } catch (error) {
        console.error('❌ Erro no SyncService:', error.message);
    }

    // Teste 3: RedisApiService
    console.log('\n📋 TESTE 3: RedisApiService');
    try {
        const { redisApiService } = require('./src/services/RedisApiService.js');
        
        console.log('✅ RedisApiService inicializado');
        
        const cacheStats = await redisApiService.getCacheStats();
        console.log('✅ RedisApiService.getCacheStats:', !!cacheStats);
        
        const syncStats = redisApiService.getSyncStats();
        console.log('✅ RedisApiService.getSyncStats:', !!syncStats);
        
    } catch (error) {
        console.error('❌ Erro no RedisApiService:', error.message);
    }

    // Teste 4: LocationService
    console.log('\n📋 TESTE 4: LocationService');
    try {
        const LocationService = require('./src/services/LocationService.js');
        const locationService = new LocationService();
        
        const initialized = await locationService.initialize();
        console.log('✅ LocationService.initialize:', initialized);
        
        const stats = await locationService.getLocationStats();
        console.log('✅ LocationService.getLocationStats:', !!stats);
        
        locationService.destroy();
        
    } catch (error) {
        console.error('❌ Erro no LocationService:', error.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 TESTE SIMPLES CONCLUÍDO!');
    console.log('='.repeat(60));
}

// Executar testes
runTests(); 