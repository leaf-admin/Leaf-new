import Logger from '../utils/Logger';
/**
 * 💬 SERVIÇO DE CHAT DE SUPORTE EM TEMPO REAL
 * 
 * Arquitetura:
 * - Redis Pub/Sub: Tempo real (extremamente rápido)
 * - Firestore: Histórico (batches, mais barato que Realtime Database)
 * - WebSocket: Comunicação em tempo real
 * 
 * Chat em tempo real separado de tickets
 * Funciona como WhatsApp - conversa direta entre suporte e usuário
 */

import auth from '@react-native-firebase/auth';
import WebSocketManager from './WebSocketManager';
import AuthService from './AuthService';


class SupportChatService {
    constructor() {
        this.wsManager = WebSocketManager.getInstance();
        this.userId = null;
        this.messageListeners = [];
        this.isConnected = false;
        this.messageHistory = [];
    }

    /**
     * Inicializar chat de suporte para o usuário
     * @param {string} userId - ID do usuário
     * @returns {Promise<boolean>} Sucesso da inicialização
     */
    async initialize(userId) {
        try {
            if (!userId) {
                const user = auth().currentUser;
                if (!user) {
                    throw new Error('Usuário não autenticado');
                }
                userId = user.uid;
            }

            this.userId = userId;
            Logger.log('💬 Inicializando chat de suporte para:', userId);

            // ✅ Conectar WebSocket se não estiver conectado
            if (!this.wsManager.isConnected()) {
                await this.wsManager.connect();
            }

            // ✅ Carregar histórico do Firestore via API
            await this.loadMessageHistory();

            // ✅ Escutar mensagens em tempo real via WebSocket
            this.setupWebSocketListeners();

            this.isConnected = true;
            Logger.log('✅ Chat de suporte inicializado (Redis Pub/Sub + Firestore)');
            return true;

        } catch (error) {
            Logger.error('❌ Erro ao inicializar chat:', error);
            this.isConnected = false;
            return false;
        }
    }

    /**
     * Configurar listeners WebSocket para mensagens em tempo real
     */
    setupWebSocketListeners() {
        // Remover listeners antigos
        this.messageListeners.forEach(listener => {
            this.wsManager.socket?.off('support:chat:message', listener);
        });
        this.messageListeners = [];

        // Listener para novas mensagens
        const messageListener = (messageData) => {
            Logger.log('💬 Nova mensagem recebida via WebSocket:', messageData);
            
            // Adicionar ao histórico local
            if (messageData.userId === this.userId) {
                this.messageHistory.push(messageData);
                // Notificar listeners
                this.notifyMessageListeners(messageData);
            }
        };

        this.wsManager.socket?.on('support:chat:message', messageListener);
        this.messageListeners.push(messageListener);
    }

    /**
     * Notificar listeners sobre nova mensagem
     */
    notifyMessageListeners(messageData) {
        // Será usado por componentes que escutam mensagens
        if (this.onMessageCallback) {
            this.onMessageCallback(messageData);
        }
    }

    /**
     * Carregar histórico de mensagens do Firestore via API
     */
    async loadMessageHistory() {
        try {
            const response = await AuthService.authenticatedRequest(
                `/support/chat/${this.userId}/history?limit=50`
            );

            if (response.ok) {
                const data = await response.json();
                this.messageHistory = data.messages || [];
                Logger.log(`✅ Histórico carregado: ${this.messageHistory.length} mensagens`);
            } else {
                Logger.warn('⚠️ Erro ao carregar histórico:', response.status);
                this.messageHistory = [];
            }
        } catch (error) {
            Logger.error('❌ Erro ao carregar histórico:', error);
            this.messageHistory = [];
        }
    }

