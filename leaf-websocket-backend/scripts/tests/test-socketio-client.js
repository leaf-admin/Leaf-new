const { io } = require('socket.io-client');

console.log('🔍 TESTANDO SOCKET.IO CLIENT');
console.log('============================');

const socket = io('http://localhost:3004', {
    transports: ['polling', 'websocket']
});

socket.on('connect', () => {
    console.log('✅ Socket.IO conectado com sucesso');
    console.log('🆔 Socket ID:', socket.id);
    
    // Testar autenticação
    socket.emit('authenticate', { token: 'test-token' });
});

socket.on('authenticated', (data) => {
    console.log('✅ Autenticação recebida:', data);
});

socket.on('auth_error', (error) => {
    console.log('❌ Erro de autenticação:', error);
});

socket.on('disconnect', () => {
    console.log('🔌 Socket.IO desconectado');
    process.exit(0);
});

socket.on('error', (error) => {
    console.log('❌ Erro Socket.IO:', error);
});

// Timeout para fechar
setTimeout(() => {
    socket.disconnect();
}, 3000);



