const io = require('socket.io-client');

console.log('👤 Iniciando simulação de passageiro...');

const passengerSocket = io('http://216.238.107.59:3005', {
    transports: ['websocket'],
    timeout: 10000,
    forceNew: true
});

passengerSocket.on('connect', () => {
    console.log('✅ Passageiro conectado! Socket ID:', passengerSocket.id);
    
    // Simular passageiro online
    passengerSocket.emit('updateLocation', {
        lat: -23.5489,
        lng: -46.6388
    });
    
    // Buscar motoristas próximos
    setTimeout(() => {
        console.log('🔍 Buscando motoristas próximos...');
        passengerSocket.emit('findNearbyDrivers', {
            lat: -23.5489,
            lng: -46.6388,
            radius: 5000,
            limit: 10
        });
    }, 2000);
    
    // Verificar estatísticas
    setTimeout(() => {
        passengerSocket.emit('getStats');
    }, 3000);
    
    // Simular criação de reserva
    setTimeout(() => {
        console.log('📋 Criando reserva...');
        passengerSocket.emit('createBooking', {
            pickup: { lat: -23.5489, lng: -46.6388 },
            destination: { lat: -23.5521, lng: -46.6313 },
            userId: 'passenger_123',
            driverId: null
        });
    }, 4000);
});

passengerSocket.on('locationUpdated', (data) => {
    console.log('📍 Localização do passageiro atualizada:', data);
});

passengerSocket.on('nearbyDrivers', (data) => {
    console.log('🚗 Motoristas encontrados:', data);
});

passengerSocket.on('nearbyDriversError', (data) => {
    console.log('❌ Erro ao buscar motoristas:', data);
});

passengerSocket.on('bookingCreated', (data) => {
    console.log('✅ Reserva criada:', data);
});

passengerSocket.on('bookingError', (data) => {
    console.log('❌ Erro ao criar reserva:', data);
});

passengerSocket.on('stats', (data) => {
    console.log('📊 Estatísticas do sistema:', data);
});

passengerSocket.on('disconnect', () => {
    console.log('🔌 Passageiro desconectado');
});

passengerSocket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão do passageiro:', error.message);
});

// Manter o processo rodando
process.on('SIGINT', () => {
    console.log('\n🔄 Encerrando simulação do passageiro...');
    passengerSocket.disconnect();
    process.exit(0);
});

console.log('👤 Passageiro simulado rodando. Pressione Ctrl+C para parar.');
