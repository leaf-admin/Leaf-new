function registerSocketDriverControlHandlers({
    socket,
    io,
    redisPool,
    logStructured
}) {
    const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';

    socket.on('arriveAtPickup', async (data = {}) => {
        try {
            const rideId = data.rideId || data.bookingId || null;
            const location = data.location || null;

            socket.emit('arrivedAtPickup', {
                success: true,
                rideId,
                bookingId: rideId,
                location,
                timestamp: new Date().toISOString()
            });

            if (!rideId) return;

            const redis = redisPool.getConnection();
            const bookingData = await redis.hgetall(`booking:${rideId}`);
            const customerId = bookingData?.customerId || bookingData?.customer || bookingData?.passengerId || null;

            if (customerId) {
                io.to(`customer_${customerId}`).emit('arrivedAtPickup', {
                    success: true,
                    rideId,
                    bookingId: rideId,
                    location,
                    driverId: socket.userId || null,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            socket.emit('arrivedAtPickup', {
                success: false,
                error: error.message || 'Erro ao processar chegada no pickup'
            });
        }
    });

    socket.on('setDriverStatus', async (data = {}) => {
        try {
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
                await redis.zrem('driver_locations', driverId);
                await redis.srem('online_drivers', driverId);
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
                    await redis.geoadd('driver_locations', lng, lat, driverId);
                    await redis.sadd('online_drivers', driverId);
                }
            }

            socket.emit('driverStatusUpdated', {
                success: true,
                driverId,
                status,
                isOnline,
                dispatchEligible: isOnline && existingIsEligible,
                checkedAt: new Date().toISOString()
            });
        } catch (error) {
            logStructured('warn', 'Falha ao processar setDriverStatus', {
                service: 'driver-control-handlers',
                driverId: data.driverId || socket.userId || null,
                error: error.message
            });

            socket.emit('driverStatusError', {
                error: error.message || 'Erro ao atualizar status do motorista',
                code: 'DRIVER_STATUS_UPDATE_FAILED'
            });
        }
    });
}

module.exports = registerSocketDriverControlHandlers;
