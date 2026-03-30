const firebaseConfig = require('../firebase-config');
const chatPersistenceService = require('../services/chat-persistence-service');
const promotionService = require('../services/promotion-service');
const ratingService = require('../services/rating-service');

function registerSocketLegacyBridgeHandler({
    socket,
    io,
    redisPool,
    logStructured
}) {
    const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
    const bridgeMeta = {
        bridge: 'legacy-event-bridge',
        userId: socket.userId || socket.id
    };

    const logBridgeEvent = (legacyEvent, mappedEvent = null) => {
        logStructured('info', 'Evento legado recebido via bridge', {
            ...bridgeMeta,
            legacyEvent,
            mappedEvent
        });
    };

    const resolveConversationId = (data = {}) => {
        return data.chatId || data.bookingId || data.tripId || data.rideId || null;
    };

    const normalizeUserType = (userType) => {
        const normalized = String(userType || '').toLowerCase();
        if (normalized === 'customer') return 'passenger';
        return normalized;
    };

    const paginate = (items = [], page = 0, limit = 20) => {
        const safePage = Math.max(0, Number.parseInt(page, 10) || 0);
        const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 20));
        const start = safePage * safeLimit;
        return {
            page: safePage,
            limit: safeLimit,
            items: items.slice(start, start + safeLimit),
            total: items.length
        };
    };

    const getBookingParticipants = async (conversationId) => {
        const fromMemory = io.activeBookings?.get(conversationId) || null;
        const memoryCustomerId = fromMemory?.customerId || fromMemory?.customer || fromMemory?.passengerId || null;
        const memoryDriverId = fromMemory?.driverId || fromMemory?.driver || null;

        if (memoryCustomerId || memoryDriverId) {
            return {
                customerId: memoryCustomerId,
                driverId: memoryDriverId
            };
        }

        try {
            const redis = redisPool.getConnection();
            const bookingData = await redis.hgetall(`booking:${conversationId}`);
            return {
                customerId: bookingData?.customerId || bookingData?.customer || bookingData?.passengerId || null,
                driverId: bookingData?.driverId || bookingData?.driver || null
            };
        } catch {
            return { customerId: null, driverId: null };
        }
    };

    const listPromotionsForLegacy = async ({ filters = {}, page = 0, limit = 20 } = {}) => {
        const listFilters = {};
        if (filters?.status) listFilters.status = filters.status;
        if (filters?.type) listFilters.type = filters.type;

        const result = await promotionService.listPromotions(listFilters);
        const promotions = Array.isArray(result?.promotions) ? result.promotions : [];

        const normalized = promotions.map((promo) => ({
            id: promo.id,
            name: promo.name,
            code: promo.code || promo.promoCode || promo.name,
            promoCode: promo.promoCode || promo.code || promo.name,
            description: promo.description || '',
            type: promo.type || 'promotion',
            status: promo.status || 'active',
            startDate: promo.startDate || null,
            endDate: promo.endDate || null,
            maxRedemptions: promo.maxRedemptions ?? null,
            currentRedemptions: promo.currentRedemptions ?? 0,
            benefit: promo.benefit || null,
            eligibility: promo.eligibility || null,
            updatedAt: promo.updatedAt || promo.createdAt || null
        }));

        const paged = paginate(normalized, page, limit);
        return {
            success: true,
            promos: paged.items,
            page: paged.page,
            limit: paged.limit,
            total: paged.total
        };
    };

    const findPromotionByCode = async (code) => {
        const cleanCode = String(code || '').trim().toLowerCase();
        if (!cleanCode) return null;

        const all = await promotionService.listPromotions({});
        const promotions = Array.isArray(all?.promotions) ? all.promotions : [];

        return promotions.find((promo) => {
            const candidateCodes = [
                promo.code,
                promo.promoCode,
                promo.name,
                promo.id
            ]
                .filter(Boolean)
                .map((item) => String(item).trim().toLowerCase());
            return candidateCodes.includes(cleanCode);
        }) || null;
    };

    const emitTypingStatus = async (data = {}, isTyping = false) => {
        const conversationId = resolveConversationId(data);
        const payload = {
            success: true,
            isTyping,
            chatId: conversationId,
            bookingId: conversationId,
            userId: socket.userId || null,
            timestamp: new Date().toISOString(),
            bridgeMode: 'compat'
        };

        socket.emit('typingStatusChanged', payload);

        if (!conversationId) return;
        const participants = await getBookingParticipants(conversationId);
        const senderType = normalizeUserType(socket.userType || data.userType);
        let delivered = false;

        if (senderType === 'driver' && participants.customerId) {
            io.to(`customer_${participants.customerId}`).emit('typingStatusChanged', payload);
            delivered = true;
        } else if (senderType === 'passenger' && participants.driverId) {
            io.to(`driver_${participants.driverId}`).emit('typingStatusChanged', payload);
            delivered = true;
        } else {
            if (participants.customerId) {
                io.to(`customer_${participants.customerId}`).emit('typingStatusChanged', payload);
                delivered = true;
            }
            if (participants.driverId) {
                io.to(`driver_${participants.driverId}`).emit('typingStatusChanged', payload);
                delivered = true;
            }
        }

        if (!delivered) {
            socket.broadcast.emit('typingStatusChanged', payload);
        }
    };

    // Legacy: arriveAtPickup -> evento de cliente aguardando confirmacao de chegada.
    socket.on('arriveAtPickup', async (data = {}) => {
        try {
            logBridgeEvent('arriveAtPickup', 'arrivedAtPickup');
            const rideId = data.rideId || data.bookingId || null;
            const location = data.location || null;

            socket.emit('arrivedAtPickup', {
                success: true,
                rideId,
                bookingId: rideId,
                location,
                timestamp: new Date().toISOString(),
                bridgeMode: 'compat'
            });

            if (rideId) {
                const redis = redisPool.getConnection();
                const bookingData = await redis.hgetall(`booking:${rideId}`);
                const customerId = bookingData?.customerId || bookingData?.customer || null;
                if (customerId) {
                    io.to(`customer_${customerId}`).emit('arrivedAtPickup', {
                        success: true,
                        rideId,
                        bookingId: rideId,
                        location,
                        driverId: socket.userId || null,
                        timestamp: new Date().toISOString(),
                        bridgeMode: 'compat'
                    });
                }
            }
        } catch (error) {
            socket.emit('arrivedAtPickup', {
                success: false,
                error: error.message || 'Erro ao processar chegada no pickup'
            });
        }
    });

    // Legacy: setDriverStatus -> manter compatibilidade com telas antigas.
    socket.on('setDriverStatus', async (data = {}) => {
        try {
            logBridgeEvent('setDriverStatus', 'driverStatusUpdated');
            const redis = redisPool.getConnection();
            const driverId = data.driverId || socket.userId;
            const requestedStatus = String(data.status || '').toUpperCase();
            const requestedOnline = data.isOnline !== false && requestedStatus !== 'OFFLINE';
            const status = requestedOnline ? 'AVAILABLE' : 'OFFLINE';
            const isOnline = requestedOnline === true;

            if (!driverId) {
                socket.emit('driverStatusError', {
                    error: 'driverId ausente',
                    code: 'MISSING_DRIVER_ID'
                });
                return;
            }

            const driverKey = `driver:${driverId}`;
            const existingDriverState = await redis.hgetall(driverKey);
            const existingIsEligible = existingDriverState?.dispatchEligible === 'true';

            if (!isOnline) {
                await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
            }

            await redis.hset(driverKey, {
                driverId,
                status,
                isOnline: String(isOnline),
                dispatchEligible: String(isOnline && existingIsEligible),
                dispatchEligibilityCode: isOnline
                    ? (existingDriverState?.dispatchEligibilityCode || 'AWAITING_LOCATION_SYNC')
                    : 'OFFLINE',
                dispatchEligibilityCheckedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            if (isOnline && existingIsEligible) {
                const lat = Number(existingDriverState?.lat);
                const lng = Number(existingDriverState?.lng);
                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                    await redis.geoadd(ELIGIBLE_DRIVER_GEO_KEY, lng, lat, driverId);
                }
            }

            socket.emit('driverStatusUpdated', {
                success: true,
                driverId,
                status,
                isOnline,
                dispatchEligible: isOnline && existingIsEligible,
                timestamp: new Date().toISOString(),
                bridgeMode: 'compat'
            });
        } catch (error) {
            socket.emit('driverStatusError', {
                error: error.message || 'Erro ao atualizar status do motorista'
            });
        }
    });

    // Legacy chat list/read events.
    socket.on('get_user_chats', async (data = {}) => {
        try {
            logBridgeEvent('get_user_chats', 'user_chats_loaded');
            const userId = data.userId || socket.userId;
            if (!userId) {
                socket.emit('user_chats_loaded', {
                    success: false,
                    error: 'userId ausente',
                    chats: []
                });
                return;
            }

            const chatIds = new Set();
            const activeBookings = io.activeBookings ? [...io.activeBookings.values()] : [];
            activeBookings.forEach((booking) => {
                const customerId = booking.customerId || booking.customer || booking.passengerId;
                const driverId = booking.driverId || booking.driver;
                const bookingId = booking.bookingId || booking.id || null;
                if (customerId === userId || driverId === userId) {
                    if (bookingId) {
                        chatIds.add(bookingId);
                    }
                }
            });

            try {
                const redis = redisPool.getConnection();
                const activeFromRedis = await redis.hgetall('bookings:active');
                Object.entries(activeFromRedis || {}).forEach(([bookingId, raw]) => {
                    try {
                        const booking = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        const customerId = booking?.customerId || booking?.customer || booking?.passengerId;
                        const driverId = booking?.driverId || booking?.driver;
                        if (customerId === userId || driverId === userId) {
                            chatIds.add(bookingId);
                        }
                    } catch {
                        // noop
                    }
                });
            } catch {
                // noop
            }

            const limit = Math.max(1, Math.min(50, Number.parseInt(data.limit, 10) || 20));
            const selectedChatIds = [...chatIds].slice(0, limit);
            const chats = [];

            for (const chatId of selectedChatIds) {
                const participants = await getBookingParticipants(chatId);
                const messagesResult = await chatPersistenceService.getMessages(chatId, 1);
                const lastMessage = messagesResult?.messages?.[0] || null;
                chats.push({
                    chatId,
                    bookingId: chatId,
                    participants,
                    status: 'active',
                    lastMessage: lastMessage ? {
                        id: lastMessage.messageId || lastMessage.id,
                        text: lastMessage.message,
                        senderId: lastMessage.senderId,
                        timestamp: lastMessage.timestamp || lastMessage.createdAt
                    } : null,
                    updatedAt: lastMessage?.timestamp || lastMessage?.createdAt || null
                });
            }

            socket.emit('user_chats_loaded', {
                success: true,
                chats,
                total: chats.length,
                bridgeMode: 'compat'
            });
        } catch (error) {
            socket.emit('user_chats_loaded', {
                success: false,
                error: error.message || 'Erro ao carregar chats',
                chats: []
            });
        }
    });

    socket.on('load_messages', async (data = {}) => {
        try {
            logBridgeEvent('load_messages', 'messages_loaded');
            const conversationId = resolveConversationId(data);
            if (!conversationId) {
                socket.emit('messages_loaded', {
                    success: false,
                    error: 'chatId/bookingId ausente',
                    messages: []
                });
                return;
            }

            const page = Math.max(0, Number.parseInt(data.page, 10) || 0);
            const limit = Math.max(1, Math.min(100, Number.parseInt(data.limit, 10) || 20));
            const rawResult = await chatPersistenceService.getMessages(conversationId, (page + 1) * limit);
            const allMessages = Array.isArray(rawResult?.messages) ? rawResult.messages : [];
            const paged = paginate(allMessages, page, limit);

            socket.emit('messages_loaded', {
                success: true,
                chatId: conversationId,
                bookingId: conversationId,
                messages: paged.items,
                page: paged.page,
                limit: paged.limit,
                total: paged.total,
                bridgeMode: 'compat'
            });
        } catch (error) {
            socket.emit('messages_loaded', {
                success: false,
                error: error.message || 'Erro ao carregar mensagens',
                messages: []
            });
        }
    });

    socket.on('mark_messages_read', async (data = {}) => {
        try {
            logBridgeEvent('mark_messages_read', 'messages_marked_read');
            const conversationId = resolveConversationId(data);
            const messageIds = Array.isArray(data.messageIds) ? data.messageIds.filter(Boolean) : [];
            let markedCount = 0;

            for (const messageId of messageIds) {
                const result = await chatPersistenceService.markMessageAsRead(messageId);
                if (result?.success) markedCount += 1;
            }

            socket.emit('messages_marked_read', {
                success: true,
                chatId: conversationId,
                bookingId: conversationId,
                messageIds,
                markedCount,
                bridgeMode: 'compat'
            });
        } catch (error) {
            socket.emit('messages_marked_read', {
                success: false,
                error: error.message || 'Erro ao marcar mensagens como lidas',
                messageIds: []
            });
        }
    });

    socket.on('typing_start', async (data = {}) => {
        logBridgeEvent('typing_start', 'typingStatusChanged');
        await emitTypingStatus(data, true);
    });

    socket.on('typing_stop', async (data = {}) => {
        logBridgeEvent('typing_stop', 'typingStatusChanged');
        await emitTypingStatus(data, false);
    });

    // Rating events.
    socket.on('submitRating', async (data = {}) => {
        try {
            logBridgeEvent('submitRating', 'ratingSubmitted');
            const result = await ratingService.submitRating(data, {
                socketUserId: socket.userId,
                socketUserType: socket.userType
            });

            if (!result.success) {
                const errorPayload = {
                    success: false,
                    error: result.error || 'Falha ao enviar avaliação',
                    tripId: data.tripId || data.bookingId || data.rideId || null
                };
                socket.emit('ratingSubmitted', errorPayload);
                socket.emit('ratingError', errorPayload);
                return;
            }

            const payload = {
                success: true,
                ratingId: result.ratingId,
                tripId: result.rating.tripId,
                rating: result.rating.rating,
                comment: result.rating.comment,
                reviewerId: result.rating.reviewerId,
                reviewerType: result.rating.reviewerType,
                targetUserId: result.rating.targetUserId,
                timestamp: result.rating.createdAt,
                kycEscalation: result.kycEscalation || null,
                bridgeMode: 'compat'
            };

            socket.emit('ratingSubmitted', payload);

            if (result.rating.targetUserId) {
                const targetRoomByType = result.rating.reviewerType === 'driver'
                    ? `customer_${result.rating.targetUserId}`
                    : `driver_${result.rating.targetUserId}`;

                io.to(targetRoomByType).emit('ratingReceived', payload);
                io.to(targetRoomByType).emit('ratingSubmitted', payload);
            }
        } catch (error) {
            socket.emit('ratingSubmitted', {
                success: false,
                error: error.message || 'Erro ao processar avaliação'
            });
            socket.emit('ratingError', {
                success: false,
                error: error.message || 'Erro ao processar avaliação'
            });
        }
    });

    socket.on('getTripRatings', async (data = {}) => {
        try {
            logBridgeEvent('getTripRatings', 'tripRatings');
            const tripId = data.tripId || data.bookingId || data.rideId;
            const result = await ratingService.getTripRatings(tripId);
            socket.emit('tripRatings', result);
        } catch (error) {
            socket.emit('tripRatings', {
                success: false,
                tripId: data.tripId || null,
                ratings: [],
                error: error.message || 'Erro ao buscar avaliações da corrida'
            });
        }
    });

    socket.on('getUserRatings', async (data = {}) => {
        try {
            logBridgeEvent('getUserRatings', 'userRatings');
            const targetUserId = data.targetUserId || data.userId || socket.userId;
            const result = await ratingService.getUserRatings(targetUserId);
            socket.emit('userRatings', result);
        } catch (error) {
            socket.emit('userRatings', {
                success: false,
                targetUserId: data.targetUserId || null,
                ratings: [],
                averageRating: 0,
                totalRatings: 0,
                error: error.message || 'Erro ao buscar avaliações do usuário'
            });
        }
    });

    socket.on('hasUserRatedTrip', async (data = {}) => {
        try {
            logBridgeEvent('hasUserRatedTrip', 'userRatedTrip');
            const tripId = data.tripId || data.bookingId || data.rideId;
            const reviewerId = data.userId || socket.userId;
            const result = await ratingService.hasUserRatedTrip(tripId, reviewerId);
            socket.emit('userRatedTrip', result);
        } catch (error) {
            socket.emit('userRatedTrip', {
                success: false,
                tripId: data.tripId || null,
                hasRated: false,
                error: error.message || 'Erro ao verificar avaliação'
            });
        }
    });

    // Legacy promo events.
    socket.on('get_promos', async (data = {}) => {
        try {
            logBridgeEvent('get_promos', 'promos_loaded');
            const result = await listPromotionsForLegacy({
                filters: data.filters || {},
                page: data.page,
                limit: data.limit
            });
            socket.emit('promos_loaded', {
                ...result,
                bridgeMode: 'compat'
            });
        } catch (error) {
            socket.emit('promos_loaded', {
                success: false,
                promos: [],
                page: 0,
                limit: 20,
                total: 0,
                error: error.message || 'Erro ao carregar promoções'
            });
        }
    });

    socket.on('get_user_promos', async (data = {}) => {
        try {
            logBridgeEvent('get_user_promos', 'user_promos_loaded');
            const userId = data.userId || socket.userId;
            if (!userId) {
                socket.emit('user_promos_loaded', { success: true, promos: [] });
                return;
            }

            if (!firebaseConfig || typeof firebaseConfig.getFromRealtimeDB !== 'function') {
                socket.emit('user_promos_loaded', { success: true, promos: [] });
                return;
            }

            const raw = await firebaseConfig.getFromRealtimeDB(`driver_promotions/${userId}`) || {};
            const promos = Object.values(raw).sort((a, b) => {
                return new Date(b.redeemedAt || 0).getTime() - new Date(a.redeemedAt || 0).getTime();
            });

            socket.emit('user_promos_loaded', {
                success: true,
                userId,
                promos,
                total: promos.length,
                bridgeMode: 'compat'
            });
        } catch (error) {
            socket.emit('user_promos_loaded', {
                success: false,
                promos: [],
                error: error.message || 'Erro ao carregar promoções do usuário'
            });
        }
    });

    socket.on('validate_promo_code', async (data = {}) => {
        try {
            logBridgeEvent('validate_promo_code', 'promo_code_validated');
            const promo = await findPromotionByCode(data.code);
            if (!promo) {
                socket.emit('promo_code_validated', {
                    success: true,
                    code: data.code || null,
                    isValid: false,
                    reason: 'Código promocional não encontrado',
                    discount: 0
                });
                return;
            }

            const statusOk = promo.status === 'active';
            const dateOk = !promo.endDate || new Date(promo.endDate) >= new Date();
            const redemptionOk = !promo.maxRedemptions || (promo.currentRedemptions || 0) < promo.maxRedemptions;
            const isValid = statusOk && dateOk && redemptionOk;

            socket.emit('promo_code_validated', {
                success: true,
                code: data.code || null,
                isValid,
                discount: promo.benefit?.discount || 0,
                promo,
                reason: isValid ? null : 'Promoção indisponível'
            });
        } catch (error) {
            socket.emit('promo_code_validated', {
                success: false,
                code: data.code || null,
                isValid: false,
                discount: 0,
                error: error.message || 'Erro ao validar código promocional'
            });
        }
    });

    socket.on('apply_promo', async (data = {}) => {
        try {
            logBridgeEvent('apply_promo', 'promo_applied');
            const driverId = data.driverId || socket.userId;
            if (!driverId) {
                socket.emit('promo_applied', {
                    success: false,
                    error: 'driverId ausente'
                });
                return;
            }

            let promotionId = data.promoId || data.promotionId;
            if (!promotionId && data.code) {
                const promoByCode = await findPromotionByCode(data.code);
                promotionId = promoByCode?.id || null;
            }

            if (!promotionId) {
                socket.emit('promo_applied', {
                    success: false,
                    error: 'promoId ausente ou inválido'
                });
                return;
            }

            const result = await promotionService.applyPromotion(driverId, promotionId);
            if (!result.success) {
                socket.emit('promo_applied', {
                    success: false,
                    promoId: promotionId,
                    error: result.error || 'Falha ao aplicar promoção'
                });
                return;
            }

            socket.emit('promo_applied', {
                success: true,
                promoId: promotionId,
                driverId,
                benefit: result.benefit || null,
                redemption: result.redemption || null,
                finalAmount: data.orderData?.amount || null,
                bridgeMode: 'compat'
            });
        } catch (error) {
            socket.emit('promo_applied', {
                success: false,
                error: error.message || 'Erro ao aplicar promoção'
            });
        }
    });

    socket.on('get_promo_by_code', async (data = {}) => {
        try {
            logBridgeEvent('get_promo_by_code', 'promo_by_code_loaded');
            const promo = await findPromotionByCode(data.code);
            socket.emit('promo_by_code_loaded', {
                success: true,
                code: data.code || null,
                promo: promo || null,
                bridgeMode: 'compat'
            });
        } catch (error) {
            socket.emit('promo_by_code_loaded', {
                success: false,
                code: data.code || null,
                promo: null,
                error: error.message || 'Erro ao buscar promoção'
            });
        }
    });
}

module.exports = registerSocketLegacyBridgeHandler;
