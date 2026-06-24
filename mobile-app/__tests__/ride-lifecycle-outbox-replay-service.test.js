import { RIDE_EVENT_TYPES } from '../src/services/RideEventOutboxService';
import {
  replayPendingRideLifecycleIntents,
  resolveRideLifecycleReplayDecision,
} from '../src/services/RideLifecycleOutboxReplayService';

describe('RideLifecycleOutboxReplayService', () => {
  it('holds start trip replay until the canonical state is arrived', () => {
    expect(
      resolveRideLifecycleReplayDecision(
        {
          bookingId: 'ride_1',
          eventType: RIDE_EVENT_TYPES.START_TRIP,
        },
        {
          activeBookingId: 'ride_1',
          bookingStatus: 'accepted',
        },
      ),
    ).toMatchObject({
      action: 'hold',
      reason: 'start_not_eligible',
    });
  });

  it('replays complete trip with the original idempotency key when the ride is started', async () => {
    const socket = {
      isConnected: jest.fn(() => true),
      completeTrip: jest
        .fn()
        .mockResolvedValue({ success: true, bookingId: 'ride_2' }),
    };
    const markAcked = jest.fn().mockResolvedValue(true);
    const onSyncState = jest.fn();

    const report = await replayPendingRideLifecycleIntents({
      state: {
        activeBookingId: 'ride_2',
        bookingStatus: 'started',
        currentCoordinate: { latitude: -22.95, longitude: -43.18 },
        tripDistanceKm: 12.4,
        selectedFare: 82.53,
        profileUid: 'driver_1',
      },
      socket,
      actorId: 'driver_1',
      listPendingIntents: jest.fn().mockResolvedValue([
        {
          bookingId: 'ride_2',
          actorId: 'driver_1',
          eventType: RIDE_EVENT_TYPES.COMPLETE_TRIP,
          idempotencyKey: 'idem_complete_ride_2',
          clientSequence: 4,
          clientCreatedAt: '2026-06-23T12:00:00.000Z',
          payload: {
            distanceKm: 12.4,
            fare: 82.53,
          },
        },
      ]),
      markAcked,
      onSyncState,
      logger: { warn: jest.fn() },
    });

    expect(report).toMatchObject({
      replayed: 1,
      acked: 0,
      rejected: 0,
      failed: 0,
    });
    expect(socket.completeTrip).toHaveBeenCalledWith(
      'ride_2',
      { lat: -22.95, lng: -43.18 },
      12.4,
      82.53,
      {
        idempotencyKey: 'idem_complete_ride_2',
        offlineIntent: true,
        rideEventOutbox: true,
        source: 'ride_event_outbox',
        eventType: RIDE_EVENT_TYPES.COMPLETE_TRIP,
        clientSequence: 4,
        clientCreatedAt: '2026-06-23T12:00:00.000Z',
      },
    );
    expect(markAcked).toHaveBeenCalledWith({
      idempotencyKey: 'idem_complete_ride_2',
    });
    expect(onSyncState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'idle',
        idempotencyKey: '',
      }),
    );
  });

  it('acks a pending arrival intent when active ride sync already reached arrived', async () => {
    const socket = {
      isConnected: jest.fn(() => true),
      arriveAtPickup: jest.fn(),
    };
    const markAcked = jest.fn().mockResolvedValue(true);

    const report = await replayPendingRideLifecycleIntents({
      state: {
        activeBookingId: 'ride_3',
        bookingStatus: 'arrived',
        profileUid: 'driver_1',
      },
      socket,
      actorId: 'driver_1',
      listPendingIntents: jest.fn().mockResolvedValue([
        {
          bookingId: 'ride_3',
          actorId: 'driver_1',
          eventType: RIDE_EVENT_TYPES.ARRIVED_AT_PICKUP,
          idempotencyKey: 'idem_arrive_ride_3',
        },
      ]),
      markAcked,
      logger: { warn: jest.fn() },
    });

    expect(report).toMatchObject({ replayed: 0, acked: 1, held: 0 });
    expect(socket.arriveAtPickup).not.toHaveBeenCalled();
    expect(markAcked).toHaveBeenCalledWith({
      idempotencyKey: 'idem_arrive_ride_3',
    });
  });
});
