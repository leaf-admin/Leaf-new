/**
 * 🧪 TESTE SIMPLES E DIRETO - SERVIDOR PRINCIPAL
 */

const io = require('socket.io-client');

console.log('🧪 TESTE SIMPLES - SERVIDOR PRINCIPAL');
console.log('='.repeat(50));

let customerSocket = null;
let driverSocket = null;

async function testBasicConnection() {
    console.log('🔌 Testando conexão básica...');
    
    customerSocket = io('http://localhost:3001');
    driverSocket = io('http://localhost:3001');
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout na conexão'));
        }, 5000);
        
        let connected = 0;
        const checkConnection = () => {
            if (connected === 2) {
                clearTimeout(timeout);
                console.log('✅ Ambos conectados!');
                resolve();
            }
        };
        
        customerSocket.on('connect', () => {
            console.log('✅ CUSTOMER conectado:', customerSocket.id);
            connected++;
            checkConnection();
        });
        
        driverSocket.on('connect', () => {
            console.log('✅ DRIVER conectado:', driverSocket.id);
            connected++;
            checkConnection();
        });
    });
}

async function testCreateBooking() {
    console.log('🚗 Testando createBooking...');
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout no createBooking'));
        }, 5000);
        
        customerSocket.once('bookingCreated', (data) => {
            clearTimeout(timeout);
            if (data.success) {
                console.log('✅ createBooking funcionou!');
                resolve(data.bookingId);
            } else {
                reject(new Error('createBooking falhou'));
            }
        });
        
        customerSocket.emit('createBooking', {
            customerId: 'test_customer',
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5615, lng: -46.6553 },
            estimatedFare: 25.50,
            paymentMethod: 'PIX'
        });
    });
}

async function testDriverStatus() {
    console.log('🔄 Testando setDriverStatus...');
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout no setDriverStatus'));
        }, 5000);
        
        driverSocket.once('driverStatusUpdated', (data) => {
            clearTimeout(timeout);
            if (data.success) {
                console.log('✅ setDriverStatus funcionou!');
                resolve();
            } else {
                reject(new Error('setDriverStatus falhou'));
            }
        });
        
        driverSocket.emit('setDriverStatus', {
            driverId: 'test_driver',
            status: 'online',
            isOnline: true
        });
    });
}

async function testSearchDrivers() {
    console.log('🔍 Testando searchDrivers...');
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout no searchDrivers'));
        }, 5000);
        
        customerSocket.once('driversFound', (data) => {
            clearTimeout(timeout);
            if (data.success && data.drivers.length > 0) {
                console.log('✅ searchDrivers funcionou!');
                resolve();
            } else {
                reject(new Error('searchDrivers falhou'));
            }
        });
        
        customerSocket.emit('searchDrivers', {
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5615, lng: -46.6553 },
            rideType: 'standard',
            estimatedFare: 25.50
        });
    });
}

async function testSupportTicket() {
    console.log('🎫 Testando createSupportTicket...');
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout no createSupportTicket'));
        }, 5000);
        
        customerSocket.once('supportTicketCreated', (data) => {
            clearTimeout(timeout);
            if (data.success) {
                console.log('✅ createSupportTicket funcionou!');
                resolve();
            } else {
                reject(new Error('createSupportTicket falhou'));
            }
        });
        
        customerSocket.emit('createSupportTicket', {
            type: 'technical',
            priority: 'N3',
            description: 'Teste de ticket'
        });
    });
}

async function runTests() {
    try {
        console.log('🚀 Iniciando testes...\n');
        
        await testBasicConnection();
        await testCreateBooking();
        await testDriverStatus();
        await testSearchDrivers();
        await testSupportTicket();
        
        console.log('\n🎉 TODOS OS TESTES PASSARAM!');
        console.log('✅ Servidor principal funcionando com todos os eventos!');
        
    } catch (error) {
        console.error('❌ ERRO:', error.message);
    } finally {
        if (customerSocket) customerSocket.disconnect();
        if (driverSocket) driverSocket.disconnect();
        process.exit(0);
    }
}

// Timeout geral
setTimeout(() => {
    console.log('⏰ TIMEOUT GERAL');
    process.exit(1);
}, 30000);

runTests();






