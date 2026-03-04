/**
 * COMMAND: CancelRideCommand
 * 
 * Processa cancelamento de corrida.
 * 
 * Responsabilidades:
 * - Validar que corrida pode ser cancelada
 * - Atualizar estado da corrida
 * - Processar reembolso se necessário
 * - Publicar evento ride.canceled
 * 
 * NÃO faz:
 * - Notificar passageiro/motorista (isso é responsabilidade de listeners)
 * - Emitir eventos WebSocket (isso é responsabilidade de handlers)
 */

const { Command, CommandResult } = require('./index');
const RideCanceledEvent = require('../events/ride.canceled');
const RideStateManager = require('../services/ride-state-manager');
const PaymentService = require('../services/payment-service');
const driverLockManager = require('../services/driver-lock-manager');
const redisPool = require('../utils/redis-pool');
const { logger, logStructured } = require('../utils/logger');
const eventSourcing = require('../services/event-sourcing');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { getTracer } = require('../utils/tracer');
const { SpanStatusCode } = require('@opentelemetry/api');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');

class CancelRideCommand extends Command {
    constructor(data) {
        super(data);
        this.bookingId = data.bookingId;
        this.canceledBy = data.canceledBy; // userId que cancelou
        this.reason = data.reason || 'Cancelado pelo usuário';
        this.cancellationFee = data.cancellationFee || 0;
        this.userType = data.userType; // Tipo de usuário (customer/driver)
        // ✅ VALIDAÇÃO: Garantir traceId válido
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'CancelRide');
        this.correlationId = data.correlationId || this.bookingId; // ✅ Adicionar correlationId
    }

    validate() {
        if (!this.bookingId) {
            throw new Error('CancelRideCommand: bookingId é obrigatório');
        }
        if (!this.canceledBy) {
            throw new Error('CancelRideCommand: canceledBy é obrigatório');
        }
        if (this.cancellationFee < 0) {
            throw new Error('CancelRideCommand: cancellationFee deve ser >= 0');
        }
        return true;
    }

    async execute() {
        const startTime = Date.now();
        // ✅ OBSERVABILIDADE: Executar com traceId + OpenTelemetry span
        const tracer = getTracer();
        const span = tracer.startSpan('CancelRideCommand.execute', {
            attributes: {
                'command.name': 'CancelRideCommand',
                'booking.id': this.bookingId,
                'trace.id': this.traceId
            }
        });

        return await traceContext.runWithTraceId(this.traceId, async () => {
            try {
                logStructured('info', 'CancelRideCommand.execute iniciado', {
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    command: 'CancelRideCommand'
                });

                // Validar
                this.validate();

                // Garantir conexão Redis
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                // Buscar dados da corrida
                const bookingKey = `booking:${this.bookingId}`;
                const bookingData = await redis.hgetall(bookingKey);

                if (!bookingData || Object.keys(bookingData).length === 0) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Corrida não encontrada' });
                    span.end();
                    metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Corrida não encontrada')
                }

                // Verificar estado atual
                const currentState = await RideStateManager.getBookingState(redis, this.bookingId);

                // Validar transição de estado (pode cancelar de qualquer estado exceto COMPLETED)
                if (currentState === RideStateManager.STATES.COMPLETED) {
                    metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Corrida já finalizada não pode ser cancelada')
                }

                // Parsear dados da corrida
                const customerId = bookingData.customerId;
                const driverId = bookingData.driverId;

                // Liberar lock de motorista se houver
                if (driverId) {
                    const lockStatus = await driverLockManager.isDriverLocked(driverId);
                    if (lockStatus.isLocked && lockStatus.bookingId === this.bookingId) {
                        await driverLockManager.releaseLock(driverId);
                        logger.info(`🔓 [CancelRideCommand] Lock de motorista ${driverId} liberado.`);
                    }
                }

                // ✅ CAOS SCENARIO: Lógica Dinâmica de Cancelamento (Passageiro)
                if (this.userType === 'customer' && (!this.cancellationFee || this.cancellationFee === 0)) {
                    if (currentState === RideStateManager.STATES.SEARCHING || currentState === RideStateManager.STATES.PENDING || currentState === RideStateManager.STATES.NOTIFIED) {
                        // Cancelamento Gratuito (Busca/Pendente)
                        this.cancellationFee = 0;
                        logger.info(`💸 [CancelRideCommand] Cancelamento na busca. Estorno 100%. Taxa Woovi absorvida pela Leaf.`);

                        // ✅ PHASE 8: Pre-Acceptance Financial Tracking (Reserve Fund)
                        const estimatedFare = parseFloat(bookingData.estimatedFare || 0);
                        if (estimatedFare > 0) {
                            let assumedWooviFee = estimatedFare * 0.0008; // 0.08%
                            if (assumedWooviFee < 0.50) assumedWooviFee = 0.50; // min 50 cents

                            // Acumular prejuízo no fundo de reserva (hash de métricas globais)
                            await redis.hincrbyfloat('metrics:financial', 'assumed_cancellation_costs', assumedWooviFee);
                            logger.info(`🔻 [ReserveFund] Adicionado prejuízo assumido de taxa PIX: R$ ${assumedWooviFee.toFixed(2)} para corrida ${this.bookingId}`);
                        }
                    } else if (currentState === RideStateManager.STATES.ACCEPTED || currentState === RideStateManager.STATES.ARRIVED) {
                        // Passou do Aceite. Checar Tempo de Carência (2 minutos).
                        const acceptedAtStr = bookingData.acceptedAt;
                        if (acceptedAtStr) {
                            const acceptedAt = new Date(acceptedAtStr).getTime();
                            const elapsedMs = Date.now() - acceptedAt;
                            const elapsedMinutes = Math.floor(elapsedMs / 60000);

                            if (elapsedMinutes <= 2) {
                                this.cancellationFee = 0;
                                logger.info(`💸 [CancelRideCommand] Cancelamento dentro da carência (<= 2 min). Estorno 100%.`);
                            } else {
                                // Aplicar multa
                                const wooviFee = 50; // 50 centavos
                                const driverTimeFee = (elapsedMinutes - 2) * 50; // 50 centavos por minuto excedente

                                const estimatedFare = parseInt(bookingData.estimatedFare || 0);
                                const maxFee = estimatedFare > 0 ? Math.floor(estimatedFare * 0.4) : 500; // Teto de 40%

                                let calculatedFee = wooviFee + driverTimeFee;
                                if (calculatedFee > maxFee && maxFee > 0) calculatedFee = maxFee;

                                this.cancellationFee = calculatedFee;
                                logger.info(`💸 [CancelRideCommand] Cancelamento após carência (${elapsedMinutes} min). Aplicando multa de R$ ${(this.cancellationFee / 100).toFixed(2)}.`);
                            }
                        } else {
                            // Se não encontrou acceptedAt, sem taxa
                            this.cancellationFee = 0;
                            logger.warn(`⚠️ [CancelRideCommand] acceptedAt não encontrado para a corrida ${this.bookingId}, isentando de taxa de cancelamento.`);
                        }
                    }
                } else if (this.userType === 'driver' && currentState === RideStateManager.STATES.ARRIVED) {
                    // ✅ CAOS SCENARIO: No-Show do Passageiro (Driver No-Show Câncel)
                    const arrivedAtStr = bookingData.driverArrivedAt;
                    if (arrivedAtStr) {
                        const arrivedAt = new Date(parseInt(arrivedAtStr)).getTime();
                        const elapsedMs = Date.now() - arrivedAt;
                        const elapsedMinutes = Math.floor(elapsedMs / 60000);

                        // Threshold de 5 minutos (300.000 ms) de espera
                        if (elapsedMinutes >= 5) {
                            const waitTimeFee = elapsedMinutes * 50; // R$ 0,50 por minuto esperado
                            const wooviFee = 50;
                            const estimatedFare = parseInt(bookingData.estimatedFare || 0);
                            const maxFee = estimatedFare > 0 ? Math.floor(estimatedFare * 0.4) : 500; // Teto de 40%

                            let calculatedFee = wooviFee + waitTimeFee;
                            if (calculatedFee > maxFee && maxFee > 0) calculatedFee = maxFee;

                            this.cancellationFee = calculatedFee;
                            logger.info(`💸 [CancelRideCommand] Driver Cancel (No-Show). Passageiro demorou ${elapsedMinutes} min. Multa de R$ ${(this.cancellationFee / 100).toFixed(2)}.`);
                        } else {
                            this.cancellationFee = 0;
                            logger.info(`💸 [CancelRideCommand] Driver Cancelou prematuramente em ARRIVED (${elapsedMinutes} min). Sem multa.`);
                        }
                    }
                }

                // Processar reembolso se houver pagamento
                let refundResult = null;
                const paymentService = new PaymentService();
                const paymentRecord = await paymentService.getStoredPayment(this.bookingId);

                if (paymentRecord && paymentRecord.status === 'PAID' && paymentRecord.paymentId) {
                    if (this.cancellationFee && this.cancellationFee > 0) {
                        // Reembolso parcial
                        const refundAmount = paymentRecord.amount - this.cancellationFee;
                        if (refundAmount > 0) {
                            refundResult = await paymentService.processRefund(
                                paymentRecord.paymentId,
                                refundAmount
                            );
                            if (refundResult.success) {
                                await paymentService.markPaymentRefunded(this.bookingId, {
                                    refundAmount,
                                    refundId: refundResult.refundId,
                                    refundedAt: new Date().toISOString(),
                                    status: 'REFUNDED_PARTIAL'
                                });
                            }
                        }
                    } else {
                        // Reembolso total
                        refundResult = await paymentService.processRefund(
                            paymentRecord.paymentId,
                            paymentRecord.amount
                        );
                        if (refundResult.success) {
                            await paymentService.markPaymentRefunded(this.bookingId, {
                                refundAmount: paymentRecord.amount,
                                refundId: refundResult.refundId,
                                refundedAt: new Date().toISOString(),
                                status: 'REFUNDED_FULL'
                            });
                        }
                    }
                }

                // Atualizar estado da corrida
                await RideStateManager.updateBookingState(
                    redis,
                    this.bookingId,
                    RideStateManager.STATES.CANCELED,
                    {
                        canceledBy: this.canceledBy,
                        reason: this.reason,
                        cancellationFee: this.cancellationFee,
                        cancelledAt: new Date().toISOString()
                    }
                );

                // Atualizar booking
                await redis.hset(bookingKey, {
                    status: 'CANCELED',
                    canceledBy: this.canceledBy,
                    reason: this.reason,
                    cancellationFee: String(this.cancellationFee),
                    cancelledAt: new Date().toISOString()
                });

                // ✅ NOVO: Remover da lista de corridas ativas
                await redis.hdel('bookings:active', this.bookingId);

                // Criar evento canônico
                const event = new RideCanceledEvent({
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    reason: this.reason,
                    cancellationFee: this.cancellationFee,
                    driverId: driverId, // ✅ Incluir driverId para processamento no billing-worker
                    traceId: this.traceId, // ✅ Incluir traceId no evento
                    correlationId: this.correlationId || this.bookingId // ✅ Incluir correlationId no evento
                });

                // Registrar evento no event sourcing
                await eventSourcing.recordEvent(
                    eventSourcing.EVENT_TYPES.RIDE_CANCELED,
                    event.data
                );

                logStructured('info', 'CancelRideCommand executado com sucesso', {
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    reason: this.reason,
                    command: 'CancelRideCommand'
                });

                // ✅ OBSERVABILIDADE: Registrar métrica de sucesso
                metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, true);

                // Retornar resultado com dados da corrida e evento
                return CommandResult.success({
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    reason: this.reason,
                    cancellationFee: this.cancellationFee,
                    driverId: driverId,
                    event: event.toJSON(),
                    refundResult: refundResult
                });

            } catch (error) {
                span.recordException(error);
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                span.end();

                logStructured('error', 'CancelRideCommand falhou', {
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    command: 'CancelRideCommand',
                    error: error.message
                });
                metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message)
            }
        });
    }
}

module.exports = CancelRideCommand;
