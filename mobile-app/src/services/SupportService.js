import Logger from '../utils/Logger';
import AuthService from './AuthService';
import SupportTicketService from './SupportTicketService';
import WebSocketManager from './WebSocketManager';


class SupportService {
    constructor() {
        this.wsManager = WebSocketManager.getInstance();
    }

    /**
     * Buscar mensagens do chat de suporte (via ticket)
     * @param {string} ticketId - ID do ticket
     * @returns {Promise<{success: boolean, messages?: Array, error?: string}>}
     */
    async getChatMessages(ticketId) {
        try {
            // Usar SupportTicketService que já está correto
            const messages = await SupportTicketService.getTicketMessages(ticketId);
            return {
                success: true,
                messages: messages || []
            };
        } catch (error) {
            Logger.error('❌ Erro ao buscar mensagens:', error);
            return { success: true, messages: [] };
        }
    }

    /**
     * Enviar mensagem no chat de suporte (via ticket)
     * @param {string} ticketId - ID do ticket
     * @param {string} message - Texto da mensagem
     * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
     */
    async sendChatMessage(ticketId, message) {
        try {
            Logger.log('📤 SupportService - Enviando mensagem para ticket:', ticketId);
            
            // ✅ Usar SupportTicketService que já tem timeout e tratamento correto
            const result = await SupportTicketService.addMessage(ticketId, {
                message: message,
                messageType: 'text',
                attachments: []
            });

            if (result && result.id) {
                Logger.log('✅ SupportService - Mensagem enviada:', result.id);
                return { 
                    success: true, 
                    messageId: result.id,
                    message: result
                };
            }

            throw new Error('Resposta inválida do servidor');
        } catch (error) {
            Logger.error('❌ Erro ao enviar mensagem:', error);
            
            // ✅ Melhorar mensagem de erro
            if (error.message && error.message.includes('timeout')) {
                return { success: false, error: 'Send message timeout' };
            }
            
            return { success: false, error: error.message || 'Erro ao enviar mensagem' };
        }
    }

    /**
     * Buscar tickets de suporte do usuário
     * @param {string} userId - ID do usuário (opcional, usa usuário autenticado)
     * @returns {Promise<{success: boolean, tickets?: Array, error?: string}>}
     */
    async getTickets(userId = null) {
        try {
            // ✅ Usar SupportTicketService que já está correto
            const tickets = await SupportTicketService.getUserTickets();
            return {
                success: true,
                tickets: tickets || []
            };
        } catch (error) {
            Logger.error('❌ Erro ao buscar tickets:', error);
            return { success: true, tickets: [] };
        }
    }

    /**
     * Criar novo ticket de suporte
     * @param {object} ticketData - Dados do ticket
     * @returns {Promise<{success: boolean, ticketId?: string, error?: string}>}
     */
    async createTicket(ticketData) {
        try {
            // ✅ Usar SupportTicketService que já está correto
            const ticket = await SupportTicketService.createTicket(ticketData);
            return {
                success: true,
                ticketId: ticket.id,
                ticket: ticket
            };
        } catch (error) {
            Logger.error('❌ Erro ao criar ticket:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Buscar FAQ de suporte
     * @returns {Promise<{success: boolean, faqs?: Array, error?: string}>}
     */
    async getFAQ() {
        try {
            // ✅ Retornar FAQ estático por enquanto (backend não tem endpoint)
            return {
                success: true,
                faqs: [
                    { 
                        id: '1',
                        question: 'Como entrar em contato com o suporte?', 
                        answer: 'Você pode entrar em contato através do chat em tempo real, criando um ticket ou enviando um e-mail para suporte@leaf.com.br',
                        category: 'getting-started'
                    },
                    { 
                        id: '2',
                        question: 'Qual o horário de atendimento?', 
                        answer: 'Nosso suporte está disponível 24 horas por dia, 7 dias por semana.',
                        category: 'getting-started'
                    },
                    { 
                        id: '3',
                        question: 'Como criar um ticket?', 
                        answer: 'Na aba "Tickets", toque em "Novo Ticket" e preencha as informações solicitadas.',
                        category: 'getting-started'
                    },
                    { 
                        id: '4',
                        question: 'Como funciona o chat em tempo real?', 
                        answer: 'O chat permite comunicação instantânea com nossa equipe de suporte. Suas mensagens são respondidas em tempo real.',
                        category: 'getting-started'
                    },
                ]
            };
        } catch (error) {
            Logger.error('❌ Erro ao buscar FAQ:', error);
            return {
                success: true,
                faqs: []
            };
        }
    }
}

export default new SupportService();

