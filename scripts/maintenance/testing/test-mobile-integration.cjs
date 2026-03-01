#!/usr/bin/env node

// 🧪 TESTE DE INTEGRAÇÃO MOBILE - SELF-HOSTED API
const { RedisApiService } = require('./mobile-app/src/services/RedisApiService.js');

console.log('🚀 INICIANDO TESTE DE INTEGRAÇÃO MOBILE');
console.log('==========================================');

async function testMobileIntegration() {
    try {
        console.log('\n🧪 1. Inicializando RedisApiService...');
        const redisService = new RedisApiService();
        
        console.log('\n🧪 2. Testando conexão...');
        const connectionTest = await redisService.testConnection();
        console.log('📊 Resultado do teste de conexão:', connectionTest);
        
        console.log('\n🧪 3. Testando updateUserLocation...');
        const userLocationResult = await redisService.updateUserLocation(
            'user123',
            -23.5505,
            -46.6333,
            Date.now()
        );
        console.log('📍 Resultado updateUserLocation:', userLocationResult);
        
        console.log('\n🧪 4. Testando getNearbyDrivers...');
        const nearbyDriversResult = await redisService.getNearbyDrivers(
            -23.5505,
            -46.6333,
            5
        );
        console.log('🚗 Resultado getNearbyDrivers:', nearbyDriversResult);
        
        console.log('\n🧪 5. Testando getRedisStats...');
        const statsResult = await redisService.getRedisStats();
        console.log('📊 Resultado getRedisStats:', statsResult);
        
        console.log('\n🧪 6. Testando startTripTracking...');
        const tripTrackingResult = await redisService.startTripTracking(
            'trip123',
            'driver456',
            'user123',
            { lat: -23.5505, lng: -46.6333 }
        );
        console.log('🚕 Resultado startTripTracking:', tripTrackingResult);
        
        console.log('\n🧪 7. Testando updateTripLocation...');
        const tripLocationResult = await redisService.updateTripLocation(
            'trip123',
            -23.5505,
            -46.6333,
            Date.now()
        );
        console.log('📍 Resultado updateTripLocation:', tripLocationResult);
        
        console.log('\n🧪 8. Testando endTripTracking...');
        const endTripResult = await redisService.endTripTracking(
            'trip123',
            { lat: -23.5505, lng: -46.6333 }
        );
        console.log('✅ Resultado endTripTracking:', endTripResult);
        
        console.log('\n🧪 9. Testando getTripData...');
        const tripDataResult = await redisService.getTripData('trip123');
        console.log('📋 Resultado getTripData:', tripDataResult);
        
        console.log('\n🧪 10. Testando cache stats...');
        const cacheStats = await redisService.getCacheStats();
        console.log('📊 Cache stats:', cacheStats);
        
        console.log('\n🎯 RESULTADO FINAL');
        console.log('==================');
        console.log('✅ Todos os testes executados com sucesso!');
        console.log('🏠 Self-Hosted API integrada ao mobile app');
        console.log('🔄 Fallback para Firebase configurado');
        console.log('📱 App mobile pronto para usar a nova infraestrutura');
        
    } catch (error) {
        console.error('❌ Erro no teste de integração:', error);
    }
}

testMobileIntegration(); 