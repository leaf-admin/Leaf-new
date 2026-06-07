function parseObject(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
        return {};
    }
}

function firstText(...values) {
    for (const value of values) {
        if (value === null || typeof value === 'undefined') continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function firstNumberText(...values) {
    for (const value of values) {
        if (value === null || typeof value === 'undefined' || value === '') continue;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return String(Math.max(0, Math.round(numeric)));
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function normalizeStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'cancelled') return 'canceled';
    if (normalized === 'in_progress' || normalized === 'trip_started') return 'started';
    return normalized;
}

function normalizeLocation(location, fallbackAddress = '') {
    const parsed = parseObject(location);
    const address = firstText(
        parsed.address,
        parsed.add,
        parsed.formattedAddress,
        parsed.description,
        parsed.name,
        fallbackAddress
    );

    return {
        ...parsed,
        ...(address ? { address } : {})
    };
}

function resolvePassengerId(bookingData = {}, explicitPassengerId = null) {
    const passenger = parseObject(bookingData.passenger || bookingData.customer);
    return firstText(
        explicitPassengerId,
        bookingData.customerId,
        bookingData.customer,
        bookingData.passengerId,
        passenger.uid,
        passenger.id
    );
}

function resolveDriverId(bookingData = {}, explicitDriverId = null) {
    const driver = parseObject(bookingData.driver);
    return firstText(
        explicitDriverId,
        bookingData.driverId,
        bookingData.ownerDriverId,
        driver.uid,
        driver.id
    );
}

function buildRideStatusPayload({
    bookingId,
    status,
    bookingData = {},
    overrides = {}
} = {}) {
    const normalizedStatus = normalizeStatus(status || bookingData.status || overrides.status);
    const pickup = normalizeLocation(
        overrides.pickup ||
        overrides.pickupLocation ||
        bookingData.pickupLocation ||
        bookingData.pickup,
        firstText(bookingData.pickupAddress, 'Local de embarque')
    );
    const destination = normalizeLocation(
        overrides.destination ||
        overrides.destinationLocation ||
        bookingData.destinationLocation ||
        bookingData.destination ||
        bookingData.drop,
        firstText(bookingData.destinationAddress, 'Destino')
    );

    const pickupEstimatedTime = firstNumberText(
        overrides.pickupEstimatedTime,
        overrides.pickupEtaMinutes,
        overrides.estimatedPickupTime,
        bookingData.pickupEstimatedTime,
        bookingData.pickupEtaMinutes,
        bookingData.estimatedPickupTime,
        bookingData.estimatedArrivalToPickupMin,
        bookingData.arrivalToPickupMin
    );
    const tripEstimatedTime = firstNumberText(
        overrides.tripEstimatedTime,
        overrides.tripEtaMinutes,
        overrides.estimatedTripTime,
        overrides.estimatedTime,
        bookingData.tripEstimatedTime,
        bookingData.tripEstimatedMinutes,
        bookingData.estimatedTripTime,
        bookingData.estimatedDuration,
        bookingData.duration,
        bookingData.estimatedTime
    );
    const estimatedTime = firstNumberText(
        overrides.estimatedTime,
        normalizedStatus === 'accepted' || normalizedStatus === 'arrived' ? pickupEstimatedTime : tripEstimatedTime,
        bookingData.estimatedTime
    );

    return {
        bookingId: firstText(bookingId, overrides.bookingId, bookingData.bookingId, bookingData.rideId),
        status: normalizedStatus,
        pickup,
        destination,
        estimatedTime,
        pickupEstimatedTime,
        tripEstimatedTime,
        distance: firstText(
            overrides.distance,
            bookingData.distance,
            bookingData.estimatedDistance,
            bookingData.driverDistanceToPickupKm,
            bookingData.pickupArrivalDistanceMeters
        ),
        fare: firstText(
            overrides.fare,
            bookingData.finalFare,
            bookingData.estimatedFare,
            bookingData.fare,
            bookingData.totalAmount,
            bookingData.amount
        ),
        phaseStartedAt: firstText(
            overrides.phaseStartedAt,
            overrides.acceptedAt,
            overrides.arrivedAt,
            overrides.startedAt,
            bookingData.phaseStartedAt,
            bookingData.acceptedAt,
            bookingData.driverAcceptedAt,
            bookingData.arrivalRegisteredAt,
            bookingData.startedAt,
            bookingData.tripStartedAt
        ),
        driverName: firstText(
            overrides.driverName,
            bookingData.driverName,
            bookingData.driverDisplayName,
            parseObject(bookingData.driver).name
        ),
        customerName: firstText(
            overrides.customerName,
            bookingData.customerName,
            bookingData.passengerName,
            parseObject(bookingData.passenger).name,
            parseObject(bookingData.customer).name
        ),
        vehicleModel: firstText(
            overrides.vehicleModel,
            overrides.driverVehicleModel,
            bookingData.vehicleModel,
            bookingData.driverVehicleModel,
            bookingData.carModel,
            parseObject(bookingData.vehicle).model,
            parseObject(parseObject(bookingData.driver).vehicle).model
        ),
        vehiclePlate: firstText(
            overrides.vehiclePlate,
            overrides.driverVehiclePlate,
            bookingData.vehiclePlate,
            bookingData.driverVehiclePlate,
            bookingData.vehicleNumber,
            bookingData.carPlate,
            parseObject(bookingData.vehicle).plate,
            parseObject(parseObject(bookingData.driver).vehicle).plate
        ),
        vehicleColor: firstText(
            overrides.vehicleColor,
            overrides.driverVehicleColor,
            bookingData.vehicleColor,
            bookingData.driverVehicleColor,
            parseObject(bookingData.vehicle).color,
            parseObject(parseObject(bookingData.driver).vehicle).color
        ),
        timestamp: firstText(overrides.timestamp, bookingData.updatedAt, new Date().toISOString())
    };
}

async function ensureFcmReady(fcmService, redis) {
    if (!fcmService || typeof fcmService.sendRideStatusUpdate !== 'function') {
        return false;
    }

    if (redis && typeof fcmService.setRedis === 'function') {
        fcmService.setRedis(redis);
    }

    if (typeof fcmService.isServiceAvailable === 'function' && !fcmService.isServiceAvailable()) {
        if (typeof fcmService.initialize === 'function') {
            await fcmService.initialize();
        }
    }

    if (typeof fcmService.isServiceAvailable === 'function') {
        return fcmService.isServiceAvailable();
    }

    return true;
}

async function dispatchRideStatusUpdate({
    fcmService,
    redis = null,
    bookingId,
    status,
    passengerId = null,
    driverId = null,
    bookingData = {},
    passengerPayload = {},
    driverPayload = {},
    logStructured = null
} = {}) {
    const payload = buildRideStatusPayload({
        bookingId,
        status,
        bookingData,
        overrides: {
            ...passengerPayload,
            ...driverPayload
        }
    });
    const resolvedPassengerId = resolvePassengerId(bookingData, passengerId);
    const resolvedDriverId = resolveDriverId(bookingData, driverId);
    const recipients = [
        resolvedPassengerId
            ? {
                userId: resolvedPassengerId,
                userType: 'customer',
                payload: {
                    ...payload,
                    ...passengerPayload,
                    userType: 'customer'
                }
            }
            : null,
        resolvedDriverId
            ? {
                userId: resolvedDriverId,
                userType: 'driver',
                payload: {
                    ...payload,
                    ...driverPayload,
                    userType: 'driver'
                }
            }
            : null
    ].filter(Boolean);

    if (!recipients.length) {
        return {
            success: false,
            status: 'skipped',
            reason: 'no_recipients',
            bookingId: payload.bookingId,
            rideStatus: payload.status
        };
    }

    const fcmReady = await ensureFcmReady(fcmService, redis);
    if (!fcmReady) {
        return {
            success: false,
            status: 'skipped',
            reason: 'fcm_unavailable',
            bookingId: payload.bookingId,
            rideStatus: payload.status,
            recipients: recipients.map(({ userId, userType }) => ({ userId, userType }))
        };
    }

    const results = [];
    for (const recipient of recipients) {
        try {
            const result = await fcmService.sendRideStatusUpdate(recipient.userId, recipient.payload);
            results.push({
                userId: recipient.userId,
                userType: recipient.userType,
                success: Boolean(result?.success),
                result
            });
        } catch (error) {
            results.push({
                userId: recipient.userId,
                userType: recipient.userType,
                success: false,
                error: error?.message || String(error)
            });
        }
    }

    const successCount = results.filter((result) => result.success).length;
    if (typeof logStructured === 'function') {
        logStructured(successCount > 0 ? 'info' : 'warn', 'ride status persistent notification dispatched', {
            service: 'ride-notification-lifecycle-orchestrator',
            bookingId: payload.bookingId,
            status: payload.status,
            successCount,
            total: results.length
        });
    }

    return {
        success: successCount > 0,
        status: successCount > 0 ? 'sent' : 'failed',
        bookingId: payload.bookingId,
        rideStatus: payload.status,
        results
    };
}

module.exports = {
    buildRideStatusPayload,
    dispatchRideStatusUpdate,
    normalizeStatus,
    parseObject,
    resolveDriverId,
    resolvePassengerId
};
