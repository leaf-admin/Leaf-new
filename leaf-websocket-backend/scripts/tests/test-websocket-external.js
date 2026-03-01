const WebSocket = require('ws');

console.log('Testando WebSocket externo na VPS...');

const ws = new WebSocket('ws://216.238.107.59:3001');

ws.on('open', () => {
    console.log('WebSocket conectado com sucesso na VPS!');
    
    const authData = {
        type: 'auth',
        uid: 'test_user_123',
        token: 'test_token'
    };
    
    ws.send(JSON.stringify(authData));
    
    setTimeout(() => {
        ws.close();
        console.log('Conexao fechada');
    }, 2000);
});

ws.on('message', (data) => {
    try {
        const message = JSON.parse(data);
        console.log('Mensagem recebida:', message);
    } catch (e) {
        console.log('Dados recebidos:', data.toString());
    }
});

ws.on('error', (error) => {
    console.log('Erro WebSocket:', error.message);
});

ws.on('close', () => {
    console.log('Conexao fechada');
});

setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.close();
        console.log('Timeout - fechando conexao');
    }
}, 5000);
