const ratingService = require('../services/rating-service');
const {
    assertRideParticipant,
    getSocketIdentity,
    isSupportActor
} = require('../services/socket-scope-guard');

function registerSocketRatingHandler({
    socket,
    io,
    redisPool,
    logStructured
}) {
    const logRatingEvent = (eventName, responseEvent = null) => {
        logStructured('info', 'Evento de rating recebido', {
            service: 'socket-rating-handler',
            eventName,
            responseEvent,
            userId: socket.userId || socket.id
        });
    };

    socket.on('submitRating', async (data = {}) => {
        try {
            logRatingEvent('submitRating', 'ratingSubmitted');
            const tripId = data.tripId || data.bookingId || data.rideId;
            const participant = await assertRideParticipant({
                socket,
                io,
                redisPool,
                bookingId: tripId,
                allowedRoles: ['passenger', 'driver'],
                allowSupport: false
            });

            if (!participant.allowed) {
                const errorPayload = {
                    success: false,
                    error: participant.error,
                    code: participant.code,
                    tripId: tripId || null
                };
                socket.emit('ratingSubmitted', errorPayload);
                socket.emit('ratingError', errorPayload);
                return;
            }

            const result = await ratingService.submitRating({
                ...data,
                tripId,
                reviewerId: participant.identity.userId,
                userId: participant.identity.userId,
                reviewerType: participant.participantRole,
                userType: participant.participantRole,
                targetUserId: participant.participantRole === 'driver'
                    ? participant.scope.customerId
                    : participant.scope.driverId
            }, {
                socketUserId: participant.identity.userId,
                socketUserType: participant.participantRole,
                tripScope: participant.scope
            });

            if (!result.success) {
                const errorPayload = {
                    success: false,
                    error: result.error || 'Falha ao enviar avaliação',
                    code: result.code || null,
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
                idempotentReplay: result.idempotentReplay === true,
                kycEscalation: result.kycEscalation || null
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
            const errorPayload = {
                success: false,
                error: error.message || 'Erro ao processar avaliação'
            };
            socket.emit('ratingSubmitted', errorPayload);
            socket.emit('ratingError', errorPayload);
        }
    });

    socket.on('getTripRatings', async (data = {}) => {
        try {
            logRatingEvent('getTripRatings', 'tripRatings');
            const tripId = data.tripId || data.bookingId || data.rideId;
            const participant = await assertRideParticipant({
                socket,
                io,
                redisPool,
                bookingId: tripId,
                allowedRoles: ['passenger', 'driver'],
                allowSupport: true
            });
            if (!participant.allowed) {
                socket.emit('tripRatings', {
                    success: false,
                    error: participant.error,
                    code: participant.code,
                    tripId
                });
                return;
            }

            const result = await ratingService.getTripRatings(tripId);
            socket.emit('tripRatings', result.success ? result : {
                success: false,
                error: result.error || 'Erro ao buscar avaliações',
                tripId
            });
        } catch (error) {
            socket.emit('tripRatings', {
                success: false,
                error: error.message || 'Erro ao buscar avaliações'
            });
        }
    });

    socket.on('getUserRatings', async (data = {}) => {
        try {
            logRatingEvent('getUserRatings', 'userRatings');
            const identity = getSocketIdentity(socket);
            const targetUserId = data.targetUserId || data.userId || identity.userId;
            if (!identity.userId) {
                socket.emit('userRatings', {
                    success: false,
                    error: 'Autenticação obrigatória',
                    code: 'AUTH_REQUIRED',
                    targetUserId: targetUserId || null
                });
                return;
            }
            if (targetUserId !== identity.userId && !isSupportActor(socket)) {
                socket.emit('userRatings', {
                    success: false,
                    error: 'Usuário não autorizado para consultar estas avaliações',
                    code: 'RATING_SCOPE_DENIED',
                    targetUserId
                });
                return;
            }

            const result = await ratingService.getUserRatings(targetUserId);
            socket.emit('userRatings', result.success ? result : {
                success: false,
                error: result.error || 'Erro ao buscar avaliações do usuário',
                targetUserId
            });
        } catch (error) {
            socket.emit('userRatings', {
                success: false,
                error: error.message || 'Erro ao buscar avaliações do usuário'
            });
        }
    });

    socket.on('hasUserRatedTrip', async (data = {}) => {
        try {
            logRatingEvent('hasUserRatedTrip', 'userRatedTrip');
            const tripId = data.tripId || data.bookingId || data.rideId;
            const participant = await assertRideParticipant({
                socket,
                io,
                redisPool,
                bookingId: tripId,
                allowedRoles: ['passenger', 'driver'],
                allowSupport: true
            });
            if (!participant.allowed) {
                socket.emit('userRatedTrip', {
                    success: false,
                    error: participant.error,
                    code: participant.code,
                    tripId
                });
                return;
            }

            const reviewerId = participant.participantRole === 'support'
                ? data.reviewerId || data.userId || socket.userId
                : participant.identity.userId;
            const result = await ratingService.hasUserRatedTrip(tripId, reviewerId);
            socket.emit('userRatedTrip', result.success ? result : {
                success: false,
                error: result.error || 'Erro ao verificar avaliação',
                tripId,
                reviewerId
            });
        } catch (error) {
            socket.emit('userRatedTrip', {
                success: false,
                error: error.message || 'Erro ao verificar avaliação'
            });
        }
    });
}

module.exports = registerSocketRatingHandler;
