import { FEATURE_FLAGS } from './common/src/config/redisConfig.mjs';
import redisLocationService from './common/src/services/redisLocationService.mjs';
import redisTrackingService from './common/src/services/redisTrackingService.mjs';

console.log('🚀 Iniciando teste da dual write strategy...');

async function testDualWrite() {
    try {
        // 1. Conectar aos serviços Redis
        console.log('1️⃣ Conectando aos serviços Redis...');
        await redisLocationService.connect();
        await redisTrackingService.connect();
        console.log('✅ Conexões estabelecidas\n');

        // 2. Testar saveUserLocation
        console.log('2️⃣ Testando saveUserLocation...');
        const testLocation = {
            latitude: -23.5505,
            longitude: -46.6333,
            accuracy: 10,
            speed: 25,
            heading: 90,
            timestamp: Date.now()
        };

        await redisLocationService.saveUserLocation('test-user-123', testLocation);
        console.log('✅ saveUserLocation executado\n');

        // 3. Testar addTrackingPoint
        console.log('3️⃣ Testando addTrackingPoint...');
        const trackingPoint = {
            latitude: -23.5505,
            longitude: -46.6333,
            accuracy: 10,
            speed: 25,
            heading: 90,
            timestamp: Date.now()
        };

        await redisTrackingService.addTrackingPoint('test-booking-123', trackingPoint);
        console.log('✅ addTrackingPoint executado\n');

        // 4. Testar recuperação de dados
        console.log('4️⃣ Testando recuperação de dados...');
        const userLocation = await redisLocationService.getUserLocation('test-user-123');
        console.log('📍 Localização do usuário:', userLocation);

        const lastPoint = await redisTrackingService.getLastTrackingPoint('test-booking-123');
        console.log('📍 Último ponto de tracking:', lastPoint);

        const history = await redisTrackingService.getTrackingHistory('test-booking-123', 10);
        console.log('📍 Histórico de tracking:', history.length, 'pontos');
        console.log('✅ Recuperação de dados executada\n');

        // 5. Testar motoristas próximos
        console.log('5️⃣ Testando getNearbyDrivers...');
        const nearbyDrivers = await redisLocationService.getNearbyDrivers(-23.5505, -46.6333, 5);
        console.log('🚗 Motoristas próximos:', nearbyDrivers.length);
        console.log('✅ getNearbyDrivers executado\n');

        // 6. Testar estatísticas
        console.log('6️⃣ Testando estatísticas...');
        const stats = await redisTrackingService.getTrackingStats('test-booking-123');
        console.log('📊 Estatísticas:', stats);
        console.log('✅ Estatísticas executadas\n');

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

// Executar teste
testDualWrite().catch(console.error); 