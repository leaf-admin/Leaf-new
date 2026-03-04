/**
 * COMMAND: CompleteTripCommand
 * 
 * Processa finalização de viagem.
 * 
 * Responsabilidades:
 * - Validar que viagem pode ser finalizada
 * - Atualizar estado da corrida
 * - Processar pagamento final
 * - Publicar evento ride.completed
 * 
 * NÃO faz:
 * - Notificar passageiro (isso é responsabilidade de listeners)
 * - Emitir eventos WebSocket (isso é responsabilidade de handlers)
 */

const { Command, CommandResult } = require('./index');
const RideCompletedEvent = require('../events/ride.completed');
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

class CompleteTripCommand extends Command {
    constructor(data) {
        super(data);
        this.driverId = data.driverId;
        this.bookingId = data.bookingId;
        this.endLocation = data.endLocation;
        this.finalFare = data.finalFare;
        this.tollFee = data.tollFee || 0; // ✅ Adicionado pedágio
        this.distance = data.distance || 0;
        this.duration = data.duration || 0;
        // ✅ VALIDAÇÃO: Garantir traceId válido
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'CompleteTrip');
        this.correlationId = data.correlationId || this.bookingId; // ✅ Adicionar correlationId
    }

    validate() {
        if (!this.driverId) {
            throw new Error('CompleteTripCommand: driverId é obrigatório');
        }
        if (!this.bookingId) {
            throw new Error('CompleteTripCommand: bookingId é obrigatório');
        }
        if (!this.endLocation || !this.endLocation.lat || !this.endLocation.lng) {
            throw new Error('CompleteTripCommand: endLocation é obrigatório com lat e lng');
        }
        if (this.finalFare === undefined || this.finalFare === null || this.finalFare < 0) {
            throw new Error('CompleteTripCommand: finalFare é obrigatório e deve ser >= 0');
        }
        return true;
    }

    async execute() {
        const startTime = Date.now();
        // ✅ OBSERVABILIDADE: Executar com traceId + OpenTelemetry span
        const tracer = getTracer();
        const span = tracer.startSpan('CompleteTripCommand.execute', {
            attributes: {
                'command.name': 'CompleteTripCommand',
                'booking.id': this.bookingId,
                'trace.id': this.traceId
            }
        });

        return await traceContext.runWithTraceId(this.traceId, async () => {
            try {
                logStructured('info', 'CompleteTripCommand.execute iniciado', {
                    driverId: this.driverId,
                    bookingId: this.bookingId,
                    command: 'CompleteTripCommand'
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
                    metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Corrida não encontrada')
                }

                // Verificar se motorista é o dono da corrida
                if (bookingData.driverId !== this.driverId) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Motorista não autorizado' });
                    span.end();
                    metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Motorista não autorizado para finalizar esta corrida')
                }

                // Verificar estado atual
                const currentState = await RideStateManager.getBookingState(redis, this.bookingId);

                // Validar transição de estado
                if (!RideStateManager.isValidTransition(currentState, RideStateManager.STATES.COMPLETED)) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid state transition' });
                    span.end();
                    metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure(`Corrida não pode ser finalizada no estado atual: ${currentState}`)
                }

                // Parsear dados da corrida
                const customerId = bookingData.customerId;

                // ✅ ARCHITECTURE SHIFT: EDA Refactoring
                // O processamento contábil e distribuição de valor líquido via Woovi
                // agora é realizado ASSINCRONAMENTE pelo `worker-billing.js` que consome
                // o evento `RIDE_COMPLETED`. O request principal de finalização não fica
                // mais bloqueado aguardando chamadas HTTP a gateways de pagamento de terceiros.

                // Liberar lock de motorista
                const lockStatus = await driverLockManager.isDriverLocked(this.driverId);
                if (lockStatus.isLocked && lockStatus.bookingId === this.bookingId) {
                    await driverLockManager.releaseLock(this.driverId);
                    logger.info(`🔓 [CompleteTripCommand] Lock de motorista ${this.driverId} liberado.`);
                }

                // ✅ CAOS SCENARIO: Descontar tempo offline do motorista para resiliência de faturamento
                try {
                    const heartbeatService = require('../services/heartbeat-service');
                    const offlineTimeMs = await heartbeatService.getAndResetOfflineTime(this.driverId);
                    const offlineSeconds = Math.floor(offlineTimeMs / 1000);

                    if (offlineSeconds > 0) {
                        const originalDuration = parseInt(this.duration || 0);
                        const offlineMinutes = offlineSeconds / 60;
                        const defaultMinuteRate = 50; // R$ 0,50 por minuto (taxa base dinâmica aproximação)

                        // O motorista deve ser penalizado/faturamento deve ser corrigido retirando o tempo ocioso offline
                        const discountAmount = Math.floor(offlineMinutes * defaultMinuteRate);

                        this.duration = Math.max(0, originalDuration - offlineSeconds);
                        this.finalFare = Math.max(0, parseInt(this.finalFare) - discountAmount);

                        logger.info(`🔌 [CompleteTripCommand] Motorista esteve offline por ${offlineSeconds}s. Desconto aplicado: R$ ${(discountAmount / 100).toFixed(2)}. Duração corrigida para ${this.duration}s.`, {
                            bookingId: this.bookingId, driverId: this.driverId
                        });
                    }
                } catch (hbErr) {
                    logger.warn(`⚠️ [CompleteTripCommand] Falha ao processar resiliência offline: ${hbErr.message}`);
                }

                // Atualizar estado da corrida
                await RideStateManager.updateBookingState(
                    redis,
                    this.bookingId,
                    RideStateManager.STATES.COMPLETED,
                    {
                        driverId: this.driverId,
                        endLocation: this.endLocation,
                        finalFare: this.finalFare,
                        tollFee: this.tollFee,
                        distance: this.distance,
                        duration: this.duration,
                        completedAt: new Date().toISOString(),
                        paymentDistribution: { status: 'PENDING', message: 'Processamento assíncrono em andamento' }
                    }
                );

                // Atualizar booking
                await redis.hset(bookingKey, {
                    status: 'COMPLETED',
                    endLocation: JSON.stringify(this.endLocation),
                    finalFare: String(this.finalFare),
                    tollFee: String(this.tollFee),
                    distance: String(this.distance),
                    duration: String(this.duration),
                    completedAt: new Date().toISOString()
                });

                // ✅ NOVO: Remover da lista de corridas ativas
                await redis.hdel('bookings:active', this.bookingId);

                // Criar evento canônico
                const event = new RideCompletedEvent({
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    endLocation: this.endLocation,
                    finalFare: this.finalFare,
                    tollFee: this.tollFee,
                    distance: this.distance,
                    duration: this.duration,
                    traceId: this.traceId, // ✅ Incluir traceId no evento
                    correlationId: this.correlationId || this.bookingId // ✅ Incluir correlationId no evento
                });

                // Registrar evento no event sourcing
                await eventSourcing.recordEvent(
                    eventSourcing.EVENT_TYPES.RIDE_COMPLETED,
                    event.data
                );

                logStructured('info', 'CompleteTripCommand executado com sucesso', {
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    command: 'CompleteTripCommand'
                });

                // ✅ OBSERVABILIDADE: Registrar métrica de sucesso
                metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, true);

                // Retornar resultado com dados da corrida e evento
                return CommandResult.success({
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    event: event.toJSON(),
                    endLocation: this.endLocation,
                    finalFare: this.finalFare,
                    tollFee: this.tollFee,
                    distance: this.distance,
                    duration: this.duration,
                    paymentDistribution: { status: 'PENDING', message: 'Processamento assíncrono em andamento' }
                });

            } catch (error) {
                span.recordException(error);
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                span.end();

                logStructured('error', 'CompleteTripCommand falhou', {
                    driverId: this.driverId,
                    bookingId: this.bookingId,
                    command: 'CompleteTripCommand',
                    error: error.message
                });
                metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message)
            }
        });
    }
}

module.exports = CompleteTripCommand;
