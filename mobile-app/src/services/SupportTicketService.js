import Logger from '../utils/Logger';
import AuthService from './AuthService';

class SupportTicketService {
    // ===== CRIAÇÃO E GESTÃO DE TICKETS =====

    /**
     * Criar novo ticket de suporte
     * @param {Object} ticketData - Dados do ticket
     * @returns {Promise<Object>} Ticket criado
     */
    async createTicket(ticketData) {
        try {
            // Obter dados do usuário atual
            const currentUser = await AuthService.getCurrentUser();
            if (!currentUser) {
                throw new Error('Usuário não autenticado');
            }

            const response = await AuthService.supportRequest('/tickets', {
                method: 'POST',
                body: JSON.stringify({
                    subject: ticketData.subject,
                    description: ticketData.description,
                    category: ticketData.category || 'general',
                    priority: ticketData.priority || 'N3',
                    userInfo: {
                        name: currentUser.displayName || ticketData.userName,
                        email: currentUser.email,
                        phone: currentUser.phoneNumber || ticketData.userPhone,
                        appVersion: ticketData.appVersion || '1.0.0',
                        deviceInfo: AuthService.getDeviceInfo()
                    },
                    metadata: {
                        tripId: ticketData.tripId || null,
                        bookingId: ticketData.bookingId || null,
                        paymentId: ticketData.paymentId || null,
                        vehicleId: ticketData.vehicleId || null
                    }
                })
            });

            const result = await AuthService.handleApiResponse(response);
            Logger.log('✅ Ticket criado:', result.ticket.id);
            return result.ticket;

        } catch (error) {
            Logger.error('❌ Erro ao criar ticket:', error);
            throw error;
        }
    }

