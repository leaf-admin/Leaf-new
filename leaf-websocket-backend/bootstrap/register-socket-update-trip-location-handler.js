const tripLocationPersistenceService = require('../services/trip-location-persistence-service');

function registerSocketUpdateTripLocationHandler({
    socket,
    io,
    redisPool,
    logStructured
}) {
    const BOOKING_PARTY_CACHE_TTL_MS = 15 * 1000;
    const bookingPartyCache = new Map();

    const parseBookingParticipant = (rawValue) => {
        const normalized = String(rawValue || '').trim();
        if (!normalized) {
            return null;
        }
        if (normalized.startsWith('{')) {
            try {
                const parsed = JSON.parse(normalized);
                return parsed?.uid || parsed?.id || parsed?.userId || null;
            } catch (_error) {
                return null;
            }
        }
        return normalized;
    };

    const getCachedBookingParties = (bookingId) => {
        const cached = bookingPartyCache.get(bookingId);
        if (!cached) {
            return null;
        }
        if (cached.expiresAt <= Date.now()) {
            bookingPartyCache.delete(bookingId);
            return null;
        }
        return cached.value;
    };

    const setCachedBookingParties = (bookingId, value) => {
        bookingPartyCache.set(bookingId, {
            value,
            expiresAt: Date.now() + BOOKING_PARTY_CACHE_TTL_MS
        });
    };

    const resolveBookingParties = async (bookingId) => {
        if (!bookingId || !redisPool) {
            return { customerId: null, driverId: null };
        }

        const cached = getCachedBookingParties(bookingId);
        if (cached) {
            return cached;
        }

        const redis = redisPool.getConnection();
        const bookingData = await redis.hgetall(`booking:${bookingId}`);
        if (!bookingData || Object.keys(bookingData).length === 0) {
            return { customerId: null, driverId: null };
        }

        const customerId = bookingData.customerId
            || bookingData.customer
            || bookingData.passengerId
            || parseBookingParticipant(bookingData.passenger)
            || parseBookingParticipant(bookingData.customer)
            || null;
        const driverId = bookingData.driverId
            || bookingData.driver
            || parseBookingParticipant(bookingData.driverData)
            || null;

        const value = { customerId, driverId };
        setCachedBookingParties(bookingId, value);
        return value;
    };

    socket.on('updateTripLocation', async (data) => {
        try {
            const {
                bookingId,
                lat,
                lng,
                heading,
                speed,
                accuracy,
                capturedAt,
                seq
            } = data || {};
            const numericLat = Number(lat);
            const numericLng = Number(lng);

            if (!bookingId || !Number.isFinite(numericLat) || !Number.isFinite(numericLng)) {
                // Não emitir erro para não interromper atualizações frequentes
                // Apenas logar em desenvolvimento
                if (process.env.NODE_ENV !== 'production') {
                    logStructured('warn', 'Dados incompletos para atualização de localização da viagem', {
                        service: 'websocket',
                        operation: 'updateLocation',
                        data
                    });
                }
                return;
            }

            // Simular atualização no Redis/Firebase para trip específica
            const tripLocationData = {
                bookingId,
                location: { lat: numericLat, lng: numericLng },
                heading: Number(heading) || 0,
                speed: Number(speed) || 0,
                timestamp: Date.now(),
                lastUpdate: new Date().toISOString()
            };

            const payload = {
                bookingId,
                location: { lat: numericLat, lng: numericLng },
                heading: tripLocationData.heading,
                speed: tripLocationData.speed,
                timestamp: tripLocationData.timestamp
            };

            // Notificar somente participante(s) da corrida.
            const { customerId, driverId } = await resolveBookingParties(bookingId);
            if (customerId) {
                io.to(`customer_${customerId}`).emit('tripLocationUpdated', payload);
            }
            if (driverId && driverId !== socket.userId) {
                io.to(`driver_${driverId}`).emit('tripLocationUpdated', payload);
            }

            const persistenceDriverId = driverId || socket.userId || data?.driverId || null;
            if (persistenceDriverId) {
                void tripLocationPersistenceService.bufferLocationEvent({
                    tripId: bookingId,
                    bookingId,
                    driverId: persistenceDriverId,
                    customerId: customerId || null,
                    lat: numericLat,
                    lng: numericLng,
                    heading: tripLocationData.heading,
                    speed: tripLocationData.speed,
                    accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
                    seq: Number.isFinite(Number(seq)) ? Number(seq) : null,
                    capturedAt: capturedAt || tripLocationData.timestamp,
                    receivedAt: tripLocationData.timestamp,
                    source: 'updateTripLocation'
                }).catch((persistenceError) => {
                    logStructured('warn', 'Falha ao persistir localização da viagem', {
                        service: 'websocket',
                        operation: 'updateLocationPersistence',
                        bookingId,
                        error: persistenceError.message
                    });
                });
            }

            // Log apenas a cada 10 atualizações para não poluir logs
            if (Math.random() < 0.1) {
                if (process.env.NODE_ENV === 'development' || process.env.DEBUG_LOCATION === 'true') {
                    logStructured('debug', 'Localização da viagem atualizada', {
                        service: 'websocket',
                        operation: 'updateLocation',
                        bookingId,
                        lat: numericLat.toFixed(6),
                        lng: numericLng.toFixed(6)
                    });
                }
            }

        } catch (error) {
            logStructured('error', 'Erro ao atualizar localização da viagem', {
                service: 'websocket',
                operation: 'updateLocation',
                bookingId: data.bookingId,
                error: error.message,
                stack: error.stack
            });
            // Não emitir erro para não interromper fluxo de atualizações
        }
    });
}

module.exports = registerSocketUpdateTripLocationHandler;
