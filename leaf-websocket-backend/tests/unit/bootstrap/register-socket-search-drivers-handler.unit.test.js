const registerSocketSearchDriversHandler = require('../../../bootstrap/register-socket-search-drivers-handler');

function buildHarness({ findAvailableDriversForPickup, checkRideAvailabilityForPickup } = {}) {
  const listeners = {};
  const socket = {
    id: 'socket-1',
    userId: 'customer-1',
    on: jest.fn((event, handler) => {
      listeners[event] = handler;
    }),
    emit: jest.fn()
  };
  const rateLimiterService = {
    checkRateLimit: jest.fn().mockResolvedValue({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: Date.now() + 60000
    })
  };
  const logStructured = jest.fn();

  registerSocketSearchDriversHandler({
    socket,
    rateLimiterService,
    logStructured,
    findAvailableDriversForPickup: findAvailableDriversForPickup || jest.fn().mockResolvedValue({
      success: true,
      drivers: [],
      summary: { radiusKm: 5, candidates: 0, eligible: 0 }
    }),
    checkRideAvailabilityForPickup: checkRideAvailabilityForPickup || jest.fn().mockResolvedValue({
      success: true,
      hasDrivers: false,
      radiusKm: 5,
      candidates: 0,
      eligible: 0,
      rejections: {}
    })
  });

  return {
    listeners,
    socket,
    rateLimiterService,
    logStructured
  };
}

describe('registerSocketSearchDriversHandler availability parity', () => {
  it('registers checkRideAvailability and emits the same success contract used by the VPS runtime', async () => {
    const findAvailableDriversForPickup = jest.fn();
    const checkRideAvailabilityForPickup = jest.fn().mockResolvedValue({
      success: true,
      hasDrivers: true,
      radiusKm: 4,
      candidates: 2,
      eligible: 1,
      rejections: { locked: 1 }
    });
    const { listeners, socket, logStructured } = buildHarness({
      findAvailableDriversForPickup,
      checkRideAvailabilityForPickup
    });

    await listeners.checkRideAvailability({
      requestId: 'req-1',
      pickupLocation: { lat: -22.97, lng: -43.18 },
      destinationLocation: { lat: -22.98, lng: -43.21 },
      carType: 'plus',
      radiusKm: 4
    });

    expect(checkRideAvailabilityForPickup).toHaveBeenCalledWith(
      { lat: -22.97, lng: -43.18 },
      expect.objectContaining({
        carType: 'plus',
        destinationLocation: { lat: -22.98, lng: -43.21 },
        radiusKm: 4
      })
    );
    expect(findAvailableDriversForPickup).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'rideAvailabilityResult',
      expect.objectContaining({
        success: true,
        requestId: 'req-1',
        available: true,
        hasDrivers: true,
        code: 'DRIVERS_AVAILABLE',
        carType: 'plus',
        radiusKm: 4
      })
    );
    expect(logStructured).toHaveBeenCalledWith(
      'info',
      'Pré-check de disponibilidade concluído',
      expect.objectContaining({
        eventType: 'checkRideAvailability',
        hasDrivers: true,
        candidates: 2,
        eligible: 1,
        rejections: { locked: 1 }
      })
    );
  });

  it('emits the VPS-compatible error contract when availability lookup fails', async () => {
    const { listeners, socket } = buildHarness({
      checkRideAvailabilityForPickup: jest.fn().mockResolvedValue({
        success: false,
        error: 'pickup_location_invalid',
        hasDrivers: false
      })
    });

    await listeners.checkRideAvailability({
      requestId: 'req-2',
      lat: 'invalid',
      lng: -43.18
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'rideAvailabilityError',
      expect.objectContaining({
        success: false,
        requestId: 'req-2',
        code: 'AVAILABILITY_CHECK_FAILED'
      })
    );
  });
});
