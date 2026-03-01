#!/usr/bin/env node
/**
 * BILLING WORKER
 * 
 * Worker dedicado para processamento financeiro e faturamento.
 * Consome o evento 'ride.completed' para realizar a distribuição de pagamentos via Woovi
 * de forma completamente desacoplada da thread principal.
 */

const WorkerManager = require('./WorkerManager');
const { logStructured } = require('../utils/logger');
const PaymentService = require('../services/payment-service');
const driverApprovalService = require('../services/driver-approval-service');
const idempotencyService = require('../services/idempotency-service');
const { EVENT_TYPES } = require('../events');

// Criar WorkerManager focado em billing
const workerManager = new WorkerManager({
    streamName: 'ride_events',
    groupName: 'billing-workers',
    consumerName: `billing-worker-${process.pid}`,
    batchSize: 5, // Processamento menor por lote devido a integrações third-party (Woovi)
    blockTime: 1000,
    maxRetries: 5, // Mais retries para resiliência financeira
    retryBackoff: [1000, 5000, 15000, 30000, 60000] // Backoff longo
});

workerManager.registerListener(EVENT_TYPES.RIDE_COMPLETED, async (event) => {
    const { bookingId, driverId, finalFare } = event.data;
    const eventId = event.eventId || bookingId; // Fallback to bookingId if eventId is missing

    logStructured('info', 'Iniciando processamento contábil (Billing) da corrida', {
        bookingId,
        driverId,
        finalFare,
        eventId
    });

    // ✅ Risco 2 Resolvido: Proteção contra Duplo Faturamento (Idempotency)
    // Se a API crachar logo após a Woovi mas antes do ACK do Redis Stream, esse lock garante
    // que quando a task retornar ao Worker, ela seja descartada silenciosamente para não onerar em dobro.
    const idempotencyKey = idempotencyService.generateKey(driverId, 'billing.ride.completed', eventId);
    // Utilizaremos um TTL longo (Duração de 7 dias) para garantir que faturamentos antigos que foram pra DLQ e voltaram não passem.
    const idempotencyCheck = await idempotencyService.checkAndSet(idempotencyKey, 604800);

    if (!idempotencyCheck.isNew) {
        logStructured('warn', 'Idempotency detectado: Esta corrida já teve processamento financeiro no worker', {
            bookingId,
            driverId
        });
        return { success: true, reason: 'Duplicate Processing Avoided', data: idempotencyCheck.cachedResult };
    }

    const paymentService = new PaymentService();

    // Obter dados da conta Woovi do motorista
    const accountData = await driverApprovalService.getDriverWooviAccount(driverId);

    if (!accountData || !accountData.accountId) {
        logStructured('warn', 'Motorista sem conta Woovi configurada. Faturamento ignorado.', {
            bookingId,
            driverId
        });
        return { success: false, reason: 'Conta Woovi não encontrada' };
    }

    // Processar distribuição de valor líquido para o motorista
    const distributionResult = await paymentService.processNetDistribution({
        rideId: bookingId,
        driverId: driverId,
        totalAmount: finalFare,
        wooviAccountId: accountData.accountId
    });

    if (!distributionResult.success) {
        throw new Error(`Falha na distribuição de pagamento Woovi: ${distributionResult.error}`);
    }

    logStructured('info', 'Processamento contábil concluído com sucesso', {
        bookingId,
        driverId,
        distributionId: distributionResult.data?.id
    });

    // ✅ Salvar em Cache atrelado a Idempotência que o processamento funcionou
    await idempotencyService.cacheResult(idempotencyKey, distributionResult, 604800);

    return distributionResult;
});

// Tratamento de sinais para shutdown graceful
process.on('SIGTERM', async () => {
    logStructured('info', 'SIGTERM recebido, parando billing-worker', { service: 'billing-worker' });
    await workerManager.stop();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logStructured('info', 'SIGINT recebido, parando billing-worker', { service: 'billing-worker' });
    await workerManager.stop();
    process.exit(0);
});

// Iniciar worker
workerManager.start().catch(error => {
    logStructured('error', 'Erro fatal ao iniciar billing worker', {
        service: 'billing-worker',
        error: error.message
    });
    process.exit(1);
});

// Log de estatísticas a cada 60 segundos
setInterval(() => {
    const stats = workerManager.getStats();
    logStructured('info', 'Estatísticas do billing-worker', {
        service: 'billing-worker',
        ...stats
    });
}, 60000);
