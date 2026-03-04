/**
 * LOAD & STRESS TEST - LEAF BACKEND (V2)
 * 
 * Este teste simula cenários de alta concorrência.
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const RedisDriverSimulator = require('../__helpers__/redis-driver-simulator');
const testData = require('../__fixtures__/test-data');
const { logger } = require('../../../../utils/logger');

const WS_URL = process.env.WS_URL || 'http://localhost:3001';

describe('Testes de Carga e Estresse - Backend Leaf', () => {
    let drivers = [];
    const NUM_DRIVERS = 60; // Aumentado para suportar ondas de 5 motoristas por corrida
    const NUM_PASSENGERS_STRESS = 50;
    const NUM_SIMULTANEOUS_RIDES = 10;
    const driverSim = new RedisDriverSimulator();

    beforeAll(async () => {
        // Inicializar motoristas no Redis (Espalhados para evitar muita sobreposição)
        for (let i = 1; i <= NUM_DRIVERS; i++) {
            const driverId = `driver_load_${i}`;
            // Espalhar motoristas em um grid
            const latOffset = (Math.floor(i / 10) * 0.01);
            const lngOffset = ((i % 10) * 0.01);
            await driverSim.setDriverOnline(driverId, -23.5505 + latOffset, -46.6333 + lngOffset);
            drivers.push(driverId);
        }
        console.log(`✅ ${NUM_DRIVERS} motoristas inicializados no Redis.`);
    });

    afterAll(async () => {
        // Limpar motoristas
        for (const driverId of drivers) {
            await driverSim.removeDriver(driverId);
        }
    });

    test('Cenário 1: 10 Corridas Simultâneas Completas', async () => {
        console.log(`\n🚀 Iniciando simulação de ${NUM_SIMULTANEOUS_RIDES} corridas simultâneas...`);

        const runSingleRide = async (index) => {
            const passengerId = `passenger_load_${index}`;
            // Cada corrida tenta pegar um motorista específico (opcional, o sistema que decide)
            const driverId = `driver_load_${index}`;

            const client = new WebSocketTestClient(WS_URL);
            const dClient = new WebSocketTestClient(WS_URL);

            try {
                await client.connect();
                await dClient.connect();

                await client.authenticate(passengerId, 'customer');
                await dClient.authenticate(driverId, 'driver');

                // Pickup espalhado para cada par (Passenger/Driver)
                const latOffset = (Math.floor(index / 10) * 0.01);
                const lngOffset = ((index % 10) * 0.01);
                const pickup = { lat: -23.5505 + latOffset, lng: -46.6333 + lngOffset, address: `Origem ${index}` };
                const destination = { lat: -23.5605 + latOffset, lng: -46.6433 + lngOffset, address: `Destino ${index}` };

                const bookingData = testData.booking.createBookingData(pickup, destination, passengerId);
                const booking = await client.createBooking(bookingData);
                const bookingId = booking.bookingId;

                const paymentData = testData.payment.createPaymentData(bookingId, 25.5);
                await client.confirmPayment(paymentData);

                // Driver aguarda notificação
                await dClient.waitForEvent('newRideRequest', 30000);
                await dClient.acceptRide(bookingId);

                const startTripData = testData.trip.createStartTripData(bookingId, pickup);
                await dClient.startTrip(startTripData);

                const finishTripData = testData.trip.createFinishTripData(bookingId, destination, 5.5, 25.5);
                const finishResponse = await dClient.finishTrip(finishTripData);

                return finishResponse.success;
            } catch (error) {
                console.error(`❌ Erro na corrida ${index} (${passengerId}): ${error.message}`);
                return false;
            } finally {
                client.disconnect();
                dClient.disconnect();
            }
        };

        const startTime = Date.now();
        const results = await Promise.all(
            Array.from({ length: NUM_SIMULTANEOUS_RIDES }, (_, i) => runSingleRide(i + 1))
        );
        const duration = (Date.now() - startTime) / 1000;

        const successCount = results.filter(r => r === true).length;
        console.log(`\n📊 Resultado Cenário 1:`);
        console.log(`   - Sucesso: ${successCount}/${NUM_SIMULTANEOUS_RIDES}`);
        console.log(`   - Duração Total: ${duration}s`);

        expect(successCount).toBe(NUM_SIMULTANEOUS_RIDES);
    }, 180000);

    test('Cenário 2: 50 Passageiros Solicitando Simultaneamente', async () => {
        console.log(`\n🚀 Iniciando simulação de ${NUM_PASSENGERS_STRESS} solicitações simultâneas...`);

        const runRequestOnly = async (index) => {
            const passengerId = `passenger_stress_${index}`;
            const client = new WebSocketTestClient(WS_URL);

            try {
                await client.connect();
                await client.authenticate(passengerId, 'customer');

                const bookingData = testData.booking.createBookingData(null, null, passengerId);
                const booking = await client.createBooking(bookingData);
                return booking.bookingId;
            } catch (error) {
                throw error;
            } finally {
                client.disconnect();
            }
        };

        const startTime = Date.now();
        const results = await Promise.allSettled(
            Array.from({ length: NUM_PASSENGERS_STRESS }, (_, i) => runRequestOnly(i + 1))
        );
        const duration = (Date.now() - startTime) / 1000;

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        console.log(`\n📊 Resultado Cenário 2:`);
        console.log(`   - Sucesso (Booking Criado): ${successCount}/${NUM_PASSENGERS_STRESS}`);
        console.log(`   - Tempo Total: ${duration}s`);

        expect(successCount).toBeGreaterThan(NUM_PASSENGERS_STRESS * 0.8);
    }, 90000);

    test('Cenário 3: 25 Motoristas Competindo pelo Aceite', async () => {
        // Usar motoristas do 30 em diante para evitar locks dos testes anteriores
        const COMPETITION_DRIVERS = 25;
        const OFFSET = 30;

        console.log(`\n🚀 Iniciando simulação de 1 corrida vs ${COMPETITION_DRIVERS} motoristas tentando aceitar...`);

        const passengerId = 'passenger_competition_v2';
        const client = new WebSocketTestClient(WS_URL);

        await client.connect();
        await client.authenticate(passengerId, 'customer');

        // Pickup fixo para competição
        const pickup = { lat: -23.5700, lng: -46.6500, address: 'Shopping Ibirapuera' };

        // Garantir que os motoristas da competição estejam PERTO deste local
        for (let i = 1; i <= COMPETITION_DRIVERS; i++) {
            const driverId = `driver_load_${OFFSET + i}`;
            await driverSim.setDriverOnline(driverId, -23.5700, -46.6500); // Exatamente no pickup
        }

        const bookingData = testData.booking.createBookingData(pickup, null, passengerId);
        const booking = await client.createBooking(bookingData);
        const bookingId = booking.bookingId;

        const paymentData = testData.payment.createPaymentData(bookingId, 30);
        await client.confirmPayment(paymentData);

        // Criar clientes de motoristas
        const driverClients = [];
        for (let i = 1; i <= COMPETITION_DRIVERS; i++) {
            const dClient = new WebSocketTestClient(WS_URL);
            await dClient.connect();
            await dClient.authenticate(`driver_load_${OFFSET + i}`, 'driver');
            driverClients.push(dClient);
        }

        console.log(`   - ${COMPETITION_DRIVERS} motoristas aguardando newRideRequest...`);

        // Aguardar notificações
        const notificationPromises = driverClients.map(d =>
            d.waitForEvent('newRideRequest', 45000).catch(e => null)
        );
        const receivedNotifications = await Promise.all(notificationPromises);
        const notifiedCount = receivedNotifications.filter(n => n !== null).length;

        console.log(`   - Motoristas notificados: ${notifiedCount}/${COMPETITION_DRIVERS}`);

        // Disparar aceite de todos que receberam
        const startTime = Date.now();
        const results = await Promise.allSettled(
            driverClients.filter((_, i) => receivedNotifications[i] !== null).map(d => d.acceptRide(bookingId))
        );
        const duration = (Date.now() - startTime) / 1000;

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failureCount = results.filter(r => r.status === 'rejected').length;

        console.log(`\n📊 Resultado Cenário 3 (Atomicidade LUA):`);
        console.log(`   - Tentativas de aceite: ${results.length}`);
        console.log(`   - Sucessos: ${successCount}`);
        console.log(`   - Falhas: ${failureCount}`);

        expect(successCount).toBe(1);
        expect(failureCount).toBe(results.length - 1);

        for (const d of driverClients) d.disconnect();
        client.disconnect();
    }, 180000);
});
