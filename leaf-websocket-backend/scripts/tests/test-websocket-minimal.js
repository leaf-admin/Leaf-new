const WebSocket = require('ws');

console.log('Teste WebSocket minimo...');

const ws = new WebSocket('ws://147.182.204.181:3001');

ws.on('open', () => {
    console.log('Conectado!');
    ws.close();
});

ws.on('error', (error) => {
    console.log('Erro:', error.message);
});

ws.on('close', () => {
    console.log('Fechado');
});

setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
}, 3000);
