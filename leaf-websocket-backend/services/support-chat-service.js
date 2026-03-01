/**
 * 💬 SERVIÇO DE CHAT DE SUPORTE
 * 
 * Arquitetura:
 * - Redis Pub/Sub: Tempo real (extremamente rápido)
 * - Firestore: Histórico (batches, mais barato que Realtime Database)
 * - WebSocket: Comunicação entre app e dashboard
 */

const redisPool = require('../utils/redis-pool');
const firebaseConfig = require('../firebase-config');
const admin = require('firebase-admin');
const { logger } = require('../utils/logger');

class SupportChatService {
    constructor() {
        this.redis = redisPool.getConnection();
        this.firestore = firebaseConfig.getFirestore();
        this.pubSubChannel = 'support:chat:messages';
        this.historyCollection = 'support_chat_history';
        this.chatStatusKey = 'support:chat:status'; // Hash para status dos chats
        
        // ✅ Mensagens ficam apenas no Redis durante conversa ativa
        // ✅ Salvar no Firestore apenas quando chat for encerrado
        
        this.setupRedisSubscriber();
        logger.info('💬 Support Chat Service inicializado (Redis Pub/Sub + Firestore ao encerrar)');
    }

    /**
     * Configurar subscriber Redis para receber mensagens em tempo real
     */
    setupRedisSubscriber() {
        try {
            // Criar subscriber separado para não bloquear operações principais
            const Redis = require('ioredis');
            const DockerDetector = require('../utils/docker-detector');
            
            // ✅ NOVO: Usar DockerDetector para obter configuração correta
            const redisConfig = DockerDetector.getRedisConfig();

            this.subscriber = new Redis(redisConfig);
            
            this.subscriber.on('message', (channel, message) => {
                if (channel === this.pubSubChannel) {
                    try {
                        const messageData = JSON.parse(message);
                        this.handleIncomingMessage(messageData);
                    } catch (error) {
                        logger.error('❌ Erro ao processar mensagem do Redis:', error);
                    }
                }
            });

            this.subscriber.on('error', (error) => {
                logger.error('❌ Erro no subscriber Redis:', error);
            });

            this.subscriber.on('ready', () => {
                // Subscrever ao canal quando estiver pronto
                this.subscriber.subscribe(this.pubSubChannel, (err) => {
                    if (err) {
                        logger.error('❌ Erro ao subscrever canal Redis:', err);
                    } else {
                        logger.info(`✅ Subscrito ao canal Redis: ${this.pubSubChannel}`);
                    }
                });
            });

        } catch (error) {
            logger.error('❌ Erro ao configurar subscriber Redis:', error);
        }
    }

    /**
     * Processar mensagem recebida via Redis Pub/Sub
     */
    async handleIncomingMessage(messageData) {
        try {
            const { userId } = messageData;
            
            // ✅ Armazenar mensagem no Redis (sorted set por timestamp)
            const messagesKey = `support:chat:messages:${userId}`;
            const score = new Date(messageData.timestamp).getTime();
            
            await this.redis.zadd(messagesKey, score, JSON.stringify(messageData));
            
            // ✅ Definir TTL de 30 dias para mensagens no Redis (backup caso não seja encerrado)
            await this.redis.expire(messagesKey, 30 * 24 * 60 * 60); // 30 dias
            
            // ✅ Garantir que o chat está marcado como "ativo" se ainda não existe
            const chatStatus = await this.redis.hget(this.chatStatusKey, userId);
            if (!chatStatus) {
                await this.redis.hset(this.chatStatusKey, userId, JSON.stringify({
                    userId,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }));
            } else {
                // Atualizar updatedAt
                const status = JSON.parse(chatStatus);
                status.updatedAt = new Date().toISOString();
                await this.redis.hset(this.chatStatusKey, userId, JSON.stringify(status));
            }

            // Notificar via WebSocket (se io estiver disponível)
            if (this.io) {
                // Notificar usuário específico
                this.io.to(`user:${userId}`).emit('support:chat:message', messageData);
                
                // Notificar agentes de suporte
                this.io.emit('support:chat:new', messageData);
            }

            logger.info(`💬 Mensagem armazenada no Redis para chat ${userId}`);

        } catch (error) {
            logger.error('❌ Erro ao processar mensagem:', error);
        }
    }

