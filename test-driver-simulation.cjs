const io = require('socket.io-client');

console.log('🚗 Iniciando simulação de motorista...');

const driverSocket = io('http://216.238.107.59:3005', {
    transports: ['websocket'],
    timeout: 10000,
    forceNew: true
});

driverSocket.on('connect', () => {
    console.log('✅ Motorista conectado! Socket ID:', driverSocket.id);
    
    // Simular motorista online
    driverSocket.emit('updateDriverStatus', {
        status: 'available',
        isOnline: true
    });
    
    // Atualizar localização do motorista (São Paulo - Centro)
    driverSocket.emit('updateLocation', {
        lat: -23.5505,
        lng: -46.6333
    });
    
    // Verificar estatísticas
    setTimeout(() => {
        driverSocket.emit('getStats');
    }, 1000);
    
    // Manter conexão ativa
    setInterval(() => {
        driverSocket.emit('getStats');
    }, 10000);
});

driverSocket.on('driverStatusUpdated', (data) => {
    console.log('✅ Status do motorista atualizado:', data);
});

driverSocket.on('locationUpdated', (data) => {
    console.log('📍 Localização do motorista atualizada:', data);
});

driverSocket.on('stats', (data) => {
    console.log('📊 Estatísticas do sistema:', data);
});

driverSocket.on('disconnect', () => {
    console.log('🔌 Motorista desconectado');
});

driverSocket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão do motorista:', error.message);
});

// Manter o processo rodando
process.on('SIGINT', () => {
    console.log('\n🔄 Encerrando simulação do motorista...');
    driverSocket.disconnect();
    process.exit(0);
});

console.log('🚗 Motorista simulado rodando. Pressione Ctrl+C para parar.');
