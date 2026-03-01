const io = require('socket.io-client');

console.log('🚀 INICIANDO TESTE WEBSOCKET COMPLETO...\n');

// Conectar ao WebSocket
const socket = io('http://216.238.107.59:3001', {
    transports: ['websocket'],
    timeout: 10000
});

let testResults = {
    connection: false,
    request_ride: false,
    ride_requested: false,
    driver_found: false,
    processPayment: false,
    errors: []
};

// Teste de Conexão
socket.on('connect', () => {
    console.log('✅ WebSocket conectado com sucesso!');
    testResults.connection = true;
    
    // Teste 1: request_ride
    console.log('\n📱 Testando evento request_ride...');
    socket.emit('request_ride', {
        passengerId: 'test-passenger-123',
        pickupLocation: {
            latitude: -23.5505,
            longitude: -46.6333,
            address: 'Praça da Sé, São Paulo'
        },
        destinationLocation: {
            latitude: -23.5615,
            longitude: -46.6565,
            address: 'Avenida Paulista, São Paulo'
        },
        rideType: 'standard',
        estimatedFare: 25.90,
        paymentMethod: 'pix'
    });
});

// Teste 2: ride_requested
socket.on('ride_requested', (data) => {
    console.log('✅ Evento ride_requested recebido:', data);
    testResults.ride_requested = true;
});

// Teste 3: driver_found
socket.on('driver_found', (data) => {
    console.log('✅ Evento driver_found recebido:', data);
    testResults.driver_found = true;
});

// Teste 4: processPayment
socket.on('processPayment', (data) => {
    console.log('✅ Evento processPayment recebido:', data);
    testResults.processPayment = true;
});

// Tratamento de erros
socket.on('error', (error) => {
    console.error('❌ Erro no WebSocket:', error);
    testResults.errors.push(error);
});

socket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão:', error);
    testResults.errors.push(error);
});

socket.on('disconnect', (reason) => {
    console.log('🔌 WebSocket desconectado:', reason);
});

// Timeout para finalizar teste
setTimeout(() => {
    console.log('\n📊 RESULTADOS DO TESTE:');
    console.log('========================');
    console.log(`✅ Conexão: ${testResults.connection ? 'SUCESSO' : 'FALHA'}`);
    console.log(`✅ request_ride: ${testResults.request_ride ? 'SUCESSO' : 'FALHA'}`);
    console.log(`✅ ride_requested: ${testResults.ride_requested ? 'SUCESSO' : 'FALHA'}`);
    console.log(`✅ driver_found: ${testResults.driver_found ? 'SUCESSO' : 'FALHA'}`);
    console.log(`✅ processPayment: ${testResults.processPayment ? 'SUCESSO' : 'FALHA'}`);
    
    if (testResults.errors.length > 0) {
        console.log('\n❌ ERROS ENCONTRADOS:');
        testResults.errors.forEach((error, index) => {
            console.log(`${index + 1}. ${error}`);
        });
    }
    
    console.log('\n🏁 Teste finalizado!');
    process.exit(0);
}, 15000); // 15 segundos de teste
