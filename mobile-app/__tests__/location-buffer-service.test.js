import AsyncStorage from '@react-native-async-storage/async-storage';
import locationBufferService from '../src/services/LocationBufferService';
import WebSocketManager from '../src/services/WebSocketManager';

jest.mock('../src/services/WebSocketManager', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(),
  },
}));

describe('LocationBufferService', () => {
  let socketManager;

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    locationBufferService.activeTripContextCache = null;
    locationBufferService.isOnline = true;
    socketManager = {
      authenticatedUserId: 'driver_1',
      getConnectionStatus: jest.fn(() => ({ authenticated: true })),
      isConnected: jest.fn(() => true),
      updateLocationBatch: jest.fn().mockResolvedValue({
        success: true,
        acceptedCount: 2,
      }),
      emitToServer: jest.fn(),
    };
    WebSocketManager.getInstance.mockReturnValue(socketManager);
  });

  it('flushes buffered driver locations as an ordered batch with sequence metadata', async () => {
    await locationBufferService.setActiveTripContext({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      tripStatus: 'started',
    });
    await locationBufferService.addLocation(
      'booking_1',
      {
        lat: -22.92,
        lng: -43.18,
        seq: 2,
        capturedAt: 1710000005000,
        source: 'background_task',
      },
      'driver',
      { attemptImmediateSend: false, driverId: 'driver_1' },
    );
    await locationBufferService.addLocation(
      'booking_1',
      {
        lat: -22.91,
        lng: -43.17,
        seq: 1,
        capturedAt: 1710000000000,
        source: 'background_task',
      },
      'driver',
      { attemptImmediateSend: false, driverId: 'driver_1' },
    );

    await locationBufferService.syncBufferedLocations();

    expect(socketManager.updateLocationBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'driver_1',
        bookingId: 'booking_1',
        tripStatus: 'started',
        isInTrip: true,
        source: 'location_buffer_batch',
        locations: [
          expect.objectContaining({ seq: 1, capturedAt: 1710000000000 }),
          expect.objectContaining({ seq: 2, capturedAt: 1710000005000 }),
        ],
      }),
    );
    await expect(locationBufferService.getBuffer()).resolves.toEqual([]);
  });

  it('keeps buffered driver locations when batch sync fails', async () => {
    socketManager.updateLocationBatch.mockRejectedValueOnce(new Error('network_down'));
    await locationBufferService.setActiveTripContext({
      bookingId: 'booking_2',
      driverId: 'driver_1',
      tripStatus: 'started',
    });
    await locationBufferService.addLocation(
      'booking_2',
      {
        lat: -22.93,
        lng: -43.19,
        seq: 1,
        capturedAt: 1710000010000,
      },
      'driver',
      { attemptImmediateSend: false, driverId: 'driver_1' },
    );

    await locationBufferService.syncBufferedLocations();

    const buffer = await locationBufferService.getBuffer();
    expect(buffer).toHaveLength(1);
    expect(buffer[0]).toEqual(expect.objectContaining({
      bookingId: 'booking_2',
      seq: 1,
    }));
  });
});
