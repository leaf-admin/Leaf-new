const {
  performCreateBookingAvailabilityPrecheck
} = require('../../../services/create-booking-availability-precheck');

describe('create-booking-availability-precheck', () => {
  it('skips when payment is not confirmed', async () => {
    const checkAvailability = jest.fn();
    const logStructured = jest.fn();

    const result = await performCreateBookingAvailabilityPrecheck({
      hasConfirmedPayment: false,
      pickupLocation: { lat: 1, lng: 2 },
      requestedCarType: 'leaf_plus',
      checkAvailability,
      logStructured
    });

    expect(result).toEqual({
      skipped: true,
      reason: 'payment_not_confirmed'
    });
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(logStructured).not.toHaveBeenCalled();
  });

  it('returns failure when availability check fails', async () => {
    const checkAvailability = jest.fn().mockResolvedValue({
      success: false
    });
    const logStructured = jest.fn();

    const result = await performCreateBookingAvailabilityPrecheck({
      hasConfirmedPayment: true,
      pickupLocation: { lat: 1, lng: 2 },
      requestedCarType: 'leaf_plus',
      checkAvailability,
      logStructured,
      logContext: { userId: 'customer_1', eventType: 'createBooking' }
    });

    expect(result).toMatchObject({
      skipped: false,
      success: false,
      code: 'AVAILABILITY_CHECK_FAILED',
      hasDrivers: false
    });
    expect(checkAvailability).toHaveBeenCalledWith(
      { lat: 1, lng: 2 },
      {
        carType: 'leaf_plus',
        destinationLocation: undefined,
        preferences: {}
      }
    );
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'createBooking: validação de disponibilidade falhou',
      expect.objectContaining({
        userId: 'customer_1',
        eventType: 'createBooking',
        code: 'AVAILABILITY_CHECK_FAILED'
      })
    );
  });

  it('returns no drivers when the requested category is unavailable', async () => {
    const checkAvailability = jest.fn().mockResolvedValue({
      success: true,
      hasDrivers: false
    });
    const logStructured = jest.fn();

    const result = await performCreateBookingAvailabilityPrecheck({
      hasConfirmedPayment: true,
      pickupLocation: { lat: 1, lng: 2 },
      requestedCarType: 'leaf_plus',
      checkAvailability,
      logStructured,
      logContext: { customerId: 'customer_1', eventType: 'createBooking' }
    });

    expect(result).toMatchObject({
      skipped: false,
      success: true,
      code: 'NO_DRIVERS_AVAILABLE',
      hasDrivers: false
    });
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'createBooking: sem motoristas no pre-check',
      expect.objectContaining({
        customerId: 'customer_1',
        eventType: 'createBooking',
        code: 'NO_DRIVERS_AVAILABLE'
      })
    );
  });

  it('treats drivers arrays as availability success', async () => {
    const checkAvailability = jest.fn().mockResolvedValue({
      success: true,
      drivers: [{ id: 'driver_1' }]
    });
    const logStructured = jest.fn();

    const result = await performCreateBookingAvailabilityPrecheck({
      hasConfirmedPayment: true,
      pickupLocation: { lat: 1, lng: 2 },
      requestedCarType: 'leaf_plus',
      checkAvailability,
      logStructured
    });

    expect(result).toMatchObject({
      skipped: false,
      success: true,
      code: 'DRIVERS_AVAILABLE',
      hasDrivers: true
    });
    expect(logStructured).not.toHaveBeenCalled();
  });

  it('passes ride preferences and destination to the availability checker', async () => {
    const checkAvailability = jest.fn().mockResolvedValue({
      success: true,
      drivers: [{ id: 'driver_female_1' }]
    });

    const result = await performCreateBookingAvailabilityPrecheck({
      hasConfirmedPayment: true,
      pickupLocation: { lat: -22.97, lng: -43.18 },
      destinationLocation: { lat: -22.91, lng: -43.16 },
      preferences: { leafDelas: true },
      requestedCarType: 'leaf_plus',
      checkAvailability
    });

    expect(result).toMatchObject({
      skipped: false,
      success: true,
      code: 'DRIVERS_AVAILABLE',
      hasDrivers: true
    });
    expect(checkAvailability).toHaveBeenCalledWith(
      { lat: -22.97, lng: -43.18 },
      {
        carType: 'leaf_plus',
        destinationLocation: { lat: -22.91, lng: -43.16 },
        preferences: { leafDelas: true }
      }
    );
  });
});