    /**
     * Enviar mensagem no chat de suporte
     * @param {string} message - Texto da mensagem
     * @param {string} userId - ID do usuário (opcional)
     * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
     */
    async sendMessage(message, userId = null) {
        try {
            if (!userId) {
                if (!this.userId) {
                    const user = auth().currentUser;
                    if (!user) {
                        throw new Error('Usuário não autenticado');
                    }
                    userId = user.uid;
                } else {
                    userId = this.userId;
                }
            }

            if (!this.isConnected) {
                await this.initialize(userId);
            }

            // ✅ Enviar via WebSocket (Redis Pub/Sub no backend)
            if (this.wsManager.isConnected()) {
                return new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Timeout ao enviar mensagem'));
                    }, 10000); // 10 segundos

                    // Enviar mensagem via WebSocket
                    this.wsManager.socket.emit('support:chat:message', {
                        userId,
                        message: message.trim(),
                        senderType: 'user'
                    });

                    // Escutar confirmação
                    const confirmListener = (data) => {
                        clearTimeout(timeout);
                        this.wsManager.socket.off('support:chat:sent', confirmListener);
                        this.wsManager.socket.off('support:chat:error', errorListener);
                        
                        if (data.success) {
                            // Adicionar mensagem ao histórico local
                            const messageData = {
                                id: data.messageId,
                                userId,
                                message: message.trim(),
                                senderType: 'user',
                                timestamp: new Date().toISOString()
                            };
                            this.messageHistory.push(messageData);
                            
                            resolve({
                                success: true,
                                messageId: data.messageId,
                                message: messageData
                            });
                        } else {
                            reject(new Error(data.error || 'Erro ao enviar mensagem'));
                        }
                    };

                    const errorListener = (error) => {
                        clearTimeout(timeout);
                        this.wsManager.socket.off('support:chat:sent', confirmListener);
                        this.wsManager.socket.off('support:chat:error', errorListener);
                        reject(new Error(error.error || 'Erro ao enviar mensagem'));
                    };

                    this.wsManager.socket.once('support:chat:sent', confirmListener);
                    this.wsManager.socket.once('support:chat:error', errorListener);
                });
            } else {
                // ✅ Fallback: Enviar via API REST
                const response = await AuthService.authenticatedRequest(
                    `/support/chat/${userId}/message`,
                    {
                        method: 'POST',
                        body: JSON.stringify({
                            message: message.trim(),
                            senderType: 'user'
                        })
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    const messageData = {
                        id: data.message.id,
                        userId,
                        message: message.trim(),
                        senderType: 'user',
                        timestamp: data.message.timestamp
                    };
                    this.messageHistory.push(messageData);
                    
                    return {
                        success: true,
                        messageId: data.message.id,
                        message: messageData
                    };
                } else {
                    throw new Error('Erro ao enviar mensagem via API');
                }
            }

        } catch (error) {
            Logger.error('❌ Erro ao enviar mensagem:', error);
            return {
                success: false,
                error: error.message || 'Erro ao enviar mensagem'
            };
        }
    }

    /**
     * Buscar mensagens do chat (do histórico local ou Firestore)
     * @param {string} userId - ID do usuário (opcional)
     * @param {number} limit - Limite de mensagens
     * @returns {Promise<Array>} Lista de mensagens
     */
    async getMessages(userId = null, limit = 50) {
        try {
            if (!userId) {
                userId = this.userId || auth().currentUser?.uid;
                if (!userId) {
                    throw new Error('Usuário não autenticado');
                }
            }

            if (!this.isConnected) {
                await this.initialize(userId);
            }

            // ✅ Retornar histórico local (já carregado do Firestore)
            return this.messageHistory.slice(-limit);

        } catch (error) {
            Logger.error('❌ Erro ao buscar mensagens:', error);
            return [];
        }
    }

    /**
     * Escutar novas mensagens em tempo real (via WebSocket)
     * @param {Function} callback - Callback para novas mensagens
     * @param {string} userId - ID do usuário (opcional)
     * @returns {Function} Função para remover listener
     */
    onNewMessage(callback, userId = null) {
        try {
            if (!userId) {
                userId = this.userId || auth().currentUser?.uid;
                if (!userId) {
                    throw new Error('Usuário não autenticado');
                }
            }

            if (!this.isConnected) {
                this.initialize(userId);
            }

            // ✅ Armazenar callback para notificar quando mensagem chegar
            this.onMessageCallback = callback;

            // Retornar função para remover listener
            return () => {
                this.onMessageCallback = null;
            };

        } catch (error) {
            Logger.error('❌ Erro ao configurar listener:', error);
            return () => {}; // Retornar função vazia se der erro
        }
    }

    /**
     * Marcar mensagens como lidas (via API REST)
     * @param {string} userId - ID do usuário (opcional)
     * @param {Array<string>} messageIds - IDs das mensagens (opcional, marca todas se não fornecido)
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async markAsRead(userId = null, messageIds = []) {
        try {
            if (!userId) {
                userId = this.userId || auth().currentUser?.uid;
                if (!userId) {
                    throw new Error('Usuário não autenticado');
                }
            }

            // ✅ Marcar via API REST
            const response = await AuthService.authenticatedRequest(
                `/support/chat/${userId}/mark-read`,
                {
                    method: 'POST',
                    body: JSON.stringify({ messageIds })
                }
            );

            if (response.ok) {
                // Atualizar histórico local
                this.messageHistory.forEach(msg => {
                    if (!messageIds.length || messageIds.includes(msg.id)) {
                        msg.read = true;
                        msg.readAt = new Date().toISOString();
                    }
                });

                return true;
            }

            return false;

        } catch (error) {
            Logger.error('❌ Erro ao marcar como lida:', error);
            return false;
        }
    }

    /**
     * Desconectar do chat
     */
    disconnect() {
        // Remover todos os listeners WebSocket
        this.messageListeners.forEach(listener => {
            try {
                this.wsManager.socket?.off('support:chat:message', listener);
            } catch (error) {
                Logger.warn('⚠️ Erro ao remover listener:', error);
            }
        });

        this.messageListeners = [];
        this.onMessageCallback = null;
        this.isConnected = false;
        this.userId = null;
        this.messageHistory = [];
    }
}

export default new SupportChatService();

