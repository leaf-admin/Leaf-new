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
const supportTicketService = require('./support-ticket-service');

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

    getMessagesKey(userId) {
        return `support:chat:messages:${userId}`;
    }

    parseJson(value, fallback = null) {
        if (!value) return fallback;
        try {
            return typeof value === 'string' ? JSON.parse(value) : value;
        } catch {
            return fallback;
        }
    }

    getMessageScore(message) {
        const timestamp = message?.timestamp || message?.createdAt || new Date().toISOString();
        const score = new Date(timestamp).getTime();
        return Number.isFinite(score) ? score : Date.now();
    }

    summarizeMessage(message) {
        if (!message) return null;
        return {
            id: message.id || null,
            message: String(message.message || '').slice(0, 180),
            senderType: message.senderType || 'user',
            createdAt: message.createdAt || message.timestamp || null,
            timestamp: message.timestamp || message.createdAt || null,
            read: message.read === true
        };
    }

    /**
     * Processar mensagem recebida via Redis Pub/Sub
     */
    async handleIncomingMessage(messageData) {
        try {
            const { userId } = messageData;
            
            // ✅ Armazenar mensagem no Redis (sorted set por timestamp)
            const messagesKey = this.getMessagesKey(userId);
            const score = new Date(messageData.timestamp).getTime();
            
            await this.redis.zadd(messagesKey, score, JSON.stringify(messageData));
            
            // ✅ Definir TTL de 30 dias para mensagens no Redis (backup caso não seja encerrado)
            await this.redis.expire(messagesKey, 30 * 24 * 60 * 60); // 30 dias
            
            // ✅ Garantir que o chat está marcado como "ativo" se ainda não existe
            const chatStatus = await this.redis.hget(this.chatStatusKey, userId);
            const isUnreadUserMessage = messageData.senderType === 'user' && messageData.read !== true;
            if (!chatStatus) {
                await this.redis.hset(this.chatStatusKey, userId, JSON.stringify({
                    userId,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    lastMessageAt: messageData.timestamp || messageData.createdAt || new Date().toISOString(),
                    lastSenderType: messageData.senderType || 'user',
                    lastMessagePreview: String(messageData.message || '').slice(0, 180),
                    unreadFromUser: isUnreadUserMessage ? 1 : 0,
                    messageCount: 1
                }));
            } else {
                // Atualizar updatedAt
                const status = this.parseJson(chatStatus, {});
                status.updatedAt = new Date().toISOString();
                status.lastMessageAt = messageData.timestamp || messageData.createdAt || status.updatedAt;
                status.lastSenderType = messageData.senderType || 'user';
                status.lastMessagePreview = String(messageData.message || '').slice(0, 180);
                status.messageCount = Number(status.messageCount || 0) + 1;
                status.unreadFromUser = Number(status.unreadFromUser || 0) + (isUnreadUserMessage ? 1 : 0);
                if (status.status === 'closed') {
                    status.status = 'active';
                    status.reopenedAt = status.updatedAt;
                    status.reopenReason = 'new_message';
                }
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
            const messagesKey = this.getMessagesKey(userId);
            
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
                createdAt: this.parseJson(await this.redis.hget(this.chatStatusKey, userId), {})?.createdAt || now,
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
     * Reabrir chat de suporte para um usuário.
     * @param {string} userId
     * @param {string} reason
     * @param {object} metadata
     * @returns {Promise<object>}
     */
    async reopenChat(userId, reason = 'manual_reopen', metadata = {}) {
        try {
            const now = new Date().toISOString();
            const currentStatusJson = await this.redis.hget(this.chatStatusKey, userId);
            const currentStatus = currentStatusJson ? JSON.parse(currentStatusJson) : {};

            const nextStatus = {
                userId,
                status: 'active',
                createdAt: currentStatus.createdAt || now,
                updatedAt: now,
                reopenedAt: now,
                reopenReason: reason,
                ...metadata
            };

            await this.redis.hset(this.chatStatusKey, userId, JSON.stringify(nextStatus));

            logger.info(`✅ Chat reaberto para usuário ${userId} (${reason})`);
            return {
                success: true,
                reopened: true,
                status: nextStatus
            };
        } catch (error) {
            logger.error('❌ Erro ao reabrir chat:', error);
            return {
                success: false,
                reopened: false,
                error: error.message
            };
        }
    }

    /**
     * Reabre chat automaticamente se o usuário possuir ticket aberto.
     * @param {string} userId
     * @param {string} reason
     * @returns {Promise<object>}
     */
    async reopenChatForOpenTicket(userId, reason = 'incoming_message') {
        try {
            const openTicket = await supportTicketService.findLatestOpenTicketForUser(String(userId));
            if (!openTicket) {
                return {
                    reopened: false,
                    reason: 'no_open_ticket'
                };
            }

            const reopenResult = await this.reopenChat(userId, reason, {
                ticketId: openTicket.id || null,
                ticketStatus: openTicket.status || 'open'
            });

            return {
                ...reopenResult,
                reopened: Boolean(reopenResult.reopened)
            };
        } catch (error) {
            logger.error('❌ Erro ao reabrir chat por ticket aberto:', error);
            return {
                reopened: false,
                reason: 'exception',
                error: error.message
            };
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
            return this.parseJson(statusJson, { status: 'active' });
        } catch (error) {
            logger.error('❌ Erro ao obter status do chat:', error);
            return { status: 'active' };
        }
    }

    /**
     * Listar chats N0 ativos para a central de suporte.
     * O índice vem do Redis para evitar varreduras caras em Firestore.
     */
    async listActiveChats({ limit = 50, includeClosed = false } = {}) {
        try {
            const statusMap = await this.redis.hgetall(this.chatStatusKey);
            const entries = Object.entries(statusMap || {})
                .map(([userId, statusJson]) => ({
                    userId,
                    status: this.parseJson(statusJson, { userId, status: 'active' })
                }))
                .filter((entry) => includeClosed || entry.status?.status !== 'closed');

            if (entries.length === 0) {
                return [];
            }

            const pipeline = this.redis.pipeline();
            entries.forEach(({ userId }) => {
                const key = this.getMessagesKey(userId);
                pipeline.zrange(key, -1, -1);
            });
            const replies = await pipeline.exec();

            const chats = entries.map((entry, index) => {
                const latestReply = replies[index] || [];
                const latestRaw = latestReply[1]?.[0] || null;
                const latestMessage = this.parseJson(latestRaw) || null;
                const unreadFromUser = Number(entry.status?.unreadFromUser || 0);
                const lastMessageAt = latestMessage?.timestamp
                    || latestMessage?.createdAt
                    || entry.status?.lastMessageAt
                    || entry.status?.updatedAt
                    || entry.status?.createdAt
                    || null;

                return {
                    userId: entry.userId,
                    status: entry.status?.status || 'active',
                    ticketId: entry.status?.ticketId || null,
                    ticketStatus: entry.status?.ticketStatus || null,
                    createdAt: entry.status?.createdAt || null,
                    updatedAt: entry.status?.updatedAt || lastMessageAt,
                    closedAt: entry.status?.closedAt || null,
                    lastMessageAt,
                    lastSenderType: latestMessage?.senderType || entry.status?.lastSenderType || null,
                    lastMessage: this.summarizeMessage(latestMessage) || {
                        message: entry.status?.lastMessagePreview || '',
                        senderType: entry.status?.lastSenderType || null,
                        timestamp: lastMessageAt
                    },
                    unreadFromUser,
                    messageCount: Number(entry.status?.messageCount || 0)
                };
            });

            return chats
                .sort((a, b) => new Date(b.lastMessageAt || b.updatedAt || 0) - new Date(a.lastMessageAt || a.updatedAt || 0))
                .slice(0, Math.max(1, Number(limit) || 50));
        } catch (error) {
            logger.error('❌ Erro ao listar chats N0:', error);
            return [];
        }
    }

    /**
     * ✅ Obter mensagens ativas do Redis (antes de encerrar)
     * @param {string} userId - ID do usuário
     * @returns {Promise<Array>} Lista de mensagens
     */
    async getActiveMessages(userId) {
        try {
            const messagesKey = this.getMessagesKey(userId);
            const messages = await this.redis.zrange(messagesKey, 0, -1);
            
            return messages.map(msg => this.parseJson(msg)).filter(Boolean).sort((a, b) =>
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
    async getMessageHistory(userId, limit = 50, { includeArchived = true } = {}) {
        try {
            // ✅ Primeiro, buscar mensagens ativas do Redis
            const activeMessages = await this.getActiveMessages(userId);
            
            // ✅ Depois, buscar mensagens encerradas do Firestore
            let firestoreMessages = [];
            if (includeArchived && this.firestore) {
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
            const ids = Array.isArray(messageIds) ? messageIds : [];
            const normalizedIds = new Set(ids.map((id) => String(id)));
            const messagesKey = this.getMessagesKey(userId);
            const activeMessages = await this.redis.zrange(messagesKey, 0, -1);
            const multi = this.redis.multi();
            let redisUpdates = 0;
            let userRedisUpdates = 0;

            activeMessages.forEach((rawMessage) => {
                const message = this.parseJson(rawMessage);
                if (!message) return;
                const shouldMark = normalizedIds.size > 0
                    ? normalizedIds.has(String(message.id))
                    : message.senderType === 'user' && message.read !== true;
                if (!shouldMark) return;

                const updated = {
                    ...message,
                    read: true,
                    readAt: now,
                    readByAgentAt: now
                };
                multi.zrem(messagesKey, rawMessage);
                multi.zadd(messagesKey, this.getMessageScore(updated), JSON.stringify(updated));
                redisUpdates += 1;
                if (message.senderType === 'user') userRedisUpdates += 1;
            });

            if (redisUpdates > 0) {
                await multi.exec();
            }

            const currentStatus = this.parseJson(await this.redis.hget(this.chatStatusKey, userId), null);
            if (currentStatus) {
                currentStatus.updatedAt = now;
                currentStatus.unreadFromUser = ids.length === 0
                    ? 0
                    : Math.max(0, Number(currentStatus.unreadFromUser || 0) - userRedisUpdates);
                await this.redis.hset(this.chatStatusKey, userId, JSON.stringify(currentStatus));
            }

            if (!this.firestore) {
                logger.info(`✅ Mensagens ativas marcadas como lidas para usuário: ${userId}`);
                return;
            }

            const batch = this.firestore.batch();
            let firestoreUpdates = 0;

            if (ids.length === 0) {
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
                    firestoreUpdates += 1;
                });
            } else {
                // Marcar mensagens específicas
                ids.forEach((messageId) => {
                    const messageRef = this.firestore
                        .collection(this.historyCollection)
                        .doc(messageId);
                    batch.update(messageRef, {
                        read: true,
                        readAt: now
                    });
                    firestoreUpdates += 1;
                });
            }

            if (firestoreUpdates > 0) {
                await batch.commit();
            }
            logger.info(`✅ Mensagens marcadas como lidas para usuário: ${userId}`);

        } catch (error) {
            logger.error('❌ Erro ao marcar como lida:', error);
        }
    }

    /**
     * Converter chat N0 em ticket operacional sem perder histórico.
     */
    async convertChatToTicket(userId, {
        subject = '',
        description = '',
        category = 'chat',
        priority = 'N3',
        actorId = 'support-agent',
        userInfo = {},
        metadata = {}
    } = {}) {
        try {
            const messages = await this.getMessageHistory(userId, 80);
            const excerpt = messages
                .slice(-12)
                .map((message) => {
                    const sender = message.senderType === 'agent' ? 'Suporte' : 'Usuario';
                    return `${sender}: ${message.message || ''}`;
                })
                .join('\n');
            const resolvedSubject = String(subject || '').trim() || 'Atendimento via chat';
            const resolvedDescription = String(description || '').trim()
                || `Chat N0 convertido em chamado para acompanhamento.\n\n${excerpt || 'Sem histórico disponível.'}`;

            const supportQueueService = require('./support-queue-service');
            const result = await supportQueueService.createSupportTicket({
                subject: resolvedSubject,
                description: resolvedDescription,
                category,
                priority,
                requesterId: userId,
                userType: metadata.userType || userInfo.userType || 'passenger',
                userInfo,
                metadata: {
                    ...metadata,
                    source: 'n0_chat_conversion',
                    convertedFromChat: true,
                    chatUserId: userId,
                    convertedBy: actorId,
                    convertedAt: new Date().toISOString(),
                    chatMessageCount: messages.length
                }
            });

            await this.reopenChat(userId, 'converted_to_ticket', {
                ticketId: result.ticket?.id || null,
                ticketStatus: result.ticket?.status || 'open',
                convertedAt: new Date().toISOString(),
                convertedBy: actorId
            });

            if (this.io) {
                this.io.emit('support:chat:converted', {
                    userId,
                    ticketId: result.ticket?.id || null,
                    convertedBy: actorId
                });
            }

            return {
                success: true,
                ticket: result.ticket,
                initialMessage: result.initialMessage,
                messageCount: messages.length
            };
        } catch (error) {
            logger.error('❌ Erro ao converter chat em ticket:', error);
            throw error;
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
