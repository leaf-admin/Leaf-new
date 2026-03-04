/**
 * Middleware para gerar e propagar traceId automaticamente
 * 
 * Este middleware:
 * 1. Gera traceId automaticamente se não for fornecido
 * 2. Adiciona traceId aos headers do socket
 * 3. Propaga traceId através de todas as operações
 */

const traceContext = require('../utils/trace-context');
const { logStructured } = require('../utils/logger');
const { validateAndEnsureTraceIdInHandler } = require('../utils/trace-validator');

/**
 * Middleware para Socket.IO que gera traceId automaticamente
 * 
 * @param {Object} socket - Socket.IO socket instance
 * @param {Function} next - Next middleware function
 */
function traceIdSocketMiddleware(socket, next) {
    try {
        // Extrair traceId dos headers ou gerar novo (forçar novo se não houver no query/header)
        const traceId = traceContext.extractTraceId(
            socket.handshake?.query || {},
            socket.handshake?.headers || {}
        );

        // Adicionar traceId aos headers do socket para acesso posterior
        if (!socket.handshake.headers) {
            socket.handshake.headers = {};
        }
        socket.handshake.headers['x-trace-id'] = traceId;

        // Adicionar traceId ao objeto socket para acesso fácil
        socket.traceId = traceId;

        // Executar próximo middleware com traceId no contexto
        traceContext.runWithTraceId(traceId, () => {
            logStructured('info', 'Socket conectado com traceId', {
                socketId: socket.id,
                traceId,
                operation: 'socket_connection'
            });
            next();
        });
    } catch (error) {
        logStructured('error', 'Erro no middleware traceId', {
            socketId: socket.id,
            error: error.message,
            operation: 'traceId_middleware'
        });
        // Continuar mesmo em caso de erro (não bloquear conexão)
        next();
    }
}

/**
 * Middleware para Express que gera traceId automaticamente
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
function traceIdExpressMiddleware(req, res, next) {
    try {
        // Extrair traceId dos headers ou gerar novo
        const traceId = traceContext.extractTraceId(
            req.body || {},
            req.headers || {}
        );

        // Adicionar traceId aos headers da requisição
        req.headers['x-trace-id'] = traceId;

        // Adicionar traceId ao objeto req para acesso fácil
        req.traceId = traceId;

        // Executar próximo middleware com traceId no contexto
        traceContext.runWithTraceId(traceId, () => {
            logStructured('info', 'Requisição HTTP recebida com traceId', {
                method: req.method,
                path: req.path,
                traceId,
                operation: 'http_request'
            });
            next();
        });
    } catch (error) {
        logStructured('error', 'Erro no middleware traceId Express', {
            method: req.method,
            path: req.path,
            error: error.message,
            operation: 'traceId_express_middleware'
        });
        // Continuar mesmo em caso de erro (não bloquear requisição)
        next();
    }
}

/**
 * Helper para extrair traceId de dados de evento WebSocket
 * 
 * @param {Object} data - Dados do evento
 * @param {Object} socket - Socket.IO socket instance
 * @returns {string} traceId
 */
function extractTraceIdFromEvent(data, socket) {
    // ✅ VALIDAÇÃO: Usar validador para garantir traceId válido
    return validateAndEnsureTraceIdInHandler(data, socket, data?.eventName || 'unknown');
}

module.exports = {
    traceIdSocketMiddleware,
    traceIdExpressMiddleware,
    extractTraceIdFromEvent
};

