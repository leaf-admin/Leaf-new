/**
 * 🐛 TESTE ULTRA SIMPLES - DEBUG FINAL
 */

const io = require('socket.io-client');

console.log('🐛 TESTE ULTRA SIMPLES - DEBUG FINAL');

let customerSocket, driverSocket;

// Criar motorista primeiro
driverSocket = io('http://localhost:3001');

driverSocket.on('connect', () => {
    console.log('🚗 Motorista conectado:', driverSocket.id);
    
    // Listener para TODOS os eventos
    driverSocket.onAny((eventName, ...args) => {
        console.log(`🔍 Motorista recebeu: ${eventName}`, args.length > 0 ? args[0] : 'sem dados');
    });
    
    // Aguardar 1 segundo e criar cliente
    setTimeout(() => {
        customerSocket = io('http://localhost:3001');
        
        customerSocket.on('connect', () => {
            console.log('👤 Cliente conectado:', customerSocket.id);
            
            // Aguardar 1 segundo e solicitar corrida
            setTimeout(() => {
                console.log('🚗 Solicitando corrida...');
                customerSocket.emit('createBooking', {
                    customerId: 'test_customer',
                    pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Origem' },
                    destinationLocation: { lat: -23.5615, lng: -46.6553, address: 'Destino' },
                    estimatedFare: 25.50,
                    paymentMethod: 'PIX'
                });
                
                // Aguardar 3 segundos e finalizar
                setTimeout(() => {
                    console.log('🧹 Finalizando teste...');
                    driverSocket.disconnect();
                    customerSocket.disconnect();
                    process.exit(0);
                }, 3000);
                
            }, 1000);
        });
        
    }, 1000);
});






