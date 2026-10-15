/**
 * TRACE CONTEXT - Gerenciador de traceId
 * 
 * Gerencia traceId para rastreamento de requisições através de toda a cadeia.
 * 
 * Padrão Uber/99: Um ride = um traceId do início ao fim
 */

const { randomUUID } = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * Classe para gerenciar contexto de trace
 */
class TraceContext {
    constructor() {
        this.contexts = new Map(); // Map<traceId, context>
        // Um store por cadeia assíncrona: requisições simultâneas não compartilham traceId.
        this.asyncLocalStorage = new AsyncLocalStorage();
    }

    /**
     * Gerar novo traceId
     * @param {string} prefix - Prefixo opcional (ex: 'req', 'cmd', 'evt')
     * @returns {string} traceId único
     */
    generateTraceId(prefix = 'req') {
        const timestamp = Date.now();
        const random = randomUUID().substring(0, 8);
        return `${prefix}-${timestamp}-${random}`;
    }

    /**
     * Obter traceId do contexto atual (AsyncLocalStorage)
     * Se não existir, gera um novo
     */
    getCurrentTraceId() {
        const store = this.asyncLocalStorage.getStore();
        if (store?.traceId) {
            return store.traceId;
        }
        
        // Fallback: usar contexto do processo atual (para compatibilidade)
        return process.currentTraceId || null;
    }

    /**
     * Definir traceId no contexto atual
     */
    setCurrentTraceId(traceId) {
        // Dentro de runWithTraceId, troca o traceId só desta cadeia assíncrona.
        const store = this.asyncLocalStorage.getStore();
        if (store) {
            store.traceId = traceId;
            return;
        }

        // Fora de um contexto (scripts, inicialização): valor do processo.
        process.currentTraceId = traceId;
    }

    /**
     * Criar contexto com traceId
     * @param {string} traceId - TraceId (ou gera novo se não fornecido)
     * @param {Function} fn - Função a executar no contexto
     */
    async runWithTraceId(traceId, fn) {
        const finalTraceId = traceId || this.generateTraceId();
        return this.asyncLocalStorage.run({ traceId: finalTraceId }, fn);
    }

    /**
     * Extrair traceId de dados (compatibilidade)
     * Procura em: data.traceId, data.metadata.traceId, headers['x-trace-id']
     */
    extractTraceId(data, headers = {}) {
        // Prioridade 1: data.traceId
        if (data?.traceId) {
            return data.traceId;
        }
        
        // Prioridade 2: data.metadata.traceId
        if (data?.metadata?.traceId) {
            return data.metadata.traceId;
        }
        
        // Prioridade 3: headers['x-trace-id']
        if (headers['x-trace-id']) {
            return headers['x-trace-id'];
        }
        
        // Prioridade 4: contexto atual
        const current = this.getCurrentTraceId();
        if (current) {
            return current;
        }
        
        // Último recurso: gerar novo
        return this.generateTraceId();
    }
}

// Singleton
const traceContext = new TraceContext();

module.exports = traceContext;
