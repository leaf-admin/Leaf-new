const io = require('socket.io-client');

console.log('🚀 TESTE WEBSOCKET SIMPLES...\n');

const socket = io('http://localhost:3001', {
    transports: ['websocket'],
    timeout: 5000
});

socket.on('connect', () => {
    console.log('✅ Conectado!');
    
    // Testar evento simples
    console.log('�� Enviando request_ride...');
    socket.emit('request_ride', {
        passengerId: 'test-123',
        pickupLocation: { latitude: -23.5505, longitude: -46.6333 },
        destinationLocation: { latitude: -23.5615, longitude: -46.6565 }
    });
});

socket.on('ride_requested', (data) => {
    console.log('✅ ride_requested recebido:', data);
});

socket.on('driver_found', (data) => {
    console.log('✅ driver_found recebido:', data);
});

socket.on('error', (error) => {
    console.error('❌ Erro:', error);
});

socket.on('disconnect', (reason) => {
    console.log('🔌 Desconectado:', reason);
});

setTimeout(() => {
    console.log('🏁 Teste finalizado!');
    process.exit(0);
}, 10000);
