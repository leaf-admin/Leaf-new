import {
  buildOngoingRideNotification,
  isOngoingRideNotificationAvailable,
  ONGOING_RIDE_CHANNEL_ID,
  ONGOING_RIDE_NOTIFICATION_ID,
} from '../src/services/LeafOngoingRideNotification';
import { buildNotificationDescriptor } from '../src/services/PrototypeDriverTripAssistantService';

jest.mock('../src/services/PersistentRideNotificationService', () => ({
  __esModule: true,
  default: {},
}));

describe('ongoing ride notification (Android)', () => {
  it('is unavailable where the native library is not part of the build', () => {
    expect(isOngoingRideNotificationAvailable()).toBe(false);
  });

  it('builds one ongoing notification with a native progress bar and a countdown', () => {
    const notification = buildOngoingRideNotification(
      {
        title: 'Em viagem',
        subtitle: '12 min · 5 km',
        body: 'Destino: Via Parque · R$ 31,20',
        progress: 0.4,
        countdownSeconds: 720,
        actions: [{ identifier: 'end_trip', buttonTitle: 'Encerrar' }],
        data: { bookingId: 'booking_1', status: 'started', extra: { a: 1 }, skip: null },
      },
      { now: 1000000 },
    );

    expect(notification.id).toBe(ONGOING_RIDE_NOTIFICATION_ID);
    expect(notification.title).toBe('Em viagem');
    expect(notification.subtitle).toBe('12 min · 5 km');
    expect(notification.data).toEqual({ bookingId: 'booking_1', status: 'started', extra: '{"a":1}' });
    expect(notification.android).toMatchObject({
      channelId: ONGOING_RIDE_CHANNEL_ID,
      smallIcon: 'ic_stat_leaf',
      ongoing: true,
      onlyAlertOnce: true,
      autoCancel: false,
      showChronometer: true,
      chronometerDirection: 'down',
      timestamp: 1000000 + 720000,
      progress: { max: 100, current: 40 },
    });
    expect(notification.android.actions).toEqual([
      { title: 'Encerrar', pressAction: { id: 'end_trip', launchActivity: 'default' } },
    ]);
  });

  it('omits the bar and the timer when there is nothing to measure', () => {
    const notification = buildOngoingRideNotification({ title: 'Corrida ativa', body: 'Acompanhe.', progress: null });

    expect(notification.android.progress).toBeUndefined();
    expect(notification.android.showChronometer).toBeUndefined();
    expect(notification.android.actions).toEqual([]);
  });

  it('clamps progress and ignores malformed actions', () => {
    const notification = buildOngoingRideNotification({
      title: 't',
      body: 'b',
      progress: 1.7,
      actions: [{ identifier: 'x' }, null, { identifier: 'start_trip', buttonTitle: 'Iniciar' }],
    });

    expect(notification.android.progress.current).toBe(100);
    expect(notification.android.actions).toHaveLength(1);
  });
});

describe('driver trip notification descriptor', () => {
  const base = {
    bookingId: 'booking_1',
    pickupAddress: 'R. das Pastorinhas, 4',
    destinationAddress: 'Via Parque Shopping',
    initialMeters: 4000,
    remainingMeters: 1000,
    etaMinutes: 4,
    fareLabel: 'R$ 31,20',
  };

  it('describes the way to pickup with progress, time and no block characters', () => {
    const descriptor = buildNotificationDescriptor({ ...base, status: 'accepted' });

    expect(descriptor.ongoing).toEqual({
      title: 'A caminho do embarque',
      subtitle: '4 min · 1 km',
      body: 'Embarque: R. das Pastorinhas, 4',
      progress: 0.75,
      countdownSeconds: 240,
    });
    expect(descriptor.ongoing.body).not.toMatch(/[█░]/);
  });

  it('offers "Cheguei" once the driver is at the pickup', () => {
    const descriptor = buildNotificationDescriptor({ ...base, status: 'accepted', pickupToleranceReached: true });

    expect(descriptor.ongoing.title).toBe('Você chegou ao embarque');
    expect(descriptor.ongoing).toMatchObject({ subtitle: 'Toque em Cheguei', progress: 1, countdownSeconds: 0 });
    expect(descriptor.androidActions).toEqual([{ identifier: 'arrived_at_pickup', buttonTitle: 'Cheguei' }]);
  });

  it('counts down the boarding window while waiting, without a progress bar', () => {
    const descriptor = buildNotificationDescriptor({ ...base, status: 'arrived', boardingRemainingSec: 95 });

    expect(descriptor.ongoing).toMatchObject({
      title: 'Aguardando passageiro',
      progress: null,
      countdownSeconds: 95,
    });
  });

  it('keeps only street and neighbourhood of a long address', () => {
    const descriptor = buildNotificationDescriptor({
      ...base,
      status: 'accepted',
      pickupAddress: 'R. das Pastorinhas, 4 - Jacarepaguá, Rio de Janeiro - RJ, 22723-260, Brasil',
    });

    expect(descriptor.ongoing.body).toBe('Embarque: R. das Pastorinhas, 4 - Jacarepaguá');

    const trip = buildNotificationDescriptor({
      ...base,
      status: 'started',
      destinationAddress: 'Via Parque Shopping - Avenida Ayrton Senna - Barra da Tijuca, Rio de Janeiro - RJ',
    });
    expect(trip.ongoing.body).toBe('Destino: Via Parque Shopping - Avenida Ayrton Senna · R$ 31,20');
  });

  it('shows destination and the driver net fare during the trip', () => {
    const descriptor = buildNotificationDescriptor({ ...base, status: 'started' });

    expect(descriptor.ongoing).toMatchObject({
      title: 'Em viagem',
      body: 'Destino: Via Parque Shopping · R$ 31,20',
      progress: 0.75,
    });
  });
});