    /**
     * ✅ NOVO: Encerrar chat e salvar todas as mensagens no Firestore
     * @param {string} userId - ID do usuário
     * @param {string} closedBy - Quem encerrou ('user' ou 'agent')
     * @returns {Promise<Object>} Resultado do encerramento
     */
    async closeChat(userId, closedBy = 'agent') {
        try {
            const messagesKey = `support:chat:messages:${userId}`;
            
            // ✅ Buscar todas as mensagens do Redis
            const messages = await this.redis.zrange(messagesKey, 0, -1);
            
            if (messages.length === 0) {
                logger.warn(`⚠️ Nenhuma mensagem encontrada para chat ${userId}`);
                return {
                    success: true,
                    message: 'Chat encerrado (sem mensagens)',
                    messageCount: 0
                };
            }

            // ✅ Salvar todas as mensagens no Firestore de uma vez
            const batch = this.firestore.batch();
            const now = new Date().toISOString();
            
            messages.forEach((messageJson) => {
                const messageData = JSON.parse(messageJson);
                const messageRef = this.firestore
                    .collection(this.historyCollection)
                    .doc(messageData.id);
                
                batch.set(messageRef, {
                    ...messageData,
                    savedAt: admin.firestore.FieldValue.serverTimestamp(),
                    chatClosedAt: now,
                    closedBy
                }, { merge: true });
            });

            // Commit batch
            await batch.commit();
            
            // ✅ Atualizar status do chat para "encerrado"
            await this.redis.hset(this.chatStatusKey, userId, JSON.stringify({
                userId,
                status: 'closed',
                closedAt: now,
                closedBy,
                createdAt: (await this.redis.hget(this.chatStatusKey, userId)) 
                    ? JSON.parse(await this.redis.hget(this.chatStatusKey, userId)).createdAt 
                    : now,
                updatedAt: now,
                messageCount: messages.length
            }));

            // ✅ Opcional: Limpar mensagens do Redis após salvar (ou manter por 30 dias como backup)
            // await this.redis.del(messagesKey); // Descomentar se quiser limpar imediatamente

            logger.info(`✅ Chat ${userId} encerrado e ${messages.length} mensagens salvas no Firestore`);

            // ✅ Notificar via WebSocket
            if (this.io) {
                this.io.to(`user:${userId}`).emit('support:chat:closed', {
                    userId,
                    closedAt: now,
                    closedBy,
                    messageCount: messages.length
                });
                this.io.emit('support:chat:closed', {
                    userId,
                    closedAt: now,
                    closedBy,
                    messageCount: messages.length
                });
            }

            return {
                success: true,
                message: 'Chat encerrado com sucesso',
                messageCount: messages.length,
                closedAt: now
            };

        } catch (error) {
            logger.error('❌ Erro ao encerrar chat:', error);
            throw error;
        }
    }

    /**
     * ✅ Obter status do chat
     * @param {string} userId - ID do usuário
     * @returns {Promise<Object>} Status do chat
     */
    async getChatStatus(userId) {
        try {
            const statusJson = await this.redis.hget(this.chatStatusKey, userId);
            if (!statusJson) {
                return {
                    status: 'active',
                    createdAt: new Date().toISOString()
                };
            }
            return JSON.parse(statusJson);
        } catch (error) {
            logger.error('❌ Erro ao obter status do chat:', error);
            return { status: 'active' };
        }
    }

    /**
     * ✅ Obter mensagens ativas do Redis (antes de encerrar)
     * @param {string} userId - ID do usuário
     * @returns {Promise<Array>} Lista de mensagens
     */
    async getActiveMessages(userId) {
        try {
            const messagesKey = `support:chat:messages:${userId}`;
            const messages = await this.redis.zrange(messagesKey, 0, -1);
            
            return messages.map(msg => JSON.parse(msg)).sort((a, b) => 
                new Date(a.timestamp) - new Date(b.timestamp)
            );
        } catch (error) {
            logger.error('❌ Erro ao obter mensagens ativas:', error);
            return [];
        }
    }

