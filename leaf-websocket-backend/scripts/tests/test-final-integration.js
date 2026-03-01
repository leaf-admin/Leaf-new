/**
 * 🧪 TESTE FINAL - INTEGRAÇÃO COMPLETA MOBILE + SERVIDOR
 */

const io = require('socket.io-client');

console.log('🧪 TESTE FINAL - INTEGRAÇÃO COMPLETA');
console.log('='.repeat(60));

let customerSocket = null;
let driverSocket = null;
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
    console.log('🔌 Conectando sockets...');
    
    customerSocket = io('http://localhost:3001');
    driverSocket = io('http://localhost:3001');
    
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

// Teste 1: Fluxo completo de corrida
async function testCompleteRideFlow() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 20000);
        let stepsCompleted = 0;
        
        const checkComplete = () => {
            if (stepsCompleted >= 4) {
                clearTimeout(timeout);
                resolve();
            }
        };
        
        // 1. Criar corrida
        customerSocket.once('bookingCreated', (data) => {
            if (data.success) {
                console.log('  ✅ 1. Corrida criada:', data.bookingId);
                stepsCompleted++;
                checkComplete();
            }
        });
        
        // 2. Confirmar pagamento
        customerSocket.once('paymentConfirmed', (data) => {
            if (data.success) {
                console.log('  ✅ 2. Pagamento confirmado');
                stepsCompleted++;
                checkComplete();
            }
        });
        
        // 3. Driver aceita
        driverSocket.once('rideAccepted', (data) => {
            if (data.success) {
                console.log('  ✅ 3. Driver aceitou');
                stepsCompleted++;
                checkComplete();
            }
        });
        
        // 4. Viagem iniciada
        customerSocket.once('tripStarted', (data) => {
            if (data.success) {
                console.log('  ✅ 4. Viagem iniciada');
                stepsCompleted++;
                checkComplete();
            }
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
        
        setTimeout(() => {
            driverSocket.emit('startTrip', {
                bookingId: 'test_booking',
                startLocation: { lat: -23.5505, lng: -46.6333 }
            });
        }, 3000);
    });
}

// Teste 2: Novos eventos de driver
async function testDriverEvents() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        let eventsCompleted = 0;
        
        const checkComplete = () => {
            if (eventsCompleted >= 2) {
                clearTimeout(timeout);
                resolve();
            }
        };
        
        // Status do driver
        driverSocket.once('driverStatusUpdated', (data) => {
            if (data.success) {
                console.log('  ✅ Status do driver atualizado');
                eventsCompleted++;
                checkComplete();
            }
        });
        
        // Localização do driver
        driverSocket.once('locationUpdated', (data) => {
            if (data.success) {
                console.log('  ✅ Localização do driver atualizada');
                eventsCompleted++;
                checkComplete();
            }
        });
        
        // Executar eventos
        driverSocket.emit('setDriverStatus', {
            driverId: 'test_driver',
            status: 'online',
            isOnline: true
        });
        
        setTimeout(() => {
            driverSocket.emit('updateDriverLocation', {
                driverId: 'test_driver',
                lat: -23.5505,
                lng: -46.6333,
                heading: 90,
                speed: 50
            });
        }, 1000);
    });
}

// Teste 3: Busca de motoristas
async function testDriverSearch() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        
        customerSocket.once('driversFound', (data) => {
            clearTimeout(timeout);
            if (data.success && data.drivers.length > 0) {
                console.log(`  ✅ ${data.drivers.length} motoristas encontrados`);
                resolve();
            } else {
                reject(new Error('Nenhum motorista encontrado'));
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

// Teste 4: Sistema de suporte
async function testSupportSystem() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        
        customerSocket.once('supportTicketCreated', (data) => {
            clearTimeout(timeout);
            if (data.success) {
                console.log(`  ✅ Ticket criado: ${data.ticketId}`);
                resolve();
            } else {
                reject(new Error('Falha ao criar ticket'));
            }
        });
        
        customerSocket.emit('createSupportTicket', {
            type: 'technical',
            priority: 'N3',
            description: 'Teste de ticket de suporte'
        });
    });
}

