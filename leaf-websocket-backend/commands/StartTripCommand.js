/**
 * COMMAND: StartTripCommand
 * 
 * Processa início de viagem.
 * 
 * Responsabilidades:
 * - Validar que viagem pode ser iniciada
 * - Verificar pagamento confirmado
 * - Atualizar estado da corrida
 * - Construir evento canônico ride.started (publicação ocorre no handler/EventBus)
 * 
 * NÃO faz:
 * - Notificar passageiro (isso é responsabilidade de listeners)
 * - Emitir eventos WebSocket (isso é responsabilidade de handlers)
 */

const { Command, CommandResult } = require('./index');
const RideStartedEvent = require('../events/ride.started');
const RideStateManager = require('../services/ride-state-manager');
const PaymentService = require('../services/payment-service');
const redisPool = require('../utils/redis-pool');
const { logger, logStructured } = require('../utils/logger');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { getTracer } = require('../utils/tracer');
const { SpanStatusCode } = require('@opentelemetry/api');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const { setActiveTripForDriver } = require('../utils/active-trip-index');
const {
    rehydratePrimaryBooking,
    writeVisibleBookingSnapshot
} = require('../services/booking-visibility-service');

class StartTripCommand extends Command {
    constructor(data) {
        super(data);
        this.driverId = data.driverId;
        this.bookingId = data.bookingId;
        this.startLocation = data.startLocation;
        // ✅ VALIDAÇÃO: Garantir traceId válido
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'StartTrip');
        this.correlationId = data.correlationId || this.bookingId; // ✅ Adicionar correlationId
    }

    validate() {
        if (!this.driverId) {
            throw new Error('StartTripCommand: driverId é obrigatório');
        }
        if (!this.bookingId) {
            throw new Error('StartTripCommand: bookingId é obrigatório');
        }
        if (!this.startLocation || !this.startLocation.lat || !this.startLocation.lng) {
            throw new Error('StartTripCommand: startLocation é obrigatório com lat e lng');
        }
        return true;
    }

    async execute() {
        const startTime = Date.now();
        // ✅ OBSERVABILIDADE: Executar com traceId + OpenTelemetry span
        const tracer = getTracer();
        const span = tracer.startSpan('StartTripCommand.execute', {
            attributes: {
                'command.name': 'StartTripCommand',
                'booking.id': this.bookingId,
                'driver.id': this.driverId,
                'trace.id': this.traceId
            }
        });
        
        return await traceContext.runWithTraceId(this.traceId, async () => {
            try {
                logStructured('info', 'StartTripCommand.execute iniciado', {
                    driverId: this.driverId,
                    bookingId: this.bookingId,
                    command: 'StartTripCommand'
                });
                
                // Validar
                span.addEvent('Validating command');
                this.validate();

            // Garantir conexão Redis
            span.addEvent('Ensuring Redis connection');
            await redisPool.ensureConnection();
            const redis = redisPool.getConnection();

            // Buscar dados da corrida
            span.addEvent('Fetching booking data');
            const bookingKey = `booking:${this.bookingId}`;
            let bookingData = await redis.hgetall(bookingKey);

            if (!bookingData || Object.keys(bookingData).length === 0) {
                bookingData = await rehydratePrimaryBooking(redis, this.bookingId, {
                    rehydratedFor: 'start_trip'
                });
            }

            if (!bookingData || Object.keys(bookingData).length === 0) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Corrida não encontrada' });
                span.end();
                metrics.recordCommand('StartTrip', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure('Corrida não encontrada')
            }

            // Verificar se motorista é o dono da corrida. Alguns caminhos de
            // dispatch preenchem ownerDriverId antes do driverId no hash quente.
            const assignedDriverId =
                bookingData.driverId ||
                bookingData.ownerDriverId ||
                bookingData.dispatchWaveAcceptedDriverId ||
                bookingData.awaitingResponseDriverId ||
                null;

            if (!assignedDriverId || assignedDriverId !== this.driverId) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Motorista não autorizado' });
                span.end();
                metrics.recordCommand('StartTrip', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure('Motorista não autorizado para iniciar esta corrida')
            }

            if (bookingData.ownerDriverId && bookingData.ownerDriverId !== this.driverId) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Ownership token inválido' });
                span.end();
                metrics.recordCommand('StartTrip', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure('Motorista não autorizado para iniciar esta corrida');
            }

            // Verificar estado atual
            span.addEvent('Validating state transition');
            const currentState = await RideStateManager.getBookingState(redis, this.bookingId);

            if (currentState === RideStateManager.STATES.ACCEPTED) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Chegada ao embarque obrigatória' });
                span.setAttribute('state.current', currentState);
                span.end();
                metrics.recordCommand('StartTrip', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(
                    'A corrida só pode ser iniciada após registrar chegada ao embarque.'
                );
            }

            const arrivalRegisteredAt =
                bookingData.arrivalRegisteredAt ||
                bookingData.driverArrivedAt ||
                bookingData.arrivedAt ||
                null;
            if (!arrivalRegisteredAt) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Chegada ao embarque não persistida' });
                span.end();
                metrics.recordCommand('StartTrip', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(
                    'A corrida só pode ser iniciada após registrar chegada ao embarque.'
                );
            }

            let operationalContinuation = null;
            try {
                operationalContinuation = bookingData?.operationalContinuation
                    ? JSON.parse(bookingData.operationalContinuation)
                    : null;
            } catch (_continuationError) {
                operationalContinuation = null;
            }

            const targetState =
                operationalContinuation &&
                (
                    operationalContinuation.status === 'REPLACEMENT_DRIVER_ACCEPTED' ||
                    operationalContinuation.status === 'REASSIGNED_IN_PROGRESS'
                )
                    ? RideStateManager.STATES.REASSIGNED_IN_PROGRESS
                    : RideStateManager.STATES.IN_PROGRESS;

            // Validar transição de estado
            if (!RideStateManager.isValidTransition(currentState, targetState)) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Transição de estado inválida' });
                span.setAttribute('state.current', currentState);
                span.end();
                metrics.recordCommand('StartTrip', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(
                    `Corrida não pode ser iniciada no estado atual: ${currentState}`
                )
            }

            // Verificar status do pagamento (fast-path Redis -> fallback payment service)
            span.addEvent('Checking payment status');
            const normalizePaymentStatus = (status) => String(status || '').trim().toLowerCase();
            const validPaymentStatuses = new Set(['in_holding', 'paid', 'confirmed']);
            let paymentStatus = {
                success: false,
                status: normalizePaymentStatus(
                    bookingData.paymentStatus ||
                    bookingData.payment_status ||
                    bookingData.statusPagamento
                )
            };

            if (!validPaymentStatuses.has(paymentStatus.status)) {
                const paymentService = new PaymentService();
                paymentStatus = await paymentService.getPaymentStatus(this.bookingId);
                paymentStatus.status = normalizePaymentStatus(paymentStatus?.status);
            } else {
                paymentStatus.success = true;
            }

            if (!paymentStatus?.success || !validPaymentStatuses.has(paymentStatus.status)) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: 'Pagamento não confirmado' });
                span.setAttribute('payment.status', paymentStatus?.status || 'unknown');
                span.end();
                metrics.recordCommand('StartTrip', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure('Pagamento não confirmado. A corrida não pode ser iniciada sem pagamento.')
            }

            // Parsear dados da corrida
            const customerId = bookingData.customerId;

            // Renovar índice de corrida ativa ao iniciar viagem
            await setActiveTripForDriver(redis, this.driverId, this.bookingId, customerId);

            // Atualizar estado da corrida
            span.addEvent('Updating ride state');
            await RideStateManager.updateBookingState(
                redis,
                this.bookingId,
                targetState,
                {
                    driverId: this.driverId,
                    startLocation: this.startLocation,
                    startedAt: new Date().toISOString()
                }
            );

            // Atualizar booking
            span.addEvent('Updating booking in Redis');
            const bookingPatch = {
                status: targetState,
                driverId: this.driverId,
                ownerDriverId: bookingData.ownerDriverId || this.driverId,
                startLocation: JSON.stringify(this.startLocation),
                startedAt: new Date().toISOString(),
                arrivalRegisteredAt
            };

            if (targetState === RideStateManager.STATES.REASSIGNED_IN_PROGRESS && operationalContinuation) {
                bookingPatch.operationalContinuation = JSON.stringify({
                    ...operationalContinuation,
                    status: 'REASSIGNED_IN_PROGRESS',
                    reassignedStartedAt: bookingPatch.startedAt,
                    currentLegStartedAt: bookingPatch.startedAt,
                    replacementDriverId: this.driverId
                });
            }

            await redis.hset(bookingKey, bookingPatch);
            await writeVisibleBookingSnapshot(redis, this.bookingId, bookingPatch);

                // Criar evento canônico
                span.addEvent('Creating RideStartedEvent');
                const event = new RideStartedEvent({
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    startLocation: this.startLocation,
                    traceId: this.traceId, // ✅ Incluir traceId no evento
                    correlationId: this.correlationId || this.bookingId // ✅ Incluir correlationId no evento
                });

                logStructured('info', 'StartTripCommand executado com sucesso', {
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    command: 'StartTripCommand'
                });

                // ✅ OBSERVABILIDADE: Registrar métrica de sucesso
                metrics.recordCommand('StartTrip', (Date.now() - startTime) / 1000, true);

                span.setStatus({ code: SpanStatusCode.OK });
                span.setAttribute('customer.id', customerId);
                span.end();

                // Retornar resultado com dados da corrida e evento
                return CommandResult.success({
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    event: event.toJSON(),
                    startLocation: this.startLocation
                });

            } catch (error) {
                span.recordException(error);
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                span.end();
                
                logStructured('error', 'StartTripCommand falhou', {
                    driverId: this.driverId,
                    bookingId: this.bookingId,
                    command: 'StartTripCommand',
                    error: error.message
                });
                metrics.recordCommand('StartTrip', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message)
            }
        });
    }
}

module.exports = StartTripCommand;
