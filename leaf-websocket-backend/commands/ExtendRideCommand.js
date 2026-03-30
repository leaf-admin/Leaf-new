const { Command, CommandResult } = require('./index');
const { logStructured } = require('../utils/logger');
const redisPool = require('../utils/redis-pool');
const RideStateManager = require('../services/ride-state-manager');
const eventSourcing = require('../services/event-sourcing');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const PaymentService = require('../services/payment-service');
const paymentDispatchService = require('../services/payment-dispatch-service');
const {
    resolveContractualFare,
    resolveRideExtensionPaymentTimeoutSec,
    buildRideExtensionExpiresAt
} = require('../services/ride-lifecycle-service');

class ExtendRideCommand extends Command {
    constructor(data) {
        super(data);
        this.bookingId = data.bookingId;
        this.customerId = data.customerId;
        this.newEndLocation = data.newEndLocation;
        this.newFare = data.newFare;
        this.mockPayment = data.mockPayment === true || data.__mockPayment === true;
        this.eventType = data.eventType || 'EXTENSION_REQUESTED';
        this.skipEventRecord = data.skipEventRecord === true;
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'ExtendRide');
        this.correlationId = data.correlationId || this.bookingId;
    }

    validate() {
        if (!this.bookingId) throw new Error('bookingId é obrigatório');
        if (!this.customerId) throw new Error('customerId é obrigatório');
        if (!this.newEndLocation || !this.newEndLocation.lat || !this.newEndLocation.lng) {
            throw new Error('newEndLocation com lat/lng é obrigatório');
        }

        const newFareNumber = Number(this.newFare);
        if (!Number.isFinite(newFareNumber) || newFareNumber <= 0) {
            throw new Error('newFare inválido');
        }
        return true;
    }

    async execute() {
        const startTime = Date.now();

        return traceContext.runWithTraceId(this.traceId, async () => {
            try {
                this.validate();

                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                const bookingKey = `booking:${this.bookingId}`;
                const bookingData = await redis.hgetall(bookingKey);
                if (!bookingData || Object.keys(bookingData).length === 0) {
                    return CommandResult.failure('Corrida não encontrada');
                }

                const bookingCustomerId =
                    bookingData.customerId ||
                    bookingData.passengerId ||
                    bookingData.customer ||
                    null;

                if (bookingCustomerId && bookingCustomerId !== this.customerId) {
                    return CommandResult.failure('Usuário não autorizado a estender esta corrida');
                }

                const currentState = await RideStateManager.getBookingState(redis, this.bookingId);
                const allowedStates = new Set([
                    RideStateManager.STATES.IN_PROGRESS,
                    RideStateManager.STATES.REASSIGNED_IN_PROGRESS
                ]);
                if (!allowedStates.has(currentState)) {
                    return CommandResult.failure('A corrida precisa estar IN_PROGRESS para ser estendida');
                }

                const currentFare = Number(resolveContractualFare(bookingData) || 0);
                const newFareNumber = Number(this.newFare);

                if (newFareNumber <= currentFare) {
                    return CommandResult.failure('O novo destino é mais barato ou igual ao atual. Estorno será feito no fim da viagem.');
                }

                const diffFare = Number((newFareNumber - currentFare).toFixed(2));

                const paymentMockEnabled =
                    this.mockPayment === true ||
                    String(process.env.MOCK_PAYMENT_FOR_TESTS || '').toLowerCase() === 'true' ||
                    (String(process.env.E2E_MOCK_PAYMENT || 'true').toLowerCase() !== 'false' && process.env.NODE_ENV === 'test');

                let chargeId = null;
                let pixQRCode = null;
                let paymentLink = null;
                let brCode = null;
                let expiresAt = null;
                const expiresIn = resolveRideExtensionPaymentTimeoutSec();

                if (paymentMockEnabled) {
                    const stamp = Date.now();
                    chargeId = `mock_extend_${this.bookingId}_${stamp}`;
                    pixQRCode = `mock_pix_qrcode_${stamp}`;
                    paymentLink = `leaf://mock/extend/${this.bookingId}`;
                    brCode = `000201010212mock${stamp}`;
                    expiresAt = buildRideExtensionExpiresAt(new Date(stamp), expiresIn);
                } else {
                    const paymentService = new PaymentService();

                    const timestamp = Date.now();
                    const randomSuffix = Math.random().toString(36).substring(2, 9);
                    const uniqueCorrelationID = `extend_${this.bookingId}_${timestamp}_${randomSuffix}`;

                    const chargeData = {
                        value: diffFare,
                        comment: `Extensão da Corrida ${this.bookingId}`,
                        correlationID: uniqueCorrelationID,
                        expiresIn,
                        additionalInfo: [
                            { key: 'passenger_id', value: this.customerId },
                            { key: 'ride_id', value: this.bookingId },
                            { key: 'payment_type', value: 'ride_extension' },
                            { key: 'new_fare', value: String(newFareNumber) }
                        ],
                        customer: {
                            name: bookingData.passengerName || 'Passageiro Leaf',
                            email: bookingData.passengerEmail || 'passenger@leaf.app.br'
                        }
                    };

                    const chargeResult = await paymentService.wooviDriverService.createCharge(chargeData);
                    if (!chargeResult.success) {
                        return CommandResult.failure(`Falha ao gerar cobrança de extensão: ${chargeResult.error || 'erro desconhecido'}`);
                    }

                    const chargePayload = chargeResult.charge || {};
                    chargeId =
                        chargePayload.identifier ||
                        chargePayload.id ||
                        chargePayload.transactionID ||
                        chargePayload.correlationID ||
                        null;
                    pixQRCode =
                        chargePayload.qrCodeImage ||
                        chargePayload?.paymentMethods?.pix?.qrCodeImage ||
                        chargeResult.qrCode ||
                        null;
                    paymentLink =
                        chargePayload.paymentLinkUrl ||
                        chargePayload?.paymentMethods?.pix?.paymentLinkUrl ||
                        chargeResult.paymentLink ||
                        null;
                    brCode =
                        chargePayload.brCode ||
                        chargePayload?.paymentMethods?.pix?.brCode ||
                        null;
                    expiresAt =
                        chargePayload.expiresAt ||
                        chargePayload.expirationDate ||
                        chargePayload.expiresAtDate ||
                        buildRideExtensionExpiresAt(new Date(), expiresIn);
                }

                await paymentDispatchService.linkPaymentToBooking({
                    bookingId: this.bookingId,
                    chargeId
                });

                if (!this.skipEventRecord) {
                    await eventSourcing.recordEvent('ride.updated', {
                        bookingId: this.bookingId,
                        type: this.eventType,
                        newEndLocation: this.newEndLocation,
                        newFare: newFareNumber,
                        diffFare,
                        chargeId,
                        correlationId: this.correlationId
                    });
                }

                logStructured('info', 'Extensão de corrida solicitada. Aguardando pagamento', {
                    bookingId: this.bookingId,
                    customerId: this.customerId,
                    diffFare,
                    chargeId,
                    mock: paymentMockEnabled
                });

                metrics.recordCommand('ExtendRide', (Date.now() - startTime) / 1000, true);

                return CommandResult.success({
                    success: true,
                    bookingId: this.bookingId,
                    paymentRequired: true,
                    diffFare,
                    newFare: Number(newFareNumber.toFixed(2)),
                    chargeId,
                    pixQRCode,
                    paymentLink,
                    brCode,
                    expiresAt
                });
            } catch (error) {
                logStructured('error', 'ExtendRideCommand falhou', {
                    bookingId: this.bookingId,
                    error: error.message
                });
                metrics.recordCommand('ExtendRide', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message);
            }
        });
    }
}

module.exports = ExtendRideCommand;
