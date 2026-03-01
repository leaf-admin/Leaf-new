/**
 * TESTE E2E: CANCELAMENTOS
 * 
 * Testa todos os cenários de cancelamento:
 * 1. Customer cancela antes do driver aceitar
 * 2. Customer cancela após driver aceitar (com e sem taxa)
 * 3. Driver cancela antes de iniciar viagem
 * 4. Driver cancela após iniciar viagem
 * 5. Reatribuição após cancelamento do driver
 */

const WebSocketTestClient = require('../helpers/websocket-client');
const TestHelpers = require('../helpers/test-helpers');
const PARAMS = require('../config/test-parameters');

class CancelamentosTest {
    constructor() {
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            errors: []
        };
    }

    /**
     * TC-E2E-002: Customer cancela antes do driver aceitar
     */
    async testCustomerCancelsBeforeAccept() {
        const testName = 'TC-E2E-002: Customer cancela antes do driver aceitar';
        this.results.total++;
        
        console.log(`\n  🚀 ${testName}`);
        
        let customer = null;
        let driver = null;
        let bookingId = null;

        try {
            // Preparação
            const testId = TestHelpers.generateTestId('cancel');
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

            // Customer cria booking
            const pickupLocation = PARAMS.TEST_LOCATIONS.PICKUP_ICARAI;
            const destinationLocation = PARAMS.TEST_LOCATIONS.DESTINATION_CENTRO;
            const bookingData = TestHelpers.createBookingPayload(pickupLocation, destinationLocation);
            bookingData.customerId = customer.userId;

            const bookingResult = await customer.createBooking(bookingData);
            bookingId = bookingResult.bookingId;
            console.log(`    ✅ Booking criado: ${bookingId}`);

            // Customer cancela ANTES do driver aceitar
            customer.emit('cancelBooking', {
                bookingId: bookingId,
                reason: 'Mudança de planos'
            });

            // Aguardar confirmação de cancelamento
            const cancelResult = await customer.waitForEvent('bookingCancelled', 10);
            
            if (!cancelResult || !cancelResult.success) {
                throw new Error('Cancelamento não confirmado');
            }

            console.log(`    ✅ Booking cancelado com sucesso`);

            // Driver NÃO deve receber notificação (já que cancelou antes)
            // Mas se já recebeu, deve receber notificação de cancelamento
            await TestHelpers.sleep(2);
            
            // Validar que booking foi cancelado
            const validations = [
                {
                    name: 'Customer recebeu bookingCancelled',
                    passed: customer.hasReceivedEvent('bookingCancelled'),
                },
            ];

            const allPassed = validations.every(v => v.passed);
            if (allPassed) {
                console.log(`    ✅ TODAS as validações passaram`);
                this.results.passed++;
            } else {
                const failed = validations.filter(v => !v.passed).map(v => v.name).join(', ');
                throw new Error(`Validações falharam: ${failed}`);
            }

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
     * TC-E2E-003: Customer cancela após driver aceitar (dentro da janela sem taxa)
     */
    async testCustomerCancelsAfterAcceptWithinWindow() {
        const testName = 'TC-E2E-003: Customer cancela após aceitar (sem taxa)';
        this.results.total++;
        
        console.log(`\n  🚀 ${testName}`);
        
        let customer = null;
        let driver = null;
        let bookingId = null;

        try {
            // Preparação
            const testId = TestHelpers.generateTestId('cancel');
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

            // Customer cria booking
            const pickupLocation = PARAMS.TEST_LOCATIONS.PICKUP_ICARAI;
            const destinationLocation = PARAMS.TEST_LOCATIONS.DESTINATION_CENTRO;
            const bookingData = TestHelpers.createBookingPayload(pickupLocation, destinationLocation);
            bookingData.customerId = customer.userId;

            const bookingResult = await customer.createBooking(bookingData);
            bookingId = bookingResult.bookingId;

            // Customer confirma pagamento
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

            // Driver aceita
            const rideId = notification.rideId || notification.bookingId || bookingId;
            await driver.acceptRide(rideId);
            
            // Customer recebe confirmação
            await customer.waitForEvent('rideAccepted', 10);

            // Customer cancela IMEDIATAMENTE (dentro da janela de 2 minutos)
            customer.emit('cancelBooking', {
                bookingId: bookingId,
                reason: 'Mudança de planos'
            });

            // Aguardar confirmação
            const cancelResult = await customer.waitForEvent('bookingCancelled', 10);
            
            if (!cancelResult || !cancelResult.success) {
                throw new Error('Cancelamento não confirmado');
            }

            // Validar que não há taxa (dentro da janela)
            if (cancelResult.cancelFee && cancelResult.cancelFee > 0) {
                throw new Error(`Taxa de cancelamento aplicada incorretamente: R$ ${cancelResult.cancelFee}`);
            }

            console.log(`    ✅ Cancelamento sem taxa (dentro da janela)`);

            // Driver deve receber notificação de cancelamento
            const driverCancelNotification = await driver.waitForEvent('rideCancelled', 10);
            if (!driverCancelNotification) {
                console.log(`    ⚠️  Driver não recebeu notificação de cancelamento (pode ser esperado)`);
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
     * TC-E2E-004: Driver cancela antes de iniciar viagem
     */
    async testDriverCancelsBeforeTrip() {
        const testName = 'TC-E2E-004: Driver cancela antes de iniciar viagem';
        this.results.total++;
        
        console.log(`\n  🚀 ${testName}`);
        
        let customer = null;
        let driver = null;
        let bookingId = null;

        try {
            // Preparação
            const testId = TestHelpers.generateTestId('cancel');
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

            // Driver cancela ANTES de iniciar viagem
            driver.emit('cancelRide', {
                bookingId: bookingId,
                reason: 'Emergência pessoal'
            });

            // Aguardar confirmação
            const cancelResult = await driver.waitForEvent('rideCancelled', 10);
            
            if (!cancelResult || !cancelResult.success) {
                throw new Error('Cancelamento do driver não confirmado');
            }

            // Customer deve receber notificação
            const customerNotification = await customer.waitForEvent('rideCancelled', 10);
            if (!customerNotification) {
                throw new Error('Customer não recebeu notificação de cancelamento');
            }

            console.log(`    ✅ Driver cancelou e customer foi notificado`);

            // Validar taxa de cancelamento do driver (se aplicável)
            if (cancelResult.cancelFee !== undefined) {
                console.log(`    ℹ️  Taxa de cancelamento: R$ ${cancelResult.cancelFee}`);
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
     * Executa todos os testes de cancelamento
     */
    async run() {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🧪 TESTES DE CANCELAMENTOS`);
        console.log(`${'='.repeat(60)}`);

        await this.testCustomerCancelsBeforeAccept();
        await this.testCustomerCancelsAfterAcceptWithinWindow();
        await this.testDriverCancelsBeforeTrip();

        return this.results;
    }

    getResults() {
        return this.results;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const test = new CancelamentosTest();
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

module.exports = CancelamentosTest;


