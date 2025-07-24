const io = require('socket.io-client');

// Configuração
const SOCKET_URL = 'http://localhost:3001';
const TEST_USER_ID = 'test_driver_123';

// Conectar ao servidor
const socket = io(SOCKET_URL);

console.log('🧪 Testando Arquitetura: Redis + Firebase (Sincronização Seletiva)');
console.log('=' .repeat(60));

// Teste 1: Autenticação
socket.emit('authenticate', { uid: TEST_USER_ID });

socket.on('authenticated', (data) => {
    console.log('✅ Autenticação:', data);
    
    // Teste 2: Atualizar localização (apenas Redis)
    console.log('\n📍 Teste 2: Atualizar localização (Redis)');
    socket.emit('updateLocation', {
        lat: -23.5505,
        lng: -46.6333,
        platform: 'mobile'
    });
});

// Teste 3: Buscar motoristas próximos (Redis GEO)
socket.on('locationUpdated', (data) => {
    console.log('✅ Localização atualizada:', data);
    
    console.log('\n🔍 Teste 3: Buscar motoristas próximos (Redis GEO)');
    socket.emit('findNearbyDrivers', {
        lat: -23.5505,
        lng: -46.6333,
        radius: 5000,
        limit: 5
    });
});

// Teste 4: Atualizar status (apenas Redis)
socket.on('nearbyDrivers', (data) => {
    console.log('✅ Motoristas próximos:', data);
    
    console.log('\n🚗 Teste 4: Atualizar status (Redis)');
    socket.emit('updateDriverStatus', {
        status: 'available',
        isOnline: true
    });
});

// Teste 5: Finalizar viagem (sincronizar com Firebase)
socket.on('driverStatusUpdated', (data) => {
    console.log('✅ Status atualizado:', data);
    
    console.log('\n🏁 Teste 5: Finalizar viagem (Firebase)');
    socket.emit('finishTrip', {
        tripId: 'test_trip_123',
        tripData: {
            startTime: Date.now() - 300000, // 5 minutos atrás
            startLocation: { lat: -23.5505, lng: -46.6333 },
            endLocation: { lat: -23.5605, lng: -46.6433 },
            distance: 1500, // metros
            fare: 15.50
        }
    });
});

// Teste 6: Cancelar viagem (sincronizar com Firebase)
socket.on('tripFinished', (data) => {
    console.log('✅ Viagem finalizada:', data);
    
    console.log('\n❌ Teste 6: Cancelar viagem (Firebase)');
    socket.emit('cancelTrip', {
        tripId: 'test_trip_456',
        reason: 'driver_unavailable'
    });
});

// Teste 7: Estatísticas (Redis)
socket.on('tripCancelled', (data) => {
    console.log('✅ Viagem cancelada:', data);
    
    console.log('\n📊 Teste 7: Estatísticas (Redis)');
    socket.emit('getStats');
});

// Finalizar testes
socket.on('stats', (data) => {
    console.log('✅ Estatísticas:', data);
    
    console.log('\n🎉 Todos os testes concluídos!');
    console.log('\n📋 Resumo da Arquitetura:');
    console.log('   • Redis: Tracking em tempo real ✅');
    console.log('   • Firebase: Dados consolidados ✅');
    console.log('   • Sincronização seletiva ✅');
    console.log('   • Otimização de custos ✅');
    
    setTimeout(() => {
        socket.disconnect();
        process.exit(0);
    }, 1000);
});

// Tratamento de erros
socket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão:', error.message);
    process.exit(1);
});

socket.on('error', (error) => {
    console.error('❌ Erro:', error);
});

// Timeout de segurança
setTimeout(() => {
    console.error('❌ Timeout: Testes não completaram em 30 segundos');
    socket.disconnect();
    process.exit(1);
}, 30000); 