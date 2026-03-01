/**
 * COMMAND: RequestRideCommand
 * 
 * Processa solicitação de corrida.
 * 
 * Responsabilidades:
 * - Validar dados da corrida
 * - Criar booking no Redis
 * - Adicionar à fila
 * - Publicar evento ride.requested
 * 
 * NÃO faz:
 * - Notificar motoristas (isso é responsabilidade de listeners)
 * - Emitir eventos WebSocket (isso é responsabilidade de handlers)
 */

const { Command, CommandResult } = require('./index');
const RideRequestedEvent = require('../events/ride.requested');
const rideQueueManager = require('../services/ride-queue-manager');
const RideStateManager = require('../services/ride-state-manager');
const redisPool = require('../utils/redis-pool');
const GeoHashUtils = require('../utils/geohash-utils');
const { logger, logStructured } = require('../utils/logger');
const eventSourcing = require('../services/event-sourcing');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');

class RequestRideCommand extends Command {
    constructor(data) {
        super(data);
        this.customerId = data.customerId;
        this.pickupLocation = data.pickupLocation;
        this.destinationLocation = data.destinationLocation;
        this.estimatedFare = data.estimatedFare || 0;
        this.paymentMethod = data.paymentMethod || 'pix';
        // ✅ VALIDAÇÃO: Garantir traceId válido
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'RequestRide');
        this.correlationId = data.correlationId || null; // ✅ Adicionar correlationId
    }

    validate() {
        if (!this.customerId) {
            throw new Error('RequestRideCommand: customerId é obrigatório');
        }
        if (!this.pickupLocation || !this.pickupLocation.lat || !this.pickupLocation.lng) {
            throw new Error('RequestRideCommand: pickupLocation é obrigatório com lat e lng');
        }
        if (!this.destinationLocation || !this.destinationLocation.lat || !this.destinationLocation.lng) {
            throw new Error('RequestRideCommand: destinationLocation é obrigatório com lat e lng');
        }
        if (this.estimatedFare < 0) {
            throw new Error('RequestRideCommand: estimatedFare deve ser >= 0');
        }
        return true;
    }

    async execute() {
        const startTime = Date.now();
        // ✅ OBSERVABILIDADE: Executar com traceId
        return await traceContext.runWithTraceId(this.traceId, async () => {
            try {
                logStructured('info', 'RequestRideCommand.execute iniciado', {
                    customerId: this.customerId,
                    command: 'RequestRideCommand'
                });
                
                // Validar
                this.validate();

                // Garantir conexão Redis
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                // Gerar bookingId
                const bookingId = `booking_${Date.now()}_${this.customerId}`;

                // Calcular região (GeoHash)
                const regionHash = GeoHashUtils.getRegionHash(
                    this.pickupLocation.lat,
                    this.pickupLocation.lng,
                    5 // Precisão 5 = ~5km x 5km
                );

                // Criar dados da corrida
                const bookingData = {
                    bookingId,
                    customerId: this.customerId,
                    pickupLocation: this.pickupLocation,
                    destinationLocation: this.destinationLocation,
                    estimatedFare: this.estimatedFare,
                    paymentMethod: this.paymentMethod,
                    regionHash
                };

                // Adicionar à fila (isso também cria o booking no Redis)
                await rideQueueManager.enqueueRide(bookingData);

                // Atualizar estado para SEARCHING
                await RideStateManager.updateBookingState(
                    redis,
                    bookingId,
                    RideStateManager.STATES.SEARCHING
                );

                // Criar evento canônico
                const event = new RideRequestedEvent({
                    bookingId,
                    customerId: this.customerId,
                    pickupLocation: this.pickupLocation,
                    destinationLocation: this.destinationLocation,
                    estimatedFare: this.estimatedFare,
                    paymentMethod: this.paymentMethod,
                    traceId: this.traceId, // ✅ Incluir traceId no evento
                    correlationId: this.correlationId || bookingId // ✅ Incluir correlationId no evento
                });

                // Registrar evento no event sourcing
                await eventSourcing.recordEvent(
                    eventSourcing.EVENT_TYPES.RIDE_REQUESTED,
                    event.data
                );

                logStructured('info', 'RequestRideCommand executado com sucesso', {
                    bookingId,
                    customerId: this.customerId,
                    command: 'RequestRideCommand'
                });

                // ✅ OBSERVABILIDADE: Registrar métrica de sucesso
                metrics.recordCommand('RequestRide', (Date.now() - startTime) / 1000, true);

                // Retornar resultado com dados da corrida e evento
                return CommandResult.success({
                    bookingId,
                    bookingData,
                    event: event.toJSON(),
                    regionHash
                });

            } catch (error) {
                logStructured('error', 'RequestRideCommand falhou', {
                    customerId: this.customerId,
                    command: 'RequestRideCommand',
                    error: error.message
                });
                metrics.recordCommand('RequestRide', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message)
            }
        });
    }
}

module.exports = RequestRideCommand;
