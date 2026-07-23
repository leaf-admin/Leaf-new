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

  it('fails closed when confirmed payment has no pickup coordinates', async () => {
    const checkAvailability = jest.fn();
    const logStructured = jest.fn();

    const result = await performCreateBookingAvailabilityPrecheck({
      hasConfirmedPayment: true,
      pickupLocation: null,
      requestedCarType: 'leaf_plus',
      checkAvailability,
      logStructured,
      logContext: { userId: 'customer_1', eventType: 'createBooking' }
    });

    expect(result).toMatchObject({
      skipped: false,
      success: false,
      code: 'PICKUP_LOCATION_REQUIRED',
      hasDrivers: false
    });
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'createBooking: pickup inválido no pre-check de disponibilidade',
      expect.objectContaining({
        userId: 'customer_1',
        eventType: 'createBooking',
        code: 'PICKUP_LOCATION_REQUIRED'
      })
    );
  });

  it('fails closed when confirmed payment cannot run the availability checker', async () => {
    const logStructured = jest.fn();

    const result = await performCreateBookingAvailabilityPrecheck({
      hasConfirmedPayment: true,
      pickupLocation: { lat: 1, lng: 2 },
      requestedCarType: 'leaf_plus',
      checkAvailability: null,
      logStructured,
      logContext: { userId: 'customer_1', eventType: 'createBooking' }
    });

    expect(result).toMatchObject({
      skipped: false,
      success: false,
      code: 'AVAILABILITY_CHECKER_MISSING',
      hasDrivers: false
    });
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'createBooking: checker de disponibilidade ausente',
      expect.objectContaining({
        userId: 'customer_1',
        eventType: 'createBooking',
        code: 'AVAILABILITY_CHECKER_MISSING'
      })
    );
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

  it('uses the provided operation label in guard logs', async () => {
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
      operationLabel: 'confirmPayment',
      logContext: { customerId: 'customer_1', eventType: 'confirmPayment' }
    });

    expect(result).toMatchObject({
      skipped: false,
      success: true,
      code: 'NO_DRIVERS_AVAILABLE',
      hasDrivers: false
    });
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'confirmPayment: sem motoristas no pre-check',
      expect.objectContaining({
        customerId: 'customer_1',
        eventType: 'confirmPayment',
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
