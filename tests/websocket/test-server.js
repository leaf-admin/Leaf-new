const io = require('socket.io-client');

const socket = io('http://localhost:3001');

console.log('🧪 Testando conexão com o servidor WebSocket...');

socket.on('connect', () => {
  console.log('✅ Conectado ao servidor!');
  
  // Testar autenticação
  socket.emit('authenticate', { uid: 'test-user' });
});

socket.on('authenticated', (data) => {
  console.log('🔐 Autenticado:', data);
  
  // Testar envio de localização
  socket.emit('updateLocation', { lat: -23.5505, lng: -46.6333 });
});

socket.on('locationUpdated', (data) => {
  console.log('📍 Localização atualizada:', data);
  
  // Testar busca de motoristas
  socket.emit('findNearbyDrivers', { lat: -23.5505, lng: -46.6333, radius: 5000, limit: 5 });
});

socket.on('nearbyDrivers', (data) => {
  console.log('🚗 Motoristas próximos:', data);
  
  // Testar estatísticas
  socket.emit('getStats');
});

socket.on('stats', (data) => {
  console.log('📊 Estatísticas:', data);
  
  // Testar ping
  socket.emit('ping', { message: 'test' });
});

socket.on('pong', (data) => {
  console.log('🏓 Pong recebido:', data);
  
  // Desconectar
  setTimeout(() => {
    socket.disconnect();
    console.log('✅ Teste concluído com sucesso!');
    process.exit(0);
  }, 1000);
});

socket.on('connect_error', (error) => {
  console.error('❌ Erro de conexão:', error.message);
  process.exit(1);
});

socket.on('error', (error) => {
  console.error('❌ Erro:', error);
  process.exit(1);
});

// Timeout de 10 segundos
setTimeout(() => {
  console.error('❌ Timeout - servidor não respondeu');
  process.exit(1);
}, 10000); 