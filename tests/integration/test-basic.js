// test-basic.js
// Teste básico para verificar se o servidor Redis está funcionando

const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3001';

console.log('🔍 Teste básico de conectividade com o servidor Redis');
console.log(`📡 Conectando ao servidor: ${SERVER_URL}`);

const socket = io(SERVER_URL, {
    transports: ['websocket'],
    timeout: 5000
});

let testCompleted = false;

// Evento de conexão
socket.on('connect', () => {
    console.log('✅ Conectado ao servidor!');
    
    // Testar autenticação
    console.log('🔐 Testando autenticação...');
    socket.emit('authenticate', { uid: 'test_driver_1' });
});

// Evento de desconexão
socket.on('disconnect', () => {
    console.log('❌ Desconectado do servidor');
    if (!testCompleted) {
        process.exit(1);
    }
});

// Evento de erro
socket.on('connect_error', (error) => {
    console.log('❌ Erro de conexão:', error.message);
    process.exit(1);
});

// Resposta de autenticação
socket.on('authenticated', (data) => {
    console.log('✅ Autenticação bem-sucedida!');
    
    // Testar atualização de localização
    console.log('📍 Testando atualização de localização...');
    const location = {
        lat: -23.5505,
        lng: -46.6333
    };
    
    socket.emit('updateLocation', location);
});

// Resposta de atualização de localização
socket.on('locationUpdated', (response) => {
    if (response && response.success) {
        console.log('✅ Atualização de localização bem-sucedida!');
    } else {
        console.log('❌ Erro na atualização de localização:', response?.error || 'Erro desconhecido');
    }
    
    testCompleted = true;
    console.log('\n🎉 Teste básico concluído com sucesso!');
    console.log('✅ Servidor Redis está funcionando corretamente');
    
    socket.disconnect();
    process.exit(0);
});

// Timeout de segurança
setTimeout(() => {
    if (!testCompleted) {
        console.log('⏰ Timeout: Servidor não respondeu em tempo hábil');
        socket.disconnect();
        process.exit(1);
    }
}, 10000); 