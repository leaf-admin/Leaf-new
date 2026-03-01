/**
 * 🎯 TRACE VALIDATOR - Validação de traceId
 * 
 * Valida se traceId está sendo propagado corretamente em todos os pontos críticos
 */

const traceContext = require('./trace-context');
const { logStructured, logError } = require('./logger');

/**
 * Validar se traceId está presente e é válido
 * @param {string} traceId - TraceId a validar
 * @param {string} context - Contexto onde está sendo validado (ex: 'command', 'event', 'handler')
 * @param {Object} metadata - Metadados adicionais para log
 * @returns {boolean} true se válido, false caso contrário
 */
function validateTraceId(traceId, context = 'unknown', metadata = {}) {
    // Validação 1: traceId deve existir
    if (!traceId) {
        logStructured('warn', 'TraceId ausente', {
            service: 'trace-validator',
            operation: 'validate',
            context,
            ...metadata
        });
        return false;
    }

    // Validação 2: traceId deve ser string
    if (typeof traceId !== 'string') {
        logStructured('warn', 'TraceId inválido (não é string)', {
            service: 'trace-validator',
            operation: 'validate',
            context,
            traceId: String(traceId),
            ...metadata
        });
        return false;
    }

    // Validação 3: traceId não deve estar vazio
    if (traceId.trim() === '') {
        logStructured('warn', 'TraceId vazio', {
            service: 'trace-validator',
            operation: 'validate',
            context,
            ...metadata
        });
        return false;
    }

    // Validação 4: traceId deve ter formato válido (prefixo-timestamp-random)
    const traceIdPattern = /^[a-z]+-\d+-[a-f0-9-]+$/i;
    if (!traceIdPattern.test(traceId)) {
        logStructured('warn', 'TraceId com formato inválido', {
            service: 'trace-validator',
            operation: 'validate',
            context,
            traceId,
            expectedFormat: 'prefix-timestamp-random',
            ...metadata
        });
        return false;
    }

    return true;
}

/**
 * Validar e garantir traceId (gera novo se inválido)
 * @param {string} traceId - TraceId a validar
 * @param {string} context - Contexto onde está sendo validado
 * @param {Object} metadata - Metadados adicionais
 * @returns {string} traceId válido (original ou gerado)
 */
function ensureValidTraceId(traceId, context = 'unknown', metadata = {}) {
    if (validateTraceId(traceId, context, metadata)) {
        return traceId;
    }

    // Gerar novo traceId se inválido
    const newTraceId = traceContext.generateTraceId(context.substring(0, 3) || 'req');
    
    logStructured('info', 'TraceId gerado automaticamente', {
        service: 'trace-validator',
        operation: 'ensureValid',
        context,
        oldTraceId: traceId,
        newTraceId,
        ...metadata
    });

    return newTraceId;
}

/**
 * Validar propagação de traceId através de múltiplos pontos
 * @param {Object} traceData - Dados com traceId em diferentes pontos
 * @returns {Object} Resultado da validação
 */
function validateTracePropagation(traceData) {
    const results = {
        valid: true,
        errors: [],
        warnings: [],
        traceIds: {}
    };

    // Extrair traceIds de diferentes pontos
    const traceIds = {
        handler: traceData.handler?.traceId,
        command: traceData.command?.traceId,
        event: traceData.event?.traceId || traceData.event?.metadata?.traceId,
        listener: traceData.listener?.traceId,
        context: traceContext.getCurrentTraceId()
    };

    results.traceIds = traceIds;

    // Validar cada traceId
    Object.entries(traceIds).forEach(([point, traceId]) => {
        if (!traceId) {
            results.valid = false;
            results.errors.push(`TraceId ausente em: ${point}`);
        } else if (!validateTraceId(traceId, point)) {
            results.valid = false;
            results.errors.push(`TraceId inválido em: ${point}`);
        }
    });

    // Verificar consistência (todos devem ser iguais ou relacionados)
    const uniqueTraceIds = new Set(Object.values(traceIds).filter(Boolean));
    if (uniqueTraceIds.size > 1) {
        results.warnings.push(`Múltiplos traceIds encontrados: ${Array.from(uniqueTraceIds).join(', ')}`);
    }

    return results;
}

