/**
 * CHAT SERVICE
 * 
 * Serviço para gerenciar funcionalidades de chat em tempo real:
 * - Criação de chats
 * - Envio de mensagens
 * - Notificações em tempo real
 * - Integração com persistência
 * 
 * Este serviço centraliza toda a lógica de chat, facilitando
 * manutenção e escalabilidade futura.
 */

const chatPersistenceService = require('./chat-persistence-service');
const { logStructured, logError } = require('../utils/logger');

class ChatService {
    constructor(io, rateLimiterService) {
        this.io = io;
        this.rateLimiterService = rateLimiterService;
        this.chatPersistence = chatPersistenceService;
    }

    /**
     * Criar chat
     * @param {Socket} socket - Socket do cliente
     * @param {Object} data - Dados do chat
     */
    async createChat(socket, data) {
        try {
            logStructured('info', 'Chat criado', { service: 'chat-service', ...data });
            
            const chatId = `chat_${Date.now()}`;
            
            socket.emit('chatCreated', {
                success: true,
                chatId,
                message: 'Chat criado com sucesso'
            });

        } catch (error) {
            logError(error, 'Erro ao criar chat', { service: 'chat-service' });
            socket.emit('chatError', { error: 'Erro interno do servidor' });
        }
    }

    /**
     * Enviar mensagem
     * @param {Socket} socket - Socket do cliente
     * @param {Object} data - Dados da mensagem
     */
    async sendMessage(socket, data) {
        try {
            // Rate Limiting
            const senderId = data.senderId || socket.userId || socket.id;
            const rateLimitCheck = await this.rateLimiterService.checkRateLimit(senderId, 'sendMessage');
            
            if (!rateLimitCheck.allowed) {
                socket.emit('messageError', {
                    error: 'Muitas requisições',
                    message: `Você excedeu o limite de ${rateLimitCheck.limit} mensagens por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                    code: 'RATE_LIMIT_EXCEEDED',
                    limit: rateLimitCheck.limit,
                    remaining: rateLimitCheck.remaining,
                    resetAt: rateLimitCheck.resetAt
                });
                logStructured('warn', 'sendMessage bloqueado [AUDITORIA]', { service: 'chat-service', senderId, limit: rateLimitCheck.limit });
                return;
            }
            
            logStructured('info', 'Mensagem enviada', { service: 'chat-service', chatId: data.chatId, senderId: data.senderId });
            
            const { bookingId, rideId, message, receiverId, senderType } = data;
            
            if (!message || !senderId) {
                socket.emit('messageError', { error: 'Mensagem e senderId são obrigatórios' });
                return;
            }

            const conversationId = bookingId || rideId;
            
            if (!conversationId) {
                socket.emit('messageError', { error: 'bookingId ou rideId é obrigatório' });
                return;
            }

            // Salvar mensagem no Firestore com TTL de 30 dias
            try {
                const saveResult = await this.chatPersistence.saveMessage({
                    bookingId: bookingId || conversationId,
                    rideId: rideId || conversationId,
                    senderId: senderId,
                    receiverId: receiverId || null,
                    message: message,
                    senderType: senderType || (socket.userType === 'driver' ? 'driver' : 'passenger'),
                    timestamp: new Date().toISOString()
                });

                if (!saveResult.success) {
                    logError(new Error(saveResult.error), 'Erro ao salvar mensagem no Firestore', { service: 'chat-service', chatId: data.chatId });
                    // Não bloquear envio se persistência falhar, mas logar erro
                }
            } catch (persistError) {
                logError(persistError, 'Erro ao persistir mensagem', { service: 'chat-service', chatId: data.chatId });
                // Não bloquear envio se persistência falhar
            }

            // Gerar ID da mensagem
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Buscar dados do booking para notificar o outro participante
            const bookingData = this.io.activeBookings?.get(conversationId);
            const customerId = bookingData?.customerId;
            const driverId = bookingData?.driverId;
            
            // Determinar receiverId se não fornecido
            let finalReceiverId = receiverId;
            if (!finalReceiverId) {
                if (senderId === customerId) {
                    finalReceiverId = driverId;
                } else if (senderId === driverId) {
                    finalReceiverId = customerId;
                }
            }

            // Notificar o remetente
            socket.emit('messageSent', {
                success: true,
                messageId: messageId,
                message: 'Mensagem enviada com sucesso',
                timestamp: new Date().toISOString()
            });

            // Notificar o receptor se estiver conectado
            if (finalReceiverId && this.io.connectedUsers) {
                const receiverSocket = this.io.connectedUsers.get(finalReceiverId);
                if (receiverSocket) {
                    receiverSocket.emit('newMessage', {
                        success: true,
                        messageId: messageId,
                        bookingId: conversationId,
                        senderId: senderId,
                        message: message,
                        senderType: senderType || (socket.userType === 'driver' ? 'driver' : 'passenger'),
                        timestamp: new Date().toISOString()
                    });
                    logStructured('info', 'Mensagem enviada para receptor', { service: 'chat-service', receiverId: finalReceiverId, chatId: data.chatId });
                }
            }
            
        } catch (error) {
            logError(error, 'Erro ao enviar mensagem', { service: 'chat-service' });
            socket.emit('messageError', { error: 'Erro interno do servidor' });
        }
    }

    /**
     * Buscar histórico de mensagens (para uso em rotas HTTP)
     * @param {string} conversationId - ID da conversa
     * @param {number} limit - Limite de mensagens
     * @returns {Promise<Object>} Histórico de mensagens
     */
    async getMessageHistory(conversationId, limit = 50) {
        try {
            return await this.chatPersistence.getMessages(conversationId, limit);
        } catch (error) {
            logError(error, 'Erro ao buscar histórico de mensagens', { service: 'chat-service', chatId });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Marcar mensagem como lida
     * @param {string} messageId - ID da mensagem
     * @param {string} userId - ID do usuário que leu
     * @returns {Promise<Object>} Resultado da operação
     */
    async markAsRead(messageId, userId) {
        try {
            return await this.chatPersistence.markMessageAsRead(messageId, userId);
        } catch (error) {
            logError(error, 'Erro ao marcar mensagem como lida', { service: 'chat-service', chatId, messageId });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Configurar handlers WebSocket para um socket
     * @param {Socket} socket - Socket do cliente
     */
    setupHandlers(socket) {
        // Criar chat
        socket.on('createChat', async (data) => {
            await this.createChat(socket, data);
        });

        // Enviar mensagem
        socket.on('sendMessage', async (data) => {
            await this.sendMessage(socket, data);
        });
    }
}

module.exports = ChatService;

