import AsyncStorage from '@react-native-async-storage/async-storage';
import prototypeDriverTripAssistantService, {
  DESTINATION_ALERT_METERS,
  resolveArrivalAlert,
} from '../src/services/PrototypeDriverTripAssistantService';
import { buildRideArrivalAlert, cancelRideArrivalAlert, displayRideArrivalAlert } from '../src/services/LeafOngoingRideNotification';

jest.mock('../src/services/LeafOngoingRideNotification', () => ({
  ...jest.requireActual('../src/services/LeafOngoingRideNotification'),
  displayRideArrivalAlert: jest.fn().mockResolvedValue(true),
  cancelRideArrivalAlert: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/services/BackgroundLocationService', () => ({
  __esModule: true,
  default: {
    checkPermissions: jest.fn().mockResolvedValue({ foreground: true, background: true }),
    startBackgroundTracking: jest.fn().mockResolvedValue(undefined),
    stopBackgroundTracking: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/services/PersistentRideNotificationService', () => ({
  __esModule: true,
  default: {
    requestPermissions: jest.fn().mockResolvedValue(true),
    isNotificationActive: jest.fn(() => true),
    showRideNotification: jest.fn().mockResolvedValue(undefined),
    updateRideNotification: jest.fn().mockResolvedValue(undefined),
    dismissRideNotification: jest.fn().mockResolvedValue(undefined),
  },
}));

const PICKUP = { latitude: -22.920816, longitude: -43.406066 };
const DESTINATION = { latitude: -22.98953, longitude: -43.36513 };

describe('arrival heads-up while the driver navigates in Waze or Google Maps', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    prototypeDriverTripAssistantService.lastTrackingSessionKey = '';
    prototypeDriverTripAssistantService.cancelledArrivalAlertKey = undefined;
  });

  it('asks for "Cheguei ao embarque" at the pickup and "Encerrar corrida" near the destination', () => {
    expect(resolveArrivalAlert({ bookingId: 'b1', status: 'accepted', pickupToleranceReached: false })).toBeNull();
    expect(resolveArrivalAlert({ bookingId: 'b1', status: 'accepted', pickupToleranceReached: true, passengerName: 'Ana Souza' }))
      .toMatchObject({
        key: 'b1:pickup',
        body: 'Avise Ana que você chegou.',
        actions: [{ identifier: 'arrived_at_pickup', buttonTitle: 'Cheguei ao embarque' }],
      });
    expect(resolveArrivalAlert({ bookingId: 'b1', status: 'started', remainingMeters: DESTINATION_ALERT_METERS + 1 })).toBeNull();
    expect(resolveArrivalAlert({ bookingId: 'b1', status: 'started', remainingMeters: 120, destinationAddress: 'Via Parque Shopping - Barra' }))
      .toMatchObject({
        key: 'b1:destination',
        title: 'Chegando ao destino',
        actions: [{ identifier: 'end_trip', buttonTitle: 'Encerrar corrida' }],
      });
    expect(resolveArrivalAlert({ bookingId: 'b1', status: 'arrived' })).toBeNull();
  });

  it('builds a heads-up that opens Leaf and leaves the tray by itself', () => {
    const alert = buildRideArrivalAlert({
      title: 'Chegando ao destino',
      body: 'Via Parque Shopping',
      actions: [{ identifier: 'end_trip', buttonTitle: 'Encerrar corrida' }],
      data: { bookingId: 'b1' },
    });
    expect(alert.android).toMatchObject({ channelId: 'leaf_ride_arrival', autoCancel: true, timeoutAfter: 120000 });
    expect(alert.android.actions).toEqual([
      { title: 'Encerrar corrida', pressAction: { id: 'end_trip', launchActivity: 'default' } },
    ]);
  });

  it('fires once per phase from background fixes, then clears when the ride moves on', async () => {
    await prototypeDriverTripAssistantService.syncSession({
      bookingId: 'b1',
      status: 'accepted',
      pickupCoordinate: PICKUP,
      destinationCoordinate: DESTINATION,
      currentDriverLocation: { latitude: -22.9265, longitude: -43.4085 },
      remainingMeters: 700,
      etaMinutes: 3,
    });
    expect(displayRideArrivalAlert).not.toHaveBeenCalled();

    // Waze in front: only the background location task reports the driver at the door.
    await prototypeDriverTripAssistantService.handleBackgroundLocationUpdate({ lat: -22.92085, lng: -43.40610 });
    await prototypeDriverTripAssistantService.handleBackgroundLocationUpdate({ lat: -22.92084, lng: -43.40608 });
    expect(displayRideArrivalAlert).toHaveBeenCalledTimes(1);
    expect(displayRideArrivalAlert.mock.calls[0][0].title).toBe('Você chegou ao embarque');
    const session = await prototypeDriverTripAssistantService.loadSession();
    expect(session.remainingMeters).toBeLessThan(80);

    await prototypeDriverTripAssistantService.syncSession({ bookingId: 'b1', status: 'arrived' });
    expect(cancelRideArrivalAlert).toHaveBeenCalledTimes(1);

    await prototypeDriverTripAssistantService.syncSession({ bookingId: 'b1', status: 'started', remainingMeters: 5000 });
    await prototypeDriverTripAssistantService.handleBackgroundLocationUpdate({ lat: -22.98900, lng: -43.36540 });
    expect(displayRideArrivalAlert).toHaveBeenCalledTimes(2);
    expect(displayRideArrivalAlert.mock.calls[1][0].actions[0].identifier).toBe('end_trip');
  });
});
