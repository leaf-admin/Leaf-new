import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearCanonicalRideLocalSnapshot,
  loadCanonicalRideLocalSnapshot,
  saveCanonicalRideLocalSnapshot,
  shouldAcceptRideLocalSnapshot,
} from '../src/services/RideLocalSnapshotService';

describe('RideLocalSnapshotService', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('accepts forward lifecycle movement for the same ride', async () => {
    await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_1',
      userId: 'driver_1',
      role: 'driver',
      status: 'accepted',
    });

    const result = await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_1',
      userId: 'driver_1',
      role: 'driver',
      status: 'started',
    });
    const persisted = await loadCanonicalRideLocalSnapshot({
      bookingId: 'booking_1',
      userId: 'driver_1',
      role: 'driver',
    });

    expect(result.saved).toBe(true);
    expect(persisted.status).toBe('started');
  });

  it('rejects local regressions after a newer active state', async () => {
    await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_2',
      userId: 'customer_1',
      role: 'customer',
      status: 'started',
    });

    const result = await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_2',
      userId: 'customer_1',
      role: 'customer',
      status: 'accepted',
    });
    const persisted = await loadCanonicalRideLocalSnapshot({
      bookingId: 'booking_2',
      userId: 'customer_1',
      role: 'customer',
    });

    expect(result).toEqual(
      expect.objectContaining({
        saved: false,
        reason: 'regression_rejected',
      }),
    );
    expect(persisted.status).toBe('started');
  });

  it('keeps terminal state from being overwritten by active sync without newer version', () => {
    expect(
      shouldAcceptRideLocalSnapshot(
        { bookingId: 'booking_3', status: 'completed' },
        { bookingId: 'booking_3', status: 'started' },
      ),
    ).toBe(false);
  });

  it('clears a scoped snapshot after terminal cleanup', async () => {
    await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_4',
      userId: 'driver_4',
      role: 'driver',
      status: 'completed',
    });

    await expect(
      clearCanonicalRideLocalSnapshot({
        bookingId: 'booking_4',
        userId: 'driver_4',
        role: 'driver',
      }),
    ).resolves.toBe(true);
    await expect(
      loadCanonicalRideLocalSnapshot({
        bookingId: 'booking_4',
        userId: 'driver_4',
        role: 'driver',
      }),
    ).resolves.toBeNull();
  });
});
