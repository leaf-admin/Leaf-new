/**
 * 🧪 TESTE COMPLETO - SERVIDOR PRINCIPAL COM TODOS OS EVENTOS
 */

const io = require('socket.io-client');

console.log('🧪 TESTE COMPLETO - SERVIDOR PRINCIPAL (server.js)');
console.log('='.repeat(60));

let driverSocket = null;
let customerSocket = null;
let testResults = {
    passed: 0,
    failed: 0,
    total: 0
};

// Função para executar teste
async function runTest(testName, testFunction) {
    testResults.total++;
    console.log(`\n🧪 Testando: ${testName}`);
    
    try {
        await testFunction();
        testResults.passed++;
        console.log(`✅ ${testName} - PASSOU`);
    } catch (error) {
        testResults.failed++;
        console.log(`❌ ${testName} - FALHOU: ${error.message}`);
    }
}

// Conectar sockets
async function connectSockets() {
    console.log('🔌 Conectando sockets ao servidor principal...');
    
    driverSocket = io('http://localhost:3001');
    customerSocket = io('http://localhost:3001');
    
    await new Promise(resolve => {
        let connected = 0;
        const checkConnection = () => {
            if (connected === 2) resolve();
        };
        
        driverSocket.on('connect', () => {
            console.log('✅ DRIVER conectado:', driverSocket.id);
            connected++;
            checkConnection();
        });
        
        customerSocket.on('connect', () => {
            console.log('✅ CUSTOMER conectado:', customerSocket.id);
            connected++;
            checkConnection();
        });
    });
}

// Teste 1: Eventos Core (já existentes)
async function testCoreEvents() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        let eventsReceived = 0;
        
        const checkComplete = () => {
            if (eventsReceived >= 3) {
                clearTimeout(timeout);
                resolve();
            }
        };
        
        // Testar createBooking
        customerSocket.once('bookingCreated', (data) => {
            if (data.success) eventsReceived++;
            checkComplete();
        });
        
        // Testar confirmPayment
        customerSocket.once('paymentConfirmed', (data) => {
            if (data.success) eventsReceived++;
            checkComplete();
        });
        
        // Testar driverResponse
        driverSocket.once('rideAccepted', (data) => {
            if (data.success) eventsReceived++;
            checkComplete();
        });
        
        // Executar sequência
        customerSocket.emit('createBooking', {
            customerId: 'test_customer',
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5615, lng: -46.6553 },
            estimatedFare: 25.50,
            paymentMethod: 'PIX'
        });
        
        setTimeout(() => {
            customerSocket.emit('confirmPayment', {
                bookingId: 'test_booking',
                paymentMethod: 'PIX',
                paymentId: 'test_payment',
                amount: 25.50
            });
        }, 1000);
        
        setTimeout(() => {
            driverSocket.emit('driverResponse', {
                bookingId: 'test_booking',
                accepted: true
            });
        }, 2000);
    });
}

// Teste 2: Gerenciamento de Status do Driver
async function testDriverStatusManagement() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        driverSocket.once('driverStatusUpdated', (data) => {
            clearTimeout(timeout);
            if (data.success) resolve();
            else reject(new Error('Status update failed'));
        });
        
        driverSocket.emit('setDriverStatus', {
            driverId: 'test_driver',
            status: 'online',
            isOnline: true
        });
    });
}

// Teste 3: Atualização de Localização
async function testLocationUpdate() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        driverSocket.once('locationUpdated', (data) => {
            clearTimeout(timeout);
            if (data.success) resolve();
            else reject(new Error('Location update failed'));
        });
        
        driverSocket.emit('updateDriverLocation', {
            driverId: 'test_driver',
            lat: -23.5505,
            lng: -46.6333,
            heading: 90,
            speed: 50
        });
    });
}

// Teste 4: Busca de Motoristas
async function testDriverSearch() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        customerSocket.once('driversFound', (data) => {
            clearTimeout(timeout);
            if (data.success && data.drivers.length > 0) resolve();
            else reject(new Error('Driver search failed'));
        });
        
        customerSocket.emit('searchDrivers', {
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5615, lng: -46.6553 },
            rideType: 'standard',
            estimatedFare: 25.50
        });
    });
}

// Teste 5: Cancelamento de Corrida
async function testRideCancellation() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        customerSocket.once('rideCancelled', (data) => {
            clearTimeout(timeout);
            if (data.success) resolve();
            else reject(new Error('Ride cancellation failed'));
        });
        
        customerSocket.emit('cancelRide', {
            bookingId: 'test_booking',
            reason: 'Teste de cancelamento',
            cancellationFee: 0
        });
    });
}

