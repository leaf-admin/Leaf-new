const {
    buildCanonicalCreateBookingIdempotencyKey,
    normalizeCreateBookingPaymentReference,
    buildRouteSignature
} = require('../../../services/create-booking-idempotency-service');

describe('create-booking-idempotency-service', () => {
    it('prefers a canonical payment reference when present', () => {
        const key = buildCanonicalCreateBookingIdempotencyKey({
            userId: 'customer_123',
            data: {
                paymentId: 'charge_abc123',
                idempotencyKey: 'mobile_customer_123_request_xyz'
            },
            fallbackIdempotencyKey: 'mobile_customer_123_request_xyz'
        });

        expect(key).toBe('customer_123:createBooking:payment:charge_abc123');
    });

    it('falls back to the provided idempotency key when no payment reference exists', () => {
        const key = buildCanonicalCreateBookingIdempotencyKey({
            userId: 'customer_123',
            data: {
                idempotencyKey: 'mobile_customer_123_request_xyz'
            },
            fallbackIdempotencyKey: 'mobile_customer_123_request_xyz'
        });

        expect(key).toBe('mobile_customer_123_request_xyz');
    });

    it('normalizes payment references from nested paymentData', () => {
        expect(
            normalizeCreateBookingPaymentReference({
                paymentData: {
                    chargeId: 'charge_nested_456'
                }
            })
        ).toBe('charge_nested_456');
    });

    it('falls back to a deterministic route signature when no payment reference exists', () => {
        const key = buildCanonicalCreateBookingIdempotencyKey({
            userId: 'customer_123',
            data: {
                pickupLocation: { lat: -23.55052, lng: -46.63331 },
                destinationLocation: { lat: -23.56311, lng: -46.65449 },
                paymentMethod: 'pix'
            }
        });

        expect(key).toBe(
            'customer_123:createBooking:route:-23.55052:-46.63331:-23.56311:-46.65449:pix'
        );
    });

    it('falls back to unknown when no payment reference, coords, or fallback key exists', () => {
        const key = buildCanonicalCreateBookingIdempotencyKey({
            userId: 'customer_123',
            data: {}
        });

        expect(key).toBe('customer_123:createBooking:unknown');
    });

    it('uses the fallback idempotency key when no payment reference and no valid route signature exists', () => {
        const key = buildCanonicalCreateBookingIdempotencyKey({
            userId: 'customer_123',
            data: {
                pickupLocation: { lat: -23.55052 },
                destinationLocation: { lng: -46.65449 }
            },
            fallbackIdempotencyKey: 'fallback_key_abc'
        });

        expect(key).toBe('fallback_key_abc');
    });

    it('exports buildRouteSignature for partial route scenarios', () => {
        expect(buildRouteSignature({
            pickupLocation: { lat: -23.55052, lng: -46.63331 },
            destinationLocation: { lat: -23.56311, lng: -46.65449 },
            paymentMethod: 'pix'
        })).toBe('route:-23.55052:-46.63331:-23.56311:-46.65449:pix');

        expect(buildRouteSignature({
            pickupLocation: { lat: -23.55052 }
        })).toBe('');

        expect(buildRouteSignature({})).toBe('');
    });

    it('uses anonymous prefix when no userId is provided', () => {
        const key = buildCanonicalCreateBookingIdempotencyKey({
            data: {
                pickupLocation: { lat: -23.55052, lng: -46.63331 },
                destinationLocation: { lat: -23.56311, lng: -46.65449 },
                paymentMethod: 'pix'
            }
        });

        expect(key).toBe('anonymous:createBooking:route:-23.55052:-46.63331:-23.56311:-46.65449:pix');
    });

    it('deduplicates by chargeId via paymentData.chargeId', () => {
        const key = buildCanonicalCreateBookingIdempotencyKey({
            userId: 'customer_456',
            data: {
                paymentData: {
                    chargeId: 'charge_dedup_789'
                }
            },
            fallbackIdempotencyKey: 'fallback_xyz'
        });

        expect(key).toBe('customer_456:createBooking:payment:charge_dedup_789');
    });
});
