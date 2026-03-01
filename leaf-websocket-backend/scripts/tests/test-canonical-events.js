/**
 * TESTE: Eventos Canônicos
 * 
 * Valida estrutura e validação de eventos canônicos.
 */

const RideRequestedEvent = require('../../events/ride.requested');
const RideAcceptedEvent = require('../../events/ride.accepted');
const RideRejectedEvent = require('../../events/ride.rejected');
const RideCanceledEvent = require('../../events/ride.canceled');
const RideStartedEvent = require('../../events/ride.started');
const RideCompletedEvent = require('../../events/ride.completed');
const DriverOnlineEvent = require('../../events/driver.online');
const DriverOfflineEvent = require('../../events/driver.offline');
const PaymentConfirmedEvent = require('../../events/payment.confirmed');

console.log('🧪 TESTE: Eventos Canônicos\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.error(`❌ ${name}: ${error.message}`);
        failed++;
    }
}

// Teste 1: RideRequestedEvent
test('RideRequestedEvent - Criar evento válido', () => {
    const event = new RideRequestedEvent({
        bookingId: 'booking_123',
        customerId: 'customer_456',
        pickupLocation: { lat: -23.5505, lng: -46.6333 },
        destinationLocation: { lat: -23.5515, lng: -46.6343 },
        estimatedFare: 25.50,
        paymentMethod: 'pix'
    });
    
    if (!event.eventId) throw new Error('eventId não foi gerado');
    if (!event.occurredAt) throw new Error('occurredAt não foi definido');
    if (event.eventType !== 'ride.requested') throw new Error('eventType incorreto');
    event.validate();
});

test('RideRequestedEvent - Falhar sem bookingId', () => {
    try {
        new RideRequestedEvent({
            customerId: 'customer_456',
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5515, lng: -46.6343 },
            estimatedFare: 25.50,
            paymentMethod: 'pix'
        });
        throw new Error('Deveria ter falhado sem bookingId');
    } catch (error) {
        if (!error.message.includes('bookingId')) {
            throw error;
        }
    }
});

// Teste 2: RideAcceptedEvent
test('RideAcceptedEvent - Criar evento válido', () => {
    const event = new RideAcceptedEvent({
        bookingId: 'booking_123',
        driverId: 'driver_789',
        customerId: 'customer_456'
    });
    
    if (!event.eventId) throw new Error('eventId não foi gerado');
    if (event.eventType !== 'ride.accepted') throw new Error('eventType incorreto');
    event.validate();
});

// Teste 3: RideRejectedEvent
test('RideRejectedEvent - Criar evento válido', () => {
    const event = new RideRejectedEvent({
        bookingId: 'booking_123',
        driverId: 'driver_789',
        reason: 'Motorista indisponível'
    });
    
    if (!event.eventId) throw new Error('eventId não foi gerado');
    if (event.eventType !== 'ride.rejected') throw new Error('eventType incorreto');
    event.validate();
});

// Teste 4: RideCanceledEvent
test('RideCanceledEvent - Criar evento válido', () => {
    const event = new RideCanceledEvent({
        bookingId: 'booking_123',
        canceledBy: 'customer_456',
        reason: 'Mudança de planos',
        cancellationFee: 5.00
    });
    
    if (!event.eventId) throw new Error('eventId não foi gerado');
    if (event.eventType !== 'ride.canceled') throw new Error('eventType incorreto');
    event.validate();
});

// Teste 5: RideStartedEvent
test('RideStartedEvent - Criar evento válido', () => {
    const event = new RideStartedEvent({
        bookingId: 'booking_123',
        driverId: 'driver_789',
        customerId: 'customer_456',
        startLocation: { lat: -23.5505, lng: -46.6333 }
    });
    
    if (!event.eventId) throw new Error('eventId não foi gerado');
    if (event.eventType !== 'ride.started') throw new Error('eventType incorreto');
    event.validate();
});

// Teste 6: RideCompletedEvent
test('RideCompletedEvent - Criar evento válido', () => {
    const event = new RideCompletedEvent({
        bookingId: 'booking_123',
        driverId: 'driver_789',
        customerId: 'customer_456',
        endLocation: { lat: -23.5515, lng: -46.6343 },
        finalFare: 30.00,
        distance: 5.2,
        duration: 1200
    });
    
    if (!event.eventId) throw new Error('eventId não foi gerado');
    if (event.eventType !== 'ride.completed') throw new Error('eventType incorreto');
    event.validate();
});

// Teste 7: DriverOnlineEvent
test('DriverOnlineEvent - Criar evento válido', () => {
    const event = new DriverOnlineEvent({
        driverId: 'driver_789',
        location: { lat: -23.5505, lng: -46.6333 },
        vehiclePlate: 'ABC1234'
    });
    
    if (!event.eventId) throw new Error('eventId não foi gerado');
    if (event.eventType !== 'driver.online') throw new Error('eventType incorreto');
    event.validate();
});

// Teste 8: DriverOfflineEvent
test('DriverOfflineEvent - Criar evento válido', () => {
    const event = new DriverOfflineEvent({
        driverId: 'driver_789'
    });
    
    if (!event.eventId) throw new Error('eventId não foi gerado');
    if (event.eventType !== 'driver.offline') throw new Error('eventType incorreto');
    event.validate();
});

// Teste 9: PaymentConfirmedEvent
test('PaymentConfirmedEvent - Criar evento válido', () => {
    const event = new PaymentConfirmedEvent({
        bookingId: 'booking_123',
        customerId: 'customer_456',
        paymentId: 'payment_789',
        amount: 25.50,
        currency: 'BRL',
        status: 'PAID',
        paymentMethod: 'pix'
    });
    
    if (!event.eventId) throw new Error('eventId não foi gerado');
    if (event.eventType !== 'payment.confirmed') throw new Error('eventType incorreto');
    event.validate();
});

// Teste 10: Serialização JSON
test('Evento - Serializar para JSON', () => {
    const event = new RideRequestedEvent({
        bookingId: 'booking_123',
        customerId: 'customer_456',
        pickupLocation: { lat: -23.5505, lng: -46.6333 },
        destinationLocation: { lat: -23.5515, lng: -46.6343 },
        estimatedFare: 25.50,
        paymentMethod: 'pix'
    });
    
    const json = event.toJSON();
    if (!json.eventId || !json.occurredAt || !json.eventType || !json.data) {
        throw new Error('JSON serializado incompleto');
    }
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 RESULTADO: ${passed} passou, ${failed} falhou\n`);

if (failed === 0) {
    console.log('✅ TODOS OS TESTES PASSARAM!');
    process.exit(0);
} else {
    console.log('❌ ALGUNS TESTES FALHARAM!');
    process.exit(1);
}

