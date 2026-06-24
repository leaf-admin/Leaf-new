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

  it('treats no-driver aliases as terminal local state', async () => {
    await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_no_driver',
      userId: 'customer_1',
      role: 'customer',
      status: 'no_drivers_available',
    });

    const persisted = await loadCanonicalRideLocalSnapshot({
      bookingId: 'booking_no_driver',
      userId: 'customer_1',
      role: 'passenger',
    });

    expect(persisted.status).toBe('no_drivers');
    expect(persisted.terminal).toBe(true);
  });

  it('rejects older backend versions even when the lifecycle status looks newer', async () => {
    await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_versioned',
      userId: 'driver_1',
      role: 'driver',
      status: 'started',
      serverVersion: 12,
    });

    const result = await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_versioned',
      userId: 'driver_1',
      role: 'driver',
      status: 'completed',
      serverVersion: 11,
    });
    const persisted = await loadCanonicalRideLocalSnapshot({
      bookingId: 'booking_versioned',
      userId: 'driver_1',
      role: 'driver',
    });

    expect(result).toEqual(expect.objectContaining({
      saved: false,
      reason: 'regression_rejected',
    }));
    expect(persisted.status).toBe('started');
    expect(persisted.serverVersion).toBe(12);
  });

  it('rejects older server event timestamps when version is absent', async () => {
    await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_timestamped',
      userId: 'passenger_1',
      role: 'passenger',
      status: 'started',
      lastServerEventAt: '2026-06-23T12:05:00.000Z',
    });

    const result = await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_timestamped',
      userId: 'passenger_1',
      role: 'customer',
      status: 'completed',
      lastServerEventAt: '2026-06-23T12:04:00.000Z',
    });
    const persisted = await loadCanonicalRideLocalSnapshot({
      bookingId: 'booking_timestamped',
      userId: 'passenger_1',
      role: 'customer',
    });

    expect(result.saved).toBe(false);
    expect(persisted.status).toBe('started');
  });

  it('strips non-authoritative fee and driver net fields from local financial snapshots', async () => {
    await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_finance_local',
      userId: 'passenger_1',
      role: 'passenger',
      status: 'completed',
      financialSnapshot: {
        fare: 81.17,
        operationalFee: 2.44,
        paymentIntermediationFee: 0.65,
        totalFees: 3.09,
        driverNetAmount: 78.08,
        financialSnapshotSource: 'socket_fallback',
        authoritativeSnapshot: false,
      },
    });

    const persisted = await loadCanonicalRideLocalSnapshot({
      bookingId: 'booking_finance_local',
      userId: 'passenger_1',
      role: 'passenger',
    });

    expect(persisted.financialSnapshot).toEqual({
      paymentStatus: null,
      paymentId: null,
      chargeId: null,
      fare: 81.17,
      authoritativeSnapshot: false,
      financialSnapshotSource: 'socket_fallback',
    });
  });

  it('preserves backend-final financial snapshots exactly as authoritative evidence', async () => {
    const backendFinal = {
      fare: 81.17,
      operationalFee: 2.44,
      paymentIntermediationFee: 0.65,
      totalFees: 3.09,
      driverNetAmount: 78.08,
      financialSnapshotSource: 'backend_final',
      authoritativeSnapshot: true,
    };

    await saveCanonicalRideLocalSnapshot({
      bookingId: 'booking_finance_backend',
      userId: 'passenger_1',
      role: 'passenger',
      status: 'completed',
      financialSnapshot: backendFinal,
    });

    const persisted = await loadCanonicalRideLocalSnapshot({
      bookingId: 'booking_finance_backend',
      userId: 'passenger_1',
      role: 'passenger',
    });

    expect(persisted.financialSnapshot).toEqual(backendFinal);
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
