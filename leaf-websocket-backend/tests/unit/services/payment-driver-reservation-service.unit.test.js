const {
  getDriverPaymentReservation,
  getDriverPaymentReservationKey,
  getPaymentDriverReservationKey
} = require('../../../services/payment-driver-reservation-service');

function createRedis({ reservation, booking }) {
  const strings = new Map();
  strings.set(getDriverPaymentReservationKey(reservation.driverId), reservation.reservationId);
  strings.set(getPaymentDriverReservationKey(reservation.reservationId), JSON.stringify(reservation));
  const deleted = [];
  return {
    deleted,
    get: jest.fn(async (key) => strings.get(key) || null),
    hgetall: jest.fn(async (key) => (key === `booking:${reservation.bookingId}` ? booking || {} : {})),
    multi: () => {
      const ops = [];
      const pipeline = {
        del: (key) => { ops.push(key); return pipeline; },
        exec: async () => { ops.forEach((key) => { strings.delete(key); deleted.push(key); }); }
      };
      return pipeline;
    }
  };
}

const baseReservation = {
  reservationId: 'pdr_test',
  driverId: 'driver_1',
  passengerId: 'passenger_1',
  rideId: 'temp_ride_1',
  bookingId: 'booking_1',
  status: 'consumed_for_booking',
  expiresAtMs: Date.now() + 60 * 60 * 1000
};

describe('getDriverPaymentReservation', () => {
  it('releases the driver once the paid booking ended without a driver', async () => {
    const redis = createRedis({
      reservation: baseReservation,
      booking: { state: 'CANCELED', status: 'NO_DRIVERS_AVAILABLE' }
    });

    await expect(getDriverPaymentReservation(redis, 'driver_1')).resolves.toBeNull();
    expect(redis.deleted).toContain(getDriverPaymentReservationKey('driver_1'));
  });

  it('keeps holding the driver while the paid booking is still active', async () => {
    const redis = createRedis({
      reservation: baseReservation,
      booking: { state: 'SEARCHING', status: 'SEARCHING' }
    });

    await expect(getDriverPaymentReservation(redis, 'driver_1')).resolves.toEqual(
      expect.objectContaining({ reservationId: 'pdr_test' })
    );
    expect(redis.deleted).toHaveLength(0);
  });

  it('keeps holding the driver when the booking record is not written yet', async () => {
    const redis = createRedis({ reservation: baseReservation, booking: {} });

    await expect(getDriverPaymentReservation(redis, 'driver_1')).resolves.toEqual(
      expect.objectContaining({ reservationId: 'pdr_test' })
    );
  });

  it('does not look up bookings for reservations that are not consumed yet', async () => {
    const redis = createRedis({
      reservation: { ...baseReservation, status: 'reserved', bookingId: undefined },
      booking: { state: 'CANCELED' }
    });

    await expect(getDriverPaymentReservation(redis, 'driver_1')).resolves.not.toBeNull();
    expect(redis.hgetall).not.toHaveBeenCalled();
  });
});
