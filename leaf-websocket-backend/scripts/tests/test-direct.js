/**
 * 🧪 TESTE DIRETO - CONEXÃO WEBSOCKET
 */

const io = require('socket.io-client');

console.log('🧪 TESTE DIRETO - CONEXÃO WEBSOCKET');
console.log('='.repeat(50));

// Teste direto de conexão
const socket = io('http://localhost:3001', {
    transports: ['websocket', 'polling'],
    timeout: 10000
});

socket.on('connect', () => {
    console.log('✅ CONECTADO:', socket.id);
    
    // Testar evento básico
    console.log('🧪 Testando createBooking...');
    socket.emit('createBooking', {
        customerId: 'test_customer',
        pickupLocation: { lat: -23.5505, lng: -46.6333 },
        destinationLocation: { lat: -23.5615, lng: -46.6553 },
        estimatedFare: 25.50,
        paymentMethod: 'PIX'
    });
});

socket.on('bookingCreated', (data) => {
    console.log('✅ createBooking funcionou!', data);
    
    // Testar novo evento
    console.log('🧪 Testando setDriverStatus...');
    socket.emit('setDriverStatus', {
        driverId: 'test_driver',
        status: 'online',
        isOnline: true
    });
});

socket.on('driverStatusUpdated', (data) => {
    console.log('✅ setDriverStatus funcionou!', data);
    
    // Testar outro novo evento
    console.log('🧪 Testando searchDrivers...');
    socket.emit('searchDrivers', {
        pickupLocation: { lat: -23.5505, lng: -46.6333 },
        destinationLocation: { lat: -23.5615, lng: -46.6553 },
        rideType: 'standard',
        estimatedFare: 25.50
    });
});

socket.on('driversFound', (data) => {
    console.log('✅ searchDrivers funcionou!', data);
    
    // Testar sistema de suporte
    console.log('🧪 Testando createSupportTicket...');
    socket.emit('createSupportTicket', {
        type: 'technical',
        priority: 'N3',
        description: 'Teste de ticket'
    });
});

socket.on('supportTicketCreated', (data) => {
    console.log('✅ createSupportTicket funcionou!', data);
    
    console.log('\n🎉 TODOS OS NOVOS EVENTOS FUNCIONANDO!');
    console.log('✅ Servidor principal com todos os eventos implementados!');
    
    socket.disconnect();
    process.exit(0);
});

socket.on('connect_error', (error) => {
    console.error('❌ Erro de conexão:', error.message);
    process.exit(1);
});

socket.on('disconnect', () => {
    console.log('🔌 Desconectado');
});

// Timeout
setTimeout(() => {
    console.log('⏰ TIMEOUT');
    socket.disconnect();
    process.exit(1);
}, 15000);






