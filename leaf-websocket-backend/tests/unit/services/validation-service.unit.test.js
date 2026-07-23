const validationService = require('../../../services/validation-service');

describe('validation-service', () => {
  it('preserves pickup and destination labels when sanitizing coordinate payloads', () => {
    const result = validationService.validateEndpoint('createBooking', {
      customerId: 'customer_1',
      pickupLocation: {
        lat: -23.5505,
        lng: -46.6333,
        add: '1540 Mission St, San Francisco',
      },
      destinationLocation: {
        lat: -23.5441,
        lng: -46.6352,
        address: 'Ferry Building, San Francisco',
        name: 'Ferry Building',
      },
      estimatedFare: 13.42,
      paymentMethod: 'pix',
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized.pickupLocation).toEqual(
      expect.objectContaining({
        lat: -23.5505,
        lng: -46.6333,
        add: '1540 Mission St, San Francisco',
      })
    );
    expect(result.sanitized.destinationLocation).toEqual(
      expect.objectContaining({
        lat: -23.5441,
        lng: -46.6352,
        address: 'Ferry Building, San Francisco',
        name: 'Ferry Building',
      })
    );
  });

  it('preserves address slashes while removing and escaping HTML payloads', () => {
    const result = validationService.validateEndpoint('createBooking', {
      customerId: 'customer_1',
      pickupLocation: {
        lat: -22.97045,
        lng: -43.18276,
        address: 'Av. Atlântica, s/n <img src=x onerror=alert(1)> & Copacabana',
      },
      destinationLocation: {
        lat: -22.9068,
        lng: -43.1729,
        name: 'Terminal / Sul <script>alert("xss")</script>',
      },
      paymentMethod: 'pix',
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized.pickupLocation.address).toBe(
      'Av. Atlântica, s/n  &amp; Copacabana'
    );
    expect(result.sanitized.destinationLocation.name).toBe(
      'Terminal / Sul alert(&quot;xss&quot;)'
    );
    expect(result.sanitized.pickupLocation.address).not.toContain('<');
    expect(result.sanitized.pickupLocation.address).not.toContain('onerror');
    expect(result.sanitized.destinationLocation.name).not.toContain('<script>');
  });

  it('accepts embedded payment metadata on createBooking for payment-first flows', () => {
    const result = validationService.validateEndpoint('createBooking', {
      customerId: 'customer_1',
      pickupLocation: {
        lat: -23.5505,
        lng: -46.6333,
      },
      destinationLocation: {
        lat: -23.5441,
        lng: -46.6352,
      },
      estimatedFare: 13.42,
      paymentMethod: 'pix',
      paymentStatus: 'confirmed',
      paymentId: 'charge_123',
      paymentData: {
        chargeId: 'charge_123',
        rideId: 'ride_123',
        amountInCents: 1342,
        paymentStatus: 'confirmed',
        confirmedAt: '2026-04-07T23:59:00.000Z',
      },
    });

    expect(result.valid).toBe(true);
    expect(result.sanitized.paymentStatus).toBe('confirmed');
    expect(result.sanitized.paymentId).toBe('charge_123');
    expect(result.sanitized.paymentData).toEqual(
      expect.objectContaining({
        chargeId: 'charge_123',
        rideId: 'ride_123',
        amountInCents: 1342,
        paymentStatus: 'confirmed',
        confirmedAt: '2026-04-07T23:59:00.000Z',
      })
    );
  });
});
