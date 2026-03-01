const WebSocket = require('ws');

console.log('🧪 Testando conectividade WebSocket...');

const ws = new WebSocket('ws://localhost:3001');

ws.on('open', () => {
    console.log('✅ WebSocket conectado com sucesso!');
    console.log('📡 Testando autenticação...');
    
    const authData = {
        type: 'auth',
        uid: 'test_user_123',
        token: 'test_token'
    };
    
    ws.send(JSON.stringify(authData));
    
    setTimeout(() => {
        ws.close();
        console.log('🔌 Conexão fechada');
    }, 1000);
});

ws.on('message', (data) => {
    try {
        const message = JSON.parse(data);
        console.log('📨 Mensagem recebida:', message);
    } catch (e) {
        console.log('📨 Dados recebidos:', data.toString());
    }
});

ws.on('error', (error) => {
    console.log('❌ Erro WebSocket:', error.message);
});

ws.on('close', () => {
    console.log('🔌 Conexão fechada');
});

setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.close();
        console.log('⏰ Timeout - fechando conexão');
    }
}, 5000);
