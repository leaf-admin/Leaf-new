const mockRedis = {
  georadius: jest.fn(),
  hgetall: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
};

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn()
}));

jest.mock('../../../services/driver-eligibility-service', () => ({
  isDriverEligibleForRide: jest.fn()
}));

const driverLockManager = require('../../../services/driver-lock-manager');
const driverEligibilityService = require('../../../services/driver-eligibility-service');
const {
  buildPaymentAvailabilityInput,
  hasPaymentEligibleDriver
} = require('../../../services/payment-driver-availability-guard');

describe('payment-driver-availability-guard', () => {
  beforeEach(() => {
    mockRedis.georadius.mockReset();
    mockRedis.hgetall.mockReset();
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
    mockRedis.del.mockReset();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    driverLockManager.isDriverLocked.mockReset();
    driverEligibilityService.isDriverEligibleForRide.mockReset();
  });

  it('extracts route, category, and preferences from the payment payload', () => {
    const input = buildPaymentAvailabilityInput({
      rideDetails: {
        pickupLocation: { latitude: -22.85, longitude: -43.31 },
        destinationLocation: { lat: -22.87, lng: -43.34 },
        carType: 'Leaf Plus',
        preferences: { leafDelas: true }
      }
    });

    expect(input).toEqual({
      pickupLocation: { latitude: -22.85, longitude: -43.31, lat: -22.85, lng: -43.31 },
      destinationLocation: { lat: -22.87, lng: -43.34 },
      carType: 'Leaf Plus',
      preferences: { leafDelas: true }
    });
  });

  it('returns no drivers when the eligible geo pool is empty', async () => {
    mockRedis.georadius.mockResolvedValue([]);

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      carType: 'Leaf Plus'
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      rejections: {}
    });
    expect(mockRedis.georadius).toHaveBeenCalledWith(
      'driver_locations_eligible',
      -43.31,
      -22.85,
      5,
      'km',
      'WITHDIST',
      'WITHCOORD',
      'COUNT',
      12
    );
  });

  it('confirms availability only for online, unlocked, category-eligible drivers', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-1', '0.3', ['-43.31', '-22.85']]
    ]);
    driverLockManager.isDriverLocked.mockResolvedValue({ isLocked: false });
    mockRedis.hgetall.mockResolvedValue({
      isOnline: 'true',
      dispatchEligible: 'true',
      status: 'AVAILABLE',
      carType: 'Leaf Plus'
    });
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({ eligible: true });

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      destinationLocation: { lat: -22.87, lng: -43.34 },
      carType: 'Leaf Plus'
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: true,
      code: 'DRIVERS_AVAILABLE',
      driverId: 'driver-1',
      rejections: {
        locked: 0,
        paymentReserved: 0,
        missingState: 0,
        offlineOrIneligible: 0,
        socketUnreachable: 0,
        preferenceMismatch: 0,
        categoryMismatch: 0
      }
    });
    expect(driverEligibilityService.isDriverEligibleForRide).toHaveBeenCalledWith(
      'driver-1',
      'Leaf Plus',
      expect.objectContaining({ status: 'AVAILABLE' })
    );
  });

  it('reports why nearby drivers were rejected without exposing driver identifiers', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-locked', '0.2', ['-43.31', '-22.85']],
      ['driver-category', '0.3', ['-43.31', '-22.85']]
    ]);
    driverLockManager.isDriverLocked
      .mockResolvedValueOnce({ isLocked: true })
      .mockResolvedValueOnce({ isLocked: false });
    mockRedis.hgetall.mockResolvedValue({
      isOnline: 'true',
      dispatchEligible: 'true',
      status: 'AVAILABLE',
      carType: 'Leaf Moto'
    });
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({ eligible: false });

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      carType: 'Leaf Plus'
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      candidates: 2,
      eligible: 0,
      rejections: {
        locked: 1,
        paymentReserved: 0,
        missingState: 0,
        offlineOrIneligible: 0,
        socketUnreachable: 0,
        preferenceMismatch: 0,
        categoryMismatch: 1
      }
    });
    expect(JSON.stringify(result)).not.toContain('driver-locked');
    expect(JSON.stringify(result)).not.toContain('driver-category');
  });

  it('reserves an eligible driver atomically before Pix creation', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-1', '0.3', ['-43.31', '-22.85']]
    ]);
    driverLockManager.isDriverLocked.mockResolvedValue({ isLocked: false });
    mockRedis.hgetall.mockResolvedValue({
      isOnline: 'true',
      dispatchEligible: 'true',
      status: 'AVAILABLE',
      carType: 'Leaf Plus'
    });
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({ eligible: true });

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      destinationLocation: { lat: -22.87, lng: -43.34 },
      carType: 'Leaf Plus',
      reserveDriver: true,
      reservationContext: {
        passengerId: 'passenger-1',
        rideId: 'temp-ride-1',
        quoteLockId: 'ql-1'
      },
      reservationTtlSeconds: 180
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: true,
      code: 'DRIVER_RESERVED_FOR_PAYMENT',
      driverId: 'driver-1',
      reservationId: expect.stringMatching(/^pdr_/),
      reservationTtlSeconds: 180
    });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'driver_payment_reservation:driver-1',
      result.reservationId,
      'EX',
      180,
      'NX'
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      `payment_driver_reservation:${result.reservationId}`,
      expect.stringContaining('"driverId":"driver-1"'),
      'EX',
      180
    );
  });

  it('reuses a matching payment reservation for the same passenger quote instead of reporting no drivers', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-1', '0.2', ['-43.31', '-22.85']]
    ]);
    mockRedis.get.mockImplementation(async (key) => {
      if (key === 'driver_payment_reservation:driver-1') return 'pdr_existing';
      if (key === 'payment_driver_reservation:pdr_existing') {
        return JSON.stringify({
          reservationId: 'pdr_existing',
          driverId: 'driver-1',
          passengerId: 'passenger-1',
          rideId: 'temp-ride-original',
          paymentSessionId: 'pay-original',
          quoteLockId: 'ql-1',
          quoteSessionId: 'quote-session-1',
          createdAtIso: '2026-06-27T01:00:00.000Z'
        });
      }
      return null;
    });
    driverLockManager.isDriverLocked.mockResolvedValue({ isLocked: false });
    mockRedis.hgetall.mockResolvedValue({
      isOnline: 'true',
      dispatchEligible: 'true',
      status: 'AVAILABLE',
      carType: 'Leaf Plus'
    });
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({ eligible: true });

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      destinationLocation: { lat: -22.87, lng: -43.34 },
      carType: 'Leaf Plus',
      reserveDriver: true,
      reservationContext: {
        passengerId: 'passenger-1',
        rideId: 'temp-ride-retry',
        paymentSessionId: 'pay-retry',
        quoteLockId: 'ql-1',
        quoteSessionId: 'quote-session-1'
      },
      reservationTtlSeconds: 180
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: true,
      code: 'DRIVER_RESERVED_FOR_PAYMENT',
      driverId: 'driver-1',
      reservationId: 'pdr_existing',
      reservationTtlSeconds: 180,
      reservationReused: true
    });
    expect(mockRedis.set).toHaveBeenCalledWith(
      'driver_payment_reservation:driver-1',
      'pdr_existing',
      'EX',
      180
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      'payment_driver_reservation:pdr_existing',
      expect.stringContaining('"reservationId":"pdr_existing"'),
      'EX',
      180
    );
  });

  it('does not count a driver reserved for another payment as available', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-reserved', '0.3', ['-43.31', '-22.85']]
    ]);
    mockRedis.get.mockImplementation(async (key) => {
      if (key === 'driver_payment_reservation:driver-reserved') return 'pdr_other';
      if (key === 'payment_driver_reservation:pdr_other') {
        return JSON.stringify({
          reservationId: 'pdr_other',
          driverId: 'driver-reserved',
          passengerId: 'other-passenger',
          rideId: 'other-ride'
        });
      }
      return null;
    });

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      carType: 'Leaf Plus',
      reserveDriver: true,
      reservationContext: {
        passengerId: 'passenger-1',
        rideId: 'temp-ride-1'
      }
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      rejections: expect.objectContaining({
        paymentReserved: 1
      })
    });
    expect(driverLockManager.isDriverLocked).not.toHaveBeenCalled();
  });

  it('blocks availability when a Redis-online driver is not reachable by dispatch socket', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-1', '0.3', ['-43.31', '-22.85']]
    ]);
    driverLockManager.isDriverLocked.mockResolvedValue({ isLocked: false });
    mockRedis.hgetall.mockResolvedValue({
      isOnline: 'true',
      dispatchEligible: 'true',
      status: 'AVAILABLE',
      carType: 'Leaf Plus'
    });

    const io = {
      connectedUsers: new Map(),
      in: jest.fn(() => ({
        fetchSockets: jest.fn().mockResolvedValue([])
      }))
    };

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      carType: 'Leaf Plus',
      io
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      rejections: expect.objectContaining({
        socketUnreachable: 1
      })
    });
    expect(driverEligibilityService.isDriverEligibleForRide).not.toHaveBeenCalled();
    expect(io.in).toHaveBeenCalledWith('driver_driver-1');
  });

  it('accepts a Redis-online driver when distributed socket presence proves dispatch reachability', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-1', '0.3', ['-43.31', '-22.85']]
    ]);
    driverLockManager.isDriverLocked.mockResolvedValue({ isLocked: false });
    mockRedis.hgetall.mockImplementation(async (key) => {
      if (key === 'driver:driver-1') {
        return {
          isOnline: 'true',
          dispatchEligible: 'true',
          status: 'AVAILABLE',
          carType: 'Leaf Plus'
        };
      }
      if (key === 'driver_socket_presence:driver-1') {
        return {
          driverId: 'driver-1',
          socketId: 'socket-on-gateway-1',
          userType: 'driver',
          connected: 'true',
          inDriverRoom: 'true',
          rooms: JSON.stringify(['socket-on-gateway-1', 'drivers_room', 'driver_driver-1']),
          updatedAtMs: String(Date.now()),
          updatedAt: new Date().toISOString(),
          workerId: 'websocket'
        };
      }
      return {};
    });
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({ eligible: true });

    const io = {
      connectedUsers: new Map(),
      in: jest.fn(() => ({
        fetchSockets: jest.fn().mockResolvedValue([])
      }))
    };

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      carType: 'Leaf Plus',
      io
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: true,
      code: 'DRIVERS_AVAILABLE',
      driverId: 'driver-1',
      rejections: expect.objectContaining({
        socketUnreachable: 0
      })
    });
    expect(driverEligibilityService.isDriverEligibleForRide).toHaveBeenCalledWith(
      'driver-1',
      'Leaf Plus',
      expect.objectContaining({ status: 'AVAILABLE' })
    );
  });

  it('cleans an expired payment reservation and counts the driver as available', async () => {
    mockRedis.georadius.mockResolvedValue([
      ['driver-1', '0.3', ['-43.31', '-22.85']]
    ]);
    mockRedis.get.mockImplementation(async (key) => {
      if (key === 'driver_payment_reservation:driver-1') return 'pdr_expired';
      if (key === 'payment_driver_reservation:pdr_expired') {
        return JSON.stringify({
          reservationId: 'pdr_expired',
          driverId: 'driver-1',
          passengerId: 'passenger-old',
          rideId: 'temp-old',
          expiresAtMs: Date.now() - 1000
        });
      }
      return null;
    });
    driverLockManager.isDriverLocked.mockResolvedValue({ isLocked: false });
    mockRedis.hgetall.mockResolvedValue({
      isOnline: 'true',
      dispatchEligible: 'true',
      status: 'AVAILABLE',
      carType: 'Leaf Plus'
    });
    driverEligibilityService.isDriverEligibleForRide.mockResolvedValue({ eligible: true });

    const result = await hasPaymentEligibleDriver({
      pickupLocation: { lat: -22.85, lng: -43.31 },
      destinationLocation: { lat: -22.87, lng: -43.34 },
      carType: 'Leaf Plus',
      reservationContext: {
        passengerId: 'passenger-1',
        rideId: 'temp-ride-1'
      }
    });

    expect(result).toMatchObject({
      success: true,
      hasDrivers: true,
      code: 'DRIVERS_AVAILABLE',
      driverId: 'driver-1',
      rejections: expect.objectContaining({
        paymentReserved: 0
      })
    });
    expect(mockRedis.del).toHaveBeenCalledWith('driver_payment_reservation:driver-1');
    expect(mockRedis.del).toHaveBeenCalledWith('payment_driver_reservation:pdr_expired');
  });
});
