const { io } = require('socket.io-client');

console.log('🔍 TESTANDO SOCKET.IO SIMPLES');
console.log('=============================');

const socket = io('http://localhost:3004');

socket.on('connect', () => {
    console.log('✅ Conectado! ID:', socket.id);
    socket.disconnect();
});

socket.on('connect_error', (error) => {
    console.log('❌ Erro de conexão:', error.message);
});

socket.on('disconnect', () => {
    console.log('🔌 Desconectado');
    process.exit(0);
});

setTimeout(() => {
    console.log('⏰ Timeout - desconectando');
    socket.disconnect();
}, 5000);



