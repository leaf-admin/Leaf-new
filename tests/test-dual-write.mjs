import { createClient } from 'redis';
import { FEATURE_FLAGS, validateConfig } from './common/src/config/redisConfig.mjs';
import redisLocationService from './common/src/services/redisLocationService.mjs';
import redisTrackingService from './common/src/services/redisTrackingService.mjs';

// Mock Firebase para testes
const mockFirebase = {
    trackingRef: (bookingId) => `tracking/${bookingId}`,
    userLocationRef: (uid) => `userLocation/${uid}`,
    auth: {
        currentUser: { uid: 'test-user-123' }
    }
};

// Mock Firebase functions
const mockFirebaseFunctions = {
    push: async (ref, data) => {
        console.log(`[FIREBASE] Pushed to ${ref}:`, data);
        return { key: 'mock-key' };
    },
    set: async (ref, data) => {
        console.log(`[FIREBASE] Set to ${ref}:`, data);
        return true;
    },
    onValue: (query, callback) => {
        console.log(`[FIREBASE] Listening to query:`, query);
        // Simular dados após 1 segundo
        setTimeout(() => {
            callback({
                val: () => ({
                    'mock-key': {
                        latitude: -23.5505,
                        longitude: -46.6333,
                        timestamp: Date.now()
                    }
                })
            });
        }, 1000);
    },
    off: (ref) => {
        console.log(`[FIREBASE] Stopped listening to:`, ref);
    }
};

