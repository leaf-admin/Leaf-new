/**
 * Connection Monitor Service
 * Monitora conexões WebSocket e fornece estatísticas consolidadas
 */

const { logError } = require('../utils/logger');

class ConnectionMonitor {
    constructor() {
        // Armazenar conexões ativas
        this.connections = new Map(); // socketId -> { userId, userType, workerId, connectedAt }
        this.workers = new Set(); // IDs de workers ativos
    }

    /**
     * Registrar uma nova conexão
     * @param {string} socketId - ID do socket
     * @param {string|null} userId - ID do usuário (null se não autenticado)
     * @param {string} userType - Tipo de usuário ('driver', 'passenger', 'unknown')
     * @param {string} workerId - ID do worker que está gerenciando a conexão
     */
    async registerConnection(socketId, userId, userType, workerId) {
        try {
            this.connections.set(socketId, {
                userId: userId,
                userType: userType,
                workerId: workerId,
                connectedAt: new Date(),
                authenticated: userId !== null
            });
            
            if (workerId) {
                this.workers.add(workerId);
            }
            
            return true;
        } catch (error) {
            logError(error, 'Erro ao registrar conexão', { service: 'connection-monitor', socketId });
            return false;
        }
    }

    /**
     * Atualizar tipo de conexão (quando usuário se autentica)
     * @param {string} socketId - ID do socket
     * @param {string} userId - ID do usuário
     * @param {string} userType - Tipo de usuário ('driver', 'passenger')
     */
    async updateConnectionType(socketId, userId, userType) {
        try {
            const connection = this.connections.get(socketId);
            if (connection) {
                connection.userId = userId;
                connection.userType = userType;
                connection.authenticated = true;
                this.connections.set(socketId, connection);
            }
            return true;
        } catch (error) {
            logError(error, 'Erro ao atualizar tipo de conexão', { service: 'connection-monitor', socketId });
            return false;
        }
    }

    /**
     * Remover uma conexão
     * @param {string} socketId - ID do socket
     * @param {string} workerId - ID do worker
     */
    async unregisterConnection(socketId, workerId) {
        try {
            this.connections.delete(socketId);
            
            // Verificar se ainda há conexões neste worker
            const hasConnections = Array.from(this.connections.values())
                .some(conn => conn.workerId === workerId);
            
            if (!hasConnections && workerId) {
                this.workers.delete(workerId);
            }
            
            return true;
        } catch (error) {
            logError(error, 'Erro ao remover conexão', { service: 'connection-monitor', socketId });
            return false;
        }
    }

    /**
     * Obter estatísticas consolidadas
     * @returns {Promise<Object>} Estatísticas consolidadas
     */
    async getConsolidatedStats() {
        try {
            const connections = Array.from(this.connections.values());
            
            // Contar conexões por tipo
            const byType = {
                driver: 0,
                passenger: 0,
                unknown: 0
            };
            
            // Contar conexões por worker
            const byWorker = {};
            
            let authenticated = 0;
            
            connections.forEach(conn => {
                // Contar por tipo
                if (conn.userType === 'driver') {
                    byType.driver++;
                } else if (conn.userType === 'passenger' || conn.userType === 'customer') {
                    byType.passenger++;
                } else {
                    byType.unknown++;
                }
                
                // Contar por worker
                const workerId = conn.workerId || 'unknown';
                byWorker[workerId] = (byWorker[workerId] || 0) + 1;
                
                // Contar autenticadas
                if (conn.authenticated) {
                    authenticated++;
                }
            });
            
            return {
                total: connections.length,
                authenticated: authenticated,
                byType: byType,
                byWorker: byWorker,
                workers: Array.from(this.workers),
                activeWorkers: this.workers.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logError(error, 'Erro ao obter estatísticas consolidadas', { service: 'connection-monitor' });
            return {
                total: 0,
                authenticated: 0,
                byType: { driver: 0, passenger: 0, unknown: 0 },
                byWorker: {},
                workers: [],
                activeWorkers: 0,
                timestamp: new Date().toISOString(),
                error: error.message
            };
        }
    }

    /**
     * Obter conexão específica
     * @param {string} socketId - ID do socket
     * @returns {Object|null} Dados da conexão
     */
    getConnection(socketId) {
        return this.connections.get(socketId) || null;
    }

    /**
     * Limpar todas as conexões (útil para testes)
     */
    clear() {
        this.connections.clear();
        this.workers.clear();
    }
}

// Exportar instância singleton
module.exports = new ConnectionMonitor();

