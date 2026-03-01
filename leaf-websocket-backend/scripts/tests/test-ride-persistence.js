/**
 * Script de Teste: Persistência de Corridas no Firestore
 * 
 * Testa todos os métodos do RidePersistenceService e valida
 * se os dados estão sendo salvos corretamente no Firestore.
 */

const ridePersistenceService = require('./services/ride-persistence-service');
const firebaseConfig = require('./firebase-config');
const admin = require('firebase-admin');

// Cores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Contador de testes
let testsPassed = 0;
let testsFailed = 0;
let testsTotal = 0;

function test(name, testFn) {
    testsTotal++;
    try {
        log(`\n🧪 Teste: ${name}`, 'cyan');
        const result = testFn();
        if (result instanceof Promise) {
            return result.then(() => {
                testsPassed++;
                log(`✅ PASSOU: ${name}`, 'green');
            }).catch((error) => {
                testsFailed++;
                log(`❌ FALHOU: ${name}`, 'red');
                log(`   Erro: ${error.message}`, 'red');
                console.error(error);
            });
        } else {
            testsPassed++;
            log(`✅ PASSOU: ${name}`, 'green');
        }
    } catch (error) {
        testsFailed++;
        log(`❌ FALHOU: ${name}`, 'red');
        log(`   Erro: ${error.message}`, 'red');
        console.error(error);
    }
}

