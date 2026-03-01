const io = require('socket.io-client');

console.log('🧪 TESTE SOCKET.IO');
console.log('==================');

const socket = io('http://localhost:3001');

socket.on('connect', () => {
    console.log('✅ Socket.IO conectado com sucesso');
    console.log('🆔 Socket ID:', socket.id);
    
    // Teste de autenticação
    socket.emit('authenticate', {
        uid: 'test-user-123',
        token: 'test-token'
    });
});

socket.on('authenticated', (data) => {
    console.log('✅ Autenticação bem-sucedida:', data);
    
    // Teste de solicitação de corrida
    setTimeout(() => {
        console.log('🔍 Testando solicitação de corrida...');
        socket.emit('requestRide', {
            origin: { lat: -23.5505, lng: -46.6333 },
            destination: { lat: -23.5615, lng: -46.6565 },
            passengerId: 'test-user-123'
        });
    }, 1000);
});

socket.on('auth_error', (error) => {
    console.log('❌ Erro de autenticação:', error);
});

socket.on('rideRequested', (data) => {
    console.log('✅ Solicitação de corrida enviada:', data);
});

socket.on('disconnect', () => {
    console.log('🔌 Socket.IO desconectado');
});

socket.on('error', (error) => {
    console.log('❌ Erro Socket.IO:', error);
});

// Timeout de 15 segundos
setTimeout(() => {
    console.log('⏰ Timeout do teste');
    socket.disconnect();
    process.exit(0);
}, 15000);





