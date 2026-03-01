/**
 * 🧪 TESTE BÁSICO - APENAS CONECTAR E VER EVENTOS
 */

const io = require('socket.io-client');

console.log('🧪 TESTE BÁSICO - APENAS CONECTAR E VER EVENTOS');

const socket = io('http://localhost:3001');

socket.on('connect', () => {
    console.log('✅ Conectado:', socket.id);
    
    // Listener para todos os eventos
    socket.onAny((eventName, ...args) => {
        console.log(`📡 Recebido: ${eventName}`, args.length > 0 ? args[0] : 'sem dados');
    });
    
    // Aguardar 5 segundos e desconectar
    setTimeout(() => {
        console.log('🔌 Desconectando...');
        socket.disconnect();
        process.exit(0);
    }, 5000);
});

socket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão:', error);
    process.exit(1);
});

// Timeout de segurança
setTimeout(() => {
    console.log('⏰ Timeout');
    process.exit(1);
}, 10000);