async function runTests() {
    log('\n🚀 INICIANDO TESTES DE PERSISTÊNCIA DE CORRIDAS\n', 'blue');
    log('='.repeat(60), 'blue');
    
    // Verificar se Firestore está disponível
    test('Firestore disponível', () => {
        const isAvailable = ridePersistenceService.isFirestoreAvailable();
        if (!isAvailable) {
            throw new Error('Firestore não está disponível');
        }
        log(`   Firestore: ${isAvailable ? 'Disponível' : 'Indisponível'}`);
    });
    
    // Teste 1: Salvar corrida (snapshot inicial)
    const testRideId = `test_ride_${Date.now()}`;
    const testBookingId = testRideId;
    const testPassengerId = `test_passenger_${Date.now()}`;
    const testDriverId = `test_driver_${Date.now()}`;
    
    await test('Salvar corrida no início (saveRide)', async () => {
        const rideData = {
            rideId: testRideId,
            bookingId: testBookingId,
            passengerId: testPassengerId,
            pickupLocation: {
                lat: -22.9068,
                lng: -43.1234,
                address: 'Rua Teste, 123 - Teste de Persistência'
            },
            destinationLocation: {
                lat: -22.9,
                lng: -43.13,
                address: 'Rua Destino, 456'
            },
            estimatedFare: 25.50,
            paymentMethod: 'pix',
            paymentStatus: 'pending_payment',
            status: 'pending',
            carType: 'standard'
        };
        
        const result = await ridePersistenceService.saveRide(rideData);
        
        if (!result.success) {
            throw new Error(`Falha ao salvar corrida: ${result.error}`);
        }
        
        log(`   RideId: ${testRideId}`);
        log(`   Resultado: ${JSON.stringify(result)}`);
        
        // Verificar se foi salvo no Firestore
        await new Promise(resolve => setTimeout(resolve, 1000)); // Aguardar 1s para garantir escrita
        
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('rides').doc(testRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não foi criado no Firestore');
        }
        
        const data = doc.data();
        log(`   ✅ Documento criado no Firestore`);
        log(`   Status: ${data.status}`);
        log(`   PassengerId: ${data.passengerId}`);
        log(`   EstimatedFare: ${data.estimatedFare}`);
        
        // Validar estrutura
        if (data.status !== 'pending') {
            throw new Error(`Status incorreto. Esperado: 'pending', Recebido: '${data.status}'`);
        }
        
        if (data.passengerId !== testPassengerId) {
            throw new Error(`PassengerId incorreto. Esperado: '${testPassengerId}', Recebido: '${data.passengerId}'`);
        }
        
        if (!data.pickupLocation || !data.pickupLocation.lat) {
            throw new Error('pickupLocation não foi salvo corretamente');
        }
        
        if (!data.createdAt) {
            throw new Error('createdAt não foi salvo');
        }
        
        log(`   ✅ Estrutura validada`);
    });
    
    // Teste 2: Atualizar motorista (quando aceita)
    await test('Atualizar motorista da corrida (updateRideDriver)', async () => {
        const result = await ridePersistenceService.updateRideDriver(testRideId, testDriverId);
        
        if (!result.success) {
            throw new Error(`Falha ao atualizar motorista: ${result.error || 'erro desconhecido'}`);
        }
        
        log(`   DriverId: ${testDriverId}`);
        
        // Verificar no Firestore
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('rides').doc(testRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não encontrado no Firestore');
        }
        
        const data = doc.data();
        
        if (data.driverId !== testDriverId) {
            throw new Error(`DriverId incorreto. Esperado: '${testDriverId}', Recebido: '${data.driverId}'`);
        }
        
        if (data.status !== 'accepted') {
            throw new Error(`Status incorreto. Esperado: 'accepted', Recebido: '${data.status}'`);
        }
        
        if (!data.acceptedAt) {
            throw new Error('acceptedAt não foi salvo');
        }
        
        log(`   ✅ Motorista atualizado corretamente`);
        log(`   Status: ${data.status}`);
        log(`   AcceptedAt: ${data.acceptedAt ? 'Salvo' : 'Não salvo'}`);
    });
    
    // Teste 3: Marcar como iniciada
    await test('Marcar corrida como iniciada (markRideStarted)', async () => {
        const result = await ridePersistenceService.markRideStarted(testRideId);
        
        if (!result.success) {
            throw new Error(`Falha ao marcar como iniciada: ${result.error || 'erro desconhecido'}`);
        }
        
        // Verificar no Firestore
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('rides').doc(testRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não encontrado no Firestore');
        }
        
        const data = doc.data();
        
        if (data.status !== 'in_progress') {
            throw new Error(`Status incorreto. Esperado: 'in_progress', Recebido: '${data.status}'`);
        }
        
        if (!data.startedAt) {
            throw new Error('startedAt não foi salvo');
        }
        
        log(`   ✅ Corrida marcada como iniciada`);
        log(`   Status: ${data.status}`);
        log(`   StartedAt: ${data.startedAt ? 'Salvo' : 'Não salvo'}`);
    });
    
    // Teste 4: Salvar dados finais
    await test('Salvar dados finais da corrida (saveFinalRideData)', async () => {
        const finalData = {
            fare: 28.00,
            netFare: 26.50,
            distance: 12.5,
            duration: 30,
            endLocation: {
                lat: -22.9,
                lng: -43.13,
                address: 'Rua Destino, 456'
            },
            driverEarnings: 26.50,
            financialBreakdown: {
                totalAmount: 2800,
                platformFee: 150,
                netAmount: 2650
            }
        };
        
        const result = await ridePersistenceService.saveFinalRideData(testRideId, finalData);
        
        if (!result.success) {
            throw new Error(`Falha ao salvar dados finais: ${result.error || 'erro desconhecido'}`);
        }
        
        // Verificar no Firestore
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('rides').doc(testRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não encontrado no Firestore');
        }
        
        const data = doc.data();
        
        if (data.status !== 'completed') {
            throw new Error(`Status incorreto. Esperado: 'completed', Recebido: '${data.status}'`);
        }
        
        if (data.finalPrice !== 28.00) {
            throw new Error(`FinalPrice incorreto. Esperado: 28.00, Recebido: ${data.finalPrice}`);
        }
        
        if (data.netFare !== 26.50) {
            throw new Error(`NetFare incorreto. Esperado: 26.50, Recebido: ${data.netFare}`);
        }
        
        if (data.distance !== 12.5) {
            throw new Error(`Distance incorreto. Esperado: 12.5, Recebido: ${data.distance}`);
        }
        
        if (!data.completedAt) {
            throw new Error('completedAt não foi salvo');
        }
        
        if (!data.endLocation || !data.endLocation.lat) {
            throw new Error('endLocation não foi salvo corretamente');
        }
        
        if (!data.financialBreakdown) {
            throw new Error('financialBreakdown não foi salvo');
        }
        
        log(`   ✅ Dados finais salvos corretamente`);
        log(`   Status: ${data.status}`);
        log(`   FinalPrice: ${data.finalPrice}`);
        log(`   NetFare: ${data.netFare}`);
        log(`   Distance: ${data.distance} km`);
        log(`   Duration: ${data.duration} min`);
        log(`   CompletedAt: ${data.completedAt ? 'Salvo' : 'Não salvo'}`);
    });
    
    // Teste 5: Buscar corrida
    await test('Buscar corrida do Firestore (getRide)', async () => {
        const ride = await ridePersistenceService.getRide(testRideId);
        
        if (!ride) {
            throw new Error('Corrida não encontrada');
        }
        
        if (ride.rideId !== testRideId) {
            throw new Error(`RideId incorreto. Esperado: '${testRideId}', Recebido: '${ride.rideId}'`);
        }
        
        if (ride.status !== 'completed') {
            throw new Error(`Status incorreto. Esperado: 'completed', Recebido: '${ride.status}'`);
        }
        
        log(`   ✅ Corrida encontrada e validada`);
        log(`   RideId: ${ride.rideId}`);
        log(`   Status: ${ride.status}`);
        log(`   FinalPrice: ${ride.finalPrice}`);
    });
    
    // Teste 6: Validar estrutura completa do documento
    await test('Validar estrutura completa do documento no Firestore', async () => {
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('rides').doc(testRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não encontrado');
        }
        
        const data = doc.data();
        
        // Campos obrigatórios
        const requiredFields = [
            'rideId',
            'bookingId',
            'passengerId',
            'driverId',
            'status',
            'pickupLocation',
            'destinationLocation',
            'estimatedFare',
            'finalPrice',
            'netFare',
            'distance',
            'paymentMethod',
            'createdAt',
            'acceptedAt',
            'startedAt',
            'completedAt'
        ];
        
        const missingFields = [];
        for (const field of requiredFields) {
            if (data[field] === undefined || data[field] === null) {
                missingFields.push(field);
            }
        }
        
        if (missingFields.length > 0) {
            throw new Error(`Campos faltando: ${missingFields.join(', ')}`);
        }
        
        // Validar tipos
        if (typeof data.estimatedFare !== 'number') {
            throw new Error(`estimatedFare deve ser number, recebido: ${typeof data.estimatedFare}`);
        }
        
        if (typeof data.finalPrice !== 'number') {
            throw new Error(`finalPrice deve ser number, recebido: ${typeof data.finalPrice}`);
        }
        
        if (typeof data.distance !== 'number') {
            throw new Error(`distance deve ser number, recebido: ${typeof data.distance}`);
        }
        
        if (!data.pickupLocation.lat || typeof data.pickupLocation.lat !== 'number') {
            throw new Error('pickupLocation.lat deve ser number');
        }
        
        log(`   ✅ Estrutura completa validada`);
        log(`   Total de campos: ${Object.keys(data).length}`);
    });
    
    // Teste 7: Testar cancelamento
    const testCancelRideId = `test_cancel_ride_${Date.now()}`;
    await test('Marcar corrida como cancelada (markRideCancelled)', async () => {
        // Primeiro criar uma corrida
        await ridePersistenceService.saveRide({
            rideId: testCancelRideId,
            bookingId: testCancelRideId,
            passengerId: testPassengerId,
            pickupLocation: {
                lat: -22.9068,
                lng: -43.1234
            },
            destinationLocation: {
                lat: -22.9,
                lng: -43.13
            },
            estimatedFare: 20.00,
            paymentMethod: 'pix',
            status: 'pending'
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Cancelar
        const result = await ridePersistenceService.markRideCancelled(testCancelRideId, 'Teste de cancelamento');
        
        if (!result.success) {
            throw new Error(`Falha ao cancelar: ${result.error || 'erro desconhecido'}`);
        }
        
        // Verificar no Firestore
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('rides').doc(testCancelRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não encontrado');
        }
        
        const data = doc.data();
        
        if (data.status !== 'cancelled') {
            throw new Error(`Status incorreto. Esperado: 'cancelled', Recebido: '${data.status}'`);
        }
        
        if (!data.cancelledAt) {
            throw new Error('cancelledAt não foi salvo');
        }
        
        if (data.cancellationReason !== 'Teste de cancelamento') {
            throw new Error(`CancellationReason incorreto. Esperado: 'Teste de cancelamento', Recebido: '${data.cancellationReason}'`);
        }
        
        log(`   ✅ Corrida cancelada corretamente`);
        log(`   Status: ${data.status}`);
        log(`   CancellationReason: ${data.cancellationReason}`);
    });
    
    // Teste 8: Validar dados de exemplo completos
    await test('Validar documento completo no Firestore (exemplo real)', async () => {
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('rides').doc(testRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não encontrado');
        }
        
        const data = doc.data();
        
        log(`\n   📄 ESTRUTURA COMPLETA DO DOCUMENTO:`, 'yellow');
        log(`   ${JSON.stringify(data, null, 2)}`, 'yellow');
        
        // Validar que todos os timestamps são objetos Timestamp do Firestore
        const timestampFields = ['createdAt', 'acceptedAt', 'startedAt', 'completedAt'];
        for (const field of timestampFields) {
            if (data[field]) {
                const timestamp = data[field];
                if (timestamp.toDate) {
                    log(`   ✅ ${field}: ${timestamp.toDate().toISOString()}`);
                } else {
                    throw new Error(`${field} não é um Timestamp válido do Firestore`);
                }
            }
        }
        
        log(`   ✅ Documento completo e válido`);
    });
    
    // Resumo
    log('\n' + '='.repeat(60), 'blue');
    log(`\n📊 RESUMO DOS TESTES:`, 'blue');
    log(`   Total: ${testsTotal}`, 'cyan');
    log(`   ✅ Passou: ${testsPassed}`, 'green');
    log(`   ❌ Falhou: ${testsFailed}`, 'red');
    log(`   Taxa de sucesso: ${((testsPassed / testsTotal) * 100).toFixed(1)}%`, 
        testsFailed === 0 ? 'green' : 'yellow');
    
    if (testsFailed === 0) {
        log(`\n🎉 TODOS OS TESTES PASSARAM!`, 'green');
        log(`\n✅ A escrita no Firestore está CORRETA!`, 'green');
    } else {
        log(`\n⚠️ ALGUNS TESTES FALHARAM`, 'yellow');
        log(`   Verifique os erros acima`, 'yellow');
    }
    
    log(`\n🧹 Limpando documentos de teste...`, 'cyan');
    
    // Limpar documentos de teste
    try {
        const firestore = firebaseConfig.getFirestore();
        await firestore.collection('rides').doc(testRideId).delete();
        await firestore.collection('rides').doc(testCancelRideId).delete();
        log(`   ✅ Documentos de teste removidos`, 'green');
    } catch (error) {
        log(`   ⚠️ Erro ao limpar documentos: ${error.message}`, 'yellow');
    }
    
    log(`\n✅ Testes concluídos!\n`, 'green');
    
    process.exit(testsFailed === 0 ? 0 : 1);
}

// Executar testes
runTests().catch((error) => {
    log(`\n❌ ERRO FATAL: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});



