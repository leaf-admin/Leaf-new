const Command = require('./Command');
const CommandResult = require('./CommandResult');
const { logStructured } = require('../utils/logger');
const redisPool = require('../utils/redis-pool');
const RideStateManager = require('../services/ride-state-manager');
const EventSourcing = require('../services/event-sourcing');
const { validateAndEnsureTraceIdInCommand } = require('../utils/context-keys');
const { traceContext } = require('../utils/trace-context');
const { getTracer, SpanStatusCode } = require('../utils/telemetry');
const metrics = require('../utils/metrics');
const PaymentService = require('../services/payment-service');

class ExtendRideCommand extends Command {
    constructor(data) {
        super(data);
        this.bookingId = data.bookingId;
        this.customerId = data.customerId;
        this.newEndLocation = data.newEndLocation;
        this.newFare = data.newFare;
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'ExtendRide');
        this.correlationId = data.correlationId || this.bookingId;
    }

    validate() {
        if (!this.bookingId) throw new Error('bookingId é obrigatório');
        if (!this.customerId) throw new Error('customerId é obrigatório');
        if (!this.newEndLocation || !this.newEndLocation.lat || !this.newEndLocation.lng) {
            throw new Error('newEndLocation com lat/lng é obrigatório');
        }
        if (!this.newFare || this.newFare <= 0) {
            throw new Error('newFare inválido');
        }
        return true;
    }

    async execute() {
        const startTime = Date.now();
        const tracer = getTracer();
        const span = tracer.startSpan('ExtendRideCommand.execute', {
            attributes: { 'command.name': 'ExtendRideCommand', 'booking.id': this.bookingId, 'trace.id': this.traceId }
        });

        return await traceContext.runWithTraceId(this.traceId, async () => {
            try {
                this.validate();

                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                const bookingKey = `booking:${this.bookingId}`;
                const bookingData = await redis.hgetall(bookingKey);

                if (!bookingData || Object.keys(bookingData).length === 0) {
                    throw new Error('Corrida não encontrada');
                }

                if (bookingData.customerId !== this.customerId) {
                    throw new Error('Usuário não autorizado a estender esta corrida');
                }

                const currentState = await RideStateManager.getBookingState(redis, this.bookingId);
                if (currentState !== RideStateManager.STATES.IN_PROGRESS) {
                    throw new Error('A corrida precisa estar IN_PROGRESS para ser estendida');
                }

                const currentFareInt = parseInt(bookingData.estimatedFare || 0);
                const newFareInt = parseInt(this.newFare);

                if (newFareInt <= currentFareInt) {
                    throw new Error('O novo destino é mais barato ou igual ao atual. Estorno será feito no fim da viagem.');
                }

                const diffFare = newFareInt - currentFareInt;

                // Gerar a cobrança da diferença
                const paymentService = new PaymentService();

                // Garantir correlationID único
                const timestamp = Date.now();
                const randomSuffix = Math.random().toString(36).substring(2, 9);
                const uniqueCorrelationID = `extend_${this.bookingId}_${timestamp}_${randomSuffix}`;

                const chargeData = {
                    value: diffFare,
                    comment: `Extensão da Corrida ${this.bookingId}`,
                    correlationID: uniqueCorrelationID,
                    additionalInfo: [
                        { key: 'passenger_id', value: this.customerId },
                        { key: 'ride_id', value: this.bookingId },
                        { key: 'payment_type', value: 'ride_extension' },
                        { key: 'new_fare', value: newFareInt.toString() }
                    ],
                    customer: {
                        name: bookingData.passengerName || 'Passageiro Leaf',
                        email: 'passenger@leaf.app.br'
                    }
                };

                const chargeResult = await paymentService.wooviDriverService.createCharge(chargeData);

                if (!chargeResult.success) {
                    throw new Error(`Falha ao gerar cobrança de extensão: ${chargeResult.error}`);
                }

                logStructured('info', 'Extensão de corrida solicitada. Aguardando pagamento', {
                    bookingId: this.bookingId,
                    customerId: this.customerId,
                    diffFare,
                    chargeId: chargeResult.charge?.id
                });

                // Registrar evento de pendência de extensão
                await EventSourcing.recordEvent(EventSourcing.EVENT_TYPES.RIDE_UPDATED, {
                    bookingId: this.bookingId,
                    type: 'EXTENSION_REQUESTED',
                    newEndLocation: this.newEndLocation,
                    newFareInt: newFareInt,
                    diffFare,
                    chargeId: chargeResult.charge?.id,
                    correlationId: this.correlationId
                });

                metrics.recordCommand('ExtendRide', (Date.now() - startTime) / 1000, true);

                return CommandResult.success({
                    bookingId: this.bookingId,
                    diffFare,
                    chargeId: chargeResult.charge?.id,
                    paymentData: {
                        qrCode: chargeResult.charge?.qrCodeImage,
                        paymentLink: chargeResult.charge?.paymentLinkUrl,
                        brCode: chargeResult.charge?.brCode
                    }
                });

            } catch (error) {
                span.recordException(error);
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                span.end();
                logStructured('error', 'ExtendRideCommand falhou', { bookingId: this.bookingId, error: error.message });
                metrics.recordCommand('ExtendRide', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message);
            }
        });
    }
}

module.exports = ExtendRideCommand;
