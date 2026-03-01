/**
 * COMMAND HANDLERS - LEAF
 * 
 * Camada de comandos que processa ações e publica eventos.
 * 
 * Regras:
 * - Commands NÃO notificam
 * - Commands NÃO fazem socket
 * - Commands NÃO chamam outros serviços diretamente
 * - Commands apenas mudam estado + publicam evento
 */

const { logger } = require('../utils/logger');

/**
 * Classe base para commands
 */
class Command {
    constructor(data) {
        this.commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.timestamp = Date.now();
        this.data = data;
    }

    /**
     * Validar command
     */
    validate() {
        throw new Error('validate() deve ser implementado pela subclasse');
    }

    /**
     * Executar command
     */
    async execute() {
        throw new Error('execute() deve ser implementado pela subclasse');
    }
}

/**
 * Resultado de um command
 */
class CommandResult {
    constructor(success, data = null, error = null) {
        this.success = success;
        this.data = data;
        this.error = error;
        this.timestamp = Date.now();
    }

    static success(data) {
        return new CommandResult(true, data);
    }

    static failure(error) {
        return new CommandResult(false, null, error);
    }
}

module.exports = {
    Command,
    CommandResult
};
