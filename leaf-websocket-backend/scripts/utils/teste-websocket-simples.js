/**
 * 🔌 TESTE SIMPLES DE WEBSOCKET
 * Teste básico para verificar se o WebSocket está funcionando
 */

const WebSocket = require('ws');

console.log('🔌 TESTANDO CONEXÃO WEBSOCKET...');
console.log('='.repeat(50));

const wsUrl = 'ws://localhost:3001';
console.log(`🌐 Conectando em: ${wsUrl}`);

const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  console.log('✅ WebSocket conectado com sucesso!');
  console.log('📡 Enviando mensagem de teste...');
  
  // Enviar mensagem de teste
  ws.send(JSON.stringify({
    type: 'test',
    message: 'Teste de conexão WebSocket',
    timestamp: Date.now()
  }));
});

ws.on('message', (data) => {
  console.log('📨 Mensagem recebida:', data.toString());
});

ws.on('error', (error) => {
  console.log('❌ Erro no WebSocket:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`🔌 WebSocket fechado: ${code} - ${reason}`);
});

// Timeout para fechar a conexão
setTimeout(() => {
  if (ws.readyState === WebSocket.OPEN) {
    console.log('⏰ Fechando conexão após teste...');
    ws.close();
  }
}, 3000);






