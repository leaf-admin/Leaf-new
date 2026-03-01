/**
 * TESTE E2E COMPLETO: FLUXO DE CORRIDA END-TO-END
 * 
 * Testa o fluxo completo de uma corrida do início ao fim, validando:
 * 1. Orquestração de eventos (ambos os lados recebem)
 * 2. Distribuição correta para motorista e passageiro
 * 3. Todos os eventos críticos do fluxo
 * 4. Sincronização entre motorista e passageiro
 * 
 * Este teste valida que a orquestração está funcionando corretamente.
 */

const WebSocketTestClient = require('../helpers/websocket-client');
const TestHelpers = require('../helpers/test-helpers');
const PARAMS = require('../config/test-parameters');

class E2ECompleteFlowTest {
    constructor() {
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            errors: []
        };
    }

    /**
     * TC-E2E-001: Fluxo completo de corrida E2E
     * Valida que todos os eventos são orquestrados e distribuídos corretamente
     */
    async testCompleteRideFlowE2E() {
        const testName = 'TC-E2E-001: Fluxo completo de corrida E2E';
        this.results.total++;
        
        console.log(`\n  🧪 ${testName}`);
        
        let driver = null;
        let customer = null;
        let bookingId = null;
        const eventsReceived = {
            driver: {},
            customer: {}
        };

        try {
            // ========================================
            // FASE 1: CONEXÃO E AUTENTICAÇÃO
            // ========================================
            console.log(`\n    📱 Fase 1: Conectando e autenticando...`);
            
            driver = new WebSocketTestClient(TestHelpers.generateTestId('driver'), 'driver');
            customer = new WebSocketTestClient(TestHelpers.generateTestId('customer'), 'passenger');
            
            await driver.connect();
            await customer.connect();
            await driver.authenticate();
            await customer.authenticate();
            
            console.log(`    ✅ Ambos conectados e autenticados`);

            // ========================================
            // FASE 2: DRIVER FICA ONLINE E ATUALIZA LOCALIZAÇÃO
            // ========================================
            console.log(`\n    🚗 Fase 2: Driver fica online...`);
            
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            await driver.waitForEvent('driverStatusUpdated', 5);

            const pickupLocation = {
                lat: PARAMS.TEST_LOCATIONS.PICKUP_ICARAI.lat,
                lng: PARAMS.TEST_LOCATIONS.PICKUP_ICARAI.lng,
            };
            
            driver.emit('updateDriverLocation', {
                driverId: driver.userId,
                lat: pickupLocation.lat + 0.001,
                lng: pickupLocation.lng + 0.001,
                heading: 0,
                speed: 0,
                timestamp: Date.now()
            });
            await driver.waitForEvent('locationUpdated', 5);
            await TestHelpers.sleep(2); // Aguardar processamento no Redis

            console.log(`    ✅ Driver online e localização atualizada`);

            // ========================================
            // FASE 3: CUSTOMER CRIA BOOKING
            // ========================================
            console.log(`\n    📝 Fase 3: Customer cria booking...`);
            
            const destinationLocation = {
                lat: PARAMS.TEST_LOCATIONS.DESTINATION_CENTRO.lat,
                lng: PARAMS.TEST_LOCATIONS.DESTINATION_CENTRO.lng,
            };

            const bookingPayload = TestHelpers.createBookingPayload(
                {
                    lat: pickupLocation.lat,
                    lng: pickupLocation.lng,
                    address: 'Rua de Teste, 123'
                },
                {
                    lat: destinationLocation.lat,
                    lng: destinationLocation.lng,
                    address: 'Rua de Destino, 456'
                },
                'Leaf Plus'
            );

            const bookingResult = await customer.createBooking({
                customerId: customer.userId,
                ...bookingPayload
            });
            bookingId = bookingResult.bookingId || bookingResult.data?.bookingId;
            
            if (!bookingId) {
                throw new Error(`BookingId não encontrado: ${JSON.stringify(bookingResult)}`);
            }
            
            console.log(`    ✅ Booking criado: ${bookingId}`);
            await TestHelpers.sleep(2); // Aguardar processamento

            // ========================================
            // FASE 4: DRIVER RECEBE NOTIFICAÇÃO
            // ========================================
            console.log(`\n    🔔 Fase 4: Driver recebe notificação...`);
            
            const rideRequest = await driver.waitForEvent('newRideRequest', 10);
            if (!rideRequest) {
                throw new Error('Driver não recebeu newRideRequest');
            }
            
            eventsReceived.driver.newRideRequest = rideRequest;
            console.log(`    ✅ Driver recebeu newRideRequest`);

            // ========================================
            // FASE 5: DRIVER ACEITA CORRIDA
            // ========================================
            console.log(`\n    ✅ Fase 5: Driver aceita corrida...`);
            
            await TestHelpers.sleep(2); // Aguardar processamento da notificação
            
            const finalBookingId = rideRequest.bookingId || rideRequest.rideId || bookingId;
            
            // ✅ CRÍTICO: Configurar listeners ANTES de aceitar (evita perder eventos)
            const driverAcceptedPromise = driver.waitForEvent('rideAccepted', 10);
            const customerAcceptedPromise = customer.waitForEvent('rideAccepted', 10);
            
            try {
                const acceptResult = await driver.acceptRide(finalBookingId, {
                    driverId: driver.userId,
                    bookingId: finalBookingId
                });
                
                if (acceptResult && acceptResult.error) {
                    throw new Error(`Accept ride falhou: ${acceptResult.error}`);
                }
                
                eventsReceived.driver.rideAccepted = acceptResult;
                console.log(`    ✅ Driver recebeu rideAccepted`);
            } catch (error) {
                console.log(`    ❌ Erro ao aceitar: ${error.message}`);
                throw error;
            }

            // Aguardar customer receber rideAccepted
            const customerAccepted = await customerAcceptedPromise;
            if (!customerAccepted) {
                throw new Error('Customer não recebeu rideAccepted');
            }
            
            eventsReceived.customer.rideAccepted = customerAccepted;
            console.log(`    ✅ Customer recebeu rideAccepted`);

            // ========================================
            // FASE 6: CUSTOMER CONFIRMA PAGAMENTO
            // ========================================
            console.log(`\n    💳 Fase 6: Customer confirma pagamento...`);
            
            await customer.confirmPayment(
                bookingId,
                'pix',
                `payment_${Date.now()}`,
                bookingPayload.estimatedFare
            );
            
            const paymentConfirmed = await customer.waitForEvent('paymentConfirmed', 10);
            if (!paymentConfirmed) {
                throw new Error('Customer não recebeu paymentConfirmed');
            }
            
            eventsReceived.customer.paymentConfirmed = paymentConfirmed;
            console.log(`    ✅ Customer recebeu paymentConfirmed`);
            await TestHelpers.sleep(1);

            // ========================================
            // FASE 7: DRIVER INICIA VIAGEM
            // ========================================
            console.log(`\n    🚀 Fase 7: Driver inicia viagem...`);
            
            // Configurar listeners ANTES de enviar evento
            const driverTripStartedPromise = driver.waitForEvent('tripStarted', 10);
            const customerTripStartedPromise = customer.waitForEvent('tripStarted', 10);
            
            driver.emit('startTrip', {
                bookingId: bookingId,
                rideId: bookingId,
                driverId: driver.userId,
                startLocation: {
                    lat: pickupLocation.lat,
                    lng: pickupLocation.lng
                },
                timestamp: Date.now()
            });
            
            const startTripResult = await driverTripStartedPromise;
            if (!startTripResult) {
                throw new Error('Driver não recebeu tripStarted');
            }
            
            eventsReceived.driver.tripStarted = startTripResult;
            console.log(`    ✅ Driver recebeu tripStarted`);

            // Aguardar customer receber tripStarted
            const customerTripStarted = await customerTripStartedPromise;
            if (!customerTripStarted) {
                throw new Error('Customer não recebeu tripStarted');
            }
            
            eventsReceived.customer.tripStarted = customerTripStarted;
            console.log(`    ✅ Customer recebeu tripStarted`);

            // ========================================
            // FASE 8: DRIVER ATUALIZA LOCALIZAÇÃO DURANTE VIAGEM
            // ========================================
            console.log(`\n    📍 Fase 8: Driver atualiza localização durante viagem...`);
            
            // Simular movimento do motorista
            for (let i = 0; i < 3; i++) {
                driver.emit('updateTripLocation', {
                    bookingId: bookingId,
                    rideId: bookingId,
                    lat: pickupLocation.lat + (i * 0.001),
                    lng: pickupLocation.lng + (i * 0.001),
                    heading: 90,
                    speed: 30,
                    timestamp: Date.now()
                });
                await TestHelpers.sleep(0.5);
            }
            
            console.log(`    ✅ Localização atualizada durante viagem`);

            // ========================================
            // FASE 9: DRIVER COMPLETA VIAGEM
            // ========================================
            console.log(`\n    🏁 Fase 9: Driver completa viagem...`);
            
            const distance = 5.2; // km
            const fare = bookingPayload.estimatedFare;
            
            // Configurar listeners ANTES de enviar evento
            const driverTripCompletedPromise = driver.waitForEvent('tripCompleted', 10);
            const customerTripCompletedPromise = customer.waitForEvent('tripCompleted', 10);
            
            driver.emit('completeTrip', {
                bookingId: bookingId,
                rideId: bookingId,
                driverId: driver.userId,
                endLocation: {
                    lat: destinationLocation.lat,
                    lng: destinationLocation.lng
                },
                distance: distance,
                fare: fare,
                timestamp: Date.now()
            });
            
            const completeResult = await driverTripCompletedPromise;
            if (!completeResult) {
                throw new Error('Driver não recebeu tripCompleted');
            }
            
            eventsReceived.driver.tripCompleted = completeResult;
            console.log(`    ✅ Driver recebeu tripCompleted`);

            // Aguardar customer receber tripCompleted
            const customerTripCompleted = await customerTripCompletedPromise;
            if (!customerTripCompleted) {
                throw new Error('Customer não recebeu tripCompleted');
            }
            
            eventsReceived.customer.tripCompleted = customerTripCompleted;
            console.log(`    ✅ Customer recebeu tripCompleted`);

            // ========================================
            // VALIDAÇÕES FINAIS
            // ========================================
            console.log(`\n    ✅ Validando orquestração de eventos...`);
            
            const validations = [];
            
            // Validar que ambos receberam rideAccepted
            validations.push({
                name: 'Driver recebeu rideAccepted',
                passed: !!eventsReceived.driver.rideAccepted
            });
            
            validations.push({
                name: 'Customer recebeu rideAccepted',
                passed: !!eventsReceived.customer.rideAccepted
            });
            
            // Validar que ambos receberam tripStarted
            validations.push({
                name: 'Driver recebeu tripStarted',
                passed: !!eventsReceived.driver.tripStarted
            });
            
            validations.push({
                name: 'Customer recebeu tripStarted',
                passed: !!eventsReceived.customer.tripStarted
            });
            
            // Validar que ambos receberam tripCompleted
            validations.push({
                name: 'Driver recebeu tripCompleted',
                passed: !!eventsReceived.driver.tripCompleted
            });
            
            validations.push({
                name: 'Customer recebeu tripCompleted',
                passed: !!eventsReceived.customer.tripCompleted
            });
            
            // Validar bookingId em todos os eventos
            const allEventsHaveBookingId = [
                eventsReceived.driver.rideAccepted,
                eventsReceived.customer.rideAccepted,
                eventsReceived.driver.tripStarted,
                eventsReceived.customer.tripStarted,
                eventsReceived.driver.tripCompleted,
                eventsReceived.customer.tripCompleted
            ].every(event => {
                if (!event) return false;
                const eventBookingId = event.bookingId || event.data?.bookingId || event.rideId;
                return eventBookingId === bookingId || eventBookingId?.includes(bookingId) || bookingId?.includes(eventBookingId);
            });
            
            validations.push({
                name: 'BookingId correto em todos os eventos',
                passed: allEventsHaveBookingId
            });

            const allPassed = validations.every(v => v.passed);
            
            if (allPassed) {
                console.log(`    ✅ TODAS as validações passaram`);
                console.log(`\n    📊 RESUMO DE EVENTOS:`);
                console.log(`       Driver: ${Object.keys(eventsReceived.driver).length} eventos`);
                console.log(`       Customer: ${Object.keys(eventsReceived.customer).length} eventos`);
                this.results.passed++;
            } else {
                const failed = validations.filter(v => !v.passed).map(v => v.name).join(', ');
                console.log(`    ❌ FALHOU: ${failed}`);
                this.results.failed++;
                this.results.errors.push({
                    test: testName,
                    reason: `Validações falharam: ${failed}`,
                    eventsReceived
                });
            }

        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({
                test: testName,
                reason: error.message,
                stack: error.stack,
                eventsReceived
            });
        } finally {
            driver?.disconnect();
            customer?.disconnect();
        }
    }

    /**
     * Executar todos os testes
     */
    async runAll() {
        console.log('\n============================================================');
        console.log('🧪 TESTES E2E - FLUXO COMPLETO DE CORRIDA');
        console.log('============================================================\n');

        await this.testCompleteRideFlowE2E();

        // Relatório final
        console.log('\n============================================================');
        console.log('📊 RELATÓRIO FINAL');
        console.log('============================================================\n');

        console.log(`Total de testes: ${this.results.total}`);
        console.log(`✅ Passou: ${this.results.passed}`);
        console.log(`❌ Falhou: ${this.results.failed}`);
        console.log(`📈 Taxa de sucesso: ${((this.results.passed / this.results.total) * 100).toFixed(1)}%`);

        if (this.results.errors.length > 0) {
            console.log(`\n❌ ERROS:\n`);
            this.results.errors.forEach((error, index) => {
                console.log(`${index + 1}. ${error.test}`);
                console.log(`   Motivo: ${error.reason}`);
            });
        }

        return this.results;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const test = new E2ECompleteFlowTest();
    test.runAll()
        .then(results => {
            process.exit(results.failed > 0 ? 1 : 0);
        })
        .catch(error => {
            console.error('❌ Erro ao executar testes:', error);
            process.exit(1);
        });
}

module.exports = new E2ECompleteFlowTest();

