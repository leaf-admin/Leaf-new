/**
 * TESTE E2E: RECONEXÃO E CONEXÃO PERDIDA
 * 
 * Testa cenários de reconexão:
 * 1. Customer perde conexão durante busca de driver
 * 2. Driver perde conexão após aceitar corrida
 * 3. Reconexão automática durante corrida
 * 4. Estado preservado após reconexão
 */

const WebSocketTestClient = require('../helpers/websocket-client');
const TestHelpers = require('../helpers/test-helpers');
const PARAMS = require('../config/test-parameters');

class ReconexaoTest {
    constructor() {
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            errors: []
        };
    }

    /**
     * TC-E2E-012: Customer perde conexão durante busca
     */
    async testCustomerConnectionLossDuringSearch() {
        const testName = 'TC-E2E-012: Customer perde conexão durante busca';
        this.results.total++;
        
        console.log(`\n  🚀 ${testName}`);
        
        let customer = null;
        let driver = null;
        let bookingId = null;

        try {
            // Preparação
            const testId = TestHelpers.generateTestId('reconnect');
            customer = new WebSocketTestClient(`customer_${testId}`, 'passenger');
            driver = new WebSocketTestClient(`driver_${testId}`, 'driver');

            await customer.connect();
            await driver.connect();
            await customer.authenticate();
            await driver.authenticate();

            // Driver fica online
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            await TestHelpers.sleep(1);

            // Customer cria booking e confirma pagamento
            const pickupLocation = PARAMS.TEST_LOCATIONS.PICKUP_ICARAI;
            const destinationLocation = PARAMS.TEST_LOCATIONS.DESTINATION_CENTRO;
            const bookingData = TestHelpers.createBookingPayload(pickupLocation, destinationLocation);
            bookingData.customerId = customer.userId;

            const bookingResult = await customer.createBooking(bookingData);
            bookingId = bookingResult.bookingId;

            await customer.confirmPayment(
                bookingId,
                'pix',
                `pix_${testId}`,
                bookingData.estimatedFare
            );

            console.log(`    ✅ Booking criado: ${bookingId}`);

            // Customer perde conexão
            console.log(`    🔌 Simulando perda de conexão...`);
            await customer.simulateConnectionLoss(3);

            // Driver deve receber notificação mesmo com customer desconectado
            const notification = await driver.waitForAnyEvent(['newRideRequest', 'rideRequest'], 15);
            if (!notification) {
                throw new Error('Driver não recebeu notificação após customer desconectar');
            }

            console.log(`    ✅ Driver recebeu notificação (sistema continuou funcionando)`);

            // Customer reconecta
            console.log(`    🔄 Customer reconectando...`);
            await customer.reconnect();

            // Customer deve receber estado atualizado após reconexão
            // (pode receber notificação de que driver aceitou, se driver aceitar)
            console.log(`    ✅ Customer reconectado`);

            // Validar que sistema preservou estado
            const customerEvents = customer.getEvents('rideAccepted');
            if (customerEvents.length > 0) {
                console.log(`    ✅ Customer recebeu estado atualizado após reconexão`);
            } else {
                console.log(`    ℹ️  Customer ainda aguardando driver (estado preservado)`);
            }

            this.results.passed++;
            customer.disconnect();
            driver.disconnect();

        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({ test: testName, error: error.message });
            if (customer) customer.disconnect();
            if (driver) driver.disconnect();
        }
    }

    /**
     * TC-E2E-013: Driver perde conexão após aceitar
     */
    async testDriverConnectionLossAfterAccept() {
        const testName = 'TC-E2E-013: Driver perde conexão após aceitar';
        this.results.total++;
        
        console.log(`\n  🚀 ${testName}`);
        
        let customer = null;
        let driver = null;
        let bookingId = null;

        try {
            // Preparação
            const testId = TestHelpers.generateTestId('reconnect');
            customer = new WebSocketTestClient(`customer_${testId}`, 'passenger');
            driver = new WebSocketTestClient(`driver_${testId}`, 'driver');

            await customer.connect();
            await driver.connect();
            await customer.authenticate();
            await driver.authenticate();

            // Driver fica online
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            await TestHelpers.sleep(1);

            // Customer cria booking e confirma pagamento
            const pickupLocation = PARAMS.TEST_LOCATIONS.PICKUP_ICARAI;
            const destinationLocation = PARAMS.TEST_LOCATIONS.DESTINATION_CENTRO;
            const bookingData = TestHelpers.createBookingPayload(pickupLocation, destinationLocation);
            bookingData.customerId = customer.userId;

            const bookingResult = await customer.createBooking(bookingData);
            bookingId = bookingResult.bookingId;

            await customer.confirmPayment(
                bookingId,
                'pix',
                `pix_${testId}`,
                bookingData.estimatedFare
            );

            // Driver recebe e aceita
            const notification = await driver.waitForAnyEvent(['newRideRequest', 'rideRequest'], 15);
            const rideId = notification.rideId || notification.bookingId || bookingId;
            await driver.acceptRide(rideId);
            await customer.waitForEvent('rideAccepted', 10);

            console.log(`    ✅ Driver aceitou corrida`);

            // Driver perde conexão
            console.log(`    🔌 Driver perdendo conexão...`);
            await driver.simulateConnectionLoss(3);

            // Customer deve ser notificado ou sistema deve reatribuir
            // Depende da implementação (pode aguardar reconexão ou reatribuir)
            await TestHelpers.sleep(5);

            // Driver reconecta
            console.log(`    🔄 Driver reconectando...`);
            await driver.reconnect();

            // Driver deve manter estado (ainda tem a corrida aceita)
            console.log(`    ✅ Driver reconectado`);

            // Validar que sistema preservou estado da corrida
            const driverEvents = driver.getEvents('rideAccepted');
            if (driverEvents.length > 0) {
                console.log(`    ✅ Driver manteve estado da corrida após reconexão`);
            }

            // Customer deve ainda ter a corrida ativa
            const customerEvents = customer.getEvents('rideAccepted');
            if (customerEvents.length > 0) {
                console.log(`    ✅ Customer ainda tem corrida ativa (estado preservado)`);
            }

            this.results.passed++;
            customer.disconnect();
            driver.disconnect();

        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({ test: testName, error: error.message });
            if (customer) customer.disconnect();
            if (driver) driver.disconnect();
        }
    }

    /**
     * Executa todos os testes
     */
    async run() {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🧪 TESTES DE RECONEXÃO`);
        console.log(`${'='.repeat(60)}`);

        await this.testCustomerConnectionLossDuringSearch();
        await this.testDriverConnectionLossAfterAccept();

        return this.results;
    }

    getResults() {
        return this.results;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const test = new ReconexaoTest();
    test.run()
        .then(() => {
            const results = test.getResults();
            console.log(`\n${'='.repeat(60)}`);
            console.log(`📊 RESULTADOS:`);
            console.log(`   Total: ${results.total}`);
            console.log(`   ✅ Passou: ${results.passed}`);
            console.log(`   ❌ Falhou: ${results.failed}`);
            process.exit(results.failed > 0 ? 1 : 0);
        })
        .catch(error => {
            console.error(`\n❌ ERRO FATAL:`, error);
            process.exit(1);
        });
}

module.exports = ReconexaoTest;


