const {
    getPaymentAvailabilityLimit,
    getPaymentAvailabilityRadiusKm
} = require('../utils/dispatch-config');

function sanitizeDiagnosticToken(value, fallback = 'none') {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_.:-]+/g, '_')
        .slice(0, 96);
    return normalized || fallback;
}

function roundCoordinateForDiagnostic(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed.toFixed(3) : 'invalid';
}

function buildAvailabilityDiagnosticMessage({
    requestId,
    pickupLocation,
    requestedCarType,
    hasDrivers,
    availability
}) {
    const rejections = availability?.rejections || {};
    const rejectionSummary = Object.entries(rejections)
        .filter(([, count]) => Number(count) > 0)
        .map(([reason, count]) => `${sanitizeDiagnosticToken(reason)}:${Number(count)}`)
        .join(',') || 'none';
    const candidates = availability?.candidates ?? availability?.summary?.candidates ?? 0;
    const eligible = availability?.eligible ?? availability?.summary?.eligible ?? 0;

    return [
        'Pré-check de disponibilidade concluído',
        `requestId=${sanitizeDiagnosticToken(requestId)}`,
        `result=${hasDrivers ? 'available' : 'blocked'}`,
        `carType=${sanitizeDiagnosticToken(requestedCarType, 'default')}`,
        `pickupCell=${roundCoordinateForDiagnostic(pickupLocation?.lat)},${roundCoordinateForDiagnostic(pickupLocation?.lng)}`,
        `candidates=${Number(candidates) || 0}`,
        `eligible=${Number(eligible) || 0}`,
        `rejections=${rejectionSummary}`
    ].join(' ');
}

function registerSocketSearchDriversHandler({
    socket,
    rateLimiterService,
    logStructured,
    findAvailableDriversForPickup,
    checkRideAvailabilityForPickup
}) {
    const emitLegacyNoDriversFoundEvent =
        String(process.env.ENABLE_LEGACY_NO_DRIVERS_FOUND_EVENT || 'false').toLowerCase() === 'true';
    const checkCanonicalPaymentAvailability = checkRideAvailabilityForPickup || (async (pickupLocation, options = {}) => {
        const { hasPaymentEligibleDriver } = require('../services/payment-driver-availability-guard');
        return hasPaymentEligibleDriver({
            pickupLocation,
            destinationLocation: options.destinationLocation || options.destination || null,
            preferences: options.preferences || {},
            carType: options.carType || null,
            radiusKm: options.radiusKm,
            limit: options.limit,
            io: socket?.nsp || socket?.server || null,
            logStructured,
            logContext: {
                service: 'socket-search-drivers-handler',
                eventType: 'checkRideAvailability'
            }
        });
    });

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
                data?.radiusKm || getPaymentAvailabilityRadiusKm()
            );

            const availability = await checkCanonicalPaymentAvailability(pickupLocation, {
                carType: requestedCarType,
                destinationLocation: data?.destinationLocation || data?.destination || null,
                preferences: data?.preferences || {},
                radiusKm: Number.isFinite(requestedRadiusKm) ? requestedRadiusKm : 5,
                limit: Number.parseInt(data?.limit || getPaymentAvailabilityLimit(), 10)
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
                radiusKm,
                candidates: availability.candidates ?? availability.summary?.candidates ?? null,
                eligible: availability.eligible ?? availability.summary?.eligible ?? null,
                rejections: availability.rejections || null,
                estimatedPickupEtaMin: availability.estimatedPickupEtaMin ?? null,
                driverId: availability.driverId || null
            });

            logStructured('info', buildAvailabilityDiagnosticMessage({
                requestId,
                pickupLocation,
                requestedCarType,
                hasDrivers,
                availability
            }), {
                userId,
                eventType: 'checkRideAvailability',
                requestedCarType,
                hasDrivers,
                radiusKm,
                requestId,
                candidates: availability.candidates ?? availability.summary?.candidates ?? null,
                eligible: availability.eligible ?? availability.summary?.eligible ?? null,
                rejections: availability.rejections || null
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

            const radiusFromPreferences = Number.parseFloat(preferences?.radiusKm || preferences?.searchRadiusKm || getPaymentAvailabilityRadiusKm());
            const availability = await findAvailableDriversForPickup(pickupLocation, {
                destinationLocation,
                preferences,
                carType: carType || preferences?.carType || null,
                radiusKm: Number.isFinite(radiusFromPreferences) ? radiusFromPreferences : 5,
                limit: Number.parseInt(preferences?.limit || getPaymentAvailabilityLimit(), 10)
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
