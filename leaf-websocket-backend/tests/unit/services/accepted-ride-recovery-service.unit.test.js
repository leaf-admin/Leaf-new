jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    ACCEPTED: 'ACCEPTED',
    IN_PROGRESS: 'IN_PROGRESS',
    SEARCHING: 'SEARCHING',
  },
  updateBookingState: jest.fn(),
  getBookingState: jest.fn(),
}));

jest.mock('../../../services/payment-dispatch-service', () => ({
  triggerDispatchAfterPayment: jest.fn(),
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  releaseLock: jest.fn(),
}));

jest.mock('../../../utils/active-trip-index', () => ({
  clearActiveTripForDriver: jest.fn(),
  resolveActiveTripForDriver: jest.fn(),
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
}));

const RideStateManager = require('../../../services/ride-state-manager');
const paymentDispatchService = require('../../../services/payment-dispatch-service');
const driverLockManager = require('../../../services/driver-lock-manager');
const { clearActiveTripForDriver } = require('../../../utils/active-trip-index');
const {
  recoverAcceptedBooking,
} = require('../../../services/accepted-ride-recovery-service');

function createRedis(booking) {
  const hashes = {
    'booking:booking_1': { ...booking },
  };

  return {
    hgetall: jest.fn(async (key) => ({ ...(hashes[key] || {}) })),
    set: jest.fn(async () => 'OK'),
    hdel: jest.fn(async () => 1),
    del: jest.fn(async () => 1),
    hset: jest.fn(async (key, patch) => {
      hashes[key] = {
        ...(hashes[key] || {}),
        ...patch,
      };
      return 1;
    }),
  };
}

describe('accepted ride recovery service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RideStateManager.updateBookingState.mockResolvedValue(true);
    paymentDispatchService.triggerDispatchAfterPayment.mockResolvedValue({
      success: true,
    });
    clearActiveTripForDriver.mockResolvedValue(undefined);
    driverLockManager.releaseLock.mockResolvedValue(true);
  });

  it('keeps a disconnected accepted ride on an explicit continuation contract for the passenger', async () => {
    const redis = createRedis({
      state: 'ACCEPTED',
      status: 'ACCEPTED',
      driverId: 'driver_1',
      customerId: 'passenger_1',
      pickupLocation: JSON.stringify({ lat: -22.9, lng: -43.2, add: 'Origem' }),
      destinationLocation: JSON.stringify({ lat: -22.91, lng: -43.21, add: 'Destino' }),
      estimatedFare: '3840',
      paymentStatus: 'confirmed',
    });
    const passengerRoom = { emit: jest.fn() };
    const io = { to: jest.fn(() => passengerRoom) };

    const result = await recoverAcceptedBooking({
      redis,
      io,
      bookingId: 'booking_1',
      expectedDriverId: 'driver_1',
      reason: 'driver_disconnect_before_start',
      source: 'test',
    });

    expect(result).toMatchObject({ recovered: true, bookingId: 'booking_1' });
    expect(RideStateManager.updateBookingState).toHaveBeenCalledWith(
      redis,
      'booking_1',
      RideStateManager.STATES.SEARCHING,
      expect.objectContaining({
        recoveryMode: 'accepted_driver_reassignment',
        status: 'REASSIGNMENT_PENDING',
      }),
    );
    expect(driverLockManager.releaseLock).toHaveBeenCalledWith('driver_1', 'booking_1');
    expect(redis.hset).toHaveBeenCalledWith(
      'booking:booking_1',
      expect.objectContaining({
        status: 'REASSIGNMENT_PENDING',
        recoveryMode: 'accepted_driver_reassignment',
      }),
    );
    expect(passengerRoom.emit).toHaveBeenCalledWith(
      'rideOperationalContinuationSearching',
      expect.objectContaining({
        bookingId: 'booking_1',
        status: 'REASSIGNMENT_PENDING',
        recoveryMode: 'accepted_driver_reassignment',
        operationalContinuation: expect.objectContaining({
          status: 'SEARCHING_REPLACEMENT_DRIVER',
          previousDriverId: 'driver_1',
        }),
      }),
    );
    expect(passengerRoom.emit).toHaveBeenCalledWith(
      'activeRideSync',
      expect.objectContaining({
        bookingId: 'booking_1',
        status: 'REASSIGNMENT_PENDING',
        recoveryMode: 'accepted_driver_reassignment',
      }),
    );
    expect(paymentDispatchService.triggerDispatchAfterPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        pickupLocation: expect.objectContaining({ lat: -22.9, lng: -43.2 }),
      }),
    );
  });
});
