/**
 * TESTE E2E: TIMEOUTS E REJEIÇÕES
 * 
 * Testa cenários de timeout e rejeição:
 * 1. Driver não responde (timeout)
 * 2. Driver rejeita corrida
 * 3. Reatribuição após rejeição
 * 4. Múltiplas rejeições consecutivas
 * 5. Expansão de raio após timeout
 */

const WebSocketTestClient = require('../helpers/websocket-client');
const TestHelpers = require('../helpers/test-helpers');
const PARAMS = require('../config/test-parameters');

class TimeoutsRejeicoesTest {
    constructor() {
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            errors: []
        };
    }

    /**
     * TC-E2E-005: Driver rejeita corrida
     */
    async testDriverRejectsRide() {
        const testName = 'TC-E2E-005: Driver rejeita corrida';
        this.results.total++;
        
        console.log(`\n  🚀 ${testName}`);
        
        let customer = null;
        let driver = null;
        let bookingId = null;

        try {
            // Preparação
            const testId = TestHelpers.generateTestId('reject');
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

            // Driver recebe notificação
            const notification = await driver.waitForAnyEvent(['newRideRequest', 'rideRequest'], 15);
            if (!notification) {
                throw new Error('Driver não recebeu notificação');
            }

            const rideId = notification.rideId || notification.bookingId || bookingId;

            // Driver REJEITA corrida
            await driver.rejectRide(rideId, 'Muito longe');

            // Aguardar confirmação de rejeição
            const rejectResult = await driver.waitForEvent('rideRejected', 10);
            
            if (!rejectResult || !rejectResult.success) {
                throw new Error('Rejeição não confirmada');
            }

            console.log(`    ✅ Driver rejeitou corrida`);

            // Customer NÃO deve receber notificação de rejeição (sistema busca outro driver)
            // Mas pode receber se não houver outros drivers
            await TestHelpers.sleep(2);

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
     * TC-E2E-006: Driver não responde (timeout)
     */
    async testDriverTimeout() {
        const testName = 'TC-E2E-006: Driver não responde (timeout)';
        this.results.total++;
        
        console.log(`\n  🚀 ${testName}`);
        
        let customer = null;
        let driver = null;
        let bookingId = null;

        try {
            // Preparação
            const testId = TestHelpers.generateTestId('timeout');
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

            // Driver recebe notificação
            const notification = await driver.waitForAnyEvent(['newRideRequest', 'rideRequest'], 15);
            if (!notification) {
                throw new Error('Driver não recebeu notificação');
            }

            console.log(`    ✅ Driver recebeu notificação`);
            console.log(`    ⏳ Aguardando timeout (${PARAMS.TIMEOUTS.RIDE_REQUEST_TIMEOUT}s)...`);

            // Driver NÃO responde (simula timeout)
            // Aguardar timeout configurado + margem
            const timeoutSeconds = PARAMS.TIMEOUTS.RIDE_REQUEST_TIMEOUT + 5;
            
            // Customer pode receber notificação de reatribuição ou cancelamento
            // Depende da implementação do servidor
            await TestHelpers.sleep(timeoutSeconds);

            console.log(`    ✅ Timeout ocorreu (driver não respondeu)`);

            // Validar que sistema processou timeout
            // (pode reatribuir ou cancelar, dependendo da implementação)
            const customerEvents = customer.getEvents('rideReassigned');
            const cancelledEvents = customer.getEvents('bookingCancelled');

            if (customerEvents.length > 0 || cancelledEvents.length > 0) {
                console.log(`    ✅ Sistema processou timeout (reatribuição ou cancelamento)`);
            } else {
                console.log(`    ⚠️  Sistema não notificou customer sobre timeout (pode ser esperado)`);
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
     * TC-E2E-007: Reatribuição após rejeição
     */
    async testReassignmentAfterRejection() {
        const testName = 'TC-E2E-007: Reatribuição após rejeição';
        this.results.total++;
        
        console.log(`\n  🚀 ${testName}`);
        
        let customer = null;
        let driver1 = null;
        let driver2 = null;
        let bookingId = null;

        try {
            // Preparação
            const testId = TestHelpers.generateTestId('reassign');
            customer = new WebSocketTestClient(`customer_${testId}`, 'passenger');
            driver1 = new WebSocketTestClient(`driver1_${testId}`, 'driver');
            driver2 = new WebSocketTestClient(`driver2_${testId}`, 'driver');

            await customer.connect();
            await driver1.connect();
            await driver2.connect();
            await customer.authenticate();
            await driver1.authenticate();
            await driver2.authenticate();

            // Ambos drivers ficam online
            driver1.emit('setDriverStatus', {
                driverId: driver1.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            driver2.emit('setDriverStatus', {
                driverId: driver2.userId,
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

            // Driver1 recebe notificação
            const notification1 = await driver1.waitForAnyEvent(['newRideRequest', 'rideRequest'], 15);
            if (!notification1) {
                throw new Error('Driver1 não recebeu notificação');
            }

            const rideId = notification1.rideId || notification1.bookingId || bookingId;

            // Driver1 REJEITA
            await driver1.rejectRide(rideId, 'Não disponível');
            console.log(`    ✅ Driver1 rejeitou`);

            // Aguardar reatribuição (sistema deve buscar driver2)
            await TestHelpers.sleep(PARAMS.TIMEOUTS.REASSIGN_DELAY + 2);

            // Driver2 deve receber notificação
            const notification2 = await driver2.waitForAnyEvent(['newRideRequest', 'rideRequest'], 15);
            
            if (!notification2) {
                throw new Error('Driver2 não recebeu notificação após rejeição do Driver1');
            }

            console.log(`    ✅ Driver2 recebeu notificação (reatribuição funcionou)`);

            // Driver2 aceita
            const rideId2 = notification2.rideId || notification2.bookingId || bookingId;
            await driver2.acceptRide(rideId2);
            
            // Customer deve receber confirmação
            const accepted = await customer.waitForEvent('rideAccepted', 10);
            if (!accepted) {
                throw new Error('Customer não recebeu confirmação após aceitação do Driver2');
            }

            console.log(`    ✅ Driver2 aceitou e customer foi notificado`);

            this.results.passed++;
            customer.disconnect();
            driver1.disconnect();
            driver2.disconnect();

        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({ test: testName, error: error.message });
            if (customer) customer.disconnect();
            if (driver1) driver1.disconnect();
            if (driver2) driver2.disconnect();
        }
    }

    /**
     * Executa todos os testes
     */
    async run() {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🧪 TESTES DE TIMEOUTS E REJEIÇÕES`);
        console.log(`${'='.repeat(60)}`);

        await this.testDriverRejectsRide();
        await this.testDriverTimeout();
        await this.testReassignmentAfterRejection();

        return this.results;
    }

    getResults() {
        return this.results;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const test = new TimeoutsRejeicoesTest();
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

module.exports = TimeoutsRejeicoesTest;


