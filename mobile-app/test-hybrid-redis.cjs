// test-hybrid-redis.cjs - Teste da implementação híbrida Redis + Firebase (CommonJS)
const { redisApiService } = require('./src/services/RedisApiService.js');
const LocalCacheService = require('./src/services/LocalCacheService.js');
const SyncService = require('./src/services/SyncService.js');
const LocationService = require('./src/services/LocationService.js');

class HybridRedisTester {
    constructor() {
        this.testResults = [];
        this.startTime = Date.now();
    }

    // Executar todos os testes
    async runAllTests() {
        console.log('🚀 INICIANDO TESTES DA IMPLEMENTAÇÃO HÍBRIDA REDIS + FIREBASE');
        console.log('='.repeat(60));

        try {
            // Teste 1: LocalCacheService
            await this.testLocalCacheService();
            
            // Teste 2: SyncService
            await this.testSyncService();
            
            // Teste 3: RedisApiService
            await this.testRedisApiService();
            
            // Teste 4: LocationService
            await this.testLocationService();
            
            // Teste 5: Integração completa
            await this.testIntegration();
            
            // Relatório final
            this.generateReport();
            
        } catch (error) {
            console.error('❌ Erro durante os testes:', error);
        }
    }

    // Teste do LocalCacheService
    async testLocalCacheService() {
        console.log('\n📋 TESTE 1: LocalCacheService');
        console.log('-'.repeat(40));
        
        const cache = new LocalCacheService();
        
        try {
            // Teste de salvamento de localização
            const location = { lat: -23.5505, lng: -46.6333, timestamp: Date.now() };
            const saved = await cache.setLocation('test_user_1', location);
            this.addResult('LocalCacheService.setLocation', saved, 'Salvar localização no cache local');
            
            // Teste de busca de localização
            const retrieved = await cache.getLocation('test_user_1');
            this.addResult('LocalCacheService.getLocation', !!retrieved, 'Buscar localização do cache local');
            
            // Teste de salvamento de motoristas
            const drivers = [
                { id: 'driver_1', lat: -23.5505, lng: -46.6333, distance: 100 },
                { id: 'driver_2', lat: -23.5506, lng: -46.6334, distance: 200 }
            ];
            const driversSaved = await cache.setNearbyDrivers(-23.5505, -46.6333, 5000, drivers);
            this.addResult('LocalCacheService.setNearbyDrivers', driversSaved, 'Salvar motoristas no cache local');
            
            // Teste de busca de motoristas
            const retrievedDrivers = await cache.getNearbyDrivers(-23.5505, -46.6333, 5000);
            this.addResult('LocalCacheService.getNearbyDrivers', !!retrievedDrivers, 'Buscar motoristas do cache local');
            
            // Teste de estatísticas
            const stats = await cache.getCacheStats();
            this.addResult('LocalCacheService.getCacheStats', !!stats, 'Obter estatísticas do cache');
            
            console.log('✅ LocalCacheService: Todos os testes passaram');
            
        } catch (error) {
            console.error('❌ Erro no teste LocalCacheService:', error);
            this.addResult('LocalCacheService', false, 'Erro durante teste');
        }
    }

    // Teste do SyncService
    async testSyncService() {
        console.log('\n📋 TESTE 2: SyncService');
        console.log('-'.repeat(40));
        
        const sync = new SyncService();
        
        try {
            // Teste de inicialização
            await sync.initialize();
            this.addResult('SyncService.initialize', true, 'Inicializar serviço de sincronização');
            
            // Teste de adição à fila
            const queueId = await sync.queueForSync('location', 'test_user_2', { lat: -23.5505, lng: -46.6333 });
            this.addResult('SyncService.queueForSync', !!queueId, 'Adicionar item à fila de sincronização');
            
            // Teste de estatísticas
            const stats = sync.getSyncStats();
            this.addResult('SyncService.getSyncStats', !!stats, 'Obter estatísticas de sincronização');
            
            // Limpar
            sync.destroy();
            
            console.log('✅ SyncService: Todos os testes passaram');
            
        } catch (error) {
            console.error('❌ Erro no teste SyncService:', error);
            this.addResult('SyncService', false, 'Erro durante teste');
        }
    }

    // Teste do RedisApiService
    async testRedisApiService() {
        console.log('\n📋 TESTE 3: RedisApiService');
        console.log('-'.repeat(40));
        
        try {
            // Teste de atualização de localização
            const locationResult = await redisApiService.updateUserLocation('test_user_3', -23.5505, -46.6333);
            this.addResult('RedisApiService.updateUserLocation', !!locationResult, 'Atualizar localização (híbrido)');
            
            // Teste de busca de motoristas
            const driversResult = await redisApiService.getNearbyDrivers(-23.5505, -46.6333, 5000);
            this.addResult('RedisApiService.getNearbyDrivers', Array.isArray(driversResult), 'Buscar motoristas próximos (híbrido)');
            
            // Teste de estatísticas de cache
            const cacheStats = await redisApiService.getCacheStats();
            this.addResult('RedisApiService.getCacheStats', !!cacheStats, 'Obter estatísticas de cache');
            
            // Teste de estatísticas de sincronização
            const syncStats = redisApiService.getSyncStats();
            this.addResult('RedisApiService.getSyncStats', !!syncStats, 'Obter estatísticas de sincronização');
            
            console.log('✅ RedisApiService: Todos os testes passaram');
            
        } catch (error) {
            console.error('❌ Erro no teste RedisApiService:', error);
            this.addResult('RedisApiService', false, 'Erro durante teste');
        }
    }

