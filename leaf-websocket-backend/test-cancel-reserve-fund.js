require('dotenv').config();

const CancelRideCommand = require('./commands/CancelRideCommand');
const redisPool = require('./utils/redis-pool');
const RideStateManager = require('./services/ride-state-manager');

async function testReserveFund() {
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();

    // 1. Limpar metrica existente para o teste
    await redis.del('metrics:financial');
    console.log("🧹 Métrica de fundo de reserva limpa.");

    // 2. Mockar uma corrida 'SEARCHING' com estimatedFare = 30
    const mockBookingId = 'test-ride-reserve-123';
    await redis.hset(`booking:${mockBookingId}`, {
        status: 'SEARCHING',
        state: 'SEARCHING',
        estimatedFare: '30.00',
        customerId: 'customer-1'
    });
    console.log(`✅ Corrida Mockada em SEARCHING com Fare Estimado R$ 30,00`);

    // 3. Executar o Comando de Cancelamento
    console.log("🔻 Executando CancelRideCommand pelo Passageiro...");
    const cmd = new CancelRideCommand({
        bookingId: mockBookingId,
        canceledBy: 'customer-1',
        userType: 'customer',
        reason: 'Demorou muito'
    });

    const result = await cmd.execute();

    if (result.isSuccess) {
        console.log("✅ Corrida cancelada com sucesso!");
    } else {
        console.error("❌ Falha ao cancelar:", result.error);
    }

    // 4. Verificar se a métrica foi computada (R$ 30 * 0.0008 = 0.024 => Mínimo de R$ 0.50)
    const assumedLoss = await redis.hget('metrics:financial', 'assumed_cancellation_costs');
    console.log(`\n💰 PREJUÍZO ACUMULADO NO REDIS PARA O FUNDO DE RESERVA: R$ ${assumedLoss}`);

    if (parseFloat(assumedLoss) === 0.50) {
        console.log("🎯 TESTE PASSOU! A taxa mínima da Woovi (R$ 0.50) foi corretamente embutida como débito.");
    } else {
        console.log("⚠️ TESTE FALHOU. O valor esperado era R$ 0.50");
    }

    process.exit(0);
}

testReserveFund();
