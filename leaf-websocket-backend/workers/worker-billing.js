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
const { isMultiLegBillingEnabled } = require('../utils/ride-lifecycle-feature-flags');

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
    const { bookingId, driverId, finalFare, tollFee } = event.data;
    const eventId = event.eventId || bookingId; // Fallback to bookingId if eventId is missing

    logStructured('info', 'Iniciando processamento contábil (Billing) da corrida', {
        bookingId,
        driverId,
        finalFare,
        tollFee: tollFee || 0,
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
    const rideLegSettlements = Array.isArray(event.data?.rideLegSettlements)
        ? event.data.rideLegSettlements.filter(Boolean)
        : [];

    if (rideLegSettlements.length > 1) {
        if (!isMultiLegBillingEnabled()) {
            throw new Error(
                `Multi-leg billing desabilitado para booking ${bookingId}; habilite ENABLE_MULTI_LEG_BILLING=true antes do rollout`
            );
        }

        const distributedAt = new Date().toISOString();
        const legResults = [];

        for (const leg of rideLegSettlements) {
            const legDriverId = leg?.driverId;
            const driverNetAmountReais = Number(leg?.driverNetAmount || 0);
            const driverNetAmountCents = paymentService.toCents(driverNetAmountReais);

            if (!legDriverId || driverNetAmountCents <= 0) {
                legResults.push({
                    legId: leg?.legId || null,
                    legNumber: leg?.legNumber || null,
                    driverId: legDriverId || null,
                    skipped: true,
                    reason: 'INVALID_DRIVER_OR_NET_AMOUNT'
                });
                continue;
            }

            const creditResult = await paymentService.creditDriverBalance(
                legDriverId,
                driverNetAmountCents,
                `${bookingId}:leg:${leg?.legNumber || 'x'}`
            );

            if (!creditResult.success) {
                throw new Error(
                    `Falha ao creditar saldo da perna ${leg?.legNumber || '?'} para ${legDriverId}: ${creditResult.error}`
                );
            }

            legResults.push({
                legId: leg?.legId || null,
                legNumber: leg?.legNumber || null,
                driverId: legDriverId,
                grossAmount: Number(leg?.grossAmount || 0),
                driverNetAmount: driverNetAmountReais,
                operationalFee: Number(leg?.operationalFee || 0),
                paymentIntermediationFee: Number(leg?.paymentIntermediationFee || 0),
                platformAbsorbedOperationalFee: Number(leg?.platformAbsorbedOperationalFee || 0),
                platformAbsorbedPaymentIntermediationFee: Number(leg?.platformAbsorbedPaymentIntermediationFee || 0),
                balanceCreditId: creditResult.balanceId || legDriverId,
                distributedAt
            });
        }

        const distributionSummary = {
            rideId: bookingId,
            driverId,
            status: 'distributed',
            distributedAt,
            mode: 'multi_leg',
            legs: legResults,
            totalGrossAmount: rideLegSettlements.reduce(
                (accumulator, leg) => accumulator + Number(leg?.grossAmount || 0),
                0
            ),
            totalDriverNetAmount: rideLegSettlements.reduce(
                (accumulator, leg) => accumulator + Number(leg?.driverNetAmount || 0),
                0
            ),
            totalPlatformAbsorbedOperationalFee: rideLegSettlements.reduce(
                (accumulator, leg) => accumulator + Number(leg?.platformAbsorbedOperationalFee || 0),
                0
            ),
            totalPlatformAbsorbedPaymentIntermediationFee: rideLegSettlements.reduce(
                (accumulator, leg) => accumulator + Number(leg?.platformAbsorbedPaymentIntermediationFee || 0),
                0
            )
        };

        await paymentService.saveDistributionToFirestore(distributionSummary);
        await paymentService.updatePaymentHolding(bookingId, {
            status: 'distributed',
            distributedAt,
            distributionData: distributionSummary
        }).catch((error) => {
            logStructured('warn', 'Falha ao atualizar payment holding da distribuição multi-leg', {
                bookingId,
                error: error.message
            });
            return null;
        });

        logStructured('info', 'Processamento contábil multi-leg concluído com sucesso', {
            bookingId,
            legs: legResults.length
        });

        await idempotencyService.cacheResult(idempotencyKey, distributionSummary, 604800);
        return {
            success: true,
            data: distributionSummary
        };
    }

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
        tollFee: tollFee || 0, // Passa o tollFee
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

// ✅ CAOS SCENARIO: Processamento de Payout do Motorista em Cancelamentos
workerManager.registerListener(EVENT_TYPES.RIDE_CANCELED, async (event) => {
    const { bookingId, driverId, cancellationFee } = event.data;
    const eventId = event.eventId || `cancel_${bookingId}`;

    // Apenas se houver multa e um motorista associado para receber
    if (!cancellationFee || cancellationFee <= 0 || !driverId) {
        return { success: true, reason: 'Sem multa ou motorista para processar' };
    }

    logStructured('info', 'Iniciando processamento contábil de multa (Cancelamento/No-Show)', {
        bookingId,
        driverId,
        cancellationFee,
        eventId
    });

    const idempotencyKey = idempotencyService.generateKey(driverId, 'billing.ride.canceled', eventId);
    const idempotencyCheck = await idempotencyService.checkAndSet(idempotencyKey, 604800);

    if (!idempotencyCheck.isNew) {
        logStructured('warn', 'Idempotency detectado: Esta multa já teve processamento financeiro no worker', {
            bookingId,
            driverId
        });
        return { success: true, reason: 'Duplicate Processing Avoided', data: idempotencyCheck.cachedResult };
    }

    const paymentService = new PaymentService();

    // Processar repasse da taxa de cancelamento excluindo o pedágio fixo (Woovi fee)
    const distributionResult = await paymentService.processCancellationDistribution({
        rideId: bookingId,
        driverId: driverId,
        cancellationFee: cancellationFee
    });

    if (!distributionResult.success) {
        // Fallback limpo: se falhar, retorna erro para tentar no DLQ
        throw new Error(`Falha na distribuição de multa de cancelamento: ${distributionResult.error}`);
    }

    logStructured('info', 'Processamento de multa contábil concluído com sucesso', {
        bookingId,
        driverId,
        netAmount: distributionResult.netAmount
    });

    // Salvar cache atrelado a idempotência
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
logStructured('info', 'Inicializando billing-worker', {
    service: 'billing-worker',
    multiLegBillingEnabled: isMultiLegBillingEnabled()
});

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
