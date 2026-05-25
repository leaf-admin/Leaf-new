const {
    buildCanonicalCreateBookingIdempotencyKey,
    normalizeCreateBookingPaymentReference
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
});
