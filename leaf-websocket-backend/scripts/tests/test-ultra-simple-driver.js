/**
 * 🐛 TESTE ULTRA SIMPLES - VERIFICAR SE SERVIDOR ENVIA PARA DRIVER
 */

const io = require('socket.io-client');

console.log('🐛 TESTE ULTRA SIMPLES - VERIFICAR SE SERVIDOR ENVIA PARA DRIVER');

// Criar driver primeiro
const driverSocket = io('http://localhost:3001');

driverSocket.on('connect', () => {
    console.log('🚗 DRIVER conectado:', driverSocket.id);
    
    // Listener para TODOS os eventos
    driverSocket.onAny((eventName, ...args) => {
        console.log(`🔍 DRIVER recebeu: ${eventName}`, args.length > 0 ? args[0] : 'sem dados');
    });
    
    // Aguardar 3 segundos e criar customer
    setTimeout(() => {
        const customerSocket = io('http://localhost:3001');
        
        customerSocket.on('connect', () => {
            console.log('👤 CUSTOMER conectado:', customerSocket.id);
            
            // Aguardar 1 segundo e solicitar corrida
            setTimeout(() => {
                console.log('🚗 Solicitando corrida...');
                customerSocket.emit('createBooking', {
                    customerId: 'test_simple',
                    pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Origem' },
                    destinationLocation: { lat: -23.5615, lng: -46.6553, address: 'Destino' },
                    estimatedFare: 25.50,
                    paymentMethod: 'PIX'
                });
                
                // Aguardar 2 segundos e processar pagamento
                setTimeout(() => {
                    console.log('💳 Processando pagamento...');
                    customerSocket.emit('confirmPayment', {
                        bookingId: 'test_booking',
                        paymentMethod: 'PIX',
                        paymentId: `pix_${Date.now()}`,
                        amount: 25.50
                    });
                    
                    // Aguardar 5 segundos e finalizar
                    setTimeout(() => {
                        console.log('🧹 Finalizando teste...');
                        driverSocket.disconnect();
                        customerSocket.disconnect();
                        process.exit(0);
                    }, 5000);
                    
                }, 2000);
                
            }, 1000);
        });
        
    }, 3000);
});






