/**
 * TESTE DE INTEGRAÇÃO: Refatoração Completa
 * 
 * Valida que Commands, EventBus e Listeners estão funcionando juntos.
 */

const RequestRideCommand = require('../../commands/RequestRideCommand');
const AcceptRideCommand = require('../../commands/AcceptRideCommand');
const { getEventBus } = require('../../listeners');
const { EVENT_TYPES } = require('../../events');
const redisPool = require('../../utils/redis-pool');

console.log('🧪 TESTE DE INTEGRAÇÃO: Refatoração Completa\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;
const eventsReceived = [];

async function test(name, fn) {
    try {
        await fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.error(`❌ ${name}: ${error.message}`);
        if (error.stack) {
            console.error(`   Stack: ${error.stack.split('\n').slice(1, 3).join('\n')}`);
        }
        failed++;
    }
}

async function runTests() {
    // Garantir conexão Redis
    try {
        await redisPool.ensureConnection();
        console.log('✅ Redis conectado\n');
    } catch (error) {
        console.error('❌ Erro ao conectar Redis:', error.message);
        process.exit(1);
    }

    // Criar EventBus (sem io para testes)
    const eventBus = getEventBus(null);
    await eventBus.initialize();

    // Registrar listener de teste para capturar eventos
    eventBus.on(EVENT_TYPES.RIDE_REQUESTED, async (event) => {
        eventsReceived.push({ type: EVENT_TYPES.RIDE_REQUESTED, data: event.data });
    });

    eventBus.on(EVENT_TYPES.RIDE_ACCEPTED, async (event) => {
        eventsReceived.push({ type: EVENT_TYPES.RIDE_ACCEPTED, data: event.data });
    });

    // Teste 1: RequestRideCommand + EventBus
    await test('RequestRideCommand - Executar e publicar evento', async () => {
        const command = new RequestRideCommand({
            customerId: 'test_customer_123',
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5515, lng: -46.6343 },
            estimatedFare: 25.50,
            paymentMethod: 'pix'
        });

        const result = await command.execute();

        if (!result.success) {
            throw new Error(`Command falhou: ${result.error}`);
        }

        // Publicar evento
        if (result.data.event) {
            await eventBus.publish({
                eventType: EVENT_TYPES.RIDE_REQUESTED,
                data: result.data.event
            });
        }

        // Verificar se evento foi recebido
        await new Promise(resolve => setTimeout(resolve, 200)); // Aguardar processamento assíncrono

        const receivedEvent = eventsReceived.find(e => e.type === EVENT_TYPES.RIDE_REQUESTED);
        if (!receivedEvent) {
            throw new Error('Evento ride.requested não foi recebido pelos listeners');
        }

        // Verificar estrutura do evento (pode estar em receivedEvent.data.data.bookingId)
        const eventBookingId = receivedEvent.data?.bookingId || receivedEvent.data?.data?.bookingId;
        if (!eventBookingId) {
            throw new Error('Evento recebido não tem bookingId na estrutura esperada');
        }

        if (eventBookingId !== result.data.bookingId) {
            throw new Error(`Evento recebido com bookingId incorreto: esperado ${result.data.bookingId}, recebido ${eventBookingId}`);
        }
    });

    // Teste 2: Verificar estrutura do EventBus
    await test('EventBus - Verificar estrutura', () => {
        if (!eventBus.publish) {
            throw new Error('EventBus não tem método publish');
        }
        if (!eventBus.on) {
            throw new Error('EventBus não tem método on');
        }
        if (!eventBus.listeners) {
            throw new Error('EventBus não tem listeners');
        }
    });

    // Teste 3: Verificar EVENT_TYPES
    await test('EVENT_TYPES - Verificar tipos disponíveis', () => {
        const requiredTypes = [
            'RIDE_REQUESTED',
            'RIDE_ACCEPTED',
            'RIDE_STARTED',
            'RIDE_COMPLETED',
            'RIDE_CANCELED'
        ];

        for (const type of requiredTypes) {
            if (!EVENT_TYPES[type]) {
                throw new Error(`EVENT_TYPES.${type} não está definido`);
            }
        }
    });

    // Teste 4: Verificar que commands retornam eventos
    await test('Commands - Verificar que retornam eventos', async () => {
        const command = new RequestRideCommand({
            customerId: 'test_customer_456',
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5515, lng: -46.6343 },
            estimatedFare: 30.00,
            paymentMethod: 'pix'
        });

        const result = await command.execute();

        if (!result.success) {
            throw new Error(`Command falhou: ${result.error}`);
        }

        if (!result.data.event) {
            throw new Error('Command não retornou evento');
        }

        // Verificar estrutura do evento (pode estar em event.data.bookingId)
        const eventBookingId = result.data.event.bookingId || result.data.event.data?.bookingId;
        if (!eventBookingId) {
            throw new Error('Evento não tem bookingId na estrutura esperada');
        }
    });

    console.log('\n' + '='.repeat(60));
    console.log(`\n📊 RESULTADO: ${passed} passou, ${failed} falhou\n`);

    if (failed === 0) {
        console.log('✅ TODOS OS TESTES DE INTEGRAÇÃO PASSARAM!');
        console.log(`📈 Eventos recebidos: ${eventsReceived.length}`);
        console.log('✅ Commands, EventBus e Listeners estão funcionando juntos!\n');
        process.exit(0);
    } else {
        console.log('❌ ALGUNS TESTES DE INTEGRAÇÃO FALHARAM!\n');
        process.exit(1);
    }
}

runTests().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});

