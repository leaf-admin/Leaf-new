const WebSocket = require('ws');

console.log('🧪 TESTE SIMPLES WEBSOCKET');
console.log('==========================');

const ws = new WebSocket('ws://localhost:3001');

ws.on('open', function open() {
    console.log('✅ WebSocket conectado com sucesso');
    
    // Teste de autenticação simples
    ws.send(JSON.stringify({
        type: 'authenticate',
        uid: 'test-user-123',
        token: 'test-token'
    }));
    
    setTimeout(() => {
        console.log('🔍 Testando solicitação de corrida...');
        ws.send(JSON.stringify({
            type: 'requestRide',
            origin: { lat: -23.5505, lng: -46.6333 },
            destination: { lat: -23.5615, lng: -46.6565 },
            passengerId: 'test-user-123'
        }));
    }, 1000);
});

ws.on('message', function message(data) {
    try {
        const parsed = JSON.parse(data);
        console.log('📨 Mensagem recebida:', parsed);
    } catch (e) {
        console.log('📨 Mensagem recebida (raw):', data.toString());
    }
});

ws.on('error', function error(err) {
    console.log('❌ Erro WebSocket:', err.message);
});

ws.on('close', function close() {
    console.log('🔌 WebSocket desconectado');
});

// Timeout de 10 segundos
setTimeout(() => {
    console.log('⏰ Timeout do teste');
    ws.close();
    process.exit(0);
}, 10000);