/**
 * Middleware para validar traceId em handlers WebSocket
 * @param {Object} data - Dados do evento
 * @param {Object} socket - Socket.IO socket
 * @param {string} eventName - Nome do evento
 * @returns {string} traceId válido
 */
function validateAndEnsureTraceIdInHandler(data, socket, eventName) {
    // Tentar extrair traceId de múltiplas fontes
    let traceId = 
        data?.traceId ||
        data?.metadata?.traceId ||
        socket?.traceId ||
        socket?.handshake?.headers?.['x-trace-id'] ||
        traceContext.getCurrentTraceId();

    // Validar e garantir traceId
    traceId = ensureValidTraceId(traceId, `handler.${eventName}`, {
        eventName,
        socketId: socket?.id,
        userId: socket?.userId
    });

    // Definir no contexto
    traceContext.setCurrentTraceId(traceId);

    return traceId;
}

/**
 * Validar traceId em Command
 * @param {Object} commandData - Dados do command
 * @param {string} commandName - Nome do command
 * @returns {string} traceId válido
 */
function validateAndEnsureTraceIdInCommand(commandData, commandName) {
    let traceId = 
        commandData?.traceId ||
        traceContext.getCurrentTraceId();

    traceId = ensureValidTraceId(traceId, `command.${commandName}`, {
        commandName,
        bookingId: commandData?.bookingId,
        rideId: commandData?.rideId
    });

    traceContext.setCurrentTraceId(traceId);

    return traceId;
}

/**
 * Validar traceId em Event
 * @param {Object} eventData - Dados do evento
 * @param {string} eventType - Tipo do evento
 * @returns {string} traceId válido
 */
function validateAndEnsureTraceIdInEvent(eventData, eventType) {
    let traceId = 
        eventData?.traceId ||
        eventData?.metadata?.traceId ||
        traceContext.getCurrentTraceId();

    traceId = ensureValidTraceId(traceId, `event.${eventType}`, {
        eventType,
        bookingId: eventData?.bookingId,
        rideId: eventData?.rideId
    });

    // Garantir que está no metadata também
    if (eventData && !eventData.metadata) {
        eventData.metadata = {};
    }
    if (eventData && eventData.metadata) {
        eventData.metadata.traceId = traceId;
    }

    return traceId;
}

/**
 * Validar traceId em Listener
 * @param {Object} event - Evento recebido
 * @param {string} listenerName - Nome do listener
 * @returns {string} traceId válido
 */
function validateAndEnsureTraceIdInListener(event, listenerName) {
    let traceId = 
        event?.data?.traceId ||
        event?.data?.metadata?.traceId ||
        traceContext.getCurrentTraceId();

    traceId = ensureValidTraceId(traceId, `listener.${listenerName}`, {
        listenerName,
        eventType: event?.eventType,
        eventId: event?.eventId
    });

    traceContext.setCurrentTraceId(traceId);

    return traceId;
}

/**
 * Log de validação de traceId (para debug)
 * @param {string} point - Ponto de validação
 * @param {string} traceId - TraceId validado
 * @param {Object} metadata - Metadados adicionais
 */
function logTraceValidation(point, traceId, metadata = {}) {
    if (process.env.DEBUG_TRACE === 'true' || process.env.NODE_ENV === 'development') {
        logStructured('debug', 'TraceId validado', {
            service: 'trace-validator',
            operation: 'logValidation',
            point,
            traceId,
            ...metadata
        });
    }
}

module.exports = {
    validateTraceId,
    ensureValidTraceId,
    validateTracePropagation,
    validateAndEnsureTraceIdInHandler,
    validateAndEnsureTraceIdInCommand,
    validateAndEnsureTraceIdInEvent,
    validateAndEnsureTraceIdInListener,
    logTraceValidation
};