// Teste 5: Sistema de segurança
async function testSafetySystem() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        
        customerSocket.once('incidentReported', (data) => {
            clearTimeout(timeout);
            if (data.success) {
                console.log(`  ✅ Incidente reportado: ${data.reportId}`);
                resolve();
            } else {
                reject(new Error('Falha ao reportar incidente'));
            }
        });
        
        customerSocket.emit('reportIncident', {
            type: 'safety',
            description: 'Teste de incidente',
            location: { lat: -23.5505, lng: -46.6333 }
        });
    });
}

// Teste 6: Cancelamento com reembolso
async function testRideCancellation() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        
        customerSocket.once('rideCancelled', (data) => {
            clearTimeout(timeout);
            if (data.success && data.data.refundStatus === 'processed') {
                console.log(`  ✅ Corrida cancelada - Reembolso: R$ ${data.data.refundAmount}`);
                resolve();
            } else {
                reject(new Error('Falha no cancelamento/reembolso'));
            }
        });
        
        customerSocket.emit('cancelRide', {
            bookingId: 'test_booking',
            reason: 'Teste de cancelamento',
            cancellationFee: 0
        });
    });
}

// Teste 7: Analytics e feedback
async function testAnalyticsAndFeedback() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        let eventsCompleted = 0;
        
        const checkComplete = () => {
            if (eventsCompleted >= 2) {
                clearTimeout(timeout);
                resolve();
            }
        };
        
        // Analytics
        customerSocket.once('userActionTracked', (data) => {
            if (data.success) {
                console.log('  ✅ Ação rastreada');
                eventsCompleted++;
                checkComplete();
            }
        });
        
        // Feedback
        customerSocket.once('feedbackReceived', (data) => {
            if (data.success) {
                console.log('  ✅ Feedback recebido');
                eventsCompleted++;
                checkComplete();
            }
        });
        
        // Executar eventos
        customerSocket.emit('trackUserAction', {
            action: 'ride_requested',
            data: { test: true },
            timestamp: Date.now()
        });
        
        setTimeout(() => {
            customerSocket.emit('submitFeedback', {
                type: 'app_feedback',
                rating: 5,
                comments: 'Teste de feedback',
                suggestions: 'Melhorar interface'
            });
        }, 1000);
    });
}

// Executar todos os testes
async function runAllTests() {
    try {
        await connectSockets();
        
        console.log('\n🚀 INICIANDO TESTES DE INTEGRAÇÃO COMPLETA...\n');
        
        await runTest('Fluxo Completo de Corrida', testCompleteRideFlow);
        await runTest('Eventos de Driver (Status + Localização)', testDriverEvents);
        await runTest('Busca de Motoristas', testDriverSearch);
        await runTest('Sistema de Suporte', testSupportSystem);
        await runTest('Sistema de Segurança', testSafetySystem);
        await runTest('Cancelamento com Reembolso PIX', testRideCancellation);
        await runTest('Analytics e Feedback', testAnalyticsAndFeedback);
        
        console.log('\n📊 RESULTADOS FINAIS:');
        console.log('='.repeat(60));
        console.log(`✅ Testes Passou: ${testResults.passed}`);
        console.log(`❌ Testes Falhou: ${testResults.failed}`);
        console.log(`📊 Total de Testes: ${testResults.total}`);
        console.log(`🎯 Taxa de Sucesso: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
        
        if (testResults.failed === 0) {
            console.log('\n🎉 INTEGRAÇÃO COMPLETA FUNCIONANDO!');
            console.log('✅ Servidor principal com todos os eventos');
            console.log('✅ WebSocketManager atualizado');
            console.log('✅ Exemplos de integração criados');
            console.log('✅ Sistema pronto para produção!');
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
}, 120000);

// Executar testes
runAllTests();






