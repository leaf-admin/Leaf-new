const WebSocket = require('ws');

console.log('Teste WebSocket minimo...');

const ws = new WebSocket('wss://socket.leaf.app.br/socket.io/?EIO=4&transport=websocket');

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
