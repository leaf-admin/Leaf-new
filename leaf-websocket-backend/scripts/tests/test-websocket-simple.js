const WebSocket = require('ws');

console.log('🔍 TESTANDO WEBSOCKET DIRETO');
console.log('============================');

const ws = new WebSocket('ws://localhost:3004');

ws.on('open', () => {
    console.log('✅ WebSocket conectado com sucesso');
    ws.close();
});

ws.on('error', (error) => {
    console.log('❌ Erro WebSocket:', error.message);
});

ws.on('close', () => {
    console.log('🔌 WebSocket fechado');
    process.exit(0);
});