    /**
     * Atribuir ticket a um agente
     * @param {string} ticketId - ID do ticket
     * @param {string} agentId - ID do agente
     * @param {string} agentName - Nome do agente
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async assignTicket(ticketId, agentId, agentName) {
        try {
            const response = await AuthService.supportRequest(`/admin/tickets/${ticketId}/assign`, {
                method: 'POST',
                body: JSON.stringify({
                    agentId,
                    agentName
                })
            });

            await AuthService.handleApiResponse(response);

            Logger.log('✅ Ticket atribuído:', ticketId, 'para agente:', agentId);
            return true;

        } catch (error) {
            Logger.error('❌ Erro ao atribuir ticket:', error);
            return false;
        }
    }

    /**
     * Escalar ticket para nível superior
     * @param {string} ticketId - ID do ticket
     * @param {string} reason - Motivo da escalação
     * @param {string} escalatedBy - ID de quem escalou
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async escalateTicket(ticketId, reason, escalatedBy) {
        try {
            const response = await AuthService.supportRequest(`/admin/tickets/${ticketId}/escalate`, {
                method: 'POST',
                body: JSON.stringify({
                    reason,
                    escalatedBy
                })
            });
            const result = await AuthService.handleApiResponse(response);

            Logger.log('✅ Ticket escalado:', ticketId, 'para nível:', result.escalationLevel);
            return true;

        } catch (error) {
            Logger.error('❌ Erro ao escalar ticket:', error);
            return false;
        }
    }

    // ===== MENSAGENS E CHAT =====

    /**
     * Adicionar mensagem ao ticket
     * @param {string} ticketId - ID do ticket
     * @param {Object} messageData - Dados da mensagem
     * @returns {Promise<Object>} Mensagem criada
     */
    async addMessage(ticketId, messageData) {
        try {
            const normalizedTicketId = String(ticketId || '').trim();
            if (!normalizedTicketId) {
                throw new Error('Ticket inválido');
            }

            Logger.log('📤 Enviando mensagem para ticket:', normalizedTicketId);
            Logger.log('📝 Dados da mensagem:', { 
                message: messageData.message?.substring(0, 50) + '...',
                messageType: messageData.messageType 
            });

            // ✅ Adicionar timeout explícito e melhor tratamento de erro
            // Nota: React Native pode não suportar AbortController da mesma forma
            // Vamos usar Promise.race para timeout
            let timeoutId = null;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('Send message timeout')), 30000);
            });

            const requestPromise = AuthService.supportRequest(`/tickets/${encodeURIComponent(normalizedTicketId)}/messages`, {
                method: 'POST',
                body: JSON.stringify({
                    message: messageData.message,
                    messageType: messageData.messageType || 'text',
                    attachments: messageData.attachments || []
                })
            });

            try {
                const response = await Promise.race([requestPromise, timeoutPromise]);

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
                    throw new Error(errorData.error || `Erro ${response.status}: ${response.statusText}`);
                }

                const result = await AuthService.handleApiResponse(response);
                Logger.log('✅ Mensagem adicionada ao ticket:', normalizedTicketId, 'ID:', result.message?.id);
                return result.message;

            } catch (fetchError) {
                if (fetchError.message && fetchError.message.includes('timeout')) {
                    Logger.error('❌ Timeout ao enviar mensagem (30s)');
                    throw new Error('Send message timeout');
                }
                
                throw fetchError;
            } finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            }

        } catch (error) {
            Logger.error('❌ Erro ao adicionar mensagem:', error);
            
            // ✅ Melhorar mensagem de erro
            if (error.message && error.message.includes('timeout')) {
                throw new Error('Send message timeout');
            }
            
            throw error;
        }
    }

    /**
     * Marcar mensagem como lida
     * @param {string} ticketId - ID do ticket
     * @param {string} messageId - ID da mensagem
     * @param {string} userId - ID do usuário
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async markMessageAsRead(ticketId, messageId, userId) {
        try {
            Logger.log('ℹ️ markMessageAsRead sem-op via API atual:', { ticketId, messageId, userId });
            return true;

        } catch (error) {
            Logger.error('❌ Erro ao marcar mensagem como lida:', error);
            return false;
        }
    }

    // ===== CONSULTAS E FILTROS =====

    /**
     * Buscar tickets do usuário
     * @param {Object} filters - Filtros opcionais
     * @returns {Promise<Array>} Lista de tickets
     */
    async getUserTickets(filters = {}) {
        try {
            const queryParams = new URLSearchParams();
            if (filters.status) queryParams.append('status', filters.status);
            if (filters.priority) queryParams.append('priority', filters.priority);
            if (filters.category) queryParams.append('category', filters.category);
            if (filters.limit) queryParams.append('limit', filters.limit);
            if (filters.offset) queryParams.append('offset', filters.offset);

            const response = await AuthService.supportRequest(`/tickets?${queryParams}`, {
                method: 'GET'
            });

            const result = await AuthService.handleApiResponse(response);
            return result.tickets || [];

        } catch (error) {
            Logger.error('❌ Erro ao buscar tickets do usuário:', error);
            throw error;
        }
    }

    /**
     * Buscar um ticket do usuário autenticado.
     * A API valida ownership; o cliente não acessa Firebase diretamente.
     * @param {string} ticketId - ID do ticket
     * @returns {Promise<Object>} Ticket atualizado
     */
    async getTicket(ticketId) {
        try {
            const normalizedTicketId = String(ticketId || '').trim();
            if (!normalizedTicketId) {
                throw new Error('Ticket inválido');
            }

            const response = await AuthService.supportRequest(`/tickets/${encodeURIComponent(normalizedTicketId)}`, {
                method: 'GET'
            });
            const result = await AuthService.handleApiResponse(response);
            return result.ticket || null;

        } catch (error) {
            Logger.error('❌ Erro ao buscar ticket:', error);
            throw error;
        }
    }

    /**
     * Buscar tickets para agentes
     * @param {Object} filters - Filtros
     * @returns {Promise<Array>} Lista de tickets
     */
    async getAgentTickets(filters = {}) {
        try {
            const queryParams = new URLSearchParams();
            if (filters.assignedAgent) queryParams.append('agent', filters.assignedAgent);
            if (filters.status) queryParams.append('status', filters.status);
            if (filters.priority) queryParams.append('priority', filters.priority);
            if (filters.limit) queryParams.append('limit', filters.limit);
            if (filters.offset) queryParams.append('offset', filters.offset);

            const response = await AuthService.supportRequest(`/admin/tickets?${queryParams}`, {
                method: 'GET'
            });
            const result = await AuthService.handleApiResponse(response);
            return result.tickets || [];

        } catch (error) {
            Logger.error('❌ Erro ao buscar tickets para agentes:', error);
            throw error;
        }
    }

    /**
     * Buscar mensagens do ticket
     * @param {string} ticketId - ID do ticket
     * @returns {Promise<Array>} Lista de mensagens
     */
    async getTicketMessages(ticketId) {
        try {
            const normalizedTicketId = String(ticketId || '').trim();
            if (!normalizedTicketId) {
                throw new Error('Ticket inválido');
            }

            const response = await AuthService.supportRequest(`/tickets/${encodeURIComponent(normalizedTicketId)}/messages`, {
                method: 'GET'
            });

            const result = await AuthService.handleApiResponse(response);
            return result.messages || [];

        } catch (error) {
            Logger.error('❌ Erro ao buscar mensagens do ticket:', error);
            throw error;
        }
    }

    // ===== NOTIFICAÇÕES =====

    /**
     * Notificar agentes disponíveis sobre novo ticket
     * @param {Object} ticket - Dados do ticket
     * @returns {Promise<void>}
     */
    async notifyAvailableAgents(ticket) {
        try {
            // Implementar notificação para agentes online
            Logger.log('🔔 Notificando agentes sobre novo ticket:', ticket.id);
            
            // Aqui você implementaria:
            // - Push notifications para agentes
            // - WebSocket para dashboard
            // - Email para supervisores se necessário
            
        } catch (error) {
            Logger.error('❌ Erro ao notificar agentes:', error);
        }
    }

    /**
     * Notificar usuário sobre atualização do ticket
     * @param {string} ticketId - ID do ticket
     * @param {string} message - Mensagem de notificação
     * @returns {Promise<void>}
     */
    async notifyUser(ticketId, message) {
        try {
            // Implementar notificação para o usuário
            Logger.log('🔔 Notificando usuário sobre ticket:', ticketId, message);
            
            // Aqui você implementaria:
            // - Push notification no app
            // - Email se necessário
            
        } catch (error) {
            Logger.error('❌ Erro ao notificar usuário:', error);
        }
    }

    /**
     * Notificar supervisores sobre escalação
     * @param {string} ticketId - ID do ticket
     * @param {number} level - Nível de escalação
     * @returns {Promise<void>}
     */
    async notifySupervisors(ticketId, level) {
        try {
            Logger.log('🔔 Notificando supervisores sobre escalação:', ticketId, 'nível:', level);
            
            // Implementar notificação para supervisores
            
        } catch (error) {
            Logger.error('❌ Erro ao notificar supervisores:', error);
        }
    }

    /**
     * Notificar participantes sobre nova mensagem
     * @param {string} ticketId - ID do ticket
     * @param {Object} message - Dados da mensagem
     * @returns {Promise<void>}
     */
    async notifyParticipants(ticketId, message) {
        try {
            Logger.log('🔔 Notificando participantes sobre nova mensagem:', ticketId);
            
            // Implementar notificação para participantes do ticket
            
        } catch (error) {
            Logger.error('❌ Erro ao notificar participantes:', error);
        }
    }

    // ===== ESTATÍSTICAS E RELATÓRIOS =====

    /**
     * Obter estatísticas de tickets
     * @param {Object} filters - Filtros de data
     * @returns {Promise<Object>} Estatísticas
     */
    async getTicketStats(filters = {}) {
        try {
            const queryParams = new URLSearchParams();
            if (filters.startDate) queryParams.append('startDate', filters.startDate);
            if (filters.endDate) queryParams.append('endDate', filters.endDate);

            const response = await AuthService.supportRequest(`/admin/stats?${queryParams}`, {
                method: 'GET'
            });
            const result = await AuthService.handleApiResponse(response);
            return result.stats || {};

        } catch (error) {
            Logger.error('❌ Erro ao obter estatísticas:', error);
            return {};
        }
    }

    /**
     * Calcular tempo médio de resolução
     * @param {Array} tickets - Lista de tickets
     * @returns {number} Tempo médio em horas
     */
    calculateAverageResolutionTime(tickets) {
        const resolvedTickets = tickets.filter(t => t.resolvedAt);
        
        if (resolvedTickets.length === 0) return 0;

        const totalTime = resolvedTickets.reduce((sum, ticket) => {
            const created = new Date(ticket.createdAt);
            const resolved = new Date(ticket.resolvedAt);
            return sum + (resolved - created);
        }, 0);

        return Math.round(totalTime / resolvedTickets.length / (1000 * 60 * 60)); // Converter para horas
    }
}

export default new SupportTicketService();
