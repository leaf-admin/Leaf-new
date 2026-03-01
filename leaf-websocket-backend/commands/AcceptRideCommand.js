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

                // ✅ Risco 1 Resolvido: Watch no BookingKey para prevenir TOCTOU Race Condition
                // Se qualquer outro motorista/processo alterar essa chave, o EXEC falhará.
                await redis.watch(bookingKey);

                // Buscar dados da corrida
                // Buscar dados da corrida
                const bookingData = await redis.hgetall(bookingKey);

                if (!bookingData || Object.keys(bookingData).length === 0) {
                    await redis.unwatch(); // Liberar watch antes de sair
                    metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Corrida não encontrada')
                }

                // Verificar estado atual (usando os dados em memória puxados via HGETALL atrelados ao WATCH)
                const currentState = bookingData.state;

                // Validar transição de estado
                if (!RideStateManager.isValidTransition(currentState, RideStateManager.STATES.ACCEPTED)) {
                    await redis.unwatch(); // Liberar watch
                    metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure(
                        `Corrida não pode ser aceita no estado atual: ${currentState}`
                    )
                }

                // Verificar se motorista já está em outra corrida
                const isLocked = await driverLockManager.isDriverLocked(this.driverId);
                if (isLocked.isLocked && isLocked.bookingId !== this.bookingId) {
                    await redis.unwatch(); // Liberar watch
                    metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Motorista já está em outra corrida')
                }

                // Parsear dados da corrida
                const customerId = bookingData.customerId;
                const pickupLocation = bookingData.pickupLocation ?
                    JSON.parse(bookingData.pickupLocation) : null;

                // Iniciar transação no Redis para alteração Atômica
                const multi = redis.multi();

                // Preparar dados de estado
                const newState = RideStateManager.STATES.ACCEPTED;
                const updatedStateData = {
                    state: newState,
                    updatedAt: new Date().toISOString(),
                    driverId: this.driverId,
                    acceptedAt: new Date().toISOString()
                };

                // Atualizar banco via bloco atômico MULTI (Semelhante ao que o RideStateManager.updateBookingState faria, mas isolado no bloco EXEC)
                multi.hset(bookingKey, {
                    ...updatedStateData,
                    status: 'ACCEPTED' // Mantido para retrocompatibilidade
                });

                // Executar bloco (Gatilho da Race Condition)
                const execResult = await multi.exec();

                if (!execResult) {
                    // Se null no ioredis, significa que a transação falhou devido a uma modificação feita por outra requisição (o Watch desarmou)
                    metrics.recordCommand('AcceptRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('A corrida já foi aceita por outro motorista');
                }

                // Registrar evento no histórico de estado manualmente, dado que encapsulamos o update no bloco
                await eventSourcing.recordEvent(require('../services/event-sourcing').EVENT_TYPES.STATE_CHANGED, {
                    bookingId: this.bookingId,
                    fromState: currentState || 'UNKNOWN',
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