// Teste 6: Sistema de Segurança
async function testSafetySystem() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        customerSocket.once('incidentReported', (data) => {
            clearTimeout(timeout);
            if (data.success) resolve();
            else reject(new Error('Incident report failed'));
        });
        
        customerSocket.emit('reportIncident', {
            type: 'safety',
            description: 'Teste de incidente',
            location: { lat: -23.5505, lng: -46.6333 }
        });
    });
}

// Teste 7: Contato de Emergência
async function testEmergencyContact() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        customerSocket.once('emergencyContacted', (data) => {
            clearTimeout(timeout);
            if (data.success) resolve();
            else reject(new Error('Emergency contact failed'));
        });
        
        customerSocket.emit('emergencyContact', {
            contactType: 'police',
            location: { lat: -23.5505, lng: -46.6333 },
            message: 'Teste de emergência'
        });
    });
}

// Teste 8: Sistema de Suporte
async function testSupportSystem() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        customerSocket.once('supportTicketCreated', (data) => {
            clearTimeout(timeout);
            if (data.success) resolve();
            else reject(new Error('Support ticket creation failed'));
        });
        
        customerSocket.emit('createSupportTicket', {
            type: 'technical',
            priority: 'N3',
            description: 'Teste de ticket de suporte'
        });
    });
}

// Teste 9: Notificações
async function testNotifications() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        customerSocket.once('notificationPreferencesUpdated', (data) => {
            clearTimeout(timeout);
            if (data.success) resolve();
            else reject(new Error('Notification preferences update failed'));
        });
        
        customerSocket.emit('updateNotificationPreferences', {
            rideUpdates: true,
            promotions: false,
            driverMessages: true,
            systemAlerts: true
        });
    });
}

// Teste 10: Analytics
async function testAnalytics() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        customerSocket.once('userActionTracked', (data) => {
            clearTimeout(timeout);
            if (data.success) resolve();
            else reject(new Error('User action tracking failed'));
        });
        
        customerSocket.emit('trackUserAction', {
            action: 'ride_requested',
            data: { test: true },
            timestamp: Date.now()
        });
    });
}

// Teste 11: Feedback
async function testFeedback() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        customerSocket.once('feedbackReceived', (data) => {
            clearTimeout(timeout);
            if (data.success) resolve();
            else reject(new Error('Feedback submission failed'));
        });
        
        customerSocket.emit('submitFeedback', {
            type: 'app_feedback',
            rating: 5,
            comments: 'Teste de feedback',
            suggestions: 'Melhorar interface'
        });
    });
}

// Teste 12: Chat
async function testChat() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
        
        customerSocket.once('chatCreated', (data) => {
            clearTimeout(timeout);
            if (data.success) resolve();
            else reject(new Error('Chat creation failed'));
        });
        
        customerSocket.emit('createChat', {
            chatData: { test: true }
        });
    });
}

// Executar todos os testes
async function runAllTests() {
    try {
        await connectSockets();
        
        console.log('\n🚀 INICIANDO TESTES NO SERVIDOR PRINCIPAL...\n');
        
        await runTest('Eventos Core (createBooking, confirmPayment, driverResponse)', testCoreEvents);
        await runTest('Gerenciamento de Status do Driver', testDriverStatusManagement);
        await runTest('Atualização de Localização', testLocationUpdate);
        await runTest('Busca de Motoristas', testDriverSearch);
        await runTest('Cancelamento de Corrida', testRideCancellation);
        await runTest('Sistema de Segurança', testSafetySystem);
        await runTest('Contato de Emergência', testEmergencyContact);
        await runTest('Sistema de Suporte', testSupportSystem);
        await runTest('Notificações', testNotifications);
        await runTest('Analytics', testAnalytics);
        await runTest('Feedback', testFeedback);
        await runTest('Chat', testChat);
        
        console.log('\n📊 RESULTADOS FINAIS:');
        console.log('='.repeat(60));
        console.log(`✅ Testes Passou: ${testResults.passed}`);
        console.log(`❌ Testes Falhou: ${testResults.failed}`);
        console.log(`📊 Total de Testes: ${testResults.total}`);
        console.log(`🎯 Taxa de Sucesso: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
        
        if (testResults.failed === 0) {
            console.log('\n🎉 TODOS OS TESTES PASSARAM! Servidor principal completo funcionando!');
        } else {
            console.log(`\n⚠️ ${testResults.failed} teste(s) falharam. Verificar implementação.`);
        }
        
    } catch (error) {
        console.error('❌ Erro geral nos testes:', error);
    } finally {
        // Limpar conexões
        if (driverSocket) driverSocket.disconnect();
        if (customerSocket) customerSocket.disconnect();
        process.exit(0);
    }
}

// Timeout geral
setTimeout(() => {
    console.log('\n⏰ TIMEOUT GERAL - Finalizando testes');
    process.exit(1);
}, 120000); // 2 minutos para o servidor principal

// Executar testes
runAllTests();






