const io = require('socket.io-client');

console.log('🚀 Testando WebSocket do servidor Leaf...');

// Conectar ao WebSocket
const socket = io('http://216.238.107.59:3001', {
    transports: ['websocket'],
    timeout: 10000
});

socket.on('connect', () => {
    console.log('✅ Conectado ao WebSocket!');
    
    // Teste 1: Solicitar corrida
    console.log('📱 Testando solicitação de corrida...');
    socket.emit('request_ride', {
        passengerId: 'test-passenger-123',
        startLocation: {
            latitude: -23.5505,
            longitude: -46.6333,
            address: 'São Paulo, SP'
        },
        endLocation: {
            latitude: -23.5615,
            longitude: -46.6565,
            address: 'Vila Madalena, SP'
        },
        rideAmount: 25.50
    });
});

socket.on('ride_requested', (data) => {
    console.log('✅ Corrida solicitada:', data);
    
    // Teste 2: Simular motorista encontrado
    console.log('🚗 Simulando motorista encontrado...');
    socket.emit('driver_found', {
        rideId: data.rideId,
        driverId: 'test-driver-456',
        driverLocation: {
            latitude: -23.5505,
            longitude: -46.6333
        },
        estimatedArrivalTime: 5
    });
});

socket.on('driver_found', (data) => {
    console.log('✅ Motorista encontrado:', data);
    
    // Teste 3: Processar pagamento
    console.log('💳 Testando processamento de pagamento...');
    socket.emit('processPayment', {
        rideId: data.rideId,
        amount: 25.50,
        currency: 'BRL',
        paymentMethod: 'pix'
    });
});

socket.on('confirmPayment', (data) => {
    console.log('✅ Pagamento processado:', data);
    console.log('🎉 TODOS OS TESTES PASSARAM!');
    process.exit(0);
});

socket.on('ride_error', (error) => {
    console.error('❌ Erro na corrida:', error);
});

socket.on('payment_error', (error) => {
    console.error('❌ Erro no pagamento:', error);
});

socket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão:', error);
});

socket.on('disconnect', () => {
    console.log('🔌 Desconectado do WebSocket');
});

// Timeout de segurança
setTimeout(() => {
    console.log('⏰ Timeout - encerrando teste');
    process.exit(1);
}, 30000);