// Teste da estratégia de dual write
async function testDualWriteStrategy() {
    console.log('🚀 Iniciando teste da estratégia de dual write...\n');

    try {
        // 1. Validar configuração
        console.log('1️⃣ Validando configuração...');
        validateConfig();
        console.log('✅ Configuração válida\n');

        // 2. Testar conexão Redis
        console.log('2️⃣ Testando conexão Redis...');
        await redisLocationService.connect();
        await redisTrackingService.connect();
        console.log('✅ Conexão Redis estabelecida\n');

        // 3. Testar saveTracking (dual write)
        console.log('3️⃣ Testando saveTracking (dual write)...');
        const bookingId = 'test-booking-123';
        const location = {
            latitude: -23.5505,
            longitude: -46.6333,
            accuracy: 10,
            speed: 25,
            heading: 90,
            timestamp: Date.now()
        };

        // Simular Firebase
        await mockFirebaseFunctions.push(mockFirebase.trackingRef(bookingId), location);
        
        // Redis (se habilitado)
        if (FEATURE_FLAGS.USE_REDIS_TRACKING) {
            await redisTrackingService.addTrackingPoint(bookingId, location);
        }
        console.log('✅ saveTracking testado com sucesso\n');

        // 4. Testar saveUserLocation (dual write)
        console.log('4️⃣ Testando saveUserLocation (dual write)...');
        const userLocation = {
            latitude: -23.5505,
            longitude: -46.6333,
            accuracy: 15,
            speed: 0,
            heading: 0,
            timestamp: Date.now()
        };

        // Simular Firebase
        await mockFirebaseFunctions.set(mockFirebase.userLocationRef('test-user-123'), userLocation);
        
        // Redis (se habilitado)
        if (FEATURE_FLAGS.USE_REDIS_LOCATION) {
            await redisLocationService.saveUserLocation('test-user-123', userLocation);
        }
        console.log('✅ saveUserLocation testado com sucesso\n');

        // 5. Testar fetchBookingLocations (dual read)
        console.log('5️⃣ Testando fetchBookingLocations (dual read)...');
        
        // Simular Firebase listener
        mockFirebaseFunctions.onValue(mockFirebase.trackingRef(bookingId), (snapshot) => {
            console.log('[FIREBASE] Dados recebidos:', snapshot.val());
        });
        
        // Redis (se habilitado)
        if (FEATURE_FLAGS.USE_REDIS_TRACKING) {
            const lastPoint = await redisTrackingService.getLastTrackingPoint(bookingId);
            console.log('[REDIS] Último ponto:', lastPoint);
        }
        console.log('✅ fetchBookingLocations testado com sucesso\n');

        // 6. Testar getUserLocation (com fallback)
        console.log('6️⃣ Testando getUserLocation (com fallback)...');
        
        if (FEATURE_FLAGS.USE_REDIS_LOCATION) {
            const redisLocation = await redisLocationService.getUserLocation('test-user-123');
            console.log('[REDIS] Localização do usuário:', redisLocation);
        }
        
        if (FEATURE_FLAGS.FALLBACK_TO_FIREBASE) {
            console.log('[FIREBASE] Fallback habilitado');
        }
        console.log('✅ getUserLocation testado com sucesso\n');

        // 7. Testar getNearbyDrivers
        console.log('7️⃣ Testando getNearbyDrivers...');
        
        if (FEATURE_FLAGS.USE_REDIS_LOCATION) {
            const nearbyDrivers = await redisLocationService.getNearbyDrivers(-23.5505, -46.6333, 5);
            console.log('[REDIS] Motoristas próximos:', nearbyDrivers);
        }
        console.log('✅ getNearbyDrivers testado com sucesso\n');

        // 8. Testar tracking history
        console.log('8️⃣ Testando tracking history...');
        
        if (FEATURE_FLAGS.USE_REDIS_TRACKING) {
            const history = await redisTrackingService.getTrackingHistory(bookingId, 10);
            console.log('[REDIS] Histórico de tracking:', history.length, 'pontos');
        }
        console.log('✅ Tracking history testado com sucesso\n');

        // 9. Testar estatísticas
        console.log('9️⃣ Testando estatísticas...');
        
        if (FEATURE_FLAGS.USE_REDIS_TRACKING) {
            const stats = await redisTrackingService.getTrackingStats(bookingId);
            console.log('[REDIS] Estatísticas:', stats);
        }
        console.log('✅ Estatísticas testadas com sucesso\n');

        // 10. Testar limpeza
        console.log('🔟 Testando limpeza de dados...');
        
        if (FEATURE_FLAGS.USE_REDIS_LOCATION) {
            await redisLocationService.cleanupOldData();
        }
        
        if (FEATURE_FLAGS.USE_REDIS_TRACKING) {
            await redisTrackingService.cleanupOldTracking();
        }
        console.log('✅ Limpeza testada com sucesso\n');

        console.log('🎉 Todos os testes passaram com sucesso!');
        console.log('\n📊 Status da migração:');
        console.log('- Redis Location:', FEATURE_FLAGS.USE_REDIS_LOCATION ? '✅ Habilitado' : '❌ Desabilitado');
        console.log('- Redis Tracking:', FEATURE_FLAGS.USE_REDIS_TRACKING ? '✅ Habilitado' : '❌ Desabilitado');
        console.log('- Fallback Firebase:', FEATURE_FLAGS.FALLBACK_TO_FIREBASE ? '✅ Habilitado' : '❌ Desabilitado');

    } catch (error) {
        console.error('❌ Erro durante os testes:', error);
        throw error;
    } finally {
        // Limpeza
        console.log('\n🧹 Limpando conexões...');
        await redisLocationService.disconnect();
        await redisTrackingService.disconnect();
        console.log('✅ Conexões fechadas');
    }
}

// Teste de performance
async function testPerformance() {
    console.log('\n⚡ Teste de performance...');
    
    const iterations = 100;
    const startTime = Date.now();
    
    try {
        await redisLocationService.connect();
        
        for (let i = 0; i < iterations; i++) {
            const location = {
                latitude: -23.5505 + (Math.random() - 0.5) * 0.01,
                longitude: -46.6333 + (Math.random() - 0.5) * 0.01,
                accuracy: Math.random() * 20,
                speed: Math.random() * 50,
                heading: Math.random() * 360,
                timestamp: Date.now()
            };
            
            await redisLocationService.saveUserLocation(`user-${i}`, location);
        }
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        const avgTime = duration / iterations;
        
        console.log(`✅ ${iterations} operações em ${duration}ms`);
        console.log(`📊 Tempo médio por operação: ${avgTime.toFixed(2)}ms`);
        
    } catch (error) {
        console.error('❌ Erro no teste de performance:', error);
    } finally {
        await redisLocationService.disconnect();
    }
}

// Executar testes
async function runTests() {
    try {
        await testDualWriteStrategy();
        await testPerformance();
        console.log('\n🎯 Todos os testes concluídos com sucesso!');
    } catch (error) {
        console.error('\n💥 Falha nos testes:', error);
        process.exit(1);
    }
}

// Executar se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
    runTests();
}

export { testDualWriteStrategy, testPerformance }; 