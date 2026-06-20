import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RIDE_EVENT_TYPES,
  buildRideEventIdempotencyKey,
  enqueueRideEventIntent,
  listPendingRideEventIntents,
  markRideEventIntentAcked,
  markRideEventIntentRejected,
} from '../src/services/RideEventOutboxService';

describe('RideEventOutboxService', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('builds a stable key per booking, actor and lifecycle event', () => {
    expect(
      buildRideEventIdempotencyKey({
        bookingId: 'booking 123',
        actorId: 'driver/1',
        eventType: RIDE_EVENT_TYPES.START_TRIP,
      }),
    ).toBe('mobile_lifecycle_start_trip_booking_123_driver_1');
  });

  it('deduplicates pending intents by idempotency key', async () => {
    const first = await enqueueRideEventIntent({
      bookingId: 'booking_1',
      actorId: 'driver_1',
      role: 'driver',
      eventType: RIDE_EVENT_TYPES.COMPLETE_TRIP,
      payload: { fare: 82.53 },
    });
    const second = await enqueueRideEventIntent({
      bookingId: 'booking_1',
      actorId: 'driver_1',
      role: 'driver',
      eventType: RIDE_EVENT_TYPES.COMPLETE_TRIP,
      payload: { fare: 82.53 },
    });
    const pending = await listPendingRideEventIntents({ bookingId: 'booking_1' });

    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(pending).toHaveLength(1);
    expect(pending[0].eventType).toBe(RIDE_EVENT_TYPES.COMPLETE_TRIP);
  });

  it('removes acked intents from the pending list', async () => {
    const intent = await enqueueRideEventIntent({
      bookingId: 'booking_2',
      actorId: 'driver_2',
      role: 'driver',
      eventType: RIDE_EVENT_TYPES.START_TRIP,
    });

    await markRideEventIntentAcked({ idempotencyKey: intent.idempotencyKey });

    await expect(
      listPendingRideEventIntents({ bookingId: 'booking_2' }),
    ).resolves.toEqual([]);
  });

  it('allows rejected intents to be queued again with the same logical key', async () => {
    const intent = await enqueueRideEventIntent({
      bookingId: 'booking_3',
      actorId: 'driver_3',
      role: 'driver',
      eventType: RIDE_EVENT_TYPES.ARRIVED_AT_PICKUP,
    });
    await markRideEventIntentRejected({
      idempotencyKey: intent.idempotencyKey,
      error: 'Backend rejected',
    });

    const retried = await enqueueRideEventIntent({
      bookingId: 'booking_3',
      actorId: 'driver_3',
      role: 'driver',
      eventType: RIDE_EVENT_TYPES.ARRIVED_AT_PICKUP,
    });

    expect(retried.idempotencyKey).toBe(intent.idempotencyKey);
    expect(retried.status).toBe('pending');
    expect(retried.attempts).toBe(1);
  });
});
