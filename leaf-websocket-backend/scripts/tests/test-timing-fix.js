/**
 * 🔧 TESTE DE TIMING - MANTER CONEXÕES ABERTAS
 */

const io = require('socket.io-client');

console.log('🔧 TESTE DE TIMING - MANTER CONEXÕES ABERTAS');

let driverSocket = null;
let customerSocket = null;

// Conectar DRIVER
driverSocket = io('http://localhost:3001');

driverSocket.on('connect', () => {
    console.log('✅ DRIVER conectado:', driverSocket.id);
    
    driverSocket.on('rideRequest', (data) => {
        console.log('🎯 DRIVER RECEBEU rideRequest:', data);
        console.log('✅ SUCESSO! Driver recebeu notificação!');
        process.exit(0);
    });
    
    driverSocket.onAny((eventName, ...args) => {
        console.log(`🔍 DRIVER: ${eventName}`);
    });
    
    // Aguardar 3 segundos e conectar CUSTOMER
    setTimeout(() => {
        console.log('\n👤 Conectando CUSTOMER...');
        
        customerSocket = io('http://localhost:3001');
        
        customerSocket.on('connect', () => {
            console.log('✅ CUSTOMER conectado:', customerSocket.id);
            
            // Aguardar 2 segundos e solicitar corrida
            setTimeout(() => {
                console.log('\n🚗 Solicitando corrida...');
                customerSocket.emit('createBooking', {
                    customerId: 'test_timing',
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
                    
                    // Aguardar 10 segundos para driver receber
                    setTimeout(() => {
                        console.log('\n⏰ Timeout - Driver não recebeu rideRequest');
                        console.log('❌ PROBLEMA: Driver não está recebendo notificações');
                        process.exit(1);
                    }, 10000);
                    
                }, 3000);
                
            }, 2000);
        });
        
    }, 3000);
});

// Timeout geral
setTimeout(() => {
    console.log('\n⏰ TIMEOUT GERAL');
    process.exit(1);
}, 20000);






