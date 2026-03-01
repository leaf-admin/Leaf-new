/**
 * 🚀 TESTE FUNCIONAL - DRIVER SIDE CORRIGIDO
 * 
 * Teste que realmente funciona para validar o driver side
 */

const io = require('socket.io-client');

console.log('🚀 TESTE FUNCIONAL - DRIVER SIDE CORRIGIDO');
console.log('='.repeat(50));

let driverSocket = null;
let customerSocket = null;
let testCompleted = false;

// Função para finalizar teste
function finishTest() {
    if (testCompleted) return;
    testCompleted = true;
    
    console.log('\n🎉 TESTE FINALIZADO!');
    console.log('='.repeat(50));
    
    if (driverSocket) driverSocket.disconnect();
    if (customerSocket) customerSocket.disconnect();
    
    setTimeout(() => {
        process.exit(0);
    }, 1000);
}

// 1. Conectar DRIVER primeiro
console.log('🚗 Conectando DRIVER...');
driverSocket = io('http://localhost:3001', { 
    transports: ['websocket'],
    timeout: 5000 
});

driverSocket.on('connect', () => {
    console.log('✅ DRIVER conectado:', driverSocket.id);
    
    // Listener específico para rideRequest
    driverSocket.on('rideRequest', (data) => {
        console.log('🎯 DRIVER RECEBEU rideRequest:', data);
        console.log('✅ SUCESSO! Driver está recebendo notificações!');
        finishTest();
    });
    
    // Listener para todos os eventos (debug)
    driverSocket.onAny((eventName, ...args) => {
        if (eventName !== 'rideRequest') {
            console.log(`🔍 DRIVER recebeu: ${eventName}`);
        }
    });
    
    // Aguardar 2 segundos e conectar CUSTOMER
    setTimeout(() => {
        console.log('\n👤 Conectando CUSTOMER...');
        
        customerSocket = io('http://localhost:3001', { 
            transports: ['websocket'],
            timeout: 5000 
        });
        
        customerSocket.on('connect', () => {
            console.log('✅ CUSTOMER conectado:', customerSocket.id);
            
            // Aguardar 1 segundo e solicitar corrida
            setTimeout(() => {
                console.log('\n🚗 Solicitando corrida...');
                customerSocket.emit('createBooking', {
                    customerId: 'test_functional',
                    pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Origem' },
                    destinationLocation: { lat: -23.5615, lng: -46.6553, address: 'Destino' },
                    estimatedFare: 25.50,
                    paymentMethod: 'PIX'
                });
                
                // Aguardar 2 segundos e processar pagamento
                setTimeout(() => {
                    console.log('\n💳 Processando pagamento...');
                    customerSocket.emit('confirmPayment', {
                        bookingId: 'test_booking_functional',
                        paymentMethod: 'PIX',
                        paymentId: `pix_${Date.now()}`,
                        amount: 25.50
                    });
                    
                    // Aguardar máximo 5 segundos para driver receber
                    setTimeout(() => {
                        console.log('\n⏰ Timeout - Driver não recebeu rideRequest');
                        console.log('❌ PROBLEMA: Driver não está recebendo notificações');
                        finishTest();
                    }, 5000);
                    
                }, 2000);
                
            }, 1000);
        });
        
        customerSocket.on('connect_error', (error) => {
            console.error('❌ Erro conectando CUSTOMER:', error);
            finishTest();
        });
        
    }, 2000);
});

driverSocket.on('connect_error', (error) => {
    console.error('❌ Erro conectando DRIVER:', error);
    finishTest();
});

// Timeout geral de segurança
setTimeout(() => {
    console.log('\n⏰ TIMEOUT GERAL - Finalizando teste');
    finishTest();
}, 15000);






