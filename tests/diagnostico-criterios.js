/**
 * DIAGNÓSTICO DE CRITÉRIOS DOS TESTES
 * 
 * Verifica se os critérios necessários para cada teste estão sendo atendidos
 */

const io = require('socket.io-client');
const PARAMS = require('./config/test-parameters');

async function verificarCriterios() {
    console.log('🔍 DIAGNÓSTICO DE CRITÉRIOS DOS TESTES\n');
    console.log('='.repeat(60));
    
    const driverId = `test_driver_diagnostico_${Date.now()}`;
    const customerId = `test_customer_diagnostico_${Date.now()}`;
    
    // 1. Conectar e autenticar driver
    console.log('\n📋 TESTE 1: Conexão e Autenticação');
    console.log('-'.repeat(60));
    
    const driver = io(PARAMS.SERVER.WS_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
    });
    
    await new Promise((resolve, reject) => {
        driver.on('connect', () => {
            console.log('✅ Driver conectado');
            resolve();
        });
        driver.on('connect_error', reject);
        setTimeout(() => reject(new Error('Timeout conexão')), 10000);
    });
    
    // Autenticar
    driver.emit('authenticate', { uid: driverId, userType: 'driver' });
    
    await new Promise((resolve, reject) => {
        driver.once('authenticated', (data) => {
            console.log('✅ Driver autenticado:', data.success ? 'SIM' : 'NÃO');
            resolve();
        });
        setTimeout(() => reject(new Error('Timeout autenticação')), 10000);
    });
    
    // 2. Verificar se driver está no room correto
    console.log('\n📋 TESTE 2: Driver em Room Correto');
    console.log('-'.repeat(60));
    // Nota: Não podemos verificar rooms do lado do cliente, mas podemos verificar se eventos chegam
    
    // 3. Configurar status do driver
    console.log('\n📋 TESTE 3: Configurar Status do Driver');
    console.log('-'.repeat(60));
    
    driver.emit('setDriverStatus', {
        driverId: driverId,
        status: 'available',
        isOnline: true,
        timestamp: Date.now()
    });
    
    let statusUpdated = false;
    await new Promise((resolve, reject) => {
        driver.once('driverStatusUpdated', (data) => {
            console.log('✅ driverStatusUpdated recebido:', data);
            statusUpdated = true;
            resolve();
        });
        setTimeout(() => {
            if (!statusUpdated) {
                console.log('⚠️ driverStatusUpdated NÃO recebido (pode ser normal)');
            }
            resolve();
        }, 5000);
    });
    
    // 4. Atualizar localização
    console.log('\n📋 TESTE 4: Atualizar Localização');
    console.log('-'.repeat(60));
    
    const pickupLocation = PARAMS.TEST_LOCATIONS.PICKUP_ICARAI;
    driver.emit('updateDriverLocation', {
        driverId: driverId,
        lat: pickupLocation.lat + 0.001,
        lng: pickupLocation.lng + 0.001,
        heading: 0,
        speed: 0,
        timestamp: Date.now()
    });
    
    let locationUpdated = false;
    await new Promise((resolve, reject) => {
        driver.once('locationUpdated', (data) => {
            console.log('✅ locationUpdated recebido:', data);
            locationUpdated = true;
            resolve();
        });
        setTimeout(() => {
            if (!locationUpdated) {
                console.log('⚠️ locationUpdated NÃO recebido (pode ser normal)');
            }
            resolve();
        }, 5000);
    });
    
    // 5. Aguardar um pouco para garantir que está no Redis
    console.log('\n📋 TESTE 5: Aguardar Processamento');
    console.log('-'.repeat(60));
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✅ Aguardado 2 segundos para processamento');
    
    // 6. Customer cria booking
    console.log('\n📋 TESTE 6: Customer Cria Booking');
    console.log('-'.repeat(60));
    
    const customer = io(PARAMS.SERVER.WS_URL, {
        reconnection: true,
    });
    
    await new Promise((resolve, reject) => {
        customer.on('connect', resolve);
        customer.on('connect_error', reject);
        setTimeout(() => reject(new Error('Timeout conexão customer')), 10000);
    });
    
    customer.emit('authenticate', { uid: customerId, userType: 'passenger' });
    
    await new Promise((resolve, reject) => {
        customer.once('authenticated', (data) => {
            console.log('✅ Customer autenticado:', data.success ? 'SIM' : 'NÃO');
            resolve();
        });
        setTimeout(() => reject(new Error('Timeout autenticação customer')), 10000);
    });
    
    const bookingData = {
        customerId: customerId,
        pickupLocation: {
            lat: pickupLocation.lat,
            lng: pickupLocation.lng,
            address: pickupLocation.address,
        },
        destinationLocation: {
            lat: PARAMS.TEST_LOCATIONS.DESTINATION_CENTRO.lat,
            lng: PARAMS.TEST_LOCATIONS.DESTINATION_CENTRO.lng,
            address: PARAMS.TEST_LOCATIONS.DESTINATION_CENTRO.address,
        },
        vehicleType: 'Leaf Plus',
        estimatedFare: 8.50,
        paymentMethod: 'pix',
    };
    
    customer.emit('createBooking', bookingData);
    
    let bookingCreated = false;
    let bookingId = null;
    
    await new Promise((resolve, reject) => {
        customer.once('bookingCreated', (data) => {
            console.log('✅ bookingCreated recebido:', data);
            bookingCreated = true;
            bookingId = data.bookingId || data.data?.bookingId;
            resolve();
        });
        setTimeout(() => {
            if (!bookingCreated) {
                console.log('❌ bookingCreated NÃO recebido');
            }
            resolve();
        }, 10000);
    });
    
    // 7. Verificar se driver recebe notificação
    console.log('\n📋 TESTE 7: Driver Recebe Notificação');
    console.log('-'.repeat(60));
    
    let notificationReceived = false;
    let notificationEvent = null;
    
    driver.on('newRideRequest', (data) => {
        console.log('✅ newRideRequest recebido:', data);
        notificationReceived = true;
        notificationEvent = 'newRideRequest';
    });
    
    driver.on('rideRequest', (data) => {
        console.log('✅ rideRequest recebido:', data);
        notificationReceived = true;
        notificationEvent = 'rideRequest';
    });
    
    // Aguardar até 15 segundos (timeout do teste)
    await new Promise((resolve) => {
        setTimeout(() => {
            if (notificationReceived) {
                console.log(`✅ Notificação recebida via evento: ${notificationEvent}`);
            } else {
                console.log('❌ Nenhuma notificação recebida após 15 segundos');
            }
            resolve();
        }, 15000);
    });
    
    // Resumo
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO DO DIAGNÓSTICO');
    console.log('='.repeat(60));
    console.log(`✅ Conexão Driver: ${driver.connected ? 'OK' : 'FALHOU'}`);
    console.log(`✅ Autenticação Driver: OK`);
    console.log(`✅ Status Atualizado: ${statusUpdated ? 'OK' : 'NÃO CONFIRMADO'}`);
    console.log(`✅ Localização Atualizada: ${locationUpdated ? 'OK' : 'NÃO CONFIRMADO'}`);
    console.log(`✅ Conexão Customer: ${customer.connected ? 'OK' : 'FALHOU'}`);
    console.log(`✅ Autenticação Customer: OK`);
    console.log(`✅ Booking Criado: ${bookingCreated ? 'OK' : 'FALHOU'}`);
    console.log(`✅ Notificação Recebida: ${notificationReceived ? 'OK' : 'FALHOU'}`);
    
    if (notificationReceived) {
        console.log(`   Evento: ${notificationEvent}`);
    }
    
    console.log('\n' + '='.repeat(60));
    
    // Limpar
    driver.disconnect();
    customer.disconnect();
    
    process.exit(notificationReceived ? 0 : 1);
}

verificarCriterios().catch(error => {
    console.error('❌ Erro no diagnóstico:', error);
    process.exit(1);
});