    // Teste do LocationService
    async testLocationService() {
        console.log('\n📋 TESTE 4: LocationService');
        console.log('-'.repeat(40));
        
        const locationService = new LocationService();
        
        try {
            // Teste de inicialização
            const initialized = await locationService.initialize();
            this.addResult('LocationService.initialize', initialized, 'Inicializar serviço de localização');
            
            // Teste de obtenção de localização atual
            const currentLocation = await locationService.getCurrentLocation();
            this.addResult('LocationService.getCurrentLocation', !!currentLocation, 'Obter localização atual');
            
            // Teste de atualização de localização
            const updateResult = await locationService.updateUserLocation('test_user_4');
            this.addResult('LocationService.updateUserLocation', !!updateResult, 'Atualizar localização do usuário');
            
            // Teste de busca de motoristas
            const drivers = await locationService.getNearbyDrivers();
            this.addResult('LocationService.getNearbyDrivers', Array.isArray(drivers), 'Buscar motoristas próximos');
            
            // Teste de estatísticas
            const stats = await locationService.getLocationStats();
            this.addResult('LocationService.getLocationStats', !!stats, 'Obter estatísticas de localização');
            
            // Limpar
            locationService.destroy();
            
            console.log('✅ LocationService: Todos os testes passaram');
            
        } catch (error) {
            console.error('❌ Erro no teste LocationService:', error);
            this.addResult('LocationService', false, 'Erro durante teste');
        }
    }

    // Teste de integração completa
    async testIntegration() {
        console.log('\n📋 TESTE 5: Integração Completa');
        console.log('-'.repeat(40));
        
        try {
            const locationService = new LocationService();
            await locationService.initialize();
            
            // Simular fluxo completo
            const userId = 'integration_test_user';
            
            // 1. Atualizar localização
            const locationResult = await locationService.updateUserLocation(userId);
            this.addResult('Integration.updateUserLocation', !!locationResult, 'Atualizar localização (fluxo completo)');
            
            // 2. Buscar motoristas
            const drivers = await locationService.getNearbyDrivers();
            this.addResult('Integration.getNearbyDrivers', Array.isArray(drivers), 'Buscar motoristas (fluxo completo)');
            
            // 3. Verificar cache
            const cacheStats = await redisApiService.getCacheStats();
            this.addResult('Integration.cacheStats', !!cacheStats, 'Verificar cache após operações');
            
            // 4. Verificar sincronização
            const syncStats = redisApiService.getSyncStats();
            this.addResult('Integration.syncStats', !!syncStats, 'Verificar sincronização após operações');
            
            locationService.destroy();
            
            console.log('✅ Integração: Todos os testes passaram');
            
        } catch (error) {
            console.error('❌ Erro no teste de integração:', error);
            this.addResult('Integration', false, 'Erro durante teste de integração');
        }
    }

    // Adicionar resultado de teste
    addResult(testName, passed, description) {
        this.testResults.push({
            test: testName,
            passed,
            description,
            timestamp: Date.now()
        });
        
        const status = passed ? '✅' : '❌';
        console.log(`${status} ${testName}: ${description}`);
    }

    // Gerar relatório final
    generateReport() {
        const endTime = Date.now();
        const duration = endTime - this.startTime;
        
        const passed = this.testResults.filter(r => r.passed).length;
        const total = this.testResults.length;
        const successRate = ((passed / total) * 100).toFixed(1);
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 RELATÓRIO FINAL DOS TESTES');
        console.log('='.repeat(60));
        console.log(`⏱️  Duração total: ${duration}ms`);
        console.log(`📈 Testes passaram: ${passed}/${total} (${successRate}%)`);
        console.log(`🎯 Taxa de sucesso: ${successRate}%`);
        
        if (passed === total) {
            console.log('\n🎉 TODOS OS TESTES PASSARAM!');
            console.log('🚀 Implementação híbrida Redis + Firebase está funcionando!');
        } else {
            console.log('\n⚠️  Alguns testes falharam. Verifique os logs acima.');
        }
        
        console.log('\n📋 Detalhes dos testes:');
        this.testResults.forEach((result, index) => {
            const status = result.passed ? '✅' : '❌';
            console.log(`${index + 1}. ${status} ${result.test}: ${result.description}`);
        });
        
        console.log('\n' + '='.repeat(60));
    }
}

// Executar testes
const tester = new HybridRedisTester();
tester.runAllTests(); 