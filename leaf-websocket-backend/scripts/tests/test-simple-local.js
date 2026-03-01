const io = require('socket.io-client');

console.log('🚀 TESTE SIMPLES LOCAL...\n');

// Conectar ao WebSocket
const socket = io('http://localhost:3001', {
    transports: ['websocket'],
    timeout: 5000
});

socket.on('connect', () => {
    console.log('✅ WebSocket conectado!');
    
    // Teste 1: Autenticação (sem token válido para testar erro)
    console.log('🔐 Testando autenticação...');
    socket.emit('authenticate', {
        uid: 'test-user-123',
        token: 'invalid-token'
    });
    
    // Teste 2: Solicitar estatísticas (sem autenticação)
    console.log('📊 Testando getStats...');
    socket.emit('getStats');
    
    setTimeout(() => {
        console.log('⏰ Finalizando teste...');
        socket.disconnect();
        process.exit(0);
    }, 3000);
});

socket.on('auth_error', (data) => {
    console.log('❌ Erro de autenticação esperado:', data.message);
});

socket.on('authenticated', (data) => {
    console.log('✅ Autenticado:', data);
});

socket.on('stats', (data) => {
    console.log('📊 Estatísticas recebidas:', data);
});

socket.on('error', (error) => {
    console.error('❌ Erro:', error);
});

socket.on('disconnect', (reason) => {
    console.log('🔌 Desconectado:', reason);
    process.exit(0);
});

setTimeout(() => {
    console.log('❌ Timeout - conexão falhou');
    process.exit(1);
}, 8000);







