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

                // Criar evento canônico
                const event = new RideCanceledEvent({
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    reason: this.reason,
                    cancellationFee: this.cancellationFee,
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
