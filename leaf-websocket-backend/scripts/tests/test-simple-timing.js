/**
 * 🐛 TESTE SIMPLES - DRIVER PRIMEIRO, DEPOIS CUSTOMER
 */

const io = require('socket.io-client');

console.log('🐛 TESTE SIMPLES - DRIVER PRIMEIRO, DEPOIS CUSTOMER');

// 1. Conectar driver primeiro
const driverSocket = io('http://localhost:3001');

driverSocket.on('connect', () => {
    console.log('🚗 DRIVER conectado:', driverSocket.id);
    
    // Listener para rideRequest
    driverSocket.on('rideRequest', (data) => {
        console.log('🎯 DRIVER RECEBEU rideRequest:', data);
    });
    
    // Listener para todos os eventos
    driverSocket.onAny((eventName, ...args) => {
        console.log(`🔍 DRIVER recebeu: ${eventName}`, args.length > 0 ? args[0] : 'sem dados');
    });
    
    // Aguardar 3 segundos e conectar customer
    setTimeout(() => {
        console.log('\n👤 Conectando CUSTOMER...');
        
        const customerSocket = io('http://localhost:3001');
        
        customerSocket.on('connect', () => {
            console.log('👤 CUSTOMER conectado:', customerSocket.id);
            
            // Aguardar 2 segundos e solicitar corrida
            setTimeout(() => {
                console.log('\n🚗 Solicitando corrida...');
                customerSocket.emit('createBooking', {
                    customerId: 'test_simple_timing',
                    pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Origem' },
                    destinationLocation: { lat: -23.5615, lng: -46.6553, address: 'Destino' },
                    estimatedFare: 25.50,
                    paymentMethod: 'PIX'
                });
                
                // Aguardar 3 segundos e processar pagamento
                setTimeout(() => {
                    console.log('\n💳 Processando pagamento...');
                    customerSocket.emit('confirmPayment', {
                        bookingId: 'test_booking_timing',
                        paymentMethod: 'PIX',
                        paymentId: `pix_${Date.now()}`,
                        amount: 25.50
                    });
                    
                    // Aguardar 5 segundos e finalizar
                    setTimeout(() => {
                        console.log('\n🧹 Finalizando teste...');
                        driverSocket.disconnect();
                        customerSocket.disconnect();
                        process.exit(0);
                    }, 5000);
                    
                }, 3000);
                
            }, 2000);
        });
        
    }, 3000);
});






