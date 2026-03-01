/**
 * 🐛 TESTE SUPER SIMPLES
 */

const io = require('socket.io-client');

console.log('🐛 TESTE SUPER SIMPLES');

// Criar motorista
const driverSocket = io('http://localhost:3001');

driverSocket.on('connect', () => {
    console.log('🚗 Motorista conectado:', driverSocket.id);
    
    // Listener simples
    driverSocket.on('rideRequest', (data) => {
        console.log('📱 MOTORISTA RECEBEU RIDE REQUEST:', data);
    });
    
    // Listener para TODOS os eventos
    driverSocket.onAny((eventName, ...args) => {
        console.log(`🔍 Motorista recebeu evento: ${eventName}`, args);
    });
});

// Aguardar 2 segundos e criar cliente
setTimeout(() => {
    const customerSocket = io('http://localhost:3001');
    
    customerSocket.on('connect', () => {
        console.log('👤 Cliente conectado:', customerSocket.id);
        
        // Solicitar corrida
        customerSocket.emit('createBooking', {
            customerId: 'test_customer',
            pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Origem' },
            destinationLocation: { lat: -23.5615, lng: -46.6553, address: 'Destino' },
            estimatedFare: 25.50,
            paymentMethod: 'PIX'
        });
        
        console.log('🚗 Corrida solicitada');
    });
    
    // Aguardar 5 segundos e finalizar
    setTimeout(() => {
        console.log('🧹 Finalizando teste...');
        driverSocket.disconnect();
        customerSocket.disconnect();
        process.exit(0);
    }, 5000);
    
}, 2000);






