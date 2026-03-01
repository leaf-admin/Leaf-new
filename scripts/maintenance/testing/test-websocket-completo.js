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

// Teste 5: confirmPayment
socket.on('confirmPayment', (data) => {
    console.log('✅ Evento confirmPayment recebido:', data);
});

// Teste 6: createBooking
socket.on('createBooking', (data) => {
    console.log('✅ Evento createBooking recebido:', data);
});

// Teste 7: driverResponse
socket.on('driverResponse', (data) => {
    console.log('✅ Evento driverResponse recebido:', data);
});

// Teste 8: startTrip
socket.on('startTrip', (data) => {
    console.log('✅ Evento startTrip recebido:', data);
});

// Teste 9: updateDriverLocation
socket.on('updateDriverLocation', (data) => {
    console.log('✅ Evento updateDriverLocation recebido:', data);
});

// Teste 10: completeTrip
socket.on('completeTrip', (data) => {
    console.log('✅ Evento completeTrip recebido:', data);
});

// Teste 11: submitRating
socket.on('submitRating', (data) => {
    console.log('✅ Evento submitRating recebido:', data);
});

// Teste 12: getUserRatings
socket.on('getUserRatings', (data) => {
    console.log('✅ Evento getUserRatings recebido:', data);
});

// Teste 13: getTripRatings
socket.on('getTripRatings', (data) => {
    console.log('✅ Evento getTripRatings recebido:', data);
});

// Teste 14: checkUserRating
socket.on('checkUserRating', (data) => {
    console.log('✅ Evento checkUserRating recebido:', data);
});

// Teste 15: create_chat
socket.on('create_chat', (data) => {
    console.log('✅ Evento create_chat recebido:', data);
});

// Teste 16: send_message
socket.on('send_message', (data) => {
    console.log('✅ Evento send_message recebido:', data);
});

// Teste 17: load_messages
socket.on('load_messages', (data) => {
    console.log('✅ Evento load_messages recebido:', data);
});

// Teste 18: mark_messages_read
socket.on('mark_messages_read', (data) => {
    console.log('✅ Evento mark_messages_read recebido:', data);
});

// Teste 19: setTypingStatus
socket.on('setTypingStatus', (data) => {
    console.log('✅ Evento setTypingStatus recebido:', data);
});

// Teste 20: get_user_chats
socket.on('get_user_chats', (data) => {
    console.log('✅ Evento get_user_chats recebido:', data);
});

// Teste 21: get_promos
socket.on('get_promos', (data) => {
    console.log('✅ Evento get_promos recebido:', data);
});

// Teste 22: getUserPromos
socket.on('getUserPromos', (data) => {
    console.log('✅ Evento getUserPromos recebido:', data);
});

// Teste 23: validate_promo_code
socket.on('validate_promo_code', (data) => {
    console.log('✅ Evento validate_promo_code recebido:', data);
});

// Teste 24: apply_promo
socket.on('apply_promo', (data) => {
    console.log('✅ Evento apply_promo recebido:', data);
});

// Teste 25: get_promo_by_code
socket.on('get_promo_by_code', (data) => {
    console.log('✅ Evento get_promo_by_code recebido:', data);
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








