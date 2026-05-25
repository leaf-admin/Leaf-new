function registerSocketSearchDriversHandler({
    socket,
    rateLimiterService,
    logStructured,
    findAvailableDriversForPickup
}) {
    const emitLegacyNoDriversFoundEvent =
        String(process.env.ENABLE_LEGACY_NO_DRIVERS_FOUND_EVENT || 'false').toLowerCase() === 'true';

    socket.on('checkRideAvailability', async (data = {}) => {
        const userId = socket.userId || data.customerId || socket.id;
        const requestId = String(data?.requestId || '').trim();

        try {
            const pickupLocation = data?.pickupLocation || {
                lat: data?.lat,
                lng: data?.lng
            };
            const requestedCarType = data?.carType || data?.vehicle || null;
            const requestedRadiusKm = Number.parseFloat(
                data?.radiusKm || process.env.PAYMENT_AVAILABILITY_RADIUS_KM || '5'
            );

            const availability = await findAvailableDriversForPickup(pickupLocation, {
                carType: requestedCarType,
                destinationLocation: data?.destinationLocation || data?.destination || null,
                preferences: data?.preferences || {},
                radiusKm: Number.isFinite(requestedRadiusKm) ? requestedRadiusKm : 5,
                limit: Number.parseInt(data?.limit || process.env.PAYMENT_AVAILABILITY_LIMIT || '12', 10)
            });

            if (!availability?.success) {
                socket.emit('rideAvailabilityError', {
                    success: false,
                    requestId,
                    code: 'AVAILABILITY_CHECK_FAILED',
                    error: 'Não foi possível validar disponibilidade agora.',
                    message: 'Não foi possível validar disponibilidade agora.'
                });
                return;
            }

            const hasDrivers = Array.isArray(availability.drivers)
                ? availability.drivers.length > 0
                : Boolean(availability.hasDrivers);
            const radiusKm = availability.radiusKm || availability.summary?.radiusKm || requestedRadiusKm;

            socket.emit('rideAvailabilityResult', {
                success: true,
                requestId,
                available: hasDrivers,
                hasDrivers,
                code: hasDrivers ? 'DRIVERS_AVAILABLE' : 'NO_DRIVERS_AVAILABLE',
                message: hasDrivers
                    ? 'Há motoristas disponíveis para esta corrida.'
                    : 'Não há motoristas disponíveis',
                carType: requestedCarType,
                radiusKm
            });

            logStructured('info', 'Pré-check de disponibilidade concluído', {
                userId,
                eventType: 'checkRideAvailability',
                requestedCarType,
                hasDrivers,
                radiusKm
            });
        } catch (availabilityError) {
            logStructured('warn', 'Erro no pré-check de disponibilidade', {
                userId,
                eventType: 'checkRideAvailability',
                error: availabilityError.message
            });

            socket.emit('rideAvailabilityError', {
                success: false,
                requestId,
                code: 'AVAILABILITY_CHECK_ERROR',
                error: 'Não foi possível validar disponibilidade agora.',
                message: 'Não foi possível validar disponibilidade agora.'
            });
        }
    });

    socket.on('searchDrivers', async (data) => {
        try {
            // ✅ NOVO: Rate Limiting
            const userId = socket.userId || data.customerId || socket.id;
            const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'searchDrivers');

            if (!rateLimitCheck.allowed) {
                socket.emit('searchDriversError', {
                    error: 'Muitas requisições',
                    message: `Você excedeu o limite de ${rateLimitCheck.limit} buscas por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                    code: 'RATE_LIMIT_EXCEEDED',
                    limit: rateLimitCheck.limit,
                    remaining: rateLimitCheck.remaining,
                    resetAt: rateLimitCheck.resetAt
                });
                logStructured('warn', 'searchDrivers bloqueado por rate limit', {
                    service: 'server',
                    userId,
                    limit: rateLimitCheck.limit,
                    remaining: rateLimitCheck.remaining,
                    resetAt: rateLimitCheck.resetAt,
                    eventType: 'searchDrivers',
                    action: 'rate_limit_exceeded'
                });
                return;
            }

            logStructured('info', 'Busca de motoristas iniciada', {
                service: 'server',
                userId: socket.userId || socket.id,
                pickupLocation: data?.pickupLocation,
                destinationLocation: data?.destinationLocation,
                rideType: data?.rideType,
                eventType: 'searchDrivers'
            });

            const { pickupLocation, destinationLocation, rideType, estimatedFare, preferences, carType } = data;

            if (!pickupLocation) {
                socket.emit('driverSearchError', { error: 'Localização de origem obrigatória' });
                return;
            }

            const radiusFromPreferences = Number.parseFloat(preferences?.radiusKm || preferences?.searchRadiusKm || process.env.PAYMENT_AVAILABILITY_RADIUS_KM || '5');
            const availability = await findAvailableDriversForPickup(pickupLocation, {
                destinationLocation,
                preferences,
                carType: carType || preferences?.carType || null,
                radiusKm: Number.isFinite(radiusFromPreferences) ? radiusFromPreferences : 5,
                limit: Number.parseInt(preferences?.limit || '10', 10)
            });

            if (!availability.success) {
                socket.emit('searchDriversError', {
                    error: 'Falha ao buscar motoristas disponíveis',
                    message: 'Não foi possível consultar disponibilidade no momento',
                    code: 'DRIVER_AVAILABILITY_FAILED'
                });
                return;
            }

            const drivers = availability.drivers || [];
            const estimatedWaitTime = drivers.length > 0
                ? Math.min(...drivers.map((driver) => driver.estimatedArrivalMin || 3))
                : null;

            const payload = {
                success: true,
                drivers,
                estimatedWaitTime,
                searchRadius: (availability.summary?.radiusKm || radiusFromPreferences) * 1000,
                fare: estimatedFare || null,
                message: drivers.length > 0
                    ? `${drivers.length} motoristas encontrados`
                    : 'Não há motoristas disponíveis no momento',
                summary: availability.summary || null
            };

            // Emitir resultado principal
            socket.emit('driversFound', payload);

            // Compatibilidade com listeners legados
            if (emitLegacyNoDriversFoundEvent && drivers.length === 0) {
                socket.emit('noDriversFound', {
                    success: true,
                    message: payload.message,
                    searchRadius: payload.searchRadius
                });
            }

            logStructured('info', 'Motoristas encontrados para busca', {
                service: 'server',
                userId: socket.userId || socket.id,
                driversFound: drivers.length,
                eventType: 'searchDrivers'
            });

        } catch (error) {
            logStructured('error', 'Erro na busca de motoristas', {
                service: 'server',
                userId: socket.userId || socket.id,
                error: error.message,
                stack: error.stack,
                eventType: 'searchDrivers'
            });
            socket.emit('driverSearchError', { error: 'Erro interno do servidor' });
        }
    });
}

module.exports = registerSocketSearchDriversHandler;