    /**
     * Enviar mensagem de suporte
     * @param {string} userId - ID do usuário
     * @param {string} message - Texto da mensagem
     * @param {string} senderType - 'user' ou 'agent'
     * @returns {Promise<Object>} Mensagem criada
     */
    async sendMessage(userId, message, senderType = 'user') {
        try {
            const messageId = `MSG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const now = new Date().toISOString();

            const messageData = {
                id: messageId,
                userId,
                message: message.trim(),
                senderType,
                timestamp: now,
                createdAt: now,
                read: false,
                readAt: null
            };

            // ✅ Publicar no Redis Pub/Sub (tempo real)
            await this.redis.publish(
                this.pubSubChannel,
                JSON.stringify(messageData)
            );

            logger.info(`💬 Mensagem publicada no Redis: ${messageId} (user: ${userId})`);

            return {
                success: true,
                message: messageData
            };

        } catch (error) {
            logger.error('❌ Erro ao enviar mensagem:', error);
            throw error;
        }
    }

    /**
     * Buscar histórico de mensagens (Firestore + Redis ativo)
     * @param {string} userId - ID do usuário
     * @param {number} limit - Limite de mensagens
     * @returns {Promise<Array>} Lista de mensagens
     */
    async getMessageHistory(userId, limit = 50) {
        try {
            // ✅ Primeiro, buscar mensagens ativas do Redis
            const activeMessages = await this.getActiveMessages(userId);
            
            // ✅ Depois, buscar mensagens encerradas do Firestore
            let firestoreMessages = [];
            if (this.firestore) {
                const snapshot = await this.firestore
                    .collection(this.historyCollection)
                    .where('userId', '==', userId)
                    .limit(limit * 2)
                    .get();

                snapshot.forEach((doc) => {
                    firestoreMessages.push(doc.data());
                });

                firestoreMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                firestoreMessages = firestoreMessages.slice(0, limit).reverse();
            }

            // ✅ Combinar mensagens ativas (Redis) + encerradas (Firestore)
            const allMessages = [...activeMessages, ...firestoreMessages];
            
            // Remover duplicatas (por ID) e ordenar
            const uniqueMessages = Array.from(
                new Map(allMessages.map(msg => [msg.id, msg])).values()
            ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            return uniqueMessages.slice(-limit); // Últimas N mensagens

        } catch (error) {
            logger.error('❌ Erro ao buscar histórico:', error);
            return [];
        }
    }

    /**
     * Marcar mensagens como lidas
     * @param {string} userId - ID do usuário
     * @param {Array<string>} messageIds - IDs das mensagens
     */
    async markAsRead(userId, messageIds = []) {
        try {
            const now = new Date().toISOString();
            const batch = this.firestore.batch();

            if (messageIds.length === 0) {
                // Marcar todas as mensagens não lidas do usuário
                const snapshot = await this.firestore
                    .collection(this.historyCollection)
                    .where('userId', '==', userId)
                    .where('read', '==', false)
                    .get();

                snapshot.forEach((doc) => {
                    const messageRef = this.firestore
                        .collection(this.historyCollection)
                        .doc(doc.id);
                    batch.update(messageRef, {
                        read: true,
                        readAt: now
                    });
                });
            } else {
                // Marcar mensagens específicas
                messageIds.forEach((messageId) => {
                    const messageRef = this.firestore
                        .collection(this.historyCollection)
                        .doc(messageId);
                    batch.update(messageRef, {
                        read: true,
                        readAt: now
                    });
                });
            }

            await batch.commit();
            logger.info(`✅ Mensagens marcadas como lidas para usuário: ${userId}`);

        } catch (error) {
            logger.error('❌ Erro ao marcar como lida:', error);
        }
    }

    /**
     * Injetar instância do Socket.IO (para notificações WebSocket)
     */
    setIOInstance(io) {
        this.io = io;
    }

    /**
     * Limpar recursos
     */
    async cleanup() {
        try {
            if (this.subscriber) {
                await this.subscriber.unsubscribe(this.pubSubChannel);
                await this.subscriber.quit();
            }

            logger.info('✅ Support Chat Service limpo');
        } catch (error) {
            logger.error('❌ Erro ao limpar recursos:', error);
        }
    }
}

// Singleton
const supportChatService = new SupportChatService();

module.exports = supportChatService;

