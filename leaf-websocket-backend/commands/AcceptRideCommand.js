/**
 * COMMAND: AcceptRideCommand
 * 
 * Processa aceitação de corrida por motorista.
 * 
 * Responsabilidades:
 * - Validar que corrida pode ser aceita
 * - Atualizar estado da corrida
 * - Atribuir motorista à corrida
 * - Publicar evento ride.accepted
 * 
 * NÃO faz:
 * - Notificar passageiro (isso é responsabilidade de listeners)
 * - Emitir eventos WebSocket (isso é responsabilidade de handlers)
 */

const { Command, CommandResult } = require('./index');
const RideAcceptedEvent = require('../events/ride.accepted');
const RideStateManager = require('../services/ride-state-manager');
const redisPool = require('../utils/redis-pool');
const driverLockManager = require('../services/driver-lock-manager');
const { logger, logStructured } = require('../utils/logger');
const eventSourcing = require('../services/event-sourcing');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');

class AcceptRideCommand extends Command {
    constructor(data) {
        super(data);
        this.driverId = data.driverId;
        this.bookingId = data.bookingId;
        // ✅ VALIDAÇÃO: Garantir traceId válido
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'AcceptRide');
        this.correlationId = data.correlationId || this.bookingId; // ✅ Adicionar correlationId
    }

    validate() {
        if (!this.driverId) {
            throw new Error('AcceptRideCommand: driverId é obrigatório');
        }
        if (!this.bookingId) {
            throw new Error('AcceptRideCommand: bookingId é obrigatório');
        }
        return true;
    }

    async execute() {
        const startTime = Date.now();
        // ✅ OBSERVABILIDADE: Executar com traceId
        return await traceContext.runWithTraceId(this.traceId, async () => {
            try {
                logStructured('info', 'AcceptRideCommand.execute iniciado', {
                    driverId: this.driverId,
                    bookingId: this.bookingId,
                    command: 'AcceptRideCommand'
                });

                // Validar
                this.validate();

                // Garantir conexão Redis
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                const bookingKey = `booking:${this.bookingId}`;

                // Verificar se motorista já está em outra corrida (Lock de driver separado)
                const isLocked = await driverLockManager.isDriverLocked(this.driverId);
                if (isLocked.isLocked && isLocked.bookingId !== this.bookingId) {
                    metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Motorista já está em outra corrida')
                }

                const newState = RideStateManager.STATES.ACCEPTED;
                const updatedAt = new Date().toISOString();

                // LUA Script Atômico para garantir lock transacional absoluto do Booking
                const luaScript = `
                    local bookingKey = KEYS[1]
                    local driverId = ARGV[1]
                    local newState = ARGV[2]
                    local updatedAt = ARGV[3]

                    if redis.call('EXISTS', bookingKey) == 0 then
                        return 'ERR_NOT_FOUND'
                    end

                    local currentState = redis.call('HGET', bookingKey, 'state')
                    local currentStatus = redis.call('HGET', bookingKey, 'status')
                    
                    if currentState ~= 'PENDING' and currentState ~= 'REQUESTED' and currentState ~= 'SEARCHING' and currentStatus ~= 'pending' then
                        return 'ERR_INVALID_STATE_' .. (currentState or 'null')
                    end

                    -- Realiza o update atômico
                    redis.call('HMSET', bookingKey, 
                        'state', newState, 
                        'status', 'ACCEPTED', 
                        'driverId', driverId, 
                        'updatedAt', updatedAt, 
                        'acceptedAt', updatedAt
                    )

                    -- Retorna dados complementares concatenados (customerId|||pickupLocation)
                    local customerId = redis.call('HGET', bookingKey, 'customerId')
                    local pickupLoc = redis.call('HGET', bookingKey, 'pickupLocation')
                    return (customerId or '') .. '|||' .. (pickupLoc or '')
                `;

                // Executar o LUA no redis
                const redisResult = await redis.eval(luaScript, 1, bookingKey, this.driverId, newState, updatedAt);

                if (typeof redisResult === 'string' && redisResult.startsWith('ERR_')) {
                    metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                    if (redisResult === 'ERR_NOT_FOUND') {
                        return CommandResult.failure('Corrida não encontrada');
                    }
                    return CommandResult.failure(`A corrida já foi aceita por outro motorista ou não está mais disponível.`);
                }

                // Parseando retorno atômico do LUA
                const [customerId, rawPickupLocation] = redisResult.split('|||');
                const pickupLocation = rawPickupLocation ? JSON.parse(rawPickupLocation) : null;
                const currentState = 'PENDING'; // Historicamente veio de Pending

                // Registrar evento no histórico de estado manualmente
                await eventSourcing.recordEvent(require('../services/event-sourcing').EVENT_TYPES.STATE_CHANGED, {
                    bookingId: this.bookingId,
                    fromState: currentState,
                    toState: newState,
                    driverId: this.driverId
                });

                // Criar evento canônico
                const event = new RideAcceptedEvent({
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    traceId: this.traceId, // ✅ Incluir traceId no evento
                    correlationId: this.correlationId || this.bookingId // ✅ Incluir correlationId no evento
                });

                // Registrar evento no event sourcing
                await eventSourcing.recordEvent(
                    eventSourcing.EVENT_TYPES.RIDE_ACCEPTED,
                    event.data
                );

                logStructured('info', 'AcceptRideCommand executado com sucesso', {
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    command: 'AcceptRideCommand'
                });

                // ✅ OBSERVABILIDADE: Registrar métrica de sucesso
                metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, true);

                // Retornar resultado com dados da corrida e evento
                return CommandResult.success({
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    event: event.toJSON(),
                    pickupLocation
                });

            } catch (error) {
                logStructured('error', 'AcceptRideCommand falhou', {
                    driverId: this.driverId,
                    bookingId: this.bookingId,
                    command: 'AcceptRideCommand',
                    error: error.message
                });
                metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message)
            }
        });
    }
}

module.exports = AcceptRideCommand;
