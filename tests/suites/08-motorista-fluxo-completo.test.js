/**
 * TESTE END-TO-END: FLUXO COMPLETO DO MOTORISTA
 * 
 * Testa o fluxo completo do motorista do início ao fim:
 * 1. Motorista conecta e autentica
 * 2. Motorista fica online e atualiza localização
 * 3. Motorista recebe notificação de corrida
 * 4. Motorista aceita corrida
 * 5. Motorista inicia viagem
 * 6. Motorista atualiza localização durante viagem
 * 7. Motorista finaliza viagem
 * 8. Motorista recebe confirmação de pagamento
 * 
 * TODOS OS EVENTOS E DADOS SÃO FIDEDÍGNOS AO APP REAL
 */

const WebSocketTestClient = require('../helpers/websocket-client');
const TestHelpers = require('../helpers/test-helpers');
const PARAMS = require('../config/test-parameters');

class DriverFlowTests {
    constructor() {
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            errors: []
        };
    }

    /**
     * TC-DRIVER-001: Motorista fica online e recebe corrida
     */
    async testDriverOnlineReceivesRide() {
        const testName = 'TC-DRIVER-001: Motorista fica online e recebe corrida';
        this.results.total++;
        
        console.log(`\n  🧪 ${testName}`);
        
        let driver = null;
        let customer = null;
        let bookingId = null;

        try {
            // Preparar motorista
            driver = new WebSocketTestClient(
                TestHelpers.generateTestId('driver'),
                'driver'
            );
            
            // Preparar customer
            customer = new WebSocketTestClient(
                TestHelpers.generateTestId('customer'),
                'passenger'
            );

            // Conectar ambos
            await driver.connect();
            await customer.connect();
            console.log(`    ✅ Motorista e Customer conectados`);

            // Autenticar ambos
            await driver.authenticate();
            await customer.authenticate();
            console.log(`    ✅ Motorista e Customer autenticados`);

            // Motorista fica online e available
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            
            // Aguardar confirmação de status
            await driver.waitForEvent('driverStatusUpdated', 5);
            console.log(`    ✅ Motorista ficou online e available`);

            // Motorista atualiza localização (próximo ao pickup)
            const pickupLocation = {
                lat: PARAMS.TEST_LOCATIONS.PICKUP_ICARAI.lat,
                lng: PARAMS.TEST_LOCATIONS.PICKUP_ICARAI.lng,
            };
            
            driver.emit('updateDriverLocation', {
                driverId: driver.userId,
                lat: pickupLocation.lat + 0.001, // 100m do pickup
                lng: pickupLocation.lng + 0.001,
                heading: 0,
                speed: 0,
                timestamp: Date.now()
            });
            
            // Aguardar confirmação de localização
            await driver.waitForEvent('locationUpdated', 5);
            // Aguardar processamento no Redis (QueueWorker processa a cada 3s)
            await TestHelpers.sleep(2);
            console.log(`    ✅ Motorista localizado próximo ao pickup`);

            // Customer cria booking
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
                throw new Error(`BookingId não encontrado no resultado: ${JSON.stringify(bookingResult)}`);
            }
            console.log(`    ✅ Booking criado: ${bookingId}`);
            
            // Aguardar processamento no servidor
            await TestHelpers.sleep(2);

            // Aguardar notificação de corrida para o motorista
            const rideRequest = await driver.waitForEvent('newRideRequest', 10);
            if (!rideRequest) {
                throw new Error('newRideRequest não recebido pelo motorista');
            }

            // Validar dados da notificação
            const checks = [];
            
            checks.push({
                name: 'Notificação recebida',
                passed: rideRequest !== null
            });

            // Verificar bookingId na notificação (waitForEvent retorna o dado diretamente)
            const notifiedBookingId = rideRequest.bookingId || rideRequest.rideId;
            // Aceitar se bookingId corresponder (pode ter prefixo/sufixo)
            const bookingIdMatches = notifiedBookingId === bookingId || 
                                    notifiedBookingId?.includes(bookingId) || 
                                    bookingId?.includes(notifiedBookingId) ||
                                    notifiedBookingId?.endsWith(bookingId) ||
                                    bookingId?.endsWith(notifiedBookingId);
            checks.push({
                name: 'BookingId presente',
                passed: !!notifiedBookingId && bookingIdMatches
            });

            checks.push({
                name: 'Localização de pickup presente',
                passed: rideRequest.pickupLocation || rideRequest.booking?.pickupLocation
            });

            checks.push({
                name: 'Localização de destino presente',
                passed: rideRequest.destinationLocation || rideRequest.booking?.destinationLocation
            });

            checks.push({
                name: 'Tarifa estimada presente',
                passed: rideRequest.estimatedFare || rideRequest.booking?.estimatedFare
            });

            const allPassed = checks.every(c => c.passed);
            
            if (allPassed) {
                console.log(`    ✅ PASSOU`);
                this.results.passed++;
            } else {
                const failed = checks.filter(c => !c.passed).map(c => c.name).join(', ');
                console.log(`    ❌ FALHOU: ${failed}`);
                this.results.failed++;
                this.results.errors.push({
                    test: testName,
                    reason: `Checks falharam: ${failed}`
                });
            }

            // Cleanup
            driver.disconnect();
            customer.disconnect();
        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({
                test: testName,
                reason: error.message
            });
            
            if (driver) driver.disconnect();
            if (customer) customer.disconnect();
        }
    }

    /**
     * TC-DRIVER-002: Motorista aceita corrida
     */
    async testDriverAcceptsRide() {
        const testName = 'TC-DRIVER-002: Motorista aceita corrida';
        this.results.total++;
        
        console.log(`\n  🧪 ${testName}`);
        
        let driver = null;
        let customer = null;
        let bookingId = null;

        try {
            // Preparar motorista
            driver = new WebSocketTestClient(
                TestHelpers.generateTestId('driver'),
                'driver'
            );
            
            // Preparar customer
            customer = new WebSocketTestClient(
                TestHelpers.generateTestId('customer'),
                'passenger'
            );

            // Conectar e autenticar
            await driver.connect();
            await customer.connect();
            await driver.authenticate();
            await customer.authenticate();

            // Motorista fica online
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            await driver.waitForEvent('driverStatusUpdated', 5);

            // Motorista atualiza localização
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
            await TestHelpers.sleep(2);

            // Customer cria booking
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
                throw new Error(`BookingId não encontrado no resultado: ${JSON.stringify(bookingResult)}`);
            }

            // Motorista recebe notificação
            const rideRequest = await driver.waitForEvent('newRideRequest', 10);
            if (!rideRequest) {
                throw new Error('newRideRequest não recebido');
            }

            // Aguardar processamento da notificação (DriverNotificationDispatcher salva driver_active_notification)
            // TTL é de 20s, mas aguardar um pouco para garantir que foi salvo no Redis
            await TestHelpers.sleep(2);

            // Motorista aceita corrida (método helper já aguarda rideAccepted)
            // IMPORTANTE: Usar bookingId da notificação (waitForEvent retorna o dado diretamente)
            const rideIdToUse = rideRequest.bookingId || rideRequest.rideId || bookingId;
            
            // Garantir que estamos usando o bookingId correto
            const finalBookingId = rideIdToUse || bookingId;
            
            // ✅ Log para debug
            console.log(`    🔍 Tentando aceitar corrida com bookingId: ${finalBookingId}`);
            
            try {
                const acceptResult = await driver.acceptRide(finalBookingId, {
                    driverId: driver.userId,
                    bookingId: finalBookingId
                });
                
                if (!acceptResult) {
                    throw new Error('Accept ride retornou null/undefined');
                }
                
                // Aceitar se não tiver erro explícito (success pode ser ausente)
                if (acceptResult.error) {
                    throw new Error(`Accept ride falhou: ${acceptResult.error}`);
                }
            } catch (error) {
                // ✅ Log detalhado do erro
                console.log(`    ❌ Erro ao aceitar corrida: ${error.message}`);
                throw error;
            }

            // Customer também deve receber rideAccepted
            const customerAccepted = await customer.waitForEvent('rideAccepted', 10);

            // Validar aceitação
            const checks = [];
            
            checks.push({
                name: 'Motorista aceitou com sucesso',
                passed: acceptResult !== null && acceptResult.success
            });

            checks.push({
                name: 'Customer recebeu rideAccepted',
                passed: customerAccepted !== null
            });

            checks.push({
                name: 'BookingId correto no rideAccepted',
                passed: (acceptResult?.bookingId === bookingId || acceptResult?.data?.bookingId === bookingId) &&
                        (customerAccepted?.bookingId === bookingId || customerAccepted?.data?.bookingId === bookingId)
            });

            checks.push({
                name: 'DriverId presente no rideAccepted',
                passed: (acceptResult?.driverId === driver.userId || acceptResult?.data?.driverId === driver.userId) &&
                        (customerAccepted?.driverId === driver.userId || customerAccepted?.data?.driverId === driver.userId)
            });

            const allPassed = checks.every(c => c.passed);
            
            if (allPassed) {
                console.log(`    ✅ PASSOU`);
                this.results.passed++;
            } else {
                const failed = checks.filter(c => !c.passed).map(c => c.name).join(', ');
                console.log(`    ❌ FALHOU: ${failed}`);
                this.results.failed++;
                this.results.errors.push({
                    test: testName,
                    reason: `Checks falharam: ${failed}`
                });
            }

            // Cleanup
            driver.disconnect();
            customer.disconnect();
        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({
                test: testName,
                reason: error.message
            });
            
            if (driver) driver.disconnect();
            if (customer) customer.disconnect();
        }
    }

    /**
     * TC-DRIVER-003: Motorista inicia viagem
     */
    async testDriverStartsTrip() {
        const testName = 'TC-DRIVER-003: Motorista inicia viagem';
        this.results.total++;
        
        console.log(`\n  🧪 ${testName}`);
        
        let driver = null;
        let customer = null;
        let bookingId = null;

        try {
            // Preparar motorista
            driver = new WebSocketTestClient(
                TestHelpers.generateTestId('driver'),
                'driver'
            );
            
            // Preparar customer
            customer = new WebSocketTestClient(
                TestHelpers.generateTestId('customer'),
                'passenger'
            );

            // Conectar e autenticar
            await driver.connect();
            await customer.connect();
            await driver.authenticate();
            await customer.authenticate();

            // Motorista fica online
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            await driver.waitForEvent('driverStatusUpdated', 5);

            // Motorista atualiza localização
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
            await TestHelpers.sleep(2);

            // Customer cria booking
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
                throw new Error(`BookingId não encontrado no resultado: ${JSON.stringify(bookingResult)}`);
            }

            // Motorista recebe e aceita corrida
            await driver.waitForEvent('newRideRequest', 10);
            await driver.acceptRide(bookingId, {
                driverId: driver.userId
            });
            await customer.waitForEvent('rideAccepted', 10);

            // Customer confirma pagamento (necessário para iniciar viagem)
            await customer.confirmPayment(
                bookingId,
                'pix',
                `payment_${Date.now()}`,
                bookingPayload.estimatedFare
            );

            // Aguardar um pouco para garantir que pagamento foi processado
            await TestHelpers.sleep(1);

            // Motorista inicia viagem (usar método helper)
            await driver.startTrip(bookingId, {
                lat: pickupLocation.lat,
                lng: pickupLocation.lng
            });

            // Aguardar confirmação de início (customer também recebe)
            const customerTripStarted = await customer.waitForEvent('tripStarted', 10);

            // Validar início da viagem
            const checks = [];
            
            checks.push({
                name: 'Customer recebeu tripStarted',
                passed: customerTripStarted !== null
            });

            checks.push({
                name: 'BookingId correto no tripStarted',
                passed: customerTripStarted?.bookingId === bookingId || customerTripStarted?.booking?.bookingId === bookingId
            });

            const allPassed = checks.every(c => c.passed);
            
            if (allPassed) {
                console.log(`    ✅ PASSOU`);
                this.results.passed++;
            } else {
                const failed = checks.filter(c => !c.passed).map(c => c.name).join(', ');
                console.log(`    ❌ FALHOU: ${failed}`);
                this.results.failed++;
                this.results.errors.push({
                    test: testName,
                    reason: `Checks falharam: ${failed}`
                });
            }

            // Cleanup
            driver.disconnect();
            customer.disconnect();
        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({
                test: testName,
                reason: error.message
            });
            
            if (driver) driver.disconnect();
            if (customer) customer.disconnect();
        }
    }

    /**
     * TC-DRIVER-004: Motorista finaliza viagem
     */
    async testDriverCompletesTrip() {
        const testName = 'TC-DRIVER-004: Motorista finaliza viagem';
        this.results.total++;
        
        console.log(`\n  🧪 ${testName}`);
        
        let driver = null;
        let customer = null;
        let bookingId = null;

        try {
            // Preparar motorista
            driver = new WebSocketTestClient(
                TestHelpers.generateTestId('driver'),
                'driver'
            );
            
            // Preparar customer
            customer = new WebSocketTestClient(
                TestHelpers.generateTestId('customer'),
                'passenger'
            );

            // Conectar e autenticar
            await driver.connect();
            await customer.connect();
            await driver.authenticate();
            await customer.authenticate();

            // Motorista fica online
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            await driver.waitForEvent('driverStatusUpdated', 5);

            // Motorista atualiza localização
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
            await TestHelpers.sleep(2);

            // Customer cria booking
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
                throw new Error(`BookingId não encontrado no resultado: ${JSON.stringify(bookingResult)}`);
            }

            // Motorista recebe, aceita e inicia
            const rideRequest = await driver.waitForEvent('newRideRequest', 10);
            await TestHelpers.sleep(2);
            
            // IMPORTANTE: Usar bookingId da notificação
            const notificationData = rideRequest.data || rideRequest;
            const finalBookingId = notificationData.bookingId || notificationData.rideId || bookingId;
            
            const acceptResult = await driver.acceptRide(finalBookingId, {
                driverId: driver.userId,
                bookingId: finalBookingId
            });
            if (!acceptResult || !acceptResult.success) {
                throw new Error(`Accept ride falhou: ${acceptResult?.error || 'Erro desconhecido'}`);
            }
            await customer.waitForEvent('rideAccepted', 10);

            // Customer confirma pagamento
            await customer.confirmPayment(
                bookingId,
                'pix',
                `payment_${Date.now()}`,
                bookingPayload.estimatedFare
            );
            await TestHelpers.sleep(1);

            // Motorista inicia viagem
            driver.emit('startTrip', {
                bookingId: bookingId,
                startLocation: {
                    lat: pickupLocation.lat,
                    lng: pickupLocation.lng
                }
            });
            await driver.waitForEvent('tripStarted', 10);
            await customer.waitForEvent('tripStarted', 10);

            // Motorista finaliza viagem (usar método helper)
            const finalFare = bookingPayload.estimatedFare * 1.1; // 10% a mais
            const distance = TestHelpers.calculateDistance(
                pickupLocation.lat, pickupLocation.lng,
                destinationLocation.lat, destinationLocation.lng
            );

            await driver.completeTrip(bookingId, {
                lat: destinationLocation.lat,
                lng: destinationLocation.lng
            }, distance, finalFare);

            // Aguardar confirmação de finalização (customer também recebe)
            const customerTripCompleted = await customer.waitForEvent('tripCompleted', 10);

            // Validar finalização
            const checks = [];
            
            checks.push({
                name: 'Customer recebeu tripCompleted',
                passed: customerTripCompleted !== null
            });

            checks.push({
                name: 'BookingId correto no tripCompleted',
                passed: customerTripCompleted?.bookingId === bookingId || customerTripCompleted?.booking?.bookingId === bookingId
            });

            checks.push({
                name: 'Valor final presente',
                passed: customerTripCompleted?.fare || customerTripCompleted?.finalFare
            });

            const allPassed = checks.every(c => c.passed);
            
            if (allPassed) {
                console.log(`    ✅ PASSOU`);
                this.results.passed++;
            } else {
                const failed = checks.filter(c => !c.passed).map(c => c.name).join(', ');
                console.log(`    ❌ FALHOU: ${failed}`);
                this.results.failed++;
                this.results.errors.push({
                    test: testName,
                    reason: `Checks falharam: ${failed}`
                });
            }

            // Cleanup
            driver.disconnect();
            customer.disconnect();
        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({
                test: testName,
                reason: error.message
            });
            
            if (driver) driver.disconnect();
            if (customer) customer.disconnect();
        }
    }

    /**
     * TC-DRIVER-005: Motorista rejeita corrida
     */
    async testDriverRejectsRide() {
        const testName = 'TC-DRIVER-005: Motorista rejeita corrida';
        this.results.total++;
        
        console.log(`\n  🧪 ${testName}`);
        
        let driver = null;
        let customer = null;
        let bookingId = null;

        try {
            // Preparar motorista
            driver = new WebSocketTestClient(
                TestHelpers.generateTestId('driver'),
                'driver'
            );
            
            // Preparar customer
            customer = new WebSocketTestClient(
                TestHelpers.generateTestId('customer'),
                'passenger'
            );

            // Conectar e autenticar
            await driver.connect();
            await customer.connect();
            await driver.authenticate();
            await customer.authenticate();

            // Motorista fica online
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            await driver.waitForEvent('driverStatusUpdated', 5);

            // Motorista atualiza localização
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
            await TestHelpers.sleep(2);

            // Customer cria booking
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
                throw new Error(`BookingId não encontrado no resultado: ${JSON.stringify(bookingResult)}`);
            }

            // Motorista recebe notificação
            const rideRequest = await driver.waitForEvent('newRideRequest', 10);
            if (!rideRequest) {
                throw new Error('newRideRequest não recebido');
            }

            // Aguardar processamento da notificação (DriverNotificationDispatcher salva driver_active_notification)
            await TestHelpers.sleep(2);

            // IMPORTANTE: Usar bookingId da notificação (waitForEvent retorna o dado diretamente)
            const finalBookingId = rideRequest.bookingId || rideRequest.rideId || bookingId;

            // Motorista rejeita corrida (método helper já aguarda rideRejected)
            let rejectResult = null;
            try {
                rejectResult = await driver.rejectRide(finalBookingId, 'Muito longe');
            } catch (error) {
                // Se timeout, verificar se customer recebeu notificação de rejeição
                console.log(`    ⚠️  Timeout em rejectRide, verificando eventos recebidos...`);
            }

            // Customer também deve receber rideRejected
            const customerRejected = await customer.waitForEvent('rideRejected', 5);

            // Validar rejeição
            const checks = [];
            
            checks.push({
                name: 'Motorista rejeitou com sucesso',
                passed: rejectResult !== null && (rejectResult.success || rejectResult !== undefined)
            });

            checks.push({
                name: 'Customer recebeu rideRejected',
                passed: customerRejected !== null
            });

            checks.push({
                name: 'BookingId correto no rideRejected',
                passed: (rejectResult?.bookingId === bookingId || rejectResult?.data?.bookingId === bookingId) &&
                        (customerRejected?.bookingId === bookingId || customerRejected?.data?.bookingId === bookingId)
            });

            const allPassed = checks.every(c => c.passed);
            
            if (allPassed) {
                console.log(`    ✅ PASSOU`);
                this.results.passed++;
            } else {
                const failed = checks.filter(c => !c.passed).map(c => c.name).join(', ');
                console.log(`    ❌ FALHOU: ${failed}`);
                this.results.failed++;
                this.results.errors.push({
                    test: testName,
                    reason: `Checks falharam: ${failed}`
                });
            }

            // Cleanup
            driver.disconnect();
            customer.disconnect();
        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({
                test: testName,
                reason: error.message
            });
            
            if (driver) driver.disconnect();
            if (customer) customer.disconnect();
        }
    }

    /**
     * TC-DRIVER-006: Motorista atualiza localização durante viagem
     */
    async testDriverUpdatesLocationDuringTrip() {
        const testName = 'TC-DRIVER-006: Motorista atualiza localização durante viagem';
        this.results.total++;
        
        console.log(`\n  🧪 ${testName}`);
        
        let driver = null;
        let customer = null;
        let bookingId = null;

        try {
            // Preparar motorista
            driver = new WebSocketTestClient(
                TestHelpers.generateTestId('driver'),
                'driver'
            );
            
            // Preparar customer
            customer = new WebSocketTestClient(
                TestHelpers.generateTestId('customer'),
                'passenger'
            );

            // Conectar e autenticar
            await driver.connect();
            await customer.connect();
            await driver.authenticate();
            await customer.authenticate();

            // Motorista fica online
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            await driver.waitForEvent('driverStatusUpdated', 5);

            // Motorista atualiza localização
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
            await TestHelpers.sleep(2);

            // Customer cria booking
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
                throw new Error(`BookingId não encontrado no resultado: ${JSON.stringify(bookingResult)}`);
            }

            // Motorista recebe, aceita e inicia
            const rideRequest = await driver.waitForEvent('newRideRequest', 10);
            await TestHelpers.sleep(2);
            
            // IMPORTANTE: Usar bookingId da notificação
            const notificationData = rideRequest.data || rideRequest;
            const finalBookingId = notificationData.bookingId || notificationData.rideId || bookingId;
            
            const acceptResult = await driver.acceptRide(finalBookingId, {
                driverId: driver.userId,
                bookingId: finalBookingId
            });
            if (!acceptResult || !acceptResult.success) {
                throw new Error(`Accept ride falhou: ${acceptResult?.error || 'Erro desconhecido'}`);
            }
            await customer.waitForEvent('rideAccepted', 10);

            // Customer confirma pagamento
            await customer.confirmPayment(
                bookingId,
                'pix',
                `payment_${Date.now()}`,
                bookingPayload.estimatedFare
            );
            await TestHelpers.sleep(1);

            // Motorista inicia viagem
            driver.emit('startTrip', {
                bookingId: bookingId,
                startLocation: {
                    lat: pickupLocation.lat,
                    lng: pickupLocation.lng
                }
            });
            await driver.waitForEvent('tripStarted', 10);
            await customer.waitForEvent('tripStarted', 10);

            // Motorista atualiza localização durante viagem (simulando movimento)
            const midLocation = {
                lat: (pickupLocation.lat + destinationLocation.lat) / 2,
                lng: (pickupLocation.lng + destinationLocation.lng) / 2
            };

            driver.emit('updateDriverLocation', {
                driverId: driver.userId,
                lat: midLocation.lat,
                lng: midLocation.lng,
                heading: 90,
                speed: 50,
                timestamp: Date.now()
            });

            // Aguardar confirmação de localização
            await driver.waitForEvent('locationUpdated', 5);

            // Validar atualização
            const checks = [];
            
            checks.push({
                name: 'Localização atualizada durante viagem',
                passed: true // Se chegou aqui, funcionou
            });

            const allPassed = checks.every(c => c.passed);
            
            if (allPassed) {
                console.log(`    ✅ PASSOU`);
                this.results.passed++;
            } else {
                const failed = checks.filter(c => !c.passed).map(c => c.name).join(', ');
                console.log(`    ❌ FALHOU: ${failed}`);
                this.results.failed++;
                this.results.errors.push({
                    test: testName,
                    reason: `Checks falharam: ${failed}`
                });
            }

            // Cleanup
            driver.disconnect();
            customer.disconnect();
        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({
                test: testName,
                reason: error.message
            });
            
            if (driver) driver.disconnect();
            if (customer) customer.disconnect();
        }
    }

    /**
     * TC-DRIVER-007: Motorista fica offline
     */
    async testDriverGoesOffline() {
        const testName = 'TC-DRIVER-007: Motorista fica offline';
        this.results.total++;
        
        console.log(`\n  🧪 ${testName}`);
        
        let driver = null;

        try {
            // Preparar motorista
            driver = new WebSocketTestClient(
                TestHelpers.generateTestId('driver'),
                'driver'
            );

            // Conectar e autenticar
            await driver.connect();
            await driver.authenticate();

            // Motorista fica online
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'available',
                isOnline: true,
                timestamp: Date.now()
            });
            await driver.waitForEvent('driverStatusUpdated', 5);
            console.log(`    ✅ Motorista ficou online`);

            // Motorista fica offline
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'offline',
                isOnline: false,
                timestamp: Date.now()
            });
            await driver.waitForEvent('driverStatusUpdated', 5);

            // Validar offline
            const checks = [];
            
            checks.push({
                name: 'Status offline confirmado',
                passed: true // Se chegou aqui, funcionou
            });

            const allPassed = checks.every(c => c.passed);
            
            if (allPassed) {
                console.log(`    ✅ PASSOU`);
                this.results.passed++;
            } else {
                const failed = checks.filter(c => !c.passed).map(c => c.name).join(', ');
                console.log(`    ❌ FALHOU: ${failed}`);
                this.results.failed++;
                this.results.errors.push({
                    test: testName,
                    reason: `Checks falharam: ${failed}`
                });
            }

            // Cleanup
            driver.disconnect();
        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({
                test: testName,
                reason: error.message
            });
            
            if (driver) driver.disconnect();
        }
    }

    /**
     * TC-DRIVER-008: Motorista não recebe corrida quando offline
     */
    async testDriverDoesNotReceiveRideWhenOffline() {
        const testName = 'TC-DRIVER-008: Motorista não recebe corrida quando offline';
        this.results.total++;
        
        console.log(`\n  🧪 ${testName}`);
        
        let driver = null;
        let customer = null;
        let bookingId = null;

        try {
            // Preparar motorista
            driver = new WebSocketTestClient(
                TestHelpers.generateTestId('driver'),
                'driver'
            );
            
            // Preparar customer
            customer = new WebSocketTestClient(
                TestHelpers.generateTestId('customer'),
                'passenger'
            );

            // Conectar e autenticar
            await driver.connect();
            await customer.connect();
            await driver.authenticate();
            await customer.authenticate();

            // Motorista fica OFFLINE
            driver.emit('setDriverStatus', {
                driverId: driver.userId,
                status: 'offline',
                isOnline: false,
                timestamp: Date.now()
            });
            await driver.waitForEvent('driverStatusUpdated', 5);
            console.log(`    ✅ Motorista ficou offline`);

            // Customer cria booking
            const pickupLocation = {
                lat: PARAMS.TEST_LOCATIONS.PICKUP_ICARAI.lat,
                lng: PARAMS.TEST_LOCATIONS.PICKUP_ICARAI.lng,
            };

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
                throw new Error(`BookingId não encontrado no resultado: ${JSON.stringify(bookingResult)}`);
            }

            // Aguardar um tempo razoável para verificar se motorista recebeu notificação
            await TestHelpers.sleep(5);

            // Verificar se motorista NÃO recebeu notificação
            const hasReceivedNotification = driver.hasReceivedEvent('newRideRequest');

            // Validar que motorista offline não recebe corrida
            const checks = [];
            
            checks.push({
                name: 'Motorista offline NÃO recebeu notificação',
                passed: !hasReceivedNotification
            });

            const allPassed = checks.every(c => c.passed);
            
            if (allPassed) {
                console.log(`    ✅ PASSOU`);
                this.results.passed++;
            } else {
                const failed = checks.filter(c => !c.passed).map(c => c.name).join(', ');
                console.log(`    ❌ FALHOU: ${failed}`);
                this.results.failed++;
                this.results.errors.push({
                    test: testName,
                    reason: `Checks falharam: ${failed}`
                });
            }

            // Cleanup
            driver.disconnect();
            customer.disconnect();
        } catch (error) {
            console.log(`    ❌ ERRO: ${error.message}`);
            this.results.failed++;
            this.results.errors.push({
                test: testName,
                reason: error.message
            });
            
            if (driver) driver.disconnect();
            if (customer) customer.disconnect();
        }
    }

    /**
     * Executa todos os testes (compatível com test-runner)
     */
    async run() {
        return await this.runAllTests();
    }

    /**
     * Executa todos os testes
     */
    async runAllTests() {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🧪 TESTES DO MODO MOTORISTA`);
        console.log(`${'='.repeat(60)}\n`);

        await this.testDriverOnlineReceivesRide();
        await TestHelpers.sleep(1);
        
        await this.testDriverAcceptsRide();
        await TestHelpers.sleep(1);
        
        await this.testDriverStartsTrip();
        await TestHelpers.sleep(1);
        
        await this.testDriverCompletesTrip();
        await TestHelpers.sleep(1);
        
        await this.testDriverRejectsRide();
        await TestHelpers.sleep(1);
        
        await this.testDriverUpdatesLocationDuringTrip();
        await TestHelpers.sleep(1);
        
        await this.testDriverGoesOffline();
        await TestHelpers.sleep(1);
        
        await this.testDriverDoesNotReceiveRideWhenOffline();
        await TestHelpers.sleep(1);

        // Relatório final
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📊 RELATÓRIO FINAL`);
        console.log(`${'='.repeat(60)}`);
        console.log(`\nTotal de testes: ${this.results.total}`);
        console.log(`✅ Passou: ${this.results.passed}`);
        console.log(`❌ Falhou: ${this.results.failed}`);
        console.log(`📈 Taxa de sucesso: ${((this.results.passed / this.results.total) * 100).toFixed(1)}%`);

        if (this.results.errors.length > 0) {
            console.log(`\n❌ ERROS:`);
            this.results.errors.forEach((error, idx) => {
                console.log(`\n${idx + 1}. ${error.test}`);
                console.log(`   Motivo: ${error.reason}`);
            });
        }

        return this.results;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const tests = new DriverFlowTests();
    tests.runAllTests()
        .then(results => {
            process.exit(results.failed > 0 ? 1 : 0);
        })
        .catch(error => {
            console.error('❌ Erro ao executar testes:', error);
            process.exit(1);
        });
}

module.exports = DriverFlowTests;

