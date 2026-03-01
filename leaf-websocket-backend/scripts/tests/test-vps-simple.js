const io = require('socket.io-client');

console.log('🚀 TESTE VPS SIMPLES...\n');

// Conectar ao WebSocket
const socket = io('http://216.238.107.59:3001', {
    transports: ['polling', 'websocket'], // Polling primeiro como fallback
    timeout: 5000,
    forceNew: true
});

socket.on('connect', () => {
    console.log('✅ WebSocket conectado ao VPS!');
    console.log('🆔 Socket ID:', socket.id);
    console.log('🚚 Transport:', socket.io.engine.transport.name);
    
    // Testar getStats
    console.log('📊 Testando getStats...');
    socket.emit('getStats');
    
    setTimeout(() => {
        console.log('⏰ Finalizando teste...');
        socket.disconnect();
        process.exit(0);
    }, 3000);
});

socket.on('stats', (data) => {
    console.log('📊 Estatísticas recebidas:', data);
});

socket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão:', error.message);
});

socket.on('disconnect', (reason) => {
    console.log('🔌 Desconectado:', reason);
    process.exit(0);
});

setTimeout(() => {
    console.log('❌ Timeout - conexão falhou');
    process.exit(1);
}, 8000);







