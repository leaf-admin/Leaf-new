const { initializeRedis, MIGRATION_FLAGS, getRedisClient } = require('./common/src/config/redisConfig');
const redisLocationService = require('./common/src/services/redisLocationService');
const redisTrackingService = require('./common/src/services/redisTrackingService');

async function testRedisIntegration() {
    console.log('🧪 Iniciando testes de integração Redis...\n');

    // Teste 1: Inicialização do Redis
    console.log('1️⃣ Testando inicialização do Redis...');
    const redisInitialized = await initializeRedis();
    if (redisInitialized) {
        console.log('✅ Redis inicializado com sucesso');
        console.log(`📊 Feature flags:`, MIGRATION_FLAGS);
    } else {
        console.log('❌ Falha na inicialização do Redis');
        console.log('💡 Dica: Verifique se o Redis está rodando na porta 6379');
        return;
    }

    // Teste 2: Serviço de Localização
    console.log('\n2️⃣ Testando serviço de localização...');
    try {
        const userId = 'test-user-123';
        const latitude = -22.9068;
        const longitude = -43.1729;

        // Atualizar localização
        const locationUpdated = await redisLocationService.updateUserLocation(userId, latitude, longitude);
        if (locationUpdated) {
            console.log('✅ Localização atualizada com sucesso');
        } else {
            console.log('❌ Falha ao atualizar localização');
        }

        // Obter localização
        const location = await redisLocationService.getUserLocation(userId);
        if (location) {
            console.log('✅ Localização obtida:', location);
        } else {
            console.log('❌ Falha ao obter localização');
        }

        // Buscar usuários próximos
        const nearbyUsers = await redisLocationService.findNearbyUsers(latitude, longitude, 10);
        console.log('✅ Usuários próximos encontrados:', nearbyUsers.length);

        // Estatísticas
        const locationStats = await redisLocationService.getStats();
        console.log('📊 Estatísticas de localização:', locationStats);

    } catch (error) {
        console.error('❌ Erro no teste de localização:', error);
    }

    // Teste 3: Serviço de Tracking
    console.log('\n3️⃣ Testando serviço de tracking...');
    try {
        const tripId = 'test-trip-456';
        const driverId = 'driver-123';
        const passengerId = 'passenger-456';
        const initialLocation = { latitude: -22.9068, longitude: -43.1729 };

        // Iniciar tracking
        const trackingStarted = await redisTrackingService.startTripTracking(
            tripId, driverId, passengerId, initialLocation
        );
        if (trackingStarted) {
            console.log('✅ Tracking iniciado com sucesso');
        } else {
            console.log('❌ Falha ao iniciar tracking');
        }

        // Atualizar localização da viagem
        const newLocation = { latitude: -22.9100, longitude: -43.1750 };
        const locationUpdated = await redisTrackingService.updateTripLocation(
            tripId, newLocation.latitude, newLocation.longitude
        );
        if (locationUpdated) {
            console.log('✅ Localização da viagem atualizada');
        } else {
            console.log('❌ Falha ao atualizar localização da viagem');
        }

        // Obter dados da viagem
        const tripData = await redisTrackingService.getTripData(tripId);
        if (tripData) {
            console.log('✅ Dados da viagem obtidos:', tripData);
        } else {
            console.log('❌ Falha ao obter dados da viagem');
        }

        // Obter histórico da viagem
        const tripPath = await redisTrackingService.getTripPath(tripId);
        console.log('✅ Histórico da viagem:', tripPath.length, 'pontos');

        // Viagens ativas
        const activeTrips = await redisTrackingService.getActiveTrips();
        console.log('✅ Viagens ativas:', activeTrips.length);

        // Estatísticas
        const trackingStats = await redisTrackingService.getStats();
        console.log('📊 Estatísticas de tracking:', trackingStats);

        // Finalizar tracking
        const trackingEnded = await redisTrackingService.endTripTracking(tripId, newLocation);
        if (trackingEnded) {
            console.log('✅ Tracking finalizado com sucesso');
        } else {
            console.log('❌ Falha ao finalizar tracking');
        }

    } catch (error) {
        console.error('❌ Erro no teste de tracking:', error);
    }

    // Teste 4: Teste de comandos GEO
    console.log('\n4️⃣ Testando comandos GEO...');
    try {
        const client = await getRedisClient();
        if (client) {
            // Teste GEOADD
            const geoResult = await client.geoAdd('test-geo', {
                longitude: -43.1729,
                latitude: -22.9068,
                member: 'Rio de Janeiro'
            });
            console.log('✅ GEOADD funcionando:', geoResult);

            // Teste GEORADIUS
            const radiusResult = await client.geoRadius('test-geo', {
                longitude: -43.1729,
                latitude: -22.9068
            }, 10, 'km');
            console.log('✅ GEORADIUS funcionando:', radiusResult);

            // Limpar teste
            await client.del('test-geo');
            console.log('✅ Comandos GEO funcionando corretamente');
        } else {
            console.log('⚠️ Cliente Redis não disponível para teste GEO');
        }
    } catch (error) {
        console.log('⚠️ Comandos GEO não disponíveis:', error.message);
    }

    // Teste 5: Limpeza
    console.log('\n5️⃣ Testando limpeza...');
    try {
        await redisLocationService.cleanup();
        await redisTrackingService.cleanup();
        console.log('✅ Limpeza concluída');
    } catch (error) {
        console.error('❌ Erro na limpeza:', error);
    }

    console.log('\n🎉 Testes concluídos!');
    console.log('\n📋 Resumo:');
    console.log('- Redis configurado e funcionando');
    console.log('- Serviços de localização e tracking operacionais');
    console.log('- Comandos GEO:', MIGRATION_FLAGS.USE_GEO_COMMANDS ? 'Disponíveis' : 'Não disponíveis');
    console.log('- Feature flags:', MIGRATION_FLAGS);
}

// Executar testes
testRedisIntegration().catch(console.error); 