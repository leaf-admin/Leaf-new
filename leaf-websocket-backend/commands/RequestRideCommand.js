/**
 * COMMAND: RequestRideCommand
 * 
 * Processa solicitação de corrida.
 * 
 * Responsabilidades:
 * - Validar dados da corrida
 * - Criar booking no Redis
 * - Adicionar à fila
 * - Construir evento canônico ride.requested (publicação ocorre no handler/EventBus)
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
const { logStructured } = require('../utils/logger');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const geofenceService = require('../services/geofence-service');
const fareEstimationService = require('../services/fare-estimation-service');

class RequestRideCommand extends Command {
    constructor(data) {
        super(data);
        this.customerId = data.customerId;
        this.pickupLocation = data.pickupLocation;
        this.destinationLocation = data.destinationLocation;
        this.estimatedFare = data.estimatedFare || 0;
        this.routeDistanceKm = data.routeDistanceKm || 0;
        this.routeDurationSecs = data.routeDurationSecs || 0;
        this.tollFee = data.tollFee || 0;
        this.carType = data.carType || null;
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
        if (this.routeDistanceKm < 0) {
            throw new Error('RequestRideCommand: routeDistanceKm deve ser >= 0');
        }
        if (this.routeDurationSecs < 0) {
            throw new Error('RequestRideCommand: routeDurationSecs deve ser >= 0');
        }
        if (this.tollFee < 0) {
            throw new Error('RequestRideCommand: tollFee deve ser >= 0');
        }

        // Validação dinâmica de geofence (runtime + dashboard)
        if (geofenceService.isActive()) {
            const geofenceValidation = geofenceService.validateRideLocations(
                this.pickupLocation,
                this.destinationLocation
            );

            if (!geofenceValidation.valid) {
                throw new Error(
                    `A Leaf ainda não opera nesta região. Operação negada: ${geofenceValidation.error || 'Fora da área delimitada pelo mapa.'}`
                );
            }
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

                // Tarifa server-authoritative para evitar divergência de cálculo no cliente.
                const fareEstimation = fareEstimationService.estimateRideFare({
                    pickupLocation: this.pickupLocation,
                    destinationLocation: this.destinationLocation,
                    carType: this.carType,
                    routeDistanceKm: this.routeDistanceKm,
                    routeDurationSecs: this.routeDurationSecs,
                    tollFee: this.tollFee,
                    clientEstimatedFare: this.estimatedFare
                });

                // Criar dados da corrida
                const bookingData = {
                    bookingId,
                    customerId: this.customerId,
                    pickupLocation: this.pickupLocation,
                    destinationLocation: this.destinationLocation,
                    estimatedFare: fareEstimation.estimatedFare,
                    routeDistanceKm: fareEstimation.routeMetrics.distanceKm,
                    routeDurationSecs: fareEstimation.routeMetrics.durationSecs,
                    tollFee: fareEstimation.tollFee,
                    fareSource: fareEstimation.routeMetrics.source,
                    carType: this.carType,
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
                    estimatedFare: fareEstimation.estimatedFare,
                    carType: this.carType,
                    paymentMethod: this.paymentMethod,
                    traceId: this.traceId, // ✅ Incluir traceId no evento
                    correlationId: this.correlationId || bookingId // ✅ Incluir correlationId no evento
                });

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
