const { resolveActiveTripForDriver } = require('../utils/active-trip-index');

const TERMINAL_BOOKING_STATES = new Set([
    'COMPLETED',
    'CANCELLED',
    'CANCELED',
    'REJECTED',
    'NO_DRIVERS_AVAILABLE',
    'EXPIRED',
    'SUPERSEDED'
]);

function parseJsonSafe(value, fallback = null) {
    if (!value) {
        return fallback;
    }

    if (typeof value === 'object') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch (_error) {
        return fallback;
    }
}

function parseNumericValue(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatus(value) {
    return String(value || '').trim().toUpperCase();
}

function parseBookingParticipant(value) {
    if (!value) {
        return null;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        const parsed = parseJsonSafe(trimmed, null);
        if (parsed && typeof parsed === 'object') {
            return (
                parsed.id ||
                parsed.uid ||
                parsed.userId ||
                parsed.customerId ||
                parsed.driverId ||
                parsed.name ||
                trimmed
            );
        }

        return trimmed;
    }

    if (typeof value === 'object') {
        return (
            value.id ||
            value.uid ||
            value.userId ||
            value.customerId ||
            value.driverId ||
            value.name ||
            null
        );
    }

    return null;
}

function parseBookingLocation(value) {
    const parsed = parseJsonSafe(value, value);
    if (!parsed || typeof parsed !== 'object') {
        return null;
    }

    const lat = Number(
        parsed.lat ??
        parsed.latitude ??
        parsed.location?.lat ??
        parsed.location?.latitude
    );
    const lng = Number(
        parsed.lng ??
        parsed.longitude ??
        parsed.lon ??
        parsed.location?.lng ??
        parsed.location?.longitude ??
        parsed.location?.lon
    );

    const add = String(
        parsed.add ||
        parsed.address ||
        parsed.formattedAddress ||
        parsed.name ||
        parsed.label ||
        ''
    ).trim();

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        if (!add) {
            return null;
        }

        return { add };
    }

    return {
        lat,
        lng,
        ...(add ? { add } : {})
    };
}

function parseActiveExtensionRequest(rawValue) {
    const parsed = parseJsonSafe(rawValue, null);
    return parsed && typeof parsed === 'object' ? parsed : null;
}

async function buildActiveRideSnapshotForUser(redis, userId, userType) {
    if (!redis || !userId || !userType) {
        return {
            hasActiveRide: false,
            bookingId: null
        };
    }

    let bookingId = null;
    let snapshotSource = 'active_trip';

    if (userType === 'driver') {
        const indexedTrip = await resolveActiveTripForDriver(redis, userId).catch(() => null);
        bookingId = indexedTrip?.tripId || null;

        if (!bookingId) {
            const driverState = await redis.hgetall(`driver:${userId}`);
            bookingId = driverState?.activeTripId || null;
        }

        if (!bookingId) {
            bookingId = await redis.get(`driver_active_notification:${userId}`);
            if (bookingId) {
                snapshotSource = 'pending_notification';
            }
        }
    } else if (userType === 'customer' || userType === 'passenger') {
        bookingId = await redis.get(`customer_active_booking:${userId}`);
    }

    if (!bookingId) {
        return {
            hasActiveRide: false,
            bookingId: null
        };
    }

    const bookingData = await redis.hgetall(`booking:${bookingId}`);
    if (!bookingData || Object.keys(bookingData).length === 0) {
        return {
            hasActiveRide: false,
            bookingId,
            stale: true
        };
    }

    const status = normalizeStatus(
        bookingData.status ||
        bookingData.state ||
        bookingData.tripStatus
    );
    const hasActiveRide = !TERMINAL_BOOKING_STATES.has(status);
    const passengerName = bookingData.customerName ||
        bookingData.passengerName ||
        parseBookingParticipant(bookingData.passenger) ||
        null;
    const driverName = bookingData.driverName ||
        parseBookingParticipant(bookingData.driverData) ||
        null;

    return {
        hasActiveRide,
        source: snapshotSource,
        bookingId,
        status: status || 'UNKNOWN',
        customerId:
            bookingData.customerId ||
            bookingData.customer ||
            bookingData.passengerId ||
            parseBookingParticipant(bookingData.passenger) ||
            null,
        customerName: passengerName,
        passengerName,
        driverId:
            bookingData.driverId ||
            bookingData.driver ||
            parseBookingParticipant(bookingData.driverData) ||
            null,
        driverName,
        pickupLocation: parseBookingLocation(bookingData.pickupLocation || bookingData.pickup),
        destinationLocation: parseBookingLocation(bookingData.destinationLocation || bookingData.drop),
        estimatedFare: parseNumericValue(bookingData.estimatedFare || bookingData.estimate),
        finalFare: parseNumericValue(bookingData.finalFare || bookingData.fare),
        operationalFee: parseNumericValue(bookingData.operationalFee),
        paymentIntermediationFee: parseNumericValue(bookingData.paymentIntermediationFee),
        totalFees: parseNumericValue(bookingData.totalFees),
        driverNetAmount: parseNumericValue(bookingData.driverNetAmount),
        estimatedOperationalFee: parseNumericValue(bookingData.estimatedOperationalFee),
        estimatedPaymentIntermediationFee: parseNumericValue(bookingData.estimatedPaymentIntermediationFee),
        estimatedTotalFees: parseNumericValue(bookingData.estimatedTotalFees),
        estimatedDriverNetAmount: parseNumericValue(bookingData.estimatedDriverNetAmount),
        pricingSnapshotLocked:
            String(bookingData.pricingSnapshotLocked || '').trim().toLowerCase() === 'true'
            || bookingData.pricingSnapshotLocked === true,
        pricingSnapshotLockedAt: bookingData.pricingSnapshotLockedAt || null,
        vehicleCategory: bookingData.carType || bookingData.vehicleType || null,
        paymentStatus: bookingData.paymentStatus || bookingData.payment_status || null,
        activeExtensionRequest: parseActiveExtensionRequest(bookingData.activeExtensionRequest),
        extensionPaymentStatus: bookingData.extensionPaymentStatus || null,
        extensionChargeId: bookingData.extensionChargeId || null,
        boardingDeadlineAt: bookingData.boardingDeadlineAt || null,
        boardingWindowSec: parseNumericValue(bookingData.boardingWindowSec),
        driverArrivedAt: bookingData.driverArrivedAt || null,
        startedAt: bookingData.startedAt || null,
        acceptedAt: bookingData.acceptedAt || null,
        updatedAt: bookingData.updatedAt || bookingData.timestamp || null
    };
}

module.exports = {
    buildActiveRideSnapshotForUser
};
