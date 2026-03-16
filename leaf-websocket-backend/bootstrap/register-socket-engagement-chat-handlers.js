function registerSocketEngagementChatHandlers({
    socket,
    io,
    logStructured,
    rateLimiterService,
    redisPool
}) {
    const COMPLETED_RIDE_STATUSES = new Set(['COMPLETED', 'FINISHED', 'FINALIZED', 'DONE']);
    const CANCELED_RIDE_STATUSES = new Set(['CANCELED', 'CANCELLED', 'EXPIRED', 'NO_DRIVER']);
    const LOST_ITEM_CHAT_TTL_SECONDS = Number.parseInt(process.env.LOST_ITEM_CHAT_TTL_SECONDS || '86400', 10);

    const normalizeUserType = (userType) => {
        const normalized = String(userType || '').toLowerCase();
        if (normalized === 'customer') return 'passenger';
        if (normalized === 'rider') return 'passenger';
        return normalized;
    };

    const normalizeStatus = (status) => String(status || '').trim().toUpperCase();
    const isLostItemContext = (data = {}) => {
        const rawContext = [
            data.context,
            data.reason,
            data.category,
            data.messageType
        ]
            .filter(Boolean)
            .map((value) => String(value).trim().toLowerCase());
        return rawContext.includes('lost_item') || rawContext.includes('forgotten_item');
    };

    const getConversationState = async (conversationId) => {
        const fromMemory = io.activeBookings?.get(conversationId) || null;
        const memoryStatus = normalizeStatus(fromMemory?.status || fromMemory?.bookingStatus || fromMemory?.tripStatus);
        const memoryCustomerId = fromMemory?.customerId || fromMemory?.customer || fromMemory?.passengerId || null;
        const memoryDriverId = fromMemory?.driverId || fromMemory?.driver || null;

        if (fromMemory && (memoryStatus || memoryCustomerId || memoryDriverId)) {
            return {
                status: memoryStatus,
                customerId: memoryCustomerId,
                driverId: memoryDriverId
            };
        }

        if (!redisPool) {
            return { status: '', customerId: null, driverId: null };
        }

        try {
            const redis = redisPool.getConnection();

            const bookingHash = await redis.hgetall(`booking:${conversationId}`);
            if (bookingHash && Object.keys(bookingHash).length > 0) {
                return {
                    status: normalizeStatus(bookingHash.status || bookingHash.bookingStatus || bookingHash.tripStatus),
                    customerId: bookingHash.customerId || bookingHash.customer || bookingHash.passengerId || null,
                    driverId: bookingHash.driverId || bookingHash.driver || null
                };
            }

            const activeRaw = await redis.hget('bookings:active', conversationId);
            if (activeRaw) {
                const active = typeof activeRaw === 'string' ? JSON.parse(activeRaw) : activeRaw;
                return {
                    status: normalizeStatus(active?.status || active?.bookingStatus || active?.tripStatus),
                    customerId: active?.customerId || active?.customer || active?.passengerId || null,
                    driverId: active?.driverId || active?.driver || null
                };
            }
        } catch (error) {
            logStructured('warn', 'Falha ao consultar estado da corrida para chat', {
                service: 'websocket',
                operation: 'chatPolicy.getConversationState',
                conversationId,
                error: error.message
            });
        }

        return { status: '', customerId: null, driverId: null };
    };

    const ensureLostItemWindow = async ({ conversationId, senderId, senderType, data }) => {
        if (!redisPool) {
            return false;
        }

        const redis = redisPool.getConnection();
        const key = `chat:lost_item:${conversationId}`;
        const existing = await redis.get(key);

        if (existing) {
            return true;
        }

        if (senderType !== 'passenger' || !isLostItemContext(data)) {
            return false;
        }

        const payload = {
            openedBy: senderId,
            reason: data.reason || data.context || 'lost_item',
            openedAt: new Date().toISOString()
        };

        await redis.setex(key, LOST_ITEM_CHAT_TTL_SECONDS, JSON.stringify(payload));
        return true;
    };

    const enforceChatPolicy = async ({ conversationId, senderId, senderType, data = {} }) => {
        const state = await getConversationState(conversationId);
        const status = normalizeStatus(state.status);
        const hasAssignedDriver = Boolean(state.driverId);

        if (CANCELED_RIDE_STATUSES.has(status)) {
            return {
                allowed: false,
                code: 'CHAT_RIDE_CANCELED',
                error: 'Chat indisponível: corrida cancelada'
            };
        }

        if (COMPLETED_RIDE_STATUSES.has(status)) {
            try {
                const isAllowed = await ensureLostItemWindow({ conversationId, senderId, senderType, data });
                if (!isAllowed) {
                    return {
                        allowed: false,
                        code: 'CHAT_POST_TRIP_BLOCKED',
                        error: 'Chat encerrado após finalização da corrida. Use o contexto de item esquecido para reabrir.'
                    };
                }
            } catch (error) {
                return {
                    allowed: false,
                    code: 'CHAT_POLICY_ERROR',
                    error: `Não foi possível validar política de chat: ${error.message}`
                };
            }
        }

        if (!COMPLETED_RIDE_STATUSES.has(status) && !hasAssignedDriver) {
            return {
                allowed: false,
                code: 'CHAT_NOT_AVAILABLE_YET',
                error: 'Chat fica disponível após o motorista aceitar a corrida'
            };
        }

        return {
            allowed: true,
            state
        };
    };

    // ==================== NOVOS EVENTOS - NOTIFICAÇÕES AVANÇADAS ====================

    // Atualizar preferências de notificação
    socket.on('updateNotificationPreferences', async (data) => {
        try {
            logStructured('info', 'Preferências de notificação recebidas', {
                service: 'websocket',
                operation: 'updateNotificationPreferences',
                userId: socket.userId || socket.id
            });

            const { rideUpdates, promotions, driverMessages, systemAlerts } = data;

            // Simular atualização das preferências
            const preferencesData = {
                rideUpdates: rideUpdates !== undefined ? rideUpdates : true,
                promotions: promotions !== undefined ? promotions : false,
                driverMessages: driverMessages !== undefined ? driverMessages : true,
                systemAlerts: systemAlerts !== undefined ? systemAlerts : true,
                timestamp: new Date().toISOString()
            };

            // Emitir confirmação
            socket.emit('notificationPreferencesUpdated', {
                success: true,
                message: 'Preferências de notificação atualizadas',
                data: preferencesData
            });

            logStructured('info', 'Preferências de notificação atualizadas com sucesso', {
                service: 'websocket',
                operation: 'updateNotificationPreferences',
                userId: socket.userId || socket.id
            });

        } catch (error) {
            logStructured('error', 'Erro ao atualizar preferências de notificação', {
                service: 'websocket',
                operation: 'updateNotificationPreferences',
                userId: socket.userId || socket.id,
                error: error.message
            });
            socket.emit('notificationError', { error: 'Erro interno do servidor' });
        }
    });

    // ==================== NOVOS EVENTOS - ANALYTICS E FEEDBACK ====================

    // Rastrear ação do usuário
    socket.on('trackUserAction', async (data) => {
        try {
            logStructured('info', 'Ação do usuário recebida para rastreamento', {
                service: 'websocket',
                operation: 'trackUserAction',
                userId: socket.userId || socket.id,
                action: data.action
            });

            const { action, data: actionData, timestamp } = data;

            if (!action) {
                socket.emit('trackingError', { error: 'Ação obrigatória' });
                return;
            }

            // Simular rastreamento
            const trackingData = {
                actionId: `action_${Date.now()}`,
                action,
                data: actionData || {},
                timestamp: timestamp || new Date().toISOString(),
                processed: true
            };

            // Emitir confirmação
            socket.emit('userActionTracked', {
                success: true,
                actionId: trackingData.actionId,
                message: 'Ação rastreada com sucesso'
            });

            logStructured('info', 'Ação do usuário rastreada com sucesso', {
                service: 'websocket',
                operation: 'trackUserAction',
                userId: socket.userId || socket.id,
                actionId: trackingData.actionId,
                action: action
            });

        } catch (error) {
            logStructured('error', 'Erro ao rastrear ação do usuário', {
                service: 'websocket',
                operation: 'trackUserAction',
                userId: socket.userId || socket.id,
                error: error.message
            });
            socket.emit('trackingError', { error: 'Erro interno do servidor' });
        }
    });

    // Enviar feedback
    socket.on('submitFeedback', async (data) => {
        try {
            logStructured('info', 'Feedback recebido', {
                service: 'websocket',
                operation: 'submitFeedback',
                userId: socket.userId || socket.id,
                type: data.type,
                rating: data.rating
            });

            const { type, rating, comments, suggestions } = data;

            if (!type || !rating) {
                socket.emit('feedbackError', { error: 'Tipo e avaliação obrigatórios' });
                return;
            }

            // Simular processamento do feedback
            const feedbackData = {
                feedbackId: `feedback_${Date.now()}`,
                type,
                rating,
                comments: comments || '',
                suggestions: suggestions || '',
                status: 'received',
                timestamp: new Date().toISOString()
            };

            // Emitir confirmação
            socket.emit('feedbackReceived', {
                success: true,
                feedbackId: feedbackData.feedbackId,
                thankYouMessage: 'Obrigado pelo seu feedback! Sua opinião é muito importante para nós.',
                data: feedbackData
            });

            logStructured('info', 'Feedback processado com sucesso', {
                service: 'websocket',
                operation: 'submitFeedback',
                userId: socket.userId || socket.id,
                feedbackId: feedbackData.feedbackId,
                type: type,
                rating: rating
            });

        } catch (error) {
            logStructured('error', 'Erro ao processar feedback', {
                service: 'websocket',
                operation: 'submitFeedback',
                userId: socket.userId || socket.id,
                error: error.message
            });
            socket.emit('feedbackError', { error: 'Erro interno do servidor' });
        }
    });

    // ==================== NOVOS EVENTOS - CHAT E COMUNICAÇÃO ====================

    // Criar chat
    socket.on('createChat', async (data = {}) => {
        try {
            logStructured('info', 'Criação de chat solicitada', {
                service: 'websocket',
                operation: 'createChat',
                userId: socket.userId || socket.id,
                bookingId: data.bookingId || data.tripId || data.rideId || null
            });

            const chatId =
                data.chatId ||
                data.bookingId ||
                data.tripId ||
                data.rideId ||
                `chat_${Date.now()}`;
            const conversationId = data.bookingId || data.tripId || data.rideId || data.chatId || chatId;
            const requesterId = socket.userId || socket.id;
            const requesterType = normalizeUserType(data.userType || socket.userType);

            if (conversationId) {
                const policy = await enforceChatPolicy({
                    conversationId,
                    senderId: requesterId,
                    senderType: requesterType,
                    data
                });

                if (!policy.allowed) {
                    socket.emit('chatError', {
                        error: policy.error,
                        code: policy.code,
                        bookingId: conversationId,
                        chatId: conversationId
                    });
                    return;
                }
            }

            const participants = Array.isArray(data.participants) ? data.participants.filter(Boolean) : [];
            if (participants.length > 0 && socket.userId && !participants.includes(socket.userId)) {
                participants.push(socket.userId);
            }

            socket.emit('chatCreated', {
                success: true,
                chatId,
                bookingId: data.bookingId || data.tripId || data.rideId || chatId,
                participants,
                type: data.type || 'trip_chat',
                message: 'Chat criado com sucesso'
            });

            logStructured('info', 'Chat criado com sucesso', {
                service: 'websocket',
                operation: 'createChat',
                userId: socket.userId || socket.id,
                chatId: chatId
            });

        } catch (error) {
            logStructured('error', 'Erro ao criar chat', {
                service: 'websocket',
                operation: 'createChat',
                userId: socket.userId || socket.id,
                error: error.message
            });
            socket.emit('chatError', { error: 'Erro interno do servidor' });
        }
    });

    // Enviar mensagem
    socket.on('sendMessage', async (data = {}) => {
        try {
            // ✅ NOVO: Rate Limiting
            const senderId = data.senderId || socket.userId || socket.id;
            const rateLimitCheck = await rateLimiterService.checkRateLimit(senderId, 'sendMessage');

            if (!rateLimitCheck.allowed) {
                socket.emit('messageError', {
                    error: 'Muitas requisições',
                    message: `Você excedeu o limite de ${rateLimitCheck.limit} mensagens por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                    code: 'RATE_LIMIT_EXCEEDED',
                    limit: rateLimitCheck.limit,
                    remaining: rateLimitCheck.remaining,
                    resetAt: rateLimitCheck.resetAt
                });
                logStructured('warn', 'Rate limit excedido para sendMessage', {
                    service: 'websocket',
                    operation: 'sendMessage',
                    senderId: senderId,
                    limit: rateLimitCheck.limit,
                    remaining: rateLimitCheck.remaining
                });
                return;
            }

            logStructured('info', 'Mensagem recebida para envio', {
                service: 'websocket',
                operation: 'sendMessage',
                senderId: senderId,
                bookingId: data.bookingId,
                rideId: data.rideId
            });

            const { bookingId, rideId, chatId, tripId, receiverId, senderType } = data;
            const messageText = data.message || data.text;
            const normalizedSenderType = normalizeUserType(senderType || socket.userType);

            if (!messageText || !senderId) {
                socket.emit('messageError', { error: 'Mensagem e senderId são obrigatórios' });
                return;
            }

            const conversationId = bookingId || rideId || tripId || chatId;

            if (!conversationId) {
                socket.emit('messageError', { error: 'bookingId/rideId/tripId/chatId é obrigatório' });
                return;
            }

            const policy = await enforceChatPolicy({
                conversationId,
                senderId,
                senderType: normalizedSenderType,
                data
            });
            if (!policy.allowed) {
                socket.emit('messageError', {
                    error: policy.error,
                    code: policy.code,
                    bookingId: conversationId,
                    chatId: conversationId
                });
                return;
            }

            // ✅ NOVO: Salvar mensagem no Firestore com TTL de 90 dias
            try {
                const chatPersistenceService = require('../services/chat-persistence-service');
                const saveResult = await chatPersistenceService.saveMessage({
                    bookingId: bookingId || conversationId,
                    rideId: rideId || conversationId,
                    senderId: senderId,
                    receiverId: receiverId || null,
                    message: messageText,
                    senderType: normalizedSenderType || (socket.userType === 'driver' ? 'driver' : 'passenger'),
                    timestamp: new Date().toISOString()
                });

                if (!saveResult.success) {
                    logStructured('error', 'Erro ao salvar mensagem no Firestore', {
                        service: 'websocket',
                        operation: 'sendMessage',
                        senderId: senderId,
                        conversationId: conversationId,
                        error: saveResult.error
                    });
                    // Não bloquear envio se persistência falhar, mas logar erro
                }
            } catch (persistError) {
                logStructured('error', 'Erro ao persistir mensagem', {
                    service: 'websocket',
                    operation: 'sendMessage',
                    senderId: senderId,
                    conversationId: conversationId,
                    error: persistError.message
                });
                // Não bloquear envio se persistência falhar
            }

            // Gerar ID da mensagem
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Buscar dados do booking para notificar o outro participante
            const bookingData = io.activeBookings?.get(conversationId);
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
                chatId: conversationId,
                bookingId: conversationId,
                text: messageText,
                senderId,
                senderType: normalizedSenderType || (socket.userType === 'driver' ? 'driver' : 'passenger'),
                message: 'Mensagem enviada com sucesso',
                timestamp: new Date().toISOString()
            });

            // Notificar o receptor se estiver conectado
            if (finalReceiverId && io.connectedUsers) {
                const receiverSocket = io.connectedUsers.get(finalReceiverId);
                if (receiverSocket) {
                    receiverSocket.emit('newMessage', {
                        success: true,
                        messageId: messageId,
                        chatId: conversationId,
                        bookingId: conversationId,
                        senderId: senderId,
                        text: messageText,
                        message: messageText,
                        senderType: normalizedSenderType || (socket.userType === 'driver' ? 'driver' : 'passenger'),
                        timestamp: new Date().toISOString()
                    });
                    logStructured('info', 'Mensagem enviada para receptor', {
                        service: 'websocket',
                        operation: 'sendMessage',
                        senderId: senderId,
                        receiverId: finalReceiverId,
                        conversationId: conversationId
                    });
                }
            }

        } catch (error) {
            logStructured('error', 'Erro ao enviar mensagem', {
                service: 'websocket',
                operation: 'sendMessage',
                senderId: data.senderId || socket.userId || socket.id,
                error: error.message
            });
            socket.emit('messageError', { error: 'Erro interno do servidor' });
        }
    });
}

module.exports = registerSocketEngagementChatHandlers;
