/**
 * 🎯 Helpers para criação de spans (manual instrumentation)
 * 
 * Seguindo as recomendações:
 * - Spans apenas em pontos críticos
 * - Não instrumentar funções utilitárias
 * - Não instrumentar queries Redis individuais
 * - Não instrumentar loops
 */

const { SpanStatusCode } = require('@opentelemetry/api');
const traceContext = require('./trace-context');

/**
 * Criar span para socket handler (root span)
 * 
 * ✅ correlationId: ID de negócio (rideId/bookingId) - estável por fluxo de corrida
 * ✅ traceId: Gerado automaticamente pelo OTel - técnico
 */
function createSocketSpan(tracer, eventName, attributes = {}) {
    const traceId = traceContext.getCurrentTraceId();
    
    // ✅ Extrair correlationId (rideId/bookingId) se disponível
    const correlationId = attributes['correlation.id'] || attributes['ride.id'] || attributes['booking.id'] || null;
    
    const span = tracer.startSpan(`socket.${eventName}`, {
        attributes: {
            'socket.event': eventName,
            'trace.id': traceId || 'unknown',
            // ✅ Adicionar correlationId se disponível
            ...(correlationId && { 'correlation.id': correlationId }),
            ...attributes
        }
    });
    
    // Adicionar traceId ao contexto
    if (traceId) {
        span.setAttribute('trace.id', traceId);
    }
    
    return span;
}

/**
 * Criar span para Command
 * 
 * ✅ Herda correlationId do parent span
 */
function createCommandSpan(tracer, commandName, parentSpan, attributes = {}) {
    // ✅ Extrair correlationId do parent se disponível
    const parentCorrelationId = parentSpan?.attributes?.['correlation.id'] || attributes['correlation.id'] || null;
    
    const span = tracer.startSpan(`command.${commandName}`, {
        parent: parentSpan,
        attributes: {
            'command.name': commandName,
            // ✅ Adicionar correlationId se disponível
            ...(parentCorrelationId && { 'correlation.id': parentCorrelationId }),
            ...attributes
        }
    });
    
    return span;
}

/**
 * Criar span para Event publish
 * 
 * ✅ Herda correlationId do parent span
 * ✅ Salva traceId no evento para linkar com listeners
 */
function createEventSpan(tracer, eventType, parentSpan, attributes = {}) {
    // ✅ Extrair correlationId do parent se disponível
    const parentCorrelationId = parentSpan?.attributes?.['correlation.id'] || attributes['correlation.id'] || null;
    
    const span = tracer.startSpan(`event.publish.${eventType}`, {
        parent: parentSpan,
        attributes: {
            'event.type': eventType,
            // ✅ Adicionar correlationId se disponível
            ...(parentCorrelationId && { 'correlation.id': parentCorrelationId }),
            ...attributes
        }
    });
    
    return span;
}

/**
 * Criar span para Listener (linkado ao evento)
 */
function createListenerSpan(tracer, listenerName, eventSpanContext, attributes = {}) {
    const span = tracer.startSpan(`listener.${listenerName}`, {
        links: eventSpanContext ? [{ context: eventSpanContext }] : [],
        attributes: {
            'listener.name': listenerName,
            ...attributes
        }
    });
    
    return span;
}

/**
 * Criar span para operação Redis (agrupada, não granular)
 */
function createRedisSpan(tracer, operation, parentSpan, attributes = {}) {
    const span = tracer.startSpan(`redis.${operation}`, {
        parent: parentSpan,
        attributes: {
            'redis.operation': operation,
            ...attributes
        }
    });
    
    return span;
}

/**
 * Criar span para Circuit Breaker
 */
function createCircuitBreakerSpan(tracer, circuitName, state, parentSpan, attributes = {}) {
    const span = tracer.startSpan(`circuit.${circuitName}`, {
        parent: parentSpan,
        attributes: {
            'circuit.name': circuitName,
            'circuit.state': state,
            ...attributes
        }
    });
    
    return span;
}

/**
 * Finalizar span com sucesso
 */
function endSpanSuccess(span, attributes = {}) {
    if (span && !span.ended) {
        span.setStatus({ code: SpanStatusCode.OK });
        if (Object.keys(attributes).length > 0) {
            span.setAttributes(attributes);
        }
        span.end();
    }
}

/**
 * Finalizar span com erro
 */
function endSpanError(span, error, attributes = {}) {
    if (span && !span.ended) {
        span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message
        });
        span.recordException(error);
        if (Object.keys(attributes).length > 0) {
            span.setAttributes(attributes);
        }
        span.end();
    }
}

/**
 * Adicionar evento a um span (para idempotency, etc)
 */
function addSpanEvent(span, eventName, attributes = {}) {
    if (span && !span.ended) {
        span.addEvent(eventName, attributes);
    }
}

/**
 * Wrapper para executar função dentro de um span
 */
async function runInSpan(span, fn) {
    const { context, trace } = require('@opentelemetry/api');
    
    return await context.with(
        trace.setSpan(context.active(), span),
        async () => {
            try {
                const result = await fn();
                endSpanSuccess(span);
                return result;
            } catch (error) {
                endSpanError(span, error);
                throw error;
            }
        }
    );
}

module.exports = {
    createSocketSpan,
    createCommandSpan,
    createEventSpan,
    createListenerSpan,
    createRedisSpan,
    createCircuitBreakerSpan,
    endSpanSuccess,
    endSpanError,
    addSpanEvent,
    runInSpan
};

