/**
 * TESTE: Command Handlers
 * 
 * Valida funcionamento dos command handlers.
 */

const RequestRideCommand = require('../../commands/RequestRideCommand');
const AcceptRideCommand = require('../../commands/AcceptRideCommand');
const StartTripCommand = require('../../commands/StartTripCommand');
const CompleteTripCommand = require('../../commands/CompleteTripCommand');
const CancelRideCommand = require('../../commands/CancelRideCommand');
const redisPool = require('../../utils/redis-pool');

console.log('🧪 TESTE: Command Handlers\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

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

    // Teste 1: RequestRideCommand - Validação
    await test('RequestRideCommand - Validar dados obrigatórios', () => {
        const command = new RequestRideCommand({
            customerId: 'customer_123',
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5515, lng: -46.6343 },
            estimatedFare: 25.50,
            paymentMethod: 'pix'
        });
        
        command.validate(); // Não deve lançar erro
    });

    await test('RequestRideCommand - Falhar sem customerId', () => {
        const command = new RequestRideCommand({
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5515, lng: -46.6343 },
            estimatedFare: 25.50,
            paymentMethod: 'pix'
        });
        
        try {
            command.validate();
            throw new Error('Deveria ter falhado sem customerId');
        } catch (error) {
            if (!error.message.includes('customerId')) {
                throw error;
            }
        }
    });

    // Teste 2: AcceptRideCommand - Validação
    await test('AcceptRideCommand - Validar dados obrigatórios', () => {
        const command = new AcceptRideCommand({
            driverId: 'driver_123',
            bookingId: 'booking_456'
        });
        
        command.validate(); // Não deve lançar erro
    });

    await test('AcceptRideCommand - Falhar sem driverId', () => {
        const command = new AcceptRideCommand({
            bookingId: 'booking_456'
        });
        
        try {
            command.validate();
            throw new Error('Deveria ter falhado sem driverId');
        } catch (error) {
            if (!error.message.includes('driverId')) {
                throw error;
            }
        }
    });

    // Teste 3: StartTripCommand - Validação
    await test('StartTripCommand - Validar dados obrigatórios', () => {
        const command = new StartTripCommand({
            driverId: 'driver_123',
            bookingId: 'booking_456',
            startLocation: { lat: -23.5505, lng: -46.6333 }
        });
        
        command.validate(); // Não deve lançar erro
    });

    await test('StartTripCommand - Falhar sem startLocation', () => {
        const command = new StartTripCommand({
            driverId: 'driver_123',
            bookingId: 'booking_456'
        });
        
        try {
            command.validate();
            throw new Error('Deveria ter falhado sem startLocation');
        } catch (error) {
            if (!error.message.includes('startLocation')) {
                throw error;
            }
        }
    });

    // Teste 4: CompleteTripCommand - Validação
    await test('CompleteTripCommand - Validar dados obrigatórios', () => {
        const command = new CompleteTripCommand({
            driverId: 'driver_123',
            bookingId: 'booking_456',
            endLocation: { lat: -23.5515, lng: -46.6343 },
            finalFare: 30.00,
            distance: 5.2,
            duration: 1200
        });
        
        command.validate(); // Não deve lançar erro
    });

    await test('CompleteTripCommand - Falhar sem finalFare', () => {
        const command = new CompleteTripCommand({
            driverId: 'driver_123',
            bookingId: 'booking_456',
            endLocation: { lat: -23.5515, lng: -46.6343 }
        });
        
        try {
            command.validate();
            throw new Error('Deveria ter falhado sem finalFare');
        } catch (error) {
            if (!error.message.includes('finalFare')) {
                throw error;
            }
        }
    });

    // Teste 5: CancelRideCommand - Validação
    await test('CancelRideCommand - Validar dados obrigatórios', () => {
        const command = new CancelRideCommand({
            bookingId: 'booking_456',
            canceledBy: 'customer_123',
            reason: 'Mudança de planos',
            cancellationFee: 5.00
        });
        
        command.validate(); // Não deve lançar erro
    });

    await test('CancelRideCommand - Falhar sem canceledBy', () => {
        const command = new CancelRideCommand({
            bookingId: 'booking_456',
            reason: 'Mudança de planos'
        });
        
        try {
            command.validate();
            throw new Error('Deveria ter falhado sem canceledBy');
        } catch (error) {
            if (!error.message.includes('canceledBy')) {
                throw error;
            }
        }
    });

    // Teste 6: CommandResult
    await test('CommandResult - Criar resultado de sucesso', () => {
        const { CommandResult } = require('../../commands/index');
        const result = CommandResult.success({ bookingId: 'booking_123' });
        
        if (!result.success) {
            throw new Error('Resultado deveria ser de sucesso');
        }
        if (!result.data || result.data.bookingId !== 'booking_123') {
            throw new Error('Dados do resultado incorretos');
        }
    });

    await test('CommandResult - Criar resultado de falha', () => {
        const { CommandResult } = require('../../commands/index');
        const result = CommandResult.failure('Erro de teste');
        
        if (result.success) {
            throw new Error('Resultado deveria ser de falha');
        }
        if (result.error !== 'Erro de teste') {
            throw new Error('Erro do resultado incorreto');
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
}

runTests().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});

