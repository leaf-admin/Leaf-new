const ratingService = require('../services/rating-service');

function registerSocketRatingHandler({
    socket,
    io,
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
            const targetUserId = data.targetUserId || data.userId;
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
            const reviewerId = data.reviewerId || data.userId || socket.userId;
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
